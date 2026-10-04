import { groupBounds, worldBounds, type Bounds } from '../geometry';
import type { View } from '../store';
import type { Shape } from '../types';

/** A corner, or (single letter) the middle of an edge. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';

const SIZE = 10;
const EDGE_GRAB = 10; // px thickness of the invisible strip along each edge
const MIN_EDGE = 28; // px; on a thinner box the edge strips would cover the shape, so they're left out
export const SELECTION_PAD = 4;

/** A world-space box as padded screen coordinates. */
function screenBox(b: Bounds, view: View) {
  return {
    x0: b.minX * view.zoom + view.x - SELECTION_PAD,
    y0: b.minY * view.zoom + view.y - SELECTION_PAD,
    x1: b.maxX * view.zoom + view.x + SELECTION_PAD,
    y1: b.maxY * view.zoom + view.y + SELECTION_PAD,
  };
}

interface Props {
  shapes: Shape[];
  view: View;
  /** While a selection box is being dragged: outline each shape it touches, but no group box yet. */
  preview?: boolean;
}

/**
 * Drawn in screen space so handles stay the same size at any zoom. One shape gets a box with corner
 * and edge handles; several get a light outline each plus one such box around them all. The inside
 * of a multi-shape box is a single target, so the group moves and opens the menu as one object.
 */
export function SelectionHandles({ shapes, view, preview = false }: Props) {
  const multi = shapes.length > 1;
  const members = (multi || preview) &&
    shapes.map((s) => {
      const b = screenBox(worldBounds(s), view);
      return (
        <rect key={s.id} className="selection-member" x={b.x0} y={b.y0} width={b.x1 - b.x0} height={b.y1 - b.y0} />
      );
    });
  if (preview) return <g className="selection">{members}</g>;

  const { x0, y0, x1, y1 } = screenBox(groupBounds(shapes), view);
  const w = x1 - x0, h = y1 - y0;
  const corners: [Corner, number, number][] = [
    ['nw', x0, y0],
    ['ne', x1, y0],
    ['sw', x0, y1],
    ['se', x1, y1],
  ];
  // Strips run between the corner handles; each is [edge, x, y, width, height].
  const edges: [Corner, number, number, number, number][] = [];
  if (h >= MIN_EDGE) {
    edges.push(['n', x0 + SIZE / 2, y0 - EDGE_GRAB / 2, w - SIZE, EDGE_GRAB]);
    edges.push(['s', x0 + SIZE / 2, y1 - EDGE_GRAB / 2, w - SIZE, EDGE_GRAB]);
  }
  if (w >= MIN_EDGE) {
    edges.push(['w', x0 - EDGE_GRAB / 2, y0 + SIZE / 2, EDGE_GRAB, h - SIZE]);
    edges.push(['e', x1 - EDGE_GRAB / 2, y0 + SIZE / 2, EDGE_GRAB, h - SIZE]);
  }
  return (
    <g className="selection">
      {members}
      {multi && <rect className="group-area" data-group x={x0} y={y0} width={w} height={h} />}
      <rect className="selection-box" x={x0} y={y0} width={w} height={h} />
      {edges.map(([c, x, y, ew, eh]) => (
        <rect key={c} className={`edge edge-${c}`} data-handle={c} x={x} y={y} width={ew} height={eh} />
      ))}
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
