import { useStore } from '../store';
import { kbd } from '../platform';
import { resetZoom, zoomIn, zoomOut } from '../view';

/** Navigation cluster: hand (pan) tool and zoom, stacked in the lower right. */
export function NavControls() {
  const zoom = useStore((s) => s.view.zoom);
  const hand = useStore((s) => s.handTool);
  const setHand = useStore((s) => s.setHandTool);
  return (
    <div className="nav" role="toolbar" aria-label="Navigation">
      <button
        className={hand ? 'on' : ''}
        onClick={() => setHand(!hand)}
        aria-pressed={hand}
        title="Hand tool: drag to pan (H). Or hold the scroll wheel / Space and drag"
        aria-label="Hand tool"
      >
        <svg viewBox="0 0 20 20">
          <path d="M7 10.5 V4.8 a1.2 1.2 0 0 1 2.4 0 V9.5 M9.4 9 V3.6 a1.2 1.2 0 0 1 2.4 0 V9.5 M11.8 9 V4.6 a1.2 1.2 0 0 1 2.4 0 V10 M14.2 9.3 V7 a1.2 1.2 0 0 1 2.4 0 V12 a6 6 0 0 1 -6 6 h-.6 a5.5 5.5 0 0 1 -4.3 -2.1 L3.4 13 a1.3 1.3 0 0 1 2 -1.6 L7 13" />
        </svg>
      </button>
      <button onClick={zoomIn} title={`Zoom in (+ or ${kbd('mod+=')})`} aria-label="Zoom in">
        <svg viewBox="0 0 20 20"><path d="M10 5 V15 M5 10 H15" /></svg>
      </button>
      <button className="zoom-level" onClick={resetZoom} title="Reset to 100% (0)">
        {Math.round(zoom * 100)}%
      </button>
      <button onClick={zoomOut} title={`Zoom out (− or ${kbd('mod+-')})`} aria-label="Zoom out">
        <svg viewBox="0 0 20 20"><path d="M5 10 H15" /></svg>
      </button>
    </div>
  );
}
