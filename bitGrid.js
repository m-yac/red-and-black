// Sparse 2D grid of integers indexed by pairs of signed integers.
// Negative coordinates are interleaved with non-negative ones so storage
// grows in both directions without offsetting indices ahead of time.

function idx(n) {
  return n >= 0 ? (2 * n + 1) : (-2 * n);
}

export class BitGrid {
  constructor() {
    this.rows = [];
  }

  get(i, j) {
    const ii = idx(i);
    if (ii >= this.rows.length) return 0;
    const row = this.rows[ii];
    const jj = idx(j);
    if (jj >= row.length) return 0;
    return row[jj];
  }

  modify(i, j, callback) {
    const ii = idx(i);
    const jj = idx(j);
    while (ii >= this.rows.length) this.rows.push([]);
    const row = this.rows[ii];
    while (jj >= row.length) row.push(0);
    row[jj] = callback(row[jj]);
  }

  set(i, j, v) {
    this.modify(i, j, () => v);
  }
}
