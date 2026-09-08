import { resolve } from 'path';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        main: resolve(import.meta.dirname, 'index.html'),
        ar: resolve(import.meta.dirname, 'ar.html'),
      },
    },
  },
  server: {
    port: 5173,
    open: false,
  },
});
