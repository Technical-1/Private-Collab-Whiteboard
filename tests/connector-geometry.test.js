import { describe, it, expect } from 'vitest';
import { resolveAnchor, nearestAnchors, isDangling } from '../js/connector-geometry.js';

const bbox = { x: 0, y: 0, width: 10, height: 20 };

describe('resolveAnchor', () => {
  it('center', () => expect(resolveAnchor(bbox, 'c')).toEqual({ x: 5, y: 10 }));
  it('north = top-mid', () => expect(resolveAnchor(bbox, 'n')).toEqual({ x: 5, y: 0 }));
  it('south = bottom-mid', () => expect(resolveAnchor(bbox, 's')).toEqual({ x: 5, y: 20 }));
  it('east = right-mid', () => expect(resolveAnchor(bbox, 'e')).toEqual({ x: 10, y: 10 }));
  it('west = left-mid', () => expect(resolveAnchor(bbox, 'w')).toEqual({ x: 0, y: 10 }));
  it('unknown falls back to center', () => expect(resolveAnchor(bbox, 'z')).toEqual({ x: 5, y: 10 }));
});

describe('nearestAnchors', () => {
  it('B to the right of A -> A.e / B.w', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 100, y: 0, width: 10, height: 10 };
    expect(nearestAnchors(a, b)).toEqual({ from: 'e', to: 'w' });
  });
  it('B below A -> A.s / B.n', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 0, y: 100, width: 10, height: 10 };
    expect(nearestAnchors(a, b)).toEqual({ from: 's', to: 'n' });
  });
  it('B to the left of A -> A.w / B.e', () => {
    const a = { x: 100, y: 0, width: 10, height: 10 };
    const b = { x: 0, y: 0, width: 10, height: 10 };
    expect(nearestAnchors(a, b)).toEqual({ from: 'w', to: 'e' });
  });
  it('B above A -> A.n / B.s', () => {
    const a = { x: 0, y: 100, width: 10, height: 10 };
    const b = { x: 0, y: 0, width: 10, height: 10 };
    expect(nearestAnchors(a, b)).toEqual({ from: 'n', to: 's' });
  });
  it('exact diagonal tie favors horizontal (e/w)', () => {
    const a = { x: 0, y: 0, width: 10, height: 10 };
    const b = { x: 50, y: 50, width: 10, height: 10 }; // |dx| === |dy|
    expect(nearestAnchors(a, b)).toEqual({ from: 'e', to: 'w' });
  });
});

describe('isDangling', () => {
  const ids = new Set(['a', 'b', 'c']);
  it('false when both endpoints exist', () => {
    expect(isDangling({ fromId: 'a', toId: 'b' }, ids)).toBe(false);
  });
  it('true when either endpoint is missing', () => {
    expect(isDangling({ fromId: 'a', toId: 'x' }, ids)).toBe(true);
    expect(isDangling({ fromId: 'x', toId: 'b' }, ids)).toBe(true);
  });
  it('true when an endpoint key is absent entirely', () => {
    expect(isDangling({ toId: 'b' }, ids)).toBe(true);      // no fromId
    expect(isDangling({ fromId: 'a' }, ids)).toBe(true);    // no toId
  });
});
