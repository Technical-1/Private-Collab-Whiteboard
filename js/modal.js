// Modal system to replace native prompt/confirm dialogs
import { escapeHtml } from './utils.js';

let modalContainer = null;

// Initialize the modal container
export function initModals() {
  if (modalContainer) return;

  modalContainer = document.createElement('div');
  modalContainer.id = 'modal-container';
  modalContainer.innerHTML = `
    <div class="app-modal" id="app-modal">
      <div class="modal-backdrop"></div>
      <div class="modal-content">
        <button class="modal-close" id="modal-close-btn">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M18 6L6 18M6 6l12 12"/>
          </svg>
        </button>
        <h2 id="modal-title">Title</h2>
        <p id="modal-description"></p>
        <div id="modal-body"></div>
        <div id="modal-actions" class="modal-actions"></div>
      </div>
    </div>
  `;
  document.body.appendChild(modalContainer);

  // Close modal on backdrop click
  modalContainer.querySelector('.modal-backdrop').addEventListener('click', () => {
    closeModal();
  });

  // Close modal on X button click
  modalContainer.querySelector('#modal-close-btn').addEventListener('click', () => {
    closeModal();
  });

  // Close modal on Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modalContainer.querySelector('.app-modal.active')) {
      closeModal();
    }
  });
}

let currentResolve = null;
// Optional teardown run on EVERY close path (backdrop / X / Escape / buttons).
// A modal that registers window-level listeners sets this so they can't leak
// when the user dismisses via backdrop or Escape rather than an action button.
let currentCleanup = null;

function closeModal(result = null) {
  const modal = modalContainer.querySelector('.app-modal');
  modal.classList.remove('active');

  if (currentCleanup) {
    try { currentCleanup(); } catch (e) { console.error('Modal cleanup failed:', e); }
    currentCleanup = null;
  }

  if (currentResolve) {
    currentResolve(result);
  }

  currentResolve = null;
}

function showModal(title, description, bodyHTML, actions) {
  initModals();
  // Each modal starts with no teardown registered; the opener sets one if needed.
  currentCleanup = null;

  const modal = modalContainer.querySelector('.app-modal');
  const titleEl = modalContainer.querySelector('#modal-title');
  const descEl = modalContainer.querySelector('#modal-description');
  const bodyEl = modalContainer.querySelector('#modal-body');
  const actionsEl = modalContainer.querySelector('#modal-actions');

  titleEl.textContent = title;
  descEl.textContent = description || '';
  descEl.style.display = description ? 'block' : 'none';
  bodyEl.innerHTML = bodyHTML;
  actionsEl.innerHTML = actions;

  modal.classList.add('active');

  // Focus first input if exists
  const firstInput = bodyEl.querySelector('input, textarea, select');
  if (firstInput) {
    setTimeout(() => firstInput.focus(), 100);
  }
}

// Prompt replacement - shows an input modal
export function showPrompt(title, description = '', defaultValue = '', placeholder = '') {
  return new Promise((resolve) => {
    currentResolve = resolve;

    const bodyHTML = `
      <div class="modal-input-group">
        <input type="text" id="modal-input" class="modal-input"
               value="${escapeHtml(defaultValue)}"
               placeholder="${escapeHtml(placeholder)}">
      </div>
    `;

    const actions = `
      <button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>
      <button class="modal-btn modal-btn-primary" id="modal-confirm">Confirm</button>
    `;

    showModal(title, description, bodyHTML, actions);

    const input = modalContainer.querySelector('#modal-input');
    const confirmBtn = modalContainer.querySelector('#modal-confirm');
    const cancelBtn = modalContainer.querySelector('#modal-cancel');

    confirmBtn.onclick = () => {
      closeModal(input.value);
    };

    cancelBtn.onclick = () => {
      closeModal(null);
    };

    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        closeModal(input.value);
      }
    });
  });
}

// Confirm replacement - shows a confirmation modal
export function showConfirm(title, description = '', confirmText = 'Confirm', cancelText = 'Cancel', isDanger = false) {
  return new Promise((resolve) => {
    currentResolve = resolve;

    const actions = `
      <button class="modal-btn modal-btn-secondary" id="modal-cancel">${escapeHtml(cancelText)}</button>
      <button class="modal-btn ${isDanger ? 'modal-btn-danger' : 'modal-btn-primary'}" id="modal-confirm">${escapeHtml(confirmText)}</button>
    `;

    showModal(title, description, '', actions);

    const confirmBtn = modalContainer.querySelector('#modal-confirm');
    const cancelBtn = modalContainer.querySelector('#modal-cancel');

    confirmBtn.onclick = () => {
      closeModal(true);
    };

    cancelBtn.onclick = () => {
      closeModal(false);
    };
  });
}

// Alert replacement - shows an info modal
export function showAlert(title, description = '') {
  return new Promise((resolve) => {
    currentResolve = resolve;

    const actions = `
      <button class="modal-btn modal-btn-primary" id="modal-ok">OK</button>
    `;

    showModal(title, description, '', actions);

    const okBtn = modalContainer.querySelector('#modal-ok');
    okBtn.onclick = () => {
      closeModal(true);
    };
  });
}

// Custom modal for inviting users with role selection
export function showInviteModal(linkFor, isEncrypted) {
  return new Promise((resolve) => {
    currentResolve = resolve;

    const bodyHTML = `
      <div class="invite-modal-content">
        <div class="modal-input-group">
          <label>Share Link</label>
          <div class="share-link-row">
            <input type="text" id="modal-share-link" class="modal-input" value="" readonly>
            <button class="modal-copy-btn" id="modal-copy-link" title="Copy">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2"/>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
              </svg>
            </button>
          </div>
        </div>

        <div class="modal-input-group">
          <label>Permission Level</label>
          <div class="permission-options">
            <label class="permission-option">
              <input type="radio" name="permission" value="edit" checked>
              <div class="permission-content">
                <span class="permission-title">Can Edit</span>
                <span class="permission-desc">Draw, add text, and modify the board</span>
              </div>
            </label>
            <label class="permission-option">
              <input type="radio" name="permission" value="view">
              <div class="permission-content">
                <span class="permission-title">View Only</span>
                <span class="permission-desc">Can see the board but not make changes</span>
              </div>
            </label>
          </div>
        </div>

        ${isEncrypted ? `
        <p class="modal-hint">This link includes the room password and keys, so anyone with it can access the room at the selected permission level.</p>
        ` : ''}
      </div>
    `;

    const actions = `
      <button class="modal-btn modal-btn-secondary" id="modal-cancel">Close</button>
      <button class="modal-btn modal-btn-primary" id="modal-copy-and-close">Copy Link</button>
    `;

    showModal('Invite People', 'Share this link to invite others to the whiteboard', bodyHTML, actions);

    const copyBtn = modalContainer.querySelector('#modal-copy-link');
    const copyAndCloseBtn = modalContainer.querySelector('#modal-copy-and-close');
    const cancelBtn = modalContainer.querySelector('#modal-cancel');
    const linkInput = modalContainer.querySelector('#modal-share-link');
    const permissionRadios = modalContainer.querySelectorAll('input[name="permission"]');

    const refreshLink = () => {
      const permission = modalContainer.querySelector('input[name="permission"]:checked').value;
      linkInput.value = linkFor(permission);
    };
    permissionRadios.forEach(radio => radio.addEventListener('change', refreshLink));
    refreshLink(); // set initial value from the selected (edit) radio

    const copyToClipboard = () => {
      navigator.clipboard.writeText(linkInput.value);
      copyBtn.innerHTML = `
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M20 6L9 17l-5-5"/>
        </svg>
      `;
      setTimeout(() => {
        copyBtn.innerHTML = `
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <rect x="9" y="9" width="13" height="13" rx="2"/>
            <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
          </svg>
        `;
      }, 2000);
    };

    copyBtn.onclick = copyToClipboard;

    copyAndCloseBtn.onclick = () => {
      copyToClipboard();
      const permission = modalContainer.querySelector('input[name="permission"]:checked').value;
      closeModal({ copied: true, permission });
    };

    cancelBtn.onclick = () => {
      closeModal(null); // radio listeners are DOM-scoped; nothing to tear down
    };
  });
}

// Password input modal (for changing/adding encryption)
export function showPasswordModal(title, description = '', isChange = false) {
  return new Promise((resolve) => {
    currentResolve = resolve;

    const bodyHTML = `
      <div class="modal-input-group">
        <label>Password</label>
        <input type="password" id="modal-password" class="modal-input" placeholder="Enter password">
      </div>
      ${isChange ? `
      <p class="modal-warning">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <line x1="12" y1="9" x2="12" y2="13"/>
          <line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        Changing the password will lock out users with the old password
      </p>
      ` : ''}
    `;

    const actions = `
      <button class="modal-btn modal-btn-secondary" id="modal-cancel">Cancel</button>
      <button class="modal-btn modal-btn-primary" id="modal-confirm">${isChange ? 'Change Password' : 'Enable Encryption'}</button>
    `;

    showModal(title, description, bodyHTML, actions);

    const passwordInput = modalContainer.querySelector('#modal-password');
    const confirmBtn = modalContainer.querySelector('#modal-confirm');
    const cancelBtn = modalContainer.querySelector('#modal-cancel');

    confirmBtn.onclick = () => {
      closeModal(passwordInput.value);
    };

    cancelBtn.onclick = () => {
      closeModal(null);
    };

    passwordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        closeModal(passwordInput.value);
      }
    });
  });
}

/**
 * Show an interactive save-as modal with a pannable/zoomable preview canvas.
 * The caller renders board content into the canvas and wires pan/zoom interactions.
 *
 * Returns an object with:
 *   - previewCanvas: the canvas element (already in the DOM when this returns)
 *   - promise: resolves to 'png' | 'pdf' | null when the user acts
 */
export function showSaveModal() {
  initModals();

  const bodyHTML = `
    <div class="save-preview-wrapper">
      <canvas class="save-preview-canvas"></canvas>
      <div class="save-zoom-cluster">
        <button id="save-zoom-out" class="zoom-btn" title="Zoom out">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
          </svg>
        </button>
        <button id="save-fit" class="zoom-btn" title="Fit all">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/>
          </svg>
        </button>
        <button id="save-zoom-in" class="zoom-btn" title="Zoom in">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"/>
            <line x1="8" y1="11" x2="14" y2="11"/>
            <line x1="11" y1="8" x2="11" y2="14"/>
          </svg>
        </button>
      </div>
    </div>
    <p class="save-preview-hint">Scroll to zoom · drag to pan</p>
  `;

  const actions = `
    <button class="modal-btn modal-btn-secondary" id="modal-close">Close</button>
    <button class="modal-btn modal-btn-secondary" id="save-pdf">Save as PDF</button>
    <button class="modal-btn modal-btn-primary" id="save-png">Save as PNG</button>
  `;

  // Widen the modal for the larger preview before showModal, so it's sized correctly on open
  const appModal = modalContainer.querySelector('.app-modal');
  appModal.classList.add('save-modal-wide');

  showModal('Save Board', '', bodyHTML, actions);

  const previewCanvas = modalContainer.querySelector('.save-preview-canvas');

  const promise = new Promise((resolve) => {
    currentResolve = resolve;

    const done = (choice) => {
      appModal.classList.remove('save-modal-wide');
      closeModal(choice);
    };

    modalContainer.querySelector('#modal-close').onclick = () => done(null);
    modalContainer.querySelector('#save-png').onclick = () => done('png');
    modalContainer.querySelector('#save-pdf').onclick = () => done('pdf');

    // Ensure the wide class is removed on backdrop/X/Escape dismissal too
    currentCleanup = () => {
      appModal.classList.remove('save-modal-wide');
    };
  });

  return { previewCanvas, promise };
}

/**
 * Show keyboard shortcuts help dialog
 */
export function showKeyboardShortcuts() {
  const shortcuts = [
    { category: 'Tools', items: [
      { key: 'V', desc: 'Select tool' },
      { key: 'P', desc: 'Pencil / Freehand' },
      { key: 'H', desc: 'Highlighter' },
      { key: 'L', desc: 'Line tool' },
      { key: 'A', desc: 'Arrow tool' },
      { key: 'R', desc: 'Rectangle tool' },
      { key: 'D', desc: 'Diamond tool' },
      { key: 'Y', desc: 'Triangle tool' },
      { key: 'C', desc: 'Circle tool' },
      { key: 'O', desc: 'Ellipse tool' },
      { key: 'T', desc: 'Text tool' },
      { key: 'S', desc: 'Sticky note' },
      { key: 'G', desc: 'Connector' },
      { key: 'E', desc: 'Eraser (shape)' },
      { key: 'Q', desc: 'Laser pointer' },
    ]},
    { category: 'Actions', items: [
      { key: 'Ctrl+Z', desc: 'Undo', mac: '⌘Z' },
      { key: 'Ctrl+Y', desc: 'Redo', mac: '⌘Y' },
      { key: 'Ctrl+C', desc: 'Copy', mac: '⌘C' },
      { key: 'Ctrl+V', desc: 'Paste', mac: '⌘V' },
      { key: 'Ctrl+D', desc: 'Duplicate', mac: '⌘D' },
      { key: 'Delete', desc: 'Delete selected', mac: '⌫' },
      { key: 'Escape', desc: 'Cancel / Deselect' },
    ]},
    { category: 'Selection', items: [
      { key: 'Shift+Click', desc: 'Multi-select' },
    ]},
    { category: 'Navigation', items: [
      { key: 'Space + Drag', desc: 'Pan canvas' },
      { key: 'Scroll', desc: 'Zoom in/out' },
      { key: '?', desc: 'Show this help' },
    ]},
  ];

  const isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;

  let bodyHTML = '<div class="shortcuts-grid">';

  shortcuts.forEach(section => {
    bodyHTML += `<div class="shortcuts-section">
      <h4>${section.category}</h4>
      <div class="shortcuts-list">`;

    section.items.forEach(item => {
      const keyDisplay = isMac && item.mac ? item.mac : item.key;
      bodyHTML += `<div class="shortcut-item">
        <kbd>${keyDisplay}</kbd>
        <span>${item.desc}</span>
      </div>`;
    });

    bodyHTML += '</div></div>';
  });

  bodyHTML += '</div>';

  const actions = `
    <button class="modal-btn modal-btn-primary" id="modal-close">Got it</button>
  `;

  showModal('Keyboard Shortcuts', 'Quick reference for all available shortcuts', bodyHTML, actions);

  const closeBtn = modalContainer.querySelector('#modal-close');
  closeBtn.onclick = () => closeModal();
}
