import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  generateSigningKeyPair, exportPublicKey, exportPrivateKey, importPrivateKey, importPublicKey,
} from '../js/crypto.js';
import { SignedDocSync } from '../js/signed-doc-sync.js';
import { MSG, encodeEnvelope, signUpdate } from '../js/protocol.js';

// Capture the Y.Doc update bytes produced by a single mutation.
function captureUpdate(mutate) {
  const doc = new Y.Doc();
  let update;
  doc.once('update', (u) => { update = u; });
  mutate(doc);
  return update;
}

// A synchronous in-memory relay: send(type,payload) fans out to all *other* peers' _receive.
function makeRelay() {
  const peers = [];
  return {
    attach(peer) { peers.push(peer); },
    transportFor(self) {
      return {
        send: (type, payload) => {
          for (const p of peers) if (p.self !== self) p.onMessage(type, payload);
        },
        onMessage: null,
      };
    },
  };
}

async function editorCap() {
  const kp = await generateSigningKeyPair();
  return {
    role: 'edit', epoch: 1,
    publicKeyB64: await exportPublicKey(kp.publicKey),
    privateKeyB64: await exportPrivateKey(kp.privateKey),
  };
}
function viewerCapFrom(cap) {
  return { role: 'view', epoch: cap.epoch, publicKeyB64: cap.publicKeyB64, privateKeyB64: null };
}

describe('SignedDocSync verify-before-apply', () => {
  it('applies an editor-signed update on a peer', async () => {
    const cap = await editorCap();
    const relay = makeRelay();

    const docA = new Y.Doc(), docB = new Y.Doc();
    const a = new SignedDocSync(docA, relay.transportFor('A'), cap, await importPrivateKey(cap.privateKeyB64), await importPublicKey(cap.publicKeyB64));
    const b = new SignedDocSync(docB, relay.transportFor('B'), viewerCapFrom(cap), null, await importPublicKey(cap.publicKeyB64));
    a.self = 'A'; b.self = 'B';
    relay.attach({ self: 'A', onMessage: (t, p) => a._receive(t, p) });
    relay.attach({ self: 'B', onMessage: (t, p) => b._receive(t, p) });
    await a.start(); await b.start();

    docA.getMap('boards').set('x', 1);
    await a._flush(); // ensure async sign+send completed
    await b._drain();

    expect(docB.getMap('boards').get('x')).toBe(1);
  });

  it('drops an unsigned/forged update from a viewer', async () => {
    const cap = await editorCap();
    const relay = makeRelay();
    const docA = new Y.Doc(), docV = new Y.Doc();
    const editor = new SignedDocSync(docA, relay.transportFor('A'), cap, await importPrivateKey(cap.privateKeyB64), await importPublicKey(cap.publicKeyB64));
    const viewer = new SignedDocSync(docV, relay.transportFor('V'), viewerCapFrom(cap), null, await importPublicKey(cap.publicKeyB64));
    editor.self = 'A'; viewer.self = 'V';
    relay.attach({ self: 'A', onMessage: (t, p) => editor._receive(t, p) });
    relay.attach({ self: 'V', onMessage: (t, p) => viewer._receive(t, p) });
    await editor.start(); await viewer.start();

    // Viewer mutates its own doc and tries to broadcast — must NOT appear on editor.
    docV.getMap('boards').set('evil', 1);
    await viewer._flush();
    await editor._drain();

    expect(docA.getMap('boards').get('evil')).toBeUndefined();
  });

  // The real hostile-viewer threat: a modified client that bypasses the UI and
  // injects a forged UPDATE straight onto the wire. The receive-side guard
  // (_applySigned -> verifyUpdate) must reject it.
  it('drops an UPDATE signed by a wrong keypair injected via the transport', async () => {
    const cap = await editorCap();
    const attacker = await generateSigningKeyPair();

    const update = captureUpdate((d) => d.getMap('boards').set('evil', 99));
    const forgedSig = await signUpdate(attacker.privateKey, update, cap.epoch);
    const forgedPayload = encodeEnvelope(update, cap.epoch, forgedSig);

    const editorDoc = new Y.Doc();
    const editor = new SignedDocSync(
      editorDoc, { send: () => {}, onMessage: null }, cap,
      await importPrivateKey(cap.privateKeyB64), await importPublicKey(cap.publicKeyB64),
    );

    editor._receive(MSG.UPDATE, forgedPayload);
    await editor._drain();
    expect(editorDoc.getMap('boards').get('evil')).toBeUndefined();
  });

  it('drops an UPDATE with a random garbage signature injected via the transport', async () => {
    const cap = await editorCap();
    const update = captureUpdate((d) => d.getMap('boards').set('evil', 99));
    const garbage = encodeEnvelope(update, cap.epoch, crypto.getRandomValues(new Uint8Array(64)));

    const docV = new Y.Doc();
    const viewer = new SignedDocSync(
      docV, { send: () => {}, onMessage: null }, viewerCapFrom(cap),
      null, await importPublicKey(cap.publicKeyB64),
    );

    viewer._receive(MSG.UPDATE, garbage);
    await viewer._drain();
    expect(docV.getMap('boards').get('evil')).toBeUndefined();
  });
});

describe('SignedDocSync snapshot bootstrap', () => {
  it('a late joiner reconstructs state from a relayed snapshot', async () => {
    const cap = await editorCap();
    const relay = makeRelay();
    const docA = new Y.Doc();
    const editor = new SignedDocSync(docA, relay.transportFor('A'), cap, await importPrivateKey(cap.privateKeyB64), await importPublicKey(cap.publicKeyB64));
    editor.self = 'A';
    relay.attach({ self: 'A', onMessage: (t, p) => editor._receive(t, p) });
    await editor.start();
    docA.getMap('boards').set('hello', 'world');
    await editor._flush();
    await editor.emitSnapshot();   // editor publishes a signed snapshot
    await editor._flush();

    // New joiner appears later.
    const docC = new Y.Doc();
    const joiner = new SignedDocSync(docC, relay.transportFor('C'), { role: 'view', epoch: cap.epoch }, null, await importPublicKey(cap.publicKeyB64));
    joiner.self = 'C';
    relay.attach({ self: 'C', onMessage: (t, p) => joiner._receive(t, p) });
    await joiner.start();          // sends SNAPSHOT_REQUEST
    await editor._drain(); await joiner._drain();

    expect(docC.getMap('boards').get('hello')).toBe('world');
  });
});

describe('connect bootstrap', () => {
  it('re-sends SNAPSHOT_REQUEST when the transport (re)connects', async () => {
    const cap = await editorCap();
    const sent = [];
    const transport = { send: (t) => sent.push(t), onMessage: null, onConnect: null };
    const sync = new SignedDocSync(
      new Y.Doc(), transport, viewerCapFrom(cap), null, await importPublicKey(cap.publicKeyB64),
    );
    await sync.start();
    const before = sent.filter((t) => t === MSG.SNAPSHOT_REQUEST).length;

    transport.onConnect(); // simulate the socket opening
    const after = sent.filter((t) => t === MSG.SNAPSHOT_REQUEST).length;
    expect(after).toBe(before + 1);
  });
});

describe('epoch lockout', () => {
  it('rejects an update signed at a different epoch (rotation lockout)', async () => {
    const cap = await editorCap();              // epoch 1
    const relay = makeRelay();
    const docA = new Y.Doc(), docB = new Y.Doc();
    // Editor signs at epoch 1; the receiver has rotated to epoch 2.
    const editor = new SignedDocSync(docA, relay.transportFor('A'), cap, await importPrivateKey(cap.privateKeyB64), await importPublicKey(cap.publicKeyB64));
    const rotated = new SignedDocSync(docB, relay.transportFor('B'), { role: 'view', epoch: 2 }, null, await importPublicKey(cap.publicKeyB64));
    editor.self = 'A'; rotated.self = 'B';
    relay.attach({ self: 'A', onMessage: (t, p) => editor._receive(t, p) });
    relay.attach({ self: 'B', onMessage: (t, p) => rotated._receive(t, p) });
    await editor.start(); await rotated.start();

    docA.getMap('boards').set('stale', 1);
    await editor._flush(); await rotated._drain();
    expect(docB.getMap('boards').get('stale')).toBeUndefined();
  });
});
