import * as Y from 'yjs';
import { updateCurrentBoard } from './awareness.js';
import { isInReadOnlyMode } from './drawing.js';
import { showAlert } from './modal.js';

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
    boardsContainer.appendChild(button);
  });
}
