# Owner-Controlled Rotation & Revocation (Owner Root-of-Trust)

**Date:** 2026-05-30
**Status:** Design approved; pending spec review
**Branch:** `feature/owner-revocation`
**Builds on:** the capability crypto from `2026-05-29-view-only-capability-crypto-design.md` (ECDSA P-256 signed updates, epochs, view-only enforcement).

## Problem

Today any editor can click **Change Password**, which rotates *their own* session into a fresh key (self-only — harmless to others). We want password change / room rotation to be an **owner-only** action with a real, cryptographically enforced boundary: an invited editor must be unable to rotate the room, and rotating must actually cut off (revoke) anyone the owner doesn't re-invite. All of this must remain **fully peer-to-peer** (the PartyKit server stays a dumb relay; no central authority).

## Locked decisions (from brainstorming)

- **Revoke model:** coarse — owner **rotates the room and re-invites** whoever should stay. No per-user identity/revocation.
- **Key handover:** **out-of-band** — retained members get a fresh invite link (same channel as today).
- **Rotation notice:** owner **broadcasts an owner-signed "rotated" notice**; old-epoch peers verify it, stop applying old-key edits, and prompt for a new link.
- **Backward compatibility:** **hard break** — existing encrypted (`v:1`/`v:2`) rooms/links stop working; create new rooms after deploy.
- **Inherent P2P limit (accepted):** revocation stops *future* read/write for non-re-invited users, but cannot un-see content they already loaded (no server to enforce deletion on their device).

## Section 1 — Trust model & keys

Two ECDSA P-256 key tiers:

| Key | Held by | Purpose |
|-----|---------|---------|
| **Owner root key** `O` (sk_O / pk_O) | Owner only (sk_O); pk_O in *every* link | Root of trust = the room's permanent identity; authorizes epochs |
| **Editor key** `E_n` (sk_E_n / pk_E_n) | Owner + invited editors | Signs document updates for epoch *n* (the existing signing key) |

**Epoch certificate:**
```
cert_n = ECDSA_sign(sk_O, canonicalJSON({ room: pk_O, epoch: n, editorPub: pk_E_n }))
```
The owner declaring "for epoch *n*, the legitimate editor key is pk_E_n." Only the owner holds `sk_O`, so **only the owner can mint a cert** → only the owner can establish/advance an epoch. An invited editor holds `sk_E_n` (can edit) but not `sk_O` (cannot forge a cert → cannot rotate). The boundary is verifiable entirely P2P because every peer anchors on `pk_O` from its own link (out-of-band trust, like the password).

Confidentiality stays AES-GCM from the password; the password rotates each epoch.

## Section 2 — Roles & link format (v3)

Hard break to `v:3`. Each link carries what the role needs plus the owner-signed cert:

| Field | Owner | Editor | Viewer |
|-------|:--:|:--:|:--:|
| `v:3`, `epoch`, `p` (password) | ✅ | ✅ | ✅ |
| `pkO` (owner public key = room identity) | ✅ | ✅ | ✅ |
| `cert` (owner-signed `{pkO, epoch, editorPub}`) | ✅ | ✅ | ✅ |
| `skE` (editor signing key) | ✅ | ✅ | ❌ |
| `pkE` (editor verify key)¹ | ✅ | ✅ | ✅ |
| `skO` (owner root key) | ✅ | ❌ | ❌ |

¹ Also inside `cert`; carried separately for convenience.

- **Owner link:** everything → read, edit, **rotate**.
- **Editor link:** no `skO` → read + edit, **cannot rotate**.
- **Viewer link:** no `skE`/`skO` → read-only (existing view-only guarantee, unchanged).

**Minting:**
- `createRoom` generates the owner root key **and** the first editor key, self-signs `cert_1`, produces the **owner link**.
- The owner's **Invite** modal mints **editor** and **viewer** links from the owner capability — invited users never receive `skO`.
- The quick side-panel "copy link" remains an **editor** link, so casual sharing never leaks owner authority.

**Role determination on load:** `skO` present → owner; else `skE` → editor; else → viewer. A link claiming a higher role without the matching key is effectively downgraded (missing key ⇒ can't perform that role's actions).

## Section 3 — Verification & rotation flow

**Verification on every applied update (extends verify-before-apply):** apply an `UPDATE`/`SNAPSHOT` only if all hold:
1. Decrypts with the current epoch's AES password.
2. The envelope is signed by the epoch's editor key.
3. A `cert` signed by **my link's `pkO`** binds that editor key to that epoch.
4. The epoch is my current (non-superseded) epoch.

Steps 1–2 exist today; **3–4 are new** and make epochs owner-authorized. A cert not signed by the real `pkO` is rejected, so an editor cannot introduce their own editor key or epoch.

**Rotation (owner-only):**
1. Owner clicks **Change Password** — UI gated to `role==='owner'`; the function also requires `skO`, so it is impossible without it.
2. Owner generates a **new editor key `E_{n+1}` + new password**, signs **`cert_{n+1}`** with `skO`.
3. Owner **broadcasts a signed rotation notice** `sign_O({type:'rotate', from:n, to:n+1})`, sent encrypted under the *old* epoch (so current members can read it) and owner-signed (so it can't be forged).
4. Owner re-mints owner/editor/viewer links for epoch `n+1`, **re-shares out-of-band** to retained members; owner's own tab reloads into `n+1`.

**Peers handling the notice:**
- A peer on epoch `n` verifies the notice against `pkO`. Valid → marks epoch `n` **superseded**: stops applying epoch-`n` edits, shows *"This room was rotated by the owner — ask them for a new link."*
- A **revoked** user gets the same notice and is frozen out; even if they ignore it, every honest peer has stopped applying epoch-`n` updates, so they reach no one.
- **Retained** members open the new link → epoch `n+1`, resume.
- An **editor cannot emit a valid notice** (no `skO`); peers reject a non-owner-signed rotate notice.

## Section 4 — Components & error handling

- **`js/crypto.js`** — has ECDSA generate/sign/verify. Add `signStatement(sk, obj)` / `verifyStatement(pk, obj, sig)` over canonical JSON (for certs and the rotate notice).
- **`js/room-cert.js`** *(new)* — `mintCert(skO, pkO, epoch, editorPubB64)` → cert; `verifyCert(pkO, cert)` → `{epoch, editorPub}` | null. Single responsibility.
- **`js/room-manager.js`** — v3 link encode/decode (owner/editor/viewer); `mintRoomCapability` also generates the owner root key + self-signed `cert_1`; helpers to mint editor/viewer links from an owner capability; `rotateCapability(ownerCap)` → next-epoch owner cap (new editor key + password + `cert_{n+1}`).
- **`js/protocol.js`** — add `MSG.ROTATE` + encode/decode for the signed rotation notice.
- **`js/signed-doc-sync.js`** — add cert+epoch checks to `_applySigned`/`_applySnapshot`; handle inbound `ROTATE` (verify vs `pkO` → supersede epoch, emit a `room-rotated` event); editors structurally cannot rotate.
- **`js/yjs-setup.js`** — load owner/editor/viewer capability + cert; `changePassword` becomes owner-only `rotate` (mint `n+1`, broadcast notice, re-share, reload).
- **`js/app.js`** — gate Change Password to `role==='owner'`; on `room-rotated`, show the "get a new link" prompt; invite modal mints edit/view from the owner cap.

**Error handling / edge cases:**
- **Editor attempts rotate:** button hidden + function requires `skO` (absent) → no-op.
- **Forged cert / forged rotate notice** (non-owner-signed): `verifyStatement`/`verifyCert` against `pkO` fails → rejected/ignored.
- **Old-epoch update after supersede:** dropped (epoch check).
- **Peer that never receives the notice:** stays on the old epoch until it opens a new link (accepted — coarse model).
- **Owner loses their owner link (`skO` gone):** room can't be rotated again — documented limitation (no recovery without a server).
- **Malformed / old `v:1`/`v:2` link:** rejected (hard break); surfaced via the existing invalid-link / "invite link required" handling.

## Section 5 — Testing

**Unit (Vitest, Node):**
- `room-cert`: `mintCert`/`verifyCert` round-trip; `verifyCert` **fails** for non-owner-signed cert, tampered epoch/editorPub, wrong `pkO`.
- `crypto`: `signStatement`/`verifyStatement` round-trip + tamper/wrong-key rejection.
- `room-manager`: v3 link encode/decode for all three roles (owner has `skO`, editor doesn't, viewer has neither key); role determination; `rotateCapability` yields epoch `n+1` with a valid owner-signed cert + fresh editor key + password.
- **Boundary (key test):** an editor capability cannot mint a cert peers accept (no `skO`) and cannot produce a valid rotate notice.

**Protocol (`signed-doc-sync`, in-memory transport):**
- Editor update accepted **only** with a valid owner-signed cert binding its key to the current epoch; rejected if missing / non-owner-signed / wrong-epoch.
- A valid owner-signed `ROTATE` supersedes the epoch (later old-epoch updates dropped); a forged/non-owner notice is ignored.

**End-to-end (Puppeteer vs live PartyKit):**
- Owner creates room, draws; editor + viewer join and sync; **editor sees no Change Password and cannot rotate**.
- Owner rotates → editor & viewer get the **"room rotated — get a new link"** prompt and stop syncing on the old key; owner continues on `n+1`.
- After re-invite with new links, retained members resume on `n+1`; a non-re-invited (revoked) user stays frozen out.
- Regression: view-only enforcement + live sync still hold.

## Out of scope

- Per-user revocation / per-member identity.
- In-band automatic key handover (retained members re-open links).
- Owner-key recovery / owner transfer / multiple owners.
- Backward compatibility with `v:1`/`v:2` links.
