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
  ['Shift+1 – 5  /  Shift+0', 'Fill color'],
  ['Arrow keys', 'Nudge selection, or pan when nothing is selected'],
  ['V', 'Select tool on / off'],
  ['H', 'Hand tool on / off'],
  ['E', 'Eraser tool on / off'],
  ['+  /  −', 'Zoom in / out'],
  ['0', 'Zoom to 100%'],
  ['F', 'Fit all shapes on screen'],
  [`${kbd('mod+s')}  /  ${kbd('mod+shift+s')}`, 'Save / Save as'],
  [kbd('mod+o'), 'Open'],
  [kbd('mod+alt+n'), 'New document'],
  ['Esc', 'Close menu or deselect'],
  ['?', 'Show Help menu'],
];

export function HelpPanel() {
  const open = useStore((s) => s.helpOpen);
  const close = () => useStore.getState().setHelpOpen(false);
  if (!open) return null;

  return (
    <div className="help-backdrop" onPointerDown={close}>
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
          </ul>
        </section>

        <div className="help-cols">
          <section>
            <h3>Draw and Edit</h3>
            <ul className="help-list">
              <li><b>Click and drag on empty space</b> to sketch. Sketch a shape and a faded preview will appear if the shape is recognized.</li>
              <li><b>Click</b> a shape to select it, then <b>drag</b> to move it.</li>
              <li><b>Drag a corner or edge</b> of the selection box to scale (Shift keeps proportions), or <b>pinch</b> on a trackpad.</li>
            </ul>
            <h3>Select Several Shapes</h3>
            <ul className="help-list">
              <li><b>{kbd('mod')}-click</b> (or <b>Shift-click</b>) shapes to add or remove them one at a time.</li>
              <li><b>Shift-drag</b> a box, or turn on the <b>select tool</b> (lower right, or <Key>V</Key>) and drag. Every shape the box touches is selected when you let go.</li>
              <li>The selected shapes then act as one object: <b>drag anywhere inside the box</b> to move them all, <b>right-click or left-press-and-hold inside it</b> for the menu, and drag its corners or edges to scale them together.</li>
            </ul>
            <h3>Color</h3>
            <ul className="help-list">
              <li>Two swatches in the lower right: <b>Line</b> (the ring) and <b>Fill</b> (the disc; a red slash means no fill). They show the selected shape's colors, or what new shapes will get.</li>
              <li><b>Click one</b> to fan out the colors, then click one. Keys <Key>1</Key>–<Key>5</Key> set the line, <Key>Shift</Key>+<Key>1</Key>–<Key>5</Key> the fill, <Key>Shift</Key>+<Key>0</Key> removes it.</li>
              <li><b>Drag a swatch onto any shape</b> to paint it directly. Freehand lines have a line color only.</li>
            </ul>
            <h3>Move Around</h3>
            <ul className="help-list">
              <li><b>Hold the scroll wheel (middle button) and drag</b> to pan the canvas.</li>
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
