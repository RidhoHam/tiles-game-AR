import { classifySide } from './team-composition.js';

export const DEFAULT_ARENA = Object.freeze({ halfWidth: 6, halfDepth: 4, cardScale: 0.32 });

// Arena scale maps the physical card spread (metres along X) onto a world-space
// multiplier for the spawned scene. A table-top spread is realistically ~0.05 m
// (cards nearly touching) up to ~2 m (two rows pushed well apart). We normalise
// the spread against SPREAD_FOR_FULL_SCALE = 2 m and clamp to [0.2, 1.6], so the
// result is always a small positive finite number and actually varies over a
// realistic table: 0.05 m -> 0.2 (floor), 0.5 m -> 0.25, 1 m -> 0.5, 2 m -> 1.0.
// The clamp bounds are reachable at realistic spreads, unlike the old /12 map.
const SPREAD_FOR_FULL_SCALE = 2;
const SCALE_MIN = 0.2;
const SCALE_MAX = 1.6;

export function deriveArena(cards, options = {}) {
  const fallback = {
    centerX: 0, centerY: 0, centerZ: 0,
    width: DEFAULT_ARENA.halfWidth * 2, depth: DEFAULT_ARENA.halfDepth * 2,
    scale: 1, blueAnchor: [-3, 0, 0], redAnchor: [3, 0, 0]
  };

  // Only cards with a fully finite world position may take part in the maths: a
  // single NaN/Infinity/undefined coordinate would otherwise poison centerX,
  // width, scale and both anchors. If none survive, use the fallback.
  const list = (cards || []).filter(card =>
    Array.isArray(card?.worldPosition) &&
    Number.isFinite(card.worldPosition[0]) &&
    Number.isFinite(card.worldPosition[2]));
  if (list.length === 0) return fallback;

  const xs = list.map(card => card.worldPosition[0]);
  const ys = list.map(card => card.worldPosition[1]).filter(Number.isFinite);
  const zs = list.map(card => card.worldPosition[2]);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minZ = Math.min(...zs);
  const maxZ = Math.max(...zs);
  const centerX = (minX + maxX) / 2;
  const centerY = ys.length ? (Math.min(...ys) + Math.max(...ys)) / 2 : 0;
  const centerZ = (minZ + maxZ) / 2;
  const spanX = maxX - minX; // >= 0 and finite because every input is finite
  const spanZ = maxZ - minZ;
  const scale = Math.min(SCALE_MAX, Math.max(SCALE_MIN, spanX / SPREAD_FOR_FULL_SCALE));

  const blue = list.filter(card => classifySide(card.worldPosition[0], centerX) === 'blue');
  const red = list.filter(card => classifySide(card.worldPosition[0], centerX) === 'red');
  // An empty group (every card on one side, or all on the centre line) falls back
  // to the centre so the anchor is always a finite number.
  const average = (group, axis, fallbackValue) => group.length
    ? group.reduce((sum, card) => sum + card.worldPosition[axis], 0) / group.length
    : fallbackValue;

  return {
    centerX, centerY, centerZ,
    width: spanX, depth: spanZ, scale,
    blueAnchor: [average(blue, 0, centerX), 0, centerZ],
    redAnchor: [average(red, 0, centerX), 0, centerZ]
  };
}