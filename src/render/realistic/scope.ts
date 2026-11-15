import { onRadar, type Vec } from '../../core';
import {
  conflictIds,
  finalPoint,
  fl3,
  runwayEnd,
  toScreen,
  type DrawScope,
  type HitMap,
  type Scene,
  type View,
} from '../common';
import type { Airport } from '../../core';

export interface RealisticOptions {
  /** Range-ring spacing in NM. */
  rr: number;
  maps: boolean;
  /** Leader direction, compass octant index 0 = N … 7 = NW. */
  leaderDir: number;
  charSize: number;
  brite: number;
}

const MONO = "'JetBrains Mono Variable', 'JetBrains Mono', monospace";
const SWEEP = 4; // seconds between position updates, like a real approach radar

/** Per-aircraft positions frozen at the last sweep. */
const shown = new Map<number, { pos: Vec; alt: number; gs: number; history: Vec[] }>();
let lastSweep = -1;
let lastSim: unknown = null;

/** Realistic scope: STARS-like. Monochrome map, 4-second updates, history dots, terse data blocks. */
export function drawRealistic(
  ctx: CanvasRenderingContext2D,
  view: View,
  scene: Scene,
  ap: Airport,
  o: RealisticOptions,
): HitMap {
  const hit: HitMap = { targets: [], labels: [] };
  const S = (p: Vec) => toScreen(view, p);
  const { sim } = scene;
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, view.w, view.h);
  ctx.globalAlpha = o.brite;
  ctx.lineWidth = 1;

  // sweep: positions only move every 4 s
  const sweep = Math.floor(sim.time / SWEEP);
  if (sim !== lastSim) {
    shown.clear();
    lastSim = sim;
    lastSweep = -1;
  }
  if (sweep !== lastSweep) {
    lastSweep = sweep;
    const alive = new Set<number>();
    for (const ac of sim.aircraft.filter(onRadar)) {
      alive.add(ac.id);
      const prev = shown.get(ac.id);
      const history = prev ? [prev.pos, ...prev.history].slice(0, 5) : [];
      shown.set(ac.id, { pos: { ...ac.pos }, alt: ac.alt, gs: ac.gs, history });
    }
    for (const id of shown.keys()) if (!alive.has(id)) shown.delete(id);
  }

  // range rings
  const c = S({ x: 0, y: 0 });
  ctx.strokeStyle = '#2E2E2E';
  for (let r = o.rr; r <= 60; r += o.rr) {
    ctx.beginPath();
    ctx.arc(c.x, c.y, r * view.scale, 0, Math.PI * 2);
    ctx.stroke();
  }
  // airspace + sector lines to the IAFs
  ctx.strokeStyle = '#5A5A5A';
  ctx.beginPath();
  ap.airspace.poly.forEach((p, i) => {
    const s = S(p);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.stroke();
  if (o.maps) {
    ctx.strokeStyle = '#2A2A2A';
    for (const st of ap.stars) {
      const f = S(ap.fixes[st.iaf]!);
      ctx.beginPath();
      ctx.moveTo(f.x, f.y);
      ctx.lineTo(c.x, c.y);
      ctx.stroke();
    }
  }
  // final approach course
  const rwy = sim.env.landing;
  ctx.strokeStyle = '#6A6A6A';
  const a = S(rwy.pos);
  const b = S(finalPoint(rwy, 18));
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  for (let d = 5; d <= 15; d += 5) {
    const p = S(finalPoint(rwy, d));
    ctx.beginPath();
    ctx.moveTo(p.x - 6, p.y);
    ctx.lineTo(p.x + 6, p.y);
    ctx.stroke();
  }
  // runways
  ctx.strokeStyle = '#8A8A8A';
  ctx.lineWidth = 2;
  ap.runways.forEach((r, i) => {
    if (i % 2) return;
    const p1 = S(r.pos);
    const p2 = S(runwayEnd(r));
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  });
  ctx.lineWidth = 1;
  // fixes
  if (o.maps) {
    ctx.fillStyle = '#828282';
    ctx.font = `10px ${MONO}`;
    const major = new Set([...ap.stars.map((s) => s.iaf), ...ap.departures.exits]);
    for (const [name, pos] of Object.entries(ap.fixes)) {
      if (!major.has(name) && view.scale < 9) continue;
      const s = S(pos);
      ctx.fillText(`+${name}`, s.x - 3, s.y + 3);
    }
  }

  const { loss } = conflictIds(sim.conflicts);
  const size = o.charSize;
  const lead = [
    [0, -1],
    [0.7, -0.7],
    [1, 0],
    [0.7, 0.7],
    [0, 1],
    [-0.7, 0.7],
    [-1, 0],
    [-0.7, -0.7],
  ][o.leaderDir % 8]!;

  for (const ac of sim.aircraft.filter(onRadar)) {
    const s = shown.get(ac.id);
    if (!s) continue;
    const p = S(s.pos);
    // history
    ctx.fillStyle = '#2F5FD0';
    s.history.forEach((h, i) => {
      const hp = S(h);
      ctx.globalAlpha = o.brite * (0.9 - i * 0.17);
      ctx.beginPath();
      ctx.arc(hp.x, hp.y, 2, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.globalAlpha = o.brite;
    hit.targets.push({ id: ac.id, x: p.x, y: p.y });

    if (ac.comms === 'none') {
      // unassociated target: green cross and altitude only
      ctx.strokeStyle = '#3FD13F';
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.moveTo(p.x - 4, p.y);
      ctx.lineTo(p.x + 4, p.y);
      ctx.moveTo(p.x, p.y - 4);
      ctx.lineTo(p.x, p.y + 4);
      ctx.stroke();
      ctx.lineWidth = 1;
      ctx.fillStyle = '#3FD13F';
      ctx.font = `${size}px ${MONO}`;
      ctx.fillText(fl3(s.alt), p.x - 40, p.y + 20);
      continue;
    }
    const alert = loss.has(ac.id);
    const selected = ac.id === scene.selectedId || ac.id === scene.heardId;
    const col = alert ? '#FF4040' : selected ? '#FFFF60' : '#FFFFFF';
    ctx.fillStyle = col;
    ctx.strokeStyle = col;
    ctx.font = `700 ${size}px ${MONO}`;
    // position symbol: letter of the owning controller (A = approach, T = tower, D = radar)
    const sym = ac.comms === 'app' ? 'A' : ac.comms === 'tower' ? 'T' : 'D';
    ctx.fillText(sym, p.x - size * 0.3, p.y + size * 0.35);
    const len = 24;
    const lx = p.x + lead[0]! * len;
    const ly = p.y + lead[1]! * len;
    ctx.beginPath();
    ctx.moveTo(p.x + lead[0]! * 8, p.y + lead[1]! * 8);
    ctx.lineTo(lx, ly);
    ctx.stroke();
    ctx.font = `${size}px ${MONO}`;
    const l1 = ac.callsign + (scene.isNew(ac.callsign) && ac.comms === 'app' ? '*' : '');
    const l2 = `${fl3(s.alt)} ${String(Math.round(s.gs / 10)).padStart(2, '0')}${ac.nav.mode === 'loc' ? ' I' : ''}`;
    const w = Math.max(ctx.measureText(l1).width, ctx.measureText(l2).width);
    const bx = lead[0]! < -0.1 ? lx - w - 2 : lx + 2;
    const by = lead[1]! > 0.1 ? ly + size : ly - size - 2;
    ctx.fillText(l1, bx, by);
    ctx.fillText(l2, bx, by + size + 2);
    hit.labels.push({ id: ac.id, rect: { x: bx - 2, y: by - size, w: w + 4, h: size * 2 + 6 } });
    if (alert) {
      ctx.font = `700 ${size}px ${MONO}`;
      ctx.fillText('CA', bx, by - size - 2);
    }
  }
  ctx.globalAlpha = 1;
  return hit;
}

export const DEFAULT_DCB: RealisticOptions = { rr: 10, maps: true, leaderDir: 1, charSize: 12, brite: 1 };
export type { DrawScope };
