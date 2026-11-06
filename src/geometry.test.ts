import { describe, expect, it } from 'vitest';
import { hexToHsv, hsvToHex, normalizeHex } from './colors';
import {
  anchorsOf,
  snapTriangleTip,
  equalSides,
  flipAbout,
  stepOrder,
  closestSnap,
  frameOf,
  isLine,
  lineEnds,
  lineWithEnds,
  makeFreehand,
  makePrimitive,
  mustScaleEvenly,
  normAngle,
  rotateAbout,
  scaleAbout,
  shapeNearPoint,
  shapeTouchesRect,
  snapAngle,
  snapSegment,
  worldBounds,
} from './geometry';
import type { Pt, Shape } from './types';

const rect = (rotation = 0): Shape => ({ ...makePrimitive('rectangle', 0, 0, '#000000', null), rotation }); // 180×110

describe('rotation', () => {
  it('normalizes angles into (-180, 180]', () => {
    expect(normAngle(270)).toBe(-90);
    expect(normAngle(-180)).toBe(180);
    expect(normAngle(725)).toBe(5);
  });

  it('snaps to 45° steps only when close', () => {
    expect(snapAngle(43)).toBe(45);
    expect(snapAngle(-88)).toBe(-90);
    expect(snapAngle(30)).toBe(30);
  });

  it('snaps nearly flat or diagonal lines', () => {
    const [x, y] = snapSegment([0, 0], [100, 4]);
    expect(y).toBeCloseTo(0);
    expect(x).toBeCloseTo(Math.hypot(100, 4));
    const [dx, dy] = snapSegment([0, 0], [100, 96]);
    expect(dx).toBeCloseTo(dy);
    expect(snapSegment([0, 0], [100, 30])).toEqual([100, 30]); // 17°: left alone
  });

  it('bounds a quarter-turned rectangle with its sides swapped', () => {
    const b = worldBounds(rect(90));
    expect(b.maxX - b.minX).toBeCloseTo(110);
    expect(b.maxY - b.minY).toBeCloseTo(180);
  });

  it('keeps the frame size and angle of a turned shape', () => {
    const f = frameOf(rect(30));
    expect(f).toMatchObject({ w: 180, h: 110, angle: 30 });
  });

  it('hit-tests turned shapes by their real outline', () => {
    const s = rect(90); // now 110 wide, 180 tall
    expect(shapeNearPoint(s, [0, 85], 0)).toBe(true);
    expect(shapeNearPoint(s, [85, 0], 0)).toBe(false);
    expect(shapeTouchesRect(s, { minX: 80, maxX: 100, minY: -5, maxY: 5 })).toBe(false);
    expect(shapeTouchesRect(s, { minX: -5, maxX: 5, minY: 80, maxY: 100 })).toBe(true);
  });

  it('turns shapes about a shared center', () => {
    const s = { ...rect(), x: 100 };
    const p = rotateAbout([s], 0, 0, 90).get(s.id)!;
    expect(p.x).toBeCloseTo(0);
    expect(p.y).toBeCloseTo(100);
    expect(p.rotation).toBe(90);
  });

  it('stretches a turned shape along its own axes', () => {
    const s = rect(90);
    const p = scaleAbout([s], 0, 0, 2, 1).get(s.id)!; // wider on screen = taller for the turned shape
    expect(p.scaleX).toBe(1);
    expect(p.scaleY).toBe(2);
  });

  it('stretches a shape at an angle along its own sides, keeping its angle', () => {
    const s = rect(45);
    const p = scaleAbout([s], 0, 0, 2, 1).get(s.id)!;
    expect(p.scaleX).toBeCloseTo(Math.hypot(2, 1) / Math.SQRT2);
    expect(p.scaleY).toBeCloseTo(Math.hypot(2, 1) / Math.SQRT2);
    expect(p.rotation).toBeUndefined();
  });

  it('lets turned shapes stretch in a group; only squares and circles scale evenly', () => {
    const other = { ...rect(), id: 'b' };
    expect(mustScaleEvenly([rect(30), other])).toBe(false);
    expect(mustScaleEvenly([{ ...makePrimitive('circle', 0, 0, '#000000', null), rotation: 30 }, other])).toBe(true);
  });
});

describe('reach around shapes', () => {
  it('rounds the margin at a rectangle\'s corners', () => {
    const s = rect(); // 180×110, so corners at (±90, ±55)
    expect(shapeNearPoint(s, [90 + 10, 55 + 10], 15)).toBe(true); // 14.1 from the corner
    expect(shapeNearPoint(s, [90 + 12, 55 + 12], 15)).toBe(false); // 17 from the corner, though inside the grown box
    expect(shapeNearPoint(s, [90 + 15, 0], 15)).toBe(true);
  });

  it('measures an ellipse\'s margin from its outline', () => {
    const s = makePrimitive('ellipse', 0, 0, '#000000', null); // radii 95 × 58
    expect(shapeNearPoint(s, [95 + 15, 0], 15)).toBe(true);
    expect(shapeNearPoint(s, [0, 58 + 16], 15)).toBe(false);
    // Off the axes: the point 15 out along the outline's normal at 45° around the curve.
    const t = Math.PI / 4, nx = 58 * Math.cos(t), ny = 95 * Math.sin(t), n = Math.hypot(nx, ny);
    const on: [number, number] = [95 * Math.cos(t), 58 * Math.sin(t)];
    expect(shapeNearPoint(s, [on[0] + (nx / n) * 14.5, on[1] + (ny / n) * 14.5], 15)).toBe(true);
    expect(shapeNearPoint(s, [on[0] + (nx / n) * 15.5, on[1] + (ny / n) * 15.5], 15)).toBe(false);
  });
});

describe('lines and snapping', () => {
  const line = makeFreehand([[0, 0], [100, 0]], '#000000', true);

  it('treats only strokes made straight as lines, with their ends on the canvas', () => {
    expect(isLine(line)).toBe(true);
    expect(isLine(makeFreehand([[0, 0], [100, 0]], '#000000'))).toBe(false); // freehand that came out straight
    const turned = { ...line, rotation: 90 } as typeof line;
    const [a, b] = lineEnds(turned);
    expect(a[0]).toBeCloseTo(50);
    expect(a[1]).toBeCloseTo(-50);
    expect(b[1]).toBeCloseTo(50);
  });

  it('moves one end and keeps the line', () => {
    const moved = lineWithEnds(line, [0, 0], [30, 40]);
    expect(moved.id).toBe(line.id);
    expect(lineEnds(moved)).toEqual([[0, 0], [30, 40]]);
  });

  it('gives lines ends, cornered shapes corners, and round shapes nothing', () => {
    expect(anchorsOf(line).every((a) => a.end)).toBe(true);
    expect(anchorsOf(rect()).length).toBe(4);
    expect(anchorsOf(makePrimitive('triangle', 0, 0, '#000000', null)).length).toBe(3);
    expect(anchorsOf(makePrimitive('circle', 0, 0, '#000000', null))).toEqual([]);
    expect(anchorsOf(makeFreehand([[0, 0], [5, 9], [10, 0]], '#000000'))).toEqual([]);
  });

  it('snaps only pairs that include a line end, and picks the closest', () => {
    const end = (p: [number, number]) => ({ p, end: true });
    const corner = (p: [number, number]) => ({ p, end: false });
    expect(closestSnap([corner([0, 0])], [corner([3, 0])], 10)).toBeNull();
    expect(closestSnap([corner([0, 0])], [end([3, 0])], 10)).toEqual({ from: [0, 0], to: [3, 0] });
    expect(closestSnap([end([0, 0])], [corner([8, 0]), end([2, 0])], 10)?.to).toEqual([2, 0]);
    expect(closestSnap([end([0, 0])], [end([20, 0])], 10)).toBeNull();
  });
});

describe('colors', () => {
  it('normalizes hex codes', () => {
    expect(normalizeHex('#ABC')).toBe('#aabbcc');
    expect(normalizeHex('ff8800')).toBe('#ff8800');
    expect(normalizeHex('#ff88')).toBeNull();
    expect(normalizeHex('red')).toBeNull();
  });

  it('round-trips through HSV', () => {
    for (const hex of ['#ff8800', '#1f2933', '#ffffff', '#000000', '#3e63dd']) expect(hsvToHex(hexToHsv(hex))).toBe(hex);
  });
});

describe('snapTriangleTip', () => {
  const a: Pt = [0, 0], b: Pt = [100, 0];
  it('snaps onto a right angle at either end of the side', () => {
    expect(snapTriangleTip(a, b, [4, 60], 10)).toEqual({ p: [0, 60], from: ['a'] });
    expect(snapTriangleTip(a, b, [97, -50], 10)).toEqual({ p: [100, -50], from: ['b'] });
  });
  it('snaps onto equal sides through the middle', () => {
    expect(snapTriangleTip(a, b, [53, 50], 10)).toEqual({ p: [50, 50], from: ['mid'] });
  });
  it('snaps onto a side as long as the first one', () => {
    const r = snapTriangleTip(a, b, [62, 82], 10); // 102.6 from a
    expect(r.from).toEqual(['ringA']);
    expect(Math.hypot(r.p[0], r.p[1])).toBeCloseTo(100);
  });
  it('snaps onto an equilateral corner on either side', () => {
    for (const s of [1, -1]) {
      const r = snapTriangleTip(a, b, [53, s * 84], 10);
      expect(r.from).toEqual(['mid', 'ringA', 'ringB']);
      expect(r.p[0]).toBeCloseTo(50);
      expect(r.p[1]).toBeCloseTo(s * 50 * Math.sqrt(3));
    }
  });
  it('snaps onto a right isosceles corner', () => {
    const r = snapTriangleTip(a, b, [5, 96], 10);
    expect(r.from).toEqual(['a', 'ringA']);
    expect(r.p[0]).toBeCloseTo(0);
    expect(r.p[1]).toBeCloseTo(100);
  });
  it('leaves a point far from every guide alone', () => {
    expect(snapTriangleTip(a, b, [25, 40], 10)).toEqual({ p: [25, 40], from: [] });
  });
  it('works for a tilted side', () => {
    const r = snapTriangleTip([0, 0], [60, 80], [-58.2, 47.4], 10); // 3 units along the side from (-60, 45), which is on the perpendicular at a
    expect(r.from).toEqual(['a']);
    expect(r.p[0]).toBeCloseTo(-60);
    expect(r.p[1]).toBeCloseTo(45);
  });
});

describe('equalSides', () => {
  it('names the sides each guide makes equal', () => {
    expect(equalSides(['mid'])).toEqual([1, 2]);
    expect(equalSides(['a', 'ringA'])).toEqual([0, 2]);
    expect(equalSides(['mid', 'ringA', 'ringB'])).toEqual([0, 1, 2]);
    expect(equalSides(['a'])).toEqual([]);
  });
});

describe('stepOrder', () => {
  const picked = (set: string) => (s: string) => set.includes(s);
  it('moves picked shapes one step past the next one', () => {
    expect(stepOrder(['a', 'b', 'c', 'd'], picked('b'), 'forward')).toEqual(['a', 'c', 'b', 'd']);
    expect(stepOrder(['a', 'b', 'c', 'd'], picked('c'), 'backward')).toEqual(['a', 'c', 'b', 'd']);
  });
  it('moves a run of picked shapes together, keeping their order', () => {
    expect(stepOrder(['a', 'b', 'c', 'd'], picked('ab'), 'forward')).toEqual(['c', 'a', 'b', 'd']);
    expect(stepOrder(['a', 'b', 'c', 'd'], picked('cd'), 'backward')).toEqual(['a', 'c', 'd', 'b']);
  });
  it('leaves shapes already at the end alone', () => {
    expect(stepOrder(['a', 'b', 'c'], picked('bc'), 'forward')).toEqual(['a', 'b', 'c']);
    expect(stepOrder(['a', 'b', 'c'], picked('a'), 'backward')).toEqual(['a', 'b', 'c']);
  });
});

describe('flipAbout', () => {
  const tri: Shape = { ...makePrimitive('triangle', 10, 20, '#000000', null), rotation: 30 };
  it('mirrors position, turn and points left-right', () => {
    const f = flipAbout(tri, 'horizontal', 0, 0);
    expect([f.x, f.y, f.rotation]).toEqual([-10, 20, -30]);
    if (f.type !== 'triangle' || tri.type !== 'triangle') throw new Error();
    expect(f.points).toEqual(tri.points.map(([x, y]) => [-x, y]));
  });
  it('mirrors top-bottom, and twice gives back the shape', () => {
    const f = flipAbout(tri, 'vertical', 0, 50);
    expect([f.x, f.y]).toEqual([10, 80]);
    expect(flipAbout(f, 'vertical', 0, 50)).toEqual(tri);
  });
  it('mirrors corners on the canvas', () => {
    const before = anchorsOf(tri).map((a) => a.p);
    const after = anchorsOf(flipAbout(tri, 'horizontal', 0, 0)).map((a) => a.p);
    after.forEach(([x, y], i) => {
      expect(x).toBeCloseTo(-before[i][0]);
      expect(y).toBeCloseTo(before[i][1]);
    });
  });
});
