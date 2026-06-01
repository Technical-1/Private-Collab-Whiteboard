# Key Derivation Hardening Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop a tampered capability link from downgrading PBKDF2 to a trivial iteration count, and replace the static room-ID salt with a per-room random salt carried in the link — without breaking links minted before this change.

**Architecture:** The PBKDF2 iteration count (`kdf`) and (new) `salt` both travel inside the unauthenticated v3 capability token. We (1) clamp `kdf` to a `[floor, ceiling]` on decode, and (2) add an optional `salt` field that `deriveKey` uses when present, falling back to the legacy `whiteboard-${roomId}` salt when absent so existing rooms keep deriving the same key. Both changes are pure-function-testable in Vitest.

**Tech Stack:** Web Crypto (PBKDF2-HMAC-SHA256, AES-256-GCM), Vitest. Constants in `js/config.js`.

Project Hub tasks covered: **706** (Task 1), **707** (Tasks 2-3).

---

### Task 1: Clamp the capability `kdf` to a floor and ceiling (Hub #706, MEDIUM)

**Files:**
- Modify: `js/room-manager.js:38` (decode clamp)
- Modify: `js/config.js` (add `MAX_PBKDF2_ITERATIONS`)
- Test: `tests/room-manager-v3.test.js` (extend the existing `capability KDF iteration count` describe)

- [ ] **Step 1: Write the failing test**

Append a new `it` inside the existing `describe('capability KDF iteration count', ...)` in `tests/room-manager-v3.test.js`:

```js
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
```

Add `MAX_PBKDF2_ITERATIONS` to the config import at the top of the test (line 5):

```js
import { PBKDF2_ITERATIONS, LEGACY_PBKDF2_ITERATIONS, MAX_PBKDF2_ITERATIONS } from '../js/config.js';
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- room-manager-v3`
Expected: FAIL — `MAX_PBKDF2_ITERATIONS` is undefined; clamp not applied (kdf stays 1).

- [ ] **Step 3: Add the ceiling constant**

In `js/config.js`, directly after line 29 (`export const LEGACY_PBKDF2_ITERATIONS = 100000;`):

```js
// Hard bounds applied to the attacker-supplied `kdf` field on decode. Floor =
// legacy count (a tampered link can never derive a weaker key than the oldest
// legitimate rooms). Ceiling prevents a malicious link from pinning a victim to
// a multi-second key derivation.
export const MAX_PBKDF2_ITERATIONS = 5000000;
```

- [ ] **Step 4: Apply the clamp in `decodeCapabilityToken`**

In `js/room-manager.js`, update the import on line 4:

```js
import { PBKDF2_ITERATIONS, LEGACY_PBKDF2_ITERATIONS, MAX_PBKDF2_ITERATIONS } from './config.js';
```

Replace line 38:

```js
      kdf: typeof d.kdf === 'number' ? d.kdf : LEGACY_PBKDF2_ITERATIONS,
```

with:

```js
      // Clamp the attacker-supplied iteration count to [floor, ceiling]. A
      // tampered link cannot downgrade key derivation below the legacy count.
      kdf: Math.min(
        Math.max(
          Number.isInteger(d.kdf) ? d.kdf : LEGACY_PBKDF2_ITERATIONS,
          LEGACY_PBKDF2_ITERATIONS
        ),
        MAX_PBKDF2_ITERATIONS
      ),
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- room-manager-v3`
Expected: PASS, including the existing `round-trips`/`legacy default`/`carries across rotation` cases (legitimate `kdf` of 600000 is within `[100000, 5000000]`, so unchanged).

- [ ] **Step 6: Commit**

```bash
git add js/config.js js/room-manager.js tests/room-manager-v3.test.js
git commit -m "security: clamp capability kdf to [legacy floor, ceiling] on decode"
```

---

### Task 2: Add an optional per-derivation salt to `deriveKey` (Hub #707, part 1)

**Files:**
- Modify: `js/crypto.js:24-51` (deriveKey signature + salt selection); `js/crypto.js:113-121` (verifyPassword passthrough)
- Test: `tests/crypto-kdf.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/crypto-kdf.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- crypto-kdf`
Expected: FAIL — the explicit-salt case throws/derives wrong because `deriveKey` ignores the 4th argument (it currently always uses the room-id salt, so `kSaltA` and `kSaltB` are identical and `decrypt` succeeds, failing the `rejects` assertion).

- [ ] **Step 3: Thread the salt through `deriveKey`**

In `js/crypto.js`, change the signature (line 24) and salt selection (lines 38-44). Replace:

```js
export async function deriveKey(password, roomId, iterations = PBKDF2_ITERATIONS) {
  const encoder = new TextEncoder();
```

with:

```js
export async function deriveKey(password, roomId, iterations = PBKDF2_ITERATIONS, saltB64 = null) {
  const encoder = new TextEncoder();
  // Per-room random salt (carried in the capability link) when present;
  // otherwise the legacy deterministic salt so pre-salt rooms still derive the
  // same key. base64ToBytes is defined below in this module.
  const salt = saltB64 ? base64ToBytes(saltB64) : encoder.encode(`whiteboard-${roomId}`);
```

Then in the `crypto.subtle.deriveKey({ ... })` call, replace the `salt:` line (line 42):

```js
      salt: encoder.encode(`whiteboard-${roomId}`),
```

with:

```js
      salt,
```

- [ ] **Step 4: Pass the salt through `verifyPassword`**

In `js/crypto.js`, change line 113:

```js
export async function verifyPassword(encryptedTestData, password, roomId, iterations = PBKDF2_ITERATIONS) {
```

to:

```js
export async function verifyPassword(encryptedTestData, password, roomId, iterations = PBKDF2_ITERATIONS, saltB64 = null) {
```

and line 115:

```js
    const key = await deriveKey(password, roomId, iterations);
```

to:

```js
    const key = await deriveKey(password, roomId, iterations, saltB64);
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npm test -- crypto-kdf`
Expected: PASS (explicit-salt isolation holds; legacy fallback round-trips).

- [ ] **Step 6: Commit**

```bash
git add js/crypto.js tests/crypto-kdf.test.js
git commit -m "security: support optional per-derivation salt in deriveKey (legacy fallback)"
```

---

### Task 3: Mint, carry, and use a per-room random salt in the capability link (Hub #707, part 2)

**Files:**
- Modify: `js/room-manager.js` (mint salt; add `salt` to all three encoders; decode; rotation passthrough)
- Modify: `js/yjs-setup.js:73` (pass `capability.salt` to `deriveKey`)
- Test: `tests/room-manager-v3.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append a new describe block to `tests/room-manager-v3.test.js`:

```js
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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- room-manager-v3`
Expected: FAIL — `cap.salt` is undefined; decoded tokens have no `salt`.

- [ ] **Step 3: Generate the salt when minting**

In `js/room-manager.js`, update the config import (line 4) to include `SALT_LENGTH`:

```js
import { PBKDF2_ITERATIONS, LEGACY_PBKDF2_ITERATIONS, MAX_PBKDF2_ITERATIONS, SALT_LENGTH } from './config.js';
```

Add a salt helper just below the `encodeLink` helper (after line 8):

```js
// 16 random bytes, base64 — a per-room PBKDF2 salt carried in the capability
// link so the same password in the same room no longer maps to a precomputable
// key (the room id alone is public and shared in URLs).
function randomSaltB64() {
  const bytes = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
```

In `mintRoomCapability` (lines 50-59), add the salt to the returned cap. Replace line 58:

```js
  return { version: 3, role: 'owner', epoch: 1, password, kdf: PBKDF2_ITERATIONS, pkO, skO, pkE, skE, cert };
```

with:

```js
  const salt = randomSaltB64();
  return { version: 3, role: 'owner', epoch: 1, password, kdf: PBKDF2_ITERATIONS, salt, pkO, skO, pkE, skE, cert };
```

- [ ] **Step 4: Add `salt` to all three link encoders**

In `js/room-manager.js`, add `salt: cap.salt` to each encoder object (lines 12, 16, 20). Final forms:

```js
export function encodeOwnerLink(cap) {
  return encodeLink({ v: 3, r: 'owner', e: cap.epoch, p: cap.password, kdf: cap.kdf, salt: cap.salt, pkO: cap.pkO, skO: cap.skO, pkE: cap.pkE, skE: cap.skE, cert: cap.cert });
}
export function encodeEditorLink(cap) {
  return encodeLink({ v: 3, r: 'edit', e: cap.epoch, p: cap.password, kdf: cap.kdf, salt: cap.salt, pkO: cap.pkO, pkE: cap.pkE, skE: cap.skE, cert: cap.cert });
}
export function encodeViewerLink(cap) {
  return encodeLink({ v: 3, r: 'view', e: cap.epoch, p: cap.password, kdf: cap.kdf, salt: cap.salt, pkO: cap.pkO, pkE: cap.pkE, cert: cap.cert });
}
```

- [ ] **Step 5: Read `salt` back in `decodeCapabilityToken`**

In the returned object inside `decodeCapabilityToken` (after the `kdf:` line from Task 1, before `pkO: d.pkO`), add:

```js
      // Per-room salt (absent on pre-salt links => null => deriveKey uses the
      // legacy room-id salt).
      salt: typeof d.salt === 'string' ? d.salt : null,
```

- [ ] **Step 6: Preserve `salt` across rotation**

`rotateCapability` (lines 69-77) already spreads `...ownerCap`, so `salt` is carried automatically. No change needed — the Step 1 rotation test confirms this. (Do NOT mint a new salt on rotation: the room identity, and thus the AES key family, is the same; rotation changes the editor epoch, not the encryption salt.)

- [ ] **Step 7: Use the salt at the derive call site**

In `js/yjs-setup.js`, replace line 73:

```js
    encryptionKey = await deriveKey(password, roomId, capability.kdf);
```

with:

```js
    encryptionKey = await deriveKey(password, roomId, capability.kdf, capability.salt);
```

(`capability.salt` is `null` for legacy links, which `deriveKey` already handles via the legacy-salt fallback from Task 2.)

- [ ] **Step 8: Run the full suite**

Run: `npm test`
Expected: PASS — new salt round-trip/rotation/legacy cases plus all existing crypto, cert, and link tests.

- [ ] **Step 9: Manual interop sanity check (legacy link still opens)**

Reasoning check (no code): a link minted before this change has no `salt` field → `decodeCapabilityToken` returns `salt: null` → `deriveKey(..., null)` uses `whiteboard-${roomId}` → identical key to before. New links carry a real salt and only interoperate with peers who hold the same (salted) link, which is correct — all peers in a room share one link lineage. Confirm `npm run build` succeeds.

- [ ] **Step 10: Commit**

```bash
git add js/room-manager.js js/yjs-setup.js tests/room-manager-v3.test.js
git commit -m "security: per-room random PBKDF2 salt carried in capability link"
```

---

## Self-Review

- **Spec coverage:** #706 → Task 1; #707 → Tasks 2 (deriveKey support) + 3 (mint/carry/use).
- **Type consistency:** `MAX_PBKDF2_ITERATIONS` defined in Task 1 Step 3 is imported identically in the test and in `room-manager.js`. `deriveKey(password, roomId, iterations, saltB64)` 4-arg signature from Task 2 matches the call sites updated in Task 3 Step 7 and `verifyPassword`. `cap.salt` (string|null) is produced in mint, encoded in all three links, decoded back, and consumed in `yjs-setup` — same name and nullability throughout.
- **Backward compatibility:** the legacy-fallback path (no `salt` → room-id salt; `kdf` absent → legacy count) is preserved and explicitly tested, so links minted before this work keep functioning.
- **No placeholders:** every step shows full code and exact line targets. Token-format note: `salt` is an additive optional field on the existing v3 token — it is NOT a version bump, and old decoders simply ignore it while new decoders tolerate its absence.
