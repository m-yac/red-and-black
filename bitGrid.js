// Dense 2D grid of u32s indexed by pairs of signed integers, centered at (0,0).
// Backed by a single flat Uint32Array — get/set are one bounds check and one
// typed-array load/store. Capacity grows geometrically when a set falls
// outside the current radius. Out-of-bounds reads return 0.

const INITIAL_CAP_R = 7;
const GROWTH = 2;

export class BitGrid {
  constructor() {
    this.capR = INITIAL_CAP_R;
    this.stride = 2 * this.capR + 1;
    this.data = new Uint32Array(this.stride * this.stride);
  }

  get(i, j) {
    const capR = this.capR;
    if (i < -capR || i > capR || j < -capR || j > capR) return 0;
    return this.data[(j + capR) * this.stride + (i + capR)];
  }

  set(i, j, v) {
    let capR = this.capR;
    if (i < -capR || i > capR || j < -capR || j > capR) {
      const need = Math.abs(i) > Math.abs(j) ? Math.abs(i) : Math.abs(j);
      this.grow(need);
      capR = this.capR;
    }
    this.data[(j + capR) * this.stride + (i + capR)] = v;
  }

  grow(needR) {
    let newCapR = this.capR;
    while (newCapR < needR) newCapR = newCapR * GROWTH + 1;
    const newStride = 2 * newCapR + 1;
    const newData = new Uint32Array(newStride * newStride);
    const oldStride = this.stride;
    const offset = newCapR - this.capR;
    for (let jj = 0; jj < oldStride; jj++) {
      newData.set(
        this.data.subarray(jj * oldStride, (jj + 1) * oldStride),
        (jj + offset) * newStride + offset,
      );
    }
    this.data = newData;
    this.stride = newStride;
    this.capR = newCapR;
  }
}
