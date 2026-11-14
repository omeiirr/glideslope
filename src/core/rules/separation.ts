import { runwayFrame, type Aircraft } from '../aircraft/aircraft';
import type { Wake } from '../aircraft/perf';
import type { Runway } from '../airport/types';
import { approach, dist, headingVec } from '../geo';

export const SEP_NM = 3;
export const SEP_FT = 1000;

export interface Conflict {
  a: number;
  b: number;
  kind: 'loss' | 'wake' | 'predicted';
  /** Current lateral distance (NM) and vertical distance (ft). */
  dist: number;
  altDiff: number;
  /** predicted: seconds until separation is lost, and the lateral distance at that moment. */
  timeTo?: number;
  /** wake: required spacing in NM. */
  required?: number;
}

/**
 * ICAO Doc 4444 §8.7.3.4 distance-based wake minima (leader → follower), NM.
 * Pairs not listed use the radar minimum.
 */
const WAKE: Partial<Record<Wake, Partial<Record<Wake, number>>>> = {
  J: { H: 6, M: 7, L: 8 },
  H: { H: 4, M: 5, L: 6 },
  M: { L: 5 },
};
export const wakeMinimum = (leader: Wake, follower: Wake): number => WAKE[leader]?.[follower] ?? SEP_NM;

const airborne = (ac: Aircraft) =>
  ac.nav.mode !== 'rollout' && ac.nav.mode !== 'takeoff' && ac.comms !== 'none';

function altAt(ac: Aircraft, t: number): number {
  if (ac.gsEstablished) return ac.alt + (ac.vs * t) / 60;
  const rate = ac.tgtAlt > ac.alt ? ac.perf.climbFpm : ac.perf.descentFpm;
  return approach(ac.alt, ac.tgtAlt, (rate * t) / 60);
}

/** Current losses, wake infringements on final, and straight-line predictions up to `lookahead` s. */
export function detectConflicts(aircraft: readonly Aircraft[], landing: Runway, lookahead = 120): Conflict[] {
  const out: Conflict[] = [];
  const list = aircraft.filter(airborne);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i]!;
      const b = list[j]!;
      const d = dist(a.pos, b.pos);
      if (d > 30) continue;
      const altDiff = Math.abs(a.alt - b.alt);
      const base = { a: a.id, b: b.id, dist: d, altDiff };
      if (d < SEP_NM && altDiff < SEP_FT) {
        out.push({ ...base, kind: 'loss' });
        continue;
      }
      const bothFinal = a.nav.mode === 'loc' && b.nav.mode === 'loc';
      if (bothFinal) {
        const [lead, follow] =
          runwayFrame(a.pos, landing).along < runwayFrame(b.pos, landing).along ? [a, b] : [b, a];
        const required = wakeMinimum(lead.perf.wake, follow.perf.wake);
        if (d < required && altDiff < SEP_FT) out.push({ ...base, kind: 'wake', required });
        continue; // in-trail on final: no straight-line prediction
      }
      const va = headingVec(a.track, a.gs / 3600);
      const vb = headingVec(b.track, b.gs / 3600);
      for (let t = 5; t <= lookahead; t += 5) {
        const dx = b.pos.x + vb.x * t - a.pos.x - va.x * t;
        const dy = b.pos.y + vb.y * t - a.pos.y - va.y * t;
        const dd = Math.hypot(dx, dy);
        const dAlt = Math.abs(altAt(a, t) - altAt(b, t));
        if (dd < SEP_NM && dAlt < SEP_FT) {
          out.push({ ...base, kind: 'predicted', timeTo: t });
          break;
        }
      }
    }
  }
  return out;
}
