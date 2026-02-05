import { generateRoomId } from './utils.js';
import { generateHmacSignature } from './crypto.js';

// HMAC salt for new signatures
const HMAC_SALT = 'REDACTED';

// Legacy salt (kept for backwards compatibility)
const LEGACY_SIGNATURE_SALT = 'REDACTED';

/**
 * Generate an HMAC-SHA256 signature for the token (new format)
 */
async function generateSignature(password, role) {
  return generateHmacSignature(password + role, HMAC_SALT);
}

/**
 * Verify the HMAC token signature is valid
 */
async function verifySignature(password, role, signature) {
  const expected = await generateSignature(password, role);
  return expected === signature;
}

/**
 * Generate a legacy btoa-based signature (for backwards compat verification)
 */
function generateLegacySignature(password, role) {
  const data = password + role + LEGACY_SIGNATURE_SALT;
  const encoded = btoa(encodeURIComponent(data));
  return encoded.substring(0, 8);
}

/**
 * Verify a legacy btoa-based signature
 */
function verifyLegacySignature(password, role, signature) {
  return generateLegacySignature(password, role) === signature;
}

/**
 * Encode password and role into a URL-safe token with HMAC signature
 * Format: base64(JSON({p: password, r: role, s: hmac_signature}))
 */
export async function encodeAccessToken(password, role = 'edit') {
  const signature = await generateSignature(password, role);
  const token = {
    p: password,
    r: role,
    s: signature
  };
  return btoa(encodeURIComponent(JSON.stringify(token)));
}

/**
 * Decode an access token from URL hash
 * Returns { password, role } or null if invalid
 * Supports: HMAC tokens, legacy btoa tokens, and raw password format
 */
export async function decodeAccessToken(token) {
  try {
    const decoded = JSON.parse(decodeURIComponent(atob(token)));

    // Verify required fields exist
    if (!decoded.p || !decoded.r || !decoded.s) {
      return null;
    }

    // Try new HMAC signature first
    if (await verifySignature(decoded.p, decoded.r, decoded.s)) {
      return {
        password: decoded.p,
        role: decoded.r
      };
    }

    // Fall back to legacy btoa signature
    if (verifyLegacySignature(decoded.p, decoded.r, decoded.s)) {
      return {
        password: decoded.p,
        role: decoded.r
      };
    }

    console.warn('Invalid token signature - possible tampering');
    return null;
  } catch (e) {
    // Try legacy format (just password in hash)
    try {
      const password = decodeURIComponent(token);
      // If it's a simple string (old format), treat as edit access.
      // Exclude strings starting with '{' to avoid treating malformed JSON tokens as passwords.
      if (password && !password.startsWith('{')) {
        return {
          password: password,
          role: 'edit'  // Legacy links get edit access
        };
      }
    } catch (e2) {
      // Ignore
    }
    return null;
  }
}

/**
 * Create a new room and navigate to it
 * @param {string|null} password - Optional password for E2E encryption
 */
export async function createRoom(password = null) {
  const roomId = generateRoomId();

  if (password) {
    const token = await encodeAccessToken(password, 'edit');
    window.location.href = `/room/${roomId}#${token}`;
  } else {
    window.location.href = `/room/${roomId}`;
  }
}

/**
 * Join an existing room
 * @param {string} roomId - Room ID to join
 * @param {string|null} password - Optional password for encrypted rooms
 * @param {string} role - Permission level ('edit' or 'view')
 */
export async function joinRoom(roomId, password = null, role = 'edit') {
  if (!roomId || !roomId.trim()) return;

  const cleanRoomId = roomId.trim();

  if (password) {
    const token = await encodeAccessToken(password, role);
    window.location.href = `/room/${cleanRoomId}#${token}`;
  } else {
    window.location.href = `/room/${cleanRoomId}`;
  }
}

/**
 * Extract room ID from current URL
 */
export function getRoomIdFromUrl() {
  const match = window.location.pathname.match(/\/room\/([^/]+)/);
  return match ? match[1] : null;
}

/**
 * Get access info from URL hash
 * Returns { password, role } or { password: null, role: 'edit' } for unencrypted rooms
 */
export async function getAccessFromUrl() {
  const hash = window.location.hash;
  if (hash && hash.length > 1) {
    const token = hash.substring(1);
    const decoded = await decodeAccessToken(token);
    if (decoded) {
      return decoded;
    }
  }
  return { password: null, role: 'edit' };
}

/**
 * Extract password from URL (for encryption)
 */
export async function getPasswordFromUrl() {
  return (await getAccessFromUrl()).password;
}

/**
 * Get permission level from URL
 */
export async function getPermissionFromUrl() {
  return (await getAccessFromUrl()).role;
}

/**
 * Check if current room is encrypted (has password)
 */
export async function isEncryptedRoom() {
  return !!(await getPasswordFromUrl());
}

/**
 * Check if current user is in read-only mode
 */
export async function isReadOnly() {
  return (await getPermissionFromUrl()) === 'view';
}

/**
 * Get shareable link for current room
 * @param {boolean} includePassword - Whether to include password in link
 * @param {string} permission - Permission level ('edit' or 'view')
 */
export async function getShareableLink(includePassword = false, permission = 'edit') {
  const baseUrl = window.location.origin + window.location.pathname;

  if (includePassword) {
    const access = await getAccessFromUrl();
    if (access.password) {
      const token = await encodeAccessToken(access.password, permission);
      return `${baseUrl}#${token}`;
    }
  }

  return baseUrl;
}

/**
 * Update the room password (changes URL hash)
 * @param {string|null} newPassword - New password (null to remove encryption)
 */
export async function updatePassword(newPassword) {
  const roomId = getRoomIdFromUrl();
  if (!roomId) return;

  if (newPassword) {
    const token = await encodeAccessToken(newPassword, 'edit');
    window.location.hash = token;
  } else {
    // Remove hash without page reload
    history.replaceState(null, '', window.location.pathname);
  }
}

/**
 * Copy text to clipboard
 */
export function copyToClipboard(text) {
  navigator.clipboard.writeText(text).then(() => {
    // Success
  }).catch(() => {
    // Fallback for older browsers
    const textarea = document.createElement('textarea');
    textarea.value = text;
    document.body.appendChild(textarea);
    textarea.select();
    document.execCommand('copy');
    document.body.removeChild(textarea);
  });
}
