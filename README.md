# Private Collab Whiteboard

A real-time collaborative whiteboard with an infinite canvas, optional end-to-end encryption, and view-only links that are enforced by signatures rather than a client-side flag.

![Version](https://img.shields.io/badge/version-2.0.0-green.svg)

**Live:** [private-collab-whiteboard.vercel.app](https://private-collab-whiteboard.vercel.app/) · [How it works](https://private-collab-whiteboard.vercel.app/how-it-works)

There is no backend and no database. Every browser holds the full board as a Y.js CRDT document, persisted locally in IndexedDB, and edits travel between browsers through a 35-line PartyKit relay. In a password-protected room every frame is AES-256-GCM-encrypted before it leaves the browser and every edit is ECDSA-signed, so the relay only ever forwards ciphertext and a viewer cannot forge an edit that other peers will accept.

## Features

### Real-Time Collaboration
- **CRDT-based sync** using Y.js for conflict-free merging of concurrent edits
- **Live cursors** with name labels, throttled to one update per 50 ms
- **Live drawing preview** — watch others' strokes and shapes take form before they are committed
- **User presence** — see who's online, each with their own color (changeable from your avatar)

### Drawing Tools
- **Pencil and highlighter** — freehand strokes; the highlighter renders at 35% opacity
- **Shapes** — line, arrow, rectangle, circle, ellipse, diamond and triangle, with solid/dashed/dotted strokes, optional fills, and arrowheads on the end, both ends, or neither
- **Connectors** — drag from one shape to another; the arrow stays bound to both shapes and follows them as they move. Connectors can be reversed, and are removed automatically when a linked shape is deleted
- **Sticky notes** — color-coded, multi-line notes whose text wraps, and scrolls with the mouse wheel when it overflows
- **Text tool** — inline text editing directly on the canvas
- **Laser pointer** — a fading pointer trail for presenting, sent as presence only and never saved to the board
- **Two erasers** — a shape eraser (click a shape, or drag across several) and a brush eraser that paints over strokes
- **Select tool** — move shapes, and change their color, stroke, fill, font, and stacking order (to back, backward, forward, to front) from a settings popup

### Infinite Canvas
- **Pan** — hold Space and drag, or drag with two fingers on touch screens
- **Zoom** — scroll wheel centered on the cursor, pinch-to-zoom, or the zoom buttons (10%–500%)
- **Fit all** — zoom and pan to frame every shape on the board
- **Zoom-consistent strokes** — stroke width is stored in world units, so a line keeps its proportions at any zoom level

### Editing and Boards
- **Undo/redo** — only ever reverts your own changes; deleting a shape together with the connectors attached to it is a single undo step
- **Multi-select** — Shift+click to build a selection
- **Copy, paste, duplicate** — pasted connectors are re-pointed at the pasted copies of their shapes
- **Lock shapes** — locked shapes can't be moved, restyled, or deleted
- **Multiple boards per room** — create, switch, rename, clear, and delete boards from the tab bar (right-click a tab); renames sync to everyone
- **Save as PNG / PDF** — an export dialog lets you pan and zoom to frame the shot, then saves a 2× resolution PNG or a single-page PDF
- **My Boards** — a history page of every room you've opened, with your role, encryption status, last visit and visit count

### Security and Privacy
- **End-to-end encryption** — adding a password to a room encrypts all traffic (document updates, snapshots, cursors, names) with AES-256-GCM, using a PBKDF2-derived key (600,000 iterations, random per-room salt)
- **Capability links** — an encrypted room has owner, editor, and viewer links; the role is defined by which private keys the link carries
- **Cryptographic view-only** — viewer links contain no signing key, so any edit a viewer forces through is rejected by every other peer
- **Owner-only rotation** — changing the password moves the room to a new epoch with a new editor key, and old links can no longer produce accepted edits
- **Keys stay off the server** — the password and keys live in the URL fragment (after `#`), which browsers never send to a server
- **Fail-closed link parsing** — a tampered or truncated invite link is rejected instead of silently opening an editable unencrypted room
- **XSS hardening** — peer-supplied shape and presence fields are allow-listed before they reach the DOM, behind a `script-src 'self'` Content-Security-Policy with no inline scripts
- **No accounts** — create a room and share the link

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES modules), HTML5 Canvas, CSS
- **Sync**: [Y.js](https://yjs.dev/) 13.6 CRDTs, with a custom signed-update protocol for document sync and `y-protocols` awareness for presence
- **Relay**: [PartyKit](https://partykit.io/) — a broadcast-only WebSocket server (`party/index.ts`)
- **Transport**: the browser's native `WebSocket`, with exponential-backoff reconnect (`js/sync-provider.js`)
- **Crypto**: Web Crypto API — AES-256-GCM and PBKDF2 for confidentiality, ECDSA P-256 for authorization
- **Local persistence**: IndexedDB via `y-indexeddb`; localStorage for board history and the snapshot cache
- **Export**: [jsPDF](https://github.com/parallax/jsPDF) 4 for PDF; canvas `toDataURL` for PNG
- **Build**: [Vite](https://vitejs.dev/) 8 in multi-page mode
- **Tests**: [Vitest](https://vitest.dev/) 4 — 26 test files that run in Node with no DOM
- **Hosting / CI**: [Vercel](https://vercel.com/) for the static frontend, PartyKit for the relay, GitHub Actions for tests, build, and relay deploys

## Getting Started

### Prerequisites
- Node.js 20.19+ or 22.12+ (required by Vite 8; CI runs Node 24)
- npm

### Installation

```bash
git clone https://github.com/Technical-1/Private-Collab-Whiteboard.git
cd Private-Collab-Whiteboard
npm install
npm run dev
```

The app runs at `http://localhost:5173`. `npm run dev` connects to the relay host set in `js/config.js` (`PARTYKIT_HOST`); `npm run dev:all` also starts a local PartyKit dev server alongside Vite.

### Development

```bash
# Frontend dev server (clean-URL routing mirrors vercel.json)
npm run dev

# Frontend + local PartyKit dev server together
npm run dev:all

# Run the test suite
npm test

# Production build (landing, room, My Boards, and How it works pages)
npm run build

# Regenerate favicons from public/favicon.svg
npm run generate-icons
```

### Deploy

```bash
# Frontend — Vercel deploys automatically from main; manual:
vercel --prod

# PartyKit relay — CI deploys on pushes to main that touch the server; manual:
npm run deploy:party
```

## Usage

### Creating a Room
1. Visit the homepage and click **Create Room** (or **New Board** on My Boards). You get a fresh room with a random 16-character ID.
2. The room starts **open**: anyone with the URL can draw.
3. To make it private, click **Encrypt** in the room header and set a password. You become the room **owner**, and any drawings already on the board carry over into the encrypted room.

### Sharing a Room
- **Open room**: share the URL. The link is the only access control, and traffic is not encrypted.
- **Encrypted room**: click **Invite** to copy an **editor** link (can draw) or a **viewer** link (read-only). The owner link is never offered for sharing — it stays in the creator's address bar and is the only one that can rotate the room.

### Rotating Access
- As the owner, use **Change password**. The room moves to a new epoch, peers on the old epoch are told the room was rotated, and their edits stop being accepted. Share fresh invite links with the people who should keep access.

### Joining a Room
- Open an invite link, or paste a room code or full link into **Join** on the homepage. A bare room code is enough for an open room. An encrypted room can only be joined with an invite link, because the signing keys can't be derived from the password; opening one without a link shows an "Invite link required" notice.

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `V` | Select tool |
| `P` | Pencil |
| `H` | Highlighter |
| `L` | Line |
| `A` | Arrow |
| `R` | Rectangle |
| `C` | Circle |
| `O` | Ellipse |
| `D` | Diamond |
| `Y` | Triangle |
| `T` | Text |
| `S` | Sticky note |
| `G` | Connector |
| `Q` | Laser pointer |
| `E` | Shape eraser |
| `Ctrl/⌘ + Z` | Undo |
| `Ctrl/⌘ + Y` or `Ctrl/⌘ + Shift + Z` | Redo |
| `Ctrl/⌘ + C` / `V` / `D` | Copy / Paste / Duplicate |
| `Delete` / `⌫` | Delete selection |
| `Escape` | Cancel / deselect |
| `Shift + Click` | Add to selection |
| `Space + Drag` | Pan |
| `Scroll` | Zoom |
| `?` | Show shortcuts |

## Project Structure

```
├── index.html                # Landing page (create / join)
├── room.html                 # The whiteboard
├── boards.html               # My Boards (room history)
├── how-it-works.html         # Public explainer page
├── css/styles.css            # All styles
├── js/
│   ├── app.js                # Room entry point: toolbar, shortcuts, zoom/pan, export, role-aware UI
│   ├── index-home.js         # Landing-page script
│   ├── boards-home.js        # My Boards page script
│   ├── how-it-works-home.js  # Explainer-page script
│   ├── yjs-setup.js          # Y.Doc, IndexedDB, key derivation, sync wiring, rotation
│   ├── sync-provider.js      # WebSocket transport: framing, AES, awareness, presence probe
│   ├── signed-doc-sync.js    # Signed / open document sync and view-only enforcement
│   ├── protocol.js           # Message types, envelope encoding, update signing
│   ├── crypto.js             # AES-256-GCM, PBKDF2, ECDSA P-256 helpers
│   ├── room-cert.js          # Owner-signed epoch certificates
│   ├── room-manager.js       # Capability links (owner / editor / viewer), rotation
│   ├── snapshot-store.js     # Per-epoch snapshot cache in localStorage
│   ├── drawing.js            # Canvas rendering and interaction
│   ├── draw-geometry.js      # Hit-testing, polygons, arrowheads, shape index
│   ├── connector-geometry.js # Connector anchors and dangling-connector detection
│   ├── text-wrap.js          # Word wrap and sticky-note scroll math
│   ├── laser-trail.js        # Laser-trail pruning
│   ├── keyboard-intent.js    # Delete-key decision
│   ├── shape-schema.js       # Sanitizing and bounding untrusted shapes
│   ├── awareness.js          # Presence, cursors, live previews, laser trails
│   ├── boards.js             # Boards within a room (create / switch / rename / delete)
│   ├── board-history.js      # My Boards history (localStorage)
│   ├── undo-redo.js          # Y.UndoManager wrapper
│   ├── modal.js              # Dialogs: prompt, confirm, invite, password, save, shortcuts
│   ├── config.js             # Tunable constants
│   └── utils.js              # IDs, colors, HTML escaping and allow-list sanitizers
├── party/index.ts            # PartyKit broadcast relay
├── public/                   # Favicons, OG image, robots.txt, sitemap.xml, web manifest
├── scripts/generate-icons.js # Favicon generation with sharp
├── tests/                    # Vitest suite
├── .github/workflows/        # CI and PartyKit deploy
└── vercel.json               # Clean URLs, /room/:id rewrite, CSP and security headers
```

### Data Model

```javascript
// Y.Doc (one per room)
{
  boards: Y.Map {                 // board key -> shapes
    'default': Y.Array [ { id, tool, color, user, timestamp, ...geometry }, ... ],
    'Retro': Y.Array [ ... ],     // other boards are keyed by the name given at creation
  },
  boardNames: Y.Map {             // board key -> display label ('default' shows as "Main")
    'default': 'Sprint planning',
  }
}

// Awareness (ephemeral, never stored)
{
  user: { id, name, color, currentBoard, cursor, currentDrawing, laser }
}
```

Document updates don't travel as raw Y.js updates. Each one is wrapped in an envelope:

```javascript
// epoch ‖ update ‖ signature   (lib0 varint encoding, see js/protocol.js)
// - encrypted rooms: editors sign (epoch ‖ update) with the epoch's ECDSA P-256 editor key
// - the owner key signs a certificate binding that editor key to the epoch
// - open rooms send an empty signature and skip verification
{ epoch, update, sig }
```

## Configuration

`js/config.js` holds the tunable constants, for example:

```javascript
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5;
export const CURSOR_UPDATE_INTERVAL = 50;    // ms between cursor broadcasts
export const PBKDF2_ITERATIONS = 600000;     // for newly encrypted rooms
export const PARTYKIT_HOST = 'whiteboard-collab.technical-1.partykit.dev';
```

To run your own relay, change `name` in `partykit.json`, deploy it, and point `PARTYKIT_HOST` at the new host.

## License

No license — personal project, all rights reserved. The source is public to read and learn from; reuse isn't granted by default.

## Author

Jacob Kanfer — [GitHub](https://github.com/Technical-1)

## Acknowledgments

- [Y.js](https://yjs.dev/) — CRDT implementation
- [PartyKit](https://partykit.io/) — real-time infrastructure
- [Vite](https://vitejs.dev/) — build tooling
