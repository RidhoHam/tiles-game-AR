import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  parseSongChart,
  beatToSeconds,
  secondsToBeat,
  noteNameToMidi,
  midiToNoteName,
  expandChord,
  convertTilesJsonToChart
} from '../src/engine/songParser.js';

test('beatToSeconds and secondsToBeat convert accurately at 120 BPM', () => {
  assert.equal(beatToSeconds(0, 120), 0);
  assert.equal(beatToSeconds(4, 120), 2.0);
  assert.equal(secondsToBeat(2.0, 120), 4);
});

test('expandChord expands standard triads', () => {
  assert.deepEqual(expandChord('Cmaj', 4), ['C4', 'E4', 'G4']);
  assert.deepEqual(expandChord('Am', 4), ['A4', 'C5', 'E5']);
  assert.deepEqual(expandChord('G', 3), ['G3', 'B3', 'D4']);
});

test('noteNameToMidi and midiToNoteName conversions', () => {
  assert.equal(noteNameToMidi('C4'), 60);
  assert.equal(noteNameToMidi('A4'), 69);
  assert.equal(noteNameToMidi('C#5'), 73);
  assert.equal(midiToNoteName(60), 'C4');
  assert.equal(midiToNoteName(69), 'A4');
  assert.equal(midiToNoteName(73), 'C#5');
});

test('parseSongChart normalizes notes and chords sorted by beat', () => {
  const song = {
    id: 's1',
    title: 'Test Song',
    bpm: 120,
    events: [{ beat: 0, type: 'chord', chord: 'C' }]
  };
  const chart = {
    difficulty: 'normal',
    lanes: 4,
    notes: [
      { beat: 2, lane: 1, note: 'E4', type: 'tap' },
      { beat: 0, lane: 0, note: 'C4', type: 'tap' },
      {
        beat: 1,
        type: 'chord',
        notes: [
          { lane: 0, note: 'C4' },
          { lane: 2, note: 'G4' }
        ]
      }
    ]
  };
  const parsed = parseSongChart(song, chart);
  assert.equal(parsed.notes.length, 3);
  assert.equal(parsed.notes[0].beat, 0);
  assert.equal(parsed.notes[1].beat, 1);
  assert.equal(parsed.notes[2].beat, 2);
  assert.equal(parsed.notes[0].timeSec, 0);
  assert.equal(parsed.notes[1].timeSec, 0.5);
  assert.equal(parsed.notes[2].timeSec, 1.0);
  assert.equal(parsed.notes[1].type, 'chord');
  assert.equal(parsed.notes[1].notes.length, 2);
  assert.equal(parsed.bpm, 120);
  assert.equal(parsed.lanes, 4);
});

test('convertTilesJsonToChart converts legacy tiles JSON to song and chart', () => {
  const tilesJson = {
    title: 'Demo Test',
    bpm: 120,
    laneCount: 8,
    tiles: [
      { id: 1, name: 'C4', midi: 60, time: 0.0, duration: 0.5, lane: 2 },
      { id: 2, name: 'G4', midi: 67, time: 1.0, duration: 0.5, lane: 6 }
    ]
  };

  const { song, chart } = convertTilesJsonToChart(tilesJson);
  assert.equal(song.title, 'Demo Test');
  assert.equal(song.bpm, 120);
  assert.equal(chart.lanes, 8);
  assert.equal(chart.notes.length, 2);
  assert.equal(chart.notes[0].beat, 0);
  assert.equal(chart.notes[0].hand, 'left');
  assert.equal(chart.notes[1].beat, 2);
  assert.equal(chart.notes[1].hand, 'right');
  assert.equal(chart.notes[0].note, 'C4');
  assert.equal(chart.notes[0].midi, 60);
});

test('demo_canon.json fixture parses successfully in 4-lane and 8-lane modes', () => {
  const canonJson = JSON.parse(fs.readFileSync(new URL('../data/songs/demo_canon.json', import.meta.url), 'utf8'));
  const parsed4 = parseSongChart(canonJson, canonJson.charts['4lane']);
  assert.equal(parsed4.lanes, 4);
  assert.ok(parsed4.notes.length > 10);
  assert.equal(parsed4.key, 'D');
  assert.equal(parsed4.bpm, 100);

  const parsed8 = parseSongChart(canonJson, canonJson.charts['8lane']);
  assert.equal(parsed8.lanes, 8);
  assert.ok(parsed8.notes.length > 20);
});

test('demo_twinkle.json fixture parses successfully in 4-lane and 8-lane modes', () => {
  const twinkleJson = JSON.parse(fs.readFileSync(new URL('../data/songs/demo_twinkle.json', import.meta.url), 'utf8'));
  const parsed4 = parseSongChart(twinkleJson, twinkleJson.charts['4lane']);
  assert.equal(parsed4.lanes, 4);
  assert.ok(parsed4.notes.length > 10);
  assert.equal(parsed4.key, 'C');
  assert.equal(parsed4.bpm, 100);

  const parsed8 = parseSongChart(twinkleJson, twinkleJson.charts['8lane']);
  assert.equal(parsed8.lanes, 8);
  assert.ok(parsed8.notes.length > 20);
});
