import type { ReactNode } from 'react';
import type { Pt } from '../types';
import type { PieItem } from './pieMenuConfig';
import {
  CANCEL_RADIUS,
  DEAD_ZONE,
  GAP,
  R_INNER,
  R_OUTER,
  R_SUB,
  SUB_SPAN,
  itemAngle,
  subAngle,
  type PieSelection,
} from './pieGeometry';

// ---- rendering ----

const polar = (r: number, a: number): Pt => [Math.sin(a) * r, -Math.cos(a) * r];

function sector(r0: number, r1: number, a0: number, a1: number): string {
  const [x0, y0] = polar(r1, a0), [x1, y1] = polar(r1, a1);
  const [x2, y2] = polar(r0, a1), [x3, y3] = polar(r0, a0);
  const large = a1 - a0 > Math.PI ? 1 : 0;
  return `M${x0} ${y0} A${r1} ${r1} 0 ${large} 1 ${x1} ${y1} L${x2} ${y2} A${r0} ${r0} 0 ${large} 0 ${x3} ${y3}Z`;
}

const ICONS: Record<string, ReactNode> = {
  square: <rect x={-7} y={-7} width={14} height={14} />,
  rectangle: <rect x={-9} y={-6} width={18} height={12} />,
  circle: <circle r={7.5} />,
  ellipse: <ellipse rx={9.5} ry={6} />,
  triangle: <polygon points="0,-8 8.5,7 -8.5,7" />,
  paste: (
    <>
      <rect x={-6} y={-6} width={12} height={14} rx={1.5} />
      <path d="M-3 -6 v-2 h6 v2" />
    </>
  ),
  file: <path d="M-6 -8 h8 l4 4 v12 h-12z M2 -8 v4 h4" />,
  new: <path d="M-6 -8 h8 l4 4 v12 h-12z M0 -1 v6 M-3 2 h6" />,
  open: <path d="M-8 6 v-12 h5 l2 2 h8 v3 M-8 6 l3 -8 h12 l-3 8z" />,
  save: (
    <>
      <path d="M-7 -7 h11 l3 3 v11 h-14z" />
      <rect x={-4} y={1} width={8} height={6} />
    </>
  ),
  saveas: (
    <>
      <path d="M-7 -7 h11 l3 3 v11 h-14z" />
      <path d="M-3 3 l5 -5 l2 2 l-5 5 h-2z" />
    </>
  ),
  color: (
    <>
      <circle cx={-3} cy={-2} r={4.5} />
      <circle cx={3} cy={-2} r={4.5} />
      <circle cx={0} cy={3} r={4.5} />
    </>
  ),
  copy: (
    <>
      <rect x={-7} y={-7} width={10} height={10} rx={1.5} />
      <rect x={-3} y={-3} width={10} height={10} rx={1.5} />
    </>
  ),
  cut: (
    <>
      <circle cx={-4} cy={5} r={2.5} />
      <circle cx={4} cy={5} r={2.5} />
      <path d="M-2.5 3 L5 -8 M2.5 3 L-5 -8" />
    </>
  ),
  delete: <path d="M-7 -5 h14 M-2 -5 v-2 h4 v2 M-5 -5 l1 12 h8 l1 -12" />,
  front: (
    <>
      <rect x={-7} y={-1} width={9} height={8} className="icon-dim" />
      <rect x={-2} y={-7} width={9} height={8} className="icon-solid" />
    </>
  ),
  back: (
    <>
      <rect x={-2} y={-7} width={9} height={8} className="icon-solid" />
      <rect x={-7} y={-1} width={9} height={8} className="icon-dim" />
    </>
  ),
};

function ItemFace({ item, at }: { item: PieItem; at: Pt }) {
  return (
    <g transform={`translate(${at[0]} ${at[1]})`} className="pie-face">
      {item.swatch ? (
        <circle cy={-6} r={9} fill={item.swatch} className="pie-swatch" />
      ) : (
        <g className="pie-icon" transform="translate(0 -7)">
          {ICONS[item.icon]}
        </g>
      )}
      <text y={15} className="pie-label">
        {item.label}
      </text>
    </g>
  );
}

interface Props {
  items: PieItem[];
  origin: Pt;
  pointer: Pt;
  selection: PieSelection;
}

export function PieMenu({ items, origin, pointer, selection }: Props) {
  const n = items.length;
  const half = Math.PI / n;
  const dx = pointer[0] - origin[0], dy = pointer[1] - origin[1];
  const inDead = selection.index < 0;
  const outside = Math.hypot(dx, dy) > CANCEL_RADIUS;
  // Show a submenu ring as a preview while its parent is highlighted, solid once entered.
  const subParent = selection.index >= 0 && items[selection.index].children ? selection.index : -1;

  return (
    <g className="pie" transform={`translate(${origin[0]} ${origin[1]})`}>
      {/* Faint edge: releasing beyond it cancels, just like the center ×. */}
      <circle r={CANCEL_RADIUS} className={`pie-edge ${outside ? 'outside' : ''}`} />
      <circle r={R_SUB + 2} className="pie-backdrop" />
      {items.map((item, i) => {
        const a = itemAngle(i, n);
        const active = selection.index === i;
        return (
          <g key={item.id} className={`pie-wedge ${active ? 'active' : ''}`}>
            <path className="pie-slice" d={sector(R_INNER, R_SUB, a - half + GAP, a + half - GAP)} />
            <ItemFace item={item} at={polar((R_INNER + R_SUB) / 2 + 2, a)} />
            {item.children && (
              <path
                className="pie-more"
                d={`M${polar(R_SUB - 7, a - 0.07).join(' ')} L${polar(R_SUB - 3, a).join(' ')} L${polar(R_SUB - 7, a + 0.07).join(' ')}`}
              />
            )}
          </g>
        );
      })}

      {subParent >= 0 && (
        <g className={`pie-sub ${selection.locked === subParent ? 'entered' : 'preview'}`}>
          {items[subParent].children!.map((child, j, arr) => {
            const a = subAngle(itemAngle(subParent, n), j, arr.length);
            return (
              <g key={child.id} className={`pie-wedge ${selection.sub === j ? 'active' : ''}`}>
                <path className="pie-slice" d={sector(R_SUB + 4, R_OUTER, a - SUB_SPAN / 2 + GAP, a + SUB_SPAN / 2 - GAP)} />
                <ItemFace item={child} at={polar((R_SUB + R_OUTER) / 2 + 4, a)} />
              </g>
            );
          })}
        </g>
      )}

      <g className={`pie-center ${inDead ? 'active' : ''}`}>
        <circle r={DEAD_ZONE - 2} />
        <path d="M-4 -4 L4 4 M4 -4 L-4 4" />
      </g>
      {!inDead && <line className="pie-pointer" x1={0} y1={0} x2={dx} y2={dy} />}
    </g>
  );
}
