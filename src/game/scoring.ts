import type { Issue } from '../phraseology/parser';

export interface Stats {
  landed: number;
  departuresOut: number;
  /** Sum of arrival delays in seconds (actual minus nominal flying time). */
  delaySum: number;
  separationLosses: number;
  wakeInfringements: number;
  missedHandoffs: number;
  goArounds: number;
  leftAirspace: number;
  transmissions: number;
  /** Sum of per-transmission phraseology scores (0..100). */
  phraseSum: number;
  notUnderstood: number;
  readbackErrors: number;
  readbackCaught: number;
  /** Count per feedback rule, for the debrief. */
  rules: Record<string, number>;
}

export const emptyStats = (): Stats => ({
  landed: 0,
  departuresOut: 0,
  delaySum: 0,
  separationLosses: 0,
  wakeInfringements: 0,
  missedHandoffs: 0,
  goArounds: 0,
  leftAirspace: 0,
  transmissions: 0,
  phraseSum: 0,
  notUnderstood: 0,
  readbackErrors: 0,
  readbackCaught: 0,
  rules: {},
});

/** 100 = textbook ICAO. Warnings cost 20, style notes 5; not understood = 0. */
export function phraseScore(issues: readonly Issue[]): number {
  if (issues.some((i) => i.severity === 'error')) return 0;
  const cost = issues.reduce(
    (s, i) => s + (i.severity === 'warn' ? 20 : i.rule === 'unknown-words' ? 0 : 5),
    0,
  );
  return Math.max(0, 100 - cost);
}

export const phraseologyPct = (s: Stats): number =>
  s.transmissions ? Math.round(s.phraseSum / s.transmissions) : 100;

interface Weights {
  landed: number;
  departure: number;
  delayPer10s: number;
  separation: number;
  wake: number;
  missedHandoff: number;
  goAround: number;
  leftAirspace: number;
  uncaughtReadback: number;
  caughtReadback: number;
  phraseBonus: number;
}

/** Same events, different weights: Beginner only rewards, Pro also punishes. */
export const WEIGHTS: Record<'beginner' | 'pro', Weights> = {
  beginner: {
    landed: 100,
    departure: 20,
    delayPer10s: 0,
    separation: 0,
    wake: 0,
    missedHandoff: 0,
    goAround: -10,
    leftAirspace: -50,
    uncaughtReadback: 0,
    caughtReadback: 0,
    phraseBonus: 2,
  },
  pro: {
    landed: 100,
    departure: 30,
    delayPer10s: -1,
    separation: -200,
    wake: -100,
    missedHandoff: -50,
    goAround: -50,
    leftAirspace: -150,
    uncaughtReadback: -75,
    caughtReadback: 25,
    phraseBonus: 3,
  },
};

export function totalScore(s: Stats, mode: 'beginner' | 'pro'): number {
  const w = WEIGHTS[mode];
  return Math.round(
    s.landed * w.landed +
      s.departuresOut * w.departure +
      (s.delaySum / 10) * w.delayPer10s +
      s.separationLosses * w.separation +
      s.wakeInfringements * w.wake +
      s.missedHandoffs * w.missedHandoff +
      s.goArounds * w.goAround +
      s.leftAirspace * w.leftAirspace +
      (s.readbackErrors - s.readbackCaught) * w.uncaughtReadback +
      s.readbackCaught * w.caughtReadback +
      (s.phraseSum / 100) * w.phraseBonus,
  );
}
