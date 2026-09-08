# Business Intelligence Dashboard

A BI Reporting system for Perchance — the reporting cockpit for the whole
small-business pipeline. It pulls every participating tool's bundles from the
shared bus (the-ledger, project-master, idea-incubator, CRM, PSA, ERP, KB/SOP),
normalizes them into uniform facts, and renders live dashboards and reports.

**Guiding principle: the BI is NEVER a source of truth.** Every number traces
back to the tool that owns it; the BI only reads each tool's published bundles.
Adding a report for a new tool must be *configuration*, not code.

## Status

**All 38 roadmap tasks complete** (see `bi-roadmap.pjs` at the project root for
the per-task checklist + done notes). 11 test suites, 493 assertions, all green
(`await BI.runAllTests()`). Layouts verified at desktop (1920×1080) and mobile
(390×844); the sidebar collapses to an off-canvas drawer below 1024px.

## Architecture & data flow

```
tools publish bundles (stable public URLs, edit-count versioned)
        │  manifest (list of every tool + bundle type + URLs)
        ▼
BI.bus ── pull/validate/cache (keyed by tool|bundleType|editCount)
        ▼
BI.extractors ── one extractor per bundleType → uniform facts
        ▼
facts { tool, bundleType, period, dimension, measure, value }
        │  (BI.facts.filter / group / aggregate / timeBuckets)
        ▼
report definitions (canonical docs) → BI.reporting
        ▼
BI.viz ── chart adapter → data-visualization-plugin SVG → cards
        ▼
Dashboards (cards), CSV export, snapshot bundle, embed widget
```

The BI shell itself is a reporting **cockpit**: it never owns data, never
mutates a tool's bundle, and every remote change flows through the same
idempotent, version-checked document layer (`BI.store`).

## File layout (`src/bi/`)

- `core.js` — `window.BI` namespace, module registry (`BI.modules`, `BI.register`),
  utils, icons.
- `ui.js` — `BI.ui.state` (empty/loading/error), `pageHead`, `card`, `badge`,
  `toast`.
- `theme.js` — light/dark (`html[data-theme]`, persisted `bi-theme`).
- `catalog.js` — `METRICS` (~26 entries: label, unit, default chart type,
  higher/lower-is-better), `TOOLS`, `CHART_TYPES`, `PERIOD_GROUPINGS`,
  `DATE_RANGES`, `fmt`/`fmtDelta`.
- `store.js` — canonical document store (versioned envelopes, edit keys,
  reconcile, conflicts, audit, capacity, archive). See below.
- `errors.js` — 36 error codes, each `{title, message, nextStep}` in plain
  language.
- `bus.js` — manifest discovery, bundle pull/validate/cache, tool health &
  staleness, changed-detection.
- `extractors.js` — one extractor per bundleType → uniform fact records.
- `facts.js` — `BI.facts.filter(measuresArray, {tools, filters, from, to})`,
  `group`, `aggregate`, `timeBuckets`, `valueForGroup`. NOTE: `filter` takes an
  ARRAY of measures first, not a single measure object.
- `reporting.js` — date-range/previous-period bounds, `compare`, `toCSV`,
  views/saveView, templates, duplicateDashboard, **38 report presets**.
- `viz.js` — `charts(ctx, report, opts)` adapter, `recommend`, `themeOpts`,
  `kpiHTML`, `sparkSVG`, `tableHTML`, `drillChips`.
- `backup.js` — full backup (download + published doc), validated restore.
- `snapshot.js` — compact `bi/snapshot/v1` JSON of headline KPIs, published as
  a canonical doc with edit-count freshness tracking.
- `embed.js` — `#/embed/<reportId>` single-card widget + copy-paste snippet.
- `integrity.js` — 7 automated integrity checks + visible health badge.
- `cards.js` — card renderer (title, chart/table, delta, staleness badge,
  trail/onDrill/onBack/actions).
- `realtime.js` — roles, hub connection, polling fallback, presence, doc
  announcements, report index. See below.
- `modules/dashboards.js`, `reports.js`, `dataSources.js`, `schedules.js`,
  `settings.js` — one per module. Each registers `{id, load(ctx) -> data,
  render(ctx, data)}`. All five use a module-scope `function render` assigned to
  `BI.modules.<id>.render` so internal calls (drill, tabs, search, sign-in)
  re-render through the same path.
- `app.js` — bootstrap: shell, store init + reconcileAll, bus init, integrity,
  realtime init, scheduler, hash router, `BI.runTests` / `BI.runAllTests`.
- `fixtures/` — deterministic test bundles (asOf 2026-09-30): `manifest.json`
  + one bundle per tool (ledger ec14, crm ec9, psa ec7, project-master ec6, erp
  ec5, kb-sop ec4, idea-incubator ec3). ~566 facts total.
- `tests/*.js` — 11 suites: shell 33, store 53, sync 58, backup 26, bus 35,
  reporting 54, viz 26, integrity 15, roundtrip 57, errors 120, multi 16.
- `bi.css` — all styles; theme via custom props; `.bi-spark svg` scales to
  container.

## The canonical document store (`BI.store`)

Every persisted definition is a versioned JSON envelope
`{schema:"bi/doc/v1", id, kind, label, meta, data, version, editCount, ...}`
stored as one editable text file `<nsPrefix><id>` in the generator's editable
namespace (upload-plugin; `nsPrefix = bi1-<publicId8>-`).

- `create` / `update(id, data, {baseVersion})` / `remove` / `get` / `list` /
  `readRemote` / `refreshAll` / `capacity` / `usage` / `status`.
- Edit keys cached in localStorage (`bi.store.key.<id>`), exportable/importable
  for cross-device writes.
- Guarantees: no write exceeds `biConfig.store.ceilingBytes` (default 1 MiB);
  idempotent writes; refused `remote_newer` writes never silently overwrite.
- Reconcile states include `conflict` with a reason (`both_sides_changed`,
  `local_edit_vs_remote_deletion`, `remote_rolled_back`); resolve via
  `resolve(id, "mine"|"theirs"|"field")` (field = three-way merge reporting
  both-sides-changed fields). Capped audit trail. Tombstones prevent restore
  mis-sync.
- `retargetKind(id, "archive")` archives (read-only, originalKind in meta,
  unarchivable), preserving version chain + edit count.

## Realtime hub & roles (`BI.realtime` + `index.html` server block)

- Roles: `viewer` (read published dashboards) / `analyst` (create/edit reports
  + dashboards) / `admin` (manage sources + catalog). Every mutating action is
  authorized both client-side (`can(action, role)`) and **server-side** (rpc
  guards in the `<script type="text/x-server-plugin">` block).
- Admin authentication: the hub stores only the SHA-256 hash of the admin
  password (see `ADMIN_PASSWORD_SHA256` in the server block). The plaintext
  password was given to the owner in chat — it is NOT in any source file.
- The hub broadcasts refresh events per tool topic (`refresh:<tool>`) so open
  sessions learn of new data within seconds while payloads stay in cache/bus;
  `reportIndex` rpc returns the source edit-count index; presence lists who's
  online; changes flow through the store's version-checked layer so the audit
  log records the true actor.
- Degradation: when the hub is unreachable, mode flips to `polling`
  (`pollFallbackMs`) and presence shows offline. While the generator is
  unsaved, `createServerSocket` runs its local emulator — the hub goes fully
  live across devices once the generator is saved and published.

## Wiring a new source tool (the checklist)

1. Add its bundles to the manifest (`biConfig.bus.manifestUrl` →
   `src/bi/fixtures/manifest.json`): tool name, bundle types, stable public
   URLs, bundle schema version.
2. Add an extractor in `extractors.js` for each new bundleType → uniform
   `{tool, bundleType, period, dimension, measure, value}` facts.
3. Add metrics to `catalog.js` (label, unit, default chart type,
   higher/lower-is-better) — that's what makes reports config, not code.
4. Optionally add report presets in `reporting.js` (config arrays) and a KPI
   card on the EXECUTIVE dashboard.
5. Fixtures: add a bundle to `src/bi/fixtures/<tool>/` and extend the
   round-trip suite with hand-computed values.

One broken source never takes down a dashboard: malformed payloads are skipped
with a named error, older schema versions surface a version gap, unpublished
tools show an empty-with-explanation state, stale sources show a staleness
badge.

## Snapshot bundle format (`bi/snapshot/v1`)

Compact JSON: `{ schema, asOf, source, editCount, kpis: { cash, receivables,
payables, revenueLast12m, pipelineValue, weightedForecast, utilization,
atRiskProjects, lowStock, staleKb } }` — consumable by the AI/voice assistant
for numeric Q&A; published as a canonical doc with its own edit-count freshness
tracking. Add a snapshot entry in `snapshot.js` whenever a headline KPI is
added.

## Visualization plugin (`charts`) — accepted shapes

Every chart fn returns a responsive SVG string and accepts: plain arrays,
`{label, value}` objects, `{label, ...numericKeys}` objects, `{labels: [],
series: [{name, data}]}` series, and Perchance lists. Options used by the
adapter: `theme`, `colors`, `title`, `legend`, `tooltips`, `decimals`,
`min/max`, `horizontal`, `stacked`, `percent`, `trend`, `target`, `bin`,
`mode`, `log`. The adapter feeds only plugin-accepted shapes (see `viz.js`).
Charts are static SVG (built-in tooltips, no click handlers) — drill-down is
implemented by the shell regenerating a scoped report with a breadcrumb trail.
Sparklines on KPI cards use a custom `sparkSVG` (the plugin enforces a 160px
min-height + Y-tick text that breaks tiny sparklines).

## Running the validation tests

```js
await BI.runTests("shell")     // single suite -> {ok, results:[{name,pass,detail}]}
await BI.runAllTests()         // all 11 suites -> {ok, suites:{name:{ok,count,results}}}
```

Suites run hermetically against in-memory fake backends / isolated localStorage
prefixes wherever possible and are hardened against prior-state pollution
(dark theme, settings hash, leftover test docs). The store suite's final
scenario is a real-backend smoke test that skips while the generator is
unsaved.
