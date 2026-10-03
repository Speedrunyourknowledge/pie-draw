import { create } from 'zustand';
import { canFill, newId } from './geometry';
import { kbd } from './platform';
import { PALETTE, type Shape, type TransformPatch } from './types';

export type Mode = 'idle' | 'drawing' | 'dragging' | 'scaling' | 'erasing' | 'menuOpen';
/** What a plain left-drag does: draw/move (default), pan the view, or erase whole shapes. */
export type Tool = 'draw' | 'hand' | 'eraser';

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'error';
}

export interface View {
  x: number; // screen = world * zoom + (x, y)
  y: number;
  zoom: number;
}

export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
const HOME_VIEW: View = { x: 0, y: 0, zoom: 1 };

const PASTE_OFFSET = 20;
const HISTORY_LIMIT = 100;

interface AppState {
  shapes: Shape[]; // array order = z-order
  selectedId: string | null;
  clipboard: Shape | null;
  currentColor: string; // line color for new shapes and strokes
  currentFill: string | null; // fill for new closed shapes; null = outline only
  mode: Mode;
  fileHandle: FileSystemFileHandle | null; // for Save vs Save As
  fileName: string | null;
  dirty: boolean;
  past: Shape[][];
  future: Shape[][];
  toast: Toast | null;
  view: View; // not part of the document or the undo history
  helpOpen: boolean;
  dropTargetId: string | null; // shape under a color being dragged from the dock
  tool: Tool;

  /** Records the current shapes for undo. Call once before a change (or at the start of a drag). */
  checkpoint: () => void;
  addShape: (shape: Shape, select?: boolean) => void;
  /** Live update without a history entry; pair with checkpoint() at gesture start. */
  updateShape: (id: string, patch: TransformPatch) => void;
  /** Live removal without a history entry; pair with checkpoint() at gesture start. */
  eraseShape: (id: string) => void;
  select: (id: string | null) => void;
  deleteSelected: () => void;
  copy: () => void;
  cut: () => void;
  /** Pastes centered at `at`, or offset from the last copy/paste when omitted. */
  paste: (at?: { x: number; y: number }) => void;
  /** Recolors the selected shape's line, or sets the line color for new shapes. */
  setColor: (color: string) => void;
  /** Recolors one shape's line and makes it the drawing color. */
  recolor: (id: string, color: string) => void;
  /** Changes the selected shape's fill, or sets the fill for new shapes. */
  setFill: (fill: string | null) => void;
  /** Changes one closed shape's fill and makes it the default fill. */
  refill: (id: string, fill: string | null) => void;
  setDropTarget: (id: string | null) => void;
  setTool: (tool: Tool) => void;
  bringToFront: () => void;
  sendToBack: () => void;
  nudge: (dx: number, dy: number) => void;
  undo: () => void;
  redo: () => void;
  newDoc: () => void;
  loadDoc: (shapes: Shape[], handle: FileSystemFileHandle | null, name: string | null) => void;
  markSaved: (handle: FileSystemFileHandle, name: string) => void;
  clearAll: () => void;
  /** Zooms by factor k keeping the screen point `at` fixed. */
  zoomBy: (k: number, at: { x: number; y: number }) => void;
  panBy: (dx: number, dy: number) => void;
  setView: (view: View) => void;
  setHelpOpen: (open: boolean) => void;
  setMode: (mode: Mode) => void;
  showToast: (text: string, kind?: Toast['kind']) => void;
}

function cloneShape(s: Shape): Shape {
  return { ...structuredClone(s), id: newId() };
}

export const useStore = create<AppState>()((set, get) => {
  /** Applies a document change with an undo entry. */
  const change = (next: Partial<AppState> & { shapes: Shape[] }) =>
    set((st) => ({
      ...next,
      past: [...st.past, st.shapes].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    }));

  const selected = () => {
    const { shapes, selectedId } = get();
    return shapes.find((s) => s.id === selectedId) ?? null;
  };

  return {
    shapes: [],
    selectedId: null,
    clipboard: null,
    currentColor: PALETTE[0].value,
    currentFill: null,
    mode: 'idle',
    fileHandle: null,
    fileName: null,
    dirty: false,
    past: [],
    future: [],
    toast: null,
    view: HOME_VIEW,
    helpOpen: false,
    dropTargetId: null,
    tool: 'draw',

    checkpoint: () =>
      set((st) => ({ past: [...st.past, st.shapes].slice(-HISTORY_LIMIT), future: [], dirty: true })),

    addShape: (shape, select = true) =>
      change({
        shapes: [...get().shapes, shape],
        selectedId: select ? shape.id : get().selectedId,
      }),

    updateShape: (id, patch) =>
      set((st) => ({
        shapes: st.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      })),

    select: (id) => set({ selectedId: id }),

    eraseShape: (id) =>
      set((st) => ({
        shapes: st.shapes.filter((s) => s.id !== id),
        selectedId: st.selectedId === id ? null : st.selectedId,
      })),

    deleteSelected: () => {
      const { selectedId, shapes } = get();
      if (!selectedId) return;
      change({ shapes: shapes.filter((s) => s.id !== selectedId), selectedId: null });
    },

    copy: () => {
      const s = selected();
      if (s) set({ clipboard: structuredClone(s) });
    },

    cut: () => {
      const s = selected();
      if (!s) return;
      set({ clipboard: structuredClone(s) });
      get().deleteSelected();
    },

    paste: (at) => {
      const { clipboard, shapes } = get();
      if (!clipboard) {
        get().showToast('Clipboard is empty');
        return;
      }
      const pasted = cloneShape(clipboard);
      if (at) {
        pasted.x = at.x;
        pasted.y = at.y;
      } else {
        pasted.x += PASTE_OFFSET;
        pasted.y += PASTE_OFFSET;
      }
      // Next keyboard paste cascades from this one instead of stacking on it.
      change({ shapes: [...shapes, pasted], selectedId: pasted.id });
      set({ clipboard: structuredClone(pasted) });
    },

    setColor: (color) => {
      const s = selected();
      if (s) get().recolor(s.id, color);
      else set({ currentColor: color });
    },

    recolor: (id, color) => {
      set({ currentColor: color });
      const s = get().shapes.find((x) => x.id === id);
      if (!s || s.stroke === color) return;
      change({ shapes: get().shapes.map((x) => (x.id === id ? { ...x, stroke: color } : x)) });
    },

    setFill: (fill) => {
      const s = selected();
      if (s) get().refill(s.id, fill);
      else set({ currentFill: fill });
    },

    refill: (id, fill) => {
      const s = get().shapes.find((x) => x.id === id);
      if (!s || !canFill(s)) return; // open lines have no inside to fill
      set({ currentFill: fill });
      if (s.fill === fill) return;
      change({ shapes: get().shapes.map((x) => (x.id === id ? { ...x, fill } : x)) });
    },

    setDropTarget: (dropTargetId) => set({ dropTargetId }),

    setTool: (tool) => set({ tool, selectedId: tool === 'draw' ? get().selectedId : null }),

    bringToFront: () => {
      const s = selected();
      if (!s) return;
      change({ shapes: [...get().shapes.filter((x) => x.id !== s.id), s] });
    },

    sendToBack: () => {
      const s = selected();
      if (!s) return;
      change({ shapes: [s, ...get().shapes.filter((x) => x.id !== s.id)] });
    },

    nudge: (dx, dy) => {
      const s = selected();
      if (!s) return;
      change({
        shapes: get().shapes.map((x) => (x.id === s.id ? { ...x, x: x.x + dx, y: x.y + dy } : x)),
      });
    },

    undo: () => {
      const { past, shapes, future, selectedId } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      set({
        shapes: prev,
        past: past.slice(0, -1),
        future: [shapes, ...future],
        selectedId: prev.some((s) => s.id === selectedId) ? selectedId : null,
        dirty: true,
      });
    },

    redo: () => {
      const { past, shapes, future, selectedId } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        shapes: next,
        past: [...past, shapes],
        future: future.slice(1),
        selectedId: next.some((s) => s.id === selectedId) ? selectedId : null,
        dirty: true,
      });
    },

    clearAll: () => {
      if (get().shapes.length === 0) return;
      change({ shapes: [], selectedId: null });
      get().showToast(`Cleared all shapes · ${kbd('mod+z')} to undo`);
    },

    zoomBy: (k, at) =>
      set(({ view }) => {
        const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, view.zoom * k));
        const f = zoom / view.zoom;
        return { view: { zoom, x: at.x - (at.x - view.x) * f, y: at.y - (at.y - view.y) * f } };
      }),

    panBy: (dx, dy) => set(({ view }) => ({ view: { ...view, x: view.x + dx, y: view.y + dy } })),

    setView: (view) => set({ view }),

    setHelpOpen: (helpOpen) => set({ helpOpen }),

    newDoc: () =>
      set({
        view: HOME_VIEW,
        shapes: [],
        selectedId: null,
        past: [],
        future: [],
        fileHandle: null,
        fileName: null,
        dirty: false,
      }),

    loadDoc: (shapes, handle, name) =>
      set({
        view: HOME_VIEW,
        shapes,
        selectedId: null,
        past: [],
        future: [],
        fileHandle: handle,
        fileName: name,
        dirty: false,
      }),

    markSaved: (handle, name) => set({ fileHandle: handle, fileName: name, dirty: false }),

    setMode: (mode) => set({ mode }),

    showToast: (text, kind = 'info') => set({ toast: { id: Date.now(), text, kind } }),
  };
});
