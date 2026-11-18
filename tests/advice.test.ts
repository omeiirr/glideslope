import { describe, expect, test } from 'vitest';
import { EHAM, TICK, runwayById } from '../src/core';
import { approachAdvice } from '../src/game/advice';
import { arrival, quietSim } from './helpers';

const rwy = runwayById(EHAM, '18R');
const opts = { contacted: true, qnh: 1013, transitionAltFt: EHAM.transitionAltitudeFt };

/** Follow the advice like an obedient player (first suggestion, every 10 s) until the aircraft lands. */
function fly(start: Parameters<typeof arrival>[1], strictIls: boolean) {
  const sim = quietSim({ strictIls });
  const ac = arrival(sim, start);
  const said: string[] = [];
  let landed = false;
  for (let t = 0; t < 3600 && !landed; t += TICK) {
    if (t % 10 === 0 && sim.aircraft.includes(ac) && ac.comms === 'app') {
      const a = approachAdvice(ac, rwy, opts);
      const cmds = a.say[0];
      if (cmds?.length && cmds[0]!.type !== 'handoff') {
        const key = JSON.stringify(cmds);
        if (said.at(-1) !== key) said.push(key);
        sim.command(ac.callsign, cmds);
      }
    }
    for (const e of sim.step()) {
      if (e.type === 'landed') landed = true;
      if (e.type === 'goAround') throw new Error(`go-around (${e.reason}) after ${said.join(' | ')}`);
    }
  }
  return { landed, said };
}

describe('Beginner next-step advice flies a full approach', () => {
  // from each arrival route's IAF, and from awkward places: close in on the final line, south of the field
  const starts: [string, { x: number; y: number }, number, number][] = [
    ['ARTIP', EHAM.fixes.ARTIP!, 250, 7000],
    ['SUGOL', EHAM.fixes.SUGOL!, 120, 7000],
    ['RIVER', EHAM.fixes.RIVER!, 40, 7000],
    ['close in on the final', { x: rwy.pos.x + 0.2, y: rwy.pos.y + 4 }, 183, 3000],
    ['south of the field', { x: 3, y: -12 }, 360, 5000],
  ];
  test.each(starts)('from %s, with Pro ILS rules too', (_, pos, hdg, alt) => {
    for (const strict of [false, true]) {
      const r = fly({ pos: { ...pos }, hdg, alt, ias: 250 }, strict);
      expect(r.landed, r.said.join(' | ')).toBe(true);
    }
  });

  test('answers a check-in first, and a departure climbs then goes to Radar', () => {
    const sim = quietSim();
    const ac = arrival(sim, { pos: { x: 20, y: 10 }, hdg: 250, alt: 7000 });
    expect(approachAdvice(ac, rwy, { ...opts, contacted: false }).say).toEqual([[{ type: 'identify' }]]);
    const dep = sim.spawn({ kind: 'departure', callsign: 'TRA6015', type: 'B738', route: 'LEKKO' });
    expect(approachAdvice(dep, rwy, opts).say[0]![0]).toEqual({
      type: 'altitude',
      altitude: 10000,
      fl: true,
    });
  });
});
