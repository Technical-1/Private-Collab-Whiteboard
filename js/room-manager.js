import { generateRoomId } from './utils.js';

/**
 * Encode an editor capability link payload (goes after '#').
 * Carries both private (sk, PKCS8 base64) and public (pk, raw base64) keys.
 */
export function encodeEditorLink(password, privateKeyB64, publicKeyB64, epoch) {
  const token = { v: 2, p: password, r: 'edit', e: epoch, sk: privateKeyB64, pk: publicKeyB64 };
  return btoa(encodeURIComponent(JSON.stringify(token)));
}

/** Encode a viewer capability link payload (public key only). */
export function encodeViewerLink(password, publicKeyB64, epoch) {
  const token = { v: 2, p: password, r: 'view', e: epoch, pk: publicKeyB64 };
  return btoa(encodeURIComponent(JSON.stringify(token)));
}

/**
 * Decode a capability token. Returns a normalized capability or null.
 * Hard break: only v:2 tokens are accepted. An 'edit' token without a private
 * key is downgraded to 'view' (no key => cannot sign).
 * @returns {{version:2, password:string, role:'edit'|'view', epoch:number,
 *            privateKeyB64:string|null, publicKeyB64:string}|null}
 */
export function decodeCapabilityToken(token) {
  try {
    const d = JSON.parse(decodeURIComponent(atob(token)));
    if (d.v !== 2 || !d.p || !d.pk || typeof d.e !== 'number') return null;
    const hasPriv = d.r === 'edit' && typeof d.sk === 'string' && d.sk.length > 0;
    return {
      version: 2,
      password: d.p,
      role: hasPriv ? 'edit' : 'view',
      epoch: d.e,
      privateKeyB64: hasPriv ? d.sk : null,
      publicKeyB64: d.pk,
    };
  } catch {
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
