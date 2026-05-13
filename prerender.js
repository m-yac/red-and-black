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

// Growth factor applied to capR when the pixel buffer needs to resize. Larger
// values mean fewer (but bigger) allocations and more idle memory.
const CAP_GROWTH = 2;

export class Prerender {
  constructor(board) {
    this.board = board;
    // Double-buffered canvases: `canvas` is the live target view.js draws from.
    // `back` is where we paint the next frame so we can GPU-blit the previous
    // interior across resizes instead of re-uploading it.
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.back = document.createElement('canvas');
    this.backCtx = this.back.getContext('2d');
    this.radius = -1;
    this.safeR = -1;
    this.dirty = false;
    this.work = null;
    // Authoritative pixel buffer (RGBA packed little-endian). The canvas is a
    // write-only mirror — we never call getImageData, which would force a slow
    // GPU readback. stepRebuild writes into this buffer in place, so no per-
    // rebuild allocation is needed.
    //
    // `capR` is the radius the buffer was sized for; it grows geometrically so
    // most rebuilds reuse the existing allocation. Pixel for cell (i, j) lives
    // at index (j + capR) * stride + (i + capR), where stride = 2*capR + 1.
    this.capR = -1;
    this.pixels = new Uint32Array(0);
  }

  markDirty() {
    this.dirty = true;
  }

  // Swap every pixel matching oldU32 to newU32 in the existing bitmap.
  // Lets color edits skip a full re-spiral of the board.
  recolor(oldU32, newU32) {
    if (this.radius < 0) return;
    const R = this.radius;
    const stride = 2 * this.capR + 1;
    const offset = this.capR - R;
    const size = 2 * R + 1;
    const buf = this.pixels;
    // Only walk the valid (2R+1)² window — pixels outside it are stale junk
    // from prior capacity-resizes and must not be touched.
    for (let jj = 0; jj < size; jj++) {
      const start = (jj + offset) * stride + offset;
      const end = start + size;
      for (let k = start; k < end; k++) {
        if (buf[k] === oldU32) buf[k] = newU32;
      }
    }
    const imageData = new ImageData(
      new Uint8ClampedArray(buf.buffer), stride, stride,
    );
    this.ctx.putImageData(imageData, -offset, -offset, offset, offset, size, size);
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
    // safeR is the board.fullyScannedRadius captured at the last commit:
    // every player had finished scanning every cell of chebyshev radius
    // <= safeR, so those cells cannot have changed since. We rescan from
    // chebyshev = safeR + 1 outward (or from the start, if the bitmap
    // didn't extend that far).
    const prevSafeR = this.safeR;
    const T = Math.min(prevSafeR + 1, oldR + 1);

    // Grow the pixel buffer geometrically when R outgrows capR. Most rebuilds
    // skip this branch entirely and just write in-place into the existing buf.
    if (R > this.capR) {
      const baseCap = this.capR < 0 ? 0 : this.capR;
      const newCapR = Math.max(R, baseCap * CAP_GROWTH + 1);
      const newStride = 2 * newCapR + 1;
      const newPixels = new Uint32Array(newStride * newStride);
      if (oldR >= 0) {
        // Move the old centered window into the new centered offset.
        const oldStride = 2 * this.capR + 1;
        const oldOff = this.capR - oldR;
        const newOff = newCapR - oldR;
        const span = 2 * oldR + 1;
        for (let jj = 0; jj < span; jj++) {
          const srcStart = (jj + oldOff) * oldStride + oldOff;
          newPixels.set(
            this.pixels.subarray(srcStart, srcStart + span),
            (jj + newOff) * newStride + newOff,
          );
        }
      }
      this.pixels = newPixels;
      this.capR = newCapR;
    }

    // Cells with cheb < T are already correct in this.pixels from the prior
    // commit, so no seeding is needed. stepRebuild will overwrite cells with
    // cheb >= T (writing 0 for empty cells so junk from prior generations or
    // beyond-oldR isn't carried over).

    // Snapshot fullyScannedRadius *now*. The simulation will keep advancing
    // during the scan, so cells in already-scanned rows could be filled in
    // afterward. Using the start-of-scan value guarantees those cells
    // (cheb > snapshot) get rescanned on a later update().
    const nextSafeR = this.board.fullyScannedRadius;

    return { R, size: 2 * R + 1, T, j: -R, nextSafeR };
  }

  stepRebuild(w, budgetMs) {
    const { R, T } = w;
    const board = this.board;
    const buf = this.pixels;
    const stride = 2 * this.capR + 1;
    const center = this.capR;
    const start = performance.now();
    while (w.j <= R) {
      const j = w.j;
      const wide = Math.abs(j) >= T;
      const iStart1 = -R;
      const iEnd1 = wide ? R : -T;
      const iStart2 = wide ? R + 1 : T;
      const iEnd2 = R;
      const rowBase = (j + center) * stride + center;
      for (let i = iStart1; i <= iEnd1; i++) {
        const occupant = board.getOccupantPlayer(i, j);
        if (occupant !== null) {
          if (occupant.clrU32 === undefined) {
            occupant.clrU32 = parseColorToU32(occupant.bkgClr);
          }
          buf[rowBase + i] = occupant.clrU32;
        } else {
          buf[rowBase + i] = 0;
        }
      }
      for (let i = iStart2; i <= iEnd2; i++) {
        const occupant = board.getOccupantPlayer(i, j);
        if (occupant !== null) {
          if (occupant.clrU32 === undefined) {
            occupant.clrU32 = parseColorToU32(occupant.bkgClr);
          }
          buf[rowBase + i] = occupant.clrU32;
        } else {
          buf[rowBase + i] = 0;
        }
      }
      w.j++;
      if (performance.now() - start > budgetMs) return false;
    }
    return true;
  }

  commitRebuild(w) {
    const { R, size, T, nextSafeR } = w;
    const oldR = this.radius;
    const stride = 2 * this.capR + 1;
    const bufOff = this.capR - R;  // imageData coord of canvas (0, 0)

    // Write into the back canvas, then swap it to the front. Resizing a canvas
    // wipes its contents, so we resize `back` (whose old contents we don't
    // need) and leave the live `canvas` alone until the swap.
    const dstCanvas = this.back;
    const dstCtx = this.backCtx;
    dstCanvas.width = size;
    dstCanvas.height = size;

    // Cells with chebyshev radius < T are still valid from the prior commit.
    // GPU-blit them from the previous canvas into the centered offset of the
    // new one. Everything outside this interior is stale and will be
    // overwritten below.
    if (oldR >= 0 && T > 0) {
      const blitOffset = R - oldR;
      dstCtx.drawImage(this.canvas, blitOffset, blitOffset);
    }

    // Upload only the dirty annulus (cheb >= T) — split into up to four
    // rectangles around the preserved interior square. When T <= 0 nothing is
    // preserved, so just upload the full (2R+1)² centered window.
    //
    // dx/dy are negative when capR > R, shifting the (stride × stride)
    // imageData so the centered (2R+1)² window lines up with the canvas.
    const imageData = new ImageData(
      new Uint8ClampedArray(this.pixels.buffer), stride, stride,
    );
    const dx = -bufOff, dy = -bufOff;
    if (T <= 0) {
      dstCtx.putImageData(imageData, dx, dy, bufOff, bufOff, size, size);
    } else {
      const topH = R - T + 1;          // canvas rows [0, R-T]
      const botY = R + T;              // canvas rows [R+T, size-1]
      const botH = size - botY;
      const midY = R - T + 1;          // canvas rows [R-T+1, R+T-1]
      const midH = 2 * T - 1;
      const leftW = R - T + 1;         // canvas cols [0, R-T]
      const rightX = R + T;            // canvas cols [R+T, size-1]
      const rightW = size - rightX;
      dstCtx.putImageData(imageData, dx, dy, bufOff,          bufOff,          size,   topH);
      dstCtx.putImageData(imageData, dx, dy, bufOff,          bufOff + botY,   size,   botH);
      dstCtx.putImageData(imageData, dx, dy, bufOff,          bufOff + midY,   leftW,  midH);
      dstCtx.putImageData(imageData, dx, dy, bufOff + rightX, bufOff + midY,   rightW, midH);
    }

    // Swap roles: the canvas we just wrote becomes the live one.
    this.back = this.canvas;
    this.backCtx = this.ctx;
    this.canvas = dstCanvas;
    this.ctx = dstCtx;
    this.radius = R;
    this.safeR = nextSafeR;
  }
}
