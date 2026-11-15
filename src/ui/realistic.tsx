import { EHAM, onRadar } from '../core';
import type { Session } from '../game/session';
import type { Settings } from '../game/settings';
import type { RealisticOptions } from '../render/realistic/scope';
import type { VoiceState } from '../speech/voice';

const LEADER = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];

interface DcbProps {
  session: Session;
  range: number;
  dcb: RealisticOptions;
  setDcb: (d: RealisticOptions) => void;
  onCycleRange: () => void;
  onRecenter: () => void;
  onModern: () => void;
  onSettings: () => void;
  onLearn: () => void;
  onEnd: () => void;
}

/** Display control bar across the top of the Realistic scope, like a STARS DCB. */
export function RealisticDcb({
  session,
  range,
  dcb,
  setDcb,
  onCycleRange,
  onRecenter,
  onModern,
  onSettings,
  onLearn,
  onEnd,
}: DcbProps) {
  const speeds = [1, 2, 4, 8];
  const B = (label: string, onClick?: () => void, on = false, aria?: string) => (
    <button
      type="button"
      class={on ? 'on' : ''}
      onClick={onClick}
      disabled={!onClick}
      aria-label={aria ?? label.replace('\n', ' ')}
    >
      {label}
    </button>
  );
  return (
    <nav class="dcb" aria-label="Display control bar">
      {B(`RANGE\n${range}`, onCycleRange, true)}
      {B('PLACE\nCNTR', onRecenter)}
      {B(
        `RR\n${dcb.rr}`,
        () => setDcb({ ...dcb, rr: dcb.rr === 10 ? 5 : 10 }),
        true,
        `Range rings every ${dcb.rr} miles`,
      )}
      {B('MAPS', () => setDcb({ ...dcb, maps: !dcb.maps }), dcb.maps)}
      {B(`BRITE\n${Math.round(dcb.brite * 100)}`, () =>
        setDcb({ ...dcb, brite: dcb.brite <= 0.5 ? 1 : dcb.brite - 0.25 }),
      )}
      {B(
        `LDR DIR\n${LEADER[dcb.leaderDir % 8]}`,
        () => setDcb({ ...dcb, leaderDir: (dcb.leaderDir + 1) % 8 }),
        false,
        'Leader line direction',
      )}
      {B(`CHAR\nSIZE ${dcb.charSize}`, () =>
        setDcb({ ...dcb, charSize: dcb.charSize >= 16 ? 10 : dcb.charSize + 2 }),
      )}
      {B(`SITE\n${EHAM.icao}`)}
      {B(session.paused ? 'RESUME' : 'PAUSE', () => session.setPaused(!session.paused), session.paused)}
      {B(
        `RATE\n${session.speed}X`,
        () => session.setSpeed(speeds[(speeds.indexOf(session.speed) + 1) % speeds.length]!),
        false,
        'Simulation speed',
      )}
      {B('DISP\nMODERN', onModern)}
      {B('PREF', onSettings, false, 'Settings')}
      {B('LEARN', onLearn, false, 'Learn: phraseology reference')}
      {B('END', onEnd)}
    </nav>
  );
}

/** Text overlays on the Realistic scope: system status, arrival list, last radio lines. */
export function RealisticChrome({
  session,
  settings,
  voice,
  range,
  dcb,
}: {
  session: Session;
  settings: Settings;
  voice: VoiceState;
  range: number;
  dcb: RealisticOptions;
}) {
  const sim = session.sim;
  const byId = (id: number) => sim.byId(id)?.callsign ?? '';
  const alerts = sim.conflicts.filter((c) => c.kind !== 'predicted');
  const arrivals = sim.aircraft
    .filter((a) => a.kind === 'arrival' && a.comms !== 'none' && onRadar(a))
    .slice(0, 12);
  const lines = session.log.slice(-4);
  const w = sim.env.wind;
  return (
    <>
      <div class="rt rt-tl" role="status">
        <span>
          {session.clock.replace(/:/, '').replace(':', '/')} {sim.qnh}
        </span>
        <span>
          OK/OK/NA {range} RR{dcb.rr}
        </span>
        <span>
          {EHAM.icao} {String(w.dir).padStart(3, '0')}/{w.speed}
        </span>
        <span>
          SCORE {session.score} LND {session.stats.landed}
          {session.remainingSec !== null ? ` T-${Math.ceil(session.remainingSec / 60)}` : ''}
        </span>
        {alerts.map((c) => (
          <span style="color:#FF4040">
            {c.kind === 'wake' ? 'WK' : 'CA'} {byId(c.a)}*{byId(c.b)}
          </span>
        ))}
      </div>
      <div class="rt rt-tr" aria-label="Arrival list">
        <span>ARR LIST</span>
        {arrivals.map((a, i) => (
          <span>
            {i + 1} {a.callsign.padEnd(7)} {a.type}
          </span>
        ))}
      </div>
      <div class="rt rt-bl" aria-label="Radio log" aria-live="polite">
        {lines.map((e) => {
          if (e.kind === 'system')
            return (
              <span style={{ color: e.tone === 'bad' ? '#FF4040' : '#3FD13F' }}>{e.text.toUpperCase()}</span>
            );
          if (e.kind === 'pilot')
            return (
              <span style={{ color: e.rb === 'caught' ? '#3FD13F' : '#E0E0E0' }}>
                {e.rb === 'caught'
                  ? `RDBK ERR ${e.callsign} ${e.detail?.toUpperCase()}`
                  : `${e.callsign}: ${e.text}`}
              </span>
            );
          const warn = settings.feedback !== 'off' && e.issues.find((i) => i.severity !== 'info');
          return (
            <span style="color:#9A9A9A">
              &gt; {e.understood ? `${e.callsign} ${e.chips.join(' ')}` : `${e.text} ??`}
              {warn && e.expected ? `  [ICAO: ${e.expected}]` : ''}
            </span>
          );
        })}
        <span style="color:#828282;font-size:11px">
          {voice.status === 'off' ? 'VOICE OFF' : `VOICE ${voice.status.toUpperCase()}`} · PTT{' '}
          {settings.pttKey.toUpperCase()} · ENTER TO TYPE
          {session.radio.current ? ` · ${session.radio.current.from} TRANSMITTING` : ''}
        </span>
      </div>
    </>
  );
}
