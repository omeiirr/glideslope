import { describe, expect, test } from 'vitest';
import { EHAM, TICK } from '../src/core';
import { readback } from '../src/phraseology/phrases';
import { arrival, quietSim } from './helpers';

const run = (sim: ReturnType<typeof quietSim>, s: number) => {
  for (let t = 0; t < s; t += TICK) sim.step();
};
const desc = { type: 'altitude', altitude: 3000, fl: false, qnh: 1013 } as const;

describe('expedite, rate of descent, minimum approach speed', () => {
  test('expedite descends faster than normal, and ends at the level', () => {
    const sim = quietSim();
    const a = arrival(sim, { callsign: 'KLM1', pos: { x: 20, y: 20 }, hdg: 270, alt: 7000 });
    const b = arrival(sim, { callsign: 'KLM2', pos: { x: 20, y: -20 }, hdg: 270, alt: 7000 });
    sim.command('KLM1', [desc]);
    sim.command('KLM2', [desc, { type: 'expedite', climb: false }]);
    run(sim, 60);
    expect(a.alt - b.alt).toBeGreaterThan(600);
    run(sim, 240);
    expect(b.alt).toBe(3000);
    expect(b.expediteVs).toBe(false);
  });

  test('an assigned rate is held ("or less"), and a rate beyond the aircraft is refused', () => {
    const sim = quietSim();
    const a = arrival(sim, { callsign: 'KLM1', pos: { x: 20, y: 20 }, hdg: 270, alt: 7000 });
    sim.command('KLM1', [desc, { type: 'rate', fpm: 1000, limit: 'less' }]);
    run(sim, 90);
    expect(7000 - a.alt).toBeGreaterThan(1300);
    expect(7000 - a.alt).toBeLessThan(1600);
    expect(sim.validate('KLM1', { type: 'rate', fpm: 5000, limit: 'greater' }).ok).toBe(false);
    expect(sim.validate('KLM1', { type: 'rate', fpm: 2500 }).ok).toBe(true);
  });

  test('minimum approach speed slows to the approach speed', () => {
    const sim = quietSim();
    const a = arrival(sim, { callsign: 'KLM1', pos: { x: 20, y: 20 }, hdg: 270, alt: 3000, ias: 220 });
    sim.command('KLM1', [{ type: 'minimumSpeed' }]);
    run(sim, 120);
    expect(a.ias).toBe(a.perf.vapp);
  });
});

describe('report heading / level / speed', () => {
  const env = { airport: EHAM, qnh: 1013 };
  const ac = { callsign: 'KLM1', alt: 5420, hdg: 269.6, ias: 221, qnhGiven: true, tgtAlt: 3000 };
  const say = (what: 'heading' | 'level' | 'speed', a = ac) =>
    readback('KLM1', [{ type: 'report', what }], env, a).text;
  test('the pilot answers with the actual values', () => {
    expect(say('heading')).toBe('Heading 270, KLM1');
    expect(say('speed')).toBe('Speed 220 knots, KLM1');
    expect(say('level')).toBe('Passing flight level 54, descending altitude 3000, KLM1');
    expect(say('level', { ...ac, alt: 3000 })).toBe('Maintaining altitude 3000, KLM1');
  });
});
