import { EHAM, Rng, Sim, TICK, dist, runwayFrame, type Aircraft, type Command, type SimEvent } from '../core';
import {
  parse,
  type AcContext,
  type Issue,
  type ParseContext,
  type ParseResult,
} from '../phraseology/parser';
import {
  canonicalTransmission,
  checkIn,
  chip,
  readback,
  towerCheckIn,
  type Phrase,
} from '../phraseology/phrases';
import { corruptReadback } from '../phraseology/readbackError';
import { spokenCallsign } from '../phraseology/callsign';
import { Frequency, type Transmission } from '../radio/frequency';
import type { Scenario } from './scenarios';
import { emptyStats, phraseScore, totalScore, type Stats } from './scoring';
import type { Settings } from './settings';
import { LESSONS, type Lesson } from './tutorials';

export type LogEntry =
  | {
      kind: 'you';
      id: number;
      time: number;
      text: string;
      callsign: string | null;
      chips: string[];
      issues: Issue[];
      understood: boolean;
      confidence: number;
      /** Canonical ICAO wording, shown when the phrasing was non-standard. */
      expected?: string;
      score: number;
    }
  | {
      kind: 'pilot';
      id: number;
      time: number;
      callsign: string;
      text: string;
      speech: string;
      /** Readback state. 'hidden' errors look like a normal readback until caught or revealed in the debrief. */
      rb?: 'ok' | 'hidden' | 'caught' | 'missed';
      detail?: string;
    }
  | { kind: 'system'; id: number; time: number; text: string; tone: 'info' | 'good' | 'warn' | 'bad' };

interface PendingError {
  entryId: number;
  callsign: string;
  correct: Command[];
  index: number;
  /** Sim time after which the error counts as uncaught. */
  deadline: number;
}

const START_UTC = 14 * 3600;
const LESSON_END_PAUSE_MS = 1500;

/** One game: the sim, the radio, the log and the score. The UI reads it and calls its methods. */
export class Session {
  readonly sim: Sim;
  /** The player is Schiphol Tower (tower scenarios), else Schiphol Approach. */
  readonly tower: boolean;
  /** The player's frequency, as aircraft comms. */
  readonly mine: Aircraft['comms'];
  readonly radio = new Frequency();
  readonly mode: 'beginner' | 'pro';
  readonly lesson?: Lesson;
  stats: Stats = emptyStats();
  log: LogEntry[] = [];
  selectedId: number | null = null;
  /** Aircraft whose callsign was just recognised from speech (scope highlight). */
  heardId: number | null = null;
  paused = false;
  speed = 1;
  finished = false;
  lessonStep = 0;
  /** Bumps on every change the panels should re-render for. */
  version = 0;
  private acc = 0;
  /** Real time (ms) since the frequency went quiet after the last lesson step. */
  private quietSince: number | null = null;
  private nextEntry = 1;
  private rng: Rng;
  private pendingErrors: PendingError[] = [];
  private lastSaid = new Map<string, Phrase>();
  private contacted = new Set<string>();
  private spawnsLeft: NonNullable<Scenario['spawns']>;
  private requested = new Set<number>();
  private listeners = new Set<() => void>();

  constructor(
    readonly scenario: Scenario,
    public settings: Settings,
  ) {
    this.mode = scenario.mode;
    this.tower = scenario.view === 'tower';
    this.mine = this.tower ? 'tower' : 'app';
    const seed = scenario.seed || Date.now() & 0xffff;
    this.sim = new Sim(EHAM, {
      seed,
      traffic: scenario.traffic,
      strictIls: this.mode === 'pro',
      wind: scenario.wind,
      qnh: scenario.qnh,
      tower: this.tower,
    });
    this.rng = new Rng(seed ^ 0x5eed);
    this.radio.blocking = this.mode === 'pro';
    this.spawnsLeft = [...(scenario.spawns ?? [])].sort((a, b) => a.at - b.at);
    this.lesson = scenario.lesson ? LESSONS[scenario.lesson] : undefined;
    this.spawnDue();
    if (this.lesson) this.selectedId = this.sim.aircraft[0]?.id ?? null;
  }

  // ------------------------------------------------------------ plumbing

  subscribe(fn: () => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
  private changed() {
    this.version++;
    for (const fn of this.listeners) fn();
  }
  get clock(): string {
    const t = Math.floor(START_UTC + this.sim.time);
    const p = (n: number) => String(n).padStart(2, '0');
    return `${p(Math.floor(t / 3600) % 24)}:${p(Math.floor(t / 60) % 60)}:${p(t % 60)}`;
  }
  get score(): number {
    return totalScore(this.stats, this.mode);
  }
  get remainingSec(): number | null {
    return this.scenario.durationMin ? Math.max(0, this.scenario.durationMin * 60 - this.sim.time) : null;
  }
  /** The player's station: name and frequency. */
  get station() {
    return this.tower ? EHAM.frequencies.tower : EHAM.frequencies.approach;
  }
  get selected(): Readonly<Aircraft> | undefined {
    return this.selectedId === null ? undefined : this.sim.byId(this.selectedId);
  }
  select(id: number | null) {
    this.selectedId = id;
    this.changed();
  }
  setPaused(p: boolean) {
    this.paused = p;
    this.changed();
  }
  setSpeed(s: number) {
    this.speed = s;
    this.changed();
  }
  /** The player has spoken to this aircraft at least once. */
  wasContacted(callsign: string): boolean {
    return this.contacted.has(callsign);
  }

  private add(entry: LogEntry): LogEntry {
    this.log.push(entry);
    if (this.log.length > 300) this.log.shift();
    this.changed();
    return entry;
  }
  private system(text: string, tone: 'info' | 'good' | 'warn' | 'bad' = 'info') {
    this.add({ kind: 'system', id: this.nextEntry++, time: this.sim.time, text, tone });
  }

  // ------------------------------------------------------------ main loop

  private lastFrame: number | null = null;
  /**
   * Advance to an animation-frame timestamp. Every view calls this from its own frame loop;
   * only the first call in a frame moves time, so two views never run the sim at double speed.
   */
  frame(now: number) {
    const dt = this.lastFrame === null ? 0 : now - this.lastFrame;
    this.lastFrame = now;
    if (dt > 0) this.update(dt);
  }

  /** Advance by real elapsed milliseconds. */
  update(realMs: number) {
    this.radio.update();
    if (this.paused || this.finished) return;
    this.acc += (Math.min(realMs, 250) / 1000) * this.speed;
    let steps = 0;
    while (this.acc >= TICK && steps++ < 64) {
      this.acc -= TICK;
      this.spawnDue();
      for (const e of this.sim.step()) this.onEvent(e);
      if (Math.round(this.sim.time / TICK) % 4 === 0) this.housekeeping();
    }
    if (steps) this.changed();
  }

  /** Fraction of a tick elapsed since the last step, for smooth rendering. */
  get tickFraction(): number {
    return this.paused ? 0 : this.acc / TICK;
  }

  private spawnDue() {
    while (this.spawnsLeft.length && this.spawnsLeft[0]!.at <= this.sim.time) {
      const { at: _at, ...spec } = this.spawnsLeft.shift()!;
      const ac = this.sim.spawn(spec);
      // tower mode: aircraft "on frequency" are with the stand-in Approach, and call Tower themselves
      if (spec.onFrequency && !this.tower) this.contacted.add(ac.callsign);
    }
  }

  private housekeeping() {
    const sim = this.sim;
    // Uncaught readback errors
    for (const p of this.pendingErrors.filter((x) => sim.time > x.deadline)) {
      this.pendingErrors = this.pendingErrors.filter((x) => x !== p);
      const entry = this.log.find((e) => e.id === p.entryId);
      if (entry?.kind === 'pilot') entry.rb = 'missed';
    }
    for (const ac of sim.aircraft) {
      // tower mode: aircraft with Approach are the stand-in Approach's (in the sim)
      if (ac.comms !== 'app' || this.tower) continue;
      if (this.mode === 'beginner') {
        // Beginner: handoffs happen automatically.
        if (ac.kind === 'arrival' && ac.locEstablished && runwayFrame(ac.pos, sim.env.landing).along < 8) {
          sim.command(ac.callsign, [{ type: 'handoff', to: 'tower' }]);
          this.system(`${ac.callsign} handed to Tower automatically (Beginner).`, 'good');
        } else if (ac.kind === 'departure' && ac.alt >= 5500) {
          sim.command(ac.callsign, [{ type: 'handoff', to: 'radar' }]);
          this.system(`${ac.callsign} handed to Amsterdam Radar automatically (Beginner).`, 'good');
        }
      } else if (
        // Pro: a pilot kept high close in asks for descent, once.
        ac.kind === 'arrival' &&
        !this.requested.has(ac.id) &&
        ac.alt >= 6000 &&
        ac.tgtAlt >= 6000 &&
        ac.nav.mode !== 'hold' &&
        dist(ac.pos, { x: 0, y: 0 }) < 18 &&
        this.rng.next() < 0.05
      ) {
        this.requested.add(ac.id);
        this.pilotSays(
          ac.callsign,
          { text: `${ac.callsign}, request descent`, speech: `${this.spoken(ac.callsign)}, request descent` },
          0,
        );
      }
    }
    if (
      this.lesson &&
      this.lessonStep < this.lesson.steps.length &&
      this.lesson.steps[this.lessonStep]!.done(this)
    ) {
      this.lessonStep++;
      this.changed();
    }
    // Lesson complete: let the last readback play out, then a short pause, before the debrief.
    if (this.lesson && this.lessonStep >= this.lesson.steps.length) {
      const now = performance.now();
      if (this.radio.current || this.radio.waiting) this.quietSince = null;
      else if (this.quietSince === null) this.quietSince = now;
      else if (now - this.quietSince >= LESSON_END_PAUSE_MS) this.finish();
    }
    const left = this.remainingSec;
    if (left !== null && left <= 0) this.finish();
  }

  finish() {
    if (this.finished) return;
    this.finished = true;
    for (const p of this.pendingErrors) {
      const entry = this.log.find((e) => e.id === p.entryId);
      if (entry?.kind === 'pilot') entry.rb = 'missed';
    }
    this.pendingErrors = [];
    this.radio.reset();
    this.changed();
  }

  private spoken(cs: string) {
    return spokenCallsign(cs, EHAM.airlines);
  }

  private onEvent(e: SimEvent) {
    const s = this.stats;
    switch (e.type) {
      case 'spawned':
        break;
      case 'checkIn':
        this.pilotSays(e.ac.callsign, this.tower ? towerCheckIn(e.ac, this.sim) : checkIn(e.ac, this.sim), 0);
        break;
      case 'established':
        if (this.mode === 'beginner')
          this.system(`${e.ac.callsign} is established on the localizer.`, 'good');
        break;
      case 'landed': {
        s.landed++;
        s.delaySum += Math.max(0, this.sim.time - e.ac.spawnTime - this.nominalTime(e.ac));
        if (!e.handedOff && this.mode === 'pro' && !this.tower) {
          s.missedHandoffs++;
          this.system(`${e.ac.callsign} landed without being handed to Tower.`, 'warn');
        } else this.system(`${e.ac.callsign} landed.`, 'good');
        break;
      }
      case 'vacated':
      case 'removed':
        this.gone(e.ac);
        break;
      case 'goAround':
        s.goArounds++;
        this.pilotSays(
          e.ac.callsign,
          { text: `Going around, ${e.ac.callsign}`, speech: `Going around, ${this.spoken(e.ac.callsign)}` },
          400,
        );
        if (e.reason === 'unstable')
          this.system(`${e.ac.callsign} went around: approach not stable.`, 'warn');
        else if (e.reason === 'noClearance')
          this.system(`${e.ac.callsign} went around: no landing clearance.`, 'bad');
        break;
      case 'leftAirspace':
        this.gone(e.ac);
        if (e.ac.kind === 'departure') {
          if (e.handedOff) s.departuresOut++;
          else {
            s.missedHandoffs++;
            this.system(`${e.ac.callsign} left your airspace without a handoff.`, 'warn');
          }
        } else {
          s.leftAirspace++;
          this.system(`${e.ac.callsign} left your airspace.`, 'bad');
        }
        break;
      case 'conflict':
        if (e.kind === 'loss') {
          s.separationLosses++;
          this.system(
            `Separation lost: ${e.a.callsign} / ${e.b.callsign}${this.mode === 'beginner' ? ' (no penalty in Beginner)' : ''}.`,
            'bad',
          );
        } else {
          s.wakeInfringements++;
          this.system(
            `Wake turbulence spacing: ${e.a.callsign} / ${e.b.callsign}${this.mode === 'beginner' ? ' (no penalty in Beginner)' : ''}.`,
            'warn',
          );
        }
        break;
    }
  }

  private gone(ac: Aircraft) {
    this.radio.drop(ac.callsign);
    if (this.selectedId === ac.id) this.selectedId = null;
    if (this.heardId === ac.id) this.heardId = null;
  }

  /** Rough unimpeded flying time from spawn to touchdown, for the delay statistic. */
  private nominalTime(ac: Aircraft): number {
    if (ac.kind !== 'arrival') return 0;
    const iaf = EHAM.fixes[EHAM.stars.find((s) => s.id === ac.route)?.iaf ?? '']!;
    if (!iaf) return 0;
    const nm = 12 + dist(iaf, this.sim.env.landing.pos) + 6;
    return (nm / 215) * 3600;
  }

  // ------------------------------------------------------------ radio

  private pilotSays(
    callsign: string,
    p: Phrase,
    delayMs: number,
    extra: {
      rb?: 'ok' | 'hidden';
      detail?: string;
      onStart?: () => void;
      onLogged?: (id: number) => void;
    } = {},
  ) {
    const t: Transmission = {
      from: callsign,
      text: p.text,
      speech: p.speech,
      onStart: () => {
        extra.onStart?.();
        this.lastSaid.set(callsign, p);
        const entry = this.add({
          kind: 'pilot',
          id: this.nextEntry++,
          time: this.sim.time,
          callsign,
          text: p.text,
          speech: p.speech,
          rb: extra.rb,
          detail: extra.detail,
        });
        extra.onLogged?.(entry.id);
      },
      onEnd: (blocked) => {
        if (blocked) this.system(`You talked over ${callsign}: transmission blocked.`, 'warn');
        this.changed();
      },
    };
    this.radio.enqueue(t, delayMs);
  }

  parseContext(defaultToSelected: boolean): ParseContext {
    const aircraft: AcContext[] = this.sim.aircraft
      .filter((a) => a.comms === this.mine)
      .map((a) => ({ callsign: a.callsign, alt: a.alt, hdg: a.hdg, ias: a.ias, qnhGiven: a.qnhGiven }));
    const sel = this.selected;
    return {
      airport: EHAM,
      qnh: this.sim.qnh,
      aircraft,
      defaultCallsign: defaultToSelected && sel?.comms === this.mine ? sel.callsign : undefined,
      role: this.tower ? 'tower' : 'approach',
      wind: this.sim.env.wind,
    };
  }

  /** Live transcript while the player is still talking: highlight the aircraft as soon as its callsign is clear. */
  hear(partial: string): ParseResult {
    const r = parse(partial, this.parseContext(false));
    const id = r.callsign ? (this.sim.byCallsign(r.callsign)?.id ?? null) : null;
    if (id !== this.heardId) {
      this.heardId = id;
      this.changed();
    }
    return r;
  }

  /** Player keys / releases the mic (voice). Typed commands call transmit() directly. */
  keyDown() {
    this.radio.keyDown();
    this.changed();
  }
  keyUp(): boolean {
    const blocked = this.radio.keyUp();
    this.changed();
    return blocked;
  }

  /** The player's complete transmission, from voice or keyboard. */
  transmit(text: string, source: 'voice' | 'typed', blocked = false): ParseResult | null {
    if (this.finished || !text.trim()) return null;
    if (source === 'typed') {
      // Typing is an instant key-down / key-up on the frequency.
      this.radio.keyDown();
      blocked = this.radio.keyUp();
    }
    const ctx = this.parseContext(source === 'typed');
    const r = parse(text, ctx);
    this.heardId = null;
    const s = this.stats;

    if (blocked) {
      this.add({
        kind: 'you',
        id: this.nextEntry++,
        time: this.sim.time,
        text,
        callsign: r.callsign,
        chips: [],
        issues: [],
        understood: false,
        confidence: r.confidence,
        score: 0,
      });
      this.system('Blocked: you transmitted while a pilot was talking. Say again.', 'warn');
      return r;
    }

    const understood = !!r.callsign && (r.commands.length > 0 || r.negative);
    const sc = phraseScore(r.issues);
    s.transmissions++;
    s.phraseSum += sc;
    if (!understood) s.notUnderstood++;
    for (const i of r.issues) if (i.rule !== 'unknown-words') s.rules[i.rule] = (s.rules[i.rule] ?? 0) + 1;
    const nonStandard = understood && r.issues.some((i) => i.rule !== 'unknown-words');
    this.add({
      kind: 'you',
      id: this.nextEntry++,
      time: this.sim.time,
      text,
      callsign: r.callsign,
      chips: r.commands.map(chip),
      issues: r.issues,
      understood,
      confidence: r.confidence,
      expected: nonStandard && r.callsign ? canonicalTransmission(r.callsign, r.commands, ctx) : undefined,
      score: sc,
    });

    if (!r.callsign) {
      // Somebody answers, as on a real frequency.
      const anyone = ctx.aircraft[Math.floor(this.rng.next() * ctx.aircraft.length)];
      if (anyone) {
        const station = this.station.name;
        this.pilotSays(
          anyone.callsign,
          { text: `Station calling ${station}, say again?`, speech: `Station calling ${station}, say again` },
          700,
        );
      }
      return r;
    }
    const cs = r.callsign;
    this.contacted.add(cs);
    const ac = this.sim.byCallsign(cs)!;
    this.selectedId = ac.id;
    const acCtx = ctx.aircraft.find((a) => a.callsign === cs);

    if (!r.commands.length && !r.negative) {
      this.pilotSays(cs, { text: `Say again, ${cs}`, speech: `Say again, ${this.spoken(cs)}` }, 700);
      return r;
    }

    // Catching a readback error: "negative", or repeating the instruction that was read back wrong.
    const pending = this.pendingErrors.find((p) => p.callsign === cs);
    if (pending) {
      const fixed = pending.correct[pending.index]!;
      const repeats = r.commands.some(
        (c) => JSON.stringify(c) === JSON.stringify(fixed) || (c.type === fixed.type && sameValue(c, fixed)),
      );
      if (r.negative || repeats) {
        this.pendingErrors = this.pendingErrors.filter((p) => p !== pending);
        s.readbackCaught++;
        const entry = this.log.find((e) => e.id === pending.entryId);
        if (entry?.kind === 'pilot') entry.rb = 'caught';
        if (!repeats) r.commands.push(fixed);
      }
    } else if (r.negative && !r.commands.length) {
      this.pilotSays(cs, { text: `Say again, ${cs}`, speech: `Say again, ${this.spoken(cs)}` }, 700);
      return r;
    }

    if (r.commands.some((c) => c.type === 'sayAgain')) {
      const last = this.lastSaid.get(cs);
      if (last)
        this.pilotSays(cs, { text: `I say again: ${last.text}`, speech: `I say again, ${last.speech}` }, 700);
      r.commands = r.commands.filter((c) => c.type !== 'sayAgain');
      if (!r.commands.length) return r;
    }

    // Pilot checks what they can do, reads back, and starts flying it as they speak.
    const refusals = r.commands.map((c) => {
      const v = this.sim.validate(cs, c);
      return v.ok ? undefined : v.reason;
    });
    const accepted = r.commands.filter((_, i) => !refusals[i]);
    let flown = accepted;
    let rbCmds: readonly Command[] = r.commands;
    let error: ReturnType<typeof corruptReadback> = null;
    if (
      this.mode === 'pro' &&
      !this.lesson &&
      !refusals.some(Boolean) &&
      !pending &&
      this.rng.next() < this.settings.readbackErrorRate
    ) {
      error = corruptReadback(r.commands, EHAM.transitionAltitudeFt, () => this.rng.next());
      if (error && error.commands.every((c) => this.sim.validate(cs, c).ok)) {
        flown = error.commands;
        rbCmds = error.commands;
        s.readbackErrors++;
      } else error = null;
    }
    const rb = readback(cs, rbCmds, this.sim, acCtx, refusals);
    const correct = r.commands;
    // A landing clearance counts once given, not when the readback starts: a late one still beats the go-around.
    const now = flown.filter((c) => c.type === 'land');
    if (now.length) {
      this.sim.command(cs, now);
      flown = flown.filter((c) => c.type !== 'land');
    }
    this.pilotSays(cs, rb, 500 + this.rng.next() * 700, {
      // In Pro nothing marks a readback as right or wrong: the player has to listen.
      rb: error ? 'hidden' : this.mode === 'beginner' && accepted.length ? 'ok' : undefined,
      detail: error?.detail,
      onStart: () => {
        if (this.sim.byCallsign(cs)) this.sim.command(cs, flown);
      },
      onLogged: (entryId) => {
        if (error)
          this.pendingErrors.push({
            entryId,
            callsign: cs,
            correct,
            index: error.index,
            deadline: this.sim.time + 45,
          });
      },
    });
    return r;
  }
}

function sameValue(a: Command, b: Command): boolean {
  if (a.type === 'heading' && b.type === 'heading') return a.heading === b.heading;
  if (a.type === 'altitude' && b.type === 'altitude') return a.altitude === b.altitude;
  if (a.type === 'speed' && b.type === 'speed') return a.speed === b.speed;
  return false;
}
