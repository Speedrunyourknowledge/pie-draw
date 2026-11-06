import { frameOf, groupFrame, isLine, lineEnds, type Frame } from '../geometry';
import type { View } from '../store';
import type { Shape } from '../types';
import { toScreen } from '../view';

/** A corner, or (single letter) the middle of an edge. */
export type Corner = 'nw' | 'ne' | 'sw' | 'se' | 'n' | 's' | 'e' | 'w';
/** Anything on the selection box that can be dragged: a corner, an edge, the rotate knob, or a line's end. */
export type Handle = Corner | 'rotate' | 'end0' | 'end1';

const SIZE = 10;
const EDGE_GRAB = 10; // px thickness of the invisible strip along each edge
const MIN_EDGE = 28; // px; on a thinner box the edge strips would cover the shape, so they're left out
const ROTATE_GAP = 24; // px from the top edge to the rotate knob
const ROTATE_R = 5.5; // px radius of the knob as drawn
// The knob's invisible target, an ellipse measured in px from the knob's center: a little bigger than
// the knob, but tight enough that the rotate cursor never shows (or grabs) when the pointer is visibly
// off it. It reaches farthest upward, where nothing else competes for the pointer.
const ROTATE_GRAB_SIDE = 8;
const ROTATE_GRAB_ABOVE = 12;
const ROTATE_GRAB_BELOW = 10;
const END_R = 5.5; // a line's end handles, drawn and grabbed like the rotate knob
const END_GRAB = 12;
export const SELECTION_PAD = 4;

/** Which way each handle drags, in degrees clockwise from east, before the box is turned. */
const DIRECTION: Record<Corner, number> = { e: 0, se: 45, s: 90, sw: 135, w: 180, nw: 225, n: 270, ne: 315 };
const CURSORS = ['ew', 'nwse', 'ns', 'nesw'] as const;

/** The resize cursor that points along a handle's drag direction once the box is turned. */
function cursorFor(c: Corner, angle: number): string {
  const a = (((DIRECTION[c] + angle) % 180) + 180) % 180;
  return `cur-${CURSORS[Math.round(a / 45) % 4]}`;
}

/** A frame as a padded screen-space rectangle, turned about its middle. */
function FrameRect({ f, view, className }: { f: Frame; view: View; className: string }) {
  const [cx, cy] = toScreen([f.cx, f.cy], view);
  const w = f.w * view.zoom + 2 * SELECTION_PAD, h = f.h * view.zoom + 2 * SELECTION_PAD;
  return (
    <rect
      className={className}
      x={cx - w / 2}
      y={cy - h / 2}
      width={w}
      height={h}
      transform={f.angle ? `rotate(${f.angle} ${cx} ${cy})` : undefined}
    />
  );
}

interface Props {
  shapes: Shape[];
  view: View;
  /** While a selection box is being dragged: outline each shape it touches, but no group box yet. */
  preview?: boolean;
  /** Draw the box here instead of around the shapes (a multi-selection's box turning mid-rotate). */
  frame?: Frame | null;
}

/**
 * Drawn in screen space so handles stay the same size at any zoom. One shape gets a box (turned with
 * the shape) with corner and edge handles and a rotate knob above; several get a light outline each
 * plus one such box around them all. The inside of a multi-shape box is a single target, so the group
 * moves and opens the menu as one object.
 */
export function SelectionHandles({ shapes, view, preview = false, frame }: Props) {
  const multi = shapes.length > 1;
  // A lone straight line is edited by its ends instead: drag one to move it (it snaps to other
  // lines' ends and shapes' corners), and the line follows.
  if (!multi && !preview && !frame && isLine(shapes[0])) {
    return (
      <g className="selection">
        {lineEnds(shapes[0]).map((w, i) => {
          const [x, y] = toScreen(w, view);
          return (
            <g key={i} className="end-handle" data-handle={`end${i}`}>
              <circle className="end-grab" cx={x} cy={y} r={END_GRAB} />
              <circle className="end-knob" cx={x} cy={y} r={END_R} />
            </g>
          );
        })}
      </g>
    );
  }
  const members = (multi || preview) &&
    shapes.map((s) => <FrameRect key={s.id} f={frameOf(s)} view={view} className="selection-member" />);
  if (preview) return <g className="selection">{members}</g>;

  const f = frame ?? groupFrame(shapes);
  const [cx, cy] = toScreen([f.cx, f.cy], view);
  // Everything below is laid out upright around (0, 0), then turned and moved into place.
  const w = f.w * view.zoom + 2 * SELECTION_PAD, h = f.h * view.zoom + 2 * SELECTION_PAD;
  const x0 = -w / 2, y0 = -h / 2, x1 = w / 2, y1 = h / 2;
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
  const knobY = y0 - ROTATE_GAP;
  return (
    <g className="selection">
      {members}
      <g transform={`translate(${cx} ${cy})${f.angle ? ` rotate(${f.angle})` : ''}`}>
        {multi && <rect className="group-area" data-group x={x0} y={y0} width={w} height={h} />}
        <rect className="selection-box" x={x0} y={y0} width={w} height={h} />
        <line className="rotate-stem" x1={0} y1={y0} x2={0} y2={knobY + ROTATE_R} />
        {edges.map(([c, x, y, ew, eh]) => (
          <rect key={c} className={`edge ${cursorFor(c, f.angle)}`} data-handle={c} x={x} y={y} width={ew} height={eh} />
        ))}
        {corners.map(([c, x, y]) => (
          <rect
            key={c}
            className={`handle ${cursorFor(c, f.angle)}`}
            data-handle={c}
            x={x - SIZE / 2}
            y={y - SIZE / 2}
            width={SIZE}
            height={SIZE}
            rx={2}
          />
        ))}
        <g className="rotate-handle" data-handle="rotate">
          <ellipse
            className="rotate-grab"
            cy={knobY - (ROTATE_GRAB_ABOVE - ROTATE_GRAB_BELOW) / 2}
            rx={ROTATE_GRAB_SIDE}
            ry={(ROTATE_GRAB_ABOVE + ROTATE_GRAB_BELOW) / 2}
          />
          <circle className="rotate-knob" cy={knobY} r={ROTATE_R} />
        </g>
      </g>
    </g>
  );
}
