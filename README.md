# Private Collab Whiteboard

A real-time collaborative whiteboard application with peer-to-peer synchronization, end-to-end encryption, and infinite canvas support.

![Version](https://img.shields.io/badge/version-2.0.0-green.svg)

## Features

### Real-Time Collaboration
- **CRDT-based sync** using Y.js for conflict-free real-time collaboration
- **Live cursor tracking** - see where other users are pointing
- **Live drawing preview** - watch others draw in real-time as they create shapes
- **User presence** - see who's online with color-coded identities

### Drawing Tools
- **Freehand drawing** - natural pencil/pen tool, plus a translucent **highlighter**
- **Shapes** - lines, arrows, rectangles, circles, ellipses, diamonds, and triangles, with solid/dashed/dotted strokes and optional fills
- **Connectors** - draw an arrow from one shape to another; the endpoints stay bound and re-route as you move either shape
- **Sticky notes** - color-coded notes with wrapped, scrollable text
- **Text tool** - inline text editing directly on canvas
- **Laser pointer** - ephemeral pointer trail for presentations (not saved to the board)
- **Eraser** - remove shapes with a click
- **Select tool** - move, resize, and manipulate shapes

### Infinite Canvas
- **Pan** - hold Space + drag to navigate
- **Zoom** - scroll wheel or use zoom controls
- **Fit to content** - auto-zoom to see all drawings

### Advanced Features
- **Undo/Redo** - full history support (only affects your own changes)
- **Multi-select** - Shift+click to select multiple shapes
- **Copy/Paste/Duplicate** - standard clipboard operations
- **Lock shapes** - prevent accidental modifications
- **Multiple boards** - create, switch, clear, and delete boards within a room
- **Extract text** - export all text grouped by user or position
- **Save as PNG / PDF** - an interactive export modal lets you pan and zoom to frame the shot, then save a retina-resolution PNG or a single-page PDF

### Security & Privacy
- **End-to-end encryption** - password-protected rooms encrypt all traffic with AES-256-GCM; the relay only ever sees ciphertext
- **Capability-based access** - share links carry an owner / editor / viewer role enforced by ECDSA P-256 signatures, not just a client-side flag
- **Cryptographic view-only** - viewers hold no signing key, so their edits are rejected by every peer — a hostile viewer can't forge their way to edit access
- **Owner-controlled rotation** - only the room owner can rotate the room to a new epoch, instantly cutting off anyone holding an old link
- **Hardened against XSS** - untrusted shape/presence data from peers is allow-listed before it ever touches the DOM, backed by a strict `script-src 'self'` CSP (no inline scripts)
- **No account required** - just create a room and share the link
- **P2P architecture** - data syncs directly between browsers through a dumb relay

## Tech Stack

- **Frontend**: Vanilla JavaScript (ES modules), HTML5 Canvas, CSS3
- **Sync Engine**: [Y.js](https://yjs.dev/) (CRDT library) over a custom signed-update transport
- **WebSocket Server**: [PartyKit](https://partykit.io/) (a ~35-line broadcast relay)
- **Crypto**: Web Crypto API — AES-256-GCM for confidentiality, ECDSA P-256 for authorization
- **Export**: [jsPDF](https://github.com/parallax/jsPDF) for PDF output; native canvas `toDataURL` for PNG
- **Build Tool**: [Vite](https://vitejs.dev/) (multi-page build)
- **Tests**: [Vitest](https://vitest.dev/)
- **CI/CD**: GitHub Actions (Vitest + build gate); [Vercel](https://vercel.com/) for the frontend, PartyKit for the relay

## Getting Started

### Prerequisites
- Node.js 20+ (CI builds on Node 24)
- npm

### Installation

```bash
# Clone the repository
git clone https://github.com/Technical-1/Private-Collab-Whiteboard.git
cd Private-Collab-Whiteboard

# Install dependencies
npm install

# Start development server
npm run dev
```

The app will be available at `http://localhost:5173`

### Development

```bash
# Frontend dev server only
npm run dev

# Frontend + local PartyKit relay together
npm run dev:all

# Run the test suite
npm test

# Production build
npm run build
```

### Deploy

```bash
# Frontend (also runs automatically on push to main)
vercel --prod

# PartyKit relay (also runs in CI on push to main)
npm run deploy:party
```

## Usage

### Creating a Room
1. Visit the homepage
2. Enter a room name (or leave blank for random)
3. Optionally set a password — this turns on end-to-end encryption and capability-based access
4. Click "Create Room" — you become the room **owner**

### Sharing a Room
- **Open (no password)**: anyone with the room URL can edit. The link is the only access control.
- **Encrypted**: use the in-room invite menu to mint an **editor** link (can draw) or a **viewer** link (read-only). The owner link is never shared — it stays in the creator's URL and is the only role that can rotate the room.
- Each invite link embeds the capability in the URL fragment (after `#`), which never reaches the relay server.

### Rotating / Revoking Access
- As the owner, change the password to rotate the room to a new epoch. Existing peers are told to stop, and old links no longer decrypt or sign — share the fresh link with the people who should keep access.

### Joining a Room
- Open an invite link, or enter a room code on the homepage. For open rooms a bare room URL is enough; encrypted rooms require an invite link (the password alone is not a usable link).

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `V` | Select tool |
| `P` | Pencil/Freehand |
| `H` | Highlighter |
| `L` | Line tool |
| `A` | Arrow tool |
| `R` | Rectangle tool |
| `C` | Circle tool |
| `O` | Ellipse tool |
| `D` | Diamond tool |
| `Y` | Triangle tool |
| `T` | Text tool |
| `S` | Sticky note |
| `G` | Connector tool |
| `Q` | Laser pointer |
| `E` | Eraser |
| `Ctrl/⌘ + Z` | Undo |
| `Ctrl/⌘ + Y` | Redo |
| `Ctrl/⌘ + C` | Copy |
| `Ctrl/⌘ + V` | Paste |
| `Ctrl/⌘ + D` | Duplicate |
| `Delete/⌫` | Delete selected |
| `Space + Drag` | Pan canvas |
| `Scroll` | Zoom in/out |
| `?` | Show shortcuts |

## Architecture

```
├── index.html             # Landing page (create / join)
├── room.html              # Main whiteboard app
├── boards.html            # Board history page
├── css/
│   └── styles.css         # All styles
├── js/
│   ├── app.js             # Main entry point, role-aware UI wiring
│   ├── index-home.js      # Landing-page script (extracted for strict CSP)
│   ├── boards-home.js     # Board-history page script (extracted for strict CSP)
│   ├── yjs-setup.js       # Y.Doc init, transport + signed sync, rotation
│   ├── sync-provider.js   # PartyKit WebSocket transport (AES + awareness)
│   ├── signed-doc-sync.js # Signed-update doc sync; view-only enforcement
│   ├── protocol.js        # Wire envelope + update signing/verification
│   ├── crypto.js          # AES-256-GCM + ECDSA P-256 helpers
│   ├── room-cert.js       # Owner-signed epoch certificates
│   ├── room-manager.js    # Capability links (owner/editor/viewer), rotation
│   ├── snapshot-store.js  # Per-epoch snapshot cache (localStorage, pruned)
│   ├── awareness.js       # User presence & cursors
│   ├── laser-trail.js     # Ephemeral laser-pointer trail (presence-only, never stored)
│   ├── drawing.js         # Canvas rendering & interactions
│   ├── draw-geometry.js   # Pure shape geometry (hit-testing, polygons, arrowheads)
│   ├── connector-geometry.js # Connector anchor resolution & re-routing
│   ├── text-wrap.js       # Word-wrap + scroll math for text and sticky notes
│   ├── keyboard-intent.js # Pure keyboard-shortcut intent decisions (unit-testable)
│   ├── shape-schema.js    # Sanitize untrusted shapes before DOM interpolation
│   ├── boards.js          # Multi-board management (create / switch / clear / delete)
│   ├── board-history.js   # Board visit history (localStorage)
│   ├── undo-redo.js       # Undo/redo with Y.UndoManager
│   ├── modal.js           # Modal dialog system
│   ├── config.js          # App configuration
│   └── utils.js           # Helpers + HTML/color/number/tool sanitizers
├── party/
│   └── index.ts           # PartyKit broadcast relay (~35 lines)
├── tests/                 # Vitest suite (crypto, protocol, sync, links)
├── .github/workflows/     # CI + PartyKit auto-deploy
└── vercel.json            # Vercel hosting + CSP + URL rewrites
```

### Data Model

```javascript
// Y.js Document Structure (per room)
{
  boards: Y.Map {
    'default': Y.Array [
      { id, tool, x, y, color, user, ... },
      ...
    ],
    'board-2': Y.Array [...],
  }
}

// Awareness (ephemeral state)
{
  user: {
    id: string,
    name: string,
    color: string,
    cursor: { x, y } | null,
    currentDrawing: object | null
  }
}
```

In encrypted rooms, Y.js updates aren't sent raw. Each update is wrapped in a
signed envelope and only applied if the signature checks out:

```javascript
// Wire envelope (encrypted rooms): epoch ‖ update ‖ signature
// - editors sign updates with the per-epoch editor key (ECDSA P-256)
// - the owner key signs an epoch certificate binding that editor key
// - viewers have no signing key, so their updates never verify and are dropped
{ epoch, update, sig }
```

## Configuration

Edit `js/config.js` to customize:

```javascript
// Zoom limits
export const ZOOM_MIN = 0.1;
export const ZOOM_MAX = 5;

// Cursor update frequency (ms)
export const CURSOR_UPDATE_INTERVAL = 50;

// Undo grouping window (ms)
export const UNDO_CAPTURE_TIMEOUT = 500;
```

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

1. Fork the repository
2. Create your feature branch (`git checkout -b feature/AmazingFeature`)
3. Commit your changes (`git commit -m 'Add some AmazingFeature'`)
4. Push to the branch (`git push origin feature/AmazingFeature`)
5. Open a Pull Request

## License

No license — personal project, all rights reserved. The source is public to read and learn from; reuse isn't granted by default.

## Author

Jacob Kanfer - [GitHub](https://github.com/Technical-1)

## Acknowledgments

- [Y.js](https://yjs.dev/) - CRDT implementation
- [PartyKit](https://partykit.io/) - Real-time infrastructure
- [Vite](https://vitejs.dev/) - Build tooling
