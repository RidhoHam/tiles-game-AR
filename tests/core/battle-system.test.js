import test from 'node:test';
import assert from 'node:assert/strict';
import { BattleSystem } from '../../src/core/battle-system.js';

// `unit` mirrors a calibrated unit record: no health/maxHealth is supplied on
// purpose, so the battle system must fill them from UNIT_DEFINITIONS.
const unit = (id, type, faction, x, z) => ({
  id, type, faction,
  role: type === 'benteng' || type === 'bunker' ? 'base' : type === 'tank' || type === 'robot' ? 'artileri' : 'prajurit',
  cooldown: 0, position: { x, z }, targetId: null, alive: true
});

// `setup` builds a valid, symmetric-ish battlefield: one base, one artileri and
// one prajurit per side, matching the three-card team rule.
const setup = () => [
  unit('blue-benteng-0', 'benteng', 'blue', -5, 0),
  unit('blue-tank-0', 'tank', 'blue', -3, 0),
  unit('blue-kesatria-0', 'kesatria', 'blue', -4, 1),
  unit('red-bunker-0', 'bunker', 'red', 5, 0),
  unit('red-robot-0', 'robot', 'red', 3, 0),
  unit('red-gargoyle-0', 'gargoyle', 'red', 4, 1)
];

// A valid team whose fighters deliberately sit on different z lanes from the
// opposing fighters. Every unit must still close the gap and end the battle.
const laneMisaligned = () => [
  unit('blue-benteng-0', 'benteng', 'blue', -5, 0),
  unit('blue-tank-0', 'tank', 'blue', -4, -3),
  unit('blue-kesatria-0', 'kesatria', 'blue', -4.5, 3),
  unit('red-bunker-0', 'bunker', 'red', 5, 0),
  unit('red-robot-0', 'robot', 'red', 4, 3),
  unit('red-gargoyle-0', 'gargoyle', 'red', 4.5, -3)
];

function build(onEvent, units = setup()) {
  const battle = new BattleSystem({ onEvent });
  battle.configure({ units });
  return battle;
}

/** Run to completion (or the cap) and report the outcome. */
function play(units, dt, cap = 200000) {
  const battle = new BattleSystem();
  const result = battle.configure({ units });
  const started = battle.start();
  let frames = 0;
  while (battle.state === 'running' && frames < cap) {
    battle.update(dt);
    frames += 1;
  }
  return { battle, result, started, frames, units: battle.snapshot().units };
}

test('configure accepts the { units } shape and normalises health and role', () => {
  const battle = build();
  assert.equal(battle.units.size, 6);
  assert.equal(battle.units.get('blue-benteng-0').role, 'base');
  assert.equal(battle.units.get('blue-benteng-0').maxHealth, 200);
  assert.equal(battle.units.get('blue-benteng-0').health, 200);
  assert.equal(battle.units.get('blue-tank-0').role, 'artileri');
  assert.equal(battle.units.get('blue-tank-0').damage, undefined);
});

test('configure rejects a battlefield with no combat-capable unit', () => {
  const battle = new BattleSystem();
  const result = battle.configure({ units: [unit('blue-benteng-0', 'benteng', 'blue', -5, 0)] });
  assert.equal(result.valid, false);
  assert.equal(result.fighters, 0);
});

test('configure rejects a one-sided fight that could never end', () => {
  const battle = new BattleSystem();
  const result = battle.configure({
    units: [
      unit('blue-benteng-0', 'benteng', 'blue', -5, 0),
      unit('blue-tank-0', 'tank', 'blue', -3, 0),
      unit('red-bunker-0', 'bunker', 'red', 5, 0)
    ]
  });
  // Red has no attacker, so the red base could never fall: not startable.
  assert.equal(result.valid, false);
});

test('start refuses an invalid configuration and never enters running', () => {
  const battle = new BattleSystem();
  const events = [];
  battle.onEvent = event => events.push(event);
  assert.equal(battle.configure({ units: [unit('blue-benteng-0', 'benteng', 'blue', -5, 0)] }).valid, false);
  assert.equal(battle.start(), false);
  assert.equal(battle.state, 'ready');
  assert.equal(battle.start(), false);
  assert.equal(events.length, 0);
  battle.update(1);
  assert.equal(battle.time, 0);
});

test('start refuses a payload with no units at all', () => {
  const battle = new BattleSystem();
  assert.equal(battle.configure({}).valid, false);
  assert.equal(battle.start(), false);
  assert.equal(battle.state, 'ready');
});

test('configure tolerates a missing or malformed payload', () => {
  const battle = new BattleSystem();
  assert.deepEqual(battle.configure({}), { valid: false, count: 0, fighters: 0 });
  assert.deepEqual(battle.configure(), { valid: false, count: 0, fighters: 0 });
  assert.equal(battle.configure({ units: [null, { id: 'x' }] }).count, 0);
});

test('configure reports readiness and start emits battle-start once', () => {
  const events = [];
  const battle = build(event => events.push(event));
  assert.equal(battle.state, 'ready');
  assert.equal(battle.start(), true);
  assert.equal(battle.start(), false);
  assert.equal(events.filter(event => event.type === 'battle-start').length, 1);
});

test('a configured battle walks units that start out of range', () => {
  const events = [];
  const battle = build(event => events.push(event));
  battle.start();
  battle.update(0.1);
  // Blue prajurit starts at -4 and red's nearest unit at 3: nothing is in
  // melee range yet, so the prajurit must have emitted a move.
  assert.ok(events.some(event => event.type === 'move'));
  assert.equal(events.some(event => event.type === 'attack'), false);
});

test('an in-range unit attacks, emits impact and removes health', () => {
  const events = [];
  const battle = build(event => events.push(event), [
    unit('blue-kesatria-0', 'kesatria', 'blue', 0, 0),
    unit('red-bunker-0', 'bunker', 'red', 0.5, 0),
    unit('blue-benteng-0', 'benteng', 'blue', -8, 0),
    unit('red-robot-0', 'robot', 'red', 8, 0)
  ]);
  battle.start();
  battle.update(0.1);
  const attack = events.find(event => event.type === 'attack');
  const impact = events.find(event => event.type === 'impact');
  assert.equal(attack.unitId, 'blue-kesatria-0');
  assert.equal(attack.targetId, 'red-bunker-0');
  assert.equal(attack.damage, 14);
  assert.equal(impact.health, 186);
  assert.equal(battle.units.get('red-bunker-0').health, 186);
});

test('artillery attacks the nearest living target in range', () => {
  const events = [];
  const battle = build(event => events.push(event), [
    unit('blue-tank', 'tank', 'blue', 0, 0),
    unit('red-near', 'gargoyle', 'red', 2, 0),
    unit('red-far', 'gargoyle', 'red', 3, 0),
    unit('blue-base', 'benteng', 'blue', -8, 0),
    unit('red-base', 'bunker', 'red', 8, 0)
  ]);
  battle.start();
  battle.update(1 / 120);

  const attack = events.find(event => event.type === 'attack');
  assert.equal(attack.unitId, 'blue-tank');
  assert.equal(attack.targetId, 'red-near');
});

test('a dead nearest target is skipped in favor of the next living target', () => {
  const events = [];
  const battle = build(event => events.push(event), [
    unit('blue-tank', 'tank', 'blue', 0, 0),
    { ...unit('red-dead', 'gargoyle', 'red', 1, 0), alive: false, health: 0 },
    unit('red-living', 'gargoyle', 'red', 2, 0),
    unit('blue-base', 'benteng', 'blue', -8, 0),
    unit('red-base', 'bunker', 'red', 8, 0)
  ]);
  battle.start();
  battle.update(1 / 120);

  const attack = events.find(event => event.type === 'attack');
  assert.equal(attack.unitId, 'blue-tank');
  assert.equal(attack.targetId, 'red-living');
  assert.equal(events.some(event => event.targetId === 'red-dead'), false);
});

test('both factions can attack during the same fixed step', () => {
  const events = [];
  const battle = build(event => events.push(event), [
    unit('blue-base', 'benteng', 'blue', -8, 0),
    unit('blue-tank', 'tank', 'blue', -0.4, 0),
    unit('red-base', 'bunker', 'red', 8, 0),
    unit('red-tank', 'tank', 'red', 0.4, 0)
  ]);
  battle.start();
  battle.update(1 / 120);

  const attacks = events.filter(event => event.type === 'attack');
  assert.deepEqual(new Set(attacks.map(event => event.unitId)), new Set(['blue-tank', 'red-tank']));
  assert.deepEqual(new Set(attacks.map(event => event.targetId)), new Set(['blue-tank', 'red-tank']));
});

test('a unit does not attack again until its attackInterval of simulated time', () => {
  const events = [];
  const battle = build(event => events.push(event), [
    unit('blue-kesatria-0', 'kesatria', 'blue', 0, 0),
    unit('red-bunker-0', 'bunker', 'red', 0.5, 0),
    unit('blue-benteng-0', 'benteng', 'blue', -8, 0),
    unit('red-robot-0', 'robot', 'red', 8, 0)
  ]);
  battle.start();
  // kesatria attackInterval is 0.8 s of simulated time. The weapon fires on
  // the first frame that finds a target ready, then recharges for 0.8 s: the
  // first shot lands at t=0.1, the second only once 0.8 s have passed, i.e.
  // the tick that brings t to 0.9.
  battle.update(0.1);
  assert.equal(events.filter(event => event.type === 'attack').length, 1, 'the first in-range frame fires');
  for (let i = 0; i < 6; i += 1) battle.update(0.1);
  assert.equal(events.filter(event => event.type === 'attack').length, 1, 'no second hit inside the interval');
  battle.update(0.1);
  assert.equal(events.filter(event => event.type === 'attack').length, 1, 'still recharging one frame before the interval');
  battle.update(0.1);
  assert.equal(events.filter(event => event.type === 'attack').length, 2, 'second hit lands after the interval');
});

test('the same composition and positions always produce the same events', () => {
  const run = () => {
    const events = [];
    const battle = build(event => events.push(event));
    battle.start();
    for (let step = 0; step < 400 && battle.state === 'running'; step += 1) battle.update(0.05);
    return events;
  };
  const first = run();
  const second = run();
  assert.ok(first.length > 0);
  assert.deepEqual(first, second);
});

test('the winner and duration are invariant to the frame rate', () => {
  const fast = play(setup(), 1 / 240);
  const slow = play(setup(), 1 / 30);
  assert.equal(fast.started, true);
  assert.equal(slow.started, true);
  assert.equal(fast.battle.state, 'finished');
  assert.equal(slow.battle.state, 'finished');
  assert.equal(fast.battle.winner, slow.battle.winner, 'same winner at any frame rate');
  // A frame-rate dependent fight would differ by ~8x; require 15%.
  const drift = Math.abs(fast.battle.time - slow.battle.time) / Math.max(fast.battle.time, slow.battle.time);
  assert.ok(drift < 0.15, `simulated duration drifted ${(drift * 100).toFixed(1)}% between frame rates`);
});

test('a deliberately lane-misaligned team still finishes the battle', () => {
  const fast = play(laneMisaligned(), 1 / 240);
  const slow = play(laneMisaligned(), 1 / 30);
  assert.equal(fast.started, true);
  assert.equal(slow.started, true);
  assert.equal(fast.battle.state, 'finished', 'the lane-misaligned battle must end');
  assert.equal(slow.battle.state, 'finished');
  assert.equal(fast.battle.winner, slow.battle.winner);
  assert.ok(['blue', 'red'].includes(fast.battle.winner));
  // Bounded, not endless: well under the frame cap at either sampled rate.
  assert.ok(slow.frames < 5000, `expected a bounded battle, used ${slow.frames} frames`);
  const victory = fast.battle.events.find(event => event.type === 'victory');
  assert.equal(victory.winner, fast.battle.winner);
});

test('no unit ever finishes absurdly far outside the arena', () => {
  const lineups = [setup(), laneMisaligned(), [
    unit('blue-benteng-0', 'benteng', 'blue', -9, 0),
    unit('blue-tank-0', 'tank', 'blue', -4, 3.5),
    unit('blue-kesatria-0', 'kesatria', 'blue', -4.5, -3.5),
    unit('red-bunker-0', 'bunker', 'red', 9, 0),
    unit('red-robot-0', 'robot', 'red', 7, -3),
    unit('red-gargoyle-0', 'gargoyle', 'red', 6, 4)
  ]];
  for (const units of lineups) {
    const { battle } = play(units, 1 / 120);
    assert.equal(battle.state, 'finished');
    for (const item of battle.snapshot().units) {
      assert.ok(Math.abs(item.position.x) <= 12, `|x| out of bounds: ${item.position.x} for ${item.id}`);
      assert.ok(Math.abs(item.position.z) <= 8, `|z| out of bounds: ${item.position.z} for ${item.id}`);
    }
  }
});

test('blue and red fight in both directions', () => {
  const events = [];
  const battle = build(event => events.push(event), [
    unit('blue-benteng-0', 'benteng', 'blue', -9, 0),
    unit('blue-tank-0', 'tank', 'blue', -0.4, 0),
    unit('red-bunker-0', 'bunker', 'red', 9, 0),
    unit('red-tank-0', 'tank', 'red', 0.4, 0)
  ]);
  battle.start();
  for (let step = 0; step < 4000 && battle.state === 'running'; step += 1) battle.update(0.05);
  const attackers = new Set(events.filter(event => event.type === 'attack').map(event => event.unitId));
  assert.ok(attackers.has('blue-tank-0'), 'blue should attack');
  assert.ok(attackers.has('red-tank-0'), 'red should attack');
  assert.equal(battle.state, 'finished');
});

test('bases never attack or move', () => {
  const events = [];
  const battle = build(event => events.push(event), [
    unit('blue-benteng-0', 'benteng', 'blue', -0.5, 0),
    unit('blue-tank-0', 'tank', 'blue', -4, 0),
    unit('red-bunker-0', 'bunker', 'red', 0.5, 0),
    unit('red-tank-0', 'tank', 'red', 4, 0)
  ]);
  assert.equal(battle.start(), true);
  battle.update(1 / 120);
  assert.equal(battle.units.get('blue-benteng-0').position.x, -0.5);
  assert.equal(battle.units.get('red-bunker-0').position.x, 0.5);
  assert.equal(events.some(event => event.type === 'attack' && event.unitId === 'blue-benteng-0'), false);
  assert.equal(events.some(event => event.type === 'attack' && event.unitId === 'red-bunker-0'), false);
  assert.equal(events.some(event => event.type === 'move' && event.unitId === 'blue-benteng-0'), false);
  assert.equal(events.some(event => event.type === 'move' && event.unitId === 'red-bunker-0'), false);
});

test('battle ends and emits victory when a base is destroyed', () => {
  const events = [];
  const battle = build(event => events.push(event), [
    unit('blue-benteng-0', 'benteng', 'blue', -9, 0),
    unit('blue-tank-0', 'tank', 'blue', 0, 0),
    unit('red-bunker-0', 'bunker', 'red', 1, 0),
    unit('red-tank-0', 'tank', 'red', 9, 0)
  ]);
  battle.start();
  for (let step = 0; step < 4000 && battle.state === 'running'; step += 1) battle.update(0.05);
  assert.equal(battle.state, 'finished');
  // Red fights from a base-adjacent start with a full-health tank; the red side
  // wins here. The point of the test is the victory contract, not the side.
  assert.equal(battle.winner, 'red');
  const victory = events.find(event => event.type === 'victory');
  assert.equal(victory.winner, 'red');
  assert.deepEqual(battle.baseHealth(), { blue: 0, red: 20 });
  assert.equal(events.some(event => event.type === 'destroy' && event.unitId === 'blue-benteng-0'), true);
  // No event is emitted after victory.
  assert.equal(events[events.length - 1].type, 'victory');
});

test('the battle system only emits the allowed event types', () => {
  const allowed = new Set(['battle-start', 'attack', 'impact', 'move', 'destroy', 'victory']);
  const events = [];
  const battle = build(event => events.push(event));
  battle.start();
  for (let step = 0; step < 4000 && battle.state === 'running'; step += 1) battle.update(0.05);
  assert.ok(events.length > 0);
  for (const event of events) assert.ok(allowed.has(event.type), `unexpected event ${event.type}`);
});

test('a move event carries the unit id and its new x and z', () => {
  const events = [];
  const battle = build(event => events.push(event));
  battle.start();
  for (let step = 0; step < 4000 && battle.state === 'running'; step += 1) battle.update(0.05);
  const moves = events.filter(event => event.type === 'move');
  assert.ok(moves.length > 0);
  for (const move of moves) {
    assert.equal(typeof move.unitId, 'string');
    assert.ok(Number.isFinite(move.x), 'move must carry a finite x');
    assert.ok(Number.isFinite(move.z), 'move must carry a finite z');
  }
});

test('update ignores non-finite and non-positive dt', () => {
  const events = [];
  const battle = build(event => events.push(event));
  battle.start();
  battle.update(Number.NaN);
  battle.update(Infinity);
  battle.update(0);
  battle.update(-1);
  battle.update(undefined);
  assert.equal(battle.time, 0);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, 'battle-start');
});

test('damage guard rejects unknown, dead and non-positive inputs', () => {
  const battle = build();
  assert.equal(battle.damage('nope', 10), false);
  assert.equal(battle.damage('red-bunker-0', 0), false);
  assert.equal(battle.damage('red-bunker-0', Number.NaN), false);
  assert.equal(battle.damage('red-bunker-0', 200), true);
  assert.equal(battle.damage('red-bunker-0', 10), false);
});

test('baseHealth reports live bases and zeroes destroyed ones', () => {
  const battle = build();
  battle.start();
  assert.deepEqual(battle.baseHealth(), { blue: 200, red: 200 });
  battle.damage('red-bunker-0', 200);
  assert.deepEqual(battle.baseHealth(), { blue: 200, red: 0 });
  assert.equal(battle.state, 'finished');
  assert.equal(battle.winner, 'blue');
});

test('unitTitle resolves known ids and rejects unknown ones', () => {
  const battle = build();
  assert.equal(battle.unitTitle('blue-benteng-0'), 'Benteng Pasir');
  assert.equal(battle.unitTitle('blue-tank-0'), 'Tank Pasir');
  assert.equal(battle.unitTitle('nope'), null);
});

test('snapshot exposes the new shape without a summons field', () => {
  const battle = build();
  const snapshot = battle.snapshot();
  assert.equal(snapshot.units.length, 6);
  assert.equal('summons' in snapshot, false);
  assert.deepEqual(snapshot.units.find(item => item.id === 'blue-benteng-0').position, { x: -5, z: 0 });
  // Snapshot positions are copies, so a caller cannot mutate live state.
  snapshot.units[0].position.x = 999;
  assert.notEqual(battle.units.get(snapshot.units[0].id).position.x, 999);
});

test('update is a no-op before start and after the battle finishes', () => {
  const events = [];
  const battle = build(event => events.push(event));
  battle.update(1);
  assert.equal(battle.time, 0);
  battle.start();
  battle.damage('red-bunker-0', 200);
  const frozen = events.length;
  battle.update(1);
  assert.equal(events.length, frozen);
  assert.deepEqual(battle.baseHealth(), { blue: 200, red: 0 });
});
