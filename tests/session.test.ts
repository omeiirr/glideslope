import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { scenarioById } from '../src/game/scenarios';
import { Session } from '../src/game/session';
import { DEFAULT_SETTINGS } from '../src/game/settings';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

/** Advance wall clock and sim together until the frequency is quiet. */
async function settle(s: Session, ms = 15000) {
  for (let t = 0; t < ms; t += 100) {
    await vi.advanceTimersByTimeAsync(100);
    s.update(100);
  }
}

const tutorial = (id: string, settings = DEFAULT_SETTINGS) => new Session(scenarioById(id), settings);

test('typed command → readback → aircraft flies it', async () => {
  const s = tutorial('tut-heading');
  s.transmit('KLM1234, turn left heading 180', 'typed');
  await settle(s);
  const ac = s.sim.byCallsign('KLM1234')!;
  expect(ac.tgtHdg).toBe(180);
  expect(s.log.some((e) => e.kind === 'pilot' && e.text === 'Left heading 180, KLM1234')).toBe(true);
  expect(s.stats.phraseSum).toBe(100);
});

test('unknown callsign: no action, someone asks "say again"', async () => {
  const s = tutorial('tut-heading');
  s.transmit('Speedbird 999, turn left heading 180', 'typed');
  await settle(s);
  expect(s.sim.byCallsign('KLM1234')!.tgtHdg).toBe(270);
  expect(s.log.some((e) => e.kind === 'pilot' && /say again/i.test(e.text))).toBe(true);
});

test('Pro readback error: caught by repeating the correct value', async () => {
  const s = tutorial('tut-handoff', { ...DEFAULT_SETTINGS, readbackErrorRate: 1 });
  s.transmit('KLM1234, descend altitude 3000, QNH 1013', 'typed');
  await settle(s);
  expect(s.stats.readbackErrors).toBe(1);
  expect(s.sim.byCallsign('KLM1234')!.tgtAlt).not.toBe(3000); // flying the wrong value
  s.transmit('KLM1234, negative, descend altitude 3000', 'typed');
  await settle(s);
  expect(s.stats.readbackCaught).toBe(1);
  expect(s.sim.byCallsign('KLM1234')!.tgtAlt).toBe(3000);
});

test('Pro readback error: uncaught one is revealed only in the debrief', async () => {
  const s = tutorial('tut-handoff', { ...DEFAULT_SETTINGS, readbackErrorRate: 1 });
  s.transmit('KLM1234, turn right heading 240', 'typed');
  await settle(s);
  const entry = s.log.find((e) => e.kind === 'pilot');
  expect(entry).toMatchObject({ rb: 'hidden' });
  await settle(s, 60000);
  expect(entry).toMatchObject({ rb: 'missed' });
});

test('Pro: talking over a pilot blocks both transmissions', async () => {
  const s = tutorial('tut-handoff');
  s.transmit('KLM1234, turn right heading 240', 'typed');
  // run until the readback is on the air
  for (let i = 0; i < 50 && !s.radio.current; i++) {
    await vi.advanceTimersByTimeAsync(100);
    s.update(100);
  }
  expect(s.radio.current?.from).toBe('KLM1234');
  s.keyDown();
  expect(s.keyUp()).toBe(true);
  expect(s.log.some((e) => e.kind === 'system' && /talked over/.test(e.text))).toBe(true);
});
