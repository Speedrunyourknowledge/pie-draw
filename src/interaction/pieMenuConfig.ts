import { newDoc, openDoc, saveDoc } from '../file/fileOps';
import { canFill, makePrimitive } from '../geometry';
import { useStore } from '../store';
import { PALETTE, type Pt, type Shape } from '../types';

export interface CommandContext {
  origin: Pt; // where the menu was opened, in canvas coordinates
  shapeId: string | null;
  pulse: (id: string) => void;
}

export interface PieItem {
  id: string;
  label: string;
  icon: string; // key into PieMenu's icon set
  swatch?: { color: string | null; kind: 'line' | 'fill' }; // color entries draw a swatch instead of an icon
  run?: (ctx: CommandContext) => void;
  children?: PieItem[];
}

const st = () => useStore.getState();

const create =
  (type: 'square' | 'rectangle' | 'circle' | 'ellipse' | 'triangle') => (ctx: CommandContext) => {
    const shape = makePrimitive(type, ctx.origin[0], ctx.origin[1], st().currentColor, st().currentFill);
    st().addShape(shape, true);
    ctx.pulse(shape.id);
  };

/** Line color submenu: recolors the shape under the menu, or sets the color for new ones. */
const lineItem = (prefix: string): PieItem => ({
  id: prefix,
  label: 'Line',
  icon: 'line',
  children: PALETTE.map((c) => ({
    id: `${prefix}-${c.name}`,
    label: c.name,
    icon: 'swatch',
    swatch: { color: c.value, kind: 'line' },
    run: () => st().setColor(c.value),
  })),
});

/** Fill submenu: the same colors plus None. */
const fillItem = (prefix: string): PieItem => ({
  id: prefix,
  label: 'Fill',
  icon: 'fill',
  children: [
    ...PALETTE.map((c) => ({
      id: `${prefix}-${c.name}`,
      label: c.name,
      icon: 'swatch',
      swatch: { color: c.value, kind: 'fill' as const },
      run: () => st().setFill(c.value),
    })),
    {
      id: `${prefix}-none`,
      label: 'None',
      icon: 'swatch',
      swatch: { color: null, kind: 'fill' },
      run: () => st().setFill(null),
    },
  ],
});

/**
 * Fixed layouts so each command always lives in the same direction.
 * Item 0 points north; the rest go clockwise.
 */
export const CANVAS_MENU: PieItem[] = [
  { id: 'square', label: 'Square', icon: 'square', run: create('square') },
  { id: 'rectangle', label: 'Rectangle', icon: 'rectangle', run: create('rectangle') },
  { id: 'circle', label: 'Circle', icon: 'circle', run: create('circle') },
  { id: 'ellipse', label: 'Ellipse', icon: 'ellipse', run: create('ellipse') },
  { id: 'triangle', label: 'Triangle', icon: 'triangle', run: create('triangle') },
  // Line and Fill set the style of new shapes (nothing is selected on empty canvas).
  lineItem('draw-line'),
  fillItem('draw-fill'),
  {
    id: 'file',
    label: 'File',
    icon: 'file',
    children: [
      { id: 'new', label: 'New', icon: 'new', run: () => newDoc() },
      { id: 'open', label: 'Open…', icon: 'open', run: () => void openDoc() },
      { id: 'save', label: 'Save', icon: 'save', run: () => void saveDoc() },
      { id: 'saveas', label: 'Save As…', icon: 'saveas', run: () => void saveDoc(true) },
    ],
  },
];

export const SHAPE_MENU: PieItem[] = [
  lineItem('line'),
  { id: 'copy', label: 'Copy', icon: 'copy', run: () => st().copy() },
  { id: 'front', label: 'To Front', icon: 'front', run: () => st().bringToFront() },
  { id: 'delete', label: 'Delete', icon: 'delete', run: () => st().deleteSelected() },
  { id: 'back', label: 'To Back', icon: 'back', run: () => st().sendToBack() },
  { id: 'cut', label: 'Cut', icon: 'cut', run: () => st().cut() },
  fillItem('fill'),
];

/** Freehand lines have nothing to fill, so their menu drops Fill. */
export const LINE_MENU: PieItem[] = SHAPE_MENU.filter((item) => item.id !== 'fill');

export function menuFor(shape: Shape | null): PieItem[] {
  if (!shape) return CANVAS_MENU;
  return canFill(shape) ? SHAPE_MENU : LINE_MENU;
}
