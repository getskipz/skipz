/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import { resolve } from 'node:path';

// "@detector" is the detector (the code that reads a video's label, description, chapters and captions), kept in src/detector.
export default defineConfig({
  resolve: { alias: { '@detector': resolve(import.meta.dirname, 'src/detector') } },
  define: { __INDEX_URL__: JSON.stringify(''), __BENCH__: JSON.stringify(false) },
  build: {
    outDir: 'dist', emptyOutDir: true, target: 'chrome120', modulePreload: { polyfill: false },
    rollupOptions: {
      input: { popup: resolve(import.meta.dirname, 'popup.html'), content: resolve(import.meta.dirname, 'src/content.ts'), background: resolve(import.meta.dirname, 'src/background.ts') },
      output: { entryFileNames: (c) => (c.name === 'background' ? 'background.js' : c.name === 'content' ? 'content.js' : 'assets/[name]-[hash].js') },
    },
  },
  test: { include: ['src/**/*.test.ts'], testTimeout: 30000 },
});
