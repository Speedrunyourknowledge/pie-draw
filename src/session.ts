import { create } from 'zustand';
import { restoreChat, useChat, type LogItem } from './ai/chat';
import { useStore } from './store';

// Keeps the session (the drawing, its undo history and view, and the chat messages) in IndexedDB,
// so a reload doesn't lose it: the dev server reloading after the computer sleeps, the browser
// discarding a background tab, or an accidental refresh. IndexedDB rather than localStorage, which
// holds only a few megabytes, less than a long undo history can take.
//
// Of the chat, only the user's messages and the assistant's replies are kept: what the panel shows
// after a reload. Thinking, tool calls, error notes and attached pictures aren't.

const DB = 'pie-draw';
const STORE = 'session';
const KEY = 'current';
const VERSION = 2;
const ENABLED_KEY = 'pie-draw:autosave';
/** Saves at most this often (ms) while things change; nothing is written while nothing changes. */
const SAVE_INTERVAL = 5000;

type Doc = ReturnType<typeof useStore.getState>;

export interface SavedMessage {
  kind: 'user' | 'assistant';
  text: string;
}

interface Saved {
  version: number;
  doc: Pick<Doc, 'shapes' | 'selectedIds' | 'past' | 'future' | 'view' | 'fileHandle' | 'fileName' | 'dirty'>;
  messages: SavedMessage[];
}

/** What the autosave indicator shows. saving: changes not written yet (waiting or being written); error: the last write failed. */
export type SaveStatus = 'saved' | 'saving' | 'error';

interface SessionState {
  enabled: boolean;
  status: SaveStatus;
  /** Turning it off stops saving; the last save is kept and still comes back on reload. */
  setEnabled: (enabled: boolean) => void;
}

function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) !== '0';
  } catch {
    return true;
  }
}

export const useSession = create<SessionState>()((set) => ({
  enabled: readEnabled(),
  status: 'saved',
  setEnabled: (enabled) => {
    try {
      localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
    } catch {
      // Storage unavailable: the choice lasts until reload.
    }
    set({ enabled });
  },
}));

// ---- storage ----

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

let db: Promise<IDBDatabase> | null = null;
const getDb = () => (db ??= openDb());

async function run<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const store = (await getDb()).transaction(STORE, mode).objectStore(STORE);
  return new Promise((resolve, reject) => {
    const req = fn(store);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/** The messages worth keeping: the user's and the assistant's, with text. */
const messagesOf = (log: LogItem[]): SavedMessage[] =>
  log.flatMap((item) => ((item.kind === 'user' || item.kind === 'assistant') && item.text.trim() ? [{ kind: item.kind, text: item.text }] : []));

function snapshot(): Saved {
  const d = useStore.getState();
  return {
    version: VERSION,
    doc: {
      shapes: d.shapes,
      selectedIds: d.selectedIds,
      past: d.past,
      future: d.future,
      view: d.view,
      fileHandle: d.fileHandle,
      fileName: d.fileName,
      dirty: d.dirty,
    },
    messages: messagesOf(useChat.getState().log),
  };
}

async function write(data: Saved) {
  try {
    await run('readwrite', (s) => s.put(data, KEY));
  } catch {
    // Some browsers can't store a file handle; the drawing matters more than Save going to the same file.
    await run('readwrite', (s) => s.put({ ...data, doc: { ...data.doc, fileHandle: null } }, KEY));
  }
}

// ---- restoring ----

/** Puts back the last session, if there is one. Call before the app first renders. */
export async function restoreSession(): Promise<void> {
  let saved: (Saved & { chat?: { log: LogItem[] } }) | undefined;
  try {
    saved = await run('readonly', (s) => s.get(KEY));
  } catch {
    return;
  }
  if (!saved?.doc) return;
  // Version 1 kept the whole chat log; its messages are taken from it.
  const messages = saved.version === 1 ? messagesOf(saved.chat?.log ?? []) : saved.version === VERSION ? saved.messages : null;
  if (!messages) return;
  useStore.setState(saved.doc);
  restoreChat(messages);
}

// ---- saving ----

/**
 * Whether two shape lists are the same drawing. Edits replace the shapes they touch with new
 * objects, so only those are compared by value; the rest are the same objects and skipped.
 */
function sameShapes(a: Doc['shapes'], b: Doc['shapes']): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i] && JSON.stringify(a[i]) !== JSON.stringify(b[i])) return false;
  }
  return true;
}

/**
 * Saves the session at most every SAVE_INTERVAL while it changes, and right away when the page is
 * hidden or closed. Changes are changes to the shapes and new or longer chat messages; selecting,
 * panning, thinking and tool activity aren't.
 */
export function autosaveSession(): void {
  let timer: ReturnType<typeof setTimeout> | undefined;
  let pending = false;
  let writing: Promise<void> | null = null;
  const session = useSession;

  const save = async () => {
    clearTimeout(timer);
    timer = undefined;
    if (!pending || !session.getState().enabled) return;
    if (writing) await writing; // one write at a time, so an older one can't land last
    pending = false;
    writing = write(snapshot()).then(
      // Changes made during the write are still waiting for the next one.
      () => session.setState({ status: pending ? 'saving' : 'saved' }),
      () => session.setState({ status: 'error' }),
    );
    await writing;
    writing = null;
  };

  const changed = () => {
    if (!session.getState().enabled) return;
    pending = true;
    session.setState({ status: 'saving' });
    timer ??= setTimeout(() => void save(), SAVE_INTERVAL);
  };

  // Only a real change to the shapes counts: not selecting, panning or zooming, and not an action
  // that leaves the shapes as they were (a press that records an undo step but moves nothing). The
  // selection, view and undo history are still saved, along with the next real change.
  useStore.subscribe((st, prev) => {
    if (!sameShapes(st.shapes, prev.shapes)) changed();
  });

  // Compared by message, so thinking and status updates (which change the log too) don't count.
  const key = (log: LogItem[]) => messagesOf(log).map((m) => `${m.kind}:${m.text.length}`).join(',');
  let lastKey = key(useChat.getState().log);
  useChat.subscribe((st, prev) => {
    if (st.log === prev.log) return;
    const k = key(st.log);
    if (k === lastKey) return;
    lastKey = k;
    changed();
  });

  session.subscribe((st, prev) => {
    if (st.enabled === prev.enabled) return;
    if (st.enabled) {
      // Back on: save how things are now, since changes made while off weren't tracked.
      session.setState({ status: 'saving' });
      pending = true;
      timer ??= setTimeout(() => void save(), SAVE_INTERVAL);
    } else {
      clearTimeout(timer);
      timer = undefined;
      pending = false;
    }
  });

  const now = () => void save();
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') now();
  });
  window.addEventListener('pagehide', now);
}
