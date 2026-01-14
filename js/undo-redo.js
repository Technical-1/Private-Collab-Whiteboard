/**
 * Undo/Redo Manager for Whiteboard
 *
 * Uses Y.js built-in UndoManager for CRDT-aware undo/redo.
 * Only tracks local changes - doesn't undo other users' changes.
 */

import * as Y from 'yjs';

let undoManager = null;
let onStackChange = null;

/**
 * Initialize the undo manager for a Y.js document
 *
 * @param {Y.Doc} ydoc - Y.js document
 * @param {Y.Map} boards - The boards map to track
 * @param {Function} stackChangeCallback - Called when undo/redo stack changes
 * @returns {Object} - Undo manager interface
 */
export function initUndoManager(ydoc, boards, stackChangeCallback = null) {
  onStackChange = stackChangeCallback;

  // Create the undo manager tracking the boards map
  // It will automatically track nested types (the Y.Array boards)
  // By not specifying trackedOrigins, it tracks all local changes
  undoManager = new Y.UndoManager([boards], {
    // Group rapid changes together (500ms window)
    captureTimeout: 500
  });

  // Listen for stack changes to update UI
  undoManager.on('stack-item-added', () => {
    notifyStackChange();
  });

  undoManager.on('stack-item-popped', () => {
    notifyStackChange();
  });

  undoManager.on('stack-cleared', () => {
    notifyStackChange();
  });

  // Initial notification
  notifyStackChange();

  return {
    undo,
    redo,
    canUndo,
    canRedo,
    clear,
    destroy
  };
}

/**
 * Undo the last local change
 * @returns {boolean} - True if undo was performed
 */
export function undo() {
  if (!undoManager) return false;

  try {
    undoManager.undo();
    return true;
  } catch (e) {
    console.error('Undo failed:', e);
    return false;
  }
}

/**
 * Redo the last undone change
 * @returns {boolean} - True if redo was performed
 */
export function redo() {
  if (!undoManager) return false;

  try {
    undoManager.redo();
    return true;
  } catch (e) {
    console.error('Redo failed:', e);
    return false;
  }
}

/**
 * Check if undo is available
 * @returns {boolean}
 */
export function canUndo() {
  if (!undoManager) return false;
  return undoManager.undoStack.length > 0;
}

/**
 * Check if redo is available
 * @returns {boolean}
 */
export function canRedo() {
  if (!undoManager) return false;
  return undoManager.redoStack.length > 0;
}

/**
 * Clear undo/redo history
 */
export function clear() {
  if (undoManager) {
    undoManager.clear();
  }
}

/**
 * Destroy the undo manager
 */
export function destroy() {
  if (undoManager) {
    undoManager.destroy();
    undoManager = null;
  }
  onStackChange = null;
}

/**
 * Notify callback of stack changes
 */
function notifyStackChange() {
  if (onStackChange) {
    onStackChange({
      canUndo: canUndo(),
      canRedo: canRedo(),
      undoStackSize: undoManager?.undoStack.length || 0,
      redoStackSize: undoManager?.redoStack.length || 0
    });
  }
}

/**
 * Get current stack state
 * @returns {Object}
 */
export function getStackState() {
  return {
    canUndo: canUndo(),
    canRedo: canRedo(),
    undoStackSize: undoManager?.undoStack.length || 0,
    redoStackSize: undoManager?.redoStack.length || 0
  };
}
