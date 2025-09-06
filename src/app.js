// Application bootstrap
function init() {
  const BOARD_SIZE = 36;
  const COLORS = ['#f87171','#fbbf24','#34d399','#60a5fa','#c084fc','#f472b6','#a78bfa','#facc15'];

  class Piece {
    constructor(id, size) {
      this.id = id;
      this.size = size;
      this.x = 0;
      this.y = 0;
      this.placed = false;
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
      this.grid = true;
      this.preview = null;
      this.undo = [];
      this.redo = [];
      this.solving = false;
      this.solverPreview = null; // [{x,y,size}]
      this._cancelSolve = null;
    }
    reset() {
      this.board.clear();
      for (const p of this.inventory) {
        p.x = 0;
        p.y = 0;
        p.placed = false;
      }
      this.preview = null;
      this.undo = [];
      this.redo = [];
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
      ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(0, 0, sizePx, sizePx);
      if (this.state.grid) {
        ctx.strokeStyle = '#334155';
        ctx.lineWidth = 1;
        for (let i = 0; i <= BOARD_SIZE; i++) {
          const p = i * cs;
          ctx.beginPath();
          ctx.moveTo(p, 0);
          ctx.lineTo(p, sizePx);
          ctx.moveTo(0, p);
          ctx.lineTo(sizePx, p);
          ctx.stroke();
        }
      }
      for (const piece of this.state.inventory) {
        if (!piece.placed) continue;
        const x = piece.x * cs;
        const y = piece.y * cs;
        const w = piece.size * cs;
        const h = piece.size * cs;
        ctx.fillStyle = COLORS[(piece.size - 1) % COLORS.length];
        ctx.fillRect(x, y, w, h);
        // Thin border to visually separate tiles
        ctx.save();
        ctx.lineWidth = 1;
        ctx.strokeStyle = '#0b1220';
        ctx.strokeRect(x + 0.5, y + 0.5, w - 1, h - 1);
        ctx.restore();
      }
      // Draw solver preview placements (semi-transparent overlay)
      if (this.state.solverPreview && this.state.solverPreview.length) {
        ctx.save();
        for (const g of this.state.solverPreview) {
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
      if (this.state.preview) {
        const pr = this.state.preview;
        ctx.fillStyle = pr.valid ? 'rgba(34,197,94,.5)' : 'rgba(239,68,68,.5)';
        ctx.fillRect(pr.x * cs, pr.y * cs, pr.piece.size * cs, pr.piece.size * cs);
      }
      this.needsDraw = false;
    }
  }

  function hexToRgba(hex, alpha) {
    const h = hex.replace('#', '');
    const bigint = parseInt(h.length === 3 ? h.split('').map((c)=>c+c).join('') : h, 16);
    const r = (bigint >> 16) & 255;
    const g = (bigint >> 8) & 255;
    const b = bigint & 255;
    return `rgba(${r},${g},${b},${alpha})`;
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
      // Right-click to put a tile back into inventory
      canvas.addEventListener('contextmenu', (e) => this.onContextMenu(e));
    }
    start(piece, px, py) {
      this.active = piece;
      this.origX = piece.x;
      this.origY = piece.y;
      this.wasPlaced = piece.placed;
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
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const cs = this.renderer.cellSize;
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
      const x = Math.floor(cx / cs);
      const y = Math.floor(cy / cs);
      const piece = this.state.inventory.find(
        (p) => p.placed && x >= p.x && x < p.x + p.size && y >= p.y && y < p.y + p.size
      );
      if (!piece) return;
      const px = cx - piece.x * cs;
      const py = cy - piece.y * cs;
      this.start(piece, px, py);
    }
    onContextMenu(e) {
      e.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      const cs = this.renderer.cellSize;
      const x = Math.floor((e.clientX - rect.left) / cs);
      const y = Math.floor((e.clientY - rect.top) / cs);
      const piece = this.state.inventory.find(
        (p) => p.placed && x >= p.x && x < p.x + p.size && y >= p.y && y < p.y + p.size
      );
      if (!piece) return;
      // Remove from board, keep in inventory
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
      this.renderer.requestDraw();
    }
    startFromInventory(piece, e) {
      const cs = this.renderer.cellSize;
      const px = (piece.size * cs) / 2;
      const py = (piece.size * cs) / 2;
      this.start(piece, px, py);
      this.onMove(e);
    }
    onMove(e) {
      if (!this.active) return;
      const rect = this.canvas.getBoundingClientRect();
      const cs = this.renderer.cellSize;
      const scaleX = this.canvas.width / rect.width;
      const scaleY = this.canvas.height / rect.height;
      const cx = (e.clientX - rect.left) * scaleX;
      const cy = (e.clientY - rect.top) * scaleY;
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
  const statusEl = document.getElementById('status');
  const progressEl = document.getElementById('progress');
  const newBtn = document.getElementById('newBtn');
  const undoBtn = document.getElementById('undoBtn');
  const gridBtn = document.getElementById('gridBtn');
  const solveBtn = document.getElementById('solveBtn');
  const zoomInput = document.getElementById('zoom');

  const state = new GameState();
  const renderer = new Renderer(canvas, state);

  function updateStatus(overlap) {
    statusEl.textContent = `Filled cells: ${state.board.filled}/1296 • Overlap: ${overlap ? 'Yes' : 'No'}`;
    progressEl.textContent = `${state.board.filled}/1296`;
  }

  function renderInventory() {
    invEl.innerHTML = '';
    for (let size = 1; size <= 8; size++) {
      const remain = state.inventory.filter((p) => p.size === size && !p.placed).length;
      const div = document.createElement('div');
      div.className = 'piece-thumb';
      div.dataset.size = String(size);
      const thumb = document.createElement('canvas');
      const t = 20;
      thumb.width = size * t;
      thumb.height = size * t;
      const ictx = thumb.getContext('2d');
      ictx.fillStyle = COLORS[(size - 1) % COLORS.length];
      ictx.fillRect(0, 0, size * t, size * t);
      div.appendChild(thumb);
      const span = document.createElement('span');
      span.textContent = `x${remain}`;
      div.appendChild(span);
      if (remain > 0) {
        div.addEventListener('pointerdown', (e) => {
          e.preventDefault();
          const piece = state.inventory.find((p) => p.size === size && !p.placed);
          if (piece) drag.startFromInventory(piece, e);
        });
      }
      invEl.appendChild(div);
    }
  }

  const drag = new DragController(canvas, state, renderer, updateStatus, renderInventory);

  newBtn.addEventListener('click', () => {
    state.reset();
    renderInventory();
    renderer.requestDraw();
    updateStatus(false);
  });

  undoBtn.addEventListener('click', () => {
    state.undoStep();
    renderInventory();
    renderer.requestDraw();
    updateStatus(false);
  });

  gridBtn.addEventListener('click', () => {
    state.grid = !state.grid;
    renderer.requestDraw();
  });

  solveBtn.addEventListener('click', async () => {
    if (state.solving) {
      if (state._cancelSolve) state._cancelSolve();
      return;
    }
    state.solving = true;
    solveBtn.textContent = 'Cancel';
    const out = await solveRemainingAsync(state, (stats, preview) => {
      state.solverPreview = preview;
      const nodes = Number(stats.nodes).toLocaleString('en-US');
      statusEl.textContent = `Auto-Fill: Nodes ${nodes} • Depth ${stats.depth} • Placed ${preview.length}`;
      renderer.requestDraw();
    });
    state.solving = false;
    state.solverPreview = null;
    solveBtn.textContent = 'Auto-Fill';
    if (!out.ok) {
      statusEl.textContent = out.reason === 'cancel' ? 'Auto-Fill cancelled.' : 'No solution found.';
    } else {
      renderInventory();
      renderer.requestDraw();
      updateStatus(false);
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
    const gap = parseFloat(gs.gap) || 0;
    const canvasBaseW = canvas.width;
    const canvasBaseH = canvas.height;

    const viewportW = window.innerWidth;
    const viewportH = window.innerHeight;
    const headerH = header?.offsetHeight || 0;
    const footerH = footer?.offsetHeight || 0;
    const availH = Math.max(200, viewportH - headerH - footerH - 8);

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
    const scale = clamp(Math.min(sW, sH), 0.3, 2);
    renderer.setScale(scale);
    zoomInput.value = String(scale);
  }
  function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }
  window.addEventListener('resize', autoScaleToFit, { passive: true });
  window.addEventListener('orientationchange', autoScaleToFit);
  autoScaleToFit();

  renderInventory();
  renderer.requestDraw();
  updateStatus(false);
}

// Auto-start when included as a module or plain script at the end of body
init();

// -------------------- Solver --------------------
function solveRemaining(state) {
  const size = state.board.size;
  // Clone board cells
  const cells = state.board.cells.map((row) => row.slice());
  // Collect available pieces by size (descending)
  const available = new Map();
  for (let s = 1; s <= 8; s++) available.set(s, []);
  for (const p of state.inventory) if (!p.placed) available.get(p.size).push(p);
  const sizesDesc = [...available.keys()].sort((a, b) => b - a);

  const placements = []; // {pieceId, x, y, size}

  function findNextEmpty() {
    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        if (cells[y][x] === 0) return { x, y };
      }
    }
    return null;
  }
  function canPlaceAt(x, y, s) {
    if (x + s > size || y + s > size) return false;
    for (let j = 0; j < s; j++) {
      for (let i = 0; i < s; i++) {
        if (cells[y + j][x + i] !== 0) return false;
      }
    }
    return true;
  }
  function doPlace(x, y, s, id) {
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) cells[y + j][x + i] = id;
  }
  function unPlace(x, y, s) {
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) cells[y + j][x + i] = 0;
  }

  function backtrack() {
    const spot = findNextEmpty();
    if (!spot) return true; // solved
    const { x, y } = spot;
    for (const s of sizesDesc) {
      const pool = available.get(s);
      if (!pool || pool.length === 0) continue;
      if (!canPlaceAt(x, y, s)) continue;
      // choose a piece of this size
      const piece = pool.pop();
      doPlace(x, y, s, piece.id);
      placements.push({ pieceId: piece.id, x, y, size: s });
      if (backtrack()) return true;
      // backtrack
      placements.pop();
      unPlace(x, y, s);
      pool.push(piece);
    }
    return false;
  }

  const solved = backtrack();
  if (!solved) return { ok: false };

  // Apply placements as a single batch undo step
  const steps = [];
  for (const pl of placements) {
    const piece = state.inventory.find((p) => p.id === pl.pieceId);
    // Skip if somehow already placed (should not happen)
    if (piece.placed) continue;
    piece.x = pl.x;
    piece.y = pl.y;
    piece.placed = true;
    state.board.place(piece, pl.x, pl.y);
    steps.push({
      pieceId: piece.id,
      fromX: 0,
      fromY: 0,
      fromPlaced: false,
      toX: pl.x,
      toY: pl.y,
      toPlaced: true,
    });
  }
  if (steps.length) state.pushStep({ batch: true, steps });
  return { ok: true, count: steps.length };
}

// Async variant with periodic preview updates
async function solveRemainingAsync(state, onTick) {
  const size = state.board.size;
  const cells = state.board.cells.map((row) => row.slice());
  const available = new Map();
  for (let s = 1; s <= 8; s++) available.set(s, []);
  for (const p of state.inventory) if (!p.placed) available.get(p.size).push(p);
  const sizesDesc = [...available.keys()].sort((a, b) => b - a);

  const placements = []; // {pieceId,x,y,size}
  const stats = { nodes: 0, depth: 0 };
  let lastTick = 0;
  let cancelled = false;
  state._cancelSolve = () => { cancelled = true; };

  const findNextEmpty = () => {
    for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) if (cells[y][x] === 0) return { x, y };
    return null;
  };
  const canPlaceAt = (x, y, s) => {
    if (x + s > size || y + s > size) return false;
    for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) if (cells[y + j][x + i] !== 0) return false;
    return true;
  };
  const doPlace = (x, y, s, id) => { for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) cells[y + j][x + i] = id; };
  const unPlace = (x, y, s) => { for (let j = 0; j < s; j++) for (let i = 0; i < s; i++) cells[y + j][x + i] = 0; };

  async function backtrack(depth) {
    if (cancelled) return false;
    const spot = findNextEmpty();
    if (!spot) return true;
    const { x, y } = spot;
    stats.depth = Math.max(stats.depth, depth);
    for (const s of sizesDesc) {
      const pool = available.get(s);
      if (!pool || pool.length === 0) continue;
      if (!canPlaceAt(x, y, s)) continue;
      const piece = pool.pop();
      doPlace(x, y, s, piece.id);
      placements.push({ pieceId: piece.id, x, y, size: s });
      stats.nodes++;
      const now = Date.now();
      if (now - lastTick >= 1000) {
        lastTick = now;
        onTick?.(stats, placements.map((p) => ({ x: p.x, y: p.y, size: p.size })));
        await sleep(0);
      }
      if (await backtrack(depth + 1)) return true;
      placements.pop();
      unPlace(x, y, s);
      pool.push(piece);
      if (cancelled) return false;
    }
    return false;
  }

  const solved = await backtrack(1);
  state._cancelSolve = null;
  if (cancelled) return { ok: false, reason: 'cancel' };
  if (!solved) return { ok: false };

  const steps = [];
  for (const pl of placements) {
    const piece = state.inventory.find((p) => p.id === pl.pieceId);
    if (piece.placed) continue;
    piece.x = pl.x; piece.y = pl.y; piece.placed = true;
    state.board.place(piece, pl.x, pl.y);
    steps.push({ pieceId: piece.id, fromX: 0, fromY: 0, fromPlaced: false, toX: pl.x, toY: pl.y, toPlaced: true });
  }
  if (steps.length) state.pushStep({ batch: true, steps });
  return { ok: true, count: steps.length };
}

function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
