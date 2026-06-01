import { describe, it, expect, beforeAll } from 'vitest';
import { initializeAwareness, updateLaser, clearLaser, getRemoteLasers } from '../js/awareness.js';

// The test environment (Node) has no usable localStorage; stub it so
// initializeAwareness can call generateUserId() without throwing.
beforeAll(() => {
  if (typeof localStorage?.getItem !== 'function') {
    const store = {};
    globalThis.localStorage = {
      getItem: k => store[k] ?? null,
      setItem: (k, v) => { store[k] = String(v); },
      removeItem: k => { delete store[k]; },
    };
  }
});

function fakeAwareness() {
  let local = {};
  const states = new Map();
  return {
    clientID: 1,
    setLocalState(s) { local = s; states.set(1, s); },
    getLocalState() { return local; },
    getStates() { return states; },
    on() {},
    _setRemote(id, state) { states.set(id, state); },
  };
}

describe('laser awareness', () => {
  it('updateLaser writes points to local state; clearLaser nulls them', () => {
    const aw = fakeAwareness();
    initializeAwareness(aw, 'Tester');
    updateLaser([{ x: 1, y: 2, t: 100 }]);
    expect(aw.getLocalState().user.laser).toEqual([{ x: 1, y: 2, t: 100 }]);
    clearLaser();
    expect(aw.getLocalState().user.laser).toBeNull();
  });

  it('getRemoteLasers excludes the local client and entries without laser', () => {
    const aw = fakeAwareness();
    initializeAwareness(aw, 'Tester');
    aw._setRemote(2, { user: { id: 'u2', color: '#f00', laser: [{ x: 5, y: 5, t: 1 }] } });
    aw._setRemote(3, { user: { id: 'u3', color: '#0f0', laser: null } });
    aw._setRemote(4, { user: { id: 'u4', color: '#00f', laser: [] } }); // empty trail excluded
    const lasers = getRemoteLasers();
    expect(lasers).toHaveLength(1);
    expect(lasers[0]).toMatchObject({ color: '#f00' });
    expect(lasers[0].points).toEqual([{ x: 5, y: 5, t: 1 }]);
  });
});
