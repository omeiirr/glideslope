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
    id: 'free',
    name: 'Beginner free play',
    blurb: 'Light traffic, no penalties, hints on. Play as long as you like.',
    mode: 'beginner',
    seed: 0,
    durationMin: 0,
    traffic: { arrivalsPerHour: 12, departuresPerHour: 4, alnumCallsigns: 0 },
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
    traffic: { arrivalsPerHour: 16, departuresPerHour: 14, types: TOWER_EASY },
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
    traffic: { arrivalsPerHour: 16, departuresPerHour: 14, types: TOWER_EASY, alnumCallsigns: 0.15 },
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
    traffic: { arrivalsPerHour: 18, departuresPerHour: 18, alnumCallsigns: 0.15 },
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
    traffic: { arrivalsPerHour: 28, departuresPerHour: 24, alnumCallsigns: 0.2 },
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
    traffic: { arrivalsPerHour: 14, departuresPerHour: 12, types: TOWER_EASY, alnumCallsigns: 0.15 },
    spawns: [firstArrival('KLM1582', 'E190')],
  },
  {
    id: 'pro-light',
    name: 'Pro · Light morning',
    blurb: '20 minutes, about 18 arrivals an hour, calm wind.',
    mode: 'pro',
    seed: 101,
    durationMin: 20,
    wind: { dir: 190, speed: 6 },
    traffic: { arrivalsPerHour: 18, departuresPerHour: 8, alnumCallsigns: 0.15 },
  },
  {
    id: 'pro-medium',
    name: 'Pro · Midday mix',
    blurb: '25 minutes, heavies in the mix: mind the wake spacing.',
    mode: 'pro',
    seed: 202,
    durationMin: 25,
    wind: { dir: 210, speed: 14 },
    traffic: { arrivalsPerHour: 26, departuresPerHour: 12, alnumCallsigns: 0.3 },
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
    traffic: { arrivalsPerHour: 36, departuresPerHour: 10, alnumCallsigns: 0.35 },
  },
];

export const scenarioById = (id: string): Scenario => SCENARIOS.find((s) => s.id === id) ?? SCENARIOS[5]!;
