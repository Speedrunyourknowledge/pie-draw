import { MAX_SWATCHES, colorLabel, normalizeHex } from '../colors';
import { anchorsOf, canFill, dist, frameOf, isLine, groupFrame, worldBounds, makeFreehand, makePrimitive, makePrimitiveInBox, makeTriangle, mustScaleEvenly, normAngle, scaleAbout, toWorldFn } from '../geometry';
import { useStore } from '../store';
import { PALETTE, type PrimitiveType, type Pt, type Shape, type TransformPatch } from '../types';
import { fitToContent, resetZoom, toScreen, toWorld, zoomIn, zoomOut } from '../view';
import type { WithPicture } from './providers';
import { gridStep, renderPicture, type Area } from './snapshot';

// The assistant's tools. Each one is a thin wrapper over an action the app already has (the same
// store calls the pie menu, gestures and keyboard make), so the assistant can do nothing a user can't.

/** A tool in the JSON Schema form both provider APIs accept. */
export interface ToolSpec {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
}

export interface ToolOutcome {
  /** Sent back to the model. The chat doesn't show tool use: the user watches the canvas change. */
  result: string;
  isError?: boolean;
  /** A view of the canvas to send with the result, as a picture (or as text, for models that can't see). */
  view?: CanvasView;
}

const COLOR_NAMES = PALETTE.map((c) => c.name.toLowerCase());
const COLOR_HELP = `A hex color such as #ff8800 (any color), or one of the names ${COLOR_NAMES.join(', ')}.`;
const SHAPES: PrimitiveType[] = ['square', 'rectangle', 'circle', 'ellipse', 'triangle'];
const MIN_SIZE = 6; // same floor as scaling on the canvas
const MAX_SIZE = 5000;
// Small enough that one call is a few thousand output tokens, far below the reply's limit, and that
// a picture appears on the canvas piece by piece instead of all at the end.
const MAX_BATCH = 100;
/** create_shapes calls with at least this many shapes remind the model to check the drawing. */
const CHECK_REMINDER_MIN = 10;
/** Canvases with at most this many shapes have the full list sent with every view: cheap, and it saves a call. */
export const LIST_LIMIT = 50;
/**
 * The most shapes listed when no picture can be sent, so a huge drawing can't fill the model's
 * context (about 30-35 tokens a shape). Past it, the shapes on screen are kept, frontmost first.
 */
export const TEXT_LIST_MAX = 300;
const FIND_LIMIT = 100;
const FIND_MAX = 300;

const num = { type: 'number' };
/** Whole canvas units: a hint that keeps the model's coordinates short. Fractions are still accepted. */
const int = { type: 'integer' };
const areaParam = {
  type: 'object',
  properties: { left: int, top: int, right: int, bottom: int },
  required: ['left', 'top', 'right', 'bottom'],
};
const colorParam = (what: string) => ({ type: 'string', description: `${what} ${COLOR_HELP}` });
const idsParam = { type: 'array', items: { type: 'string' }, description: 'Act on these shapes instead of the selection. They become the selection.' };
/** Tools that act on the selection and also take ids, to skip a select_shapes call. */
const TAKES_IDS = new Set(['move_selection', 'scale_selection', 'rotate_selection', 'copy', 'cut', 'delete_selection', 'color_selection', 'arrange']);

export const TOOLS: ToolSpec[] = [
  {
    name: 'view_canvas',
    description: `Returns a fresh picture of the canvas with the same header as the <canvas> block in user messages. Use it to check your work partway through a task (draw a layer, look, fix what's off). With area, pictures only that part of the canvas, to look closely. With at most ${LIST_LIMIT} shapes, the full shape list comes too.`,
    parameters: {
      type: 'object',
      properties: { area: { ...areaParam, description: 'The part of the canvas to picture. Leave out for the visible area.' } },
    },
  },
  {
    name: 'find_shapes',
    description: `Returns exact geometry (ids, centers, sizes, corners, line ends, colors) of shapes matching every filter given, back to front. With no filters, lists every shape. Use it for exact positions before editing or connecting shapes; the picture is only roughly accurate. Returns at most limit shapes (default ${FIND_LIMIT}, at most ${FIND_MAX}).`,
    parameters: {
      type: 'object',
      properties: {
        ids: { type: 'array', items: { type: 'string' }, description: 'Only these shapes.' },
        area: { ...areaParam, description: 'Only shapes that reach into this area.' },
        types: { type: 'array', items: { type: 'string', enum: [...SHAPES, 'line', 'freehand'] }, description: 'Only shapes of these types.' },
        color: { type: 'string', description: `Only shapes with this line or fill color. ${COLOR_HELP}` },
        selected: { type: 'boolean', description: 'true for only the selected shapes.' },
        limit: { type: 'integer', minimum: 1, maximum: FIND_MAX },
      },
    },
  },
  {
    name: 'create_shapes',
    description: `Creates up to ${MAX_BATCH} shapes in one step (one undo step) and selects them. Use one call for a whole group or scene layer rather than one call per shape. Shapes are stacked in list order, later ones in front. If any item is invalid, nothing is created.`,
    parameters: {
      type: 'object',
      properties: {
        shapes: {
          type: 'array',
          maxItems: MAX_BATCH,
          items: {
            type: 'object',
            properties: {
              type: { type: 'string', enum: [...SHAPES, 'line'], description: 'Leave out to use the shared type. Items with points are triangles.' },
              x: { ...int, description: 'Center. Not for lines or triangles given by points.' },
              y: int,
              width: { ...int, description: 'Leave out width and height for the default size. Squares and circles use the larger of the two for both.' },
              height: int,
              rotation: { ...int, description: 'Degrees clockwise. Width and height are measured before turning.' },
              points: {
                type: 'array',
                items: { type: 'array', items: int, minItems: 2, maxItems: 2 },
                minItems: 3,
                maxItems: 3,
                description: 'Triangles only: the three corners as [x, y], making a triangle of any shape. Replaces x, y, width, height and rotation.',
              },
              x1: { ...int, description: 'Lines only: the two end points (x1, y1) and (x2, y2).' },
              y1: int,
              x2: int,
              y2: int,
              line_color: colorParam('Outline color (for a line, its color). For a shape with no visible outline, use its fill color.'),
              fill_color: colorParam('Fill color, or none.'),
            },
          },
        },
        type: { type: 'string', enum: [...SHAPES, 'line'], description: 'Shared type. An item\'s own type overrides it.' },
        line_color: colorParam('Shared outline color (for lines, their color). An item\'s own line_color overrides it.'),
        fill_color: colorParam('Shared fill color, or none. An item\'s own fill_color overrides it.'),
        outline_matches_fill: {
          type: 'boolean',
          description: 'true to give each filled shape an outline the color of its own fill, so it has no visible outline. Use instead of a shared line_color. An item\'s own line_color still overrides it.',
        },
      },
      required: ['shapes'],
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
    parameters: { type: 'object', properties: { dx: int, dy: int, ids: idsParam }, required: ['dx', 'dy'] },
  },
  {
    name: 'move_shapes',
    description: 'Moves each listed shape by its own (dx, dy), in one step (one undo step), and selects them. Use it to move several shapes by different amounts, such as when aligning them.',
    parameters: {
      type: 'object',
      properties: {
        moves: {
          type: 'array',
          maxItems: MAX_BATCH,
          items: { type: 'object', properties: { id: { type: 'string' }, dx: int, dy: int }, required: ['id', 'dx', 'dy'] },
        },
      },
      required: ['moves'],
    },
  },
  {
    name: 'scale_selection',
    description: 'Scales the selected shapes about the center of their joint bounding box; factor 2 doubles the size. factor_y, if given, sets the vertical factor separately (rotated shapes keep their angle and stretch along their own sides). A selection containing a square or circle always scales evenly.',
    parameters: { type: 'object', properties: { factor: num, factor_y: num, ids: idsParam }, required: ['factor'] },
  },
  {
    name: 'rotate_selection',
    description: 'Rotates the selected shapes clockwise by degrees (negative is counterclockwise), turning them together about the center of their joint box. With absolute true, sets each shape to that angle instead, each turning about its own center (0 stands it upright).',
    parameters: { type: 'object', properties: { degrees: int, absolute: { type: 'boolean' }, ids: idsParam }, required: ['degrees'] },
  },
  {
    name: 'copy',
    description: 'Copies the selected shapes to the clipboard.',
    parameters: { type: 'object', properties: { ids: idsParam } },
  },
  {
    name: 'cut',
    description: 'Copies the selected shapes to the clipboard and removes them.',
    parameters: { type: 'object', properties: { ids: idsParam } },
  },
  {
    name: 'paste',
    description: 'Pastes the clipboard and selects the pasted shapes. With x and y, the pasted group is centered there; otherwise it lands slightly offset from the last copy or paste.',
    parameters: { type: 'object', properties: { x: int, y: int } },
  },
  {
    name: 'delete_selection',
    description: 'Deletes the selected shapes.',
    parameters: { type: 'object', properties: { ids: idsParam } },
  },
  {
    name: 'color_selection',
    description: 'Gives every selected shape the same line or fill color. With nothing selected, sets the default for new shapes. To give shapes different colors, use color_shapes.',
    parameters: {
      type: 'object',
      properties: {
        target: { type: 'string', enum: ['line', 'fill'] },
        color: { type: 'string', description: `${COLOR_HELP} none is only valid for fill.` },
        ids: idsParam,
      },
      required: ['target', 'color'],
    },
  },
  {
    name: 'color_shapes',
    description: 'Gives each listed shape its own line and/or fill color, in one step (one undo step), and selects them. Use it to color several shapes differently, such as a gradient or palette across them; for one color on every shape, color_selection is enough.',
    parameters: {
      type: 'object',
      properties: {
        colors: {
          type: 'array',
          maxItems: MAX_BATCH,
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              line_color: colorParam('New outline color (for a line, its color).'),
              fill_color: colorParam('New fill color, or none. Not for lines or freehand strokes.'),
            },
            required: ['id'],
          },
        },
        outline_matches_fill: {
          type: 'boolean',
          description: 'true to also set the outline of each shape given a fill_color to that fill color, so it has no visible outline. An item\'s own line_color still overrides it.',
        },
      },
      required: ['colors'],
    },
  },
  {
    name: 'set_key_colors',
    description: "Puts colors on the user's color keys 1-5 (their quick palette: keys, number gestures, swatch fan and menu all use it), all in one call. A color is only ever on one key: if a new color is already on a key not being set, that key takes the replaced color instead. Only when the user asks to change their palette or keys.",
    parameters: {
      type: 'object',
      properties: {
        keys: {
          type: 'array',
          minItems: 1,
          maxItems: 5,
          items: {
            type: 'object',
            properties: { key: { type: 'integer', minimum: 1, maximum: 5 }, color: { type: 'string', description: COLOR_HELP } },
            required: ['key', 'color'],
          },
        },
      },
      required: ['keys'],
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
    parameters: { type: 'object', properties: { to: { type: 'string', enum: ['front', 'back'] }, ids: idsParam }, required: ['to'] },
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

// ---- short ids for the model ----
// Shape ids are UUIDs; the model sees short aliases (s1, s2, ...) instead, which cost far fewer tokens
// in a canvas of hundreds of shapes. An alias stays with its shape for the session (through undo too).

const aliasById = new Map<string, string>();
const idByAlias = new Map<string, string>();
let nextAlias = 1;

function alias(id: string): string {
  let a = aliasById.get(id);
  if (!a) {
    a = `s${nextAlias++}`;
    aliasById.set(id, a);
    idByAlias.set(a, id);
  }
  return a;
}

/** Aliases as compactly as possible: consecutive runs as ranges ("s4-s9, s12"). */
function aliasList(ids: string[]): string {
  const nums = ids.map((id) => Number(alias(id).slice(1)));
  const parts: string[] = [];
  for (let i = 0; i < nums.length; ) {
    let j = i;
    while (j + 1 < nums.length && nums[j + 1] === nums[j] + 1) j++;
    parts.push(j > i ? `s${nums[i]}-s${nums[j]}` : `s${nums[i]}`);
    i = j + 1;
  }
  return parts.join(', ');
}

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

/** One shape as the model sees it. */
function describe(s: Shape) {
  // A straight line is given by its end points, which say more than a box.
  if (isLine(s)) {
    const [[x1, y1], [x2, y2]] = s.points.map(toWorldFn(s));
    return { id: alias(s.id), type: 'line', x1: r(x1), y1: r(y1), x2: r(x2), y2: r(y2), line: colorName(s.stroke) };
  }
  // Size is the shape's own width and height, before any rotation.
  const f = frameOf(s);
  return {
    id: alias(s.id),
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
}

/** The part of the canvas the user can see (not under the top bar or the chat panel), in canvas units. */
function visibleArea(visibleLeft: number): Area {
  const { view } = useStore.getState();
  const top = 48; // the top bar
  const [left, t] = toWorld([visibleLeft, top], view);
  const [right, bottom] = toWorld([window.innerWidth, window.innerHeight], view);
  return { left, top: t, right, bottom };
}

const rounded = (a: Area) => ({ left: r(a.left), top: r(a.top), right: r(a.right), bottom: r(a.bottom) });
/** How many selected shapes the header describes in full when the shape list is left out. */
const SELECTED_DETAIL = 20;

/** The canvas at one moment, as the model will get it: header text, and what to picture. */
export interface CanvasView {
  /** The header (with the full shape list on small canvases), sent alongside the picture. */
  text: string;
  /** The header and the full shape list, for when no picture can be sent. Same as text on small canvases. */
  textOnly: string;
  area: Area;
  shapes: Shape[];
  pointer: Pt | null;
}

/**
 * The canvas as the model sees it: a compact JSON header (the visible area, the pointer and the
 * shape under it, the selection, the colors) to go with a picture of `area` (the visible area by
 * default). Small canvases also list every shape.
 */
export function canvasView({ pointer, visibleLeft }: Pointing, area?: Area): CanvasView {
  const st = useStore.getState();
  const visible = visibleArea(visibleLeft);
  const pictured = area ?? visible;
  const under = pointer && shapeAt(pointer);
  const underShape = under ? st.shapes.find((s) => s.id === under) : undefined;
  const selected = st.shapes.filter((s) => st.selectedIds.includes(s.id));
  const header = {
    visible_area: rounded(visible),
    ...(area ? { picture_area: rounded(area) } : {}),
    grid_step: gridStep(pictured),
    pointer: pointer ? { x: r(pointer[0]), y: r(pointer[1]), over_shape: underShape ? describe(underShape) : null } : null,
    selected: aliasList(st.selectedIds),
    clipboard: st.clipboard ? st.clipboard.length : 0,
    default_colors: { line: colorName(st.currentColor), fill: colorName(st.currentFill) },
    color_keys: st.palette.map(colorName),
    saved_swatches: st.swatches,
    shape_count: st.shapes.length,
  };
  const full = JSON.stringify({ ...header, ...textList(st.shapes, visible) });
  const text =
    st.shapes.length <= LIST_LIMIT
      ? full
      : JSON.stringify({
          ...header,
          ...(selected.length > 0 && selected.length <= SELECTED_DETAIL ? { selected_shapes: selected.map(describe) } : {}),
          shapes_back_to_front: `not listed (${st.shapes.length} shapes); call find_shapes for exact geometry`,
        });
  return { text, textOnly: full, area: pictured, shapes: st.shapes, pointer };
}

/**
 * A view and the text around it, ready to send: the picture is drawn only when `vision` is on, and
 * the text-only form stands in when it isn't (or the picture failed).
 */
export async function withPicture(view: CanvasView, wrap: (canvas: string) => string, vision: boolean): Promise<WithPicture> {
  const image = vision ? await renderPicture(view.area, view.shapes, view.pointer) : null;
  return {
    content: wrap(view.text),
    ...(image ? { image } : {}),
    ...(view.textOnly !== view.text || !image ? { textOnly: wrap(view.textOnly) } : {}),
  };
}

/** The shape list for text-only views: every shape, or past TEXT_LIST_MAX, the frontmost ones on screen. */
function textList(shapes: Shape[], visible: Area) {
  if (shapes.length <= TEXT_LIST_MAX) return { shapes_back_to_front: shapes.map(describe) };
  const onScreen = shapes.filter((s) => {
    const b = worldBounds(s);
    return b.maxX >= visible.left && b.minX <= visible.right && b.maxY >= visible.top && b.minY <= visible.bottom;
  });
  const listed = onScreen.slice(-TEXT_LIST_MAX);
  return {
    shapes_back_to_front: listed.map(describe),
    shapes_not_listed: `${shapes.length - listed.length} (only the frontmost ${listed.length} on screen are listed); call find_shapes for others`,
  };
}

/** A rectangle argument, with its sides in order and not too small to see. */
function area(input: Record<string, unknown>, key: string): Area | undefined {
  const v = input[key];
  if (v === undefined || v === null) return undefined;
  if (typeof v !== 'object') throw new InputError(`${key} must be an object with left, top, right and bottom`);
  const o = v as Record<string, unknown>;
  const left = number(o, 'left'), top = number(o, 'top'), right = number(o, 'right'), bottom = number(o, 'bottom');
  if (right - left < MIN_SIZE || bottom - top < MIN_SIZE) throw new InputError(`${key} must have right > left and bottom > top`);
  return { left, top, right, bottom };
}

function findShapes(input: Record<string, unknown>): string {
  const st = useStore.getState();
  let found = st.shapes;
  if (input.ids !== undefined) {
    if (!Array.isArray(input.ids)) throw new InputError('ids must be a list of shape ids');
    const ids = new Set((input.ids as unknown[]).map((a) => idByAlias.get(String(a).trim()) ?? String(a)));
    found = found.filter((s) => ids.has(s.id));
  }
  const where = area(input, 'area');
  if (where) {
    found = found.filter((s) => {
      const b = worldBounds(s);
      return b.maxX >= where.left && b.minX <= where.right && b.maxY >= where.top && b.minY <= where.bottom;
    });
  }
  if (input.types !== undefined) {
    if (!Array.isArray(input.types)) throw new InputError('types must be a list');
    const types = new Set(input.types as string[]);
    found = found.filter((s) => types.has(isLine(s) ? 'line' : s.type));
  }
  if (input.color !== undefined && input.color !== null) {
    const c = color(input, 'color', { none: true });
    found = found.filter((s) => s.stroke === c || (s.type !== 'freehand' && s.fill === c));
  }
  if (input.selected === true) found = found.filter((s) => st.selectedIds.includes(s.id));
  const limit = Math.min(FIND_MAX, Math.max(1, Math.round(number(input, 'limit', true) ?? FIND_LIMIT)));
  const shown = found.slice(0, limit);
  return JSON.stringify({
    matches: found.length,
    ...(found.length > shown.length ? { note: `showing the first ${shown.length}; narrow the filters or raise limit for the rest` } : {}),
    shapes_back_to_front: shown.map(describe),
  });
}

// ---- running a tool ----

class InputError extends Error {}

/** Shape ids (or their aliases) given by the model, as real ids. Every one must exist. */
function shapeIds(given: unknown): string[] {
  if (!Array.isArray(given) || given.some((id) => typeof id !== 'string')) throw new InputError('ids must be a list of shape ids');
  const { shapes } = useStore.getState();
  const ids = (given as string[]).map((a) => idByAlias.get(a.trim()) ?? a);
  const unknown = (given as string[]).filter((_, i) => !shapes.some((s) => s.id === ids[i]));
  if (unknown.length > 0) throw new InputError(`No shape with id ${unknown.join(', ')}`);
  return ids;
}

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

/** Colors that items of a create_shapes call fall back on. */
interface Defaults {
  line: string;
  fill: string | null;
  /** Filled shapes with no line_color of their own get an outline the color of their fill. */
  matchFill: boolean;
  type: unknown;
}

/** One create_shapes item as a shape, or an InputError saying what is wrong with it. */
function buildShape(item: Record<string, unknown>, defaults: Defaults): Shape {
  const own = item.type ?? (item.points !== undefined ? 'triangle' : defaults.type);
  if (own === undefined) throw new InputError('type is required (or set a shared type)');
  const type = oneOf({ type: own }, 'type', [...SHAPES, 'line'] as const)!;
  const lineValue = color(item, 'line_color', { optional: true }) ?? defaults.line;
  const sizeOk = (w: number, h: number) => {
    if (Math.max(w, h) > MAX_SIZE) throw new InputError(`${type} can be at most ${MAX_SIZE} units across`);
  };

  if (type === 'line') {
    const a: Pt = [number(item, 'x1'), number(item, 'y1')];
    const b: Pt = [number(item, 'x2'), number(item, 'y2')];
    if (dist(a, b) < MIN_SIZE) throw new InputError(`a line must be at least ${MIN_SIZE} units long`);
    sizeOk(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]));
    return makeFreehand([a, b], lineValue, true);
  }

  const fill = color(item, 'fill_color', { optional: true, none: true });
  const fillValue = fill === undefined ? defaults.fill : fill;
  const outline = color(item, 'line_color', { optional: true }) ?? (defaults.matchFill && fillValue ? fillValue : defaults.line);
  let shape: Shape;

  if (item.points !== undefined) {
    if (type !== 'triangle') throw new InputError('points is only for triangles');
    const pts = item.points;
    if (!Array.isArray(pts) || pts.length !== 3 || pts.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((v) => typeof v !== 'number' || !Number.isFinite(v))))
      throw new InputError('points must be three [x, y] pairs');
    const [a, b, c] = pts as [Pt, Pt, Pt];
    const area = Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1])) / 2;
    if (area < MIN_SIZE * MIN_SIZE / 2) throw new InputError('the triangle is too small or its corners are in a line');
    const xs = [a[0], b[0], c[0]], ys = [a[1], b[1], c[1]];
    sizeOk(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
    shape = makeTriangle([a, b, c], outline, fillValue);
  } else {
    const x = number(item, 'x'), y = number(item, 'y');
    const w = number(item, 'width', true), h = number(item, 'height', true);
    if (w === undefined && h === undefined) shape = makePrimitive(type, x, y, outline, fillValue);
    else {
      // Same as dragging out a box with the create tool: a missing side matches the given one.
      const clamp = (v: number) => Math.min(MAX_SIZE, Math.max(MIN_SIZE, v));
      const bw = clamp(w ?? h!), bh = clamp(h ?? w!);
      shape = makePrimitiveInBox(type, [x - bw / 2, y - bh / 2], [x + bw / 2, y + bh / 2], outline, fillValue);
    }
    shape.rotation = normAngle(number(item, 'rotation', true) ?? 0); // centered on (x, y), so it turns in place
  }
  return shape;
}

/**
 * The assistant's own selection. Its tools act on "the selection" like the app's actions do, but the
 * user should only ever see what they selected themselves, so each tool runs with this swapped into
 * the store and the user's selection put back before anything renders (all synchronously).
 */
let workingSelection: string[] = [];

/** Starts a reply's working selection from what the user has selected, so "this" works without reselecting. */
export function beginToolRun() {
  workingSelection = useStore.getState().selectedIds;
}

/**
 * Runs a tool. The change itself happens at once; only drawing a requested picture waits, and by
 * then the canvas it shows has been captured. `vision` is whether a picture is wanted at all.
 */
export async function runTool(name: string, input: Record<string, unknown>, pointing: Pointing, vision: boolean): Promise<WithPicture & { isError: boolean }> {
  const out = runNow(name, input, pointing);
  if (!out.view) return { content: out.result, isError: !!out.isError };
  return { ...(await withPicture(out.view, (canvas) => canvas, vision)), isError: false };
}

function runNow(name: string, input: Record<string, unknown>, pointing: Pointing): ToolOutcome {
  const userSelection = useStore.getState().selectedIds;
  const alive = (ids: string[]) => {
    const { shapes } = useStore.getState();
    return ids.filter((id) => shapes.some((s) => s.id === id));
  };
  useStore.setState({ selectedIds: alive(workingSelection) });
  try {
    return run(name, input, pointing);
  } catch (e) {
    if (e instanceof InputError) return { result: e.message, isError: true };
    throw e;
  } finally {
    workingSelection = useStore.getState().selectedIds;
    useStore.setState({ selectedIds: alive(userSelection) });
  }
}

function run(name: string, input: Record<string, unknown>, pointing: Pointing): ToolOutcome {
  if (TAKES_IDS.has(name) && input.ids !== undefined) {
    const ids = shapeIds(input.ids);
    if (ids.length === 0) throw new InputError('ids must not be empty; leave it out to use the selection');
    useStore.getState().setSelection(ids);
  }
  const st = useStore.getState();
  const selection = () => st.shapes.filter((s) => st.selectedIds.includes(s.id));

  switch (name) {
    case 'view_canvas': {
      const view = canvasView(pointing, area(input, 'area'));
      return { result: view.text, view };
    }

    case 'find_shapes':
      return { result: findShapes(input) };

    case 'create_shapes': {
      const items = input.shapes;
      if (!Array.isArray(items) || items.length === 0) throw new InputError('shapes must be a non-empty list');
      if (items.length > MAX_BATCH) throw new InputError(`At most ${MAX_BATCH} shapes per call; split the rest into more calls`);
      if (input.outline_matches_fill === true && input.line_color !== undefined) {
        throw new InputError('Set either line_color or outline_matches_fill for the call, not both. Nothing was created.');
      }
      const fill = color(input, 'fill_color', { optional: true, none: true });
      const defaults: Defaults = {
        line: color(input, 'line_color', { optional: true }) ?? st.currentColor,
        fill: fill === undefined ? st.currentFill : fill,
        matchFill: input.outline_matches_fill === true,
        type: input.type,
      };
      const shapes = items.map((item, i) => {
        if (typeof item !== 'object' || item === null) throw new InputError(`shapes[${i}] must be an object`);
        try {
          return buildShape(item as Record<string, unknown>, defaults);
        } catch (e) {
          if (e instanceof InputError) throw new InputError(`shapes[${i}]: ${e.message}. Nothing was created.`);
          throw e;
        }
      });
      st.addShapes(shapes);
      // A big batch is part of a picture: a reminder here, where the model reads it, gets the check done
      // far more reliably than the system prompt alone.
      const check = shapes.length >= CHECK_REMINDER_MIN ? ' Before your final reply, look at the drawing with view_canvas.' : '';
      return { result: `Created ${plural(shapes.length, 'shape')}: ${aliasList(shapes.map((s) => s.id))}.${check}` };
    }

    case 'select_shapes': {
      const ids = shapeIds(input.ids);
      const next = input.add === true ? [...new Set([...st.selectedIds, ...ids])] : ids;
      st.setSelection(next);
      return { result: next.length === 0 ? 'Cleared the selection' : `Selected ${aliasList(next)}` };
    }

    case 'select_all':
      st.selectAll();
      return { result: `Selected all ${st.shapes.length} shapes` };

    case 'move_selection': {
      needSelection();
      const dx = number(input, 'dx'), dy = number(input, 'dy');
      st.nudge(dx, dy);
      return { result: `Moved ${plural(st.selectedIds.length, 'shape')} by (${r(dx)}, ${r(dy)})` };
    }

    case 'move_shapes': {
      const moves = input.moves;
      if (!Array.isArray(moves) || moves.length === 0) throw new InputError('moves must be a non-empty list');
      if (moves.length > MAX_BATCH) throw new InputError(`At most ${MAX_BATCH} moves per call; split the rest into more calls`);
      const delta = new Map<string, Pt>();
      moves.forEach((m, i) => {
        if (typeof m !== 'object' || m === null) throw new InputError(`moves[${i}] must be an object`);
        const item = m as Record<string, unknown>;
        try {
          const [id] = shapeIds([item.id]);
          if (delta.has(id)) throw new InputError(`${String(item.id)} is listed twice`);
          delta.set(id, [number(item, 'dx'), number(item, 'dy')]);
        } catch (e) {
          if (e instanceof InputError) throw new InputError(`moves[${i}]: ${e.message}. Nothing was moved.`);
          throw e;
        }
      });
      st.checkpoint();
      st.updateShapes(new Map(st.shapes.filter((s) => delta.has(s.id)).map((s) => {
        const [dx, dy] = delta.get(s.id)!;
        return [s.id, { x: s.x + dx, y: s.y + dy }];
      })));
      st.setSelection([...delta.keys()]);
      return { result: `Moved ${plural(delta.size, 'shape')}` };
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
      return { result: `Scaled ${plural(sel.length, 'shape')} by ${by}` };
    }

    case 'rotate_selection': {
      needSelection();
      const deg = number(input, 'degrees');
      const n = st.selectedIds.length;
      if (input.absolute === true) {
        st.setRotation(normAngle(deg));
        return { result: `Set ${plural(n, 'shape')} to ${Math.round(normAngle(deg))}°` };
      }
      st.rotateSelection(deg);
      return { result: `Rotated ${plural(n, 'shape')} by ${Math.round(deg)}°` };
    }

    case 'copy':
      needSelection();
      st.copy();
      return { result: `Copied ${plural(st.selectedIds.length, 'shape')}` };

    case 'cut':
      needSelection();
      st.cut();
      return { result: `Cut ${plural(st.selectedIds.length, 'shape')}` };

    case 'paste': {
      if (!st.clipboard) throw new InputError('The clipboard is empty. Copy or cut first.');
      const x = number(input, 'x', true), y = number(input, 'y', true);
      st.paste(x !== undefined && y !== undefined ? { x, y } : undefined);
      const ids = useStore.getState().selectedIds;
      return { result: `Pasted ${aliasList(ids)}` };
    }

    case 'delete_selection': {
      needSelection();
      const n = st.selectedIds.length;
      st.deleteSelected();
      return { result: `Deleted ${plural(n, 'shape')}` };
    }

    case 'color_selection': {
      const target = oneOf(input, 'target', ['line', 'fill'] as const)!;
      if (target === 'line' && String(input.color).trim().toLowerCase() === 'none') throw new InputError('Lines always have a color; for no visible outline, use the fill color');
      const value = color(input, 'color', { none: target === 'fill' })!;
      const n = st.selectedIds.length;
      if (target === 'line') st.setColor(value);
      else {
        if (n > 0 && !selection().some((s) => s.type !== 'freehand')) throw new InputError('Lines and freehand strokes have no fill');
        st.setFill(value);
      }
      const what = n === 0 ? `default ${target} color` : `${target} of ${plural(n, 'shape')}`;
      return { result: `Set ${what} to ${colorName(value)}` };
    }

    case 'color_shapes': {
      const items = input.colors;
      if (!Array.isArray(items) || items.length === 0) throw new InputError('colors must be a non-empty list');
      if (items.length > MAX_BATCH) throw new InputError(`At most ${MAX_BATCH} items per call; split the rest into more calls`);
      const matchFill = input.outline_matches_fill === true;
      const patches = new Map<string, TransformPatch>();
      items.forEach((it, i) => {
        if (typeof it !== 'object' || it === null) throw new InputError(`colors[${i}] must be an object`);
        const item = it as Record<string, unknown>;
        try {
          const [id] = shapeIds([item.id]);
          if (patches.has(id)) throw new InputError(`${String(item.id)} is listed twice`);
          if (String(item.line_color).trim().toLowerCase() === 'none') throw new InputError('Lines always have a color; for no visible outline, use the fill color');
          const line = color(item, 'line_color', { optional: true });
          const fill = color(item, 'fill_color', { optional: true, none: true });
          if (line === undefined && fill === undefined) throw new InputError('give line_color, fill_color or both');
          const patch: TransformPatch = {};
          if (fill !== undefined) {
            if (!canFill(st.shapes.find((s) => s.id === id)!)) throw new InputError(`${String(item.id)} has no fill`);
            patch.fill = fill;
          }
          const outline = line ?? (matchFill && fill ? fill : undefined);
          if (outline) patch.stroke = outline;
          patches.set(id, patch);
        } catch (e) {
          if (e instanceof InputError) throw new InputError(`colors[${i}]: ${e.message}. Nothing was recolored.`);
          throw e;
        }
      });
      st.checkpoint();
      st.updateShapes(patches);
      st.setSelection([...patches.keys()]);
      return { result: `Recolored ${plural(patches.size, 'shape')}` };
    }

    case 'set_key_colors': {
      const items = input.keys;
      if (!Array.isArray(items) || items.length === 0) throw new InputError('keys must be a non-empty list');
      if (items.length > 5) throw new InputError('There are only 5 keys');
      const assigned = new Map<number, string>();
      items.forEach((it, i) => {
        if (typeof it !== 'object' || it === null) throw new InputError(`keys[${i}] must be an object`);
        const item = it as Record<string, unknown>;
        try {
          const key = Math.round(number(item, 'key'));
          if (key < 1 || key > 5) throw new InputError('key must be 1-5');
          if (assigned.has(key)) throw new InputError(`key ${key} is listed twice`);
          const value = color(item, 'color')!;
          if ([...assigned.values()].some((c) => c.toLowerCase() === value.toLowerCase())) throw new InputError(`${colorName(value)} is listed twice; a color can only be on one key`);
          assigned.set(key, value);
        } catch (e) {
          if (e instanceof InputError) throw new InputError(`keys[${i}]: ${e.message}. No keys were changed.`);
          throw e;
        }
      });
      // The colors are distinct, so a swap never disturbs a key set earlier in this call.
      const swapped: string[] = [];
      for (const [key, value] of assigned) {
        const other = st.setPaletteSlot(key - 1, value);
        if (other !== null && !assigned.has(other + 1)) swapped.push(`${colorName(value)} was on key ${other + 1}, so that key now has the color key ${key} had`);
      }
      const keys = useStore.getState().palette.map((c, i) => `${i + 1} ${colorName(c)}`).join(', ');
      return { result: `Keys are now ${keys}.${swapped.length ? ` ${swapped.join('; ')}.` : ''}` };
    }

    case 'save_swatches': {
      const list = input.colors;
      if (!Array.isArray(list) || list.length === 0) throw new InputError('colors must be a non-empty list');
      const values = list.map((c) => color({ color: c }, 'color')!);
      for (const v of values) st.saveSwatch(v);
      return { result: `Saved ${plural(values.length, 'color')}: ${values.join(', ')}` };
    }

    case 'arrange': {
      needSelection();
      const to = oneOf(input, 'to', ['front', 'back'] as const)!;
      if (to === 'front') st.bringToFront();
      else st.sendToBack();
      return { result: `Moved selection to the ${to}` };
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
      return { result: `${label} ${plural(done, 'step')}` };
    }

    case 'clear_all': {
      const n = st.shapes.length;
      st.clearAll();
      return { result: `Removed ${plural(n, 'shape')}` };
    }

    case 'set_view': {
      const action = oneOf(input, 'action', ['fit', 'zoom_in', 'zoom_out', 'reset'] as const)!;
      ({ fit: fitToContent, zoom_in: zoomIn, zoom_out: zoomOut, reset: resetZoom })[action]();
      const labels = { fit: 'Fit all shapes on screen', zoom_in: 'Zoomed in', zoom_out: 'Zoomed out', reset: 'Zoomed to 100%' };
      return { result: labels[action] };
    }

    default:
      return { result: `Unknown tool ${name}`, isError: true };
  }
}
