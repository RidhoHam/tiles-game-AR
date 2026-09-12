import test from 'node:test';
import assert from 'node:assert/strict';
import { classifySide, validateTeams } from '../../src/core/team-composition.js';

const cards = [
  { cardId: 'benteng', type: 'benteng', x: -0.4 },
  { cardId: 'robot', type: 'robot', x: -0.1 },
  { cardId: 'kesatria', type: 'kesatria', x: -0.25 },
  { cardId: 'bunker', type: 'bunker', x: 0.4 },
  { cardId: 'tank', type: 'tank', x: 0.1 },
  { cardId: 'gargoyle', type: 'gargoyle', x: 0.25 }
];

test('side is decided by position relative to the centre line', () => {
  assert.equal(classifySide(-0.2, 0), 'blue');
  assert.equal(classifySide(0.2, 0), 'red');
  assert.equal(classifySide(0, 0), null);
});

test('a valid layout needs one base, one artileri and one prajurit per side', () => {
  assert.equal(validateTeams(cards).valid, true);
});

test('a side with two bases is rejected', () => {
  const broken = [...cards.filter(card => card.type !== 'robot'), { cardId: 'bunker', type: 'bunker', x: -0.1 }];
  const result = validateTeams(broken);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /Biru/);
});

test('a missing prajurit is reported per side', () => {
  const broken = cards.filter(card => card.type !== 'kesatria');
  const result = validateTeams(broken);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /prajurit/i);
});

test('cards on the centre line are rejected', () => {
  const result = validateTeams([...cards, { cardId: 'tank-tengah', type: 'tank', x: 0 }]);
  assert.equal(result.valid, false);
  assert.match(result.errors.join(' '), /garis tengah/);
});


test('cards without a cardId report an identity error instead of a duplicate', () => {
  const lacking = [cards[0], { type: 'robot', x: -0.1 }, { type: 'tank', x: 0.1 }, ...cards.slice(3)];
  const result = validateTeams(lacking);
  const joined = result.errors.join(' ');
  assert.equal(result.valid, false);
  assert.match(joined, /tidak memiliki identitas/);
  assert.doesNotMatch(joined, /terdeteksi dua kali/);
  // The two identity-less cards are dropped; the four valid cards still land by side.
  assert.equal(result.bySide.blue.length + result.bySide.red.length, 4);
});
