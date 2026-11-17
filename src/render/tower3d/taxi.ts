/**
 * Taxi network from the OSM taxiway and stand lines, and routes on it (scenery taxiing in the tower view).
 * No WebGL or DOM (runs in tests). World metres on the ground plane.
 */
import { llToGround, type GroundData, type P2 } from './ground';
import { Rng, type Airport, type PlannedDeparture, type Runway } from '../../core';
import { CLEAR, footprint, type Parked, type Stand } from './stands';
import { airframe, toWorld, type Pose } from './math';

export interface TaxiGraph {
  nodes: P2[];
  adj: { to: number; d: number }[][];
}

/** Line ends this close to another line are joined to it (m): OSM taxiways mostly share nodes, a few just miss. */
const SNAP_M = 15;
/** Stand lines often stop short of the taxilane: their entry end may be this far from it (m). */
const STAND_SNAP_M = 80;

const d2 = (a: P2, b: P2) => Math.hypot(a.x - b.x, a.z - b.z);

function nearestOnSegment(p: P2, a: P2, b: P2): { q: P2; t: number } {
  const ab = { x: b.x - a.x, z: b.z - a.z };
  const l2 = ab.x * ab.x + ab.z * ab.z;
  const t = l2 ? Math.max(0, Math.min(1, ((p.x - a.x) * ab.x + (p.z - a.z) * ab.z) / l2)) : 0;
  return { q: { x: a.x + ab.x * t, z: a.z + ab.z * t }, t };
}

/**
 * Build the network: every line vertex is a node (shared OSM nodes merge), consecutive vertices are edges.
 * Dangling ends of taxiways, and the entry end of every stand line, are joined to the nearest other edge.
 * Returns the graph and, per stand, the node of its stop mark.
 */
export function buildTaxiGraph(
  ap: Pick<Airport, 'lat' | 'lon'>,
  taxiways: GroundData['taxiways'],
  stands: Stand[],
): { graph: TaxiGraph; standNode: Map<Stand, number>; standEntry: Map<Stand, number> } {
  const nodes: P2[] = [];
  const index = new Map<string, number>();
  const edges = new Set<string>();
  const adj: { to: number; d: number }[][] = [];
  const node = (p: P2) => {
    const k = `${Math.round(p.x * 2)},${Math.round(p.z * 2)}`;
    let i = index.get(k);
    if (i === undefined) {
      index.set(k, (i = nodes.length));
      nodes.push(p);
      adj.push([]);
    }
    return i;
  };
  const link = (a: number, b: number) => {
    if (a === b || edges.has(`${a},${b}`)) return;
    edges.add(`${a},${b}`).add(`${b},${a}`);
    const d = d2(nodes[a]!, nodes[b]!);
    adj[a]!.push({ to: b, d });
    adj[b]!.push({ to: a, d });
  };
  const lines: number[][] = [];
  for (const t of taxiways) {
    const ids = t.pts.map((p) => node(llToGround(ap, p)));
    ids.slice(1).forEach((b, i) => link(ids[i]!, b));
    lines.push(ids);
  }
  // segments of the taxiway lines (stand lines are not targets: one stand never leads into another)
  const segs = lines.flatMap((ids) => ids.slice(1).map((b, i) => [ids[i]!, b] as [number, number]));
  /** Join node n to the nearest segment within `max` m that it isn't on, splitting the segment there. */
  const join = (n: number, max: number) => {
    let best: { s: number; q: P2; t: number; d: number } | null = null;
    segs.forEach(([a, b], s) => {
      if (a === n || b === n) return;
      const { q, t } = nearestOnSegment(nodes[n]!, nodes[a]!, nodes[b]!);
      const d = d2(q, nodes[n]!);
      if (d < max && (!best || d < best.d)) best = { s, q, t, d };
    });
    if (!best) return;
    const { s, q, t } = best as { s: number; q: P2; t: number };
    const [a, b] = segs[s]!;
    if (t < 0.02) return link(n, a);
    if (t > 0.98) return link(n, b);
    const m = node(q);
    link(a, m);
    link(m, b);
    segs.splice(s, 1, [a, m], [m, b]);
    link(n, m);
  };
  for (const ids of lines)
    for (const end of [ids[0]!, ids[ids.length - 1]!]) if (adj[end]!.length <= 1) join(end, SNAP_M);

  const standNode = new Map<Stand, number>();
  const standEntry = new Map<Stand, number>();
  for (const s of stands) {
    const ids = s.pts.map(node);
    ids.slice(1).forEach((b, i) => link(ids[i]!, b));
    join(ids[0]!, STAND_SNAP_M);
    standNode.set(s, ids[ids.length - 1]!);
    standEntry.set(s, ids[0]!);
  }
  return { graph: { nodes, adj }, standNode, standEntry };
}

export function nearestNode(g: TaxiGraph, p: P2): number {
  let best = -1;
  let bd = Infinity;
  g.nodes.forEach((n, i) => {
    const d = d2(n, p);
    if (d < bd && g.adj[i]!.length) [best, bd] = [i, d];
  });
  return best;
}

/** Shortest path between two nodes as points (Dijkstra), or null when they aren't connected. */
export function route(g: TaxiGraph, from: number, to: number): P2[] | null {
  const dist = new Float64Array(g.nodes.length).fill(Infinity);
  const prev = new Int32Array(g.nodes.length).fill(-1);
  const done = new Uint8Array(g.nodes.length);
  dist[from] = 0;
  // binary heap of [dist, node]
  const heap: [number, number][] = [[0, from]];
  const push = (e: [number, number]) => {
    heap.push(e);
    for (let i = heap.length - 1; i > 0;) {
      const p = (i - 1) >> 1;
      if (heap[p]![0] <= heap[i]![0]) break;
      [heap[p], heap[i]] = [heap[i]!, heap[p]!];
      i = p;
    }
  };
  const pop = () => {
    const top = heap[0]!;
    const last = heap.pop()!;
    if (heap.length) {
      heap[0] = last;
      for (let i = 0; ;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < heap.length && heap[l]![0] < heap[m]![0]) m = l;
        if (r < heap.length && heap[r]![0] < heap[m]![0]) m = r;
        if (m === i) break;
        [heap[m], heap[i]] = [heap[i]!, heap[m]!];
        i = m;
      }
    }
    return top;
  };
  while (heap.length) {
    const [, u] = pop();
    if (done[u]) continue;
    done[u] = 1;
    if (u === to) break;
    for (const { to: v, d } of g.adj[u]!) {
      const nd = dist[u]! + d;
      if (nd < dist[v]!) {
        dist[v] = nd;
        prev[v] = u;
        push([nd, v]);
      }
    }
  }
  if (!done[to]) return null;
  const out: P2[] = [];
  for (let n = to; n !== -1; n = prev[n]!) out.push(g.nodes[n]!);
  return out.reverse();
}

/** Whether a path runs over any of the runways (their paved width, ends included), checked every few metres. */
export function crossesRunway(pts: P2[], runways: Runway[]): boolean {
  const boxes = runways.map((r) => {
    const a = toWorld(r.pos);
    const h = (r.heading * Math.PI) / 180;
    return {
      a,
      f: { x: Math.sin(h), z: -Math.cos(h) },
      len: r.lengthFt * 0.3048,
      half: (r.widthFt * 0.3048) / 2,
    };
  });
  const on = (p: P2) =>
    boxes.some(({ a, f, len, half }) => {
      const d = { x: p.x - a.x, z: p.z - a.z };
      const along = d.x * f.x + d.z * f.z;
      return along > -60 && along < len + 60 && Math.abs(d.x * f.z - d.z * f.x) < half;
    });
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1]!, pts[i]!];
    const n = Math.ceil(d2(a, b) / 5);
    for (let k = 0; k < n; k++)
      if (on({ x: a.x + ((b.x - a.x) * k) / n, z: a.z + ((b.z - a.z) * k) / n })) return true;
  }
  return false;
}

// ------------------------------------------------------------------ moving along a path

/** A piece of a planned movement: from a to b between times t0 and t1, heading turning from h0 to h1. */
interface Step {
  a: P2;
  b: P2;
  t0: number;
  t1: number;
  h0: number;
  h1: number;
}

const TAXI_MS = 8; // about 15 kt
const PUSH_MS = 1.2;
const bearingOf = (a: P2, b: P2) => ((Math.atan2(b.x - a.x, -(b.z - a.z)) * 180) / Math.PI + 360) % 360;
const turnTo = (h0: number, h1: number) => ((((h1 - h0) % 360) + 540) % 360) - 180;

/** Round the corners: two passes of Chaikin's corner cutting (end points kept). */
export function smooth(pts: P2[]): P2[] {
  let p = pts;
  for (let k = 0; k < 2; k++) {
    if (p.length < 3) return p;
    const out = [p[0]!];
    for (let i = 0; i < p.length - 1; i++) {
      const a = p[i]!;
      const b = p[i + 1]!;
      if (i > 0) out.push({ x: a.x * 0.75 + b.x * 0.25, z: a.z * 0.75 + b.z * 0.25 });
      if (i < p.length - 2) out.push({ x: a.x * 0.25 + b.x * 0.75, z: a.z * 0.25 + b.z * 0.75 });
    }
    out.push(p[p.length - 1]!);
    p = out;
  }
  return p;
}

/**
 * A movement as timed steps, built leg by leg. `taxi` drives forward along points (slower in turns and
 * near the end), `push` backs along points keeping the heading, `turn` turns on the spot, `wait` stands.
 */
export class Movement {
  steps: Step[] = [];
  constructor(
    public t: number,
    public pos: P2,
    public hdg: number,
  ) {}

  private add(b: P2, dt: number, h1: number) {
    this.steps.push({ a: this.pos, b, t0: this.t, t1: this.t + dt, h0: this.hdg, h1 });
    [this.pos, this.t, this.hdg] = [b, this.t + dt, h1];
  }
  wait(dt: number) {
    this.add(this.pos, dt, this.hdg);
    return this;
  }
  turn(to: number, degPerS = 6) {
    const d = Math.abs(turnTo(this.hdg, to));
    if (d > 1) this.add(this.pos, d / degPerS, this.hdg + turnTo(this.hdg, to));
    return this;
  }
  push(pts: P2[]) {
    for (const p of pts) {
      const l = d2(this.pos, p);
      if (l > 0.1) this.add(p, l / PUSH_MS, this.hdg);
    }
    return this;
  }
  taxi(pts: P2[], endSlow = true) {
    const path = smooth([this.pos, ...pts]);
    let left = path.slice(1).reduce((s, p, i) => s + d2(path[i]!, p), 0);
    for (let i = 1; i < path.length; i++) {
      const p = path[i]!;
      const l = d2(this.pos, p);
      if (l < 0.1) continue;
      const h = bearingOf(this.pos, p);
      // slow for the turn ahead: 15° of turn over the step halves the speed
      const next = path[i + 1];
      const bend = next ? Math.abs(turnTo(h, bearingOf(p, next))) : 0;
      let v = TAXI_MS / (1 + bend / 15);
      if (endSlow) v = Math.min(v, 1.5 + left * 0.08);
      // the nose swings onto the new direction fast but not instantly
      if (Math.abs(turnTo(this.hdg, h)) > 25) this.turn(h, 20);
      this.add(p, l / Math.max(1, v), this.hdg + turnTo(this.hdg, h));
      left -= l;
    }
    return this;
  }

  get end() {
    return this.t;
  }

  /** Position and heading at time t (held at the start before it, at the end after it). */
  at(t: number): { pos: P2; hdg: number } {
    const s = this.steps.find((x) => t < x.t1) ?? this.steps[this.steps.length - 1];
    if (!s) return { pos: this.pos, hdg: this.hdg };
    const f = Math.max(0, Math.min(1, (t - s.t0) / Math.max(1e-6, s.t1 - s.t0)));
    return {
      pos: { x: s.a.x + (s.b.x - s.a.x) * f, z: s.a.z + (s.b.z - s.a.z) * f },
      hdg: (((s.h0 + (s.h1 - s.h0) * f) % 360) + 360) % 360,
    };
  }
}

// ------------------------------------------------------------------ scenery traffic

/** An aircraft the sim is showing (only what the ground traffic needs). */
export interface SimTarget {
  id: number;
  kind: 'arrival' | 'departure';
  type: string;
  airline: string;
  pose: Pose;
}

export interface Ghost {
  id: number;
  type: string;
  airline: string;
  pose: Pose;
}

/**
 * At most this many arrivals stay parked at their stand (draw calls): when another parks, the oldest one out
 * of view goes. Up to twice as many while all of them are in view.
 */
const MAX_PARKED = 8;
/** A departure's engines start this long after the push (s). */
const START_S = 30;
/** Departures are timed to reach the queue this early (s): room for holding behind other traffic on the way. */
const SLACK_S = 60;
/** A taxiing aircraft holds for one this close ahead: half of both lengths plus this (m)... */
const GAP_M = 10;
/** ...within this distance either side of its path (m). */
const LANE_M = 20;
/** It gives up holding after this long in one movement (s): two that block each other can't lock up. */
const MAX_HOLD_S = 120;

interface Entry {
  id: number;
  type: string;
  airline: string;
  move: Movement;
  /** Its footprint, held on the stand until it leaves. */
  print?: P2[][];
  /** Departure: gone when the sim spawns it. */
  until?: number;
  key?: string;
  /** Departure: where it waits in the queue. */
  dest?: P2;
  /** Seconds spent holding for traffic ahead in this movement. */
  held: number;
}

const groundPose = (pos: P2, hdg: number): Pose => ({
  pos: { x: pos.x, y: 0, z: pos.z },
  headingDeg: hdg,
  pitchDeg: 0,
  gearDown: true,
  onGround: true,
  aglM: 0,
});

/**
 * Scenery taxiing in the tower view: arrivals that vacated taxi to a free stand and park there; planned
 * departures wait at a free stand, push back and taxi to the queue at the holding point, timed to get there
 * as the sim spawns them in their place. The sim never sees any of it.
 */
export class GroundTraffic {
  private entries: Entry[] = [];
  private last = new Map<number, SimTarget>();
  private nextId = -1;
  private rng = new Rng(4242);
  private skipped = new Set<string>();
  private lastT = -Infinity;
  /** Footprints taken: scenery parked aircraft first, then ours. */
  private prints: P2[][];
  /** Whether a ground point is in the camera's view: aircraft only appear and vanish out of it. */
  seen: (p: P2) => boolean = () => false;

  constructor(
    private graph: TaxiGraph,
    private stands: Stand[],
    private standNode: Map<Stand, number>,
    private standEntry: Map<Stand, number>,
    private fit: (s: Stand, type: string, airline: string, prints: P2[][]) => Parked | null,
    parked: Parked[],
    /** Runways in use: no scenery route crosses them. */
    private runways: Runway[] = [],
  ) {
    this.prints = parked.map((p) => footprint(p, CLEAR / 2));
  }

  /** Free stand for a type, picked at random among those a route reaches; with the parking spot. */
  private pickStand(type: string, ok: (s: Stand) => boolean): { stand: Stand; spot: Parked } | null {
    const order = this.stands.map((s) => [s, this.rng.next()] as const).sort((a, b) => a[1] - b[1]);
    for (const [s] of order) {
      const spot = this.fit(s, type, '', this.prints);
      if (spot && ok(s)) return { stand: s, spot };
    }
    return null;
  }

  private claim(spot: Parked): P2[][] {
    const fp = footprint(spot, CLEAR / 2);
    this.prints.push(fp);
    return [fp];
  }
  private release(e: Entry) {
    if (e.print) this.prints = this.prints.filter((p) => !e.print!.includes(p));
  }

  /** Arrival that just vacated at `from`: taxi to a stand, or nothing when none is free or reachable. */
  private arrive(t: number, a: SimTarget) {
    const from = { x: a.pose.pos.x, z: a.pose.pos.z };
    const start = nearestNode(this.graph, from);
    let path: P2[] | null = null;
    const pick = this.pickStand(a.type, (s) => {
      path = route(this.graph, start, this.standNode.get(s)!);
      // the first points are the exit it just left, next to its runway
      return !!path && !crossesRunway(path.slice(2), this.runways);
    });
    if (!pick || !path) return;
    const len = airframe(a.type).len;
    const pts = path as P2[];
    // stop with the nose gear on the mark: drop the points past the parking spot
    while (pts.length > 1 && d2(pts[pts.length - 2]!, pick.stand.stop) < 0.36 * len) pts.pop();
    pts[pts.length - 1] = { x: pick.spot.x, z: pick.spot.z };
    const move = new Movement(t, from, a.pose.headingDeg).taxi(pts).turn(pick.spot.headingDeg);
    const parkedNow = this.entries.filter((e) => e.until === undefined && e.move.end <= t);
    if (parkedNow.length >= MAX_PARKED) {
      const gone = parkedNow.find((e) => !this.seen(e.move.pos));
      if (gone) this.remove(gone);
      else if (parkedNow.length >= 2 * MAX_PARKED) this.remove(parkedNow[0]!);
    }
    this.entries.push({
      id: this.nextId--,
      type: a.type,
      airline: a.airline,
      move,
      print: this.claim(pick.spot),
      held: 0,
    });
  }

  /**
   * Planned departure: from a stand, timed to reach the queue SLACK_S before it is due. It appears where it
   * is now on that movement (at the stand, or on the way when the sim planned it late), which must be out of
   * view unless `anywhere`. None when no stand has a route: it just appears in the queue.
   */
  private plan(t: number, p: PlannedDeparture, tail: { pos: P2; face: number }, anywhere: boolean) {
    const end = nearestNode(this.graph, tail.pos);
    let move: Movement | null = null;
    const pick = this.pickStand(p.type, (s) => {
      const path = route(this.graph, this.standEntry.get(s)!, end);
      // the last points lead to the holding point, next to the runway
      if (!path || crossesRunway(path.slice(0, -3), this.runways)) return false;
      const spot = this.fit(s, p.type, p.airline, this.prints)!;
      const m = new Movement(0, { x: spot.x, z: spot.z }, spot.headingDeg)
        .push([...s.pts].reverse().filter((q) => d2(q, s.stop) > 0.36 * airframe(p.type).len + 1))
        .turn(bearingOf(s.pts[0]!, path[1] ?? tail.pos), 3)
        .wait(START_S)
        .taxi([...path.slice(1), tail.pos])
        .turn(tail.face);
      // shift so it reaches the queue just before the sim spawns it there
      const lead = p.at - SLACK_S - m.end;
      for (const st of m.steps) [st.t0, st.t1] = [st.t0 + lead, st.t1 + lead];
      if (!anywhere && this.seen(m.at(t).pos)) return false;
      move = m;
      return true;
    });
    if (!pick || !move) return false;
    this.entries.push({
      id: this.nextId--,
      type: p.type,
      airline: p.airline,
      move,
      print: this.claim(pick.spot),
      until: p.at,
      key: p.callsign + p.at,
      dest: tail.pos,
      held: 0,
    });
    return true;
  }

  /** The queue moved up after it got there: taxi up to the new tail. */
  private moveUp(t: number, e: Entry, tail: { pos: P2; face: number }) {
    const f = { x: Math.sin((tail.face * Math.PI) / 180), z: -Math.cos((tail.face * Math.PI) / 180) };
    const ahead = (tail.pos.x - e.dest!.x) * f.x + (tail.pos.z - e.dest!.z) * f.z;
    if (ahead < 5) return;
    const path = route(this.graph, nearestNode(this.graph, e.dest!), nearestNode(this.graph, tail.pos)) ?? [];
    e.move = new Movement(t, e.move.pos, e.move.hdg).taxi([...path.slice(1, -1), tail.pos]).turn(tail.face);
    e.dest = tail.pos;
    e.held = 0;
  }

  /**
   * Hold for traffic just ahead: push the rest of the movement back by the frame time. Of two that have each
   * other ahead (head-on, or crossing), the one that started later holds.
   */
  private giveWay(t: number, dt: number, targets: readonly SimTarget[]) {
    const now = this.entries.map((e) => {
      const s = e.move.steps.find((x) => t >= x.t0 && t < x.t1);
      const dir = s && { x: s.b.x - s.a.x, z: s.b.z - s.a.z };
      const l = dir ? Math.hypot(dir.x, dir.z) : 0;
      return {
        e,
        id: e.id,
        pos: e.move.at(t).pos,
        len: airframe(e.type).len,
        dir: l > 0.1 ? { x: dir!.x / l, z: dir!.z / l } : null,
      };
    });
    const others = [
      ...now,
      ...targets
        .filter((a) => a.pose.onGround)
        .map((a) => ({
          e: null,
          id: a.id,
          pos: { x: a.pose.pos.x, z: a.pose.pos.z },
          len: airframe(a.type).len,
          dir: null,
        })),
    ];
    type O = (typeof others)[number];
    const ahead = (a: O, b: O) => {
      if (!a.dir) return false;
      const r = { x: b.pos.x - a.pos.x, z: b.pos.z - a.pos.z };
      const along = r.x * a.dir.x + r.z * a.dir.z;
      return (
        along > 0 && along < (a.len + b.len) / 2 + GAP_M && Math.abs(r.x * a.dir.z - r.z * a.dir.x) < LANE_M
      );
    };
    for (const a of now) {
      if (!a.dir || a.e.held >= MAX_HOLD_S) continue;
      // sim aircraft (positive ids) never hold for scenery; ghost ids count down, so later ones are smaller
      const blocked = others.some((b) => b !== a && ahead(a, b) && !(b.e && ahead(b, a) && a.id > b.id));
      if (!blocked) continue;
      for (const st of a.e.move.steps) if (st.t1 > t - dt) [st.t0, st.t1] = [st.t0 + dt, st.t1 + dt];
      a.e.held += dt;
    }
  }

  private remove(e: Entry) {
    this.release(e);
    this.entries = this.entries.filter((x) => x !== e);
  }

  /**
   * One frame: `t` sim seconds, the sim's aircraft, its planned departures and the queue's tail.
   * Returns the scenery aircraft to draw.
   */
  update(
    t: number,
    targets: readonly SimTarget[],
    planned: readonly PlannedDeparture[],
    tail: { pos: P2; face: number } | null,
  ): Ghost[] {
    if (t < this.lastT) this.reset();
    const dt = Math.min(5, t - this.lastT);
    this.lastT = t;
    const now = new Set(targets.map((a) => a.id));
    for (const [id, a] of this.last)
      if (!now.has(id) && a.kind === 'arrival' && a.pose.onGround && a.pose.aglM < 1) this.arrive(t, a);
    this.last = new Map(targets.map((a) => [a.id, a]));

    const keys = new Set(planned.map((p) => p.callsign + p.at));
    for (const e of [...this.entries]) if (e.key && (t >= e.until! || !keys.has(e.key))) this.remove(e);
    if (tail)
      for (const p of planned) {
        const key = p.callsign + p.at;
        if (this.skipped.has(key) || this.entries.some((e) => e.key === key)) continue;
        if (!this.plan(t, p, tail, false) && !this.plan(t, p, tail, true)) this.skipped.add(key);
      }
    if (tail) for (const e of this.entries) if (e.dest && e.move.end <= t) this.moveUp(t, e, tail);
    if (dt > 0) this.giveWay(t, dt, targets);
    return this.entries.map((e) => {
      const { pos, hdg } = e.move.at(t);
      return { id: e.id, type: e.type, airline: e.airline, pose: groundPose(pos, hdg) };
    });
  }

  private reset() {
    for (const e of [...this.entries]) this.remove(e);
    this.last.clear();
    this.skipped.clear();
  }
}
