export type ShapeType = 'square' | 'rectangle' | 'circle' | 'ellipse' | 'triangle' | 'freehand';

export const SHAPE_TYPES: readonly ShapeType[] = [
  'square',
  'rectangle',
  'circle',
  'ellipse',
  'triangle',
  'freehand',
];

/** The shapes that can be created from the menu and drawn by dragging. */
export type PrimitiveType = Exclude<ShapeType, 'freehand'>;

export type Pt = [number, number];

export interface BaseShape {
  id: string;
  type: ShapeType;
  x: number; // position (translate)
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number; // degrees, clockwise on screen, about (x, y)
  fill: string | null; // a #rrggbb color, or null
  stroke: string | null;
  strokeWidth: number;
}

// Geometry is in local coordinates, centered on (0,0).
export interface RectLike extends BaseShape {
  type: 'square' | 'rectangle';
  w: number;
  h: number;
}
export interface EllipseLike extends BaseShape {
  type: 'circle' | 'ellipse';
  rx: number;
  ry: number;
}
export interface Triangle extends BaseShape {
  type: 'triangle';
  points: Pt[]; // 3 points
}
export interface Freehand extends BaseShape {
  type: 'freehand';
  points: Pt[];
  /** A straight line (drawn with Shift, or by the assistant): exactly 2 points, with draggable, snapping ends. */
  straight?: boolean;
}

export type Shape = RectLike | EllipseLike | Triangle | Freehand;

/** Fields every operation (move, scale, rotate, recolor) is allowed to change. */
export type TransformPatch = Partial<Pick<BaseShape, 'x' | 'y' | 'scaleX' | 'scaleY' | 'rotation' | 'fill' | 'stroke'>>;

/** The default colors on keys 1–5. Each key can be given any other color (see colors.ts). */
export const PALETTE = [
  { name: 'Black', value: '#1f2933' },
  { name: 'Red', value: '#e5484d' },
  { name: 'Blue', value: '#3e63dd' },
  { name: 'Green', value: '#30a46c' },
  { name: 'Amber', value: '#f5a524' },
] as const;

export interface DocFile {
  version: 1;
  shapes: Shape[];
}
