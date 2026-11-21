import { useMemo, useState } from 'preact/hooks';
import { EHAM } from '../core';
import { checkPhrase, drillContext, modelAnswer, PHRASE_TASKS, type DrillResult } from '../game/drills';
import { STUDENT } from '../game/scenarios';
import { controllerPhrase } from '../phraseology/phrases';
import { asrPrompt } from '../speech/prompt';
import type { VoiceInput } from '../speech/voiceInput';
import type { Say } from './learn';

const VERDICT: Record<DrillResult['verdict'], { icon: string; text: string; color: string }> = {
  correct: { icon: '✓', text: 'Correct ICAO', color: '#7AD7A8' },
  understood: { icon: '~', text: 'Understood, but not quite ICAO', color: '#F5B04C' },
  wrong: { icon: '✗', text: 'Not what was asked', color: '#FF8A8A' },
};

/** Learn → Practise phrases: one situation at a time, answered by voice or typing, checked by the parser. */
export function PhraseDrill({ say, voice }: { say: Say; voice?: VoiceInput }) {
  // a fresh order each time the page opens
  const order = useMemo(() => PHRASE_TASKS.map((_, i) => i).sort(() => Math.random() - 0.5), []);
  const [n, setN] = useState(0);
  const [text, setText] = useState('');
  const [result, setResult] = useState<DrillResult | null>(null);
  const [score, setScore] = useState({ correct: 0, done: 0 });
  const task = PHRASE_TASKS[order[n % order.length]!]!;
  const answer = controllerPhrase(STUDENT, task.want, { airport: EHAM, qnh: EHAM.qnh }, task.ac);

  const check = (said: string) => {
    if (!said.trim() || result) return;
    const r = checkPhrase(said, task);
    setResult(r);
    setScore((s) => ({ correct: s.correct + (r.verdict === 'correct' ? 1 : 0), done: s.done + 1 }));
  };
  const next = () => {
    setN((i) => i + 1);
    setText('');
    setResult(null);
  };
  const ready = voice && (voice.state.status === 'ready' || voice.state.status === 'recording');
  const talk = (down: boolean) => {
    if (!voice || result) return;
    if (down && voice.state.status === 'ready') {
      voice.prompt = asrPrompt(drillContext(task));
      voice.start();
    } else if (!down && voice.state.status === 'recording')
      void voice.stop().then((t) => {
        setText(t);
        check(t);
      });
  };
  const v = result && VERDICT[result.verdict];

  return (
    <div class="drill">
      <p>
        Say or type the instruction, starting with the callsign, as you would on the frequency. The game
        checks it the same way it checks you in a session.
      </p>
      <p class="dim">
        Task {n + 1} · {score.correct} of {score.done} correct ICAO
      </p>
      <p class="drill-task">{task.prompt}</p>
      <form
        class="drill-input"
        onSubmit={(e) => {
          e.preventDefault();
          if (result) next();
          else check(text);
        }}
      >
        <input
          type="text"
          class="mono"
          aria-label="Your instruction"
          placeholder={`${STUDENT}, …`}
          value={text}
          readOnly={!!result}
          onInput={(e) => setText((e.target as HTMLInputElement).value)}
        />
        {ready && !result && (
          <button
            type="button"
            class="btn"
            aria-pressed={voice.state.status === 'recording'}
            onPointerDown={() => talk(true)}
            onPointerUp={() => talk(false)}
            onPointerLeave={() => talk(false)}
            onKeyDown={(e) =>
              (e.key === ' ' || e.key === 'Enter') && !e.repeat && (e.preventDefault(), talk(true))
            }
            onKeyUp={(e) => (e.key === ' ' || e.key === 'Enter') && talk(false)}
          >
            {voice.state.status === 'recording' ? 'Listening…' : 'Hold to talk'}
          </button>
        )}
        <button type="submit" class="btn primary">
          {result ? 'Next' : 'Check'}
        </button>
      </form>
      {!ready && (
        <p class="dim">To answer by voice, turn voice input on first (the mic button on the game screen).</p>
      )}
      {result && v && (
        <div class="drill-result" role="status">
          <p style={{ color: v.color, fontWeight: 600 }}>
            <span aria-hidden="true">{v.icon}</span> {v.text}
          </p>
          {result.heard.length > 0 && (
            <p class="chips" aria-label="Understood as">
              {result.heard.map((h) => (
                <span class="chip">{h}</span>
              ))}
            </p>
          )}
          {result.verdict === 'understood' && (
            <ul>
              {result.notes.map((t) => (
                <li>{t}</li>
              ))}
            </ul>
          )}
          <div class="ex">
            <span class="ex-label">ICAO</span>
            <span class="mono">{modelAnswer(task)}</span>
            <button
              type="button"
              class="listen"
              aria-label={`Listen: ${answer.text}`}
              title="Listen"
              onClick={() => say(answer)}
            >
              ▶
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
