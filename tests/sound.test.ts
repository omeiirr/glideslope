import { expect, test } from 'vitest';
import { cutoffHz, doppler, loudest, loudness, thrustOf } from '../src/sound/model';

test('engine power follows the phase: take-off full, reverse on the rollout above 70 kt, idle taxiing', () => {
  expect(thrustOf({ phase: 'takeoff', ias: 120, onGround: true })).toEqual({ power: 1, reverse: false });
  expect(thrustOf({ phase: 'rollout', ias: 110, onGround: true }).reverse).toBe(true);
  expect(thrustOf({ phase: 'rollout', ias: 40, onGround: true }).reverse).toBe(false);
  expect(thrustOf({ phase: 'vacating', ias: 15, onGround: true }).power).toBeLessThan(0.2);
  expect(thrustOf({ phase: 'goaround', ias: 150, onGround: false }).power).toBeGreaterThan(0.8);
});

test('loudness: heavier and nearer is louder, halving per doubling of distance; far is muffled', () => {
  expect(loudness(1, 'H', 1000)).toBeGreaterThan(loudness(1, 'M', 1000));
  expect(loudness(1, 'M', 2000) / loudness(1, 'M', 1000)).toBeCloseTo(0.5, 5);
  expect(loudness(0.12, 'M', 500)).toBeLessThan(loudness(1, 'M', 3000));
  expect(cutoffHz(6000, 1)).toBeLessThan(cutoffHz(500, 1));
  expect(doppler(60)).toBeGreaterThan(1);
  expect(doppler(-60)).toBeLessThan(1);
});

test('only the loudest few get a voice, silent ones never', () => {
  const l = [0.1, 0.5, 0, 0.3, 0.2, 0.0001].map((level, id) => ({ id, level }));
  expect(loudest(l, 3).map((x) => x.id)).toEqual([1, 3, 4]);
  expect(loudest(l, 10).map((x) => x.id)).not.toContain(2);
});
