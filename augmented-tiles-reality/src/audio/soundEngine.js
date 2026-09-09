/**
 * Strudel Concert Grand Piano Audio Engine
 *
 * Implements:
 * - High-fidelity Dough-samples piano soundbank loader & pitch shifter
 * - Equal-loudness bass boost and dynamic range compressor
 * - Natural sustain synthesizer fallback (warm unison detune + damping filter)
 * - Polyphonic chord playback
 * - High-precision musical feedback chimes ('PERFECT', 'GOOD', 'MISS')
 * - Volume control with master gain clamping
 * - Safe execution in SSR/Node and headless test environments
 */

export const STRUDEL_PIANO_BASE = 'https://raw.githubusercontent.com/felixroos/dough-samples/main/piano/';

export const STRUDEL_PIANO_MAP = {
  A0: 'A0v8.mp3',
  C1: 'C1v8.mp3',
  Ds1: 'Ds1v8.mp3',
  Fs1: 'Fs1v8.mp3',
  A1: 'A1v8.mp3',
  C2: 'C2v8.mp3',
  Ds2: 'Ds2v8.mp3',
  Fs2: 'Fs2v8.mp3',
  A2: 'A2v8.mp3',
  C3: 'C3v8.mp3',
  Ds3: 'Ds3v8.mp3',
  Fs3: 'Fs3v8.mp3',
  A3: 'A3v8.mp3',
  C4: 'C4v8.mp3',
  Ds4: 'Ds4v8.mp3',
  Fs4: 'Fs4v8.mp3',
  A4: 'A4v8.mp3',
  C5: 'C5v8.mp3',
  Fs5: 'Fs5v8.mp3',
  A5: 'A5v8.mp3',
  C6: 'C6v8.mp3',
  Ds6: 'Ds6v8.mp3',
  Fs6: 'Fs6v8.mp3',
  A6: 'A6v8.mp3',
  C7: 'C7v8.mp3',
  Ds7: 'Ds7v8.mp3',
  Fs7: 'Fs7v8.mp3',
  A7: 'A7v8.mp3',
  C8: 'C8v8.mp3'
};

const NOTE_NAME_REGEX = /^([A-Ga-g])([#bs]?)(-?\d+)$/;
const NOTE_BASE_INDICES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };

export function noteNameToMidi(name) {
  if (typeof name === 'number') return name;
  if (!name || typeof name !== 'string') return 60;
  const match = name.trim().match(NOTE_NAME_REGEX);
  if (!match) return 60;
  const letter = match[1].toUpperCase();
  const accidental = match[2];
  const octave = parseInt(match[3], 10);
  let index = NOTE_BASE_INDICES[letter] ?? 0;
  if (accidental === '#' || accidental === 's') index += 1;
  else if (accidental === 'b') index -= 1;
  return (octave + 1) * 12 + index;
}

export function midiToFreq(midi) {
  return 440 * Math.pow(2, (midi - 69) / 12);
}

// Pre-computed sample list sorted by MIDI pitch
const SAMPLE_ENTRIES = Object.entries(STRUDEL_PIANO_MAP).map(([noteKey, fileName]) => {
  const midi = noteNameToMidi(noteKey);
  return {
    note: noteKey,
    midi,
    file: fileName,
    url: `${STRUDEL_PIANO_BASE}${fileName}`
  };
}).sort((a, b) => a.midi - b.midi);

export function getNearestSample(target) {
  const targetMidi = typeof target === 'string' ? noteNameToMidi(target) : target;
  let nearest = SAMPLE_ENTRIES[0];
  let minDiff = Math.abs(targetMidi - nearest.midi);

  for (let i = 1; i < SAMPLE_ENTRIES.length; i++) {
    const entry = SAMPLE_ENTRIES[i];
    const diff = Math.abs(targetMidi - entry.midi);
    if (diff < minDiff) {
      minDiff = diff;
      nearest = entry;
    }
  }

  const semitoneDiff = targetMidi - nearest.midi;
  const detuneCents = semitoneDiff * 100;
  const playbackRate = Math.pow(2, semitoneDiff / 12);

  return {
    note: nearest.note,
    midi: nearest.midi,
    file: nearest.file,
    url: nearest.url,
    detuneCents,
    playbackRate
  };
}

export class SoundEngine {
  constructor(options = {}) {
    this.volume = options.volume !== undefined ? Math.max(0, Math.min(1, options.volume)) : 0.8;
    this.customContext = options.audioContext || null;
    this.ctx = null;
    this.masterGain = null;
    this.compressor = null;
    this.bassBoost = null;
    this.sampleBuffers = new Map();
    this.pendingLoads = new Map();
    this.isInitialized = false;
    this.isMuted = false;
  }

  async init() {
    return this.initAudio();
  }

  toggleMute() {
    this.isMuted = !this.isMuted;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime || 0;
      const targetVol = this.isMuted ? 0 : this.volume;
      if (this.masterGain.gain?.setValueAtTime) {
        this.masterGain.gain.setValueAtTime(targetVol, now);
      } else if (this.masterGain.gain) {
        this.masterGain.gain.value = targetVol;
      }
    }
    return this.isMuted;
  }

  initAudio() {
    if (this.isInitialized && this.ctx) {
      if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
        this.ctx.resume().catch(() => {});
      }
      return this.ctx;
    }

    const isBrowser = typeof window !== 'undefined';
    let AudioCtxClass = null;

    if (this.customContext) {
      this.ctx = this.customContext;
    } else if (isBrowser) {
      AudioCtxClass = window.AudioContext || window.webkitAudioContext;
      if (AudioCtxClass) {
        this.ctx = new AudioCtxClass();
      }
    }

    if (!this.ctx) {
      return null;
    }

    if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
      this.ctx.resume().catch(() => {});
    }

    // Audio Graph:
    // Source -> bassBoost (lowshelf) -> compressor -> masterGain -> destination

    // 1. Bass Boost filter (equal-loudness warmth at 120 Hz)
    if (typeof this.ctx.createBiquadFilter === 'function') {
      this.bassBoost = this.ctx.createBiquadFilter();
      this.bassBoost.type = 'lowshelf';
      if (this.bassBoost.frequency?.setValueAtTime) {
        this.bassBoost.frequency.setValueAtTime(120, this.ctx.currentTime || 0);
      } else if (this.bassBoost.frequency) {
        this.bassBoost.frequency.value = 120;
      }
      if (this.bassBoost.gain?.setValueAtTime) {
        this.bassBoost.gain.setValueAtTime(3.5, this.ctx.currentTime || 0);
      } else if (this.bassBoost.gain) {
        this.bassBoost.gain.value = 3.5;
      }
    }

    // 2. Dynamics Compressor (tames loud chords, lifts sustain tails)
    if (typeof this.ctx.createDynamicsCompressor === 'function') {
      this.compressor = this.ctx.createDynamicsCompressor();
      if (this.compressor.threshold?.setValueAtTime) {
        const now = this.ctx.currentTime || 0;
        this.compressor.threshold.setValueAtTime(-18, now);
        this.compressor.knee.setValueAtTime(20, now);
        this.compressor.ratio.setValueAtTime(4, now);
        this.compressor.attack.setValueAtTime(0.005, now);
        this.compressor.release.setValueAtTime(0.25, now);
      }
    }

    // 3. Master Gain
    if (typeof this.ctx.createGain === 'function') {
      this.masterGain = this.ctx.createGain();
      if (this.masterGain.gain?.setValueAtTime) {
        this.masterGain.gain.setValueAtTime(this.volume, this.ctx.currentTime || 0);
      } else if (this.masterGain.gain) {
        this.masterGain.gain.value = this.volume;
      }
    }

    // Link nodes in chain
    if (this.bassBoost && this.compressor) {
      this.bassBoost.connect(this.compressor);
    }
    const lastFilter = this.compressor || this.bassBoost;
    if (lastFilter && this.masterGain) {
      lastFilter.connect(this.masterGain);
    }
    if (this.masterGain && this.ctx.destination) {
      this.masterGain.connect(this.ctx.destination);
    }

    this.isInitialized = true;
    return this.ctx;
  }

  getInputNode() {
    if (!this.ctx) return null;
    return this.bassBoost || this.compressor || this.masterGain || this.ctx.destination;
  }

  setVolume(vol) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(vol) ? vol : 1));
    this.volume = clamped;
    if (this.masterGain && this.ctx) {
      const now = this.ctx.currentTime || 0;
      if (this.masterGain.gain?.setValueAtTime) {
        this.masterGain.gain.setValueAtTime(this.volume, now);
      } else if (this.masterGain.gain) {
        this.masterGain.gain.value = this.volume;
      }
    }
    return this.volume;
  }

  async loadSample(sampleInfo) {
    if (!this.ctx || !sampleInfo) return null;
    if (this.sampleBuffers.has(sampleInfo.note)) {
      return this.sampleBuffers.get(sampleInfo.note);
    }
    if (this.pendingLoads.has(sampleInfo.note)) {
      return this.pendingLoads.get(sampleInfo.note);
    }
    if (typeof fetch !== 'function') return null;

    const promise = (async () => {
      try {
        const response = await fetch(sampleInfo.url);
        if (!response.ok) return null;
        const arrayBuffer = await response.arrayBuffer();
        if (typeof this.ctx.decodeAudioData === 'function') {
          const audioBuffer = await this.ctx.decodeAudioData(arrayBuffer);
          this.sampleBuffers.set(sampleInfo.note, audioBuffer);
          return audioBuffer;
        }
        return null;
      } catch {
        return null;
      } finally {
        this.pendingLoads.delete(sampleInfo.note);
      }
    })();

    this.pendingLoads.set(sampleInfo.note, promise);
    return promise;
  }

  preloadOctaves(centerMidi = 60, span = 24) {
    const samplesToLoad = new Set();
    for (let m = centerMidi - span; m <= centerMidi + span; m += 3) {
      const s = getNearestSample(m);
      if (s) samplesToLoad.add(s);
    }
    for (const sample of samplesToLoad) {
      this.loadSample(sample);
    }
  }

  playNote(midi, duration = 0.5, velocity = 0.8) {
    if (this.isMuted) return null;
    if (!this.ctx) {
      this.initAudio();
    }
    if (!this.ctx) return null;
    if (this.ctx.state === 'suspended' && typeof this.ctx.resume === 'function') {
      this.ctx.resume().catch(() => {});
    }

    const noteMidi = typeof midi === 'string' ? noteNameToMidi(midi) : (midi ?? 60);
    const sample = getNearestSample(noteMidi);

    // If real concert grand sample is cached in memory, play it
    if (sample && this.sampleBuffers.has(sample.note)) {
      return this._playSampleBuffer(sample, duration, velocity);
    }

    // Trigger background preloading for future hits
    if (sample && !this.pendingLoads.has(sample.note)) {
      this.loadSample(sample);
    }

    // Immediate zero-latency fallback to natural sustain synthesizer
    return this._playSynthFallback(noteMidi, duration, velocity);
  }

  _playSampleBuffer(sample, duration = 0.5, velocity = 0.8) {
    const buffer = this.sampleBuffers.get(sample.note);
    if (!buffer || typeof this.ctx.createBufferSource !== 'function') {
      return this._playSynthFallback(sample.midi, duration, velocity);
    }

    const now = this.ctx.currentTime || 0;
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;

    if (source.detune?.setValueAtTime) {
      source.detune.setValueAtTime(sample.detuneCents, now);
    } else if (source.playbackRate?.setValueAtTime) {
      source.playbackRate.setValueAtTime(sample.playbackRate, now);
    } else if (source.playbackRate) {
      source.playbackRate.value = sample.playbackRate;
    }

    const noteGain = this.ctx.createGain();
    const peak = Math.max(0.01, velocity * 0.9);
    const releaseSec = 0.35;

    if (noteGain.gain?.setValueAtTime) {
      noteGain.gain.setValueAtTime(peak, now);
      if (noteGain.gain.exponentialRampToValueAtTime) {
        noteGain.gain.setValueAtTime(peak, now + Math.max(0, duration - 0.05));
        noteGain.gain.exponentialRampToValueAtTime(0.0001, now + duration + releaseSec);
      }
    }

    source.connect(noteGain);
    noteGain.connect(this.getInputNode());

    source.start(now);
    if (typeof source.stop === 'function') {
      source.stop(now + duration + releaseSec);
    }

    return { mode: 'sample', sample, source, noteGain };
  }

  _playSynthFallback(midi, duration = 0.5, velocity = 0.8) {
    if (!this.ctx || typeof this.ctx.createOscillator !== 'function') return null;
    const now = this.ctx.currentTime || 0;
    const freq = midiToFreq(midi);

    // Dual oscillator: Triangle (body resonance) + Sine (pure fundamental)
    const osc1 = this.ctx.createOscillator();
    const osc2 = this.ctx.createOscillator();
    osc1.type = 'triangle';
    osc2.type = 'sine';

    if (osc1.frequency?.setValueAtTime) {
      osc1.frequency.setValueAtTime(freq, now);
      osc2.frequency.setValueAtTime(freq, now);
    } else {
      osc1.frequency.value = freq;
      osc2.frequency.value = freq;
    }

    // Natural piano unison detune (±2.5 cents) creates warm acoustic chorus shimmer
    if (osc1.detune?.setValueAtTime) {
      osc1.detune.setValueAtTime(-2.5, now);
      osc2.detune.setValueAtTime(2.5, now);
    }

    // Dynamic lowpass filter mimicking piano hammer brightness decay
    let filter = null;
    if (typeof this.ctx.createBiquadFilter === 'function') {
      filter = this.ctx.createBiquadFilter();
      filter.type = 'lowpass';
      const initialCutoff = Math.min(freq * 4.5, 7500);
      const decayedCutoff = Math.max(freq * 1.4, 250);
      if (filter.frequency?.setValueAtTime) {
        filter.frequency.setValueAtTime(initialCutoff, now);
        if (filter.frequency.exponentialRampToValueAtTime) {
          filter.frequency.exponentialRampToValueAtTime(decayedCutoff, now + duration);
        }
      }
    }

    // Natural piano amplitude envelope: rapid hammer attack + gentle sustain decay
    const gain = this.ctx.createGain();
    const peakVol = Math.max(0.08, velocity * 0.85);
    const releaseSec = 0.38;

    if (gain.gain?.setValueAtTime) {
      gain.gain.setValueAtTime(0.0001, now);
      if (gain.gain.linearRampToValueAtTime) {
        gain.gain.linearRampToValueAtTime(peakVol, now + 0.004); // 4ms attack
      }
      if (gain.gain.exponentialRampToValueAtTime) {
        const decayTime = Math.max(now + 0.05, now + Math.min(0.08, duration * 0.5));
        gain.gain.exponentialRampToValueAtTime(peakVol * 0.70, decayTime); // hammer strike transient
        gain.gain.exponentialRampToValueAtTime(0.0001, now + duration + releaseSec); // sustain decay
      }
    }

    const dest = this.getInputNode();
    if (filter) {
      osc1.connect(filter);
      osc2.connect(filter);
      filter.connect(gain);
    } else {
      osc1.connect(gain);
      osc2.connect(gain);
    }
    gain.connect(dest);

    osc1.start(now);
    osc2.start(now);
    if (typeof osc1.stop === 'function') {
      osc1.stop(now + duration + releaseSec + 0.05);
      osc2.stop(now + duration + releaseSec + 0.05);
    }

    return { mode: 'synth', midi, freq, osc1, osc2, filter, gain };
  }

  playChord(notes, duration = 0.5) {
    if (!this.ctx || !Array.isArray(notes) || notes.length === 0) return [];
    // Scale velocity by 1 / sqrt(N) to prevent clipping while preserving dynamics
    const velocity = Math.min(0.85, 0.75 / Math.sqrt(notes.length));
    const results = [];

    for (let i = 0; i < notes.length; i++) {
      const item = notes[i];
      let midi = 60;
      if (typeof item === 'number') {
        midi = item;
      } else if (typeof item === 'string') {
        midi = noteNameToMidi(item);
      } else if (item && typeof item === 'object') {
        midi = item.midi ?? (item.note ? noteNameToMidi(item.note) : 60);
      }
      const played = this.playNote(midi, duration, velocity);
      if (played) results.push(played);
    }

    return results;
  }

  playFeedback(judgement) {
    if (!this.ctx || !judgement || typeof judgement !== 'string') return null;
    if (typeof this.ctx.createOscillator !== 'function') return null;

    const now = this.ctx.currentTime || 0;
    const dest = this.getInputNode();
    const type = judgement.toUpperCase();

    if (type === 'PERFECT') {
      // Harmonic crystal chime:
      // Sparkling high-frequency interval (C7 ~2093Hz and G7 ~3136Hz)
      const osc1 = this.ctx.createOscillator();
      const osc2 = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc1.type = 'sine';
      osc2.type = 'triangle';

      const f1 = 2093.0; // C7
      const f2 = 3135.96; // G7

      if (osc1.frequency?.setValueAtTime) {
        osc1.frequency.setValueAtTime(f1, now);
        osc2.frequency.setValueAtTime(f2, now);
      } else {
        osc1.frequency.value = f1;
        osc2.frequency.value = f2;
      }

      const peak = 0.28;
      const decaySec = 0.45;
      if (gain.gain?.setValueAtTime) {
        gain.gain.setValueAtTime(0.0001, now);
        if (gain.gain.linearRampToValueAtTime) {
          gain.gain.linearRampToValueAtTime(peak, now + 0.005);
        }
        if (gain.gain.exponentialRampToValueAtTime) {
          gain.gain.exponentialRampToValueAtTime(0.0001, now + decaySec);
        }
      }

      osc1.connect(gain);
      osc2.connect(gain);
      gain.connect(dest);

      osc1.start(now);
      osc2.start(now);
      if (typeof osc1.stop === 'function') {
        osc1.stop(now + decaySec + 0.05);
        osc2.stop(now + decaySec + 0.05);
      }

      return { type: 'crystal_chime', judgement: 'PERFECT', osc1, osc2, gain };
    }

    if (type === 'GOOD') {
      // Soft chime:
      // Warm, gentle bell tone at E6 (~1318.5Hz)
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'sine';
      const f = 1318.51; // E6

      if (osc.frequency?.setValueAtTime) {
        osc.frequency.setValueAtTime(f, now);
      } else {
        osc.frequency.value = f;
      }

      const peak = 0.22;
      const decaySec = 0.3;
      if (gain.gain?.setValueAtTime) {
        gain.gain.setValueAtTime(0.0001, now);
        if (gain.gain.linearRampToValueAtTime) {
          gain.gain.linearRampToValueAtTime(peak, now + 0.008);
        }
        if (gain.gain.exponentialRampToValueAtTime) {
          gain.gain.exponentialRampToValueAtTime(0.0001, now + decaySec);
        }
      }

      osc.connect(gain);
      gain.connect(dest);

      osc.start(now);
      if (typeof osc.stop === 'function') {
        osc.stop(now + decaySec + 0.05);
      }

      return { type: 'soft_chime', judgement: 'GOOD', osc, gain };
    }

    if (type === 'MISS') {
      // Low-frequency thud:
      // Pitch drop from 130Hz to 45Hz with short muffled punch
      const osc = this.ctx.createOscillator();
      const gain = this.ctx.createGain();

      osc.type = 'triangle';
      const decaySec = 0.2;

      if (osc.frequency?.setValueAtTime) {
        osc.frequency.setValueAtTime(130, now);
        if (osc.frequency.exponentialRampToValueAtTime) {
          osc.frequency.exponentialRampToValueAtTime(45, now + decaySec);
        }
      } else {
        osc.frequency.value = 65;
      }

      const peak = 0.32;
      if (gain.gain?.setValueAtTime) {
        gain.gain.setValueAtTime(peak, now);
        if (gain.gain.exponentialRampToValueAtTime) {
          gain.gain.exponentialRampToValueAtTime(0.0001, now + decaySec);
        }
      }

      osc.connect(gain);
      gain.connect(dest);

      osc.start(now);
      if (typeof osc.stop === 'function') {
        osc.stop(now + decaySec + 0.05);
      }

      return { type: 'low_thud', judgement: 'MISS', osc, gain };
    }

    return null;
  }
}

export const soundEngine = new SoundEngine();
