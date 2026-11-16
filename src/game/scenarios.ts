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
const TOWER_TYPES = ['B738', 'A320', 'E190', 'A332', 'B738', 'A321', 'B77W', 'A20N', 'B789', 'E195'];
const TOWER_AIRLINES = ['KLM', 'EZY', 'KLM', 'KLM', 'TRA', 'BAW', 'KLM', 'DLH', 'TFL', 'KLM'];
/** A steady stream of arrivals already lined up on the final, one every 2.5 minutes. */
const towerArrivals = (count: number): (SpawnSpec & { at: number })[] =>
  Array.from({ length: count }, (_, i) => {
    const out = headingVec(FINAL.heading + 180, i === 0 ? 5 : 13);
    return {
      at: i === 0 ? 0 : 20 + (i - 1) * 150,
      kind: 'arrival' as const,
      callsign: `${TOWER_AIRLINES[i % 10]}${1200 + ((i * 137) % 700)}`,
      type: TOWER_TYPES[i % 10],
      pos: { x: FINAL.pos.x + out.x, y: FINAL.pos.y + out.y },
      hdg: FINAL.heading,
      alt: i === 0 ? 1500 : 3000,
      ias: i === 0 ? 170 : 190,
      onFrequency: true,
    };
  });

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
    id: 'tower-preview',
    view: 'tower',
    name: 'Tower (preview)',
    blurb:
      'You are Schiphol Tower: clear arrivals to land on 18R and send them off the runway, line up and launch departures from 24.',
    mode: 'beginner',
    seed: 7,
    durationMin: 0,
    traffic: { arrivalsPerHour: 0, departuresPerHour: 14 },
    spawns: towerArrivals(40),
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
