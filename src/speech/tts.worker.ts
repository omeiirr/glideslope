/// <reference lib="webworker" />
// Piper (VITS) text-to-speech: espeak-ng phonemizer (WASM) + ONNX Runtime Web.
import createPiperPhonemize from '@diffusionstudio/piper-wasm/build/piper_phonemize.js';
import * as ort from 'onnxruntime-web/webgpu';

export type TtsRequest =
  | { type: 'load'; vendor: string; model: string }
  | { type: 'synth'; id: number; text: string; speaker: number; speed: number };
export type TtsResponse =
  | { type: 'progress'; progress: number }
  | { type: 'ready' }
  | { type: 'audio'; id: number; pcm: Float32Array; sampleRate: number }
  | { type: 'error'; id?: number; message: string };

interface PiperConfig {
  audio: { sample_rate: number };
  espeak: { voice: string };
  inference: { noise_scale: number; length_scale: number; noise_w: number };
  num_speakers: number;
}

let session: ort.InferenceSession;
let config: PiperConfig;
let phonemizeWasm: ArrayBuffer;
let phonemizeData: ArrayBuffer;
const post = (m: TtsResponse, transfer: Transferable[] = []) =>
  (self as DedicatedWorkerGlobalScope).postMessage(m, transfer);

/** Fetch through the Cache API so the model is downloaded once. */
async function cached(url: string, onProgress?: (p: number) => void): Promise<ArrayBuffer> {
  const cache = await caches.open('vectors-models').catch(() => null);
  const hit = await cache?.match(url);
  if (hit) return hit.arrayBuffer();
  const res = await fetch(url);
  if (!res.ok || !res.body) throw new Error(`Download failed (${res.status}): ${url}`);
  const total = +(res.headers.get('content-length') ?? 0);
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    if (total) onProgress?.(loaded / total);
  }
  const buf = new Uint8Array(loaded);
  let o = 0;
  for (const c of chunks) {
    buf.set(c, o);
    o += c.length;
  }
  await cache
    ?.put(url, new Response(buf, { headers: { 'content-type': 'application/octet-stream' } }))
    .catch(() => {});
  return buf.buffer;
}

async function load(vendor: string, model: string) {
  ort.env.wasm.wasmPaths = {
    wasm: `${vendor}ort-wasm-simd-threaded.asyncify.wasm`,
    mjs: `${vendor}ort-wasm-simd-threaded.asyncify.mjs`,
  };
  // No cross-origin isolation on GitHub Pages, so no threads.
  ort.env.wasm.numThreads = 1;
  const [cfg, wasm, data, onnx] = await Promise.all([
    cached(`${model}.json`),
    fetch(`${vendor}piper_phonemize.wasm`).then((r) => r.arrayBuffer()),
    fetch(`${vendor}piper_phonemize.data`).then((r) => r.arrayBuffer()),
    cached(model, (p) => post({ type: 'progress', progress: p })),
  ]);
  config = JSON.parse(new TextDecoder().decode(cfg)) as PiperConfig;
  phonemizeWasm = wasm;
  phonemizeData = data;
  session = await ort.InferenceSession.create(onnx, { executionProviders: ['wasm'] });
}

/** Text → Piper phoneme ids, by running the phonemizer's CLI main() once. */
function phonemize(text: string): Promise<number[]> {
  return new Promise((resolve, reject) => {
    createPiperPhonemize({
      print: (line) => {
        try {
          resolve((JSON.parse(line) as { phoneme_ids: number[] }).phoneme_ids);
        } catch {
          /* not the JSON line */
        }
      },
      printErr: () => {},
      wasmBinary: phonemizeWasm,
      getPreloadedPackage: () => phonemizeData,
    })
      .then((m) =>
        m.callMain([
          '-l',
          config.espeak.voice,
          '--input',
          JSON.stringify([{ text }]),
          '--espeak_data',
          '/espeak-ng-data',
        ]),
      )
      .catch(reject);
  });
}

async function synth(text: string, speaker: number, speed: number): Promise<Float32Array> {
  // espeak says "kwi-BECK"; ICAO Annex 10 is "keh-BECK". "Tower" is phonemized right (taʊə), but the voice model
  // squeezes it into "tour" (Whisper heard "tour" in 6 of 8 pilot voices); "Tahwer" was heard as "tower" in 8 of 8.
  const ids = await phonemize(text.replace(/\bQuebec\b/gi, 'Kebeck').replace(/\bTower\b/gi, 'Tahwer'));
  const feeds: Record<string, ort.Tensor> = {
    input: new ort.Tensor('int64', BigInt64Array.from(ids.map(BigInt)), [1, ids.length]),
    input_lengths: new ort.Tensor('int64', BigInt64Array.from([BigInt(ids.length)])),
    scales: new ort.Tensor(
      'float32',
      Float32Array.from([config.inference.noise_scale, speed, config.inference.noise_w]),
    ),
  };
  if (config.num_speakers > 1) feeds.sid = new ort.Tensor('int64', BigInt64Array.from([BigInt(speaker)]));
  const out = await session.run(feeds);
  const pcm = out.output!.data as Float32Array;
  // Piper output peaks around 0.15–0.3 and varies by speaker: normalise so every pilot is equally loud.
  let peak = 0;
  for (const v of pcm) peak = Math.max(peak, Math.abs(v));
  if (peak > 0.01) {
    const gain = 0.9 / peak;
    for (let i = 0; i < pcm.length; i++) pcm[i]! *= gain;
  }
  return pcm;
}

// One request at a time, in order.
let chain: Promise<unknown> = Promise.resolve();
self.onmessage = (e: MessageEvent<TtsRequest>) => {
  const msg = e.data;
  chain = chain.then(async () => {
    try {
      if (msg.type === 'load') {
        await load(msg.vendor, msg.model);
        post({ type: 'ready' });
      } else {
        const pcm = await synth(msg.text, msg.speaker, msg.speed);
        post({ type: 'audio', id: msg.id, pcm, sampleRate: config.audio.sample_rate }, [pcm.buffer]);
      }
    } catch (err) {
      post({
        type: 'error',
        id: msg.type === 'synth' ? msg.id : undefined,
        message: String((err as Error)?.message ?? err),
      });
    }
  });
};
