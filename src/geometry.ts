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

/** Bounding box around several shapes on the canvas. */
export function groupBounds(shapes: Shape[]): Bounds {
  const bs = shapes.map(worldBounds);
  return {
    minX: Math.min(...bs.map((b) => b.minX)),
    minY: Math.min(...bs.map((b) => b.minY)),
    maxX: Math.max(...bs.map((b) => b.maxX)),
    maxY: Math.max(...bs.map((b) => b.maxY)),
  };
}

const inRect = ([x, y]: Pt, r: Bounds) => x >= r.minX && x <= r.maxX && y >= r.minY && y <= r.maxY;

/** Whether segment a–b crosses or lies inside rect r (Liang–Barsky clipping). */
function segmentHitsRect(a: Pt, b: Pt, r: Bounds): boolean {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  let t0 = 0, t1 = 1;
  const edges: [number, number][] = [
    [-dx, a[0] - r.minX],
    [dx, r.maxX - a[0]],
    [-dy, a[1] - r.minY],
    [dy, r.maxY - a[1]],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
    } else {
      const t = q / p;
      if (p < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

function pointInPolygon([x, y]: Pt, poly: Pt[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i], [xj, yj] = poly[j];
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Whether a shape overlaps a canvas rectangle, for box selection. Closed shapes count by their
 * area (outline-only ones are selectable by their interior too); freehand lines by the line itself.
 */
export function shapeTouchesRect(s: Shape, r: Bounds): boolean {
  const b = worldBounds(s);
  if (b.maxX < r.minX || b.minX > r.maxX || b.maxY < r.minY || b.minY > r.maxY) return false;
  const toWorld = ([x, y]: Pt): Pt => [s.x + x * s.scaleX, s.y + y * s.scaleY];
  switch (s.type) {
    case 'square':
    case 'rectangle':
      return true; // the bounding box is the shape
    case 'circle':
    case 'ellipse': {
      // The point of r nearest the center, in units of the radii.
      const rx = s.rx * s.scaleX, ry = s.ry * s.scaleY;
      const nx = Math.max(r.minX, Math.min(s.x, r.maxX)), ny = Math.max(r.minY, Math.min(s.y, r.maxY));
      return ((nx - s.x) / rx) ** 2 + ((ny - s.y) / ry) ** 2 <= 1;
    }
    case 'triangle': {
      const pts = s.points.map(toWorld);
      if (pts.some((p, i) => segmentHitsRect(p, pts[(i + 1) % pts.length], r))) return true;
      return pointInPolygon([r.minX, r.minY], pts); // the box lies entirely inside the triangle
    }
    case 'freehand': {
      const pts = s.points.map(toWorld);
      if (pts.length === 1) return inRect(pts[0], r);
      return pts.some((p, i) => i > 0 && segmentHitsRect(pts[i - 1], p, r));
    }
  }
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
