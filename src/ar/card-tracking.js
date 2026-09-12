import { UNIT_DEFINITIONS } from '../core/unit-definitions.js';
import { CARD_TARGETS } from './card-targets.js';

// A detection is only usable once every component is a real number. Task 2's
// review showed that a single NaN leaks into the arena fit and destroys every
// downstream position, so malformed poses are dropped rather than repaired.
function isFinitePosition(position) {
  return Array.isArray(position)
    && position.length === 3
    && position.every(value => typeof value === 'number' && Number.isFinite(value));
}

// A pose is a 16-element column-major matrix of finite numbers. Anything else
// (undefined from callers that don't track a pose) is stored as null.
function isPose(pose) {
  return Array.isArray(pose)
    && pose.length === 16
    && pose.every(value => typeof value === 'number' && Number.isFinite(value));
}

function isValidTargetIndex(targetIndex) {
  return Number.isInteger(targetIndex) && targetIndex >= 0 && targetIndex < CARD_TARGETS.length;
}

/**
 * Collects the currently visible cards from raw MindAR detection results.
 *
 * MindAR reports every visible target on every frame, so the output is an array
 * of the cards visible *now* rather than a diff. The order always follows
 * `CARD_TARGETS` (and therefore `targetIndex`), never the input order, so the
 * result is deterministic for the same set of visible cards. Unknown,
 * `pose` (the anchor's column-major matrix) is passed through when present.
 * malformed positions are ignored without throwing.
 */
export function normalizeDetections(rawList) {
  const byCardId = new Map();
  if (Array.isArray(rawList)) {
    for (const raw of rawList) {
      if (!raw || typeof raw !== 'object') continue;
      const targetIndex = raw.targetIndex;
      if (!isValidTargetIndex(targetIndex)) continue;
      if (!isFinitePosition(raw.worldPosition)) continue;
      const target = CARD_TARGETS[targetIndex];
      const role = UNIT_DEFINITIONS[target.type]?.role ?? null;
      byCardId.set(target.cardId, {
        cardId: target.cardId,
        type: target.type,
        role,
        worldPosition: [...raw.worldPosition],
        // MindAR's group.matrix.elements: 16 numbers, column-major. It is
        // the only valid pose source because matrixAutoUpdate is false.
        pose: isPose(raw.pose) ? [...raw.pose] : null
      });
    }
  }
  return CARD_TARGETS.map(target => byCardId.get(target.cardId)).filter(Boolean);
}

/** Describes a card id without needing a live detection: `{ cardId, type, role }`. */
export function describeCard(cardId) {
  const target = CARD_TARGETS.find(card => card.cardId === cardId);
  if (!target) return null;
  return { cardId: target.cardId, type: target.type, role: UNIT_DEFINITIONS[target.type]?.role ?? null };
}
