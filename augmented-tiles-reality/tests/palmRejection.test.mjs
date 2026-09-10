import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isTapIntentional, validateHandOrientation } from '../src/vision/palmRejection.js';

test('isTapIntentional accepts intentional fingertip tap with extended finger', () => {
  // 21 landmarks: Wrist at bottom (y=0.85), Knuckle (MCP) at y=0.55, Tip at y=0.25 (extended towards desk)
  const hand = Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  hand[0] = { x: 0.5, y: 0.85, z: 0 }; // Wrist
  hand[5] = { x: 0.5, y: 0.55, z: 0 }; // Index MCP
  hand[6] = { x: 0.5, y: 0.45, z: 0 }; // Index PIP
  hand[7] = { x: 0.5, y: 0.35, z: 0 }; // Index DIP
  hand[8] = { x: 0.5, y: 0.25, z: 0 }; // Index Tip

  assert.equal(isTapIntentional(hand, 8), true);
});

test('isTapIntentional rejects accidental palm hit when wrist is above finger or finger curled', () => {
  // Wrist higher than finger (resting palm / upside down hand)
  const restingHand = Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  restingHand[0] = { x: 0.5, y: 0.2, z: 0 }; // Wrist above finger
  restingHand[8] = { x: 0.5, y: 0.5, z: 0 };
  assert.equal(isTapIntentional(restingHand, 8), false);

  // Fully curled finger (knuckle lower than tip)
  const curledHand = Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  curledHand[0] = { x: 0.5, y: 0.8, z: 0 };
  curledHand[5] = { x: 0.5, y: 0.4, z: 0 }; // MCP
  curledHand[8] = { x: 0.5, y: 0.55, z: 0 }; // Tip curled back behind MCP
  assert.equal(isTapIntentional(curledHand, 8), false);
});

test('validateHandOrientation validates palm normal is oriented forward or down', () => {
  const hand = Array(21).fill(null).map(() => ({ x: 0.5, y: 0.5, z: 0 }));
  hand[0] = { x: 0.5, y: 0.8, z: 0 }; // Wrist
  hand[5] = { x: 0.3, y: 0.5, z: 0 }; // Index MCP
  hand[17] = { x: 0.7, y: 0.5, z: 0 }; // Pinky MCP
  assert.equal(validateHandOrientation(hand), true);
});
