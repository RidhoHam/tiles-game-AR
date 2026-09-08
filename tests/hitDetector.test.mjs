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
});

test('HitDetector accepts custom options in constructor', () => {
  const custom = new HitDetector({
    laneCount: 8,
    arenaWidth: 1.2,
    hitPlaneZ: -0.15,
    perfectWindowSec: 0.040,
    goodWindowSec: 0.100,
    forgiveness: 1.3
  });
  assert.equal(custom.laneCount, 8);
  assert.equal(custom.arenaWidth, 1.2);
  assert.equal(custom.hitPlaneZ, -0.15);
  assert.equal(custom.perfectWindowSec, 0.040);
  assert.equal(custom.goodWindowSec, 0.100);
  assert.equal(custom.forgiveness, 1.3);
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
