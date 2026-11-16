/**
 * Tower ground radar: a top-down map of the aerodrome (runways, aprons, taxiways from the OSM ground data) with
 * the traffic, the active cab and its view cone. Reads core state only. The fitting, projection and picking maths
 * has no DOM so it runs in tests.
 */
import { DEG, project, reciprocalRunway, type Airport, type Vec } from '../core';
import type { GroundData, LatLon, Polygon } from './tower3d/ground';

/** Map frame: NM centre, pixels per NM, canvas size in CSS pixels. */
export interface RadarFrame {
  cx: number;
  cy: number;
  scale: number;
  w: number;
  h: number;
}

/** Margin around the runways, NM. */
const MARGIN_NM = 0.45;
/** Arrivals further out than this are not shown, NM from the airport reference. */
export const RADAR_RANGE_NM = 12;
/** Off-map targets are pinned this far inside the edge, px. */
const EDGE_PX = 9;

/** Fit every runway, with a margin, into a w × h canvas. */
export function radarFrame(ap: Pick<Airport, 'runways'>, w: number, h: number): RadarFrame {
  const xs = ap.runways.map((r) => r.pos.x);
  const ys = ap.runways.map((r) => r.pos.y);
  const [x0, x1] = [Math.min(...xs) - MARGIN_NM, Math.max(...xs) + MARGIN_NM];
  const [y0, y1] = [Math.min(...ys) - MARGIN_NM, Math.max(...ys) + MARGIN_NM];
  return {
    cx: (x0 + x1) / 2,
    cy: (y0 + y1) / 2,
    scale: Math.min(w / (x1 - x0), h / (y1 - y0)),
    w,
    h,
  };
}

export const radarPx = (f: RadarFrame, p: Vec): { x: number; y: number } => ({
  x: f.w / 2 + (p.x - f.cx) * f.scale,
  y: f.h / 2 - (p.y - f.cy) * f.scale,
});

/** Screen position of a target; off-map targets are pinned to the edge (`pinned`) along the line from the centre. */
export function targetPx(f: RadarFrame, p: Vec): { x: number; y: number; pinned: boolean } {
  const s = radarPx(f, p);
  const dx = s.x - f.w / 2;
  const dy = s.y - f.h / 2;
  const hw = f.w / 2 - EDGE_PX;
  const hh = f.h / 2 - EDGE_PX;
  const k = Math.max(Math.abs(dx) / hw, Math.abs(dy) / hh);
  if (k <= 1) return { ...s, pinned: false };
  return { x: f.w / 2 + dx / k, y: f.h / 2 + dy / k, pinned: true };
}

export type TargetStyle = 'plain' | 'cleared' | 'selected' | 'pending';
export interface RadarTarget {
  id: number;
  pos: Vec;
  /** Short label: the flight number for arrivals off the map ("66P 2.1"). */
  label: string;
  style: TargetStyle;
  /** Airborne targets get a ring; ground targets a filled square. */
  airborne: boolean;
}

/** The target nearest a click, within `r` px (pinned targets are picked where they are drawn). */
export function pickTarget(f: RadarFrame, targets: readonly RadarTarget[], x: number, y: number, r = 12) {
  let best: number | null = null;
  let bestD = r;
  for (const t of targets) {
    const p = targetPx(f, t.pos);
    const d = Math.hypot(p.x - x, p.y - y);
    if (d < bestD) [best, bestD] = [t.id, d];
  }
  return best;
}

const COLOR: Record<TargetStyle, string> = {
  plain: '#e6ebf2',
  cleared: '#7ad7a8',
  selected: '#5cc8ff',
  pending: '#8b97ab',
};

export interface RadarScene {
  ap: Airport;
  targets: readonly RadarTarget[];
  cab: Vec;
  /** View bearing and horizontal field of view of the cab window, degrees. */
  bearing: number;
  fov: number;
}

/** Draws into one canvas; the aerodrome map is cached and redrawn only when the size or the data changes. */
export class GroundRadar {
  private ground: GroundData | null = null;
  private bg: HTMLCanvasElement | null = null;
  private bgKey = '';
  private frame: RadarFrame | null = null;
  private targets: readonly RadarTarget[] = [];

  constructor(private canvas: HTMLCanvasElement) {}

  /** The target under a click on the canvas (CSS pixels), as last drawn. */
  pick(x: number, y: number): number | null {
    return this.frame ? pickTarget(this.frame, this.targets, x, y) : null;
  }

  setGround(g: GroundData) {
    this.ground = g;
    this.bgKey = '';
  }

  draw(s: RadarScene) {
    const c = this.canvas;
    const dpr = window.devicePixelRatio || 1;
    const w = c.clientWidth;
    const h = c.clientHeight;
    if (!w || !h) return;
    if (c.width !== Math.round(w * dpr) || c.height !== Math.round(h * dpr)) {
      c.width = Math.round(w * dpr);
      c.height = Math.round(h * dpr);
    }
    const f = radarFrame(s.ap, w, h);
    this.frame = f;
    this.targets = s.targets;
    const key = `${c.width}x${c.height}:${!!this.ground}`;
    if (key !== this.bgKey) {
      this.bg = this.drawMap(s.ap, f, dpr);
      this.bgKey = key;
    }
    const g = c.getContext('2d')!;
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(this.bg!, 0, 0);
    g.setTransform(dpr, 0, 0, dpr, 0, 0);

    // view cone of the active cab
    const o = radarPx(f, s.cab);
    const reach = Math.hypot(w, h);
    const a0 = (s.bearing - s.fov / 2) * DEG;
    const a1 = (s.bearing + s.fov / 2) * DEG;
    g.beginPath();
    g.moveTo(o.x, o.y);
    g.lineTo(o.x + Math.sin(a0) * reach, o.y - Math.cos(a0) * reach);
    g.lineTo(o.x + Math.sin(a1) * reach, o.y - Math.cos(a1) * reach);
    g.closePath();
    g.fillStyle = 'rgba(92, 200, 255, 0.08)';
    g.strokeStyle = 'rgba(92, 200, 255, 0.35)';
    g.lineWidth = 0.8;
    g.fill();
    g.stroke();

    // cabs: the active one bright
    for (const t of s.ap.towers) {
      const p = radarPx(f, t.pos);
      const active = t.pos.x === s.cab.x && t.pos.y === s.cab.y;
      g.save();
      g.translate(p.x, p.y);
      g.rotate(Math.PI / 4);
      g.fillStyle = active ? '#e6ebf2' : '#8b97ab';
      g.fillRect(-3, -3, 6, 6);
      g.restore();
    }

    g.font = '10px "JetBrains Mono", ui-monospace, monospace';
    g.textBaseline = 'middle';
    for (const t of s.targets) {
      const p = targetPx(f, t.pos);
      const col = COLOR[t.style];
      g.fillStyle = col;
      g.strokeStyle = col;
      g.lineWidth = 1.5;
      if (p.pinned) {
        // chevron pointing towards the target, with its label
        const ang = Math.atan2(p.y - h / 2, p.x - w / 2);
        g.save();
        g.translate(p.x, p.y);
        g.rotate(ang);
        g.beginPath();
        g.moveTo(5, 0);
        g.lineTo(-3, -4);
        g.lineTo(-3, 4);
        g.closePath();
        g.fill();
        g.restore();
        const right = p.x < w / 2;
        g.textAlign = right ? 'left' : 'right';
        g.fillText(t.label, p.x + (right ? 8 : -8), p.y + (p.y < 14 ? 6 : p.y > h - 14 ? -6 : 0));
      } else if (t.airborne) {
        g.beginPath();
        g.arc(p.x, p.y, 3.5, 0, Math.PI * 2);
        g.stroke();
      } else {
        g.fillRect(p.x - 3, p.y - 3, 6, 6);
      }
      if (t.style === 'selected' && !p.pinned) g.strokeRect(p.x - 6, p.y - 6, 12, 12);
    }
  }

  /** The aerodrome map in device pixels. */
  private drawMap(ap: Airport, f: RadarFrame, dpr: number): HTMLCanvasElement {
    const c = document.createElement('canvas');
    c.width = this.canvas.width;
    c.height = this.canvas.height;
    const g = c.getContext('2d')!;
    g.scale(dpr, dpr);
    g.fillStyle = '#0a0f1a';
    g.fillRect(0, 0, f.w, f.h);
    const px = (ll: LatLon) => radarPx(f, project(ll[0], ll[1], ap.lat, ap.lon));
    const fill = (list: Polygon[], color: string) => {
      g.fillStyle = color;
      for (const poly of list) {
        g.beginPath();
        for (const ring of poly)
          ring.forEach((ll, i) => {
            const p = px(ll);
            if (i) g.lineTo(p.x, p.y);
            else g.moveTo(p.x, p.y);
          });
        g.fill('evenodd');
      }
    };
    const gd = this.ground;
    if (gd) {
      fill(gd.aprons, '#182131');
      fill(gd.taxiwayAreas, '#222c3d');
      g.strokeStyle = '#2a3548';
      g.lineCap = 'round';
      for (const t of gd.taxiways) {
        g.lineWidth = Math.max(1, (t.w / 1852) * f.scale);
        g.beginPath();
        t.pts.forEach((ll, i) => {
          const p = px(ll);
          if (i) g.lineTo(p.x, p.y);
          else g.moveTo(p.x, p.y);
        });
        g.stroke();
      }
    }
    // runways from the sim's own data, so they match where aircraft land; each pair drawn once
    g.font = '10px "JetBrains Mono", ui-monospace, monospace';
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    const done = new Set<string>();
    for (const r of ap.runways) {
      const opp = reciprocalRunway(ap, r);
      if (done.has(r.id)) continue;
      done.add(r.id);
      if (opp) done.add(opp.id);
      const a = radarPx(f, r.pos);
      const end = opp?.pos ?? {
        x: r.pos.x + Math.sin(r.heading * DEG) * (r.lengthFt / 6076),
        y: r.pos.y + Math.cos(r.heading * DEG) * (r.lengthFt / 6076),
      };
      const b = radarPx(f, end);
      const active = [r.id, opp?.id].some((id) => id === ap.config.landing || id === ap.config.departure);
      g.strokeStyle = active ? '#5a6a84' : '#3a4659';
      g.lineWidth = Math.max(2.5, (r.widthFt / 6076) * f.scale);
      g.lineCap = 'butt';
      g.beginPath();
      g.moveTo(a.x, a.y);
      g.lineTo(b.x, b.y);
      g.stroke();
      // designators just outside each threshold
      g.fillStyle = active ? '#c7d0de' : '#8b97ab';
      for (const [rw, p, q] of [
        [r, a, b],
        [opp, b, a],
      ] as const) {
        if (!rw || ![ap.config.landing, ap.config.departure].includes(rw.id)) continue;
        const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
        g.fillText(rw.id, p.x - ((q.x - p.x) / len) * 11, p.y - ((q.y - p.y) / len) * 11);
      }
    }
    return c;
  }
}
