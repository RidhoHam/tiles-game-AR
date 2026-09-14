// Role/range battle domain. Pure logic: no Three.js, no DOM, no tracking.
// A BattleField owns the units of one battle and answers three questions for
// the battle system: who can I attack, can I hit them yet, and where do I walk
// when nothing is in reach.
import { FACTIONS, UNIT_DEFINITIONS } from './unit-definitions.js';

/** Direction a faction advances when the field is empty of valid targets. */
const ADVANCE_DIRECTION = Object.freeze({ blue: 1, red: -1 });
const DEFAULT_FACTION = 'blue';

// A base is a building, not a walker. Enemies stop this far in front of a base
// instead of walking inside it; because a base never moves, this is what stops
// an attacker from closing the same gap forever.
export const BASE_STANDOFF = 0.6;
// An attacker satisfied with its left/right overlap will not step further off
// its lane, which keeps a lane-misaligned melee lane from overshooting its
// target row.
const AXIS_EPSILON = 0.05;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

function sign(value) {
  if (value > 0) return 1;
  if (value < 0) return -1;
  return 0;
}

/** A unit is alive when it is not explicitly marked dead. */
function isAlive(unit) {
  return Boolean(unit) && unit.alive !== false;
}

/**
 * BattleField holds one battle's units keyed by id.
 *
 * `state` may be `{ units: [...] }` (array of unit records) or a `Map` of
 * id -> unit. Units keep their identity: the record passed in is the record
 * stored, so mutating `unit.position.x` is visible to the caller.
 */
export class BattleField {
  constructor(state) {
    this.units = new Map();

    const source = this.#extractUnits(state);
    for (const entry of source) {
      const [key, value] = entry;
      const unit = this.#normalizeUnit(value, key);
      if (unit) this.units.set(unit.id, unit);
    }
  }

  /** Accept `{ units }`, a raw array, or a Map; anything else yields nothing. */
  #extractUnits(state) {
    if (state instanceof Map) return [...state.entries()];
    if (Array.isArray(state)) return state.map(unit => [undefined, unit]);
    const units = state?.units;
    if (units instanceof Map) return [...units.entries()];
    if (Array.isArray(units)) return units.map(unit => [undefined, unit]);
    return [];
  }

  /**
   * Coerce an input record into a well-formed unit. Unknown unit types and
   * malformed positions are dropped rather than allowed to corrupt the field.
   */
  #normalizeUnit(raw, key) {
    if (!raw || typeof raw !== 'object') return null;
    const type = raw.type;
    const definition = UNIT_DEFINITIONS[type];
    if (!definition) return null;

    const id = raw.id ?? (typeof key === 'string' ? key : null);
    if (typeof id !== 'string' || id.length === 0) return null;

    const position = raw.position;
    if (!position || !isFiniteNumber(position.x) || !isFiniteNumber(position.z)) return null;

    const faction = FACTIONS.includes(raw.faction) ? raw.faction : DEFAULT_FACTION;
    const maxHealth = isFiniteNumber(raw.maxHealth) ? raw.maxHealth : definition.maxHealth;
    const health = isFiniteNumber(raw.health) ? raw.health : maxHealth;
    const cooldown = isFiniteNumber(raw.cooldown) ? Math.max(0, raw.cooldown) : 0;

    return {
      id,
      type,
      faction,
      role: definition.role,
      health,
      maxHealth,
      cooldown,
      position: { x: position.x, z: position.z },
      targetId: typeof raw.targetId === 'string' ? raw.targetId : null,
      alive: raw.alive !== false
    };
  }

  /** Euclidean distance on the arena x/z plane, or null for invalid input. */
  distance(unitA, unitB) {
    if (!this.#hasPosition(unitA) || !this.#hasPosition(unitB)) return null;
    const dx = unitA.position.x - unitB.position.x;
    const dz = unitA.position.z - unitB.position.z;
    return Math.hypot(dx, dz);
  }

  /**
   * The enemy base of the faction opposing `unit`. This is the fallback
   * objective when no enemy unit is worth walking to.
   */
  baseTargetFor(unit) {
    if (!unit) return null;
    for (const candidate of this.units.values()) {
      if (!isAlive(candidate) || candidate.faction === unit.faction) continue;
      if (candidate.role === 'base') return candidate;
    }
    return null;
  }

  /** True when `unit` has a known type with a positive attack range. */
  #canFight(unit) {
    const definition = this.#definitionFor(unit);
    if (!definition) return false;
    return definition.damage > 0 && definition.range > 0;
  }

  /** True when the target is a living enemy inside the attacker's range. */
  isInRange(unit, target) {
    if (!isAlive(unit) || !isAlive(target)) return false;
    if (unit.id === target.id) return false;
    if (unit.faction === target.faction) return false;
    if (!this.#canFight(unit)) return false;
    const range = this.#definitionFor(unit).range;
    const gap = this.distance(unit, target);
    if (gap === null) return false;
    return gap <= range;
  }

  /** Alias kept so callers can read either name. */
  canAttack(unit, target) {
    return this.isInRange(unit, target);
  }

  /**
   * Nearest living enemy inside the attacker's range, ties broken by id so the
   * same board always produces the same fight. Returns null when nothing in
   * range is attackable (including for dead units and bases).
   */
  targetFor(unit) {
    if (!isAlive(unit) || !this.#canFight(unit)) return null;

    let best = null;
    let bestDistance = Infinity;
    for (const candidate of this.units.values()) {
      if (!isAlive(candidate) || candidate.faction === unit.faction) continue;
      if (!this.isInRange(unit, candidate)) continue;
      const gap = this.distance(unit, candidate);
      if (gap < bestDistance || (gap === bestDistance && best && candidate.id < best.id)) {
        best = candidate;
        bestDistance = gap;
      }
    }
    return best;
  }

  /**
   * Walk one unit one step toward the objective it would move to when nothing
   * is in range, along a single normalised 2D displacement, so a unit on a
   * different z lane closes the z gap while it closes the x gap.
   *
   * Objective: the enemy base in x, on the lane of the nearest living enemy in
   * z, falling back to the base lane when no enemy is alive. Because the base
   * x is always on the enemy side, the dominant step direction is always
   * correct (blue +x, red -x) and a unit can never march away from the fight.
   *
   * The step never overshoots, never leaves the unit short at a distance the
   * clamped variant would reach (so movement is a deterministic function of
   * elapsed time, not of how `dt` was sliced), and stops short of a base by
   * BASE_STANDOFF. Bases (speed 0) never move.
   *
   * Returns true when the unit actually moved.
   */
  advance(unit, dt) {
    if (!isAlive(unit)) return false;
    if (!isFiniteNumber(dt) || dt <= 0) return false;
    if (!this.#hasPosition(unit)) return false;

    const definition = this.#definitionFor(unit);
    if (!definition || definition.speed <= 0) return false;

    const direction = ADVANCE_DIRECTION[unit.faction] ?? 0;
    if (direction === 0) return false;

    const destination = this.objectiveFor(unit);
    if (!destination) return false;

    const step = definition.speed * dt;
    if (!Number.isFinite(step) || step <= 0) return false;

    const dx = destination.x - unit.position.x;
    const dz = destination.z - unit.position.z;
    const gap = Math.hypot(dx, dz);
    if (gap === 0) return false;

    const ux = dx / gap;
    const uz = dz / gap;

    // Preferred move, then clamped if it would overshoot or hit standoff.
    let nextX = unit.position.x + ux * step;
    let nextZ = unit.position.z + uz * step;
    if (destination.standoff && gap - step < BASE_STANDOFF) {
      const shorten = Math.max(0, gap - BASE_STANDOFF);
      nextX = unit.position.x + ux * shorten;
      nextZ = unit.position.z + uz * shorten;
    } else if (!destination.standoff && step >= gap) {
      nextX = destination.x;
      nextZ = destination.z;
    }

    if (!isFiniteNumber(nextX) || !isFiniteNumber(nextZ)) return false;
    if (nextX === unit.position.x && nextZ === unit.position.z) return false;

    unit.position.x = nextX;
    unit.position.z = nextZ;
    return true;
  }

  /**
   * The point this unit walks toward when it has no target in range:
   * Finds the nearest living enemy in 2D Euclidean distance. If that target
   * is a base, requests standoff so the unit halts outside it.
   */
  objectiveFor(unit) {
    if (!isAlive(unit)) return null;

    let best = null;
    let bestDistance = Infinity;

    for (const candidate of this.units.values()) {
      if (!isAlive(candidate) || candidate.faction === unit.faction) continue;
      const gap = this.distance(unit, candidate);
      if (gap === null) continue;
      if (gap < bestDistance || (gap === bestDistance && best && candidate.id < best.id)) {
        best = candidate;
        bestDistance = gap;
      }
    }

    if (!best) return null;

    return {
      x: best.position.x,
      z: best.position.z,
      standoff: best.role === 'base',
      unit: best.role === 'base' ? null : best,
      target: best
    };
  }

  #definitionFor(unit) {
    return unit ? UNIT_DEFINITIONS[unit.type] ?? null : null;
  }

  #hasPosition(unit) {
    return Boolean(unit) && Boolean(unit.position) &&
      isFiniteNumber(unit.position.x) && isFiniteNumber(unit.position.z);
  }
}

export default BattleField;