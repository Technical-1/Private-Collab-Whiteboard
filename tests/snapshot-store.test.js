import { describe, it, expect } from 'vitest';
import { pruneOldSnapshots } from '../js/snapshot-store.js';

// Fake Web Storage backed by a Map (supports the bits pruneOldSnapshots uses).
function fakeStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key(i) { return [...map.keys()][i] ?? null; },
    getItem(k) { return map.has(k) ? map.get(k) : null; },
    setItem(k, v) { map.set(k, v); },
    removeItem(k) { map.delete(k); },
    _keys() { return [...map.keys()]; },
  };
}

describe('pruneOldSnapshots', () => {
  it('removes other-epoch snapshot keys for the same room', () => {
    const s = fakeStorage({
      'wb-snap-room1-e1': 'a',
      'wb-snap-room1-e2': 'b',
      'wb-snap-room1-e3': 'c',
    });
    const removed = pruneOldSnapshots(s, 'room1', 3);
    expect(removed.sort()).toEqual(['wb-snap-room1-e1', 'wb-snap-room1-e2']);
    expect(s._keys()).toEqual(['wb-snap-room1-e3']);
  });

  it('keeps the current epoch key', () => {
    const s = fakeStorage({ 'wb-snap-room1-e5': 'keep' });
    pruneOldSnapshots(s, 'room1', 5);
    expect(s._keys()).toEqual(['wb-snap-room1-e5']);
  });

  it('does not touch other rooms or unrelated keys', () => {
    const s = fakeStorage({
      'wb-snap-room1-e1': 'old',
      'wb-snap-room2-e1': 'other-room',
      'whiteboard-user-id': 'uid',
      'whiteboard_history': '[]',
    });
    pruneOldSnapshots(s, 'room1', 2);
    expect(s._keys().sort()).toEqual([
      'wb-snap-room2-e1',
      'whiteboard-user-id',
      'whiteboard_history',
    ]);
  });

  it('returns an empty list when there is nothing to prune', () => {
    const s = fakeStorage({ 'wb-snap-room1-e2': 'only-current' });
    expect(pruneOldSnapshots(s, 'room1', 2)).toEqual([]);
  });
});
