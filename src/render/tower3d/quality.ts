/** Tower view graphics quality, and Auto: start at High and step down while frames are slow. No DOM, no WebGL. */
export type Quality = 'low' | 'medium' | 'high';
export type GraphicsSetting = 'auto' | Quality;

const DOWN: Record<Quality, Quality | null> = { high: 'medium', medium: 'low', low: null };
/** Slower than this median frame (ms, about 45 fps) steps down a level. */
const SLOW_MS = 22;
const WARMUP = 60;
const SAMPLES = 90;

export class AutoQuality {
  level: Quality = 'high';
  done = false;
  private skip = WARMUP;
  private t: number[] = [];

  /** Feed one frame interval (ms); returns the new level when it steps down. */
  frame(dt: number): Quality | null {
    // a hidden tab pauses frames: that gap says nothing about the GPU
    if (this.done || dt > 250) return null;
    if (this.skip > 0) {
      this.skip--;
      return null;
    }
    this.t.push(dt);
    if (this.t.length < SAMPLES) return null;
    const median = [...this.t].sort((a, b) => a - b)[SAMPLES >> 1]!;
    this.t = [];
    const next = DOWN[this.level];
    if (median <= SLOW_MS || !next) {
      this.done = true;
      return null;
    }
    this.level = next;
    this.skip = WARMUP; // let the new level settle before measuring again
    return next;
  }
}
