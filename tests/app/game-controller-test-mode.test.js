import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resetModeResources, selectTestCard } from '../../src/app/game-controller.js';

const pose = new THREE.Matrix4().identity().toArray();

test('test mode skips invalid detections and selects the first valid known card', () => {
  const selected = selectTestCard([
    { type: 'benteng', pose: null },
    { type: 'not-a-unit', pose },
    { type: 'robot', pose: pose.slice(0, 15) },
    { type: 'tank', pose: [...pose.slice(0, 15), Infinity] },
    { type: 'kesatria', pose }
  ]);
  assert.equal(selected.type, 'kesatria');
});

test('test mode returns no card when every detection is invalid', () => {
  assert.equal(selectTestCard([{ type: 'benteng', pose: null }]), null);
});

test('mode transition cleanup clears timers, battle resources, and test resources', () => {
  const calls = [];
  resetModeResources({
    clearTimeouts: () => calls.push('timeouts'),
    clearBattlefield: () => calls.push('battlefield'),
    clearTestModel: () => calls.push('test')
  });
  assert.deepEqual(calls, ['timeouts', 'battlefield', 'test']);
});
