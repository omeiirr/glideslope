export type Wake = 'L' | 'M' | 'H' | 'J';

export interface Perf {
  wake: Wake;
  /** Typical climb / descent rates below FL100, ft/min. */
  climbFpm: number;
  descentFpm: number;
  /** Final approach speed (IAS kt): also the lowest speed a pilot will accept. */
  vapp: number;
  /** Highest IAS a pilot will accept. */
  maxIas: number;
  /** Rotation speed for departures. */
  vr: number;
}

const jet = (wake: Wake, vapp: number, climbFpm = 2500, descentFpm = 2000): Perf => ({
  wake,
  climbFpm,
  descentFpm,
  vapp,
  maxIas: 320,
  vr: vapp + 10,
});

/** Simplified performance table; approach speeds are typical landing-weight values. */
export const PERF: Record<string, Perf> = {
  B738: jet('M', 140),
  B38M: jet('M', 142),
  A320: jet('M', 135),
  A20N: jet('M', 135),
  A321: jet('M', 140),
  E190: jet('M', 130),
  E195: jet('M', 132),
  A332: jet('H', 138, 2200, 1800),
  A333: jet('H', 140, 2200, 1800),
  B772: jet('H', 140, 2200, 1800),
  B77W: jet('H', 148, 2000, 1800),
  B789: jet('H', 142, 2300, 1800),
  A388: jet('J', 138, 1800, 1800),
  PC12: { wake: 'L', climbFpm: 1500, descentFpm: 1500, vapp: 95, maxIas: 230, vr: 85 },
};

export function perfFor(type: string): Perf {
  const p = PERF[type];
  if (!p) throw new Error(`Unknown aircraft type ${type}`);
  return p;
}
