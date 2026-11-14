import { describe, expect, test } from 'vitest';
import {
  EHAM,
  Sim,
  angleDiff,
  dist,
  runwayFrame,
  transitionLevel,
  wakeMinimum,
  type SimEvent,
} from '../src/core';
import { arrival, onFinal, quietSim } from './helpers';

const rwy = EHAM.runways.find((r) => r.id === '18R')!;
const types = (ev: SimEvent[]) => ev.map((e) => e.type);

describe('airport data', () => {
  test('EHAM geometry is sane', () => {
    expect(rwy.heading).toBeCloseTo(183.2, 0);
    for (const iaf of ['ARTIP', 'RIVER', 'SUGOL']) {
      const d = dist({ x: 0, y: 0 }, EHAM.fixes[iaf]!);
      expect(d).toBeGreaterThan(25);
      expect(d).toBeLessThan(45);
    }
    expect(EHAM.fixes.ARTIP!.x).toBeGreaterThan(0); // east
    expect(EHAM.fixes.SUGOL!.x).toBeLessThan(0); // west
    expect(EHAM.fixes.RIVER!.y).toBeLessThan(0); // south
  });
  test('transition level table', () => {
    expect(transitionLevel(EHAM, 1013)).toBe(40);
    expect(transitionLevel(EHAM, 1000)).toBe(45);
    expect(transitionLevel(EHAM, 970)).toBe(50);
  });
});

describe('basic flight', () => {
  test('heading 270 at 220 kt covers the expected ground', () => {
    const sim = quietSim();
    const ac = arrival(sim, { pos: { x: 20, y: 10 }, hdg: 270, alt: 3000, ias: 220 });
    sim.command('KLM123', [{ type: 'speed', speed: 220 }]);
    sim.run(120);
    const tas = 220 * 1.06; // 2 % per 1000 ft
    expect(ac.pos.x).toBeCloseTo(20 - (tas * 120) / 3600, 1);
    expect(ac.pos.y).toBeCloseTo(10, 2);
  });

  test('turns at about standard rate, in the commanded direction', () => {
    const sim = quietSim();
    const ac = arrival(sim, { pos: { x: 0, y: 20 }, hdg: 360, alt: 3000, ias: 180 });
    sim.command('KLM123', [{ type: 'heading', heading: 90, turn: 'left' }]);
    sim.run(10);
    expect(angleDiff(360, ac.hdg)).toBeLessThan(-20); // went left, the long way round
    sim.run(120);
    expect(ac.hdg).toBeCloseTo(90, 0);
    expect(ac.turn).toBeUndefined();
  });

  test('wind changes groundspeed, not airspeed', () => {
    const sim = quietSim({ wind: { dir: 270, speed: 30 } });
    const ac = arrival(sim, { pos: { x: 0, y: 20 }, hdg: 270, alt: 3000, ias: 200 });
    sim.command('KLM123', [{ type: 'speed', speed: 200 }]);
    sim.run(5);
    expect(ac.gs).toBeCloseTo(200 * 1.06 - 30, 0);
  });

  test('descent rate is realistic and levels off exactly', () => {
    const sim = quietSim();
    const ac = arrival(sim, { pos: { x: 20, y: 20 }, hdg: 270, alt: 7000 });
    sim.command('KLM123', [{ type: 'altitude', altitude: 3000, fl: false, qnh: 1013 }]);
    sim.run(60);
    expect(ac.vs).toBeCloseTo(-2000, -2);
    expect(ac.alt).toBeGreaterThan(4900);
    expect(ac.alt).toBeLessThan(5400);
    sim.run(120);
    expect(ac.alt).toBe(3000);
    expect(ac.vs).toBe(0);
    expect(ac.qnhGiven).toBe(true);
  });

  test('speed reduction takes time and holds', () => {
    const sim = quietSim();
    const ac = arrival(sim, { pos: { x: 20, y: 20 }, hdg: 270, alt: 4000, ias: 250 });
    sim.command('KLM123', [{ type: 'speed', speed: 180 }]);
    sim.run(20);
    expect(ac.ias).toBeGreaterThan(215);
    sim.run(60);
    expect(ac.ias).toBe(180);
  });

  test('direct to a fix, then present heading', () => {
    const sim = quietSim();
    const ac = arrival(sim, { pos: { x: 30, y: 0 }, hdg: 360, alt: 5000 });
    sim.command('KLM123', [{ type: 'direct', fix: 'SPL' }]);
    let min = Infinity;
    for (let i = 0; i < 1400; i++) {
      sim.step();
      min = Math.min(min, dist(ac.pos, EHAM.fixes.SPL!));
    }
    expect(min).toBeLessThan(0.5);
    expect(ac.nav.mode).toBe('heading');
  });

  test('hold keeps the aircraft near the fix and passes over it repeatedly', () => {
    const sim = quietSim();
    const fix = EHAM.fixes.ARTIP!;
    const ac = arrival(sim, { pos: { x: fix.x + 8, y: fix.y + 2 }, hdg: 250, alt: 7000, ias: 220 });
    sim.command('KLM123', [
      { type: 'hold', fix: 'ARTIP' },
      { type: 'speed', speed: 220 },
    ]);
    let passes = 0;
    let wasNear = false;
    let max = 0;
    for (let i = 0; i < 2400; i++) {
      sim.step();
      const d = dist(ac.pos, fix);
      if (i > 400) max = Math.max(max, d);
      if (d < 0.6 && !wasNear) passes++;
      wasNear = d < 0.6;
    }
    expect(passes).toBeGreaterThanOrEqual(3);
    expect(max).toBeLessThan(9);
  });

  test('rejects impossible instructions', () => {
    const sim = quietSim();
    arrival(sim, { pos: { x: 20, y: 20 }, hdg: 270, alt: 4000 });
    expect(sim.command('KLM123', [{ type: 'speed', speed: 100 }])[0]!.ok).toBe(false);
    expect(sim.command('KLM123', [{ type: 'direct', fix: 'NOPE' }])[0]!.ok).toBe(false);
    expect(sim.command('KLM123', [{ type: 'ils', runway: '27' }])[0]!.ok).toBe(false);
    expect(sim.command('KLM123', [{ type: 'handoff', to: 'tower' }])[0]!.ok).toBe(false);
    expect(sim.command('NOBODY', [{ type: 'identify' }])[0]!.ok).toBe(false);
  });
});

describe('ILS', () => {
  const setup = (strict: boolean, offDeg: number, alt: number, distNm = 14) => {
    const sim = quietSim({ strictIls: strict });
    const ac = arrival(sim, { pos: onFinal(distNm, 3), hdg: rwy.heading - offDeg, alt, ias: 200 });
    sim.command('KLM123', [{ type: 'ils', runway: '18R' }]);
    return { sim, ac };
  };

  test('captures from a 30° intercept, follows the glideslope and lands', () => {
    const { sim, ac } = setup(true, 30, 2000);
    const ev = sim.run(120);
    expect(types(ev)).toContain('established');
    expect(Math.abs(runwayFrame(ac.pos, rwy).xte)).toBeLessThan(0.15);
    sim.run(60);
    expect(sim.command('KLM123', [{ type: 'handoff', to: 'tower' }])[0]!.ok).toBe(true);
    let landed: SimEvent | undefined;
    let vsOnSlope = 0;
    for (let i = 0; i < 1200 && !landed; i++) {
      landed = sim.step().find((e) => e.type === 'landed');
      if (ac.gsEstablished && ac.phase === 'approach') vsOnSlope = ac.vs;
    }
    expect(landed).toMatchObject({ type: 'landed', handedOff: true });
    expect(vsOnSlope).toBeLessThan(-550); // ~3° at approach speed
    expect(vsOnSlope).toBeGreaterThan(-1000);
    expect(sim.aircraft).toHaveLength(0);
  });

  test('Pro: a 60° intercept flies through the localizer', () => {
    const { sim, ac } = setup(true, 60, 2000);
    sim.run(240);
    expect(ac.nav.mode).toBe('heading');
  });

  test('Beginner: a 60° intercept still captures', () => {
    const { sim, ac } = setup(false, 60, 2000);
    sim.run(240);
    expect(ac.nav.mode).toBe('loc');
  });

  test('Pro: too high on the localizer ends in a go-around', () => {
    const { sim, ac } = setup(true, 30, 6000, 10);
    const ev = sim.run(400);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'goAround', reason: 'unstable' }));
    sim.run(120);
    expect(ac.alt).toBe(EHAM.missedApproachAltFt);
    expect(ac.phase).toBe('goaround');
  });

  test('Beginner: too high dives after the glideslope and lands', () => {
    const { sim } = setup(false, 30, 5000, 14);
    expect(types(sim.run(700))).toContain('landed');
  });

  test('commanded go-around climbs out on runway heading', () => {
    const { sim, ac } = setup(true, 30, 2000);
    sim.run(200);
    expect(ac.gsEstablished).toBe(true);
    expect(sim.command('KLM123', [{ type: 'goAround' }])[0]!.ok).toBe(true);
    sim.run(120);
    expect(ac.alt).toBe(2000);
    expect(ac.hdg).toBeCloseTo(rwy.heading, 0);
  });

  test('heading + ILS in one transmission keeps the clearance whatever the order', () => {
    const sim = quietSim();
    const ac = arrival(sim, { pos: onFinal(14, 3), hdg: 150, alt: 2000 });
    sim.command('KLM123', [
      { type: 'ils', runway: '18R' },
      { type: 'heading', heading: 160, turn: 'right' },
    ]);
    expect(ac.ilsArmed).toBe('18R');
    expect(ac.tgtHdg).toBe(160);
  });
});

describe('separation', () => {
  test('loss fires once when two aircraft get inside 3 NM / 1000 ft', () => {
    const sim = quietSim();
    arrival(sim, { pos: { x: -10, y: 20 }, hdg: 90, alt: 5000 });
    arrival(sim, { callsign: 'BAW456', pos: { x: 10, y: 20 }, hdg: 270, alt: 5400 });
    sim.step();
    sim.step();
    expect(sim.conflicts).toContainEqual(expect.objectContaining({ kind: 'predicted' }));
    const ev = sim.run(200);
    expect(ev.filter((e) => e.type === 'conflict' && e.kind === 'loss')).toHaveLength(1);
  });

  test('1000 ft apart is not a conflict', () => {
    const sim = quietSim();
    arrival(sim, { pos: { x: -10, y: 20 }, hdg: 90, alt: 5000 });
    arrival(sim, { callsign: 'BAW456', pos: { x: 10, y: 20 }, hdg: 270, alt: 6000 });
    expect(types(sim.run(200))).not.toContain('conflict');
    expect(sim.conflicts).toHaveLength(0);
  });

  test('wake minima follow ICAO Doc 4444', () => {
    expect(wakeMinimum('H', 'M')).toBe(5);
    expect(wakeMinimum('M', 'L')).toBe(5);
    expect(wakeMinimum('H', 'H')).toBe(4);
    expect(wakeMinimum('J', 'M')).toBe(7);
    expect(wakeMinimum('M', 'M')).toBe(3);
  });

  test('medium 4 NM behind a heavy on final is a wake infringement', () => {
    const sim = quietSim();
    for (const [cs, type, d] of [
      ['KLM601', 'B772', 8],
      ['EZY222', 'A320', 12],
    ] as const) {
      arrival(sim, { callsign: cs, type, pos: onFinal(d), hdg: rwy.heading, alt: 2000, ias: 180 });
      sim.command(cs, [
        { type: 'ils', runway: '18R' },
        { type: 'speed', speed: 180 },
      ]);
    }
    const ev = sim.run(20);
    expect(ev).toContainEqual(expect.objectContaining({ type: 'conflict', kind: 'wake' }));
  });
});

describe('traffic', () => {
  test('same seed, same world', () => {
    const run = () => {
      const sim = new Sim(EHAM, {
        seed: 42,
        traffic: { arrivalsPerHour: 30, departuresPerHour: 15, alnumCallsigns: 0.3 },
      });
      sim.run(900);
      return sim.aircraft.map((a) => [a.callsign, a.type, a.pos.x.toFixed(6), a.alt.toFixed(2)]);
    };
    const a = run();
    expect(a.length).toBeGreaterThan(4);
    expect(run()).toEqual(a);
  });

  test('arrivals spawn outside the TMA, check in, and fly to their IAF', () => {
    const sim = new Sim(EHAM, { seed: 7, traffic: { arrivalsPerHour: 20, departuresPerHour: 0 } });
    const ev = sim.run(60);
    expect(types(ev)).toContain('spawned');
    expect(types(ev)).toContain('checkIn');
    const ac = sim.aircraft[0]!;
    expect(ac.comms).toBe('app');
    expect(ac.nav).toMatchObject({ mode: 'direct', fix: ac.route });
    const ll = sim.latLon(ac);
    expect(ll.lat).toBeGreaterThan(51);
    expect(ll.lat).toBeLessThan(54);
  });

  test('a departure takes off from 24, climbs to FL060 and leaves via its exit', () => {
    const sim = quietSim();
    const ac = sim.spawn({ kind: 'departure', callsign: 'TRA6015', type: 'B738', route: 'LEKKO' });
    const ev = sim.run(90);
    expect(types(ev)).toContain('checkIn');
    expect(ac.alt).toBeGreaterThan(1000);
    expect(sim.command('TRA6015', [{ type: 'handoff', to: 'tower' }])[0]!.ok).toBe(false);
    sim.run(200);
    expect(ac.alt).toBe(6000);
    expect(sim.command('TRA6015', [{ type: 'handoff', to: 'radar' }])[0]!.ok).toBe(true);
    const left = sim.run(600).find((e) => e.type === 'leftAirspace');
    expect(left).toMatchObject({ handedOff: true });
  });

  test('an arrival nobody talks to eventually leaves the airspace', () => {
    const sim = quietSim();
    arrival(sim, { route: 'ARTIP' });
    const left = sim.run(2400).find((e) => e.type === 'leftAirspace');
    expect(left).toMatchObject({ handedOff: false });
  });
});
