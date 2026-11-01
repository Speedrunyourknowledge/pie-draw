/**
 * The gesture set: one row per recognizer class. To add a gesture, add a row here, then record
 * 10 samples of it in record mode (RECORD_MODE=true). Changing how a gesture is drawn only needs new
 * samples; changing what it does only needs a different `action`.
 */
import { DEFAULT_PALETTE, colorLabel } from '../colors';

/** What a recognized gesture does. Each maps onto an existing app action. */
export type GestureAction =
  // Shape families: the stroke's bounding box picks square vs rectangle, circle vs ellipse.
  | { kind: 'createShape'; family: 'rectangle' | 'circle' | 'triangle' }
  | { kind: 'lasso' }
  | { kind: 'copy' }
  // Started inside an unselected shape: clears that shape's fill (and makes no fill the default),
  // like the color gestures fill it. Anywhere else: cuts the selection.
  | { kind: 'cut' }
  | { kind: 'paste' }
  // Where it starts picks the target. Inside an unselected shape: fills that shape (and makes the
  // color the default fill). Elsewhere with a selection: sets the selection's line color. On empty
  // canvas with no selection: sets the line color for new shapes. (Inside a selection is a drag, so
  // filling selected shapes is left to the Fill swatch and the pie menu.) `slot` is the key 1–5
  // (0–4) whose color it applies, so it follows whatever color the user has put on that key.
  | { kind: 'setColor'; slot: number };

export interface GestureDef {
  /** Recognizer class; samples in templates.json are stored under it. */
  label: string;
  /** How to draw it, shown in record mode and the help panel. */
  hint: string;
  action: GestureAction;
  /**
   * Drawable in either direction: each recorded sample also counts reversed, so recording one
   * direction covers both. Only for gestures whose direction means nothing (circle vs lasso differ
   * only by direction, so they must not have it).
   */
  eitherDirection?: boolean;
  /**
   * A closed loop that can start anywhere: each recorded sample also counts started from points
   * spread around the loop, so recording one start point covers them all. Direction still matters.
   */
  anyStart?: boolean;
  /**
   * Drawable at any quarter turn: each recorded sample also counts rotated 90°, 180° and 270°, so
   * recording one orientation covers all four (a wide rectangle also covers a tall one). Rotating
   * keeps a loop's direction, so clockwise and counterclockwise gestures stay apart.
   */
  anyRotation?: boolean;
}

export const GESTURES: readonly GestureDef[] = [
  { label: 'rectangle', hint: 'Closed loop with 4 corners, clockwise', action: { kind: 'createShape', family: 'rectangle' }, anyStart: true, anyRotation: true },
  { label: 'circle', hint: 'Round closed loop, clockwise', action: { kind: 'createShape', family: 'circle' }, anyStart: true, anyRotation: true },
  { label: 'triangle', hint: 'Closed loop with 3 corners, clockwise', action: { kind: 'createShape', family: 'triangle' }, anyStart: true, anyRotation: true },
  { label: 'lasso', hint: 'Closed loop, counterclockwise; wobbles and slight dents are fine', action: { kind: 'lasso' }, anyStart: true, anyRotation: true },
  { label: 'copy', hint: 'Letter C', action: { kind: 'copy' } },
  { label: 'cut', hint: 'Forward slash, either direction. Started inside a shape, clears its fill', action: { kind: 'cut' }, eitherDirection: true },
  { label: 'paste', hint: 'Upside down caret, either direction', action: { kind: 'paste' }, eitherDirection: true },
  // Numbers match the keyboard shortcuts 1–5 for the same colors.
  { label: 'color_1', hint: 'Number 1', action: { kind: 'setColor', slot: 0 } },
  { label: 'color_2', hint: 'Number 2', action: { kind: 'setColor', slot: 1 } },
  { label: 'color_3', hint: 'Number 3', action: { kind: 'setColor', slot: 2 } },
  { label: 'color_4', hint: 'Number 4', action: { kind: 'setColor', slot: 3 } },
  { label: 'color_5', hint: 'Number 5', action: { kind: 'setColor', slot: 4 } },
];

export const gestureFor = (label: string) => GESTURES.find((g) => g.label === label);

/** Sections of the gesture reference, in display order, each with the rule its gestures share. */
export const GESTURE_SECTIONS = [
  { name: 'Shapes', note: 'Draw with roughly equal width and height for a square or circle.' },
  { name: 'Select and edit', note: 'Copy and cut act on shapes selected with the lasso. A slash started inside an unselected shape clears its fill instead of cutting.' },
  { name: 'Colors', note: 'Started inside a shape, fills that shape. Started on the canvas, sets the line color of the selected shapes, or with nothing selected, of new shapes.' },
] as const;
export type GestureSection = (typeof GESTURE_SECTIONS)[number]['name'];

export function sectionOf(action: GestureAction): GestureSection {
  switch (action.kind) {
    case 'createShape':
      return 'Shapes';
    case 'setColor':
      return 'Colors';
    default:
      return 'Select and edit';
  }
}

/** What the gesture does, in words for the gesture reference. Colors name what is on the key now. */
export function describeAction(action: GestureAction, palette: readonly string[] = DEFAULT_PALETTE): string {
  switch (action.kind) {
    case 'createShape':
      return {
        rectangle: 'Rectangle or Square',
        circle: 'Ellipse or Circle',
        triangle: 'Triangle',
      }[action.family];
    case 'lasso':
      return 'Select one or more shapes';
    case 'copy':
      return 'Copy the selection';
    case 'cut':
      return 'Cut the selection, or clear a fill';
    case 'paste':
      return 'Paste at a location';
    case 'setColor':
      return colorLabel(palette[action.slot]);
  }
}
