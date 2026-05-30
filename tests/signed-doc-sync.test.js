import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  importPrivateKey, importPublicKey,
} from '../js/crypto.js';
import { SignedDocSync } from '../js/signed-doc-sync.js';
import { MSG, encodeEnvelope, signUpdate } from '../js/protocol.js';
import { mintRoomCapability } from '../js/room-manager.js';

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

// Build the SignedDocSync options object for a role from an owner capability.
async function opts(ownerCap, role, store = null) {
  const isOwner = role === 'owner';
  const isEditor = role === 'owner' || role === 'edit';
  return {
    signed: true,
    epoch: ownerCap.epoch,
    store,
    isEditor,
    isOwner,
    editorSignKey: isEditor ? await importPrivateKey(ownerCap.skE) : null,
    editorVerifyKey: await importPublicKey(ownerCap.pkE),
    editorPubB64: ownerCap.pkE,
    ownerVerifyKey: await importPublicKey(ownerCap.pkO),
    ownerSignKey: isOwner ? await importPrivateKey(ownerCap.skO) : null,
    ownerPubB64: ownerCap.pkO,
    cert: ownerCap.cert,
  };
}

describe('SignedDocSync verify-before-apply', () => {
  it('applies an editor-signed update on a peer', async () => {
    const cap = await mintRoomCapability('pw');
    const relay = makeRelay();

    const docA = new Y.Doc(), docB = new Y.Doc();
    const a = new SignedDocSync(docA, relay.transportFor('A'), await opts(cap, 'owner'));
    const b = new SignedDocSync(docB, relay.transportFor('B'), await opts(cap, 'view'));
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
    const cap = await mintRoomCapability('pw');
    const relay = makeRelay();
    const docA = new Y.Doc(), docV = new Y.Doc();
    const editor = new SignedDocSync(docA, relay.transportFor('A'), await opts(cap, 'owner'));
    const viewer = new SignedDocSync(docV, relay.transportFor('V'), await opts(cap, 'view'));
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
    const cap = await mintRoomCapability('pw');
    const other = await mintRoomCapability('pw');

    const update = captureUpdate((d) => d.getMap('boards').set('evil', 99));
    const forgedSig = await signUpdate(await importPrivateKey(other.skE), update, cap.epoch);
    const forgedPayload = encodeEnvelope(update, cap.epoch, forgedSig);

    const editorDoc = new Y.Doc();
    const editor = new SignedDocSync(
      editorDoc, { send: () => {}, onMessage: null }, await opts(cap, 'owner'),
    );
    await editor.start();

    editor._receive(MSG.UPDATE, forgedPayload);
    await editor._drain();
    expect(editorDoc.getMap('boards').get('evil')).toBeUndefined();
  });

  it('drops an UPDATE with a random garbage signature injected via the transport', async () => {
    const cap = await mintRoomCapability('pw');
    const update = captureUpdate((d) => d.getMap('boards').set('evil', 99));
    const garbage = encodeEnvelope(update, cap.epoch, crypto.getRandomValues(new Uint8Array(64)));

    const docV = new Y.Doc();
    const viewer = new SignedDocSync(
      docV, { send: () => {}, onMessage: null }, await opts(cap, 'view'),
    );
    await viewer.start();

    viewer._receive(MSG.UPDATE, garbage);
    await viewer._drain();
    expect(docV.getMap('boards').get('evil')).toBeUndefined();
  });
});

describe('SignedDocSync snapshot bootstrap', () => {
  it('a late joiner reconstructs state from a relayed snapshot', async () => {
    const cap = await mintRoomCapability('pw');
    const relay = makeRelay();
    const docA = new Y.Doc();
    const editor = new SignedDocSync(docA, relay.transportFor('A'), await opts(cap, 'owner'));
    editor.self = 'A';
    relay.attach({ self: 'A', onMessage: (t, p) => editor._receive(t, p) });
    await editor.start();
    docA.getMap('boards').set('hello', 'world');
    await editor._flush();
    await editor.emitSnapshot();   // editor publishes a signed snapshot
    await editor._flush();

    // New joiner appears later.
    const docC = new Y.Doc();
    const joiner = new SignedDocSync(docC, relay.transportFor('C'), await opts(cap, 'view'));
    joiner.self = 'C';
    relay.attach({ self: 'C', onMessage: (t, p) => joiner._receive(t, p) });
    await joiner.start();          // sends SNAPSHOT_REQUEST
    await editor._drain(); await joiner._drain();

    expect(docC.getMap('boards').get('hello')).toBe('world');
  });
});

describe('open (passwordless, unsigned) rooms', () => {
  it('two keyless peers sync updates both directions without signatures', async () => {
    const relay = makeRelay();
    const docA = new Y.Doc(), docB = new Y.Doc();
    const a = new SignedDocSync(docA, relay.transportFor('A'), { signed: false, epoch: 0, isEditor: true, isOwner: false });
    const b = new SignedDocSync(docB, relay.transportFor('B'), { signed: false, epoch: 0, isEditor: true, isOwner: false });
    a.self = 'A'; b.self = 'B';
    relay.attach({ self: 'A', onMessage: (t, p) => a._receive(t, p) });
    relay.attach({ self: 'B', onMessage: (t, p) => b._receive(t, p) });
    await a.start(); await b.start();

    docA.getMap('boards').set('x', 7);
    await a._flush(); await b._drain();
    expect(docB.getMap('boards').get('x')).toBe(7);

    // In an open room everyone is an editor, so B can write back to A.
    docB.getMap('boards').set('y', 8);
    await b._flush(); await a._drain();
    expect(docA.getMap('boards').get('y')).toBe(8);
  });
});

describe('connect bootstrap', () => {
  it('re-sends SNAPSHOT_REQUEST when the transport (re)connects', async () => {
    const cap = await mintRoomCapability('pw');
    const sent = [];
    const transport = { send: (t) => sent.push(t), onMessage: null, onConnect: null };
    const sync = new SignedDocSync(
      new Y.Doc(), transport, await opts(cap, 'view'),
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
    const cap = await mintRoomCapability('pw');  // epoch 1
    const relay = makeRelay();
    const docA = new Y.Doc(), docB = new Y.Doc();
    // Editor signs at epoch 1; the receiver has rotated to epoch 2.
    const editor = new SignedDocSync(docA, relay.transportFor('A'), await opts(cap, 'owner'));
    // Build a "rotated" viewer opts object at epoch 2 but same keys/cert (cert epoch will be 1, so certOk will be false for epoch 2)
    const viewOpts = await opts(cap, 'view');
    const rotatedOpts = { ...viewOpts, epoch: 2 };
    const rotated = new SignedDocSync(docB, relay.transportFor('B'), rotatedOpts);
    editor.self = 'A'; rotated.self = 'B';
    relay.attach({ self: 'A', onMessage: (t, p) => editor._receive(t, p) });
    relay.attach({ self: 'B', onMessage: (t, p) => rotated._receive(t, p) });
    await editor.start(); await rotated.start();

    docA.getMap('boards').set('stale', 1);
    await editor._flush(); await rotated._drain();
    expect(docB.getMap('boards').get('stale')).toBeUndefined();
  });
});

describe('cert-gated verification', () => {
  it('rejects an update whose editor key is not the one in the cert', async () => {
    const cap = await mintRoomCapability('pw');
    const docPeer = new Y.Doc();
    const peer = new SignedDocSync(docPeer, { send() {}, onMessage: null }, await opts(cap, 'view'));
    await peer.start();
    // An update signed by a DIFFERENT (uncertified) editor key, same epoch:
    const other = await mintRoomCapability('pw');
    const upd = (() => { const d = new Y.Doc(); let u; d.once('update', x => (u = x)); d.getMap('boards').set('evil', 1); return u; })();
    const sig = await signUpdate(await importPrivateKey(other.skE), upd, cap.epoch);
    peer._receive(MSG.UPDATE, encodeEnvelope(upd, cap.epoch, sig));
    await peer._drain();
    expect(docPeer.getMap('boards').get('evil')).toBeUndefined();
  });
});
