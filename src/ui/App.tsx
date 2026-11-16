import type { ComponentChild } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { SCENARIOS, type Scenario } from '../game/scenarios';
import { Session, type LogEntry } from '../game/session';
import { DEFAULT_SETTINGS, load, save, type Settings } from '../game/settings';
import { DEFAULT_DCB } from '../render/realistic/scope';
import { Tts } from '../speech/tts';
import { VoiceInput } from '../speech/voiceInput';
import { useSession } from './hooks';
import { Learn } from './learn';
import { Debrief, HelpCard, Menu, SettingsDialog, TutorialCard, type Progress } from './overlays';
import { PttBar, RadioPanel, Strips, TopBar } from './panels';
import { RealisticChrome, RealisticDcb } from './realistic';
import { ScopeView } from './ScopeView';
import { TowerView } from './TowerView';
import { asrPrompt } from '../speech/prompt';

export const APP_NAME = 'Vectors';
const RANGES = [40, 60, 20];
/** Learn screen voice: VCTK p225 (English, female), the clearest in a Whisper listening test (DECISIONS.md). */
const LEARN_VOICE = 6;

const isTextField = (el: EventTarget | null) =>
  el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement;

export function App() {
  const [settings, setSettings] = useState<Settings>(() => load('settings', DEFAULT_SETTINGS));
  const [progress, setProgress] = useState<Progress>(() => load('progress', { lessons: [], best: {} }));
  const [session, setSession] = useState<Session | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [showLearn, setShowLearn] = useState(false);
  const [draft, setDraft] = useState('');
  const [range, setRange] = useState(40);
  const [recenter, setRecenter] = useState(0);
  const [dcb, setDcb] = useState(DEFAULT_DCB);
  const [, bump] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const settingsRef = useRef(settings);
  settingsRef.current = settings;

  const voice = useMemo(() => new VoiceInput(), []);
  const tts = useMemo(() => new Tts(() => settingsRef.current), []);
  useEffect(() => {
    voice.onChange = tts.onChange = () => bump((v) => v + 1);
  }, [voice, tts]);

  const patch = (p: Partial<Settings>) => {
    const next = { ...settingsRef.current, ...p };
    setSettings(next);
    save('settings', next);
    if (session) session.settings = next;
    if (p.voice === true || (p.asr && next.voice)) {
      voice.disable();
      void voice.enable(next);
    } else if (p.voice === false) voice.disable();
    if (p.tts === 'piper') tts.unlock();
  };

  const start = (sc: Scenario) => {
    // Free play follows the rules chosen in settings.
    const scenario =
      sc.id === 'free'
        ? { ...sc, mode: settings.mode, traffic: { ...sc.traffic, arrivalsPerHour: settings.freeRate } }
        : sc;
    const s = new Session(scenario, settings);
    s.radio.speak = tts.speak;
    s.radio.prepare = tts.prepare;
    tts.unlock(); // we are inside a click: audio may start now
    if (settings.voice && voice.state.status === 'off') void voice.enable(settings);
    setDraft('');
    setSession(s);
  };

  const pttDown = () => {
    if (!session || voice.state.status !== 'ready') return;
    session.keyDown();
    voice.prompt = asrPrompt(session.parseContext(false));
    voice.start();
  };
  const pttUp = () => {
    if (!session || voice.state.status !== 'recording') return;
    const blocked = session.keyUp();
    void voice.stop().then((text) => {
      if (text) session.transmit(text, 'voice', blocked);
    });
  };
  const live = useRef({ pttDown, pttUp, session });
  live.current = { pttDown, pttUp, session };

  // Keyboard: PTT key (hold), Enter to type, Escape to deselect.
  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const { session: s, pttDown: d } = live.current;
      if (!s || s.finished || isTextField(e.target) || (e.target as Element).closest?.('.overlay')) return;
      if (e.code === settingsRef.current.pttKey) {
        // Space on a focused button would also click it: PTT wins.
        e.preventDefault();
        if (!e.repeat) d();
      } else if (e.key === 'Enter' && !(e.target instanceof HTMLButtonElement)) {
        e.preventDefault();
        inputRef.current?.focus();
      } else if (e.key === 'Escape') s.select(null);
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === settingsRef.current.pttKey) live.current.pttUp();
    };
    const blur = () => live.current.pttUp();
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  // Record results when a session ends.
  useEffect(() => {
    if (!session) return;
    return session.subscribe(() => {
      if (!session.finished) return;
      setProgress((p) => {
        const sc = session.scenario;
        const lessons = sc.lesson && !p.lessons.includes(sc.lesson) ? [...p.lessons, sc.lesson] : p.lessons;
        const best =
          sc.lesson || (p.best[sc.id] ?? -Infinity) >= session.score
            ? p.best
            : { ...p.best, [sc.id]: session.score };
        if (lessons === p.lessons && best === p.best) return p;
        const next = { lessons, best };
        save('progress', next);
        return next;
      });
    });
  }, [session]);

  // Learn pauses the game while open and restores the previous pause state on close.
  const wasPaused = useRef(false);
  const openLearn = () => {
    tts.unlock();
    wasPaused.current = !!session?.paused;
    session?.setPaused(true);
    setShowLearn(true);
  };
  const closeLearn = () => {
    setShowLearn(false);
    session?.setPaused(wasPaused.current);
  };
  const learn = showLearn && (
    <Learn
      onClose={closeLearn}
      say={(ph) => void tts.speak({ from: 'LEARN', voice: LEARN_VOICE, text: ph.text, speech: ph.speech })}
    />
  );

  const insert = (text: string) => {
    setDraft(text);
    inputRef.current?.focus();
  };

  if (!session) {
    return (
      <div class="app">
        <Menu
          progress={progress}
          onStart={start}
          onSettings={() => setShowSettings(true)}
          onLearn={openLearn}
        />
        {showSettings && (
          <SettingsDialog
            settings={settings}
            voice={voice.state}
            onChange={patch}
            onClose={() => setShowSettings(false)}
          />
        )}
        {learn}
      </div>
    );
  }
  return (
    <Game
      session={session}
      settings={settings}
      voice={voice}
      tts={tts}
      draft={draft}
      setDraft={setDraft}
      inputRef={inputRef}
      range={range}
      recenter={recenter}
      dcb={dcb}
      setDcb={setDcb}
      onCycleRange={() => {
        setRange(RANGES[(RANGES.indexOf(range) + 1) % RANGES.length]!);
        setRecenter((r) => r + 1);
      }}
      onRecenter={() => setRecenter((r) => r + 1)}
      patch={patch}
      pttDown={pttDown}
      pttUp={pttUp}
      insert={insert}
      showSettings={showSettings}
      setShowSettings={setShowSettings}
      onLearn={openLearn}
      learn={learn}
      onMenu={() => {
        session.finish();
        setSession(null);
      }}
      onAgain={() => start(session.scenario)}
      onNext={() => {
        const i = SCENARIOS.findIndex((s) => s.id === session.scenario.id);
        const next = SCENARIOS[i + 1];
        if (next?.lesson) start(next);
        else setSession(null);
      }}
    />
  );
}

interface GameProps {
  session: Session;
  settings: Settings;
  voice: VoiceInput;
  tts: Tts;
  draft: string;
  setDraft: (s: string) => void;
  inputRef: { current: HTMLInputElement | null };
  range: number;
  recenter: number;
  dcb: typeof DEFAULT_DCB;
  setDcb: (d: typeof DEFAULT_DCB) => void;
  onCycleRange: () => void;
  onRecenter: () => void;
  patch: (p: Partial<Settings>) => void;
  pttDown: () => void;
  pttUp: () => void;
  insert: (text: string) => void;
  showSettings: boolean;
  setShowSettings: (b: boolean) => void;
  onLearn: () => void;
  learn: ComponentChild;
  onMenu: () => void;
  onAgain: () => void;
  onNext: () => void;
}

function Game(p: GameProps) {
  const { session, settings } = p;
  useSession(session);
  const tower = session.scenario.view === 'tower';
  const realistic = settings.display === 'realistic' && !tower;
  const replay =
    settings.tts === 'off'
      ? undefined
      : (e: LogEntry) =>
          e.kind === 'pilot' && p.tts.replay({ from: e.callsign, text: e.text, speech: e.speech });
  const enableVoice = () => p.patch({ voice: true });
  const ptt = (
    <PttBar
      session={session}
      voice={p.voice.state}
      draft={p.draft}
      setDraft={p.setDraft}
      inputRef={p.inputRef}
      onPttDown={p.pttDown}
      onPttUp={p.pttUp}
      onEnableVoice={enableVoice}
    />
  );
  return (
    <div class={`app ${realistic ? 'realistic' : ''}`}>
      {realistic ? (
        <RealisticDcb
          session={session}
          range={p.range}
          dcb={p.dcb}
          setDcb={p.setDcb}
          onCycleRange={p.onCycleRange}
          onRecenter={p.onRecenter}
          onModern={() => p.patch({ display: 'modern' })}
          onSettings={() => p.setShowSettings(true)}
          onLearn={p.onLearn}
          onEnd={() => session.finish()}
        />
      ) : (
        <TopBar
          session={session}
          settings={settings}
          onDisplay={(d) => p.patch({ display: d })}
          onSettings={() => p.setShowSettings(true)}
          onLearn={p.onLearn}
          onEnd={() => session.finish()}
        />
      )}
      <div class="body">
        {!realistic && !tower && <Strips session={session} />}
        <main class={`scope ${tower ? 'tower-mode' : ''}`}>
          <h1 class="sr-only">
            {APP_NAME} · {session.scenario.name}
          </h1>
          {tower ? (
            <TowerView session={session} />
          ) : (
            <ScopeView
              session={session}
              realistic={realistic}
              dcb={p.dcb}
              range={p.range}
              recenter={p.recenter}
              onCycleRange={p.onCycleRange}
            />
          )}
          {realistic && (
            <RealisticChrome
              session={session}
              settings={settings}
              voice={p.voice.state}
              range={p.range}
              dcb={p.dcb}
            />
          )}
          {session.lesson && !session.finished && <TutorialCard session={session} onInsert={p.insert} />}
          {!realistic && !session.lesson && session.mode === 'beginner' && (
            <HelpCard session={session} onInsert={p.insert} />
          )}
          {session.paused && !session.finished && (
            <div class="paused" role="status">
              PAUSED
            </div>
          )}
          {p.tts.state.status === 'error' && settings.tts === 'piper' && (
            <div class="toast" role="alert">
              Pilot voices unavailable ({p.tts.state.message}). Using browser voices.
            </div>
          )}
          {p.tts.state.status === 'loading' && settings.tts === 'piper' && (
            <div class="toast" role="status">
              Downloading pilot voices… {Math.round(p.tts.state.progress * 100)} % (using browser voices
              meanwhile)
            </div>
          )}
        </main>
        {!realistic && <RadioPanel session={session} settings={settings} onReplay={replay} />}
      </div>
      {ptt}
      {session.finished && (
        <Debrief
          session={session}
          onMenu={p.onMenu}
          onAgain={p.onAgain}
          onNext={session.lesson ? p.onNext : undefined}
        />
      )}
      {p.showSettings && (
        <SettingsDialog
          settings={settings}
          voice={p.voice.state}
          onChange={p.patch}
          onClose={() => p.setShowSettings(false)}
        />
      )}
      {p.learn}
    </div>
  );
}
