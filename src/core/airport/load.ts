import { project } from '../geo';
import type { Airport, Runway } from './types';

type LatLon = [number, number];
/** Shape of data/airports/*.json (positions as [lat, lon]). */
export interface AirportJson extends Omit<Airport, 'airspace' | 'runways' | 'fixes'> {
  airspace: { floorFt: number; ceilingFt: number; poly: number[][] };
  runways: Omit<Runway, 'pos'>[];
  fixes: Record<string, number[]>;
}

export function loadAirport(json: AirportJson): Airport {
  const p = (ll: number[]) => project((ll as LatLon)[0], (ll as LatLon)[1], json.lat, json.lon);
  return {
    ...json,
    airspace: { ...json.airspace, poly: json.airspace.poly.map(p) },
    runways: json.runways.map((r) => ({ ...r, pos: p([r.lat, r.lon]) })),
    fixes: Object.fromEntries(Object.entries(json.fixes).map(([k, v]) => [k, p(v)])),
  };
}

export function runwayById(ap: Airport, id: string): Runway {
  const r = ap.runways.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown runway ${id}`);
  return r;
}

/** Transition level (as a flight level number, e.g. 40) for a QNH. */
export function transitionLevel(ap: Airport, qnh: number): number {
  let fl = ap.transitionLevels[0]!.fl;
  for (const t of ap.transitionLevels) if (qnh >= t.minQnh) fl = t.fl;
  return fl;
}
