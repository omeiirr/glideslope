import { useEffect, useRef, useState } from 'preact/hooks';
import { EHAM } from '../core';
import type { Session } from '../game/session';
import { fitRange, hitTest, type HitMap, type Scene, type View } from '../render/common';
import { drawModern } from '../render/modern/scope';
import { drawRealistic, type RealisticOptions } from '../render/realistic/scope';

interface Props {
  session: Session;
  realistic: boolean;
  /** Realistic-mode display options driven by the DCB. */
  dcb: RealisticOptions;
  /** Range in NM; changing it re-centres the scope. */
  range: number;
  recenter: number;
  onCycleRange: () => void;
}

/** The radar canvas. Owns the frame loop: advances the session, then draws. */
export function ScopeView({ session, realistic, dcb, range, recenter, onCycleRange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const view = useRef<View>({ cx: 0, cy: 2, scale: 8, w: 800, h: 600 });
  const hit = useRef<HitMap>({ targets: [], labels: [] });
  const live = useRef({ session, realistic, dcb });
  live.current = { session, realistic, dcb };
  const [, setTick] = useState(0);

  useEffect(() => {
    const canvas = canvasRef.current!;
    const ctx = canvas.getContext('2d')!;
    const resize = () => {
      const r = canvas.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const first = view.current.w === 800 && view.current.h === 600;
      view.current.w = Math.max(100, r.width);
      view.current.h = Math.max(100, r.height);
      canvas.width = Math.round(view.current.w * dpr);
      canvas.height = Math.round(view.current.h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (first) fitRange(view.current, range);
    };
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    resize();
    let raf = 0;
    const frame = (now: number) => {
      const { session: s, realistic: real, dcb: opts } = live.current;
      s.frame(now);
      const st = s.settings;
      const scene: Scene = {
        sim: s.sim,
        selectedId: s.selectedId,
        heardId: s.heardId,
        tickFraction: s.tickFraction,
        showTrails: st.showTrails,
        showIntent: st.showIntent && (s.mode === 'beginner' || !real),
        showConflicts: s.mode === 'beginner' || !real,
        isNew: (cs) => !s.wasContacted(cs),
      };
      const t0 = performance.now();
      hit.current = real
        ? drawRealistic(ctx, view.current, scene, EHAM, opts)
        : drawModern(ctx, view.current, scene, EHAM);
      // dev-only hooks for performance checks and debugging
      if (import.meta.env.DEV) Object.assign(window, { __vectors: s, __drawMs: performance.now() - t0 });
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  useEffect(() => {
    fitRange(view.current, range);
  }, [range, recenter]);

  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
  const local = (e: MouseEvent) => {
    const r = canvasRef.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const onDown = (e: PointerEvent) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: false };
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onMove = (e: PointerEvent) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    if (!d.moved && Math.hypot(dx, dy) < 4) return;
    d.moved = true;
    view.current.cx -= dx / view.current.scale;
    view.current.cy += dy / view.current.scale;
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (d && !d.moved) {
      const p = local(e);
      session.select(hitTest(hit.current, p.x, p.y));
      setTick((t) => t + 1);
    }
  };
  const onWheel = (e: WheelEvent) => {
    e.preventDefault();
    const v = view.current;
    v.scale = Math.max(3, Math.min(60, v.scale * (e.deltaY < 0 ? 1.12 : 1 / 1.12)));
  };

  const count = session.sim.aircraft.length;
  return (
    <>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`Radar scope with ${count} aircraft around Schiphol. Use the flight strips to select aircraft with the keyboard.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
        onWheel={onWheel}
      />
      {!realistic && (
        <>
          <div class="scope-legend" aria-hidden="true">
            <span>
              <i style="background:#5CC8FF" />
              Selected / heard
            </span>
            <span>
              <i style="background:#7AD7A8" />
              Established ILS
            </span>
            <span>
              <i style="background:#F5B04C" />
              Conflict
            </span>
            <span>
              <i style="height:0;width:14px;border-top:1px dashed #8B97AB" />
              Cleared route
            </span>
            <span>▼ Departure</span>
          </div>
          <div class="scope-tools">
            <button type="button" class="chipbtn" onClick={onCycleRange} title="Change range and re-centre">
              Range {range} NM
            </button>
            <span class="chipbtn">QNH {session.sim.qnh}</span>
            <span class="chipbtn">
              Wind {String(session.sim.env.wind.dir).padStart(3, '0')}/{session.sim.env.wind.speed}
            </span>
          </div>
        </>
      )}
    </>
  );
}
