import { useCallback, useEffect, useRef, useState } from 'react';
import simplify from 'simplify-js';
import { STROKE_WIDTH, dist, keepsAspect, localBounds, makeFreehand, worldBounds } from '../geometry';
import { PieMenu } from '../interaction/PieMenu';
import {
  DEAD_ZONE,
  NO_SELECTION,
  pieSelect,
  selectedItem,
  type PieSelection,
} from '../interaction/pieGeometry';
import { menuFor, type PieItem } from '../interaction/pieMenuConfig';
import { GhostTracker, overshot, recognize, shapeFromRecognized, type Recognized } from '../interaction/recognize';
import { useStore, type Tool } from '../store';
import type { Pt, Shape } from '../types';
import { useKeyboard } from '../useKeyboard';
import { isMac } from '../platform';
import { toWorld } from '../view';
import { GhostPreview } from './GhostPreview';
import { SELECTION_PAD, SelectionHandles, type Corner } from './SelectionHandles';
import { ShapeView } from './ShapeView';

const MOVE_THRESHOLD = 4; // px before a press becomes a drag or a stroke
const HOLD_MS = 300; // left press-and-hold opens the menu
const SAMPLE_PX = 3; // freehand sampling distance
const MIN_SIZE = 6; // smallest on-screen size a shape can be scaled to
const ERASE_STEP = 4; // px between hit tests along a fast eraser drag, so thin lines aren't skipped

type Gesture =
  | { kind: 'none' }
  | { kind: 'press'; start: Pt; screen: Pt; shapeId: string | null }
  | { kind: 'pan'; last: Pt }
  | { kind: 'erase'; last: { x: number; y: number }; checkpointed: boolean }
  | { kind: 'drag'; start: Pt; shapeId: string; orig: Pt }
  | { kind: 'scale'; shape: Shape; corner: Corner; moved: boolean }
  | { kind: 'draw'; points: Pt[]; check: number | null; tracker: GhostTracker } // check: pending frame
  | { kind: 'menu' } // button held while the menu tracks the pointer
  | { kind: 'swallow' }; // ignore the rest of a press that closed a sticky menu

interface MenuState {
  items: PieItem[];
  origin: Pt;
  shapeId: string | null;
  pointer: Pt;
  selection: PieSelection;
  sticky: boolean; // opened by a click: stays open, next click chooses
  movedOut: boolean; // pointer has left the dead zone at least once
}

function hitShapeId(target: EventTarget | null): string | null {
  return (target as Element | null)?.closest?.('[data-id]')?.getAttribute('data-id') ?? null;
}
/** Whether a world point falls inside a shape's selection box (including its padding). */
function inSelectionBox(s: Shape, w: Pt, zoom: number): boolean {
  const b = worldBounds(s);
  const pad = SELECTION_PAD / zoom;
  return w[0] >= b.minX - pad && w[0] <= b.maxX + pad && w[1] >= b.minY - pad && w[1] <= b.maxY + pad;
}
/** The shape under a viewport point, for gestures (the eraser) that hit-test away from e.target. */
function shapeIdAt(x: number, y: number): string | null {
  return hitShapeId(document.elementFromPoint(x, y));
}
function hitHandle(target: EventTarget | null): Corner | null {
  return ((target as Element | null)?.getAttribute?.('data-handle') as Corner | null) ?? null;
}

/** New translate/scale for dragging `corner` of `s0` to `p`, with the opposite corner fixed. */
function scaleFromCorner(s0: Shape, corner: Corner, p: Pt, lock: boolean) {
  const b = localBounds(s0);
  const cx = corner.includes('e') ? b.maxX : b.minX;
  const ax = corner.includes('e') ? b.minX : b.maxX;
  const cy = corner.includes('s') ? b.maxY : b.minY;
  const ay = corner.includes('s') ? b.minY : b.maxY;
  const Ax = s0.x + ax * s0.scaleX;
  const Ay = s0.y + ay * s0.scaleY;
  const w = Math.abs(cx - ax), h = Math.abs(cy - ay);

  let sx = w > 1e-6 ? (p[0] - Ax) / (cx - ax) : s0.scaleX;
  let sy = h > 1e-6 ? (p[1] - Ay) / (cy - ay) : s0.scaleY;
  const minSx = w > 1e-6 ? MIN_SIZE / w : s0.scaleX;
  const minSy = h > 1e-6 ? MIN_SIZE / h : s0.scaleY;
  if (lock) {
    const k = Math.max(sx / s0.scaleX, sy / s0.scaleY, minSx / s0.scaleX, minSy / s0.scaleY);
    sx = s0.scaleX * k;
    sy = s0.scaleY * k;
  } else {
    sx = Math.max(sx, minSx);
    sy = Math.max(sy, minSy);
  }
  return { scaleX: sx, scaleY: sy, x: Ax - ax * sx, y: Ay - ay * sy };
}

interface StatusInput {
  menu: MenuState | null;
  spaceHeld: boolean;
  mode: string;
  hasSelection: boolean;
  tool: Tool;
}

/** One line of context-sensitive guidance, so the available actions are never a mystery. */
function statusText({ menu, mode, hasSelection, tool }: StatusInput) {
  if (menu?.sticky) return 'Click a wedge · click the center or outside the menu to cancel';
  if (menu && menu.selection.index < 0 && menu.movedOut) return 'Release here to cancel';
  if (menu) return 'Release on a wedge to choose · drag outward into a ring for submenus · release on × or outside to cancel';
  if (mode === 'scaling') return 'Hold Shift to keep proportions';
  if (tool === 'hand') return 'Drag to pan · Press Esc to exit Pan mode';
  if (tool === 'eraser') return 'Click or drag across shapes to erase them · Press Esc to exit Erase mode';
  if (hasSelection) {
    return 'Drag to move · Drag corners to scale · Right-click for more options';
  }
  return 'Right-click or press-and-hold for the menu · Drag to draw';
}

export function Canvas() {
  const shapes = useStore((s) => s.shapes);
  const selectedId = useStore((s) => s.selectedId);
  const mode = useStore((s) => s.mode);
  const currentColor = useStore((s) => s.currentColor);
  const view = useStore((s) => s.view);
  const dropTargetId = useStore((s) => s.dropTargetId);
  const tool = useStore((s) => s.tool);

  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture>({ kind: 'none' });
  const menuRef = useRef<MenuState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const spaceRef = useRef(false); // Space held: drag pans the view

  // Render mirrors of the refs above (the refs are the source of truth inside handlers).
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  const [ghost, setGhost] = useState<Recognized | null>(null);
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false); // middle-button / Space drag in progress
  const [eraseTargetId, setEraseTargetId] = useState<string | null>(null); // shape under the eraser

  const selected = shapes.find((s) => s.id === selectedId) ?? null;

  const toCanvas = (e: { clientX: number; clientY: number }): Pt => {
    const r = svgRef.current!.getBoundingClientRect();
    return [e.clientX - r.left, e.clientY - r.top];
  };

  const clearTimer = () => window.clearTimeout(timer.current);

  const pulse = useCallback((id: string) => {
    setPulseId(id);
    window.setTimeout(() => setPulseId((cur) => (cur === id ? null : cur)), 300);
  }, []);

  // ---- pie menu ----

  const renderMenu = () => setMenu(menuRef.current ? { ...menuRef.current } : null);

  const openMenu = (origin: Pt, shapeId: string | null) => {
    const st = useStore.getState();
    st.select(shapeId);
    st.setMode('menuOpen');
    menuRef.current = {
      items: menuFor(st.shapes.find((s) => s.id === shapeId) ?? null),
      origin,
      shapeId,
      pointer: origin,
      selection: NO_SELECTION,
      sticky: false,
      movedOut: false,
    };
    renderMenu();
  };

  const closeMenu = () => {
    clearTimer();
    menuRef.current = null;
    useStore.getState().setMode('idle');
    renderMenu();
  };

  const trackMenu = (p: Pt) => {
    const m = menuRef.current!;
    m.pointer = p;
    m.selection = pieSelect(m.items, p[0] - m.origin[0], p[1] - m.origin[1], m.selection);
    if (dist(p, m.origin) >= DEAD_ZONE) m.movedOut = true;
    renderMenu();
  };

  const execute = (item: PieItem) => {
    const m = menuRef.current!;
    const origin = toWorld(m.origin, useStore.getState().view); // shapes live in world space
    closeMenu();
    item.run?.({ origin, shapeId: m.shapeId, pulse });
  };

  const makeSticky = () => {
    const m = menuRef.current!;
    m.sticky = true;
    renderMenu();
  };

  /** Button released while the menu was tracking a drag. */
  const releaseMenu = () => {
    const m = menuRef.current!;
    const item = selectedItem(m.items, m.selection);
    if (!item) {
      // A plain click opens the menu in click mode; releasing on × or outside cancels.
      if (m.movedOut) closeMenu();
      else makeSticky();
    } else if (item.children) {
      makeSticky(); // stopped on a submenu wedge: show it and let the user continue
    } else {
      execute(item);
    }
  };

  /** A click while the menu is open in click mode. */
  const clickSticky = (p: Pt) => {
    trackMenu(p);
    const m = menuRef.current!;
    const item = selectedItem(m.items, m.selection);
    if (m.selection.index < 0) closeMenu(); // on the × or beyond the cancel edge
    else if (item && !item.children) execute(item);
  };

  // ---- freehand ----

  const finishStroke = (points: Pt[], shown: Recognized | null) => {
    const st = useStore.getState();
    setStroke(null);
    setGhost(null);
    if (points.length < 2) return;
    // What the ghost showed is what you get, unless the stroke ran on too far past its start.
    // The full stroke only decides when no ghost was up.
    const result = overshot(points) ? null : (shown ?? recognize(points));
    if (result) {
      const shape = shapeFromRecognized(result, st.currentColor, st.currentFill);
      st.addShape(shape, false);
      pulse(shape.id);
      return;
    }
    const simplified = simplify(points.map(([x, y]) => ({ x, y })), 0.8, true).map(
      (q) => [q.x, q.y] as Pt,
    );
    st.addShape(makeFreehand(simplified, st.currentColor), false);
  };

  // ---- eraser ----

  /** Erases the shape under a viewport point; the first erase of a drag records one undo step. */
  const eraseAt = (x: number, y: number) => {
    const g = gesture.current;
    if (g.kind !== 'erase') return;
    const id = shapeIdAt(x, y);
    if (!id) return;
    const st = useStore.getState();
    if (!g.checkpointed) {
      st.checkpoint();
      g.checkpointed = true;
    }
    st.eraseShape(id);
  };

  // ---- the single pointer-event router ----

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    const p = toCanvas(e); // screen space: the pie menu lives here
    const w = toWorld(p, st.view); // world space: shapes live here
    // Control-click is the Mac's right-click; on Windows Ctrl+click stays a normal click.
    const right = e.button === 2 || (isMac && e.button === 0 && e.ctrlKey);
    if (e.button > 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    // Middle button (hold the scroll wheel), Space+drag, or the hand tool pans, like a map.
    const handPan = (spaceRef.current || st.tool === 'hand') && e.button === 0 && !right;
    if (e.button === 1 || (handPan && !menuRef.current)) {
      gesture.current = { kind: 'pan', last: p };
      setPanning(true);
      return;
    }

    if (menuRef.current?.sticky) {
      if (right) closeMenu(); // right-click elsewhere reopens below
      else {
        clickSticky(p);
        gesture.current = { kind: 'swallow' };
        return;
      }
    }

    // The selected shape owns its whole selection box, so empty space inside the box (between a
    // stroke's lines, or around a circle) counts as the shape for press, drag, hold, and right-click.
    const sel = st.shapes.find((s) => s.id === st.selectedId);
    const shapeId =
      hitShapeId(e.target) ?? (sel && inSelectionBox(sel, w, st.view.zoom) ? sel.id : null);

    // The eraser removes whole shapes: the one pressed on, then any the drag passes over.
    if (st.tool === 'eraser' && !right) {
      gesture.current = { kind: 'erase', last: { x: e.clientX, y: e.clientY }, checkpointed: false };
      st.setMode('erasing');
      eraseAt(e.clientX, e.clientY);
      return;
    }

    if (right) {
      openMenu(p, shapeId);
      gesture.current = { kind: 'menu' };
      return;
    }

    const corner = hitHandle(e.target);
    if (corner && sel) {
      gesture.current = { kind: 'scale', shape: sel, corner, moved: false };
      st.setMode('scaling');
      return;
    }

    st.select(shapeId);
    gesture.current = { kind: 'press', start: w, screen: p, shapeId };
    timer.current = window.setTimeout(() => {
      const g = gesture.current;
      if (g.kind !== 'press') return;
      openMenu(g.screen, g.shapeId);
      gesture.current = { kind: 'menu' };
    }, HOLD_MS);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const st = useStore.getState();
    const p = toCanvas(e);
    const w = toWorld(p, st.view);

    switch (g.kind) {
      case 'pan':
        st.panBy(p[0] - g.last[0], p[1] - g.last[1]);
        g.last = p;
        return;
      case 'erase': {
        setEraseTargetId(null); // it is erased on contact, so only hover shows the outline
        // Test points along the segment, since pointer events can skip over a thin line.
        const dx = e.clientX - g.last.x, dy = e.clientY - g.last.y;
        const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / ERASE_STEP));
        for (let i = 1; i <= n; i++) eraseAt(g.last.x + (dx * i) / n, g.last.y + (dy * i) / n);
        g.last = { x: e.clientX, y: e.clientY };
        return;
      }
      case 'none':
        if (menuRef.current?.sticky) trackMenu(p); // click mode follows the hovering pointer
        else setEraseTargetId(st.tool === 'eraser' && !spaceRef.current ? shapeIdAt(e.clientX, e.clientY) : null);
        return;
      case 'menu':
        trackMenu(p);
        return;
      case 'press': {
        if (dist(p, g.screen) < MOVE_THRESHOLD) return;
        clearTimer();
        if (g.shapeId) {
          const s = st.shapes.find((x) => x.id === g.shapeId)!;
          st.checkpoint();
          gesture.current = { kind: 'drag', start: g.start, shapeId: g.shapeId, orig: [s.x, s.y] };
          st.setMode('dragging');
        } else {
          gesture.current = { kind: 'draw', points: [g.start], check: null, tracker: new GhostTracker() };
          st.setMode('drawing');
        }
        onPointerMove(e);
        return;
      }
      case 'drag':
        st.updateShape(g.shapeId, {
          x: g.orig[0] + w[0] - g.start[0],
          y: g.orig[1] + w[1] - g.start[1],
        });
        return;
      case 'scale': {
        if (!g.moved) {
          st.checkpoint();
          g.moved = true;
        }
        const lock = e.shiftKey || keepsAspect(g.shape);
        st.updateShape(g.shape.id, scaleFromCorner(g.shape, g.corner, w, lock));
        return;
      }
      case 'draw': {
        if (dist(w, g.points[g.points.length - 1]) * st.view.zoom < SAMPLE_PX) return;
        g.points.push(w);
        // Recognize at most once per frame, on the stroke as it is when the frame comes.
        g.check ??= requestAnimationFrame(() => {
          g.check = null;
          if (gesture.current !== g) return; // stroke already finished
          setGhost(overshot(g.points) ? g.tracker.clear() : g.tracker.update(recognize(g.points)));
        });
        setStroke(g.points.slice());
        return;
      }
    }
  };

  const onPointerUp = () => {
    const g = gesture.current;
    gesture.current = { kind: 'none' };
    clearTimer();
    if (g.kind === 'pan') setPanning(false);
    switch (g.kind) {
      case 'menu':
        if (menuRef.current) releaseMenu();
        return; // mode is managed by the menu
      case 'draw':
        if (g.check !== null) cancelAnimationFrame(g.check);
        finishStroke(g.points, g.tracker.shown);
        break;
    }
    if (!menuRef.current) useStore.getState().setMode('idle');
  };

  const onPointerCancel = () => {
    const g = gesture.current;
    if (g.kind === 'draw' && g.check !== null) cancelAnimationFrame(g.check);
    gesture.current = { kind: 'none' };
    setStroke(null);
    setGhost(null);
    closeMenu();
  };

  // ---- keyboard ----

  useKeyboard(
    useCallback(() => {
      const st = useStore.getState();
      if (menuRef.current) closeMenu();
      else if (st.tool !== 'draw') st.setTool('draw');
      else st.select(null);
    }, []),
  );

  // ---- trackpad pinch: Chrome sends it as wheel + ctrlKey ----

  useEffect(() => {
    const svg = svgRef.current!;
    let lastPinch = 0;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault(); // stop page zoom / history swipe
      const st = useStore.getState();
      if (!e.ctrlKey) {
        // Two-finger scroll / mouse wheel pans; Shift+wheel pans sideways (Windows mice).
        if (e.shiftKey && e.deltaX === 0) st.panBy(-e.deltaY, 0);
        else st.panBy(-e.deltaX, -e.deltaY);
        return;
      }
      // Trackpad pinch arrives as small ctrl+wheel deltas; a Ctrl+mouse-wheel notch is ~100,
      // so clamp it to a comfortable step.
      const delta = Math.max(-25, Math.min(25, e.deltaY));
      const s = st.shapes.find((x) => x.id === st.selectedId);
      if (!s) {
        // Nothing selected: pinch zooms the view around the fingers.
        const r = svg.getBoundingClientRect();
        st.zoomBy(Math.exp(-delta * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
        return;
      }
      if (e.timeStamp - lastPinch > 400) st.checkpoint(); // one undo step per pinch
      lastPinch = e.timeStamp;
      const b = localBounds(s);
      const minK = Math.max(
        MIN_SIZE / ((b.maxX - b.minX) * s.scaleX || 1),
        MIN_SIZE / ((b.maxY - b.minY) * s.scaleY || 1),
      );
      const k = Math.max(Math.exp(-delta * 0.01), minK);
      // Geometry is centered on (0,0), so scaling about (x, y) scales about the center.
      st.updateShape(s.id, { scaleX: s.scaleX * k, scaleY: s.scaleY * k });
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !e.repeat) {
        spaceRef.current = true;
        setSpaceHeld(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      clearTimer();
    };
  }, []);

  return (
    <>
      <svg
        ref={svgRef}
        className={`canvas mode-${mode} ${spaceHeld || panning ? 'panning' : tool !== 'draw' ? tool : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => setEraseTargetId(null)}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {shapes.map((s) => (
            <ShapeView
              key={s.id}
              shape={s}
              zoom={view.zoom}
              className={`shape${s.id === selectedId ? ' selected' : ''}${s.id === dropTargetId ? ' drop-target' : ''}${tool === 'eraser' && s.id === eraseTargetId ? ' erase-target' : ''}`}
              pulse={s.id === pulseId}
            />
          ))}
          {ghost && <GhostPreview result={ghost} color={currentColor} zoom={view.zoom} />}
          {stroke && (
            <polyline
              className="live-stroke"
              stroke={currentColor}
              strokeWidth={STROKE_WIDTH * view.zoom}
              points={stroke.map((q) => q.join(',')).join(' ')}
            />
          )}
        </g>
        {selected && mode !== 'drawing' && <SelectionHandles shape={selected} view={view} />}
        {menu && (
          <PieMenu items={menu.items} origin={menu.origin} pointer={menu.pointer} selection={menu.selection} />
        )}
      </svg>

      {shapes.length === 0 && !menu && !stroke && (
        <div className="empty-state">
          <div className="empty-title">Right-click or press-and-hold for the menu</div>
          <div className="empty-sub">
            Drag to draw ·
            <button className="empty-help" onClick={() => useStore.getState().setHelpOpen(true)}>
              <svg viewBox="0 0 20 20">
                <circle cx="10" cy="10" r="7.5" />
                <path d="M7.8 8 a2.3 2.3 0 1 1 3.2 2.1 c-.7.3-1 .8-1 1.5 V12.5" />
                <circle cx="10" cy="15" r=".6" className="dot" />
              </svg>
              Help
            </button>
          </div>
        </div>
      )}
      <div className="status">
        {statusText({ menu, spaceHeld: spaceHeld || panning, mode, hasSelection: !!selected, tool })}
      </div>
    </>
  );
}
