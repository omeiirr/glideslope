/** One radio frequency: one transmission at a time, a queue of waiting pilots, and blocking. */

export interface Transmission {
  from: string;
  text: string;
  /** Spelled-out form for TTS. */
  speech: string;
  /** Index into PILOT_VOICES; defaults to one picked from the callsign. */
  voice?: number;
  /** Called when the pilot starts talking (e.g. to start flying the instruction). */
  onStart?: () => void;
  /** Called when the transmission ends. `blocked` = the player talked over it. */
  onEnd?: (blocked: boolean) => void;
}

/** Plays a transmission; resolves when it has finished. `cancel` stops it early. */
export type Speak = (t: Transmission) => { done: Promise<void>; cancel: () => void };

/** Fallback when there is no TTS: silence for about as long as the words would take. */
export const silentSpeak: Speak = (t) => {
  let timer: ReturnType<typeof setTimeout>;
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
    timer = setTimeout(resolve, 600 + t.speech.split(/\s+/).length * 280);
  });
  return {
    done,
    cancel: () => {
      clearTimeout(timer);
      finish();
    },
  };
};

interface Queued {
  t: Transmission;
  notBefore: number;
}

export class Frequency {
  /** Pilot transmission on the air right now. */
  current: Transmission | null = null;
  playerKeyed = false;
  /** Pro mode: talking over a pilot garbles both transmissions. */
  blocking = false;
  speak: Speak = silentSpeak;
  /** Optional: called when a transmission is queued, so TTS can synthesise ahead. */
  prepare?: (t: Transmission) => void;
  private queue: Queued[] = [];
  private cancelCurrent: (() => void) | null = null;
  private steppedOn = false;
  private token = 0;

  get waiting(): number {
    return this.queue.length;
  }

  enqueue(t: Transmission, delayMs: number, now = performance.now()) {
    this.queue.push({ t, notBefore: now + delayMs });
    this.prepare?.(t);
  }

  /** Drop queued transmissions from an aircraft that has left. */
  drop(from: string) {
    this.queue = this.queue.filter((q) => q.t.from !== from);
  }

  /** Call every frame. Starts the next waiting transmission when the frequency is free. */
  update(now = performance.now()) {
    if (this.current || this.playerKeyed) return;
    const i = this.queue.findIndex((q) => q.notBefore <= now);
    if (i < 0) return;
    const { t } = this.queue.splice(i, 1)[0]!;
    const token = ++this.token;
    this.current = t;
    t.onStart?.();
    const h = this.speak(t);
    this.cancelCurrent = h.cancel;
    void h.done.then(() => {
      if (this.token !== token || this.current !== t) return;
      this.current = null;
      this.cancelCurrent = null;
      t.onEnd?.(false);
    });
  }

  /** Player keys the mic. */
  keyDown(now = performance.now()) {
    if (this.playerKeyed) return;
    this.playerKeyed = true;
    this.steppedOn = false;
    const t = this.current;
    if (!t) return;
    this.token++;
    this.cancelCurrent?.();
    this.current = this.cancelCurrent = null;
    if (this.blocking) {
      // Both garbled: the pilot will try again shortly.
      this.steppedOn = true;
      t.onEnd?.(true);
      this.queue.unshift({ t: { ...t, onStart: undefined }, notBefore: now + 2500 });
    } else t.onEnd?.(false);
  }

  /** Player releases the mic. Returns true if this transmission was blocked. */
  keyUp(): boolean {
    this.playerKeyed = false;
    const blocked = this.steppedOn;
    this.steppedOn = false;
    return blocked;
  }

  reset() {
    this.token++;
    this.cancelCurrent?.();
    this.current = this.cancelCurrent = null;
    this.queue = [];
    this.playerKeyed = false;
  }
}
