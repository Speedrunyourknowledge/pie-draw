import { useCallback, useEffect, useRef, useState } from 'react';
import simplify from 'simplify-js';
import { dist, keepsAspect, localBounds, makeFreehand } from '../geometry';
import { PieMenu } from '../interaction/PieMenu';
import {
  DEAD_ZONE,
  NO_SELECTION,
  CANCEL_RADIUS,
  pieSelect,
  selectedItem,
  type PieSelection,
} from '../interaction/pieGeometry';
import { menuFor, type PieItem } from '../interaction/pieMenuConfig';
import { GhostTracker, recognize, shapeFromRecognized, type Recognized } from '../interaction/recognize';
import { useStore } from '../store';
import type { Pt, Shape } from '../types';
import { useKeyboard } from '../useKeyboard';
import { isMac } from '../platform';
import { toWorld } from '../view';
import { GhostPreview } from './GhostPreview';
import { SelectionHandles, type Corner } from './SelectionHandles';
import { ShapeView } from './ShapeView';

const MOVE_SLOP = 4; // px before a press becomes a drag or a stroke
const HOLD_MS = 300; // left press-and-hold opens the menu
const SAMPLE_PX = 3; // freehand sampling distance
const RECOGNIZE_EVERY = 3; // run the recognizer every Nth sampled point
const MIN_SIZE = 6; // smallest on-screen size a shape can be scaled to

type Gesture =
  | { kind: 'none' }
  | { kind: 'press'; start: Pt; screen: Pt; shapeId: string | null }
  | { kind: 'pan'; last: Pt }
  | { kind: 'drag'; start: Pt; shapeId: string; orig: Pt }
  | { kind: 'scale'; shape: Shape; corner: Corner; moved: boolean }
  | { kind: 'draw'; points: Pt[]; sinceCheck: number; tracker: GhostTracker }
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
  ghost: Recognized | null;
  hasSelection: boolean;
  handTool: boolean;
}

/** One line of context-sensitive guidance, so the available actions are never a mystery. */
function statusText({ menu, spaceHeld, mode, ghost, hasSelection, handTool }: StatusInput) {
  if (menu?.sticky) return 'Click a wedge · click the center or outside the menu to cancel';
  if (menu && menu.selection.index < 0 && menu.movedOut) return 'Release here to cancel';
  if (menu) return 'Release on a wedge to choose · drag outward into a ring for submenus · release on × or outside to cancel';
  if (mode === 'drawing') {
    return ghost
      ? `Release to snap to a ${ghost.type} · keep drawing to keep it freehand`
      : 'Close the shape to snap it to a primitive · or release to keep it freehand';
  }
  if (mode === 'scaling') return 'Hold Shift to keep proportions';
  if (mode === 'dragging') return 'Moving · release to drop';
  if (spaceHeld) return 'Panning · drag to move around the canvas';
  if (handTool) return 'Hand tool: drag to pan · press H or Esc to go back to drawing';
  if (hasSelection) {
    return 'Drag to move · corners or pinch to scale · right-click for more · color swatch at lower right';
  }
  return 'Right-click or press-and-hold for the menu · drag to draw · scroll to pan · ? for help';
}

export function Canvas() {
  const shapes = useStore((s) => s.shapes);
  const selectedId = useStore((s) => s.selectedId);
  const mode = useStore((s) => s.mode);
  const currentColor = useStore((s) => s.currentColor);
  const view = useStore((s) => s.view);
  const dropTargetId = useStore((s) => s.dropTargetId);
  const handTool = useStore((s) => s.handTool);

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
      items: menuFor(shapeId ? 'shape' : 'canvas'),
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
    const r = dist(p, m.origin);
    const item = selectedItem(m.items, m.selection);
    if (r < DEAD_ZONE || r > CANCEL_RADIUS) closeMenu();
    else if (item && !item.children) execute(item);
  };

  // ---- freehand ----

  const finishStroke = (points: Pt[], shown: Recognized | null) => {
    const st = useStore.getState();
    setStroke(null);
    setGhost(null);
    if (points.length < 2) return;
    // The full stroke decides; if it no longer matches (e.g. a final overshoot),
    // the ghost the user was looking at still wins.
    const result = recognize(points) ?? shown;
    if (result) {
      const shape = shapeFromRecognized(result, st.currentColor);
      st.addShape(shape, false);
      pulse(shape.id);
      return;
    }
    const simplified = simplify(points.map(([x, y]) => ({ x, y })), 0.8, true).map(
      (q) => [q.x, q.y] as Pt,
    );
    st.addShape(makeFreehand(simplified, st.currentColor), false);
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
    const handPan = (spaceRef.current || st.handTool) && e.button === 0 && !right;
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

    if (right) {
      openMenu(p, hitShapeId(e.target));
      gesture.current = { kind: 'menu' };
      return;
    }

    const corner = hitHandle(e.target);
    const sel = st.shapes.find((s) => s.id === st.selectedId);
    if (corner && sel) {
      gesture.current = { kind: 'scale', shape: sel, corner, moved: false };
      st.setMode('scaling');
      return;
    }

    const shapeId = hitShapeId(e.target);
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
      case 'none':
        if (menuRef.current?.sticky) trackMenu(p); // click mode follows the hovering pointer
        return;
      case 'menu':
        trackMenu(p);
        return;
      case 'press': {
        if (dist(p, g.screen) < MOVE_SLOP) return;
        clearTimer();
        if (g.shapeId) {
          const s = st.shapes.find((x) => x.id === g.shapeId)!;
          st.checkpoint();
          gesture.current = { kind: 'drag', start: g.start, shapeId: g.shapeId, orig: [s.x, s.y] };
          st.setMode('dragging');
        } else {
          gesture.current = { kind: 'draw', points: [g.start], sinceCheck: 0, tracker: new GhostTracker() };
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
        if (++g.sinceCheck >= RECOGNIZE_EVERY) {
          g.sinceCheck = 0;
          setGhost(g.tracker.update(recognize(g.points)));
        }
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
        finishStroke(g.points, g.tracker.shown);
        break;
    }
    if (!menuRef.current) useStore.getState().setMode('idle');
  };

  const onPointerCancel = () => {
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
      else if (st.handTool) st.setHandTool(false);
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
        className={`canvas mode-${mode} ${spaceHeld || panning ? 'panning' : handTool ? 'hand' : ''}`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {shapes.map((s) => (
            <ShapeView
              key={s.id}
              shape={s}
              zoom={view.zoom}
              className={`shape${s.id === selectedId ? ' selected' : ''}${s.id === dropTargetId ? ' drop-target' : ''}`}
              pulse={s.id === pulseId}
            />
          ))}
          {ghost && <GhostPreview result={ghost} color={currentColor} zoom={view.zoom} />}
          {stroke && (
            <polyline
              className="live-stroke"
              stroke={currentColor}
              strokeWidth={3 * view.zoom}
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
          <div className="empty-title">Right-click anywhere to start</div>
          <div className="empty-sub">
            or press and hold · drag to sketch a shape · press <b className="key">?</b> for help
          </div>
        </div>
      )}
      <div className="status">
        {statusText({ menu, spaceHeld: spaceHeld || panning, mode, ghost, hasSelection: !!selected, handTool })}
      </div>
    </>
  );
}
