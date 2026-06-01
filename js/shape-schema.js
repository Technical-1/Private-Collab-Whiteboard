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
  };
}
