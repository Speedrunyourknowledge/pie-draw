# Pie Draw

A browser-based 2D **drawing** app. Features a context-aware **pie menu** for most actions. Shapes and freehand strokes are vector objects that can be selected, moved, scaled, and recolored; there is no pixel-level editing.

## Running It

```bash
npm install
npm run dev
npm run build     # Production build
```

Use **Chrome or Edge** on a desktop computer for the full experience.

Click **Help** in the app for a list of possible actions. Keyboard shortcuts use Ctrl on Windows/Linux. On MacOS, Cmd and Ctrl both work.

## Features

### Pie Menu

Right-click or press and hold for ~300 ms to open a radial menu centered on the pointer.

- **Context-aware.** The menu changes based on the target: an empty canvas, an object, or multiple objects.
- **Fixed layouts.** Each option always sits in the same place, so choices can be made from memory.
- **Submenus** open in an outer ring. Move the cursor past the wedge, then toward the item, all in one stroke.
- **Cancel** by releasing on the red X in the center, dragging past the menu's outer ring, or pressing Esc.

### Drawing and Editing

- **Create shapes** from the empty-canvas menu. The shape appears where the menu was opened.
- **Freehand drawing** with live shape recognition. Drag on an empty canvas to draw. If the stroke closes into a recognized shape, a **preview** of that shape appears. Release to snap to that shape.
- **Object manipulation.** Click an object to select it, drag to move, drag the edge of the selection (or pinch on a trackpad) to scale. Use the arrow keys to translate the object.
- **Multi-select.** Ctrl-click (Cmd-click on Mac) or Shift-click objects to add or remove them from the selection. Shift-drag or use the **select tool** to create a dashed selection box. A multi-selection acts as one object: moving, scaling, and recoloring affects all selected objects.
- **Copy and cut** with the menu buttons or Ctrl+C and Ctrl+X.
- **Paste** with the toolbar button or Ctrl+V.
- **Z-order.** Use the **To Front** and **To Back** buttons.
- **Eraser tool.** Click or drag across objects to delete them.
- **Undo / redo** with the toolbar buttons or Ctrl+Z and Ctrl+Shift+Z.

### Color

Two swatches on the right show the line color and fill color. There are five colors available for each. The swatch indicate the color of the selected shape or, with nothing selected, the color new shapes will get. Click a swatch to see the color palette, or **drag a swatch** onto a shape to color it. Additionally, the shape menu has Line / Fill submenus for changing the color of an individual shape.

### Navigation

An infinite canvas with map-style navigation.
- **Pan** with middle-click-drag, spacebar-drag, the hand tool, two-finger swipe, or by scrolling.
- **Zoom** with Ctrl+scroll, the +/− keys, the +/- buttons, or by pinching on a trackpad.

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
