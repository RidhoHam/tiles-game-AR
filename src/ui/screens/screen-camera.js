import { detectCapabilities, explainCapabilities } from '../../ar/capabilities.js';
import { TARGET_FILE } from '../../ar/card-targets.js';

// The `camera` phase. It explains the experience, checks the two hard browser
// requirements (a camera and a secure context) BEFORE asking for anything, and
// only then offers the single "aktifkan kamera" gesture that unlocks audio and
// boots MindAR.
//
// The click handler is async and owns the whole failure path: the controller
// reports a missing target file / a denied camera as a REJECTED start(), so the
// button must be re-enabled and a specific message shown rather than leaving a
// dead spinner. A failure never leaves the screen (the app stays on `camera`).
export function createScreenCamera(root, state, handlers = {}) {
  const { onStart, onError, onSelectMode } = handlers;
  const selectMode = onSelectMode ?? (mode => state?.setMode?.(mode));

  const capabilities = detectCapabilities();
  const targetMissing = !capabilities.cardTracking;
  const gateMessage = targetMissing
    ? (capabilities.camera
      ? `Berkas target '${TARGET_FILE}' belum tersedia atau halaman tidak berjalan di konteks aman. Kamera hanya bisa dibuka lewat HTTPS atau localhost.`
      : explainCapabilities(capabilities))
    : null;

  const element = document.createElement('section');
  element.className = 'screen screen-camera';

  const heading = document.createElement('h2');
  heading.textContent = 'Perang Benteng Pasir AR';

  const intro = document.createElement('p');
  intro.className = 'screen-camera__intro';

  const steps = document.createElement('p');
  steps.className = 'screen-camera__steps';
  
  const modeSelector = document.createElement('div');
  modeSelector.className = 'screen-camera__modes';
  const modeLabel = document.createElement('p');
  modeLabel.className = 'screen-camera__mode-label';
  modeLabel.textContent = 'Pilih mode';
  modeSelector.append(modeLabel);

  const modeButtons = new Map();
  const modeCopy = {
    test: {
      intro: 'Siapkan satu kartu cetak dan letakkan di dekat tengah kamera. Model 3D kartu akan muncul untuk pengujian.',
      steps: '1) Letakkan satu kartu di tengah kamera. 2) Izinkan kamera. 3) Arahkan kamera ke kartu.'
    },
    battle: {
      intro: 'Siapkan enam kartu cetak: tiga di sisi kiri meja dan tiga di sisi kanan meja. '
        + 'Setiap sisi butuh tepat satu benteng/bunker, satu robot/tank, dan satu kesatria/gargoyle. '
        + 'Setelah kartu terbaca, pasukan akan berjalan keluar dari kartu dan bertempur di tengah meja.',
      steps: '1) Cetak keenam kartu. 2) Letakkan tiga di kiri dan tiga di kanan. '
        + '3) Izinkan kamera lalu arahkan kamera ke meja. Setelah itu kamu hanya menonton.'
    }
  };

  const updateMode = mode => {
    const selected = modeCopy[mode] ? mode : 'battle';
    intro.textContent = modeCopy[selected].intro;
    steps.textContent = modeCopy[selected].steps;
    for (const [buttonMode, button] of modeButtons) {
      const active = buttonMode === selected;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-pressed', String(active));
    }
  };

  for (const mode of ['test', 'battle']) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'screen-camera__mode';
    button.textContent = mode === 'test' ? 'Mode Test' : 'Mode Battle';
    button.setAttribute('aria-label', button.textContent);
    button.addEventListener('click', () => {
      if (selectMode?.(mode) === false) return;
      updateMode(state?.mode ?? mode);
    });
    modeButtons.set(mode, button);
    modeSelector.append(button);
  }
  updateMode(state?.mode);

  const actions = document.createElement('div');
  actions.className = 'screen-camera__actions';

  const startButton = document.createElement('button');
  startButton.type = 'button';
  startButton.className = 'screen-camera__start';
  startButton.textContent = 'Aktifkan Kamera';
  startButton.disabled = targetMissing;

  // The screen is re-rendered from scratch on every phase entry, so a rejected
  // start leaves the button clickable: the player can retry after granting the
  // permission or after the target file is put in place.
  let starting = false;
  startButton.addEventListener('click', async () => {
    if (starting || startButton.disabled) return;
    starting = true;
    startButton.disabled = true;
    startButton.textContent = 'Menyiapkan kamera...';
    try {
      const result = await onStart?.();
      // A successful start moves the app to `scan`, which disposes this screen;
      // only a falsy/failed result needs the button restored.
      if (result === false) {
        startButton.disabled = targetMissing;
        startButton.textContent = 'Aktifkan Kamera';
      }
    } catch (error) {
      startButton.disabled = targetMissing;
      startButton.textContent = 'Aktifkan Kamera';
      onError?.(error);
    } finally {
      starting = false;
    }
  });

  const backLink = document.createElement('a');
  backLink.className = 'screen-camera__help';
  backLink.href = '/cards/README.md';
  backLink.target = '_blank';
  backLink.rel = 'noreferrer';
  backLink.textContent = 'Cara mencetak kartu & membuat targets.mind';

  actions.append(startButton, backLink);
  element.append(heading, modeSelector, intro, steps);

  if (gateMessage) {
    const gate = document.createElement('p');
    gate.className = 'screen-camera__error';
    gate.textContent = gateMessage;
    element.append(gate);
  }

  element.append(actions);
  root.append(element);

  const unsubscribe = state?.subscribe?.(snapshot => {
    if (snapshot.phase === 'camera') updateMode(snapshot.mode);
  });

  return {
    // Lets the controller surface a failure (denied camera, missing
    // public/cards/targets.mind) without hijacking the layout.
    setError(message) {
      if (!message) return;
      const error = element.querySelector('.screen-camera__error');
      if (error) { error.textContent = message; return; }
      const next = document.createElement('p');
      next.className = 'screen-camera__error';
      next.textContent = message;
      element.insertBefore(next, actions);
    },
    dispose() { unsubscribe?.(); element.remove(); }
  };
}
