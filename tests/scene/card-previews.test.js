import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { CardPreviews, PREVIEW_SCALE } from '../../src/scene/card-previews.js';
import { SandStructureSystem } from '../../src/scene/sand-structures.js';
import { CARD_TARGETS } from '../../src/ar/card-targets.js';

const card = (index = 0) => ({ ...CARD_TARGETS[index], pose: new THREE.Matrix4().toArray(), worldPosition: [0, 0, 0] });
function setup() {
  const root = new THREE.Group();
  const systems = new SandStructureSystem(root, { grainCapacity: 100 });
  const scene = new THREE.Scene();
  return { systems, scene, previews: new CardPreviews(systems, scene) };
}

test('one through six cards appear immediately, with no battle or grain delay', () => {
  const { systems, scene, previews } = setup();
  try {
    previews.sync([{ ...card(), pose: null }]);
    assert.equal(previews.models.size, 0);
    for (let count = 1; count <= 6; count++) {
      previews.sync(Array.from({ length: count }, (_, i) => card(i)));
      assert.equal(previews.models.size, count);
      assert.equal(scene.children.length, count);
      for (const model of previews.models.values()) {
        assert.equal(model.state, 'built');
        assert.ok(model.parts.every(p => p.mesh.visible && p.grainReveal.value === 1));
      }
    }
    systems.update(0.05);
    assert.equal(systems.grains.pool.activeCount, 0);
  } finally { previews.clear(); systems.dispose(); }
});

test('pose translation and rotation follow, with model up aligned to card normal', () => {
  const { systems, previews } = setup();
  try {
    const c = card();
    previews.sync([c]);
    const model = previews.models.get(c.cardId);
    const up = new THREE.Vector3(0, 1, 0).transformDirection(model.group.matrix);
    assert.ok(up.distanceTo(new THREE.Vector3(0, 0, 1)) < 1e-10);
    const scale = new THREE.Vector3().setFromMatrixScale(model.group.matrix);
    assert.ok(PREVIEW_SCALE >= 0.16);
    assert.equal(scale.x, PREVIEW_SCALE * 1.5);
    c.pose = new THREE.Matrix4().makeRotationZ(0.7).setPosition(2, 3, -4).toArray();
    previews.sync([c]);
    assert.equal(previews.models.get(c.cardId), model);
    assert.deepEqual(new THREE.Vector3().setFromMatrixPosition(model.group.matrix).toArray(), [2, 3, -4]);
    previews.sync([]);
    assert.equal(model.group.parent, null);
    assert.equal(systems.structures.length, 0);
    assert.equal(systems.grains.owners.size, 0);
  } finally { previews.clear(); systems.dispose(); }
});

test('20 flicker cycles release every owner, geometry and material; clear is repeatable', () => {
  const { systems, scene, previews } = setup();
  let geometries = 0, materials = 0, expected = 0;
  try {
    for (let i = 0; i < 20; i++) {
      previews.sync([card(4)]);
      const model = previews.models.get('kesatria');
      expected += model.parts.length;
      for (const p of model.parts) {
        p.mesh.geometry.addEventListener('dispose', () => geometries++);
        p.mesh.material.addEventListener('dispose', () => materials++);
      }
      previews.sync([card(4)]);
      assert.equal(previews.models.get('kesatria'), model);
      previews.sync([]);
      assert.equal(scene.children.length, 0);
      assert.equal(systems.structures.length, 0);
      assert.equal(systems.grains.owners.size, 0);
      assert.equal(systems.grains.pool.activeCount, 0);
    }
    assert.equal(geometries, expected);
    assert.equal(materials, expected);
    previews.sync([card(4)]);
    previews.clear(); previews.clear();
    assert.equal(scene.children.length, 0);
    assert.equal(systems.grains.owners.size, 0);
  } finally { previews.clear(); systems.dispose(); }
});
