// Application bootstrap
// Solver constants must be available to async solver outside init()
const SOLVER_TICK_MS = 200; // time-based UI update cadence in ms
const SOLVER_YIELD_NODES = 0; // 0 disables node-based yields

function init() {
  // Constants
  const BOARD_SIZE = 36;
  const COLORS = ['#f87171','#fbbf24','#34d399','#60a5fa','#c084fc','#f472b6','#a78bfa','#facc15'];
  const GRID_COLOR = '#334155';
  const TILE_BORDER_COLOR = '#0b1220';
  const DRAG_THRESHOLD_PX = 5;
  const THUMB_UNIT = 20; // px per size unit in inventory
  const ZOOM_MIN = 0.3;
  const ZOOM_MAX = 2;
  const DEBUG = /[?&#]debug=1/i.test(location.href) || localStorage.getItem('SQ_DEBUG') === '1';

  class Piece {
    constructor(id, size) {
      this.id = id;
      this.size = size;
      this.x = 0;
      this.y = 0;
      this.placed = false;
      this.fixed = false;
      this.w = size;
      this.h = size;
    }
  }

  class Board {
    constructor(size) {
      this.size = size;
      this.cells = Array.from({ length: size }, () => Array(size).fill(0));
      this.filled = 0;
    }
    clear() {
      for (const row of this.cells) row.fill(0);
      this.filled = 0;
    }
    inBounds(x, y, s) {
      return x >= 0 && y >= 0 && x + s <= this.size && y + s <= this.size;
    }
    overlap(x, y, s) {
      for (let j = 0; j < s; j++) {
        for (let i = 0; i < s; i++) {
          if (this.cells[y + j][x + i]) return true;
        }
      }
      return false;
    }
    place(piece, x, y) {
      for (let j = 0; j < piece.size; j++) {
        for (let i = 0; i < piece.size; i++) {
          this.cells[y + j][x + i] = piece.id;
        }
      }
      this.filled += piece.size * piece.size;
    }
    remove(piece) {
      for (let j = 0; j < piece.size; j++) {
        for (let i = 0; i < piece.size; i++) {
          this.cells[piece.y + j][piece.x + i] = 0;
        }
      }
      this.filled -= piece.size * piece.size;
    }
  }

  function createInventory() {
    const arr = [];
    let id = 1;
    for (let size = 1; size <= 8; size++) {
      for (let n = 0; n < size; n++) {
        arr.push(new Piece(id++, size));
      }
    }
    return arr;
  }

  function canPlace(board, piece, x, y) {
    return board.inBounds(x, y, piece.size) && !board.overlap(x, y, piece.size);
  }

  class GameState {
    constructor() {
      this.board = new Board(BOARD_SIZE);
      this.inventory = createInventory();
      // Grid always shown
      this.preview = null;
      this.undo = [];
      this.redo = [];
      this.solving = false;
      this.solverPreview = null; // [{x,y,size}]
      this._cancelSolve = null;
      this.autoFillUsed = false;
      this.congratsShown = false;
    }
    hardReset() {
      // Remove everything including givens
      this.board.clear();
      for (const p of this.inventory) {
        p.x = 0; p.y = 0; p.placed = false; p.fixed = false;
      }
      this.preview = null;
      this.undo = [];
      this.redo = [];
      this.autoFillUsed = false;
      this.congratsShown = false;
      this.creatorMode = false;
    }
    reset() {
      const hasFixed = this.inventory.some((p) => p.fixed);
      this.board.clear();
      for (const p of this.inventory) {
        if (hasFixed && p.fixed && p.placed) continue; // preserve givens
        p.x = 0;
        p.y = 0;
        p.placed = false;
      }
      // Reapply fixed pieces onto cleared board
      if (hasFixed) {
        for (const p of this.inventory) if (p.fixed && p.placed) this.board.place(p, p.x, p.y);
      }
      this.preview = null;
      this.undo = [];
      this.redo = [];
      this.congratsShown = false;
    }
    pushStep(step) {
      this.undo.push(step);
      this.redo.length = 0;
    }
    undoStep() {
      const step = this.undo.pop();
      if (!step) return;
      const applySingle = (s) => {
        const p = this.inventory.find((x) => x.id === s.pieceId);
        if (s.toPlaced) this.board.remove(p);
        p.x = s.fromX;
        p.y = s.fromY;
        p.placed = s.fromPlaced;
        if (s.fromPlaced) this.board.place(p, p.x, p.y);
      };
      if (step.batch && Array.isArray(step.steps)) {
        for (let i = step.steps.length - 1; i >= 0; i--) applySingle(step.steps[i]);
      } else {
        applySingle(step);
      }
      this.redo.push(step);
    }
  }

  class Renderer {
    constructor(canvas, state) {
      this.canvas = canvas;
      this.ctx = canvas.getContext('2d');
      this.state = state;
      this.cellSize = Math.floor(canvas.width / BOARD_SIZE);
      this.scale = 1;
      this.needsDraw = false;
      this.resize();
      window.addEventListener('resize', () => this.resize());
    }
    setScale(s) {
      this.scale = s;
      this.canvas.style.width = `${this.canvas.width * s}px`;
      this.canvas.style.height = `${this.canvas.height * s}px`;
    }
    resize() {
      this.cellSize = Math.floor(this.canvas.width / BOARD_SIZE);
      this.requestDraw();
    }
    requestDraw() {
      if (this.needsDraw) return;
      this.needsDraw = true;
      requestAnimationFrame(() => this.draw());
    }
    draw() {
      const ctx = this.ctx;
      const cs = this.cellSize;
      const sizePx = BOARD_SIZE * cs;
      // Background
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, sizePx, sizePx);

      // Layers
      drawGrid(ctx, BOARD_SIZE, cs, sizePx);
      drawPlacedTiles(ctx, this.state, cs);
      drawSolverPreview(ctx, this.state, cs);
      drawPlacementPreview(ctx, this.state.preview, cs);

      this.needsDraw = false;
    }
  }

  // ---- Render helpers (kept in this file for single-file build) ----
  function drawGrid(ctx, boardSize, cs, sizePx) {
    ctx.save();
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    for (let i = 0; i <= boardSize; i++) {
      const p = i * cs;
      ctx.beginPath();
      ctx.moveTo(p, 0);
      ctx.lineTo(p, sizePx);
      ctx.moveTo(0, p);
      ctx.lineTo(sizePx, p);
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawPlacedTiles(ctx, state, cs) {
    for (const piece of state.inventory) {
      if (!piece.placed) continue;
      const x = piece.x * cs;
      const y = piece.y * cs;
      const w = piece.size * cs;
      const h = piece.size * cs;
      const base = COLORS[(piece.size - 1) % COLORS.length];
      ctx.fillStyle = piece.fixed ? darkenHex(base, 0.75) : base;
      ctx.fillRect(x, y, w, h);
      ctx.save();
      ctx.lineWidth = 1;
      if (piece.fixed) {
        ctx.setLineDash([3, 3]);
        ctx.strokeStyle = '#ffffff';
      } else {
        ctx.strokeStyle = TILE_BORDER_COLOR;
      }
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
      const label = String(piece.size * piece.size);
      drawCenteredLabel(ctx, label, x, y, w, h);
      ctx.restore();
    }
  }

  function drawSolverPreview(ctx, state, cs) {
    if (!state.solverPreview || !state.solverPreview.length) return;
    ctx.save();
    for (const g of state.solverPreview) {
      const x = g.x * cs;
      const y = g.y * cs;
      const w = g.size * cs;
      const h = g.size * cs;
      const base = COLORS[(g.size - 1) % COLORS.length];
      ctx.fillStyle = hexToRgba(base, 0.35);
      ctx.fillRect(x, y, w, h);
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 3]);
      ctx.strokeStyle = '#94a3b8';
      ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
    }
    ctx.restore();
  }

  function drawPlacementPreview(ctx, preview, cs) {
    if (!preview) return;
    ctx.save();
    ctx.fillStyle = preview.valid ? 'rgba(34,197,94,.5)' : 'rgba(239,68,68,.5)';
    ctx.fillRect(preview.x * cs, preview.y * cs, preview.piece.size * cs, preview.piece.size * cs);
    ctx.restore();
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map((c)=>c+c).join('') : h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${alpha})`;
  }

  function parseHex(hex) {
    const h = hex.replace('#', '').toLowerCase();
    const full = h.length === 3 ? h.split('').map((c) => c + c).join('') : h;
    const bigint = parseInt(full, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return { r, g, b };
  }
  function toHex(r, g, b) {
    const c = (v) => v.toString(16).padStart(2, '0');
    return `#${c(r)}${c(g)}${c(b)}`;
  }
  function darkenHex(hex, factor) {
    const { r, g, b } = parseHex(hex);
    const f = Math.max(0, Math.min(1, factor));
    const rr = Math.max(0, Math.min(255, Math.round(r * f)));
    const gg = Math.max(0, Math.min(255, Math.round(g * f)));
    const bb = Math.max(0, Math.min(255, Math.round(b * f)));
    return toHex(rr, gg, bb);
  }

  function drawCenteredLabel(ctx, text, x, y, w, h) {
    const size = Math.max(10, Math.min(w, h) * 0.45);
    ctx.save();
    // Ensure text outline is solid (not dashed)
    if (ctx.setLineDash) ctx.setLineDash([]);
    ctx.font = `${size}px system-ui, -apple-system, Segoe UI, Roboto, Ubuntu`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    const cx = x + w / 2;
    const cy = y + h / 2;
    // Outline for contrast
    ctx.lineWidth = Math.max(1, Math.floor(size / 10));
    ctx.strokeStyle = 'rgba(0,0,0,0.6)';
    ctx.strokeText(text, cx, cy);
    ctx.fillStyle = '#e5e7eb';
    ctx.fillText(text, cx, cy);
    ctx.restore();
  }

  // Pointer utilities
  function toCanvasCoords(canvas, e) {
    const rect = canvas.getBoundingClientRect();
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = (e.clientX - rect.left) * scaleX;
    const cy = (e.clientY - rect.top) * scaleY;
    return { cx, cy };
  }

  // Status formatting removed (no Filled/Overlap in status line)
  function formatStatus(_overlap) {
    return '';
  }

  class DragController {
    constructor(canvas, state, renderer, statusCb, invCb) {
      this.canvas = canvas;
      this.state = state;
      this.renderer = renderer;
      this.statusCb = statusCb;
      this.inventoryCb = invCb;
      this.active = null;
      this.offsetX = 0;
      this.offsetY = 0;
      this.origX = 0;
      this.origY = 0;
      this.wasPlaced = false;
      canvas.addEventListener('pointerdown', (e) => this.onCanvasDown(e));
      // no custom panning; rely on native when not dragging
      // Right-click to put a tile back into inventory
      canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));
      // Some browsers fire auxclick/pointerdown with button===2 instead of contextmenu
      canvas.addEventListener('auxclick', (e) => this.onAuxClick(e));
      canvas.addEventListener('pointerdown', (e) => {
        if (e.button === 2) this.onAuxClick(e);
      });
    }
    start(piece, px, py) {
      this.active = piece;
      this.origX = piece.x;
      this.origY = piece.y;
      this.wasPlaced = piece.placed;
      document.body.classList.add('dragging');
      // Install overlay to swallow touch scroll/gestures during drag
      if (!this.overlayEl) {
        const ov = document.createElement('div');
        ov.className = 'drag-overlay';
        // Prevent default on any pointer/touch on the overlay
        ov.addEventListener('touchmove', (ev) => { if (ev.cancelable) ev.preventDefault(); }, { passive: false });
        ov.addEventListener('pointermove', (ev) => { if (ev.cancelable) ev.preventDefault(); });
        ov.addEventListener('wheel', (ev) => { ev.preventDefault(); }, { passive: false });
        document.body.appendChild(ov);
        this.overlayEl = ov;
      }
      if (piece.placed) this.state.board.remove(piece);
      piece.placed = false;
      this.offsetX = px;
      this.offsetY = py;
      const move = (ev) => this.onMove(ev);
      const up = (ev) => this.onUp(ev, move, up);
      window.addEventListener('pointermove', move);
      window.addEventListener('pointerup', up);
      window.addEventListener('pointercancel', up);
    }
    onCanvasDown(e) {
      if (this.state.solving) return; // block interactions during auto-fill
      const cs = this.renderer.cellSize;
      const { cx, cy } = toCanvasCoords(this.canvas, e);
      const x = Math.floor(cx / cs);
      const y = Math.floor(cy / cs);
      const piece = this.state.inventory.find(
        (p) => p.placed && !p.fixed && x >= p.x && x < p.x + p.size && y >= p.y && y < p.y + p.size
      );
      if (!piece) return; // touching empty grid: allow native panning
      const px = cx - piece.x * cs;
      const py = cy - piece.y * cs;
      // Start drag immediately when touching a piece (prevents page panning)
      e.preventDefault();
      try { this.canvas.setPointerCapture && this.canvas.setPointerCapture(e.pointerId); } catch {}
      this.start(piece, px, py);
    }
    onContextMenu(e) {
      if (this.state.solving) return; // block interactions during auto-fill
      e.preventDefault();
      this.removePieceAtEvent(e);
    }
    onAuxClick(e) {
      if (this.state.solving) return;
      if (e.button !== undefined && e.button !== 2) return;
      e.preventDefault();
      this.removePieceAtEvent(e);
    }
    removePieceAtEvent(e) {
      const cs = this.renderer.cellSize;
      const { cx, cy } = toCanvasCoords(this.canvas, e);
      const x = Math.floor(cx / cs);
      const y = Math.floor(cy / cs);
      const piece = this.state.inventory.find(
        (p) => p.placed && !p.fixed && x >= p.x && x < p.x + p.size && y >= p.y && y < p.y + p.size
      );
      if (!piece) return;
      this.state.board.remove(piece);
      const fromX = piece.x, fromY = piece.y;
      piece.placed = false;
      this.state.pushStep({
        pieceId: piece.id,
        fromX, fromY,
        fromPlaced: true,
        toX: 0,
        toY: 0,
        toPlaced: false,
      });
      this.inventoryCb();
      this.statusCb(false);
      clearSolveStatus();
      this.renderer.requestDraw();
    }
    startFromInventory(piece, e) {
      if (this.state.solving) return; // block interactions during auto-fill
      const cs = this.renderer.cellSize;
      const px = (piece.size * cs) / 2;
      const py = (piece.size * cs) / 2;
      this.start(piece, px, py);
      this.onMove(e);
    }
    onMove(e) {
      if (!this.active) return;
      if (e.pointerType === 'touch' && e.cancelable) e.preventDefault();
      const cs = this.renderer.cellSize;
      const { cx, cy } = toCanvasCoords(this.canvas, e);
      const px = cx - this.offsetX;
      const py = cy - this.offsetY;
      const bx = Math.round(px / cs);
      const by = Math.round(py / cs);
      const valid = canPlace(this.state.board, this.active, bx, by);
      this.state.preview = { piece: this.active, x: bx, y: by, valid };
      this.statusCb(!valid);
      this.renderer.requestDraw();
    }
    onUp(_e, move, up) {
      if (!this.active) return;
      document.body.classList.remove('dragging');
       if (this.overlayEl) {
         try { this.overlayEl.remove(); } catch {}
         this.overlayEl = null;
       }
      try { this.canvas.releasePointerCapture && this.canvas.releasePointerCapture(_e.pointerId); } catch {}
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      const pr = this.state.preview;
      const piece = this.active;
      this.state.preview = null;
      if (pr && pr.valid) {
        piece.x = pr.x;
        piece.y = pr.y;
        piece.placed = true;
        this.state.board.place(piece, pr.x, pr.y);
        this.state.pushStep({
          pieceId: piece.id,
          fromX: this.origX,
          fromY: this.origY,
          fromPlaced: this.wasPlaced,
          toX: piece.x,
          toY: piece.y,
          toPlaced: true
        });
        clearSolveStatus();
      } else if (pr && !this.state.board.inBounds(pr.x, pr.y, piece.size) && this.wasPlaced) {
        // Dropped outside the board: return to inventory if it was previously placed
        piece.placed = false;
        this.state.pushStep({
          pieceId: piece.id,
          fromX: this.origX,
          fromY: this.origY,
          fromPlaced: true,
          toX: 0,
          toY: 0,
          toPlaced: false,
        });
        clearSolveStatus();
      } else {
        // Invalid placement (overlap or out-of-bounds from inventory): revert
        piece.x = this.origX;
        piece.y = this.origY;
        piece.placed = this.wasPlaced;
        if (this.wasPlaced) this.state.board.place(piece, piece.x, piece.y);
      }
      this.active = null;
      this.inventoryCb();
      this.statusCb(false);
      this.renderer.requestDraw();
    }
  }

  const canvas = document.getElementById('board');
  const invEl = document.getElementById('inventory');
  const solveStatusEl = document.getElementById('solveStatus');
  const progressEl = document.getElementById('progress');
  const newBtn = document.getElementById('newBtn');
  const clearBtn = document.getElementById('clearBtn');
  const undoBtn = document.getElementById('undoBtn');
  const solveBtn = document.getElementById('solveBtn');
  const shareBtn = document.getElementById('shareBtn');
  const checkBtn = document.getElementById('checkBtn');
  const unfixBtn = document.getElementById('unfixBtn');
  const zoomInput = document.getElementById('zoom');
  const congratsEl = document.getElementById('congrats');
  const congratsCloseBtn = document.getElementById('congratsClose');

  const state = new GameState();
  state.creatorMode = false;
  const renderer = new Renderer(canvas, state);
  const versionEl = document.getElementById('version');
  if (versionEl) {
    const ver = window.__APP_VERSION__ || 'dev';
    versionEl.textContent = `${ver}`;
  }
  function dbg(...args) { if (DEBUG) { console.log('[AutoFill]', ...args); } }

  function updateStatus(_overlap) {
    progressEl.textContent = `${state.board.filled}/1296`;
    if (solveStatusEl && !state.solving) solveStatusEl.textContent = '';
    checkCompletion();
  }

  function clearSolveStatus() {
    if (solveStatusEl && !state.solving) solveStatusEl.textContent = '';
  }

  // --- Congratulations overlay ---
  function showCongrats() {
    if (!congratsEl) return;
    congratsEl.classList.add('show');
    congratsEl.setAttribute('aria-hidden', 'false');
  }
  function hideCongrats() {
    if (!congratsEl) return;
    congratsEl.classList.remove('show');
    congratsEl.setAttribute('aria-hidden', 'true');
  }
  function checkCompletion() {
    const total = BOARD_SIZE * BOARD_SIZE;
    if (state.solving) return; // don't show while solving
    if (state.board.filled >= total) {
      if (!state.creatorMode && !state.congratsShown) {
        showCongrats();
        state.congratsShown = true;
      }
    } else {
      hideCongrats();
      state.congratsShown = false;
    }
  }
  if (congratsEl) {
    congratsEl.addEventListener('click', (e) => {
      if (e.target === congratsEl) hideCongrats();
    });
  }
  if (congratsCloseBtn) congratsCloseBtn.addEventListener('click', () => hideCongrats());

  // ---- Puzzle (givens) parsing/generation ----
  const BASE36 = '0123456789abcdefghijklmnopqrstuvwxyz';
  function b36ToIntChar(ch) { const i = BASE36.indexOf(String(ch).toLowerCase()); return i >= 0 ? i : -1; }
  function isSizeChar(ch) { return ch >= '1' && ch <= '8'; }
  function parsePuzzleString(s) {
    const out = [];
    if (!s) return out;
    const str = s.trim();
    if (str.length % 3 !== 0) throw new Error('length must be multiple of 3');
    for (let i = 0; i < str.length; i += 3) {
      const sz = str[i]; const xch = str[i + 1]; const ych = str[i + 2];
      if (!isSizeChar(sz)) throw new Error(`bad size '${sz}' at ${i}`);
      const size = parseInt(sz, 10);
      const x = b36ToIntChar(xch), y = b36ToIntChar(ych);
      if (x < 0 || y < 0) throw new Error(`bad coord at ${i + 1}`);
      out.push({ size, x, y });
    }
    return out;
  }
  function toPuzzleString(items) {
    let s = '';
    for (const it of items) {
      const x = BASE36[it.x]; const y = BASE36[it.y];
      if (x == null || y == null) continue;
      s += String(it.size) + x + y;
    }
    return s;
  }
  function applyPuzzleFromQuery() {
    const u = new URL(window.location.href);
    const q = u.searchParams.get('p') || u.searchParams.get('q');
    if (!q) return;
    let items;
    try { items = parsePuzzleString(q); }
    catch (err) { if (solveStatusEl) solveStatusEl.textContent = `Puzzle error: ${err.message}`; return; }
    // Validate counts
    const need = new Map();
    for (const it of items) need.set(it.size, (need.get(it.size) || 0) + 1);
    for (const [size, cnt] of need) {
      const avail = state.inventory.filter((p) => p.size === size).length;
      if (cnt > avail) { if (solveStatusEl) solveStatusEl.textContent = `Puzzle error: need ${cnt} of size ${size}`; return; }
    }
    // Place and lock
    for (const it of items) {
      if (!state.board.inBounds(it.x, it.y, it.size) || state.board.overlap(it.x, it.y, it.size)) {
        if (solveStatusEl) solveStatusEl.textContent = 'Puzzle error: overlap';
        // rollback
        for (const p of state.inventory) if (p.fixed) { p.fixed = false; p.placed = false; }
        state.board.clear();
        return;
      }
      const piece = state.inventory.find((p) => p.size === it.size && !p.placed);
      if (!piece) { if (solveStatusEl) solveStatusEl.textContent = 'Puzzle error: allocation'; return; }
      piece.x = it.x; piece.y = it.y; piece.placed = true; piece.fixed = true;
      state.board.place(piece, it.x, it.y);
    }
    if (solveStatusEl) solveStatusEl.textContent = `Puzzle mode: ${items.length} givens`;
  }
  function collectFixedPieces() {
    const out = [];
    for (const p of state.inventory) if (p.fixed && p.placed) out.push({ size: p.size, x: p.x, y: p.y });
    return out;
  }
  function collectPlacedPieces() {
    const out = [];
    for (const p of state.inventory) if (p.placed) out.push({ size: p.size, x: p.x, y: p.y });
    return out;
  }

  function renderInventory() {
    invEl.innerHTML = '';
    for (let size = 1; size <= 8; size++) {
      const remain = state.inventory.filter((p) => p.size === size && !p.placed).length;
      const div = document.createElement('div');
      div.className = 'piece-thumb';
      div.dataset.size = String(size);
      const thumb = document.createElement('canvas');
      const t = THUMB_UNIT;
      thumb.width = size * t;
      thumb.height = size * t;
      const ictx = thumb.getContext('2d');
      ictx.fillStyle = COLORS[(size - 1) % COLORS.length];
      ictx.fillRect(0, 0, size * t, size * t);
      // Label with area (size^2)
      const w = size * t;
      const h = size * t;
      const label = String(size * size);
      drawCenteredLabel(ictx, label, 0, 0, w, h);
      div.appendChild(thumb);
      const span = document.createElement('span');
      span.textContent = `x${remain}`;
      div.appendChild(span);
      if (remain > 0) {
        // listeners are delegated on #inventory
      }
      invEl.appendChild(div);
    }
  }

  const drag = new DragController(canvas, state, renderer, updateStatus, renderInventory);
  let inventoryDragActive = false;

  // Delegate click on inventory for reliable tap-to-place across browsers
  invEl.addEventListener('click', (e) => {
    const el = e.target.closest('.piece-thumb');
    if (!el) return;
    if (state.solving || inventoryDragActive) return;
    const size = parseInt(el.dataset.size || '0', 10);
    if (!size) return;
    e.preventDefault();
    autoPlaceRandomFit(state, size);
    renderInventory();
    renderer.requestDraw();
    updateStatus(false);
    clearSolveStatus();
  });

  // Delegate pointerdown on inventory to start drag after threshold
  invEl.addEventListener('pointerdown', (e) => {
    if (state.solving) return;
    const thumb = e.target.closest('.piece-thumb');
    if (!thumb) return;
    const size = parseInt(thumb.dataset.size || '0', 10);
    if (!size) return;
    const startX = e.clientX;
    const startY = e.clientY;
    let started = false;
    const move = (ev) => {
      const dx = ev.clientX - startX;
      const dy = ev.clientY - startY;
      if (!started && (Math.abs(dx) > DRAG_THRESHOLD_PX || Math.abs(dy) > DRAG_THRESHOLD_PX)) {
        started = true;
        inventoryDragActive = true;
        const piece = state.inventory.find((p) => p.size === size && !p.placed);
        if (piece) drag.startFromInventory(piece, ev);
      }
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      window.removeEventListener('pointercancel', up);
      setTimeout(() => { inventoryDragActive = false; }, 0);
    };
    window.addEventListener('pointermove', move, { passive: true });
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', up);
  });

  newBtn.addEventListener('click', () => {
    if (state.solving) return;
    const ok = window.confirm('Start a new puzzle? This removes all givens and placements.');
    if (!ok) return;
    state.hardReset();
    // Exit Creator Mode UI on New
    if (creatorBtn) {
      creatorBtn.disabled = false;
      creatorBtn.classList.remove('active');
      creatorBtn.removeAttribute('aria-pressed');
    }
    if (shareBtn) shareBtn.hidden = true;
    if (solveBtn) solveBtn.hidden = true;
    if (checkBtn) checkBtn.hidden = true;
    if (unfixBtn) unfixBtn.hidden = true;
    renderInventory();
    renderer.requestDraw();
    updateStatus(false);
    if (solveStatusEl) solveStatusEl.textContent = '';
    hideCongrats();
  });

  if (clearBtn) {
    clearBtn.addEventListener('click', () => {
      if (state.solving) return;
      const steps = [];
      for (const p of state.inventory) {
        if (p.placed && !p.fixed) {
          state.board.remove(p);
          steps.push({ pieceId: p.id, fromX: p.x, fromY: p.y, fromPlaced: true, toX: 0, toY: 0, toPlaced: false });
          p.placed = false;
        }
      }
      if (steps.length) state.pushStep({ batch: true, steps });
      renderInventory();
      renderer.requestDraw();
      updateStatus(false);
      clearSolveStatus();
      hideCongrats();
    });
  }

  if (shareBtn) {
    shareBtn.addEventListener('click', async () => {
      const items = collectPlacedPieces();
      const ps = toPuzzleString(items);
      const url = new URL(window.location.href);
      if (ps) url.searchParams.set('p', ps); else url.searchParams.delete('p');
      const str = url.toString();
      try { await navigator.clipboard.writeText(str); if (solveStatusEl) solveStatusEl.textContent = 'Link copied'; }
      catch { if (solveStatusEl) solveStatusEl.textContent = str; }
    });
  }

  // Creator Mode: reveal Share, Auto-Fill, Check; cannot be turned off
  if (creatorBtn) {
    creatorBtn.addEventListener('click', () => {
      if (state.creatorMode) return;
      state.creatorMode = true;
      creatorBtn.disabled = true;
      creatorBtn.classList.add('active');
      creatorBtn.setAttribute('aria-pressed', 'true');
      if (solveStatusEl) solveStatusEl.textContent = 'Creator Mode enabled';
      if (shareBtn) shareBtn.hidden = false;
      if (solveBtn) solveBtn.hidden = false;
      if (checkBtn) checkBtn.hidden = false;
      if (unfixBtn) unfixBtn.hidden = false;
      // Entering creator mode disables congrats condition going forward
      hideCongrats();
      updateStatus(false);
    });
  }

  if (checkBtn) {
    checkBtn.addEventListener('click', async () => {
      if (state.solving) return;
      if (solveStatusEl) solveStatusEl.textContent = 'Check: running…';
      try {
        const { count } = await countSolutionsAsync(state, 2, (stats) => {
          if (solveStatusEl) solveStatusEl.textContent = `Check: exploring… nodes ${stats.nodes}`;
        });
        if (count === 0) {
          if (solveStatusEl) solveStatusEl.textContent = 'Check: no solution.';
        } else if (count === 1) {
          if (solveStatusEl) solveStatusEl.textContent = 'Check: unique solution.';
        } else {
          if (solveStatusEl) solveStatusEl.textContent = 'Check: multiple solutions.';
        }
      } catch (err) {
        if (solveStatusEl) solveStatusEl.textContent = 'Check: error (see console).';
        console.error('[check] error', err);
      }
    });
  }

  if (unfixBtn) {
    unfixBtn.addEventListener('click', () => {
      let changed = false;
      for (const p of state.inventory) {
        if (p.fixed) { p.fixed = false; changed = true; }
      }
      if (changed && solveStatusEl) solveStatusEl.textContent = 'Givens converted to normal pieces';
      renderer.requestDraw();
    });
  }

  undoBtn.addEventListener('click', () => {
    state.undoStep();
    renderInventory();
    renderer.requestDraw();
    updateStatus(false);
    clearSolveStatus();
  });

  // Grid toggle removed; grid always visible

  solveBtn.addEventListener('click', async () => {
    if (state.solving) {
      if (state._cancelSolve) state._cancelSolve();
      if (solveStatusEl) solveStatusEl.textContent = 'Auto-Fill cancelling…';
      return;
    }
    state.autoFillUsed = true;
    state.solving = true;
    document.body.classList.add('solving');
    solveBtn.textContent = 'Cancel';
    dbg('start');
    let out = { ok: false, reason: 'cancel' };
    try {
      // Pick best symmetry transform to normalize pre-filled board
      const tf = chooseBestTransform(state.board);
      if (DEBUG) dbg('transform', { rot: tf.rot, rotDeg: tf.rot * 90, mirror: tf.mirror, sum: tf.sum });
      // Build a working state in transformed space
      const work = buildTransformedState(state, tf);
      // Wire cancel from UI state to working solver state
      state._cancelSolve = () => { if (work._cancelSolve) work._cancelSolve(); };
      out = await solveRemainingAsync(work, (stats, preview) => {
        // Map preview blocks back to UI space (use inverse-corners min)
        const mapped = preview.map(p => { const t = invRectTopLeft(tf, p.x, p.y, p.size); return { x: t.x, y: t.y, size: p.size }; });
        state.solverPreview = mapped;
        const nodes = Number(stats.nodes).toLocaleString('en-US');
        if (solveStatusEl) solveStatusEl.textContent = `Auto-Fill: Nodes ${nodes} • Depth ${stats.depth} • Placed ${mapped.length}`;
        renderer.requestDraw();
        if (DEBUG) dbg('tick', { nodes: stats.nodes, depth: stats.depth, placed: preview.length });
      }, DEBUG ? (type, payload) => dbg(type, payload) : null);
      // Apply solution from work state back to UI state
      if (out.ok) applySolutionFromWork(state, work, tf);
    } catch (err) {
      dbg('error', err);
      if (solveStatusEl) solveStatusEl.textContent = 'Auto-Fill error (see console).';
    } finally {
      state.solving = false;
      state.solverPreview = null;
      document.body.classList.remove('solving');
      solveBtn.textContent = 'Auto-Fill';
      dbg('done', out);
    }
    if (!out.ok) {
      if (solveStatusEl) solveStatusEl.textContent = out.reason === 'cancel' ? 'Auto-Fill cancelled.' : 'No solution found.';
    } else {
      renderInventory();
      renderer.requestDraw();
      updateStatus(false);
      if (solveStatusEl) solveStatusEl.textContent = 'Auto-Fill completed.';
    }
  });

  zoomInput.addEventListener('input', (e) => {
    const z = parseFloat(e.target.value);
    renderer.setScale(z);
  });

  // Auto scale on window changes so content fits the page
  function autoScaleToFit() {
    const portrait = window.matchMedia('(orientation: portrait)').matches || window.innerHeight > window.innerWidth;
    const mainEl = document.querySelector('main.main');
    const inv = document.getElementById('inventory');
    const header = document.querySelector('header.app-header');
    const footer = document.getElementById('status');
    const gs = window.getComputedStyle(mainEl);
    const padX = (parseFloat(gs.paddingLeft) || 0) + (parseFloat(gs.paddingRight) || 0);
    const padY = (parseFloat(gs.paddingTop) || 0) + (parseFloat(gs.paddingBottom) || 0);
    const gap = parseFloat(gs.gap) || 0;
    const canvasBaseW = canvas.width;
    const canvasBaseH = canvas.height;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const headerH = header?.offsetHeight || 0;
    const footerH = footer?.offsetHeight || 0;
    // Safety margin and vertical paddings to prevent clipping of the last row
    const SAFE = 8; // px
    const availH = Math.max(200, viewportH - headerH - footerH - padY - SAFE);

    let sW;
    if (portrait) {
      const availW = Math.max(240, viewportW - padX);
      sW = availW / canvasBaseW;
    } else {
      const invW = inv?.offsetWidth || 160; // fallback
      const availW = Math.max(240, viewportW - padX - gap - invW);
      sW = availW / canvasBaseW;
    }
    const sH = availH / canvasBaseH;
    // Slight deflate to reduce the risk of rounding-induced clipping
    const scale = clamp(Math.min(sW, sH) * 0.995, ZOOM_MIN, ZOOM_MAX);
    renderer.setScale(scale);
    zoomInput.value = String(scale);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  window.addEventListener('resize', autoScaleToFit, { passive: true });
  window.addEventListener('orientationchange', autoScaleToFit);
  autoScaleToFit();
  // Load puzzle givens from URL (optional)
  applyPuzzleFromQuery();
  
  renderInventory();
  renderer.requestDraw();
  updateStatus(false);
}

// Auto-start when included as a module or plain script at the end of body
  init();

// -------------------- Solver --------------------
// Async variant with periodic preview updates
async function solveRemainingAsync(state, onTick, debugLog) {
  const size = state.board.size;
  const cells = state.board.cells.map((row) => row.slice());
  // Build available pools by size and a randomized size order
  const available = new Map();
  for (let s = 1; s <= 8; s++) available.set(s, []);
  for (const p of state.inventory) if (!p.placed) available.get(p.size).push(p);
  const baseSizes = [...available.keys()].filter((s) => (available.get(s) || []).length > 0);
  shuffleInPlace(baseSizes);
  const maxPlacements = [...available.values()].reduce((n, arr) => n + (arr?.length || 0), 0);
  const sizeOrders = Array.from({ length: Math.max(1, maxPlacements) }, () => shuffleInPlace([...baseSizes]));

  const placements = []; // {pieceId,x,y,size}
  const stats = { nodes: 0, depth: 0 };
  let lastTick = 0;
  let cancelled = false;
  state._cancelSolve = () => { cancelled = true; };
  // Initial tick so UI shows activity immediately
  onTick?.({ nodes: 0, depth: 0 }, []);
  await sleep(0);

  // Debug: sequence length of attempted piece areas (size^2)
  const attemptSeq = [];

  // Simple scan: choose the first empty cell (row-major)
  function findNextEmpty(startingRow) {
    for (let y = startingRow; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (cells[y][x] === 0) return { x, y };
      }
    }
    return null;
  }
  const canPlaceAt = (x, y, s) => {
    if (x + s > size || y + s > size) return false;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) if (cells[y + j][x + i] !== 0) return false;
    return true;
  };
  const doPlace = (x, y, s, id) => { for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) cells[y + j][x + i] = id; };
  const unPlace = (x, y, s) => { for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) cells[y + j][x + i] = 0; };

  async function backtrack(depth, startingRow) {
    if (cancelled) return false;
    const spot = findNextEmpty(startingRow);
    if (!spot) return true; // no empty cells left
    const { x, y } = spot;
    stats.depth = Math.max(stats.depth, depth);
    // Iterate sizes in randomized order for this depth, using pools
    const order = sizeOrders[depth] || baseSizes;
    for (const s of order) {
      if (cancelled) return false;
      const pool = available.get(s);
      if (!pool || pool.length === 0) continue;
      if (!canPlaceAt(x, y, s)) continue;
      // Debug: record attempted area
      if (debugLog) attemptSeq.push(s * s);
      const piece = pool.pop();
      doPlace(x, y, s, piece.id);
      placements.push({ pieceId: piece.id, x, y, size: s });
      stats.nodes++;
      const now = Date.now();
      if (
        now - lastTick >= SOLVER_TICK_MS ||
        (SOLVER_YIELD_NODES > 0 && stats.nodes % SOLVER_YIELD_NODES === 0)
      ) {
        lastTick = now;
        onTick?.(stats, placements.map((p) => ({ x: p.x, y: p.y, size: p.size })));
        await sleep(0);
      }
      if (await backtrack(depth + 1, y)) return true;
      placements.pop();
      unPlace(x, y, s);
      pool.push(piece);
      if (cancelled) return false;
    }
    return false;
  }

  let solved = false;
  try {
    solved = await backtrack(0, 0);
  } finally {
    state._cancelSolve = null;
  }
  if (cancelled) {
    if (debugLog) debugLog('orderTotal', attemptSeq.length);
    return { ok: false, reason: 'cancel' };
  }
  if (!solved) {
    if (debugLog) debugLog('orderTotal', attemptSeq.length);
    return { ok: false };
  }

  const steps = [];
  for (const pl of placements) {
    const piece = state.inventory.find((p) => p.id === pl.pieceId);
    if (!piece) continue;
    if (piece.placed) continue;
    piece.x = pl.x; piece.y = pl.y; piece.placed = true;
    state.board.place(piece, pl.x, pl.y);
    steps.push({ pieceId: piece.id, fromX: 0, fromY: 0, fromPlaced: false, toX: pl.x, toY: pl.y, toPlaced: true });
  }
  if (steps.length) state.pushStep({ batch: true, steps });
  return { ok: true, count: steps.length };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }

function shuffleInPlace(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Count number of solutions (up to 'limit') from the current board state.
// Does not modify UI state; simple backtracking with finite piece counts.
async function countSolutionsAsync(state, limit = 2, onTick) {
  const size = state.board.size;
  const cells = state.board.cells.map((row) => row.slice());
  // Build counts of remaining pieces by size
  const counts = new Array(9).fill(0);
  for (const p of state.inventory) if (!p.placed) counts[p.size]++;

  const canPlaceAt = (x, y, s) => {
    if (x + s > size || y + s > size) return false;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) if (cells[y + j][x + i] !== 0) return false;
    return true;
  };
  const doPlace = (x, y, s, id) => { for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) cells[y + j][x + i] = id; };
  const unPlace = (x, y, s) => { for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) cells[y + j][x + i] = 0; };
  const findNextEmpty = (startingRow) => {
    for (let y = startingRow; y < size; y++) {
      for (let x = 0; x < size; x++) if (cells[y][x] === 0) return { x, y };
    }
    return null;
  };
  let solutions = 0;
  const stats = { nodes: 0 };
  let lastTick = 0;
  async function backtrack(startingRow) {
    if (solutions >= limit) return true; // early cut
    const spot = findNextEmpty(startingRow);
    if (!spot) { solutions++; return solutions >= limit; }
    const { x, y } = spot;
    // Try larger sizes first for quicker pruning
    for (let s = 8; s >= 1; s--) {
      if (counts[s] === 0) continue;
      if (!canPlaceAt(x, y, s)) continue;
      counts[s]--;
      doPlace(x, y, s, -s); // negative id placeholder
      stats.nodes++;
      const now = Date.now();
      if (onTick && (now - lastTick) >= 200) { lastTick = now; onTick({ nodes: stats.nodes }); await sleep(0); }
      const stop = await backtrack(y);
      unPlace(x, y, s);
      counts[s]++;
      if (stop) return true;
    }
    return false;
  }
  await backtrack(0);
  return { count: solutions, nodes: stats.nodes };
}

// ---------- Transform helpers ----------
function makeTransform(n, rot, mirror) {
  const rotN = ((rot % 4) + 4) % 4;
  const map = (x, y) => {
    let xi = x, yi = y;
    if (mirror) xi = n - 1 - xi; // mirror across vertical axis
    for (let i = 0; i < rotN; i++) {
      const tx = n - 1 - yi;
      const ty = xi;
      xi = tx; yi = ty;
    }
    return { x: xi, y: yi };
  };
  const inv = (x, y) => {
    let xi = x, yi = y;
    // inverse rotation: rotate CCW rotN times (inverse of CW rotN)
    for (let i = 0; i < rotN; i++) {
      const tx = yi;
      const ty = n - 1 - xi;
      xi = tx; yi = ty;
    }
    // inverse of mirror is mirror again
    if (mirror) xi = n - 1 - xi;
    return { x: xi, y: yi };
  };
  return {
    rot: rotN, mirror,
    map,
    inv,
    invX: (x) => inv(x, 0).x,
    invY: (y) => inv(0, y).y,
  };
}

function chooseBestTransform(board) {
  const n = board.size;
  let best = null; let bestSum = Infinity;
  for (let r = 0; r < 4; r++) {
    for (let m of [false, true]) {
      const tf = makeTransform(n, r, m);
      let sum = 0;
      for (let y = 0; y < n; y++) {
        for (let x = 0; x < n; x++) {
          const id = board.cells[y][x];
          if (!id) continue;
          const t = tf.map(x, y);
          sum += t.x + t.y*n;
        }
      }
      if (sum < bestSum) { bestSum = sum; best = tf; }
    }
  }
  if (!best) best = makeTransform(board.size, 0, false);
  best.sum = bestSum;
  return best;
}

// Map a square block (top-left x,y with size s) through tf.map and return the
// top-left of the transformed block (min over transformed corners).
function mapRectTopLeft(tf, x, y, s) {
  const c1 = tf.map(x, y);
  const c2 = tf.map(x + s - 1, y);
  const c3 = tf.map(x, y + s - 1);
  const c4 = tf.map(x + s - 1, y + s - 1);
  const minX = Math.min(c1.x, c2.x, c3.x, c4.x);
  const minY = Math.min(c1.y, c2.y, c3.y, c4.y);
  return { x: minX, y: minY };
}

// Map a square block (top-left x,y with size s) through tf.inv and return the
// top-left of the transformed block (min over transformed corners).
function invRectTopLeft(tf, x, y, s) {
  const c1 = tf.inv(x, y);
  const c2 = tf.inv(x + s - 1, y);
  const c3 = tf.inv(x, y + s - 1);
  const c4 = tf.inv(x + s - 1, y + s - 1);
  const minX = Math.min(c1.x, c2.x, c3.x, c4.x);
  const minY = Math.min(c1.y, c2.y, c3.y, c4.y);
  return { x: minX, y: minY };
}

function buildTransformedState(state, tf) {
  // Deep clone board and apply transform to cells
  const n = state.board.size;
  const clonedCells = Array.from({ length: n }, () => Array(n).fill(0));
  let filled = 0;
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const id = state.board.cells[y][x];
      if (!id) continue;
      const t = tf.map(x, y);
      clonedCells[t.y][t.x] = id;
      filled++;
    }
  }
  const workBoard = {
    size: n,
    cells: clonedCells,
    filled,
    // No-op place: solver's finalization toggles piece.placed and uses steps; we don't need to mutate cells here.
    place: () => {},
    remove: () => {},
  };
  // Clone inventory and transform placed piece coordinates (top-left of block)
  const workInv = state.inventory.map(p => ({ ...p }));
  for (const p of workInv) {
    if (p.placed) {
      const t = mapRectTopLeft(tf, p.x, p.y, p.size);
      p.x = t.x; p.y = t.y;
    }
  }
  return {
    board: workBoard,
    inventory: workInv,
    _cancelSolve: null,
    pushStep: () => {}, // solver doesn't rely on this when returning placements
  };
}

function applySolutionFromWork(state, work, tf) {
  const steps = [];
  // For each placed piece in work, map back and place into UI state if not already placed
  for (const wp of work.inventory) {
    if (!wp.placed) continue;
    const up = state.inventory.find(p => p.id === wp.id);
    if (!up || up.placed) continue;
    const back = invRectTopLeft(tf, wp.x, wp.y, wp.size);
    up.x = back.x; up.y = back.y; up.placed = true;
    state.board.place(up, up.x, up.y);
    steps.push({ pieceId: up.id, fromX: 0, fromY: 0, fromPlaced: false, toX: up.x, toY: up.y, toPlaced: true });
  }
  if (steps.length) state.pushStep({ batch: true, steps });
}

// Place the next available piece of given size at the first non-overlapping board position
// Removed: autoPlaceFirstFit (replaced by random-fit placement)

// Random-fit variant: try all valid positions in random order (or up to a cap)
function autoPlaceRandomFit(state, size) {
  const piece = state.inventory.find((p) => p.size === size && !p.placed);
  if (!piece) return false;
  const board = state.board;
  const positions = [];
  for (let y = 0; y <= board.size - size; y++) {
    for (let x = 0; x <= board.size - size; x++) {
      if (board.inBounds(x, y, size) && !board.overlap(x, y, size)) positions.push({ x, y });
    }
  }
  if (positions.length === 0) return false;
  // Shuffle positions
  for (let i = positions.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [positions[i], positions[j]] = [positions[j], positions[i]];
  }
  const pick = positions[0];
  piece.x = pick.x;
  piece.y = pick.y;
  piece.placed = true;
  board.place(piece, pick.x, pick.y);
  state.pushStep({
    pieceId: piece.id,
    fromX: 0,
    fromY: 0,
    fromPlaced: false,
    toX: pick.x,
    toY: pick.y,
    toPlaced: true,
  });
  return true;
}
