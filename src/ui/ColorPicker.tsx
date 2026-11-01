import { useEffect, useRef, useState } from 'react';
import { colorLabel } from '../colors';
import { canFill } from '../geometry';
import { useStore } from '../store';
import { ColorEditor } from './ColorEditor';

const DRAG_THRESHOLD = 5;
const FAN_RADIUS = 84; // swatches fan out on a quarter arc, from left to straight up
const FAN_STEP = { line: 36, fill: 35 }; // min distance between neighboring swatches along the arc
const FAN_MAX_RADIUS = 92; // past this, the arc wraps further around the button (below horizontal) instead of growing
// Angle the arc ends at (90° = straight up). The line fan stops short so it clears the Fill button above.
const FAN_END = { line: (132.5 * Math.PI) / 180, fill: Math.PI / 2 };
// The outer row (custom color, then saved colors) runs from the same start, one ring further out,
// echoing the pie menu's submenu ring. The custom button comes first so it never moves.
const OUTER_GAP = 46;
const OUTER_STEP = 40;

type Kind = 'line' | 'fill';

interface Drag {
  color: string | null;
  slot: number | null; // dragged from key 1–5's swatch (0–4): dropping on another key swaps them
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

/** The key swatch (data-slot) under a point, if any. */
function slotAt(x: number, y: number): number | null {
  const slot = document.elementFromPoint(x, y)?.closest('[data-slot]')?.getAttribute('data-slot');
  return slot == null ? null : Number(slot);
}

/**
 * A swatch for the line color (drawn as a ring) or the fill (a disc; white with a slash for none).
 * Click it to fan out the palette and pick; drag it (or a fanned swatch) onto a shape to paint it.
 */
export function ColorPicker({ kind }: { kind: Kind }) {
  const current = useStore((s) => (kind === 'line' ? s.currentColor : s.currentFill));
  const shapes = useStore((s) => s.shapes);
  const selectedIds = useStore((s) => s.selectedIds);
  const palette = useStore((s) => s.palette);
  const swatches = useStore((s) => s.swatches);
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState(false); // the custom color editor is open
  const [slotTarget, setSlotTarget] = useState<number | null>(null); // key swatch under a dragged color
  const [drag, setDrag] = useState<Drag | null>(null);
  const dragRef = useRef<Drag | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const options: { value: string | null; slot: number | null }[] = [
    ...palette.map((value, slot) => ({ value, slot })),
    ...(kind === 'fill' ? [{ value: null, slot: null }] : []),
  ];
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
  const shownName = mixed ? 'Mixed' : colorLabel(shown);
  const apply = (c: string | null) => {
    const st = useStore.getState();
    if (kind === 'line') st.setColor(c!);
    else st.setFill(c);
  };

  useEffect(() => {
    if (!open && !editing) return;
    const close = () => {
      setOpen(false);
      setEditing(false);
    };
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        close();
        e.stopImmediatePropagation();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open, editing]);

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

  const handlers = (color: string | null, onClick: () => void, slot: number | null = null) => ({
    onPointerDown: (e: React.PointerEvent) => {
      if (e.button !== 0) return;
      e.currentTarget.setPointerCapture(e.pointerId);
      update({ color, slot, start: [e.clientX, e.clientY], at: [e.clientX, e.clientY], moved: false });
    },
    onPointerMove: (e: React.PointerEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const moved = d.moved || Math.hypot(e.clientX - d.start[0], e.clientY - d.start[1]) > DRAG_THRESHOLD;
      update({ ...d, at: [e.clientX, e.clientY], moved });
      if (!moved) return;
      // Over a key's swatch, the drop changes that key; anywhere else it may paint a shape.
      const key = d.color ? slotAt(e.clientX, e.clientY) : null;
      setSlotTarget(key);
      useStore.getState().setDropTarget(key === null ? targetAt(e.clientX, e.clientY) : null);
    },
    onPointerUp: (e: React.PointerEvent) => {
      const d = dragRef.current;
      update(null);
      setSlotTarget(null);
      const st = useStore.getState();
      st.setDropTarget(null);
      if (!d) return;
      if (!d.moved) return onClick();
      const key = d.color ? slotAt(e.clientX, e.clientY) : null;
      if (key !== null && d.color) {
        // The fan stays open, so the new key color can be seen (and used) right away.
        if (d.slot === null) {
          st.setPaletteSlot(key, d.color);
          st.showToast(`Key ${key + 1}: ${colorLabel(d.color)}`);
        } else if (d.slot !== key) {
          st.swapPaletteSlots(d.slot, key);
          st.showToast(`Swapped keys ${d.slot + 1} and ${key + 1}`);
        }
        return;
      }
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
      setSlotTarget(null);
      useStore.getState().setDropTarget(null);
    },
  });

  // Fan geometry: the keys (and None) on an inner arc, the custom button and saved colors outside it.
  const arcLen = FAN_STEP[kind] * (options.length - 1);
  const fanR = Math.min(FAN_MAX_RADIUS, Math.max(FAN_RADIUS, arcLen / (Math.PI / 2)));
  const span = Math.max(Math.PI / 2, arcLen / fanR);
  const fanStart = FAN_END[kind] + span; // left → up
  const outerR = fanR + OUTER_GAP;
  const place = (a: number, r: number) => ({ '--x': `${Math.cos(a) * r}px`, '--y': `${-Math.sin(a) * r}px` });
  const outerAt = (j: number) => place(fanStart - (j * OUTER_STEP) / outerR, outerR);

  return (
    // Mouse clicks don't focus the buttons, so a later key press doesn't leave a focus ring behind.
    <div className={`color-picker ${kind}`} ref={rootRef} onMouseDown={(e) => e.preventDefault()}>
      {open &&
        options.map((c, i) => {
          const a = fanStart - (i * span) / (options.length - 1);
          const key = c.value ? `${kind === 'fill' ? '⇧' : ''}${i + 1}` : kind === 'fill' ? '⇧6' : '';
          const name = colorLabel(c.value);
          return (
            <button
              key={c.slot ?? 'none'}
              className={`fan-swatch ${kind} ${c.value ? '' : 'none'} ${c.value === shown && !mixed ? 'active' : ''} ${c.slot !== null && c.slot === slotTarget ? 'slot-target' : ''}`}
              style={{ '--swatch': c.value ?? '#fff', ...place(a, fanR) } as React.CSSProperties}
              data-slot={c.slot ?? undefined}
              data-tip-side="left"
              data-tip={`${label}: ${name} (${key})${c.slot !== null ? ' · Drop a color here to change this key' : ''}`}
              aria-label={`${label}: ${name}`}
              {...handlers(
                c.value,
                () => {
                  apply(c.value);
                  setOpen(false);
                },
                c.slot,
              )}
            >
              <span className="fan-key">{key}</span>
            </button>
          );
        })}
      {open && (
        <button
          className={`fan-swatch ${kind} custom`}
          style={outerAt(0) as React.CSSProperties}
          data-tip-side="left"
          data-tip="Custom color: any color, put it on a key, or save it"
          aria-label={`Custom ${label.toLowerCase()} color`}
          onClick={() => {
            setOpen(false);
            setEditing(true);
          }}
        >
          <svg viewBox="0 0 20 20"><path d="M10 5.5 V14.5 M5.5 10 H14.5" /></svg>
        </button>
      )}
      {open &&
        swatches.map((c, j) => (
          <button
            key={c}
            className={`fan-swatch ${kind} saved ${c === shown && !mixed ? 'active' : ''}`}
            style={{ '--swatch': c, ...outerAt(j + 1) } as React.CSSProperties}
            data-tip-side="left"
            data-tip={`Saved: ${c.toUpperCase()} · Drag onto a key to use it with 1–5`}
            aria-label={`${label}: saved color ${c.toUpperCase()}`}
            {...handlers(c, () => {
              apply(c);
              setOpen(false);
            })}
          />
        ))}
      {editing && <ColorEditor kind={kind} shown={shown} onClose={() => setEditing(false)} />}
      <button
        className={`color-current ${kind} ${shown ? '' : 'none'} ${open || editing ? 'open' : ''}`}
        style={{ '--swatch': shown ?? '#fff' } as React.CSSProperties}
        disabled={disabled}
        data-tip-side="left"
        data-tip={
          disabled
            ? 'Lines have no fill'
            : `${selected.length > 1 ? 'Selection' : selected.length ? 'Shape' : 'New shape'} ${label.toLowerCase()}: ${shownName}. Click to change, or drag onto a shape`
        }
        aria-label={`${label}: ${shownName}. Change ${label.toLowerCase()}`}
        aria-expanded={open}
        {...handlers(shown, () => {
          if (editing) setEditing(false);
          else setOpen((o) => !o);
        })}
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
