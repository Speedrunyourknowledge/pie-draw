import { useMemo } from 'react';
import { shapeFromRecognized, type Recognized } from '../interaction/recognize';
import { ShapeView } from './ShapeView';

/** Faded preview of the primitive the current stroke will snap to on release. */
export function GhostPreview({ result, color, zoom }: { result: Recognized; color: string; zoom: number }) {
  const shape = useMemo(() => {
    const s = shapeFromRecognized(result, color);
    return { ...s, id: 'ghost', fill: color }; // filled so it reads as a "shadow" behind the ink
  }, [result, color]);
  return <ShapeView shape={shape} className="ghost" interactive={false} zoom={zoom} />;
}
