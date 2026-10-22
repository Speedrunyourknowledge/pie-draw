import { kbd } from '../platform';
import { useStore } from '../store';
import { FileMenu } from './FileMenu';

/** App identity, the File menu, and a few always-useful commands. Creation and editing stay in the pie menu. */
export function TopBar() {
  const fileName = useStore((s) => s.fileName);
  const dirty = useStore((s) => s.dirty);
  const canUndo = useStore((s) => s.past.length > 0);
  const canRedo = useStore((s) => s.future.length > 0);
  const empty = useStore((s) => s.shapes.length === 0);
  const canPaste = useStore((s) => s.clipboard !== null);
  const gesturesOn = useStore((s) => s.gesturesOn);
  const st = useStore.getState;

  return (
    <header className="topbar">
      <div className="brand">
        <svg viewBox="-10 -10 20 20" className="brand-mark" aria-hidden>
          <circle r="9" className="brand-ring" />
          <path d="M0 0 L0 -9 A9 9 0 0 1 7.8 -4.5 Z" className="brand-slice" />
        </svg>
        <span className="brand-name">Pie Draw</span>
        <FileMenu />
        <span className="doc-name">
          {fileName ?? 'Untitled'}
          {dirty && <span className="dirty" title="Unsaved changes"> •</span>}
        </span>
      </div>
      {/* Mouse clicks don't focus the buttons, so a later key press doesn't leave a focus ring behind. */}
      <nav className="topbar-actions" onMouseDown={(e) => e.preventDefault()}>
        {/* A switch, not a one-shot command: the track shows the state at a glance. */}
        <button
          className={`gesture-toggle${gesturesOn ? ' on' : ''}`}
          role="switch"
          aria-checked={gesturesOn}
          onClick={() => st().setGesturesOn(!gesturesOn)}
          title={gesturesOn ? 'Gestures on: strokes are recognized as commands and shapes. Click for plain drawing. (G)' : 'Gestures off: strokes stay as drawn. Click to turn gestures on. (G)'}
        >
          <svg viewBox="0 0 20 20">
            <path d="M3 14 C5 6 8 5 9 9 S12 15 14 8" />
            <path d="M14.5 3.5 V6 M13.25 4.75 H15.75 M17 9 V10.6 M16.2 9.8 H17.8" className="sparkle" />
          </svg>
          <span>Gestures</span>
          <span className="switch" aria-hidden><span className="knob" /></span>
        </button>
        <button className="gesture-info" onClick={() => st().setGestureGuideOpen(true)} title="Gesture reference" aria-label="Gesture reference">
          <svg viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M10 9 V14" />
            <circle cx="10" cy="6.2" r=".6" className="dot" />
          </svg>
        </button>
        <span className="sep" />
        <button
          disabled={!canPaste}
          onClick={() => st().paste()}
          title={canPaste ? `Paste (${kbd('mod+v')})` : 'Paste: copy or cut a shape first'}
        >
          <svg viewBox="0 0 20 20">
            <path d="M7 4 H5.5 V17 H14.5 V4 H13 M7.5 3 H12.5 V5.5 H7.5 Z" />
          </svg>
          <span>Paste</span>
        </button>
        <span className="sep" />
        <button disabled={!canUndo} onClick={() => st().undo()} title={`Undo (${kbd('mod+z')})`}>
          <svg viewBox="0 0 20 20"><path d="M7 5 L3 9 L7 13 M3 9 H12 a4.5 4.5 0 0 1 0 9 H9" /></svg>
          <span>Undo</span>
        </button>
        <button disabled={!canRedo} onClick={() => st().redo()} title={`Redo (${kbd('mod+shift+z')})`}>
          <svg viewBox="0 0 20 20"><path d="M13 5 L17 9 L13 13 M17 9 H8 a4.5 4.5 0 0 0 0 9 H11" /></svg>
          <span>Redo</span>
        </button>
        <span className="sep" />
        <button disabled={empty} onClick={() => st().clearAll()} title="Remove every shape (undoable)">
          <svg viewBox="0 0 20 20"><path d="M4 6 H16 M8 6 V4 H12 V6 M6 6 L7 17 H13 L14 6" /></svg>
          <span>Clear all</span>
        </button>
        <button className="help-btn" onClick={() => st().setHelpOpen(true)} title="Help (?)">
          <svg viewBox="0 0 20 20">
            <circle cx="10" cy="10" r="7.5" />
            <path d="M7.8 8 a2.3 2.3 0 1 1 3.2 2.1 c-.7.3-1 .8-1 1.5 V12.5" />
            <circle cx="10" cy="15" r=".6" className="dot" />
          </svg>
          <span>Help</span>
        </button>
      </nav>
    </header>
  );
}
