import { test } from 'node:test';
import assert from 'node:assert/strict';
import { TrackManager } from '../src/core/midi/trackManager.js';

test('TrackManager indexes tracks and filters notes based on mute/solo states', () => {
  const mockTracks = [
    { name: 'Melody', channel: 0, notes: [{ midi: 60, time: 0 }, { midi: 62, time: 1 }] },
    { name: 'Bass', channel: 1, notes: [{ midi: 36, time: 0 }, { midi: 43, time: 1 }] }
  ];

  const tm = new TrackManager(mockTracks);
  assert.equal(tm.getTracks().length, 2);

  // Mute Melody track
  tm.setTrackMuted(0, true);
  const activeNotes = tm.getActiveNotes();
  assert.equal(activeNotes.length, 2);
  assert.equal(activeNotes[0].midi, 36); // Only Bass notes remain
});

test('TrackManager handles solo mode properly', () => {
  const mockTracks = [
    { name: 'Melody', channel: 0, notes: [{ midi: 72, time: 0.5 }] },
    { name: 'Chords', channel: 1, notes: [{ midi: 60, time: 0.5 }] },
    { name: 'Bass', channel: 2, notes: [{ midi: 36, time: 0.5 }] }
  ];

  const tm = new TrackManager(mockTracks);
  tm.setTrackSolo(0, true); // Solo track 0 (Melody)
  const activeNotes = tm.getActiveNotes();
  assert.equal(activeNotes.length, 1);
  assert.equal(activeNotes[0].midi, 72);

  // Clear solo
  tm.setTrackSolo(0, false);
  assert.equal(tm.getActiveNotes().length, 3);
});
