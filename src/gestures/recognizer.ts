/**
 * Penny Pincher unistroke recognizer (Taranta & LaViola, Graphics Interface 2015), implemented from
 * the paper's pseudocode. Pure TypeScript: points in, { label, score } out.
 *
 * A stroke is resampled into N points spaced evenly along its path, and described by the N - 1
 * vectors between consecutive points. Template vectors are normalized to unit length, so the dot
 * product with a template sums the cosines of the angles between matching segments. Translation and
 * scale drop out; start point, direction and rotation do not.
 */

export type Point = readonly [number, number];
export type Vec = [number, number];

/** Number of resampled points; each stroke becomes N - 1 vectors. */
export const N = 32;

/** A best-match score below this means "not a gesture". Score is the mean cosine, in [-1, 1]. */
export const REJECT_THRESHOLD = 0.85;

export interface Template {
  label: string;
  vectors: Vec[];
}

export interface Match {
  label: string;
  /** Mean cosine similarity to the best template, in [-1, 1]. */
  score: number;
  template: Template;
}

const EPS = 1e-9;

function distance(a: Point, b: Point): number {
  return Math.hypot(a[0] - b[0], a[1] - b[1]);
}

export function pathLength(points: readonly Point[]): number {
  let d = 0;
  for (let i = 1; i < points.length; i++) d += distance(points[i - 1], points[i]);
  return d;
}

function unit(v: Vec): Vec {
  const len = Math.hypot(v[0], v[1]);
  return len < EPS ? [0, 0] : [v[0] / len, v[1] / len]; // a zero vector matches nothing
}

/**
 * RESAMPLE-BETWEEN-POINTS: the N - 1 vectors between N points spaced evenly along the stroke,
 * each normalized to unit length when `normalize` is set. Null for a stroke with too few points or
 * no length, which is never a gesture.
 */
export function resample(points: readonly Point[], n = N, normalize = true): Vec[] | null {
  if (points.length < 2 || n < 2) return null;
  const length = pathLength(points);
  if (length < EPS) return null;

  const pts: Point[] = points.slice(); // q is inserted while iterating, as in $1
  const interval = length / (n - 1);
  const v: Vec[] = [];
  let D = 0;
  let prev = pts[0];
  for (let i = 1; i < pts.length && v.length < n - 1; i++) {
    const a = pts[i - 1], b = pts[i];
    const d = distance(a, b);
    if (d < EPS) continue; // duplicate point: nothing to walk along
    if (D + d >= interval) {
      const t = (interval - D) / d; // Equation 2
      const q: Point = [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
      const r: Vec = [q[0] - prev[0], q[1] - prev[1]];
      v.push(normalize ? unit(r) : r);
      D = 0;
      prev = q;
      pts.splice(i, 0, q); // the next step measures from q
    } else D += d;
  }
  // Rounding can leave the last point unemitted; finish at the stroke's end.
  if (v.length < n - 1) {
    const last = points[points.length - 1];
    const r: Vec = [last[0] - prev[0], last[1] - prev[1]];
    v.push(normalize ? unit(r) : r);
  }
  return v;
}

export function toTemplate(label: string, points: readonly Point[], n = N): Template | null {
  const vectors = resample(points, n, true);
  return vectors && { label, vectors };
}

/** Mean dot product of the candidate's unit vectors with a template's (Equation 6, divided by N - 1). */
function similarity(c: Vec[], t: Vec[]): number {
  let d = 0;
  for (let i = 0; i < c.length; i++) d += t[i][0] * c[i][0] + t[i][1] * c[i][1];
  return d / c.length;
}

/**
 * The best score per label, highest first. The candidate is normalized too (unlike the paper), so
 * scores are bounded and can be compared with REJECT_THRESHOLD. Empty for a degenerate stroke.
 */
export function rank(points: readonly Point[], templates: readonly Template[]): Match[] {
  if (templates.length === 0) return [];
  const n = templates[0].vectors.length + 1;
  const c = resample(points, n, true);
  if (!c) return [];
  const best = new Map<string, Match>();
  for (const t of templates) {
    if (t.vectors.length !== c.length) continue; // built with a different N
    const score = similarity(c, t.vectors);
    const cur = best.get(t.label);
    if (!cur || score > cur.score) best.set(t.label, { label: t.label, score, template: t });
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

/** RECOGNIZE: the label of the best-matching template, or null for a degenerate stroke. */
export function recognize(points: readonly Point[], templates: readonly Template[]): Match | null {
  return rank(points, templates)[0] ?? null;
}
