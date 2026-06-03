import * as Y from 'yjs';
import { updateCurrentBoard } from './awareness.js';
import { isInReadOnlyMode } from './drawing.js';
import { showAlert, showConfirm } from './modal.js';

let boards = null;
let awareness = null;
let currentBoard = 'default';
let boardsContainer = null;
let onBoardSwitch = null;

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

export function setupBoardManager(boardsMap, awarenessInstance, switchCallback) {
  boards = boardsMap;
  awareness = awarenessInstance;
  onBoardSwitch = switchCallback;

  // Observe boards map for new boards
  boards.observe(() => {
    renderBoardsList();
  });

  // Initial render
  renderBoardsList();

  return {
    createBoard,
    switchBoard,
    clearBoard,
    deleteBoard,
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
  if (!boards.has(name)) return;

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
  if (name === 'default') return;
  if (!boards.has(name)) return;

  boards.delete(name);

  // If the deleted board was active, fall back to default
  if (currentBoard === name) {
    currentBoard = 'default';
    updateCurrentBoard(awareness, 'default');
    if (onBoardSwitch) onBoardSwitch('default');
  }
  // boards.observe(renderBoardsList) fires for local deletes — no explicit call needed
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

  const deleteBtn = document.createElement('button');
  deleteBtn.className = 'board-context-menu-item board-context-menu-danger';
  deleteBtn.textContent = 'Delete board';

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

  deleteBtn.addEventListener('click', async () => {
    cleanup(); // close menu + remove listeners before awaiting
    const confirmed = await showConfirm(
      'Delete board?',
      `Delete "${name}" and its drawings? You can undo with Ctrl+Z.`,
      'Delete',
      'Cancel',
      true
    );
    if (confirmed) {
      deleteBoard(name);
    }
  });

  menu.appendChild(deleteBtn);
  document.body.appendChild(menu);
  activeCleanup = cleanup;

  document.addEventListener('mousedown', onOutsideClick, true);
  document.addEventListener('keydown', onEscape, true);
}

function renderBoardsList() {
  if (!boardsContainer || !boards) return;

  boardsContainer.innerHTML = '';

  const boardNames = [];
  boards.forEach((_, name) => {
    boardNames.push(name);
  });

  // Sort boards alphabetically, but keep 'default' first
  boardNames.sort((a, b) => {
    if (a === 'default') return -1;
    if (b === 'default') return 1;
    return a.localeCompare(b);
  });

  boardNames.forEach(name => {
    const button = document.createElement('button');
    button.textContent = name;
    button.className = name === currentBoard ? 'board-btn active' : 'board-btn';
    button.addEventListener('click', () => switchBoard(name));
    if (name !== 'default') {
      button.addEventListener('contextmenu', (e) => {
        e.preventDefault();
        showBoardContextMenu(e.clientX, e.clientY, name);
      });
    }
    boardsContainer.appendChild(button);
  });
}
