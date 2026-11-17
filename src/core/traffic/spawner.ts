import type { Aircraft } from '../aircraft/aircraft';
import { perfFor } from '../aircraft/perf';
import type { Airport } from '../airport/types';
import { bearing, dist, headingVec, norm360 } from '../geo';
import type { Rng } from '../rng';

export interface TrafficConfig {
  arrivalsPerHour: number;
  departuresPerHour: number;
  /** Probability (0..1) of an alphanumeric flight number such as "45MP". */
  alnumCallsigns?: number;
  /** Restrict random spawns to these aircraft types / STARs (tutorials, easy scenarios). */
  types?: string[];
  stars?: string[];
}

export interface SpawnSpec {
  kind: 'arrival' | 'departure';
  callsign?: string;
  type?: string;
  /** Arrival: STAR id. Departure: exit fix. */
  route?: string;
  /** Arrival overrides (defaults: 12 NM outside the IAF, inbound, level). */
  pos?: { x: number; y: number };
  hdg?: number;
  alt?: number;
  ias?: number;
  /** Start already on frequency and identified (tutorials). */
  onFrequency?: boolean;
}

const LETTERS = 'ABCDEFGHJKLMNPQRSTUVWXYZ';

/** A departure decided ahead of time: the tower view shows it taxiing out before it reaches the holding point. */
export interface PlannedDeparture {
  at: number;
  callsign: string;
  type: string;
  airline: string;
}

/** Departures are planned this far ahead (s): longer than any taxi-out from a stand. */
const PLAN_AHEAD_S = 600;

/**
 * Where the next departure joins the queue at the holding point: behind the last one, facing the runway
 * (shortcut: the queue runs straight back from the holding point, not along the taxiway). Null without one.
 */
export function queueTail(
  ap: Airport,
  active: readonly Aircraft[],
): { pos: { x: number; y: number }; face: number } | null {
  const hp = ap.runways.find((r) => r.id === ap.config.departure)?.entry?.path;
  if (!hp || hp.length < 2) return null;
  const hold = hp[hp.length - 1]!;
  const face = bearing(hold, hp[hp.length - 2]!);
  const slots = active
    .filter((a) => a.nav.mode === 'holding' || (a.nav.mode === 'taxi' && a.nav.then === 'hold'))
    .map((a) => Math.round((dist(a.pos, hold) * 1852) / 70));
  const back = headingVec(face + 180, ((slots.length ? Math.max(...slots) + 1 : 0) * 70) / 1852);
  return { pos: { x: hold.x + back.x, y: hold.y + back.y }, face };
}

export class Spawner {
  private nextId = 1;
  private nextArrival: number;
  private firstDeparture: number;
  private planned: PlannedDeparture[] = [];
  private lastOnStar: Record<string, number> = {};

  constructor(
    private ap: Airport,
    private rng: Rng,
    public config: TrafficConfig,
  ) {
    this.nextArrival = config.arrivalsPerHour > 0 ? rng.range(2, 15) : Infinity;
    this.firstDeparture = config.departuresPerHour > 0 ? rng.range(40, 120) : Infinity;
  }

  /** Random spawns that are due at `time`. `arrivals: false`: the caller feeds arrivals itself (tower mode). */
  due(time: number, active: readonly Aircraft[], arrivals = true): Aircraft[] {
    const out: Aircraft[] = [];
    if (arrivals && time >= this.nextArrival) {
      const stars = this.ap.stars.filter(
        (s) =>
          (!this.config.stars || this.config.stars.includes(s.id)) &&
          time - (this.lastOnStar[s.id] ?? -Infinity) >= 100,
      );
      if (stars.length) {
        const star = this.rng.pick(stars);
        this.lastOnStar[star.id] = time;
        out.push(this.create({ kind: 'arrival', route: star.id }, time, [...active, ...out]));
        this.nextArrival = time + this.gap(this.config.arrivalsPerHour, 50);
      }
    }
    this.plan(time, active);
    if (this.planned.length && time >= this.planned[0]!.at) {
      const p = this.planned.shift()!;
      out.push(
        this.create({ kind: 'departure', callsign: p.callsign, type: p.type }, time, [...active, ...out]),
      );
    }
    return out;
  }

  /** Departures planned for the next few minutes, earliest first. */
  plannedDepartures(): readonly PlannedDeparture[] {
    return this.planned;
  }

  private plan(time: number, active: readonly Aircraft[]) {
    const rate = this.config.departuresPerHour;
    if (rate <= 0) {
      this.planned = [];
      return;
    }
    for (;;) {
      const last = this.planned[this.planned.length - 1];
      if (last && last.at >= time + PLAN_AHEAD_S) return;
      // the first one keeps its random start; the gap counts from the planned time, as it did from the spawn
      const at = last
        ? last.at + this.gap(rate, 110)
        : Number.isFinite(this.firstDeparture)
          ? Math.max(this.firstDeparture, time)
          : time + this.gap(rate, 110);
      this.firstDeparture = Infinity;
      this.planned.push({ at, ...this.callsign([...active, ...this.planned]) });
    }
  }

  gap(perHour: number, min: number): number {
    const mean = 3600 / perHour;
    return Math.max(min, Math.min(mean * 2.5, -Math.log(1 - this.rng.next()) * mean));
  }

  private callsign(active: readonly { callsign: string }[]): {
    airline: string;
    callsign: string;
    type: string;
  } {
    for (;;) {
      const al = this.rng.weighted(this.ap.airlines);
      const types = al.types.filter((t) => !this.config.types || this.config.types.includes(t));
      if (!types.length) continue;
      const r = this.rng;
      const num =
        r.next() < (this.config.alnumCallsigns ?? 0)
          ? `${r.int(1, 99)}${r.pick([...LETTERS])}${r.next() < 0.6 ? r.pick([...LETTERS]) : ''}`
          : String(r.next() < 0.3 ? r.int(100, 999) : r.int(1000, 9999));
      // Unique flight numbers across airlines keep spoken callsigns easy to tell apart.
      if (active.some((a) => a.callsign.slice(3) === num)) continue;
      return { airline: al.icao, callsign: al.icao + num, type: r.pick(types) };
    }
  }

  create(spec: SpawnSpec, time: number, active: readonly Aircraft[]): Aircraft {
    const ap = this.ap;
    const gen = this.callsign(active);
    const callsign = spec.callsign ?? gen.callsign;
    const type = spec.type ?? gen.type;
    const perf = perfFor(type);
    const base = {
      id: this.nextId++,
      callsign,
      airline: callsign.slice(0, 3),
      type,
      perf,
      vs: 0,
      turn: undefined,
      tgtIas: null,
      ilsArmed: null,
      locEstablished: false,
      gsEstablished: false,
      qnhGiven: false,
      spawnTime: time,
      entered: false,
      trail: [],
      stableChecked: false,
      landClear: false,
      takeoffClear: false,
      identified: !!spec.onFrequency,
      comms: spec.onFrequency ? ('app' as const) : ('none' as const),
    };
    if (spec.kind === 'departure') {
      const rwy = ap.runways.find((r) => r.id === ap.config.departure)!;
      const route = spec.route ?? this.rng.pick(ap.departures.exits);
      const slot = queueTail(ap, active);
      if (slot) {
        const { pos, face } = slot;
        return {
          ...base,
          kind: 'departure',
          pos,
          alt: rwy.elevationFt,
          hdg: face,
          track: face,
          ias: 0,
          gs: 0,
          tgtAlt: ap.departures.initialClimbFt,
          tgtHdg: rwy.heading,
          nav: { mode: 'holding' },
          phase: 'holding',
          route,
          checkInAt: spec.onFrequency ? null : time,
        };
      }
      return {
        ...base,
        kind: 'departure',
        pos: { ...rwy.pos },
        alt: rwy.elevationFt,
        hdg: rwy.heading,
        track: rwy.heading,
        ias: 0,
        gs: 0,
        tgtAlt: ap.departures.initialClimbFt,
        tgtHdg: rwy.heading,
        nav: { mode: 'takeoff' },
        phase: 'takeoff',
        route,
        checkInAt: spec.onFrequency ? null : time,
      };
    }
    const star = ap.stars.find((s) => s.id === spec.route) ?? this.rng.pick(ap.stars);
    const iaf = ap.fixes[star.iaf]!;
    const via = ap.fixes[this.rng.pick(star.via)]!;
    const out = headingVec(bearing(iaf, via), 12);
    const pos = spec.pos ? { ...spec.pos } : { x: iaf.x + out.x, y: iaf.y + out.y };
    const hdg = spec.hdg ?? norm360(bearing(pos, iaf));
    const alt = spec.alt ?? this.rng.int(7, 10) * 1000;
    const ias = spec.ias ?? Math.min(250, perf.maxIas);
    return {
      ...base,
      kind: 'arrival',
      pos,
      alt,
      hdg,
      track: hdg,
      ias,
      gs: ias,
      tgtAlt: alt,
      tgtHdg: hdg,
      // An explicit heading means "on vectors"; otherwise fly the STAR to the IAF.
      nav: spec.hdg !== undefined ? { mode: 'heading' } : { mode: 'direct', fix: star.iaf, then: [] },
      phase: 'flight',
      route: star.id,
      checkInAt: spec.onFrequency ? null : time + this.rng.range(4, 12),
    };
  }
}
