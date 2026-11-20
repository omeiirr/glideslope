import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Relative base so the build works under any GitHub Pages sub-path.
  base: './',
  plugins: [preact()],
  worker: { format: 'es' },
  // the same headers public/coi.js adds in production, for multi-threaded speech recognition in dev
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
