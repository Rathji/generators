# diagram-it

Minimalist Excalidraw-style diagramming for IT professionals (architecture, network, cloud, Kubernetes, UML). Built on a plain HTML5 `<canvas>` — no external libraries.

## Files
- `main.pjs` — `$meta` (incl. `image` = hosted 16:9 banner screenshot, per display-card-standards), the **feature TODO list** (`diagramIt.roadmap` — mirrors the Atomic Roadmap, mark `status = todo → done`), and the **color theme presets** (`diagramIt.theme.presets`) borrowed from the business-template generator.
- `index.html` — static layout: slim top toolbar, slim left tool rail, canvas filling the rest (draw area = most of the screen), settings modal (Appearance / Canvas / Roadmap tabs).
- `src/diagram-it.css` — theming via CSS variables; light/dark per theme mode; active preset applied to `<html>` inline by JS.
- `src/diagram-it.js` — the whole app (IIFE).

## Current feature set (foundation — roadmap task f0, done)
- Tools: Select, Rectangle, Ellipse, Arrow, Text, Pan.
- Double-click any element to edit its text/label inline.
- Pan (space / middle / right-drag / hand tool) & zoom (wheel, buttons, fit, pinch on touch).
- Move/resize (8 handles), marquee & shift multi-select, arrows nudge, Ctrl+D duplicate, Ctrl+A select all, Delete, undo/redo (Ctrl+Z / Ctrl+Shift+Z / Ctrl+Y).
- Autosaves to localStorage (`diagram-it:canvas:v1`); Export PNG / Export JSON / Import JSON in Settings → Canvas.
- Settings (gear): theme mode, theme preset (from pjs), accent + ink colors, text size, stroke width, canvas background (Theme/White/Paper/Graph), grid + snap toggles, and a live Roadmap tab.

## Roadmap (in `diagramIt.roadmap` in main.pjs)
Phases: 1) draw.io XML import/export + element mapping/coordinate validation · 2) IT shape libraries (cloud, K8s, network, UML/ERD) · 3) smart anchors, grouping/nesting, auto-layout · 4) template gallery, XML import/export triggers, library search. All tasks currently `todo`.

## Notes for a future agent
- Scene coordinates: elements store `{x, y, w, h}` (rect/ellipse/text) or `{x, y, x2, y2}` (arrow) in scene units; the view transform is `view = {ox, oy, scale}` (`screen = scene*scale + o`). Draw = translate+scale ctx, then draw elements in scene space; screen-space overlays (grid, selection, marquee) drawn separately.
- `drawElement(g, el, scale)` is shared by the main canvas and PNG export (scale=1 there).
- Text wrapping uses `ctx.measureText`; text elements scale with zoom, shape labels are font-sized from shape height.
- Settings persisted at `diagram-it:settings:v1`; localStorage keys are versioned.
