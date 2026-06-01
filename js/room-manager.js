import { generateRoomId } from './utils.js';
import { generateSigningKeyPair, exportPublicKey, exportPrivateKey } from './crypto.js';
import { mintCert } from './room-cert.js';
import { PBKDF2_ITERATIONS, LEGACY_PBKDF2_ITERATIONS, MAX_PBKDF2_ITERATIONS, SALT_LENGTH } from './config.js';

function encodeLink(obj) {
  return btoa(encodeURIComponent(JSON.stringify(obj)));
}

// 16 random bytes, base64 — a per-room PBKDF2 salt carried in the capability
// link so the same password in the same room no longer maps to a precomputable
// key (the room id alone is public and shared in URLs).
function randomSaltB64() {
  const bytes = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}

/** Owner link: full authority (skO + skE + cert). */
export function encodeOwnerLink(cap) {
  return encodeLink({ v: 3, r: 'owner', e: cap.epoch, p: cap.password, kdf: cap.kdf, salt: cap.salt, pkO: cap.pkO, skO: cap.skO, pkE: cap.pkE, skE: cap.skE, cert: cap.cert });
}
/** Editor link: can edit, cannot rotate (no skO). */
export function encodeEditorLink(cap) {
  return encodeLink({ v: 3, r: 'edit', e: cap.epoch, p: cap.password, kdf: cap.kdf, salt: cap.salt, pkO: cap.pkO, pkE: cap.pkE, skE: cap.skE, cert: cap.cert });
}
/** Viewer link: read-only (no private keys). */
export function encodeViewerLink(cap) {
  return encodeLink({ v: 3, r: 'view', e: cap.epoch, p: cap.password, kdf: cap.kdf, salt: cap.salt, pkO: cap.pkO, pkE: cap.pkE, cert: cap.cert });
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
      version: 3, role, epoch: d.e, password: d.p,
      // Clamp the attacker-supplied iteration count to [floor, ceiling]. A
      // tampered link cannot downgrade key derivation below the legacy count.
      kdf: Math.min(
        Math.max(
          Number.isInteger(d.kdf) ? d.kdf : LEGACY_PBKDF2_ITERATIONS,
          LEGACY_PBKDF2_ITERATIONS
        ),
        MAX_PBKDF2_ITERATIONS
      ),
      // Per-room salt (absent on pre-salt links => null => deriveKey uses the
      // legacy room-id salt).
      salt: typeof d.salt === 'string' ? d.salt : null,
      pkO: d.pkO, pkE: d.pkE,
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
  const salt = randomSaltB64();
  return { version: 3, role: 'owner', epoch: 1, password, kdf: PBKDF2_ITERATIONS, salt, pkO, skO, pkE, skE, cert };
}

/** Build the '#' hash for a capability at the requested role (owner downgrades to edit/view). */
export function encodeCapabilityHash(cap, role = cap.role) {
  if (role === 'owner' && cap.skO) return encodeOwnerLink(cap);
  if (role === 'edit' && cap.skE) return encodeEditorLink(cap);
  return encodeViewerLink(cap);
}

/** Rotate a room (owner only): same owner key, new epoch + editor key + password + cert. */
export async function rotateCapability(ownerCap, newPassword) {
  if (!ownerCap.skO) throw new Error('rotateCapability requires an owner capability');
  const editor = await generateSigningKeyPair();
  const pkE = await exportPublicKey(editor.publicKey);
  const skE = await exportPrivateKey(editor.privateKey);
  const epoch = ownerCap.epoch + 1;
  const cert = await mintCert(ownerCap.skO, ownerCap.pkO, epoch, pkE);
  return { ...ownerCap, role: 'owner', epoch, password: newPassword, pkE, skE, cert };
}

/**
 * Parse a URL hash into a capability.
 *  - no fragment        -> null  (intentional open room)
 *  - present but bad    -> THROWS (tampered/truncated link; do not silently
 *                          fall back to open-room editor mode)
 *  - present and valid  -> capability object
 */
export function parseCapabilityHash(hash) {
  if (!hash || hash.length <= 1) return null;
  const cap = decodeCapabilityToken(hash.substring(1));
  if (cap === null) throw new Error('Invalid or tampered capability link');
  return cap;
}

/** Non-throwing read used by the helper graph (null for open OR malformed). */
export function getCapabilityFromUrl() {
  try {
    return parseCapabilityHash(window.location.hash);
  } catch {
    return null;
  }
}

/** @returns {'owner'|'edit'|'view'} */
export function capabilityRole(cap) {
  return cap ? cap.role : 'edit'; // unencrypted/open rooms behave as editor
}

export async function createRoom(password = null) {
  const roomId = generateRoomId();
  if (password) {
    const cap = await mintRoomCapability(password);
    window.location.href = `/room/${roomId}#${encodeCapabilityHash(cap, 'owner')}`;
  } else {
    window.location.href = `/room/${roomId}`;
  }
}

// Capability (password-protected) rooms can ONLY be joined via a shared link
// that already carries the room's cert + keys. Deriving a new capability from
// just roomId+password would mint an unrelated owner keypair and drop the user
// into an isolated ghost room. So joining is always a bare navigation; the
// password (if any) is intentionally ignored here.
export function joinRoomPath(roomId, _password = null) {
  if (!roomId || !roomId.trim()) return null;
  return `/room/${roomId.trim()}`;
}

export function joinRoom(roomId, password = null) {
  const path = joinRoomPath(roomId, password);
  if (path) window.location.href = path;
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
  return cap ? cap.role === 'view' : false;
}

/**
 * Shareable link. NEVER shares the owner link; the quick copy gives 'edit', the
 * invite modal gives 'edit'|'view'. (includePassword arg ignored — capability rooms
 * always embed the capability or there's no usable link.)
 *
 * @param {boolean} _includePassword - deprecated/ignored (capability is always embedded)
 * @param {'edit'|'view'} permission - permission level for the minted link
 */
export function getShareableLink(_includePassword = false, permission = 'edit') {
  const baseUrl = window.location.origin + window.location.pathname;
  const cap = getCapabilityFromUrl();
  if (!cap) return baseUrl;
  const role = permission === 'view' ? 'view' : 'edit';
  return `${baseUrl}#${encodeCapabilityHash(cap, role)}`;
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
