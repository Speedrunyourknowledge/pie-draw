import { PieMenu } from '../interaction/PieMenu';
import { NO_SELECTION } from '../interaction/pieGeometry';
import { CANVAS_MENU, SHAPE_MENU, type PieItem } from '../interaction/pieMenuConfig';
import { isMac, kbd, rightClick } from '../platform';
import { useStore } from '../store';

function MiniPie({ items, caption }: { items: PieItem[]; caption: string }) {
  return (
    <figure className="mini-pie">
      <svg viewBox="-112 -112 224 224">
        <PieMenu items={items} origin={[0, 0]} pointer={[0, 0]} selection={NO_SELECTION} />
      </svg>
      <figcaption>{caption}</figcaption>
    </figure>
  );
}

const Key = ({ children }: { children: string }) => <b className="key">{children}</b>;

const KEYS: [string, string][] = [
  [kbd('mod+z'), 'Undo'],
  [`${kbd('mod+shift+z')}  or  ${kbd('mod+y')}`, 'Redo'],
  [`${kbd('mod+x')} / ${kbd('mod+c')} / ${kbd('mod+v')}`, 'Cut / copy / paste'],
  ['Delete', 'Delete selected shape'],
  ['1 – 5', 'Line color (of the selection, or for new shapes)'],
  ['Shift+1 – 5  /  Shift+0', 'Fill color / no fill'],
  ['Arrow keys', 'Nudge selection (with Shift: 10 px), or pan when nothing is selected'],
  ['H', 'Hand tool on / off'],
  ['E', 'Eraser on / off (click or drag across shapes to erase them)'],
  ['+  /  −', 'Zoom in / out'],
  ['0', 'Zoom to 100%'],
  ['F', 'Fit all shapes on screen'],
  [`${kbd('mod+s')}  /  ${kbd('mod+shift+s')}`, 'Save / Save as'],
  [kbd('mod+o'), 'Open'],
  [kbd('mod+alt+n'), 'New drawing'],
  ['Esc', 'Close menu, leave hand tool or eraser, deselect'],
  ['?', 'Show this help'],
];

export function HelpPanel() {
  const open = useStore((s) => s.helpOpen);
  const close = () => useStore.getState().setHelpOpen(false);
  if (!open) return null;

  return (
    <div className="help-backdrop" onPointerDown={close}>
      <div className="help" role="dialog" aria-label="Help" onPointerDown={(e) => e.stopPropagation()}>
        <header className="help-head">
          <h2>How to use Pie Draw</h2>
          <button className="help-close" onClick={close} aria-label="Close help">
            <svg viewBox="0 0 20 20"><path d="M5 5 L15 15 M15 5 L5 15" /></svg>
          </button>
        </header>

        <section>
          <h3>Everything starts at your pointer</h3>
          <p>
            There is no toolbar. <b>{rightClick}</b> or <b>press and hold</b> anywhere to open a menu
            right where you are. What it offers depends on what is underneath:
          </p>
          <div className="mini-pies">
            <MiniPie items={CANVAS_MENU} caption="On empty canvas" />
            <MiniPie items={SHAPE_MENU} caption="On a shape" />
          </div>
          <ul className="help-list">
            <li><b>Choose</b> by dragging toward a wedge and releasing.</li>
            <li><b>Submenus</b> (File, Line, Fill): keep dragging outward into the outer ring, then sideways to the item, all in one stroke.</li>
            <li><b>Cancel</b> by releasing on the red × in the center, <b>or by dragging past the menu's edge</b> and releasing. Esc works too.</li>
            <li>A quick right-click keeps the menu open, so you can click an item instead.</li>
          </ul>
        </section>

        <div className="help-cols">
          <section>
            <h3>Draw &amp; edit</h3>
            <ul className="help-list">
              <li><b>Click and drag on empty space</b> to sketch. Close a rough square, circle or triangle and a faded preview shows what it will snap to; release to accept.</li>
              <li><b>Click</b> a shape to select it, then <b>drag</b> to move it.</li>
              <li><b>Corner handles</b> scale (Shift keeps proportions), or <b>pinch</b> on a trackpad.</li>
            </ul>
            <h3>Color</h3>
            <ul className="help-list">
              <li>Two swatches in the lower right: <b>Line</b> (the ring) and <b>Fill</b> (the disc; a red slash means no fill). They show the selected shape's colors, or what new shapes will get.</li>
              <li><b>Click one</b> to fan out the colors, then click one. Keys <Key>1</Key>–<Key>5</Key> set the line, <Key>Shift</Key>+<Key>1</Key>–<Key>5</Key> the fill, <Key>Shift</Key>+<Key>0</Key> removes it.</li>
              <li><b>Drag a swatch onto any shape</b> to paint it directly. Freehand lines have a line color only.</li>
            </ul>
            <h3>Move around</h3>
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
            {isMac && <p className="help-note">On a Mac, Ctrl works the same as Cmd.</p>}
          </section>
        </div>
        <footer className="help-foot">Press <Key>?</Key> anytime · <Key>Esc</Key> to close</footer>
      </div>
    </div>
  );
}
