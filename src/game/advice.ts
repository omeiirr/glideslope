/**
 * Beginner help: the next step for one aircraft at Approach, and why, from where it is relative to the final.
 * The standard pattern for the landing runway: downwind (parallel to the final, the other way), base about
 * 12 NM out, then a 30° intercept with the ILS clearance, below the glideslope (see Learn → Approach procedure).
 */
import { glideslopeAlt, norm360, runwayFrame, type Aircraft, type Command, type Runway } from '../core';

export interface Advice {
  /** What to do next and why, in a sentence or two. */
  why: string;
  /** Transmissions that do it (each a list of instructions sent together); may be empty (just wait). */
  say: Command[][];
}

/** Turn base about this far out along the final (NM). */
export const BASE_NM = 12;
/** Turn onto the 30° intercept within this distance of the final (NM): it then joins 1.7 times as far on. */
const INTERCEPT_XTE = 3.5;
/** Closer in than this (NM), there is no room to slow down and get below the glideslope: go round again. */
const MIN_ALONG_NM = 7;
/** An intercept that joins closer than this to the runway is late (NM). */
const LATE_NM = 5;

/** Headings as controllers give them: to the nearest 10°, 360 for north. */
const hdg10 = (h: number) => {
  const r = Math.round(norm360(h) / 10) * 10;
  return r === 0 ? 360 : r;
};

const interceptHeading = (course: number, side: number) => {
  const h = norm360(course - side * 30);
  const r = side > 0 ? Math.ceil(h / 5) * 5 : Math.floor(h / 5) * 5;
  return r === 0 ? 360 : r;
};

export function approachAdvice(
  ac: Readonly<Aircraft>,
  rwy: Runway,
  opts: { contacted: boolean; qnh: number; transitionAltFt: number },
): Advice {
  if (!opts.contacted)
    return {
      why: 'It is calling you. Answer first, so the pilot knows you have it on radar.',
      say: [[{ type: 'identify' }]],
    };
  if (ac.kind === 'departure') {
    if (ac.tgtAlt < 10000)
      return {
        why: 'A departure climbs out above the arrivals, which are low near the airport. Clear it to the top of your airspace.',
        say: [[{ type: 'altitude', altitude: 10000, fl: true }]],
      };
    return {
      why: 'Climbing to FL100 and clear of the arrivals: hand it to Amsterdam Radar before it leaves your airspace.',
      say: [[{ type: 'handoff', to: 'radar' }]],
    };
  }
  if (ac.nav.mode === 'loc')
    return {
      why: 'On the localizer: it belongs to Tower now. Hand it off before about 8 miles from the runway.',
      say: [[{ type: 'handoff', to: 'tower' }]],
    };
  if (ac.ilsArmed)
    return {
      why: 'Cleared for the ILS: it turns onto the final by itself when it gets there. Just check its heading crosses the final at 30° or less.',
      say: [],
    };

  const { along, xte } = runwayFrame(ac.pos, rwy);
  // xte > 0: right of the inbound course, seen from an aircraft on final
  const side = xte >= 0 ? 1 : -1;
  const alt = (ft: number): Command => ({ type: 'altitude', altitude: ft, fl: false, qnh: opts.qnh });
  const descend = (ft: number): Command[] => (ac.tgtAlt > ft ? [alt(ft)] : []);

  // close enough to the final, far enough out: intercept and clear the approach
  if (along >= MIN_ALONG_NM && Math.abs(xte) <= INTERCEPT_XTE) {
    const late = along - Math.abs(xte) * Math.sqrt(3) < LATE_NM;
    // join from below the glideslope: 2000 ft is below it from about 6 NM out
    const below = glideslopeAlt(along - 2, rwy) - 200;
    const level = ac.tgtAlt > below ? descend(below >= 3000 ? 3000 : 2000) : [];
    return {
      why: `Turn it to cross the final at 30° and clear the ILS in the same call.${level.length ? ' It must join from below the glideslope, so bring it down too.' : ''}${late ? ' It will join late, close to the runway: next time turn base further out.' : ''}`,
      say: [
        [
          // to 5°, rounded towards the final course so the angle stays within 30°
          { type: 'heading', heading: interceptHeading(rwy.heading, side) },
          ...level,
          { type: 'ils', runway: rwy.id },
        ],
      ],
    };
  }
  // far out to one side: base leg, at right angles towards the final
  const base = hdg10(rwy.heading - side * 90);
  const onBase = ac.nav.mode === 'heading' && ac.tgtHdg === base;
  if (onBase && along >= MIN_ALONG_NM && Math.abs(xte) > INTERCEPT_XTE)
    return {
      why: `On base. Keep going until about ${INTERCEPT_XTE} miles from the final, then turn it onto a 30° intercept.${ac.tgtAlt > 2000 ? ' Meanwhile, descend to 2000 ft.' : ''}`,
      say: ac.tgtAlt > 2000 ? [[alt(2000)]] : [],
    };
  if (along >= BASE_NM - 1 && Math.abs(xte) > INTERCEPT_XTE)
    return {
      why: `About ${Math.round(along)} miles out and well to the side: turn base, towards the final, and come down to 2000 ft for the intercept.`,
      say: [[{ type: 'heading', heading: base }, ...descend(2000)]],
    };
  // beside or short of the airport: fly downwind, the other way to the final, until about 12 miles out
  const downwind = hdg10(rwy.heading + 180);
  const onDownwind = ac.nav.mode === 'heading' && ac.tgtHdg === downwind && Math.abs(xte) >= 3;
  if (onDownwind)
    return {
      why: `On downwind. Keep going until about ${BASE_NM} miles out (just past the 10-mile tick on the final), then turn base.${ac.tgtAlt > 3000 ? ' Meanwhile, descend.' : ''}`,
      say: ac.tgtAlt > 3000 ? [[alt(3000)]] : [],
    };
  // too near the final line to fly a downwind beside it: move out to one side first
  const heading = Math.abs(xte) < 3 ? hdg10(rwy.heading + 180 - side * 30) : downwind;
  return {
    why: `Too close in to join the final. Fly a downwind leg: parallel to the final, the opposite way, ${Math.abs(xte) < 3 ? 'angled out to one side first, ' : ''}and descend to 3000 ft.`,
    say: [[{ type: 'heading', heading }, ...descend(opts.transitionAltFt)]],
  };
}
