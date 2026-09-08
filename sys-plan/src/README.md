# sys-plan — system planning board

Drag-and-drop **system planning** diagrams. Each box on the board is one
component (electrical part, software module, network device, mechanical
element, fluid-process item, energy source…). Boxes have typed **input/output
ports**; pull a wire from a dot on one box's edge to a dot on another to show
how components connect. A procedural "Blueprint" engine can draft a whole
starter diagram for a system idea, and an optional AI brainstorm can suggest
components that fit whatever you have on the board.

Built as a perchance generator (`sys-plan`), modeled on the diagram-it
generator's shell conventions (minimal header, full-window canvas, toolbar /
statusbar, pjs file for plugins/meta).

## Layout & data model

- `main.pjs` — `$meta`, plugin imports (`kv`, `ai-text`). No list data needed;
  all app data lives in `src/` modules.
- `index.html` — static app shell only (toolbar, panel hosts, stage). No
  perchance templating; everything is built by the modules below.
- `src/styles.css` — all styling.
- `src/util.js` — tiny helpers (uid, esc, debounce, clone, pick…).
- `src/model.js` — pure data model for a *plan*: `{nodes[], wires[]}`.
  - node: `{id, category, title, kind, desc, inputs[], outputs[], x, y, w}`
  - port: `{label, type}` (type ∈ `power|signal|control|data|status|network|fluid|motion|media`)
  - wire: `{id, src:{n,o}, dst:{n,i}}` (node id + output/input port index)
  - plus cycle/loop detection (Tarjan SCC) and validation helpers.
- `src/content.js` — domain content: `CATEGORIES`, `PORT_TYPES`,
  `PALETTE` (component ideas per category with title/desc variants and
  typical ports), `THEMES` (starter-system blueprints) and the
  `composeTheme` composer, plus `demoBoard()` (the first-run demo board).
- `src/editor.js` — the canvas: DOM-rendered boxes + SVG wires in a
  pan/zoom plane; selection (click / marquee), node move, port→port
  wire drawing with live hover targets, undo/redo, keyboard-friendly ops,
  fit-to-view, loop highlighting. (The pan/zoom transform is
  `translate(view.x,view.y) scale(zoom)` with the plane origin pinned at
  0,0 — keep that in mind for any screen↔world hit-testing.)
- `src/panels.js` — sidebar palette, inspector, blueprint modal, AI modal,
  export/import/save-slot UI, toasts. On narrow screens (≤860 px) the side
  panels start closed as overlays (toolbar "Boxes"/"Info" toggles reopen
  them); `arrangePlan` lays out fresh/blueprinted boards (SCC-condensed
  topo order, left→right, cycles stacked vertically).
- `src/main.js` — boot: loads persisted board (kv-plugin, localStorage
  fallback), wires everything, global shortcuts.

## Persistence

Autosave (debounced) + named slots via `root.kv.sysplan` (kv-plugin). Falls
back to `localStorage` if kv is unavailable (unsaved preview etc.). Export /
Import JSON moves plans between browsers. First-run (no autosave yet) loads
`demoBoard()` so the board isn't empty.

## Data-flow convention

Wires are directional, drawn output → input. Layout/generation flows
left → right (sources/roots on the left, actuators/sinks on the right).
Closed loops (feedback, control loops…) are legal and common — they're
detected and softly highlighted, and counted in the status bar.

## Authoring content

- Add palette ideas: `PALETTE.<category>` arrays in `src/content.js` —
  items are `{t:[titles], d:[descs], kind, in:[[label,type],…], out:[[…]]}`.
- Add a starter system: push a theme object into `THEMES` in
  `src/content.js`. Slot = a component instance; `wires` link slots by
  **port label**, and titles are resolved through each slot's candidate
  titles — so a theme still wires up no matter which variant a seed picks.
- Optional bridge components are `connectors`: `{from, to, category}` —
  a random category-appropriate part is dropped between the two slots and
  wired with randomized compatible ports. Reference slots by title here too.

## Testing / iterating

This board is pure client-side DOM+SVG — no canvas, so screenshots capture
cleanly. Autosave is debounced ~1 s. Blueprint generation, undo, and AI
suggestions are all undoable. AI needs `root.generateText` (ai-text-plugin);
if it's absent the AI button hides itself.
