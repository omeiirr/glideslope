import type { Command } from '../core';

export interface ReadbackError {
  /** Commands as the pilot read them back. */
  commands: Command[];
  /** Commands the pilot flies: the misread ones, unless the sim can't fly them (another runway): then the right ones. */
  flown: Command[];
  index: number;
  /** e.g. "cleared 4000, read back 5000" */
  detail: string;
}

/**
 * Corrupt one numeric value in a readback (Pro mode). `rand` is a 0..1 source so the caller controls seeding.
 * Returns null if there is nothing to corrupt.
 */
/** A runway misheard: left and right swapped, or the number off by two ("24" → "22"). */
export function misheardRunway(id: string, rand: () => number): string {
  const side = id.slice(2);
  if (side === 'L' || side === 'R') return id.slice(0, 2) + (side === 'L' ? 'R' : 'L');
  const n = ((+id.slice(0, 2) + (rand() < 0.5 ? -2 : 2) + 35) % 36) + 1;
  return String(n).padStart(2, '0') + side;
}

export function corruptReadback(
  cmds: readonly Command[],
  transitionAltFt: number,
  rand: () => number,
  /** Tower: exits of the landing runway in order, for a misheard "vacate via …". */
  exits: readonly string[] = [],
): ReadbackError | null {
  const candidates = cmds
    .map((c, i) =>
      c.type === 'heading' ||
      c.type === 'altitude' ||
      c.type === 'speed' ||
      c.type === 'land' ||
      c.type === 'lineUp' ||
      c.type === 'takeoff' ||
      (c.type === 'vacate' && c.exit && exits.length > 1)
        ? i
        : -1,
    )
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
  } else if (cmd.type === 'land' || cmd.type === 'lineUp' || cmd.type === 'takeoff') {
    const r = misheardRunway(cmd.runway, rand);
    wrong = { ...cmd, runway: r };
    detail = `cleared runway ${cmd.runway}, read back runway ${r}`;
    // shortcut: the sim has no other runway, so the pilot still uses the right one; uncaught still counts
    const commands = cmds.slice();
    commands[index] = wrong;
    return { commands, flown: cmds.slice(), index, detail };
  } else if (cmd.type === 'vacate' && cmd.exit) {
    const i = exits.indexOf(cmd.exit);
    const other = exits[i + (i + 1 < exits.length && (sign > 0 || i === 0) ? 1 : -1)]!;
    wrong = { ...cmd, exit: other };
    detail = `vacate via ${cmd.exit}, read back ${other}`;
  } else return null;
  const commands = cmds.slice();
  commands[index] = wrong;
  return { commands, flown: commands, index, detail };
}
