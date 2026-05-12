import { squareSpiral } from './simulation.js';
import { Zoom } from './input.js';
import { Prerender } from './prerender.js';

// Zoom level (in screen pixels per cell) where the two render modes blend.
// Below FADE_LOW: only the prerendered bitmap is shown — fast when zoomed out.
// Above FADE_HIGH: only the live circle rendering — sharp when zoomed in.
// In between: linear cross-fade.
const FADE_LOW = 32;
const FADE_HIGH = 64;

// Initial zoom factor: one cell occupies 1/BASE_SCALE screen pixels when
// the user's zoom is at its default of 1.
const BASE_SCALE = 1 / 128;

// Wallclock budget per simulation tick before yielding back to the browser,
// so the page stays responsive even while the board grows quickly.
const ROUND_BUDGET_MS = 8;

// Off-screen, only refresh the prerender bitmap once the board has grown by
// this many cells, to amortize its O(R^2) regeneration cost.
const PRERENDER_GROWTH_THRESHOLD = 32;

// Source size for the hover-stripe tile. Large so we always scale down to
// the on-screen tile size, which avoids the pixelation and jitter you'd get
// from rebuilding (and integer-rounding) the tile each zoom.
const STRIPE_TILE_SIZE = 256;

// Number of leading cells (in spiral order) to label with their index, as a
// visual debug aid. Alpha fades to zero by this index.
const LABEL_COUNT = 256;

export class View {
  constructor(canvas, board) {
    this.canvas = canvas;
    this.board = board;
    this.ctx = canvas.getContext('2d');
    this.ctx.imageSmoothingEnabled = false;

    this.checkerboardPattern = makeCheckerboardPattern(this.ctx);
    this.prerender = new Prerender(board);
    this.zoom = new Zoom(canvas, () => this.requestRender());

    // Radius of the screen measured in cells. Recomputed each render().
    this.screenRadius = 0;

    // Debounce flags for the two independent loops below.
    this.renderQueued = false;
    this.roundsQueued = false;

    // board.maxOccupiedRadius the last time we refreshed the prerender bitmap.
    // `undefined` means "reset to current radius on the next step".
    this.lastPrerenderedRadius = undefined;

    // Pointer hover position in canvas pixels, or null. Cached per-color
    // stripe patterns are built lazily for hover highlights.
    this.hoverPos = null;
    this.stripePatterns = new Map();
    this.attachHoverListeners();

    window.addEventListener('resize', () => this.resize());
  }

  // Call after board.reconfigure() to refresh derived state and redraw.
  resetForNewBoard() {
    this.prerender.radius = -1;
    this.prerender.markDirty();
    this.lastPrerenderedRadius = undefined;
    this.requestRender();
  }

  attachHoverListeners() {
    const update = (e) => {
      // Don't fight the pinch gesture — two-pointer touches are zooming.
      if (e.pointerType === 'touch' && this.zoom.pointerEvts.size >= 2) {
        this.hoverPos = null;
      } else {
        const rect = this.canvas.getBoundingClientRect();
        const pr = window.devicePixelRatio || 1;
        this.hoverPos = {
          x: (e.clientX - rect.left) * pr,
          y: (e.clientY - rect.top) * pr,
        };
      }
      this.requestRender();
    };
    const clear = (e) => {
      // Touch tap can persist briefly; mouse leave should clear.
      if (e && e.pointerType === 'touch') return;
      this.hoverPos = null;
      this.requestRender();
    };
    this.canvas.addEventListener('pointermove', update);
    this.canvas.addEventListener('pointerdown', update);
    this.canvas.addEventListener('pointerleave', clear);
    this.canvas.addEventListener('pointercancel', () => {
      this.hoverPos = null;
      this.requestRender();
    });
  }

  getStripePattern(color) {
    let p = this.stripePatterns.get(color);
    if (p) return p;
    // Render at a large fixed size so any reasonable down-scale stays smooth.
    const size = STRIPE_TILE_SIZE;
    const tile = document.createElement('canvas');
    tile.width = size;
    tile.height = size;
    const tc = tile.getContext('2d');
    tc.strokeStyle = color;
    tc.lineWidth = size / 4;
    tc.lineCap = 'square';
    tc.beginPath();
    for (let k = -1; k <= 1; k++) {
      tc.moveTo(k * size, size);
      tc.lineTo((k + 1) * size, 0);
    }
    tc.stroke();
    p = this.ctx.createPattern(tile, 'repeat');
    this.stripePatterns.set(color, p);
    return p;
  }

  resize() {
    const pixelRatio = window.devicePixelRatio || 1;
    this.canvas.width = Math.floor(window.innerWidth * pixelRatio);
    this.canvas.height = Math.floor(window.innerHeight * pixelRatio);
    this.requestRender();
  }

  // ---- Loops ---------------------------------------------------------
  //
  // Two independent loops drive the view:
  //   - requestRender: rAF-debounced redraw of the current board state.
  //   - requestAdditionalRounds: setTimeout-paced simulation stepping that
  //     keeps the board large enough to fill the screen.
  // They each queue the other as needed.

  requestRender() {
    if (this.renderQueued) return;
    this.renderQueued = true;
    requestAnimationFrame(() => {
      this.renderQueued = false;
      this.render();
    });
  }

  requestAdditionalRounds() {
    if (this.roundsQueued) return;
    this.roundsQueued = true;
    setTimeout(() => {
      this.roundsQueued = false;
      if (this.lastPrerenderedRadius === undefined) {
        this.lastPrerenderedRadius = this.board.maxOccupiedRadius;
      }
      const start = performance.now();
      do {
        this.board.doRound();
        // As soon as new cells become visible, stop stepping and redraw —
        // every additional cell would be on-screen and the user should see it.
        if (this.screenRadius < this.board.maxOccupiedRadius) {
          this.prerender.markDirty();
          this.lastPrerenderedRadius = undefined;
          this.requestRender();
          return;
        }
      } while (performance.now() - start < ROUND_BUDGET_MS);
      // While the board is growing off-screen, only re-prerender after enough
      // growth to justify regenerating the bitmap.
      if (this.board.maxOccupiedRadius - this.lastPrerenderedRadius
          > PRERENDER_GROWTH_THRESHOLD) {
        this.prerender.markDirty();
        this.lastPrerenderedRadius = this.board.maxOccupiedRadius;
        this.requestRender();
      }
      this.requestAdditionalRounds();
    }, 0);
  }

  // ---- Render passes -------------------------------------------------

  render() {
    const w = this.canvas.width;
    const h = this.canvas.height;
    const totalScale = BASE_SCALE * this.zoom.getScale();
    const cellPx = 1 / totalScale;

    this.drawCheckerboard(w, h, cellPx);

    // Cells-from-origin that just barely fit on screen.
    this.screenRadius = Math.ceil(Math.max(w, h) * totalScale / 2);
    if (this.board.maxOccupiedRadius <= this.screenRadius) {
      this.requestAdditionalRounds();
    }

    const imageAlpha = clamp01((FADE_HIGH - cellPx) / (FADE_HIGH - FADE_LOW));
    const liveAlpha = 1 - imageAlpha;

    const hover = (liveAlpha > 0 && this.hoverPos)
      ? this.resolveHover(w, h, cellPx) : null;
    if (hover) this.drawHoverStripes(hover, w, h, cellPx, liveAlpha);
    if (imageAlpha > 0) this.drawPrerendered(w, h, cellPx, imageAlpha);
    if (liveAlpha > 0)  this.drawLiveCells(w, h, cellPx, liveAlpha);
  }

  drawCheckerboard(w, h, cellPx) {
    // Anchor one tile at the canvas center, then scale the 2×2 pattern up so
    // each pattern pixel is exactly one cell wide.
    this.checkerboardPattern.setTransform(new DOMMatrix()
      .translate(w/2 - 0.5 * cellPx, h/2 - 0.5 * cellPx)
      .scale(cellPx, cellPx));
    this.ctx.imageSmoothingEnabled = false;
    this.ctx.fillStyle = this.checkerboardPattern;
    this.ctx.fillRect(0, 0, w, h);
  }

  drawPrerendered(w, h, cellPx, alpha) {
    this.prerender.update();
    const R = this.prerender.radius;
    const { ctx } = this;
    ctx.imageSmoothingEnabled = false;
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.prerender.canvas,
                  w/2 - (R + 0.5) * cellPx,
                  h/2 - (R + 0.5) * cellPx,
                  (2 * R + 1) * cellPx,
                  (2 * R + 1) * cellPx);
    ctx.globalAlpha = 1;
  }

  drawLiveCells(w, h, cellPx, alpha) {
    const { ctx, board } = this;
    ctx.globalAlpha = alpha;
    let idx = 0;
    for (const [i, j, _] of squareSpiral(this.screenRadius)) {
      const cx = i * cellPx + w/2;
      const cy = j * cellPx + h/2;
      const occupant = board.getOccupantPlayer(i, j);
      let txtClr = '#000';
      if (occupant !== null) {
        txtClr = occupant.txtClr;
        ctx.beginPath();
        ctx.arc(cx, cy, 0.48 * cellPx, 0, 2 * Math.PI);
        ctx.fillStyle = occupant.bkgClr;
        ctx.fill();
      }
      if (idx < LABEL_COUNT) {
        ctx.fillStyle = txtClr;
        ctx.font = `${0.4 * cellPx}px serif`;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        // Fades from 1 (clamped) at idx=0 to 0 at idx=LABEL_COUNT/2.
        ctx.globalAlpha = (LABEL_COUNT - idx) / (LABEL_COUNT / 2);
        ctx.fillText(`${idx}`, cx, cy);
        ctx.globalAlpha = 1;
      }
      idx++;
    }
    ctx.globalAlpha = 1;
  }

  resolveHover(w, h, cellPx) {
    const hi = Math.round((this.hoverPos.x - w/2) / cellPx);
    const hj = Math.round((this.hoverPos.y - h/2) / cellPx);
    if (Math.abs(hi) > this.screenRadius || Math.abs(hj) > this.screenRadius) {
      return null;
    }
    return { hi, hj, occupant: this.board.getOccupantPlayer(hi, hj) };
  }

  drawHoverStripes({ hi, hj, occupant }, w, h, cellPx, alpha) {
    if (occupant === null) return;
    const { ctx } = this;
    ctx.globalAlpha = alpha;
    // Tile spans cellPx/3 — 3 stripes per cell. Scale a fixed large source
    // tile down smoothly so it doesn't pixelate or jitter as the user zooms.
    // Anchored at the canvas center so stripes line up across adjacent cells.
    const pattern = this.getStripePattern(occupant.bkgClr);
    const s = (cellPx / 3) / STRIPE_TILE_SIZE;
    pattern.setTransform(new DOMMatrix().translate(w/2, h/2).scale(s, s));
    ctx.fillStyle = pattern;
    for (const [ti, tj] of occupant.K) {
      this.drawStripedCell(hi + ti, hj + tj, w, h, cellPx);
    }
    ctx.globalAlpha = 1;
  }

  drawStripedCell(i, j, w, h, cellPx) {
    const cx = i * cellPx + w/2;
    const cy = j * cellPx + h/2;
    const half = 0.5 * cellPx;
    this.ctx.fillRect(cx - half, cy - half, 2 * half, 2 * half);
  }

}

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function makeCheckerboardPattern(ctx) {
  // 2×2 tile where opposite corners share a color, scaled up at draw time.
  const tile = document.createElement('canvas');
  tile.width = 2;
  tile.height = 2;
  const tileCtx = tile.getContext('2d');
  tileCtx.fillStyle = '#fff';
  tileCtx.fillRect(0, 0, 2, 2);
  tileCtx.fillStyle = '#ccc';
  tileCtx.fillRect(0, 0, 1, 1);
  tileCtx.fillRect(1, 1, 1, 1);
  return ctx.createPattern(tile, 'repeat');
}
