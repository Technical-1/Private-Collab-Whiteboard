import { describe, it, expect } from 'vitest';
import { generateSigningKeyPair } from '../js/crypto.js';
import {
  MSG, encodeEnvelope, decodeEnvelope, signUpdate, verifyUpdate,
} from '../js/protocol.js';
import { encodeRotateNotice, decodeRotateNotice } from '../js/protocol.js';

describe('protocol message types', () => {
  it('exposes stable numeric constants', () => {
    expect(MSG.UPDATE).toBe(0);
    expect(MSG.SNAPSHOT).toBe(1);
    expect(MSG.SNAPSHOT_REQUEST).toBe(2);
    expect(MSG.AWARENESS).toBe(3);
  });
});

describe('envelope codec', () => {
  it('round trips update + epoch + sig', () => {
    const update = new Uint8Array([1, 2, 3, 4]);
    const sig = new Uint8Array(64).fill(7);
    const bytes = encodeEnvelope(update, 5, sig);
    const out = decodeEnvelope(bytes);
    expect(out.epoch).toBe(5);
    expect(Array.from(out.update)).toEqual([1, 2, 3, 4]);
    expect(Array.from(out.sig)).toEqual(Array(64).fill(7));
  });
});

describe('signUpdate / verifyUpdate', () => {
  it('verifies a signed update at the matching epoch', async () => {
    const kp = await generateSigningKeyPair();
    const update = new Uint8Array([9, 8, 7]);
    const sig = await signUpdate(kp.privateKey, update, 2);
    expect(await verifyUpdate(kp.publicKey, update, 2, sig)).toBe(true);
  });

  it('fails when the epoch differs', async () => {
    const kp = await generateSigningKeyPair();
    const update = new Uint8Array([9, 8, 7]);
    const sig = await signUpdate(kp.privateKey, update, 2);
    expect(await verifyUpdate(kp.publicKey, update, 3, sig)).toBe(false);
  });
});

describe('rotate notice', () => {
  it('adds the ROTATE message type', () => {
    expect(MSG.ROTATE).toBe(4);
  });
  it('round-trips a notice + signature', () => {
    const notice = { type: 'rotate', room: 'R', from: 1, to: 2 };
    const bytes = encodeRotateNotice(notice, 'SIGB64');
    const out = decodeRotateNotice(bytes);
    expect(out.notice).toEqual(notice);
    expect(out.sig).toBe('SIGB64');
  });
});

describe('MSG enum', () => {
  it('defines a distinct PRESENCE_PROBE type that does not collide', () => {
    expect(MSG.PRESENCE_PROBE).toBe(5);
    const values = Object.values(MSG);
    expect(new Set(values).size).toBe(values.length); // all distinct
  });
});
