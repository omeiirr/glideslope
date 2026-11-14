import { stepAircraft, type Aircraft, type Env } from './aircraft/aircraft';
import { runwayById } from './airport/load';
import type { Airport } from './airport/types';
import { applyCommand, validateCommand } from './commands/apply';
import type { Command, CommandResult } from './commands/commands';
import { unproject } from './geo';
import { Rng } from './rng';
import { detectConflicts, type Conflict } from './rules/separation';
import { Spawner, type SpawnSpec, type TrafficConfig } from './traffic/spawner';

/** Fixed simulation time step, seconds. */
export const TICK = 0.5;

export interface SimOptions {
  seed: number;
  traffic: TrafficConfig;
  strictIls?: boolean;
  wind?: { dir: number; speed: number };
  qnh?: number;
}

export type SimEvent =
  | { type: 'spawned'; ac: Aircraft }
  | { type: 'checkIn'; ac: Aircraft }
  | { type: 'established'; ac: Aircraft }
  | { type: 'landed'; ac: Aircraft; handedOff: boolean }
  | { type: 'goAround'; ac: Aircraft; reason: 'unstable' | 'commanded' }
  | { type: 'leftAirspace'; ac: Aircraft; handedOff: boolean }
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
    };
    this.spawner = new Spawner(airport, this.rng, opts.traffic);
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
    this.list.push(ac);
    return ac;
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
    for (const ac of this.spawner.due(this.time, this.list)) {
      this.list.push(ac);
      events.push({ type: 'spawned', ac });
    }
    const sample = this.tickCount % 8 === 0;
    const remove = new Set<Aircraft>();
    for (const ac of this.list) {
      if (sample) {
        ac.trail.unshift({ ...ac.pos });
        if (ac.trail.length > 6) ac.trail.pop();
      }
      for (const e of stepAircraft(ac, TICK, this.env)) {
        if (e.type === 'gone') remove.add(ac);
        else if (e.type === 'landed') {
          remove.add(ac);
          events.push({ type: 'landed', ac, handedOff: ac.comms === 'tower' });
        } else if (e.type === 'leftAirspace') {
          remove.add(ac);
          events.push({ type: 'leftAirspace', ac, handedOff: ac.comms === 'radar' });
        } else events.push({ ...e, ac } as SimEvent);
      }
    }
    if (remove.size) this.list = this.list.filter((a) => !remove.has(a));
    if (this.tickCount % 2 === 0) {
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
