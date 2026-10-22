import { useEffect, useMemo, useRef, useState } from 'react';
import { dist, fitInBox } from '../geometry';
import { GESTURES, describeAction, gestureFor } from '../gestures/gestureConfig';
import { REJECT_THRESHOLD, pathLength, rank, type Match, type Template } from '../gestures/recognizer';
import {
  buildTemplates,
  exampleSample,
  parseTemplateFile,
  recordedSamples,
  sampleTemplates,
  serializeExamplesFile,
  serializeTemplateFile,
  type Sample,
} from '../gestures/templates';
import { isMod, kbd } from '../platform';
import { useStore } from '../store';
import type { Pt } from '../types';
import { StrokeMarks } from './StrokeMarks';

/**
 * Hidden mode for recording gesture training samples, opened by starting the app with RECORD_MODE=true.
 * Pick a label, draw, accept or discard, and save the set to src/gestures/templates.json.
 * Unsaved work is kept in localStorage, so a reload doesn't lose it.
 */

const DRAFT_KEY = 'pie-draw:record-draft';
const LABEL_KEY = 'pie-draw:record-label';
const MIN_LENGTH = 20; // px; shorter strokes are taken as slips and ignored
const TARGET = 10; // samples per label before it counts as covered (the assignment asks for 5–10)

interface Rec extends Sample {
  id: number;
}

/** An undoable change: a kept sample, or a deleted one and where it was in the list. */
type Edit = { kind: 'keep'; id: number } | { kind: 'delete'; rec: Rec; index: number };

let nextId = 1;
const withIds = (samples: Sample[]): Rec[] => samples.map((s) => ({ ...s, id: nextId++ }));
/** A sample as it's saved (points rounded), ignoring the example flag, to tell saved samples from new ones. */
const sampleKey = (s: Sample) => serializeTemplateFile([{ label: s.label, points: s.points }]);

function readDraft(): Sample[] | null {
  try {
    const raw = localStorage.getItem(DRAFT_KEY);
    return raw ? parseTemplateFile(JSON.parse(raw)).samples : null;
  } catch {
    return null;
  }
}

function store(key: string, value: string | null) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable (private window): record mode still works, just without the safety net.
  }
}

/**
 * Leave-one-out: each sample recognized against every other sample. A sample whose class has no
 * other samples can't be matched yet, so it gets no result.
 */
function leaveOneOut(samples: Rec[]): Map<number, Match | null> {
  const temps = new Map<number, Template[]>(samples.map((s) => [s.id, sampleTemplates(s)]));
  const out = new Map<number, Match | null>();
  for (const s of samples) {
    if (!samples.some((o) => o.id !== s.id && o.label === s.label)) continue;
    const others = samples.flatMap((o) => (o.id !== s.id ? temps.get(o.id)! : []));
    out.set(s.id, rank(s.points, others)[0] ?? null);
  }
  return out;
}

export function RecordMode() {
  const open = useStore((s) => s.recordOpen);
  if (!open) return null;
  return <Recorder />;
}

function Recorder() {
  const [saved, setSaved] = useState(() => serializeTemplateFile(recordedSamples));
  const [samples, setSamples] = useState<Rec[]>(() => withIds(readDraft() ?? recordedSamples));
  const [label, setLabel] = useState(() => {
    try {
      const l = localStorage.getItem(LABEL_KEY);
      if (l) return l;
    } catch {
      // fall through
    }
    return GESTURES[0].label;
  });
  const [pending, setPending] = useState<Pt[] | null>(null);
  const [live, setLive] = useState<Pt[] | null>(null);
  const [autoAccept, setAutoAccept] = useState(false);
  // Kept and deleted samples this session, newest last, for undo.
  const [history, setHistory] = useState<Edit[]>([]);
  const [message, setMessage] = useState<{ text: string; error?: boolean } | null>(null);
  const padRef = useRef<SVGSVGElement>(null);
  const drawing = useRef<Pt[] | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  const json = useMemo(() => serializeTemplateFile(samples), [samples]);
  const dirty = json !== saved;

  // Keep unsaved work across reloads.
  useEffect(() => store(DRAFT_KEY, dirty ? json : null), [json, dirty]);
  useEffect(() => store(LABEL_KEY, label), [label]);

  // The file on disk changed under us (saved, or edited by hand) and there's no draft: show it.
  useEffect(() => {
    const file = serializeTemplateFile(recordedSamples);
    if (file !== saved && !dirty) {
      setSaved(file);
      setSamples(withIds(recordedSamples));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- recordedSamples changes only on module reload
  }, [recordedSamples]);

  // Configured gestures first, then any labels in the data that the config no longer has.
  const labels = useMemo(() => {
    const extra = [...new Set(samples.map((s) => s.label))].filter((l) => !gestureFor(l));
    return [...GESTURES.map((g) => g.label), ...extra];
  }, [samples]);
  const counts = useMemo(() => {
    const c = new Map<string, number>();
    for (const s of samples) c.set(s.label, (c.get(s.label) ?? 0) + 1);
    return c;
  }, [samples]);

  // Samples not yet in the saved file, so the counts show what a save would add.
  const unsaved = useMemo(() => {
    const left = new Map<string, number>();
    for (const s of parseTemplateFile(JSON.parse(saved)).samples) left.set(sampleKey(s), (left.get(sampleKey(s)) ?? 0) + 1);
    const out = new Set<number>();
    for (const s of samples) {
      const k = sampleKey(s), n = left.get(k) ?? 0;
      if (n > 0) left.set(k, n - 1);
      else out.add(s.id);
    }
    return out;
  }, [samples, saved]);

  const templates = useMemo(() => buildTemplates(samples), [samples]);
  const loo = useMemo(() => leaveOneOut(samples), [samples]);
  const matches = useMemo(() => (pending ? rank(pending, templates).slice(0, 3) : []), [pending, templates]);
  const ofLabel = samples.filter((s) => s.label === label);
  const unsavedOfLabel = ofLabel.filter((s) => unsaved.has(s.id)).length;
  const shown = useMemo(() => exampleSample(label, samples), [label, samples]); // the reference's picture
  const failing = samples.filter((s) => {
    const m = loo.get(s.id);
    return m && (m.label !== s.label || m.score < REJECT_THRESHOLD);
  }).length;
  const def = gestureFor(label);

  const flash = (text: string, error = false) => setMessage({ text, error });

  const accept = (points: Pt[] | null = pending) => {
    if (!points) return;
    const rec = { label, points, id: nextId++ };
    setSamples((s) => [...s, rec]);
    setHistory((h) => [...h, { kind: 'keep', id: rec.id }]);
    setPending(null);
  };
  const discard = () => setPending(null);
  const undo = () => {
    const last = history[history.length - 1];
    if (!last) return;
    setHistory((h) => h.slice(0, -1));
    if (last.kind === 'keep') setSamples((s) => s.filter((x) => x.id !== last.id));
    else setSamples((s) => [...s.slice(0, last.index), last.rec, ...s.slice(last.index)]);
  };
  const remove = (id: number) => {
    const index = samples.findIndex((x) => x.id === id);
    if (index < 0) return;
    setHistory((h) => [...h, { kind: 'delete', rec: samples[index], index }]);
    setSamples((s) => s.filter((x) => x.id !== id));
  };
  /** Makes a sample its label's example in the gesture reference (one per label), or unpins it. */
  const toggleExample = (id: number) =>
    setSamples((all) => {
      const target = all.find((x) => x.id === id)!;
      const on = !target.example;
      return all.map((x) => (x.label !== target.label ? x : { ...x, example: on && x.id === id }));
    });

  const save = async () => {
    try {
      // The gesture reference's pictures are worked out here, once, and saved alongside the samples.
      const body = JSON.stringify({ templates: json, examples: serializeExamplesFile(samples) });
      const res = await fetch('/__gesture-templates', { method: 'POST', body });
      if (!res.ok) throw new Error(await res.text());
      setSaved(json);
      flash(`Saved ${unsaved.size} new (${samples.length} in all) to src/gestures/templates.json and examples.json`);
    } catch (err) {
      flash(`Save failed: ${err instanceof Error ? err.message : err}. Use Download instead.`, true);
    }
  };

  /** Both files, for copying into src/gestures/ by hand when there's no dev server to save to. */
  const download = () => {
    const files: [string, string][] = [
      ['templates.json', json],
      ['examples.json', serializeExamplesFile(samples)],
    ];
    for (const [name, text] of files) {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
      a.download = name;
      a.click();
      URL.revokeObjectURL(a.href);
    }
  };

  const importFile = async (file: File) => {
    try {
      const more = parseTemplateFile(JSON.parse(await file.text())).samples;
      setSamples((s) => [...s, ...withIds(more)]);
      flash(`Added ${more.length} samples from ${file.name}`);
    } catch (err) {
      flash(`Couldn't import ${file.name}: ${err instanceof Error ? err.message : err}`, true);
    }
  };

  /** Loads the templates.json from before the last save, as unsaved changes; saving makes it current again. */
  const restoreBackup = async () => {
    try {
      const res = await fetch('/__gesture-templates/backup');
      if (!res.ok) throw new Error(await res.text());
      const backup = parseTemplateFile(await res.json()).samples;
      setSamples(withIds(backup));
      setHistory([]);
      setPending(null);
      flash(`Loaded ${backup.length} samples from before the last save. Save to keep them, or Revert.`);
    } catch (err) {
      flash(`Couldn't load the backup: ${err instanceof Error ? err.message : err}`, true);
    }
  };

  const revert = () => {
    setSamples(withIds(recordedSamples));
    setHistory([]);
    setPending(null);
    flash('Reverted to templates.json');
  };

  // ---- drawing pad ----

  const toPad = (e: React.PointerEvent): Pt => {
    const r = padRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    drawing.current = [toPad(e)];
    setLive(drawing.current);
    setPending(null); // drawing again replaces an unaccepted stroke
  };
  const onMove = (e: React.PointerEvent) => {
    const pts = drawing.current;
    if (!pts) return;
    const p = toPad(e);
    if (dist(p, pts[pts.length - 1]) < 1) return;
    pts.push(p);
    setLive(pts.slice());
  };
  const onUp = () => {
    const pts = drawing.current;
    drawing.current = null;
    setLive(null);
    if (!pts || pts.length < 2 || pathLength(pts) < MIN_LENGTH) return;
    if (autoAccept) accept(pts);
    else setPending(pts);
  };

  // ---- keys ----

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof HTMLInputElement) return;
      const key = e.key;
      let handled = true;
      if (isMod(e) && key.toLowerCase() === 'z') undo();
      else if (isMod(e) && key.toLowerCase() === 's') {
        if (dirty) void save();
      }
      else if (isMod(e) || e.altKey) handled = false;
      else if (key === 'Enter') accept();
      else if (key === 'Escape') discard();
      else if (key === 'ArrowDown' || key === 'ArrowUp') {
        const i = labels.indexOf(label) + (key === 'ArrowDown' ? 1 : -1);
        setLabel(labels[(i + labels.length) % labels.length]);
        setPending(null);
      } else handled = false;
      if (handled) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useEffect(() => {
    if (!message) return;
    const t = window.setTimeout(() => setMessage(null), 4000);
    return () => window.clearTimeout(t);
  }, [message]);

  const best = matches[0];

  return (
    <div className="record" onMouseDown={(e) => e.target instanceof HTMLButtonElement && e.preventDefault()}>
      <header className="record-bar">
        <div className="record-title">
          <span className="rec-dot" /> Record gestures
          <span className="record-total">
            {samples.length} samples{failing > 0 && <> · <span className="rec-bad">{failing} misrecognized</span></>}
            {unsaved.size > 0 && <span className="dirty"> · {unsaved.size} new, not saved yet</span>}
            {dirty && unsaved.size === 0 && <span className="dirty" title="Unsaved changes"> • unsaved</span>}
          </span>
        </div>
        <div className="record-actions">
          <label className="rec-check" title="Keep every stroke without pressing Enter (undo with ⌘Z / Ctrl+Z)">
            <input type="checkbox" checked={autoAccept} onChange={(e) => setAutoAccept(e.target.checked)} /> Auto-accept
          </label>
          <button onClick={() => fileInput.current!.click()} title="Add the samples from a templates.json file">Import…</button>
          <input
            ref={fileInput}
            type="file"
            accept=".json,application/json"
            hidden
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importFile(f);
              e.target.value = '';
            }}
          />
          <button onClick={revert} disabled={!dirty} title="Throw away unsaved changes">Revert</button>
          <button onClick={download} title="Download templates.json and examples.json, to put in src/gestures/">Download</button>
          {import.meta.env.DEV && (
            <button className="primary" onClick={() => void save()} disabled={!dirty} title={`Write src/gestures/templates.json (${kbd('mod+s')})`}>
              Save to project
            </button>
          )}
          {import.meta.env.DEV && (
            <button onClick={() => void restoreBackup()} title="Load templates.backup.json, the samples from before the last save">
              Load backup
            </button>
          )}
          <button onClick={() => useStore.getState().setRecordOpen(false)} title="Back to drawing">Exit</button>
        </div>
      </header>

      <nav className="record-labels">
        {labels.map((l) => {
          const n = counts.get(l) ?? 0;
          return (
            <button
              key={l}
              className={`rec-label${l === label ? ' on' : ''}${gestureFor(l) ? '' : ' orphan'}`}
              onClick={() => {
                setLabel(l);
                setPending(null);
              }}
              title={gestureFor(l)?.hint ?? 'Not in gestureConfig.ts: these samples are recognized but do nothing'}
            >
              <span>{l}</span>
              <span className={`rec-count${n >= TARGET ? ' done' : ''}`}>
                {n}/{TARGET}
              </span>
            </button>
          );
        })}
        <p className="rec-help">
          ↑ ↓ change gesture<br />
          Enter keep · Esc discard<br />
          {kbd('mod+z')} undo keep or delete
        </p>
      </nav>

      <main className="record-main">
        <div className="rec-prompt">
          <b>{label}</b> <span>{def ? `${describeAction(def.action)} · ${def.hint}` : 'Not in gestureConfig.ts'}</span>
          <span className={`rec-progress${ofLabel.length >= TARGET ? ' done' : ''}`}>
            {ofLabel.length} of {TARGET} samples
            {unsavedOfLabel > 0 && <span className="dirty"> · {unsavedOfLabel} not saved yet</span>}
          </span>
        </div>
        <svg ref={padRef} className="rec-pad" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}>
          {live && live.length > 1 && <polyline className="rec-stroke" points={live.map((p) => p.join(',')).join(' ')} />}
          {pending && <StrokeMarks points={pending} />}
          {!live && !pending && (
            <text className="rec-placeholder" x="50%" y="50%">
              Draw a {label} sample
            </text>
          )}
        </svg>
        <div className="rec-result">
          {pending ? (
            <>
              <span className="rec-matches">
                {best ? (
                  <>
                    Recognized as{' '}
                    <b className={best.label === label && best.score >= REJECT_THRESHOLD ? 'rec-good' : 'rec-bad'}>
                      {best.label} {best.score.toFixed(3)}
                    </b>
                    {matches.slice(1).map((m) => (
                      <span key={m.label} className="rec-next">
                        {' '}· {m.label} {m.score.toFixed(3)}
                      </span>
                    ))}
                    {best.score < REJECT_THRESHOLD && <span className="rec-next"> · below reject threshold {REJECT_THRESHOLD}</span>}
                  </>
                ) : (
                  'No samples to compare against yet'
                )}
              </span>
            </>
          ) : (
            <span className="rec-next">
              Vary size, speed and proportions. The green dot marks the start, the arrow the end.
            </span>
          )}
          <span className="rec-buttons">
            <button onClick={discard} disabled={!pending} title="Throw this stroke away (Esc)">Discard</button>
            <button className="primary" onClick={() => accept()} disabled={!pending} title="Keep this stroke as a sample (Enter)">
              Keep sample
            </button>
          </span>
        </div>
        <section className="rec-samples">
          {ofLabel.length === 0 && <span className="rec-next">No {label} samples yet.</span>}
          {ofLabel.map((s, i) => {
            const m = loo.get(s.id);
            const bad = m && (m.label !== s.label || m.score < REJECT_THRESHOLD);
            const tip = m
              ? `Against the other samples: ${m.label} ${m.score.toFixed(3)}${bad ? (m.label !== s.label ? ' (wrong class)' : ' (below threshold)') : ''}`
              : 'Needs another sample of this gesture to compare against';
            return (
              <figure key={s.id} className={`rec-thumb${bad ? ' bad' : ''}${s === shown ? ' shown' : ''}`} title={tip}>
                <svg viewBox="0 0 72 72">
                  <StrokeMarks points={fitInBox(s.points, 72, 10)} scale={0.5} />
                </svg>
                <figcaption>
                  {i + 1}
                  {bad && m && m.label !== s.label && <span className="rec-bad"> → {m.label}</span>}
                  {s === shown && !(bad && m && m.label !== s.label) && (
                    <span className="rec-example"> · {s.example ? 'example' : 'auto example'}</span>
                  )}
                </figcaption>
                <button
                  className={`rec-star${s.example ? ' on' : ''}`}
                  onClick={() => toggleExample(s.id)}
                  title={s.example ? 'Stop using as the example (go back to the most typical sample)' : 'Use as the example in the gesture reference'}
                  aria-label={s.example ? 'Unset example' : 'Use as example'}
                  aria-pressed={!!s.example}
                >
                  {s.example ? '★' : '☆'}
                </button>
                <button className="rec-del" onClick={() => remove(s.id)} title={`Delete this sample (undo with ${kbd('mod+z')})`} aria-label="Delete sample">
                  ×
                </button>
              </figure>
            );
          })}
        </section>
      </main>

      {message && (
        <div key={message.text} className={`toast${message.error ? ' toast-error' : ''}`} role="status">
          {message.text}
        </div>
      )}
    </div>
  );
}
