import { UNIT_DEFINITIONS } from '../../core/unit-definitions.js';

const ACTIONS = Object.freeze([
  ['reset', 'Reset'],
  ['build', 'Build'],
  ['action', 'Action'],
  ['damage', 'Damage'],
  ['destroy', 'Destroy'],
  ['rotate-left', 'Putar Kiri'],
  ['rotate-right', 'Putar Kanan'],
  ['scale-up', 'Perbesar'],
  ['scale-down', 'Perkecil']
]);

export function createScreenTest(root, state, handlers = {}) {
  const { onAction, onRescan, onBack } = handlers;
  const element = document.createElement('section');
  element.className = 'screen screen-test';

  const heading = document.createElement('h2');
  heading.textContent = 'Mode Test';

  const hint = document.createElement('p');
  hint.className = 'screen-test__hint';
  hint.textContent = 'Letakkan satu kartu di tengah kamera untuk menguji model 3D.';

  const cardStatus = document.createElement('div');
  cardStatus.className = 'screen-test__card';
  cardStatus.setAttribute('aria-live', 'polite');
  const cardState = document.createElement('strong');
  const cardTitle = document.createElement('span');
  cardStatus.append(cardState, cardTitle);

  const status = document.createElement('p');
  status.className = 'screen-test__status';
  status.setAttribute('aria-live', 'polite');

  const actionGrid = document.createElement('div');
  actionGrid.className = 'screen-test__actions';
  const actionButtons = new Map();
  for (const [key, label] of ACTIONS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'screen-test__action';
    button.textContent = label;
    button.dataset.action = key;
    button.setAttribute('aria-label', label);
    button.disabled = true;
    button.addEventListener('click', () => {
      if (!button.disabled) onAction?.(key);
    });
    actionButtons.set(key, button);
    actionGrid.append(button);
  }

  const controls = document.createElement('div');
  controls.className = 'screen-test__controls';
  const rescanButton = document.createElement('button');
  rescanButton.type = 'button';
  rescanButton.className = 'screen-test__rescan primary';
  rescanButton.textContent = 'Pindai Ulang';
  rescanButton.setAttribute('aria-label', 'Pindai Ulang');
  rescanButton.addEventListener('click', () => onRescan?.());
  const backButton = document.createElement('button');
  backButton.type = 'button';
  backButton.className = 'screen-test__back';
  backButton.textContent = 'Bersihkan Model';
  backButton.setAttribute('aria-label', 'Bersihkan Model');
  backButton.addEventListener('click', () => onBack?.());
  controls.append(rescanButton, backButton);

  element.append(heading, hint, cardStatus, status, actionGrid, controls);
  root.append(element);

  function setActionState(available) {
    const enabled = typeof available === 'boolean' ? available : Boolean(available?.available);
    for (const button of actionButtons.values()) button.disabled = !enabled;
  }

  function update({ card = null, model = null, title = '', actionLabel = '', status: message = '' } = {}) {
    const cardTitleText = title || UNIT_DEFINITIONS[card?.type]?.title || card?.type || '';
    cardState.textContent = card || model ? 'Kartu terdeteksi' : 'Belum ada kartu';
    cardTitle.textContent = cardTitleText ? `: ${cardTitleText}` : '';
    const actionButton = actionButtons.get('action');
    if (actionButton) {
      const label = actionLabel || model?.actionLabel || 'Action';
      actionButton.textContent = label;
      actionButton.setAttribute('aria-label', label);
    }
    status.textContent = message || (model
      ? 'Model siap diuji.'
      : card
        ? 'Kartu terdeteksi, tetapi model belum siap diuji.'
        : 'Arahkan kamera ke satu kartu.');
    cardStatus.dataset.detected = String(Boolean(card || model));
    setActionState(Boolean(model));
  }

  update({ card: state?.cards?.[0] ?? null, model: null });

  return {
    update,
    setActionState,
    dispose() { element.remove(); }
  };
}

export { ACTIONS };
