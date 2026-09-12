import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { SFX_EVENTS, sfxFor } from '../../src/audio/audio-system.js';

// The event vocabulary is owned by BattleSystem, not by the audio layer. This
// reads the literals straight out of `#emit(...)` in battle-system.js so the
// subset assertion below cannot silently go stale when the domain changes.
function emittedEventTypes() {
  const source = readFileSync(
    fileURLToPath(new URL('../../src/core/battle-system.js', import.meta.url)),
    'utf8'
  );
  const types = new Set();
  for (const match of source.matchAll(/#emit\(\s*'([^']+)'/g)) types.add(match[1]);
  return [...types].sort();
}

test('battle events map to sound effects', () => {
  assert.equal(sfxFor({ type: 'attack' }), 'attack');
  assert.equal(sfxFor({ type: 'impact' }), 'impact');
  assert.equal(sfxFor({ type: 'destroy' }), 'destroy');
  assert.equal(sfxFor({ type: 'victory' }), 'victory');
});

test('battle-start maps to its own sound effect', () => {
  assert.equal(SFX_EVENTS['battle-start'], 'battle-start');
  assert.equal(sfxFor({ type: 'battle-start' }), 'battle-start');
});

test('unknown events produce no sound', () => {
  assert.equal(sfxFor({ type: 'nope' }), null);
  assert.equal(sfxFor(undefined), null);
});

test('sfxFor never throws on hostile input', () => {
  for (const input of [null, 0, '', false, NaN, [], { type: '' }, { type: 0 }, Object.create(null)]) {
    assert.equal(sfxFor(input), null);
  }
});

test('move is deliberately silent: a per-step footstep would be a buzz', () => {
  // BattleSystem emits one `move` per unit per fixed 1/120 s step, so mapping it
  // to a sound would fire up to 120 cues per second per walking unit.
  assert.equal(Object.hasOwn(SFX_EVENTS, 'move'), false);
  assert.equal(sfxFor({ type: 'move', unitId: 'blue-tank-0', x: 1, z: 2 }), null);
});

test('SFX_EVENTS has no key BattleSystem never emits', () => {
  const emitted = emittedEventTypes();
  // Guard the extractor itself: if the parse ever returns nothing the subset
  // assertion below would vacuously pass and prove nothing.
  assert.ok(emitted.length >= 5, `expected real emitted event types, got ${JSON.stringify(emitted)}`);
  for (const type of Object.keys(SFX_EVENTS)) {
    assert.ok(emitted.includes(type), `stale SFX key "${type}" is not emitted by BattleSystem`);
  }
});

test('SFX_EVENTS contains no dead summon key', () => {
  assert.equal(Object.hasOwn(SFX_EVENTS, 'summon'), false);
});