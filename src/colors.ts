import { PALETTE } from './types';

// Color helpers shared by the swatches, the custom color editor, the pie menu and the assistant.
// Colors are stored as lowercase #rrggbb strings; the five default palette colors keep their names.

/** The five colors the keys 1–5 (and the number gestures) start with. */
export const DEFAULT_PALETTE: readonly string[] = PALETTE.map((c) => c.value);

/** How many colors fit in the saved row of the swatch fan. */
export const MAX_SWATCHES = 6;

/** "#abc", "abc", "#AABBCC" or "aabbcc" as "#aabbcc"; anything else is null. */
export function normalizeHex(input: string): string | null {
  const s = input.trim().replace(/^#/, '').toLowerCase();
  if (/^[0-9a-f]{3}$/.test(s)) return '#' + [...s].map((c) => c + c).join('');
  if (/^[0-9a-f]{6}$/.test(s)) return '#' + s;
  return null;
}

/** A color in words: a default palette name ("Red"), its hex code, or "None". */
export function colorLabel(value: string | null): string {
  if (value === null) return 'None';
  return PALETTE.find((c) => c.value === value)?.name ?? value.toUpperCase();
}

export interface Hsv {
  h: number; // 0–360
  s: number; // 0–1
  v: number; // 0–1
}

export function hsvToHex({ h, s, v }: Hsv): string {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return v - v * s * Math.max(0, Math.min(k, 4 - k, 1));
  };
  return '#' + [f(5), f(3), f(1)].map((c) => Math.round(c * 255).toString(16).padStart(2, '0')).join('');
}

export function hexToHsv(hex: string): Hsv {
  const n = parseInt((normalizeHex(hex) ?? '#000000').slice(1), 16);
  const r = ((n >> 16) & 255) / 255, g = ((n >> 8) & 255) / 255, b = (n & 255) / 255;
  const max = Math.max(r, g, b), d = max - Math.min(r, g, b);
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  return { h: (h + 360) % 360, s: max === 0 ? 0 : d / max, v: max };
}

// ---- remembered between visits (this browser only, like the gestures setting) ----

const PALETTE_KEY = 'pie-draw:palette';
const SWATCHES_KEY = 'pie-draw:swatches';

function read(key: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(key) ?? 'null');
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage unavailable: the colors just won't survive a reload.
  }
}

const hexList = (v: unknown) => (Array.isArray(v) ? v.map((c) => (typeof c === 'string' ? normalizeHex(c) : null)) : []);

export function loadPalette(): string[] {
  const saved = hexList(read(PALETTE_KEY));
  return DEFAULT_PALETTE.map((c, i) => saved[i] ?? c);
}

export function loadSwatches(): string[] {
  return [...new Set(hexList(read(SWATCHES_KEY)).filter((c): c is string => c !== null))].slice(0, MAX_SWATCHES);
}

export const storePalette = (palette: string[]) => write(PALETTE_KEY, palette);
export const storeSwatches = (swatches: string[]) => write(SWATCHES_KEY, swatches);
