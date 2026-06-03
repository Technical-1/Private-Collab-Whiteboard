import { getBoardCount, hasSavedBoards } from './board-history.js';

// Reveal the "My Boards" nav link (with a count badge) only for visitors who
// have actually saved a board, matching the landing page's behavior.
if (hasSavedBoards()) {
  const myBoardsLink = document.getElementById('my-boards-link');
  const boardCountBadge = document.getElementById('board-count-badge');
  if (myBoardsLink) myBoardsLink.style.display = 'flex';
  if (boardCountBadge) boardCountBadge.textContent = getBoardCount();
}
