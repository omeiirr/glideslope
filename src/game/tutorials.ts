import { runwayFrame } from '../core';
import { STUDENT } from './scenarios';
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

/** Five short guided lessons. Each step completes when the aircraft state shows the instruction was given. */
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
};
