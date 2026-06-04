import * as Y from 'yjs';
import { updateCurrentBoard } from './awareness.js';
import { isInReadOnlyMode } from './drawing.js';
import { showAlert, showConfirm, showPrompt } from './modal.js';

// The default board's Y.Map key is a fixed sentinel — lots of code special-cases
// this literal (lazy creation, delete-fallback), so it must never change. Its
// human-facing label lives in the boardNames overlay and is freely renamable.
const DEFAULT_BOARD_KEY = 'default';
const DEFAULT_BOARD_LABEL = 'Main';

let boards = null;
// Synced overlay map of board key -> display label. Decouples the editable label
// from the stable Y.Map key so even the 'default' board can be renamed safely.
let boardNames = null;
let awareness = null;
let currentBoard = DEFAULT_BOARD_KEY;
let boardsContainer = null;
let onBoardSwitch = null;

/**
 * Resolve a board key to its human-facing label. Falls back to the key itself
 * (or the friendly default label) when no custom name has been set.
 */
function displayName(key) {
  const custom = boardNames && boardNames.get(key);
  if (custom && custom.trim()) return custom.trim();
  return key === DEFAULT_BOARD_KEY ? DEFAULT_BOARD_LABEL : key;
}

/**
 * Check if mutation is allowed (not in read-only mode)
 */
function canMutate() {
  if (isInReadOnlyMode()) {
    showAlert('View Only Mode', 'You have view-only access. You cannot create or clear boards.');
    return false;
  }
  return true;
}

export function setupBoardManager(boardsMap, boardNamesMap, awarenessInstance, switchCallback) {
  boards = boardsMap;
  boardNames = boardNamesMap;
  awareness = awarenessInstance;
  onBoardSwitch = switchCallback;

  // Observe boards map for new boards
  boards.observe(() => {
    renderBoardsList();
  });

  // Re-render when a board is renamed (locally or by a remote peer)
  if (boardNames) {
    boardNames.observe(() => {
      renderBoardsList();
    });
  }

  // Initial render
  renderBoardsList();

  return {
    createBoard,
    switchBoard,
    clearBoard,
    deleteBoard,
    renameBoard,
    getCurrentBoard: () => currentBoard,
    setBoardsContainer
  };
}

export function setBoardsContainer(container) {
  boardsContainer = container;
  renderBoardsList();
}

function createBoard(name) {
  if (!canMutate()) return; // Block in read-only mode
  if (!name || !name.trim()) return;

  const boardName = name.trim();

  if (!boards.has(boardName)) {
    boards.set(boardName, new Y.Array());
  }

  switchBoard(boardName);
}

function switchBoard(name) {
  // The default board may not exist in the map yet (it's created lazily on the
  // first draw), but switching to it must still work — e.g. coming back from
  // another board. Any other board must already exist.
  if (name !== DEFAULT_BOARD_KEY && !boards.has(name)) return;

  currentBoard = name;

  // Update awareness so others see which board we're on
  updateCurrentBoard(awareness, name);

  // Notify callback to redraw canvas
  if (onBoardSwitch) {
    onBoardSwitch(name);
  }

  // Update UI
  renderBoardsList();
}

function clearBoard() {
  if (!canMutate()) return; // Block in read-only mode

  const board = boards.get(currentBoard);
  if (board && board.length > 0) {
    board.delete(0, board.length);
  }
}

function deleteBoard(name) {
  if (!canMutate()) return;
  if (name === DEFAULT_BOARD_KEY) return;
  if (!boards.has(name)) return;

  boards.delete(name);
  // Drop the display-name overlay entry so a future board reusing this key
  // doesn't inherit a stale label.
  if (boardNames && boardNames.has(name)) boardNames.delete(name);

  // If the deleted board was active, fall back to default
  if (currentBoard === name) {
    currentBoard = DEFAULT_BOARD_KEY;
    updateCurrentBoard(awareness, DEFAULT_BOARD_KEY);
    if (onBoardSwitch) onBoardSwitch(DEFAULT_BOARD_KEY);
  }
  // boards.observe(renderBoardsList) fires for local deletes — no explicit call needed
}

/**
 * Rename a board by updating its display-label overlay. The board's underlying
 * Y.Map key never changes, so this is safe even for the 'default' board.
 */
async function renameBoard(key) {
  if (!canMutate()) return;
  if (!boardNames) return;

  const current = displayName(key);
  const next = await showPrompt('Rename Board', 'Enter a new name for this board', current, 'Board name');
  if (next === null) return; // cancelled
  const trimmed = next.trim();
  if (!trimmed || trimmed === current) return;

  boardNames.set(key, trimmed);
  // boardNames.observe(renderBoardsList) fires for local sets — no explicit call needed
}

// Cleanup fn for whichever context menu is currently open (null when none)
let activeCleanup = null;

function showBoardContextMenu(x, y, name) {
  // Tear down any previously-open menu and its document listeners
  if (activeCleanup) activeCleanup();

  const menu = document.createElement('div');
  menu.className = 'board-context-menu';
  menu.style.left = x + 'px';
  menu.style.top = y + 'px';

  // Single teardown for ALL dismissal paths
  function cleanup() {
    document.removeEventListener('mousedown', onOutsideClick, true);
    document.removeEventListener('keydown', onEscape, true);
    menu.remove();
    if (activeCleanup === cleanup) activeCleanup = null;
  }

  const onOutsideClick = (e) => {
    if (!menu.contains(e.target)) cleanup();
  };

  const onEscape = (e) => {
    if (e.key === 'Escape') cleanup();
  };

  // Rename — available on every board, including the default one.
  const renameBtn = document.createElement('button');
  renameBtn.className = 'board-context-menu-item';
  renameBtn.textContent = 'Rename board';
  renameBtn.addEventListener('click', () => {
    cleanup(); // close menu + remove listeners before awaiting
    renameBoard(name);
  });
  menu.appendChild(renameBtn);

  // Delete — every board except the default (the default is the permanent
  // fallback and cannot be removed).
  if (name !== DEFAULT_BOARD_KEY) {
    const deleteBtn = document.createElement('button');
    deleteBtn.className = 'board-context-menu-item board-context-menu-danger';
    deleteBtn.textContent = 'Delete board';
    deleteBtn.addEventListener('click', async () => {
      cleanup(); // close menu + remove listeners before awaiting
      const confirmed = await showConfirm(
        'Delete board?',
        `Delete "${displayName(name)}" and its drawings? You can undo with Ctrl+Z.`,
        'Delete',
        'Cancel',
        true
      );
      if (confirmed) {
        deleteBoard(name);
      }
    });
    menu.appendChild(deleteBtn);
  }

  document.body.appendChild(menu);
  activeCleanup = cleanup;

  document.addEventListener('mousedown', onOutsideClick, true);
  document.addEventListener('keydown', onEscape, true);
}

function renderBoardsList() {
  if (!boardsContainer || !boards) return;

  boardsContainer.innerHTML = '';

  // Always surface the default board, even before it's materialized in the map
  // (it's created lazily on the first draw). Without this, a fresh room shows
  // no tabs at all and creating a board looks like renaming the current one.
  const keys = new Set([DEFAULT_BOARD_KEY]);
  boards.forEach((_, name) => keys.add(name));

  // Sort alphabetically by display label, but keep the default board first.
  const ordered = [...keys].sort((a, b) => {
    if (a === DEFAULT_BOARD_KEY) return -1;
    if (b === DEFAULT_BOARD_KEY) return 1;
    return displayName(a).localeCompare(displayName(b));
  });

  ordered.forEach(key => {
    const button = document.createElement('button');
    button.textContent = displayName(key);
    button.className = key === currentBoard ? 'board-btn active' : 'board-btn';
    button.addEventListener('click', () => switchBoard(key));
    // Right-click works on every tab — including the active/default one — so it
    // can be renamed (and non-default boards deleted).
    button.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      showBoardContextMenu(e.clientX, e.clientY, key);
    });
    boardsContainer.appendChild(button);
  });
}
