/**
 * FingerInteractionController — Screen-Space Dynamic Piano Hitbox System
 *
 * Tracks fingertips in screen coordinates, maintains per-hand and per-finger state
 * machines ('IDLE' | 'HOVER' | 'PRESSING' | 'TRIGGERED' | 'RELEASE'), calculates downward
 * velocity (MediaPipe normalized Y), enforces debounce cooldown (75ms), and maps
 * fingers to virtual piano lanes without false auto-hits on hover.
 */

export const FINGER_STATES = Object.freeze({
  IDLE: 'IDLE',
  HOVER: 'HOVER',
  PRESSING: 'PRESSING',
  TRIGGERED: 'TRIGGERED',
  RELEASE: 'RELEASE'
});

export const FINGER_NAMES = Object.freeze(['thumb', 'index', 'middle', 'ring', 'pinky']);

export const DEFAULT_INTERACTION_CONFIG = Object.freeze({
  pressVelocityThreshold: 0.007, // Sensitive & responsive normalized Y downward movement per frame
  releaseVelocityThreshold: -0.003, // Upward velocity to transition into release
  debounceCooldownSec: 0.075, // 75ms debounce cooldown between triggers on same finger
  screenWidth: 1920,
  screenHeight: 1080
});

// Landmark index mappings for standard 21-point MediaPipe Hand Landmark sets
const FINGER_KEYPOINT_DEFS = {
  thumb: { camKey: 'cameraThumbTip', tipKey: 'thumbTip', simpleKey: 'thumb', landmarkIndex: 4 },
  index: { camKey: 'cameraIndexTip', tipKey: 'indexTip', simpleKey: 'index', landmarkIndex: 8 },
  middle: { camKey: 'cameraMiddleTip', tipKey: 'middleTip', simpleKey: 'middle', landmarkIndex: 12 },
  ring: { camKey: 'cameraRingTip', tipKey: 'ringTip', simpleKey: 'ring', landmarkIndex: 16 },
  pinky: { camKey: 'cameraPinkyTip', tipKey: 'pinkyTip', simpleKey: 'pinky', landmarkIndex: 20 }
};

/**
 * Maps a screen coordinate {x, y} to a musical lane index [0..laneCount-1]
 * on the calibrated desk canvas defined by 4 corner points { p1, p2, p3, p4 }.
 *
 * p1: back-left (top-left)
 * p2: back-right (top-right)
 * p3: front-right (bottom-right)
 * p4: front-left (bottom-left)
 *
 * @param {{ x: number, y: number } | null} pt
 * @param {{ p1: {x:number, y:number}, p2: {x:number, y:number}, p3: {x:number, y:number}, p4: {x:number, y:number} } | Array<object> | null} corners
 * @param {number} [numLanes=8]
 * @returns {number} Lane index (0-based) or -1 if out of bounds
 */
export function getLaneFromScreenPoint(pt, corners, numLanes = 8) {
  if (!pt || typeof pt.x !== 'number' || typeof pt.y !== 'number' || !corners) {
    return -1;
  }

  const p1 = corners.p1 || corners[0];
  const p2 = corners.p2 || corners[1];
  const p3 = corners.p3 || corners[2];
  const p4 = corners.p4 || corners[3];

  if (!p1 || !p2 || !p3 || !p4) {
    return -1;
  }

  // Depth vector from back center (p1..p2) to front center (p4..p3)
  const topMidX = (p1.x + p2.x) / 2;
  const topMidY = (p1.y + p2.y) / 2;
  const botMidX = (p4.x + p3.x) / 2;
  const botMidY = (p4.y + p3.y) / 2;

  const dyX = botMidX - topMidX;
  const dyY = botMidY - topMidY;
  const depthSq = dyX * dyX + dyY * dyY || 1;

  // v is position along depth axis (0 at back edge p1..p2, 1 at front edge p4..p3)
  // Negative v is the comfortable desk tapping zone BEHIND the piano
  const v = ((pt.x - topMidX) * dyX + (pt.y - topMidY) * dyY) / depthSq;

  // Vertical tolerance allowing the player to tap comfortably behind the piano on the desk [-0.70 to 1.35]
  if (v < -0.70 || v > 1.35) {
    return -1;
  }

  // Extrapolate left and right perspective boundaries at exact depth v
  // (Do NOT clamp v to 0, which breaks perspective convergence and shifts outer lanes!)
  const safeV = Math.max(-0.70, Math.min(1.35, v));
  const lx = p1.x + (p4.x - p1.x) * safeV;
  const ly = p1.y + (p4.y - p1.y) * safeV;
  const rx = p2.x + (p3.x - p2.x) * safeV;
  const ry = p2.y + (p3.y - p2.y) * safeV;

  const spanX = rx - lx;
  const spanY = ry - ly;
  const spanSq = spanX * spanX + spanY * spanY || 1;

  // u is position along width [0.0..1.0] from Left to Right at depth safeV
  const u = ((pt.x - lx) * spanX + (pt.y - ly) * spanY) / spanSq;

  // Generous horizontal tolerance on left & right edges (-0.08 to 1.08)
  if (u < -0.08 || u > 1.08) {
    return -1;
  }

  const clampedU = Math.max(0, Math.min(0.999, u));

  // In 2-Octave Real Piano mode (numLanes === 14), detect both Black and White keys
  if (numLanes === 14) {
    const BLACK_KEY_SEAMS = {
      1: 49,  // C#3 between C3(0) and D3(1)
      2: 51,  // D#3 between D3(1) and E3(2)
      4: 54,  // F#3 between F3(3) and G3(4)
      5: 56,  // G#3 between G3(4) and A3(5)
      6: 58,  // A#3 between A3(5) and B3(6)
      8: 61,  // C#4 between C4(7) and D4(8)
      9: 63,  // D#4 between D4(8) and E4(9)
      11: 66, // F#4 between F4(10) and G4(11)
      12: 68, // G#4 between G4(11) and A4(12)
      13: 70  // A#4 between A4(12) and B4(13)
    };

    // Black keys sit on desk behind keys (v <= 0) and upper key area (v <= 0.65)
    // Tolerance is 0.014 in u space (~40% of white key width 0.0714), leaving generous room for white keys
    if (v <= 0.65) {
      for (const [seamStr, midi] of Object.entries(BLACK_KEY_SEAMS)) {
        const seam = Number(seamStr);
        const centerU = seam / 14;
        if (Math.abs(u - centerU) <= 0.014) {
          return midi;
        }
      }
    }

    return Math.floor(clampedU * 14);
  }

  return Math.floor(clampedU * numLanes);
}

/**
 * FingerInteractionController
 *
 * Manages tracking and state transitions for individual fingers across both hands.
 */
export class FingerInteractionController {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.pressVelocityThreshold=0.015] - Downward velocity threshold to trigger press
   * @param {number} [options.releaseVelocityThreshold=-0.005] - Upward velocity threshold to transition to release
   * @param {number} [options.debounceCooldownSec=0.075] - Cooldown period in seconds (default 75ms)
   * @param {number} [options.debounceCooldownMs] - Alternative cooldown in milliseconds
   * @param {number} [options.screenWidth=1920] - Screen width for pixel coordinates
   * @param {number} [options.screenHeight=1080] - Screen height for pixel coordinates
   * @param {Function} [options.getScreenPoint] - Custom screen projection function
   */
  constructor(options = {}) {
    const defaultW = typeof window !== 'undefined' && window.innerWidth ? window.innerWidth : DEFAULT_INTERACTION_CONFIG.screenWidth;
    const defaultH = typeof window !== 'undefined' && window.innerHeight ? window.innerHeight : DEFAULT_INTERACTION_CONFIG.screenHeight;

    this.pressVelocityThreshold = options.pressVelocityThreshold ?? DEFAULT_INTERACTION_CONFIG.pressVelocityThreshold;
    this.releaseVelocityThreshold = options.releaseVelocityThreshold ?? DEFAULT_INTERACTION_CONFIG.releaseVelocityThreshold;
    this.debounceCooldownSec = options.debounceCooldownSec ?? (options.debounceCooldownMs ? options.debounceCooldownMs / 1000 : DEFAULT_INTERACTION_CONFIG.debounceCooldownSec);
    this.screenWidth = options.screenWidth ?? defaultW;
    this.screenHeight = options.screenHeight ?? defaultH;
    this.getScreenPoint = typeof options.getScreenPoint === 'function' ? options.getScreenPoint : null;
    this.primaryFingerOnly = options.primaryFingerOnly ?? false;

    // Per-hand and per-finger states: Map<string, Object>
    // Key: `${hand}:${finger}` (e.g. 'Right:index')
    this.fingerStates = new Map();

    // Active hovered lane indices: Set<number>
    this.hoverLanes = new Set();
  }

  /**
   * Sets whether only 1 primary finger per hand is tracked (2-finger mode)
   * or all 10 fingers across both hands are tracked (all-fingers mode).
   * @param {boolean} enabled
   */
  setPrimaryFingerOnly(enabled) {
    this.primaryFingerOnly = Boolean(enabled);
  }

  /**
   * Helper to format consistent map key
   * @private
   */
  _getFingerKey(hand, finger) {
    const h = String(hand || 'Right').trim();
    const normalizedHand = h.toLowerCase().startsWith('l') ? 'Left' : 'Right';
    return `${normalizedHand}:${String(finger).toLowerCase()}`;
  }

  /**
   * Extract raw point coordinates for a specific finger from hand object
   * @private
   */
  _extractFingerPoint(hand, fingerName) {
    if (!hand) return null;

    const def = FINGER_KEYPOINT_DEFS[fingerName];
    if (!def) return null;

    // Check direct finger name if hand is a finger descriptor
    if (hand.finger === fingerName && (typeof hand.x === 'number' || typeof hand.screenX === 'number')) {
      return hand;
    }

    // Check nested fingers object
    if (hand.fingers && hand.fingers[fingerName]) {
      return hand.fingers[fingerName];
    }

    // Check camera landmark point (MediaPipe normalized)
    if (hand[def.camKey]) {
      return hand[def.camKey];
    }

    // Check tip key (e.g. indexTip)
    if (hand[def.tipKey]) {
      return hand[def.tipKey];
    }

    // Check simple key (e.g. index)
    if (hand[def.simpleKey]) {
      return hand[def.simpleKey];
    }

    // Check raw 21-element landmark array
    if (Array.isArray(hand) && hand[def.landmarkIndex]) {
      return hand[def.landmarkIndex];
    }
    if (Array.isArray(hand.landmarks) && hand.landmarks[def.landmarkIndex]) {
      return hand.landmarks[def.landmarkIndex];
    }
    if (Array.isArray(hand.rawLandmarks) && hand.rawLandmarks[def.landmarkIndex]) {
      return hand.rawLandmarks[def.landmarkIndex];
    }

    return null;
  }

  /**
   * Resolves screen position and normalized position from extracted fingertip point
   * @private
   */
  _resolveCoordinates(rawPt, corners) {
    if (!rawPt) return null;

    const screenW = this.screenWidth;
    const screenH = this.screenHeight;

    // Check if corners are in pixel coordinates (> 1.5) or normalized coordinates
    const p1 = corners?.p1 || corners?.[0];
    const p2 = corners?.p2 || corners?.[1];
    const isCornersPixel = p1 && ((p1.x > 1.5 || p1.y > 1.5) || (p2 && p2.x > 1.5));

    let screenX, screenY, normX, normY;

    // If explicit screen coordinates provided
    if (typeof rawPt.screenX === 'number' && typeof rawPt.screenY === 'number') {
      screenX = rawPt.screenX;
      screenY = rawPt.screenY;
      normX = typeof rawPt.normX === 'number' ? rawPt.normX : screenX / screenW;
      normY = typeof rawPt.normY === 'number' ? rawPt.normY : screenY / screenH;
    } else if (typeof rawPt.x === 'number' && typeof rawPt.y === 'number') {
      // If custom projection hook provided
      if (this.getScreenPoint) {
        const proj = this.getScreenPoint(rawPt, rawPt, screenW, screenH);
        if (proj) {
          screenX = proj.x;
          screenY = proj.y;
          normX = screenX / screenW;
          normY = screenY / screenH;
        }
      }

      if (screenX === undefined) {
        if (isCornersPixel) {
          if (rawPt.x <= 1.0 && rawPt.y <= 1.0) {
            // Normalized MediaPipe coordinates -> screen pixels
            normX = rawPt.x;
            normY = rawPt.y;
            screenX = rawPt.x * screenW;
            screenY = rawPt.y * screenH;
          } else {
            // Already screen pixels
            screenX = rawPt.x;
            screenY = rawPt.y;
            normX = screenX / screenW;
            normY = screenY / screenH;
          }
        } else {
          // Corners are in normalized space [0..1]
          if (rawPt.x <= 1.0 && rawPt.y <= 1.0) {
            screenX = rawPt.x;
            screenY = rawPt.y;
            normX = rawPt.x;
            normY = rawPt.y;
          } else {
            normX = rawPt.x / screenW;
            normY = rawPt.y / screenH;
            screenX = normX;
            screenY = normY;
          }
        }
      }
    } else {
      return null;
    }

    return { screenX, screenY, normX, normY };
  }

  /**
   * Updates all finger positions, velocities, and state machines.
   *
   * @param {Array<Object>|Object|null} hands - MediaPipe hand objects or array of hand structures
   * @param {Object|Array} corners - Desk/piano keyboard corner bounds { p1, p2, p3, p4 }
   * @param {number} [laneCount=8] - Number of musical lanes
   * @param {number} [currentTimeSec] - Current timestamp in seconds
   * @returns {Array<Object>} List of triggered press events: [{ hand, finger, lane, timeSec, screenX, screenY, velocityY }]
   */
  update(hands, corners, laneCount = 8, currentTimeSec) {
    const timeSec = typeof currentTimeSec === 'number'
      ? currentTimeSec
      : (typeof performance !== 'undefined' ? performance.now() / 1000 : Date.now() / 1000);

    const handList = Array.isArray(hands) ? hands : (hands ? [hands] : []);
    const pressEvents = [];
    const updatedKeys = new Set();
    const activeHoverLanes = new Set();

    for (let hIdx = 0; hIdx < handList.length; hIdx++) {
      const hand = handList[hIdx];
      if (!hand) continue;

      // Classify handedness
      let rawHand = hand.handedness || hand.hand || (hIdx === 0 ? 'Right' : 'Left');
      if (typeof rawHand === 'object' && rawHand !== null) {
        rawHand = rawHand.categoryName || rawHand.displayName || 'Right';
      }
      const handName = String(rawHand).toLowerCase().startsWith('l') ? 'Left' : 'Right';

      // Select fingers to track: when primaryFingerOnly is enabled, strictly track only the index finger (no thumb/palm noise)
      let fingerNames = FINGER_NAMES;
      if (this.primaryFingerOnly) {
        fingerNames = ['index'];
      }

      const handPressEvents = [];
      for (const fingerName of fingerNames) {
        const fingerKey = this._getFingerKey(handName, fingerName);
        const rawPt = this._extractFingerPoint(hand, fingerName);

        if (!rawPt) continue;

        const coords = this._resolveCoordinates(rawPt, corners);
        if (!coords) continue;

        updatedKeys.add(fingerKey);

        const { screenX, screenY, normX, normY } = coords;

        // Retrieve or initialize per-finger state object
        let stateObj = this.fingerStates.get(fingerKey);
        if (!stateObj) {
          stateObj = {
            hand: handName,
            finger: fingerName,
            state: FINGER_STATES.IDLE,
            lane: -1,
            screenX,
            screenY,
            normX,
            normY,
            previousNormY: null,
            velocityY: 0,
            lastTriggerTimeSec: -Infinity,
            active: true
          };
          this.fingerStates.set(fingerKey, stateObj);
        }

        stateObj.active = true;
        stateObj.screenX = screenX;
        stateObj.screenY = screenY;
        stateObj.normX = normX;

        // Determine current lane from screen point and corners
        const lane = getLaneFromScreenPoint({ x: screenX, y: screenY }, corners, laneCount);
        stateObj.lane = lane;

        // Calculate downward velocity
        // MediaPipe normalized Y increases downwards
        let velocityY = 0;
        if (typeof rawPt.velocityY === 'number') {
          velocityY = rawPt.velocityY;
        } else if (stateObj.previousNormY !== null) {
          velocityY = normY - stateObj.previousNormY;
        } else {
          velocityY = 0;
        }
        stateObj.velocityY = velocityY;

        // Inside or outside piano hitbox
        const isInsideHitbox = lane >= 0;

        if (!isInsideHitbox) {
          // Outside hitbox: finger is IDLE
          stateObj.state = FINGER_STATES.IDLE;
        } else {
          // Inside hitbox: finger is hovering over a valid lane
          activeHoverLanes.add(lane);

          const prevState = stateObj.state;
          const isDownwardStrike = velocityY > this.pressVelocityThreshold;
          const isUpwardRelease = velocityY < this.releaseVelocityThreshold;

          if (prevState === FINGER_STATES.IDLE) {
            // Finger entered hitbox from outside: enters HOVER state.
            // Stationary finger stays in HOVER without false auto-hit!
            stateObj.state = FINGER_STATES.HOVER;
          } else if (prevState === FINGER_STATES.HOVER) {
            if (isDownwardStrike) {
              // Transition from HOVER -> PRESSING triggered by downward velocity
              const canTrigger = (timeSec - stateObj.lastTriggerTimeSec) >= this.debounceCooldownSec;
              if (canTrigger) {
                stateObj.state = FINGER_STATES.PRESSING;
                stateObj.lastTriggerTimeSec = timeSec;

                handPressEvents.push({
                  hand: handName,
                  finger: fingerName,
                  lane,
                  timeSec,
                  screenX,
                  screenY,
                  velocityY
                });
              } else {
                // Debounce cooldown active: suppress duplicate press
                stateObj.state = FINGER_STATES.TRIGGERED;
              }
            } else if (isUpwardRelease) {
              stateObj.state = FINGER_STATES.RELEASE;
            } else {
              stateObj.state = FINGER_STATES.HOVER;
            }
          } else if (prevState === FINGER_STATES.PRESSING) {
            // Already pressed: transition to TRIGGERED or RELEASE
            if (isUpwardRelease) {
              stateObj.state = FINGER_STATES.RELEASE;
            } else {
              stateObj.state = FINGER_STATES.TRIGGERED;
            }
          } else if (prevState === FINGER_STATES.TRIGGERED) {
            if (isUpwardRelease) {
              stateObj.state = FINGER_STATES.RELEASE;
            } else {
              stateObj.state = FINGER_STATES.TRIGGERED;
            }
          } else if (prevState === FINGER_STATES.RELEASE) {
            if (isDownwardStrike) {
              const canTrigger = (timeSec - stateObj.lastTriggerTimeSec) >= this.debounceCooldownSec;
              if (canTrigger) {
                stateObj.state = FINGER_STATES.PRESSING;
                stateObj.lastTriggerTimeSec = timeSec;

                handPressEvents.push({
                  hand: handName,
                  finger: fingerName,
                  lane,
                  timeSec,
                  screenX,
                  screenY,
                  velocityY
                });
              } else {
                stateObj.state = FINGER_STATES.TRIGGERED;
              }
            } else if (isUpwardRelease) {
              stateObj.state = FINGER_STATES.RELEASE;
            } else {
              // Upward motion stopped: settled back into HOVER
              stateObj.state = FINGER_STATES.HOVER;
            }
          }
        }

        // Store normY for next frame velocity computation
        stateObj.previousNormY = normY;
      }

      if (this.primaryFingerOnly && handPressEvents.length > 1) {
        handPressEvents.sort((a, b) => b.velocityY - a.velocityY);
        pressEvents.push(handPressEvents[0]);
      } else {
        pressEvents.push(...handPressEvents);
      }
    }

    // Inactivate any fingers that were not present in this frame
    for (const [key, stateObj] of this.fingerStates.entries()) {
      if (!updatedKeys.has(key)) {
        stateObj.active = false;
        stateObj.state = FINGER_STATES.IDLE;
        stateObj.lane = -1;
        stateObj.previousNormY = null;
        stateObj.velocityY = 0;
      }
    }

    this.hoverLanes = activeHoverLanes;
    return pressEvents;
  }

  /**
   * Returns Set of currently hovered lane indices
   * @returns {Set<number>}
   */
  getHoverLanes() {
    return new Set(this.hoverLanes);
  }

  /**
   * Returns array of active finger state objects for rendering or debug inspection
   * @param {boolean} [activeOnly=true] - If true, only returns fingers detected in current frame
   * @returns {Array<Object>}
   */
  getFingerStates(activeOnly = true) {
    const list = [];
    for (const state of this.fingerStates.values()) {
      if (!activeOnly || state.active) {
        list.push({ ...state });
      }
    }
    return list;
  }

  /**
   * Get specific finger state by hand and finger name
   * @param {string} [hand='Right']
   * @param {string} [finger='index']
   * @returns {Object|null}
   */
  getFingerState(hand = 'Right', finger = 'index') {
    const key = this._getFingerKey(hand, finger);
    const state = this.fingerStates.get(key);
    return state ? { ...state } : null;
  }

  /**
   * Explicitly sets a finger's state (useful for test setup and manual overrides)
   * @param {string} hand
   * @param {string} finger
   * @param {string} stateName
   */
  setFingerState(hand, finger, stateName) {
    const key = this._getFingerKey(hand, finger);
    let stateObj = this.fingerStates.get(key);
    if (!stateObj) {
      stateObj = {
        hand: String(hand).toLowerCase().startsWith('l') ? 'Left' : 'Right',
        finger: String(finger).toLowerCase(),
        state: stateName,
        lane: -1,
        screenX: 0,
        screenY: 0,
        normX: 0,
        normY: 0,
        previousNormY: null,
        velocityY: 0,
        lastTriggerTimeSec: -Infinity,
        active: true
      };
      this.fingerStates.set(key, stateObj);
    } else {
      stateObj.state = stateName;
    }
  }

  /**
   * Resets all tracked finger states and hovered lanes
   */
  reset() {
    this.fingerStates.clear();
    this.hoverLanes.clear();
  }
}

export default FingerInteractionController;
