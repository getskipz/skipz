/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, unlinkSync } from 'node:fs';

// The speech runtime brings WebAssembly builds that are never loaded (the worker points at the plain one in public/ort): they are left out of the build.
const dropUnusedOrt = {
  name: 'skipz-drop-unused-ort',
  closeBundle() {
    const assets = resolve(import.meta.dirname, 'dist', 'assets');
    for (const f of readdirSync(assets)) if (/^ort-wasm-simd-threaded\.(asyncify|jsep|jspi)-.*\.wasm$/.test(f)) unlinkSync(resolve(assets, f));
  },
};

// "@detector" is the detector (the code that reads a video's label, description, chapters and captions), kept in src/detector.
export default defineConfig({
  resolve: { alias: { '@detector': resolve(import.meta.dirname, 'src/detector') } },
  define: { __INDEX_URL__: JSON.stringify(''), __BENCH__: JSON.stringify(false) },
  plugins: [dropUnusedOrt],
  worker: { format: 'es' },
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'chrome120', modulePreload: { polyfill: false },
    rollupOptions: {
      input: { popup: resolve(import.meta.dirname, 'popup.html'), ears: resolve(import.meta.dirname, 'ears.html'), content: resolve(import.meta.dirname, 'src/content.ts'), background: resolve(import.meta.dirname, 'src/background.ts') },
      output: { entryFileNames: (c) => (c.name === 'background' ? 'background.js' : c.name === 'content' ? 'content.js' : 'assets/[name]-[hash].js') },
    },
  },
  test: { include: ['src/**/*.test.ts'], testTimeout: 30000 },
});
