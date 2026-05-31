import { generateUserId, assignColor, safeColor, escapeHtml } from './utils.js';
import { getViewport } from './drawing.js';
import { CURSOR_UPDATE_INTERVAL } from './config.js';

let usersContainer = null;
let cursorsContainer = null;
let localAwareness = null;
let localUserId = null;
let onAwarenessChange = null; // Callback for when awareness changes
let localEncrypted = false; // whether this client holds the room capability
let accessMismatchSignaled = false; // fire the "needs invite link" hint once

// Throttle cursor updates to reduce network traffic
let lastCursorUpdate = 0;

export function initializeAwareness(awareness, userName, awarenessChangeCallback = null, encrypted = false) {
  localAwareness = awareness;
  onAwarenessChange = awarenessChangeCallback;
  localEncrypted = encrypted;
  const userId = generateUserId();
  localUserId = visibleId(userId);
  const color = assignColor(userId);

  // Set local user state. `enc` advertises whether THIS client holds the room
  // capability (encrypted). Awareness is unencrypted, so a keyless visitor to an
  // encrypted room can detect the mismatch and prompt for the invite link.
  awareness.setLocalState({
    user: {
      id: localUserId,
      name: userName,
      color: color,
      currentBoard: 'default',
      cursor: null, // Will be updated on mouse move
      currentDrawing: null, // In-progress drawing for live preview
      enc: encrypted
    }
  });

  // Listen for awareness changes (other users)
  awareness.on('change', ({ added, updated, removed }) => {
    renderUsers(awareness);
    renderCursors(awareness);
    detectAccessMismatch(awareness);

    // Only trigger redraw for remote changes (not our own updates)
    // This prevents the local drawing preview from being cleared
    const localClientId = awareness.clientID;
    const hasRemoteChanges =
      added.some(id => id !== localClientId) ||
      updated.some(id => id !== localClientId) ||
      removed.some(id => id !== localClientId);

    if (hasRemoteChanges && onAwarenessChange) {
      onAwarenessChange();
    }
  });

  // Initial render
  renderUsers(awareness);

  return { userId, color };
}

// Get shortened visible ID (first 8 chars)
function visibleId(fullId) {
  return fullId.substring(0, 8);
}

// If this client is NOT in the encrypted room (no capability) but a remote peer
// advertises enc=true, it opened the bare URL of a password-protected room and
// needs the invite link to read/edit. Signal the app once.
function detectAccessMismatch(awareness) {
  if (localEncrypted || accessMismatchSignaled) return;
  const localClientId = awareness.clientID;
  for (const [clientId, state] of awareness.getStates()) {
    if (clientId === localClientId) continue;
    if (state?.user?.enc === true) {
      accessMismatchSignaled = true;
      window.dispatchEvent(new CustomEvent('room-access-mismatch'));
      return;
    }
  }
}

export function setUsersContainer(container) {
  usersContainer = container;
}

export function setCursorsContainer(container) {
  cursorsContainer = container;
}

export function updateCurrentBoard(awareness, boardName) {
  const state = awareness.getLocalState();
  if (state) {
    awareness.setLocalState({
      ...state,
      user: { ...state.user, currentBoard: boardName }
    });
  }
}

// Update cursor position in awareness (throttled)
export function updateCursorPosition(x, y) {
  if (!localAwareness) return;

  const now = Date.now();
  if (now - lastCursorUpdate < CURSOR_UPDATE_INTERVAL) {
    return; // Throttle - don't update too frequently
  }
  lastCursorUpdate = now;

  const state = localAwareness.getLocalState();
  if (state) {
    localAwareness.setLocalState({
      ...state,
      user: { ...state.user, cursor: { x, y } }
    });
  }
}

// Refresh cursor positions (call when viewport changes)
export function refreshCursors() {
  if (localAwareness) {
    renderCursors(localAwareness);
  }
}

// Clear cursor when mouse leaves canvas
export function clearCursorPosition() {
  if (!localAwareness) return;

  const state = localAwareness.getLocalState();
  if (state) {
    localAwareness.setLocalState({
      ...state,
      user: { ...state.user, cursor: null }
    });
  }
}

// Update the current drawing being made (for live preview)
export function updateCurrentDrawing(drawingData) {
  if (!localAwareness) return;

  const state = localAwareness.getLocalState();
  if (state) {
    localAwareness.setLocalState({
      ...state,
      user: { ...state.user, currentDrawing: drawingData }
    });
  }
}

// Clear the current drawing (when finished or cancelled)
export function clearCurrentDrawing() {
  if (!localAwareness) return;

  const state = localAwareness.getLocalState();
  if (state) {
    localAwareness.setLocalState({
      ...state,
      user: { ...state.user, currentDrawing: null }
    });
  }
}

// Get all remote users' current drawings (for rendering previews)
export function getRemoteDrawings() {
  if (!localAwareness) return [];

  const drawings = [];
  const localClientId = localAwareness.clientID;
  const states = localAwareness.getStates();

  states.forEach((state, clientId) => {
    if (clientId === localClientId) return; // Skip local user
    const user = state?.user;
    if (user?.currentDrawing) {
      drawings.push({
        ...user.currentDrawing,
        color: user.color,
        userName: user.name
      });
    }
  });

  return drawings;
}

// Change user color
export function changeUserColor(newColor) {
  if (!localAwareness) return;

  const state = localAwareness.getLocalState();
  if (state) {
    localAwareness.setLocalState({
      ...state,
      user: { ...state.user, color: newColor }
    });
  }
}

// Get local user's color
export function getLocalUserColor() {
  if (!localAwareness) return '#000000';
  const state = localAwareness.getLocalState();
  return state?.user?.color || '#000000';
}

export function getUsers(awareness) {
  const states = awareness.getStates();
  const users = [];

  states.forEach((state, clientId) => {
    if (state && state.user) {
      users.push({
        clientId,
        ...state.user
      });
    }
  });

  return users;
}

function renderUsers(awareness) {
  if (!usersContainer) return;

  const users = getUsers(awareness);

  usersContainer.innerHTML = '';

  users.forEach(user => {
    const userEl = document.createElement('div');
    userEl.className = 'user-item';

    const isLocal = user.id === localUserId;
    // Untrusted: sanitize the peer-supplied color before it hits innerHTML.
    const color = safeColor(user.color);

    userEl.innerHTML = `
      <span class="user-color" style="background-color: ${color}"></span>
      <span class="user-name">${escapeHtml(user.name)}${isLocal ? ' (you)' : ''}</span>
    `;
    usersContainer.appendChild(userEl);
  });

  // Update user count - supports both old sidebar format and new badge format
  const countEl = document.getElementById('user-count');
  if (countEl) {
    // Check if it's the new badge style (has user-count-badge class) or old style
    if (countEl.classList.contains('user-count-badge')) {
      countEl.textContent = users.length;
    } else {
      countEl.textContent = `${users.length} user${users.length !== 1 ? 's' : ''} online`;
    }
  }
}

// Transform world coordinates to screen coordinates using current viewport
function worldToScreen(worldX, worldY) {
  const viewport = getViewport();
  return {
    x: (worldX - viewport.x) * viewport.zoom,
    y: (worldY - viewport.y) * viewport.zoom
  };
}

function renderCursors(awareness) {
  if (!cursorsContainer) return;

  // Clear existing cursors
  cursorsContainer.innerHTML = '';

  const states = awareness.getStates();
  const localClientId = awareness.clientID;

  states.forEach((state, clientId) => {
    // Skip local user's cursor
    if (clientId === localClientId) return;

    const user = state?.user;
    if (!user || !user.cursor) return;

    // Transform cursor from world coords to screen coords
    const screenPos = worldToScreen(user.cursor.x, user.cursor.y);
    // Untrusted: sanitize the peer-supplied color before it hits innerHTML.
    const color = safeColor(user.color);

    // Create cursor element
    const cursorEl = document.createElement('div');
    cursorEl.className = 'remote-cursor';
    cursorEl.style.left = `${screenPos.x}px`;
    cursorEl.style.top = `${screenPos.y}px`;
    cursorEl.style.setProperty('--cursor-color', color);

    cursorEl.innerHTML = `
      <svg width="24" height="24" viewBox="0 0 24 24" fill="${color}">
        <path d="M5.5 3.21V20.8c0 .45.54.67.85.35l4.86-4.86a.5.5 0 0 1 .35-.15h6.87c.48 0 .72-.58.38-.92L5.94 2.35a.5.5 0 0 0-.44.86z"/>
      </svg>
      <span class="cursor-label" style="background-color: ${color}">${escapeHtml(user.name)}</span>
    `;

    cursorsContainer.appendChild(cursorEl);
  });
}

