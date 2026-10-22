import { describe, expect, it } from 'vitest';
import type { Pt } from '../types';
import { REJECT_THRESHOLD, rank } from './recognizer';
import { LOOP_STARTS, ROTATIONS, buildTemplates, exampleSample, loopStarts, parseTemplateFile, serializeTemplateFile, type Sample } from './templates';

const line = (dx: number, dy: number): Pt[] => Array.from({ length: 10 }, (_, i) => [i * dx, i * dy] as Pt);

// Strokes at 0°, ~6° and ~11°: the middle one is closest to the rest, so it is the most typical.
const samples: Sample[] = [
  { label: 'cut', points: line(10, 0) },
  { label: 'cut', points: line(10, 1) },
  { label: 'cut', points: line(10, 2) },
  { label: 'paste', points: line(0, 10) },
];

describe('exampleSample', () => {
  it('defaults to the most typical sample of the label', () => {
    expect(exampleSample('cut', samples)).toBe(samples[1]);
  });

  it('prefers a sample chosen as the example', () => {
    const pinned = samples.map((s, i) => (i === 2 ? { ...s, example: true } : s));
    expect(exampleSample('cut', pinned)).toBe(pinned[2]);
  });

  it('returns null for a label with no samples', () => {
    expect(exampleSample('lasso', samples)).toBeNull();
  });
});

describe('template file', () => {
  it('round-trips samples, keeping the example flag only where set', () => {
    const withExample = samples.map((s, i) => (i === 0 ? { ...s, example: true } : s));
    const text = serializeTemplateFile(withExample);
    expect(text.match(/"example"/g)).toHaveLength(1);
    expect(parseTemplateFile(JSON.parse(text)).samples).toEqual(withExample);
  });

  it('rejects malformed files', () => {
    expect(() => parseTemplateFile({ version: 2, samples: [] })).toThrow();
    expect(() => parseTemplateFile({ version: 1, samples: [{ label: 'x', points: [[1]] }] })).toThrow();
    expect(() => parseTemplateFile({ version: 1, samples: [{ label: 'x', points: [], example: 'yes' }] })).toThrow();
  });
});

describe('eitherDirection', () => {
  const vee: Pt[] = [...line(5, 10), ...line(5, -10).map(([x, y]) => [x + 45, y + 90] as Pt)];
  const loop: Pt[] = Array.from({ length: 41 }, (_, i) => [50 * Math.cos((i * Math.PI) / 20), 50 * Math.sin((i * Math.PI) / 20)] as Pt);

  it('recognizes a gesture marked eitherDirection drawn the other way', () => {
    const templates = buildTemplates([{ label: 'paste', points: vee }]);
    expect(templates).toHaveLength(2);
    const [best] = rank(vee.slice().reverse(), templates);
    expect(best.label).toBe('paste');
    expect(best.score).toBeGreaterThan(REJECT_THRESHOLD);
  });

  it('keeps direction-sensitive gestures one-way', () => {
    const templates = buildTemplates([{ label: 'circle', points: loop }]);
    expect(rank(loop.slice().reverse(), templates)[0].score).toBeLessThan(REJECT_THRESHOLD);
  });
});

describe('anyStart', () => {
  // Clockwise on screen, starting at the top; `from` shifts the start around the loop.
  const circle = (from = 0, overshoot = 0): Pt[] =>
    Array.from({ length: 41 + overshoot }, (_, i) => {
      const a = -Math.PI / 2 + from + (i * Math.PI) / 20;
      return [50 * Math.cos(a), 50 * Math.sin(a)] as Pt;
    });

  it('makes LOOP_STARTS copies of a loop', () => {
    expect(buildTemplates([{ label: 'circle', points: circle() }])).toHaveLength(LOOP_STARTS * ROTATIONS);
    expect(loopStarts(circle(0, 6))[3][0]).toEqual(loopStarts(circle(0, 6))[3].at(-1)); // each copy closes on its start
  });

  it('recognizes a loop started anywhere, but not drawn the other way', () => {
    const templates = buildTemplates([{ label: 'circle', points: circle(0, 4) }]);
    for (const from of [Math.PI / 2, Math.PI, 2.3, 4]) {
      expect(rank(circle(from), templates)[0].score).toBeGreaterThan(REJECT_THRESHOLD);
      expect(rank(circle(from).reverse(), templates)[0].score).toBeLessThan(REJECT_THRESHOLD);
    }
  });

  it('leaves other gestures with one template per sample', () => {
    expect(buildTemplates([{ label: 'copy', points: circle() }])).toHaveLength(1);
  });
});

describe('anyRotation', () => {
  // Clockwise on screen: an upward triangle, and the same triangle pointing down, left and right.
  const up: Pt[] = [[0, 100], [50, 0], [100, 100], [0, 100]];
  const turned = (deg: number): Pt[] => {
    const a = (deg * Math.PI) / 180;
    return up.map(([x, y]) => [x * Math.cos(a) - y * Math.sin(a), x * Math.sin(a) + y * Math.cos(a)] as Pt);
  };
  const dense = (pts: Pt[]): Pt[] =>
    pts.flatMap((p, i) => (i === 0 ? [p] : Array.from({ length: 10 }, (_, k) => [pts[i - 1][0] + ((p[0] - pts[i - 1][0]) * (k + 1)) / 10, pts[i - 1][1] + ((p[1] - pts[i - 1][1]) * (k + 1)) / 10] as Pt)));

  it('recognizes a sample at every quarter turn, but not drawn the other way', () => {
    const templates = buildTemplates([{ label: 'triangle', points: dense(up) }]);
    for (const deg of [90, 180, 270]) {
      expect(rank(dense(turned(deg)), templates)[0].score).toBeGreaterThan(0.99);
      expect(rank(dense(turned(deg)).reverse(), templates)[0].score).toBeLessThan(REJECT_THRESHOLD);
    }
  });

  it('leaves gestures without it unrotated', () => {
    expect(buildTemplates([{ label: 'copy', points: dense(up) }])).toHaveLength(1);
  });
});
