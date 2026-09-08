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

    // 1. Translucent holographic grid floor
    const floorGeo = new THREE.PlaneGeometry(this.arenaWidth * 1.1, this.arenaDepth * 1.05);
    this.floorMaterial = new THREE.MeshBasicMaterial({
      color: VFX_COLORS.GRID_FLOOR,
      wireframe: true,
      transparent: true,
      opacity: 0.25
    });
    this.floorGridMesh = new THREE.Mesh(floorGeo, this.floorMaterial);
    this.floorGridMesh.rotation.x = -Math.PI / 2;
    this.floorGridMesh.position.set(0, -0.01, this.hitPlaneZ - this.arenaDepth / 2);
    this.arenaRoot.add(this.floorGridMesh);

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
   * Builds glowing fingertip tracker sphere meshes
   * @private
   */
  _buildFingertipMeshes() {
    if (!this.three || !this.arenaRoot) return;
    const THREE = this.three;

    const sphereGeo = new THREE.SphereGeometry(0.016, 16, 16);

    // Left hand fingertip: Magenta
    const leftMat = new THREE.MeshBasicMaterial({
      color: VFX_COLORS.HAND_LEFT,
      transparent: true,
      opacity: 0.85
    });
    this.leftFingertipMesh = new THREE.Mesh(sphereGeo, leftMat);
    this.leftFingertipMesh.visible = false;
    this.arenaRoot.add(this.leftFingertipMesh);

    // Right hand fingertip: Cyan
    const rightMat = new THREE.MeshBasicMaterial({
      color: VFX_COLORS.HAND_RIGHT,
      transparent: true,
      opacity: 0.85
    });
    this.rightFingertipMesh = new THREE.Mesh(sphereGeo, rightMat);
    this.rightFingertipMesh.visible = false;
    this.arenaRoot.add(this.rightFingertipMesh);
  }

  /**
   * Dynamically switches between 4-lane (one hand) and 8-lane (two hand) modes
   *
   * @param {number} laneCount - 4 or 8
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
   * Updates glowing fingertip indicator spheres from HandTracker states
   *
   * @param {Array<Object>} hands - Array of HandState objects
   */
  updateFingertips(hands = []) {
    let hasLeft = false;
    let hasRight = false;

    if (Array.isArray(hands)) {
      for (const hand of hands) {
        if (!hand || !hand.indexTip) continue;

        if (hand.handedness === 'Left' && this.leftFingertipMesh) {
          this.leftFingertipMesh.position.set(hand.indexTip.x, hand.indexTip.y, hand.indexTip.z);
          this.leftFingertipMesh.visible = true;
          hasLeft = true;
        } else if (hand.handedness === 'Right' && this.rightFingertipMesh) {
          this.rightFingertipMesh.position.set(hand.indexTip.x, hand.indexTip.y, hand.indexTip.z);
          this.rightFingertipMesh.visible = true;
          hasRight = true;
        }
      }
    }

    if (!hasLeft && this.leftFingertipMesh) {
      this.leftFingertipMesh.visible = false;
    }
    if (!hasRight && this.rightFingertipMesh) {
      this.rightFingertipMesh.visible = false;
    }
  }

  /**
   * Spawns incoming note tiles from song chart
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
          const laneCenterX = this.layout.laneCenters[tile.lane] ?? 0;
          tile.mesh.position.set(laneCenterX, 0.02, this.spawnZ);
          this.arenaRoot.add(tile.mesh);
        }
      }
    }
  }

  /**
   * Triggers explosion particle burst at hit position
   *
   * @param {number} laneIndex
   * @param {string} judgement
   */
  triggerHitVFX(laneIndex, judgement = 'PERFECT') {
    const laneCenterX = this.layout.laneCenters[laneIndex] ?? 0;
    this.vfx.emitBurst({
      x: laneCenterX,
      y: 0.02,
      z: this.hitPlaneZ,
      judgement,
      count: judgement === 'PERFECT' ? 40 : 20
    });

    if (this.hitPointLight) {
      this.hitPointLight.position.x = laneCenterX;
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

    // 2. Update falling active tiles
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
