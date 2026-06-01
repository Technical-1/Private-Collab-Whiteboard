import { describe, it, expect } from 'vitest';
import { arrowHeadPoints } from '../js/draw-geometry.js';

describe('arrowHeadPoints', () => {
  it('returns two barb points behind the tip for a rightward arrow', () => {
    const [a, b] = arrowHeadPoints(0, 0, 10, 0, 4);
    expect(a.x).toBeLessThan(10);
    expect(b.x).toBeLessThan(10);
    expect(Math.sign(a.y)).toBe(-Math.sign(b.y));
    expect(Math.abs(a.y)).toBeCloseTo(Math.abs(b.y), 5);
  });
  it('points the barbs back along the segment direction', () => {
    const [a, b] = arrowHeadPoints(0, 0, 0, 10, 4);
    expect(a.y).toBeLessThan(10);
    expect(b.y).toBeLessThan(10);
    expect(Math.sign(a.x)).toBe(-Math.sign(b.x));
  });
});
