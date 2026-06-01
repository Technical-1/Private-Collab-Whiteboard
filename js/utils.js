// 20 Easy-to-Read Colors (same as original)
export const colors = [
  "#1F77B4", "#FF7F0E", "#2CA02C", "#D62728", "#9467BD",
  "#8C564B", "#E377C2", "#7F7F7F", "#BCBD22", "#17BECF",
  "#393B79", "#637939", "#8C6D31", "#843C39", "#7B4173",
  "#3182BD", "#6BAED6", "#9E9AC8", "#B5CF6B", "#E6550D"
];

// Generate a unique ID for drawings
export function generateId() {
  return crypto.randomUUID();
}

// Generate a user ID (persisted in localStorage)
export function generateUserId() {
  let userId = localStorage.getItem('whiteboard-user-id');
  if (!userId) {
    userId = crypto.randomUUID();
    localStorage.setItem('whiteboard-user-id', userId);
  }
  return userId;
}

// Assign a color deterministically based on user ID
export function assignColor(userId) {
  let hash = 0;
  for (let i = 0; i < userId.length; i++) {
    hash = ((hash << 5) - hash) + userId.charCodeAt(i);
    hash = hash & hash;
  }
  return colors[Math.abs(hash) % colors.length];
}

// Strict hex-color allowlist. Colors arrive from untrusted peers (unsigned
// awareness state, shared CRDT shapes) and get interpolated into innerHTML, so
// anything that isn't a plain #hex color is an XSS risk. The app only ever
// produces #rrggbb (palette + <input type=color>), so hex-only is safe; any
// other value collapses to the fallback. Use this for ANY color that reaches
// the DOM via string interpolation.
const HEX_COLOR = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/;

export function safeColor(value, fallback = '#000000') {
  return typeof value === 'string' && HEX_COLOR.test(value) ? value : fallback;
}

// Coerce an untrusted numeric field to a finite number for safe interpolation
// into HTML attributes. Note Number(null)/Number('') are 0 (finite), so reject
// non-number, non-numeric-string inputs explicitly rather than trusting Number.
export function safeNumber(value, fallback) {
  if (typeof value === 'number') return Number.isFinite(value) ? value : fallback;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    if (Number.isFinite(n)) return n;
  }
  return fallback;
}

// Allowlist of tool names the app actually produces. shape.tool arrives from
// untrusted peers via the shared CRDT and is interpolated into innerHTML when
// building the shape-settings popup header, so any value outside this set
// collapses to the inert literal 'shape'. Mirrors safeColor/safeNumber.
const KNOWN_TOOLS = ['line', 'rect', 'circle', 'text', 'freehand', 'eraser', 'arrow', 'diamond', 'triangle', 'ellipse', 'highlight', 'sticky', 'connector'];

export function safeToolName(value) {
  return typeof value === 'string' && KNOWN_TOOLS.includes(value) ? value : 'shape';
}

// Generate a room ID (16 hex chars)
export function generateRoomId() {
  return Array.from(crypto.getRandomValues(new Uint8Array(8)))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

// Single source of truth for HTML escaping. Escapes the five characters that
// matter in both text and attribute contexts (modal.js and awareness.js had
// their own copies; boards-home.js had one MISSING the quotes — that drift is
// why this lives here now). Coerces non-strings so callers can pass anything.
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}
