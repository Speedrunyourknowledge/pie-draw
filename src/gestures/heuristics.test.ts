import { describe, expect, it } from 'vitest';
import { makePrimitive, shapeNearPoint } from '../geometry';
import type { Pt } from '../types';
import { SCRIBBLE_CUSPS, cuspCount, isScribble } from './heuristics';

/** A polyline through the corners with `per` points on each edge. */
function polyline(corners: Pt[], per = 15): Pt[] {
  const pts: Pt[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [a, b] = [corners[i], corners[i + 1]];
    for (let k = 0; k < per; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / per, a[1] + ((b[1] - a[1]) * k) / per]);
  }
  pts.push(corners[corners.length - 1]);
  return pts;
}
/** Back-and-forth strokes `w` wide, drifting down by `dy` per pass. */
const zigzag = (passes: number, w = 80, dy = 8): Pt[] =>
  polyline(Array.from({ length: passes + 1 }, (_, i) => [i % 2 ? w : 0, i * dy] as Pt));
const circle = (r: number): Pt[] =>
  Array.from({ length: 61 }, (_, i) => [r * Math.cos((2 * Math.PI * i) / 60), r * Math.sin((2 * Math.PI * i) / 60)] as Pt);

describe('scribble', () => {
  const span = 10;

  it('counts each reversal of a zigzag once', () => {
    expect(cuspCount(zigzag(6), span)).toBe(5);
    expect(isScribble(zigzag(6), span)).toBe(true);
  });

  it('does not count shape corners or curves as a scribble', () => {
    const rect = polyline([[0, 0], [120, 0], [120, 80], [0, 80], [0, 0]]);
    const triangle = polyline([[60, 0], [120, 100], [0, 100], [60, 0]]);
    const thin = polyline([[50, 0], [70, 150], [30, 150], [50, 0]]); // sharp corners, still only 3
    expect(cuspCount(rect, span)).toBe(0);
    expect(cuspCount(triangle, span)).toBeLessThan(SCRIBBLE_CUSPS);
    expect(cuspCount(thin, span)).toBeLessThan(SCRIBBLE_CUSPS);
    expect(cuspCount(circle(60), span)).toBe(0);
  });

  it('ignores jitter smaller than the span', () => {
    const wobbly = polyline([[0, 0], [200, 0]], 100).map(([x, y], i) => [x, y + (i % 2 ? 1.5 : -1.5)] as Pt);
    expect(cuspCount(wobbly, span)).toBe(0);
  });
});

describe('shapeNearPoint', () => {
  it('hits the inside and a margin around a shape, and nothing beyond', () => {
    const rect = makePrimitive('rectangle', 100, 100, '#000', null); // 180 × 110: x 10–190
    expect(shapeNearPoint(rect, [100, 100], 6)).toBe(true);
    expect(shapeNearPoint(rect, [195, 100], 6)).toBe(true);
    expect(shapeNearPoint(rect, [200, 100], 6)).toBe(false);
    const ellipse = makePrimitive('ellipse', 0, 0, '#000', null); // rx 95, ry 58
    expect(shapeNearPoint(ellipse, [0, 0], 6)).toBe(true);
    expect(shapeNearPoint(ellipse, [99, 0], 6)).toBe(true);
    expect(shapeNearPoint(ellipse, [92, 55], 6)).toBe(false); // bbox corner, outside the ellipse
  });
});
