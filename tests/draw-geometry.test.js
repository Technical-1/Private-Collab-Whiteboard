import { describe, it, expect } from 'vitest';
import { arrowHeadPoints, polygonPoints, pointInPolygon, dashPattern } from '../js/draw-geometry.js';

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
    expect(a.x).not.toBe(0);
    expect(a.x).toBeCloseTo(-b.x, 5);
  });
});

describe('polygonPoints', () => {
  const bbox = { x: 0, y: 0, width: 10, height: 10 };
  it('diamond = 4 edge midpoints', () => {
    const pts = polygonPoints('diamond', bbox);
    expect(pts).toHaveLength(4);
    expect(pts).toContainEqual({ x: 5, y: 0 });
    expect(pts).toContainEqual({ x: 10, y: 5 });
  });
  it('triangle = 3 points (base + apex)', () => {
    const pts = polygonPoints('triangle', bbox);
    expect(pts).toHaveLength(3);
    expect(pts).toContainEqual({ x: 0, y: 10 });
    expect(pts).toContainEqual({ x: 10, y: 10 });
    expect(pts).toContainEqual({ x: 5, y: 0 });
  });
});

describe('pointInPolygon', () => {
  const square = [{x:0,y:0},{x:10,y:0},{x:10,y:10},{x:0,y:10}];
  it('true for an interior point', () => expect(pointInPolygon(5, 5, square)).toBe(true));
  it('false for an exterior point', () => expect(pointInPolygon(20, 5, square)).toBe(false));
  it('classifies a point well inside vs well outside (boundary points are incidental)', () => {
    expect(pointInPolygon(1, 1, square)).toBe(true);
    expect(pointInPolygon(-1, -1, square)).toBe(false);
  });
});

describe('dashPattern', () => {
  it('solid → empty array', () => expect(dashPattern('solid')).toEqual([]));
  it('dashed → long dashes', () => expect(dashPattern('dashed')).toEqual([8, 6]));
  it('dotted → short dots', () => expect(dashPattern('dotted')).toEqual([2, 6]));
  it('unknown/undefined → solid', () => {
    expect(dashPattern(undefined)).toEqual([]);
    expect(dashPattern('zigzag')).toEqual([]);
  });
});
