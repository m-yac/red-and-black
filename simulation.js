// Based on: https://oeis.org/A392177/a392177_1.py.txt

import { BitGrid } from './bitGrid.js';

function popcount32(n) {
  n = n - ((n >> 1) & 0x55555555);
  n = (n & 0x33333333) + ((n >> 2) & 0x33333333);
  return (((n + (n >> 4)) & 0x0F0F0F0F) * 0x01010101) >> 24;
}

export function* squareSpiral(r) {
  let i = 0; let j = 0; let di = 1; let dj = 0;
  yield [i, j, 0];
  for (let L = 1; true; L++) {
    for (let s = 0; s < 2; s++) {
      for (let k = 0; k < L; k++) {
        i += di;
        j += dj;
        yield [i, j, L + ((s == 1 || k == L-1) ? 1 : 0)];
      }
      [di, dj] = [dj, -di]
      if (r !== undefined && L == 2 * r + 1) { return; }
    }
  }
}

export class Board {
  constructor() {
    this.bits = new BitGrid();
    this.players = [];
    this.maxOccupiedRadius = 0;
    this.unoccupiedSequence = new Map();
  }

  isOccupied(i, j) {
    return this.bits.get(i, j) & 1;
  }

  getOccupantPlayer(i, j) {
    const bits = this.bits.get(i, j);
    if (!(bits & 1)) return null;
    for (const player of this.players) {
      if (bits & player.bitmask) return player;
    }
    return null;
  }

  newPlayer(dx, dy, bkgClr, txtClr) {
    const player = new Player(this, dx, dy, bkgClr, txtClr);
    this.players.push(player);
    return player;
  }

  reconfigure(configs) {
    this.bits = new BitGrid();
    this.players = [];
    this.maxOccupiedRadius = 0;
    this.unoccupiedSequence = new Map();
    for (const cfg of configs) {
      this.newPlayer(cfg.dx, cfg.dy, cfg.bkgClr, cfg.txtClr);
    }
  }

  doRound() {
    for (const player of this.players) {
      player.takeTurn();
    }
  }
}

export class Player {
  constructor(board, dx, dy, bkgClr, txtClr) {
    this.board = board;
    this.dx = dx;
    this.dy = dy;
    this.bkgClr = bkgClr;
    this.txtClr = txtClr;
    this.idx = board.players.length;
    this.bitmask = 1 << (this.idx + 1);
    this.squaresNotSeen = squareSpiral(); // g in the Python script
    this.K = [[dx, dy], [dy, dx], [-dy, dx], [-dx, dy], [-dx, -dy], [-dy, -dx], [dy, -dx], [dx, -dy]];
    this.m = -1;
    this.sequence = [];
  }

  takeTurn() {
    for (let k = this.m+1; true; k++) {
      const [i, j, L] = this.squaresNotSeen.next().value;
      const bits = this.board.bits.get(i, j);
      // Here is where we differ from the Python script's approach:
      // If the square is unoccupied (i.e. `bits & 1 == 0`) and at most it is
      // targeted by this player (i.e. everything but `bits & this.bitmask` is
      // unset), then occupy that square and remember its targets
      // (Or, if avoidSelf is true, only do this if the square is entirely
      // unoccupied)
      if ((bits | this.bitmask) == this.bitmask && this.board.players.length != 1 ||
          bits == 0 && this.board.players.length == 1) {
        this.board.bits.set(i, j, 1 | this.bitmask);
        const radius = Math.ceil((L - 1) / 2);
        this.board.maxOccupiedRadius = Math.max(this.board.maxOccupiedRadius, radius);
        for (const [ti, tj] of this.K) {
          const tv = this.board.bits.get(i + ti, j + tj);
          if (!(tv & 1) /* unoccupied */) {
            this.board.bits.set(i + ti, j + tj, tv | this.bitmask);
          }
        }
        this.m = k;
        this.sequence.push([k, radius]);
        return;
      }
      // If we encounter a cell which is claimed by more than one player, (i.e.
      // is impossible to be occupied), then add it to the unoccupied sequence
      if (!this.board.isOccupied(i, j) && popcount32(this.board.bits.get(i, j)) > 1) {
        const radius = Math.ceil((L - 1) / 2);
        this.board.unoccupiedSequence.set(k, radius);
      }
    }
  }
}
