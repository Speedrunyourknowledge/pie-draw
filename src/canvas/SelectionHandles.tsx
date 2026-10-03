import { worldBounds } from '../geometry';
import type { View } from '../store';
import type { Shape } from '../types';

export type Corner = 'nw' | 'ne' | 'sw' | 'se';

const SIZE = 10;
export const SELECTION_PAD = 4;

/** Drawn in screen space so handles stay the same size at any zoom. */
export function SelectionHandles({ shape, view }: { shape: Shape; view: View }) {
  const b = worldBounds(shape);
  const x0 = b.minX * view.zoom + view.x - SELECTION_PAD, y0 = b.minY * view.zoom + view.y - SELECTION_PAD;
  const x1 = b.maxX * view.zoom + view.x + SELECTION_PAD, y1 = b.maxY * view.zoom + view.y + SELECTION_PAD;
  const corners: [Corner, number, number][] = [
    ['nw', x0, y0],
    ['ne', x1, y0],
    ['sw', x0, y1],
    ['se', x1, y1],
  ];
  return (
    <g className="selection">
      <rect className="selection-box" x={x0} y={y0} width={x1 - x0} height={y1 - y0} />
      {corners.map(([c, x, y]) => (
        <rect
          key={c}
          className={`handle handle-${c}`}
          data-handle={c}
          x={x - SIZE / 2}
          y={y - SIZE / 2}
          width={SIZE}
          height={SIZE}
          rx={2}
        />
      ))}
    </g>
  );
}
