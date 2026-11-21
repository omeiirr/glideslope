import { expect, test } from 'vitest';
import { AutoQuality } from '../src/render/tower3d/quality';

const feed = (a: AutoQuality, ms: number, n: number) => {
  for (let i = 0; i < n; i++) a.frame(ms);
};

test('Auto keeps High when frames are fast', () => {
  const a = new AutoQuality();
  feed(a, 16.7, 200);
  expect(a).toMatchObject({ level: 'high', done: true });
});

test('Auto steps down while slow, then settles', () => {
  const a = new AutoQuality();
  feed(a, 40, 150); // warm-up + one measurement
  expect(a.level).toBe('medium');
  feed(a, 18, 150);
  expect(a).toMatchObject({ level: 'medium', done: true });
});

test('Auto stops at Low and ignores hidden-tab gaps', () => {
  const a = new AutoQuality();
  feed(a, 1000, 500);
  expect(a.level).toBe('high');
  feed(a, 50, 600);
  expect(a).toMatchObject({ level: 'low', done: true });
});
