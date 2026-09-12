import { FACTIONS, ROLES, UNIT_DEFINITIONS } from './unit-definitions.js';

export const ROLE_REQUIREMENTS = Object.freeze({ base: 1, artileri: 1, prajurit: 1 });

export function classifySide(x, centerX = 0) {
  if (!Number.isFinite(x)) return null;
  if (x < centerX) return 'blue';
  if (x > centerX) return 'red';
  return null;
}

export function validateTeams(cards) {
  const errors = [];
  const bySide = { blue: [], red: [] };
  const seen = new Set();

  for (const card of cards || []) {
    const type = card?.type ?? null;
    const definition = UNIT_DEFINITIONS[type];
    if (!definition) { errors.push('Kartu tidak dikenal.'); continue; }
    if (!card.cardId) { errors.push('Kartu tidak memiliki identitas.'); continue; }
    if (seen.has(card.cardId)) { errors.push(`Kartu ${definition.title} terdeteksi dua kali.`); continue; }
    const side = classifySide(card.x, card.centerX ?? 0);
    if (!side) { errors.push(`Kartu ${definition.title} berada tepat di garis tengah.`); continue; }
    seen.add(card.cardId);
    bySide[side].push({ ...card, role: definition.role });
  }

  for (const faction of FACTIONS) {
    const label = faction === 'blue' ? 'Biru' : 'Merah';
    const list = bySide[faction];
    if (list.length !== 3) errors.push(`Tim ${label} membutuhkan tepat tiga kartu.`);
    for (const role of ROLES) {
      const count = list.filter(card => card.role === role).length;
      if (count !== ROLE_REQUIREMENTS[role]) {
        errors.push(`Tim ${label} membutuhkan tepat ${ROLE_REQUIREMENTS[role]} ${role}.`);
      }
    }
  }
  return { valid: errors.length === 0, errors, bySide };
}
