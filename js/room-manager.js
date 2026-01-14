import { generateRoomId } from './utils.js';

// Secret salt for signature (doesn't need to be truly secret since it's client-side,
// but makes casual tampering harder)
const SIGNATURE_SALT = 'wb-2024-sig';

/**
 * Generate a simple signature for the token
 * This prevents casual URL tampering (changing "view" to "edit")
 */
function generateSignature(password, role) {
  const data = password + role + SIGNATURE_SALT;
  // Simple hash: use btoa and take first 8 chars
  const encoded = btoa(encodeURIComponent(data));
  return encoded.substring(0, 8);
}

/**
 * Verify the token signature is valid
 */
function verifySignature(password, role, signature) {
  return generateSignature(password, role) === signature;
}

/**
 * Encode password and role into a URL-safe token
 * Format: base64(JSON({p: password, r: role, s: signature}))
 */
export function encodeAccessToken(password, role = 'edit') {
  const signature = generateSignature(password, role);
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
 */
export function decodeAccessToken(token) {
  try {
    const decoded = JSON.parse(decodeURIComponent(atob(token)));

    // Verify required fields exist
    if (!decoded.p || !decoded.r || !decoded.s) {
      return null;
    }

    // Verify signature
    if (!verifySignature(decoded.p, decoded.r, decoded.s)) {
      console.warn('Invalid token signature - possible tampering');
      return null;
    }

    return {
      password: decoded.p,
      role: decoded.r
    };
  } catch (e) {
    // Try legacy format (just password in hash)
    try {
      const password = decodeURIComponent(token);
      // If it's a simple string (old format), treat as edit access
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
export function createRoom(password = null) {
  const roomId = generateRoomId();

  if (password) {
    const token = encodeAccessToken(password, 'edit');
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
export function joinRoom(roomId, password = null, role = 'edit') {
  if (!roomId || !roomId.trim()) return;

  const cleanRoomId = roomId.trim();

  if (password) {
    const token = encodeAccessToken(password, role);
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
export function getAccessFromUrl() {
  const hash = window.location.hash;
  if (hash && hash.length > 1) {
    const token = hash.substring(1);
    const decoded = decodeAccessToken(token);
    if (decoded) {
      return decoded;
    }
  }
  return { password: null, role: 'edit' };
}

/**
 * Extract password from URL (for encryption)
 */
export function getPasswordFromUrl() {
  return getAccessFromUrl().password;
}

/**
 * Get permission level from URL
 */
export function getPermissionFromUrl() {
  return getAccessFromUrl().role;
}

/**
 * Check if current room is encrypted (has password)
 */
export function isEncryptedRoom() {
  return !!getPasswordFromUrl();
}

/**
 * Check if current user is in read-only mode
 */
export function isReadOnly() {
  return getPermissionFromUrl() === 'view';
}

/**
 * Get shareable link for current room
 * @param {boolean} includePassword - Whether to include password in link
 * @param {string} permission - Permission level ('edit' or 'view')
 */
export function getShareableLink(includePassword = false, permission = 'edit') {
  const baseUrl = window.location.origin + window.location.pathname;

  if (includePassword) {
    const access = getAccessFromUrl();
    if (access.password) {
      const token = encodeAccessToken(access.password, permission);
      return `${baseUrl}#${token}`;
    }
  }

  return baseUrl;
}

/**
 * Update the room password (changes URL hash)
 * @param {string|null} newPassword - New password (null to remove encryption)
 */
export function updatePassword(newPassword) {
  const roomId = getRoomIdFromUrl();
  if (!roomId) return;

  if (newPassword) {
    const token = encodeAccessToken(newPassword, 'edit');
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
