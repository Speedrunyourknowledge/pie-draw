// Gesture accuracy and speed on the test strokes in holdout.json, which are never used as templates.
// Scores each test stroke twice: by the recognizer alone (its best match is the right gesture and
// clears the reject threshold) and by the app's full pipeline (recognizer plus heuristics, as the
// canvas runs it). Prints per-gesture and per-section tables and the time per stroke, and saves it all
// as JSON. Run with `npm run eval`, or `npm run eval -- path/to/out.json` (default tmp/eval.json).
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { createServer } from 'vite';

const OUT = process.argv[2] ?? 'tmp/eval.json';
const WARMUP = 500; // calls of each kind before timing
const ROUNDS = 7; // timing rounds; the median round is reported
const RUNS = 2000; // calls per round

const server = await createServer({ server: { middlewareMode: true }, appType: 'custom', logLevel: 'error' });
try {
  const load = (path) => server.ssrLoadModule(path);
  const { REJECT_THRESHOLD, rank } = await load('/src/gestures/recognizer.ts');
  const { parseTemplateFile, recordedSamples, templates } = await load('/src/gestures/templates.ts');
  const { GESTURES, GESTURE_SECTIONS, sectionOf } = await load('/src/gestures/gestureConfig.ts');
  const { interpret } = await load('/src/interaction/recognize.ts');
  const holdout = (await load('/src/gestures/holdout.json')).default;

  const test = parseTemplateFile(holdout).samples;
  const misses = [];
  const gestures = GESTURES.map(({ label, action }) => {
    const mine = test.filter((s) => s.label === label);
    let recognizer = 0, pipeline = 0;
    for (const s of mine) {
      const [best] = rank(s.points, templates);
      if (best && best.label === label && best.score >= REJECT_THRESHOLD) recognizer++;
      const got = interpret(s.points)?.gesture ?? null;
      if (got === label) pipeline++;
      else misses.push({ gesture: label, stroke: test.indexOf(s), got: got ?? 'freehand', bestMatch: best?.label ?? null, score: best?.score ?? null });
    }
    return {
      label,
      section: sectionOf(action),
      samples: recordedSamples.filter((s) => s.label === label).length,
      templates: templates.filter((t) => t.label === label).length,
      tests: mine.length,
      recognizer,
      pipeline,
    };
  });

  const total = (rows) => ({
    tests: rows.reduce((n, g) => n + g.tests, 0),
    recognizer: rows.reduce((n, g) => n + g.recognizer, 0),
    pipeline: rows.reduce((n, g) => n + g.pipeline, 0),
  });
  const sections = GESTURE_SECTIONS.map(({ name }) => {
    const rows = gestures.filter((g) => g.section === name);
    return { name, gestures: rows.map((g) => g.label), ...total(rows) };
  });
  const overall = total(gestures);

  // Time per stroke. The pipeline time includes the recognizer, since interpret() ranks first.
  // Rounds alternate between the two so neither gets a warmer cache, and the median round is kept.
  const strokes = test.map((s) => s.points);
  const runRecognizer = (i) => rank(strokes[i % strokes.length], templates);
  const runPipeline = (i) => interpret(strokes[i % strokes.length]);
  const time = (f) => {
    const t = performance.now();
    for (let i = 0; i < RUNS; i++) f(i);
    return (performance.now() - t) / RUNS;
  };
  for (let i = 0; i < WARMUP; i++) {
    runRecognizer(i);
    runPipeline(i);
  }
  const rounds = { recognizer: [], pipeline: [] };
  for (let r = 0; r < ROUNDS; r++) {
    rounds.recognizer.push(time(runRecognizer));
    rounds.pipeline.push(time(runPipeline));
  }
  const median = (xs) => xs.slice().sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  const timeMs = { recognizer: median(rounds.recognizer), pipeline: median(rounds.pipeline) };

  const result = {
    date: new Date().toISOString(),
    node: process.version,
    rejectThreshold: REJECT_THRESHOLD,
    recordedSamples: recordedSamples.length,
    templates: templates.length,
    testStrokes: test.length,
    gestures,
    sections,
    overall,
    misses,
    timeMsPerStroke: { ...timeMs, rounds: ROUNDS, runsPerRound: RUNS },
  };
  await mkdir(dirname(OUT), { recursive: true });
  await writeFile(OUT, JSON.stringify(result, null, 2) + '\n');

  const count = (r) => `${r.recognizer} / ${r.pipeline} of ${r.tests}`;
  const table = (head, rows) => {
    const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
    const line = (cells) => cells.map((c, i) => (i === 0 ? String(c).padEnd(widths[i]) : String(c).padStart(widths[i]))).join('  ');
    return [line(head), ...rows.map(line)].join('\n');
  };
  console.log(`\n${result.recordedSamples} recorded samples → ${result.templates} templates; ${result.testStrokes} test strokes`);
  console.log('Correct: recognizer alone / with heuristics\n');
  console.log(table(['gesture', 'samples', 'templates', 'correct'], gestures.map((g) => [g.label, g.samples, g.templates, count(g)])));
  console.log('');
  console.log(table(['section', 'correct'], [...sections.map((s) => [s.name, count(s)]), ['Overall', count(overall)]]));
  console.log(misses.length ? `\nMisses:\n${misses.map((m) => `  ${m.gesture} test stroke ${m.stroke} → ${m.got} (best match ${m.bestMatch} ${m.score?.toFixed(3)})`).join('\n')}` : '\nNo misses.');
  console.log(`\nTime per stroke (median of ${ROUNDS} rounds × ${RUNS}): recognizer ${timeMs.recognizer.toFixed(3)} ms, with heuristics ${timeMs.pipeline.toFixed(3)} ms`);
  console.log(`Saved to ${OUT}\n`);
} finally {
  await server.close();
}
