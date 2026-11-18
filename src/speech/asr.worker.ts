/// <reference lib="webworker" />
// Speech recognition (Whisper or Moonshine) via transformers.js. Audio never leaves this worker.
import { env, pipeline, type AutomaticSpeechRecognitionPipeline } from '@huggingface/transformers';
import { ASR_MODELS, type AsrModel } from './models';
import { isPromptEcho } from './prompt';

export type AsrRequest =
  | { type: 'load'; vendor: string; model: AsrModel }
  | { type: 'transcribe'; id: number; audio: Float32Array; final: boolean; prompt: string };
export type AsrResponse =
  | { type: 'progress'; progress: number }
  | { type: 'ready'; model: AsrModel; ms: number }
  | { type: 'result'; id: number; text: string; final: boolean }
  | { type: 'error'; id?: number; message: string; fatal: boolean };

const post = (m: AsrResponse) => (self as DedicatedWorkerGlobalScope).postMessage(m);
let asr: AutomaticSpeechRecognitionPipeline | null = null;
let busy = false;
let current: AsrModel = 'tiny';

async function load(vendor: string, model: AsrModel) {
  env.allowLocalModels = false;
  const wasm = env.backends.onnx.wasm;
  if (wasm) {
    wasm.wasmPaths = {
      wasm: `${vendor}ort-wasm-simd-threaded.asyncify.wasm`,
      mjs: `${vendor}ort-wasm-simd-threaded.asyncify.mjs`,
    };
    wasm.numThreads = 1;
  }
  const spec = ASR_MODELS[model];
  current = model;
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

/**
 * Transcribe with a prompt: Whisper reads it as the text said before (<|startofprev|> … ) and expects its words.
 * The pipeline has no prompt option, so call the model directly and cut the prompt off the output.
 */
async function transcribe(audio: Float32Array, prompt: string): Promise<string> {
  const p = asr!;
  // Moonshine has no prompt; cap its output (it can repeat itself) at about 6.5 tokens per second of audio
  if (current === 'moonshine') {
    const out = await p(audio, { max_new_tokens: Math.ceil((audio.length / 16000) * 6.5) + 10 });
    return (Array.isArray(out) ? out[0]?.text : out.text) ?? '';
  }
  if (!prompt) {
    const out = await p(audio);
    return (Array.isArray(out) ? out[0]?.text : out.text) ?? '';
  }
  const tok = (t: string) => p.tokenizer.encode(t, { add_special_tokens: false });
  const prefix = [
    ...tok('<|startofprev|>'),
    ...tok(' ' + prompt),
    ...tok('<|startoftranscript|>'),
    ...tok('<|notimestamps|>'),
  ];
  const { input_features } = await p.processor(audio);
  const ids = (await p.model.generate({
    inputs: input_features,
    decoder_input_ids: prefix,
    max_new_tokens: 96,
  })) as { tolist(): number[][] };
  const text = p.tokenizer.decode(ids.tolist()[0]!.slice(prefix.length), { skip_special_tokens: true });
  return isPromptEcho(text, prompt) ? '' : text;
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
    const text = await transcribe(msg.audio, msg.prompt);
    post({ type: 'result', id: msg.id, text: text.trim(), final: msg.final });
  } catch (err) {
    post({ type: 'error', id: msg.id, message: String((err as Error)?.message ?? err), fatal: false });
  } finally {
    busy = false;
  }
};
