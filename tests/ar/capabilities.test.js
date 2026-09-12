import test from 'node:test';
import assert from 'node:assert/strict';
import { detectCapabilities, explainCapabilities } from '../../src/ar/capabilities.js';

// The old markerless / immersive-ar / marker assertions were removed with the
// feature: WebXR immersive-ar is desktop-unavailable and no longer detected.
// What remains is the card-tracking contract (camera + secure context).

test('card tracking requires camera support', () => {
  const result = detectCapabilities({});
  assert.equal(result.camera, false);
  assert.equal(result.cardTracking, false);
  assert.match(result.reasons.join(' '), /Kamera/);
});

test('card tracking requires a secure context', () => {
  globalThis.window = { isSecureContext: true };
  try {
    assert.equal(detectCapabilities({ mediaDevices: { getUserMedia: () => {} } }).cardTracking, true);
  } finally {
    delete globalThis.window;
  }
});

test('an insecure context blocks card tracking', () => {
  globalThis.window = { isSecureContext: false };
  try {
    const result = detectCapabilities({ mediaDevices: { getUserMedia: () => {} } });
    assert.equal(result.camera, true);
    assert.equal(result.cardTracking, false);
    assert.match(result.reasons.join(' '), /HTTPS|localhost/);
  } finally {
    delete globalThis.window;
  }
});

test('no surface from the removed immersive-ar era is exposed', () => {
  const result = detectCapabilities({});
  assert.deepEqual(Object.keys(result).sort(), ['camera', 'cardTracking', 'reasons', 'secureContext']);
});

test('explanation prefers the first failure reason', () => {
  const result = detectCapabilities({});
  assert.equal(explainCapabilities(result), result.reasons[0]);
});

test('explanation confirms readiness when card tracking is available', () => {
  assert.match(explainCapabilities({ cardTracking: true, reasons: [] }), /siap/i);
});

test('explanation survives an empty capabilities object', () => {
  assert.equal(typeof explainCapabilities({}), 'string');
  assert.equal(typeof explainCapabilities(undefined), 'string');
});
