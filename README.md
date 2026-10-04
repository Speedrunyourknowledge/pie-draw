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

- **Context-aware.** On empty canvas it offers Square, Rectangle, Circle, Ellipse, Triangle, Line color, Fill color and File (New, Open, Save, Save As). On a shape it offers Line color, Copy, To Front, Delete, To Back, Cut and Fill. Freehand lines get the same menu without Fill.
- **Fixed layouts.** Each command always sits in the same direction, so choices can be made from memory.
- **Drag or click.** Drag toward a wedge and release, or do a quick right-click to leave the menu open, then click a wedge. Only the direction matters, not the distance.
- **Submenus** (Line, Fill, File) open in an outer ring. Keep dragging outward past the wedge, then sideways to the item, all in one stroke.
- **Cancel** by releasing on the red **×** in the center, dragging past the menu's faint outer ring (it turns red), or pressing Esc.

### Drawing and Editing

- **Create primitives** from the empty-canvas menu. The shape appears where the menu was opened, already selected.
- **Freehand drawing** with live shape recognition. Drag on empty canvas to draw. If the stroke closes into a square, rectangle, circle, ellipse or triangle, a faded **ghost** of that shape appears behind your ink. Release to snap to exactly what the ghost shows; otherwise the stroke stays freehand.
- **Select, move, scale.** Click a shape to select it, drag to move, drag a corner handle to scale (Shift keeps proportions; squares and circles always do), or pinch on a trackpad. Arrow keys nudge.
- **Cut, copy, paste, delete** from the shape menu, the keyboard, or the Paste button in the top bar. Pastes are offset and cascade.
- **Z-order:** To Front / To Back.
- **Eraser** (E or the lower-right button): click or sweep across shapes to delete whole shapes.
- **Undo / redo** (100 steps) from the keyboard or top-bar buttons. **Clear all** is undoable.

### Color

Five colors for lines and fills (or no fill). Two swatches in the lower right show the **Line** color (a ring) and **Fill** (a disc). They reflect the selected shape or, with nothing selected, what new shapes will get. Click a swatch to fan out the palette, or **drag a swatch onto any shape** to paint it. The pie menu's Line / Fill submenus and number keys do the same.

### Navigation

An infinite canvas with map-style navigation: middle-drag, Space-drag, the hand tool, or scroll/two-finger swipe to pan; pinch, Ctrl+scroll or the +/− buttons to zoom; F fits all shapes. Pan and zoom aren't part of the document or the undo history.

### Files

New, Open, Save and Save As use native file dialogs. Documents are saved as JSON (`{ "version": 1, "shapes": [...] }`) and validated when opened. New and Open ask before discarding unsaved changes, and the document title indicates unsaved work with a blue dot.

## Design Decisions

**Pie menu at the pointer instead of a toolbar.** A toolbar at the screen edge makes every command a round trip away from the work, through small targets. The pie menu opens where you already are: every item is the same short distance away, and wedges get wider the farther you move (Fitts' law). The cost is discoverability, which the empty-canvas prompt, status line and help panel make up for.

**Direction, not distance, picks the item.** Between the center and the menu's edge only the angle counts, so each wedge is a large target. Beginners drag slowly and read the labels; with practice the same motion becomes a quick flick from memory, so the slow way trains the fast way. This is also why layouts never change. The limit is about eight items per ring, so deeper commands use a submenu ring.

**A visible way out.** Many marking menus commit to whatever direction you release in. Here, releasing on the center × or beyond the outer ring cancels, and both light up before you let go. The edge (~120 px, or ~185 px on submenu wedges) is still far larger than any toolbar button.

**Context instead of modes.** The menu shows only what applies to what is under the pointer, so there are no disabled items and no "current tool" to remember. Dragging always means *move* on a shape and *draw* on empty canvas. The trade-off is that the same direction means different things in the two menus (↑ is Square on canvas, Line on a shape). The hand tool and eraser are the only optional modes; each is highlighted, changes the cursor and status line, and exits with its key or Esc.

**Minimal, clustered chrome.** Nearly the whole window is canvas. A thin top bar holds only document-level commands (Paste, Undo, Redo, Clear all, Help). All other on-screen controls sit in one stack at the lower right, the color swatches above hand / eraser / zoom, with large 48×44 px buttons. Every one also has a keyboard or gesture equivalent.

**Color swatches that fan out.** A permanent palette row takes space for a choice made occasionally. Two swatches show the current colors at all times, told apart by shape (ring vs. disc), not just by label. Clicking fans the colors out in an arc that echoes the pie menu, and drag-to-paint lets you recolor a shape without selecting it first.

**Ghost preview for recognition.** Sketch recognizers usually swap your stroke on release, so a wrong guess shows up only after the fact. Here the recognized shape appears as a ghost *behind* your ink while you draw, at the exact size it will snap to, and your ink is never altered mid-stroke. If the guess is wrong you keep drawing. The ghost changes only after several consecutive frames agree, so it doesn't flicker. The recognizer leans conservative: anything ambiguous stays freehand. Because recognition is heuristic, every primitive can also be created reliably from the menu.

**Feedback and discoverability.** A one-line status bar at the bottom always describes what you can do right now: idle, with a selection, while the menu is open, while scaling, or in hand/eraser mode. An empty canvas shows how to open the menu, and the help panel draws the real menu layouts so directions can be learned before use.

**Direct manipulation and safe experimentation.** Shapes are moved and scaled by grabbing them, not through property panels. Undo covers every document change (one drag or pinch = one step), so Clear all and the eraser need no confirmation dialogs.

**Vector objects, one drawing style.** Every stroke is a single selectable path object, like the primitives. All shapes share one line width; closed shapes can also take a fill, and outline-only shapes are still selectable by their interior.

## Not Implemented / Limitations

- **Mobile and touch.** No support for pinch-to-zoom or two-finger pan. Additionally, there is no alternate UI for small screens.
- **Browsers other than desktop Chrome/Edge.** Can save files, but Save downloads a new copy each time instead of overwriting the original (see [Files](#files)).
- **Multi-select and grouping.** Only one shape can be selected at a time.
- **Rotation.** Rotation of shapes is not supported.
- **Drawing capabilities.** One stroke width, a fixed five-color palette, no text boxes, no command to create straight lines.
- **Erasing.** The eraser removes whole shapes; there is no pixel erasing, by design.
- **Export and persistence.** No PNG/SVG export, no autosave (refreshing the page loses unsaved work).
- **Pie menu accessibility.** Menu commands can't be navigated with arrow keys.
