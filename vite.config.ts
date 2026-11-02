/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';
import { readdirSync, unlinkSync, readFileSync } from 'node:fs';

// The speech runtime brings WebAssembly builds that are never loaded (the worker points at the plain one in public/ort): they are left out of the build.
const dropUnusedOrt = {
  name: 'skipz-drop-unused-ort',
  closeBundle() {
    const assets = resolve(import.meta.dirname, 'dist', 'assets');
    for (const f of readdirSync(assets)) if (/^ort-wasm-simd-threaded\.(asyncify|jsep|jspi)-.*\.wasm$/.test(f)) unlinkSync(resolve(assets, f));
  },
};

// The page script (content.js) and the Capture script (capture.js) are put into the page as plain scripts: they cannot import anything. If the build ever splits shared code out of them, Skipz silently does nothing on every
// YouTube page. So the build FAILS here instead of producing a dead extension.
const selfContained = {
  name: 'skipz-self-contained',
  closeBundle() {
    for (const f of ['content.js', 'capture.js']) {
      let src;
      try { src = readFileSync(resolve(import.meta.dirname, 'dist', f), 'utf8'); } catch { continue; }
      if (/^\s*(import|export)\s*[{*"'\w]/m.test(src) || /\bimport\.meta\b/.test(src)) throw new Error('dist/' + f + ' imports another file, which Chrome cannot load in a page script.');
    }
  },
};

// "@detector" is the detector (the code that reads a video's label, description, chapters and captions), kept in src/detector.
export default defineConfig({
  resolve: { alias: { '@detector': resolve(import.meta.dirname, 'src/detector') } },
  define: { __INDEX_URL__: JSON.stringify(''), __BENCH__: JSON.stringify(false), __SAVE__: JSON.stringify(process.env.SKIPZ_SAVE === '1') },
  plugins: [dropUnusedOrt, selfContained],
  worker: { format: 'es' },
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'chrome120', modulePreload: { polyfill: false },
    rollupOptions: {
      input: { popup: resolve(import.meta.dirname, 'popup.html'), ears: resolve(import.meta.dirname, 'ears.html'), content: resolve(import.meta.dirname, 'src/content.ts'), capture: resolve(import.meta.dirname, 'src/capture.ts'), background: resolve(import.meta.dirname, 'src/background.ts') },
      output: { entryFileNames: (c) => (c.name === 'background' ? 'background.js' : c.name === 'content' ? 'content.js' : c.name === 'capture' ? 'capture.js' : 'assets/[name]-[hash].js') },
    },
  },
  test: { include: ['src/**/*.test.ts'], testTimeout: 30000 },
});
