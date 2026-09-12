import test from 'node:test';
import assert from 'node:assert/strict';
import { deriveArena, DEFAULT_ARENA } from '../../src/core/arena-layout.js';

function assertAllFinite(result) {
  assert.ok(Number.isFinite(result.centerX), `centerX not finite: ${result.centerX}`);
  assert.ok(Number.isFinite(result.centerZ), `centerZ not finite: ${result.centerZ}`);
  assert.ok(Number.isFinite(result.width), `width not finite: ${result.width}`);
  assert.ok(Number.isFinite(result.depth), `depth not finite: ${result.depth}`);
  assert.ok(Number.isFinite(result.scale), `scale not finite: ${result.scale}`);
  for (const [name, anchor] of [['blueAnchor', result.blueAnchor], ['redAnchor', result.redAnchor]]) {
    assert.ok(Array.isArray(anchor), `${name} is not an array`);
    for (const value of anchor) assert.ok(Number.isFinite(value), `${name} has non-finite value: ${value}`);
  }
}

test('empty list returns the fallback with finite numbers', () => {
  const result = deriveArena([]);
  assertAllFinite(result);
  assert.equal(result.width, DEFAULT_ARENA.halfWidth * 2);
  assert.equal(result.depth, DEFAULT_ARENA.halfDepth * 2);
});

test('a missing card list returns the fallback with finite numbers', () => {
  const result = deriveArena(undefined);
  assertAllFinite(result);
  assert.equal(result.centerX, 0);
  assert.equal(result.centerZ, 0);
});

test('a single card returns finite numbers', () => {
  const result = deriveArena([{ worldPosition: [0.3, 0, -0.2] }]);
  assertAllFinite(result);
});

test('all cards at the same position stay finite and never produce NaN', () => {
  const same = [
    { worldPosition: [0.25, 0, 0.1] },
    { worldPosition: [0.25, 0, 0.1] },
    { worldPosition: [0.25, 0, 0.1] }
  ];
  const result = deriveArena(same);
  assertAllFinite(result);
  assert.equal(result.width, 0);
  assert.equal(result.depth, 0);
  assert.ok(result.scale > 0);
});

test('cards containing NaN/Infinity/undefined are ignored', () => {
  const cards = [
    { worldPosition: [0.5, 0, 0] },
    { worldPosition: [NaN, 0, 0] },
    { worldPosition: [Infinity, 0, 2] },
    { worldPosition: [-Infinity, 0, 0] },
    { worldPosition: [0.4, 0, undefined] },
    { worldPosition: [0.4, 0, null] },
    { worldPosition: undefined },
    {}
  ];
  const result = deriveArena(cards);
  assertAllFinite(result);
  // Only the single finite card survives, so the spread collapses to 0.
  assert.equal(result.width, 0);
});

test('cards that are all non-finite return the fallback', () => {
  const cards = [
    { worldPosition: [NaN, 0, 0] },
    { worldPosition: [Infinity, 0, 1] },
    { worldPosition: [0, 0, undefined] },
    { worldPosition: undefined }
  ];
  const result = deriveArena(cards);
  assertAllFinite(result);
  assert.equal(result.centerX, 0);
  assert.equal(result.centerZ, 0);
  assert.equal(result.width, DEFAULT_ARENA.halfWidth * 2);
});

test('a normal two-sided spread returns finite fields and finite anchors', () => {
  const cards = [
    { worldPosition: [-0.8, 0, -0.3] },
    { worldPosition: [-0.5, 0, 0.2] },
    { worldPosition: [0.6, 0, -0.1] },
    { worldPosition: [0.9, 0, 0.3] }
  ];
  const result = deriveArena(cards);
  assertAllFinite(result);
  assert.ok(result.width > 0);
  assert.ok(result.depth > 0);
  assert.ok(result.blueAnchor[0] < result.centerX);
  assert.ok(result.redAnchor[0] > result.centerX);
});

test('cards all on one side still return finite numbers', () => {
  const cards = [
    { worldPosition: [1.2, 0, 0] },
    { worldPosition: [1.6, 0, 0.4] },
    { worldPosition: [2.0, 0, -0.4] }
  ];
  const result = deriveArena(cards);
  assertAllFinite(result);
});

test('every numeric field is finite across all the above inputs', () => {
  const inputs = [
    [],
    undefined,
    [{ worldPosition: [0.3, 0, -0.2] }],
    [{ worldPosition: [0.25, 0, 0.1] }, { worldPosition: [0.25, 0, 0.1] }],
    [{ worldPosition: [1, 0, 0] }, { worldPosition: [1.1, 0, 0.2] }],
    [{ worldPosition: [NaN, 0, 0] }, { worldPosition: [Infinity, 0, 1] },
     { worldPosition: [0.4, 0, undefined] }, { worldPosition: undefined }],
    [{ worldPosition: [-0.8, 0, -0.3] }, { worldPosition: [0.9, 0, 0.3] }]
  ];
  for (const input of inputs) assertAllFinite(deriveArena(input));
});

test('scale varies across a small spread and a large spread', () => {
  const tiny = deriveArena([
    { worldPosition: [-0.05, 0, 0] },
    { worldPosition: [0.05, 0, 0] }
  ]);
  const medium = deriveArena([
    { worldPosition: [-0.5, 0, 0] },
    { worldPosition: [0.5, 0, 0] }
  ]);
  const large = deriveArena([
    { worldPosition: [-1.5, 0, 0] },
    { worldPosition: [1.5, 0, 0] }
  ]);
  for (const result of [tiny, medium, large]) assertAllFinite(result);
  assert.ok(tiny.scale < medium.scale, `expected ${tiny.scale} < ${medium.scale}`);
  assert.ok(medium.scale < large.scale, `expected ${medium.scale} < ${large.scale}`);
  assert.ok(tiny.scale > 0);
});