import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  HandTracker,
  applyEmaSmoothing,
  extractKeypoints,
  classifyHandedness,
  mapToArenaSpace,
  detectPinch,
  calculateTwoHandSpan,
  LANDMARK_INDICES
} from '../src/vision/handTracker.js';

test('LANDMARK_INDICES defines standard MediaPipe hand landmark positions', () => {
  assert.equal(LANDMARK_INDICES.WRIST, 0);
  assert.equal(LANDMARK_INDICES.THUMB_TIP, 4);
  assert.equal(LANDMARK_INDICES.INDEX_FINGER_TIP, 8);
  assert.equal(LANDMARK_INDICES.MIDDLE_FINGER_TIP, 12);
  assert.equal(LANDMARK_INDICES.RING_FINGER_TIP, 16);
  assert.equal(LANDMARK_INDICES.PINKY_TIP, 20);
});

test('applyEmaSmoothing smooths scalar values accurately', () => {
  // alpha = 0.4: 0.4 * 20 + 0.6 * 10 = 8 + 6 = 14
  const smoothed = applyEmaSmoothing(10, 20, 0.4);
  assert.equal(smoothed, 14);

  // alpha = 1.0 (no smoothing, full weight to current)
  assert.equal(applyEmaSmoothing(10, 25, 1.0), 25);

  // alpha = 0.0 (full weight to previous)
  assert.equal(applyEmaSmoothing(10, 25, 0.0), 10);

  // Edge cases: null/undefined previous or current
  assert.equal(applyEmaSmoothing(null, 30, 0.5), 30);
  assert.equal(applyEmaSmoothing(undefined, 30, 0.5), 30);
  assert.equal(applyEmaSmoothing(15, null, 0.5), 15);
  assert.equal(applyEmaSmoothing(15, undefined, 0.5), 15);
});

test('applyEmaSmoothing smooths 3D coordinate points and attenuates high-frequency noise', () => {
  const prev = { x: 0.0, y: 1.0, z: -0.2 };
  const noisyCurr = { x: 0.5, y: 0.0, z: 0.4 };
  const alpha = 0.5;

  const smoothed = applyEmaSmoothing(prev, noisyCurr, alpha);
  assert.equal(smoothed.x, 0.25);
  assert.equal(smoothed.y, 0.5);
  assert.equal(smoothed.z, 0.1);

  // Multi-step noise attenuation sequence
  let state = { x: 0, y: 0, z: 0 };
  const noisyInput = { x: 10, y: 20, z: 30 };
  // Step 1
  state = applyEmaSmoothing(state, noisyInput, 0.2);
  assert.equal(state.x, 2);
  assert.equal(state.y, 4);
  assert.equal(state.z, 6);
  // Step 2
  state = applyEmaSmoothing(state, noisyInput, 0.2);
  // 0.2 * 10 + 0.8 * 2 = 2 + 1.6 = 3.6
  assert.equal(Math.round(state.x * 10) / 10, 3.6);
});

test('extractKeypoints correctly extracts wrist (0), thumbTip (4), indexTip (8), and middleTip (12)', () => {
  // Create mock array of 21 landmarks
  const mockLandmarks = Array.from({ length: 21 }, (_, i) => ({
    x: i * 10,
    y: i * 20,
    z: i * 5
  }));

  const keypoints = extractKeypoints(mockLandmarks);
  assert.ok(keypoints);
  assert.deepEqual(keypoints.wrist, { x: 0, y: 0, z: 0 });
  assert.deepEqual(keypoints.thumbTip, { x: 40, y: 80, z: 20 });
  assert.deepEqual(keypoints.indexTip, { x: 80, y: 160, z: 40 });
  assert.deepEqual(keypoints.middleTip, { x: 120, y: 240, z: 60 });
  assert.equal(keypoints.raw.length, 21);

  // Fallback on empty or invalid input
  assert.equal(extractKeypoints(null), null);
  assert.equal(extractKeypoints([]), null);
});

test('classifyHandedness identifies Left and Right hands from MediaPipe categories', () => {
  // MediaPipe Tasks Vision returns handednesses as array of category arrays:
  // [ [ { index: 0, score: 0.98, categoryName: "Left", displayName: "Left" } ] ]
  const leftEntry = [{ index: 0, score: 0.98, categoryName: 'Left', displayName: 'Left' }];
  const rightEntry = [{ index: 1, score: 0.94, categoryName: 'Right', displayName: 'Right' }];

  const leftResult = classifyHandedness(leftEntry);
  assert.equal(leftResult.handedness, 'Left');
  assert.equal(leftResult.confidence, 0.98);

  const rightResult = classifyHandedness(rightEntry);
  assert.equal(rightResult.handedness, 'Right');
  assert.equal(rightResult.confidence, 0.94);

  // Case insensitivity & displayName fallback
  const altEntry = [{ displayName: 'left', score: 0.85 }];
  assert.equal(classifyHandedness(altEntry).handedness, 'Left');

  // Default fallback when empty or malformed
  const fallback = classifyHandedness(null, 'Right');
  assert.equal(fallback.handedness, 'Right');
  assert.equal(fallback.confidence, 0.0);
});

test('mapToArenaSpace converts camera normalized coords to centered arena coordinates', () => {
  const config = {
    arenaWidth: 0.8,
    arenaHeight: 0.6,
    hitPlaneZ: 0.0,
    mirror: true
  };

  // Center point: x=0.5, y=0.5 -> arena (x=0, y=0)
  const center = mapToArenaSpace({ x: 0.5, y: 0.5, z: 0.0 }, config);
  assert.equal(center.x, 0.0);
  assert.equal(center.y, 0.0);
  assert.equal(center.z, 0.0);

  // Mirrored X mapping:
  // Camera x = 0.25 (left in camera feed) -> mirrored normX = 0.75 (user right side)
  // Arena X = (0.75 - 0.5) * 0.8 = +0.20
  const userRight = mapToArenaSpace({ x: 0.25, y: 0.5, z: 0.0 }, config);
  assert.equal(userRight.x, 0.2);

  // Camera x = 0.75 -> mirrored normX = 0.25 -> Arena X = -0.20
  const userLeft = mapToArenaSpace({ x: 0.75, y: 0.5, z: 0.0 }, config);
  assert.equal(userLeft.x, -0.2);

  // Non-mirrored mapping
  const nonMirrored = mapToArenaSpace(
    { x: 0.25, y: 0.5, z: 0.0 },
    { ...config, mirror: false }
  );
  assert.equal(nonMirrored.x, -0.2);

  // Full HandState transformation
  const handState = {
    handedness: 'Right',
    confidence: 0.95,
    indexTip: { x: 0.5, y: 0.5, z: 0.0 },
    thumbTip: { x: 0.4, y: 0.6, z: -0.02 },
    middleTip: { x: 0.5, y: 0.4, z: 0.01 },
    wrist: { x: 0.5, y: 0.8, z: -0.05 }
  };

  const mappedHand = mapToArenaSpace(handState, config);
  assert.equal(mappedHand.handedness, 'Right');
  assert.equal(mappedHand.confidence, 0.95);
  assert.equal(mappedHand.indexTip.x, 0.0);
  assert.equal(mappedHand.indexTip.y, 0.0);
  assert.ok(typeof mappedHand.thumbTip.x === 'number');
  assert.ok(typeof mappedHand.middleTip.y === 'number');
});

test('HandTracker instantiates with sensible defaults and SSR safety', () => {
  const tracker = new HandTracker();
  assert.equal(tracker.numHands, 2);
  assert.equal(tracker.runningMode, 'VIDEO');
  assert.equal(tracker.alpha, 0.4);
  assert.equal(tracker.mirror, true);
  assert.equal(tracker.isReady(), false);
  assert.deepEqual(tracker.getHands(), []);
});

test('HandTracker accepts custom configuration options', () => {
  const tracker = new HandTracker({
    numHands: 1,
    runningMode: 'IMAGE',
    alpha: 0.6,
    mirror: false,
    arenaConfig: { arenaWidth: 1.2, arenaHeight: 0.9 }
  });
  assert.equal(tracker.numHands, 1);
  assert.equal(tracker.runningMode, 'IMAGE');
  assert.equal(tracker.alpha, 0.6);
  assert.equal(tracker.mirror, false);
  assert.equal(tracker.arenaConfig.arenaWidth, 1.2);
});

test('HandTracker preserves tracking state and applies smoothing across consecutive frames', () => {
  const tracker = new HandTracker({ alpha: 0.5, mirror: false });

  // Mock MediaPipe result frame 1: Left hand at x=0.3, y=0.5
  const mockFrame1 = {
    landmarks: [
      Array.from({ length: 21 }, () => ({ x: 0.3, y: 0.5, z: 0.0 }))
    ],
    handednesses: [
      [{ categoryName: 'Left', score: 0.95 }]
    ]
  };

  // Mock detect landmarker
  tracker.handLandmarker = {
    detectForVideo: () => mockFrame1
  };
  tracker.initialized = true;

  const handsFrame1 = tracker.detectForVideo(null, 1000);
  assert.equal(handsFrame1.length, 1);
  assert.equal(handsFrame1[0].handedness, 'Left');
  // First frame without prior state: x = (0.3 - 0.5) * 0.8 = -0.16
  assert.equal(handsFrame1[0].indexTip.x, -0.16);
  assert.deepEqual(tracker.getHands(), handsFrame1);

  // Mock MediaPipe result frame 2: Left hand jumps to x=0.5 (dx = +0.2)
  const mockFrame2 = {
    landmarks: [
      Array.from({ length: 21 }, () => ({ x: 0.5, y: 0.5, z: 0.0 }))
    ],
    handednesses: [
      [{ categoryName: 'Left', score: 0.92 }]
    ]
  };
  tracker.handLandmarker.detectForVideo = () => mockFrame2;

  const handsFrame2 = tracker.detectForVideo(null, 1050);
  assert.equal(handsFrame2.length, 1);
  // Frame 2 target arena x = (0.5 - 0.5) * 0.8 = 0.0
  // EMA with alpha=0.5: 0.5 * 0.0 + 0.5 * (-0.16) = -0.08
  assert.equal(handsFrame2[0].indexTip.x, -0.08);

  // State preserved in tracker
  assert.equal(tracker.getHands()[0].indexTip.x, -0.08);
  // Velocity calculated over 50ms (0.05s): (-0.08 - (-0.16)) / 0.05 = 0.08 / 0.05 = 1.6 m/s
  assert.ok(handsFrame2[0].velocity);
  assert.equal(Math.round(handsFrame2[0].velocity.x * 10) / 10, 1.6);
});

test('HandTracker handles simultaneous 2-hand detection (Left and Right)', () => {
  const tracker = new HandTracker({ alpha: 1.0, mirror: false });

  // 2 hands: hand 0 is Left at x=0.2, hand 1 is Right at x=0.8
  const mockTwoHands = {
    landmarks: [
      Array.from({ length: 21 }, () => ({ x: 0.2, y: 0.5, z: 0.0 })),
      Array.from({ length: 21 }, () => ({ x: 0.8, y: 0.5, z: 0.0 }))
    ],
    handednesses: [
      [{ categoryName: 'Left', score: 0.96 }],
      [{ categoryName: 'Right', score: 0.98 }]
    ]
  };

  tracker.handLandmarker = {
    detectForVideo: () => mockTwoHands
  };
  tracker.initialized = true;

  const hands = tracker.detectForVideo(null, 2000);
  assert.equal(hands.length, 2);

  const leftHand = hands.find(h => h.handedness === 'Left');
  const rightHand = hands.find(h => h.handedness === 'Right');

  assert.ok(leftHand);
  assert.ok(rightHand);
  assert.equal(leftHand.indexTip.x, -0.24); // (0.2 - 0.5) * 0.8
  assert.equal(rightHand.indexTip.x, 0.24);  // (0.8 - 0.5) * 0.8
  assert.equal(leftHand.confidence, 0.96);
  assert.equal(rightHand.confidence, 0.98);
});

test('detectPinch accurately determines if thumb and index tips are pinched', () => {
  // Pinched: tips are very close (< 0.08 normalized distance)
  const pinchedHand = {
    thumbTip: { x: 0.5, y: 0.5, z: 0.0 },
    indexTip: { x: 0.52, y: 0.51, z: 0.0 }
  };
  const res1 = detectPinch(pinchedHand);
  assert.equal(res1.isPinching, true);
  assert.ok(res1.distance < 0.08);

  // Open: tips are far apart (> 0.08)
  const openHand = {
    thumbTip: { x: 0.3, y: 0.5, z: 0.0 },
    indexTip: { x: 0.5, y: 0.3, z: 0.0 }
  };
  const res2 = detectPinch(openHand);
  assert.equal(res2.isPinching, false);
  assert.ok(res2.distance > 0.08);

  // Null/missing safety
  assert.equal(detectPinch(null).isPinching, false);
});

test('calculateTwoHandSpan computes arena width and center point between two hands', () => {
  const leftHand = {
    handedness: 'Left',
    indexTip: { x: -0.4, y: -0.2, z: -1.0 },
    thumbTip: { x: -0.38, y: -0.21, z: -1.0 },
    isPinching: true
  };
  const rightHand = {
    handedness: 'Right',
    indexTip: { x: 0.4, y: -0.2, z: -1.0 },
    thumbTip: { x: 0.38, y: -0.21, z: -1.0 },
    isPinching: true
  };

  const span = calculateTwoHandSpan(leftHand, rightHand);
  assert.ok(span);
  assert.equal(span.width, 0.8);
  assert.equal(span.centerX, 0.0);
  assert.equal(span.centerY, -0.2);
  assert.equal(span.bothPinching, true);
});
