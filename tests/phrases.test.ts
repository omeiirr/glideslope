import { expect, test } from 'vitest';
import { EHAM } from '../src/core';
import { matchCallsign, spokenCallsign } from '../src/phraseology/callsign';
import { words } from '../src/phraseology/normalize';
import { canonicalTransmission, checkIn, chip, readback } from '../src/phraseology/phrases';

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
  expect(spokenCallsign('EZY45MP', EHAM.airlines)).toBe('Easy four five Mike Papa');
});

test('callsign is recognised on a partial transcript (early highlight)', () => {
  const on = ['KLM1234', 'BAW432', 'EZY45MP'];
  expect(matchCallsign(words('Speedbird four'), on, EHAM.airlines).callsign).toBeNull();
  expect(matchCallsign(words('Speedbird four three two'), on, EHAM.airlines).callsign).toBe('BAW432');
  expect(matchCallsign(words('Speedbird four three two turn le'), on, EHAM.airlines).callsign).toBe('BAW432');
});
