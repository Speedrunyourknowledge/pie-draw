import { describe, expect, it } from 'vitest';
import holdoutData from '../gestures/holdout.json';
import { parseTemplateFile, sampleTemplates } from '../gestures/templates';
import type { Pt } from '../types';
import { gestureOf, isCaret, isLasso, isSlash, recognize } from './recognize';

/** A closed polyline through the corners with `per` points on each edge. */
function loop(corners: Pt[], per = 20): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < corners.length; i++) {
    const [a, b] = [corners[i], corners[(i + 1) % corners.length]];
    for (let k = 0; k < per; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / per, a[1] + ((b[1] - a[1]) * k) / per]);
  }
  pts.push(corners[0]);
  return pts;
}
/** A clockwise oval centered on the origin, starting at its left end. */
const oval = (rx: number, ry: number): Pt[] =>
  Array.from({ length: 61 }, (_, i) => [rx * Math.cos(Math.PI + (i * Math.PI) / 30), ry * Math.sin(Math.PI + (i * Math.PI) / 30)] as Pt);
const turn = (pts: Pt[], deg: number): Pt[] => {
  const a = (deg * Math.PI) / 180;
  return pts.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as Pt);
};

describe('recognize, on held-out strokes', () => {
  // holdout.json holds strokes recorded alongside templates.json but never used as templates, so
  // this is how the app treats new strokes. A failure means a heuristic is too strict for real
  // strokes, or the templates have too few strokes like this one.
  const holdout = parseTemplateFile(holdoutData).samples;

  it.each(holdout.map((s, i) => [s.label, i, s] as const))('%s stroke %i', (label, _i, s) => {
    expect(gestureOf(s.points)).toBe(label);
  });
});

describe('recognize, with heuristics', () => {
  // Templates from clean shapes, so these tests don't move when samples are re-recorded.
  const clean = [
    { label: 'rectangle', points: loop([[0, 100], [0, 0], [160, 0], [160, 100]]) },
    { label: 'triangle', points: loop([[0, 100], [60, 0], [120, 100]]) },
    { label: 'circle', points: oval(60, 60) },
    { label: 'circle', points: oval(80, 40) },
  ].flatMap((s) => sampleTemplates(s));

  it('measures a slightly tilted rectangle along its edges', () => {
    const r = recognize(turn(loop([[0, 100], [0, 0], [160, 0], [160, 100]]), 10), clean);
    expect(r?.type).toBe('rectangle');
    if (r?.type !== 'rectangle') return;
    expect(r.w).toBeCloseTo(160, -1);
    expect(r.h).toBeCloseTo(100, -1);
  });

  it('snaps a near-square to a square', () => {
    expect(recognize(loop([[0, 100], [0, 0], [105, 0], [105, 100]]), clean)?.type).toBe('square');
  });

  it('keeps a triangle as drawn, pointing any way', () => {
    const r = recognize(turn(loop([[0, 100], [60, 0], [120, 100]]), 180), clean);
    expect(r?.type).toBe('triangle');
  });

  it('measures a slightly tilted oval along its own axes', () => {
    const r = recognize(turn(oval(80, 40), 15), clean);
    expect(r?.type).toBe('ellipse');
    if (r?.type !== 'ellipse') return;
    expect(r.x).toBeCloseTo(0, 0);
    expect(r.y).toBeCloseTo(0, 0);
    expect(r.rx).toBeCloseTo(80, -1);
    expect(r.ry).toBeCloseTo(40, -1);
  });

  it('takes a slightly egg-shaped circle on a diagonal as a circle, and rejects a diagonal oval', () => {
    expect(recognize(turn(oval(66, 54), 45), clean)?.type).toBe('circle');
    expect(recognize(turn(oval(80, 40), 45), clean)).toBeNull();
  });

  it('falls back when the best proposal is vetoed', () => {
    // A right triangle shares two sides with a rectangle. Even with only rectangle templates
    // above the threshold, its 3 corners veto rectangle, and nothing else is left.
    const right = loop([[0, 100], [0, 0], [140, 100]]);
    const rectOnly = clean.filter((t) => t.label === 'rectangle');
    expect(recognize(right, rectOnly)).toBeNull();
    expect(recognize(right, clean)?.type).toBe('triangle');
  });

  it('rejects strokes that never close, run on, or are tiny', () => {
    const rect = loop([[0, 100], [0, 0], [160, 0], [160, 100]]);
    expect(recognize(rect.slice(0, 60), clean)).toBeNull(); // three sides only
    expect(recognize(rect.map(([x, y]) => [x / 10, y / 10] as Pt), clean)).toBeNull();
  });
});

describe('lasso', () => {
  // Counterclockwise on screen: a polar outline r(θ) walked with θ decreasing (y points down).
  const ccw = (r: (t: number) => number, turns = 1): Pt[] =>
    Array.from({ length: Math.round(80 * turns) + 1 }, (_, i) => {
      const t = (-i * 2 * Math.PI) / 80;
      return [r(t) * Math.cos(t), r(t) * Math.sin(t)] as Pt;
    });
  const round = ccw(() => 80);
  const wobbly = ccw((t) => 80 + 6 * Math.sin(5 * t));
  const bean = ccw((t) => 80 * (1 - 0.6 * Math.cos(2 * t) ** 2) + 10); // pinched in deeply on two sides

  it('takes closed counterclockwise loops, wobbles included', () => {
    expect(isLasso(round)).toBe(true);
    expect(isLasso(wobbly)).toBe(true);
  });

  it('rejects clockwise, open and bean-shaped loops', () => {
    expect(isLasso(round.slice().reverse())).toBe(false);
    expect(isLasso(round.slice(0, 55))).toBe(false); // stops well short of the start
    expect(isLasso(bean)).toBe(false);
  });

  it('vetoes a bean even when the recognizer matches it exactly', () => {
    const templates = sampleTemplates({ label: 'lasso', points: bean });
    expect(gestureOf(bean, templates)).toBeNull();
    expect(gestureOf(round, sampleTemplates({ label: 'lasso', points: round }))).toBe('lasso');
  });
});


describe('cut and paste', () => {
  const line = (a: Pt, b: Pt): Pt[] => Array.from({ length: 40 }, (_, i) => [a[0] + ((b[0] - a[0]) * i) / 39, a[1] + ((b[1] - a[1]) * i) / 39] as Pt);
  /** A line `deg` degrees above horizontal, drawn to the right. */
  const slant = (deg: number) => line([0, 0], [200 * Math.cos((deg * Math.PI) / 180), -200 * Math.sin((deg * Math.PI) / 180)]);

  it('takes a forward slash, drawn either way, as a cut', () => {
    expect(isSlash(slant(45))).toBe(true);
    expect(isSlash(slant(45).reverse())).toBe(true);
  });

  it('leaves flat, upright, backward and tiny lines alone', () => {
    expect(isSlash(slant(5))).toBe(false);
    expect(isSlash(slant(88))).toBe(false);
    expect(isSlash(slant(-45))).toBe(false);
    expect(isSlash(line([0, 0], [10, -10]))).toBe(false);
  });

  it('takes a V as a caret but not a rounded U', () => {
    const v = [...line([0, 0], [80, 160]), ...line([80, 160], [160, 0])];
    const u = Array.from({ length: 60 }, (_, i) => [80 - 80 * Math.cos((i * Math.PI) / 59), 80 * Math.sin((i * Math.PI) / 59)] as Pt);
    expect(isCaret(v)).toBe(true);
    expect(isCaret(u)).toBe(false);
  });
});
