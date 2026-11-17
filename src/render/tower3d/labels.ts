/**
 * Where to put the aircraft labels in the tower window so they don't overlap each other or run off the
 * view. Greedy: the selected aircraft first, then the nearest; each label tries a few spots around its
 * aircraft and takes the first free one. No DOM (runs in tests).
 */

export interface LabelIn {
  id: number;
  /** Aircraft on screen (CSS px). */
  x: number;
  y: number;
  w: number;
  h: number;
  /** Placed first (the selected aircraft). */
  priority: boolean;
  /** Metres from the eye: nearer aircraft are placed before farther ones. */
  dist: number;
}

export interface LabelOut {
  id: number;
  /** Top-left corner of the label (CSS px). */
  x: number;
  y: number;
  /** False when no free spot was found (the selected label is always shown). */
  show: boolean;
}

export interface Bounds {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

const GAP = 8;

/** Spots around the aircraft, preferred first: above right, above left, below right, below left, higher up. */
function spots(l: LabelIn): [number, number][] {
  const { x, y, w, h } = l;
  return [
    [x + GAP, y - h - GAP],
    [x - w - GAP, y - h - GAP],
    [x + GAP, y + GAP],
    [x - w - GAP, y + GAP],
    [x + GAP, y - 2 * h - 2 * GAP],
    [x - w - GAP, y - 2 * h - 2 * GAP],
  ];
}

type Box = { x: number; y: number; w: number; h: number };
const overlaps = (a: Box, b: Box) => a.x < b.x + b.w && b.x < a.x + a.w && a.y < b.y + b.h && b.y < a.y + a.h;
const inside = (a: Box, v: Bounds) =>
  a.x >= v.left && a.y >= v.top && a.x + a.w <= v.right && a.y + a.h <= v.bottom;

export function layoutLabels(list: LabelIn[], view: Bounds): LabelOut[] {
  const order = [...list].sort((a, b) => Number(b.priority) - Number(a.priority) || a.dist - b.dist);
  const placed: Box[] = [];
  const out = new Map<number, LabelOut>();
  for (const l of order) {
    let spot: [number, number] | undefined;
    for (const [x, y] of spots(l)) {
      const box = { x, y, w: l.w, h: l.h };
      if (inside(box, view) && !placed.some((p) => overlaps(box, p))) {
        spot = [x, y];
        break;
      }
    }
    if (!spot && l.priority) {
      // the selected label is always shown: first spot, pulled inside the view
      const [x, y] = spots(l)[0]!;
      spot = [
        Math.min(Math.max(x, view.left), view.right - l.w),
        Math.min(Math.max(y, view.top), view.bottom - l.h),
      ];
    }
    if (spot) placed.push({ x: spot[0], y: spot[1], w: l.w, h: l.h });
    out.set(l.id, { id: l.id, x: spot?.[0] ?? 0, y: spot?.[1] ?? 0, show: !!spot });
  }
  return list.map((l) => out.get(l.id)!);
}
