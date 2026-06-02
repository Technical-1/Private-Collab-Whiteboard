import { describe, it, expect } from 'vitest';
import { resolveAnchor, nearestAnchors, isDangling, danglingConnectorIndices, edgeAnchorPoints } from '../js/connector-geometry.js';

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

describe('danglingConnectorIndices', () => {
  it('returns indices of connectors with a missing endpoint, descending', () => {
    const items = [
      { id: 'a', tool: 'rect' },
      { id: 'c1', tool: 'connector', fromId: 'a', toId: 'gone' }, // dangling
      { id: 'b', tool: 'rect' },
      { id: 'c2', tool: 'connector', fromId: 'a', toId: 'b' },    // healthy
      { id: 'c3', tool: 'connector', fromId: 'x', toId: 'b' },    // dangling
    ];
    expect(danglingConnectorIndices(items)).toEqual([4, 1]); // descending order
  });
  it('returns [] when all connectors are healthy and ignores non-connectors', () => {
    const items = [
      { id: 'a', tool: 'rect' },
      { id: 'b', tool: 'circle' },
      { id: 'c', tool: 'connector', fromId: 'a', toId: 'b' },
    ];
    expect(danglingConnectorIndices(items)).toEqual([]);
  });
});

describe('edgeAnchorPoints', () => {
  it('returns the four edge midpoints of a bbox', () => {
    const pts = edgeAnchorPoints({ x: 0, y: 0, width: 10, height: 20 });
    expect(pts).toEqual([
      { x: 5, y: 0 },   // n
      { x: 10, y: 10 }, // e
      { x: 5, y: 20 },  // s
      { x: 0, y: 10 },  // w
    ]);
  });
});
