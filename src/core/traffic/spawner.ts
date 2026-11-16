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

export class Spawner {
  private nextId = 1;
  private nextArrival: number;
  private nextDeparture: number;
  private lastOnStar: Record<string, number> = {};

  constructor(
    private ap: Airport,
    private rng: Rng,
    public config: TrafficConfig,
  ) {
    this.nextArrival = config.arrivalsPerHour > 0 ? rng.range(2, 15) : Infinity;
    this.nextDeparture = config.departuresPerHour > 0 ? rng.range(40, 120) : Infinity;
  }

  /** Random spawns that are due at `time`. */
  due(time: number, active: readonly Aircraft[]): Aircraft[] {
    const out: Aircraft[] = [];
    if (time >= this.nextArrival) {
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
    if (time >= this.nextDeparture) {
      out.push(this.create({ kind: 'departure' }, time, [...active, ...out]));
      this.nextDeparture = time + this.gap(this.config.departuresPerHour, 110);
    }
    return out;
  }

  private gap(perHour: number, min: number): number {
    const mean = 3600 / perHour;
    return Math.max(min, Math.min(mean * 2.5, -Math.log(1 - this.rng.next()) * mean));
  }

  private callsign(active: readonly Aircraft[]): { airline: string; callsign: string; type: string } {
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
      const hp = rwy.entry?.path;
      if (hp && hp.length > 1) {
        // at the holding point facing the runway; later arrivals queue behind (shortcut: straight back, not along the taxiway)
        const hold = hp[hp.length - 1]!;
        const face = bearing(hold, hp[hp.length - 2]!);
        // the slot behind the last one taken
        const slots = active
          .filter((a) => a.nav.mode === 'holding' || (a.nav.mode === 'taxi' && a.nav.then === 'hold'))
          .map((a) => Math.round((dist(a.pos, hold) * 1852) / 70));
        const queue = slots.length ? Math.max(...slots) + 1 : 0;
        const back = headingVec(face + 180, (queue * 70) / 1852);
        return {
          ...base,
          kind: 'departure',
          pos: { x: hold.x + back.x, y: hold.y + back.y },
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
