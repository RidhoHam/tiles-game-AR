// Audio is optional: the Strudel engine only exists in the browser. Every call
// into it goes through this indirection so a missing/failed global is a no-op
// instead of a crash, which also keeps this module importable under Node tests.
function pattern(name, ...args) {
  const fn = globalThis[name];
  if (typeof fn !== 'function') return null;
  try { return fn(...args); } catch { return null; }
}

function hushAll() {
  const fn = globalThis.hush;
  if (typeof fn !== 'function') return null;
  try { return fn(); } catch { return null; }
}

// ---------------------------------------------------------------------------
// Battle event -> sound effect mapping
// ---------------------------------------------------------------------------
//
// `SFX_EVENTS` is keyed by the event `type` values BattleSystem actually emits
// (src/core/battle-system.js), NOT by an invented vocabulary. `sfxFor` is the
// only sanctioned way to translate an event into a sound name, so an unknown or
// missing event can never reach the note table and blow up a frame.
//
// `move` is deliberately NOT mapped to a sound. BattleSystem emits one `move`
// per walking unit per fixed step (1/120 s) - see the events log note in the
// Task 2 ledger - so a per-event footstep would fire up to 120 times a second
// per unit. That is a buzz, not a footstep, and it would also drown the mix.
// A real footstep loop would need its own rate limiter and audio envelope,
// which is out of scope here; silence is the honest mapping for now.
export const SFX_EVENTS = Object.freeze({
  'battle-start': 'battle-start',
  attack: 'attack',
  impact: 'impact',
  destroy: 'destroy',
  victory: 'victory'
});

// Sound-effect definitions for the names SFX_EVENTS can return. `summon` was
// removed with the summon feature (Task 8 deleted the whole summon path and no
// event or UI can request it any more), so keeping it would be a stale key that
// could never fire.
const SFX_NOTES = {
  attack: { notes: 'g4', sound: 'square' },
  impact: { notes: 'c3', sound: 'sawtooth' },
  destroy: { notes: 'e2', sound: 'sawtooth' },
  victory: { notes: 'c5 e5 g5', sound: 'square' },
  'battle-start': { notes: 'c4 g4', sound: 'square' }
};

/**
 * The sound-effect name for a battle event, or `null` when the event should be
 * silent (unknown type, missing event, empty object). Never throws.
 */
export function sfxFor(event) {
  const type = event?.type;
  if (!type) return null;
  return SFX_EVENTS[type] ?? null;
}

export class AudioSystem {
  constructor() {
    this.ready = false;
    this.muted = false;
    this.musicVolume = 0.35;
    this.sfxVolume = 0.6;
    this.phase = null;
  }

  async unlock() {
    if (this.ready) return true;
    try {
      const { initStrudel } = await import('@strudel/web');
      await initStrudel();
      this.ready = true;
      return true;
    } catch (error) {
      console.warn('Audio tidak tersedia.', error);
      return false;
    }
  }

  setMuted(muted) {
    this.muted = Boolean(muted);
    if (this.muted) hushAll();
  }

  setMusicVolume(value) {
    this.musicVolume = Math.max(0, Math.min(1, Number(value) || 0));
    if (this.ready) this.playPhase(this.phase);
  }

  setSfxVolume(value) {
    this.sfxVolume = Math.max(0, Math.min(1, Number(value) || 0));
  }

  playPhase(phase) {
    this.phase = phase;
    if (!this.ready || this.muted) return;
    hushAll();
    const gain = this.musicVolume;

    if (phase === 'battle') {
      // Bright, driving battle loop.
      pattern('note', 'c3 e3 g3 b3')?.sound('triangle')?.slow(2)?.gain(gain)?.play();
      pattern('note', 'c4 g4 c5')?.sound('square')?.slow(4)?.gain(gain * 0.5)?.play();
    } else if (phase === 'setup') {
      // Calm, sparse preparation loop.
      pattern('note', 'c4 e4 g4')?.sound('sine')?.slow(3)?.gain(gain * 0.75)?.play();
    } else if (phase === 'result') {
      // Short, resolved flourish.
      pattern('note', 'c4 g4 e4 c4')?.sound('sine')?.slow(4)?.gain(gain * 0.45)?.play();
    }
  }

  handleEvent(event) {
    const name = sfxFor(event);
    if (!name) return;
    if (!this.ready || this.muted) return;
    const sfx = SFX_NOTES[name];
    if (!sfx) return;
    pattern('note', sfx.notes)?.sound(sfx.sound)?.gain(this.sfxVolume)?.play();
  }

  dispose() {
    hushAll();
  }
}