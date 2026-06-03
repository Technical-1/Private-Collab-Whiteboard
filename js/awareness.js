import { generateUserId, assignColor, safeColor, escapeHtml } from './utils.js';
import { getViewport } from './drawing.js';
import { CURSOR_UPDATE_INTERVAL } from './config.js';

let usersContainer = null;
let cursorsContainer = null;
let localAwareness = null;
let localUserId = null;
let onAwarenessChange = null; // Callback for when awareness changes

// Throttle cursor updates to reduce network traffic
let lastCursorUpdate = 0;

export function initializeAwareness(awareness, userName, awarenessChangeCallback = null) {
  localAwareness = awareness;
  onAwarenessChange = awarenessChangeCallback;
  const userId = generateUserId();
  localUserId = visibleId(userId);
  const color = assignColor(userId);

  // No `enc` flag here: access-mismatch detection rides the plaintext
  // PRESENCE_PROBE in sync-provider, and awareness is AES-encrypted in capability
  // rooms — so an `enc` field inside it would be unreadable by a keyless visitor
  // anyway. Keeping it would be dead data.
  awareness.setLocalState({
    user: {
      id: localUserId,
      name: userName,
      color: color,
      currentBoard: 'default',
      cursor: null, // Will be updated on mouse move
      currentDrawing: null, // In-progress drawing for live preview
      laser: null, // Ephemeral laser-pointer trail (awareness-only, never persisted)
    }
  });

  // Listen for awareness changes (other users)
  awareness.on('change', ({ added, updated, removed }) => {
    renderUsers(awareness);
    renderCursors(awareness);

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

  const MAX = 5;
  users.slice(0, MAX).forEach(user => {
    const isLocal = user.id === localUserId;
    const color = safeColor(user.color);
    const initial = escapeHtml((user.name || '?').trim().charAt(0).toUpperCase() || '?');
    const el = document.createElement('div');
    el.className = isLocal ? 'avatar avatar-self' : 'avatar';
    el.style.setProperty('--avatar-color', color);
    el.title = isLocal ? 'Click to change your color' : escapeHtml(user.name);
    el.textContent = initial;

    if (isLocal) {
      // Overlay a transparent color input so clicking the avatar opens the native picker.
      // The input is absolutely positioned to fill the bubble (via CSS class .avatar-color-input),
      // opacity 0 so the letter shows through, cursor: pointer.
      const colorInput = document.createElement('input');
      colorInput.type = 'color';
      colorInput.id = 'user-color';
      colorInput.className = 'avatar-color-input';
      colorInput.value = getLocalUserColor();
      colorInput.title = 'Click to change your color';
      colorInput.oninput = (e) => {
        changeUserColor(e.target.value);
      };
      el.appendChild(colorInput);
    }

    usersContainer.appendChild(el);
  });

  if (users.length > MAX) {
    const more = document.createElement('div');
    more.className = 'avatar avatar-more';
    more.textContent = `+${users.length - MAX}`;
    more.title = `${users.length - MAX} more`;
    usersContainer.appendChild(more);
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
      <span class="cursor-label">${escapeHtml(user.name)}</span>
    `;

    cursorsContainer.appendChild(cursorEl);
  });
}

// Update the current laser trail (ephemeral — awareness only, never a CRDT shape)
export function updateLaser(points) {
  if (!localAwareness) return;
  const state = localAwareness.getLocalState();
  if (!state) return;
  localAwareness.setLocalState({ ...state, user: { ...state.user, laser: points } });
}

// Clear the local laser trail (when the pointer is lifted or tool switched)
export function clearLaser() {
  if (!localAwareness) return;
  const state = localAwareness.getLocalState();
  if (!state) return;
  localAwareness.setLocalState({ ...state, user: { ...state.user, laser: null } });
}

// Get all remote users' current laser trails (for rendering on the canvas)
export function getRemoteLasers() {
  if (!localAwareness) return [];
  const out = [];
  localAwareness.getStates().forEach((state, clientId) => {
    if (clientId === localAwareness.clientID) return;
    const user = state?.user;
    if (user?.laser && user.laser.length) {
      // Cap points from an untrusted peer: a 700ms trail at mouse rate is well
      // under 100 points, so 300 is generous and bounds per-frame render work.
      const points = user.laser.length > 300 ? user.laser.slice(-300) : user.laser;
      out.push({ id: user.id, color: user.color, points });
    }
  });
  return out;
}

