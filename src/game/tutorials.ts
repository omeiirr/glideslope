import { runwayFrame } from '../core';
import { LESSON_DEPARTURE, LESSON_LEADER, STUDENT } from './scenarios';
import type { Session } from './session';

export interface LessonStep {
  /** What to do and why. */
  text: string;
  /** Example transmission, shown in a box and insertable into the command line. */
  say?: string;
  done: (s: Session) => boolean;
}

export interface Lesson {
  title: string;
  steps: LessonStep[];
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

/** Five short guided lessons for Approach, four for Tower. Each step completes when the aircraft state shows the instruction was given. */
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
        say: `${STUDENT}, vacate left via V3, when vacated contact Ground 121.800`,
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
        say: `${LESSON_DEPARTURE}, contact Departure 120.555`,
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
