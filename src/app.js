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
      const p = this.inventory.find((x) => x.id === step.pieceId);
      if (step.toPlaced) this.board.remove(p);
      p.x = step.fromX;
      p.y = step.fromY;
      p.placed = step.fromPlaced;
      if (step.fromPlaced) this.board.place(p, p.x, p.y);
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
        ctx.fillStyle = COLORS[(piece.size - 1) % COLORS.length];
        ctx.fillRect(piece.x * cs, piece.y * cs, piece.size * cs, piece.size * cs);
      }
      if (this.state.preview) {
        const pr = this.state.preview;
        ctx.fillStyle = pr.valid ? 'rgba(34,197,94,.5)' : 'rgba(239,68,68,.5)';
        ctx.fillRect(pr.x * cs, pr.y * cs, pr.piece.size * cs, pr.piece.size * cs);
      }
      this.needsDraw = false;
    }
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
      const x = Math.floor((e.clientX - rect.left) / cs);
      const y = Math.floor((e.clientY - rect.top) / cs);
      const piece = this.state.inventory.find(
        (p) => p.placed && x >= p.x && x < p.x + p.size && y >= p.y && y < p.y + p.size
      );
      if (!piece) return;
      const px = e.clientX - rect.left - piece.x * cs;
      const py = e.clientY - rect.top - piece.y * cs;
      this.start(piece, px, py);
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
      const px = e.clientX - rect.left - this.offsetX;
      const py = e.clientY - rect.top - this.offsetY;
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
      } else {
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
  const zoomInput = document.getElementById('zoom');

  const state = new GameState();
  const renderer = new Renderer(canvas, state);

  function updateStatus(overlap) {
    statusEl.textContent =
      `Gefüllte Zellen: ${state.board.filled}/1296 • Überlappung: ${overlap ? 'Ja' : 'Nein'}`;
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

  zoomInput.addEventListener('input', (e) => {
    const z = parseFloat(e.target.value);
    renderer.setScale(z);
  });

  renderInventory();
  renderer.requestDraw();
  updateStatus(false);
}

// Auto-start when included as a module or plain script at the end of body
init();
