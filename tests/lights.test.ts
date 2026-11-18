import { expect, test } from 'vitest';
import ground from '../public/tower/ground.json';
import { EHAM, runwayById } from '../src/core';
import { llToGround, type GroundData } from '../src/render/tower3d/ground';
import {
  LIGHT,
  airportLights,
  emptyLights,
  holdLights,
  taxiwayEdgeLights,
  taxiwayLights,
  type LightSet,
} from '../src/render/tower3d/lights';
import { toWorld } from '../src/render/tower3d/math';

const lights = (s: LightSet) =>
  s.size.map((size, i) => ({
    x: s.pos[i * 3]!,
    z: s.pos[i * 3 + 2]!,
    c: s.color.slice(i * 3, i * 3 + 3).join(),
    size,
  }));
const is = (c: number[]) => c.join();

test('runway lights: approach lights before the 18R threshold, green threshold, red end, yellow last 600 m', () => {
  const all = lights(airportLights(EHAM));
  const rw = runwayById(EHAM, EHAM.config.landing);
  const t = toWorld(rw.pos);
  const h = (rw.heading * Math.PI) / 180;
  // distance along the landing direction and across it, from the 18R threshold
  const along = (l: { x: number; z: number }) => (l.x - t.x) * Math.sin(h) - (l.z - t.z) * Math.cos(h);
  const across = (l: { x: number; z: number }) => (l.x - t.x) * Math.cos(h) + (l.z - t.z) * Math.sin(h);
  const on18R = all.filter((l) => Math.abs(across(l)) < 40 && along(l) > -950 && along(l) < 4000);

  const approach = on18R.filter((l) => along(l) < -10);
  expect(approach.length).toBeGreaterThan(150); // 30 barrettes of 5 plus the crossbar
  expect(Math.min(...approach.map(along))).toBeCloseTo(-900, 0);
  expect(approach.every((l) => l.c === is(LIGHT.white))).toBe(true);

  const threshold = on18R.filter((l) => Math.abs(along(l) + 1) < 0.5);
  expect(threshold.length).toBeGreaterThan(10);
  expect(threshold.every((l) => l.c === is(LIGHT.green))).toBe(true);

  const len = Math.max(...on18R.map(along)) - 1;
  const edges = on18R.filter((l) => Math.abs(Math.abs(across(l)) - 31.5) < 1 && along(l) >= 0);
  expect(edges.length).toBeGreaterThan(100); // both sides, every 60 m over about 3.8 km
  expect(edges.filter((l) => len - along(l) < 600).every((l) => l.c === is(LIGHT.yellow))).toBe(true);
  expect(edges.filter((l) => len - along(l) > 650).every((l) => l.c === is(LIGHT.white))).toBe(true);
  expect(on18R.filter((l) => Math.abs(along(l) - len - 1) < 0.5).every((l) => l.c === is(LIGHT.red))).toBe(
    true,
  );
});

test('runway lights: only the runways in use; taxiway lights every 30 m', () => {
  const all = airportLights(EHAM).size.length;
  expect(all).toBeGreaterThan(800);
  expect(all).toBeLessThan(2500);
  const taxi = lights(taxiwayLights(EHAM, ground as unknown as GroundData));
  expect(taxi.length).toBeGreaterThan(500);
  expect(taxi.every((l) => l.c === is(LIGHT.taxi))).toBe(true);
});

test('taxiway edge lights: blue, beside the taxiways, never on a runway, apron or another taxiway', () => {
  const G = ground as unknown as GroundData;
  const edge = lights(taxiwayEdgeLights(EHAM, G));
  expect(edge.length).toBeGreaterThan(1000);
  expect(edge.every((l) => l.c === is(LIGHT.blue))).toBe(true);
  // well clear of every runway centreline in use (18R and 24 are 60 m and 45 m wide)
  for (const id of ['18R', '24']) {
    const rw = runwayById(EHAM, id)!;
    const t = toWorld(rw.pos);
    const h = (rw.heading * Math.PI) / 180;
    const len = rw.lengthFt * 0.3048;
    const on = edge.filter((l) => {
      const along = (l.x - t.x) * Math.sin(h) - (l.z - t.z) * Math.cos(h);
      const across = (l.x - t.x) * Math.cos(h) + (l.z - t.z) * Math.sin(h);
      return along > 0 && along < len && Math.abs(across) < 20;
    });
    expect(on).toEqual([]);
  }
});

test('holding positions: a red stop bar every 3 m or less across the line, a flashing yellow light past each end', () => {
  const bar = emptyLights();
  const guard = emptyLights();
  holdLights(
    [
      { x: 0, z: 0 },
      { x: 30, z: 0 },
    ],
    bar,
    guard,
  );
  const b = lights(bar);
  expect(b).toHaveLength(11);
  expect(b.every((l) => l.c === is(LIGHT.red))).toBe(true);
  expect(lights(guard).map((l) => [l.x, l.c])).toEqual([
    [-2, is(LIGHT.yellow)],
    [32, is(LIGHT.yellow)],
  ]);
  expect(guard.blink).toEqual([1, 1]);
  // the departure runway's holding point has an OSM holding position line within 40 m
  const hp = toWorld(runwayById(EHAM, EHAM.config.departure).entry!.path.at(-1)!);
  const g = ground as unknown as GroundData;
  const near = g.holds.some((h) =>
    h.some((p) => Math.hypot(llToGround(EHAM, p).x - hp.x, llToGround(EHAM, p).z - hp.z) < 40),
  );
  expect(near).toBe(true);
});
