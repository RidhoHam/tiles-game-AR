/**
 * AR Piano Tiles — Calibration Flow, HUD, & Web AR UI System
 *
 * Implements:
 * - ScoreManager: tracks score, combo, maxCombo, accuracy, chord accuracy, rank, and "song built" metric
 * - CalibrationManager: natural reach sampling, lane width calculation, and depth offset estimation
 * - UIStateMachine: strict state flow (SCAN_SURFACE -> SELECT_SONG_MODE -> CALIBRATING -> COUNTDOWN -> PLAYING -> RESULT)
 * - ARUIController: DOM HUD controller managing floating judgements, combo pulses, countdown, modals, and SSR safety
 */

export const UI_STATES = {
  SCAN_SURFACE: 'SCAN_SURFACE',
  SELECT_SONG_MODE: 'SELECT_SONG_MODE',
  CALIBRATING: 'CALIBRATING',
  COUNTDOWN: 'COUNTDOWN',
  PLAYING: 'PLAYING',
  RESULT: 'RESULT'
};

export const BASE_SCORES = {
  PERFECT: 100,
  GOOD: 70,
  PARTIAL: 40,
  MISS: 0
};

/**
 * Calculates combo multiplier according to official PRD specification:
 * - < 10 combo: 1.0x
 * - 10 - 24 combo: 1.2x
 * - 25 - 49 combo: 1.5x
 * - 50+ combo: 2.0x
 *
 * @param {number} combo
 * @returns {number}
 */
export function getComboMultiplier(combo) {
  if (combo >= 50) return 2.0;
  if (combo >= 25) return 1.5;
  if (combo >= 10) return 1.2;
  return 1.0;
}

/**
 * ScoreManager
 * Handles real-time scoring, combo multipliers, judgements, and statistics
 */
export class ScoreManager {
  constructor() {
    this.reset();
  }

  reset() {
    this.score = 0;
    this.combo = 0;
    this.maxCombo = 0;
    this.perfectCount = 0;
    this.goodCount = 0;
    this.missCount = 0;
    this.totalNotes = 0;
    this.totalChords = 0;
    this.chordHitPoints = 0;
  }

  get accuracy() {
    if (this.totalNotes <= 0) return 0;
    return ((this.perfectCount + this.goodCount) / this.totalNotes) * 100;
  }

  get chordAccuracy() {
    if (this.totalChords <= 0) return 100;
    return (this.chordHitPoints / this.totalChords) * 100;
  }

  /**
   * "You built XX% of the song in space" punchline metric
   * @returns {number}
   */
  getSongBuiltPercentage() {
    return Math.round(this.accuracy);
  }

  /**
   * Calculates performance rank
   * @returns {'S'|'A'|'B'|'C'|'D'}
   */
  getRank() {
    const acc = this.accuracy;
    if (acc >= 95) return 'S';
    if (acc >= 85) return 'A';
    if (acc >= 70) return 'B';
    if (acc >= 50) return 'C';
    return 'D';
  }

  /**
   * Records a note hit judgement
   *
   * @param {string|Object} judgement - 'PERFECT', 'GOOD', or 'MISS'
   * @returns {Object} Evaluation details
   */
  recordHit(judgement) {
    const norm = (typeof judgement === 'string' ? judgement : judgement?.judgement || 'MISS').toUpperCase();
    this.totalNotes++;

    let baseScore = 0;
    let multiplier = 1.0;
    let points = 0;

    if (norm === 'PERFECT') {
      baseScore = BASE_SCORES.PERFECT;
      this.perfectCount++;
      this.combo++;
      if (this.combo > this.maxCombo) {
        this.maxCombo = this.combo;
      }
      multiplier = getComboMultiplier(this.combo);
      points = Math.round(baseScore * multiplier);
      this.score += points;
    } else if (norm === 'GOOD') {
      baseScore = BASE_SCORES.GOOD;
      this.goodCount++;
      this.combo++;
      if (this.combo > this.maxCombo) {
        this.maxCombo = this.combo;
      }
      multiplier = getComboMultiplier(this.combo);
      points = Math.round(baseScore * multiplier);
      this.score += points;
    } else {
      // MISS
      baseScore = BASE_SCORES.MISS;
      this.missCount++;
      this.combo = 0;
      multiplier = 1.0;
      points = 0;
    }

    return {
      judgement: norm,
      baseScore,
      multiplier,
      points,
      combo: this.combo,
      score: this.score,
      accuracy: this.accuracy
    };
  }

  /**
   * Records a chord evaluation
   * @param {{ completeness: number, judgement?: string }} chordResult
   */
  recordChord(chordResult) {
    this.totalChords++;
    let completeness = 0;
    if (chordResult && typeof chordResult.completeness === 'number') {
      completeness = chordResult.completeness;
    } else if (chordResult?.judgement === 'PERFECT') {
      completeness = 1.0;
    } else if (chordResult?.judgement === 'GOOD') {
      completeness = 0.7;
    }
    this.chordHitPoints += completeness;
  }

  /**
   * Returns complete score breakdown
   * @returns {Object}
   */
  getSummary() {
    return {
      score: this.score,
      accuracy: this.accuracy,
      maxCombo: this.maxCombo,
      perfectCount: this.perfectCount,
      goodCount: this.goodCount,
      missCount: this.missCount,
      totalNotes: this.totalNotes,
      totalChords: this.totalChords,
      chordAccuracy: this.chordAccuracy,
      songBuiltPercentage: this.getSongBuiltPercentage(),
      rank: this.getRank()
    };
  }
}

/**
 * CalibrationManager
 * Computes comfortable arena width and hit plane depth from hand tracking samples
 */
export class CalibrationManager {
  constructor(options = {}) {
    this.minSamples = options.minSamples ?? 15;
    this.defaultWidth = options.defaultWidth ?? 0.8;
    this.defaultHitPlaneZ = options.defaultHitPlaneZ ?? 0.0;
    this.minWidth = options.minWidth ?? 0.4;
    this.maxWidth = options.maxWidth ?? 1.4;
    this.samples = [];
    this.isCalibrated = false;
    this.calibrationResult = null;
  }

  reset() {
    this.samples = [];
    this.isCalibrated = false;
    this.calibrationResult = null;
  }

  /**
   * Adds a hand tracking sample
   * @param {{ x: number, y?: number, z: number } | Object} sample
   */
  addSample(sample) {
    if (!sample) return;
    let pt = sample;
    if (sample.indexTip) pt = sample.indexTip;

    if (typeof pt.x === 'number' && typeof pt.z === 'number' && !isNaN(pt.x) && !isNaN(pt.z)) {
      this.samples.push({
        x: pt.x,
        y: pt.y ?? 0,
        z: pt.z
      });
    }
  }

  getSampleCount() {
    return this.samples.length;
  }

  getProgress() {
    return Math.min(1.0, this.samples.length / this.minSamples);
  }

  /**
   * Calculates calibration parameters: optimal arena width and hit plane depth offset
   * @returns {Object}
   */
  computeCalibration() {
    if (this.samples.length === 0) {
      this.calibrationResult = {
        arenaWidth: this.defaultWidth,
        hitPlaneZ: this.defaultHitPlaneZ,
        scale: 1.0,
        depthOffset: 0.0,
        sampleCount: 0
      };
      this.isCalibrated = true;
      return this.calibrationResult;
    }

    let minX = Infinity;
    let maxX = -Infinity;
    let sumZ = 0;

    for (const s of this.samples) {
      if (s.x < minX) minX = s.x;
      if (s.x > maxX) maxX = s.x;
      sumZ += s.z;
    }

    const n = this.samples.length;
    const avgZ = sumZ / n;
    const spreadX = Math.max(0.2, maxX - minX);

    // Natural reach with 15% comfort margin
    let calculatedWidth = spreadX * 1.15;
    calculatedWidth = Math.max(this.minWidth, Math.min(this.maxWidth, calculatedWidth));

    const scale = calculatedWidth / this.defaultWidth;
    const hitPlaneZ = avgZ;
    const depthOffset = hitPlaneZ - this.defaultHitPlaneZ;

    this.isCalibrated = true;
    this.calibrationResult = {
      arenaWidth: calculatedWidth,
      hitPlaneZ,
      scale,
      depthOffset,
      sampleCount: n
    };

    return this.calibrationResult;
  }
}

/**
 * Allowed state transitions
 */
export const ALLOWED_TRANSITIONS = {
  [UI_STATES.SCAN_SURFACE]: [UI_STATES.SELECT_SONG_MODE, UI_STATES.COUNTDOWN, UI_STATES.PLAYING],
  [UI_STATES.SELECT_SONG_MODE]: [UI_STATES.CALIBRATING, UI_STATES.SCAN_SURFACE, UI_STATES.COUNTDOWN, UI_STATES.PLAYING],
  [UI_STATES.CALIBRATING]: [UI_STATES.COUNTDOWN, UI_STATES.SELECT_SONG_MODE, UI_STATES.PLAYING],
  [UI_STATES.COUNTDOWN]: [UI_STATES.PLAYING, UI_STATES.SELECT_SONG_MODE],
  [UI_STATES.PLAYING]: [UI_STATES.RESULT, UI_STATES.SELECT_SONG_MODE],
  [UI_STATES.RESULT]: [UI_STATES.SELECT_SONG_MODE, UI_STATES.SCAN_SURFACE, UI_STATES.CALIBRATING, UI_STATES.COUNTDOWN]
};

/**
 * UI State Machine
 */
export class UIStateMachine {
  constructor(initialState = UI_STATES.SCAN_SURFACE) {
    this.currentState = initialState;
    this.listeners = [];
  }

  getState() {
    return this.currentState;
  }

  canTransitionTo(nextState) {
    const allowed = ALLOWED_TRANSITIONS[this.currentState] || [];
    return allowed.includes(nextState);
  }

  transition(nextState) {
    if (!this.canTransitionTo(nextState)) {
      return false;
    }
    const prevState = this.currentState;
    this.currentState = nextState;
    for (const listener of this.listeners) {
      try {
        listener(nextState, prevState);
      } catch (e) {
        console.error('State machine listener error:', e);
      }
    }
    return true;
  }

  onStateChange(callback) {
    if (typeof callback === 'function') {
      this.listeners.push(callback);
    }
    return () => {
      this.listeners = this.listeners.filter(cb => cb !== callback);
    };
  }
}

/**
 * ARUIController — Orchestrates DOM HUD, Overlays, and UI flow
 */
export class ARUIController {
  constructor(options = {}) {
    this.container = options.container || null;
    this.stateMachine = new UIStateMachine(options.initialState || UI_STATES.SCAN_SURFACE);
    this.scoreManager = new ScoreManager();
    this.calibrationManager = new CalibrationManager(options.calibration || {});

    this.isBrowser = typeof document !== 'undefined' && typeof window !== 'undefined';
    this.elements = {};

    if (this.isBrowser) {
      this._bindElements();
    }
  }

  /**
   * Discovers and binds existing DOM elements or creates fallback references
   * @private
   */
  _bindElements() {
    if (!this.isBrowser) return;

    this.elements = {
      hudLayer: document.getElementById('hud-layer'),
      scoreText: document.getElementById('hud-score'),
      comboText: document.getElementById('hud-combo'),
      comboContainer: document.getElementById('hud-combo-container'),
      accuracyText: document.getElementById('hud-accuracy'),
      timelineProgress: document.getElementById('timeline-progress'),
      timeElapsed: document.getElementById('time-elapsed'),
      judgementLayer: document.getElementById('judgement-layer'),
      countdownOverlay: document.getElementById('countdown-overlay'),
      countdownNumber: document.getElementById('countdown-number'),
      scanBanner: document.getElementById('scan-banner'),
      songModal: document.getElementById('song-modal'),
      calibModal: document.getElementById('calib-modal'),
      calibProgressBar: document.getElementById('calib-progress-bar'),
      calibStatusText: document.getElementById('calib-status-text'),
      resultModal: document.getElementById('result-modal'),
      resultScore: document.getElementById('result-score'),
      resultAccuracy: document.getElementById('result-accuracy'),
      resultMaxCombo: document.getElementById('result-max-combo'),
      resultPerfect: document.getElementById('result-perfect'),
      resultGood: document.getElementById('result-good'),
      resultMiss: document.getElementById('result-miss'),
      resultChordAcc: document.getElementById('result-chord-accuracy'),
      resultRank: document.getElementById('result-rank'),
      resultPunchline: document.getElementById('result-punchline')
    };

    // Listen to state transitions to automatically show/hide relevant modals
    this.stateMachine.onStateChange((newState) => {
      this._updateUIForState(newState);
    });

    this._updateUIForState(this.stateMachine.getState());
  }

  /**
   * Public interface to update UI visibility for a given state
   * @param {string} state
   */
  updateUIForState(state) {
    this._updateUIForState(state);
  }

  /**
   * Toggles visibility of HUD sections based on state
   * @private
   */
  _updateUIForState(state) {
    if (!this.isBrowser) return;

    const hide = (el) => { if (el) el.classList.add('hidden'); };
    const show = (el) => { if (el) el.classList.remove('hidden'); };

    // Default: hide modals
    hide(this.elements.scanBanner);
    hide(this.elements.songModal);
    hide(this.elements.calibModal);
    hide(this.elements.countdownOverlay);
    hide(this.elements.resultModal);

    switch (state) {
      case UI_STATES.SCAN_SURFACE:
        show(this.elements.scanBanner);
        hide(this.elements.hudLayer);
        break;
      case UI_STATES.SELECT_SONG_MODE:
        show(this.elements.songModal);
        hide(this.elements.hudLayer);
        break;
      case UI_STATES.CALIBRATING:
        show(this.elements.calibModal);
        hide(this.elements.hudLayer);
        break;
      case UI_STATES.COUNTDOWN:
        show(this.elements.countdownOverlay);
        show(this.elements.hudLayer);
        break;
      case UI_STATES.PLAYING:
        show(this.elements.hudLayer);
        break;
      case UI_STATES.RESULT:
        hide(this.elements.hudLayer);
        show(this.elements.resultModal);
        break;
    }
  }

  /**
   * Displays floating judgement badge (+points) with smooth upward animation
   *
   * @param {'PERFECT'|'GOOD'|'MISS'} judgement
   * @param {number} [points=0]
   */
  showJudgement(judgement, points = 0) {
    if (!this.isBrowser || !this.elements.judgementLayer) return;

    const badge = document.createElement('div');
    badge.className = `judgement-badge judgement-${judgement.toLowerCase()}`;

    const label = document.createElement('span');
    label.className = 'judgement-label';
    label.innerText = judgement;
    badge.appendChild(label);

    if (points > 0) {
      const pts = document.createElement('span');
      pts.className = 'judgement-pts';
      pts.innerText = `+${points}`;
      badge.appendChild(pts);
    }

    this.elements.judgementLayer.appendChild(badge);

    // Auto remove after float animation finishes
    setTimeout(() => {
      if (badge.parentNode) {
        badge.parentNode.removeChild(badge);
      }
    }, 750);
  }

  /**
   * Updates real-time score, combo, and accuracy HUD
   *
   * @param {number} score
   * @param {number} combo
   * @param {number} accuracy
   */
  updateScore(score, combo, accuracy) {
    if (!this.isBrowser) return;

    if (this.elements.scoreText) {
      this.elements.scoreText.innerText = score.toLocaleString();
    }

    if (this.elements.comboText) {
      this.elements.comboText.innerText = combo;
    }

    if (this.elements.comboContainer) {
      if (combo >= 2) {
        this.elements.comboContainer.classList.remove('hidden');
        this.elements.comboContainer.classList.remove('pulse');
        // trigger reflow to replay CSS pulse
        void this.elements.comboContainer.offsetWidth;
        this.elements.comboContainer.classList.add('pulse');
      } else {
        this.elements.comboContainer.classList.add('hidden');
      }
    }

    if (this.elements.accuracyText && typeof accuracy === 'number') {
      this.elements.accuracyText.innerText = `${accuracy.toFixed(1)}%`;
    }
  }

  /**
   * Updates song timeline progress bar
   *
   * @param {number} currentSec
   * @param {number} totalSec
   */
  updateTimeline(currentSec, totalSec) {
    if (!this.isBrowser) return;

    if (this.elements.timelineProgress && totalSec > 0) {
      const pct = Math.min(100, Math.max(0, (currentSec / totalSec) * 100));
      this.elements.timelineProgress.style.width = `${pct}%`;
    }

    if (this.elements.timeElapsed) {
      const formatTime = (s) => {
        const mins = Math.floor(s / 60);
        const secs = Math.floor(s % 60);
        return `${mins}:${secs < 10 ? '0' : ''}${secs}`;
      };
      this.elements.timeElapsed.innerText = `${formatTime(currentSec)} / ${formatTime(totalSec)}`;
    }
  }

  /**
   * Triggers countdown sequence: 3 -> 2 -> 1 -> GO!
   *
   * @param {number} [startCount=3]
   * @param {Function} [onComplete]
   */
  showCountdown(startCount = 3, onComplete = null) {
    if (!this.isBrowser || !this.elements.countdownOverlay || !this.elements.countdownNumber) {
      if (typeof onComplete === 'function') onComplete();
      return;
    }

    this.elements.countdownOverlay.classList.remove('hidden');
    let current = startCount;

    const tick = () => {
      if (current > 0) {
        this.elements.countdownNumber.innerText = current;
        this.elements.countdownNumber.className = 'countdown-num pulse-zoom';
        current--;
        setTimeout(tick, 900);
      } else if (current === 0) {
        this.elements.countdownNumber.innerText = 'GO!';
        this.elements.countdownNumber.className = 'countdown-num pulse-zoom go';
        current--;
        setTimeout(tick, 700);
      } else {
        this.elements.countdownOverlay.classList.add('hidden');
        this.stateMachine.transition(UI_STATES.PLAYING);
        if (typeof onComplete === 'function') {
          onComplete();
        }
      }
    };

    tick();
  }

  /**
   * Updates calibration sample progress UI
   *
   * @param {number} progress (0.0 to 1.0)
   * @param {number} sampleCount
   */
  updateCalibrationProgress(progress, sampleCount) {
    if (!this.isBrowser) return;

    if (this.elements.calibProgressBar) {
      const pct = Math.min(100, Math.round(progress * 100));
      this.elements.calibProgressBar.style.width = `${pct}%`;
    }

    if (this.elements.calibStatusText) {
      this.elements.calibStatusText.innerText = progress >= 1.0
        ? 'Calibration Complete! Ready to play.'
        : `Hold hand steady inside guide box... (${Math.round(progress * 100)}%)`;
    }
  }

  /**
   * Displays result modal with full statistics and punchline
   *
   * @param {Object} summary
   */
  showResult(summary = {}) {
    if (!this.isBrowser) return;

    if (this.elements.resultScore) {
      this.elements.resultScore.innerText = (summary.score || 0).toLocaleString();
    }
    if (this.elements.resultAccuracy) {
      this.elements.resultAccuracy.innerText = `${(summary.accuracy || 0).toFixed(1)}%`;
    }
    if (this.elements.resultMaxCombo) {
      this.elements.resultMaxCombo.innerText = summary.maxCombo || 0;
    }
    if (this.elements.resultPerfect) {
      this.elements.resultPerfect.innerText = summary.perfectCount || 0;
    }
    if (this.elements.resultGood) {
      this.elements.resultGood.innerText = summary.goodCount || 0;
    }
    if (this.elements.resultMiss) {
      this.elements.resultMiss.innerText = summary.missCount || 0;
    }
    if (this.elements.resultChordAcc) {
      this.elements.resultChordAcc.innerText = `${(summary.chordAccuracy ?? 100).toFixed(0)}%`;
    }
    if (this.elements.resultRank) {
      this.elements.resultRank.innerText = summary.rank || 'A';
    }
    if (this.elements.resultPunchline) {
      const built = summary.songBuiltPercentage ?? Math.round(summary.accuracy || 0);
      this.elements.resultPunchline.innerText = `You built ${built}% of the song in space!`;
    }

    this.stateMachine.transition(UI_STATES.RESULT);
  }
}

export default ARUIController;
