/**
 * Airport lighting for dusk and night: where each light is, its colour and size. No WebGL or DOM (runs in tests).
 * Output is world metres (x east, y up, z south), as in math.ts.
 *
 * Simplified from ICAO Annex 14 vol. I ch. 5 (see DECISIONS.md): only the runways in use are lit.
 * - Edge lights every 60 m, white, yellow over the last 600 m.
 * - Centreline every 30 m: white, alternating red and white from 900 m to 300 m before the end, red over the last 300 m.
 * - Threshold: a green bar across the runway. Runway end: a red bar.
 * - Touchdown zone: pairs of three-light barrettes every 60 m over the first 900 m.
 * - Approach lights on the landing runway: a five-light barrette every 30 m out to 900 m, a crossbar at 300 m.
 * - Taxiways: green centreline lights every 30 m.
 * - Runway holding positions: a red stop bar across the taxiway, a flashing yellow guard light at each end.
 */
import { reciprocalRunway, runwayById, type Airport, type Runway } from '../../core';
import { llToGround, type GroundData, type P2 } from './ground';
import { insideRing } from './stands';
import { M_PER_FT, toWorld } from './math';

export type Rgb = [number, number, number];
export const LIGHT = {
  white: [1, 0.9, 0.72] as Rgb,
  yellow: [1, 0.72, 0.22] as Rgb,
  red: [1, 0.12, 0.08] as Rgb,
  green: [0.25, 1, 0.45] as Rgb,
  taxi: [0.2, 0.95, 0.5] as Rgb,
  blue: [0.25, 0.4, 1] as Rgb,
};

/** Flat arrays, ready for a THREE.BufferGeometry: 3 per position and colour, 1 per size and blink. */
export interface LightSet {
  pos: number[];
  color: number[];
  /** Point size in CSS pixels at about 1.5 km. */
  size: number[];
  /** 0 steady, 1 beacon (flashes about once a second), 2 strobe (short double flash). */
  blink: number[];
}

export const emptyLights = (): LightSet => ({ pos: [], color: [], size: [], blink: [] });

export function addLight(s: LightSet, x: number, y: number, z: number, c: Rgb, size: number, blink = 0) {
  s.pos.push(x, y, z);
  s.color.push(...c);
  s.size.push(size);
  s.blink.push(blink);
}

const EDGE_STEP = 60;
const CL_STEP = 30;
/** Light height above the ground, metres: enough to sit above the ground layers. */
const H = 0.6;

/** Lights of one runway used in the landing direction of `r` (`approach`: with an approach lighting system). */
function runwayLights(s: LightSet, ap: Airport, r: Runway, approach: boolean) {
  const opp = reciprocalRunway(ap, r);
  const a = toWorld(r.pos);
  const end = opp ? toWorld(opp.pos) : null;
  const len = end ? Math.hypot(end.x - a.x, end.z - a.z) : r.lengthFt * M_PER_FT;
  // unit vectors along the runway (landing direction) and to its right
  const h = (r.heading * Math.PI) / 180;
  const ux = Math.sin(h);
  const uz = -Math.cos(h);
  const rx = -uz;
  const rz = ux;
  const half = (r.widthFt * M_PER_FT) / 2;
  const at = (along: number, right: number, c: Rgb, size: number) =>
    addLight(s, a.x + ux * along + rx * right, H, a.z + uz * along + rz * right, c, size);

  for (let d = 0; d <= len + 0.1; d += EDGE_STEP) {
    const c = len - d < 600 ? LIGHT.yellow : LIGHT.white;
    at(d, half + 1.5, c, 3);
    at(d, -half - 1.5, c, 3);
  }
  for (let d = CL_STEP / 2; d < len; d += CL_STEP) {
    const toGo = len - d;
    const c = toGo < 300 ? LIGHT.red : toGo < 900 && Math.round(d / CL_STEP) % 2 ? LIGHT.red : LIGHT.white;
    at(d, 0, c, 2.4);
  }
  for (let w = -half - 3; w <= half + 3.01; w += 3) {
    at(-1, w, LIGHT.green, 3.2);
    at(len + 1, w, LIGHT.red, 3.2);
  }
  for (let d = 60; d <= 900; d += 60)
    for (const side of [1, -1]) for (let k = 0; k < 3; k++) at(d, side * (9 + k * 1.5), LIGHT.white, 2.2);
  if (!approach) return;
  for (let d = 30; d <= 900; d += 30) {
    for (let k = -2; k <= 2; k++) at(-d, k * 1.05, LIGHT.white, 3.4);
    if (d === 300)
      for (let w = 4; w <= 15; w += 1.5) for (const side of [1, -1]) at(-d, side * w, LIGHT.white, 3.4);
  }
}

/** Runway lights for the configured landing and departure runways. */
export function airportLights(ap: Airport): LightSet {
  const s = emptyLights();
  const landing = runwayById(ap, ap.config.landing);
  runwayLights(s, ap, landing, true);
  if (ap.config.departure !== ap.config.landing)
    runwayLights(s, ap, runwayById(ap, ap.config.departure), false);
  return s;
}

/** Green taxiway centreline lights every 30 m along the OSM taxiway lines. */
export function taxiwayLights(ap: Pick<Airport, 'lat' | 'lon'>, g: GroundData): LightSet {
  const s = emptyLights();
  for (const t of g.taxiways) {
    let carry = 0;
    for (let i = 1; i < t.pts.length; i++) {
      const p = llToGround(ap, t.pts[i - 1]!);
      const q = llToGround(ap, t.pts[i]!);
      const seg = Math.hypot(q.x - p.x, q.z - p.z);
      let d = carry;
      for (; d < seg; d += CL_STEP) {
        const f = d / seg;
        addLight(s, p.x + (q.x - p.x) * f, H, p.z + (q.z - p.z) * f, LIGHT.taxi, 2);
      }
      carry = d - seg;
    }
  }
  return s;
}

/** Stop bar lights at most this far apart (m; ICAO Annex 14 vol. I 5.3.20, from memory). */
const STOP_STEP = 3;

/**
 * One runway holding position (its OSM line across the taxiway): red stop bar lights along it into `bar`, and
 * a runway guard light 2 m beyond each end into `guard`, flashing (shortcut: together, not alternately).
 */
export function holdLights(line: P2[], bar: LightSet, guard: LightSet) {
  const a = line[0]!;
  const b = line[line.length - 1]!;
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  if (len < 1) return;
  const n = Math.max(1, Math.round(len / STOP_STEP));
  for (let i = 0; i <= n; i++)
    addLight(bar, a.x + ((b.x - a.x) * i) / n, H, a.z + ((b.z - a.z) * i) / n, LIGHT.red, 2.2);
  const [ux, uz] = [(b.x - a.x) / len, (b.z - a.z) / len];
  addLight(guard, a.x - ux * 2, H + 0.4, a.z - uz * 2, LIGHT.yellow, 3, 1);
  addLight(guard, b.x + ux * 2, H + 0.4, b.z + uz * 2, LIGHT.yellow, 3, 1);
}

/** Blue taxiway edge lights this far apart along each edge (m). */
const TW_EDGE_STEP = 45;

/**
 * Blue edge lights both sides of every taxiway, just off the paved edge (simplified: real ones are mostly on
 * curves and apron edges, see DECISIONS.md). None where the edge runs over other pavement: a crossing or
 * joining taxiway, a runway or an apron.
 */
export function taxiwayEdgeLights(ap: Pick<Airport, 'lat' | 'lon'>, g: GroundData): LightSet {
  const s = emptyLights();
  const lines = g.taxiways.map((t) => ({ w: t.w, pts: t.pts.map((p) => llToGround(ap, p)) }));
  const rings = [...g.runways, ...g.aprons].flatMap((poly) =>
    poly.map((r) => r.map((p) => llToGround(ap, p))),
  );
  // segments in a 100 m grid, so each point only checks those nearby
  const CELL = 100;
  const grid = new Map<string, { a: P2; b: P2; half: number }[]>();
  for (const { w, pts } of lines)
    for (let i = 1; i < pts.length; i++) {
      const [a, b] = [pts[i - 1]!, pts[i]!];
      const seg = { a, b, half: w / 2 };
      const [x0, x1] = [Math.min(a.x, b.x) - w, Math.max(a.x, b.x) + w].map((v) => Math.floor(v / CELL));
      const [z0, z1] = [Math.min(a.z, b.z) - w, Math.max(a.z, b.z) + w].map((v) => Math.floor(v / CELL));
      for (let x = x0!; x <= x1!; x++)
        for (let z = z0!; z <= z1!; z++) {
          const k = `${x},${z}`;
          (grid.get(k) ?? grid.set(k, []).get(k)!).push(seg);
        }
    }
  const onPavement = (p: P2) =>
    (grid.get(`${Math.floor(p.x / CELL)},${Math.floor(p.z / CELL)}`) ?? []).some(({ a, b, half }) => {
      const l2 = (b.x - a.x) ** 2 + (b.z - a.z) ** 2;
      const t = l2
        ? Math.max(0, Math.min(1, ((p.x - a.x) * (b.x - a.x) + (p.z - a.z) * (b.z - a.z)) / l2))
        : 0;
      return Math.hypot(p.x - a.x - (b.x - a.x) * t, p.z - a.z - (b.z - a.z) * t) < half;
    }) || rings.some((r) => insideRing(p, r));
  for (const { w, pts } of lines) {
    let carry = TW_EDGE_STEP / 2;
    for (let i = 1; i < pts.length; i++) {
      const [p, q] = [pts[i - 1]!, pts[i]!];
      const seg = Math.hypot(q.x - p.x, q.z - p.z);
      if (seg < 0.01) continue;
      const n = { x: -(q.z - p.z) / seg, z: (q.x - p.x) / seg };
      let d = carry;
      for (; d < seg; d += TW_EDGE_STEP) {
        const f = d / seg;
        for (const side of [1, -1]) {
          const off = side * (w / 2 + 1);
          const e = { x: p.x + (q.x - p.x) * f + n.x * off, z: p.z + (q.z - p.z) * f + n.z * off };
          if (!onPavement(e)) addLight(s, e.x, H, e.z, LIGHT.blue, 1.6);
        }
      }
      carry = d - seg;
    }
  }
  return s;
}

export type TimeOfDay = 'day' | 'dusk' | 'night';
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['day', 'dusk', 'night'];

/** The haze on a clear day (FogExp2 density per metre, about 30 km visibility). */
export const CLEAR_FOG = 0.00006;
/**
 * FogExp2 density for a visibility: at the visibility distance the contrast drops to 2 % (Koschmieder),
 * so (density · V)² = −ln 0.02 = 3.912. 10 km or more ("10 km+") is the clear-day haze.
 */
export const fogDensity = (visM: number) =>
  visM >= 10000 ? CLEAR_FOG : Math.max(CLEAR_FOG, 1.978 / Math.max(50, visM));
/** How far into fog (0 = clear, 1 = 1.5 km or less): greys the sky and softens the sun. */
export const fogAmount = (visM: number) => Math.min(1, Math.max(0, (8000 - visM) / (8000 - 1500)));
/**
 * Lights shine through fog further than unlit objects can be seen (Allard's law, simplified): their fog is
 * 0.4 × the scene's, so at 600 m visibility the runway lights fade out at about 1.2–1.5 km.
 */
export const LIGHT_FOG = 0.4;
