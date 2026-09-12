/* Arena floor, centre line and boundary, sized from a calibrated arena. */
import * as THREE from 'three';

// Card geometry: the physical cards are marker targets about one "card row" wide
// in world units. CARD_ROW is the world-space width of a single card and is the
// quantity the two outer guide lines are meant to bracket, so the placement zone
// is always roughly one card deep regardless of how widely the cards were spread.
const CARD_ROW = 1.2;
// The guide zone may not be wider than GUIDE_SHARE of the arena spread (otherwise
// two distant card rows would put the zone lines outside the visible arena) and
// may not be narrower than GUIDE_MIN (otherwise a tiny spread would collapse the
// zone onto the centre line and the guide would be useless).
const GUIDE_SHARE = 0.5;
const GUIDE_MIN = 0.35;

// The scene must never be built from a zero-sized arena: halfWidth/halfDepth of 0
// produces a degenerate plane whose normals and shadow bounds are unusable, and
// a collinear or single-card layout legitimately reports width/depth of 0. These
// floors keep every derived size strictly positive and finite.
const MIN_HALF_WIDTH = 2.5;
const MIN_HALF_DEPTH = 1.75;

// A sane size for a totally missing/malformed arena. Mirrors DEFAULT_ARENA
// (halfWidth 6, halfDepth 4) halved, i.e. the same box a good arena maps to.
const FALLBACK_HALF_WIDTH = 6;
const FALLBACK_HALF_DEPTH = 4;

// Reads a positive, finite number from `value`, otherwise returns `fallback`.
function finiteOr(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/**
 * Turns a calibrated arena into half-extents for the visible scene.
 *
 * `arena.width`/`arena.depth` are the FULL X/Z spans and are legitimately 0 for
 * collinear or single-card layouts, so the result is floored with MIN_* to stay
 * strictly positive and finite; a missing, negative or NaN span falls back to the
 * default arena box. The 6/4 -> 3/2 case is exact: no clamp applies when the span
 * is at or above twice the floor.
 */
export function sceneBoundsFromArena(arena) {
  const width = Number.isFinite(arena?.width) && arena.width > 0 ? arena.width : null;
  const depth = Number.isFinite(arena?.depth) && arena.depth > 0 ? arena.depth : null;
  const halfWidth = width === null ? FALLBACK_HALF_WIDTH : Math.max(MIN_HALF_WIDTH, width / 2);
  const halfDepth = depth === null ? FALLBACK_HALF_DEPTH : Math.max(MIN_HALF_DEPTH, depth / 2);
  return { halfWidth, halfDepth };
}

/**
 * Positions of the three player-facing guide lines: [left, centre, right].
 *
 * The centre line is the arena centreX (the blue/red dividing line). The two
 * outer lines bracket one card row, so their offset is CARD_ROW/2 scaled by how
 * much arena there is to work with: offset = clamp(width * GUIDE_SHARE / 2,
 * GUIDE_MIN, CARD_ROW). Deriving the offset from the arena width (rather than
 * using the raw half-width) keeps the zone inside a narrow spread and stops it
 * ballooning to the arena edge for a wide one, while GUIDE_MIN keeps left/right
 * strictly inside the centre line even when width is 0 or missing.
 */
export function guideLineX(arena) {
  const centerX = finiteOr(arena?.centerX, 0);
  const width = finiteOr(arena?.width, 0);
  const spread = Math.max(0, width);
  const offset = Math.min(CARD_ROW, Math.max(GUIDE_MIN, spread * GUIDE_SHARE * 0.5));
  return [centerX - offset, centerX, centerX + offset];
}

const CENTER_LINE_COLOR = 0xf6f2df;
const BOUNDARY_COLOR = 0xe6c98a;
const SAND_COLOR = 0xdccb9a;

export class ArenaMesh {
  constructor(root) {
    this.root = root;
    this.group = new THREE.Group();
    this.group.name = 'arena';
    this._disposed = false;
    this._geometries = [];
    this._materials = [];

    const planeGeometry = new THREE.PlaneGeometry(1, 1);
    planeGeometry.rotateX(-Math.PI / 2);
    const sandMaterial = new THREE.MeshStandardMaterial({
      color: SAND_COLOR, roughness: 0.95, metalness: 0
    });
    this.floor = new THREE.Mesh(planeGeometry, sandMaterial);
    this.floor.name = 'arena-floor';
    this.floor.receiveShadow = true;

    const centerGeometry = new THREE.PlaneGeometry(1, 1);
    centerGeometry.rotateX(-Math.PI / 2);
    const centerMaterial = new THREE.MeshBasicMaterial({
      color: CENTER_LINE_COLOR, transparent: true, opacity: 0.55, depthWrite: false
    });
    this.centerLine = new THREE.Mesh(centerGeometry, centerMaterial);
    this.centerLine.name = 'arena-center-line';
    this.centerLine.renderOrder = 1;

    const boundaryGeometry = new THREE.RingGeometry(0.5, 1, 96, 1);
    boundaryGeometry.rotateX(-Math.PI / 2);
    const boundaryMaterial = new THREE.MeshBasicMaterial({
      color: BOUNDARY_COLOR, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false
    });
    this.boundary = new THREE.Mesh(boundaryGeometry, boundaryMaterial);
    this.boundary.name = 'arena-boundary';
    this.boundary.renderOrder = 1;

    this._geometries.push(planeGeometry, centerGeometry, boundaryGeometry);
    this._materials.push(sandMaterial, centerMaterial, boundaryMaterial);

    this.group.add(this.floor, this.centerLine, this.boundary);
    this.root.add(this.group);
  }

  /**
   * Re-sizes and re-positions the arena for `arena`. Safe to call repeatedly
   * (e.g. while cards are still being placed): it only mutates transforms and
   * scales, so no geometry or material is ever allocated a second time.
   */
  apply(arena) {
    if (this._disposed) return;
    const { halfWidth, halfDepth } = sceneBoundsFromArena(arena);
    const centerX = finiteOr(arena?.centerX, 0);
    const centerZ = finiteOr(arena?.centerZ, 0);

    const fullWidth = halfWidth * 2;
    const fullDepth = halfDepth * 2;

    this.floor.scale.set(fullWidth, 1, fullDepth);
    this.floor.position.set(centerX, 0, centerZ);
    this.floor.updateMatrix();

    const centerThickness = Math.max(0.04, Math.min(fullWidth, fullDepth) * 0.02);
    this.centerLine.scale.set(centerThickness, 1, fullDepth);
    this.centerLine.position.set(centerX, 0.012, centerZ);
    this.centerLine.updateMatrix();

    // RingGeometry(inner = 0.5, outer = 1) at unit scale; scale to the arena box.
    this.boundary.scale.set(fullWidth, 1, fullDepth);
    this.boundary.position.set(centerX, 0.006, centerZ);
    this.boundary.updateMatrix();
  }

  dispose() {
    if (this._disposed) return;
    this._disposed = true;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.group.remove(this.floor, this.centerLine, this.boundary);
    for (const geometry of this._geometries) geometry.dispose();
    for (const material of this._materials) material.dispose();
    this._geometries.length = 0;
    this._materials.length = 0;
    this.root = null;
  }
}
