import { useEffect, useRef, useState } from 'react';
import { canFill } from '../geometry';
import { useStore } from '../store';
import { PALETTE } from '../types';

const DRAG_THRESHOLD = 5;
const FAN_RADIUS = 84; // swatches fan out on a quarter arc, from left to straight up
const FAN_STEP = 34; // min distance between neighboring swatches along the arc

type Kind = 'line' | 'fill';

interface Drag {
  color: string | null;
  start: [number, number];
  at: [number, number];
  moved: boolean;
}

/** The shape under a point; anywhere in a multi-selection's box counts as its first shape. */
function shapeIdAt(x: number, y: number): string | null {
  const top = document.elementFromPoint(x, y);
  if (top?.hasAttribute('data-group')) return useStore.getState().selectedIds[0] ?? null;
  return top?.closest('[data-id]')?.getAttribute('data-id') ?? null;
}

const LINE_OPTIONS: { name: string; value: string | null }[] = [...PALETTE];
const FILL_OPTIONS: { name: string; value: string | null }[] = [...PALETTE, { name: 'None', value: null }];

const colorName = (c: string | null) => (c ? (PALETTE.find((p) => p.value === c)?.name ?? '') : 'None');

/**
 * A swatch for the line color (drawn as a ring) or the fill (a disc; white with a slash for none).
 * Click it to fan out the palette and pick; drag it (or a fanned swatch) onto a shape to paint it.
 */
export function ColorPicker({ kind }: { kind: Kind }) {
  const current = useStore((s) => (kind === 'line' ? s.currentColor : s.currentFill));
  const shapes = useStore((s) => s.shapes);
  const selectedIds = useStore((s) => s.selectedIds);
  const [open, setOpen] = useState(false);
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const options = kind === 'line' ? LINE_OPTIONS : FILL_OPTIONS;
  const label = kind === 'line' ? 'Line' : 'Fill';
  // The shapes this swatch shows and edits: the selected ones that have this kind of color.
  const selected = shapes.filter((x) => selectedIds.includes(x.id));
  const targets = kind === 'line' ? selected : selected.filter(canFill);
  // Freehand lines are open, so the fill swatch is off while only lines are selected.
  const disabled = kind === 'fill' && selected.length > 0 && targets.length === 0;
  const colorOf = (x: (typeof shapes)[number]) => (kind === 'line' ? x.stroke : x.fill);
  // With shapes selected the swatch shows their color (the first one's, if they differ).
  const shown = targets.length > 0 ? colorOf(targets[0]) : current;
  const mixed = targets.some((x) => colorOf(x) !== shown);
  const shownName = mixed ? 'Mixed' : colorName(shown);
  const apply = (c: string | null) => {
    const st = useStore.getState();
    if (kind === 'line') st.setColor(c!);
    else st.setFill(c);
  };

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

  /** The shape a dragged swatch would paint; fills skip open lines. */
  const targetAt = (x: number, y: number) => {
    const id = shapeIdAt(x, y);
    const s = id ? useStore.getState().shapes.find((sh) => sh.id === id) : null;
    return s && (kind === 'line' || canFill(s)) ? s.id : null;
  };

  const handlers = (color: string | null, onClick: () => void) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      update({ color, start: [e.clientX, e.clientY], at: [e.clientX, e.clientY], moved: false });
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) > DRAG_THRESHOLD;
      update({ ...d, at: [e.clientX, e.clientY], moved });
      if (moved) useStore.getState().setDropTarget(targetAt(e.clientX, e.clientY));
    },
    onPointerUp: (e: React.PointerEvent) => {
      const d = dragRef.current;
      update(null);
      const st = useStore.getState();
      st.setDropTarget(null);
      if (!d) return;
      if (!d.moved) return onClick();
      const id = targetAt(e.clientX, e.clientY);
      if (id && st.selectedIds.includes(id)) {
        apply(d.color); // dropped on the selection: paint all of it
      } else if (id) {
        if (kind === 'line') st.recolor(id, d.color!);
        else st.refill(id, d.color);
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
    // Mouse clicks don't focus the buttons, so a later key press doesn't leave a focus ring behind.
    <div className={`color-picker ${kind}`} ref={rootRef} onMouseDown={(e) => e.preventDefault()}>
      {open &&
        options.map((c, i) => {
          const a = Math.PI - (i * (Math.PI / 2)) / (options.length - 1); // 180° → 90°
          const r = Math.max(FAN_RADIUS, (FAN_STEP * (options.length - 1)) / (Math.PI / 2));
          const x = Math.cos(a) * r, y = -Math.sin(a) * r;
          const key = c.value ? `${kind === 'fill' ? '⇧' : ''}${i + 1}` : kind === 'fill' ? '⇧0' : '';
          return (
            <button
              key={c.name}
              className={`fan-swatch ${kind} ${c.value ? '' : 'none'} ${c.value === shown && !mixed ? 'active' : ''}`}
              style={{ '--swatch': c.value ?? '#fff', '--x': `${x}px`, '--y': `${y}px` } as React.CSSProperties}
              title={`${label}: ${c.name} (${key})`}
              aria-label={`${label}: ${c.name}`}
              {...handlers(c.value, () => {
                apply(c.value);
                setOpen(false);
              })}
            >
              <span className="fan-key">{key}</span>
            </button>
          );
        })}
      <button
        className={`color-current ${kind} ${shown ? '' : 'none'} ${open ? 'open' : ''}`}
        style={{ '--swatch': shown ?? '#fff' } as React.CSSProperties}
        disabled={disabled}
        title={
          disabled
            ? 'Lines have no fill'
            : `${selected.length > 1 ? 'Selection' : selected.length ? 'Shape' : 'New shape'} ${label.toLowerCase()}: ${shownName}. Click to change, or drag onto a shape`
        }
        aria-label={`${label}: ${shownName}. Change ${label.toLowerCase()}`}
        aria-expanded={open}
        {...handlers(shown, () => setOpen((o) => !o))}
      />
      <span className="color-label">{label}</span>
      {drag?.moved && (
        <div
          className={`color-drag ${kind} ${drag.color ? '' : 'none'}`}
          style={{ left: drag.at[0], top: drag.at[1], '--swatch': drag.color ?? '#fff' } as React.CSSProperties}
        />
      )}
    </div>
  );
}
