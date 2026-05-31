    import { generateRoomId } from './utils.js';
    import { saveBoard, getBoardCount, hasSavedBoards } from './board-history.js';
    import { mintRoomCapability, encodeCapabilityHash } from './room-manager.js';

    // Show My Boards link if user has saved boards
    if (hasSavedBoards()) {
      const myBoardsLink = document.getElementById('my-boards-link');
      const boardCountBadge = document.getElementById('board-count-badge');
      myBoardsLink.style.display = 'flex';
      boardCountBadge.textContent = getBoardCount();
    }

    // Create room handlers
    const createRoom = async () => {
      const roomId = generateRoomId();
      const password = document.getElementById('room-password').value;

      // Save to board history as owner
      saveBoard({
        roomId: roomId,
        roomName: roomId,
        role: 'owner',
        isEncrypted: !!password
      });

      if (password) {
        const cap = await mintRoomCapability(password);
        // The creator is the room OWNER (can rotate/change password); invited
        // collaborators get 'edit'/'view' links from the in-room Invite modal.
        window.location.href = `/room/${roomId}#${encodeCapabilityHash(cap, 'owner')}`;
      } else {
        window.location.href = `/room/${roomId}`;
      }
    };

    document.getElementById('create-room').addEventListener('click', createRoom);
    document.getElementById('create-room-2').addEventListener('click', createRoom);

    // Join modal handlers
    const modal = document.getElementById('join-modal');

    document.getElementById('show-join').addEventListener('click', () => {
      modal.classList.add('active');
      document.getElementById('room-code').focus();
    });

    document.getElementById('close-modal').addEventListener('click', () => {
      modal.classList.remove('active');
    });

    document.querySelector('.modal-backdrop').addEventListener('click', () => {
      modal.classList.remove('active');
    });

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') modal.classList.remove('active');
    });

    // Join room handler
    document.getElementById('join-room').addEventListener('click', () => {
      const raw = document.getElementById('room-code').value.trim();
      if (!raw) {
        document.getElementById('room-code').focus();
        return;
      }

      // Accept either a bare room code (open room) or a full invite link, which
      // carries the capability in the URL hash. Encrypted rooms can ONLY be
      // joined via the link — the signing key is not derivable from a password.
      let target;
      if (raw.includes('/room/')) {
        try {
          const u = raw.startsWith('http') ? new URL(raw) : new URL(raw, window.location.origin);
          target = u.pathname + u.hash;
        } catch {
          target = `/room/${encodeURIComponent(raw)}`;
        }
      } else {
        target = `/room/${encodeURIComponent(raw)}`;
      }

      const roomId = target.replace(/^\/room\//, '').split('#')[0];
      saveBoard({
        roomId,
        roomName: roomId,
        role: 'collaborator',
        isEncrypted: target.includes('#'),
      });

      window.location.href = target;
    });

    document.getElementById('room-code').addEventListener('keypress', (e) => {
      if (e.key === 'Enter') document.getElementById('join-room').click();
    });

    // Animated preview canvas with cursors
    const canvas = document.getElementById('preview-canvas');
    const ctx = canvas.getContext('2d');

    // Polyfill for roundRect
    if (!ctx.roundRect) {
      ctx.roundRect = function(x, y, w, h, r) {
        if (w < 2 * r) r = w / 2;
        if (h < 2 * r) r = h / 2;
        this.beginPath();
        this.moveTo(x + r, y);
        this.arcTo(x + w, y, x + w, y + h, r);
        this.arcTo(x + w, y + h, x, y + h, r);
        this.arcTo(x, y + h, x, y, r);
        this.arcTo(x, y, x + w, y, r);
        this.closePath();
      };
    }

    const shapes = [];

    // Fake collaborators with cursors
    const collaborators = [
      { name: 'Katelyn', color: '#800000', x: 350, y: 80, targetX: 350, targetY: 80, drawing: false, drawProgress: 0 },
      { name: 'Rick', color: '#22c55e', x: 150, y: 180, targetX: 150, targetY: 180, drawing: false, drawProgress: 0 },
      { name: 'Dave', color: '#bf9b30', x: 250, y: 250, targetX: 250, targetY: 250, drawing: false, drawProgress: 0 },
    ];

    // Schedule cursor movements and drawings
    function scheduleAction() {
      const c = collaborators[Math.floor(Math.random() * collaborators.length)];

      if (!c.drawing) {
        // Start drawing - set a new target and begin drawing to it
        c.drawing = true;
        c.drawProgress = 0;
        c.drawStartX = c.x;
        c.drawStartY = c.y;
        c.targetX = 50 + Math.random() * (canvas.width - 100);
        c.targetY = 50 + Math.random() * (canvas.height - 100);
        c.shapeType = Math.random() > 0.6 ? 'line' : Math.random() > 0.5 ? 'circle' : 'rect';
      }
    }

    function drawCursor(x, y, name, color) {
      ctx.save();
      ctx.translate(x, y);

      // Cursor arrow
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.moveTo(0, 0);
      ctx.lineTo(0, 16);
      ctx.lineTo(4, 12);
      ctx.lineTo(8, 20);
      ctx.lineTo(11, 19);
      ctx.lineTo(7, 11);
      ctx.lineTo(12, 11);
      ctx.closePath();
      ctx.fill();

      // Name label
      ctx.font = '500 11px Inter, system-ui, sans-serif';
      const textWidth = ctx.measureText(name).width;
      ctx.fillStyle = color;
      ctx.roundRect(14, 10, textWidth + 10, 18, 4);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillText(name, 19, 22);

      ctx.restore();
    }

    function draw() {
      ctx.fillStyle = '#1a1a2e';
      ctx.fillRect(0, 0, canvas.width, canvas.height);

      // Grid
      ctx.strokeStyle = 'rgba(255,255,255,0.04)';
      ctx.lineWidth = 1;
      for (let x = 0; x < canvas.width; x += 25) {
        ctx.beginPath();
        ctx.moveTo(x, 0);
        ctx.lineTo(x, canvas.height);
        ctx.stroke();
      }
      for (let y = 0; y < canvas.height; y += 25) {
        ctx.beginPath();
        ctx.moveTo(0, y);
        ctx.lineTo(canvas.width, y);
        ctx.stroke();
      }

      // Draw completed shapes
      shapes.forEach(s => {
        s.alpha = Math.min(s.alpha + 0.05, s.targetAlpha);
        ctx.globalAlpha = s.alpha;
        ctx.strokeStyle = s.color;
        ctx.lineWidth = 2.5;

        if (s.type === 'line') {
          ctx.beginPath();
          ctx.moveTo(s.x1, s.y1);
          ctx.lineTo(s.x2, s.y2);
          ctx.stroke();
        } else if (s.type === 'circle') {
          ctx.beginPath();
          ctx.arc(s.cx, s.cy, s.r, 0, Math.PI * 2);
          ctx.stroke();
        } else {
          ctx.strokeRect(s.x, s.y, s.w, s.h);
        }
      });

      ctx.globalAlpha = 1;

      // Update cursors and draw active shapes
      collaborators.forEach(c => {
        if (c.drawing) {
          // Animate cursor toward target
          c.x += (c.targetX - c.x) * 0.06;
          c.y += (c.targetY - c.y) * 0.06;
          c.drawProgress += 0.06;

          // Draw the shape being created (follows cursor)
          ctx.strokeStyle = c.color;
          ctx.lineWidth = 2.5;
          ctx.globalAlpha = 0.9;

          if (c.shapeType === 'line') {
            ctx.beginPath();
            ctx.moveTo(c.drawStartX, c.drawStartY);
            ctx.lineTo(c.x, c.y);
            ctx.stroke();
          } else if (c.shapeType === 'circle') {
            const r = Math.sqrt(Math.pow(c.x - c.drawStartX, 2) + Math.pow(c.y - c.drawStartY, 2));
            ctx.beginPath();
            ctx.arc(c.drawStartX, c.drawStartY, r, 0, Math.PI * 2);
            ctx.stroke();
          } else {
            ctx.strokeRect(c.drawStartX, c.drawStartY, c.x - c.drawStartX, c.y - c.drawStartY);
          }

          ctx.globalAlpha = 1;

          // Finish drawing when close to target
          if (c.drawProgress >= 1) {
            // Save completed shape
            if (c.shapeType === 'line') {
              shapes.push({ type: 'line', x1: c.drawStartX, y1: c.drawStartY, x2: c.x, y2: c.y, color: c.color, alpha: 0.9, targetAlpha: 0.7 });
            } else if (c.shapeType === 'circle') {
              const r = Math.sqrt(Math.pow(c.x - c.drawStartX, 2) + Math.pow(c.y - c.drawStartY, 2));
              shapes.push({ type: 'circle', cx: c.drawStartX, cy: c.drawStartY, r: r, color: c.color, alpha: 0.9, targetAlpha: 0.7 });
            } else {
              shapes.push({ type: 'rect', x: c.drawStartX, y: c.drawStartY, w: c.x - c.drawStartX, h: c.y - c.drawStartY, color: c.color, alpha: 0.9, targetAlpha: 0.7 });
            }
            c.drawing = false;
            if (shapes.length > 10) shapes.shift();
          }
        } else {
          // Idle cursor - gentle floating
          c.x += (c.targetX - c.x) * 0.02;
          c.y += (c.targetY - c.y) * 0.02;
        }

        drawCursor(c.x, c.y, c.name, c.color);
      });

      requestAnimationFrame(draw);
    }

    // Start animations
    setInterval(scheduleAction, 1800);
    setTimeout(() => scheduleAction(), 500);
    setTimeout(() => scheduleAction(), 1200);
    draw();

    // Smooth scroll for nav links
    document.querySelectorAll('a[href^="#"]').forEach(anchor => {
      anchor.addEventListener('click', function (e) {
        e.preventDefault();
        document.querySelector(this.getAttribute('href')).scrollIntoView({
          behavior: 'smooth'
        });
      });
    });
