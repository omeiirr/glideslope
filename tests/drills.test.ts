import { expect, test } from 'vitest';
import { checkPhrase, modelAnswer, PHRASE_TASKS } from '../src/game/drills';

test.each(PHRASE_TASKS.map((t) => [t.prompt.slice(0, 50), t] as const))(
  'the model answer passes as correct ICAO: %s',
  (_, t) => {
    const r = checkPhrase(modelAnswer(t), t);
    expect(r, modelAnswer(t)).toMatchObject({ verdict: 'correct', notes: [] });
  },
);

test('loose wording is understood with a note; the wrong value or no callsign is wrong', () => {
  const descent = PHRASE_TASKS[1]!;
  expect(checkPhrase('KLM1426 descend to 3000 feet QNH 1013', descent).verdict).toBe('understood');
  expect(checkPhrase('KLM1426 descend altitude 4000 QNH 1013', descent).verdict).toBe('wrong');
  expect(checkPhrase('descend altitude 3000 QNH 1013', descent).verdict).toBe('wrong');
  const r = checkPhrase('KLM1426 descend altitude 3000', descent);
  expect(r.verdict).toBe('understood');
  expect(r.notes.join(' ')).toMatch(/QNH/);
});
