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
export const PBKDF2_ITERATIONS = 100000;
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
export const PARTYKIT_HOST = 'whiteboard-party.jacobcanada.partykit.dev';

// UI configuration
export const TOUCH_TARGET_MIN_SIZE = 44;  // Minimum touch target size in pixels
export const HIT_TEST_THRESHOLD = 8;      // Pixels for shape hit detection
