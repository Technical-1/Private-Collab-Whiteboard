/**
 * localStorage-backed cache for the latest signed snapshot, keyed by room+epoch.
 * This is only a relay-bootstrap cache; the primary doc store stays in IndexedDB
 * (y-indexeddb). Snapshots from superseded epochs are pruned so rotated rooms
 * don't leak blobs into localStorage indefinitely.
 */

const KEY_PREFIX = 'wb-snap-';
const snapshotKey = (roomId, epoch) => `${KEY_PREFIX}${roomId}-e${epoch}`;

/**
 * Remove this room's snapshot keys from every epoch except `currentEpoch`.
 * Pure over the passed Storage-like object so it is unit-testable without a
 * browser. Returns the list of removed keys.
 * @param {Storage} storage
 * @param {string} roomId
 * @param {number} currentEpoch
 * @returns {string[]}
 */
export function pruneOldSnapshots(storage, roomId, currentEpoch) {
  const prefix = `${KEY_PREFIX}${roomId}-e`;
  const keep = snapshotKey(roomId, currentEpoch);
  const toRemove = [];
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key && key.startsWith(prefix) && key !== keep) toRemove.push(key);
  }
  toRemove.forEach((k) => storage.removeItem(k));
  return toRemove;
}

export function makeSnapshotStore(roomId, epoch) {
  const key = snapshotKey(roomId, epoch);
  // Drop snapshots from superseded epochs so rotations don't accumulate blobs.
  if (typeof localStorage !== 'undefined') {
    try { pruneOldSnapshots(localStorage, roomId, epoch); } catch { /* ignore */ }
  }
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
