import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// MindAR 1.2.5 imports the `sRGBEncoding` symbol from "three", but that symbol
// was removed from three.js in r152 (this project uses three@0.180.0). The
// alias below routes the bare `three` specifier through a compatibility shim
// that re-exports modern three plus the removed legacy names.
//
// CRITICAL: `find` MUST be the ANCHORED regex /^three$/ and NOT the plain
// string 'three'. Vite's string aliases do a prefix match, so a string alias
// would also swallow the subpath import `three/addons/renderers/CSS3DRenderer.js`
// (used by MindAR and resolved via the three "exports" map), breaking it.
// The anchored regex matches only the exact `three` specifier.
//
// fileURLToPath is used instead of URL.pathname so the Windows drive letter is
// not left as a leading "/D:/..." path.
export default defineConfig({
  resolve: {
    alias: [
      { find: /^three$/, replacement: fileURLToPath(new URL('./src/ar/three-compat.js', import.meta.url)) }
    ]
  }
});
