// Compatibility shim for the legacy roster/summons model. Task 2 replaces this
// module; for now it only keeps the old type keys working against the new
// role vocabulary so the existing modules and tests stay importable.
import { FACTIONS, UNIT_DEFINITIONS } from './unit-definitions.js';

export function validateFormation(slots) {
  const errors = [];
  const byFaction = Object.fromEntries(FACTIONS.map(faction => [faction, []]));
  for (const slot of slots || []) {
    if (!slot || !FACTIONS.includes(slot.faction) || !UNIT_DEFINITIONS[slot.type]) {
      errors.push('Slot unit tidak valid.');
      continue;
    }
    const definition = UNIT_DEFINITIONS[slot.type];
    if (definition.role === 'prajurit') {
      errors.push('Kesatria dan Gargoyle hanya dipanggil saat battle.');
      continue;
    }
    byFaction[slot.faction].push(slot.type);
  }
  for (const faction of FACTIONS) {
    const types = byFaction[faction];
    if (types.length !== 2) errors.push(`Tim ${faction} membutuhkan dua unit awal.`);
    const roles = types.map(type => UNIT_DEFINITIONS[type].role);
    const bases = roles.filter(role => role === 'base').length;
    const machines = roles.filter(role => role === 'artileri').length;
    if (bases !== 1 || machines !== 1) errors.push(`Tim ${faction} membutuhkan satu Base dan satu War Machine.`);
  }
  return { valid: errors.length === 0, errors, byFaction };
}

export function formationSeed(slots) {
  return (slots || []).map(slot => `${slot.faction}:${slot.type}:${slot.slot || ''}`).sort().join('|');
}

