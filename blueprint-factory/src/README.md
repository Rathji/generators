# Blueprint — AI diagram drafter (perchance generator)

Turns a plain-language description into a technical-looking diagram sheet. The user
describes a process / org / system / network / conversation; an LLM (ai-text-plugin)
returns a strict JSON spec; the app lays it out with its own SVG layout engine and
renders it on a drafting-table UI with one of four drawing themes.

Live page: `https://perchance.org/<generatorName>` (currently unsaved preview).
URL params: `?theme=hand&test=network` loads a built-in sample of that kind
(no AI call); `?sample=2` runs an AI draft of the 3rd example idea.

## File map

- `index.html` — UI shell + all CSS + static markup (prompt, type/direction selects,
  theme tile row, zoom/export controls, example chips, overlays, `<svg id="diagramSvg">`).
  Fonts: Oswald, Space Grotesk, Caveat, Shadows Into Light (Google Fonts).
  NOTE: must never contain `[`/`]`/`{|`/`|}` — Perchance would treat them as template
  syntax. `app.js` builds the example chips and theme tiles from data instead of
  templating them in HTML.
- `src/app.js` — boot + UI wiring. Owns `window.bp` debug API: `sample(kind)`,
  `setTheme(id)`, `runDraft(desc)`, `setType(t)`, `zoomBy(f)`, `fitSheet()`, `state`.
  `drawCurrent` = sizeNodes → layoutGraph → drawDiagram (fit or keep zoom).
  AI path: `runDraft` calls `R.exportPNG`-style generation via `generateText`
  (`ai.js:buildPrompt`) with 2 tolerant-parse attempts before surfacing the error overlay.
- `src/ai.js` — prompt builder + SCHEMA (the JSON spec contract) + tolerant parser
  (normalizes casing/quotes/weight odds, strips markdown fences) + `sampleGraph(kind)`
  offline fixtures for every diagram kind (`?test=` mode).
- `src/shapes.js` — node glyph ops: kinds (process/decision/start/end/database/cloud/
  server/device/actor/note...), `boxFor(kind,w,h)`, anchor points, glyph paths
  (scaled cloud/database/cylinder), text measurement.
- `src/layout.js` — pure layout. `sizeNodes` (wrap text by theme font), then per type:
  `layoutLayered` (flowchart: ranks + barycenter crossing minimization),
  `layoutTreeGraph` (tree/mindmap), `layoutArchitecture` (banded lanes, returns bands),
  `layoutForce` (network: spring+repulsion sim, best-of-11 restarts scored by
  overlap/crossing count, then a deterministic de-cross settle pass + box separation),
  `layoutSequence` (actor lifelines + arrows). Edge geometry: s-curves
  (`s-h`/`s-v`), ortho-v, straight, sequence arrows — plus label placement.
- `src/render.js` — themes + SVG rendering + export.
  - `THEMES`: `blueprint` (white on dark blue, Oswald caps), `graph` (dark ink on
    graph-paper cream, Space Grotesk), `hand` (Caveat, rough.js wobble),
    `chalk` (Shadows Into Light on chalkboard green, rough.js).
  - `drawDiagram` composes: sheet/frame + corner ticks, top strip labels, title block
    (title wraps at ~42% block width, ≤3 lines), band lanes for architecture,
    edges then nodes, sequence lifelines.
  - rough.js loaded lazily (`ensureRough`, esm.sh 4.6.6) only for rough themes.
  - `exportPNG` re-serializes the SVG with data-URLed @font-face (latin subset),
    rasterizes to canvas at dpr 1.5–2.5 and triggers a blob download
    `<title-slug>-<theme>.png`. `dateStr()` is SEP 03, 2026-style.
- `main.pjs` — imports `generateText` (ai-text-plugin) and holds `diagramIdeas`
  (the example chips). `$meta.header.mode=minimal`.

## Diagram JSON spec (the contract between AI and layout)

```json
{
  "title": "Short sheet title",
  "type": "flowchart|tree|mindmap|architecture|network|sequence",
  "direction": "LR|TB|auto",
  "nodes": [{ "id": "n1", "label": "Main label", "sub": "optional second line",
              "kind": "process|decision|start|end|database|cloud|server|device|actor|note|object|container|external",
              "band": "optional architecture lane id", "weight": 1 }],
  "edges": [{ "from": "n1", "to": "n2", "label": "yes/no/…", "style": "dashed|solid" }]
}
```

Layout infers ranks/lanes when the AI omits them; parse tolerates many LLM
formatting sins (fences, smart quotes, extra prose) and falls back to a flowchart
when type is unrecognized. Weights allow decision branches (`no:0.3` style hints).

## Rendering pipeline (per draw)

`sizeNodes` (measure text → box dims per kind+theme) → type-specific layout writes
`x/y/_w/_h` (+edge `geom`) → `drawDiagram` renders frame → lanes → edges → nodes →
sequence decorations → returns bands/title for the meta line. Sheet size derives
from node extents; zoom fits it into the stage.

## Editing / rebuild notes

- All logic is plain ES modules in `src/`, loaded by index.html's module script —
  no build step, no bundler. Edit and reload.
- Theme colors/fonts: `render.js` THEMES. New themes: add entry + font family to the
  Google Fonts `<link>` and the tile builder's per-theme mini-preview map in app.js.
- Layout tuning constants live at the top of the relevant functions in `layout.js`
  (rank gap `lgx/lgy`, force `k`, etc.).
- Visual regression trick: `?test=<kind>` (offline) then screenshot the `#diagramSvg`
  via a helper that re-serializes it with data-URLed fonts — plain `toDataURL` on the
  live SVG loses web fonts.
- PNG export font inlining: `fontCSS(family, weights)` fetches Google Fonts CSS and
  rewrites `url()` → data URLs (latin subset only; download ~200–400 KB).

## Known limits / accepted quirks

- Network force layout may leave a single edge passing under a node on some rolls
  (best-of-N restart selection keeps it rare; regenerate to re-roll).
- Sibling elbow connectors in a dense org chart can share a rail segment.
- Full-page screenshots in the editor harness can composite CSS gradients black —
  capture the `.table` element instead when checking the stage visually.
