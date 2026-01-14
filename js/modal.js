// Modal system to replace native prompt/confirm dialogs

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

function closeModal(result = null) {
  const modal = modalContainer.querySelector('.app-modal');
  modal.classList.remove('active');

  if (currentResolve) {
    currentResolve(result);
  }

  currentResolve = null;
}

function showModal(title, description, bodyHTML, actions) {
  initModals();

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
export function showInviteModal(currentLink, isEncrypted, includePassword) {
  return new Promise((resolve) => {
    currentResolve = resolve;

    const bodyHTML = `
      <div class="invite-modal-content">
        <div class="modal-input-group">
          <label>Share Link</label>
          <div class="share-link-row">
            <input type="text" id="modal-share-link" class="modal-input" value="${escapeHtml(currentLink)}" readonly>
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
        <div class="modal-input-group">
          <label class="checkbox-row">
            <input type="checkbox" id="modal-include-password" ${includePassword ? 'checked' : ''}>
            <span>Include password in link</span>
          </label>
        </div>
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
    const includePasswordCheck = modalContainer.querySelector('#modal-include-password');

    // Function to update the link based on selections
    const updateLink = () => {
      const permission = modalContainer.querySelector('input[name="permission"]:checked').value;
      const includePass = includePasswordCheck?.checked || false;

      // Dispatch event to get updated link
      const event = new CustomEvent('update-invite-link', {
        detail: { permission, includePassword: includePass }
      });
      window.dispatchEvent(event);
    };

    permissionRadios.forEach(radio => {
      radio.addEventListener('change', updateLink);
    });

    if (includePasswordCheck) {
      includePasswordCheck.addEventListener('change', updateLink);
    }

    // Listen for link updates
    const linkUpdateHandler = (e) => {
      linkInput.value = e.detail.link;
    };
    window.addEventListener('invite-link-updated', linkUpdateHandler);

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
      window.removeEventListener('invite-link-updated', linkUpdateHandler);
      closeModal({ copied: true, permission });
    };

    cancelBtn.onclick = () => {
      window.removeEventListener('invite-link-updated', linkUpdateHandler);
      closeModal(null);
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

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

/**
 * Show extract text modal with tabs for different groupings
 * @param {Array} texts - Array of text objects with {x, y, text, user, color}
 */
export function showExtractTextModal(texts) {
  return new Promise((resolve) => {
    currentResolve = resolve;

    // Generate text grouped by user
    const userGroups = texts.reduce((groups, text) => {
      if (!groups[text.user]) groups[text.user] = [];
      groups[text.user].push(text.text);
      return groups;
    }, {});

    const byUserOutput = Object.keys(userGroups).map(user =>
      `${user}:\n${userGroups[user].join('\n')}`
    ).join('\n\n');

    // Generate text sorted by position
    const sortedTexts = [...texts].sort((a, b) => {
      if (Math.abs(a.y - b.y) < 20) return a.x - b.x; // Same line threshold
      return a.y - b.y;
    });
    const byPositionOutput = sortedTexts.map(t => t.text).join('\n');

    const bodyHTML = `
      <div class="extract-text-modal">
        <div class="extract-tabs">
          <button class="extract-tab active" data-tab="user">By User</button>
          <button class="extract-tab" data-tab="position">By Position</button>
        </div>
        <div class="extract-tab-content active" data-content="user">
          <textarea class="extract-textarea" readonly>${escapeHtml(byUserOutput)}</textarea>
        </div>
        <div class="extract-tab-content" data-content="position">
          <textarea class="extract-textarea" readonly>${escapeHtml(byPositionOutput)}</textarea>
        </div>
      </div>
    `;

    const actions = `
      <button class="modal-btn modal-btn-secondary" id="modal-close">Close</button>
      <button class="modal-btn modal-btn-primary" id="modal-copy">Copy to Clipboard</button>
    `;

    showModal('Extracted Text', `Found ${texts.length} text item${texts.length !== 1 ? 's' : ''}`, bodyHTML, actions);

    // Wire up tab switching
    const tabs = modalContainer.querySelectorAll('.extract-tab');
    const contents = modalContainer.querySelectorAll('.extract-tab-content');

    tabs.forEach(tab => {
      tab.addEventListener('click', () => {
        const tabName = tab.dataset.tab;

        // Update active tab
        tabs.forEach(t => t.classList.remove('active'));
        tab.classList.add('active');

        // Update active content
        contents.forEach(c => {
          c.classList.toggle('active', c.dataset.content === tabName);
        });
      });
    });

    // Wire up buttons
    const closeBtn = modalContainer.querySelector('#modal-close');
    const copyBtn = modalContainer.querySelector('#modal-copy');

    closeBtn.onclick = () => {
      closeModal(null);
    };

    copyBtn.onclick = () => {
      // Get the currently visible textarea
      const activeContent = modalContainer.querySelector('.extract-tab-content.active textarea');
      navigator.clipboard.writeText(activeContent.value);

      // Show copied feedback
      copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        copyBtn.textContent = 'Copy to Clipboard';
      }, 2000);
    };
  });
}

/**
 * Show keyboard shortcuts help dialog
 */
export function showKeyboardShortcuts() {
  const shortcuts = [
    { category: 'Tools', items: [
      { key: 'V', desc: 'Select tool' },
      { key: 'P', desc: 'Pencil / Freehand' },
      { key: 'L', desc: 'Line tool' },
      { key: 'R', desc: 'Rectangle tool' },
      { key: 'C', desc: 'Circle tool' },
      { key: 'T', desc: 'Text tool' },
      { key: 'E', desc: 'Eraser (shape)' },
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
