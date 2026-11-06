import { DEFAULT_PALETTE, colorLabel } from '../colors';
import { canFill } from '../geometry';
import { useStore } from '../store';
import type { PrimitiveType, Pt, Shape } from '../types';

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

/** Arms the create tool: the pointer becomes a crosshair, and the next drag draws the shape. */
const create = (type: PrimitiveType) => () => st().setCreateTool(type);

/** Line color submenu: the colors on keys 1–5, applied to the selected shapes or to new ones. */
const lineItem = (prefix: string, palette: readonly string[]): PieItem => ({
  id: prefix,
  label: 'Line',
  icon: 'line',
  children: palette.map((color, i) => ({
    id: `${prefix}-${i + 1}`,
    label: colorLabel(color),
    icon: 'swatch',
    swatch: { color, kind: 'line' as const },
    run: () => st().setColor(color),
  })),
});

/** Fill submenu: the same colors plus None. */
const fillItem = (prefix: string, palette: readonly string[]): PieItem => ({
  id: prefix,
  label: 'Fill',
  icon: 'fill',
  children: [
    ...palette.map((color, i) => ({
      id: `${prefix}-${i + 1}`,
      label: colorLabel(color),
      icon: 'swatch',
      swatch: { color, kind: 'fill' as const },
      run: () => st().setFill(color),
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
export const canvasMenu = (palette: readonly string[]): PieItem[] => [
  { id: 'square', label: 'Square', icon: 'square', run: create('square') },
  { id: 'rectangle', label: 'Rectangle', icon: 'rectangle', run: create('rectangle') },
  { id: 'circle', label: 'Circle', icon: 'circle', run: create('circle') },
  { id: 'ellipse', label: 'Ellipse', icon: 'ellipse', run: create('ellipse') },
  { id: 'triangle', label: 'Triangle', icon: 'triangle', run: create('triangle') },
  // Line and Fill set the style of new shapes (nothing is selected on empty canvas).
  lineItem('draw-line', palette),
  fillItem('draw-fill', palette),
];

export const shapeMenu = (palette: readonly string[]): PieItem[] => [
  lineItem('line', palette),
  { id: 'copy', label: 'Copy', icon: 'copy', run: () => st().copy() },
  { id: 'front', label: 'To Front', icon: 'front', run: () => st().bringToFront() },
  { id: 'delete', label: 'Delete', icon: 'delete', run: () => st().deleteSelected() },
  { id: 'back', label: 'To Back', icon: 'back', run: () => st().sendToBack() },
  { id: 'cut', label: 'Cut', icon: 'cut', run: () => st().cut() },
  fillItem('fill', palette),
];

/**
 * The menu for the selected shapes; Fill appears when any of them can take one (freehand lines have
 * nothing to fill). The color submenus hold whatever colors are on keys 1–5.
 */
export function menuFor(selected: Shape[]): PieItem[] {
  const { palette } = st();
  if (selected.length === 0) return canvasMenu(palette);
  const items = shapeMenu(palette);
  return selected.some(canFill) ? items : items.filter((item) => item.id !== 'fill');
}

/**
 * The menu layouts shown as pictures. The help panel draws these live, and
 * `npm run docs:pies` renders the same ones to SVG files for the README, so they can't drift apart.
 */
export const MENU_PREVIEWS: { id: string; items: PieItem[]; caption: string }[] = [
  { id: 'canvas', items: canvasMenu(DEFAULT_PALETTE), caption: 'Nothing selected' },
  { id: 'shape', items: shapeMenu(DEFAULT_PALETTE), caption: 'Object selected' },
];
