import { createScreenCamera } from './screens/screen-camera.js';
import { createScreenScan } from './screens/screen-scan.js';
import { createScreenTest } from './screens/screen-test.js';
import { createScreenBattle } from './screens/screen-battle.js';
import { createScreenResult } from './screens/screen-result.js';
import { createQuickBar } from './quick-bar.js';
import { PHASES } from './app-state.js';

// One factory per phase. The map is keyed by the phase names in PHASES, so a new
// phase without a screen is a render-time error rather than a silent no-op.
const factories = {
  camera: createScreenCamera,
  scan: createScreenScan,
  battle: createScreenBattle,
  result: createScreenResult
};

export function mountWizard(root, state, handlers = {}) {
  const host = document.createElement('div');
  host.className = 'wizard';
  const progress = document.createElement('div');
  progress.className = 'wizard__progress';
  const outlet = document.createElement('div');
  outlet.className = 'wizard__outlet';

  const controls = document.createElement('div');
  controls.className = 'wizard__controls';

  const toggle = document.createElement('button');
  toggle.type = 'button';
  toggle.className = 'wizard__toggle';
  toggle.setAttribute('aria-label', 'Ciutkan Panduan');
  toggle.textContent = 'Ciutkan Panduan \u25BE';

  const fullscreenBtn = document.createElement('button');
  fullscreenBtn.type = 'button';
  fullscreenBtn.className = 'wizard__fullscreen';
  fullscreenBtn.setAttribute('aria-label', 'Layar Penuh / Putar Landscape');
  fullscreenBtn.textContent = '⛶ Putar / Fullscreen';
  fullscreenBtn.addEventListener('click', async () => {
    try {
      if (!document.fullscreenElement && document.documentElement.requestFullscreen) {
        await document.documentElement.requestFullscreen();
      }
      if (screen?.orientation?.lock) {
        await screen.orientation.lock('landscape').catch(() => {});
      }
    } catch {
      /* ignore if not supported */
    }
  });

  controls.append(toggle, fullscreenBtn);

  let isMinimized = false;
  const updateToggleLabel = () => {
    toggle.textContent = isMinimized ? 'Buka Panduan \u25B8' : 'Ciutkan Panduan \u25BE';
    toggle.setAttribute('aria-label', isMinimized ? 'Buka Panduan' : 'Ciutkan Panduan');
  };

  const quickBar = createQuickBar(root, state, {
    onStartBattle() {
      handlers.scan?.onStart?.();
    },
    onToggleMode(mode) {
      handlers.onSelectMode?.(mode);
    },
    onFormPosition() {
      handlers.scan?.onFormPosition?.();
    },
    onToggleGuide() {
      isMinimized = !isMinimized;
      outlet.classList.toggle('is-minimized', isMinimized);
      updateToggleLabel();
      quickBar.setGuideMinimized(isMinimized);
    }
  });

  toggle.addEventListener('click', () => {
    isMinimized = !isMinimized;
    outlet.classList.toggle('is-minimized', isMinimized);
    updateToggleLabel();
    quickBar.setGuideMinimized(isMinimized);
  });

  host.append(progress, outlet);
  root.append(host);

  let current = null;
  let currentPhase = null;

  const render = phase => {
    current?.dispose?.();
    outlet.replaceChildren();

    // Default to minimized on scan and battle so camera view stays clear
    isMinimized = phase === 'scan' || phase === 'battle';
    outlet.classList.toggle('is-minimized', isMinimized);
    updateToggleLabel();
    quickBar.setGuideMinimized(isMinimized);

    if (phase !== 'battle') {
      outlet.append(controls);
    }
    const factory = phase === 'scan' && state.mode === 'test' ? createScreenTest : factories[phase];
    current = factory(outlet, state, { ...(handlers[phase] ?? {}), mode: state.mode });
    currentPhase = phase;
    const index = PHASES.indexOf(phase);
    progress.style.setProperty('--progress', `${((index + 1) / PHASES.length) * 100}%`);
    progress.dataset.phase = phase;
  };

  const unsubscribe = state.subscribe(snapshot => { if (snapshot.phase !== currentPhase) render(snapshot.phase); });
  render(state.phase);
  return {
    render,
    current: () => current,
    setCountdown: seconds => quickBar?.setCountdown?.(seconds),
    quickBar,
    dispose() {
      unsubscribe();
      quickBar.dispose();
      current?.dispose?.();
      host.remove();
    }
  };
}
