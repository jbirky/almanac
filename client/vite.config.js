import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // sqlite-wasm loads its .wasm file relative to its own module; pre-bundling breaks that.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: { target: 'es2022' },
  server: {
    port: 5173,
    proxy: { '/api': 'http://localhost:8787' },
  },
});
