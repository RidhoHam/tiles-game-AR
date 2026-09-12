import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { SandStructureSystem } from '../../src/scene/sand-structures.js';
import { TestModelController } from '../../src/scene/test-model-controller.js';
import { CARD_TARGETS } from '../../src/ar/card-targets.js';
import { SandEffects } from '../../src/scene/sand-effects.js';

const pose = (x = 0) => new THREE.Matrix4().makeRotationZ(0.4).setPosition(x, 2, -1).toArray();
const card = (index = 0, x = 0) => ({ ...CARD_TARGETS[index], pose: pose(x) });

function setup() {
  const scene = new THREE.Scene();
  const systems = new SandStructureSystem(scene, { grainCapacity: 100 });
  return { scene, systems, controller: new TestModelController({ systems, root: scene }) };
}

test('owns one model, reuses it for pose changes, and replaces changed cards', () => {
  const { scene, systems, controller } = setup();
  try {
    const first = controller.sync(card(0));
    assert.equal(controller.available, true);
    assert.equal(controller.sync(card(0, 3)), first);
    assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(controller._anchor.matrix).toArray(), [3, 2, -1]);
    const second = controller.sync(card(1));
    assert.notEqual(second, first);
    assert.equal(systems.structures.length, 1);
    assert.equal(scene.children.filter(child => child === controller._anchor).length, 1);
  } finally { controller.dispose(); systems.dispose(); }
});

test('clear and card loss dispose the model and are repeatable', () => {
  const { systems, controller } = setup();
  try {
    controller.sync(card(4));
    controller.sync(null);
    controller.clear();
    assert.equal(controller.model, null);
    assert.equal(controller.card, null);
    assert.equal(controller.available, false);
    assert.equal(systems.structures.length, 0);
  } finally { controller.dispose(); systems.dispose(); }
});

test('destroy clears the model after the structure reaches terminal destroyed state', () => {
  const { systems, controller } = setup();
  try {
    controller.sync(card(0));
    const model = controller.model;
    assert.equal(controller.perform('destroy').ok, true);
    assert.equal(model.state, 'destroying');
    for (let i = 0; i < 100 && controller.model; i++) {
      systems.update(0.05);
      controller.update(0.05);
    }
    assert.equal(model.state, 'destroyed');
    assert.equal(controller.model, null);
    assert.equal(controller.card, null);
    assert.equal(controller.available, false);
    assert.equal(systems.structures.length, 0);
    assert.doesNotThrow(() => controller.clear());
  } finally { controller.dispose(); systems.dispose(); }
});

test('destroy immediately syncs the test HUD to zero during the collapse', () => {
  const scene = new THREE.Scene();
  const systems = new SandStructureSystem(scene, { grainCapacity: 100 });
  const healthCalls = [];
  const hud = { setHealth: (...args) => healthCalls.push(args) };
  const controller = new TestModelController({ systems, root: scene, hud });
  try {
    controller.sync(card(0));
    healthCalls.length = 0;

    assert.equal(controller.perform('destroy').ok, true);
    assert.deepEqual(healthCalls.at(-1), ['test-model', 0, 100]);
    assert.equal(controller.model.state, 'destroying');
  } finally { controller.dispose(); systems.dispose(); }
});

test('controller update does not advance a model already owned by the system', () => {
  const { systems, controller } = setup();
  try {
    controller.sync(card(0));
    const model = controller.model;
    const before = model.elapsed;

    controller.update(0.5);
    assert.equal(model.elapsed, before);

    systems.update(0.05);
    assert.equal(model.elapsed, before + 0.05);
  } finally { controller.dispose(); systems.dispose(); }
});

test('reset and build restore the test HUD health bar', () => {
  const scene = new THREE.Scene();
  const systems = new SandStructureSystem(scene, { grainCapacity: 100 });
  const healthCalls = [];
  const hud = { setHealth: (...args) => healthCalls.push(args) };
  const controller = new TestModelController({ systems, root: scene, hud });
  try {
    controller.sync(card(0));
    controller.perform('damage');
    assert.deepEqual(healthCalls.at(-1), ['test-model', 90, 100]);

    assert.equal(controller.perform('reset').ok, true);
    assert.deepEqual(healthCalls.at(-1), ['test-model', 100, 100]);

    controller.perform('damage');
    assert.equal(controller.perform('build').ok, true);
    assert.deepEqual(healthCalls.at(-1), ['test-model', 100, 100]);
  } finally { controller.dispose(); systems.dispose(); }
});

test('actions are safe without a model and mutate an available model', () => {
  const empty = setup();
  assert.equal(empty.controller.perform('action').ok, false);
  empty.controller.dispose(); empty.systems.dispose();

  const { systems, controller } = setup();
  try {
    controller.sync(card(2));
    const before = controller._anchor.matrix.clone();
    assert.equal(controller.perform('rotate-right').ok, true);
    assert.notDeepEqual(controller._anchor.matrix.elements, before.elements);
    assert.equal(controller.perform('damage').ok, true);
    assert.ok(controller.model.health >= 0);
    for (let i = 0; i < 20; i++) controller.perform('scale-up');
    assert.ok(controller.scale <= 0.5);
    for (let i = 0; i < 40; i++) controller.perform('scale-down');
    assert.ok(controller.scale >= 0.08);
  } finally { controller.dispose(); systems.dispose(); }
});

test('damage is strictly non-lethal and unavailable at one health', () => {
  const { systems, controller } = setup();
  try {
    controller.sync(card(2));
    controller.model.health = 5;
    assert.equal(controller.perform('damage').ok, true);
    assert.equal(controller.model.health, 1);
    assert.equal(controller.model.state, 'built');
    const result = controller.perform('damage');
    assert.equal(result.ok, false);
    assert.equal(controller.model.health, 1);
    assert.equal(controller.model.state, 'built');
  } finally { controller.dispose(); systems.dispose(); }
});

test('reports rejected lifecycle actions instead of claiming success', () => {
  const { systems, controller } = setup();
  try {
    controller.sync(card(2));
    controller.perform('damage');
    assert.equal(controller.perform('action').ok, false);
    assert.equal(controller.perform('destroy').ok, true);
    assert.equal(controller.perform('build').ok, false);
    assert.equal(controller.perform('destroy').ok, false);
  } finally { controller.dispose(); systems.dispose(); }
});

test('marker anchor preserves model group animation transforms', () => {
  const { scene, systems, controller } = setup();
  try {
    controller.sync(card(2));
    const model = controller.model;
    model.group.position.x = 0.25;
    controller.update(0.1);
    assert.equal(model.group.parent, controller._anchor);
    assert.equal(scene.children.includes(controller._anchor), true);
    assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(controller._anchor.matrix).toArray(), [0, 2, -1]);
    assert.equal(model.group.position.x, 0.25);
  } finally { controller.dispose(); systems.dispose(); }
});

test('pose application propagates a visible model world transform', () => {
  const { systems, controller } = setup();
  try {
    controller.sync(card(2, 3));
    const model = controller.model;
    const worldPosition = new THREE.Vector3().setFromMatrixPosition(model.group.matrixWorld);
    const visibleParts = model.parts.filter(part => part.mesh.visible);

    assert.ok(visibleParts.length > 0);
    assert.deepEqual(worldPosition.toArray(), [3, 2, -1]);
    assert.equal(model.group.matrixWorld.elements[12], 3);
    assert.equal(model.group.matrixWorld.elements[13], 2);
    assert.equal(model.group.matrixWorld.elements[14], -1);
  } finally { controller.dispose(); systems.dispose(); }
});

test('clear removes only particles owned by the test model', () => {
  const scene = new THREE.Scene();
  const material = new THREE.MeshBasicMaterial();
  const effects = new SandEffects(scene, material, 8);
  const testOwner = {};
  const battleOwner = {};
  effects.burst(new THREE.Vector3(), 2, false, testOwner);
  effects.burst(new THREE.Vector3(), 2, false, battleOwner);
  effects.clearOwner(testOwner);
  assert.equal(effects.items.filter(item => item.owner === testOwner && item.age < item.life).length, 0);
  assert.equal(effects.items.filter(item => item.owner === battleOwner && item.age < item.life).length, 2);
  effects.dispose();
  material.dispose();
});
