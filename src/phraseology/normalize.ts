/** Text → tokens. Shared by the callsign matcher (raw words) and the command parser (merged numbers). */

export const DIGITS: Record<string, string> = {
  zero: '0',
  oh: '0',
  one: '1',
  won: '1',
  wun: '1',
  two: '2',
  three: '3',
  tree: '3',
  four: '4',
  fower: '4',
  five: '5',
  fife: '5',
  six: '6',
  seven: '7',
  eight: '8',
  ait: '8',
  ate: '8',
  nine: '9',
  niner: '9',
};
const TEENS: Record<string, string> = {
  ten: '10',
  eleven: '11',
  twelve: '12',
  thirteen: '13',
  fourteen: '14',
  fifteen: '15',
  sixteen: '16',
  seventeen: '17',
  eighteen: '18',
  nineteen: '19',
};
const TENS: Record<string, string> = {
  twenty: '2',
  thirty: '3',
  forty: '4',
  fourty: '4',
  fifty: '5',
  sixty: '6',
  seventy: '7',
  eighty: '8',
  ninety: '9',
};
export const PHONETIC: Record<string, string> = {
  alfa: 'a',
  alpha: 'a',
  bravo: 'b',
  charlie: 'c',
  delta: 'd',
  echo: 'e',
  foxtrot: 'f',
  golf: 'g',
  hotel: 'h',
  india: 'i',
  juliett: 'j',
  juliet: 'j',
  kilo: 'k',
  lima: 'l',
  mike: 'm',
  november: 'n',
  oscar: 'o',
  papa: 'p',
  quebec: 'q',
  romeo: 'r',
  sierra: 's',
  tango: 't',
  uniform: 'u',
  victor: 'v',
  whiskey: 'w',
  whisky: 'w',
  xray: 'x',
  yankee: 'y',
  zulu: 'z',
};
/** Homophones that are digits only in a numeric context. */
const HOMOPHONE: Record<string, string> = { to: '2', too: '2', for: '4' };

/** Common ASR mishearings and spelling variants → canonical keyword. Applied per word. */
const WORD_FIX: Record<string, string> = {
  tousand: 'thousand',
  thousands: 'thousand',
  hundreds: 'hundred',
  descent: 'descend',
  decent: 'descend',
  descending: 'descend',
  descends: 'descend',
  dissent: 'descend',
  climbing: 'climb',
  clime: 'climb',
  climbed: 'climb',
  hitting: 'heading',
  hedding: 'heading',
  headings: 'heading',
  hdg: 'heading',
  attitude: 'altitude',
  altitudes: 'altitude',
  alt: 'altitude',
  knot: 'knots',
  nots: 'knots',
  notes: 'knots',
  nods: 'knots',
  kts: 'knots',
  kt: 'knots',
  write: 'right',
  rite: 'right',
  centre: 'center',
  cleared: 'cleared',
  clear: 'cleared',
  clearance: 'cleared',
  isles: 'ils',
  aisles: 'ils',
  mile: 'miles',
  nm: 'miles',
  dme: 'miles',
  till: 'until',
  til: 'until',
  proceeding: 'proceed',
  maintained: 'maintain',
  maintaining: 'maintain',
  directly: 'direct',
  contacts: 'contact',
  identify: 'identified',
  feet: 'feet',
  foot: 'feet',
  ft: 'feet',
  level: 'level',
  levels: 'level',
  tower: 'tower',
  towers: 'tower',
  point: 'decimal',
  dot: 'decimal',
  slowdown: 'slow',
};

/** Multi-word fixes applied to the cleaned string before tokenising. */
const PHRASE_FIX: [RegExp, string][] = [
  [/\bx[- ]ray\b/g, 'xray'],
  [/\bflight levels?\b/g, 'fl'],
  [/\bf l\b/g, 'fl'],
  [/\bq (and|n|an|in) h\b/g, 'qnh'],
  [/\bqueue? (and|n|an) h\b/g, 'qnh'],
  [/\b(i|eye) l s\b/g, 'ils'],
  [/\bi ls\b/g, 'ils'],
  [/\bthe send\b/g, 'descend'],
  [/\bthis and\b/g, 'descend'],
  [/\brun way\b/g, 'runway'],
  [/\bgo round\b/g, 'go around'],
  [/\bgoing around\b/g, 'go around'],
  [/\bsay it again\b/g, 'say again'],
  [/\bschiphol (approach|arrival)\b/g, ' '],
  [/\bthank you\b/g, ' '],
  [/\bgood (morning|afternoon|evening|day|night)\b/g, ' '],
  [/\bhold short\b/g, 'holdshort'],
];

const FILLER = new Set([
  'uh',
  'um',
  'uhm',
  'er',
  'erm',
  'ah',
  'please',
  'sir',
  'thanks',
  'okay',
  'ok',
  'hello',
  'hi',
  'schiphol',
  'amsterdam',
  'goedemorgen',
  'goedemiddag',
  'goedenavond',
  'bye',
  'goodbye',
]);

/** Lower-case words, letters and digit groups split apart; filler removed; common mishearings fixed. */
export function words(text: string): string[] {
  let s = text
    .toLowerCase()
    .replace(/['’`]/g, '')
    .replace(/(\d),(\d{3})\b/g, '$1$2')
    .replace(/(\d)\.(\d)/g, '$1 decimal $2')
    .replace(/[^a-z0-9]+/g, ' ');
  for (const [re, to] of PHRASE_FIX) s = s.replace(re, to);
  // Whisper copies "18R" from the prompt: "heading two seven zero" → "27L", "flight level seven zero" → "7L",
  // "7R0" or "70R". The letter is a lost "zero", unless that gives an impossible heading or level (above FL110).
  s = s.replace(
    /\b(heading|fl)( to)? (\d{1,3})[lr](\d?)\b/g,
    (_, kw: string, to = '', n: string, d: string) => {
      const zero = n + '0';
      return `${kw}${to} ${d ? n + d : +zero <= (kw === 'fl' ? 110 : 360) ? zero : n}`;
    },
  );
  const out: string[] = [];
  for (const raw of s.match(/[a-z]+|\d+/g) ?? []) {
    const w = WORD_FIX[raw] ?? raw;
    if (!FILLER.has(w)) out.push(w);
  }
  return out;
}

export type Tok =
  | { t: 'w'; v: string }
  /** `s` is the digit string as spoken/typed (keeps leading zeros and the decimal point). */
  | { t: 'n'; v: number; s: string };

const isDigitish = (w: string | undefined): boolean =>
  w !== undefined && (/^\d+$/.test(w) || w in DIGITS || w in TEENS || w in TENS);
const isScale = (w: string | undefined) => w === 'thousand' || w === 'hundred';

/** Is the homophone at `i` ("to", "too", "for") really a digit? */
function homophoneIsDigit(ws: readonly string[], i: number, inRun: boolean): boolean {
  const next = ws[i + 1];
  if (isScale(next)) return true; // "descend to thousand" = 2000
  if (ws[i] === 'for' && next === 'miles') return true; // "until for miles"
  return inRun && isDigitish(next); // "one to zero"
}

/** Merge number words into numeric tokens: "two seven zero" → 270, "three thousand five hundred" → 3500. */
export function tokens(ws: readonly string[]): Tok[] {
  const out: Tok[] = [];
  let i = 0;
  while (i < ws.length) {
    const w = ws[i]!;
    const starts = isDigitish(w) || (w in HOMOPHONE && homophoneIsDigit(ws, i, false));
    if (!starts) {
      out.push({ t: 'w', v: w });
      i++;
      continue;
    }
    let thousands = 0;
    let sawThousand = false;
    let cur = '';
    for (; i < ws.length; i++) {
      const x = ws[i]!;
      if (/^\d+$/.test(x)) cur += x;
      else if (x in DIGITS) cur += DIGITS[x];
      else if (x in TEENS) cur += TEENS[x];
      else if (x in TENS) {
        const nx = ws[i + 1];
        if (nx !== undefined && nx in DIGITS && DIGITS[nx] !== '0') {
          cur += TENS[x]! + DIGITS[nx];
          i++;
        } else cur += TENS[x] + '0';
      } else if (x === 'hundred' && cur && !cur.includes('.')) cur += '00';
      else if (x === 'thousand' && cur && !sawThousand && !cur.includes('.')) {
        thousands = parseInt(cur, 10) * 1000;
        sawThousand = true;
        cur = '';
      } else if (x in HOMOPHONE && homophoneIsDigit(ws, i, cur !== '')) cur += HOMOPHONE[x];
      else if (x === 'decimal' && cur && !cur.includes('.') && isDigitish(ws[i + 1])) cur += '.';
      else break;
    }
    const v = thousands + (cur ? parseFloat(cur) : 0);
    out.push({ t: 'n', v, s: sawThousand ? String(v) : cur });
  }
  return out;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++)
      cur[j] = Math.min(prev[j]! + 1, cur[j - 1]! + 1, prev[j - 1]! + (a[i - 1] === b[j - 1] ? 0 : 1));
    prev = cur;
  }
  return prev[b.length]!;
}

/** 1 = identical, 0 = nothing in common. */
export const similarity = (a: string, b: string): number =>
  a.length || b.length ? 1 - levenshtein(a, b) / Math.max(a.length, b.length) : 1;

/** Words for the callsign region → compact string. `spell` maps every phonetic word to its letter. */
export function compact(ws: readonly string[], spell: boolean): string {
  let s = '';
  let seenDigit = false;
  ws.forEach((w, i) => {
    if (/^\d+$/.test(w) || w in DIGITS || w in TEENS) {
      s += /^\d+$/.test(w) ? w : (DIGITS[w] ?? TEENS[w]);
      seenDigit = true;
    } else if (w in TENS) {
      s += TENS[w] + (ws[i + 1]! in DIGITS ? '' : '0');
      seenDigit = true;
    } else if (w in HOMOPHONE && (seenDigit || isDigitish(ws[i + 1]))) s += HOMOPHONE[w];
    else if (w in PHONETIC && (spell || seenDigit)) s += PHONETIC[w];
    else s += w;
  });
  return s;
}
