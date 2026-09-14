import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { resetModeResources, selectTestCard, canStartBattle } from '../../src/app/game-controller.js';

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

test('canStartBattle supports random card combinations with at least one attacker per team', () => {
  assert.equal(canStartBattle(null).canStart, false);
  assert.equal(canStartBattle([]).canStart, false);

  // Missing one faction
  const onlyBlue = [{ side: 'blue', type: 'kesatria' }];
  assert.equal(canStartBattle(onlyBlue).canStart, false);
  assert.match(canStartBattle(onlyBlue).reason, /Merah/);

  // Bases only (no attackers)
  const basesOnly = [{ side: 'blue', type: 'benteng' }, { side: 'red', type: 'bunker' }];
  assert.equal(canStartBattle(basesOnly).canStart, false);
  assert.match(canStartBattle(basesOnly).reason, /penyerang/);

  // Random 1v1
  const duel1v1 = [{ side: 'blue', type: 'kesatria' }, { side: 'red', type: 'gargoyle' }];
  assert.equal(canStartBattle(duel1v1).canStart, true);

  // Random asymmetric (2 vs 1: base + artileri vs artileri)
  const asymmetric = [
    { side: 'blue', type: 'benteng' },
    { side: 'blue', type: 'robot' },
    { side: 'red', type: 'tank' }
  ];
  assert.equal(canStartBattle(asymmetric).canStart, true);
});

test('canStartBattle triggers battle readiness when both sides have units', () => {
  const full3v3 = [
    { side: 'blue', type: 'benteng' },
    { side: 'blue', type: 'robot' },
    { side: 'blue', type: 'kesatria' },
    { side: 'red', type: 'bunker' },
    { side: 'red', type: 'tank' },
    { side: 'red', type: 'gargoyle' }
  ];
  const check = canStartBattle(full3v3);
  assert.equal(check.canStart, true);
  assert.equal(check.blue.length, 3);
  assert.equal(check.red.length, 3);
});

