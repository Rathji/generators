# Project-U

The central **dashboard hub** for the Project U family of small-business
generators. Project-U is the front door: it launches every member tool, searches
across the whole suite, and surfaces what needs attention from one responsive
workspace.

Built on the shared **`template-u`** framework conventions (responsive shell,
token-based theming, `pu-` component library, in-browser test suite).

> All build phases are complete. See **Status** below for what each one delivered.

---

## Status

- **Phase 1 (Identity & Registry Foundation) — complete.** Generator slug,
  `$meta` and the `pu` config block are in place; the member registry, global
  workspace/account state and the responsive navigation shell are built and
  verified at phone and desktop widths.
- **Phase 2 (Launcher & Navigation) — complete.** Home is now a launcher grid of
  member cards (icon, name, category, one-line description, tags) with registry
  accent colors, deep links to each member's top-level page, a copy-link control,
  and an active/"in focus" state.
- **Phase 3 (Global Search & Command Palette) — complete.** Ctrl/⌘+K (or the
  header search trigger) opens a scroll-locked command palette that searches
  members, enabled sections and quick actions in real time, deep-links into
  members on Enter, and copies member links on Alt+Enter.
- **Phase 4 (User Preferences & Tracking) — complete.** Launcher cards carry a
  pin toggle that floats favourites to the top, a "Recently used" card under the
  banner tracks the last N launched members, and both persist in local storage.
  Settings is now a tabbed preference panel (Appearance, Branding, Preferences,
  Components, Data, About) managing account details, launcher/history behaviour
  and the pinned/recent lists.
- **Phase 5 (Aggregated Activity Feed) — complete.** A new `Activity` section
  streams "latest items" from every member (quotes, tickets, renewals, docs,
  framework releases) served by a deterministic simulated API, colour-coded by
  the originating generator's accent and grouped by day. A quick-stats row rolls
  the stream up into counts ("Open quotes", "Pending tickets", "Renewals due",
  "Draft invoices" + "Needs attention"), and Home previews the latest three
  events.
- **Phase 6 (Integration & UX Polish) — complete.** The launcher and Activity
  page now show shimmer skeletons while their data loads (the member directory
  is fetched asynchronously; the activity source has latency), degrade gracefully
  when a fetch fails (bundled-registry fallback with retry on Home; a blocking
  error block plus an inline refresh warning in the feed; an "unavailable" stats
  strip on Activity), and the feed is deep-linkable
  (`#/activity?member=quote-u&kind=quote`). Responsive behaviour was re-audited
  from 390 to 1920 px.
- **Phase 7 (Final Review, Documentation & Polish) — complete.** A full
  end-to-end review fixed a handful of small defects (an empty icon on
  danger-tone banners, a stale `Docs` path in Settings, an empty `Plugins` row
  when the hub needs no plugins), the in-app **About & user guide** was extended
  to cover loading/empty/error states, deep links and notifications, and the
  build checklist was retired so only genuine documentation ships.

## Layout

```
main.pjs                 identity + `pu` config block (read by src/app.js)
index.html               application shell: header + sidebar + main + boot script
src/
  styles.css             design tokens, base, layout, components, utilities
  app.js                 boot: config → storage → branding → theme → state → registry → router
  framework/
    pu.js                window.PU runtime namespace (developer API surface)
    meta.js              framework metadata + dependency report
    members.js           MEMBER REGISTRY — the -U suite (name, url, icon, accent, …)
    state.js             global app state: active workspace + current user + active member
    launch.js            deep-link launch, active-member focus, copy-link (PU.launch)
    commands.js          searchable command model + scorer + run dispatch (PU.commands)
    preferences.js       pins + recents + preference set, persisted (PU.preferences)
    activity.js          aggregated suite activity: model, mock API, summaries (PU.activity)
    utils, dom, bus, store, storage, theme, branding, router, registry
  components/            inputs, toast, datatable, command-palette, activity-feed, skeleton
  views/                 home (launcher grid), activity (feed + stats), settings, about, tests, helpers
  tests/                 harness + suites + registry
```

Everything is plain ES modules served from `src/` — no build step.

### Boot quirks

- The Perchance editor loads previews inside a `#edit` sentinel hash. `src/app.js`
  normalizes that to "no deep link" before `router.start()`, so the hub always
  opens on its default section instead of the 404 route. Real `#/section` deep
  links are left untouched.
- `src/framework/state.js` recomputes user initials whenever the name changes
  (unless a caller passes `initials` explicitly).
- The launcher (`src/views/home.js`) opens members via
  `src/framework/launch.js`, which marks the launched member as active
  (`state.activeMemberId`) so the hub can show what is "in focus". Copy-link
  prefers the async clipboard API and falls back to a hidden textarea when it is
  unavailable (e.g. a sandboxed preview).
- The command palette (`src/components/command-palette.js`) is the single global
  search surface. It pulls its rows from `src/framework/commands.js`
  (`PU.buildCommands`) via a `getCommands()` callback, so it always reflects the
  current member registry + enabled sections, and it owns its own scroll lock
  (`body.pu-palette-open`), focus handling and document listeners. Ctrl/⌘+K is
  registered by the component itself; `src/app.js` only supplies `getCommands`
  and `onRun`.
- Gotcha: in some embedded/preview contexts `document.hidden` is true, which
  freezes CSS animations at frame 0. Never give an entrance animation an
  `opacity: 0` starting frame if the element must be visible — the palette's
  entrance is transform-only for this reason.
- Pins and recents live in `src/framework/preferences.js` and persist through
  `createStorage` under `prefs:v1` (namespaced `pu-project-u:*`). The controller
  normalises anything loaded from disk (`normalizePreferences`), clamps the
  history length, and broadcasts changes so the current route re-renders. The
  launcher and command palette both order members through
  `preferences.orderMembers` (pins first, unless `pinFirst` is off), and every
  launch records a recent. Access it at runtime via `PU.preferences`.
- The activity feed is served by `src/framework/activity.js`. `generateActivity`
  is **deterministic** (seeded mulberry32) so the feed is stable across renders
  and the suite is reproducible; `createActivitySource` wraps it in an async
  `fetch()` with simulated latency and optional `refresh()` (new arrivals). It is
  presentation-agnostic — `src/components/activity-feed.js` renders whatever the
  source returns, and `src/views/activity.js` adds the quick-stats row and the
  per-generator breakdown. Swap the source for a real `fetch`-backed one and no
  UI code changes. Access it at runtime via `PU.activity`.
- The member directory is asynchronous: `createMemberSource` in
  `src/framework/members.js` resolves the registry with a short simulated
  latency and caches it (inject a `loader` to point at a real endpoint). Until it
  answers Home renders skeleton cards (`src/components/skeleton.js`); if it
  fails, Home falls back to the bundled `MEMBERS` list with a warning banner and
  a "Try again" that calls `app.reloadRoster()`. Access it via `PU.roster`.
- Loading/error states are exercisable without touching the registry: append
  `?fail=registry` and/or `?fail=activity` (comma-separated) to the page URL and
  `src/app.js` wires the corresponding source to reject, so both failure paths
  can be inspected in the live preview.
- The `Activity` section is deep-linkable. `#/activity?member=<id>&kind=<kind>`
  opens the stream pre-filtered (the heading names the filter and a "Clear
  filter" action appears); the router parses and rebuilds these query params
  (`createRouter(...).resolve/href`). The feed's filter toolbar hides itself
  whenever there is nothing to filter (loading / empty / error), and a failed
  *first* fetch shows a blocking error while a failed *refresh* keeps the last
  good stream and warns inline.

## Conventions

| Concern | Convention |
| --- | --- |
| CSS prefix | `pu-` (tokens `--pu-*`) |
| Storage keys | `<storageNamespace>:*` (currently `pu-project-u:*`) |
| Default theme | `navy` (light-mode) |
| IDs | suffix by type: `…Btn`, `…El`, `…Ctn`, `…Input` |
| Views | `export function render(outlet, ctx)` |
| Config | edit the `pu` block in `main.pjs` (never hard-code in views) |

Member links must point at the **top-level** page:
`https://perchance.org/${window.generatorName}` — never a subdomain URL.

## Testing

The suite is an ES module. From the preview console (or a Tests view once the
shell exists):

```js
const { runAll } = await import("./src/tests/index.js");
await runAll(); // → { ok, passed, failed, total, suites }
```

Add a suite under `src/tests/`, then export it from `src/tests/index.js`.

## Documentation

This README is the project's reference documentation. The in-app **About & user
guide** (the About section) is the end-user counterpart — it documents every
screen, the command palette, the activity feed, and the loading / empty / error
states.

**Listing image.** `$meta.image` in `main.pjs` points at a 1200×630 screenshot of
the Home launcher (captured with the editor's `snapshot.js` helper and cropped to
16:8.4). Re-capture it the same way if the launcher look changes.

## Reference

`template-u` — https://perchance.org/template-u — the framework whose shell,
theme engine, components and plumbing this project inherits.
