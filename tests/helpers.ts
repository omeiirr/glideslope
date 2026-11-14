import { EHAM, Sim, headingVec, type SimOptions, type SpawnSpec } from '../src/core';

export const CALM = { dir: 0, speed: 0 };

export function quietSim(opts: Partial<SimOptions> = {}): Sim {
  return new Sim(EHAM, {
    seed: 1,
    traffic: { arrivalsPerHour: 0, departuresPerHour: 0 },
    wind: CALM,
    ...opts,
  });
}

/** Position `distNm` out on the extended 18R centreline, offset `rightNm` to the right of the inbound course. */
export function onFinal(distNm: number, rightNm = 0) {
  const rwy = EHAM.runways.find((r) => r.id === '18R')!;
  const back = headingVec(rwy.heading + 180, distNm);
  const side = headingVec(rwy.heading + 90, rightNm);
  return { x: rwy.pos.x + back.x + side.x, y: rwy.pos.y + back.y + side.y };
}

export function arrival(sim: Sim, spec: Partial<SpawnSpec> = {}) {
  return sim.spawn({ kind: 'arrival', callsign: 'KLM123', type: 'B738', onFrequency: true, ...spec });
}
