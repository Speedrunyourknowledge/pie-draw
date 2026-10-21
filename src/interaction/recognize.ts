import { centerPoints, newId, paint } from '../geometry';
import {
  closedPart,
  corners,
  ellipseDeviation,
  fillRatio,
  movingAverage,
  nearlyEqual,
  sharpestTurn,
  turnAngle,
} from '../gestures/heuristics';
import type { Pt, Shape } from '../types';

export type Recognized =
  | { type: 'square' | 'rectangle'; x: number; y: number; w: number; h: number }
  | { type: 'circle' | 'ellipse'; x: number; y: number; rx: number; ry: number }
  | { type: 'triangle'; x: number; y: number; points: Pt[] };

const MIN_DIAG = 30; // strokes smaller than this are never snapped
const CLOSE_GAP = 0.2; // how close the stroke must come back to its start, as a fraction of the bbox diagonal
const OVERSHOOT = 0.08; // how far it may run on past that closest point, as a fraction of the bbox diagonal

/** True once a stroke has come back to its start and then run on too far past it. */
export function overshot(stroke: Pt[]): boolean {
  if (stroke.length < 8) return false;
  const { close, diag } = closedPart(stroke);
  return close.gap <= diag * CLOSE_GAP && close.overshoot > diag * OVERSHOOT;
}

/**
 * Classifies a stroke as one of the five primitives, or null.
 * Prefers false negatives: anything ambiguous stays freehand.
 */
export function recognize(stroke: Pt[]): Recognized | null {
  if (stroke.length < 8) return null;
  // Judge the shape without any overshoot past the closing point.
  const { close, points, b, w, h, diag } = closedPart(stroke);
  if (points.length < 8) return null;
  if (diag < MIN_DIAG || Math.min(w, h) < diag * 0.12) return null; // too small or a line
  if (close.gap > diag * CLOSE_GAP) return null; // never came back near the start
  if (close.overshoot > diag * OVERSHOOT) return null; // ran on too far past it

  const cx = (b.minX + b.maxX) / 2, cy = (b.minY + b.maxY) / 2;
  // Fill ratio separates the classes robustly: triangle ~0.5, ellipse ~0.79, rectangle ~1.
  const fill = fillRatio(points, w, h);
  if (fill > 1.1) return null; // traced over itself
  const c = corners(points, diag, CLOSE_GAP);

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
    const dev = ellipseDeviation(points, cx, cy, rx, ry);
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

/** Turns a recognition result into a shape in the current line color and fill. */
export function shapeFromRecognized(r: Recognized, color: string, fill: string | null): Shape {
  const common = {
    id: newId(),
    scaleX: 1,
    scaleY: 1,
    rotation: 0,
    ...paint(color, fill),
  };
  return { ...common, ...r } as Shape;
}

/**
 * Hysteresis for the ghost preview: once a ghost is up, a different result (including
 * "no match") only replaces it after `AGREE` consecutive checks, so it does not flicker.
 * The first match shows immediately, and keeps its geometry while the type holds.
 * Overshoot skips this via `clear()`.
 */
export class GhostTracker {
  static AGREE = 3;
  shown: Recognized | null = null;
  private candidate: string | null = null;
  private count = 0;

  /** Drops the ghost at once, e.g. on overshoot, which only gets worse as the stroke goes on. */
  clear(): null {
    this.shown = null;
    this.candidate = null;
    this.count = 0;
    return null;
  }

  update(r: Recognized | null): Recognized | null {
    const type = r?.type ?? null;
    if (type === (this.shown?.type ?? null)) {
      this.candidate = null;
      this.count = 0;
      return this.shown; // same type: keep the geometry it first appeared with
    }
    if (!this.shown) {
      // Appear at once: a stroke may only match as it closes, right before release,
      // and the shape it snaps to should never arrive unannounced.
      this.shown = r;
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
