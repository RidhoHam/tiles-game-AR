import '../styles/tokens.css';
import '../styles/app.css';
import { createGameController } from './game-controller.js';

const canvas = document.querySelector('#scene');
const uiRoot = document.querySelector('#ui');
// MindAR mounts its video + overlay inside this container. It must be a real
// element (not the UI root) so the camera feed cannot be covered by panels.
const arRoot = document.querySelector('#ar-root');

const controller = createGameController({ canvas, root: uiRoot, container: arRoot });
controller.start();
window.sandWar = controller;
