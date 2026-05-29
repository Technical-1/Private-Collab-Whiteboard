import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  generateSigningKeyPair, exportPublicKey, exportPrivateKey, importPrivateKey, importPublicKey,
} from '../js/crypto.js';
import { SignedDocSync } from '../js/signed-doc-sync.js';

function memStore() {
  let v = null;
  return { async load() { return v; }, async save(bytes) { v = bytes; } };
}
const noopTransport = () => ({ send() {}, onMessage: null });

describe('snapshot cache persistence', () => {
  it('loads a persisted snapshot on start and applies it', async () => {
    const kp = await generateSigningKeyPair();
    const pkB64 = await exportPublicKey(kp.publicKey);
    const skB64 = await exportPrivateKey(kp.privateKey);

    // Editor builds a snapshot payload and we capture it into a store.
    const store = memStore();
    const docE = new Y.Doc();
    const editor = new SignedDocSync(docE, noopTransport(), { role: 'edit', epoch: 1 }, await importPrivateKey(skB64), await importPublicKey(pkB64), store);
    docE.getMap('boards').set('k', 'v');
    await editor._flush();
    await editor.emitSnapshot();        // saves to store
    await editor._flush();

    // A fresh viewer with the same store loads it on start().
    const docV = new Y.Doc();
    const viewer = new SignedDocSync(docV, noopTransport(), { role: 'view', epoch: 1 }, null, await importPublicKey(pkB64), store);
    await viewer.start();
    await viewer._drain();
    expect(docV.getMap('boards').get('k')).toBe('v');
  });
});
