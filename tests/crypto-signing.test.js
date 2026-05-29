import { describe, it, expect } from 'vitest';
import {
  generateSigningKeyPair,
  exportPublicKey, exportPrivateKey,
  importPublicKey, importPrivateKey,
  signData, verifyData,
} from '../js/crypto.js';

const enc = new TextEncoder();

describe('Ed25519 primitives', () => {
  it('signs and verifies a round trip', async () => {
    const kp = await generateSigningKeyPair();
    const data = enc.encode('hello');
    const sig = await signData(kp.privateKey, data);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
    expect(await verifyData(kp.publicKey, data, sig)).toBe(true);
  });

  it('rejects tampered data', async () => {
    const kp = await generateSigningKeyPair();
    const sig = await signData(kp.privateKey, enc.encode('hello'));
    expect(await verifyData(kp.publicKey, enc.encode('hellp'), sig)).toBe(false);
  });

  it('rejects a wrong key', async () => {
    const a = await generateSigningKeyPair();
    const b = await generateSigningKeyPair();
    const sig = await signData(a.privateKey, enc.encode('hello'));
    expect(await verifyData(b.publicKey, enc.encode('hello'), sig)).toBe(false);
  });

  it('export/import round trips and still verifies', async () => {
    const kp = await generateSigningKeyPair();
    const pkB64 = await exportPublicKey(kp.publicKey);
    const skB64 = await exportPrivateKey(kp.privateKey);
    expect(typeof pkB64).toBe('string');
    expect(typeof skB64).toBe('string');

    const pub = await importPublicKey(pkB64);
    const priv = await importPrivateKey(skB64);
    const data = enc.encode('roundtrip');
    const sig = await signData(priv, data);
    expect(await verifyData(pub, data, sig)).toBe(true);
  });

  it('returns false (no throw) for a structurally invalid signature', async () => {
    const kp = await generateSigningKeyPair();
    const data = enc.encode('hello');
    expect(await verifyData(kp.publicKey, data, new Uint8Array(0))).toBe(false);
    expect(await verifyData(kp.publicKey, data, new Uint8Array(10))).toBe(false);
  });
});
