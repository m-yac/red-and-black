// Expandable HUD for editing players. Each row controls one player's leaper
// vector (dx, dy) and color. Changes rebuild the board from scratch.

export const COLOR_PALETTE = [
  { code: 'b', name: 'black',  bkg: '#111', txt: '#eee' },
  { code: 'r', name: 'red',    bkg: '#f22', txt: '#111' },
  { code: 'c', name: 'cyan',   bkg: '#2cf', txt: '#111' },
  { code: 'g', name: 'green',  bkg: '#2c2', txt: '#111' },
  { code: 'y', name: 'yellow', bkg: '#ee2', txt: '#111' },
  { code: 'o', name: 'orange', bkg: '#f82', txt: '#111' },
];

const MAX_PLAYERS = COLOR_PALETTE.length - 1;

export function parsePlayersFromURL() {
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('players');
  if (!raw) return null;
  const configs = [];
  for (const part of raw.split('_')) {
    const [dxs, dys, code] = part.split('.');
    const dx = parseInt(dxs, 10);
    const dy = parseInt(dys, 10);
    const color = COLOR_PALETTE.find((c) => c.code === code);
    if (!Number.isFinite(dx) || !Number.isFinite(dy) || !color) continue;
    configs.push({ dx, dy, bkgClr: color.bkg, txtClr: color.txt });
  }
  return configs.length ? configs : null;
}

function encodePlayers(configs) {
  return configs.map((c) => {
    const color = COLOR_PALETTE.find((p) => p.bkg === c.bkgClr);
    return `${c.dx}.${c.dy}.${color ? color.code : c.bkgClr}`;
  }).join('_');
}

// Fairy chess leapers from the m,n table. m,n are |dx|,|dy| sorted.
const FAIRY_PIECE_GROUPS = {
  '(n,n)': [
    { name: 'Ferz',         m: 1, n: 1 },
    { name: 'Alfil',        m: 2, n: 2 },
    { name: 'Tripper',      m: 3, n: 3 },
    { name: 'Commuter',     m: 4, n: 4 },
  ],
  '(n,n+1)': [
    { name: 'Wazir',        m: 0, n: 1 },
    { name: 'Knight',       m: 1, n: 2 },
    { name: 'Zebra',        m: 2, n: 3 },
    { name: 'Antelope',     m: 3, n: 4 },
  ],
  '(n,n+2)': [
    { name: 'Dabbaba',      m: 0, n: 2 },
    { name: 'Camel',        m: 1, n: 3 },
    { name: 'Stag',         m: 2, n: 4 },
  ],
  '(n,n+3)': [
    { name: 'Giraffe',      m: 1, n: 4 },
  ],
  '(n,n+5)': [
    { name: 'Flamingo',     m: 1, n: 6 },
  ],
};
export const FAIRY_PIECES = Object.values(FAIRY_PIECE_GROUPS).flat();

function capitalize(s) {
  return s ? s[0].toUpperCase() + s.slice(1) : s;
}

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

    this.playersSection = makeSection('players', 'Players', true, `
      <div class="hud-rows"></div>
      <div class="hud-add-row">
        <button class="hud-add" type="button">+ Add player</button>
        <span class="hud-disclaimer">* A single player avoids itself</span>
      </div>
    `);
    this.resultsSection = makeSection('results', 'Results', false, `
      <div class="hud-results"></div>
    `);
    this.root = document.createElement('div');
    this.root.className = 'hud-stack';
    this.root.append(this.playersSection, this.resultsSection);
    document.body.appendChild(this.root);

    this.rowsEl = this.playersSection.querySelector('.hud-rows');
    this.addBtn = this.playersSection.querySelector('.hud-add');
    this.disclaimerEl = this.playersSection.querySelector('.hud-disclaimer');
    this.resultsEl = this.resultsSection.querySelector('.hud-results');
    // player index -> number of sequence entries currently shown (default SEQ_PREVIEW)
    this.shownSeqCounts = new Map();
    this.lastResultsAt = 0;
    this.resultsTimer = null;

    for (const section of [this.playersSection, this.resultsSection]) {
      const btn = section.querySelector('.hud-toggle');
      btn.addEventListener('click', () => {
        const open = section.classList.toggle('hud-open');
        btn.setAttribute('aria-expanded', open ? 'true' : 'false');
        if (section === this.resultsSection && open) this.renderResults();
      });
    }

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

  renderRows() {
    this.rowsEl.innerHTML = '';
    this.configs.forEach((cfg, i) => this.rowsEl.appendChild(this.makeRow(cfg, i)));
    this.addBtn.disabled = this.configs.length >= MAX_PLAYERS;
    this.disclaimerEl.style.display = this.configs.length === 1 ? '' : 'none';
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
    for (const [gp, ps] of Object.entries(FAIRY_PIECE_GROUPS)) {
      const og = document.createElement('optgroup');
      og.label = `${gp} Leapers`;
      for (const p of ps) {
        const o = document.createElement('option');
        o.value = `${p.m},${p.n}`;
        o.textContent = `${p.name} (${p.m},${p.n})`;
        og.append(o);
      }
      sel.appendChild(og);
    }
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
      sel.value = piece ? `${piece.m},${piece.n}` : '';
    };
    syncPiece();

    sel.addEventListener('change', () => {
      if (!sel.value) return;
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
    this.shownSeqCounts.clear();
    this.view.resetForNewBoard();
    this.syncURL();
    this.renderResults();
  }

  renderResults() {
    if (!this.resultsSection.classList.contains('hud-open')) return;
    // Throttle to ~4 Hz: getStats walks O(R^2) cells, too costly per rAF.
    const now = performance.now();
    const minGap = 250;
    if (now - this.lastResultsAt < minGap) {
      if (!this.resultsTimer) {
        this.resultsTimer = setTimeout(() => {
          this.resultsTimer = null;
          this.renderResults();
        }, minGap - (now - this.lastResultsAt));
      }
      return;
    }
    this.lastResultsAt = now;
    const R = Math.min(this.view.screenRadius, this.board.maxOccupiedRadius);
    const cells = (2 * R + 1) * (2 * R + 1);
    const players = this.board.players;

    const SEQ_PREVIEW = 20;
    const SEQ_STEP = 100;

    let foundCells = 0;
    const renderRow = (key, headHTML, ks) => {
      const count = ks.length;
      foundCells += count;
      const pct = cells > 0 ? (100 * count / cells) : 0;
      const shown = Math.min(count, this.shownSeqCounts.get(key) ?? SEQ_PREVIEW);
      const seq = ks.slice(0, shown);
      const remaining = count - shown;
      const more = Math.min(SEQ_STEP, remaining);
      const links = [];
      if (more > 0) {
        links.push(`<a class="hud-seq-link" data-key="${key}" data-act="more">show ${more} more</a>`);
      }
      if (shown > SEQ_PREVIEW) {
        links.push(`<a class="hud-seq-link" data-key="${key}" data-act="less">show less</a>`);
      }
      const oeisQuery = ks.slice(0, 16).join('%2C+');
      const oeisBtn = ks.length > 0
        ? `<a class="hud-oeis" href="https://oeis.org/search?q=${oeisQuery}" target="_blank" rel="noopener">Search in OEIS</a>`
        : '';
      return `
        <div class="hud-result-row">
          <div class="hud-result-head">
            ${headHTML}
            <span class="hud-result-pct">${pct.toFixed(2)}% (${count.toLocaleString()})</span>
          </div>
          <div class="hud-result-seq">
            <span class="hud-result-seq-label">sequence:</span>
            <span class="hud-result-seq-vals">${seq.join(', ')}${remaining > 0 ? ', …' : ''}</span>
            ${links.join(' ')}
          </div>
          ${oeisBtn}
        </div>
      `;
    };

    const playerHTML = players.map((p, i) => {
      const piece = pieceForVector(p.dx, p.dy);
      const pieceLabel = piece ? piece.name : `(${p.dx},${p.dy})-Leaper`;
      const colorEntry = COLOR_PALETTE.find((c) => c.bkg === p.bkgClr);
      const colorName = colorEntry ? capitalize(colorEntry.name) : '';
      const label = colorName ? `${colorName} ${pieceLabel}` : pieceLabel;
      const ks = [];
      for (const [k, kR] of p.sequence) {
        if (kR <= R) ks.push(k);
      }
      const head = `
        <span class="hud-result-dot" style="background:${p.bkgClr}"></span>
        <span class="hud-result-name">${label}</span>
      `;
      return renderRow(`p${i}`, head, ks);
    }).join('');

    const unoccKs = [];
    for (const [k, kR] of this.board.unoccupiedSequence) {
      if (kR <= R) unoccKs.push(k);
    }
    unoccKs.sort((a, b) => a - b);
    const unoccHead = `<span class="hud-result-name">Unoccupied</span>`;
    const unoccupiedHTML = renderRow('unocc', unoccHead, unoccKs);

    const general = `
      <div class="hud-results-general">
        <div><span>Total cells:</span> ${foundCells.toLocaleString()} (${foundCells != cells ? 'approx. ' : ''}${R.toLocaleString()}x${R.toLocaleString()})</div>
      </div>
    `;

    this.resultsEl.innerHTML = playerHTML + unoccupiedHTML + general;

    for (const link of this.resultsEl.querySelectorAll('.hud-seq-link')) {
      link.addEventListener('click', () => {
        const key = link.getAttribute('data-key');
        const act = link.getAttribute('data-act');
        const cur = this.shownSeqCounts.get(key) ?? SEQ_PREVIEW;
        if (act === 'more') this.shownSeqCounts.set(key, cur + SEQ_STEP);
        else this.shownSeqCounts.set(key, SEQ_PREVIEW);
        this.renderResults();
      });
    }
  }

  syncURL() {
    const newUrl = `${window.location.pathname}?players=${encodePlayers(this.configs)}${window.location.hash}`;
    window.history.replaceState(null, '', newUrl);
  }
}

function makeSection(name, label, openByDefault, innerHTML) {
  const el = document.createElement('div');
  el.className = `hud${openByDefault ? ' hud-open' : ''}`;
  el.dataset.section = name;
  el.innerHTML = `
    <button class="hud-toggle" type="button" aria-expanded="${openByDefault}">${label}</button>
    <div class="hud-body">${innerHTML}</div>
  `;
  return el;
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
