# AR Piano Tiles — "Play the Song in Space" Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a Web-based Augmented Reality (WebXR + Hand Tracking) Piano Tiles game that transforms real physical surfaces into an interactive 3D musical instrument using MediaPipe Hand Landmarker, Three.js 3D Holographic Arena, and Strudel Audio Engine.

**Architecture:** A modular frontend Web AR architecture featuring an Invisible 3D Musical Grid, MediaPipe Hand Landmarker integration (1-hand 4-lanes and 2-hand 8-lanes), WebXR markerless surface hit-testing with full Camera+Gyro fallback for non-WebXR devices, Strudel polyphonic audio engine, decoupled Song/Chart JSON system with MIDI conversion, and 60 FPS Three.js particle & holographic visuals.

**Tech Stack:** Three.js (r160+), WebXR Device API, MediaPipe Tasks-Vision (HandLandmarker), Strudel Official Concert Grand Audio Engine (Web Audio API), Node.js native test runner (`node --test`), Python 3 local server.

## Global Constraints
- Markerless surface-based AR placement with guaranteed Camera+Screen fallback for devices without WebXR hit-test.
- MediaPipe Hand Landmarker tracking index fingertip (1-Hand) and multi-hand left/right (2-Hand).
- Canonical Musical Clock based on beats and BPM, independent of render frame rate.
- Judgement thresholds: PERFECT (±50ms), GOOD (±120ms), MISS (>120ms).
- Zero external build tooling required: pure ES Modules runnable via standard HTTP server (`python app.py`).
- Automated tests run with zero npm dependencies using Node.js native `node:test` and `node:assert`.

---

## File Structure

```
d:/codebase/testing-app/piano-midi/
├── ar.html                              # Web AR Game Entrypoint & Viewport
├── index.html                           # Existing 2D player (updated with link to AR mode)
├── app.py                               # Python server & CLI converter (updated with --ar flag)
├── src/
│   ├── audio/
│   │   └── soundEngine.js               # Strudel sample bank + Web Audio polyphonic synth & SFX
│   ├── engine/
│   │   ├── songParser.js                # Song/Chart JSON schema parser, beat-clock, chord expander
│   │   └── hitDetector.js               # Invisible 3D Musical Grid, Z-crossing, lane hit, judgements
│   ├── vision/
│   │   └── handTracker.js               # MediaPipe HandLandmarker wrapper, smoothing, fingertip extractor
│   ├── ar/
│   │   ├── arScene.js                   # Three.js 3D scene, WebXR hit-test, fallback camera feed, arena
│   │   └── vfxSystem.js                 # 3D tile meshes, hit burst particles, combo glow, world pulse
│   └── ui/
│       └── arUI.js                      # Calibration overlay, mode/song select, HUD, result screen
├── data/
│   └── songs/
│       ├── demo_canon.json              # Canonical demo song & chart (Canon in D)
│       └── demo_twinkle.json            # Beginner friendly chord progression song
└── tests/
    ├── songParser.test.mjs              # Unit tests for song schema parsing & beat calculations
    └── hitDetector.test.mjs             # Unit tests for 3D grid lane mapping & crossing judgements
```

---

## Tasks

### Task 1: Song & Chart Engine with Musical Beat Clock

**Files:**
- Create: `src/engine/songParser.js`
- Test: `tests/songParser.test.mjs`

**Interfaces:**
- Consumes: Raw song/chart JSON objects conforming to PRD sections 18–20.
- Produces:
  * `parseSongChart(songData, chartData)` -> `{ meta, bpm, duration, notes, chords }`
  * `beatToSeconds(beat, bpm)` -> `number`
  * `secondsToBeat(seconds, bpm)` -> `number`
  * `expandChord(chordName, octave)` -> `string[]` (e.g. `"Cmaj"` -> `["C4", "E4", "G4"]`)
  * `convertTilesJsonToChart(tilesJson)` -> `{ song, chart }`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/songParser.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  parseSongChart,
  beatToSeconds,
  secondsToBeat,
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
      { beat: 0, lane: 0, note: 'C4', type: 'tap' }
    ]
  };
  const parsed = parseSongChart(song, chart);
  assert.equal(parsed.notes.length, 2);
  assert.equal(parsed.notes[0].beat, 0);
  assert.equal(parsed.notes[1].beat, 2);
  assert.equal(parsed.notes[0].timeSec, 0);
  assert.equal(parsed.notes[1].timeSec, 1.0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/songParser.test.mjs`  
Expected: FAIL with module not found or functions not defined.

- [ ] **Step 3: Implement minimal code in `src/engine/songParser.js`**

```javascript
// src/engine/songParser.js
const CHORD_INTERVALS = {
  '': [0, 4, 7],
  'maj': [0, 4, 7],
  'm': [0, 3, 7],
  'min': [0, 3, 7],
  'dim': [0, 3, 6],
  'aug': [0, 4, 8],
  '7': [0, 4, 7, 10],
  'maj7': [0, 4, 7, 11],
  'm7': [0, 3, 7, 10]
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

export function beatToSeconds(beat, bpm) {
  return (beat / bpm) * 60;
}

export function secondsToBeat(seconds, bpm) {
  return (seconds / 60) * bpm;
}

export function noteNameToMidi(name) {
  const match = name.match(/^([A-G]#?)(-?\d+)$/);
  if (!match) return 60;
  const noteIndex = NOTE_NAMES.indexOf(match[1]);
  const octave = parseInt(match[2], 10);
  return (octave + 1) * 12 + noteIndex;
}

export function midiToNoteName(midi) {
  const note = NOTE_NAMES[midi % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${note}${oct}`;
}

export function expandChord(chordName, rootOctave = 4) {
  const match = chordName.match(/^([A-G]#?)(.*)$/);
  if (!match) return [`C${rootOctave}`];
  const rootNote = match[1];
  const type = match[2] || '';
  const intervals = CHORD_INTERVALS[type] || [0, 4, 7];

  const rootMidi = noteNameToMidi(`${rootNote}${rootOctave}`);
  return intervals.map(interval => midiToNoteName(rootMidi + interval));
}

export function parseSongChart(songData, chartData) {
  const bpm = songData.bpm || 120;
  const rawNotes = [...(chartData.notes || [])];

  const notes = rawNotes.map((n, idx) => {
    const beat = n.beat ?? 0;
    const timeSec = beatToSeconds(beat, bpm);
    return {
      id: n.id ?? `note_${idx}`,
      beat,
      timeSec,
      lane: n.lane ?? 0,
      hand: n.hand || (n.lane < ((chartData.lanes || 4) / 2) ? 'left' : 'right'),
      type: n.type || 'tap',
      note: n.note || 'C4',
      midi: n.midi || noteNameToMidi(n.note || 'C4'),
      durationBeat: n.duration || 0.5,
      durationSec: beatToSeconds(n.duration || 0.5, bpm),
      notes: n.notes || null
    };
  });

  notes.sort((a, b) => a.timeSec - b.timeSec);

  const durationSec = notes.length > 0
    ? Math.max(...notes.map(n => n.timeSec + n.durationSec)) + 2.0
    : 10.0;

  return {
    id: songData.id || 'song',
    title: songData.title || 'Untitled',
    artist: songData.artist || 'Unknown',
    bpm,
    lanes: chartData.lanes || 4,
    difficulty: chartData.difficulty || 'normal',
    durationSec,
    notes,
    events: songData.events || []
  };
}

export function convertTilesJsonToChart(tilesJson) {
  const bpm = tilesJson.bpm || 120;
  const laneCount = tilesJson.laneCount || 8;
  const notes = (tilesJson.tiles || []).map((t, idx) => ({
    id: `t_${idx}`,
    beat: secondsToBeat(t.time, bpm),
    lane: t.lane,
    hand: t.lane < (laneCount / 2) ? 'left' : 'right',
    type: 'tap',
    note: t.name,
    midi: t.midi,
    duration: secondsToBeat(t.duration || 0.3, bpm)
  }));

  const song = {
    id: tilesJson.title?.toLowerCase().replace(/\s+/g, '_') || 'midi_song',
    title: tilesJson.title || 'MIDI Song',
    artist: 'MIDI Import',
    bpm,
    timeSignature: '4/4'
  };

  const chart = {
    difficulty: 'normal',
    lanes: laneCount,
    notes
  };

  return { song, chart };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/songParser.test.mjs`  
Expected: All tests PASS.

- [ ] **Step 5: Create Canonical Demo Songs (`data/songs/demo_canon.json` and `data/songs/demo_twinkle.json`)**

Generate JSON chart fixtures conforming to PRD for Canon in D and Twinkle Twinkle (with single notes, chords, 4-lane and 8-lane formats).

- [ ] **Step 6: Commit**

```bash
git add src/engine/songParser.js tests/songParser.test.mjs data/songs/
git commit -m "feat: implement song and chart engine with beat-based timing"
```

---

### Task 2: Invisible 3D Musical Grid & Hit Detection System

**Files:**
- Create: `src/engine/hitDetector.js`
- Test: `tests/hitDetector.test.mjs`

**Interfaces:**
- Consumes: Note events from `songParser.js`, 3D hand landmark coordinates $(x, y, z)$.
- Produces:
  * `HitDetector(config)` class
  * `mapHandToLane(handPosition, laneCount, arenaConfig)` -> `laneIndex | -1`
  * `checkCrossing(prevPos, currPos, hitPlaneZ)` -> `boolean`
  * `evaluateHit(handPos, prevPos, currentTimeSec, activeNotes)` -> `{ judgement: 'PERFECT'|'GOOD'|'MISS'|null, note, timingDiff }`
  * `evaluateChord(chordNotes, hitEvents)` -> `{ completeness: 1.0, judgement: 'PERFECT'|'GOOD'|'PARTIAL'|'MISS' }`

- [ ] **Step 1: Write the failing test**

```javascript
// tests/hitDetector.test.mjs
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { HitDetector } from '../src/engine/hitDetector.js';

test('mapHandToLane correctly identifies lanes across 4-lane setup', () => {
  const detector = new HitDetector({ laneCount: 4, arenaWidth: 0.8 });
  assert.equal(detector.mapHandToLane({ x: -0.3, y: 0, z: 0 }), 0);
  assert.equal(detector.mapHandToLane({ x: -0.1, y: 0, z: 0 }), 1);
  assert.equal(detector.mapHandToLane({ x: 0.1, y: 0, z: 0 }), 2);
  assert.equal(detector.mapHandToLane({ x: 0.3, y: 0, z: 0 }), 3);
  assert.equal(detector.mapHandToLane({ x: 0.8, y: 0, z: 0 }), -1); // out of bounds
});

test('detects hit plane crossing and returns PERFECT within 50ms', () => {
  const detector = new HitDetector({
    laneCount: 4,
    arenaWidth: 0.8,
    hitPlaneZ: 0.0,
    perfectWindowSec: 0.050,
    goodWindowSec: 0.120
  });

  const targetNote = {
    id: 'n1',
    timeSec: 2.0,
    lane: 1,
    note: 'C4',
    played: false
  };

  const prevHand = { x: -0.1, y: 0, z: -0.05 }; // before hit plane
  const currHand = { x: -0.1, y: 0, z: 0.02 };  // crossed hit plane

  const result = detector.evaluateCrossingHit(
    prevHand,
    currHand,
    2.02, // 20ms off -> within 50ms
    [targetNote]
  );

  assert.ok(result);
  assert.equal(result.judgement, 'PERFECT');
  assert.equal(result.note.id, 'n1');
});

test('evaluates chord completeness based on simultaneous notes', () => {
  const detector = new HitDetector();
  const res3 = detector.evaluateChordCompleteness(3, 3);
  assert.equal(res3.judgement, 'PERFECT');
  assert.equal(res3.completeness, 1.0);

  const res2 = detector.evaluateChordCompleteness(2, 3);
  assert.equal(res2.judgement, 'GOOD');
  assert.equal(res2.completeness, 2 / 3);

  const res1 = detector.evaluateChordCompleteness(1, 3);
  assert.equal(res1.judgement, 'PARTIAL');

  const res0 = detector.evaluateChordCompleteness(0, 3);
  assert.equal(res0.judgement, 'MISS');
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `node --test tests/hitDetector.test.mjs`  
Expected: FAIL with module not found.

- [ ] **Step 3: Implement minimal code in `src/engine/hitDetector.js`**

Implement `HitDetector` class with bounds checking, crossing logic, candidate selection, timing difference scoring, and chord completeness evaluation.

- [ ] **Step 4: Run test to verify it passes**

Run: `node --test tests/hitDetector.test.mjs`  
Expected: All tests PASS.

- [ ] **Step 5: Commit**

```bash
git add src/engine/hitDetector.js tests/hitDetector.test.mjs
git commit -m "feat: implement 3D musical grid lane mapping and crossing hit detection"
```

---

### Task 3: Strudel Audio Engine Integration

**Files:**
- Create: `src/audio/soundEngine.js`
- Test: Manual browser audio test & verify in integration

**Interfaces:**
- Consumes: Note events and judgements.
- Produces:
  * `SoundEngine` class
  * `initAudio()`
  * `playNote(midi, duration, velocity)`
  * `playChord(notesArray, duration)`
  * `playFeedback(judgement)` ('perfect'/'good'/'miss')
  * `setVolume(volume)`

- [x] **Step 1: Implement `src/audio/soundEngine.js` with Strudel Grand soundbank & Synthesizer fallback**
- [x] **Step 2: Commit**

```bash
git add src/audio/soundEngine.js
git commit -m "feat: implement Strudel concert grand piano sound engine and feedback sfx"
```

---

### Task 4: MediaPipe Hand Landmarker Vision Module

**Files:**
- Create: `src/vision/handTracker.js`
- Create: `tests/handTracker.test.mjs`

**Interfaces:**
- Consumes: Video element (`<video>` from camera / WebXR).
- Produces:
  * `HandTracker` class
  * `init()` -> loads MediaPipe vision tasks CDN bundle
  * `processVideo(videoElement, timestamp)` -> `HandState[]`
  * `HandState`: `{ handedness: 'Left'|'Right', indexTip: {x,y,z}, thumbTip: {x,y,z}, middleTip: {x,y,z}, rawLandmarks }`
  * Exponential Moving Average (EMA) smoothing for stability against camera noise.

- [x] **Step 1: Implement `src/vision/handTracker.js`**
- [x] **Step 2: Add test in `tests/handTracker.test.mjs` verifying EMA smoothing and coordinate normalization**
- [x] **Step 3: Commit**

```bash
git add src/vision/handTracker.js tests/handTracker.test.mjs
git commit -m "feat: implement MediaPipe hand tracking with 2-hand support and EMA smoothing"
```

---

### Task 5: 3D Holographic Arena, Tile Meshes, & VFX Particle Engine

**Files:**
- Create: `src/ar/vfxSystem.js`
- Create: `src/ar/arScene.js`

**Interfaces:**
- Consumes: Three.js WebGL / WebXR context, lane bounds, hit plane position.
- Produces:
  * Holographic musical arena (glass/neon borders, floor grid, hit plane laser line).
  * 3D Cuboid Tile mesh pool (spawns incoming tiles moving towards player along Z axis).
  * Particle burst on hits (InstancedMesh / Points burst with colorful glow).
  * World reactive environmental pulse (glow intensity responds to combo streaks 10, 20, 40, 60).
  * WebXR hit-test placement reticle and Camera+Raycaster fallback for non-WebXR devices.

- [ ] **Step 1: Implement `src/ar/vfxSystem.js`**
- [ ] **Step 2: Implement `src/ar/arScene.js`**
- [ ] **Step 3: Commit**

```bash
git add src/ar/vfxSystem.js src/ar/arScene.js
git commit -m "feat: implement 3D holographic arena, falling cuboid tiles, and VFX system"
```

---

### Task 6: Calibration Flow, HUD, & Web AR UI

**Files:**
- Create: `src/ui/arUI.js`
- Create: `ar.html`

**Interfaces:**
- Consumes: Game state, score, combo, hand tracker status, AR scene placement state.
- Produces:
  * Calibration screen: "Place hand in guide box to calibrate reach & sensitivity".
  * Mode selector: One-Hand (4 lanes) vs Two-Hand (8 lanes).
  * Song selector: Built-in Demo, Canon in D, Custom JSON / MIDI import.
  * In-game HUD: Floating judgement animations, Score, Combo counter, Song progress bar.
  * Result screen: Score, Accuracy %, Max Combo, Chord Accuracy %, punchline *"You built XX% of the song in space!"*.

- [ ] **Step 1: Implement `src/ui/arUI.js`**
- [ ] **Step 2: Implement `ar.html`**
- [ ] **Step 3: Commit**

```bash
git add src/ui/arUI.js ar.html
git commit -m "feat: implement AR calibration flow, HUD, and mobile Web AR viewport"
```

---

### Task 7: Full Integration, Two-Hand Mode, and App Launcher Update

**Files:**
- Modify: `index.html` (add navigation badge/button linking to AR Mode `ar.html`)
- Modify: `app.py` (add `--ar` option to open AR mode directly, serve static assets)
- Modify: `README.md` (document AR mode, controls, hand tracking, and fallback)

**Interfaces:**
- Seamless switching between 2D desktop preview player and 3D Web AR hand-tracking experience.

- [ ] **Step 1: Update `index.html`**
- [ ] **Step 2: Update `app.py`**
- [ ] **Step 3: Update `README.md`**
- [ ] **Step 4: Run all automated tests**
- [ ] **Step 5: Commit**

```bash
git add index.html app.py README.md
git commit -m "feat: integrate Web AR mode with 2D player and update launcher documentation"
```

---

## Verification Plan

### Automated Tests
1. **Song and Chart Engine**:
   - Command: `node --test tests/songParser.test.mjs`
   - Verifies: BPM conversion, beat-to-second calculations, chord expansion (`Cmaj` -> `C4, E4, G4`), MIDI-to-chart normalization.
2. **Invisible 3D Musical Grid & Hit Judgement**:
   - Command: `node --test tests/hitDetector.test.mjs`
   - Verifies: 4-lane and 8-lane mapping with forgiveness hitbox, hit plane crossing detection, ±50ms Perfect and ±120ms Good judgements, chord completeness rating.

### Manual Verification
1. **Camera Permission & Surface Placement**:
   - Launch `python app.py` (or `python app.py --ar`).
   - Allow camera access.
   - On WebXR device: Aim at floor/desk, verify placement ring tracks surface, tap to anchor 3D arena.
   - On Desktop/Safari: Verify fallback camera background activates and clicking anchors the 3D arena.
2. **One-Hand Gameplay**:
   - Hold hand in front of camera. Verify index fingertip is tracked and highlighted with a glowing AR sphere.
   - Perform forward tap gesture through the hit plane as falling tiles arrive.
   - Verify Strudel grand piano note triggers with zero delay, visual tile explodes with particle burst, and HUD displays "PERFECT" or "GOOD".
3. **Two-Hand Gameplay**:
   - Switch to Two-Hand mode (8 lanes).
   - Bring both hands into frame. Verify left hand controls lower 4 bass lanes and right hand controls upper 4 melody/chord lanes.
4. **Song Completion & Result Screen**:
   - Let song finish.
   - Verify result screen displays Score, Accuracy %, Max Combo, Chord Accuracy %, and "You built XX% of the song in space!".
