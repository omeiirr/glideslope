import { expect, test } from 'vitest';
import { corruptReadback } from '../src/phraseology/readbackError';
import { EHAM } from '../src/core';
import { matchCallsign, spokenCallsign } from '../src/phraseology/callsign';
import { words } from '../src/phraseology/normalize';
import { canonicalTransmission, checkIn, chip, readback, towerCheckIn } from '../src/phraseology/phrases';

const env = { airport: EHAM, qnh: 1013 };
const ac = { callsign: 'KLM1234', alt: 7000, hdg: 90, ias: 250, qnhGiven: false };

test('readback: elements then callsign, with a spoken form for TTS', () => {
  const rb = readback(
    'KLM1234',
    [
      { type: 'heading', heading: 270, turn: 'left' },
      { type: 'altitude', altitude: 3000, fl: false, qnh: 1013 },
    ],
    env,
    ac,
  );
  expect(rb.text).toBe('Left heading 270, descend altitude 3000, QNH 1013, KLM1234');
  expect(rb.speech).toBe(
    'Left heading two seven zero, descend altitude three thousand, Q N H one zero one three, K L M one two three four',
  );
});

test('readback: refused element becomes "unable"', () => {
  const rb = readback('BAW432', [{ type: 'speed', speed: 100 }], env, ac, ['unable, minimum speed 140']);
  expect(rb.text).toBe('Unable, minimum speed 140, BAW432');
  expect(rb.speech).toContain('Speedbird four three two');
  // spoken digit by digit, runways as "one eight right" (TTS read "18R" as "eighteen R")
  expect(rb.speech).toContain('minimum speed one four zero');
  const neg = readback('KLM1200', [{ type: 'takeoff', runway: '24' }], env, ac, [
    'negative, approaching runway 18R',
  ]);
  expect(neg.text).toBe('Negative, approaching runway 18R, KLM1200');
  expect(neg.speech).toMatch(/^Negative, approaching runway one eight right, /);
});

test('canonical controller phrases', () => {
  const ctx = { ...env, aircraft: [ac] };
  expect(canonicalTransmission('KLM1234', [{ type: 'altitude', altitude: 3000, fl: false }], ctx)).toBe(
    'KLM1234, descend altitude 3000, QNH 1013',
  );
  expect(canonicalTransmission('KLM1234', [{ type: 'heading', heading: 30 }], ctx)).toBe(
    'KLM1234, turn left heading 030',
  );
  expect(canonicalTransmission('KLM1234', [{ type: 'speed', speed: 180, untilDme: 4 }], ctx)).toBe(
    'KLM1234, maintain 180 knots until 4 miles final',
  );
  expect(canonicalTransmission('KLM1234', [{ type: 'handoff', to: 'tower' }], ctx)).toBe(
    'KLM1234, contact Schiphol Tower 118.280',
  );
});

test('chips and check-in', () => {
  expect(chip({ type: 'heading', heading: 270, turn: 'left' })).toBe('L HDG 270');
  expect(chip({ type: 'altitude', altitude: 7000, fl: true })).toBe('FL070');
  const ci = checkIn({ callsign: 'KLM1234', alt: 7000, tgtAlt: 7000, kind: 'arrival' }, env);
  expect(ci.text).toBe('Schiphol Approach, KLM1234, flight level 70, information B');
  expect(ci.speech).toContain('information Bravo');
  const arr = { callsign: 'KLM1234', alt: 7000, tgtAlt: 7000, kind: 'arrival' } as const;
  expect(checkIn({ ...arr, priority: 'medical' }, env).text).toBe(
    'PAN PAN, PAN PAN, PAN PAN, Schiphol Approach, KLM1234, medical emergency on board, request priority landing, flight level 70, information B',
  );
  expect(checkIn({ ...arr, priority: 'fuel' }, env).text).toBe(
    'Schiphol Approach, KLM1234, flight level 70, information B, minimum fuel',
  );
  expect(readback('KLM1234', [{ type: 'acknowledge', what: 'pan' }], env).text).toBe('Roger, KLM1234');
  expect(spokenCallsign('EZY45MP', EHAM.airlines)).toBe('Easy four five Mike Papa');
});

test('callsign is recognised on a partial transcript (early highlight)', () => {
  const on = ['KLM1234', 'BAW432', 'EZY45MP'];
  expect(matchCallsign(words('Speedbird four'), on, EHAM.airlines).callsign).toBeNull();
  expect(matchCallsign(words('Speedbird four three two'), on, EHAM.airlines).callsign).toBe('BAW432');
  expect(matchCallsign(words('Speedbird four three two turn le'), on, EHAM.airlines).callsign).toBe('BAW432');
});

test('tower: controller phrases with wind, readbacks without, chips and calls', () => {
  const wenv = { ...env, wind: { dir: 203, speed: 12 } };
  const ctx = { ...wenv, aircraft: [ac] };
  expect(canonicalTransmission('KLM1234', [{ type: 'land', runway: '18R' }], ctx)).toBe(
    'KLM1234, runway 18R, wind 200 degrees 12 knots, cleared to land',
  );
  expect(
    readback(
      'KLM1234',
      [
        { type: 'land', runway: '18R' },
        { type: 'vacate', exit: 'V2', side: 'left' },
      ],
      wenv,
    ).text,
  ).toBe('Runway 18R, cleared to land, vacate left via V2, KLM1234');
  const tko = readback('TRA6015', [{ type: 'takeoff', runway: '24' }], wenv);
  expect(tko.text).toBe('Runway 24, cleared for take-off, TRA6015');
  expect(tko.speech).toContain('Runway two four, cleared for take-off');
  expect(readback('TRA6015', [{ type: 'lineUp', runway: '24' }], env).text).toBe(
    'Runway 24, line up and wait, TRA6015',
  );
  expect(readback('TRA6015', [{ type: 'cancelTakeoff' }], env).text).toBe('Holding, TRA6015');
  expect(readback('TRA6015', [{ type: 'takeoff', runway: '24', immediate: true }], wenv).text).toBe(
    'Runway 24, cleared for immediate take-off, TRA6015',
  );
  expect(readback('TRA6015', [{ type: 'lineUp', runway: '24', immediate: true }], env).text).toBe(
    'Runway 24, line up and wait, ready for immediate departure, TRA6015',
  );
  expect(readback('KLM1234', [{ type: 'expediteVacate' }], env).text).toBe('Expediting, KLM1234');
  expect(readback('KLM1234', [{ type: 'handoff', to: 'ground' }], env).text).toBe(
    'Schiphol Ground 121.560, KLM1234',
  );
  expect(chip({ type: 'vacate', exit: 'V2', side: 'left' })).toBe('VACATE L V2');
  expect(chip({ type: 'handoff', to: 'departure' })).toBe('DEP');
  expect(towerCheckIn({ callsign: 'KLM1234', kind: 'arrival', priority: 'medical' }, env).text).toBe(
    'PAN PAN, PAN PAN, PAN PAN, Schiphol Tower, KLM1234, medical emergency on board, ILS 18R',
  );
  expect(towerCheckIn({ callsign: 'KLM1234', kind: 'arrival', priority: 'fuel' }, env).text).toBe(
    'Schiphol Tower, KLM1234, ILS 18R, minimum fuel',
  );
  expect(towerCheckIn({ callsign: 'KLM1234', kind: 'arrival' }, env).text).toBe(
    'Schiphol Tower, KLM1234, ILS 18R',
  );
  expect(towerCheckIn({ callsign: 'TRA6015', kind: 'departure' }, env).text).toBe(
    'Schiphol Tower, TRA6015, holding point S7E, ready for departure',
  );
  expect(
    canonicalTransmission('KLM1234', [{ type: 'land', runway: '18R' }], {
      ...ctx,
      wind: { dir: 0, speed: 0 },
    }),
  ).toBe('KLM1234, runway 18R, wind calm, cleared to land');
});

test('a misread relative turn changes the degrees and the heading together', () => {
  const cmd = { type: 'heading', heading: 70, turn: 'left', by: 20 } as const;
  for (const r of [0.1, 0.9]) {
    const e = corruptReadback([cmd], 3000, () => r)!;
    const w = e.commands[0]!;
    expect(w.type === 'heading' && w.by).not.toBe(20);
    if (w.type === 'heading') expect(w.heading).toBe(((90 - w.by! + 359) % 360) + 1);
  }
});
