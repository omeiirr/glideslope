/**
 * What the tower cab hears, as numbers: engine power per aircraft and how loud it is at the cab.
 * No Web Audio (runs in tests); `sounds.ts` turns it into sound.
 */
import type { Phase } from '../core';

/** Engine power, 0 (off) to 1 (take-off), for what the aircraft is doing. `reverse`: reverse thrust. */
export function thrustOf(a: { phase: Phase; ias: number; onGround: boolean }): {
  power: number;
  reverse: boolean;
} {
  switch (a.phase) {
    case 'takeoff':
    case 'goaround':
      return { power: a.onGround ? 1 : 0.9, reverse: false };
    case 'rollout':
      // reverse thrust down to about 70 kt, then idle (typical airline practice)
      return a.ias > 70 ? { power: 0.7, reverse: true } : { power: IDLE, reverse: false };
    case 'lineup':
      return { power: 0.2, reverse: false };
    case 'holding':
    case 'vacating':
      return { power: IDLE, reverse: false };
    case 'approach':
    case 'landing':
      return { power: 0.35, reverse: false };
    case 'flight':
      return { power: 0.5, reverse: false };
  }
}

/** Ground idle (taxiing). */
export const IDLE = 0.12;

/** Loudness at this distance or nearer is full scale (m). */
const REF_M = 150;
/** Heavier aircraft are louder. */
const WAKE_GAIN: Record<string, number> = { L: 0.6, M: 1, H: 1.35, J: 1.5 };

/**
 * Loudness 0..~1.5 at the cab: power (perceived loudness grows faster than linear), weight class, and
 * spreading loss (amplitude halves per doubling of distance) beyond REF_M.
 */
export const loudness = (power: number, wake: string, distM: number) =>
  power ** 1.5 * (WAKE_GAIN[wake] ?? 1) * (REF_M / Math.max(REF_M, distM));

/** Air absorbs the highs: the low-pass cutoff falls with distance (Hz). */
export const cutoffHz = (distM: number, power: number) =>
  300 + (2500 + 5000 * power) * Math.exp(-distM / 2500);

/** Speed of sound (m/s), for the Doppler shift of the fan whine. */
const SOUND_MS = 340;
/** Pitch factor for a source closing on the listener at `closingMs` (negative: moving away). */
export const doppler = (closingMs: number) =>
  SOUND_MS / (SOUND_MS - Math.max(-150, Math.min(150, closingMs)));

/** The `n` loudest, loudest first (only these get an engine voice: each one costs audio nodes). */
export function loudest<T extends { level: number }>(list: T[], n: number): T[] {
  return [...list]
    .filter((e) => e.level > 0.002)
    .sort((a, b) => b.level - a.level)
    .slice(0, n);
}
