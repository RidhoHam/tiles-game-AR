export const ROLES = Object.freeze(['base', 'artileri', 'prajurit']);
export const FACTIONS = Object.freeze(['blue', 'red']);

// `attackInterval` is the number of SIMULATED seconds a unit must wait between
// two attacks. It is independent of the render frame rate: the battle system
// accumulates elapsed time and fires when the accumulator reaches the interval,
// so the same lineup produces the same winner and duration at 30 fps or 240 fps.
// Values are tuned so a typical 6-unit match lasts roughly 20-25 simulated
// seconds (see task-2-report.md). HP and damage are unchanged from Task 1.
export const UNIT_DEFINITIONS = Object.freeze({
  benteng: { role: 'base', title: 'Benteng Pasir', maxHealth: 200, damage: 0, range: 0, speed: 0, attackInterval: 0 },
  bunker: { role: 'base', title: 'Bunker Berduri', maxHealth: 200, damage: 0, range: 0, speed: 0, attackInterval: 0 },
  robot: { role: 'artileri', title: 'Robot Pasir', maxHealth: 120, damage: 16, range: 3.2, speed: 1.1, attackInterval: 0.9 },
  tank: { role: 'artileri', title: 'Tank Pasir', maxHealth: 100, damage: 20, range: 3.8, speed: 0.9, attackInterval: 1.2 },
  kesatria: { role: 'prajurit', title: 'Kesatria Pasir', maxHealth: 70, damage: 14, range: 1.1, speed: 2.2, attackInterval: 0.8 },
  gargoyle: { role: 'prajurit', title: 'Gargoyle Pasir', maxHealth: 60, damage: 12, range: 1.4, speed: 2.6, attackInterval: 0.7 }
});

export const CARD_TO_TYPE = Object.freeze({
  benteng: 'benteng', bunker: 'bunker', robot: 'robot',
  tank: 'tank', kesatria: 'kesatria', gargoyle: 'gargoyle'
});

export const CARD_IDS = Object.freeze(Object.keys(CARD_TO_TYPE));