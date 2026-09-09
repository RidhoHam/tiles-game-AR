import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HitDetector } from '../src/engine/hitDetector.js';

test('HitDetector initializes with sensible default options', () => {
  const detector = new HitDetector();
  assert.equal(detector.laneCount, 4);
  assert.equal(detector.arenaWidth, 0.8);
  assert.equal(detector.hitPlaneZ, 0.0);
  assert.equal(detector.perfectWindowSec, 0.050);
  assert.equal(detector.goodWindowSec, 0.120);
  assert.equal(detector.forgiveness, 1.2);
  assert.equal(detector.inputLatencyCompensationSec, 0.040);
});

test('HitDetector accepts custom options in constructor', () => {
  const custom = new HitDetector({
    laneCount: 8,
    arenaWidth: 1.2,
    hitPlaneZ: -0.15,
    perfectWindowSec: 0.040,
    goodWindowSec: 0.100,
    forgiveness: 1.3,
    inputLatencyCompensationSec: 0.035
  });
  assert.equal(custom.laneCount, 8);
  assert.equal(custom.arenaWidth, 1.2);
  assert.equal(custom.hitPlaneZ, -0.15);
  assert.equal(custom.perfectWindowSec, 0.040);
  assert.equal(custom.goodWindowSec, 0.100);
  assert.equal(custom.forgiveness, 1.3);
  assert.equal(custom.inputLatencyCompensationSec, 0.035);
});

test('HitDetector inputLatencyCompensationSec getter and setter update compensation value', () => {
  const detector = new HitDetector();
  assert.equal(detector.inputLatencyCompensationSec, 0.040);
  detector.inputLatencyCompensationSec = 0.055;
  assert.equal(detector.inputLatencyCompensationSec, 0.055);
});

test('mapHandToLane maps positions accurately in 4-lane mode', () => {
  const detector = new HitDetector({ laneCount: 4, arenaWidth: 0.8, forgiveness: 1.2 });
  // Lane centers: -0.3, -0.1, +0.1, +0.3
  assert.equal(detector.mapHandToLane({ x: -0.3, y: 0, z: 0 }), 0);
  assert.equal(detector.mapHandToLane({ x: -0.1, y: 0, z: 0 }), 1);
  assert.equal(detector.mapHandToLane({ x: 0.1, y: 0, z: 0 }), 2);
  assert.equal(detector.mapHandToLane({ x: 0.3, y: 0, z: 0 }), 3);

  // Boundary checks inside nominal arena [-0.4, 0.4]
  assert.equal(detector.mapHandToLane({ x: -0.39 }), 0);
  assert.equal(detector.mapHandToLane({ x: -0.21 }), 0);
  assert.equal(detector.mapHandToLane({ x: -0.19 }), 1);
  assert.equal(detector.mapHandToLane({ x: -0.01 }), 1);
  assert.equal(detector.mapHandToLane({ x: 0.01 }), 2);
  assert.equal(detector.mapHandToLane({ x: 0.19 }), 2);
  assert.equal(detector.mapHandToLane({ x: 0.21 }), 3);
  assert.equal(detector.mapHandToLane({ x: 0.39 }), 3);

  // Forgiveness hitbox: arenaWidth 0.8 * 1.2 = 0.96 -> bounds [-0.48, +0.48]
  assert.equal(detector.mapHandToLane({ x: -0.45 }), 0);
  assert.equal(detector.mapHandToLane({ x: 0.45 }), 3);

  // Out of bounds
  assert.equal(detector.mapHandToLane({ x: -0.55 }), -1);
  assert.equal(detector.mapHandToLane({ x: 0.8 }), -1);
  assert.equal(detector.mapHandToLane(null), -1);
  assert.equal(detector.mapHandToLane({}), -1);
});

test('mapHandToLane maps positions accurately in 8-lane mode', () => {
  const detector = new HitDetector({ laneCount: 8, arenaWidth: 0.8, forgiveness: 1.2 });
  // Lane width: 0.1, centers: -0.35, -0.25, -0.15, -0.05, 0.05, 0.15, 0.25, 0.35
  assert.equal(detector.mapHandToLane({ x: -0.35 }), 0);
  assert.equal(detector.mapHandToLane({ x: -0.25 }), 1);
  assert.equal(detector.mapHandToLane({ x: -0.15 }), 2);
  assert.equal(detector.mapHandToLane({ x: -0.05 }), 3);
  assert.equal(detector.mapHandToLane({ x: 0.05 }), 4);
  assert.equal(detector.mapHandToLane({ x: 0.15 }), 5);
  assert.equal(detector.mapHandToLane({ x: 0.25 }), 6);
  assert.equal(detector.mapHandToLane({ x: 0.35 }), 7);

  // Edge lanes with forgiveness
  assert.equal(detector.mapHandToLane({ x: -0.44 }), 0);
  assert.equal(detector.mapHandToLane({ x: 0.44 }), 7);

  // Out of bounds
  assert.equal(detector.mapHandToLane({ x: -0.6 }), -1);
  assert.equal(detector.mapHandToLane({ x: 0.6 }), -1);
});

test('checkCrossing detects Z-axis hit plane crossings', () => {
  const detector = new HitDetector({ hitPlaneZ: 0.0 });

  // Moving forward across plane (prevZ < hitPlaneZ and currZ >= hitPlaneZ)
  assert.equal(detector.checkCrossing(-0.05, 0.02), true);
  assert.equal(detector.checkCrossing(-0.05, 0.0), true); // exact hit plane landing

  // Object coordinates support
  assert.equal(detector.checkCrossing({ z: -0.05 }, { z: 0.02 }), true);

  // Not crossing: both before plane
  assert.equal(detector.checkCrossing(-0.1, -0.02), false);

  // Not crossing: both past plane
  assert.equal(detector.checkCrossing(0.01, 0.05), false);

  // Moving backwards
  assert.equal(detector.checkCrossing(0.05, -0.02), false);

  // Custom hitPlaneZ
  assert.equal(detector.checkCrossing(-0.25, -0.15, -0.2), true);
  assert.equal(detector.checkCrossing(-0.3, -0.25, -0.2), false);
});

test('evaluateCrossingHit returns PERFECT within 50ms with timingScore 100', () => {
  const detector = new HitDetector({
    laneCount: 4,
    arenaWidth: 0.8,
    hitPlaneZ: 0.0,
    perfectWindowSec: 0.050,
    goodWindowSec: 0.120
  });

  const targetNote = {
    id: 'n1',
    timeSec: 2.0,
    lane: 1,
    note: 'C4',
    played: false
  };

  const prevPos = { x: -0.1, y: 0, z: -0.05 };
  const currPos = { x: -0.1, y: 0, z: 0.02 };

  // Hit at 2.03 -> diff is +30ms <= 50ms
  const result = detector.evaluateCrossingHit(prevPos, currPos, 2.03, [targetNote]);

  assert.ok(result);
  assert.equal(result.judgement, 'PERFECT');
  assert.equal(result.timingScore, 100);
  assert.equal(result.note.id, 'n1');
  assert.equal(result.lane, 1);
  assert.equal(targetNote.played, true);
  assert.ok(Math.abs(result.timingDiff - 0.03) < 1e-6);
});

test('evaluateCrossingHit returns GOOD between 50ms and 120ms with timingScore 70', () => {
  const detector = new HitDetector({
    laneCount: 4,
    arenaWidth: 0.8,
    hitPlaneZ: 0.0,
    perfectWindowSec: 0.050,
    goodWindowSec: 0.120
  });

  const lateNote = {
    id: 'n2',
    timeSec: 2.0,
    lane: 2,
    note: 'E4',
    played: false
  };

  const prevPos = { x: 0.1, y: 0, z: -0.04 };
  const currPos = { x: 0.1, y: 0, z: 0.01 };

  // Hit at 2.08 -> diff is +80ms (50ms < diff <= 120ms)
  const resultLate = detector.evaluateCrossingHit(prevPos, currPos, 2.08, [lateNote]);
  assert.ok(resultLate);
  assert.equal(resultLate.judgement, 'GOOD');
  assert.equal(resultLate.timingScore, 70);
  assert.equal(resultLate.note.id, 'n2');
  assert.equal(lateNote.played, true);

  // Early hit: at 1.93 -> diff is -70ms (|diff| is 70ms -> GOOD)
  const earlyNote = {
    id: 'n3',
    timeSec: 2.0,
    lane: 0,
    note: 'G3',
    played: false
  };
  const prev0 = { x: -0.3, y: 0, z: -0.03 };
  const curr0 = { x: -0.3, y: 0, z: 0.01 };

  const resultEarly = detector.evaluateCrossingHit(prev0, curr0, 1.93, [earlyNote]);
  assert.ok(resultEarly);
  assert.equal(resultEarly.judgement, 'GOOD');
  assert.equal(resultEarly.timingScore, 70);
  assert.equal(earlyNote.played, true);
});

test('evaluateCrossingHit returns null when no crossing, wrong lane, or outside window', () => {
  const detector = new HitDetector({
    laneCount: 4,
    arenaWidth: 0.8,
    hitPlaneZ: 0.0,
    perfectWindowSec: 0.050,
    goodWindowSec: 0.120
  });

  const note = {
    id: 'n1',
    timeSec: 2.0,
    lane: 1,
    note: 'C4',
    played: false
  };

  // 1. No crossing (both negative Z)
  const noCrossPrev = { x: -0.1, y: 0, z: -0.10 };
  const noCrossCurr = { x: -0.1, y: 0, z: -0.02 };
  assert.equal(detector.evaluateCrossingHit(noCrossPrev, noCrossCurr, 2.0, [note]), null);
  assert.equal(note.played, false);

  // 2. Wrong lane (hand is in lane 3, note is in lane 1)
  const wrongLanePrev = { x: 0.3, y: 0, z: -0.05 };
  const wrongLaneCurr = { x: 0.3, y: 0, z: 0.02 };
  assert.equal(detector.evaluateCrossingHit(wrongLanePrev, wrongLaneCurr, 2.0, [note]), null);
  assert.equal(note.played, false);

  // 3. Outside hit window (> 120ms diff, e.g. 2.15 -> 150ms)
  const correctPrev = { x: -0.1, y: 0, z: -0.05 };
  const correctCurr = { x: -0.1, y: 0, z: 0.02 };
  assert.equal(detector.evaluateCrossingHit(correctPrev, correctCurr, 2.15, [note]), null);
  assert.equal(note.played, false);

  // 4. Note already played
  note.played = true;
  assert.equal(detector.evaluateCrossingHit(correctPrev, correctCurr, 2.0, [note]), null);
});

test('evaluateCrossingHit supports chord notes with multiple sub-lanes', () => {
  const detector = new HitDetector({ laneCount: 4, arenaWidth: 0.8 });

  const chordNote = {
    id: 'chord_1',
    timeSec: 3.0,
    type: 'chord',
    played: false,
    notes: [
      { lane: 0, note: 'C4' },
      { lane: 2, note: 'G4' }
    ]
  };

  // Hand crosses lane 2
  const prevPos = { x: 0.1, y: 0, z: -0.04 };
  const currPos = { x: 0.1, y: 0, z: 0.02 };

  const result = detector.evaluateCrossingHit(prevPos, currPos, 3.01, [chordNote]);
  assert.ok(result);
  assert.equal(result.judgement, 'PERFECT');
  assert.equal(result.note.id, 'chord_1');
});

test('checkMissedNotes identifies notes drifting past goodWindowSec without being hit', () => {
  const detector = new HitDetector({ goodWindowSec: 0.120 });

  const notes = [
    { id: 'n1', timeSec: 1.0, played: false },
    { id: 'n2', timeSec: 1.5, played: false },
    { id: 'n3', timeSec: 1.0, played: true } // already played, not missed
  ];

  // At currentTimeSec = 1.15 (diff for n1 is +0.15s > 0.120s -> missed)
  const missed = detector.checkMissedNotes(1.15, notes);
  assert.equal(missed.length, 1);
  assert.equal(missed[0].id, 'n1');
  assert.equal(notes[0].missed, true);

  // Calling again should not duplicate already marked missed notes
  const missedAgain = detector.checkMissedNotes(1.16, notes);
  assert.equal(missedAgain.length, 0);

  // At currentTimeSec = 1.70 (diff for n2 is +0.20s > 0.120s -> missed)
  const missedN2 = detector.checkMissedNotes(1.70, notes);
  assert.equal(missedN2.length, 1);
  assert.equal(missedN2[0].id, 'n2');
  assert.equal(notes[1].missed, true);
});

test('evaluateChordCompleteness scores based on hit ratios', () => {
  const detector = new HitDetector();

  // 100% -> PERFECT (1.0)
  const res100 = detector.evaluateChordCompleteness(3, 3);
  assert.equal(res100.judgement, 'PERFECT');
  assert.equal(res100.completeness, 1.0);

  // >= 65% -> GOOD
  const res67 = detector.evaluateChordCompleteness(2, 3);
  assert.equal(res67.judgement, 'GOOD');
  assert.equal(res67.completeness, 2 / 3);

  const res65 = detector.evaluateChordCompleteness(65, 100);
  assert.equal(res65.judgement, 'GOOD');
  assert.equal(res65.completeness, 0.65);

  // > 0% but < 65% -> PARTIAL
  const res33 = detector.evaluateChordCompleteness(1, 3);
  assert.equal(res33.judgement, 'PARTIAL');
  assert.equal(res33.completeness, 1 / 3);

  const res64 = detector.evaluateChordCompleteness(64, 100);
  assert.equal(res64.judgement, 'PARTIAL');

  // 0% -> MISS
  const res0 = detector.evaluateChordCompleteness(0, 3);
  assert.equal(res0.judgement, 'MISS');
  assert.equal(res0.completeness, 0.0);

  // Edge cases: total 0
  const resZero = detector.evaluateChordCompleteness(0, 0);
  assert.equal(resZero.judgement, 'MISS');
  assert.equal(resZero.completeness, 0.0);
});

test('evaluateLanePress returns PERFECT when timing diff is within perfectWindowSec (<= 50ms)', () => {
  const detector = new HitDetector({
    perfectWindowSec: 0.050,
    goodWindowSec: 0.120,
    inputLatencyCompensationSec: 0.040
  });

  const note = { id: 'note_1', lane: 2, timeSec: 2.0, played: false };
  // currentTime 1.98s + 0.040s latency = 2.02s evaluatedTime -> diff = +0.020s (20ms <= 50ms)
  const result = detector.evaluateLanePress(2, 1.98, [note]);

  assert.ok(result);
  assert.equal(result.judgement, 'PERFECT');
  assert.equal(result.timingScore, 100);
  assert.equal(result.lane, 2);
  assert.equal(result.note.id, 'note_1');
  assert.equal(note.played, true);
  assert.ok(Math.abs(result.timingDiff - 0.02) < 1e-6);
  assert.ok(Math.abs(result.timingDiffMs - 20) < 1e-3);
});

test('evaluateLanePress returns GOOD when timing diff is between 50ms and 120ms', () => {
  const detector = new HitDetector({
    perfectWindowSec: 0.050,
    goodWindowSec: 0.120,
    inputLatencyCompensationSec: 0.040
  });

  // Late hit: press at 2.04s + 0.040s latency = 2.08s evaluatedTime -> diff = +0.080s (80ms -> GOOD)
  const lateNote = { id: 'note_late', lane: 1, timeSec: 2.0, played: false };
  const resultLate = detector.evaluateLanePress(1, 2.04, [lateNote]);

  assert.ok(resultLate);
  assert.equal(resultLate.judgement, 'GOOD');
  assert.equal(resultLate.timingScore, 70);
  assert.equal(lateNote.played, true);
  assert.ok(Math.abs(resultLate.timingDiff - 0.08) < 1e-6);

  // Early hit: press at 1.89s + 0.040s = 1.93s -> diff = -0.070s (-70ms, |diff| = 70ms -> GOOD)
  const earlyNote = { id: 'note_early', lane: 3, timeSec: 2.0, played: false };
  const resultEarly = detector.evaluateLanePress(3, 1.89, [earlyNote]);

  assert.ok(resultEarly);
  assert.equal(resultEarly.judgement, 'GOOD');
  assert.equal(resultEarly.timingScore, 70);
  assert.equal(earlyNote.played, true);
});

test('evaluateLanePress returns null outside goodWindow (> 120ms)', () => {
  const detector = new HitDetector({
    goodWindowSec: 0.120,
    inputLatencyCompensationSec: 0.040
  });

  const note = { id: 'note_1', lane: 0, timeSec: 2.0, played: false };
  // Late press at 2.10s + 0.040s = 2.14s -> diff = +0.140s (140ms > 120ms)
  const resultLate = detector.evaluateLanePress(0, 2.10, [note]);
  assert.equal(resultLate, null);
  assert.equal(note.played, false);

  // Early press at 1.80s + 0.040s = 1.84s -> diff = -0.160s (160ms > 120ms)
  const resultEarly = detector.evaluateLanePress(0, 1.80, [note]);
  assert.equal(resultEarly, null);
  assert.equal(note.played, false);
});

test('evaluateLanePress returns null with wrong lane', () => {
  const detector = new HitDetector();
  const note = { id: 'note_1', lane: 1, timeSec: 2.0, played: false };

  // Press lane 3 instead of lane 1
  const result = detector.evaluateLanePress(3, 1.96, [note]);
  assert.equal(result, null);
  assert.equal(note.played, false);

  // Invalid lane indices
  assert.equal(detector.evaluateLanePress(-1, 1.96, [note]), null);
  assert.equal(detector.evaluateLanePress(null, 1.96, [note]), null);
});

test('evaluateLanePress applies default and custom latency compensation offset correctly', () => {
  const detector = new HitDetector({
    perfectWindowSec: 0.050,
    inputLatencyCompensationSec: 0.040
  });

  const note1 = { id: 'note_lat1', lane: 2, timeSec: 1.0, played: false };
  // Default compensation: 0.040s, press at 0.96s -> evaluatedTime 1.00s -> diff 0.00s
  const resDefault = detector.evaluateLanePress(2, 0.96, [note1]);
  assert.ok(resDefault);
  assert.equal(resDefault.judgement, 'PERFECT');
  assert.ok(Math.abs(resDefault.timingDiff) < 1e-6);

  // Custom latency compensation in options: 0.060s
  const note2 = { id: 'note_lat2', lane: 2, timeSec: 1.0, played: false };
  // Press at 0.94s + 0.060s custom latency = 1.00s -> diff 0.00s
  const resCustom = detector.evaluateLanePress(2, 0.94, [note2], { latencyCompensationSec: 0.060 });
  assert.ok(resCustom);
  assert.equal(resCustom.judgement, 'PERFECT');
  assert.ok(Math.abs(resCustom.timingDiff) < 1e-6);
});

test('evaluateLanePress handles chord sub-notes and marks individual sub-notes played', () => {
  const detector = new HitDetector({
    perfectWindowSec: 0.050,
    goodWindowSec: 0.120,
    inputLatencyCompensationSec: 0.040
  });

  const chordNote = {
    id: 'chord_1',
    timeSec: 3.0,
    type: 'chord',
    played: false,
    notes: [
      { lane: 0, note: 'C4', played: false },
      { lane: 2, note: 'G4', played: false }
    ]
  };

  // 1. Hit lane 0 of chord at 2.97s + 0.040s = 3.01s (diff +10ms -> PERFECT)
  const resultLane0 = detector.evaluateLanePress(0, 2.97, [chordNote]);
  assert.ok(resultLane0);
  assert.equal(resultLane0.judgement, 'PERFECT');
  assert.equal(resultLane0.lane, 0);
  assert.equal(chordNote.played, true);
  assert.equal(chordNote.notes[0].played, true);
  assert.equal(chordNote.notes[1].played, false);

  // 2. Hit lane 2 of chord at 2.98s + 0.040s = 3.02s (diff +20ms -> PERFECT)
  const resultLane2 = detector.evaluateLanePress(2, 2.98, [chordNote]);
  assert.ok(resultLane2);
  assert.equal(resultLane2.judgement, 'PERFECT');
  assert.equal(resultLane2.lane, 2);
  assert.equal(chordNote.notes[1].played, true);

  // 3. Repeated hit on already played sub-note lane 0 returns null
  const resultRepeat = detector.evaluateLanePress(0, 2.97, [chordNote]);
  assert.equal(resultRepeat, null);

  // 4. Hit on lane 1 which is not part of chord returns null
  const resultWrongLane = detector.evaluateLanePress(1, 2.97, [chordNote]);
  assert.equal(resultWrongLane, null);
});

test('evaluateLanePress selects closest candidate note when multiple match lane and window', () => {
  const detector = new HitDetector({
    goodWindowSec: 0.120,
    inputLatencyCompensationSec: 0.040
  });

  const note1 = { id: 'n1', lane: 1, timeSec: 2.0, played: false };
  const note2 = { id: 'n2', lane: 1, timeSec: 2.1, played: false };

  // evaluatedTime = 2.01s (currentTime 1.97s + 0.040s)
  // diff for n1 is 0.01s, diff for n2 is 0.09s -> selects n1
  const result = detector.evaluateLanePress(1, 1.97, [note1, note2]);
  assert.ok(result);
  assert.equal(result.note.id, 'n1');
  assert.equal(note1.played, true);
  assert.equal(note2.played, false);
});

