    import {
      getSavedBoards,
      removeBoard,
      clearAllBoards,
      formatRelativeTime,
      getRoleInfo,
      getBoardCount
    } from '/js/board-history.js';
    import { escapeHtml } from '/js/utils.js';

    function renderBoards() {
      const container = document.getElementById('boards-content');
      const boards = getSavedBoards();

      if (boards.length === 0) {
        container.innerHTML = `
          <div class="empty-state">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <rect x="3" y="3" width="18" height="18" rx="2"/>
              <path d="M3 9h18"/>
              <path d="M9 21V9"/>
            </svg>
            <h2>No boards yet</h2>
            <p>Boards you create or join will appear here. Create your first board to get started!</p>
            <a href="/" class="btn btn-primary">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <line x1="12" y1="5" x2="12" y2="19"/>
                <line x1="5" y1="12" x2="19" y2="12"/>
              </svg>
              Create Board
            </a>
          </div>
        `;
        return;
      }

      // Count by role
      const ownerCount = boards.filter(b => b.role === 'owner').length;
      const collabCount = boards.filter(b => b.role === 'collaborator').length;
      const viewerCount = boards.filter(b => b.role === 'viewer').length;

      let html = `
        <div class="boards-stats">
          <div class="stat-card">
            <div class="stat-value">${boards.length}</div>
            <div class="stat-label">Total Boards</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${ownerCount}</div>
            <div class="stat-label">Created by You</div>
          </div>
          <div class="stat-card">
            <div class="stat-value">${collabCount + viewerCount}</div>
            <div class="stat-label">Shared with You</div>
          </div>
        </div>

        <div class="boards-list">
      `;

      boards.forEach(board => {
        const roleInfo = getRoleInfo(board.role);
        const roleClass = `role-${board.role}`;

        html += `
          <div class="board-card" data-room-id="${escapeHtml(board.roomId)}">
            <div class="board-icon">
              <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="3" y="3" width="18" height="18" rx="2"/>
                <path d="M3 9h18"/>
                <path d="M9 21V9"/>
              </svg>
            </div>
            <div class="board-info">
              <div class="board-name">
                ${escapeHtml(board.roomName || board.roomId)}
                ${board.isEncrypted ? '<span class="encrypted-badge">Encrypted</span>' : ''}
              </div>
              <div class="board-meta">
                <span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="10"/>
                    <polyline points="12 6 12 12 16 14"/>
                  </svg>
                  ${formatRelativeTime(board.lastAccessed)}
                </span>
                <span>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                    <circle cx="12" cy="12" r="3"/>
                  </svg>
                  ${board.accessCount || 1} visit${(board.accessCount || 1) !== 1 ? 's' : ''}
                </span>
              </div>
            </div>
            <span class="role-badge ${roleClass}">${roleInfo.label}</span>
            <div class="board-actions">
              <button class="btn btn-danger btn-remove" data-room-id="${escapeHtml(board.roomId)}" title="Remove from history">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <polyline points="3 6 5 6 21 6"/>
                  <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
                </svg>
              </button>
              <a href="/room/${escapeHtml(board.roomId)}${board.isEncrypted ? '' : ''}" class="btn btn-primary">
                Open
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M5 12h14M12 5l7 7-7 7"/>
                </svg>
              </a>
            </div>
          </div>
        `;
      });

      html += `
        </div>

        <div class="clear-all-section">
          <p>Remove all boards from your history. This won't delete the actual boards.</p>
          <button class="btn btn-danger" id="clear-all">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/>
            </svg>
            Clear All History
          </button>
        </div>
      `;

      container.innerHTML = html;

      // Add event listeners
      document.querySelectorAll('.btn-remove').forEach(btn => {
        btn.addEventListener('click', (e) => {
          e.preventDefault();
          const roomId = btn.dataset.roomId;
          if (confirm('Remove this board from your history?')) {
            removeBoard(roomId);
            renderBoards();
          }
        });
      });

      document.getElementById('clear-all')?.addEventListener('click', () => {
        if (confirm('Are you sure you want to clear all board history? This cannot be undone.')) {
          clearAllBoards();
          renderBoards();
        }
      });
    }

    // Initial render
    renderBoards();
