import { describe, it, expect } from 'vitest';
import { generateSigningKeyPair, exportPublicKey, exportPrivateKey } from '../js/crypto.js';
import {
  encodeEditorLink, encodeViewerLink, decodeCapabilityToken,
} from '../js/room-manager.js';

async function freshKeys() {
  const kp = await generateSigningKeyPair();
  return { pk: await exportPublicKey(kp.publicKey), sk: await exportPrivateKey(kp.privateKey) };
}

describe('v2 capability links', () => {
  it('editor link decodes to an edit capability with both keys', async () => {
    const { pk, sk } = await freshKeys();
    const token = encodeEditorLink('pw', sk, pk, 1);
    const cap = decodeCapabilityToken(token);
    expect(cap.version).toBe(2);
    expect(cap.role).toBe('edit');
    expect(cap.password).toBe('pw');
    expect(cap.epoch).toBe(1);
    expect(cap.privateKeyB64).toBe(sk);
    expect(cap.publicKeyB64).toBe(pk);
  });

  it('viewer link decodes to a view capability with no private key', async () => {
    const { pk } = await freshKeys();
    const token = encodeViewerLink('pw', pk, 4);
    const cap = decodeCapabilityToken(token);
    expect(cap.role).toBe('view');
    expect(cap.epoch).toBe(4);
    expect(cap.privateKeyB64).toBeNull();
    expect(cap.publicKeyB64).toBe(pk);
  });

  it('an editor link missing sk is downgraded to view', async () => {
    const { pk } = await freshKeys();
    const token = btoa(encodeURIComponent(JSON.stringify({ v: 2, p: 'pw', r: 'edit', e: 1, pk })));
    const cap = decodeCapabilityToken(token);
    expect(cap.role).toBe('view');
    expect(cap.privateKeyB64).toBeNull();
  });

  it('returns null for legacy/garbage tokens (hard break)', () => {
    expect(decodeCapabilityToken('not-base64-json')).toBeNull();
    expect(decodeCapabilityToken(btoa(encodeURIComponent(JSON.stringify({ v: 1, p: 'x' }))))).toBeNull();
  });
});
