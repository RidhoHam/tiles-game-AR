import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateTileZPosition,
  calculateTileSpeed,
  raycastGroundPlane,
  ARScene
} from '../src/ar/arScene.js';

test('calculateTileSpeed and calculateTileZPosition compute correct falling trajectories', () => {
  const spawnZ = -2.0;
  const hitPlaneZ = 0.0;
  const travelDurationSec = 2.0;

  const speed = calculateTileSpeed(spawnZ, hitPlaneZ, travelDurationSec);
  assert.equal(speed, 1.0); // 2.0 meters in 2.0 seconds = 1.0 m/s

  // At spawn time (2.0s before note time), tile is at spawnZ (-2.0)
  const zSpawn = calculateTileZPosition(4.0, 2.0, hitPlaneZ, speed);
  assert.equal(Math.round(zSpawn * 100) / 100, -2.0);

  // At hit time (currentTime == noteTime = 4.0), tile is exactly at hitPlaneZ (0.0)
  const zHit = calculateTileZPosition(4.0, 4.0, hitPlaneZ, speed);
  assert.equal(Math.round(zHit * 100) / 100, 0.0);

  // Halfway (currentTime = 3.0), tile is at -1.0
  const zHalf = calculateTileZPosition(4.0, 3.0, hitPlaneZ, speed);
  assert.equal(Math.round(zHalf * 100) / 100, -1.0);

  // Past hit plane (currentTime = 4.2), tile is at +0.2
  const zPast = calculateTileZPosition(4.0, 4.2, hitPlaneZ, speed);
  assert.equal(Math.round(zPast * 100) / 100, 0.2);
});

test('raycastGroundPlane intersects camera ray with virtual ground plane for fallback mode', () => {
  // Camera at (0, 0, 0), ray aiming forward and slightly downward: direction (0, -0.5, -1.0) normalized
  const origin = { x: 0, y: 0, z: 0 };
  const direction = { x: 0, y: -0.5, z: -1.0 };
  const groundY = -0.3; // ground height

  const hitPoint = raycastGroundPlane(origin, direction, groundY);
  assert.ok(hitPoint);
  assert.equal(Math.round(hitPoint.y * 100) / 100, -0.3);
  // t = (-0.3 - 0) / -0.5 = 0.6
  // z = 0 + 0.6 * (-1.0) = -0.6
  assert.equal(Math.round(hitPoint.z * 100) / 100, -0.6);
  assert.equal(hitPoint.x, 0.0);

  // Ray pointing upwards should not hit ground below camera
  const upwardDir = { x: 0, y: 0.5, z: -1.0 };
  const missPoint = raycastGroundPlane(origin, upwardDir, groundY);
  assert.equal(missPoint, null);
});

test('ARScene initializes with sensible defaults and SSR safety', () => {
  const scene = new ARScene({ laneCount: 4, arenaWidth: 0.8 });
  assert.equal(scene.laneCount, 4);
  assert.equal(scene.arenaWidth, 0.8);
  assert.equal(scene.isPlaced, false);
  assert.equal(scene.mode, 'uninitialized');
  assert.ok(scene.vfx);
  assert.ok(scene.tilePool);
});

test('ARScene setLaneCount switches dynamically between 4-lane and 8-lane configurations', () => {
  const scene = new ARScene({ laneCount: 4, arenaWidth: 0.8 });
  assert.equal(scene.layout.laneCount, 4);
  assert.equal(scene.layout.laneCenters.length, 4);
  assert.equal(scene.layout.dividers.length, 5);

  scene.setLaneCount(8);
  assert.equal(scene.laneCount, 8);
  assert.equal(scene.layout.laneCount, 8);
  assert.equal(scene.layout.laneCenters.length, 8);
  assert.equal(scene.layout.dividers.length, 9);
  assert.equal(Math.round(scene.layout.laneWidth * 100) / 100, 0.1);
});

test('ARScene placement methods update arena position and mark isPlaced', () => {
  const scene = new ARScene();
  assert.equal(scene.isPlaced, false);

  // Fallback placement
  scene.placeArena({ x: 0.0, y: -0.3, z: -1.2 });
  assert.equal(scene.isPlaced, true);
  assert.equal(scene.arenaTransform.position.x, 0.0);
  assert.equal(scene.arenaTransform.position.y, -0.3);
  assert.equal(scene.arenaTransform.position.z, -1.2);
});
