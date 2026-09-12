# PM-U — Project Manager

**PM-U** is the *Project Manager* member of the **Project U** family of small-business
generators. It is a local-first workspace for portfolios, projects, tasks, a calendar,
boards, notes, habits, a focus timer, reporting and AI assistance.

- **Built on:** [Template-U](https://perchance.org/template-u) — the shared Project U
  framework (shell, theming, router, registry, components).
- **Feature baseline:** forked from `project-master`; its feature modules were vendored
  into `src/pm/*` and are mounted through thin adapters in `src/views.js`.
- **Data rule:** *everything lives in the browser* (IndexedDB via the `kv-plugin`).
  Nothing is ever uploaded. The only network call the app can make is the one the user
  explicitly triggers in the AI Assistant / weekly report (prompt text to the AI service).
- **Family rule:** other Project U members are linked, **never** imported. See
  [`INTEGRATION-SPEC.md`](INTEGRATION-SPEC.md).

> New here? Read this file top to bottom, then [`CUSTOMIZATION.md`](CUSTOMIZATION.md)
> (how to rebrand/reshape it), [`CLONE-GUIDE.md`](CLONE-GUIDE.md) (how to start a new
> family member) and [`API.md`](API.md) (the Template-U developer API).

---

## 1. Quick start

The app is a normal Perchance generator: `main.pjs` + `index.html` + the `src/` file
tree. There is no build step.

**Run the tests** from the live preview console (or any module context):

```js
// Template-U framework suite — 38 assertions
(await import("./src/tests/index.js")).runAll();

// PM-U data/feature suite — 566 assertions (returns a per-suite summary map)
(await import("./src/pm/tests.js")).runAllTests();
```

The **Diagnostics** view runs both suites in-app. Every test uses a throwaway
`pm_test_*` kv folder, so the user's real data is never touched.

**Boot chain:** `index.html` (static shell) → `src/app.js` (module) →
config → storage → branding → theme → toaster → PM store → registry → router.

---

## 2. Architecture at a glance

```text
index.html ................ static shell only (header / sidebar / #puMain / toast+modal roots)
   │  <script type="module" src="src/app.js">
   ▼
src/app.js ................ boot + wiring; owns the live instances (window.PU.app)
   │
   ├── src/framework/* ..... Template-U core (no PM knowledge)
   │      utils · dom · bus · store · storage · theme · branding · router · registry · meta · pu
   ├── src/components/* .... shared UI suite (inputs · toast · datatable)
   ├── src/styles.css ...... shell + theme tokens        src/views.css ... PM view styles
   │
   ├── registry ........... one entry per section; nav + router routes derive from it
   ├── router ............. hash routes (#/section?param=value) → render(outlet, ctx)
   │
   ▼
src/views.js .............. per-section adapters: render(outlet, ctx) → feature module
   │
   ▼
src/pm/* .................. the features (ported from project-master)
   │  read/write …
   ▼
src/pm/store.js ........... single source of truth (in-memory Map) → debounced autosave
   │
   ▼
kv-plugin folder "pm" ..... IndexedDB (records + __settings + __meta); local only
```

### The view-adapter pattern

Every section is a thin adapter, not a page object. `src/views.js` exports one
`{ render(outlet, ctx) }` per section; each delegates to a feature module's
`xxxViewHTML(store, …)` (returns a trusted HTML string) followed by `wireXxx(store, …, ctx)`
(attaches DOM listeners). `app.js` registers each section with the framework registry:

```js
registerView("tasks", { label: "Tasks", icon: "check", group: "Plan", order: 30 }, views.tasks);
```

The registry drives both the sidebar and the router, so **adding a section = one
`registerView` call + one adapter export** (see [`CUSTOMIZATION.md`](CUSTOMIZATION.md)).

Feature modules render *strings* and attach listeners by `[data-*]` hooks; form-heavy
editors build DOM through `src/pm/formkit.js`, which bridges PM's editor patterns to the
Template-U input suite (`src/components/inputs.js`).

---

## 3. Directory map

### Top level (ships with the generator)

| Path | Role |
| --- | --- |
| `main.pjs` | `$meta` (title/description/image/tags), the `kv` + `generateText` plugin imports, and the `pu` config block (branding/naming/storage). The only file a rebrand usually needs. |
| `index.html` | Static shell: theme pre-paint script, header (logo/search/theme/settings), sidebar, `#puMain`, modal/palette/toast roots. No application logic. |

### `src/` — framework

| Path | Role |
| --- | --- |
| `app.js` | Boot + wiring: config, storage, branding, theme, toaster, store, registry, router, shell chrome, palette, quick capture, save indicator, Project-U descriptor. |
| `views.js` | Per-section adapters (the only bridge between the router and the feature modules). |
| `framework/utils.js` | Shared utilities (strings, numbers, dates, debounce/throttle, objects, collections, colour helpers). |
| `framework/dom.js` | `h()` element builder, `svgIcon()`, tiny DOM helpers, `ICONS`. |
| `framework/bus.js` | Topic event bus. |
| `framework/store.js` | Small reactive store (`createStore` / `withPersistence`). |
| `framework/storage.js` | Namespaced `localStorage` wrapper with in-memory fallback. |
| `framework/theme.js` | Theme palettes, `data-mode`/`data-theme` resolution, pre-paint boot script. |
| `framework/branding.js` | Branding/config controller; turns primary/accent hex into `--pu-*` tokens. |
| `framework/router.js` | Hash router (`#/section?param=value`). |
| `framework/registry.js` | Section registry (enable/disable, groups, order). |
| `framework/meta.js` | Framework/template metadata helpers. |
| `framework/pu.js` | Aggregates the framework as `window.PU`. |
| `components/inputs.js` | Field suite: `textField`, `textareaField`, `selectField`, `toggleField`, `checkboxField`, `radioField`, `button`. |
| `components/toast.js` | Toaster (auto-dismiss, pause-on-hover, action buttons). |
| `components/datatable.js` | Searchable/sortable data table (reflows to cards on mobile). |
| `styles.css` | Shell, layout, `--pu-*` tokens, light/dark themes. |
| `views.css` | PM view styling plus a legacy→`--pu-*` token bridge for the ported modules. |
| `member.json` | Static copy of the Project-U member descriptor (mirrors `PU.member`). |
| `tests/` | Template-U framework tests + harness (`runAll()`). |

### Feature modules (`src/pm/`)

| Module | Responsibility |
| --- | --- |
| `store.js` | Persistence layer: `Store`, `SCHEMA_VERSION`, `BACKUP_APPS`, `ENTITY_TYPES`, `DEFAULT_SETTINGS`. |
| `ui.js` | Shared primitives: `$`, `esc`, `toast`, `notify`, `openModal`, `confirmDialog`, `appTitle`/`appSlug`. |
| `formkit.js` | Bridge to the Template-U input suite + PM-specific field/modal helpers. |
| `icons.js` | Inline SVG icon set used across PM views. |
| `dates.js` | Local-timezone-safe date helpers. |
| `dashboard`/`today` | `views.js` dashboard cards + the daily planner (`today.js`). |
| `projects.js` | Projects hub, project editor, workspace tabs (Overview/Tasks/Board/Timeline/Gantt/Notes/Brainstorm), milestones, Kanban, brainstorm. |
| `tasks.js` / `taskEditor.js` / `taskTools.js` | Global tasks view; full task editor + subtasks; recurrence, dependencies, time tracking. |
| `portfolio.js` | Cross-project portfolio (progress, overdue burn-down, focus heat). |
| `calendar.js` / `events.js` | Month/week calendar + day panel; event records & editor. |
| `checklists.js` | Multiple checklists + built-in templates. |
| `notes.js` | Note editor, pinning, filters, `.txt/.md/.docx/.doc` import, attachments hook. |
| `habits.js` | Weekly grids, streaks, 84-day heat grid, dashboard opt-in. |
| `focus.js` | Pomodoro timer (work/short/long), ring, session logging. |
| `boards.js` | Board hub + 9 brainstorming tools (mind map, Venn, pros/cons, SWOT, impact/effort, MoSCoW, RICE, decision, affinity). |
| `tags.js` | Global tag manager (colours, rename/merge, remove). |
| `palette.js` | `Ctrl/Cmd+K` global search / command palette. |
| `quickcapture.js` | Floating capture pill + `N` hotkey with a natural-language parser. |
| `attachments.js` | Local data-URL file attachments for tasks/notes. |
| `backup.js` | Versioned snapshots in a `pm_backups` kv folder (throttled, pruned to 30). |
| `exports.js` | CSV / Markdown / `.ics` file exports. |
| `report.js` | Weekly report snapshot + streaming AI summary modal. |
| `assistant.js` | Data-aware streaming AI assistant + quick actions. |
| `gantt.js` | Per-project Gantt chart (bars, actual overlay, milestones, deps, today line). |
| `integrate.js` | Project-U registry, shared-id scheme, deep links, member descriptor (pure). |
| `identities.js` | Shared company/customer identities + cross-app references. |
| `migrate.js` | Import/upgrade `project-master` backups into the PM-U v2 schema (pure pipeline + UI). |
| `tests.js` | The PM data/feature test suite (`runAllTests()` + per-phase suites). |

---

## 4. Data & persistence

- **One store, one source of truth.** `src/pm/store.js` keeps every record in an
  in-memory `Map` keyed `r:<type>:<id>`. Views read from it and write through
  `store.create/upsert/remove`; a subscription re-renders the active view.
- **Autosave.** Mutations mark records dirty; a debounced (~800 ms) save writes **only
  the changed records** into the `kv` plugin folder `pm`. Settings (`__settings`) and
  schema metadata (`__meta`) ride the same pipeline. `attachFlush()` flushes pending
  writes on `visibilitychange`/`beforeunload`.
- **Entity types** (schema **v2**): `project`, `task`, `event`, `checklist`, `note`,
  `habit`, `board`, `focuslog`, `company`, `customer`. v2 added the shared-identity types.
- **Backups.** `store.exportAll()` produces the envelope
  `{ app, schemaVersion, exportedAt, settings, entities }`; `validateBackup()` /
  `restoreFromBackup()` accept it. `BACKUP_APPS` lets PM-U also restore the inherited
  `project-master` / `project-manager` envelopes natively.
- **Migration.** `src/pm/migrate.js` is a pure pipeline
  (`detectBackup → planMigration → validateMigratedPayload → applyMigration`) that
  upgrades a v1 backup to v2, normalises each record, repairs dangling references and
  reports what it changed. Two entry points (Dashboard and Settings).
- **Snapshots.** `src/pm/backup.js` keeps rolling full-workspace snapshots in a separate
  `pm_backups` kv folder, pruned so only the newest 30 survive.
- **No uploads.** There is no `upload-plugin`/`server-plugin` usage and no record data
  ever leaves the device. Never add `localStorage` reads for app state — use
  `app.storage` (namespaced) or the kv `Store`.

---

## 5. Integration with Project U

PM-U implements the family **reference-not-copy** contract on its own side:

- A machine-readable **member descriptor** (`src/member.json`, published as `PU.member`)
  tells the central hub how to list, theme and launch PM-U.
- A **shared-id** scheme `puid~<app>~<kind>~<uid>` ties the same real-world company or
  customer across members; `company`/`customer` are first-class local records.
- **Cross-app references** (`refs:[{app,type,id,label}]` on owners) build read-only deep
  links into siblings.
- An inbound `?ref=<sharedId>&name=<label>` link lets a sibling hand an identity to PM-U.

Full contract, rationale and a checklist for new members: [`INTEGRATION-SPEC.md`](INTEGRATION-SPEC.md).

---

## 6. Conventions

- **IDs** are suffixed by kind: `questEl`, `rerollBtn`, `dashPanelCtn`, `titleInput`.
  Elements with an `id` are referenced directly as globals (e.g. `dashReportBtn`) or via
  `$("#id")` from `src/pm/ui.js`.
- **Trusted vs untrusted HTML.** Feature modules return HTML strings; any user-entered
  text interpolated into them must go through `esc()` (from `ui.js`). Prefer DOM building
  (`h()` / `formkit`) for interactive editors.
- **Theming.** Use `var(--pu-*)` tokens, never hard-coded hex, so brand/theme overrides
  apply everywhere.
- **Data flow.** Mutate through the store; never cache derived state that a store
  subscription can recompute.
- **AI prompts.** Keep them prefix-cache-friendly: *fixed context → append-only log →
  the single varying task line at the end* (see `assistant.js` / `report.js`).
- **Module headers.** Every module starts with a `// src/xxx.js — …` comment describing
  its responsibility and any roadmap task numbers.
- **New code goes in `src/`**, not inline in `index.html`; keep `main.pjs` for config and
  Perchance lists.
- **Family consistency.** Don't fork `src/framework/*` per generator — upstream generic
  improvements to Template-U instead (see [`CLONE-GUIDE.md`](CLONE-GUIDE.md)).

---

## 7. Documentation index

| Doc | Contents |
| --- | --- |
| `README.md` (this file) | Purpose, architecture, data model, conventions. |
| [`CUSTOMIZATION.md`](CUSTOMIZATION.md) | Every point where PM-U can be rebranded or reshaped. |
| [`CLONE-GUIDE.md`](CLONE-GUIDE.md) | Step-by-step guide to clone PM-U into a new family member. |
| [`INTEGRATION-SPEC.md`](INTEGRATION-SPEC.md) | The Project-U reference-not-copy contract. |
| [`API.md`](API.md) | Template-U developer API (`window.PU`, framework modules, components). |
