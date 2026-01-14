/**
 * Board History Manager
 * Saves and manages whiteboard history in localStorage
 */

const STORAGE_KEY = 'whiteboard_history';

/**
 * Get all saved boards from localStorage
 * @returns {Array} Array of board objects
 */
export function getSavedBoards() {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    if (!data) return [];
    const boards = JSON.parse(data);
    // Sort by last accessed (most recent first)
    return boards.sort((a, b) => new Date(b.lastAccessed) - new Date(a.lastAccessed));
  } catch (e) {
    console.error('Failed to load board history:', e);
    return [];
  }
}

/**
 * Save or update a board in history
 * @param {Object} boardInfo - Board information
 * @param {string} boardInfo.roomId - Unique room ID
 * @param {string} boardInfo.roomName - Display name for the room
 * @param {string} boardInfo.role - 'owner', 'collaborator', or 'viewer'
 * @param {boolean} boardInfo.isEncrypted - Whether the room is encrypted
 * @param {string} boardInfo.createdAt - ISO date string (only set on creation)
 */
export function saveBoard(boardInfo) {
  try {
    const boards = getSavedBoards();
    const existingIndex = boards.findIndex(b => b.roomId === boardInfo.roomId);

    const now = new Date().toISOString();

    if (existingIndex >= 0) {
      // Update existing board - but preserve 'owner' role (never downgrade)
      const existingRole = boards[existingIndex].role;
      const newRole = existingRole === 'owner' ? 'owner' : boardInfo.role;

      boards[existingIndex] = {
        ...boards[existingIndex],
        ...boardInfo,
        role: newRole, // Preserve owner status
        lastAccessed: now,
        accessCount: (boards[existingIndex].accessCount || 1) + 1
      };
    } else {
      // Add new board
      boards.push({
        ...boardInfo,
        createdAt: boardInfo.createdAt || now,
        lastAccessed: now,
        accessCount: 1
      });
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(boards));
    return true;
  } catch (e) {
    console.error('Failed to save board:', e);
    return false;
  }
}

/**
 * Remove a board from history
 * @param {string} roomId - Room ID to remove
 */
export function removeBoard(roomId) {
  try {
    const boards = getSavedBoards();
    const filtered = boards.filter(b => b.roomId !== roomId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    return true;
  } catch (e) {
    console.error('Failed to remove board:', e);
    return false;
  }
}

/**
 * Clear all board history
 */
export function clearAllBoards() {
  try {
    localStorage.removeItem(STORAGE_KEY);
    return true;
  } catch (e) {
    console.error('Failed to clear board history:', e);
    return false;
  }
}

/**
 * Get a specific board by room ID
 * @param {string} roomId - Room ID to find
 * @returns {Object|null} Board object or null
 */
export function getBoard(roomId) {
  const boards = getSavedBoards();
  return boards.find(b => b.roomId === roomId) || null;
}

/**
 * Check if user has any saved boards
 * @returns {boolean}
 */
export function hasSavedBoards() {
  return getSavedBoards().length > 0;
}

/**
 * Get board count
 * @returns {number}
 */
export function getBoardCount() {
  return getSavedBoards().length;
}

/**
 * Update board's last accessed time
 * @param {string} roomId - Room ID
 */
export function touchBoard(roomId) {
  const board = getBoard(roomId);
  if (board) {
    saveBoard(board);
  }
}

/**
 * Format relative time for display
 * @param {string} isoDate - ISO date string
 * @returns {string} Formatted relative time
 */
export function formatRelativeTime(isoDate) {
  const date = new Date(isoDate);
  const now = new Date();
  const diffMs = now - date;
  const diffSecs = Math.floor(diffMs / 1000);
  const diffMins = Math.floor(diffSecs / 60);
  const diffHours = Math.floor(diffMins / 60);
  const diffDays = Math.floor(diffHours / 24);

  if (diffSecs < 60) return 'Just now';
  if (diffMins < 60) return `${diffMins} minute${diffMins !== 1 ? 's' : ''} ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours !== 1 ? 's' : ''} ago`;
  if (diffDays < 7) return `${diffDays} day${diffDays !== 1 ? 's' : ''} ago`;

  return date.toLocaleDateString();
}

/**
 * Get role display info
 * @param {string} role - Role string
 * @returns {Object} Display info with label and color
 */
export function getRoleInfo(role) {
  switch (role) {
    case 'owner':
      return { label: 'Owner', color: '#10b981', icon: 'crown' };
    case 'collaborator':
      return { label: 'Collaborator', color: '#6366f1', icon: 'edit' };
    case 'viewer':
      return { label: 'Viewer', color: '#71717a', icon: 'eye' };
    default:
      return { label: 'Unknown', color: '#71717a', icon: 'help' };
  }
}
