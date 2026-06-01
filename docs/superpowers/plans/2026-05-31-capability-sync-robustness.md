# Capability & Sync Robustness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close four lower-severity edge cases in the capability/sync layer: a latent `joinRoom` footgun that mints a ghost room, a superseded viewer that can relay stale-epoch snapshots, a malformed-fragment fallback that silently downgrades to open-room editor mode, and a `ws://` downgrade triggerable by a dotless hostname.

**Architecture:** Each fix extracts the risky logic into a small **pure function** so it is unit-testable in Vitest, then routes the existing call site through it. None of these change the cryptographic guarantees — they remove silent-failure / footgun behavior around them.

**Tech Stack:** Y.js, `SignedDocSync`, `partysocket` transport, Vitest. Tests in `tests/*.test.js`, run with `npm test`.

Project Hub tasks covered: **708** (Task 1), **709** (Task 2), **710** (Task 3), **711** (Task 4).

---

### Task 1: Stop `joinRoom` from minting a ghost owner capability (Hub #708, LOW)

**Files:**
- Modify: `js/room-manager.js:101-110` (`joinRoom`)
- Test: `tests/room-manager-v3.test.js` (extend — test the extracted path builder)

**Background:** `joinRoom(roomId, password)` currently calls `mintRoomCapability(password)`, generating a brand-new owner keypair unrelated to the room → an isolated parallel room. Capability rooms are join-by-link only. `joinRoom` has **zero call sites** today, so this is footgun removal, not a live bug. We make the safe path the only path and expose a pure helper to test it (navigation via `window.location.href` is not unit-testable in jsdom).

- [ ] **Step 1: Write the failing test**

Append to `tests/room-manager-v3.test.js`:

```js
import { joinRoomPath } from '../js/room-manager.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- room-manager-v3`
Expected: FAIL — `joinRoomPath is not a function`.

- [ ] **Step 3: Add the pure path builder and rewrite `joinRoom`**

In `js/room-manager.js`, replace the whole `joinRoom` function (lines 101-110):

```js
export async function joinRoom(roomId, password = null) {
  if (!roomId || !roomId.trim()) return;
  const cleanRoomId = roomId.trim();
  if (password) {
    const cap = await mintRoomCapability(password);
    window.location.href = `/room/${cleanRoomId}#${encodeCapabilityHash(cap, 'owner')}`;
  } else {
    window.location.href = `/room/${cleanRoomId}`;
  }
}
```

with:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- room-manager-v3`
Expected: PASS.

- [ ] **Step 5: Confirm `joinRoom` no longer references the minting path**

Run: `grep -n "mintRoomCapability" js/room-manager.js`
Expected: only the definition (line ~50) and `createRoom`'s use remain — NOT inside `joinRoom`.

- [ ] **Step 6: Commit**

```bash
git add js/room-manager.js tests/room-manager-v3.test.js
git commit -m "security: joinRoom never mints a capability (link-join only)"
```

---

### Task 2: Gate `_answerSnapshotRequest` on `_superseded` (Hub #709, LOW)

**Files:**
- Modify: `js/signed-doc-sync.js:182-186`
- Test: `tests/snapshot-cache.test.js` (extend)

- [ ] **Step 1: Write the failing test**

Append to `tests/snapshot-cache.test.js` (the file already imports `Y`, the crypto key helpers, `SignedDocSync`, and `mintRoomCapability`):

```js
function spyTransport() {
  const sent = [];
  return { sent, send(type, payload) { sent.push({ type, payload }); }, onMessage: null };
}

describe('_answerSnapshotRequest superseded guard', () => {
  async function makeViewer(transport) {
    const cap = await mintRoomCapability('pw');
    const v = new SignedDocSync(new Y.Doc(), transport, {
      signed: true, epoch: cap.epoch, isEditor: false, isOwner: false,
      editorSignKey: null,
      editorVerifyKey: await importPublicKey(cap.pkE), editorPubB64: cap.pkE,
      ownerVerifyKey: await importPublicKey(cap.pkO), ownerSignKey: null,
      ownerPubB64: cap.pkO, cert: cap.cert,
    });
    v._latestSnapshot = { payload: new Uint8Array([1, 2, 3]) };
    return v;
  }

  it('relays the cached snapshot when not superseded', async () => {
    const t = spyTransport();
    const v = await makeViewer(t);
    await v._answerSnapshotRequest();
    expect(t.sent.length).toBe(1);
  });

  it('does NOT relay after the room has rotated (superseded)', async () => {
    const t = spyTransport();
    const v = await makeViewer(t);
    v._superseded = true;
    await v._answerSnapshotRequest();
    expect(t.sent.length).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- snapshot-cache`
Expected: FAIL — the superseded case still sends (length 1, expected 0).

- [ ] **Step 3: Add the guard**

In `js/signed-doc-sync.js`, replace `_answerSnapshotRequest` (lines 182-186):

```js
  async _answerSnapshotRequest() {
    // Editors produce a fresh snapshot; anyone with a cached one relays it.
    if (this.isEditor) { await this.emitSnapshot(); return; }
    if (this._latestSnapshot) this.transport.send(MSG.SNAPSHOT, this._latestSnapshot.payload);
  }
```

with:

```js
  async _answerSnapshotRequest() {
    // After rotation this peer holds only stale epoch-N state; never relay it as
    // bootstrap to a new joiner (who may not have the rotate notice yet).
    if (this._superseded) return;
    // Editors produce a fresh snapshot; anyone with a cached one relays it.
    if (this.isEditor) { await this.emitSnapshot(); return; }
    if (this._latestSnapshot) this.transport.send(MSG.SNAPSHOT, this._latestSnapshot.payload);
  }
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- snapshot-cache`
Expected: PASS (both cases).

- [ ] **Step 5: Run the full suite (signed-doc-sync regression check)**

Run: `npm test`
Expected: PASS — existing `signed-doc-sync` and `snapshot-cache` suites unaffected.

- [ ] **Step 6: Commit**

```bash
git add js/signed-doc-sync.js tests/snapshot-cache.test.js
git commit -m "security: don't relay stale snapshot after epoch rotation"
```

---

### Task 3: Hard-reject a malformed URL fragment instead of open-room fallback (Hub #710, LOW)

**Files:**
- Modify: `js/room-manager.js:79-84` (extract `parseCapabilityHash`)
- Modify: app boot site (discovered via grep in Step 5)
- Test: `tests/room-manager-v3.test.js` (extend)

**Design:** We add a pure `parseCapabilityHash(hash)` that returns `null` for an absent fragment (legit open room) but **throws** for a present-but-unparseable fragment (tampered/truncated link). `getCapabilityFromUrl` keeps its current non-throwing behavior (so the `isReadOnly`/`getPasswordFromUrl` helper graph is undisturbed); the app boot path calls `parseCapabilityHash` explicitly to surface the error.

- [ ] **Step 1: Write the failing test**

Append to `tests/room-manager-v3.test.js`:

```js
import { parseCapabilityHash } from '../js/room-manager.js';

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
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- room-manager-v3`
Expected: FAIL — `parseCapabilityHash is not a function`.

- [ ] **Step 3: Add the pure parser and delegate from `getCapabilityFromUrl`**

In `js/room-manager.js`, replace `getCapabilityFromUrl` (lines 79-84):

```js
/** Read the capability from the URL hash (null for unencrypted rooms). */
export function getCapabilityFromUrl() {
  const hash = window.location.hash;
  if (hash && hash.length > 1) return decodeCapabilityToken(hash.substring(1));
  return null;
}
```

with:

```js
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
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- room-manager-v3`
Expected: PASS.

- [ ] **Step 5: Surface the error at app boot**

Find where the room app first reads the capability:

Run: `grep -rn "getCapabilityFromUrl\|getCapabilityFromUrl()" js/app.js js/yjs-setup.js`

At the earliest boot call in `js/app.js` (where the room initializes), add an explicit malformed-link guard BEFORE the existing logic, using the app's existing modal helper (`showAlert` from `js/modal.js`, already used elsewhere):

```js
import { parseCapabilityHash } from './room-manager.js';
// ...inside the boot/init function, before initializeYjs(...):
try {
  parseCapabilityHash(window.location.hash);
} catch {
  await showAlert(
    'This board link is invalid or has been tampered with. Ask the owner for a fresh link.'
  );
  window.location.href = '/';
  return;
}
```

(Adjust `showAlert` import/usage to match how `app.js` already imports modal helpers — confirm with the grep output.)

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, then visit `/room/test#garbage`.
Expected: the alert appears and you are redirected to `/`; visiting `/room/test` (no fragment) still opens an open room normally; a valid capability link still opens.

- [ ] **Step 7: Commit**

```bash
git add js/room-manager.js js/app.js tests/room-manager-v3.test.js
git commit -m "security: reject malformed capability fragment instead of open-room fallback"
```

---

### Task 4: Replace the dotless-host `ws://` heuristic with an explicit loopback check (Hub #711, LOW)

**Files:**
- Modify: `js/sync-provider.js:97-103`
- Test: `tests/ws-host.test.js` (new)

- [ ] **Step 1: Write the failing test**

Create `tests/ws-host.test.js`:

```js
import { describe, it, expect } from 'vitest';
import { isLocalHost } from '../js/sync-provider.js';

describe('isLocalHost', () => {
  it('is true only for canonical loopback hosts', () => {
    expect(isLocalHost('localhost')).toBe(true);
    expect(isLocalHost('127.0.0.1')).toBe(true);
    expect(isLocalHost('0.0.0.0')).toBe(true);
  });

  it('is false for dotless non-loopback names (no ws:// downgrade)', () => {
    expect(isLocalHost('evil')).toBe(false);
    expect(isLocalHost('intranet')).toBe(false);
    expect(isLocalHost('myhost')).toBe(false);
  });

  it('is false for real domains', () => {
    expect(isLocalHost('whiteboard-collab.technical-1.partykit.dev')).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- ws-host`
Expected: FAIL — `isLocalHost` is not exported.

- [ ] **Step 3: Add the exported helper and use it in `connect()`**

In `js/sync-provider.js`, add a module-level export near the top (after the imports):

```js
// ws:// (cleartext) is allowed ONLY for canonical loopback dev hosts. The old
// heuristic also treated any dotless hostname as local, which would silently
// downgrade a non-loopback short name (e.g. an intranet host) to cleartext.
export function isLocalHost(host) {
  return host === 'localhost' || host === '127.0.0.1' || host === '0.0.0.0';
}
```

Replace the inline `isLocal` block inside `connect()` (lines 97-103):

```js
    const host = this.serverUrl.split(':')[0];
    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '0.0.0.0' ||
      !host.includes('.');
    const protocol = isLocal ? 'ws' : 'wss';
```

with:

```js
    const host = this.serverUrl.split(':')[0];
    const protocol = isLocalHost(host) ? 'ws' : 'wss';
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- ws-host`
Expected: PASS.

- [ ] **Step 5: Confirm local dev still uses ws:// and prod uses wss://**

Reasoning check: `npm run dev:all` connects to `localhost` (or `127.0.0.1`) → `isLocalHost` true → `ws://` (correct for local PartyKit). Production `PARTYKIT_HOST = whiteboard-collab.technical-1.partykit.dev` → false → `wss://` (unchanged). Run `npm test` to confirm the full suite is green.

- [ ] **Step 6: Commit**

```bash
git add js/sync-provider.js tests/ws-host.test.js
git commit -m "security: restrict ws:// to canonical loopback hosts only"
```

---

## Self-Review

- **Spec coverage:** #708 → Task 1; #709 → Task 2; #710 → Task 3; #711 → Task 4.
- **Type consistency:** `joinRoomPath` (Task 1), `parseCapabilityHash` (Task 3), and `isLocalHost` (Task 4) are each defined once and imported by their tests/call sites under the same names. `_answerSnapshotRequest`'s guard uses `this._superseded`, the same flag already set by `_handleRotate`/`_applySnapshot`.
- **Risk notes:**
  - Task 3 deliberately keeps `getCapabilityFromUrl` non-throwing (catches internally) so the existing `isReadOnly`/`isEncryptedRoom`/`getPasswordFromUrl` helpers are unaffected; only the boot path opts into the strict `parseCapabilityHash`. Step 5 is discovery-driven (exact `app.js` boot line found by grep) with a concrete pattern and a manual verification gate.
  - Task 1 removes behavior from an uncalled function — verify no future UI wiring reintroduces a password field that calls `joinRoom` expecting a minted capability.
- **No placeholders:** every code step shows full code; the one grep-driven step (Task 3 Step 5) supplies the exact insert and a verification gate rather than a vague "wire it up."
