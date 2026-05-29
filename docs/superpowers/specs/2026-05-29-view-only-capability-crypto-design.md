# View-Only Enforcement via Capability-Based Signed Updates

**Date:** 2026-05-29
**Status:** Design approved; pending spec review
**Investigation finding:** #6 — "View-only role enforcement is trivially bypassable"
**Branch:** `feature/view-only-capability-crypto`

## Problem

Today the view-only role is enforced only in client JS (`setReadOnlyMode`) and
"signed" with an HMAC whose salt ships in the bundle. Anyone can forge an
`edit` token or call the Y.js API directly; the PartyKit server blindly relays
every message and all peers apply any update they receive. So a motivated
viewer can modify the board.

## Goal & Threat Model

A user given a **view-only link must not be able to alter the board** — even
with devtools, a modified client, or direct Y.js API calls. The bar is
**hostile-viewer resistance**, achieved while keeping the system **fully
peer-to-peer**: the PartyKit server remains a dumb relay with no authority over
content. All authorization is enforced client-side via cryptography.

### Decisions locked during brainstorming

- **Threat model:** hostile viewer cannot write (not just "prevent accidents").
- **Backwards compatibility:** hard break. Pre-existing unsigned content and
  `v:1`/legacy links stop working. No legacy mode.
- **Revocation:** supported via the existing change-password UX (key rotation).
- **Architecture:** Approach B (signed-update relay, keep Y.js locally).
  Approach A (server-authority) rejected — breaks P2P and can't cover encrypted
  rooms. Approach C (drop Y.js for a signed-op set) rejected — same guarantee as
  B for far more code.

## Core Insight

Y.js is a CRDT where any peer can issue **both inserts and deletes**. Signing
only new shapes would not stop a hostile viewer from deleting an editor's shapes
or clearing the board. Therefore the only sound rule is:

> **Every update applied to an honest client's doc must carry a valid editor
> signature, verified before `Y.applyUpdate`.**

A viewer has no signing key, so none of their operations — insert, delete, move,
clear — are ever applied by any honest peer. A hostile viewer can only corrupt
their own local view, which is harmless.

## Section 1 — Architecture & Trust Model

Two independent capabilities, distributed only via the share link (out-of-band,
the same trusted channel the password uses today):

| Capability | Secret | Holders | Purpose |
|-----------|--------|---------|---------|
| **Read**  | Password → AES-256-GCM key (PBKDF2, as today) | Editors + Viewers | Confidentiality vs. the relay/network |
| **Write** | Ed25519 keypair | Editors hold the **private** key; everyone knows the **public** key | Authorization — only editors author state |

**Critical rule:** the Ed25519 private key is **independent of the password**.
If derived from the password, a viewer (who has the password) could reconstruct
it and forge edits. It is generated randomly at room creation and embedded
**only** in editor links.

**Link format** (extends today's `#base64(JSON{...})`):

- **Editor link:** `{ v:2, p:<password>, sk:<ed25519 private key>, e:<epoch> }`
  — the public key is derived from `sk`.
- **Viewer link:** `{ v:2, p:<password>, pk:<ed25519 public key>, r:"view", e:<epoch> }`
- `v:2` marks the protocol version. `v:1`/legacy tokens are rejected (hard break).
- `e` (epoch) is an integer, bumped on each rotation, identifying the current
  key generation.

**Trust bootstrapping:** the authoritative public key arrives **in the link
itself** (a trusted channel). There is **no in-band trust-on-first-use**, so a
hostile viewer cannot publish their own pubkey into the doc and claim editor
status — clients only ever trust the pubkey from their own link.

**The server stays a dumb relay** (`party/index.ts` unchanged). It sees only
encrypted, signed blobs and broadcasts them. No central authority; the P2P
model is intact.

## Section 2 — Wire Protocol & Sync

The y-protocols sync handshake is replaced with a signed-update relay. Each
content message, before AES encryption, is an inner envelope:

```
{ update: <Y.js update bytes>, epoch: <int>, sig: <Ed25519(update ‖ epoch)> }
```

Then: AES-GCM encrypt the envelope (confidentiality) → prepend a 1-byte message
type → server relays.

| Type | Payload | Signed? |
|------|---------|---------|
| `UPDATE` | incremental Y.js update | ✅ editor |
| `SNAPSHOT` | full-state `Y.encodeStateAsUpdate` | ✅ editor |
| `SNAPSHOT_REQUEST` | (empty) — "I'm new, send state" | ❌ |
| `AWARENESS` | cursors/presence | ❌ (ephemeral, cosmetic) |

**Sending (editors):** local edits apply to the doc with a `local` origin. The
doc's `update` event fires → sign the update bytes → encrypt → broadcast.
Remote-applied updates use a distinct `remote` origin so they are never
re-broadcast or re-signed (no loops).

**Receiving (everyone):** decrypt → verify `sig` against the pubkey for *my
link's epoch* → only then `Y.applyUpdate(doc, update, remote)`. Invalid /
wrong-epoch / unsigned → **dropped silently**. This is the linchpin of the
guarantee.

**Bootstrap (new joiner):** on connect, send `SNAPSHOT_REQUEST`. Any peer —
including a viewer — replies with the latest editor-signed `SNAPSHOT` it holds
plus the signed `UPDATE` tail since. Signatures are content-bound, so relaying
through a viewer is safe; the joiner verifies everything itself. Editors
re-emit a `SNAPSHOT` on a debounce after edits, keeping the relayed snapshot
fresh and the tail bounded.

**Awareness stays unauthenticated** — a hostile viewer could spoof a cursor or
name, but that is cosmetic and never touches board state. Signing it is YAGNI.

## Section 3 — Persistence & Key Rotation

**Two things persist locally in IndexedDB:**

1. **The Y.Doc** — via `IndexeddbPersistence` as today, for instant local
   rendering. Local storage stays plaintext (confidentiality is a network-only
   property, unchanged from today).
2. **A signed-artifact cache** — the latest editor-signed `SNAPSHOT` plus the
   signed `UPDATE` tail since it. This lets the client answer a
   `SNAPSHOT_REQUEST` from a newcomer **even after reload and even if no editor
   is online** — essential for viewer-only relay. When a newer snapshot
   arrives, older tail updates are pruned.

**Keys at rest:** the Ed25519 private key lives only in the URL hash (in
memory), exactly like the password does today. It is **never written to
IndexedDB**, so local storage never holds the write capability.

**Rotation (via the existing change-password UX):**

- Generate a **new password + new Ed25519 keypair**, bump `epoch → e+1`.
- The rotating editor immediately emits a fresh `SNAPSHOT` of current state,
  signed with the **new** key at epoch `e+1`.
- New links are minted: editor link (`sk`, `e+1`) and viewer link (`pk`, `e+1`).

**Lockout semantics:** since clients only accept their own link's epoch,
rotation invalidates **all** old links — old holders can neither read new
updates nor write. There is no automatic "demote to viewer": to keep someone on
at any level, hand them a fresh link (editor or viewer). This matches today's
"change password locks everyone out" behavior, extended to the write
capability.

## Section 4 — Client Integration (minimal blast radius)

The data model and rendering do not change; signing/verification lives in the
sync + key layers.

- **`drawing.js`, `boards.js` — untouched.** They keep reading/writing the
  Y.Doc exactly as now; they never see signatures.
- **`undo-redo.js` — untouched.** `Y.UndoManager` operates on local editor
  edits; an undo produces a local update that is signed and broadcast like any
  other edit.
- **`crypto.js` — extended.** Add Ed25519 `generateEditorKeyPair()`, `sign()`,
  `verify()`, and base64 import/export for links, using Web Crypto's native
  `Ed25519` (supported in current Chrome/Safari/Firefox; the app already gates
  on Web Crypto via its compatibility check).
- **`room-manager.js` — extended.** v2 link encode/decode (`p`/`sk`/`pk`/`r`/`e`),
  keypair generation on room create, and editor-vs-viewer link minting (an
  editor derives `pk` from its `sk` to produce viewer links).
- **`sync-provider.js` — rewritten** (the bulk of the work): signed-update
  relay, verify-before-apply, snapshot emit/request/bootstrap, signed-artifact
  cache. Replaces the y-protocols handshake.
- **`yjs-setup.js` — rewired.** Derive AES key from password *and* load Ed25519
  keys from the link; determine **role = editor if `sk` present, else viewer**;
  pass everything to the sync provider.
- **`app.js` — small changes.** Role detection; wire change-password to the
  rotation flow; invite modal generates editor vs viewer links.

**Read-only UI stays** (`setReadOnlyMode`) as good UX — it just stops being the
*security* boundary (signature verification is). A viewer who bypasses the UI
still has no key, so their edits are rejected everywhere.

## Section 5 — Error Handling & Edge Cases

**Rejection paths (all fail safe — drop, never crash):**

- **Bad/missing signature** → drop, debug-log. Never applied.
- **Wrong epoch** (post-rotation or tampered link) → drop. This *is* the lockout
  mechanism.
- **Decryption failure** → existing `decryption-failed` status ("wrong
  password").
- **Tampered update bytes** → signature covers `update ‖ epoch`, so any tamper
  breaks verification → drop. (AES-GCM's auth tag is a second, independent
  integrity layer.)

**Bootstrap edge cases:**

- **No snapshot available** (brand-new room, or all editors offline *and* no
  peer cached a snapshot) → joiner shows a "waiting for an editor" state and
  renders nothing until a valid `SNAPSHOT` arrives. A new room's first editor
  produces the first snapshot.
- **Viewer-only room that never had an editor** → stays empty/waiting (correct:
  there is no authored state to show).

**Correctness-by-construction:**

- **Concurrent editors** share the same keypair, so all their updates verify;
  Y.js CRDT merges them; snapshots from any editor at the current epoch are
  interchangeable.
- **Replay attacks** — a viewer replaying an old editor-signed update is
  harmless: Y.js updates are idempotent (re-applying is a no-op), and
  pre-rotation updates fail the epoch check. No nonce needed.
- **Snapshot/tail ordering** — Y.js updates are commutative, so snapshot-then-
  tail (or vice-versa) converges.
- **Malformed editor link** (claims edit, no `sk`) → treated as viewer (no key
  ⇒ can't sign).
- **Self-tampered link** (attacker edits their own `pk`/epoch) → only locks
  *themselves* out; zero impact on others.

**Known acceptable limitation:** snapshots are full-state, so very large boards
mean larger bootstrap payloads. Fine for a whiteboard; state-vector-diff
optimization is future work (YAGNI now).

## Section 6 — Testing Strategy

The repo has no test harness today, so part of this work is standing one up.

**Add Vitest** (dev dependency) and wire `npm test → vitest run`. Upgrade the CI
gate from PR #1 (currently build-only) to **build + test**, and gate the
PartyKit deploy on tests too. Tests run headless in Node 24, which has native
Web Crypto Ed25519 — the same primitive the browser uses — so the crypto is
covered in CI.

**Unit tests (`crypto.js`, `room-manager.js`):**

- Ed25519 keygen; sign/verify round-trip; verify **fails** on tampered bytes,
  wrong key, wrong epoch.
- base64 import/export round-trips for keys.
- v2 link encode/decode for editor and viewer links; epoch carried correctly;
  pubkey derived from `sk` matches the viewer link's `pk`.
- Role determination: `sk` present ⇒ editor; only `pk` ⇒ viewer; malformed ⇒
  viewer.

**Protocol tests (sync layer, with an in-memory fake relay):**

- Valid editor update applies; **unsigned / wrong-key / wrong-epoch updates are
  dropped** (the core guarantee).
- Snapshot bootstrap: a fresh doc reconstructs correct state from `SNAPSHOT` +
  `UPDATE` tail.
- **Viewer relay:** a viewer can relay editor-signed artifacts to a newcomer,
  *and* a viewer's own forged update is rejected by peers.
- Rotation: new-epoch artifacts accepted, old-epoch rejected (lockout verified).

**Manual verification (documented, not automated):** two browser tabs — editor
+ viewer — confirm the viewer can't draw, editor edits sync, and a rotation
locks out the old link.

## Dependencies / Sequencing

- Builds on the 8 fixes in PR #1 (`fix/investigation-findings`), which touch
  `crypto.js`, `room-manager.js`, `sync-provider.js`, and `yjs-setup.js`. This
  branch should be rebased on `main` after PR #1 merges to avoid conflicts.

## Out of Scope

- State-vector-diff sync optimization (full-state snapshots are used).
- Authenticated awareness/presence (cursors remain cosmetic and spoofable).
- Automatic role demotion on rotation (reissue links instead).
