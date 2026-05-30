import { describe, it, expect } from 'vitest';
import { mintRoomCapability, encodeCapabilityHash, decodeCapabilityToken } from '../js/room-manager.js';
import { verifyCert } from '../js/room-cert.js';

describe('v3 capability links', () => {
  it('mints an owner capability with both keys + a valid cert', async () => {
    const cap = await mintRoomCapability('pw');
    expect(cap.version).toBe(3);
    expect(cap.role).toBe('owner');
    expect(cap.epoch).toBe(1);
    expect(cap.skO && cap.skE && cap.pkO && cap.pkE).toBeTruthy();
    expect(await verifyCert(cap.pkO, cap.cert)).toEqual({ epoch: 1, editorPub: cap.pkE });
  });

  it('owner link decodes to owner role with skO', async () => {
    const cap = await mintRoomCapability('pw');
    const dec = decodeCapabilityToken(encodeCapabilityHash(cap, 'owner'));
    expect(dec.role).toBe('owner');
    expect(dec.skO).toBe(cap.skO);
    expect(dec.skE).toBe(cap.skE);
  });

  it('editor link drops skO but keeps skE', async () => {
    const cap = await mintRoomCapability('pw');
    const dec = decodeCapabilityToken(encodeCapabilityHash(cap, 'edit'));
    expect(dec.role).toBe('edit');
    expect(dec.skO).toBeNull();
    expect(dec.skE).toBe(cap.skE);
    expect(dec.pkO).toBe(cap.pkO);
    expect(dec.cert).toEqual(cap.cert);
  });

  it('viewer link drops both private keys', async () => {
    const cap = await mintRoomCapability('pw');
    const dec = decodeCapabilityToken(encodeCapabilityHash(cap, 'view'));
    expect(dec.role).toBe('view');
    expect(dec.skO).toBeNull();
    expect(dec.skE).toBeNull();
    expect(dec.pkE).toBe(cap.pkE);
  });

  it('rejects v1/v2/garbage (hard break)', () => {
    expect(decodeCapabilityToken('garbage')).toBeNull();
    expect(decodeCapabilityToken(btoa(encodeURIComponent(JSON.stringify({ v: 2, p: 'x', pk: 'y', e: 1 }))))).toBeNull();
  });
});
