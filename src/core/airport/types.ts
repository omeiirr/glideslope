import type { Vec } from '../geo';

/** A taxiway leaving the runway: path from the centreline to the holding position (projected). */
export interface RunwayExit {
  name: string;
  /** Metres from the landing threshold where it leaves the centreline. */
  distM: number;
  side: 'L' | 'R';
  path: Vec[];
}

export interface Runway {
  id: string;
  lat: number;
  lon: number;
  /** Landing threshold, projected. */
  pos: Vec;
  /** True heading of the landing direction. v1 treats true = magnetic (see DECISIONS.md). */
  heading: number;
  lengthFt: number;
  widthFt: number;
  elevationFt: number;
  ils?: { glideslopeDeg: number; rangeNm: number; tchFt: number };
  /** Exits a landing aircraft can take, nearest the threshold first. */
  exits?: RunwayExit[];
  /** Where departures enter: the last point of `path` is their holding point. */
  entry?: RunwayExit;
}

export interface Frequency {
  name: string;
  mhz: string;
}

export interface Airline {
  icao: string;
  telephony: string;
  weight: number;
  types: string[];
}

/** A control tower cab the player can look out of (tower mode). */
export interface Tower {
  id: string;
  name: string;
  lat: number;
  lon: number;
  /** Projected position. */
  pos: Vec;
  /** Eye height above the aerodrome, feet. */
  eyeHeightFt: number;
  /** Runways watched from this cab. */
  runways: string[];
  /** Default view direction, degrees true. */
  viewBearing: number;
}

export interface Airport {
  icao: string;
  name: string;
  lat: number;
  lon: number;
  elevationFt: number;
  transitionAltitudeFt: number;
  transitionLevels: { minQnh: number; fl: number }[];
  qnh: number;
  wind: { dir: number; speed: number };
  atis: string;
  frequencies: { approach: Frequency; tower: Frequency; radar: Frequency };
  airspace: { floorFt: number; ceilingFt: number; poly: Vec[] };
  config: { landing: string; departure: string };
  missedApproachAltFt: number;
  runways: Runway[];
  towers: Tower[];
  fixes: Record<string, Vec>;
  stars: { id: string; iaf: string; via: string[] }[];
  holds: Record<string, { inbound: number }>;
  departures: { initialClimbFt: number; exits: string[] };
  airlines: Airline[];
}
