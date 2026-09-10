import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  FingerInteractionController,
  getLaneFromScreenPoint,
  FINGER_STATES,
  FINGER_NAMES,
  DEFAULT_INTERACTION_CONFIG
} from '../src/engine/fingerInteraction.js';

// Reusable standard corners for testing (width 800, height 200, depth 200)
// With 8 lanes, each lane is 100px wide:
// Lane 0: 100..200, Lane 1: 200..300, ..., Lane 7: 800..900
const MOCK_RECT_CORNERS = {
  p1: { x: 100, y: 200 },
  p2: { x: 900, y: 200 },
  p3: { x: 900, y: 400 },
  p4: { x: 100, y: 400 }
};

test('FINGER_STATES and FINGER_NAMES define required states and finger names', () => {
  assert.equal(FINGER_STATES.IDLE, 'IDLE');
  assert.equal(FINGER_STATES.HOVER, 'HOVER');
  assert.equal(FINGER_STATES.PRESSING, 'PRESSING');
  assert.equal(FINGER_STATES.TRIGGERED, 'TRIGGERED');
  assert.equal(FINGER_STATES.RELEASE, 'RELEASE');

  assert.deepEqual([...FINGER_NAMES], ['thumb', 'index', 'middle', 'ring', 'pinky']);
});

test('getLaneFromScreenPoint maps screen coordinates to correct musical lanes', () => {
  // Test 8-lane configuration
  // Lane 0 (x: 150, y: 300)
  assert.equal(getLaneFromScreenPoint({ x: 150, y: 300 }, MOCK_RECT_CORNERS, 8), 0);
  // Lane 1 (x: 250, y: 300)
  assert.equal(getLaneFromScreenPoint({ x: 250, y: 300 }, MOCK_RECT_CORNERS, 8), 1);
  // Lane 3 (x: 450, y: 300)
  assert.equal(getLaneFromScreenPoint({ x: 450, y: 300 }, MOCK_RECT_CORNERS, 8), 3);
  // Lane 7 (x: 850, y: 300)
  assert.equal(getLaneFromScreenPoint({ x: 850, y: 300 }, MOCK_RECT_CORNERS, 8), 7);

  // Test 4-lane configuration (200px per lane: 0: 100..300, 1: 300..500, 2: 500..700, 3: 700..900)
  assert.equal(getLaneFromScreenPoint({ x: 150, y: 300 }, MOCK_RECT_CORNERS, 4), 0);
  assert.equal(getLaneFromScreenPoint({ x: 350, y: 300 }, MOCK_RECT_CORNERS, 4), 1);
  assert.equal(getLaneFromScreenPoint({ x: 550, y: 300 }, MOCK_RECT_CORNERS, 4), 2);
  assert.equal(getLaneFromScreenPoint({ x: 750, y: 300 }, MOCK_RECT_CORNERS, 4), 3);

  // Test array-based corner definition [p1, p2, p3, p4]
  const arrayCorners = [
    MOCK_RECT_CORNERS.p1,
    MOCK_RECT_CORNERS.p2,
    MOCK_RECT_CORNERS.p3,
    MOCK_RECT_CORNERS.p4
  ];
  assert.equal(getLaneFromScreenPoint({ x: 450, y: 300 }, arrayCorners, 8), 3);

  // Test perspective trapezoid corners (p1..p2 is narrower than p4..p3)
  const trapezoidCorners = {
    p1: { x: 200, y: 200 },
    p2: { x: 800, y: 200 },
    p3: { x: 900, y: 400 },
    p4: { x: 100, y: 400 }
  };
  // Center is x: 500, y: 300 -> lane 3 or 4 of 8
  const centerLane = getLaneFromScreenPoint({ x: 500, y: 300 }, trapezoidCorners, 8);
  assert.ok(centerLane === 3 || centerLane === 4);

  // Out of bounds: above keyboard
  assert.equal(getLaneFromScreenPoint({ x: 450, y: 50 }, MOCK_RECT_CORNERS, 8), -1);
  // Out of bounds: below keyboard
  assert.equal(getLaneFromScreenPoint({ x: 450, y: 800 }, MOCK_RECT_CORNERS, 8), -1);
  // Out of bounds: left of keyboard
  assert.equal(getLaneFromScreenPoint({ x: -200, y: 300 }, MOCK_RECT_CORNERS, 8), -1);
  // Out of bounds: right of keyboard
  assert.equal(getLaneFromScreenPoint({ x: 1500, y: 300 }, MOCK_RECT_CORNERS, 8), -1);

  // Invalid / null inputs
  assert.equal(getLaneFromScreenPoint(null, MOCK_RECT_CORNERS, 8), -1);
  assert.equal(getLaneFromScreenPoint({ x: 450, y: 300 }, null, 8), -1);
  assert.equal(getLaneFromScreenPoint(undefined, undefined, 8), -1);
});

test('stationary finger stays in HOVER state and does NOT trigger press event (no auto-hit)', () => {
  const controller = new FingerInteractionController({
    screenWidth: 1000,
    screenHeight: 1000,
    pressVelocityThreshold: 0.015
  });

  // Finger hovering over Lane 2 (x: 350, y: 300) in pixel space, normalized: x = 0.35, y = 0.30
  const mockHand = {
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.30 }
  };

  // Frame 1 (t = 0.00s): Finger enters camera / hitbox
  const eventsF1 = controller.update([mockHand], MOCK_RECT_CORNERS, 8, 0.0);
  assert.equal(eventsF1.length, 0, 'Must NOT fire press event on entry into hitbox');

  const stateF1 = controller.getFingerState('Right', 'index');
  assert.ok(stateF1, 'State object should exist');
  assert.equal(stateF1.state, FINGER_STATES.HOVER, 'State must be HOVER');
  assert.equal(stateF1.lane, 2, 'Lane must be 2');
  assert.ok(controller.getHoverLanes().has(2), 'Hover lanes must contain lane 2');

  // Frame 2 (t = 0.016s): Finger remains stationary (y = 0.30, velocityY = 0)
  const eventsF2 = controller.update([mockHand], MOCK_RECT_CORNERS, 8, 0.016);
  assert.equal(eventsF2.length, 0, 'Stationary finger must NOT trigger auto-hit');
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.HOVER);

  // Frame 3 (t = 0.033s): Finger remains stationary (y = 0.30, velocityY = 0)
  const eventsF3 = controller.update([mockHand], MOCK_RECT_CORNERS, 8, 0.033);
  assert.equal(eventsF3.length, 0, 'Stationary finger must continue to NOT trigger press event');
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.HOVER);
  assert.ok(controller.getHoverLanes().has(2));
});

test('downward velocity triggers PRESSING and produces a press event', () => {
  const controller = new FingerInteractionController({
    screenWidth: 1000,
    screenHeight: 1000,
    pressVelocityThreshold: 0.015,
    debounceCooldownSec: 0.075
  });

  // Frame 1: Finger hovering at y = 0.30 (lane 2)
  const hoverHand = {
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.30 }
  };
  const eventsF1 = controller.update([hoverHand], MOCK_RECT_CORNERS, 8, 0.0);
  assert.equal(eventsF1.length, 0);
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.HOVER);

  // Frame 2: Downward strike at y = 0.325 (velocityY = 0.325 - 0.30 = 0.025 > 0.015)
  const strikeHand = {
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.325 }
  };
  const eventsF2 = controller.update([strikeHand], MOCK_RECT_CORNERS, 8, 0.016);

  // Verification: Press event produced
  assert.equal(eventsF2.length, 1, 'Exactly one press event should be produced');
  const ev = eventsF2[0];
  assert.equal(ev.hand, 'Right');
  assert.equal(ev.finger, 'index');
  assert.equal(ev.lane, 2);
  assert.equal(ev.timeSec, 0.016);
  assert.equal(ev.screenX, 350);
  assert.equal(ev.screenY, 325);
  assert.equal(Math.round(ev.velocityY * 1000) / 1000, 0.025);

  // State is now PRESSING
  const stateF2 = controller.getFingerState('Right', 'index');
  assert.equal(stateF2.state, FINGER_STATES.PRESSING);

  // Frame 3: Finger continues moving down or holds (velocityY > 0, but prevState was PRESSING)
  const continueHand = {
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.340 }
  };
  const eventsF3 = controller.update([continueHand], MOCK_RECT_CORNERS, 8, 0.032);
  assert.equal(eventsF3.length, 0, 'Must NOT produce duplicate event while finger remains down');
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.TRIGGERED);
});

test('upward or lateral movement does not trigger press event', () => {
  const controller = new FingerInteractionController({
    screenWidth: 1000,
    screenHeight: 1000,
    pressVelocityThreshold: 0.015,
    releaseVelocityThreshold: -0.005
  });

  // Frame 1: Hover at x: 0.35, y: 0.30 (lane 2)
  controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.30 }
  }], MOCK_RECT_CORNERS, 8, 0.0);

  // 1. Upward movement (lifting finger): y moves from 0.30 to 0.27 (velocityY = -0.03)
  const eventsUp = controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.27 }
  }], MOCK_RECT_CORNERS, 8, 0.016);
  assert.equal(eventsUp.length, 0, 'Upward movement must not trigger press event');
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.RELEASE);

  // 2. Upward movement settles back into HOVER
  controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.27 }
  }], MOCK_RECT_CORNERS, 8, 0.032);
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.HOVER);

  // 3. Lateral movement across lanes: x moves from 0.35 (lane 2) to 0.45 (lane 3), y unchanged
  const eventsLateral = controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.45, y: 0.27 }
  }], MOCK_RECT_CORNERS, 8, 0.048);
  assert.equal(eventsLateral.length, 0, 'Lateral movement must not trigger press event');
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.HOVER);
  assert.equal(controller.getFingerState('Right', 'index').lane, 3);

  // 4. Slow downward drift below threshold (velocityY = 0.006 <= 0.015)
  const eventsSlow = controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.45, y: 0.276 }
  }], MOCK_RECT_CORNERS, 8, 0.064);
  assert.equal(eventsSlow.length, 0, 'Slow downward drift below threshold must not trigger press event');
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.HOVER);
});

test('debounce cooldown prevents rapid duplicate triggers within 75ms', () => {
  const controller = new FingerInteractionController({
    screenWidth: 1000,
    screenHeight: 1000,
    pressVelocityThreshold: 0.015,
    debounceCooldownSec: 0.075 // 75ms
  });

  // Frame 1 (t = 0.000s): Initial hover
  controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.30 }
  }], MOCK_RECT_CORNERS, 8, 0.000);

  // Frame 2 (t = 0.016s): Strike 1 (y: 0.30 -> 0.33, velocityY = 0.030)
  const events1 = controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.33 }
  }], MOCK_RECT_CORNERS, 8, 0.016);
  assert.equal(events1.length, 1, 'Strike 1 must trigger press event');
  assert.equal(events1[0].timeSec, 0.016);

  // Frame 3 (t = 0.032s): Finger quickly releases (16ms after Strike 1)
  controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.30 }
  }], MOCK_RECT_CORNERS, 8, 0.032);

  // Frame 4 (t = 0.048s): Attempt rapid Strike 2 (32ms after Strike 1 < 75ms)
  // (y: 0.30 -> 0.33, velocityY = 0.030 > 0.015)
  const eventsRapid = controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.33 }
  }], MOCK_RECT_CORNERS, 8, 0.048);
  assert.equal(eventsRapid.length, 0, 'Rapid duplicate strike within 75ms must be suppressed by debounce cooldown');

  // Frame 5 (t = 0.064s): Finger releases again
  controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.30 }
  }], MOCK_RECT_CORNERS, 8, 0.064);

  // Frame 6 (t = 0.100s): Strike 3 after cooldown has elapsed (0.100 - 0.016 = 0.084s = 84ms > 75ms)
  const events3 = controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.33 }
  }], MOCK_RECT_CORNERS, 8, 0.100);
  assert.equal(events3.length, 1, 'Strike after 75ms cooldown must trigger new press event');
  assert.equal(events3[0].timeSec, 0.100);
  assert.equal(events3[0].lane, 2);
});

test('multi-finger tracking handles independent fingers and two hands', () => {
  const controller = new FingerInteractionController({
    screenWidth: 1000,
    screenHeight: 1000,
    pressVelocityThreshold: 0.015,
    debounceCooldownSec: 0.075
  });

  // Multi-finger setup:
  // Left Hand: index hovering over Lane 1 (x = 0.25, y = 0.30)
  // Right Hand: index hovering over Lane 5 (x = 0.65, y = 0.30), middle hovering over Lane 6 (x = 0.75, y = 0.30)
  const leftHand = {
    handedness: 'Left',
    cameraIndexTip: { x: 0.25, y: 0.30 }
  };
  const rightHand = {
    handedness: 'Right',
    cameraIndexTip: { x: 0.65, y: 0.30 },
    cameraMiddleTip: { x: 0.75, y: 0.30 }
  };

  // Frame 1 (t = 0.00s): Initial hover for both hands
  const eventsF1 = controller.update([leftHand, rightHand], MOCK_RECT_CORNERS, 8, 0.0);
  assert.equal(eventsF1.length, 0);

  const hoverLanes = controller.getHoverLanes();
  assert.equal(hoverLanes.size, 3);
  assert.ok(hoverLanes.has(1), 'Left index on lane 1');
  assert.ok(hoverLanes.has(5), 'Right index on lane 5');
  assert.ok(hoverLanes.has(6), 'Right middle on lane 6');

  // Frame 2 (t = 0.016s):
  // Left index strikes down (y: 0.30 -> 0.33)
  // Right index stays stationary (y: 0.30)
  // Right middle lifts up (y: 0.30 -> 0.27)
  const leftHandF2 = {
    handedness: 'Left',
    cameraIndexTip: { x: 0.25, y: 0.33 }
  };
  const rightHandF2 = {
    handedness: 'Right',
    cameraIndexTip: { x: 0.65, y: 0.30 },
    cameraMiddleTip: { x: 0.75, y: 0.27 }
  };

  const eventsF2 = controller.update([leftHandF2, rightHandF2], MOCK_RECT_CORNERS, 8, 0.016);
  assert.equal(eventsF2.length, 1, 'Only the striking Left index finger should trigger');
  assert.equal(eventsF2[0].hand, 'Left');
  assert.equal(eventsF2[0].finger, 'index');
  assert.equal(eventsF2[0].lane, 1);

  // Verify independent per-finger states
  assert.equal(controller.getFingerState('Left', 'index').state, FINGER_STATES.PRESSING);
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.HOVER);
  assert.equal(controller.getFingerState('Right', 'middle').state, FINGER_STATES.RELEASE);

  // Frame 3 (t = 0.032s):
  // Right index now strikes down (y: 0.30 -> 0.33)
  const rightHandF3 = {
    handedness: 'Right',
    cameraIndexTip: { x: 0.65, y: 0.33 },
    cameraMiddleTip: { x: 0.75, y: 0.27 }
  };
  const eventsF3 = controller.update([leftHandF2, rightHandF3], MOCK_RECT_CORNERS, 8, 0.032);
  assert.equal(eventsF3.length, 1, 'Right index should now trigger on lane 5');
  assert.equal(eventsF3[0].hand, 'Right');
  assert.equal(eventsF3[0].finger, 'index');
  assert.equal(eventsF3[0].lane, 5);
});

test('disappearing hands transition cleanly to IDLE and clear hover lanes', () => {
  const controller = new FingerInteractionController({
    screenWidth: 1000,
    screenHeight: 1000
  });

  // Hand is present in frame 1
  controller.update([{
    handedness: 'Right',
    cameraIndexTip: { x: 0.35, y: 0.30 }
  }], MOCK_RECT_CORNERS, 8, 0.0);

  assert.equal(controller.getHoverLanes().size, 1);
  assert.equal(controller.getFingerStates().length, 1);

  // Hand leaves frame (empty array)
  controller.update([], MOCK_RECT_CORNERS, 8, 0.016);

  assert.equal(controller.getHoverLanes().size, 0, 'Hover lanes must clear when hand leaves');
  assert.equal(controller.getFingerStates().length, 0, 'Active finger states should be 0');
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.IDLE);
});

test('FingerInteractionController constructor options, setFingerState, and reset work as expected', () => {
  const controller = new FingerInteractionController({
    pressVelocityThreshold: 0.02,
    releaseVelocityThreshold: -0.01,
    debounceCooldownMs: 100,
    screenWidth: 800,
    screenHeight: 600
  });

  assert.equal(controller.pressVelocityThreshold, 0.02);
  assert.equal(controller.releaseVelocityThreshold, -0.01);
  assert.equal(controller.debounceCooldownSec, 0.100);
  assert.equal(controller.screenWidth, 800);
  assert.equal(controller.screenHeight, 600);

  // Manual setFingerState
  controller.setFingerState('Right', 'index', FINGER_STATES.HOVER);
  assert.equal(controller.getFingerState('Right', 'index').state, FINGER_STATES.HOVER);

  // Reset clears all states
  controller.reset();
  assert.equal(controller.getFingerStates().length, 0);
  assert.equal(controller.getHoverLanes().size, 0);
  assert.equal(controller.getFingerState('Right', 'index'), null);
});

test('primaryFingerOnly prioritizes 1 finger per hand to support clean 2-finger playstyle', () => {
  const controller = new FingerInteractionController({
    screenWidth: 1000,
    screenHeight: 1000,
    primaryFingerOnly: true
  });

  // Hand with 3 fingers on desk (index, middle, ring)
  const hand = {
    handedness: 'Right',
    fingers: {
      index: { x: 0.35, y: 0.30 },
      middle: { x: 0.45, y: 0.30 },
      ring: { x: 0.55, y: 0.30 }
    }
  };

  controller.update([hand], MOCK_RECT_CORNERS, 8, 0.0);

  // In primaryFingerOnly mode, only index is tracked as the primary finger
  const activeLanes = [...controller.getHoverLanes()];
  assert.equal(activeLanes.length, 1, 'Only 1 lane should be hovered when playing 1-finger-per-hand');
  assert.equal(activeLanes[0], 2, 'Index finger lane (Lane 2) should be the single hovered lane');

  // Now dynamically switch to All Fingers Mode
  controller.setPrimaryFingerOnly(false);
  assert.equal(controller.primaryFingerOnly, false);
  controller.update([hand], MOCK_RECT_CORNERS, 8, 0.016);
  const allLanes = [...controller.getHoverLanes()];
  assert.equal(allLanes.length, 3, 'All 3 active fingers on desk must be tracked when setPrimaryFingerOnly(false)');
  assert.ok(allLanes.includes(2), 'Index lane 2 tracked');
  assert.ok(allLanes.includes(3), 'Middle lane 3 tracked');
  assert.ok(allLanes.includes(4), 'Ring lane 4 tracked');
});

test('14-lane mode accurately detects slender black keys and gives generous clearance to white keys', () => {
  // MOCK_RECT_CORNERS: x ranges from 100 to 900 (width 800), y from 200 to 400 (height 200)
  // u = (x - 100) / 800, v = (y - 200) / 200
  // Seam 1 (between C3 and D3) is at u = 1/14 ≈ 0.071428 -> x = 100 + 800 * (1/14) = 157.14
  // Black key C#3 has tolerance ±0.014 -> u in [0.0574, 0.0854] -> x in [145.9, 168.3]
  // Upper key area: v <= 0.65 -> y <= 330

  // 1. Direct hit on black key C#3 (MIDI 49) in upper zone
  const blackKeyHit = getLaneFromScreenPoint({ x: 157.14, y: 250 }, MOCK_RECT_CORNERS, 14);
  assert.equal(blackKeyHit, 49, 'Finger right on seam 1 in upper zone maps to C#3 (MIDI 49)');

  // 2. White key D3 (lane 1) center: u = 1.5/14 ≈ 0.10714 -> x = 100 + 800 * 0.10714 = 185.71
  const whiteKeyD3Hit = getLaneFromScreenPoint({ x: 185.71, y: 250 }, MOCK_RECT_CORNERS, 14);
  assert.equal(whiteKeyD3Hit, 1, 'Finger in center of D3 maps cleanly to white key lane 1, not black key');

  // 3. Clear white key area beside black key (e.g. u = 0.090 -> x = 172) in upper zone
  const whiteKeyClearHit = getLaneFromScreenPoint({ x: 172, y: 250 }, MOCK_RECT_CORNERS, 14);
  assert.equal(whiteKeyClearHit, 1, 'Finger outside the slim black key tolerance maps to white key lane 1');

  // 4. Near seam but in lower key tip area (v > 0.65, e.g. y = 370 -> v = 0.85):
  // Should always be a white key (never black key C#3 / MIDI 49)!
  const lowerKeyHit = getLaneFromScreenPoint({ x: 160, y: 370 }, MOCK_RECT_CORNERS, 14);
  assert.equal(lowerKeyHit, 1, 'Finger near seam in lower key tip area maps to white key D3 (lane 1), not black key');
});

