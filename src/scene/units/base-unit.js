import * as T from 'three';
import { UNIT_DEFINITIONS } from '../../core/unit-definitions.js';
import { advanceToward } from '../unit-motion.js';

const clamp = (n, a, b) => Math.max(a, Math.min(b, n));
const smooth = n => { n = clamp(n, 0, 1); return n * n * (3 - 2 * n); };

// --- When is a walk a STALL? ---------------------------------------------------
//
// A walk advances in the SIMULATION FRAME's own units. "No progress" therefore
// has TWO independent causes, and the earlier revisions of this file each handled
// only one of them:
//
//   (1) SUB-RESOLUTION. `here + delta` rounds straight back to `here` when
//       |delta| is below half the coordinate's ULP, so the coordinate is frozen
//       while `step` is still positive. This is a property of the NUMBER, not of
//       the speed: at x = 4 the ULP is 2^-50 = 8.88e-16, so ANY step below
//       ~4.4e-16 (speed * dt < 4.4e-16, i.e. speed < ~2.7e-14 units/s at 60 fps)
//       writes nothing. This is the M-1 stall in its most extreme form, and the
//       arithmetic that causes it is not a policy question.
//   (2) INFEASIBLE HORIZON. The step is representable, but the leg is so long
//       relative to it that reaching the goal would take an absurd number of
//       frames.
//
// Cause (1) is DETECTED EXACTLY, with no threshold at all: `travelled` is
// `next - here`, measured on the coordinate grid, so it is EXACTLY 0 whenever the
// ULP swallowed the step. A frame that moved nothing, with a gap still to close,
// can never be followed by a frame that does - so the walk ends. There is no
// guesswork and nothing to tune.
//
// Only cause (2) needs a policy threshold, MAX_WALK_FRAMES: the walk is abandoned
// if the frame count it implies, `travelledDistance / step`, exceeds it. The
// frame count is the honest measure of feasibility (a speed in units/s is not:
// the same speed is fine over 1 unit and hopeless over 1e6), and it is exactly
// the quantity the guard has to bound. MAX_WALK_FRAMES = 60*60*30 is 30 simulated
// MINUTES at 60 fps - 1,800 simulated seconds for a leg, far past the point where
// the move has visibly stopped and would otherwise never end. Because the budget
// scales with the leg, it cannot reject a slow walk over a long distance: a walk
// that really is progressing simply gets the frames, and only a walk whose own
// step cannot cover its own leg in half an hour is abandoned.
//
// WHY THE PREVIOUS RELATIVE RATIO (`travelled <= remaining * 1e-12`) WAS WRONG,
// kept here because it is instructive: it measured the step against the remaining
// GAP, and the boundary that matters for cause (1) is the ULP, not the gap. At
// x = 4, D = 4 the two differ by 13 orders of magnitude - the ULP-driven stall
// ratio there is ~1.1e-16 - so a threshold of 1e-12 both failed to fire on the
// sub-ULP speeds it was written for and left a wide non-terminating band between
// ~2.4e-10 and ~1e-7 units/s (measured by direct simulation). A ratio near a hard
// ULP boundary has to be chosen to within a few orders of magnitude of the ULP
// itself, which is not a defensible place to put a magic number; measuring the
// travel exactly and bounding the FRAME COUNT is.
const MAX_WALK_FRAMES = 60 * 60 * 30;

// The walk is terminated at the position it actually reached when a stall is
// detected. That position is written back as `motionTarget` so `settleXZ` pins the
// unit where it stands, instead of leaving it to settle onto a goal it cannot
// reach - which would teleport it up to the whole remaining distance in one frame
// (the D-2 bug).
function endWalkInPlace(unit, w, here) {
  w.arrived = true; w.speed = 0;
  unit.motionTarget = { x: here.x, z: here.z };
}

class SandUnit {
  constructor(context, role, options = {}) {
    this.system = context.system;
    this.material = context.material;
    this.dark = context.dark;
    this.primary = context.primary ?? context.material;
    this.role = role; this.index = options.index ?? 0; this.faction = options.faction ?? null;
    // The formationOffset is where the unit belongs once it has walked out;
    // spawnOffset is the local point it materialises from before that walk.
    // `options.spawnOffset` overrides the (0, 0, 2.1) default so a caller working
    // at a smaller world scale keeps the spawn inside its own arena.
    // (The old `slot` field duplicated formationOffset and was never read - removed.)
    this.formationOffset = (options.position ?? new T.Vector3()).clone();
    this.formationRadius = options.formationRadius ?? 1;
    this.spawnOffset = (options.spawnOffset ?? new T.Vector3(0, 0, 2.1)).clone();
    // `spawnOffset` is used both as a LOCAL spawn point (group.position.copy it)
    // and, in `placeXZ`, as a WORLD point to lerp from. Those only agree while the
    // group has not been moved by the motion layer, so the two are different
    // vectors: `motionOrigin` is the world spawn point and is refreshed every
    // time the model is placed back at the spawn.
    //
    // It defaults to a fixed (0, 0, 2.1) for the standalone demo, where the scene
    // is built at a human scale and that offset reads as "two metres in front".
    // Card AR is a different scale: one world unit is a metre of REAL table, the
    // arena spans ~0.4 units, and a fixed 2.1 would place the spawn five times
    // further out than the whole battlefield, so the unit would appear to leap in
    // from nowhere. Callers that own the layout therefore pass their own
    // `spawnOffset` (see game-controller.js), and the value is copied so a
    // caller's vector can never be mutated through the unit.
    this.motionOrigin = this.spawnOffset.clone();
    this.group = new T.Group();
    this.group.position.copy(this.spawnOffset); (options.parent || context.root).add(this.group);
    this.parts = []; this.featureParts = {}; this.state = 'hidden';
    // Motion layer: while false the build state machine owns X/Z and pulls the
    // model back to formationOffset each frame. The first moveTo()/walkTo() flips
    // this so an external target is no longer overwritten by update()/pose().
    this.externalPosition = false; this.motionTarget = null;
    // Walking state. `motionTarget` is the movement GOAL; it stays non-null after
    // arrival so X/Z remain pinned there (that is what stops the state machine
    // pulling the model back to its slot). `walkState` is the live per-frame
    // progress, and `walkState.arrived` is what `isWalking` reports on: the two
    // are deliberately different so "has a goal" and "is still moving" stay
    // independently expressible.
    this.walkState = null;
    // The yaw a walk keeps when its final representable step has no direction to
    // face: `advanceWalk` falls back to this only on the zero-length split
    // (`dx === 0 && dz === 0`), which is now reached on the arrival frame and
    // nowhere else. The default is faction forward (blue +X, red -X, neutral +X)
    // so a unit that has never been turned does not keep an arbitrary yaw.
    // NOTE (report correction): this is NOT the +Z-lane tiebreak it was once
    // documented as. A +/-Z leg does not have `dx === 0` after `advanceToward`
    // normalises the bearing, so it faces its real travel bearing instead.
    this.facingHint = options.facingHint ?? (this.faction === 'red' ? -Math.PI / 2 : Math.PI / 2);
    const defined = UNIT_DEFINITIONS[role]?.maxHealth;
    this.health = this.maxHealth = defined ?? (role === 'captain' ? 150 : 100);
    this.weaponLength = role === 'captain' ? 1.5 : role === 'kesatria' ? 1 : 0; this.armorColor = role === 'captain' ? 0xa6844f : 0x987b51;
    this.age = 0; this.attackClock = this.index * 0.33; this.dead = false;
  }
  add(geometry, position, material, parent = this.group, cosmetic = false) {
    const mesh = new T.Mesh(geometry, material); mesh.position.copy(position); mesh.userData.cosmetic = cosmetic;
    parent.add(mesh); mesh.visible = false; mesh.castShadow = true; mesh.receiveShadow = true;
    const part = { mesh, home: mesh.position.clone(), rotation: mesh.quaternion.clone(), scale: mesh.scale.clone(), dead: false, falling: false, age: 0, delay: this.index * 0.15, grainTarget: [], grainSlots: [], grainSeed: this.parts.length + this.index * 41, grainProgress: 0, grainTransition: null, cosmetic };
    this.parts.push(part); return mesh;
  }
  build() {
    if (this.state === 'forming' || this.state === 'exiting' || this.state === 'guarding' || this.state === 'attacking') return false;
    this.system.grains.clearOwner(this); this.group.position.copy(this.spawnOffset); this.motionOrigin.copy(this.group.position); this.group.rotation.set(0,0,0); this.health = this.maxHealth; this.dead = false; this.age = 0; this.state = 'forming';
    // A rebuild returns the model to the spawn animation, so the build machine
    // takes X/Z back from the motion layer and any in-flight walk is dropped.
    this.externalPosition = false; this.motionTarget = null; this.walkState = null;
    for (const p of this.parts) { p.dead = p.falling = false; p.mesh.position.copy(p.home); p.mesh.quaternion.copy(p.rotation); p.mesh.scale.copy(p.scale); p.mesh.visible = false; }
    return this.system.grains.startBuild(this);
  }
  // --- Motion API -----------------------------------------------------------
  //
  // moveTo  = TELEPORT / SNAP. The unit is placed at (x, z) immediately; there is
  //           no travel time. Existing callers and tests rely on this instant
  //           semantics, so it is deliberately NOT redefined as an alias of
  //           walkTo. What the two *do* share is the gate: both hand X/Z to the
  //           motion layer (externalPosition = true), so neither is subsequently
  //           dragged back to the formation slot by update()/pose().
  //
  // walkTo  = MOVE OVER TIME. Records a goal and lets update() advance toward it
  //           at `speed` world units per second, using the shared advanceToward
  //           primitive. Arrives exactly on the goal and then holds it.
  //
  // (If a future caller wants "snap, but also stay snapped forever", moveTo
  // already does that. Making moveTo an alias of walkTo would change it into a
  // slow move and break the instant-placement tests, so it is left as a snap.)
  moveTo(x, z) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    this.externalPosition = true;
    this.motionTarget = { x, z };
    // A snap supersedes any walk that was in progress.
    this.walkState = null;
    // Snap onto the plane: the build machine's Y (gargoyle hover) and all pose
    // animation keep running, but X/Z now belong to the motion layer.
    this.group.position.x = x; this.group.position.z = z;
    return true;
  }
  // Walk toward (x, z) at `options.speed` (default: UNIT_DEFINITIONS[role].speed,
  // world units per second).
  //
  // SPEED SEMANTICS - all three cases of "no usable speed" are deliberate, and
  // covered by tests in tests/scene/unit-walk.test.js:
  //
  //   1. no `options.speed` at all -> the type's own UNIT_DEFINITIONS speed.
  //   2. speed <= 0, or a non-numeric/NaN/Infinity override -> "no walk was
  //      requested". The unit does NOT engage a walk: `walkState` is cleared,
  //      `isWalking` is false, the return value is false, and the unit stays
  //      exactly where it was. X/Z are deliberately NOT gated and NOT pinned to
  //      the requested point, because a non-walk must not move the unit.
  //   3. a positive, finite speed -> a normal walk.
  //
  // Why "decline the walk" rather than "engage, then arrive immediately": the
  // zero-argument-speed call `walkTo(x, z)` is the default and MUST walk, so only
  // a genuinely absent override may fall back to the type speed. Letting a bogus
  // *override* fall back to the type speed silently turns garbage into a
  // full-speed walk, which is the "silently becomes the default" defect this task
  // removes; "arrive immediately" would instead teleport the unit to (x, z),
  // which is the teleporting behaviour the task exists to prevent. Declining
  // changes nothing observable except the return value, and `isWalking` then
  // truthfully reports false - it never claims a stationary unit is walking.
  walkTo(x, z, options = {}) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const hasOverride = options != null && options.speed !== undefined;
    // A supplied override that is not a positive finite number is a caller bug,
    // not a movement request. Only a genuinely absent override falls back.
    const speed = hasOverride ? options.speed : UNIT_DEFINITIONS[this.role]?.speed;
    if (!Number.isFinite(speed) || !(speed > 0)) {
      // Explicitly a non-walk: drop any walk in flight so a lying `isWalking`
      // cannot survive the call, and leave the unit untouched.
      this.walkState = null;
      return false;
    }
    this.externalPosition = true;
    this.motionTarget = { x, z };
    this.walkState = { goalX: x, goalZ: z, speed, arrived: false };
    return true;
  }
  // True while a walk is in progress and has not reached its goal. It is the
  // single source of truth for "this unit is moving under its own power":
  //   - a fresh unit, a snapped unit (moveTo) and an arrived walker -> false;
  //   - a walkTo declined for an unusable speed -> false (no walk was engaged);
  //   - a disposed unit -> false (dispose() clears the walk state).
  // An arrived walker reports false even though motionTarget is still set and
  // still holds its position.
  get isWalking() { return !!this.walkState && !this.walkState.arrived; }
  // Turn to look at a point on the plane using the scene's existing convention.
  //
  // Derivation: both models put their face at local +Z, so with yaw t a Group's
  // local +Z maps to world (sin t, 0, cos t). The scene sets blue t=+PI/2 (->+X)
  // and red t=-PI/2 (->-X), so blue's forward is +X and red's is -X. To face an
  // offset (dx, dz) we need (sin t, cos t) proportional to (dx, dz), giving
  // t = atan2(dx, dz): for blue straight ahead (dx>0, dz=0) this is +PI/2 and for
  // red straight ahead (dx<0, dz=0) it is -PI/2, reproducing the convention with
  // no faction branch needed.
  //
  // `fallback` is the yaw to adopt ONLY for a genuinely zero-length direction
  // (dx === 0 && dz === 0); the default keeps the current yaw verbatim, the
  // historical behaviour. Walking reaches this case only when a frame moved
  // nothing (a sub-representable final step) and passes its stored `facingHint`,
  // so a walk that ends that way keeps the bearing it was travelling on - or
  // falls back to the faction forward - rather than snapping to an unrelated yaw.
  // It is never consulted mid-path: `advanceWalk` always calls with a vector it
  // actually traversed, and the only non-zero leg that could reach here (a pure
  // +/-Z leg) already yields a non-zero `dz`, because `advanceToward` normalises
  // `(goal - here)`. All paths stay finite: no division, no NaN.
  // `origin` is the point the direction is measured FROM and exists for exactly
  // one caller: advanceWalk() has already written the new position, so it passes
  // the frame's starting point and the traversed vector is reproduced exactly.
  // Omitting it keeps the historical "measure from my current position" meaning.
  faceTowards(x, z, fallback = this.group.rotation.y, origin = this.group.position) {
    if (!Number.isFinite(x) || !Number.isFinite(z)) return false;
    const ox = Number.isFinite(origin?.x) ? origin.x : this.group.position.x;
    const oz = Number.isFinite(origin?.z) ? origin.z : this.group.position.z;
    const dx = x - ox;
    const dz = z - oz;
    if (dx === 0 && dz === 0) { this.group.rotation.y = Number.isFinite(fallback) ? fallback : this.group.rotation.y; return this.group.rotation.y; }
    this.group.rotation.y = Math.atan2(dx, dz);
    return this.group.rotation.y;
  }
  damage(amount) {
    if (!Number.isFinite(amount) || amount <= 0 || this.dead || ['hidden','collapsing','fallen'].includes(this.state)) return false;
    const effective = this.role === 'captain' ? amount * 0.72 : amount;
    this.health = Math.max(0, this.health - effective); this.state = 'damaged';
    if (!this.health) this.collapse(); else { const armor = this.parts.find(p => p.cosmetic && !p.dead); if (armor) { armor.dead = true; armor.mesh.visible = false; } }
    return true;
  }
  collapse() {
    if (this.dead || this.state === 'collapsing' || this.state === 'fallen') return false;
    this.state = 'collapsing'; this.health = 0;
    this.parts.forEach((p, i) => { if (!p.dead) { this.system.grains.startDestroy(this, p, i * 0.012); p.dead = p.falling = true; } });
    return true;
  }
  act() { if (this.state !== 'guarding' && this.state !== 'damaged') return false; this.state = 'attacking'; this.attackClock = 0; return true; }
  update(dt, context) {
    this.age += dt;
    if (this.state === 'forming') { if (!this.system.grains.isActive(this)) { this.state = 'exiting'; this.age = 0; this.group.position.copy(this.spawnOffset); this.motionOrigin.copy(this.group.position); this.parts.forEach(p => p.mesh.visible = true); } return; }
    if (this.state === 'exiting') {
      const t = smooth(clamp(this.age / (1.1 + this.index * .12), 0, 1)); this.placeXZ(t); // spawn -> formation lerp, or motion target
      // A LIVE WALK IS ADVANCED HERE, NEVER SNAPPED. `placeXZ` deliberately leaves
      // a walker's X/Z untouched, so this is the single writer of its position
      // during `exiting`: exactly one `speed * dt` step per frame, the same step
      // the guarding/damaged/attacking branches perform. The previous version
      // pinned the walker to its goal here, which teleported it on the first
      // exiting frame (up to ~55 world units in one frame for a distant goal) and
      // left `isWalking` true while it stood still. `advanceWalk` flips `arrived`
      // once the goal is reached, after which no further work happens here.
      this.advanceWalk(dt);
      this.pose(dt, context); if (t >= 1) { this.state = 'guarding'; this.age = 0; } return;
    }
    if (this.state === 'guarding' || this.state === 'damaged') { this.advanceWalk(dt); this.settleXZ(dt, 6); this.pose(dt, context); return; }
    if (this.state === 'attacking') { this.attackClock += dt; this.advanceWalk(dt); this.settleXZ(dt, 5); this.pose(dt, context); if (this.attackClock > 1.35) this.state = 'guarding'; return; }
    if (this.state === 'collapsing') { if (!this.system.grains.isActive(this)) { this.parts.forEach(p => { p.mesh.visible = false; p.falling = false; }); this.state = 'fallen'; this.dead = true; } }
  }
  // One incremental walking step. This is the ONLY place walking maths happens
  // and it delegates the vector arithmetic to the shared, unit-tested
  // `advanceToward`, so overshoot clamping lives in exactly one place.
  //
  // Called EXACTLY ONCE per frame, from the `exiting` branch (for a walk issued
  // mid-build) or from the guarding/damaged/attacking branch. There is no path
  // where a frame advances a walk twice or not at all.
  //
  // RETURN CONTRACT: `true` iff the unit actually moved this frame; `false` when
  // there is no live walk (no `walkState`, or `walkState.arrived`), when the
  // frame's step is not a positive number, or when nothing representable
  // happened. Callers may treat `true` as "position changed by ~speed * dt".
  //
  // Runs BEFORE settleXZ in update(). While the walk is live settleXZ() is a
  // no-op (it defers to this frame's step), and only once `arrived` flips does
  // settleXZ() pin X/Z to the goal - at which point the pinned point IS this
  // frame's position, so the two can never fight.
  advanceWalk(dt) {
    const w = this.walkState;
    if (!w || w.arrived) return false; // no live walk (arrived or snapped)
    const here = { x: this.group.position.x, z: this.group.position.z };
    const goal = { x: w.goalX, z: w.goalZ };
    const travelledDistance = Math.hypot(goal.x - here.x, goal.z - here.z);
    const step = w.speed * dt;
    if (!(step > 0)) {
      // A frame that cannot advance the walk. Two situations reach here, and
      // conflating them was a bug:
      //   - the CALLER gave an unusable dt (zero, negative, NaN): that is a
      //     statement about one frame, so the walk stays live and is retried
      //     next frame. (Consistent with the documented "bad dt: hold".)
      //   - the WALK is unusably slow: `speed * dt` underflows to exactly 0 (a
      //     subnormal speed at a 1/60 s frame, i.e. speed < ~6.7e-322), so no
      //     frame will ever make progress and leaving the walk live would report
      //     `isWalking` forever - the M-1 stall in its underflow form. It ends
      //     HERE, where the unit stands, because settling onto a goal it cannot
      //     reach would be a teleport of up to the whole remaining distance, and
      //     `endWalkInPlace` pulls `motionTarget` back to the position so
      //     `settleXZ` pins the unit where it actually is. `return false` is
      //     accurate: this frame moved nothing.
      //
      //     NOTE the ordering consequence: because `step > 0` is still true, this
      //     branch is NOT reached when speed*dt has merely been SWALLOWED by the
      //     coordinate ULP (speed*dt > 0 but sub-ULP). That stall - what M-1
      //     actually reports for a normal dt, and what the old code never caught -
      //     is handled by the relative guard below. An unusable dt is still
      //     "hold, stay live" in both forms.
      const usableDt = Number.isFinite(dt) && dt > 0;
      const usableSpeed = Number.isFinite(w.speed) && w.speed > 0;
      if (usableDt && usableSpeed && travelledDistance > 0) endWalkInPlace(this, w, here);
      return false;
    }
    // The step to take is `min(step, travelledDistance)`, so the goal is reached
    // exactly and never overshot - `advanceToward` clamps it for us. But the STEP
    // is a scalar the coordinate grid then quantises, and both the arrival test
    // and the stall guard have to be decided on what the frame could actually do,
    // not on what a POSITION round-trips to:
    //   1. `Math.hypot` ROUNDS. `hypot(8 - 4, z)` with z !== 0 returns
    //      4.000000000000001 for the exact distance 4, so comparing a hypot back
    //      against `travelledDistance` loses the exact-arrival signal and a walk
    //      toward a goal on a different z-lane would never record `arrived`.
    //   2. `here + delta` rounds straight back to `here` when `|delta|` is below
    //      the coordinate ULP, so `next - here` is EXACTLY 0 for a sub-ULP step -
    //      which is precisely the information a stall guard needs, and precisely
    //      what "arrived because next === goal === here" used to destroy (the M-1
    //      stall: `isWalking` stayed true for ever while the unit stood still).
    // `stepDistance` is the arithmetic step; `travelled` is what the coordinate
    // grid actually granted (`next - here`), so it is 0 iff the ULP ate the step.
    const stepDistance = Math.min(step, travelledDistance);
    const next = advanceToward(here, goal, step);
    const travelled = Math.hypot(next.x - here.x, next.z - here.z);
    // The direction actually traversed this frame (next - here) is what the unit
    // faces - never the absolute line to the goal, which would flip the unit
    // ~180 degrees once it steps across the goal's z-lane. `advanceToward`
    // normalises `(goal - here)`, so a pure +/-Z bearing makes BOTH deltas
    // non-zero and a pure +/-X bearing makes `dz` non-zero; the fallback is
    // therefore reached only when a frame moved nothing at all.
    let dx = next.x - here.x;
    let dz = next.z - here.z;
    // STALL GUARD. `stepDistance < travelledDistance` keeps this off the arrival
    // frame, where the step was clamped to the gap - that is the goal being
    // reached, not a stall, so a zero-distance walk still completes normally.
    // Both conditions below END the walk where the unit stands; it is not snapped
    // to the goal, which would be a teleport of up to the whole remaining distance
    // (and is why `endWalkInPlace` writes the CURRENT position as motionTarget).
    //   - `travelled === 0`: the ULP swallowed the step, so the coordinate is
    //     frozen for ever. EXACT, no threshold (see the MAX_WALK_FRAMES note).
    //   - `travelledDistance > stepDistance * MAX_WALK_FRAMES`: the step is real
    //     but the leg cannot be covered in the frame budget, so the walk is given
    //     up rather than reported as in progress for ever.
    if (stepDistance < travelledDistance
      && (travelled === 0 || travelledDistance > stepDistance * MAX_WALK_FRAMES)) {
      endWalkInPlace(this, w, here);
      // It is left exactly where it was, and it moved nothing usable this frame.
      // `dx`/`dz` stay zero so the facing step below keeps the current bearing
      // rather than aiming at a phantom point; the position is NOT written, so the
      // unit cannot drift even by a rounding error.
      return false;
    }
    const moved = next.x !== here.x || next.z !== here.z;
    this.group.position.x = next.x; this.group.position.z = next.z;
    // Facing comes from the traversed vector whenever there IS one. A clamped
    // arrival step (next lands exactly on the goal, here is a sub-step behind)
    // still has a non-zero (dx, dz), and facing it reproduces the bearing the
    // unit was already travelling on - which is why the arrival frame must NOT be
    // detected by `next === goal`. The only genuinely directionless case is a
    // step that moved nothing at all, and the stored hint (the bearing it last
    // travelled on, or the faction forward) covers it.
    if (dx === 0 && dz === 0) {
      this.faceTowards(next.x, next.z, this.facingHint);
    } else {
      this.faceTowards(next.x, next.z, this.facingHint, here);
    }
    // Arrival is decided by the STEP, not by comparing `next` to the goal. `next`
    // is `here + direction * stepDistance`, while the goal is the caller's own
    // coordinates; for a pure-axis leg those can differ in the last bit even when
    // the step was clamped to the whole gap. `stepDistance` reaching the gap means
    // the step WAS clamped to it, which is the goal being reached.
    if (!(stepDistance < travelledDistance)) { w.arrived = true; w.speed = 0; }
    // `true` means "this frame moved the unit"; `false` means it did not. That is
    // decided by the COORDINATES the walker actually ends on, not by `dx`/`dz`: a
    // step below the coordinate ULP leaves `next` bit-for-bit on `here` even though
    // `dx` is non-zero, and a unit that did not move must not report that it did
    // (the I-3 contract; advanceWalk can be, and is, called directly to check it).
    // `travelled === 0` cannot reach here (the stall guard above would have
    // returned), so `moved` and `travelled` agree; `moved` is used because it is
    // the precise, coordinate-level form of the question.
    return moved;
  }
  // X/Z placement during 'exiting'. Without a motion target this is the original
  // spawn -> formationOffset lerp, and a snapped unit (moveTo, no live walk)
  // still lerps toward its motion target.
  //
  // A LIVE WALKER IS NOT TOUCHED HERE. It must travel at exactly `speed * dt`
  // per frame, so its X/Z belong to `advanceWalk` and to nothing else; pinning it
  // to the goal here (as an earlier revision did) teleported it to the
  // destination on the first exiting frame. The `exiting` branch of update()
  // calls `advanceWalk(dt)` for exactly this reason. Once the walk has arrived
  // this method returns too, and `settleXZ` holds the goal instead.
  placeXZ(t) {
    const w = this.walkState;
    if (w && !w.arrived) return; // live walk owns X/Z; advanced once by update()
    if (this.externalPosition && this.motionTarget) {
      this.group.position.lerpVectors(this.motionOrigin, new T.Vector3(this.motionTarget.x, this.motionOrigin.y, this.motionTarget.z), t);
      return;
    }
    this.group.position.lerpVectors(this.motionOrigin, this.formationOffset, t);
  }
  // X/Z settling for the guarding/damaged/attacking states.
  //
  // The external-position gate is what stops the formation pull; but while a
  // WALK is live, advanceWalk() has already written this frame's position and it
  // must not be overwritten by the goal. Pinning to the goal here would teleport
  // the unit on the very first step (the exact bug this task fixes), so a walker
  // is left exactly as advanceWalk() placed it. Once the walk has arrived,
  // advanceWalk() is a no-op and pinning to motionTarget (=== the goal) is what
  // holds the unit there for good.
  settleXZ(dt, rate) {
    if (this.externalPosition) {
      const w = this.walkState;
      if (w && !w.arrived) return; // live walk owns X/Z this frame
      if (this.motionTarget) { this.group.position.x = this.motionTarget.x; this.group.position.z = this.motionTarget.z; }
      return;
    }
    this.group.position.lerp(this.formationOffset, 1 - Math.exp(-dt * rate));
  }
  pose(dt, context) {
    const phase = this.age * (this.role === 'gargoyle' ? 3.5 : 2.2) + this.index;
    if (this.horseHead) this.horseHead.rotation.x = Math.sin(phase) * .08;
    if (this.legs) this.legs.forEach((leg, i) => leg.rotation.x = Math.sin(phase + i * Math.PI) * .12);
    if (this.wings) this.wings.forEach((wing, i) => wing.rotation.z = (i ? -1 : 1) * (.25 + Math.sin(phase * 2) * .22));
    const strike = this.state === 'attacking' ? Math.sin(Math.PI * clamp((this.attackClock-this.index*.06)/1.0,0,1)) : 0;
    if (this.swordArm) this.swordArm.rotation.x = -.3 - strike * (this.role === 'captain' ? 2.4 : 1.8);
    // Attack lunge is a Z nudge on top of the unit's own Z. When the motion layer
    // owns X/Z the nudge is skipped so it cannot fight the walk target, but the
    // arm swing above still plays.
    if (this.state === 'attacking' && !this.externalPosition) this.group.position.z += strike * dt * 2;
    if (this.role === 'gargoyle') {
      // Y hover/pitch is pure animation and always runs. The X drift is an
      // unbounded wander that would corrupt an external walk, so it is skipped
      // once the motion layer owns X/Z.
      this.group.position.y = this.formationOffset.y + Math.sin(phase) * .12 - strike * .7;
      if (!this.externalPosition) this.group.position.x += Math.sin(phase*.6) * dt * (context?.formationRadius ?? this.formationRadius) * .25;
      this.group.rotation.x = strike * .45;
    }
  }
  getMeshes() { return this.parts.filter(p => p.mesh.visible && !p.dead).map(p => p.mesh); }
  dispose() {
    this.system.grains.unregisterOwner(this);
    this.group.parent?.remove(this.group);
    this.parts.forEach(p => p.mesh.geometry.dispose());
    // A disposed unit is not walking: drop the walk so `isWalking` does not keep
    // reporting true (and holding `motionTarget`) for a unit that no longer
    // exists on screen.
    this.walkState = null; this.motionTarget = null;
    // `externalPosition` is intentionally left as-is: a dispose is not a rebuild,
    // and the build state machine (build()) is what owns restoring that flag.
  }
}

export { SandUnit };





