/**
 * Tower view maths that needs no WebGL or DOM (so it runs in tests).
 * World frame of the 3D view: metres, x = east, y = up, z = south, origin at the airport reference point.
 */
import {
  DEG,
  FT_PER_NM,
  clamp,
  headingVec,
  project,
  type Aircraft,
  type Airport,
  type Tower,
  type Vec,
} from '../../core';

export const M_PER_NM = 1852;
export const M_PER_FT = 0.3048;

export interface P3 {
  x: number;
  y: number;
  z: number;
}

/** Core position (NM east/north) → world metres at a height. */
export const toWorld = (p: Vec, heightM = 0): P3 => ({ x: p.x * M_PER_NM, y: heightM, z: -p.y * M_PER_NM });

export const eyePosition = (t: Tower): P3 => toWorld(t.pos, t.eyeHeightFt * M_PER_FT);

/** Unit view direction for a compass bearing and an angle below the horizon. */
export function lookDirection(bearingDeg: number, depressionDeg: number): P3 {
  const b = bearingDeg * DEG;
  const e = -depressionDeg * DEG;
  return { x: Math.sin(b) * Math.cos(e), y: Math.sin(e), z: -Math.cos(b) * Math.cos(e) };
}

/** Bearing and depression from an eye point to a target (for binoculars that follow an aircraft). */
export function aimAt(eye: P3, target: P3): { bearing: number; depression: number } {
  const dx = target.x - eye.x;
  const dz = target.z - eye.z;
  const bearing = (Math.atan2(dx, -dz) / DEG + 360) % 360;
  const depression = Math.atan2(eye.y - target.y, Math.hypot(dx, dz)) / DEG;
  return { bearing, depression };
}

// ------------------------------------------------------------------ ground imagery

export interface ImageryTile {
  file: string;
  south: number;
  west: number;
  north: number;
  east: number;
  w: number;
  h: number;
}
export interface ImageryManifest {
  attribution: string;
  /** Drawn in order: later tiers lie on top of earlier ones. */
  tiers: { name: string; metresPerPixel: number; tiles: ImageryTile[] }[];
}

/** Where a tile lies in the world: centre and size in metres. Uses the core's projection, so photos match the sim. */
export function tileRect(t: ImageryTile, ap: Pick<Airport, 'lat' | 'lon'>) {
  const nw = toWorld(project(t.north, t.west, ap.lat, ap.lon));
  const se = toWorld(project(t.south, t.east, ap.lat, ap.lon));
  return { cx: (nw.x + se.x) / 2, cz: (nw.z + se.z) / 2, width: se.x - nw.x, depth: se.z - nw.z };
}

/** Pixel in a tile for a lat/lon (x right, y down), for checking the georeferencing. */
export function tilePixel(t: ImageryTile, lat: number, lon: number): { x: number; y: number } {
  return { x: ((lon - t.west) / (t.east - t.west)) * t.w, y: ((t.north - lat) / (t.north - t.south)) * t.h };
}

// ------------------------------------------------------------------ aircraft pose

export interface Pose {
  pos: P3;
  headingDeg: number;
  /** Nose up positive. */
  pitchDeg: number;
  gearDown: boolean;
  onGround: boolean;
  /** Height of the wheels above the ground, metres. */
  aglM: number;
}

/**
 * Where and how to draw an aircraft, extrapolated `frac` of a tick past its last sim state.
 * Pitch and gear are derived here: the core doesn't model them.
 */
export function aircraftPose(
  ac: Readonly<Aircraft>,
  ap: Pick<Airport, 'elevationFt'>,
  frac: number,
  tick: number,
): Pose {
  const dt = frac * tick;
  const v = headingVec(ac.track, (ac.gs / 3600) * dt);
  const altFt = ac.alt + (ac.vs / 60) * dt;
  const aglFt = Math.max(0, altFt - ap.elevationFt);
  const onGround = ac.phase === 'rollout' || aglFt < 1;
  // flight-path angle plus a typical angle of attack (higher when slow)
  const path = Math.atan2(ac.vs, Math.max(ac.gs, 60) * (FT_PER_NM / 60)) / DEG;
  const pitchDeg = onGround ? 0 : clamp(path + (ac.ias < 190 ? 5.5 : 3), -6, 18);
  const lowAndSlow = ac.kind === 'arrival' ? aglFt < 2000 : aglFt < 300;
  return {
    pos: toWorld({ x: ac.pos.x + v.x, y: ac.pos.y + v.y }, aglFt * M_PER_FT),
    headingDeg: ac.hdg,
    pitchDeg,
    gearDown: onGround || lowAndSlow || ac.phase === 'landing',
    onGround,
    aglM: aglFt * M_PER_FT,
  };
}

/** Sun used for lighting and shadows: early-afternoon, south-south-west. */
export const SUN = { azimuth: 205, elevation: 34 };

/** Ground position of an aircraft's shadow: displaced away from the sun, further the higher it flies. */
export function shadowPoint(pos: P3, aglM: number): { x: number; z: number } {
  const reach = aglM / Math.tan(SUN.elevation * DEG);
  const away = (SUN.azimuth + 180) * DEG;
  return { x: pos.x + Math.sin(away) * reach, z: pos.z - Math.cos(away) * reach };
}

// ------------------------------------------------------------------ airframes and liveries

export interface Airframe {
  /** Metres. */
  len: number;
  span: number;
  /** Fuselage diameter. */
  d: number;
  fin: number;
  engines: 1 | 2 | 4;
  engD: number;
  engL: number;
  gearH: number;
  /** Single-engine propeller aircraft: straight wing, no underwing engines. */
  prop?: boolean;
}

const twin = (len: number, span: number, d: number, fin: number, engD: number): Airframe => ({
  len,
  span,
  d,
  fin,
  engines: 2,
  engD,
  engL: engD * 2,
  gearH: d * 0.82,
});

/** Published overall dimensions, rounded. */
const AIRFRAMES: Record<string, Airframe> = {
  B738: twin(39.5, 35.8, 3.76, 6.4, 2.1),
  B38M: twin(39.5, 35.9, 3.76, 6.4, 2.3),
  A320: twin(37.6, 35.8, 3.95, 5.9, 2.2),
  A20N: twin(37.6, 35.8, 3.95, 5.9, 2.5),
  A321: twin(44.5, 35.8, 3.95, 5.9, 2.2),
  E190: twin(36.2, 28.7, 3.0, 5.3, 1.7),
  E195: twin(38.7, 28.7, 3.0, 5.3, 1.7),
  A332: twin(58.8, 60.3, 5.64, 8.6, 3.1),
  A333: twin(63.7, 60.3, 5.64, 8.6, 3.1),
  B772: twin(63.7, 60.9, 6.2, 9.2, 3.6),
  B77W: twin(73.9, 64.8, 6.2, 9.2, 3.8),
  B789: twin(62.8, 60.1, 5.77, 8.4, 3.4),
  A388: { len: 72.7, span: 79.8, d: 7.14, fin: 10.5, engines: 4, engD: 3.1, engL: 5.6, gearH: 5.2 },
  PC12: { len: 14.4, span: 16.3, d: 1.6, fin: 2.6, engines: 1, engD: 0.9, engL: 2.2, gearH: 1.4, prop: true },
};

export const airframe = (type: string): Airframe => AIRFRAMES[type] ?? AIRFRAMES.B738!;

export interface Livery {
  tail: string;
  /** Upper fuselage colour, if not white. */
  body?: string;
  /** Thin stripe above the windows. */
  cheat?: string;
  cowl: string;
}

const WHITE = '#f3f5f7';
/** Colour blocks only: no logos or lettering. */
const LIVERIES: Record<string, Livery> = {
  KLM: { tail: '#1f6fd0', body: '#4aa3e6', cowl: WHITE },
  TRA: { tail: '#1faa5c', cheat: '#1faa5c', cowl: '#1faa5c' },
  EZY: { tail: '#f36a12', cheat: '#f36a12', cowl: '#f36a12' },
  TFL: { tail: '#2a4fa0', cheat: '#e03a3a', cowl: WHITE },
  BAW: { tail: '#1d2b55', cheat: '#b5202d', cowl: '#1d2b55' },
  DLH: { tail: '#0b1f44', cowl: WHITE },
  RYR: { tail: '#16307a', cheat: '#e8b620', cowl: '#16307a' },
  AFR: { tail: '#1b3f8f', cheat: '#d8343b', cowl: WHITE },
  DAL: { tail: '#b01f3a', cheat: '#1c3766', cowl: '#1c3766' },
  UAE: { tail: '#c8102e', cheat: '#b79a4a', cowl: WHITE },
  JFA: { tail: '#7a8794', cheat: '#7a8794', cowl: WHITE },
};

export const liveryFor = (airline: string): Livery => LIVERIES[airline] ?? { tail: '#5b6b7d', cowl: WHITE };
