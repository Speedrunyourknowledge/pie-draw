import { useChat } from '../ai/chat';
import { kbd } from '../platform';
import { useSession, type SaveStatus } from '../session';
import { useStore } from '../store';
import { SparkleIcon } from './ChatPanel';
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
  const chatOpen = useChat((s) => s.open);
  const autosave = useSession((s) => s.enabled);
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
        <SaveIndicator />
      </div>
      {/* Mouse clicks don't focus the buttons, so a later key press doesn't leave a focus ring behind. */}
      <nav className="topbar-actions" onMouseDown={(e) => e.preventDefault()}>
        {/* Switches, not one-shot commands: the track shows the state at a glance. */}
        <button
          className={`gesture-toggle autosave-toggle${autosave ? ' on' : ''}`}
          role="switch"
          aria-checked={autosave}
          onClick={() => useSession.getState().setEnabled(!autosave)}
          data-tip="Automatically saves the canvas and the current chat"
          aria-label="Autosave"
        >
          <CloudIcon />
          <span>Autosave</span>
          <span className="switch" aria-hidden><span className="knob" /></span>
        </button>
        <span className="sep" />
        <button
          className={`gesture-toggle${gesturesOn ? ' on' : ''}`}
          role="switch"
          aria-checked={gesturesOn}
          onClick={() => st().setGesturesOn(!gesturesOn)}
          data-tip="Gestures (G)"
          aria-label="Gestures"
        >
          <svg viewBox="0 0 20 20">
            <path d="M3 14 C5 6 8 5 9 9 S12 15 14 8" />
            <path d="M14.5 3.5 V6 M13.25 4.75 H15.75 M17 9 V10.6 M16.2 9.8 H17.8" className="sparkle" />
          </svg>
          <span>Gestures</span>
          <span className="switch" aria-hidden><span className="knob" /></span>
        </button>
        <button className="gesture-info" onClick={() => st().setGestureGuideOpen(true)} data-tip="Gesture reference" aria-label="Gesture reference">
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
          data-tip={canPaste ? `Paste (${kbd('mod+v')})` : 'Paste: Copy or cut a shape first'}
          aria-label="Paste"
        >
          <svg viewBox="0 0 20 20">
            <path d="M7 4 H5.5 V17 H14.5 V4 H13 M7.5 3 H12.5 V5.5 H7.5 Z" />
          </svg>
          <span>Paste</span>
        </button>
        <span className="sep" />
        <button disabled={!canUndo} onClick={() => st().undo()} data-tip={`Undo (${kbd('mod+z')})`} aria-label="Undo">
          <svg viewBox="0 0 20 20"><path d="M7 5 L3 9 L7 13 M3 9 H12 a4.5 4.5 0 0 1 0 9 H9" /></svg>
          <span>Undo</span>
        </button>
        <button disabled={!canRedo} onClick={() => st().redo()} data-tip={`Redo (${kbd('mod+shift+z')})`} aria-label="Redo">
          <svg viewBox="0 0 20 20"><path d="M13 5 L17 9 L13 13 M17 9 H8 a4.5 4.5 0 0 0 0 9 H11" /></svg>
          <span>Redo</span>
        </button>
        <span className="sep" />
        <button disabled={empty} onClick={() => st().clearAll()} data-tip="Clear all" aria-label="Clear all">
          <svg viewBox="0 0 20 20"><path d="M4 6 H16 M8 6 V4 H12 V6 M6 6 L7 17 H13 L14 6" /></svg>
          <span>Clear all</span>
        </button>
        <button
          className={chatOpen ? 'on' : ''}
          aria-pressed={chatOpen}
          onClick={() => useChat.getState().setOpen(!chatOpen, !chatOpen)}
          data-tip="Assistant (/)"
          aria-label="Assistant"
        >
          <SparkleIcon />
          <span>Assistant</span>
        </button>
        <button className="help-btn" onClick={() => st().setHelpOpen(true)} data-tip="Help (?)" aria-label="Help">
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

const SAVE_LABEL: Record<SaveStatus, string> = {
  saved: 'Saved',
  saving: 'Saving…',
  error: 'Couldn’t save',
};

/** Whether the session is saved in this browser, as Google Docs shows beside a document's name. */
function SaveIndicator() {
  const enabled = useSession((s) => s.enabled);
  const status = useSession((s) => s.status);
  const label = enabled ? SAVE_LABEL[status] : 'Autosave off';
  const tip = !enabled
    ? 'Changes aren’t being saved in the browser'
    : status === 'error'
      ? 'The browser couldn’t save this session'
      : 'Changes are saved in the browser';
  return (
    <span className={`save-status ${enabled ? status : 'off'}`} data-tip={tip} role="status">
      {label}
    </span>
  );
}

function CloudIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden>
      <path d="M6 15.5 H14.5 a3.25 3.25 0 0 0 .4 -6.48 A5 5 0 0 0 5.3 8.6 A3.45 3.45 0 0 0 6 15.5 Z" />
    </svg>
  );
}
