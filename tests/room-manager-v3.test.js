import { describe, it, expect } from 'vitest';
import { mintRoomCapability, encodeCapabilityHash, decodeCapabilityToken, rotateCapability, joinRoomPath, parseCapabilityHash } from '../js/room-manager.js';
import { verifyCert } from '../js/room-cert.js';
import { verifyCert as vcert } from '../js/room-cert.js';
import { PBKDF2_ITERATIONS, LEGACY_PBKDF2_ITERATIONS, MAX_PBKDF2_ITERATIONS } from '../js/config.js';

describe('v3 capability links', () => {
  it('mints an owner capability with both keys + a valid cert', async () => {
    const cap = await mintRoomCapability('pw');
    expect(cap.version).toBe(3);
    expect(cap.role).toBe('owner');
    expect(cap.epoch).toBe(1);
    expect(cap.skO && cap.skE && cap.pkO && cap.pkE).toBeTruthy();
    expect(await verifyCert(cap.pkO, cap.cert)).toEqual({ epoch: 1, editorPub: cap.pkE });
  });

  it('owner link decodes to owner role with skO', async () => {
    const cap = await mintRoomCapability('pw');
    const dec = decodeCapabilityToken(encodeCapabilityHash(cap, 'owner'));
    expect(dec.role).toBe('owner');
    expect(dec.skO).toBe(cap.skO);
    expect(dec.skE).toBe(cap.skE);
  });

  it('editor link drops skO but keeps skE', async () => {
    const cap = await mintRoomCapability('pw');
    const dec = decodeCapabilityToken(encodeCapabilityHash(cap, 'edit'));
    expect(dec.role).toBe('edit');
    expect(dec.skO).toBeNull();
    expect(dec.skE).toBe(cap.skE);
    expect(dec.pkO).toBe(cap.pkO);
    expect(dec.cert).toEqual(cap.cert);
  });

  it('viewer link drops both private keys', async () => {
    const cap = await mintRoomCapability('pw');
    const dec = decodeCapabilityToken(encodeCapabilityHash(cap, 'view'));
    expect(dec.role).toBe('view');
    expect(dec.skO).toBeNull();
    expect(dec.skE).toBeNull();
    expect(dec.pkE).toBe(cap.pkE);
  });

  it('rejects v1/v2/garbage (hard break)', () => {
    expect(decodeCapabilityToken('garbage')).toBeNull();
    expect(decodeCapabilityToken(btoa(encodeURIComponent(JSON.stringify({ v: 2, p: 'x', pk: 'y', e: 1 }))))).toBeNull();
  });
});

describe('rotateCapability', () => {
  it('keeps the owner key, bumps epoch, new editor key + password + cert', async () => {
    const cap = await mintRoomCapability('pw');
    const next = await rotateCapability(cap, 'pw2');
    expect(next.role).toBe('owner');
    expect(next.epoch).toBe(2);
    expect(next.password).toBe('pw2');
    expect(next.pkO).toBe(cap.pkO);     // SAME room identity
    expect(next.skO).toBe(cap.skO);
    expect(next.pkE).not.toBe(cap.pkE); // NEW editor key
    expect(await vcert(next.pkO, next.cert)).toEqual({ epoch: 2, editorPub: next.pkE });
  });
});

describe('capability KDF iteration count', () => {
  it('mints with the hardened iteration count and round-trips it through a link', async () => {
    const cap = await mintRoomCapability('pw');
    expect(cap.kdf).toBe(PBKDF2_ITERATIONS);
    const dec = decodeCapabilityToken(encodeCapabilityHash(cap, 'owner'));
    expect(dec.kdf).toBe(PBKDF2_ITERATIONS);
  });

  it('defaults a legacy token (no kdf field) to the legacy iteration count', async () => {
    const cap = await mintRoomCapability('pw');
    const token = encodeCapabilityHash(cap, 'view');
    const obj = JSON.parse(decodeURIComponent(atob(token)));
    delete obj.kdf; // simulate a link minted before the hardening
    const legacyToken = btoa(encodeURIComponent(JSON.stringify(obj)));
    expect(decodeCapabilityToken(legacyToken).kdf).toBe(LEGACY_PBKDF2_ITERATIONS);
  });

  it('carries the iteration count across rotation', async () => {
    const cap = await mintRoomCapability('pw');
    const next = await rotateCapability(cap, 'pw2');
    expect(next.kdf).toBe(cap.kdf);
  });

  it('clamps a tampered low kdf up to the legacy floor', async () => {
    const cap = await mintRoomCapability('pw');
    const token = encodeCapabilityHash(cap, 'view');
    const obj = JSON.parse(decodeURIComponent(atob(token)));
    obj.kdf = 1; // attacker downgrades to 1 iteration
    const tampered = btoa(encodeURIComponent(JSON.stringify(obj)));
    expect(decodeCapabilityToken(tampered).kdf).toBe(LEGACY_PBKDF2_ITERATIONS);
  });

  it('clamps an absurdly high kdf down to the ceiling', async () => {
    const cap = await mintRoomCapability('pw');
    const token = encodeCapabilityHash(cap, 'view');
    const obj = JSON.parse(decodeURIComponent(atob(token)));
    obj.kdf = 999999999;
    const tampered = btoa(encodeURIComponent(JSON.stringify(obj)));
    expect(decodeCapabilityToken(tampered).kdf).toBe(MAX_PBKDF2_ITERATIONS);
  });
});

describe('capability per-room salt', () => {
  it('mints a random salt and round-trips it through every link role', async () => {
    const cap = await mintRoomCapability('pw');
    expect(typeof cap.salt).toBe('string');
    expect(cap.salt.length).toBeGreaterThan(0);
    for (const role of ['owner', 'edit', 'view']) {
      const dec = decodeCapabilityToken(encodeCapabilityHash(cap, role));
      expect(dec.salt).toBe(cap.salt);
    }
  });

  it('preserves the salt across rotation (same room identity)', async () => {
    const cap = await mintRoomCapability('pw');
    const next = await rotateCapability(cap, 'pw2');
    expect(next.salt).toBe(cap.salt);
  });

  it('decodes a legacy token (no salt field) to salt = null', async () => {
    const cap = await mintRoomCapability('pw');
    const obj = JSON.parse(decodeURIComponent(atob(encodeCapabilityHash(cap, 'view'))));
    delete obj.salt;
    const legacy = btoa(encodeURIComponent(JSON.stringify(obj)));
    expect(decodeCapabilityToken(legacy).salt).toBeNull();
  });
});

describe('joinRoomPath (capability rooms are link-join only)', () => {
  it('builds a bare /room/<id> path and never embeds a capability', () => {
    expect(joinRoomPath('abc123')).toBe('/room/abc123');
  });

  it('ignores any password argument (no minted owner token in the path)', () => {
    expect(joinRoomPath('abc123', 'secret')).toBe('/room/abc123');
  });

  it('trims and returns null for empty input', () => {
    expect(joinRoomPath('   ')).toBeNull();
    expect(joinRoomPath('')).toBeNull();
  });
});

describe('parseCapabilityHash', () => {
  it('returns null when there is no fragment (open room)', () => {
    expect(parseCapabilityHash('')).toBeNull();
    expect(parseCapabilityHash('#')).toBeNull();
  });

  it('throws when a fragment is present but cannot be decoded', () => {
    expect(() => parseCapabilityHash('#not-a-valid-token')).toThrow();
  });

  it('returns the capability for a valid fragment', async () => {
    const cap = await mintRoomCapability('pw');
    const hash = '#' + encodeCapabilityHash(cap, 'view');
    expect(parseCapabilityHash(hash).role).toBe('view');
  });
});
