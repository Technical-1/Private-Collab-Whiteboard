import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { SyncProvider } from './sync-provider.js';
import { SignedDocSync } from './signed-doc-sync.js';
import { deriveKey, encrypt, decrypt, importPrivateKey, importPublicKey } from './crypto.js';
import { PARTYKIT_HOST } from './config.js';
import { mintRoomCapability, encodeCapabilityHash, getCapabilityFromUrl, rotateCapability } from './room-manager.js';
import { makeSnapshotStore } from './snapshot-store.js';

/**
 * Wait for a provider to emit a sync event
 * Handles the race condition where sync might happen before listener is attached
 *
 * @param {Object} provider - Provider with synced property and event emitter
 * @param {string} eventName - Event to wait for (usually 'synced')
 * @param {number} timeout - Max time to wait in ms
 * @returns {Promise<boolean>} - True if synced, false if timed out
 */
async function waitForSync(provider, eventName, timeout = 5000) {
  // If already synced, return immediately
  if (provider.synced) {
    return true;
  }

  return new Promise((resolve) => {
    let resolved = false;

    const timeoutId = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        resolve(false);
      }
    }, timeout);

    const handler = () => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeoutId);
        resolve(true);
      }
    };

    // Attach listener
    provider.once(eventName, handler);

    // Double-check in case sync happened between initial check and listener attachment
    if (provider.synced && !resolved) {
      resolved = true;
      clearTimeout(timeoutId);
      resolve(true);
    }
  });
}

/**
 * Initialize Y.js for a room. `capability` is the parsed capability from the
 * URL (or null for an unencrypted room). Editors sign updates; everyone
 * verifies before applying via SignedDocSync.
 * @param {string} roomId
 * @param {object|null} capability
 */
export async function initializeYjs(roomId, capability = null) {
  const ydoc = new Y.Doc();
  const boards = ydoc.getMap('boards');

  const password = capability ? capability.password : null;
  const indexeddbKey = password ? `whiteboard-encrypted-${roomId}` : `whiteboard-${roomId}`;
  const indexeddbProvider = new IndexeddbPersistence(indexeddbKey, ydoc);

  let encryptionKey = null, encryptFn = null, decryptFn = null;
  if (password) {
    // Use the iteration count carried in the capability so all peers agree.
    encryptionKey = await deriveKey(password, roomId, capability.kdf);
    encryptFn = encrypt; decryptFn = decrypt;
  }

  // Transport (relay + AES + awareness). No document sync here anymore.
  const provider = new SyncProvider(PARTYKIT_HOST, roomId, ydoc, {
    encryptionKey, encrypt: encryptFn, decrypt: decryptFn,
    onStatus: ({ status }) => dispatchConnectionStatus(
      status === 'connected' || status === 'synced',
      status === 'synced',
      status === 'decryption-failed',
    ),
  });

  await waitForSync(indexeddbProvider, 'synced', 5000);

  // Doc sync layer. Capability rooms run SIGNED (view-only enforced); password-
  // less rooms run OPEN/unsigned (everyone can edit), matching the app's original
  // password-free room behavior.
  let signedSync;
  if (capability) {
    if (boards.size === 0) await migrateUnencryptedData(roomId, ydoc);
    signedSync = new SignedDocSync(ydoc, provider, {
      signed: true,
      epoch: capability.epoch,
      store: makeSnapshotStore(roomId, capability.epoch),
      isEditor: capability.role === 'owner' || capability.role === 'edit',
      isOwner: capability.role === 'owner',
      editorSignKey: capability.skE ? await importPrivateKey(capability.skE) : null,
      editorVerifyKey: await importPublicKey(capability.pkE),
      editorPubB64: capability.pkE,
      ownerVerifyKey: await importPublicKey(capability.pkO),
      ownerSignKey: capability.skO ? await importPrivateKey(capability.skO) : null,
      ownerPubB64: capability.pkO,
      cert: capability.cert,
    });
  } else {
    signedSync = new SignedDocSync(ydoc, provider, {
      signed: false, epoch: 0, store: makeSnapshotStore(roomId, 0), isEditor: true, isOwner: false,
    });
  }
  // Surface owner rotation to the app so it can prompt for a new link.
  signedSync.onRotated = () => window.dispatchEvent(new CustomEvent('room-rotated'));
  await signedSync.start();

  // NOTE: we intentionally do NOT eagerly create the 'default' board here.
  // Each client doing `boards.set('default', new Y.Array())` independently
  // creates a Y.Map conflict whose winner is decided by random clientID, which
  // can orphan the content-bearing array (drawings vanish / don't sync). The
  // default board is created lazily on the first write instead (see drawing.js
  // addDrawing), so a joiner receives the editor's array via snapshot and never
  // conflicts.

  return {
    ydoc, boards, provider, indexeddbProvider, signedSync,
    awareness: provider.awareness,
    isEncrypted: !!password,
    role: capability ? capability.role : 'edit',
    destroy: () => {
      if (signedSync) signedSync.destroy();
      provider.destroy(); indexeddbProvider.destroy(); ydoc.destroy();
    },
  };
}

/**
 * One-time migration: copy drawings from the unencrypted IndexedDB store into
 * the (currently empty) encrypted doc, so enabling encryption on an existing
 * room doesn't orphan prior content. CRDT-merges the legacy state; the editor
 * then signs it into snapshots. The legacy store is left intact as a backup.
 * @param {string} roomId
 * @param {Y.Doc} ydoc - the encrypted room's document
 */
async function migrateUnencryptedData(roomId, ydoc) {
  const legacyKey = `whiteboard-${roomId}`;
  const tempDoc = new Y.Doc();
  const tempProvider = new IndexeddbPersistence(legacyKey, tempDoc);
  try {
    await waitForSync(tempProvider, 'synced', 5000);
    const legacyBoards = tempDoc.getMap('boards');
    if (legacyBoards.size > 0) {
      Y.applyUpdate(ydoc, Y.encodeStateAsUpdate(tempDoc));
    }
  } catch (e) {
    console.warn('Encryption data migration failed:', e);
  } finally {
    tempProvider.destroy();
    tempDoc.destroy();
  }
}

/**
 * Dispatch connection status event
 */
function dispatchConnectionStatus(connected, synced, decryptionFailed) {
  window.dispatchEvent(new CustomEvent('yjs-status', {
    detail: { connected, synced, decryptionFailed }
  }));
}

/**
 * Owner-only room rotation. Mints a new epoch (same owner key, new editor key +
 * password + cert), broadcasts an owner-signed notice so current peers supersede,
 * then reloads the owner into the new epoch link to re-share out-of-band.
 */
export async function rotateRoom(roomId, newPassword, signedSync) {
  const current = getCapabilityFromUrl();
  if (!current || current.role !== 'owner') return; // only the owner can rotate
  const next = await rotateCapability(current, newPassword);
  if (signedSync) await signedSync.broadcastRotate(next.epoch); // tell current peers
  await new Promise((r) => setTimeout(r, 250)); // let the notice flush over the socket
  window.location.href = `${window.location.origin}/room/${roomId}#${encodeCapabilityHash(next, 'owner')}`;
  window.location.reload();
}
