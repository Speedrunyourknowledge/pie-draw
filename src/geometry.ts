import type { Pt, Shape, ShapeType } from './types';

export interface Bounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export function pointsBounds(points: Pt[]): Bounds {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of points) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return { minX, minY, maxX, maxY };
}

/** Bounding box of a shape's geometry in its own (unscaled, untranslated) coordinates. */
export function localBounds(s: Shape): Bounds {
  switch (s.type) {
    case 'square':
    case 'rectangle':
      return { minX: -s.w / 2, minY: -s.h / 2, maxX: s.w / 2, maxY: s.h / 2 };
    case 'circle':
    case 'ellipse':
      return { minX: -s.rx, minY: -s.ry, maxX: s.rx, maxY: s.ry };
    case 'triangle':
    case 'freehand':
      return pointsBounds(s.points);
  }
}

/** Bounding box on the canvas, after translate + scale. */
export function worldBounds(s: Shape): Bounds {
  const b = localBounds(s);
  const xs = [s.x + b.minX * s.scaleX, s.x + b.maxX * s.scaleX];
  const ys = [s.y + b.minY * s.scaleY, s.y + b.maxY * s.scaleY];
  return {
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
  };
}

/** Recenters points on their bounding-box center. Returns the center and the local points. */
export function centerPoints(points: Pt[]): { cx: number; cy: number; local: Pt[] } {
  const b = pointsBounds(points);
  const cx = (b.minX + b.maxX) / 2;
  const cy = (b.minY + b.maxY) / 2;
  return { cx, cy, local: points.map(([x, y]) => [round2(x - cx), round2(y - cy)] as Pt) };
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function newId(): string {
  return crypto.randomUUID();
}

const base = (type: ShapeType, x: number, y: number) => ({
  id: newId(),
  type,
  x,
  y,
  scaleX: 1,
  scaleY: 1,
  rotation: 0,
});

/** Every shape has a line at this width; closed shapes may also have a fill. */
export const STROKE_WIDTH = 3;
export const paint = (color: string, fill: string | null = null) => ({
  fill,
  stroke: color,
  strokeWidth: STROKE_WIDTH,
});

/** Freehand lines are open, so only closed shapes take a fill. */
export const canFill = (s: Shape) => s.type !== 'freehand';

/** A primitive at a default size, centered on (x, y). */
export function makePrimitive(
  type: Exclude<ShapeType, 'freehand'>,
  x: number,
  y: number,
  color: string,
  fill: string | null,
): Shape {
  const style = paint(color, fill);
  switch (type) {
    case 'square':
      return { ...base(type, x, y), ...style, type, w: 120, h: 120 };
    case 'rectangle':
      return { ...base(type, x, y), ...style, type, w: 180, h: 110 };
    case 'circle':
      return { ...base(type, x, y), ...style, type, rx: 65, ry: 65 };
    case 'ellipse':
      return { ...base(type, x, y), ...style, type, rx: 95, ry: 58 };
    case 'triangle':
      return {
        ...base(type, x, y),
        ...style,
        type,
        points: [
          [0, -62],
          [72, 62],
          [-72, 62],
        ],
      };
  }
}

export function makeFreehand(worldPoints: Pt[], color: string): Shape {
  const { cx, cy, local } = centerPoints(worldPoints);
  return {
    ...base('freehand', cx, cy),
    type: 'freehand',
    ...paint(color),
    points: local,
  };
}

/** SVG path data for a smooth freehand stroke (quadratic curves through midpoints). */
export function smoothPath(points: Pt[]): string {
  if (points.length === 0) return '';
  if (points.length < 3) return 'M' + points.map((p) => p.join(' ')).join(' L');
  let d = `M${points[0][0]} ${points[0][1]}`;
  for (let i = 1; i < points.length - 1; i++) {
    const [x, y] = points[i];
    const [nx, ny] = points[i + 1];
    d += ` Q${x} ${y} ${round2((x + nx) / 2)} ${round2((y + ny) / 2)}`;
  }
  const last = points[points.length - 1];
  return d + ` L${last[0]} ${last[1]}`;
}

export function dist(a: Pt, b: Pt): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

/** Squares and circles always scale uniformly so they keep their identity. */
export function keepsAspect(s: Shape): boolean {
  return s.type === 'square' || s.type === 'circle';
}
