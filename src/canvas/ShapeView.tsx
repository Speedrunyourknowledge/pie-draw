import { memo } from 'react';
import { smoothPath } from '../geometry';
import type { Shape } from '../types';

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

  let body;
  switch (s.type) {
    case 'square':
    case 'rectangle':
      body = <rect x={-s.w / 2} y={-s.h / 2} width={s.w} height={s.h} {...paint} />;
      break;
    case 'circle':
    case 'ellipse':
      body = <ellipse rx={s.rx} ry={s.ry} {...paint} />;
      break;
    case 'triangle':
      body = <polygon points={s.points.map((p) => p.join(',')).join(' ')} {...paint} />;
      break;
    case 'freehand': {
      const d = smoothPath(s.points);
      body = (
        <>
          {/* Wide invisible stroke so thin lines are easy to grab. */}
          {interactive && (
            <path
              d={d}
              fill="none"
              stroke="transparent"
              strokeWidth={16}
              vectorEffect="non-scaling-stroke"
              strokeLinecap="round"
              pointerEvents="stroke"
            />
          )}
          <path d={d} {...paint} pointerEvents="none" />
        </>
      );
      break;
    }
  }

  return (
    <g
      className={className}
      data-id={interactive ? s.id : undefined}
      transform={`translate(${s.x} ${s.y}) rotate(${s.rotation}) scale(${s.scaleX} ${s.scaleY})`}
    >
      <g className={pulse ? 'pulse' : undefined}>{body}</g>
    </g>
  );
});
