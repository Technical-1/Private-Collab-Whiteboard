import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import { importPrivateKey, importPublicKey } from '../js/crypto.js';
import { SignedDocSync } from '../js/signed-doc-sync.js';
import { mintRoomCapability } from '../js/room-manager.js';

function memStore() {
  let v = null;
  return { async load() { return v; }, async save(bytes) { v = bytes; } };
}
const noopTransport = () => ({ send() {}, onMessage: null });

describe('snapshot cache persistence', () => {
  it('loads a persisted snapshot on start and applies it', async () => {
    const cap = await mintRoomCapability('pw');

    // Editor builds a snapshot payload and we capture it into a store.
    const store = memStore();
    const docE = new Y.Doc();
    const editor = new SignedDocSync(docE, noopTransport(), {
      signed: true,
      epoch: cap.epoch,
      isEditor: true,
      isOwner: true,
      editorSignKey: await importPrivateKey(cap.skE),
      editorVerifyKey: await importPublicKey(cap.pkE),
      editorPubB64: cap.pkE,
      ownerVerifyKey: await importPublicKey(cap.pkO),
      ownerSignKey: await importPrivateKey(cap.skO),
      ownerPubB64: cap.pkO,
      cert: cap.cert,
      store,
    });
    await editor.start();
    docE.getMap('boards').set('k', 'v');
    await editor._flush();
    await editor.emitSnapshot();        // saves to store
    await editor._flush();

    // A fresh viewer with the same store loads it on start().
    const docV = new Y.Doc();
    const viewer = new SignedDocSync(docV, noopTransport(), {
      signed: true,
      epoch: cap.epoch,
      isEditor: false,
      isOwner: false,
      editorSignKey: null,
      editorVerifyKey: await importPublicKey(cap.pkE),
      editorPubB64: cap.pkE,
      ownerVerifyKey: await importPublicKey(cap.pkO),
      ownerSignKey: null,
      ownerPubB64: cap.pkO,
      cert: cap.cert,
      store,
    });
    await viewer.start();
    await viewer._drain();
    expect(docV.getMap('boards').get('k')).toBe('v');
  });
});

function spyTransport() {
  const sent = [];
  return { sent, send(type, payload) { sent.push({ type, payload }); }, onMessage: null };
}

describe('_answerSnapshotRequest superseded guard', () => {
  async function makeViewer(transport) {
    const cap = await mintRoomCapability('pw');
    const v = new SignedDocSync(new Y.Doc(), transport, {
      signed: true, epoch: cap.epoch, isEditor: false, isOwner: false,
      editorSignKey: null,
      editorVerifyKey: await importPublicKey(cap.pkE), editorPubB64: cap.pkE,
      ownerVerifyKey: await importPublicKey(cap.pkO), ownerSignKey: null,
      ownerPubB64: cap.pkO, cert: cap.cert,
    });
    v._latestSnapshot = { payload: new Uint8Array([1, 2, 3]) };
    return v;
  }

  it('relays the cached snapshot when not superseded', async () => {
    const t = spyTransport();
    const v = await makeViewer(t);
    await v._answerSnapshotRequest();
    expect(t.sent.length).toBe(1);
  });

  it('does NOT relay after the room has rotated (superseded)', async () => {
    const t = spyTransport();
    const v = await makeViewer(t);
    v._superseded = true;
    await v._answerSnapshotRequest();
    expect(t.sent.length).toBe(0);
  });
});
