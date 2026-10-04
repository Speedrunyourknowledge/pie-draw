# Pie Draw

A browser-based 2D **drawing** app. Features a context-aware **pie menu** that opens on right-click or press-and-hold. Shapes and freehand strokes are vector objects that can be selected, moved, scaled and recolored; there is no pixel-level editing.

## Running It

```bash
npm install
npm run dev
npm run build     # Production build
```

Use **Chrome or Edge** on a desktop (macOS, Windows, Linux or ChromeOS) for the full experience. Open and save use the File System Access API, which only desktop Chromium browsers support; other browsers fall back to downloads (see [Files](#files)).

Press **?** or click **Help** in the app for the full list of gestures and keyboard shortcuts, including drawings of both menu layouts. Shortcuts use Ctrl on Windows/Linux; on a Mac, Cmd and Ctrl both work.

## Features

### Pie Menu

Right-click (two-finger click on a trackpad, Control-click on a Mac) or press and hold for ~300 ms to open a radial menu centered on the pointer.

- **Context-aware.** On empty canvas it offers Square, Rectangle, Circle, Ellipse, Triangle, Line color and Fill color. On a shape it offers Line color, Copy, To Front, Delete, To Back, Cut and Fill. Freehand lines get the same menu without Fill. Opened on a multi-shape selection, every command applies to all selected shapes (Fill appears if any of them can take one).
- **Fixed layouts.** Each command always sits in the same direction, so choices can be made from memory.
- **Drag or click.** Drag toward a wedge and release, or do a quick right-click to leave the menu open, then click a wedge. Only the direction matters, not the distance.
- **Submenus** (Line, Fill) open in an outer ring. Keep dragging outward past the wedge, then sideways to the item, all in one stroke.
- **Cancel** by releasing on the red **×** in the center, dragging past the menu's faint outer ring (it turns red), or pressing Esc.

### Drawing and Editing

- **Create primitives** from the empty-canvas menu. The shape appears where the menu was opened, already selected.
- **Freehand drawing** with live shape recognition. Drag on empty canvas to draw. If the stroke closes into a square, rectangle, circle, ellipse or triangle, a faded **ghost** of that shape appears behind your ink. Release to snap to exactly what the ghost shows; otherwise the stroke stays freehand.
- **Select, move, scale.** Click a shape to select it, drag to move, drag a corner or edge of the selection box to scale (Shift keeps proportions; squares and circles always do), or pinch on a trackpad. Arrow keys nudge.
- **Multi-select.** Cmd-click (Ctrl-click on Windows/Linux) or Shift-click shapes to add or remove them one at a time. Shift-drag draws a dashed selection box, and the **select tool** (V, or the button just below the color swatches in the lower right) makes a plain drag on empty space do the same. Every shape the box touches is selected (closed shapes by their area, freehand lines by the line itself); the shapes are outlined while you drag and the group's box appears on release. Holding Shift switches the cursor to the select crosshair. Cmd/Ctrl+A selects all. A multi-selection then acts as one object: dragging anywhere inside its box moves it, right-click or press-and-hold inside opens the menu for the whole group, and its corners and edges scale it (a selection that includes a square or circle keeps its proportions even without Shift). It also recolors, reorders, nudges, copies and deletes as a unit. Individual shapes don't highlight on hover while they're part of the group. In the select tool, Esc first clears the selection, then leaves the tool.
- **Cut, copy, paste, delete** from the shape menu, the keyboard, or the Paste button in the top bar. Pastes are offset and cascade.
- **Z-order:** To Front / To Back (a multi-selection keeps its internal stacking order).
- **Eraser** (E or the lower-right button): click or sweep across shapes to delete whole shapes.
- **Undo / redo** (100 steps) from the keyboard or top-bar buttons. **Clear all** is undoable.

### Color

Five colors for lines and fills (or no fill). Two swatches in the lower right show the **Line** color (a ring) and **Fill** (a disc). They reflect the selected shapes (the first one's color if they differ) or, with nothing selected, what new shapes will get. Click a swatch to fan out the palette, or **drag a swatch onto any shape** to paint it (dropping it on a selected shape paints the whole selection). The pie menu's Line / Fill submenus and number keys do the same.

### Navigation

An infinite canvas with map-style navigation: middle-drag, Space-drag, the hand tool, or scroll/two-finger swipe to pan; pinch, Ctrl+scroll or the +/− buttons to zoom; F fits all shapes. Pan and zoom aren't part of the document or the undo history.

### Files

New, Open, Save and Save As are in the **File** menu at the left of the top bar, next to the document title; it opens on hover (or on click) and lists each command's shortcut. They use native file dialogs. Documents are saved as JSON (`{ "version": 1, "shapes": [...] }`) and validated when opened. New and Open ask before discarding unsaved changes, and the document title indicates unsaved work with a blue dot.

## Design Decisions

**Pie menu at the pointer instead of a toolbar.** A toolbar makes every command a trip to the screen edge. The pie menu opens where you're working, every item is equally close, and wedges widen as you move outward (Fitts' law). The cost is discoverability, which the empty-canvas prompt, status line and help panel offset.

**Direction, not distance, picks the item.** Only the angle counts, so each wedge is a large target. The slow, label-reading motion is the same one that later becomes a quick flick from memory, which is why layouts never change. About eight items fit per ring, so further commands go in a submenu ring.

**A visible way out.** Releasing on the center × or beyond the outer ring cancels, and both light up before you let go. The edge (~120 px, ~185 px on submenus) is still far larger than a toolbar button.

**Context instead of modes.** The menu shows only what applies under the pointer, so there are no disabled items. Dragging means *move* on a shape and *draw* on empty canvas. The trade-off is that a direction means different things in the two menus (↑ is Square on canvas, Line on a shape). The select, hand and eraser tools are the only modes; each is highlighted, changes the cursor and status line, and exits with its key or Esc.

**File commands in a conventional menu.** New, Open and Save are used rarely, so they don't earn a pie direction. Moving them to a File menu at the top left, where people expect it, freed a wedge and widened the rest. It opens on hover with a short grace period, or on click for touch and keyboard.

**Two ways to box-select.** A plain drag on empty canvas already draws, so box selection uses Shift-drag or the select tool. The box selects anything it *touches*, so a rough drag is enough, and touched shapes are outlined before release. The selected group's box then acts as one target for move, menu and scale. On a Mac, Ctrl-click is a right-click, so Cmd-click adds to the selection.

**Minimal, clustered chrome.** A thin top bar holds the document commands (File, Paste, Undo, Redo, Clear all, Help). Everything else sits in one lower-right stack (color swatches, select, hand, eraser, zoom) with large 48×44 px buttons, each with a keyboard or gesture equivalent.

**Color swatches that fan out.** Two swatches replace a permanent palette and are told apart by shape (ring vs. disc), not just label. Clicking fans the colors out in an arc that echoes the pie menu; dragging a swatch onto a shape recolors it without selecting it first.

**Ghost preview for recognition.** Instead of swapping your stroke on release, the recognized shape appears as a ghost *behind* your ink, at the exact size it will snap to. It changes only after several consecutive frames agree, and ambiguous strokes stay freehand. Every primitive can also be created reliably from the menu.

**Feedback and discoverability.** A status line always says what you can do right now, in every state and tool. An empty canvas shows how to open the menu, and the help panel draws the real menu layouts.

**Direct manipulation and safe experimentation.** Shapes are moved and scaled by grabbing them, not through property panels. Every document change is undoable (one drag or pinch = one step), so Clear all and the eraser need no confirmation dialogs.

**Vector objects, one drawing style.** Every stroke is a selectable path object, like the primitives. All shapes share one line width; closed shapes can take a fill and are selectable by their interior even when outline-only.

## Not Implemented / Limitations

- **Mobile and touch.** No support for pinch-to-zoom or two-finger pan. Additionally, there is no alternate UI for small screens.
- **Browsers other than desktop Chrome/Edge.** Can save files, but Save downloads a new copy each time instead of overwriting the original (see [Files](#files)).
- **Grouping.** Several shapes can be selected and edited together, but they can't be saved as a permanent group.
- **Rotation.** Rotation of shapes is not supported.
- **Drawing capabilities.** One stroke width, a fixed five-color palette, no text boxes, no command to create straight lines.
- **Erasing.** The eraser removes whole shapes; there is no pixel erasing, by design.
- **Export and persistence.** No PNG/SVG export, no autosave (refreshing the page loses unsaved work).
- **Pie menu accessibility.** Menu commands can't be navigated with arrow keys.
