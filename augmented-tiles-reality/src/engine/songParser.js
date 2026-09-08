const CHORD_INTERVALS = {
  '': [0, 4, 7],
  'maj': [0, 4, 7],
  'M': [0, 4, 7],
  'm': [0, 3, 7],
  'min': [0, 3, 7],
  'dim': [0, 3, 6],
  'aug': [0, 4, 8],
  '7': [0, 4, 7, 10],
  'maj7': [0, 4, 7, 11],
  'M7': [0, 4, 7, 11],
  'm7': [0, 3, 7, 10],
  'min7': [0, 3, 7, 10],
  'sus2': [0, 2, 7],
  'sus4': [0, 5, 7]
};

const NOTE_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const NOTE_TO_SEMITONE = {
  'C': 0, 'C#': 1, 'Db': 1,
  'D': 2, 'D#': 3, 'Eb': 3,
  'E': 4,
  'F': 5, 'F#': 6, 'Gb': 6,
  'G': 7, 'G#': 8, 'Ab': 8,
  'A': 9, 'A#': 10, 'Bb': 10,
  'B': 11
};

export function beatToSeconds(beat, bpm) {
  return (beat / bpm) * 60;
}

export function secondsToBeat(seconds, bpm) {
  return (seconds / 60) * bpm;
}

export function noteNameToMidi(name) {
  if (!name || typeof name !== 'string') return 60;
  const match = name.match(/^([A-Ga-g][#b]?)(-?\d+)$/);
  if (!match) return 60;
  const noteStr = match[1].charAt(0).toUpperCase() + (match[1].length > 1 ? match[1].charAt(1) : '');
  const semitone = NOTE_TO_SEMITONE[noteStr] ?? 0;
  const octave = parseInt(match[2], 10);
  return (octave + 1) * 12 + semitone;
}

export function midiToNoteName(midi) {
  const note = NOTE_NAMES[((midi % 12) + 12) % 12];
  const oct = Math.floor(midi / 12) - 1;
  return `${note}${oct}`;
}

export function expandChord(chordName, rootOctave = 4) {
  if (!chordName || typeof chordName !== 'string') return [`C${rootOctave}`];
  const match = chordName.match(/^([A-Ga-g][#b]?)(.*?)$/);
  if (!match) return [`C${rootOctave}`];
  const rootNote = match[1].charAt(0).toUpperCase() + (match[1].length > 1 ? match[1].charAt(1) : '');
  const type = match[2] || '';
  const intervals = CHORD_INTERVALS[type] || [0, 4, 7];

  const rootMidi = noteNameToMidi(`${rootNote}${rootOctave}`);
  return intervals.map(interval => midiToNoteName(rootMidi + interval));
}

export function parseSongChart(songData, chartData) {
  let chart = chartData;
  if (typeof chartData === 'string' && songData.charts && songData.charts[chartData]) {
    chart = songData.charts[chartData];
  } else if (!chart && songData.charts) {
    chart = songData.charts['4lane'] || Object.values(songData.charts)[0];
  } else if (!chart) {
    chart = songData.chart || songData;
  }

  const bpm = songData.bpm || 120;
  const rawNotes = [...(chart.notes || [])];
  const laneCount = chart.lanes || 4;

  const notes = rawNotes.map((n, idx) => {
    const beat = n.beat ?? 0;
    const timeSec = beatToSeconds(beat, bpm);
    const durationBeat = n.durationBeat ?? n.duration ?? 0.5;
    const durationSec = beatToSeconds(durationBeat, bpm);
    const lane = n.lane ?? 0;
    const hand = n.hand || (lane < (laneCount / 2) ? 'left' : 'right');

    const noteName = n.note || (n.midi ? midiToNoteName(n.midi) : 'C4');
    const midi = n.midi || (n.note ? noteNameToMidi(n.note) : 60);

    const subNotes = Array.isArray(n.notes)
      ? n.notes.map((sub, sIdx) => {
          const sLane = sub.lane ?? 0;
          return {
            id: sub.id ?? `sub_${idx}_${sIdx}`,
            lane: sLane,
            hand: sub.hand || (sLane < (laneCount / 2) ? 'left' : 'right'),
            note: sub.note || (sub.midi ? midiToNoteName(sub.midi) : 'C4'),
            midi: sub.midi || (sub.note ? noteNameToMidi(sub.note) : 60)
          };
        })
      : null;

    return {
      id: n.id ?? `note_${idx}`,
      beat,
      timeSec,
      lane,
      hand,
      type: n.type || (subNotes ? 'chord' : 'tap'),
      note: noteName,
      midi,
      durationBeat,
      durationSec,
      notes: subNotes
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
    key: songData.key || 'C',
    timeSignature: songData.timeSignature || '4/4',
    lanes: laneCount,
    difficulty: chart.difficulty || 'normal',
    durationSec,
    notes,
    events: songData.events || []
  };
}

export function convertTilesJsonToChart(tilesJson) {
  const bpm = tilesJson.bpm || 120;
  const laneCount = tilesJson.laneCount || 8;
  const notes = (tilesJson.tiles || []).map((t, idx) => {
    const lane = t.lane ?? 0;
    const durationSec = t.duration || 0.3;
    return {
      id: t.id ? `t_${t.id}` : `t_${idx}`,
      beat: secondsToBeat(t.time ?? 0, bpm),
      timeSec: t.time ?? 0,
      lane,
      hand: lane < (laneCount / 2) ? 'left' : 'right',
      type: 'tap',
      note: t.name || (t.midi ? midiToNoteName(t.midi) : 'C4'),
      midi: t.midi || (t.name ? noteNameToMidi(t.name) : 60),
      duration: secondsToBeat(durationSec, bpm),
      durationBeat: secondsToBeat(durationSec, bpm),
      durationSec,
      velocity: t.velocity ?? 0.8
    };
  });

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
