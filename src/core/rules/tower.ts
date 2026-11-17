import type { Perf, Wake } from '../aircraft/perf';
import { wakeMinimum } from './separation';

/**
 * The stand-in Approach releases arrivals onto the final here (NM from the threshold) with Schiphol's standard
 * speed control: FEED_KT until SLOW_NM ("160 knots until 4 miles final"), then their own approach speed.
 */
export const FEED_NM = 12;
export const FEED_KT = 160;
export const SLOW_NM = 4;
/** Threshold to holding position on the exit: about 60 s measured (T2), 75 s assumed. */
const RUNWAY_OCC_S = 75;
/** Margin on top: occupancy runs to 85-90 s for some type and exit mixes (measured with 160 kt to 4 NM). */
const OCC_MARGIN_S = 25;
/** The occupied-runway go-around happens here (NM from the threshold): the runway must be free by then. */
const CLEAR_BY_NM = 0.2;

/**
 * Gap (NM) the stand-in Approach leaves between a leader and a follower at the feed point, flying FEED_KT to
 * SLOW_NM, then their approach speed. Two needs, the larger wins:
 * - wake: the gap closes while the leader flies its last SLOW_NM slower and the follower is still at FEED_KT;
 * - runway free: the follower reaches CLEAR_BY_NM no earlier than the leader's runway occupancy after touchdown.
 *   Time from release to there, follower minus leader: gap/F + (S-P)/vF - S/vL >= occupancy.
 */
export function feedGap(lead: Perf, follow: Perf): number {
  const F = FEED_KT / 3600;
  const vL = lead.vapp / 3600; // slow leader: the worst case
  const vF = (follow.vapp + 10) / 3600; // fast follower: the worst case
  const wake = wakeMinimum(lead.wake, follow.wake) + SLOW_NM * (FEED_KT / (lead.vapp + 10) - 1);
  const runwayFree = F * (RUNWAY_OCC_S + OCC_MARGIN_S + SLOW_NM / vL - (SLOW_NM - CLEAR_BY_NM) / vF);
  return Math.max(wake, runwayFree);
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
