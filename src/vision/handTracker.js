/**
 * MediaPipe Hand Landmarker Vision Module
 *
 * Implements:
 * - HandTracker initialization via official CDN (@mediapipe/tasks-vision)
 * - 2-hand simultaneous tracking (numHands: 2, runningMode: "VIDEO")
 * - 21-landmark extraction (wrist: 0, thumbTip: 4, indexTip: 8, middleTip: 12)
 * - Handedness classification ('Left' vs 'Right')
 * - World coordinate transformation (camera normalized -> 3D arena coordinates)
 * - Exponential Moving Average (EMA) smoothing for stability against camera noise
 * - Velocity tracking for hit plane crossing detection
 * - Node/SSR-safe execution without DOM/WebGL crashes
 */

export const MEDIAPIPE_CDN_WASM = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm';
export const MEDIAPIPE_CDN_BUNDLE = 'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/+esm';
export const DEFAULT_MODEL_URL = 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task';

export const LANDMARK_INDICES = {
  WRIST: 0,
  THUMB_CMC: 1,
  THUMB_MCP: 2,
  THUMB_IP: 3,
  THUMB_TIP: 4,
  INDEX_FINGER_MCP: 5,
  INDEX_FINGER_PIP: 6,
  INDEX_FINGER_DIP: 7,
  INDEX_FINGER_TIP: 8,
  MIDDLE_FINGER_MCP: 9,
  MIDDLE_FINGER_PIP: 10,
  MIDDLE_FINGER_DIP: 11,
  MIDDLE_FINGER_TIP: 12,
  RING_FINGER_MCP: 13,
  RING_FINGER_PIP: 14,
  RING_FINGER_DIP: 15,
  RING_FINGER_TIP: 16,
  PINKY_MCP: 17,
  PINKY_PIP: 18,
  PINKY_DIP: 19,
  PINKY_TIP: 20
};

/**
 * Exponential Moving Average (EMA) filter
 * S_t = alpha * Y_t + (1 - alpha) * S_{t-1}
 *
 * @param {number|Object|Array} prev - Previous smoothed value or point
 * @param {number|Object|Array} curr - Current raw value or point
 * @param {number} [alpha=0.5] - Smoothing factor in (0, 1]. Higher = faster, lower = smoother
 * @returns {number|Object|Array} Smoothed output
 */
export function applyEmaSmoothing(prev, curr, alpha = 0.5) {
  if (curr === null || curr === undefined) return prev ?? null;
  if (prev === null || prev === undefined) {
    if (Array.isArray(curr)) return curr.map(item => (typeof item === 'object' ? { ...item } : item));
    if (typeof curr === 'object') return { ...curr };
    return curr;
  }

  // Scalar number smoothing
  if (typeof curr === 'number' && typeof prev === 'number') {
    return alpha * curr + (1 - alpha) * prev;
  }

  // Array of points smoothing
  if (Array.isArray(curr)) {
    if (Array.isArray(prev)) {
      return curr.map((c, i) => applyEmaSmoothing(prev[i], c, alpha));
    }
    return curr.map(item => (typeof item === 'object' ? { ...item } : item));
  }

  // 3D coordinate object { x, y, z } smoothing
  if (typeof curr === 'object' && typeof prev === 'object') {
    const result = { ...curr };

    if (typeof curr.x === 'number' && typeof prev.x === 'number') {
      result.x = alpha * curr.x + (1 - alpha) * prev.x;
    }
    if (typeof curr.y === 'number' && typeof prev.y === 'number') {
      result.y = alpha * curr.y + (1 - alpha) * prev.y;
    }
    if (typeof curr.z === 'number' && typeof prev.z === 'number') {
      result.z = alpha * curr.z + (1 - alpha) * prev.z;
    }

    // Recursively smooth nested tip objects if present
    for (const key of ['indexTip', 'thumbTip', 'middleTip', 'wrist', 'ringTip', 'pinkyTip']) {
      if (curr[key] && prev[key]) {
        result[key] = applyEmaSmoothing(prev[key], curr[key], alpha);
      }
    }

    return result;
  }

  return curr;
}

/**
 * Extracts key landmark points from raw 21 MediaPipe hand landmarks
 *
 * @param {Array<Object>} landmarks - Array of 21 landmark points {x, y, z}
 * @returns {Object|null} Extracted keypoints { wrist, thumbTip, indexTip, middleTip, raw }
 */
export function extractKeypoints(landmarks) {
  if (!landmarks || !Array.isArray(landmarks) || landmarks.length === 0) {
    return null;
  }

  const getPoint = (idx) => {
    const pt = landmarks[idx];
    if (!pt) return { x: 0, y: 0, z: 0 };
    return {
      x: typeof pt.x === 'number' ? pt.x : 0,
      y: typeof pt.y === 'number' ? pt.y : 0,
      z: typeof pt.z === 'number' ? pt.z : 0
    };
  };

  return {
    wrist: getPoint(LANDMARK_INDICES.WRIST),
    thumbTip: getPoint(LANDMARK_INDICES.THUMB_TIP),
    indexTip: getPoint(LANDMARK_INDICES.INDEX_FINGER_TIP),
    middleTip: getPoint(LANDMARK_INDICES.MIDDLE_FINGER_TIP),
    ringTip: getPoint(LANDMARK_INDICES.RING_FINGER_TIP),
    pinkyTip: getPoint(LANDMARK_INDICES.PINKY_TIP),
    raw: landmarks.map(pt => ({
      x: typeof pt.x === 'number' ? pt.x : 0,
      y: typeof pt.y === 'number' ? pt.y : 0,
      z: typeof pt.z === 'number' ? pt.z : 0
    }))
  };
}

/**
 * Classifies handedness ('Left' or 'Right') from MediaPipe handedness structures
 *
 * @param {Array|Object} handednessEntry - Category list from MediaPipe result
 * @param {string} [defaultHand='Right'] - Fallback handedness
 * @returns {{ handedness: 'Left'|'Right', confidence: number }}
 */
export function classifyHandedness(handednessEntry, defaultHand = 'Right') {
  if (!handednessEntry) {
    return { handedness: defaultHand, confidence: 0.0 };
  }

  const item = Array.isArray(handednessEntry) ? handednessEntry[0] : handednessEntry;
  if (!item) {
    return { handedness: defaultHand, confidence: 0.0 };
  }

  const name = item.categoryName || item.displayName || item.label || (typeof item === 'string' ? item : null);
  const confidence = typeof item.score === 'number' ? item.score : 0.0;

  let handedness = defaultHand;
  if (name) {
    const lower = String(name).trim().toLowerCase();
    if (lower.startsWith('l')) handedness = 'Left';
    else if (lower.startsWith('r')) handedness = 'Right';
  }

  return { handedness, confidence };
}

/**
 * Detects if thumb and index tips are pinching
 *
 * @param {Object} handKeypoints - Keypoints with thumbTip and indexTip
 * @param {number} [threshold=0.08] - Distance threshold
 * @returns {{ isPinching: boolean, distance: number }}
 */
export function detectPinch(handKeypoints, threshold = 0.08) {
  if (!handKeypoints || !handKeypoints.thumbTip || !handKeypoints.indexTip) {
    return { isPinching: false, distance: 1.0 };
  }

  const dx = handKeypoints.thumbTip.x - handKeypoints.indexTip.x;
  const dy = handKeypoints.thumbTip.y - handKeypoints.indexTip.y;
  const dz = (handKeypoints.thumbTip.z || 0) - (handKeypoints.indexTip.z || 0);
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

  return {
    isPinching: distance < threshold,
    distance: Number(distance.toFixed(4))
  };
}

/**
 * Calculates spatial span, width, and center between two hands (e.g. for dynamic table placement)
 *
 * @param {Object} leftHand
 * @param {Object} rightHand
 * @returns {Object|null}
 */
export function calculateTwoHandSpan(leftHand, rightHand) {
  if (!leftHand || !rightHand || !leftHand.indexTip || !rightHand.indexTip) {
    return null;
  }

  const leftPt = leftHand.indexTip;
  const rightPt = rightHand.indexTip;

  const width = Math.abs(rightPt.x - leftPt.x);
  const centerX = (leftPt.x + rightPt.x) / 2;
  const centerY = (leftPt.y + rightPt.y) / 2;
  const centerZ = (leftPt.z + rightPt.z) / 2;

  const bothPinching = Boolean(leftHand.isPinching && rightHand.isPinching);

  return {
    width: Number(width.toFixed(4)),
    centerX: Number(centerX.toFixed(4)),
    centerY: Number(centerY.toFixed(4)),
    centerZ: Number(centerZ.toFixed(4)),
    bothPinching,
    leftPt,
    rightPt
  };
}

/**
 * Transforms normalized camera coordinates (or a full hand state) to 3D arena coordinates
 *
 * Camera: x in [0, 1] (left to right), y in [0, 1] (top to bottom), z relative depth
 * Arena: x in [-width/2, +width/2], y in [-height/2, +height/2] (inverted Y), z metric/hit-plane
 *
 * @param {Object} input - Point {x, y, z} or full HandState
 * @param {Object} [config={}] - Arena configuration
 * @returns {Object|null} Transformed point or HandState
 */
export function mapToArenaSpace(input, config = {}) {
  if (!input || typeof input !== 'object') return null;

  const arenaWidth = config.arenaWidth ?? 0.8;
  const arenaHeight = config.arenaHeight ?? 0.6;
  const hitPlaneZ = config.hitPlaneZ ?? 0.0;
  const mirror = config.mirror !== false;
  const zScale = config.zScale ?? 1.0;
  const zOffset = config.zOffset ?? 0.0;

  const transformPoint = (pt) => {
    if (!pt || typeof pt !== 'object') return pt;
    const rawX = typeof pt.x === 'number' ? pt.x : 0.5;
    const rawY = typeof pt.y === 'number' ? pt.y : 0.5;
    const rawZ = typeof pt.z === 'number' ? pt.z : 0.0;

    const normX = mirror ? 1.0 - rawX : rawX;
    const arenaX = (normX - 0.5) * arenaWidth;
    const arenaY = (0.5 - rawY) * arenaHeight;
    const arenaZ = (rawZ - zOffset) * zScale + hitPlaneZ;

    return {
      x: Number(arenaX.toFixed(6)),
      y: Number(arenaY.toFixed(6)),
      z: Number(arenaZ.toFixed(6))
    };
  };

  // If input is a single 3D point
  if (typeof input.x === 'number' && typeof input.y === 'number') {
    return transformPoint(input);
  }

  // Otherwise transform all landmark keypoints in HandState
  const mapped = { ...input };
  if (input.indexTip) mapped.indexTip = transformPoint(input.indexTip);
  if (input.thumbTip) mapped.thumbTip = transformPoint(input.thumbTip);
  if (input.middleTip) mapped.middleTip = transformPoint(input.middleTip);
  if (input.wrist) mapped.wrist = transformPoint(input.wrist);
  if (input.ringTip) mapped.ringTip = transformPoint(input.ringTip);
  if (input.pinkyTip) mapped.pinkyTip = transformPoint(input.pinkyTip);
  if (Array.isArray(input.rawLandmarks)) {
    mapped.rawLandmarks = input.rawLandmarks.map(transformPoint);
  }

  return mapped;
}

/**
 * HandTracker — MediaPipe Hand Landmarker Vision Module
 *
 * Manages vision models, video frame processing, EMA smoothing,
 * arena coordinate mapping, and 2-hand state tracking.
 */
export class HandTracker {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.numHands=2] - Number of hands to detect (1 or 2)
   * @param {string} [options.runningMode="VIDEO"] - MediaPipe running mode ("VIDEO" or "IMAGE")
   * @param {number} [options.alpha=0.4] - EMA smoothing factor (0 to 1)
   * @param {boolean} [options.mirror=true] - Mirror camera horizontally for natural interaction
   * @param {Object} [options.arenaConfig] - 3D arena spatial configuration
   * @param {Object} [options.handLandmarker] - Injected landmarker instance (useful for testing)
   */
  constructor(options = {}) {
    this.numHands = options.numHands ?? 2;
    this.runningMode = options.runningMode || 'VIDEO';
    this.alpha = options.alpha ?? 0.4;
    this.mirror = options.mirror ?? true;
    this.arenaConfig = {
      arenaWidth: options.arenaConfig?.arenaWidth ?? 0.8,
      arenaHeight: options.arenaConfig?.arenaHeight ?? 0.6,
      hitPlaneZ: options.arenaConfig?.hitPlaneZ ?? 0.0,
      zScale: options.arenaConfig?.zScale ?? 1.0,
      zOffset: options.arenaConfig?.zOffset ?? 0.0,
      mirror: this.mirror,
      ...options.arenaConfig
    };

    this.handLandmarker = options.handLandmarker || options.mockLandmarker || null;
    this.initialized = Boolean(this.handLandmarker);
    this.lastTimestamp = 0;
    this.currentHands = [];
    this.previousHandsByHandedness = new Map();
  }

  /**
   * Checks if vision landmarker is ready for inference
   * @returns {boolean}
   */
  isReady() {
    return Boolean(this.initialized && this.handLandmarker);
  }

  /**
   * Initializes MediaPipe Tasks Vision FilesetResolver and HandLandmarker
   *
   * @param {Object} [options={}]
   * @returns {Promise<HandTracker>}
   */
  async init(options = {}) {
    if (options.handLandmarker || options.mockLandmarker) {
      this.handLandmarker = options.handLandmarker || options.mockLandmarker;
      this.initialized = true;
      return this;
    }

    const wasmPath = options.wasmPath || MEDIAPIPE_CDN_WASM;
    const modelAssetPath = options.modelAssetPath || DEFAULT_MODEL_URL;
    const delegate = options.delegate || 'GPU';
    this.numHands = options.numHands ?? this.numHands;
    this.runningMode = options.runningMode || this.runningMode;

    // Node/SSR safe guard: Avoid crashing in environments without DOM/WebGL
    if (typeof window === 'undefined' && !options.FilesetResolver) {
      this.initialized = true;
      return this;
    }

    try {
      let FilesetResolver = options.FilesetResolver;
      let HandLandmarker = options.HandLandmarker;

      if (!FilesetResolver || !HandLandmarker) {
        let tasksVision = (typeof window !== 'undefined' && window.tasksVision);
        if (!tasksVision) {
          try {
            tasksVision = await import(/* webpackIgnore: true */ options.bundleUrl || MEDIAPIPE_CDN_BUNDLE);
          } catch (err) {
            console.warn('[HandTracker] tasks-vision bundle dynamic import failed:', err.message);
          }
        }
        FilesetResolver = FilesetResolver || tasksVision?.FilesetResolver;
        HandLandmarker = HandLandmarker || tasksVision?.HandLandmarker;
      }

      if (FilesetResolver && HandLandmarker) {
        const vision = await FilesetResolver.forVisionTasks(wasmPath);
        this.handLandmarker = await HandLandmarker.createFromOptions(vision, {
          baseOptions: {
            modelAssetPath,
            delegate
          },
          runningMode: this.runningMode,
          numHands: this.numHands
        });
        this.initialized = true;
      } else {
        this.initialized = true;
      }
    } catch (err) {
      console.warn('[HandTracker] MediaPipe initialization error:', err);
      this.initialized = true;
    }

    return this;
  }

  /**
   * Detects hand landmarks from video element and updates smoothed hand states
   *
   * @param {HTMLVideoElement} videoElement
   * @param {number} timestamp - Current timestamp in milliseconds
   * @returns {Array<Object>} Smoothed hand states
   */
  detectForVideo(videoElement, timestamp = 0) {
    if (!this.handLandmarker) {
      return this.currentHands;
    }

    let result;
    try {
      result = this.handLandmarker.detectForVideo(videoElement, timestamp);
    } catch (err) {
      console.warn('[HandTracker] detectForVideo execution error:', err);
      return this.currentHands;
    }

    if (!result || !result.landmarks || result.landmarks.length === 0) {
      this.currentHands = [];
      return [];
    }

    const landmarksList = result.landmarks;
    const handednessesList = result.handednesses || result.handedness || [];
    const rawHands = [];

    for (let i = 0; i < landmarksList.length; i++) {
      const rawLandmarks = landmarksList[i];
      const keypoints = extractKeypoints(rawLandmarks);
      if (!keypoints) continue;

      const handednessData = handednessesList[i];
      const defaultHand = (landmarksList.length === 2 && i === 0) ? 'Left' : 'Right';
      const { handedness, confidence } = classifyHandedness(handednessData, defaultHand);
      const pinch = detectPinch(keypoints);

      const rawHandState = {
        handedness,
        confidence,
        isPinching: pinch.isPinching,
        pinchDistance: pinch.distance,
        indexTip: keypoints.indexTip,
        thumbTip: keypoints.thumbTip,
        middleTip: keypoints.middleTip,
        wrist: keypoints.wrist,
        ringTip: keypoints.ringTip,
        pinkyTip: keypoints.pinkyTip,
        rawLandmarks: keypoints.raw
      };

      const arenaHand = this.mapToArenaSpace(rawHandState, this.arenaConfig);
      rawHands.push(arenaHand);
    }

    const smoothedHands = this.applySmoothing(rawHands, this.alpha, timestamp);
    this.currentHands = smoothedHands;
    this.lastTimestamp = timestamp;

    return this.currentHands;
  }

  /**
   * Alias for detectForVideo
   */
  processVideo(videoElement, timestamp = 0) {
    return this.detectForVideo(videoElement, timestamp);
  }

  /**
   * Smooths raw hand states using EMA filter and computes velocity vector
   *
   * @param {Array<Object>} rawHandStates - Raw hand state objects
   * @param {number} [alpha=this.alpha] - Smoothing factor
   * @param {number} [timestamp=0] - Frame timestamp in ms
   * @returns {Array<Object>}
   */
  applySmoothing(rawHandStates, alpha = this.alpha, timestamp = 0) {
    if (!Array.isArray(rawHandStates)) return [];

    const effectiveAlpha = typeof alpha === 'number' ? alpha : this.alpha;
    const dt = this.lastTimestamp && timestamp > this.lastTimestamp
      ? (timestamp - this.lastTimestamp) / 1000.0
      : 0.033; // ~30 FPS default

    const smoothedHands = [];

    for (const raw of rawHandStates) {
      const prev = this.previousHandsByHandedness.get(raw.handedness);
      let smoothedHand;

      if (!prev) {
        smoothedHand = {
          ...raw,
          velocity: { x: 0, y: 0, z: 0 },
          previousIndexTip: { ...raw.indexTip }
        };
      } else {
        const smoothedIndex = applyEmaSmoothing(prev.indexTip, raw.indexTip, effectiveAlpha);
        const smoothedThumb = applyEmaSmoothing(prev.thumbTip, raw.thumbTip, effectiveAlpha);
        const smoothedMiddle = applyEmaSmoothing(prev.middleTip, raw.middleTip, effectiveAlpha);
        const smoothedWrist = applyEmaSmoothing(prev.wrist, raw.wrist, effectiveAlpha);

        const vx = dt > 0 ? (smoothedIndex.x - prev.indexTip.x) / dt : 0;
        const vy = dt > 0 ? (smoothedIndex.y - prev.indexTip.y) / dt : 0;
        const vz = dt > 0 ? (smoothedIndex.z - prev.indexTip.z) / dt : 0;

        smoothedHand = {
          ...raw,
          indexTip: smoothedIndex,
          thumbTip: smoothedThumb,
          middleTip: smoothedMiddle,
          wrist: smoothedWrist,
          velocity: {
            x: Number(vx.toFixed(4)),
            y: Number(vy.toFixed(4)),
            z: Number(vz.toFixed(4))
          },
          previousIndexTip: { ...prev.indexTip }
        };
      }

      this.previousHandsByHandedness.set(raw.handedness, smoothedHand);
      smoothedHands.push(smoothedHand);
    }

    return smoothedHands;
  }

  /**
   * Maps hand state or point to arena space using instance configuration
   *
   * @param {Object} handState
   * @param {Object} [cameraOrArenaConfig={}]
   * @returns {Object|null}
   */
  mapToArenaSpace(handState, cameraOrArenaConfig = {}) {
    return mapToArenaSpace(handState, {
      ...this.arenaConfig,
      ...cameraOrArenaConfig
    });
  }

  /**
   * Returns current smoothed hands
   * @returns {Array<Object>} Array of HandState objects
   */
  getHands() {
    return this.currentHands;
  }
}
