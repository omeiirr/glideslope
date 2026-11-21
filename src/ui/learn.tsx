import type { FunctionComponent } from 'preact';
import { useState } from 'preact/hooks';
import { EHAM, runwayById, transitionLevel, wakeMinimum, type Command, type Wake } from '../core';
import { STUDENT } from '../game/scenarios';
import { spell, spokenCallsign } from '../phraseology/callsign';
import type { AcContext } from '../phraseology/parser';
import { controllerPhrase, readback, RULE_TEXT, spokenAltitude, type Phrase } from '../phraseology/phrases';
import type { VoiceInput } from '../speech/voiceInput';
import { PhraseDrill } from './drills';
import { useDialog } from './overlays';

/** Speak a phrase in a pilot voice (no-op when voices are off). */
export type Say = (p: Phrase) => void;

const env = { airport: EHAM, qnh: EHAM.qnh };
/** Example aircraft for command phrases: level at FL070, heading east, 250 kt, no QNH given yet. */
const AC = { callsign: STUDENT, alt: 7000, hdg: 90, ias: 250, qnhGiven: false };
const APP = EHAM.frequencies.approach;
const TWR = EHAM.frequencies.tower;
const RADAR = EHAM.frequencies.radar;
const TA = EHAM.transitionAltitudeFt;
const TL = transitionLevel(EHAM, EHAM.qnh);

function Listen({ p, say }: { p: Phrase; say: Say }) {
  return (
    <button
      type="button"
      class="listen"
      aria-label={`Listen: ${p.text}`}
      title="Listen"
      onClick={() => say(p)}
    >
      ▶
    </button>
  );
}

/** A written example and how it sounds, with a listen button. */
function Ex({ p, say, label }: { p: Phrase; say: Say; label?: string }) {
  return (
    <div class="ex">
      {label && <span class="ex-label">{label}</span>}
      <span class="mono">{p.text}</span>
      {p.speech !== p.text && <span class="ex-say">“{p.speech}”</span>}
      <Listen p={p} say={say} />
    </div>
  );
}

// ------------------------------------------------------------------ 1. numbers and letters

/** ICAO Annex 10 Vol II §5.2.1.4: capitals mark the stressed syllable. */
const DIGITS: [string, string][] = [
  ['0', 'ZE-RO'],
  ['1', 'WUN'],
  ['2', 'TOO'],
  ['3', 'TREE'],
  ['4', 'FOW-er'],
  ['5', 'FIFE'],
  ['6', 'SIX'],
  ['7', 'SEV-en'],
  ['8', 'AIT'],
  ['9', 'NIN-er'],
  ['.', 'DAY-SEE-MAL (decimal)'],
  ['100', 'HUN-dred'],
  ['1000', 'TOU-SAND'],
];
const LETTERS: [string, string, string][] = [
  ['A', 'Alfa', 'AL-fah'],
  ['B', 'Bravo', 'BRAH-voh'],
  ['C', 'Charlie', 'CHAR-lee'],
  ['D', 'Delta', 'DELL-tah'],
  ['E', 'Echo', 'ECK-oh'],
  ['F', 'Foxtrot', 'FOKS-trot'],
  ['G', 'Golf', 'GOLF'],
  ['H', 'Hotel', 'hoh-TELL'],
  ['I', 'India', 'IN-dee-ah'],
  ['J', 'Juliett', 'JEW-lee-ETT'],
  ['K', 'Kilo', 'KEY-loh'],
  ['L', 'Lima', 'LEE-mah'],
  ['M', 'Mike', 'MIKE'],
  ['N', 'November', 'no-VEM-ber'],
  ['O', 'Oscar', 'OSS-cah'],
  ['P', 'Papa', 'pah-PAH'],
  ['Q', 'Quebec', 'keh-BECK'],
  ['R', 'Romeo', 'ROW-me-oh'],
  ['S', 'Sierra', 'see-AIR-rah'],
  ['T', 'Tango', 'TANG-go'],
  ['U', 'Uniform', 'YOU-nee-form'],
  ['V', 'Victor', 'VIK-tah'],
  ['W', 'Whiskey', 'WISS-key'],
  ['X', 'X-ray', 'ECKS-ray'],
  ['Y', 'Yankee', 'YANG-key'],
  ['Z', 'Zulu', 'ZOO-loo'],
];

function Basics({ say }: { say: Say }) {
  return (
    <>
      <p>
        Radio is noisy and many pilots don't speak English as a first language, so aviation uses a fixed way
        of saying numbers and letters. Say each digit separately, and use the ICAO pronunciation, especially
        for <b>three</b> (“tree”), <b>five</b> (“fife”) and <b>nine</b> (“niner”), which are easy to confuse.
      </p>
      <h3>Numbers</h3>
      <div class="ref-grid">
        {DIGITS.map(([d, how]) => (
          <div class="ref-cell">
            <b class="mono">{d}</b>
            <span>{how}</span>
          </div>
        ))}
      </div>
      <h3>Phonetic alphabet</h3>
      <div class="ref-grid">
        {LETTERS.map(([l, word, how]) => (
          <button
            type="button"
            class="ref-cell"
            onClick={() => say({ text: word, speech: `${l}, as in ${word}.` })}
            aria-label={`${l}: ${word}, said ${how}. Listen.`}
          >
            <b class="mono">{l}</b>
            <span>{word}</span>
            <small>{how}</small>
          </button>
        ))}
      </div>
      <p class="dim">Capitals mark the stressed syllable. Click a letter to hear it.</p>
    </>
  );
}

// ------------------------------------------------------------------ 2. saying values

const p = (text: string, speech: string): Phrase => ({ text, speech });

function Values({ say }: { say: Say }) {
  const rwy = EHAM.config.landing;
  const rows: [string, Phrase, string][] = [
    ['Heading', p('heading 090', `heading ${spell('090')}`), 'Always three digits, each said separately.'],
    ['Speed', p('180 knots', `${spell('180')} knots`), 'Digits separately, then “knots”.'],
    [
      'Altitude',
      p('altitude 2500', `altitude ${spokenAltitude(2500)}`),
      'Thousands and hundreds: “two thousand five hundred”.',
    ],
    [
      'Altitude',
      p('altitude 11000', `altitude ${spokenAltitude(11000)}`),
      'Each digit of the thousands: “one one thousand”.',
    ],
    ['Flight level', p('flight level 70', `flight level ${spell('70')}`), 'Digits separately.'],
    [
      'Flight level',
      p('flight level 100', 'flight level one hundred'),
      'Whole hundreds may be said as “one hundred”.',
    ],
    [
      'QNH',
      p(`QNH ${EHAM.qnh}`, `Q N H ${spell(String(EHAM.qnh))}`),
      'Pressure in hectopascals, digits separately.',
    ],
    ['QNH', p('QNH 998', `Q N H ${spell('998')}`), 'Below 1000 it has three digits.'],
    [
      'Runway',
      p(`runway ${rwy}`, `runway ${spell(rwy.slice(0, 2))} right`),
      'Two digits, then left, right or center.',
    ],
    ['Frequency', p(TWR.mhz, spell(TWR.mhz)), 'Digits separately, “decimal” for the point.'],
  ];
  const callsigns = ['KLM1426', 'BAW432', 'EZY45MP', 'DLH9LK', 'TRA6015'];
  return (
    <>
      <p>
        Each kind of value has its own pattern. When you say a value the standard way, the pilot (and the
        speech recogniser) is much more likely to get it right first time.
      </p>
      <table class="ref">
        <tbody>
          {rows.map(([kind, ph, note]) => (
            <tr>
              <th scope="row">{kind}</th>
              <td>
                <Ex p={ph} say={say} />
              </td>
              <td class="dim">{note}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h3>Callsigns</h3>
      <p>
        An airline callsign is the airline's <i>telephony designator</i> followed by the flight number, digits
        and letters said separately. You may also spell the three-letter code (“Kilo Lima Mike …”); the game
        accepts both.
      </p>
      {callsigns.map((cs) => (
        <Ex p={p(cs, spokenCallsign(cs, EHAM.airlines))} say={say} />
      ))}
      <table class="ref compact">
        <caption>Telephony designators in this game</caption>
        <tbody>
          {EHAM.airlines.map((a) => (
            <tr>
              <th scope="row" class="mono">
                {a.icao}
              </th>
              <td>“{a.telephony}”</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

// ------------------------------------------------------------------ 3. commands

interface CommandDoc {
  title: string;
  cmds: Command[];
  note: string;
  /** Hand-written instead of generated (e.g. "negative"). */
  custom?: { you: Phrase; pilot: Phrase | null };
}

const CS_SPOKEN = spokenCallsign(STUDENT, EHAM.airlines);
const COMMANDS: CommandDoc[] = [
  {
    title: 'Answer a check-in',
    cmds: [{ type: 'identify' }],
    note: 'When a pilot first calls you, confirm you see them on radar. Add an instruction in the same call if you like.',
    custom: {
      you: p(`${STUDENT}, ${APP.name}, identified`, `${CS_SPOKEN}, ${APP.name}, identified`),
      pilot: p(`Roger, ${STUDENT}`, `Roger, ${CS_SPOKEN}`),
    },
  },
  {
    title: 'Turn',
    cmds: [{ type: 'heading', heading: 210, turn: 'right' }],
    note: 'Give the direction of turn and a three-digit heading. Without a direction, the pilot takes the shorter way.',
  },
  {
    title: 'Turn by a number of degrees',
    cmds: [{ type: 'heading', heading: 70, turn: 'left', by: 20 }],
    note: 'A small correction from the present heading, e.g. to fine-tune the spacing on final.',
  },
  {
    title: 'Keep the current heading',
    cmds: [{ type: 'presentHeading' }],
    note: 'Stops a turn, or leaves a route or hold.',
  },
  {
    title: 'Descend to a flight level',
    cmds: [{ type: 'altitude', altitude: 5000, fl: true }],
    note: `Above the transition level (FL${String(TL).padStart(3, '0')} today) use flight levels.`,
  },
  {
    title: 'Descend to an altitude',
    cmds: [{ type: 'altitude', altitude: 3000, fl: false, qnh: EHAM.qnh }],
    note: `At or below ${TA} ft use “altitude”, and give the QNH with the first such clearance.`,
  },
  {
    title: 'Pass a new QNH',
    cmds: [{ type: 'qnh', qnh: EHAM.qnh }],
    note: `In longer sessions the weather changes: the log announces a new ATIS letter, QNH and wind. Pilots then need the new QNH: give it with the next clearance to an altitude, and on its own to aircraft already at or below ${TA} ft.`,
  },
  {
    title: 'Expedite a climb or descent',
    cmds: [
      { type: 'altitude', altitude: 5000, fl: true },
      { type: 'expedite', climb: false },
    ],
    note: 'The pilot climbs or descends about one and a half times faster than normal until reaching the level. Useful to solve a conflict quickly.',
  },
  {
    title: 'Rate of climb or descent',
    cmds: [
      { type: 'altitude', altitude: 5000, fl: true },
      { type: 'rate', fpm: 2000, limit: 'greater' },
    ],
    note: '“Or greater” sets a minimum rate, “or less” a maximum. It applies until the aircraft reaches the level; a pilot refuses a rate the aircraft cannot fly.',
  },
  {
    title: 'Reduce speed',
    cmds: [{ type: 'speed', speed: 220 }],
    note: '“Reduce” or “increase” must match the change.',
  },
  {
    title: 'Speed on final',
    cmds: [{ type: 'speed', speed: 180, untilDme: 4 }],
    note: 'Keeps arrivals moving on final; after 4 miles the pilot slows to the landing speed.',
  },
  {
    title: 'Cancel a speed restriction',
    cmds: [{ type: 'resumeSpeed' }],
    note: 'The pilot flies their own speeds again. “No ATC speed restrictions” means the same.',
  },
  {
    title: 'Slowest approach speed',
    cmds: [{ type: 'minimumSpeed' }],
    note: 'The pilot slows to the final approach speed of the type: the most you can slow an aircraft.',
  },
  {
    title: 'Go direct to a fix',
    cmds: [{ type: 'direct', fix: 'ARTIP' }],
    note: 'Say the fix name as it is written on the scope.',
  },
  {
    title: 'Hold',
    cmds: [{ type: 'hold', fix: 'ARTIP' }],
    note: 'The pilot flies the published racetrack pattern over the fix until you give a new instruction.',
  },
  {
    title: 'Clear the ILS approach',
    cmds: [
      { type: 'heading', heading: 210, turn: 'left' },
      { type: 'ils', runway: EHAM.config.landing },
    ],
    note: 'Usually combined with a heading that intercepts the final at 30° or less. Always include the runway.',
  },
  {
    title: 'Hand off to Tower',
    cmds: [{ type: 'handoff', to: 'tower' }],
    note: 'Once the aircraft is established on the localizer. Include the frequency.',
  },
  {
    title: 'Hand off a departure',
    cmds: [{ type: 'handoff', to: 'radar' }],
    note: `Departures climb out to the edge of your airspace; pass them to ${RADAR.name}.`,
  },
  {
    title: 'Go around',
    cmds: [{ type: 'goAround' }],
    note: 'Breaks off the approach; the pilot climbs straight ahead to 2000 ft.',
  },
  {
    title: 'Correct a wrong readback',
    cmds: [],
    note: 'In Professional mode a pilot sometimes reads back a wrong value: a heading, level or speed, and in the tower a runway or exit. Say “negative” and repeat the correct instruction.',
    custom: {
      you: p(
        `${STUDENT}, negative, descend altitude 3000`,
        `${CS_SPOKEN}, negative, descend altitude ${spokenAltitude(3000)}`,
      ),
      pilot: p(`Descend altitude 3000, ${STUDENT}`, `Descend altitude ${spokenAltitude(3000)}, ${CS_SPOKEN}`),
    },
  },
  {
    title: 'Check a heading, level or speed',
    cmds: [{ type: 'report', what: 'level' }],
    note: '“Report heading”, “report level” or “report speed”: the pilot tells you what the aircraft is actually doing. Handy when a readback sounded wrong.',
  },
  {
    title: 'Priority: PAN PAN or minimum fuel',
    cmds: [{ type: 'acknowledge', what: 'pan' }],
    note: 'Now and then an arrival calls in with “PAN PAN” (a medical emergency on board) or ends its call with “minimum fuel” (it can accept no delay). Acknowledge it (“roger PAN”, “roger minimum fuel”), then take it the shortest way to the runway, ahead of the others. The strip and data block show PAN or MIN FUEL. In Professional mode its delay counts three times, and a go-around costs extra; in the tower, Approach tells you on the landline, and a go-around costs extra there too.',
  },
  {
    title: 'Ask for a repeat',
    cmds: [],
    note: 'If you missed what a pilot said, they repeat their last transmission.',
    custom: { you: p(`${STUDENT}, say again`, `${CS_SPOKEN}, say again`), pilot: null },
  },
];

const MISTAKES = [
  'qnh-missing',
  'fl-below-tl',
  'faa-and-maintain',
  'to-before-number',
  'heading-3-digits',
  'heading-direction',
  'ils-runway-missing',
];

function CommandDocs({
  docs,
  env,
  ac,
  say,
}: {
  docs: CommandDoc[];
  env: Parameters<typeof controllerPhrase>[2];
  ac?: AcContext;
  say: Say;
}) {
  return (
    <>
      {docs.map((c) => {
        const you = c.custom?.you ?? controllerPhrase(STUDENT, c.cmds, env, ac);
        const pilot = c.custom ? c.custom.pilot : readback(STUDENT, c.cmds, env, ac);
        return (
          <section class="cmd-doc">
            <h3>{c.title}</h3>
            <Ex label="You" p={you} say={say} />
            {pilot && <Ex label="Pilot" p={pilot} say={say} />}
            <p class="dim">{c.note}</p>
          </section>
        );
      })}
    </>
  );
}

function Commands({ say }: { say: Say }) {
  return (
    <>
      <p>
        Every transmission starts with the <b>callsign</b>, then one or more instructions. The pilot reads the
        instructions back and ends with their callsign. Listen to the readback: it is your only check that
        they heard you right. Below, each example is followed by the pilot's readback.
      </p>
      <CommandDocs docs={COMMANDS} env={env} ac={AC} say={say} />
      <h3>Combining instructions</h3>
      <Ex
        label="You"
        p={controllerPhrase(
          STUDENT,
          [
            { type: 'heading', heading: 210, turn: 'left' },
            { type: 'altitude', altitude: 2000, fl: false, qnh: EHAM.qnh },
            { type: 'speed', speed: 180 },
          ],
          env,
          AC,
        )}
        say={say}
      />
      <p class="dim">
        Up to three or four instructions in one call is normal. More than that, and readbacks start to go
        wrong.
      </p>
      <h3>Common mistakes the game points out</h3>
      <ul>
        {MISTAKES.map((r) => (
          <li>{RULE_TEXT[r]}</li>
        ))}
      </ul>
    </>
  );
}

// ------------------------------------------------------------------ 4. levels and altimetry

function Levels({ say }: { say: Say }) {
  const tl = (fl: number) => `FL${String(fl).padStart(3, '0')}`;
  const table = [...EHAM.transitionLevels].reverse();
  return (
    <>
      <p>
        An altimeter measures air pressure, and pressure changes with the weather. So everyone must agree on
        which pressure their altimeter is set to, otherwise two aircraft both “at 3000 feet” could be hundreds
        of feet apart.
      </p>
      <dl class="defs">
        <dt>QNH</dt>
        <dd>
          The local pressure setting (in hectopascals) that makes the altimeter read height above sea level.
          Today at {EHAM.name} it is {EHAM.qnh}. Near the ground everyone uses QNH, so heights match the
          terrain and the charts.
        </dd>
        <dt>Altitude</dt>
        <dd>
          Height above sea level, in feet, with the altimeter set to QNH. Said as “altitude three thousand”.
        </dd>
        <dt>Flight level</dt>
        <dd>
          Higher up, every aircraft sets the same standard pressure, 1013.2 hPa, so they all measure against
          the same reference whatever the local weather. The reading in hundreds of feet is the flight level:
          FL070 is “7000 feet” on standard pressure.
        </dd>
        <dt>Transition altitude</dt>
        <dd>
          The altitude at or below which you use altitudes. At {EHAM.name} it is fixed at <b>{TA} ft</b>.
          Climbing through it, pilots switch to standard pressure.
        </dd>
        <dt>Transition level</dt>
        <dd>
          The lowest flight level you may use. It depends on the QNH so that there is always a safe gap above
          the transition altitude. Today it is <b>{tl(TL)}</b>. Descending through it, pilots switch to QNH.
        </dd>
        <dt>Transition layer</dt>
        <dd>The gap between the two. Don't clear aircraft to level off inside it.</dd>
      </dl>
      <table class="ref compact">
        <caption>Transition level by QNH (simplified table used in this game)</caption>
        <thead>
          <tr>
            <th scope="col">QNH</th>
            <th scope="col">Transition level</th>
          </tr>
        </thead>
        <tbody>
          {table.map((row, i) => {
            const upper = i === 0 ? null : table[i - 1]!.minQnh - 1;
            return (
              <tr>
                <td>
                  {upper === null
                    ? `${row.minQnh} or higher`
                    : row.minQnh === 0
                      ? `below ${upper + 1}`
                      : `${row.minQnh}–${upper}`}
                </td>
                <td class="mono">{tl(row.fl)}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
      <h3>Which word to use</h3>
      <ul>
        <li>
          Cleared level at or below {TA} ft: say <b>altitude</b>, and give the QNH the first time.
        </li>
        <li>
          Cleared level at or above {tl(TL)}: say <b>flight level</b>.
        </li>
        <li>Use “climb” or “descend” to match the direction, never just a number.</li>
      </ul>
      <Ex
        label="Arrival at FL070"
        p={controllerPhrase(
          STUDENT,
          [{ type: 'altitude', altitude: 3000, fl: false, qnh: EHAM.qnh }],
          env,
          AC,
        )}
        say={say}
      />
      <Ex
        label="Departure"
        p={controllerPhrase('TRA6015', [{ type: 'altitude', altitude: 10000, fl: true }], env, {
          ...AC,
          callsign: 'TRA6015',
          alt: 2500,
        })}
        say={say}
      />
    </>
  );
}

// ------------------------------------------------------------------ 5. approach concepts

const WAKES: Wake[] = ['J', 'H', 'M', 'L'];
const WAKE_NAME: Record<Wake, string> = { J: 'Super (A380)', H: 'Heavy', M: 'Medium', L: 'Light' };

function Approach() {
  return (
    <>
      <p>
        As approach controller you take arrivals from the edge of the airspace, line them up one behind the
        other, and hand each one to Tower on the final approach.
      </p>
      <dl class="defs">
        <dt>Radar vectors</dt>
        <dd>
          Headings, levels and speeds you give to steer aircraft, instead of letting them fly a published
          route.
        </dd>
        <dt>Initial approach fix (IAF)</dt>
        <dd>
          Where arrivals enter your airspace: {EHAM.stars.map((s) => s.iaf).join(', ')}. Each has a published
          hold for when you need to delay traffic.
        </dd>
        <dt>ILS</dt>
        <dd>
          The instrument landing system guides aircraft to the runway with two radio beams: the{' '}
          <b>localizer</b> (left and right, along the extended centreline) and the <b>glideslope</b> (up and
          down, a 3° descent, about 300 ft per mile). On the scope, the dashed line north of runway{' '}
          {EHAM.config.landing} is the localizer, with ticks every 5 miles.
        </dd>
        <dt>Intercepting the localizer</dt>
        <dd>
          Turn the aircraft onto a heading that crosses the localizer at <b>30° or less</b>, about 8–12 miles
          out, at around 2000–3000 ft so it meets the glideslope from below. Clear it for the ILS approach at
          the same time; it then turns onto the localizer and descends by itself. “Established” means it is
          tracking the localizer.
        </dd>
        <dt>Speed control</dt>
        <dd>
          A typical sequence: 250 kt at the IAF, 220 kt on the downwind, 180 kt when turning onto final, then
          “maintain 180 knots until 4 miles final”. Faster aircraft behind slower ones close the gap; slow the
          leader later or the follower earlier.
        </dd>
        <dt>Separation</dt>
        <dd>
          Keep aircraft at least <b>3 NM</b> apart horizontally or <b>1000 ft</b> vertically. Either one is
          enough. To see the 3 NM, select an aircraft and press <kbd>H</kbd> (or the Halo button): a ring of
          that radius follows it on the scope.
        </dd>
        <dt>Wake turbulence</dt>
        <dd>
          Big aircraft leave strong vortices behind them. On final, a lighter aircraft behind a heavier one
          needs extra distance:
        </dd>
      </dl>
      <table class="ref compact">
        <caption>Minimum spacing on final, in NM (ICAO Doc 4444)</caption>
        <thead>
          <tr>
            <th scope="col">Leader ↓ / follower →</th>
            {WAKES.map((w) => (
              <th scope="col">{WAKE_NAME[w]}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {WAKES.map((lead) => (
            <tr>
              <th scope="row">{WAKE_NAME[lead]}</th>
              {WAKES.map((f) => (
                <td class="mono">{wakeMinimum(lead, f)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      <p class="dim">The wake category is shown after the type on each strip, e.g. B738/M or A332/H.</p>
      <dl class="defs">
        <dt>Readback and hearback</dt>
        <dd>
          Pilots read back headings, levels, speeds, clearances and frequencies. Your job is to listen and
          correct any mistake straight away. A wrong value that goes unnoticed is one of the classic causes of
          incidents.
        </dd>
        <dt>Handoff</dt>
        <dd>
          Once an arrival is established, send it to {TWR.name} on {TWR.mhz}. After that it no longer hears
          you. Departures go to {RADAR.name} on {RADAR.mhz} as they leave your airspace.
        </dd>
        <dt>Go-around</dt>
        <dd>
          If the approach isn't stable (too high, too fast, not established), the aircraft climbs away on
          runway heading to 2000 ft and comes back on your frequency for another try.
        </dd>
      </dl>
    </>
  );
}

// ------------------------------------------------------------------ 5b. procedure

/** px per NM in the pattern diagram; the final runs up from the runway (north up). */
const PX = 13;
const RWY_Y = 262;
const X0 = 180;

/** One side of the pattern: downwind 6 NM out, base at 14 NM, 30° intercept from 3.5 NM off. */
function PatternSide({ side }: { side: -1 | 1 }) {
  const dw = X0 + side * 6 * PX;
  const baseY = RWY_Y - 14 * PX;
  const ix = X0 + side * 3.5 * PX;
  const joinY = RWY_Y - (14 - 3.5 * Math.sqrt(3)) * PX;
  const anchor = side < 0 ? 'end' : 'start';
  return (
    <g>
      <polyline
        points={`${dw},${RWY_Y + 10} ${dw},${baseY} ${ix},${baseY} ${X0},${joinY}`}
        fill="none"
        stroke="var(--violet, #ad8cff)"
        stroke-width="2"
        stroke-dasharray="7 4"
        marker-end="url(#arrow)"
      />
      <text x={dw + side * 6} y={RWY_Y - 70} text-anchor={anchor}>
        downwind
      </text>
      <text x={dw + side * 6} y={RWY_Y - 56} text-anchor={anchor} class="dim">
        3000 ft
      </text>
      <text x={dw + side * 6} y={RWY_Y - 42} text-anchor={anchor} class="dim">
        220 kt
      </text>
      <text x={(dw + ix) / 2} y={baseY - 16} text-anchor="middle">
        base
      </text>
      <text x={(dw + ix) / 2} y={baseY - 4} text-anchor="middle" class="dim">
        2000 ft
      </text>
      <text x={ix + side * 4} y={baseY + 46} text-anchor={anchor}>
        30°
      </text>
    </g>
  );
}

function Procedure({ say }: { say: Say }) {
  return (
    <>
      <p>
        How an arrival gets from its first call to {TWR.name}, as this game teaches it (simplified: Schiphol
        publishes transitions that do much the same). Arrivals from{' '}
        {EHAM.stars
          .filter((s) => EHAM.fixes[s.iaf]!.x < 0)
          .map((s) => s.iaf)
          .join(' and ')}{' '}
        join the west side, those from{' '}
        {EHAM.stars
          .filter((s) => EHAM.fixes[s.iaf]!.x >= 0)
          .map((s) => s.iaf)
          .join(' and ')}{' '}
        the east side.
      </p>
      <svg
        class="pattern"
        width="100%"
        viewBox="-30 0 420 290"
        role="img"
        aria-label={`Diagram of the arrival pattern for runway ${EHAM.config.landing}: a downwind leg 6 miles either side of the final at 3000 ft, a base leg about 14 miles out at 2000 ft, then a 30 degree intercept joining the final about 8 miles out.`}
      >
        <defs>
          <marker
            id="arrow"
            viewBox="0 0 10 10"
            refX="8"
            refY="5"
            markerWidth="6"
            markerHeight="6"
            orient="auto"
          >
            <path d="M0,0 L10,5 L0,10 z" fill="var(--violet, #ad8cff)" />
          </marker>
        </defs>
        <line x1={X0} y1={RWY_Y} x2={X0} y2={14} stroke="var(--text2)" stroke-dasharray="5 5" />
        {[5, 10, 15].map((d) => (
          <g>
            <line x1={X0 - 5} x2={X0 + 5} y1={RWY_Y - d * PX} y2={RWY_Y - d * PX} stroke="var(--text2)" />
            <text x={X0 + 8} y={RWY_Y - d * PX + 4} class="dim">
              {d}
            </text>
          </g>
        ))}
        <line x1={X0} y1={RWY_Y} x2={X0} y2={RWY_Y + 24} stroke="var(--text)" stroke-width="5" />
        <text x={X0 + 8} y={RWY_Y + 20}>
          {EHAM.config.landing}
        </text>
        <PatternSide side={-1} />
        <PatternSide side={1} />
        <text x={X0 - 6} y={26} text-anchor="end">
          final (NM)
        </text>
      </svg>
      <ol class="steps">
        <li>
          <b>Answer the check-in.</b> Say “identified”, so the pilot knows you have it on radar.
        </li>
        <li>
          <b>Downwind.</b> Fly it parallel to the final, the opposite way, about 6 miles to the side. Descend
          to 3000 ft (give the QNH the first time below the transition level) and slow to about 220 kt.
        </li>
        <li>
          <b>Base.</b> About 12–14 miles out, turn it at right angles towards the final and descend to 2000
          ft, below the glideslope.
        </li>
        <li>
          <b>Intercept.</b> About 3½ miles from the final, turn it to cross the final at 30° (heading 155 from
          the west, 210 from the east) and clear the ILS approach in the same call. It joins by itself about 8
          miles out.
        </li>
        <li>
          <b>Hand off.</b> Once established, send it to {TWR.name} on {TWR.mhz}, before about 8 miles.
        </li>
      </ol>
      <CommandDocs
        docs={[
          {
            title: 'The intercept call',
            cmds: [
              { type: 'heading', heading: 155, turn: 'right' },
              { type: 'altitude', altitude: 2000, fl: false },
              { type: 'ils', runway: EHAM.config.landing },
            ],
            note: 'Heading, level and clearance in one transmission: the pilot reads all three back.',
          },
        ]}
        env={env}
        say={say}
      />
      <p class="dim">
        Several arrivals at once: make the second one's path longer (fly the downwind further before the base
        turn) or slow it down, so there are at least 3 miles between them on final. Lessons 6–8 practise this,
        and in Beginner free play the help card says the next step for the selected aircraft.
      </p>
    </>
  );
}

// ------------------------------------------------------------------ 6. tower

const { landing: LAND, departure: DEP } = EHAM.config;
const towerEnv = { ...env, wind: EHAM.wind };
const GND = EHAM.frequencies.ground;
const DEPF = EHAM.frequencies.departure;
const EXITS = runwayById(EHAM, LAND).exits ?? [];
const MID = EXITS[Math.floor(EXITS.length / 2)];
const TOWER_COMMANDS: CommandDoc[] = [
  {
    title: 'Landing clearance',
    cmds: [{ type: 'land', runway: LAND }],
    note: 'Runway, surface wind, then “cleared to land”. Only when the runway will be free by the time it arrives; without it the pilot goes around at about half a mile.',
  },
  {
    title: 'Not yet: continue approach',
    cmds: [{ type: 'continueApproach' }],
    note: 'The runway is still occupied but should be free in time. Clear it to land as soon as it is.',
  },
  {
    title: 'Vacate and change to Ground',
    cmds: [
      MID
        ? { type: 'vacate', exit: MID.name, side: MID.side === 'L' ? 'left' : 'right' }
        : { type: 'vacate' },
      { type: 'handoff', to: 'ground' },
    ],
    note: `Name the exit (${EXITS.map((e) => e.name).join(', ')} on ${LAND}) and pass the aircraft to ${GND?.name ?? 'Ground'} in the same call.`,
  },
  {
    title: 'Expedite vacating',
    cmds: [{ type: 'expediteVacate' }],
    note: 'The next arrival is close: the pilot brakes harder, takes the first exit it can still make, and taxis off quicker.',
  },
  {
    title: 'Line up and wait',
    cmds: [{ type: 'lineUp', runway: DEP }],
    note: 'The departure enters the runway and stops on the centreline, ready to go the moment the runway is yours.',
  },
  {
    title: 'Conditional line-up',
    cmds: [{ type: 'lineUp', runway: DEP, behind: { traffic: 'departing', desc: 'A320' } }],
    note: 'Keeps the runway busy: the next departure lines up as soon as the one ahead is rolling. Name the traffic first and say “behind” again at the end; the pilot must see it, or answers “unable, traffic not in sight”.',
  },
  {
    title: 'Traffic information',
    cmds: [{ type: 'trafficInfo', desc: 'A321 on short final runway 18R' }],
    note: 'Tells a pilot about other traffic; nothing changes. The pilot reports it in sight.',
  },
  {
    title: 'Take-off clearance',
    cmds: [{ type: 'takeoff', runway: DEP }],
    note: 'Runway, wind, “cleared for take-off”. This is the only phrase that uses the word “take-off”: everywhere else say “departure”.',
  },
  {
    title: 'Immediate take-off',
    cmds: [{ type: 'takeoff', runway: DEP, immediate: true }],
    note: 'For a gap in front of an arrival: the pilot rolls without stopping and without the usual few seconds of checks. Warn it early with “line up and wait, be ready for immediate departure”.',
  },
  {
    title: 'Hold position',
    cmds: [{ type: 'cancelTakeoff' }],
    note: 'Stops a departure that is lining up or waiting, for example when the runway is suddenly not safe. Give a new take-off clearance when it is. A departure already rolling: “stop immediately”, said twice.',
  },
  {
    title: 'Hand off a departure',
    cmds: [{ type: 'handoff', to: 'departure' }],
    note: `Once airborne and before about 2000 ft, send it to ${DEPF?.name ?? 'Departure'}.`,
  },
  {
    title: 'Go around',
    cmds: [{ type: 'goAround' }],
    note: 'When the runway will not be free in time. Keep it short so it cannot be misheard; Approach takes the aircraft back.',
  },
];

function Tower({ say }: { say: Say }) {
  return (
    <>
      <p>
        As {TWR.name} you own the runways: {LAND} for landings (seen from Tower West) and {DEP} for departures
        (from the centre cab). Only one aircraft may use a runway at a time, so every clearance is a promise
        that the runway will be free.
      </p>
      <CommandDocs docs={TOWER_COMMANDS} env={towerEnv} say={say} />
      <h3>Common mistakes the game points out</h3>
      <ul>
        <li>{RULE_TEXT['wind-missing']}</li>
      </ul>
    </>
  );
}

// ------------------------------------------------------------------ dialog

interface BodyProps {
  say: Say;
  voice?: VoiceInput;
}
const SECTIONS: { id: string; title: string; Body: FunctionComponent<BodyProps> }[] = [
  { id: 'basics', title: 'Numbers and letters', Body: Basics },
  { id: 'values', title: 'Saying values and callsigns', Body: Values },
  { id: 'commands', title: 'Commands', Body: Commands },
  { id: 'levels', title: 'Levels and altimetry', Body: Levels },
  { id: 'approach', title: 'Approach concepts', Body: Approach },
  { id: 'procedure', title: 'Arrival procedure', Body: Procedure },
  { id: 'tower', title: 'Tower', Body: Tower },
  { id: 'drill', title: 'Practise phrases', Body: PhraseDrill },
];

export function Learn({ onClose, say, voice }: { onClose: () => void; say: Say; voice?: VoiceInput }) {
  const ref = useDialog(onClose);
  const [tab, setTab] = useState('basics');
  const sec = SECTIONS.find((s) => s.id === tab)!;
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div ref={ref} class="dialog learn" role="dialog" aria-modal="true" aria-labelledby="learn-title">
        <div class="learn-head">
          <h1 id="learn-title">Learn</h1>
          <button type="button" class="btn" onClick={onClose}>
            Close
          </button>
        </div>
        <div class="learn-body">
          <nav aria-label="Learn sections" class="learn-nav">
            {SECTIONS.map((s) => (
              <button
                type="button"
                aria-current={s.id === tab ? 'page' : undefined}
                onClick={() => setTab(s.id)}
              >
                {s.title}
              </button>
            ))}
          </nav>
          <article class="learn-content" tabIndex={0} aria-labelledby="learn-section">
            <h2 id="learn-section">{sec.title}</h2>
            <sec.Body say={say} voice={voice} />
            <p class="dim learn-src">
              Based on ICAO Annex 10 Vol II, ICAO Doc 4444 and UK CAP 413. Simplified for the game: not for
              real-world use.
            </p>
          </article>
        </div>
      </div>
    </div>
  );
}
