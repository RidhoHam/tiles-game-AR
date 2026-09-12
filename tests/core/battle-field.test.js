import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleField } from '../../src/core/battle-field.js';

const unit = (id, role, faction, x, z) => ({ id, type: role === 'base' ? 'benteng' : role === 'artileri' ? 'tank' : 'kesatria', role, faction, position: { x, z }, alive: true });

test('a unit picks the nearest living enemy in range', () => {
  const field = new BattleField({
    units: [
      unit('blue-a', 'artileri', 'blue', 0, 0),
      unit('red-near', 'prajurit', 'red', 2, 0),
      unit('red-far', 'base', 'red', 6, 0)
    ]
  });
  assert.equal(field.targetFor(field.units.get('blue-a')).id, 'red-near');
});

test('a prajurit only attacks in melee range', () => {
  const field = new BattleField({
    units: [unit('blue-p', 'prajurit', 'blue', 0, 0), unit('red-b', 'base', 'red', 5, 0)]
  });
  assert.equal(field.isInRange(field.units.get('blue-p'), field.units.get('red-b')), false);
});

test('units advance toward the enemy when nothing is in range', () => {
  const field = new BattleField({
    units: [unit('blue-p', 'prajurit', 'blue', 0, 0), unit('red-b', 'base', 'red', 5, 0)]
  });
  const prajurit = field.units.get('blue-p');
  field.advance(prajurit, 1);
  assert.ok(prajurit.position.x > 0);
});

// --- Guard and design coverage beyond the three brief tests above. ---

test('the constructor accepts an array or a Map as well as { units }', () => {
  const fromArray = new BattleField([unit('blue-a', 'artileri', 'blue', 0, 0)]);
  assert.equal(fromArray.units.size, 1);
  const fromMap = new BattleField(new Map([['blue-a', unit('blue-a', 'artileri', 'blue', 0, 0)]]));
  assert.equal(fromMap.units.get('blue-a').id, 'blue-a');
  assert.equal(new BattleField({ units: new Map([['blue-a', unit('blue-a', 'artileri', 'blue', 0, 0)]]) }).units.size, 1);
});

test('unknown types, missing ids and bad positions are dropped, not thrown', () => {
  const field = new BattleField({
    units: [
      { id: 'ghost', type: 'naga', faction: 'blue', position: { x: 0, z: 0 } },
      { type: 'tank', faction: 'blue', position: { x: 0, z: 0 } },
      { id: 'bad-pos', type: 'tank', faction: 'blue', position: { x: Number.NaN, z: 0 } },
      { id: 'no-pos', type: 'tank', faction: 'blue' },
      null,
      'nonsense',
      unit('ok', 'tank', 'blue', 1, 1)
    ]
  });
  assert.equal(field.units.size, 1);
  assert.ok(field.units.has('ok'));
});

test('role and health are filled in from the unit definitions', () => {
  const field = new BattleField({ units: [unit('blue-b', 'base', 'blue', 0, 0)] });
  const base = field.units.get('blue-b');
  assert.equal(base.role, 'base');
  assert.equal(base.health, 200);
  assert.equal(base.maxHealth, 200);
  assert.equal(base.cooldown, 0);
});

test('distance is Euclidean on the x/z plane and null for bad input', () => {
  const field = new BattleField({ units: [unit('a', 'tank', 'blue', 0, 0), unit('b', 'tank', 'red', 3, 4)] });
  assert.equal(field.distance(field.units.get('a'), field.units.get('b')), 5);
  assert.equal(field.distance(field.units.get('a'), null), null);
  assert.equal(field.distance(field.units.get('a'), { position: { x: Number.NaN, z: 0 } }), null);
});

test('targetFor returns null when nothing is in range', () => {
  const field = new BattleField({ units: [unit('blue-p', 'prajurit', 'blue', 0, 0), unit('red-b', 'base', 'red', 5, 0)] });
  assert.equal(field.targetFor(field.units.get('blue-p')), null);
});

test('targetFor skips dead enemies and never targets an ally', () => {
  const field = new BattleField({
    units: [
      unit('blue-a', 'artileri', 'blue', 0, 0),
      { ...unit('red-near', 'prajurit', 'red', 1, 0), alive: false },
      unit('red-near2', 'prajurit', 'red', 1.5, 0),
      unit('blue-b', 'prajurit', 'blue', 0.5, 0)
    ]
  });
  assert.equal(field.targetFor(field.units.get('blue-a')).id, 'red-near2');
});

test('target selection is deterministic when two enemies are equidistant', () => {
  const make = () => new BattleField({
    units: [unit('blue-a', 'artileri', 'blue', 0, 0), unit('red-z', 'prajurit', 'red', 2, 0), unit('red-a', 'prajurit', 'red', -2, 0)]
  });
  assert.equal(make().targetFor(make().units.get('blue-a')).id, 'red-a');
  assert.equal(make().targetFor(make().units.get('blue-a')).id, 'red-a');
});

test('bases never pick a target and never advance', () => {
  const field = new BattleField({ units: [unit('blue-b', 'base', 'blue', 0, 0), unit('red-p', 'prajurit', 'red', 0.5, 0)] });
  const base = field.units.get('blue-b');
  assert.equal(field.targetFor(base), null);
  assert.equal(field.advance(base, 1), false);
  assert.equal(base.position.x, 0);
});

test('a base never becomes an attacker even when an enemy is adjacent', () => {
  const field = new BattleField({
    units: [
      unit('blue-base', 'base', 'blue', 0, 0),
      unit('red-p', 'prajurit', 'red', 0.5, 0)
    ]
  });
  const base = field.units.get('blue-base');
  assert.equal(field.isInRange(base, field.units.get('red-p')), false);
  assert.equal(field.targetFor(base), null);
});

test('advance moves blue toward +x and red toward -x at the unit speed', () => {
  const field = new BattleField({
    units: [
      unit('blue-p', 'prajurit', 'blue', 0, 0),
      unit('red-p', 'prajurit', 'red', 4, 0),
      unit('red-b', 'base', 'red', 9, 0)
    ]
  });
  // The enemy at 4 is not in melee range, so the blue prajurit walks: the
  // objective is the enemy base on the enemy lane, so it moves to +x only.
  assert.equal(field.advance(field.units.get('blue-p'), 1), true);
  assert.equal(field.units.get('blue-p').position.x, 2.2);
  assert.equal(field.units.get('blue-p').position.z, 0);

  const mirror = new BattleField({
    units: [
      unit('red-p', 'prajurit', 'red', 0, 0),
      unit('blue-p2', 'prajurit', 'blue', -4, 0),
      unit('blue-b', 'base', 'blue', -9, 0)
    ]
  });
  assert.equal(mirror.advance(mirror.units.get('red-p'), 1), true);
  assert.equal(mirror.units.get('red-p').position.x, -2.2);
  assert.equal(mirror.units.get('red-p').position.z, 0);
});

test('advance ignores dead units and non-finite or non-positive dt', () => {
  const field = new BattleField({ units: [unit('blue-p', 'prajurit', 'blue', 0, 0), { ...unit('red-p', 'prajurit', 'red', 0, 0), alive: false }] });
  const prajurit = field.units.get('blue-p');
  const dead = field.units.get('red-p');
  assert.equal(field.advance(prajurit, 0), false);
  assert.equal(field.advance(prajurit, -1), false);
  assert.equal(field.advance(prajurit, Number.NaN), false);
  assert.equal(field.advance(prajurit, Infinity), false);
  assert.equal(field.advance(dead, 1), false);
  assert.equal(field.advance(null, 1), false);
  assert.equal(prajurit.position.x, 0);
});

test('advance closes the z gap for a lane-misaligned unit', () => {
  // Regression for the endless battle: blue at (-5, 0), a red base at (5, 0)
  // and nothing else. A unit on a different lane must still reach the base.
  const field = new BattleField({
    units: [
      unit('blue-b', 'base', 'blue', -5, 0),
      unit('blue-k', 'prajurit', 'blue', -5, 3),
      unit('red-b', 'base', 'red', 5, 0)
    ]
  });
  const knight = field.units.get('blue-k');
  const base = field.units.get('red-b');
  let steps = 0;
  while (steps < 5000 && !field.isInRange(knight, base)) {
    field.advance(knight, 1 / 60);
    steps += 1;
  }
  assert.ok(steps < 5000, 'the unit must reach the enemy base, not march forever');
  assert.equal(field.isInRange(knight, base), true);
  // It must never walk past the base it is attacking.
  assert.ok(knight.position.x <= base.position.x, 'must not overshoot the enemy base');
});

test('a unit never oscillates between two frames around the same point', () => {
  const field = new BattleField({
    units: [
      unit('blue-b', 'base', 'blue', -6, 0),
      unit('blue-k', 'prajurit', 'blue', -5, 3.5),
      unit('red-b', 'base', 'red', 6, 0),
      unit('red-p', 'prajurit', 'red', 5, -3.5)
    ]
  });
  const knight = field.units.get('blue-k');
  let previous = null;
  let reversals = 0;
  for (let i = 0; i < 4000; i += 1) {
    const before = { ...knight.position };
    const moved = field.advance(knight, 1 / 60);
    if (!moved) break;
    const step = { dx: knight.position.x - before.x, dz: knight.position.z - before.z };
    if (previous && previous.dx * step.dx < 0 && previous.dz * step.dz < 0) reversals += 1;
    previous = step;
  }
  assert.equal(reversals, 0, 'movement must not reverse direction frame to frame');
});

test('isInRange follows the attacker range and ignores friendlies and dead units', () => {
  const field = new BattleField({
    units: [
      unit('blue-art', 'artileri', 'blue', 0, 0),
      unit('red-p', 'prajurit', 'red', 3, 0),
      unit('blue-p', 'prajurit', 'blue', 1, 0),
      { ...unit('red-dead', 'prajurit', 'red', 1, 0), alive: false }
    ]
  });
  const art = field.units.get('blue-art');
  // tank range is 3.8, so a prajurit at 3 is in range.
  assert.equal(field.isInRange(art, field.units.get('red-p')), true);
  assert.equal(field.isInRange(art, field.units.get('blue-p')), false);
  assert.equal(field.isInRange(art, field.units.get('red-dead')), false);
  // A dead attacker cannot attack, and canAttack mirrors isInRange.
  assert.equal(field.isInRange(field.units.get('red-dead'), art), false);
  assert.equal(field.canAttack(art, field.units.get('red-p')), true);
});

test('isInRange is inclusive of the exact range boundary', () => {
  const field = new BattleField({ units: [unit('blue-k', 'prajurit', 'blue', 0, 0), unit('red-k', 'prajurit', 'red', 1.1, 0)] });
  // kesatria range is exactly 1.1.
  assert.equal(field.isInRange(field.units.get('blue-k'), field.units.get('red-k')), true);
});
