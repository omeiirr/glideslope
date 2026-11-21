import { approachAdvice } from '../game/advice';
import { useEffect, useRef } from 'preact/hooks';
import { EHAM, isOnGround, runwayById, typeName, type Aircraft, type Command } from '../core';
import { SCENARIOS, type Scenario } from '../game/scenarios';
import { phraseologyPct, weightsFor } from '../game/scoring';
import type { Session } from '../game/session';
import type { Settings } from '../game/settings';
import { RULE_TEXT, canonicalTransmission } from '../phraseology/phrases';
import { webGpuHint, type VoiceState } from '../speech/voice';

/** Modal behaviour: focus moves into the dialog, Tab stays inside, Escape closes, focus returns afterwards. */
export function useDialog(onClose?: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  const close = useRef(onClose);
  close.current = onClose;
  useEffect(() => {
    const el = ref.current!;
    const before = document.activeElement as HTMLElement | null;
    const focusable = () => [
      ...el.querySelectorAll<HTMLElement>('button, input, select, [tabindex]:not([tabindex="-1"])'),
    ];
    focusable()[0]?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && close.current) {
        e.stopPropagation();
        close.current();
      } else if (e.key === 'Tab') {
        const f = focusable();
        const first = f[0];
        const last = f[f.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last?.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first?.focus();
        }
      }
    };
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('keydown', onKey);
      before?.focus?.();
    };
  }, []);
  return ref;
}

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
  onLearn,
}: {
  progress: Progress;
  onStart: (s: Scenario) => void;
  onSettings: () => void;
  onLearn: () => void;
}) {
  const ref = useDialog();
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
  // one obvious first click: the next unfinished lesson, then free play
  const lessons = SCENARIOS.filter((s) => s.lesson && !s.view);
  const next = lessons.find((s) => !progress.lessons.includes(s.lesson!));
  const start = next ?? SCENARIOS.find((s) => s.id === 'free')!;
  const startLabel = !next
    ? 'Play: Beginner free play'
    : next === lessons[0]
      ? 'Start the tutorial'
      : `Continue: lesson ${next.name}`;
  return (
    <div class="overlay">
      <div ref={ref} class="dialog" role="dialog" aria-modal="true" aria-labelledby="menu-title">
        <h1 id="menu-title">Glideslope · Schiphol Approach</h1>
        <p>
          You are the approach controller at Amsterdam Schiphol. Vector arrivals onto the ILS for runway 18R
          and hand departures off, using ICAO phraseology. Talk to pilots with push-to-talk (hold Space) or
          type. Everything runs in your browser; nothing you say leaves your machine.
        </p>
        <p class="menu-start">
          <button type="button" class="btn primary" onClick={() => onStart(start)}>
            {startLabel} →
          </button>
          <span class="dim">or pick any lesson, game or scenario below</span>
        </p>
        {group(
          'Tutorial',
          SCENARIOS.filter((s) => s.lesson && !s.view),
        )}
        {group(
          'Free play',
          SCENARIOS.filter((s) => !s.lesson && !s.view && !s.drill && s.mode === 'beginner'),
        )}
        {group(
          'Practice',
          SCENARIOS.filter((s) => s.drill),
        )}
        {group(
          'Tower',
          SCENARIOS.filter((s) => s.view === 'tower'),
        )}
        {group(
          'Professional scenarios',
          SCENARIOS.filter((s) => !s.lesson && !s.view && s.mode === 'pro'),
        )}
        <div style="display:flex;gap:8px;justify-content:space-between;align-items:center">
          <span style="display:flex;gap:8px">
            <button type="button" class="btn" onClick={onLearn}>
              Learn the radio
            </button>
            <button type="button" class="btn" onClick={onSettings}>
              Settings
            </button>
          </span>
          <span class="dim" style="font-size:11.5px">
            Free and open source (GPL-3.0) · not for real-world training
          </span>
        </div>
        <details class="credits">
          <summary>Credits</summary>
          <ul>
            <li>Airport and surroundings: © OpenStreetMap contributors (ODbL 1.0)</li>
            <li>Airport data: openScope (MIT) and OurAirports (public domain)</li>
            <li>Pilot voices: Piper, trained on the VCTK corpus (University of Edinburgh, CC BY 4.0)</li>
            <li>Phonemizer: espeak-ng (GPL-3.0)</li>
            <li>
              Speech recognition: OpenAI Whisper via Transformers.js (Apache-2.0) and ONNX Runtime (MIT)
            </li>
            <li>Pavement textures: Poly Haven (CC0)</li>
            <li>3D: three.js (MIT) · UI: Preact (MIT) · Fonts: Inter and JetBrains Mono (SIL OFL 1.1)</li>
          </ul>
          <p>
            Full list and licences: THIRD_PARTY.md in the{' '}
            <a href="https://github.com/omeiirr/glideslope" target="_blank" rel="noopener">
              source code
            </a>
            .
          </p>
        </details>
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
  const ref = useDialog(onClose);
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
        ref={ref}
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
            : s.asr === 'whisper-base' && voice.fellBack
              ? webGpuHint(voice.fellBack, navigator.userAgent, voice.model)
              : 'Runs entirely on your machine. Without WebGPU it runs on the processor (base on fast machines, else tiny).',
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

        <h2>Sounds</h2>
        <label class="form-row">
          <span>
            Sound effects
            <small>
              Engines and the cab in the tower view; the room, conflict alerts and the landline at the radar.
              0 is off.
            </small>
          </span>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={s.sfxVolume}
            onInput={(e) => onChange({ sfxVolume: +(e.target as HTMLInputElement).value })}
          />
        </label>

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
        <label class="form-row">
          <span>
            Free play traffic<small>Arrivals per hour (takes effect on the next start).</small>
          </span>
          <input
            type="number"
            min="2"
            max="40"
            step="2"
            value={s.freeRate}
            style="width:64px"
            onChange={(e) =>
              onChange({ freeRate: Math.max(2, Math.min(40, +(e.target as HTMLInputElement).value || 12)) })
            }
          />
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
  const ref = useDialog();
  const s = session.stats;
  const w = weightsFor(session.mode, session.tower);
  const missed = session.log.filter((e) => e.kind === 'pilot' && e.rb === 'missed');
  const rules = Object.entries(s.rules).sort((a, b) => b[1] - a[1]);
  const pts = (n: number) => (n ? `${n > 0 ? '+' : ''}${Math.round(n)}` : '0');
  const delay: [string, string | number, number] = session.tower
    ? [
        'Average wait at the holding point',
        s.departed ? `${(s.depDelaySum / s.departed / 60).toFixed(1)} min` : '—',
        (s.depDelaySum / 10) * w.depDelayPer10s,
      ]
    : [
        'Average arrival delay',
        s.landed ? `${(s.delaySum / s.landed / 60).toFixed(1)} min` : '—',
        (s.delaySum / 10) * w.delayPer10s,
      ];
  const all: ([string, string | number, number] | false)[] = [
    ['Landings', s.landed, s.landed * w.landed],
    [session.tower ? 'Departures' : 'Departures handed off', s.departuresOut, s.departuresOut * w.departure],
    delay,
    session.tower && ['Runway incursions', s.runwayIncursions, s.runwayIncursions * w.incursion],
    !session.tower && ['Separation losses', s.separationLosses, s.separationLosses * w.separation],
    ['Wake turbulence infringements', s.wakeInfringements, s.wakeInfringements * w.wake],
    ['Missed handoffs', s.missedHandoffs, s.missedHandoffs * w.missedHandoff],
    ['Go-arounds', s.goArounds, s.goArounds * w.goAround],
    s.priorityGoArounds > 0 && [
      'Go-arounds of priority arrivals',
      s.priorityGoArounds,
      s.priorityGoArounds * w.priorityGoAround,
    ],
    !session.tower &&
      s.priorityDelaySum > 0 && [
        'Delay to priority arrivals',
        `${(s.priorityDelaySum / 60).toFixed(1)} min`,
        (s.priorityDelaySum / 10) * w.priorityDelayPer10s,
      ],
    session.tower && [
      'Go-arounds with the runway free',
      s.unnecessaryGoArounds,
      s.unnecessaryGoArounds * w.unnecessaryGoAround,
    ],
    !session.tower && ['Aircraft that left the airspace', s.leftAirspace, s.leftAirspace * w.leftAirspace],
    s.pilotRequests > 0 && [
      'Pilot requests answered',
      `${s.requestsAnswered} of ${s.pilotRequests}`,
      s.requestsIgnored * w.ignoredRequest,
    ],
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
  const rows = all.filter((r): r is [string, string | number, number] => !!r);
  return (
    <div class="overlay">
      <div ref={ref} class="dialog" role="dialog" aria-modal="true" aria-labelledby="debrief-title">
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
          Step {session.lessonStep + 1} of {lesson.steps.length}
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
      <div class="dim" style="font-size:11.5px">
        {step.say ? 'Send it (Enter), then watch the aircraft. ' : ''}The next step appears by itself once
        it's done.
      </div>
    </div>
  );
}

/** Beginner command help: example phrases for the selected aircraft. */
/** Approach example phrases for the aircraft's state. */
/** Tower example phrases for the aircraft's state, in the standard form the feedback expects. */
export function towerTips(session: Session, ac: Readonly<Aircraft>): string[] {
  const ctx = session.parseContext(false);
  const say = (...cmds: Command[]) => canonicalTransmission(ac.callsign, cmds, ctx);
  const { landing, departure } = EHAM.config;
  // the middle exit: a sensible turn-off for a typical airliner (V3 on 18R)
  const exits = runwayById(EHAM, landing).exits ?? [];
  const mid = exits[Math.floor(exits.length / 2)];
  const vacate: Command = mid
    ? { type: 'vacate', exit: mid.name, side: mid.side === 'L' ? 'left' : 'right' }
    : { type: 'vacate' };
  const n = ac.nav;
  if (ac.kind === 'arrival') {
    if (isOnGround(ac))
      return [
        say(vacate, { type: 'handoff', to: 'ground' }),
        say({ type: 'expediteVacate' }),
        say({ type: 'handoff', to: 'ground' }),
      ];
    if (!ac.landClear)
      return [
        say({ type: 'land', runway: landing }),
        say({ type: 'continueApproach' }),
        say({ type: 'goAround' }),
      ];
    return [say(vacate, { type: 'handoff', to: 'ground' }), say({ type: 'goAround' })];
  }
  if (n.mode === 'holding' || (n.mode === 'taxi' && n.then === 'hold')) {
    // another departure on the runway: line up behind it (conditional), not onto it
    const ahead = session.sim.aircraft.find(
      (o) => o !== ac && o.kind === 'departure' && (o.nav.mode === 'lineup' || o.nav.mode === 'takeoff'),
    );
    if (ahead)
      return [
        say({
          type: 'lineUp',
          runway: departure,
          behind: { traffic: 'departing', desc: typeName(ahead.type) },
        }),
        say({ type: 'lineUp', runway: departure }),
      ];
    return [say({ type: 'lineUp', runway: departure }), say({ type: 'takeoff', runway: departure })];
  }
  if (n.mode === 'lineup' || n.mode === 'taxi')
    return [
      say({ type: 'takeoff', runway: departure }),
      say({ type: 'takeoff', runway: departure, immediate: true }),
      say({ type: 'cancelTakeoff' }),
    ];
  if (n.mode === 'takeoff') return [say({ type: 'cancelTakeoff' })];
  return [say({ type: 'handoff', to: 'departure' })];
}

export function HelpCard({ session, onInsert }: { session: Session; onInsert: (text: string) => void }) {
  const ac = session.selected;
  if (!ac || ac.comms !== session.mine) {
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
  let why: string | undefined;
  let tips: string[];
  if (session.tower) tips = towerTips(session, ac);
  else {
    const ctx = session.parseContext(false);
    const next = approachAdvice(ac, session.sim.env.landing, {
      contacted: session.wasContacted(ac.callsign),
      qnh: session.sim.qnh,
      transitionAltFt: EHAM.transitionAltitudeFt,
    });
    why = next.why;
    tips = next.say.map((cmds) => canonicalTransmission(ac.callsign, cmds, ctx));
  }
  return (
    <div class="help">
      <b>{why ? `Next for ${ac.callsign}` : 'Try saying'}</b>
      {why && <span>{why}</span>}
      {tips.slice(0, 4).map((t) => (
        <button type="button" onClick={() => onInsert(t)}>
          {t}
        </button>
      ))}
    </div>
  );
}
