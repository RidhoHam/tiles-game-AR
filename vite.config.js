import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import basicSsl from '@vitejs/plugin-basic-ssl';

const useSsl = process.env.VITE_SSL === 'true';

export default defineConfig({
  plugins: useSsl ? [basicSsl()] : [],
  server: {
    host: true,
    allowedHosts: true
  },
  // MindAR 1.2.5 imports the `sRGBEncoding` symbol from "three", but that symbol
  // was removed from three.js in r152 (this project uses three@0.180.0). The
  // alias below routes the bare `three` specifier through a compatibility shim
  // that re-exports modern three plus the removed legacy names.
  resolve: {
    alias: [
      { find: /^three$/, replacement: fileURLToPath(new URL('./src/ar/three-compat.js', import.meta.url)) }
    ]
  }
});
