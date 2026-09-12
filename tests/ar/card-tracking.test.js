import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeDetections, describeCard } from '../../src/ar/card-tracking.js';
import { detectCapabilities, explainCapabilities } from '../../src/ar/capabilities.js';
import { CARD_TARGETS } from '../../src/ar/card-targets.js';
import { CardTrackingController } from '../../src/ar/ar-marker.js';

// ---------------------------------------------------------------------------
// normalizeDetections - the two brief tests, verbatim
// ---------------------------------------------------------------------------

test('normalizes raw detections into card records', () => {
  const cards = normalizeDetections([
    { targetIndex: 0, worldPosition: [0.1, 0, 0.2] },
    { targetIndex: 3, worldPosition: [-0.4, 0, 0.1] }
  ]);
  assert.equal(cards.length, 2);
  assert.equal(cards[0].cardId, 'benteng');
  assert.equal(cards[0].type, 'benteng');
  assert.equal(cards[0].role, 'base');
  assert.equal(cards[1].cardId, 'tank');
  assert.equal(cards[1].role, 'artileri');
});

test('unknown indexes are ignored instead of throwing', () => {
  const cards = normalizeDetections([{ targetIndex: 99, worldPosition: [0, 0, 0] }]);
  assert.deepEqual(cards, []);
});

// ---------------------------------------------------------------------------
// normalizeDetections - hostile input
// ---------------------------------------------------------------------------

test('out-of-range, negative, non-integer and missing targetIndex are ignored', () => {
  assert.doesNotThrow(() => normalizeDetections([
    { targetIndex: 6, worldPosition: [0, 0, 0] },        // one past the end
    { targetIndex: 99, worldPosition: [0, 0, 0] },       // far out of range
    { targetIndex: -1, worldPosition: [0, 0, 0] },       // negative
    { targetIndex: 1.5, worldPosition: [0, 0, 0] },      // non-integer
    { targetIndex: NaN, worldPosition: [0, 0, 0] },      // NaN index
    { targetIndex: '0', worldPosition: [0, 0, 0] },      // numeric string
    { worldPosition: [0, 0, 0] },                        // missing
    { worldPosition: [0, 0, 0], targetIndex: null },     // null
    { targetIndex: undefined, worldPosition: [0, 0, 0] }
  ]));
  assert.deepEqual(normalizeDetections([
    { targetIndex: 6, worldPosition: [0, 0, 0] },
    { targetIndex: -1, worldPosition: [0, 0, 0] },
    { targetIndex: 1.5, worldPosition: [0, 0, 0] },
    { targetIndex: '0', worldPosition: [0, 0, 0] },
    { worldPosition: [0, 0, 0] }
  ]), []);
});

test('malformed worldPosition is ignored instead of throwing', () => {
  const malformed = [
    { targetIndex: 0 },                                  // missing
    { targetIndex: 0, worldPosition: null },
    { targetIndex: 0, worldPosition: [NaN, 0, 0] },      // NaN poison (Task 2 review)
    { targetIndex: 0, worldPosition: [0, Infinity, 0] },
    { targetIndex: 0, worldPosition: [1, 2] },           // too short
    { targetIndex: 0, worldPosition: [1, 2, 3, 4] },     // too long
    { targetIndex: 0, worldPosition: 'x' },              // wrong type
    { targetIndex: 0, worldPosition: { x: 0, y: 0, z: 0 } },
    { targetIndex: 0, worldPosition: [0, '0', 0] }
  ];
  assert.doesNotThrow(() => normalizeDetections(malformed));
  assert.deepEqual(normalizeDetections(malformed), []);
});

test('non-object and array entries are ignored instead of throwing', () => {
  assert.doesNotThrow(() => normalizeDetections([null, undefined, 42, 'nope', [], [{ targetIndex: 0 }]]));
  assert.deepEqual(normalizeDetections([null, undefined, 42, 'nope']), []);
});

test('non-array input yields an empty array', () => {
  assert.deepEqual(normalizeDetections(undefined), []);
  assert.deepEqual(normalizeDetections(null), []);
  assert.deepEqual(normalizeDetections('nope'), []);
  assert.deepEqual(normalizeDetections({}), []);
});

test('returns targetIndex order regardless of input order', () => {
  const shuffled = normalizeDetections([
    { targetIndex: 5, worldPosition: [5, 0, 0] },
    { targetIndex: 2, worldPosition: [2, 0, 0] },
    { targetIndex: 0, worldPosition: [0, 0, 0] },
    { targetIndex: 4, worldPosition: [4, 0, 0] },
    { targetIndex: 1, worldPosition: [1, 0, 0] },
    { targetIndex: 3, worldPosition: [3, 0, 0] }
  ]);
  assert.deepEqual(shuffled.map(card => card.cardId), ['benteng', 'bunker', 'robot', 'tank', 'kesatria', 'gargoyle']);
  assert.deepEqual(shuffled.map(card => card.worldPosition[0]), [0, 1, 2, 3, 4, 5]);
});

test('duplicate detections for one target collapse to a single card', () => {
  const cards = normalizeDetections([
    { targetIndex: 1, worldPosition: [1, 0, 0] },
    { targetIndex: 1, worldPosition: [9, 9, 9] }
  ]);
  assert.equal(cards.length, 1);
  assert.equal(cards[0].cardId, 'bunker');
});

test('every card gets the role declared in UNIT_DEFINITIONS', () => {
  const expected = { benteng: 'base', bunker: 'base', robot: 'artileri', tank: 'artileri', kesatria: 'prajurit', gargoyle: 'prajurit' };
  const cards = normalizeDetections(CARD_TARGETS.map((_, index) => ({ targetIndex: index, worldPosition: [index, 0, 0] })));
  assert.equal(cards.length, 6);
  for (const card of cards) {
    assert.equal(card.role, expected[card.cardId], `${card.cardId} role`);
    assert.equal(card.type, card.cardId);
    assert.ok(['base', 'artileri', 'prajurit'].includes(card.role));
  }
  assert.deepEqual(cards.map(card => card.role), ['base', 'base', 'artileri', 'artileri', 'prajurit', 'prajurit']);
});

test('card-target order matches the documented targetIndex order', () => {
  assert.deepEqual(CARD_TARGETS.map(card => card.cardId), ['benteng', 'bunker', 'robot', 'tank', 'kesatria', 'gargoyle']);
});

test('worldPosition is copied, not aliased to the input array', () => {
  const source = [1, 2, 3];
  const [card] = normalizeDetections([{ targetIndex: 0, worldPosition: source }]);
  source[0] = 999;
  assert.deepEqual(card.worldPosition, [1, 2, 3]);
});

test('an optional 16-element pose is passed through and malformed poses become null', () => {
  const matrix = Array.from({ length: 16 }, (_, index) => index);
  const source = [...matrix];
  const [withPose] = normalizeDetections([{ targetIndex: 0, worldPosition: [1, 2, 3], pose: source }]);
  assert.deepEqual(withPose.pose, matrix);
  source[12] = 999;
  assert.equal(withPose.pose[12], 12, 'pose must be copied, not aliased');

  const [withoutPose] = normalizeDetections([{ targetIndex: 0, worldPosition: [1, 2, 3] }]);
  assert.equal(withoutPose.pose, null);

  for (const bad of [[1, 2, 3], new Array(16).fill(NaN), 'nope', {}, null]) {
    const [card] = normalizeDetections([{ targetIndex: 0, worldPosition: [1, 2, 3], pose: bad }]);
    assert.equal(card.pose, null, `pose ${JSON.stringify(bad)} must become null`);
  }
});

// ---------------------------------------------------------------------------
// describeCard
// ---------------------------------------------------------------------------

test('describeCard reports type and role, and null for unknown cards', () => {
  assert.deepEqual(describeCard('gargoyle'), { cardId: 'gargoyle', type: 'gargoyle', role: 'prajurit' });
  assert.equal(describeCard('nope'), null);
  assert.equal(describeCard(undefined), null);
});

// ---------------------------------------------------------------------------
// CardTrackingController shape (import must not need a browser)
// ---------------------------------------------------------------------------

test('CardTrackingController is constructible in plain Node and safe before start', () => {
  const controller = new CardTrackingController({ container: null, onCards: () => {}, onError: () => {} });
  assert.ok(controller.cards instanceof Map);
  assert.equal(controller.cards.size, 0);
  assert.equal(typeof controller.isSupported(), 'boolean');
  assert.equal(controller.isSupported(), false); // Node has no navigator.mediaDevices
  // stop()/dispose() must be idempotent and safe when never started.
  assert.doesNotThrow(() => controller.stop());
  assert.doesNotThrow(() => controller.stop());
  assert.doesNotThrow(() => controller.dispose());
  assert.doesNotThrow(() => controller.dispose());
});

test('start() fails with a clear Indonesian message instead of a resolution crash', async () => {
  const errors = [];
  const controller = new CardTrackingController({ container: null, onCards: () => {}, onError: error => errors.push(error) });
  await assert.rejects(() => controller.start(), error => {
    assert.ok(error instanceof Error);
    // Node has no DOM, so the environment message must be specific and actionable.
    assert.match(error.message, /browser|MindAR|Kamera/i);
    return true;
  });
  assert.equal(errors.length, 1, 'onError must be called exactly once');
  assert.equal(errors[0].message, controller.lastError?.message);
});

// ---------------------------------------------------------------------------
// detectCapabilities
// ---------------------------------------------------------------------------

test('detectCapabilities reports cardTracking false with a clear reason when the camera is missing', () => {
  const result = detectCapabilities({ mediaDevices: {} });
  assert.equal(result.cardTracking, false);
  assert.equal(result.camera, false);
  assert.equal('immersiveAr' in result, false);
  assert.equal('markerless' in result, false);
  assert.equal('marker' in result, false);
  assert.equal('hasCamera' in result, false);
  assert.deepEqual(Object.keys(result).sort(), ['camera', 'cardTracking', 'reasons', 'secureContext']);
  assert.ok(result.reasons.length >= 1);
  assert.ok(result.reasons.some(reason => /kamera/i.test(reason)), `expected a camera reason, got: ${result.reasons.join(' | ')}`);
  assert.match(explainCapabilities(result), /kamera|Preview Desktop/i);
});

test('detectCapabilities reports cardTracking true when camera and secure context are present', () => {
  globalThis.window = { isSecureContext: true };
  try {
    const result = detectCapabilities({ mediaDevices: { getUserMedia: () => {} } });
    assert.equal(result.camera, true);
    assert.equal(result.secureContext, true);
    assert.equal(result.cardTracking, true);
    assert.deepEqual(result.reasons, []);
    assert.match(explainCapabilities(result), /siap/i);
  } finally {
    delete globalThis.window;
  }
});

test('detectCapabilities reports a secure-context reason when the page is not secure', () => {
  globalThis.window = { isSecureContext: false };
  try {
    const result = detectCapabilities({ mediaDevices: { getUserMedia: () => {} } });
    assert.equal(result.camera, true);
    assert.equal(result.secureContext, false);
    assert.equal(result.cardTracking, false);
    assert.equal(result.reasons.length, 1);
    assert.match(result.reasons[0], /HTTPS|localhost|aman/i);
  } finally {
    delete globalThis.window;
  }
});

test('detectCapabilities defaults to no camera and no secure context in Node', () => {
  const result = detectCapabilities();
  assert.equal(result.camera, false);
  assert.equal(result.secureContext, false);
  assert.equal(result.cardTracking, false);
  assert.equal(result.reasons.length, 2);
});

test('detectCapabilities tolerates a missing media stub', () => {
  assert.equal(detectCapabilities(undefined).cardTracking, false);
  assert.equal(detectCapabilities(null).cardTracking, false);
  assert.equal(detectCapabilities({}).cardTracking, false);
});
