import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { SyncProvider } from './sync-provider.js';
import { SignedDocSync } from './signed-doc-sync.js';
import { deriveKey, encrypt, decrypt, importPrivateKey, importPublicKey } from './crypto.js';
import { PARTYKIT_HOST } from './config.js';
import { mintRoomCapability, encodeCapabilityHash, getCapabilityFromUrl } from './room-manager.js';

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
    encryptionKey = await deriveKey(password, roomId);
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

  // Signing layer (only for capability/encrypted rooms).
  let signedSync = null;
  if (capability) {
    const publicKey = await importPublicKey(capability.publicKeyB64);
    const privateKey = capability.privateKeyB64 ? await importPrivateKey(capability.privateKeyB64) : null;
    const store = makeSnapshotStore(roomId, capability.epoch);
    signedSync = new SignedDocSync(ydoc, provider, capability, privateKey, publicKey, store);
    await signedSync.start();
  }

  if (!boards.has('default')) boards.set('default', new Y.Array());

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
 * Dispatch connection status event
 */
function dispatchConnectionStatus(connected, synced, decryptionFailed) {
  window.dispatchEvent(new CustomEvent('yjs-status', {
    detail: { connected, synced, decryptionFailed }
  }));
}

/**
 * Minimal persisted store for the latest signed snapshot, keyed by room+epoch.
 * Uses localStorage (snapshots are bounded; this is only a relay cache — the
 * primary doc store remains in IndexedDB via y-indexeddb).
 */
function makeSnapshotStore(roomId, epoch) {
  const key = `wb-snap-${roomId}-e${epoch}`;
  return {
    async load() {
      const b64 = localStorage.getItem(key);
      if (!b64) return null;
      const bin = atob(b64); const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    async save(bytes) {
      let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      try { localStorage.setItem(key, btoa(bin)); } catch { /* quota - ignore */ }
    },
  };
}

/**
 * Rotate the room: new password + new Ed25519 keypair + bumped epoch.
 * Invalidates all old links. The reloaded editor emits a fresh snapshot at the
 * new epoch so new-link holders can bootstrap.
 */
export async function changePassword(roomId, newPassword) {
  const baseUrl = `${window.location.origin}/room/${roomId}`;
  if (newPassword) {
    const current = getCapabilityFromUrl();
    const nextEpoch = current ? current.epoch + 1 : 1;
    const cap = await mintRoomCapability(newPassword);
    cap.epoch = nextEpoch;
    window.location.href = `${baseUrl}#${encodeCapabilityHash(cap, 'edit')}`;
  } else {
    window.location.href = baseUrl;
  }
  window.location.reload();
}
