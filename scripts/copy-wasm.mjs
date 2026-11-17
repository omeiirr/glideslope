// Copies the WASM runtimes we self-host into public/vendor/ (git-ignored), so the app never loads code from a CDN.
import { copyFileSync, mkdirSync } from 'node:fs';

const out = 'public/vendor';
mkdirSync(out, { recursive: true });
const files = [
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.wasm',
  'node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.asyncify.mjs',
  'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.wasm',
  'node_modules/@diffusionstudio/piper-wasm/build/piper_phonemize.data',
];
for (const f of files) copyFileSync(f, `${out}/${f.split('/').pop()}`);
// espeak-ng inside the phonemizer is GPL-3.0: its licence and source links travel with it
for (const f of ['licenses/GPL-3.0.txt', 'licenses/piper_phonemize.NOTICE.txt'])
  copyFileSync(f, `${out}/${f.split('/').pop()}`);
console.log(`copied ${files.length} runtime files and their licence notes to ${out}/`);
