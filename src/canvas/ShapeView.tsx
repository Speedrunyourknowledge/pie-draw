import { memo } from 'react';
import { smoothPath } from '../geometry';
import type { Shape } from '../types';

/**
 * Screen pixels of extra grab area on each side of a freehand stroke (Fitts's law: a wider target is
 * faster to hit). A fixed screen size, so lines stay as easy to grab at any zoom.
 */
const GRAB_MARGIN = 14;

/**
 * Glow, in screen pixels: how far the solid ring extends past the outline, then its soft falloff.
 * HALO_TUCK is how far the glow reaches back under the outline's edge, so the anti-aliased edge
 * pixels blend into it rather than reading as a hard, pixelated cut.
 */
const HALO_SPREAD = 0.5;
const HALO_BLUR = 1.75;
const HALO_TUCK = 0.75;

/** The shape's outline geometry with the given paint; used for both the shape and its hover halo. */
function outline(s: Shape, props: Record<string, unknown>) {
  switch (s.type) {
    case 'square':
    case 'rectangle':
      return <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} {...props} />;
    case 'circle':
    case 'ellipse':
      return <ellipse rx={s.rx} ry={s.ry} {...props} />;
    case 'triangle':
      return <polygon points={s.points.map((p) => p.join(',')).join(' ')} {...props} />;
    case 'freehand':
      return <path d={smoothPath(s.points)} {...props} />;
  }
}

/** Local-space bounds of the geometry, which the halo filter's region is sized from. */
function bounds(s: Shape) {
  switch (s.type) {
    case 'square':
    case 'rectangle':
      return { minX: -s.w / 2, minY: -s.h / 2, maxX: s.w / 2, maxY: s.h / 2 };
    case 'circle':
    case 'ellipse':
      return { minX: -s.rx, minY: -s.ry, maxX: s.rx, maxY: s.ry };
    case 'triangle':
    case 'freehand': {
      const xs = s.points.map((p) => p[0]);
      const ys = s.points.map((p) => p[1]);
      return { minX: Math.min(...xs), minY: Math.min(...ys), maxX: Math.max(...xs), maxY: Math.max(...ys) };
    }
  }
}

/**
 * Glow (hover, erase target, drop target) that sits only outside the shape: the filled silhouette (outline plus interior) is grown
 * and blurred, then all but the silhouette's soft edge is cut out, so the glow never blends into the stroke color
 * or spills into an outline-only shape. Lengths are in local units, converted from screen pixels per
 * axis so the glow stays round and the same size at any zoom or shape scale.
 */
function Halo({ shape: s, zoom }: { shape: Shape; zoom: number }) {
  const id = `halo-${s.id}`;
  const kx = 1 / (zoom * Math.abs(s.scaleX || 1));
  const ky = 1 / (zoom * Math.abs(s.scaleY || 1));
  const reach = s.strokeWidth / 2 + HALO_SPREAD + 3 * HALO_BLUR + 2;
  const b = bounds(s);
  return (
    <g className="halo">
      <filter
        id={id}
        filterUnits="userSpaceOnUse"
        x={b.minX - reach * kx}
        y={b.minY - reach * ky}
        width={b.maxX - b.minX + 2 * reach * kx}
        height={b.maxY - b.minY + 2 * reach * ky}
        colorInterpolationFilters="sRGB"
      >
        <feMorphology in="SourceAlpha" operator="erode" radius={`${HALO_TUCK * kx} ${HALO_TUCK * ky}`} result="core" />
        <feMorphology in="SourceAlpha" operator="dilate" radius={`${HALO_SPREAD * kx} ${HALO_SPREAD * ky}`} />
        <feGaussianBlur stdDeviation={`${HALO_BLUR * kx} ${HALO_BLUR * ky}`} result="spread" />
        {/* Color and strength come from CSS, so hover, erase and drop targets share this filter. */}
        <feFlood style={{ floodColor: 'var(--halo-color, var(--accent))', floodOpacity: 'var(--halo-opacity, 0.55)' }} />
        <feComposite in2="spread" operator="in" />
        <feComposite in2="core" operator="out" />
      </filter>
      {outline(s, {
        fill: s.type === 'freehand' ? 'none' : '#000',
        stroke: '#000',
        strokeWidth: s.strokeWidth * zoom,
        vectorEffect: 'non-scaling-stroke',
        strokeLinejoin: 'round',
        strokeLinecap: 'round',
        filter: `url(#${id})`,
        pointerEvents: 'none',
      })}
    </g>
  );
}

interface Props {
  shape: Shape;
  className?: string;
  /** Play the short scale pulse used when a shape is created or snapped. */
  pulse?: boolean;
  /** Ghosts and previews are not hit-testable. */
  interactive?: boolean;
  /** View zoom: strokes are non-scaling (so shape scaling never distorts them) but follow the zoom. */
  zoom?: number;
}

/** The only place that switches on shape type: everything else uses the shared fields. */
export const ShapeView = memo(function ShapeView({
  shape: s,
  className = 'shape',
  pulse = false,
  interactive = true,
  zoom = 1,
}: Props) {
  const paint = {
    fill: s.fill ?? 'none',
    stroke: s.stroke ?? 'none',
    strokeWidth: s.strokeWidth * zoom,
    vectorEffect: 'non-scaling-stroke' as const,
    strokeLinejoin: 'round' as const,
    strokeLinecap: 'round' as const,
    // Outline-only shapes are still selectable by their interior.
    pointerEvents: interactive ? ('all' as const) : ('none' as const),
  };

  const body =
    s.type === 'freehand' ? (
      <>
        {/* Wide invisible stroke so thin lines are easy to grab. */}
        {interactive && (
          <path
            d={smoothPath(s.points)}
            fill="none"
            stroke="transparent"
            strokeWidth={s.strokeWidth * zoom + 2 * GRAB_MARGIN}
            vectorEffect="non-scaling-stroke"
            strokeLinecap="round"
            strokeLinejoin="round"
            pointerEvents="stroke"
          />
        )}
        {outline(s, { ...paint, pointerEvents: 'none' })}
      </>
    ) : (
      outline(s, paint)
    );

  return (
    <g
      className={className}
      data-id={interactive ? s.id : undefined}
      transform={`translate(${s.x} ${s.y}) rotate(${s.rotation}) scale(${s.scaleX} ${s.scaleY})`}
    >
      <g className={pulse ? 'pulse' : undefined}>
        {interactive && <Halo shape={s} zoom={zoom} />}
        {body}
      </g>
    </g>
  );
});
