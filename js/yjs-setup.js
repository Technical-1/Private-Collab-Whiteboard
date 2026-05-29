import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { SyncProvider } from './sync-provider.js';
import { deriveKey, encrypt, decrypt } from './crypto.js';
import { PARTYKIT_HOST } from './config.js';

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
 * Initialize Y.js with optional encryption
 *
 * @param {string} roomId - Room identifier
 * @param {string|null} password - Optional password for E2E encryption
 * @returns {Promise<Object>} - Y.js instance with providers
 */
export async function initializeYjs(roomId, password = null) {
  // Create Y.js document
  const ydoc = new Y.Doc();

  // Initialize shared types (DON'T create default board yet - wait for sync)
  const boards = ydoc.getMap('boards');

  // Setup IndexedDB for local persistence
  const indexeddbKey = password
    ? `whiteboard-encrypted-${roomId}`
    : `whiteboard-${roomId}`;

  const indexeddbProvider = new IndexeddbPersistence(indexeddbKey, ydoc);

  // Prepare encryption functions if password provided
  let encryptionKey = null;
  let encryptFn = null;
  let decryptFn = null;

  if (password) {
    encryptionKey = await deriveKey(password, roomId);
    encryptFn = encrypt;
    decryptFn = decrypt;
  }

  // Create sync provider (works for both encrypted and unencrypted)
  const provider = new SyncProvider(PARTYKIT_HOST, roomId, ydoc, {
    encryptionKey,
    encrypt: encryptFn,
    decrypt: decryptFn,
    onStatus: ({ status }) => {
      const connected = status === 'connected' || status === 'synced';
      const synced = status === 'synced';
      const decryptionFailed = status === 'decryption-failed';
      dispatchConnectionStatus(connected, synced, decryptionFailed);
    }
  });

  // Wait for IndexedDB to sync (load local data)
  // This is the first priority - local data should always be available
  await waitForSync(indexeddbProvider, 'synced', 5000);

  // Wait for network sync with a reasonable timeout
  // If we're the first client or offline, this will timeout and that's OK
  // The timeout prevents blocking forever when no other peers exist
  const networkSyncTimeout = 3000;
  let networkSynced = false;

  try {
    await new Promise((resolve, reject) => {
      // Check if already synced
      if (provider.synced) {
        networkSynced = true;
        resolve();
        return;
      }

      const timeoutId = setTimeout(() => {
        // Timeout is not an error - just means we're first or offline
        resolve();
      }, networkSyncTimeout);

      // Listen for sync status changes
      const statusHandler = ({ status }) => {
        if (status === 'synced') {
          networkSynced = true;
          clearTimeout(timeoutId);
          resolve();
        }
      };

      // Check synced state periodically (backup for missed events)
      const checkInterval = setInterval(() => {
        if (provider.synced) {
          networkSynced = true;
          clearInterval(checkInterval);
          clearTimeout(timeoutId);
          resolve();
        }
      }, 200);

      // Clean up interval on timeout
      setTimeout(() => clearInterval(checkInterval), networkSyncTimeout + 100);
    });
  } catch (e) {
    // Network sync failure is non-fatal
    console.warn('Network sync timed out or failed:', e);
  }

  // NOW create default board if it doesn't exist (after both syncs completed)
  // Use a transaction to ensure atomicity
  if (!boards.has('default')) {
    boards.set('default', new Y.Array());
  }

  return {
    ydoc,
    boards,
    provider,
    indexeddbProvider,
    awareness: provider.awareness,
    isEncrypted: !!password,
    destroy: () => {
      provider.destroy();
      indexeddbProvider.destroy();
      ydoc.destroy();
    }
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
 * Change room password (requires page reload)
 */
export function changePassword(roomId, newPassword) {
  const baseUrl = `${window.location.origin}/room/${roomId}`;
  if (newPassword) {
    window.location.href = `${baseUrl}#${encodeURIComponent(newPassword)}`;
  } else {
    window.location.href = baseUrl;
  }
  window.location.reload();
}
