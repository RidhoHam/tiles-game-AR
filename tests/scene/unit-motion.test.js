import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { advanceToward, nextMotionState, MOTION_STATES } from '../../src/scene/unit-motion.js';
import { SandStructureSystem } from '../../src/scene/sand-structures.js';
import { createUnit } from '../../src/scene/units/unit-factory.js';

test('advanceToward never overshoots the destination', () => {
  const arrived = advanceToward({ x: 0, z: 0 }, { x: 10, z: 0 }, 3);
  assert.equal(arrived.x, 3);
  assert.equal(arrived.z, 0);
  const clamped = advanceToward({ x: 0, z: 0 }, { x: 1, z: 0 }, 5);
  assert.equal(clamped.x, 1);
});

test('advanceToward handles a zero distance target', () => {
  const same = advanceToward({ x: 2, z: 2 }, { x: 2, z: 2 }, 3);
  assert.deepEqual(same, { x: 2, z: 2 });
});

test('motion state machine follows spawn, walk, attack and death', () => {
  assert.equal(nextMotionState('hidden', 'spawn'), 'spawning');
  assert.equal(nextMotionState('spawning', 'ready'), 'walking');
  assert.equal(nextMotionState('walking', 'inRange'), 'attacking');
  assert.equal(nextMotionState('attacking', 'outOfRange'), 'walking');
  assert.equal(nextMotionState('attacking', 'damaged'), 'hit');
  assert.equal(nextMotionState('hit', 'recovered'), 'attacking');
  assert.equal(nextMotionState('walking', 'killed'), 'collapsing');
  assert.equal(nextMotionState('collapsing', 'settled'), 'dead');
});

// ---------------------------------------------------------------------------
// advanceToward robustness
// ---------------------------------------------------------------------------

test('advanceToward treats a zero or negative distance as no movement', () => {
  assert.deepEqual(advanceToward({ x: 1, z: 1 }, { x: 9, z: 9 }, 0), { x: 1, z: 1 });
  assert.deepEqual(advanceToward({ x: 1, z: 1 }, { x: 9, z: 9 }, -5), { x: 1, z: 1 });
});

test('advanceToward survives a quadratic style destination and diagonal move', () => {
  const step = advanceToward({ x: 0, z: 0 }, { x: 3, z: 4 }, 1);
  assert.ok(Math.abs(step.x - 0.6) < 1e-12, `x was ${step.x}`);
  assert.ok(Math.abs(step.z - 0.8) < 1e-12, `z was ${step.z}`);
});

test('advanceToward is finite for NaN and Infinity distance', () => {
  for (const distance of [NaN, Infinity, -Infinity, undefined, null, 'nope']) {
    const result = advanceToward({ x: 2, z: 3 }, { x: 10, z: 3 }, distance);
    assert.ok(Number.isFinite(result.x), `x not finite for ${String(distance)}`);
    assert.ok(Number.isFinite(result.z), `z not finite for ${String(distance)}`);
  }
  assert.deepEqual(advanceToward({ x: 2, z: 3 }, { x: 10, z: 3 }, NaN), { x: 2, z: 3 });
});

test('advanceToward is finite for missing or non-finite coordinates', () => {
  const cases = [
    [undefined, { x: 1, z: 1 }, 2],
    [{ x: NaN, z: 4 }, { x: 1, z: 1 }, 2],
    [{ x: 0, z: 0 }, undefined, 2],
    [{ x: 0, z: 0 }, { x: Infinity, z: -Infinity }, 2],
    [{ x: 0, z: 0 }, { x: 'a', z: 'b' }, 2],
    [null, null, 1]
  ];
  for (const [from, to, distance] of cases) {
    const result = advanceToward(from, to, distance);
    assert.ok(Number.isFinite(result.x), `x not finite for ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
    assert.ok(Number.isFinite(result.z), `z not finite for ${JSON.stringify(from)} -> ${JSON.stringify(to)}`);
  }
});

test('advanceToward never mutates its source point', () => {
  const from = { x: 0, z: 0 };
  const frozen = Object.freeze({ ...from });
  advanceToward(from, { x: 10, z: 10 }, 4);
  assert.deepEqual(from, frozen);
});

test('advanceToward returns a fresh object equal to the target on arrival', () => {
  const from = { x: 0, z: 0 };
  const result = advanceToward(from, { x: 1, z: 0 }, 1);
  assert.notEqual(result, from);
  assert.deepEqual(result, { x: 1, z: 0 });
});

// ---------------------------------------------------------------------------
// nextMotionState robustness
// ---------------------------------------------------------------------------

test('nextMotionState returns the current state for unknown events', () => {
  assert.equal(nextMotionState('walking', 'teleport'), 'walking');
  assert.equal(nextMotionState('attacking', 'nope'), 'attacking');
  assert.equal(nextMotionState('dead', 'killed'), 'dead');
});

test('nextMotionState returns a defined state for garbage input', () => {
  for (const [state, event] of [[undefined, 'spawn'], [null, null], ['ghost', 'spawn'], ['walking', undefined], [{}, []]]) {
    const result = nextMotionState(state, event);
    assert.equal(typeof result, 'string', `not a string for ${String(state)}/${String(event)}`);
    assert.notEqual(result, undefined);
  }
  // An unknown state cannot be echoed back meaningfully, so it falls back to the
  // initial state instead of leaking garbage into the vocabulary.
  assert.equal(nextMotionState('ghost', 'spawn'), 'hidden');
  assert.equal(nextMotionState(undefined, 'spawn'), 'hidden');
});

test('nextMotionState never leaves the declared vocabulary', () => {
  const events = ['spawn', 'ready', 'inRange', 'outOfRange', 'damaged', 'recovered', 'killed', 'settled', 'respawn', 'junk'];
  for (const state of MOTION_STATES) {
    for (const event of events) {
      assert.ok(MOTION_STATES.includes(nextMotionState(state, event)), `${state}+${event} escaped the vocabulary`);
    }
  }
});

// ---------------------------------------------------------------------------
// SandUnit integration: external movement must not be undone
// ---------------------------------------------------------------------------

const context = () => {
  const root = new T.Group();
  const system = new SandStructureSystem(root, { grainCapacity: 4000, particleCapacity: 10 });
  return { system, material: system.material, dark: system.dark, primary: system.material, root };
};

const FORMATION = new T.Vector3(4, 0, -1);
const STEP = 1 / 60;

// Advance one frame the way the app does: tick the grain simulation (which owns
// the build/collapse animation) and then the unit state machine.
function frame(unit, dt = STEP) {
  unit.system.grains.update(dt);
  unit.update(dt, { formationRadius: 1 });
}

function drain(unit, frames, predicate = () => false) {
  for (let i = 0; i < frames; i++) { frame(unit); if (predicate()) return true; }
  return predicate();
}

function settledUnit(type = 'kesatria', options = {}) {
  const ctx = context();
  const unit = createUnit(type, ctx, { position: FORMATION.clone(), faction: 'blue', index: 0, ...options });
  unit.build();
  drain(unit, 60 * 30, () => unit.state === 'guarding' || unit.state === 'damaged');
  return { ctx, unit };
}
test('moveTo survives the build state machine and is not pulled back to the slot', () => {
  const { ctx, unit } = settledUnit();
  try {
    assert.equal(unit.state, 'guarding', 'unit should have settled before the test');
    const before = { x: unit.group.position.x, z: unit.group.position.z };
    assert.ok(Math.abs(before.x - FORMATION.x) < 0.05, `settled x was ${before.x}`);
    assert.ok(Math.abs(before.z - FORMATION.z) < 0.05, `settled z was ${before.z}`);

    assert.equal(unit.moveTo(8, 3), true);
    const moved = { x: unit.group.position.x, z: unit.group.position.z };
    assert.deepEqual(moved, { x: 8, z: 3 });

    // Step update for several simulated seconds. Any formation pull-back would
    // move X/Z back toward FORMATION; the motion target must hold the unit still.
    for (let i = 0; i < 60 * 5; i++) frame(unit);

    const after = { x: unit.group.position.x, z: unit.group.position.z };
    assert.ok(Math.abs(after.x - 8) < 1e-6, `x drifted to ${after.x} (formation ${FORMATION.x})`);
    assert.ok(Math.abs(after.z - 3) < 1e-6, `z drifted to ${after.z} (formation ${FORMATION.z})`);
    // Distance from the formation slot must stay large: this is the regression.
    const distToSlot = Math.hypot(after.x - FORMATION.x, after.z - FORMATION.z);
    assert.ok(distToSlot > 3, `unit snapped back toward the slot (distance ${distToSlot})`);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('moveTo works while the unit is still walking out of its spawn', () => {
  const ctx = context();
  try {
    const unit = createUnit('kesatria', ctx, { position: FORMATION.clone(), faction: 'blue', index: 0 });
    unit.build();
    // Advance only a few frames so the unit is mid-exit, not settled.
    for (let i = 0; i < 20; i++) frame(unit);
    assert.equal(unit.moveTo(0, 0), true);
    for (let i = 0; i < 60 * 4; i++) frame(unit);
    assert.ok(Math.abs(unit.group.position.x) < 1e-6, `x was ${unit.group.position.x}`);
    assert.ok(Math.abs(unit.group.position.z) < 1e-6, `z was ${unit.group.position.z}`);
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('moveTo ignores non-finite coordinates instead of producing NaN', () => {
  const { ctx, unit } = settledUnit();
  try {
    unit.moveTo(5, 5);
    assert.equal(unit.moveTo(NaN, 1), false);
    assert.equal(unit.moveTo(1, Infinity), false);
    assert.equal(unit.moveTo('a', 'b'), false);
    for (let i = 0; i < 120; i++) frame(unit);
    assert.ok(Number.isFinite(unit.group.position.x));
    assert.ok(Number.isFinite(unit.group.position.z));
    assert.deepEqual({ x: unit.group.position.x, z: unit.group.position.z }, { x: 5, z: 5 });
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('the gargoyle keeps its hover Y while walking on an external target', () => {
  const { ctx, unit } = settledUnit('gargoyle');
  try {
    unit.moveTo(-6, 2);
    let sawHover = false;
    for (let i = 0; i < 240; i++) {
      frame(unit);
      if (Math.abs(unit.group.position.y) > 1e-6) sawHover = true;
    }
    assert.ok(sawHover, 'gargoyle Y hover should still run');
    assert.ok(Math.abs(unit.group.position.x + 6) < 1e-6, `x was ${unit.group.position.x}`);
    assert.ok(Math.abs(unit.group.position.z - 2) < 1e-6, `z was ${unit.group.position.z}`);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('faceTowards reproduces the scene convention for blue and red straight ahead', () => {
  const BLUE_AHEAD = { x: 1, z: 0 };  // scene: blue rotation.y = +PI/2
  const RED_AHEAD = { x: -1, z: 0 };  // scene: red rotation.y = -PI/2

  const blue = settledUnit();
  try {
    const unit = blue.unit;
    unit.group.position.set(0, 0, 0);
    unit.faceTowards(BLUE_AHEAD.x, BLUE_AHEAD.z);
    assert.ok(Math.abs(unit.group.rotation.y - Math.PI / 2) < 1e-12, `blue yaw was ${unit.group.rotation.y}`);
    // Straight ahead must equal the constant game-controller writes for blue.
    assert.equal(unit.group.rotation.y, Math.PI / 2);
  } finally { blue.unit.dispose(); blue.ctx.system.dispose(); }

  const ctx = context();
  try {
    const unit = createUnit('kesatria', ctx, { position: FORMATION.clone(), faction: 'red', index: 0 });
    unit.group.position.set(0, 0, 0);
    unit.faceTowards(RED_AHEAD.x, RED_AHEAD.z);
    assert.ok(Math.abs(unit.group.rotation.y + Math.PI / 2) < 1e-12, `red yaw was ${unit.group.rotation.y}`);
    assert.equal(unit.group.rotation.y, -Math.PI / 2);
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('faceTowards turns correctly off-axis and is safe for garbage input', () => {
  const { ctx, unit } = settledUnit();
  try {
    unit.group.position.set(0, 0, 0);
    // Face a target where dx === dz: yaw = atan2(1, 1) = PI/4.
    unit.faceTowards(1, 1);
    assert.ok(Math.abs(unit.group.rotation.y - Math.PI / 4) < 1e-12);
    unit.faceTowards(1, -1);
    assert.ok(Math.abs(unit.group.rotation.y - (3 * Math.PI / 4)) < 1e-12);
    // A target on top of the unit keeps the previous yaw rather than NaN.
    const kept = unit.group.rotation.y;
    unit.faceTowards(0, 0);
    assert.equal(unit.group.rotation.y, kept);
    assert.equal(unit.faceTowards(NaN, 0), false);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

// ---------------------------------------------------------------------------
// Existing build / collapse behaviour is preserved
// ---------------------------------------------------------------------------

test('the grain build still settles and damage/collapse/dispose remain clean', () => {
  const { ctx, unit } = settledUnit();
  try {
    assert.equal(unit.state, 'guarding');
    assert.equal(unit.health, unit.maxHealth);
    assert.ok(unit.parts.every(p => p.mesh.visible));
    assert.equal(unit.damage(10), true);
    assert.equal(unit.health, unit.maxHealth - 10);
    assert.equal(unit.collapse(), true);
    drain(unit, 60 * 10, () => unit.state === 'fallen');
    assert.equal(unit.state, 'fallen');
    assert.equal(unit.dead, true);
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('a unit with no external movement still walks to its formation slot', () => {
  const { ctx, unit } = settledUnit();
  try {
    assert.ok(Math.abs(unit.group.position.x - FORMATION.x) < 0.05);
    assert.ok(Math.abs(unit.group.position.z - FORMATION.z) < 0.05);
    assert.equal(unit.externalPosition, false);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('the dead slot field is gone and nothing depends on it', () => {
  const { ctx, unit } = settledUnit();
  try {
    assert.equal(Object.prototype.hasOwnProperty.call(unit, 'slot'), false);
  } finally { unit.dispose(); ctx.system.dispose(); }
});
