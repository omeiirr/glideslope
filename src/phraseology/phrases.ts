import { angleDiff, runwayById, transitionLevel, type Airport, type Command, type Priority } from '../core';
import { spell, spokenCallsign } from './callsign';
import type { AcContext, ParseContext } from './parser';

const pad3 = (n: number) => String(n).padStart(3, '0');

/** A phrase in two forms: `text` for the log, `speech` spelled out for TTS. */
export interface Phrase {
  text: string;
  speech: string;
}
const both = (text: string, speech = text): Phrase => ({ text, speech });
const join = (parts: Phrase[], sep = ', '): Phrase => ({
  text: parts.map((p) => p.text).join(sep),
  speech: parts.map((p) => p.speech).join(sep),
});

/** 3000 → "three thousand", 2500 → "two thousand five hundred", 11000 → "one one thousand". */
export function spokenAltitude(ft: number): string {
  const th = Math.floor(ft / 1000);
  const h = Math.round((ft % 1000) / 100);
  return [th ? `${spell(String(th))} thousand` : '', h ? `${spell(String(h))} hundred` : '']
    .filter(Boolean)
    .join(' ');
}
const spokenFl = (fl: number) => (fl === 100 ? 'one hundred' : spell(pad3(fl).replace(/^0/, '')));
const spokenRunway = (id: string) =>
  spell(id.slice(0, 2)) + ({ L: ' left', R: ' right', C: ' center' }[id.slice(2)] ?? '');
/** Aircraft types in a description are read out letter by letter and digit by digit ("A320" → "A three two zero"). */
const spokenDesc = (s: string) =>
  s
    .replace(/\brunway (\d{2}[LRC]?)\b/g, (_, r: string) => `runway ${spokenRunway(r)}`)
    .replace(/\b([A-Z])(\d+)\b/g, (_, l: string, d: string) => `${l} ${spell(d)}`)
    .replace(/\b(\d{3})\b/g, (_, d: string) => spell(d));
const spokenFix = (fix: string) => (/\d/.test(fix) ? spell(fix) : fix[0] + fix.slice(1).toLowerCase());

function level(cmd: Extract<Command, { type: 'altitude' }>): Phrase {
  if (cmd.fl) {
    const fl = Math.round(cmd.altitude / 100);
    return both(`flight level ${String(fl).padStart(2, '0')}`, `flight level ${spokenFl(fl)}`);
  }
  return both(`altitude ${cmd.altitude}`, `altitude ${spokenAltitude(cmd.altitude)}`);
}

interface PhraseEnv {
  airport: Airport;
  qnh: number;
  /** Surface wind: the controller gives it with landing and take-off clearances. */
  wind?: { dir: number; speed: number };
}

/** "wind 200 degrees 12 knots" (direction to the nearest 10 degrees), "wind calm". */
function windPhrase(w: { dir: number; speed: number }): Phrase {
  if (w.speed < 1) return both('wind calm');
  const dir = pad3(Math.round(w.dir / 10) * 10 || 360);
  const kt = String(Math.round(w.speed));
  return both(`wind ${dir} degrees ${kt} knots`, `wind ${spell(dir)} degrees ${spell(kt)} knots`);
}

/** "runway 18R, [wind …,] cleared to land": the wind only in the controller's version. */
function clearance(runway: string, what: string, env: PhraseEnv, readback: boolean): Phrase {
  const parts = [both(`runway ${runway}`, `runway ${spokenRunway(runway)}`)];
  if (!readback && env.wind) parts.push(windPhrase(env.wind));
  return join([...parts, both(what)]);
}

/** One instruction element as the controller should say it (canonical ICAO). */
function element(cmd: Command, env: PhraseEnv, ac?: AcContext, readback = false): Phrase {
  const ap = env.airport;
  switch (cmd.type) {
    case 'identify':
      return both('identified');
    case 'acknowledge':
      return both(cmd.what === 'pan' ? 'roger PAN' : 'roger minimum fuel');
    case 'heading': {
      const dir = cmd.turn ?? (ac ? (angleDiff(ac.hdg, cmd.heading) < 0 ? 'left' : 'right') : undefined);
      const lead = readback ? (cmd.turn ? `${cmd.turn} ` : '') : dir ? `turn ${dir} ` : 'fly ';
      return both(`${lead}heading ${pad3(cmd.heading)}`, `${lead}heading ${spell(pad3(cmd.heading))}`);
    }
    case 'presentHeading':
      return both('continue present heading');
    case 'altitude': {
      const verb = ac
        ? cmd.altitude > ac.alt + 50
          ? 'climb'
          : cmd.altitude < ac.alt - 50
            ? 'descend'
            : 'maintain'
        : 'descend';
      const lv = level(cmd);
      const needQnh = !cmd.fl && (cmd.qnh !== undefined || (!readback && ac && !ac.qnhGiven));
      const q = cmd.qnh ?? env.qnh;
      return both(
        `${verb} ${lv.text}${needQnh ? `, QNH ${q}` : ''}`,
        `${verb} ${lv.speech}${needQnh ? `, Q N H ${spell(String(q))}` : ''}`,
      );
    }
    case 'speed': {
      const verb = readback
        ? ''
        : ac
          ? cmd.speed < ac.ias - 5
            ? 'reduce '
            : cmd.speed > ac.ias + 5
              ? 'increase '
              : 'maintain '
          : 'reduce ';
      const until = cmd.untilDme !== undefined ? ` until ${cmd.untilDme} miles final` : '';
      const sUntil = cmd.untilDme !== undefined ? ` until ${spell(String(cmd.untilDme))} miles final` : '';
      const head =
        verb === 'maintain ' || cmd.untilDme !== undefined ? (readback ? '' : 'maintain ') : `${verb}speed `;
      const lead = readback && !head ? 'speed ' : head;
      return both(`${lead}${cmd.speed} knots${until}`, `${lead}${spell(String(cmd.speed))} knots${sUntil}`);
    }
    case 'resumeSpeed':
      return both('resume normal speed');
    case 'direct':
      return both(
        `${readback ? '' : 'proceed '}direct ${cmd.fix}`,
        `${readback ? '' : 'proceed '}direct ${spokenFix(cmd.fix)}`,
      );
    case 'ils':
      return both(
        `cleared ILS approach runway ${cmd.runway}`,
        `cleared I L S approach runway ${spokenRunway(cmd.runway)}`,
      );
    case 'hold':
      return both(`hold at ${cmd.fix} as published`, `hold at ${spokenFix(cmd.fix)} as published`);
    case 'handoff': {
      const f = ap.frequencies[cmd.to];
      return both(
        `${readback ? '' : 'contact '}${f.name} ${f.mhz}`,
        `${readback ? '' : 'contact '}${f.name} ${spell(f.mhz)}`,
      );
    }
    case 'goAround':
      return both(readback ? 'going around' : 'go around');
    case 'sayAgain':
      return both('say again');
    case 'land':
      return clearance(cmd.runway, 'cleared to land', env, readback);
    case 'continueApproach':
      return both('continue approach');
    case 'vacate': {
      const via = cmd.exit ? ` via ${cmd.exit}` : '';
      const sVia = cmd.exit ? ` via ${spokenFix(cmd.exit)}` : '';
      const side = cmd.side ? ` ${cmd.side}` : '';
      return both(
        `vacate${side}${via || (side ? '' : ' runway')}`,
        `vacate${side}${sVia || (side ? '' : ' runway')}`,
      );
    }
    case 'lineUp': {
      const plain = both(
        `runway ${cmd.runway}, line up and wait`,
        `runway ${spokenRunway(cmd.runway)}, line up and wait`,
      );
      const ready = both(readback ? 'ready for immediate departure' : 'be ready for immediate departure');
      const rw = cmd.immediate ? join([plain, ready]) : plain;
      if (!cmd.behind) return rw;
      // ICAO: the condition first, the clearance, then the condition again ("behind")
      const who = `behind the ${cmd.behind.traffic}${cmd.behind.desc ? ` ${cmd.behind.desc}` : ''}`;
      return join([both(who, spokenDesc(who)), rw, both('behind')]);
    }
    case 'trafficInfo':
      return readback
        ? both('traffic in sight')
        : both(
            `traffic${cmd.desc ? `, ${cmd.desc}` : ''}`,
            spokenDesc(`traffic${cmd.desc ? `, ${cmd.desc}` : ''}`),
          );
    case 'takeoff':
      return clearance(
        cmd.runway,
        cmd.immediate ? 'cleared for immediate take-off' : 'cleared for take-off',
        env,
        readback,
      );
    case 'expediteVacate':
      return both(readback ? 'expediting' : 'expedite vacating');
    case 'cancelTakeoff':
      return both(readback ? 'holding' : 'hold position');
  }
}

/** Canonical controller phrase for one command (used as the "expected" text in feedback). */
export const canonical = (cmd: Command, ctx: PhraseEnv, ac?: AcContext): string => element(cmd, ctx, ac).text;

/** Canonical controller phrase for a whole transmission. */
export function canonicalTransmission(callsign: string, cmds: readonly Command[], ctx: ParseContext): string {
  const ac = ctx.aircraft.find((a) => a.callsign === callsign);
  return [callsign, ...cmds.map((c) => element(c, ctx, ac).text)].join(', ');
}

/** Controller transmission with its spoken form (Learn screen examples). */
export function controllerPhrase(
  callsign: string,
  cmds: readonly Command[],
  env: PhraseEnv,
  ac?: AcContext,
): Phrase {
  const cs = both(callsign, spokenCallsign(callsign, env.airport.airlines));
  return join([cs, ...cmds.map((c) => element(c, env, ac))]);
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/**
 * Pilot readback: instruction elements, then the callsign.
 * `ok[i] === false` turns element i into "unable" with the reason.
 */
export function readback(
  callsign: string,
  cmds: readonly Command[],
  env: PhraseEnv,
  ac?: AcContext,
  refusals: readonly (string | undefined)[] = [],
): Phrase {
  const parts: Phrase[] = [];
  cmds.forEach((cmd, i) => {
    if (cmd.type === 'identify' || cmd.type === 'sayAgain' || cmd.type === 'acknowledge') return;
    const why = refusals[i];
    // refusals are written for the log ("runway 18R"): spell them for the voice ("runway one eight right")
    parts.push(why ? both(why, spokenDesc(why)) : element(cmd, env, ac, true));
  });
  if (!parts.length) parts.push(both('roger'));
  const cs = both(callsign, spokenCallsign(callsign, env.airport.airlines));
  const p = join([...parts, cs]);
  return { text: cap(p.text), speech: cap(p.speech) };
}

/** Short chip label for the log and PTT bar: "L HDG 270", "ALT 3000", "FL070". */
export function chip(cmd: Command): string {
  switch (cmd.type) {
    case 'identify':
      return 'IDENT';
    case 'acknowledge':
      return cmd.what === 'pan' ? 'ROGER PAN' : 'ROGER MIN FUEL';
    case 'heading':
      return `${cmd.turn ? cmd.turn[0]!.toUpperCase() + ' ' : ''}HDG ${pad3(cmd.heading)}`;
    case 'presentHeading':
      return 'PRESENT HDG';
    case 'altitude':
      return cmd.fl ? `FL${pad3(Math.round(cmd.altitude / 100))}` : `ALT ${cmd.altitude}`;
    case 'speed':
      return `SPD ${cmd.speed}${cmd.untilDme !== undefined ? ` →${cmd.untilDme}NM` : ''}`;
    case 'resumeSpeed':
      return 'NORMAL SPD';
    case 'direct':
      return `DCT ${cmd.fix}`;
    case 'ils':
      return `ILS ${cmd.runway}`;
    case 'hold':
      return `HOLD ${cmd.fix}`;
    case 'handoff':
      return { tower: 'TWR', radar: 'RADAR', ground: 'GND', departure: 'DEP' }[cmd.to];
    case 'goAround':
      return 'GO AROUND';
    case 'sayAgain':
      return 'SAY AGAIN';
    case 'land':
      return `LAND ${cmd.runway}`;
    case 'continueApproach':
      return 'CONT APCH';
    case 'vacate':
      return ['VACATE', cmd.side?.[0]!.toUpperCase(), cmd.exit].filter(Boolean).join(' ');
    case 'lineUp':
      return `LUP ${cmd.runway}${cmd.behind ? ' BHND' : ''}${cmd.immediate ? ' RDY' : ''}`;
    case 'expediteVacate':
      return 'EXPD VAC';
    case 'trafficInfo':
      return 'TFC';
    case 'takeoff':
      return `T/O ${cmd.runway}${cmd.immediate ? ' IMM' : ''}`;
    case 'cancelTakeoff':
      return 'HOLD POS';
  }
}

/** Pilot's initial call. */
export function checkIn(
  ac: { callsign: string; alt: number; tgtAlt: number; kind: string; priority?: Priority },
  env: PhraseEnv,
): Phrase {
  const ap = env.airport;
  const tl = transitionLevel(ap, env.qnh) * 100;
  const lv = (ft: number) => level({ type: 'altitude', altitude: Math.round(ft / 100) * 100, fl: ft >= tl });
  const cs = both(ac.callsign, spokenCallsign(ac.callsign, ap.airlines));
  const station = both(ap.frequencies.approach.name);
  if (ac.kind === 'departure') {
    const now = lv(ac.alt);
    const to = lv(ac.tgtAlt);
    return join([
      station,
      cs,
      both(`passing ${now.text} climbing ${to.text}`, `passing ${now.speech} climbing ${to.speech}`),
    ]);
  }
  const now = lv(ac.alt);
  const moving = Math.abs(ac.tgtAlt - ac.alt) > 200;
  const to = lv(ac.tgtAlt);
  const levelPart = moving
    ? both(`${now.text} descending ${to.text}`, `${now.speech} descending ${to.speech}`)
    : now;
  const info = both(`information ${ap.atis}`, `information ${spell(ap.atis)}`);
  // PAN: urgency signal three times, then station, callsign, the nature of it and intentions (CAP 413 ch. 8)
  if (ac.priority === 'medical')
    return join([
      both('PAN PAN, PAN PAN, PAN PAN'),
      station,
      cs,
      both('medical emergency on board, request priority landing'),
      levelPart,
      info,
    ]);
  // minimum fuel is a declaration, not an emergency: no delay can be accepted (ICAO Doc 4444 15.5.4)
  if (ac.priority === 'fuel') return join([station, cs, levelPart, info, both('minimum fuel')]);
  return join([station, cs, levelPart, info]);
}

/** Pilot's first call to Tower: arrivals on the ILS, departures from the holding point. */
export function towerCheckIn(ac: { callsign: string; kind: string }, env: PhraseEnv): Phrase {
  const ap = env.airport;
  const cs = both(ac.callsign, spokenCallsign(ac.callsign, ap.airlines));
  const station = both(ap.frequencies.tower.name);
  if (ac.kind === 'departure') {
    const hp = runwayById(ap, ap.config.departure).entry?.name;
    const at = hp ? [both(`holding point ${hp}`, `holding point ${spokenFix(hp)}`)] : [];
    return join([station, cs, ...at, both('ready for departure')]);
  }
  const rw = ap.config.landing;
  return join([station, cs, both(`ILS ${rw}`, `I L S ${spokenRunway(rw)}`)]);
}

/** Human-readable explanation for each feedback rule. */
export const RULE_TEXT: Record<string, string> = {
  'qnh-missing': 'Give the QNH with the first clearance to an altitude.',
  'qnh-wrong': 'That is not the current QNH.',
  'fl-below-tl': 'Below the transition level use "altitude", not "flight level".',
  'altitude-above-ta': 'Above the transition altitude use "flight level".',
  'altitude-keyword': 'Say "altitude" or "flight level" before the number.',
  'altitude-wording': 'Use "climb" or "descend".',
  'altitude-verb': '"Climb" and "descend" must match the direction of the level change.',
  'faa-and-maintain': '"… and maintain" is FAA phraseology; ICAO omits it.',
  'to-before-number': 'Avoid "to" before a number: it can be heard as "two".',
  'heading-3-digits': 'Headings are always three digits.',
  'heading-keyword': 'Say "heading" before the number.',
  'heading-direction': 'Give the direction of turn.',
  'ils-runway-missing': 'Include the runway in an approach clearance.',
  'ils-wording': 'Standard wording: "cleared ILS approach runway …".',
  'speed-knots': 'End speeds with "knots".',
  'speed-wording': 'Use "reduce speed", "increase speed" or "maintain … knots".',
  'speed-verb': '"Reduce" and "increase" must match the direction of the speed change.',
  'speed-resume-wording': 'Standard wording: "resume normal speed".',
  'direct-wording': 'Standard wording: "proceed direct …".',
  'hold-wording': 'Standard wording: "hold at … as published".',
  'handoff-frequency-missing': 'Give the frequency with a handoff.',
  'handoff-frequency-wrong': 'That is not the frequency of that unit.',
  'runway-missing': 'Include the runway in a runway clearance.',
  'wind-missing': 'Give the surface wind with a landing or take-off clearance.',
  'lineup-wording': 'Standard wording: "runway …, line up and wait".',
  'faa-position-and-hold': '"Position and hold" is FAA phraseology; ICAO says "line up and wait".',
  'conditional-wording':
    'A conditional clearance gives the traffic first and repeats the condition at the end: "behind the departing A320, runway 24, line up and wait, behind".',
  'conditional-lineup-only': 'Only a line-up can be made conditional; the condition was ignored.',
  'stop-wording':
    'To stop a take-off roll say "stop immediately" (repeated); "hold position" before it starts.',
  'vacate-wording': 'Give the direction and the exit: "vacate left via V2".',
  'unknown-words': 'Some words were not understood and were ignored.',
  'callsign-unknown': 'Callsign not recognized.',
  'callsign-ambiguous': 'Callsign unclear: it could be more than one aircraft.',
  'not-understood': 'Instruction not understood.',
};
