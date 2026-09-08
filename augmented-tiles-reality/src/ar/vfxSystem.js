/**
 * VFX System & 3D Particle Engine for AR Piano Tiles
 *
 * Implements:
 * - Arena geometry layout calculations (4-lane & 8-lane configurations)
 * - Preallocated high-performance particle burst system (Points / InstancedMesh)
 * - Color palette mapping (PERFECT -> Gold, GOOD -> Cyan, MISS -> Crimson, CHORD -> Purple)
 * - Particle physics & lifecycle updates over delta time
 * - 5-tier World Reaction combo aura system (neutral -> full musical visualization)
 * - Zero-garbage Tile Pool allocation and recycling
 * - 3D cuboid tile mesh descriptors & Three.js mesh generation
 * - SSR / Node.js safe execution without WebGL context
 */

export const VFX_COLORS = {
  PERFECT: 0xffd700,    // Gold / Bright Yellow
  GOOD: 0x38bdf8,       // Sky Blue / Cyan
  MISS: 0xf43f5e,       // Crimson / Rose Red
  CHORD: 0xa855f7,      // Purple accent for chord grouping
  HOLD: 0x10b981,       // Emerald green for hold trails
  HAND_LEFT: 0xec4899,  // Magenta for left hand
  HAND_RIGHT: 0x06b6d4, // Cyan for right hand
  NEON_BORDER: 0x6366f1, // Indigo neon rail
  HIT_LINE: 0x38bdf8,   // Laser hit line
  GRID_FLOOR: 0x1e293b   // Holographic dark slate
};

/**
 * Returns hexadecimal color for judgement or event
 * @param {string} judgement
 * @param {number} [fallback=0xffffff]
 * @returns {number}
 */
export function getVFXColor(judgement, fallback = 0xffffff) {
  if (!judgement || typeof judgement !== 'string') return fallback;
  const key = judgement.trim().toUpperCase();
  if (key === 'PERFECT') return VFX_COLORS.PERFECT;
  if (key === 'GOOD') return VFX_COLORS.GOOD;
  if (key === 'MISS') return VFX_COLORS.MISS;
  if (key === 'CHORD') return VFX_COLORS.CHORD;
  if (key === 'HOLD') return VFX_COLORS.HOLD;
  return fallback;
}

/**
 * Calculates arena layout geometry, lane divider coordinates, and lane center X positions
 *
 * @param {Object} [options={}]
 * @param {number} [options.laneCount=4] - 4 or 8 lanes
 * @param {number} [options.arenaWidth=0.8] - Total width in meters
 * @param {number} [options.arenaDepth=2.0] - Total depth from spawn to hit plane in meters
 * @param {number} [options.hitPlaneZ=0.0] - Z coordinate of hit plane
 * @param {number} [options.spawnZ] - Z coordinate of tile spawn origin
 * @returns {Object}
 */
export function calculateArenaLayout(options = {}) {
  const laneCount = options.laneCount ?? 4;
  const arenaWidth = options.arenaWidth ?? 0.8;
  const arenaDepth = options.arenaDepth ?? 2.0;
  const hitPlaneZ = options.hitPlaneZ ?? 0.0;
  const spawnZ = options.spawnZ ?? (hitPlaneZ - arenaDepth);
  const laneWidth = arenaWidth / laneCount;

  // Dividers: (laneCount + 1) boundary X positions from -arenaWidth/2 to +arenaWidth/2
  const dividers = [];
  for (let i = 0; i <= laneCount; i++) {
    const x = -arenaWidth / 2 + i * laneWidth;
    dividers.push(Math.round(x * 1000000) / 1000000);
  }

  // Lane centers: laneCount centers
  const laneCenters = [];
  for (let i = 0; i < laneCount; i++) {
    const x = -arenaWidth / 2 + (i + 0.5) * laneWidth;
    laneCenters.push(Math.round(x * 1000000) / 1000000);
  }

  return {
    laneCount,
    arenaWidth,
    arenaDepth,
    hitPlaneZ,
    spawnZ,
    laneWidth,
    dividers,
    laneCenters
  };
}

/**
 * 5-tier World Reaction combo progression
 */
export const COMBO_TIERS = [
  { minCombo: 0, tier: 0, name: 'neutral', glowIntensity: 0.1, pulseSpeed: 0.5, particleDensity: 0.0 },
  { minCombo: 10, tier: 1, name: 'subtle glow', glowIntensity: 0.3, pulseSpeed: 1.0, particleDensity: 0.2 },
  { minCombo: 20, tier: 2, name: 'particles', glowIntensity: 0.6, pulseSpeed: 1.5, particleDensity: 0.5 },
  { minCombo: 40, tier: 3, name: 'environment pulse', glowIntensity: 1.0, pulseSpeed: 2.2, particleDensity: 0.8 },
  { minCombo: 60, tier: 4, name: 'full musical visualization', glowIntensity: 1.5, pulseSpeed: 3.0, particleDensity: 1.0 }
];

/**
 * Returns combo tier object based on streak count
 * @param {number} combo
 * @returns {Object}
 */
export function getComboTier(combo = 0) {
  const c = Math.max(0, Number(combo) || 0);
  if (c >= 60) return COMBO_TIERS[4];
  if (c >= 40) return COMBO_TIERS[3];
  if (c >= 20) return COMBO_TIERS[2];
  if (c >= 10) return COMBO_TIERS[1];
  return COMBO_TIERS[0];
}

/**
 * ParticleEngine — High-performance preallocated particle burst system
 */
export class ParticleEngine {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.maxParticles=500]
   * @param {Object} [options.three] - Optional Three.js instance
   */
  constructor(options = {}) {
    this.maxParticles = options.maxParticles ?? 500;
    this.three = options.three || (typeof window !== 'undefined' && window.THREE) || null;

    // Preallocated internal particle records
    this.particles = new Array(this.maxParticles);
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles[i] = {
        id: i,
        active: false,
        x: 0,
        y: 0,
        z: 0,
        vx: 0,
        vy: 0,
        vz: 0,
        r: 1,
        g: 1,
        b: 1,
        color: 0xffffff,
        size: 0.03,
        life: 0,
        maxLife: 1.0
      };
    }

    this.pointsMesh = null;
    this.positionsArray = null;
    this.colorsArray = null;
    this.sizesArray = null;

    if (this.three) {
      this._initThreePoints();
    }
  }

  /**
   * Creates Three.js Points mesh with Float32Array buffer attributes
   * @private
   */
  _initThreePoints() {
    if (!this.three) return;
    const THREE = this.three;

    const geometry = new THREE.BufferGeometry();
    this.positionsArray = new Float32Array(this.maxParticles * 3);
    this.colorsArray = new Float32Array(this.maxParticles * 3);
    this.sizesArray = new Float32Array(this.maxParticles);

    geometry.setAttribute('position', new THREE.BufferAttribute(this.positionsArray, 3));
    geometry.setAttribute('color', new THREE.BufferAttribute(this.colorsArray, 3));
    geometry.setAttribute('size', new THREE.BufferAttribute(this.sizesArray, 1));

    // Custom or default PointsMaterial
    const material = new THREE.PointsMaterial({
      size: 0.04,
      vertexColors: true,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    this.pointsMesh = new THREE.Points(geometry, material);
    this.pointsMesh.frustumCulled = false;
  }

  /**
   * Returns Three.js Points mesh for adding to scene
   * @returns {Object|null}
   */
  getMesh() {
    return this.pointsMesh;
  }

  /**
   * Returns currently active particle count
   * @returns {number}
   */
  getActiveCount() {
    let count = 0;
    for (let i = 0; i < this.maxParticles; i++) {
      if (this.particles[i].active) count++;
    }
    return count;
  }

  /**
   * Returns list of currently active particle records
   * @returns {Array<Object>}
   */
  getActiveParticles() {
    return this.particles.filter(p => p.active);
  }

  /**
   * Emits a burst of particles at (x, y, z)
   *
   * @param {Object} config
   * @param {number} config.x
   * @param {number} config.y
   * @param {number} config.z
   * @param {string} [config.judgement='PERFECT']
   * @param {number} [config.color]
   * @param {number} [config.count=30]
   * @param {number} [config.speed=1.5]
   * @param {number} [config.life=0.6]
   * @returns {number} Number of particles successfully emitted
   */
  emitBurst(config = {}) {
    const x = config.x ?? 0.0;
    const y = config.y ?? 0.0;
    const z = config.z ?? 0.0;
    const count = config.count ?? 30;
    const colorHex = config.color ?? getVFXColor(config.judgement || 'PERFECT');
    const baseSpeed = config.speed ?? 1.5;
    const baseLife = config.life ?? 0.6;

    // Convert hex to normalized RGB
    const r = ((colorHex >> 16) & 0xff) / 255;
    const g = ((colorHex >> 8) & 0xff) / 255;
    const b = (colorHex & 0xff) / 255;

    let emitted = 0;
    for (let i = 0; i < this.maxParticles && emitted < count; i++) {
      const p = this.particles[i];
      if (p.active) continue;

      p.active = true;
      p.x = x;
      p.y = y;
      p.z = z;
      p.color = colorHex;
      p.r = r;
      p.g = g;
      p.b = b;

      // Random 3D spherical direction with upward bias
      const theta = Math.random() * Math.PI * 2;
      const phi = (Math.random() - 0.2) * Math.PI; // slight bias upward
      const speed = baseSpeed * (0.5 + Math.random() * 0.8);

      p.vx = Math.cos(theta) * Math.cos(phi) * speed;
      p.vy = Math.abs(Math.sin(phi) * speed) + 0.3; // upward push
      p.vz = Math.sin(theta) * Math.cos(phi) * speed;

      p.maxLife = baseLife * (0.7 + Math.random() * 0.6);
      p.life = p.maxLife;
      p.size = 0.035 * (0.8 + Math.random() * 0.5);

      emitted++;
    }

    return emitted;
  }

  /**
   * Updates particle positions and velocities over delta time dt
   *
   * @param {number} dt - Delta time in seconds
   */
  update(dt = 0.016) {
    if (dt <= 0) return;

    const gravity = -1.8; // gentle downward gravity
    const drag = 0.95;    // air drag factor

    let hasThreeMesh = Boolean(this.pointsMesh && this.positionsArray);

    for (let i = 0; i < this.maxParticles; i++) {
      const p = this.particles[i];
      if (!p.active) {
        if (hasThreeMesh) {
          // Hide inactive particle offscreen
          this.positionsArray[i * 3 + 0] = 0;
          this.positionsArray[i * 3 + 1] = -999;
          this.positionsArray[i * 3 + 2] = 0;
          this.sizesArray[i] = 0;
        }
        continue;
      }

      p.life -= dt;
      if (p.life <= 0) {
        p.active = false;
        if (hasThreeMesh) {
          this.positionsArray[i * 3 + 1] = -999;
          this.sizesArray[i] = 0;
        }
        continue;
      }

      // Physics integration
      p.vy += gravity * dt;
      p.vx *= Math.pow(drag, dt * 60);
      p.vy *= Math.pow(drag, dt * 60);
      p.vz *= Math.pow(drag, dt * 60);

      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;

      if (hasThreeMesh) {
        const lifeRatio = p.life / p.maxLife;
        this.positionsArray[i * 3 + 0] = p.x;
        this.positionsArray[i * 3 + 1] = p.y;
        this.positionsArray[i * 3 + 2] = p.z;

        this.colorsArray[i * 3 + 0] = p.r * lifeRatio;
        this.colorsArray[i * 3 + 1] = p.g * lifeRatio;
        this.colorsArray[i * 3 + 2] = p.b * lifeRatio;

        this.sizesArray[i] = p.size * lifeRatio;
      }
    }

    if (hasThreeMesh) {
      this.pointsMesh.geometry.attributes.position.needsUpdate = true;
      this.pointsMesh.geometry.attributes.color.needsUpdate = true;
      this.pointsMesh.geometry.attributes.size.needsUpdate = true;
    }
  }

  /**
   * Resets all particles to inactive
   */
  reset() {
    for (let i = 0; i < this.maxParticles; i++) {
      this.particles[i].active = false;
    }
    if (this.pointsMesh && this.positionsArray) {
      for (let i = 0; i < this.maxParticles; i++) {
        this.positionsArray[i * 3 + 1] = -999;
        this.sizesArray[i] = 0;
      }
      this.pointsMesh.geometry.attributes.position.needsUpdate = true;
      this.pointsMesh.geometry.attributes.size.needsUpdate = true;
    }
  }
}

/**
 * WorldReaction — Dynamic ambient lighting, floor grid glow, and combo aura
 */
export class WorldReaction {
  constructor() {
    this.combo = 0;
    this.currentTier = COMBO_TIERS[0];
    this.timeAccumulator = 0;
  }

  /**
   * Updates combo counter and transitions tier
   * @param {number} combo
   */
  setCombo(combo) {
    this.combo = combo;
    this.currentTier = getComboTier(combo);
  }

  /**
   * Returns rhythmic pulse factor in [0..1] based on current tier
   * @param {number} timeSec
   * @returns {number}
   */
  getPulseFactor(timeSec = 0) {
    const speed = this.currentTier.pulseSpeed;
    const wave = 0.5 + 0.5 * Math.sin(timeSec * Math.PI * 2 * speed);
    return wave * this.currentTier.glowIntensity;
  }

  /**
   * Applies world lighting and aura to Three.js scene elements
   *
   * @param {Object} elements
   * @param {Object} [elements.ambientLight]
   * @param {Object} [elements.borderMaterial]
   * @param {Object} [elements.gridMaterial]
   * @param {number} timeSec
   * @param {number} dt
   */
  applyToScene(elements = {}, timeSec = 0, dt = 0.016) {
    this.timeAccumulator += dt;
    const pulse = this.getPulseFactor(timeSec || this.timeAccumulator);

    if (elements.ambientLight) {
      elements.ambientLight.intensity = 0.4 + pulse * 0.4;
    }

    if (elements.borderMaterial && elements.borderMaterial.color) {
      // Glow brighter at higher combo tiers
      const baseColor = VFX_COLORS.NEON_BORDER;
      const boost = Math.min(1.0, this.currentTier.tier * 0.25 + pulse * 0.2);
      if (elements.borderMaterial.emissiveIntensity !== undefined) {
        elements.borderMaterial.emissiveIntensity = 0.5 + boost;
      }
    }

    if (elements.gridMaterial) {
      elements.gridMaterial.opacity = 0.15 + pulse * 0.15;
    }
  }
}

/**
 * Generates descriptor object for 3D cuboid tile mesh
 *
 * @param {Object} options
 * @param {string} options.note
 * @param {number} options.lane
 * @param {number} [options.laneWidth=0.2]
 * @param {boolean} [options.isChord=false]
 * @param {number} [options.durationSec=0.3]
 * @returns {Object}
 */
export function createTileDescriptor(options = {}) {
  const laneWidth = options.laneWidth ?? 0.2;
  const isChord = Boolean(options.isChord);
  const durationSec = options.durationSec ?? 0.3;

  // Cuboid dimensions: slightly narrower than lane for visual separation
  const width = Math.max(0.04, laneWidth * 0.90);
  const height = 0.035; // 3.5cm thickness
  const depth = Math.max(0.12, Math.min(1.2, durationSec * 0.5)); // depth scales with duration

  const primaryColor = isChord ? VFX_COLORS.CHORD : VFX_COLORS.GOOD;
  const emissiveColor = isChord ? VFX_COLORS.CHORD : 0x1e3a8a;

  return {
    isChord,
    dimensions: { width, height, depth },
    material: {
      color: primaryColor,
      emissive: emissiveColor,
      emissiveIntensity: isChord ? 1.2 : 0.6,
      glowIntensity: isChord ? 1.2 : 0.6,
      roughness: 0.2,
      metalness: 0.8,
      transparent: true,
      opacity: 0.92
    }
  };
}

/**
 * Creates 3D cuboid tile mesh (Three.js or Node-safe mock)
 *
 * @param {Object} tileData
 * @param {Object} [THREE=null]
 * @returns {Object}
 */
export function createTileMesh(tileData = {}, THREE = null) {
  const threeLib = THREE || (typeof window !== 'undefined' && window.THREE) || null;
  const desc = createTileDescriptor(tileData);

  if (!threeLib) {
    // Return headless mock mesh for Node/test environments
    return {
      position: { x: 0, y: 0, z: 0, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      scale: { x: 1, y: 1, z: 1, set(x, y, z) { this.x = x; this.y = y; this.z = z; } },
      visible: true,
      descriptor: desc,
      material: { ...desc.material }
    };
  }

  const { width, height, depth } = desc.dimensions;
  const geometry = new threeLib.BoxGeometry(width, height, depth);

  const material = new threeLib.MeshStandardMaterial({
    color: desc.material.color,
    emissive: desc.material.emissive,
    emissiveIntensity: desc.material.emissiveIntensity,
    roughness: desc.material.roughness,
    metalness: desc.material.metalness,
    transparent: desc.material.transparent,
    opacity: desc.material.opacity
  });

  const mesh = new threeLib.Mesh(geometry, material);
  mesh.castShadow = true;
  mesh.receiveShadow = false;

  // Add front face laser glow edge if chord
  if (desc.isChord) {
    const edgeGeo = new threeLib.EdgesGeometry(geometry);
    const edgeMat = new threeLib.LineBasicMaterial({
      color: VFX_COLORS.PERFECT,
      linewidth: 2
    });
    const wireframe = new threeLib.LineSegments(edgeGeo, edgeMat);
    mesh.add(wireframe);
  }

  // Dynamic ground shadow plane underneath the tile
  const shadowGeo = new threeLib.PlaneGeometry(width * 0.95, depth * 0.95);
  shadowGeo.rotateX(-Math.PI / 2);
  const shadowMat = new threeLib.MeshBasicMaterial({
    color: 0x000000,
    transparent: true,
    opacity: 0.35,
    depthWrite: false
  });
  const shadowMesh = new threeLib.Mesh(shadowGeo, shadowMat);
  shadowMesh.position.y = -0.019; // Flat right on the floor grid
  mesh.add(shadowMesh);
  mesh.userData = {
    shadowMesh,
    baseEmissive: desc.material.emissiveIntensity,
    isChord: desc.isChord
  };

  return mesh;
}

/**
 * TilePool — Zero-allocation object pool for falling cuboid tiles
 */
export class TilePool {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.capacity=64]
   * @param {Object} [options.three]
   * @param {number} [options.laneWidth=0.2]
   */
  constructor(options = {}) {
    this.capacity = options.capacity ?? 64;
    this.three = options.three || null;
    this.laneWidth = options.laneWidth ?? 0.2;

    this.pool = new Array(this.capacity);
    for (let i = 0; i < this.capacity; i++) {
      this.pool[i] = {
        id: `tile_${i}`,
        active: false,
        noteData: null,
        mesh: createTileMesh({ laneWidth: this.laneWidth }, this.three),
        lane: 0,
        timeSec: 0,
        z: 0,
        played: false,
        missed: false
      };
      if (this.pool[i].mesh) {
        this.pool[i].mesh.visible = false;
      }
    }
  }

  getCapacity() {
    return this.capacity;
  }

  getActiveCount() {
    let count = 0;
    for (let i = 0; i < this.capacity; i++) {
      if (this.pool[i].active) count++;
    }
    return count;
  }

  getAvailableCount() {
    return this.capacity - this.getActiveCount();
  }

  getActiveTiles() {
    return this.pool.filter(t => t.active);
  }

  /**
   * Acquires an inactive tile and binds note data
   *
   * @param {Object} noteData
   * @returns {Object|null}
   */
  acquire(noteData = {}) {
    let candidate = null;
    for (let i = 0; i < this.capacity; i++) {
      if (!this.pool[i].active) {
        candidate = this.pool[i];
        break;
      }
    }

    if (!candidate) {
      // Pool full: steal oldest played or missed tile as fallback
      for (let i = 0; i < this.capacity; i++) {
        if (this.pool[i].played || this.pool[i].missed) {
          candidate = this.pool[i];
          break;
        }
      }
    }

    if (!candidate) return null;

    candidate.active = true;
    candidate.noteData = noteData;
    candidate.lane = noteData.lane ?? 0;
    candidate.timeSec = noteData.timeSec ?? 0;
    candidate.played = false;
    candidate.missed = false;

    if (candidate.mesh) {
      candidate.mesh.visible = true;
    }

    return candidate;
  }

  /**
   * Releases a tile back to the pool
   * @param {Object} tile
   */
  release(tile) {
    if (!tile) return;
    tile.active = false;
    tile.noteData = null;
    tile.played = false;
    tile.missed = false;
    if (tile.mesh) {
      tile.mesh.visible = false;
      tile.mesh.position.set?.(0, -999, 0);
    }
  }

  /**
   * Recycles active tiles that drifted past currentTimeSec + thresholdSec
   *
   * @param {number} currentTimeSec
   * @param {number} [thresholdSec=0.3]
   * @returns {Array<Object>} List of recycled tiles
   */
  recycleExpired(currentTimeSec, thresholdSec = 0.3) {
    const recycled = [];
    for (let i = 0; i < this.capacity; i++) {
      const tile = this.pool[i];
      if (tile.active && (currentTimeSec - tile.timeSec) > thresholdSec) {
        const noteData = tile.noteData;
        const recycledInfo = {
          id: tile.id,
          noteData,
          lane: tile.lane,
          timeSec: tile.timeSec,
          played: tile.played,
          missed: tile.missed
        };
        this.release(tile);
        recycled.push(recycledInfo);
      }
    }
    return recycled;
  }

  /**
   * Deactivates all tiles in pool
   */
  clear() {
    for (let i = 0; i < this.capacity; i++) {
      this.release(this.pool[i]);
    }
  }
}

export default {
  VFX_COLORS,
  getVFXColor,
  calculateArenaLayout,
  COMBO_TIERS,
  getComboTier,
  ParticleEngine,
  WorldReaction,
  createTileDescriptor,
  createTileMesh,
  TilePool
};
