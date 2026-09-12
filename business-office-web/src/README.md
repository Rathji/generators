# Perchance Office — framework seed

A browser office suite (Word/LibreOffice-style) running on Perchance. This is the
**shell + launcher**; the four apps are scaffolds waiting for their real builds.

## Layout

- `main.pjs` — everything the launcher shows, business-template style, in the
  `config` list: suite identity, brand palette, the four apps (id/name/blurb/
  badge/color), and the demo "recent files" list. Edit config here, not in code.
- `index.html` — static bootstrap only; loads `src/office.css` + `src/office.js`.
- `src/office.js` — shell: reads `root.config`, renders the rail, hash-router
  (`#/home`, `#/app/docs` …), the home/start page (its "Recent files" section
  lists the real saved files from T13/T14, falling back to the demo config
  recents when nothing is saved), the shared app-view scaffold (app head bar →
  workspace zone → roadmap/structure cards), and the Desktop workspace —
  including the T13 Files sidebar (`fileSidebarHTML` / `wireFileSidebar` /
  `refreshSidebar`): save the active window, open/rename/delete saved files,
  plus the `showToast` helper. Responsive: on ≤620px screens the Files sidebar
  becomes an off-canvas drawer behind a "Files" toggle in the desk bar (kept in
  the DOM, just translated off-screen, so the DOM-backed tests still pass), and
  window positions are clamped to the desk layer on every render + window
  resize so they never clip off-viewport.
- `src/filesystem.js` — T13+T14 Virtual File System: `FileSystem` (saved files
  {id, app, name, content, meta, timestamps} distinct from open-docs; save/
  saveAs upsert-by-name, rename/remove, list/listByApp/get/getByName, events,
  optional persistence). Per-app unique names (T14): create/rename reject
  duplicates (`{ok:false, error:"duplicate"}`), names trimmed/non-empty, same
  name allowed across apps. Shared singleton `fileSystem` persists via
  StateStore("files").
- `src/state.js` — T1 State Persistence Layer: `StateStore` (namespaced JSON over
  localStorage, injectable storage, corrupt/quota-safe) + shared `sessionStore`.
  The shell persists the last route there and restores it on reload. Apps that
  need their own bucket: `new StateStore("drafts")` etc.
- `src/registry.js` — T2 Global Document Registry: `DocumentRegistry` (unique id →
  {app, content, meta, timestamps}, insertion-order list, find/listByApp, events,
  optional persistence). Shared singleton `documentRegistry` persists via
  StateStore("registry") — open docs survive reloads. The shell seeds one blank
  doc per app on first visit and shows them in each app view + a home count.
- `src/windows.js` — T3 Window Manager: `WindowManager` (open/focus/close/move,
  z-order, active window, events, optional persistence). Shared singleton
  `windowManager` persists via StateStore("windows"). The Desktop (`#/desktop`)
  renders open windows as draggable panels; `#/app/<key>` opens/focuses the app's
  window bound to its registry doc.
- `src/richtext.js` — T4 Rich Text model: `RichText` (blocks of runs with
  bold/italic/underline flags). Parses contenteditable HTML and Markdown in,
  emits clean HTML (`<p>/<strong>/<em>/<u>/<br>` only), clean Markdown and plain
  text out; editing ops (`applyFormat`/`insertText`/`deleteRange`) work on
  plain-text offsets that match the editor's DOM text nodes. Pure — no DOM.
- `src/export.js` — T5 Document Export: `sanitizeFilename`, `renderHTMLFile`
  (standalone .html — doctype, escaped `<title>`, embedded print-ready CSS,
  body exactly the model's clean HTML), `renderTextFile` (plain text with a
  title header line), `downloadFile` (Blob → object URL → `<a download>`),
  `exportDocument`. Pure — no DOM except `downloadFile`.
- `src/templates.js` — T6 Template Loader: `documentTemplates` (four business
  documents — Memo, Business letter, Meeting agenda, Weekly report — authored
  in the RichText Markdown subset so each round-trips byte-exact) +
  `findTemplate(id)`. Pure data + a lookup helper.
- `src/grid.js` — T7 Grid Data Structure: `Grid` (2D array of cells with both
  A1-style and zero-based addressing, auto-expanding bounds, sparse
  toJSON/fromJSON, usedRange/forEach/resize) plus the A1 coordinate helpers
  `colToIndex`/`indexToCol`/`cellToRC`/`rcToCell`. Pure — no DOM.
- `src/formula.js` — T8 Formula Parser: `isFormula`/`evaluateFormula`/
  `displayValue`. A recursive-descent parser + evaluator for strings starting
  with "=" — arithmetic with precedence & parens, cell references, A1:B1
  ranges, SUM/AVERAGE/MIN/MAX/COUNT, recursive formula refs with a cycle
  guard, and Excel-ish empty/text semantics (errors come back as strings like
  "#DIV/0!"). Pure — no DOM.
- `src/cellstyle.js` — T9 Cell Formatting Engine: `CellStyles`, a sparse map of
  per-cell style objects (align/bg/color/bold/italic) keyed by A1 ref. Styles
  live completely apart from the Grid — restyling never touches values;
  `set` merges, null/""/false removes a prop, empty styles are dropped,
  `clear`/`clearAll`/`toJSON`/`fromJSON` round-trip sparse JSON. Pure — no DOM.
- `src/slidedeck.js` — T10+T11 Slide Deck model: `SlideDeck`, a linear sequence
  of business slides ({kicker, title, body[]}) with `goTo`/`next`/`prev`/
  `first`/`last` (clamped, bool-returning), `addSlide`, and `toJSON`/
  `fromJSON` (defaults to a 5-slide starter deck), plus a per-slide discrete
  element model — `elementsOf`/`getElement`/`addElement`/`updateElement`/
  `removeElement`, `defaultElement` (text + shape kinds), %-based bounds and
  z-order that persist through toJSON/fromJSON. Pure — no DOM.
- `src/apps/docs.js` — T4–T6 editor surface: `docsApp.mount(zone, ctx)` builds
  the toolbar (B/I/U + a "Templates…" menu), the contenteditable page, a live
  word/char count, Document/Markdown/HTML output views, Export HTML/TXT
  buttons and template loading. The doc lives in the registry as Markdown.
  Apps with a `mount()` render their own chrome inside the window; the rest
  still show the scaffold.
- `src/apps/sheets.js` — T7+T8+T9 grid surface: `sheetsApp.mount(zone, ctx)` builds a
  real spreadsheet — column/row headers, click-to-select, in-cell editor, an
  fx bar, arrow/Enter/Tab navigation, and registry persistence as sparse grid
  JSON. Live formulas (T8): `=…` cells evaluate via src/formula.js (model and
  fx bar keep the raw text, the cell shows the result; every commit refreshes
  all visible cells so dependents ripple). Cell formatting (T9): a second
  toolbar (L/C/R, B/I toggles, fill + text color swatches, Clear) styles the
  selected cell; styles persist as sparse JSON in the doc's `meta.styles` and
  render via an inline `--bg` var (the selection highlight overrides any fill).
- `src/apps/slides.js` — T10+T11+T12 presentations surface: `slidesApp.mount(zone,
  ctx)` renders a 16:9 business deck from src/slidedeck.js — accent bar, kicker,
  title, bulleted lines, page footer — with a toolbar counter, first/prev/
  next/last nav buttons and keyboard shortcuts (arrows, PageUp/Down, Home/End,
  space). The deck persists as JSON in the registry doc content. Above that
  (T11) sits a Layers toolbar (＋Text/＋Shape/Delete) with click-select,
  drag-move, corner-handle resize, arrow-nudge and double-click text editing of
  discrete layered elements, and (T12) a full-screen read-only presentation
  overlay (click/arrow nav, Esc/× exit).
- `src/apps/mail.js` — scaffold app (no editor yet): exports
  `{ key, roadmap[], workspaceNote, mountFile, seedHints[] }`; a later build
  gives it a `mount()` like docs/sheets/slides.
- `src/tests/state.test.js` — T1 validation suite (`runStateTests()`); run it in
  the page: `const m = await import("./src/tests/state.test.js"); m.runStateTests()`.
- `src/tests/registry.test.js` — T2 validation suite (`runRegistryTests()`).
- `src/tests/windows.test.js` — T3 validation suite (`runWindowTests()`).
- `src/tests/richtext.test.js` — T4 validation suite (`runRichTextTests()`).
- `src/tests/export.test.js` — T5 validation suite (`runExportTests()`).
- `src/tests/templates.test.js` — T6 validation suite (`runTemplateTests()`).
- `src/tests/grid.test.js` — T7 validation suite (`runGridTests()`).
- `src/tests/formula.test.js` — T8 validation suite (`runFormulaTests()`).
- `src/tests/cellstyle.test.js` — T9 validation suite (`runCellStyleTests()`):
  pure CellStyles tests + DOM tests that drive the sheets formatting toolbar and
  assert styles apply to the selected cell, follow selection, clear, persist in
  `meta.styles`, and never alter values.
- `src/tests/slides.test.js` — T10 validation suite (`runSlideTests()`): pure
  SlideDeck tests (navigation/clamping/persistence) + DOM tests that drive the
  presentations surface (nav buttons, keyboard shortcuts, custom decks loaded
  from the registry).
- `src/tests/elements.test.js` — T11 validation suite (`runElementTests()`):
  pure element-model tests (add/update/remove, bounds clamping, z-order
  persistence, round-trip) + DOM tests that drive the Layers toolbar (add text/
  shape, select, drag, resize, Delete, double-click edit, re-mount).
- `src/tests/present.test.js` — T12 validation suite (`runPresentTests()`):
  DOM tests that open the presentation overlay, navigate by click and keyboard,
  verify read-only rendering of layered elements, and exit via Esc/×.
- `src/tests/files.test.js` — T13 validation suite (`runFileTests()`): pure
  FileSystem tests (create/list/get/saveAs/save/restore/remove) + DOM tests
  that drive the Desktop Files sidebar (list, Save… active window, open loads
  content into a window, re-open focuses, delete, empty state).
- `src/tests/naming.test.js` — T14 validation suite (`runNamingTests()`): pure
  naming tests (create-with-name, rename, per-app duplicate rejection on
  create/rename, empty-name rejection, cross-app reuse, self-rename, trimming)
  + DOM tests for the sidebar's inline rename editor (success + duplicate
  rejection keeps the old name).
- `src/office.css` — business-template look: Lato, trust-blue `#0a58ca`, light
  surfaces, soft radii. App colors come from config (`--c` custom property).
  Also hosts the app surfaces' styles: sheets grid + formatting toolbar
  (`.ss-*`), the slides deck + nav (`.sl-*`), the layered-element +
  presentation styles (`.sl-elt*`, `.sl-present*`), and the file-explorer
  sidebar (`.fs-*`).

## Routes

`#/home` (default) · `#/app/docs` · `#/app/sheets` · `#/app/slides` · `#/app/mail`

## Roadmap

The per-app roadmap lists live on the scaffold app views (rendered from each app
module). Documents is the furthest along: rich-text editing (T4), HTML/TXT export
(T5) and the one-click Templates menu (T6) are live, with the page metaphor and
per-user kv-plugin saves still to come. Spreadsheets (T7+T8+T9) now has a real
editable grid with live formulas — `=SUM(A1:B1)`-style arithmetic, AVERAGE/MIN/
MAX/COUNT, ranges, references and cycle-safe errors — plus a full cell
formatting engine (alignment, fill, font color, bold/italic, per-cell and
persisted in the doc meta, fully separate from values). Presentations (T10) now
has a real navigable deck: 16:9 business slides with keyboard + button
navigation, persisting to the registry — plus (T11) discrete layered elements
(text boxes + shapes: add/drag/resize/nudge/delete, bounds + z-order
persisting) and (T12) a full-screen read-only presentation mode. The Desktop
workspace now has a virtual file system (T13+T14): a Files sidebar lists saved
documents grouped by app, Save… stores the active window as a named file, Open
loads it back into a workspace window, and per-app unique names are enforced on
create/rename. Mail remains a scaffold. Keep the shared chrome (rail, head bar,
card styles, desktop windows, file sidebar) in office.js / office.css.
