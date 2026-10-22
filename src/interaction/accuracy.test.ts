import { describe, it } from 'vitest';
import holdoutData from '../gestures/holdout.json';
import { REJECT_THRESHOLD, rank } from '../gestures/recognizer';
import { parseTemplateFile, recordedSamples, templates } from '../gestures/templates';
import { gestureOf, recognize } from './recognize';

/**
 * Accuracy report on the test strokes in holdout.json, which are never used as templates. Run with
 * `npm run eval`; skipped by `npm test`. Shape gestures go through the full pipeline (recognizer and
 * heuristics); gestures not yet wired to the canvas are scored on the recognizer alone.
 */

/** Mean milliseconds per call, after a warm-up. */
function time(f: (i: number) => void, runs = 2000): number {
  for (let i = 0; i < 200; i++) f(i);
  const t = performance.now();
  for (let i = 0; i < runs; i++) f(i);
  return (performance.now() - t) / runs;
}

const pct = (a: number, b: number) => (b ? `${((100 * a) / b).toFixed(1)}%` : '—');

// The app's tsconfig has no Node types, so reach the variable that `npm run eval` sets through globalThis.
const enabled = !!(globalThis as { process?: { env: Record<string, string | undefined> } }).process?.env.EVAL;

describe.skipIf(!enabled)('accuracy', () => {
  it('reports accuracy on the held-out strokes', () => {
    const test = parseTemplateFile(holdoutData).samples;
    const labels = [...new Set([...recordedSamples, ...test].map((s) => s.label))];
    const lines: string[] = [];
    const misses: string[] = [];
    let correct = 0, recognizerCorrect = 0;

    lines.push(`Templates: ${recordedSamples.length} recorded samples → ${templates.length} templates`);
    lines.push(`Test strokes: ${test.length}\n`);
    lines.push(`${'gesture'.padEnd(12)}${'templates'.padStart(10)}${'tests'.padStart(7)}${'recognizer'.padStart(12)}${'pipeline'.padStart(10)}`);
    for (const label of labels) {
      const mine = test.filter((s) => s.label === label);
      let ok = 0, recOk = 0;
      mine.forEach((s) => {
        const [best] = rank(s.points, templates);
        if (best && best.label === label && best.score >= REJECT_THRESHOLD) recOk++;
        const got = gestureOf(s.points);
        if (got === label) ok++;
        else misses.push(`  ${label} test stroke ${test.indexOf(s)} → ${got ?? 'freehand'} (best match ${best?.label} ${best?.score.toFixed(3)})`);
      });
      correct += ok;
      recognizerCorrect += recOk;
      const n = recordedSamples.filter((s) => s.label === label).length;
      lines.push(`${label.padEnd(12)}${String(n).padStart(10)}${String(mine.length).padStart(7)}${pct(recOk, mine.length).padStart(12)}${pct(ok, mine.length).padStart(10)}`);
    }
    lines.push(`${'overall'.padEnd(12)}${''.padStart(17)}${pct(recognizerCorrect, test.length).padStart(12)}${pct(correct, test.length).padStart(10)}`);
    lines.push(misses.length ? `\nMisses:\n${misses.join('\n')}` : '\nNo misses.');

    const strokes = test.length ? test.map((s) => s.points) : recordedSamples.map((s) => s.points);
    const rankMs = time((i) => rank(strokes[i % strokes.length], templates));
    const fullMs = time((i) => recognize(strokes[i % strokes.length])); // what the canvas runs per stroke
    lines.push(`\nTime per stroke: recognizer ${rankMs.toFixed(3)} ms, recognizer + heuristics ${fullMs.toFixed(3)} ms`);

    console.log(`\n${lines.join('\n')}\n`);
  });
});
