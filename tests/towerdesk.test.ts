import { expect, test } from 'vitest';
import { EHAM, dist, isOnGround, runwayById } from '../src/core';
import { scenarioById } from '../src/game/scenarios';
import { Session } from '../src/game/session';
import { DEFAULT_SETTINGS } from '../src/game/settings';
import { pickTarget, radarFrame, radarPx, targetPx, type RadarTarget } from '../src/render/groundradar';
import { parse } from '../src/phraseology/parser';
import { towerTips } from '../src/ui/overlays';
import { radarTargets, towerBays } from '../src/ui/TowerDesk';

test('ground radar: every runway threshold fits on the map, north up', () => {
  const f = radarFrame(EHAM, 280, 150);
  for (const r of EHAM.runways) {
    const p = radarPx(f, r.pos);
    expect(p.x).toBeGreaterThan(0);
    expect(p.x).toBeLessThan(280);
    expect(p.y).toBeGreaterThan(0);
    expect(p.y).toBeLessThan(150);
  }
  const north = radarPx(f, { x: f.cx, y: f.cy + 1 });
  expect(north.y).toBeLessThan(75);
});

test('ground radar: off-map targets are pinned to the edge and can still be picked', () => {
  const f = radarFrame(EHAM, 280, 150);
  const land = runwayById(EHAM, EHAM.config.landing);
  const far = { x: land.pos.x, y: land.pos.y + 6 }; // 6 NM north, on the 18R final
  const p = targetPx(f, far);
  expect(p.pinned).toBe(true);
  expect(p.y).toBeGreaterThan(0);
  expect(p.y).toBeLessThan(15);
  const targets: RadarTarget[] = [
    { id: 1, pos: far, label: '', style: 'plain', airborne: true },
    { id: 2, pos: land.pos, label: '', style: 'plain', airborne: false },
  ];
  expect(pickTarget(f, targets, p.x, p.y)).toBe(1);
  const q = radarPx(f, land.pos);
  expect(pickTarget(f, targets, q.x + 3, q.y - 2)).toBe(2);
  expect(pickTarget(f, targets, 140, 75)).toBe(null);
});

test('desk bays: each aircraft in at most one bay, the runway bay is the runway occupants', () => {
  const s = new Session(scenarioById('tower-pro-light'), DEFAULT_SETTINGS);
  const land = runwayById(EHAM, EHAM.config.landing);
  let seenRunway = false;
  for (let min = 1; min <= 20; min++) {
    for (let i = 0; i < 600; i++) s.update(100);
    // a careless Tower, straight into the core: clear whoever is on frequency, so the runway gets used
    for (const a of s.sim.aircraft.filter((x) => x.comms === s.mine)) {
      const rw = a.kind === 'arrival' ? EHAM.config.landing : EHAM.config.departure;
      s.sim.command(a.callsign, [{ type: a.kind === 'arrival' ? 'land' : 'lineUp', runway: rw }]);
    }
    const { arrivals, onRunway, departures } = towerBays(s);
    const ids = [...arrivals, ...onRunway, ...departures].map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
    const occ = new Set(
      [...s.sim.runwayOccupants(EHAM.config.landing), ...s.sim.runwayOccupants(EHAM.config.departure)].map(
        (a) => a.id,
      ),
    );
    expect(onRunway.map((a) => a.id).sort()).toEqual([...occ].sort());
    seenRunway ||= onRunway.length > 0;
    expect(arrivals.every((a) => a.kind === 'arrival' && !isOnGround(a))).toBe(true);
    const d = arrivals.map((a) => dist(a.pos, land.pos));
    expect(d).toEqual([...d].sort((a, b) => a - b));
    expect(departures.every((a) => a.kind === 'departure')).toBe(true);
    // every aircraft near the field is a radar target
    const near = s.sim.aircraft.filter((a) => Math.hypot(a.pos.x, a.pos.y) < 12).map((a) => a.id);
    expect(radarTargets(s).map((t) => t.id)).toEqual(near);
  }
  expect(seenRunway).toBe(true);
});

test('help card: every tower tip parses to the right aircraft with no phraseology issue, in every state', () => {
  const s = new Session(scenarioById('tower-free'), DEFAULT_SETTINGS);
  const seen = new Set<string>();
  for (let min = 1; min <= 15; min++) {
    for (let i = 0; i < 600; i++) s.update(100);
    for (const a of s.sim.aircraft.filter((x) => x.comms === s.mine)) {
      for (const tip of towerTips(s, a)) {
        const r = parse(tip, s.parseContext(false));
        expect(r.callsign, tip).toBe(a.callsign);
        expect(r.commands.length, tip).toBeGreaterThan(0);
        expect(r.issues, tip).toEqual([]);
        seen.add(r.commands.map((c) => c.type).join('+'));
      }
      // move the traffic along, as a player would
      const rw = a.kind === 'arrival' ? EHAM.config.landing : EHAM.config.departure;
      s.sim.command(a.callsign, [{ type: a.kind === 'arrival' ? 'land' : 'takeoff', runway: rw }]);
    }
  }
  // the states seen include both clearances, line-up and the vacate-and-Ground call
  expect([...seen]).toEqual(expect.arrayContaining(['land', 'vacate+handoff', 'lineUp', 'takeoff']));
});
