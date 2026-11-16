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
 */
import { reciprocalRunway, runwayById, type Airport, type Runway } from '../../core';
import { llToGround, type GroundData } from './ground';
import { M_PER_FT, toWorld } from './math';

export type Rgb = [number, number, number];
export const LIGHT = {
  white: [1, 0.9, 0.72] as Rgb,
  yellow: [1, 0.72, 0.22] as Rgb,
  red: [1, 0.12, 0.08] as Rgb,
  green: [0.25, 1, 0.45] as Rgb,
  taxi: [0.2, 0.95, 0.5] as Rgb,
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

export type TimeOfDay = 'day' | 'dusk' | 'night';
export const TIMES_OF_DAY: readonly TimeOfDay[] = ['day', 'dusk', 'night'];
