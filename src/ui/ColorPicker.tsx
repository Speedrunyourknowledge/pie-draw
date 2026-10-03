import { useEffect, useRef, useState } from 'react';
import { useStore } from '../store';
import { PALETTE } from '../types';

const DRAG_SLOP = 5;
const FAN_RADIUS = 84; // swatches fan out on a quarter arc, from left to straight up

interface Drag {
  color: string;
  start: [number, number];
  at: [number, number];
  moved: boolean;
}

function shapeIdAt(x: number, y: number): string | null {
  return document.elementFromPoint(x, y)?.closest('[data-id]')?.getAttribute('data-id') ?? null;
}

/**
 * One swatch shows the current color. Click it to fan out the palette and pick;
 * drag it (or a fanned swatch) onto any shape to paint that shape.
 */
export function ColorPicker() {
  const currentColor = useStore((s) => s.currentColor);
  const selected = useStore((s) => s.shapes.find((x) => x.id === s.selectedId) ?? null);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  // With a shape selected the swatch shows (and edits) that shape's color.
  const shown = selected ? (selected.fill ?? selected.stroke ?? currentColor) : currentColor;
  const shownName = PALETTE.find((c) => c.value === shown)?.name ?? '';

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const update = (d: Drag | null) => {
    dragRef.current = d;
    setDrag(d);
  };

  const handlers = (color: string, onClick: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      update({ color, start: [e.clientX, e.clientY], at: [e.clientX, e.clientY], moved: false });
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) > DRAG_SLOP;
      update({ ...d, at: [e.clientX, e.clientY], moved });
      if (moved) useStore.getState().setDropTarget(shapeIdAt(e.clientX, e.clientY));
    },
    onPointerUp: (e: React.PointerEvent) => {
      const d = dragRef.current;
      update(null);
      const st = useStore.getState();
      st.setDropTarget(null);
      if (!d) return;
      if (!d.moved) return onClick();
      const id = shapeIdAt(e.clientX, e.clientY);
      if (id) {
        st.recolor(id, d.color);
        st.select(id);
      }
      setOpen(false);
    },
    onPointerCancel: () => {
      update(null);
      useStore.getState().setDropTarget(null);
    },
  });

  return (
    <div className="color-picker" ref={rootRef}>
      {open &&
        PALETTE.map((c, i) => {
          const a = Math.PI - (i * (Math.PI / 2)) / (PALETTE.length - 1); // 180° → 90°
          const x = Math.cos(a) * FAN_RADIUS, y = -Math.sin(a) * FAN_RADIUS;
          return (
            <button
              key={c.value}
              className={`fan-swatch ${c.value === shown ? 'active' : ''}`}
              style={{ '--swatch': c.value, '--x': `${x}px`, '--y': `${y}px`, '--i': i } as React.CSSProperties}
              title={`${c.name} (${i + 1})`}
              aria-label={c.name}
              {...handlers(c.value, () => {
                useStore.getState().setColor(c.value);
                setOpen(false);
              })}
            >
              <span className="fan-key">{i + 1}</span>
            </button>
          );
        })}
      <button
        className={`color-current ${open ? 'open' : ''}`}
        style={{ '--swatch': shown } as React.CSSProperties}
        title={`${selected ? 'Shape' : 'Drawing'} color: ${shownName}. Click to change, or drag onto a shape`}
        aria-label={`Color: ${shownName}. Change color`}
        aria-expanded={open}
        {...handlers(shown, () => setOpen((o) => !o))}
      />
      {drag?.moved && (
        <div className="color-drag" style={{ left: drag.at[0], top: drag.at[1], background: drag.color }} />
      )}
    </div>
  );
}
