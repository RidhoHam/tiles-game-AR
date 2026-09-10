/**
 * MIDI Multi-Track & Channel Manager
 *
 * Manages separate MIDI tracks (e.g. Melody, Chords, Bass, Accompaniment),
 * allowing per-track solo, mute, note extraction, and instrument isolation.
 */

export class TrackManager {
  /**
   * @param {Array<Object>} tracks - Array of MIDI tracks from Tone.js MIDI or custom chart
   */
  constructor(tracks = []) {
    this.tracks = [];
    this.initTracks(tracks);
  }

  /**
   * Initializes tracks with unique IDs and state
   * @param {Array<Object>} rawTracks
   */
  initTracks(rawTracks = []) {
    this.tracks = rawTracks.map((t, index) => {
      const name = t.name && t.name.trim().length > 0 ? t.name.trim() : `Track ${index + 1}`;
      const channel = t.channel !== undefined ? t.channel : index;
      const instrument = t.instrument?.name || t.instrument || 'Acoustic Piano';
      const notes = Array.isArray(t.notes) ? [...t.notes] : [];

      return {
        id: index,
        name,
        channel,
        instrument,
        noteCount: notes.length,
        notes,
        isMuted: false,
        isSolo: false
      };
    });
  }

  /**
   * Returns list of all indexed tracks
   * @returns {Array<Object>}
   */
  getTracks() {
    return this.tracks;
  }

  /**
   * Sets mute state for a given track ID
   * @param {number} trackId
   * @param {boolean} isMuted
   */
  setTrackMuted(trackId, isMuted) {
    const track = this.tracks.find(t => t.id === trackId);
    if (track) {
      track.isMuted = Boolean(isMuted);
    }
  }

  /**
   * Sets solo state for a given track ID
   * @param {number} trackId
   * @param {boolean} isSolo
   */
  setTrackSolo(trackId, isSolo) {
    const track = this.tracks.find(t => t.id === trackId);
    if (track) {
      track.isSolo = Boolean(isSolo);
    }
  }

  /**
   * Returns active notes filtered by current Solo and Mute rules,
   * sorted chronologically by timeSec / time
   * @returns {Array<Object>}
   */
  getActiveNotes() {
    const hasSolo = this.tracks.some(t => t.isSolo);

    const eligibleTracks = this.tracks.filter(t => {
      if (hasSolo) {
        return t.isSolo && !t.isMuted;
      }
      return !t.isMuted;
    });

    const mergedNotes = eligibleTracks.flatMap(t =>
      t.notes.map(n => ({
        ...n,
        trackId: t.id,
        trackName: t.name
      }))
    );

    return mergedNotes.sort((a, b) => {
      const timeA = a.time !== undefined ? a.time : (a.timeSec || 0);
      const timeB = b.time !== undefined ? b.time : (b.timeSec || 0);
      return timeA - timeB;
    });
  }
}
