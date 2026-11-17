/**
 * Airport surface layout for the tower view: taxiway ribbons and runway markings as flat triangles.
 * No WebGL or DOM (runs in tests). Output is world metres on the ground plane: [x0, z0, x1, z1, ...]
 * in triangle order. Polygons (aprons, runway areas) are triangulated by the renderer.
 */
import { headingVec, project, reciprocalRunway, type Airport, type Runway } from '../../core';
import { M_PER_NM, toWorld } from './math';

export type LatLon = [number, number];
/** A polygon: outer ring first, then holes. */
export type Polygon = LatLon[][];

export interface GroundData {
  attribution: string;
  runways: Polygon[];
  aprons: Polygon[];
  taxiwayAreas: Polygon[];
  taxiways: { w: number; pts: LatLon[] }[];
  holds: LatLon[][];
  /** Airside grass. */
  grass: Polygon[];
}

/** Modelled surroundings (public/tower/land.json). */
export interface LandData {
  /** Land use by class: farm, residential, industrial, forest, park, greenhouse, water. */
  land: Record<string, Polygon[]>;
  roads: { w: number; pts: LatLon[] }[];
  /** Height in metres, kind (OSM building value), outer ring. */
  buildings: { h: number; k: string; r: LatLon[] }[];
}

export interface P2 {
  x: number;
  z: number;
}

export const llToGround = (ap: Pick<Airport, 'lat' | 'lon'>, [lat, lon]: LatLon): P2 => {
  const w = toWorld(project(lat, lon, ap.lat, ap.lon));
  return { x: w.x, z: w.z };
};

/** Push a quad from a centre segment a→b with half-width h. */
function quad(out: number[], a: P2, b: P2, h: number) {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const len = Math.hypot(dx, dz);
  if (len < 1e-6) return;
  const nx = (-dz / len) * h;
  const nz = (dx / len) * h;
  out.push(a.x + nx, a.z + nz, b.x + nx, b.z + nz, b.x - nx, b.z - nz);
  out.push(a.x + nx, a.z + nz, b.x - nx, b.z - nz, a.x - nx, a.z - nz);
}

function disc(out: number[], c: P2, r: number, n = 10) {
  for (let i = 0; i < n; i++) {
    const a0 = (i / n) * Math.PI * 2;
    const a1 = ((i + 1) / n) * Math.PI * 2;
    out.push(
      c.x,
      c.z,
      c.x + Math.cos(a0) * r,
      c.z + Math.sin(a0) * r,
      c.x + Math.cos(a1) * r,
      c.z + Math.sin(a1) * r,
    );
  }
}

/** A line of width w along a polyline, with round joins so bends have no gaps. */
export function ribbon(pts: P2[], w: number, out: number[] = []): number[] {
  for (let i = 1; i < pts.length; i++) quad(out, pts[i - 1]!, pts[i]!, w / 2);
  for (let i = 1; i < pts.length - 1; i++) disc(out, pts[i]!, w / 2);
  return out;
}

/**
 * A soft band along a polyline (the worn, rubber-dark middle of a taxiway): triangles [x, z, ...] and a
 * weight per vertex, 1 on the line fading to 0 at h either side.
 */
export function softBand(pts: P2[], h: number): { tris: number[]; weight: number[] } {
  const tris: number[] = [];
  const weight: number[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const len = Math.hypot(b.x - a.x, b.z - a.z);
    if (len < 1e-6) continue;
    const nx = (-(b.z - a.z) / len) * h;
    const nz = ((b.x - a.x) / len) * h;
    for (const s of [1, -1]) {
      const ea = { x: a.x + nx * s, z: a.z + nz * s };
      const eb = { x: b.x + nx * s, z: b.z + nz * s };
      tris.push(a.x, a.z, b.x, b.z, eb.x, eb.z, a.x, a.z, eb.x, eb.z, ea.x, ea.z);
      weight.push(1, 1, 0, 1, 0, 0);
    }
  }
  return { tris, weight };
}

/** The runway rectangle between a threshold and the opposite one. */
export interface RunwayFrame {
  /** Threshold, world metres. */
  thr: P2;
  /** Unit vector along the landing direction and to the right of it. */
  along: P2;
  right: P2;
  lengthM: number;
  widthM: number;
}

const FT = 0.3048;

/**
 * The runway from this threshold to the opposite one. `lengthFt` in the data is the whole pavement
 * (OurAirports), which runs past the thresholds; the pavement beyond is drawn from the OSM runway areas.
 */
export function runwayFrame(rw: Runway, ap: Pick<Airport, 'runways'>): RunwayFrame {
  const thr = toWorld(rw.pos);
  const opp = reciprocal(rw, ap);
  const v = headingVec(rw.heading, 1);
  // world z points south: a heading vector (east, north) becomes (x, -y)
  const along = { x: v.x, z: -v.y };
  return {
    thr: { x: thr.x, z: thr.z },
    along,
    right: { x: -along.z, z: along.x },
    lengthM: opp ? Math.hypot(opp.pos.x - rw.pos.x, opp.pos.y - rw.pos.y) * M_PER_NM : rw.lengthFt * FT,
    widthM: rw.widthFt * FT,
  };
}

/** Point at `s` metres along the runway from the threshold and `t` metres to the right of the centreline. */
export const at = (f: RunwayFrame, s: number, t: number): P2 => ({
  x: f.thr.x + f.along.x * s + f.right.x * t,
  z: f.thr.z + f.along.z * s + f.right.z * t,
});

/** Axis-aligned (in runway coordinates) rectangle from s0..s1 along and t0..t1 across. */
function rect(out: number[], f: RunwayFrame, s0: number, s1: number, t0: number, t1: number) {
  const a = at(f, s0, t0);
  const b = at(f, s1, t0);
  const c = at(f, s1, t1);
  const d = at(f, s0, t1);
  out.push(a.x, a.z, b.x, b.z, c.x, c.z, a.x, a.z, c.x, c.z, d.x, d.z);
}

/** The runway surface between its two thresholds. */
export function runwaySurface(f: RunwayFrame, out: number[] = []): number[] {
  rect(out, f, 0, f.lengthM, -f.widthM / 2, f.widthM / 2);
  return out;
}

export interface Designator {
  /** "18" and optionally "R"/"L"/"C". */
  number: string;
  letter: string;
  /** Centre of the number, and of the letter (nearer the threshold). */
  numberAt: P2;
  letterAt: P2;
  headingDeg: number;
}

/**
 * Runway markings for one landing direction (ICAO Annex 14 vol. I §5.2, simplified; see DECISIONS.md):
 * threshold stripes, designator, touchdown zone and aiming point, centreline. Edge stripes are drawn once
 * per runway by `runwayEdges`. Only the first half of the runway is marked from this end.
 */
export function runwayMarkings(
  rw: Runway,
  f: RunwayFrame,
  out: number[] = [],
): { tris: number[]; designator: Designator } {
  // threshold: stripes 30 m long from 6 m past the threshold, 1.8 m wide with 1.8 m gaps, split at the centreline
  const stripes = f.widthM >= 60 ? 16 : f.widthM >= 45 ? 12 : 8;
  const sw = 1.8;
  const perSide = stripes / 2;
  for (let i = 0; i < perSide; i++) {
    const t = 3 + i * sw * 2 - 0.9; // inner edge 2.1 m from the centreline
    rect(out, f, 6, 36, t, t + sw);
    rect(out, f, 6, 36, -t - sw, -t);
  }
  // designator 9 m tall: letter first, then the number, as read by an approaching pilot
  const m = /^(\d+)([LRC]?)$/.exec(rw.id);
  const letter = m?.[2] ?? '';
  const designator: Designator = {
    number: m?.[1] ?? rw.id,
    letter,
    letterAt: at(f, 54, 0),
    numberAt: at(f, letter ? 70 : 54, 0),
    headingDeg: rw.heading,
  };
  // aiming point: two blocks 60 m long, 10 m wide, from 400 m, inner edges 9 m off the centreline
  rect(out, f, 400, 460, 9, 19);
  rect(out, f, 400, 460, -19, -9);
  // touchdown zone: pairs of 22.5 m stripes every 150 m, 3-3-2-2-1-1, skipping the aiming point
  const tdz: [number, number][] = [
    [150, 3],
    [300, 3],
    [600, 2],
    [750, 2],
    [900, 1],
  ];
  for (const [s, n] of tdz) {
    for (let k = 0; k < n; k++) {
      const t = 9 + k * 3; // 1.8 m stripes, 1.2 m gaps, inner edge with the aiming point
      rect(out, f, s, s + 22.5, t, t + 1.8);
      rect(out, f, s, s + 22.5, -t - 1.8, -t);
    }
  }
  // centreline: 30 m stripes, 20 m gaps, 0.9 m wide, from past the designator to mid-runway
  for (let s = 90; s + 30 < f.lengthM / 2; s += 50) rect(out, f, s, s + 30, -0.45, 0.45);
  return { tris: out, designator };
}

/** Side stripes along both runway edges, 0.9 m wide. */
export function runwayEdges(f: RunwayFrame, out: number[] = []): number[] {
  const h = f.widthM / 2;
  rect(out, f, 0, f.lengthM, h - 0.9, h);
  rect(out, f, 0, f.lengthM, -h, -h + 0.9);
  return out;
}

/** The reciprocal runway in the airport data (18R ↔ 36L), if present. */
export const reciprocal = (rw: Runway, ap: Pick<Airport, 'runways'>) => reciprocalRunway(ap, rw);

/**
 * Runway holding position marking, pattern A (two solid, two dashed lines), simplified to two solid and two
 * dashed 0.4 m lines across the taxiway: thinner lines vanish beyond a few hundred metres.
 */
export function holdingPosition(pts: P2[], out: number[] = []): number[] {
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dz = b.z - a.z;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) continue;
    const n = { x: -dz / len, z: dx / len };
    const off = (k: number, p: P2) => ({ x: p.x + n.x * k, z: p.z + n.z * k });
    quad(out, off(-1.2, a), off(-1.2, b), 0.2);
    quad(out, off(-0.4, a), off(-0.4, b), 0.2);
    for (let s = 0; s < len; s += 1.8) {
      const e = Math.min(len, s + 0.9);
      const p = { x: a.x + (dx * s) / len, z: a.z + (dz * s) / len };
      const q = { x: a.x + (dx * e) / len, z: a.z + (dz * e) / len };
      quad(out, off(0.4, p), off(0.4, q), 0.2);
      quad(out, off(1.2, p), off(1.2, q), 0.2);
    }
  }
  return out;
}
