import { expect, test } from 'vitest';
import { layoutLabels, type LabelIn } from '../src/render/tower3d/labels';

const view = { left: 0, top: 50, right: 800, bottom: 500 };
const label = (id: number, x: number, y: number, extra: Partial<LabelIn> = {}): LabelIn => ({
  id,
  x,
  y,
  w: 160,
  h: 34,
  priority: false,
  dist: id * 1000,
  ...extra,
});

test('labels: no two shown labels overlap, all inside the view', () => {
  // a cluster of aircraft close together on the final, plus one at the right edge
  const list = [
    ...Array.from({ length: 8 }, (_, i) => label(i + 1, 400 + i * 6, 300 + i * 4)),
    label(9, 795, 60),
  ];
  const out = layoutLabels(list, view);
  const shown = out.filter((o) => o.show);
  expect(shown.length).toBeGreaterThan(3);
  for (const o of shown) {
    expect(o.x).toBeGreaterThanOrEqual(view.left);
    expect(o.y).toBeGreaterThanOrEqual(view.top);
    expect(o.x + 160).toBeLessThanOrEqual(view.right);
    expect(o.y + 34).toBeLessThanOrEqual(view.bottom);
  }
  for (const a of shown)
    for (const b of shown)
      if (a !== b) expect(a.x < b.x + 160 && b.x < a.x + 160 && a.y < b.y + 34 && b.y < a.y + 34).toBe(false);
  // the edge aircraft's label moved to a spot that fits
  expect(out.find((o) => o.id === 9)!.show).toBe(true);
});

test('labels: the selected one is always shown and wins its preferred spot; a lone label goes above right', () => {
  const crowd = [label(1, 400, 300), label(2, 402, 301), label(3, 404, 302, { priority: true })];
  const out = layoutLabels(crowd, view);
  const sel = out.find((o) => o.id === 3)!;
  expect(sel).toMatchObject({ show: true, x: 412, y: 302 - 34 - 8 });
  expect(layoutLabels([label(1, 100, 300)], view)[0]).toMatchObject({ x: 108, y: 258, show: true });
  // selected but off the edge: pulled inside
  const edge = layoutLabels([label(1, 799, 52, { priority: true })], view)[0]!;
  expect(edge.show).toBe(true);
  expect(edge.x + 160).toBeLessThanOrEqual(800);
  expect(edge.y).toBeGreaterThanOrEqual(50);
});
