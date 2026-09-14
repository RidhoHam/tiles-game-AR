export const CARD_TARGETS = Object.freeze([
  { cardId: 'benteng', type: 'benteng', src: '/cards/benteng.svg', mindFile: '/cards/BENTENG.mind' },
  { cardId: 'bunker', type: 'bunker', src: '/cards/bunker.svg', mindFile: '/cards/BUNKER.mind' },
  { cardId: 'robot', type: 'robot', src: '/cards/robot.svg', mindFile: '/cards/ROBOT.mind' },
  { cardId: 'tank', type: 'tank', src: '/cards/tank.svg', mindFile: '/cards/TANK.mind' },
  { cardId: 'kesatria', type: 'kesatria', src: '/cards/kesatria.svg', mindFile: '/cards/KESATRIA.mind' },
  { cardId: 'gargoyle', type: 'gargoyle', src: '/cards/gargoyle.svg', mindFile: '/cards/GARGOYLE.mind' }
]);

export const TARGET_FILES = Object.freeze(CARD_TARGETS.map(card => card.mindFile));
export const TARGET_FILE = '/cards/targets.mind';

export function typeForCard(cardId) {
  return CARD_TARGETS.find(card => card.cardId === cardId)?.type ?? null;
}