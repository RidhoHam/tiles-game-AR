# Sand Grain Model Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use subagent-driven-development (recommended) or executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace block scale animations with targeted instanced sand grains and improve the readable sculpted detail of castle, bunker, robot, and tank while preserving current interactions.

**Architecture:** Add a focused `sand-grains.js` module that owns sampled targets, pooled instances, and build/destroy particle motion. `SandStructure` remains responsible for lifecycle, health, joints, colliders, and generator definitions; it delegates grain transitions and keeps solid meshes hidden/revealed according to grain progress. `main.js` only supplies configuration and continues using the existing UI and pointer contracts.

**Tech Stack:** Three.js `^0.180.0`, Vite, browser ES modules, InstancedMesh, MeshStandardMaterial shader hooks.

## Global Constraints

- Visual priority is maximal; AR/mobile optimization is deferred.
- Use a default 40,000 construction-grain capacity, configurable independently from decorative effects.
- Preserve states `idle`, `building`, `built`, `destroying`, `destroyed`.
- Preserve current actions, pointer selection, projectiles, health, and collider behavior.
- Do not add a physics engine, GPU compute simulation, or runtime dependency.
- Keep all target and particle coordinates correct under root translation, scaling, joints, turret rotation, and tank movement.
- Use `npm run build` as the required build verification command.
- This workspace has no Git metadata; do not include commit steps.

## File Map

- Create: `sand-grains.js` for target sampling, pooled instancing, motion, cleanup, and disposal.
- Modify: `sand-structures.js` for part metadata, lifecycle delegation, hit-point damage routing, and model detail additions.
- Modify: `main.js` to pass construction capacity/configuration without changing user-facing controls.
- Create: `tests/sand-grains.test.js` for pure sampling and lifecycle-helper tests if Node-compatible exports are used.
- Modify: `package.json` only if a test script is added; do not add dependencies.

### Task 1: Define Grain Sampling and Pool Contracts

**Files:**
- Create: `sand-grains.js`
- Create: `tests/sand-grains.test.js`

**Interfaces:**
- Produce `createGrainSampler()` exposing `sampleBox(size, count, seed)`, `sampleCylinder(top, bottom, height, count, seed)`, `sampleSphere(count, seed)`, `sampleExtrusion(shape, depth, count, seed)`, and `samplePart(part, count, seed)`. Return arrays of `Vector3` in geometry-local space; mesh scale is applied by the part matrix, not baked into samples.
- Produce `SandGrainSystem(scene, material, options)` with `registerPart(owner, part)`, `startBuild(owner)`, `startDestroy(owner, part, delay = 0)`, `isActive(owner)`, `update(dt)`, `clearOwner(owner)`, and `dispose()`.
- `startBuild(owner)` starts transitions for registered owner parts; `startDestroy(owner, part, delay)` snapshots the current part pose and schedules one transition. Both return a boolean success value. `isActive(owner)` reports queued or running transitions; completion is polled after `update(dt)`.
- Produce `createGrainPool(capacity)` exposing `acquire(owner, count) -> number[]` and `clearOwner(owner)`. Allocation is bounded; insufficient capacity returns an empty array without modifying existing ownership.
- `registerPart(owner, part)` stores target points, source points, and per-grain deterministic offsets without allocating during frame updates.

- [ ] **Step 1: Write failing tests for deterministic bounded sampling.**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { createGrainSampler } from '../sand-grains.js';

test('sampling is deterministic and returns finite points inside a box', () => {
  const sampler = createGrainSampler();
  const a = sampler.sampleBox([2, 1, 3], 32, 17);
  const b = sampler.sampleBox([2, 1, 3], 32, 17);
  assert.deepEqual(a, b);
  assert.equal(a.length, 32);
  for (const p of a) {
    assert.ok(Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z));
    assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 0.5 && Math.abs(p.z) <= 1.5);
  }
});
```

- [ ] **Step 2: Run the focused test and verify it fails because the sampler is absent.**

Run: `node --test tests/sand-grains.test.js`
Expected: FAIL with the missing module/export error.

- [ ] **Step 3: Implement deterministic seeded sampling primitives.**

Implement a local seeded PRNG, `sampleBox`, `sampleCylinder`, `sampleSphere`, and `sampleExtrusion`; reject non-finite dimensions by clamping to zero and keep every output finite. Use rejection sampling for analytic volumes and polygon containment for extrusion. Export the sampler and system class.

- [ ] **Step 4: Add pool bookkeeping tests.**

```js
import { createGrainPool } from '../sand-grains.js';

test('pool refuses allocation beyond capacity and clears owner slots', () => {
  const pool = createGrainPool(4);
  const owner = {};
  assert.equal(pool.acquire(owner, 4).length, 4);
  assert.equal(pool.acquire({}, 1).length, 0);
  pool.clearOwner(owner);
  assert.equal(pool.acquire({}, 1).length, 1);
});
```

- [ ] **Step 5: Implement reusable instance allocation and cleanup.**

Maintain `owner -> slot indices`, an active count, reusable free slots, and an `InstancedMesh` with `DynamicDrawUsage`. Hidden slots must receive zero scale; update only active slots and set `instanceMatrix.needsUpdate` once per frame.

- [ ] **Step 6: Run tests and build.**

Run: `node --test tests/sand-grains.test.js`; then `npm run build`.
Expected: PASS and a successful Vite production build.

### Task 2: Integrate Build Grain Formation

**Files:**
- Modify: `sand-structures.js:101-196, 221-236, 250-258`
- Modify: `main.js:79-88`

**Interfaces:**
- `SandStructureSystem` owns `this.grains`; `finish()` calls `registerPart(this, part)` once the final part poses are known.
- `SandStructure.build()` calls `this.system.grains.startBuild(this)` after resetting parts.
- `SandGrainSystem.update(dt)` advances transitions; the structure reads `isActive(this)` for completion. Update grains before checking structure completion; do not query immediately after scheduling and incorrectly finish a queued transition.

- [ ] **Step 1: Add metadata and registration without changing visible behavior.**

Extend each part with `grainTarget`, `grainSlots`, `grainProgress`, `grainSeed`, and `grainTransition`. Register geometry-specific targets in `finish()` after world matrices are known. Keep existing meshes hidden until integration is complete.

- [ ] **Step 2: Replace build scale-in with four phases.**

On build, allocate target slots per part using a size-weighted count with a minimum for visible small parts. Animate source points from a local ground/source band through curved paths toward targets, reveal the solid mesh using a per-part threshold, then fade settled grain slots as the solid becomes visible. Set `state = 'built'` only after all transitions and clear remaining build slots.

- [ ] **Step 3: Add progress-focused lifecycle tests.**

Test that a build starts with invisible solids, reaches visible full-scale solids, returns `built`, leaves no owner grain slots, and repeated `build()` during transition returns `false`.

- [ ] **Step 4: Add configurable capacity in `main.js`.**

Instantiate the system with `{ particleCapacity: 450, grainCapacity: 40000 }`. Do not alter AR root transforms or UI labels in this task.

- [ ] **Step 5: Run build and inspect browser runtime.**

Run: `npm run build`; run `npm run dev` and inspect all four structures. Expected: grain streams visibly fill each silhouette, solids do not pop in by scale, and all existing controls remain responsive.

### Task 3: Integrate Destroy, Damage, and Transform-Safe Coordinates

**Files:**
- Modify: `sand-structures.js:143-165, 221-239`
- Modify: `sand-grains.js`
- Modify: `tests/sand-grains.test.js`

**Interfaces:**
- `startDestroy(owner, part, delay = 0)` snapshots the current part matrix, detaches grains from that pose, and returns a boolean. Already dead/scheduled parts must not emit twice.
- `damage(amount, hitPoint)` optionally prioritizes parts whose world bounds contain or approach `hitPoint`; `damage(amount)` retains existing exterior/height ordering.

- [ ] **Step 1: Write tests for transformed targets and destruction cleanup.**

Cover translated/scaled root plus rotated joint, finite local-to-root conversion, destroy completion, owner cleanup, and no collider for dead parts.

- [ ] **Step 2: Implement inverse-root coordinate conversion.**

Convert mesh target points with `root.matrixWorld.clone().invert().multiply(mesh.matrixWorld)` before writing instance positions. At destroy start, snapshot current mesh matrix world so detached grains no longer follow later joint animation.

- [ ] **Step 3: Replace collapse-only destroy with grain detach plus debris accents.**

Release surface/interior slots with gravity, damped bounce, ground clamp, settle, and fade. Keep the existing falling mesh as a short-lived large debris accent only; do not use scale-out as the primary destruction animation. Remove owner slots when transition ends and set `destroyed` only when both grain and debris work is finished.

- [ ] **Step 4: Route projectile impact points into damage selection.**

Change the projectile call to `target.damage(12, hits[0].point)`. Select nearby live structural parts first, then use existing exterior ordering. Cosmetic details must not inflate health damage unit count.

- [ ] **Step 5: Run focused tests and production build.**

Run: `node --test tests/sand-grains.test.js`; then `npm run build`.
Expected: PASS; no import, syntax, or shader build errors.

### Task 4: Improve Sculpted Model Detail

**Files:**
- Modify: `sand-structures.js:293-413`

**Interfaces:**
- Continue using `box`, `cylinder`, `ball`, and `extrude`; all new meshes must pass through `s.add` so lifecycle, shadows, and disposal remain consistent.
- New animated details must be children of the relevant existing joint (`bridge`, `arms`, `head`, `turret`, `barrel`) when they move with it.

- [ ] **Step 1: Add reusable sculpt-detail helpers.**

Add small helpers for bevelled-looking caps, shallow closed reliefs, irregular trim, and sand seam/crease meshes. Use closed geometry only; avoid open shells and excessive unique geometry allocations.

- [ ] **Step 2: Add castle detail.**

Introduce irregular brick relief, layered arch framing, softened merlon caps, tower bands, and bridge planks/side braces. Keep entrance recess empty and ensure new details follow the bridge joint where applicable.

- [ ] **Step 3: Add bunker detail.**

Add stepped surface bands, closed ventilation reliefs, door frame, and organically varied spike bases. Keep launchers and projectiles attached to existing positions and joints.

- [ ] **Step 4: Add robot detail.**

Add armor seams, shoulder plates, elbow/knee joints, palms/fingers, chest relief, and visor framing. Parent limb details to `arms`, `head`, or leg joints so surrender animation remains coherent.

- [ ] **Step 5: Add tank detail.**

Add hull bevel accents, turret ring, wheel hubs, tread relief, barrel collar, and enclosed muzzle rim. Keep wheel/tread arrays and turret/barrel transforms intact.

- [ ] **Step 6: Tune material for geometry-readable wet sand.**

Extend the existing shader variation with restrained roughness/color variation and surface noise. Preserve `blocks` distinction and avoid relying on color noise alone for detail.

- [ ] **Step 7: Run build and manually inspect all interaction states.**

Run: `npm run build`; verify overview, close-up, build, partial damage, destroy, rebuild, and every structure-specific action. Expected: details read as sculpted wet sand and no action loses its parent transform.

### Task 5: Harden Disposal, Capacity, and Regression Verification

**Files:**
- Modify: `sand-grains.js`
- Modify: `sand-structures.js`
- Modify: `main.js`
- Modify: `package.json` only if required for test script
- Modify: `tests/sand-grains.test.js`

**Interfaces:**
- `dispose()` on a structure clears its projectiles, grain slots, meshes, and references.
- `dispose()` on the system disposes construction geometry/material and does not dispose caller-owned materials.

- [ ] **Step 1: Add regression tests for repeated lifecycle and capacity limits.**

Run 10 build/destroy/rebuild cycles, create all four structures, force a capacity smaller than the requested allocation, and assert active slots never exceed capacity or become NaN.

- [ ] **Step 2: Implement graceful low-capacity behavior.**

Scale requested grain counts down proportionally when the free pool is insufficient. If capacity cannot provide even one grain per simultaneously active part, queue parts until slots are released; capacity zero disables decorative grains and uses timed solid reveal as an explicit safe fallback. Never overwrite another owner's active slots, and count queued parts as active lifecycle work.

- [ ] **Step 3: Remove per-frame temporary allocations from grain update.**

Reuse vectors, matrices, and dummy objects inside the grain system. Confirm `update(dt)` clamps invalid or oversized `dt` to `0..0.05`.

- [ ] **Step 4: Verify shader/material and resource cleanup.**

Dispose instanced grain geometry/material, unregister owners, clear arrays, and ensure no duplicate mesh is added after rebuild. Check renderer resource counts if available in the browser.

- [ ] **Step 5: Run the complete verification set.**

Run: `node --test tests/sand-grains.test.js`; `npm run build`.
Manual checks: desktop overview/close-up, pointer focus/action, button lifecycle, projectile impact, all four special actions, repeated rebuild, root transform, and browser console. Expected: no runtime errors, no stale grain, no collider regression, and no unbounded resource growth.

## Self-Review

- Spec coverage: sampling, build, destroy, damage, detail geometry, interactions, transform safety, capacity, disposal, tests, and AR deferral are covered by Tasks 1-5.
- Risk review: browser shader compilation must be checked independently of Vite build; shape sampling must account for extrusion holes and bevel boundaries. Node tests alone cannot validate the visual result.
- Interface consistency: `SandGrainSystem` is created in Task 1, attached in Task 2, extended for destruction in Task 3, and hardened in Task 5; `damage(amount, hitPoint)` remains backward-compatible with the existing one-argument call.
- Scope check: construction grains and model detail are one coordinated visual subsystem; UI and AR changes are explicitly excluded.
