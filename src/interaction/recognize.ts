import { centerPoints, newId, paint, pointsBounds } from '../geometry';
import { gestureFor } from '../gestures/gestureConfig';
import {
  closedPart,
  convexity,
  corners,
  ellipseDeviation,
  fillRatio,
  isClockwise,
  movingAverage,
  nearlyEqual,
  resampleBySpacing,
  sharpestTurn,
  turnAngle,
} from '../gestures/heuristics';
import { REJECT_THRESHOLD, rank, type Template } from '../gestures/recognizer';
import { templates as recorded } from '../gestures/templates';
import type { Pt, Shape } from '../types';

export type Recognized =
  | { type: 'square' | 'rectangle'; x: number; y: number; w: number; h: number }
  | { type: 'circle' | 'ellipse'; x: number; y: number; rx: number; ry: number }
  | { type: 'triangle'; x: number; y: number; points: Pt[] };

const MIN_DIAG = 30; // strokes smaller than this are never snapped
const CLOSE_GAP = 0.2; // how close the stroke must come back to its start, as a fraction of the bbox diagonal
const OVERSHOOT = 0.08; // how far it may run on past that closest point, as a fraction of the bbox diagonal
const ELLIPSE_DEVIATION = 0.16; // recorded circles reach 0.135; real rectangles get as low as 0.12
const MAX_OVAL_TILT = (30 * Math.PI) / 180; // an oval leaning further than this is diagonal, not a sloppy upright one
const LASSO_GAP = 0.3; // how close a lasso must come back to its start, as a fraction of the bbox diagonal
const LASSO_CONVEXITY = 0.8; // loop area over convex hull area: slight dents pass, bean shapes don't
const RIGHT_ANGLE_SLACK = (30 * Math.PI) / 180; // how far a rectangle's corners may be from 90°

/** True once a stroke has come back to its start and then run on too far past it. */
export function overshot(stroke: Pt[]): boolean {
  if (stroke.length < 8) return false;
  const { close, diag } = closedPart(stroke);
  return close.gap <= diag * CLOSE_GAP && close.overshoot > diag * OVERSHOOT;
}

type Loop = ReturnType<typeof closedPart>;

/** What the app makes of a stroke: the gesture, and for a shape gesture, the shape to create. */
export interface Interpretation {
  gesture: string;
  shape?: Recognized;
}

/**
 * The Penny Pincher recognizer proposes gestures, best first; the heuristics below may only veto a
 * proposal or refine it within its family (rectangle → square, circle → ellipse). A vetoed proposal
 * falls back to the next one that scored above the reject threshold, so the recognizer still decides
 * the order. Prefers false negatives: anything ambiguous stays freehand (null).
 */
export function interpret(stroke: Pt[], templates: readonly Template[] = recorded): Interpretation | null {
  let loop: Loop | null | undefined;
  for (const m of rank(stroke, templates)) {
    if (m.score < REJECT_THRESHOLD) break; // the rest score lower still
    const action = gestureFor(m.label)?.action;
    if (action?.kind === 'createShape') {
      loop ??= closedLoop(stroke);
      const shape = loop && SHAPES[action.family](loop);
      if (shape) return { gesture: m.label, shape };
    } else if (action?.kind === 'lasso') {
      if (isLasso(stroke)) return { gesture: m.label };
    } else return { gesture: m.label }; // the other gestures have no heuristics
  }
  return null;
}

/** The primitive a stroke turns into, or null if it isn't a shape gesture. */
export function recognize(stroke: Pt[], templates: readonly Template[] = recorded): Recognized | null {
  return interpret(stroke, templates)?.shape ?? null;
}

/** The gesture the app acts on for a stroke, or null if it stays freehand. */
export function gestureOf(stroke: Pt[], templates: readonly Template[] = recorded): string | null {
  return interpret(stroke, templates)?.gesture ?? null;
}

/**
 * A lasso is a closed counterclockwise loop that may wobble or have slight dents, but isn't
 * bean-shaped: templates can't cover freeform outlines, so deep dents are ruled out by definition.
 * Running on past the start is fine, since it doesn't change what the loop encloses.
 */
export function isLasso(stroke: Pt[]): boolean {
  const { close, points, diag } = closedPart(stroke);
  if (points.length < 8 || diag < MIN_DIAG) return false;
  if (close.gap > diag * LASSO_GAP) return false; // a selection needs no neat outline, but must close
  if (isClockwise(points)) return false;
  return convexity(points) >= LASSO_CONVEXITY;
}

/** The stroke without any overshoot, if it is big enough and closes like a shape should; else null. */
function closedLoop(stroke: Pt[]): Loop | null {
  const loop = closedPart(stroke);
  const { close, points, w, h, diag } = loop;
  if (points.length < 8) return null;
  if (diag < MIN_DIAG || Math.min(w, h) < diag * 0.12) return null; // too small or a line
  if (close.gap > diag * CLOSE_GAP) return null; // never came back near the start
  if (close.overshoot > diag * OVERSHOOT) return null; // ran on too far past it
  if (fillRatio(points, w, h) > 1.1) return null; // traced over itself
  return loop;
}

// Each check measures the stroke along its own axes or by its corners, not by its bounding box, so a
// slightly tilted shape passes as long as the recognizer accepted it. Rectangles and ellipses are
// always created upright (shapes don't rotate); triangles keep the tilt they were drawn with.
const SHAPES: Record<'rectangle' | 'circle' | 'triangle', (loop: Loop) => Recognized | null> = {
  rectangle({ points, diag }) {
    const c = corners(points, diag, CLOSE_GAP);
    if (c.length !== 4) return null;
    const rightAngles = c.every((p, i) => Math.abs(turnAngle(c[(i + 3) % 4], p, c[(i + 1) % 4]) - Math.PI / 2) < RIGHT_ANGLE_SLACK);
    if (!rightAngles) return null;
    const { x, y, w, h } = untilted(points, rectangleTilt(c));
    if (nearlyEqual(w, h)) {
      const s = (w + h) / 2;
      return { type: 'square', x, y, w: s, h: s };
    }
    return { type: 'rectangle', x, y, w, h };
  },

  triangle({ points, diag }) {
    const c = corners(points, diag, CLOSE_GAP);
    if (c.length !== 3) return null;
    const { cx, cy, local } = centerPoints(c); // kept as drawn, tilt included
    return { type: 'triangle', x: cx, y: cy, points: local };
  },

  circle({ points, diag, w: bw, h: bh }) {
    // A rectangle or triangle with rounded corners can be as close to an ellipse as a lopsided
    // circle, but its corners still count as 3 or 4. Recorded circles find 6 or more.
    const n = corners(points, diag, CLOSE_GAP).length;
    if (n === 3 || n === 4) return null;
    // Hand-drawn circles often come out slightly egg-shaped along a diagonal, so a stroke whose
    // bounding box is about square is judged as a circle in that box. Only a clear oval is measured
    // along its own axes; a long oval on a diagonal is far from its box's circle and fails below.
    const tilt = nearlyEqual(bw, bh) ? 0 : ovalTilt(points, diag);
    if (Math.abs(tilt) > MAX_OVAL_TILT) return null; // a diagonal oval, which shapes can't be
    const { pts, b, x, y, w, h } = untilted(points, tilt);
    const round = nearlyEqual(w, h);
    const rx = w / 2, ry = h / 2;
    // Mean deviation of each point from the inscribed ellipse: loose, since corners are checked above.
    if (ellipseDeviation(pts, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, rx, ry) >= ELLIPSE_DEVIATION) return null;
    // An ellipse's narrow ends turn sharply too, so allow for its curvature there.
    const span = Math.max(10, diag * 0.08);
    const endTurn = (2 * span * Math.max(rx, ry)) / Math.min(rx, ry) ** 2;
    const limit = Math.max((55 * Math.PI) / 180, endTurn + (20 * Math.PI) / 180);
    if (sharpestTurn(movingAverage(points, 2), span) >= limit) return null; // has a corner
    if (round) {
      const r = (rx + ry) / 2;
      return { type: 'circle', x, y, rx: r, ry: r };
    }
    return { type: 'ellipse', x, y, rx, ry };
  },
};

/** A tilt angle folded into ±45°: how far the nearest axis is from horizontal or vertical. */
const fold = (a: number) => a - (Math.PI / 2) * Math.round(a / (Math.PI / 2));

/** A rectangle's tilt: the average direction of its edges, weighted by length. */
function rectangleTilt(c: Pt[]): number {
  // Edges 90° apart point the same way at 4× their angle, so averaging there gives the tilt.
  let sx = 0, sy = 0;
  for (let i = 0; i < c.length; i++) {
    const [a, b] = [c[i], c[(i + 1) % c.length]];
    const t = 4 * Math.atan2(b[1] - a[1], b[0] - a[0]);
    const len = Math.hypot(b[0] - a[0], b[1] - a[1]);
    sx += Math.cos(t) * len;
    sy += Math.sin(t) * len;
  }
  return Math.atan2(sy, sx) / 4;
}

/** An oval's tilt: the direction of its long axis, from the spread of points evenly spaced along it. */
function ovalTilt(points: Pt[], diag: number): number {
  const pts = resampleBySpacing(points, diag / 100); // even spacing, so slow stretches don't count extra
  let mx = 0, my = 0;
  for (const [x, y] of pts) {
    mx += x / pts.length;
    my += y / pts.length;
  }
  let sxx = 0, syy = 0, sxy = 0;
  for (const [x, y] of pts) {
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
    sxy += (x - mx) * (y - my);
  }
  return fold(Math.atan2(2 * sxy, sxx - syy) / 2);
}

/**
 * The stroke turned back by `tilt` so its axes are horizontal and vertical, with its bounds there,
 * its size, and the middle of those bounds turned back to where the stroke was drawn.
 */
function untilted(points: Pt[], tilt: number) {
  const cos = Math.cos(-tilt), sin = Math.sin(-tilt);
  const pts = points.map(([px, py]) => [px * cos - py * sin, px * sin + py * cos] as Pt);
  const b = pointsBounds(pts);
  const mx = (b.minX + b.maxX) / 2, my = (b.minY + b.maxY) / 2;
  return { pts, b, x: mx * cos + my * sin, y: -mx * sin + my * cos, w: b.maxX - b.minX, h: b.maxY - b.minY };
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
