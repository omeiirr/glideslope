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
/** Lesson 5's Pro setup without the lesson (lessons switch readback errors off). */
const pro = (settings = DEFAULT_SETTINGS) =>
  new Session({ ...scenarioById('tut-handoff'), lesson: undefined }, settings);

test('typed command → readback → aircraft flies it', async () => {
  const s = tutorial('tut-heading');
  s.transmit('KLM1426, turn left heading 180', 'typed');
  await settle(s);
  const ac = s.sim.byCallsign('KLM1426')!;
  expect(ac.tgtHdg).toBe(180);
  expect(s.log.some((e) => e.kind === 'pilot' && e.text === 'Left heading 180, KLM1426')).toBe(true);
  expect(s.stats.phraseSum).toBe(100);
});

test('unknown callsign: no action, someone asks "say again"', async () => {
  const s = tutorial('tut-heading');
  s.transmit('Speedbird 999, turn left heading 180', 'typed');
  await settle(s);
  expect(s.sim.byCallsign('KLM1426')!.tgtHdg).toBe(270);
  expect(s.log.some((e) => e.kind === 'pilot' && /say again/i.test(e.text))).toBe(true);
});

test('Pro readback error: caught by repeating the correct value', async () => {
  const s = pro({ ...DEFAULT_SETTINGS, readbackErrorRate: 1 });
  s.transmit('KLM1426, descend altitude 3000, QNH 1013', 'typed');
  await settle(s);
  expect(s.stats.readbackErrors).toBe(1);
  expect(s.sim.byCallsign('KLM1426')!.tgtAlt).not.toBe(3000); // flying the wrong value
  s.transmit('KLM1426, negative, descend altitude 3000', 'typed');
  await settle(s);
  expect(s.stats.readbackCaught).toBe(1);
  expect(s.sim.byCallsign('KLM1426')!.tgtAlt).toBe(3000);
});

test('Pro readback error: uncaught one is revealed only in the debrief', async () => {
  const s = pro({ ...DEFAULT_SETTINGS, readbackErrorRate: 1 });
  s.transmit('KLM1426, turn right heading 240', 'typed');
  await settle(s);
  const entry = s.log.find((e) => e.kind === 'pilot');
  expect(entry).toMatchObject({ rb: 'hidden' });
  await settle(s, 60000);
  expect(entry).toMatchObject({ rb: 'missed' });
});

test('Pro: talking over a pilot blocks both transmissions', async () => {
  const s = pro();
  s.transmit('KLM1426, turn right heading 240', 'typed');
  // run until the readback is on the air
  for (let i = 0; i < 50 && !s.radio.current; i++) {
    await vi.advanceTimersByTimeAsync(100);
    s.update(100);
  }
  expect(s.radio.current?.from).toBe('KLM1426');
  s.keyDown();
  expect(s.keyUp()).toBe(true);
  expect(s.log.some((e) => e.kind === 'system' && /talked over/.test(e.text))).toBe(true);
});

test('lesson waits for the last readback to finish before ending', async () => {
  const s = tutorial('tut-heading');
  s.lessonStep = 2; // last step: proceed direct SPL
  s.transmit('KLM1426, proceed direct SPL', 'typed');
  let sawReadback = false;
  for (let i = 0; i < 200 && !s.finished; i++) {
    await vi.advanceTimersByTimeAsync(100);
    s.update(100);
    if (s.radio.current) {
      sawReadback = true;
      expect(s.finished).toBe(false);
    }
  }
  expect(sawReadback).toBe(true);
  expect(s.finished).toBe(true);
  expect(s.log.some((e) => e.kind === 'pilot' && e.text === 'Direct SPL, KLM1426')).toBe(true);
});

test('tower: arrival calls, cleared to land, vacates via V3 to Ground; departure lines up and goes', async () => {
  const base = scenarioById('tower-preview');
  const s = new Session(
    {
      ...base,
      traffic: { arrivalsPerHour: 0, departuresPerHour: 0 },
      spawns: [
        base.spawns![0]!,
        { at: 0, kind: 'departure', callsign: 'TRA6015', type: 'B738', route: 'LEKKO' },
      ],
    },
    DEFAULT_SETTINGS,
  );
  const arr = base.spawns![0]!.callsign!;
  const said = (re: RegExp) => s.log.some((e) => e.kind === 'pilot' && re.test(e.text));
  await settle(s, 10000);
  expect(s.station.name).toBe('Schiphol Tower');
  expect(said(new RegExp(`^Schiphol Tower, ${arr}, ILS 18R$`))).toBe(true);
  expect(said(/^Schiphol Tower, TRA6015, holding point S7E, ready for departure$/)).toBe(true);

  s.transmit(`${arr}, runway 18R, wind 200 degrees 12 knots, cleared to land`, 'typed');
  s.transmit('TRA6015, runway 24, line up and wait', 'typed');
  await settle(s);
  expect(said(new RegExp(`^Runway 18R, cleared to land, ${arr}$`))).toBe(true);
  expect(said(/^Runway 24, line up and wait, TRA6015$/)).toBe(true);
  expect(s.sim.byCallsign(arr)!.landClear).toBe(true);

  s.transmit(`${arr}, vacate left via V3`, 'typed');
  s.transmit('TRA6015, runway 24, wind 200 degrees 12 knots, cleared for take-off', 'typed');
  for (let i = 0; i < 40 && s.sim.byCallsign(arr)?.nav.mode !== 'rollout'; i++) await settle(s, 5000);
  expect(s.stats.landed).toBe(1);
  s.transmit(`${arr}, contact ground 121.800`, 'typed');
  await settle(s);
  expect(said(new RegExp(`^Schiphol Ground 121.800, ${arr}$`))).toBe(true);
  for (let i = 0; i < 20 && s.sim.byCallsign(arr); i++) await settle(s, 5000);
  expect(s.sim.byCallsign(arr)).toBeUndefined();

  const dep = s.sim.byCallsign('TRA6015')!;
  expect(dep.alt).toBeGreaterThan(500);
  s.transmit('TRA6015, contact departure 120.555', 'typed');
  await settle(s);
  expect(dep.comms).toBe('departure');
  expect(s.stats.goArounds).toBe(0);
  // all standard phraseology
  expect(s.stats.phraseSum).toBe(100 * s.stats.transmissions);
});

test('tower: no landing clearance means a go-around', async () => {
  const base = scenarioById('tower-preview');
  const s = new Session(
    { ...base, traffic: { arrivalsPerHour: 0, departuresPerHour: 0 }, spawns: [base.spawns![0]!] },
    DEFAULT_SETTINGS,
  );
  for (let i = 0; i < 40 && !s.stats.goArounds; i++) await settle(s, 5000);
  expect(s.stats.goArounds).toBe(1);
  expect(s.log.some((e) => e.kind === 'system' && /no landing clearance/.test(e.text))).toBe(true);
});
