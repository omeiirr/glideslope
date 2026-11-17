import type { ParseContext } from '../phraseology/parser';

/** Callsigns written into the prompt; Whisper allows 224 prompt tokens and 12 transmissions use about 130. */
const MAX_CALLSIGNS = 10;

/**
 * Text Whisper treats as what was said just before the recording, so it expects these words: the station, the
 * callsigns on frequency and the phrases of the current role. Whisper copies the prompt's spelling, so it is
 * written the way the parser reads best ("KLM 1234", "QNH 1013", "18R").
 */
export function asrPrompt(ctx: ParseContext): string {
  const ap = ctx.airport;
  const { landing, departure } = ap.config;
  const f = ap.frequencies;
  const calls = ctx.aircraft.slice(0, MAX_CALLSIGNS).map(({ callsign }) => {
    const tel = ap.airlines.find((a) => a.icao === callsign.slice(0, 3))?.telephony ?? callsign.slice(0, 3);
    return `${tel} ${callsign.slice(3)}`;
  });
  const wind = `wind ${String(ctx.wind?.dir ?? ap.wind.dir).padStart(3, '0')} degrees ${ctx.wind?.speed ?? ap.wind.speed} knots`;
  const exits = ap.runways.find((r) => r.id === landing)?.exits ?? [];
  const exit = exits[Math.floor(exits.length / 2)];
  const phrases =
    ctx.role === 'tower'
      ? [
          // in the order controllers say them: with "cleared to land runway 18R" the only "runway …, cleared"
          // in the prompt was the take-off clearance, and real speakers got "cleared for take-off" for "to land"
          `${wind}, runway ${landing}, cleared to land`,
          `runway ${departure}, line up and wait`,
          `${wind}, runway ${departure}, cleared for take-off`,
          'continue approach',
          exit ? `vacate ${exit.side === 'L' ? 'left' : 'right'} via ${exit.name}` : 'vacate',
          'go around',
          `contact Ground ${f.ground.mhz}`,
          `contact Departure ${f.departure.mhz}`,
        ]
      : [
          'identified',
          'turn left heading 210',
          'fly heading 360',
          `descend altitude 3000, QNH ${ctx.qnh}`,
          'climb flight level 100',
          'reduce speed 220 knots',
          'resume normal speed',
          ...[...new Set(ap.stars.map((s) => s.iaf))].map((fix) => `proceed direct ${fix}`),
          'hold as published',
          `cleared ILS approach runway ${landing}`,
          `contact Tower ${f.tower.mhz}`,
          'go around',
        ];
  const station = ctx.role === 'tower' ? f.tower.name : f.approach.name;
  // One transmission per phrase, callsigns taken in turn: a bare callsign list made Whisper add callsigns
  // nobody said (synthetic-voice test: base 37/48 commands right as a list, 41/48 as transmissions).
  const n = calls.length ? Math.max(phrases.length, calls.length) : phrases.length;
  const lines = Array.from({ length: n }, (_, i) => {
    const phrase = phrases[i % phrases.length]!;
    return calls.length ? `${calls[i % calls.length]}, ${phrase}.` : `${phrase}.`;
  });
  return `${station}. ${lines.join(' ')}`;
}

const norm = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

/**
 * On silence or noise Whisper can "hear" its prompt. A transcript that is the beginning of the prompt (it starts
 * with the station name, which a controller's transmission never does) is dropped.
 */
export const isPromptEcho = (text: string, prompt: string): boolean => {
  const t = norm(text);
  return !!t && !!prompt && norm(prompt).startsWith(t);
};
