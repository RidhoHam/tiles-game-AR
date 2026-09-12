export const CARD_TARGETS = Object.freeze([
  { cardId: 'benteng', type: 'benteng', src: '/cards/benteng.svg' },
  { cardId: 'bunker', type: 'bunker', src: '/cards/bunker.svg' },
  { cardId: 'robot', type: 'robot', src: '/cards/robot.svg' },
  { cardId: 'tank', type: 'tank', src: '/cards/tank.svg' },
  { cardId: 'kesatria', type: 'kesatria', src: '/cards/kesatria.svg' },
  { cardId: 'gargoyle', type: 'gargoyle', src: '/cards/gargoyle.svg' }
]);

export const TARGET_FILE = '/cards/targets.mind';

export function typeForCard(cardId) {
  return CARD_TARGETS.find(card => card.cardId === cardId)?.type ?? null;
}