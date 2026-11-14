/** Seedable RNG (mulberry32). All randomness in the core goes through this. */
export class Rng {
  private s: number;
  constructor(seed: number) {
    this.s = seed >>> 0;
  }
  next(): number {
    let t = (this.s += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(lo: number, hi: number): number {
    return lo + this.next() * (hi - lo);
  }
  int(lo: number, hi: number): number {
    return Math.floor(this.range(lo, hi + 1));
  }
  pick<T>(arr: readonly T[]): T {
    return arr[Math.floor(this.next() * arr.length)]!;
  }
  weighted<T extends { weight: number }>(arr: readonly T[]): T {
    let r = this.next() * arr.reduce((s, a) => s + a.weight, 0);
    for (const a of arr) if ((r -= a.weight) < 0) return a;
    return arr[arr.length - 1]!;
  }
}
