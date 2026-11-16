import { useEffect, useRef, useState } from 'preact/hooks';
import { EHAM, FT_PER_NM, TICK, dist, type Aircraft } from '../core';
import type { Session } from '../game/session';
import { aimAt, aircraftPose, eyePosition } from '../render/tower3d/math';
import type { GroundData, LandData } from '../render/tower3d/ground';
import type { Anchor, TowerRenderer } from '../render/tower3d/view';

const CAB_FOV = 26;
const BINO_FOV = 2.6;
const DEFAULT_DEPRESSION = 1.6;
/** Aircraft further than this from the cab get no label. */
const LABEL_RANGE_NM = 15;

type Status =
  { kind: 'loading'; done: number; total: number } | { kind: 'ready' } | { kind: 'error'; message: string };

const isTyping = (e: KeyboardEvent) => {
  const t = e.target as HTMLElement | null;
  return !!t?.closest?.('input, textarea, select, [contenteditable], .overlay');
};

/** The out-of-the-window view from a tower cab. Owns its frame loop; draws from sim state only. */
export function TowerView({ session }: { session: Session }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);
  const [cabId, setCabId] = useState(
    () => (EHAM.towers.find((t) => t.runways.includes(EHAM.config.landing)) ?? EHAM.towers[0]!).id,
  );
  const [bino, setBino] = useState(false);
  const [status, setStatus] = useState<Status>({ kind: 'loading', done: 0, total: 0 });
  const [attribution, setAttribution] = useState('');
  const cab = EHAM.towers.find((t) => t.id === cabId)!;
  // view state read by the frame loop without re-rendering
  const look = useRef({ yaw: 0, depression: DEFAULT_DEPRESSION, bearing: cab.viewBearing });
  const live = useRef({ session, cab, bino });
  live.current = { session, cab, bino };
  const anchors = useRef<Anchor[]>([]);

  const resetLook = () => Object.assign(look.current, { yaw: 0, depression: DEFAULT_DEPRESSION });
  const turn = (deg: number) => (look.current.yaw += deg * (live.current.bino ? 0.1 : 1));
  const pickCab = (id: string) => {
    resetLook();
    setCabId(id);
  };

  useEffect(() => {
    const canvas = canvasRef.current!;
    let renderer: TowerRenderer | null = null;
    let disposed = false;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      const r = canvas.getBoundingClientRect();
      renderer?.setSize(Math.max(100, r.width), Math.max(100, r.height), window.devicePixelRatio || 1);
    });

    const frame = (now: number) => {
      const { session: s, cab: c, bino: zoom } = live.current;
      s.frame(now);
      const eye = eyePosition(c);
      const list = s.sim.aircraft.map((ac) => ({
        id: ac.id,
        type: ac.type,
        airline: ac.airline,
        pose: aircraftPose(ac, EHAM, s.tickFraction, TICK),
      }));
      let bearing = c.viewBearing + look.current.yaw;
      let depression = look.current.depression;
      // binoculars follow the selected aircraft
      const target = zoom ? list.find((a) => a.id === s.selectedId) : undefined;
      if (target) ({ bearing, depression } = aimAt(eye, target.pose.pos));
      look.current.bearing = bearing;
      const t0 = performance.now();
      anchors.current = renderer!.render(list, { eye, bearing, depression, fov: zoom ? BINO_FOV : CAB_FOV });
      if (import.meta.env.DEV)
        Object.assign(window, {
          __vectors: s,
          __towerMs: performance.now() - t0,
          __towerStats: renderer!.stats,
        });
      // labels are HTML: move them to follow their aircraft
      const box = labelsRef.current;
      if (box) {
        for (const a of anchors.current) {
          const el = box.querySelector<HTMLElement>(`[data-id="${a.id}"]`);
          if (!el) continue;
          const show = a.visible && a.dist < LABEL_RANGE_NM * 1852;
          el.style.display = show ? '' : 'none';
          if (show) el.style.transform = `translate(${a.x.toFixed(1)}px, ${a.y.toFixed(1)}px)`;
        }
      }
      raf = requestAnimationFrame(frame);
    };

    void (async () => {
      try {
        // three.js is only downloaded when a tower view opens
        const { TowerRenderer } = await import('../render/tower3d/view');
        if (disposed) return;
        // graphics test: ?gfx=new
        renderer = new TowerRenderer(canvas, EHAM, new URLSearchParams(location.search).get('gfx') === 'new');
      } catch {
        setStatus({
          kind: 'error',
          message: 'The 3D view needs WebGL, which this browser or device does not provide.',
        });
        return;
      }
      ro.observe(canvas);
      raf = requestAnimationFrame(frame);
      try {
        const base = new URL('./tower/', document.baseURI).href;
        setStatus({ kind: 'loading', done: 0, total: 2 });
        const [ground, land] = (await Promise.all(
          ['ground.json', 'land.json'].map(async (f) => (await fetch(base + f)).json()),
        )) as [GroundData, LandData];
        if (disposed) return;
        renderer.loadLand(land);
        renderer.loadSurfaces(ground);
        setAttribution(`${ground.attribution}.`);
        setStatus({ kind: 'ready' });
      } catch {
        if (!disposed)
          setStatus({
            kind: 'error',
            message: 'The airport layout could not be loaded. Aircraft are still shown.',
          });
      }
    })();

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      ro.disconnect();
      renderer?.dispose();
    };
  }, []);

  // keys: 1/2 cab, hold B binoculars, arrows look. Never while typing.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (isTyping(e) || e.ctrlKey || e.metaKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === 'b' && !e.repeat) setBino(true);
      else if (k === 'arrowleft') turn(-5);
      else if (k === 'arrowright') turn(5);
      else if (k >= '1' && k <= '9' && EHAM.towers[+k - 1]) pickCab(EHAM.towers[+k - 1]!.id);
      else return;
      e.preventDefault();
    };
    const up = (e: KeyboardEvent) => e.key.toLowerCase() === 'b' && setBino(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
    };
  }, []);

  // drag to look around, click to select
  const drag = useRef<{ x: number; y: number; moved: boolean } | null>(null);
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
    const perPx = (bino ? BINO_FOV : CAB_FOV) / canvasRef.current!.clientHeight;
    look.current.yaw -= dx * perPx;
    look.current.depression = Math.max(-20, Math.min(40, look.current.depression - dy * perPx));
    d.x = e.clientX;
    d.y = e.clientY;
  };
  const onUp = (e: PointerEvent) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved) return;
    const r = canvasRef.current!.getBoundingClientRect();
    const x = e.clientX - r.left;
    const y = e.clientY - r.top;
    let best: number | null = null;
    let bestD = 30;
    for (const a of anchors.current) {
      const dd = Math.hypot(a.x - x, a.y - y);
      if (a.visible && dd < bestD) [best, bestD] = [a.id, dd];
    }
    session.select(best);
  };

  const info = (ac: Readonly<Aircraft>) => {
    const nm = dist(cab.pos, ac.pos);
    const ft = Math.max(0, Math.round((ac.alt - EHAM.elevationFt) / 50) * 50);
    return `${ac.type}/${ac.perf.wake} · ${nm.toFixed(1)} NM · ${ft} ft`;
  };
  const count = session.sim.aircraft.length;
  const bearingText = String(Math.round(((look.current.bearing % 360) + 360) % 360)).padStart(3, '0');

  return (
    <div class="tower">
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={`View from the ${cab.name} cab with ${count} aircraft in the area. Use the flight strips to select aircraft with the keyboard.`}
        onPointerDown={onDown}
        onPointerMove={onMove}
        onPointerUp={onUp}
      />
      {bino && <div class="tower-bino" aria-hidden="true" />}
      <div ref={labelsRef} class="tower-labels">
        {session.sim.aircraft.map((ac) => {
          const cleared = ac.landClear || ac.takeoffClear;
          const kind =
            ac.id === session.selectedId || ac.id === session.heardId
              ? 'sel'
              : ac.locEstablished || cleared
                ? 'est'
                : '';
          return (
            <button
              type="button"
              key={ac.id}
              data-id={ac.id}
              class={`tower-label ${kind}`}
              style="display:none"
              onClick={() => session.select(ac.id)}
              aria-label={`Select ${ac.callsign}, ${info(ac)}`}
            >
              <b>
                {ac.callsign}
                {cleared ? ' · CLR' : ac.locEstablished ? ' · ILS' : ''}
              </b>
              <span>{info(ac)}</span>
            </button>
          );
        })}
      </div>

      <div class="tower-tools">
        <span class="chipbtn mono">
          {cab.name.toUpperCase()} · {bearingText}° · {Math.round((cab.eyeHeightFt / FT_PER_NM) * 1852)} m
        </span>
        <span role="group" aria-label="Tower cab" class="seg">
          {EHAM.towers.map((t, i) => (
            <button type="button" key={t.id} aria-pressed={t.id === cabId} onClick={() => pickCab(t.id)}>
              {t.name} · {t.runways.join(', ')} <kbd>{i + 1}</kbd>
            </button>
          ))}
        </span>
        <button type="button" class="chipbtn" aria-pressed={bino} onClick={() => setBino(!bino)}>
          Binoculars <kbd>B</kbd>
        </button>
        <button type="button" class="chipbtn" aria-label="Look left" onClick={() => turn(-10)}>
          ◀
        </button>
        <button type="button" class="chipbtn" aria-label="Look right" onClick={() => turn(10)}>
          ▶
        </button>
        <button type="button" class="chipbtn" onClick={resetLook}>
          Reset view
        </button>
      </div>

      {bino && (
        <div class="tower-note" role="status">
          Binoculars ×10
          {session.selectedId === null
            ? ' · select an aircraft to follow it'
            : ' · following the selected aircraft'}
        </div>
      )}
      {status.kind === 'loading' && status.total > 0 && (
        <div class="toast" role="status">
          Loading the airport… {status.done}/{status.total}
        </div>
      )}
      {status.kind === 'error' && (
        <div class="toast" role="alert">
          {status.message}
        </div>
      )}
      <div class="tower-credit">A stand-in Approach feeds the arrivals onto the ILS. {attribution}</div>
    </div>
  );
}
