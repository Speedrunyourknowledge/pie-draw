import { useEffect, useRef, useState, type ReactNode } from 'react';
import { newDoc, openDoc, saveDoc } from '../file/fileOps';
import { kbd } from '../platform';

const CLOSE_DELAY = 250; // ms of grace so the pointer can cross the gap between button and list

interface Item {
  label: string;
  keys: string;
  icon: ReactNode;
  run: () => void;
}

const ITEMS: Item[] = [
  {
    label: 'New',
    keys: kbd('mod+alt+n'),
    icon: <path d="M-6 -8 h8 l4 4 v12 h-12z M2 -8 v4 h4 M0 -1 v6 M-3 2 h6" />,
    run: () => newDoc(),
  },
  {
    label: 'Open…',
    keys: kbd('mod+o'),
    icon: <path d="M-8 6 v-12 h5 l2 2 h8 v3 M-8 6 l3 -8 h12 l-3 8z" />,
    run: () => void openDoc(),
  },
  {
    label: 'Save',
    keys: kbd('mod+s'),
    icon: (
      <>
        <path d="M-7 -7 h11 l3 3 v11 h-14z" />
        <rect x={-4} y={1} width={8} height={6} />
      </>
    ),
    run: () => void saveDoc(),
  },
  {
    label: 'Save As…',
    keys: kbd('mod+shift+s'),
    icon: (
      <>
        <path d="M-7 -7 h11 l3 3 v11 h-14z" />
        <path d="M-3 3 l5 -5 l2 2 l-5 5 h-2z" />
      </>
    ),
    run: () => void saveDoc(true),
  },
];

/**
 * Document commands, which are used rarely, so they live in a conventional menu in the top bar
 * rather than taking a direction in the pie menu. Opens on hover, or on click for touch and keyboard.
 */
export function FileMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const closeTimer = useRef<number | undefined>(undefined);

  const show = () => {
    window.clearTimeout(closeTimer.current);
    setOpen(true);
  };
  const hideSoon = () => {
    window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setOpen(false), CLOSE_DELAY);
  };

  useEffect(() => () => window.clearTimeout(closeTimer.current), []);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        e.stopImmediatePropagation(); // don't also deselect or leave a tool
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey, true);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  return (
    <div
      className="file-menu"
      ref={rootRef}
      onPointerEnter={(e) => e.pointerType === 'mouse' && show()}
      onPointerLeave={(e) => e.pointerType === 'mouse' && hideSoon()}
      // Mouse clicks don't focus the buttons, so a later key press doesn't leave a focus ring behind.
      onMouseDown={(e) => e.preventDefault()}
    >
      <button
        className={`file-btn${open ? ' open' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => (open ? setOpen(false) : show())}
      >
        File
        <svg viewBox="0 0 20 20" className="caret" aria-hidden>
          <path d="M6 8 L10 12 L14 8" />
        </svg>
      </button>
      {open && (
        <div className="file-list" role="menu" aria-label="File">
          {ITEMS.map((item) => (
            <button
              key={item.label}
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.run();
              }}
            >
              <svg viewBox="-10 -10 20 20" aria-hidden>{item.icon}</svg>
              <span className="file-label">{item.label}</span>
              <span className="file-keys">{item.keys}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
