// Expandable HUD for editing players. Each row controls one player's leaper
// vector (dx, dy) and color. Changes rebuild the board from scratch.

export const COLOR_PALETTE = [
  { name: 'black',  bkg: '#111', txt: '#eee' },
  { name: 'red',    bkg: '#f22', txt: '#111' },
  { name: 'cyan',   bkg: '#2cf', txt: '#111' },
  { name: 'green',  bkg: '#2c2', txt: '#111' },
  { name: 'yellow', bkg: '#ee2', txt: '#111' },
  { name: 'orange', bkg: '#f82', txt: '#111' },
];

const MAX_PLAYERS = COLOR_PALETTE.length - 1;

// Fairy chess leapers from the m,n table. m,n are |dx|,|dy| sorted.
export const FAIRY_PIECES = [
  { name: 'Wazir',        m: 0, n: 1 },
  { name: 'Dabbaba',      m: 0, n: 2 },
  { name: 'Threeleaper',  m: 0, n: 3 },
  { name: 'Fourleaper',   m: 0, n: 4 },
  { name: 'Ferz',         m: 1, n: 1 },
  { name: 'Knight',       m: 1, n: 2 },
  { name: 'Camel',        m: 1, n: 3 },
  { name: 'Giraffe',      m: 1, n: 4 },
  { name: 'Alfil',        m: 2, n: 2 },
  { name: 'Zebra',        m: 2, n: 3 },
  { name: 'Stag',         m: 2, n: 4 },
  { name: 'Tripper',      m: 3, n: 3 },
  { name: 'Antelope',     m: 3, n: 4 },
  { name: 'Commuter',     m: 4, n: 4 },
];

function pieceForVector(dx, dy) {
  const a = Math.min(Math.abs(dx), Math.abs(dy));
  const b = Math.max(Math.abs(dx), Math.abs(dy));
  return FAIRY_PIECES.find((p) => p.m === a && p.n === b) || null;
}

export class HUD {
  constructor(board, view) {
    this.board = board;
    this.view = view;
    this.configs = board.players.map((p) => ({
      dx: p.dx, dy: p.dy, bkgClr: p.bkgClr, txtClr: p.txtClr,
    }));

    this.root = document.createElement('div');
    this.root.className = 'hud hud-open';
    this.root.innerHTML = `
      <button class="hud-toggle" type="button" aria-expanded="true">Players</button>
      <div class="hud-body">
        <div class="hud-rows"></div>
        <button class="hud-add" type="button">+ Add player</button>
      </div>
    `;
    document.body.appendChild(this.root);

    this.toggleBtn = this.root.querySelector('.hud-toggle');
    this.bodyEl = this.root.querySelector('.hud-body');
    this.rowsEl = this.root.querySelector('.hud-rows');
    this.addBtn = this.root.querySelector('.hud-add');

    this.toggleBtn.addEventListener('click', () => this.toggle());
    this.addBtn.addEventListener('click', () => {
      if (this.configs.length >= MAX_PLAYERS) return;
      const used = new Set(this.configs.map((c) => c.bkgClr));
      const pick = COLOR_PALETTE.find((c) => !used.has(c.bkg)) || COLOR_PALETTE[0];
      this.configs.push({ dx: 2, dy: 1, bkgClr: pick.bkg, txtClr: pick.txt });
      this.renderRows();
      this.apply();
    });

    this.renderRows();
  }

  toggle() {
    const open = this.root.classList.toggle('hud-open');
    this.toggleBtn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }

  renderRows() {
    this.rowsEl.innerHTML = '';
    this.configs.forEach((cfg, i) => this.rowsEl.appendChild(this.makeRow(cfg, i)));
    this.addBtn.disabled = this.configs.length >= MAX_PLAYERS;
  }

  makeRow(cfg, i) {
    const row = document.createElement('div');
    row.className = 'hud-row';

    // --- left column ---
    const left = document.createElement('div');
    left.className = 'hud-left';

    // Row 1: piece dropdown
    const sel = document.createElement('select');
    sel.className = 'hud-piece';
    for (const p of FAIRY_PIECES) {
      const o = document.createElement('option');
      o.value = `${p.m},${p.n}`;
      o.textContent = `${p.name} (${p.m},${p.n})`;
      sel.appendChild(o);
    }
    const customOpt = document.createElement('option');
    customOpt.value = 'Custom';
    customOpt.textContent = 'Custom';
    sel.appendChild(customOpt);

    // Row 2: dx + dy
    let preview; // forward-declared, assigned below
    const dxIn = numberInput(cfg.dx, (v) => {
      cfg.dx = v;
      syncPiece();
      renderPreview(preview, cfg);
      this.apply();
    });
    const dyIn = numberInput(cfg.dy, (v) => {
      cfg.dy = v;
      syncPiece();
      renderPreview(preview, cfg);
      this.apply();
    });

    const syncPiece = () => {
      const piece = pieceForVector(cfg.dx, cfg.dy);
      sel.value = piece ? `${piece.m},${piece.n}` : 'custom';
    };
    syncPiece();

    sel.addEventListener('change', () => {
      if (sel.value === 'custom') return;
      const [m, n] = sel.value.split(',').map(Number);
      cfg.dx = m;
      cfg.dy = n;
      dxIn.value = cfg.dx;
      dyIn.value = cfg.dy;
      renderPreview(preview, cfg);
      this.apply();
    });

    const vecRow = document.createElement('div');
    vecRow.className = 'hud-vec';
    vecRow.append(labeled('dx', dxIn), labeled('dy', dyIn));

    // Rows 3 & 4: two rows of color swatches (3 each)
    const usedByOthers = new Set(
      this.configs.filter((c, j) => j !== i).map((c) => c.bkgClr),
    );
    const swatchRow = document.createElement('div');
    swatchRow.className = 'hud-swatches';
    for (const c of COLOR_PALETTE) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hud-swatch';
      b.style.background = c.bkg;
      b.title = c.name;
      const taken = usedByOthers.has(c.bkg);
      if (taken) {
        b.disabled = true;
        b.classList.add('disabled');
      }
      if (cfg.bkgClr === c.bkg) b.classList.add('selected');
      b.addEventListener('click', () => {
        if (taken) return;
        cfg.bkgClr = c.bkg;
        cfg.txtClr = c.txt;
        this.renderRows();
        this.apply();
      });
      swatchRow.appendChild(b);
    }

    left.append(sel, vecRow, swatchRow);

    // --- right column: preview canvas ---
    preview = document.createElement('canvas');
    preview.className = 'hud-preview';
    renderPreview(preview, cfg);

    // --- remove button ---
    const rm = document.createElement('button');
    rm.type = 'button';
    rm.className = 'hud-remove';
    rm.textContent = '×';
    rm.title = 'Remove player';
    rm.addEventListener('click', () => {
      this.configs.splice(i, 1);
      this.renderRows();
      this.apply();
    });

    row.append(left, preview, rm);
    return row;
  }

  apply() {
    this.board.reconfigure(this.configs);
    this.view.resetForNewBoard();
  }
}

function numberInput(value, onChange) {
  const el = document.createElement('input');
  el.type = 'number';
  el.value = value;
  el.className = 'hud-num';
  el.addEventListener('input', () => {
    const v = parseInt(el.value, 10);
    if (!Number.isFinite(v)) return;
    onChange(v);
  });
  return el;
}

function labeled(label, input) {
  const wrap = document.createElement('label');
  wrap.className = 'hud-field';
  const span = document.createElement('span');
  span.textContent = label;
  wrap.append(span, input);
  return wrap;
}

// Mini visualization: (N+1)x(N+1) checkerboard where N = max(|dx|,|dy|).
// Piece sits at lower-left; attack squares in upper-right quadrant are striped.
const PREVIEW_PX = 72;
function renderPreview(canvas, cfg) {
  const dx = cfg.dx, dy = cfg.dy;
  const N = Math.max(1, Math.max(Math.abs(dx), Math.abs(dy)) + 1);
  const sizePx = PREVIEW_PX;
  const cellPx = sizePx / N;
  const ratio = window.devicePixelRatio || 1;
  canvas.width = sizePx * ratio;
  canvas.height = sizePx * ratio;
  canvas.style.width = `${sizePx}px`;
  canvas.style.height = `${sizePx}px`;
  const ctx = canvas.getContext('2d');
  ctx.setTransform(ratio, 0, 0, ratio, 0, 0);
  ctx.imageSmoothingEnabled = false;

  // Checkerboard. Cell (i, j) where i = column, j = row counted from bottom.
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      ctx.fillStyle = ((i + j) % 2 === 0) ? '#fff' : '#ccc';
      ctx.fillRect(i * cellPx, (N - 1 - j) * cellPx, cellPx, cellPx);
    }
  }

  // Stripes on upper-right-quadrant attack squares.
  const K = [
    [dx, dy], [dy, dx], [-dy, dx], [-dx, dy],
    [-dx, -dy], [-dy, -dx], [dy, -dx], [dx, -dy],
  ];
  const seen = new Set();
  for (const [ti, tj] of K) {
    if (ti <= 0 && tj <= 0) continue;
    if (ti < 0 || tj < 0) continue;
    if (ti >= N || tj >= N) continue;
    const key = `${ti},${tj}`;
    if (seen.has(key)) continue;
    seen.add(key);
    drawStripes(ctx, ti * cellPx, (N - 1 - tj) * cellPx, cellPx, cfg.bkgClr);
  }

  // Piece at (0, 0) — lower-left.
  const cx = cellPx / 2;
  const cy = (N - 1) * cellPx + cellPx / 2;
  ctx.beginPath();
  ctx.arc(cx, cy, cellPx * 0.4, 0, 2 * Math.PI);
  ctx.fillStyle = cfg.bkgClr;
  ctx.fill();
}

function drawStripes(ctx, x, y, size, color) {
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, size, size);
  ctx.clip();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  const step = 4;
  for (let k = -size; k < size * 2; k += step) {
    ctx.beginPath();
    ctx.moveTo(x + k, y + size);
    ctx.lineTo(x + k + size, y);
    ctx.stroke();
  }
  ctx.restore();
}
