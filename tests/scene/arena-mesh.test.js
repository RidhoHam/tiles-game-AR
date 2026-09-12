import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { ArenaMesh, guideLineX, sceneBoundsFromArena } from '../../src/scene/arena-mesh.js';
import { GuideLines } from '../../src/scene/guide-lines.js';

test('scene bounds follow the calibrated arena', () => {
  const bounds = sceneBoundsFromArena({ width: 6, depth: 4 });
  assert.equal(bounds.halfWidth, 3);
  assert.equal(bounds.halfDepth, 2);
});

test('scene bounds never collapse to zero', () => {
  const bounds = sceneBoundsFromArena({ width: 0, depth: 0 });
  assert.ok(bounds.halfWidth > 0);
  assert.ok(bounds.halfDepth > 0);
});

test('guide lines produce left, centre and right positions', () => {
  const [left, center, right] = guideLineX({ centerX: 0, width: 6 });
  assert.equal(center, 0);
  assert.ok(left < center);
  assert.ok(right > center);
});

// ---------------------------------------------------------------------------
// Robustness: sceneBoundsFromArena must always be finite and strictly positive.
// ---------------------------------------------------------------------------
const BAD_BOUND_INPUTS = [
  undefined,
  null,
  {},
  0,
  'arena',
  [],
  NaN,
  Infinity,
  -Infinity,
  { width: undefined, depth: undefined },
  { width: null, depth: null },
  { width: NaN, depth: NaN },
  { width: Infinity, depth: Infinity },
  { width: -6, depth: -4 },
  { width: -1e9, depth: -1e9 },
  { width: '6', depth: '4' },
  { width: {}, depth: [] }
];

test('scene bounds stay finite and positive for malformed arenas', () => {
  for (const input of BAD_BOUND_INPUTS) {
    const bounds = sceneBoundsFromArena(input);
    assert.ok(Number.isFinite(bounds.halfWidth) && bounds.halfWidth > 0,
      `halfWidth for ${JSON.stringify(input)} was ${bounds.halfWidth}`);
    assert.ok(Number.isFinite(bounds.halfDepth) && bounds.halfDepth > 0,
      `halfDepth for ${JSON.stringify(input)} was ${bounds.halfDepth}`);
  }
});

test('scene bounds shrink but never reach zero for a tiny arena', () => {
  const bounds = sceneBoundsFromArena({ width: 0.0001, depth: 0.0001 });
  assert.ok(Number.isFinite(bounds.halfWidth) && bounds.halfWidth > 0);
  assert.ok(Number.isFinite(bounds.halfDepth) && bounds.halfDepth > 0);
});

test('scene bounds fall back to the default for a missing span and match it for a full one', () => {
  // A missing/absent span uses the whole default arena box.
  for (const input of BAD_BOUND_INPUTS) {
    const bounds = sceneBoundsFromArena(input);
    assert.equal(bounds.halfWidth, 6, `halfWidth for ${JSON.stringify(input)}`);
    assert.equal(bounds.halfDepth, 4, `halfDepth for ${JSON.stringify(input)}`);
  }
  // A 12x8 arena maps to the same box with no clamp in play.
  const full = sceneBoundsFromArena({ width: 12, depth: 8 });
  assert.equal(full.halfWidth, 6);
  assert.equal(full.halfDepth, 4);
});

test('scene bounds scale linearly for a normal arena', () => {
  assert.equal(sceneBoundsFromArena({ width: 10, depth: 2 }).halfWidth, 5);
  assert.equal(sceneBoundsFromArena({ width: 10, depth: 2 }).halfDepth, 1.75);
});

// ---------------------------------------------------------------------------
// Robustness: guideLineX ordering and centring.
// ---------------------------------------------------------------------------
test('guide lines stay ordered and centred around a non-zero centreX', () => {
  for (const centerX of [3, -7.5, 0.25, 100, -0.0001]) {
    const [left, center, right] = guideLineX({ centerX, width: 6 });
    assert.equal(center, centerX, `center for ${centerX}`);
    assert.ok(left < center, `left ${left} < center ${center}`);
    assert.ok(right > center, `right ${right} > center ${center}`);
    // The centre line is the exact midpoint of the two outer lines.
    assert.ok(Math.abs((left + right) / 2 - center) < 1e-12);
    // Symmetric offset: both outer lines are the same distance from the centre.
    assert.ok(Math.abs((center - left) - (right - center)) < 1e-12);
  }
});

test('guide lines keep a positive offset when width is zero, missing or garbage', () => {
  for (const input of [
    { centerX: 0, width: 0 },
    { centerX: 5, width: 0 },
    { centerX: 0 },
    { centerX: 0, width: undefined },
    { centerX: 0, width: NaN },
    { centerX: 0, width: -6 },
    { centerX: 0, width: Infinity }
  ]) {
    const [left, center, right] = guideLineX(input);
    assert.ok(Number.isFinite(left) && Number.isFinite(center) && Number.isFinite(right),
      `non-finite lines for ${JSON.stringify(input)}: ${left}, ${center}, ${right}`);
    assert.ok(left < center, `left ${left} must stay inside centre ${center}`);
    assert.ok(right > center, `right ${right} must stay outside centre ${center}`);
  }
});

test('guide lines tolerate a non-object or non-finite arena', () => {
  for (const input of [undefined, null, {}, 0, 'arena', NaN, { centerX: NaN, width: NaN }, { centerX: Infinity }]) {
    const lines = guideLineX(input);
    assert.equal(lines.length, 3);
    for (const x of lines) assert.ok(Number.isFinite(x), `line ${x} for ${JSON.stringify(input)}`);
    assert.equal(lines[1], 0, 'the centre line falls back to 0');
    assert.ok(lines[0] < lines[1] && lines[2] > lines[1]);
  }
});

test('guide lines stay within the arena for a very wide spread', () => {
  const [left, center, right] = guideLineX({ centerX: 0, width: 100 });
  // The zone never balloons to the arena edge: it brackets about one card row.
  // Two outer lines bracket one card row, i.e. 2 x the clamped half-offset (CARD_ROW = 1.2).
  assert.ok(right - left <= 2.4 + 1e-9, `zone was ${right - left} wide`);
});

// ---------------------------------------------------------------------------
// ArenaMesh: repeated apply() must not leak geometry or materials.
// ---------------------------------------------------------------------------
function countMeshes(root) {
  let meshes = 0;
  let children = 0;
  const visit = node => {
    children++;
    if (node.isMesh) meshes++;
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return { meshes, children };
}

function collectGeometryIds(root) {
  const ids = new Set();
  const visit = node => {
    if (node.geometry) ids.add(node.geometry.uuid);
    for (const child of node.children || []) visit(child);
  };
  visit(root);
  return ids;
}

test('ArenaMesh apply is reusable without leaking geometry or children', () => {
  const root = new T.Group();
  const arena = new ArenaMesh(root);
  const arenas = [];
  for (let i = 0; i < 25; i++) {
    arenas.push({ centerX: i - 12, centerZ: i % 5, width: i % 7, depth: (i * 3) % 6 });
  }
  // Degenerate and fallback arenas must be handled too.
  arenas.push({ centerX: 0, centerZ: 0, width: 0, depth: 0 }, { width: 6, depth: 4 }, {});

  arena.apply(arenas[0]);
  const firstGeometryIds = collectGeometryIds(root);
  const firstShape = countMeshes(root);
  const groupCount = root.children.length;

  for (const value of arenas) arena.apply(value);

  assert.deepEqual(countMeshes(root), firstShape, 'the mesh/child count must not grow');
  assert.equal(root.children.length, groupCount, 'no extra group may be added per apply');
  assert.deepEqual(collectGeometryIds(root), firstGeometryIds, 'no new geometry may be allocated');

  // Every transform must be finite and strictly positive where it is a size.
  for (const mesh of [arena.floor, arena.centerLine, arena.boundary]) {
    for (const key of ['x', 'y', 'z']) {
      assert.ok(Number.isFinite(mesh.position[key]), `${mesh.name}.position.${key} = ${mesh.position[key]}`);
      assert.ok(Number.isFinite(mesh.scale[key]), `${mesh.name}.scale.${key} = ${mesh.scale[key]}`);
    }
    assert.ok(mesh.scale.x > 0 && mesh.scale.z > 0, `${mesh.name} has a non-positive size`);
  }

  arena.dispose();
  assert.equal(root.children.length, 0, 'dispose must detach the arena group');
  assert.equal(root.children.includes(arena.group), false);
});

test('ArenaMesh apply after dispose is a safe no-op', () => {
  const root = new T.Group();
  const arena = new ArenaMesh(root);
  arena.dispose();
  assert.doesNotThrow(() => arena.apply({ width: 6, depth: 4 }));
  assert.equal(root.children.length, 0);
  arena.dispose(); // idempotent
});

test('ArenaMesh dispose releases every geometry and material exactly once', () => {
  const root = new T.Group();
  const arena = new ArenaMesh(root);
  arena.apply({ centerX: 2, centerZ: -1, width: 10, depth: 6 });

  const disposed = { geometry: 0, material: 0 };
  for (const geometry of arena._geometries) {
    const original = geometry.dispose.bind(geometry);
    geometry.dispose = () => { disposed.geometry++; original(); };
  }
  for (const material of arena._materials) {
    const original = material.dispose.bind(material);
    material.dispose = () => { disposed.material++; original(); };
  }

  arena.dispose();
  assert.equal(disposed.geometry, 3, 'three geometries must be disposed');
  assert.equal(disposed.material, 3, 'three materials must be disposed');
  assert.equal(arena._geometries.length, 0);
  assert.equal(arena._materials.length, 0);
});

// ---------------------------------------------------------------------------
// GuideLines: show/hide toggling, positioning and cleanup.
// ---------------------------------------------------------------------------
test('GuideLines show positions the three lines for a non-zero centreX and hide toggles them off', () => {
  const root = new T.Group();
  const guide = new GuideLines(root);
  const groupCount = root.children.length;
  assert.equal(root.children.length, groupCount);
  assert.equal(guide.group.visible, false, 'hidden by default');
  for (const line of guide.lines) assert.equal(line.visible, false, 'lines hidden by default');

  guide.show({ centerX: 4, centerZ: -2, width: 6 });
  assert.equal(guide.group.visible, true);
  for (const line of guide.lines) assert.equal(line.visible, true);

  const [left, center, right] = guideLineX({ centerX: 4, width: 6 });
  assert.equal(guide.lines[0].position.x, left);
  assert.equal(guide.lines[1].position.x, center);
  assert.equal(guide.lines[2].position.x, right);
  assert.equal(center, 4);
  assert.ok(left < center && right > center);
  for (const line of guide.lines) {
    assert.equal(line.position.z, -2, 'lines sit on the arena centre Z');
    assert.ok(line.scale.x > 0 && line.scale.x < 0.1, 'lines stay thin');
  }

  guide.show({ centerX: -9, centerZ: 3, width: 2 });
  assert.equal(guide.lines[0].position.x, guideLineX({ centerX: -9, width: 2 })[0]);
  assert.equal(guide.lines[1].position.x, -9);
  assert.equal(guide.lines[0].position.z, 3);

  guide.hide();
  assert.equal(guide.group.visible, false);
  for (const line of guide.lines) assert.equal(line.visible, false);

  // Showing again after hide must work.
  guide.show({ centerX: 0, width: 6 });
  assert.equal(guide.group.visible, true);
  assert.equal(guide.lines[1].position.x, 0);

  assert.equal(root.children.length, groupCount, 'show/hide must not add children');
});

test('GuideLines tolerates malformed arenas on show', () => {
  const root = new T.Group();
  const guide = new GuideLines(root);
  for (const input of [undefined, null, {}, { centerX: NaN, centerZ: Infinity, width: NaN }]) {
    assert.doesNotThrow(() => guide.show(input));
    for (const line of guide.lines) {
      assert.ok(Number.isFinite(line.position.x) && Number.isFinite(line.position.z),
        `line position for ${JSON.stringify(input)}`);
    }
  }
  guide.dispose();
});

test('GuideLines dispose detaches and releases its geometry and material', () => {
  const root = new T.Group();
  const guide = new GuideLines(root);
  guide.show({ centerX: 1, width: 6 });

  let geometryDisposals = 0;
  let materialDisposals = 0;
  for (const geometry of guide._geometries) {
    const original = geometry.dispose.bind(geometry);
    geometry.dispose = () => { geometryDisposals++; original(); };
  }
  for (const material of guide._materials) {
    const original = material.dispose.bind(material);
    material.dispose = () => { materialDisposals++; original(); };
  }

  guide.dispose();
  assert.equal(geometryDisposals, 1, 'the shared line geometry is disposed once');
  assert.equal(materialDisposals, 1, 'the shared line material is disposed once');
  assert.equal(root.children.length, 0, 'the guide group is detached');
  assert.equal(guide.group.visible, false);
  assert.equal(guide.group.children.length, 0);

  // Post-dispose calls are safe no-ops.
  assert.doesNotThrow(() => guide.show({ centerX: 1, width: 6 }));
  assert.doesNotThrow(() => guide.hide());
  guide.dispose();
  assert.equal(root.children.length, 0);
});

