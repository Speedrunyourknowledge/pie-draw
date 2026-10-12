import type { PrimitiveType } from '../types';

// The shape sits to the lower right of the crosshair, clear of the point being aimed at.
const ICONS: Record<PrimitiveType, string> = {
  square: "<rect x='17' y='17' width='11' height='11'/>",
  rectangle: "<rect x='15.5' y='18' width='14' height='9.5'/>",
  circle: "<circle cx='22.5' cy='22.5' r='6'/>",
  ellipse: "<ellipse cx='22.5' cy='22.5' rx='7.5' ry='5'/>",
  triangle: "<path d='M22.5 16.5 L29 27.5 H16 Z'/>",
};

const CROSS = 'M11 2.5 V8 M11 14 V19.5 M2.5 11 H8 M14 11 H19.5';

/** CSS cursor for the shape tool: a crosshair (hotspot at its center) with a small icon of the shape. */
export function shapeCursor(type: PrimitiveType): string {
  const svg =
    "<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32' fill='none' stroke-linecap='round' stroke-linejoin='round'>" +
    `<g stroke='white' stroke-width='3.6'><path d='${CROSS}'/>${ICONS[type]}</g>` +
    `<g stroke='#1f2933' stroke-width='1.6'><path d='${CROSS}'/><g fill='white'>${ICONS[type]}</g></g>` +
    '</svg>';
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}") 11 11, crosshair`;
}
