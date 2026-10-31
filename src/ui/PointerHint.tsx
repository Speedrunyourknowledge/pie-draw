import { useEffect, useLayoutEffect, useState } from 'react';
import { useStore } from '../store';

// The hand tool uses the system's hand cursor, which a page can't copy, so it shows the toolbar's hand.
const HAND_ICON =
  'M7 10.5 V4.8 a1.2 1.2 0 0 1 2.4 0 V9.5 M9.4 9 V3.6 a1.2 1.2 0 0 1 2.4 0 V9.5 M11.8 9 V4.6 a1.2 1.2 0 0 1 2.4 0 V10 M14.2 9.3 V7 a1.2 1.2 0 0 1 2.4 0 V12 a6 6 0 0 1 -6 6 h-.6 a5.5 5.5 0 0 1 -4.3 -2.1 L3.4 13 a1.3 1.3 0 0 1 2 -1.6 L7 13';

/**
 * The image of the canvas cursor at this point, or null where the system's own cursor shows. Its ink
 * is recolored to the ring's gray, so the two read as one mark.
 */
function cursorImageAt(x: number, y: number): string | null {
  const el = document.elementFromPoint(x, y);
  const url = el && /url\("([^"]+)"\)/.exec(getComputedStyle(el).cursor)?.[1];
  if (!url) return null;
  const gray = getComputedStyle(document.documentElement).getPropertyValue('--muted').trim();
  return url.replace(/%231f2933/gi, encodeURIComponent(gray)); // the cursors' ink, --black
}

/** Whether a cursor image is the pen's, found by the path its tip starts at (see .canvas in index.css). */
function isPen(url: string): boolean {
  return url.includes('M3.2 20.8') || url.includes('M3.2%2020.8');
}

/**
 * Marks where the pointer is until the mouse moves. The system hides the pointer while typing and
 * only shows it again on a mouse move, so after leaving the message box with a key this keeps it
 * from seeming to vanish over the canvas. It is a ring with the cursor's image beside it rather than
 * a copy of the cursor in its place, which no page can line up exactly on every system.
 */
export function PointerHint({ at, onDone }: { at: { x: number; y: number }; onDone: () => void }) {
  const hand = useStore((s) => s.tool === 'hand');
  // Any change to the drawing's state (Esc again dropping back to the pen, say) can change the
  // cursor, so read it again on each one. The marker lasts only until the mouse moves.
  const state = useStore();
  const [image, setImage] = useState<string | null>(null);

  // After the commit, so the canvas has already dropped its aiming cursor or taken the new tool's.
  useLayoutEffect(() => setImage(cursorImageAt(at.x, at.y)), [at, state]);

  useEffect(() => {
    // Browsers can send a move without one after the page changes, so only a real move counts.
    const move = (e: PointerEvent) => {
      if (e.clientX !== at.x || e.clientY !== at.y) onDone();
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', onDone);
    window.addEventListener('wheel', onDone);
    window.addEventListener('blur', onDone);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', onDone);
      window.removeEventListener('wheel', onDone);
      window.removeEventListener('blur', onDone);
    };
  }, [at, onDone]);

  return (
    <div className="pointer-hint" style={{ left: at.x, top: at.y }} aria-hidden>
      <svg className="pointer-hint-ring" viewBox="-10 -10 20 20">
        <circle r="6" />
      </svg>
      {image ? (
        <img className={`pointer-hint-tool${isPen(image) ? ' pen' : ''}`} src={image} alt="" />
      ) : (
        hand && (
          <svg className="pointer-hint-tool" viewBox="0 0 20 20">
            <path d={HAND_ICON} />
          </svg>
        )
      )}
    </div>
  );
}
