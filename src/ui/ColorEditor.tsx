import { useRef, useState } from 'react';
import { DEFAULT_PALETTE, MAX_SWATCHES, colorLabel, hexToHsv, hsvToHex, normalizeHex, type Hsv } from '../colors';
import { canFill } from '../geometry';
import { useStore } from '../store';

type Kind = 'line' | 'fill';
type Control = 'sv' | 'hue' | 'hex';

// Chrome and Edge can pick a color from anywhere on screen; not in TypeScript's DOM lib yet.
declare global {
  interface Window {
    EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> };
  }
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

/**
 * Any color for the line or fill: a saturation/brightness square, a hue strip and a hex field, all
 * applied live to the selection (or to new shapes). The rows below put the color on a key (1–5)
 * or save it in the swatch fan. Each drag or edit is one undo step.
 */
export function ColorEditor({ kind, shown, onClose }: { kind: Kind; shown: string | null; onClose: () => void }) {
  const palette = useStore((s) => s.palette);
  const swatches = useStore((s) => s.swatches);
  const [hsv, setHsv] = useState<Hsv>(() => hexToHsv(shown ?? '#ffffff'));
  const hex = hsvToHex(hsv);
  const [text, setText] = useState(hex.toUpperCase()); // the hex field, which may hold a half-typed code
  const [flash, setFlash] = useState<number | null>(null); // the key that just got this color
// The control whose drag or edit already has its undo step. Keyed by control, so focus moving
  // between them (the square's blur fires after the strip's press) can't split one drag in two.
  const recorded = useRef<Control | null>(null);

  // Follow changes made elsewhere (another shape selected, a key pressed), but not our own.
  const [seen, setSeen] = useState(shown);
  if (shown !== seen) {
    setSeen(shown);
    if (shown && shown !== hex) {
      setHsv(hexToHsv(shown));
      setText(shown.toUpperCase());
    }
  }

  /** Paints with `color`: live (no history yet) during a drag or edit, else as one undo step. */
  const apply = (color: string, live: Control | null) => {
    const st = useStore.getState();
    if (!live) {
      if (kind === 'line') st.setColor(color);
      else st.setFill(color);
      return;
    }
    const targets = st.shapes.filter((s) => st.selectedIds.includes(s.id) && (kind === 'line' || canFill(s)));
    if (recorded.current !== live && targets.length > 0) {
      st.checkpoint();
      recorded.current = live;
    }
    st.paintLive(kind, color);
  };

  const pick = (next: Hsv, live: Control | null) => {
    setHsv(next);
    const h = hsvToHex(next);
    setText(h.toUpperCase());
    apply(h, live);
  };

  /** Pointer handlers for the square and the strip: a press jumps there, a drag follows. */
  const dragArea = (control: Control, read: (x: number, y: number) => Hsv) => {
    const at = (e: React.PointerEvent<HTMLDivElement>) => {
      const r = e.currentTarget.getBoundingClientRect();
      pick(read(clamp01((e.clientX - r.left) / r.width), clamp01((e.clientY - r.top) / r.height)), control);
    };
    return {
      onPointerDown: (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        recorded.current = null;
        at(e);
      },
      onPointerMove: (e: React.PointerEvent<HTMLDivElement>) => {
        if (e.currentTarget.hasPointerCapture(e.pointerId)) at(e);
      },
      onPointerUp: () => {
        recorded.current = null;
      },
    };
  };

  /** Arrow keys for the square and strip, so the editor works without a mouse. */
  const keys = (control: Control, step: (dx: number, dy: number, big: boolean) => Hsv) => (e: React.KeyboardEvent) => {
    const dx = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    const dy = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    pick(step(dx, dy, e.shiftKey), control); // a run of key presses on one control is one step
  };

  const eyeDropper = async () => {
    if (!window.EyeDropper) return;
    try {
      const { sRGBHex } = await new window.EyeDropper().open();
      const h = normalizeHex(sRGBHex);
      if (h) pick(hexToHsv(h), null);
    } catch {
      // Cancelled with Esc.
    }
  };

  const setKey = (slot: number) => {
    useStore.getState().setPaletteSlot(slot, hex);
    setFlash(slot);
    window.setTimeout(() => setFlash((f) => (f === slot ? null : f)), 600);
  };

  const saved = swatches.includes(hex);
  const isDefault = palette.every((c, i) => c === DEFAULT_PALETTE[i]);
  const title = kind === 'line' ? 'Line color' : 'Fill color';

  return (
    // Stops the picker's focus guard, so the hex field can take focus when clicked.
    <div className="color-editor" role="dialog" aria-label={title} onMouseDown={(e) => e.stopPropagation()}>
      <header className="ce-head">
        <span className={`ce-preview ${kind}`} style={{ '--swatch': hex } as React.CSSProperties} />
        <b>{title}</b>
        <button className="ce-close" onClick={onClose} aria-label="Close color editor" data-tip="Close (Esc)">
          <svg viewBox="0 0 20 20"><path d="M6 6 L14 14 M14 6 L6 14" /></svg>
        </button>
      </header>

      <div
        className="ce-sv"
        style={{ '--hue': `hsl(${hsv.h} 100% 50%)` } as React.CSSProperties}
        role="slider"
        tabIndex={0}
        aria-label="Saturation and brightness"
        aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
        onKeyDown={keys('sv', (dx, dy, big) => ({ ...hsv, s: clamp01(hsv.s + dx * (big ? 0.1 : 0.02)), v: clamp01(hsv.v - dy * (big ? 0.1 : 0.02)) }))}
        onBlur={() => recorded.current === 'sv' && (recorded.current = null)}
        {...dragArea('sv', (x, y) => ({ ...hsv, s: x, v: 1 - y }))}
      >
        <span className="ce-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }} />
      </div>
      <div
        className="ce-hue"
        role="slider"
        tabIndex={0}
        aria-label="Hue"
        aria-valuenow={Math.round(hsv.h)}
        aria-valuemin={0}
        aria-valuemax={360}
        onKeyDown={keys('hue', (dx, dy, big) => ({ ...hsv, h: (hsv.h + (dx - dy) * (big ? 10 : 2) + 360) % 360 }))}
        onBlur={() => recorded.current === 'hue' && (recorded.current = null)}
        {...dragArea('hue', (x) => ({ ...hsv, h: Math.min(x * 360, 359.9) }))}
      >
        <span className="ce-thumb" style={{ left: `${(hsv.h / 360) * 100}%`, background: `hsl(${hsv.h} 100% 50%)` }} />
      </div>

      <div className="ce-row">
        <input
          className="ce-hex"
          value={text}
          spellCheck={false}
          maxLength={7}
          aria-label="Hex color"
          onFocus={(e) => {
            recorded.current = null;
            e.currentTarget.select();
          }}
          onChange={(e) => {
            setText(e.target.value);
            const h = e.target.value.replace('#', '').length === 6 ? normalizeHex(e.target.value) : null;
            if (h) {
              setHsv(hexToHsv(h));
              apply(h, 'hex');
            }
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur();
          }}
          onBlur={() => {
            if (recorded.current === 'hex') recorded.current = null;
            setText(hex.toUpperCase());
          }}
        />
        {window.EyeDropper && (
          <button className="ce-icon" onClick={eyeDropper} aria-label="Pick a color from the screen" data-tip="Pick a color from the screen">
            <svg viewBox="0 0 20 20">
              <path d="M12.5 4.2 a1.9 1.9 0 0 1 2.7 0 l0.6 0.6 a1.9 1.9 0 0 1 0 2.7 L13.6 9.7 L10.3 6.4 Z M11.4 7.5 L5 13.9 L4.3 15.7 L6.1 15 L12.5 8.6" />
            </svg>
          </button>
        )}
      </div>

      <div className="ce-label">
        Put on a key
        {!isDefault && (
          <button className="ce-reset" onClick={() => useStore.getState().resetPalette()} data-tip="Put the original five colors back on keys 1–5">
            Reset
          </button>
        )}
      </div>
      <div className="ce-swatches">
        {palette.map((c, i) => (
          <button
            key={i}
            className={`ce-swatch ${flash === i ? 'flash' : ''} ${c === hex ? 'same' : ''}`}
            style={{ '--swatch': c } as React.CSSProperties}
            onClick={() => setKey(i)}
            aria-label={`Put this color on key ${i + 1} (now ${colorLabel(c)})`}
            data-tip={c === hex ? `Key ${i + 1} already has this color` : `Put this color on key ${i + 1} (replaces ${colorLabel(c)})`}
          >
            <span className="ce-key">{i + 1}</span>
          </button>
        ))}
      </div>

      <div className="ce-label">Saved colors</div>
      <div className="ce-swatches">
        <button
          className="ce-swatch ce-save"
          onClick={() => useStore.getState().saveSwatch(hex)}
          disabled={saved}
          aria-label="Save this color"
          data-tip={saved ? 'Already saved' : swatches.length >= MAX_SWATCHES ? 'Save this color (replaces the oldest)' : 'Save this color'}
        >
          <svg viewBox="0 0 20 20"><path d="M10 5 V15 M5 10 H15" /></svg>
        </button>
        {swatches.map((c) => (
          <span key={c} className="ce-saved">
            <button
              className={`ce-swatch ${c === hex ? 'same' : ''}`}
              style={{ '--swatch': c } as React.CSSProperties}
              onClick={() => pick(hexToHsv(c), null)}
              aria-label={`Use ${c.toUpperCase()}`}
              data-tip={`Use ${c.toUpperCase()}`}
            />
            <button className="ce-remove" onClick={() => useStore.getState().removeSwatch(c)} aria-label={`Remove ${c.toUpperCase()}`} data-tip="Remove">
              ×
            </button>
          </span>
        ))}
      </div>
    </div>
  );
}
