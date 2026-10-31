import { useEffect, useRef, useState } from 'react';

/** How long the pointer rests on a control before its tooltip shows. The same every time, unlike native `title` tooltips. */
const DELAY_MS = 400;
const GAP = 8;
const MARGIN = 6;

type Side = 'below' | 'left' | 'right';
type Tip = { text: string; x: number; y: number; side: Side };

/**
 * One shared tooltip for every element with a `data-tip` attribute. Put `data-tip-side="left"` or `"right"` on an
 * element to show its tooltip there (default: below).
 */
export function Tooltip() {
  const [tip, setTip] = useState<Tip | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let target: HTMLElement | null = null;
    let timer = 0;

    const hide = () => {
      window.clearTimeout(timer);
      target = null;
      setTip(null);
    };
    const show = (el: HTMLElement) => {
      const text = el.dataset.tip;
      if (!text || !el.isConnected) return;
      const r = el.getBoundingClientRect();
      const side: Side = el.dataset.tipSide === 'left' || el.dataset.tipSide === 'right' ? el.dataset.tipSide : 'below';
      setTip(side === 'left' ? { text, side, x: r.left - GAP, y: r.top + r.height / 2 }
        : side === 'right' ? { text, side, x: r.right + GAP, y: r.top + r.height / 2 }
        : { text, side, x: r.left + r.width / 2, y: r.bottom + GAP });
    };

    // Looks under the pointer instead of using the event target, because disabled buttons may not receive pointer events.
    const onMove = (e: PointerEvent) => {
      if (e.pointerType === 'touch') return;
      // No tooltips mid-drag (e.g. dragging a color swatch across the fan or onto a shape).
      if (e.buttons !== 0) return hide();
      const under = document.elementFromPoint(e.clientX, e.clientY);
      const el = under instanceof Element ? under.closest<HTMLElement>('[data-tip]') : null;
      if (el === target) return;
      hide();
      if (!el) return;
      target = el;
      timer = window.setTimeout(() => show(el), DELAY_MS);
    };
    // Clicking or typing dismisses it, as native tooltips do; it comes back only after the pointer leaves and returns.
    const dismiss = () => {
      window.clearTimeout(timer);
      setTip(null);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', dismiss, true);
    window.addEventListener('keydown', dismiss, true);
    window.addEventListener('blur', hide);
    document.documentElement.addEventListener('pointerleave', hide);
    return () => {
      window.clearTimeout(timer);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', dismiss, true);
      window.removeEventListener('keydown', dismiss, true);
      window.removeEventListener('blur', hide);
      document.documentElement.removeEventListener('pointerleave', hide);
    };
  }, []);

  // Keep it on screen: nudge sideways if a below-tooltip would run past the window edge.
  const [shift, setShift] = useState(0);
  useEffect(() => {
    if (!tip || tip.side !== 'below' || !ref.current) return setShift(0);
    const r = ref.current.getBoundingClientRect();
    const half = r.width / 2;
    const left = tip.x - half;
    const right = tip.x + half;
    setShift(left < MARGIN ? MARGIN - left : right > window.innerWidth - MARGIN ? window.innerWidth - MARGIN - right : 0);
  }, [tip]);

  if (!tip) return null;
  const transform = tip.side === 'left' ? 'translate(-100%, -50%)'
    : tip.side === 'right' ? 'translate(0, -50%)'
    : `translate(calc(-50% + ${shift}px), 0)`;
  return (
    <div ref={ref} className="tooltip" role="tooltip" style={{ left: tip.x, top: tip.y, transform }}>
      {tip.text}
    </div>
  );
}
