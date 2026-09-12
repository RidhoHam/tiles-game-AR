/**
 * Three.js compatibility shim for MindAR 1.2.5.
 *
 * WHY THIS FILE EXISTS (do not delete without reading this):
 *
 *   mind-ar@1.2.5 ships `dist/mindar-image-three.prod.js`, which hard-imports
 *   the named symbol `sRGBEncoding` from the bare `"three"` specifier:
 *
 *     import { ... sRGBEncoding as Si ... } from "three";
 *     ...
 *     this.renderer.outputEncoding = Si;   // used exactly once
 *
 *   `sRGBEncoding` (and its sibling `LinearEncoding`) were DELETED from
 *   three.js in r152 as part of the color-management rework; this project uses
 *   three@0.180.0. Without a shim, that import is a hard module-resolution
 *   failure and MindAR never loads at all.
 *
 *   Upstream MindAR has not fixed this: PR hiukim/mind-ar-js#503 has been
 *   unmerged since 2024, so the bug is present in every 1.2.x release.
 *
 * WHAT THE ALIAS IN vite.config.js DOES:
 *
 *   The config aliases the bare specifier `three` to THIS file (anchored regex
 *   `/^three$/`, so `three/addons/...` keeps resolving normally). MindAR's
 *   `sRGBEncoding` import therefore lands here, and we re-export the modern
 *   equivalent instead of crashing.
 *
 * RULES FOR EDITING THIS FILE:
 *
 *   1. Re-export from the EXPLICIT path `three/src/Three.js`, never
 *      `export * from 'three'` -- the latter would resolve back through the
 *      alias to this same file and recurse forever.
 *   2. `three/src/Three.js` is verified to re-export the same 422 symbols as
 *      the `three` package entry point, so this is a faithful superset.
 *   3. Keep the legacy aliases below in sync with the modern constants.
 */

// Explicit path, NOT the `three` bare specifier: the alias maps `three` to this
// very file, so importing 'three' here would be infinite self-recursion.
export * from 'three/src/Three.js';

// Modern names, re-exported so the aliases below can reference real values and
// so consumers can import them from either module.
export { SRGBColorSpace, LinearSRGBColorSpace } from 'three/src/Three.js';

import { SRGBColorSpace, LinearSRGBColorSpace } from 'three/src/Three.js';

/**
 * Removed in three r152. MindAR 1.2.5 assigns this to `renderer.outputEncoding`;
 * the modern equivalent is the `SRGBColorSpace` string ("srgb").
 */
export const sRGBEncoding = SRGBColorSpace;

/**
 * Removed in three r152. MindAR 1.2.5 does not currently read this symbol, but
 * it is the exact sibling of the one it does read, so it is provided to keep a
 * future MindAR build (or a vendored copy) from failing the same way.
 */
export const LinearEncoding = LinearSRGBColorSpace;
