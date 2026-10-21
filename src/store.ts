import { create } from 'zustand';
import { canFill, groupBounds, newId } from './geometry';
import { kbd } from './platform';
import { PALETTE, type PrimitiveType, type Shape, type TransformPatch } from './types';

export type Mode = 'idle' | 'drawing' | 'selecting' | 'dragging' | 'scaling' | 'erasing' | 'menuOpen';
/**
 * What a plain left-drag does: draw/move (default), box-select, pan the view, erase whole shapes,
 * or create one shape of `createType` (chosen from the pie menu).
 */
export type Tool = 'draw' | 'select' | 'hand' | 'eraser' | 'create';

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
const GESTURES_KEY = 'pie-draw:gestures';

function readGesturesOn(): boolean {
  try {
    return localStorage.getItem(GESTURES_KEY) !== '0';
  } catch {
    return true;
  }
}
const HISTORY_LIMIT = 100;

interface AppState {
  shapes: Shape[]; // array order = z-order
  selectedIds: string[];
  clipboard: Shape[] | null;
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
  gestureGuideOpen: boolean; // the gesture reference panel
  recordOpen: boolean;
  gesturesOn: boolean; // off: every stroke stays freehand (no recognizer, no shape snapping) // hidden gesture record mode (?record=1)
  dropTargetId: string | null; // shape under a color being dragged from the dock
  tool: Tool;
  createType: PrimitiveType; // the shape the create tool draws

  /** Records the current shapes for undo. Call once before a change (or at the start of a drag). */
  checkpoint: () => void;
  addShape: (shape: Shape, select?: boolean) => void;
  /** Live update without a history entry; pair with checkpoint() at gesture start. */
  updateShape: (id: string, patch: TransformPatch) => void;
  /** Live update of several shapes at once (group move / scale), also without a history entry. */
  updateShapes: (patches: Map<string, TransformPatch>) => void;
  /** Live removal without a history entry; pair with checkpoint() at gesture start. */
  eraseShape: (id: string) => void;
  /** Selects just this shape, or nothing. */
  select: (id: string | null) => void;
  setSelection: (ids: string[]) => void;
  /** Adds the shape to the selection, or removes it if it is already selected. */
  toggleSelect: (id: string) => void;
  selectAll: () => void;
  deleteSelected: () => void;
  copy: () => void;
  cut: () => void;
  /** Pastes the clipboard centered at `at`, or offset from the last copy/paste when omitted. */
  paste: (at?: { x: number; y: number }) => void;
  /** Recolors the selected shapes' lines, or sets the line color for new shapes. */
  setColor: (color: string) => void;
  /** Recolors one shape's line and makes it the drawing color. */
  recolor: (id: string, color: string) => void;
  /** Changes the selected shapes' fill (closed shapes only), or sets the fill for new shapes. */
  setFill: (fill: string | null) => void;
  /** Changes one closed shape's fill and makes it the default fill. */
  refill: (id: string, fill: string | null) => void;
  setDropTarget: (id: string | null) => void;
  setTool: (tool: Tool) => void;
  /** Switches to the create tool, armed with this shape. */
  setCreateTool: (type: PrimitiveType) => void;
  bringToFront: () => void;
  sendToBack: () => void;
  nudge: (dx: number, dy: number) => void;
  undo: () => void;
  redo: () => void;
  newDoc: () => void;
  loadDoc: (shapes: Shape[], handle: FileSystemFileHandle | null, name: string | null) => void;
  markSaved: (handle: FileSystemFileHandle | null, name: string) => void;
  clearAll: () => void;
  /** Zooms by factor k keeping the screen point `at` fixed. */
  zoomBy: (k: number, at: { x: number; y: number }) => void;
  panBy: (dx: number, dy: number) => void;
  setView: (view: View) => void;
  setHelpOpen: (open: boolean) => void;
  setGestureGuideOpen: (open: boolean) => void;
  setRecordOpen: (open: boolean) => void;
  setGesturesOn: (on: boolean) => void;
  setMode: (mode: Mode) => void;
  showToast: (text: string, kind?: Toast['kind']) => void;
}

function cloneShape(s: Shape): Shape {
  return { ...structuredClone(s), id: newId() };
}

/** Keeps only ids that still exist in `shapes`. */
const existing = (ids: string[], shapes: Shape[]) => ids.filter((id) => shapes.some((s) => s.id === id));

export const useStore = create<AppState>()((set, get) => {
  /** Applies a document change with an undo entry. */
  const change = (next: Partial<AppState> & { shapes: Shape[] }) =>
    set((st) => ({
      ...next,
      past: [...st.past, st.shapes].slice(-HISTORY_LIMIT),
      future: [],
      dirty: true,
    }));

  /** The selected shapes, in z-order. */
  const selected = () => {
    const { shapes, selectedIds } = get();
    return shapes.filter((s) => selectedIds.includes(s.id));
  };

  /** Applies `fn` to each selected shape with one undo step. */
  const changeSelected = (fn: (s: Shape) => Shape) => {
    const { shapes, selectedIds } = get();
    change({ shapes: shapes.map((s) => (selectedIds.includes(s.id) ? fn(s) : s)) });
  };

  return {
    shapes: [],
    selectedIds: [],
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
    gestureGuideOpen: false,
    recordOpen: new URLSearchParams(location.search).has('record'),
    gesturesOn: readGesturesOn(),
    dropTargetId: null,
    tool: 'draw',
    createType: 'square',

    checkpoint: () =>
      set((st) => ({ past: [...st.past, st.shapes].slice(-HISTORY_LIMIT), future: [], dirty: true })),

    addShape: (shape, select = true) =>
      change({
        shapes: [...get().shapes, shape],
        selectedIds: select ? [shape.id] : get().selectedIds,
      }),

    updateShape: (id, patch) =>
      set((st) => ({
        shapes: st.shapes.map((s) => (s.id === id ? { ...s, ...patch } : s)),
      })),

    updateShapes: (patches) =>
      set((st) => ({
        shapes: st.shapes.map((s) => {
          const patch = patches.get(s.id);
          return patch ? { ...s, ...patch } : s;
        }),
      })),

    select: (id) => set({ selectedIds: id ? [id] : [] }),

    setSelection: (selectedIds) => set({ selectedIds }),

    toggleSelect: (id) =>
      set(({ selectedIds }) => ({
        selectedIds: selectedIds.includes(id) ? selectedIds.filter((x) => x !== id) : [...selectedIds, id],
      })),

    selectAll: () => set(({ shapes }) => ({ selectedIds: shapes.map((s) => s.id) })),

    eraseShape: (id) =>
      set((st) => ({
        shapes: st.shapes.filter((s) => s.id !== id),
        selectedIds: st.selectedIds.filter((x) => x !== id),
      })),

    deleteSelected: () => {
      const { selectedIds, shapes } = get();
      if (selectedIds.length === 0) return;
      change({ shapes: shapes.filter((s) => !selectedIds.includes(s.id)), selectedIds: [] });
    },

    copy: () => {
      const sel = selected();
      if (sel.length > 0) set({ clipboard: structuredClone(sel) });
    },

    cut: () => {
      const sel = selected();
      if (sel.length === 0) return;
      set({ clipboard: structuredClone(sel) });
      get().deleteSelected();
    },

    paste: (at) => {
      const { clipboard, shapes } = get();
      if (!clipboard) {
        get().showToast('Clipboard is empty');
        return;
      }
      const pasted = clipboard.map(cloneShape);
      // At a point: center the group's bounding box there. Otherwise: offset from the copy.
      let dx = PASTE_OFFSET, dy = PASTE_OFFSET;
      if (at) {
        const b = groupBounds(pasted);
        dx = at.x - (b.minX + b.maxX) / 2;
        dy = at.y - (b.minY + b.maxY) / 2;
      }
      for (const s of pasted) {
        s.x += dx;
        s.y += dy;
      }
      // Next keyboard paste cascades from this one instead of stacking on it.
      change({ shapes: [...shapes, ...pasted], selectedIds: pasted.map((s) => s.id) });
      set({ clipboard: structuredClone(pasted) });
    },

    setColor: (color) => {
      set({ currentColor: color });
      if (selected().some((s) => s.stroke !== color)) changeSelected((s) => ({ ...s, stroke: color }));
    },

    recolor: (id, color) => {
      set({ currentColor: color });
      const s = get().shapes.find((x) => x.id === id);
      if (!s || s.stroke === color) return;
      change({ shapes: get().shapes.map((x) => (x.id === id ? { ...x, stroke: color } : x)) });
    },

    setFill: (fill) => {
      const sel = selected();
      if (sel.length === 0) {
        set({ currentFill: fill });
        return;
      }
      const fillable = sel.filter(canFill); // open lines have no inside to fill
      if (fillable.length === 0) return;
      set({ currentFill: fill });
      if (fillable.some((s) => s.fill !== fill)) changeSelected((s) => (canFill(s) ? { ...s, fill } : s));
    },

    refill: (id, fill) => {
      const s = get().shapes.find((x) => x.id === id);
      if (!s || !canFill(s)) return; // open lines have no inside to fill
      set({ currentFill: fill });
      if (s.fill === fill) return;
      change({ shapes: get().shapes.map((x) => (x.id === id ? { ...x, fill } : x)) });
    },

    setDropTarget: (dropTargetId) => set({ dropTargetId }),

    // Panning and erasing drop the selection; drawing and box-selecting keep it.
    setTool: (tool) =>
      set({ tool, selectedIds: tool === 'hand' || tool === 'eraser' ? [] : get().selectedIds }),

    setCreateTool: (createType) => set({ tool: 'create', createType, selectedIds: [] }),

    // Both keep the selected shapes' order relative to each other.
    bringToFront: () => {
      const sel = selected();
      if (sel.length === 0) return;
      change({ shapes: [...get().shapes.filter((x) => !sel.includes(x)), ...sel] });
    },

    sendToBack: () => {
      const sel = selected();
      if (sel.length === 0) return;
      change({ shapes: [...sel, ...get().shapes.filter((x) => !sel.includes(x))] });
    },

    nudge: (dx, dy) => {
      if (get().selectedIds.length === 0) return;
      changeSelected((s) => ({ ...s, x: s.x + dx, y: s.y + dy }));
    },

    undo: () => {
      const { past, shapes, future, selectedIds } = get();
      if (past.length === 0) return;
      const prev = past[past.length - 1];
      set({
        shapes: prev,
        past: past.slice(0, -1),
        future: [shapes, ...future],
        selectedIds: existing(selectedIds, prev),
        dirty: true,
      });
    },

    redo: () => {
      const { past, shapes, future, selectedIds } = get();
      if (future.length === 0) return;
      const next = future[0];
      set({
        shapes: next,
        past: [...past, shapes],
        future: future.slice(1),
        selectedIds: existing(selectedIds, next),
        dirty: true,
      });
    },

    clearAll: () => {
      if (get().shapes.length === 0) return;
      change({ shapes: [], selectedIds: [] });
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

    // Help and the gesture reference replace each other, so only one panel is ever open.
    setHelpOpen: (helpOpen) => set({ helpOpen, gestureGuideOpen: false }),

    setGestureGuideOpen: (gestureGuideOpen) => set({ gestureGuideOpen, helpOpen: false }),

    setGesturesOn: (gesturesOn) => {
      try {
        localStorage.setItem(GESTURES_KEY, gesturesOn ? '1' : '0');
      } catch {
        // Storage unavailable: the setting just won't survive a reload.
      }
      set({ gesturesOn });
      get().showToast(gesturesOn ? 'Gestures on' : 'Gestures off · Strokes stay as drawn');
    },

    setRecordOpen: (recordOpen) => {
      // Mirrored in the URL (?record=1), so a reload or a dev-server reload after saving stays in record mode.
      const url = new URL(location.href);
      if (recordOpen) url.searchParams.set('record', '1');
      else url.searchParams.delete('record');
      history.replaceState(null, '', url);
      set({ recordOpen, helpOpen: false, gestureGuideOpen: false });
    },

    newDoc: () =>
      set({
        view: HOME_VIEW,
        shapes: [],
        selectedIds: [],
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
        selectedIds: [],
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
