import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeArenaFromTwoPoints } from '../src/vision/twoPointCalibration.js';

test('computeArenaFromTwoPoints generates 4 corners with proper depth perspective', () => {
  const leftPoint = { x: 100, y: 500 };
  const rightPoint = { x: 700, y: 500 };
  const depthRatio = 0.55; // Far edge 55% narrower due to perspective

  const arena = computeArenaFromTwoPoints(leftPoint, rightPoint, { depthHeight: 300, perspectiveRatio: depthRatio });
  assert.ok(arena.p1 && arena.p2 && arena.p3 && arena.p4, 'Arena has 4 corners');
  assert.equal(arena.p1.x, 100);
  assert.equal(arena.p2.x, 700);
  assert.ok(arena.p4.x > arena.p1.x, 'Top-left corner is inset due to perspective');
  assert.ok(arena.p3.x < arena.p2.x, 'Top-right corner is inset due to perspective');
  assert.equal(arena.p4.y, 200, 'Top y position is offset by depthHeight');
});

test('computeArenaFromTwoPoints handles angled desk placement', () => {
  const p1 = { x: 100, y: 400 };
  const p2 = { x: 500, y: 450 }; // Slightly tilted desk edge
  const arena = computeArenaFromTwoPoints(p1, p2, { depthHeight: 250, perspectiveRatio: 0.6 });

  assert.ok(Number.isFinite(arena.angleRad), 'Angle is computed');
  assert.ok(Number.isFinite(arena.widthPx), 'Width is computed');
  assert.ok(arena.widthPx > 400, 'Width matches Euclidean distance');
});
