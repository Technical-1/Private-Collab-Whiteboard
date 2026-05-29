# View-Only Capability Crypto — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make view-only links cryptographically un-bypassable — a hostile viewer cannot alter the board — while keeping the system fully peer-to-peer (the PartyKit server stays a dumb relay).

**Architecture:** Editors hold an Ed25519 private key (in the link, independent of the password). Every Y.js update is signed; clients verify the signature against their link's public key *before* `Y.applyUpdate`. Unsigned/invalid/wrong-epoch updates are dropped, so a viewer's inserts, deletes, moves, and clears are never applied by any honest peer. New joiners bootstrap from an editor-signed full-state snapshot (relayable by anyone). The AES layer is retained for confidentiality; signing is the authorization layer on top.

**Tech Stack:** Vanilla ES modules, Y.js, y-indexeddb, PartyKit (relay), Web Crypto (AES-GCM + Ed25519), lib0 encoding, Vite, Vitest (new).

**Spec:** `docs/superpowers/specs/2026-05-29-view-only-capability-crypto-design.md`

---

## Prerequisites & Conventions

- **Branch:** `feature/view-only-capability-crypto`. This plan depends on the 8 fixes in PR #1 (`fix/investigation-findings`). **Before starting Task 1, ensure PR #1 is merged to `main` and rebase this branch on `main`** (it touches the same files: `crypto.js`, `room-manager.js`, `sync-provider.js`, `yjs-setup.js`).
- **TDD:** Every behavioral task writes a failing test first, watches it fail, implements, watches it pass, commits.
- **Test runtime:** Vitest in Node 24 (native Web Crypto Ed25519 + AES-GCM). `globalThis.crypto` is available in Node 20+.
- **Key encoding decision (implementation note, refines spec §1):** The editor link stores **both** `sk` (private, base64 PKCS8) and `pk` (public, base64 raw-32). Web Crypto cannot cheaply derive a public key from a PKCS8 private key, and `pk` is non-secret, so carrying both is simplest. Viewer links store only `pk`.
- **Commit author:** ensure `git config user.email` is `51518860+Technical-1@users.noreply.github.com` before committing (repo guard enforces this).
- **Commit message trailer** (append to every commit body):
  ```
  Generated with [Claude Code](https://claude.ai/code)
  via [Happy](https://happy.engineering)

  Co-Authored-By: Claude <noreply@anthropic.com>
  Co-Authored-By: Happy <yesreply@happy.engineering>
  ```
  (Trailer omitted from the example commit commands below for brevity — include it.)

---

## Task 1: Stand up the Vitest harness

**Files:**
- Modify: `package.json`
- Create: `vitest.config.js`
- Create: `tests/smoke.test.js`

- [ ] **Step 1: Add Vitest and a test script**

Edit `package.json` — add to `devDependencies` and `scripts`:

```json
{
  "scripts": {
    "dev": "vite",
    "dev:party": "partykit dev",
    "dev:all": "concurrently \"npm run dev\" \"npm run dev:party\"",
    "build": "vite build",
    "preview": "vite preview",
    "deploy:party": "partykit deploy",
    "generate-icons": "node scripts/generate-icons.js",
    "test": "vitest run"
  },
  "devDependencies": {
    "concurrently": "^8.2.2",
    "sharp": "^0.34.5",
    "vite": "^5.0.0",
    "vitest": "^2.1.0"
  }
}
```

- [ ] **Step 2: Create the Vitest config (Node environment)**

Create `vitest.config.js`:

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
  },
});
```

- [ ] **Step 3: Write a smoke test that proves Web Crypto is present**

Create `tests/smoke.test.js`:

```js
import { describe, it, expect } from 'vitest';

describe('test harness', () => {
  it('has Web Crypto with Ed25519 + AES-GCM', async () => {
    expect(globalThis.crypto?.subtle).toBeDefined();
    const kp = await crypto.subtle.generateKey({ name: 'Ed25519' }, true, ['sign', 'verify']);
    expect(kp.publicKey).toBeDefined();
  });
});
```

- [ ] **Step 4: Install and run**

Run: `npm install && npm test`
Expected: 1 passing test. (If Ed25519 throws, the Node version is too old — require Node ≥ 20.)

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json vitest.config.js tests/smoke.test.js
git commit -m "test: add Vitest harness (Node env, Web Crypto smoke test)"
```

---

## Task 2: Ed25519 primitives in `crypto.js`

**Files:**
- Modify: `js/crypto.js` (append new exports; keep existing AES functions)
- Create: `tests/crypto-signing.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/crypto-signing.test.js`:

```js
import { describe, it, expect } from 'vitest';
import {
  generateSigningKeyPair,
  exportPublicKey, exportPrivateKey,
  importPublicKey, importPrivateKey,
  signData, verifyData,
} from '../js/crypto.js';

const enc = new TextEncoder();

describe('Ed25519 primitives', () => {
  it('signs and verifies a round trip', async () => {
    const kp = await generateSigningKeyPair();
    const data = enc.encode('hello');
    const sig = await signData(kp.privateKey, data);
    expect(sig).toBeInstanceOf(Uint8Array);
    expect(sig.length).toBe(64);
    expect(await verifyData(kp.publicKey, data, sig)).toBe(true);
  });

  it('rejects tampered data', async () => {
    const kp = await generateSigningKeyPair();
    const sig = await signData(kp.privateKey, enc.encode('hello'));
    expect(await verifyData(kp.publicKey, enc.encode('hellp'), sig)).toBe(false);
  });

  it('rejects a wrong key', async () => {
    const a = await generateSigningKeyPair();
    const b = await generateSigningKeyPair();
    const sig = await signData(a.privateKey, enc.encode('hello'));
    expect(await verifyData(b.publicKey, enc.encode('hello'), sig)).toBe(false);
  });

  it('export/import round trips and still verifies', async () => {
    const kp = await generateSigningKeyPair();
    const pkB64 = await exportPublicKey(kp.publicKey);
    const skB64 = await exportPrivateKey(kp.privateKey);
    expect(typeof pkB64).toBe('string');
    expect(typeof skB64).toBe('string');

    const pub = await importPublicKey(pkB64);
    const priv = await importPrivateKey(skB64);
    const data = enc.encode('roundtrip');
    const sig = await signData(priv, data);
    expect(await verifyData(pub, data, sig)).toBe(true);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/crypto-signing.test.js`
Expected: FAIL — `generateSigningKeyPair is not a function`.

- [ ] **Step 3: Implement the primitives**

Append to `js/crypto.js`:

```js
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

/** Import a base64 (raw) public key for verification. */
export async function importPublicKey(b64) {
  return crypto.subtle.importKey('raw', base64ToBytes(b64), { name: 'Ed25519' }, true, ['verify']);
}

/** Import a base64 (PKCS8) private key for signing. */
export async function importPrivateKey(b64) {
  return crypto.subtle.importKey('pkcs8', base64ToBytes(b64), { name: 'Ed25519' }, true, ['sign']);
}

/**
 * Sign bytes with an Ed25519 private key.
 * @returns {Promise<Uint8Array>} 64-byte signature
 */
export async function signData(privateKey, data) {
  const sig = await crypto.subtle.sign({ name: 'Ed25519' }, privateKey, data);
  return new Uint8Array(sig);
}

/**
 * Verify an Ed25519 signature. Never throws — returns false on any failure.
 * @returns {Promise<boolean>}
 */
export async function verifyData(publicKey, data, signature) {
  try {
    return await crypto.subtle.verify({ name: 'Ed25519' }, publicKey, signature, data);
  } catch {
    return false;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/crypto-signing.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add js/crypto.js tests/crypto-signing.test.js
git commit -m "feat(crypto): add Ed25519 keygen, sign/verify, key import/export"
```

---

## Task 3: Signed-envelope codec + message types in `protocol.js`

**Files:**
- Create: `js/protocol.js`
- Create: `tests/protocol.test.js`

The envelope binds an update to its epoch and signature so a relay/peer cannot strip or swap them. Layout uses lib0 encoding: `varUint(epoch)`, `varUint8Array(update)`, `varUint8Array(sig)`.

- [ ] **Step 1: Write failing tests**

Create `tests/protocol.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { generateSigningKeyPair } from '../js/crypto.js';
import {
  MSG, encodeEnvelope, decodeEnvelope, signUpdate, verifyUpdate,
} from '../js/protocol.js';

describe('protocol message types', () => {
  it('exposes stable numeric constants', () => {
    expect(MSG.UPDATE).toBe(0);
    expect(MSG.SNAPSHOT).toBe(1);
    expect(MSG.SNAPSHOT_REQUEST).toBe(2);
    expect(MSG.AWARENESS).toBe(3);
  });
});

describe('envelope codec', () => {
  it('round trips update + epoch + sig', () => {
    const update = new Uint8Array([1, 2, 3, 4]);
    const sig = new Uint8Array(64).fill(7);
    const bytes = encodeEnvelope(update, 5, sig);
    const out = decodeEnvelope(bytes);
    expect(out.epoch).toBe(5);
    expect(Array.from(out.update)).toEqual([1, 2, 3, 4]);
    expect(out.sig.length).toBe(64);
  });
});

describe('signUpdate / verifyUpdate', () => {
  it('verifies a signed update at the matching epoch', async () => {
    const kp = await generateSigningKeyPair();
    const update = new Uint8Array([9, 8, 7]);
    const sig = await signUpdate(kp.privateKey, update, 2);
    expect(await verifyUpdate(kp.publicKey, update, 2, sig)).toBe(true);
  });

  it('fails when the epoch differs', async () => {
    const kp = await generateSigningKeyPair();
    const update = new Uint8Array([9, 8, 7]);
    const sig = await signUpdate(kp.privateKey, update, 2);
    expect(await verifyUpdate(kp.publicKey, update, 3, sig)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/protocol.test.js`
Expected: FAIL — cannot import from `js/protocol.js`.

- [ ] **Step 3: Implement `protocol.js`**

Create `js/protocol.js`:

```js
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { signData, verifyData } from './crypto.js';

// Wire message types (1-byte prefix on the transport).
export const MSG = {
  UPDATE: 0,
  SNAPSHOT: 1,
  SNAPSHOT_REQUEST: 2,
  AWARENESS: 3,
};

/**
 * Build the signed payload bytes: epoch ‖ update ‖ sig.
 * @param {Uint8Array} update
 * @param {number} epoch
 * @param {Uint8Array} sig - 64-byte Ed25519 signature
 * @returns {Uint8Array}
 */
export function encodeEnvelope(update, epoch, sig) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, epoch);
  encoding.writeVarUint8Array(enc, update);
  encoding.writeVarUint8Array(enc, sig);
  return encoding.toUint8Array(enc);
}

/**
 * Parse a signed payload.
 * @param {Uint8Array} bytes
 * @returns {{ epoch: number, update: Uint8Array, sig: Uint8Array }}
 */
export function decodeEnvelope(bytes) {
  const dec = decoding.createDecoder(bytes);
  const epoch = decoding.readVarUint(dec);
  const update = decoding.readVarUint8Array(dec);
  const sig = decoding.readVarUint8Array(dec);
  return { epoch, update, sig };
}

// The signed message is the update bytes prefixed by the epoch, so a signature
// from one epoch can't be replayed as another.
function signedBytes(update, epoch) {
  const enc = encoding.createEncoder();
  encoding.writeVarUint(enc, epoch);
  encoding.writeVarUint8Array(enc, update);
  return encoding.toUint8Array(enc);
}

/** Sign an update for a given epoch. @returns {Promise<Uint8Array>} */
export async function signUpdate(privateKey, update, epoch) {
  return signData(privateKey, signedBytes(update, epoch));
}

/** Verify a signed update for a given epoch. @returns {Promise<boolean>} */
export async function verifyUpdate(publicKey, update, epoch, sig) {
  return verifyData(publicKey, signedBytes(update, epoch), sig);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/protocol.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add js/protocol.js tests/protocol.test.js
git commit -m "feat(protocol): signed-envelope codec, message types, signUpdate/verifyUpdate"
```

---

## Task 4: v2 capability links in `room-manager.js`

**Files:**
- Modify: `js/room-manager.js`
- Create: `tests/room-manager-links.test.js`

Replaces the HMAC token scheme. A capability object is:
`{ version: 2, password, role: 'edit'|'view', epoch, privateKeyB64|null, publicKeyB64 }`.

- [ ] **Step 1: Write failing tests**

Create `tests/room-manager-links.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { generateSigningKeyPair, exportPublicKey, exportPrivateKey } from '../js/crypto.js';
import {
  encodeEditorLink, encodeViewerLink, decodeCapabilityToken,
} from '../js/room-manager.js';

async function freshKeys() {
  const kp = await generateSigningKeyPair();
  return { pk: await exportPublicKey(kp.publicKey), sk: await exportPrivateKey(kp.privateKey) };
}

describe('v2 capability links', () => {
  it('editor link decodes to an edit capability with both keys', async () => {
    const { pk, sk } = await freshKeys();
    const token = encodeEditorLink('pw', sk, pk, 1);
    const cap = decodeCapabilityToken(token);
    expect(cap.version).toBe(2);
    expect(cap.role).toBe('edit');
    expect(cap.password).toBe('pw');
    expect(cap.epoch).toBe(1);
    expect(cap.privateKeyB64).toBe(sk);
    expect(cap.publicKeyB64).toBe(pk);
  });

  it('viewer link decodes to a view capability with no private key', async () => {
    const { pk } = await freshKeys();
    const token = encodeViewerLink('pw', pk, 4);
    const cap = decodeCapabilityToken(token);
    expect(cap.role).toBe('view');
    expect(cap.epoch).toBe(4);
    expect(cap.privateKeyB64).toBeNull();
    expect(cap.publicKeyB64).toBe(pk);
  });

  it('an editor link missing sk is downgraded to view', async () => {
    const { pk } = await freshKeys();
    // Hand-build a malformed token: role edit but no sk.
    const token = btoa(encodeURIComponent(JSON.stringify({ v: 2, p: 'pw', r: 'edit', e: 1, pk })));
    const cap = decodeCapabilityToken(token);
    expect(cap.role).toBe('view');
    expect(cap.privateKeyB64).toBeNull();
  });

  it('returns null for legacy/garbage tokens (hard break)', () => {
    expect(decodeCapabilityToken('not-base64-json')).toBeNull();
    expect(decodeCapabilityToken(btoa(encodeURIComponent(JSON.stringify({ v: 1, p: 'x' }))))).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/room-manager-links.test.js`
Expected: FAIL — `encodeEditorLink is not a function`.

- [ ] **Step 3: Implement v2 link functions**

In `js/room-manager.js`, **remove** the HMAC/legacy helpers (`generateSignature`, `verifySignature`, `generateLegacySignature`, `verifyLegacySignature`, `encodeAccessToken`, `decodeAccessToken`, and the `HMAC_SALT`/`LEGACY_SIGNATURE_SALT` constants) and the `generateHmacSignature` import. Add:

```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/room-manager-links.test.js`
Expected: PASS (4 tests).

- [ ] **Step 5: Commit**

```bash
git add js/room-manager.js tests/room-manager-links.test.js
git commit -m "feat(room-manager): v2 capability links (editor/viewer), drop HMAC tokens"
```

---

## Task 5: Room creation + URL capability helpers in `room-manager.js`

**Files:**
- Modify: `js/room-manager.js`
- Create: `tests/room-manager-capability.test.js`

Rework `createRoom`/`joinRoom`/`getAccessFromUrl` and friends onto the capability model. Room creation now mints a keypair.

- [ ] **Step 1: Write failing tests** (pure helpers only; URL/`window` flows are verified manually)

Create `tests/room-manager-capability.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { mintRoomCapability, capabilityRole } from '../js/room-manager.js';

describe('room capability minting', () => {
  it('mints an editor capability with a fresh keypair', async () => {
    const cap = await mintRoomCapability('pw');
    expect(cap.role).toBe('edit');
    expect(cap.epoch).toBe(1);
    expect(cap.privateKeyB64).toBeTruthy();
    expect(cap.publicKeyB64).toBeTruthy();
    expect(cap.password).toBe('pw');
  });

  it('capabilityRole reads the role', async () => {
    const cap = await mintRoomCapability('pw');
    expect(capabilityRole(cap)).toBe('edit');
    expect(capabilityRole({ role: 'view' })).toBe('view');
    expect(capabilityRole(null)).toBe('view');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/room-manager-capability.test.js`
Expected: FAIL — `mintRoomCapability is not a function`.

- [ ] **Step 3: Implement capability minting + rework URL helpers**

Add to `js/room-manager.js` (and update the `import` at the top to include the crypto helpers):

```js
import { generateRoomId } from './utils.js';
import {
  generateSigningKeyPair, exportPublicKey, exportPrivateKey,
} from './crypto.js';
```

```js
/**
 * Mint a brand-new editor capability for a room: random password-independent
 * Ed25519 keypair at epoch 1.
 * @param {string} password
 * @returns {Promise<Capability>}
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
```

Then rework the URL/flow functions to use capabilities. Replace `getAccessFromUrl`, `getPasswordFromUrl`, `getPermissionFromUrl`, `isReadOnly`, `getShareableLink`, `createRoom`, `joinRoom`:

```js
/**
 * Read the capability from the URL hash. Returns null for unencrypted rooms
 * (no hash) — callers treat null as "no password, view-or-edit per UI".
 */
export function getCapabilityFromUrl() {
  const hash = window.location.hash;
  if (hash && hash.length > 1) {
    return decodeCapabilityToken(hash.substring(1));
  }
  return null;
}

export function getPasswordFromUrl() {
  const cap = getCapabilityFromUrl();
  return cap ? cap.password : null;
}

export function isReadOnly() {
  const cap = getCapabilityFromUrl();
  // Encrypted rooms: role from capability. Unencrypted rooms: always editable.
  return cap ? cap.role === 'view' : false;
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
    // Joiners with a password but no link can only mint a *new* keypair, which
    // would fork the room. In practice, joining an encrypted room requires the
    // shared link; this path is for the join form and creates a fresh editor room.
    const cap = await mintRoomCapability(password);
    window.location.href = `/room/${cleanRoomId}#${encodeCapabilityHash(cap, 'edit')}`;
  } else {
    window.location.href = `/room/${cleanRoomId}`;
  }
}

/**
 * Get a shareable link for the current room at the requested permission level.
 * Editors can mint viewer links (they hold pk); viewers can only share viewer links.
 */
export function getShareableLink(includePassword = false, permission = 'edit') {
  const baseUrl = window.location.origin + window.location.pathname;
  const cap = getCapabilityFromUrl();
  if (!includePassword || !cap) return baseUrl;
  return `${baseUrl}#${encodeCapabilityHash(cap, permission)}`;
}
```

Delete the now-unused `getPermissionFromUrl`, `isEncryptedRoom` (or keep `isEncryptedRoom` rewritten as `!!getCapabilityFromUrl()`), and `updatePassword` (rotation moves to `yjs-setup.changePassword`, Task 10). Keep `copyToClipboard` and `getRoomIdFromUrl` unchanged.

> **Caller note for the executor:** `app.js` currently `await`s `getPasswordFromUrl()`, `isReadOnly()`, `getPermissionFromUrl()`, `getShareableLink()`. These are now synchronous. Task 9 updates those call sites; until then the app may not build — that's expected mid-plan.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/room-manager-capability.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add js/room-manager.js tests/room-manager-capability.test.js
git commit -m "feat(room-manager): capability minting + capability-based URL helpers"
```

---

## Task 6: Transport refactor — `sync-provider.js` becomes typed transport

**Files:**
- Modify: `js/sync-provider.js`

Strip the y-protocols *document* sync. Keep: WebSocket lifecycle, reconnect/backoff, AES encrypt/decrypt, and **awareness** (unchanged, unsigned). Add a generic typed channel: `send(type, payload)` and a `onMessage(type, payload)` callback for the non-awareness types. No new test here (covered via Task 8's protocol tests using a fake transport); this is a structural refactor verified by build + existing manual flows.

- [ ] **Step 1: Replace document-sync internals with a typed channel**

Edit `js/sync-provider.js`:
- Keep the constructor's encryption fields, awareness instance, reconnect state, and `connect/disconnect/destroy`.
- Remove `_sendSyncStep1`, `_broadcastUpdate`, `_handleSyncMessage`, the `ydoc.on('update', ...)` handler, and the `MESSAGE_SYNC` constant usage for docs.
- Replace the message constants and handlers:

```js
import * as awarenessProtocol from 'y-protocols/awareness';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { MSG } from './protocol.js';

// (constructor) add:
//   this._onTypedMessage = options.onMessage || (() => {});   // (type, Uint8Array) => void
//   keep this.awareness, encryption fields, reconnect fields.
// REMOVE the ydoc 'update' handler entirely (signing layer handles doc updates).
```

Replace `_onMessage`:

```js
async _onMessage(event) {
  try {
    const data = new Uint8Array(event.data);
    if (data.length < 1) return;
    const type = data[0];
    let payload = data.slice(1);

    if (type === MSG.AWARENESS) {
      // Awareness is never encrypted/signed (ephemeral, cosmetic).
      this._handleAwarenessMessage(payload);
      return;
    }

    // All other types carry an AES-encrypted signed envelope.
    if (this.isEncrypted && this.decrypt) {
      try {
        payload = await this.decrypt(payload, this.encryptionKey);
      } catch (err) {
        this._onStatus({ status: 'decryption-failed' });
        return;
      }
    }
    this._onTypedMessage(type, payload);
  } catch (error) {
    console.error('Failed to process message:', error);
  }
}
```

Add a public typed send (encrypts everything except awareness):

```js
async send(type, payload) {
  if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
  try {
    let finalPayload = payload;
    if (type !== MSG.AWARENESS && this.isEncrypted && this.encrypt) {
      finalPayload = await this.encrypt(payload, this.encryptionKey);
    }
    const message = new Uint8Array(1 + finalPayload.length);
    message[0] = type;
    message.set(finalPayload, 1);
    this.ws.send(message);
  } catch (error) {
    console.error('Failed to send message:', error);
  }
}
```

Update `_broadcastAwareness` to call `this.send(MSG.AWARENESS, encodedAwareness)` (build the awareness payload with `awarenessProtocol.encodeAwarenessUpdate` + `encoding.writeVarUint8Array` as today). In `_onOpen`, **stop** sending sync-step-1; instead, after connecting, broadcast awareness and notify the signing layer that the socket is open via a status callback (`this._onStatus({ status: 'connected' })`). Keep the resync-interval cleanup added in PR #1 but repurpose/remove the resync timer (the signing layer drives snapshot requests on connect — Task 8). Remove `_resyncInterval` usage if no longer needed.

- [ ] **Step 2: Verify it builds**

Run: `npm run build`
Expected: build succeeds. (Runtime doc sync is wired in Task 8 + Task 9.)

- [ ] **Step 3: Commit**

```bash
git add js/sync-provider.js
git commit -m "refactor(sync-provider): reduce to typed transport (WS + AES + awareness)"
```

---

## Task 7: `signed-doc-sync.js` — verify-before-apply (core guarantee)

**Files:**
- Create: `js/signed-doc-sync.js`
- Create: `tests/signed-doc-sync.test.js`

`SignedDocSync` binds a `Y.Doc` to an injected transport (`{ send(type,payload), set onMessage }`) plus a capability. It is the only thing that calls `Y.applyUpdate` for remote data, and it does so only after signature verification.

- [ ] **Step 1: Write failing tests (in-memory relay)**

Create `tests/signed-doc-sync.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import * as Y from 'yjs';
import {
  generateSigningKeyPair, exportPublicKey, exportPrivateKey, importPrivateKey, importPublicKey,
} from '../js/crypto.js';
import { SignedDocSync } from '../js/signed-doc-sync.js';

// A synchronous in-memory relay: send(type,payload) fans out to all *other* peers' _onMessage.
function makeRelay() {
  const peers = [];
  return {
    attach(peer) { peers.push(peer); },
    transportFor(self) {
      return {
        send: (type, payload) => {
          for (const p of peers) if (p.self !== self) p.onMessage(type, payload);
        },
        onMessage: null,
      };
    },
  };
}

async function editorCap() {
  const kp = await generateSigningKeyPair();
  return {
    role: 'edit', epoch: 1,
    publicKeyB64: await exportPublicKey(kp.publicKey),
    privateKeyB64: await exportPrivateKey(kp.privateKey),
  };
}
function viewerCapFrom(cap) {
  return { role: 'view', epoch: cap.epoch, publicKeyB64: cap.publicKeyB64, privateKeyB64: null };
}

describe('SignedDocSync verify-before-apply', () => {
  it('applies an editor-signed update on a peer', async () => {
    const cap = await editorCap();
    const relay = makeRelay();

    const docA = new Y.Doc(), docB = new Y.Doc();
    const a = new SignedDocSync(docA, relay.transportFor('A'), cap, await importPrivateKey(cap.privateKeyB64), await importPublicKey(cap.publicKeyB64));
    const b = new SignedDocSync(docB, relay.transportFor('B'), viewerCapFrom(cap), null, await importPublicKey(cap.publicKeyB64));
    a.self = 'A'; b.self = 'B';
    relay.attach({ self: 'A', onMessage: (t, p) => a._receive(t, p) });
    relay.attach({ self: 'B', onMessage: (t, p) => b._receive(t, p) });
    await a.start(); await b.start();

    docA.getMap('boards').set('x', 1);
    await a._flush(); // ensure async sign+send completed
    await b._drain();

    expect(docB.getMap('boards').get('x')).toBe(1);
  });

  it('drops an unsigned/forged update from a viewer', async () => {
    const cap = await editorCap();
    const relay = makeRelay();
    const docA = new Y.Doc(), docV = new Y.Doc();
    const editor = new SignedDocSync(docA, relay.transportFor('A'), cap, await importPrivateKey(cap.privateKeyB64), await importPublicKey(cap.publicKeyB64));
    const viewer = new SignedDocSync(docV, relay.transportFor('V'), viewerCapFrom(cap), null, await importPublicKey(cap.publicKeyB64));
    editor.self = 'A'; viewer.self = 'V';
    relay.attach({ self: 'A', onMessage: (t, p) => editor._receive(t, p) });
    relay.attach({ self: 'V', onMessage: (t, p) => viewer._receive(t, p) });
    await editor.start(); await viewer.start();

    // Viewer mutates its own doc and tries to broadcast — must NOT appear on editor.
    docV.getMap('boards').set('evil', 1);
    await viewer._flush();
    await editor._drain();

    expect(docA.getMap('boards').get('evil')).toBeUndefined();
  });
});
```

> Note: the test relies on small test-only helpers `_flush()` / `_drain()` that await the internal sign/apply promise queue. Implement them as part of Step 3.

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/signed-doc-sync.test.js`
Expected: FAIL — cannot import `SignedDocSync`.

- [ ] **Step 3: Implement `signed-doc-sync.js` (update path only for now)**

Create `js/signed-doc-sync.js`:

```js
import * as Y from 'yjs';
import { MSG, encodeEnvelope, decodeEnvelope, signUpdate, verifyUpdate } from './protocol.js';

const REMOTE_ORIGIN = Symbol('signed-doc-sync-remote');

/**
 * Binds a Y.Doc to a transport with editor-signed updates.
 * Only editor-signed, current-epoch updates are ever applied.
 */
export class SignedDocSync {
  /**
   * @param {Y.Doc} doc
   * @param {{send:(type:number,payload:Uint8Array)=>void, onMessage:Function|null}} transport
   * @param {{role:'edit'|'view', epoch:number}} capability
   * @param {CryptoKey|null} privateKey - editor signing key (null for viewers)
   * @param {CryptoKey} publicKey - room verify key (from the link)
   */
  constructor(doc, transport, capability, privateKey, publicKey) {
    this.doc = doc;
    this.transport = transport;
    this.epoch = capability.epoch;
    this.isEditor = capability.role === 'edit' && !!privateKey;
    this.privateKey = privateKey;
    this.publicKey = publicKey;
    this._pending = Promise.resolve(); // serializes async sign/verify work (test hook)

    transport.onMessage = (type, payload) => this._receive(type, payload);

    // Broadcast local editor edits (origin !== REMOTE_ORIGIN means it's ours).
    this._updateHandler = (update, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      if (!this.isEditor) return; // viewers never broadcast doc updates
      this._enqueue(async () => {
        const sig = await signUpdate(this.privateKey, update, this.epoch);
        this.transport.send(MSG.UPDATE, encodeEnvelope(update, this.epoch, sig));
      });
    };
    doc.on('update', this._updateHandler);
  }

  async start() { /* snapshot/bootstrap added in Task 8 */ }

  _enqueue(fn) { this._pending = this._pending.then(fn).catch((e) => console.error(e)); }

  _receive(type, payload) {
    if (type === MSG.UPDATE) this._enqueue(() => this._applySigned(payload));
    // SNAPSHOT / SNAPSHOT_REQUEST handled in Task 8
  }

  async _applySigned(payload) {
    let env;
    try { env = decodeEnvelope(payload); } catch { return; }
    if (env.epoch !== this.epoch) return;                       // wrong epoch -> drop
    const ok = await verifyUpdate(this.publicKey, env.update, env.epoch, env.sig);
    if (!ok) return;                                            // bad sig -> drop
    Y.applyUpdate(this.doc, env.update, REMOTE_ORIGIN);
  }

  destroy() { this.doc.off('update', this._updateHandler); }

  // ----- test hooks -----
  async _flush() { await this._pending; }
  async _drain() { await this._pending; }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/signed-doc-sync.test.js`
Expected: PASS (2 tests).

- [ ] **Step 5: Commit**

```bash
git add js/signed-doc-sync.js tests/signed-doc-sync.test.js
git commit -m "feat(signed-doc-sync): verify-before-apply for editor-signed updates"
```

---

## Task 8: Snapshots + bootstrap in `signed-doc-sync.js`

**Files:**
- Modify: `js/signed-doc-sync.js`
- Modify: `tests/signed-doc-sync.test.js` (add cases)

Editors emit a signed `SNAPSHOT` (full state) on a debounce and on request; a new peer sends `SNAPSHOT_REQUEST` on `start()`; any peer that holds a cached editor-signed snapshot relays it.

- [ ] **Step 1: Add failing tests**

Append to `tests/signed-doc-sync.test.js`:

```js
describe('SignedDocSync snapshot bootstrap', () => {
  it('a late joiner reconstructs state from a relayed snapshot', async () => {
    const cap = await editorCap();
    const relay = makeRelay();
    const docA = new Y.Doc();
    const editor = new SignedDocSync(docA, relay.transportFor('A'), cap, await importPrivateKey(cap.privateKeyB64), await importPublicKey(cap.publicKeyB64));
    editor.self = 'A';
    relay.attach({ self: 'A', onMessage: (t, p) => editor._receive(t, p) });
    await editor.start();
    docA.getMap('boards').set('hello', 'world');
    await editor._flush();
    await editor.emitSnapshot();   // editor publishes a signed snapshot
    await editor._flush();

    // New joiner appears later.
    const docC = new Y.Doc();
    const joiner = new SignedDocSync(docC, relay.transportFor('C'), { role: 'view', epoch: cap.epoch }, null, await importPublicKey(cap.publicKeyB64));
    joiner.self = 'C';
    relay.attach({ self: 'C', onMessage: (t, p) => joiner._receive(t, p) });
    await joiner.start();          // sends SNAPSHOT_REQUEST
    await editor._drain(); await joiner._drain();

    expect(docC.getMap('boards').get('hello')).toBe('world');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/signed-doc-sync.test.js`
Expected: FAIL — `editor.emitSnapshot is not a function`.

- [ ] **Step 3: Implement snapshot logic**

In `js/signed-doc-sync.js`: add a cached latest snapshot, `emitSnapshot()`, request handling, and a debounce on local edits. Update `_receive` and add fields:

```js
// in constructor, after existing fields:
this._latestSnapshot = null; // { payload: Uint8Array } cached editor-signed SNAPSHOT
this._snapshotTimer = null;

// extend the editor update handler to schedule a snapshot after edits:
//   if (this.isEditor) this._scheduleSnapshot();
```

Add methods:

```js
_scheduleSnapshot() {
  if (!this.isEditor) return;
  if (this._snapshotTimer) return;
  this._snapshotTimer = setTimeout(() => {
    this._snapshotTimer = null;
    this._enqueue(() => this.emitSnapshot());
  }, 1000);
}

/** Editor: sign a full-state snapshot, cache it, broadcast it. */
async emitSnapshot() {
  if (!this.isEditor) return;
  const state = Y.encodeStateAsUpdate(this.doc);
  const sig = await signUpdate(this.privateKey, state, this.epoch);
  const payload = encodeEnvelope(state, this.epoch, sig);
  this._latestSnapshot = { payload };
  this.transport.send(MSG.SNAPSHOT, payload);
}

async _applySnapshot(payload) {
  let env;
  try { env = decodeEnvelope(payload); } catch { return; }
  if (env.epoch !== this.epoch) return;
  const ok = await verifyUpdate(this.publicKey, env.update, env.epoch, env.sig);
  if (!ok) return;
  // Cache verified snapshot so we can relay it later (even viewers).
  this._latestSnapshot = { payload };
  Y.applyUpdate(this.doc, env.update, REMOTE_ORIGIN);
}
```

Update `_receive` and `start`:

```js
_receive(type, payload) {
  if (type === MSG.UPDATE) this._enqueue(() => this._applySigned(payload));
  else if (type === MSG.SNAPSHOT) this._enqueue(() => this._applySnapshot(payload));
  else if (type === MSG.SNAPSHOT_REQUEST) this._enqueue(() => this._answerSnapshotRequest());
}

async _answerSnapshotRequest() {
  // Editors produce a fresh snapshot; anyone with a cached one relays it.
  if (this.isEditor) { await this.emitSnapshot(); return; }
  if (this._latestSnapshot) this.transport.send(MSG.SNAPSHOT, this._latestSnapshot.payload);
}

async start() {
  // Ask the room for current state. Editors will also have their own local doc.
  this.transport.send(MSG.SNAPSHOT_REQUEST, new Uint8Array(0));
}
```

Wire `_scheduleSnapshot()` into the editor branch of `_updateHandler` (call it after sending the signed update).

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/signed-doc-sync.test.js`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add js/signed-doc-sync.js tests/signed-doc-sync.test.js
git commit -m "feat(signed-doc-sync): signed snapshots + SNAPSHOT_REQUEST bootstrap"
```

---

## Task 9: Persist the signed-artifact cache to IndexedDB

**Files:**
- Modify: `js/signed-doc-sync.js`
- Create: `tests/snapshot-cache.test.js`

So a viewer can relay to newcomers after reload with no editor online, persist the latest verified snapshot. Use a tiny injectable store interface so it's testable in Node (production passes an IndexedDB-backed impl from `yjs-setup`).

- [ ] **Step 1: Write failing test (in-memory store)**

Create `tests/snapshot-cache.test.js`:

```js
import { describe, it, expect } from 'vitest';
import * as Y from 'yjs';
import {
  generateSigningKeyPair, exportPublicKey, exportPrivateKey, importPrivateKey, importPublicKey,
} from '../js/crypto.js';
import { SignedDocSync } from '../js/signed-doc-sync.js';

function memStore() {
  let v = null;
  return { async load() { return v; }, async save(bytes) { v = bytes; } };
}
const noopTransport = () => ({ send() {}, onMessage: null });

describe('snapshot cache persistence', () => {
  it('loads a persisted snapshot on start and applies it', async () => {
    const kp = await generateSigningKeyPair();
    const pkB64 = await exportPublicKey(kp.publicKey);
    const skB64 = await exportPrivateKey(kp.privateKey);

    // Editor builds a snapshot payload and we capture it into a store.
    const store = memStore();
    const docE = new Y.Doc();
    const editor = new SignedDocSync(docE, noopTransport(), { role: 'edit', epoch: 1 }, await importPrivateKey(skB64), await importPublicKey(pkB64), store);
    docE.getMap('boards').set('k', 'v');
    await editor._flush();
    await editor.emitSnapshot();        // saves to store
    await editor._flush();

    // A fresh viewer with the same store loads it on start().
    const docV = new Y.Doc();
    const viewer = new SignedDocSync(docV, noopTransport(), { role: 'view', epoch: 1 }, null, await importPublicKey(pkB64), store);
    await viewer.start();
    await viewer._drain();
    expect(docV.getMap('boards').get('k')).toBe('v');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/snapshot-cache.test.js`
Expected: FAIL (the cache is not persisted/loaded yet).

- [ ] **Step 3: Add the store param + load/save**

In `js/signed-doc-sync.js`, extend the constructor to accept an optional `store` (`{ load(): Promise<Uint8Array|null>, save(bytes): Promise<void> }`):

```js
constructor(doc, transport, capability, privateKey, publicKey, store = null) {
  // ...existing...
  this.store = store;
}
```

In `emitSnapshot()` and `_applySnapshot()`, after setting `this._latestSnapshot`, persist:

```js
if (this.store) this._enqueue(() => this.store.save(payload));
```

In `start()`, load any persisted snapshot first, verify, apply, then send the request:

```js
async start() {
  if (this.store) {
    const saved = await this.store.load();
    if (saved) await this._applySnapshot(saved);
  }
  this.transport.send(MSG.SNAPSHOT_REQUEST, new Uint8Array(0));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/snapshot-cache.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add js/signed-doc-sync.js tests/snapshot-cache.test.js
git commit -m "feat(signed-doc-sync): persist + reload signed snapshot cache"
```

---

## Task 10: Rotation test for `signed-doc-sync` (epoch lockout)

**Files:**
- Modify: `tests/signed-doc-sync.test.js`

No new production code is expected (epoch checks already exist) — this test pins the lockout guarantee.

- [ ] **Step 1: Add the failing/΄pinning test**

Append to `tests/signed-doc-sync.test.js`:

```js
describe('epoch lockout', () => {
  it('rejects an update signed at a different epoch', async () => {
    const cap = await editorCap();              // epoch 1
    const relay = makeRelay();
    const docA = new Y.Doc(), docB = new Y.Doc();
    // Editor still signs at epoch 1, but the receiver is on epoch 2 (rotated).
    const editor = new SignedDocSync(docA, relay.transportFor('A'), cap, await importPrivateKey(cap.privateKeyB64), await importPublicKey(cap.publicKeyB64));
    const rotated = new SignedDocSync(docB, relay.transportFor('B'), { role: 'view', epoch: 2 }, null, await importPublicKey(cap.publicKeyB64));
    editor.self = 'A'; rotated.self = 'B';
    relay.attach({ self: 'A', onMessage: (t, p) => editor._receive(t, p) });
    relay.attach({ self: 'B', onMessage: (t, p) => rotated._receive(t, p) });
    await editor.start(); await rotated.start();

    docA.getMap('boards').set('stale', 1);
    await editor._flush(); await rotated._drain();
    expect(docB.getMap('boards').get('stale')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run**

Run: `npm test -- tests/signed-doc-sync.test.js`
Expected: PASS (4 tests) — confirms cross-epoch rejection.

- [ ] **Step 3: Commit**

```bash
git add tests/signed-doc-sync.test.js
git commit -m "test(signed-doc-sync): pin epoch-lockout rejection"
```

---

## Task 11: Wire it together in `yjs-setup.js`

**Files:**
- Modify: `js/yjs-setup.js`

Build the capability, derive the AES key, import signing keys, construct the transport (`SyncProvider`) and the `SignedDocSync`, and provide an IndexedDB-backed snapshot store. No unit test (integration is manual + the protocol tests cover the logic); verified by build.

- [ ] **Step 1: Rework `initializeYjs` to accept a capability**

Replace the signature and body of `initializeYjs` so it takes `(roomId, capability)` where `capability` is from `getCapabilityFromUrl()` (or null for unencrypted). Key points:

```js
import * as Y from 'yjs';
import { IndexeddbPersistence } from 'y-indexeddb';
import { SyncProvider } from './sync-provider.js';
import { SignedDocSync } from './signed-doc-sync.js';
import { deriveKey, encrypt, decrypt, importPrivateKey, importPublicKey } from './crypto.js';
import { PARTYKIT_HOST } from './config.js';

export async function initializeYjs(roomId, capability = null) {
  const ydoc = new Y.Doc();
  const boards = ydoc.getMap('boards');

  const password = capability ? capability.password : null;
  const indexeddbKey = password ? `whiteboard-encrypted-${roomId}` : `whiteboard-${roomId}`;
  const indexeddbProvider = new IndexeddbPersistence(indexeddbKey, ydoc);

  let encryptionKey = null, encryptFn = null, decryptFn = null;
  if (password) {
    encryptionKey = await deriveKey(password, roomId);
    encryptFn = encrypt; decryptFn = decrypt;
  }

  // Transport (relay + AES + awareness). No document sync here anymore.
  const provider = new SyncProvider(PARTYKIT_HOST, roomId, ydoc, {
    encryptionKey, encrypt: encryptFn, decrypt: decryptFn,
    onStatus: ({ status }) => dispatchConnectionStatus(
      status === 'connected' || status === 'synced',
      status === 'synced',
      status === 'decryption-failed',
    ),
  });

  await waitForSync(indexeddbProvider, 'synced', 5000);

  // Signing layer (only for encrypted rooms; unencrypted rooms have no capability).
  let signedSync = null;
  if (capability) {
    const publicKey = await importPublicKey(capability.publicKeyB64);
    const privateKey = capability.privateKeyB64 ? await importPrivateKey(capability.privateKeyB64) : null;
    const store = makeSnapshotStore(roomId, capability.epoch);
    signedSync = new SignedDocSync(ydoc, provider, capability, privateKey, publicKey, store);
    await signedSync.start();
  }

  if (!boards.has('default')) boards.set('default', new Y.Array());

  return {
    ydoc, boards, provider, indexeddbProvider, signedSync,
    awareness: provider.awareness,
    isEncrypted: !!password,
    role: capability ? capability.role : 'edit',
    destroy: () => {
      if (signedSync) signedSync.destroy();
      provider.destroy(); indexeddbProvider.destroy(); ydoc.destroy();
    },
  };
}
```

- [ ] **Step 2: Add an IndexedDB-backed snapshot store**

Add to `js/yjs-setup.js` (uses the `idb` global via a minimal wrapper; if no `idb` dep, use a tiny `localStorage` fallback keyed by room+epoch — acceptable since snapshots are bounded and this is only a relay cache):

```js
/**
 * Minimal persisted store for the latest signed snapshot, keyed by room+epoch.
 * Uses localStorage (snapshots are bounded; this is only a relay cache, not the
 * primary doc store which remains in IndexedDB via y-indexeddb).
 */
function makeSnapshotStore(roomId, epoch) {
  const key = `wb-snap-${roomId}-e${epoch}`;
  return {
    async load() {
      const b64 = localStorage.getItem(key);
      if (!b64) return null;
      const bin = atob(b64); const out = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
      return out;
    },
    async save(bytes) {
      let bin = ''; for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
      try { localStorage.setItem(key, btoa(bin)); } catch { /* quota - ignore */ }
    },
  };
}
```

- [ ] **Step 3: Update `changePassword` to rotate the capability (rotation)**

Replace `changePassword` with a rotation flow that mints a **new keypair + epoch**, re-issues the editor link, and reloads:

```js
import { mintRoomCapability, encodeCapabilityHash, getCapabilityFromUrl } from './room-manager.js';

/**
 * Rotate the room: new password + new Ed25519 keypair + bumped epoch.
 * Invalidates all old links. The reloaded editor will emit a fresh snapshot at
 * the new epoch (so new-link holders can bootstrap).
 */
export async function changePassword(roomId, newPassword) {
  const baseUrl = `${window.location.origin}/room/${roomId}`;
  if (newPassword) {
    const current = getCapabilityFromUrl();
    const nextEpoch = current ? current.epoch + 1 : 1;
    const cap = await mintRoomCapability(newPassword);
    cap.epoch = nextEpoch;
    window.location.href = `${baseUrl}#${encodeCapabilityHash(cap, 'edit')}`;
  } else {
    window.location.href = baseUrl;
  }
  window.location.reload();
}
```

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds (after Task 12 fixes `app.js` call sites; if run before Task 12 it may fail on `app.js` — do Task 12 next).

- [ ] **Step 5: Commit**

```bash
git add js/yjs-setup.js
git commit -m "feat(yjs-setup): wire capability + signed-doc-sync + rotation"
```

---

## Task 12: Update `app.js` call sites + role UI + invite links

**Files:**
- Modify: `js/app.js`

`room-manager` helpers are now synchronous and capability-based, and `initializeYjs` takes a capability. Update `main()` accordingly.

- [ ] **Step 1: Update room/capability bootstrap in `main()`**

In `js/app.js`:
- Replace the imports from `room-manager.js` to include `getCapabilityFromUrl` and drop `getPasswordFromUrl`/`getPermissionFromUrl`.
- Replace the password/role acquisition:

```js
const cap = getCapabilityFromUrl();             // null for unencrypted rooms
yjsInstance = await initializeYjs(roomId, cap);
const { boards, awareness, isEncrypted, role } = yjsInstance;

const readOnly = role === 'view';
```

- Remove the old `await isReadOnly()` call; use the `readOnly` computed above. `setReadOnlyMode(readOnly)` stays.
- `getShareableLink(...)` and the copy/invite handlers are now synchronous — remove `await` on them (they return strings directly). The invite modal's `update-invite-link` handler calls `getShareableLink(includePass, permission)` synchronously.

- [ ] **Step 2: Keep change-password wiring**

The change-password button handler already calls `changePassword(roomId, newPassword)` (now async + rotating). Ensure it's `await`ed or fire-and-forget (it reloads anyway). No other change.

- [ ] **Step 3: Add a "waiting for an editor" empty state**

When `role === 'view'` and the board has no content yet (no snapshot received), show the existing loading/empty overlay text "Waiting for an editor…". Reuse `updateStatus`/`updateEmptyState`; set status to `'Waiting for editor'` until the first `board-change` event reports `itemCount > 0` or a snapshot arrives. Minimal: in the `board-change` listener, if `role==='view'` and itemCount===0, show the empty state with that message.

- [ ] **Step 4: Verify build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 5: Commit**

```bash
git add js/app.js
git commit -m "feat(app): capability-based bootstrap, role, sync invite links, waiting state"
```

---

## Task 13: Gate CI + deploy on tests

**Files:**
- Modify: `.github/workflows/ci.yml`
- Modify: `.github/workflows/deploy-partykit.yml`

- [ ] **Step 1: Add `npm test` to CI**

In `.github/workflows/ci.yml`, after the `npm run build` step add:

```yaml
      - run: npm test
```

- [ ] **Step 2: Add `npm test` to the deploy gate**

In `.github/workflows/deploy-partykit.yml`, between `npm run build` and `npx partykit deploy` add:

```yaml
      - run: npm test
```

- [ ] **Step 3: Verify locally**

Run: `npm run build && npm test`
Expected: build succeeds; all test files pass.

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/ci.yml .github/workflows/deploy-partykit.yml
git commit -m "ci: gate build + deploy on npm test"
```

---

## Task 14: Manual verification & PR

**Files:** none (verification + PR)

- [ ] **Step 1: Two-tab manual check (editor + viewer)**

Run `npm run dev:all`. In tab A create an encrypted room (you get an editor link). Use the invite modal to copy a **View Only** link; open it in tab B (incognito).
- Confirm: tab B renders the board, but the toolbar is read-only and drawing is blocked.
- In tab B devtools, attempt `window` Y.js access or replay — confirm tab A's board does **not** change.
- Draw in tab A → appears in tab B.

- [ ] **Step 2: Bootstrap check**

Reload tab B with no editor present (close tab A) → board still renders from the cached signed snapshot. Open a brand-new view link to an empty room → shows "Waiting for an editor…".

- [ ] **Step 3: Rotation check**

In tab A, change the password. Confirm the old tab B link no longer loads new edits (locked out), and a freshly minted view link from tab A works.

- [ ] **Step 4: Push and open PR**

```bash
git push -u origin feature/view-only-capability-crypto
gh pr create --base main --head feature/view-only-capability-crypto \
  --title "View-only enforcement via capability-based signed updates (#6)" \
  --body "Implements the spec in docs/superpowers/specs/2026-05-29-view-only-capability-crypto-design.md. Editors sign every Y.js update; clients verify before applying, so hostile viewers cannot write. Fully P2P. Adds Vitest + gates CI/deploy on tests."
```

- [ ] **Step 5: Confirm CI green**

Run: `gh pr checks` (or watch the Actions tab) — build + test must pass.

---

## Self-Review

**Spec coverage:**
- §1 Trust model & link format → Tasks 2, 4, 5.
- §2 Wire protocol & sync → Tasks 3, 6, 7, 8.
- §3 Persistence & rotation → Tasks 9, 11 (rotation in 11/12).
- §4 Client integration → Tasks 11, 12 (drawing/boards/undo untouched, as designed).
- §5 Error handling/edge cases → Tasks 7 (drop unsigned/wrong-epoch), 8 (no-snapshot waiting state in 12), 10 (epoch lockout).
- §6 Testing → Tasks 1, 13, and the unit/protocol tests throughout; manual checks in 14.

**Placeholder scan:** No TBD/TODO. Each code step shows real code. The only intentional "do later" markers are forward references between tasks (e.g., Task 7 notes snapshots arrive in Task 8), which are resolved within the plan.

**Type/name consistency:** `generateSigningKeyPair`, `exportPublicKey/exportPrivateKey`, `importPublicKey/importPrivateKey`, `signData/verifyData` (crypto); `MSG`, `encodeEnvelope/decodeEnvelope`, `signUpdate/verifyUpdate` (protocol); `encodeEditorLink/encodeViewerLink/decodeCapabilityToken`, `mintRoomCapability`, `capabilityRole`, `encodeCapabilityHash`, `getCapabilityFromUrl` (room-manager); `SignedDocSync` with `start/emitSnapshot/destroy/_receive/_flush/_drain` (signed-doc-sync); `initializeYjs(roomId, capability)` and `changePassword` (yjs-setup) — names are consistent across tasks.

**Known follow-ups (not blockers):** the `joinRoom` password-without-link path mints a new keypair (forks the room); documented inline as a limitation of joining encrypted rooms without the shared link.
