import test from 'node:test';
import assert from 'node:assert/strict';
import { createAppState, MODES, PHASES } from '../../src/ui/app-state.js';

test('mode defaults to battle and only accepts test or battle', () => {
  const state = createAppState();
  assert.deepEqual([...MODES], ['test', 'battle']);
  assert.equal(state.mode, 'battle');
  assert.equal(state.setMode('test'), true);
  assert.equal(state.mode, 'test');
  assert.equal(state.setMode('invalid'), false);
  assert.equal(state.mode, 'test');
});

test('selecting a new mode emits a state snapshot', () => {
  const seen = [];
  const state = createAppState({ onChange: snapshot => seen.push(snapshot) });
  assert.equal(state.setMode('test'), true);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].mode, 'test');
  assert.equal(state.setMode('test'), true);
  assert.equal(seen.length, 1);
});

test('phase order is fixed and starts at camera', () => {
  assert.deepEqual([...PHASES], ['camera', 'scan', 'battle', 'result']);
  assert.equal(createAppState().phase, 'camera');
});

test('next() walks the forward path camera -> scan -> battle -> result', () => {
  const state = createAppState();
  assert.equal(state.next(), true);
  assert.equal(state.phase, 'scan');
  assert.equal(state.next(), true);
  assert.equal(state.phase, 'battle');
  assert.equal(state.next(), true);
  assert.equal(state.phase, 'result');
});

test('next() stops at the end of the chain instead of wrapping', () => {
  const state = createAppState();
  state.next();
  state.next();
  state.next();
  assert.equal(state.next(), false);
  assert.equal(state.phase, 'result');
});

test('invalid transitions are rejected without changing phase', () => {
  const state = createAppState();
  // camera can only reach scan.
  assert.equal(state.goTo('battle'), false);
  assert.equal(state.goTo('result'), false);
  assert.equal(state.phase, 'camera');
});

test('back() is refused: no phase can safely step backwards', () => {
  const state = createAppState();
  assert.equal(state.back(), false);
  assert.equal(state.phase, 'camera');
  state.next();
  assert.equal(state.back(), false);
  assert.equal(state.phase, 'scan');
});

test('result replays to scan (result -> scan is the only exit)', () => {
  const state = createAppState();
  state.next();
  state.next();
  state.next();
  assert.equal(state.phase, 'result');
  assert.equal(state.goTo('scan'), true);
  assert.equal(state.phase, 'scan');
  // Replay must never send the player back to the camera screen.
  assert.equal(state.goTo('camera'), false);
  assert.equal(state.phase, 'scan');
});

test('unknown phases are rejected', () => {
  const state = createAppState();
  assert.equal(state.goTo('holodeck'), false);
  assert.equal(state.goTo(null), false);
  assert.equal(state.goTo(undefined), false);
  assert.equal(state.phase, 'camera');
});

test('setCards stores the reconciled lineup and its validation result', () => {
  const state = createAppState();
  const cards = [{ cardId: 'benteng', type: 'benteng', x: -1 }];
  const validation = { valid: false, errors: ['Tim Merah membutuhkan tepat tiga kartu.'], bySide: {} };
  state.setCards(cards, validation);
  assert.equal(state.cards, cards);
  assert.equal(state.validation, validation);
  assert.deepEqual(state.snapshot().cards, cards);
  assert.deepEqual(state.snapshot().validation, validation);
});

test('setCards without a validation result clears any stale validation', () => {
  const state = createAppState();
  state.setCards([], { valid: false, errors: ['x'] });
  state.setCards([], null);
  assert.equal(state.validation, null);
});

test('setWinner stores the winner and is committed to listeners', () => {
  const seen = [];
  const state = createAppState({ onChange: snapshot => seen.push(snapshot.winner) });
  state.setWinner('blue');
  assert.equal(state.winner, 'blue');
  assert.deepEqual(seen, ['blue']);
});

test('listeners receive every committed change, including cards', () => {
  const seen = [];
  const state = createAppState({ onChange: snapshot => seen.push(snapshot.phase) });
  state.next();
  state.setCards([]);
  state.next();
  assert.deepEqual(seen, ['scan', 'scan', 'battle']);
});

test('an onChange listener supplied to the constructor cannot be unsubscribed by others', () => {
  const seen = [];
  const state = createAppState({ onChange: snapshot => seen.push(snapshot.phase) });
  const unsubscribe = state.subscribe(() => {});
  unsubscribe();
  state.next();
  assert.deepEqual(seen, ['scan']);
});
