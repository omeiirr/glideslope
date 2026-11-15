import { expect, test } from 'vitest';
import manifest from '../public/tower/manifest.json';
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
  tilePixel,
  tileRect,
  toWorld,
  type ImageryManifest,
} from '../src/render/tower3d/math';

const m = manifest as ImageryManifest;

test.each(['18R', '24'])('runway %s threshold lies on the imagery where the sim puts it', (id) => {
  const rw = runwayById(EHAM, id);
  const tiers = m.tiers.filter((t) => t.metresPerPixel <= 4);
  expect(tiers.length).toBeGreaterThan(0);
  for (const tier of tiers) {
    const tile = tier.tiles.find(
      (t) => rw.lat > t.south && rw.lat < t.north && rw.lon > t.west && rw.lon < t.east,
    );
    if (!tile) continue;
    const px = tilePixel(tile, rw.lat, rw.lon);
    // the tile's world rectangle maps that pixel back onto the sim's threshold, to within a pixel
    const r = tileRect(tile, EHAM);
    const wx = r.cx - r.width / 2 + (px.x / tile.w) * r.width;
    const wz = r.cz - r.depth / 2 + (px.y / tile.h) * r.depth;
    const want = toWorld(rw.pos);
    expect(Math.abs(wx - want.x)).toBeLessThan(tier.metresPerPixel);
    expect(Math.abs(wz - want.z)).toBeLessThan(tier.metresPerPixel);
  }
});

test('imagery tiles are at most 2048 px', () => {
  for (const t of m.tiers.flatMap((t) => t.tiles)) expect(Math.max(t.w, t.h)).toBeLessThanOrEqual(2048);
});

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
  const a = new Session(scenarioById('tower-preview'), DEFAULT_SETTINGS);
  const b = new Session(scenarioById('tower-preview'), DEFAULT_SETTINGS);
  for (let t = 0; t <= 10000; t += 16) {
    a.frame(t);
    a.frame(t);
    b.frame(t);
  }
  expect(a.sim.time).toBe(b.sim.time);
  expect(a.sim.time).toBeGreaterThan(5);
});

test('tower preview arrivals are cleared for the ILS and land', () => {
  const s = new Session(scenarioById('tower-preview'), DEFAULT_SETTINGS);
  for (let t = 0; t < 4 * 60_000; t += 100) s.update(100);
  expect(s.stats.landed).toBeGreaterThan(0);
  expect(s.stats.goArounds).toBe(0);
});
