/**
 * Acoustic Grand Piano Stereo Panner
 *
 * Maps piano key pitches and rhythm lanes across a natural stereo soundstage:
 * - Bass notes / Left lanes: Panned gently to the left ear (-0.75 to -0.2)
 * - Middle C (C4) / Center lanes: Centered (0.0)
 * - Treble notes / Right lanes: Panned gently to the right ear (+0.2 to +0.75)
 */

/**
 * Calculates stereo pan position (-1 to +1) based on pitch or lane index
 * @param {number} value - MIDI pitch (e.g. 21-108) or lane index (e.g. 0-7)
 * @param {number} minValue - Minimum range (default 21 for A0)
 * @param {number} maxValue - Maximum range (default 108 for C8)
 * @param {number} maxPan - Maximum pan extent (default 0.70 to maintain mono compatibility)
 * @returns {number} Pan between -maxPan and +maxPan
 */
export function calculatePitchPan(value, minValue = 21, maxValue = 108, maxPan = 0.70) {
  if (!Number.isFinite(value)) return 0;
  const clamped = Math.max(minValue, Math.min(maxValue, value));
  const range = maxValue - minValue;
  if (range <= 0) return 0;

  const normalized = (clamped - minValue) / range; // 0.0 to 1.0
  const pan = (normalized * 2 - 1) * maxPan; // -maxPan to +maxPan
  return Math.round(pan * 1000) / 1000;
}

/**
 * Creates and configures a StereoPannerNode on the Web Audio context
 * @param {AudioContext} audioCtx
 * @param {number} panValue
 * @returns {StereoPannerNode|null}
 */
export function createPannerNode(audioCtx, panValue = 0) {
  if (!audioCtx || typeof audioCtx.createStereoPanner !== 'function') {
    return null;
  }
  try {
    const panner = audioCtx.createStereoPanner();
    const clampedPan = Math.max(-1, Math.min(1, Number.isFinite(panValue) ? panValue : 0));
    if (panner.pan?.setValueAtTime) {
      panner.pan.setValueAtTime(clampedPan, audioCtx.currentTime || 0);
    } else if (panner.pan) {
      panner.pan.value = clampedPan;
    }
    return panner;
  } catch (_) {
    return null;
  }
}
