import test from 'node:test';
import assert from 'node:assert/strict';
import { createStatusPillLabel } from '../../src/ui/components/status-pill.js';

// `formatCooldown` used to live in src/ui/components/summon-zone.js. Summoning
// (and therefore the cooldown ring) was removed with the webcam card-AR rewrite,
// so the helper no longer exists anywhere in src/. The two cooldown assertions
// that covered it were dropped with it - there is no production caller left to
// test against.

test('status pill formats time and base health', () => {
  assert.equal(createStatusPillLabel({ time: 84, units: [] }, { blue: 168, red: 162 }), '01:24 · Biru 168 / Merah 162');
});

test('status pill handles missing snapshot time', () => {
  assert.equal(createStatusPillLabel(undefined, { blue: 200, red: 200 }), '00:00 · Biru 200 / Merah 200');
});

test('status pill renders an empty battle as zero base health', () => {
  assert.equal(createStatusPillLabel({ time: 0, units: [] }, { blue: 0, red: 0 }), '00:00 · Biru 0 / Merah 0');
});

test('status pill rolls minutes past the hour correctly', () => {
  assert.equal(createStatusPillLabel({ time: 3661.9, units: [] }, { blue: 12, red: 3 }), '61:01 · Biru 12 / Merah 3');
});
