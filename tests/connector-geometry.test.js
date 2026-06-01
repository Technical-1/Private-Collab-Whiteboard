import { describe, it, expect } from 'vitest';
import { resolveAnchor } from '../js/connector-geometry.js';

const bbox = { x: 0, y: 0, width: 10, height: 20 };

describe('resolveAnchor', () => {
  it('center', () => expect(resolveAnchor(bbox, 'c')).toEqual({ x: 5, y: 10 }));
  it('north = top-mid', () => expect(resolveAnchor(bbox, 'n')).toEqual({ x: 5, y: 0 }));
  it('south = bottom-mid', () => expect(resolveAnchor(bbox, 's')).toEqual({ x: 5, y: 20 }));
  it('east = right-mid', () => expect(resolveAnchor(bbox, 'e')).toEqual({ x: 10, y: 10 }));
  it('west = left-mid', () => expect(resolveAnchor(bbox, 'w')).toEqual({ x: 0, y: 10 }));
  it('unknown falls back to center', () => expect(resolveAnchor(bbox, 'z')).toEqual({ x: 5, y: 10 }));
});
