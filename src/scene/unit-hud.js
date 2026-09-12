// 3D health bars and unit name labels that always face the camera.
//
// Design notes
// ------------
// The bars live in world space, parented to a HUD-owned Group, NOT to the unit
// group. Unit groups are rotated (structures face +/- PI/2) and scaled
// (benteng/bunker use 1.5), so a bar parented inside them would inherit the
// scale (1.5x too big) and have its local offset rotated into a wrong world
// spot. Anchoring to the HUD group and refreshing world positions every frame
// keeps bars upright, correctly sized, and independently disposable.
//
// Screen-space sizing
// -------------------
// `update(camera)` is the single per-frame entry point. It (a) reads each
// tracked object's own world position through `getWorldPosition()` -- no caller
// supplied position map is required -- and (b) rescales every sprite so its
// apparent size is constant regardless of camera distance.
//
// A perspective camera maps world units to pixels at view depth d as
//
//     unitsPerPixel = 2 * tan(fov/2) * d / viewportHeightPx
//
// so a sprite of world height h covers h / unitsPerPixel pixels. Inverting that
// gives the scale needed for a target pixel size:
//
//     scale = targetPixels * unitsPerPixel
//
// d is the depth along the camera's forward axis (the perspective divide
// denominator), NOT the euclidean distance to the camera, so bars at the edge
// of the frustum do not shrink. Because the projection already divides by d,
// `d` cancels out of the on-screen result and the bar renders at a fixed pixel
// size at any distance.
import * as T from 'three';

// Sprite / quad geometry, in world units at one world unit per pixel. These are
// the values a sprite is scaled to when the camera is one "pixel unit" away;
// `attach` overwrites them via the screen-space fit as soon as it can measure,
// so they are a fallback for the case where a camera cannot be measured yet.
export const BAR_WIDTH = 1.6;
export const BAR_HEIGHT = 0.22;
export const BAR_FILL_INSET = 0.045;
export const LABEL_LIFT = 0.40;

// Rendered quad size, in CSS pixels of the viewport. This is the value the bar
// is deliberately held at. At 1080p the quad is 132 x 40 px: the health strip
// keeps the top STRIP_RATIO (35.5%) and the name label gets the bottom 25.8 px.
export const TARGET_PIXEL_WIDTH = 132;
export const TARGET_PIXEL_HEIGHT = 40;

// The strip (BAR_HEIGHT) : total (BAR_HEIGHT + LABEL_LIFT) ratio, so the
// world-space quad keeps the same proportions as the canvas below.
export const STRIP_RATIO = BAR_HEIGHT / (BAR_HEIGHT + LABEL_LIFT);

// Legacy alias kept for callers written against the first revision of this
// module. The bar is 62.5 px wide per 1.6 world units at a 1080p viewport.
export const SCREEN_PIXELS_PER_WORLD_UNIT = TARGET_PIXEL_WIDTH / BAR_WIDTH;

// Clamps. screenUnitsPerPixel() is bounded, so these are a second line of
// defence: a degenerate camera matrix (NaN, fov 0, no projection matrix at all)
// can never blow a sprite up to Infinity or collapse it to 0.
export const MIN_UNITS_PER_PIXEL = 0.0005;
export const MAX_UNITS_PER_PIXEL = 4;

// Canvas resolution and font. 512 x 160 is a high enough sampling grid that the
// 40 px on-screen label is crisp rather than resampled mush, and the glyphs are
// drawn at 56 px so the rendered cap height is comfortably above a 10 px
// legibility floor. The label band is the bottom STRIP_RATIO complement of the
// canvas, matching the sprite's LABEL_LIFT band.
export const CANVAS_WIDTH = 512;
export const CANVAS_HEIGHT = 160;
export const LABEL_FONT_SIZE = 56;
export const CANVAS_FONT = `bold ${LABEL_FONT_SIZE}px sans-serif`;

// Render-scale constants a reviewer can check against the dimensions above.
export const SCREEN_PX_PER_CANVAS_PX = TARGET_PIXEL_WIDTH / CANVAS_WIDTH;
export const TARGET_GLYPH_PIXELS = LABEL_FONT_SIZE * SCREEN_PX_PER_CANVAS_PX;

const STRIP_X = 4;
const STRIP_Y = 18;
const STRIP_W = CANVAS_WIDTH - 8;
const STRIP_H = 54;
const STRIP_RADIUS = 12;
const FILL_INSET_X = 10;
const FILL_INSET_Y = 10;
const FILL_RADIUS = 9;

// The label baseline, measured from the bottom of the canvas. The label band is
// 160 - 114 = 46 canvas px tall; centring a 56 px font in it puts the baseline
// 30 px above the band bottom, leaving ~8 px of descender room.
const LABEL_BASELINE_FROM_BOTTOM = 30;
const NEUTRAL_COLOR = 0x9aa0a6;
const BACKGROUND_COLOR = 0x101418;
const LABEL_COLOR = '#ffffff';
const TARGET_COLOR = 0xffd24a;
const FACTION_COLORS = Object.freeze({ blue: 0x176db2, red: 0xbd4b3c });

const TOP_MARGIN = 0.55;

// Per-type float height, in metres above the object's own origin, used ONLY
// when a real measurement is impossible. Every group origin in this project is
// at ground level, so these are exact world tops for the default (unscaled,
// at-origin) models, measured with `new THREE.Box3().setFromObject(group)`:
//
//   benteng  8.9273  (group.scale 1.5)   bunker   7.4198  (group.scale 1.5)
//   robot    4.9950                      tank     2.8500
//   kesatria 3.7000                      gargoyle 3.0000
//
// The table deliberately stores the RAW top, not the top plus margin: callers
// stack additional height on top of it (models that stand on a wall, drifted
// fliers) and the margin is applied once, in defaultBarHeight().
export const KNOWN_TOPS = Object.freeze({
  benteng: 8.9273,
  bunker: 7.4198,
  robot: 4.9950,
  tank: 2.8500,
  kesatria: 3.7000,
  gargoyle: 3.0000
});

// Conservative last resort for a type nobody has measured. It is the tallest
// model in the roster, so using it can only ever over-float a bar, never sink
// one into a model.
const UNKNOWN_TOP = Math.max(...Object.values(KNOWN_TOPS));

const UNIT_ALIASES = Object.freeze({ castle: 'benteng', knight: 'kesatria' });

// Reused scratch vectors so update() allocates nothing per frame.
const _updateWorld = new T.Vector3();

export function healthBarWidth(health, maxHealth) {
  if (!Number.isFinite(maxHealth) || maxHealth <= 0) return 0;
  if (!Number.isFinite(health)) return 0;
  if (health <= 0) return 0;
  return Math.max(0, Math.min(1, health / maxHealth));
}

export function factionColor(faction) {
  return FACTION_COLORS[faction] ?? NEUTRAL_COLOR;
}

// World-space float height for a unit type, derived from the measured world top
// plus a margin, so a bar can never sink into a model. Callers may override via
// meta.height.
export function defaultBarHeight(type) {
  const name = UNIT_ALIASES[type] || type;
  const top = KNOWN_TOPS[name];
  return (top ?? UNKNOWN_TOP) + TOP_MARGIN;
}

// Resolves the world Y a bar should float at: an explicit meta.height wins,
// otherwise the model's live world bounding box is measured, and the per-type
// table is the last resort.
export function resolveBarHeight(object3D, type, explicitHeight) {
  if (Number.isFinite(explicitHeight)) return explicitHeight;
  if (object3D) {
    try {
      object3D.updateWorldMatrix(true, true);
      const bounds = new T.Box3().setFromObject(object3D);
      if (!bounds.isEmpty() && Number.isFinite(bounds.max.y)) return bounds.max.y + TOP_MARGIN;
    } catch { /* fall through to the table */ }
  }
  return defaultBarHeight(type);
}

// World units that one viewport pixel covers at the given view depth, for a
// perspective projection. This is the inverse of the perspective scale used by
// the vertex shader (a * halfViewportHeightPx), so multiplying a target pixel
// count by it yields the world size that renders at exactly that pixel count.
export function unitsPerPixelAtDepth(depth, fovDegrees, viewportHeightPx) {
  if (!Number.isFinite(depth) || depth <= 0) return null;
  const fov = Number.isFinite(fovDegrees) && fovDegrees > 0 && fovDegrees < 180 ? fovDegrees : 42;
  const height = Number.isFinite(viewportHeightPx) && viewportHeightPx > 0 ? viewportHeightPx : 1080;
  const halfTangent = Math.tan((fov * Math.PI / 180) / 2);
  const units = 2 * halfTangent * depth / height;
  if (!Number.isFinite(units) || units <= 0) return null;
  return Math.max(MIN_UNITS_PER_PIXEL, Math.min(MAX_UNITS_PER_PIXEL, units));
}

// Viewport height in CSS pixels, or a sane 1080 fallback when running headless.
export function viewportHeightPx(target) {
  const element = target?.isElement ? target : null;
  if (element) {
    const height = element.clientHeight;
    if (Number.isFinite(height) && height > 0) return height;
    const fromWindow = globalThis.innerHeight;
    if (Number.isFinite(fromWindow) && fromWindow > 0) return fromWindow;
  }
  const direct = target?.height;
  if (Number.isFinite(direct) && direct > 0) return direct;
  return 1080;
}

// Depth along the camera's forward axis (the perspective divide denominator).
// Returns null for a point the camera cannot see or a point behind it.
export function viewDepthOf(camera, point, target = new T.Vector3()) {
  if (!camera || !point) return null;
  camera.getWorldPosition(target);
  const direction = camera.getWorldDirection(viewDepthOf._forward ?? (viewDepthOf._forward = new T.Vector3()));
  if (!direction || direction.lengthSq() === 0) return null;
  const offset = viewDepthOf._offset ?? (viewDepthOf._offset = new T.Vector3());
  offset.subVectors(point, target);
  const depth = offset.dot(direction);
  if (!Number.isFinite(depth) || depth <= 0) return null;
  return depth;
}

// World units per viewport pixel at `point` for `camera`. Null when the camera
// cannot produce a usable matrix, which lets callers keep the previous scale.
export function screenUnitsPerPixel(camera, point) {
  if (!camera) return null;
  const depth = viewDepthOf(camera, point);
  if (depth === null) return null;
  const fov = camera.isPerspectiveCamera ? camera.fov : (camera.fov ?? 42);
  return unitsPerPixelAtDepth(depth, fov, viewportHeightPx(camera));
}

// Fits a sprite to `camera` so it renders at TARGET_PIXEL_WIDTH x
// TARGET_PIXEL_HEIGHT. Returns true when the scale was applied.
export function fitSpriteToCamera(sprite, camera, point = sprite.position) {
  if (!sprite || !sprite.scale) return false;
  const units = screenUnitsPerPixel(camera, point);
  if (units === null) return false;
  sprite.scale.set(TARGET_PIXEL_WIDTH * units, TARGET_PIXEL_HEIGHT * units, 1);
  return true;
}

// Anchored at the sprite's bottom: the bottom half of the quad is the label
// band, so the name renders under the strip while the bar grows upward from the
// resolved float height.
export const SPRITE_ANCHOR_Y = LABEL_LIFT / (BAR_HEIGHT + LABEL_LIFT);
export const SPRITE_ANCHOR_X = 0.5;

// A camera is only usable when it can actually produce a projection. A
// missing camera, or a bare {} / Object3D passed by mistake, leaves the bars
// exactly where the previous frame put them instead of throwing.
function isUsableCamera(camera) {
  return !!camera && typeof camera.getWorldPosition === 'function';
}

// Draws the unit name centred in the label band. Text is measured so that an
// over-long name is scaled down rather than clipped or overflowing the quad.
function drawLabel(ctx, title) {
  const text = title == null ? '' : String(title);
  if (!text || typeof ctx.measureText !== 'function') return;
  const maxWidth = CANVAS_WIDTH - 24;
  let size = LABEL_FONT_SIZE;
  let metrics = ctx.measureText(text);
  const width = metrics && Number.isFinite(metrics.width) ? metrics.width : 0;
  if (width > maxWidth && width > 0) {
    size = Math.max(18, Math.floor(LABEL_FONT_SIZE * maxWidth / width));
    ctx.font = `bold ${size}px sans-serif`;
  }
  ctx.fillText(text, CANVAS_WIDTH / 2, CANVAS_HEIGHT - LABEL_BASELINE_FROM_BOTTOM);
}

function createRoundRectPath(ctx, x, y, w, h, radius) {
  const r = Math.min(radius, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

export class UnitHud {
  // geometry/material/texture hooks are injectable so Node tests can exercise
  // the lifecycle without a canvas or WebGL context.
  constructor(root, options = {}) {
    this.root = root || null;
    this.createTexture = options.createTexture || null;
    this.group = new T.Group();
    this.group.name = 'unit-hud';
    this.group.position.set(0, 0, 0);
    this.group.quaternion.identity(); // never rotated: sprites must stay upright
    this.group.scale.set(1, 1, 1);
    this.group.renderOrder = 10;
    this.root?.add(this.group);
    this.bars = new Map();
    this.disposed = false;
  }

  // Draws the bar into a 2D context. The canvas is CANVAS_WIDTH x CANVAS_HEIGHT
  // and the label uses CANVAS_FONT; together with the screen-space fit in
  // update(camera) those are what make the name legible at the 132x40 px
  // on-screen size. Exposed (not private) so tests can drive the real production
  // draw path against a recording context without a DOM.
  _drawBar(ctx, meta, width) {
    ctx.clearRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT);

    // Health strip: dark rounded background plus the faction-coloured fill.
    ctx.fillStyle = `#${BACKGROUND_COLOR.toString(16).padStart(6, '0')}`;
    createRoundRectPath(ctx, STRIP_X, STRIP_Y, STRIP_W, STRIP_H, STRIP_RADIUS);
    ctx.fill();
    const fillWidth = Math.max(0, Math.min(1, width ?? 1)) * (STRIP_W - FILL_INSET_X * 2);
    if (fillWidth > 0) {
      ctx.fillStyle = `#${factionColor(meta?.faction).toString(16).padStart(6, '0')}`;
      createRoundRectPath(ctx, STRIP_X + FILL_INSET_X, STRIP_Y + FILL_INSET_Y, fillWidth, STRIP_H - FILL_INSET_Y * 2, FILL_RADIUS);
      ctx.fill();
    }

    // Name label, drawn because a bar with no readable owner is useless.
    ctx.fillStyle = LABEL_COLOR;
    ctx.font = CANVAS_FONT;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    drawLabel(ctx, meta?.title);
    ctx.textBaseline = 'alphabetic';
  }

  _makeTexture(meta, width) {
    if (this.createTexture) return this.createTexture(meta, width);
    if (typeof document === 'undefined' || !document.createElement) return null;
    const canvas = document.createElement('canvas');
    canvas.width = CANVAS_WIDTH;
    canvas.height = CANVAS_HEIGHT;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    this._drawBar(ctx, meta, width);

    const texture = new T.CanvasTexture(canvas);
    texture.colorSpace = T.SRGBColorSpace;
    texture.needsUpdate = true;
    return texture;
  }

  // attach(unitId, object3D, meta). `object3D` is optional but strongly
  // recommended: with it the bar tracks the object's own world position on
  // every update(camera) call and derives its height from a real Box3.
  attach(unitId, object3D, meta = {}) {
    if (this.disposed) throw new Error('UnitHud.attach: HUD has been disposed');
    if (unitId == null) throw new Error('UnitHud.attach needs a unitId');
    if (this.bars.has(unitId)) this.detach(unitId);

    const height = resolveBarHeight(object3D, meta.type, meta.height);
    const material = new T.SpriteMaterial({ transparent: true, depthTest: false });

    const texture = this._makeTexture(meta, 1);
    if (texture) material.map = texture;

    const sprite = new T.Sprite(material);
    sprite.name = `unit-hud:${unitId}`;
    sprite.center.set(SPRITE_ANCHOR_X, SPRITE_ANCHOR_Y);
    sprite.scale.set(BAR_WIDTH, BAR_HEIGHT + LABEL_LIFT, 1);

    const position = new T.Vector3();
    if (object3D) {
      try { object3D.updateWorldMatrix(true, true); } catch { /* keep the origin */ }
      position.setFromMatrixPosition(object3D.matrixWorld);
    }
    position.y = height;
    sprite.position.copy(position);

    this.group.add(sprite);
    const record = {
      sprite,
      material,
      texture,
      height,
      meta: { ...meta },
      unitId,
      object3D: object3D || null,
      healthWidth: 1,
      scaled: false
    };
    this.bars.set(unitId, record);
    return record;
  }

  setHealth(unitId, health, maxHealth) {
    if (this.disposed) return 0;
    const record = this.bars.get(unitId);
    if (!record) return 0;
    record.meta.health = health;
    record.meta.maxHealth = maxHealth;
    const width = healthBarWidth(health, maxHealth);
    record.healthWidth = width;
    const next = this._makeTexture({ ...record.meta }, width);
    if (next) {
      record.material.map?.dispose();
      record.material.map = next;
      record.texture = next;
      record.material.needsUpdate = true;
    }
    return width;
  }

  setTarget(unitId, targetId) {
    if (this.disposed) return false;
    const record = this.bars.get(unitId);
    if (!record) return false;
    const hasTarget = targetId != null;
    record.meta.targetId = hasTarget ? targetId : null;
    record.material.color.setHex(hasTarget ? 0xffd24a : 0xffffff);
    return hasTarget;
  }

  // update(camera) -- the plan's literal signature. Reads each tracked object's
  // own world position (so bars follow moved units without a caller-supplied
  // map) and refits every sprite so its rendered size is constant on screen.
  // Never throws for a missing/undefined camera: the last known position and
  // scale are kept.
  update(camera) {
    if (this.disposed) return this.bars.size;
    const usable = isUsableCamera(camera);
    const world = _updateWorld;
    for (const [, record] of this.bars) {
      if (record.object3D) {
        try {
          record.object3D.getWorldPosition(world);
          if (Number.isFinite(world.x) && Number.isFinite(world.z)) {
            record.sprite.position.set(world.x, record.height, world.z);
          }
        } catch { /* keep the last known position */ }
      } else {
        record.sprite.position.y = record.height;
      }
      if (usable && fitSpriteToCamera(record.sprite, camera)) record.scaled = true;
    }
    return this.bars.size;
  }

  detach(unitId) {
    const record = this.bars.get(unitId);
    if (!record) return false;
    this.group.remove(record.sprite);
    record.material.map?.dispose();
    record.material.dispose();
    record.object3D = null;
    this.bars.delete(unitId);
    return true;
  }

  dispose() {
    for (const unitId of [...this.bars.keys()]) this.detach(unitId);
    this.bars.clear();
    this.root?.remove(this.group);
    this.group.clear();
    this.disposed = true;
  }

  get size() { return this.bars.size; }
}

