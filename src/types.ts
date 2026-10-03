export type ShapeType = 'square' | 'rectangle' | 'circle' | 'ellipse' | 'triangle' | 'freehand';

export const SHAPE_TYPES: readonly ShapeType[] = [
  'square',
  'rectangle',
  'circle',
  'ellipse',
  'triangle',
  'freehand',
];

export type Pt = [number, number];

export interface BaseShape {
  id: string;
  type: ShapeType;
  x: number; // position (translate)
  y: number;
  scaleX: number;
  scaleY: number;
  rotation: number; // always 0; rotation is out of scope
  fill: string | null; // one of PALETTE, or null
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
}

export type Shape = RectLike | EllipseLike | Triangle | Freehand;

/** Fields every operation (move, scale, recolor) is allowed to change. */
export type TransformPatch = Partial<Pick<BaseShape, 'x' | 'y' | 'scaleX' | 'scaleY' | 'fill' | 'stroke'>>;

export const PALETTE = [
  { name: 'Ink', value: '#1f2933' },
  { name: 'Red', value: '#e5484d' },
  { name: 'Blue', value: '#3e63dd' },
  { name: 'Green', value: '#30a46c' },
  { name: 'Amber', value: '#f5a524' },
] as const;

export interface DocFile {
  version: 1;
  shapes: Shape[];
}
