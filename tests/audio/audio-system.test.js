import test from 'node:test';
import assert from 'node:assert/strict';
import { AudioSystem } from '../../src/audio/audio-system.js';

test('audio stays inert until a pattern engine exists', () => {
  const audio = new AudioSystem();
  assert.equal(audio.ready, false);
  assert.doesNotThrow(() => audio.playPhase('battle'));
  assert.doesNotThrow(() => audio.handleEvent({ type: 'impact' }));
  assert.equal(audio.muted, false);
  assert.equal(audio.phase, 'battle');
});

test('volume is clamped and mute state is tracked', () => {
  const audio = new AudioSystem();
  audio.setMusicVolume(5);
  audio.setSfxVolume(-3);
  assert.equal(audio.musicVolume, 1);
  assert.equal(audio.sfxVolume, 0);
  audio.setMuted(true);
  assert.equal(audio.muted, true);
});

test('unknown event types are ignored without throwing', () => {
  const audio = new AudioSystem();
  assert.doesNotThrow(() => audio.handleEvent({ type: 'not-a-real-event' }));
  assert.doesNotThrow(() => audio.handleEvent(undefined));
});
