/** Flat-earth helpers. Positions are NM east (x) / north (y) of the airport reference point. */
export const DEG = Math.PI / 180;
export const FT_PER_NM = 6076.12;

export interface Vec {
  x: number;
  y: number;
}

/** Normalise to 0..360 (0 excluded for display purposes elsewhere). */
export const norm360 = (d: number): number => ((d % 360) + 360) % 360;

/** Signed smallest difference `to - from` in degrees, range (-180, 180]. Positive = turn right. */
export function angleDiff(from: number, to: number): number {
  const d = norm360(to - from);
  return d > 180 ? d - 360 : d;
}

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/** Move `cur` toward `target` by at most `maxStep`. */
export function approach(cur: number, target: number, maxStep: number): number {
  return Math.abs(target - cur) <= maxStep ? target : cur + Math.sign(target - cur) * maxStep;
}

export function project(lat: number, lon: number, refLat: number, refLon: number): Vec {
  return { x: (lon - refLon) * 60 * Math.cos(refLat * DEG), y: (lat - refLat) * 60 };
}

export function unproject(p: Vec, refLat: number, refLon: number): { lat: number; lon: number } {
  return { lat: refLat + p.y / 60, lon: refLon + p.x / (60 * Math.cos(refLat * DEG)) };
}

export const dist = (a: Vec, b: Vec): number => Math.hypot(b.x - a.x, b.y - a.y);

/** Compass bearing from a to b, degrees. */
export const bearing = (a: Vec, b: Vec): number => norm360(Math.atan2(b.x - a.x, b.y - a.y) / DEG);

/** Unit-ish vector for a compass heading scaled by `len`. */
export const headingVec = (hdg: number, len = 1): Vec => ({
  x: Math.sin(hdg * DEG) * len,
  y: Math.cos(hdg * DEG) * len,
});

export function pointInPoly(p: Vec, poly: readonly Vec[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!;
    const b = poly[j]!;
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}
