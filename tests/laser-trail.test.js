import { describe, it, expect } from 'vitest';
import { pruneTrail, MAX_TRAIL_AGE_MS } from '../js/laser-trail.js';

describe('pruneTrail', () => {
  it('drops points older than the max age', () => {
    const now = 10_000;
    const pts = [
      { x: 0, y: 0, t: now - (MAX_TRAIL_AGE_MS + 1) },
      { x: 1, y: 1, t: now - 100 },
    ];
    const out = pruneTrail(pts, now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ x: 1, y: 1 });
  });
  it('returns empty array for null/empty input', () => {
    expect(pruneTrail(null, 1)).toEqual([]);
    expect(pruneTrail([], 1)).toEqual([]);
  });
  it('keeps all points when all are fresh', () => {
    const now = 5_000;
    const pts = [{ x: 0, y: 0, t: now }, { x: 1, y: 0, t: now - 50 }];
    expect(pruneTrail(pts, now)).toHaveLength(2);
  });
  it('keeps a point at exactly MAX_TRAIL_AGE_MS old (inclusive boundary)', () => {
    const now = 5_000;
    const pts = [{ x: 2, y: 2, t: now - MAX_TRAIL_AGE_MS }];
    expect(pruneTrail(pts, now)).toHaveLength(1);
  });
  it('silently drops nullish elements without throwing', () => {
    const now = 5_000;
    const pts = [null, undefined, { x: 1, y: 1, t: now }];
    const out = pruneTrail(pts, now);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ x: 1, y: 1 });
  });
});
