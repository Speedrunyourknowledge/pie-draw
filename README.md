# Pie Draw

A browser-based 2D **drawing** (vector, object-oriented) app with no tool palette. Every command comes from a context-aware **pie / marking menu** that opens at the pointer. Shapes are edited by **direct manipulation**, and **freehand strokes are recognized live**: a faded ghost of the recognized shape appears behind your ink while you draw.

Freehand strokes are stored as vector path objects that can be selected and transformed as units; there is no pixel-level editing.

## Running it

```bash
npm install
npm run dev      # open the printed localhost URL in Chrome
npm run build    # type-check + production build
```

Use **Chrome (or Edge)** on **macOS or Windows** (Linux and ChromeOS work too). File dialogs use the File System Access API, which only Chromium browsers support.

**Cross-platform keys:** on Windows and Linux shortcuts use Ctrl (Ctrl+Z, Ctrl+Shift+Z or Ctrl+Y, …). On a Mac, **Cmd and Ctrl are interchangeable**, so either Cmd+Z or Ctrl+Z undoes. Shortcuts shown in the app (help panel, tooltips, messages) are spelled out in plain words for your platform ("Cmd+Shift+Z" on a Mac, "Ctrl+Shift+Z" on Windows). Control-click still opens the menu on a Mac (its usual right-click); on Windows it stays a normal click.

## How to use it

| Action | How |
| --- | --- |
| Open the menu | **Right-click** (two-finger click on a Mac trackpad), or **press and hold** ~300 ms without moving |
| Choose a command | Drag toward a wedge and release. Inside the menu only the direction matters |
| Submenus (Line, Fill, File) | Keep dragging outward past the wedge into the outer ring, then sideways to the item: one continuous stroke |
| Click mode | A quick right-click leaves the menu open. Hover a wedge and click it; click the center or outside to dismiss |
| Cancel | Release on the red **×** in the center, **or drag past the menu's edge** (a faint ring, which turns red) and release, or press **Esc** |
| Create a shape | Empty-canvas menu → Square / Rectangle / Circle / Ellipse / Triangle. The shape appears centered where you opened the menu, already selected |
| Draw | Click and drag on empty canvas. Bring the stroke back near its start (the ends needn't touch) and a ghost previews the snap; release to commit |
| Select / move | Click a shape; drag it. Click empty canvas to deselect |
| Scale | Drag a corner handle (**Shift** keeps proportions; squares and circles always do), or **pinch** on the trackpad |
| Shape commands | Right-click / hold on a shape: Line, Copy, Cut, Delete, To Front, To Back, Fill (closed shapes only) |
| Color | Two swatches at the lower right: **Line** (a ring) and **Fill** (a disc; white with a red slash = no fill). Each shows the selected shape's color, or what new shapes will get. **Click** one to fan out the colors and pick; **drag** it, or a fanned swatch, onto a shape to paint that shape. Keys 1–5 set the line, Shift+1–5 the fill, Shift+0 removes the fill |
| Undo / redo | Keyboard, or the Undo / Redo buttons in the top bar |
| Pan | **Hold the scroll wheel (middle button) and drag**. Without a wheel: the **hand tool** (lower right, or **H**), or hold **Space** and drag. Scroll / two-finger swipe and arrow keys (with nothing selected) also pan |
| Zoom | Pinch or Ctrl+wheel (with nothing selected; with a shape selected, pinch scales the shape), **+ / −** keys or buttons (lower right). **0** or clicking the % resets to 100%, **F** fits all shapes |
| Help | **?** key or the Help button: gestures, both menu layouts, all shortcuts |

**Keyboard** (Mod = Cmd or Ctrl on a Mac, Ctrl on Windows/Linux):

| Keys | Action |
| --- | --- |
| Mod+Z | Undo |
| Mod+Shift+Z, Mod+Y | Redo |
| Mod+X / C / V | Cut / copy / paste |
| Delete or Backspace | Delete selected shape |
| 1–5 | Line color (selection, or new shapes) |
| Shift+1–5 / Shift+0 | Fill color / no fill |
| Arrows | Nudge selection (Shift: 10 px), or pan when nothing is selected |
| + / − (or Mod+= / Mod+−) | Zoom in / out |
| 0 (or Mod+0) | Zoom to 100% |
| F | Fit all shapes |
| H | Hand tool on / off |
| E | Eraser on / off (click or drag across shapes to erase them) |
| Mod+S / Mod+Shift+S | Save / Save as |
| Mod+O | Open |
| Mod+Alt+N | New (Chrome reserves Mod+N for a new window) |
| Esc | Close help, color fan or menu, leave the hand tool or eraser, deselect |
| ? | Help |

### Menu layouts

Fixed layouts, so each command always lives in the same direction (clockwise from north):

- **Empty canvas (8):** Square, Rectangle, Circle, Ellipse, Triangle, Line (line color for new shapes), Fill (fill for new shapes, or None), File (New, Open, Save, Save As); clockwise from ↑
- **On a shape (7):** Line ↑ (5 swatches), Copy, To Front, Delete, To Back, Cut, Fill ↖ (5 swatches + None). Freehand lines get the same menu without Fill

## Requirements

| # | Requirement | Where |
| --- | --- | --- |
| 1 | Create squares, rectangles, circles, ellipses, triangles | Empty-canvas pie menu: explicit and deterministic, never dependent on recognition |
| 2 | Select, translate, scale | Click to select, drag to move, corner handles or pinch to scale |
| 3 | Cut, copy, paste | Shape menu (Cut, Copy), Paste button in the top bar (enabled once something is copied), Mod+X/C/V. Paste offsets 20 px from the copy and cascades |
| 4 | 5 drawing colors | Line and Fill swatches (click to pick, or drag onto a shape), shape/canvas menu → Line / Fill submenus, or keys 1–5 / Shift+1–5. The chosen colors also become the line and fill for new shapes |
| 5 | New, open, save | Canvas menu → File submenu, or Mod+Alt+N / Mod+O / Mod+S; native file dialogs. Saved as `{ "version": 1, "shapes": [...] }` JSON and validated on open |
| 6 | Delete | Shape menu → Delete, or Delete/Backspace |

**Drawing, not painting.** The document is a list of shape objects rendered as SVG elements; nothing is ever rasterized. Each freehand stroke becomes one `freehand` path object that can be selected, moved, scaled, recolored, copied and deleted like any primitive. Files store shapes, never images.

## Design decisions

| Technique | Problem with the conventional UI | How this design addresses it | Tradeoff |
| --- | --- | --- | --- |
| **Pie menu at the pointer** | A toolbar sits at the screen edge. Every command is a round trip of eye and hand away from the work, and its small buttons are hard targets (Fitts' law) | The menu opens where you are. Every item is the same short distance away, and wedges widen with distance, so targets get bigger the farther you move | Less discoverable on first use, so a first-run hint explains how to open it. Covers part of the canvas while open |
| **Direction-based selection** | Linear menus are chosen by reading a list, and moving the cursor *past* an item selects the wrong one. Experts must switch to a different mechanism (shortcuts) to get faster | Between the dead zone and the menu's edge only the angle counts, so each wedge is a wide, easy target. Beginners drag slowly and read the labels; with practice the same motion becomes a quick flick made from memory, so learning the slow way turns into the fast way with no separate shortcuts to memorize | About 8 items per ring before wedges get too narrow; deeper commands need a two-part stroke |
| **Two ways out: × and the edge** | A menu that commits to whatever direction you leave in gives no way to back out mid-gesture | Releasing on the red center × or anywhere beyond the menu's faint outer ring cancels. The ring turns red and the × lights up while a release would cancel, so you see it before you let go | Unlike a classic marking menu, targets aren't infinitely deep; the edge (~120 px from the center, ~185 px on a submenu wedge so its outer ring stays reachable) is still far larger than any toolbar button. The menu always appears immediately, even for fast flicks, so a gesture is never mistaken for drawing |
| **Context-aware contents** | One global toolbar shows every command whether or not it applies, and the user must first select a tool mode | The menu shows what applies to what is under the pointer: shape commands on a shape, creation and file commands on empty canvas. No disabled items, no mode to track | The same direction means different commands in the two contexts (e.g. ↑ is Square on canvas, Line on a shape) |
| **No tool palette** | Toolbars and property panels take canvas space and introduce a persistent "current tool" mode the user must remember | Nearly the full window is canvas. Dragging always means "move" on a shape and "draw" on empty space, so there is no tool mode. The thin top bar holds only app identity and document-level commands (Paste, Undo, Redo, Clear all, Help), never tools | Commands are hidden until invoked; the help panel and status line make up for it. The hand tool (for people without a scroll wheel) and the eraser (for clearing several shapes in one sweep) are the only optional modes: each is highlighted, changes the cursor and status line, and its key (H / E) or Esc leaves it |
| **One corner cluster** | Floating palettes scattered around the edges compete with the drawing for attention | All on-screen controls besides the top bar sit in one stack at the lower right: the Fill and Line swatches above hand / eraser / zoom in / % / zoom out. Buttons are 48×44 px for easy targeting (Fitts' law) | A short trip to the corner; every action there also has a keyboard or gesture equivalent |
| **Color: two swatches that fan out** | A permanent row of swatches takes space for a choice made occasionally | A Line swatch and a Fill swatch show the current colors at all times; the line is drawn as a ring and the fill as a disc so the two are told apart by shape, not just by a label. Clicking one fans the colors out in an arc (echoing the pie menu); dragging a swatch onto a shape paints it directly, with the target highlighted before you drop | Picking takes two clicks instead of one; keys and the Line / Fill pie submenus are one-step alternatives |
| **Context-sensitive status line + help** | A blank canvas with hidden commands gives no clue what is possible (poor discoverability, gulf of execution) | A one-line hint at the bottom always describes what you can do *right now*: idle, with a selection, mid-menu, mid-stroke (e.g. "Release to snap to a circle"), while panning. **?** opens a help panel that draws the real pie layouts, so the directions can be learned before use. An empty canvas shows a "Right-click anywhere to start" prompt | Takes a sliver of screen space; experts can ignore it |
| **Map-style zoom & pan** | Fixed-size canvases force drawing at one scale | Holding the scroll wheel and dragging pans, and pinch zooms around the pointer, like an online map (+/− zoom around the screen center). The corner stack (hand, eraser, +, %, −) gives a visible, clickable alternative | Pinch is overloaded: it scales a selected shape and zooms the view otherwise (Esc deselects to zoom) |
| **Red center × to cancel** | An unmarked center makes "how do I get out?" unclear | The dead zone shows a faded red ×, the universal "cancel" sign, and brightens when the pointer is over it | None significant |
| **Ghost recognition preview** | Sketch recognizers usually replace your stroke on release, so a wrong guess is only visible after the fact and must be undone (poor visibility of system status) | While drawing, a faded ghost of the recognized shape appears *behind* the ink at the exact size it will snap to. If the guess is wrong you can keep drawing (error prevention). The ghost appears on the first match, then only changes after 3 consecutive checks agree, so it doesn't flicker. What it shows is exactly what you get on release. Your ink never changes while drawing, so recognition never fights your hand | Recognition is heuristic, so the five primitives also have explicit menu creation. The recognizer is deliberately conservative: anything ambiguous stays freehand rather than snapping wrongly |
| **Freehand as vector objects** | Paint programs turn strokes into pixels that can't be selected or transformed again | Every stroke is one selectable, transformable path object, the same as the primitives | No pixel-level editing (erasing part of a stroke) by design |
| **Direct manipulation** | Numeric property panels separate the control from the object | Drag to move, corner handles or trackpad pinch to scale, all acting on the object itself | Precise numeric sizes aren't available (arrow-key nudges cover small adjustments) |

### Smaller decisions

- **Release in the dead zone cancels** a drag that has left it. A plain right-click (never left the dead zone) instead keeps the menu open in click mode, matching what people expect from right-click.
- **Squares and circles always scale uniformly.** Shift-to-lock applies to the other shapes, so a "square" can never be stretched into a rectangle.
- **One drawing style.** Every shape — freehand, snapped, or made from the menu — has a line at the same width (`STROKE_WIDTH`) in the current line color. Closed shapes also get the current fill, which defaults to none; both use the same palette, so a matching line and fill read as one solid shape. Freehand lines never take a fill. Unfilled shapes are still selectable by their interior.
- **Undo/redo** (custom 100-step history in the store) makes experimenting safe. One drag, scale or pinch = one undo step. It's available from the keyboard and as top-bar buttons that grey out when there is nothing to undo/redo. Because Clear all can be undone, it needs no confirmation dialog.
- **Zoom doesn't change the document.** The view (pan/zoom) lives outside the shape list and the undo history, so saving, undo and copy/paste are unaffected. Strokes keep their width relative to the drawing at any zoom; selection handles stay a constant on-screen size.

## Recognizer

`src/interaction/recognize.ts`, run at most once per animation frame while the pointer moves (cost is bounded by time, not by point count, and the ghost is never more than a frame behind the pen):

1. **Closure.** The stroke closes at its point (in the second half) nearest the start. It counts as closed if that gap is within 20% of the bounding-box diagonal (`CLOSE_GAP`), so the ends need not touch. Anything drawn past that point is **overshoot**: up to 8% (`OVERSHOOT`) is trimmed off before classifying; more cancels recognition. Tiny or line-like strokes are rejected.
2. **Fill ratio** = stroke polygon area ÷ bounding-box area: about 0.5 for triangles, 0.79 for ellipses, and 1.0 for rectangles. This separates the classes robustly.
3. **Corners:** Ramer–Douglas–Peucker (`simplify-js`) with scale-relative tolerance, then drop near-straight and near-duplicate vertices cyclically.
4. 3 corners + triangle-like fill → **triangle**. 4 near-right-angle corners + full fill → **square** (sides within 15%) or **rectangle**. Ellipse-like fill + small deviation from the inscribed ellipse + no sharp corners → **circle** or **ellipse**.
5. Anything else → keep as freehand.

**Ghost behavior** (`GhostTracker`):
- Appears on the first match. A stroke often only matches as it closes, right before release, so a delay would let shapes snap unannounced.
- Keeps the geometry it first appeared with while the type holds, so it doesn't shift as you finish the stroke.
- Changes type or disappears only after 3 consecutive checks agree (`AGREE`), counted in frames where the pen moved. Holding still never changes it; there are no timers.
- Clears immediately on overshoot, since that only gets worse as the stroke continues.

**On release**, the ghost is committed exactly as shown, unless the stroke overshot (then it stays freehand). Only with no ghost up does the full stroke decide. Snapping plays a 160 ms scale pulse.

## Architecture

```
src/
  types.ts                 shape model + 5-color PALETTE
  store.ts                 Zustand store: shapes, selection, clipboard, line/fill color, mode, file, undo
  geometry.ts              bounds, default primitives, freehand path helpers
  platform.ts              ⌘ vs Ctrl detection and shortcut labels
  view.ts                  pan/zoom helpers (screen ↔ world, fit, zoom steps)
  useKeyboard.ts           shortcuts
  canvas/
    Canvas.tsx             <svg> + the single pointer-event router
    ShapeView.tsx          renders one shape in <g transform> (the only switch on type)
    SelectionHandles.tsx
    GhostPreview.tsx
  interaction/
    PieMenu.tsx            hand-built SVG pie menu (rendering)
    pieGeometry.ts         angle-based wedge selection, submenu ring
    pieMenuConfig.ts       context-dependent menu contents
    recognize.ts           classifier + ghost hysteresis
  file/fileOps.ts          new / open / save / save as + validation
  ui/TopBar.tsx            app name, file name, Paste / Undo / Redo / Clear all / Help
  ui/NavControls.tsx       hand tool, eraser + zoom stack
  ui/ColorPicker.tsx       Line / Fill swatches, fan-out palette, drag-to-paint
  ui/HelpPanel.tsx         gestures, live pie layouts, platform-specific shortcuts
  ui/Toast.tsx
```

- **One shape model.** Every shape has `x, y, scaleX, scaleY, rotation, fill, stroke, strokeWidth`; geometry is stored in local coordinates centered on (0,0). Move, scale, copy, paste, recolor, delete and save only touch the shared fields; only the renderer (and the bounding-box helper) switch on `type`.
- **Screen vs world space.** Shapes live in world coordinates inside one `<g transform="translate scale">`; the pie menu, handles and overlays live in screen space, so the menu always opens at the same size under the pointer whatever the zoom.
- **One pointer router** in `Canvas.tsx`, driven by a `mode` (`idle | drawing | dragging | scaling | erasing | menuOpen`) with `setPointerCapture` so drags and strokes keep tracking off-element.
- Strokes use `vector-effect: non-scaling-stroke`, so outlines keep their width when a shape is scaled.
