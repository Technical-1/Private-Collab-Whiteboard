import { describe, it, expect, beforeEach, afterEach, beforeAll, afterAll, vi } from 'vitest';
import * as Y from 'yjs';
import { SyncProvider } from '../js/sync-provider.js';
import { MSG } from '../js/protocol.js';

// Stub WebSocket so the provider constructor's connect() doesn't open a real
// socket. We only exercise the receive-routing wiring here.
class FakeWS {
  constructor() { this.readyState = 0; this.binaryType = ''; }
  close() {}
  send() {}
}

// Counts how many sockets get opened, and fires onclose when closed, so we can
// assert reconnect behavior.
class CountingWS {
  constructor() {
    CountingWS.count++;
    this.readyState = 0; this.binaryType = '';
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
  }
  close() { this.readyState = 3; if (this.onclose) this.onclose(); }
  send() {}
}
CountingWS.count = 0;

describe('SyncProvider lifecycle', () => {
  let prevWS;
  beforeEach(() => { prevWS = globalThis.WebSocket; globalThis.WebSocket = CountingWS; CountingWS.count = 0; });
  afterEach(() => { globalThis.WebSocket = prevWS; vi.useRealTimers(); });

  it('connect() is a no-op after destroy()', () => {
    const provider = new SyncProvider('localhost:9999', 'room', new Y.Doc(), {});
    expect(CountingWS.count).toBe(1); // initial connect in constructor
    provider.destroy();
    provider.connect(); // a stray reconnect attempt must do nothing
    expect(CountingWS.count).toBe(1);
  });

  it('does not reconnect when the socket close event fires after destroy()', () => {
    vi.useFakeTimers();
    const provider = new SyncProvider('localhost:9999', 'room', new Y.Doc(), {});
    provider.destroy(); // closes the socket -> onclose must NOT schedule a reconnect
    vi.advanceTimersByTime(5000);
    expect(CountingWS.count).toBe(1);
  });
});

describe('SyncProvider receive wiring (integration contract)', () => {
  let prevWS;
  beforeEach(() => { prevWS = globalThis.WebSocket; globalThis.WebSocket = FakeWS; });
  afterEach(() => { globalThis.WebSocket = prevWS; });

  // Regression: the signing layer assigns provider.onMessage AFTER construction,
  // so the provider must route received non-awareness frames to the settable
  // `onMessage` property (not a private field captured only from constructor
  // options). If this breaks, document sync silently dies while awareness still
  // works — exactly the prod regression this test guards against.
  it('routes received non-awareness frames to a post-construction onMessage', async () => {
    const doc = new Y.Doc();
    const provider = new SyncProvider('localhost:9999', 'room', doc, {});
    const got = [];
    provider.onMessage = (type, payload) => got.push({ type, len: payload.length });

    const frame = new Uint8Array([MSG.UPDATE, 1, 2, 3]);
    await provider._onMessage({ data: frame.buffer });

    provider.destroy();
    expect(got).toEqual([{ type: MSG.UPDATE, len: 3 }]);
  });

  it('does not route AWARENESS frames to onMessage (handled inline)', async () => {
    const doc = new Y.Doc();
    const provider = new SyncProvider('localhost:9999', 'room', doc, {});
    let called = false;
    provider.onMessage = () => { called = true; };

    // A malformed awareness payload is fine — it must not reach onMessage and
    // must not throw out of _onMessage.
    await provider._onMessage({ data: new Uint8Array([MSG.AWARENESS, 0]).buffer });

    provider.destroy();
    expect(called).toBe(false);
  });
});

// A WebSocket double that reports OPEN and records sent frames.
class CapturingWS {
  static OPEN = 1;
  constructor() {
    this.readyState = 1; this.binaryType = ''; this.sent = [];
    this.onopen = this.onmessage = this.onclose = this.onerror = null;
    CapturingWS.last = this;
  }
  close() { this.readyState = 3; }
  send(buf) { this.sent.push(new Uint8Array(buf)); }
}

// XOR-free "encryption" double: prepend 0xEE so we can detect it ran; decrypt strips it.
const fakeEncrypt = async (data) => { const o = new Uint8Array(data.length + 1); o[0] = 0xEE; o.set(data, 1); return o; };
const fakeDecrypt = async (data) => data.slice(1);

describe('SyncProvider presence probe', () => {
  let prevWS, prevWindow;
  // In node env `window` is undefined; polyfill it with an EventTarget so
  // the `typeof window !== 'undefined'` guard in _handlePresenceProbe
  // resolves and CustomEvent dispatch/listening works.
  beforeAll(() => {
    prevWindow = globalThis.window;
    if (typeof window === 'undefined') {
      const et = new EventTarget();
      globalThis.window = et;
    }
  });
  afterAll(() => {
    if (prevWindow === undefined) delete globalThis.window;
    else globalThis.window = prevWindow;
  });
  beforeEach(() => { prevWS = globalThis.WebSocket; globalThis.WebSocket = CapturingWS; });
  afterEach(() => { globalThis.WebSocket = prevWS; });

  it('broadcasts an enc:true probe on open for a capability room', async () => {
    const provider = new SyncProvider('localhost:9999', 'room', new Y.Doc(), {
      encryptionKey: {}, encrypt: fakeEncrypt, decrypt: fakeDecrypt,
    });
    await provider._onOpen();
    const probe = CapturingWS.last.sent.find(f => f[0] === MSG.PRESENCE_PROBE);
    provider.destroy();
    expect(probe).toBeDefined();
    const json = JSON.parse(new TextDecoder().decode(probe.slice(1)));
    expect(json.enc).toBe(true);
  });

  function probeFrame(enc) {
    const body = new TextEncoder().encode(JSON.stringify({ enc }));
    const f = new Uint8Array(1 + body.length);
    f[0] = MSG.PRESENCE_PROBE; f.set(body, 1);
    return f.buffer;
  }

  it('fires room-access-mismatch once when a keyless client sees an enc:true probe', async () => {
    const provider = new SyncProvider('localhost:9999', 'room', new Y.Doc(), {}); // keyless
    const events = [];
    const handler = (e) => events.push(e.type);
    window.addEventListener('room-access-mismatch', handler);
    await provider._onMessage({ data: probeFrame(true) });
    await provider._onMessage({ data: probeFrame(true) }); // second time: no duplicate
    window.removeEventListener('room-access-mismatch', handler);
    provider.destroy();
    expect(events).toEqual(['room-access-mismatch']);
  });

  it('does NOT fire mismatch for an encrypted client receiving an enc:true probe', async () => {
    const provider = new SyncProvider('localhost:9999', 'room', new Y.Doc(), {
      encryptionKey: {}, encrypt: fakeEncrypt, decrypt: fakeDecrypt,
    });
    let fired = false;
    const handler = () => { fired = true; };
    window.addEventListener('room-access-mismatch', handler);
    await provider._onMessage({ data: probeFrame(true) });
    window.removeEventListener('room-access-mismatch', handler);
    provider.destroy();
    expect(fired).toBe(false);
  });

  it('an encrypted client echoes its probe when it sees an enc:false probe', async () => {
    const provider = new SyncProvider('localhost:9999', 'room', new Y.Doc(), {
      encryptionKey: {}, encrypt: fakeEncrypt, decrypt: fakeDecrypt,
    });
    CapturingWS.last.sent.length = 0; // ignore connect-time frames
    await provider._onMessage({ data: probeFrame(false) });
    const echoed = CapturingWS.last.sent.find(f => f[0] === MSG.PRESENCE_PROBE);
    provider.destroy();
    expect(echoed).toBeDefined();
  });
});

describe('SyncProvider awareness encryption', () => {
  let prevWS;
  beforeEach(() => { prevWS = globalThis.WebSocket; globalThis.WebSocket = CapturingWS; });
  afterEach(() => { globalThis.WebSocket = prevWS; });

  it('encrypts AWARENESS frames in a capability room', async () => {
    const provider = new SyncProvider('localhost:9999', 'room', new Y.Doc(), {
      encryptionKey: {}, encrypt: fakeEncrypt, decrypt: fakeDecrypt,
    });
    await provider.send(MSG.AWARENESS, new Uint8Array([1, 2, 3]));
    const frame = CapturingWS.last.sent.at(-1);
    provider.destroy();
    expect(frame[0]).toBe(MSG.AWARENESS); // type byte preserved
    expect(frame[1]).toBe(0xEE);          // payload was encrypted
  });

  it('does NOT encrypt PRESENCE_PROBE even in a capability room', async () => {
    const provider = new SyncProvider('localhost:9999', 'room', new Y.Doc(), {
      encryptionKey: {}, encrypt: fakeEncrypt, decrypt: fakeDecrypt,
    });
    await provider.send(MSG.PRESENCE_PROBE, new Uint8Array([7]));
    const frame = CapturingWS.last.sent.at(-1);
    provider.destroy();
    expect(frame[0]).toBe(MSG.PRESENCE_PROBE);
    expect(frame[1]).toBe(7); // raw, not encrypted
  });

  it('leaves AWARENESS plaintext in an open (passwordless) room', async () => {
    const provider = new SyncProvider('localhost:9999', 'room', new Y.Doc(), {}); // no key
    await provider.send(MSG.AWARENESS, new Uint8Array([1, 2, 3]));
    const frame = CapturingWS.last.sent.at(-1);
    provider.destroy();
    expect(frame[0]).toBe(MSG.AWARENESS);
    expect(frame[1]).toBe(1); // raw
  });
});
