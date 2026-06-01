import { describe, it, expect } from 'vitest';
import { deriveKey, encrypt, decrypt } from '../js/crypto.js';
import { PBKDF2_ITERATIONS, LEGACY_PBKDF2_ITERATIONS } from '../js/config.js';

// The PBKDF2 iteration count must be a parameter that travels with the room link
// so all peers derive the SAME AES key. New rooms use a hardened count; links
// minted before the bump keep deriving with the legacy count.
describe('deriveKey iteration parameter', () => {
  it('round-trips encrypt/decrypt when the same iteration count is used', async () => {
    const k = await deriveKey('pw', 'room', 120000);
    const ct = await encrypt(new Uint8Array([1, 2, 3]), k);
    expect([...(await decrypt(ct, k))]).toEqual([1, 2, 3]);
  });

  it('produces an incompatible key for a different iteration count', async () => {
    const kLegacy = await deriveKey('pw', 'room', LEGACY_PBKDF2_ITERATIONS);
    const kHardened = await deriveKey('pw', 'room', PBKDF2_ITERATIONS);
    const ct = await encrypt(new Uint8Array([9]), kLegacy);
    // A wrong-iteration key fails AES-GCM auth — proving the count must match.
    await expect(decrypt(ct, kHardened)).rejects.toBeTruthy();
  });

  it('defaults to the hardened iteration count (>= OWASP 600k)', async () => {
    expect(PBKDF2_ITERATIONS).toBeGreaterThanOrEqual(600000);
    expect(LEGACY_PBKDF2_ITERATIONS).toBe(100000);
    const kDefault = await deriveKey('pw', 'room');
    const kExplicit = await deriveKey('pw', 'room', PBKDF2_ITERATIONS);
    const ct = await encrypt(new Uint8Array([7]), kDefault);
    expect([...(await decrypt(ct, kExplicit))]).toEqual([7]);
  });
});

describe('deriveKey explicit salt', () => {
  it('uses an explicit salt when provided (different salt => different key)', async () => {
    const data = new Uint8Array([9, 8, 7]);
    const kSaltA = await deriveKey('pw', 'room', 120000, 'AAAAAAAAAAAAAAAAAAAAAA==');
    const kSaltB = await deriveKey('pw', 'room', 120000, 'BBBBBBBBBBBBBBBBBBBBBB==');
    const ct = await encrypt(data, kSaltA);
    // A key from a different salt must NOT decrypt A's ciphertext.
    await expect(decrypt(ct, kSaltB)).rejects.toBeTruthy();
  });

  it('falls back to the legacy room-id salt when no salt is given', async () => {
    // Same password+room+iterations with no explicit salt must round-trip,
    // matching the historical behavior (salt = `whiteboard-${roomId}`).
    const k1 = await deriveKey('pw', 'room', 120000);
    const k2 = await deriveKey('pw', 'room', 120000, null);
    const ct = await encrypt(new Uint8Array([1]), k1);
    expect([...(await decrypt(ct, k2))]).toEqual([1]);
  });
});
