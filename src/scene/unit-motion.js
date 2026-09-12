// Motion-layer vocabulary for units walking on the arena plane.
//
// This vocabulary is deliberately SEPARATE from SandUnit's internal build state
// machine ('hidden' | 'forming' | 'exiting' | 'guarding' | 'attacking' |
// 'damaged' | 'collapsing' | 'fallen'). SandUnit owns how a model *materialises*;
// this module owns where a unit *is* and what it is doing tactically. Keeping the
// two apart is what lets the motion layer drive X/Z without the build animation
// fighting it back toward the formation slot.
//
// Dependency-free on purpose so it runs under plain `node --test`.

export const MOTION_STATES = Object.freeze([
  'hidden',
  'spawning',
  'walking',
  'attacking',
  'hit',
  'collapsing',
  'dead'
]);

const STATE_SET = new Set(MOTION_STATES);

// Transition table: TRANSITIONS[state][event] = nextState.
//
// Required by the plan (must never regress):
//   hidden    + spawn      -> spawning
//   spawning  + ready      -> walking
//   walking   + inRange    -> attacking
//   attacking + outOfRange -> walking
//   attacking + damaged    -> hit
//   hit       + recovered  -> attacking
//   walking   + killed     -> collapsing
//   collapsing+ settled    -> dead
//
// Additional transitions (chosen so they read naturally and so the required
// eight above are untouched; each is reachable only from a *different* source
// state or event than the required ones, except where noted):
//   hidden    + killed     -> dead        (never spawned; jumps straight to dead)
//   spawning  + killed     -> collapsing  (cut down mid-materialise)
//   walking   + damaged    -> hit         (shot while walking, not only while attacking)
//   attacking + killed     -> collapsing  (destroyed mid-swing instead of via outOfRange)
//   hit       + killed     -> collapsing  (destroyed while reeling)
//   hit       + recovered  -> attacking   (required)
//   collapsing+ settled    -> dead        (required)
//   dead      + respawn    -> hidden      (allows a round to be reset)
//   dead      + *          -> dead        (terminal; anything else is ignored)
//
// Note the two additions that share a source state with a required transition
// (walking+damaged, attacking+killed) use a distinct *event*, so the required
// (state, event) pairs still resolve exactly as the plan asserts.
const TRANSITIONS = Object.freeze({
  hidden: Object.freeze({ spawn: 'spawning', killed: 'dead' }),
  spawning: Object.freeze({ ready: 'walking', killed: 'collapsing' }),
  walking: Object.freeze({ inRange: 'attacking', killed: 'collapsing', damaged: 'hit' }),
  attacking: Object.freeze({ outOfRange: 'walking', damaged: 'hit', killed: 'collapsing' }),
  hit: Object.freeze({ recovered: 'attacking', killed: 'collapsing' }),
  collapsing: Object.freeze({ settled: 'dead' }),
  dead: Object.freeze({ respawn: 'hidden' })
});

/**
 * Pure transition function. Returns the next motion state, or the current state
 * unchanged when the (state, event) pair is unrecognised. Never throws and never
 * returns undefined - even for null/undefined/garbage input.
 *
 * @param {string} current
 * @param {string} event
 * @returns {string}
 */
export function nextMotionState(current, event) {
  if (!STATE_SET.has(current)) return STATE_SET.has(current) ? current : 'hidden';
  const table = TRANSITIONS[current];
  const next = table ? table[event] : undefined;
  return STATE_SET.has(next) ? next : current;
}

/**
 * Move `from` toward `to` by at most `distance` along the normalised 2D vector,
 * clamping at the destination so the result never overshoots.
 *
 * Robustness: zero / negative / non-finite `distance` yields the source point;
 * missing or non-finite coordinates are treated as the source coordinate; a
 * zero-length direction (to === from) yields the source point. The result is
 * always finite and `from` is never mutated.
 *
 * @param {{x:number,z:number}} from
 * @param {{x:number,z:number}} to
 * @param {number} distance
 * @returns {{x:number,z:number}} a new point
 */
export function advanceToward(from, to, distance) {
  const fromX = Number.isFinite(from?.x) ? from.x : 0;
  const fromZ = Number.isFinite(from?.z) ? from.z : 0;
  const toX = Number.isFinite(to?.x) ? to.x : fromX;
  const toZ = Number.isFinite(to?.z) ? to.z : fromZ;
  const step = Number.isFinite(distance) ? Math.max(0, distance) : 0;

  const dx = toX - fromX;
  const dz = toZ - fromZ;
  const length = Math.hypot(dx, dz);

  // Already there, or no usable step: return the (finite) source point.
  if (!(length > 0) || step <= 0) return { x: fromX, z: fromZ };

  const travel = Math.min(step, length);
  const x = fromX + (dx / length) * travel;
  const z = fromZ + (dz / length) * travel;
  // Guard the arithmetic: a finite input can still produce a non-finite result
  // if a caller passes e.g. a huge distance against a huge coordinate.
  return { x: Number.isFinite(x) ? x : fromX, z: Number.isFinite(z) ? z : fromZ };
}
