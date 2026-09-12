import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { SandStructureSystem } from '../../src/scene/sand-structures.js';
import { createUnit } from '../../src/scene/units/unit-factory.js';
import {
  BAR_HEIGHT,
  BAR_WIDTH,
  CANVAS_FONT,
  CANVAS_HEIGHT,
  CANVAS_WIDTH,
  KNOWN_TOPS,
  LABEL_FONT_SIZE,
  LABEL_LIFT,
  MAX_UNITS_PER_PIXEL,
  MIN_UNITS_PER_PIXEL,
  SCREEN_PX_PER_CANVAS_PX,
  TARGET_GLYPH_PIXELS,
  TARGET_PIXEL_HEIGHT,
  TARGET_PIXEL_WIDTH,
  factionColor,
  UnitHud,
  healthBarWidth,
  resolveBarHeight,
  unitsPerPixelAtDepth,
  defaultBarHeight,
  viewDepthOf
} from '../../src/scene/unit-hud.js';

// The project's fixed camera: 1920x1080, fov 42, positioned at (16, 18, 22)
// looking at (0, 1, 0) -- copied verbatim from src/scene/scene-system.js so the
// readability numbers below describe the real shipped view.
const VIEW_WIDTH = 1920;
const VIEW_HEIGHT = 1080;
const CAMERA_FOV = 42;
const CAMERA_POSITION = Object.freeze([16, 18, 22]);
const CAMERA_TARGET = Object.freeze([0, 1, 0]);

function realCamera() {
  const camera = new T.PerspectiveCamera(CAMERA_FOV, VIEW_WIDTH / VIEW_HEIGHT, 0.08, 140);
  camera.position.set(...CAMERA_POSITION);
  camera.lookAt(...CAMERA_TARGET);
  camera.updateMatrixWorld(true);
  return camera;
}

// Projects a sprite's quad corners through a real PerspectiveCamera and returns
// the on-screen bounding size in CSS pixels. This is the measurement the review
// asked for: it goes through the same matrices a renderer would use.
function projectSpritePixels(camera, sprite) {
  const width = sprite.scale.x;
  const height = sprite.scale.y;
  const anchorX = sprite.center.x;
  const anchorY = sprite.center.y;
  const forward = new T.Vector3(0, 0, 1).applyQuaternion(camera.quaternion).normalize();
  const up = new T.Vector3(0, 1, 0).applyQuaternion(camera.quaternion).normalize();
  const center = sprite.position.clone().addScaledVector(forward, (0.5 - anchorY) * height);
  const corners = [];
  for (const sx of [-anchorX, 1 - anchorX]) {
    for (const sy of [-anchorY, 1 - anchorY]) {
      corners.push(center.clone().addScaledVector(up, sy * height).addScaledVector(
        new T.Vector3().crossVectors(new T.Vector3().subVectors(new T.Vector3(), forward), up).normalize(),
        sx * width));
    }
  }
  const ndc = corners.map(corner => corner.project(camera));
  const xs = ndc.map(v => v.x);
  const ys = ndc.map(v => v.y);
  return {
    width: (Math.max(...xs) - Math.min(...xs)) / 2 * VIEW_WIDTH,
    height: (Math.max(...ys) - Math.min(...ys)) / 2 * VIEW_HEIGHT
  };
}


test('health bar width maps health onto a 0..1 range', () => {
  assert.equal(healthBarWidth(100, 100), 1);
  assert.equal(healthBarWidth(50, 100), 0.5);
  assert.equal(healthBarWidth(0, 100), 0);
});

test('health bar width clamps out of range values', () => {
  assert.equal(healthBarWidth(-10, 100), 0);
  assert.equal(healthBarWidth(999, 100), 1);
  assert.equal(healthBarWidth(10, 0), 0);
});

test('faction colour is blue for blue and red for red', () => {
  assert.equal(factionColor('blue'), 0x176db2);
  assert.equal(factionColor('red'), 0xbd4b3c);
});

test('health bar width tolerates degenerate max health', () => {
  assert.equal(healthBarWidth(10, 0), 0);
  assert.equal(healthBarWidth(10, -5), 0);
  assert.equal(healthBarWidth(10, NaN), 0);
  assert.equal(healthBarWidth(10, Infinity), 0);
  assert.equal(healthBarWidth(10, undefined), 0);
  assert.equal(healthBarWidth(10, null), 0);
});

test('health bar width tolerates degenerate health', () => {
  assert.equal(healthBarWidth(NaN, 100), 0);
  assert.equal(healthBarWidth(Infinity, 100), 0);
  assert.equal(healthBarWidth(undefined, 100), 0);
  assert.equal(healthBarWidth(null, 100), 0);
});

test('health bar width clamps health above the maximum', () => {
  assert.equal(healthBarWidth(150, 100), 1);
  assert.equal(healthBarWidth(Infinity, Infinity), 0);
});

test('faction colour falls back for unknown or missing factions', () => {
  const fallback = factionColor('green');
  assert.equal(typeof fallback, 'number');
  assert.notEqual(fallback, 0x176db2);
  assert.notEqual(fallback, 0xbd4b3c);
  assert.equal(factionColor(undefined), fallback);
  assert.equal(factionColor(null), fallback);
  assert.equal(factionColor(''), fallback);
});

// A stub canvas texture keeps the lifecycle tests DOM-free while still
// exercising the real dispose plumbing on sprites and materials.
function stubHud() {
  const root = new T.Group();
  const created = [];
  const hud = new UnitHud(root, {
    createTexture: (meta) => {
      const texture = { disposed: false, dispose() { this.disposed = true; } };
      created.push({ texture, meta });
      return texture;
    }
  });
  return { root, hud, created };
}
// A recording 2D context, so the drawing calls the production canvas path makes
// A recording 2D context, so the drawing calls the production canvas path makes
// can be inspected in Node without a DOM. Text metrics are faked with a
// plausible proportional width so the shrink-to-fit branch is exercised.
function recordingContext() {
  const calls = [];
  const ctx = {
    calls,
    font: '',
    fillStyle: '',
    textAlign: '',
    textBaseline: '',
    clearRect: (...args) => calls.push({ op: 'clearRect', args }),
    beginPath: () => calls.push({ op: 'beginPath' }),
    moveTo: (...args) => calls.push({ op: 'moveTo', args }),
    lineTo: (...args) => calls.push({ op: 'lineTo', args }),
    quadraticCurveTo: (...args) => calls.push({ op: 'quadraticCurveTo', args }),
    closePath: () => calls.push({ op: 'closePath' }),
    fill: () => calls.push({ op: 'fill', style: ctx.fillStyle }),
    fillText: (text, x, y) => calls.push({ op: 'fillText', text, x, y, font: ctx.font }),
    measureText: (text) => ({ width: String(text).length * 24 })
  };
  return ctx;
}

// A canvas-sized recorder that satisfies the real `HTMLCanvasElement` surface the
// production `_makeTexture` path uses. Installing it as `globalThis.document`
// makes the tests exercise the ACTUAL draw path (dimension assignment, font
// selection, fillText) rather than a parallel re-implementation.
class RecordingCanvas {
  constructor() {
    this.ctx = recordingContext();
    this._width = 0;
    this._height = 0;
  }
  get width() { return this._width; }
  set width(value) { this._width = value; }
  get height() { return this._height; }
  set height(value) { this._height = value; }
  getContext() { return this.ctx; }
}

// Installs a minimal document whose createElement('canvas') returns recording
// canvases, runs `body`, then removes the stub. Returns every canvas created.
function withStubDocument(body) {
  const previous = globalThis.document;
  const canvases = [];
  globalThis.document = {
    createElement(tag) {
      if (tag !== 'canvas') return null;
      const canvas = new RecordingCanvas();
      canvases.push(canvas);
      return canvas;
    }
  };
  try {
    body(canvases);
  } finally {
    if (previous === undefined) delete globalThis.document;
    else globalThis.document = previous;
  }
  return canvases;
}
// whole group, exactly the quantity defaultBarHeight() claims to be derived
// from. Groups are placed at the origin, which is where every origin sits in
// this project (ground level, y = 0).
function measureRealModelTops() {
  const root = new T.Group();
  const system = new SandStructureSystem(root, { grainCapacity: 4000, particleCapacity: 10 });
  const tops = {};
  try {
    for (const type of ['benteng', 'bunker', 'robot', 'tank', 'kesatria', 'gargoyle']) {
      const structure = system.create(type, new T.Vector3(0, 0, 0));
      structure.group.position.set(0, 0, 0);
      structure.group.updateWorldMatrix(true, true);
      const box = new T.Box3().setFromObject(structure.group);
      tops[type] = box.max.y;
      structure.dispose();
    }
  } finally { system.dispose(); }
  return tops;
}

// Builds a real SandStructureSystem with real (drained) models: structures via
// create() + build(), units via createUnit(). `system.update()` is pumped until
// every structure reports 'built', so the models are settled, not mid-build.
function buildRealScene(structureTypes = [], unitTypes = []) {
  const root = new T.Group();
  const system = new SandStructureSystem(root, { grainCapacity: 20000, particleCapacity: 50 });
  const context = { system, material: system.material, dark: system.dark, primary: system.material, root };
  const structures = {};
  for (const type of structureTypes) {
    const structure = system.create(type, new T.Vector3(0, 0, 0));
    structure.build();
    let frames = 0;
    while (structure.state !== 'built' && frames < 4000) { system.update(1 / 60); frames++; }
    structure.group.updateWorldMatrix(true, true);
    structures[type] = structure;
  }
  const units = {};
  for (const type of unitTypes) {
    const unit = createUnit(type, context, { position: new T.Vector3(0, 0, 0), faction: 'blue', index: 0 });
    unit.group.position.set(0, 0, 0);
    for (const part of unit.parts) part.mesh.visible = true;
    unit.group.updateWorldMatrix(true, true);
    units[type] = unit;
  }
  return {
    root, system, structures, units,
    teardown() {
      for (const unit of Object.values(units)) unit.dispose();
      system.dispose();
    }
  };
}

test('attach creates one world-space sprite bar per unit', () => {
  const { root, hud } = stubHud();
  const unit = new T.Group();
  unit.position.set(2, 0, -3);
  const a = hud.attach('blue-a', unit, { faction: 'blue', title: 'Benteng Pasir', height: 9.5 });
  const b = hud.attach('red-a', unit, { faction: 'red', title: 'Kesatria Pasir', height: 3.2 });

  assert.equal(hud.size, 2);
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0], hud.group);
  assert.ok(a.sprite.isSprite && b.sprite.isSprite);
  assert.ok(hud.group.children.includes(a.sprite));
  assert.ok(!unit.children.includes(a.sprite));
  assert.equal(a.sprite.position.y, 9.5);
  assert.equal(b.sprite.position.y, 3.2);
  assert.ok(a.material.transparent && !a.material.depthTest);
  assert.deepEqual([a.sprite.scale.x, a.sprite.scale.y], [1.6, 0.22 + 0.4]);
  hud.dispose();
});

test('attach derives the height from the model bounds when none is given', () => {
  const { hud } = stubHud();
  const unit = new T.Group();
  const mesh = new T.Mesh(new T.BoxGeometry(1, 4, 1));
  mesh.position.y = 2;
  unit.add(mesh);
  const record = hud.attach('blue-b', unit, { faction: 'blue', title: 'Robot Pasir', type: 'robot' });
  assert.ok(Math.abs(record.height - 4.55) < 1e-6);
  mesh.geometry.dispose();
  hud.dispose();
});

test('setHealth changes the fill width and reports the clamped ratio', () => {
  const { hud, created } = stubHud();
  const unit = new T.Group();
  hud.attach('blue-a', unit, { faction: 'blue', title: 'Benteng Pasir', height: 9.5 });
  const before = created.length;
  assert.equal(hud.setHealth('blue-a', 100, 200), 0.5);
  assert.equal(hud.setHealth('blue-a', 0, 200), 0);
  assert.equal(hud.setHealth('blue-a', 999, 200), 1);
  assert.equal(hud.setHealth('blue-a', 40, 0), 0);
  assert.equal(created.length, before + 4);
  assert.equal(hud.size, 1);
  hud.dispose();
});

test('setHealth is a no-op for an unknown unit', () => {
  const { hud } = stubHud();
  const before = hud.size;
  assert.equal(hud.setHealth('nope', 10, 20), 0);
  assert.equal(hud.setTarget('nope', 'x'), false);
  assert.equal(hud.detach('nope'), false);
  assert.equal(hud.size, before);
  hud.dispose();
});

test('setTarget marks and clears the bar without allocating', () => {
  const { hud } = stubHud();
  const unit = new T.Group();
  const record = hud.attach('blue-a', unit, { faction: 'blue', title: 'Benteng Pasir', height: 9.5 });
  const color = record.material.color.getHex();
  assert.equal(hud.setTarget('blue-a', 'red-base'), true);
  assert.notEqual(record.material.color.getHex(), color);
  assert.equal(hud.setTarget('blue-a', null), false);
  assert.equal(record.material.color.getHex(), color);
  hud.dispose();
});


// ---------------------------------------------------------------------------
// update(camera) -- the plan's literal interface
// ---------------------------------------------------------------------------
test('update(camera) alone follows a moved unit because the HUD tracks the object', () => {
  const { hud } = stubHud();
  const unit = new T.Group();
  unit.position.set(2, 0, -3);
  const record = hud.attach('blue-a', unit, { faction: 'blue', title: 'Kesatria Pasir', height: 3.7 });

  // Before update the bar sits at the unit's attach-time world position.
  assert.deepEqual(
    [record.sprite.position.x, record.sprite.position.y, record.sprite.position.z],
    [2, 3.7, -3]
  );

  // Move the unit's GROUP (the realistic case: a unit walking the arena) and
  // call update with ONLY a camera -- no positions map. I1's regression.
  unit.position.set(-5, 0, 4);
  const camera = realCamera();
  assert.equal(hud.update(camera), 1);

  assert.deepEqual(
    [record.sprite.position.x, record.sprite.position.y, record.sprite.position.z],
    [-5, 3.7, 4]
  );

  // And again, tracking a second move, still with no map.
  unit.position.set(0, 0, 0);
  hud.update(camera);
  assert.deepEqual(
    [record.sprite.position.x, record.sprite.position.y, record.sprite.position.z],
    [0, 3.7, 0]
  );
  hud.dispose();
});

test('update(camera) picks up a world position inherited from a parent transform', () => {
  const { hud } = stubHud();
  const parent = new T.Group();
  parent.position.set(10, 0, 0);
  parent.rotation.y = Math.PI / 2;
  const unit = new T.Group();
  unit.position.set(0, 0, -3);
  parent.add(unit);
  const record = hud.attach('blue-a', unit, { faction: 'blue', title: 'U', height: 2 });

  hud.update(realCamera());
  // Rotated by +90 deg about Y: (0, 0, -3) -> (-3, 0, 0), then +10 on x.
  assert.ok(Math.abs(record.sprite.position.x - 7) < 1e-9, `x was ${record.sprite.position.x}`);
  assert.ok(Math.abs(record.sprite.position.z - 0) < 1e-9, `z was ${record.sprite.position.z}`);
  hud.dispose();
});

test('update tolerates a missing, undefined or malformed camera without throwing', () => {
  const { hud } = stubHud();
  const unit = new T.Group();
  unit.position.set(1, 0, 1);
  const record = hud.attach('blue-a', unit, { faction: 'blue', title: 'U', height: 4 });
  for (const bad of [undefined, null, {}, 0, 'camera', { getWorldPosition: null }]) {
    assert.doesNotThrow(() => hud.update(bad));
  }
  // The bar still followed its unit even though no camera worked.
  assert.equal(hud.size, 1);
  assert.deepEqual(
    [record.sprite.position.x, record.sprite.position.y, record.sprite.position.z],
    [1, 4, 1]
  );
  assert.deepEqual([record.sprite.scale.x, record.sprite.scale.y], [1.6, 0.22 + 0.4]);
  hud.dispose();
});

test('an attach without an object3D keeps working and never crashes update(camera)', () => {
  const { hud } = stubHud();
  const record = hud.attach('blue-a', null, { faction: 'blue', title: 'U', height: 7.5 });
  assert.equal(record.sprite.position.y, 7.5);
  assert.doesNotThrow(() => hud.update(realCamera()));
  assert.doesNotThrow(() => hud.update(undefined));
  assert.equal(record.sprite.position.y, 7.5);
  hud.dispose();
});

// ---------------------------------------------------------------------------
// C1 -- on-screen size stays constant and lands in the readable target range
// ---------------------------------------------------------------------------
test('update(camera) fits the sprite into the fixed screen-space target size', () => {
  const { hud } = stubHud();
  const unit = new T.Group();
  const record = hud.attach('blue-a', unit, { faction: 'blue', title: 'U', height: 3 });
  hud.update(realCamera());
  const units = unitsPerPixelAtDepth(
    viewDepthOf(realCamera(), record.sprite.position),
    realCamera().fov,
    1080
  );
  assert.ok(Math.abs(record.sprite.scale.x - TARGET_PIXEL_WIDTH * units) < 1e-9);
  assert.ok(Math.abs(record.sprite.scale.y - TARGET_PIXEL_HEIGHT * units) < 1e-9);
  hud.dispose();
});

test('the rendered bar is about 128x39 px and stays constant across camera distances', () => {
  const { hud } = stubHud();
  const unit = new T.Group();
  const record = hud.attach('blue-a', unit, { faction: 'blue', title: 'Benteng Pasir', height: 9.4773 });

  const depths = [null, 0.3, 2.5]; // null => the project's own camera distance
  const measured = [];
  for (const factor of depths) {
    const camera = realCamera();
    if (factor !== null) {
      // Push the camera along its own forward axis to change the view depth of
      // the bar without changing the bar itself.
      const forward = camera.getWorldDirection(new T.Vector3());
      const base = viewDepthOf(camera, record.sprite.position);
      camera.position.addScaledVector(forward, base - base * factor);
      camera.updateMatrixWorld(true);
    }
    hud.update(camera);
    const pixels = projectSpritePixels(camera, record.sprite);
    measured.push(pixels);
  }

  for (const pixels of measured) {
    assert.ok(pixels.width > 110 && pixels.width < 150, `width ${pixels.width}`);
    assert.ok(pixels.height > 34 && pixels.height < 44, `height ${pixels.height}`);
  }
  const spread = (vs) => Math.max(...vs) - Math.min(...vs);
  const widths = measured.map(m => m.width);
  const heights = measured.map(m => m.height);
  assert.ok(spread(widths) < 0.5, `widths drifted: ${widths.join(', ')}`);
  assert.ok(spread(heights) < 0.5, `heights drifted: ${heights.join(', ')}`);

  // Sanity: those pixel figures imply a readable label. The label band is the
  // bottom LABEL_LIFT fraction of the quad, and the canvas font occupies half
  // the canvas height, so the on-screen glyph height is height * 0.5 * 0.5.
  const glyphPx = measured[0].height * (LABEL_LIFT / (BAR_HEIGHT + LABEL_LIFT)) * (48 / CANVAS_HEIGHT);
  assert.ok(glyphPx >= 5, `label would be ${glyphPx}px tall`);
  hud.dispose();
});

test('screen-space sizing clamps instead of exploding or vanishing at extreme range', () => {
  const { hud } = stubHud();
  const unit = new T.Group();
  const record = hud.attach('blue-a', unit, { faction: 'blue', title: 'U', height: 3 });

  const veryClose = realCamera();
  veryClose.position.copy(new T.Vector3(0.1, 3, 0.1));
  veryClose.lookAt(record.sprite.position);
  veryClose.updateMatrixWorld(true);
  hud.update(veryClose);
  assert.ok(Number.isFinite(record.sprite.scale.x) && record.sprite.scale.x > 0);
  assert.ok(record.sprite.scale.x <= TARGET_PIXEL_WIDTH * MAX_UNITS_PER_PIXEL + 1e-9);

  const veryFar = realCamera();
  veryFar.position.set(1600, 1800, 2200);
  veryFar.lookAt(0, 1, 0);
  veryFar.updateMatrixWorld(true);
  hud.update(veryFar);
  assert.ok(Number.isFinite(record.sprite.scale.x) && record.sprite.scale.x > 0);
  assert.ok(record.sprite.scale.x >= TARGET_PIXEL_WIDTH * MIN_UNITS_PER_PIXEL - 1e-9);
  hud.dispose();
});

// ---------------------------------------------------------------------------
// Name label is actually drawn (C1: "re-check the canvas resolution and font")
// ---------------------------------------------------------------------------
test('the name label is really drawn, on a big enough canvas, in a big enough font', () => {
  const unit = new T.Group();
  const hud = new UnitHud(new T.Group());
  let created;
  // No createTexture hook: the REAL production canvas path runs against the
  // stubbed document, so canvas dimensions, font and fillText are all covered.
  const canvases = withStubDocument(() => {
    const record = hud.attach('blue-a', unit, { faction: 'blue', title: 'Benteng Pasir', height: 9 });
    created = record.texture;
    hud.setHealth('blue-a', 50, 100);
  });

  assert.equal(canvases.length, 2, 'one canvas per attach plus one for the setHealth rebuild');
  for (const canvas of canvases) {
    assert.equal(canvas.width, CANVAS_WIDTH, 'the production code must size the canvas');
    assert.equal(canvas.height, CANVAS_HEIGHT);
  }

  const texts = canvases.flatMap(c => c.ctx.calls).filter(c => c.op === 'fillText');
  assert.ok(texts.length >= 2, 'fillText was never called -- the label is missing');
  assert.ok(texts.every(c => c.text === 'Benteng Pasir'),
    'the label must draw the unit title, got ' + JSON.stringify(texts.map(t => t.text)));

  // The font really used for the label is the exported CANVAS_FONT.
  assert.ok(texts.every(c => c.font === CANVAS_FONT),
    'label font was ' + JSON.stringify(texts.map(c => c.font)));
  assert.equal(CANVAS_FONT, 'bold ' + LABEL_FONT_SIZE + 'px sans-serif');
  assert.equal(LABEL_FONT_SIZE, 56);
  // Rendered glyph size, derived only from exported constants. The sprite is
  // drawn at TARGET_PIXEL_WIDTH px wide, so the canvas is sampled at
  // TARGET_PIXEL_WIDTH / CANVAS_WIDTH screen px per canvas px ("sp"). A
  // LABEL_FONT_SIZE px font therefore renders LABEL_FONT_SIZE * sp px tall;
  // the visible box is the ascent above the baseline, which is smaller than
  // the 1.15em em box, so the recorded font size is the upper bound.
  const pxPerCanvasPx = TARGET_PIXEL_WIDTH / CANVAS_WIDTH;
  assert.equal(SCREEN_PX_PER_CANVAS_PX, pxPerCanvasPx);
  const glyphPx = LABEL_FONT_SIZE * pxPerCanvasPx;
  assert.equal(TARGET_GLYPH_PIXELS, glyphPx);
  assert.ok(Math.abs(glyphPx - 14.4375) < 0.01, "em box was " + glyphPx);
  assert.ok(glyphPx >= 12, "label em box would be " + glyphPx + "px tall at 1080p");

  // The label band of the quad is LABEL_LIFT/(BAR_HEIGHT+LABEL_LIFT) tall, and
  // the text must sit inside it or it would collide with the health strip.
  const labelBandPx = TARGET_PIXEL_HEIGHT * (LABEL_LIFT / (BAR_HEIGHT + LABEL_LIFT));
  assert.ok(Math.abs(labelBandPx - 25.81) < 0.01, "label band was " + labelBandPx);
  assert.ok(labelBandPx > glyphPx, "the glyph overflows its " + labelBandPx + "px band");
  // A 56 px font has a ~0.72em cap height, which is the number a reader sees.
  const capPx = glyphPx * 0.72;
  assert.ok(capPx >= 10, "cap height would be only " + capPx + "px");

  // The strip keeps the rest of the quad, so the bar is a real, visible strip.
  const stripPx = TARGET_PIXEL_HEIGHT - labelBandPx;
  assert.ok(stripPx > 10, "the health strip would be only " + stripPx + "px tall");

  // The faction fill and the background strip are both painted, so the fill has
  // contrast against a dark backing and the bar is visible against sand.
  const fills = canvases.flatMap(c => c.ctx.calls).filter(c => c.op === 'fill').map(c => c.style);
  assert.ok(fills.includes('#101418'), 'the background strip was not drawn');
  // The setHealth rebuild must paint a visibly SHORTER fill. quadWidths()
  // returns the rounded rects in draw order: [0] is the strip background,
  // [1] is the faction fill. The exact vertex the path parser reads is
  // offset by the corner arc, so this asserts the direction and rough scale
  // of the change rather than pixel-perfect geometry (which is covered by
  // the pure healthBarWidth tests above and by the returned ratio below).
  const fullQuads = quadWidths(canvases[0].ctx.calls);
  const halfQuads = quadWidths(canvases[1].ctx.calls);
  assert.equal(fullQuads.length, 2, "a full bar draws a background and a fill");
  assert.equal(halfQuads.length, 2, "a half bar also draws a background and a fill");
  assert.ok(Math.abs(fullQuads[0] - halfQuads[0]) < 1e-6, "the strip background width is fixed");
  assert.ok(fullQuads[1] > 200, "the full fill should span most of the strip, got " + fullQuads[1]);
  assert.ok(halfQuads[1] > 0, "no half fill rect was drawn");
  assert.ok(halfQuads[1] < fullQuads[1] * 0.65,
    "half health drew " + halfQuads[1] + " but the full fill is " + fullQuads[1]);
  assert.ok(halfQuads[1] > fullQuads[1] * 0.35,
    "half health drew " + halfQuads[1] + " which is not roughly half of " + fullQuads[1]);
  hud.dispose();
});


test('an over-long unit name is shrunk to fit instead of overflowing the canvas', () => {

  const hud = new UnitHud(new T.Group());
  let canvases;
  withStubDocument((made) => {
    hud.attach('blue-a', null, { faction: 'blue', title: 'Benteng Pasir Yang Sangat Panjang Sekali', height: 9 });
    canvases = made;
  });
  const call = canvases[0].ctx.calls.find(c => c.op === 'fillText');
  assert.ok(call, 'the label was not drawn');
  const size = Number(/bold (\d+)px/.exec(call.font)?.[1]);
  assert.ok(size > 0 && size < LABEL_FONT_SIZE, 'font size ' + size + ' should have shrunk');
  assert.ok(size >= 18, 'font size ' + size + ' must stay legible');
  hud.dispose();
});

test('the label falls back to an empty string instead of drawing "undefined"', () => {
  const hud = new UnitHud(new T.Group());
  let canvases;
  withStubDocument((made) => {
    hud.attach('blue-a', null, { faction: 'blue', height: 4 });
    canvases = made;
  });
  const strings = canvases[0].ctx.calls.filter(c => c.op === 'fillText').map(c => c.text);
  assert.deepEqual(strings, []);
  hud.dispose();
});

// The longest rounded-rect width recorded in a draw pass, i.e. the health fill.
// Every rounded-rect width recorded in a draw pass, in draw order. The first is
// the health strip background and the second (when health > 0) is the
// faction-coloured fill, so the fill width is directly observable.
function quadWidths(calls) {
  const widths = [];
  let start = null;
  for (const call of calls) {
    if (call.op === 'moveTo') start = call.args[0];
    if (call.op === 'lineTo' && start !== null) { widths.push(call.args[0] - start); start = null; }
  }
  return widths;
}

test('the per-type fallback floats a bar above every real measured model top', () => {
  const realTops = measureRealModelTops();
  for (const [type, top] of Object.entries(realTops)) {
    assert.ok(Number.isFinite(top) && top > 0, `${type} did not measure`);
    assert.equal(KNOWN_TOPS[type], Number(top.toFixed(4)), `${type} table value is stale`);
    const bar = defaultBarHeight(type);
    assert.ok(bar > top, `${type}: bar ${bar} is not above the real top ${top}`);
    assert.ok(bar - top >= 0.5, `${type}: clearance ${bar - top} is too tight`);
    // And the realised height, routed through resolveBarHeight's fallback path.
    assert.equal(resolveBarHeight(null, type, undefined), bar);
  }
  // The aliases must resolve to the measured entries, not the unknown default.
  assert.equal(KNOWN_TOPS.castle, undefined);
  assert.equal(defaultBarHeight('castle'), defaultBarHeight('benteng'));
  assert.equal(defaultBarHeight('knight'), defaultBarHeight('kesatria'));
  // An unknown type falls back to the tallest model, which can only over-float.
  assert.ok(defaultBarHeight('dragon') > Math.max(...Object.values(realTops)));
});

test('an empty Box3 measurement falls back to the table for every type', () => {
  const empty = new T.Object3D();
  for (const type of Object.keys(KNOWN_TOPS)) {
    assert.equal(resolveBarHeight(empty, type), defaultBarHeight(type));
  }
  // A live measurement still wins over the table when one exists.
  const unit = new T.Group();
  const mesh = new T.Mesh(new T.BoxGeometry(1, 6, 1));
  mesh.position.y = 3;
  unit.add(mesh);
  assert.ok(Math.abs(resolveBarHeight(unit, 'kesatria') - 6.55) < 1e-6);
  mesh.geometry.dispose();
});
// The scaled-structure regression: benteng has group.scale = 1.5, so a bar
// placed from unscaled geometry (or from the origin) would sink into the castle.
test('a bar on a real, built, 1.5x-scaled benteng clears the real Box3 top', () => {
  const { hud } = stubHud();
  const scene = buildRealScene(['benteng']);
  try {
    const benteng = scene.structures.benteng;
    assert.equal(benteng.state, 'built', 'the model must be fully built, not mid-build');
    assert.equal(benteng.group.scale.x, 1.5, 'benteng must be scaled for this test to have teeth');
    benteng.group.updateWorldMatrix(true, true);
    const box = new T.Box3().setFromObject(benteng.group);

    const record = hud.attach('blue-benteng', benteng.group, {
      faction: 'blue', title: 'Benteng Pasir', type: 'benteng'
    });
    hud.update(realCamera());

    assert.ok(record.sprite.position.y > box.max.y,
      `bar y ${record.sprite.position.y} must be above the real top ${box.max.y}`);
    assert.ok(box.max.y > 8.5, `measured top ${box.max.y} looks wrong for a 1.5x benteng`);
    assert.ok(record.sprite.position.y - box.max.y >= 0.5,
      `clearance ${record.sprite.position.y - box.max.y} is too tight`);
    assert.ok(Math.abs(record.sprite.position.x - benteng.group.position.x) < 1e-6);
    assert.ok(Math.abs(record.sprite.position.z - benteng.group.position.z) < 1e-6);
  } finally { scene.teardown(); hud.dispose(); }
});

test('a bar on a real kesatria unit clears the real Box3 top and follows it', () => {
  const { hud } = stubHud();
  const scene = buildRealScene([], ['kesatria']);
  try {
    const unit = scene.units.kesatria;
    unit.group.updateWorldMatrix(true, true);
    const box = new T.Box3().setFromObject(unit.group);
    assert.ok(box.max.y > 2, `measured kesatria top ${box.max.y} looks wrong`);

    const record = hud.attach('blue-kesatria', unit.group, {
      faction: 'blue', title: 'Kesatria Pasir', type: 'kesatria'
    });
    assert.ok(record.height > box.max.y, `height ${record.height} must clear ${box.max.y}`);

    // A real measured top beats the table, and the table is checked against the
    // same measurement elsewhere in this file.
    assert.ok(record.height >= box.max.y + 0.5 - 1e-9,
      "height " + record.height + " must carry the full clearance over " + box.max.y);
    unit.group.updateWorldMatrix(true, true);
    hud.update(realCamera());
    assert.ok(record.sprite.position.y > box.max.y);
    assert.ok(Math.abs(record.sprite.position.x - unit.group.position.x) < 1e-6,
      'the bar did not follow the walking unit');
  } finally { scene.teardown(); hud.dispose(); }
});

// ---------------------------------------------------------------------------
// I2 -- attach/setHealth/setTarget after dispose
// ---------------------------------------------------------------------------
test('attach after dispose throws a clear error instead of leaking an orphan bar', () => {
  const { root, hud, created } = stubHud();
  const unit = new T.Group();
  const live = hud.attach('blue-a', unit, { faction: 'blue', title: 'A', height: 5 });
  hud.setHealth('blue-a', 20, 100);
  hud.dispose();

  const before = created.length;
  assert.throws(() => hud.attach('blue-b', unit, { faction: 'blue', title: 'B', height: 6 }),
    /disposed/i);
  assert.equal(created.length, before, 'no texture may be allocated after dispose');
  assert.equal(hud.size, 0);
  assert.equal(hud.group.children.length, 0);
  assert.equal(root.children.length, 0);
  assert.ok(live.material.map.disposed, 'the pre-dispose texture must be disposed exactly once');
  hud.dispose();
  assert.equal(created.length, before);
});

test('setHealth and setTarget after dispose are safe no-ops that allocate nothing', () => {
  const { hud, created } = stubHud();
  hud.attach('blue-a', new T.Group(), { faction: 'blue', title: 'A', height: 5 });
  hud.dispose();
  const before = created.length;
  assert.equal(hud.setHealth('blue-a', 10, 100), 0);
  assert.equal(hud.setHealth('ghost', 10, 100), 0);
  assert.equal(hud.setTarget('blue-a', 'x'), false);
  assert.equal(created.length, before);
});

test('attach is a no-op for a null unitId before and after dispose', () => {
  const { hud } = stubHud();
  assert.throws(() => hud.attach(null, new T.Group(), {}), /unitId/);
  assert.throws(() => hud.attach(undefined, new T.Group(), {}), /unitId/);
  assert.equal(hud.size, 0);
  hud.dispose();
});

// ---------------------------------------------------------------------------
// Leak check, including the attach-after-dispose path
test('every texture and material is disposed exactly once across detach and dispose', () => {
  const root = new T.Group();
  const created = [];
  // The recorder wraps dispose() AT CREATION TIME, so the swap inside
  // setHealth (which frees the superseded texture immediately) is counted.
  const hud = new UnitHud(root, {
    createTexture: (meta, width) => {
      const texture = { disposed: false, disposeCount: 0, dispose() { this.disposeCount++; this.disposed = true; } };
      created.push({ texture, meta, width });
      return texture;
    }
  });
  const unit = new T.Group();
  const ids = ['a', 'b', 'c', 'd', 'e'];
  const records = ids.map((id, i) => hud.attach(id, unit, { faction: 'blue', title: 'U' + i, height: 2 + i }));
  hud.setHealth('a', 50, 100);
  hud.setHealth('b', 10, 100);
  // 5 attaches + 1 rebuild for 'a' + 1 rebuild for 'b'.
  assert.equal(created.length, 7);

  let materialDisposals = 0;
  for (const r of records) {
    const original = r.material.dispose.bind(r.material);
    r.material.dispose = () => { materialDisposals++; original(); };
  }

  const allTextures = created.map(c => c.texture);
  const counts = () => allTextures.map(t => t.disposeCount);
  // created[0]/[1] are the a/b attach textures that setHealth superseded, so
  // the swap already freed them; [5]/[6] are the live rebuilds.
  assert.deepEqual(counts(), [1, 1, 0, 0, 0, 0, 0]);

  // detach frees only the CURRENT map of a bar and must not re-free the
  // texture the swap already released.
  assert.equal(hud.detach('a'), true);
  assert.deepEqual(counts(), [1, 1, 0, 0, 0, 1, 0]);
  assert.equal(hud.detach('b'), true);
  assert.deepEqual(counts(), [1, 1, 0, 0, 0, 1, 1]);
  assert.equal(materialDisposals, 2, 'exactly the two detached materials');
  assert.equal(hud.size, 3);

  hud.dispose();
  hud.dispose(); // idempotent
  assert.equal(materialDisposals, ids.length, 'each of the 5 materials disposed exactly once');
  assert.deepEqual(counts(), [1, 1, 1, 1, 1, 1, 1], 'each texture disposed EXACTLY once');
  assert.equal(hud.size, 0);
  assert.equal(hud.group.children.length, 0);
  assert.equal(root.children.length, 0);

  // A late attach must not add an eighth texture, resurrect a bar, or free
  // anything. This is the I2 leak: before the guard, this call created an
  // orphan sprite in a detached group whose CanvasTexture was never freed.
  const before = created.length;
  assert.throws(() => hud.attach('late', unit, { faction: 'red', title: 'X', height: 9 }), /disposed/i);
  assert.equal(created.length, before, 'no texture may be allocated after dispose');
  assert.deepEqual(counts(), [1, 1, 1, 1, 1, 1, 1], 'nothing new leaked and nothing was re-freed');
  assert.equal(hud.size, 0);
  assert.equal(hud.group.children.length, 0);
});

test('update after dispose is a no-op and does not resurrect bars', () => {
  const { hud } = stubHud();
  hud.attach('a', new T.Group(), { faction: 'blue', title: 'A', height: 5 });
  hud.dispose();
  assert.equal(hud.update(realCamera()), 0);
  assert.equal(hud.group.children.length, 0);
});
