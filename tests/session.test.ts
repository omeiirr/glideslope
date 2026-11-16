import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { scenarioById } from '../src/game/scenarios';
import { Session } from '../src/game/session';
import { DEFAULT_SETTINGS } from '../src/game/settings';
import type { Scenario } from '../src/game/scenarios';

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

/** A tower scenario with only the aircraft given: KLM1200 6 NM out, plus `extra`. */
function towerSession(mode: 'beginner' | 'pro', extra: NonNullable<Scenario['spawns']> = []) {
  const base = scenarioById('tower-free');
  return new Session(
    {
      ...base,
      mode,
      seed: 5,
      traffic: { arrivalsPerHour: 0, departuresPerHour: 0 },
      spawns: [base.spawns![0]!, ...extra],
    },
    DEFAULT_SETTINGS,
  );
}
const DEP = { at: 0, kind: 'departure' as const, callsign: 'TRA6015', type: 'B738', route: 'LEKKO' };
const said = (s: Session, re: RegExp) => s.log.some((e) => e.kind === 'pilot' && re.test(e.text));
async function settleUntil(s: Session, done: () => boolean, maxS = 300) {
  for (let t = 0; t < maxS && !done(); t += 2) await settle(s, 2000);
}
/** Like a player: wait for a quiet frequency, then transmit (Pro blocks talking over a pilot). */
async function say(s: Session, text: string) {
  await settleUntil(s, () => !s.radio.current && !s.radio.waiting, 60);
  s.transmit(text, 'typed');
}

test('tower: arrival calls, cleared to land, vacates via V3 to Ground; departure lines up, goes, to Departure', async () => {
  const s = towerSession('pro', [DEP]);
  await settle(s, 10000);
  expect(s.station.name).toBe('Schiphol Tower');
  expect(said(s, /^Schiphol Tower, KLM1200, ILS 18R$/)).toBe(true);
  expect(said(s, /^Schiphol Tower, TRA6015, holding point S7E, ready for departure$/)).toBe(true);

  await say(s, 'KLM1200, runway 18R, wind 200 degrees 12 knots, cleared to land');
  await say(s, 'TRA6015, runway 24, line up and wait');
  await settle(s);
  expect(said(s, /^Runway 18R, cleared to land, KLM1200$/)).toBe(true);
  expect(said(s, /^Runway 24, line up and wait, TRA6015$/)).toBe(true);
  // "when vacated contact Ground", given on final
  await say(s, 'KLM1200, vacate left via V3, when vacated contact ground 121.800');
  await settle(s);
  expect(said(s, /^Vacate left via V3, Schiphol Ground 121.800, KLM1200$/)).toBe(true);

  const dep = s.sim.byCallsign('TRA6015')!;
  await settleUntil(s, () => dep.nav.mode === 'lineup' && dep.nav.ready);
  await say(s, 'TRA6015, runway 24, wind 200 degrees 12 knots, cleared for take-off');
  await settleUntil(s, () => dep.alt > 400);
  await say(s, 'TRA6015, contact departure 120.555');
  await settle(s);
  expect(dep.comms).toBe('departure');
  await settleUntil(s, () => !s.sim.byCallsign('KLM1200'));
  expect(s.stats).toMatchObject({
    landed: 1,
    departuresOut: 1,
    departed: 1,
    goArounds: 0,
    missedHandoffs: 0,
    runwayIncursions: 0,
  });
  // all standard phraseology
  expect(s.stats.phraseSum).toBe(100 * s.stats.transmissions);
});

test('tower Pro: no landing clearance means a go-around; missed handoffs to Ground and Departure', async () => {
  const s = towerSession('pro', [DEP]);
  await settleUntil(s, () => s.stats.goArounds > 0);
  expect(s.stats.goArounds).toBe(1);
  expect(s.log.some((e) => e.kind === 'system' && /no landing clearance/.test(e.text))).toBe(true);
  // the departure: take-off, never handed off
  await say(s, 'TRA6015, runway 24, wind 200 degrees 12 knots, cleared for take-off');
  await settleUntil(s, () => s.stats.missedHandoffs > 0);
  expect(s.stats.missedHandoffs).toBe(1);
  expect(s.stats.departuresOut).toBe(1);
  // the go-around comes back about 4 minutes later and calls again
  await settleUntil(
    s,
    () => s.log.filter((e) => e.kind === 'pilot' && /KLM1200, ILS 18R/.test(e.text)).length > 1,
    600,
  );
  await say(s, 'KLM1200, runway 18R, wind 200 degrees 12 knots, cleared to land');
  await settleUntil(s, () => s.stats.landed > 0 && !s.sim.byCallsign('KLM1200'), 600);
  // landed and vacated without "contact Ground"
  expect(s.stats.missedHandoffs).toBe(2);
  expect(s.stats.runwayIncursions).toBe(0);
});

test('tower: go-around with the runway free is noted; Beginner warns before a clearance onto an occupied runway', async () => {
  const s = towerSession('beginner', [
    { ...DEP },
    { at: 0, kind: 'departure', callsign: 'KLM1717', type: 'B738', route: 'LOPIK' },
  ]);
  await settle(s, 10000);
  await say(s, 'KLM1200, go around');
  await settle(s);
  expect(s.stats.unnecessaryGoArounds).toBe(1);
  await say(s, 'TRA6015, runway 24, line up and wait');
  await settle(s, 30000);
  expect(s.warning(s.hear('TRA6015, runway 24, cleared for take-off'))).toBeNull();
  // KLM1717 is next; with TRA6015 lined up, its take-off clearance gets a warning
  await settleUntil(s, () => s.sim.byCallsign('KLM1717')!.comms === 'tower');
  expect(s.warning(s.hear('KLM1717, runway 24, cleared for take-off'))).toBe('TRA6015 is still on runway 24');
  // half-said runways while still talking: no warning, no crash
  expect(s.warning(s.hear('KLM1717, cleared for take-off runway 2'))).toBeNull();
  expect(s.warning(s.hear('KLM1200, cleared to land runway 1'))).toBeNull();
});
