import { test } from 'node:test';
import assert from 'node:assert/strict';
import { calculatePitchPan, createPannerNode } from '../src/core/audio/stereoPanner.js';

test('calculatePitchPan maps bass to left, middle C to center, and high treble to right', () => {
  // A0 (MIDI 21 - lowest piano key) should be panned left
  const panLow = calculatePitchPan(21);
  assert.ok(panLow <= -0.6, `Expected bass to pan left, got ${panLow}`);

  // C4 (MIDI 60 - middle C) should be centered near 0
  const panMid = calculatePitchPan(60);
  assert.ok(Math.abs(panMid) <= 0.1, `Expected middle C to be centered, got ${panMid}`);

  // C8 (MIDI 108 - highest piano key) should be panned right
  const panHigh = calculatePitchPan(108);
  assert.ok(panHigh >= 0.6, `Expected treble to pan right, got ${panHigh}`);
});

test('calculatePitchPan supports lane-based panning', () => {
  const panLane0 = calculatePitchPan(0, 0, 7, 0.7);
  assert.ok(panLane0 <= -0.6, `Expected lane 0 to pan left, got ${panLane0}`);

  const panLane7 = calculatePitchPan(7, 0, 7, 0.7);
  assert.ok(panLane7 >= 0.6, `Expected lane 7 to pan right, got ${panLane7}`);
});

test('createPannerNode returns null safely in Node or mocked context', () => {
  const node = createPannerNode(null, 0);
  assert.equal(node, null);
});
