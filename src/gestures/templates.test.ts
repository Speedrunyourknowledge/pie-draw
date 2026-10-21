import { describe, expect, it } from 'vitest';
import type { Pt } from '../types';
import { exampleSample, parseTemplateFile, serializeTemplateFile, type Sample } from './templates';

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
