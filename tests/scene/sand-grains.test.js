import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { createGrainSampler, createGrainPool, SandGrainSystem } from '../../src/scene/sand-grains.js';
import { SandStructureSystem } from '../../src/scene/sand-structures.js';

const finite = p => Number.isFinite(p.x) && Number.isFinite(p.y) && Number.isFinite(p.z);
const advance = (system, seconds) => { for (let i = 0; i < Math.ceil(seconds / 0.05); i++) system.update(0.05); };

test('box sampling is deterministic, finite, and bounded', () => {
  const sampler = createGrainSampler();
  const a = sampler.sampleBox([2, 1, 3], 32, 17);
  assert.deepEqual(a, sampler.sampleBox([2, 1, 3], 32, 17));
  assert.notDeepEqual(a, sampler.sampleBox([2, 1, 3], 32, 18));
  assert.equal(a.length, 32);
  for (const p of a) {
    assert.ok(finite(p));
    assert.ok(Math.abs(p.x) <= 1 && Math.abs(p.y) <= 0.5 && Math.abs(p.z) <= 1.5);
  }
});

test('frustum, cone, sphere and scaled sphere targets stay inside their geometry', () => {
  const sampler = createGrainSampler();
  for (const top of [0, 0.5, 2]) {
    const points = sampler.sampleCylinder(top, 1, 3, 256, 7);
    assert.deepEqual(points, sampler.sampleCylinder(top, 1, 3, 256, 7));
    for (const p of points) {
      const radius = 1 + (top - 1) * (p.y / 3 + 0.5);
      assert.ok(finite(p) && Math.abs(p.y) <= 1.5);
      assert.ok(p.x * p.x + p.z * p.z <= radius * radius + 1e-12);
    }
  }
  const mesh = new T.Mesh(new T.SphereGeometry(1), new T.MeshBasicMaterial());
  mesh.scale.set(2, 0.5, 3);
  assert.deepEqual(sampler.samplePart({ mesh }, 128, 8), sampler.sampleSphere(128, 8));
  for (const p of sampler.sampleSphere(128, 8)) assert.ok(finite(p) && p.lengthSq() <= 1);
  mesh.geometry.dispose(); mesh.material.dispose();
});

test('extrusion sampling respects concave contours, holes, and depth', () => {
  const sampler = createGrainSampler();
  const shape = new T.Shape();
  shape.moveTo(0, 0); shape.lineTo(4, 0); shape.lineTo(4, 1);
  shape.lineTo(2, 1); shape.lineTo(2, 4); shape.lineTo(0, 4); shape.closePath();
  const hole = new T.Path();
  hole.moveTo(0.5, 0.5); hole.lineTo(1.5, 0.5); hole.lineTo(1.5, 1.5);
  hole.lineTo(0.5, 1.5); hole.closePath(); shape.holes.push(hole);
  const points = sampler.sampleExtrusion(shape, 0.7, 512, 99);
  assert.deepEqual(points, sampler.sampleExtrusion(shape, 0.7, 512, 99));
  for (const p of points) {
    assert.ok(finite(p) && p.x >= 0 && p.y >= 0 && p.x <= 4 && p.y <= 4);
    assert.ok(p.x <= 2 || p.y <= 1);
    assert.ok(!(p.x > 0.5 && p.x < 1.5 && p.y > 0.5 && p.y < 1.5));
    assert.ok(p.z >= 0 && p.z <= 0.7);
  }
});

test('invalid and degenerate dimensions do not produce non-finite samples or hang', () => {
  const sampler = createGrainSampler();
  const groups = [
    sampler.sampleBox([NaN, Infinity, -1], 20, NaN),
    sampler.sampleCylinder(Infinity, NaN, -1, 20, 1),
    sampler.sampleExtrusion(new T.Shape(), NaN, 20, 1),
    sampler.sampleSphere(NaN, 1),
  ];
  for (const points of groups) assert.ok(points.every(finite));
  assert.equal(groups[0].length, 20);
  assert.equal(groups[1].length, 20);
  assert.deepEqual(groups[3], []);
});

test('pool allocations are atomic, bounded, reusable, and owner-isolated', () => {
  const pool = createGrainPool(4);
  const a = {}, b = {};
  const slots = pool.acquire(a, 3);
  assert.equal(slots.length, 3);
  assert.deepEqual(pool.acquire(b, 2), []);
  const other = pool.acquire(b, 1);
  assert.equal(other.length, 1);
  assert.ok(!slots.includes(other[0]));
  assert.equal(pool.activeCount, 4);
  pool.clearOwner(a);
  assert.equal(pool.activeCount, 1);
  assert.equal(pool.acquire(a, 3).length, 3);
  pool.clearOwner(a); pool.clearOwner(a); pool.clearOwner(b);
  assert.equal(pool.activeCount, 0);
  assert.deepEqual(pool.acquire(a, Infinity), []);
});

test('all four structures build full-scale, preserve actions, destroy and rebuild cleanly', () => {
  const system = new SandStructureSystem(new T.Group(), { grainCapacity: 40000, particleCapacity: 10 });
  try {
    const structures = ['benteng', 'bunker', 'robot', 'tank'].map(type => system.create(type));
    for (const s of structures) {
      assert.equal(s.build(), true);
      assert.equal(s.build(), false);
      assert.ok(s.parts.every(p => !p.mesh.visible));
    }
    advance(system, 5);
    assert.equal(system.grains.pool.activeCount, 0);
    for (const s of structures) {
      assert.equal(s.state, 'built');
      assert.ok(s.parts.every(p => p.mesh.visible && p.mesh.scale.equals(p.scale)));
      assert.equal(s.act(), true);
    }
    advance(system, 0.3);
    for (const s of structures) {
      assert.equal(s.destroy(), true);
      assert.equal(s.destroy(), false);
      assert.equal(s.getColliders().length, 0);
    }
    advance(system, 5);
    for (const s of structures) {
      assert.equal(s.state, 'destroyed');
      assert.ok(s.parts.every(p => !p.mesh.visible && !p.grainSlots.length));
      assert.equal(s.build(), true);
    }
    advance(system, 5);
    assert.ok(structures.every(s => s.state === 'built'));
    assert.equal(system.grains.pool.activeCount, 0);
  } finally { system.dispose(); }
});

test('grain targets use root-local coordinates and destruction snapshots joint pose', () => {
  const scene = new T.Scene(), root = new T.Group(); scene.add(root);
  root.position.set(5, 2, -7); root.scale.set(0.18, 0.3, 0.22); root.rotation.y = 0.6;
  const system = new SandStructureSystem(root, { grainCapacity: 4000, particleCapacity: 10 });
  try {
    const s = system.create('robot', new T.Vector3(3, 0, 4));
    s.build(); advance(system, 8);
    s.arms[0].rotation.z = 1.2;
    const part = s.parts.find(p => p.mesh.parent === s.arms[0]);
    root.updateWorldMatrix(true, true);
    const expected = root.matrixWorld.clone().invert().multiply(part.mesh.matrixWorld);
    s.collapse(part, 0.2);
    const record = system.grains.owners.get(s).find(r => r.part === part);
    assert.ok(record.pose.elements.every((n, i) => Math.abs(n - expected.elements[i]) < 1e-10));
    assert.ok(record.position[0].distanceTo(part.grainTarget[0].clone().applyMatrix4(expected)) < 1e-10);
    const snapshot = record.pose.clone();
    s.arms[0].rotation.z = -1;
    assert.equal(system.grains.startDestroy(s, part), false);
    advance(system, 0.4);
    assert.deepEqual(record.pose, snapshot);
    assert.ok(record.position.every(finite));
    assert.ok(!s.getColliders().includes(part.mesh));
    advance(system, 4);
    assert.equal(system.grains.isActive(s), false);
    assert.equal(system.grains.pool.activeCount, 0);
  } finally { system.dispose(); }
});

test('impact prioritizes the nearest structural part and partial rebuild clears grains', () => {
  const system = new SandStructureSystem(new T.Group(), { grainCapacity: 4000, particleCapacity: 10 });
  try {
    const s = system.create('robot'); s.build(); advance(system, 8);
    const part = s.parts[3];
    const hit = part.mesh.getWorldPosition(new T.Vector3());
    assert.equal(s.damage(100 / s.parts.length + 0.001, hit), true);
    assert.equal(part.dead, true);
    advance(system, 0.1);
    assert.ok(system.grains.pool.activeCount > 0);
    assert.equal(s.build(), true);
    advance(system, 8);
    assert.equal(s.health, 100);
    assert.equal(system.grains.pool.activeCount, 0);
    assert.ok(s.parts.every(p => !p.dead));
  } finally { system.dispose(); }
});

test('zero capacity timed fallback and tiny capacity queues terminate without leaking', () => {
  for (const capacity of [0, 1]) {
    const root = new T.Group(), material = new T.MeshStandardMaterial();
    const grains = new SandGrainSystem(root, material, { grainCapacity: capacity });
    const group = new T.Group(); root.add(group);
    const owner = { group };
    const parts = Array.from({ length: 2 }, () => {
      const mesh = new T.Mesh(new T.BoxGeometry(1, 1, 1), material); group.add(mesh);
      const part = { mesh, scale: mesh.scale.clone(), delay: 0, dead: false };
      grains.registerPart(owner, part); return part;
    });
    try {
      for (let cycle = 0; cycle < 3; cycle++) {
        assert.equal(grains.startBuild(owner), true);
        grains.update(NaN);
        advance(grains, 8);
        assert.equal(grains.isActive(owner), false);
        assert.equal(grains.pool.activeCount, 0);
        assert.ok(parts.every(p => p.mesh.visible));
        for (const part of parts) assert.equal(grains.startDestroy(owner, part), true);
        advance(grains, 8);
        assert.equal(grains.isActive(owner), false);
        assert.equal(grains.pool.activeCount, 0);
      }
    } finally { grains.dispose(); parts.forEach(p => p.mesh.geometry.dispose()); material.dispose(); }
  }
});
