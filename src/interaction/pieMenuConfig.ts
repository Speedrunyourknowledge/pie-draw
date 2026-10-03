import { newDoc, openDoc, saveDoc } from '../file/fileOps';
import { makePrimitive } from '../geometry';
import { useStore } from '../store';
import { PALETTE, type Pt } from '../types';

export type MenuContext = 'canvas' | 'shape';

export interface CommandContext {
  origin: Pt; // where the menu was opened, in canvas coordinates
  shapeId: string | null;
  pulse: (id: string) => void;
}

export interface PieItem {
  id: string;
  label: string;
  icon: string; // key into PieMenu's icon set
  swatch?: string; // color submenu entries draw a swatch instead of an icon
  run?: (ctx: CommandContext) => void;
  children?: PieItem[];
}

const st = () => useStore.getState();

const create =
  (type: 'square' | 'rectangle' | 'circle' | 'ellipse' | 'triangle') => (ctx: CommandContext) => {
    const shape = makePrimitive(type, ctx.origin[0], ctx.origin[1], st().currentColor);
    st().addShape(shape, true);
    ctx.pulse(shape.id);
  };

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
  {
    // Sets the drawing color for new shapes and strokes (nothing is selected on empty canvas).
    id: 'draw-color',
    label: 'Color',
    icon: 'color',
    children: PALETTE.map((c) => ({
      id: `draw-color-${c.name}`,
      label: c.name,
      icon: 'swatch',
      swatch: c.value,
      run: () => st().setColor(c.value),
    })),
  },
  {
    id: 'paste',
    label: 'Paste',
    icon: 'paste',
    run: (ctx) => {
      st().paste({ x: ctx.origin[0], y: ctx.origin[1] });
      const id = st().selectedId;
      if (id) ctx.pulse(id);
    },
  },
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
  {
    id: 'color',
    label: 'Color',
    icon: 'color',
    children: PALETTE.map((c) => ({
      id: `color-${c.name}`,
      label: c.name,
      icon: 'swatch',
      swatch: c.value,
      run: () => st().setColor(c.value),
    })),
  },
  { id: 'copy', label: 'Copy', icon: 'copy', run: () => st().copy() },
  { id: 'front', label: 'To Front', icon: 'front', run: () => st().bringToFront() },
  { id: 'delete', label: 'Delete', icon: 'delete', run: () => st().deleteSelected() },
  { id: 'back', label: 'To Back', icon: 'back', run: () => st().sendToBack() },
  { id: 'cut', label: 'Cut', icon: 'cut', run: () => st().cut() },
];

export function menuFor(context: MenuContext): PieItem[] {
  return context === 'shape' ? SHAPE_MENU : CANVAS_MENU;
}
