import type { Airport, Runway } from '../airport/types';
import {
  DEG,
  FT_PER_NM,
  angleDiff,
  approach,
  bearing,
  clamp,
  dist,
  headingVec,
  norm360,
  pointInPoly,
  type Vec,
} from '../geo';
import type { Perf } from './perf';

export type NavMode =
  | { mode: 'heading' }
  /** Fly to `fix`, then each fix in `then`, then keep the heading flown at the last fix. */
  | { mode: 'direct'; fix: string; then: string[] }
  | { mode: 'hold'; fix: string; inbound: number; leg: 'toFix' | 'outbound' | 'turnIn'; timer: number }
  /** Tracking the localizer of the armed runway. */
  | { mode: 'loc' }
  | { mode: 'takeoff' }
  | { mode: 'rollout' };

/** Coarse flight phase; a future tower/3D view keys animation off this. */
export type Phase = 'takeoff' | 'flight' | 'approach' | 'landing' | 'rollout' | 'goaround';
export type Comms = 'none' | 'app' | 'tower' | 'radar';

export interface Aircraft {
  id: number;
  /** ICAO form, e.g. "KLM1234". */
  callsign: string;
  airline: string;
  type: string;
  perf: Perf;
  kind: 'arrival' | 'departure';
  /** NM east/north of the airport reference; lat/lon is derived in the snapshot. */
  pos: Vec;
  alt: number;
  hdg: number;
  ias: number;
  gs: number;
  track: number;
  vs: number;
  tgtAlt: number;
  tgtHdg: number;
  /** Forced turn direction for the current heading change. */
  turn?: 'left' | 'right';
  /** null = pilot's own ("normal") speed schedule. */
  tgtIas: number | null;
  /** Assigned speed is held until this distance from touchdown. */
  speedUntilDme?: number;
  nav: NavMode;
  ilsArmed: string | null;
  locEstablished: boolean;
  gsEstablished: boolean;
  phase: Phase;
  comms: Comms;
  identified: boolean;
  /** Has received a QNH with a clearance below the transition level. */
  qnhGiven: boolean;
  /** STAR id for arrivals, exit fix for departures. */
  route: string;
  spawnTime: number;
  /** Has been inside the TMA polygon at some point. */
  entered: boolean;
  /** Recent positions, newest first, sampled every 4 s. */
  trail: Vec[];
  stableChecked: boolean;
  checkInAt: number | null;
}

export interface Env {
  airport: Airport;
  landing: Runway;
  departure: Runway;
  wind: { dir: number; speed: number };
  /** Pro-mode ILS rules: ≤30° intercept, glideslope from at or below, stable-approach gate. */
  strictIls: boolean;
  time: number;
}

export type StepEvent =
  | { type: 'established' }
  | { type: 'landed' }
  | { type: 'goAround'; reason: 'unstable' | 'commanded' }
  | { type: 'leftAirspace' }
  | { type: 'gone' }
  | { type: 'checkIn' };

const tasOf = (ias: number, alt: number) => ias * (1 + (Math.max(alt, 0) / 1000) * 0.02);

/** Standard rate, limited by a 25° bank at higher speeds. deg/s */
export const turnRate = (tas: number) => Math.min(3, 509.5 / Math.max(tas, 60));

/** Position relative to a runway: `along` = NM before the threshold, `xte` = NM right of the centreline. */
export function runwayFrame(pos: Vec, rwy: Runway): { along: number; xte: number } {
  const dx = pos.x - rwy.pos.x;
  const dy = pos.y - rwy.pos.y;
  const c = rwy.heading * DEG;
  return { along: -(dx * Math.sin(c) + dy * Math.cos(c)), xte: dx * Math.cos(c) - dy * Math.sin(c) };
}

export function glideslopeAlt(along: number, rwy: Runway): number {
  const ils = rwy.ils!;
  return rwy.elevationFt + ils.tchFt + along * FT_PER_NM * Math.tan(ils.glideslopeDeg * DEG);
}

/** Heading that makes good `track` given the wind. */
function headingForTrack(track: number, tas: number, wind: Env['wind']): number {
  const cross = wind.speed * Math.sin((wind.dir + 180 - track) * DEG);
  return norm360(track - Math.asin(clamp(cross / Math.max(tas, 60), -1, 1)) / DEG);
}

function steer(ac: Aircraft, desired: number, dt: number, tas: number, force?: 'left' | 'right') {
  let d = angleDiff(ac.hdg, desired);
  if (force === 'right' && d < 0) d += 360;
  if (force === 'left' && d > 0) d -= 360;
  const max = turnRate(tas) * dt;
  ac.hdg = norm360(ac.hdg + clamp(d, -max, max));
}

export function startGoAround(ac: Aircraft, env: Env) {
  ac.nav = { mode: 'heading' };
  ac.tgtHdg = env.landing.heading;
  ac.turn = undefined;
  ac.tgtAlt = env.airport.missedApproachAltFt;
  ac.tgtIas = 200;
  ac.speedUntilDme = undefined;
  ac.ilsArmed = null;
  ac.locEstablished = ac.gsEstablished = false;
  ac.stableChecked = false;
  ac.phase = 'goaround';
  ac.comms = 'app';
}

/** Pilot's own speed when no speed is assigned. */
function normalSpeed(ac: Aircraft, along: number): number {
  if (ac.kind === 'departure') return 250;
  if (ac.nav.mode === 'loc') return along < 12 ? 180 : 210;
  return ac.alt >= 6000 ? 250 : 220;
}

/** Advance one aircraft by dt seconds. Returns events; 'landed' / 'leftAirspace' / 'gone' mean "remove me". */
export function stepAircraft(ac: Aircraft, dt: number, env: Env): StepEvent[] {
  const ev: StepEvent[] = [];
  const ap = env.airport;
  const tas = tasOf(ac.ias, ac.alt);
  const onGround = ac.nav.mode === 'takeoff' || ac.nav.mode === 'rollout';
  const rwy = env.landing;
  const frame = runwayFrame(ac.pos, rwy);

  // --- lateral ---
  switch (ac.nav.mode) {
    case 'heading': {
      steer(ac, ac.tgtHdg, dt, tas, ac.turn);
      if (ac.turn && Math.abs(angleDiff(ac.hdg, ac.tgtHdg)) < 5) ac.turn = undefined;
      break;
    }
    case 'direct': {
      const fix = ap.fixes[ac.nav.fix]!;
      if (ac.alt < ap.elevationFt + 600) break; // departures: runway track until safely airborne
      if (dist(ac.pos, fix) < Math.max(0.4, (ac.gs / 3600) * dt * 2)) {
        const next = ac.nav.then[0];
        if (next) ac.nav = { mode: 'direct', fix: next, then: ac.nav.then.slice(1) };
        else {
          ac.nav = { mode: 'heading' };
          ac.tgtHdg = Math.round(ac.hdg) || 360;
        }
      } else steer(ac, headingForTrack(bearing(ac.pos, fix), tas, env.wind), dt, tas);
      break;
    }
    case 'hold': {
      const h = ac.nav;
      const fix = ap.fixes[h.fix]!;
      if (h.leg === 'toFix') {
        steer(ac, headingForTrack(bearing(ac.pos, fix), tas, env.wind), dt, tas);
        if (dist(ac.pos, fix) < 0.5) {
          h.leg = 'outbound';
          h.timer = 0;
        }
      } else if (h.leg === 'outbound') {
        const out = norm360(h.inbound + 180);
        const far = Math.abs(angleDiff(ac.hdg, out)) > 10;
        steer(ac, out, dt, tas, far ? 'right' : undefined);
        if (!far && (h.timer += dt) >= 60) h.leg = 'turnIn';
      } else {
        const far = Math.abs(angleDiff(ac.hdg, h.inbound)) > 30;
        steer(ac, h.inbound, dt, tas, far ? 'right' : undefined);
        if (!far) h.leg = 'toFix';
      }
      break;
    }
    case 'loc': {
      const want = rwy.heading - clamp(frame.xte * 60, -30, 30);
      steer(ac, headingForTrack(norm360(want), tas, env.wind), dt, tas);
      if (
        !ac.locEstablished &&
        Math.abs(frame.xte) < 0.2 &&
        Math.abs(angleDiff(ac.track, rwy.heading)) < 10
      ) {
        ac.locEstablished = true;
        ev.push({ type: 'established' });
      }
      break;
    }
    case 'takeoff':
    case 'rollout':
      break;
  }

  // --- localizer capture ---
  if (ac.ilsArmed && ac.nav.mode !== 'loc' && !onGround && rwy.ils) {
    const off = Math.abs(angleDiff(ac.track, rwy.heading));
    const radius = ac.gs / 3600 / (turnRate(tas) * DEG);
    const lead = radius * (1 - Math.cos(Math.min(off, 90) * DEG)) + 0.1;
    const angleOk = env.strictIls ? off <= 30 : off < 150;
    if (frame.along > 0.5 && frame.along < rwy.ils.rangeNm && Math.abs(frame.xte) < lead && angleOk) {
      ac.nav = { mode: 'loc' };
      ac.turn = undefined;
      ac.phase = 'approach';
    }
  }

  // --- vertical ---
  let chase = false;
  if (ac.nav.mode === 'loc') {
    const gsAlt = glideslopeAlt(frame.along, rwy);
    if (!ac.gsEstablished) {
      if (ac.alt <= gsAlt + 100 && ac.alt >= gsAlt - 60) ac.gsEstablished = true;
      else if (ac.alt > gsAlt && !env.strictIls) chase = true; // Beginner: dive after the glideslope
    }
    if (ac.gsEstablished) {
      const prev = ac.alt;
      ac.alt = Math.min(ac.alt, gsAlt);
      ac.vs = ((ac.alt - prev) / dt) * 60;
      ac.tgtAlt = Math.min(ac.tgtAlt, ac.alt);
    }
    // stable-approach gate
    const gate = env.strictIls ? 4 : 2;
    if (!ac.stableChecked && frame.along < gate) {
      ac.stableChecked = true;
      const unstable = env.strictIls
        ? !ac.gsEstablished || !ac.locEstablished || ac.ias > 200
        : !ac.gsEstablished && ac.alt > gsAlt + 300;
      if (unstable) {
        startGoAround(ac, env);
        ev.push({ type: 'goAround', reason: 'unstable' });
      }
    }
    if (frame.along < 1 && ac.phase === 'approach') ac.phase = 'landing';
    if (ac.nav.mode === 'loc' && frame.along <= 0) {
      if (ac.gsEstablished) {
        ac.nav = { mode: 'rollout' };
        ac.phase = 'rollout';
        ac.alt = rwy.elevationFt;
        ac.vs = 0;
        ac.hdg = rwy.heading;
      } else {
        startGoAround(ac, env);
        ev.push({ type: 'goAround', reason: 'unstable' });
      }
    }
  }
  if (ac.nav.mode === 'takeoff') {
    if (ac.ias >= ac.perf.vr) {
      ac.nav = { mode: 'direct', fix: ac.route, then: [] };
      ac.phase = 'flight';
    }
  } else if (!ac.gsEstablished && ac.nav.mode !== 'rollout') {
    const target = chase ? Math.max(glideslopeAlt(frame.along, rwy), rwy.elevationFt) : ac.tgtAlt;
    const d = target - ac.alt;
    const rate = d > 0 ? ac.perf.climbFpm : chase ? 3500 : ac.perf.descentFpm;
    // chasing a moving target: feed forward the glideslope's own descent rate (~5.3 fpm per kt)
    const lead = chase ? ac.gs * 5.3 : 0;
    const want = d === 0 ? 0 : Math.sign(d) * Math.min(rate, Math.max(300, Math.abs(d) * 4 + lead));
    ac.vs = approach(ac.vs, want, 400 * dt);
    const stepFt = (ac.vs * dt) / 60;
    if (
      Math.abs(d) <= Math.abs(stepFt) ||
      (d !== 0 && Math.sign(stepFt) !== Math.sign(d) && Math.abs(d) < 20)
    ) {
      ac.alt = target;
      ac.vs = chase ? ac.vs : 0;
    } else ac.alt += stepFt;
  }

  // --- speed ---
  let want: number;
  if (ac.nav.mode === 'rollout') want = 0;
  else if (ac.nav.mode === 'takeoff') want = ac.perf.vr + 20;
  else if (ac.nav.mode === 'loc' && frame.along < (ac.speedUntilDme ?? 5)) want = ac.perf.vapp;
  else want = clamp(ac.tgtIas ?? normalSpeed(ac, frame.along), ac.perf.vapp, ac.perf.maxIas);
  const accel = onGround ? 4 : want > ac.ias ? 1.5 : ac.vs < -1000 ? 0.7 : 1.2;
  ac.ias = approach(ac.ias, want, accel * dt);

  // --- move ---
  const v = headingVec(ac.hdg, tasOf(ac.ias, ac.alt));
  if (!onGround) {
    const w = headingVec(env.wind.dir + 180, env.wind.speed);
    v.x += w.x;
    v.y += w.y;
  }
  ac.gs = Math.hypot(v.x, v.y);
  if (ac.gs > 1) ac.track = norm360(Math.atan2(v.x, v.y) / DEG);
  ac.pos.x += (v.x / 3600) * dt;
  ac.pos.y += (v.y / 3600) * dt;

  // --- bookkeeping ---
  if (
    ac.checkInAt !== null &&
    env.time >= ac.checkInAt &&
    (ac.kind === 'arrival' || ac.alt > ap.elevationFt + 1500)
  ) {
    ac.checkInAt = null;
    ac.comms = 'app';
    ev.push({ type: 'checkIn' });
  }
  if (ac.nav.mode === 'rollout' && ac.ias < 40) ev.push({ type: 'landed' });
  const inside = pointInPoly(ac.pos, ap.airspace.poly);
  if (inside) ac.entered = true;
  else if (ac.entered && !onGround && dist(ac.pos, { x: 0, y: 0 }) > 12) {
    // Holds at the IAFs straddle the TMA boundary, and a direct-to may clip it: neither counts as leaving.
    const excused = ac.nav.mode === 'hold' || (ac.nav.mode === 'direct' && dist(ac.pos, { x: 0, y: 0 }) < 60);
    if (!excused) ev.push({ type: 'leftAirspace' });
  } else if (!ac.entered && dist(ac.pos, { x: 0, y: 0 }) > 80) ev.push({ type: 'gone' });
  return ev;
}
