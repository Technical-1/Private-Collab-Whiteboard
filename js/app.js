import { jsPDF } from 'jspdf';
import { initializeYjs, rotateRoom } from './yjs-setup.js';
import {
  initializeAwareness,
  setUsersContainer,
  setCursorsContainer,
  changeUserColor,
  getLocalUserColor
} from './awareness.js';
import { setupDrawing, subscribeToBoard, screenToWorld, getViewport, panBy, setZoom, setReadOnlyMode, cleanup as cleanupDrawing, deleteSelectedShapes, copySelectedShapes, pasteShapes, duplicateSelectedShapes, getFitBounds, renderBoardToCanvas } from './drawing.js';
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
  showSaveModal
} from './modal.js';
import { shouldDeleteSelection } from './keyboard-intent.js';
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
  line: { strokeWidth: 2, strokeStyle: 'solid' },
  rect: { strokeWidth: 2, strokeStyle: 'solid', fillEnabled: false, fillColor: '#ffffff' },
  circle: { strokeWidth: 2, strokeStyle: 'solid', fillEnabled: false, fillColor: '#ffffff' },
  freehand: { strokeWidth: 2, strokeStyle: 'solid' },
  highlight: { strokeWidth: 16 },
  text: { fontSize: 20, fontFamily: 'Arial' },
  'eraser-brush': { strokeWidth: 4 },
  arrow: { strokeWidth: 2, strokeStyle: 'solid' },
  connector: { strokeWidth: 2, strokeStyle: 'solid' },
  diamond: { strokeWidth: 2, strokeStyle: 'solid', fillEnabled: false, fillColor: '#ffffff' },
  triangle: { strokeWidth: 2, strokeStyle: 'solid', fillEnabled: false, fillColor: '#ffffff' },
  ellipse: { strokeWidth: 2, strokeStyle: 'solid', fillEnabled: false, fillColor: '#ffffff' }
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
  // (color is owned by awareness now — the picker lives on the local avatar)
  initializeAwareness(awareness, userName, () => {
    // Redraw canvas when other users' awareness changes (for live drawing preview)
    if (drawingController) {
      drawingController.redraw();
    }
  });

  // Set containers for rendering
  setUsersContainer(document.getElementById('presence'));
  setCursorsContainer(document.getElementById('cursors'));
  setBoardsContainer(document.getElementById('boards'));

  // Color picker is now handled in awareness.js (overlaid on the local avatar bubble).

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
    'draw-highlight': 'highlight',
    'draw-text': 'text',
    'eraser-shape': 'eraser-shape',
    'eraser-brush': 'eraser-brush',
    'draw-arrow': 'arrow',
    'draw-diamond': 'diamond',
    'draw-triangle': 'triangle',
    'draw-ellipse': 'ellipse',
    'tool-laser': 'laser',
    'tool-sticky': 'sticky',
    'tool-connector': 'connector',
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
      applyStrokeWidth(width);
    };
  });

  // Wire up stroke style buttons
  document.querySelectorAll('.style-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.style-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyStrokeStyle(btn.dataset.style);
    };
  });

  // Wire up arrowhead buttons
  document.querySelectorAll('.arrowhead-btn').forEach(btn => {
    btn.onclick = () => {
      document.querySelectorAll('.arrowhead-btn').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      applyArrowHeads(btn.dataset.heads);
    };
  });

  // Wire up sticky note color palette. Swatch backgrounds are set here via CSSOM
  // (not an inline style attribute) because the production CSP forbids inline styles.
  document.querySelectorAll('.sticky-color').forEach(btn => {
    btn.style.background = btn.dataset.color;
    btn.onclick = () => {
      document.querySelectorAll('.sticky-color').forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      drawingController.setStickyColor(btn.dataset.color);
    };
  });

  // Wire up drawing options
  const strokeWidthInput = document.getElementById('stroke-width');
  const strokeValueSpan = document.getElementById('stroke-value');
  if (strokeWidthInput) {
    strokeWidthInput.oninput = (e) => {
      const width = parseInt(e.target.value);
      if (strokeValueSpan) strokeValueSpan.textContent = `${width}px`;
      applyStrokeWidth(width);
    };
  }

  const fillEnabledInput = document.getElementById('fill-enabled');
  const fillColorInput = document.getElementById('fill-color');
  if (fillEnabledInput && fillColorInput) {
    fillEnabledInput.onchange = (e) => {
      const enabled = e.target.checked;
      fillColorInput.disabled = !enabled;
      applyFillEnabled(enabled, fillColorInput.value);
    };
    fillColorInput.oninput = (e) => {
      applyFillColor(e.target.value);
    };
  }

  const fontSizeInput = document.getElementById('font-size');
  const fontSizeValueSpan = document.getElementById('font-size-value');
  if (fontSizeInput) {
    fontSizeInput.oninput = (e) => {
      const size = parseInt(e.target.value);
      if (fontSizeValueSpan) fontSizeValueSpan.textContent = `${size}px`;
      applyFontSize(size);
    };
  }

  const fontFamilySelect = document.getElementById('font-family');
  if (fontFamilySelect) {
    fontFamilySelect.onchange = (e) => {
      applyFontFamily(e.target.value);
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
    if (readOnly) return;
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

  // Wire up save as image — opens interactive pan/zoom preview modal
  document.getElementById('save-image').onclick = async () => {
    const SAVE_PADDING = FIT_PADDING;
    const PREVIEW_W = 760;
    const PREVIEW_H = 460;
    const EXPORT_SCALE = 2; // retina-quality export
    const ZOOM_MIN_SAVE = 0.05;
    const ZOOM_MAX_SAVE = 8;
    const ZOOM_FIT_CAP_SAVE = 4; // cap initial fit zoom; interactive zoom can go higher

    // Compute a view {x, y, zoom} that fits the given world-space bounds into the
    // preview canvas logical dimensions (PREVIEW_W x PREVIEW_H) with padding.
    function computeFitView(bounds) {
      if (!bounds || bounds.width === 0 || bounds.height === 0) {
        const vp = getViewport();
        return { x: vp.x, y: vp.y, zoom: vp.zoom };
      }
      const scaleX = (PREVIEW_W - SAVE_PADDING * 2) / bounds.width;
      const scaleY = (PREVIEW_H - SAVE_PADDING * 2) / bounds.height;
      const zoom = Math.min(Math.max(ZOOM_MIN_SAVE, Math.min(scaleX, scaleY)), ZOOM_FIT_CAP_SAVE);
      const cx = bounds.x + bounds.width / 2;
      const cy = bounds.y + bounds.height / 2;
      return {
        x: cx - (PREVIEW_W / 2) / zoom,
        y: cy - (PREVIEW_H / 2) / zoom,
        zoom
      };
    }

    // Mutable preview view (logical canvas coordinates, not physical pixels)
    let view = computeFitView(getAllShapesBounds());

    // Open the modal — canvas is synchronously available in the returned object
    const { previewCanvas, promise } = showSaveModal();

    // Size the canvas: physical pixels = logical × devicePixelRatio for crispness.
    // We set .width/.height attributes (not CSS) — no inline style, CSP-safe.
    const dpr = window.devicePixelRatio || 1;
    previewCanvas.width = PREVIEW_W * dpr;
    previewCanvas.height = PREVIEW_H * dpr;

    // Render current view into the preview canvas.
    // The view's zoom is multiplied by dpr so the shapes fill the physical pixels;
    // the world-space x/y stay unchanged.
    function render() {
      renderBoardToCanvas(previewCanvas, {
        x: view.x,
        y: view.y,
        zoom: view.zoom * dpr
      });
    }

    render();

    // --- Save-preview zoom cluster buttons ---
    const ZOOM_STEP_SAVE = 1.25;

    const saveZoomInBtn  = document.getElementById('save-zoom-in');
    const saveZoomOutBtn = document.getElementById('save-zoom-out');
    const saveFitBtn     = document.getElementById('save-fit');

    if (saveZoomInBtn) {
      saveZoomInBtn.addEventListener('click', () => {
        // Keep world point at preview center fixed
        const cx = PREVIEW_W / 2;
        const cy = PREVIEW_H / 2;
        const worldX = cx / view.zoom + view.x;
        const worldY = cy / view.zoom + view.y;
        view.zoom = Math.min(ZOOM_MAX_SAVE, view.zoom * ZOOM_STEP_SAVE);
        view.x = worldX - cx / view.zoom;
        view.y = worldY - cy / view.zoom;
        render();
      });
    }

    if (saveZoomOutBtn) {
      saveZoomOutBtn.addEventListener('click', () => {
        const cx = PREVIEW_W / 2;
        const cy = PREVIEW_H / 2;
        const worldX = cx / view.zoom + view.x;
        const worldY = cy / view.zoom + view.y;
        view.zoom = Math.max(ZOOM_MIN_SAVE, view.zoom / ZOOM_STEP_SAVE);
        view.x = worldX - cx / view.zoom;
        view.y = worldY - cy / view.zoom;
        render();
      });
    }

    if (saveFitBtn) {
      saveFitBtn.addEventListener('click', () => {
        view = computeFitView(getAllShapesBounds());
        render();
      });
    }

    // --- Wheel: zoom toward cursor ---
    function onWheel(e) {
      e.preventDefault();
      const rect = previewCanvas.getBoundingClientRect();
      // Map CSS-pixel cursor position → logical canvas coordinates
      const cx = (e.clientX - rect.left) * (PREVIEW_W / rect.width);
      const cy = (e.clientY - rect.top) * (PREVIEW_H / rect.height);
      // World point under the cursor before zoom
      const worldX = cx / view.zoom + view.x;
      const worldY = cy / view.zoom + view.y;

      const factor = e.deltaY > 0 ? 0.9 : 1.1;
      view.zoom = Math.max(ZOOM_MIN_SAVE, Math.min(ZOOM_MAX_SAVE, view.zoom * factor));
      // Keep that world point under the cursor after zoom
      view.x = worldX - cx / view.zoom;
      view.y = worldY - cy / view.zoom;
      render();
    }

    // --- Mousedown/move/up: drag to pan ---
    let dragActive = false;
    let dragLastX = 0;
    let dragLastY = 0;

    function onMouseDown(e) {
      dragActive = true;
      dragLastX = e.clientX;
      dragLastY = e.clientY;
      previewCanvas.style.cursor = 'grabbing';
    }

    function onMouseMove(e) {
      if (!dragActive) return;
      const rect = previewCanvas.getBoundingClientRect();
      const scaleX = PREVIEW_W / rect.width;
      const scaleY = PREVIEW_H / rect.height;
      const dx = (e.clientX - dragLastX) * scaleX / view.zoom;
      const dy = (e.clientY - dragLastY) * scaleY / view.zoom;
      view.x -= dx;
      view.y -= dy;
      dragLastX = e.clientX;
      dragLastY = e.clientY;
      render();
    }

    function onMouseUp() {
      if (!dragActive) return;
      dragActive = false;
      previewCanvas.style.cursor = 'grab';
    }

    previewCanvas.style.cursor = 'grab';
    previewCanvas.addEventListener('wheel', onWheel, { passive: false });
    previewCanvas.addEventListener('mousedown', onMouseDown);
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);

    function removeListeners() {
      previewCanvas.removeEventListener('wheel', onWheel);
      previewCanvas.removeEventListener('mousedown', onMouseDown);
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    }

    // Wait for the user to choose Save PNG / Save PDF / Close.
    // removeListeners() runs unconditionally in the finally block, covering
    // normal resolution, user dismissal, and any render/export errors.
    let choice;
    try {
      choice = await promise;

      if (!choice) return; // dismissed

      // Export at higher resolution: same view zoom × EXPORT_SCALE, same world origin
      const exportW = PREVIEW_W * EXPORT_SCALE;
      const exportH = PREVIEW_H * EXPORT_SCALE;
      const exportCanvas = document.createElement('canvas');
      exportCanvas.width = exportW;
      exportCanvas.height = exportH;
      renderBoardToCanvas(exportCanvas, {
        x: view.x,
        y: view.y,
        zoom: view.zoom * EXPORT_SCALE
      });

      if (choice === 'png') {
        const dataUrl = exportCanvas.toDataURL('image/png');
        const link = document.createElement('a');
        link.download = 'whiteboard.png';
        link.href = dataUrl;
        link.click();
      } else if (choice === 'pdf') {
        const dataUrl = exportCanvas.toDataURL('image/png');
        const pdf = new jsPDF({
          orientation: exportW >= exportH ? 'landscape' : 'portrait',
          unit: 'px',
          format: [exportW, exportH]
        });
        pdf.addImage(dataUrl, 'PNG', 0, 0, exportW, exportH);
        pdf.save('whiteboard.pdf');
      }
    } finally {
      removeListeners();
    }
  };

  // Add invite button functionality (if exists)
  const inviteBtn = document.getElementById('invite-btn');
  if (inviteBtn) {
    inviteBtn.onclick = async () => {
      await showInviteModal((permission) => getShareableLink(permission), isEncrypted);
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

  // Listen for board changes
  window.addEventListener('board-change', (e) => {
    if (role === 'view' && e.detail.itemCount === 0) updateStatus('Waiting for editor');
  });

  updateStatus(isEncrypted ? 'Encrypted' : 'Connected');

  // Resize canvas function
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

  // Save stroke style for tools that use it
  if ('strokeStyle' in settings) {
    const activeStyleBtn = document.querySelector('.style-btn.active');
    settings.strokeStyle = activeStyleBtn?.dataset.style ?? drawingController.getStrokeStyle();
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

  // Load stroke style
  if ('strokeStyle' in settings) {
    drawingController.setStrokeStyle(settings.strokeStyle);
    document.querySelectorAll('.style-btn').forEach(b => {
      b.classList.toggle('active', b.dataset.style === settings.strokeStyle);
    });
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

// ============ New-shape default option helpers ============
// These helpers ONLY set the default for the next shape drawn.
// Per-shape editing is exclusively in the ⚙ gear popup (showShapeSettingsPopup / updateShapeProperty).

function applyStrokeWidth(width) {
  setStrokeWidth(width);
}

function applyStrokeStyle(style) {
  drawingController.setStrokeStyle(style);
}

/**
 * @param {boolean} enabled
 * @param {string} currentColor - current value of the fill-color input
 */
function applyFillEnabled(enabled, currentColor) {
  drawingController.setFillEnabled(enabled);
  saveCurrentToolSettings();
}

function applyFillColor(color) {
  drawingController.setFillColor(color);
  saveCurrentToolSettings();
}

function applyFontSize(size) {
  drawingController.setFontSize(size);
  saveCurrentToolSettings();
}

function applyFontFamily(family) {
  drawingController.setFontFamily(family);
  saveCurrentToolSettings();
}

function applyArrowHeads(value) {
  drawingController.setArrowHeads(value);
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

  // Sticky-note options (color palette) — only for the sticky tool
  const isSticky = toolName === 'sticky';
  document.querySelectorAll('.sticky-options').forEach(el => {
    el.style.display = isSticky ? 'flex' : 'none';
  });

  // Show/hide fill option (for the fillable shape tools)
  const hasFill = ['rect', 'circle', 'diamond', 'triangle', 'ellipse'].includes(toolName);
  const fillOption = document.querySelector('.fill-option');
  if (fillOption) {
    fillOption.style.display = hasFill ? 'flex' : 'none';
  }

  // Show/hide stroke options (hide for select, eraser-shape, and the laser
  // pointer — the laser uses a fixed width, so stroke controls are meaningless).
  const hasStroke = !['select', 'eraser-shape', 'laser', 'sticky'].includes(toolName);
  const strokeOption = document.querySelector('.stroke-option');
  if (strokeOption) {
    strokeOption.style.display = hasStroke ? 'flex' : 'none';
  }

  // Stroke STYLE (solid/dashed/dotted) is meaningless for the highlighter, which
  // is always solid — hide the segmented control for it (width slider stays).
  const styleGroup = document.querySelector('.stroke-style-group');
  if (styleGroup) {
    styleGroup.style.display = (hasStroke && toolName !== 'highlight') ? 'flex' : 'none';
  }

  // Show/hide the divider between stroke and fill options
  const optionDivider = document.querySelector('.option-divider');
  if (optionDivider) {
    optionDivider.style.display = (hasStroke && hasFill) ? 'block' : 'none';
  }

  // Show/hide arrowheads control — only for arrow and connector tools
  const isArrowTool = toolName === 'arrow' || toolName === 'connector';
  const arrowOptions = document.querySelector('.arrow-options');
  if (arrowOptions) {
    arrowOptions.style.display = isArrowTool ? 'flex' : 'none';
  }

  // Hide entire drawing-options container when no options are visible
  const drawingOptions = document.getElementById('drawing-options');
  if (drawingOptions) {
    const hasAnyOptions = hasStroke || hasFill || isTextTool || isSticky || isArrowTool;
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
    'highlight': 'draw-highlight',
    'text': 'draw-text',
    'eraser-shape': 'eraser-shape',
    'eraser-brush': 'eraser-brush',
    'arrow': 'draw-arrow',
    'diamond': 'draw-diamond',
    'triangle': 'draw-triangle',
    'ellipse': 'draw-ellipse',
    'laser': 'tool-laser',
    'sticky': 'tool-sticky',
    'connector': 'tool-connector',
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

function updateEncryptionIndicator(isEncrypted, isOwner = false) {
  const indicator = document.getElementById('encryption-indicator');
  if (indicator) {
    indicator.style.display = isEncrypted ? 'flex' : 'none';
  }

  // Show/hide appropriate buttons
  const addEncryptionBtn = document.getElementById('add-encryption');
  const changePasswordBtn = document.getElementById('change-password');

  if (addEncryptionBtn) {
    addEncryptionBtn.style.display = isEncrypted ? 'none' : 'inline-flex';
  }
  if (changePasswordBtn) {
    // Change Password only visible to encrypted-room owners
    changePasswordBtn.style.display = (isEncrypted && (isOwner || document.body.dataset.role === 'owner')) ? 'inline-flex' : 'none';
  }
}

// ============ Keyboard Shortcuts Setup ============

function setupKeyboardShortcuts() {
  document.addEventListener('keydown', (e) => {
    // Don't trigger shortcuts when typing in inputs
    if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

    // Undo: Ctrl+Z (or Cmd+Z on Mac)
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !e.shiftKey) {
      e.preventDefault();
      if (!readOnly && undoManagerInstance) {
        undo();
        drawingController.redraw();
      }
      return;
    }

    // Redo: Ctrl+Y or Ctrl+Shift+Z (or Cmd variants on Mac)
    if ((e.ctrlKey || e.metaKey) && (e.key.toLowerCase() === 'y' || (e.key.toLowerCase() === 'z' && e.shiftKey))) {
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
        'h': 'highlight',
        'l': 'line',
        'r': 'rect',
        'c': 'circle',
        't': 'text',
        'e': 'eraser-shape',
        'a': 'arrow',
        'd': 'diamond',
        'y': 'triangle',
        'o': 'ellipse',
        'q': 'laser',
        's': 'sticky',
        'g': 'connector',
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

    // Delete: only consume the key when a deletion will actually occur, so an
    // empty/ read-only Backspace is not swallowed.
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const selectionCount = drawingController.getSelectedIds().size;
      if (shouldDeleteSelection({ readOnly, selectionCount })) {
        e.preventDefault();
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

  // Scroll wheel zoom (centered on cursor), with sticky-note scroll interception.
  // When the cursor is over an overflowing sticky note, the wheel scrolls the note
  // instead of zooming the canvas. Over empty canvas or a non-overflowing note the
  // normal zoom behavior applies.
  canvas.addEventListener('wheel', (e) => {
    const rect = canvas.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    // Compute world coordinates BEFORE any zoom change so handleStickyScroll
    // receives the correct world position.
    const worldPos = screenToWorld(mouseX, mouseY);

    // Let an overflowing sticky note consume the wheel event.
    if (drawingController.handleStickyScroll(worldPos.x, worldPos.y, e.deltaY)) {
      e.preventDefault();
      return;
    }

    // Default: zoom the canvas centered on the cursor.
    e.preventDefault();

    const worldBefore = worldPos; // already computed above
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

  // Reliable affordance for the shortcuts panel (the `?` key was flaky across setups).
  const helpBtn = document.getElementById('help-btn');
  if (helpBtn) helpBtn.addEventListener('click', () => showKeyboardShortcuts());

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
  // Single source of truth lives in drawing.js getFitBounds (which reuses
  // getShapeBounds), so a new tool is covered automatically.
  return getFitBounds(shape);
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
      <div class="browser-unsupported">
        <div class="browser-unsupported__inner">
          <h2 class="browser-unsupported__title">Browser Not Supported</h2>
          <p class="browser-unsupported__msg">${message}</p>
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
