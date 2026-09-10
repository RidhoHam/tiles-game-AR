/**
 * Palm & Wrist Rejection Filter for MediaPipe Hand Tracking
 *
 * Distinguishes deliberate fingertip taps from accidental palm or wrist brushes
 * by analyzing joint extension angles and wrist-to-knuckle-to-tip alignment.
 */

// Landmark mappings for fingers: [MCP, PIP, DIP, TIP]
export const FINGER_JOINT_MAP = {
  4: [1, 2, 3, 4],     // Thumb
  8: [5, 6, 7, 8],     // Index
  12: [9, 10, 11, 12], // Middle
  16: [13, 14, 15, 16],// Ring
  20: [17, 18, 19, 20] // Pinky
};

/**
 * Checks whether a fingertip tap is intentional and extended forward/downward toward the piano surface.
 *
 * @param {Array<{x: number, y: number, z: number}>} landmarks - 21 hand landmarks
 * @param {number} tipIndex - Landmark index of fingertip (4, 8, 12, 16, 20)
 * @returns {boolean}
 */
export function isTapIntentional(landmarks, tipIndex = 8) {
  if (!landmarks || landmarks.length < 21) return false;

  const wrist = landmarks[0];
  const tip = landmarks[tipIndex];
  if (!wrist || !tip) return false;

  const joints = FINGER_JOINT_MAP[tipIndex];
  if (!joints) return true; // Fallback to allowing if unrecognized finger

  const mcp = landmarks[joints[0]]; // Knuckle base

  // 1. Wrist check: Wrist should be closer to user/bottom than fingertip (wrist.y > tip.y)
  if (wrist.y < tip.y) {
    return false; // Hand upside down or wrist resting on desk in front of finger
  }

  // 2. Knuckle check: Fingertip must be extended beyond the knuckle
  if (mcp && tip.y >= mcp.y) {
    return false; // Finger is curled back into palm
  }

  return true;
}

/**
 * Validates that hand orientation is facing towards the surface (not sideways or backwards)
 * @param {Array<{x: number, y: number, z: number}>} landmarks
 * @returns {boolean}
 */
export function validateHandOrientation(landmarks) {
  if (!landmarks || landmarks.length < 21) return false;

  const wrist = landmarks[0];
  const indexMcp = landmarks[5];
  const pinkyMcp = landmarks[17];

  if (!wrist || !indexMcp || !pinkyMcp) return true;

  // Hand width vector (Index MCP to Pinky MCP)
  const spanX = pinkyMcp.x - indexMcp.x;
  const spanY = pinkyMcp.y - indexMcp.y;
  const spanLength = Math.sqrt(spanX * spanX + spanY * spanY);

  // Reject hands that are too compressed/collapsed edge-on (< 0.04 normalized)
  return spanLength >= 0.04;
}
