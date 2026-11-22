import { SEP_NM, TICK, headingVec, onRadar, priorityTag, type Aircraft, type Vec } from '../../core';
import {
  conflictIds,
  finalPoint,
  fl3,
  runwayEnd,
  smoothPos,
  toScreen,
  type DrawScope,
  type HitMap,
} from '../common';

const C = {
  ring: '#1A2638',
  ringText: '#7D8BA3',
  tma: '#22324A',
  final: '#2C4466',
  runway: '#C9D3E2',
  fix: '#5E6E88',
  fixText: '#7D8BA3',
  text: '#E6EBF2',
  sub: '#C7D0DE',
  dim: '#8B97AB',
  blue: '#5CC8FF',
  blueText: '#9ADCFF',
  green: '#7AD7A8',
  amber: '#F5B04C',
  amberText: '#F5D59A',
  red: '#FF6B6B',
  guide: 'rgba(173, 140, 255, 0.55)',
  guideText: '#C9B8FF',
};
const MONO = "'Atkinson Hyperlegible Mono Variable', 'Atkinson Hyperlegible Mono', monospace";

/** Modern scope: smooth motion, intent lines, conflict prediction, friendly data blocks. */
export const drawModern: DrawScope = (ctx, view, scene, ap) => {
  const hit: HitMap = { targets: [], labels: [] };
  const S = (p: Vec) => toScreen(view, p);
  const { sim } = scene;
  ctx.clearRect(0, 0, view.w, view.h);
  ctx.lineWidth = 1;
  ctx.textBaseline = 'alphabetic';

  // range rings
  const o = S({ x: 0, y: 0 });
  ctx.strokeStyle = C.ring;
  ctx.fillStyle = C.ringText;
  ctx.font = `10px ${MONO}`;
  for (let r = 10; r <= 60; r += 10) {
    ctx.beginPath();
    ctx.arc(o.x, o.y, r * view.scale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillText(r === 40 ? '40 NM' : String(r), o.x + r * view.scale + 4, o.y - 4);
  }

  // TMA boundary
  ctx.strokeStyle = C.tma;
  ctx.setLineDash([2, 5]);
  ctx.beginPath();
  ap.airspace.poly.forEach((p, i) => {
    const s = S(p);
    if (i) ctx.lineTo(s.x, s.y);
    else ctx.moveTo(s.x, s.y);
  });
  ctx.closePath();
  ctx.stroke();

  // final approach course with 5 NM ticks
  const rwy = sim.env.landing;
  const a = S(rwy.pos);
  const b = S(finalPoint(rwy, 18));
  ctx.strokeStyle = C.final;
  ctx.setLineDash([6, 6]);
  ctx.beginPath();
  ctx.moveTo(a.x, a.y);
  ctx.lineTo(b.x, b.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const side = headingVec(rwy.heading + 90, 0.45);
  for (let d = 5; d <= 15; d += 5) {
    const p = finalPoint(rwy, d);
    const p1 = S({ x: p.x + side.x, y: p.y + side.y });
    const p2 = S({ x: p.x - side.x, y: p.y - side.y });
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  }

  // lesson guide: the path to fly, faint so the traffic stays on top
  if (scene.guide) {
    ctx.strokeStyle = C.guide;
    ctx.lineWidth = 2;
    ctx.setLineDash([10, 6]);
    ctx.beginPath();
    scene.guide.path.forEach((p, i) => {
      const s = S(p);
      if (i) ctx.lineTo(s.x, s.y);
      else ctx.moveTo(s.x, s.y);
    });
    ctx.stroke();
    ctx.setLineDash([]);
    ctx.lineWidth = 1;
    ctx.save();
    ctx.fillStyle = C.guideText;
    ctx.font = `600 10px ${MONO}`;
    for (const l of scene.guide.labels) {
      const s = S(l.at);
      ctx.textAlign = l.left ? 'right' : 'left';
      ctx.fillText(l.text, s.x + (l.left ? -6 : 6), s.y - 4);
    }
    ctx.restore();
  }

  // runways (each physical runway once)
  ctx.strokeStyle = C.runway;
  ctx.lineWidth = Math.max(2, Math.min(4, view.scale * 0.25));
  ctx.lineCap = 'round';
  ap.runways.forEach((r, i) => {
    if (i % 2) return;
    const p1 = S(r.pos);
    const p2 = S(runwayEnd(r));
    ctx.beginPath();
    ctx.moveTo(p1.x, p1.y);
    ctx.lineTo(p2.x, p2.y);
    ctx.stroke();
  });
  ctx.lineCap = 'butt';
  ctx.lineWidth = 1.2;

  // fixes
  const major = new Set([...ap.stars.map((s) => s.iaf), ...ap.departures.exits, 'SPL']);
  ctx.font = `10px ${MONO}`;
  for (const [name, pos] of Object.entries(ap.fixes)) {
    const isMajor = major.has(name);
    if (!isMajor && view.scale < 9) continue;
    const s = S(pos);
    ctx.strokeStyle = C.fix;
    ctx.globalAlpha = isMajor ? 1 : 0.6;
    ctx.beginPath();
    ctx.moveTo(s.x, s.y - 6);
    ctx.lineTo(s.x + 7, s.y + 6);
    ctx.lineTo(s.x - 7, s.y + 6);
    ctx.closePath();
    ctx.stroke();
    ctx.fillStyle = C.fixText;
    ctx.fillText(name, s.x + 11, s.y + 5);
  }
  ctx.globalAlpha = 1;

  const { loss, predicted } = conflictIds(sim.conflicts);
  const pos = new Map<number, Vec>();
  for (const ac of sim.aircraft.filter(onRadar)) pos.set(ac.id, S(smoothPos(ac, scene.tickFraction, TICK)));

  // intent lines
  if (scene.showIntent) {
    ctx.setLineDash([3, 4]);
    for (const ac of sim.aircraft.filter(onRadar)) {
      if (ac.comms !== 'app') continue;
      const p = pos.get(ac.id)!;
      let to: Vec | null = null;
      if (ac.nav.mode === 'heading') {
        const v = headingVec(ac.tgtHdg, Math.max(3, (ac.gs / 3600) * 90));
        to = S({ x: ac.pos.x + v.x, y: ac.pos.y + v.y });
      } else if (ac.nav.mode === 'direct' || ac.nav.mode === 'hold') to = S(ap.fixes[ac.nav.fix]!);
      if (!to) continue;
      const sel = ac.id === scene.selectedId || ac.id === scene.heardId;
      ctx.strokeStyle = sel ? 'rgba(92,200,255,0.7)' : 'rgba(139,151,171,0.5)';
      ctx.beginPath();
      ctx.moveTo(p.x, p.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  // trails
  if (scene.showTrails) {
    ctx.fillStyle = C.dim;
    for (const ac of sim.aircraft.filter(onRadar)) {
      ac.trail.slice(0, 4).forEach((t, i) => {
        const s = S(t);
        ctx.globalAlpha = 0.55 - i * 0.13;
        ctx.beginPath();
        ctx.arc(s.x, s.y, 1.6, 0, Math.PI * 2);
        ctx.fill();
      });
    }
    ctx.globalAlpha = 1;
  }

  // conflicts
  if (scene.showConflicts) {
    ctx.font = `10px ${MONO}`;
    for (const c of sim.conflicts) {
      const p1 = pos.get(c.a);
      const p2 = pos.get(c.b);
      if (!p1 || !p2) continue;
      const hot = c.kind !== 'predicted';
      const col = hot ? C.red : C.amber;
      ctx.strokeStyle = col;
      ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(p1.x, p1.y);
      ctx.lineTo(p2.x, p2.y);
      ctx.stroke();
      const mx = (p1.x + p2.x) / 2;
      const my = (p1.y + p2.y) / 2;
      ctx.setLineDash([4, 4]);
      ctx.fillStyle = hot ? 'rgba(255,107,107,0.07)' : 'rgba(245,176,76,0.06)';
      ctx.beginPath();
      ctx.arc(mx, my, Math.max(24, Math.hypot(p1.x - p2.x, p1.y - p2.y) / 2 + 14), 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      ctx.setLineDash([]);
      const title =
        c.kind === 'loss'
          ? 'SEPARATION LOST'
          : c.kind === 'wake'
            ? `WAKE ${c.required} NM`
            : `CONFLICT ${c.timeTo}s`;
      const detail = `${c.dist.toFixed(1)} NM · ${Math.round(c.altDiff / 100) * 100} ft`;
      const w = Math.max(ctx.measureText(title).width, ctx.measureText(detail).width) + 16;
      const bx = mx + 30;
      const by = my - 44;
      ctx.fillStyle = hot ? '#2A1010' : '#2A1F0C';
      ctx.beginPath();
      ctx.roundRect(bx, by, w, 34, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = col;
      ctx.font = `700 10px ${MONO}`;
      ctx.fillText(title, bx + 8, by + 14);
      ctx.font = `10px ${MONO}`;
      ctx.fillStyle = hot ? '#F2B8B8' : '#F2D29C';
      ctx.fillText(detail, bx + 8, by + 27);
    }
  }

  // aircraft
  for (const ac of sim.aircraft.filter(onRadar)) {
    const p = pos.get(ac.id)!;
    if (p.x < -80 || p.y < -80 || p.x > view.w + 80 || p.y > view.h + 80) continue;
    const selected = ac.id === scene.selectedId || ac.id === scene.heardId;
    const est = ac.nav.mode === 'loc' || ac.nav.mode === 'rollout';
    const mine = ac.comms === 'app';
    const alert = loss.has(ac.id) || (scene.showConflicts && predicted.has(ac.id));
    const col = selected
      ? C.blue
      : loss.has(ac.id)
        ? C.red
        : alert
          ? C.amber
          : est
            ? C.green
            : mine
              ? C.text
              : C.dim;
    hit.targets.push({ id: ac.id, x: p.x, y: p.y });

    if (scene.halos?.has(ac.id)) {
      // separation ring: 3 NM radius, so another target inside it is a loss of separation (if level too)
      ctx.strokeStyle = col;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      ctx.beginPath();
      ctx.arc(p.x, p.y, SEP_NM * view.scale, 0, Math.PI * 2);
      ctx.stroke();
      ctx.setLineDash([]);
    }
    if (selected) {
      ctx.fillStyle = 'rgba(92,200,255,0.12)';
      ctx.strokeStyle = C.blue;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(p.x, p.y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
    ctx.fillStyle = col;
    if (ac.kind === 'departure') {
      // departures: triangle (shape, not only colour, tells them apart)
      ctx.beginPath();
      ctx.moveTo(p.x - 5, p.y - 4);
      ctx.lineTo(p.x + 5, p.y - 4);
      ctx.lineTo(p.x, p.y + 5);
      ctx.closePath();
      ctx.fill();
    } else ctx.fillRect(p.x - 4, p.y - 4, 8, 8);

    // data block
    const line1 =
      ac.callsign +
      (ac.priority ? ` ${priorityTag(ac.priority)}` : '') +
      (mine && scene.isNew(ac.callsign) ? ' •' : '');
    const line2 = dataLine(ac, mine);
    ctx.font = `700 12px ${MONO}`;
    const w1 = ctx.measureText(line1 + (selected ? `  ${ac.type}` : '')).width;
    ctx.font = `11px ${MONO}`;
    const w = Math.max(w1, ctx.measureText(line2).width);
    // leader direction: away from the final approach course so blocks on final don't stack
    const right = ac.id % 2 === 0;
    const up = ac.id % 4 < 2;
    const bx = right ? p.x + 26 : p.x - 26 - w;
    const by = up ? p.y - 38 : p.y + 14;
    ctx.strokeStyle = selected ? C.blue : '#6B7A93';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x + (right ? 6 : -6), p.y + (up ? -6 : 6));
    ctx.lineTo(right ? bx - 3 : bx + w + 3, up ? by + 26 : by + 2);
    ctx.stroke();
    if (selected) {
      ctx.fillStyle = '#0E2337';
      ctx.beginPath();
      ctx.roundRect(bx - 8, by - 4, w + 16, 36, 5);
      ctx.fill();
      ctx.stroke();
    }
    ctx.font = `700 12px ${MONO}`;
    ctx.fillStyle = selected
      ? '#E9F7FF'
      : alert
        ? loss.has(ac.id)
          ? C.red
          : C.amberText
        : est
          ? C.green
          : mine
            ? C.text
            : C.dim;
    ctx.fillText(line1, bx, by + 11);
    if (selected) {
      ctx.font = `9px ${MONO}`;
      ctx.fillStyle = C.blueText;
      ctx.fillText(ac.type, bx + w - ctx.measureText(ac.type).width, by + 11);
    }
    ctx.font = `11px ${MONO}`;
    ctx.fillStyle = selected ? C.blueText : est ? C.green : mine ? C.sub : C.fixText;
    ctx.fillText(line2, bx, by + 25);
    hit.labels.push({ id: ac.id, rect: { x: bx - 8, y: by - 4, w: w + 16, h: 36 } });
  }
  return hit;
};

/** "080↓030 210": level, trend, cleared level, indicated airspeed. */
function dataLine(ac: Readonly<Aircraft>, mine: boolean): string {
  const spd = String(Math.round(ac.ias / 10) * 10);
  if (ac.nav.mode === 'rollout' || ac.phase === 'vacating') return 'LANDED';
  if (ac.nav.mode === 'loc') return `${ac.gsEstablished ? 'ILS' : 'LOC'} ${fl3(ac.alt)} ${spd}`;
  if (!mine && ac.comms === 'none') return `${fl3(ac.alt)} ${spd}`;
  const d = ac.tgtAlt - ac.alt;
  const arrow = Math.abs(d) < 100 ? '=' : d > 0 ? '↑' : '↓';
  return `${fl3(ac.alt)}${arrow}${fl3(ac.tgtAlt)} ${spd}${ac.nav.mode === 'hold' ? ' H' : ''}`;
}
