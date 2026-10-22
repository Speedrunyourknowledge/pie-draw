import { GESTURES, GESTURE_SECTIONS, describeAction, sectionOf } from '../gestures/gestureConfig';
import { EXAMPLE_BOX, examples } from '../gestures/examples';
import { useStore } from '../store';
import type { Pt } from '../types';
import { StrokeMarks } from './StrokeMarks';

const Key = ({ children }: { children: string }) => <b className="key">{children}</b>;

const THUMB = 64;
/** Room around an example stroke (stored filling 0..EXAMPLE_BOX) for its start dot and arrows. */
const PAD = EXAMPLE_BOX * 0.14;
const EXAMPLE_VIEW = `${-PAD} ${-PAD} ${EXAMPLE_BOX + 2 * PAD} ${EXAMPLE_BOX + 2 * PAD}`;

/** Scribble erase is a heuristic, not a template, so it gets a drawn illustration instead of a sample. */
const SCRIBBLE: Pt[] = [[14, 22], [50, 18], [12, 32], [52, 28], [14, 42], [50, 38], [16, 50]];

/** Reference of every gesture and what it does, built from the gesture config and recorded samples. */
export function GestureGuide() {
  const open = useStore((s) => s.gestureGuideOpen);
  const swapped = useStore((s) => s.panelSwapped);
  const close = () => useStore.getState().setGestureGuideOpen(false);
  if (!open) return null;

  return (
    <div className={`help-backdrop${swapped ? ' swapped' : ''}`} onPointerDown={close}>
      <div className="help gesture-guide" role="dialog" aria-label="Gestures" onPointerDown={(e) => e.stopPropagation()}>
        <button className="help-link help-back" onClick={() => useStore.getState().setHelpOpen(true)}>
          ← Back to help menu
        </button>
        <header className="help-head">
          <h2>Gestures</h2>
          <button className="help-close" onClick={close} aria-label="Close gestures">
            <svg viewBox="0 0 20 20"><path d="M5 5 L15 15 M15 5 L5 15" /></svg>
          </button>
        </header>
        <p>
          With <b>Gestures</b> on (top bar, or <Key>G</Key>), draw one of these in a single stroke. Each picture starts at
          the <span className="guide-start" aria-hidden /> green dot and follows the arrows. Turn Gestures off to draw freely.
        </p>

        {GESTURE_SECTIONS.map(({ name, note }) => (
          <section key={name}>
            <h3>{name}</h3>
            <p className="guide-note">{note}</p>
            <div className="guide-grid">
              {GESTURES.filter((g) => sectionOf(g.action) === name).map((g) => {
                const example = examples.get(g.label); // prescaled by record mode, so it's only drawn
                return (
                  <figure className="guide-item" key={g.label}>
                    {example ? (
                      <svg className="guide-thumb" viewBox={EXAMPLE_VIEW} aria-hidden>
                        <StrokeMarks points={example.points} scale={0.9} />
                      </svg>
                    ) : (
                      <div className="guide-thumb missing" title="No samples recorded yet (record them with RECORD_MODE=true)">
                        not recorded
                      </div>
                    )}
                    <figcaption>
                      <b>
                        {g.action.kind === 'setColor' && <span className="guide-swatch" style={{ background: g.action.color }} />}
                        {describeAction(g.action)}
                      </b>
                      <span>{g.hint}</span>
                    </figcaption>
                  </figure>
                );
              })}
            </div>
          </section>
        ))}

        <section>
          <h3>Delete</h3>
          <div className="guide-grid">
            <figure className="guide-item">
              <svg className="guide-thumb" viewBox={`0 0 ${THUMB} ${THUMB}`} aria-hidden>
                <rect className="guide-target" x="18" y="16" width="28" height="32" />
                <StrokeMarks points={SCRIBBLE} scale={0.45} />
              </svg>
              <figcaption>
                <b>Delete the shapes it crosses</b>
                <span>Scribble rapidly back and forth over one or more shapes</span>
              </figcaption>
            </figure>
          </div>
        </section>
      </div>
    </div>
  );
}
