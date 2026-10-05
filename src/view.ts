import { worldBounds } from './geometry';
import { MAX_ZOOM, MIN_ZOOM, useStore, type View } from './store';
import type { Pt } from './types';

export const ZOOM_STEP = 1.25;

export function toWorld(p: Pt, v: View): Pt {
  return [(p[0] - v.x) / v.zoom, (p[1] - v.y) / v.zoom];
}

export function toScreen(p: Pt, v: View): Pt {
  return [p[0] * v.zoom + v.x, p[1] * v.zoom + v.y];
}

const screenCenter = () => ({ x: window.innerWidth / 2, y: window.innerHeight / 2 });

export const zoomIn = () => useStore.getState().zoomBy(ZOOM_STEP, screenCenter());
export const zoomOut = () => useStore.getState().zoomBy(1 / ZOOM_STEP, screenCenter());

/** Back to 100%, keeping whatever is at the center of the screen there. */
export function resetZoom() {
  const { view, zoomBy } = useStore.getState();
  zoomBy(1 / view.zoom, screenCenter());
}

/** Zoom and pan so every shape is visible. */
export function fitToContent() {
  const { shapes, setView } = useStore.getState();
  if (shapes.length === 0) {
    setView({ x: 0, y: 0, zoom: 1 });
    return;
  }
  const bs = shapes.map(worldBounds);
  const minX = Math.min(...bs.map((b) => b.minX)), maxX = Math.max(...bs.map((b) => b.maxX));
  const minY = Math.min(...bs.map((b) => b.minY)), maxY = Math.max(...bs.map((b) => b.maxY));
  const pad = 80, top = 56; // keep clear of the top bar
  const w = window.innerWidth - pad * 2, h = window.innerHeight - pad * 2 - top;
  const zoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, Math.min(w / (maxX - minX || 1), h / (maxY - minY || 1), 2)));
  setView({
    zoom,
    x: window.innerWidth / 2 - ((minX + maxX) / 2) * zoom,
    y: top + (window.innerHeight - top) / 2 - ((minY + maxY) / 2) * zoom,
  });
}

/**
 * Selects the next (dir 1) or previous (dir -1) shape in drawing order, wrapping around,
 * and pans to it if it is off screen. Leaves the hand and eraser tools, which can't select.
 */
export function selectAdjacent(dir: 1 | -1) {
  const st = useStore.getState();
  const { shapes, selectedIds } = st;
  if (shapes.length === 0) return;
  if (st.tool === 'hand' || st.tool === 'eraser') st.setTool('draw');
  const n = shapes.length;
  const at = shapes.findIndex((s) => s.id === selectedIds[dir > 0 ? selectedIds.length - 1 : 0]);
  const next = shapes[at < 0 ? (dir > 0 ? 0 : n - 1) : (at + dir + n) % n];
  st.select(next.id);

  const b = worldBounds(next);
  const [x0, y0] = toScreen([b.minX, b.minY], st.view);
  const [x1, y1] = toScreen([b.maxX, b.maxY], st.view);
  const top = 48; // the top bar
  if (x0 < 0 || y0 < top || x1 > window.innerWidth || y1 > window.innerHeight) {
    st.panBy(window.innerWidth / 2 - (x0 + x1) / 2, top + (window.innerHeight - top) / 2 - (y0 + y1) / 2);
  }
}
