/* Screen-space placement guide: three DOM lines over the camera feed.
 *
 * WHAT THIS IS FOR
 * ----------------
 * `GuideLines` (./guide-lines.js) draws three thin 3D lines at the calibrated
 * arena position, but that position only exists once cards have been DETECTED
 * (`deriveArena` returns a fixed fallback while no card is visible). The whole
 * point of a placement guide is to tell the player where to put a card BEFORE
 * any card is on the table, so a world-space guide is blind exactly when it is
 * most needed.
 *
 * This overlay is that missing half: three fixed lines in SCREEN SPACE - a
 * centre line down the middle of the camera view and two zone lines to its left
 * and right at a sensible fraction of the viewport width, roughly where a card
 * row sits. It needs no world coordinates, no tracking and no arena fit, so it
 * is meaningful from the very first frame of `scan` and never jumps around as
 * detections come and go.
 *
 * RELATIONSHIP TO GuideLines
 * --------------------------
 * Both are shown during `scan`: this screen-space row is the coarse "put your
 * cards here" hint, and the 3D calibrated lines are the precise "this is the
 * arena you have built" layer that appears once cards exist. They are
 * deliberately different modules because they are different responsibilities
 * (DOM overlay vs. three.js scene graph) with different lifecycles.
 *
 * INTERACTION
 * -----------
 * The lines are inert: `pointer-events: none` is set on the host and every
 * line, so the camera feed and the UI controls underneath stay clickable.
 */
export class PlacementGuideOverlay {
  /**
   * @param {HTMLElement|null} parent
   *   The element the three lines are appended to. The app passes the AR
   *   container so the lines paint with the camera feed, behind the UI panels.
   *   A missing parent is tolerated (a headless/no-DOM environment yields an
   *   inert instance) so importing and constructing this class never throws.
   */
  constructor(parent) {
    this._disposed = false;
    this.host = null;
    this.lines = [];

    if (!parent || typeof parent.append !== 'function' || typeof document === 'undefined') return;

    const host = document.createElement('div');
    host.className = 'placement-guide';
    host.setAttribute('aria-hidden', 'true');
    // Keep the interaction contract true even before the stylesheet has loaded.
    // This is especially useful while MindAR is mounting its camera nodes.
    host.style.pointerEvents = 'none';

    // Order matches GuideLines: [left, centre, right]. The fraction is the line
    // centre as a share of the container width; the centre line sits at 50% and
    // the zone lines bracket it symmetrically at 32% / 68%, which is roughly
    // where a card row reads in a portrait camera view.
    const SPECS = [
      { modifier: 'left', fraction: 0.32, label: '🔵 Tim Biru' },
      { modifier: 'center', fraction: 0.5, label: '⚔️ Garis Tengah' },
      { modifier: 'right', fraction: 0.68, label: '🔴 Tim Merah' }
    ];

    for (const spec of SPECS) {
      const line = document.createElement('div');
      line.className = `placement-guide__line placement-guide__line--${spec.modifier}`;
      line.dataset.fraction = String(spec.fraction);
      line.style.setProperty('--guide-x', `${spec.fraction * 100}%`);
      line.style.pointerEvents = 'none';

      const label = document.createElement('span');
      label.className = `placement-guide__label placement-guide__label--${spec.modifier}`;
      label.textContent = spec.label;
      label.style.pointerEvents = 'none';
      line.append(label);

      host.append(line);
      this.lines.push(line);
    }

    this.host = host;
    // Hidden until show(): scan is the only phase that wants a guide, and
    // the first frame may not have run yet.
    host.hidden = true;
    parent.append(host);
  }

  /**
   * Shows the guide. The three lines are FIXED in screen space for the whole
   * scan phase, so they never jitter with tracking and need no arguments.
   */
  show() {
    if (this._disposed || !this.host) return;
    this.host.hidden = false;
  }

  /** Hides the guide; used once the battle starts and on phase changes. */
  hide() {
    if (this._disposed || !this.host) return;
    this.host.hidden = true;
  }

  get visible() {
    return Boolean(this.host && !this.host.hidden);
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this.host && this.host.parentNode) this.host.parentNode.removeChild(this.host);
    this.host = null;
    this.lines.length = 0;
  }
}
