import type { Settings } from '../game/settings';
import type { AsrRequest, AsrResponse } from './asr.worker';
import { vendorBase } from './models';
import { VOICE_OFF, type VoiceState } from './voice';

const RATE = 16000;
/** Whisper invents words for near-silent or very short audio, so those are dropped. */
const MIN_SECONDS = 0.35;
/** Live transcript only if one transcription takes less than this; partials run about once a second. */
const LIVE_MAX_MS = 500;

/** AudioWorklet that forwards microphone samples to the main thread. */
const CAPTURE = `registerProcessor('capture', class extends AudioWorkletProcessor {
  process(inputs) { const c = inputs[0][0]; if (c) this.port.postMessage(c.slice(0)); return true; }
});`;

interface SpeechRecognitionLike {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: { results: ArrayLike<ArrayLike<{ transcript: string }>> }) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
}

/** Push-to-talk voice input: microphone → Whisper in a worker (or the Web Speech API, opt-in). */
export class VoiceInput {
  state: VoiceState = VOICE_OFF;
  /** Words Whisper should expect (asrPrompt), set before each transmission. */
  prompt = '';
  onChange: () => void = () => {};
  private worker: Worker | null = null;
  private ctx: AudioContext | null = null;
  private chunks: Float32Array[] = [];
  private samples = 0;
  private recording = false;
  private partialTimer: ReturnType<typeof setInterval> | null = null;
  private nextId = 1;
  private finalId = 0;
  private resolveFinal: ((text: string) => void) | null = null;
  private web: SpeechRecognitionLike | null = null;
  private webText = '';
  private backend: 'whisper' | 'webspeech' | null = null;
  /** Live partials only when a transcription is fast: otherwise they queue up and delay the final transcript. */
  private livePartials = false;

  private set(patch: Partial<VoiceState>) {
    this.state = { ...this.state, ...patch };
    this.onChange();
  }

  /** Ask for the microphone and load the recogniser. Must be called from a user gesture. */
  async enable(settings: Settings) {
    if (this.state.status === 'loading' || this.state.status === 'ready') return;
    this.set({ status: 'loading', progress: 0, message: 'requesting microphone…', partial: '' });
    try {
      if (settings.asr === 'webspeech') {
        this.initWebSpeech();
        return;
      }
      await this.initMic();
      const gpu = settings.asr === 'whisper-base' && (await hasWebGpu());
      this.loadWhisper(gpu ? 'base' : 'tiny', settings.asr === 'whisper-base' && !gpu);
    } catch (err) {
      const name = (err as Error)?.name;
      this.set({
        status: 'error',
        message:
          name === 'NotAllowedError'
            ? 'Microphone permission denied. Typing still works.'
            : `Voice unavailable: ${(err as Error)?.message ?? err}`,
      });
    }
  }

  disable() {
    this.worker?.terminate();
    this.worker = null;
    void this.ctx?.close();
    this.ctx = null;
    this.web = null;
    this.backend = null;
    if (this.partialTimer) clearInterval(this.partialTimer);
    this.set({ ...VOICE_OFF });
  }

  private async initMic() {
    if (this.ctx) return;
    const stream = await navigator.mediaDevices.getUserMedia({
      audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
    });
    const ctx = new AudioContext({ sampleRate: RATE });
    await ctx.audioWorklet.addModule(URL.createObjectURL(new Blob([CAPTURE], { type: 'text/javascript' })));
    const node = new AudioWorkletNode(ctx, 'capture');
    node.port.onmessage = (e: MessageEvent<Float32Array>) => {
      if (!this.recording) return;
      this.chunks.push(e.data);
      this.samples += e.data.length;
    };
    ctx.createMediaStreamSource(stream).connect(node);
    this.ctx = ctx;
  }

  private loadWhisper(model: 'base' | 'tiny', fellBack: boolean) {
    this.backend = 'whisper';
    this.set({
      status: 'loading',
      progress: 0,
      message: `downloading Whisper ${model}${fellBack ? ' (no WebGPU on this machine)' : ''}…`,
    });
    const w = new Worker(new URL('./asr.worker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (e: MessageEvent<AsrResponse>) => {
      const m = e.data;
      if (m.type === 'progress') this.set({ progress: m.progress });
      else if (m.type === 'ready') {
        this.livePartials = m.ms < LIVE_MAX_MS;
        this.set({
          status: 'ready',
          progress: 1,
          fellBack,
          message: `Whisper ${m.model}, on this machine${this.livePartials ? '' : ' (no live transcript: too slow here)'}`,
        });
      } else if (m.type === 'result') {
        if (m.final && m.id === this.finalId) this.finish(m.text);
        else if (!m.final && this.recording) this.set({ partial: m.text });
      } else if (m.fatal) {
        w.terminate();
        this.worker = null;
        // base on WebGPU failed (driver, memory): try the small CPU model before giving up.
        if (model === 'base') this.loadWhisper('tiny', true);
        else this.set({ status: 'error', message: `Speech model failed to load: ${m.message}` });
      } else if (m.id === this.finalId) this.finish('');
    };
    w.onerror = (e) => this.set({ status: 'error', message: e.message || 'Speech worker failed to start' });
    w.postMessage({ type: 'load', vendor: vendorBase(), model } satisfies AsrRequest);
  }

  private initWebSpeech() {
    const Ctor =
      (window as unknown as Record<string, new () => SpeechRecognitionLike>).SpeechRecognition ??
      (window as unknown as Record<string, new () => SpeechRecognitionLike>).webkitSpeechRecognition;
    if (!Ctor) throw new Error('this browser has no speech recognition API');
    this.backend = 'webspeech';
    this.set({
      status: 'ready',
      progress: 1,
      message: 'browser speech API: audio may be sent to a cloud service',
    });
    this.web = null;
    this.webCtor = Ctor;
  }
  private webCtor: (new () => SpeechRecognitionLike) | null = null;

  private audio(): Float32Array {
    const out = new Float32Array(this.samples);
    let o = 0;
    for (const c of this.chunks) {
      out.set(c, o);
      o += c.length;
    }
    return out;
  }

  /** PTT pressed. */
  start() {
    if (this.state.status !== 'ready') return;
    this.set({ status: 'recording', partial: '' });
    if (this.backend === 'webspeech' && this.webCtor) {
      const r = new this.webCtor();
      r.lang = 'en-GB';
      r.continuous = true;
      r.interimResults = true;
      this.webText = '';
      r.onresult = (e) => {
        this.webText = Array.from(e.results, (res) => res[0]!.transcript).join(' ');
        this.set({ partial: this.webText });
      };
      r.onerror = (e) =>
        e.error !== 'aborted' && e.error !== 'no-speech' && this.set({ message: `speech API: ${e.error}` });
      r.onend = () => this.finish(this.webText);
      this.web = r;
      r.start();
      return;
    }
    void this.ctx?.resume();
    this.chunks = [];
    this.samples = 0;
    this.recording = true;
    // Live transcript: re-transcribe what we have so far about once a second.
    if (this.livePartials)
      this.partialTimer = setInterval(() => {
        if (this.samples > RATE * 0.8)
          this.worker?.postMessage({
            type: 'transcribe',
            id: this.nextId++,
            audio: this.audio(),
            final: false,
            prompt: this.prompt,
          } satisfies AsrRequest);
      }, 900);
  }

  /** PTT released. Resolves with the final transcript ('' if nothing usable was said). */
  stop(): Promise<string> {
    if (this.state.status !== 'recording') return Promise.resolve('');
    this.set({ status: 'transcribing' });
    return new Promise((resolve) => {
      this.resolveFinal = resolve;
      if (this.backend === 'webspeech') {
        this.web?.stop();
        // onend → finish(); guard against browsers that never fire it
        setTimeout(() => this.finish(this.webText), 1500);
        return;
      }
      this.recording = false;
      if (this.partialTimer) clearInterval(this.partialTimer);
      const audio = this.audio();
      if (audio.length < RATE * MIN_SECONDS || rms(audio) < 0.003) return this.finish('');
      this.finalId = this.nextId++;
      this.worker?.postMessage({
        type: 'transcribe',
        id: this.finalId,
        audio,
        final: true,
        prompt: this.prompt,
      } satisfies AsrRequest);
    });
  }

  private finish(text: string) {
    const resolve = this.resolveFinal;
    if (!resolve) return;
    this.resolveFinal = null;
    this.set({ status: 'ready', partial: '' });
    resolve(text);
  }
}

const rms = (a: Float32Array) => Math.sqrt(a.reduce((s, v) => s + v * v, 0) / a.length);

async function hasWebGpu(): Promise<boolean> {
  try {
    const gpu = (navigator as unknown as { gpu?: { requestAdapter(): Promise<unknown> } }).gpu;
    return !!gpu && !!(await gpu.requestAdapter());
  } catch {
    return false;
  }
}
