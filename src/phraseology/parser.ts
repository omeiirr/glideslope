import { transitionLevel, type Airport, type Command } from '../core';
import { matchCallsign } from './callsign';
import { PHONETIC, similarity, tokens, words, type Tok } from './normalize';
import { canonical } from './phrases';

export type Severity = 'info' | 'warn' | 'error';
export interface Issue {
  severity: Severity;
  rule: string;
  /** What the player said (the relevant fragment) and the standard ICAO wording. */
  said: string;
  expected: string;
}

/** What the parser needs to know about an aircraft on frequency. */
export interface AcContext {
  callsign: string;
  alt: number;
  hdg: number;
  ias: number;
  qnhGiven: boolean;
}

export interface ParseContext {
  airport: Airport;
  qnh: number;
  /** Aircraft currently on the player's frequency. Callsigns are matched against these only. */
  aircraft: readonly AcContext[];
  /** Typed input without a callsign applies to this aircraft (the selected one). */
  defaultCallsign?: string;
}

export interface ParseResult {
  callsign: string | null;
  confidence: number;
  commands: Command[];
  issues: Issue[];
  /** Two aircraft matched about equally well: pilots answer "station calling, say again". */
  ambiguous: boolean;
  /** The player said "negative" / "correction" (used to catch readback errors). */
  negative: boolean;
  /** Words that were not understood. */
  unknown: string[];
}

interface Hit {
  next: number;
  cmd?: Command;
  issues?: Omit<Issue, 'expected'>[];
}
type Matcher = (c: Cursor) => Hit | null;

class Cursor {
  constructor(
    readonly t: readonly Tok[],
    public i: number,
    readonly ctx: ParseContext,
    readonly ac: AcContext | undefined,
  ) {}
  w(i: number, ...alts: string[]): boolean {
    const k = this.t[i];
    return k?.t === 'w' && alts.includes(k.v);
  }
  n(i: number): { v: number; s: string } | null {
    const k = this.t[i];
    return k?.t === 'n' ? k : null;
  }
  /** Skip any of the given words starting at i; returns the new index. */
  skip(i: number, ...alts: string[]): number {
    while (this.w(i, ...alts)) i++;
    return i;
  }
  said(from: number, to: number): string {
    return this.t
      .slice(from, to)
      .map((k) => (k.t === 'n' ? k.s : k.v))
      .join(' ');
  }
}

const issue = (severity: Severity, rule: string, said: string) => ({ severity, rule, said });

// ---------------------------------------------------------------- matchers

const identify: Matcher = (c) => {
  if (c.w(c.i, 'identified')) return { next: c.i + 1, cmd: { type: 'identify' } };
  if (c.w(c.i, 'radar') && c.w(c.i + 1, 'contact', 'identified'))
    return { next: c.i + 2, cmd: { type: 'identify' } };
  return null;
};

const sayAgain: Matcher = (c) => {
  if (c.w(c.i, 'say') && c.w(c.i + 1, 'again')) return { next: c.i + 2, cmd: { type: 'sayAgain' } };
  if (c.w(c.i, 'repeat')) return { next: c.i + 1, cmd: { type: 'sayAgain' } };
  return null;
};

const goAround: Matcher = (c) =>
  c.w(c.i, 'go') && c.w(c.i + 1, 'around') ? { next: c.i + 2, cmd: { type: 'goAround' } } : null;

/** "runway 18R" / "runway one eight right" → { id, next } */
function runwayAt(c: Cursor, i: number): { id: string; next: number } | null {
  const hasWord = c.w(i, 'runway');
  const n = c.n(hasWord ? i + 1 : i);
  if (!n || n.v < 1 || n.v > 36 || !Number.isInteger(n.v)) return null;
  let j = (hasWord ? i + 1 : i) + 1;
  let side = '';
  if (c.w(j, 'left', 'l', 'lima')) side = 'L';
  else if (c.w(j, 'right', 'r', 'romeo')) side = 'R';
  else if (c.w(j, 'center', 'c', 'charlie')) side = 'C';
  if (side) j++;
  return { id: String(n.v).padStart(2, '0') + side, next: j };
}

const ils: Matcher = (c) => {
  let i = c.i;
  if (!c.w(i, 'cleared')) return null;
  i = c.skip(i + 1, 'for', 'the', 'to');
  const hasIls = c.w(i, 'ils');
  if (hasIls) i++;
  const hasApproach = c.w(i, 'approach');
  if (hasApproach) i++;
  if (!hasIls && !hasApproach) return null;
  const issues: Hit['issues'] = [];
  const rwy = runwayAt(c, i);
  let runway = c.ctx.airport.config.landing;
  if (rwy) {
    runway = rwy.id;
    i = rwy.next;
  } else issues.push(issue('warn', 'ils-runway-missing', c.said(c.i, i)));
  if (!hasIls || !hasApproach) issues.push(issue('info', 'ils-wording', c.said(c.i, i)));
  return { next: i, cmd: { type: 'ils', runway }, issues };
};

const freqKey = (s: string) => s.replace('.', '').replace(/0+$/, '');

const handoff: Matcher = (c) => {
  let i = c.i;
  if (c.w(i, 'contact', 'call')) i++;
  else if (c.w(i, 'switch', 'over') && c.w(i + 1, 'to')) i += 2;
  else return null;
  let to: 'tower' | 'radar';
  if (c.w(i, 'tower')) to = 'tower';
  else if (c.w(i, 'radar', 'control', 'departure', 'center')) to = 'radar';
  else return null;
  i = c.skip(i + 1, 'on', 'frequency');
  const issues: Hit['issues'] = [];
  const f = c.n(i);
  if (f) {
    i++;
    if (freqKey(f.s) !== freqKey(c.ctx.airport.frequencies[to].mhz))
      issues.push(issue('warn', 'handoff-frequency-wrong', f.s));
  } else issues.push(issue('warn', 'handoff-frequency-missing', c.said(c.i, i)));
  return { next: i, cmd: { type: 'handoff', to }, issues };
};

/** Fuzzy fix name at i: a word (or two run together), or spelled with the phonetic alphabet. */
function fixAt(c: Cursor, i: number): { fix: string; next: number } | null {
  const names = Object.keys(c.ctx.airport.fixes);
  let best: { fix: string; next: number; score: number } | null = null;
  const consider = (text: string, next: number) => {
    for (const name of names) {
      const score = similarity(text, name.toLowerCase());
      if (score >= 0.6 && (!best || score > best.score)) best = { fix: name, next, score };
    }
  };
  // spelled: "echo hotel six zero eight" / "alfa romeo tango india papa"
  let spelled = '';
  let j = i;
  for (; j < c.t.length; j++) {
    const k = c.t[j]!;
    if (k.t === 'w' && k.v in PHONETIC) spelled += PHONETIC[k.v];
    else if (k.t === 'w' && k.v.length === 1) spelled += k.v;
    else if (k.t === 'n' && spelled) spelled += k.s;
    else break;
  }
  if (spelled.length >= 3) consider(spelled, j);
  const a = c.t[i];
  if (a?.t === 'w') {
    consider(a.v, i + 1);
    const b = c.t[i + 1];
    if (b) consider(a.v + (b.t === 'w' ? b.v : b.s), i + 2); // "art tip", "eh 608"
  }
  return best;
}

const direct: Matcher = (c) => {
  let i = c.i;
  const lead = c.w(i, 'proceed', 'route', 'fly', 'go', 'continue');
  if (lead) i++;
  if (!c.w(i, 'direct')) return null;
  const hadTo = c.w(i + 1, 'to');
  const f = fixAt(c, c.skip(i + 1, 'to'));
  if (!f) return null;
  const issues: Hit['issues'] = [];
  if (!c.w(c.i, 'proceed') || hadTo) issues.push(issue('info', 'direct-wording', c.said(c.i, f.next)));
  return { next: f.next, cmd: { type: 'direct', fix: f.fix }, issues };
};

const hold: Matcher = (c) => {
  const i = c.i;
  if (!c.w(i, 'hold', 'holding')) return null;
  const f = fixAt(c, c.skip(i + 1, 'at', 'over', 'on'));
  if (!f) return null;
  let j = f.next;
  const published = c.w(j, 'as') && c.w(j + 1, 'published');
  if (published) j += 2;
  const issues: Hit['issues'] = [];
  if (!published || !c.w(i + 1, 'at')) issues.push(issue('info', 'hold-wording', c.said(c.i, j)));
  return { next: j, cmd: { type: 'hold', fix: f.fix }, issues };
};

const heading: Matcher = (c) => {
  let i = c.i;
  // "continue present heading" and friends
  let p = c.skip(i, 'continue', 'maintain', 'fly');
  if (c.w(p, 'present') && c.w(p + 1, 'heading')) return { next: p + 2, cmd: { type: 'presentHeading' } };
  if (c.w(i, 'continue') && c.w(i + 1, 'heading') && !c.n(i + 2))
    return { next: i + 2, cmd: { type: 'presentHeading' } };

  if (c.w(i, 'turn')) i++;
  let turn: 'left' | 'right' | undefined;
  if (c.w(i, 'left', 'right')) turn = (c.t[i] as { v: 'left' | 'right' }).v;
  if (turn) i++;
  p = c.skip(i, 'fly');
  const hasWord = c.w(p, 'heading');
  if (hasWord) i = p + 1;
  if (!hasWord && !turn) return null;
  const by = c.w(i, 'by');
  if (by) i++;
  const to = c.w(i, 'to', 'too', 'of');
  if (to) i++;
  const n = c.n(i);
  if (!n || !Number.isInteger(n.v)) return null;
  i++;
  const degrees = c.w(i, 'degrees', 'degree');
  if (degrees) i++;
  const said = c.said(c.i, i);
  const issues: Hit['issues'] = [];
  let value = n.v;
  let digits = n.s;

  if (turn && !hasWord && (by || (degrees && n.v <= 90)) && c.ac) {
    // relative turn: "turn left 20 degrees"
    value = ((Math.round(c.ac.hdg) + (turn === 'left' ? -n.v : n.v) + 359) % 360) + 1;
    return { next: i, cmd: { type: 'heading', heading: value, turn } };
  }
  if (to && n.s.length === 2 && 200 + n.v <= 360) {
    // "heading to seven zero" is almost always a misheard "two seven zero"
    value = 200 + n.v;
    digits = String(value);
  } else if (to) issues.push(issue('warn', 'to-before-number', said));
  if (value < 1 || value > 360) return null;
  if (digits.length !== 3) issues.push(issue('warn', 'heading-3-digits', said));
  if (!hasWord) issues.push(issue('info', 'heading-keyword', said));
  if (!turn) issues.push(issue('info', 'heading-direction', said));
  return {
    next: i,
    cmd: turn ? { type: 'heading', heading: value, turn } : { type: 'heading', heading: value },
    issues,
  };
};

const speed: Matcher = (c) => {
  let i = c.i;
  // resume normal speed
  const r = c.skip(i, 'resume');
  if (c.w(r, 'normal') && c.w(r + 1, 'speed')) return { next: r + 2, cmd: { type: 'resumeSpeed' } };
  if (c.w(i, 'no') && c.w(i + 1, 'speed') && c.w(i + 2, 'restriction', 'restrictions'))
    return {
      next: i + 3,
      cmd: { type: 'resumeSpeed' },
      issues: [issue('info', 'speed-resume-wording', c.said(i, i + 3))],
    };
  if (c.w(i, 'speed') && c.w(i + 1, 'your') && c.w(i + 2, 'discretion'))
    return {
      next: i + 3,
      cmd: { type: 'resumeSpeed' },
      issues: [issue('info', 'speed-resume-wording', c.said(i, i + 3))],
    };

  let verb = '';
  if (c.w(i, 'reduce', 'increase', 'maintain', 'slow')) verb = (c.t[i++] as { v: string }).v;
  i = c.skip(i, 'down');
  const hasWord = c.w(i, 'speed');
  if (hasWord) i++;
  const to = c.w(i, 'to', 'too');
  if (to) i++;
  const n = c.n(i);
  if (!n || !Number.isInteger(n.v)) return null;
  i++;
  const knots = c.w(i, 'knots');
  if (knots) i++;
  // Without "speed" or "knots" only a speed verb plus a plausible value counts ("maintain 180").
  const plausible = n.v >= 80 && n.v <= 340;
  if (
    !hasWord &&
    !knots &&
    !((verb === 'reduce' || verb === 'slow' || verb === 'increase' || verb === 'maintain') && plausible)
  )
    return null;
  if (!hasWord && !knots && verb === 'maintain' && n.v % 10 !== 0) return null;
  if (!plausible) return null;
  i = c.skip(i, 'or', 'greater', 'less', 'more');
  let untilDme: number | undefined;
  if (c.w(i, 'until')) {
    const d = c.n(i + 1);
    if (d) {
      untilDme = d.v;
      i = c.skip(i + 2, 'miles', 'final', 'd');
    }
  }
  const said = c.said(c.i, i);
  const issues: Hit['issues'] = [];
  if (to) issues.push(issue('warn', 'to-before-number', said));
  if (!knots) issues.push(issue('info', 'speed-knots', said));
  if (!verb || verb === 'slow' || (!hasWord && verb !== 'maintain'))
    issues.push(issue('info', 'speed-wording', said));
  else if (c.ac && ((verb === 'reduce' && n.v > c.ac.ias + 5) || (verb === 'increase' && n.v < c.ac.ias - 5)))
    issues.push(issue('warn', 'speed-verb', said));
  return {
    next: i,
    cmd: untilDme === undefined ? { type: 'speed', speed: n.v } : { type: 'speed', speed: n.v, untilDme },
    issues,
  };
};

const altitude: Matcher = (c) => {
  let i = c.i;
  let verb: 'descend' | 'climb' | 'maintain' | '' = '';
  let loose = false;
  if (c.w(i, 'descend', 'climb', 'maintain')) verb = (c.t[i++] as { v: 'descend' | 'climb' | 'maintain' }).v;
  else if (c.w(i, 'go', 'come', 'drop') && c.w(i + 1, 'down')) {
    verb = 'descend';
    loose = true;
    i += 2;
  } else if (c.w(i, 'go') && c.w(i + 1, 'up')) {
    verb = 'climb';
    loose = true;
    i += 2;
  } else if (c.w(i, 'down', 'up')) {
    verb = c.w(i, 'down') ? 'descend' : 'climb';
    loose = true;
    i++;
  }
  let faa = false;
  if (c.w(i, 'and') && c.w(i + 1, 'maintain')) {
    faa = true;
    i += 2;
  }
  const to = c.w(i, 'to', 'too');
  if (to) i++;
  let kw: 'fl' | 'altitude' | '' = '';
  if (c.w(i, 'fl')) kw = 'fl';
  else if (c.w(i, 'altitude')) kw = 'altitude';
  else if (c.w(i, 'level') && c.n(i + 1)) kw = 'fl';
  if (kw) i++;
  const to2 = c.w(i, 'to', 'too');
  if (to2) i++;
  const n = c.n(i);
  if (!n || !Number.isInteger(n.v) || (!verb && !kw)) return null;
  i++;
  if (c.w(i, 'feet')) i++;

  let isFl: boolean;
  let feet: number;
  if (kw === 'fl') [isFl, feet] = [true, n.v * 100];
  else if (kw === 'altitude') [isFl, feet] = [false, n.v < 100 ? n.v * 1000 : n.v];
  else if (n.v < 20) [isFl, feet] = [false, n.v * 1000];
  else if (n.v < 1000) [isFl, feet] = [true, n.v * 100];
  else [isFl, feet] = [false, n.v];

  let qnh: number | undefined;
  const q = c.skip(i, 'on');
  if (c.w(q, 'qnh', 'altimeter') && c.n(q + 1)) {
    qnh = c.n(q + 1)!.v;
    i = q + 2;
  }
  const said = c.said(c.i, i);
  const issues: Hit['issues'] = [];
  const ap = c.ctx.airport;
  const tlFt = transitionLevel(ap, c.ctx.qnh) * 100;
  if (faa) issues.push(issue('warn', 'faa-and-maintain', said));
  if (to || to2) issues.push(issue('warn', 'to-before-number', said));
  if (loose || !verb) issues.push(issue('info', 'altitude-wording', said));
  if (!kw) issues.push(issue('info', 'altitude-keyword', said));
  if (isFl && kw && feet < tlFt) issues.push(issue('warn', 'fl-below-tl', said));
  if (!isFl && kw && feet > ap.transitionAltitudeFt) issues.push(issue('warn', 'altitude-above-ta', said));
  // Normalise the unit to what applies at that level, whatever word was used.
  isFl = feet > ap.transitionAltitudeFt;
  if (!isFl) {
    if (qnh === undefined && c.ac && !c.ac.qnhGiven) issues.push(issue('warn', 'qnh-missing', said));
    else if (qnh !== undefined && qnh !== c.ctx.qnh) issues.push(issue('warn', 'qnh-wrong', said));
  }
  if (c.ac && ((verb === 'descend' && feet > c.ac.alt + 100) || (verb === 'climb' && feet < c.ac.alt - 100)))
    issues.push(issue('warn', 'altitude-verb', said));
  const cmd: Command = { type: 'altitude', altitude: feet, fl: isFl };
  if (qnh !== undefined && !isFl) cmd.qnh = qnh;
  return { next: i, cmd, issues };
};

/** "expect ILS approach runway 18R", "vectors for ILS": information, not a clearance. */
const expectInfo: Matcher = (c) => {
  if (!c.w(c.i, 'expect', 'vectors', 'vectoring')) return null;
  let i = c.i + 1;
  for (;;) {
    if (
      c.w(
        i,
        'vectors',
        'for',
        'the',
        'to',
        'ils',
        'approach',
        'runway',
        'left',
        'right',
        'center',
        'l',
        'r',
        'c',
      )
    )
      i++;
    else if (c.n(i) && (c.w(i - 1, 'runway') || c.w(i - 1, 'approach', 'ils'))) i++;
    else break;
  }
  return { next: i };
};

/** A stray "QNH 1013" on its own is harmless information. */
const qnhInfo: Matcher = (c) => (c.w(c.i, 'qnh') && c.n(c.i + 1) ? { next: c.i + 2 } : null);

const MATCHERS: Matcher[] = [
  identify,
  sayAgain,
  goAround,
  expectInfo,
  ils,
  handoff,
  hold,
  direct,
  heading,
  speed,
  altitude,
  qnhInfo,
];
const SOFT = new Set([
  'and',
  'then',
  'the',
  'also',
  'now',
  'to',
  'for',
  'a',
  'roger',
  'approach',
  'after',
  'that',
  'you',
  'are',
  'is',
]);
const NEGATIVE = new Set(['negative', 'correction', 'incorrect', 'wrong']);

// ---------------------------------------------------------------- entry point

export function parse(text: string, ctx: ParseContext): ParseResult {
  const ws = words(text);
  const m = matchCallsign(
    ws,
    ctx.aircraft.map((a) => a.callsign),
    ctx.airport.airlines,
  );
  const res: ParseResult = {
    callsign: m.callsign,
    confidence: m.confidence,
    commands: [],
    issues: [],
    ambiguous: m.ambiguous,
    negative: false,
    unknown: [],
  };
  let rest = ws.slice(m.consumed);
  // Typed text may omit the callsign, but a callsign that is given and unknown must not fall back to the selection.
  const namesAirline = ctx.airport.airlines.some((a) =>
    [a.icao.toLowerCase(), a.telephony.toLowerCase().split(' ')[0]].includes(ws[0] ?? ''),
  );
  if (!m.callsign && !m.ambiguous && ctx.defaultCallsign && !namesAirline) {
    res.callsign = ctx.defaultCallsign;
    res.confidence = 1;
    rest = ws;
  }
  if (!res.callsign) {
    res.issues.push({
      severity: 'error',
      rule: m.ambiguous ? 'callsign-ambiguous' : 'callsign-unknown',
      said: ws.slice(0, Math.max(m.consumed, 3)).join(' '),
      expected: 'Start with the full callsign of an aircraft on your frequency.',
    });
    return res;
  }
  const ac = ctx.aircraft.find((a) => a.callsign === res.callsign);
  const c = new Cursor(tokens(rest), 0, ctx, ac);
  const pending: { cmd: Command; issues: Omit<Issue, 'expected'>[] }[] = [];
  while (c.i < c.t.length) {
    const k = c.t[c.i]!;
    if (k.t === 'w' && NEGATIVE.has(k.v)) {
      res.negative = true;
      c.i++;
      continue;
    }
    let hit: Hit | null = null;
    for (const match of MATCHERS) if ((hit = match(c))) break;
    if (hit) {
      if (hit.cmd) pending.push({ cmd: hit.cmd, issues: hit.issues ?? [] });
      c.i = hit.next;
    } else {
      if (!(k.t === 'w' && SOFT.has(k.v))) res.unknown.push(k.t === 'n' ? k.s : k.v);
      c.i++;
    }
  }
  // A later instruction of the same kind replaces an earlier one ("heading 270, correction, heading 280").
  const seen = new Set<string>();
  for (let i = pending.length - 1; i >= 0; i--) {
    const key = pending[i]!.cmd.type;
    if (seen.has(key)) pending.splice(i, 1);
    seen.add(key);
  }
  for (const p of pending) {
    res.commands.push(p.cmd);
    const expected = canonical(p.cmd, ctx, ac);
    for (const is of p.issues) res.issues.push({ ...is, expected });
  }
  if (!res.commands.length && !res.negative) {
    res.issues.push({
      severity: 'error',
      rule: 'not-understood',
      said: rest.join(' '),
      expected: 'An instruction such as "turn left heading 270" or "descend flight level 70".',
    });
  } else if (res.unknown.length) {
    res.issues.push({ severity: 'info', rule: 'unknown-words', said: res.unknown.join(' '), expected: '' });
  }
  return res;
}
