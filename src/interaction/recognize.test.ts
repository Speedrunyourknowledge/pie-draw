import { describe, expect, it } from 'vitest';
import type { Pt } from '../types';
import { overshot, recognize } from './recognize';

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
const ellipse = (rx: number, ry: number, turns = 1): Pt[] =>
  Array.from({ length: 61 }, (_, i) => [rx * Math.cos((2 * Math.PI * turns * i) / 60), ry * Math.sin((2 * Math.PI * turns * i) / 60)] as Pt);
const box = (w: number, h: number) => polyline([[0, 0], [w, 0], [w, h], [0, h], [0, 0]]);

// The freehand snap-to-shape heuristic, kept as the app's behavior for unrecognized strokes.
describe('snap to shape', () => {
  it('snaps each primitive', () => {
    expect(recognize(box(100, 104))?.type).toBe('square');
    expect(recognize(box(200, 90))?.type).toBe('rectangle');
    expect(recognize(ellipse(60, 62))?.type).toBe('circle');
    expect(recognize(ellipse(100, 50))?.type).toBe('ellipse');
    expect(recognize(polyline([[50, 0], [100, 90], [0, 90], [50, 0]]))?.type).toBe('triangle');
  });

  it('leaves open, tiny and overshooting strokes freehand', () => {
    expect(recognize(polyline([[0, 0], [100, 0], [100, 100]]))).toBeNull();
    expect(recognize(box(10, 10))).toBeNull();
    const twice = ellipse(80, 80, 1.3);
    expect(overshot(twice)).toBe(true);
    expect(recognize(twice)).toBeNull();
  });
});
