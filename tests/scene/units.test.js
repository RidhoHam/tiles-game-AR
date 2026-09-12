import test from 'node:test';
import assert from 'node:assert/strict';
import * as T from 'three';
import { SandStructureSystem } from '../../src/scene/sand-structures.js';
import { createUnit } from '../../src/scene/units/unit-factory.js';

const context = () => {
  const root = new T.Group();
  const system = new SandStructureSystem(root, { grainCapacity: 4000, particleCapacity: 10 });
  return { system, material: system.material, dark: system.dark, primary: system.material, root };
};

test('kesatria unit is built from the unit library', () => {
  const ctx = context();
  try {
    const unit = createUnit('kesatria', ctx, { position: new T.Vector3(), faction: 'blue', index: 0 });
    assert.equal(unit.maxHealth, 70);
    assert.equal(unit.state, 'hidden');
    assert.ok(unit.parts.length > 0);
    assert.equal(unit.group.parent, ctx.root);
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('gargoyle unit exposes wings and collapses once', () => {
  const ctx = context();
  try {
    const unit = createUnit('gargoyle', ctx, { position: new T.Vector3(), faction: 'red', index: 0 });
    assert.equal(unit.wings.length, 2);
    assert.equal(unit.collapse(), true);
    assert.equal(unit.collapse(), false);
    unit.dispose();
  } finally { ctx.system.dispose(); }
});

test('unit library rejects unknown type', () => {
  const ctx = context();
  try { assert.throws(() => createUnit('dragon', ctx, {})); }
  finally { ctx.system.dispose(); }
});
