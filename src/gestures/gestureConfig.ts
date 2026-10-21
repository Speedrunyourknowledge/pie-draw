/**
 * The gesture set: one row per recognizer class. To add a gesture, add a row here, then record
 * 5–10 samples of it in record mode (?record=1). Changing how a gesture is drawn only needs new
 * samples; changing what it does only needs a different `action`.
 */
import { PALETTE } from '../types';

/** What a recognized gesture does. Each maps onto an existing app action. */
export type GestureAction =
  // Shape families: the stroke's bounding box picks square vs rectangle, circle vs ellipse.
  | { kind: 'createShape'; family: 'rectangle' | 'circle' | 'triangle' }
  | { kind: 'lasso' }
  | { kind: 'copy' }
  | { kind: 'cut' }
  | { kind: 'paste' }
  // Where it's drawn picks the target: on empty canvas it sets the line color for new shapes;
  // started inside a shape it fills that shape (and makes the color the default fill).
  | { kind: 'setColor'; color: string };

export interface GestureDef {
  /** Recognizer class; samples in templates.json are stored under it. */
  label: string;
  /** How to draw it, shown in record mode and the help panel. */
  hint: string;
  action: GestureAction;
}

export const GESTURES: readonly GestureDef[] = [
  { label: 'rectangle', hint: 'Closed loop with 4 corners, clockwise, starting top-left', action: { kind: 'createShape', family: 'rectangle' } },
  { label: 'circle', hint: 'Round closed loop, clockwise, starting at the top', action: { kind: 'createShape', family: 'circle' } },
  { label: 'triangle', hint: 'Closed loop with 3 corners, clockwise, starting at the apex', action: { kind: 'createShape', family: 'triangle' } },
  { label: 'lasso', hint: 'Free-form closed loop, counterclockwise, from any start point', action: { kind: 'lasso' } },
  { label: 'copy', hint: 'Letter C', action: { kind: 'copy' } },
  { label: 'cut', hint: 'Single diagonal slash', action: { kind: 'cut' } },
  { label: 'paste', hint: 'Check mark', action: { kind: 'paste' } },
  // Digits match the keyboard shortcuts 1–5 for the same colors.
  { label: 'color_1', hint: 'Digit 1 with its flag: short diagonal up to the right, then straight down', action: { kind: 'setColor', color: PALETTE[0].value } },
  { label: 'color_2', hint: 'Digit 2', action: { kind: 'setColor', color: PALETTE[1].value } },
  { label: 'color_3', hint: 'Digit 3', action: { kind: 'setColor', color: PALETTE[2].value } },
  { label: 'color_4', hint: 'Digit 4 with the closed triangle: up the stem from the bottom, diagonal down-left, then across to the right', action: { kind: 'setColor', color: PALETTE[3].value } },
  { label: 'color_5', hint: 'Digit 5, starting with the top bar drawn right to left', action: { kind: 'setColor', color: PALETTE[4].value } },
];

export const gestureFor = (label: string) => GESTURES.find((g) => g.label === label);

/** Sections of the gesture reference, in display order, each with the rule its gestures share. */
export const GESTURE_SECTIONS = [
  { name: 'Shapes', note: 'A shape appears where and as big as you draw it. Drawn about as wide as tall, it becomes a square or circle.' },
  { name: 'Select and edit', note: 'Copy and cut act on the shapes selected with the lasso.' },
  { name: 'Colors', note: 'On empty canvas, sets the line color for new shapes. Started inside a shape, fills that shape.' },
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

/** What the gesture does, in words for the gesture reference. */
export function describeAction(action: GestureAction): string {
  switch (action.kind) {
    case 'createShape':
      return {
        rectangle: 'Rectangle or square',
        circle: 'Ellipse or circle',
        triangle: 'Triangle',
      }[action.family];
    case 'lasso':
      return 'Select the shapes inside the loop';
    case 'copy':
      return 'Copy the selection';
    case 'cut':
      return 'Cut the selection';
    case 'paste':
      return 'Paste where the check mark is drawn';
    case 'setColor':
      return PALETTE.find((c) => c.value === action.color)?.name ?? action.color;
  }
}
