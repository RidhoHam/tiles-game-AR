// Application phase machine for the webcam card-AR experience.
//
// The player prints six cards, lays THREE on the left and THREE on the right of a
// table, then only WATCHES. There is no mode picker and no roster/build step any
// more: the webcam is the single AR path, the card layout IS the lineup, and the
// battle starts as soon as the teams validate.
//
//   camera -> scan -> battle -> result
//     ^                             |
//     |                             |
//     +--------- (never) <----------+   result -> scan (replay, camera stays open)
export const PHASES = Object.freeze(['camera', 'scan', 'battle', 'result']);
export const MODES = Object.freeze(['test', 'battle']);

// Allowed forward/backward moves. `result -> scan` is the replay edge and is the
// ONLY edge that leaves `result`: the camera is deliberately kept open across a
// replay, so nothing ever returns to `camera` once scanning has begun.
const TRANSITIONS = Object.freeze({
  camera: Object.freeze(['scan']),
  scan: Object.freeze(['battle']),
  battle: Object.freeze(['result']),
  result: Object.freeze(['scan'])
});

export function createAppState({ onChange } = {}) {
  let state = {
    phase: 'camera',
    mode: 'battle',
    // The validated, reconciled card lineup (`{ cardId, type, role, side, x, ... }`)
    // shared by the scan screen and the controller's battle setup.
    cards: null,
    // The last `validateTeams` result (`{ valid, errors, bySide }`), so a screen
    // can render the SPECIFIC reasons a lineup is rejected.
    validation: null,
    winner: null
  };
  const listeners = new Set();
  if (onChange) listeners.add(onChange);

  const allowed = (from, to) => (TRANSITIONS[from] ?? []).includes(to);

  const snapshot = () => ({ ...state });
  const commit = () => { const snap = snapshot(); listeners.forEach(listener => listener(snap)); };

  function forwardTarget() {
    if (state.phase === 'camera') return 'scan';
    if (state.phase === 'scan') return 'battle';
    if (state.phase === 'battle') return 'result';
    return null; // result replays explicitly via goTo('scan')
  }

  function backwardTarget() {
    // No phase can safely step backwards: `scan -> camera` would not close the
    // camera, and `battle -> scan` would leave a battle running behind the UI.
    return null;
  }

  const api = {
    get phase() { return state.phase; },
    get mode() { return state.mode; },
    get cards() { return state.cards; },
    get validation() { return state.validation; },
    get winner() { return state.winner; },
    setMode(mode) {
      if (!MODES.includes(mode)) return false;
      if (state.mode === mode) return true;
      state.mode = mode;
      commit();
      return true;
    },
    setCards(cards, validation = null) { state.cards = cards ?? null; state.validation = validation ?? null; commit(); },
    setValidation(validation) { state.validation = validation ?? null; commit(); },
    setWinner(winner) { state.winner = winner ?? null; commit(); },
    canGoTo(phase) { return PHASES.includes(phase) && allowed(state.phase, phase); },
    goTo(phase) {
      if (!api.canGoTo(phase)) return false;
      state.phase = phase; commit(); return true;
    },
    next() { const target = forwardTarget(); return target ? api.goTo(target) : false; },
    back() { const target = backwardTarget(); return target ? api.goTo(target) : false; },
    subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
    snapshot
  };
  return api;
}
