/**
 * Phraseology drills (Learn → Practise phrases): a situation, the player says or types the instruction, and the
 * parser checks it against what was asked, with the ICAO phrase as the model answer. No traffic, no sim.
 */
import { EHAM, type Command } from '../core';
import { parse, type AcContext, type ParseContext } from '../phraseology/parser';
import { canonicalTransmission, chip, RULE_TEXT } from '../phraseology/phrases';
import { STUDENT } from './scenarios';

export interface PhraseTask {
  /** What to do, in plain words. */
  prompt: string;
  /** The aircraft as it is now. */
  ac: AcContext;
  /** The instructions that do it. */
  want: Command[];
}

const ac = (o: Partial<AcContext> = {}): AcContext => ({
  callsign: STUDENT,
  alt: 7000,
  hdg: 90,
  ias: 250,
  qnhGiven: false,
  ...o,
});
const RWY = EHAM.config.landing;
const QNH = EHAM.qnh;

export const PHRASE_TASKS: PhraseTask[] = [
  {
    prompt: `${STUDENT} calls you for the first time: “Schiphol Approach, ${STUDENT}, flight level 70, information Bravo”. Answer it.`,
    ac: ac(),
    want: [{ type: 'identify' }],
  },
  {
    prompt: `${STUDENT} is at FL070. Clear it down to 3000 ft. It has not had the QNH yet.`,
    ac: ac(),
    want: [{ type: 'altitude', altitude: 3000, fl: false, qnh: QNH }],
  },
  {
    prompt: `${STUDENT} is at FL070. Clear it down to FL060.`,
    ac: ac(),
    want: [{ type: 'altitude', altitude: 6000, fl: true }],
  },
  {
    prompt: `${STUDENT} is heading 090. Turn it right, onto a heading of 180.`,
    ac: ac(),
    want: [{ type: 'heading', heading: 180, turn: 'right' }],
  },
  {
    prompt: `${STUDENT} is flying 250 kt. Slow it to 220 knots.`,
    ac: ac(),
    want: [{ type: 'speed', speed: 220 }],
  },
  {
    prompt: `${STUDENT} is on base, heading 270, at 2000 ft. Turn it left onto heading 210 and clear it for the ILS approach runway ${RWY}, in one call.`,
    ac: ac({ alt: 2000, hdg: 270, ias: 200, qnhGiven: true }),
    want: [
      { type: 'heading', heading: 210, turn: 'left' },
      { type: 'ils', runway: RWY },
    ],
  },
  {
    prompt: `${STUDENT} is established on the localizer. Hand it over to Tower.`,
    ac: ac({ alt: 2000, hdg: 183, ias: 180, qnhGiven: true }),
    want: [{ type: 'handoff', to: 'tower' }],
  },
  {
    prompt: `Send ${STUDENT} straight to the fix ARTIP.`,
    ac: ac(),
    want: [{ type: 'direct', fix: 'ARTIP' }],
  },
  {
    prompt: `The sequence is full. Put ${STUDENT} in the published hold at SUGOL.`,
    ac: ac(),
    want: [{ type: 'hold', fix: 'SUGOL' }],
  },
  {
    prompt: `${STUDENT} is at FL070 and must get below another aircraft quickly. Clear it to FL050 and tell it to hurry.`,
    ac: ac(),
    want: [
      { type: 'altitude', altitude: 5000, fl: true },
      { type: 'expedite', climb: false },
    ],
  },
  {
    prompt: `On final, keep ${STUDENT} at 160 knots until 4 miles from the runway.`,
    ac: ac({ alt: 2000, hdg: 183, ias: 180, qnhGiven: true }),
    want: [{ type: 'speed', speed: 160, untilDme: 4 }],
  },
  {
    prompt: `You are not sure ${STUDENT} read back the right level. Ask it what level it is at.`,
    ac: ac({ alt: 5400, qnhGiven: true }),
    want: [{ type: 'report', what: 'level' }],
  },
  {
    prompt: `${STUDENT} is heading 090. Turn it 20 degrees to the left, as a relative turn.`,
    ac: ac(),
    want: [{ type: 'heading', heading: 70, turn: 'left', by: 20 }],
  },
];

export const drillContext = (t: PhraseTask): ParseContext => ({ airport: EHAM, qnh: QNH, aircraft: [t.ac] });

/** The model answer: the ICAO phrase for the task. */
export const modelAnswer = (t: PhraseTask) => canonicalTransmission(STUDENT, t.want, drillContext(t));

export interface DrillResult {
  /** correct: right instructions in ICAO wording; understood: right instructions, wording off; wrong: not what was asked. */
  verdict: 'correct' | 'understood' | 'wrong';
  /** Chips for what the parser understood. */
  heard: string[];
  /** What to change, in words. */
  notes: string[];
}

/** Key-order-free comparison of command lists; a missing or wrong QNH is a wording note, not a wrong answer. */
const key = (cmds: readonly Command[]) =>
  JSON.stringify(
    cmds.map((c) =>
      Object.fromEntries(
        Object.entries(c)
          .filter(([k]) => k !== 'qnh')
          .sort(([a], [b]) => a.localeCompare(b)),
      ),
    ),
  );

export function checkPhrase(text: string, t: PhraseTask): DrillResult {
  const r = parse(text, drillContext(t));
  const notes = [
    ...new Set(
      r.issues
        .filter((i) => i.rule !== 'unknown-words')
        .map((i) => RULE_TEXT[i.rule] ?? i.expected)
        .filter(Boolean),
    ),
  ];
  const same = r.callsign === STUDENT && key(r.commands) === key(t.want);
  return {
    verdict: !same ? 'wrong' : notes.length ? 'understood' : 'correct',
    heard: r.commands.map(chip),
    notes,
  };
}
