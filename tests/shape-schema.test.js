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
