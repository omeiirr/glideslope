import ehamJson from '../../data/airports/EHAM.json';
import { loadAirport, type AirportJson } from './airport/load';

export * from './sim';
export { Rng } from './rng';
export * from './geo';
export * from './commands/commands';
export * from './airport/types';
export { transitionLevel, runwayById, loadAirport } from './airport/load';
export type { Aircraft, NavMode, Phase } from './aircraft/aircraft';
export { runwayFrame, glideslopeAlt } from './aircraft/aircraft';
export { perfFor, PERF, type Wake } from './aircraft/perf';
export * from './rules/separation';
export type { TrafficConfig, SpawnSpec } from './traffic/spawner';

export const EHAM = loadAirport(ehamJson as unknown as AirportJson);
