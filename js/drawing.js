import * as Y from 'yjs';
import { generateId, safeColor, safeNumber } from './utils.js';
import {
  updateCursorPosition,
  clearCursorPosition,
  refreshCursors,
  updateCurrentDrawing,
  clearCurrentDrawing,
  getRemoteDrawings
} from './awareness.js';
import { showAlert } from './modal.js';
import { ZOOM_MIN, ZOOM_MAX, HIT_TEST_THRESHOLD } from './config.js';

let canvas = null;
let ctx = null;
let boards = null;
let awareness = null;
let getCurrentBoard = null;

// ============ Collaborative Text Editing Lock ============

function broadcastEditingText(shapeId) {
  if (!awareness) return;
  const state = awareness.getLocalState();
  if (state) {
    awareness.setLocalState({
      ...state,
      user: { ...state.user, editingTextId: shapeId }
    });
  }
}

function clearEditingTextBroadcast() {
  if (!awareness) return;
  const state = awareness.getLocalState();
  if (state && state.user?.editingTextId) {
    awareness.setLocalState({
      ...state,
      user: { ...state.user, editingTextId: null }
    });
  }
}

function getRemoteEditingUser(shapeId) {
  if (!awareness) return null;
  const states = awareness.getStates();
  for (const [clientId, state] of states) {
    if (clientId === awareness.clientID) continue;
    if (state?.user?.editingTextId === shapeId) {
      return state.user;
    }
  }
  return null;
}

// Read-only mode - prevents all mutations
let readOnlyMode = false;
let readOnlyWarningShown = false;

/**
 * Set read-only mode for the drawing canvas
 * When enabled, users can view and select shapes but cannot modify anything
 */
export function setReadOnlyMode(isReadOnly) {
  readOnlyMode = isReadOnly;
  readOnlyWarningShown = false;
}

/**
 * Check if currently in read-only mode
 */
export function isInReadOnlyMode() {
  return readOnlyMode;
}

/**
 * Show a warning when user tries to edit in read-only mode
 * Only shows once per session to avoid spam
 */
function showReadOnlyWarning() {
  if (!readOnlyWarningShown) {
    readOnlyWarningShown = true;
    showAlert('View Only Mode', 'You have view-only access to this board. You cannot make changes.');
  }
}

/**
 * Check if an operation is allowed (not in read-only mode)
 * Shows warning if blocked
 * @returns {boolean} true if operation is allowed
 */
function canMutate() {
  if (readOnlyMode) {
    showReadOnlyWarning();
    return false;
  }
  return true;
}

let drawing = false;
let startX = 0;
let startY = 0;
let currentTool = 'select';
let currentBoardObserver = null;
// The exact Y.Array instance we're currently observing. The boards Y.Map can
// swap a board's array instance out from under us — e.g. when each peer creates
// its own `default` board, a Y.Map conflict makes one instance win and orphans
// the other. We must re-subscribe to the live instance or remote edits stop
// triggering redraws even though the document itself syncs fine.
let observedBoardArray = null;

// Viewport state for infinite canvas
let viewport = {
  x: 0,      // Pan offset X (world coords of top-left corner)
  y: 0,      // Pan offset Y
  zoom: 1    // Zoom level (1 = 100%)
};

/**
 * Convert screen (mouse) coordinates to world coordinates
 * @param {number} screenX - X position in screen/pixel space
 * @param {number} screenY - Y position in screen/pixel space
 * @returns {{x: number, y: number}} Position in world/canvas space
 */
export function screenToWorld(screenX, screenY) {
  return {
    x: (screenX / viewport.zoom) + viewport.x,
    y: (screenY / viewport.zoom) + viewport.y
  };
}

/**
 * Convert world coordinates to screen coordinates
 * @param {number} worldX - X position in world/canvas space
 * @param {number} worldY - Y position in world/canvas space
 * @returns {{x: number, y: number}} Position in screen/pixel space
 */
export function worldToScreen(worldX, worldY) {
  return {
    x: (worldX - viewport.x) * viewport.zoom,
    y: (worldY - viewport.y) * viewport.zoom
  };
}

/**
 * Get current viewport state (pan offset and zoom level)
 * @returns {{x: number, y: number, zoom: number}} Current viewport state
 */
export function getViewport() {
  return { ...viewport };
}

/**
 * Set viewport state directly
 * @param {number} x - Pan offset X (world coords of top-left corner)
 * @param {number} y - Pan offset Y
 * @param {number} zoom - Zoom level (1 = 100%)
 */
export function setViewport(x, y, zoom) {
  viewport.x = x;
  viewport.y = y;
  viewport.zoom = zoom;
}

/**
 * Pan the viewport by a delta amount
 * @param {number} dx - Delta X in world coordinates
 * @param {number} dy - Delta Y in world coordinates
 */
export function panBy(dx, dy) {
  viewport.x += dx;
  viewport.y += dy;
  refreshCursors();
  updateTextInputPosition();
}

/**
 * Set the zoom level, clamped to valid range
 * @param {number} newZoom - New zoom level (1 = 100%)
 */
export function setZoom(newZoom) {
  viewport.zoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, newZoom));
  refreshCursors();
  updateTextInputPosition();
}

// Drawing options state
let strokeWidth = 2;
let fillEnabled = false;
let fillColor = '#ffffff';
let fontSize = 20;
let fontFamily = 'Arial';

// Selection state
let selectedIds = new Set(); // Support multi-select
let hoveredId = null;

// Clipboard for copy/paste
let clipboard = [];
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let dragOffsetX = 0;
let dragOffsetY = 0;

// Freehand drawing state
let freehandPoints = [];

// Shape controls container reference
let shapeControlsContainer = null;

// Text editing state
let editingTextId = null;
let textInput = null;
let creatingTextAt = null; // {x, y} position for new text being created

// Event listener tracking for cleanup
const eventListeners = [];

// Board map observer cleanup
let boardsMapObserver = null;

/**
 * Reset all in-progress drawing state.
 * Called when switching boards to prevent state from bleeding across boards.
 */
function resetDrawingState() {
  drawing = false;
  freehandPoints = [];

  clearEditingTextBroadcast();
  if (editingTextId || textInput) {
    finishTextEditing();
  }
  if (creatingTextAt) {
    finishTextCreation();
  }

  selectedIds.clear();
  hoveredId = null;
  isDragging = false;
  dragStartX = 0;
  dragStartY = 0;
  dragOffsetX = 0;
  dragOffsetY = 0;

  clearCurrentDrawing();
  hideShapeControls(true);
}

/**
 * Helper to add event listener with tracking for cleanup
 */
function addTrackedListener(element, event, handler, options) {
  element.addEventListener(event, handler, options);
  eventListeners.push({ element, event, handler, options });
}

/**
 * Cleanup all resources - call when unmounting or before re-initializing
 */
export function cleanup() {
  // Remove all tracked event listeners
  eventListeners.forEach(({ element, event, handler, options }) => {
    element.removeEventListener(event, handler, options);
  });
  eventListeners.length = 0;

  // Unsubscribe from current board
  if (currentBoardObserver) {
    currentBoardObserver();
    currentBoardObserver = null;
  }

  // Unsubscribe from boards map
  if (boardsMapObserver) {
    boardsMapObserver();
    boardsMapObserver = null;
  }

  // Close any open popups
  hideShapeSettingsPopup(true);
  hideShapeControls(true);

  // Clean up text input if open
  clearEditingTextBroadcast();
  if (textInput) {
    textInput.remove();
    textInput = null;
    editingTextId = null;
    creatingTextAt = null;
  }

  // Reset state
  canvas = null;
  ctx = null;
  boards = null;
  awareness = null;
  getCurrentBoard = null;
  selectedIds.clear();
  hoveredId = null;
  isDragging = false;
  drawing = false;
}

/**
 * Initialize the drawing system with a canvas and Y.js board data
 * @param {HTMLCanvasElement} canvasEl - The canvas element to draw on
 * @param {Y.Map} boardsMap - Y.js Map containing board data
 * @param {Awareness} awarenessInstance - Y.js Awareness instance for cursor tracking
 * @param {Function} getBoardFn - Function that returns current board name
 * @returns {Object} Controller object with methods: setTool, getTool, redraw, subscribeToBoard, etc.
 */
export function setupDrawing(canvasEl, boardsMap, awarenessInstance, getBoardFn) {
  // Clean up any previous instance
  if (canvas) {
    cleanup();
  }

  canvas = canvasEl;
  ctx = canvas.getContext('2d');
  boards = boardsMap;
  awareness = awarenessInstance;
  getCurrentBoard = getBoardFn;
  shapeControlsContainer = document.getElementById('shape-controls');

  // Subscribe to initial board
  subscribeToBoard(getCurrentBoard());

  // Watch for board map changes (boards created by remote peers, or the current
  // board's array instance being replaced by a Y.Map conflict).
  const boardsObserverFn = () => {
    const currentBoardName = getCurrentBoard();
    const board = boards.get(currentBoardName);

    // Re-subscribe if the current board appeared, or if its array INSTANCE
    // changed (e.g. a remote 'default' won a conflict against our local one).
    // Without the instance check, our observer stays bound to an orphaned array
    // and remote edits never trigger a redraw.
    if (board && (!currentBoardObserver || board !== observedBoardArray)) {
      subscribeToBoard(currentBoardName);
    }
  };
  boards.observe(boardsObserverFn);
  boardsMapObserver = () => boards.unobserve(boardsObserverFn);

  // Setup event listeners with tracking for cleanup
  addTrackedListener(canvas, 'mousedown', handleMouseDown);
  addTrackedListener(canvas, 'mouseup', handleMouseUp);
  addTrackedListener(canvas, 'mousemove', handleMouseMove);
  addTrackedListener(canvas, 'mouseleave', handleMouseLeave);
  addTrackedListener(canvas, 'dblclick', handleDoubleClick);

  // Touch event handlers
  addTrackedListener(canvas, 'touchstart', handleTouchStart, { passive: false });
  addTrackedListener(canvas, 'touchmove', handleTouchMove, { passive: false });
  addTrackedListener(canvas, 'touchend', handleTouchEnd, { passive: false });
  addTrackedListener(canvas, 'touchcancel', handleTouchEnd, { passive: false });

  return {
    setTool: (tool) => {
      currentTool = tool;
      clearSelection();
      updateCanvasCursor();
    },
    getTool: () => currentTool,
    redraw: () => redrawCanvas(),
    subscribeToBoard,
    setStrokeWidth: (width) => { strokeWidth = width; },
    setFillEnabled: (enabled) => { fillEnabled = enabled; },
    setFillColor: (color) => { fillColor = color; },
    setFontSize: (size) => { fontSize = size; },
    setFontFamily: (family) => { fontFamily = family; },
    getSelectedIds: () => selectedIds,
    clearSelection,
    cleanup // Allow external cleanup calls
  };
}

function updateCanvasCursor() {
  const container = document.getElementById('canvas-container');
  container.classList.remove('tool-select', 'tool-eraser', 'tool-freehand', 'dragging');

  if (currentTool === 'select') {
    container.classList.add('tool-select');
  } else if (currentTool === 'eraser-shape') {
    container.classList.add('tool-eraser');
  } else if (currentTool === 'freehand' || currentTool === 'eraser-brush') {
    container.classList.add('tool-freehand');
  }
}

function handleMouseDown(e) {
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  // Convert to world coordinates
  const world = screenToWorld(screenX, screenY);
  startX = world.x;
  startY = world.y;

  // Handle selection/move tool
  if (currentTool === 'select') {
    const shape = findShapeAtPoint(startX, startY);
    if (shape) {
      if (selectedIds.has(shape.id)) {
        // Don't allow dragging locked shapes
        if (shape.locked) {
          return;
        }
        // Don't allow dragging in read-only mode
        if (readOnlyMode) {
          showReadOnlyWarning();
          return;
        }
        // Start dragging selected shape(s)
        isDragging = true;
        dragStartX = startX;
        dragStartY = startY;
        const bounds = getShapeBounds(shape);
        dragOffsetX = startX - bounds.x;
        dragOffsetY = startY - bounds.y;
        document.getElementById('canvas-container').classList.add('dragging');
      } else {
        // Shift+click to add to selection, otherwise replace
        setSelected(shape.id, e.shiftKey);
      }
    } else {
      // Only clear selection if clicking on truly empty canvas.
      // Give a small delay to let button clicks register first.
      // Capture the click coords locally - startX/startY are module-level and
      // can be overwritten by an intervening mousedown before the timeout runs.
      const clickX = startX;
      const clickY = startY;
      setTimeout(() => {
        // Check if we're still not over any shape (user didn't move to a shape)
        if (!findShapeAtPoint(clickX, clickY)) {
          clearSelection();
        }
      }, 50);
    }
    return;
  }

  // Handle shape eraser
  if (currentTool === 'eraser-shape') {
    if (!canMutate()) return; // Block in read-only mode
    const shape = findShapeAtPoint(startX, startY);
    if (shape) {
      deleteShape(shape.id);
    }
    return;
  }

  // Handle text tool - start inline text creation
  if (currentTool === 'text') {
    if (!canMutate()) return; // Block in read-only mode
    startTextCreation(startX, startY);
    return;
  }

  // Handle freehand and brush eraser
  if (currentTool === 'freehand' || currentTool === 'eraser-brush') {
    if (!canMutate()) return; // Block in read-only mode
    drawing = true;
    freehandPoints = [{ x: startX, y: startY }];
    return;
  }

  // Handle shape drawing tools
  if (['line', 'rect', 'circle'].includes(currentTool)) {
    if (!canMutate()) return; // Block in read-only mode
    drawing = true;
  }
}

function handleMouseUp(e) {
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  // Convert to world coordinates
  const world = screenToWorld(screenX, screenY);
  const x = world.x;
  const y = world.y;

  // Handle drag end
  if (isDragging && selectedIds.size > 0) {
    isDragging = false;
    document.getElementById('canvas-container').classList.remove('dragging');

    const dx = x - dragStartX;
    const dy = y - dragStartY;

    if (Math.abs(dx) > 1 || Math.abs(dy) > 1) {
      // Move all selected shapes
      selectedIds.forEach(id => {
        moveShape(id, dx, dy);
      });
    }
    return;
  }

  if (!drawing) return;
  drawing = false;

  // Clear the live preview for other users
  clearCurrentDrawing();

  // Handle freehand drawing
  if (currentTool === 'freehand' && freehandPoints.length > 1) {
    addDrawing({
      tool: 'freehand',
      points: [...freehandPoints],
      strokeWidth: strokeWidth
    });
    freehandPoints = [];
    redrawCanvas();
    return;
  }

  // Handle brush eraser
  if (currentTool === 'eraser-brush' && freehandPoints.length > 1) {
    addDrawing({
      tool: 'eraser',
      points: [...freehandPoints],
      color: '#FFFFFF',
      strokeWidth: strokeWidth * 3
    });
    freehandPoints = [];
    redrawCanvas();
    return;
  }

  // Handle shape tools
  if (currentTool === 'line') {
    addDrawing({
      tool: 'line',
      startX,
      startY,
      x,
      y,
      strokeWidth: strokeWidth
    });
  } else if (currentTool === 'rect') {
    addDrawing({
      tool: 'rect',
      startX,
      startY,
      width: x - startX,
      height: y - startY,
      strokeWidth: strokeWidth,
      fillColor: fillEnabled ? fillColor : null
    });
  } else if (currentTool === 'circle') {
    const radius = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
    addDrawing({
      tool: 'circle',
      startX,
      startY,
      radius,
      strokeWidth: strokeWidth,
      fillColor: fillEnabled ? fillColor : null
    });
  }
}

function handleMouseMove(e) {
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  // Convert to world coordinates
  const world = screenToWorld(screenX, screenY);
  const x = world.x;
  const y = world.y;

  // Update cursor position for other users to see (use world coords for cross-viewport consistency)
  updateCursorPosition(x, y);

  // Handle dragging
  if (isDragging && selectedIds.size > 0) {
    // Draw preview of dragged shapes
    redrawCanvas();
    const dx = x - dragStartX;
    const dy = y - dragStartY;
    selectedIds.forEach(id => {
      const shape = findShapeById(id);
      if (shape) {
        drawShapePreview(shape, dx, dy);
      }
    });
    return;
  }

  // Handle freehand drawing preview
  if (drawing && (currentTool === 'freehand' || currentTool === 'eraser-brush')) {
    freehandPoints.push({ x, y });
    drawFreehandPreview();
    // Broadcast to other users
    updateCurrentDrawing({
      tool: currentTool === 'eraser-brush' ? 'eraser' : 'freehand',
      points: freehandPoints,
      strokeWidth: currentTool === 'eraser-brush' ? strokeWidth * 3 : strokeWidth
    });
    return;
  }

  // Handle shape drawing preview
  if (drawing && ['line', 'rect', 'circle'].includes(currentTool)) {
    redrawCanvas();
    drawShapeCreationPreview(x, y);
    // Broadcast to other users
    if (currentTool === 'line') {
      updateCurrentDrawing({
        tool: 'line',
        startX, startY,
        x, y,
        strokeWidth
      });
    } else if (currentTool === 'rect') {
      updateCurrentDrawing({
        tool: 'rect',
        startX, startY,
        width: x - startX,
        height: y - startY,
        strokeWidth,
        fillColor: fillEnabled ? fillColor : null
      });
    } else if (currentTool === 'circle') {
      const radius = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
      updateCurrentDrawing({
        tool: 'circle',
        startX, startY,
        radius,
        strokeWidth,
        fillColor: fillEnabled ? fillColor : null
      });
    }
    return;
  }

  // Handle hover detection for select tool
  if (currentTool === 'select' || currentTool === 'eraser-shape') {
    const shape = findShapeAtPoint(x, y);
    let newHoveredId = shape ? shape.id : null;

    // Keep hover active if we have a selected shape (controls should stay visible)
    // or if we're hovering near a shape that has controls showing
    if (!newHoveredId && controlsForShapeId && selectedIds.size === 0) {
      // Check if we're close to the shape with controls (expanded area in world coords)
      const controlsShape = findShapeById(controlsForShapeId);
      if (controlsShape) {
        const bounds = getShapeBounds(controlsShape);
        const expandPx = 40 / viewport.zoom; // Adjust for zoom
        const expandedBounds = {
          x: bounds.x - expandPx,
          y: bounds.y - expandPx / 2,
          width: bounds.width + expandPx * 1.5,
          height: bounds.height + expandPx * 0.75
        };
        if (x >= expandedBounds.x && x <= expandedBounds.x + expandedBounds.width &&
            y >= expandedBounds.y && y <= expandedBounds.y + expandedBounds.height) {
          newHoveredId = controlsForShapeId;
        }
      }
    }

    if (newHoveredId !== hoveredId) {
      hoveredId = newHoveredId;
      redrawCanvas();
    }
  }
}

function handleMouseLeave() {
  clearCursorPosition();
  // Only clear hover, keep selection and its controls
  if (selectedIds.size === 0) {
    hoveredId = null;
    hideShapeControls();
    redrawCanvas();
  }
}

function handleDoubleClick(e) {
  const rect = canvas.getBoundingClientRect();
  const screenX = e.clientX - rect.left;
  const screenY = e.clientY - rect.top;

  // Convert to world coordinates
  const world = screenToWorld(screenX, screenY);

  const shape = findShapeAtPoint(world.x, world.y);
  if (shape && shape.tool === 'text') {
    startTextEditing(shape);
  }
}

// ============ Touch Event Handlers ============

// Track pinch-to-zoom state
let touchState = {
  active: false,
  startDistance: 0,
  startZoom: 1,
  startPanX: 0,
  startPanY: 0,
  startCenterX: 0,
  startCenterY: 0,
  lastTap: 0,
  lastTapX: 0,
  lastTapY: 0
};

/**
 * Get touch position relative to canvas
 */
function getTouchPos(touch) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: touch.clientX - rect.left,
    y: touch.clientY - rect.top
  };
}

/**
 * Calculate distance between two touch points
 */
function getTouchDistance(touch1, touch2) {
  const dx = touch2.clientX - touch1.clientX;
  const dy = touch2.clientY - touch1.clientY;
  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Get center point between two touches
 */
function getTouchCenter(touch1, touch2) {
  const rect = canvas.getBoundingClientRect();
  return {
    x: (touch1.clientX + touch2.clientX) / 2 - rect.left,
    y: (touch1.clientY + touch2.clientY) / 2 - rect.top
  };
}

function handleTouchStart(e) {
  e.preventDefault();

  if (e.touches.length === 1) {
    // Single touch - treat as mouse down
    const pos = getTouchPos(e.touches[0]);

    // Check for double-tap
    const now = Date.now();
    const timeSinceLastTap = now - touchState.lastTap;
    const distFromLastTap = Math.sqrt(
      Math.pow(pos.x - touchState.lastTapX, 2) +
      Math.pow(pos.y - touchState.lastTapY, 2)
    );

    if (timeSinceLastTap < 300 && distFromLastTap < 30) {
      // Double tap detected
      handleDoubleClick({
        clientX: e.touches[0].clientX,
        clientY: e.touches[0].clientY
      });
      touchState.lastTap = 0;
      return;
    }

    touchState.lastTap = now;
    touchState.lastTapX = pos.x;
    touchState.lastTapY = pos.y;

    // Simulate mouse down
    handleMouseDown({
      clientX: e.touches[0].clientX,
      clientY: e.touches[0].clientY,
      button: 0
    });
  } else if (e.touches.length === 2) {
    // Two-finger gesture - start pinch zoom
    touchState.active = true;
    touchState.startDistance = getTouchDistance(e.touches[0], e.touches[1]);
    touchState.startZoom = viewport.zoom;
    touchState.startPanX = viewport.x;
    touchState.startPanY = viewport.y;

    const center = getTouchCenter(e.touches[0], e.touches[1]);
    touchState.startCenterX = center.x;
    touchState.startCenterY = center.y;

    // Cancel any ongoing drawing
    if (drawing) {
      drawing = false;
      freehandPoints = [];
    }
    if (isDragging) {
      isDragging = false;
    }
  }
}

function handleTouchMove(e) {
  e.preventDefault();

  if (e.touches.length === 1 && !touchState.active) {
    // Single touch - treat as mouse move
    handleMouseMove({
      clientX: e.touches[0].clientX,
      clientY: e.touches[0].clientY
    });
  } else if (e.touches.length === 2 && touchState.active) {
    // Two-finger gesture - handle pinch zoom and pan
    const currentDistance = getTouchDistance(e.touches[0], e.touches[1]);
    const center = getTouchCenter(e.touches[0], e.touches[1]);

    // Calculate new zoom
    const scale = currentDistance / touchState.startDistance;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, touchState.startZoom * scale));

    // Calculate the world point under the center at the start
    const worldCenterX = (touchState.startCenterX / touchState.startZoom) + touchState.startPanX;
    const worldCenterY = (touchState.startCenterY / touchState.startZoom) + touchState.startPanY;

    // Calculate new pan to keep the world point under the current center
    viewport.zoom = newZoom;
    viewport.x = worldCenterX - (center.x / newZoom);
    viewport.y = worldCenterY - (center.y / newZoom);

    redrawCanvas();
    refreshCursors(); // Update remote cursor positions for new viewport
    updateTextInputPosition(); // Update text input if editing

    // Dispatch zoom change event for UI update
    window.dispatchEvent(new CustomEvent('viewport-change', {
      detail: { zoom: newZoom }
    }));
  }
}

function handleTouchEnd(e) {
  e.preventDefault();

  if (e.touches.length === 0) {
    // All touches ended
    if (!touchState.active) {
      // Was single touch - treat as mouse up
      handleMouseUp({ button: 0 });
    }
    touchState.active = false;
  } else if (e.touches.length === 1) {
    // One finger lifted - switch from pinch to single touch mode
    touchState.active = false;

    // Don't start a new drawing, just reset
    drawing = false;
    freehandPoints = [];
    clearCurrentDrawing(); // Clear live preview for other users
  }
}

// ============ Selection Functions ============

function setSelected(id, addToSelection = false) {
  if (addToSelection) {
    // Toggle selection if shift is held
    if (selectedIds.has(id)) {
      selectedIds.delete(id);
    } else {
      selectedIds.add(id);
    }
  } else {
    // Replace selection
    selectedIds.clear();
    selectedIds.add(id);
  }
  redrawCanvas();
}

function clearSelection() {
  selectedIds.clear();
  hoveredId = null;
  hideShapeControls(true); // Force close popup when selection is cleared
  redrawCanvas();
}

/**
 * Get the set of currently selected shape IDs
 * @returns {Set<string>} Set of selected shape IDs
 */
export function getSelectedIds() {
  return selectedIds;
}

/**
 * Get the first selected shape ID (for single-selection operations)
 * @returns {string|null} First selected shape ID or null if none selected
 */
export function getSelected() {
  return selectedIds.size > 0 ? selectedIds.values().next().value : null;
}

/**
 * Delete all currently selected shapes
 * No-op if in read-only mode or nothing selected
 */
export function deleteSelectedShapes() {
  if (selectedIds.size === 0) return;
  if (!canMutate()) return;

  // Copy the set since deleteShape will modify it
  const idsToDelete = [...selectedIds];
  idsToDelete.forEach(id => {
    deleteShape(id);
  });
  redrawCanvas();
}

/**
 * Copy selected shapes to internal clipboard
 * @returns {number} Number of shapes copied
 */
export function copySelectedShapes() {
  if (selectedIds.size === 0) return;

  clipboard = [];
  selectedIds.forEach(id => {
    const shape = findShapeById(id);
    if (shape) {
      clipboard.push(JSON.parse(JSON.stringify(shape)));
    }
  });
  return clipboard.length;
}

/**
 * Paste shapes from internal clipboard with position offset
 * @param {number} offsetX - X offset from original position (default 20)
 * @param {number} offsetY - Y offset from original position (default 20)
 * @returns {number} Number of shapes pasted
 */
export function pasteShapes(offsetX = 20, offsetY = 20) {
  if (clipboard.length === 0) return;
  if (!canMutate()) return;

  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return;

  // Clear current selection
  selectedIds.clear();

  // Paste each shape with new ID and offset
  clipboard.forEach(shapeCopy => {
    const newShape = {
      ...shapeCopy,
      id: generateId(),
      locked: false // Don't paste locked state
    };

    // Offset position
    if (newShape.x !== undefined) newShape.x += offsetX;
    if (newShape.y !== undefined) newShape.y += offsetY;
    if (newShape.startX !== undefined) newShape.startX += offsetX;
    if (newShape.startY !== undefined) newShape.startY += offsetY;
    if (newShape.endX !== undefined) newShape.endX += offsetX;
    if (newShape.endY !== undefined) newShape.endY += offsetY;
    if (newShape.points) {
      newShape.points = newShape.points.map(p => ({
        x: p.x + offsetX,
        y: p.y + offsetY
      }));
    }

    board.push([newShape]);
    selectedIds.add(newShape.id);
  });

  redrawCanvas();
  return clipboard.length;
}

/**
 * Duplicate selected shapes in place with a small offset
 * Combines copy and paste operations
 * @returns {number} Number of shapes duplicated
 */
export function duplicateSelectedShapes() {
  copySelectedShapes();
  return pasteShapes(20, 20);
}

// ============ Shape Control Buttons ============

// Track the shape ID currently showing controls
let controlsForShapeId = null;

function showShapeControls(shape, bounds, isSelected) {
  if (!shapeControlsContainer) return;

  // Only recreate buttons if showing for a different shape
  if (controlsForShapeId === shape.id) {
    // Just update positions
    const deleteBtn = shapeControlsContainer.querySelector('.delete');
    const settingsBtn = shapeControlsContainer.querySelector('.settings');
    const lockBtn = shapeControlsContainer.querySelector('.lock');
    if (deleteBtn) {
      deleteBtn.style.left = `${bounds.x + bounds.width + 8}px`;
      deleteBtn.style.top = `${bounds.y - 4}px`;
    }
    if (lockBtn) {
      lockBtn.style.left = `${bounds.x + bounds.width + 8}px`;
      lockBtn.style.top = `${bounds.y + 36}px`;
    }
    if (settingsBtn) {
      settingsBtn.style.left = `${bounds.x - 38}px`;
      settingsBtn.style.top = `${bounds.y - 4}px`;
    }
    // Also update popup position if it's open
    if (currentPopup) {
      currentPopup.style.left = `${bounds.x - 50}px`;
      currentPopup.style.top = `${bounds.y + bounds.height + 15}px`;
    }
    return;
  }

  // If popup is open for this shape, keep it but remove old buttons
  if (currentPopup && popupShapeId === shape.id) {
    const buttons = shapeControlsContainer.querySelectorAll('.shape-control-btn');
    buttons.forEach(btn => btn.remove());
  } else {
    // Clear everything including any old popup
    shapeControlsContainer.innerHTML = '';
  }
  controlsForShapeId = shape.id;

  // Delete button
  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'shape-control-btn delete';
  deleteBtn.innerHTML = '&times;';
  deleteBtn.style.left = `${bounds.x + bounds.width + 8}px`;
  deleteBtn.style.top = `${bounds.y - 4}px`;
  deleteBtn.title = shape.locked ? 'Unlock to delete' : 'Delete';
  if (shape.locked) {
    deleteBtn.style.opacity = '0.4';
    deleteBtn.style.cursor = 'not-allowed';
  }
  shapeControlsContainer.appendChild(deleteBtn);

  deleteBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    if (shape.locked) {
      showAlert('Shape Locked', 'This shape is locked and cannot be deleted. Unlock it first.');
      return;
    }
    const idToDelete = shape.id;
    deleteShape(idToDelete);
  });

  // Lock button
  const lockBtn = document.createElement('button');
  lockBtn.className = 'shape-control-btn lock';
  lockBtn.innerHTML = shape.locked ? '&#128274;' : '&#128275;'; // Lock/unlock icons
  lockBtn.style.left = `${bounds.x + bounds.width + 8}px`;
  lockBtn.style.top = `${bounds.y + 36}px`;
  lockBtn.title = shape.locked ? 'Unlock shape' : 'Lock shape';
  if (shape.locked) {
    lockBtn.classList.add('locked');
  }
  shapeControlsContainer.appendChild(lockBtn);

  lockBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    toggleShapeLock(shape.id);
  });

  // Settings button (shown at top-left)
  const settingsBtn = document.createElement('button');
  settingsBtn.className = 'shape-control-btn settings';
  settingsBtn.innerHTML = '&#9881;'; // Gear icon
  settingsBtn.style.left = `${bounds.x - 38}px`;
  settingsBtn.style.top = `${bounds.y - 4}px`;
  settingsBtn.title = 'Edit shape properties';
  shapeControlsContainer.appendChild(settingsBtn);

  settingsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    e.preventDefault();
    showShapeSettingsPopup(shape, bounds);
  });
}

// Shape settings popup
let currentPopup = null;
let popupShapeId = null; // Track which shape the popup is for
let popupInteracting = false; // Track if user is interacting with popup

function showShapeSettingsPopup(shape, bounds) {
  // Close any existing popup
  hideShapeSettingsPopup();

  const popup = document.createElement('div');
  popup.className = 'shape-settings-popup';
  popup.style.left = `${bounds.x - 50}px`;
  popup.style.top = `${bounds.y + bounds.height + 15}px`;

  // Track which shape this popup is for
  popupShapeId = shape.id;

  // Track when user is interacting with popup (prevents accidental closure)
  popup.addEventListener('mousedown', (e) => {
    e.stopPropagation();
    popupInteracting = true;
  });
  popup.addEventListener('mouseup', () => {
    // Delay resetting to allow click handler to process first
    setTimeout(() => { popupInteracting = false; }, 100);
  });
  popup.addEventListener('click', (e) => {
    e.stopPropagation();
  });
  popup.addEventListener('mouseleave', () => {
    popupInteracting = false;
  });

  // Determine which controls to show based on shape type
  const hasStroke = shape.tool !== 'text';
  const hasFill = shape.tool === 'rect' || shape.tool === 'circle';
  const isText = shape.tool === 'text';

  // Dynamic header based on shape type
  const headerText = isText ? 'Text Settings' :
    shape.tool === 'freehand' ? 'Freehand Settings' :
    shape.tool.charAt(0).toUpperCase() + shape.tool.slice(1) + ' Settings';

  let html = `<div class="popup-header">${headerText}</div>`;

  // Shape fields are authored by remote peers via the shared CRDT doc, so
  // sanitize anything interpolated into this innerHTML: colors to strict hex,
  // numbers to finite values. (fontFamily below is matched with === so it is
  // not injectable.)
  const strokeColor = safeColor(shape.color);
  const strokeWidth = safeNumber(shape.strokeWidth, 2);
  const fillColor = safeColor(shape.fillColor, '#ffffff');
  const fontSize = safeNumber(shape.fontSize, 20);

  // Stroke color (for all except text uses fill)
  html += `
    <div class="popup-row">
      <label>${isText ? 'Color' : 'Stroke Color'}</label>
      <input type="color" id="shape-color" value="${strokeColor}">
    </div>
  `;

  // Stroke width (for shapes with strokes)
  if (hasStroke && !isText) {
    html += `
      <div class="popup-row">
        <label>Thickness</label>
        <input type="range" id="shape-stroke-width" min="1" max="20" value="${strokeWidth}">
        <span id="shape-stroke-value">${strokeWidth}px</span>
      </div>
    `;
  }

  // Fill controls (for rect and circle)
  if (hasFill) {
    html += `
      <div class="popup-row">
        <label>Fill</label>
        <input type="checkbox" id="shape-fill-enabled" ${shape.fillColor ? 'checked' : ''}>
        <input type="color" id="shape-fill-color" value="${fillColor}" ${shape.fillColor ? '' : 'disabled'}>
      </div>
    `;
  }

  // Font size (for text)
  if (isText) {
    html += `
      <div class="popup-row">
        <label>Font Size</label>
        <input type="range" id="shape-font-size" min="12" max="72" value="${fontSize}">
        <span id="shape-font-size-value">${fontSize}px</span>
      </div>
      <div class="popup-row">
        <label>Font</label>
        <select id="shape-font-family">
          <option value="Arial" ${shape.fontFamily === 'Arial' ? 'selected' : ''}>Arial</option>
          <option value="Georgia" ${shape.fontFamily === 'Georgia' ? 'selected' : ''}>Georgia</option>
          <option value="Courier New" ${shape.fontFamily === 'Courier New' ? 'selected' : ''}>Courier New</option>
          <option value="Verdana" ${shape.fontFamily === 'Verdana' ? 'selected' : ''}>Verdana</option>
          <option value="Times New Roman" ${shape.fontFamily === 'Times New Roman' ? 'selected' : ''}>Times New Roman</option>
        </select>
      </div>
    `;
  }

  // Layer controls (always shown)
  html += `
    <div class="popup-divider"></div>
    <div class="popup-row layer-controls">
      <button class="layer-btn" id="layer-to-back" title="Send to Back">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="3" y="3" width="7" height="7" rx="1"/>
          <rect x="14" y="14" width="7" height="7" rx="1" fill="currentColor"/>
        </svg>
      </button>
      <button class="layer-btn" id="layer-down" title="Move Down">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 5v14M5 12l7 7 7-7"/>
        </svg>
      </button>
      <button class="layer-btn" id="layer-up" title="Move Up">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M12 19V5M5 12l7-7 7 7"/>
        </svg>
      </button>
      <button class="layer-btn" id="layer-to-front" title="Bring to Front">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <rect x="14" y="14" width="7" height="7" rx="1"/>
          <rect x="3" y="3" width="7" height="7" rx="1" fill="currentColor"/>
        </svg>
      </button>
    </div>
  `;

  popup.innerHTML = html;

  // Disable all inputs if shape is locked
  if (shape.locked) {
    popup.classList.add('locked');
    const inputs = popup.querySelectorAll('input, select');
    inputs.forEach(input => {
      input.disabled = true;
    });
    // Add locked notice
    const notice = document.createElement('div');
    notice.className = 'popup-locked-notice';
    notice.innerHTML = '&#128274; Shape is locked';
    popup.appendChild(notice);
  }

  shapeControlsContainer.appendChild(popup);
  currentPopup = popup;

  // Clamp popup position to viewport bounds
  requestAnimationFrame(() => {
    const container = document.getElementById('canvas-container');
    if (!container || !popup) return;

    const containerRect = container.getBoundingClientRect();
    const popupRect = popup.getBoundingClientRect();
    const margin = 10;

    let left = parseFloat(popup.style.left);
    let top = parseFloat(popup.style.top);

    // Clamp right edge
    if (left + popupRect.width > containerRect.width - margin) {
      left = containerRect.width - popupRect.width - margin;
    }
    // Clamp left edge
    if (left < margin) {
      left = margin;
    }
    // Clamp bottom edge
    if (top + popupRect.height > containerRect.height - margin) {
      // Try positioning above the shape instead
      top = bounds.y - popupRect.height - 15;
    }
    // Clamp top edge
    if (top < margin) {
      top = margin;
    }

    popup.style.left = `${left}px`;
    popup.style.top = `${top}px`;
  });

  // Wire up event handlers
  const colorInput = popup.querySelector('#shape-color');
  if (colorInput) {
    colorInput.addEventListener('input', (e) => {
      updateShapeProperty(shape.id, 'color', e.target.value);
    });
  }

  const strokeWidthInput = popup.querySelector('#shape-stroke-width');
  const strokeValueSpan = popup.querySelector('#shape-stroke-value');
  if (strokeWidthInput) {
    strokeWidthInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      strokeValueSpan.textContent = `${val}px`;
      updateShapeProperty(shape.id, 'strokeWidth', val);
    });
  }

  const fillEnabledInput = popup.querySelector('#shape-fill-enabled');
  const fillColorInput = popup.querySelector('#shape-fill-color');
  if (fillEnabledInput && fillColorInput) {
    fillEnabledInput.addEventListener('change', (e) => {
      fillColorInput.disabled = !e.target.checked;
      updateShapeProperty(shape.id, 'fillColor', e.target.checked ? fillColorInput.value : null);
    });
    fillColorInput.addEventListener('input', (e) => {
      updateShapeProperty(shape.id, 'fillColor', e.target.value);
    });
  }

  const fontSizeInput = popup.querySelector('#shape-font-size');
  const fontSizeValueSpan = popup.querySelector('#shape-font-size-value');
  if (fontSizeInput) {
    fontSizeInput.addEventListener('input', (e) => {
      const val = parseInt(e.target.value);
      fontSizeValueSpan.textContent = `${val}px`;
      updateShapeProperty(shape.id, 'fontSize', val);
    });
  }

  const fontFamilySelect = popup.querySelector('#shape-font-family');
  if (fontFamilySelect) {
    fontFamilySelect.addEventListener('change', (e) => {
      updateShapeProperty(shape.id, 'fontFamily', e.target.value);
    });
  }

  // Layer control handlers
  const layerToBack = popup.querySelector('#layer-to-back');
  const layerDown = popup.querySelector('#layer-down');
  const layerUp = popup.querySelector('#layer-up');
  const layerToFront = popup.querySelector('#layer-to-front');

  if (layerToBack) {
    layerToBack.addEventListener('click', (e) => {
      e.stopPropagation();
      sendToBack(shape.id);
    });
  }
  if (layerDown) {
    layerDown.addEventListener('click', (e) => {
      e.stopPropagation();
      moveDown(shape.id);
    });
  }
  if (layerUp) {
    layerUp.addEventListener('click', (e) => {
      e.stopPropagation();
      moveUp(shape.id);
    });
  }
  if (layerToFront) {
    layerToFront.addEventListener('click', (e) => {
      e.stopPropagation();
      bringToFront(shape.id);
    });
  }

  // Close popup when clicking outside (use 'click' not 'mousedown' to allow dragging)
  setTimeout(() => {
    document.addEventListener('click', handlePopupOutsideClick, true);
  }, 100);
}

function handlePopupOutsideClick(e) {
  // Don't close if no popup or if user is currently interacting with it
  if (!currentPopup || popupInteracting) return;

  // Check if click is inside the popup by walking up the DOM tree
  let element = e.target;
  while (element) {
    if (element === currentPopup || element.classList?.contains('shape-settings-popup')) {
      return; // Click was inside popup, don't close
    }
    if (element.classList?.contains('settings')) {
      return; // Click was on settings button, don't close
    }
    element = element.parentElement;
  }

  // Click was outside, close the popup
  hideShapeSettingsPopup(true); // Force close since this is an explicit action
}

function hideShapeSettingsPopup(force = false) {
  // Don't close if user is currently interacting with the popup (unless forced)
  if (popupInteracting && !force) {
    return;
  }

  if (currentPopup) {
    currentPopup.remove();
    currentPopup = null;
    popupShapeId = null;
    popupInteracting = false;
    document.removeEventListener('click', handlePopupOutsideClick, true);
  }
}

function hideShapeControls(forceClosePopup = false) {
  // Only close popup if forced (e.g., shape deleted) or no popup is open
  // This prevents the popup from closing during interactions
  if (forceClosePopup || !currentPopup) {
    hideShapeSettingsPopup(forceClosePopup);
  }

  if (shapeControlsContainer) {
    // If popup is open, only remove the buttons, not the popup
    if (currentPopup) {
      const buttons = shapeControlsContainer.querySelectorAll('.shape-control-btn');
      buttons.forEach(btn => btn.remove());
    } else {
      shapeControlsContainer.innerHTML = '';
    }
  }
  controlsForShapeId = null;
}

function getControlsShapeId() {
  return controlsForShapeId;
}

// ============ Text Editing ============

// Start creating new text at the given world position
function startTextCreation(worldX, worldY) {
  // Finish any existing text editing/creation first
  if (editingTextId) {
    finishTextEditing();
  }
  if (creatingTextAt) {
    finishTextCreation();
  }

  const container = document.getElementById('canvas-container');
  if (!container) {
    console.error('startTextCreation: canvas-container not found');
    return;
  }

  creatingTextAt = { x: worldX, y: worldY };

  const localState = awareness?.getLocalState();
  const color = localState?.user?.color || '#000000';

  // Convert world coordinates to screen coordinates for input positioning
  const screenPos = worldToScreen(worldX, worldY);
  const scaledFontSize = fontSize * viewport.zoom;

  // Clamp position to keep input within container bounds
  const containerRect = container.getBoundingClientRect();
  const inputWidth = 200; // Approximate width for clamping
  const inputHeight = scaledFontSize + 20; // Approximate height
  const margin = 10;

  const clampedX = Math.min(screenPos.x, containerRect.width - inputWidth - margin);
  const clampedY = Math.max(inputHeight + margin, Math.min(screenPos.y, containerRect.height - margin));

  textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.value = '';
  textInput.className = 'text-edit-input';
  textInput.style.position = 'absolute';
  textInput.style.left = `${Math.max(margin, clampedX)}px`;
  textInput.style.top = `${clampedY}px`;
  textInput.style.fontSize = `${scaledFontSize}px`;
  textInput.style.fontFamily = fontFamily;
  textInput.style.maxWidth = `${containerRect.width - margin * 2}px`;
  textInput.style.transform = 'translateY(-100%)'; // Position above click point

  // Live preview as user types
  textInput.addEventListener('input', () => {
    // Broadcast text being typed for live preview
    updateCurrentDrawing({
      tool: 'text',
      x: worldX,
      y: worldY,
      text: textInput.value,
      fontSize: fontSize,
      fontFamily: fontFamily
    });
    redrawCanvas();
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      finishTextCreation();
    } else if (e.key === 'Escape') {
      cancelTextCreation();
    }
  });

  container.appendChild(textInput);

  // Defer focus to ensure it happens after all current event handling completes
  // This prevents the canvas mouseup from stealing focus
  requestAnimationFrame(() => {
    if (textInput) {
      textInput.focus();

      // Add blur listener after focus is established
      setTimeout(() => {
        if (textInput) {
          textInput.addEventListener('blur', finishTextCreation);
        }
      }, 100);
    }
  });
}

function finishTextCreation() {
  if (!creatingTextAt || !textInput) return;

  const text = textInput.value;
  if (text && text.trim()) {
    addDrawing({
      tool: 'text',
      x: creatingTextAt.x,
      y: creatingTextAt.y,
      text: text,
      fontSize: fontSize,
      fontFamily: fontFamily
    });
  }

  // Clear live preview
  clearCurrentDrawing();

  creatingTextAt = null;
  textInput.remove();
  textInput = null;
  redrawCanvas();
}

function cancelTextCreation() {
  if (!creatingTextAt || !textInput) return;

  clearCurrentDrawing();
  creatingTextAt = null;
  textInput.remove();
  textInput = null;
  redrawCanvas();
}

function startTextEditing(shape) {
  // Don't allow editing in read-only mode
  if (readOnlyMode) {
    showReadOnlyWarning();
    return;
  }

  // Don't allow editing locked shapes
  if (shape.locked) {
    return;
  }

  // Check if another user is already editing this text
  const editingUser = getRemoteEditingUser(shape.id);
  if (editingUser) {
    showAlert('Text Being Edited', `This text is currently being edited by ${editingUser.name}.`);
    return;
  }

  // Finish any text creation first
  if (creatingTextAt) {
    finishTextCreation();
  }

  if (editingTextId) {
    finishTextEditing();
  }

  const container = document.getElementById('canvas-container');
  if (!container) {
    console.error('startTextEditing: canvas-container not found');
    return;
  }

  editingTextId = shape.id;
  broadcastEditingText(shape.id);

  // Convert world coordinates to screen coordinates for input positioning
  const screenPos = worldToScreen(shape.x, shape.y);
  const scaledFontSize = (shape.fontSize || 20) * viewport.zoom;

  // Clamp position to keep input within container bounds
  const containerRect = container.getBoundingClientRect();
  const inputWidth = 200; // Approximate width for clamping
  const inputHeight = scaledFontSize + 20; // Approximate height
  const margin = 10;

  const clampedX = Math.min(screenPos.x, containerRect.width - inputWidth - margin);
  const clampedY = Math.max(inputHeight + margin, Math.min(screenPos.y, containerRect.height - margin));

  textInput = document.createElement('input');
  textInput.type = 'text';
  textInput.value = shape.text;
  textInput.className = 'text-edit-input';
  textInput.style.position = 'absolute';
  textInput.style.left = `${Math.max(margin, clampedX)}px`;
  textInput.style.top = `${clampedY}px`;
  textInput.style.fontSize = `${scaledFontSize}px`;
  textInput.style.fontFamily = shape.fontFamily || 'Arial';
  textInput.style.maxWidth = `${containerRect.width - margin * 2}px`;
  textInput.style.transform = 'translateY(-100%)'; // Position above the text baseline

  // Redraw on input to show live preview
  textInput.addEventListener('input', () => {
    redrawCanvas();
  });

  textInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      finishTextEditing();
    } else if (e.key === 'Escape') {
      clearEditingTextBroadcast();
      editingTextId = null;
      textInput.remove();
      textInput = null;
      redrawCanvas();
    }
  });

  container.appendChild(textInput);

  // Defer focus to ensure it happens after all current event handling completes
  requestAnimationFrame(() => {
    if (textInput) {
      textInput.focus();
      textInput.select();

      // Add blur listener after focus is established
      setTimeout(() => {
        if (textInput) {
          textInput.addEventListener('blur', finishTextEditing);
        }
      }, 100);
    }
  });
}

// Update text input position when viewport changes
function updateTextInputPosition() {
  if (!textInput) return;

  // Handle text creation
  if (creatingTextAt) {
    const screenPos = worldToScreen(creatingTextAt.x, creatingTextAt.y);
    const scaledFontSize = fontSize * viewport.zoom;

    textInput.style.left = `${screenPos.x}px`;
    textInput.style.top = `${screenPos.y}px`;
    textInput.style.fontSize = `${scaledFontSize}px`;
    textInput.style.transform = 'translateY(-100%)';
    return;
  }

  // Handle text editing
  if (!editingTextId) return;

  const shape = findShapeById(editingTextId);
  if (!shape) return;

  const screenPos = worldToScreen(shape.x, shape.y);
  const scaledFontSize = (shape.fontSize || 20) * viewport.zoom;

  textInput.style.left = `${screenPos.x}px`;
  textInput.style.top = `${screenPos.y}px`;
  textInput.style.fontSize = `${scaledFontSize}px`;
  textInput.style.transform = 'translateY(-100%)';
}

function finishTextEditing() {
  if (!editingTextId || !textInput) return;

  const newText = textInput.value;
  if (newText && newText.trim()) {
    updateShapeProperty(editingTextId, 'text', newText);
  }

  clearEditingTextBroadcast();
  editingTextId = null;
  textInput.remove();
  textInput = null;
  redrawCanvas();
}

// ============ Shape Manipulation ============

function moveShape(shapeId, dx, dy) {
  if (!canMutate()) return; // Block in read-only mode

  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return;

  const index = findShapeIndex(shapeId);
  if (index === -1) return;

  const shape = board.get(index);
  const updated = { ...shape };

  // Update position based on shape type
  if (shape.tool === 'line') {
    updated.startX += dx;
    updated.startY += dy;
    updated.x += dx;
    updated.y += dy;
  } else if (shape.tool === 'rect' || shape.tool === 'circle') {
    updated.startX += dx;
    updated.startY += dy;
  } else if (shape.tool === 'text') {
    updated.x += dx;
    updated.y += dy;
  } else if (shape.tool === 'freehand' || shape.tool === 'eraser') {
    if (updated.points) {
      updated.points = updated.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    }
  }

  board.delete(index);
  board.insert(index, [updated]);
}

function deleteShape(shapeId) {
  if (!canMutate()) return; // Block in read-only mode

  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return;

  const index = findShapeIndex(shapeId);
  if (index !== -1) {
    const shape = board.get(index);
    if (shape.locked) {
      showAlert('Shape Locked', 'This shape is locked and cannot be deleted. Unlock it first.');
      return;
    }
    board.delete(index);
    selectedIds.delete(shapeId);
    if (hoveredId === shapeId) {
      hoveredId = null;
    }
    hideShapeControls(true); // Force close popup when shape is deleted
  }
}

function toggleShapeLock(shapeId) {
  if (!canMutate()) return; // Block in read-only mode

  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return;

  const index = findShapeIndex(shapeId);
  if (index === -1) return;

  const shape = board.get(index);
  const newLocked = !shape.locked;
  const updated = { ...shape, locked: newLocked };

  board.delete(index);
  board.insert(index, [updated]);

  // Force re-render of controls
  controlsForShapeId = null;
  redrawCanvas();
}

// ============ Layer Management ============

function bringToFront(shapeId) {
  if (!canMutate()) return;

  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return;

  const index = findShapeIndex(shapeId);
  if (index === -1 || index === board.length - 1) return; // Already at front

  const shape = board.get(index);
  board.delete(index);
  board.push([shape]);

  controlsForShapeId = null;
  redrawCanvas();
}

function sendToBack(shapeId) {
  if (!canMutate()) return;

  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return;

  const index = findShapeIndex(shapeId);
  if (index === -1 || index === 0) return; // Already at back

  const shape = board.get(index);
  board.delete(index);
  board.insert(0, [shape]);

  controlsForShapeId = null;
  redrawCanvas();
}

function moveUp(shapeId) {
  if (!canMutate()) return;

  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return;

  const index = findShapeIndex(shapeId);
  if (index === -1 || index === board.length - 1) return;

  const shape = board.get(index);
  board.delete(index);
  board.insert(index + 1, [shape]);

  controlsForShapeId = null;
  redrawCanvas();
}

function moveDown(shapeId) {
  if (!canMutate()) return;

  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return;

  const index = findShapeIndex(shapeId);
  if (index === -1 || index === 0) return;

  const shape = board.get(index);
  board.delete(index);
  board.insert(index - 1, [shape]);

  controlsForShapeId = null;
  redrawCanvas();
}

function updateShapeProperty(shapeId, property, value) {
  if (!canMutate()) return; // Block in read-only mode

  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return;

  const index = findShapeIndex(shapeId);
  if (index === -1) return;

  const shape = board.get(index);

  // Don't allow changing locked shapes
  if (shape.locked) {
    return;
  }

  const updated = { ...shape, [property]: value };

  board.delete(index);
  board.insert(index, [updated]);
}

// ============ Hit Detection ============

function findShapeAtPoint(x, y) {
  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return null;

  // Search in reverse order (top shapes first)
  const items = board.toArray();
  for (let i = items.length - 1; i >= 0; i--) {
    const shape = items[i];
    if (hitTestShape(x, y, shape)) {
      return shape;
    }
  }
  return null;
}

function findShapeById(id) {
  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return null;

  const items = board.toArray();
  return items.find(item => item.id === id) || null;
}

function findShapeIndex(id) {
  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return -1;

  const items = board.toArray();
  return items.findIndex(item => item.id === id);
}

function hitTestShape(x, y, shape, threshold = 8) {
  const sw = (shape.strokeWidth || 2) / 2 + threshold;

  switch (shape.tool) {
    case 'line':
      return pointToLineDistance(x, y, shape.startX, shape.startY, shape.x, shape.y) < sw;

    case 'rect': {
      const minX = Math.min(shape.startX, shape.startX + shape.width);
      const maxX = Math.max(shape.startX, shape.startX + shape.width);
      const minY = Math.min(shape.startY, shape.startY + shape.height);
      const maxY = Math.max(shape.startY, shape.startY + shape.height);

      // Check if inside fill area or near stroke
      if (shape.fillColor) {
        return x >= minX && x <= maxX && y >= minY && y <= maxY;
      }
      // Check near edges
      return (x >= minX - sw && x <= maxX + sw && y >= minY - sw && y <= maxY + sw) &&
             (x <= minX + sw || x >= maxX - sw || y <= minY + sw || y >= maxY - sw);
    }

    case 'circle': {
      const dist = Math.hypot(x - shape.startX, y - shape.startY);
      if (shape.fillColor) {
        return dist <= shape.radius + sw;
      }
      return Math.abs(dist - shape.radius) < sw;
    }

    case 'text': {
      const textWidth = ctx.measureText(shape.text).width;
      const fs = shape.fontSize || 20;
      return x >= shape.x && x <= shape.x + textWidth &&
             y >= shape.y - fs && y <= shape.y;
    }

    case 'freehand':
    case 'eraser': {
      if (!shape.points || shape.points.length < 2) return false;
      for (let i = 1; i < shape.points.length; i++) {
        const p1 = shape.points[i - 1];
        const p2 = shape.points[i];
        if (pointToLineDistance(x, y, p1.x, p1.y, p2.x, p2.y) < sw) {
          return true;
        }
      }
      return false;
    }

    default:
      return false;
  }
}

function pointToLineDistance(px, py, x1, y1, x2, y2) {
  const A = px - x1;
  const B = py - y1;
  const C = x2 - x1;
  const D = y2 - y1;

  const dot = A * C + B * D;
  const lenSq = C * C + D * D;
  let param = -1;

  if (lenSq !== 0) {
    param = dot / lenSq;
  }

  let xx, yy;

  if (param < 0) {
    xx = x1;
    yy = y1;
  } else if (param > 1) {
    xx = x2;
    yy = y2;
  } else {
    xx = x1 + param * C;
    yy = y1 + param * D;
  }

  return Math.hypot(px - xx, py - yy);
}

/**
 * Calculate the bounding box for a shape
 * @param {Object} shape - Shape object with tool-specific properties
 * @returns {{x: number, y: number, width: number, height: number}} Bounding box
 */
export function getShapeBounds(shape) {
  switch (shape.tool) {
    case 'line':
      return {
        x: Math.min(shape.startX, shape.x),
        y: Math.min(shape.startY, shape.y),
        width: Math.abs(shape.x - shape.startX),
        height: Math.abs(shape.y - shape.startY)
      };

    case 'rect':
      return {
        x: shape.width >= 0 ? shape.startX : shape.startX + shape.width,
        y: shape.height >= 0 ? shape.startY : shape.startY + shape.height,
        width: Math.abs(shape.width),
        height: Math.abs(shape.height)
      };

    case 'circle':
      return {
        x: shape.startX - shape.radius,
        y: shape.startY - shape.radius,
        width: shape.radius * 2,
        height: shape.radius * 2
      };

    case 'text': {
      ctx.font = `${shape.fontSize || 20}px ${shape.fontFamily || 'Arial'}`;
      const textWidth = ctx.measureText(shape.text).width;
      const fs = shape.fontSize || 20;
      return {
        x: shape.x,
        y: shape.y - fs,
        width: textWidth,
        height: fs
      };
    }

    case 'freehand':
    case 'eraser': {
      if (!shape.points || shape.points.length === 0) {
        return { x: 0, y: 0, width: 0, height: 0 };
      }
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      shape.points.forEach(p => {
        minX = Math.min(minX, p.x);
        minY = Math.min(minY, p.y);
        maxX = Math.max(maxX, p.x);
        maxY = Math.max(maxY, p.y);
      });
      return {
        x: minX,
        y: minY,
        width: maxX - minX,
        height: maxY - minY
      };
    }

    default:
      return { x: 0, y: 0, width: 0, height: 0 };
  }
}

// ============ Drawing Functions ============

function addDrawing(data) {
  if (!canMutate()) return; // Block in read-only mode

  const boardName = getCurrentBoard();
  // Lazily create the board on first write. We do NOT pre-create it at room
  // init: independent creation by each client conflicts in the Y.Map and can
  // orphan content. Creating it only when someone actually draws means a joiner
  // receives the existing array via snapshot and never conflicts.
  let board = boards.get(boardName);
  if (!board) {
    boards.set(boardName, new Y.Array());
    board = boards.get(boardName);
  }

  const localState = awareness.getLocalState();
  const user = localState?.user || { name: 'Anonymous', color: '#000000' };

  const drawingObj = {
    id: generateId(),
    ...data,
    color: data.color || user.color,
    user: user.name,
    timestamp: Date.now()
  };

  board.push([drawingObj]);
}

/**
 * Subscribe to a board for Y.js updates
 * Automatically unsubscribes from the previous board
 * @param {string} boardName - Name of the board to subscribe to
 */
export function subscribeToBoard(boardName) {
  // Clear any in-progress drawing state from the previous board
  resetDrawingState();

  // Unsubscribe from previous board
  if (currentBoardObserver) {
    currentBoardObserver();
    currentBoardObserver = null;
  }
  observedBoardArray = null;

  const board = boards.get(boardName);
  if (!board) {
    return;
  }

  // Subscribe to changes
  const observer = () => {
    redrawCanvas();
    // Dispatch event for empty state tracking
    window.dispatchEvent(new CustomEvent('board-change', {
      detail: { itemCount: board.length }
    }));
  };

  board.observe(observer);
  observedBoardArray = board;
  currentBoardObserver = () => board.unobserve(observer);

  // Initial draw
  redrawCanvas();

  // Dispatch initial board state
  window.dispatchEvent(new CustomEvent('board-change', {
    detail: { itemCount: board.length }
  }));
}

function redrawCanvas() {
  if (!ctx || !canvas) return;

  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return;

  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // Apply viewport transform for world-space rendering
  ctx.save();
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.translate(-viewport.x, -viewport.y);

  let hasOverlay = false;

  board.forEach((item) => {
    // Skip if this is the shape being edited
    if (editingTextId === item.id && item.tool === 'text') return;

    drawShape(item);

    // Draw selection/hover overlay (in world space)
    const isSelected = selectedIds.has(item.id);
    const isHovered = item.id === hoveredId && !isSelected;

    if (isSelected || isHovered) {
      drawShapeOverlayWorld(item, isSelected);
      hasOverlay = true;
    }
  });

  // Draw remote users' in-progress drawings (live preview)
  drawRemoteDrawings();

  // Draw local text being created (live preview)
  drawLocalTextPreview();

  ctx.restore();

  // Draw UI controls in screen space (after restoring transform)
  // Only show controls for the first selected shape (or hovered shape)
  const firstSelectedId = selectedIds.size > 0 ? selectedIds.values().next().value : null;
  board.forEach((item) => {
    const isSelected = selectedIds.has(item.id);
    const isHovered = item.id === hoveredId && !isSelected;
    const showControls = (isSelected && item.id === firstSelectedId) || isHovered;
    if (showControls) {
      showShapeControlsScreen(item, isSelected);
    }
  });

  // Hide controls if no shape is selected or hovered
  if (!hasOverlay) {
    hideShapeControls();
  }
}

// Draw remote users' in-progress drawings
function drawRemoteDrawings() {
  const remoteDrawings = getRemoteDrawings();

  remoteDrawings.forEach(drawing => {
    ctx.save();
    ctx.globalAlpha = 0.6; // Semi-transparent to show it's in-progress
    ctx.lineWidth = drawing.strokeWidth || 2;

    if (drawing.tool === 'freehand' || drawing.tool === 'eraser') {
      const color = drawing.tool === 'eraser' ? '#FFFFFF' : drawing.color;
      drawFreehand(drawing.points, color, drawing.strokeWidth || 2);
    } else if (drawing.tool === 'line') {
      drawLine(drawing.startX, drawing.startY, drawing.x, drawing.y, drawing.color);
    } else if (drawing.tool === 'rect') {
      drawRect(drawing.startX, drawing.startY, drawing.width, drawing.height, drawing.color, drawing.fillColor);
    } else if (drawing.tool === 'circle') {
      drawCircle(drawing.startX, drawing.startY, drawing.radius, drawing.color, drawing.fillColor);
    } else if (drawing.tool === 'text' && drawing.text) {
      drawText(drawing.x, drawing.y, drawing.text, drawing.color, drawing.fontSize, drawing.fontFamily);
    }

    ctx.restore();
  });
}

// Draw local text being created or edited (live preview for the creator)
function drawLocalTextPreview() {
  if (!textInput) return;

  const text = textInput.value;
  if (!text) return;

  // Handle new text creation
  if (creatingTextAt) {
    const localState = awareness?.getLocalState();
    const color = localState?.user?.color || '#000000';
    drawText(creatingTextAt.x, creatingTextAt.y, text, color, fontSize, fontFamily);
    return;
  }

  // Handle editing existing text
  if (editingTextId) {
    const shape = findShapeById(editingTextId);
    if (shape) {
      drawText(shape.x, shape.y, text, shape.color, shape.fontSize || 20, shape.fontFamily || 'Arial');
    }
  }
}

function drawShape(item) {
  const tool = item.tool;
  const color = item.color;
  const sw = item.strokeWidth || 2;

  ctx.lineWidth = sw;

  if (tool === 'line') {
    drawLine(item.startX, item.startY, item.x, item.y, color);
  } else if (tool === 'rect') {
    drawRect(item.startX, item.startY, item.width, item.height, color, item.fillColor);
  } else if (tool === 'circle') {
    drawCircle(item.startX, item.startY, item.radius, color, item.fillColor);
  } else if (tool === 'text') {
    drawText(item.x, item.y, item.text, color, item.fontSize, item.fontFamily);
  } else if (tool === 'freehand' || tool === 'eraser') {
    drawFreehand(item.points, color, sw);
  }
}

// Draw shape overlay in world space (selection box)
function drawShapeOverlayWorld(shape, isSelected) {
  const bounds = getShapeBounds(shape);
  const padding = 8 / viewport.zoom; // Adjust padding for zoom

  ctx.save();
  ctx.strokeStyle = isSelected ? '#6366f1' : '#94a3b8';
  ctx.lineWidth = (isSelected ? 2 : 1) / viewport.zoom; // Keep consistent screen width
  ctx.setLineDash([5 / viewport.zoom, 5 / viewport.zoom]);
  ctx.strokeRect(
    bounds.x - padding,
    bounds.y - padding,
    bounds.width + padding * 2,
    bounds.height + padding * 2
  );
  ctx.setLineDash([]);
  ctx.restore();
}

// Show shape controls positioned in screen space
function showShapeControlsScreen(shape, isSelected) {
  const bounds = getShapeBounds(shape);

  // Convert world bounds to screen coordinates
  const screenTopLeft = worldToScreen(bounds.x, bounds.y);
  const screenBottomRight = worldToScreen(bounds.x + bounds.width, bounds.y + bounds.height);

  const screenBounds = {
    x: screenTopLeft.x,
    y: screenTopLeft.y,
    width: screenBottomRight.x - screenTopLeft.x,
    height: screenBottomRight.y - screenTopLeft.y
  };

  showShapeControls(shape, screenBounds, isSelected);
}

function drawShapePreview(shape, dx, dy) {
  ctx.save();
  // Apply viewport transform for world-space rendering
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.translate(-viewport.x, -viewport.y);
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = shape.strokeWidth || 2;

  if (shape.tool === 'line') {
    drawLine(shape.startX + dx, shape.startY + dy, shape.x + dx, shape.y + dy, shape.color);
  } else if (shape.tool === 'rect') {
    drawRect(shape.startX + dx, shape.startY + dy, shape.width, shape.height, shape.color, shape.fillColor);
  } else if (shape.tool === 'circle') {
    drawCircle(shape.startX + dx, shape.startY + dy, shape.radius, shape.color, shape.fillColor);
  } else if (shape.tool === 'text') {
    drawText(shape.x + dx, shape.y + dy, shape.text, shape.color, shape.fontSize, shape.fontFamily);
  } else if (shape.tool === 'freehand' || shape.tool === 'eraser') {
    const movedPoints = shape.points.map(p => ({ x: p.x + dx, y: p.y + dy }));
    drawFreehand(movedPoints, shape.color, shape.strokeWidth || 2);
  }

  ctx.restore();
}

function drawShapeCreationPreview(x, y) {
  const localState = awareness.getLocalState();
  const color = localState?.user?.color || '#000000';

  ctx.save();
  // Apply viewport transform for world-space rendering
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.translate(-viewport.x, -viewport.y);
  ctx.globalAlpha = 0.5;
  ctx.lineWidth = strokeWidth;

  if (currentTool === 'line') {
    drawLine(startX, startY, x, y, color);
  } else if (currentTool === 'rect') {
    drawRect(startX, startY, x - startX, y - startY, color, fillEnabled ? fillColor : null);
  } else if (currentTool === 'circle') {
    const radius = Math.sqrt(Math.pow(x - startX, 2) + Math.pow(y - startY, 2));
    drawCircle(startX, startY, radius, color, fillEnabled ? fillColor : null);
  }

  ctx.restore();
}

function drawFreehandPreview() {
  if (freehandPoints.length < 2) return;

  const localState = awareness.getLocalState();
  const color = currentTool === 'eraser-brush' ? '#FFFFFF' : (localState?.user?.color || '#000000');
  const sw = currentTool === 'eraser-brush' ? strokeWidth * 3 : strokeWidth;

  // Redraw existing shapes
  redrawCanvas();

  // Draw preview with viewport transform
  ctx.save();
  ctx.scale(viewport.zoom, viewport.zoom);
  ctx.translate(-viewport.x, -viewport.y);
  ctx.globalAlpha = 0.7;
  drawFreehand(freehandPoints, color, sw);
  ctx.restore();
}

// Basic drawing functions
function drawLine(x1, y1, x2, y2, color) {
  ctx.strokeStyle = color;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function drawRect(x, y, width, height, color, fillColor) {
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fillRect(x, y, width, height);
  }
  ctx.strokeStyle = color;
  ctx.strokeRect(x, y, width, height);
}

function drawCircle(x, y, radius, color, fillColor) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, 2 * Math.PI);
  if (fillColor) {
    ctx.fillStyle = fillColor;
    ctx.fill();
  }
  ctx.strokeStyle = color;
  ctx.stroke();
}

function drawText(x, y, text, color, size = 20, family = 'Arial') {
  ctx.fillStyle = color;
  ctx.font = `${size}px ${family}`;
  ctx.fillText(text, x, y);
}

function drawFreehand(points, color, sw) {
  if (!points || points.length < 2) return;

  ctx.strokeStyle = color;
  ctx.lineWidth = sw;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);

  for (let i = 1; i < points.length; i++) {
    ctx.lineTo(points[i].x, points[i].y);
  }

  ctx.stroke();
}

/**
 * Get all text items from the current board
 * Used for text extraction feature
 * @returns {Array<{x: number, y: number, text: string, user: string, color: string}>}
 */
export function getTexts() {
  const boardName = getCurrentBoard();
  const board = boards.get(boardName);
  if (!board) return [];

  const texts = [];
  board.forEach(item => {
    if (item.tool === 'text') {
      texts.push({
        x: item.x,
        y: item.y,
        text: item.text,
        user: item.user,
        color: item.color
      });
    }
  });

  return texts;
}

/**
 * Get the canvas element for external use (e.g., save as image)
 * @returns {HTMLCanvasElement}
 */
export function getCanvas() {
  return canvas;
}
