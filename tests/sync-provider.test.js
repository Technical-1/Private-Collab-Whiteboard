import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
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
