import { useEffect, useRef, useState } from 'preact/hooks';
import { EHAM, dist, isOnGround, runwayFrame, type Aircraft } from '../core';
import type { LogEntry, Session } from '../game/session';
import type { Settings } from '../game/settings';
import { RULE_TEXT, chip } from '../phraseology/phrases';
import type { ParseResult } from '../phraseology/parser';
import type { VoiceState } from '../speech/voice';
import { hhmmss } from './hooks';

const Icon = ({ d, size = 14 }: { d: string; size?: number }) => (
  <svg
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    stroke-width="2.2"
    aria-hidden="true"
  >
    <path d={d} />
  </svg>
);

// ------------------------------------------------------------------ top bar

interface TopBarProps {
  session: Session;
  settings: Settings;
  onDisplay: (d: Settings['display']) => void;
  onSettings: () => void;
  onLearn: () => void;
  onEnd: () => void;
}

export function TopBar({ session, settings, onDisplay, onSettings, onLearn, onEnd }: TopBarProps) {
  const f = EHAM.frequencies.approach;
  const left = session.remainingSec;
  const speeds = [1, 2, 4, 8];
  return (
    <header class="topbar">
      <div class="brand">
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#5CC8FF"
          stroke-width="1.8"
          aria-hidden="true"
        >
          <circle cx="12" cy="12" r="9" />
          <circle cx="12" cy="12" r="4.5" />
          <path d="M12 12 L19 6" />
        </svg>
        <span class="brand-name">{f.name}</span>
        <span class="mono dim">
          {EHAM.icao} · APP {f.mhz}
        </span>
      </div>
      <div class="seg" role="group" aria-label="Display mode">
        {(['modern', 'realistic'] as const).map((d) => (
          <button type="button" key={d} aria-pressed={settings.display === d} onClick={() => onDisplay(d)}>
            {d === 'modern' ? 'Modern' : 'Realistic'}
          </button>
        ))}
      </div>
      <span class="chip" title={session.mode === 'pro' ? 'Professional rules' : 'Beginner rules'}>
        {session.mode === 'pro' ? 'PRO' : 'BEGINNER'}
      </span>
      <div class="spacer" />
      <div class="stats mono">
        <div>
          <span class="dim">UTC </span>
          {session.clock}
        </div>
        {left !== null && (
          <div>
            <span class="dim">Left </span>
            {Math.floor(left / 60)}:{String(Math.floor(left % 60)).padStart(2, '0')}
          </div>
        )}
        <div>
          <span class="dim">Traffic </span>
          {session.sim.aircraft.length}
        </div>
        <div>
          <span class="dim">Landed </span>
          {session.stats.landed}
        </div>
        <div>
          <span class="dim">Score </span>
          <span style={{ color: session.score < 0 ? 'var(--red)' : 'var(--green)' }}>
            {session.score.toLocaleString('en')}
          </span>
        </div>
      </div>
      <div style="display:flex;gap:6px">
        <button
          type="button"
          class="btn"
          aria-label={session.paused ? 'Resume' : 'Pause'}
          aria-pressed={session.paused}
          onClick={() => session.setPaused(!session.paused)}
        >
          <Icon d={session.paused ? 'M7 4l13 8-13 8z' : 'M8 5v14M16 5v14'} />
        </button>
        <button
          type="button"
          class="btn mono"
          aria-label={`Simulation speed ${session.speed} times. Click to change.`}
          onClick={() => session.setSpeed(speeds[(speeds.indexOf(session.speed) + 1) % speeds.length]!)}
        >
          {session.speed}×
        </button>
        <button type="button" class="btn" onClick={onLearn} title="Phraseology and procedures reference">
          Learn
        </button>
        <button type="button" class="btn" aria-label="Settings" onClick={onSettings}>
          <Icon d="M12 8a4 4 0 100 8 4 4 0 000-8zM12 2v3M12 19v3M2 12h3M19 12h3M5 5l2 2M17 17l2 2M19 5l-2 2M7 17l-2 2" />
        </button>
        <button type="button" class="btn" onClick={onEnd}>
          End
        </button>
      </div>
    </header>
  );
}

// ------------------------------------------------------------------ strips

function etaMin(ac: Readonly<Aircraft>, session: Session): number {
  const rwy = session.sim.env.landing;
  const nm = ac.nav.mode === 'loc' ? runwayFrame(ac.pos, rwy).along : dist(ac.pos, rwy.pos) + 8;
  return Math.max(0, Math.round((nm / Math.max(ac.gs, 120)) * 60));
}

export function Strips({ session }: { session: Session }) {
  // Manual order (drag or Alt+arrows); aircraft the player has not placed follow in ETA order.
  const [order, setOrder] = useState<number[]>([]);
  const dragId = useRef<number | null>(null);
  const all = session.sim.aircraft;
  const arrivals = all.filter((a) => a.kind === 'arrival' && !isOnGround(a));
  const departures = all.filter((a) => a.kind === 'departure');
  const rank = (a: Readonly<Aircraft>) => {
    const i = order.indexOf(a.id);
    return i >= 0 ? i : 1000 + etaMin(a, session);
  };
  const sorted = [...arrivals].sort((a, b) => rank(a) - rank(b));
  const alerts = new Set(session.sim.conflicts.flatMap((c) => [c.a, c.b]));

  const move = (id: number, toIndex: number) => {
    const ids = sorted.map((a) => a.id).filter((x) => x !== id);
    ids.splice(Math.max(0, Math.min(ids.length, toIndex)), 0, id);
    setOrder(ids);
  };

  const strip = (ac: Readonly<Aircraft>, n: number | null) => {
    const est = ac.nav.mode === 'loc';
    const cls = [
      'strip',
      session.selectedId === ac.id ? 'selected' : est ? 'est' : alerts.has(ac.id) ? 'alert' : '',
      ac.comms === 'none' ? 'pending' : '',
    ].join(' ');
    const where =
      ac.kind === 'departure'
        ? ac.route
        : est
          ? 'ILS'
          : ac.nav.mode === 'hold'
            ? `HOLD ${ac.nav.fix}`
            : ac.nav.mode === 'direct'
              ? ac.nav.fix
              : `HDG ${String(ac.tgtHdg).padStart(3, '0')}`;
    const status =
      ac.comms === 'none'
        ? ac.kind === 'departure'
          ? 'departing'
          : 'inbound'
        : ac.comms === 'tower'
          ? 'TWR'
          : ac.comms === 'radar'
            ? 'RADAR'
            : !session.wasContacted(ac.callsign)
              ? 'calling'
              : null;
    return (
      <button
        type="button"
        key={ac.id}
        class={cls}
        draggable={n !== null}
        aria-pressed={session.selectedId === ac.id}
        aria-label={`${ac.callsign}, ${ac.type}, ${where}, ${Math.round(ac.alt / 100) * 100} feet${status ? ', ' + status : ''}`}
        onClick={() => session.select(ac.id)}
        onDragStart={() => (dragId.current = ac.id)}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (dragId.current !== null && n !== null) move(dragId.current, n - 1);
          dragId.current = null;
        }}
        onKeyDown={(e) => {
          if (n === null || !e.altKey) return;
          if (e.key === 'ArrowUp') move(ac.id, n - 2);
          if (e.key === 'ArrowDown') move(ac.id, n);
        }}
      >
        {n !== null && <span class="n">{n}</span>}
        <span class="col">
          <span class="row">
            <span class="cs">{ac.callsign}</span>
            <span class="dim">
              {status ?? (ac.kind === 'arrival' ? `+${etaMin(ac, session)}` : 'airborne')}
            </span>
          </span>
          <span class="row sub">
            <span>
              {ac.type}/{ac.perf.wake}
            </span>
            <span>{where}</span>
            <span>
              {ac.kind === 'departure' ? '↑ ' : ''}
              {
                ac.tgtAlt > EHAM.transitionAltitudeFt
                  ? String(Math.round(ac.tgtAlt / 100)).padStart(3, '0')
                  : Math.round(ac.tgtAlt / 100) * 100 /* on the glideslope the target is not a round number */
              }
            </span>
          </span>
        </span>
        {n !== null && (
          <svg width="10" height="16" viewBox="0 0 10 16" fill="#3A4860" aria-hidden="true">
            <circle cx="2" cy="3" r="1.4" />
            <circle cx="8" cy="3" r="1.4" />
            <circle cx="2" cy="8" r="1.4" />
            <circle cx="8" cy="8" r="1.4" />
            <circle cx="2" cy="13" r="1.4" />
            <circle cx="8" cy="13" r="1.4" />
          </svg>
        )}
      </button>
    );
  };

  return (
    <aside class="left" aria-label="Flight strips">
      <div class="panel-title">
        <span>ARRIVAL SEQUENCE</span>
        <span>RWY {EHAM.config.landing}</span>
      </div>
      <div class="strips" title="Drag to reorder, or focus a strip and press Alt+Up / Alt+Down">
        {sorted.map((ac, i) => strip(ac, i + 1))}
        {!sorted.length && (
          <span class="dim" style="padding:4px 6px">
            No arrivals yet.
          </span>
        )}
      </div>
      <div class="panel-title" style="padding-top:18px">
        <span>DEPARTURES</span>
        <span>RWY {EHAM.config.departure}</span>
      </div>
      <div class="strips" style="padding-bottom:16px">
        {departures.map((ac) => strip(ac, null))}
        {!departures.length && (
          <span class="dim" style="padding:4px 6px">
            None airborne.
          </span>
        )}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ radio panel

const TONE_ICON = { info: 'ℹ', good: '✓', warn: '!', bad: '✕' } as const;
const TONE_COLOR = {
  info: 'var(--dim)',
  good: 'var(--green)',
  warn: 'var(--amber)',
  bad: 'var(--red)',
} as const;

function Entry({
  e,
  verbosity,
  reveal,
  onReplay,
}: {
  e: LogEntry;
  verbosity: Settings['feedback'];
  reveal: boolean;
  onReplay?: (e: LogEntry) => void;
}) {
  if (e.kind === 'system')
    return (
      <div class="entry system" style={{ color: TONE_COLOR[e.tone] }}>
        <span>
          <b aria-hidden="true">{TONE_ICON[e.tone]}</b> {e.text}
        </span>
      </div>
    );
  if (e.kind === 'pilot') {
    const flagged = e.rb === 'caught' || (reveal && e.rb === 'missed');
    return (
      <div class={`entry ${flagged ? 'rberr' : 'pilot'}`}>
        <div class="meta">
          <span class="who">{e.callsign}</span>
          <span>{hhmmss(e.time)}</span>
        </div>
        <div>{e.text}</div>
        {e.rb === 'ok' && <div class="ok">✓ Readback correct</div>}
        {flagged && (
          <div class="note" style="font-weight:600">
            {e.rb === 'caught' ? 'Readback error caught' : 'Readback error missed'}: {e.detail}
          </div>
        )}
        {onReplay && (
          <button type="button" class="btn small" style="align-self:flex-start" onClick={() => onReplay(e)}>
            ▶ Play again
          </button>
        )}
      </div>
    );
  }
  const shown = e.issues.filter(
    (i) =>
      i.rule !== 'unknown-words' &&
      (verbosity === 'all' || (verbosity === 'errors' && i.severity !== 'info')),
  );
  const errors = e.issues.filter((i) => i.severity === 'error');
  return (
    <div class="entry you">
      <div class="meta">
        <span class="who">YOU</span>
        <span>{hhmmss(e.time)}</span>
      </div>
      <div style={e.understood ? undefined : { color: 'var(--dim)' }}>{e.text}</div>
      {(e.callsign || e.chips.length > 0) && (
        <div class="chips">
          {e.callsign && <span class="chip cs">{e.callsign}</span>}
          {e.chips.map((c) => (
            <span class="chip">{c}</span>
          ))}
        </div>
      )}
      {!e.understood && errors.map((i) => <div class="note error">✕ {RULE_TEXT[i.rule] ?? i.rule}</div>)}
      {e.understood && !e.issues.some((i) => i.rule !== 'unknown-words') && verbosity !== 'off' && (
        <div class="ok">✓ Standard phraseology</div>
      )}
      {e.understood &&
        shown.map((i) => (
          <div class={`note ${i.severity}`}>
            {i.severity === 'warn' ? '! ' : '· '}
            {RULE_TEXT[i.rule] ?? i.rule}
          </div>
        ))}
      {e.understood && shown.length > 0 && e.expected && (
        <div class="note info">
          ICAO: <span class="mono">“{e.expected}”</span>
        </div>
      )}
    </div>
  );
}

export function RadioPanel({
  session,
  settings,
  onReplay,
}: {
  session: Session;
  settings: Settings;
  onReplay?: (e: LogEntry) => void;
}) {
  const r = session.radio;
  const tx = r.playerKeyed ? 'me' : r.current ? 'busy' : '';
  return (
    <aside class="right" aria-label="Radio">
      <div class="radio-head">
        <div class="panel-title">
          <span>RADIO</span>
          <span class="mono" style="color:var(--text2);letter-spacing:0">
            {EHAM.frequencies.approach.mhz}
          </span>
        </div>
        <div class={`tx ${tx}`} role="status" aria-live="polite">
          <span class="dot" />
          {r.playerKeyed ? (
            <span>
              <b class="mono">YOU</b> <span class="dim">transmitting</span>
            </span>
          ) : r.current ? (
            <span>
              <b class="mono">{r.current.from}</b> <span class="dim">transmitting</span>
            </span>
          ) : (
            <span class="dim">Frequency clear{r.waiting ? ` · ${r.waiting} waiting` : ''}</span>
          )}
        </div>
        {r.current && !r.playerKeyed && session.mode === 'pro' && (
          <div class="dim" style="font-size:11px">
            Frequency busy: you'll block {r.current.from} if you transmit now.
          </div>
        )}
      </div>
      <div class="log" aria-label="Radio log" tabIndex={0}>
        {[...session.log].reverse().map((e) => (
          <Entry
            key={e.id}
            e={e}
            verbosity={settings.feedback}
            reveal={session.finished}
            onReplay={e.kind === 'pilot' ? onReplay : undefined}
          />
        ))}
        {!session.log.length && <span class="dim">Transmissions will appear here.</span>}
      </div>
    </aside>
  );
}

// ------------------------------------------------------------------ push-to-talk bar

interface PttProps {
  session: Session;
  voice: VoiceState;
  draft: string;
  setDraft: (s: string) => void;
  inputRef: { current: HTMLInputElement | null };
  onPttDown: () => void;
  onPttUp: () => void;
  onEnableVoice: () => void;
}

const VOICE_LABEL: Record<VoiceState['status'], string> = {
  off: 'VOICE OFF',
  loading: 'LOADING VOICE MODEL',
  ready: 'READY',
  recording: 'LISTENING',
  transcribing: 'TRANSCRIBING',
  error: 'VOICE ERROR',
};

export function PttBar({
  session,
  voice,
  draft,
  setDraft,
  inputRef,
  onPttDown,
  onPttUp,
  onEnableVoice,
}: PttProps) {
  const [preview, setPreview] = useState<ParseResult | null>(null);
  const live = voice.status === 'recording' || voice.status === 'transcribing';
  const text = live ? voice.partial : draft;
  useEffect(() => {
    if (!text.trim()) {
      setPreview(null);
      if (session.heardId !== null) session.hear('');
      return;
    }
    // Typed text may omit the callsign when an aircraft is selected; speech may not.
    const r = session.hear(text);
    setPreview(
      live || r.callsign
        ? r
        : { ...r, callsign: session.selected?.comms === 'app' ? session.selected.callsign : null },
    );
  }, [text, live]);

  const submit = (e: Event) => {
    e.preventDefault();
    if (!draft.trim()) return;
    session.transmit(draft, 'typed');
    setDraft('');
  };
  const micClass = `mic ${voice.status === 'recording' ? 'live' : voice.status === 'ready' || voice.status === 'transcribing' ? 'ready' : ''}`;
  return (
    <footer class="pttbar">
      <button
        type="button"
        class={micClass}
        aria-label={voice.status === 'off' ? 'Enable voice input' : 'Push to talk (hold Space)'}
        aria-pressed={voice.status === 'recording'}
        onPointerDown={(e) => {
          if (voice.status === 'off' || voice.status === 'error') return onEnableVoice();
          (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          onPttDown();
        }}
        onPointerUp={() => voice.status === 'recording' && onPttUp()}
        onPointerCancel={() => voice.status === 'recording' && onPttUp()}
        onKeyDown={(e) => {
          if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
            e.preventDefault();
            if (voice.status === 'off' || voice.status === 'error') onEnableVoice();
            else onPttDown();
          }
        }}
        onKeyUp={(e) => (e.key === 'Enter' || e.key === ' ') && voice.status === 'recording' && onPttUp()}
      >
        <svg
          width="22"
          height="22"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          stroke-width="2"
          aria-hidden="true"
        >
          <rect x="9" y="3" width="6" height="11" rx="3" />
          <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
        </svg>
      </button>
      <div class="ptt-mid">
        <div class="ptt-line" role="status" aria-live="polite">
          <span
            class="ptt-state"
            style={
              voice.status === 'error'
                ? { color: 'var(--red)' }
                : voice.status === 'off'
                  ? { color: 'var(--dim)' }
                  : undefined
            }
          >
            {VOICE_LABEL[voice.status]}
          </span>
          {voice.status === 'loading' && (
            <span
              class="progress"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(voice.progress * 100)}
            >
              <div style={{ width: `${voice.progress * 100}%` }} />
            </span>
          )}
          <span>
            {voice.message ??
              (voice.status === 'off'
                ? 'click the mic to enable voice · press Enter to type'
                : voice.status === 'ready'
                  ? 'hold Space to talk · press Enter to type'
                  : '')}
          </span>
        </div>
        {live ? (
          <div class="transcript">
            {voice.partial || <span class="dim">…</span>}
            <span style="color:var(--blue)">▍</span>
          </div>
        ) : (
          <form onSubmit={submit}>
            <input
              ref={inputRef}
              class="cmd-input"
              type="text"
              value={draft}
              onInput={(e) => setDraft((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => e.key === 'Escape' && (e.target as HTMLInputElement).blur()}
              placeholder={
                session.selected
                  ? `${session.selected.callsign}, turn left heading 270`
                  : 'KLM1426, turn left heading 270'
              }
              aria-label="Type a transmission and press Enter to send"
              autocomplete="off"
              spellcheck={false}
            />
          </form>
        )}
      </div>
      <div class="chips" style="font-size:12px;align-items:center;max-width:340px">
        {preview?.callsign && <span class="chip cs">{preview.callsign} ✓</span>}
        {preview?.ambiguous && <span class="chip hint">callsign unclear</span>}
        {preview?.commands.map((c) => (
          <span class="chip">{chip(c)}</span>
        ))}
        {preview && preview.callsign && !preview.commands.length && (
          <span class="chip hint">+ instruction?</span>
        )}
      </div>
      <div class="conf" aria-label="Callsign confidence">
        <span>Confidence</span>
        <div class="bar">
          <div style={{ width: `${Math.round((preview?.callsign ? preview.confidence : 0) * 100)}%` }} />
        </div>
        <span class="mono" style="color:var(--text2)">
          {preview?.callsign ? `${Math.round(preview.confidence * 100)}%` : '—'}
        </span>
      </div>
    </footer>
  );
}
