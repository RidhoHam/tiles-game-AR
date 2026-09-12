import * as THREE from 'three';
import { SandStructureSystem } from './sand-structures.js';

// Re-exported so callers (bootstrap / the controller, both Task 8) can build the
// arena and the placement guide without importing the scene internals directly.
// They are deliberately NOT instantiated here: the caller owns their lifecycle.
export { ArenaMesh, guideLineX, sceneBoundsFromArena } from './arena-mesh.js';
export { GuideLines } from './guide-lines.js';
export { PlacementGuideOverlay } from './placement-guide-overlay.js';

export function createSceneSystem(canvas, options = {}) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
  renderer.setSize(innerWidth, innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.xr.enabled = true;

  const scene = new THREE.Scene();
  // Transparent background: with alpha: true on the renderer, leaving
  // scene.background unset is what lets the <video> webcam feed show through
  // behind the 3D objects. The old opaque 0x68bed1 colour would cover it.
  scene.background = null;
  // Fog is intentionally omitted: a colour fog mixes the scene towards an opaque
  // colour, which would wash out the camera feed and re-introduce the very
  // opacity problem we removed with the background.

  const camera = new THREE.PerspectiveCamera(42, innerWidth / innerHeight, 0.08, 140);
  camera.position.set(16, 18, 22);
  camera.lookAt(0, 1, 0);

  scene.add(new THREE.HemisphereLight(0xbcebf1, 0x8d673d, 1.65));
  const sun = new THREE.DirectionalLight(0xffedca, 2.1);
  sun.position.set(14, 22, 11);
  sun.castShadow = true;
  scene.add(sun);

  const root = new THREE.Group();
  scene.add(root);

  const systems = new SandStructureSystem(root, {
    particleCapacity: options.particleCapacity ?? 450,
    grainCapacity: options.grainCapacity ?? 40000
  });

  return { renderer, scene, camera, root, systems };
}
