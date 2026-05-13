// Offscreen bitmap of the board, used when zoomed out far enough that drawing
// per-cell circles costs more than blitting a scaled image.

export function parseColorToU32(clr) {
  // Packs RGBA as a little-endian uint32 (0xAABBGGRR in memory).
  let r, g, b;
  if (clr.length === 4) {
    r = parseInt(clr[1], 16) * 17;
    g = parseInt(clr[2], 16) * 17;
    b = parseInt(clr[3], 16) * 17;
  } else {
    r = parseInt(clr.slice(1, 3), 16);
    g = parseInt(clr.slice(3, 5), 16);
    b = parseInt(clr.slice(5, 7), 16);
  }
  return ((0xff << 24) | (b << 16) | (g << 8) | r) >>> 0;
}

export class Prerender {
  constructor(board) {
    this.board = board;
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.radius = -1;
    this.safeR = 0;
    this.dirty = false;
    this.work = null;
  }

  markDirty() {
    this.dirty = true;
  }

  // Swap every pixel matching oldU32 to newU32 in the existing bitmap.
  // Lets color edits skip a full re-spiral of the board.
  recolor(oldU32, newU32) {
    if (this.radius < 0) return;
    const size = this.canvas.width;
    const imageData = this.ctx.getImageData(0, 0, size, size);
    const buf = new Uint32Array(imageData.data.buffer);
    for (let k = 0; k < buf.length; k++) {
      if (buf[k] === oldU32) buf[k] = newU32;
    }
    this.ctx.putImageData(imageData, 0, 0);
  }

  // Per-frame time budget for the progressive rebuild. Smaller = smoother
  // frames but a rebuild takes more frames to finish.
  static STEP_BUDGET_MS = 4;

  update() {
    if (!this.work && this.dirty) {
      const R = this.board.maxOccupiedRadius;
      if (R > this.radius) this.work = this.startRebuild(R);
      this.dirty = false;
    }
    if (!this.work) return;
    if (this.stepRebuild(this.work, Prerender.STEP_BUDGET_MS)) {
      this.commitRebuild(this.work);
      this.work = null;
    }
  }

  startRebuild(R) {
    const oldR = this.radius;
    // Between the last commit and now, each player's spiral only advanced,
    // so a cell at chebyshev C was newly filled only if some player had
    // p.radius <= C at the last commit. Cells with C < prevSafeR are
    // therefore guaranteed unchanged since then.
    const prevSafeR = this.safeR;
    const T = Math.min(prevSafeR, oldR + 1);

    const size = 2 * R + 1;
    const buf = new Uint32Array(size * size);
    // Seed with old pixels at the centered offset. We can't write to the
    // live canvas yet — drawImage during the rebuild must keep using the
    // old-radius bitmap, since this.radius hasn't moved.
    if (oldR >= 0) {
      const oldSize = 2 * oldR + 1;
      const old = this.ctx.getImageData(0, 0, oldSize, oldSize);
      const oldBuf = new Uint32Array(old.data.buffer);
      const offset = R - oldR;
      for (let jj = 0; jj < oldSize; jj++) {
        buf.set(
          oldBuf.subarray(jj * oldSize, (jj + 1) * oldSize),
          (jj + offset) * size + offset,
        );
      }
    }

    // Snapshot safeR *now*. The simulation will keep advancing during the
    // scan, so cells in already-scanned rows could be filled in afterward.
    // Using the start-of-scan minimum guarantees those cells (cheb >=
    // that minimum) get rescanned on a later update().
    let nextSafeR = Infinity;
    for (const p of this.board.players) {
      if (p.radius < nextSafeR) nextSafeR = p.radius;
    }
    if (!Number.isFinite(nextSafeR)) nextSafeR = 0;

    return { R, size, T, buf, j: -R, nextSafeR };
  }

  stepRebuild(w, budgetMs) {
    const { R, size, T, buf } = w;
    const board = this.board;
    const start = performance.now();
    while (w.j <= R) {
      const j = w.j;
      const wide = Math.abs(j) >= T;
      const iStart1 = -R;
      const iEnd1 = wide ? R : -T;
      const iStart2 = wide ? R + 1 : T;
      const iEnd2 = R;
      const rowBase = (j + R) * size + R;
      for (let i = iStart1; i <= iEnd1; i++) {
        const occupant = board.getOccupantPlayer(i, j);
        if (occupant !== null) {
          if (occupant.clrU32 === undefined) {
            occupant.clrU32 = parseColorToU32(occupant.bkgClr);
          }
          buf[rowBase + i] = occupant.clrU32;
        }
      }
      for (let i = iStart2; i <= iEnd2; i++) {
        const occupant = board.getOccupantPlayer(i, j);
        if (occupant !== null) {
          if (occupant.clrU32 === undefined) {
            occupant.clrU32 = parseColorToU32(occupant.bkgClr);
          }
          buf[rowBase + i] = occupant.clrU32;
        }
      }
      w.j++;
      if (performance.now() - start > budgetMs) return false;
    }
    return true;
  }

  commitRebuild(w) {
    this.canvas.width = w.size;
    this.canvas.height = w.size;
    const imageData = new ImageData(
      new Uint8ClampedArray(w.buf.buffer), w.size, w.size,
    );
    this.ctx.putImageData(imageData, 0, 0);
    this.radius = w.R;
    this.safeR = w.nextSafeR;
  }
}
