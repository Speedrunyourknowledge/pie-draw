import { useStore, type Tool } from '../store';
import { kbd } from '../platform';
import { resetZoom, zoomIn, zoomOut } from '../view';

/** Tool and navigation cluster: select, hand (pan) and eraser tools, then zoom, stacked in the lower right. */
export function NavControls() {
  const zoom = useStore((s) => s.view.zoom);
  const tool = useStore((s) => s.tool);
  const setTool = useStore((s) => s.setTool);
  const toggle = (t: Tool) => setTool(tool === t ? 'draw' : t);
  return (
    // Keep mouse clicks from focusing the buttons; otherwise a later key press (Escape, H, E)
    // makes the browser show its focus ring on whichever button was last clicked.
    <div className="nav" role="toolbar" aria-label="Tools" onMouseDown={(e) => e.preventDefault()}>
      <button
        className={tool === 'select' ? 'on' : ''}
        onClick={() => toggle('select')}
        aria-pressed={tool === 'select'}
        title="Select tool: drag a box to select every shape it touches (V). Or Shift-drag"
        aria-label="Select tool"
      >
        <svg viewBox="0 0 20 20">
          <path d="M3 3 H12 V7 M3 3 V12 H7" strokeDasharray="2 2.2" />
          <path d="M9.5 9.5 L17 12.3 L13.6 13.6 L12.3 17 Z" className="solid" />
        </svg>
      </button>
      <button
        className={tool === 'hand' ? 'on' : ''}
        onClick={() => toggle('hand')}
        aria-pressed={tool === 'hand'}
        title="Hand tool: drag to pan (H). Or hold the scroll wheel / Space and drag"
        aria-label="Hand tool"
      >
        <svg viewBox="0 0 20 20">
          <path d="M7 10.5 V4.8 a1.2 1.2 0 0 1 2.4 0 V9.5 M9.4 9 V3.6 a1.2 1.2 0 0 1 2.4 0 V9.5 M11.8 9 V4.6 a1.2 1.2 0 0 1 2.4 0 V10 M14.2 9.3 V7 a1.2 1.2 0 0 1 2.4 0 V12 a6 6 0 0 1 -6 6 h-.6 a5.5 5.5 0 0 1 -4.3 -2.1 L3.4 13 a1.3 1.3 0 0 1 2 -1.6 L7 13" />
        </svg>
      </button>
      <button
        className={tool === 'eraser' ? 'on' : ''}
        onClick={() => toggle('eraser')}
        aria-pressed={tool === 'eraser'}
        title="Eraser: click or drag across shapes to erase them (E)"
        aria-label="Eraser"
      >
        <svg viewBox="0 0 20 20">
          <path d="M8.2 16.5 L3.6 11.9 a1.4 1.4 0 0 1 0 -2 L10.4 3.1 a1.4 1.4 0 0 1 2 0 L16.9 7.6 a1.4 1.4 0 0 1 0 2 L10 16.5 Z M6.6 8.3 L11.7 13.4 M8.2 16.5 H16.5" />
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
