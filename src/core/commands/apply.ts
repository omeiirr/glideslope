import {
  canMakeExit,
  exitsFor,
  isOnGround,
  lineUp,
  runwayFrame,
  startGoAround,
  type Aircraft,
  type Env,
} from '../aircraft/aircraft';
import { bearing } from '../geo';
import type { Command, CommandResult } from './commands';

const OK: CommandResult = { ok: true };
/** Tower instructions a pilot on the ground (not rolling) accepts. */
const GROUND_OK = new Set<Command['type']>(['lineUp', 'takeoff', 'cancelTakeoff', 'vacate']);
const LATERAL = new Set<Command['type']>(['heading', 'presentHeading', 'direct', 'hold', 'ils']);
/** Metres past the landing threshold. */
const alongM = (ac: Aircraft, env: Env) => -runwayFrame(ac.pos, env.landing).along * 1852;
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
  const m = ac.nav.mode;
  // the take-off roll keeps accepting instructions for after departure, as before
  if (
    isOnGround(ac) &&
    m !== 'takeoff' &&
    !GROUND_OK.has(cmd.type) &&
    !(cmd.type === 'handoff' && cmd.to === 'ground')
  )
    return unable('unable, on the ground');
  // tower mode: the departure is on the frequency during the roll; turns wait until airborne
  if (env.tower && m === 'takeoff' && LATERAL.has(cmd.type)) return unable('unable, on the take-off roll');
  const onApproach = ac.kind === 'arrival' && (m === 'loc' || ac.ilsArmed !== null);
  const queued = m === 'holding' || (m === 'taxi' && ac.nav.then !== 'vacate') || m === 'lineup';
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
      // before vacating it is "when vacated, contact Ground": the switch waits until the aircraft turns off
      if (cmd.to === 'ground')
        return ac.kind === 'arrival' && (isOnGround(ac) || onApproach)
          ? OK
          : unable('unable, not on the ground');
      if (cmd.to === 'departure')
        return ac.kind === 'departure' && (!isOnGround(ac) || m === 'takeoff')
          ? OK
          : unable('unable, not airborne');
      if (cmd.to === 'tower') {
        if (ac.kind !== 'arrival') return unable('unable, we are a departure');
        // Game-friendly simplification: pilots refuse Tower until on the localizer (see DECISIONS.md).
        return ac.nav.mode === 'loc' ? OK : unable('unable, not yet established');
      }
      return ac.kind === 'departure' ? OK : unable('negative, we are inbound');
    case 'goAround':
      return ac.nav.mode === 'loc' ? OK : unable('unable, not on approach');
    case 'land':
    case 'continueApproach':
      if (!onApproach) return unable('unable, not on approach');
      return cmd.type === 'continueApproach' || cmd.runway === env.landing.id
        ? OK
        : unable(`negative, approaching runway ${env.landing.id}`);
    case 'vacate': {
      if (ac.kind !== 'arrival' || !(onApproach || m === 'rollout' || m === 'taxi'))
        return unable('unable, not on the runway');
      const exits = exitsFor(env.landing, cmd);
      const what = cmd.exit ?? `to the ${cmd.side}`;
      if (!exits.length) return unable(`unable, no exit ${what}`);
      if (m === 'taxi') return OK; // already off the centreline: keep going
      if (m === 'rollout' && !exits.some((e) => canMakeExit(env.landing, e, alongM(ac, env), ac.ias)))
        return unable(`unable, too late for ${cmd.exit ?? `an exit ${what}`}`);
      return OK;
    }
    case 'lineUp':
    case 'takeoff':
      if (ac.kind !== 'departure' || !queued) return unable('unable, not at the holding point');
      return cmd.runway === env.departure.id
        ? OK
        : unable(`negative, we are departing runway ${env.departure.id}`);
    case 'cancelTakeoff':
      if (ac.kind !== 'departure' || !(queued || m === 'takeoff')) return unable('unable, airborne');
      return OK;
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
      if (cmd.to === 'ground' && !(ac.nav.mode === 'taxi' && ac.nav.then === 'vacate'))
        ac.groundPending = true;
      else ac.comms = cmd.to;
      break;
    case 'goAround':
      startGoAround(ac, env);
      break;
    case 'sayAgain':
      break;
    case 'land':
      ac.landClear = true;
      break;
    case 'continueApproach':
      break;
    case 'vacate':
      ac.vacate = { exit: cmd.exit, side: cmd.side };
      if (ac.nav.mode === 'rollout') {
        const along = alongM(ac, env);
        ac.nav.exit = exitsFor(env.landing, cmd).find((e) => canMakeExit(env.landing, e, along, ac.ias))!;
      }
      break;
    case 'lineUp':
      if (ac.nav.mode === 'holding' || (ac.nav.mode === 'taxi' && ac.nav.then === 'hold'))
        lineUp(ac, env.departure);
      break;
    case 'takeoff':
      ac.takeoffClear = true;
      if (ac.nav.mode === 'holding' || (ac.nav.mode === 'taxi' && ac.nav.then === 'hold'))
        lineUp(ac, env.departure);
      break;
    case 'cancelTakeoff':
      ac.takeoffClear = false;
      // rejected take-off: brake to a stop on the runway, lined up
      if (ac.nav.mode === 'takeoff') {
        ac.nav = { mode: 'lineup', ready: true, timer: 0 };
        ac.phase = 'lineup';
      }
      break;
  }
  return OK;
}
