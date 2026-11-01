import { MAX_SWATCHES, colorLabel, normalizeHex } from '../colors';
import { anchorsOf, dist, frameOf, isLine, groupFrame, makeFreehand, makePrimitive, makePrimitiveInBox, mustScaleEvenly, normAngle, scaleAbout, toWorldFn } from '../geometry';
import { useStore } from '../store';
import { PALETTE, type PrimitiveType, type Pt, type Shape } from '../types';
import { fitToContent, resetZoom, toScreen, toWorld, zoomIn, zoomOut } from '../view';

// The assistant's tools. Each one is a thin wrapper over an action the app already has (the same
// store calls the pie menu, gestures and keyboard make), so the assistant can do nothing a user can't.

/** A tool in the JSON Schema form both provider APIs accept. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolOutcome {
  /** Sent back to the model. */
  result: string;
  /** Shown in the chat; omitted for read-only tools. */
  summary?: string;
  isError?: boolean;
}

const COLOR_NAMES = PALETTE.map((c) => c.name.toLowerCase());
const COLOR_HELP = `A hex color such as #ff8800 (any color), or one of the names ${COLOR_NAMES.join(', ')}.`;
const SHAPES: PrimitiveType[] = ['square', 'rectangle', 'circle', 'ellipse', 'triangle'];
const MIN_SIZE = 6; // same floor as scaling on the canvas
const MAX_SIZE = 5000;

const num = { type: 'number' };
const colorParam = (what: string) => ({ type: 'string', description: `${what} ${COLOR_HELP}` });

export const TOOLS: ToolSpec[] = [
  {
    name: 'get_canvas',
    description: 'Returns the current canvas state, in the same format as the <canvas> block in user messages.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'create_shape',
    description: 'Creates a shape centered on (x, y) and selects it. Leave out width/height for the default size, and colors to use the current default colors.',
    parameters: {
      type: 'object',
      properties: {
        type: { type: 'string', enum: SHAPES },
        x: num,
        y: num,
        width: { ...num, description: 'Squares and circles use the larger of width and height for both.' },
        height: num,
        rotation: { ...num, description: 'Degrees clockwise. Width and height are measured before turning.' },
        line_color: colorParam('Outline color.'),
        fill_color: colorParam('Fill color, or none.'),
      },
      required: ['type', 'x', 'y'],
    },
  },
  {
    name: 'draw_line',
    description: 'Draws a straight line from (x1, y1) to (x2, y2) and selects it. Use it for dividers, arrows (a shaft plus two short head lines), connectors, and outlines of shapes there is no primitive for.',
    parameters: {
      type: 'object',
      properties: { x1: num, y1: num, x2: num, y2: num, color: colorParam('Line color.') },
      required: ['x1', 'y1', 'x2', 'y2'],
    },
  },
  {
    name: 'select_shapes',
    description: 'Selects shapes by id. Replaces the selection unless add is true. An empty list with add false clears the selection.',
    parameters: {
      type: 'object',
      properties: { ids: { type: 'array', items: { type: 'string' } }, add: { type: 'boolean' } },
      required: ['ids'],
    },
  },
  {
    name: 'select_all',
    description: 'Selects every shape.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'move_selection',
    description: 'Moves the selected shapes by (dx, dy) canvas units. Positive dx is right, positive dy is down.',
    parameters: { type: 'object', properties: { dx: num, dy: num }, required: ['dx', 'dy'] },
  },
  {
    name: 'scale_selection',
    description: 'Scales the selected shapes about the center of their joint bounding box; factor 2 doubles the size. factor_y, if given, sets the vertical factor separately (rotated shapes keep their angle and stretch along their own sides). A selection containing a square or circle always scales evenly.',
    parameters: { type: 'object', properties: { factor: num, factor_y: num }, required: ['factor'] },
  },
  {
    name: 'rotate_selection',
    description: 'Rotates the selected shapes clockwise by degrees (negative is counterclockwise), turning them together about the center of their joint box. With absolute true, sets each shape to that angle instead, each turning about its own center (0 stands it upright).',
    parameters: { type: 'object', properties: { degrees: num, absolute: { type: 'boolean' } }, required: ['degrees'] },
  },
  {
    name: 'copy',
    description: 'Copies the selected shapes to the clipboard.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'cut',
    description: 'Copies the selected shapes to the clipboard and removes them.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'paste',
    description: 'Pastes the clipboard and selects the pasted shapes. With x and y, the pasted group is centered there; otherwise it lands slightly offset from the last copy or paste.',
    parameters: { type: 'object', properties: { x: num, y: num } },
  },
  {
    name: 'delete_selection',
    description: 'Deletes the selected shapes.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'set_color',
    description: 'Sets the line or fill color of the selected shapes. With nothing selected, sets the default for new shapes.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['line', 'fill'] },
        color: { type: 'string', description: `${COLOR_HELP} none is only valid for fill.` },
      },
      required: ['target', 'color'],
    },
  },
  {
    name: 'set_key_color',
    description: "Puts a color on one of the user's color keys 1-5 (their quick palette: keys, number gestures, swatch fan and menu all use it). Only when the user asks to change their palette or keys.",
    parameters: {
      type: 'object',
      properties: { key: { type: 'integer', minimum: 1, maximum: 5 }, color: { type: 'string', description: COLOR_HELP } },
      required: ['key', 'color'],
    },
  },
  {
    name: 'save_swatches',
    description: `Saves colors to the user's saved swatches (the outer row of the swatch fan, at most ${MAX_SWATCHES}; the oldest drop off). Only when the user asks to save colors or a palette.`,
    parameters: {
      type: 'object',
      properties: { colors: { type: 'array', items: { type: 'string' }, description: COLOR_HELP } },
      required: ['colors'],
    },
  },
  {
    name: 'arrange',
    description: 'Brings the selected shapes to the front or sends them to the back.',
    parameters: { type: 'object', properties: { to: { type: 'string', enum: ['front', 'back'] } }, required: ['to'] },
  },
  {
    name: 'undo_redo',
    description: 'Undoes or redoes changes. Every tool call that changes the drawing is one step.',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['undo', 'redo'] }, times: { type: 'integer', minimum: 1 } },
      required: ['action'],
    },
  },
  {
    name: 'clear_all',
    description: 'Removes every shape (undoable). Only when the user clearly asks for it.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'set_view',
    description: 'Changes the view: fit zooms and pans to show every shape; zoom_in, zoom_out and reset (100%) zoom about the screen center.',
    parameters: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['fit', 'zoom_in', 'zoom_out', 'reset'] } },
      required: ['action'],
    },
  },
];

// ---- canvas state for the model ----

const r = (n: number) => Math.round(n);
/** Default palette colors by name, anything else as its hex code. */
const colorName = (value: string | null) => (value === null ? 'none' : PALETTE.some((c) => c.value === value) ? colorLabel(value).toLowerCase() : value);

/**
 * The shape a click at this canvas point would get. Asks the browser, as the canvas itself does for
 * clicks and hover, so "this" means exactly the shape the user sees highlighted under the pointer.
 */
function shapeAt(p: Pt): string | null {
  const { view, shapes } = useStore.getState();
  const [x, y] = toScreen(p, view);
  for (const el of document.elementsFromPoint(x, y)) {
    const id = el.closest('[data-id]')?.getAttribute('data-id');
    if (id && shapes.some((s) => s.id === id)) return id;
  }
  return null;
}

/**
 * Where the user is pointing and what part of the canvas they can see, both in canvas units.
 * `visibleLeft` is the screen x where the canvas stops being covered (by the chat panel).
 */
export interface Pointing {
  pointer: Pt | null;
  visibleLeft: number;
}

/** The canvas as the model sees it: a compact JSON summary. */
export function canvasState({ pointer, visibleLeft }: Pointing): string {
  const st = useStore.getState();
  const top = 48; // the top bar
  const [x0, y0] = toWorld([visibleLeft, top], st.view);
  const [x1, y1] = toWorld([window.innerWidth, window.innerHeight], st.view);
  const under = pointer && shapeAt(pointer);
  return JSON.stringify({
    visible_area: { left: r(x0), top: r(y0), right: r(x1), bottom: r(y1) },
    pointer: pointer ? { x: r(pointer[0]), y: r(pointer[1]), over_shape: under || null } : null,
    selected: st.selectedIds,
    clipboard: st.clipboard ? st.clipboard.length : 0,
    default_colors: { line: colorName(st.currentColor), fill: colorName(st.currentFill) },
    color_keys: st.palette.map(colorName),
    saved_swatches: st.swatches,
    shapes_back_to_front: st.shapes.map((s) => {
      // A straight line is given by its end points, which say more than a box.
      if (isLine(s)) {
        const [[x1, y1], [x2, y2]] = s.points.map(toWorldFn(s));
        return { id: s.id, type: 'line', x1: r(x1), y1: r(y1), x2: r(x2), y2: r(y2), line: colorName(s.stroke) };
      }
      // Size is the shape's own width and height, before any rotation.
      const f = frameOf(s);
      return {
        id: s.id,
        type: s.type,
        x: r(f.cx),
        y: r(f.cy),
        width: r(f.w),
        height: r(f.h),
        ...(s.rotation ? { rotation: Math.round(s.rotation) } : {}),
        // Exact corners, so a line can be drawn from or to one (in the shape's own order, clockwise).
        ...(s.type === 'freehand' || s.type === 'circle' || s.type === 'ellipse' ? {} : { corners: anchorsOf(s).map((a) => a.p.map(r)) }),
        line: colorName(s.stroke),
        ...(s.type === 'freehand' ? {} : { fill: colorName(s.fill) }),
      };
    }),
  });
}

// ---- running a tool ----

class InputError extends Error {}

function number(input: Record<string, unknown>, key: string, optional: true): number | undefined;
function number(input: Record<string, unknown>, key: string): number;
function number(input: Record<string, unknown>, key: string, optional = false) {
  const v = input[key];
  if (v === undefined || v === null) {
    if (optional) return undefined;
    throw new InputError(`${key} is required`);
  }
  if (typeof v !== 'number' || !Number.isFinite(v)) throw new InputError(`${key} must be a number`);
  return v;
}

function oneOf<T extends string>(input: Record<string, unknown>, key: string, options: readonly T[], optional = false): T | undefined {
  const v = input[key];
  if (v === undefined || v === null) {
    if (optional) return undefined;
    throw new InputError(`${key} is required`);
  }
  if (!options.includes(v as T)) throw new InputError(`${key} must be one of ${options.join(', ')}`);
  return v as T;
}

/** A color argument as #rrggbb (or null for none, where allowed). */
function color(input: Record<string, unknown>, key: string, opts: { optional?: boolean; none?: boolean } = {}): string | null | undefined {
  const v = input[key];
  if (v === undefined || v === null) {
    if (opts.optional) return undefined;
    throw new InputError(`${key} is required`);
  }
  if (typeof v !== 'string') throw new InputError(`${key} must be a string`);
  const name = v.trim().toLowerCase();
  if (name === 'none') {
    if (opts.none) return null;
    throw new InputError(`${key} can't be none`);
  }
  const named = PALETTE.find((c) => c.name.toLowerCase() === name);
  const value = named?.value ?? normalizeHex(name);
  if (!value) throw new InputError(`${key} must be a hex color like #ff8800 or one of ${COLOR_NAMES.join(', ')}`);
  return value;
}

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;
const needSelection = () => {
  if (useStore.getState().selectedIds.length === 0) throw new InputError('Nothing is selected. Select shapes first.');
};

export function runTool(name: string, input: Record<string, unknown>, pointing: Pointing): ToolOutcome {
  try {
    return run(name, input, pointing);
  } catch (e) {
    if (e instanceof InputError) return { result: e.message, isError: true };
    throw e;
  }
}

function run(name: string, input: Record<string, unknown>, pointing: Pointing): ToolOutcome {
  const st = useStore.getState();
  const selection = () => st.shapes.filter((s) => st.selectedIds.includes(s.id));

  switch (name) {
    case 'get_canvas':
      return { result: canvasState(pointing) };

    case 'create_shape': {
      const type = oneOf(input, 'type', SHAPES)!;
      const x = number(input, 'x'), y = number(input, 'y');
      const w = number(input, 'width', true), h = number(input, 'height', true);
      const rotation = number(input, 'rotation', true) ?? 0;
      const lineColor = color(input, 'line_color', { optional: true }) ?? st.currentColor;
      const fill = color(input, 'fill_color', { optional: true, none: true });
      const fillValue = fill === undefined ? st.currentFill : fill;
      let shape: Shape;
      if (w === undefined && h === undefined) shape = makePrimitive(type, x, y, lineColor, fillValue);
      else {
        // Same as dragging out a box with the create tool: a missing side matches the given one.
        const clamp = (v: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, v));
        const bw = clamp(w ?? h!), bh = clamp(h ?? w!);
        shape = makePrimitiveInBox(type, [x - bw / 2, y - bh / 2], [x + bw / 2, y + bh / 2], lineColor, fillValue);
      }
      shape.rotation = normAngle(rotation); // primitives are centered on (x, y), so they turn in place
      st.addShape(shape);
      return { result: `Created ${type} ${shape.id}`, summary: `Created a ${type}` };
    }

    case 'draw_line': {
      const a: Pt = [number(input, 'x1'), number(input, 'y1')];
      const b: Pt = [number(input, 'x2'), number(input, 'y2')];
      if (dist(a, b) < MIN_SIZE) throw new InputError(`The line must be at least ${MIN_SIZE} units long`);
      if (dist(a, b) > MAX_SIZE) throw new InputError(`The line can be at most ${MAX_SIZE} units long`);
      const line = makeFreehand([a, b], color(input, 'color', { optional: true }) ?? st.currentColor, true);
      st.addShape(line);
      return { result: `Drew line ${line.id}`, summary: 'Drew a line' };
    }

    case 'select_shapes': {
      const ids = input.ids;
      if (!Array.isArray(ids) || ids.some((id) => typeof id !== 'string')) throw new InputError('ids must be a list of shape ids');
      const unknown = ids.filter((id) => !st.shapes.some((s) => s.id === id));
      if (unknown.length > 0) throw new InputError(`No shape with id ${unknown.join(', ')}`);
      const next = input.add === true ? [...new Set([...st.selectedIds, ...ids])] : ids;
      st.setSelection(next);
      return {
        result: `Selected: ${JSON.stringify(next)}`,
        summary: next.length === 0 ? 'Cleared the selection' : `Selected ${plural(next.length, 'shape')}`,
      };
    }

    case 'select_all':
      st.selectAll();
      return { result: `Selected all ${st.shapes.length} shapes`, summary: 'Selected all shapes' };

    case 'move_selection': {
      needSelection();
      const dx = number(input, 'dx'), dy = number(input, 'dy');
      st.nudge(dx, dy);
      return { result: `Moved ${plural(st.selectedIds.length, 'shape')} by (${r(dx)}, ${r(dy)})`, summary: `Moved ${plural(st.selectedIds.length, 'shape')}` };
    }

    case 'scale_selection': {
      needSelection();
      const sel = selection();
      let kx = number(input, 'factor');
      let ky = number(input, 'factor_y', true) ?? kx;
      if (kx <= 0 || ky <= 0) throw new InputError('factors must be positive');
      // Squares and circles can't stretch, so (like a corner drag) a selection holding one keeps its
      // proportions. One turned shape stretches along its own axes.
      if (kx !== ky && mustScaleEvenly(sel)) ky = kx;
      const f = groupFrame(sel);
      kx = Math.max(kx, MIN_SIZE / (f.w || 1));
      ky = Math.max(ky, MIN_SIZE / (f.h || 1));
      st.checkpoint();
      st.updateShapes(scaleAbout(sel, f.cx, f.cy, kx, ky, f.angle));
      const by = kx === ky ? `${+kx.toFixed(2)}×` : `${+kx.toFixed(2)}× wide, ${+ky.toFixed(2)}× tall`;
      return { result: `Scaled ${plural(sel.length, 'shape')} by ${by}`, summary: `Scaled ${plural(sel.length, 'shape')} ${by}` };
    }

    case 'rotate_selection': {
      needSelection();
      const deg = number(input, 'degrees');
      const n = st.selectedIds.length;
      if (input.absolute === true) {
        st.setRotation(normAngle(deg));
        return { result: `Set ${plural(n, 'shape')} to ${Math.round(normAngle(deg))}°`, summary: `Rotated ${plural(n, 'shape')} to ${Math.round(normAngle(deg))}°` };
      }
      st.rotateSelection(deg);
      return { result: `Rotated ${plural(n, 'shape')} by ${Math.round(deg)}°`, summary: `Rotated ${plural(n, 'shape')} ${Math.round(deg)}°` };
    }

    case 'copy':
      needSelection();
      st.copy();
      return { result: `Copied ${plural(st.selectedIds.length, 'shape')}`, summary: `Copied ${plural(st.selectedIds.length, 'shape')}` };

    case 'cut':
      needSelection();
      st.cut();
      return { result: `Cut ${plural(st.selectedIds.length, 'shape')}`, summary: `Cut ${plural(st.selectedIds.length, 'shape')}` };

    case 'paste': {
      if (!st.clipboard) throw new InputError('The clipboard is empty. Copy or cut first.');
      const x = number(input, 'x', true), y = number(input, 'y', true);
      st.paste(x !== undefined && y !== undefined ? { x, y } : undefined);
      const ids = useStore.getState().selectedIds;
      return { result: `Pasted ${JSON.stringify(ids)}`, summary: `Pasted ${plural(ids.length, 'shape')}` };
    }

    case 'delete_selection': {
      needSelection();
      const n = st.selectedIds.length;
      st.deleteSelected();
      return { result: `Deleted ${plural(n, 'shape')}`, summary: `Deleted ${plural(n, 'shape')}` };
    }

    case 'set_color': {
      const target = oneOf(input, 'target', ['line', 'fill'] as const)!;
      if (target === 'line' && String(input.color).trim().toLowerCase() === 'none') throw new InputError('Lines always have a color');
      const value = color(input, 'color', { none: target === 'fill' })!;
      const n = st.selectedIds.length;
      if (target === 'line') st.setColor(value);
      else {
        if (n > 0 && !selection().some((s) => s.type !== 'freehand')) throw new InputError('Lines and freehand strokes have no fill');
        st.setFill(value);
      }
      const what = n === 0 ? `default ${target} color` : `${target} of ${plural(n, 'shape')}`;
      const label = colorName(value);
      return { result: `Set ${what} to ${label}`, summary: `Set ${what} to ${label}` };
    }

    case 'set_key_color': {
      const key = Math.round(number(input, 'key'));
      if (key < 1 || key > 5) throw new InputError('key must be 1-5');
      const value = color(input, 'color')!;
      st.setPaletteSlot(key - 1, value);
      return { result: `Key ${key} is now ${colorName(value)}`, summary: `Put ${colorName(value)} on key ${key}` };
    }

    case 'save_swatches': {
      const list = input.colors;
      if (!Array.isArray(list) || list.length === 0) throw new InputError('colors must be a non-empty list');
      const values = list.map((c) => color({ color: c }, 'color')!);
      for (const v of values) st.saveSwatch(v);
      return { result: `Saved ${plural(values.length, 'color')}: ${values.join(', ')}`, summary: `Saved ${plural(values.length, 'color')}` };
    }

    case 'arrange': {
      needSelection();
      const to = oneOf(input, 'to', ['front', 'back'] as const)!;
      if (to === 'front') st.bringToFront();
      else st.sendToBack();
      return { result: `Moved selection to the ${to}`, summary: to === 'front' ? 'Brought to front' : 'Sent to back' };
    }

    case 'undo_redo': {
      const action = oneOf(input, 'action', ['undo', 'redo'] as const)!;
      const times = Math.min(50, Math.max(1, Math.round(number(input, 'times', true) ?? 1)));
      let done = 0;
      for (; done < times; done++) {
        const { past, future } = useStore.getState();
        if ((action === 'undo' ? past : future).length === 0) break;
        if (action === 'undo') st.undo();
        else st.redo();
      }
      if (done === 0) throw new InputError(`Nothing to ${action}`);
      const label = action === 'undo' ? 'Undid' : 'Redid';
      return { result: `${label} ${plural(done, 'step')}`, summary: `${label} ${plural(done, 'step')}` };
    }

    case 'clear_all': {
      const n = st.shapes.length;
      st.clearAll();
      return { result: `Removed ${plural(n, 'shape')}`, summary: 'Cleared the canvas' };
    }

    case 'set_view': {
      const action = oneOf(input, 'action', ['fit', 'zoom_in', 'zoom_out', 'reset'] as const)!;
      ({ fit: fitToContent, zoom_in: zoomIn, zoom_out: zoomOut, reset: resetZoom })[action]();
      const labels = { fit: 'Fit all shapes on screen', zoom_in: 'Zoomed in', zoom_out: 'Zoomed out', reset: 'Zoomed to 100%' };
      return { result: labels[action], summary: labels[action] };
    }

    default:
      return { result: `Unknown tool ${name}`, isError: true };
  }
}
