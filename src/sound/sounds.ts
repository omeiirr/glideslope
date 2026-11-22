/**
 * Sound effects, all synthesised with Web Audio (no sound files, so no licences):
 * - tower cab: engines of the nearest aircraft (power, distance, Doppler), tyre chirps at touchdown, the apron's
 *   APU hum, the cab's air conditioning, wind, and rain on the glass in poor visibility;
 * - radar room: room tone, the conflict-alert chime, the landline buzzer;
 * - both: a click when a strip moves;
 * - the menu (opt-in): room hiss, a single bip each 4 s radar sweep and now and then a quiet beep.
 * Heard through the cab glass and the room: everything sits under a gentle low-pass.
 */
import { perfFor } from '../core';
import type { P3 } from '../render/tower3d/math';
import { cutoffHz, doppler, loudest, loudness } from './model';

/** Engine voices at a time: each is a few audio nodes. */
const VOICES = 4;
/** Through the cab windows: the highs are cut (Hz). */
const GLASS_HZ = 3000;

export interface Emitter {
  id: number;
  pos: P3;
  type: string;
  /** Engine power 0..1; null for scenery taxiing (idle while it moves, off when it stands). */
  power: number | null;
  reverse?: boolean;
}

export interface CabState {
  eye: P3;
  emitters: Emitter[];
  /** Surface wind (kt) and prevailing visibility (m). */
  windKt: number;
  visM: number;
  /** Distance from the cab to the nearest parked aircraft (m): the APU hum. */
  apronM: number;
  paused: boolean;
}

interface Voice {
  id: number | null;
  roar: GainNode;
  roarLp: BiquadFilterNode;
  whine: OscillatorNode;
  whineGain: GainNode;
}

export class Sounds {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume = 0.6;
  private noise: AudioBuffer | null = null;
  /** Loops for the current place (cab or radar room), stopped when leaving it. */
  private loops: { stop(): void }[] = [];
  private place: 'cab' | 'room' | 'menu' | null = null;
  private voices: Voice[] = [];
  private cabGains: { aircon: GainNode; wind: GainNode; rain: GainNode; apu: GainNode } | null = null;
  private last = new Map<number, { pos: P3; t: number }>();
  private conflicts = new Set<string>();

  /** Call from a user gesture: browsers only allow audio after one. */
  unlock() {
    try {
      if (!this.ctx) {
        this.ctx = new AudioContext();
        this.master = this.ctx.createGain();
        const glass = this.ctx.createBiquadFilter();
        glass.type = 'lowpass';
        glass.frequency.value = GLASS_HZ;
        this.master.connect(glass).connect(this.ctx.destination);
        this.master.gain.value = this.volume;
        this.noise = this.buffer((d) => {
          for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
        });
      }
      void this.ctx.resume();
    } catch {
      this.ctx = null; // no Web Audio: silent
    }
  }

  setVolume(v: number) {
    this.volume = v;
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(v, this.ctx.currentTime, 0.05);
  }

  private buffer(fill: (d: Float32Array) => void, seconds = 4): AudioBuffer {
    const b = this.ctx!.createBuffer(1, this.ctx!.sampleRate * seconds, this.ctx!.sampleRate);
    fill(b.getChannelData(0));
    return b;
  }

  /** A looping noise source through a filter into a gain (started at 0), for the current place. */
  private loop(buf: AudioBuffer, type: BiquadFilterType, hz: number, q = 0.7): GainNode {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.frequency.value = hz;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.value = 0;
    src.connect(f).connect(g).connect(this.master!);
    src.start(0, Math.random() * 3);
    this.loops.push(src);
    return g;
  }

  /** Leave the cab or the radar room: its loops stop. */
  stop() {
    for (const l of this.loops) l.stop();
    this.loops = [];
    this.voices = [];
    this.cabGains = null;
    this.place = null;
    this.last.clear();
    this.conflicts.clear();
  }

  private enter(place: 'cab' | 'room' | 'menu') {
    if (this.place === place || !this.ctx) return;
    this.stop();
    this.place = place;
    const ctx = this.ctx;
    if (place === 'menu') {
      this.loop(this.noise!, 'lowpass', 600).gain.value = 0.02;
      let sweep = 0;
      const id = setInterval(() => {
        if (!this.ctx) return;
        const t = this.ctx.currentTime;
        // the sweep: one bip, the same tone as the data-block bips
        this.tone(t, 1320, 0.07, 0.025);
        // a data block updating somewhere: a short high bip on about one sweep in four
        if (++sweep > 2 && Math.random() < 0.25) {
          sweep = 0;
          this.tone(t + 0.9, 1320, 0.07, 0.025);
          this.tone(t + 1.0, 1320, 0.07, 0.02);
        }
      }, 4000);
      this.loops.push({ stop: () => clearInterval(id) });
      return;
    }
    if (place === 'room') {
      // air handling: a soft hiss (a rumble or a tone reads as a hum, and small speakers drop the lows)
      this.loop(this.noise!, 'lowpass', 600).gain.value = 0.02;
      return;
    }
    this.cabGains = {
      aircon: this.loop(this.noise!, 'lowpass', 700),
      wind: this.loop(this.noise!, 'bandpass', 450, 0.6),
      rain: this.rain(),
      // broad, not tonal: a narrow band here was heard as a constant hum
      apu: this.loop(this.noise!, 'bandpass', 300, 0.8),
    };
    this.cabGains.aircon.gain.value = 0.015;
    // gusts: a slow wobble on the wind
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const depth = ctx.createGain();
    depth.gain.value = 0.35;
    const wobble = ctx.createGain();
    lfo.connect(depth).connect(wobble.gain);
    lfo.start();
    this.loops.push(lfo);
    this.cabGains.wind.disconnect();
    this.cabGains.wind.connect(wobble).connect(this.master!);
    for (let i = 0; i < VOICES; i++) this.voices.push(this.voice());
  }

  /** Drops on the glass: sparse ticks, high-passed. */
  private rain(): GainNode {
    const buf = this.buffer((d) => {
      for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * 0.08;
      const rate = this.ctx!.sampleRate;
      for (let k = 0; k < 160; k++) {
        const at = Math.floor(Math.random() * (d.length - rate * 0.01));
        const amp = 0.3 + Math.random() * 0.7;
        for (let j = 0; j < rate * 0.008; j++)
          d[at + j]! += amp * Math.exp(-j / (rate * 0.0015)) * (Math.random() * 2 - 1);
      }
    });
    return this.loop(buf, 'highpass', 1800);
  }

  private voice(): Voice {
    const ctx = this.ctx!;
    // the roar: noise low-passed by distance, lows cut (small speakers can't play them: a roar made of
    // rumble went unheard)
    const roarLp = ctx.createBiquadFilter();
    roarLp.type = 'lowpass';
    const roarHp = ctx.createBiquadFilter();
    roarHp.type = 'highpass';
    roarHp.frequency.value = 180;
    const roar = ctx.createGain();
    roar.gain.value = 0;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    src.loop = true;
    src.connect(roarLp).connect(roarHp).connect(roar).connect(this.master!);
    src.start(0, Math.random() * 3);
    // the fan whine: a tone that rises with power
    const whine = ctx.createOscillator();
    const whineGain = ctx.createGain();
    whineGain.gain.value = 0;
    whine.connect(whineGain).connect(this.master!);
    whine.start();
    this.loops.push(src, whine);
    return { id: null, roar, roarLp, whine, whineGain };
  }

  /** One frame of the tower cab. */
  cab(s: CabState) {
    if (!this.ctx) return;
    this.enter('cab');
    const g = this.cabGains!;
    const t = this.ctx.currentTime;
    const k = 0.25; // smoothing time constant (s)
    // levels set with an analyser on the output, counting only what laptop speakers play (above 250 Hz)
    g.wind.gain.setTargetAtTime(Math.min(0.06, s.windKt * 0.003), t, 1);
    g.rain.gain.setTargetAtTime(s.visM < 5000 ? 0.1 : 0, t, 1.5);
    g.apu.gain.setTargetAtTime(Math.min(0.012, 5 / Math.max(1, s.apronM)), t, 1);

    const now = performance.now() / 1000;
    const heard = s.emitters.map((e) => {
      const d = Math.hypot(e.pos.x - s.eye.x, e.pos.y - s.eye.y, e.pos.z - s.eye.z);
      const prev = this.last.get(e.id);
      const dt = prev ? now - prev.t : 0;
      const moved = prev && dt > 0 ? Math.hypot(e.pos.x - prev.pos.x, e.pos.z - prev.pos.z) / dt : 0;
      const dPrev = prev ? Math.hypot(prev.pos.x - s.eye.x, prev.pos.y - s.eye.y, prev.pos.z - s.eye.z) : d;
      const closing = dt > 0 ? (dPrev - d) / dt : 0;
      const power = s.paused ? 0 : (e.power ?? (moved > 0.5 ? 0.1 : 0));
      return { e, d, power, closing, level: loudness(power, perfFor(e.type).wake, d) };
    });
    this.last = new Map(s.emitters.map((e) => [e.id, { pos: e.pos, t: now }]));

    const pick = loudest(heard, VOICES);
    // keep each aircraft on the voice it had, so its sound doesn't jump
    const free = this.voices.filter((v) => !pick.some((p) => p.e.id === v.id));
    for (const p of pick) {
      let v = this.voices.find((x) => x.id === p.e.id);
      if (!v) {
        v = free.shift()!;
        v.id = p.e.id;
      }
      const reverse = p.e.reverse ? 1.4 : 1;
      v.roar.gain.setTargetAtTime(Math.min(1, p.level * 2.5 * reverse), t, k);
      v.roarLp.frequency.setTargetAtTime(cutoffHz(p.d, p.power) * (p.e.reverse ? 1.3 : 1), t, k);
      v.whine.frequency.setTargetAtTime((300 + 2400 * p.power) * doppler(p.closing), t, k);
      v.whineGain.gain.setTargetAtTime(Math.min(0.05, p.level * 0.35) * Math.exp(-p.d / 4000), t, k);
    }
    for (const v of free) {
      v.id = null;
      v.roar.gain.setTargetAtTime(0, t, k);
      v.whineGain.gain.setTargetAtTime(0, t, k);
    }
  }

  /** Tyres touching down at `distM` from the cab: two short chirps. */
  touchdown(distM: number) {
    if (!this.ctx || this.place !== 'cab') return;
    const level = Math.min(0.8, 1.5 * (400 / Math.max(400, distM)));
    for (const dt of [0, 0.16]) this.burst(this.ctx.currentTime + 0.05 + dt, 1300, 3, 0.11, level);
  }

  /** One frame of the radar room: a chime for each new conflict. */
  room(conflicts: readonly { a: number; b: number; kind: string }[]) {
    if (!this.ctx) return;
    this.enter('room');
    const keys = new Set(conflicts.map((c) => `${Math.min(c.a, c.b)}-${Math.max(c.a, c.b)}`));
    if ([...keys].some((k) => !this.conflicts.has(k))) this.chime();
    this.conflicts = keys;
  }

  private tone(at: number, hz: number, dur: number, level: number, type: OscillatorType = 'sine') {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.value = hz;
    const g = ctx.createGain();
    g.gain.setValueAtTime(0, at);
    g.gain.linearRampToValueAtTime(level, at + 0.015);
    g.gain.setValueAtTime(level, at + dur - 0.04);
    g.gain.linearRampToValueAtTime(0, at + dur);
    o.connect(g).connect(this.master!);
    o.start(at);
    o.stop(at + dur + 0.02);
  }

  private burst(at: number, hz: number, q: number, dur: number, level: number) {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise!;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = hz;
    f.Q.value = q;
    const g = ctx.createGain();
    g.gain.setValueAtTime(level, at);
    g.gain.exponentialRampToValueAtTime(0.001, at + dur);
    src.connect(f).connect(g).connect(this.master!);
    src.start(at, Math.random() * 3);
    src.stop(at + dur + 0.02);
  }

  /** Conflict alert: two falling tones. */
  chime() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.tone(t, 880, 0.22, 0.12);
    this.tone(t + 0.24, 660, 0.3, 0.12);
  }

  /** The menu's ambience on or off (needs `unlock` first, from a user gesture). */
  menu(on: boolean) {
    if (on) this.enter('menu');
    else if (this.place === 'menu') this.stop();
  }

  /** A strip moving in its holder. */
  click() {
    if (!this.ctx) return;
    this.burst(this.ctx.currentTime, 2600, 1.5, 0.03, 0.18);
  }

  /** The landline from Tower: two short buzzes. */
  landline() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    for (const at of [t, t + 0.55]) {
      this.tone(at, 425, 0.4, 0.06, 'square');
      this.tone(at, 450, 0.4, 0.06, 'square');
    }
  }
}

/** The one player for the app. */
export const sounds = new Sounds();
