import {
  clearTakeoff,
  isOnGround,
  type GoAroundReason,
  lineUp,
  runwayFrame,
  startGoAround,
  stepAircraft,
  type Aircraft,
  type Env,
} from './aircraft/aircraft';
import { reciprocalRunway, runwayById } from './airport/load';
import type { Airport } from './airport/types';
import { applyCommand, conditionMet, validateCommand } from './commands/apply';
import type { Command, CommandResult } from './commands/commands';
import { bearing, dist, headingVec, unproject } from './geo';
import { Rng } from './rng';
import { detectConflicts, type Conflict } from './rules/separation';
import { FEED_KT, FEED_NM, SLOW_NM, departureWakeS, feedGap } from './rules/tower';
import {
  Spawner,
  queueTail,
  type PlannedDeparture,
  type SpawnSpec,
  type TrafficConfig,
} from './traffic/spawner';

/** Fixed simulation time step, seconds. */
export const TICK = 0.5;

export interface SimOptions {
  seed: number;
  traffic: TrafficConfig;
  strictIls?: boolean;
  wind?: { dir: number; speed: number };
  qnh?: number;
  /** Line up and launch departures automatically when the runway is free (default on, off in tower mode). */
  autoTower?: boolean;
  /**
   * Tower mode: the player is Tower. A stand-in Approach clears arrivals for the ILS and hands them over at 8 NM;
   * departures call from the holding point; arrivals need a landing clearance.
   */
  tower?: boolean;
}

/** Stand-in Approach hands arrivals to Tower at this distance from the threshold (NM). */
const TOWER_HANDOVER_NM = 8;
/** Departures wait this long at the holding point before calling Tower (seconds). */
const READY_CALL_S = 5;
/** Queue spacing at the holding point, metres (same as the spawner's). */
const QUEUE_M = 70;

/** Tower mode: a go-around comes back onto the final this long after the stand-in Approach takes it (seconds). */
const REFEED_S = 240;
/** Tower mode: departures leave the scene this far out (NM), handed off or not. */
const DEPARTED_NM = 8;

/** A departure waits at least this long at the holding point (seconds), and this long lined up. */
const HOLD_MIN_S = 20;
const LINEUP_WAIT_S = 8;

export type SimEvent =
  | { type: 'spawned'; ac: Aircraft }
  | { type: 'checkIn'; ac: Aircraft }
  | { type: 'established'; ac: Aircraft }
  /** Touchdown (scored here). The aircraft stays on the runway until `vacated`. */
  | { type: 'landed'; ac: Aircraft; handedOff: boolean }
  /** Reached the holding position on its exit; removed. */
  | { type: 'vacated'; ac: Aircraft }
  | { type: 'goAround'; ac: Aircraft; reason: GoAroundReason }
  | { type: 'leftAirspace'; ac: Aircraft; handedOff: boolean }
  /** Tower mode: off the scene (a go-around taken by the stand-in Approach, or a departure 8 NM out). */
  | { type: 'removed'; ac: Aircraft }
  /** Tower mode: a landing or take-off with another aircraft on the runway. */
  | { type: 'incursion'; ac: Aircraft; other: Aircraft; what: 'landing' | 'takeoff' }
  /** Tower mode: take-off roll started, `waited` seconds after the ready call. */
  | { type: 'takeoff'; ac: Aircraft; waited: number }
  /** Tower mode: lift-off closer behind a heavier departure than the wake minimum (seconds). */
  | { type: 'wakeDeparture'; a: Aircraft; b: Aircraft; gap: number; required: number }
  | { type: 'conflict'; kind: 'loss' | 'wake'; a: Aircraft; b: Aircraft };

export class Sim {
  time = 0;
  readonly rng: Rng;
  readonly env: Env;
  readonly qnh: number;
  private list: Aircraft[] = [];
  private spawner: Spawner;
  private active = new Set<string>();
  private tickCount = 0;
  private _conflicts: Conflict[] = [];
  private autoTower: boolean;
  readonly tower: boolean;
  /** Tower mode feed: next random arrival, the one held back for spacing, go-arounds to bring back. */
  private nextArrival = Infinity;
  private waiting: Aircraft | null = null;
  private refeed: { at: number; ac: Aircraft }[] = [];
  private lastLiftoff: { ac: Aircraft; time: number } | null = null;

  constructor(
    readonly airport: Airport,
    opts: SimOptions,
  ) {
    this.rng = new Rng(opts.seed);
    this.qnh = opts.qnh ?? airport.qnh;
    this.env = {
      airport,
      landing: runwayById(airport, airport.config.landing),
      departure: runwayById(airport, airport.config.departure),
      wind: opts.wind ?? airport.wind,
      strictIls: !!opts.strictIls,
      time: 0,
      tower: !!opts.tower,
      traffic: () => this.list,
    };
    this.spawner = new Spawner(airport, this.rng, opts.traffic);
    this.tower = !!opts.tower;
    this.autoTower = opts.autoTower ?? !this.tower;
    if (this.tower && opts.traffic.arrivalsPerHour > 0) this.nextArrival = 30;
  }

  /**
   * Aircraft occupying a runway (either direction of it): from line-up or touchdown until vacated, and departures
   * until airborne past the far end.
   */
  runwayOccupants(id: string): readonly Readonly<Aircraft>[] {
    const rwy = runwayById(this.airport, id);
    const opp = reciprocalRunway(this.airport, rwy);
    const lengthNm = opp ? dist(rwy.pos, opp.pos) : rwy.lengthFt / 6076;
    const ids = new Set([id, opp?.id]);
    return this.list.filter((ac) => {
      const m = ac.nav.mode;
      const mine =
        (ac.kind === 'arrival' && ids.has(this.env.landing.id)) ||
        (ac.kind === 'departure' && ids.has(this.env.departure.id));
      if (!mine) return false;
      if (m === 'rollout' || m === 'lineup' || m === 'takeoff') return true;
      if (m === 'taxi') return ac.nav.then !== 'hold'; // vacating, or cleared to line up and already moving
      // departure airborne but not yet past the far end
      return (
        ac.kind === 'departure' &&
        !isOnGround(ac) &&
        runwayFrame(ac.pos, rwy).along > -lengthNm &&
        ac.alt < rwy.elevationFt + 1500
      );
    });
  }

  /** Stand-in tower until the player controls the runway (T3): one departure at a time, runway free, no arrival close in. */
  private runTower() {
    const dep = this.env.departure;
    const busy = this.runwayOccupants(dep.id);
    const landingSoon = this.list.some(
      (a) => a.nav.mode === 'loc' && this.env.landing.id === dep.id && runwayFrame(a.pos, dep).along < 2,
    );
    const lined = this.list.find((a) => a.nav.mode === 'lineup');
    if (lined && lined.nav.mode === 'lineup' && lined.nav.ready && lined.nav.timer >= LINEUP_WAIT_S) {
      if (busy.every((a) => a === lined) && !landingSoon) clearTakeoff(lined);
      return;
    }
    if (busy.length || landingSoon) return;
    const next = this.list
      .filter((a) => a.nav.mode === 'holding' && this.time - a.spawnTime >= HOLD_MIN_S)
      .sort((a, b) => a.spawnTime - b.spawnTime)[0];
    if (next) lineUp(next, dep);
  }

  /** Departures queued at the holding point, front first. */
  private queue(): Aircraft[] {
    const hp = this.env.departure.entry?.path;
    if (!hp) return [];
    const hold = hp[hp.length - 1]!;
    return this.list
      .filter((a) => a.nav.mode === 'holding' || (a.nav.mode === 'taxi' && a.nav.then === 'hold'))
      .sort((a, b) => dist(a.pos, hold) - dist(b.pos, hold));
  }

  /** The queue moves up when the front aircraft lines up. */
  private moveQueue() {
    const hp = this.env.departure.entry?.path;
    if (!hp || hp.length < 2) return;
    const hold = hp[hp.length - 1]!;
    const back = bearing(hp[hp.length - 2]!, hold);
    this.queue().forEach((ac, slot) => {
      if (ac.nav.mode !== 'holding') return;
      const v = headingVec(back, (slot * QUEUE_M) / 1852);
      const target = { x: hold.x + v.x, y: hold.y + v.y };
      if (dist(ac.pos, target) * 1852 > 20) ac.nav = { mode: 'taxi', path: [target], i: 0, then: 'hold' };
    });
  }

  /** Tower mode: the stand-in Approach and the pilots' calls to Tower. */
  private runTowerMode(events: SimEvent[]) {
    const landing = this.env.landing;
    for (const ac of this.list) {
      if (ac.lineUpBehind === undefined) continue;
      if (!conditionMet(this.list.find((a) => a.id === ac.lineUpBehind))) continue;
      ac.lineUpBehind = undefined;
      if (ac.nav.mode === 'holding' || (ac.nav.mode === 'taxi' && ac.nav.then === 'hold'))
        lineUp(ac, this.env.departure);
    }
    for (const ac of this.list) {
      if (ac.kind !== 'arrival' || ac.comms === 'tower' || ac.comms === 'ground' || isOnGround(ac)) continue;
      if (ac.phase === 'goaround') continue;
      if (!ac.ilsArmed && ac.nav.mode !== 'loc') ac.ilsArmed = landing.id;
      if (ac.nav.mode === 'loc' && runwayFrame(ac.pos, landing).along < TOWER_HANDOVER_NM) {
        ac.comms = 'tower';
        ac.identified = true;
        events.push({ type: 'checkIn', ac });
      }
    }
    const front = this.queue()[0];
    if (
      front &&
      front.nav.mode === 'holding' &&
      front.comms === 'none' &&
      this.time - front.spawnTime >= READY_CALL_S
    ) {
      front.comms = 'tower';
      front.readyAt = this.time;
      front.identified = true;
      events.push({ type: 'checkIn', ac: front });
    }
  }

  /**
   * Tower mode: the stand-in Approach puts arrivals onto the final at FEED_NM, each one held back until it has
   * the spacing `feedGap` asks for behind the previous one.
   */
  private feed(events: SimEvent[]) {
    const landing = this.env.landing;
    if (!this.waiting) {
      const taken = [...this.list, ...this.refeed.map((r) => r.ac)];
      const back = headingVec(landing.heading + 180, FEED_NM);
      const spec: SpawnSpec = {
        kind: 'arrival',
        pos: { x: landing.pos.x + back.x, y: landing.pos.y + back.y },
        hdg: landing.heading,
        alt: 3000,
        ias: FEED_KT,
        onFrequency: true,
      };
      const i = this.refeed.findIndex((r) => r.at <= this.time);
      if (i >= 0) {
        const { ac } = this.refeed.splice(i, 1)[0]!;
        this.waiting = this.spawner.create(
          { ...spec, callsign: ac.callsign, type: ac.type },
          this.time,
          taken,
        );
      } else if (this.time >= this.nextArrival) {
        this.waiting = this.spawner.create(spec, this.time, taken);
        this.nextArrival = this.time + this.spawner.gap(this.spawner.config.arrivalsPerHour, 60);
      }
    }
    const w = this.waiting;
    if (!w) return;
    let last: Aircraft | undefined;
    let lastAlong = -Infinity;
    for (const a of this.list) {
      if (a.kind !== 'arrival' || isOnGround(a) || a.phase === 'goaround') continue;
      const along = runwayFrame(a.pos, landing).along;
      // beyond the feed point (turned back out by Tower) it is not ahead in the stream
      if (along > 0 && along <= FEED_NM && along > lastAlong) [last, lastAlong] = [a, along];
    }
    if (last && FEED_NM - lastAlong < feedGap(last.perf, w.perf)) return;
    w.spawnTime = this.time;
    // "160 knots until 4 miles final": the same speed for everyone keeps the spacing until then
    w.tgtIas = FEED_KT;
    w.speedUntilDme = SLOW_NM;
    this.add(w);
    events.push({ type: 'spawned', ac: w });
    this.waiting = null;
  }

  /** Tower mode, per aircraft after its step: runway safety, take-off events, wake, leaving the scene. */
  private towerRules(ac: Aircraft, was: Aircraft['nav']['mode'], events: SimEvent[], remove: Set<Aircraft>) {
    const now = ac.nav.mode;
    const landing = this.env.landing;
    // a cleared arrival that finds the runway occupied goes around
    if (now === 'loc' && ac.landClear && runwayFrame(ac.pos, landing).along < 0.2) {
      const other = this.runwayOccupants(landing.id).find((o) => o !== ac);
      if (other) {
        startGoAround(ac, this.env);
        events.push({ type: 'goAround', ac, reason: 'runwayOccupied' });
        events.push({ type: 'incursion', ac, other: other as Aircraft, what: 'landing' });
      }
    }
    if (was !== 'takeoff' && now === 'takeoff') {
      const other = this.runwayOccupants(this.env.departure.id).find((o) => o !== ac);
      if (other) events.push({ type: 'incursion', ac, other: other as Aircraft, what: 'takeoff' });
      // once per departure (a rejected take-off rolls again later)
      if (ac.readyAt !== undefined) events.push({ type: 'takeoff', ac, waited: this.time - ac.readyAt });
      ac.readyAt = undefined;
    }
    if (was === 'takeoff' && !isOnGround(ac)) {
      const prev = this.lastLiftoff;
      if (prev) {
        const required = departureWakeS(prev.ac.perf.wake, ac.perf.wake);
        const gap = this.time - prev.time;
        if (gap < required) events.push({ type: 'wakeDeparture', a: prev.ac, b: ac, gap, required });
      }
      this.lastLiftoff = { ac, time: this.time };
    }
    const gone =
      (ac.kind === 'departure' && !isOnGround(ac) && dist(ac.pos, { x: 0, y: 0 }) > DEPARTED_NM) ||
      // the stand-in Approach takes a go-around once it has climbed out, and brings it back later
      (ac.phase === 'goaround' && ac.alt >= this.airport.missedApproachAltFt - 100);
    if (gone && !remove.has(ac)) {
      remove.add(ac);
      events.push({ type: 'removed', ac });
      if (ac.kind === 'arrival') this.refeed.push({ at: this.time + REFEED_S, ac });
    }
  }

  /** Read-only views for renderers and UI. */
  get aircraft(): readonly Readonly<Aircraft>[] {
    return this.list;
  }
  get conflicts(): readonly Conflict[] {
    return this._conflicts;
  }
  get traffic(): TrafficConfig {
    return this.spawner.config;
  }
  /** Departures planned for the next few minutes (the tower view shows them taxiing out from a stand). */
  plannedDepartures(): readonly PlannedDeparture[] {
    return this.spawner.plannedDepartures();
  }
  /** Where the next departure will join the queue at the holding point. */
  departureQueueTail() {
    return queueTail(this.airport, this.list);
  }
  byId(id: number): Readonly<Aircraft> | undefined {
    return this.list.find((a) => a.id === id);
  }
  byCallsign(cs: string): Readonly<Aircraft> | undefined {
    return this.list.find((a) => a.callsign === cs);
  }
  latLon(ac: Readonly<Aircraft>) {
    return unproject(ac.pos, this.airport.lat, this.airport.lon);
  }

  spawn(spec: SpawnSpec): Readonly<Aircraft> {
    const ac = this.spawner.create(spec, this.time, this.list);
    this.add(ac);
    return ac;
  }

  private add(ac: Aircraft) {
    // tower mode: nobody calls Approach; runTowerMode makes the calls to Tower
    if (this.tower) ac.checkInAt = null;
    this.list.push(ac);
  }

  validate(callsign: string, cmd: Command): CommandResult {
    const ac = this.list.find((a) => a.callsign === callsign);
    return ac ? validateCommand(ac, cmd, this.env) : { ok: false, reason: 'unknown callsign' };
  }

  /** Apply commands to one aircraft. ILS clearances are applied last so a heading in the same transmission doesn't cancel them. */
  command(callsign: string, commands: readonly Command[]): CommandResult[] {
    const ac = this.list.find((a) => a.callsign === callsign);
    if (!ac) return commands.map(() => ({ ok: false, reason: 'unknown callsign' }));
    const order = commands
      .map((_, i) => i)
      .sort((a, b) => +(commands[a]!.type === 'ils') - +(commands[b]!.type === 'ils'));
    const results: CommandResult[] = [];
    for (const i of order) results[i] = applyCommand(ac, commands[i]!, this.env);
    return results;
  }

  step(): SimEvent[] {
    this.time += TICK;
    this.env.time = this.time;
    this.tickCount++;
    const events: SimEvent[] = [];
    for (const ac of this.spawner.due(this.time, this.list, !this.tower)) {
      this.add(ac);
      events.push({ type: 'spawned', ac });
    }
    if (this.tower) this.feed(events);
    const sample = this.tickCount % 8 === 0;
    const remove = new Set<Aircraft>();
    for (const ac of this.list) {
      if (sample) {
        ac.trail.unshift({ ...ac.pos });
        if (ac.trail.length > 6) ac.trail.pop();
      }
      const was = ac.nav.mode;
      for (const e of stepAircraft(ac, TICK, this.env)) {
        if (e.type === 'gone') remove.add(ac);
        else if (e.type === 'landed') events.push({ type: 'landed', ac, handedOff: ac.comms === 'tower' });
        else if (e.type === 'vacated') {
          remove.add(ac);
          events.push({ type: 'vacated', ac });
        } else if (e.type === 'leftAirspace') {
          remove.add(ac);
          events.push({
            type: 'leftAirspace',
            ac,
            handedOff: ac.comms === 'radar' || ac.comms === 'departure',
          });
        } else events.push({ ...e, ac } as SimEvent);
      }
      if (this.tower) this.towerRules(ac, was, events, remove);
    }
    if (remove.size) this.list = this.list.filter((a) => !remove.has(a));
    if (this.autoTower) this.runTower();
    this.moveQueue();
    if (this.tower) this.runTowerMode(events);
    // tower mode: airborne separation is the (stand-in) Approach controller's job, not the player's
    if (this.tickCount % 2 === 0 && !this.tower) {
      this._conflicts = detectConflicts(this.list, this.env.landing);
      const now = new Set<string>();
      for (const c of this._conflicts) {
        if (c.kind === 'predicted') continue;
        const key = `${c.kind}:${c.a}:${c.b}`;
        now.add(key);
        if (!this.active.has(key))
          events.push({
            type: 'conflict',
            kind: c.kind,
            a: this.byId(c.a) as Aircraft,
            b: this.byId(c.b) as Aircraft,
          });
      }
      this.active = now;
    }
    return events;
  }

  /** Run `seconds` of sim time (tests, fast-forward). */
  run(seconds: number): SimEvent[] {
    const events: SimEvent[] = [];
    for (let i = 0; i < Math.round(seconds / TICK); i++) events.push(...this.step());
    return events;
  }
}
