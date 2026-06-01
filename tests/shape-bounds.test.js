import { describe, it, expect } from 'vitest';
import { getShapeBounds } from '../js/drawing.js';

describe('getShapeBounds — Phase 1 shapes', () => {
  it('arrow bounds = segment bbox', () => {
    const b = getShapeBounds({ tool: 'arrow', startX: 2, startY: 4, x: 10, y: 1 });
    expect(b).toMatchObject({ x: 2, y: 1, width: 8, height: 3 });
  });
  it('diamond bounds = bbox', () => {
    const b = getShapeBounds({ tool: 'diamond', startX: 0, startY: 0, width: 10, height: 6 });
    expect(b).toMatchObject({ x: 0, y: 0, width: 10, height: 6 });
  });
  it('triangle bounds = bbox', () => {
    const b = getShapeBounds({ tool: 'triangle', startX: 1, startY: 1, width: 4, height: 8 });
    expect(b).toMatchObject({ x: 1, y: 1, width: 4, height: 8 });
  });
  it('ellipse bounds = bbox', () => {
    const b = getShapeBounds({ tool: 'ellipse', startX: 0, startY: 0, width: 20, height: 10 });
    expect(b).toMatchObject({ x: 0, y: 0, width: 20, height: 10 });
  });
});
