import { createScreenCamera } from './screens/screen-camera.js';
import { createScreenScan } from './screens/screen-scan.js';
import { createScreenTest } from './screens/screen-test.js';
import { createScreenBattle } from './screens/screen-battle.js';
import { createScreenResult } from './screens/screen-result.js';
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
  host.append(progress, outlet);
  root.append(host);

  let current = null;
  let currentPhase = null;

  const render = phase => {
    current?.dispose?.();
    outlet.replaceChildren();
    const factory = phase === 'scan' && state.mode === 'test' ? createScreenTest : factories[phase];
    current = factory(outlet, state, { ...(handlers[phase] ?? {}), mode: state.mode });
    currentPhase = phase;
    const index = PHASES.indexOf(phase);
    progress.style.setProperty('--progress', `${((index + 1) / PHASES.length) * 100}%`);
    progress.dataset.phase = phase;
  };

  const unsubscribe = state.subscribe(snapshot => { if (snapshot.phase !== currentPhase) render(snapshot.phase); });
  render(state.phase);
  return { render, current: () => current, dispose() { unsubscribe(); current?.dispose?.(); host.remove(); } };
}
