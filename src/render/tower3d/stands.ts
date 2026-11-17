/**
 * Apron scenery from OpenStreetMap stand lines: which stands have an aircraft parked, of what size, and
 * where the jet bridges go. Scenery only: parked aircraft are not in the sim. No WebGL or DOM (runs in tests).
 */
import { Rng, type Airport } from '../../core';
import { llToGround, type BuildingData, type GroundData, type LatLon, type P2 } from './ground';
import { airframe } from './math';

/** public/tower/stands.json */
export interface StandData {
  stands: { ref: string; pts: LatLon[] }[];
  gates: { ref: string; p: LatLon }[];
  bridges: LatLon[][];
  /** Apron floodlight masts; h = 0 when OSM has no height. */
  masts: { p: LatLon; h: number }[];
}

export interface Parked {
  /** Fuselage centre on the ground, world metres. */
  x: number;
  z: number;
  headingDeg: number;
  type: string;
  airline: string;
  ref: string;
}

/** A jet bridge from the building wall (a) to the aircraft's front left door (b), its floor at height y. */
export interface Bridge {
  a: P2;
  b: P2;
  y: number;
}

/** Schiphol is KLM's hub: weights loosely follow the share of movements. */
const NARROW = [
  { type: 'B738', airline: 'KLM', weight: 22 },
  { type: 'E190', airline: 'KLM', weight: 14 },
  { type: 'E195', airline: 'KLM', weight: 6 },
  { type: 'B738', airline: 'TRA', weight: 12 },
  { type: 'A320', airline: 'EZY', weight: 10 },
  { type: 'A321', airline: 'DLH', weight: 4 },
  { type: 'A320', airline: 'BAW', weight: 4 },
  { type: 'B38M', airline: 'RYR', weight: 3 },
  { type: 'A20N', airline: 'AFR', weight: 4 },
  { type: 'A320', airline: '', weight: 6 },
];
const WIDE = [
  { type: 'B77W', airline: 'KLM', weight: 10 },
  { type: 'B789', airline: 'KLM', weight: 10 },
  { type: 'A332', airline: 'KLM', weight: 6 },
  { type: 'B772', airline: 'DAL', weight: 4 },
  { type: 'B77W', airline: 'UAE', weight: 3 },
  { type: 'A333', airline: '', weight: 4 },
];
/** Smaller types to try when the wanted one does not fit, largest first. */
const FALLBACK = ['B789', 'A332', 'A321', 'B738', 'E190'];
const OCCUPIED = 0.68;
const WIDE_SHARE = 0.25;
/** Wingtip clearance kept to other parked aircraft (m). */
const CLEAR = 3;
/** A stand whose stop point is this close to a building is a contact stand and gets a jet bridge. */
const CONTACT_M = 40;

const sub = (a: P2, b: P2): P2 => ({ x: a.x - b.x, z: a.z - b.z });
const add = (a: P2, b: P2, k = 1): P2 => ({ x: a.x + b.x * k, z: a.z + b.z * k });
const len = (a: P2) => Math.hypot(a.x, a.z);

function nearestOnSegment(p: P2, a: P2, b: P2): P2 {
  const ab = sub(b, a);
  const l2 = ab.x * ab.x + ab.z * ab.z;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / l2)) : 0;
  return add(a, ab, t);
}

/** Nearest point on any ring edge. */
function nearestOnRings(p: P2, rings: P2[][]): { q: P2; d: number } {
  let best = { q: p, d: Infinity };
  for (const r of rings)
    for (let i = 1; i < r.length; i++) {
      const q = nearestOnSegment(p, r[i - 1]!, r[i]!);
      const d = len(sub(p, q));
      if (d < best.d) best = { q, d };
    }
  return best;
}

export function insideRing(p: P2, r: P2[]): boolean {
  let c = false;
  for (let i = 0, j = r.length - 1; i < r.length; j = i++) {
    const a = r[i]!;
    const b = r[j]!;
    if (a.z > p.z !== b.z > p.z && p.x < ((b.x - a.x) * (p.z - a.z)) / (b.z - a.z) + a.x) c = !c;
  }
  return c;
}

/** Unit vectors along the nose and to the right wing, for a heading in degrees true (x east, z south). */
export function axes(headingDeg: number): { fwd: P2; right: P2 } {
  const h = (headingDeg * Math.PI) / 180;
  return { fwd: { x: Math.sin(h), z: -Math.cos(h) }, right: { x: Math.cos(h), z: Math.sin(h) } };
}

/** Footprint rectangle corners: length along the nose, span across, with a margin. */
export function footprint(p: Parked, margin = 0): P2[] {
  const T = airframe(p.type);
  const { fwd, right } = axes(p.headingDeg);
  const c = { x: p.x, z: p.z };
  const l = T.len / 2 + margin;
  const s = T.span / 2 + margin;
  return [
    add(add(c, fwd, l), right, s),
    add(add(c, fwd, l), right, -s),
    add(add(c, fwd, -l), right, -s),
    add(add(c, fwd, -l), right, s),
  ];
}

/** Points that must stay clear of buildings: nose, tail, wingtips and the fuselage between. */
export function outline(p: Parked): P2[] {
  const T = airframe(p.type);
  const { fwd, right } = axes(p.headingDeg);
  const c = { x: p.x, z: p.z };
  return [
    add(c, fwd, T.len / 2),
    add(c, fwd, T.len / 4),
    c,
    add(c, fwd, -T.len / 2),
    add(c, right, T.span / 2),
    add(c, right, -T.span / 2),
  ];
}

/** Separating-axis test for two convex quads. */
export function quadsOverlap(a: P2[], b: P2[]): boolean {
  for (const poly of [a, b])
    for (let i = 0; i < poly.length; i++) {
      const p = poly[i]!;
      const q = poly[(i + 1) % poly.length]!;
      const n = { x: q.z - p.z, z: p.x - q.x };
      const proj = (r: P2[]) => r.map((v) => v.x * n.x + v.z * n.z);
      const pa = proj(a);
      const pb = proj(b);
      if (Math.max(...pa) < Math.min(...pb) || Math.max(...pb) < Math.min(...pa)) return false;
    }
  return true;
}

/**
 * Park aircraft on the OSM stands and connect the contact stands to the building with a jet bridge.
 * Seeded, so the apron looks the same every time.
 */
export function parkAircraft(
  ap: Pick<Airport, 'lat' | 'lon'>,
  data: StandData,
  buildings: BuildingData['buildings'],
  taxiways: GroundData['taxiways'] = [],
  seed = 1931,
): { parked: Parked[]; bridges: Bridge[] } {
  const rng = new Rng(seed);
  const taxi = taxiways.map((t) => ({ h: t.w / 2, pts: t.pts.map((p) => llToGround(ap, p)) }));
  const onTaxiway = (c: P2) =>
    taxi.some(({ h, pts }) => pts.slice(1).some((b, i) => len(sub(c, nearestOnSegment(c, pts[i]!, b))) < h));
  // walls standing on the ground; tanks and open roofs left out
  const rings = buildings
    .filter((b) => !b.mh && b.s !== 'plain')
    .map((b) => b.r.map((p) => llToGround(ap, p)));
  const inBuilding = (p: P2) => rings.some((r) => insideRing(p, r));

  // the stop end of a stand line is the end nearer a building (OSM way direction is not reliable)
  const stands = data.stands
    .map((s) => {
      const pts = s.pts.map((p) => llToGround(ap, p));
      if (nearestOnRings(pts[0]!, rings).d < nearestOnRings(pts[pts.length - 1]!, rings).d) pts.reverse();
      const stop = pts[pts.length - 1]!;
      const dir = sub(stop, pts[pts.length - 2]!);
      return { ref: s.ref, stop, headingDeg: ((Math.atan2(dir.x, -dir.z) * 180) / Math.PI + 360) % 360 };
    })
    .filter((s) => Number.isFinite(s.headingDeg));
  // shuffle so overlapping alternative stand lines are decided at random, not by OSM order
  for (let i = stands.length - 1; i > 0; i--) {
    const j = Math.floor(rng.next() * (i + 1));
    [stands[i], stands[j]] = [stands[j]!, stands[i]!];
  }

  const parked: Parked[] = [];
  const prints: P2[][] = [];
  for (const s of stands) {
    const occupied = rng.next() < OCCUPIED;
    const want = rng.weighted(rng.next() < WIDE_SHARE ? WIDE : NARROW);
    if (!occupied) continue;
    const span = airframe(want.type).span;
    const types = [want.type, ...FALLBACK.filter((t) => airframe(t).span < span)];
    for (const type of types) {
      const { fwd } = axes(s.headingDeg);
      // nose gear on the stop mark; the nose gear is 0.36 of the length ahead of the centre
      const c = add(s.stop, fwd, -0.36 * airframe(type).len);
      const p: Parked = { x: c.x, z: c.z, headingDeg: s.headingDeg, type, airline: want.airline, ref: s.ref };
      const fp = footprint(p, CLEAR / 2);
      if (prints.some((q) => quadsOverlap(fp, q)) || outline(p).some(inBuilding) || onTaxiway(c)) continue;
      parked.push(p);
      prints.push(fp);
      break;
    }
  }

  const bridges: Bridge[] = [];
  for (const p of parked) {
    const T = airframe(p.type);
    const { fwd, right } = axes(p.headingDeg);
    const r = T.d / 2;
    const door = add(add({ x: p.x, z: p.z }, fwd, T.len * 0.4), right, -(r + 1));
    const wall = nearestOnRings(door, rings);
    if (wall.d > CONTACT_M || wall.d < 4) continue;
    bridges.push({ a: wall.q, b: door, y: r * 0.6 + T.gearH + 0.28 - r * 0.35 });
  }
  return { parked, bridges };
}

/** A ground service vehicle parked by an aircraft: a box on the apron. */
export interface Vehicle {
  x: number;
  z: number;
  headingDeg: number;
  /** Length, width, height (m). */
  l: number;
  w: number;
  h: number;
  color: string;
}

/** Tug, belt loader, catering truck, fuel truck: length, width, height (m), and the usual colours. */
const VEHICLES = [
  { l: 4.5, w: 2.3, h: 1.7, colors: ['#f2f2ee', '#e5c03a'] },
  { l: 8, w: 2.2, h: 2.2, colors: ['#f2f2ee', '#d9dcdf'] },
  { l: 9, w: 2.5, h: 4, colors: ['#f2f2ee'] },
  { l: 10, w: 2.5, h: 3.2, colors: ['#f2f2ee', '#c9ccce'] },
];

/**
 * Service vehicles around most parked aircraft (seeded): a tug at the nose, and on the right side (the bridge
 * is on the left) a belt loader at the front hold and a truck at the rear, each only some of the time.
 */
export function serviceVehicles(parked: Parked[], seed = 77): Vehicle[] {
  const rng = new Rng(seed);
  const out: Vehicle[] = [];
  for (const p of parked) {
    if (rng.next() > 0.7) continue;
    const T = airframe(p.type);
    const { fwd, right } = axes(p.headingDeg);
    const c = { x: p.x, z: p.z };
    const r = T.d / 2;
    const put = (along: number, side: number, kind: number, turn: number) => {
      const v = VEHICLES[kind]!;
      const at = add(add(c, fwd, along), right, side);
      out.push({
        ...at,
        headingDeg: (p.headingDeg + turn + 360) % 360,
        l: v.l,
        w: v.w,
        h: v.h,
        color: rng.pick(v.colors),
      });
    };
    if (rng.next() < 0.6) put(T.len / 2 + 4, 0, 0, 0);
    if (rng.next() < 0.7) put(T.len * 0.2, r + 2.5, 1, 20);
    if (rng.next() < 0.6) put(-T.len * 0.25, r + 3.5, rng.next() < 0.5 ? 2 : 3, 0);
  }
  return out;
}
