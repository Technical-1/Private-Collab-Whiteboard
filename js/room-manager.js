import { generateRoomId } from './utils.js';
import {
  generateSigningKeyPair, exportPublicKey, exportPrivateKey,
} from './crypto.js';

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
 * Mint a brand-new editor capability for a room: random password-independent
 * Ed25519 keypair at epoch 1.
 * @param {string} password
 * @returns {Promise<object>} capability
 */
export async function mintRoomCapability(password) {
  const kp = await generateSigningKeyPair();
  const publicKeyB64 = await exportPublicKey(kp.publicKey);
  const privateKeyB64 = await exportPrivateKey(kp.privateKey);
  return { version: 2, password, role: 'edit', epoch: 1, privateKeyB64, publicKeyB64 };
}

/** @returns {'edit'|'view'} */
export function capabilityRole(cap) {
  return cap && cap.role === 'edit' ? 'edit' : 'view';
}

/** Build the '#' hash payload for a capability (editor form if it has a private key). */
export function encodeCapabilityHash(cap, role = cap.role) {
  if (role === 'edit' && cap.privateKeyB64) {
    return encodeEditorLink(cap.password, cap.privateKeyB64, cap.publicKeyB64, cap.epoch);
  }
  return encodeViewerLink(cap.password, cap.publicKeyB64, cap.epoch);
}

/**
 * Read the capability from the URL hash. Returns null for unencrypted rooms.
 */
export function getCapabilityFromUrl() {
  const hash = window.location.hash;
  if (hash && hash.length > 1) {
    return decodeCapabilityToken(hash.substring(1));
  }
  return null;
}

export async function createRoom(password = null) {
  const roomId = generateRoomId();
  if (password) {
    const cap = await mintRoomCapability(password);
    window.location.href = `/room/${roomId}#${encodeCapabilityHash(cap, 'edit')}`;
  } else {
    window.location.href = `/room/${roomId}`;
  }
}

export async function joinRoom(roomId, password = null, role = 'edit') {
  if (!roomId || !roomId.trim()) return;
  const cleanRoomId = roomId.trim();
  if (password) {
    // Joining an encrypted room normally requires the shared link. With only a
    // password (e.g. the join form), mint a fresh editor room rather than fork.
    const cap = await mintRoomCapability(password);
    window.location.href = `/room/${cleanRoomId}#${encodeCapabilityHash(cap, 'edit')}`;
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

export function getPasswordFromUrl() {
  const cap = getCapabilityFromUrl();
  return cap ? cap.password : null;
}

export function isEncryptedRoom() {
  return !!getCapabilityFromUrl();
}

export function isReadOnly() {
  const cap = getCapabilityFromUrl();
  // Encrypted rooms: role from capability. Unencrypted rooms: always editable.
  return cap ? cap.role === 'view' : false;
}

/**
 * Get a shareable link at the requested permission level. Editors can mint
 * viewer links (they hold pk); viewers can only share viewer links.
 */
export function getShareableLink(includePassword = false, permission = 'edit') {
  const baseUrl = window.location.origin + window.location.pathname;
  const cap = getCapabilityFromUrl();
  if (!includePassword || !cap) return baseUrl;
  return `${baseUrl}#${encodeCapabilityHash(cap, permission)}`;
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
