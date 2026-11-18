import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { SCENARIOS } from '../src/game/scenarios';
import { Session } from '../src/game/session';
import { DEFAULT_SETTINGS } from '../src/game/settings';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const tick = async (s: Session) => {
  await vi.advanceTimersByTimeAsync(250);
  s.update(250);
};

for (const sc of SCENARIOS.filter((x) => x.lesson)) {
  test(`lesson ${sc.name} can be completed by following its instructions`, async () => {
    // readback errors forced on: lessons must ignore them
    const s = new Session(sc, { ...DEFAULT_SETTINGS, readbackErrorRate: 1 });
    s.setSpeed(4);
    let lastStep = -1;
    for (let i = 0; i < 4000 && !s.finished; i++) {
      const step = s.lesson!.steps[s.lessonStep];
      if (step && s.lessonStep !== lastStep) {
        lastStep = s.lessonStep;
        // a slow reader: 20 s of sim time before answering
        for (let k = 0; k < 20; k++) await tick(s);
        // and, like a player, never over a pilot (Pro blocks it); radio calls take real time even at 4×
        for (let k = 0; k < 200 && (s.radio.current || s.radio.waiting); k++) await tick(s);
        if (step.say) s.transmit(step.say, 'typed');
      }
      await tick(s);
    }
    expect(s.finished, `stuck at step ${s.lessonStep + 1}: ${s.lesson!.steps[s.lessonStep]?.text}`).toBe(
      true,
    );
    expect(s.stats.readbackErrors).toBe(0);
    expect(s.stats.separationLosses).toBe(0);
    // tower lessons: no automatic go-around (the lesson's own needs the player's "go around"), none needless
    if (sc.view === 'tower') {
      expect(s.log.some((e) => e.kind === 'system' && /no landing clearance/.test(e.text))).toBe(false);
      expect(s.stats.unnecessaryGoArounds).toBe(0);
    }
  });
}

for (const sc of SCENARIOS.filter((x) => !x.lesson && x.durationMin)) {
  test(`${sc.name} runs to the end with no input`, () => {
    const s = new Session(sc, DEFAULT_SETTINGS);
    s.setSpeed(8);
    for (let i = 0; i < sc.durationMin * 60 * 4 && !s.finished; i++) s.update(250 / 8 + 0.01);
    expect(s.finished).toBe(true);
    // tower: with nobody in the tower, every arrival goes around
    expect(s.stats.landed + s.stats.leftAirspace + s.stats.goArounds).toBeGreaterThan(0);
  });
}
