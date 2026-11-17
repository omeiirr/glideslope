import { project } from '../geo';
import type { Airport, Runway, RunwayExit, Tower } from './types';

type LatLon = [number, number];
type ExitJson = Omit<RunwayExit, 'path' | 'queue'> & { path: number[][]; queue?: number[][] };
/** Shape of data/airports/*.json (positions as [lat, lon]). */
export interface AirportJson extends Omit<Airport, 'airspace' | 'runways' | 'fixes' | 'towers'> {
  airspace: { floorFt: number; ceilingFt: number; poly: number[][] };
  runways: (Omit<Runway, 'pos' | 'exits' | 'entry'> & { exits?: ExitJson[]; entry?: ExitJson })[];
  towers: Omit<Tower, 'pos'>[];
  fixes: Record<string, number[]>;
}

export function loadAirport(json: AirportJson): Airport {
  const p = (ll: number[]) => project((ll as LatLon)[0], (ll as LatLon)[1], json.lat, json.lon);
  return {
    ...json,
    airspace: { ...json.airspace, poly: json.airspace.poly.map(p) },
    runways: json.runways.map((r) => {
      const ex = (e: ExitJson): RunwayExit => ({
        ...e,
        side: e.side as RunwayExit['side'],
        path: e.path.map(p),
        queue: e.queue?.map(p),
      });
      return { ...r, pos: p([r.lat, r.lon]), exits: r.exits?.map(ex), entry: r.entry && ex(r.entry) };
    }),
    towers: json.towers.map((t) => ({ ...t, pos: p([t.lat, t.lon]) })),
    fixes: Object.fromEntries(Object.entries(json.fixes).map(([k, v]) => [k, p(v)])),
  };
}

export function runwayById(ap: Airport, id: string): Runway {
  const r = ap.runways.find((x) => x.id === id);
  if (!r) throw new Error(`Unknown runway ${id}`);
  return r;
}

/** The other end of the same runway (18R -> 36L), if the data has it. */
export function reciprocalRunway(ap: Pick<Airport, 'runways'>, rw: Runway): Runway | undefined {
  const m = /^(\d+)([LRC]?)$/.exec(rw.id);
  if (!m) return undefined;
  const n = ((+m[1]! + 17) % 36) + 1;
  const l = m[2] === 'L' ? 'R' : m[2] === 'R' ? 'L' : m[2]!;
  return ap.runways.find((r) => r.id === `${String(n).padStart(2, '0')}${l}`);
}

/** Transition level (as a flight level number, e.g. 40) for a QNH. */
export function transitionLevel(ap: Airport, qnh: number): number {
  let fl = ap.transitionLevels[0]!.fl;
  for (const t of ap.transitionLevels) if (qnh >= t.minQnh) fl = t.fl;
  return fl;
}
