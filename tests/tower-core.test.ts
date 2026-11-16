import { describe, expect, test } from 'vitest';
import {
  EHAM,
  TICK,
  isOnGround,
  runwayById,
  runwayFrame,
  type Aircraft,
  type Sim,
  type SimEvent,
} from '../src/core';
import { arrival, onFinal, quietSim } from './helpers';

const rwy = runwayById(EHAM, '18R');
const dep = runwayById(EHAM, '24');
const towerSim = () => quietSim({ tower: true });
const alongNm = (ac: Readonly<Aircraft>) => runwayFrame(ac.pos, rwy).along;

/** Step until `done` or `max` seconds; returns all events. */
function runUntil(sim: Sim, done: () => boolean, max = 600): SimEvent[] {
  const ev: SimEvent[] = [];
  for (let t = 0; t < max && !done(); t += TICK) ev.push(...sim.step());
  return ev;
}

describe('tower mode (T3 core)', () => {
  test('stand-in Approach clears the ILS and hands the arrival to Tower at 8 NM, with a call', () => {
    const sim = towerSim();
    const ac = arrival(sim, { pos: onFinal(11), hdg: rwy.heading, alt: 3000, ias: 180 });
    const ev = runUntil(sim, () => ac.comms === 'tower');
    expect(ev.filter((e) => e.type === 'checkIn').map((e) => e.ac)).toEqual([ac]);
    expect(alongNm(ac)).toBeLessThan(8);
    expect(alongNm(ac)).toBeGreaterThan(7.5);
    expect(ac.nav.mode).toBe('loc');
  });

  test('no landing clearance: go-around at half a mile, then the stand-in Approach takes it', () => {
    const sim = towerSim();
    const ac = arrival(sim, { pos: onFinal(4), hdg: rwy.heading, alt: 1300, ias: 150 });
    const ev = runUntil(sim, () => ac.phase === 'goaround');
    const ga = ev.find((e) => e.type === 'goAround');
    expect(ga && ga.type === 'goAround' && ga.reason).toBe('noClearance');
    expect(alongNm(ac)).toBeLessThan(0.5);
    expect(alongNm(ac)).toBeGreaterThan(0.4);
    const after = runUntil(sim, () => !sim.aircraft.length, 300);
    expect(sim.aircraft).toHaveLength(0);
    expect(after.filter((e) => e.type === 'removed').map((e) => e.ac)).toEqual([ac]);
  });

  test('a clearance just before the half-mile point still counts', () => {
    const sim = towerSim();
    const ac = arrival(sim, { pos: onFinal(3), hdg: rwy.heading, alt: 1000, ias: 145 });
    runUntil(sim, () => alongNm(ac) < 0.55);
    expect(sim.command(ac.callsign, [{ type: 'land', runway: '18R' }])).toEqual([{ ok: true }]);
    runUntil(sim, () => ac.nav.mode === 'rollout', 120);
    expect(ac.nav.mode).toBe('rollout');
  });

  test('cleared to land, vacate via a named exit, contact Ground, vacated', () => {
    const sim = towerSim();
    const ac = arrival(sim, { pos: onFinal(4), hdg: rwy.heading, alt: 1300, ias: 150 });
    runUntil(sim, () => ac.comms === 'tower');
    expect(sim.validate(ac.callsign, { type: 'land', runway: '18C' }).ok).toBe(false);
    expect(sim.validate(ac.callsign, { type: 'vacate', side: 'right' })).toEqual({
      ok: false,
      reason: 'unable, no exit to the right',
    });
    expect(
      sim.command(ac.callsign, [
        { type: 'land', runway: '18R' },
        { type: 'vacate', exit: 'V3', side: 'left' },
      ]),
    ).toEqual([{ ok: true }, { ok: true }]);
    // a departure can't be sent to Ground
    expect(sim.validate('XXX', { type: 'handoff', to: 'ground' }).ok).toBe(false);
    runUntil(sim, () => ac.nav.mode === 'rollout');
    expect(ac.nav.mode === 'rollout' && ac.nav.exit?.name).toBe('V3');
    // V1 is behind it by now
    runUntil(sim, () => -alongNm(ac) * 1852 > 1700);
    expect(sim.validate(ac.callsign, { type: 'vacate', exit: 'V1' }).ok).toBe(false);
    // "contact Ground" on the rollout: the switch waits until it turns off
    expect(sim.command(ac.callsign, [{ type: 'handoff', to: 'ground' }])).toEqual([{ ok: true }]);
    expect(ac.comms).toBe('tower');
    runUntil(sim, () => ac.nav.mode === 'taxi');
    expect(ac.comms).toBe('ground');
    let exitAt = 0;
    const ev = runUntil(sim, () => {
      if (!exitAt && ac.nav.mode === 'taxi') exitAt = -alongNm(ac) * 1852;
      return !sim.aircraft.length;
    });
    expect(exitAt).toBeGreaterThan(2780);
    expect(ev.map((e) => e.type)).toContain('vacated');
  });

  test('departure: calls from the holding point, waits for line-up and take-off clearances, then Departure', () => {
    const sim = towerSim();
    const a = sim.spawn({ kind: 'departure', callsign: 'TRA6015', type: 'B738', route: 'LEKKO' });
    const b = sim.spawn({ kind: 'departure', callsign: 'KLM1717', type: 'A332', route: 'LOPIK' });
    let ev = runUntil(sim, () => false, 30);
    // only the front of the queue calls
    expect(ev.filter((e) => e.type === 'checkIn').map((e) => e.ac)).toEqual([a]);
    expect(a.comms).toBe('tower');
    expect(b.comms).toBe('none');
    // nothing happens without Tower
    expect(a.nav.mode).toBe('holding');
    expect(sim.validate(a.callsign, { type: 'heading', heading: 200 }).reason).toBe('unable, on the ground');
    expect(sim.validate(a.callsign, { type: 'handoff', to: 'departure' }).ok).toBe(false);
    expect(sim.validate(a.callsign, { type: 'lineUp', runway: '18L' }).ok).toBe(false);
    expect(sim.command(a.callsign, [{ type: 'lineUp', runway: '24' }])).toEqual([{ ok: true }]);
    const hp = dep.entry!.path.at(-1)!;
    let calledFrom = Infinity;
    ev = runUntil(
      sim,
      () => {
        if (b.comms === 'tower' && calledFrom === Infinity)
          calledFrom = Math.hypot(b.pos.x - hp.x, b.pos.y - hp.y) * 1852;
        return false;
      },
      90,
    );
    expect(a.nav.mode === 'lineup' && a.nav.ready).toBe(true);
    // the next one moved up, then called from the holding point
    expect(b.comms).toBe('tower');
    expect(calledFrom).toBeLessThan(25);
    expect(ev.filter((e) => e.type === 'checkIn').map((e) => e.ac)).toEqual([b]);
    expect(sim.command(a.callsign, [{ type: 'takeoff', runway: '24' }])).toEqual([{ ok: true }]);
    runUntil(sim, () => a.alt > dep.elevationFt + 1000);
    expect(sim.command(a.callsign, [{ type: 'handoff', to: 'departure' }])).toEqual([{ ok: true }]);
    // off the scene 8 NM out
    ev = runUntil(sim, () => !sim.aircraft.includes(a), 900);
    expect(ev.filter((e) => e.type === 'removed').map((e) => e.ac)).toEqual([a]);
    expect(ev.filter((e) => e.type === 'takeoff').map((e) => e.ac)).toEqual([]); // reported once, at the roll
  });

  test('cleared for take-off straight from the holding point; hold position stops the roll', () => {
    const sim = towerSim();
    const a = sim.spawn({ kind: 'departure', callsign: 'TRA6015', type: 'B738', route: 'LEKKO' });
    sim.command(a.callsign, [{ type: 'takeoff', runway: '24' }]);
    runUntil(sim, () => a.nav.mode === 'takeoff' && a.ias > 60, 200);
    expect(a.nav.mode).toBe('takeoff');
    // no turns on the roll
    expect(sim.command(a.callsign, [{ type: 'heading', heading: 200 }])).toEqual([
      { ok: false, reason: 'unable, on the take-off roll' },
    ]);
    expect(a.nav.mode).toBe('takeoff');
    expect(sim.command(a.callsign, [{ type: 'cancelTakeoff' }])).toEqual([{ ok: true }]);
    runUntil(sim, () => a.ias === 0, 60);
    expect(a.nav.mode === 'lineup' && a.ias).toBe(0);
    expect(sim.runwayOccupants('24')).toEqual([a]);
    // stays put until cleared again
    runUntil(sim, () => false, 60);
    expect(a.nav.mode).toBe('lineup');
    sim.command(a.callsign, [{ type: 'takeoff', runway: '24' }]);
    runUntil(sim, () => a.alt > dep.elevationFt + 500, 200);
    expect(a.alt).toBeGreaterThan(dep.elevationFt + 500);
  });
});

describe('tower mode (T4 rules)', () => {
  /** A Tower that clears every arrival to land on its first call and never says anything else. */
  function perfectTower(types: string[] | undefined, wind = { dir: 0, speed: 0 }, hours = 2) {
    const sim = quietSim({
      tower: true,
      wind,
      traffic: { arrivalsPerHour: 40, departuresPerHour: 0, types },
    });
    const ev: SimEvent[] = [];
    for (let t = 0; t < hours * 3600; t += TICK)
      for (const e of sim.step()) {
        ev.push(e);
        if (e.type === 'checkIn') sim.command(e.ac.callsign, [{ type: 'land', runway: '18R' }]);
      }
    const n = (type: string) => ev.filter((e) => e.type === type).length;
    return { landed: n('landed'), goArounds: n('goAround'), incursions: n('incursion') };
  }

  test.each([
    ['all types', undefined],
    ['light behind heavy and heavy behind light', ['PC12', 'B77W']],
    ['A380 mix', ['A388', 'E190', 'PC12']],
    ['slow and fast', ['E190', 'B77W']],
  ])('stand-in Approach spacing (%s): a perfect Tower never has a go-around', (_, types) => {
    for (const wind of [
      { dir: 0, speed: 0 },
      { dir: 200, speed: 25 },
    ]) {
      const r = perfectTower(types, wind);
      expect(r.goArounds, JSON.stringify({ wind, ...r })).toBe(0);
      expect(r.incursions).toBe(0);
      expect(r.landed).toBeGreaterThan(30);
    }
  });

  test('landing clearance onto an occupied runway: go-around and one incursion', () => {
    const sim = towerSim();
    const a = arrival(sim, { pos: onFinal(2), hdg: rwy.heading, alt: 700, ias: 145 });
    const b = arrival(sim, { callsign: 'EZY88', pos: onFinal(4), hdg: rwy.heading, alt: 1300, ias: 150 });
    runUntil(sim, () => false, 1); // the stand-in Approach clears them for the ILS on the first tick
    expect(sim.command(a.callsign, [{ type: 'land', runway: '18R' }])).toEqual([{ ok: true }]);
    expect(sim.command(b.callsign, [{ type: 'land', runway: '18R' }])).toEqual([{ ok: true }]);
    const ev = runUntil(sim, () => b.phase === 'goaround', 200);
    const inc = ev.filter((e) => e.type === 'incursion');
    expect(inc).toHaveLength(1);
    expect(inc[0]!.type === 'incursion' && [inc[0]!.ac, inc[0]!.other, inc[0]!.what]).toEqual([
      b,
      a,
      'landing',
    ]);
    const ga = ev.find((e) => e.type === 'goAround');
    expect(ga?.type === 'goAround' && ga.ac === b && ga.reason).toBe('runwayOccupied');
    expect(alongNm(b)).toBeGreaterThan(0);
  });

  test('take-off with the previous departure still on the runway, heavy ahead: incursion and wake', () => {
    const sim = towerSim();
    const a = sim.spawn({ kind: 'departure', callsign: 'KLM601', type: 'B77W', route: 'LEKKO' });
    const b = sim.spawn({ kind: 'departure', callsign: 'TRA6015', type: 'B738', route: 'LOPIK' });
    runUntil(sim, () => a.comms === 'tower', 30);
    sim.command(a.callsign, [{ type: 'takeoff', runway: '24' }]);
    runUntil(sim, () => a.nav.mode === 'takeoff', 120);
    // b called once a left the queue
    runUntil(sim, () => b.comms === 'tower', 60);
    sim.command(b.callsign, [{ type: 'takeoff', runway: '24' }]);
    const ev = runUntil(sim, () => !isOnGround(b) && b.alt > 500, 300);
    const inc = ev.filter((e) => e.type === 'incursion');
    expect(inc.map((e) => e.type === 'incursion' && [e.ac.callsign, e.other.callsign, e.what])).toEqual([
      ['TRA6015', 'KLM601', 'takeoff'],
    ]);
    const wake = ev.filter((e) => e.type === 'wakeDeparture');
    expect(wake).toHaveLength(1);
    expect(wake[0]!.type === 'wakeDeparture' && wake[0]!.required).toBe(120);
    const tk = ev.filter((e) => e.type === 'takeoff');
    expect(tk.map((e) => e.type === 'takeoff' && e.ac)).toEqual([b]);
  });

  test('departures spaced properly: no incursion, no wake event', () => {
    const sim = towerSim();
    const a = sim.spawn({ kind: 'departure', callsign: 'KLM601', type: 'B77W', route: 'LEKKO' });
    const b = sim.spawn({ kind: 'departure', callsign: 'TRA6015', type: 'B738', route: 'LOPIK' });
    const ev = runUntil(sim, () => a.comms === 'tower', 30);
    sim.command(a.callsign, [{ type: 'takeoff', runway: '24' }]);
    let aUp = -1;
    ev.push(
      ...runUntil(sim, () => {
        if (aUp < 0 && a.nav.mode === 'direct') aUp = sim.time;
        return aUp > 0 && sim.time - aUp > 100 && b.comms === 'tower';
      }),
    );
    // lined up by now; rolls 25+ s later, so lifts off more than 2 minutes after the heavy
    sim.command(b.callsign, [{ type: 'takeoff', runway: '24' }]);
    ev.push(...runUntil(sim, () => !isOnGround(b), 300));
    expect(ev.filter((e) => e.type === 'incursion' || e.type === 'wakeDeparture')).toEqual([]);
  });

  test('a go-around comes back onto the final later, same callsign', () => {
    const sim = towerSim();
    const ac = arrival(sim, { pos: onFinal(4), hdg: rwy.heading, alt: 1300, ias: 150 });
    const ev = runUntil(sim, () => ev2(), 900);
    function ev2() {
      return sim.aircraft.some((a) => a.callsign === ac.callsign && a !== ac);
    }
    expect(ev.filter((e) => e.type === 'removed').map((e) => e.ac)).toEqual([ac]);
    const back = sim.byCallsign(ac.callsign)!;
    expect(back).not.toBe(ac);
    expect(alongNm(back)).toBeCloseTo(12, 0);
  });
});
