import type { Perf, Wake } from '../aircraft/perf';
import { wakeMinimum } from './separation';

/** The stand-in Approach releases arrivals onto the final here (NM from the threshold), at this speed. */
export const FEED_NM = 12;
export const FEED_KT = 180;
/** Arrivals fly FEED_KT until this distance, then slow to their approach speed (aircraft.ts normalSpeed). */
const SLOW_NM = 5;
/** Threshold to holding position on the exit, with a margin: about 60 s measured (T2), 75 s assumed. */
const RUNWAY_OCC_S = 75;
/** The follower must find the runway free by this distance (the occupied-runway go-around point) plus a margin. */
const CLEAR_BY_NM = 0.2 + 0.5;

/**
 * Gap (NM) the stand-in Approach leaves between a leader and a follower at the feed point, so the follower keeps
 * wake spacing and finds the runway vacated. The gap closes while the leader flies its last 5 NM at about its
 * approach speed and the follower is still at FEED_KT.
 */
export function feedGap(lead: Perf, follow: Perf): number {
  const closure = SLOW_NM * (FEED_KT / (lead.vapp + 10) - 1);
  const runwayFree = (RUNWAY_OCC_S * FEED_KT) / 3600 + CLEAR_BY_NM;
  return Math.max(wakeMinimum(lead.wake, follow.wake), runwayFree) + closure;
}

/**
 * Time-based wake minima between departures (seconds, leader → follower), measured between lift-offs.
 * Doc 4444 departure wake minima as recalled, not checked against the document: 2 min for Light or Medium behind
 * Heavy and Light behind Medium; behind an A380, 2 min for Heavy and 3 min for Medium or Light. See DECISIONS.md.
 */
const DEP_WAKE: Partial<Record<Wake, Partial<Record<Wake, number>>>> = {
  J: { H: 120, M: 180, L: 180 },
  H: { M: 120, L: 120 },
  M: { L: 120 },
};
export const departureWakeS = (leader: Wake, follower: Wake): number => DEP_WAKE[leader]?.[follower] ?? 0;
