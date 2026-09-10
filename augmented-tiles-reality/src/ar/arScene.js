/**
 * ARScene — Three.js WebGL & WebXR Scene Manager for AR Piano Tiles
 *
 * Implements:
 * - Three.js WebGL & WebXR scene orchestration with 60 FPS render loop
 * - Holographic musical arena / portal mesh (neon lane lines, laser hit line, translucent grid floor)
 * - Dynamic 4-lane vs 8-lane arena switching with smooth layout transitions
 * - WebXR hit-test placement reticle for markerless surface detection (AR-01, AR-02)
 * - Universal Fallback: Camera video feed (getUserMedia) + ground plane raycasting for desktop & iOS Safari
 * - Glowing fingertip tracker spheres (Cyan for right hand, Magenta for left hand)
 * - Tile animation loop (falling cuboid tiles synced to song clock)
 * - Headless Node/SSR safe execution without DOM/WebGL crashes
 */

import {
  VFX_COLORS,
  getVFXColor,
  calculateArenaLayout,
  ParticleEngine,
  WorldReaction,
  TilePool,
  createTileMesh
} from './vfxSystem.js';

export const THREE_CDN = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js';

/**
 * Calculates tile falling speed in meters per second
 *
 * @param {number} spawnZ
 * @param {number} hitPlaneZ
 * @param {number} travelDurationSec
 * @returns {number}
 */
export function calculateTileSpeed(spawnZ = -2.0, hitPlaneZ = 0.0, travelDurationSec = 2.0) {
  const distance = Math.abs(hitPlaneZ - spawnZ);
  return travelDurationSec > 0 ? distance / travelDurationSec : 1.0;
}

/**
 * Calculates tile Z position at currentTimeSec given note target time
 *
 * @param {number} noteTimeSec
 * @param {number} currentTimeSec
 * @param {number} [hitPlaneZ=0.0]
 * @param {number} [speed=1.0]
 * @returns {number}
 */
export function calculateTileZPosition(noteTimeSec, currentTimeSec, hitPlaneZ = 0.0, speed = 1.0) {
  const deltaSec = noteTimeSec - currentTimeSec;
  return hitPlaneZ - (deltaSec * speed);
}

/**
 * Intersects a 3D ray with a horizontal ground plane (y = groundY)
 *
 * @param {{ x: number, y: number, z: number }} origin
 * @param {{ x: number, y: number, z: number }} direction
 * @param {number} [groundY=-0.3]
 * @returns {{ x: number, y: number, z: number } | null}
 */
export function raycastGroundPlane(origin, direction, groundY = -0.3) {
  if (!origin || !direction) return null;
  if (Math.abs(direction.y) < 1e-6) return null; // Parallel to ground

  const t = (groundY - origin.y) / direction.y;
  if (t < 0) return null; // Ray points away from ground plane

  return {
    x: origin.x + t * direction.x,
    y: groundY,
    z: origin.z + t * direction.z
  };
}

/**
 * ARScene manager
 */
export class ARScene {
  /**
   * @param {Object} [options={}]
   * @param {number} [options.laneCount=4]
   * @param {number} [options.arenaWidth=0.8]
   * @param {number} [options.arenaDepth=2.0]
   * @param {number} [options.hitPlaneZ=0.0]
   * @param {number} [options.travelDurationSec=2.0]
   * @param {Object} [options.three] - Preloaded Three.js library instance
   * @param {HTMLElement} [options.container] - DOM container element
   */
  constructor(options = {}) {
    this.laneCount = options.laneCount ?? 4;
    this.arenaWidth = options.arenaWidth ?? 0.8;
    this.arenaDepth = options.arenaDepth ?? 2.0;
    this.hitPlaneZ = options.hitPlaneZ ?? 0.0;
    this.travelDurationSec = options.travelDurationSec ?? 2.0;
    this.spawnZ = this.hitPlaneZ - this.arenaDepth;
    this.tileSpeed = calculateTileSpeed(this.spawnZ, this.hitPlaneZ, this.travelDurationSec);

    this.layout = calculateArenaLayout({
      laneCount: this.laneCount,
      arenaWidth: this.arenaWidth,
      arenaDepth: this.arenaDepth,
      hitPlaneZ: this.hitPlaneZ,
      spawnZ: this.spawnZ
    });

    this.three = options.three || (typeof window !== 'undefined' && window.THREE) || null;
    this.container = options.container || null;

    // Subsystems
    this.vfx = new ParticleEngine({ three: this.three });
    this.worldReaction = new WorldReaction();
    this.tilePool = new TilePool({
      capacity: 64,
      three: this.three,
      laneWidth: this.layout.laneWidth
    });

    // Tracking state
    this.isPlaced = false;
    this.mode = 'uninitialized'; // 'webxr' | 'fallback' | 'uninitialized'
    this.viewMode = options.viewMode || 'tiles'; // 'tiles' | 'roll'
    this.arenaTransform = {
      position: { x: 0, y: -0.3, z: -1.2 },
      rotation: { x: 0, y: 0, z: 0 }
    };

    // Three.js instances (if in browser)
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.arenaRoot = null;
    this.reticle = null;
    this.laneGroup = null;
    this.hitLineMesh = null;
    this.floorGridMesh = null;
    this.fingertipPointers = null;
    this.leftFingertipMesh = null;
    this.rightFingertipMesh = null;

    // WebXR Hit-test resources
    this.xrSession = null;
    this.xrRefSpace = null;
    this.xrHitTestSource = null;

    // Universal Fallback resources
    this.cameraStream = null;
    this.videoElement = null;

    if (this.three && typeof window !== 'undefined') {
      this._initThreeScene();
    }
  }

  /**
   * Initializes Three.js WebGL scene and lighting
   * @private
   */
  _initThreeScene() {
    const THREE = this.three;
    this.scene = new THREE.Scene();

    const width = this.container?.clientWidth || window.innerWidth;
    const height = this.container?.clientHeight || window.innerHeight;

    this.camera = new THREE.PerspectiveCamera(70, width / height, 0.01, 20);
    this.scene.add(this.camera);

    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance'
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.xr.enabled = true;

    if (this.container) {
      this.container.appendChild(this.renderer.domElement);
    }

    // Lighting
    this.ambientLight = new THREE.AmbientLight(0xffffff, 0.5);
    this.scene.add(this.ambientLight);

    this.dirLight = new THREE.DirectionalLight(0xffffff, 0.8);
    this.dirLight.position.set(0, 3, 2);
    this.scene.add(this.dirLight);

    this.hitPointLight = new THREE.PointLight(VFX_COLORS.HIT_LINE, 1.2, 3);
    this.hitPointLight.position.set(0, 0.1, this.hitPlaneZ);
    this.scene.add(this.hitPointLight);

    // Root group for the entire interactive arena
    this.arenaRoot = new THREE.Group();
    this.arenaRoot.position.set(
      this.arenaTransform.position.x,
      this.arenaTransform.position.y,
      this.arenaTransform.position.z
    );
    this.scene.add(this.arenaRoot);

    // Add particle engine mesh to arenaRoot
    const particlesMesh = this.vfx.getMesh();
    if (particlesMesh) {
      this.arenaRoot.add(particlesMesh);
    }

    this._buildArenaGeometry();
    this._buildReticle();
    this._buildTableGuide();
    this._buildFingertipMeshes();
  }

  /**
   * Builds holographic arena geometry: floor grid, outer rails, lane dividers, hit laser bar
   * @private
   */
  _buildArenaGeometry() {
    if (!this.three || !this.arenaRoot) return;
    const THREE = this.three;

    // 1. Translucent holographic grid floor with glowing glass underlay
    const floorGeo = new THREE.PlaneGeometry(this.arenaWidth * 1.1, this.arenaDepth * 1.05);
    this.floorMaterial = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.65
    });
    this.floorGridMesh = new THREE.Mesh(floorGeo, this.floorMaterial);
    this.floorGridMesh.rotation.x = -Math.PI / 2;
    this.floorGridMesh.position.set(0, -0.01, this.hitPlaneZ - this.arenaDepth / 2);
    this.arenaRoot.add(this.floorGridMesh);

    // Glowing translucent glass backing so it stands out brightly on wooden desks
    const glassGeo = new THREE.PlaneGeometry(this.arenaWidth * 1.08, this.arenaDepth * 1.02);
    const glassMat = new THREE.MeshBasicMaterial({
      color: 0x0369a1,
      transparent: true,
      opacity: 0.22,
      side: THREE.DoubleSide
    });
    this.glassFloorMesh = new THREE.Mesh(glassGeo, glassMat);
    this.glassFloorMesh.rotation.x = -Math.PI / 2;
    this.glassFloorMesh.position.set(0, -0.015, this.hitPlaneZ - this.arenaDepth / 2);
    this.arenaRoot.add(this.glassFloorMesh);

    // 2. Lane group (contains dividers & borders)
    this.laneGroup = new THREE.Group();
    this.arenaRoot.add(this.laneGroup);
    this._rebuildLaneLines();

    // 3. Hit Plane Laser Line
    const laserGeo = new THREE.BoxGeometry(this.arenaWidth * 1.04, 0.008, 0.015);
    this.laserMaterial = new THREE.MeshBasicMaterial({
      color: VFX_COLORS.HIT_LINE,
      transparent: true,
      opacity: 0.95
    });
    this.hitLineMesh = new THREE.Mesh(laserGeo, this.laserMaterial);
    this.hitLineMesh.position.set(0, 0.005, this.hitPlaneZ);
    this.arenaRoot.add(this.hitLineMesh);

    // 4. Portal Arch at spawn origin
    const archGeo = new THREE.BoxGeometry(this.arenaWidth * 1.08, 0.015, 0.02);
    const archMat = new THREE.MeshBasicMaterial({
      color: VFX_COLORS.NEON_BORDER,
      transparent: true,
      opacity: 0.8
    });
    const archMesh = new THREE.Mesh(archGeo, archMat);
    archMesh.position.set(0, 0.01, this.spawnZ);
    this.arenaRoot.add(archMesh);

    // 5. 3D Piano Keys, Shockwaves, Chord Bridges, & Spatial Combo
    this._buildPianoKeys();
    this._buildShockwavePool();
    this._buildChordBridges();
    this._buildSpatialComboDisplay();
  }

  /**
   * Rebuilds lane lines and borders dynamically
   * @private
   */
  _rebuildLaneLines() {
    if (!this.three || !this.laneGroup) return;
    const THREE = this.three;

    // Clear existing divider meshes
    while (this.laneGroup.children.length > 0) {
      const child = this.laneGroup.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }

    const { dividers } = this.layout;

    for (let i = 0; i < dividers.length; i++) {
      const x = dividers[i];
      const isOuterEdge = (i === 0 || i === dividers.length - 1);

      // Thicker line for outer neon rails, subtle line for inner dividers
      const width = isOuterEdge ? 0.008 : 0.003;
      const height = 0.004;
      const length = this.arenaDepth;

      const geo = new THREE.BoxGeometry(width, height, length);
      const mat = new THREE.MeshBasicMaterial({
        color: isOuterEdge ? VFX_COLORS.NEON_BORDER : 0x475569,
        transparent: true,
        opacity: isOuterEdge ? 0.9 : 0.4
      });

      const rail = new THREE.Mesh(geo, mat);
      rail.position.set(x, 0.002, this.hitPlaneZ - this.arenaDepth / 2);
      this.laneGroup.add(rail);
    }

    // Rebuild 3D Piano Keys
    this._buildPianoKeys();
  }

  /**
   * Sets AR game view mode: 'tiles' (rhythm lanes) or 'roll' (real piano keyboard)
   * @param {string} mode
   */
  setViewMode(mode = 'tiles') {
    this.viewMode = mode === 'roll' ? 'roll' : 'tiles';
    if (this.laneGroup) {
      this.laneGroup.visible = (this.viewMode !== 'roll');
    }
    this._buildPianoKeys();
  }

  /**
   * Builds physical 3D Piano Key blocks with spring physics
   * Supports Mode 1 (Tiles lanes) and Mode 2 (Real Piano with white and black keys)
   * @private
   */
  _buildPianoKeys() {
    if (!this.three || !this.arenaRoot) return;
    const THREE = this.three;

    if (!this.keyGroup) {
      this.keyGroup = new THREE.Group();
      this.arenaRoot.add(this.keyGroup);
    }
    while (this.keyGroup.children.length > 0) {
      const child = this.keyGroup.children.pop();
      if (child.geometry) child.geometry.dispose();
      if (child.material) child.material.dispose();
    }
    this.keyMeshes = [];
    this.rollKeyMap = new Map();

    if (this.viewMode === 'roll') {
      // Mode 2: Authentic Real Piano Keyboard with White and Black keys (C3=48 to G5=79)
      const startMidi = 48;
      const endMidi = 79;
      const isBlackMidi = (m) => [1, 3, 6, 8, 10].includes(m % 12);

      const whiteMidis = [];
      for (let m = startMidi; m <= endMidi; m++) {
        if (!isBlackMidi(m)) whiteMidis.push(m);
      }

      const totalWhite = whiteMidis.length;
      const whiteW = (this.arenaWidth * 0.96) / totalWhite;
      const startX = -((totalWhite - 1) * whiteW) / 2;
      const blackW = whiteW * 0.62;
      const whiteDepth = 0.14;
      const blackDepth = 0.088;

      // 1. Build White Keys
      whiteMidis.forEach((m, idx) => {
        const x = startX + idx * whiteW;
        const geo = new THREE.BoxGeometry(whiteW * 0.94, 0.014, whiteDepth);
        const mat = new THREE.MeshStandardMaterial({
          color: 0xf8fafc,
          emissive: 0x38bdf8,
          emissiveIntensity: 0.10,
          roughness: 0.2,
          metalness: 0.1
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.position.set(x, 0.007, this.hitPlaneZ);
        mesh.userData = {
          midi: m,
          isBlack: false,
          baseY: 0.007,
          depressedY: -0.008,
          velocity: 0,
          baseEmissive: 0.10,
          lane: idx
        };
        this.keyGroup.add(mesh);
        this.keyMeshes.push(mesh);
        this.rollKeyMap.set(m, mesh);
      });

      // 2. Build Black Keys (layered on top)
      for (let m = startMidi; m <= endMidi; m++) {
        if (isBlackMidi(m)) {
          const leftWhite = this.rollKeyMap.get(m - 1);
          const rightWhite = this.rollKeyMap.get(m + 1);
          if (leftWhite && rightWhite) {
            const x = (leftWhite.position.x + rightWhite.position.x) / 2;
            const geo = new THREE.BoxGeometry(blackW, 0.022, blackDepth);
            const mat = new THREE.MeshStandardMaterial({
              color: 0x0f172a,
              emissive: 0x818cf8,
              emissiveIntensity: 0.14,
              roughness: 0.35,
              metalness: 0.6
            });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(x, 0.016, this.hitPlaneZ - 0.024);
            mesh.userData = {
              midi: m,
              isBlack: true,
              baseY: 0.016,
              depressedY: 0.002,
              velocity: 0,
              baseEmissive: 0.14,
              lane: -1
            };
            this.keyGroup.add(mesh);
            this.keyMeshes.push(mesh);
            this.rollKeyMap.set(m, mesh);
          }
        }
      }
    } else {
      // Mode 1: Rhythm Tiles mode
      const keyWidth = this.layout.laneWidth * 0.92;
      const keyHeight = 0.012;
      const keyDepth = 0.12;

      for (let i = 0; i < this.laneCount; i++) {
        const x = this.layout.laneCenters[i];
        const keyGeo = new THREE.BoxGeometry(keyWidth, keyHeight, keyDepth);
        const isLeft = i < (this.laneCount / 2);
        const keyMat = new THREE.MeshStandardMaterial({
          color: isLeft ? 0x1e1b4b : 0x0c4a6e,
          emissive: isLeft ? VFX_COLORS.HAND_LEFT : VFX_COLORS.HAND_RIGHT,
          emissiveIntensity: 0.3,
          roughness: 0.25,
          metalness: 0.5,
          transparent: true,
          opacity: 0.92
        });
        const keyMesh = new THREE.Mesh(keyGeo, keyMat);
        keyMesh.position.set(x, 0.006, this.hitPlaneZ);
        keyMesh.userData = {
          lane: i,
          baseY: 0.006,
          depressedY: -0.010,
          velocity: 0,
          baseEmissive: 0.3
        };
        this.keyGroup.add(keyMesh);
        this.keyMeshes.push(keyMesh);
      }
    }
  }

  /**
   * Helper to fold MIDI numbers outside the roll keyboard range (48 to 79) into range
   * @param {number} midi
   * @returns {number}
   */
  _foldRollMidi(midi) {
    if (typeof midi !== 'number' || isNaN(midi)) return midi;
    let m = midi;
    while (m < 48) m += 12;
    while (m > 79) m -= 12;
    return m;
  }

  /**
   * Triggers a physical downward key depression animation on specified lane or MIDI pitch
   * @param {number} laneIndexOrMidi
   */
  triggerKeyDepress(laneIndexOrMidi) {
    let key = null;
    const targetMidi = (this.viewMode === 'roll' && typeof laneIndexOrMidi === 'number' && laneIndexOrMidi > 14)
      ? this._foldRollMidi(laneIndexOrMidi)
      : laneIndexOrMidi;
    if (this.viewMode === 'roll' && this.rollKeyMap && this.rollKeyMap.has(targetMidi)) {
      key = this.rollKeyMap.get(targetMidi);
    } else if (this.keyMeshes && this.keyMeshes[laneIndexOrMidi]) {
      key = this.keyMeshes[laneIndexOrMidi];
    }
    if (!key) return;
    key.position.y = key.userData.depressedY;
    key.userData.velocity = -0.05;
    key.material.emissiveIntensity = 1.8;
  }

  /**
   * Preallocates shockwave group for expanding hit rings
   * @private
   */
  _buildShockwavePool() {
    if (!this.three || !this.arenaRoot) return;
    const THREE = this.three;
    if (!this.shockwaveGroup) {
      this.shockwaveGroup = new THREE.Group();
      this.arenaRoot.add(this.shockwaveGroup);
    }
    this.shockwaves = [];
  }

  /**
   * Emits an expanding 3D circular shockwave on the table plane
   * @param {number} x
   * @param {number} z
   * @param {string|number} [color=VFX_COLORS.PERFECT]
   */
  triggerShockwave(x, z, color = VFX_COLORS.PERFECT) {
    if (!this.three || !this.shockwaveGroup) return;
    const THREE = this.three;
    const ringGeo = new THREE.RingGeometry(0.015, 0.03, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringColor = typeof color === 'number' ? color : (getVFXColor(color) || VFX_COLORS.PERFECT);
    const ringMat = new THREE.MeshBasicMaterial({
      color: ringColor,
      transparent: true,
      opacity: 0.95,
      side: THREE.DoubleSide
    });
    const mesh = new THREE.Mesh(ringGeo, ringMat);
    mesh.position.set(x, 0.003, z);
    mesh.userData = { age: 0, maxAge: 0.38 };
    this.shockwaveGroup.add(mesh);
    this.shockwaves.push(mesh);
  }

  /**
   * Preallocates connecting holographic energy bridges for chord notes
   * @private
   */
  _buildChordBridges() {
    if (!this.three || !this.arenaRoot) return;
    const THREE = this.three;
    if (!this.chordBridgeGroup) {
      this.chordBridgeGroup = new THREE.Group();
      this.arenaRoot.add(this.chordBridgeGroup);
    }
    this.chordBridges = [];
    for (let i = 0; i < 16; i++) {
      const geo = new THREE.CylinderGeometry(0.0035, 0.0035, 1, 8);
      geo.rotateZ(Math.PI / 2);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xf59e0b, // Gold/Amber energy color
        transparent: true,
        opacity: 0.85
      });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.visible = false;
      this.chordBridgeGroup.add(mesh);
      this.chordBridges.push(mesh);
    }
  }

  /**
   * Updates horizontal holographic chord bridges connecting active chord tiles
   * @private
   */
  _updateChordBridges(activeTiles = []) {
    if (!this.chordBridges) return;
    for (const b of this.chordBridges) b.visible = false;

    // Group active chord tiles by approximate timeSec (within 0.04s)
    const chordGroups = new Map();
    for (const tile of activeTiles) {
      if (tile.noteData?.type === 'chord' || tile.noteData?.notes) {
        const key = Math.round(tile.timeSec * 25);
        if (!chordGroups.has(key)) chordGroups.set(key, []);
        chordGroups.get(key).push(tile);
      }
    }

    let bIdx = 0;
    for (const tiles of chordGroups.values()) {
      if (tiles.length >= 2 && bIdx < this.chordBridges.length) {
        let minX = Infinity;
        let maxX = -Infinity;
        const z = tiles[0].mesh.position.z;
        for (const t of tiles) {
          const x = t.mesh.position.x;
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
        const bridge = this.chordBridges[bIdx++];
        const width = Math.max(0.04, maxX - minX);
        bridge.position.set((minX + maxX) / 2, 0.022, z);
        bridge.scale.set(width, 1, 1);
        bridge.visible = true;
      }
    }
  }

  /**
   * Builds spatial floating 3D combo & judgement display above the hit line
   * @private
   */
  _buildSpatialComboDisplay() {
    if (!this.three || !this.arenaRoot || typeof document === 'undefined') return;
    const THREE = this.three;

    this.comboCanvas = document.createElement('canvas');
    this.comboCanvas.width = 256;
    this.comboCanvas.height = 128;
    this.comboCtx = this.comboCanvas.getContext('2d');

    this.comboTexture = new THREE.CanvasTexture(this.comboCanvas);
    const spriteMat = new THREE.SpriteMaterial({
      map: this.comboTexture,
      transparent: true,
      opacity: 0.95
    });
    this.comboSprite = new THREE.Sprite(spriteMat);
    this.comboSprite.position.set(0, 0.16, this.hitPlaneZ);
    this.comboSprite.scale.set(0.32, 0.16, 1.0);
    this.comboSprite.visible = false;
    this.arenaRoot.add(this.comboSprite);
    this.comboTimer = 0;
  }

  /**
   * Updates diegetic 3D floating combo and judgement in arena space
   * @param {number} combo
   * @param {string} [judgement='']
   */
  setSpatialCombo(combo = 0, judgement = '') {
    if (!this.comboCtx || !this.comboTexture) return;
    const ctx = this.comboCtx;
    ctx.clearRect(0, 0, 256, 128);

    if (combo > 1 || judgement) {
      if (this.comboSprite) this.comboSprite.visible = true;

      // Draw Judgement
      if (judgement) {
        ctx.font = 'bold 36px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = judgement === 'PERFECT' ? '#facc15' : (judgement === 'GOOD' ? '#38bdf8' : '#f43f5e');
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = 12;
        ctx.fillText(judgement, 128, 45);
      }

      // Draw Combo
      if (combo > 1) {
        ctx.font = '900 48px Outfit, sans-serif';
        ctx.textAlign = 'center';
        ctx.fillStyle = '#ffffff';
        ctx.shadowColor = '#6366f1';
        ctx.shadowBlur = 16;
        ctx.fillText(`${combo}`, 128, 95);

        ctx.font = '600 18px Outfit, sans-serif';
        ctx.fillStyle = '#a5b4fc';
        ctx.shadowBlur = 0;
        ctx.fillText('COMBO', 128, 118);
      }

      this.comboTexture.needsUpdate = true;
      this.comboTimer = 1.2;
    } else if (this.comboSprite) {
      this.comboSprite.visible = false;
    }
  }

  /**
   * Builds WebXR surface placement reticle
   * @private
   */
  _buildReticle() {
    if (!this.three || !this.scene) return;
    const THREE = this.three;

    this.reticle = new THREE.Group();
    this.reticle.visible = false;
    this.reticle.matrixAutoUpdate = false;

    // Circular glowing ring
    const ringGeo = new THREE.RingGeometry(0.12, 0.15, 32);
    ringGeo.rotateX(-Math.PI / 2);
    const ringMat = new THREE.MeshBasicMaterial({
      color: VFX_COLORS.GOOD,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    const ringMesh = new THREE.Mesh(ringGeo, ringMat);
    this.reticle.add(ringMesh);

    // Crosshair ticks
    const tickGeo = new THREE.BoxGeometry(0.01, 0.002, 0.06);
    const tickMat = new THREE.MeshBasicMaterial({ color: VFX_COLORS.PERFECT });
    const tickN = new THREE.Mesh(tickGeo, tickMat);
    tickN.position.set(0, 0.001, -0.16);
    const tickS = new THREE.Mesh(tickGeo, tickMat);
    tickS.position.set(0, 0.001, 0.16);
    this.reticle.add(tickN);
    this.reticle.add(tickS);

    this.scene.add(this.reticle);
  }

  /**
   * Builds desktop/table holographic guide frame and reticle for non-WebXR fallback
   * @private
   */
  _buildTableGuide() {
    if (!this.three || !this.scene) return;
    const THREE = this.three;

    this.tableGuide = new THREE.Group();
    this.tableGuide.visible = true;

    // Glowing rectangular holographic desk frame
    const frameGeo = new THREE.PlaneGeometry(this.arenaWidth * 1.05, this.arenaDepth * 0.95);
    const frameMat = new THREE.MeshBasicMaterial({
      color: 0x38bdf8,
      wireframe: true,
      transparent: true,
      opacity: 0.45
    });
    this.tableGuideMesh = new THREE.Mesh(frameGeo, frameMat);
    this.tableGuideMesh.rotation.x = -Math.PI / 2 + 0.32; // Desk tilt
    this.tableGuideMesh.position.set(0, -0.28, -1.05);
    this.tableGuide.add(this.tableGuideMesh);

    // Glowing target ring
    const ringGeo = new THREE.RingGeometry(0.12, 0.16, 32);
    ringGeo.rotateX(-Math.PI / 2 + 0.32);
    const ringMat = new THREE.MeshBasicMaterial({
      color: 0xfacc15,
      transparent: true,
      opacity: 0.85,
      side: THREE.DoubleSide
    });
    this.tableGuideRing = new THREE.Mesh(ringGeo, ringMat);
    this.tableGuideRing.position.set(0, -0.27, -1.05);
    this.tableGuide.add(this.tableGuideRing);

    this.scene.add(this.tableGuide);
  }

  /**
   * Updates arena width and position dynamically from 2-hand pinch/stretch gesture
   *
   * @param {Object} span - Result from calculateTwoHandSpan
   */
  updatePinchPlacement(span) {
    if (!span || !this.arenaRoot) return;
    const newWidth = Math.max(0.4, Math.min(1.5, span.width));
    this.arenaWidth = newWidth;
    this.arenaTransform.position.x = span.centerX;
    if (typeof span.centerY === 'number') {
      this.arenaTransform.position.y = Math.max(-0.5, Math.min(-0.15, span.centerY));
    }

    this.arenaRoot.position.set(
      this.arenaTransform.position.x,
      this.arenaTransform.position.y,
      this.arenaTransform.position.z
    );
    this.arenaRoot.rotation.x = 0.32;
    this.setLaneCount(this.laneCount);

    if (this.tableGuideMesh) {
      this.tableGuideMesh.scale.x = newWidth / 0.8;
      this.tableGuideMesh.position.x = span.centerX;
    }
    if (this.tableGuideRing) {
      this.tableGuideRing.position.x = span.centerX;
    }
  }

  /**
   * Builds holographic fingertip tracker rings for all 10 fingers (5 Left + 5 Right)
   * Thumbs feature Amber/Gold energy rings designed for triggering Chord Slam [Space]
   * @private
   */
  _buildFingertipMeshes() {
    if (!this.three || !this.arenaRoot) return;
    const THREE = this.three;

    const createPointer = (color, isThumb = false) => {
      const group = new THREE.Group();
      group.visible = false;

      // 1. Horizontal glowing Torus energy ring around finger
      const ringRadius = isThumb ? 0.026 : 0.020;
      const ringTube = isThumb ? 0.004 : 0.0028;
      const ringGeo = new THREE.TorusGeometry(ringRadius, ringTube, 16, 32);
      ringGeo.rotateX(Math.PI / 2);
      const ringMat = new THREE.MeshBasicMaterial({
        color: isThumb ? 0xf59e0b : color, // Golden amber for thumb slam
        transparent: true,
        opacity: isThumb ? 0.98 : 0.88
      });
      const ring = new THREE.Mesh(ringGeo, ringMat);
      group.add(ring);

      // 2. Bright core point
      const beadGeo = new THREE.SphereGeometry(isThumb ? 0.009 : 0.006, 16, 16);
      const beadMat = new THREE.MeshBasicMaterial({ color: isThumb ? 0xfef08a : 0xffffff });
      const bead = new THREE.Mesh(beadGeo, beadMat);
      group.add(bead);

      // Thumb special outer pulse ring
      if (isThumb) {
        const haloGeo = new THREE.RingGeometry(0.030, 0.036, 24);
        haloGeo.rotateX(-Math.PI / 2);
        const haloMat = new THREE.MeshBasicMaterial({
          color: 0xf59e0b,
          transparent: true,
          opacity: 0.6,
          side: THREE.DoubleSide
        });
        const halo = new THREE.Mesh(haloGeo, haloMat);
        group.add(halo);
      }

      // 3. Vertical depth laser guide beam to table floor (y = 0)
      const laserGeo = new THREE.CylinderGeometry(0.0015, 0.0015, 1, 8);
      laserGeo.translate(0, -0.5, 0); // Origin at top (finger position)
      const laserMat = new THREE.MeshBasicMaterial({
        color: isThumb ? 0xf59e0b : color,
        transparent: true,
        opacity: 0.55
      });
      const laser = new THREE.Mesh(laserGeo, laserMat);
      group.add(laser);

      // 4. Ground landing reticle on table surface (y = 0)
      const groundRingGeo = new THREE.RingGeometry(isThumb ? 0.018 : 0.014, isThumb ? 0.028 : 0.022, 24);
      groundRingGeo.rotateX(-Math.PI / 2);
      const groundRingMat = new THREE.MeshBasicMaterial({
        color: isThumb ? 0xf59e0b : color,
        transparent: true,
        opacity: 0.75,
        side: THREE.DoubleSide
      });
      const groundRing = new THREE.Mesh(groundRingGeo, groundRingMat);
      group.add(groundRing);

      group.userData = { ring, bead, laser, groundRing, isThumb };
      this.arenaRoot.add(group);
      return group;
    };

    this.fingertipPointers = {
      Left: {
        thumb: createPointer(VFX_COLORS.HAND_LEFT, true),
        index: createPointer(VFX_COLORS.HAND_LEFT, false),
        middle: createPointer(VFX_COLORS.HAND_LEFT, false),
        ring: createPointer(VFX_COLORS.HAND_LEFT, false),
        pinky: createPointer(VFX_COLORS.HAND_LEFT, false)
      },
      Right: {
        thumb: createPointer(VFX_COLORS.HAND_RIGHT, true),
        index: createPointer(VFX_COLORS.HAND_RIGHT, false),
        middle: createPointer(VFX_COLORS.HAND_RIGHT, false),
        ring: createPointer(VFX_COLORS.HAND_RIGHT, false),
        pinky: createPointer(VFX_COLORS.HAND_RIGHT, false)
      }
    };

    // Backward compatibility for existing code and tests
    this.leftFingertipMesh = this.fingertipPointers.Left.index;
    this.rightFingertipMesh = this.fingertipPointers.Right.index;
  }

  /**
   * Dynamically switches lane configuration (supporting any custom lane count)
   *
   * @param {number} laneCount - 3 to 16+ lanes
   */
  setLaneCount(laneCount = 4) {
    this.laneCount = laneCount;
    this.layout = calculateArenaLayout({
      laneCount: this.laneCount,
      arenaWidth: this.arenaWidth,
      arenaDepth: this.arenaDepth,
      hitPlaneZ: this.hitPlaneZ,
      spawnZ: this.spawnZ
    });

    if (this.tilePool) {
      this.tilePool.laneWidth = this.layout.laneWidth;
    }

    this._rebuildLaneLines();
    this._buildPianoKeys();
  }

  /**
   * Sets up WebXR Session and Hit-test source for markerless AR placement
   *
   * @param {XRSession} session
   * @returns {Promise<void>}
   */
  async setupWebXRSession(session) {
    if (!session || !this.renderer) return;
    this.xrSession = session;
    this.mode = 'webxr';

    await this.renderer.xr.setSession(session);

    // Request reference spaces
    this.xrRefSpace = await session.requestReferenceSpace('local-floor').catch(() => {
      return session.requestReferenceSpace('local');
    });

    const viewerSpace = await session.requestReferenceSpace('viewer');
    this.xrHitTestSource = await session.requestHitTestSource({ space: viewerSpace });
  }

  /**
   * Fallback initialization using camera stream (getUserMedia) and ground raycasting
   *
   * @param {HTMLElement} [container]
   * @returns {Promise<boolean>}
   */
  async initFallbackCamera(container = this.container) {
    this.mode = 'fallback';
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      this.placeArena({ x: 0.0, y: -0.28, z: -1.05 });
      return false;
    }

    try {
      this.cameraStream = await navigator.mediaDevices.getUserMedia({
        video: {
          width: { ideal: 960, max: 1280 },
          height: { ideal: 540, max: 720 },
          frameRate: { ideal: 30, max: 60 }
        },
        audio: false
      });

      if (typeof document !== 'undefined') {
        let video = document.getElementById('ar-fallback-video');
        if (!video) {
          video = document.createElement('video');
          video.id = 'ar-fallback-video';
          video.setAttribute('playsinline', '');
          video.setAttribute('autoplay', '');
          video.setAttribute('muted', '');
          video.style.position = 'fixed';
          video.style.top = '0';
          video.style.left = '0';
          video.style.width = '100vw';
          video.style.height = '100vh';
          video.style.objectFit = 'cover';
          video.style.zIndex = '0';
          video.style.pointerEvents = 'none';
          video.style.transform = 'scaleX(-1)';
          (container || document.body).prepend(video);
        }
        video.srcObject = this.cameraStream;
        await video.play().catch(() => {});
        this.videoElement = video;
      }

      // Position arena preview on desk with comfortable desk tilt, awaiting user anchor/pinch
      this.placeArena({ x: 0.0, y: -0.28, z: -1.05 }, null, false);
      if (this.arenaRoot) {
        this.arenaRoot.rotation.x = 0.32;
      }
      if (this.tableGuide) {
        this.tableGuide.visible = true;
      }
      return true;
    } catch (err) {
      console.warn('[ARScene] Fallback camera getUserMedia failed, using default virtual position:', err.message);
      this.placeArena({ x: 0.0, y: -0.28, z: -1.05 });
      return false;
    }
  }

  /**
   * Places arena at specified 3D coordinates
   *
   * @param {{ x: number, y: number, z: number }} position
   * @param {{ x: number, y: number, z: number, w: number }} [quaternion]
   * @param {boolean} [markPlaced=true]
   */
  placeArena(position = { x: 0, y: -0.28, z: -1.05 }, quaternion = null, markPlaced = true) {
    this.arenaTransform.position.x = position.x ?? 0;
    this.arenaTransform.position.y = position.y ?? -0.28;
    this.arenaTransform.position.z = position.z ?? -1.05;

    if (this.arenaRoot) {
      this.arenaRoot.position.set(
        this.arenaTransform.position.x,
        this.arenaTransform.position.y,
        this.arenaTransform.position.z
      );

      if (quaternion) {
        this.arenaRoot.quaternion.set(quaternion.x, quaternion.y, quaternion.z, quaternion.w);
      } else if (this.mode === 'fallback') {
        this.arenaRoot.rotation.x = 0.32;
      }
    }

    this.isPlaced = Boolean(markPlaced);
    if (this.isPlaced) {
      if (this.reticle) this.reticle.visible = false;
      if (this.tableGuide) this.tableGuide.visible = false;
    }
  }

  /**
   * Confirms placement of arena at current reticle or table guide pose
   */
  confirmPlacement() {
    if (this.reticle && this.reticle.visible) {
      this.arenaTransform.position.x = this.reticle.position.x;
      this.arenaTransform.position.y = this.reticle.position.y;
      this.arenaTransform.position.z = this.reticle.position.z;

      if (this.arenaRoot) {
        this.arenaRoot.position.copy(this.reticle.position);
        this.arenaRoot.quaternion.copy(this.reticle.quaternion);
      }
    }

    this.isPlaced = true;
    if (this.reticle) this.reticle.visible = false;
    if (this.tableGuide) this.tableGuide.visible = false;
  }

  /**
   * Updates glowing fingertip indicator rings, depth laser guides, and landing rings for all 10 fingers
   *
   * @param {Array<Object>} hands - Array of HandState objects
   */
  updateFingertips(hands = []) {
    const fingerKeys = ['thumb', 'index', 'middle', 'ring', 'pinky'];
    const tipProps = ['thumbTip', 'indexTip', 'middleTip', 'ringTip', 'pinkyTip'];
    const activeHands = { Left: false, Right: false };

    if (this.fingertipPointers && Array.isArray(hands)) {
      for (const hand of hands) {
        if (!hand) continue;
        const handedness = hand.handedness === 'Left' ? 'Left' : 'Right';
        activeHands[handedness] = true;
        const handPointers = this.fingertipPointers[handedness];
        if (!handPointers) continue;

        for (let i = 0; i < fingerKeys.length; i++) {
          const key = fingerKeys[i];
          const pointer = handPointers[key];
          const pt = hand[tipProps[i]];

          if (pointer && pt) {
            pointer.position.set(pt.x, pt.y, pt.z);
            pointer.visible = true;

            const heightAboveFloor = Math.max(0.005, pt.y);
            const { laser, groundRing } = pointer.userData || {};
            if (laser) {
              laser.scale.set(1, heightAboveFloor, 1);
            }
            if (groundRing) {
              groundRing.position.set(0, -pt.y + 0.002, 0);
            }
          } else if (pointer) {
            pointer.visible = false;
          }
        }
      }
    }

    // Hide pointers for hands not detected
    if (this.fingertipPointers) {
      for (const handedness of ['Left', 'Right']) {
        if (!activeHands[handedness] && this.fingertipPointers[handedness]) {
          for (const key of fingerKeys) {
            if (this.fingertipPointers[handedness][key]) {
              this.fingertipPointers[handedness][key].visible = false;
            }
          }
        }
      }
    }

    // Fallback sync for leftFingertipMesh / rightFingertipMesh references
    if (this.leftFingertipMesh && !activeHands.Left) this.leftFingertipMesh.visible = false;
    if (this.rightFingertipMesh && !activeHands.Right) this.rightFingertipMesh.visible = false;
  }

  /**
   * Spawns incoming note tiles from song chart (supporting Tiles mode & Real Piano mode)
   *
   * @param {Array<Object>} notes
   * @param {number} currentTimeSec
   */
  spawnNotes(notes = [], currentTimeSec = 0) {
    if (!Array.isArray(notes)) return;

    for (const note of notes) {
      if (note.spawned || note.played || note.missed) continue;

      const timeUntilHit = note.timeSec - currentTimeSec;
      if (timeUntilHit <= this.travelDurationSec && timeUntilHit >= -0.1) {
        note.spawned = true;
        const tile = this.tilePool.acquire(note);
        if (tile && tile.mesh && this.arenaRoot) {
          let posX = 0;
          const targetMidi = (this.viewMode === 'roll' && typeof note.midi === 'number')
            ? this._foldRollMidi(note.midi)
            : note.midi;
          if (this.viewMode === 'roll' && this.rollKeyMap && targetMidi && this.rollKeyMap.has(targetMidi)) {
            posX = this.rollKeyMap.get(targetMidi).position.x;
          } else {
            posX = this.layout.laneCenters[tile.lane] ?? 0;
          }
          tile.mesh.position.set(posX, 0.02, this.spawnZ);
          this.arenaRoot.add(tile.mesh);
        }
      }
    }
  }

  /**
   * Triggers explosion particle burst, 3D key depression, and expanding shockwave at hit position
   *
   * @param {number} laneIndexOrMidi
   * @param {string} judgement
   */
  triggerHitVFX(laneIndexOrMidi, judgement = 'PERFECT') {
    let posX = 0;
    const targetMidi = (this.viewMode === 'roll' && typeof laneIndexOrMidi === 'number' && laneIndexOrMidi > 14)
      ? this._foldRollMidi(laneIndexOrMidi)
      : laneIndexOrMidi;
    if (this.viewMode === 'roll' && this.rollKeyMap && this.rollKeyMap.has(targetMidi)) {
      posX = this.rollKeyMap.get(targetMidi).position.x;
    } else {
      posX = this.layout.laneCenters[laneIndexOrMidi] ?? 0;
    }

    this.vfx.emitBurst({
      x: posX,
      y: 0.02,
      z: this.hitPlaneZ,
      judgement,
      count: judgement === 'PERFECT' ? 40 : 20
    });

    // 3D Key depression spring animation & shockwave ring
    this.triggerKeyDepress(laneIndexOrMidi);
    this.triggerShockwave(posX, this.hitPlaneZ, judgement);

    if (this.hitPointLight) {
      this.hitPointLight.position.x = posX;
      this.hitPointLight.intensity = judgement === 'PERFECT' ? 2.5 : 1.5;
    }
  }

  /**
   * Main per-frame update loop
   *
   * @param {number} currentTimeSec
   * @param {number} dt
   * @param {XRFrame} [xrFrame]
   */
  update(currentTimeSec = 0, dt = 0.016, xrFrame = null) {
    // 1. Process WebXR hit-test if in WebXR placement mode
    if (this.mode === 'webxr' && !this.isPlaced && xrFrame && this.xrHitTestSource && this.xrRefSpace) {
      const hitResults = xrFrame.getHitTestResults(this.xrHitTestSource);
      if (hitResults.length > 0 && this.reticle) {
        const hit = hitResults[0];
        const pose = hit.getPose(this.xrRefSpace);
        if (pose) {
          this.reticle.visible = true;
          this.reticle.matrix.fromArray(pose.transform.matrix);
          this.reticle.matrix.decompose(
            this.reticle.position,
            this.reticle.quaternion,
            this.reticle.scale
          );
        }
      } else if (this.reticle) {
        this.reticle.visible = false;
      }
    }

    // 2. Update falling active tiles with multi-layer depth cues (shadow & glow)
    const activeTiles = this.tilePool.getActiveTiles();
    for (const tile of activeTiles) {
      if (!tile.mesh) continue;

      const z = calculateTileZPosition(
        tile.timeSec,
        currentTimeSec,
        this.hitPlaneZ,
        this.tileSpeed
      );

      tile.mesh.position.z = z;
      tile.z = z;

      // Closeness depth cues: sharpen ground shadow and increase emissive glow approaching hit line
      const dist = Math.abs(z - this.hitPlaneZ);
      const closeness = Math.max(0, 1.0 - (dist / (this.arenaDepth * 0.75)));
      if (tile.mesh.userData) {
        if (tile.mesh.userData.shadowMesh) {
          tile.mesh.userData.shadowMesh.material.opacity = 0.15 + closeness * 0.55;
        }
        if (tile.mesh.material && tile.mesh.userData.baseEmissive !== undefined) {
          tile.mesh.material.emissiveIntensity = tile.mesh.userData.baseEmissive + closeness * 0.9;
        }
      }
    }

    // 2b. Update chord energy bridges across lanes
    this._updateChordBridges(activeTiles);

    // 2c. Animate physical piano keys with spring physics
    if (this.keyMeshes) {
      for (const key of this.keyMeshes) {
        const ud = key.userData;
        const dy = ud.baseY - key.position.y;
        ud.velocity += dy * 35.0 * dt;
        ud.velocity *= Math.max(0, 1.0 - 15.0 * dt);
        key.position.y += ud.velocity;
        if (key.material.emissiveIntensity > ud.baseEmissive) {
          key.material.emissiveIntensity = Math.max(ud.baseEmissive, key.material.emissiveIntensity - dt * 3.5);
        }
      }
    }

    // 2d. Animate expanding shockwave rings on table surface
    if (this.shockwaves && this.shockwaves.length > 0) {
      for (let i = this.shockwaves.length - 1; i >= 0; i--) {
        const sw = this.shockwaves[i];
        sw.userData.age += dt;
        const progress = sw.userData.age / sw.userData.maxAge;
        if (progress >= 1.0) {
          this.shockwaveGroup.remove(sw);
          if (sw.geometry) sw.geometry.dispose();
          if (sw.material) sw.material.dispose();
          this.shockwaves.splice(i, 1);
        } else {
          const s = 1.0 + progress * 8.0;
          sw.scale.set(s, 1.0, s);
          sw.material.opacity = Math.max(0, 1.0 - progress);
        }
      }
    }

    // 2e. Animate spatial floating combo timer
    if (this.comboTimer > 0) {
      this.comboTimer -= dt;
      if (this.comboTimer <= 0 && this.comboSprite) {
        this.comboSprite.visible = false;
      }
    }

    // 3. Recycle expired tiles past hit plane
    this.tilePool.recycleExpired(currentTimeSec, 0.3);

    // 4. Update VFX particle physics
    this.vfx.update(dt);

    // 5. Update World Reaction pulse & lighting
    this.worldReaction.applyToScene(
      {
        ambientLight: this.ambientLight,
        borderMaterial: this.laserMaterial,
        gridMaterial: this.floorMaterial
      },
      currentTimeSec,
      dt
    );

    // Fade hit point light back to neutral
    if (this.hitPointLight && this.hitPointLight.intensity > 1.0) {
      this.hitPointLight.intensity = Math.max(1.0, this.hitPointLight.intensity - dt * 4.0);
    }
  }

  /**
   * Cleans up resources, video streams, and WebXR sessions
   */
  dispose() {
    if (this.cameraStream) {
      this.cameraStream.getTracks().forEach(track => track.stop());
      this.cameraStream = null;
    }

    if (this.videoElement && this.videoElement.parentNode) {
      this.videoElement.parentNode.removeChild(this.videoElement);
      this.videoElement = null;
    }

    if (this.renderer) {
      this.renderer.dispose();
    }
  }
}

export default ARScene;
