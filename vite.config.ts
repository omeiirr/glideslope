import { defineConfig } from 'vitest/config';
import preact from '@preact/preset-vite';

export default defineConfig({
  // Relative base so the build works under any GitHub Pages sub-path.
  base: './',
  plugins: [preact()],
  worker: { format: 'es' },
  // Libraries only the voice workers import: found late, Vite re-optimises and reloads the page in dev,
  // which threw the player back to the menu on the first game after a restart.
  optimizeDeps: {
    include: [
      '@diffusionstudio/piper-wasm/build/piper_phonemize.js',
      'onnxruntime-web/webgpu',
      '@huggingface/transformers',
    ],
  },
  // the same headers public/coi.js adds in production, for multi-threaded speech recognition in dev
  server: {
    headers: {
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'credentialless',
    },
  },
  test: { include: ['tests/**/*.test.ts'], environment: 'node' },
});
