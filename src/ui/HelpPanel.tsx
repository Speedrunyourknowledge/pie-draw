import { PieMenuPreview } from '../interaction/PieMenuPreview';
import { MENU_PREVIEWS } from '../interaction/pieMenuConfig';
import { isMac, kbd } from '../platform';
import { useStore } from '../store';

const Key = ({ children }: { children: string }) => <b className="key">{children}</b>;

const KEYS: [string, string][] = [
  [kbd('mod+z'), 'Undo'],
  [`${kbd('mod+shift+z')}  or  ${kbd('mod+y')}`, 'Redo'],
  [`${kbd('mod+x')} / ${kbd('mod+c')} / ${kbd('mod+v')}`, 'Cut / copy / paste'],
  ['Delete', 'Delete selected shapes'],
  ['M', 'Open / close the menu'],
  ['Tab  /  Shift+Tab', 'Select the next / previous shape'],
  [kbd('mod+a'), 'Select all shapes'],
  ['1 – 5', 'Line color'],
  ['Shift+1 – 5  /  Shift+6', 'Fill color / no fill'],
  ['Arrow keys', 'Nudge selection, or pan when nothing is selected'],
  ['R  /  Shift+R', 'Rotate selection 90° clockwise / counterclockwise'],
  ['V', 'Select tool on / off'],
  ['H', 'Hand tool on / off'],
  ['E', 'Eraser tool on / off'],
  ['G', 'Gestures on / off'],
  ['+  /  −', 'Zoom in / out'],
  ['0', 'Zoom to 100%'],
  ['F', 'Fit all shapes on screen'],
  [`${kbd('mod+s')}  /  ${kbd('mod+shift+s')}`, 'Save / Save as'],
  [kbd('mod+o'), 'Open'],
  [kbd('mod+alt+n'), 'New document'],
  ['Enter', 'Place a shape at a default size'],
  ['Esc', 'Close menu or deselect'],
  ['/', 'Open the assistant'],
  ['?', 'Show Help menu'],
];

export function HelpPanel() {
  const open = useStore((s) => s.helpOpen);
  const swapped = useStore((s) => s.panelSwapped);
  const close = () => useStore.getState().setHelpOpen(false);
  if (!open) return null;

  return (
    <div className={`help-backdrop${swapped ? ' swapped' : ''}`} onPointerDown={close}>
      <div className="help" role="dialog" aria-label="Help" onPointerDown={(e) => e.stopPropagation()}>
        <header className="help-head">
          <h2>How to Use Pie Draw</h2>
          <button className="help-close" onClick={close} aria-label="Close help">
            <svg viewBox="0 0 20 20"><path d="M5 5 L15 15 M15 5 L5 15" /></svg>
          </button>
        </header>

        <section>
          <h3>Menu and Options</h3>
          <p>
            <b>Right-click</b> or <b>left-press-and-hold</b> anywhere to open the menu or press <Key>M</Key>.
            The type of menu depends on what you have selected:
          </p>
          <div className="mini-pies">
            {MENU_PREVIEWS.map(({ id, items, caption }) => (
              <figure className="mini-pie" key={id}>
                <PieMenuPreview items={items} />
                <figcaption>{caption}</figcaption>
              </figure>
            ))}
          </div>
          <ul className="help-list">
            <li><b>Choose</b> an option by clicking it or dragging toward it and releasing.</li>
            <li><b>Keyboard:</b> <Key>M</Key> opens the menu. With the menu open, use <Key>←</Key> <Key>→</Key> to move around the ring. To enter a submenu, use <Key>↑</Key>. To leave it, use <Key>↓</Key>. Press <Key>Enter</Key> to choose an option.</li>
            <li><b>Cancel</b> by selecting the red X in the center, or by moving past the menu's edge. Esc works too.</li>
            <li>The <b>File</b> menu at the top allows you to save and open your drawings.</li>
            <li>
              <b>Assistant:</b> Click <b>Assistant</b> in the top bar (or press <Key>/</Key>) to interact with an AI assistant.
              After typing, <b>point with the mouse</b> to indicate “here” or “this” (the shape “this” means glows blue), then press <b>Enter</b>.
            </li>
            <li>
              <b>Gestures:</b> With Gestures on (top bar, or <Key>G</Key>), single strokes create shapes, select, copy, paste, set colors and delete.{' '}
              <button className="help-link" onClick={() => useStore.getState().setGestureGuideOpen(true)}>See all gestures →</button>
            </li>
          </ul>
        </section>

        <div className="help-cols">
          <section>
            <h3>Draw and Edit</h3>
            <ul className="help-list">
              <li><b>Choose a shape from the menu</b> and the pointer becomes a crosshair showing that shape. <b>Drag</b> to draw it (Shift keeps the sides equal), or <b>click</b> to place it at a default size. For triangles, drag to draw one side, then click to place the third corner.</li>
              <li><b>Click and drag on empty space</b> to sketch. Sketch a shape and a faded preview will appear if the shape is recognized.</li>
              <li><b>Start sketching then hold Shift</b> to get a straight line.</li>
              <li><b>Straight lines snap together.</b> Drag a selected line's endpoints to stretch it. Line endpoints snap to each other and to shape corners.</li>
              <li><b>Click</b> a shape to select it, then <b>drag</b> to move it.</li>
              <li><b>Drag a corner or edge</b> of the selection box to scale (Shift keeps proportions), or <b>pinch</b> on a trackpad.</li>
              <li><b>Drag the round handle</b> above the selection box to rotate. It snaps to 45° increments. <b>Double-click</b> it to stand the shape upright again.</li>
            </ul>
            <h3>Select Several Shapes</h3>
            <ul className="help-list">
              <li><b>{kbd('mod')}-click</b> (or <b>Shift-click</b>) shapes to add or remove them one at a time.</li>
              <li><b>Shift-drag</b> a box, or turn on the <b>select tool</b> (lower right, or <Key>V</Key>) and drag. Every shape the box touches is selected when you let go.</li>
              <li>The selected shapes then act as one object: <b>drag anywhere inside the box</b> to move them all, <b>right-click or left-press-and-hold inside it</b> for the menu, and drag its corners or edges to scale them together.</li>
            </ul>
            <h3>Color</h3>
            <ul className="help-list">
              <li>Two swatches in the lower right: <b>Line</b> and <b>Fill</b>. They show the selected shape's colors, or what new shapes will get.</li>
              <li><b>Drag a color onto any shape</b> to paint it directly. Lines only have a line color.</li>
              <li>The <b>rainbow +</b> opens a color editor, where you can choose and save additional colors.</li>
              <li>Saved colors can be dragged onto a <b>numbered swatch</b>, and numbered swatches can be swapped with each other.</li>
            </ul>
            <h3>Move Around</h3>
            <ul className="help-list">
              <li><b>Hold the scroll wheel and drag</b> to pan the canvas.</li>
              <li>No scroll wheel? Use the <b>hand tool</b> (lower right, or <Key>H</Key>), or hold <Key>Space</Key> and drag.</li>
              <li><b>Scroll</b> or two-finger swipe also pans.</li>
              <li><b>Pinch</b> or <Key>Ctrl+scroll</Key> zooms (when nothing is selected). Zoom buttons are in the lower right.</li>
            </ul>
          </section>
          <section>
            <h3>Keyboard</h3>
            <table className="keys">
              <tbody>
                {KEYS.map(([k, what]) => (
                  <tr key={what}>
                    <td><Key>{k}</Key></td>
                    <td>{what}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>
        {isMac && (
          <footer className="help-foot">
            On macOS, Ctrl works the same as Cmd for shortcuts. Exception: Ctrl-click is always a right-click.
          </footer>
        )}
      </div>
    </div>
  );
}
