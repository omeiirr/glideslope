import type { Command } from '../core';

export interface ReadbackError {
  /** Commands as the pilot (mis)understood them. */
  commands: Command[];
  index: number;
  /** e.g. "cleared 4000, read back 5000" */
  detail: string;
}

/**
 * Corrupt one numeric value in a readback (Pro mode). `rand` is a 0..1 source so the caller controls seeding.
 * Returns null if there is nothing to corrupt.
 */
export function corruptReadback(
  cmds: readonly Command[],
  transitionAltFt: number,
  rand: () => number,
): ReadbackError | null {
  const candidates = cmds
    .map((c, i) => (c.type === 'heading' || c.type === 'altitude' || c.type === 'speed' ? i : -1))
    .filter((i) => i >= 0);
  if (!candidates.length) return null;
  const index = candidates[Math.floor(rand() * candidates.length)]!;
  const cmd = cmds[index]!;
  const sign = rand() < 0.5 ? -1 : 1;
  let wrong: Command;
  let detail: string;
  if (cmd.type === 'heading') {
    const h = ((cmd.heading + sign * (rand() < 0.5 ? 10 : 20) + 359) % 360) + 1;
    wrong = { ...cmd, heading: h };
    detail = `cleared heading ${String(cmd.heading).padStart(3, '0')}, read back ${String(h).padStart(3, '0')}`;
  } else if (cmd.type === 'altitude') {
    const a = cmd.altitude + sign * 1000 < 2000 ? cmd.altitude + 1000 : cmd.altitude + sign * 1000;
    wrong = {
      type: 'altitude',
      altitude: a,
      fl: a > transitionAltFt,
      ...(cmd.qnh !== undefined && a <= transitionAltFt ? { qnh: cmd.qnh } : {}),
    };
    const show = (ft: number) =>
      ft > transitionAltFt ? `FL${String(ft / 100).padStart(3, '0')}` : `${ft} ft`;
    detail = `cleared ${show(cmd.altitude)}, read back ${show(a)}`;
  } else if (cmd.type === 'speed') {
    const s = cmd.speed + sign * (rand() < 0.5 ? 10 : 20);
    wrong = { ...cmd, speed: s };
    detail = `cleared ${cmd.speed} kt, read back ${s} kt`;
  } else return null;
  const commands = cmds.slice();
  commands[index] = wrong;
  return { commands, index, detail };
}
