import type { PieItem } from './pieMenuConfig';

// Radii (px from the menu center)
export const DEAD_ZONE = 20; // release inside cancels; no choice until the pointer leaves it
export const R_INNER = 26; // visual inner edge of the wedge ring
export const R_SUB = 104; // crossing this on a submenu wedge enters its outer ring
export const R_OUTER = 172; // visual outer edge of the submenu ring
export const CANCEL_RADIUS_NEAR = R_SUB + 16; // cancel edge just past the main ring, for plain wedges
export const CANCEL_RADIUS = R_OUTER + 12; // cancel edge past the submenu ring, for submenu wedges
export const SUB_SPAN = (38 * Math.PI) / 180; // angular width of one submenu wedge
export const GAP = (1.2 * Math.PI) / 180;

export interface PieSelection {
  index: number; // -1 = dead zone
  sub: number; // -1 = no submenu item
  locked: number | null; // submenu parent the pointer has entered
}

export const NO_SELECTION: PieSelection = { index: -1, sub: -1, locked: null };

/** Angle clockwise from north, in [0, 2π). */
function compass(dx: number, dy: number): number {
  const a = Math.atan2(dx, -dy);
  return a < 0 ? a + 2 * Math.PI : a;
}

function wrap(a: number): number {
  while (a > Math.PI) a -= 2 * Math.PI;
  while (a <= -Math.PI) a += 2 * Math.PI;
  return a;
}

export const itemAngle = (i: number, n: number) => (i * 2 * Math.PI) / n;
export const subAngle = (parent: number, j: number, m: number) => parent + (j - (m - 1) / 2) * SUB_SPAN;

/**
 * Where the cancel edge sits for a pointer heading in direction (dx, dy): just outside the
 * main ring, unless the pointer is in (or over) a submenu, whose outer ring must stay reachable.
 */
export function cancelRadius(items: PieItem[], dx: number, dy: number, locked: number | null): number {
  if (locked !== null) return CANCEL_RADIUS;
  if (Math.hypot(dx, dy) < DEAD_ZONE) return CANCEL_RADIUS_NEAR; // no direction yet
  const n = items.length;
  const index = Math.round(compass(dx, dy) / ((2 * Math.PI) / n)) % n;
  return items[index].children ? CANCEL_RADIUS : CANCEL_RADIUS_NEAR;
}

/**
 * Chooses a wedge from the pointer offset (dx, dy) relative to the menu center.
 * Between the dead zone and the menu's edge only the angle matters; a submenu wedge's
 * children live in the ring beyond R_SUB. Inside the dead zone or outside the menu
 * nothing is chosen, so releasing there cancels.
 */
export function pieSelect(items: PieItem[], dx: number, dy: number, prev: PieSelection): PieSelection {
  const r = Math.hypot(dx, dy);
  if (r < DEAD_ZONE || r > cancelRadius(items, dx, dy, prev.locked)) return NO_SELECTION;
  const n = items.length;
  const a = compass(dx, dy);
  const index = Math.round(a / ((2 * Math.PI) / n)) % n;
  if (r < R_SUB) return { index, sub: -1, locked: null };

  const locked = prev.locked ?? (items[index].children ? index : null);
  if (locked === null) return { index, sub: -1, locked: null };
  const m = items[locked].children!.length;
  const offset = wrap(a - itemAngle(locked, n));
  const sub = Math.min(m - 1, Math.max(0, Math.round(offset / SUB_SPAN + (m - 1) / 2)));
  return { index: locked, sub, locked };
}

/** The command a selection resolves to, or the submenu parent if no child is chosen yet. */
export function selectedItem(items: PieItem[], sel: PieSelection): PieItem | null {
  if (sel.index < 0) return null;
  const item = items[sel.index];
  return item.children && sel.sub >= 0 ? item.children[sel.sub] : item;
}
