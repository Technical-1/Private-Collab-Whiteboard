# Private Collab Whiteboard

A real-time collaborative whiteboard application with peer-to-peer synchronization, end-to-end encryption, and infinite canvas support.

![License](https://img.shields.io/badge/license-MIT-blue.svg)
![Version](https://img.shields.io/badge/version-1.0.0-green.svg)

## Features

### Real-Time Collaboration
- **CRDT-based sync** using Y.js for conflict-free real-time collaboration
- **Live cursor tracking** - see where other users are pointing
- **Live drawing preview** - watch others draw in real-time as they create shapes
- **User presence** - see who's online with color-coded identities

### Drawing Tools
- **Freehand drawing** - natural pencil/pen tool
- **Shapes** - lines, rectangles, and circles
- **Text tool** - inline text editing directly on canvas
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
- **Multiple boards** - organize content across different boards
- **Extract text** - export all text grouped by user or position

### Security & Privacy
- **End-to-end encryption** - optional password protection
- **No account required** - just create a room and share the link
- **Read-only mode** - share view-only links for presentations
- **P2P architecture** - data syncs directly between browsers

## Tech Stack

- **Frontend**: Vanilla JavaScript, HTML5 Canvas, CSS3
- **Sync Engine**: [Y.js](https://yjs.dev/) (CRDT library)
- **WebSocket Server**: [PartyKit](https://partykit.io/)
- **Build Tool**: [Vite](https://vitejs.dev/)
- **Deployment**: [Vercel](https://vercel.com/)

## Getting Started

### Prerequisites
- Node.js 18+
- npm or yarn

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

### Production Build

```bash
npm run build
```

### Deploy to Vercel

```bash
vercel --prod
```

## Usage

### Creating a Room
1. Visit the homepage
2. Enter a room name (or leave blank for random)
3. Optionally set a password for encryption
4. Click "Create Room"

### Joining a Room
- Share the room URL with collaborators
- If encrypted, share the password separately for security

### Keyboard Shortcuts

| Shortcut | Action |
|----------|--------|
| `V` | Select tool |
| `P` | Pencil/Freehand |
| `L` | Line tool |
| `R` | Rectangle tool |
| `C` | Circle tool |
| `T` | Text tool |
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
├── index.html         # Landing page
├── room.html          # Main whiteboard app
├── css/
│   └── styles.css     # All styles
├── js/
│   ├── app.js         # Main entry point
│   ├── yjs-setup.js   # Y.js document & provider setup
│   ├── sync-provider.js # PartyKit WebSocket provider
│   ├── awareness.js   # User presence & cursors
│   ├── drawing.js     # Canvas rendering & interactions
│   ├── boards.js      # Multi-board management
│   ├── undo-redo.js   # Undo/redo with Y.UndoManager
│   ├── modal.js       # Modal dialog system
│   ├── crypto.js      # Encryption utilities
│   ├── room-manager.js # Room URL & password handling
│   ├── config.js      # App configuration
│   └── utils.js       # Helper functions
├── party/
│   └── index.ts       # PartyKit server
└── vercel.json        # Vercel configuration
```

### Data Model

```javascript
// Y.js Document Structure
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

This project is licensed under the MIT License - see the [LICENSE](LICENSE) file for details.

## Acknowledgments

- [Y.js](https://yjs.dev/) - CRDT implementation
- [PartyKit](https://partykit.io/) - Real-time infrastructure
- [Vite](https://vitejs.dev/) - Build tooling
