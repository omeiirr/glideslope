/// <reference lib="webworker" />
// Whisper speech recognition via transformers.js. Audio never leaves this worker.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { WHISPER } from './models';

export type AsrRequest =
  | { type: 'load'; vendor: string; model: keyof typeof WHISPER }
  | { type: 'transcribe'; id: number; audio: Float32Array; final: boolean };
export type AsrResponse =
  | { type: 'progress'; progress: number }
  | { type: 'ready'; model: keyof typeof WHISPER; ms: number }
  | { type: 'result'; id: number; text: string; final: boolean }
  | { type: 'error'; id?: number; message: string; fatal: boolean };

const post = (m: AsrResponse) => (self as DedicatedWorkerGlobalScope).postMessage(m);
let asr: AutomaticSpeechRecognitionPipeline | null = null;
let busy = false;

async function load(vendor: string, model: keyof typeof WHISPER) {
  env.allowLocalModels = false;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = {
      wasm: `${vendor}ort-wasm-simd-threaded.asyncify.wasm`,
      mjs: `${vendor}ort-wasm-simd-threaded.asyncify.mjs`,
    };
    wasm.numThreads = 1;
  }
  const spec = WHISPER[model];
  const files = new Map<string, [number, number]>();
  asr = (await pipeline('automatic-speech-recognition', spec.repo, {
    device: spec.device,
    dtype: spec.dtype,
    progress_callback: (p: { status: string; file?: string; loaded?: number; total?: number }) => {
      if (p.status !== 'progress' || !p.file || !p.total) return;
      files.set(p.file, [p.loaded ?? 0, p.total]);
      let loaded = 0;
      let total = 0;
      for (const [l, t] of files.values()) {
        loaded += l;
        total += t;
      }
      post({ type: 'progress', progress: total ? loaded / total : 0 });
    },
  } as Parameters<typeof pipeline>[2])) as AutomaticSpeechRecognitionPipeline;
  // Warm up so the first real transmission is fast (shader compilation on WebGPU).
  await asr(new Float32Array(16000));
  // Time a warm run: Whisper pads every clip to 30 s, so this is what each transcription costs here.
  const t0 = performance.now();
  await asr(new Float32Array(16000));
  return performance.now() - t0;
}

self.onmessage = async (e: MessageEvent<AsrRequest>) => {
  const msg = e.data;
  if (msg.type === 'load') {
    try {
      const ms = await load(msg.vendor, msg.model);
      post({ type: 'ready', model: msg.model, ms });
    } catch (err) {
      post({ type: 'error', message: String((err as Error)?.message ?? err), fatal: true });
    }
    return;
  }
  // Live partials are best-effort: skip them while a transcription is running.
  if (busy && !msg.final) return;
  while (busy) await new Promise((r) => setTimeout(r, 20));
  busy = true;
  try {
    const out = await asr!(msg.audio);
    const text = (Array.isArray(out) ? out[0]?.text : out.text) ?? '';
    post({ type: 'result', id: msg.id, text: text.trim(), final: msg.final });
  } catch (err) {
    post({ type: 'error', id: msg.id, message: String((err as Error)?.message ?? err), fatal: false });
  } finally {
    busy = false;
  }
};
