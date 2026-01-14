# Whiteboard App - Implementation Plan

> **Created:** 2026-01-13
> **Status:** ✅ Complete
> **Total Issues:** 58 identified, organized into 25 actionable tasks (all completed)

---

## Progress Overview

| Phase | Description | Status | Tasks |
|-------|-------------|--------|-------|
| Phase 1 | Critical Security & Bugs | ✅ Complete | 5/5 tasks |
| Phase 2 | Core Missing Features | ✅ Complete | 4/4 tasks |
| Phase 3 | UI/UX Improvements | ✅ Complete | 6/6 tasks |
| Phase 4 | Bug Fixes | ✅ Complete | 5/5 tasks |
| Phase 5 | Code Quality & Cleanup | ✅ Complete | 5/5 tasks |

**Legend:** ⬜ Not Started | 🔄 In Progress | ✅ Complete | ⏸️ Blocked

---

## Phase 1: Critical Security & Bug Fixes

### 1.1 ✅ Fix Read-Only Mode Enforcement
**Priority:** 🔴 CRITICAL
**Files:** `js/drawing.js`, `js/app.js`, `js/boards.js`
**Status:** COMPLETED 2026-01-13

**Problem:**
Read-only mode is only enforced via CSS class. Users can bypass it using browser dev tools.

**Solution:**
- [x] Add `isReadOnly` check to `drawing.js` at module level
- [x] Block drawing operations in `handleMouseDown()`
- [x] Block shape mutations in `addDrawing()`, `deleteShape()`, `updateShapeProperty()`
- [x] Block board operations in `boards.js` (create, clear)
- [x] Show toast/notification when user tries to edit in read-only mode

**Implementation:**
```javascript
// In drawing.js - add at top
let readOnlyMode = false;
export function setReadOnlyMode(isReadOnly) {
  readOnlyMode = isReadOnly;
}

// In handleMouseDown, handleMouseUp, etc.
if (readOnlyMode && currentTool !== 'select') {
  showReadOnlyWarning();
  return;
}
```

---

### 1.2 ✅ Fix Memory Leaks (Event Listeners & Observers)
**Priority:** 🔴 CRITICAL
**Files:** `js/drawing.js`, `js/app.js`
**Status:** COMPLETED 2026-01-13

**Problem:**
- Event listeners on canvas never removed
- Y.js board observers accumulate when switching boards
- No cleanup when component unmounts

**Solution:**
- [x] Create `cleanup()` function in drawing.js that removes all listeners
- [x] Track all added event listeners in an array
- [x] Properly unobserve Y.js boards when switching
- [x] Export cleanup function for app.js to call

**Implementation:**
```javascript
// Track listeners for cleanup
const eventListeners = [];

function addListener(element, event, handler, options) {
  element.addEventListener(event, handler, options);
  eventListeners.push({ element, event, handler, options });
}

export function cleanup() {
  eventListeners.forEach(({ element, event, handler, options }) => {
    element.removeEventListener(event, handler, options);
  });
  eventListeners.length = 0;

  if (currentBoardObserver) {
    currentBoardObserver();
    currentBoardObserver = null;
  }
}
```

---

### 1.3 ✅ Fix Race Condition in Board Creation
**Priority:** 🔴 CRITICAL
**Files:** `js/yjs-setup.js`
**Status:** COMPLETED 2026-01-13

**Problem:**
Default board created AFTER 2-second network timeout, causing race conditions with remote data.

**Solution:**
- [x] Wait for IndexedDB sync first (local data)
- [x] Then wait for network sync (with timeout)
- [x] Only create default board if it doesn't exist after both syncs
- [x] Use proper promise handling to avoid race

**Current Code (lines 73-101):**
```javascript
// BUGGY: Creates board after arbitrary timeout
await new Promise(resolve => {
  const timeout = setTimeout(() => resolve(), 2000);
  // ...
});
if (!boards.has('default')) {
  boards.set('default', new Y.Array());
}
```

**Fixed Code:**
```javascript
// Wait for IndexedDB first
await indexeddbProvider.whenSynced;

// Then try network with timeout
await Promise.race([
  new Promise(resolve => {
    if (provider.synced) resolve();
    else provider.once('synced', resolve);
  }),
  new Promise(resolve => setTimeout(resolve, 3000))
]);

// NOW safe to create default board
if (!boards.has('default')) {
  boards.set('default', new Y.Array());
}
```

---

### 1.4 ✅ Fix IndexedDB Sync Race Condition
**Priority:** 🟡 HIGH
**Files:** `js/yjs-setup.js`
**Status:** COMPLETED 2026-01-13

**Problem:**
Race between checking `synced` and attaching listener.

**Current Code (lines 61-71):**
```javascript
await new Promise(resolve => {
  if (indexeddbProvider.synced) {
    resolve();
  } else {
    indexeddbProvider.once('synced', () => resolve());
  }
});
```

**Fixed Code:**
```javascript
if (!indexeddbProvider.synced) {
  await new Promise(resolve => {
    indexeddbProvider.once('synced', resolve);
  });
}
```

---

### 1.5 ✅ Remove Dead Code (encrypted-provider.js)
**Priority:** 🟢 LOW
**Files:** `js/encrypted-provider.js`
**Status:** COMPLETED 2026-01-13 - File deleted

**Problem:**
275-line file is never imported or used. `SyncProvider` handles both encrypted and unencrypted modes.

**Solution:**
- [x] Delete `js/encrypted-provider.js`
- [x] Verify no imports reference it
- [x] Add comment in sync-provider.js explaining it handles both modes

---

## Phase 2: Core Missing Features

### 2.1 ✅ Implement Undo/Redo System
**Priority:** 🔴 CRITICAL
**Files:** `js/undo-redo.js` (new), `js/app.js`, `room.html`
**Status:** COMPLETED 2026-01-13

**Problem:**
No way to undo/redo drawing actions. Users lose work on mistakes.

**Solution:**
Create a local undo stack that tracks Y.js operations:

- [x] Create `js/undo-redo.js` module
- [x] Implement `UndoManager` using Y.js built-in `Y.UndoManager`
- [x] Add Ctrl+Z (undo) and Ctrl+Y/Ctrl+Shift+Z (redo) shortcuts
- [x] Add undo/redo buttons to toolbar
- [x] Track undo/redo stack state for button enable/disable
- [x] Scope undo to local user only (don't undo others' changes)

**Implementation:**
```javascript
// js/undo-redo.js
import * as Y from 'yjs';

let undoManager = null;

export function initUndoManager(ydoc, trackedTypes) {
  undoManager = new Y.UndoManager(trackedTypes, {
    captureTimeout: 500, // Group rapid changes
  });
  return undoManager;
}

export function undo() {
  if (undoManager && undoManager.canUndo()) {
    undoManager.undo();
    return true;
  }
  return false;
}

export function redo() {
  if (undoManager && undoManager.canRedo()) {
    undoManager.redo();
    return true;
  }
  return false;
}

export function canUndo() {
  return undoManager?.canUndo() ?? false;
}

export function canRedo() {
  return undoManager?.canRedo() ?? false;
}
```

**UI Changes (room.html):**
```html
<!-- Add to toolbar -->
<div class="toolbar-divider"></div>
<div class="tool-group">
  <button class="tool-btn" id="undo-btn" title="Undo (Ctrl+Z)" disabled>
    <svg><!-- undo icon --></svg>
  </button>
  <button class="tool-btn" id="redo-btn" title="Redo (Ctrl+Y)" disabled>
    <svg><!-- redo icon --></svg>
  </button>
</div>
```

---

### 2.2 ✅ Add Touch/Mobile Support
**Priority:** 🔴 CRITICAL
**Files:** `js/drawing.js`, `room.html`, `css/styles.css`
**Status:** COMPLETED 2026-01-13

**Problem:**
No touch event handlers. App completely unusable on mobile/tablets.

**Solution:**

- [x] Add touch event handlers (touchstart, touchmove, touchend, touchcancel)
- [x] Map touch events to mouse event equivalents
- [x] Handle multi-touch for pinch-to-zoom
- [x] Increase button sizes for touch targets (44x44px minimum)
- [x] Add responsive toolbar that collapses on mobile
- [x] Prevent default touch behaviors (scroll, zoom)
- [x] Add touch-action CSS properties

**Implementation:**
```javascript
// In drawing.js - add touch handlers
function getTouchPos(canvas, touch) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top
  };
}

canvas.addEventListener('touchstart', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    const pos = getTouchPos(canvas, e.touches[0]);
    handleMouseDown({ clientX: pos.x + rect.left, clientY: pos.y + rect.top, button: 0 });
  } else if (e.touches.length === 2) {
    // Start pinch-to-zoom
    startPinchZoom(e.touches);
  }
}, { passive: false });

canvas.addEventListener('touchmove', (e) => {
  e.preventDefault();
  if (e.touches.length === 1) {
    const pos = getTouchPos(canvas, e.touches[0]);
    handleMouseMove({ clientX: pos.x + rect.left, clientY: pos.y + rect.top });
  } else if (e.touches.length === 2) {
    handlePinchZoom(e.touches);
  }
}, { passive: false });

canvas.addEventListener('touchend', (e) => {
  e.preventDefault();
  handleMouseUp({ button: 0 });
}, { passive: false });
```

**CSS Changes:**
```css
/* Touch-friendly button sizes */
@media (pointer: coarse) {
  .tool-btn {
    width: 48px;
    height: 48px;
  }

  .toolbar-panel {
    padding: 12px;
    gap: 8px;
  }
}

/* Prevent unwanted touch behaviors */
#board {
  touch-action: none;
}
```

---

### 2.3 ✅ Implement Multi-Select
**Priority:** 🟡 HIGH
**Files:** `js/drawing.js`, `js/app.js`
**Status:** COMPLETED 2026-01-13

**Problem:**
Can only select one shape at a time. No box selection or shift-click.

**Solution:**

- [x] Change `selectedId` to `selectedIds` (Set)
- [x] Implement shift+click to add to selection
- [x] Update shape controls to work with multiple shapes
- [x] Enable bulk delete, move operations

**Implementation:**
```javascript
// Change from single selection to multi-selection
let selectedIds = new Set();

function setSelected(shapeId, addToSelection = false) {
  if (addToSelection) {
    if (selectedIds.has(shapeId)) {
      selectedIds.delete(shapeId);
    } else {
      selectedIds.add(shapeId);
    }
  } else {
    selectedIds.clear();
    if (shapeId) selectedIds.add(shapeId);
  }
  redrawCanvas();
}

function getSelectedShapes() {
  const board = boards.get(getCurrentBoard());
  return board.toArray().filter(s => selectedIds.has(s.id));
}

// In handleMouseDown for select tool:
if (e.shiftKey) {
  setSelected(shape.id, true); // Add to selection
} else {
  setSelected(shape.id, false); // Replace selection
}
```

---

### 2.4 ✅ Implement Copy/Paste
**Priority:** 🟡 HIGH
**Files:** `js/drawing.js`, `js/app.js`
**Status:** COMPLETED 2026-01-13

**Problem:**
No way to copy/paste shapes. Essential productivity feature.

**Solution:**

- [x] Add clipboard storage for shapes
- [x] Implement Ctrl+C to copy selected shapes
- [x] Implement Ctrl+V to paste (offset from original position)
- [x] Implement Ctrl+D to duplicate in place
- [x] Preserve shape properties on paste

**Implementation:**
```javascript
let clipboard = [];

function copySelectedShapes() {
  const shapes = getSelectedShapes();
  clipboard = shapes.map(s => ({ ...s })); // Deep copy
  return clipboard.length;
}

function pasteShapes(offsetX = 20, offsetY = 20) {
  if (clipboard.length === 0) return;

  const board = boards.get(getCurrentBoard());
  const newIds = [];

  clipboard.forEach(shape => {
    const newShape = {
      ...shape,
      id: generateId(),
      x: shape.x + offsetX,
      y: shape.y + offsetY,
      // For freehand, offset all points
      points: shape.points?.map(p => ({ x: p.x + offsetX, y: p.y + offsetY }))
    };
    board.push([newShape]);
    newIds.push(newShape.id);
  });

  // Select pasted shapes
  selectedIds = new Set(newIds);
  redrawCanvas();
}

function duplicateSelectedShapes() {
  copySelectedShapes();
  pasteShapes(20, 20);
}
```

---

## Phase 3: UI/UX Improvements

### 3.1 ✅ Add Zoom Controls UI
**Priority:** 🟡 HIGH
**Files:** `room.html`, `js/app.js`, `css/styles.css`
**Status:** COMPLETED 2026-01-13

**Problem:**
Zoom only works via scroll wheel. No visual indicator of current zoom level.

**Solution:**

- [x] Add zoom level indicator (e.g., "100%")
- [x] Add zoom in/out buttons (+/-)
- [x] Add "Fit All" button to show all content
- [x] Add "Reset View" button (100% + center, click on percentage)

**UI Design:**
```html
<!-- Add to bottom-left of canvas area -->
<div class="zoom-controls floating-panel">
  <button class="zoom-btn" id="zoom-out" title="Zoom Out">
    <svg><!-- minus icon --></svg>
  </button>
  <button class="zoom-level" id="zoom-level" title="Click to reset">100%</button>
  <button class="zoom-btn" id="zoom-in" title="Zoom In">
    <svg><!-- plus icon --></svg>
  </button>
  <div class="zoom-divider"></div>
  <button class="zoom-btn" id="zoom-fit" title="Fit All">
    <svg><!-- fit icon --></svg>
  </button>
</div>
```

**Implementation:**
```javascript
function updateZoomDisplay() {
  const zoomLevel = document.getElementById('zoom-level');
  if (zoomLevel) {
    zoomLevel.textContent = `${Math.round(viewport.zoom * 100)}%`;
  }
}

function zoomIn() {
  const newZoom = Math.min(5, viewport.zoom * 1.2);
  setZoom(newZoom);
  updateZoomDisplay();
  redrawCanvas();
}

function zoomOut() {
  const newZoom = Math.max(0.1, viewport.zoom / 1.2);
  setZoom(newZoom);
  updateZoomDisplay();
  redrawCanvas();
}

function fitAll() {
  const bounds = getAllShapesBounds();
  if (!bounds) return;

  const padding = 50;
  const canvas = getCanvas();
  const scaleX = (canvas.width - padding * 2) / bounds.width;
  const scaleY = (canvas.height - padding * 2) / bounds.height;
  const scale = Math.min(scaleX, scaleY, 2); // Max 200%

  viewport.zoom = scale;
  viewport.panX = bounds.x - padding / scale;
  viewport.panY = bounds.y - padding / scale;

  updateZoomDisplay();
  redrawCanvas();
}

function resetView() {
  viewport.zoom = 1;
  viewport.panX = 0;
  viewport.panY = 0;
  updateZoomDisplay();
  redrawCanvas();
}
```

---

### 3.2 ✅ Add Keyboard Shortcuts Help Dialog
**Priority:** 🟡 HIGH
**Files:** `js/modal.js`, `js/app.js`, `css/styles.css`
**Status:** COMPLETED 2026-01-13

**Problem:**
Keyboard shortcuts exist but are undiscoverable.

**Solution:**

- [x] Add `?` key to open help dialog
- [x] Create modal showing all shortcuts
- [x] Group shortcuts by category
- [x] Make modal dismissable with Escape

**Shortcuts to Document:**
```
TOOLS
V - Select tool
P - Pencil/Freehand
L - Line tool
R - Rectangle tool
C - Circle tool
T - Text tool
E - Eraser (shape)

NAVIGATION
Space + Drag - Pan canvas
Scroll Wheel - Zoom in/out
+ / - - Zoom in/out
0 - Reset view (100%)

EDITING
Ctrl+Z - Undo
Ctrl+Y - Redo
Ctrl+C - Copy
Ctrl+V - Paste
Ctrl+D - Duplicate
Ctrl+A - Select all
Delete/Backspace - Delete selected
Escape - Deselect / Cancel

VIEW
? - Show this help
```

---

### 3.3 ✅ Fix Remote Cursor Viewport Transform
**Priority:** 🟡 HIGH
**Files:** `js/awareness.js`, `js/drawing.js`
**Status:** COMPLETED 2026-01-13

**Problem:**
Remote user cursors don't transform with canvas viewport. When you pan/zoom, cursors stay in wrong position.

**Current Code (awareness.js:182-185):**
```javascript
cursorEl.style.left = `${user.cursor.x}px`;
cursorEl.style.top = `${user.cursor.y}px`;
```

**Solution:**

- [x] Store cursor positions in world space (not screen space)
- [x] Transform cursor positions by viewport when rendering
- [x] Export viewport from drawing.js for awareness.js to use
- [x] Update cursor positions on viewport change via refreshCursors()

**Implementation:**
```javascript
// In drawing.js - broadcast cursor in WORLD space
function updateCursorPosition(screenX, screenY) {
  const worldPos = screenToWorld(screenX, screenY);
  awareness.setLocalStateField('cursor', {
    x: worldPos.x,
    y: worldPos.y
  });
}

// In awareness.js - render cursor in SCREEN space
function renderRemoteCursor(user, cursorEl) {
  const viewport = getViewport(); // Import from drawing.js
  const screenPos = worldToScreen(user.cursor.x, user.cursor.y);
  cursorEl.style.left = `${screenPos.x}px`;
  cursorEl.style.top = `${screenPos.y}px`;
}
```

---

### 3.4 ✅ Add Layer Management (Bring to Front/Back)
**Status:** COMPLETED 2026-01-13
**Priority:** 🟠 MEDIUM
**Files:** `js/drawing.js`, shape controls popup

**Problem:**
No way to change z-order of shapes after creation.

**Solution:**

- [x] Add "Bring to Front" button in shape popup
- [x] Add "Send to Back" button
- [x] Add "Move Up" / "Move Down" for fine control
- [x] Implement Y.js array reordering

**Implementation:**
```javascript
function bringToFront(shapeId) {
  const board = boards.get(getCurrentBoard());
  const items = board.toArray();
  const index = items.findIndex(s => s.id === shapeId);
  if (index === -1 || index === items.length - 1) return;

  const shape = items[index];
  board.delete(index, 1);
  board.push([shape]);
}

function sendToBack(shapeId) {
  const board = boards.get(getCurrentBoard());
  const items = board.toArray();
  const index = items.findIndex(s => s.id === shapeId);
  if (index === -1 || index === 0) return;

  const shape = items[index];
  board.delete(index, 1);
  board.insert(0, [shape]);
}
```

---

### 3.5 ✅ Add Empty State & Loading Indicators
**Status:** COMPLETED 2026-01-13
**Priority:** 🟢 LOW
**Files:** `room.html`, `css/styles.css`, `js/app.js`

**Problem:**
- Blank canvas with no guidance for new users
- Just "Connecting..." text with no spinner

**Solution:**

- [x] Add loading spinner during connection
- [x] Show empty state message with drawing hint
- [x] Dispatch board-change events for empty state tracking

---

### 3.6 ✅ Improve Mobile Responsiveness
**Status:** COMPLETED 2026-01-13
**Priority:** 🟠 MEDIUM
**Files:** `css/styles.css`, `room.html`

**Problem:**
Toolbar not responsive, buttons too small for touch.

**Solution:**

- [x] Add mobile breakpoints for toolbar and side panel
- [x] Increase touch target sizes
- [x] Improve side panel collapse behavior on mobile
- [x] Add compact zoom controls for small screens

---

## Phase 4: Bug Fixes

### 4.1 ✅ Fix Text Input Positioning with Zoom/Pan
**Status:** COMPLETED 2026-01-13
**Priority:** 🟠 MEDIUM
**Files:** `js/drawing.js`

**Problem:**
Text editing input is positioned incorrectly when canvas is zoomed/panned.

**Location:** `drawing.js:773-803`

**Solution:**
- [x] Transform input position by viewport
- [x] Created updateTextInputPosition() called on pan/zoom

---

### 4.2 ✅ Fix Shape Controls Popup Positioning
**Status:** COMPLETED 2026-01-13
**Priority:** 🟠 MEDIUM
**Files:** `js/drawing.js`

**Problem:**
Popup buttons positioned off-screen when shape is near edges.

**Solution:**
- [x] Check viewport bounds before positioning
- [x] Clamp position to visible area using requestAnimationFrame

---

### 4.3 ✅ Fix Group Options Panel (Never Shown)
**Status:** COMPLETED 2026-01-13
**Priority:** 🟢 LOW
**Files:** `room.html`, `js/app.js`

**Problem:**
Panel for text extraction grouping exists but is always hidden.

**Solution:**
- [x] Removed display:none to show text grouping options panel

---

### 4.4 ✅ Add Proper Error Handling
**Status:** COMPLETED 2026-01-13
**Priority:** 🟠 MEDIUM
**Files:** All JS files

**Problem:**
Silent failures, inconsistent error messages.

**Solution:**
- [x] Created centralized handleError() function
- [x] Show user-friendly error modals via showAlert()
- [x] Added global window.onerror and unhandledrejection handlers
- [x] Log errors to console for debugging

---

### 4.5 ✅ Fix Browser Compatibility
**Status:** COMPLETED 2026-01-13
**Priority:** 🟢 LOW
**Files:** `js/app.js`, `index.html`

**Problem:**
No feature detection for required APIs.

**Solution:**
- [x] Added checkBrowserCompatibility() with feature detection
- [x] Checks for WebSocket, IndexedDB, Web Crypto, TextEncoder/Decoder
- [x] Shows friendly error page if features missing

---

## Phase 5: Code Quality & Cleanup

### 5.1 ✅ Refactor main() Function
**Priority:** 🟢 LOW
**Files:** `js/app.js`
**Status:** COMPLETED 2026-01-13

**Problem:**
`main()` is 444 lines - too large.

**Solution:**
- [x] Extract toolbar setup to separate function
- [x] Extract keyboard shortcuts to setupKeyboardShortcuts()
- [x] Extract zoom/pan handlers to setupZoomPanControls()
- [x] Move panning state and helper functions outside main()

---

### 5.2 ✅ Extract Hardcoded Values to Config
**Priority:** 🟢 LOW
**Files:** `js/config.js` (new), `js/app.js`, `js/drawing.js`, `js/crypto.js`, `js/awareness.js`
**Status:** COMPLETED 2026-01-13

**Values Extracted to config.js:**
- [x] Zoom limits (ZOOM_MIN, ZOOM_MAX)
- [x] Zoom step multipliers (ZOOM_STEP, ZOOM_WHEEL_STEP)
- [x] Cursor update interval (CURSOR_UPDATE_INTERVAL)
- [x] Timing constants (RESYNC_INTERVAL, SYNC_TIMEOUT, etc.)
- [x] PBKDF2 iterations and crypto constants
- [x] Default drawing settings
- [x] User colors palette

---

### 5.3 ✅ Remove Code Duplication
**Priority:** 🟢 LOW
**Files:** `js/drawing.js`
**Status:** COMPLETED 2026-01-13

**Changes:**
- [x] Exported getShapeBounds() for reuse
- [x] Shape drawing functions kept separate intentionally (different coordinate sources)

---

### 5.4 ✅ Add JSDoc Comments
**Priority:** 🟢 LOW
**Files:** `js/drawing.js`, `js/config.js`
**Status:** COMPLETED 2026-01-13

**Documented Functions:**
- [x] screenToWorld, worldToScreen
- [x] getViewport, setViewport, panBy, setZoom
- [x] setupDrawing
- [x] getSelectedIds, getSelected
- [x] deleteSelectedShapes, copySelectedShapes, pasteShapes, duplicateSelectedShapes
- [x] subscribeToBoard, getTexts, getCanvas, getShapeBounds

---

### 5.5 ✅ Clean Up Unused Code
**Priority:** 🟢 LOW
**Files:** `js/modal.js`
**Status:** COMPLETED 2026-01-13

**Items:**
- [x] Remove `encrypted-provider.js` (done in 1.5)
- [x] Remove unused `currentReject` in modal.js
- [x] Console statements reviewed - all are for error handling (appropriate)

---

## Implementation Order

```
Week 1: Critical Fixes
├── 1.1 Read-only mode enforcement
├── 1.2 Memory leaks
├── 1.3 Board creation race condition
├── 1.4 IndexedDB race condition
└── 1.5 Remove dead code

Week 2: Core Features (Part 1)
├── 2.1 Undo/Redo system
└── 2.2 Touch/mobile support

Week 3: Core Features (Part 2)
├── 2.3 Multi-select
├── 2.4 Copy/paste
└── 3.1 Zoom controls UI

Week 4: UX & Bug Fixes
├── 3.2 Keyboard shortcuts help
├── 3.3 Cursor viewport transform
├── 3.4 Layer management
├── 4.1 Text input positioning
└── 4.2 Popup positioning

Week 5: Polish
├── 3.5 Empty state & loading
├── 3.6 Mobile responsiveness
├── 4.3 Group options panel
├── 4.4 Error handling
└── 4.5 Browser compatibility

Week 6: Code Quality
├── 5.1 Refactor main()
├── 5.2 Extract config
├── 5.3 Remove duplication
├── 5.4 Add JSDoc
└── 5.5 Clean up unused code
```

---

## Testing Checklist

### After Each Phase:
- [ ] Test in Chrome, Firefox, Safari
- [ ] Test on mobile (iOS Safari, Android Chrome)
- [ ] Test with 2+ users simultaneously
- [ ] Test with encryption enabled/disabled
- [ ] Test offline mode (IndexedDB persistence)
- [ ] Test read-only mode
- [ ] Check for console errors
- [ ] Verify no memory leaks (Chrome DevTools)

---

## Notes & Decisions

_Space for implementation notes as work progresses_

---

## Changelog

| Date | Task | Status | Notes |
|------|------|--------|-------|
| 2026-01-13 | Created implementation plan | ✅ | 58 issues identified |
| 2026-01-13 | 1.1 Read-only mode enforcement | ✅ | Added canMutate() checks to all mutation functions in drawing.js and boards.js |
| 2026-01-13 | 1.2 Memory leak fixes | ✅ | Added addTrackedListener(), cleanup(), beforeunload handler |
| 2026-01-13 | 1.3 & 1.4 Race condition fixes | ✅ | Added waitForSync() helper with double-check pattern |
| 2026-01-13 | 1.5 Dead code removal | ✅ | Deleted encrypted-provider.js |
| 2026-01-13 | 2.1 Undo/Redo system | ✅ | Created undo-redo.js, added toolbar buttons, Ctrl+Z/Y shortcuts |
| 2026-01-13 | 2.2 Touch/mobile support | ✅ | Added touch handlers, pinch-to-zoom, mobile CSS, viewport meta |
| 2026-01-13 | 3.1 Zoom controls UI | ✅ | Added zoom panel, zoom in/out buttons, level indicator, fit all |
| 2026-01-13 | 3.2 Keyboard shortcuts help | ✅ | Added showKeyboardShortcuts() modal, CSS styling, ? key shortcut |
| 2026-01-13 | 3.3 Remote cursor viewport | ✅ | Fixed cursor coordinate transform, cursors now stored in world coords |
| 2026-01-13 | 2.3 Multi-select | ✅ | Changed selectedId to selectedIds Set, shift+click support, bulk operations |
| 2026-01-13 | 2.4 Copy/paste | ✅ | Added clipboard, Ctrl+C/V/D shortcuts, paste with offset |
| 2026-01-13 | 3.4 Layer management | ✅ | Added bring to front/back, move up/down functions, layer buttons in popup |
| 2026-01-13 | 3.5 Empty state & loading | ✅ | Added loading spinner overlay, empty state message, board-change events |
| 2026-01-13 | 3.6 Mobile responsiveness | ✅ | Improved side panel behavior on mobile, compact zoom controls |
| 2026-01-13 | 4.1 Text input positioning | ✅ | Added updateTextInputPosition() called on pan/zoom |
| 2026-01-13 | 4.2 Popup positioning | ✅ | Added bounds clamping for shape settings popup |
| 2026-01-13 | 4.3 Group options panel | ✅ | Removed display:none to show text grouping options |
| 2026-01-13 | 4.4 Error handling | ✅ | Added centralized handleError(), global error handlers |
| 2026-01-13 | 4.5 Browser compatibility | ✅ | Added checkBrowserCompatibility() with feature detection |
| 2026-01-13 | 5.1 Refactor main() | ✅ | Extracted setupKeyboardShortcuts(), setupZoomPanControls(), helper functions |
| 2026-01-13 | 5.2 Config module | ✅ | Created config.js with zoom, timing, crypto constants |
| 2026-01-13 | 5.3 Code duplication | ✅ | Exported getShapeBounds() for reuse |
| 2026-01-13 | 5.4 JSDoc comments | ✅ | Added JSDoc to all major exported functions in drawing.js |
| 2026-01-13 | 5.5 Unused code cleanup | ✅ | Removed unused currentReject from modal.js |

