import { useCallback, useEffect, useRef, useState } from 'react';
import simplify from 'simplify-js';
import { STROKE_WIDTH, anchorsOf, canFill, closestSnap, dist, isLine, lineEnds, lineWithEnds, makeTriangle, snapTriangleTip, triangleArea2, frameOf, groupBounds, groupFrame, inFrame, makeFreehand, makePrimitive, makePrimitiveInBox, mustScaleEvenly, normAngle, pointsBounds, rotateAbout, rotatePt, scaleAbout, shapeInLasso, shapeNearPoint, shapeTouchesRect, snapAngle, snapSegment, type Anchor, type Bounds, type Frame } from '../geometry';
import { describeAction, gestureFor, type GestureAction } from '../gestures/gestureConfig';
import { CUSP_SPAN_PX, SCRIBBLE_HIT_PX, isScribble } from '../gestures/heuristics';
import { PieMenu } from '../interaction/PieMenu';
import {
  DEAD_ZONE,
  NO_SELECTION,
  R_SUB,
  cancelRadius,
  pieSelect,
  pieStep,
  selectedItem,
  type PieSelection,
} from '../interaction/pieGeometry';
import { menuFor, type PieItem } from '../interaction/pieMenuConfig';
import { GhostTracker, interpret, overshot, shapeFromRecognized, type Recognized } from '../interaction/recognize';
import { useChat } from '../ai/chat';
import { useStore, type Tool, type View } from '../store';
import type { Freehand, PrimitiveType, Pt, Shape } from '../types';
import { useKeyboard } from '../useKeyboard';
import { isMac, isTextField, kbd } from '../platform';
import { toScreen, toWorld } from '../view';
import { GhostPreview } from './GhostPreview';
import { SELECTION_PAD, SelectionHandles, type Corner, type Handle } from './SelectionHandles';
import { ShapeView } from './ShapeView';
import { shapeCursor } from './shapeCursor';

const MOVE_THRESHOLD = 4; // px before a press becomes a drag or a stroke
const HOLD_MS = 300; // left-press-and-hold opens the menu
const SAMPLE_PX = 3; // freehand sampling distance
const MIN_SIZE = 6; // smallest on-screen size a shape can be scaled to
const DOUBLE_CLICK_MS = 400; // two clicks on the rotate knob this close together reset the angle
const MIN_SIDE_PX = 10; // a triangle's first side shorter than this on screen is dropped
const SNAP_PX = 10; // a line's end this close (on screen) to another line's end or a corner joins it
const ERASE_STEP = 4; // px between hit tests along a fast eraser drag, so thin lines aren't skipped

type Gesture =
  | { kind: 'none' }
  // additive: Shift or Cmd/Ctrl held, so a click toggles the shape and a drag adds a box to the selection.
  | { kind: 'press'; start: Pt; screen: Pt; shapeId: string | null; additive: boolean }
  // A press on an unselected shape while drawing with gestures: a drag draws a stroke over it (so a
  // color gesture can fill it), and only a click selects it.
  | { kind: 'strokeOver'; start: Pt; screen: Pt; shapeId: string }
  // In the hand, eraser or create tool: a drag pans, erases or draws the shape, a hold opens the
  // menu, a click erases or places the shape at its default size.
  | { kind: 'toolPress'; tool: 'hand' | 'eraser' | 'create'; start: Pt; screen: Pt; client: { x: number; y: number } }
  | { kind: 'pan'; last: Pt }
  | { kind: 'erase'; last: { x: number; y: number }; checkpointed: boolean }
  // anchors: the moving shapes' snap points where the drag began; targets: everyone else's.
  | { kind: 'drag'; start: Pt; origs: Map<string, Pt>; anchors: Anchor[]; targets: Anchor[] }
  // Dragging one end of a selected line; the other end (`fixed`) stays put.
  | { kind: 'end'; line: Freehand; end: 0 | 1; fixed: Pt; targets: Anchor[]; screen: Pt; moved: boolean }
  | { kind: 'scale'; shapes: Shape[]; corner: Corner; moved: boolean }
  // frame: the selection box when the drag began; start: the pointer's angle about its middle then.
  | { kind: 'rotate'; shapes: Shape[]; frame: Frame; start: number; screen: Pt; moved: boolean }
  | { kind: 'create'; start: Pt; type: PrimitiveType; shape: Shape | null } // shape: as last drawn
  | { kind: 'triSide'; a: Pt; b: Pt | null; targets: Anchor[] } // dragging a new triangle's first side
  | { kind: 'marquee'; start: Pt; base: string[] } // box selection; base: selection it adds to
  // check: pending frame. line: Shift is down, so the stroke is a straight line from its start to `last`.
  | { kind: 'draw'; points: Pt[]; check: number | null; tracker: GhostTracker; line: boolean; last: Pt }
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
/** Whether a world point falls inside a shape's selection box (including its padding), turned with it. */
function inSelectionBox(s: Shape, w: Pt, zoom: number): boolean {
  return inFrame(frameOf(s), w, SELECTION_PAD / zoom);
}
/** The shape under a viewport point, for gestures (the eraser) that hit-test away from e.target. */
function shapeIdAt(x: number, y: number): string | null {
  return hitShapeId(document.elementFromPoint(x, y));
}
/** The shape under a viewport point even when the multi-selection's group area covers it. */
function shapeIdBelow(x: number, y: number): string | null {
  for (const el of document.elementsFromPoint(x, y)) {
    const id = el.closest('[data-id]')?.getAttribute('data-id');
    if (id) return id;
  }
  return null;
}
const isGroupArea = (target: EventTarget | null) => !!(target as Element | null)?.hasAttribute?.('data-group');
function hitHandle(target: EventTarget | null): Handle | null {
  return ((target as Element | null)?.closest?.('[data-handle]')?.getAttribute('data-handle') as Handle | null) ?? null;
}

/** The pointer's direction from a point, in degrees clockwise from east. */
const angleFrom = (c: Pt, p: Pt) => (Math.atan2(p[1] - c[1], p[0] - c[0]) * 180) / Math.PI;
/** A new draw gesture starting at `start`. */
const newStroke = (start: Pt): Gesture => ({ kind: 'draw', points: [start], check: null, tracker: new GhostTracker(), line: false, last: start });

/**
 * New translate/scale for dragging a corner or edge of the shapes' box to `p`, with the opposite
 * corner or edge fixed. An edge scales one axis, or both evenly (about the edge's middle) when locked.
 * The box may be turned (one rotated shape), so the pointer is measured along the box's own axes.
 */
function scaleFromCorner(shapes: Shape[], corner: Corner, p: Pt, lock: boolean) {
  const f = groupFrame(shapes);
  const [qx, qy] = rotatePt(p, [f.cx, f.cy], -f.angle);
  const q: Pt = [qx - f.cx, qy - f.cy]; // the pointer relative to the box's middle, upright
  const b = { minX: -f.w / 2, maxX: f.w / 2, minY: -f.h / 2, maxY: f.h / 2 };
  const movesX = corner.includes('e') || corner.includes('w');
  const movesY = corner.includes('n') || corner.includes('s');
  const cx = corner.includes('e') ? b.maxX : b.minX;
  const ax = !movesX ? 0 : corner.includes('e') ? b.minX : b.maxX;
  const cy = corner.includes('s') ? b.maxY : b.minY;
  const ay = !movesY ? 0 : corner.includes('s') ? b.minY : b.maxY;
  const w = f.w, h = f.h;

  let kx = movesX && w > 1e-6 ? (q[0] - ax) / (cx - ax) : 1;
  let ky = movesY && h > 1e-6 ? (q[1] - ay) / (cy - ay) : 1;
  const minKx = w > 1e-6 ? MIN_SIZE / w : 1;
  const minKy = h > 1e-6 ? MIN_SIZE / h : 1;
  if (lock) {
    // Only the axes being dragged decide the factor.
    const k = Math.max(minKx, minKy, ...(movesX ? [kx] : []), ...(movesY ? [ky] : []));
    kx = ky = k;
  } else {
    kx = Math.max(kx, minKx);
    ky = Math.max(ky, minKy);
  }
  const [wx, wy] = rotatePt([f.cx + ax, f.cy + ay], [f.cx, f.cy], f.angle);
  return scaleAbout(shapes, wx, wy, kx, ky, f.angle);
}

/** The box between two canvas points. */
function boxOf(a: Pt, b: Pt): Bounds {
  return {
    minX: Math.min(a[0], b[0]),
    minY: Math.min(a[1], b[1]),
    maxX: Math.max(a[0], b[0]),
    maxY: Math.max(a[1], b[1]),
  };
}

/** Where the create tool is in making a triangle: dragging its first side, or placing its third corner. */
type TriStep = 'side' | 'corner' | null;

interface StatusInput {
  menu: MenuState | null;
  rotation: number | null; // the selection box's angle while it is being turned
  movingEnd: boolean; // dragging a line's end
  lineSelected: boolean; // the selection is one straight line
  line: boolean; // drawing a straight line (Shift held mid-stroke)
  spaceHeld: boolean;
  mode: string;
  selectionCount: number;
  tool: Tool;
  createType: PrimitiveType;
  triStep: TriStep;
}

/** One line of context-sensitive guidance, so the available actions are never a mystery. */
function statusText({ menu, rotation, movingEnd, lineSelected, line, mode, selectionCount, tool, createType, triStep }: StatusInput) {
  if (menu) return 'Select an option · Click the center or outside the menu to cancel';
  if (mode === 'scaling') return 'Hold Shift to keep proportions';
  if (movingEnd) return 'Snaps to other line ends, shape corners, and 45° steps when close';
  if (rotation !== null) return `${Math.round(normAngle(rotation))}° · Snaps to 45° steps when close · Double-click the handle to reset`;
  if (mode === 'selecting') return 'Every shape the box touches is selected · Release to finish';
  if (triStep === 'side') return 'Release to finish this side · Snaps to shape corners and 45° steps';
  if (triStep === 'corner') return 'Click to place the third corner · Snaps to right angles and equal sides · Press Esc to cancel';
  if (tool === 'create' && createType === 'triangle') {
    return 'Drag to draw one side, then click to place the third corner · Click to place a default triangle · Press Esc to cancel';
  }
  if (tool === 'create') {
    if (mode === 'drawing') return 'Release to finish · Hold Shift for equal sides';
    return `Drag to draw the ${createType} · Click to place one · Press Esc to cancel`;
  }
  if (mode === 'drawing') {
    return line ? 'Straight line · Snaps to line ends, shape corners and 45° steps · Release Shift to draw freely' : 'Hold Shift for a straight line';
  }
  if (tool === 'hand') return 'Drag to pan · Press Esc to exit Pan mode';
  if (tool === 'eraser') return 'Click or drag across shapes to erase them · Press Esc to exit Erase mode';
  if (tool === 'select') {
    if (selectionCount > 0) return `Drag empty space to select again · Drag the selection to move · Press Esc to exit Select mode`;
    return `Drag a box to select shapes · ${kbd('mod')}-click to add or remove · Press Esc to exit Select mode`;
  }
  if (lineSelected) return 'Drag to move · Drag an end to reshape · Right-click for more options';
  if (selectionCount > 0) {
    return `Drag to move · Drag edges or corners to scale · Drag the round handle to rotate · Right-click for more options`;
  }
  return 'Right-click or left-press-and-hold for the menu · Drag to draw · Shift-drag to select';
}

const MARK_PX = 9; // size of the right-angle mark

/** The dashed line a triangle's third corner snapped along, with a right-angle mark where it meets the side. */
function TipGuide({ from, along, tip, right, view }: { from: Pt; along: Pt; tip: Pt; right: boolean; view: View }) {
  const o = toScreen(from, view), t = toScreen(tip, view), s = toScreen(along, view);
  const unit = (q: Pt): Pt => {
    const d = Math.hypot(q[0] - o[0], q[1] - o[1]) || 1;
    return [((q[0] - o[0]) / d) * MARK_PX, ((q[1] - o[1]) / d) * MARK_PX];
  };
  const u = unit(s), v = unit(t);
  return (
    <g className="tip-guide">
      <line x1={o[0]} y1={o[1]} x2={t[0]} y2={t[1]} />
      {right && <polyline points={`${o[0] + u[0]},${o[1] + u[1]} ${o[0] + u[0] + v[0]},${o[1] + u[1] + v[1]} ${o[0] + v[0]},${o[1] + v[1]}`} />}
    </g>
  );
}

export function Canvas() {
  const shapes = useStore((s) => s.shapes);
  const selectedIds = useStore((s) => s.selectedIds);
  const mode = useStore((s) => s.mode);
  const currentColor = useStore((s) => s.currentColor);
  const view = useStore((s) => s.view);
  const dropTargetId = useStore((s) => s.dropTargetId);
  const tool = useStore((s) => s.tool);
  const aiming = useChat((s) => s.inputFocused); // typing to the assistant: the pointer only marks "here"
  const createType = useStore((s) => s.createType);
  const gesturesOn = useStore((s) => s.gesturesOn);

  const svgRef = useRef<SVGSVGElement>(null);
  const gesture = useRef<Gesture>({ kind: 'none' });
  const menuRef = useRef<MenuState | null>(null);
  const timer = useRef<number | undefined>(undefined);
  const spaceRef = useRef(false); // Space held: drag pans the view
  const hoverRef = useRef<Pt | null>(null); // last pointer position over the canvas, where M opens the menu
  const knobClick = useRef(0); // when the rotate knob was last clicked, to catch a double-click

  // Render mirrors of the refs above (the refs are the source of truth inside handlers).
  const [menu, setMenu] = useState<MenuState | null>(null);
  const [stroke, setStroke] = useState<Pt[] | null>(null);
  const [ghost, setGhost] = useState<Recognized | null>(null);
  const [lassoHits, setLassoHits] = useState<Shape[] | null>(null); // while the stroke reads as a lasso: what it would select
  const [draft, setDraft] = useState<Shape | null>(null); // shape being dragged out with the create tool
  const [pulseId, setPulseId] = useState<string | null>(null);
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [shiftHeld, setShiftHeld] = useState(false); // Shift-drag box-selects, so show the select cursor
  const [panning, setPanning] = useState(false); // middle-button / Space drag in progress
  const [eraseTargetId, setEraseTargetId] = useState<string | null>(null); // shape under the eraser
  const [marquee, setMarquee] = useState<Bounds | null>(null); // box selection in progress, canvas coordinates
  const [turning, setTurning] = useState<Frame | null>(null); // the selection box while it is being rotated
  const [lineMode, setLineMode] = useState(false); // the stroke in progress is a straight line
  const [snapRings, setSnapRings] = useState<Pt[]>([]); // where a line's end or a corner has just snapped
  const [movingEnd, setMovingEnd] = useState(false); // a line's end is being dragged
  // A triangle is made by dragging one side, then clicking where its third corner goes. Between the
  // two, no gesture is running (so the view can still be panned and zoomed): the side waits here.
  const triRef = useRef<{ a: Pt; b: Pt; targets: Anchor[] } | null>(null);
  const [triStep, setTriStep] = useState<TriStep>(null);
  // The line the third corner snapped along (from a side's end for a right angle, or its middle).
  const [tipGuide, setTipGuide] = useState<{ from: Pt; along: Pt; tip: Pt; right: boolean } | null>(null);

  const selected = shapes.filter((s) => selectedIds.includes(s.id));

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
    // On a shape in the selection the menu acts on the whole selection; otherwise on just that shape.
    if (!shapeId || !st.selectedIds.includes(shapeId)) st.select(shapeId);
    st.setMode('menuOpen');
    const { shapes, selectedIds } = useStore.getState();
    menuRef.current = {
      items: menuFor(shapes.filter((s) => selectedIds.includes(s.id))),
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

  /** Whether the pointer is on the menu's wedges or its center ×, i.e. inside the cancel edge. */
  const overMenu = (m: MenuState) => {
    const dx = m.pointer[0] - m.origin[0], dy = m.pointer[1] - m.origin[1];
    return Math.hypot(dx, dy) <= cancelRadius(m.items, dx, dy, m.selection.locked);
  };

  const execute = (item: PieItem) => {
    const m = menuRef.current!;
    const origin = toWorld(m.origin, useStore.getState().view); // shapes live in world space
    closeMenu();
    item.run?.({ origin, shapeId: m.shapeId, pulse });
  };

  /**
   * M opens the menu from the keyboard: on the selection's center, else at the pointer (where new
   * shapes go), else mid-screen. It opens in click mode, kept far enough from the edges to fit.
   */
  const openMenuFromKeyboard = () => {
    const { shapes, selectedIds, view } = useStore.getState();
    const sel = shapes.filter((s) => selectedIds.includes(s.id));
    let origin: Pt = hoverRef.current ?? [window.innerWidth / 2, window.innerHeight / 2];
    if (sel.length > 0) {
      const b = groupBounds(sel);
      origin = toScreen([(b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2], view);
    }
    const r = svgRef.current!.getBoundingClientRect();
    const fit = (v: number, size: number) => Math.min(Math.max(v, R_SUB + 8), size - R_SUB - 8);
    openMenu([fit(origin[0], r.width), fit(origin[1], r.height)], sel[0]?.id ?? null);
    makeSticky();
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

  const finishStroke = (points: Pt[], shown: Recognized | null, line: Pt[] | null) => {
    const st = useStore.getState();
    setStroke(null);
    setGhost(null);
    setLassoHits(null);
    setLineMode(false);
    if (line) {
      // A straight line is always ink: never a gesture, never a recognized shape.
      if (dist(line[0], line[1]) * st.view.zoom < MOVE_THRESHOLD) return;
      st.select(null);
      st.addShape(makeFreehand(line, st.currentColor, true), false);
      return;
    }
    if (points.length < 2) return;
    // A scribble over shapes erases them. One that touches no shape falls through like any stroke.
    if (st.gesturesOn && isScribble(points, CUSP_SPAN_PX / st.view.zoom)) {
      const tol = SCRIBBLE_HIT_PX / st.view.zoom;
      const hit = st.shapes.filter((s) => points.some((p) => shapeNearPoint(s, p, tol))).map((s) => s.id);
      if (hit.length > 0) {
        st.deleteShapes(hit);
        st.select(null);
        st.showToast(`Erased ${hit.length === 1 ? '1 shape' : `${hit.length} shapes`} · ${kbd('mod+z')} to undo`);
        return;
      }
    }
    // A stroke the ghost showed as a shape is that shape; otherwise the recognizer decides.
    const it = st.gesturesOn && !shown ? interpret(points) : null;
    const action = it && gestureFor(it.gesture)?.action;
    // A lasso selects the shapes whose center is inside it, replacing the selection, even when that's
    // none. Running on past the start is fine for a lasso, so the overshoot rule below doesn't apply.
    if (action?.kind === 'lasso') {
      const hit = st.shapes.filter((s) => shapeInLasso(s, points)).map((s) => s.id);
      st.setSelection(hit);
      st.showToast(
        hit.length > 0
          ? `Selected ${hit.length === 1 ? '1 shape' : `${hit.length} shapes`} · drag to move, handles to scale`
          : 'Lasso: nothing selected',
      );
      return;
    }
    if (action && action.kind !== 'createShape' && runCommand(action, points)) return;
    // What the ghost showed is what you get, unless the stroke ran on too far past its start.
    // The full stroke only decides when no ghost was up.
    // With gestures off, every stroke stays exactly as drawn.
    const result = !st.gesturesOn || overshot(points) ? null : (shown ?? it?.shape ?? null);
    st.select(null); // not a command, so like any drawing it ends the selection
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

  /**
   * Carries out an edit or color gesture. Returns false when there is nothing for it to act on, after
   * saying so, and the stroke then stays as drawn: it may well have been meant as a line.
   */
  const runCommand = (action: GestureAction, points: Pt[]): boolean => {
    const st = useStore.getState();
    const count = (n: number) => (n === 1 ? '1 shape' : `${n} shapes`);
    switch (action.kind) {
      case 'copy':
      case 'cut': {
        // A slash started inside an unselected shape clears its fill (the topmost one there), like the
        // color gestures fill it. Inside a selected shape the stroke would have been a drag.
        const target = action.kind === 'cut' && st.shapes.findLast((s) => canFill(s) && !st.selectedIds.includes(s.id) && shapeNearPoint(s, points[0], 0));
        if (target) {
          st.refill(target.id, null);
          st.showToast(`Fill: None · ${kbd('mod+z')} to undo`);
          pulse(target.id);
          return true;
        }
        const n = st.selectedIds.length;
        const verb = action.kind === 'copy' ? 'Copy' : 'Cut';
        if (n === 0) {
          st.showToast(`${verb}: nothing selected · lasso shapes first`);
          return false;
        }
        st[action.kind]();
        st.showToast(action.kind === 'copy' ? `Copied ${count(n)}` : `Cut ${count(n)} · ${kbd('mod+z')} to undo`);
        return true;
      }
      case 'paste': {
        if (!st.clipboard) {
          st.showToast('Paste: nothing copied · copy or cut shapes first');
          return false;
        }
        // Centered where the caret was drawn.
        const b = pointsBounds(points);
        st.paste({ x: (b.minX + b.maxX) / 2, y: (b.minY + b.maxY) / 2 });
        st.showToast(`Pasted ${count(st.clipboard.length)}`);
        return true;
      }
      case 'setColor': {
        const name = describeAction(action, st.palette);
        const color = st.palette[action.slot]; // whatever color is on that key now
        // Started inside an unselected shape: fill it (the topmost one there).
        const target = st.shapes.findLast((s) => canFill(s) && !st.selectedIds.includes(s.id) && shapeNearPoint(s, points[0], 0));
        if (target) {
          st.refill(target.id, color);
          st.showToast(`Fill: ${name}`);
          pulse(target.id);
        } else {
          st.setColor(color);
          st.showToast(st.selectedIds.length > 0 ? `Line color: ${name}` : `Line color for new shapes: ${name}`);
        }
        return true;
      }
    }
    return false;
  };

  // ---- create tool ----

  /** Adds the shape the create tool made and hands the pointer back to the draw tool. */
  const placeShape = (shape: Shape) => {
    const st = useStore.getState();
    setDraft(null);
    st.addShape(shape, true);
    st.setTool('draw');
    pulse(shape.id);
  };

  // ---- triangles ----

  const cancelTriangle = () => {
    triRef.current = null;
    setTriStep(null);
    setTipGuide(null);
    setSnapRings([]);
    setDraft(null);
  };

  /**
   * The triangle with its third corner at (or snapped near) `w`: onto another shape's corner or a
   * line's end, else onto a right angle at either end of the side or the line of equal sides.
   */
  const triangleTo = (w: Pt) => {
    const { a, b, targets } = triRef.current!;
    const st = useStore.getState();
    const onAnchor = placeEnd(w, null, targets);
    const snap = onAnchor.snapped ? { p: onAnchor.p, from: null } : snapTriangleTip(a, b, w, SNAP_PX / st.view.zoom);
    const corners: Pt[] = [a, b, snap.p];
    const mid: Pt = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
    setSnapRings(onAnchor.snapped ? [snap.p] : []);
    setTipGuide(
      snap.from === 'a' ? { from: a, along: b, tip: snap.p, right: true }
      : snap.from === 'b' ? { from: b, along: a, tip: snap.p, right: true }
      : snap.from === 'mid' ? { from: mid, along: b, tip: snap.p, right: false }
      : null,
    );
    // Too flat to be a triangle: the third corner is (nearly) on the side's line.
    const flat = triangleArea2(corners) < (dist(a, b) * MIN_SIZE) / st.view.zoom;
    return { shape: makeTriangle(corners as [Pt, Pt, Pt], st.currentColor, st.currentFill), flat };
  };

  // Switching tools (or to another shape) drops a triangle waiting for its third corner.
  useEffect(
    () =>
      useStore.subscribe((st) => {
        if (triRef.current && (st.tool !== 'create' || st.createType !== 'triangle')) cancelTriangle();
      }),
    [],
  );

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

  // ---- straight lines and snapping ----

  /** The snap points of every shape except these. */
  const anchorsExcept = (skip: string[]) =>
    useStore.getState().shapes.filter((s) => !skip.includes(s.id)).flatMap(anchorsOf);

  /**
   * Where a line's end at `p` goes: onto a nearby line end or shape corner if there is one, else onto
   * a 45° step from the other end `from` when close to one, else where it is.
   */
  const placeEnd = (p: Pt, from: Pt | null, targets: Anchor[]): { p: Pt; snapped: boolean } => {
    const hit = closestSnap([{ p, end: true }], targets, SNAP_PX / useStore.getState().view.zoom);
    if (hit) return { p: hit.to, snapped: true };
    return { p: from ? snapSegment(from, p) : p, snapped: false };
  };

  /** The straight line a Shift stroke makes: both ends snapped, with rings where they joined something. */
  const lineOf = (g: Extract<Gesture, { kind: 'draw' }>): [Pt, Pt] => {
    const targets = anchorsExcept([]);
    const a = placeEnd(g.points[0], null, targets);
    const b = placeEnd(g.last, a.p, targets);
    setSnapRings([a, b].filter((x) => x.snapped).map((x) => x.p));
    return [a.p, b.p];
  };

  /**
   * Holding Shift mid-stroke turns the stroke into a straight line from where it began to the pointer
   * (snapping to 45° steps when close); letting go of Shift goes back to the freehand stroke.
   */
  const showLine = (g: Extract<Gesture, { kind: 'draw' }>, on: boolean) => {
    g.line = on;
    setLineMode(on);
    if (on) {
      setGhost(g.tracker.clear());
      setLassoHits(null);
      setStroke(lineOf(g));
    } else {
      setStroke(g.points.slice());
      setSnapRings([]);
    }
  };

  // ---- the single pointer-event router ----

  const onPointerDown = (e: React.PointerEvent<SVGSVGElement>) => {
    const st = useStore.getState();
    const p = toCanvas(e); // screen space: the pie menu lives here
    const w = toWorld(p, st.view); // world space: shapes live here
    // Control-click is the Mac's right-click; on Windows Ctrl+click stays a normal click.
    const right = e.button === 2 || (isMac && e.button === 0 && e.ctrlKey);
    // Shift, or the platform's shortcut key (Cmd on Mac, Ctrl elsewhere), adds to the selection.
    const additive = e.shiftKey || (isMac ? e.metaKey : e.ctrlKey);
    if (e.button > 2) return;
    e.currentTarget.setPointerCapture(e.pointerId);

    // Middle button (hold the scroll wheel) or Space+drag pans, like a map. The hand tool does too,
    // once the press moves (see toolPress), so a hold can still open the menu.
    const spacePan = spaceRef.current && e.button === 0 && !right;
    if (e.button === 1 || (spacePan && !menuRef.current)) {
      gesture.current = { kind: 'pan', last: p };
      setPanning(true);
      return;
    }

    // The click that places a triangle's third corner; a right-click drops the triangle instead.
    if (triRef.current) {
      if (right) cancelTriangle();
      else {
        const { shape, flat } = triangleTo(w);
        if (!flat) {
          cancelTriangle();
          placeShape(shape);
        }
      }
      gesture.current = { kind: 'swallow' };
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

    // A selected shape owns its whole selection box, so empty space inside the box (between a
    // stroke's lines, or around a circle) counts as the shape for press, drag, hold, and right-click.
    // A multi-selection's box acts as one object: pressing anywhere inside it presses the group,
    // except that a modifier-click still reaches the shape underneath to toggle it.
    const sel = st.shapes.filter((s) => st.selectedIds.includes(s.id));
    const shapeId = isGroupArea(e.target)
      ? additive
        ? shapeIdBelow(e.clientX, e.clientY)
        : sel[0].id
      : (hitShapeId(e.target) ?? sel.find((s) => inSelectionBox(s, w, st.view.zoom))?.id ?? null);

    // The hand, eraser and create tools wait to see whether the press is a drag, a click or a hold.
    if ((st.tool === 'hand' || st.tool === 'eraser' || st.tool === 'create') && !right) {
      gesture.current = { kind: 'toolPress', tool: st.tool, start: w, screen: p, client: { x: e.clientX, y: e.clientY } };
      startHold(p, shapeId);
      return;
    }

    if (right) {
      openMenu(p, shapeId);
      gesture.current = { kind: 'menu' };
      return;
    }

    const handle = hitHandle(e.target);
    if ((handle === 'end0' || handle === 'end1') && sel.length === 1 && isLine(sel[0])) {
      const end = handle === 'end0' ? 0 : 1;
      const line = sel[0];
      gesture.current = { kind: 'end', line, end, fixed: lineEnds(line)[1 - end], targets: anchorsExcept([line.id]), screen: p, moved: false };
      st.setMode('dragging');
      return;
    }
    if (handle === 'rotate' && sel.length > 0) {
      if (e.timeStamp - knobClick.current < DOUBLE_CLICK_MS) {
        // Double-click the knob: stand the shapes back upright.
        knobClick.current = 0;
        st.setRotation(0);
        gesture.current = { kind: 'swallow' };
        return;
      }
      knobClick.current = e.timeStamp;
      const frame = groupFrame(sel);
      gesture.current = { kind: 'rotate', shapes: sel, frame, start: angleFrom([frame.cx, frame.cy], w), screen: p, moved: false };
      st.setMode('rotating');
      setTurning(frame);
      return;
    }
    if (handle && handle !== 'rotate' && handle !== 'end0' && handle !== 'end1' && sel.length > 0) {
      gesture.current = { kind: 'scale', shapes: sel, corner: handle, moved: false };
      st.setMode('scaling');
      return;
    }

    // A drag that starts on the end of an unselected line draws from that end (hold Shift for a
    // straight line), so lines can be chained. A click there still selects the line.
    const pressed = st.tool === 'draw' && !additive && shapeId && !st.selectedIds.includes(shapeId)
      ? st.shapes.find((s) => s.id === shapeId) : undefined;
    const fromEnd = pressed && isLine(pressed) ? lineEnds(pressed).find((q) => dist(q, w) * st.view.zoom <= SNAP_PX) : undefined;
    if (pressed && fromEnd) {
      gesture.current = { kind: 'strokeOver', start: fromEnd, screen: p, shapeId: pressed.id };
      startHold(p, shapeId);
      return;
    }

    if (additive) {
      // Nothing changes until release (click toggles) or a drag starts a box.
      gesture.current = { kind: 'press', start: w, screen: p, shapeId, additive };
      return;
    }
    // Drawing with gestures, a stroke may be a command on the selection, so a press only changes the
    // selection once it turns out to be a click. Strokes that end up as shapes or ink clear it then.
    if (st.tool === 'draw' && st.gesturesOn && (!shapeId || !st.selectedIds.includes(shapeId))) {
      gesture.current = shapeId ? { kind: 'strokeOver', start: w, screen: p, shapeId } : { kind: 'press', start: w, screen: p, shapeId, additive };
      startHold(p, shapeId);
      return;
    }
    // Pressing a shape that is already selected keeps the whole selection, so it can be dragged.
    if (!shapeId || !st.selectedIds.includes(shapeId)) st.select(shapeId);
    gesture.current = { kind: 'press', start: w, screen: p, shapeId, additive };
    startHold(p, shapeId);
  };

  /** Left-press-and-hold without moving opens the menu, whatever the tool. */
  const startHold = (screen: Pt, shapeId: string | null) => {
    const g = gesture.current;
    timer.current = window.setTimeout(() => {
      if (gesture.current !== g) return; // the press already became something else
      openMenu(screen, shapeId);
      gesture.current = { kind: 'menu' };
    }, HOLD_MS);
  };

  /** The eraser removes whole shapes: the one pressed on, then any the drag passes over. */
  const startErase = (x: number, y: number) => {
    gesture.current = { kind: 'erase', last: { x, y }, checkpointed: false };
    useStore.getState().setMode('erasing');
    eraseAt(x, y);
  };

  const onPointerMove = (e: React.PointerEvent<SVGSVGElement>) => {
    const g = gesture.current;
    const st = useStore.getState();
    const p = toCanvas(e);
    const w = toWorld(p, st.view);
    hoverRef.current = p;

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
        if (triRef.current) {
          const { shape, flat } = triangleTo(w);
          const { a, b } = triRef.current;
          setDraft(flat ? makeFreehand([a, b], st.currentColor, true) : shape);
          return;
        }
        setShiftHeld(e.shiftKey); // catches Shift pressed while the window was out of focus
        if (menuRef.current?.sticky) trackMenu(p); // click mode follows the hovering pointer
        else setEraseTargetId(st.tool === 'eraser' && !spaceRef.current ? shapeIdAt(e.clientX, e.clientY) : null);
        return;
      case 'menu':
        trackMenu(p);
        return;
      case 'toolPress':
        if (dist(p, g.screen) < MOVE_THRESHOLD) return;
        clearTimer();
        if (g.tool === 'eraser') startErase(g.client.x, g.client.y);
        else if (g.tool === 'create' && st.createType === 'triangle') {
          const targets = anchorsExcept([]);
          gesture.current = { kind: 'triSide', a: placeEnd(g.start, null, targets).p, b: null, targets };
          st.setMode('drawing');
          setTriStep('side');
        } else if (g.tool === 'create') {
          gesture.current = { kind: 'create', start: g.start, type: st.createType, shape: null };
          st.setMode('drawing');
        } else {
          gesture.current = { kind: 'pan', last: g.screen };
          setPanning(true);
        }
        onPointerMove(e);
        return;
      case 'strokeOver':
        if (dist(p, g.screen) < MOVE_THRESHOLD) return;
        clearTimer();
        gesture.current = newStroke(g.start);
        st.setMode('drawing');
        onPointerMove(e);
        return;
      case 'press': {
        if (dist(p, g.screen) < MOVE_THRESHOLD) return;
        clearTimer();
        if (g.additive || (!g.shapeId && st.tool === 'select')) {
          gesture.current = { kind: 'marquee', start: g.start, base: g.additive ? st.selectedIds : [] };
          st.setMode('selecting');
        } else if (g.shapeId) {
          const moving = st.shapes.filter((s) => st.selectedIds.includes(s.id));
          const origs = new Map<string, Pt>(moving.map((s) => [s.id, [s.x, s.y]]));
          st.checkpoint();
          gesture.current = { kind: 'drag', start: g.start, origs, anchors: moving.flatMap(anchorsOf), targets: anchorsExcept(st.selectedIds) };
          st.setMode('dragging');
        } else {
          gesture.current = newStroke(g.start);
          st.setMode('drawing');
        }
        onPointerMove(e);
        return;
      }
      case 'drag': {
        let dx = w[0] - g.start[0], dy = w[1] - g.start[1];
        // A moved line's ends, or a moved shape's corners, pull the whole selection onto a nearby line end.
        const moved = g.anchors.map((a): Anchor => ({ p: [a.p[0] + dx, a.p[1] + dy], end: a.end }));
        const hit = closestSnap(moved, g.targets, SNAP_PX / st.view.zoom);
        if (hit) {
          dx += hit.to[0] - hit.from[0];
          dy += hit.to[1] - hit.from[1];
        }
        setSnapRings(hit ? [hit.to] : []);
        st.updateShapes(new Map([...g.origs].map(([id, [x, y]]) => [id, { x: x + dx, y: y + dy }])));
        return;
      }
      case 'end': {
        if (!g.moved) {
          if (dist(p, g.screen) < MOVE_THRESHOLD) return;
          st.checkpoint();
          g.moved = true;
          setMovingEnd(true);
        }
        const q = placeEnd(w, g.fixed, g.targets);
        st.putShape(lineWithEnds(g.line, g.end === 0 ? q.p : g.fixed, g.end === 0 ? g.fixed : q.p));
        setSnapRings(q.snapped ? [q.p] : []);
        return;
      }
      case 'scale': {
        if (!g.moved) {
          st.checkpoint();
          g.moved = true;
        }
        // Squares and circles can't stretch, so a selection holding one keeps its proportions.
        const lock = e.shiftKey || mustScaleEvenly(g.shapes);
        st.updateShapes(scaleFromCorner(g.shapes, g.corner, w, lock));
        return;
      }
      case 'rotate': {
        if (!g.moved) {
          if (dist(p, g.screen) < MOVE_THRESHOLD) return; // still a click (maybe half a double-click)
          st.checkpoint();
          g.moved = true;
          knobClick.current = 0; // a turn, not the first half of a double-click
        }
        const f = g.frame;
        // The box's new angle, pulled onto a 45° step when it comes close to one.
        const angle = snapAngle(f.angle + normAngle(angleFrom([f.cx, f.cy], w) - g.start));
        st.updateShapes(rotateAbout(g.shapes, f.cx, f.cy, angle - f.angle));
        setTurning({ ...f, angle });
        return;
      }
      case 'triSide': {
        // Like drawing a straight line: the end snaps to corners and line ends, else to 45° steps.
        const q = placeEnd(w, g.a, g.targets);
        g.b = q.p;
        setDraft(makeFreehand([g.a, q.p], st.currentColor, true));
        setSnapRings(q.snapped ? [q.p] : []);
        return;
      }
      case 'create':
        // The press point stays put as one corner; the pointer drags the opposite one.
        g.shape = makePrimitiveInBox(g.type, g.start, w, st.currentColor, st.currentFill, e.shiftKey, MIN_SIZE / st.view.zoom);
        setDraft(g.shape);
        return;
      case 'marquee': {
        const box = boxOf(g.start, w);
        setMarquee(box);
        const hits = st.shapes.filter((s) => shapeTouchesRect(s, box)).map((s) => s.id);
        st.setSelection([...g.base, ...hits.filter((id) => !g.base.includes(id))]);
        return;
      }
      case 'draw': {
        g.last = w;
        if (e.shiftKey || g.line) showLine(g, e.shiftKey);
        if (dist(w, g.points[g.points.length - 1]) * st.view.zoom < SAMPLE_PX) return;
        g.points.push(w); // kept while Shift is down too, so letting go of it resumes the freehand stroke
        if (g.line) return;
        // Recognize at most once per frame, on the stroke as it is when the frame comes.
        if (st.gesturesOn) g.check ??= requestAnimationFrame(() => {
          g.check = null;
          if (gesture.current !== g) return; // stroke already finished
          if (g.line) return;
          const it = interpret(g.points);
          setGhost(overshot(g.points) ? g.tracker.clear() : g.tracker.update(it?.shape ?? null));
          // A recognized lasso is tinted, with the shapes it would select outlined.
          setLassoHits(it?.gesture === 'lasso' ? useStore.getState().shapes.filter((s) => shapeInLasso(s, g.points)) : null);
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
      case 'press': {
        // A click (no drag) with a modifier toggles the shape.
        if (g.additive && g.shapeId) useStore.getState().toggleSelect(g.shapeId);
        else if (!g.shapeId) useStore.getState().select(null); // a click on empty canvas
        break;
      }
      case 'strokeOver':
        useStore.getState().select(g.shapeId); // a click selects it
        break;
      case 'toolPress':
        if (g.tool === 'eraser') {
          startErase(g.client.x, g.client.y); // a click erases the shape under it
          gesture.current = { kind: 'none' };
        } else if (g.tool === 'create') {
          // A click places the shape at its default size, centered on the pointer.
          const st = useStore.getState();
          placeShape(makePrimitive(st.createType, g.start[0], g.start[1], st.currentColor, st.currentFill));
        }
        break;
      case 'create':
        if (g.shape) placeShape(g.shape);
        break;
      case 'triSide':
        setSnapRings([]);
        // A side long enough to build on waits for its third corner; a scrap of one is dropped.
        if (g.b && dist(g.a, g.b) * useStore.getState().view.zoom >= MIN_SIDE_PX) {
          triRef.current = { a: g.a, b: g.b, targets: g.targets };
          setTriStep('corner');
        } else cancelTriangle();
        break;
      case 'marquee':
        setMarquee(null);
        break;
      case 'menu':
        if (menuRef.current) releaseMenu();
        return; // mode is managed by the menu
      case 'draw':
        if (g.check !== null) cancelAnimationFrame(g.check);
        finishStroke(g.points, g.tracker.shown, g.line ? lineOf(g) : null);
        setSnapRings([]);
        break;
      case 'drag':
        setSnapRings([]);
        break;
      case 'end':
        setSnapRings([]);
        setMovingEnd(false);
        break;
      case 'rotate':
        setTurning(null);
        break;
    }
    if (!menuRef.current) useStore.getState().setMode('idle');
  };

  const onPointerCancel = () => {
    const g = gesture.current;
    if (g.kind === 'draw' && g.check !== null) cancelAnimationFrame(g.check);
    gesture.current = { kind: 'none' };
    setStroke(null);
    setMarquee(null);
    setGhost(null);
    setLassoHits(null);
    setDraft(null);
    setTurning(null);
    setLineMode(false);
    setSnapRings([]);
    setMovingEnd(false);
    cancelTriangle();
    closeMenu();
  };

  // ---- keyboard ----

  useKeyboard(
    useCallback(() => {
      const st = useStore.getState();
      if (menuRef.current) closeMenu();
      else if (gesture.current.kind === 'create' || gesture.current.kind === 'triSide' || triRef.current) {
        // Esc mid-drag (or before a triangle's third corner) drops the shape being drawn and leaves the create tool.
        if (gesture.current.kind !== 'none') gesture.current = { kind: 'swallow' };
        cancelTriangle();
        st.setMode('idle');
        st.setTool('draw');
      }
      // In the select tool, the first Esc clears the selection and the next one leaves the tool.
      else if (st.tool === 'select' && st.selectedIds.length > 0) st.select(null);
      else if (st.tool !== 'draw') st.setTool('draw');
      else st.select(null);
    }, []),
    // M opens and closes the menu; an open menu takes the arrow keys and Enter (see pieStep).
    useCallback((e: KeyboardEvent) => {
      const m = menuRef.current;
      if (e.metaKey || e.ctrlKey || e.altKey) return false;
      if (e.key.toLowerCase() === 'm' && !e.repeat) {
        if (m) closeMenu();
        else if (gesture.current.kind === 'none') openMenuFromKeyboard();
        return true;
      }
      if (!m) {
        // Without a mouse, Enter places the armed shape at the pointer, or mid-screen.
        const st = useStore.getState();
        const onCanvas = !document.activeElement || document.activeElement === document.body;
        if (e.key !== 'Enter' || st.tool !== 'create' || gesture.current.kind !== 'none' || !onCanvas) return false;
        const r = svgRef.current!.getBoundingClientRect();
        const [x, y] = toWorld(hoverRef.current ?? [r.width / 2, r.height / 2], st.view);
        placeShape(makePrimitive(st.createType, x, y, st.currentColor, st.currentFill));
        return true;
      }
      if (e.key === 'Enter') {
        const item = selectedItem(m.items, m.selection);
        if (item?.children) m.selection = pieStep(m.items, m.selection, 'ArrowUp')!;
        else if (item) {
          execute(item);
          return true;
        }
        renderMenu();
        return true;
      }
      const next = pieStep(m.items, m.selection, e.key);
      if (!next) return false;
      m.selection = next;
      renderMenu();
      return true;
      // eslint-disable-next-line react-hooks/exhaustive-deps -- execute and placeShape only use refs and the stable pulse
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
      const sel = st.shapes.filter((x) => st.selectedIds.includes(x.id));
      if (sel.length === 0) {
        // Nothing selected: pinch zooms the view around the fingers.
        const r = svg.getBoundingClientRect();
        st.zoomBy(Math.exp(-delta * 0.01), { x: e.clientX - r.left, y: e.clientY - r.top });
        return;
      }
      if (e.timeStamp - lastPinch > 400) st.checkpoint(); // one undo step per pinch
      lastPinch = e.timeStamp;
      const b = groupBounds(sel);
      const minK = Math.max(MIN_SIZE / (b.maxX - b.minX || 1), MIN_SIZE / (b.maxY - b.minY || 1));
      const k = Math.max(Math.exp(-delta * 0.01), minK);
      // Scale the selection about its center.
      st.updateShapes(scaleAbout(sel, (b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, k, k));
    };
    svg.addEventListener('wheel', onWheel, { passive: false });
    return () => svg.removeEventListener('wheel', onWheel);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(true);
      if (e.key === 'Shift' && gesture.current.kind === 'draw') showLine(gesture.current, true);
      if (e.code === 'Space' && !e.repeat && !isTextField(e.target)) {
        spaceRef.current = true;
        setSpaceHeld(true);
        e.preventDefault();
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.key === 'Shift') setShiftHeld(false);
      if (e.key === 'Shift' && gesture.current.kind === 'draw') showLine(gesture.current, false);
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpaceHeld(false);
      }
    };
    const blur = () => setShiftHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
      clearTimer();
    };
  }, []);

  return (
    <>
      <svg
        ref={svgRef}
        className={`canvas mode-${mode} ${spaceHeld || panning ? 'panning' : tool !== 'draw' ? tool : ''}${shiftHeld && (tool === 'draw' || tool === 'select') ? ' shift-select' : ''}${gesturesOn && tool === 'draw' ? ' gestures' : ''}${menu && overMenu(menu) ? ' over-menu' : ''}${aiming ? ' aiming' : ''}`}
        onPointerDown={onPointerDown}
        // The create tool's cursor shows the shape it will draw (see .canvas.create).
        style={tool === 'create' ? ({ '--create-cursor': shapeCursor(createType) } as React.CSSProperties) : undefined}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerCancel}
        onPointerLeave={() => {
          setEraseTargetId(null);
          hoverRef.current = null;
        }}
        onContextMenu={(e) => e.preventDefault()}
      >
        <g transform={`translate(${view.x} ${view.y}) scale(${view.zoom})`}>
          {shapes.map((s) => (
            <ShapeView
              key={s.id}
              shape={s}
              zoom={view.zoom}
              className={`shape${selectedIds.includes(s.id) ? ' selected' : ''}${s.id === dropTargetId ? ' drop-target' : ''}${tool === 'eraser' && s.id === eraseTargetId ? ' erase-target' : ''}`}
              pulse={s.id === pulseId}
            />
          ))}
          {draft && <ShapeView shape={draft} zoom={view.zoom} interactive={false} />}
          {ghost && <GhostPreview result={ghost} color={currentColor} zoom={view.zoom} />}
          {lassoHits && stroke && <polygon className="lasso-fill" points={stroke.map((q) => q.join(',')).join(' ')} />}
          {stroke && (
            <polyline
              className="live-stroke"
              stroke={currentColor}
              strokeWidth={STROKE_WIDTH * view.zoom}
              points={stroke.map((q) => q.join(',')).join(' ')}
            />
          )}
        </g>
        {/* While a box is being dragged, only outline what it touches; the group box comes on release.
            It stays up while drawing, since a gesture stroke (copy, cut, color...) acts on it, but not
            while the create tool drags out a new shape. */}
        {selected.length > 0 && !(mode === 'drawing' && tool === 'create') && (
          <SelectionHandles shapes={selected} view={view} preview={mode === 'selecting'} frame={turning} />
        )}
        {snapRings.map((q, i) => {
          const [x, y] = toScreen(q, view);
          return <circle key={i} className="snap-ring" cx={x} cy={y} r={8} />;
        })}
        {tipGuide && <TipGuide {...tipGuide} view={view} />}
        {lassoHits && lassoHits.length > 0 && <SelectionHandles shapes={lassoHits} view={view} preview />}
        {marquee && (() => {
          const [x0, y0] = toScreen([marquee.minX, marquee.minY], view);
          const [x1, y1] = toScreen([marquee.maxX, marquee.maxY], view);
          return <rect className="marquee" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />;
        })()}
        {menu && (
          <PieMenu items={menu.items} origin={menu.origin} pointer={menu.pointer} selection={menu.selection} />
        )}
      </svg>

      {shapes.length === 0 && !menu && !stroke && !draft && (
        <div className="empty-state">
          <div className="empty-title">Right-click or left-press-and-hold for the menu</div>
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
        {statusText({ menu, rotation: turning?.angle ?? null, movingEnd, lineSelected: selected.length === 1 && isLine(selected[0]), line: lineMode, spaceHeld: spaceHeld || panning, mode, selectionCount: selected.length, tool, createType, triStep })}
      </div>
    </>
  );
}
