# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Running the Application

```bash
# Install dependencies
npm install

# Run development server
npm run dev
```

The application runs on `http://localhost:5173` (Vite dev server).

## Deployment

```bash
# Build for production
npm run build

# Deploy to Vercel
vercel
```

## Architecture

This is a peer-to-peer collaborative whiteboard using Y.js for CRDT-based sync and WebRTC for direct browser connections. No backend server required.

### Key Technologies
- **Y.js**: CRDT library for conflict-free real-time collaboration
- **y-webrtc**: WebRTC provider for P2P connections
- **y-indexeddb**: Local persistence in browser storage
- **Vite**: Build tool and dev server

### File Structure
```
├── index.html         # Landing page with privacy messaging
├── room.html          # Main whiteboard app
├── css/styles.css     # All styles
├── js/
│   ├── app.js         # Main entry point, wires everything together
│   ├── yjs-setup.js   # Y.js document and provider initialization
│   ├── awareness.js   # User presence (names, colors)
│   ├── drawing.js     # Canvas drawing with Y.js sync
│   ├── boards.js      # Multi-board management
│   ├── room-manager.js # Room creation, URL/password handling
│   └── utils.js       # ID generation, color assignment
```

### Data Model (Y.js)
```javascript
// One Y.Doc per room
{
  boards: Y.Map {
    'default': Y.Array [{ id, tool, startX, startY, ..., color, user }],
    'board-2': Y.Array [...],
  }
}

// Awareness (ephemeral)
{ user: { id, name, color, currentBoard } }
```

### Data Flow
1. User visits `/room/{roomId}` → Y.js connects via WebRTC to other peers
2. User draws → adds item to Y.Array → Y.js syncs to all connected peers
3. Peer receives update → Y.Array observer triggers → canvas redraws
4. User leaves → data persists in IndexedDB → rejoins later with full state

### Room Security
- Room ID in URL serves as basic access control
- Optional password encrypts all WebRTC traffic
- Change password to lock out unwanted users

### Features
- Drawing tools: Line, Rectangle, Circle, Text
- Multiple boards per room
- User presence with assigned colors
- Text extraction (by user or position)
- Save as image
- Offline support (IndexedDB persistence)
- No login required
