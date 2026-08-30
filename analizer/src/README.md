# Generator Analyst — Roadmap (feature TODO list)

An interactive feature-TODO / roadmap tracker for the **Generator Analyst** project,
themed and built on **rathji-template** (https://perchance.org/rathji-template) as its
theme and feature base.

## What this generator is

- Presents the Generator Analyst roadmap (15 tasks across 5 phases) as a tickable
  feature TODO list.
- The task list itself lives in `main.pjs` as the `gaRoadmap` list — the canonical
  source of truth. Edit tasks there and the page updates.
- Interactive status (Not started / In progress / Done) is stored in `localStorage`
  under `gaRoadmapStatus` (`{"<phaseId>-<taskNo>": 0|1|2}`).
- Implements the roadmap tasks one at a time, in order, per the workflow rules.
  Currently: **all 15 tasks across all 5 phases are implemented and complete**
  (fetching → snapshots → diffing → AI querying → analysis → export).

## Architecture

- `main.pjs` — `$meta`; plugin imports (`kv = {import:kv-plugin}`,
  `superFetch = {import:super-fetch-plugin}`); the rathji components
  (`rathjiTemplate`, `rathjiCard` + their options/preset lists + resolve/stamp
  helpers); the `gaRoadmap` checklist list.
- `index.html` — the rathji dark theme (CSS variables, nav + settings panel with
  theme/accent/size/reduce-motion, toasts, modal), plus the app logic:
  - **Block 1 — roadmap tracker**: loads phases from `root.gaRoadmap.phase.selectAll`,
    renders phase cards + task rows with status cycling, overall + per-phase progress
    bars and chips, exports (markdown/txt/json + copy-to-clipboard of the `.pjs`
    checklist), badge/card live demo, fixed bottom-right task counter pill
    (`#taskCounter`, first uncompleted task).
  - **Block 2 — toasts + settings panel** (shared by tracker and workbench).
  - **Block 3 — workbench (tasks 1–15)** + its HTML section "Generator Analyst —
    Live workbench": a two-panel layout (inputs + modes left, reports right) with
    fetch, snapshot, diff, AI query, analysis, and export modes (see below).

## Workbench (tasks 1–15)

A live mini-app: analyze any generator by fetching, snapshotting, diffing, and
chunking its source.

- **Task 1 — Fetch Source**: enter a generator name, click Analyze. Fetches via
  `root.superFetch` from the public Perchance API:
  - `getGeneratorsAndDependencies` (returns `main.pjs` in the `code` field, for the
    target + all transitive `imports/`)
  - `getGeneratorHtml` (returns the target's `index.html`)
- **Task 2 — Source Aggregation**: the fetched sources are aggregated into a single
  flat list of `{name, type, content}` "files" — `main.pjs`, `index.html`, plus one
  entry per import (type `import`). Render shows each file as a preview card with
  line counts; the full source is kept in a global `gaFiles` array for later phases.
- **Task 3 — Loading States**: while fetching, a spinner + progress bar
  (`setLoad`) shows aggregate progress; errors (missing generator, fetch failure)
  surface as a toast + inline error panel. Buttons disabled during load.
- **Task 4 — Save Snapshot**: "Save snapshot" writes the whole analysis to kv:
  - `kv.gaSnapData.<name>-<ts>` — full snapshot (generator name, timestamp, all files)
  - `kv.gaSnapIndex.<name>` — array of metadata entries `{id, ts, fileCount, size}`,
    newest-first
- **Task 5 — Snapshot Retrieval**: "My snapshots" lists saved snapshots per generator
  (from the index), each with Load / Diff vs fresh / Delete actions.
- **Task 6 — Snapshot Deletion**: per-snapshot Delete button (confirm modal) removes
  both the `gaSnapData` entry and its `gaSnapIndex` metadata.
- **Task 7 — Textual Diff Engine**: `lineDiff(old, new)` — a line-level LCS diff
  (with a coarse prefix/suffix fallback for very large files) producing standard
  hunks `{oldStart, oldLines, newStart, newLines, ops}`. "Diff vs fresh" compares a
  saved snapshot (old) against the last fresh fetch (new) across all files
  (added/changed/removed), rendered as a colored unified diff.
- **Task 8 — Structural Change Detection**: `parseStructures(code)` parses the top
  level of a `.pjs` into lists / functions / imports / assigns (with block hashes);
  `structuralDiff` then reports added / removed / modified structures.
- **Task 9 — Human-Readable Diff Summary**: the diff card shows a "🚀 New Features"
  block (new files, lists, functions, configs) and a "⚠️ Potential Breaking Changes"
  block (removed/changed lists/functions, dependency updates, removed files).
- **Task 10 — Context Chunking**: `chunkSource(files)` splits the source into
  LLM-sized chunks (~120 lines / ~6 KB max), each tagged with
  `filename:startLine-endLine`; a Chunks card lists them with line/byte stats and
  per-chunk previews.
- **Task 11 — Implementation Querying**: `askQuery(q)` scores chunks by keyword
  matches (per-term token scoring against the `chunkSource` tag + content) and
  calls `root.generateText` to answer with a prompt that cites used chunks; the
  answer streams into the Query panel with the used-chunk chips shown.
- **Task 12 — General Analysis**: `runAnalysis()` (auto-triggered in Analysis mode
  when there's a source but no analysis yet, guarded by `analysisRunning`) produces
  a feature inventory (per-file lists/functions/imports/config tags from
  `parseStructures`), a visual dependency tree (`renderDepTree`, recursively
  resolving `{import:x}` across the fetched files), and a streamed AI architectural
  overview via `root.generateText`.
- **Task 13 — Two-Panel Layout**: `.wb-layout` CSS grid — 260px sticky left column
  (Inputs card, Mode tabs Source/Diff/Query/Analysis, Snapshots card) + fluid right
  panel (`#gaRight` with loading/error/`#gaModeHint` and the per-mode panels).
  Mode switching via `setMode(mode)`/`syncViews()` honoring the `hasSource` /
  `hasDiff` / `hasAnalysis` flags + `modeHints`; collapses to a single column under
  `@media (max-width:920px)`.
- **Task 14 — Report Rendering**: per-mode panel renderers — `renderFiles`,
  `renderDiff`, `renderSummary`, `renderStruct`, `renderUnified`, `renderChunks`,
  `renderDepTree` — plus streamed AI answer/overview output.
- **Task 15 — Export**: `downloadText(filename, text)` Blob downloads;
  `exportReport(kind, fmt)` exports the cached `reports.{diff,query,analysis}` in
  markdown / txt / json (diff JSON = raw hunks with line numbers + text, new
  features and breaking changes).

## Notes / gotchas

- The Perchance engine evaluates `[...]` even inside `//` comments in main.pjs and
  inside HTML text — never write literal `[ ]`/`[x]` square-bracket markers in either
  (use `( )`/`(~)`/`(x)` in comments, `☐`/`◐`/`☑` in HTML).
- `status` is a reserved/engine-provided global on the page — the app uses
  `taskStatus` instead.
- `main.pjs` checklist markers use `( )`, `(~)`, `(x)` in comments to avoid engine
  square-bracket evaluation; the markdown/export versions use `[ ]`, `[~]`, `[x]`.
- Plugins are always accessed via `root` (`root.kv...`, `root.superFetch(...)`) —
  never as bare names in workbench/module code.
- `getGeneratorsAndDependencies` only returns `main.pjs` content (per generator);
  `index.html` must come from `getGeneratorHtml`. Import names can differ in case
  from their folder name (`parseGeneratorName` matches case-insensitively).
- Snapshots are stored per-user in IndexedDB (kv-plugin), so they persist across
  reloads but are not shared between users.
