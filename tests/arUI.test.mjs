import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  UI_STATES,
  UIStateMachine,
  ScoreManager,
  CalibrationManager,
  getComboMultiplier,
  ARUIController
} from '../src/ui/arUI.js';

test('getComboMultiplier applies correct tier multipliers', () => {
  assert.equal(getComboMultiplier(0), 1.0);
  assert.equal(getComboMultiplier(5), 1.0);
  assert.equal(getComboMultiplier(9), 1.0);
  assert.equal(getComboMultiplier(10), 1.2);
  assert.equal(getComboMultiplier(24), 1.2);
  assert.equal(getComboMultiplier(25), 1.5);
  assert.equal(getComboMultiplier(49), 1.5);
  assert.equal(getComboMultiplier(50), 2.0);
  assert.equal(getComboMultiplier(100), 2.0);
});

test('ScoreManager calculates Perfect and Good scores with combo multipliers', () => {
  const scoreMgr = new ScoreManager();
  assert.equal(scoreMgr.score, 0);
  assert.equal(scoreMgr.combo, 0);
  assert.equal(scoreMgr.maxCombo, 0);

  // 1. Perfect hit at combo 0 -> multiplier 1.0, score +100
  const hit1 = scoreMgr.recordHit('PERFECT');
  assert.equal(hit1.baseScore, 100);
  assert.equal(hit1.multiplier, 1.0);
  assert.equal(hit1.points, 100);
  assert.equal(scoreMgr.score, 100);
  assert.equal(scoreMgr.combo, 1);
  assert.equal(scoreMgr.maxCombo, 1);
  assert.equal(scoreMgr.perfectCount, 1);

  // 2. Good hit at combo 1 -> multiplier 1.0, score +70
  const hit2 = scoreMgr.recordHit('GOOD');
  assert.equal(hit2.baseScore, 70);
  assert.equal(hit2.multiplier, 1.0);
  assert.equal(hit2.points, 70);
  assert.equal(scoreMgr.score, 170);
  assert.equal(scoreMgr.combo, 2);
  assert.equal(scoreMgr.goodCount, 1);

  // Advance combo to 9
  for (let i = 0; i < 7; i++) {
    scoreMgr.recordHit('PERFECT');
  }
  assert.equal(scoreMgr.combo, 9);

  // 10th hit: combo becomes 10 -> multiplier 1.2x
  const hit10 = scoreMgr.recordHit('PERFECT');
  assert.equal(scoreMgr.combo, 10);
  assert.equal(hit10.multiplier, 1.2);
  assert.equal(hit10.points, 120);

  // Advance combo to 24
  for (let i = 0; i < 14; i++) {
    scoreMgr.recordHit('PERFECT');
  }
  assert.equal(scoreMgr.combo, 24);

  // 25th hit: combo becomes 25 -> multiplier 1.5x
  const hit25 = scoreMgr.recordHit('PERFECT');
  assert.equal(scoreMgr.combo, 25);
  assert.equal(hit25.multiplier, 1.5);
  assert.equal(hit25.points, 150);

  // Advance combo to 49
  for (let i = 0; i < 24; i++) {
    scoreMgr.recordHit('PERFECT');
  }
  assert.equal(scoreMgr.combo, 49);

  // 50th hit: combo becomes 50 -> multiplier 2.0x
  const hit50 = scoreMgr.recordHit('PERFECT');
  assert.equal(scoreMgr.combo, 50);
  assert.equal(hit50.multiplier, 2.0);
  assert.equal(hit50.points, 200);
});

test('ScoreManager miss resets combo to 0 and records 0 score while preserving maxCombo', () => {
  const scoreMgr = new ScoreManager();

  // Reach combo 12
  for (let i = 0; i < 12; i++) {
    scoreMgr.recordHit('PERFECT');
  }
  assert.equal(scoreMgr.combo, 12);
  assert.equal(scoreMgr.maxCombo, 12);
  const scoreBeforeMiss = scoreMgr.score;

  // Miss
  const missResult = scoreMgr.recordHit('MISS');
  assert.equal(missResult.baseScore, 0);
  assert.equal(missResult.points, 0);
  assert.equal(scoreMgr.combo, 0);
  assert.equal(scoreMgr.maxCombo, 12);
  assert.equal(scoreMgr.missCount, 1);
  assert.equal(scoreMgr.score, scoreBeforeMiss);
});

test('ScoreManager accurately calculates accuracy percentage and song built punchline', () => {
  const scoreMgr = new ScoreManager();

  // 8 Perfect, 1 Good, 1 Miss -> 90% accuracy
  for (let i = 0; i < 8; i++) scoreMgr.recordHit('PERFECT');
  scoreMgr.recordHit('GOOD');
  scoreMgr.recordHit('MISS');

  assert.equal(scoreMgr.totalNotes, 10);
  assert.equal(scoreMgr.perfectCount, 8);
  assert.equal(scoreMgr.goodCount, 1);
  assert.equal(scoreMgr.missCount, 1);

  assert.equal(scoreMgr.accuracy, 90.0);
  assert.equal(scoreMgr.getSongBuiltPercentage(), 90);

  // Non-integer accuracy check: 7 hits out of 8 = 87.5% -> rounds to 88%
  const scoreMgr2 = new ScoreManager();
  for (let i = 0; i < 7; i++) scoreMgr2.recordHit('PERFECT');
  scoreMgr2.recordHit('MISS');

  assert.equal(scoreMgr2.totalNotes, 8);
  assert.equal(scoreMgr2.accuracy, 87.5);
  assert.equal(scoreMgr2.getSongBuiltPercentage(), 88);

  const summary = scoreMgr2.getSummary();
  assert.equal(summary.accuracy, 87.5);
  assert.equal(summary.songBuiltPercentage, 88);
  assert.ok(summary.rank);
});

test('ScoreManager tracks chord accuracy', () => {
  const scoreMgr = new ScoreManager();

  scoreMgr.recordChord({ completeness: 1.0, judgement: 'PERFECT' });
  scoreMgr.recordChord({ completeness: 0.67, judgement: 'GOOD' });

  assert.equal(scoreMgr.totalChords, 2);
  // (1.0 + 0.67) / 2 = 0.835 -> 83.5%
  assert.ok(Math.abs(scoreMgr.chordAccuracy - 83.5) < 0.1);
});

test('CalibrationManager samples hand positions and computes arena width and depth offset', () => {
  const calib = new CalibrationManager({
    minSamples: 10,
    defaultWidth: 0.8,
    defaultHitPlaneZ: 0.0
  });

  assert.equal(calib.isCalibrated, false);

  // Feed 10 samples ranging across X [-0.35 to 0.35] and Z [-0.6 to -0.5]
  const sampleData = [
    { x: -0.35, y: -0.1, z: -0.55 },
    { x: -0.25, y: -0.1, z: -0.50 },
    { x: -0.15, y: -0.1, z: -0.52 },
    { x: -0.05, y: -0.1, z: -0.54 },
    { x: 0.00, y: -0.1, z: -0.53 },
    { x: 0.05, y: -0.1, z: -0.51 },
    { x: 0.15, y: -0.1, z: -0.56 },
    { x: 0.25, y: -0.1, z: -0.52 },
    { x: 0.35, y: -0.1, z: -0.50 },
    { x: 0.30, y: -0.1, z: -0.54 }
  ];

  for (const sample of sampleData) {
    calib.addSample(sample);
  }

  assert.equal(calib.getSampleCount(), 10);
  assert.equal(calib.getProgress(), 1.0);

  const result = calib.computeCalibration();
  assert.ok(result);
  assert.equal(calib.isCalibrated, true);

  // Width should comfortably cover reach (spread was 0.70m)
  assert.ok(result.arenaWidth >= 0.7 && result.arenaWidth <= 1.2);
  // hitPlaneZ should reflect sampled average depth (~ -0.527)
  assert.ok(result.hitPlaneZ < -0.4 && result.hitPlaneZ > -0.7);
  assert.ok(result.scale > 0.8);
});

test('UIStateMachine governs correct state transitions and blocks invalid ones', () => {
  const sm = new UIStateMachine();

  assert.equal(sm.getState(), UI_STATES.SCAN_SURFACE);

  // SCAN_SURFACE -> SELECT_SONG_MODE
  assert.equal(sm.transition(UI_STATES.SELECT_SONG_MODE), true);
  assert.equal(sm.getState(), UI_STATES.SELECT_SONG_MODE);

  // SELECT_SONG_MODE -> CALIBRATING
  assert.equal(sm.transition(UI_STATES.CALIBRATING), true);
  assert.equal(sm.getState(), UI_STATES.CALIBRATING);

  // CALIBRATING -> COUNTDOWN
  assert.equal(sm.transition(UI_STATES.COUNTDOWN), true);
  assert.equal(sm.getState(), UI_STATES.COUNTDOWN);

  // COUNTDOWN -> PLAYING
  assert.equal(sm.transition(UI_STATES.PLAYING), true);
  assert.equal(sm.getState(), UI_STATES.PLAYING);

  // PLAYING -> RESULT
  assert.equal(sm.transition(UI_STATES.RESULT), true);
  assert.equal(sm.getState(), UI_STATES.RESULT);

  // RESULT -> SELECT_SONG_MODE (play again)
  assert.equal(sm.transition(UI_STATES.SELECT_SONG_MODE), true);
  assert.equal(sm.getState(), UI_STATES.SELECT_SONG_MODE);

  // Invalid transition: SELECT_SONG_MODE -> RESULT (blocked)
  assert.equal(sm.transition(UI_STATES.RESULT), false);
  assert.equal(sm.getState(), UI_STATES.SELECT_SONG_MODE);
});

test('UIStateMachine invokes transition listeners', () => {
  const sm = new UIStateMachine();
  const transitions = [];

  sm.onStateChange((to, from) => {
    transitions.push({ from, to });
  });

  sm.transition(UI_STATES.SELECT_SONG_MODE);
  sm.transition(UI_STATES.CALIBRATING);

  assert.equal(transitions.length, 2);
  assert.deepEqual(transitions[0], { from: UI_STATES.SCAN_SURFACE, to: UI_STATES.SELECT_SONG_MODE });
  assert.deepEqual(transitions[1], { from: UI_STATES.SELECT_SONG_MODE, to: UI_STATES.CALIBRATING });
});

test('ARUIController runs safely in Node/SSR environment', () => {
  const ui = new ARUIController();
  assert.ok(ui);
  assert.equal(ui.stateMachine.getState(), UI_STATES.SCAN_SURFACE);

  // Calling HUD methods in Node without DOM must not crash
  assert.doesNotThrow(() => {
    ui.showJudgement('PERFECT', 100);
    ui.updateScore(1500, 12, 95.5);
    ui.updateTimeline(12.5, 45.0);
    ui.showCountdown(3);
    ui.showResult({ score: 94000, accuracy: 95.0, maxCombo: 40 });
  });
});
