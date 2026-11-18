import {
  FT_PER_NM,
  headingVec,
  type Aircraft,
  type Airport,
  type Conflict,
  type Runway,
  type Sim,
  type Vec,
} from '../core';

/** Scope viewport: world NM → canvas pixels (north up). */
export interface View {
  cx: number;
  cy: number;
  /** Pixels per NM. */
  scale: number;
  w: number;
  h: number;
}

export const toScreen = (v: View, p: Vec): Vec => ({
  x: v.w / 2 + (p.x - v.cx) * v.scale,
  y: v.h / 2 - (p.y - v.cy) * v.scale,
});
export const toWorld = (v: View, p: Vec): Vec => ({
  x: v.cx + (p.x - v.w / 2) / v.scale,
  y: v.cy - (p.y - v.h / 2) / v.scale,
});

/** Fit a radius of `rangeNm` around the airport, slightly north-biased like the mockups. */
export function fitRange(v: View, rangeNm: number) {
  v.scale = Math.min(v.w, v.h) / (rangeNm * 2.15);
  v.cx = 0;
  v.cy = 2;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** What a renderer needs each frame. Everything here is read-only. */
export interface Scene {
  sim: Sim;
  selectedId: number | null;
  heardId: number | null;
  /** 0..1 progress into the current sim tick, for smooth motion. */
  tickFraction: number;
  showTrails: boolean;
  showIntent: boolean;
  showConflicts: boolean;
  /** Callsigns the player has not answered yet (check-in pending). */
  isNew: (callsign: string) => boolean;
  /** Lessons: a path to fly (NM), with labels along it. */
  guide?: { path: Vec[]; labels: { at: Vec; text: string; left?: boolean }[] };
}

/** Clickable areas produced by the last draw, for hit-testing. */
export interface HitMap {
  targets: { id: number; x: number; y: number }[];
  labels: { id: number; rect: Rect }[];
}

export function hitTest(hit: HitMap, x: number, y: number): number | null {
  for (const l of hit.labels)
    if (x >= l.rect.x && x <= l.rect.x + l.rect.w && y >= l.rect.y && y <= l.rect.y + l.rect.h) return l.id;
  let best: number | null = null;
  let bestD = 16;
  for (const t of hit.targets) {
    const d = Math.hypot(t.x - x, t.y - y);
    if (d < bestD) [best, bestD] = [t.id, d];
  }
  return best;
}

export const runwayEnd = (r: Runway): Vec => {
  const v = headingVec(r.heading, r.lengthFt / FT_PER_NM);
  return { x: r.pos.x + v.x, y: r.pos.y + v.y };
};

/** Point `nm` out on the extended centreline of a landing runway. */
export const finalPoint = (r: Runway, nm: number): Vec => {
  const v = headingVec(r.heading + 180, nm);
  return { x: r.pos.x + v.x, y: r.pos.y + v.y };
};

/** Position extrapolated into the current tick. */
export function smoothPos(ac: Readonly<Aircraft>, frac: number, tick: number): Vec {
  const v = headingVec(ac.track, (ac.gs / 3600) * tick * frac);
  return { x: ac.pos.x + v.x, y: ac.pos.y + v.y };
}

export const fl3 = (ft: number) => String(Math.max(0, Math.round(ft / 100))).padStart(3, '0');

export function conflictIds(conflicts: readonly Conflict[]): { loss: Set<number>; predicted: Set<number> } {
  const loss = new Set<number>();
  const predicted = new Set<number>();
  for (const c of conflicts) {
    const set = c.kind === 'predicted' ? predicted : loss;
    set.add(c.a);
    set.add(c.b);
  }
  return { loss, predicted };
}

export type DrawScope = (ctx: CanvasRenderingContext2D, view: View, scene: Scene, airport: Airport) => HitMap;
