import { safeColor, safeNumber, safeToolName } from './utils.js';

// Normalize an untrusted shape pulled from the shared CRDT into one whose
// DOM-bound fields are safe to interpolate. Non-DOM fields (geometry, text —
// text is rendered via canvas fillText, not HTML) are preserved as-is. Returns
// null for non-objects so callers can skip them.
export function sanitizeShape(shape) {
  if (!shape || typeof shape !== 'object') return null;
  return {
    ...shape,
    tool: safeToolName(shape.tool),
    color: safeColor(shape.color),
    fillColor: shape.fillColor ? safeColor(shape.fillColor) : shape.fillColor,
    strokeWidth: safeNumber(shape.strokeWidth, 2),
    fontSize: safeNumber(shape.fontSize, 20),
    strokeStyle: ['solid', 'dashed', 'dotted'].includes(shape.strokeStyle) ? shape.strokeStyle : 'solid',
  };
}

// Upper bound on rendered/hit-tested points from an untrusted peer. A real
// freehand stroke is well under this; the cap bounds per-frame draw cost and the
// per-char O(n) measureText scans that a giant array would trigger. Intentionally
// higher than the laser-trail cap (300): freehand strokes are legitimately longer;
// 5000 bounds the worst case while still accommodating real drawing sessions.
export const MAX_SHAPE_POINTS = 5000;

// Slice only when over the cap (no copy in the common case, so it is cheap to
// call every frame). Non-arrays normalize to [] so drawers can iterate safely.
export function clampPoints(points) {
  if (!Array.isArray(points)) return [];
  return points.length > MAX_SHAPE_POINTS ? points.slice(0, MAX_SHAPE_POINTS) : points;
}

// Bound a peer-supplied stroke width to a sane pixel range (an enormous lineWidth
// is itself a render DoS). Reuses safeNumber's type coercion + fallback.
export function safeStrokeWidth(value, fallback = 2) {
  return Math.min(Math.max(safeNumber(value, fallback), 0), 200);
}
