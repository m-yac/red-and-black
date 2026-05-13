import { Board } from './simulation.js';
import { View } from './view.js';
import { HUD, parsePlayersFromURL } from './hud.js';

const canvas = document.querySelector('canvas');

const board = new Board();
const urlConfigs = parsePlayersFromURL();
if (urlConfigs) {
  for (const c of urlConfigs) board.newPlayer(c.dx, c.dy, c.bkgClr, c.txtClr);
} else {
  board.newPlayer(2, 1, '#111', '#eee');
  board.newPlayer(2, 1, '#f22', '#111');
}

const view = new View(canvas, board);
view.resize();
view.render();

const hud = new HUD(board, view);
view.onRender = () => hud.renderResults();
