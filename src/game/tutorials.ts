import { dist, runwayFrame, type Vec } from '../core';
import { LESSON_DEPARTURE, LESSON_LEADER, LESSON_TRAFFIC, STUDENT, finalPt } from './scenarios';
import type { Session } from './session';

export interface LessonStep {
  /** What to do and why. */
  text: string;
  /** Example transmission, shown in a box and insertable into the command line. */
  say?: string;
  done: (s: Session) => boolean;
}

/** A path to fly, drawn on the scope during a lesson (NM), with labels along it. */
export interface Guide {
  path: Vec[];
  /** `left`: text ends at the point instead of starting there. */
  labels: { at: Vec; text: string; left?: boolean }[];
}

export interface Lesson {
  title: string;
  steps: LessonStep[];
  guide?: Guide;
}

/**
 * The standard pattern west of the 18R final: downwind 6 NM out, base `baseNm` out, a 30° intercept from 3.5 NM
 * off, joining the final 6 NM further in (3.5 · √3).
 */
function pattern(baseNm: number): Guide {
  const join = baseNm - 3.5 * Math.sqrt(3);
  return {
    path: [finalPt(-1, 6), finalPt(baseNm, 6), finalPt(baseNm, 3.5), finalPt(join), finalPt(0)],
    labels: [
      { at: finalPt(baseNm / 2, 6), text: 'DOWNWIND 3000', left: true },
      { at: finalPt(baseNm, 4.75), text: 'BASE 2000' },
      { at: finalPt(baseNm - 3, 2), text: 'INTERCEPT 30°' },
      { at: finalPt(join), text: `JOIN ${Math.round(join)} NM` },
    ],
  };
}

const ac = (s: Session) => s.sim.byCallsign(STUDENT);
const hdg = (s: Session, h: number) => ac(s)?.nav.mode === 'heading' && ac(s)?.tgtHdg === h;
const near = (a: number, b: number, tol: number) => Math.abs(a - b) <= tol;
const other = (s: Session, cs: string) => s.sim.byCallsign(cs);
/** Gone from the sim, or handed to another station: the tower lesson aircraft is done. */
const passedOn = (s: Session, cs: string) => {
  const a = other(s, cs);
  return !a || (a.comms !== 'tower' && a.comms !== 'none');
};
const WIND = 'wind 200 degrees 8 knots';
/** Where the lesson aircraft is relative to the 18R final (`along` NM out, `xte` NM to the right, i.e. west). */
const frame = (s: Session, cs = STUDENT) => {
  const a = other(s, cs);
  return a ? runwayFrame(a.pos, s.sim.env.landing) : { along: 0, xte: 0 };
};
const TOWER = 'contact Schiphol Tower 118.280';
/** The lesson aircraft has made its first call. */
const called = (s: Session) => ac(s)?.checkInAt === null && ac(s)?.comms === 'app';

/** Ten guided lessons for Approach, four for Tower. Each step completes when the aircraft state shows the instruction was given. */
export const LESSONS: Record<string, Lesson> = {
  heading: {
    title: 'Headings',
    steps: [
      {
        text: `${STUDENT} is flying west. Every transmission starts with the callsign. Give a heading as three digits, with the direction of turn. Hold Space and speak, or press Enter and type.`,
        say: `${STUDENT}, turn left heading 180`,
        done: (s) => hdg(s, 180),
      },
      {
        text: 'The pilot read your instruction back and is turning. Always listen to the readback. Now turn the aircraft the other way, towards the north-west.',
        say: `${STUDENT}, turn right heading 330`,
        done: (s) => hdg(s, 330),
      },
      {
        text: 'You can also send an aircraft straight to a fix. SPL is the beacon on the airport.',
        say: `${STUDENT}, proceed direct SPL`,
        done: (s) => ac(s)?.nav.mode === 'direct',
      },
    ],
  },
  altitude: {
    title: 'Levels',
    steps: [
      {
        text: `${STUDENT} is at flight level 70. Above the transition level (FL040 today) you use flight levels.`,
        say: `${STUDENT}, descend flight level 50`,
        done: (s) => ac(s)?.tgtAlt === 5000,
      },
      {
        text: 'At or below the transition altitude (3000 ft) you use "altitude" in feet, and the first time you add the QNH so the pilot can set the altimeter.',
        say: `${STUDENT}, descend altitude 3000, QNH 1013`,
        done: (s) => ac(s)?.tgtAlt === 3000,
      },
      {
        text: 'Watch the data block: 070↓030 means passing FL070, descending to 3000 ft. Wait until the aircraft is level at 3000 ft.',
        done: (s) => near(ac(s)?.alt ?? 0, 3000, 50),
      },
    ],
  },
  speed: {
    title: 'Speed',
    steps: [
      {
        text: `${STUDENT} is doing 250 knots. Speed control is how you build a neat sequence on final. Slow it down.`,
        say: `${STUDENT}, reduce speed 200 knots`,
        done: (s) => ac(s)?.tgtIas === 200,
      },
      {
        text: 'Jets slow at roughly one knot per second. Wait for 200 knots (third number in the data block).',
        done: (s) => near(ac(s)?.ias ?? 0, 200, 3),
      },
      {
        text: 'When you no longer need the restriction, give the speed back to the pilot.',
        say: `${STUDENT}, resume normal speed`,
        done: (s) => ac(s)?.tgtIas === null,
      },
    ],
  },
  ils: {
    title: 'ILS approach',
    steps: [
      {
        text: `Runway 18R points south; the dashed line north of it is the final approach. ${STUDENT} is east of it at 2000 ft. Turn it onto a heading that crosses the final at 30° or less, and clear the approach in the same transmission.`,
        say: `${STUDENT}, turn left heading 210, cleared ILS approach runway 18R`,
        done: (s) => ac(s)?.ilsArmed === '18R',
      },
      {
        text: 'The aircraft will turn onto the localizer by itself, then follow the glideslope down. Wait until it is established (the target turns green).',
        done: (s) => !!ac(s)?.locEstablished,
      },
      {
        text: 'Keep the speed up until short final so the runway is used efficiently.',
        say: `${STUDENT}, maintain 180 knots until 4 miles final`,
        done: (s) => ac(s)?.tgtIas === 180 || !ac(s),
      },
      {
        text: 'In Beginner mode the handoff to Tower is automatic. Watch it land.',
        done: (s) => s.stats.landed > 0,
      },
    ],
  },
  handoff: {
    title: 'Handoff',
    steps: [
      {
        text: `This lesson uses Professional rules: nothing is automatic. Clear ${STUDENT} for the approach.`,
        say: `${STUDENT}, cleared ILS approach runway 18R`,
        done: (s) => ac(s)?.ilsArmed === '18R',
      },
      {
        text: 'Wait until it is established on the localizer.',
        done: (s) => !!ac(s)?.locEstablished,
      },
      {
        text: 'An established aircraft belongs to Tower. Hand it off, with the frequency, before about 6 miles from touchdown.',
        say: `${STUDENT}, contact Schiphol Tower 118.280`,
        done: (s) => {
          const a = ac(s);
          return a?.comms === 'tower' && runwayFrame(a.pos, s.sim.env.landing).along > 0;
        },
      },
      {
        text: 'Done. Once it has switched frequency it no longer hears you. Watch it land.',
        done: (s) => s.stats.landed > 0,
      },
    ],
  },
  pattern: {
    title: 'A whole arrival',
    guide: pattern(14),
    steps: [
      {
        text: `The dashed path is the standard way onto runway 18R from the west: a downwind leg parallel to the final, a base leg towards it, then a 30° intercept. ${STUDENT} is on the downwind and about to call you: wait for its call.`,
        done: (s) => called(s),
      },
      {
        text: 'Answer it, so the pilot knows you have it on radar.',
        say: `${STUDENT}, Schiphol Approach, identified`,
        done: (s) => !!ac(s)?.identified,
      },
      {
        text: 'First the descent: arrivals come down to 3000 ft on the downwind. Below the transition level you say "altitude" and give the QNH.',
        say: `${STUDENT}, descend altitude 3000, QNH 1013`,
        done: (s) => ac(s)?.tgtAlt === 3000,
      },
      {
        text: 'Now wait until it reaches the BASE mark, about 14 miles out (the final has a tick every 5 miles). The 2× button speeds things up.',
        done: (s) => frame(s).along >= 13.5,
      },
      {
        text: 'Turn base: at right angles towards the final, and down to 2000 ft so it will meet the glideslope from below.',
        say: `${STUDENT}, turn right heading 090, descend altitude 2000`,
        done: (s) => ac(s)?.tgtHdg === 90 && (ac(s)?.tgtAlt ?? 9999) <= 2000,
      },
      {
        text: 'Wait until it is about 3½ miles from the final (the INTERCEPT mark).',
        done: (s) => Math.abs(frame(s).xte) <= 3.8,
      },
      {
        text: 'Turn it to cross the final at 30° (the final is 183°, so 155) and clear the approach in the same call.',
        say: `${STUDENT}, turn right heading 155, cleared ILS approach runway 18R`,
        done: (s) => ac(s)?.ilsArmed === '18R',
      },
      {
        text: 'It joins the localizer by itself. Wait until it is established (the target turns green).',
        done: (s) => !!ac(s)?.locEstablished,
      },
      {
        text: 'Established: hand it to Tower. (In Beginner mode this happens by itself at 8 miles if you do not.)',
        say: `${STUDENT}, ${TOWER}`,
        done: (s) => ac(s)?.comms === 'tower' || !ac(s),
      },
      {
        text: 'That is a whole arrival. Watch it land.',
        done: (s) => s.stats.landed > 0,
      },
    ],
  },
  intercept: {
    title: 'Joining the localizer',
    steps: [
      {
        text: `This lesson uses Professional rules. An aircraft joins the localizer only from a heading within 30° of the final. ${STUDENT} is crossing it at about 90°: clear it for the ILS without a turn and see what happens.`,
        say: `${STUDENT}, cleared ILS approach runway 18R`,
        done: (s) => ac(s)?.ilsArmed === '18R',
      },
      {
        text: 'Watch: it flies straight through the final (the dashed line). At 90° it would overshoot far beyond, so the pilot does not try.',
        done: (s) => frame(s).xte > 1.5,
      },
      {
        text: 'Bring it back on a 30° intercept: from this side that is heading 155. A new heading cancels the clearance, so clear it again in the same call.',
        say: `${STUDENT}, turn left heading 155, cleared ILS approach runway 18R`,
        done: (s) => ac(s)?.ilsArmed === '18R' && ac(s)?.tgtHdg === 155,
      },
      {
        text: 'Wait until it is established on the localizer.',
        done: (s) => !!ac(s)?.locEstablished,
      },
      {
        text: 'Now the glideslope. In Professional mode an aircraft must meet it from below or level with it. This one is at 2000 ft, below it, so it flies level until the glideslope comes down to meet it, then descends. Watch the altitude in the data block.',
        done: (s) => !!ac(s)?.gsEstablished,
      },
      {
        text: 'Established on both. Nothing is automatic in Professional mode: hand it to Tower.',
        say: `${STUDENT}, ${TOWER}`,
        done: (s) => ac(s)?.comms === 'tower' || !ac(s),
      },
    ],
  },
  sequence: {
    title: 'Two in a row',
    guide: {
      ...pattern(17),
      labels: pattern(17).labels.map((l) => ({
        ...l,
        text: l.text.replace('DOWNWIND 3000', 'LONGER DOWNWIND'),
      })),
    },
    steps: [
      {
        text: `${LESSON_LEADER} is on base, close to the final; ${STUDENT} is behind it on the downwind. First the leader: turn it onto the intercept and clear the approach.`,
        say: `${LESSON_LEADER}, turn right heading 155, cleared ILS approach runway 18R`,
        done: (s) => other(s, LESSON_LEADER)?.ilsArmed === '18R',
      },
      {
        text: `Aircraft on final must be at least 3 miles apart (more behind a heavy, see Learn). Slow ${STUDENT} down so it does not catch up.`,
        say: `${STUDENT}, reduce speed 180 knots`,
        done: (s) => (ac(s)?.tgtIas ?? 999) <= 180,
      },
      {
        text: 'Then make its path longer: do not turn base at the usual 12–14 miles, keep it on the downwind to the BASE mark at 17 miles.',
        done: (s) => frame(s).along >= 16.5,
      },
      {
        text: 'Now turn base.',
        say: `${STUDENT}, turn right heading 090`,
        done: (s) => ac(s)?.tgtHdg === 90,
      },
      {
        text: 'Wait for the INTERCEPT mark, about 3½ miles from the final.',
        done: (s) => Math.abs(frame(s).xte) <= 3.8,
      },
      {
        text: 'Intercept and clear the approach.',
        say: `${STUDENT}, turn right heading 155, cleared ILS approach runway 18R`,
        done: (s) => ac(s)?.ilsArmed === '18R',
      },
      {
        text: `Wait until it is established, and look at the gap to ${LESSON_LEADER}: the ticks on the final are 5 miles apart. Next time, use the speed earlier or a longer downwind if it is too small.`,
        done: (s) => !!ac(s)?.locEstablished,
      },
      {
        text: 'Watch the leader land: the runway is free well before the second one arrives.',
        done: (s) => s.stats.landed > 0,
      },
    ],
  },
  separation: {
    title: 'Separation',
    steps: [
      {
        text: `${STUDENT} and ${LESSON_TRAFFIC} are both at FL060 and their paths cross: the scope marks a predicted conflict. Aircraft must stay 3 miles apart, or 1000 ft. The simplest fix is a level: put one of them 1000 ft lower. (A turn of 30° or more works too.)`,
        say: `${STUDENT}, descend flight level 50`,
        done: (s) => {
          const [a, b] = [ac(s), other(s, LESSON_TRAFFIC)];
          if (!a || !b) return true;
          const turned = (x: typeof a, h: number) =>
            x.nav.mode !== 'heading' || Math.abs(((x.tgtHdg - h + 540) % 360) - 180) >= 30;
          return Math.abs(a.tgtAlt - b.tgtAlt) >= 1000 || turned(a, 270) || turned(b, 180);
        },
      },
      {
        text: 'Watch them pass. A real loss of separation turns the targets red and is logged; in Professional mode it costs 200 points.',
        done: (s) => {
          const [a, b] = [ac(s), other(s, LESSON_TRAFFIC)];
          return !a || !b || (dist(a.pos, b.pos) > 6 && a.pos.x < 3);
        },
      },
      {
        text: 'Clear of each other. Send it on its way to the airport beacon.',
        say: `${STUDENT}, proceed direct SPL`,
        done: (s) => ac(s)?.nav.mode === 'direct',
      },
    ],
  },
  departure: {
    title: 'Departures',
    steps: [
      {
        text: `${STUDENT} has just taken off from runway 24 and will call you. Departures climb to 6000 ft and fly to their exit point (LEKKO, south). Wait for its call.`,
        done: (s) => called(s),
      },
      {
        text: 'Answer it.',
        say: `${STUDENT}, Schiphol Approach, identified`,
        done: (s) => !!ac(s)?.identified,
      },
      {
        text: 'Arrivals are low near the airport, so climb it to the top of your airspace, FL100.',
        say: `${STUDENT}, climb flight level 100`,
        done: (s) => (ac(s)?.tgtAlt ?? 0) >= 10000,
      },
      {
        text: 'Before it leaves your airspace (the dotted line) hand it to Amsterdam Radar, the next controller. This lesson uses Professional rules, so this is not automatic.',
        say: `${STUDENT}, contact Amsterdam Radar 125.750`,
        done: (s) => ac(s)?.comms === 'radar' || !ac(s),
      },
    ],
  },
  twLand: {
    title: 'Landing clearance',
    steps: [
      {
        text: `You are Schiphol Tower, in the Tower West cab looking north along runway 18R. Approach has sent ${STUDENT}: it calls you on final and is in the Arrivals bay below the window. A landing clearance has three parts: the runway, the surface wind, then "cleared to land".`,
        say: `${STUDENT}, runway 18R, ${WIND}, cleared to land`,
        done: (s) => !!ac(s)?.landClear,
      },
      {
        text: 'The pilot read it back: always check the runway in the readback. Without a landing clearance by half a mile out, a pilot must go around. Watch it touch down (hold B for the binoculars).',
        done: (s) => s.stats.landed > 0,
      },
      {
        text: 'In Beginner mode the aircraft turns off by itself and changes to Ground. Wait until it has left the runway: the On runway bay empties.',
        done: (s) => passedOn(s, STUDENT),
      },
    ],
  },
  twDepart: {
    title: 'Line up and take-off',
    steps: [
      {
        text: `${STUDENT} is at holding point S7E for runway 24 and has called ready (Departures bay). Press 2 for the Centre cab, which looks along 24. "Line up and wait" lets it enter the runway and stop, so it is ready to go the moment the runway is yours.`,
        say: `${STUDENT}, runway 24, line up and wait`,
        done: (s) => {
          const n = ac(s)?.nav;
          return n?.mode === 'lineup' || (n?.mode === 'taxi' && n.then === 'lineup');
        },
      },
      {
        text: 'Wait until it is lined up on the centreline (strip: "lined up").',
        done: (s) => {
          const n = ac(s)?.nav;
          return n?.mode === 'lineup' && n.ready;
        },
      },
      {
        text: 'The take-off clearance mirrors the landing one: runway, wind, "cleared for take-off". Only this phrase uses the word "take-off".',
        say: `${STUDENT}, runway 24, ${WIND}, cleared for take-off`,
        done: (s) => !!ac(s)?.takeoffClear || ac(s)?.nav.mode === 'takeoff',
      },
      {
        text: 'In Beginner mode it changes to Departure by itself once airborne. Watch it go.',
        done: (s) => passedOn(s, STUDENT),
      },
    ],
  },
  twVacate: {
    title: 'Vacate and handoffs',
    steps: [
      {
        text: `This lesson uses Professional rules: nothing is automatic. Clear ${STUDENT} to land.`,
        say: `${STUDENT}, runway 18R, ${WIND}, cleared to land`,
        done: (s) => !!ac(s)?.landClear,
      },
      {
        text: 'Tell it where to leave the runway, and pass it to Ground in the same call so you need not talk to it again. Exits on 18R are V1 to V4; V3 on the left suits a 737.',
        say: `${STUDENT}, vacate left via V3, when vacated contact Ground 121.560`,
        done: (s) => !!ac(s)?.vacate,
      },
      {
        text: 'It changes to Ground by itself once it is off the runway. Wait for that.',
        done: (s) => passedOn(s, STUDENT),
      },
      {
        text: `${LESSON_DEPARTURE} is ready at S7E. With nothing on the runway you can clear it for take-off straight from the holding point.`,
        say: `${LESSON_DEPARTURE}, runway 24, ${WIND}, cleared for take-off`,
        done: (s) =>
          !!other(s, LESSON_DEPARTURE)?.takeoffClear || other(s, LESSON_DEPARTURE)?.nav.mode === 'takeoff',
      },
      {
        text: 'Once it is airborne, hand it to Departure before it reaches 2000 ft, or it counts as a late handoff.',
        say: `${LESSON_DEPARTURE}, contact Departure 119.055`,
        done: (s) => other(s, LESSON_DEPARTURE)?.comms === 'departure' || passedOn(s, LESSON_DEPARTURE),
      },
    ],
  },
  twGoAround: {
    title: 'Go-around',
    steps: [
      {
        text: `Two arrivals: ${LESSON_LEADER} is close in, ${STUDENT} follows too closely behind. Clear the leader to land first.`,
        say: `${LESSON_LEADER}, runway 18R, ${WIND}, cleared to land`,
        done: (s) => !!other(s, LESSON_LEADER)?.landClear,
      },
      {
        text: `${STUDENT} is too close: ${LESSON_LEADER} will still be on the runway when it arrives. Do not clear it to land. Watch the leader touch down.`,
        done: (s) => s.stats.landed > 0,
      },
      {
        text: `The runway is occupied and ${STUDENT} is about 2 miles out. Send it around: the instruction is short, so the pilot cannot mishear it.`,
        say: `${STUDENT}, go around`,
        done: (s) => ac(s)?.phase === 'goaround',
      },
      {
        text: 'It flies the missed approach: straight ahead, climbing to 2000 ft. Approach takes it back and will feed it in again. Wait until it is handed back.',
        done: (s) => passedOn(s, STUDENT) || (ac(s)?.alt ?? 0) >= 1900,
      },
    ],
  },
};
