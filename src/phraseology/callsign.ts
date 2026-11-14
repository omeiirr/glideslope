import type { Airline } from '../core';
import { compact, similarity } from './normalize';

export interface CallsignMatch {
  callsign: string | null;
  /** 0..1 similarity of the best candidate. */
  confidence: number;
  ambiguous: boolean;
  /** Number of leading words that belong to the callsign. */
  consumed: number;
}

export const ACCEPT = 0.72;
const AMBIGUOUS_MARGIN = 0.08;
const MAX_WORDS = 9;

const telephonyOf = (callsign: string, airlines: readonly Airline[]) =>
  airlines.find((a) => a.icao === callsign.slice(0, 3))?.telephony ?? callsign.slice(0, 3);

/** Accepted spoken forms as [name, number]: telephony + number, and the 3-letter code + number. */
function forms(callsign: string, airlines: readonly Airline[]): [string, string][] {
  const num = callsign.slice(3).toLowerCase();
  const tel = telephonyOf(callsign, airlines)
    .toLowerCase()
    .replace(/[^a-z]/g, '');
  const code = callsign.slice(0, 3).toLowerCase();
  return tel === code
    ? [[code, num]]
    : [
        [tel, num],
        [code, num],
      ];
}

/** The flight number carries more weight than the airline name: "Speedbird 111" is not "Speedbird 432". */
function score(said: string, [name, num]: [string, string]): number {
  const at = said.search(/\d/);
  if (at < 0) return 0.35 * similarity(said, name);
  return 0.35 * similarity(said.slice(0, at), name) + 0.65 * similarity(said.slice(at), num);
}

/**
 * Fuzzy-match the start of a transmission against the aircraft on frequency.
 * Works on partial transcripts too, which is what drives the early scope highlight.
 */
export function matchCallsign(
  ws: readonly string[],
  onFrequency: readonly string[],
  airlines: readonly Airline[],
): CallsignMatch {
  const best = new Map<string, { score: number; k: number }>();
  const maxK = Math.min(MAX_WORDS, ws.length);
  for (let k = 1; k <= maxK; k++) {
    const variants = new Set([compact(ws.slice(0, k), true), compact(ws.slice(0, k), false)]);
    for (const cs of onFrequency) {
      let sc = 0;
      for (const f of forms(cs, airlines)) for (const v of variants) sc = Math.max(sc, score(v, f));
      const prev = best.get(cs);
      if (!prev || sc > prev.score + 1e-9) best.set(cs, { score: sc, k });
    }
  }
  const ranked = [...best.entries()].sort((a, b) => b[1].score - a[1].score);
  const top = ranked[0];
  if (!top || top[1].score < ACCEPT)
    return { callsign: null, confidence: top?.[1].score ?? 0, ambiguous: false, consumed: 0 };
  const second = ranked[1];
  const ambiguous = !!second && top[1].score < 0.97 && second[1].score >= top[1].score - AMBIGUOUS_MARGIN;
  return { callsign: ambiguous ? null : top[0], confidence: top[1].score, ambiguous, consumed: top[1].k };
}

const SPOKEN_DIGIT = ['zero', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'niner'];
const SPOKEN_LETTER: Record<string, string> = {
  A: 'Alfa',
  B: 'Bravo',
  C: 'Charlie',
  D: 'Delta',
  E: 'Echo',
  F: 'Foxtrot',
  G: 'Golf',
  H: 'Hotel',
  I: 'India',
  J: 'Juliett',
  K: 'Kilo',
  L: 'Lima',
  M: 'Mike',
  N: 'November',
  O: 'Oscar',
  P: 'Papa',
  Q: 'Quebec',
  R: 'Romeo',
  S: 'Sierra',
  T: 'Tango',
  U: 'Uniform',
  V: 'Victor',
  W: 'Whiskey',
  X: 'X-ray',
  Y: 'Yankee',
  Z: 'Zulu',
};

/** Spell characters the ICAO way: "45MP" → "four five Mike Papa". */
export const spell = (s: string): string =>
  [...s.toUpperCase()]
    .map((c) => (c === '.' ? 'decimal' : (SPOKEN_DIGIT[+c] ?? SPOKEN_LETTER[c] ?? c)))
    .join(' ');

/** "KLM1234" → "KLM one two three four"; "BAW432" → "Speedbird four three two". */
export function spokenCallsign(callsign: string, airlines: readonly Airline[]): string {
  const tel = telephonyOf(callsign, airlines);
  return `${tel === 'KLM' ? 'K L M' : tel} ${spell(callsign.slice(3))}`;
}
