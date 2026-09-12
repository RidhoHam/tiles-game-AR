# Sand Armies Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Scale the castle and bunker to 1.5x the robot and add six individual sand knights plus four coordinated gargoyles with formation, demonstration attack, damage, and sand collapse animations.

**Architecture:** Create `sand-units.js` as the isolated owner of unit geometry, unit lifecycle, formation movement, attack poses, health, and unit-grain ownership. Extend `SandStructure` with a unit spawner and group actions, while `main.js` adds compact unit controls and maintains existing structure interactions. Reuse the existing `SandGrainSystem` by registering each unit as its own grain owner.

**Tech Stack:** Three.js `^0.180.0`, Vite, browser ES modules, existing InstancedMesh grain system, Node test runner.

## Global Constraints

- Robot is the visual scale reference at 1.0; castle and bunker are 1.5x the robot.
- Add exactly five mounted knights and one captain to the castle, plus four individual gargoyles to the bunker.
- Units can form a group but retain individual health, state, timing, movement, and grain ownership.
- Demonstration attacks face arena-front and do not damage real structure targets in this phase.
- Preserve existing structure lifecycle, tank/bunker projectiles, pointer orbit/zoom, and AR root transform.
- Unit states are `hidden`, `forming`, `exiting`, `guarding`, `attacking`, `damaged`, `collapsing`, `fallen`.
- Use existing Three.js and no new runtime dependency or physics/pathfinding engine.
- Every new mesh must be disposed; no unit rebuild may leak grain slots or duplicate meshes.
- Run `node --test tests/sand-grains.test.js` and `npm run build` after implementation.
- This workspace has no Git metadata; do not include commit steps.

## File Map

- Create: `sand-units.js` for unit classes, geometry helpers, formation, animation, damage, and disposal.
- Modify: `sand-structures.js` for 1.5 scale metadata, unit spawner integration, structure/unit actions, and unit update/disposal.
- Modify: `main.js` for revised arena layout, unit controls/status, unit picking, and per-frame updates through the existing system.
- Modify: `tests/sand-grains.test.js` or create `tests/sand-units.test.js` for pure unit lifecycle and formation tests.
- Modify: `style.css` only if unit controls require a compact status/control row that does not overflow existing mobile cards.

## Interfaces

`SandUnit` exposes:

```js
build() -> boolean
collapse(amount = Infinity) -> boolean
damage(amount) -> boolean
act() -> boolean
update(dt, context) -> void
getMeshes() -> Mesh[]
dispose() -> void
```

`SandUnitSpawner` exposes:

```js
spawnAll() -> boolean
attackAll() -> boolean
damageNext(amount = 20) -> boolean
collapseAll() -> boolean
update(dt) -> void
aliveCount() -> number
dispose() -> void
```

`SandStructure` adds `units`, `unitSpawner`, `spawnUnits()`, `attackUnits()`,
`damageUnit(amount)`, `collapseUnits()`, and `updateUnits(dt)`. `sand-units.js`
may call `structure.system.grains.registerPart(unit, part)` only through the
existing grain system contract; it must never directly mutate another owner’s
pool slots.

### Task 1: Add Unit Lifecycle and Formation Contracts

**Files:**
- Create: `sand-units.js`
- Create: `tests/sand-units.test.js`

**Interfaces:**
- Consume `SandGrainSystem` methods `registerPart(owner, part)`, `startBuild(owner)`, `startDestroy(owner, part, delay)`, `isActive(owner)`, `clearOwner(owner)`, and `unregisterOwner(owner)`.
- Produce `SandUnit`, `KnightUnit`, `CaptainUnit`, `GargoyleUnit`, and `SandUnitSpawner` with the signatures above.

- [ ] **Step 1: Write failing unit state and formation tests.**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { SandUnitSpawner } from '../sand-units.js';

test('castle spawner creates five knights and one captain with distinct captain stats', () => {
  const spawner = SandUnitSpawner.createCastle({ system: { grains: null }, group: new T.Group() });
  assert.equal(spawner.units.length, 6);
  assert.equal(spawner.units.filter(unit => unit.role === 'knight').length, 5);
  const captain = spawner.units.find(unit => unit.role === 'captain');
  assert.ok(captain);
  assert.ok(captain.maxHealth > spawner.units[0].maxHealth);
  assert.ok(captain.weaponLength > spawner.units[0].weaponLength);
});

test('gargoyles use individual offsets and compact formation when all are alive', () => {
  const spawner = SandUnitSpawner.createBunker({ system: { grains: null }, group: new T.Group() });
  assert.equal(spawner.units.length, 4);
  const offsets = spawner.units.map(unit => unit.formationOffset.toArray().join(','));
  assert.equal(new Set(offsets).size, 4);
  assert.ok(spawner.formationRadius < 3);
});
```

- [ ] **Step 2: Run tests and confirm missing implementation failure.**

Run: `node --test tests/sand-units.test.js`
Expected: FAIL because `sand-units.js` and the factories do not exist.

- [ ] **Step 3: Implement shared unit base and explicit state transitions.**

Create a unit group parented to the structure group, store `state`, `health`,
`maxHealth`, `formationOffset`, `spawnOffset`, `attackPhase`, `seed`, and
`parts`. Implement `build()` to reset health/pose and call grain build, `damage()`
to clamp finite positive values, and `collapse()` to schedule each live part for
grain destroy exactly once before entering `collapsing`.

- [ ] **Step 4: Implement formation spawner and tests.**

Provide `createCastle()` with five `KnightUnit` instances and one
`CaptainUnit`, and `createBunker()` with four `GargoyleUnit` instances. Place
knights in the two-row layout from the spec and gargoyles in four unique offsets.
Implement `aliveCount`, `damageNext`, and `collapseAll` so dead units are skipped.

- [ ] **Step 5: Run focused tests.**

Run: `node --test tests/sand-units.test.js`
Expected: PASS for counts, roles, stats, unique offsets, and state guards.

### Task 2: Build Detailed Knight, Captain, and Gargoyle Models

**Files:**
- Modify: `sand-units.js`
- Modify: `tests/sand-units.test.js`

**Interfaces:**
- Geometry creation uses the structure system helpers or local helpers that call `structure.add`/unit registration for every part.
- `getMeshes()` returns visual meshes for optional unit picking but excludes hidden/fallen meshes.

- [ ] **Step 1: Add geometry-presence tests.**

```js
test('captain has richer armor and larger weapon than regular knights', () => {
  const spawner = SandUnitSpawner.createCastle({ system: { grains: null }, group: new T.Group() });
  const regular = spawner.units.find(unit => unit.role === 'knight');
  const captain = spawner.units.find(unit => unit.role === 'captain');
  assert.ok(captain.parts.length > regular.parts.length);
  assert.ok(captain.weaponLength > regular.weaponLength);
  assert.notEqual(captain.armorColor, regular.armorColor);
});

test('each gargoyle has wings, head, claws, and feet parts', () => {
  const spawner = SandUnitSpawner.createBunker({ system: { grains: null }, group: new T.Group() });
  for (const unit of spawner.units) {
    assert.ok(unit.featureParts.wingLeft && unit.featureParts.wingRight);
    assert.ok(unit.featureParts.head && unit.featureParts.claws);
  }
});
```

- [ ] **Step 2: Implement reusable closed-sand geometry helpers.**

Use boxes, cylinders, spheres, cones, and extrusions already supported by the
project. Mark non-structural armor ornaments as cosmetic while keeping rider,
horse body, gargoyle body, and major limbs as structural unit parts. Parent horse
and rider joints correctly so movement does not detach armor or weapons.

- [ ] **Step 3: Implement regular knight and captain geometry.**

Build each horse from torso, neck, head, four legs, hooves, and tail. Add rider
torso, helm, shoulder armor, arms, sword, and optional shield. Add captain chest
plate, larger pauldrons, crest/plume, banner accent, and longer/wider sword.

- [ ] **Step 4: Implement gargoyle geometry and variation.**

Build body, head, horns/tusks, arms/claws, legs/tail, and two wing assemblies.
Use seeded size/rotation variations so four units are distinguishable without
creating a separate material per unit.

- [ ] **Step 5: Run focused tests and production build.**

Run: `node --test tests/sand-units.test.js`; then `npm run build`.
Expected: geometry tests pass and Vite compiles the new module.

### Task 3: Integrate Unit Grain Forming and Collapse

**Files:**
- Modify: `sand-units.js`
- Modify: `sand-structures.js`
- Modify: `tests/sand-units.test.js`

**Interfaces:**
- Each unit is a unique grain owner; structure rebuild must not call `clearOwner` on unit owners except during explicit unit reset.
- Unit update reads `system.grains.isActive(unit)` and transitions to `exiting` only after forming completes.

- [ ] **Step 1: Write lifecycle tests for build, damage, collapse, and rebuild.**

```js
test('unit forms, exits, takes individual damage, collapses, and rebuilds without leaking grains', () => {
  const spawner = makeTestCastleSpawner();
  assert.equal(spawner.spawnAll(), true);
  advance(spawner, 6);
  assert.ok(spawner.units.every(unit => ['guarding', 'exiting'].includes(unit.state)));
  const first = spawner.units[0];
  assert.equal(first.damage(first.maxHealth), true);
  advance(spawner, 4);
  assert.equal(first.state, 'fallen');
  assert.equal(spawner.aliveCount(), 5);
  assert.equal(first.build(), true);
  advance(spawner, 6);
  assert.ok(['guarding', 'exiting'].includes(first.state));
  assert.equal(spawner.system.grains.pool.activeCount, 0);
});
```

- [ ] **Step 2: Register every unit part with the existing grain system.**

After unit geometry is created and final local poses are known, call
`registerPart(unit, part)` for every part. Use a unit-specific seed and preserve
the structure root inverse-matrix conversion already used by `SandGrainSystem`.

- [ ] **Step 3: Implement forming and collapse completion.**

`build()` hides all unit meshes and schedules grain forming. Once grain activity
ends, make the unit visible and enter `exiting`. `collapse()` marks unit parts
dead, starts grain destroy, fades debris, and sets `fallen` only after both unit
debris and grain activity complete. Partial damage can hide cosmetic armor before
full collapse, but never starts the same part transition twice.

- [ ] **Step 4: Implement low-capacity-safe group lifecycle.**

When many structure and unit owners compete for grain slots, preserve the grain
system queue/fallback behavior. Unit state must still finish with capacity zero;
no unit may remain permanently in `forming` or `collapsing` because it received
no slots.

- [ ] **Step 5: Run focused tests.**

Run: `node --test tests/sand-units.test.js`
Expected: PASS with zero active grain slots after collapse/rebuild.

### Task 4: Add Exit, Guard, Attack, and Flock Movement

**Files:**
- Modify: `sand-units.js`
- Modify: `tests/sand-units.test.js`

**Interfaces:**
- `update(dt, context)` receives `{ time, formationRadius, liveCount, attackRequested }` and never allocates per frame.
- `attackAll()` sets an attack request and returns `false` while the group is still forming/collapsing.

- [ ] **Step 1: Add movement/pose tests.**

Assert that a knight’s group advances from spawn toward its formation offset,
gargoyle vertical position changes during flight, captain attack differs from a
regular knight, and reducing live gargoyles increases remaining formation radius.

- [ ] **Step 2: Implement knight exit and guarding motion.**

Move horse/rider forward with staggered spawn delay, add alternating leg/horse
head motion, then settle at formation offset. Guarding raises swords. Keep the
captain slightly forward and use a distinct slower pose.

- [ ] **Step 3: Implement knight attack choreography.**

Regular knights use staggered wind-up/swing/recovery phases. Captain uses longer
wind-up, higher sword arc, chest/horse emphasis, and a slower recovery. Attacks
face arena-front only and do not create projectiles or target intersections.

- [ ] **Step 4: Implement gargoyle flock and individual motion.**

Apply a shared flock center plus individual orbit/wing phase. With four live
units use a compact radius; with fewer units spread offsets and vary dive timing.
Wing flaps, body bob, and attack dives must use reusable vectors and saved base
poses.

- [ ] **Step 5: Run tests and build.**

Run: `node --test tests/sand-units.test.js`; then `npm run build`.
Expected: movement and attack tests pass; no build errors.

### Task 5: Scale Structures, Spawn Units, and Preserve Layout

**Files:**
- Modify: `sand-structures.js:83-147, 190-247, 307-369`
- Modify: `main.js:79-88, 100-177`
- Modify: `tests/sand-units.test.js`

**Interfaces:**
- `SandStructureSystem.create(type, position)` continues returning a `SandStructure`.
- `SandStructure` creates a castle spawner only for `castle` and a gargoyle spawner only for `bunker`.
- Existing `build()` builds the structure; unit spawning remains explicit through `spawnUnits()` so startup does not show units prematurely.

- [ ] **Step 1: Add scale/layout tests.**

Create robot, castle, and bunker; compare world bounding-box heights after setup.
Assert castle/bunker heights are within 5% of `robotHeight * 1.5`, unit spawn points
are in front of their parent, and the four structure centers remain separated.

- [ ] **Step 2: Apply castle/bunker scale metadata consistently.**

Use `modelScale = type === 'castle' || type === 'bunker' ? 1.5 : 1` in the
generator or structure group before finish-time grain registration. Ensure home
poses, delay calculation, collider bounds, gate/door positions, and unit spawn
offsets all use the scaled transform exactly once.

- [ ] **Step 3: Instantiate unit spawners and add structure methods.**

Create spawners after structure geometry is complete. Add `spawnUnits`,
`attackUnits`, `damageUnit`, `collapseUnits`, and `updateUnits`, with lifecycle
guards that return `false` when the parent is not built or when a group transition
is already running.

- [ ] **Step 4: Reposition arena structures and camera overview.**

Move castle/bunker farther apart and reserve front space for units. Keep robot and
tank visible in overview, update overview camera distance if required, and leave
AR root scale code unchanged.

- [ ] **Step 5: Run tests and browser build.**

Run: `node --test tests/sand-units.test.js`; then `npm run build`.
Expected: scale/layout tests pass and existing four-structure tests remain green.

### Task 6: Add Unit Controls, Picking, and Full Regression Coverage

**Files:**
- Modify: `main.js:115-193, 235-248, 287-300`
- Modify: `style.css:19-45` only if needed
- Modify: `tests/sand-units.test.js`

**Interfaces:**
- Add structure-card controls `Bangun pasukan`/`Panggil gargoyle`, `Serang pasukan`/`Serang kawanan`, `Hantam pasukan`/`Hantam gargoyle`, and `Runtuhkan pasukan`.
- Preserve current cards and disable unit controls while parent is not built or units are transitioning.

- [ ] **Step 1: Add UI state tests/helpers.**

Verify labels are selected by structure type, live-count text updates after unit
damage, and controls do not invoke actions while parent is `building`,
`destroying`, or `destroyed`.

- [ ] **Step 2: Add unit controls without changing existing controls.**

Append a compact unit row only to castle/bunker cards. Refresh status with the
unit alive count. Do not remove or rename `Bangun`, `Runtuhkan`, damage, action,
fire, or turret controls.

- [ ] **Step 3: Extend picking safely.**

Keep structure colliders as the first pick path. Add visible unit meshes as a
second path; a unit click focuses its parent and stores selected unit for the
next attack/damage demonstration. Fallen/hidden units must not be pickable.

- [ ] **Step 4: Add full regression tests.**

Cover startup with four structures, explicit unit spawn, attack interruption,
individual damage until all units fall, partial rebuild, group collapse, root
translation/scale, low grain capacity, and disposal. Assert no duplicate mesh,
no stale owner, and no active grain slot after cleanup.

- [ ] **Step 5: Run complete validation.**

Run:

```text
node --test tests/sand-grains.test.js tests/sand-units.test.js
npm run build
```

Start `npm run dev`, inspect overview and close-up, call both armies, observe
exit/guard/attack/collapse/rebuild, test pointer focus and all old controls, and
check the browser console for shader/runtime errors.

## Self-Review

- Spec coverage: scale/layout is Task 5; knight/captain/gargoyle models are Task 2; individual lifecycle and grain behavior are Task 3; formation/flock/attack are Task 4; controls/picking/regression are Task 6.
- Placeholder scan: no `TBD`, `TODO`, or unspecified implementation steps are used.
- Interface consistency: `SandUnitSpawner` factory and lifecycle methods are defined in Task 1 and consumed consistently in Tasks 3-6; `SandStructure` methods are introduced in Task 5 before UI use in Task 6.
- Resource safety: every task that creates geometry references disposal and owner cleanup; Task 6 explicitly verifies repeated rebuild and disposal.
- Scope: no target combat, AI pathfinding, projectile weapons, or AR-specific redesign is introduced.
