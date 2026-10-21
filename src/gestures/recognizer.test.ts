import { describe, expect, it } from 'vitest';
import { N, recognize, resample, toTemplate, type Point, type Template } from './recognizer';

// Synthetic strokes, for tests only. The real templates are recorded by hand.

/** Seeded PRNG so the noisy strokes are the same on every run. */
function rng(seed: number) {
  return () => {
    seed = (seed * 1664525 + 1013904223) % 2 ** 32;
    return seed / 2 ** 32;
  };
}

/** Clockwise on screen (y down) when `dir` is 1; starts at `start` radians (0 = right, -π/2 = top). */
function ellipse(cx: number, cy: number, rx: number, ry: number, start = -Math.PI / 2, dir = 1, count = 60): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i <= count; i++) {
    const a = start + (dir * 2 * Math.PI * i) / count;
    pts.push([cx + rx * Math.cos(a), cy + ry * Math.sin(a)]);
  }
  return pts;
}

/** A polyline through the corners with `per` points on each edge. */
function polyline(corners: Point[], per = 15): Point[] {
  const pts: Point[] = [];
  for (let i = 0; i < corners.length - 1; i++) {
    const [a, b] = [corners[i], corners[i + 1]];
    for (let k = 0; k < per; k++) pts.push([a[0] + ((b[0] - a[0]) * k) / per, a[1] + ((b[1] - a[1]) * k) / per]);
  }
  pts.push(corners[corners.length - 1]);
  return pts;
}

const rect = (x: number, y: number, w: number, h: number) =>
  polyline([[x, y], [x + w, y], [x + w, y + h], [x, y + h], [x, y]]); // clockwise from top-left
const triangle = (x: number, y: number, w: number, h: number) =>
  polyline([[x + w / 2, y], [x + w, y + h], [x, y + h], [x + w / 2, y]]); // clockwise from apex
const check = (x: number, y: number, s: number) => polyline([[x, y], [x + s / 3, y + s / 3], [x + s, y - s / 2]]);
const slash = (x: number, y: number, s: number) => polyline([[x + s, y], [x, y + s]]);

function jitter(pts: Point[], amount: number, seed: number): Point[] {
  const r = rng(seed);
  return pts.map(([x, y]) => [x + (r() - 0.5) * amount, y + (r() - 0.5) * amount] as Point);
}

function templates(): Template[] {
  const strokes: [string, Point[]][] = [
    ['circle', ellipse(100, 100, 50, 50)],
    ['circle', ellipse(0, 0, 80, 40)],
    ['rectangle', rect(0, 0, 100, 100)],
    ['rectangle', rect(0, 0, 200, 80)],
    ['triangle', triangle(0, 0, 100, 90)],
    ['paste', check(0, 0, 90)],
    ['cut', slash(0, 0, 100)],
  ];
  return strokes.map(([label, pts]) => toTemplate(label, pts)!);
}

const len = ([x, y]: [number, number]) => Math.hypot(x, y);

describe('resample', () => {
  it('returns exactly n - 1 vectors whatever the input density', () => {
    const r = rng(1);
    const strokes: Point[][] = [
      ellipse(0, 0, 50, 50, 0, 1, 7),
      ellipse(0, 0, 50, 50, 0, 1, 500),
      rect(3, 7, 123.4567, 89.1011),
      polyline([[0, 0], [1, 0]], 1), // two points
      Array.from({ length: 40 }, () => [r() * 300, r() * 300] as Point), // random walk
      // Lengths that tend to leave the last point unemitted through rounding.
      polyline([[0, 0], [0.1 + 0.2, 0], [0.3, 0.7]], 3),
    ];
    for (const n of [8, 16, N, 64, 97]) {
      for (const s of strokes) expect(resample(s, n)!).toHaveLength(n - 1);
    }
  });

  it('normalizes vectors to unit length only when asked', () => {
    const pts = rect(0, 0, 300, 100);
    for (const v of resample(pts, N, true)!) expect(len(v)).toBeCloseTo(1, 9);
    // Unnormalized, the vectors are the even spacing along the path.
    const spacing = 800 / (N - 1);
    for (const v of resample(pts, N, false)!) expect(len(v)).toBeLessThanOrEqual(spacing + 1e-6);
  });

  it('skips duplicate points without dividing by zero', () => {
    const pts: Point[] = [[0, 0], [0, 0], [10, 0], [10, 0], [10, 0], [10, 10]];
    const v = resample(pts, 16)!;
    expect(v).toHaveLength(15);
    expect(v.flat().every(Number.isFinite)).toBe(true);
  });

  it('rejects degenerate strokes', () => {
    expect(resample([])).toBeNull();
    expect(resample([[5, 5]])).toBeNull();
    expect(resample([[5, 5], [5, 5], [5, 5]])).toBeNull(); // no path length
    expect(toTemplate('x', [[1, 1]])).toBeNull();
    expect(recognize([[1, 1], [1, 1]], templates())).toBeNull();
  });
});

describe('recognize', () => {
  const T = templates();

  it('scores a stroke against its own template as 1', () => {
    const pts = ellipse(100, 100, 50, 50);
    expect(recognize(pts, T)!.score).toBeCloseTo(1, 9);
  });

  it('ignores position and scale', () => {
    expect(recognize(rect(500, 300, 20, 20), T)!.label).toBe('rectangle');
    expect(recognize(ellipse(-400, 900, 300, 300), T)!.label).toBe('circle');
  });

  it('matches noisy synthetic strokes to the right class', () => {
    const cases: [string, Point[]][] = [
      ['circle', ellipse(50, 50, 60, 45)],
      ['rectangle', rect(10, 10, 140, 90)],
      ['triangle', triangle(0, 0, 120, 100)],
      ['paste', check(0, 0, 60)],
      ['cut', slash(0, 0, 70)],
    ];
    for (const [label, pts] of cases) {
      for (let seed = 1; seed <= 5; seed++) {
        const m = recognize(jitter(pts, 3, seed), T)!;
        expect(m.label, `${label}, seed ${seed}`).toBe(label);
        expect(m.score).toBeGreaterThan(0.8);
      }
    }
  });

  it('keeps scores within [-1, 1]', () => {
    const r = rng(7);
    for (let k = 0; k < 20; k++) {
      const pts = Array.from({ length: 30 }, () => [r() * 200, r() * 200] as Point);
      const m = recognize(pts, T)!;
      expect(m.score).toBeGreaterThanOrEqual(-1);
      expect(m.score).toBeLessThanOrEqual(1);
    }
  });

  it('returns null with no templates', () => {
    expect(recognize(rect(0, 0, 10, 10), [])).toBeNull();
  });

  // Penny Pincher compares segment directions in order, so where a stroke starts and which way it
  // goes are part of the gesture. This is why circle (clockwise) and lasso (counterclockwise) can be
  // told apart, and why templates must be recorded from each start point that users will use.
  describe('is start-point and direction sensitive (by design)', () => {
    const top = toTemplate('top-cw', ellipse(0, 0, 50, 50, -Math.PI / 2, 1))!;

    it('a circle drawn from the bottom scores poorly against one drawn from the top', () => {
      const fromTop = recognize(ellipse(0, 0, 50, 50, -Math.PI / 2, 1), [top])!;
      const fromBottom = recognize(ellipse(0, 0, 50, 50, Math.PI / 2, 1), [top])!;
      expect(fromTop.score).toBeCloseTo(1, 9);
      expect(fromBottom.score).toBeLessThan(0); // every segment points the opposite way
    });

    it('clockwise and counterclockwise loops are different classes', () => {
      const ccw = toTemplate('ccw', ellipse(0, 0, 50, 50, -Math.PI / 2, -1))!;
      expect(recognize(jitter(ellipse(0, 0, 70, 60, -Math.PI / 2, 1), 4, 3), [top, ccw])!.label).toBe('top-cw');
      expect(recognize(jitter(ellipse(0, 0, 70, 60, -Math.PI / 2, -1), 4, 3), [top, ccw])!.label).toBe('ccw');
    });
  });
});
