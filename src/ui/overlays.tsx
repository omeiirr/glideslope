import { EHAM } from '../core';
import { SCENARIOS, type Scenario } from '../game/scenarios';
import { phraseologyPct, WEIGHTS } from '../game/scoring';
import type { Session } from '../game/session';
import type { Settings } from '../game/settings';
import { RULE_TEXT } from '../phraseology/phrases';
import type { VoiceState } from '../speech/voice';

export interface Progress {
  /** Completed tutorial lesson ids. */
  lessons: string[];
  /** Best score per scenario id. */
  best: Record<string, number>;
}

// ------------------------------------------------------------------ menu

export function Menu({
  progress,
  onStart,
  onSettings,
}: {
  progress: Progress;
  onStart: (s: Scenario) => void;
  onSettings: () => void;
}) {
  const group = (title: string, list: Scenario[]) => (
    <>
      <h2>{title}</h2>
      <div class="cards">
        {list.map((s) => (
          <button type="button" class="card" key={s.id} onClick={() => onStart(s)}>
            <b>
              {s.name}
              {s.lesson && progress.lessons.includes(s.lesson) ? ' ✓' : ''}
            </b>
            <span>{s.blurb}</span>
            {progress.best[s.id] !== undefined && (
              <span class="mono">Best {progress.best[s.id]!.toLocaleString('en')}</span>
            )}
          </button>
        ))}
      </div>
    </>
  );
  return (
    <div class="overlay">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="menu-title">
        <h1 id="menu-title">Vectors · Schiphol Approach</h1>
        <p>
          You are the approach controller at Amsterdam Schiphol. Vector arrivals onto the ILS for runway 18R
          and hand departures off, using ICAO phraseology. Talk to pilots with push-to-talk (hold Space) or
          type. Everything runs in your browser; nothing you say leaves your machine.
        </p>
        {group(
          'Tutorial',
          SCENARIOS.filter((s) => s.lesson),
        )}
        {group(
          'Free play',
          SCENARIOS.filter((s) => !s.lesson && s.mode === 'beginner'),
        )}
        {group(
          'Professional scenarios',
          SCENARIOS.filter((s) => !s.lesson && s.mode === 'pro'),
        )}
        <div style="display:flex;gap:8px;justify-content:space-between;align-items:center">
          <button type="button" class="btn" onClick={onSettings}>
            Settings
          </button>
          <span class="dim" style="font-size:11.5px">
            Free and open source (MIT) · not for real-world training
          </span>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ settings

interface SettingsProps {
  settings: Settings;
  voice: VoiceState;
  onChange: (patch: Partial<Settings>) => void;
  onClose: () => void;
}

export function SettingsDialog({ settings: s, voice, onChange, onClose }: SettingsProps) {
  const select = <K extends keyof Settings>(
    key: K,
    label: string,
    options: [Settings[K] & string, string][],
    hint?: string,
  ) => (
    <label class="form-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <select
        value={s[key] as string}
        onChange={(e) => onChange({ [key]: (e.target as HTMLSelectElement).value } as Partial<Settings>)}
      >
        {options.map(([v, l]) => (
          <option value={v}>{l}</option>
        ))}
      </select>
    </label>
  );
  const toggle = (key: 'voice' | 'radioFx' | 'showTrails' | 'showIntent', label: string, hint?: string) => (
    <label class="form-row">
      <span>
        {label}
        {hint && <small>{hint}</small>}
      </span>
      <input
        type="checkbox"
        checked={s[key]}
        onChange={(e) => onChange({ [key]: (e.target as HTMLInputElement).checked })}
      />
    </label>
  );
  return (
    <div class="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        class="dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
        style="width:min(560px,100%)"
      >
        <h1 id="settings-title">Settings</h1>

        <h2>Voice input</h2>
        {toggle(
          'voice',
          'Voice input (push-to-talk)',
          'Downloads a speech model on first use (about 75–150 MB), then works offline.',
        )}
        {select(
          'asr',
          'Speech recognition',
          [
            ['whisper-base', 'Whisper base (WebGPU, best)'],
            ['whisper-tiny', 'Whisper tiny (works without WebGPU)'],
            ['webspeech', 'Browser speech API (may use a cloud service)'],
          ],
          s.asr === 'webspeech'
            ? 'Warning: in some browsers this sends your audio to a cloud service.'
            : 'Runs entirely on your machine. Falls back to tiny automatically if WebGPU is missing.',
        )}
        <div class="form-row">
          <span>
            Push-to-talk key<small>Click, then press the key you want.</small>
          </span>
          <input
            type="text"
            readOnly
            value={s.pttKey}
            aria-label="Push-to-talk key"
            style="width:110px;background:var(--card);border:1px solid var(--line);border-radius:6px;padding:5px 8px"
            onKeyDown={(e) => {
              e.preventDefault();
              if (e.code !== 'Tab' && e.code !== 'Enter' && e.code !== 'Escape') onChange({ pttKey: e.code });
            }}
          />
        </div>
        {voice.status !== 'off' && (
          <p class="dim" style="font-size:12px">
            Voice status: {voice.status}
            {voice.message ? ` · ${voice.message}` : ''}
          </p>
        )}

        <h2>Pilot voices</h2>
        {select('tts', 'Pilot speech', [
          ['piper', 'Piper voices (downloads about 60 MB per voice)'],
          ['system', 'Browser voices (no download)'],
          ['off', 'Off (text only)'],
        ])}
        <label class="form-row">
          <span>Volume</span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={s.ttsVolume}
            onInput={(e) => onChange({ ttsVolume: +(e.target as HTMLInputElement).value })}
          />
        </label>
        {toggle('radioFx', 'Radio effect', 'Band-pass, light distortion, noise and squelch clicks.')}

        <h2>Game</h2>
        {select('display', 'Display', [
          ['modern', 'Modern'],
          ['realistic', 'Realistic (STARS-like)'],
        ])}
        {select('mode', 'Rules for free play', [
          ['beginner', 'Beginner'],
          ['pro', 'Professional'],
        ])}
        {select('feedback', 'Phraseology feedback', [
          ['all', 'All notes'],
          ['errors', 'Errors only'],
          ['off', 'Off'],
        ])}
        <label class="form-row">
          <span>
            Readback error rate<small>Professional mode: how often a pilot reads back a wrong value.</small>
          </span>
          <span>
            <input
              type="number"
              min="0"
              max="30"
              step="1"
              value={Math.round(s.readbackErrorRate * 100)}
              style="width:64px"
              onChange={(e) =>
                onChange({
                  readbackErrorRate:
                    Math.max(0, Math.min(30, +(e.target as HTMLInputElement).value || 0)) / 100,
                })
              }
            />{' '}
            %
          </span>
        </label>
        {toggle('showTrails', 'Trails')}
        {toggle(
          'showIntent',
          'Intent lines',
          'Dashed line showing each cleared heading or route (Modern display).',
        )}

        <div style="display:flex;justify-content:flex-end">
          <button type="button" class="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ debrief

export function Debrief({
  session,
  onMenu,
  onAgain,
  onNext,
}: {
  session: Session;
  onMenu: () => void;
  onAgain: () => void;
  onNext?: () => void;
}) {
  const s = session.stats;
  const w = WEIGHTS[session.mode];
  const missed = session.log.filter((e) => e.kind === 'pilot' && e.rb === 'missed');
  const rules = Object.entries(s.rules).sort((a, b) => b[1] - a[1]);
  const pts = (n: number) => (n ? `${n > 0 ? '+' : ''}${Math.round(n)}` : '0');
  const rows: [string, string | number, number][] = [
    ['Landings', s.landed, s.landed * w.landed],
    ['Departures handed off', s.departuresOut, s.departuresOut * w.departure],
    [
      'Average arrival delay',
      s.landed ? `${(s.delaySum / s.landed / 60).toFixed(1)} min` : '—',
      (s.delaySum / 10) * w.delayPer10s,
    ],
    ['Separation losses', s.separationLosses, s.separationLosses * w.separation],
    ['Wake turbulence infringements', s.wakeInfringements, s.wakeInfringements * w.wake],
    ['Missed handoffs', s.missedHandoffs, s.missedHandoffs * w.missedHandoff],
    ['Go-arounds', s.goArounds, s.goArounds * w.goAround],
    ['Aircraft that left the airspace', s.leftAirspace, s.leftAirspace * w.leftAirspace],
    [
      'Readback errors caught',
      `${s.readbackCaught} of ${s.readbackErrors}`,
      s.readbackCaught * w.caughtReadback + (s.readbackErrors - s.readbackCaught) * w.uncaughtReadback,
    ],
    [
      'Phraseology',
      `${phraseologyPct(s)} % over ${s.transmissions} transmissions`,
      (s.phraseSum / 100) * w.phraseBonus,
    ],
  ];
  return (
    <div class="overlay">
      <div class="dialog" role="dialog" aria-modal="true" aria-labelledby="debrief-title">
        <h1 id="debrief-title">
          {session.lesson ? `Lesson complete: ${session.lesson.title}` : `Debrief · ${session.scenario.name}`}
        </h1>
        {!session.lesson && (
          <>
            <table class="score">
              <tbody>
                {rows.map(([label, value, points]) => (
                  <tr>
                    <td>{label}</td>
                    <td>{value}</td>
                    <td>{pts(points)}</td>
                  </tr>
                ))}
                <tr>
                  <td>
                    <b>Score</b>
                  </td>
                  <td />
                  <td>
                    <b>{session.score.toLocaleString('en')}</b>
                  </td>
                </tr>
              </tbody>
            </table>
            {missed.length > 0 && (
              <>
                <h2>Readback errors you missed</h2>
                {missed.map(
                  (e) =>
                    e.kind === 'pilot' && (
                      <p>
                        ✕ {e.callsign}: {e.detail}. The pilot said: “{e.text}”
                      </p>
                    ),
                )}
              </>
            )}
          </>
        )}
        {session.lesson && (
          <p>
            Phraseology: {phraseologyPct(s)} % over {s.transmissions} transmissions.
          </p>
        )}
        {rules.length > 0 && (
          <>
            <h2>Phraseology notes</h2>
            {rules.slice(0, 6).map(([rule, n]) => (
              <p>
                {n}× {RULE_TEXT[rule] ?? rule}
              </p>
            ))}
          </>
        )}
        <div style="display:flex;gap:8px;justify-content:flex-end">
          <button type="button" class="btn" onClick={onMenu}>
            Menu
          </button>
          <button type="button" class="btn" onClick={onAgain}>
            Play again
          </button>
          {onNext && (
            <button type="button" class="btn primary" onClick={onNext}>
              Next lesson
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ in-scope cards

export function TutorialCard({ session, onInsert }: { session: Session; onInsert: (text: string) => void }) {
  const lesson = session.lesson!;
  const step = lesson.steps[session.lessonStep];
  if (!step) return null;
  return (
    <div class="tutorial" role="status" aria-live="polite">
      <div class="panel-title" style="padding:0">
        <span>LESSON · {lesson.title.toUpperCase()}</span>
        <span>
          {session.lessonStep + 1} / {lesson.steps.length}
        </span>
      </div>
      <div>{step.text}</div>
      {step.say && (
        <>
          <div class="say">{step.say}</div>
          <button
            type="button"
            class="btn small"
            style="align-self:flex-start"
            onClick={() => onInsert(step.say!)}
          >
            Type it for me
          </button>
        </>
      )}
    </div>
  );
}

/** Beginner command help: example phrases for the selected aircraft. */
export function HelpCard({ session, onInsert }: { session: Session; onInsert: (text: string) => void }) {
  const ac = session.selected;
  if (!ac || ac.comms !== 'app') {
    return (
      <div class="help">
        <b>Command help</b>
        <span class="dim">
          Click an aircraft or a strip to see example phrases. Aircraft marked “calling” are waiting for you
          to answer.
        </span>
      </div>
    );
  }
  const cs = ac.callsign;
  const rwy = EHAM.config.landing;
  const tips: string[] = [];
  if (!session.wasContacted(cs)) tips.push(`${cs}, ${EHAM.frequencies.approach.name}, identified`);
  if (ac.kind === 'departure') {
    tips.push(
      `${cs}, climb flight level 100`,
      `${cs}, contact ${EHAM.frequencies.radar.name} ${EHAM.frequencies.radar.mhz}`,
    );
  } else if (ac.nav.mode === 'loc') {
    tips.push(
      `${cs}, maintain 180 knots until 4 miles final`,
      `${cs}, contact ${EHAM.frequencies.tower.name} ${EHAM.frequencies.tower.mhz}`,
    );
  } else {
    if (ac.tgtAlt > 5000) tips.push(`${cs}, descend flight level 50`);
    else if (ac.tgtAlt > 2000) tips.push(`${cs}, descend altitude 2000, QNH ${session.sim.qnh}`);
    tips.push(`${cs}, turn left heading 270`);
    if ((ac.tgtIas ?? 250) > 200) tips.push(`${cs}, reduce speed 200 knots`);
    tips.push(`${cs}, turn left heading 210, cleared ILS approach runway ${rwy}`);
  }
  return (
    <div class="help">
      <b>Try saying</b>
      {tips.slice(0, 4).map((t) => (
        <button type="button" onClick={() => onInsert(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}
