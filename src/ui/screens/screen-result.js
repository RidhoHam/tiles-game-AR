// The `result` phase. There is no roster to change any more, so the only action
// is a replay, which returns to `scan` with the camera still open.
export function createScreenResult(root, state, { onReplay, onBackToWizard } = {}) {
  const element = document.createElement('section');
  element.className = 'screen screen-result';

  const heading = document.createElement('h2');
  heading.textContent = 'Battle Selesai';

  const winner = state?.snapshot?.().winner ?? null;
  const outcome = document.createElement('p');
  outcome.className = 'screen-result__winner';
  outcome.textContent = winner === 'red' ? 'Tim Merah menang' : winner === 'blue' ? 'Tim Biru menang' : 'Battle berakhir tanpa pemenang';

  const actions = document.createElement('div');
  actions.className = 'screen-result__actions';

  const makeButton = (label, className, handler) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = className;
    button.textContent = label;
    button.addEventListener('click', () => handler?.());
    return button;
  };

  actions.append(
    makeButton('Ulangi', 'screen-result__replay primary', onReplay),
    makeButton('Pindai Ulang Kartu', 'screen-result__rescan', onBackToWizard)
  );

  element.append(heading, outcome, actions);
  root.append(element);

  return { dispose() { element.remove(); } };
}
