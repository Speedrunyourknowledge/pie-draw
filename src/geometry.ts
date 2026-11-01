import type { Freehand, PrimitiveType, Pt, Shape, ShapeType, TransformPatch, Triangle } from './types';

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

const RAD = Math.PI / 180;

/** An angle in degrees as the equivalent one in (-180, 180], rounded to hundredths. */
export function normAngle(deg: number): number {
  let a = ((deg % 360) + 360) % 360;
  if (a > 180) a -= 360;
  return Math.round(a * 100) / 100;
}

/** Rotates p about c by `deg` degrees, clockwise on screen (y grows downward). */
export function rotatePt([x, y]: Pt, [cx, cy]: Pt, deg: number): Pt {
  if (!deg) return [x, y];
  const c = Math.cos(deg * RAD), s = Math.sin(deg * RAD);
  const dx = x - cx, dy = y - cy;
  return [cx + dx * c - dy * s, cy + dx * s + dy * c];
}

/**
 * Snaps an angle to the nearest multiple of `step` degrees when it is within `within` of it, and
 * leaves it alone otherwise: a magnet at the common angles that still allows every other one.
 */
export function snapAngle(deg: number, step = 45, within = 5): number {
  const near = Math.round(deg / step) * step;
  return Math.abs(deg - near) <= within ? near : deg;
}

/** The end of a straight line from `a` toward `b`, pulled onto a 45° direction when close to one. */
export function snapSegment(a: Pt, b: Pt): Pt {
  const len = dist(a, b);
  if (len === 0) return b;
  const angle = Math.atan2(b[1] - a[1], b[0] - a[0]) / RAD;
  const snapped = snapAngle(angle, 45, 6);
  if (snapped === angle) return b;
  return [a[0] + len * Math.cos(snapped * RAD), a[1] + len * Math.sin(snapped * RAD)];
}

/** Maps a point in the shape's own coordinates onto the canvas: scale, then rotate, then translate. */
export function toWorldFn(s: Shape): (p: Pt) => Pt {
  const c = Math.cos(s.rotation * RAD), sn = Math.sin(s.rotation * RAD);
  return ([px, py]) => {
    const lx = px * s.scaleX, ly = py * s.scaleY;
    return [s.x + lx * c - ly * sn, s.y + lx * sn + ly * c];
  };
}

/** The corners of a box, clockwise from the top left. */
const corners = (b: Bounds): Pt[] => [
  [b.minX, b.minY],
  [b.maxX, b.minY],
  [b.maxX, b.maxY],
  [b.minX, b.maxY],
];

/** Bounding box on the canvas, after translate + rotate + scale. */
export function worldBounds(s: Shape): Bounds {
  const b = localBounds(s);
  if (!s.rotation) {
    const xs = [s.x + b.minX * s.scaleX, s.x + b.maxX * s.scaleX];
    const ys = [s.y + b.minY * s.scaleY, s.y + b.maxY * s.scaleY];
    return {
      minX: Math.min(...xs),
      maxX: Math.max(...xs),
      minY: Math.min(...ys),
      maxY: Math.max(...ys),
    };
  }
  const tw = toWorldFn(s);
  switch (s.type) {
    case 'square':
    case 'rectangle':
      return pointsBounds(corners(b).map(tw));
    case 'circle':
    case 'ellipse': {
      const a = Math.abs(s.rx * s.scaleX), e = Math.abs(s.ry * s.scaleY);
      const c = Math.cos(s.rotation * RAD), sn = Math.sin(s.rotation * RAD);
      const hw = Math.hypot(a * c, e * sn), hh = Math.hypot(a * sn, e * c);
      return { minX: s.x - hw, maxX: s.x + hw, minY: s.y - hh, maxY: s.y + hh };
    }
    case 'triangle':
    case 'freehand':
      return pointsBounds(s.points.map(tw));
  }
}

/**
 * A box that turns with its contents: center, size and angle (degrees) on the canvas. One shape's
 * frame is its own box, rotated with it; several shapes share their upright bounding box.
 */
export interface Frame {
  cx: number;
  cy: number;
  w: number;
  h: number;
  angle: number;
}

export function frameOf(s: Shape): Frame {
  const b = localBounds(s);
  const [cx, cy] = toWorldFn(s)([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2]);
  return {
    cx,
    cy,
    w: Math.abs((b.maxX - b.minX) * s.scaleX),
    h: Math.abs((b.maxY - b.minY) * s.scaleY),
    angle: s.rotation,
  };
}

export function groupFrame(shapes: Shape[]): Frame {
  if (shapes.length === 1) return frameOf(shapes[0]);
  const b = groupBounds(shapes);
  return { cx: (b.minX + b.maxX) / 2, cy: (b.minY + b.maxY) / 2, w: b.maxX - b.minX, h: b.maxY - b.minY, angle: 0 };
}

/** Whether a canvas point lies in a frame grown by `pad` on every side. */
export function inFrame(f: Frame, p: Pt, pad = 0): boolean {
  const [x, y] = rotatePt(p, [f.cx, f.cy], -f.angle);
  return Math.abs(x - f.cx) <= f.w / 2 + pad && Math.abs(y - f.cy) <= f.h / 2 + pad;
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

export function pointInPolygon([x, y]: Pt, poly: Pt[]): boolean {
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
  const toWorld = toWorldFn(s);
  switch (s.type) {
    case 'square':
    case 'rectangle':
      // Upright, the bounding box is the shape; turned, its outline is tested like a triangle's.
      return !s.rotation || polygonTouchesRect(corners(localBounds(s)).map(toWorld), r);
    case 'circle':
    case 'ellipse': {
      if (s.rotation) {
        // A turned ellipse is tested as a fine polygon: closer than any user could aim.
        const pts = Array.from({ length: 48 }, (_, i): Pt => {
          const t = (i / 48) * 2 * Math.PI;
          return toWorld([s.rx * Math.cos(t), s.ry * Math.sin(t)]);
        });
        return polygonTouchesRect(pts, r);
      }
      // The point of r nearest the center, in units of the radii.
      const rx = s.rx * s.scaleX, ry = s.ry * s.scaleY;
      const nx = Math.max(r.minX, Math.min(s.x, r.maxX)), ny = Math.max(r.minY, Math.min(s.y, r.maxY));
      return ((nx - s.x) / rx) ** 2 + ((ny - s.y) / ry) ** 2 <= 1;
    }
    case 'triangle':
      return polygonTouchesRect(s.points.map(toWorld), r);
    case 'freehand': {
      const pts = drawnPoints(s.points).map(toWorld);
      if (pts.length === 1) return inRect(pts[0], r);
      return pts.some((p, i) => i > 0 && segmentHitsRect(pts[i - 1], p, r));
    }
  }
}

/** Whether a closed polygon's outline crosses rect r, or r lies entirely inside it. */
function polygonTouchesRect(pts: Pt[], r: Bounds): boolean {
  if (pts.some((p, i) => segmentHitsRect(p, pts[(i + 1) % pts.length], r))) return true;
  return pointInPolygon([r.minX, r.minY], pts);
}

/**
 * Whether a lasso loop selects a shape: its center (the middle of its bounding box) is inside the
 * loop. This forgives a loose loop that cuts through the shape, and skips a neighbor it only grazes.
 */
export function shapeInLasso(s: Shape, loop: Pt[]): boolean {
  const f = frameOf(s);
  return pointInPolygon([f.cx, f.cy], loop);
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

/**
 * Screen pixels of extra grab area around every shape's outline, so a click just outside a shape or
 * beside a thin stroke still gets it (Fitts's law: a wider target is faster to hit). A fixed screen
 * size, so shapes stay as easy to grab at any zoom.
 */
export const GRAB_PX = 10;

/** Freehand lines are open, so only closed shapes take a fill. */
export const canFill = (s: Shape) => s.type !== 'freehand';

/** A primitive at a default size, centered on (x, y). */
export function makePrimitive(
  type: PrimitiveType,
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

/**
 * A primitive filling the box dragged from `a` to `b`, each side at least `min` long. Squares and
 * circles keep equal sides, as does any shape when `even`; the box then grows from `a` toward `b`.
 */
export function makePrimitiveInBox(
  type: PrimitiveType,
  a: Pt,
  b: Pt,
  color: string,
  fill: string | null,
  even = false,
  min = 0,
): Shape {
  let w = Math.abs(b[0] - a[0]), h = Math.abs(b[1] - a[1]);
  if (even || type === 'square' || type === 'circle') w = h = Math.max(w, h);
  w = Math.max(w, min);
  h = Math.max(h, min);
  const x = a[0] + (b[0] < a[0] ? -w : w) / 2;
  const y = a[1] + (b[1] < a[1] ? -h : h) / 2;
  const style = paint(color, fill);
  switch (type) {
    case 'square':
    case 'rectangle':
      return { ...base(type, x, y), ...style, type, w, h };
    case 'circle':
    case 'ellipse':
      return { ...base(type, x, y), ...style, type, rx: w / 2, ry: h / 2 };
    case 'triangle':
      return {
        ...base(type, x, y),
        ...style,
        type,
        points: [
          [0, -h / 2],
          [w / 2, h / 2],
          [-w / 2, h / 2],
        ],
      };
  }
}

/** A triangle with its corners at these three canvas points, of any shape. */
export function makeTriangle(worldPoints: [Pt, Pt, Pt], color: string, fill: string | null): Triangle {
  const { cx, cy, local } = centerPoints(worldPoints);
  return { ...base('triangle', cx, cy), ...paint(color, fill), type: 'triangle', points: local };
}

/** A freehand stroke; with `straight`, a line from the first point to the second. */
export function makeFreehand(worldPoints: Pt[], color: string, straight = false): Freehand {
  const { cx, cy, local } = centerPoints(worldPoints);
  return {
    ...base('freehand', cx, cy),
    type: 'freehand',
    ...paint(color),
    points: local,
    ...(straight ? { straight: true } : {}),
  };
}

/**
 * The stroke smoothPath draws, as a fine polyline: each quadratic curve split into short pieces, so
 * hit tests follow the curve on screen rather than the corners between the raw points.
 */
export function drawnPoints(points: Pt[]): Pt[] {
  if (points.length < 3) return points;
  const STEPS = 8;
  const out: Pt[] = [points[0]];
  let from = points[0];
  for (let i = 1; i < points.length - 1; i++) {
    const c = points[i], n = points[i + 1];
    const to: Pt = [(c[0] + n[0]) / 2, (c[1] + n[1]) / 2];
    for (let k = 1; k <= STEPS; k++) {
      const t = k / STEPS, u = 1 - t;
      out.push([u * u * from[0] + 2 * u * t * c[0] + t * t * to[0], u * u * from[1] + 2 * u * t * c[1] + t * t * to[1]]);
    }
    from = to;
  }
  out.push(points[points.length - 1]);
  return out;
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

/**
 * Scales every shape by (kx, ky) about the canvas point (ax, ay), along axes turned by `angle`
 * degrees (upright by default). Positions follow the stretch exactly. A shape turned relative to
 * those axes can't be slanted (shapes have no skew), so it keeps its angle and each of its own sides
 * grows by as much as the stretch lengthens that side: a quarter-turned shape swaps the factors, and
 * one at 45° gets an even mix of both.
 */
export function scaleAbout(shapes: Shape[], ax: number, ay: number, kx: number, ky: number, angle = 0) {
  return new Map<string, TransformPatch>(
    shapes.map((s) => {
      const [u, v] = rotatePt([s.x, s.y], [ax, ay], -angle);
      const [x, y] = rotatePt([ax + (u - ax) * kx, ay + (v - ay) * ky], [ax, ay], angle);
      const t = (s.rotation - angle) * RAD;
      const c = Math.cos(t), sn = Math.sin(t);
      return [
        s.id,
        { x, y, scaleX: s.scaleX * Math.hypot(kx * c, ky * sn), scaleY: s.scaleY * Math.hypot(kx * sn, ky * c) },
      ];
    }),
  );
}

/** Turns every shape by `deg` degrees about the canvas point (cx, cy). */
export function rotateAbout(shapes: Shape[], cx: number, cy: number, deg: number) {
  return new Map<string, TransformPatch>(
    shapes.map((s) => {
      const [x, y] = rotatePt([s.x, s.y], [cx, cy], deg);
      return [s.id, { x, y, rotation: normAngle(s.rotation + deg) }];
    }),
  );
}

/** Whether the shapes can only scale evenly: squares and circles keep their identity. */
export function mustScaleEvenly(shapes: Shape[]): boolean {
  return shapes.some(keepsAspect);
}

/** Squares and circles always scale uniformly so they keep their identity. */
export function keepsAspect(s: Shape): boolean {
  return s.type === 'square' || s.type === 'circle';
}

/** Fits a stroke into a size×size box, keeping its proportions. */
export function fitInBox(points: Pt[], size: number, pad: number): Pt[] {
  const b = pointsBounds(points);
  const k = (size - 2 * pad) / Math.max(b.maxX - b.minX, b.maxY - b.minY, 1);
  const ox = (size - (b.maxX - b.minX) * k) / 2, oy = (size - (b.maxY - b.minY) * k) / 2;
  return points.map(([x, y]) => [ox + (x - b.minX) * k, oy + (y - b.minY) * k]);
}

/**
 * Distance from (px, py) to the outline of an ellipse centered on (0, 0) with radii a and b. Finds
 * the closest point on the curve with a few refining steps (accurate well below a pixel).
 */
function distToEllipse(px: number, py: number, a: number, b: number): number {
  const x = Math.abs(px), y = Math.abs(py);
  if (a === 0 || b === 0) return Math.hypot(Math.max(x - a, 0), Math.max(y - b, 0));
  let tx = Math.SQRT1_2, ty = Math.SQRT1_2;
  for (let i = 0; i < 4; i++) {
    // The center of curvature at the current point, then a step along the ray through the target.
    const ex = ((a * a - b * b) * tx ** 3) / a, ey = ((b * b - a * a) * ty ** 3) / b;
    const r = Math.hypot(a * tx - ex, b * ty - ey), q = Math.hypot(x - ex, y - ey) || 1;
    tx = Math.min(1, Math.max(0, (((x - ex) * r) / q + ex) / a));
    ty = Math.min(1, Math.max(0, (((y - ey) * r) / q + ey) / b));
    const t = Math.hypot(tx, ty) || 1;
    tx /= t;
    ty /= t;
  }
  return Math.hypot(x - a * tx, y - b * ty);
}

/** Distance from p to segment a–b. */
function distToSegment(p: Pt, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len2 = dx * dx + dy * dy;
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / len2));
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
}

/**
 * Whether a canvas point is on a shape or within `tol` of it. Closed shapes count by their area
 * (as in box selection); freehand lines by the line itself.
 */
export function shapeNearPoint(s: Shape, p: Pt, tol: number): boolean {
  // A turned shape is tested upright, with the point turned back the other way about its origin.
  if (s.rotation) return shapeNearPoint({ ...s, rotation: 0 }, rotatePt(p, [s.x, s.y], -s.rotation), tol);
  const b = worldBounds(s);
  // Quick reject outside the box grown by the reach (a stroke also reaches half its width further).
  const pad = tol + (s.type === 'freehand' ? s.strokeWidth / 2 : 0);
  if (p[0] < b.minX - pad || p[0] > b.maxX + pad || p[1] < b.minY - pad || p[1] > b.maxY + pad) return false;
  const toWorld = ([x, y]: Pt): Pt => [s.x + x * s.scaleX, s.y + y * s.scaleY];
  switch (s.type) {
    case 'square':
    case 'rectangle': {
      // Inside, or within tol of the outline: the corners of that margin are round.
      const c = [(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2];
      const dx = Math.max(Math.abs(p[0] - c[0]) - (b.maxX - b.minX) / 2, 0);
      const dy = Math.max(Math.abs(p[1] - c[1]) - (b.maxY - b.minY) / 2, 0);
      return Math.hypot(dx, dy) <= tol;
    }
    case 'circle':
    case 'ellipse': {
      const rx = Math.abs(s.rx * s.scaleX), ry = Math.abs(s.ry * s.scaleY);
      const x = p[0] - s.x, y = p[1] - s.y;
      return (x / rx) ** 2 + (y / ry) ** 2 <= 1 || distToEllipse(x, y, rx, ry) <= tol;
    }
    case 'triangle': {
      const pts = s.points.map(toWorld);
      return pointInPolygon(p, pts) || pts.some((a, i) => distToSegment(p, a, pts[(i + 1) % pts.length]) <= tol);
    }
    case 'freehand': {
      const pts = drawnPoints(s.points).map(toWorld);
      const reach = tol + s.strokeWidth / 2;
      if (pts.length === 1) return dist(p, pts[0]) <= reach;
      return pts.some((a, i) => i > 0 && distToSegment(p, pts[i - 1], a) <= reach);
    }
  }
}

// ---- straight lines and snapping ----

/**
 * A straight line, drawn with Shift or by the assistant. A freehand stroke that merely came out
 * straight stays an ordinary stroke: it has no draggable ends and doesn't snap.
 */
export const isLine = (s: Shape): s is Freehand & { straight: true } => s.type === 'freehand' && s.straight === true && s.points.length === 2;

/** A line's two ends on the canvas. */
export function lineEnds(s: Freehand): [Pt, Pt] {
  const tw = toWorldFn(s);
  return [tw(s.points[0]), tw(s.points[1])];
}

/** The same line (id, color, width) running from `a` to `b`. */
export function lineWithEnds(s: Freehand, a: Pt, b: Pt): Freehand {
  const { cx, cy, local } = centerPoints([a, b]);
  return { ...s, x: cx, y: cy, scaleX: 1, scaleY: 1, rotation: 0, points: local };
}

/**
 * Where a triangle's third corner goes, given the side a-b: onto a right angle at a or b, or onto the
 * line through the middle of the side where the other two sides come out equal, when the point is
 * within `tol` of one; else where it is. `from` is where the line it snapped to starts.
 */
export function snapTriangleTip(a: Pt, b: Pt, p: Pt, tol: number): { p: Pt; from: 'a' | 'b' | 'mid' | null } {
  const len = dist(a, b);
  if (len === 0) return { p, from: null };
  const n: Pt = [-(b[1] - a[1]) / len, (b[0] - a[0]) / len]; // across the side
  const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
  let best: { p: Pt; from: 'a' | 'b' | 'mid'; d: number } | null = null;
  for (const [from, o] of [['a', a], ['b', b], ['mid', mid]] as const) {
    const t = (p[0] - o[0]) * n[0] + (p[1] - o[1]) * n[1];
    const q: Pt = [o[0] + n[0] * t, o[1] + n[1] * t];
    const d = dist(p, q);
    if (d <= tol && (!best || d < best.d)) best = { p: q, from, d };
  }
  return best ? { p: best.p, from: best.from } : { p, from: null };
}

/** Twice a triangle's area: zero when its corners are in a line. */
export const triangleArea2 = ([a, b, c]: Pt[]) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));

/** A point things can snap together at: a line's end (`end`), or a corner of a shape with corners. */
export interface Anchor {
  p: Pt;
  end: boolean;
}

/** A shape's snap points: a line's two ends, or the corners of a square, rectangle or triangle. */
export function anchorsOf(s: Shape): Anchor[] {
  if (isLine(s)) return lineEnds(s).map((p) => ({ p, end: true }));
  const tw = toWorldFn(s);
  switch (s.type) {
    case 'square':
    case 'rectangle':
      return corners(localBounds(s)).map((p) => ({ p: tw(p), end: false }));
    case 'triangle':
      return s.points.map((p) => ({ p: tw(p), end: false }));
    default:
      return [];
  }
}

/**
 * The closest pair (a moving anchor `from`, a fixed anchor `to`) within `radius`, or null. Line ends
 * are the magnets: a pair snaps only when at least one of them is a line's end, so lines join each
 * other and shapes' corners, but corners never pull on corners.
 */
export function closestSnap(moving: Anchor[], targets: Anchor[], radius: number): { from: Pt; to: Pt } | null {
  let best: { from: Pt; to: Pt } | null = null;
  let bestD = radius;
  for (const m of moving) {
    for (const t of targets) {
      if (!m.end && !t.end) continue;
      const d = dist(m.p, t.p);
      if (d <= bestD) {
        bestD = d;
        best = { from: m.p, to: t.p };
      }
    }
  }
  return best;
}
