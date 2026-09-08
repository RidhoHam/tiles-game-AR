/**
 * HitDetector — Invisible 3D Musical Grid & Hit Detection System
 *
 * Implements 3D coordinate-to-lane mapping, Z-axis hit plane crossing detection,
 * timing difference evaluation (PERFECT/GOOD/MISS), and chord completeness scoring.
 */

export const JUDGEMENTS = {
  PERFECT: 'PERFECT',
  GOOD: 'GOOD',
  PARTIAL: 'PARTIAL',
  MISS: 'MISS'
};

export class HitDetector {
  /**
   * @param {Object} options
   * @param {number} [options.laneCount=4] - Number of vertical musical lanes (4 or 8)
   * @param {number} [options.arenaWidth=0.8] - Total interactive arena width in meters
   * @param {number} [options.hitPlaneZ=0.0] - Z position of the hit plane in AR space
   * @param {number} [options.perfectWindowSec=0.050] - Timing window for PERFECT (±50ms)
   * @param {number} [options.goodWindowSec=0.120] - Timing window for GOOD (±120ms)
   * @param {number} [options.forgiveness=1.2] - Hitbox forgiveness factor to compensate tracking noise
   */
  constructor(options = {}) {
    this.laneCount = options.laneCount ?? 4;
    this.arenaWidth = options.arenaWidth ?? 0.8;
    this.hitPlaneZ = options.hitPlaneZ ?? 0.0;
    this.perfectWindowSec = options.perfectWindowSec ?? 0.050;
    this.goodWindowSec = options.goodWindowSec ?? 0.120;
    this.forgiveness = options.forgiveness ?? 1.2;
  }

  /**
   * Returns lane width in meters
   * @returns {number}
   */
  getLaneWidth() {
    return this.arenaWidth / this.laneCount;
  }

  /**
   * Returns the center X coordinate for a given lane index
   * @param {number} laneIndex
   * @returns {number}
   */
  getLaneCenter(laneIndex) {
    const laneWidth = this.getLaneWidth();
    return -this.arenaWidth / 2 + (laneIndex + 0.5) * laneWidth;
  }

  /**
   * Returns { minX, maxX } nominal bounds for a given lane
   * @param {number} laneIndex
   * @returns {{ minX: number, maxX: number }}
   */
  getLaneBounds(laneIndex) {
    const laneWidth = this.getLaneWidth();
    const minX = -this.arenaWidth / 2 + laneIndex * laneWidth;
    return { minX, maxX: minX + laneWidth };
  }

  /**
   * Maps a 3D hand position (or scalar X coordinate) to a lane index [0..laneCount-1]
   * Applies forgiveness hitbox padding to outer edge lanes.
   *
   * @param {{ x: number } | number} pos
   * @param {number} [laneCount=this.laneCount]
   * @param {number} [arenaWidth=this.arenaWidth]
   * @param {number} [forgiveness=this.forgiveness]
   * @returns {number} Lane index or -1 if out of bounds
   */
  mapHandToLane(pos, laneCount = this.laneCount, arenaWidth = this.arenaWidth, forgiveness = this.forgiveness) {
    if (pos == null) return -1;
    const x = typeof pos === 'number' ? pos : pos.x;
    if (typeof x !== 'number' || isNaN(x)) return -1;

    // Multiplier for forgiveness padding (e.g. 1.2 -> 20% expanded boundary)
    const multiplier = forgiveness >= 1.0 ? forgiveness : (1.0 + forgiveness);
    const effectiveArenaWidth = arenaWidth * multiplier;
    const minX = -effectiveArenaWidth / 2;
    const maxX = effectiveArenaWidth / 2;

    if (x < minX || x > maxX) {
      return -1;
    }

    // Positions in the outer forgiveness padding map to edge lanes
    if (x <= -arenaWidth / 2) return 0;
    if (x >= arenaWidth / 2) return laneCount - 1;

    // Normal mapping within nominal arena [-arenaWidth / 2, arenaWidth / 2]
    const normalized = (x + arenaWidth / 2) / arenaWidth;
    let lane = Math.floor(normalized * laneCount);
    if (lane >= laneCount) lane = laneCount - 1;
    if (lane < 0) lane = 0;
    return lane;
  }

  /**
   * Checks if a point crossed the hit plane forward along the Z axis
   * (previous Z < hitPlaneZ and current Z >= hitPlaneZ)
   *
   * @param {number | { z: number }} prevZ
   * @param {number | { z: number }} currZ
   * @param {number} [hitPlaneZ=this.hitPlaneZ]
   * @returns {boolean}
   */
  checkCrossing(prevZ, currZ, hitPlaneZ = this.hitPlaneZ) {
    const pZ = typeof prevZ === 'number' ? prevZ : prevZ?.z;
    const cZ = typeof currZ === 'number' ? currZ : currZ?.z;
    if (typeof pZ !== 'number' || typeof cZ !== 'number') return false;
    return pZ < hitPlaneZ && cZ >= hitPlaneZ;
  }

  /**
   * Evaluates a potential hit from a specific lane index at currentTimeSec
   *
   * @param {number} lane - Target lane index [0..laneCount-1]
   * @param {number} currentTimeSec - Current song playback time in seconds
   * @param {Array<Object>} activeNotes - List of chart notes
   * @returns {Object|null} Hit evaluation result or null
   */
  evaluateLaneHit(lane, currentTimeSec, activeNotes) {
    if (lane == null || lane < 0 || !activeNotes || !Array.isArray(activeNotes)) {
      return null;
    }

    let bestCandidate = null;
    let minDiff = Infinity;

    for (const note of activeNotes) {
      if (note.played) continue;

      let matchesLane = false;
      if (note.lane === lane) {
        matchesLane = true;
      } else if (Array.isArray(note.notes) && note.notes.some(n => n.lane === lane)) {
        matchesLane = true;
      }

      if (!matchesLane) continue;

      const diffSec = Math.abs(currentTimeSec - note.timeSec);
      if (diffSec <= this.goodWindowSec && diffSec < minDiff) {
        minDiff = diffSec;
        bestCandidate = note;
      }
    }

    if (!bestCandidate) {
      return null;
    }

    bestCandidate.played = true;
    const timingDiff = currentTimeSec - bestCandidate.timeSec;
    const absDiff = Math.abs(timingDiff);

    const isPerfect = absDiff <= this.perfectWindowSec;
    const judgement = isPerfect ? JUDGEMENTS.PERFECT : JUDGEMENTS.GOOD;
    const timingScore = isPerfect ? 100 : 70;

    return {
      judgement,
      timingScore,
      timingDiff,
      timingDiffMs: timingDiff * 1000,
      note: bestCandidate,
      lane
    };
  }

  /**
   * Evaluates a potential hit from hand crossing through the hit plane
   *
   * @param {{ x: number, z: number }} prevPos
   * @param {{ x: number, z: number }} currPos
   * @param {number} currentTimeSec
   * @param {Array<Object>} activeNotes
   * @returns {Object|null} Hit evaluation result or null
   */
  evaluateCrossingHit(prevPos, currPos, currentTimeSec, activeNotes) {
    if (!this.checkCrossing(prevPos, currPos)) {
      return null;
    }

    const lane = this.mapHandToLane(currPos);
    if (lane === -1) {
      return null;
    }

    return this.evaluateLaneHit(lane, currentTimeSec, activeNotes);
  }

  /**
   * Alias for evaluateCrossingHit
   */
  evaluateHit(prevPos, currPos, currentTimeSec, activeNotes) {
    return this.evaluateCrossingHit(prevPos, currPos, currentTimeSec, activeNotes);
  }

  /**
   * Identifies notes that drifted past goodWindowSec without being hit
   *
   * @param {number} currentTimeSec
   * @param {Array<Object>} activeNotes
   * @returns {Array<Object>} List of newly missed notes
   */
  checkMissedNotes(currentTimeSec, activeNotes) {
    if (!activeNotes || !Array.isArray(activeNotes)) return [];
    const missed = [];
    for (const note of activeNotes) {
      if (!note.played && !note.missed) {
        if ((currentTimeSec - note.timeSec) > this.goodWindowSec) {
          note.missed = true;
          missed.push(note);
        }
      }
    }
    return missed;
  }

  /**
   * Evaluates chord completeness ratio and judgement rating
   *
   * @param {number} hitCount
   * @param {number} totalNotes
   * @returns {{ completeness: number, judgement: string }}
   */
  evaluateChordCompleteness(hitCount, totalNotes) {
    if (!totalNotes || totalNotes <= 0) {
      return { completeness: 0.0, judgement: JUDGEMENTS.MISS };
    }
    const completeness = hitCount / totalNotes;
    let judgement = JUDGEMENTS.MISS;
    if (completeness >= 1.0) {
      judgement = JUDGEMENTS.PERFECT;
    } else if (completeness >= 0.65) {
      judgement = JUDGEMENTS.GOOD;
    } else if (completeness > 0) {
      judgement = JUDGEMENTS.PARTIAL;
    } else {
      judgement = JUDGEMENTS.MISS;
    }
    return { completeness, judgement };
  }

  /**
   * Convenience method to evaluate chord by notes array and hits array
   *
   * @param {Array|number} chordNotes
   * @param {Array|number} hitEvents
   * @returns {{ completeness: number, judgement: string }}
   */
  evaluateChord(chordNotes, hitEvents) {
    const total = Array.isArray(chordNotes) ? chordNotes.length : (chordNotes || 0);
    const hits = Array.isArray(hitEvents) ? hitEvents.length : (hitEvents || 0);
    return this.evaluateChordCompleteness(hits, total);
  }
}

export default HitDetector;
