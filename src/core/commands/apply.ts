import { startGoAround, type Aircraft, type Env } from '../aircraft/aircraft';
import { bearing } from '../geo';
import type { Command, CommandResult } from './commands';

const OK: CommandResult = { ok: true };
const unable = (reason: string): CommandResult => ({ ok: false, reason });

function leaveApproach(ac: Aircraft) {
  ac.ilsArmed = null;
  ac.locEstablished = ac.gsEstablished = false;
  ac.stableChecked = false;
  if (ac.phase === 'approach' || ac.phase === 'landing') ac.phase = 'flight';
}

/** Check a command without applying it (pilots use this to decide between readback and "unable"). */
export function validateCommand(ac: Aircraft, cmd: Command, env: Env): CommandResult {
  const ap = env.airport;
  if (ac.nav.mode === 'rollout') return unable('unable, on the ground');
  switch (cmd.type) {
    case 'heading':
      return cmd.heading >= 1 && cmd.heading <= 360 ? OK : unable('unable, invalid heading');
    case 'altitude':
      if (cmd.altitude < 1000) return unable('unable, too low');
      if (cmd.altitude > 15000) return unable('unable, too high');
      return OK;
    case 'speed':
      if (cmd.speed < ac.perf.vapp) return unable(`unable, minimum speed ${ac.perf.vapp}`);
      if (cmd.speed > ac.perf.maxIas) return unable(`unable, maximum speed ${ac.perf.maxIas}`);
      return OK;
    case 'direct':
    case 'hold':
      return ap.fixes[cmd.fix] ? OK : unable(`unable, unknown fix ${cmd.fix}`);
    case 'ils':
      if (ac.kind !== 'arrival') return unable('unable, we are a departure');
      return cmd.runway === env.landing.id && env.landing.ils
        ? OK
        : unable(`unable, runway ${env.landing.id} in use`);
    case 'handoff':
      if (cmd.to === 'tower') {
        if (ac.kind !== 'arrival') return unable('unable, we are a departure');
        // Game-friendly simplification: pilots refuse Tower until on the localizer (see DECISIONS.md).
        return ac.nav.mode === 'loc' ? OK : unable('unable, not yet established');
      }
      return ac.kind === 'departure' ? OK : unable('negative, we are inbound');
    case 'goAround':
      return ac.nav.mode === 'loc' ? OK : unable('unable, not on approach');
    default:
      return OK;
  }
}

export function applyCommand(ac: Aircraft, cmd: Command, env: Env): CommandResult {
  const v = validateCommand(ac, cmd, env);
  if (!v.ok) return v;
  switch (cmd.type) {
    case 'identify':
      ac.identified = true;
      break;
    case 'heading':
      leaveApproach(ac);
      ac.nav = { mode: 'heading' };
      ac.tgtHdg = cmd.heading;
      ac.turn = cmd.turn;
      break;
    case 'presentHeading':
      leaveApproach(ac);
      ac.nav = { mode: 'heading' };
      ac.tgtHdg = Math.round(ac.hdg) || 360;
      ac.turn = undefined;
      break;
    case 'altitude':
      ac.tgtAlt = cmd.altitude;
      ac.gsEstablished = false;
      if (cmd.qnh !== undefined) ac.qnhGiven = true;
      break;
    case 'speed':
      ac.tgtIas = cmd.speed;
      ac.speedUntilDme = cmd.untilDme;
      break;
    case 'resumeSpeed':
      ac.tgtIas = null;
      ac.speedUntilDme = undefined;
      break;
    case 'direct':
      leaveApproach(ac);
      ac.nav = { mode: 'direct', fix: cmd.fix, then: [] };
      break;
    case 'hold':
      leaveApproach(ac);
      ac.nav = {
        mode: 'hold',
        fix: cmd.fix,
        // v1: published inbound track from data, else hold on the track flown to the fix.
        inbound: env.airport.holds[cmd.fix]?.inbound ?? bearing(ac.pos, env.airport.fixes[cmd.fix]!),
        leg: 'toFix',
        timer: 0,
      };
      break;
    case 'ils':
      ac.ilsArmed = cmd.runway;
      break;
    case 'handoff':
      ac.comms = cmd.to;
      break;
    case 'goAround':
      startGoAround(ac, env);
      break;
    case 'sayAgain':
      break;
  }
  return OK;
}
