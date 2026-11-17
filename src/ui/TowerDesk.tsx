import type { Ref } from 'preact';
import { EHAM, dist, isOnGround, runwayById, type Aircraft } from '../core';
import type { Session } from '../game/session';
import { RADAR_RANGE_NM, type RadarTarget } from '../render/groundradar';

type Ac = Readonly<Aircraft>;

/** Who the aircraft is talking to when it is not the player. */
const AWAY: Record<string, string> = {
  app: 'with APP',
  radar: 'with APP',
  ground: '→ GND',
  departure: '→ DEP',
};

/** The three desk bays, as on the design board: arrivals, on runway, departures. */
export function towerBays(session: Session) {
  const sim = session.sim;
  const { landing, departure } = EHAM.config;
  const occupants = new Set(
    [...sim.runwayOccupants(landing), ...sim.runwayOccupants(departure)].map((a) => a.id),
  );
  const land = runwayById(EHAM, landing);
  const dep = runwayById(EHAM, departure);
  const onRunway = sim.aircraft.filter((a) => occupants.has(a.id));
  const arrivals = sim.aircraft
    .filter((a) => a.kind === 'arrival' && !occupants.has(a.id) && !isOnGround(a))
    .sort((a, b) => dist(a.pos, land.pos) - dist(b.pos, land.pos));
  // the queue in order (holding point first), then departures already airborne
  const departures = sim.aircraft
    .filter((a) => a.kind === 'departure' && !occupants.has(a.id))
    .sort(
      (a, b) =>
        Number(!isOnGround(a)) - Number(!isOnGround(b)) ||
        dist(a.pos, dep.entry?.path.at(-1) ?? dep.pos) - dist(b.pos, dep.entry?.path.at(-1) ?? dep.pos),
    );
  return { arrivals, onRunway, departures, land, dep };
}

function stripState(ac: Ac, session: Session): string {
  if (ac.comms !== session.mine)
    return ac.comms === 'none'
      ? ac.kind === 'arrival'
        ? 'with APP'
        : 'taxiing'
      : (AWAY[ac.comms] ?? ac.comms);
  const m = ac.nav.mode;
  if (m === 'takeoff') return 'rolling';
  if (ac.takeoffClear) return 'cleared take-off';
  if (ac.landClear) return 'cleared land';
  if (!session.wasContacted(ac.callsign)) return 'calling';
  if (m === 'rollout') return 'rollout';
  if (m === 'taxi' && ac.nav.then === 'vacate')
    return `vacating${ac.vacate?.exit ? ' ' + ac.vacate.exit : ''}`;
  if (m === 'taxi' && ac.nav.then === 'lineup') return 'lining up';
  if (m === 'lineup') return ac.nav.ready ? 'lined up' : 'lining up';
  if (m === 'holding') return 'ready';
  if (m === 'taxi') return 'in queue';
  if (ac.kind === 'departure') return 'airborne';
  return ac.nav.mode === 'loc' ? 'ILS' : '';
}

function stripWhere(
  ac: Ac,
  land: { pos: { x: number; y: number }; id: string },
  depId: string,
  holdName?: string,
) {
  const m = ac.nav.mode;
  if (!isOnGround(ac))
    return ac.kind === 'arrival'
      ? `${dist(ac.pos, land.pos).toFixed(1)} NM`
      : `${Math.round(ac.alt / 100) * 100} ft`;
  if (m === 'holding') return holdName ?? 'HOLD';
  if (m === 'taxi' && ac.nav.then === 'hold') return 'queue';
  return `RWY ${ac.kind === 'arrival' ? land.id : depId}`;
}

/** Radar targets: everything within range, styled like the labels in the window. */
export function radarTargets(session: Session): RadarTarget[] {
  const land = runwayById(EHAM, EHAM.config.landing);
  return session.sim.aircraft
    .filter((a) => Math.hypot(a.pos.x, a.pos.y) < RADAR_RANGE_NM)
    .map((a) => ({
      id: a.id,
      pos: a.pos,
      label: `${a.callsign.slice(3)} ${a.kind === 'arrival' ? dist(a.pos, land.pos).toFixed(1) : ''}`.trim(),
      airborne: !isOnGround(a),
      style:
        a.id === session.selectedId || a.id === session.heardId
          ? 'selected'
          : a.landClear || a.takeoffClear
            ? 'cleared'
            : a.comms !== session.mine
              ? 'pending'
              : 'plain',
    }));
}

/** Desk below the tower window: strip bays and the ground radar. Strips are buttons, so the keyboard can do it all. */
export function TowerDesk({
  session,
  radarRef,
  onRadarClick,
}: {
  session: Session;
  radarRef: Ref<HTMLCanvasElement>;
  onRadarClick: (x: number, y: number) => void;
}) {
  const { arrivals, onRunway, departures, land, dep } = towerBays(session);
  const hold = dep.entry?.name;

  const strip = (ac: Ac) => {
    const state = stripState(ac, session);
    const where = stripWhere(ac, land, dep.id, hold);
    const cls = [
      'strip',
      session.selectedId === ac.id ? 'selected' : ac.landClear || ac.takeoffClear ? 'est' : '',
      ac.comms === 'none' ? 'pending' : '',
      ac.kind === 'arrival' ? 'arr' : 'dep',
    ].join(' ');
    return (
      <button
        type="button"
        key={ac.id}
        class={cls}
        aria-pressed={session.selectedId === ac.id}
        aria-label={`${ac.callsign}, ${ac.type}, ${where}${state ? ', ' + state : ''}`}
        onClick={() => session.select(ac.id)}
      >
        <span class="col">
          <span class="row">
            <span class="cs">{ac.callsign}</span>
            <span class="dim">{state}</span>
          </span>
          <span class="row sub">
            <span>
              {ac.type}/{ac.perf.wake}
            </span>
            <span>{where}</span>
          </span>
        </span>
      </button>
    );
  };

  const bay = (title: string, note: string, list: Ac[], empty: string) => (
    <section class="bay" aria-label={`${title}, ${list.length}`}>
      <div class="panel-title">
        <span>{title}</span>
        <span>{note}</span>
      </div>
      <div class="strips">
        {list.map(strip)}
        {!list.length && <span class="dim bay-empty">{empty}</span>}
      </div>
    </section>
  );

  return (
    <section class="desk" aria-label="Flight strips and ground radar">
      {bay(`ARRIVALS ${land.id}`, String(arrivals.length), arrivals, 'No arrivals yet.')}
      {bay('ON RUNWAY', onRunway.length ? 'OCCUPIED' : 'clear', onRunway, 'Runways clear.')}
      {bay(`DEPARTURES ${dep.id}`, String(departures.length), departures, 'None waiting.')}
      <section class="bay radar-bay" aria-label="Ground radar">
        <div class="panel-title">
          <span>GROUND RADAR</span>
          <span>click to select</span>
        </div>
        {/* the canvas sits absolutely in its box, so its pixel size never feeds back into the layout */}
        <div class="ground-radar">
          <canvas
            ref={radarRef}
            role="img"
            aria-label={`Ground radar: ${onRunway.length} on the runways, ${arrivals.length} arriving, ${departures.length} departing. Use the strips to select with the keyboard.`}
            onClick={(e) => {
              const r = (e.currentTarget as HTMLCanvasElement).getBoundingClientRect();
              onRadarClick(e.clientX - r.left, e.clientY - r.top);
            }}
          />
        </div>
      </section>
    </section>
  );
}
