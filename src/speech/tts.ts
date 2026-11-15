import type { Settings } from '../game/settings';
import { silentSpeak, type Speak, type Transmission } from '../radio/frequency';
import { PILOT_VOICES, PIPER_MODEL, hash, vendorBase } from './models';
import { playRadio, squelch } from './radiofx';
import type { TtsRequest, TtsResponse } from './tts.worker';

export interface TtsState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  progress: number;
  message?: string;
}

interface Clip {
  pcm: Float32Array<ArrayBuffer>;
  sampleRate: number;
}

/**
 * Pilot voices. Piper runs in a worker; while its model downloads (or if it fails) the browser's own
 * speechSynthesis is used, and if that is missing too, transmissions are silent but still timed.
 */
export class Tts {
  state: TtsState = { status: 'idle', progress: 0 };
  onChange: () => void = () => {};
  private worker: Worker | null = null;
  private ctx: AudioContext | null = null;
  private nextId = 1;
  private waiting = new Map<number, { resolve: (c: Clip) => void; reject: (e: Error) => void }>();
  private prepared = new Map<string, Promise<Clip>>();

  constructor(private settings: () => Settings) {}

  /** Call from a user gesture: browsers only allow audio after one. */
  unlock() {
    try {
      this.ctx ??= new AudioContext();
      void this.ctx.resume();
    } catch {
      /* no Web Audio: speech falls back to silence */
    }
    if (this.settings().tts === 'piper') this.loadPiper();
  }

  private set(patch: Partial<TtsState>) {
    this.state = { ...this.state, ...patch };
    this.onChange();
  }

  private loadPiper() {
    if (this.worker || this.state.status === 'error') return;
    this.set({ status: 'loading', progress: 0, message: undefined });
    const w = new Worker(new URL('./tts.worker.ts', import.meta.url), { type: 'module' });
    this.worker = w;
    w.onmessage = (e: MessageEvent<TtsResponse>) => {
      const m = e.data;
      if (m.type === 'progress') this.set({ progress: m.progress });
      else if (m.type === 'ready') this.set({ status: 'ready', progress: 1 });
      else if (m.type === 'audio') {
        this.waiting
          .get(m.id)
          ?.resolve({ pcm: m.pcm as Float32Array<ArrayBuffer>, sampleRate: m.sampleRate });
        this.waiting.delete(m.id);
      } else if (m.id !== undefined) {
        this.waiting.get(m.id)?.reject(new Error(m.message));
        this.waiting.delete(m.id);
      } else this.set({ status: 'error', message: m.message });
    };
    w.onerror = (e) => this.set({ status: 'error', message: e.message || 'Voice worker failed to start' });
    w.postMessage({ type: 'load', vendor: vendorBase(), model: PIPER_MODEL } satisfies TtsRequest);
  }

  private synth(t: Transmission): Promise<Clip> {
    const key = `${t.from}|${t.speech}`;
    let p = this.prepared.get(key);
    if (!p) {
      const [speaker, speed] = PILOT_VOICES[hash(t.from) % PILOT_VOICES.length]!;
      const id = this.nextId++;
      p = new Promise<Clip>((resolve, reject) => this.waiting.set(id, { resolve, reject }));
      this.worker!.postMessage({ type: 'synth', id, text: t.speech, speaker, speed } satisfies TtsRequest);
      this.prepared.set(key, p);
      if (this.prepared.size > 40) this.prepared.delete(this.prepared.keys().next().value!);
    }
    return p;
  }

  /** Start synthesising before the frequency is free, so the readback starts promptly. */
  prepare = (t: Transmission) => {
    if (this.settings().tts === 'piper' && this.state.status === 'ready') void this.synth(t).catch(() => {});
  };

  speak: Speak = (t) => {
    const s = this.settings();
    if (s.tts === 'off' || s.ttsVolume <= 0) return silentSpeak(t);
    if (s.tts === 'piper' && this.state.status === 'idle') this.loadPiper();
    if (s.tts === 'piper' && this.state.status === 'ready' && this.ctx) return this.speakPiper(t, s);
    return this.speakSystem(t, s);
  };

  private speakPiper(t: Transmission, s: Settings) {
    let cancelled = false;
    let stop = () => {};
    const done = this.synth(t)
      .then((clip) => {
        if (cancelled) return;
        // copy: a cached clip may be played again ("say again", replay)
        const pb = playRadio(this.ctx!, clip.pcm.slice(), clip.sampleRate, {
          fx: s.radioFx,
          volume: s.ttsVolume,
        });
        stop = pb.cancel;
        return pb.done;
      })
      .catch(() => (cancelled ? undefined : silentSpeak(t).done));
    return {
      done,
      cancel: () => {
        cancelled = true;
        stop();
      },
    };
  }

  private speakSystem(t: Transmission, s: Settings) {
    if (typeof speechSynthesis === 'undefined') return silentSpeak(t);
    const u = new SpeechSynthesisUtterance(t.speech);
    const voices = speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'));
    if (voices.length) u.voice = voices[hash(t.from) % voices.length]!;
    u.lang = 'en-GB';
    u.rate = 1.15;
    u.pitch = 0.85 + (hash(t.from) % 5) * 0.08;
    u.volume = s.ttsVolume;
    let finish = () => {};
    const done = new Promise<void>((resolve) => (finish = resolve));
    // Safety net: some browsers never fire `end`.
    const timer = setTimeout(finish, 2000 + t.speech.split(/\s+/).length * 600);
    u.onend = u.onerror = () => {
      clearTimeout(timer);
      if (s.radioFx && this.ctx) squelch(this.ctx, s.ttsVolume);
      finish();
    };
    if (s.radioFx && this.ctx) squelch(this.ctx, s.ttsVolume);
    speechSynthesis.speak(u);
    return {
      done,
      cancel: () => {
        clearTimeout(timer);
        speechSynthesis.cancel();
        finish();
      },
    };
  }

  /** Replay a logged transmission outside the frequency model. */
  replay(t: Transmission) {
    this.speak(t);
  }
}
