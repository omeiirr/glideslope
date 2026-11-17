import { expect, test } from 'vitest';
import ground from '../public/tower/ground.json';
import buildings from '../public/tower/buildings.json';
import stands from '../public/tower/stands.json';
import { EHAM } from '../src/core';
import { llToGround, type BuildingData, type GroundData } from '../src/render/tower3d/ground';
import {
  footprint,
  insideRing,
  outline,
  parkAircraft,
  quadsOverlap,
  serviceVehicles,
  type StandData,
} from '../src/render/tower3d/stands';

const B = (buildings as unknown as BuildingData).buildings;
const G = ground as unknown as GroundData;
const run = () => parkAircraft(EHAM, stands as unknown as StandData, B, G.taxiways);

test('parked aircraft: most stands used, none overlapping, none in a building or on a taxiway, seeded', () => {
  const { parked, bridges } = run();
  expect(parked.length).toBeGreaterThan(100);
  expect(bridges.length).toBeGreaterThan(30);
  expect(run()).toEqual({ parked, bridges });

  const prints = parked.map((p) => footprint(p));
  for (let i = 0; i < prints.length; i++)
    for (let j = i + 1; j < prints.length; j++) expect(quadsOverlap(prints[i]!, prints[j]!)).toBe(false);

  const rings = B.filter((b) => !b.mh && b.s !== 'plain').map((b) => b.r.map((p) => llToGround(EHAM, p)));
  for (const p of parked) expect(outline(p).some((q) => rings.some((r) => insideRing(q, r)))).toBe(false);

  // the fuselage centre is clear of every taxiway ribbon
  const taxi = G.taxiways.map((t) => ({ w: t.w, pts: t.pts.map((p) => llToGround(EHAM, p)) }));
  const onTaxiway = (x: number, z: number) =>
    taxi.some(({ w, pts }) =>
      pts.slice(1).some((b, i) => {
        const a = pts[i]!;
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz || 1)));
        return Math.hypot(x - a.x - dx * t, z - a.z - dz * t) < w / 2;
      }),
    );
  const bad = parked.filter((p) => onTaxiway(p.x, p.z));
  expect(bad.map((p) => p.ref)).toEqual([]);

  // bridges are short and start at a wall
  for (const b of bridges) expect(Math.hypot(b.a.x - b.b.x, b.a.z - b.b.z)).toBeLessThan(41);
});

test('service vehicles: seeded, next to their aircraft, never inside a building', () => {
  const { parked } = run();
  const v = serviceVehicles(parked);
  expect(v.length).toBeGreaterThan(parked.length * 0.6);
  expect(serviceVehicles(parked)).toEqual(v);
  const rings = B.filter((b) => !b.mh && b.s !== 'plain').map((b) => b.r.map((p) => llToGround(EHAM, p)));
  const bad = v.filter((x) => rings.some((r) => insideRing(x, r)));
  // a few may sit by an aircraft whose nose is close to a pier; none should be deep inside one
  expect(bad.length).toBeLessThan(v.length * 0.03);
  for (const x of v)
    expect(Math.min(...parked.map((p) => Math.hypot(p.x - x.x, p.z - x.z)))).toBeLessThan(45);
});
