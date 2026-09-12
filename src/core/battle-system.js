// Role/range battle model. There is no summon and no reinforcement: each unit
// walks until an enemy is in range, then trades hits until one base falls.
import { FACTIONS, UNIT_DEFINITIONS } from './unit-definitions.js';
import { BattleField } from './battle-field.js';

export { UNIT_DEFINITIONS, FACTIONS } from './unit-definitions.js';
export { BattleField } from './battle-field.js';

// Simulation is advanced on a fixed timestep, not on the caller's frame time.
// The battle is therefore the same battle whether the caller slices elapsed
// time as 1/30 s or 1/240 s: same winner, same attack count, same duration.
// Frame time is clamped so a stalled tab cannot fast-forward the battle, and a
// single call never runs more than MAX_SUBSTEPS fixed steps.
export const FIXED_STEP = 1 / 120;
export const MAX_FRAME_TIME = 0.25;
const MAX_SUBSTEPS = 64;
// Firing tolerance. A cooldown that is a hair above zero still counts as ready,
// which removes the last float remainder so 1/30 and 1/240 fire identically.
const COOLDOWN_EPSILON = 1e-6;

function isFiniteNumber(value) {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * Deterministic role/range battle.
 *
 * `configure({ units })` takes calibrated unit records shaped
 * `{ id, type, faction, role, health, maxHealth, cooldown, position, targetId, alive }`,
 * stores them in a BattleField and resets the clock. `update(dt)` advances the
 * simulation on a fixed timestep; each step, for every living attacker, it
 * recharges the weapon and either attacks an in-range enemy or walks one step
 * toward its objective.
 */
export class BattleSystem {
  #accumulator = 0;

  constructor({ onEvent } = {}) {
    this.onEvent = onEvent || (() => {});
    this.reset();
  }

  reset() {
    this.time = 0;
    this.state = 'setup';
    this.units = new Map();
    this.field = null;
    this.events = [];
    this.winner = null;
    this.valid = false;
    this.#accumulator = 0;
  }

  /**
   * Accept `{ units: [...] }` or a bare array. Returns
   * `{ valid, count, fighters }`; a configuration is reported as valid only
   * when both factions can still end the battle, so callers never start an
   * unwinnable or endless fight.
   */
  configure({ units } = {}) {
    const list = this.#unitList(units);
    this.reset();
    this.field = new BattleField({ units: list });
    this.units = this.field.units;
    this.state = 'ready';
    const fighters = [...this.units.values()].filter(unit => this.#canFight(unit) && unit.alive);
    const blue = fighters.filter(unit => unit.faction === 'blue').length;
    const red = fighters.filter(unit => unit.faction === 'red').length;
    this.valid = blue > 0 && red > 0;
    return { valid: this.valid, count: this.units.size, fighters: fighters.length };
  }

  #unitList(units) {
    if (units instanceof Map) return [...units.values()];
    if (Array.isArray(units)) return units;
    return [];
  }

  /**
   * Enter the running state. Refuses when the configuration was invalid, when
   * there are no opposing units able to end the battle, or when both bases are
   * already gone. A refused start leaves the system in `ready`.
   */
  start() {
    if (this.state !== 'ready') return false;
    if (!this.valid) return false;
    if (!this.#canEndBattle()) return false;
    this.state = 'running';
    this.#emit('battle-start');
    return true;
  }

  /** True when both sides still have a base and at least one attacker. */
  #canEndBattle() {
    for (const faction of FACTIONS) {
      if (!this.#baseAlive(faction)) return false;
      const attackers = [...this.units.values()].filter(unit =>
        unit.alive && unit.faction === faction && this.#canFight(unit));
      if (attackers.length === 0) return false;
    }
    return true;
  }

  damage(unitId, amount, reason = 'damage') {
    const unit = this.units.get(unitId);
    if (!unit?.alive || !isFiniteNumber(amount) || amount <= 0) return false;
    unit.health = Math.max(0, unit.health - amount);
    if (unit.health === 0) this.#destroy(unit, reason);
    this.#checkWinner();
    return true;
  }

  update(dt) {
    if (this.state !== 'running') return;

    const frame = Math.min(isFiniteNumber(dt) ? Math.max(dt, 0) : 0, MAX_FRAME_TIME);
    this.#accumulator += frame;
    let steps = 0;
    while (this.#accumulator >= FIXED_STEP && steps < MAX_SUBSTEPS) {
      this.#accumulator -= FIXED_STEP;
      steps += 1;
      this.time += FIXED_STEP;
      this.#step(FIXED_STEP);
      if (this.state !== 'running') return;
    }
  }

  /** One fixed simulation step for the whole board, in insertion order. */
  #step(step) {
    for (const unit of [...this.units.values()]) {
      if (this.state !== 'running') return;
      if (!unit.alive) continue;

      // The weapon always recharges, even when no target is in range, so a unit
      // is ready the instant an enemy walks into range.
      unit.cooldown = Math.max(0, unit.cooldown - step);
      if (!this.#canFight(unit)) continue;

      const definition = UNIT_DEFINITIONS[unit.type];
      const target = this.field.targetFor(unit);

      if (target && unit.cooldown <= COOLDOWN_EPSILON) {
        unit.targetId = target.id;
        unit.cooldown = this.#attackInterval(definition);
        this.#emit('attack', { unitId: unit.id, targetId: target.id, damage: definition.damage });
        target.health = Math.max(0, target.health - definition.damage);
        this.#emit('impact', { unitId: unit.id, targetId: target.id, damage: definition.damage, health: target.health });
        if (target.health === 0) this.#destroy(target, 'damage');
        this.#checkWinner();
        continue;
      }

      if (!target) {
        unit.targetId = null;
        const beforeX = unit.position.x;
        const beforeZ = unit.position.z;
        const moved = this.field.advance(unit, step);
        if (moved && (unit.position.x !== beforeX || unit.position.z !== beforeZ)) {
          this.#emit('move', { unitId: unit.id, x: unit.position.x, z: unit.position.z });
        }
      }
    }
  }

  /** Seconds between attacks, from the definition, defaulting sensibly. */
  #attackInterval(definition) {
    const interval = definition.attackInterval;
    return isFiniteNumber(interval) && interval > 0 ? interval : FIXED_STEP;
  }

  snapshot() {
    return {
      state: this.state,
      time: this.time,
      winner: this.winner,
      units: [...this.units.values()].map(unit => ({
        ...unit,
        position: { ...unit.position }
      }))
    };
  }

  /** Base health per faction, or 0 when that base has been destroyed. */
  baseHealth() {
    const health = { blue: null, red: null };
    for (const unit of this.units.values()) {
      if (UNIT_DEFINITIONS[unit.type].role !== 'base') continue;
      health[unit.faction] = unit.alive ? unit.health : 0;
    }
    return health;
  }

  /** Display title for a unit id, or null when the unit is unknown. */
  unitTitle(unitId) {
    const unit = this.units.get(unitId);
    return unit ? UNIT_DEFINITIONS[unit.type].title : null;
  }

  #canFight(unit) {
    const definition = UNIT_DEFINITIONS[unit?.type];
    return Boolean(definition) && definition.damage > 0 && definition.range > 0;
  }

  #destroy(unit, reason) {
    if (!unit.alive) return;
    unit.alive = false;
    unit.targetId = null;
    this.#emit('destroy', { unitId: unit.id, reason });
  }

  #baseAlive(faction) {
    return [...this.units.values()].some(unit =>
      unit.faction === faction && UNIT_DEFINITIONS[unit.type].role === 'base' && unit.alive);
  }

  #checkWinner() {
    for (const faction of FACTIONS) {
      if (!this.#baseAlive(faction)) {
        this.winner = faction === 'blue' ? 'red' : 'blue';
        this.state = 'finished';
        this.#emit('victory', { winner: this.winner });
        return;
      }
    }
  }

  #emit(type, payload = {}) {
    const event = { type, time: this.time, ...payload };
    this.events.push(event);
    this.onEvent(event);
  }
}

export default BattleSystem;