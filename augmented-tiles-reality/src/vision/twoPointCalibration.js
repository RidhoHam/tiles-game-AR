/**
 * Quick 2-Point Table Desk Edge Calibration
 *
 * Automatically constructs a 4-point perspective arena polygon from just
 * two anchor touch/pinch points placed along the desk edge (Left P1 and Right P2).
 */

/**
 * Computes 4-corner perspective holographic arena from 2 desk-edge anchor points.
 *
 * @param {{x: number, y: number}} p1 - Left desk touch point
 * @param {{x: number, y: number}} p2 - Right desk touch point
 * @param {Object} options - Calibration parameters
 * @param {number} [options.depthHeight=300] - Perpendicular depth height toward screen top
 * @param {number} [options.perspectiveRatio=0.55] - Ratio of far width to near width (0.4 - 0.7)
 * @returns {{p1: Object, p2: Object, p3: Object, p4: Object, angleRad: number, widthPx: number}}
 */
export function computeArenaFromTwoPoints(p1, p2, options = {}) {
  const depthHeight = options.depthHeight || 300;
  const perspectiveRatio = options.perspectiveRatio !== undefined ? options.perspectiveRatio : 0.55;

  const dx = p2.x - p1.x;
  const dy = p2.y - p1.y;
  const widthPx = Math.sqrt(dx * dx + dy * dy);
  const angleRad = Math.atan2(dy, dx);

  // Unit vector along the baseline (left to right)
  const ux = widthPx > 0 ? dx / widthPx : 1;
  const uy = widthPx > 0 ? dy / widthPx : 0;

  // Perpendicular unit vector pointing forward/upward (-90 deg from baseline)
  const nx = uy;
  const ny = -ux;

  // Midpoint of the baseline
  const midX = (p1.x + p2.x) / 2;
  const midY = (p1.y + p2.y) / 2;

  // Midpoint of the far boundary
  const farMidX = midX + nx * depthHeight;
  const farMidY = midY + ny * depthHeight;

  // Far width narrowed by perspective ratio
  const farHalfWidth = (widthPx * perspectiveRatio) / 2;

  // Top-right corner (P3) and top-left corner (P4)
  const p3 = {
    x: Math.round(farMidX + ux * farHalfWidth),
    y: Math.round(farMidY + uy * farHalfWidth)
  };
  const p4 = {
    x: Math.round(farMidX - ux * farHalfWidth),
    y: Math.round(farMidY - uy * farHalfWidth)
  };

  return {
    p1: { x: Math.round(p1.x), y: Math.round(p1.y) },
    p2: { x: Math.round(p2.x), y: Math.round(p2.y) },
    p3,
    p4,
    angleRad,
    widthPx: Math.round(widthPx)
  };
}
