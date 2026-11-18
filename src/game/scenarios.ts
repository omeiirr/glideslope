import { EHAM, headingVec, runwayById, type SpawnSpec, type TrafficConfig } from '../core';

/** Pure-data scenario description (JSON-compatible). */
export interface Scenario {
  id: string;
  name: string;
  blurb: string;
  mode: 'beginner' | 'pro';
  seed: number;
  /** 0 = open-ended. */
  durationMin: number;
  wind?: { dir: number; speed: number };
  qnh?: number;
  traffic: TrafficConfig;
  /** Scripted aircraft, `at` seconds after the start. */
  spawns?: (SpawnSpec & { at: number })[];
  /** Tutorial lesson id (steps live in tutorials.ts). */
  lesson?: string;
  /** Main view. Default: the radar scope. */
  view?: 'tower';
  /** Prevailing visibility in metres (tower view fog). Default: clear, and the player may change it. */
  visibilityM?: number;
  /** Cloud base in feet above the field (tower view); below 2000 overcast, from 2000 broken. Default: none. */
  ceilingFt?: number;
  /** Tower view start: time of day. Default: day. */
  timeOfDay?: 'day' | 'dusk' | 'night';
}

/** The tutorial aircraft. */
export const STUDENT = 'KLM1426';

const NONE: TrafficConfig = { arrivalsPerHour: 0, departuresPerHour: 0 };
const CALM = { dir: 200, speed: 0 };
/** One friendly aircraft, already on frequency, for the tutorial lessons. */
const student = (x: number, y: number, hdg: number, alt: number, ias = 220): SpawnSpec & { at: number } => ({
  at: 0,
  kind: 'arrival',
  callsign: STUDENT,
  type: 'B738',
  pos: { x, y },
  hdg,
  alt,
  ias,
  onFrequency: true,
});

const FINAL = runwayById(EHAM, EHAM.config.landing);
/**
 * A point `d` NM out along the landing runway's final (negative: past the threshold), `right` NM to the right of
 * the inbound course (seen from an aircraft on final; for 18R that is west). The radar lessons' geometry.
 */
export function finalPt(d: number, right = 0): { x: number; y: number } {
  const out = headingVec(FINAL.heading + 180, d);
  const side = headingVec(FINAL.heading + 90, right);
  return { x: FINAL.pos.x + out.x + side.x, y: FINAL.pos.y + out.y + side.y };
}
/** Other aircraft in the radar lessons. */
export const LESSON_TRAFFIC = 'BAW432';
/** Tower scenarios start with one arrival 6 NM out, so there is something to do at once; the rest come from the feed. */
const firstArrival = (callsign: string, type: string): SpawnSpec & { at: number } => {
  const out = headingVec(FINAL.heading + 180, 6);
  return {
    at: 0,
    kind: 'arrival',
    callsign,
    type,
    pos: { x: FINAL.pos.x + out.x, y: FINAL.pos.y + out.y },
    hdg: FINAL.heading,
    alt: 1900,
    ias: 170,
    onFrequency: true,
    priority: false, // the opening arrival stays plain
  };
};
/** An arrival established on the 18R final, `nm` out, on the glideslope (about 318 ft per NM), calling Tower. */
const onFinal = (callsign: string, nm: number, type = 'B738'): SpawnSpec & { at: number } => {
  const out = headingVec(FINAL.heading + 180, nm);
  return {
    at: 0,
    kind: 'arrival',
    callsign,
    type,
    pos: { x: FINAL.pos.x + out.x, y: FINAL.pos.y + out.y },
    hdg: FINAL.heading,
    alt: Math.round(nm * 318),
    ias: nm > 5 ? 170 : 160,
    onFrequency: true,
  };
};
const atHoldingPoint = (callsign: string, route = 'LEKKO'): SpawnSpec & { at: number } => ({
  at: 0,
  kind: 'departure',
  callsign,
  type: 'B738',
  route,
});
/** Tower lessons: light wind, so the clearances carry a real wind but it changes nothing. */
const LESSON_WIND = { dir: 200, speed: 8 };
/** Other aircraft in the tower lessons. */
export const LESSON_LEADER = 'EZY81Q';
export const LESSON_DEPARTURE = 'TRA6015';

/** Narrowbodies only (no light or heavy wake pairs). */
const TOWER_EASY = ['B738', 'A320', 'A20N', 'E190', 'E195', 'A321', 'B38M'];

export const SCENARIOS: Scenario[] = [
  {
    id: 'tut-heading',
    lesson: 'heading',
    name: '1 · Headings',
    blurb: 'Turn an aircraft with "turn left heading …".',
    mode: 'beginner',
    seed: 1,
    durationMin: 0,
    wind: CALM,
    traffic: NONE,
    spawns: [student(14, 14, 270, 5000)],
  },
  {
    id: 'tut-altitude',
    lesson: 'altitude',
    name: '2 · Levels',
    blurb: 'Flight levels, altitudes and the QNH.',
    mode: 'beginner',
    seed: 1,
    durationMin: 0,
    wind: CALM,
    traffic: NONE,
    spawns: [student(18, 12, 270, 7000)],
  },
  {
    id: 'tut-speed',
    lesson: 'speed',
    name: '3 · Speed',
    blurb: 'Slow aircraft down to build a sequence.',
    mode: 'beginner',
    seed: 1,
    durationMin: 0,
    wind: CALM,
    traffic: NONE,
    spawns: [student(16, 16, 270, 4000, 250)],
  },
  {
    id: 'tut-ils',
    lesson: 'ils',
    name: '4 · ILS approach',
    blurb: 'Vector onto the localizer and clear the approach.',
    mode: 'beginner',
    seed: 1,
    durationMin: 0,
    wind: CALM,
    traffic: NONE,
    spawns: [student(5, 22, 270, 2000, 200)],
  },
  {
    id: 'tut-handoff',
    lesson: 'handoff',
    name: '5 · Handoff',
    blurb: 'Hand an established aircraft to Tower.',
    mode: 'pro',
    seed: 1,
    durationMin: 0,
    wind: CALM,
    traffic: NONE,
    spawns: [student(2.5, 17, 210, 2000, 190)],
  },
  {
    id: 'tut-pattern',
    lesson: 'pattern',
    name: '6 · A whole arrival',
    blurb: 'From its first call to Tower: downwind, base, intercept.',
    mode: 'beginner',
    seed: 1,
    durationMin: 0,
    wind: CALM,
    traffic: NONE,
    // on the west downwind, abeam the runway, calling in
    spawns: [{ ...student(0, 0, 360, 6000, 240), pos: finalPt(1, 6), onFrequency: false }],
  },
  {
    id: 'tut-intercept',
    lesson: 'intercept',
    name: '7 · Joining the localizer',
    blurb: 'The 30° rule and the glideslope from below, with Professional rules.',
    mode: 'pro',
    seed: 1,
    durationMin: 0,
    wind: CALM,
    traffic: NONE,
    // east of the final, crossing it at right angles
    spawns: [{ ...student(0, 0, 270, 2000, 210), pos: finalPt(18, -6) }],
  },
  {
    id: 'tut-sequence',
    lesson: 'sequence',
    name: '8 · Two in a row',
    blurb: 'Space two arrivals on final with speed and a longer downwind.',
    mode: 'beginner',
    seed: 1,
    durationMin: 0,
    wind: CALM,
    traffic: NONE,
    spawns: [
      { ...student(0, 0, 90, 2000, 190), callsign: LESSON_LEADER, type: 'A320', pos: finalPt(14, 3.6) },
      { ...student(0, 0, 360, 3000, 220), pos: finalPt(11, 6) },
    ],
  },
  {
    id: 'tut-separation',
    lesson: 'separation',
    name: '9 · Separation',
    blurb: 'Two aircraft converging at the same level: fix it with a level or a turn.',
    mode: 'beginner',
    seed: 1,
    durationMin: 0,
    wind: CALM,
    traffic: NONE,
    // both reach (4, -8) about 3 minutes from now at FL060
    spawns: [
      student(16, -8, 270, 6000, 240),
      { ...student(4, 4, 180, 6000, 240), callsign: LESSON_TRAFFIC, type: 'A320' },
    ],
  },
  {
    id: 'tut-departure',
    lesson: 'departure',
    name: '10 · Departures',
    blurb: 'Climb a departure out and hand it to Amsterdam Radar.',
    mode: 'pro',
    seed: 1,
    durationMin: 0,
    wind: CALM,
    traffic: NONE,
    spawns: [{ at: 0, kind: 'departure', callsign: STUDENT, type: 'B738', route: 'LEKKO' }],
  },
  {
    id: 'free',
    name: 'Beginner free play',
    blurb: 'Light traffic, no penalties, hints on. Play as long as you like.',
    mode: 'beginner',
    seed: 0,
    durationMin: 0,
    traffic: { arrivalsPerHour: 12, departuresPerHour: 4, alnumCallsigns: 0, priority: 0.08 },
  },
  {
    id: 'tw-land',
    view: 'tower',
    lesson: 'twLand',
    name: '1 · Landing clearance',
    blurb: 'You are Schiphol Tower. An arrival calls on final: clear it to land.',
    mode: 'beginner',
    seed: 1,
    durationMin: 0,
    wind: LESSON_WIND,
    traffic: NONE,
    spawns: [onFinal(STUDENT, 6)],
  },
  {
    id: 'tw-depart',
    view: 'tower',
    lesson: 'twDepart',
    name: '2 · Line up and take-off',
    blurb: 'A departure is ready at the holding point: line it up, then clear it for take-off.',
    mode: 'beginner',
    seed: 1,
    durationMin: 0,
    wind: LESSON_WIND,
    traffic: NONE,
    spawns: [atHoldingPoint(STUDENT)],
  },
  {
    id: 'tw-vacate',
    view: 'tower',
    lesson: 'twVacate',
    name: '3 · Vacate and handoffs',
    blurb: 'Professional rules: tell the arrival where to leave the runway and pass both aircraft on.',
    mode: 'pro',
    seed: 1,
    durationMin: 0,
    wind: LESSON_WIND,
    traffic: NONE,
    // the departure calls after the landing clearance and the vacate instruction, not over them
    spawns: [onFinal(STUDENT, 5), { ...atHoldingPoint(LESSON_DEPARTURE), at: 75 }],
  },
  {
    id: 'tw-goaround',
    view: 'tower',
    lesson: 'twGoAround',
    name: '4 · Go-around',
    blurb: 'Two arrivals too close together: the runway will not be free in time.',
    mode: 'beginner',
    seed: 1,
    durationMin: 0,
    wind: LESSON_WIND,
    traffic: NONE,
    // 2.6 NM apart: the follower is about 2.3 NM out at the leader's touchdown, time to read and act
    spawns: [onFinal(LESSON_LEADER, 2.7, 'A320'), onFinal(STUDENT, 5.3)],
  },
  {
    id: 'tower-free',
    view: 'tower',
    name: 'Tower · Free play',
    blurb:
      'You are Schiphol Tower: land arrivals on 18R and send them off the runway, line up and launch departures from 24. No penalties, warnings on.',
    mode: 'beginner',
    seed: 0,
    durationMin: 0,
    traffic: { arrivalsPerHour: 16, departuresPerHour: 14, types: TOWER_EASY, priority: 0.08 },
    spawns: [firstArrival('KLM1200', 'B738')],
  },
  {
    id: 'tower-pro-light',
    view: 'tower',
    name: 'Tower Pro · Light',
    blurb: '20 minutes, about 16 arrivals and 14 departures an hour, narrowbodies.',
    mode: 'pro',
    seed: 201,
    durationMin: 20,
    wind: { dir: 200, speed: 10 },
    traffic: {
      arrivalsPerHour: 16,
      departuresPerHour: 14,
      types: TOWER_EASY,
      alnumCallsigns: 0.15,
      priority: 0.08,
    },
    spawns: [firstArrival('EZY45MP', 'A320')],
  },
  {
    id: 'tower-pro-heavy',
    view: 'tower',
    name: 'Tower Pro · Heavies',
    blurb:
      '25 minutes of mixed traffic with widebodies and an A380: mind the wake turbulence between departures.',
    mode: 'pro',
    seed: 202,
    durationMin: 25,
    wind: { dir: 220, speed: 14 },
    traffic: { arrivalsPerHour: 18, departuresPerHour: 18, alnumCallsigns: 0.15, priority: 0.08 },
    spawns: [firstArrival('KLM642', 'B77W')],
  },
  {
    id: 'tower-pro-peak',
    view: 'tower',
    name: 'Tower Pro · Peak',
    blurb: '25 minutes at the busiest: about 28 arrivals and 24 departures an hour.',
    mode: 'pro',
    seed: 203,
    durationMin: 25,
    wind: { dir: 190, speed: 8 },
    traffic: { arrivalsPerHour: 28, departuresPerHour: 24, alnumCallsigns: 0.2, priority: 0.08 },
    spawns: [firstArrival('TRA5422', 'B738')],
  },
  {
    id: 'tower-pro-fog',
    view: 'tower',
    name: 'Tower Pro · Fog at dusk',
    blurb:
      '20 minutes at dusk in fog, 600 m visibility: you will hear more than you see, so use the ground radar.',
    mode: 'pro',
    seed: 204,
    durationMin: 20,
    // radiation fog: high pressure, light wind
    wind: { dir: 190, speed: 4 },
    qnh: 1027,
    visibilityM: 600,
    timeOfDay: 'dusk',
    traffic: {
      arrivalsPerHour: 14,
      departuresPerHour: 12,
      types: TOWER_EASY,
      alnumCallsigns: 0.15,
      priority: 0.08,
    },
    spawns: [firstArrival('KLM1582', 'E190')],
  },
  {
    id: 'tower-pro-cloud',
    view: 'tower',
    name: 'Tower Pro · Low cloud',
    blurb:
      '20 minutes under an overcast at 400 ft in rain: arrivals appear out of the cloud about a mile and a half out.',
    mode: 'pro',
    seed: 205,
    durationMin: 20,
    // a warm front: low stratus, rain, a fresh south-westerly
    wind: { dir: 220, speed: 16 },
    qnh: 1004,
    visibilityM: 3000,
    ceilingFt: 400,
    traffic: {
      arrivalsPerHour: 16,
      departuresPerHour: 12,
      types: TOWER_EASY,
      alnumCallsigns: 0.15,
      priority: 0.08,
    },
    spawns: [firstArrival('KLM1714', 'B738')],
  },
  {
    id: 'pro-light',
    name: 'Pro · Light morning',
    blurb: '20 minutes, about 18 arrivals an hour, calm wind.',
    mode: 'pro',
    seed: 101,
    durationMin: 20,
    wind: { dir: 190, speed: 6 },
    traffic: { arrivalsPerHour: 18, departuresPerHour: 8, alnumCallsigns: 0.15, priority: 0.08 },
  },
  {
    id: 'pro-medium',
    name: 'Pro · Midday mix',
    blurb: '25 minutes, heavies in the mix: mind the wake spacing.',
    mode: 'pro',
    seed: 202,
    durationMin: 25,
    wind: { dir: 210, speed: 14 },
    traffic: { arrivalsPerHour: 26, departuresPerHour: 12, alnumCallsigns: 0.3, priority: 0.08 },
  },
  {
    id: 'pro-peak',
    name: 'Pro · Evening arrival peak',
    blurb: '30 minutes at about 36 arrivals an hour, strong crosswind, QNH 998.',
    mode: 'pro',
    seed: 303,
    durationMin: 30,
    wind: { dir: 250, speed: 22 },
    qnh: 998,
    traffic: { arrivalsPerHour: 36, departuresPerHour: 10, alnumCallsigns: 0.35, priority: 0.08 },
  },
];

export const scenarioById = (id: string): Scenario => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[5]!;
