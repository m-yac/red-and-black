import { Board } from './simulation.js';
import { View } from './view.js';
import { COLOR_PALETTE, HUD, parsePlayersFromURL } from './hud.js';

const canvas = document.querySelector('canvas');

const board = new Board();
const urlConfigs = parsePlayersFromURL();
if (urlConfigs) {
  for (const c of urlConfigs) board.newPlayer(c.dx, c.dy, c.bkgClr, c.txtClr);
} else {
  board.newPlayer(2, 1, COLOR_PALETTE[0].bkg, COLOR_PALETTE[0].txt);
  board.newPlayer(2, 1, COLOR_PALETTE[1].bkg, COLOR_PALETTE[1].txt);
}

const view = new View(canvas, board);
view.resize();
view.render();

const hud = new HUD(board, view);
view.onRender = () => hud.renderResults();
