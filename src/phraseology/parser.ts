import { runwayById, transitionLevel, type Airport, type Command, type Condition } from '../core';
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
  /** Who the player is. Tower adds the runway clearances (default: approach). */
  role?: 'approach' | 'tower';
  /** Surface wind, for the canonical landing and take-off clearances. */
  wind?: { dir: number; speed: number };
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
  /** "runway 24" said on its own, before the clearance it belongs to (ICAO order). */
  runway?: string;
  /** A surface wind was given in this transmission. */
  wind = false;
  /** Conditional clearance: the traffic named, and where in the transmission. */
  cond?: { condition: Condition; at: number };
  /** The condition was repeated after the clearance ("…, line up and wait, behind"). */
  condRepeated = false;
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

/** "Roger PAN [PAN]", "roger minimum fuel" ("roger" itself is filler and already dropped). */
const acknowledge: Matcher = (c) => {
  if (c.w(c.i, 'pan')) {
    let i = c.i + 1;
    while (c.w(i, 'pan')) i++;
    return { next: i, cmd: { type: 'acknowledge', what: 'pan' } };
  }
  if (c.w(c.i, 'minimum') && c.w(c.i + 1, 'fuel'))
    return { next: c.i + 2, cmd: { type: 'acknowledge', what: 'fuel' } };
  return null;
};

const sayAgain: Matcher = (c) => {
  // the controller repeating themselves ("I say again") is not a request to the pilot
  if (c.ctx.role === 'tower' && c.w(c.i, 'i') && c.w(c.i + 1, 'say') && c.w(c.i + 2, 'again'))
    return { next: c.i + 3 };
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
  let to: Extract<Command, { type: 'handoff' }>['to'];
  const tower = c.ctx.role === 'tower';
  if (c.w(i, 'tower')) to = 'tower';
  else if (tower && c.w(i, 'ground')) to = 'ground';
  else if (tower && c.w(i, 'departure')) to = 'departure';
  else if (c.w(i, 'radar', 'control', 'departure', 'center')) to = 'radar';
  else return null;
  i = c.skip(i + 1, 'on', 'frequency');
  const issues: Hit['issues'] = [];
  const f = c.n(i);
  if (f) {
    i++;
    const want = c.ctx.airport.frequencies[to];
    if (!want.placeholder && freqKey(f.s) !== freqKey(want.mhz))
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

// ---------------------------------------------------------------- tower matchers (role 'tower' only)

/** Runway after a clearance ("cleared to land runway 18R"), else one said before it ("runway 24, cleared …"). */
function clearanceRunway(c: Cursor, i: number, fallback: string) {
  const r = runwayAt(c, i);
  if (r) return { id: r.id, next: r.next, missing: false };
  return { id: c.runway ?? fallback, next: i, missing: c.runway === undefined };
}

const runwayIssue = (c: Cursor, r: { missing: boolean; next: number }) =>
  r.missing ? [issue('warn', 'runway-missing', c.said(c.i, r.next))] : [];

/** "runway 24" on its own: remembered for the clearance that follows. */
const runwayInfo: Matcher = (c) => {
  if (!c.w(c.i, 'runway')) return null;
  const r = runwayAt(c, c.i);
  if (!r) return null;
  c.runway = r.id;
  return { next: r.next };
};

/** "wind 200 degrees 12 knots", "wind calm": information that goes with a clearance. */
const windInfo: Matcher = (c) => {
  if (!c.w(c.i, 'wind')) return null;
  c.wind = true;
  if (c.w(c.i + 1, 'calm')) return { next: c.i + 2 };
  let i = c.i + 1;
  if (!c.n(i)) return { next: i };
  i = c.skip(i + 1, 'degrees', 'degree', 'at');
  if (c.n(i)) i = c.skip(i + 1, 'knots', 'knot');
  return { next: i };
};

/** "when vacated", "when airborne": condition for the handoff that follows. */
const whenInfo: Matcher = (c) =>
  c.w(c.i, 'when') && c.w(c.i + 1, 'vacated', 'airborne') ? { next: c.i + 2 } : null;

const land: Matcher = (c) => {
  if (!c.w(c.i, 'cleared')) return null;
  const i = c.skip(c.i + 1, 'to', 'too');
  if (!c.w(i, 'land')) return null;
  const r = clearanceRunway(c, i + 1, c.ctx.airport.config.landing);
  return { next: r.next, cmd: { type: 'land', runway: r.id }, issues: runwayIssue(c, r) };
};

const takeoff: Matcher = (c) => {
  if (!c.w(c.i, 'cleared')) return null;
  let i = c.skip(c.i + 1, 'for', 'to');
  const immediate = c.w(i, 'immediate');
  if (immediate) i++;
  if (c.w(i, 'takeoff')) i++;
  else if (c.w(i, 'take') && c.w(i + 1, 'off', 'of')) i += 2;
  else return null;
  const r = clearanceRunway(c, i, c.ctx.airport.config.departure);
  const cmd: Command = { type: 'takeoff', runway: r.id };
  if (immediate) cmd.immediate = true;
  return { next: r.next, cmd, issues: runwayIssue(c, r) };
};

const lineUp: Matcher = (c) => {
  let i = c.skip(c.i, 'taxi', 'into');
  let faa = false;
  if (c.w(i, 'lineup')) i++;
  else if (c.w(i, 'line') && c.w(i + 1, 'up')) i += 2;
  else if (c.w(i, 'position') && c.w(i + 1, 'and') && c.w(i + 2, 'hold')) {
    faa = true;
    i += 3;
  } else return null;
  let wait = faa;
  if (!faa && c.w(i, 'and') && c.w(i + 1, 'wait', 'weight', 'hold')) {
    wait = c.w(i + 1, 'wait', 'weight');
    i += 2;
  }
  const r = clearanceRunway(c, i, c.ctx.airport.config.departure);
  const issues = runwayIssue(c, r);
  if (faa) issues.push(issue('warn', 'faa-position-and-hold', c.said(c.i, r.next)));
  else if (!wait) issues.push(issue('info', 'lineup-wording', c.said(c.i, r.next)));
  const cmd: Command = { type: 'lineUp', runway: r.id };
  // "…, be ready for immediate departure"
  let next = r.next;
  const j = c.skip(c.skip(next, 'be'), 'ready', 'for');
  if (j > next && c.w(j, 'immediate') && c.w(j + 1, 'departure', 'takeoff')) {
    cmd.immediate = true;
    next = j + 2;
  }
  return { next, cmd, issues };
};

const cancelTakeoff: Matcher = (c) => {
  const i = c.i;
  if (c.w(i, 'hold') && c.w(i + 1, 'position')) return { next: i + 2, cmd: { type: 'cancelTakeoff' } };
  if (c.w(i, 'stop'))
    return c.w(i + 1, 'immediately')
      ? { next: i + 2, cmd: { type: 'cancelTakeoff' } }
      : { next: i + 1, cmd: { type: 'cancelTakeoff' }, issues: [issue('info', 'stop-wording', 'stop')] };
  if (
    c.w(i, 'cancel', 'abort') &&
    (c.w(i + 1, 'takeoff') || (c.w(i + 1, 'take') && c.w(i + 2, 'off', 'of')))
  ) {
    const next = c.w(i + 1, 'takeoff') ? i + 2 : i + 3;
    return { next, cmd: { type: 'cancelTakeoff' } };
  }
  return null;
};

/** "expedite vacating", "expedite vacating the runway", or "…, expedite" after a vacate instruction. */
const expediteVacate: Matcher = (c) =>
  c.w(c.i, 'expedite')
    ? { next: c.skip(c.i + 1, 'vacating', 'vacate', 'the', 'runway'), cmd: { type: 'expediteVacate' } }
    : null;

const continueApproach: Matcher = (c) =>
  c.w(c.i, 'continue') && c.w(c.i + 1, 'approach')
    ? { next: c.i + 2, cmd: { type: 'continueApproach' } }
    : null;

/** Exit of the landing runway at i: "V2", "victor two", "sierra seven echo". */
function exitAt(c: Cursor, i: number): { exit: string; next: number } | null {
  const names = (runwayById(c.ctx.airport, c.ctx.airport.config.landing).exits ?? []).map((e) => e.name);
  let s = '';
  let best: { exit: string; next: number } | null = null;
  for (let j = i; j < Math.min(c.t.length, i + 4); j++) {
    const k = c.t[j]!;
    if (k.t === 'n') s += k.s;
    else if (k.v in PHONETIC) s += PHONETIC[k.v];
    else if (k.v.length === 1) s += k.v;
    else if (s && (k.v === 'to' || k.v === 'too'))
      s += '2'; // ASR: "victor to"
    else if (s && k.v === 'for') s += '4';
    else break;
    const hit = names.find((n) => n.toLowerCase() === s.toLowerCase());
    if (hit) best = { exit: hit, next: j + 1 };
  }
  return best;
}

const vacate: Matcher = (c) => {
  if (!c.w(c.i, 'vacate')) return null;
  let i = c.skip(c.i + 1, 'the', 'runway');
  let side: 'left' | 'right' | undefined;
  if (c.w(i, 'left', 'right')) side = (c.t[i++] as { v: 'left' | 'right' }).v;
  const e = exitAt(c, c.skip(i, 'via', 'at', 'the', 'taxiway'));
  if (e) i = e.next;
  const cmd: Command = { type: 'vacate' };
  if (e) cmd.exit = e.exit;
  if (side) cmd.side = side;
  const issues = !e || !side ? [issue('info', 'vacate-wording', c.said(c.i, i))] : [];
  return { next: i, cmd, issues };
};

/** Words that start the next instruction: a traffic description ends before them. */
const CLAUSE = new Set([
  'line',
  'lineup',
  'cleared',
  'taxi',
  'hold',
  'behind',
  'cross',
  'vacate',
  'contact',
  'wind',
  'continue',
  'go',
  'stop',
  'cancel',
  'expedite',
  'pan',
  'traffic',
  'when',
  'runway',
]);
/** Where the traffic is: said after its type, not part of it. */
const WHERE = new Set([
  'on',
  'at',
  'short',
  'final',
  'mile',
  'miles',
  'nm',
  'out',
  'passing',
  'now',
  'rolling',
  'airborne',
  'in',
  'of',
  'your',
  'you',
  'ahead',
  'left',
  'right',
  'from',
  'to',
  'the',
  'a',
  'an',
  'is',
  'just',
  'touching',
  'down',
]);
const TRAFFIC_WORD: Record<string, Condition['traffic']> = {
  departing: 'departing',
  departure: 'departing',
  landing: 'landing',
  arriving: 'landing',
  arrival: 'landing',
  inbound: 'landing',
};

/**
 * A traffic description at i: the type ("A320", "Boeing 737"), then where it is (skipped). Ends at the next
 * instruction; "runway 18R" stays part of it unless a clearance follows ("…, runway 24, line up").
 */
function describe(c: Cursor, from: number): { type: string; text: string; next: number } {
  const kind: string[] = [];
  let where = false;
  let i = from;
  for (; i < c.t.length; i++) {
    const k = c.t[i]!;
    if (k.t === 'w' && k.v === 'runway') {
      const r = runwayAt(c, i);
      const after = c.t[r?.next ?? i];
      if (!r || (after?.t === 'w' && CLAUSE.has(after.v))) break;
      i = r.next - 1;
      where = true;
      continue;
    }
    if (k.t === 'w' && CLAUSE.has(k.v)) break;
    // "A320" arrives as "a" "320": a lone letter before a number is part of the type, not an article
    const letter = k.t === 'w' && k.v.length === 1 && !!c.n(i + 1);
    if (!letter && k.t === 'w' && (WHERE.has(k.v) || k.v in TRAFFIC_WORD)) where ||= kind.length > 0;
    else if (!where) kind.push(k.t === 'n' ? k.s : k.v.length === 1 ? k.v.toUpperCase() : k.v);
  }
  const tidy = (s: string) =>
    s
      .replace(/\b(\d{2}) ([lrc])\b/g, (_, n: string, l: string) => n + l.toUpperCase())
      .replace(/\b([a-z]) (\d+)\b/gi, (_, l: string, d: string) => l.toUpperCase() + d)
      .replace(/^(a|an|the) /, '')
      .replace(/\b(boeing|airbus|embraer|pilatus)\b/g, (w) => w[0]!.toUpperCase() + w.slice(1));
  return { type: tidy(kind.join(' ')), text: tidy(c.said(from, i)), next: i };
}

/** "behind the departing A320 [rolling]": the condition of a conditional line-up; "behind" alone repeats it. */
const condition: Matcher = (c) => {
  if (!c.w(c.i, 'behind')) return null;
  const i = c.skip(c.i + 1, 'the', 'a');
  const k = c.t[i];
  const traffic = k?.t === 'w' ? TRAFFIC_WORD[k.v] : undefined;
  if (!traffic) {
    c.condRepeated = !!c.cond;
    return { next: c.i + 1 };
  }
  // "behind departing traffic": no type given
  const d = describe(c, c.skip(i + 1, 'traffic', 'aircraft'));
  c.cond = { condition: { traffic, desc: d.type }, at: c.i };
  return { next: d.next };
};

/** "traffic, A321 on short final": information; the pilot reports it in sight. */
const trafficInfo: Matcher = (c) => {
  if (!c.w(c.i, 'traffic')) return null;
  const d = describe(c, c.skip(c.i + 1, 'information', 'is'));
  return { next: d.next, cmd: { type: 'trafficInfo', desc: d.text } };
};

/** The player's own station name ("Schiphol" is filler): "KLM1200, Schiphol Tower, …". */
const stationName: Matcher = (c) => (c.w(c.i, 'tower') ? { next: c.i + 1 } : null);

const TOWER_MATCHERS: Matcher[] = [
  stationName,
  acknowledge,
  condition,
  trafficInfo,
  whenInfo,
  windInfo,
  land,
  takeoff,
  lineUp,
  cancelTakeoff,
  continueApproach,
  vacate,
  expediteVacate,
  runwayInfo,
];

/** A stray "QNH 1013" on its own is harmless information. */
const qnhInfo: Matcher = (c) => (c.w(c.i, 'qnh') && c.n(c.i + 1) ? { next: c.i + 2 } : null);

const MATCHERS: Matcher[] = [
  identify,
  acknowledge,
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
  const matchers = ctx.role === 'tower' ? [sayAgain, ...TOWER_MATCHERS, ...MATCHERS] : MATCHERS;
  const pending: { cmd: Command; issues: Omit<Issue, 'expected'>[]; at: number }[] = [];
  while (c.i < c.t.length) {
    const k = c.t[c.i]!;
    if (k.t === 'w' && NEGATIVE.has(k.v)) {
      res.negative = true;
      c.i++;
      continue;
    }
    let hit: Hit | null = null;
    for (const match of matchers) if ((hit = match(c))) break;
    if (hit) {
      if (hit.cmd) pending.push({ cmd: hit.cmd, issues: hit.issues ?? [], at: c.i });
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
  if (c.cond) {
    const all = c.said(0, c.t.length);
    const lu = pending.find((p) => p.cmd.type === 'lineUp');
    if (lu?.cmd.type === 'lineUp') {
      lu.cmd.behind = c.cond.condition;
      if (!(c.cond.at < lu.at && c.condRepeated)) lu.issues.push(issue('info', 'conditional-wording', all));
    } else if (pending[0]) pending[0].issues.push(issue('warn', 'conditional-lineup-only', all));
  }
  for (const p of pending) {
    if ((p.cmd.type === 'land' || p.cmd.type === 'takeoff') && !c.wind)
      p.issues.push(issue('info', 'wind-missing', c.said(0, c.t.length)));
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
