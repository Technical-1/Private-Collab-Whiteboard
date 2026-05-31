# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Application

```bash
npm install        # install dependencies
npm run dev        # Vite dev server only → http://localhost:5173
npm run dev:all    # Vite + a local PartyKit relay together
npm test           # Vitest suite (run this before committing logic changes)
```

`npm run dev` talks to the *deployed* PartyKit relay (see `PARTYKIT_HOST` below).
Use `npm run dev:all` when you need to exercise the relay locally.

## Deployment

```bash
npm run build         # Vite production build
vercel                # deploy the frontend
npm run deploy:party  # deploy the PartyKit relay
```

CI does both automatically on push to `main`:
- **Frontend** → Vercel auto-deploys from Git.
- **Relay** → `.github/workflows/deploy-partykit.yml` runs `npx partykit deploy`,
  path-filtered to server changes (`party/**`, `partykit.json`, deps) and gated
  behind `.github/workflows/ci.yml` (Vitest + build) so a broken bundle or
  failing test never ships. Both workflows run on Node 24.

## Architecture

A peer-to-peer collaborative whiteboard. Y.js (CRDT) does conflict resolution
and offline merging; **PartyKit is a dumb broadcast relay** (~35 lines in
`party/index.ts`) — it forwards bytes between clients and runs no app logic.
There is no traditional backend and no database.

> Note: this app used `y-webrtc` historically. It does **not** anymore — sync
> goes over a PartyKit WebSocket. Don't reintroduce WebRTC.

### Two room modes

- **Open room** (no password): passwordless, updates are exchanged **unsigned**,
  everyone is an editor. No confidentiality, no view-only. Matches the original
  password-free behavior.
- **Capability room** (password set): all traffic is AES-256-GCM encrypted, and
  every document update is **signed** and verified before being applied. Access
  is capability-based with owner / editor / viewer roles.

### Key technologies
- **Y.js** + **y-indexeddb**: CRDT model and local persistence.
- **PartyKit** (`partysocket` client): WebSocket broadcast relay.
- **Web Crypto**: AES-256-GCM (confidentiality) + ECDSA P-256 (authorization).
- **Vite** (multi-page build), **Vitest** (tests), **lib0** (binary framing).

### Sync layers (important — not stock y-protocols doc sync)
1. `sync-provider.js` — the transport. Manages the WebSocket, AES-encrypts every
   frame in capability rooms, and carries typed messages + awareness (presence).
   `onMessage` / `onConnect` are **public settable** properties the layer above
   wires up. (A past bug: an earlier version invoked a private callback the
   caller never set, so all doc sync silently died while awareness still flowed.)
2. `signed-doc-sync.js` — the document-sync layer that replaces y-protocols' doc
   sync. Editors sign each Y.js update; peers verify before applying. Exchanges
   signed `{epoch, update, sig}` envelopes + full-state snapshots for bootstrap.
3. `protocol.js` — wire envelope (`epoch ‖ update ‖ sig` via lib0) and
   `signUpdate`/`verifyUpdate`, which sign the update **prefixed by its epoch**
   (replay protection across epochs).
4. `room-cert.js` — owner root-of-trust. The owner key signs an epoch
   certificate binding the editor public key to an epoch; peers only trust an
   editor key a valid owner cert vouches for. `signed-doc-sync` verifies the cert
   once on `start()` and **fails closed** if it doesn't pin the exact editor key.

### File structure
```
├── index.html             # Landing page (create / join)
├── room.html              # Main whiteboard app
├── boards.html            # Board visit history
├── css/styles.css         # All styles
├── js/
│   ├── app.js             # Entry point, role-aware UI wiring
│   ├── yjs-setup.js       # Y.Doc init, transport + signed sync, rotateRoom()
│   ├── sync-provider.js   # PartyKit WebSocket transport (AES + awareness)
│   ├── signed-doc-sync.js # Signed-update doc sync; view-only enforcement
│   ├── protocol.js        # Wire envelope + update signing/verification
│   ├── crypto.js          # AES-256-GCM + ECDSA P-256 helpers
│   ├── room-cert.js       # Owner-signed epoch certificates
│   ├── room-manager.js    # Capability links (owner/editor/viewer), rotation
│   ├── awareness.js       # User presence & cursors
│   ├── drawing.js         # Canvas rendering & interactions
│   ├── boards.js          # Multi-board management
│   ├── board-history.js   # Room visit history (localStorage)
│   ├── undo-redo.js       # Undo/redo via Y.UndoManager (local changes only)
│   ├── modal.js           # Modal dialog system
│   ├── config.js          # Constants incl. PARTYKIT_HOST
│   └── utils.js           # ID generation, color assignment
├── party/index.ts         # PartyKit broadcast relay (~35 lines)
├── tests/                 # Vitest (crypto, cert, protocol, sync, links)
├── .github/workflows/     # CI + PartyKit auto-deploy
└── vercel.json            # Hosting + CSP + /room/:id rewrite
```

### Data model
```javascript
// One Y.Doc per room
{ boards: Y.Map { 'default': Y.Array [{ id, tool, ..., color, user }], ... } }

// Awareness (ephemeral): enc flag lets keyless visitors know to ask for a link
{ user: { id, name, color, currentBoard, cursor, currentDrawing }, enc }

// Capability room wire envelope (signed, then AES-encrypted by the transport)
{ epoch, update, sig }
```

### Data flow
1. Visit `/room/{roomId}#<capability>` → `getCapabilityFromUrl()` parses the role
   (or null for an open room) → `initializeYjs(roomId, capability)`.
2. `SyncProvider` opens a WebSocket to the relay; `SignedDocSync.start()` verifies
   the cert and requests a bootstrap snapshot.
3. Editor draws → Y.js update → signed envelope → AES-encrypted → relayed.
4. Peer receives → decrypts → verifies epoch + signature → applies (or drops) →
   Y.Array observer redraws. State persists to IndexedDB.

### Access control & rotation
- Capability links live in the **URL fragment** (never sent to the relay).
  Viewer links carry public keys only; editor links add the editor private key;
  owner links add the owner private key. `room-manager.js`/`getShareableLink`
  **never emit an owner link** — owner stays in the creator's address bar.
- View-only is enforced cryptographically: viewers have no signing key, so their
  updates fail verification at every peer. Hiding edit UI is cosmetic only.
- **Rotation is owner-only** (`rotateRoom` in `yjs-setup.js`): changing the
  password mints a new epoch (fresh editor key + cert), broadcasts an
  owner-signed rotate notice (peers supersede the old epoch), and reloads the
  owner into the new link. Old links can no longer produce accepted edits.
- Token format is **v3 only** — a hard version break; older formats are not honored.

## Gotchas (don't re-break these)
- **Don't eagerly create the `default` board.** Each client doing
  `boards.set('default', new Y.Array())` causes a Y.Map conflict whose winner is
  a random clientID, which can orphan the content array (drawings sync at the
  byte level but never render). It's created lazily on the first write in
  `drawing.js`, and the observer re-subscribes if the array instance changes.
- **ECDSA P-256, not Ed25519.** Web Crypto Ed25519 only ships in very recent
  browsers ("Unrecognized name" otherwise). P-256 is universally supported.
- **`canonicalJSON` handles FLAT objects only** (string/number values). Nested
  objects get their keys dropped by the replacer — don't sign nested structures.
- **`PARTYKIT_HOST` in `js/config.js` is the single source of truth** and must
  match the `name` in `partykit.json` (`whiteboard-collab`).
- Run `npm test` before committing logic changes — CI (and the relay deploy)
  gate on it.

## Features
- Drawing tools: line, rectangle, circle, text, freehand, eraser, select.
- Multiple boards per room; user presence with assigned colors.
- Infinite canvas (pan/zoom/fit), undo/redo (local changes only).
- Text extraction, save-as-image, offline support (IndexedDB).
- No login required.
