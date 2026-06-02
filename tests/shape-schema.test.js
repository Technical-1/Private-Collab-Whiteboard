import { describe, it, expect } from 'vitest';
import { sanitizeShape } from '../js/shape-schema.js';

describe('sanitizeShape', () => {
  it('returns null for non-objects', () => {
    expect(sanitizeShape(null)).toBeNull();
    expect(sanitizeShape('x')).toBeNull();
  });

  it('neutralizes an injected tool and clamps numeric/color fields', () => {
    const dirty = {
      tool: '<img src=x onerror=alert(1)>',
      color: 'javascript:alert(1)',
      strokeWidth: 'NaN',
      fontSize: {},
      x: 10, y: 20,
    };
    const clean = sanitizeShape(dirty);
    expect(clean.tool).toBe('shape');
    expect(clean.color).toBe('#000000');     // safeColor fallback
    expect(clean.strokeWidth).toBe(2);       // safeNumber fallback
    expect(clean.fontSize).toBe(20);         // safeNumber fallback
    expect(clean.x).toBe(10);                // untouched geometry preserved
  });

  it('passes a well-formed shape through with values intact', () => {
    const ok = { tool: 'rect', color: '#ff0000', strokeWidth: 5, fontSize: 16 };
    const clean = sanitizeShape(ok);
    expect(clean).toMatchObject({ tool: 'rect', color: '#ff0000', strokeWidth: 5, fontSize: 16 });
  });
});

describe('sanitizeShape — Phase 1 fields', () => {
  it('preserves arrowHeads and strokeStyle and the new tool', () => {
    // These canvas-only fields pass through via the `...shape` spread — no explicit allowlist entry needed.
    const clean = sanitizeShape({
      tool: 'arrow', color: '#00ff00', strokeWidth: 3,
      startX: 0, startY: 0, x: 5, y: 5,
      arrowHeads: 'both', strokeStyle: 'dashed',
    });
    expect(clean.tool).toBe('arrow');
    expect(clean.arrowHeads).toBe('both');
    expect(clean.strokeStyle).toBe('dashed');
  });
});

describe('sanitizeShape — sticky', () => {
  it('preserves text and fillColor and the tool; keeps text verbatim (rendered to canvas, not HTML)', () => {
    const clean = sanitizeShape({
      tool: 'sticky', text: 'hello <not html>', fillColor: '#fff8b8',
      startX: 0, startY: 0, width: 180, height: 180, fontSize: 16,
    });
    expect(clean.tool).toBe('sticky');
    expect(clean.text).toBe('hello <not html>');
    expect(clean.fillColor).toBe('#fff8b8');
  });
});

describe('sanitizeShape — connector', () => {
  it('preserves flat ids + anchor enums + tool', () => {
    const clean = sanitizeShape({
      tool: 'connector', fromId: 'a1', toId: 'b2',
      fromAnchor: 'e', toAnchor: 'w', strokeWidth: 2,
      strokeStyle: 'solid', arrowHeads: 'end',
    });
    expect(clean.tool).toBe('connector');
    expect(clean.fromId).toBe('a1');
    expect(clean.toId).toBe('b2');
    expect(clean.fromAnchor).toBe('e');
    expect(clean.toAnchor).toBe('w');
  });
});

import { clampPoints, safeStrokeWidth, MAX_SHAPE_POINTS } from '../js/shape-schema.js';

describe('clampPoints', () => {
  it('returns the array unchanged when under the cap', () => {
    const pts = [{ x: 0, y: 0 }, { x: 1, y: 1 }];
    expect(clampPoints(pts)).toBe(pts); // same reference, no copy
  });
  it('slices to the cap when over it', () => {
    const big = Array.from({ length: MAX_SHAPE_POINTS + 100 }, (_, i) => ({ x: i, y: i }));
    const out = clampPoints(big);
    expect(out).toHaveLength(MAX_SHAPE_POINTS);
    expect(out[0]).toEqual({ x: 0, y: 0 }); // keeps the head
  });
  it('returns [] for non-arrays', () => {
    expect(clampPoints(undefined)).toEqual([]);
    expect(clampPoints(null)).toEqual([]);
  });
});

describe('safeStrokeWidth', () => {
  it('passes through a normal width', () => expect(safeStrokeWidth(5)).toBe(5));
  it('falls back to 2 for non-numbers', () => expect(safeStrokeWidth('NaN')).toBe(2));
  it('clamps absurd widths to the max', () => expect(safeStrokeWidth(1e9)).toBe(200));
  it('clamps negatives to 0', () => expect(safeStrokeWidth(-5)).toBe(0));
});
