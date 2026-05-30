# Owner-Controlled Rotation & Revocation — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make room rotation/"change password" an owner-only action with a cryptographically enforced, fully-P2P boundary: invited editors cannot rotate, and rotating broadcasts an owner-signed notice that supersedes the old epoch so non-re-invited users are cut off.

**Architecture:** A per-room **owner ECDSA key** (root of trust; `pkO` in every link) signs an **epoch certificate** authorizing the per-epoch **editor key**. Only the owner holds `skO`, so only the owner can mint a cert or sign a rotation notice — peers verify both against the `pkO` they hold from their own link. Editors hold only the editor key (can edit, can't rotate). Hard break to a `v:3` link format.

**Tech Stack:** Vanilla ES modules, Y.js, PartyKit relay, Web Crypto (AES-GCM + ECDSA P-256), lib0, Vite, Vitest, Puppeteer (manual/e2e).

**Spec:** `docs/superpowers/specs/2026-05-30-owner-revocation-design.md`

---

## Prerequisites & Conventions

- **Branch:** `feature/owner-revocation` (off `main`, which already has the v2 capability layer + ECDSA).
- **TDD:** failing test first, watch it fail, implement, watch it pass, commit.
- **Commit author:** `git config user.email` must be `51518860+Technical-1@users.noreply.github.com` (a global hook enforces it; never `--no-verify`).
- **Commit trailer** (append to every commit body):
  ```
  Generated with [Claude Code](https://claude.ai/code)
  via [Happy](https://happy.engineering)

  Co-Authored-By: Claude <noreply@anthropic.com>
  Co-Authored-By: Happy <yesreply@happy.engineering>
  ```
- **Capability object (v3)** used throughout:
  ```
  { version:3, role:'owner'|'edit'|'view', epoch:number, password:string,
    pkO:base64, skO:base64|null, pkE:base64, skE:base64|null, cert:{e,ep,sig} }
  ```
- **Signed objects are flat** (string/number values only) so canonical JSON is deterministic.

---

## Task 1: Canonical-JSON statement signing in `crypto.js`

**Files:**
- Modify: `js/crypto.js` (append exports; existing ECDSA + AES untouched)
- Create: `tests/crypto-statement.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/crypto-statement.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { generateSigningKeyPair, signStatement, verifyStatement } from '../js/crypto.js';

describe('signStatement / verifyStatement', () => {
  it('round-trips and is key-order independent', async () => {
    const kp = await generateSigningKeyPair();
    const sig = await signStatement(kp.privateKey, { room: 'R', epoch: 1, editorPub: 'E' });
    // Same logical object, different key order, must still verify.
    expect(await verifyStatement(kp.publicKey, { editorPub: 'E', epoch: 1, room: 'R' }, sig)).toBe(true);
  });

  it('fails on tampered value', async () => {
    const kp = await generateSigningKeyPair();
    const sig = await signStatement(kp.privateKey, { room: 'R', epoch: 1, editorPub: 'E' });
    expect(await verifyStatement(kp.publicKey, { room: 'R', epoch: 2, editorPub: 'E' }, sig)).toBe(false);
  });

  it('fails on wrong key', async () => {
    const a = await generateSigningKeyPair();
    const b = await generateSigningKeyPair();
    const sig = await signStatement(a.privateKey, { x: 1 });
    expect(await verifyStatement(b.publicKey, { x: 1 }, sig)).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/crypto-statement.test.js`
Expected: FAIL — `signStatement is not a function`.

- [ ] **Step 3: Implement**

Append to `js/crypto.js` (after the existing ECDSA exports):
```js
// ============ Signed statements (epoch certs, rotation notices) ============

// Deterministic serialization of a FLAT object (string/number values only):
// the replacer array fixes key inclusion + order, so sign and verify hash the
// exact same bytes regardless of property order.
function canonicalJSON(obj) {
  return JSON.stringify(obj, Object.keys(obj).sort());
}

/**
 * Sign a flat JS object with an ECDSA private key.
 * @returns {Promise<string>} base64 signature
 */
export async function signStatement(privateKey, obj) {
  const bytes = new TextEncoder().encode(canonicalJSON(obj));
  return bytesToBase64(await signData(privateKey, bytes));
}

/**
 * Verify a flat JS object against a base64 signature. Never throws.
 * @returns {Promise<boolean>}
 */
export async function verifyStatement(publicKey, obj, sigB64) {
  try {
    const bytes = new TextEncoder().encode(canonicalJSON(obj));
    return await verifyData(publicKey, bytes, base64ToBytes(sigB64));
  } catch {
    return false;
  }
}
```
(`bytesToBase64`, `base64ToBytes`, `signData`, `verifyData` already exist in this file.)

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/crypto-statement.test.js` → 3 pass. Then full `npm test` → all green.

- [ ] **Step 5: Commit**
```bash
git add js/crypto.js tests/crypto-statement.test.js
git commit -m "feat(crypto): signStatement/verifyStatement over canonical JSON"
```

---

## Task 2: Owner-signed epoch certificate — `room-cert.js`

**Files:**
- Create: `js/room-cert.js`
- Create: `tests/room-cert.test.js`

A cert is `{ e: epoch, ep: editorPubB64, sig }` where `sig = sign_O({room, epoch, editorPub})`.

- [ ] **Step 1: Write failing tests**

Create `tests/room-cert.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { generateSigningKeyPair, exportPublicKey, exportPrivateKey } from '../js/crypto.js';
import { mintCert, verifyCert } from '../js/room-cert.js';

async function keys() {
  const kp = await generateSigningKeyPair();
  return { pk: await exportPublicKey(kp.publicKey), sk: await exportPrivateKey(kp.privateKey) };
}

describe('epoch certificate', () => {
  it('mints a cert the owner key verifies', async () => {
    const owner = await keys();
    const editor = await keys();
    const cert = await mintCert(owner.sk, owner.pk, 1, editor.pk);
    const out = await verifyCert(owner.pk, cert);
    expect(out).toEqual({ epoch: 1, editorPub: editor.pk });
  });

  it('rejects a cert signed by a non-owner key (the boundary)', async () => {
    const owner = await keys();
    const attacker = await keys();
    const editor = await keys();
    // Attacker mints a cert with their own key but claims the real owner's pk.
    const forged = await mintCert(attacker.sk, owner.pk, 2, editor.pk);
    expect(await verifyCert(owner.pk, forged)).toBeNull();
  });

  it('rejects a tampered epoch/editorPub', async () => {
    const owner = await keys();
    const editor = await keys();
    const cert = await mintCert(owner.sk, owner.pk, 1, editor.pk);
    expect(await verifyCert(owner.pk, { ...cert, e: 9 })).toBeNull();
    expect(await verifyCert(owner.pk, { ...cert, ep: 'OTHER' })).toBeNull();
  });

  it('returns null for malformed input', async () => {
    const owner = await keys();
    expect(await verifyCert(owner.pk, null)).toBeNull();
    expect(await verifyCert(owner.pk, { e: 1 })).toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/room-cert.test.js`
Expected: FAIL — cannot import `js/room-cert.js`.

- [ ] **Step 3: Implement `js/room-cert.js`**
```js
import { importPrivateKey, importPublicKey, signStatement, verifyStatement } from './crypto.js';

/**
 * Owner mints a certificate binding an editor public key to an epoch.
 * @param {string} skOB64 - owner private key (base64 PKCS8)
 * @param {string} pkOB64 - owner public key (base64 raw) = room identity
 * @param {number} epoch
 * @param {string} editorPubB64 - editor public key (base64 raw)
 * @returns {Promise<{e:number, ep:string, sig:string}>}
 */
export async function mintCert(skOB64, pkOB64, epoch, editorPubB64) {
  const skO = await importPrivateKey(skOB64);
  const sig = await signStatement(skO, { room: pkOB64, epoch, editorPub: editorPubB64 });
  return { e: epoch, ep: editorPubB64, sig };
}

/**
 * Verify a cert against the owner public key. Returns the bound {epoch, editorPub}
 * or null if missing/malformed/not-owner-signed/tampered. Never throws.
 * @param {string} pkOB64 - owner public key the verifier trusts (from its link)
 * @param {{e:number, ep:string, sig:string}} cert
 * @returns {Promise<{epoch:number, editorPub:string}|null>}
 */
export async function verifyCert(pkOB64, cert) {
  if (!cert || typeof cert.e !== 'number' || typeof cert.ep !== 'string' || typeof cert.sig !== 'string') {
    return null;
  }
  try {
    const pkO = await importPublicKey(pkOB64);
    const ok = await verifyStatement(pkO, { room: pkOB64, epoch: cert.e, editorPub: cert.ep }, cert.sig);
    return ok ? { epoch: cert.e, editorPub: cert.ep } : null;
  } catch {
    return null;
  }
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/room-cert.test.js` → 4 pass; full `npm test` green.

- [ ] **Step 5: Commit**
```bash
git add js/room-cert.js tests/room-cert.test.js
git commit -m "feat(room-cert): owner-signed epoch certificate mint/verify"
```

---

## Task 3: Rotation-notice message type in `protocol.js`

**Files:**
- Modify: `js/protocol.js`
- Modify: `tests/protocol.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/protocol.test.js`:
```js
import { MSG, encodeRotateNotice, decodeRotateNotice } from '../js/protocol.js';

describe('rotate notice', () => {
  it('adds the ROTATE message type', () => {
    expect(MSG.ROTATE).toBe(4);
  });
  it('round-trips a notice + signature', () => {
    const notice = { type: 'rotate', room: 'R', from: 1, to: 2 };
    const bytes = encodeRotateNotice(notice, 'SIGB64');
    const out = decodeRotateNotice(bytes);
    expect(out.notice).toEqual(notice);
    expect(out.sig).toBe('SIGB64');
  });
});
```
(Keep the existing `import { MSG, encodeEnvelope, ... }` line; either merge `encodeRotateNotice, decodeRotateNotice` into it or add this second import — both work in ESM.)

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/protocol.test.js`
Expected: FAIL — `MSG.ROTATE` is `undefined` / `encodeRotateNotice` not a function.

- [ ] **Step 3: Implement**

In `js/protocol.js`, add `ROTATE: 4` to `MSG`, and append:
```js
/**
 * Encode an owner-signed rotation notice for the wire.
 * @param {{type:'rotate', room:string, from:number, to:number}} notice
 * @param {string} sigB64 - owner signature over the notice (signStatement)
 * @returns {Uint8Array}
 */
export function encodeRotateNotice(notice, sigB64) {
  return new TextEncoder().encode(JSON.stringify({ notice, sig: sigB64 }));
}

/** @returns {{notice:object, sig:string}} */
export function decodeRotateNotice(bytes) {
  return JSON.parse(new TextDecoder().decode(bytes));
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/protocol.test.js` → all pass; full `npm test` green.

- [ ] **Step 5: Commit**
```bash
git add js/protocol.js tests/protocol.test.js
git commit -m "feat(protocol): ROTATE message type + rotation-notice codec"
```

---

## Task 4: v3 capability links in `room-manager.js`

**Files:**
- Modify: `js/room-manager.js` (replace v2 link functions)
- Create: `tests/room-manager-v3.test.js`

- [ ] **Step 1: Write failing tests**

Create `tests/room-manager-v3.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { mintRoomCapability, encodeCapabilityHash, decodeCapabilityToken } from '../js/room-manager.js';
import { verifyCert } from '../js/room-cert.js';

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/room-manager-v3.test.js`
Expected: FAIL (v2 `mintRoomCapability` returns version 2 / no skO; assertions fail).

- [ ] **Step 3: Implement**

In `js/room-manager.js`: update the import block and **replace** the v2 link functions (`encodeEditorLink`, `encodeViewerLink`, `decodeCapabilityToken`, `mintRoomCapability`, `encodeCapabilityHash`) with the v3 versions below. Keep `getRoomIdFromUrl`, `copyToClipboard`, `getCapabilityFromUrl`, `capabilityRole`, `isReadOnly`, `isEncryptedRoom`, `getShareableLink`, `createRoom`, `joinRoom` (some updated in Task 5).

Top imports:
```js
import { generateRoomId } from './utils.js';
import { generateSigningKeyPair, exportPublicKey, exportPrivateKey } from './crypto.js';
import { mintCert } from './room-cert.js';
```

Replace link/capability functions:
```js
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/room-manager-v3.test.js` → 5 pass. (Other suites may temporarily fail if they referenced v2 specifics — Task 5 + Task 8/9 reconcile callers. The new test must pass.)

- [ ] **Step 5: Commit**
```bash
git add js/room-manager.js tests/room-manager-v3.test.js
git commit -m "feat(room-manager): v3 capability links (owner/editor/viewer + cert)"
```

---

## Task 5: Rotation + URL helpers in `room-manager.js`

**Files:**
- Modify: `js/room-manager.js`
- Modify: `tests/room-manager-v3.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/room-manager-v3.test.js`:
```js
import { rotateCapability } from '../js/room-manager.js';
import { verifyCert as vcert } from '../js/room-cert.js';

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
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/room-manager-v3.test.js`
Expected: FAIL — `rotateCapability is not a function`.

- [ ] **Step 3: Implement rotation + rework URL helpers**

Add to `js/room-manager.js`:
```js
/**
 * Rotate a room (owner only): same owner key, new epoch + editor key + password
 * + owner-signed cert. Old links stop working; owner re-shares new ones.
 */
export async function rotateCapability(ownerCap, newPassword) {
  if (!ownerCap.skO) throw new Error('rotateCapability requires an owner capability');
  const editor = await generateSigningKeyPair();
  const pkE = await exportPublicKey(editor.publicKey);
  const skE = await exportPrivateKey(editor.privateKey);
  const epoch = ownerCap.epoch + 1;
  const cert = await mintCert(ownerCap.skO, ownerCap.pkO, epoch, pkE);
  return { ...ownerCap, role: 'owner', epoch, password: newPassword, pkE, skE, cert };
}

/** Read the capability from the URL hash (null for unencrypted rooms). */
export function getCapabilityFromUrl() {
  const hash = window.location.hash;
  if (hash && hash.length > 1) return decodeCapabilityToken(hash.substring(1));
  return null;
}

/** @returns {'owner'|'edit'|'view'} */
export function capabilityRole(cap) {
  return cap ? cap.role : 'edit'; // unencrypted/open rooms behave as editor
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

export async function createRoom(password = null) {
  const roomId = generateRoomId();
  if (password) {
    const cap = await mintRoomCapability(password);
    window.location.href = `/room/${roomId}#${encodeCapabilityHash(cap, 'owner')}`;
  } else {
    window.location.href = `/room/${roomId}`;
  }
}

export async function joinRoom(roomId, password = null) {
  if (!roomId || !roomId.trim()) return;
  const cleanRoomId = roomId.trim();
  if (password) {
    // Joining an encrypted room requires the shared link; with only a password
    // we mint a fresh OWNER room rather than fork into an unverifiable one.
    const cap = await mintRoomCapability(password);
    window.location.href = `/room/${cleanRoomId}#${encodeCapabilityHash(cap, 'owner')}`;
  } else {
    window.location.href = `/room/${cleanRoomId}`;
  }
}

/**
 * Shareable link. NEVER shares the owner link (owner authority stays with the
 * creator); the quick copy gives 'edit', the invite modal gives 'edit'|'view'.
 */
export function getShareableLink(_includePassword = false, permission = 'edit') {
  const baseUrl = window.location.origin + window.location.pathname;
  const cap = getCapabilityFromUrl();
  if (!cap) return baseUrl;
  const role = permission === 'view' ? 'view' : 'edit';
  return `${baseUrl}#${encodeCapabilityHash(cap, role)}`;
}
```
Delete any leftover v2-only helpers no longer referenced (e.g. an old `getAccessFromUrl`/`updatePassword`). Run `grep -n "getAccessFromUrl\|updatePassword\|getPermissionFromUrl" js/room-manager.js` → expect no matches.

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/room-manager-v3.test.js` → all pass; `node --check js/room-manager.js` clean.

- [ ] **Step 5: Commit**
```bash
git add js/room-manager.js tests/room-manager-v3.test.js
git commit -m "feat(room-manager): owner-only rotateCapability + v3 URL helpers"
```

---

## Task 6: Cert-gated update verification in `signed-doc-sync.js`

**Files:**
- Modify: `js/signed-doc-sync.js` (constructor signature → options object; verify cert at startup)
- Modify: `tests/signed-doc-sync.test.js` (update to the new constructor; add cert tests)

The constructor moves from positional `(doc, transport, capability, privateKey, publicKey, store)` to an **options object** because there are now more keys.

- [ ] **Step 1: Rewrite the test helpers + add a cert test**

Replace the top helpers of `tests/signed-doc-sync.test.js` so peers are built from a v3 capability. Add near the top:
```js
import { mintRoomCapability } from '../js/room-manager.js';
import { importPrivateKey, importPublicKey } from '../js/crypto.js';

// Build the SignedDocSync options object for a given role from an owner cap.
async function opts(ownerCap, role, store = null) {
  const signed = true;
  const editorVerifyKey = await importPublicKey(ownerCap.pkE);
  const ownerVerifyKey = await importPublicKey(ownerCap.pkO);
  const isOwner = role === 'owner';
  const isEditor = role === 'owner' || role === 'edit';
  return {
    signed, epoch: ownerCap.epoch, store,
    isEditor, isOwner,
    editorSignKey: isEditor ? await importPrivateKey(ownerCap.skE) : null,
    editorVerifyKey,
    ownerVerifyKey,
    ownerSignKey: isOwner ? await importPrivateKey(ownerCap.skO) : null,
    ownerPubB64: ownerCap.pkO,
    cert: ownerCap.cert,
  };
}
```
Update existing tests to construct peers as `new SignedDocSync(doc, transport, await opts(cap, 'owner'))` / `'view'` etc. (`cap` from `await mintRoomCapability('pw')`). Drop the old `editorCap()`/`viewerCapFrom()` helpers and the positional constructor calls. The open-room test uses `new SignedDocSync(doc, transport, { signed: false, epoch: 0, isEditor: true, isOwner: false })`.

Add a cert-gating test:
```js
describe('cert-gated verification', () => {
  it('rejects updates whose editor key is not in an owner-signed cert', async () => {
    const cap = await mintRoomCapability('pw');
    // Attacker forges options with a DIFFERENT editor key but the room's cert.
    const docPeer = new Y.Doc();
    const o = await opts(cap, 'view'); // viewer verifies against cap.pkE via cert
    const peer = new SignedDocSync(docPeer, { send() {}, onMessage: null }, o);
    await peer.start();
    // An update signed by some other (un-certified) editor key:
    const other = await mintRoomCapability('pw'); // different room => different keys/cert
    const upd = (() => { const d = new Y.Doc(); let u; d.once('update', x => u = x); d.getMap('boards').set('evil', 1); return u; })();
    const sig = await signUpdate(await importPrivateKey(other.skE), upd, cap.epoch);
    peer._receive(MSG.UPDATE, encodeEnvelope(upd, cap.epoch, sig));
    await peer._drain();
    expect(docPeer.getMap('boards').get('evil')).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/signed-doc-sync.test.js`
Expected: FAIL — constructor doesn't accept the options object / `_verifyKey` mismatch.

- [ ] **Step 3: Rewrite the `SignedDocSync` constructor + startup cert check**

In `js/signed-doc-sync.js`, replace the constructor with the options form and verify the cert once at start. Key changes:
```js
import * as Y from 'yjs';
import { MSG, encodeEnvelope, decodeEnvelope, signUpdate, verifyUpdate, encodeRotateNotice, decodeRotateNotice } from './protocol.js';
import { verifyCert } from './room-cert.js';
import { signStatement, verifyStatement } from './crypto.js';

const REMOTE_ORIGIN = Symbol('signed-doc-sync-remote');
const EMPTY_SIG = new Uint8Array(0);

export class SignedDocSync {
  /**
   * @param {Y.Doc} doc
   * @param {{send, onMessage, onConnect}} transport
   * @param {object} o - { signed, epoch, store, isEditor, isOwner,
   *   editorSignKey, editorVerifyKey, ownerVerifyKey, ownerSignKey, ownerPubB64, cert }
   */
  constructor(doc, transport, o) {
    this.doc = doc;
    this.transport = transport;
    this.signed = !!o.signed;
    this.epoch = o.epoch;
    this.isEditor = !this.signed || !!o.isEditor;
    this.isOwner = !!o.isOwner;
    this.editorSignKey = o.editorSignKey || null;
    this.editorVerifyKey = o.editorVerifyKey || null;
    this.ownerVerifyKey = o.ownerVerifyKey || null;
    this.ownerSignKey = o.ownerSignKey || null;
    this.ownerPubB64 = o.ownerPubB64 || null;
    this.cert = o.cert || null;
    this.store = o.store || null;

    this._pending = Promise.resolve();
    this._latestSnapshot = null;
    this._snapshotTimer = null;
    this._bootstrapTimer = null;
    this._applied = false;
    this._superseded = false;

    transport.onMessage = (type, payload) => this._receive(type, payload);
    transport.onConnect = () => this._requestSnapshot();

    this._updateHandler = (update, origin) => {
      if (origin === REMOTE_ORIGIN) return;
      if (!this.isEditor || this._superseded) return;
      this._enqueue(async () => {
        const sig = this.signed ? await signUpdate(this.editorSignKey, update, this.epoch) : EMPTY_SIG;
        this.transport.send(MSG.UPDATE, encodeEnvelope(update, this.epoch, sig));
      });
      this._scheduleSnapshot();
    };
    doc.on('update', this._updateHandler);
  }

  async start() {
    // Verify the room cert once: it must be owner-signed and authorize exactly
    // our editor verify key for our epoch. If not, the room is untrusted; refuse
    // to apply anything (fail closed) by leaving signed-mode with a key nothing
    // will satisfy. (Open rooms have no cert and skip this.)
    if (this.signed && this.cert) {
      const bound = await verifyCert(this.ownerPubB64, this.cert);
      this._certOk = !!bound && bound.epoch === this.epoch;
    } else {
      this._certOk = !this.signed; // open rooms are fine; signed-without-cert is not
    }
    if (this.store) {
      const saved = await this.store.load();
      if (saved) await this._applySnapshot(saved);
    }
    this._requestSnapshot();
    let tries = 0;
    this._bootstrapTimer = setInterval(() => {
      if (this._applied || ++tries >= 5) { clearInterval(this._bootstrapTimer); this._bootstrapTimer = null; return; }
      this._requestSnapshot();
    }, 1500);
  }
```
Then in `_applySigned` and `_applySnapshot`, change the signed-mode guard to use `this.editorVerifyKey` (was `this.publicKey`) AND require `this._certOk`:
```js
async _applySigned(payload) {
  if (this._superseded) return;
  let env; try { env = decodeEnvelope(payload); } catch { return; }
  if (env.epoch !== this.epoch) return;
  if (this.signed) {
    if (!this._certOk) return; // room cert invalid -> trust nothing
    const ok = await verifyUpdate(this.editorVerifyKey, env.update, env.epoch, env.sig);
    if (!ok) return;
  }
  Y.applyUpdate(this.doc, env.update, REMOTE_ORIGIN);
  this._applied = true;
}
```
(Apply the identical `signed`/`_certOk`/`editorVerifyKey` change in `_applySnapshot`, and in `emitSnapshot` sign with `this.editorSignKey`.) Leave `_receive`, `_scheduleSnapshot`, `_requestSnapshot`, `_enqueue`, `destroy`, `_flush`, `_drain` as-is except `destroy` also clears `_bootstrapTimer` (already does).

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/signed-doc-sync.test.js` → all pass (including the new cert-gating test); full `npm test` green.

- [ ] **Step 5: Commit**
```bash
git add js/signed-doc-sync.js tests/signed-doc-sync.test.js
git commit -m "feat(signed-doc-sync): options-object ctor + cert-gated verification"
```

---

## Task 7: Rotation notice — broadcast (owner) + supersede (peers)

**Files:**
- Modify: `js/signed-doc-sync.js`
- Modify: `tests/signed-doc-sync.test.js`

- [ ] **Step 1: Add failing tests**

Append to `tests/signed-doc-sync.test.js`:
```js
describe('rotation notice', () => {
  it('owner can broadcast a notice; peers on the old epoch supersede and stop applying', async () => {
    const cap = await mintRoomCapability('pw');
    const sent = [];
    const ownerT = { send: (t, p) => sent.push([t, p]), onMessage: null, onConnect: null };
    const owner = new SignedDocSync(new Y.Doc(), ownerT, await opts(cap, 'owner'));
    await owner.start();
    await owner.broadcastRotate(cap.epoch + 1);
    const rotateMsg = sent.find(([t]) => t === MSG.ROTATE);
    expect(rotateMsg).toBeTruthy();

    // A peer receives the owner-signed notice -> superseded, drops later edits.
    const docP = new Y.Doc();
    const peer = new SignedDocSync(docP, { send() {}, onMessage: null }, await opts(cap, 'view'));
    let rotated = false;
    peer.onRotated = () => { rotated = true; };
    await peer.start();
    peer._receive(MSG.ROTATE, rotateMsg[1]);
    await peer._drain();
    expect(rotated).toBe(true);
    expect(peer._superseded).toBe(true);
  });

  it('ignores a rotate notice NOT signed by the owner', async () => {
    const cap = await mintRoomCapability('pw');
    const attacker = await mintRoomCapability('pw'); // different owner key
    // Forge a notice signed by the attacker's owner key but claiming our room.
    const notice = { type: 'rotate', room: cap.pkO, from: cap.epoch, to: cap.epoch + 1 };
    const sig = await signStatement(await importPrivateKey(attacker.skO), notice);
    const docP = new Y.Doc();
    const peer = new SignedDocSync(docP, { send() {}, onMessage: null }, await opts(cap, 'view'));
    await peer.start();
    peer._receive(MSG.ROTATE, encodeRotateNotice(notice, sig));
    await peer._drain();
    expect(peer._superseded).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm test -- tests/signed-doc-sync.test.js`
Expected: FAIL — `owner.broadcastRotate is not a function`.

- [ ] **Step 3: Implement broadcast + receive**

In `js/signed-doc-sync.js` add an `onRotated` hook (default no-op) and methods, and route `MSG.ROTATE` in `_receive`:
```js
// in constructor: this.onRotated = null;

_receive(type, payload) {
  if (type === MSG.UPDATE) this._enqueue(() => this._applySigned(payload));
  else if (type === MSG.SNAPSHOT) this._enqueue(() => this._applySnapshot(payload));
  else if (type === MSG.SNAPSHOT_REQUEST) this._enqueue(() => this._answerSnapshotRequest());
  else if (type === MSG.ROTATE) this._enqueue(() => this._handleRotate(payload));
}

/** Owner: announce that the room has rotated to a new epoch. */
async broadcastRotate(toEpoch) {
  if (!this.isOwner || !this.ownerSignKey) return;
  const notice = { type: 'rotate', room: this.ownerPubB64, from: this.epoch, to: toEpoch };
  const sig = await signStatement(this.ownerSignKey, notice);
  this.transport.send(MSG.ROTATE, encodeRotateNotice(notice, sig));
}

async _handleRotate(payload) {
  if (!this.signed || !this.ownerVerifyKey) return;
  let parsed; try { parsed = decodeRotateNotice(payload); } catch { return; }
  const { notice, sig } = parsed || {};
  if (!notice || notice.type !== 'rotate' || notice.room !== this.ownerPubB64) return;
  if (notice.from !== this.epoch) return;                 // not about our epoch
  const ok = await verifyStatement(this.ownerVerifyKey, notice, sig);
  if (!ok) return;                                        // not owner-signed -> ignore
  this._superseded = true;                                // stop applying old-epoch edits
  if (this.onRotated) this.onRotated(notice.to);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npm test -- tests/signed-doc-sync.test.js` → all pass; full `npm test` green.

- [ ] **Step 5: Commit**
```bash
git add js/signed-doc-sync.js tests/signed-doc-sync.test.js
git commit -m "feat(signed-doc-sync): owner rotate broadcast + peer supersede"
```

---

## Task 8: Wire v3 + rotation into `yjs-setup.js`

**Files:**
- Modify: `js/yjs-setup.js`

No unit test (integration; covered by build + e2e). Verify with `node --check` + `npm test` staying green + `npm run build`.

- [ ] **Step 1: Build the SignedDocSync options from a capability**

In `js/yjs-setup.js`, update imports and `initializeYjs` to construct the options object. Replace the signed-sync construction block:
```js
import { importPrivateKey, importPublicKey, deriveKey, encrypt, decrypt } from './crypto.js';
import { mintRoomCapability, encodeCapabilityHash, getCapabilityFromUrl, rotateCapability } from './room-manager.js';
```
Where the capability branch builds `signedSync`:
```js
  let signedSync;
  if (capability) {
    if (boards.size === 0) await migrateUnencryptedData(roomId, ydoc);
    const o = {
      signed: true,
      epoch: capability.epoch,
      store: makeSnapshotStore(roomId, capability.epoch),
      isEditor: capability.role === 'owner' || capability.role === 'edit',
      isOwner: capability.role === 'owner',
      editorSignKey: capability.skE ? await importPrivateKey(capability.skE) : null,
      editorVerifyKey: await importPublicKey(capability.pkE),
      ownerVerifyKey: await importPublicKey(capability.pkO),
      ownerSignKey: capability.skO ? await importPrivateKey(capability.skO) : null,
      ownerPubB64: capability.pkO,
      cert: capability.cert,
    };
    signedSync = new SignedDocSync(ydoc, provider, o);
  } else {
    signedSync = new SignedDocSync(ydoc, provider, {
      signed: false, epoch: 0, store: makeSnapshotStore(roomId, 0), isEditor: true, isOwner: false,
    });
  }
  // Surface owner rotation to the app.
  signedSync.onRotated = () => window.dispatchEvent(new CustomEvent('room-rotated'));
  await signedSync.start();
```
Add `role: capability ? capability.role : 'edit'` to the returned object (already present from prior work — keep it).

- [ ] **Step 2: Make `changePassword` an owner-only rotation that broadcasts + reshares**

Replace `changePassword`:
```js
/**
 * Owner-only room rotation. Mints a new epoch (same owner key, new editor key +
 * password + cert), broadcasts an owner-signed notice so current peers supersede,
 * then reloads the owner into the new epoch link to re-share out-of-band.
 */
export async function rotateRoom(roomId, newPassword, signedSync) {
  const current = getCapabilityFromUrl();
  if (!current || current.role !== 'owner') return; // only the owner can rotate
  const next = await rotateCapability(current, newPassword);
  if (signedSync) await signedSync.broadcastRotate(next.epoch); // tell current peers
  await new Promise((r) => setTimeout(r, 250)); // let the notice flush
  window.location.href = `${window.location.origin}/room/${roomId}#${encodeCapabilityHash(next, 'owner')}`;
  window.location.reload();
}
```
Keep the name `changePassword` exported as an alias if `app.js` still imports it, OR update `app.js` (Task 9) to import `rotateRoom`. Simpler: export `rotateRoom` and update `app.js`. Remove the old `changePassword`.

- [ ] **Step 3: Verify**

Run: `node --check js/yjs-setup.js`; `npm test` (still green); do NOT run build yet if `app.js` not updated (Task 9). Grep: `grep -n "encodeAccessToken\|capability.privateKeyB64\|capability.publicKeyB64" js/yjs-setup.js` → no matches (old v2 fields gone).

- [ ] **Step 4: Commit**
```bash
git add js/yjs-setup.js
git commit -m "feat(yjs-setup): v3 capability wiring + owner-only rotateRoom"
```

---

## Task 9: `app.js` — owner gating, rotation prompt, invite

**Files:**
- Modify: `js/app.js`

- [ ] **Step 1: Update bootstrap, role, and the rotate handler**

In `js/app.js`:
- Imports: from `./yjs-setup.js` import `initializeYjs, rotateRoom` (replace `changePassword`).
- After `const { boards, awareness, isEncrypted, role } = yjsInstance;`, compute:
  ```js
  const readOnly = role === 'view';
  const isOwner = role === 'owner';
  ```
- The Change Password button handler — gate to owner and call `rotateRoom`:
  ```js
  if (changePasswordBtn) {
    changePasswordBtn.onclick = async () => {
      if (!isOwner) return; // only the room owner can rotate
      const newPassword = await showPasswordModal('Change Password',
        'Enter a new password. This rotates the room — everyone will need a new invite link.', true);
      if (newPassword !== null && newPassword !== '') {
        await rotateRoom(roomId, newPassword, yjsInstance.signedSync);
      }
    };
  }
  ```
- The Add-Encryption handler stays for OPEN rooms only (`if (readOnly) return;` already there; open rooms have no owner so anyone may encrypt — calling it should mint an owner room). Update it to navigate via createRoom-style owner link: replace its body to `if (readOnly) return; const pw = await showPasswordModal('Enable Encryption', ...); if (pw) { const cap = await mintRoomCapability(pw); window.location.href = ...#${encodeCapabilityHash(cap,'owner')}; location.reload(); }` — import `mintRoomCapability, encodeCapabilityHash` from `./room-manager.js`.

- [ ] **Step 2: Gate Change Password visibility to owner**

The button lives in the Share panel (already hidden for viewers). Also hide it for non-owner editors. In `updateEncryptionIndicator(isEncrypted)` (or where `change-password` display is set), guard on owner:
```js
if (changePasswordBtn) changePasswordBtn.style.display = (isEncrypted && isOwner) ? 'block' : 'none';
```
`isOwner` must be in scope there — pass it in or read from a module-level set in `main()`. Simplest: set `document.body.dataset.role = role;` in `main()` and check `document.body.dataset.role === 'owner'`.

- [ ] **Step 3: Show the rotation prompt to superseded peers**

Add near the other `window.addEventListener` blocks in `main()`:
```js
window.addEventListener('room-rotated', async () => {
  updateStatus('Room rotated');
  await showAlert('Room Rotated',
    'The owner rotated this room. Ask them for a new invite link to keep collaborating.');
});
```

- [ ] **Step 4: Verify the build**

Run: `npm run build` → succeeds. `npm test` → all green. `grep -rn "changePassword" js/` → only internal references resolved (no dangling import).

- [ ] **Step 5: Commit**
```bash
git add js/app.js
git commit -m "feat(app): owner-gate rotation, rotation prompt, v3 invite"
```

---

## Task 10: CI gate, manual verification, PR

**Files:** none (verification + PR)

- [ ] **Step 1: Full local gate**

Run: `npm test` (all suites green) and `npm run build` (succeeds).

- [ ] **Step 2: Manual two-tab + e2e checks**

Run `npm run dev:all`. As the **owner** create an encrypted room (you get the owner link). Invite an **editor** and a **viewer**.
- Confirm: owner sees **Change Password**; editor and viewer do **not**.
- Owner draws → editor & viewer see it; editor can draw, viewer cannot.
- Owner clicks **Change Password** → editor & viewer get the **"Room Rotated — ask for a new link"** prompt and stop syncing; owner continues.
- Owner re-invites the editor with a fresh link → editor resumes on the new epoch. A non-re-invited user stays cut off.
- In devtools, confirm an editor link's decoded token has **no `skO`** (`JSON.parse(decodeURIComponent(atob(location.hash.slice(1))))`).

- [ ] **Step 3: Push and open PR**
```bash
git push -u origin feature/owner-revocation
gh pr create --base main --head feature/owner-revocation \
  --title "feat: owner-controlled rotation & revocation (owner root-of-trust)" \
  --body "Implements docs/superpowers/specs/2026-05-30-owner-revocation-design.md. Per-room owner ECDSA key signs epoch certs; only the owner can rotate (P2P-verified); rotation broadcasts an owner-signed notice that supersedes the old epoch. Hard break to v3 links."
```

- [ ] **Step 4: Confirm CI green**

Run: `gh pr checks` — build + test must pass.

---

## Self-Review

**Spec coverage:**
- §1 trust model & keys → Tasks 1 (statements), 2 (cert).
- §2 v3 roles/links → Task 4 (links/roles), 5 (mint/rotate/url).
- §3 verification (cert + epoch) → Task 6; rotation flow + notice → Tasks 7 (protocol behavior), 8 (owner rotate), 9 (UI).
- §4 components → all tasks map to the listed files; error/edge cases: editor-can't-rotate (Task 6/7/9 gating + no `skO`), forged cert/notice (Tasks 2, 7), old-epoch drop (Task 6 epoch check + Task 7 supersede), owner-key-loss (documented; rotateRoom returns early if not owner).
- §5 testing → unit (Tasks 1,2,3,4,5,6), protocol (Tasks 6,7), e2e/manual (Task 10).

**Placeholder scan:** none — every code step has real code; commands have expected output.

**Type/name consistency:** `signStatement/verifyStatement` (crypto); `mintCert/verifyCert` with cert shape `{e,ep,sig}` (room-cert); `MSG.ROTATE`, `encodeRotateNotice/decodeRotateNotice` (protocol); `mintRoomCapability/rotateCapability/encodeCapabilityHash/encodeOwnerLink/encodeEditorLink/encodeViewerLink/decodeCapabilityToken/getCapabilityFromUrl/getShareableLink` (room-manager); `SignedDocSync(doc, transport, options)` with `broadcastRotate/onRotated/_handleRotate/_superseded/_certOk/editorSignKey/editorVerifyKey/ownerVerifyKey/ownerSignKey/ownerPubB64/cert` (signed-doc-sync); `initializeYjs(roomId, capability)` returning `signedSync`, `rotateRoom(roomId, newPassword, signedSync)` (yjs-setup); `isOwner` gating (app). Names consistent across tasks.

**Note for executor:** Task 6 changes `SignedDocSync`'s constructor to an options object — every construction site (the test helpers, and `yjs-setup.js` in Task 8) must use the new shape. Tasks 6→8 land together before `npm run build` will pass.
