/**
 * Pure stroke heuristics: closedness, corners, fill ratio, aspect ratio, direction.
 *
 * These were the freehand "snap to shape" classifier's building blocks. In the gesture pipeline they
 * only veto or refine what the Penny Pincher recognizer proposes; they never pick a different class.
 * No React or DOM code here, so it can be unit tested.
 */
import simplify from 'simplify-js';
import { dist, pointInPolygon, pointsBounds, type Bounds } from '../geometry';
import type { Pt } from '../types';

export { pointInPolygon };

/** Turning angle at a corner below this is not a corner. */
export const STRAIGHT_TURN = (32 * Math.PI) / 180;
/** w and h within this fraction of each other count as equal (square / circle). */
export const ASPECT_EQUAL = 0.15;

/**
 * Shoelace area of a closed polygon, signed. Screen coordinates have y pointing down, so a
 * clockwise loop *on screen* is positive here (the opposite of the math-class convention).
 */
export function signedArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

export function polygonArea(pts: Pt[]): number {
  return Math.abs(signedArea(pts));
}

/** Whether a loop runs clockwise as seen on screen (y down). */
export function isClockwise(pts: Pt[]): boolean {
  return signedArea(pts) > 0;
}

/** Shorter side over longer side of the bounds: 1 for a square box, near 0 for a line. */
export function aspectRatio(b: Bounds): number {
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const long = Math.max(w, h);
  return long === 0 ? 1 : Math.min(w, h) / long;
}

export function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(a, b) < ASPECT_EQUAL;
}

export function turnAngle(prev: Pt, cur: Pt, next: Pt): number {
  const a1 = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]);
  const a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** Corners of a closed stroke: RDP, then drop near-duplicate and near-straight vertices cyclically. */
export function corners(points: Pt[], diag: number, closeGap: number): Pt[] {
  const simp = simplify(
    points.map(([x, y]) => ({ x, y })),
    Math.max(3, diag * 0.06),
    true,
  ).map((p) => [p.x, p.y] as Pt);
  let v = simp.slice();
  if (v.length > 1 && dist(v[0], v[v.length - 1]) < diag * closeGap) v.pop();

  let changed = true;
  while (changed && v.length > 3) {
    changed = false;
    for (let i = 0; i < v.length; i++) {
      const prev = v[(i - 1 + v.length) % v.length];
      const next = v[(i + 1) % v.length];
      if (dist(prev, v[i]) < diag * 0.08 || turnAngle(prev, v[i], next) < STRAIGHT_TURN) {
        v.splice(i, 1);
        changed = true;
        break;
      }
    }
  }
  return v;
}

/** Light smoothing so sensor jitter is not mistaken for corners. */
export function movingAverage(points: Pt[], radius: number): Pt[] {
  return points.map((_, i) => {
    let sx = 0, sy = 0, n = 0;
    for (let k = Math.max(0, i - radius); k <= Math.min(points.length - 1, i + radius); k++) {
      sx += points[k][0];
      sy += points[k][1];
      n++;
    }
    return [sx / n, sy / n] as Pt;
  });
}

/**
 * Largest change of direction measured over chords of length `span` on each side of a point.
 * Smooth curves stay small; polygons spike at their corners.
 */
export function sharpestTurn(points: Pt[], span: number): number {
  let max = 0;
  let back = 0, ahead = 0;
  for (let i = 0; i < points.length; i++) {
    while (back < i && dist(points[back + 1], points[i]) >= span) back++;
    if (ahead < i) ahead = i;
    while (ahead < points.length - 1 && dist(points[ahead], points[i]) < span) ahead++;
    if (dist(points[back], points[i]) < span || dist(points[ahead], points[i]) < span) continue;
    max = Math.max(max, turnAngle(points[back], points[i], points[ahead]));
  }
  return max;
}

/**
 * Where a stroke closes: the point in its second half that comes closest to its start.
 * `gap` is how far short of the start it got; `overshoot` is how much stroke follows that point.
 */
export function closure(points: Pt[]): { end: number; gap: number; overshoot: number } {
  const cum = [0];
  for (let i = 1; i < points.length; i++) cum.push(cum[i - 1] + dist(points[i - 1], points[i]));
  const total = cum[cum.length - 1];
  let end = points.length - 1;
  let gap = Infinity;
  for (let i = points.length - 1; i > 0 && cum[i] >= total / 2; i--) {
    const d = dist(points[0], points[i]);
    if (d < gap) {
      gap = d;
      end = i;
    }
  }
  return { end, gap, overshoot: total - cum[end] };
}

/** The stroke up to its closing point (any overshoot dropped), with its closure and bounds. */
export function closedPart(stroke: Pt[]) {
  const close = closure(stroke);
  const points = stroke.slice(0, close.end + 1);
  const b = pointsBounds(points);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  return { close, points, b, w, h, diag: Math.hypot(w, h) };
}

/** Whether the stroke comes back within `gapFraction` of its bbox diagonal of where it started. */
export function isClosed(stroke: Pt[], gapFraction: number): boolean {
  if (stroke.length < 3) return false;
  const { close, diag } = closedPart(stroke);
  return diag > 0 && close.gap <= diag * gapFraction;
}

/** Polygon area over bbox area: triangle ~0.5, ellipse ~0.79, rectangle ~1. */
export function fillRatio(points: Pt[], w: number, h: number): number {
  return polygonArea(points) / (w * h);
}

/** Mean deviation of each point from the ellipse inscribed in the bounds, in units of the radii. */
export function ellipseDeviation(points: Pt[], cx: number, cy: number, rx: number, ry: number): number {
  let dev = 0;
  for (const [x, y] of points) dev += Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1);
  return dev / points.length;
}
