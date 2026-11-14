import { readdirSync, readFileSync } from 'node:fs';
import { describe, expect, test } from 'vitest';
import { EHAM, type Command } from '../src/core';
import { parse, type AcContext } from '../src/phraseology/parser';

interface Case {
  input: string;
  expectedCallsign: string | null;
  expectedCommands: Command[];
  expectedIssues: string[];
  defaultCallsign?: string;
  /** Issues are not checked for this case (free-form input). */
  anyIssues?: boolean;
}

const dir = new URL('./phrases/', import.meta.url);
const fixture = JSON.parse(readFileSync(new URL('context.json', dir), 'utf8')) as {
  qnh: number;
  aircraft: AcContext[];
};
const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'));
const load = (f: string): Case[] =>
  readFileSync(new URL(f, dir), 'utf8')
    .split('\n')
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as Case);

function check(c: Case): string | null {
  const r = parse(c.input, {
    airport: EHAM,
    qnh: fixture.qnh,
    aircraft: fixture.aircraft,
    defaultCallsign: c.defaultCallsign,
  });
  const issues = r.issues
    .map((i) => i.rule)
    .filter((x) => x !== 'unknown-words')
    .sort();
  const got = { callsign: r.callsign, commands: r.commands, issues: c.anyIssues ? [] : issues };
  const want = {
    callsign: c.expectedCallsign,
    commands: c.expectedCommands,
    issues: c.anyIssues ? [] : [...c.expectedIssues].sort(),
  };
  return JSON.stringify(got) === JSON.stringify(want)
    ? null
    : `"${c.input}"\n   want ${JSON.stringify(want)}\n   got  ${JSON.stringify(got)}`;
}

describe('parser corpus', () => {
  const all = files.flatMap(load);
  test('has at least 400 cases', () => expect(all.length).toBeGreaterThanOrEqual(400));

  for (const f of files) {
    test(`${f}`, () => {
      const cases = load(f);
      const failures = cases.map(check).filter((x): x is string => x !== null);
      const rate = 1 - failures.length / cases.length;
      // Spec target is 95 %; the corpus is kept fully green so regressions are obvious.
      expect(failures.length, `${(rate * 100).toFixed(1)} % pass\n${failures.join('\n')}`).toBe(0);
    });
  }
});
