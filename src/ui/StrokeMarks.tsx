import { dist } from '../geometry';
import { pathLength } from '../gestures/recognizer';
import type { Pt } from '../types';

/** An arrowhead at `tip`, pointing along the stroke from `from`. */
function arrowhead(from: Pt, tip: Pt, size: number): string {
  const a = Math.atan2(tip[1] - from[1], tip[0] - from[0]);
  const [l, r] = [a + 2.6, a - 2.6].map((t) => `${tip[0] + size * Math.cos(t)},${tip[1] + size * Math.sin(t)}`);
  return `${l} ${tip.join(',')} ${r}`;
}

/** The point `along` px down the stroke, and one a few px before it to aim an arrowhead with. */
function pointAlong(points: Pt[], along: number, back: number): [Pt, Pt] {
  let d = 0, i = 1;
  for (; i < points.length - 1; i++) {
    d += dist(points[i - 1], points[i]);
    if (d >= along) break;
  }
  let j = i;
  while (j > 0 && dist(points[j], points[i]) < back) j--;
  return [points[j], points[i]];
}

/**
 * A stroke with a dot where it starts, an arrow just after the start and one at the end, so the
 * direction shows even on closed loops, where the end lands on the start.
 */
export function StrokeMarks({ points, scale = 1 }: { points: Pt[]; scale?: number }) {
  const size = 9 * scale;
  const length = pathLength(points);
  const early = pointAlong(points, Math.min(length * 0.15, 60 * scale), 6 * scale);
  const late = pointAlong(points, length, 6 * scale);
  return (
    <>
      <polyline className="rec-stroke" points={points.map((p) => p.join(',')).join(' ')} style={{ strokeWidth: 3 * scale }} />
      <polyline className="rec-arrow" points={arrowhead(...early, size)} style={{ strokeWidth: 3 * scale }} />
      <polyline className="rec-arrow end" points={arrowhead(...late, size)} style={{ strokeWidth: 3 * scale }} />
      <circle className="rec-start" cx={points[0][0]} cy={points[0][1]} r={5 * scale} />
    </>
  );
}
