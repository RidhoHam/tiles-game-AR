import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

test('index.html and ar.html include Lucide icons and clean web fonts', () => {
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const arHtml = fs.readFileSync(path.resolve('ar.html'), 'utf-8');

  assert.ok(indexHtml.includes('lucide'), 'index.html must include Lucide icon library');
  assert.ok(arHtml.includes('lucide'), 'ar.html must include Lucide icon library');
  assert.ok(indexHtml.includes('Inter'), 'index.html must load Inter font');
  assert.ok(arHtml.includes('Inter'), 'ar.html must load Inter font');
});

test('index.html retains all required control IDs and has 0 emojis', () => {
  const html = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const requiredIds = [
    'midiFile', 'demoBtn', 'dropDemoBtn', 'canvas', 'playBtn', 'resetBtn',
    'speed', 'speedValue', 'lanes', 'tileWidthSelect', 'gameMode',
    'autoMutePreset', 'soundType', 'soundBtn', 'volume', 'exportBtn',
    'timeline', 'timeline-progress', 'songName', 'bpm', 'noteCount', 'time',
    'status', 'drop', 'gameHud', 'scoreVal', 'comboVal', 'chordSlamBtn',
    'chord-hint', 'lane-keys', 'viewTilesBtn', 'viewRollBtn',
    'lanesControlGroup', 'tileWidthControlGroup', 'pianoRangeControlGroup',
    'pianoRangeSelect', 'settingsModal', 'openSettingsBtn', 'closeSettingsBtn'
  ];

  for (const id of requiredIds) {
    assert.ok(html.includes(`id="${id}"`), `Missing required element ID: ${id}`);
  }

  const bannedEmojis = ['🎮', '🎹', '🥽', '📂', '🎵', '⚡', '⏸️', '↺', '🔊', '📥', '✨', '🖐️'];
  for (const emoji of bannedEmojis) {
    assert.ok(!html.includes(emoji), `index.html contains banned AI emoji: ${emoji}`);
  }
});

test('style.css enforces zero gradients and zero neon glow', () => {
  const css = fs.readFileSync(path.resolve('src/style.css'), 'utf-8');
  assert.ok(!css.includes('linear-gradient'), 'style.css must not contain linear-gradient');
  assert.ok(!css.includes('-webkit-background-clip'), 'style.css must not contain background-clip gradient text');
  assert.ok(!css.includes('--primary-glow'), 'style.css must not contain neon glow variable');
  assert.ok(css.includes('--bg-canvas'), 'style.css must define standard dark token --bg-canvas');
});

test('ar.html retains all required AR IDs and has 0 emojis', () => {
  const html = fs.readFileSync(path.resolve('ar.html'), 'utf-8');
  const requiredArIds = [
    'ar-container', 'gesture-canvas', 'perf-badge', 'fps-display', 'hands-display',
    'scan-banner', 'btn-place-arena', 'btn-skip-placement', 'btn-scan-mirror', 'btn-scan-direction',
    'song-modal', 'viewTilesBtn', 'viewRollBtn', 'arGameModeTabs', 'arFingerModeTabs',
    'btn-direct-play', 'btn-start-calibration', 'song-file-input',
    'calib-modal', 'hud-layer', 'hud-score', 'hud-accuracy', 'hud-combo-container', 'hud-combo',
    'timeline-progress', 'time-elapsed', 'hud-mode-badge', 'hud-slam-badge',
    'btn-hud-gamemode', 'btn-hud-fingers', 'btn-hud-mirror', 'btn-hud-direction', 'btn-mute', 'btn-exit',
    'judgement-layer', 'countdown-overlay', 'countdown-number',
    'result-modal', 'result-rank', 'result-score', 'result-accuracy', 'result-max-combo',
    'result-chord-accuracy', 'result-perfect', 'result-good', 'result-miss',
    'btn-result-songs', 'btn-result-replay', 'ar-toast'
  ];

  for (const id of requiredArIds) {
    assert.ok(html.includes(`id="${id}"`) || html.includes(`id=${id}`), `Missing required AR ID: ${id}`);
  }

  const bannedEmojis = ['🖐️', '🔒', '🔄', '⬇️', '🎮', '🎹', '▶️', '⏸️', '✌️', '✨', '🔊', '✕', '🥽'];
  for (const emoji of bannedEmojis) {
    assert.ok(!html.includes(emoji), `ar.html contains banned AI emoji: ${emoji}`);
  }
});

test('ar.css enforces zero gradients and eliminates bold neon colors', () => {
  const css = fs.readFileSync(path.resolve('src/ar.css'), 'utf-8');
  assert.ok(!css.includes('linear-gradient'), 'ar.css must not contain linear-gradient');
  assert.ok(!css.includes('-webkit-background-clip'), 'ar.css must not contain gradient text');
  assert.ok(!css.includes('#ec4899'), 'ar.css must eliminate neon magenta');
  assert.ok(!css.includes('#38bdf8'), 'ar.css must eliminate neon cyan');
  assert.ok(!css.includes('#facc15'), 'ar.css must eliminate bold gold');
  assert.ok(!css.includes('animation: bannerFloat'), 'ar.css must remove floating banner animation');
});

test('ar.html provides re-canvas controls and index.html redirects to AR by default', () => {
  const indexHtml = fs.readFileSync(path.resolve('index.html'), 'utf-8');
  const arHtml = fs.readFileSync(path.resolve('ar.html'), 'utf-8');
  const arMainJs = fs.readFileSync(path.resolve('src/ar-main.js'), 'utf-8');

  // 1. 2D mode disabled: index.html redirects to ar.html
  assert.ok(indexHtml.includes('url=ar.html') || indexHtml.includes("replace('ar.html')"), 'index.html must redirect to ar.html');

  // 2. Re-canvas buttons in AR HUD, modal, and results
  assert.ok(arHtml.includes('id="btn-recanvas"'), 'ar.html must contain in-game HUD #btn-recanvas button');
  assert.ok(arHtml.includes('id="btn-recanvas-setup"'), 'ar.html must contain setup modal #btn-recanvas-setup button');
  assert.ok(arHtml.includes('id="btn-result-recanvas"'), 'ar.html must contain summary #btn-result-recanvas button');

  // 3. Handlers and key shortcut in ar-main.js
  assert.ok(arMainJs.includes('openReCanvasSurface'), 'ar-main.js must define openReCanvasSurface');
  assert.ok(arMainJs.includes('btn-recanvas'), 'ar-main.js must bind #btn-recanvas listener');
});





