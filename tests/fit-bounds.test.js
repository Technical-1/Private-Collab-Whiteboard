import { describe, it, expect } from 'vitest';
import { getFitBounds } from '../js/drawing.js';

describe('getFitBounds', () => {
  it('returns null for a connector (its endpoints already bound the fit)', () => {
    expect(getFitBounds({ tool: 'connector', fromId: 'a', toId: 'b', fromAnchor: 'e', toAnchor: 'w' })).toBeNull();
  });
  it('returns null for a points-shape with no points', () => {
    expect(getFitBounds({ tool: 'freehand', points: [] })).toBeNull();
    expect(getFitBounds({ tool: 'freehand' })).toBeNull();
  });
  it('applies a min size of 1 so a zero-width shape never collapses the fit', () => {
    // a perfectly vertical line: width 0 -> clamped to 1
    const b = getFitBounds({ tool: 'line', startX: 5, startY: 0, x: 5, y: 20 });
    expect(b).toMatchObject({ x: 5, y: 0, width: 1, height: 20 });
  });
  it('delegates to getShapeBounds for a normal bbox shape', () => {
    const b = getFitBounds({ tool: 'diamond', startX: 0, startY: 0, width: 10, height: 6 });
    expect(b).toMatchObject({ x: 0, y: 0, width: 10, height: 6 });
  });
  it('returns a real bbox for a freehand shape with points', () => {
    const b = getFitBounds({ tool: 'freehand', points: [{ x: 2, y: 3 }, { x: 12, y: 9 }] });
    expect(b).toMatchObject({ x: 2, y: 3, width: 10, height: 6 });
  });
});
