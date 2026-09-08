import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  calculateArenaLayout,
  VFX_COLORS,
  getVFXColor,
  COMBO_TIERS,
  getComboTier,
  ParticleEngine,
  TilePool,
  createTileDescriptor,
  WorldReaction
} from '../src/ar/vfxSystem.js';

test('calculateArenaLayout calculates correct lane dividers and centers for 4-lane setup', () => {
  const layout = calculateArenaLayout({
    laneCount: 4,
    arenaWidth: 0.8,
    arenaDepth: 2.0,
    hitPlaneZ: 0.0
  });

  assert.equal(layout.laneCount, 4);
  assert.equal(layout.arenaWidth, 0.8);
  assert.equal(Math.round(layout.laneWidth * 100) / 100, 0.2);

  // 4 lanes -> 5 dividers: -0.4, -0.2, 0.0, 0.2, 0.4
  assert.equal(layout.dividers.length, 5);
  const expectedDividers = [-0.4, -0.2, 0.0, 0.2, 0.4];
  for (let i = 0; i < expectedDividers.length; i++) {
    assert.equal(Math.abs(layout.dividers[i] - expectedDividers[i]) < 1e-6, true, `Divider ${i} should be ${expectedDividers[i]}`);
  }

  // 4 lanes -> 4 centers: -0.3, -0.1, 0.1, 0.3
  assert.equal(layout.laneCenters.length, 4);
  const expectedCenters = [-0.3, -0.1, 0.1, 0.3];
  for (let i = 0; i < expectedCenters.length; i++) {
    assert.equal(Math.abs(layout.laneCenters[i] - expectedCenters[i]) < 1e-6, true, `Center ${i} should be ${expectedCenters[i]}`);
  }
});

test('calculateArenaLayout calculates correct lane dividers and centers for 8-lane setup', () => {
  const layout = calculateArenaLayout({
    laneCount: 8,
    arenaWidth: 0.8,
    arenaDepth: 2.0,
    hitPlaneZ: 0.0
  });

  assert.equal(layout.laneCount, 8);
  assert.equal(layout.arenaWidth, 0.8);
  assert.equal(Math.round(layout.laneWidth * 100) / 100, 0.1);

  // 8 lanes -> 9 dividers
  assert.equal(layout.dividers.length, 9);
  const expectedDividers = [-0.4, -0.3, -0.2, -0.1, 0.0, 0.1, 0.2, 0.3, 0.4];
  for (let i = 0; i < expectedDividers.length; i++) {
    assert.equal(Math.abs(layout.dividers[i] - expectedDividers[i]) < 1e-6, true, `Divider ${i} should be ${expectedDividers[i]}`);
  }

  // 8 lanes -> 8 centers
  assert.equal(layout.laneCenters.length, 8);
  const expectedCenters = [-0.35, -0.25, -0.15, -0.05, 0.05, 0.15, 0.25, 0.35];
  for (let i = 0; i < expectedCenters.length; i++) {
    assert.equal(Math.abs(layout.laneCenters[i] - expectedCenters[i]) < 1e-6, true, `Center ${i} should be ${expectedCenters[i]}`);
  }
});

test('VFX_COLORS and getVFXColor map judgements to official color palette', () => {
  assert.equal(VFX_COLORS.PERFECT, 0xffd700); // Gold / Yellow
  assert.equal(VFX_COLORS.GOOD, 0x38bdf8);    // Cyan / Blue
  assert.equal(VFX_COLORS.MISS, 0xf43f5e);    // Crimson / Red

  // Case-insensitive lookups
  assert.equal(getVFXColor('PERFECT'), 0xffd700);
  assert.equal(getVFXColor('perfect'), 0xffd700);
  assert.equal(getVFXColor('GOOD'), 0x38bdf8);
  assert.equal(getVFXColor('good'), 0x38bdf8);
  assert.equal(getVFXColor('MISS'), 0xf43f5e);
  assert.equal(getVFXColor('miss'), 0xf43f5e);

  // Custom or fallback color
  assert.equal(getVFXColor('UNKNOWN', 0xffffff), 0xffffff);
});

test('ParticleEngine initializes preallocated buffer and tracks active count', () => {
  const engine = new ParticleEngine({ maxParticles: 100 });
  assert.equal(engine.maxParticles, 100);
  assert.equal(engine.getActiveCount(), 0);

  // Emitting a burst of 25 particles
  const burstCount = engine.emitBurst({
    x: 0.1,
    y: 0.0,
    z: 0.0,
    judgement: 'PERFECT',
    count: 25
  });

  assert.equal(burstCount, 25);
  assert.equal(engine.getActiveCount(), 25);

  const active = engine.getActiveParticles();
  assert.equal(active.length, 25);

  for (const p of active) {
    assert.equal(p.active, true);
    assert.equal(p.color, 0xffd700);
    assert.ok(p.life > 0);
    assert.ok(p.maxLife > 0);
    // Dispersed velocities
    assert.ok(typeof p.vx === 'number');
    assert.ok(typeof p.vy === 'number');
    assert.ok(typeof p.vz === 'number');
  }
});

test('Particle lifecycle updates position, velocity, and deactivates upon expiration', () => {
  const engine = new ParticleEngine({ maxParticles: 50 });
  engine.emitBurst({
    x: 0.0,
    y: 0.0,
    z: 0.0,
    judgement: 'GOOD',
    count: 10,
    life: 0.5
  });

  assert.equal(engine.getActiveCount(), 10);
  const initialParticle = { ...engine.getActiveParticles()[0] };

  // Step 1: Update delta 0.1s
  engine.update(0.1);
  const updatedParticle = engine.getActiveParticles()[0];
  assert.equal(updatedParticle.active, true);
  assert.ok(updatedParticle.life < initialParticle.life);
  // Position moved
  assert.notEqual(updatedParticle.x, initialParticle.x);

  // Step 2: Update past particle expiration (e.g. 1.0s total > 0.5s life)
  engine.update(1.0);
  assert.equal(engine.getActiveCount(), 0);
});

test('getComboTier maps combo streaks to official 5-tier progression', () => {
  // Tier 0: Combo < 10 -> Neutral
  const t0_0 = getComboTier(0);
  assert.equal(t0_0.tier, 0);
  assert.equal(t0_0.name, 'neutral');

  const t0_9 = getComboTier(9);
  assert.equal(t0_9.tier, 0);
  assert.equal(t0_9.name, 'neutral');

  // Tier 1: Combo 10-19 -> Subtle Glow
  const t1_10 = getComboTier(10);
  assert.equal(t1_10.tier, 1);
  assert.equal(t1_10.name, 'subtle glow');

  const t1_19 = getComboTier(19);
  assert.equal(t1_19.tier, 1);
  assert.equal(t1_19.name, 'subtle glow');

  // Tier 2: Combo 20-39 -> Particles
  const t2_20 = getComboTier(20);
  assert.equal(t2_20.tier, 2);
  assert.equal(t2_20.name, 'particles');

  const t2_39 = getComboTier(39);
  assert.equal(t2_39.tier, 2);
  assert.equal(t2_39.name, 'particles');

  // Tier 3: Combo 40-59 -> Environment Pulse
  const t3_40 = getComboTier(40);
  assert.equal(t3_40.tier, 3);
  assert.equal(t3_40.name, 'environment pulse');

  const t3_59 = getComboTier(59);
  assert.equal(t3_59.tier, 3);
  assert.equal(t3_59.name, 'environment pulse');

  // Tier 4: Combo 60+ -> Full Musical Visualization
  const t4_60 = getComboTier(60);
  assert.equal(t4_60.tier, 4);
  assert.equal(t4_60.name, 'full musical visualization');

  const t4_150 = getComboTier(150);
  assert.equal(t4_150.tier, 4);
  assert.equal(t4_150.name, 'full musical visualization');
});

test('WorldReaction manages dynamic aura and visual pulse based on combo tier', () => {
  const world = new WorldReaction();
  assert.equal(world.currentTier.tier, 0);

  world.setCombo(25);
  assert.equal(world.currentTier.tier, 2);
  assert.equal(world.currentTier.name, 'particles');

  world.setCombo(65);
  assert.equal(world.currentTier.tier, 4);
  assert.equal(world.currentTier.name, 'full musical visualization');

  // Pulse animation value oscillates smoothly over time
  const pulse1 = world.getPulseFactor(0.0);
  const pulse2 = world.getPulseFactor(0.5);
  assert.ok(typeof pulse1 === 'number');
  assert.ok(typeof pulse2 === 'number');
});

test('TilePool handles preallocation, acquire, release, and expiration recycling', () => {
  const pool = new TilePool({ capacity: 10 });
  assert.equal(pool.getCapacity(), 10);
  assert.equal(pool.getActiveCount(), 0);
  assert.equal(pool.getAvailableCount(), 10);

  // Acquire 2 tiles
  const t1 = pool.acquire({ id: 'note_1', lane: 1, timeSec: 2.0, note: 'C4' });
  assert.ok(t1);
  assert.equal(t1.active, true);
  assert.equal(t1.noteData.id, 'note_1');
  assert.equal(pool.getActiveCount(), 1);
  assert.equal(pool.getAvailableCount(), 9);

  const t2 = pool.acquire({ id: 'note_2', lane: 3, timeSec: 2.5, note: 'G4' });
  assert.ok(t2);
  assert.equal(pool.getActiveCount(), 2);
  assert.equal(pool.getAvailableCount(), 8);

  // Release t1
  pool.release(t1);
  assert.equal(t1.active, false);
  assert.equal(pool.getActiveCount(), 1);
  assert.equal(pool.getAvailableCount(), 9);

  // Acquire again reuses released slot
  const t3 = pool.acquire({ id: 'note_3', lane: 0, timeSec: 3.4, note: 'F4' });
  assert.ok(t3);
  assert.equal(pool.getActiveCount(), 2);

  // Recycle expired tiles: song time is 3.5s, threshold is 0.2s -> note_2 (2.5s) expired (3.5 - 2.5 = 1.0 > 0.2), note_3 (3.4s) active (3.5 - 3.4 = 0.1 <= 0.2)
  const recycled = pool.recycleExpired(3.5, 0.2);
  assert.equal(recycled.length, 1);
  assert.equal(recycled[0].noteData.id, 'note_2');
  assert.equal(pool.getActiveCount(), 1); // note_3 (3.4s) remaining

  // Clear pool
  pool.clear();
  assert.equal(pool.getActiveCount(), 0);
  assert.equal(pool.getAvailableCount(), 10);
});

test('createTileDescriptor generates proper cuboid geometry and material styles', () => {
  const normalDesc = createTileDescriptor({
    note: 'C4',
    lane: 1,
    laneWidth: 0.2,
    isChord: false
  });

  assert.ok(normalDesc.dimensions);
  assert.ok(normalDesc.dimensions.width < 0.2); // slight gap between lanes
  assert.ok(normalDesc.dimensions.height > 0);
  assert.ok(normalDesc.dimensions.depth > 0);
  assert.equal(normalDesc.isChord, false);

  const chordDesc = createTileDescriptor({
    note: 'Cmaj',
    lane: 0,
    laneWidth: 0.2,
    isChord: true
  });

  assert.equal(chordDesc.isChord, true);
  assert.equal(chordDesc.material.emissive, VFX_COLORS.CHORD);
  assert.ok(chordDesc.material.glowIntensity > normalDesc.material.glowIntensity);
});
