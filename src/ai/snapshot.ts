import { smoothPath, worldBounds } from '../geometry';
import type { Pt, Shape } from '../types';

// Pictures of the canvas for the assistant: part of the canvas drawn to a PNG, with a faint coordinate
// grid and the pointer marked, so the model can match what it sees to coordinates. A picture costs
// about the same whether the canvas holds 5 shapes or 500, unlike a shape list.

export interface Picture {
  mediaType: 'image/png' | 'image/jpeg';
  /** Base64, without the data: prefix. */
  data: string;
}

/** A rectangle of the canvas, in canvas units. */
export interface Area {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

/** Longest side of a picture, in pixels. About 1,000 tokens for a typical screen shape. */
const MAX_SIDE = 1024;
const MIN_SIDE = 32;
const GRID_STEPS = [5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000];
/** At most this many grid lines across the longer side, so labels stay readable. */
const MAX_LINES = 14;

/** The grid spacing for an area: the finest round step that keeps the grid sparse. */
export function gridStep(area: Area): number {
  const span = Math.max(area.right - area.left, area.bottom - area.top);
  return GRID_STEPS.find((s) => span / s <= MAX_LINES) ?? GRID_STEPS.at(-1)!;
}

/** Pixel size of the picture of an area: the longer side is MAX_SIDE, proportions kept. */
export function pictureSize(area: Area): [number, number] {
  const w = area.right - area.left, h = area.bottom - area.top;
  const k = MAX_SIDE / Math.max(w, h);
  return [Math.max(MIN_SIDE, Math.round(w * k)), Math.max(MIN_SIDE, Math.round(h * k))];
}

const esc = (v: string) => v.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
const n = (v: number) => +v.toFixed(2);

/** One shape as SVG. `k` is pixels per canvas unit, so outlines keep their on-canvas width. */
function shapeSvg(s: Shape, k: number): string {
  const paint =
    `fill="${s.type === 'freehand' || !s.fill ? 'none' : esc(s.fill)}" stroke="${s.stroke ? esc(s.stroke) : 'none'}" ` +
    `stroke-width="${n(Math.max(1, s.strokeWidth * k))}" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"`;
  let body: string;
  switch (s.type) {
    case 'square':
    case 'rectangle':
      body = `<rect x="${n(-s.w / 2)}" y="${n(-s.h / 2)}" width="${n(s.w)}" height="${n(s.h)}" ${paint}/>`;
      break;
    case 'circle':
    case 'ellipse':
      body = `<ellipse rx="${n(s.rx)}" ry="${n(s.ry)}" ${paint}/>`;
      break;
    case 'triangle':
      body = `<polygon points="${s.points.map((p) => `${n(p[0])},${n(p[1])}`).join(' ')}" ${paint}/>`;
      break;
    case 'freehand':
      body = `<path d="${smoothPath(s.points)}" ${paint}/>`;
      break;
  }
  return `<g transform="translate(${n(s.x)} ${n(s.y)}) rotate(${n(s.rotation)}) scale(${n(s.scaleX)} ${n(s.scaleY)})">${body}</g>`;
}

const overlaps = (s: Shape, a: Area) => {
  const b = worldBounds(s);
  return b.maxX >= a.left && b.minX <= a.right && b.maxY >= a.top && b.minY <= a.bottom;
};

/** The picture as an SVG document, in canvas units, sized to its pixel size. */
export function pictureSvg(area: Area, shapes: Shape[], pointer: Pt | null): string {
  const [W, H] = pictureSize(area);
  const k = W / (area.right - area.left);
  const px = (v: number) => n(v / k); // a length in pixels, as canvas units
  const step = gridStep(area);

  const lines: string[] = [];
  const labels: string[] = [];
  const label = (x: number, y: number, text: string) =>
    labels.push(`<text x="${n(x)}" y="${n(y)}">${text}</text>`);
  for (let x = Math.ceil(area.left / step) * step; x <= area.right; x += step) {
    lines.push(`M${n(x)} ${n(area.top)}V${n(area.bottom)}`);
    label(x + px(3), area.top + px(12), String(x));
  }
  for (let y = Math.ceil(area.top / step) * step; y <= area.bottom; y += step) {
    lines.push(`M${n(area.left)} ${n(y)}H${n(area.right)}`);
    label(area.left + px(3), y - px(3), String(y));
  }

  // Drawn over the shapes, so the grid stays visible over a filled picture, but faint enough not to
  // change how it looks.
  const grid =
    `<path d="${lines.join('')}" fill="none" stroke="#1f2933" stroke-opacity="0.16" stroke-width="1" vector-effect="non-scaling-stroke"/>` +
    `<g font-family="system-ui, sans-serif" font-size="${px(11)}" fill="#3b4652" stroke="#fff" stroke-width="${px(3)}" stroke-linejoin="round" paint-order="stroke">${labels.join('')}</g>`;

  const marker = pointer
    ? `<g transform="translate(${n(pointer[0])} ${n(pointer[1])})" fill="none" stroke="#e5484d" stroke-width="2" vector-effect="non-scaling-stroke">` +
      `<circle r="${px(8)}" stroke="#fff" stroke-width="4"/><circle r="${px(8)}"/>` +
      `<path d="M0 ${px(-14)}V${px(-4)}M0 ${px(4)}V${px(14)}M${px(-14)} 0H${px(-4)}M${px(4)} 0H${px(14)}"/></g>`
    : '';

  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" ` +
    `viewBox="${n(area.left)} ${n(area.top)} ${n(area.right - area.left)} ${n(area.bottom - area.top)}">` +
    `<rect x="${n(area.left)}" y="${n(area.top)}" width="${n(area.right - area.left)}" height="${n(area.bottom - area.top)}" fill="#fff"/>` +
    shapes.filter((s) => overlaps(s, area)).map((s) => shapeSvg(s, k)).join('') +
    grid +
    marker +
    `</svg>`
  );
}

/** Draws part of the canvas to a PNG. Null if the browser can't (the model then gets the shape list). */
export async function renderPicture(area: Area, shapes: Shape[], pointer: Pt | null): Promise<Picture | null> {
  try {
    const [W, H] = pictureSize(area);
    const img = new Image();
    img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(pictureSvg(area, shapes, pointer))}`;
    await img.decode();
    const canvas = document.createElement('canvas');
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    if (!ctx) return null;
    ctx.drawImage(img, 0, 0, W, H);
    return { mediaType: 'image/png', data: canvas.toDataURL('image/png').split(',')[1] };
  } catch {
    return null;
  }
}

// ---- pictures the user attaches ----

/** The image formats both providers accept. Anything else is turned away before it reaches the model. */
export const IMAGE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/webp'];
const MAX_FILE_BYTES = 20 * 1024 * 1024;
/** Longest side of an attached picture: as much detail as the models use, without sending more. */
const ATTACH_SIDE = 1568;

/** A picture as a data: URL, for showing it in the chat. */
export const pictureUrl = (p: Picture) => `data:${p.mediaType};base64,${p.data}`;

/**
 * Reads a file the user attached. It must be a PNG, JPEG, GIF or WebP by its type, and the browser
 * must be able to decode it as one; anything else throws an error with a message for the user. The
 * image is redrawn as a JPEG (over white, scaled down if large), so whatever was in the file, what
 * the model gets is a plain image of a known size.
 */
export async function readImageFile(file: File): Promise<Picture> {
  if (!IMAGE_TYPES.includes(file.type)) throw new Error(`“${file.name}” isn’t an image. Attach a PNG, JPEG, GIF or WebP.`);
  if (file.size > MAX_FILE_BYTES) throw new Error(`“${file.name}” is too large (the limit is 20 MB).`);
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error(`“${file.name}” couldn’t be read as an image.`);
  }
  try {
    const k = Math.min(1, ATTACH_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round(bitmap.width * k));
    canvas.height = Math.max(1, Math.round(bitmap.height * k));
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('This browser can’t prepare images.');
    ctx.fillStyle = '#fff';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    return { mediaType: 'image/jpeg', data: canvas.toDataURL('image/jpeg', 0.9).split(',')[1] };
  } finally {
    bitmap.close();
  }
}
