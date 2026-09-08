import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  SoundEngine,
  midiToFreq,
  getNearestSample,
  STRUDEL_PIANO_BASE,
  STRUDEL_PIANO_MAP
} from '../src/audio/soundEngine.js';

test('midiToFreq calculates correct frequencies for standard pitches', () => {
  assert.equal(midiToFreq(69), 440);
  assert.equal(midiToFreq(57), 220);
  assert.equal(midiToFreq(81), 880);
  // Middle C (MIDI 60) is ~261.625565 Hz -> 261.63
  assert.ok(Math.abs(midiToFreq(60) - 261.63) < 0.01);
});

test('STRUDEL_PIANO_BASE and STRUDEL_PIANO_MAP contain valid Dough-samples definitions', () => {
  assert.ok(typeof STRUDEL_PIANO_BASE === 'string');
  assert.ok(STRUDEL_PIANO_BASE.includes('felixroos/dough-samples'));
  assert.ok(STRUDEL_PIANO_MAP.A0);
  assert.ok(STRUDEL_PIANO_MAP.C4);
  assert.ok(STRUDEL_PIANO_MAP.C8);
  assert.equal(STRUDEL_PIANO_MAP.C4, 'C4v8.mp3');
  assert.equal(STRUDEL_PIANO_MAP.A0, 'A0v8.mp3');
  assert.equal(STRUDEL_PIANO_MAP.C8, 'C8v8.mp3');
});

test('getNearestSample matches nearest pitch accurately', () => {
  // Exact hits
  const c4 = getNearestSample(60);
  assert.equal(c4.note, 'C4');
  assert.equal(c4.midi, 60);
  assert.equal(c4.file, 'C4v8.mp3');
  assert.equal(c4.detuneCents, 0);
  assert.equal(c4.playbackRate, 1.0);

  const a0 = getNearestSample(21);
  assert.equal(a0.note, 'A0');
  assert.equal(a0.midi, 21);
  assert.equal(a0.file, 'A0v8.mp3');

  const c8 = getNearestSample(108);
  assert.equal(c8.note, 'C8');
  assert.equal(c8.midi, 108);
  assert.equal(c8.file, 'C8v8.mp3');

  // Pitches between sample points
  // MIDI 61 (C#4): distance to C4 (60) is 1, distance to Ds4 (63) is 2 -> matches C4
  const cs4 = getNearestSample(61);
  assert.equal(cs4.note, 'C4');
  assert.equal(cs4.detuneCents, 100);
  assert.ok(Math.abs(cs4.playbackRate - Math.pow(2, 1 / 12)) < 1e-4);

  // MIDI 62 (D4): distance to C4 (60) is 2, distance to Ds4 (63) is 1 -> matches Ds4
  const d4 = getNearestSample(62);
  assert.equal(d4.note, 'Ds4');
  assert.equal(d4.detuneCents, -100);

  // String note name input
  const fromName = getNearestSample('A4');
  assert.equal(fromName.note, 'A4');
  assert.equal(fromName.midi, 69);
});

test('SoundEngine volume clamping operates within [0, 1]', () => {
  const engine = new SoundEngine({ volume: 0.8 });
  assert.equal(engine.volume, 0.8);

  engine.setVolume(-0.5);
  assert.equal(engine.volume, 0);

  engine.setVolume(1.5);
  assert.equal(engine.volume, 1);

  engine.setVolume(0.45);
  assert.equal(engine.volume, 0.45);
});

test('SoundEngine playback methods are safe when Web Audio is uninitialized or in Node', () => {
  const engine = new SoundEngine();

  // initAudio should be safe in headless / Node environment
  assert.doesNotThrow(() => {
    engine.initAudio();
  });

  // Playback calls should not throw errors when audio context is absent
  assert.doesNotThrow(() => {
    const resNote = engine.playNote(60, 0.5, 0.8);
    assert.equal(resNote, null);
  });

  assert.doesNotThrow(() => {
    const resChord = engine.playChord([60, 64, 67], 0.5);
    assert.deepEqual(resChord, []);
  });

  assert.doesNotThrow(() => {
    const perf = engine.playFeedback('PERFECT');
    const good = engine.playFeedback('GOOD');
    const miss = engine.playFeedback('MISS');
    const lower = engine.playFeedback('perfect');
    assert.equal(perf, null);
    assert.equal(good, null);
    assert.equal(miss, null);
    assert.equal(lower, null);
  });
});

test('SoundEngine works with a mocked Web Audio context', () => {
  // Minimal Web Audio mock to test audio graph creation & playback
  class MockAudioNode {
    constructor() {
      this.connectedTo = [];
      this.gain = {
        value: 1,
        setValueAtTime: (val) => { this.gain.value = val; },
        linearRampToValueAtTime: () => {},
        exponentialRampToValueAtTime: () => {}
      };
      this.frequency = {
        value: 440,
        setValueAtTime: (val) => { this.frequency.value = val; },
        exponentialRampToValueAtTime: () => {}
      };
      this.detune = {
        value: 0,
        setValueAtTime: (val) => { this.detune.value = val; }
      };
      this.threshold = { setValueAtTime: () => {} };
      this.knee = { setValueAtTime: () => {} };
      this.ratio = { setValueAtTime: () => {} };
      this.attack = { setValueAtTime: () => {} };
      this.release = { setValueAtTime: () => {} };
    }
    connect(target) {
      this.connectedTo.push(target);
      return target;
    }
    start() {}
    stop() {}
  }

  const mockCtx = {
    currentTime: 0,
    state: 'running',
    destination: new MockAudioNode(),
    createGain: () => new MockAudioNode(),
    createOscillator: () => new MockAudioNode(),
    createBiquadFilter: () => new MockAudioNode(),
    createDynamicsCompressor: () => new MockAudioNode(),
    createBufferSource: () => new MockAudioNode(),
    resume: async () => {}
  };

  const engine = new SoundEngine({ audioContext: mockCtx });
  engine.initAudio();

  assert.ok(engine.isInitialized);
  assert.ok(engine.masterGain);
  assert.ok(engine.compressor);
  assert.ok(engine.bassBoost);

  // Play note falls back to natural sustain synth when buffer isn't loaded
  const noteResult = engine.playNote(60, 0.5, 0.8);
  assert.ok(noteResult);
  assert.equal(noteResult.mode, 'synth');

  // Play chord
  const chordResult = engine.playChord([60, 64, 67], 0.5);
  assert.equal(chordResult.length, 3);

  // Play feedback sounds
  const perfResult = engine.playFeedback('PERFECT');
  assert.ok(perfResult);
  assert.equal(perfResult.type, 'crystal_chime');

  const goodResult = engine.playFeedback('GOOD');
  assert.ok(goodResult);
  assert.equal(goodResult.type, 'soft_chime');

  const missResult = engine.playFeedback('MISS');
  assert.ok(missResult);
  assert.equal(missResult.type, 'low_thud');
});
