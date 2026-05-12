import { Board } from './simulation.js';
import { View } from './view.js';

const canvas = document.querySelector('canvas');

const board = new Board();
board.newPlayer(2, 1, '#111', '#eee');
board.newPlayer(2, 1, '#f22', '#111');

const view = new View(canvas, board);
view.resize();
view.render();
