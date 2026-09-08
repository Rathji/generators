# Business CRM

A small-business CRM built for Perchance — companies, contacts, leads, deals, a
configurable sales pipeline, activity timeline, follow-up automation and
reporting, wired into the small-business pipeline (idea-incubator leads in,
project-master project seeds out, customers for the-ledger and the ERP).

The build is driven by the atomic roadmap in the project-root `roadmap.pjs`
(checklist file; root files don't ship with the generator and reset between
sessions — re-derive from the attached spec if it's missing). One task at a
time: implement → validate (self-tests) → mark `[x]` → await review.

## Layout of the code

- `main.pjs` — $meta + the three plugin imports the app builds on:
  `kv-plugin` (local cache + hub config), `upload-plugin` (editable-file
  document store) and `server-plugin` (the Phase 9 live-hub server socket).
- `index.html` — application shell markup: topbar, sidebar, view root.
- `src/crm.css` — all shell styles (CSS custom props, responsive drawer).
- `src/app.js` — the module framework: registry + hash router + shell states
  (loading / empty / error), drawer, env pill, selftest view. This is the
  framework every later module registers into.
- `src/modules.js` — the eight CRM module descriptors (id, label, tagline,
  icon, empty-state copy).
- `src/modules/dashboard.js` — Dashboard module (module overview grid,
  workspace card, self-test summary, and the Phase 6 \"Pipeline at a glance\"
  KPI row + Follow-up radar cards). Each future module gets its own file
  here and attaches a renderer to `window.CRM_RENDERERS.<id>`.
- `src/selftest.js` — tiny self-test runner (`window.SELFTEST`).
- `src/selftests/shell.test.js` — shell validation tests (navigation, routing,
  loading/empty/error states, drawer).
- `src/syncpanel.js` — sync/conflict UI (`window.CRM_SYNC`): conflict cards
  with keep-mine / keep-theirs / field-by-field merge, rendered on the
  dashboard when the store reports conflicts.
- `src/backup.js` — backup/restore UI (`window.CRM_BACKUP`): the dashboard's
  "Backup & restore" zone — one-click full backup (downloadable file +
  published backup), restore-from-file / restore-published flows with a
  validate → preview → confirm gate.
- `src/store.js` — the canonical document store (`window.BcrmStore`,
  booted by app.js into `window.CRM.store`). Each data module (companies,
  contacts, leads, deals, activities, reports) persists as one *versioned JSON
  document* on the server — an upload-plugin *editable file* named
  `bcrm-<module>[-x<ns>]-<token>` under the generator's namespace — plus a
  fast local cache in a `bcrm` kv folder. See "Document store" below.
- `src/selftests/store.test.js` — store tests: mock-transport logic tests
  (deterministic) plus a live round-trip against real editable files.
- `src/selftests/sync.test.js` — sync/conflict tests: two-device divergence,
  staged-edit auto-publish on boot, keep-mine/theirs, field merges, the
  conflict_moved guard, UI flows, and one live real two-device round-trip.
- `src/selftests/backup.test.js` — backup/restore tests: snapshot build,
  validation (hash tamper checks), idempotent publish, restore/no-op/rollback
  previews, restore-with-archive semantics, key recovery, UI flows, plus one
  live publish → edit → restore round-trip.
- `src/capacity.js` — capacity/archive UI (`window.CRM_CAPACITY`): the
  dashboard's \"Capacity & archive\" zone — per-module size vs the storage
  ceiling, guided archival of old-period records (choose the date field and a
  cutoff → preview what matches → archive), and the archives & retrieval list
  (view archived records, restore a batch back to live).
- `src/selftests/capacity.test.js` — capacity tests: mock-file archival
  semantics (batch + index envelopes, pruning live records, dedupe on repeat
  archive, restore merge/no-op), date-field detection, the dashboard-zone
  smoke test, plus one live archive → restore round-trip.
- `src/records.js` — shared record-layer helpers (`window.CRM_RECORDS`):
  id minting (`<module-prefix>-<hex>`), record CRUD on a module content
  object, cross-module reference lookups, name sorting (active first), a
  filter that searches every text field, tag parsing, and `persistUpdate`
  (the save path record pages use: load → deep-clone → transform →
  `saveChecked`). See \"Companies & records\" below.
- `src/events.js` — tiny event bus (`window.CRM_EVENTS`): `on/off/fire`,
  with `fireSync` for subscribers that must observe every write.
  `persistUpdate` fires `moduleWrite` `{module, res, changes:
  [{id, prev, next}]}` after any successful save (pass `{events:false}` to
  suppress) — the hook later automation rules and the integrity indicator
  subscribe to.
- `src/recordsui.js` — shared record UI helpers (`window.RECORDUI`):
  store status banners/cards, not-found cards, form field builders, chips,
  initials avatars, money/number formatting, `describeError` (maps every
  store failure code to plain-language copy with the exact next step).
- `src/dups.js` — duplicate detection & merge (`window.CRM_DUP`):
  normalized-name/email/website candidate pairs per module, `candidatesFor`
  (active records only, honoring `dupDismissed`), and `mergeRecords(store,
  {module, survivorId, dupId, note})` which rewrites every cross-module
  reference (companyId/contactId/leadId/dealId) onto the survivor, unions
  tags/notes with merge markers, journals `merges[]`, archives the
  duplicate's notes, and reports each rewritten doc.
- `src/dupui.js` — duplicate UI (`window.CRM_DUPUI`): `dupBanner` on record
  detail pages, the merge panel (pick survivor, optional note, dismiss),
  and the list-page \"Scan for duplicates\" panel (`scanButton`).
- `src/segments.js` — segments & saved filters (`window.CRM_SEGMENTS`):
  per-module field definitions incl. virtual date fields
  (days-since-created/customer/last-activity, daysUntilClose, daysInStage),
  `ruleMatches`/`segMatches` with a deals stage context
  (`stageCtx` maps stage labels ↔ ids from the deals pipeline), a saved
  `segments` document, `members()` computed at query time, and a hidden
  `segments` module page (`managerView`) plus the `savedSegControl` that
  module list pages embed.
- `src/modules/companies.js` — Companies module (`window.CRM_COMPANIES` +
  renderer): list with live search + All/Active/Inactive/Customers segments,
  detail page with reference guard on delete, and the shared new/edit form.
- `src/modules/contacts.js` — Contacts module (`window.CRM_CONTACTS` +
  renderer): the same list/detail/form shape as companies over the
  `contacts` document (`ct-<hex>` ids) with role/email/phone/channels/
  social/consent/active fields, an All/Active/Inactive/Consent quick
  segment, a saved-segment control and duplicate-scan button in the toolbar,
  and the duplicate banner on detail pages.
- `src/selftests/companies.test.js` — companies tests: form normalization
  and validation, legacy-field preservation, store round-trip, rename-keeps-id
  with intact references, the deletion reference guard, list helper behaviour,
  a list/form UI smoke test, and one live create → rename round-trip.
- `src/selftests/contacts.test.js` — contacts tests mirroring the companies
  suite (normalization, validation, legacy/consent handling, standalone
  contacts, the deal/activity delete guard, a list/form UI smoke test) plus
  one live create → rename round-trip.
- `src/selftests/dups.test.js` — duplicate tests: candidate pairing rules,
  active-only + dismissal handling, a full mock merge rewriting contacts/
  deals/activities/leads references, contact-merge id choice, missing-id
  failure copy.
- `src/selftests/segments.test.js` — segment tests: rule matching across
  types (bool/number/between/string/tag/set tests), the virtual
  days-since-last-activity resolution from the activities document, saved
  segment round-trips, `members()` live counts incl. deals stage rules by
  label or id, per-module default rules.
- `src/modules/leads.js` — Leads module (`window.CRM_LEADS` + renderer):
  list/detail/form over the `leads` document (`l-<hex>` ids), status
  lifecycle with required disqualify reason, journaled `events[]`,
  lead → deal conversion, and the timeline + suggestion cards on detail.
- `src/modules/deals.js` — Deals module (`window.CRM_DEALS` + renderer):
  pipeline board/list/form/settings (user-editable stages saved to the
  document), journaled stage moves, weighted value & days-in-stage,
  won → customer conversion, per-company deal history route
  (`#/deals/company/<id>`), and the workflow + timeline + suggestion cards
  on detail. `remember()` keeps an in-memory doc mirror that must be
  refreshed via UI events — direct store writes bypass it until reload.
  The list/board accept a route state (`#/deals/open|won|lost`) so KPI
  cards and report links deep-link into filtered views.
- `src/timeline.js` — unified timeline (`window.CRM_TIMELINE`):
  `collect(store, scope)` (activities + deal/lead journal events, sorted
  desc) and `card()` (filterable timeline card) used on company/contact/
  deal/lead detail pages. Deal stage events are labelled from that store's
  own deals-document pipeline (never a shared global), so rendering is
  correct regardless of which module page was open last.
- `src/modules/activities.js` — Activities module (`window.CRM_ACTIVITIES`
  + renderer): validation/CRUD over the `activities` document (`a-<hex>`
  ids), task state + email outcome transitions, the feed + task queue
  views, and the log form with record prefills.
- `src/modules/emails.js` — Email templates & compose (`window.CRM_EMAILS`,
  hidden `emails` module): template CRUD in the `emails` doc
  (`content.templates[]`), merge rendering against a company/contact/deal
  scope, compose UI, and `logEmail` (writes the email activity).
- `src/modules/suggest.js` — next-step suggestions (`window.CRM_SUGGEST`):
  rule evaluation (remind / follow-up / touch-base / set-close-date),
  per-rule dismissal, and accept → creates a linked task. Renders the
  "Suggested next step" card on deal/lead detail.
- `src/modules/reminders.js` — reminders (`window.CRM_REMINDERS`, hidden
  `reminders` module): derived reminders for open tasks due ≤7 d and open
  deals closing ≤7 d, snooze/reschedule/reassign/dismiss actions (each logs
  a note activity), daily digest (grouped rows + copyable text bundle), and
  the dashboard follow-up radar counts. Full section below.
- `src/modules/rules.js` — automation rules (`window.CRM_RULES`, hidden
  `rules` module): when-then rule storage/validation in the `rules` doc,
  write-event and daily-scan firing with changed_to/changed_from conditions,
  task/note/field actions, throttle, and the execution log; boot hook fires
  one scan 6 s after load. Full section below.
- `src/selftests/reminders.test.js`, `src/selftests/rules.test.js` —
  Phase 5 suites: reminder collection exclusions, snooze/reschedule/
  reassign/dismiss with notes, deal reminders, digest grouping + text
  bundle headers; rule validate/persist/pause/delete, condition semantics
  (eq/numeric/changed_to), write-fire task + exec log + no double-fire,
  disable + throttle, scan quiet-lead flagging, field actions, manual runs.
- `src/selftests/leads.test.js`, `src/selftests/deals.test.js`,
  `src/selftests/activities.test.js`, `src/selftests/timeline.test.js`,
  `src/selftests/emails.test.js`, `src/selftests/suggest.test.js` —
  per-module store-level suites for the Phase 3 & 4 modules (lifecycle
  journaling, stage moves, weighted values, conversions, activity
  validation/task-outcome state, timeline collection scopes + card wiring,
  template CRUD + merge token rendering, suggestion rules incl. dismissal
  anchors).
- `src/csvio.js` — CSV plumbing (`window.CRM_CSV`): a quote/embed-newline
  aware parser (header row + data, ragged/blank rejection), `toCSV`,
  downloads, per-module `FIELD_LABELS`/`fieldOptions`, `buildRaw` (address
  flattening, size-band → employees number, consent → boolean),
  `validateRaw`, duplicate/company-name lookups, `moduleColumns` +
  `renderTable` (flattened export tables with a head row), and record sheet
  HTML for printable detail sheets.
- `src/modules/reports.js` — Reports module (`window.CRM_REPORTS` +
  renderer, route `#/reports`): nine built-in templates (deals by
  owner/stage/close-period/source, win/loss with reasons, revenue forecast
  by month, activity by type/owner, team performance) run live over the
  store, each returning {title, chips, table, note}; report definitions are
  saved in the `reports` document and re-runnable; every report exports to
  CSV and prints. Sub-routes: `#/reports` library (saved defs + catalog),
  `#/reports/new`, `#/reports/edit/<defId>`, `#/reports/run/<template|defId>`,
  `#/reports/import`, `#/reports/export`. Import maps CSV columns onto
  fields (synonym auto-guessing), previews every row with ok/exists/error
  badges before `importRows` commits the valid ones. Export downloads any
  module as CSV, prints lists, and prints per-record detail sheets
  (company/contact/lead/deal/activity) with a recent-activity section.
- `src/selftests/csvio.test.js`, `src/selftests/reports.test.js` — Phase 6
  suites: parser/round-trip/guessing/validation/import-count semantics;
  each report template's grouping/weighting/labels, saved-definition CRUD,
  CSV flattening. (Timeline stage labels resolve per-document from the
  deals pipeline — see timeline note above — so suites are order-independent.)
- `src/bus.js` — the small-business pipeline bus (`window.CRM_BUS`, Phase 7):
  transport over the generator's own upload-plugin editable files
  (`bus-<stream>` + a `bus-manifest`, dotless names) in the same namespace,
  plus kv-cached edit keys; `PROTO k bcrm-bus v1` envelopes with
  `{k,v,stream,generator,updatedAt,bundles[]}`; streams for ideas in
  (`bus-ideas`), project seeds out (`bus-projects`), customers out
  (`bus-customers`), receivable statuses in (`bus-receivables`) and the
  manifest; `materialize` reads each inbound stream + this generator's own
  out-records (mirrored to the local `bus` document), `importIdea` (dedupe
  via `imp-<bundleId>` records or a lead scan), `publishProjectSeed` /
  `publishCustomer` (CAS guard against double-send: `deal.busHandoff` /
  `company.busCustomer`, busy in-flight set), `pullReceivables` +
  `refreshCompanyPayment` (company matched by id → tax id → normalized
  name; payment health paid/partial/overdue/open written to
  `company.busPayment`), `onModuleWrite` (won deals without a `busHandoff`
  publish; `isCustomer` flips publish) subscribed once through
  `CRM_BOOT_HOOKS`. Full section below.
- `src/modules/bus.js` — Integrations module UI (`window.CRM_BUSUI` +
  renderer, route `#/bus`): Connections card (per-stream file status +
  published-bundle counts + open-public-url), Streams card (bundle list per
  stream), Idea inbox card (idea bundles → import as qualified lead), and
  Export log card (out-records with retry + reset-file). Hooks appended to
  the deal/company detail renderers: the won-deal "Pipeline handoff" card
  (publish project seed / re-publish with materialize) and the company
  "Pipeline & payments" card (customer publish state + Retry, and payment
  health from the ledger with a Refresh action).
- `src/selftests/bus.test.js` — Phase 7 suites: mock-env transport (kv +
  editable maps + peer files keyed `<gen>/<file>`), envelope/stream
  contract, idea import + dedupe, project-seed CAS single-send, customer
  publish, receivable match + health, describe-error copy, all against
  isolated mock namespaces so the real store is never touched.
- `src/integrity.js` — data-integrity engine (`window.CRM_HEALTH`,
  Phase 8): `problemsFor(docs)` returns `{problems, truncated,
  counts:{err, warn}, ok}` where each problem is `{code, sev, module,
  recId, name, title, detail, href, action, hrefText}` (an *object*, not an
  array — see the health-check list below); `check(store)` re-reads every
  module document and returns the full state; `schedule(store, ms)` marks
  the store dirty and re-checks after a 1200 ms debounce; `zone(store)`
  renders the dashboard's "Data integrity" card and `attach(store)` (boot
  hook, guarded so it never attaches twice) subscribes to `moduleWrite`
  and calls `schedule` after every successful write.
- `src/selftests/integrity.test.js` — Phase 8 health suites: each check
  code (dup companies/contacts, orphan contacts, converted-lead and
  terminal-stage inconsistencies, deal/company/contact cross-links,
  activity orphan refs), severity + counts + truncation, mock-env zone
  render smoke, and a junk-document tolerance case.
- `src/selftests/fixtures.test.js` — Phase 8 round-trip fixture suite:
  legacy-schema documents and malformed records survive save → load →
  re-save byte-for-byte across every module; a two-device stale-offline
  edit over a legacy document resolves as a keep-mine/merge conflict with
  untouched legacy fields preserved; a legacy duplicate merge rewrites
  contacts/leads/deals references; a full backup → wipe → restore cycle
  (with key recovery) brings every legacy module back byte-identical; the
  whole lead → deal → won → customer → project-seed bus chain runs over
  legacy records with single-send guarantees; and the record helpers +
  bus receive path tolerate junk payloads.
- `src/selftests/errors.test.js` — Phase 8 error-copy suites: every
  store failure code (20) and every bus failure code (24) maps through
  `describeError`/`BUS.describe` to plain-language copy ≥ 40 chars with a
  next-step token, no leaked code identifiers, and friendly generic
  fallbacks; a corrupt-document save surfaces the recovery copy end to
  end.
- `src/hub.js` — the live-hub client (`window.CRM_HUB`, Phase 9): hub state
  machine, the Integrations-page hub card, join/set-up forms, presence,
  team & activity panels, and the collaboration engine that turns local
  `moduleWrite` events into `reportWrite` RPCs and applies remote `chg`
  broadcasts as reloads or an in-place change bar. See "Live hub" below.
- `src/selftests/hub.test.js` — Phase 9 hub suites: owner set-up and
  duplicate-owner refusal, auth rate limiting, role gates (viewer/manager/
  owner) server-side, write broadcast to a second session, local writes
  reported as remote changes, the viewer read-only store gate, member
  management + audit order, password-reset invalidation, and clean teardown.
  These run against the one-tab server-plugin emulator and skip politely on
  a saved generator or when an external owner holds the hub.

## Document store

Booted once per page load (`store.ready()` → ensure device id →
`reconcileAll()`: every module with a staged edit is either auto-published —
when the canonical document has not moved — or surfaced as a conflict; modules
with only a cache are pulled up to the canonical revision).
Reads are served from the local kv cache when fresh; the server copy is the
canonical source of truth and is fetched on refresh/sync. `loadDoc` returns
`{state: "dirty" | "cache" | "canonical" | "none", content, revision}` — when
this device has a *staged* (not yet synced) edit, `loadDoc` returns that dirty
content first, so the UI always edits the version that will be saved.
`saveChecked(module, content, {expectedBase})` — the write API module UIs use —
returns `{ok, revision, created}` or an error code; `expectedBase` is the
revision the content was loaded from (always returned by `loadDoc`).

Envelope (each editable file is one JSON text):
- Head file: `{k:"bcrmdoc", v:1, module, ns, revision, updatedAt, updatedBy,
  parts, sha, content}`.
- Part files `-p2…-pN` (only when the module grows large): `{k:"bcrmpart",
  v:1, module, ns, part, content}` — each holds `{records: [...]}` slices.

`sha` is the digest of the reassembled content JSON, verified on every
canonical read. A module's content is an object that may carry a `records`
array; when the head would exceed the target budget (~2.5 MiB default) the
records are split across part files (every file stays under the ~5 MiB
editable ceiling — writes over the ceiling are refused with
`doc_too_large`). Editable names are derived from a token of the generator's
publicId, so they are stable across the user's devices but not guessable by
casual crawlers; the raw file is publicly readable if the name is known, so
no secrets belong in module content.

Each document carries a monotonic `revision`. `saveDoc` never writes over a
canonical revision newer than this device's last synced revision (returns
`conflict_stale`), refuses to touch a corrupt document, treats an identical
resave as a free no-op, and requires the locally cached editable *edit key*:
a device that lacks the key can read but gets `no_edit_key` on write
(recoverable via backup/restore — see below). Server reads can lag
a write by ~10 s, so a cache written within the last 15 s wins over a lower
remote revision.

The classic optimistic `saveDoc(module, content)` still exists for
local-first callers (it re-reads the canonical head and refuses with
`conflict_stale` if a newer revision appeared); module code should prefer
`saveChecked`, which stages instead of refusing (see "Sync & conflicts").

kv keys (folder `bcrm`): `meta` (device id), `doc:<ns>:<module>` (cached
content + revision), `editkey:<ns>:<file>` (editable write keys),
`ledger:<ns>:<module>` (staged unsynced edit), `conflict:<ns>:<module>`
(unresolved conflict record), `history:<ns>:<module>` (resolution archive,
capped), `recon:<ns>` (last reconcile timestamp). Everything is namespaced by
`ns` (default `__main__`); tests and demo harnesses use a random `ns` so they
never touch real module documents.

## Sync & conflicts

Edits are staged locally first: `saveChecked` writes to the server only while
the canonical document still sits at `expectedBase` (the write itself is
guarded by an atomic re-check of the head revision). When the server document
advanced before the save — a real two-device divergence — `saveChecked` does
**not** overwrite anything: it keeps the device's content as a *staged edit*
(ledger) and materializes a `conflict` record holding the shared base and
both sides. `statusSummary()` then reports the module as `pending` (staged
but the canonical has not moved — a reconcile fast-forwards it) or
`conflict` (a decision is needed).

`reconcileAll()` runs on every boot and from the dashboard's "Sync now" (the
dashboard also re-reconciles when it sees pending/conflicted modules at
render time). Per staged edit it: publishes it when the canonical is
unchanged at the staged base; pulls and clears it when the remote made an
identical change; otherwise materializes/keeps a conflict record — the
canonical document is never touched by reconciliation. Conflicts are resolved
via `resolveConflict(module, choice, opts)`:

- `keepMine` — publish the staged edit at the next revision. The write
  re-verifies the head first; if the document moved during review the resolve
  returns `conflict_moved` and the staged edit stays intact for a fresh
  decision.
- `keepTheirs` — adopt the canonical document and drop the staged edit.
- `merge` — write a merged document built from `{merged, picks}`.

Every resolution archives the losing side (and the merged result for merges)
into the module's history, so no version is ever silently discarded.
`mergeDiff(module)` returns a structured diff: top-level fields plus per-record
field deltas flagged `conflict` when both sides changed (fields changed on one
side auto-resolve to the changed side; records added on one side are always
kept). `buildMerged(module, picks)` applies `{top, recs}` picks ("mine" or
"theirs" per field). The dashboard's conflict cards (`src/syncpanel.js`) offer
the three actions and a field-by-field merge panel whose radios default to
this device's version.

## Backup & restore

`buildBackup()` snapshots every module into one JSON document (`{k:"bcrmbak",
v:1, kind:"full", id, at, ns, deviceId, generator, modules[], editKeys{}}`)
— each module entry carries its revision, updatedAt/By, the reassembled
content, a per-module `sha` digest, and part count; a module with no document
is listed `present:false`. The snapshot deliberately includes this device's
editable **edit keys** keyed by file name — that is what makes a downloaded
backup able to hand write ownership to a fresh device (a device that lost its
key gets `no_edit_key` on write; restoring a downloaded backup recovers it).
A build refuses (`unreadable_modules`) if any present module cannot be read,
so a backup is never silently partial.

`publishBackup()` also writes the snapshot to the server as a *published
backup*: one editable file per present module (`bcrm-bkp-<module>…`) plus an
index (`bcrm-bkp-index…`), under the same fixed names as the live documents —
so re-publishing overwrites in place. The published snapshot omits `editKeys`
(anyone who learns the file names can read it, like the live docs). Because
editable files can only be updated (never deleted) and each same-name write is
throttled, unchanged re-publishes are made true no-ops: the index stores a
fingerprint over `module:revision:sha:parts`, and per-module files are only
rewritten when their own fingerprint changed (compare-before-write against the
previous publish). `latestPublishedBackup()` / `readPublishedBackup()`
reassemble the published backup for preview/restore, verifying the sha of
every module; a module whose backup files went missing reads back as
`published_incomplete` rather than a silent partial restore.

`restoreBackup(raw)` is the only code path that replaces today's live data,
and it is gated so nothing is overwritten without a validated decision:

1. **Validate** — marker/version/shape checks plus a real sha re-digest of
   every module's content; tampered or non-backup JSON is refused
   (`invalid_json` / `not_a_backup` / `invalid_backup`).
2. **Preview** — `previewBackup()` compares each module against the live
   document and labels every row *no change needed* (identical),
   *will replace* (different live version), *will roll back* (the live
   document is *newer* than the backup — always called out explicitly),
   *will create* (fresh namespace), or *left alone* (absent in backup). Any
   pending staged edit / unresolved conflict blocks restore
   (`pending_changes`) — sync items must be resolved first, since a restore
   underneath them would strand them.
3. **Restore** — writes each changed module at `max(liveRev, snapRev) + 1`
   through the same atomic write path as a normal save (guarded by an
   expected-revision re-check, so a document that moved during review is
   never clobbered — `conflict_stale`). A corrupt live document is replaced
   authoritatively (the only sanctioned overwrite, bounded by this device's
   cached revision). Restoring a backup that *is* the current live state is a
   pure no-op that writes nothing.

Every replaced document has its pre-restore content archived into the
module's history (`kind:"restore"`), so a rollback always keeps today's
version recoverable on this device. `restoreBackup` refuses to start at all
if any module is pending or conflicted, and returns per-module results
(`replace` / `create` / `noop` / `skip` / `failed`) plus `keysApplied` for
edit keys recovered from a downloaded backup.

The dashboard zone (`src/backup.js`) exposes: **Full backup & download**
(publish first so the server also has it, then download the file with keys),
**Download file only**, **Restore published backup…**, and **Restore from a
file…**. Restore flows show the validated preview table with the rollback
warning and a disabled-while-pending state; the restore itself only happens
when the user presses "Restore this backup".

## Capacity & archival

`capacityInfo()` reports, per module, the live document's assembled bytes and
its file/part breakdown (plus whether any file is unreadable), the largest
file vs the editable ceiling (`EDITABLE_MAX`, 5 MiB — the same ceiling
`saveChecked` refuses to exceed), and the module's archive totals (batches,
archived records, bytes). Every module is always listed (live + archive bytes
combined), so the zone doubles as a health read on the document store.

Archival moves *old-period records* out of a module document into a read-only
archive so the live document stays small while the records remain retrievable.
The user picks the module, a date field to judge records by (auto-detected
from the live records' keys — with a type-your-own fallback, since a module
may have no date fields at all), and a cutoff: "older than N days/weeks/
months/years" or an exact date. `previewArchive()` then lists exactly which
live records match — and nothing is archived until the preview is seen and the
Archive button pressed, so an over-broad cutoff can be caught before it runs.

The archive is a set of read-only editable files in the same namespace,
dedicated to the archived module (`k:"bcrmarc"`):
- Batch file `bcrm-arc-<module>[-x<ns>]-<token>-b<no>` — head
  `{k:"bcrmarcb", v:1, module, ns, no, archivedAt, archivedBy, rule, count,
  parts, sha, content}` holding `{records: [...]}`, plus `-p2…` part files
  when large (same envelope machinery as live docs, with `readOnly: true`).
- Index file `bcrm-arc-<module>[-x<ns>]-<token>` — `{k:"bcrmarc", v:1,
  module, ns, readOnly, nextNo, batches: [{no, id, archivedAt, archivedBy,
  rule, readOnly, count, parts, bytes, sha, status, restoredAt, restoredBy}]}`,
  the entry point for listing and retrieval.

`archiveRecords(module, rule)` writes the batch + index and then prunes the
matching records from the live document through the same version-checked
`saveChecked(expectedBase)` path — a live document that moved mid-archive
surfaces as `needs_sync` (nothing archived, retry after reconcile), a lost
edit key reports `no_edit_key` with the records safe in the batch. Archiving
records that were *already archived* under an identical rule is a no-op that
reuses the existing batch, so double-archiving never duplicates anything.

Retrieval is on demand: `listArchive(module)` reads the index, and reading a
batch lazily reassembles and sha-verifies its part files. Archived batches are
**never auto-deleted** (editable files cannot be deleted anyway) and a batch
that is *not* marked restored is reusable for dedupe. `restoreArchiveBatch`
writes every record of a batch back into the live document as a normal
versioned save (merging by record id — records already live are skipped as
duplicates, never overwritten) and marks the batch `restoredAt`/`restoredBy`;
re-restoring an already-restored batch is a no-op. Records stay in the archive
even after restore — the batch remains the read-only record of what was moved.

The dashboard zone (`src/capacity.js`) exposes: the per-module capacity table,
the guided archive flow with preview, and the archives & retrieval list with
per-batch "View records" and "Restore to live" actions.

## Companies & records

Company records live in the `companies` document (`records` array). The schema
is intentionally strict about the *shaped* fields (name, industry,
`employees` — a size-band code from 10/50/200/500/1000/5000/5001 — website,
`taxId`, `address {street, city, region, postalCode, country}`, `tags[]`,
`notes`, `isCustomer`, `active`) while record saving is *forgiving*: editing a
record merges onto whatever is already there, so unknown/legacy fields
(`email`, `stage`, `owner`, …) survive a rename untouched. `createdAt` /
`updatedAt` are maintained by the form layer; an empty submitted field is
deleted from the record (set-or-delete semantics).

Every record gets a stable id minted as `c-<hex>`; nothing else in the system
ever identifies a company. `findRefs` scans every module's records for a field
that references that id, which powers two invariants:

- **Rename never breaks references.** Deals and activities (and the future
  contacts module) reference companies by id only, so a rename — or a future
  merge — updates the whole graph implicitly. Detail pages show a
  Relationships card listing those references.
- **Delete is guarded.** `canDelete` refuses (with the offending references)
  while any record still points at the company; the Delete button is disabled
  with a "deactivate instead" hint and only arms through a two-step confirm
  after a reference-free check passes.

Routes: `#/companies` (list), `#/companies/new`, `#/companies/<id>` (detail),
`#/companies/<id>/edit`. The list repaints locally as you type in search or
switch segments (All/Active/Inactive/Customers — companies with
`active === false` sort last), and shows a store status banner when the module
is pending or conflicted. The form validates before any write (required name,
website URL shape) and surfaces server errors with a retry hint on
`server_lag` (the ~10 s editable write throttle).

## Contacts, duplicates & segments

Contacts mirror the companies module shape against the `contacts` document
(`ct-<hex>` ids). A contact is linked to a company by `companyId` or is
intentionally standalone (no `companyId` key at all — the form keeps it that
way when the company select is empty). Shaped fields: name, `companyId`,
role/title, email, phone, `channels[]` `{kind, value}` (kind from a known
list, free-form otherwise), `social{}` per-handle URLs, `consent` (boolean;
unticking removes the key), `active`, tags, notes. Timestamps are maintained
by the form layer. List rows show name/role/company/tags; detail shows full
fields and a Relationships card listing every deal/activity that references
the contact. Delete is refused while any reference exists (deactivate
instead); company deletion is likewise blocked while contacts reference the
company.

**Duplicate detection & merge** runs on companies and contacts. Candidates
compare normalized name/email/website: companies match on name or website,
contacts on email, or on name *at the same company*. `candidatesFor` only
suggests pairs where both records are active and honors each record's
`dupDismissed[]` ("Not a duplicate"). A banner on the detail page offers
"Merge records…" → the merge panel picks the survivor, optionally records
why, and dismisses. `mergeRecords` keeps the survivor's id (every reference
in every other module is rewritten to it), fills empty survivor fields from
the duplicate, unions tags and appends notes with merge markers + a
`merges[]` journal, and deactivates/removes the duplicate — nothing silently
disappears.

**Segments** are reusable named filters stored in the `segments` document
(`sg-<hex>` ids, `{module, kind: all|any, rules: []}`). Each rule is
`{f, op, v|from|to}` over the module's field definitions (bool/num/string/
date/array types) plus `custom` fields by raw name. Virtual date fields make
time rules readable: `daysSinceCreated`, `daysSinceCustomer`,
`daysSinceLastActivity` (resolved from the activities document),
`daysUntilClose`, `daysInStage`. Deals rules can match pipeline stage by
label *or* id. Members are computed at query time. Module list pages embed a
saved-segment control (`savedSegControl` — auto-hidden while none exist) that
filters the list; the hidden `segments` module page manages them
(create/edit/delete with a live member count per segment).

## Module framework contract

A module = `{ id, label, tagline, icon, empty:{title,message}, render(ctx)? }`.
`render(ctx)` returns a DOM element (or nothing → the empty state is shown);
it may be async. `ctx = { id, def, params, moduleList, env, navigate,
store }` (renderer wrappers inject `store: window.CRM.store`, and app.js now
passes it on every route ctx). Routes are `#/<module>` (+ `/…` params for
record pages). A module descriptor may set `hidden:true` to keep it out of
the side nav (the hidden `segments` and `emails` modules are still reachable
via their routes and `CRM.go(id)`) — the module-list helpers must filter
hidden modules wherever they enumerate nav/dashboard entries.

## Leads & deals pipeline

Leads live in the `leads` document (`l-<hex>` ids). Shaped fields: name,
source, owner, `companyId`/`contactId`, status, notes, plus timestamps.
Status flows through `new → contacted → qualified → converted |
disqualified`; moving to `disqualified` *requires* a reason (and timestamps
it); `converted`/`disqualified` records keep a journal `events[]` of every
status change `{kind:"status", from, to, at, by, reason?}`. Reopening a
disqualified lead clears the close fields and journals again. `canDelete`
refuses while any deal or activity references the lead.

Deals live in the `deals` document (`d-<hex>` ids). Shaped fields: name,
`companyId`/`contactId`, owner, `expectedValue` (number), `closeDate`
(date-only string `YYYY-MM-DD`), `probability` (0–100), `notes`, `stage`.
The pipeline is user-configurable: a default four open stages
(qualification → discovery → proposal → negotiation) plus the terminal
`won`/`lost`, saved as a `{stages:[{id,label}], won, lost}` map in the
document's `content.pipeline` — add/reorder/rename/delete from the deal
list's stage-settings page, never losing deals (an open stage may not be
deleted while deals sit in it). All stage moves go through `changeStage`,
which journals `events[]` (`{kind:"stage", from, to, at, by, reason?}`),
no-op moves are skipped, and every deal carries a `create` event. Deals
compute weighted value (`expectedValue × probability`) and track
`stageEnteredAt`, `stageChangedAt` and `createdAt` for days-in-stage / deal
age. Deal list rows show expected value and "closes <date> | overdue |
won/lost" state, totals by stage show count/expected/weighted, filterable by
owner, stage (open/won/lost or a specific stage), expected-close period and
saved segments.

Conversions: a qualified lead converts into a deal (`createDealFromLead`)
carrying over company/contact/owner/notes and stamping both records;
`convertWonToCustomer` marks the linked company `isCustomer` and the linked
contact, journaling the conversion timestamps for cycle-time reporting.
`revertLeadOnDelete` keeps lead/deal links honest when a deal is deleted.
Deal detail (route `#/deals/<id>`) shows the header (name, stage chip,
value, owner, ＋Log/Email/Edit actions), a workflow card (stage select +
Move, Mark won/lost with note), detail fields, a Suggested-next-step card
(Phase 4), the unified Timeline card, and Relationships.

## Activities, timeline & communications

**Activity records** live in the `activities` document (`a-<hex>` ids) —
one record type for calls, emails, meetings, notes and tasks. Fields: `type`
(call/email/meeting/note/task), `subject`, `at` (when it happened; ISO), or
`dueDate`+`priority`+`status` for tasks, `durationMin` (calls/meetings),
`to` + `outcome` + `repliedAt` for emails (outcome sent/awaiting/replied;
replying stamps `repliedAt`), `owner`, `notes`, and optional links
`companyId`/`contactId`/`dealId`/`leadId`. `src/modules/activities.js`
(`window.CRM_ACTIVITIES`) owns validation (`validate`), form application
(`applyForm`), `create`, `setTaskState` (completing records who/when),
`setEmailOutcome`, `remove`/`canDelete` and the UI: the feed
(`#/activities`, timeline grouped by type with search/owner/type filters),
the task queue (open tasks sorted by due date, overdue highlighted red,
checkbox completion), and the log form (`#/activities/log` and
`#/activities/log/<module>/<id>` pre-filled for companies/contacts/
deals/leads — its conditional fields switch with the activity type).

**Timeline composition** — `src/timeline.js` (`window.CRM_TIMELINE`):
`collect(store, scope)` returns one merged, reverse-chronological feed of
activity records and record journals (`deal.events` stage/create entries as
"<deal> — <text>", lead status entries), expanding a company scope through
its contacts' and deals' activities, and scoping deals/leads to their own
journals + directly-linked activities. `card({store, scope, ...})` renders
the filterable timeline card (type tabs auto-hide when a type has no rows)
that companies/contacts/deals/leads detail pages append; rows color-code
their type icons and link to the owning company/contact/deal.

**Email templates** — `src/modules/emails.js` (`window.CRM_EMAILS`, hidden
`emails` module). Templates persist in the `emails` document under
`content.templates[]` (`t-<hex>` ids, name/subject/body). Merge tokens:
`{{company.name|industry}}`, `{{contact.full_name|first_name|last_name|
email|role}}`, `{{deal.name|expected_value|close_date}}`, `{{today}}` —
unknown tokens stay literal so typos are visible. The library page lists
templates (＋ New / Edit / Delete with confirm); the compose page
(`#/emails/compose[/company|contact|deal/<id>]`) links the three context
selects, picks a template, auto-merges subject/body and previews the merged
result, prefills To from the contact, and offers Copy, Open-in-mail-client,
outcome select and "Log send" — `logEmail` creates the email activity
(linked to the context records) so the send appears on timelines.

**Next-step suggestions** — `src/modules/suggest.js`
(`window.CRM_SUGGEST`). `evaluate(store, rec)` applies simple rules to the
record's account-scoped activity list (activities matching the record, its
contact, or its company): (1) remind — last email unanswered for >5 days
(high, due 1 d); (2) follow up — after the latest call/meeting (med, 3 d);
(3) touch base — no activity at all and the record older than 7 days (med,
2 d); (4) set a close date — open deal with none. Suggestions are dismissible
per-rule per-record (`rec.dismissedNext[]`, compared against the triggering
activity/record anchor so new activity re-surfaces them) and Acceptable —
accepting calls `CRM_ACTIVITIES.create` with a due-date task linked to the
record. `card()` renders the "Suggested next step" panel used on deal and
lead detail pages (neutral copy when nothing is suggested).

## Reminders, digest & automation rules (Phase 5)

**Reminders** — `src/modules/reminders.js` (`window.CRM_REMINDERS`, hidden
`reminders` module, route `#/reminders`). `collect(store)` derives reminders
from *open tasks due within 7 days* (activities records: excludes done,
dateless, snoozed-until-today-or-later, and dismissed-with-reason items) and
*open deals with a close date in the window* (excludes won/lost,
close-reminder-dismissed, and closeReminderAfter-snoozed deals). Reminder
records are derived, never stored — they always reflect the true owner, due
date and links. Filter views All / Overdue / Due soon / Deal closures. Every
row carries an Actions panel: **Snooze** (presets +1/+3/+7 d or any date —
task sets `snoozedUntil`, deal sets `closeReminderAfter`), **Reschedule**
(moves `dueDate` / deal `closeDate`, clears a snooze), **Reassign**
(new `owner`), **Dismiss** (reason required, kept in `dismissed` /
`closeReminderDismissed` with by+at) — each action also writes a `note`
activity linked to the same records so nothing disappears silently; the
"Restore" list under the header undoes dismissals. A compact follow-up
radar (three count cards) sits at the top of the dashboard; each card
navigates to the matching filtered reminders view. Reminder count and
digest semantics live in `counts(store)` and `digest(store)`. Dates are
local date-only strings (`YYYY-MM-DD`) compared against `todayISO()`.

**Daily digest** — route `#/reminders/digest`: groups Overdue, Due today,
Due in 7 days, Deals closing or overdue to close, and New leads (≤24 h old,
status new/contacted/qualified), rendered as grouped rows plus a
monospace plain-text bundle (Copy-as-text) headed
`Daily digest · <date>` with a closing
"Total: n items need attention today." line.

**Automation rules** — `src/modules/rules.js` (`window.CRM_RULES`, hidden
`rules` module, route `#/rules`). Rules persist in the `rules` document as
`content.rules[]` (`ru-<hex>`): `{name, module (deals/leads/companies/
contacts), event ("write" = on record save, or "scan" = the daily sweep),
enabled, condition {f, op, v}, actions[]}`. Condition fields are the
module's editable fields plus derived scan-only `daysSinceLastActivity`
(resolved from the segments activity index). Ops include eq/ne/contains/
gt/gte/lt/lte/is_set/is_empty plus **changed_to / changed_from** (write
only): a write event fires when the value actually crossed the threshold
(passes `prev` from the moduleWrite changes; a record created already at
the value fires changed_to). Actions: **Create follow-up task** (subject
template with tokens `{name} {owner} {company} {stage} {value} {source}
{date}`, due-in days, priority), **Log a note** (subject + body), **Set a
field** (protected: id/createdAt/updatedAt/dismissal fields). Every firing
appends `content.execLog[]` (`rl-<hex>`, capped 200) with ok/note/mode
(write|scan|manual)/record ref. A boot hook registers a `moduleWrite`
listener (rules fire on their module's UI saves) and schedules one
`runScan` 6 s after load; rules also Run-now per rule and fire on manual
runs against records already matching. The manager UI (`#/rules`) shows
intro, rule cards (when→then summary chips, Active toggle, Run now, Edit,
Delete with confirm), the rule editor, and the execution log with open
links to the triggering record. The throttle (8 s per store+rule+record)
and per-record guard in fire() prevent double firings.

**Write-path retries** — `R.persistUpdate` (records.js) now retries up to 4
times (1.6 s apart) when the store reports `server_lag` — the read-after-
write lag window that back-to-back same-document writes (e.g. a reminder
action's state change + its activity note, or a rule task + exec log) used
to fail with. Conflicts (`base_mismatch`/`conflict`) are never retried;
they still surface for the sync UI. Bounded, safe: `server_lag` is only
returned when the canonical reads *older* than our own last write.

## Reports, dashboards & CSV (Phase 6)

**Dashboard KPIs** — the dashboard's first card renders seven clickable KPI
cards (pipeline value, weighted forecast, open deals, win rate, avg deal
cycle days, overdue follow-ups, activities today). Numbers are computed live
at render from fresh `loadDoc` reads of `deals`/`activities` (+ reminders
counts); each card deep-links to the list behind it
(`#/deals/open`, `#/deals/won`, `#/reminders/overdue`, `#/activities`).

**Report templates** — `CRM_REPORTS.runReport(store, templateId)` runs one of
the nine templates against the store and returns a normalized report
`{ok, rpt: {title, cols (per-column kind text|num|money), rows, chips,
note, generatedAtLabel}}` so every template shares one renderer. Templates:
`dealsByOwner`, `dealsByStage` (pipeline order, weighted), `dealsByClosePeriod`
(month buckets from closeDate), `dealsBySource` (lead-linked or \"No source\"),
`winLoss` (rate + loss reasons), `revenueForecast` (open deals by close month),
`activityByType`, `activityByOwner`, `teamPerformance`. Stage labels for
dealsByStage come from the deals document's own pipeline (defaults when the
document has none). All numbers are raw in the report rows; money columns
render formatted with `—` for blank values.

**Saved definitions & the library** — defs persist in the `reports` document
as `content.records[]` (`kind:\"report\"`, `rp-<hex>` ids). `saveDef` assigns
the id onto the caller's def object (check `def.id` after saving, not the
return). Library, builder (`#/reports/new`, `#/reports/edit/<id>`), and run
(`#/reports/run/<template-or-defId>`) routes share the tab bar
(Library / ＋ New / CSV import / Export); each catalog card runs its built-in
template or saves a named definition.

**CSV import** (`#/reports/import`) — parse (file or pasted text) → map
columns to fields (guessed from synonym headers, overridable per column,
\"Auto-map columns\" resets) → live preview table: every row shows an
ok / exists / error badge with the reason inline, chips summarize ready /
already-exist / with-errors, and the commit button imports only the ready,
non-duplicate rows (`importRows` returns `{ok, imported, skippedDup,
skippedBad}`). Nothing is written before the preview is seen. Rows that fail
name mapping or validation, or that duplicate an existing record, are never
committed.

**Export & printing** (`#/reports/export`) — per module: *Download N rows as
CSV* (flat column list, ready for spreadsheets), *Print list* (clean
rep-table printout), and a searchable record list whose per-record
*Printable sheet* renders a detail sheet (fields + a recent-activity
section for companies/contacts/deals/leads). Printing mounts into a
`#printHost` div, adds `body.printing`, calls `window.print()`, and cleans up
on `afterprint` — so the print preview shows only the sheet.

## Pipeline bus (Phase 7)

The CRM speaks to the small-business pipeline through **editable files** in
its own upload-plugin namespace (the same mechanism the document store uses,
so one generator can read another's streams). Bus files use *dotless* names
so their URLs read cleanly: `bus-ideas`, `bus-projects`, `bus-customers`,
`bus-receivables`, plus a `bus-manifest` index. File names embed the owning
generator's name (`<stream>-<genName>`), so the CRM writes `bus-projects-<its
own name>` and discovers *peers* by reading the manifest's file list. Edit
keys are cached in a `bus-ek:<file>` kv folder so repeat publishes never ask
again.

**Protocol** — every bundle is wrapped in an envelope
`{k:"bcrm-bus", v:1, stream, generator, updatedAt, bundles:[{id, at, kind,
payload}...]}`. Each stream's owner is the writer of its payload kinds and
everyone else is a reader, so nothing is ever locked: writers append to
their own out-file, readers `materialize` by unioning inbound bundles with
their own out-records (mirrored into the local `bus` document's
`content.records[]` with per-file read cursors) and show the *result* of a
given bundle rather than re-publishing it.

**Streams & kinds** — ideas (in: idea-incubator idea bundles with
desc/goals/scope bullets) → the CRM imports a selected idea as a **qualified
lead** (title → subject, desc/goals → notes) exactly once (`imp-<bundleId>`
out-records + a lead scan dedupe). Winning a deal publishes a **project
seed** (company + primary contact, deal value, close date, opportunity
reference) that project-master consumes — guarded by `deal.busHandoff` and
an in-flight busy set so a deal hands off once, ever. Flipping a company to
**customer** publishes a customer bundle (company/contact, tax id, payment
terms, `isCustomer`) for the-ledger/ERP. Receivables come back in: bundles
are matched to a company by id, else tax id, else normalized name, and each
match refreshes `company.busPayment` (paid / partial / overdue / open) shown
on the company page's "Pipeline & payments" card. When no ledger data has
been published yet the card degrades gracefully (inactive hint).

**Wiring** — `bus.js` subscribes to the event bus once (`moduleWrite`):
deals moving to `won` without a handoff publish one; companies flipping
`isCustomer` publish. Tests inject an in-memory transport
(`setTransport`) so the whole protocol is validated against fake peer
namespaces; the real transport is the store's own editable-file layer and
degrades with plain-language errors on the unsaved workspace
(over_daily_allowance until the generator is saved).

## Data integrity & system health (Phase 8)

`src/integrity.js` (`window.CRM_HEALTH`) re-reads every module document and
runs a fixed set of checks over the assembled records. Each finding is a
problem object `{code, sev ("err"|"warn"), module, recId, name, title,
detail, href, action, hrefText}`; `problemsFor(docs)` returns
`{problems[], truncated, counts:{err, warn}, ok}`. Every problem row links
straight to the record or list behind it and carries a one-line *action*
("Open the contact and re-link it…", "Review and merge them…").

Checks (module → code → severity):

- companies — `dup_companies` (warn): two active companies with the same
  normalized name or website (honoring each record's dismissed pairs);
  `company_customer_flag_missing` (warn): a contact is flagged a customer
  but its company is not.
- contacts — `dup_contacts` (warn): same normalized email, or same name at
  the same company; `orphan_contact` (err): `companyId` points at a company
  that no longer exists.
- leads — `lead_converted_no_deal` (err): converted but no deal was
  created; `lead_converted_dangling` (warn): `convertedToDealId` points at
  a missing deal; `lead_converted_no_date` (warn): converted without a
  `convertedAt`; `lead_disqualified_bare` (warn): disqualified with no
  reason.
- deals — `deal_no_company` (err) / `deal_no_contact` (err): link points at
  a missing record; `deal_won_no_date` / `deal_lost_no_date` (warn):
  terminal stage without a close date; `deal_terminal_conflict` (warn): a
  deal reached `won`/`lost` and later moved to a different stage;
  `deal_converted_not_won` / `deal_converted_no_company` /
  `deal_converted_customer_mismatch` (warn): customer conversion recorded
  before the deal was won, without a company, or on a company that is not
  flagged `isCustomer`.
- activities — `activity_orphan_ref` (err): a `companyId`/`contactId`/
  `dealId`/`leadId` that points at a missing record.

Findings beyond the first 100 per run are truncated (reported, with a note
in the card). Writes drive re-checks: the boot hook attaches a `moduleWrite`
listener (schedule → re-check after a 1200 ms debounce), and the dashboard's
"Data integrity" card (`zone(store)`) shows the running status chip
(all clear / n errors · n warnings / checking…) plus the problem list with
its action links. Because tests and real pages share the global event bus,
every `moduleWrite` payload carries the writing `store` and every subscriber
that observes changes (bus, rules, integrity) ignores events from stores it
does not own — the mock stores used by the self-test suites can never trigger
real background publishes or re-checks.

## Round-trip fixtures, error copy & recovery (Phase 8)

**Fixture suite** — `src/selftests/fixtures.test.js` locks the migration
promise of the store: *legacy* documents (older schema versions, junk rows,
stray-text records) round-trip byte-for-byte through save → load → re-save
across all ten modules; a stale offline edit over a legacy document resolves
as a real conflict whose field-level merge keeps the untouched legacy fields;
a duplicate merge over legacy records rewrites every reference onto the
survivor and carries the legacy fields along; a full backup → wipe → restore
cycle (validated, idempotent, key-recovering) restores every module
byte-identical; and the complete lead → deal → won → customer → project-seed
bus chain runs over legacy data with the single-send guarantee intact.

**Error copy & recovery** — every failure a user can hit maps to plain,
actionable copy through one of two describe functions, both tested for
minimum length, a concrete next step, no leaked code identifiers, and a
friendly generic fallback ("The change could not be saved."):

- `RECORDUI.describeError(result, label?)` — store-level failures
  (`src/recordsui.js`): the `ERR_MAP` covers `doc_too_large`, `file_too_big`
  (→ Capacity & archive), `over_daily_allowance` (→ allowance reset /
  archive), `no_edit_key` (→ Backup & restore), `conflict` /
  `conflict_stale` (→ Dashboard resolve / reload), `schema_mismatch`,
  `corrupt_head`, `corrupt_part`, `corrupt_sha` (→ restore from backup),
  `merge_failed`, `server_lag`, `doc_missing`, `requires_saved_generator`,
  `editable_error`, `unreadable_modules`, `pending_changes`, `save_failed`,
  `update_failed`, `load_failed` — each with the Dashboard section to open
  next. An unknown code falls back to the raw `detail`, then to the generic
  line.
- `CRM_BUS.describe(code)` — pipeline-bus failures (`src/bus.js`):
  not-configured / not-found / timeouts / connection errors, malformed
  envelopes and manifests, missing write keys, quota and size refusals,
  busy in-flight guards, transport setup, stream/bundle mismatches, and the
  won-deal/customer/import CAS failures — each with the retry or fix to
  perform (e.g. "Only a won deal can be handed off — move the deal to Won
  first.").

## Adding a new CRM object type (playbook)

A new module object (say `invoices`) needs these pieces; the existing
companies/contacts modules are the template to copy:

1. **Declare the document** — add the module id to `STORE_MODULES` in
   `src/app.js` (or wherever the store boot list lives) so `store.ready()`
   reconciles it, and add a descriptor `{id, label, tagline, icon,
   empty:{title, message}}` in `src/modules.js` (set `hidden:true` while
   it has no nav presence). The record prefix lives where ids are minted
   (`src/records.js`): `in-<hex>`.
2. **Numbering** — if records get sequential human numbers, seed
   `settings.nextNumber` in the store's settings document and bump it
   inside the create path (never mint two records with the same number).
3. **Record UI + pages** — write `src/modules/invoices.js` registering a
   renderer (`window.CRM_RENDERERS.invoices`) handling list / new / detail
   / edit routes through the shared `RECORDUI` form helpers and
   `R.persistUpdate`, following the companies module's shape.
4. **Segment filters** — add field definitions (including virtual date
   fields) in `src/segments.js` so saved segments and the segment control
   work on the new module; `daysSinceLastActivity` needs the activities
   index there too.
5. **Register in navigation** — the side nav and dashboard module grid
   enumerate non-hidden descriptors; add the id to any explicit nav list
   and to `ROUTE` maps (integrity.js links, CSV/print export module list,
   reports scopes) that enumerate modules.
6. **Dashboard KPIs** — extend the dashboard KPI computation for any
   headline number the new object type adds.
7. **Cross-links & delete guard** — if records reference companies/
   contacts/deals or are referenced by activities, add the field to
   `REF_FIELD`/`findRefs` in `records.js`, the merge rewrite map in
   `src/dups.js`, and the integrity checks in `src/integrity.js`, and wire
   `canDelete` to refuse while references exist.
8. **Tests** — add `src/selftests/invoices.test.js` (form normalization,
   store round-trip, reference integrity, list/detail smoke) and register
   it in `index.html` after the other suites.

## Running validation

Dashboard → "Run self-tests", or sidebar "Run self-tests", or
`window.SELFTEST.run()` in the console. The suite navigates the app itself and
ends on the Self-tests report page. For a targeted pass, run one prefix at a
time — e.g. `window.SELFTEST.run("reminders:")`, `("rules:")`, `("deals:")` —
rather than the full suite. Suites that hit the real server (names ending
"needs saved generator") are safe to run on a saved generator and skip the
unsaved-preview transport.

## Live hub (Phase 9)

The CRM becomes multi-user once the generator is **saved**: the server script
at the top of `index.html` (a `<script type="text/x-server-plugin">` element,
shipped before any styles/scripts) hosts a member store and broadcast bus,
and `src/hub.js` turns it into realtime collaboration.

**Membership & roles.** A hub has up to 48 members: `owner` (one; created on
first set-up), `manager` and `viewer`. Managers can edit (every document
write from any session is reported through the owner/manager-only
`reportWrite` RPC, which bumps the module's revision, writes an audit entry
and publishes an `hc:<module>` change to every session); viewers are
read-only — the client wraps the store write path to return a `read_only`
result and the server independently refuses viewer reports. The owner
manages members (add / change role / reset password / remove) and views the
full audit log; managers see the same audit but no team controls.

**Server state.** Authoritative state lives in one binary `Uint8Array`
(v1 layout: `BCMHUB` header, then a fixed-stride member table — id, role,
name, a 32-byte SHA-256 credential hash, createdAt/lastAuth — a module
revision index for the ten store modules, and an audit ring). Passwords are
never stored: auth compares a SHA-256 of `bcrmhubv1|<memberId>|<password>`,
with strict password rules (printable ASCII, 12–64 chars) because only
high-entropy passwords are safe to hash deterministically. Member passwords
are chosen by the owner at add-time (the UI can suggest a strong one) and
shared out-of-band — nothing secret lives in the source, the kv folder or
the server script. Setup/auth RPCs are rate-limited per connection
(auth: 6 per 60 s, plus a network cap), with a misbehaving-server quarantine
on top.

**Realtime path.** Every connection subscribes to the presence channel
(`hp`) and all module channels (`hc:*`) on open. Presence (`online` count +
per-member {id, name, role, page, lastSeen}) is pushed on auth / signout /
page change / disconnect; the client re-pushes a ≤60-char page label at
most every 4 s. On any remote `chg`, the client compares its loaded record
against the new revision's copy: on an untouched list/detail page it
re-renders in place; if the user is mid-edit (`viewDirty`), it pins a change
bar ("Reload record / Keep editing") instead of clobbering their form. When
the socket is down the client polls the module list every 30 s (degraded
state) and reconnects with 3 s → 30 s backoff.

**Client state machine.** `off | connecting | open | needs_auth |
degraded`; hub configuration (name only) persists in the kv `hub:cfg` key —
never the password, which lives in memory for the session. The Integrations
page hosts the hub card (enable/set-up, sign in, disable, status row,
presence, team and activity panels). While the generator is **unsaved**, the
server-plugin one-tab emulator runs the same protocol in-process (that is
what the hub test suites exercise, and it resets on every reload, so the hub
comes back disabled); after **saving**, the first sign-in on the live page
creates the hub and its owner.
