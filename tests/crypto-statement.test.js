import { describe, it, expect } from 'vitest';
import { generateSigningKeyPair, signStatement, verifyStatement } from '../js/crypto.js';

describe('signStatement / verifyStatement', () => {
  it('round-trips and is key-order independent', async () => {
    const kp = await generateSigningKeyPair();
    const sig = await signStatement(kp.privateKey, { room: 'R', epoch: 1, editorPub: 'E' });
    expect(await verifyStatement(kp.publicKey, { editorPub: 'E', epoch: 1, room: 'R' }, sig)).toBe(true);
  });

  it('fails on tampered value', async () => {
    const kp = await generateSigningKeyPair();
    const sig = await signStatement(kp.privateKey, { room: 'R', epoch: 1, editorPub: 'E' });
    expect(await verifyStatement(kp.publicKey, { room: 'R', epoch: 2, editorPub: 'E' }, sig)).toBe(false);
  });

  it('fails on wrong key', async () => {
    const a = await generateSigningKeyPair();
    const b = await generateSigningKeyPair();
    const sig = await signStatement(a.privateKey, { x: 1 });
    expect(await verifyStatement(b.publicKey, { x: 1 }, sig)).toBe(false);
  });
});
