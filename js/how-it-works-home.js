import { getBoardCount } from './board-history.js';

// The "My Boards" link is always shown in the nav; only badge the count once
// the visitor actually has saved boards.
const boardCountBadge = document.getElementById('board-count-badge');
if (boardCountBadge) {
  const boardCount = getBoardCount();
  if (boardCount > 0) {
    boardCountBadge.textContent = String(boardCount);
  } else {
    boardCountBadge.style.display = 'none';
  }
}
