/**
 * Configuration constants for the Whiteboard application
 * Centralizes magic numbers and configurable values
 */

// Zoom configuration
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5;
export const ZOOM_STEP = 1.25;       // Multiplier for zoom in/out buttons
export const ZOOM_WHEEL_STEP = 1.1;  // Multiplier for scroll wheel zoom

// Pan/Fit configuration
export const FIT_PADDING = 50;       // Padding when fitting all shapes

// Timing configuration (in milliseconds)
export const CURSOR_UPDATE_INTERVAL = 50;
export const RESYNC_INTERVAL = 30000;
export const SYNC_TIMEOUT = 5000;
export const UNDO_CAPTURE_TIMEOUT = 500;
export const PANEL_ANIMATION_DELAY = 350;

// Cryptography configuration
// PBKDF2_ITERATIONS is the count used to MINT new rooms (OWASP guidance for
// PBKDF2-HMAC-SHA256). The actual count is carried in each capability link's
// `kdf` field so all peers derive the same key; links minted before this
// hardening (no `kdf`) fall back to LEGACY_PBKDF2_ITERATIONS so existing rooms
// keep working.
export const PBKDF2_ITERATIONS = 600000;
export const LEGACY_PBKDF2_ITERATIONS = 100000;
export const SALT_LENGTH = 16;
export const IV_LENGTH = 12;

// Default drawing settings
export const DEFAULT_STROKE_WIDTH = 2;
export const DEFAULT_FONT_SIZE = 20;
export const DEFAULT_FONT_FAMILY = 'Arial';
export const ERASER_WIDTH_MULTIPLIER = 3;

// User colors palette
export const USER_COLORS = [
  "#3182BD", "#6BAED6", "#9E9AC8", "#B5CF6B", "#E6550D",
  "#FD8D3C", "#FDAE6B", "#74C476", "#31A354", "#756BB1"
];

// PartyKit server configuration
// Must match the "name" in partykit.json (whiteboard-collab) and the deployed
// host. This is the single source of truth - yjs-setup.js imports it.
export const PARTYKIT_HOST = 'whiteboard-collab.technical-1.partykit.dev';

// UI configuration
export const TOUCH_TARGET_MIN_SIZE = 44;  // Minimum touch target size in pixels
export const HIT_TEST_THRESHOLD = 8;      // Pixels for shape hit detection
