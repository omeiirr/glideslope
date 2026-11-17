import { expect, test } from 'vitest';
import ground from '../public/tower/ground.json';
import buildings from '../public/tower/buildings.json';
import stands from '../public/tower/stands.json';
import { EHAM, runwayById, type PlannedDeparture } from '../src/core';
import type { BuildingData, GroundData, P2 } from '../src/render/tower3d/ground';
import {
  buildingRings,
  orientStands,
  parkAircraft,
  standFitter,
  type StandData,
} from '../src/render/tower3d/stands';
import { GroundTraffic, buildTaxiGraph, crossesRunway, type SimTarget } from '../src/render/tower3d/taxi';
import { toWorld } from '../src/render/tower3d/math';

const B = (buildings as unknown as BuildingData).buildings;
const G = ground as unknown as GroundData;
const S = stands as unknown as StandData;
const w = (v: { x: number; y: number }): P2 => {
  const p = toWorld(v);
  return { x: p.x, z: p.z };
};

/** Distance from a point to the nearest edge of the network. */
function offLine(g: ReturnType<typeof buildTaxiGraph>['graph'], p: P2): number {
  let best = Infinity;
  g.adj.forEach((es, a) =>
    es.forEach(({ to }) => {
      const A = g.nodes[a]!;
      const B = g.nodes[to]!;
      const l2 = (B.x - A.x) ** 2 + (B.z - A.z) ** 2;
      const t = l2
        ? Math.max(0, Math.min(1, ((p.x - A.x) * (B.x - A.x) + (p.z - A.z) * (B.z - A.z)) / l2))
        : 0;
      best = Math.min(best, Math.hypot(p.x - A.x - (B.x - A.x) * t, p.z - A.z - (B.z - A.z) * t));
    }),
  );
  return best;
}

const RUNWAYS = [runwayById(EHAM, '18R')!, runwayById(EHAM, '24')!];

function setup() {
  const rings = buildingRings(EHAM, B);
  const oriented = orientStands(EHAM, S, rings);
  const { graph, standNode, standEntry } = buildTaxiGraph(EHAM, G.taxiways, oriented);
  const { parked } = parkAircraft(EHAM, S, B, G.taxiways);
  return {
    graph,
    standNode,
    traffic: new GroundTraffic(
      graph,
      oriented,
      standNode,
      standEntry,
      standFitter(EHAM, rings, G.taxiways),
      parked,
      RUNWAYS,
    ),
  };
}

const target = (id: number, pos: P2, hdg: number): SimTarget => ({
  id,
  kind: 'arrival',
  type: 'A320',
  airline: 'KLM',
  pose: {
    pos: { x: pos.x, y: 0, z: pos.z },
    headingDeg: hdg,
    pitchDeg: 0,
    gearDown: true,
    onGround: true,
    aglM: 0,
  },
});

test('taxi network: the departure holding point and the 18R exits reach most stands', () => {
  const { graph, standNode } = setup();
  expect(graph.nodes.length).toBeGreaterThan(3000);
  // every stand with a route from S7E (checked through the GroundTraffic below); here: the graph is one piece
  const seen = new Set([standNode.values().next().value!]);
  const todo = [...seen];
  while (todo.length)
    for (const { to } of graph.adj[todo.pop()!]!)
      if (!seen.has(to)) {
        seen.add(to);
        todo.push(to);
      }
  const reached = [...standNode.values()].filter((n) => seen.has(n)).length;
  expect(reached / standNode.size).toBeGreaterThan(0.85);
});

test('scenery taxiing: a vacated arrival taxis to a stand smoothly and parks; a planned departure meets its queue slot', () => {
  const { traffic, graph } = setup();
  const exit = runwayById(EHAM, '18R')!.exits![2]!;
  const hold = w(exit.path[exit.path.length - 1]!);
  const tail = { pos: w(runwayById(EHAM, '24')!.entry!.path.at(-1)!), face: 240 };
  const dep: PlannedDeparture = { at: 600, callsign: 'EZY12', type: 'A319', airline: 'EZY' };

  // the arrival is in the sim at t=0, gone (vacated) at t=0.5
  expect(traffic.update(0, [target(7, hold, 270)], [dep], tail)).toHaveLength(1); // the departure waits at its stand
  let prev = new Map<number, P2>();
  let maxStep = 0;
  let arrivalEnd: P2 | null = null;
  let maxOff = 0;
  const tracks: Record<number, P2[]> = {};
  for (let t = 0.5; t < 1500; t += 0.5) {
    const ghosts = traffic.update(t, [], t < dep.at ? [dep] : [], tail);
    for (const g of ghosts) {
      const p = { x: g.pose.pos.x, z: g.pose.pos.z };
      const q = prev.get(g.id);
      if (q) maxStep = Math.max(maxStep, Math.hypot(p.x - q.x, p.z - q.z));
      if (g.type === 'A320') arrivalEnd = p;
      if (t % 10 === 0) maxOff = Math.max(maxOff, offLine(graph, p));
      if (t > 60 && t < dep.at - 60) (tracks[g.id] ??= []).push(p);
    }
    if (t === dep.at - 0.5) {
      const d = ghosts.find((g) => g.type === 'A319')!;
      expect(Math.hypot(d.pose.pos.x - tail.pos.x, d.pose.pos.z - tail.pos.z)).toBeLessThan(2);
      expect(Math.abs(d.pose.headingDeg - 240)).toBeLessThan(5); // finishing its turn onto the queue
    }
    if (t === dep.at) expect(ghosts.some((g) => g.type === 'A319')).toBe(false);
    prev = new Map(ghosts.map((g) => [g.id, { x: g.pose.pos.x, z: g.pose.pos.z }]));
  }
  // on the lines: corners are rounded, never cut across the grass (the parking spot is behind the stop mark)
  expect(maxOff).toBeLessThan(5);
  // away from the exit and the holding point, never on an active runway
  for (const tr of Object.values(tracks)) expect(crossesRunway(tr, RUNWAYS)).toBe(false);
  // never faster than taxi speed (8 m/s → 4 m per half second)
  expect(maxStep).toBeLessThan(4.1);
  // the arrival ended up far from the runway, at a stand, and stays there
  expect(Math.hypot(arrivalEnd!.x - hold.x, arrivalEnd!.z - hold.z)).toBeGreaterThan(1500);
  const still = traffic.update(1500, [], [], tail);
  expect(still).toHaveLength(1);
  expect(still[0]!.pose.pos.x).toBeCloseTo(arrivalEnd!.x, 3);
});

test('scenery taxiing: aircraft hold for traffic ahead, and appear only out of view', () => {
  const exit = runwayById(EHAM, '18R')!.exits![2]!;
  const hold = w(exit.path[exit.path.length - 1]!);
  const tail = { pos: w(runwayById(EHAM, '24')!.entry!.path.at(-1)!), face: 240 };
  const dep: PlannedDeparture = { at: 900, callsign: 'EZY12', type: 'A319', airline: 'EZY' };
  // the stand it gets when nothing is in view...
  const free = setup().traffic.update(0, [], [dep], tail)[0]!.pose.pos;
  // ...is skipped while the camera looks at it
  const { traffic } = setup();
  const near = (p: P2) => Math.hypot(p.x - free.x, p.z - free.z) < 100;
  traffic.seen = near;
  const first = traffic.update(0, [], [dep], tail);
  expect(first).toHaveLength(1);
  expect(near(first[0]!.pose.pos)).toBe(false);

  // two arrivals vacate at the same exit 6 s apart (closer than real): once both move, the second keeps a length back
  traffic.update(0.5, [target(7, hold, 270)], [dep], tail);
  let closest = Infinity;
  let ids: number[] = [];
  for (let t = 1; t < 400; t += 0.5) {
    const sim = t < 7 ? [target(8, hold, 270)] : [];
    const ghosts = traffic.update(t, sim, [dep], tail).filter((g) => g.type === 'A320');
    if (ghosts.length === 2) {
      ids = ghosts.map((g) => g.id);
      const [a, b] = ghosts.map((g) => g.pose.pos);
      // until the first turns off towards its own stand
      if (t > 20 && t < 120) closest = Math.min(closest, Math.hypot(a!.x - b!.x, a!.z - b!.z));
    }
  }
  expect(ids).toHaveLength(2);
  expect(closest).toBeGreaterThan(45);
});
