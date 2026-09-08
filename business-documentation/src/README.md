# Company Knowledge Base (business-documentation)

A knowledge base / SOP system for authoring, organizing, reviewing, and publishing
company documentation — SOPs, policies, how-tos, references, and FAQs — with an
approval workflow, version history, scheduled reviews, AI-assisted authoring,
machine-readable export for the company's AI assistants, and (Phase 9) multi-user
roles & realtime collaboration.

## Build tracking

The build follows an atomic roadmap: **`roadmap.pjs` at the workspace root** (a
41-task checklist in 9 phases). Work proceeds ONE task at a time, strictly in order:
implement the task, write its validation tests, mark it `[x]` in roadmap.pjs, then
stop for review. If `roadmap.pjs` is missing (it lives outside `src/` and is
ephemeral), re-create it from the roadmap document before continuing — the ticked
boxes record what is done.

**Status: 41/41 complete.** All 9 phases are DONE and verified (live demo data
seeded; all suites green: shell 9, store 13, sync 17, content 23). Phase 9 added
multi-user roles & realtime collaboration on the `server-plugin`, layered on top
of the existing single-user document store.

## Document store

Every content module's data is persisted as a **versioned JSON document** under the
KB's own storage namespace (`kb-system`). Implementation lives in `src/framework/store/`:

- `index.js` — `createDocumentStore(...)`: the store itself. Documents are
  versioned (bump on every real change; identical rewrites are free no-ops),
  split into ceiling-bounded chunks (no single write can exceed the storage
  ceiling), cached locally for fast reads, and written with a registry
  compare-and-set guard so concurrent writers are detected rather than
  silently clobbered. Public API: `readDocument`, `writeDocument`,
  `writeMany`, `ensure`/`ensureMany`, `deleteDocument`, `listDocuments`,
  `documentStats`, `meta`, `sync`, `getStatus`, `onChange`.
- `sync.js` — `createSyncEngine(...)`: the sync/conflict layer.
- `chunking.js` — byte-accurate chunk splitting (never splits a surrogate
  pair) + a 64-bit content hash (change detection + integrity checks).
- `backends.js` — cloud channels (upload-plugin editable files = canonical,
  one physical file per name; in-memory Map for tests) and local caches
  (kv-plugin folder per namespace; in-memory for tests).
- `documents.js` — `DOCUMENTS`: the canonical document set (one per content
  module) with seed values, written on first boot only. Documents: `articles`,
  `categories`, `templates`, `snippets`, `reviewLog`, `auditLog`, `settings`,
  `kbBundles`, `attachments`.
- `errors.js` — typed `StoreError`s with stable codes
  (`STORAGE_UNAVAILABLE`, `EDIT_KEY_REQUIRED`, `INTEGRITY`, …).

Physical layout in the cloud (editable files, all lowercase-hyphen names):

    kb-system-registry          small versioned JSON index of every document
    kb-system-<docId>-v<ver>-<hash8>-<i>   one file per chunk (content-addressed)

The registry is the commit point (written last, with a `rev` guard). Chunk
names embed the version AND a content-hash prefix, so different content never
reuses a physical file — the losing side of a conflict physically survives.
Edit keys for the editable files are cached locally in kv (per physical name) —
only the device that created a file can update it; a device without the key
gets a typed `EDIT_KEY_REQUIRED` error and the cloud doc stays intact. Reads
work from any device (cold-start tested).

**Quota note:** the canonical channel is upload-plugin editable files, so
editable-file writes count against the daily upload quota. Heavy automated
testing can exhaust it (writes then fail with a typed "over_daily_allowance"
→ surfaced as "Could not save… Please try again" until quota resets). Reads are
unaffected.

## Sync, conflict & concurrency

`createSyncEngine({ store, cache })` in `src/framework/store/sync.js`. Public
API: `reconcile()`, `stageDraft(id, data, opts)`, `listDrafts()`,
`listConflicts()`, `resolveConflict(id, "mine"|"theirs"|"merge")`,
`getDocStatus(id)`, `getOverview()`, `attach(store)`. Wired in `src/app.js`:
reconcile runs on boot, and Home renders the sync card — summary, per-doc
status, conflict rows (Keep mine / Keep theirs / Merge), and "Check for updates".

- **Reconcile** refreshes the local cache against the canonical registry,
  auto-pushes offline-staged drafts (when the canonical hasn't moved), and
  detects conflicts. Nothing is ever silently discarded.
- **Offline / concurrent writes** never clobber the canonical: a write that
  fails to reach the cloud is preserved as a **draft**; a write that lands but
  finds the canonical moved becomes a **conflict** with BOTH sides preserved.
- **Resolution** (`resolveConflict`): keep-mine writes the draft (bumps the
  version past theirs); keep-theirs adopts the canonical (mine recorded in
  history); merge does a field-level 3-way merge (`merge3`: scalars — the side
  that changed it wins; arrays/objects — unioned by key, so each side's unique
  additions survive). Every resolution is appended to a per-doc resolution
  history in cache.
- **Deleted-remote** is reported as its own state; the local copy is retained,
  never auto-deleted.
- **Chunks are never destroyed on delete** — only the registry entry goes; the
  content-addressed chunk files stay as inert orphans (a stale registry read
  can therefore never find destroyed content).
- **Editable-channel gotcha:** the live channel serves ~10s+ stale reads after
  a write. The store defends with a session-authoritative registry merge
  (re-assert own writes only over provably-stale reads) so a sequential write
  is never misreported as a concurrent conflict.

## Architecture

- **`main.pjs`** — `$meta` + the `kb` boot config (app title, storage namespace,
  seed category tree). Editable content lives in the app's document store, not here.
- **`index.html`** — static shell only: header (incl. the Phase 9 presence pill +
  account button), sidebar (module nav + category tree), main view, toast
  container. Also hosts the **server-plugin script** (`<script type="text/x-server-plugin">`):
  the authoritative hub server (users, roles, sessions, change ring, edit-key
  table, rate limits). No client logic in the shell markup itself.
- **`src/app.js`** — boot: fills header, renders nav + category tree, starts the
  hash router, wires the hub (roles, presence poll, role-gated header actions,
  hub-augmented identity for the audit log), exposes `window.__kb` for
  tests/debug (`store`, `sync`, `content`, `router`, `toast`, `hub`, `integrity`, …).
- **`src/kb-config.js`** — normalizes `root.kb` into plain JS (with defaults).
- **`src/framework/`** — the module framework:
  - `dom.js` — `h()` element builder, selectors, `clear`, `esc`, `tick`.
  - `icons.js` — inline SVG icon set.
  - `states.js` — the ONE consistent set of empty/loading/error states.
  - `toast.js` — transient notifications.
  - `modules.js` — module registry + hash router (`#/home`, `#/browse`, …).
  - `nav.js` — module nav, category tree renderer, mobile drawer.
  - `categories.js` — category-tree provider (store-backed).
  - `content.js` — the KB content layer (see below).
  - `hub.js` — the Phase 9 realtime-hub client (`createHub(...)`): connect/
    reconnect, register/login/logout/change-password + token re-auth, role
    helpers (`roleFor`/`authorize`/`require`/`canWrite`), admin RPCs
    (`listUsers`/`grantRole`/`revokeRole`/`setBanned`), live change events
    (`onChange`/`subscribeCategory`/`watchArticle`/`catchUp`/`announce`),
    presence (`presence`/`onlineUsers`), shared edit keys
    (`getEditKey`/`storeEditKey`/`syncEditKeys`), and the polling fallback when
    the hub is unreachable.
  - `account.js` — the account modal (login / register tabs, change password,
    sign out, role badge) + `renderAccountButton` for the header.
  - `markdown.js` — markdown renderer, heading/TOC extraction, article-link
    (`[[Title|id]]`) parsing + backlink extraction.
  - `diff.js` — line-level diff (insertions/deletions) for the review queue.
  - `store/` — the canonical document store (above).
- **`src/modules/`** — one file per module: `home`, `browse`, `search`, `review`,
  `stale`, `reports` (nav modules) + `article` (reader), `editor` (authoring),
  `admin` (hidden nav, reachable by route), and `shared.js` (view scaffolding) +
  `index.js` (registry). A module is `{ id, label, desc, icon, render(ctx), hidden }`.
  Add a module: create the file, export it from `index.js` — nav + routing pick it up.
- **`src/styles.css`** — full stylesheet; responsive (sidebar → mobile drawer,
  content max-width 1500px, prose max-width 900px).
- **`src/tests/`** — `harness.js` (mini runner) + per-task suites. Run in the live
  page: `await import("./src/tests/shell.test.js").then(m => m.run())`, same for
  `store.test.js` (add `{live:true}` to also hit the real cloud editable files),
  `sync.test.js`, `content.test.js`. Current: shell 9, store 13, sync 17,
  content 23.

## The content layer (`src/framework/content.js`)

Everything above the raw store: `createContentService({ store, cache, activity,
uploadPlugin, generatorName, announce })`. `announce` is an optional Phase 9 hub
hook called after any article-affecting mutation (fire-and-forget) so other open
sessions see a live "updated" event with the true actor. `cache` = kv-backed cache for the namespace;
`activity` = a second kv folder for per-device state (article "seen" timestamps,
follows, checklist ticks). Public API (via `window.__kb.content` / `ctx.content`):
`readDoc`, `writeDoc`, `listArticles`, `getArticle`, `saveArticle`,
`createArticle`, `deleteArticle`, `submitForReview`, `approveArticle`,
`returnArticle`, `markReviewed`, `sendForReReview`, `consistencyCheck`,
`backlinks`, `related`, `search`, `audit`, `backup`, `restore`, `capacity`,
`getCategoryTree`, `getTemplates`, `getSnippets`, `feedback`, `bundleForArticle`,
`refreshBundles`, `publishBundlesPublic`, `getBundles`, `integrityCheck`.

### Article record shape

    { id, title, summary, body, tags[], categoryId, docType, owner, status
      (draft|in_review|published|archived), created{at,by}, updated{at,by},
      reviewedAt, reviewIntervalDays, publishedVersion, versions[{n,at,by,summary,data,status}],
      attachments[], blocks[], links[], processRefs[], feedback[], flags{} }

`normRecord(r)` copies/normalizes — always use it rather than mutating a record
returned by `getArticle` (it is a live reference into the store cache; mutating
it before `saveArticle` corrupts the version diff).

### Document-type templates (task 8)

`templates` document holds one template per doc type. Editor applies the
template's body skeleton on new-article creation:
- **sop** — `# Purpose`, `## Scope`, `## Prerequisites`, `## Procedure`
  (numbered steps), `## Roles & responsibilities`, `## Safety & compliance
  notes`, `## References`
- **policy** — `# Purpose`, `## Policy statements`, `## Compliance &
  enforcement`, `## Review`
- **how-to** — `# Overview`, `## What you need`, `## Steps`, `## Troubleshooting`
- **reference** — `# Overview`, `## Definitions`, `## Details`
- **faq** — `# Questions` with `## question` headings

### Structured SOP blocks (task 9)

SOP articles can carry `blocks[]` = `{ step, ownerRole, expectedOutcome, safety,
notes, checklist[] }`. Editor renders a structured block editor ("+ Add step",
per-step fields + checklist items); the reader renders them as ordered steps with
a checkable checklist; print output emits a printable step-by-step form.

### Review workflow (task 13)

Lifecycle: `draft` → `in_review` (submitForReview, records submitter+time) →
`published` (approveArticle) or back to `draft` (returnArticle, with reviewer
comment). `publishedVersion` pins the version shown as live; when a published
article is edited again it goes to `in_review` with a **pending revision** —
readers keep seeing the last approved version until a reviewer approves the new
one. Transitions are recorded in `reviewLog` and `auditLog`.

### Review scheduling (task 16)

Each article has `reviewIntervalDays` + `reviewedAt`. Articles whose
`reviewedAt + interval < now` appear in the **Stale Content** queue with days
overdue. "Reviewed — no change" calls `markReviewed` (refreshes `reviewedAt`,
keeps version); "Send through workflow" (`sendForReReview`) routes it back to
`in_review`.

### KB bundles (tasks 26, 27)

`refreshBundles()` writes the `kbBundles` document:

    { schema: "kb-bundles/1", updatedAt, count,
      manifest: { format: "kb-bundle/1", generatedAt, generatorName, version },
      articles: { <id>: { schema:"kb-bundle/1", id, title, summary, categoryId,
                          categoryPath, tags, docType, body, version,
                          publishedVersion, updatedAt, permalink:"#/article/<id>",
                          status } },
      categoryIndex: { <categoryId>: [articleIds] } }

Refreshed on every publish (fire-and-forget). `publishBundlesPublic()` additionally
publishes the whole set as ONE plain editable file (`kb-system-bundles`) so any
consumer (AI assistants, scripts) can fetch a single URL
`https://editable.uploads.dev/file/<generatorName>/kb-system-bundles` without
knowing the chunk layout. Idempotent — republishing identical content is a no-op.

### Cross-linking, backlinks, related (tasks 11, 20)

`[[Title|id]]` in markdown = article link. Editor inserts these via a
search-as-you-type picker; `markdown.js` parses them out of bodies; every
article shows a **backlinks** list (who links to it) and **related** articles
from shared tags/category + term overlap.

## Module user workflows

- **Home** — KPIs: articles by status, stale count + oldest overdue, published
  this month, most-updated, recent activity (each clickable through to its
  source), system-health banner (integrity check result), sync & conflicts card.
- **Browse** — category tree + facet filters (category, tag, doc type, status)
  and sort (recently updated / reviewed / popularity); in-list search.
- **Search** — full-text over title/summary/tags/body, ranked by relevance +
  recency, snippets with matching context, no-results state with "Did you mean"
  term suggestions.
- **Review Queue** — submitted articles with base/target version pickers and a
  line-level diff; Approve & publish or Return with comment (goes back to draft).
- **Stale Content** — overdue articles with days overdue; mark reviewed or send
  through workflow.
- **Reports** — KPIs + system health, coverage by category, review compliance %,
  activity by author, low-rated/commented articles, recent activity; CSV export
  and print for any list/report.
- **Article reader** (route `#/article/<id>`) — breadcrumb, TOC from headings,
  structured SOP steps + checklist, backlinks, related, feedback (was this
  helpful 👍👎 + free text), version history (view/restore), follow button with
  "updated since seen" indicator, copy-link permalink.
- **Editor** (route `#/editor/<id>` or `#/editor/` new) — title/summary/body,
  tags, category, owner, doc type + template, review interval; markdown toolbar
  (B/I/H2/H3/lists/checklist/code/link/article-link/snippet/image), live preview
  + TOC chips, structured SOP blocks, attachments, cross-link picker, snippets
  picker, AI draft / polish / what-changed, pre-submit consistency check,
  Save draft / Save & submit.
- **Admin** — 9 tabs: Backup & restore, Capacity & archive, Categories
  (add/rename/move/delete), Templates, Snippets, Identity, Audit log (searchable),
  Users & roles (hub users: grant/revoke roles per category, ban/unban, refresh —
  admins only, enforced server-side), Integrations (bundle publication + process
  links).

## Checklist: adding a new document type

1. Add it to `DOC_TYPES`/`DOC_TYPE_LABELS` in `src/framework/content.js` and the
   editor's `docTypeSel` options (`src/modules/editor.js`).
2. Define its template (body skeleton + structured-blocks section, if any) in the
   `templates` document (Admin → Templates) and the AI outline in `docTypeBlurb()`.
3. If it needs structured blocks, mirror the SOP `blocks[]` handling in the
   editor + reader (or reuse `blocks[]` directly).
4. Make sure it flows through retrieval export automatically — bundles are
   doc-type-agnostic (`bundleForArticle` includes `docType`), so nothing extra
   is needed for task 26/27.
5. Register in navigation/reports — doc types appear in facet filters and
   reports automatically from `listArticles()`; add any report rows in
   `src/modules/reports.js`.

## Phase 9: multi-user roles & the realtime hub

Everything in Phases 1–8 works single-user with zero hub code. Phase 9 layers a
`server-plugin`-based hub (`createServerSocket` imported in `main.pjs`) on top so
a team can share one KB with roles and live updates. **While the generator is
unsaved (or the hub is otherwise unreachable) it degrades gracefully to the same
single-user local mode** — roles only apply once a session is authenticated, and
the editor falls back to a 12s document-store poll for remote changes.

### How it fits together

- **`index.html` server script** — the authoritative hub. Durable `state`
  layout: user table (username → password-hash/roles/flags + last-seen), token
  table, a seq-stamped change ring, an audit ring, and a shared edit-key table.
  Handlers: `register`, `login`, `auth` (token), `logout`, `changePassword`,
  `grantRole`, `revokeRole`, `setBanned`, `listUsers`, `checkAction`,
  `announceChange`, `getChanges`, `subscribeCat`, `getPresence`,
  `getOnlineUsers`, `storeEditKey`, `getEditKey`. Pubsub topics: `kb:all` (every
  connected conn subscribes on open) and `cat:<categoryId>` (subscribed via
  `subscribeCat`).
- **Roles & authorization** — every RPC that changes something re-checks the
  caller's server-side session (`canDo(s, action, cat)`, banned first).
  `checkAction` is what the UI gates on (`ctx.hub.authorize`/`require`), but
  nothing is trusted client-side: all writes happen through RPCs that verify
  roles again. Offline ⇒ `authorize` returns `{allow:true, reason:"local"}` so
  the single-user app is never blocked by hub absence.
- **Admin bootstrap** — the server embeds only the SHA-256 of a generated
  high-entropy admin password. Anyone who registers/logs in with that password
  becomes admin. The plaintext is delivered to the owner out-of-band (in the
  agent's final report) — it is **not** stored in any file. If the plaintext is
  ever lost, regenerate: pick a new 32+ byte random password, put its SHA-256 in
  `ADMIN_PASSWORD_SHA256`, and deliver the plaintext to the owner again.
- **Edit keys (multi-writer documents)** — the upload-plugin editable files can
  only be updated by the creator's edit key. The hub keeps a shared edit-key
  table: any writer with a write role reports its keys (`storeEditKey`) and can
  fetch keys it lacks (`getEditKey`), and `syncEditKeys()` pushes the device's
  known keys on connect/login — so the whole team can update the same documents.
  The client keyStore in `src/app.js` prefers `hub.getEditKey` before falling
  back to its local copy, and reports new keys to the hub after creating docs.
- **Concurrent editing** — `ctx.hub.watchArticle(id, cat, read, cb)` (used by
  the editor and the article reader) filters for that article's change events,
  ignores the current user's own announces and stale versions, and shows a live
  banner ("Updated by X just now" → Load updated copy / Dismiss). Watches are
  auto-cleaned via `ctx.onUnmount`. When the hub is down, `watchArticle` also
  starts a polling fallback that watches the document store directly.
- **Rate control** — per-conn and per-`conn.net`-group limits on register/login/
  grant/announce/action/getChanges/edit-key RPCs; registration is stricter for
  proxy connections (`conn.isProxy`). Sessions are ephemeral and rebuilt from
  tokens on reconnect.

### Server-script security notes

The `<script type="text/x-server-plugin">` element is **public source** — every
client can read it. Never put secrets there (or anywhere client-visible). The
embedded `ADMIN_PASSWORD_SHA256` is only safe because the real password is high
entropy. The hub uses a plain synchronous SHA-256 (server handlers cannot use
`crypto.subtle`/`TextEncoder`/imports). Password hashes in the user table are
stored as raw bytes; `hashToRaw()` converts the hex digest for byte-compare.

### Production caveat

Real multi-user requires the generator to be **saved** (the unsaved preview runs
a single-document local emulator: same code, but no cross-tab multiplayer and
state resets on reload). Production server sockets also only work on
perchance.org (embedded-on-other-site frames get closed with `4403`).

## Module ctx

Every module's `render(ctx)` receives: `{ kb, providers, states, toast, modules,
container, mod, current, navigate, store, sync, content, hub, onUnmount }`.
`hub` is the Phase 9 realtime hub (null/offline-safe — guard with
`ctx.hub && ctx.hub.connected`); `onUnmount(fn)` registers a cleanup that the
router calls when the module is navigated away from (used to unsubscribe live
watches). `states.empty/loading/error(...)` return ready-made state cards —
always use them instead of ad-hoc markup.
