import { describe, it, expect } from 'vitest';
import { generateSigningKeyPair, exportPublicKey, exportPrivateKey } from '../js/crypto.js';
import { mintCert, verifyCert } from '../js/room-cert.js';

async function keys() {
  const kp = await generateSigningKeyPair();
  return { pk: await exportPublicKey(kp.publicKey), sk: await exportPrivateKey(kp.privateKey) };
}

describe('epoch certificate', () => {
  it('mints a cert the owner key verifies', async () => {
    const owner = await keys();
    const editor = await keys();
    const cert = await mintCert(owner.sk, owner.pk, 1, editor.pk);
    const out = await verifyCert(owner.pk, cert);
    expect(out).toEqual({ epoch: 1, editorPub: editor.pk });
  });

  it('rejects a cert signed by a non-owner key (the boundary)', async () => {
    const owner = await keys();
    const attacker = await keys();
    const editor = await keys();
    const forged = await mintCert(attacker.sk, owner.pk, 2, editor.pk);
    expect(await verifyCert(owner.pk, forged)).toBeNull();
  });

  it('rejects a tampered epoch/editorPub', async () => {
    const owner = await keys();
    const editor = await keys();
    const cert = await mintCert(owner.sk, owner.pk, 1, editor.pk);
    expect(await verifyCert(owner.pk, { ...cert, e: 9 })).toBeNull();
    expect(await verifyCert(owner.pk, { ...cert, ep: 'OTHER' })).toBeNull();
  });

  it('returns null for malformed input', async () => {
    const owner = await keys();
    expect(await verifyCert(owner.pk, null)).toBeNull();
    expect(await verifyCert(owner.pk, { e: 1 })).toBeNull();
  });
});
