/**
 * End-to-end encryption utilities using Web Crypto API
 *
 * Security model:
 * - Password + room ID → AES-256-GCM key (via PBKDF2)
 * - Each message encrypted with random 12-byte IV
 * - PartyKit only sees encrypted bytes
 *
 * Crypto choices:
 * - PBKDF2: Key derivation (100k iterations for brute-force resistance)
 * - AES-256-GCM: Authenticated encryption (confidentiality + integrity)
 * - Random IV per message: Prevents pattern analysis
 */

import { PBKDF2_ITERATIONS, IV_LENGTH } from './config.js';

/**
 * Derives an AES-256-GCM key from a password and room ID
 *
 * @param {string} password - User-provided password
 * @param {string} roomId - Room ID (used as salt to make keys room-specific)
 * @returns {Promise<CryptoKey>} - AES-GCM key for encrypt/decrypt
 */
export async function deriveKey(password, roomId) {
  const encoder = new TextEncoder();

  // Import password as raw key material
  const keyMaterial = await crypto.subtle.importKey(
    'raw',
    encoder.encode(password),
    'PBKDF2',
    false,
    ['deriveBits', 'deriveKey']
  );

  // Derive AES key using PBKDF2
  // Salt = room ID ensures same password in different rooms = different keys
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: encoder.encode(`whiteboard-${roomId}`),
      iterations: PBKDF2_ITERATIONS,
      hash: 'SHA-256'
    },
    keyMaterial,
    { name: 'AES-GCM', length: 256 },
    false, // not extractable
    ['encrypt', 'decrypt']
  );
}

/**
 * Encrypts data using AES-256-GCM
 *
 * Output format: [12-byte IV][encrypted data][16-byte auth tag]
 * The IV is prepended so we can decrypt later
 *
 * @param {Uint8Array} data - Plaintext data to encrypt
 * @param {CryptoKey} key - AES-GCM key from deriveKey()
 * @returns {Promise<Uint8Array>} - IV + ciphertext + auth tag
 */
export async function encrypt(data, key) {
  // Generate random IV for this message
  const iv = crypto.getRandomValues(new Uint8Array(IV_LENGTH));

  // Encrypt with AES-GCM (includes authentication tag)
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    data
  );

  // Prepend IV to encrypted data
  const result = new Uint8Array(IV_LENGTH + encrypted.byteLength);
  result.set(iv, 0);
  result.set(new Uint8Array(encrypted), IV_LENGTH);

  return result;
}

/**
 * Decrypts data using AES-256-GCM
 *
 * @param {Uint8Array} data - IV + ciphertext + auth tag
 * @param {CryptoKey} key - AES-GCM key from deriveKey()
 * @returns {Promise<Uint8Array>} - Decrypted plaintext
 * @throws {Error} - If decryption fails (wrong password or tampered data)
 */
export async function decrypt(data, key) {
  // Extract IV from beginning
  const iv = data.slice(0, IV_LENGTH);
  const ciphertext = data.slice(IV_LENGTH);

  // Decrypt and verify authentication tag
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );

  return new Uint8Array(decrypted);
}

/**
 * Tests if a password is correct by attempting to decrypt test data
 *
 * @param {Uint8Array} encryptedTestData - Encrypted test payload
 * @param {string} password - Password to test
 * @param {string} roomId - Room ID
 * @returns {Promise<boolean>} - True if password is correct
 */
export async function verifyPassword(encryptedTestData, password, roomId) {
  try {
    const key = await deriveKey(password, roomId);
    await decrypt(encryptedTestData, key);
    return true;
  } catch {
    return false;
  }
}

/**
 * Generates a cryptographically secure random password
 * Useful for "generate password" button
 *
 * @param {number} length - Password length (default 16)
 * @returns {string} - Random password
 */
export function generatePassword(length = 16) {
  const charset = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  const randomValues = crypto.getRandomValues(new Uint8Array(length));
  return Array.from(randomValues, (v) => charset[v % charset.length]).join('');
}

/**
 * Generate an HMAC-SHA256 signature for data using a salt as key.
 * Returns a truncated Base64 string suitable for URL tokens.
 *
 * @param {string} data - The data to sign
 * @param {string} salt - The HMAC key
 * @returns {Promise<string>} - 16-char Base64 signature
 */
export async function generateHmacSignature(data, salt) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw', encoder.encode(salt),
    { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, encoder.encode(data));
  // Safe to spread: HMAC-SHA256 output is always exactly 32 bytes.
  // Do not reuse this pattern for arbitrarily large data (stack overflow risk).
  return btoa(String.fromCharCode(...new Uint8Array(signature))).substring(0, 16);
}

// ============ Ed25519 signing (authorization layer) ============

// Base64 helpers for raw byte arrays (URL-safe-agnostic; links are base64-of-JSON already).
function bytesToBase64(bytes) {
  let bin = '';
  const arr = new Uint8Array(bytes);
  for (let i = 0; i < arr.length; i++) bin += String.fromCharCode(arr[i]);
  return btoa(bin);
}

function base64ToBytes(b64) {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Generate an Ed25519 signing keypair (extractable, for export into links).
 * @returns {Promise<CryptoKeyPair>}
 */
export async function generateSigningKeyPair() {
  return crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
}

/** Export a public key as base64 (raw, 32 bytes). */
export async function exportPublicKey(publicKey) {
  const raw = await crypto.subtle.exportKey('raw', publicKey);
  return bytesToBase64(raw);
}

/** Export a private key as base64 (PKCS8). */
export async function exportPrivateKey(privateKey) {
  const pkcs8 = await crypto.subtle.exportKey('pkcs8', privateKey);
  return bytesToBase64(pkcs8);
}

/** Import a base64 (raw) public key for verification (non-extractable). */
export async function importPublicKey(b64) {
  return crypto.subtle.importKey('raw', base64ToBytes(b64), { name: 'Ed25519' }, false, ['verify']);
}

/** Import a base64 (PKCS8) private key for signing (non-extractable). */
export async function importPrivateKey(b64) {
  return crypto.subtle.importKey('pkcs8', base64ToBytes(b64), { name: 'Ed25519' }, false, ['sign']);
}

/**
 * Sign bytes with an Ed25519 private key.
 * @param {CryptoKey} privateKey - Ed25519 sign key
 * @param {BufferSource} data - bytes to sign
 * @returns {Promise<Uint8Array>} 64-byte signature
 */
export async function signData(privateKey, data) {
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, data);
  return new Uint8Array(sig);
}

/**
 * Verify an Ed25519 signature. Never throws — returns false on any failure.
 * @param {CryptoKey} publicKey - Ed25519 verify key
 * @param {BufferSource} data - signed bytes
 * @param {BufferSource} signature - 64-byte signature
 * @returns {Promise<boolean>}
 */
export async function verifyData(publicKey, data, signature) {
  try {
    return await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signature, data);
  } catch {
    return false;
  }
}
