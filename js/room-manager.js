import { generateRoomId } from './utils.js';
import { generateSigningKeyPair, exportPublicKey, exportPrivateKey } from './crypto.js';
import { mintCert } from './room-cert.js';

function encodeLink(obj) {
  return btoa(encodeURIComponent(JSON.stringify(obj)));
}

/** Owner link: full authority (skO + skE + cert). */
export function encodeOwnerLink(cap) {
  return encodeLink({ v: 3, r: 'owner', e: cap.epoch, p: cap.password, pkO: cap.pkO, skO: cap.skO, pkE: cap.pkE, skE: cap.skE, cert: cap.cert });
}
/** Editor link: can edit, cannot rotate (no skO). */
export function encodeEditorLink(cap) {
  return encodeLink({ v: 3, r: 'edit', e: cap.epoch, p: cap.password, pkO: cap.pkO, pkE: cap.pkE, skE: cap.skE, cert: cap.cert });
}
/** Viewer link: read-only (no private keys). */
export function encodeViewerLink(cap) {
  return encodeLink({ v: 3, r: 'view', e: cap.epoch, p: cap.password, pkO: cap.pkO, pkE: cap.pkE, cert: cap.cert });
}

/**
 * Decode a v3 capability token. Hard break: only v:3 accepted. A claimed role
 * without the matching key is downgraded (no key => can't act in that role).
 */
export function decodeCapabilityToken(token) {
  try {
    const d = JSON.parse(decodeURIComponent(atob(token)));
    if (d.v !== 3 || !d.p || !d.pkO || !d.pkE || !d.cert || typeof d.e !== 'number') return null;
    const hasOwner = d.r === 'owner' && typeof d.skO === 'string' && typeof d.skE === 'string';
    const hasEditor = (d.r === 'owner' || d.r === 'edit') && typeof d.skE === 'string';
    const role = hasOwner ? 'owner' : hasEditor ? 'edit' : 'view';
    return {
      version: 3, role, epoch: d.e, password: d.p, pkO: d.pkO, pkE: d.pkE,
      skO: hasOwner ? d.skO : null,
      skE: hasEditor ? d.skE : null,
      cert: d.cert,
    };
  } catch {
    return null;
  }
}

/** Mint a brand-new OWNER capability: owner root key + first editor key + cert_1. */
export async function mintRoomCapability(password) {
  const owner = await generateSigningKeyPair();
  const editor = await generateSigningKeyPair();
  const pkO = await exportPublicKey(owner.publicKey);
  const skO = await exportPrivateKey(owner.privateKey);
  const pkE = await exportPublicKey(editor.publicKey);
  const skE = await exportPrivateKey(editor.privateKey);
  const cert = await mintCert(skO, pkO, 1, pkE);
  return { version: 3, role: 'owner', epoch: 1, password, pkO, skO, pkE, skE, cert };
}

/** Build the '#' hash for a capability at the requested role (owner downgrades to edit/view). */
export function encodeCapabilityHash(cap, role = cap.role) {
  if (role === 'owner' && cap.skO) return encodeOwnerLink(cap);
  if (role === 'edit' && cap.skE) return encodeEditorLink(cap);
  return encodeViewerLink(cap);
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
 * Get a shareable link at the requested permission level.
 *
 * For a capability (encrypted) room the link MUST carry the capability — the
 * password and keys live entirely in the URL hash. A link without it points the
 * recipient at a different, open (editable) room on the same id and corrupts the
 * original with decryption errors, so `includePassword` is intentionally ignored
 * here (kept in the signature for existing callers). Open rooms have no
 * capability, so they share the bare URL.
 *
 * @param {boolean} _includePassword - deprecated/ignored (capability is always embedded)
 * @param {'edit'|'view'} permission - permission level for the minted link
 */
export function getShareableLink(_includePassword = false, permission = 'edit') {
  const baseUrl = window.location.origin + window.location.pathname;
  const cap = getCapabilityFromUrl();
  if (!cap) return baseUrl; // open room: nothing to embed
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
