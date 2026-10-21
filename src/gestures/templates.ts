/**
 * Recorded gesture samples. templates.json stores each sample's raw stroke points, not vectors, so
 * N can change without re-recording; the template set is built from them at load time.
 */
import { fitInBox } from '../geometry';
import { EXAMPLE_BOX } from './examples';
import { N, rank, toTemplate, type Template } from './recognizer';
import data from './templates.json';
import type { Pt } from '../types';

export interface Sample {
  label: string;
  points: Pt[];
  /** Chosen in record mode as the picture of this gesture in the gesture reference. */
  example?: boolean;
}

export interface TemplateFile {
  version: 1;
  samples: Sample[];
}

const isPt = (p: unknown): p is Pt =>
  Array.isArray(p) && p.length === 2 && p.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Validates parsed JSON as a template file. Throws with a readable message if it isn't one. */
export function parseTemplateFile(json: unknown): TemplateFile {
  const f = json as Partial<TemplateFile> | null;
  if (!f || f.version !== 1 || !Array.isArray(f.samples)) throw new Error('Not a gesture template file (version 1)');
  f.samples.forEach((s, i) => {
    if (
      typeof s?.label !== 'string' ||
      !s.label ||
      !Array.isArray(s.points) ||
      !s.points.every(isPt) ||
      (s.example !== undefined && typeof s.example !== 'boolean')
    ) {
      throw new Error(`Sample ${i + 1} is malformed`);
    }
  });
  return { version: 1, samples: f.samples };
}

const round1 = (n: number) => Math.round(n * 10) / 10;

/** JSON with one sample per line, so the file stays small and diffs read well. */
export function serializeTemplateFile(samples: Sample[]): string {
  const lines = samples.map(
    (s) =>
      `    ${JSON.stringify({
        label: s.label,
        ...(s.example ? { example: true } : {}),
        points: s.points.map(([x, y]) => [round1(x), round1(y)]),
      })}`,
  );
  return `{\n  "version": 1,\n  "samples": [\n${lines.join(',\n')}\n  ]\n}\n`;
}

/** Resamples every sample into a recognizer template. Degenerate samples are skipped. */
export function buildTemplates(samples: readonly Sample[], n = N): Template[] {
  return samples.flatMap((s) => toTemplate(s.label, s.points, n) ?? []);
}

/** The samples shipped in templates.json. */
export const recordedSamples: Sample[] = parseTemplateFile(data).samples;

/** The template set the app recognizes against. */
export const templates: Template[] = buildTemplates(recordedSamples);

/**
 * The sample that shows how a gesture is drawn: the one chosen as its example in record mode, or else
 * the most typical one, which matches the label's other samples best on average. Null if none.
 */
export function exampleSample(label: string, samples: readonly Sample[] = recordedSamples): Sample | null {
  const own = samples.filter((s) => s.label === label);
  return own.find((s) => s.example) ?? typicalSample(own);
}

/** The sample that matches the others best on average (all of one label). */
function typicalSample(own: readonly Sample[]): Sample | null {
  const temps = own.map((s) => toTemplate(s.label, s.points));
  let best: Sample | null = null, bestScore = -Infinity;
  own.forEach((s, i) => {
    let total = 0;
    temps.forEach((t, j) => {
      if (t && j !== i) total += rank(s.points, [t])[0]?.score ?? -1;
    });
    if (total > bestScore) {
      bestScore = total;
      best = s;
    }
  });
  return best;
}

/**
 * examples.json for these samples: each label's example stroke, prescaled to EXAMPLE_BOX, so the
 * gesture reference only has to draw it. Written by record mode alongside templates.json.
 */
export function serializeExamplesFile(samples: readonly Sample[]): string {
  const labels = [...new Set(samples.map((s) => s.label))];
  const lines = labels.flatMap((label) => {
    const s = exampleSample(label, samples);
    if (!s) return [];
    const points = fitInBox(s.points, EXAMPLE_BOX, 0).map(([x, y]) => [round1(x), round1(y)]);
    return [`    ${JSON.stringify(label)}: ${JSON.stringify({ pinned: !!s.example, points })}`];
  });
  return `{\n  "version": 1,\n  "examples": {\n${lines.join(',\n')}\n  }\n}\n`;
}
