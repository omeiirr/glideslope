/** VHF radio sound: band-pass 300–3400 Hz, light distortion, background hiss, squelch clicks. */

let noise: AudioBuffer | null = null;
function noiseBuffer(ctx: AudioContext): AudioBuffer {
  if (noise && noise.sampleRate === ctx.sampleRate) return noise;
  noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const d = noise.getChannelData(0);
  for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
  return noise;
}

function softClip(amount: number): Float32Array<ArrayBuffer> {
  const n = 1024;
  const curve = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const x = (i / (n - 1)) * 2 - 1;
    curve[i] = Math.tanh(x * amount) / Math.tanh(amount);
  }
  return curve;
}

/** Short burst of hiss: the squelch opening or closing. */
function click(ctx: AudioContext, out: AudioNode, at: number, volume: number) {
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0.22 * volume, at);
  g.gain.exponentialRampToValueAtTime(0.001, at + 0.07);
  src.connect(g).connect(out);
  src.start(at, Math.random());
  src.stop(at + 0.08);
}

export interface Playback {
  done: Promise<void>;
  cancel: () => void;
}

/** Play speech through the radio chain (or clean when `fx` is false). */
export function playRadio(
  ctx: AudioContext,
  pcm: Float32Array<ArrayBuffer>,
  sampleRate: number,
  opts: { fx: boolean; volume: number },
): Playback {
  const buffer = ctx.createBuffer(1, pcm.length, sampleRate);
  buffer.copyToChannel(pcm, 0);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  const master = ctx.createGain();
  master.gain.value = opts.volume;
  master.connect(ctx.destination);
  const t0 = ctx.currentTime + 0.03;
  const nodes: AudioScheduledSourceNode[] = [src];

  if (opts.fx) {
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 300;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 3400;
    const lp2 = ctx.createBiquadFilter();
    lp2.type = 'lowpass';
    lp2.frequency.value = 3400;
    const shaper = ctx.createWaveShaper();
    shaper.curve = softClip(2.2);
    const pre = ctx.createGain();
    pre.gain.value = 1.6;
    src.connect(pre).connect(hp).connect(lp).connect(lp2).connect(shaper).connect(master);
    // hiss for the length of the transmission
    const hiss = ctx.createBufferSource();
    hiss.buffer = noiseBuffer(ctx);
    hiss.loop = true;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 1800;
    band.Q.value = 0.6;
    const hg = ctx.createGain();
    hg.gain.value = 0.035;
    hiss.connect(band).connect(hg).connect(master);
    hiss.start(t0);
    hiss.stop(t0 + buffer.duration + 0.1);
    nodes.push(hiss);
    click(ctx, master, t0, 1);
    click(ctx, master, t0 + buffer.duration + 0.05, 0.8);
    src.start(t0 + 0.06);
  } else {
    src.connect(master);
    src.start(t0);
  }

  let finish = () => {};
  const done = new Promise<void>((resolve) => (finish = resolve));
  src.onended = () => setTimeout(finish, opts.fx ? 120 : 0);
  return {
    done,
    cancel: () => {
      for (const n of nodes) {
        try {
          n.stop();
        } catch {
          /* already stopped */
        }
      }
      master.disconnect();
      finish();
    },
  };
}

/** Squelch click on its own (used around browser-TTS speech, which cannot be routed through Web Audio). */
export function squelch(ctx: AudioContext, volume: number) {
  const g = ctx.createGain();
  g.gain.value = volume;
  g.connect(ctx.destination);
  click(ctx, g, ctx.currentTime + 0.01, 1);
}
