import { expect, test } from 'vitest';
import { EHAM, TICK, runwayById, type Aircraft } from '../src/core';
import { scenarioById } from '../src/game/scenarios';
import { Session } from '../src/game/session';
import { DEFAULT_SETTINGS } from '../src/game/settings';
import {
  aimAt,
  aircraftPose,
  airframe,
  eyePosition,
  lookDirection,
  toWorld,
} from '../src/render/tower3d/math';

test('aimAt inverts lookDirection', () => {
  const eye = eyePosition(EHAM.towers[0]!);
  for (const [b, d] of [
    [10, 2],
    [200, -5],
    [335, 12],
  ] as const) {
    const v = lookDirection(b, d);
    const r = aimAt(eye, { x: eye.x + v.x * 5000, y: eye.y + v.y * 5000, z: eye.z + v.z * 5000 });
    expect(r.bearing).toBeCloseTo(b, 6);
    expect(r.depression).toBeCloseTo(d, 6);
  }
});

const ac = (o: Partial<Aircraft>) =>
  ({
    pos: { x: 0, y: 0 },
    track: 180,
    hdg: 180,
    gs: 140,
    ias: 140,
    vs: 0,
    alt: EHAM.elevationFt,
    phase: 'rollout',
    kind: 'arrival',
    ...o,
  }) as Aircraft;

test('pose: on the runway the gear is down and the nose level', () => {
  const p = aircraftPose(ac({}), EHAM, 0, TICK);
  expect(p).toMatchObject({ onGround: true, gearDown: true, pitchDeg: 0, aglM: 0 });
});

test('pose: a climbing departure pitches up and raises the gear; position extrapolates along track', () => {
  const p = aircraftPose(
    ac({ kind: 'departure', phase: 'flight', alt: 4000, vs: 2500, gs: 250, ias: 250, track: 90 }),
    EHAM,
    1,
    TICK,
  );
  expect(p.onGround).toBe(false);
  expect(p.gearDown).toBe(false);
  expect(p.pitchDeg).toBeGreaterThan(5);
  expect(p.pos.x).toBeCloseTo((250 / 3600) * TICK * 1852, 3);
  expect(p.pos.z).toBeCloseTo(0, 6);
});

test('pose: an arrival on short final has the gear down', () => {
  const p = aircraftPose(ac({ phase: 'approach', alt: 1200, vs: -700 }), EHAM, 0, TICK);
  expect(p.gearDown).toBe(true);
  expect(p.pitchDeg).toBeGreaterThan(0);
});

test('unknown types fall back to a B738 airframe', () => {
  expect(airframe('ZZZZ')).toEqual(airframe('B738'));
});

test('two views calling frame() with the same timestamp advance the sim once', () => {
  const a = new Session(scenarioById('tower-pro-light'), DEFAULT_SETTINGS);
  const b = new Session(scenarioById('tower-pro-light'), DEFAULT_SETTINGS);
  for (let t = 0; t <= 10000; t += 16) {
    a.frame(t);
    a.frame(t);
    b.frame(t);
  }
  expect(a.sim.time).toBe(b.sim.time);
  expect(a.sim.time).toBeGreaterThan(5);
});

test('tower scenario: the stand-in Approach puts arrivals on the ILS and hands them to Tower', () => {
  const s = new Session(scenarioById('tower-pro-light'), DEFAULT_SETTINGS);
  for (let t = 0; t < 30_000; t += 100) s.update(100);
  const first = s.sim.aircraft.find((a) => a.kind === 'arrival')!;
  expect(first.nav.mode).toBe('loc');
  expect(first.comms).toBe('tower');
  expect(s.parseContext(false).aircraft.map((a) => a.callsign)).toContain(first.callsign);
});

// ------------------------------------------------------------------ airport surfaces (OSM + drawn markings)
import ground from '../public/tower/ground.json';
import land from '../public/tower/land.json';
import {
  llToGround,
  reciprocal,
  ribbon,
  runwayFrame,
  runwayMarkings,
  type GroundData,
  type LandData,
  type P2,
} from '../src/render/tower3d/ground';

const g = ground as unknown as GroundData;

function inPolygon(p: P2, ring: P2[]) {
  let c = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i]!;
    const b = ring[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

const corners = (tris: number[]) => {
  const pts: P2[] = [];
  for (let i = 0; i < tris.length; i += 2) pts.push({ x: tris[i]!, z: tris[i + 1]! });
  return pts;
};

test.each(['18R', '36L', '24', '06'])(
  'runway %s markings lie on the runway, threshold stripes from 6 m past the threshold',
  (id) => {
    const rw = runwayById(EHAM, id);
    const f = runwayFrame(rw, EHAM);
    const { tris, designator } = runwayMarkings(rw, f);
    expect(tris.length % 6).toBe(0);
    for (const p of corners(tris)) {
      const dx = p.x - f.thr.x;
      const dz = p.z - f.thr.z;
      const s = dx * f.along.x + dz * f.along.z;
      const t = dx * f.right.x + dz * f.right.z;
      expect(s).toBeGreaterThanOrEqual(6 - 1e-6);
      expect(s).toBeLessThanOrEqual(f.lengthM / 2);
      expect(Math.abs(t)).toBeLessThanOrEqual(f.widthM / 2);
    }
    // the far threshold is the reciprocal runway's threshold
    const far = toWorld(reciprocal(rw, EHAM)!.pos);
    const end = { x: f.thr.x + f.along.x * f.lengthM, z: f.thr.z + f.along.z * f.lengthM };
    expect(Math.hypot(end.x - far.x, end.z - far.z)).toBeLessThan(60);
    expect(designator.number).toBe(id.slice(0, 2));
  },
);

// 24 guards the 70 m threshold correction in build-eham.py (openScope's point lay beyond the pavement)
test.each(['18R', '24'])(
  'OSM runway area and the sim agree: the %s threshold lies inside an OSM runway polygon',
  (id) => {
    const thr = toWorld(runwayById(EHAM, id).pos);
    const rings = g.runways.map((poly) => poly[0]!.map((p) => llToGround(EHAM, p)));
    expect(rings.some((r) => inPolygon({ x: thr.x, z: thr.z }, r))).toBe(true);
  },
);

test('ribbon: one quad per segment plus a round join per bend', () => {
  const pts = [
    { x: 0, z: 0 },
    { x: 100, z: 0 },
    { x: 100, z: 100 },
  ];
  const t = ribbon(pts, 20);
  expect(t.length / 6).toBe(2 * 2 + 10);
  // the outside of the bend is covered: a point 9 m out from the corner diagonally
  const tris = corners(t);
  const covered = (p: P2) => {
    for (let i = 0; i < tris.length; i += 3)
      if (inPolygon(p, [tris[i]!, tris[i + 1]!, tris[i + 2]!])) return true;
    return false;
  };
  expect(covered({ x: 106, z: -6 })).toBe(true);
  expect(covered({ x: 50, z: 30 })).toBe(false);
});

test('ground data: airside grass, taxiways and holding positions are present', () => {
  expect(g.taxiways.length).toBeGreaterThan(100);
  expect(g.grass.length).toBeGreaterThan(50);
  expect(g.holds.length).toBeGreaterThan(10);
  expect(g.attribution).toMatch(/OpenStreetMap/);
});

test('land data: surroundings and airport buildings are present and plausible', () => {
  const l = land as unknown as LandData;
  for (const cls of ['farm', 'residential', 'industrial', 'forest', 'water'])
    expect(l.land[cls]?.length ?? 0).toBeGreaterThan(10);
  expect(l.roads.length).toBeGreaterThan(50);
  expect(l.buildings.length).toBeGreaterThan(100);
  for (const b of l.buildings) {
    expect(b.h).toBeGreaterThan(0);
    expect(b.h).toBeLessThan(150);
    expect(b.r.length).toBeGreaterThanOrEqual(4);
    // inside the airport fence, which reaches past the far end of the Polderbaan
    const p = llToGround(EHAM, b.r[0]!);
    expect(Math.hypot(p.x, p.z)).toBeLessThan(10000);
  }
});
