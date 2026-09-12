// Task 6b: PROGRESSIVE WALKING.
//
// Task 6 made a unit hold an externally supplied X/Z, but `moveTo` snapped it
// there instantly. These tests prove the new `walkTo` API actually travels:
// it must be strictly between start and goal after one frame, approach
// monotonically, land exactly on the goal within distance/speed seconds, never
// overshoot, and then stay put forever (no oscillation, no per-frame nudge).
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { UNIT_DEFINITIONS } from '../../src/core/unit-definitions.js';
import { SandStructureSystem } from '../../src/scene/sand-structures.js';
import { createUnit } from '../../src/scene/units/unit-factory.js';
import { BATTLE_VISUAL_SCALE, applyBattleVisualScale, battleHudHeight } from '../../src/app/game-controller.js';
import { defaultBarHeight } from '../../src/scene/unit-hud.js';

const context = () => {
  const root = new T.Group();
  const system = new SandStructureSystem(root, { grainCapacity: 4000, particleCapacity: 10 });
  return { system, material: system.material, dark: system.dark, primary: system.material, root };
};

const FORMATION = new T.Vector3(4, 0, -1);
const STEP = 1 / 60;

// One frame the way the app drives it: grain simulation (build/collapse), then
// the unit state machine.
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

const xz = unit => ({ x: unit.group.position.x, z: unit.group.position.z });
const dist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ---------------------------------------------------------------------------
// Core walking proof
// ---------------------------------------------------------------------------

test('walkTo is NOT instant: one frame leaves the unit strictly between start and goal', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    const start = xz(unit);
    const goal = { x: 8, z: 3 };
    assert.equal(unit.walkTo(goal.x, goal.z), true);
    assert.equal(unit.isWalking, true, 'should be walking immediately after walkTo');
    // walkTo must not move the unit itself - only update() advances it.
    assert.deepEqual(xz(unit), start, 'walkTo must not teleport on the call');

    frame(unit);
    const after1 = xz(unit);
    const dGoal = dist(after1, goal);
    assert.ok(dGoal > 0, `arrived in one frame (pos ${JSON.stringify(after1)})`);
    assert.ok(dist(after1, start) > 0, 'did not move at all in one frame');
    // Strictly between: closer to the goal than the start was, nowhere near it.
    assert.ok(dGoal < dist(start, goal), 'did not get closer after one frame');

    const speed = UNIT_DEFINITIONS.kesatria.speed;
    const step1 = dist(after1, start);
    assert.ok(Math.abs(step1 - speed * STEP) < 1e-9, `one-frame step was ${step1}, expected ${speed * STEP}`);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('walkTo approaches the goal monotonically and lands exactly on it within distance/speed seconds', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    const speed = UNIT_DEFINITIONS.kesatria.speed; // 2.2 world units / second
    const start = xz(unit);
    const goal = { x: 8, z: 3 };
    const total = dist(start, goal);
    unit.walkTo(goal.x, goal.z, { speed });

    let previous = total;
    let arrived = null;
    for (let i = 1; i <= 60 * 10; i++) {
      frame(unit);
      const d = dist(xz(unit), goal);
      assert.ok(d <= previous + 1e-9, `distance grew on frame ${i}: ${previous} -> ${d}`);
      previous = d;
      if (!unit.isWalking) { arrived = i; break; }
    }
    assert.ok(arrived !== null, 'unit never arrived within 10 simulated seconds');
    const seconds = arrived * STEP;
    // assert the maths: distance/speed seconds, within one frame of tolerance
    assert.ok(Math.abs(seconds - total / speed) <= STEP + 1e-9,
      `took ${seconds}s, expected ~${total / speed}s (total ${total}, speed ${speed})`);
    // and it is genuinely a walk, not a snap
    assert.ok(seconds > 5 * STEP, `walk finished suspiciously fast (${seconds}s)`);
    const final = xz(unit);
    assert.ok(dist(final, goal) < 1e-9, `final ${JSON.stringify(final)} != goal`);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('walkTo never overshoots and never jitters after arrival', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    const goal = { x: 8, z: 3 };
    unit.walkTo(goal.x, goal.z);
    let previous = dist(xz(unit), goal);
    let arrivalFrame = null;
    let arrivedPos = null;
    for (let i = 1; i <= 60 * 10; i++) {
      frame(unit);
      const d = dist(xz(unit), goal);
      assert.ok(d <= previous + 1e-9, `distance grew on frame ${i}: ${previous} -> ${d} (overshoot)`);
      previous = d;
      if (!unit.isWalking && arrivalFrame === null) { arrivalFrame = i; arrivedPos = xz(unit); }
    }
    assert.ok(arrivalFrame !== null, 'unit never arrived');
    // Final position equals the goal within a small epsilon.
    assert.ok(Math.abs(arrivedPos.x - goal.x) < 1e-9, `x ${arrivedPos.x}`);
    assert.ok(Math.abs(arrivedPos.z - goal.z) < 1e-9, `z ${arrivedPos.z}`);

    // Many extra frames after arrival: position must be UNCHANGED (no nudge, no
    // oscillation). Compared with deepEqual because there is nothing to compute.
    for (let i = 0; i < 60 * 5; i++) {
      frame(unit);
      assert.deepEqual(xz(unit), arrivedPos, `unit moved after arrival on frame ${i}`);
      assert.equal(unit.isWalking, false);
    }
    assert.equal(unit.group.position.x, goal.x);
    assert.equal(unit.group.position.z, goal.z);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('isWalking is true while walking and false the frame after arrival', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    assert.equal(unit.isWalking, false, 'a fresh settled unit is not walking');
    unit.walkTo(0, 0);
    assert.equal(unit.isWalking, true);
    let sawWalking = false;
    let sawArrived = false;
    for (let i = 0; i < 60 * 10 && !sawArrived; i++) {
      frame(unit);
      if (unit.isWalking) sawWalking = true; else sawArrived = true;
    }
    assert.ok(sawWalking, 'isWalking never reported true mid-walk');
    assert.ok(sawArrived, 'isWalking never flipped to false');
    assert.equal(unit.isWalking, false);
    // Goal still recorded, so X/Z stay pinned there.
    assert.ok(unit.motionTarget, 'motionTarget is retained after arrival');
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('a zero-distance walk completes immediately with no movement or NaN', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    const start = xz(unit);
    unit.walkTo(start.x, start.z);
    frame(unit);
    assert.equal(unit.isWalking, false);
    assert.deepEqual(xz(unit), start);
    assert.ok(Number.isFinite(unit.group.rotation.y));
  } finally { unit.dispose(); ctx.system.dispose(); }
});

// ---------------------------------------------------------------------------
// Facing
// ---------------------------------------------------------------------------

test('a walking unit faces its direction of travel, not the line to the goal', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    // Put the unit at the origin so the travel direction is easy to reason about.
    unit.moveTo(0, 0);
    unit.group.rotation.y = 0;
    // Goal straight along +X from the origin: travel direction is +X, and the
    // scene convention says facing +X is rotation.y = +PI/2.
    unit.walkTo(6, 0);
    let seen = false;
    for (let i = 0; i < 600 && unit.isWalking; i++) {
      frame(unit);
      if (unit.group.position.x > 0.5 && unit.group.position.x < 5.5) {
        assert.ok(Math.abs(unit.group.rotation.y - Math.PI / 2) < 1e-9,
          `yaw should face travel (+PI/2), was ${unit.group.rotation.y}`);
        seen = true;
      }
    }
    assert.ok(seen, 'never sampled the unit mid-walk');
    assert.equal(unit.group.rotation.y, Math.PI / 2);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('walking straight along Z (dx = 0) yields no NaN and no 180 degree flip mid-path', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    unit.moveTo(2, -4);
    const goal = { x: 2, z: 6 }; // exactly dz-only
    unit.walkTo(goal.x, goal.z);
    let previousYaw = unit.group.rotation.y;
    let minY = Infinity;
    let maxY = -Infinity;
    for (let i = 0; i < 60 * 12; i++) {
      frame(unit);
      const yaw = unit.group.rotation.y;
      assert.ok(Number.isFinite(yaw), `yaw became ${yaw} on frame ${i}`);
      assert.ok(Math.abs(yaw - previousYaw) <= Math.PI + 1e-9, `yaw jumped by >180deg on frame ${i}`);
      previousYaw = yaw;
      minY = Math.min(minY, yaw);
      maxY = Math.max(maxY, yaw);
    }
    // Travel is along Z, so every frame faces the SAME way: no flip at all.
    assert.ok(maxY - minY < 1e-12, `yaw varied over the straight walk (${minY}..${maxY})`);
    assert.ok(!Number.isNaN(unit.group.rotation.y));
  } finally { unit.dispose(); ctx.system.dispose(); }
});

// REPLACED (the previous body of this test was genuinely wrong).
//
// The old version started the unit at (0, 5) and walked it to (6, 0), then
// asserted that consecutive-frame yaw changes stayed below 0.5 rad. That
// assertion is false for the CORRECT behaviour: the unit turns from the
// +0.7854 rad bearing it inherits from moveTo(0, 5)/walkTo(6, 0)'s initial
// direction... no - concretely, the unit's yaw before the walk is 0, the travel
// bearing is atan2(6, -5) = 2.2655, so the FIRST frame legitimately snaps the
// yaw from 0 to 2.2655, a 2.27 rad change that has nothing to do with a
// mid-path flip. The old guard only passed by accident: the blind facing bug
// pinned the yaw at +PI/2 for the whole walk, so "yaw never changes" was
// trivially true. Its INTENT - "a diagonal walk does not flip ~180 degrees
// mid-path" - is kept below, now measured after the initial turn.
test('a diagonal walk does not flip 180 degrees mid-path (after the initial turn)', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    unit.moveTo(0, 5);
    unit.walkTo(6, 0);
    const expected = Math.atan2(6 - 0, 0 - 5); // the real bearing, 2.2655 rad
    const yaws = [];
    for (let i = 0; i < 60 * 8 && unit.isWalking; i++) { frame(unit); yaws.push(unit.group.rotation.y); }

    // Once the unit has turned (frame 2 onward, i.e. index >= 1) the bearing is
    // constant: a straight-line walk never re-aims, so no mid-path flip of any
    // size, let alone 180 degrees.
    //
    // The trailing samples are trimmed because the walk ends (6, 0) - EXACTLY on
    // the goal's z-lane - and the destination becomes the source once x is within
    // an ulp of 6, so the final couple of frames can only move in z, by less than
    // 1e-12 rad of bearing change. Trimming those frames (the walk is over in
    // any practical sense; position has arrived to 1e-9) keeps the guard aimed at
    // the reported defect, which is a 180-degree MID-PATH flip: a unit that walks
    // a diagonal while facing straight +X, which is what the old bug did for the
    // ENTIRE walk.
    const core = yaws.slice(1, -3);
    assert.ok(core.length > 100, `walk too short to be meaningful (${core.length})`);
    for (let i = 1; i < core.length; i++) {
      assert.ok(Math.abs(core[i] - core[i - 1]) < 1e-9,
        `yaw flipped mid-path near frame ${i}: ${core[i - 1]} -> ${core[i]}`);
      assert.ok(Math.abs(core[i] - expected) < 1e-12,
        `yaw ${core[i]} is not the travel bearing ${expected} on frame ${i}`);
    }
    assert.ok(dist(xz(unit), { x: 6, z: 0 }) < 1e-9, 'the walk did not arrive');
    assert.ok(yaws.length > 100, 'walk finished too fast to be meaningful');
    assert.equal(unit.group.position.z, 0);
    assert.equal(unit.group.position.x, 6);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('I-1: a walk whose x-lane matches a diagonal goal faces its real bearing (not +PI/2)', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    // The review's exact case: (5, 3) -> (15, 9). The genuine travel bearing is
    // atan2(10, 6) = 1.0303768265243125; the old code delegated the zero case to
    // the constant faction hint and held +PI/2 (1.5707963267948966) for the whole
    // trip, so the unit walked a diagonal while facing straight +X.
    const start = { x: 5, z: 3 };
    const goal = { x: 15, z: 9 };
    const expected = Math.atan2(goal.x - start.x, goal.z - start.z);
    assert.ok(Math.abs(expected - 1.0303768265243125) < 1e-12, `atan2 sanity: ${expected}`);

    unit.moveTo(start.x, start.z);
    // A deliberately wrong starting yaw, so "unchanged" cannot pass by accident.
    unit.group.rotation.y = 0;
    unit.walkTo(goal.x, goal.z);
    assert.equal(unit.isWalking, true);

    const yaws = [];
    for (let i = 0; i < 60 * 10 && unit.isWalking; i++) { frame(unit); yaws.push(unit.group.rotation.y); }
    assert.ok(yaws.length > 100, `walk ended after ${yaws.length} frames`);

    // THE REGRESSION ASSERTION: the NUMERIC yaw, every frame. Frame 0 turns onto
    // the bearing; every frame after that holds it bit-for-bit.
    for (let i = 0; i < yaws.length; i++) {
      assert.ok(Math.abs(yaws[i] - expected) < 1e-12,
        `frame ${i}: yaw ${yaws[i]} != atan2(10, 6) ${expected}`);
    }
    assert.ok(Math.abs(yaws[0] - Math.PI / 2) > 0.5, 'yaw is still the constant faction hint');
    // It really did travel the diagonal, not along +X.
    assert.equal(unit.group.position.x, goal.x);
    assert.equal(unit.group.position.z, goal.z);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('a walk with an exact Z-lane (dx === 0) faces the Z travel bearing, per faction', () => {
  for (const faction of ['blue', 'red']) {
    const { ctx, unit } = settledUnit('kesatria', { faction });
    try {
      // dx === 0 for the WHOLE walk: the unit's own x-lane IS the goal's.
      unit.moveTo(2, -4);
      unit.group.rotation.y = 0;
      unit.walkTo(2, 6);
      const expected = Math.atan2(0, 10); // 0 rad, as advanceToward normalises (0, +1)
      const yaws = [];
      for (let i = 0; i < 60 * 8 && unit.isWalking; i++) { frame(unit); yaws.push(unit.group.rotation.y); }
      assert.ok(yaws.length > 100);
      for (const yaw of yaws) {
        assert.ok(Number.isFinite(yaw));
        assert.ok(Math.abs(yaw - expected) < 1e-12,
          `${faction}: Z-lane walk yaw ${yaw} != travel bearing ${expected}`);
      }
      assert.equal(unit.group.position.x, 2);
      assert.equal(unit.group.position.z, 6);
    } finally { unit.dispose(); ctx.system.dispose(); }
  }
});

test('a walk issued after the unit has been moved in Z does not teleport on the next frame', () => {
  // The exiting-branch regression guard: `placeXZ` lerps from the motion origin,
  // and if that origin were aliased to the group's own position it would silently
  // become "where the unit already is", dragging the unit onto `motionTarget` in
  // one frame. Reproduced by walking (guarding), then re-issuing a walk whose
  // step underflows: the unit must stay put, never jump to the goal.
  const { ctx, unit } = settledUnit('kesatria');
  try {
    unit.moveTo(4, -6);
    for (let i = 0; i < 5; i++) frame(unit);
    assert.deepEqual(xz(unit), { x: 4, z: -6 });

    const goal = { x: 12, z: -2 };
    assert.equal(unit.walkTo(goal.x, goal.z, { speed: Number.MIN_VALUE }), true);
    for (let i = 0; i < 30; i++) {
      frame(unit);
      assert.deepEqual(xz(unit), { x: 4, z: -6 }, `frame ${i} teleported toward the goal`);
    }
    assert.equal(unit.isWalking, false);
  } finally { unit.dispose(); ctx.system.dispose(); }
});
// ---------------------------------------------------------------------------
// Speed semantics (I-2 / M-1)
// ---------------------------------------------------------------------------

// Documented rule (see src/scene/units/base-unit.js walkTo): a speed of 0, a
// negative speed, and any non-numeric / NaN / Infinity override are all "no walk
// was requested" - walkTo returns false, no walk is engaged, isWalking is false,
// and the unit does not move. A positive finite speed walks.
test('I-2: speed <= 0 is a refused walk - no movement, isWalking false, forever', () => {
  for (const bad of [0, -3]) {
    const { ctx, unit } = settledUnit('kesatria');
    try {
      const start = xz(unit);
      const returned = unit.walkTo(start.x + 6, start.z + 2, { speed: bad });
      assert.equal(returned, false, `speed ${bad} should refuse the walk`);
      assert.equal(unit.isWalking, false, `speed ${bad} left isWalking true`);
      assert.equal(unit.walkState, null);
      // "Still true 60 s later" was the reported symptom; prove it is gone.
      for (let i = 0; i < 60 * 60; i++) {
        frame(unit);
        assert.equal(unit.isWalking, false, `speed ${bad}: isWalking became true on frame ${i}`);
      }
      assert.deepEqual(xz(unit), start, `speed ${bad} moved the unit`);
    } finally { unit.dispose(); ctx.system.dispose(); }
  }
});

test('I-2: a non-numeric / NaN / Infinity speed is refused, not silently the type default', () => {
  for (const bad of [NaN, Infinity, -Infinity, 'fast', null, {}, []]) {
    const { ctx, unit } = settledUnit('kesatria');
    try {
      const start = xz(unit);
      const returned = unit.walkTo(start.x + 6, start.z, { speed: bad });
      assert.equal(returned, false, `speed ${String(bad)} should refuse the walk`);
      assert.equal(unit.isWalking, false, `speed ${String(bad)} left isWalking true`);
      assert.equal(unit.walkState, null);
      // If it had silently used the default 2.2 the unit would be at the goal
      // within ~3 s; after 60 s it must be byte-identical to where it started.
      for (let i = 0; i < 60 * 30; i++) frame(unit);
      assert.deepEqual(xz(unit), start, `speed ${String(bad)} moved the unit (default leaked)`);
    } finally { unit.dispose(); ctx.system.dispose(); }
  }
});

test('I-2: an absent speed still uses UNIT_DEFINITIONS (the default is not refused)', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    const start = xz(unit);
    assert.equal(unit.walkTo(start.x + 5, start.z), true, 'the default call must walk');
    assert.equal(unit.isWalking, true);
    assert.equal(unit.walkState.speed, UNIT_DEFINITIONS.kesatria.speed);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('I-2: a refused walk supersedes an in-flight walk instead of leaving it lying', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    const start = xz(unit);
    assert.equal(unit.walkTo(start.x + 20, start.z), true);
    for (let i = 0; i < 10; i++) frame(unit);
    assert.equal(unit.isWalking, true);
    const mid = xz(unit);

    const refusedGoal = { x: start.x + 30, z: start.z };
    assert.equal(unit.walkTo(refusedGoal.x, refusedGoal.z, { speed: 0 }), false);
    assert.equal(unit.isWalking, false, 'isWalking survived a refused walk');
    assert.equal(unit.walkState, null);
    // A refused walk must not adopt the refused goal: the motion layer keeps the
    // ORIGINAL goal (x + 20) and the unit is not pulled toward x + 30.
    assert.deepEqual(unit.motionTarget, { x: start.x + 20, z: start.z }, 'the refused goal was adopted');
    for (let i = 0; i < 60 * 5; i++) frame(unit);
    assert.ok(dist(xz(unit), refusedGoal) > dist({ x: start.x + 20, z: start.z }, refusedGoal) - 1e-9,
      'the unit drifted toward the refused goal');
    // A refused walk does not resume the superseded walk either: motionTarget is
    // the *superseded* goal, so the unit just settles onto it, exactly as a plain
    // snap would. It must at least stay put once it gets there.
    drain(unit, 60 * 3, () => dist(xz(unit), { x: start.x + 20, z: start.z }) < 1e-9);
    assert.equal(unit.isWalking, false, 'a refused walk left the unit walking');
  } finally { unit.dispose(); ctx.system.dispose(); }
});

// REPLACED, and why (M-1 re-review).
//
// The previous version of this test only covered `Number.MIN_VALUE`, where
// `speed * dt` underflows to EXACTLY 0. That is the one case the old guard
// already terminated, so the test passed against the unfixed code and the real
// stall - a positive step that is too small to change the coordinate - was never
// covered. This is the measured pre-fix matrix (goal = start + 4 world units,
// 2,000,000-frame cap) that the replacement below now asserts on:
//
//   speed     pre-fix                                  post-fix (this test)
//   1e-8      NEVER  isWalking true,  moved 3.3e-4      frame 1, false, unmoved
//   1e-14     NEVER  isWalking true,  moved nothing     frame 1, false, unmoved
//   1e-18     NEVER  isWalking true,  moved nothing     frame 1, false, unmoved
//   1e-100    NEVER  isWalking true,  moved nothing     frame 1, false, unmoved
//   1e-320    NEVER  isWalking true,  moved nothing     frame 1, false, unmoved
//   MIN_VALUE frame 1 false (already fixed), unmoved     frame 1, false, unmoved
//   1e-6      eventually arrives - a REAL walk            still a real walk
//
// `1e-13` (the speed the earlier I-2 trace called out) does write a ULP of
// progress per frame and would in principle arrive in ~3e13 frames; under the
// relative bound it is now correctly classified as a stall instead. That is the
// intended reading of "no meaningful progress": 1e-13 units/s is 1.5e-13 of a
// unit per frame, i.e. ~4e10 years to cross 4 units at 60 fps.
test('M-1: a sub-resolution speed terminates the walk unmoved, it does not drift forever', () => {
  // Every one of these steps is POSITIVE but below the coordinate's ULP, so no
  // frame can ever make progress. The pre-fix guard could not see this (it only
  // fired when speed*dt underflowed to exactly 0), so the walk stayed live
  // forever. Each must terminate promptly, report isWalking === false, end
  // EXACTLY where it started, and NOT be teleported to the goal.
  for (const tiny of [1e-8, 1e-14, 1e-18, 1e-100, 1e-320, Number.MIN_VALUE]) {
    const { ctx, unit } = settledUnit('kesatria');
    try {
      const start = xz(unit);
      const goal = { x: start.x + 4, z: start.z };
      assert.equal(unit.walkTo(goal.x, goal.z, { speed: tiny }), true, `speed ${tiny} did not engage`);
      assert.equal(unit.isWalking, true, `speed ${tiny} did not engage a walk`);

      // BOUNDED termination: a few frames, nowhere near the ~1e9 budget the old
      // (and still too loose) absolute guard would have needed - and in fact the
      // stall is detected on the first frame.
      let termFrame = null;
      for (let i = 1; i <= 600; i++) { frame(unit); if (!unit.isWalking) { termFrame = i; break; } }
      assert.ok(termFrame !== null, `speed ${tiny} never terminated the walk (isWalking still true)`);
      assert.ok(termFrame <= 5, `speed ${tiny} took ${termFrame} frames to detect a hard stall`);
      assert.equal(unit.isWalking, false, `speed ${tiny} left isWalking true`);
      assert.equal(unit.walkState.speed, 0, `speed ${tiny} did not retire the walk`);

      // NOT TELEPORTED: the unit ends exactly where it started, and the goal it
      // never reached is NOT its location...
      const here = xz(unit);
      assert.deepEqual(here, start, `speed ${tiny} moved the unit: ${JSON.stringify(here)}`);
      assert.notDeepEqual(here, goal, `speed ${tiny} teleported the unit to the goal`);
      // ...nor its pinned point: `settleXZ` must not drag it there either.
      const target = unit.motionTarget;
      assert.notDeepEqual(target, goal, `speed ${tiny} adopted the unreachable goal as motionTarget`);
      assert.ok(target === null || dist(target, start) < 1e-9,
        `speed ${tiny}: motionTarget ${JSON.stringify(target)} is not where the unit stands`);
      for (let i = 0; i < 10; i++) { unit.settleXZ(STEP, 6); assert.deepEqual(xz(unit), start); }
    } finally { unit.dispose(); ctx.system.dispose(); }
  }
});

test('M-1: a genuinely slow but meaningful walk (1e-6 units/s) still walks and arrives', () => {
  // The guard must not overshoot and eat a legitimate slow walk. `1e-6` units/s is
  // ~2e6x slower than a real kesatria (2.2), but it is a REAL walk: every frame
  // writes 1.667e-8 of a unit, which is far above the coordinate ULP at x = 4
  // (8.9e-16), so the coordinate moves and the walk progresses.
  //
  // The walk is over a SHORT leg (D = 5.2e-4) so it finishes in a bounded number
  // of frames while still exercising the guard: `D / (speed * dt)` = 31.2 frames
  // exactly, because each 1.667e-8 step is representable and no step is lost.
  // This is the case the coarse relative bound genuinely got wrong - it is the one
  // that forced the guard to be redesigned around the ULP and the implied frame
  // count rather than a ratio of the remaining gap.
  const { ctx, unit } = settledUnit('kesatria');
  try {
    const speed = 1e-6;
    const goal = { x: unit.group.position.x + 5.2e-4, z: unit.group.position.z };
    const start = xz(unit);
    assert.equal(unit.walkTo(goal.x, goal.z, { speed }), true);
    assert.equal(unit.isWalking, true);

    // Frame 1: the step IS representable at x = 4, so the unit genuinely moves.
    frame(unit);
    assert.equal(unit.isWalking, true, 'the slow walk was killed on its first frame');
    assert.equal(unit.group.position.x, start.x + speed * STEP,
      'the slow walk made no representable progress');
    assert.ok(dist(xz(unit), goal) < dist(start, goal), 'the slow walk did not approach its goal');

    // It keeps walking (not falsely terminated) and arrives exactly on the goal.
    const expectedFrames = Math.ceil(5.2e-4 / (speed * STEP));
    assert.equal(expectedFrames, 31200, 'arithmetic changed, re-derive the expectation');
    let arrived = null;
    for (let i = 2; i <= expectedFrames + 60; i++) { frame(unit); if (!unit.isWalking) { arrived = i; break; } }
    assert.ok(arrived !== null, 'the legitimate slow walk never arrived - the guard ate it');
    assert.deepEqual(xz(unit), goal, `slow walk ended at ${JSON.stringify(xz(unit))}, not its goal`);
    assert.equal(unit.group.position.x, goal.x);
    assert.equal(unit.group.position.z, goal.z);
    // Its frame count is close to the predicted one (within a frame or two of
    // float accumulation), so this is the walk, not an early give-up.
    assert.ok(Math.abs(arrived - expectedFrames) <= 2,
      `arrived on frame ${arrived}, expected ~${expectedFrames}`);
  } finally { unit.dispose(); ctx.system.dispose(); }
});// ---------------------------------------------------------------------------
// advanceWalk contract (I-3) and dispose (M-2)
// ---------------------------------------------------------------------------

test('I-3: advanceWalk returns true iff it actually moved', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    // No walk at all: the reported defect was this returning true.
    assert.equal(unit.walkState, null);
    assert.equal(unit.advanceWalk(STEP), false, 'advanceWalk with no walk must return false');

    // A live walk that moves: true.
    unit.walkTo(unit.group.position.x + 5, unit.group.position.z);
    assert.equal(unit.advanceWalk(STEP), true);

    // A live walk that cannot be advanced by its dt: false, and still live. An
    // unusable dt is a statement about ONE frame (a paused or malformed clock),
    // not about the walk, so unlike a sub-ULP step it must not end the walk.
    unit.walkTo(unit.group.position.x + 5, unit.group.position.z);
    assert.equal(unit.advanceWalk(0), false);
    assert.equal(unit.advanceWalk(-1), false);
    assert.equal(unit.advanceWalk(NaN), false);
    assert.equal(unit.isWalking, true, 'a bad dt must not kill the walk');

    // `Number.MIN_VALUE` as a dt does NOT underflow `2.2 * dt` (that is about
    // 3e-324, still positive), so `advanceWalk` takes its normal path and the step
    // is simply swallowed by the coordinate ULP. IT MUST NOT MOVE THE UNIT, and
    // because a step that small can never advance a walk, the walk ENDS here (the
    // M-1 stall guard) rather than being left live. That is a change from the
    // earlier behaviour of this test, which asserted the walk stayed live: a
    // sub-ULP step is unrecoverable by any later frame, so "stay live" was exactly
    // the lie M-1 is about. (The SEPARATE underflow-to-zero case, `speed * 4e-324`
    // evaluating to exactly 0, is also covered by the M-1 test.)
    //
    // The walk is re-armed first because these three bad-dt frames did not consume
    // any of it: dt of 0, -1 and NaN are statements about one frame.
    unit.walkTo(unit.group.position.x + 5, unit.group.position.z);
    const beforeUnderflow = { ...xz(unit) };
    assert.equal(unit.advanceWalk(Number.MIN_VALUE), false);
    assert.equal(unit.isWalking, false, 'a sub-ULP frame left the walk pretending to be live');
    assert.deepEqual(xz(unit), beforeUnderflow, 'an unadvanceable frame moved the unit');

    // A zero-length walk: no movement, so false.
    unit.walkTo(unit.group.position.x, unit.group.position.z);
    assert.equal(unit.advanceWalk(STEP), false);
    assert.equal(unit.isWalking, false);

    // Already arrived: false.
    assert.equal(unit.advanceWalk(STEP), false);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('M-2: dispose() while walking stops isWalking reporting true', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    unit.walkTo(unit.group.position.x + 9, unit.group.position.z);
    for (let i = 0; i < 10; i++) frame(unit);
    assert.equal(unit.isWalking, true, 'setup: the unit should be mid-walk');
    unit.dispose();
    assert.equal(unit.isWalking, false, 'a disposed unit still reported isWalking');
    assert.equal(unit.walkState, null);
    assert.equal(unit.motionTarget, null);
  } finally { ctx.system.dispose(); }
});
// ---------------------------------------------------------------------------
// Gargoyle
// ---------------------------------------------------------------------------

test('a gargoyle walks to its goal while its Y still hovers', () => {
  const { ctx, unit } = settledUnit('gargoyle');
  try {
    const speed = UNIT_DEFINITIONS.gargoyle.speed;
    const goal = { x: -6, z: 2 };
    unit.walkTo(goal.x, goal.z);
    const start = xz(unit);
    assert.ok(dist(start, goal) > 3);

    frame(unit);
    const after1 = xz(unit);
    assert.ok(dist(after1, start) > 0 && dist(after1, goal) < dist(start, goal),
      'gargoyle walk should be progressive too');

    const ySamples = [];
    let arrivalFrame = null;
    for (let i = 0; i < 60 * 12; i++) {
      frame(unit);
      if (i > 1) ySamples.push(unit.group.position.y);
      if (!unit.isWalking && arrivalFrame === null) arrivalFrame = i;
    }
    assert.ok(arrivalFrame !== null, 'gargoyle never arrived');
    assert.equal(unit.group.position.x, goal.x);
    assert.equal(unit.group.position.z, goal.z);
    const yMin = Math.min(...ySamples), yMax = Math.max(...ySamples);
    assert.ok(yMax - yMin > 0.05, `gargoyle Y did not hover while walking (range ${yMax - yMin})`);
    // Hover is an animation on top of formation Y, so it stays bounded.
    assert.ok(Math.abs(yMin) <= 0.13 && Math.abs(yMax) <= 0.13, `Y left its hover band: ${yMin}..${yMax}`);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('a walking gargoyle holds X/Z exactly after arrival while Y keeps animating', () => {
  const { ctx, unit } = settledUnit('gargoyle');
  try {
    const goal = { x: -6, z: 2 };
    unit.walkTo(goal.x, goal.z);
    drain(unit, 60 * 12, () => !unit.isWalking);
    assert.equal(unit.isWalking, false);
    const settledY = [];
    for (let i = 0; i < 180; i++) { frame(unit); settledY.push(unit.group.position.y); }
    assert.equal(unit.group.position.x, goal.x);
    assert.equal(unit.group.position.z, goal.z);
    assert.ok(Math.max(...settledY) - Math.min(...settledY) > 0.05, 'Y hover stopped after arrival');
  } finally { unit.dispose(); ctx.system.dispose(); }
});

// ---------------------------------------------------------------------------
// Interaction with the rest of the unit lifecycle
// ---------------------------------------------------------------------------

test('damage and collapse after a walk leave the unit where it walked', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    const goal = { x: 8, z: 3 };
    unit.walkTo(goal.x, goal.z);
    drain(unit, 60 * 12, () => !unit.isWalking);
    assert.equal(unit.isWalking, false);
    assert.equal(unit.group.position.x, goal.x);
    assert.equal(unit.group.position.z, goal.z);

    assert.equal(unit.damage(10), true);
    for (let i = 0; i < 60 * 2; i++) frame(unit);
    assert.equal(unit.group.position.x, goal.x, 'damaged unit drifted off its walk goal');
    assert.equal(unit.group.position.z, goal.z);

    assert.equal(unit.collapse(), true);
    drain(unit, 60 * 10, () => unit.state === 'fallen');
    assert.equal(unit.state, 'fallen');
    assert.equal(unit.dead, true);
    assert.equal(unit.group.position.x, goal.x);
    assert.equal(unit.group.position.z, goal.z);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('walkTo ignores non-finite input instead of producing NaN', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    unit.walkTo(5, 5);
    drain(unit, 60 * 12, () => !unit.isWalking);
    assert.equal(unit.walkTo(NaN, 1), false);
    assert.equal(unit.walkTo(1, Infinity), false);
    assert.equal(unit.walkTo('a', 'b'), false);
    for (let i = 0; i < 120; i++) frame(unit);
    assert.ok(Number.isFinite(unit.group.position.x));
    assert.ok(Number.isFinite(unit.group.position.z));
    assert.equal(unit.group.position.x, 5);
    assert.equal(unit.group.position.z, 5);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('a second walkTo retargets the unit and it arrives at the new goal', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    unit.walkTo(9, 0);
    for (let i = 0; i < 8; i++) frame(unit);
    const between = xz(unit);
    assert.ok(between.x > FORMATION.x && between.x < 9, `expected mid-walk, was ${JSON.stringify(between)}`);

    const next = { x: 0, z: 6 };
    unit.walkTo(next.x, next.z);
    assert.equal(unit.isWalking, true);
    let previous = dist(xz(unit), next);
    let arrival = null;
    for (let i = 1; i <= 60 * 15; i++) {
      frame(unit);
      const d = dist(xz(unit), next);
      // Only assert monotonicity once the unit is actually heading to the new
      // goal (the first frame may still complete the turn).
      if (d > previous + 1e-9 && previous < dist(between, next) - 1e-9) {
        throw new Error(`distance grew on frame ${i}: ${previous} -> ${d}`);
      }
      previous = d;
      if (!unit.isWalking) { arrival = i; break; }
    }
    assert.ok(arrival !== null, 'unit never reached the retargeted goal');
    assert.equal(unit.group.position.x, next.x);
    assert.equal(unit.group.position.z, next.z);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('moveTo still snaps instantly while walkTo travels (semantics kept distinct)', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    unit.moveTo(8, 3);
    assert.deepEqual(xz(unit), { x: 8, z: 3 }, 'moveTo must remain an instant snap');
    assert.equal(unit.isWalking, false, 'a snapped unit is not walking');
    for (let i = 0; i < 60 * 3; i++) frame(unit);
    assert.deepEqual(xz(unit), { x: 8, z: 3 });

    // A walk issued afterwards is progressive again.
    unit.walkTo(0, 3);
    assert.equal(unit.isWalking, true);
    frame(unit);
    assert.ok(unit.group.position.x < 8 && unit.group.position.x > 0, 'walk did not resume progressiveness');
  } finally { unit.dispose(); ctx.system.dispose(); }
});

// REPLACED (the previous test claimed to cover C-1 and did not).
//
// The old version issued walkTo after 20 frames - when the unit is still
// `forming` (a build takes ~1.1 s = ~66 frames), NOT `exiting` - and only
// asserted the final destination. A teleport to the goal satisfies "the final
// destination is the goal", so the test passed against the very bug it was named
// for: `placeXZ` pinned a live walker to its goal on the first exiting frame,
// moving it 55.1 world units in one frame. The new tests below (a) actually
// enter `exiting` before issuing the walk, (b) assert the PER-FRAME step is
// never more than speed * dt, (c) assert the walk takes the time distance/speed
// predicts rather than one frame, and (d) assert it is not dragged back to the
// formation slot. The old test's intent (c) and (d) are preserved.
function exitingUnit(type = 'kesatria') {
  const ctx = context();
  const unit = createUnit(type, ctx, { position: FORMATION.clone(), faction: 'blue', index: 0 });
  unit.build();
  drain(unit, 60 * 30, () => unit.state === 'exiting');
  return { ctx, unit };
}

test('C-1: a walk issued DURING exiting steps by speed*dt and never teleports', () => {
  const { ctx, unit } = exitingUnit();
  try {
    // Genuinely inside the exiting state - this is the state the bug lived in.
    assert.equal(unit.state, 'exiting', 'test setup failed: unit is not exiting');
    const speed = UNIT_DEFINITIONS.kesatria.speed;
    const dt = STEP;
    const maxStep = speed * dt;
    const goal = { x: 40, z: 40 }; // 55.10 world units from the spawn point
    const start = xz(unit);
    const total = dist(start, goal);
    assert.ok(total > 50, `expected a long walk to make any snap obvious, got ${total}`);

    assert.equal(unit.walkTo(goal.x, goal.z), true);
    assert.equal(unit.isWalking, true);

    let previous = start;
    let frames = 0;
    let exitedFrames = 0;
    let worst = 0;
    for (let i = 1; i <= 60 * 120; i++) {
      const wasExiting = unit.state === 'exiting';
      frame(unit);
      if (wasExiting) exitedFrames++;
      const now = xz(unit);
      const step = dist(now, previous);
      worst = Math.max(worst, step);
      // THE REGRESSION ASSERTION: no frame may move more than speed * dt.
      assert.ok(step <= maxStep * (1 + 1e-9),
        `frame ${i} moved ${step} (> speed*dt = ${maxStep}) - teleport`);
      // and every frame that was still exiting advanced the walk...
      if (wasExiting && step === 0) {
        throw new Error(`walk frozen for a frame while exiting (frame ${i})`);
      }
      previous = now;
      frames = i;
      if (!unit.isWalking) break;
    }

    assert.equal(unit.isWalking, false, 'walk issued during exiting never arrived');
    assert.ok(exitedFrames > 1, `walk did not span multiple exiting frames (${exitedFrames})`);
    // (c) It took the time the maths predicts, not one frame.
    const seconds = frames * dt;
    assert.ok(Math.abs(seconds - total / speed) <= dt + 1e-9,
      `took ${seconds}s, expected ~${total / speed}s`);
    assert.ok(frames > 60, `walk finished in ${frames} frames - that is a snap, not a walk`);
    assert.ok(worst <= maxStep * (1 + 1e-9));
    assert.ok(worst > maxStep * 0.99, `walk never reached its full step (worst ${worst})`);

    // (d) Arrived exactly on the goal and stays there - not dragged to the slot.
    assert.equal(unit.group.position.x, goal.x);
    assert.equal(unit.group.position.z, goal.z);
    for (let i = 0; i < 60 * 3; i++) {
      frame(unit);
      assert.equal(unit.group.position.x, goal.x);
      assert.equal(unit.group.position.z, goal.z);
    }
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('a walk issued before the build exits still arrives (not dragged to the slot)', () => {
  const ctx = context();
  try {
    const unit = createUnit('kesatria', ctx, { position: FORMATION.clone(), faction: 'blue', index: 0 });
    unit.build();
    for (let i = 0; i < 20; i++) frame(unit);
    assert.equal(unit.state, 'forming', 'setup: unit should still be forming at frame 20');
    assert.equal(unit.walkTo(0, 0), true);
    const arrived = drain(unit, 60 * 20, () => !unit.isWalking);
    assert.ok(arrived, 'walk issued mid-build never arrived');
    for (let i = 0; i < 60 * 3; i++) frame(unit);
    assert.equal(unit.group.position.x, 0);
    assert.equal(unit.group.position.z, 0);
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('build() clears the walk state so a rebuild resets cleanly', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    unit.walkTo(9, 9);
    for (let i = 0; i < 10; i++) frame(unit);
    assert.equal(unit.isWalking, true);
    assert.equal(unit.externalPosition, true);

    // build() is a no-op while a live unit is out on the field (unchanged
    // semantics), so drop it first; the rebuild must then discard the walk.
    unit.collapse();
    drain(unit, 60 * 12, () => unit.state === 'fallen');
    assert.equal(unit.build(), true);
    assert.equal(unit.isWalking, false, 'isWalking survived build()');
    assert.equal(unit.walkState, null, 'walkState survived build()');
    assert.equal(unit.motionTarget, null, 'motionTarget survived build()');
    assert.equal(unit.externalPosition, false, 'externalPosition survived build()');

    // And the rebuilt unit walks to its formation slot again, untouched by the
    // abandoned walk target.
    drain(unit, 60 * 30, () => unit.state === 'guarding');
    assert.ok(Math.abs(unit.group.position.x - FORMATION.x) < 0.05, `x ${unit.group.position.x}`);
    assert.ok(Math.abs(unit.group.position.z - FORMATION.z) < 0.05, `z ${unit.group.position.z}`);
    assert.equal(unit.externalPosition, false);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

test('the default walk speed comes from UNIT_DEFINITIONS for every mobile type', () => {
  for (const type of ['kesatria', 'gargoyle', 'robot', 'tank']) {
    const ctx = context();
    try {
      const unit = createUnit(type, ctx, { position: FORMATION.clone(), faction: 'blue', index: 0 });
      unit.build();
      drain(unit, 60 * 30, () => unit.state === 'guarding');
      const before = xz(unit);
      unit.walkTo(before.x + 5, before.z);
      frame(unit);
      const step = dist(xz(unit), before);
      const expected = UNIT_DEFINITIONS[type].speed * STEP;
      assert.ok(Math.abs(step - expected) < 1e-9, `${type} stepped ${step}, expected ${expected}`);
      unit.dispose();
    } finally { ctx.system.dispose(); }
  }
});

test('walking a long diagonal is bounded by the goal, not by frame count', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    const speed = UNIT_DEFINITIONS.kesatria.speed;
    // Force a tiny per-frame step so the walk takes many frames; the point is
    // that it still lands exactly on the goal with no drift from accumulation.
    const slow = speed / 20;
    const goal = { x: 20, z: -16 };
    unit.walkTo(goal.x, goal.z, { speed: slow });
    const start = xz(unit);
    // ~21.9 world units at 0.11/s is ~200 simulated seconds, i.e. ~12000
    // 60 fps frames, so the budget has to exceed that.
    const expectedFrames = Math.ceil(dist(start, goal) / (slow * STEP));
    let arrived = null;
    for (let i = 1; i <= expectedFrames + 60; i++) {
      frame(unit);
      if (!unit.isWalking) { arrived = i; break; }
    }
    assert.ok(arrived !== null, 'slow walk never finished');
    assert.ok(Math.abs(arrived - expectedFrames) <= 1, `arrived on frame ${arrived}, expected ~${expectedFrames}`);
    assert.equal(unit.group.position.x, goal.x);
    assert.equal(unit.group.position.z, goal.z);
    assert.ok(dist(xz(unit), goal) < 1e-12);
  } finally { unit.dispose(); ctx.system.dispose(); }
});

// REFINED: this test used to only assert finiteness for a bogus speed, which is
// what let the I-2 lying-`isWalking` bug (and the silent fallback to the type
// default) go unnoticed. The finiteness assertions are kept and the semantics
// are now asserted exactly; see also the I-2 / M-1 tests above.
test('a speed override is honoured, and a bogus speed stays finite and inert', () => {
  const { ctx, unit } = settledUnit('kesatria');
  try {
    const start = xz(unit);
    unit.walkTo(start.x + 4, start.z, { speed: 8 });
    frame(unit);
    assert.ok(Math.abs(dist(xz(unit), start) - 8 * STEP) < 1e-9);
  } finally { unit.dispose(); ctx.system.dispose(); }

  const second = settledUnit('kesatria');
  try {
    const unit = second.unit;
    const start = xz(unit);
    for (const bad of [NaN, Infinity, 0, -3, 'fast']) {
      const returned = unit.walkTo(start.x + 4, start.z, { speed: bad });
      assert.equal(returned, false, `speed ${String(bad)} should be refused`);
      assert.equal(unit.isWalking, false, `speed ${String(bad)} left isWalking true`);
      for (let i = 0; i < 120; i++) frame(unit);
      assert.ok(Number.isFinite(unit.group.position.x), `x NaN for speed ${String(bad)}`);
      assert.ok(Number.isFinite(unit.group.position.z), `z NaN for speed ${String(bad)}`);
      assert.deepEqual(xz(unit), start, `speed ${String(bad)} moved the unit`);
    }
  } finally { second.unit.dispose(); second.ctx.system.dispose(); }
});





// ---------------------------------------------------------------------------
// Task 8: the spawn offset is caller-controllable
// ---------------------------------------------------------------------------
//
// The card-AR scale is ~0.02x the demo scale, so the fixed (0, 0, 2.1) spawn
// would materialise a unit an order of magnitude outside its own arena. The
// controller therefore passes a scale-appropriate `spawnOffset`; these tests pin
// the option, its default, and the fact that it cannot be mutated from outside.

test('spawnOffset overrides the (0, 0, 2.1) default for a small world scale', () => {
  const ctx = context();
  try {
    const spawn = new T.Vector3(0, 0, 0.07);
    const unit = createUnit('kesatria', ctx, { position: new T.Vector3(0.1, 0, 0.1), faction: 'blue', index: 0, spawnOffset: spawn });
    assert.ok(unit.group.position.distanceTo(spawn) < 1e-12, 'the group did not spawn at the overridden offset');
    // The unit is in the arena, not 2.1 units away from its own card.
    assert.ok(Math.abs(unit.group.position.z) < 0.5, 'spawn offset was not applied');
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('spawnOffset defaults to (0, 0, 2.1) and is copied, not aliased', () => {
  const ctx = context();
  try {
    const defaulted = createUnit('kesatria', ctx, { position: new T.Vector3(), faction: 'blue', index: 0 });
    assert.deepEqual(
      [defaulted.spawnOffset.x, defaulted.spawnOffset.y, defaulted.spawnOffset.z],
      [0, 0, 2.1]
    );

    // A caller's vector must not become an alias the unit can write through.
    const spawn = new T.Vector3(0, 0, 0.07);
    const owned = createUnit('kesatria', ctx, { position: new T.Vector3(), faction: 'blue', index: 0, spawnOffset: spawn });
    assert.notEqual(owned.spawnOffset, spawn, 'spawnOffset was aliased to the caller vector');
    owned.spawnOffset.set(9, 9, 9);
    assert.deepEqual([spawn.x, spawn.y, spawn.z], [0, 0, 0.07], 'mutating the unit changed the caller vector');

    defaulted.dispose(); owned.dispose();
  } finally { ctx.system.dispose(); }
});

test('a small spawnOffset keeps a walking unit inside a table-sized arena', () => {
  const ctx = context();
  try {
    const spawn = new T.Vector3(0, 0, 0.07);
    const unit = createUnit('kesatria', ctx, { position: new T.Vector3(-0.18, 0, 0.05), faction: 'blue', index: 0, spawnOffset: spawn });
    unit.build();
    unit.walkTo(-0.05, 0.02);
    // A table-sized arena is ~0.4 units across; the unit must never be further
    // than that from where it spawned, at any point in its build/walk.
    let worst = 0;
    for (let i = 0; i < 60 * 12; i++) {
      frame(unit);
      worst = Math.max(worst, Math.hypot(unit.group.position.x + 0.18, unit.group.position.z - 0.05));
    }
    assert.ok(worst < 0.4, `unit wandered ${worst} units, outside a table-sized arena`);
    assert.equal(unit.state === 'guarding' || unit.state === 'attacking', true, `unit never settled (state=${unit.state})`);
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('battle visual scale enlarges models without changing logical transforms', () => {
  const ctx = context();
  try {
    const position = new T.Vector3(0.12, 0, -0.08);
    const structure = ctx.system.create('robot', position.clone());
    const unit = createUnit('kesatria', ctx, {
      position: position.clone(), faction: 'blue', index: 0, spawnOffset: new T.Vector3(0, 0, 0.07)
    });

    assert.equal(BATTLE_VISUAL_SCALE, 2);
    assert.equal(applyBattleVisualScale(structure), BATTLE_VISUAL_SCALE);
    assert.equal(applyBattleVisualScale(unit), BATTLE_VISUAL_SCALE);
    assert.deepEqual([structure.group.position.x, structure.group.position.z], [0.12, -0.08]);
    assert.deepEqual([unit.group.position.x, unit.group.position.z], [0, 0.07]);
    assert.deepEqual([structure.group.scale.x, structure.group.scale.y, structure.group.scale.z], [2, 2, 2]);
    assert.deepEqual([unit.group.scale.x, unit.group.scale.y, unit.group.scale.z], [2, 2, 2]);

    // Invalid configuration cannot turn into a simulation-affecting transform.
    applyBattleVisualScale(unit, 0);
    assert.deepEqual([unit.group.scale.x, unit.group.scale.y, unit.group.scale.z], [2, 2, 2]);
    structure.dispose();
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('battle HUD height scales the invisible-build fallback but keeps live bounds', () => {
  const ctx = context();
  try {
    const unit = createUnit('kesatria', ctx, {
      position: new T.Vector3(), faction: 'blue', index: 0,
      spawnOffset: new T.Vector3(0, 0, 0.07)
    });
    applyBattleVisualScale(unit);

    // Build-time parts are invisible, so Box3 cannot measure a top yet.
    const fallback = battleHudHeight(unit.group, 'kesatria');
    assert.equal(fallback, 3.7 * BATTLE_VISUAL_SCALE + (defaultBarHeight('kesatria') - 3.7));

    // Once a visible part exists, the current world transform wins over the
    // fallback, including the battle group's visual scale.
    const mesh = new T.Mesh(new T.BoxGeometry(1, 2, 1));
    mesh.position.y = 2;
    mesh.visible = true;
    unit.group.add(mesh);
    unit.group.updateWorldMatrix(true, true);
    assert.equal(battleHudHeight(unit.group, 'kesatria'), 6.55);
    mesh.geometry.dispose();
    unit.dispose();
  } finally { ctx.system.dispose(); }
});
