// Offscreen bitmap of the board, used when zoomed out far enough that drawing
// per-cell circles costs more than blitting a scaled image.

import { squareSpiral } from './simulation.js';

function parseColorToU32(clr) {
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
    this.dirty = false;
  }

  markDirty() {
    this.dirty = true;
  }

  update() {
    if (!this.dirty) return;
    const R = this.board.maxOccupiedRadius;
    if (R <= this.radius) return;
    const size = 2 * R + 1;
    this.canvas.width = size;
    this.canvas.height = size;
    const imageData = this.ctx.createImageData(size, size);
    const buf = new Uint32Array(imageData.data.buffer);
    for (const [i, j, _] of squareSpiral(R)) {
      const occupant = this.board.getOccupantPlayer(i, j);
      if (occupant !== null) {
        if (occupant.clrU32 === undefined) {
          occupant.clrU32 = parseColorToU32(occupant.bkgClr);
        }
        buf[(j + R) * size + (i + R)] = occupant.clrU32;
      }
    }
    this.ctx.putImageData(imageData, 0, 0);
    this.radius = R;
    this.dirty = false;
  }
}
