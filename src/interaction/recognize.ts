import simplify from 'simplify-js';
import { centerPoints, dist, newId, pointsBounds } from '../geometry';
import type { Pt, Shape } from '../types';

export type Recognized =
  | { type: 'square' | 'rectangle'; x: number; y: number; w: number; h: number }
  | { type: 'circle' | 'ellipse'; x: number; y: number; rx: number; ry: number }
  | { type: 'triangle'; x: number; y: number; points: Pt[] };

const MIN_DIAG = 30; // strokes smaller than this are never snapped
const CLOSE_GAP = 0.2; // start-to-end gap, as a fraction of the bbox diagonal
const ASPECT_EQUAL = 0.15; // w and h within 15% -> square / circle
const STRAIGHT_TURN = (32 * Math.PI) / 180; // turning angle below this is not a corner

/** Shoelace area of a closed polygon. */
function polygonArea(pts: Pt[]): number {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x1, y1] = pts[i];
    const [x2, y2] = pts[(i + 1) % pts.length];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

function turnAngle(prev: Pt, cur: Pt, next: Pt): number {
  const a1 = Math.atan2(cur[1] - prev[1], cur[0] - prev[0]);
  const a2 = Math.atan2(next[1] - cur[1], next[0] - cur[0]);
  let d = Math.abs(a2 - a1);
  if (d > Math.PI) d = 2 * Math.PI - d;
  return d;
}

/** Corners of a closed stroke: RDP, then drop near-duplicate and near-straight vertices cyclically. */
function corners(points: Pt[], diag: number): Pt[] {
  const simp = simplify(
    points.map(([x, y]) => ({ x, y })),
    Math.max(3, diag * 0.06),
    true,
  ).map((p) => [p.x, p.y] as Pt);
  let v = simp.slice();
  if (v.length > 1 && dist(v[0], v[v.length - 1]) < diag * CLOSE_GAP) v.pop();

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
function movingAverage(points: Pt[], radius: number): Pt[] {
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
function sharpestTurn(points: Pt[], span: number): number {
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

function nearlyEqual(a: number, b: number): boolean {
  return Math.abs(a - b) / Math.max(a, b) < ASPECT_EQUAL;
}

/**
 * Classifies a stroke as one of the five primitives, or null.
 * Prefers false negatives: anything ambiguous stays freehand.
 */
export function recognize(points: Pt[]): Recognized | null {
  if (points.length < 8) return null;
  const b = pointsBounds(points);
  const w = b.maxX - b.minX, h = b.maxY - b.minY;
  const diag = Math.hypot(w, h);
  if (diag < MIN_DIAG || Math.min(w, h) < diag * 0.12) return null; // too small or a line
  if (dist(points[0], points[points.length - 1]) > diag * CLOSE_GAP) return null; // not closed

  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  // Fill ratio separates the classes robustly: triangle ~0.5, ellipse ~0.79, rectangle ~1.
  const fill = polygonArea(points) / (w * h);
  if (fill > 1.1) return null; // traced over itself
  const c = corners(points, diag);

  if (c.length === 3 && fill > 0.3 && fill < 0.68) {
    const { cx: tx, cy: ty, local } = centerPoints(c);
    return { type: 'triangle', x: tx, y: ty, points: local };
  }

  if (c.length === 4 && fill >= 0.84) {
    const rightAngles = c.every((p, i) => {
      const t = turnAngle(c[(i + 3) % 4], p, c[(i + 1) % 4]);
      return Math.abs(t - Math.PI / 2) < (30 * Math.PI) / 180;
    });
    if (rightAngles) {
      if (nearlyEqual(w, h)) {
        const s = (w + h) / 2;
        return { type: 'square', x: cx, y: cy, w: s, h: s };
      }
      return { type: 'rectangle', x: cx, y: cy, w, h };
    }
  }

  if (fill >= 0.66 && fill <= 0.9) {
    // Mean deviation of each point from the bbox-inscribed ellipse.
    const rx = w / 2, ry = h / 2;
    let dev = 0;
    for (const [x, y] of points) dev += Math.abs(Math.hypot((x - cx) / rx, (y - cy) / ry) - 1);
    dev /= points.length;
    // An ellipse's narrow ends turn sharply too, so allow for its curvature there.
    const span = Math.max(10, diag * 0.08);
    const endTurn = (2 * span * Math.max(rx, ry)) / Math.min(rx, ry) ** 2;
    const limit = Math.max((55 * Math.PI) / 180, endTurn + (20 * Math.PI) / 180);
    const smooth = sharpestTurn(movingAverage(points, 2), span) < limit;
    if (dev < 0.11 && smooth) {
      if (nearlyEqual(w, h)) {
        const r = (rx + ry) / 2;
        return { type: 'circle', x: cx, y: cy, rx: r, ry: r };
      }
      return { type: 'ellipse', x: cx, y: cy, rx, ry };
    }
  }
  return null;
}

/** Turns a recognition result into a shape drawn in the stroke's style (outline, current color). */
export function shapeFromRecognized(r: Recognized, color: string): Shape {
  const common = {
    id: newId(),
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    fill: null,
    stroke: color,
    strokeWidth: 3,
  };
  return { ...common, ...r } as Shape;
}

/**
 * Hysteresis for the ghost preview: a new result (including "no match") is only shown
 * after it has been returned by `AGREE` consecutive checks, so the ghost does not flicker.
 */
export class GhostTracker {
  static AGREE = 3;
  shown: Recognized | null = null;
  private candidate: string | null = null;
  private count = 0;

  update(r: Recognized | null): Recognized | null {
    const type = r?.type ?? null;
    if (type === (this.shown?.type ?? null)) {
      this.candidate = null;
      this.count = 0;
      this.shown = r; // same type: follow the stroke's latest geometry
      return this.shown;
    }
    if (type === this.candidate) this.count++;
    else {
      this.candidate = type;
      this.count = 1;
    }
    if (this.count >= GhostTracker.AGREE) {
      this.shown = r;
      this.candidate = null;
      this.count = 0;
    }
    return this.shown;
  }
}
