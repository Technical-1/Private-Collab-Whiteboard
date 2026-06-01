import { initializeYjs, rotateRoom } from './yjs-setup.js';
import {
  initializeAwareness,
  setUsersContainer,
  setCursorsContainer,
  changeUserColor,
  getLocalUserColor
} from './awareness.js';
import { setupDrawing, subscribeToBoard, getTexts, getCanvas, screenToWorld, getViewport, panBy, setZoom, setReadOnlyMode, cleanup as cleanupDrawing, deleteSelectedShapes, copySelectedShapes, pasteShapes, duplicateSelectedShapes } from './drawing.js';
import { setupBoardManager, setBoardsContainer } from './boards.js';
import {
  getRoomIdFromUrl,
  getCapabilityFromUrl,
  parseCapabilityHash,
  getShareableLink,
  copyToClipboard,
  isEncryptedRoom,
  mintRoomCapability,
  encodeCapabilityHash
} from './room-manager.js';
import {
  initModals,
  showPrompt,
  showConfirm,
  showAlert,
  showInviteModal,
  showPasswordModal,
  showKeyboardShortcuts,
  showExtractTextModal
} from './modal.js';
import {
  initUndoManager,
  undo,
  redo,
  destroy as destroyUndoManager
} from './undo-redo.js';
import {
  ZOOM_MIN,
  ZOOM_MAX,
  ZOOM_STEP,
  ZOOM_WHEEL_STEP,
  FIT_PADDING
} from './config.js';
import { saveBoard, getBoard, historyRoleFromCapability } from './board-history.js';

let yjsInstance = null;
let boardManager = null;
let drawingController = null;
let undoManagerInstance = null;
let canvas = null;
let readOnly = false;

// Per-tool settings storage
const toolSettings = {
  line: { strokeWidth: 2 },
  rect: { strokeWidth: 2, fillEnabled: false, fillColor: '#ffffff' },
  circle: { strokeWidth: 2, fillEnabled: false, fillColor: '#ffffff' },
  freehand: { strokeWidth: 2 },
  text: { fontSize: 20, fontFamily: 'Arial' },
  'eraser-brush': { strokeWidth: 4 }
};

let currentToolName = 'select';

async function main() {
  // Get room ID from URL
  const roomId = getRoomIdFromUrl();
  if (!roomId) {
    window.location.href = '/';
    return;
  }

  // Reject a present-but-unparseable fragment before going further. A missing
  // fragment (open room) is fine; only a *tampered/truncated* one triggers this.
  // getCapabilityFromUrl() below is kept as a non-throwing fallback for helpers.
  try {
    parseCapabilityHash(window.location.hash);
  } catch {
    await showAlert(
      'Invalid Link',
      'This board link is invalid or has been tampered with. Ask the owner for a fresh link.'
    );
    window.location.href = '/';
    return;
  }

  // Get capability from URL hash (null for unencrypted rooms)
  const cap = getCapabilityFromUrl();

  // Initialize modal system
  initModals();

  // Get user name from localStorage or prompt
  const storageKey = `whiteboard-username-${roomId}`;
  let userName = localStorage.getItem(storageKey);
  if (!userName) {
    userName = await showPrompt('Welcome!', 'Enter your name to get started', '', 'Your name');
    if (!userName) userName = 'Anonymous';
    localStorage.setItem(storageKey, userName);
  }

  // Show loading state
  updateStatus(cap ? 'Encrypting...' : 'Connecting...');

  // Initialize Y.js (with or without encryption)
  // This also waits for IndexedDB to sync (load local data)
  yjsInstance = await initializeYjs(roomId, cap);
  const { boards, awareness, isEncrypted, role } = yjsInstance;

  // Derive permission flags from role
  readOnly = role === 'view';
  const isOwner = role === 'owner';
  document.body.dataset.role = role;

  // Update UI to show encryption status
  updateEncryptionIndicator(isEncrypted, isOwner);

  // Check read-only mode (derived from role in capability)
  if (readOnly) {
    document.body.classList.add('read-only-mode');
  }
  // Set read-only mode in drawing module (enforces in JavaScript, not just CSS)
  setReadOnlyMode(readOnly);

  // Save/update board in history. Derive the role from the capability so owners
  // are recorded as 'owner' (saveBoard still preserves a prior 'owner' on revisit).
  const existingBoard = getBoard(roomId);
  const historyRole = historyRoleFromCapability(role);
  saveBoard({
    roomId: roomId,
    roomName: existingBoard?.roomName || roomId,
    role: historyRole,
    isEncrypted: isEncrypted
  });

  // Initialize user awareness with callback for live drawing updates.
  // Pass isEncrypted so peers can detect a keyless visitor to an encrypted room.
  const { color } = initializeAwareness(awareness, userName, () => {
    // Redraw canvas when other users' awareness changes (for live drawing preview)
    if (drawingController) {
      drawingController.redraw();
    }
  }, isEncrypted);

  // Set containers for rendering
  setUsersContainer(document.getElementById('users'));
  setCursorsContainer(document.getElementById('cursors'));
  setBoardsContainer(document.getElementById('boards'));

  // Setup color picker
  const colorPicker = document.getElementById('user-color');
  if (colorPicker) {
    colorPicker.value = color;
    colorPicker.addEventListener('input', (e) => {
      changeUserColor(e.target.value);
    });
  }

  // Setup board manager
  boardManager = setupBoardManager(boards, awareness, (boardName) => {
    subscribeToBoard(boardName);
  });

  // Setup drawing
  canvas = document.getElementById('board');
  drawingController = setupDrawing(
    canvas,
    boards,
    awareness,
    boardManager.getCurrentBoard
  );

  // Setup undo/redo manager (unless in read-only mode)
  if (!readOnly) {
    const undoBtn = document.getElementById('undo-btn');
    const redoBtn = document.getElementById('redo-btn');

    undoManagerInstance = initUndoManager(
      yjsInstance.ydoc,
      boards,
      ({ canUndo, canRedo }) => {
        // Update button states
        if (undoBtn) undoBtn.disabled = !canUndo;
        if (redoBtn) redoBtn.disabled = !canRedo;
      }
    );

    // Wire up undo/redo buttons
    if (undoBtn) {
      undoBtn.addEventListener('click', () => {
        undo();
        drawingController.redraw();
      });
    }
    if (redoBtn) {
      redoBtn.addEventListener('click', () => {
        redo();
        drawingController.redraw();
      });
    }
  }

  // Wire up tool buttons
  const toolButtons = {
    'select-tool': 'select',
    'draw-line': 'line',
    'draw-rect': 'rect',
    'draw-circle': 'circle',
    'draw-freehand': 'freehand',
    'draw-text': 'text',
    'eraser-shape': 'eraser-shape',
    'eraser-brush': 'eraser-brush'
  };

  Object.entries(toolButtons).forEach(([btnId, toolName]) => {
    document.getElementById(btnId).onclick = () => {
      switchTool(toolName);
    };
  });

  // Wire up stroke width presets
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.onclick = () => {
      const width = parseInt(btn.dataset.width);
      setStrokeWidth(width);
    };
  });

  // Wire up drawing options
  const strokeWidthInput = document.getElementById('stroke-width');
  const strokeValueSpan = document.getElementById('stroke-value');
  if (strokeWidthInput) {
    strokeWidthInput.oninput = (e) => {
      const width = parseInt(e.target.value);
      setStrokeWidth(width);
    };
  }

  const fillEnabledInput = document.getElementById('fill-enabled');
  const fillColorInput = document.getElementById('fill-color');
  if (fillEnabledInput && fillColorInput) {
    fillEnabledInput.onchange = (e) => {
      const enabled = e.target.checked;
      fillColorInput.disabled = !enabled;
      drawingController.setFillEnabled(enabled);
      saveCurrentToolSettings();
    };
    fillColorInput.oninput = (e) => {
      drawingController.setFillColor(e.target.value);
      saveCurrentToolSettings();
    };
  }

  const fontSizeInput = document.getElementById('font-size');
  const fontSizeValueSpan = document.getElementById('font-size-value');
  if (fontSizeInput) {
    fontSizeInput.oninput = (e) => {
      const size = parseInt(e.target.value);
      fontSizeValueSpan.textContent = `${size}px`;
      drawingController.setFontSize(size);
      saveCurrentToolSettings();
    };
  }

  const fontFamilySelect = document.getElementById('font-family');
  if (fontFamilySelect) {
    fontFamilySelect.onchange = (e) => {
      drawingController.setFontFamily(e.target.value);
      saveCurrentToolSettings();
    };
  }

  // Initialize UI for default tool (select)
  switchTool('select');

  // Wire up board controls
  document.getElementById('new-board').onclick = async () => {
    const name = await showPrompt('New Board', 'Enter a name for the new board', '', 'Board name');
    if (name) boardManager.createBoard(name);
  };

  document.getElementById('clear-board').onclick = async () => {
    const confirmed = await showConfirm(
      'Clear Board?',
      'This will remove all drawings from the current board. This action cannot be undone.',
      'Clear Board',
      'Cancel',
      true
    );
    if (confirmed) {
      boardManager.clearBoard();
    }
  };

  // Wire up text extraction
  document.getElementById('extract-text').onclick = async () => {
    const texts = getTexts();

    if (texts.length === 0) {
      await showAlert('No Text Found', 'There is no text on this board to extract.');
      return;
    }

    await showExtractTextModal(texts);
  };

  // Wire up save as image
  document.getElementById('save-image').onclick = () => {
    const canvas = getCanvas();
    const tempCanvas = document.createElement('canvas');
    tempCanvas.width = canvas.width;
    tempCanvas.height = canvas.height;
    const tempCtx = tempCanvas.getContext('2d');

    tempCtx.fillStyle = '#FFFFFF';
    tempCtx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);
    tempCtx.drawImage(canvas, 0, 0);

    const link = document.createElement('a');
    link.download = 'whiteboard.png';
    link.href = tempCanvas.toDataURL();
    link.click();
  };

  // Wire up share link
  const shareLink = getShareableLink(false);
  document.getElementById('share-link').value = shareLink;

  // Show/hide password controls based on encryption status
  const passwordControls = document.getElementById('password-controls');
  if (passwordControls) {
    passwordControls.style.display = isEncrypted ? 'block' : 'none';
  }

  // Simple copy link button. For encrypted rooms the capability (password +
  // keys) is always embedded — a link without it would drop the recipient into a
  // different, open room. This is the quick "edit" link; use Invite for view-only.
  document.getElementById('copy-link').onclick = async () => {
    const link = getShareableLink(true);
    copyToClipboard(link);

    await showAlert('Link Copied', isEncrypted
      ? 'The link has been copied. It includes the room password — anyone with it can access the room.'
      : 'The share link has been copied to your clipboard.');
  };

  // Add invite button functionality (if exists)
  const inviteBtn = document.getElementById('invite-btn');
  if (inviteBtn) {
    inviteBtn.onclick = async () => {
      const includePassword = document.getElementById('include-password')?.checked || false;
      const link = getShareableLink(includePassword);

      // Listen for link update requests from the modal
      const handleLinkUpdate = (e) => {
        const { permission, includePassword: includePass } = e.detail;
        const newLink = getShareableLink(includePass, permission);
        window.dispatchEvent(new CustomEvent('invite-link-updated', { detail: { link: newLink } }));
      };
      window.addEventListener('update-invite-link', handleLinkUpdate);

      const result = await showInviteModal(link, isEncrypted, includePassword);

      window.removeEventListener('update-invite-link', handleLinkUpdate);
    };
  }

  // Wire up password change (owner-only). Rotation mints a new key/epoch and
  // locks out old links; only the room owner may trigger it.
  const changePasswordBtn = document.getElementById('change-password');
  if (changePasswordBtn) {
    changePasswordBtn.onclick = async () => {
      if (!isOwner) return; // only the room owner can rotate
      const newPassword = await showPasswordModal('Change Password',
        'Enter a new password. This rotates the room — everyone will need a new invite link.', true);
      if (newPassword !== null && newPassword !== '') {
        await rotateRoom(roomId, newPassword, yjsInstance.signedSync);
      }
    };
  }

  // Wire up add encryption (for unencrypted rooms). Editors only.
  const addEncryptionBtn = document.getElementById('add-encryption');
  if (addEncryptionBtn) {
    addEncryptionBtn.onclick = async () => {
      if (readOnly) return;
      const newPassword = await showPasswordModal('Enable Encryption',
        'Add a password to encrypt this room. You become the owner; share the new invite link.');
      if (newPassword) {
        const cap = await mintRoomCapability(newPassword);
        window.location.href = `${window.location.origin}/room/${roomId}#${encodeCapabilityHash(cap, 'owner')}`;
        window.location.reload();
      }
    };
  }

  // Notify superseded peers when the room is rotated by the owner
  window.addEventListener('room-rotated', async () => {
    updateStatus('Room rotated');
    await showAlert('Room Rotated',
      'The owner rotated this room. Ask them for a new invite link to keep collaborating.');
  });

  // Listen for connection status
  window.addEventListener('yjs-status', async (e) => {
    const { connected, synced, decryptionFailed } = e.detail;

    if (decryptionFailed) {
      updateStatus('Wrong password');
      await showAlert('Decryption Failed', 'Failed to decrypt room data. The password may be incorrect.');
    } else if (connected) {
      updateStatus(isEncrypted ? 'Encrypted' : 'Connected');
    } else if (synced) {
      updateStatus('Offline (synced locally)');
    } else {
      updateStatus('Connecting...');
    }
  });

  // A keyless visitor opened the bare URL of a password-protected room. The
  // capability (password + keys) lives only in the invite link, so they can't
  // read or edit until they open it.
  window.addEventListener('room-access-mismatch', async () => {
    if (isEncrypted) return; // we have the capability; not us
    updateStatus('Invite link required');
    await showAlert(
      'Invite Link Required',
      'This room is password-protected. Open the invite link you were given to view or edit it.'
    );
  });

  // Listen for board changes to update empty state
  window.addEventListener('board-change', (e) => {
    updateEmptyState(e.detail.itemCount === 0);
    if (role === 'view' && e.detail.itemCount === 0) updateStatus('Waiting for editor');
  });

  updateStatus(isEncrypted ? 'Encrypted' : 'Connected');

  // Setup toggle panel functionality
  const togglePanelBtn = document.getElementById('toggle-panel');
  const sidePanel = document.getElementById('side-panel');
  const canvasArea = document.getElementById('canvas-area');

  // Resize canvas function - defined early so it can be used by panel toggle
  function resizeCanvas() {
    const container = document.getElementById('canvas-container');
    const newWidth = container.clientWidth;
    const newHeight = container.clientHeight;

    // Only resize if dimensions actually changed
    if (canvas.width !== newWidth || canvas.height !== newHeight) {
      canvas.width = newWidth;
      canvas.height = newHeight;
      drawingController.redraw();
    }
  }

  if (togglePanelBtn && sidePanel && canvasArea) {
    togglePanelBtn.onclick = () => {
      sidePanel.classList.toggle('hidden');
      canvasArea.classList.toggle('panel-hidden');
      togglePanelBtn.classList.toggle('active');
    };
  }

  // Setup keyboard shortcuts
  setupKeyboardShortcuts();

  // Setup zoom and pan controls
  setupZoomPanControls();

  // ============ Dynamic Canvas Sizing ============

  // Use ResizeObserver for smooth, continuous resizing during animations
  const canvasContainer = document.getElementById('canvas-container');
  const resizeObserver = new ResizeObserver(() => {
    resizeCanvas();
  });
  resizeObserver.observe(canvasContainer);

  // Initial size
  resizeCanvas();

  // ============ Cleanup on Page Unload ============

  window.addEventListener('beforeunload', () => {
    // Clean up undo manager
    if (undoManagerInstance) {
      destroyUndoManager();
    }
    // Clean up drawing resources to prevent memory leaks
    cleanupDrawing();
    // Destroy Y.js instance
    if (yjsInstance?.destroy) {
      yjsInstance.destroy();
    }
  });
}

function switchTool(toolName) {
  // Save current tool settings before switching
  saveCurrentToolSettings();

  // Update current tool
  currentToolName = toolName;

  // Update UI
  setActiveTool(toolName);
  drawingController.setTool(toolName);

  // Load saved settings for this tool
  loadToolSettings(toolName);

  // Show/hide appropriate options panels
  updateOptionsVisibility(toolName);
}

function saveCurrentToolSettings() {
  if (!toolSettings[currentToolName]) return;

  const settings = toolSettings[currentToolName];

  // Save stroke width for tools that use it
  if ('strokeWidth' in settings) {
    const strokeWidthInput = document.getElementById('stroke-width');
    if (strokeWidthInput) {
      settings.strokeWidth = parseInt(strokeWidthInput.value);
    }
  }

  // Save fill settings for rect/circle
  if ('fillEnabled' in settings) {
    const fillEnabledInput = document.getElementById('fill-enabled');
    const fillColorInput = document.getElementById('fill-color');
    if (fillEnabledInput && fillColorInput) {
      settings.fillEnabled = fillEnabledInput.checked;
      settings.fillColor = fillColorInput.value;
    }
  }

  // Save text settings
  if ('fontSize' in settings) {
    const fontSizeInput = document.getElementById('font-size');
    if (fontSizeInput) {
      settings.fontSize = parseInt(fontSizeInput.value);
    }
  }
  if ('fontFamily' in settings) {
    const fontFamilySelect = document.getElementById('font-family');
    if (fontFamilySelect) {
      settings.fontFamily = fontFamilySelect.value;
    }
  }
}

function loadToolSettings(toolName) {
  const settings = toolSettings[toolName];
  if (!settings) return;

  // Load stroke width
  if ('strokeWidth' in settings) {
    const strokeWidthInput = document.getElementById('stroke-width');
    const strokeValueSpan = document.getElementById('stroke-value');
    if (strokeWidthInput && strokeValueSpan) {
      strokeWidthInput.value = settings.strokeWidth;
      strokeValueSpan.textContent = `${settings.strokeWidth}px`;
      drawingController.setStrokeWidth(settings.strokeWidth);
      updateStrokePresetHighlight(settings.strokeWidth);
    }
  }

  // Load fill settings
  if ('fillEnabled' in settings) {
    const fillEnabledInput = document.getElementById('fill-enabled');
    const fillColorInput = document.getElementById('fill-color');
    if (fillEnabledInput && fillColorInput) {
      fillEnabledInput.checked = settings.fillEnabled;
      fillColorInput.disabled = !settings.fillEnabled;
      fillColorInput.value = settings.fillColor;
      drawingController.setFillEnabled(settings.fillEnabled);
      drawingController.setFillColor(settings.fillColor);
    }
  }

  // Load text settings
  if ('fontSize' in settings) {
    const fontSizeInput = document.getElementById('font-size');
    const fontSizeValueSpan = document.getElementById('font-size-value');
    if (fontSizeInput && fontSizeValueSpan) {
      fontSizeInput.value = settings.fontSize;
      fontSizeValueSpan.textContent = `${settings.fontSize}px`;
      drawingController.setFontSize(settings.fontSize);
    }
  }
  if ('fontFamily' in settings) {
    const fontFamilySelect = document.getElementById('font-family');
    if (fontFamilySelect) {
      fontFamilySelect.value = settings.fontFamily;
      drawingController.setFontFamily(settings.fontFamily);
    }
  }
}

function setStrokeWidth(width) {
  const strokeWidthInput = document.getElementById('stroke-width');
  const strokeValueSpan = document.getElementById('stroke-value');
  if (strokeWidthInput && strokeValueSpan) {
    strokeWidthInput.value = width;
    strokeValueSpan.textContent = `${width}px`;
    drawingController.setStrokeWidth(width);
    saveCurrentToolSettings();
    updateStrokePresetHighlight(width);
  }
}

function updateStrokePresetHighlight(width) {
  document.querySelectorAll('.preset-btn').forEach(btn => {
    btn.classList.toggle('active', parseInt(btn.dataset.width) === width);
  });
}

function updateOptionsVisibility(toolName) {
  // Show/hide text options
  const isTextTool = toolName === 'text';
  document.querySelectorAll('.text-options').forEach(el => {
    el.style.display = isTextTool ? 'flex' : 'none';
  });

  // Show/hide fill option (only for rect and circle)
  const hasFill = toolName === 'rect' || toolName === 'circle';
  const fillOption = document.querySelector('.fill-option');
  if (fillOption) {
    fillOption.style.display = hasFill ? 'flex' : 'none';
  }

  // Show/hide stroke options (hide for select and eraser-shape)
  const hasStroke = !['select', 'eraser-shape'].includes(toolName);
  const strokeOption = document.querySelector('.stroke-option');
  if (strokeOption) {
    strokeOption.style.display = hasStroke ? 'flex' : 'none';
  }

  // Show/hide the divider between stroke and fill options
  const optionDivider = document.querySelector('.option-divider');
  if (optionDivider) {
    optionDivider.style.display = (hasStroke && hasFill) ? 'block' : 'none';
  }

  // Hide entire drawing-options container when no options are visible
  const drawingOptions = document.getElementById('drawing-options');
  if (drawingOptions) {
    const hasAnyOptions = hasStroke || hasFill || isTextTool;
    drawingOptions.style.display = hasAnyOptions ? 'flex' : 'none';
  }
}

function setActiveTool(tool) {
  // Remove active class from all tool buttons (supports both old and new UI)
  document.querySelectorAll('#tools button, .tool-btn').forEach(btn => {
    btn.classList.remove('active');
  });

  const toolToButtonId = {
    'select': 'select-tool',
    'line': 'draw-line',
    'rect': 'draw-rect',
    'circle': 'draw-circle',
    'freehand': 'draw-freehand',
    'text': 'draw-text',
    'eraser-shape': 'eraser-shape',
    'eraser-brush': 'eraser-brush'
  };

  const btnId = toolToButtonId[tool];
  if (btnId) {
    document.getElementById(btnId).classList.add('active');
  }
}

function updateStatus(status) {
  const statusEl = document.getElementById('connection-status');
  if (statusEl) {
    statusEl.textContent = status;
    statusEl.className =
      status === 'Connected' ? 'status-connected' :
      status === 'Encrypted' ? 'status-encrypted' :
      status === 'Wrong password' ? 'status-error' :
      status.includes('Offline') ? 'status-offline' : 'status-connecting';
  }

  // Hide loading overlay when connected
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay && (status === 'Connected' || status === 'Encrypted' || status.includes('Offline'))) {
    loadingOverlay.classList.add('hidden');
  }
}

function updateEmptyState(boardIsEmpty) {
  const emptyState = document.getElementById('empty-state');
  if (emptyState) {
    emptyState.style.display = boardIsEmpty ? 'flex' : 'none';
  }
}

function updateEncryptionIndicator(isEncrypted, isOwner = false) {
  const indicator = document.getElementById('encryption-indicator');
  if (indicator) {
    indicator.style.display = isEncrypted ? 'flex' : 'none';
  }

  // Show/hide appropriate buttons
  const addEncryptionBtn = document.getElementById('add-encryption');
  const changePasswordBtn = document.getElementById('change-password');

  if (addEncryptionBtn) {
    addEncryptionBtn.style.display = isEncrypted ? 'none' : 'block';
  }
  if (changePasswordBtn) {
    // Change Password only visible to encrypted-room owners
    changePasswordBtn.style.display = (isEncrypted && (isOwner || document.body.dataset.role === 'owner')) ? 'block' : 'none';
  }
}

// ============ Keyboard Shortcuts Setup ============

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Undo: Ctrl+Z (or Cmd+Z on Mac)
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (!readOnly && undoManagerInstance) {
        undo();
        drawingController.redraw();
      }
      return;
    }

    // Redo: Ctrl+Y or Ctrl+Shift+Z (or Cmd variants on Mac)
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      if (!readOnly && undoManagerInstance) {
        redo();
        drawingController.redraw();
      }
      return;
    }

    // Tool shortcuts (single key only - skip when a modifier is held so
    // combos like Cmd+C/Cmd+V aren't swallowed by tool switching, which would
    // clearSelection() before the copy/paste handlers below run).
    if (!e.ctrlKey && !e.metaKey && !e.altKey) {
      const toolShortcuts = {
        'v': 'select',
        'p': 'freehand',
        'l': 'line',
        'r': 'rect',
        'c': 'circle',
        't': 'text',
        'e': 'eraser-shape'
      };

      const tool = toolShortcuts[e.key.toLowerCase()];
      if (tool) {
        switchTool(tool);
      }
    }

    // Help: ? key shows keyboard shortcuts
    if (e.key === '?' || (e.shiftKey && e.key === '/')) {
      showKeyboardShortcuts();
    }

    // Delete: Delete or Backspace key deletes selected shapes
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      if (!readOnly) {
        deleteSelectedShapes();
        drawingController.redraw();
      }
    }

    // Copy: Ctrl+C
    if ((e.ctrlKey || e.metaKey) && e.key === 'c') {
      copySelectedShapes();
    }

    // Paste: Ctrl+V
    if ((e.ctrlKey || e.metaKey) && e.key === 'v') {
      e.preventDefault();
      if (!readOnly) {
        pasteShapes();
        drawingController.redraw();
      }
    }

    // Duplicate: Ctrl+D
    if ((e.ctrlKey || e.metaKey) && e.key === 'd') {
      e.preventDefault();
      if (!readOnly) {
        duplicateSelectedShapes();
        drawingController.redraw();
      }
    }
  });
}

// ============ Zoom & Pan Controls Setup ============

// Panning state
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let spacePressed = false;

function setupZoomPanControls() {
  // Space+drag panning
  document.addEventListener('keydown', (e) => {
    if (e.code === 'Space' && !e.repeat && e.target.tagName !== 'INPUT' && e.target.tagName !== 'TEXTAREA') {
      spacePressed = true;
      canvas.style.cursor = 'grab';
      e.preventDefault();
    }
  });

  document.addEventListener('keyup', (e) => {
    if (e.code === 'Space') {
      spacePressed = false;
      isPanning = false;
      canvas.style.cursor = 'crosshair';
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (spacePressed) {
      isPanning = true;
      panStartX = e.clientX;
      panStartY = e.clientY;
      canvas.style.cursor = 'grabbing';
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  canvas.addEventListener('mousemove', (e) => {
    if (isPanning) {
      const viewport = getViewport();
      const dx = (e.clientX - panStartX) / viewport.zoom;
      const dy = (e.clientY - panStartY) / viewport.zoom;
      panBy(-dx, -dy);
      panStartX = e.clientX;
      panStartY = e.clientY;
      drawingController.redraw();
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  canvas.addEventListener('mouseup', (e) => {
    if (isPanning) {
      isPanning = false;
      canvas.style.cursor = spacePressed ? 'grab' : 'crosshair';
      e.preventDefault();
      e.stopPropagation();
    }
  }, true);

  // Scroll wheel zoom (centered on cursor)
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault();

    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    const worldBefore = screenToWorld(mouseX, mouseY);

    const viewport = getViewport();
    const zoomFactor = e.deltaY > 0 ? 1 / ZOOM_WHEEL_STEP : ZOOM_WHEEL_STEP;
    const newZoom = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, viewport.zoom * zoomFactor));
    setZoom(newZoom);

    const worldAfter = screenToWorld(mouseX, mouseY);
    panBy(worldBefore.x - worldAfter.x, worldBefore.y - worldAfter.y);

    updateZoomDisplay();
    drawingController.redraw();
  }, { passive: false });

  // Wire up zoom control buttons
  const zoomLevelBtn = document.getElementById('zoom-level');
  const zoomInBtn = document.getElementById('zoom-in');
  const zoomOutBtn = document.getElementById('zoom-out');
  const zoomFitBtn = document.getElementById('zoom-fit');

  if (zoomInBtn) {
    zoomInBtn.addEventListener('click', () => {
      const viewport = getViewport();
      zoomTo(Math.min(ZOOM_MAX, viewport.zoom * ZOOM_STEP));
    });
  }

  if (zoomOutBtn) {
    zoomOutBtn.addEventListener('click', () => {
      const viewport = getViewport();
      zoomTo(Math.max(ZOOM_MIN, viewport.zoom / ZOOM_STEP));
    });
  }

  if (zoomLevelBtn) {
    zoomLevelBtn.addEventListener('click', () => {
      setZoom(1);
      const viewport = getViewport();
      panBy(-viewport.x, -viewport.y);
      updateZoomDisplay();
      drawingController.redraw();
    });
  }

  if (zoomFitBtn) {
    zoomFitBtn.addEventListener('click', fitAllShapes);
  }

  // Listen for viewport changes from touch/pinch zoom
  window.addEventListener('viewport-change', updateZoomDisplay);
}

function updateZoomDisplay() {
  const zoomLevelBtn = document.getElementById('zoom-level');
  const viewport = getViewport();
  if (zoomLevelBtn) {
    zoomLevelBtn.textContent = `${Math.round(viewport.zoom * 100)}%`;
  }
}

function zoomTo(newZoom, centerOnCanvas = true) {
  if (centerOnCanvas) {
    const rect = canvas.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;
    const worldBefore = screenToWorld(centerX, centerY);

    setZoom(newZoom);

    const worldAfter = screenToWorld(centerX, centerY);
    panBy(worldBefore.x - worldAfter.x, worldBefore.y - worldAfter.y);
  } else {
    setZoom(newZoom);
  }
  updateZoomDisplay();
  drawingController.redraw();
}

function fitAllShapes() {
  const bounds = getAllShapesBounds();
  if (!bounds || bounds.width === 0 || bounds.height === 0) {
    setZoom(1);
    const viewport = getViewport();
    panBy(-viewport.x, -viewport.y);
    updateZoomDisplay();
    drawingController.redraw();
    return;
  }

  const rect = canvas.getBoundingClientRect();

  const scaleX = (rect.width - FIT_PADDING * 2) / bounds.width;
  const scaleY = (rect.height - FIT_PADDING * 2) / bounds.height;
  const newZoom = Math.min(Math.max(ZOOM_MIN, Math.min(scaleX, scaleY)), 2);

  setZoom(newZoom);
  const centerX = bounds.x + bounds.width / 2;
  const centerY = bounds.y + bounds.height / 2;
  const viewport = getViewport();
  const newPanX = centerX - (rect.width / 2) / newZoom;
  const newPanY = centerY - (rect.height / 2) / newZoom;
  panBy(newPanX - viewport.x, newPanY - viewport.y);

  updateZoomDisplay();
  drawingController.redraw();
}

function getAllShapesBounds() {
  const currentBoard = boardManager.getCurrentBoard();
  const { boards } = yjsInstance;
  const board = boards.get(currentBoard);
  if (!board || board.length === 0) return null;

  let minX = Infinity, minY = Infinity;
  let maxX = -Infinity, maxY = -Infinity;

  board.forEach(shape => {
    const bounds = getShapeBoundsForFit(shape);
    if (bounds) {
      minX = Math.min(minX, bounds.x);
      minY = Math.min(minY, bounds.y);
      maxX = Math.max(maxX, bounds.x + bounds.width);
      maxY = Math.max(maxY, bounds.y + bounds.height);
    }
  });

  if (minX === Infinity) return null;

  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function getShapeBoundsForFit(shape) {
  switch (shape.tool) {
    case 'line':
      return {
        x: Math.min(shape.startX, shape.x),
        y: Math.min(shape.startY, shape.y),
        width: Math.abs(shape.x - shape.startX) || 1,
        height: Math.abs(shape.y - shape.startY) || 1
      };
    case 'rect':
      return {
        x: shape.width >= 0 ? shape.startX : shape.startX + shape.width,
        y: shape.height >= 0 ? shape.startY : shape.startY + shape.height,
        width: Math.abs(shape.width) || 1,
        height: Math.abs(shape.height) || 1
      };
    case 'circle':
      return {
        x: shape.startX - shape.radius,
        y: shape.startY - shape.radius,
        width: shape.radius * 2 || 1,
        height: shape.radius * 2 || 1
      };
    case 'text':
      return {
        x: shape.x,
        y: shape.y - (shape.fontSize || 20),
        width: 100,
        height: shape.fontSize || 20
      };
    case 'freehand':
    case 'eraser':
      if (!shape.points || shape.points.length === 0) return null;
      let fMinX = Infinity, fMinY = Infinity, fMaxX = -Infinity, fMaxY = -Infinity;
      shape.points.forEach(p => {
        fMinX = Math.min(fMinX, p.x);
        fMinY = Math.min(fMinY, p.y);
        fMaxX = Math.max(fMaxX, p.x);
        fMaxY = Math.max(fMaxY, p.y);
      });
      return {
        x: fMinX,
        y: fMinY,
        width: (fMaxX - fMinX) || 1,
        height: (fMaxY - fMinY) || 1
      };
    default:
      return null;
  }
}

// ============ Browser Compatibility ============

function checkBrowserCompatibility() {
  const missing = [];

  // Check for required APIs
  if (!window.WebSocket) {
    missing.push('WebSocket');
  }
  if (!window.indexedDB) {
    missing.push('IndexedDB');
  }
  if (!window.crypto || !window.crypto.subtle) {
    missing.push('Web Crypto API');
  }
  if (!window.TextEncoder || !window.TextDecoder) {
    missing.push('TextEncoder/TextDecoder');
  }

  if (missing.length > 0) {
    const message = `Your browser is missing required features:\n\n• ${missing.join('\n• ')}\n\nPlease use a modern browser like Chrome, Firefox, Safari, or Edge.`;
    document.body.innerHTML = `
      <div style="display: flex; align-items: center; justify-content: center; height: 100vh; padding: 20px; text-align: center; font-family: system-ui, sans-serif;">
        <div style="max-width: 500px;">
          <h2 style="color: #ef4444; margin-bottom: 16px;">Browser Not Supported</h2>
          <p style="color: #71717a; white-space: pre-line;">${message}</p>
        </div>
      </div>
    `;
    return false;
  }

  return true;
}

// ============ Error Handling ============

function handleError(error, context = 'Unknown') {
  console.error(`Error in ${context}:`, error);

  // Hide loading overlay in case of error
  const loadingOverlay = document.getElementById('loading-overlay');
  if (loadingOverlay) {
    loadingOverlay.classList.add('hidden');
  }

  // Show user-friendly error message
  const message = error.message || 'An unexpected error occurred';
  initModals();
  showAlert('Error', `${message}\n\nPlease try refreshing the page.`);
}

// Global error handler for unhandled errors
window.addEventListener('error', (event) => {
  handleError(event.error || new Error(event.message), 'Global');
});

// Global handler for unhandled promise rejections
window.addEventListener('unhandledrejection', (event) => {
  handleError(event.reason, 'Promise');
});

// Start the app (after compatibility check)
if (checkBrowserCompatibility()) {
  main().catch(err => {
    handleError(err, 'Initialization');
  });
}
