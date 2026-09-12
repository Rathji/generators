# RMM-U (built on the Business ERP framework)

**Build state:** this generator is being repurposed as **RMM-U**, a multi-tenant
Remote Monitoring & Management platform. The authoritative 50-task, 12-phase
backlog lives in the comment block at the top of `main.pjs` (mirrored verbatim in `src/SPEC.md`). Workflow: implement
only the first uncompleted `[ ]` task, add validation tests, flip it to `[x]`,
stop for review. Per the roadmap's strict-hold rule, no implementation starts
until the go-ahead. **Phase 1 — Tasks 1 (console shell & navigation), 2 (tenancy
& data storage), 3 (device hierarchy & inventory record), 4 (master configuration)
and 5 (sync, conflict, backup & versioning) — is done, and Phase 2 has begun and
now runs through Tasks 6 (agent packaging & installer generator), 7 (enrollment
& device identity), 8 (heartbeat, presence & capabilities), 9 (system inventory
collection), 10 (performance metrics collection), 11 (command & script
execution), 12 (agent resilience, self-update & safety), 13 (agent diagnostics
& support) and Phase 3 Tasks 14 (collector service), 15 (job queue & dispatch),
16 (event stream & degraded mode) and 17 (retention, batching & scale) and
Phase 4 Tasks 18 (device groups & tags), 19 (policy engine), 20 (monitor
types), 21 (schedules & maintenance windows), 22 (automation engine) and
23 (script & component library), and Phase 5 Tasks 24 (alert lifecycle), 25
(notification routing & escalation), 26 (PSA ticket integration) and 27 (alert
triage workspace), and Phase 6 Tasks 28 (patch policy) and 29 (patch scanning &
compliance) and 30 (patch deployment & audit), and Phase 7 Tasks 31 (software
catalog & deployment packages), 32 (software deployment & detection) and 33
(license & inventory reconciliation), and Phase 8 Tasks 34 (security posture
monitoring), 35 (compliance baselines & drift) and 36 (backup verification
monitoring), and Phase 9 Tasks 37 (remote shell/console), 38 (remote-tool
integration & session handoff) and 39 (file transfer), and Phase 10 Tasks 40
(operational dashboards), 41 (reporting), 42 (integrations & bus publication)
and 43 (data-quality linter), 44 (agent simulator & end-to-end suite), 45
(agent security tests), 46 (failure, storm & scale tests) and 47 (README &
playbook). **Phase 11 is complete and Phase 12 — Tasks 48 (role & access
model), 49 (realtime console) and 50 (multi-user audit & rate control) — is
done. The 50-task backlog is now complete.**

> **Start here to operate or extend the system: [`src/PLAYBOOK.md`](PLAYBOOK.md)**
> — architecture, the agent lifecycle, the credential/token security model and
> the no-static-secret rule, how to add a monitor type / script / patch policy /
> automation action, the psa-u + documentation-tool ownership model, and the
> runbook for agents that go dark.

The code below is the **Business ERP** it is built on — kept as the reusable
framework (module shell & navigation, canonical versioned document store,
sync/conflict/backup & archival, master configuration, server-plugin realtime
hub). It is being migrated station-by-station into the RMM console; the ERP
module controllers (CRM, Sales, Purchasing, Inventory, Projects, Finance,
Reports) will be replaced by the RMM stations (Devices, Groups, Policies,
Monitors, Alerts, Automations, Patches, Software, Security, Integrations,
Admin). This document describes the framework as it stands today.

## Task 1 (done) — console shell & navigation

The frame every RMM station renders inside: brand header, grouped side
navigation, topbar (page title/subtitle, hub state, role selector, sync, health,
theme), the shared modal + toast containers, and consistent loading / empty /
error states. Responsive: fixed sidebar ≥1024px, off-canvas drawer + overlay
below that.

- **Stations** (`src/erp.modules.js`, `STATIONS`) — the 13 console destinations:
  `dashboard`; **Endpoints** = `devices`, `groups`, `policies`; **Monitoring &
  response** = `monitors`, `alerts`, `automations`; **Deployment** = `patches`,
  `software`, `security`; **Insights** = `reports`, `integrations`; **System** =
  `admin`. Each carries `label`, `group`, `icon`, `roles` (currently `[]` = every
  role; the real role model is Task 48) and `desc` (topbar subtitle).
- **Placeholder renders** — a station with no controller yet renders the shared
  empty/phase state from its `empty` definition, naming the phase/task that will
  fill it. When a phase lands, add `render: controller("<id>")` (or any
  `render(ctx)`) to that station; the shell then calls it instead. No other
  wiring — nav, router, guards and states come from the framework.
- **Nav groups** live in `GROUPS` in `src/erp.js`; station icons live in `ICONS`.
- **Hidden modules** (in `erp.modules.js`, never in nav) carry the framework /
  system documents the shared store, backup and master-config still depend on;
  Task 2 added the RMM `providers` registry document to that set (the legacy
  ERP docs are retained until their stations are replaced). The `devices`
  station is wired to its controller (`render(ctx)` → `ERP.devices.render`)
  via Task 3, the `admin` station is wired to the master-config Admin
  console (`render(ctx)` → `ERP.masterConfig.render`) via Task 4, and the
  `reports` station is wired to the data-continuity console
  (`render(ctx)` → `ERP.continuity.render`) via Task 5; the other 10
  stations still render the shared phase empty-state until their phase lands.
- **Test**: `await window.RMMShellTest()` (49 checks) — all 13 stations
  registered + rendered, nav grouping, router, role-aware visibility + route
  guard, loading/empty/error states, responsive drawer, and the module framework
  API. Verified at 1920×1080 and 390×844.
- **Visual-QA caveat**: the `snapshot.js` capture helper mis-renders text inside
  `display:flex; gap:` layouts (lines collide in the raster) even though the live
  DOM is correct — verify those with `getBoundingClientRect()` rather than
  trusting the snapshot's text spacing. The `ui.summary` stat cards are such a
  flex layout, so their "overlapping" numbers in a snapshot are always this
  artifact.
- **Table cell convention**: `ui.table` escapes every cell value, so a cell that
  contains markup must supply a `render(row)` function (as the ERP controllers
  do) rather than a raw HTML string in the row object — otherwise the tags show
  up as literal text. HTML cells added by Tasks 18–20 (and the metrics sparkline
  + retention capacity bar) had to be moved to `render` for this reason.

## Task 2 (done) — tenancy & data storage

Each managed-service provider (MSP tenant) is a versioned JSON document in the
platform's own namespace, with sites, device groups, devices, policies, monitor
definitions, alert history, script library, patch/software state and automation
rules all living inside one provider aggregate.

- **Namespace rebrand.** The canonical store (`src/erp.store.js`) now reads its
  namespace from `config.rmm.namespace` (default `rmm`), so every document is
  `rmm-v1-<doc>` and the envelope schema is `rmm-doc` / `rmm-index`. Editable
  edit keys are cached at `rmm.store.v1.keys.<doc>`, the fast local cache at
  `rmm.store.v1.cache.<doc>`. The store gained a generic
  `put(name, recordsOrDoc, meta, opts)` (write any document by full store name,
  with optional index meta) that `set()` now delegates to, so ad-hoc docs such
  as provider aggregates are labelled correctly in the store index.
- **Provider document** (`rmm-v1-provider-<id>`): the tenant aggregate —
  `kind/id/name/legalName/status(active|onboarding|suspended|archived)/
  timezone/currency/locale/contact{}/tags[]/demo/createdAt/updatedAt`, the eight
  record collections (`sites`, `deviceGroups`, `devices`, `policies`,
  `monitorDefinitions`, `alerts`, `scriptLibrary`, `automationRules`) and two
  object collections (`patchState{policies,scanRuns,approvals}`,
  `softwareState{catalog,deployments,licenses}`) plus `meta{}`. Because it goes
  through the store it gets the versioned envelope, canonical edit-key copy,
  fast local cache, monotone revisions, the write ceiling and compare-and-set
  conflict protection for free.
- **Tenant registry** (`rmm-v1-providers`, declared as the hidden `providers`
  module): one summary record per provider (id, name, status, demo, timezone,
  currency, site/group/device counts, updatedAt) so the console can list tenants
  without loading every aggregate.
- **`window.ERP.tenancy`** (`src/rmm.tenancy.js`): `newId/newItemId`,
  `namespace/registryDocName/providerDocName/providerLogicalName`,
  `newProvider/normalizeProvider/providerFields`, `list/get/exists/create/update/
  save/archive/restore/remove`, collection helpers `addItem/updateItem/
  removeItem/item` (auto-prefixed ids `site-`/`grp-`/`dev-`/`pol-`/`mon-`/
  `alrt-`/`scr-`/`auto-`, `createdAt`/`updatedAt` stamping, unknown-collection
  rejection), `stats/validate/onChange/reload/seed/init`. `T.update` is a
  read-modify-write under the store's CAS guard (conflicts are surfaced, never
  silently discarded). `T.remove` is a soft-remove (document retained as
  `archived`, dropped from the registry). Seeded idempotently at boot with one
  demo tenant (`config.rmm.seedDemo`, `config.rmm.demoProviderName`) so a new
  console is never empty.
- **`config.rmm`** in `main.pjs`: `namespace`, `seedDemo`, `providerPrefix`,
  `defaultTimezone`, `defaultCurrency`, `demoProviderName`.
- **Test**: `await window.RMMTenancyTest()` (47 checks, stub backend) — namespace
  + doc naming, registry declaration, create → rev 1 + canonical envelope +
  validate, cached edit key + cache, registry/stat counts, offline cache read,
  cross-device re-read from canonical, update/rename, collection CRUD + id
  rejection, archive/restore/soft-remove retention, change events, CAS conflict
  → keep-mine, idempotent demo seed, and namespace hygiene. Run alongside
  `await window.RMMShellTest()` (49 checks).

## Task 3 (done) — device hierarchy & inventory record

The managed fleet and the rich device record that every later station attaches
to (monitors, alerts, patches, software, security, jobs all reference a device
id). Lives inside each provider aggregate, with `window.ERP.devices`
(`src/rmm.devices.js`) as the service + the Devices station controller.

- **Hierarchy**: provider → site(s) → device-group(s) → device(s), plus
  provider-wide groups (a group with no site) and unassigned devices (no site).
  `D.tree(providerId)` returns the whole structure (`sites[].groups[].devices`,
  `sites[].ungrouped`, `providerGroups`, `orphanGroups`, `unassigned`);
  `D.ancestry(providerId, deviceId)` returns a device's provider + site + groups
  (its "anchor"). Group membership is stored on the device (`groupIds`), single
  source of truth; dynamic groups arrive Task 18.
- **Rich device record** (`D.newDevice`/`normalizeDevice`): identity
  (`hostname`/`displayName`/`role`/`formFactor`/`manufacturer`/`model`/`serial`/
  `domain`+`domainRole`), OS (`{family,name,version,build,edition,arch,
  installDate}`), hardware (`cpu{model,cores,threads,speedMhz}`, `ramBytes`,
  `gpus[]`), `disks[]` (`kind/sizeBytes/freeBytes/filesystem/volume`),
  `interfaces[]` (`mac`/`ip4[]`/`ip6[]`/`subnet`/`gateway`/`dhcp`/`speedMbps`),
  `loggedInUsers[]`, `tags[]`, `purchaseDate`/`warrantyExpiresAt`/
  `supportExpiresAt`, `agentVersion` + `agent{channel,installedAt,capabilities,
  updatePending}`, `firstSeenAt`/`lastSeenAt`/`enrolledAt`, `documentation
  {refId,refUrl,systemId,syncedAt}` (the documentation-tool link), `notes`,
  `custom{}`, plus `siteId`/`groupIds`/`status`.
- **Service API**: `newDevice/normalizeDevice/deviceFields/validateDevice`,
  `add/update/remove/get/list/listAll`, `forSite/forGroup/groupsOf/siteOf`,
  `tree/treeOf/ancestry`, `stats/statsOf/fleetStats`, `setSite/assignGroup/
  unassignGroup/setStatus`, `markSeen` (agent check-in), `onChange`, and the
  derived attributes `primaryIp/primaryMac/allIps/allMacs/totalDiskBytes/
  freeDiskBytes/diskUsedPct/bytesHuman/ramHuman`. `matches(dev, filter)` filters
  by site/group/role/OS family/tag/status and free-text (hostname, serial,
  model, tag, IP, MAC, user). Liveness (`online`/`stale`/`offline`) is derived
  from `lastSeenAt` against `config.rmm.staleAfterMinutes`; `maintenance`/
  `retired` override it. Mutations reject unknown sites/groups.
- **Devices console UI**: a Fleet tab (status summary, provider/site/group/
  status/role filters + search, inventory table with OS, site, groups, liveness,
  last-seen, agent, primary IP) and a Structure tab (the hierarchy tree with
  inline add-site / add-group and click-through device chips). Device detail
  modal shows the full inventory (identity, OS/hardware, disks, network, users,
  agent lifecycle, documentation link, tags, notes); Add/Edit form and Remove
  are wired to the service. Multi-tenant via a provider picker (persisted in
  `D.currentProviderId`); responsive, styled by the Task-3 block in `erp.css`.
- **Demo fleet seed**: `D.seedDemo()` (config `rmm.seedDemoDevices`) puts six
  realistic devices (servers, workstations, a Mac, a Linux VM, with online /
  stale / offline variety) into the demo tenant on first run, awaiting the
  tenancy seed via `T.ready` so the two never race.
- **Test**: `await window.RMMDevicesTest()` (59 checks, stub backend) — schema
  normalisation + validation, add/update/remove, filters, derived attributes,
  liveness, tree/ancestry/stats, group/site membership, agent check-in,
  registry count, change events, and the idempotent demo-fleet seed.

## Task 4 (done) — master configuration

The tenant-wide reference data every later station attaches to: the severity
vocabulary, monitor types, notification channels, schedules & business
calendars, maintenance windows, patch classifications, software categories,
tag & group taxonomies and script categories. One schema-driven service —
`window.ERP.masterConfig` (`M`, `src/rmm.master.js`) — owns all eleven
sections, their CRUD, their lookups and the Admin console that edits them.

- **Sections** (`SECTION_DEFS`): `severities`, `monitorTypes`, `channels`,
  `schedules`, `calendars`, `maintenanceWindows`, `patchClassifications`,
  `softwareCategories`, `tagTaxonomy`, `groupTaxonomy`, `scriptCategories`.
  Each section declares its fields (type, label, required, enum options,
  default, help), a record label, a default sort and whether records are
  reorderable / have an `enabled` flag; the generic tables, forms and
  validation are all generated from that one definition, so adding a field or
  a whole section is a data change, not new UI code.
- **Seed & normalisation**: `defaultSections()` / `defaultConfig()` ship a rich
  idempotent default (84 records across the eleven sections — severities from
  informational through critical, a standard monitor-type set, email/SMS/
  webhook/Slack/Teams channels, 24×7 + business-hours schedules with timezone
  and holiday referencing, patch rings, software categories, starter
  taxonomies). `normalizeConfig`/`normalizeRecord`/`coerce` fill defaults,
  stamp ids (`sev-`/`mtype-`/`chan-`/`sched-`/`cal-`/`mw-`/`pcls-`/`scat-`/
  `tag-`/`gtax-`/`scr-`), timestamps and ordering; `validateRecord`/`validate`
  report required/enum/duplicate problems.
- **CRUD** (all async, all attributed): `add`, `update`, `remove`, `toggle`,
  `setEnabled`, `move`, `reorder`, `setDefault`, `saveSettings`. Every
  mutation commits through the shared store as the `rmm-v1-config` document
  (single, not split by year) and appends a change-history entry
  (action, section, record, before/after, actor, ts).
- **Lookups & resolvers**: `severity`/`monitorType`/`channel`/`schedule`/
  `calendar`/`patchClass`/`softwareCategory`/`scriptCategory`/`tags`/
  `label`/`enabled`/`severityTone` resolve ids to records or display labels for
  the rest of the console; `refOptions(section)` feeds select inputs. The
  calendar helpers `zonedParts`/`inBusinessHours`/`maintenanceActive`/
  `activeMaintenance`/`isSuppressed` evaluate business hours and maintenance
  windows in the tenant/schedule timezone (needed by alert routing and
  quiet-hours in later tasks).
- **Change history**: `history()` / `clearHistory()` — a chronological,
  attributable log of every config change, viewable and clearable from the
  Admin console (clearing leaves a single `clear-history` entry).
- **Admin console** (`M.render(ctx)`): the `admin` station. Tabs = **Defaults**
  (tenant-wide settings) + one per section (with live record-count badges) +
  **Change history**. Generic tables with per-row edit / enable-disable /
  move / delete and make-default actions, an add/edit modal generated from the
  section schema, and read-only presentation for the `staff` role (owner and
  manager may edit). Deep-linkable via `ctx.el.__tab` (`#/admin:<section>`).
- **Lifecycle**: `seed` / `reseed` / `ready` / `init` / `onChange` — the config
  is seeded idempotently at boot (and can be re-seeded), `ready` resolves for
  dependent tasks, and `onChange` subscribers are notified on every commit.
- **Test**: `await window.RMMMasterConfigTest()` (81 checks, stub backend) —
  seeding + idempotency, section/field schema, normalisation & validation,
  per-section CRUD + reorder/enable/default, lookups & ref options, calendar /
  business-hours / maintenance-window resolution, change history + clear,
  settings persistence, `render` (tab list, table rows, edit modal) and staff
  read-only enforcement.

## Task 5 (done) — sync, conflict, backup & versioning

Data continuity across devices and reloads: startup reconciliation, two-console
conflict resolution, one-click backup + validated restore, bounded version
history, and capacity/archival guidance — surfaced as a **Data & continuity**
console under the Reports station. The engine is `window.ERP.continuity`
(aliased `DC`, `src/rmm.continuity.js`); the Sync Center (keep-mine/keep-theirs/
field-merge) is the separate `src/erp.sync.js` from the ERP framework.

- **Startup reconciliation** — `DC.reconcile()` compares every owned document's
  local cache against its canonical copy (via `store.readCanonical`) and reports
  agree / local-ahead / canonical-ahead / diverged / missing per document, so a
  device that was offline knows what it is behind on. Runs automatically at boot
  (~3.5 s) and is re-runnable from the console.
- **Sync Center** — `src/erp.sync.js` (framework, already present): topbar sync
  button + conflict badge, attention banner, and a modal offering *keep mine* /
  *keep theirs* / *field-level merge* on a two-console edit before overwriting.
- **Version history** (`rmm-v1-versions`) — bounded per-document snapshots.
  `DC.capture/doc/captureChanged/captureAll` write a snapshot ring (25
  snapshots/doc, 1.5 MiB/snapshot, 3 MiB total by default; all
  config-overridable). `install()` wraps `store.saveDoc/put/forceSet/clearDoc` so
  every commit captures automatically (debounced 1200 ms; skipped while
  `store.backendOverridden()` so tests never write history behind a stub).
  `compare(a,b)` diffs two versions (added/removed/changed records) and
  `restore(id)` restores a snapshot after first capturing a pre-restore snapshot,
  so a restore is itself reversible. `list/get/prune/clear/stats` manage the ring.
- **Backup & restore** — reuses `ERP.backup` (from the framework): one-click
  `downloadBackup` (JSON file) plus `publishBackup` (a `rmm-v1-backup` document
  readable cross-device), with `validateBundle` schema checking and
  `restoreBundle` validated restore.
- **Capacity & guided archival** — `DC.capacity()` reports every owned document's
  size/records/rev against the storage ceiling, **including the per-tenant
  `provider-<id>` aggregates** (the framework's `backup.capacity` only listed the
  declared docs). `DC.archiveCandidates()` recommends archival;
  `archiveTenant/restoreTenantArchive` move a whole tenant aggregate in/out of the
  read-only archive.
- **UI** (`DC.render(ctx)`) — the Reports station's **Data & continuity** console:
  tabs *Sync & conflicts*, *Version history*, *Backup & restore*, *Capacity &
  archival*.
- **Tests**: `await window.RMMContinuityTest()` (Task 5, 50 checks) — capture
  ring bounds, compare/restore (incl. reversible restore), startup reconcile
  report shape, capacity over all docs incl. provider aggregates, archive
  candidates / tenant archive+restore, and the console's tabs/rows.

## Tasks 6–8 (done) — the agent: packaging, enrollment, heartbeat

Phase 2 makes the managed endpoint real. Three services split the work; the
collector that these will ultimately talk to is the Phase-3 server-plugin hub
(Task 14), which mirrors the same rules server-side (it cannot import client
modules, so the semantics are stated once here and re-stated there).

- **`window.ERP.agent`** (`AG`, `src/rmm.agent.js`, Task 6) — the **agent
  packaging & installer generator**. Owns the **platform catalogue** (Windows →
  Scheduled Task / PowerShell, Linux → systemd / sh, macOS → launchd / sh) and
  the **capability catalogue** (inventory, metrics, jobs, patches, software,
  remote-shell, file-transfer, self-update, reboot, backup-monitor) with
  `platformForFamily`, `capabilitiesFor`, `normalizeCapabilities`, `supports`.
  `AG.installer(opts)` generates a complete, self-contained installer+runtime
  script for one platform that embeds the **collector address, provider
  identity, assigned site/groups and a one-time enrollment token**, installs the
  agent and registers it to start on boot (scheduled task / systemd timer /
  launchd daemon), runs the first enroll + heartbeat, and prints a clear
  success/failure status **with the device's initial id**. `AG.installerForProvider`
  resolves the tenant's names and issues the token; `AG.downloadScript` gives a
  real Blob download. The generated script carries **one secret only** — a
  single-use, revocable token.
- **`window.ERP.enrollment`** (`E`, `src/rmm.enrollment.js`, Task 7) — the
  **enroll handshake & device identity**, plus the credential/token security
  model as a synchronous, dependency-free service (it carries its own pure-JS
  **SHA-256** so the server mirror can use the same primitive). Tokens (bound to
  a provider + optional site/groups, optionally bound to an existing device for
  re-enrollment, with expiry + max-uses) and credentials are persisted in the
  hidden **`rmm-v1-enrollment`** document **only as hashes**; the plaintext is
  returned exactly once by `issueToken` / `enroll` / `rotateCredential`.
  `enroll` validates + burns the token, creates the device (or re-keys it in
  place on a re-enrollment token), mints a durable credential and records the
  identity on the device. `authenticate` compares the stored hash in constant
  time; a **revoked device is refused**. Also `beginReenroll`, `revokeDevice`,
  `identity`, `listTokens`, `listCredentials`, `stats`, `onChange`.
- **`window.ERP.heartbeat`** (`H`, `src/rmm.heartbeat.js`, Task 8) — **heartbeat,
  presence & capabilities**. `heartbeat({deviceId, credential, payload})`
  authenticates, stamps last-seen, reports the **server time + next interval**,
  computes **clock skew** against the endpoint's `clientTime`, detects a
  **network change** (order-independent MAC/IP/gateway fingerprint, with a
  bounded per-device `custom.networkHistory`) and records the **agent version +
  normalised capabilities**. `sweep(providerId)` derives per-device
  online/stale/offline (via the Task-3 liveness rule driven by
  `config.rmm.staleAfterMinutes`) and records **presence transitions** — the
  input Phase 5 turns into agent-offline alerts. `summary`/`deviceSection`
  feed the device modal.
- **Devices → Deploy console** — a third tab on the `devices` station
  (`AG.renderDeploy`): enrollment/credential/reporting stat cards, a per-platform
  **installer generator** form (platform, site, group, collector address, agent
  version), the **enrollment-token table** (bound-to, expiry, uses, status,
  revoke), and the **agents table** with **rotate key / re-enroll / revoke**.
  The device detail modal gained an **"Agent, enrollment & presence"** section.
- **Config** (`config.rmm`): `agentVersion`, `heartbeatSeconds`,
  `enrollmentTokenTtlMinutes`, `collectorUrl` (empty ⇒ derived from the page
  origin). The hidden `enrollment` document was added to `erp.modules.js`.
- **Tests**: `await window.RMMAgentTest()` (40 checks), `await
  window.RMMEnrollmentTest()` (36 checks) and `await window.RMMHeartbeatTest()`
  (25 checks) — all stub-backend, covering the catalogues, the generated
  PowerShell/systemd/launchd installers (embedded identity + token, boot
  service, enroll+heartbeat, no placeholder leaks), hashed-only token/credential
  storage, single-use/expired/revoked/unknown tokens, rotation, revocation,
  re-enrollment without duplication, heartbeat skew/version/capabilities,
  baseline-vs-change network logic, presence sweep transitions, and the Deploy
  console.

## Tasks 9–11 (done) — inventory, metrics & jobs

Phase 2 continues: the agent now reports the full system state and can be driven
from the console. Three services, all hidden-document backed and per-device
authenticated, feed three new tabs on the **Devices** station plus sections in
the device modal.

- **`window.ERP.rmmInventory`** (`INV`, `src/rmm.inventory.js`, Task 9) — the
  **system inventory collector**. Normalises eleven sections (hardware, OS,
  software, services, patches, disks, interfaces, users, groups, security, backup)
  into a canonical, deterministically-ordered shape with a stable **FNV-1a hash**,
  then **delta-first**: `diff(prev,next)` yields only added/removed/changed items
  per section (each list capped, with a truncation flag), `apply(prev,delta)`
  reconstructs a full inventory. `submit({deviceId,credential,payload})`
  authenticates, applies a `full` or `delta` payload, keeps the stored snapshot +
  a **bounded per-device delta log** (`inventoryDeltaLimit`), patches the device
  record's asset fields (manufacturer/model/serial/cpu/ram/disks/interfaces) and
  stores a compact `custom.inventory` summary (counts, OS, AV/firewall/encryption/
  backup posture) for the console. A no-op full collection is not a new revision.
  Tenant roll-ups: `softwareIndex` (publisher+title → device count + versions),
  `patchIndex`, `securityRollup`. `requestCollection` flags devices for collection
  on their next heartbeat (capability-gated), `agentPayload` is the pure
  agent-side full-vs-delta decision. Hidden **`rmm-v1-inventory`** document.
  Demo snapshots are seeded for demo tenants via `INV.init`.
- **`window.ERP.metrics`** (`MET`, `src/rmm.metrics.js`, Task 10) — the
  **performance-metrics collector**. A metric `CATALOG` (cpu, mem, disk usage/IO,
  net rx/tx, latency, load, uptime) plus arbitrary `custom` counters.
  `normalizeSample` clamps/validates and accepts `at`/`t`/`time`/`timestamp`
  (ISO or epoch ms); samples fold into three **tiered rings** — raw, hourly and
  daily roll-ups — each bounded by config (`metricsRawPoints`/`HourlyPoints`/
  `DailyPoints`), with incremental `mergeAgg`/`aggValues`. `submit` takes an
  authenticated **batch** (capped by `metricsMaxSamplesPerPost`) and keeps a live
  `custom.metrics` summary on the device. Reads: `latest`, `series`, `range`
  (auto-selects the tier by span), `fleetSeries` (sample-count-weighted fleet
  trend), `pressure` (hot-device detection), `stats` + retention.
  `requestSample` flags devices (capability-gated). Hidden **`rmm-v1-metrics`**
  document; demo series seeded by `MET.seedDemo`.
- **`window.ERP.jobs`** (`J`, `src/rmm.jobs.js`, Task 11) — the
  **command & script execution** path. A per-OS language catalogue
  (powershell/cmd/bash/sh/python/binary) with `compatible`/`familyOf`/`commandLine`.
  `enqueue` validates and creates one job targeting many devices, each with its own
  result record. `claim({deviceId,credential})` is the agent fetch: it authenticates,
  delivers queued jobs (marking them delivered, bounded by `limit`), **fails
  incompatible jobs with a clear reason instead of running them**, and expires
  stale queues. `result(...)` posts an authenticated outcome (exit code,
  bounded stdout/stderr, timeout) and derives state. Aggregate `deriveState`:
  queued/delivered/running/succeeded/partial/failed/timed-out/unsupported/expired/
  cancelled. Lifecycle: `cancel`, `retry`, and `reap` maintenance (re-queue
  delivered-but-never-started runs, time out over-runners, expire stale queues,
  prune past `jobRetentionHours`). Console: **Devices → Jobs** tab, the device
  modal's jobs section, and the run-a-command form/view. Hidden
  **`rmm-v1-jobs`** document.
- **The generated agent runtime** (`src/rmm.agent.js` — built into every
  installer): the PowerShell and POSIX scripts now carry a working runtime, not
  just enrollment + heartbeat. On each check-in, `Send-AgentHeartbeat` (Windows)
  / the `--once` branch (macOS/Linux) reacts to the collector's
  `collectInventory`/`collectMetrics` flags, samples metrics when
  `config.metricsSampleSeconds` has elapsed, and runs any `jobs` returned by the
  same response. Windows gathers hardware/OS/software (uninstall registry)/
  services/`Get-HotFix` patches/disks/interfaces/local users+groups plus a
  Defender/firewall/BitLocker/Secure-Boot posture and per-adapter byte counters
  (for net bps); POSIX reads `/proc` (cpu via a two-sample `/proc/stat`,
  meminfo, net/dev, uptime, loadavg), `df`, `dpkg-query`/`rpm`/`brew`,
  `systemctl`/`launchctl`, `apt`/`dnf`/`yum`/`softwareupdate`, `/etc/passwd` +
  `/etc/group` and AV/firewall/LUKS/Secure-Boot probes. Jobs are transported
  **binary-safely via base64** (`scriptB64`/`argsB64` on the claim;
  `stdoutB64`/`stderrB64` on the result — see `J.toB64`/`J.fromB64`), written to
  a temp file, run under a timeout (`Start-Process` + `WaitForExit(ms)`/`Kill`
  on Windows; `timeout` with a background-kill fallback on POSIX), and the
  output posted back. Agent→collector endpoints: `/inventory`, `/metrics`,
  `/job-result` (implemented by the Phase-3 collector, Task 14).
- **Devices station** — now six tabs: **Fleet, Structure, Deploy, Inventory,
  Metrics, Jobs** (`src/rmm.devices.js` lazily renders each). The device detail
  modal appends the Inventory, Performance and Jobs sections after the agent
  section. `H.heartbeat` returns any claimed `jobs` plus `collectInventory`/
  `collectMetrics` flags (from `custom.inventoryRequestedAt`/`metricsRequestedAt`)
  and `config.metricsSampleSeconds`.
- **Config** (`config.rmm`): `inventoryDeltaLimit`, `inventorySoftwareCap`,
  `metricsSampleSeconds`, `metricsRawPoints`, `metricsHourlyPoints`,
  `metricsDailyPoints`, `metricsMaxSamplesPerPost`, `jobTimeoutSeconds`,
  `jobOutputBytes`, `jobRetentionHours`, `jobDeliveryTimeoutMinutes`,
  `jobExpiryMinutes`, `jobMaxAttempts`, `jobScriptMaxBytes`. Tasks 12–13 added
  the resilience/diagnostics keys: `backoffBaseSeconds`, `backoffMaxSeconds`,
  `backoffFactor`, `backoffJitter`, `retryMaxAttempts`, `spoolMaxBytes`,
  `spoolMaxItems`, `spoolFlushPerCycle`, `agentMaxCpuPercent`, `agentCpuNice`,
  `agentIoNice`, `agentMaxMemMB`, `agentMaxConcurrentJobs`, `agentLogMaxBytes`,
  `agentLogKeep`, `tlsMode`, `tlsPinSha256`, `tlsAllowInsecure`,
  `selfUpdateEnabled`, `selfUpdateChannel`, `selfUpdateKeepVersions`,
  `selfUpdateRollbackOnFailure`, `updateDeliveryRetryMinutes`,
  `updateHistoryLimit`, `diagnosticRequestLines`, `diagnosticLogMaxBytes`,
  `diagnosticLogKeep` and `diagnosticSelfTestKeep`. The hidden
  `inventory`/`metrics`/`jobs`/`updates`/`diagnostics` documents were added to
  `erp.modules.js`.
  Note: the service global for inventory is **`ERP.rmmInventory`** (the ERP
  template's stock module already owns `ERP.inventory`).
- **Tests**: `await window.RMMInventoryTest()` (46 checks), `await
  window.RMMMetricsTest()` (32 checks), `await window.RMMJobsTest()` (53 checks)
  — all stub-backend, covering normalisation/hash/delta/apply round-trip, the
  bounded delta log + software cap, authenticated full/delta/no-op submits and
  asset reconciliation, the software/patch/security roll-ups and collection
  requests; sample normalisation/clamping/tiering + ring bounds, batch caps, the
  device summary, range/fleetSeries/pressure/stats and sampling requests; and
  the language catalogue/compatibility/command lines, enqueue validation,
  one-shot authenticated claim + unsupported refusal, result posting
  (success/failure/timeout/idempotency/output bounding), multi-device aggregate
  states, cancel/retry, reap (requeue/timeout/expiry/pruning) and the device +
  console UI.
- **`window.ERP.resilience`** (`RS`, `src/rmm.resilience.js`, Task 12) — **agent
  resilience, self-update & safety**. Owns the delivery/retry policy surfaced
  from `config.rmm` (`backoffBaseSeconds`, `backoffFactor`, `backoffMaxSeconds`,
  `backoffJitter`, `retryMaxAttempts`, `updateDeliveryRetryMinutes`) and the
  release registry: `publish({providerId, platform, version, channel, source,
  sha256, notes, mandatory})` stores an immutable build (inline source is
  checksummed), with `releases`/`latestRelease`/`releaseFor`/`removeRelease`.
  `push(targets, release)` queues an update request on every device
  (`custom.updateRequest`) surfaced through the heartbeat contract;
  `recordResult(...)` is the authenticated `/update-result` path and keeps a
  bounded per-device `updateHistory` (fromVersion→version, ok, rolledBack,
  error) — a failed build is marked **rolled-back**. `pendingCount`,
  `rolloutStatus` (devices / version spread / pending / buffered) and
  `reapUpdates` round out the console. Console: **Devices → Updates** tab
  (KPIs, publish form, release list with a roll-out action) plus a resilience
  section in the device modal. `versionCompare` is numeric-aware.
- **The agent's own resilience** (in `src/rmm.agent.js`): a rotating log, an
  offline **spool** (`spool_post` queues any failed inventory/metric/job-result
  post and `flush_spool` replays it on reconnect), exponential backoff with
  jitter (`fail_streak`/`next_attempt`), TLS verification of the collector
  (`tlsMode`/`tlsPinSha256`/`tlsAllowInsecure` → `--pinnedpubkey` vs `-k`
  choice), `do_self_update` (download → checksum verify → stage → self-test →
  **rollback to the prior version on failure**), resource caps (`ulimit -v` +
  `nice` on POSIX; `MemoryMax`/`CPUWeight`/`TasksMax` + a `WorkingSet64` watch
  on Windows), `send_logs`/`run_self_test` handlers, and a clean
  uninstall/self-remove that reports back to the collector.
- **`window.ERP.diagnostics`** (`DIAG`, `src/rmm.diagnostics.js`, Task 13) —
  **agent diagnostics & support**. The console side of on-demand support:
  `requestLogs({providerId, deviceIds, lines})` and `requestSelfTest(...)` queue
  requests that ride the heartbeat (`H.deliver` sets `collectLogs`/`selfTest`),
  and `submitLogs(...)`/`submitSelfTest(...)` are the authenticated agent
  postings (UTF-8 + base64 log body, byte-capped and **truncated+marked**, a
  bounded per-device ring via `logKeep`, last-log/last-self-test stamped on the
  device). `listLogs`/`getLog`/`listSelfTests`/`latestSelfTest`/`stats`, plus
  `SELF_TEST_CHECKS` (reach the collector / enrolled / heartbeating / config /
  spool / disk) and the `TROUBLESHOOTING` playbook. Console: **Devices →
  Diagnostics** tab, a diagnostics section in the device modal, and the
  rendered playbook. Hidden **`rmm-v1-diagnostics`** document.
- **`window.ERP.collector`** (`COL`, `src/rmm.collector.js`, Task 14) — the
  **collector service**. The shared, dependency-free, *synchronous* core
  (`createCollectorCore`, delimited by `RMM-COLLECTOR-CORE-START/END`) is
  embedded verbatim in the `text/x-server-plugin` hub in `index.html`; a drift
  guard in `RMMCollectorTest` parses the server block and asserts it is
  identical to the module's core. It authenticates each device's check-in
  against its stored **credential hash** (SHA-256, never the plaintext), accepts
  inventory/metric/job-result/log/self-test/update-result payloads into durable
  state, tracks last-seen, and returns queued jobs + configuration in the same
  response. Client side: `auth`, `deviceOp(op, body)`, `admin(op, body)` (gated
  by the admin password hashed at the hub), `status`/`transport`,
  `createCore`/`localCore` (the unsaved-editor emulator), and console helpers
  (`pushJob`/`pushJobs`, `requestLogs`, `fleet`, …). The admin password is
  generated and stored **only as a SHA-256 hash** in the public hub source
  (`COLLECTOR_ADMIN_SHA256`).
- **Tests**: `await window.RMMResilienceTest()` (42 checks), `await
  window.RMMDiagnosticsTest()` (30 checks), `await window.RMMCollectorTest()`
  (42 checks) — the backoff/jitter/retry policy, version compare, TLS policy,
  release publish/supersede/push, the heartbeat update contract, successful
  update + automatic rollback + history, rollout status, and the Updates UI;
  the log policy, request/deliver/stamp cycle, authenticated log + self-test
  submissions, bounding/truncation, ring + stats, and the Diagnostics UI; and
  the collector core (check-in auth, enroll, inventory/metrics/job-result
  intake, job/config dispatch), the hub RPC list, the core **drift guard**, and
  the assertion that **no plaintext admin password** appears in the public hub
  source.

## Tasks 15–17 (done) — dispatch, event stream & retention

Phase 3 completes: a dispatched job's whole life is visible, the console is told
about changes instead of polling for them, and every durable region is bounded.
The collector core (Task 14) gained the primitives these three need, mirrored
verbatim into the hub.

- **`window.ERP.dispatch`** (`DSP`, `src/rmm.dispatch.js`, Task 15) — **job
  queue & dispatch**. Bridges the console job record (Task 11) and the collector
  queue (Task 14). `resolveTargets(providerId, spec)` turns one selection
  (`deviceId`/`deviceIds`/`groupIds`/`siteIds`/`tags`/`all`/`online`) into device
  ids, reporting unknown ones in `skipped`. `enqueue(opts)` creates one ERP job
  and, per target, one collector job carrying `ref` = the ERP job id plus the
  caller's `correlation`, recording a **dispatch ledger** row in the hidden
  `rmm-v1-dispatch` document. `sync(providerId)` pulls the collector's per-job
  state back (`queued → delivered → running → succeeded/failed/timed-out/
  expired/cancelled`), mirrors `exitCode`/`stdout`/`stderr`/timestamps/
  `durationMs` into the ERP job's per-device results, derives the aggregate and
  fires `onTerminal(job, dispatch)` when a dispatch finishes. `retry`/`cancel`
  act on both sides; `reap` runs the collector's requeue/timeout/expiry/prune
  plus the ERP reaper. The hub's admin gate is surfaced as `DSP.locked` — a
  rejected admin call marks targets `blocked`, the UI offers an **Unlock**
  modal, and `redispatch` retries blocked/unreachable targets. `correlations`,
  `status`, `renderJobs` (the Task-11 Jobs console plus a correlation ledger and
  KPIs) and `deviceSection` round it out.
- **`window.ERP.events`** (`EV`, `src/rmm.events.js`, Task 16) — **event stream
  & degraded mode**. Subscribes to the hub's `rmm` pub/sub topic and normalises
  `device-state`/`job`/`alert`/`device-op`/`admin` events onto one bus
  (`on`/`off`/`emit`/`recent`/`stats`). When the realtime socket is unavailable
  it **degrades to polling**: `pollOnce(providerId)` diffs the collector's
  fleet/job views and synthesises the same events (device-state transitions
  plus `agent-offline`/`agent-stale` alerts, and job transitions), while
  `setSnapshotFn` is the test seam. Three modes — **live / polling / offline** —
  are shown in the topbar indicator (`#rmmStream`), which opens a recent-events
  modal on click. Job events trigger `DSP.sync`. Reconnects use a **jittered
  exponential backoff** (`EV.reconnectDelayMs(attempt, u)`: exponential to a
  20s cap, then a random 50–100% of that interval) so a fleet of consoles that
  lose the hub together do not stampede it on recovery.
- **`window.ERP.retention`** (`RET`, `src/rmm.retention.js`, Task 17) —
  **retention, batching & scale**. `policy()` states the whole policy from
  `config.rmm` + the metrics/diagnostics limits + the collector core's own
  limits. `pack`/`unpack`/`wireBody`/`codecStats` are the shared **pack/unpack
  codec** (dictionary substitution over repeated quoted JSON string literals —
  the collector runtime has no zlib): `wireBody` compresses any body over
  `COL.PACK_THRESHOLD` and the hub inflates it on the way in. `batch`/`sendBatch`
  coalesce device ops into one authenticated round-trip (capped by the core).
  `rollup(samples)` folds raw samples into **hourly/daily** aggregates using the
  metrics service's own aggregator, so ERP and collector agree. `apply()` is the
  one-button enforcement: `COL.applyRetention` bounds the collector's metric
  rings, logs, self-tests and job/update history, then the ERP metric and
  diagnostic documents are pruned, jobs reaped and dispatches re-synced.
  `capacity()` reports every document against the ceiling plus the collector's
  fleet (hub counts when the socket is live, in-page core otherwise), and
  `renderRetention` is the **Devices → Retention** tab (KPIs, Apply/Prune/
  Measure-codec, capacity + policy tables).
- **Collector core additions** (Task 14's `createCollectorCore`, mirrored in
  `index.html`): `job-start` + `batch` device ops; `revokeToken`/`retryJob`/
  `cancelJob`/`reapJobs`/`applyRetention`/`job` admin ops; the `packText`/
  `unpackText` codec; per-device rate limiting (`deviceOpsPerMinute`); hourly/
  daily metric roll-ups; presence `tick` transitions; and `enroll` now **adopts
  the ERP device id** when a token is bound to one, so console and collector ids
  agree. The hub publishes device-state/job/admin events on the `rmm` topic.
- **Config** (`config.rmm`): `jobHistoryKeep`, `eventHistory`,
  `eventPollSeconds`, `alertRetentionDays`.
- **Tests**: `await window.RMMDispatchTest()` (42 checks), `await
  window.RMMEventsTest()` (22 checks), `await window.RMMRetentionTest()` (33
  checks) — all stub-backend with a **mock collector hub** that runs a real core
  behind the transport API (gated on a per-test password, never the real one).
  They cover target resolution + unknown-id reporting; the locked gate, unlock
  and re-dispatch; the full delivered → running → succeeded lifecycle with
  `onTerminal` correlation; retry (both sides), cancel, and reap (requeue +
  expiry); status/KPI + the console/device-modal UI; the live socket transport
  and indicator; kind/wildcard listeners, unsubscribe, malformed-message
  tolerance, `recent`/`stats`/`HISTORY`; the polling fallback synthesising
  device-state, alert and job events; the policy derivation; the codec's exact
  round-trip (unicode + escapes) and non-beneficial passthrough; `wireBody` +
  `codecStats`; batch capping; hourly/daily roll-ups; the collector
  `applyRetention` bounds; ERP metric + diagnostic pruning; capacity/stats; and
  the Retention console.

## Tasks 18–20 (done) — groups, policies & monitors

Phase 4 opens: the targeting + configuration layer that every later monitoring
and automation feature keys off. **Groups** decide *who* a rule applies to,
**policies** decide *what settings* they receive (with an explicit precedence),
and **monitors** decide *what gets watched* and when it fires. All three live in
the provider aggregate and read the master-config taxonomies (severities, tags,
monitor types).

- **`window.ERP.groups`** (`G`, `src/rmm.groups.js`, Task 18) — **device groups &
  tags**. Two group kinds: `static` (explicit `deviceIds` membership) and
  `dynamic` (a rule of `conditions` over device/inventory attributes, combined
  with `match` = `all`/`any`). A condition targets one of 20 `FIELDS`
  (`G.FIELDS` — OS family/name/version/arch, role, live status, hostname,
  domain/domain-role, form factor, manufacturer, model, RAM, CPU cores, disk
  used %, site, tag, installed **software**, **service** state, agent version),
  each typed (`text`/`select`/`number`/`bool`/`site`/`tag`/`software`/`service`)
  which selects both the operator set (`G.operatorsFor`, e.g. text
  contains/starts-with/is-one-of, numeric gt/lte, `has_tag`, `installed`,
  `is running`) and the editor control. `G.evaluateCondition(cond, dev, ctx)` /
  `G.evaluateRule(group, dev, ctx)` evaluate a rule (a condition-less dynamic
  group matches nothing), `G.devicesInGroup(provider, group, ctx)` lists a
  group's members (loading the software / service index via `G.loadIndex`),
  `G.groupsForDevice`/`membershipIds`/`staticGroupsOf`/`dynamicGroupsOf` report a
  device's groups and `G.reconcile` reports drift, and **tags** are a
  first-class targeting surface (`G.tags`,
  `G.tagDevices`, `G.applyTag`/`G.removeTag`, bulk tag apply). **`G.matchTargets(provider,
  targets, dev, ctx)`** is the shared targeting resolver the policy engine,
  monitor engine and job dispatcher all use: it accepts a target spec
  (`deviceIds`/`groupIds`/`siteIds`/`tags`/`all`) and returns `{match,
  matchedBy, specificity}` with specificity **device(4) > tag(3) > group(2) >
  site(1) > provider-wide(0)** — the ordering the policy engine layers on.
  Console: the **Groups** station with **Groups** and **Tags** tabs (summary
  KPIs, group table with kind/site/member count, tag usage table), a group
  editor with the condition builder, a **live "matches N devices" rule
  preview**, a members modal, and a bulk tag-apply dialog.
  `config.rmm.groupConditionCap` (24) bounds the conditions per group.
- **`window.ERP.policies`** (`P`, `src/rmm.policies.js`, Task 19) — **the policy
  engine**. A policy is a named, enabled, prioritised (`priority`, default 100)
  collection of sparse settings across four `SCHEMA` categories —
  **monitoring** (collect inventory/metrics + intervals, critical-service
  monitoring, agent-offline-after), **patch** (auto-approve, approved
  classifications, reboot policy/grace, missing-patch grace, patch window),
  **software** (user install, auto-update, deployment window, package repo) and
  **automation** (remote access, script policy, maintenance windows, notify,
  severity floor) — applied to one or more targets via `G.matchTargets`. Only
  set fields are stored, so a policy overrides just what it declares.
  **Precedence** (`P.orderForDevice`) is: **priority DESC → specificity DESC
  (device > tag > group > site > provider-wide) → updatedAt DESC → id ASC**, and
  `P.effectiveOf`/`P.effective(provider, device, ctx)` fold that ordered chain
  into an effective settings map with **per-setting provenance** (value, and
  which policy / priority / specificity / match reason supplied it, or
  `schema default`). `P.applies`, `P.get/list/listOf`,
  `P.add/update/remove/setEnabled/duplicate`, `P.forGroup`/`P.forTag`,
  `P.stats`/`statsOf` and `P.severityLabel` round it out. Console: the
  **Policies** station with a **Policies** tab (list + KPIs + affected-device
  counts) and an **Effective policy** tab (pick a device → the resolved settings
  grouped by category, each row showing its source policy), plus a policy
  editor and an affected-devices preview modal. `config.rmm.policyEnabled`
  gates the seed.
- **`window.ERP.monitors`** (`M`, `src/rmm.monitors.js`, Task 20) — **the
  monitor catalogue & engine**. `M.TYPES` defines **16 monitor types** across
  the master-config categories: **up/down**, **CPU**, **memory**, **disk**,
  **service** state, **process** state, **Windows event log**
  (log/source/EventID/level), **application** check (process/service/port),
  **TCP/UDP port**, **web/HTTP** check (status/body/response time), **custom
  script** (exit code and/or a printed value), **SNMP/network device** (OID +
  operator), **agent offline/stale**, **patch compliance**, **antivirus/EDR**
  and **backup verification**. Each type declares its `settings[]` (with types,
  defaults, required flags and placeholders), its `thresholds[]` (key, label,
  unit, default, `direction`, per-threshold `severity`) and its defaults
  (severity, `forMinutes`, `intervalSeconds`); `M.type`/`typeLabel`/`types`/
  `typeDefaults` and the pure `M.normalizeMonitor`/`validate` fill and check a
  monitor. A monitor
  is a target spec + type + settings + thresholds + severity that can be
  **overridden per group and per device** (`overrides[]`, normalized by
  `M.normalizeOverride`) — `M.effective`/`M.effectiveThresholds` resolve
  **monitor ← group override ← device override**. `M.evaluate(type, reading,
  opts)` is the **pure** threshold evaluation → `{state, value, message}`
  (`ok`/`warning`/`critical`/`unknown`), and **`M.assess(monitor, reading, prev,
  opts)`** applies the **"for N minutes" duration**: a breach must persist
  `forMinutes` before it fires, it clears only after recovery, and an escalation
  (warning→critical) **restarts the timer**. `M.latestReading` gathers the
  current value from the metrics rings, the inventory snapshot or the device
  record (service/process, patch, AV, backup posture), and `M.forDevice`,
  `M.simulate`, CRUD and `M.stats` complete the service. Console: the
  **Monitors** station with a **Monitors** tab (list + state/severity KPIs) and
  a **Catalogue** tab documenting all 16 types, plus a schema-driven monitor
  editor (settings + thresholds generated from the type), a per-device/group
  override editor and a **simulate** modal that evaluates a sample reading and
  shows the resolved state. `config.rmm.monitorEnabled`, `monitorForMinutes` (5)
  and `monitorIntervalSeconds` (60) supply the defaults.
- **Wiring** — `erp.modules.js` now points the `groups`, `policies` and
  `monitors` stations at their controllers (previously shared phase
  empty-states); `src/rmm.dispatch.js`'s `DSP.resolveTargets` resolves **dynamic
  groups** (not just static membership) through `G.matchTargets`, so a job,
  policy or monitor targeting a rule-based group hits exactly the devices the
  rule matches. New `config.rmm` keys: `seedDemoGroups`, `groupConditionCap`,
  `policyEnabled`, `monitorEnabled`, `monitorForMinutes`,
  `monitorIntervalSeconds`. `erp.css` gained the
  `.rmm-groups`/`.rmm-policies`/`.rmm-monitors` blocks.
- **Tests**: `await window.RMMGroupsTest()` (47 checks), `await
  window.RMMPoliciesTest()` (26 checks) and `await window.RMMMonitorsTest()`
  (45 checks) — all stub-backend. They cover condition normalization + operator
  sets, static vs dynamic membership, the condition evaluator across every field
  type, `matchTargets` specificity/`matchedBy`, the tag registry + bulk apply,
  group/tag CRUD, reconcile and the Groups console; policy normalization +
  validation, targeting, the precedence order (priority → specificity →
  recency), per-setting provenance / schema defaults, the enabled gate,
  duplicate/CRUD/stats and the effective-preview UI; and the type catalogue
  (16 types, settings/thresholds/defaults), monitor validation (required
  settings), group/device overrides, the pure `evaluate` across every type,
  the `assess` duration state machine (pending → firing → clearing, escalation
  restart), `latestReading`, simulate, CRUD/stats and the Monitors console.

## Tasks 21–23 (done) — schedules, automations & the script library

Phase 4 completes: the time/response layer. **Schedules** decide *when* things
are allowed to happen (and what to suppress), the **automation engine** decides
*what to do* when events occur, and the **script & component library** is the
reusable, typed, safe-to-run payload store both of them draw on. They share the
master-config taxonomies (`schedules`, `calendars`, `maintenanceWindows`,
`severities`, `channels`) and the group-engine targeting/condition resolver.

- **`window.ERP.schedules`** (`SCH`, `src/rmm.schedules.js`, Task 21) —
  **schedules, business hours & maintenance windows**. Schedule kinds
  `SCH.KINDS` = interval / daily / weekly / monthly / cron, normalized/validated
  against the master-config `schedules` section. Timezone-aware primitives:
  `SCH.zoned` (zoned date/time/weekday/minutes), `SCH.isWeekend`,
  `SCH.cronMatch(expr, parts)` (a compact cron matcher — `*`, lists, ranges,
  names for weekday/month, `*/n` steps, and the day-of-month **OR**
  day-of-week rule) and `SCH.nextRun(sched, from, tz)` which resolves the next
  instant for any kind; `SCH.isDue`/`SCH.scheduleActive`/`SCH.scheduleMatches`
  and `SCH.scheduleDetail`/`scheduleLabel` sit on top. Business hours are
  **per-client**: `SCH.resolveCalendar`/`SCH.defaultCalendarId` pick a calendar
  (falling back through default → first enabled → a synthetic 24×7 view carrying
  the provider timezone), and `SCH.calendarStatus`/`SCH.inBusinessHours` report
  in-hours / after-hours / weekend for a given instant. **Maintenance windows**
  support `global`/`site`/`provider`/`group`/`device` scope
  (`SCH.windowCovers`, `SCH.scopeFor`/`scopesFor`) for a given device scope;
  `SCH.windowsCovering` returns the active ones and `deferWindows`/`alertWindows`
  split them by intent. **Severity suppression**: `SCH.severityInfo`,
  `SCH.suppressBelowRank` (from `maintenanceSuppressSeverity`) and
  `SCH.isSuppressed` — a window suppresses alerts below the floor, unless it
  `allowCritical` and the alert is critical, and a window with
  `allowCritical: false` suppresses everything including criticals. Non-essential
  jobs are **deferred, not dropped**: `SCH.gateJob` splits a device list into
  `allowed`/`deferred`, `SCH.defer` queues a deferral, and
  `SCH.releaseDeferred` re-enqueues it through the dispatcher once the window
  ends. Every suppression is recorded for audit (`SCH.recordSuppression` /
  `SCH.suppressions` / `SCH.clearSuppressions`, bounded by
  `config.rmm.suppressionsCap`, stored in the hidden `suppressions` doc).
  `SCH.stats`/`deferralStats` summarise it. Console: the **Schedules** station
  (`SCH.render`/`renderInto`) with **Schedules**, **Business hours**,
  **Maintenance windows** and **Suppression log** tabs.
- **`window.ERP.automations`** (`AUTO`, `src/rmm.automations.js`, Task 22) —
  **the trigger → condition → action engine**. `AUTO.TRIGGERS` /
  `AUTO.TRIGGER_IDS` = `alert.fired`, `alert.cleared`, `monitor.state`,
  `device.online`, `device.offline`, `schedule`, `manual`, `webhook`;
  `AUTO.ACTIONS` / `ACTION_IDS` = `run-script`, `run-library-script`,
  `restart-service`, `reboot`, `deploy-patch`, `deploy-software`,
  `send-notification`, `tag-device`, `add-to-group`/`remove-from-group`,
  `webhook`, `create-ticket` — each declaring its `params[]`, `destructive`
  flag and (for not-yet-built actions) a `phase`. `AUTO.normalizeRule` /
  `validateRule` shape a rule (trigger + optional `filter`, reusable
  group-engine `conditions`, a `target` spec, ordered `actions`, `cooldownMinutes`,
  `requireApproval`, `allowDuringMaintenance`); `AUTO.matches` matches an event
  against the trigger + filter + conditions, and `AUTO.resolveTargets` resolves
  the target set (event-scoped when the event names a device, otherwise the
  rule's target spec / whole fleet). **`AUTO.plan`** resolves the targets and
  produces a per-action **dry-run** plan (`status` `planned`/`deferred` etc.,
  carrying each action's `params`), and `AUTO.dryRun` is the read-only preview.
  `AUTO.run` executes: cooldown guarding, **approval gating** for destructive
  actions (`requireApproval` → `pending-approval`, then `AUTO.approve` /
  `AUTO.reject`), **maintenance deferral** (non-essential actions deferred via
  `SCH` with a recorded suppression; `allowDuringMaintenance` / per-action
  `essential` opt out), and per-action execution through `executeAction` — job
  dispatch via `ERP.dispatch.enqueue` (with `{source:"automation", correlation:
  {ruleId, runId}}` provenance), library-script runs via `ERP.scripts.runOn`,
  notifications via `ERP.notify`, tagging/grouping via the group engine, and
  webhooks via the swappable `AUTO.sender`. Runs are persisted per rule
  (`automationRules[].runs`, bounded by `config.rmm.automationRunHistory`) with
  a full summary; `AUTO.runs`/`pending`/`stats`, `AUTO.ingest` (the event
  router) and `AUTO.scheduleDue` (schedule-trigger sweeps) round it out. Console:
  the **Automations** station with **Rules**, **Run history**, **Schedules &
  windows** and **Script library** tabs (the latter two delegating to
  `SCH.renderInto` / `LIB.renderInto`).
- **`window.ERP.scripts`** (`LIB`, `src/rmm.scripts.js`, Task 23) — **the script
  & component library**. An entry is a `script` or a `component`
  (includable with `{{component:id}}`), with a name/description/category and one
  or more **per-OS variants** (`LIB.OS`: windows/linux/macos/any), each with its
  own language, body, args and timeout. **Typed parameters**
  (`LIB.PARAM_TYPES`: string/number/bool/enum) carry required flags, defaults,
  enum options, min/max, maxLength and a **regex pattern**;
  `LIB.normalizeParameter`/`normalizeScript`/`validateScript` shape and check an
  entry. **The safety core**: `LIB.validateParameters` validates (and coerces)
  every value *before* execution, and substitution is done **only** through
  `LIB.safeLiteral(value, shell)` — a per-shell quoting routine
  (powershell/cmd/bash/python/generic) so a parameter can never break out of its
  literal and inject commands; `LIB.prepareRun` refuses unknown tokens /
  invalid parameters and returns the escaped script + generated command line
  (via `J.commandLine`), and `LIB.runOn` groups the target devices **by OS
  family** and enqueues one job per family with the matching variant. Components
  are expanded recursively by `LIB.expandComponents` with **cycle detection**,
  depth and total-size caps. Entries are **versioned**
  (`LIB.bumpVersion`/`restore`/`diffVersions`, history bounded by
  `config.rmm.scriptVersionHistory`), and **import/export**
  (`LIB.exportScript`/`importScript`/`exportBundle`/`importBundle`, tagged with
  `LIB.SCHEMA`/`BUNDLE_SCHEMA`) moves them between tenants (with name
  de-duplication). CRUD/`duplicate`/`setEnabled`/`stats` and the console
  (`LIB.render`/`renderInto`) complete it. `config.rmm.scriptLibraryEnabled`
  gates the seed.
- **`window.ERP.notify`** (`NOT`, `src/rmm.notify.js`) — the small notification
  service the automation `send-notification` action uses:
  `NOT.send`/`queue`/`list`/`stats`/`ack`/`clear`, applying channel
  `minSeverity`, business-hours and cooldown filters and recording to the hidden
  `notifications` doc (bounded by `config.rmm.notificationHistory`), with
  best-effort webhook/Slack/Teams delivery via the swappable `NOT.sender`.
- **Wiring** — `erp.modules.js` points the `automations` station at
  `window.ERP.automations` and declares the hidden `suppressions` and
  `notifications` system docs (needed by `store.docName`); `rmm.master.js`'s
  `maintenanceWindows` section gained a `deferJobs` field. New `config.rmm` keys:
  `maintenanceDefersJobs`, `suppressionsCap`, `scheduleDueWindowMinutes`,
  `notificationHistory`, `automationEnabled`, `automationRunHistory`,
  `automationConditionCap`, `scriptLibraryEnabled`, `scriptVersionHistory`,
  `scriptMaxComponentDepth`, `scriptComponentMaxBytes`. `index.html` loads
  `src/rmm.notify.js`, `src/rmm.schedules.js`, `src/rmm.scripts.js`,
  `src/rmm.automations.js`; `erp.css` gained the `.rmm-schedules` /
  `.rmm-automations` / `.rmm-library` blocks.
- **Tests**: `await window.RMMSchedulesTest()` (35 checks), `await
  window.RMMScriptsTest()` (42 checks) and `await window.RMMAutomationsTest()`
  (37 checks) — all stub-backend. They cover the cron matcher (wildcards, lists,
  ranges, steps, day-of-month OR day-of-week), `nextRun`/`isDue` per kind,
  business-hours resolution + fallbacks + the 24×7 calendar, window
  scope/activity, severity suppression (below-floor, allow-critical,
  no-critical), the suppression log + stats, the job deferral gate + queue +
  release, and the Schedules console; script normalization/validation, typed
  parameter validation (required/bounds/enum/pattern/unknown), **shell-escaping
  of malicious values**, per-OS variant resolution, component expansion + cycle
  detection, `prepareRun`, per-OS `runOn` job grouping, versioning/restore/diff,
  import/export + bundle round-trips, CRUD/stats and the library console; and the
  trigger/action catalogues, rule validation, trigger/condition matching, target
  resolution, dry-run planning, execution + dispatch provenance, approval
  gating (approve/reject), cooldown, maintenance deferral + the recorded
  suppression, `ingest` routing, schedule-trigger sweeps, CRUD/stats and the
  Automations console.

## Tasks 24–26 (done) — alerting & response

Phase 5 opens: a monitor breach becomes a durable **alert**, the alert is
**routed** to the right people (and chased until acknowledged), and a critical
alert becomes a **psa-u ticket** — linked to the device and its configuration
record — that is updated and auto-resolved as the alert changes. All three
services live in the provider aggregate / hidden documents and read the
master-config severities, channels and schedules.

- **`window.ERP.alerts`** (`AL`, `src/rmm.alerts.js`, Task 24) — **the alert
  lifecycle**. An alert is the durable record of a monitor breach, carried
  through `firing → acknowledged → resolved` (a human path) or
  `firing → resolved` (auto-cleared on recovery). The record snapshots monitor
  (+ policy), device/hostname/**site/group** context, OS family, severity,
  state, value, message, subject, first-fired/last-seen, occurrences, flaps,
  snooze, suppression, ticket ref and a full **timeline** (`history[]`).
  Identity is `AL.dedupeKey(monitor, deviceId)` = `monitor|device|subject`
  (`AL.subjectOf` derives the subject per type: service name, `volume`,
  `host:port`, url, …). **`AL.fire`** creates / **de-duplicates** (a repeat
  breach updates the one active record: `occurrences++`, worst severity,
  append-only timeline) / **reopens** (a resolve + re-fire inside
  `alertFlapMinutes` reuses the record, counts a flap and flags `flapping` past
  `alertFlapThreshold`) / **escalates severity** (a rise on a live alert is
  flagged and logged). **`AL.severityForState`** maps a critical *state* up to
  `sev-critical` but never below a monitor already at/above critical.
  `AL.acknowledge`/`AL.resolve`/`AL.autoClear` (+`clear`) are idempotent;
  `AL.snooze`/`unsnooze`/`isSnoozed` silence until a moment;
  `AL.deviceContext` snapshots the hierarchy. **`AL.scan`** walks a provider's
  devices, re-evaluates every applicable monitor through `ERP.monitors`
  (`forDevice`/`listOf`), drives the lifecycle and emits
  `monitor.state`/`alert.fired`/`alert.cleared`; **`AL.ingestAssessment`** is
  the single-monitor path. The per-monitor **assessment state** that powers
  "for N minutes" lives in the hidden **`rmm-v1-alertstate`** document. Reads:
  `list/get/active/forDevice/forMonitor/counts/stats/history`; retention via
  `prune` (`alertRetentionDays`); `onChange`/`AL.emit` also publish to
  `ERP.events`. Console: the **Alerts** station (`AL.render`/`renderInto`) —
  summary KPIs, a state/severity/device/search filter bar, the alert table
  (severity+state, device, alert, context, age, flags, actions) and a detail
  modal with the timeline, context KV, notifications and escalations, plus
  Ack/Resolve/Snooze/Scan now actions.
- **`window.ERP.routing`** (`RT`, `src/rmm.routing.js`, Task 25) — **notification
  routing & escalation**. Five record kinds (`RT.KINDS`) in the hidden
  **`rmm-v1-routing`** document: **recipient** (email/phone/channels/timezone/
  quiet-hours/digest mode), **route** (severity-at-least/at-most + site/group/
  tag/device/monitor targeting + channel/recipient lists + priority),
  **escalation** (ordered `steps[]` by `afterMinutes`, optional on-call, repeat
  interval / max repeats), **oncall** (a rotation of members with
  `rotationMinutes`) and **digest** (queued items). `RT.resolveRoute` picks the
  highest-priority, most-specific enabled route for an alert (falling back to
  the master-config default channel); `RT.routeAlert` skips suppressed,
  snoozed, flapping and severity-silent alerts, sends per recipient/channel via
  `ERP.notify` (`NOT.send`, provenance `meta.alertId/recipientId`), records each
  delivery on the alert's `notifications[]`, and **de-duplicates** identical
  alert+channel+recipient sends within `notifyDedupeMinutes` (`RT.shouldSend`).
  `RT.queueDigest`/`pendingDigests`/`flushDigests` coalesce a recipient's
  non-immediate alerts into one message. `RT.escalate(providerId, at)` is the
  sweep: unacknowledged **firing** alerts past a step's `afterMinutes` are paged
  (on-call resolved by `RT.onCall`), each escalation appended to the alert's
  `escalations[]` with `escalationLevel`, and repeats handled per policy or by
  the severity's own `escalateAfterMinutes` fallback. `inQuietHours`, CRUD,
  `stats`, `seedDemo` and the console (`RT.renderPanel`/`renderInto`) complete
  it. Console: an **Alerts → Routing** panel (routes, recipients, escalation
  policies, on-call rota, digests).
- **`window.ERP.psa`** (`PSA`, `src/rmm.psa.js`, Task 26) — **PSA ticket
  integration**. Turns an alert into a psa-u ticket and back: `createTicket`
  builds a ticket from an alert (subject/description include device, site,
  monitor, severity and the **configuration-record link** derived from
  `device.documentation`), **de-duplicates** by alert `dedupeKey` (a recurring
  alert **updates** the open ticket instead of opening a second),
  mints a reference (`psaTicketPrefix`), reflects `ticketId/ticketRef/
  ticketStatus` back onto the alert, and (remote mode) POSTs to `psaUrl` via the
  swappable `PSA.sender`. `updateTicket`/`resolveTicket`/`syncStatus`/`ingest`
  (inbound webhook by external id) move status (`new/open/in-progress/pending/
  resolved/closed`) and mirror it to the alert; `onAlert` is the alert
  lifecycle hook — a **critical** alert auto-opens a ticket (`psaAutoTicket`),
  an auto-cleared alert auto-resolves it. `createTicketFromEvent` is the
  automation entry point; `tickets/ticket/forAlert/stats` read. Records live in
  the hidden **`rmm-v1-psa`** document; the **API token is held in memory only**
  (`setToken`), never persisted. Console: an **Alerts → Tickets** panel
  (`PSA.renderPanel`/`renderInto`).
- **Wiring** — `erp.modules.js` wires the `alerts` station to `AL.render` and
  declares the hidden `alertstate`/`routing`/`psa` system docs; the automation
  engine's **`create-ticket`** action now dispatches to
  `PSA.createTicketFromEvent` (its placeholder phase gate removed).
  `index.html` loads `src/rmm.alerts.js`, `src/rmm.routing.js`,
  `src/rmm.psa.js`; `erp.css` gained the `.rmm-alerts` / `.rmm-routing` /
  `.rmm-psa` blocks. The alert `postHooks` fan out to
  `RT.routeAlert` / `PSA.onAlert` / `AUTO.ingest` so one breach reaches routing,
  the PSA bridge and the automation engine. New `config.rmm` keys:
  `alertEnabled`, `alertFlapMinutes`, `alertFlapThreshold`, `alertHistory`,
  `notifyEnabled`, `routingEnabled`, `notifyDedupeMinutes`,
  `notifyDigestMinutes`, `notifyDigestMax`, `escalationEnabled`, `psaEnabled`,
  `psaUrl`, `psaQueue`, `psaAutoTicket`, `psaTicketPrefix`.
- **Tests**: `await window.RMMAlertsTest()` (45 checks), `await
  window.RMMRoutingTest()` (35 checks) and `await window.RMMPsaTest()` (24
  checks) — all stub-backend. They cover identity/severity mapping, create +
  de-dup + reopen/flapping + severity escalation, acknowledge/resolve/auto-clear
  idempotency, snooze, maintenance suppression (+ critical passthrough),
  assessment state, scan-driven fire/auto-clear, reads/history, retention and
  the console; route/recipient/escalation/oncall/digest CRUD + normalisation,
  route resolution, delivery + de-duplication + quiet hours + digests, the
  escalation sweep (steps, on-call, repeats, severity fallback), stats and the
  routing panel; and ticket creation + de-dup, status/priority updates, inbound
  webhook, alert reflection, auto-open on critical / auto-resolve on clear, the
  memory-only token, the event/automation entry point, stats and the tickets
  panel.

## Task 27 (done) — alert triage workspace

The Alerts station answered *what is broken*; the **Triage queue** tab answers
*what should I work on next, and am I getting faster at it*. Engine
`window.ERP.triage` (`TR`, `src/rmm.triage.js`); it renders as a new
**Triage queue** tab on the Alerts station (`AL.render` delegates to
`TR.renderPanel`) and is the fifth Phase-5 surface.

- **Explainable priority model** — `TR.priority(alert, at)` scores every active
  alert deterministically from named factors (never a black box): severity rank
  (×1.5), +25 unacknowledged, +1/hour age (capped +20), +10 flapping, +2 per
  extra occurrence (capped +10), +4 open ticket, −6 already assigned, −40
  snoozed, −15 maintenance-suppressed. Bands **P1 ≥ 70 / P2 ≥ 45 / P3 ≥ 25 /
  P4** with tones and labels; each row returns `{score, band, factors[]}` and
  the UI can show exactly *why* it ranks where it does (`tri-why` modal).
- **The prioritized queue** — `TR.queue(providerId, opts)` filters by
  state/severity/site/group/device/monitor/assignee (`__unassigned__` too) and
  free-text search, sorts by priority/severity/newest/oldest/recently-seen, and
  stamps `priorityScore`/`priorityBand`/`priorityFactors` on every row.
  `TR.group(rows, by)` buckets by device/site/monitor/severity/device-group/
  assignee, each group carrying count / worst severity / top score / oldest.
  `TR.countsOf(provider)` feeds the summary KPIs.
- **Bulk actions** — `TR.bulk(providerId, ids, action, opts)` runs
  acknowledge / assign / unassign / resolve / snooze / unsnooze over a
  selection through the alert lifecycle (so timeline, hooks, routing and the
  PSA bridge all still fire), returning per-alert results for honest partial
  success. The panel keeps the selection in a `Set` (checkbox changes don't
  repaint), supports select-all / select-all-visible / select-a-group, and has
  an **Assign…** modal (pick an owner or type a free-text one).
- **Response-time metrics** — `TR.metrics(providerId, opts)` derives everything
  from the alert records' own timestamps over a window
  (`config.rmm.triageWindowDays`, default 30): volume by day, backlog
  (active/unassigned/firing/critical/flapping + oldest), **MTTA** and **MTTR**
  (avg/median/p90 via `TR.durationStats`), the share acknowledged within
  `config.rmm.triageAckTargetMinutes` (default 15), and the worst devices /
  monitors / sites. `TR.formatDuration` and `TR.barChart` render them.
- **Assignment is now first-class on the alert** — `AL.normalizeAssignee`,
  `AL.assign`, `AL.unassign` (+ `alert.assigned`/`alert.unassigned` events and
  audit), recorded as `assignedTo/assignedToName/assignedAt/assignedBy` on the
  record, shown as an `@owner` flag in the alert row and an *Assignee* row in
  the detail modal. `TR.assignees(provider)` builds the owner picker from the
  signed-in teammate, connected peers, names already used and any extras.
- **Richer demo seed** — `AL.seedDemo` now writes its records in **one atomic
  write** (with retry) instead of a burst of per-record writes, so a concurrent
  boot-time seed can't half-apply, and it seeds ~9 already-handled alerts spread
  across the past ten days (acknowledged/resolved/flapping/assigned/snoozed) in
  addition to the live breaches, so the triage metrics have a real distribution
  to summarise. It upgrades an older demo seed in place and never touches
  user-created alerts.
- **UI** — the Triage tab: summary KPIs (queued/unacknowledged/critical/
  unassigned/flapping/snoozed), a group-by/sort/severity/site/monitor/owner
  filter bar + search, the bulk-action bar, grouped alert tables (priority
  badge, alert, state+severity, owner, age, factor count, actions) and the
  Response-metrics section (stat cards, the daily volume bar chart, and the
  by-severity / top-devices / top-monitors cards). Left-aligned, responsive
  (verified at 1440×900 and 390×844).
- **Tests**: `await window.RMMTriageTest()` (48 checks, stub backend) — the
  priority model (determinism, bands, factors, age/snooze/ownership effects),
  the queue (filters, search, sort, counts), grouping, assignment (persisted +
  timeline + filters + bulk), bulk acknowledge/resolve/snooze through the
  lifecycle, metrics (volume/MTTA/MTTR/SLA with exact timestamps), the
  duration/format/chart helpers, the rendered panel and namespace hygiene.

---

## Tasks 28–29 (done) — patch policy, scanning & compliance

The **Patches** station (`window.ERP.patch`, `PA`, `src/rmm.patch.js`; hidden
SYSTEM doc `rmm-v1-patchscan`) is the whole Phase 6 foundation: a *clearly
stated* patch policy, agent-driven scanning, and per-device/group/site/provider
compliance ageing. It renders as its own station (`patches` in
`src/erp.modules.js` → `PA.render`). `index.html` loads `src/rmm.patch.js` and
`src/erp.modules.js` declares the hidden `patchscan` SYSTEM doc; `erp.css` gained
the `.rmm-patch*` block.

- **Deny-by-default policy engine** — `PA.defaultPolicy()` is the provider-wide
  baseline (priority 0, OS `all`, `isDefault`, read-only): unclassified updates
  **deny**; `pc-critical` approve/3d, `pc-security` approve/7d, `pc-definition`
  approve/1d, `pc-updates` approve/14d, `pc-feature` defer 14/30,
  `pc-driver` deny, `pc-servicepack` defer 14/45, `pc-tools` approve/7d,
  `pc-upgrades` defer 30/90; `rebootPolicy:"if-required"`, 30-min grace,
  deadlines enforced. Policies are normalised (`PA.normalizePolicy`), validated
  (`PA.validatePolicy`, incl. deferral-before-deadline), and compile through
  `PA.classify`/`PA.classificationFor` (exact → contains → `__default`, source
  labelled).
- **Targeting & precedence** — a policy applies when its OS family, site, tags,
  device-group or explicit device targets match (`PA.applies` via
  `G.matchTargets`); `PA.orderForDevice` sorts the chain **priority →
  OS-specificity → specificity → recency → id**, baseline last, and
  `PA.effectiveOf(provider, device)` resolves every field *and* each
  classification decision with per-field **provenance** (which policy supplied
  it). The policy tab shows exactly this: a resolved-settings table, the
  precedence chain, and the per-classification decisions with their source.
- **CRUD** — `PA.listPolicies/allPolicies/getPolicy/addPolicy/updatePolicy/
  removePolicy/duplicatePolicy/setEnabled` (all audited), with the baseline held
  read-only, per-group overrides, and a full editor (targets, reboot policy /
  grace, maintenance-window ids, deadline enforcement, missing-patch grace, and
  a per-classification decision grid).
- **Scanning** — `PA.scan(providerId, {deviceIds, probes, at, catalogue})`
  (and `PA.scanDevice`) resolves each device's missing set with precedence
  **probe → agent report (`PA.reportScan` → `device.custom.patchScan`) →
  derived from inventory** (`PA.deriveMissing` over the patch catalogue,
  OS-filtered by `PA.applicableToDevice`), then classifies every patch through
  the effective policy: `decision`, `requiredNow`, `installAfter`,
  `deadlineAt` (detection + policy deadline), `overdue`, `denied`, `ageDays`.
  One compact scan record per device is persisted to `rmm-v1-patchscan`, the
  history is capped (`config.rmm.patchScanHistory`), and the compliance the
  device table shows is mirrored onto `device.custom.patchCompliance`.
- **Compliance & ageing** — `PA.complianceOf` counts missing/required/
  deferred/denied/overdue, flags `compliant` (0 required missing), dates
  `nonCompliantSince` from the **oldest still-required** patch, carries the age
  forward across scans and clears it when the device becomes compliant, and
  marks `withinGrace` against `missingGraceDays`. Reads: `PA.scanOf`, `PA.scans`,
  `PA.complianceFor`, `PA.deviceRows` (sorted non-compliant first, filter by
  status, search by hostname/site/policy), `PA.rollup` (by group/site/OS) and
  `PA.stats` (fleet totals + last scan), plus `PA.scanRuns` for history.
- **Optional alert bridge** — `PA.syncComplianceAlert` raises/updates/clears a
  device-compliance alert through the alert lifecycle, gated off by default
  (`config.rmm.patchAlertEnabled`).
- **Config** (`config.rmm`): `patchEnabled`, `patchPolicyEnabled`,
  `patchScanEnabled`, `patchScanHistory`, `patchScanStateCap`,
  `patchDefaultDeadlineDays`, `patchAlertEnabled`, `patchStaleHours`,
  `patchMissingGraceDays`.
- **UI** — three tabs on the Patches station: **Compliance** (6 stat cards —
  devices/compliant/non-compliant/missing-required/overdue/oldest; status +
  search filters; a full-width rollup card with a *Roll up by* picker
  (device-group/site/OS); and the device table with compliance badges, missing
  counts, non-compliant age and Scan/View actions), **Patch policy** (effective
  preview for a chosen device + the policy list with Edit/Disable/Duplicate/
  Delete and a New-policy editor), and **Scan history & catalogue** (the run
  log and the known-update catalogue). Left-aligned, responsive (verified at
  1440 and 390 wide).
- **Demo seed** — `PA.seedDemo` (idempotent, coalesced) adds a per-group
  "Server ring" override and scans the demo fleet so the console is populated
  on first visit.
- **Tests**: `await window.RMMPatchPolicyTest()` (41 checks) and `await
  window.RMMPatchComplianceTest()` (35 checks), both stub-backend — the
  baseline/default, normalisation & validation, classification matching,
  targeting & precedence ordering, effective-field provenance, CRUD incl. the
  read-only baseline; then scan precedence (probe/report/derived), per-patch
  classification + deadlines + overdue, compliance counting & ageing
  (carry-forward + clear), device rows/filters/search, group/site/OS rollups,
  stats & scan history, single-device scan, the rendered console, and namespace
  hygiene.

## Task 30 (done) — patch deployment & audit

The other half of Phase 6 on the same `window.ERP.patch` (`PA`) service and
Patches station: turn the approved plan into **agent jobs**, reconcile the real
results into per-patch attribution, queue/handle reboots, capture before/after
compliance, and emit an auditable per-client report. Everything is audited
through `master.audit` (`targetType: "patchdeploy"`).

- **Deployment record** — a run lives on the provider aggregate
  (`provider.patchState.deployments`, capped by `patchDeployHistory`) with
  `{kind:"deployment", id, name, at, createdBy, source, jobIds, targets}` where
  each target carries the device's `before` compliance, its per-patch states,
  its `after` compliance and its `reboot` decision. `dep.summary` /
  `dep.state` (`PA.summarizeDeployment`) fold the targets into
  planned/running/succeeded/partial/failed/cancelled counts.
- **Plan** — `PA.planForDevice(dev, rec)` sorts each device's missing set:
  approved (and deferred patches whose deferral has *elapsed*) are **deployable**
  and carry a `before` snapshot; denied, still-deferred and unapproved patches
  are **held back** with a reason. `PA.plan(providerId, {deviceId(s), siteId,
  groupId, patchIds, at})` aggregates that into per-device plans + fleet totals.
- **Install script** — `PA.deployScript(family, patches, meta)` emits a
  PowerShell (`Install-WindowsUpdate`), bash (`apt-get`) or macOS
  (`softwareupdate`) script that installs each patch and prints one
  machine-readable `PATCHRESULT <id> ok|failed [message]` line per update;
  `PA.parseResultOutput` parses them back. One job bundles up to
  `patchDeployMaxPerJob` patches.
- **Deploy** — `PA.deploy(providerId, opts)` (dry-run supported) creates **one
  agent job per device** tagged `source: "patch-deploy:<runId>"`, records a
  target per device (running / pending patches), and persists the run.
- **Reconcile** — `PA.reconcileDeployment(providerId, id, {at, results?,
  force?})` reads each job back (or takes injected results), attributes every
  `PATCHRESULT` line, marks unreported/over-cap patches `skipped`, and on the
  first pass captures **after** compliance by re-scanning with the installed
  patches removed. Partial failures are **retried automatically** up to
  `patchRetryMax` times, gated by `patchRetryBackoffMinutes` (or `force`), each
  retry a fresh job. `PA.reconcileAll` sweeps the list (skipping terminal runs
  unless `recheck`).
- **Reboots** — `queueReboot` resolves the device's effective `rebootPolicy`:
  `never` records a **skipped** reboot, `if-required` queues a **pending**
  reboot with a grace deadline, and `in-window` only schedules when a
  maintenance window covers the device (via the schedule engine), else stays
  pending. Reboots are tracked on `patchState.reboots` with
  `PA.reboots` / `scheduleReboot` / `performReboot` (queues the
  `Restart-Computer` / `shutdown -r` job) / `completeReboot` / `skipReboot`.
- **Auditable report** — `PA.complianceReport(providerId, {from,to})` returns
  fleet compliance (`deviceRows`), per-device before/after + installed/failed
  totals, deployments, reboots, scan count and the **patch audit trail** (from
  `master.auditLog`); `PA.exportReport`/`PA.download` give a JSON export and
  `PA.renderReport` renders it (key/value grid + per-device + audit tables).
- **Config** (`config.rmm`): `patchDeployEnabled`, `patchRebootEnabled`,
  `patchRetryMax`, `patchRetryBackoffMinutes`, `patchDeployHistory`,
  `patchDeployMaxPerJob`, `patchDeployTimeoutSeconds`.
- **UI** — a fourth **Deployment & audit** tab on the Patches station: 6 stat
  cards (ready/blocked/active runs/reboots queued/installed/failed), a *Ready to
  deploy* card (plan table + **Deploy ready** button), a *Deployments* card
  (state badges, patch progress, Reconcile/View), a *Reboot queue* card
  (Reboot now / Skip / Mark done), and a *Compliance report* card
  (Generate report / Export JSON). A deployment drill-down modal shows each
  target's per-patch states, held-back patches and reboot decision. Left-aligned,
  responsive (verified at 1440 and 390 wide; tables scroll at phone width).
- **Tests**: `await window.RMMPatchDeployTest()` (43 checks, stub-backend) — the
  per-OS script + `PATCHRESULT` parsing, the plan (approve vs held-back
  denied/deferred), dry-run, one-job-per-device with the deployment source,
  real job claim/result reconciliation into installed vs failed attribution,
  before/after capture, the retry backoff + forced retry + a settled partial,
  reboot queueing under if-required/in-window/never, the reboot
  schedule→reboot→done lifecycle + skip, `reconcileAll` terminal-skip,
  `complianceReport` totals/before-after/audit trail + JSON export + render, and
  the rendered four-tab console.

## Tasks 31–33 (done) — software catalog, deployment & licensing

Phase 7 on `window.ERP.software` (`SW`) and the Software station: a catalog of
deployable packages with silent command templates + detection rules, assignment
to devices/groups with per-device installed/pending/failed reporting, and
licence + inventory reconciliation with an exportable per-client report. Uses
the same `J.enqueue` job path as patches; deployments emit `SWSRESULT <id>
<state> [msg]` and the detection probe emits `SWDETECT` lines. Everything is
audited per device through `master.audit` (`targetType: "device"`), and state
lives on the provider aggregate as `provider.softwareState`
(`{catalog, deployments, licenses, allowList}`).

- **Catalog** — `SW.addPackage/updatePackage/removePackage/duplicatePackage/
  enablePackage` maintain `{id, name, vendor, category, description,
  requiresReboot, variants, detectionRules, parameters, source, checksum,
  checksumAlgo, tags}` where each per-OS `variant` carries
  `{os, arch, install, uninstall, update, rollback, detectCommand,
  requiresReboot, source, checksum}`. `SW.variantFor(pkg, family)` picks the
  OS variant; `SW.renderTemplate(cmd, params)` and `SW.validateParameters` /
  `SW.validatePackage` guard the command templates and required parameters;
  `SW.checksumFor` + `verifyChecksum` anchor the source/checksum pair.
- **Detection** — `SW.evaluateRules(rules, installedList)` applies ALL/ANY
  rules with `equals/contains/starts/ends/regex/version</>/absent` operators to
  the agent-reported software inventory; `SW.findInstalled` resolves the best
  matching version; `SW.resolveAction(device, pkg, installed, opts)` returns
  `install` / `update` / `skip` / `uninstall` / `rollback` / `downgrade` /
  `blocked` (with reason), honouring `enforce`, a pinned target version and the
  package's declared rollback support.
- **Deployment** — `SW.commandFor(...)` expands the variant template per OS;
  `SW.deployScript(...)` emits a Windows PowerShell or Linux/macOS shell script
  with a `SWSRESULT` trailer; `SW.parseResultOutput` + `SW.parseDetectOutput`
  fold agent output back into state. `SW.planForDevice` / `SW.buildPlan`
  aggregate the actionable set per device (up-to-date devices are **skipped**
  by detection), and `SW.deploy` enqueues one agent job per device
  (`J.enqueue`, capped by `softwareDeployMaxPerJob`, timeout
  `softwareDeployTimeoutSeconds`). `SW.reconcileDeployment` /
  `SW.reconcileAll` turn real job results into installed/failed/pending
  attribution with retry (`softwareRetryMax`, `softwareRetryBackoffMinutes`,
  `force` for a fresh job), `SW.retryTarget` re-queues a failed target, and
  `SW.assignmentRows` reports per-device compliance
  (installed/not-installed/pending/failed) against each assignment.
- **Licences & reconciliation** — `SW.addLicense/...` track owned seats per
  client product; `SW.reconcile(providerId)` flags **over-deployed**,
  **expired**, **unsanctioned** (installed but not catalogued/allow-listed) and
  **ok** software, and returns fleet totals (including device and inventory
  counts); `SW.inventoryReport()` and `SW.exportReport()` produce the
  per-client inventory/licence report and its stable JSON export;
  `SW.renderReport` renders it.
- **UI** — the Software station console (`SW.render`) with **Catalog**,
  **Deployment**, **Licences & reconciliation** and **Inventory** tabs, the
  package editor modal (per-OS variant command textareas, detection-rule rows,
  parameters, source/checksum), the deployment plan picker + dry-run/real
  deploy + deployments/reconcile views, and a **Software & deployment** section
  appended to the device detail modal (`SW.deviceSection`). Left-aligned and
  responsive (verified at 1440 and 390 wide; tab bar and tables scroll at phone
  width; the 6-up stat grid collapses to 2 columns ≤560px). Demo seed
  (`SW.seedDemo`, 8 packages + 4 licences) is idempotent by `swpkg-demo-*` id.
- **Tests**: `await window.RMMSoftwareTest()` (56 checks, stub-backend) — see
  the test list below.

## Tasks 34–36 (done) — security posture, compliance baselines & backup verification

Phase 8 on `window.ERP.security` (`SEC`, `src/rmm.security.js`) and the Security
station: a configurable endpoint-security check catalogue scored per device,
compliance baselines with drift detection and remediation hand-off, and backup
verification (last-successful-backup tracking, missed/failed escalation and
periodic recovery-test confirmation). State lives on the provider aggregate as
`provider.securityState`
(`{checks, baselines, posture, scans, deviations, backupExpectations, backupJobs,
backupState, recoveryTests}`) — added to `OBJECT_COLLECTIONS` in
`src/rmm.tenancy.js` so it merges/syncs like the other object collections — and
every mutation is audited through `master.audit` (device-scoped changes carry
`targetType: "device"`).

- **Checks & posture** — `SEC.CHECK_CATALOGUE` defines the configurable checks
  (AV/EDR present & current, firewall, disk encryption, patch currency via
  `ERP.patch.complianceFor`, local-admin/service changes, plus custom checks)
  with category/severity. `SEC.evaluateCheck` / `SEC.evaluateDevice` score a
  device's `INV.snapshot(...)` sections into pass/warn/fail/unknown/na findings
  with a 0–100 score; `SEC.scan(providerId)` runs every enrolled device, stores
  the latest posture + a capped scan history (`securityScanHistory`) and emits
  `security-scan` audit entries; `SEC.postureRows` and `SEC.rollup` produce the
  per-device table and the fleet summary. Failing posture raises/clears an alert
  via `SEC.syncPostureAlert` (dedupe key `security-posture|<deviceId>`) when
  `securityAlertEnabled`.
- **Baselines & drift** — `SEC.normalizeBaseline` / `addBaseline` /
  `updateBaseline` / `removeBaseline` maintain named baselines (required checks,
  priority, severity, site/group/tag targeting); `SEC.effectiveBaseline` picks
  the highest-priority applicable baseline (falling back to the built-in set).
  `SEC.driftFor` / `SEC.compliance` compare live posture against the effective
  baseline and report **non-compliant** devices with the exact failing checks;
  `SEC.driftHistory` records capped drift points (`securityDriftHistory`), and
  `SEC.acceptDeviation` / `SEC.clearDeviation` record/clear accepted deviations
  with an auditable reason.
- **Remediation** — `SEC.remediationOptions` lists the automation rules bound to
  a baseline; `SEC.remediate` fires the automation engine (`AUTO.run`) against a
  `compliance.drift` event (a new trigger registered in
  `src/rmm.automations.js`) so drift can be fixed through the existing
  action pipeline.
- **Backup verification** — `SEC.BACKUP_PRODUCTS` / backup expectations
  (`maxAgeHours`, `graceHours`, recovery cadence, targeting) drive
  `SEC.computeBackupState` and `SEC.backupRows` (last success, age vs max, next
  due). `SEC.reportBackup` ingests job outcomes, `SEC.ingestBackups` pulls
  backup jobs from the agent inventory, and `SEC.scanBackups` flags **missed**
  and **failed** backups and raises/clears an alert via `SEC.syncBackupAlert`
  (dedupe key `backup-verify|<deviceId>`) when `backupAlertEnabled`.
- **Recovery tests** — `SEC.ensureRecoveryTests` opens dated recovery-test
  confirmations per device from the effective expectations; `SEC.confirmRecovery`
  records the confirming user/result and stamps the device, giving an auditable
  record that a restore was actually exercised.
- **UI** — the Security station console (`SEC.render`) with **Security posture**,
  **Baselines & drift** and **Backup verification** tabs, six stat tiles, posture
  search/state filters, the baseline editor (required-check picker + remediation
  rule), the drift table with Remediate/Accept actions and an accept-deviation
  modal, the backup expectation editor, and a **Security & compliance** section
  appended to the device detail modal (`SEC.deviceSection`). Left-aligned and
  responsive (verified at 1440 and 390 wide; the tab bar scrolls and tables
  scroll within their cards at phone width; the 6-up stat grid collapses to 2
  columns). Tab badges show the live failing/non-compliant/problem counts. Demo
  seed (`SEC.seedDemo`, 3 baselines + 3 backup expectations) is idempotent.
- **Tests**: `await window.RMMSecurityTest()` (60 checks, stub-backend) — see the
  test list below.

## RMM Tasks 37–39 (done) — remote access & field actions

> (These are the **RMM-U** backlog's Tasks 37–39, not the Business ERP
> framework's own 37–39 further down this document.)

Phase 9 on `window.ERP.remote` (`REM`, `src/rmm.remote.js`) and the Devices
station's **Remote** sub-tab: a browser-based remote terminal that drives
commands through the collector → agent job path, integration (not replacement)
of third-party remote-control/tunnel tools with per-device session handoff, and
audited file push/pull with integrity checks, size limits and upload
quarantine. State lives on the provider aggregate as `provider.remoteState`
(`{sessions, tools, presets, handoffs, transfers}`) — added to
`OBJECT_COLLECTIONS` in `src/rmm.tenancy.js` so it merges/syncs like the other
object collections — and every mutation is audited through `master.audit`
(device-scoped changes carry `targetType: "device"`).

- **Remote shell/console** — `REM.SESSION_*` constants and `REM.openSession`
  open a logged console session against a device; `REM.runCommand` enforces
  permission gating + a per-command confirmation step, consults
  `REM.DENY_LIST`/`REM.checkCommand` (dangerous-command deny-list, configurable
  in `config.rmm`), dispatches a `shell` job through `ERP.jobs` (`J.claim` /
  `J.result`) to the collector → agent path, streams the captured stdout/stderr
  + exit code, and renders clear no-output/timeout handling. Every session
  records who ran what, when and on which device; `REM.closeSession` stamps the
  session end and `REM.sessionLog` returns the auditable history.
- **Remote-tool integration & session handoff** — `REM.TOOL_CATALOGUE` /
  `REM.addTool` / `REM.updateTool` maintain the third-party remote-control and
  tunnel integrations; `REM.launchTool` produces a per-device, pre-targeted
  launch (with the device's identity filled in) and `REM.createHandoff`
  generates a per-device handoff link/token with an expiry. Both record the
  launch/handoff and the resulting session against the device
  (`REM.handoffRows`), so external sessions remain part of the device's history.
- **File transfer** — `REM.pushFile` / `REM.pullFile` transfer through the agent
  with a SHA-256 integrity trailer (`@@RMMFILE <name> <sha256> <bytes>`, hashed
  with `localCore().sha256Hex`), a configurable size cap
  (`config.rmm.maxTransferBytes`), chunking for large payloads, and a
  quarantine/permission check on uploads (`REM.quarantineCheck`) that flags
  executable/unsafe types before they land. Every transfer is audited
  (`REM.transferRows`) with a verified/failed/quarantined state.
- **UI** — the Remote sub-tab in the Devices station (`REM.renderRemote`, three
  nested tabs: **Shell**, **Tools**, **Files**) with a live terminal (`$`
  prompts, streamed output, spinner while awaiting the agent), a tool launcher
  with Launch/Handoff/Edit/Disable/Delete actions, a handoff/session table and a
  transfer table with integrity badges. Also reachable from the device detail
  modal's **Remote access** section (`REM.deviceSection` / `wireDeviceSection`).
  Left-aligned and responsive (verified at 1440 and 390 wide; tables scroll
  within their wrappers rather than overflowing the page). Demo seed
  (`REM.seedDemo`) is idempotent and picks the first demo provider whose
  document actually loads.
- **Tests**: `await window.RMMRemoteTest()` (82 checks, stub-backend) — see the
  test list below.

## RMM Tasks 40–42 (done) — dashboards, reporting & integrations

> (These are the **RMM-U** backlog's Tasks 40–42, not the Business ERP
> framework's own task numbers further down this document.)

Phase 10 opens with the "read the whole fleet" layer: a live operational
dashboard, a scheduled/on-demand reporting service with delivery, and the
integration surface that ties RMM-U into the rest of the pipeline. Three new
modules, three new nav stations wired up (the Dashboard and Integrations
stations plus the Reports station's report tabs), all reading the existing
services (devices, alerts, patches, security, monitors, jobs, events) rather
than duplicating them.

- **`window.ERP.fleet`** (`FL`, `src/rmm.dashboard.js`, Task 40) —
  **operational dashboards**. `FL.snapshot(providerId)` gathers one tenant's
  whole operational picture in a single pass: device up/down/offline/stale
  (`D.statsOf`), **agent health/version spread** (`FL.agentHealth` — version
  histogram, outdated/pending/unknown counts, `compareVersions`, latest known
  version resolved from config → agent catalogue → device max), **alert counts
  by severity and by age bucket** (`FL.alertStats` — `<1h`/`1–24h`/`1–7d`/
  `7d+`), patch compliance (`PA.rollup`), security/backup compliance
  (`SEC.compliance` + `SEC.backupRows` + `SEC.postureRows`), monitor
  coverage (`M.stats`) and **job success rate** (`J.stats`). `FL.tiles(snap)`
  turns that into the clickable tile set, and **`FL.affected(providerId, kind,
  arg)`** resolves any tile (or any sub-count) to the **exact affected devices**
  for kinds: `status`, `agent-outdated`, `agent-pending`, `agent-unknown`,
  `alert-severity`, `alert-age`, `patch-noncompliant`,
  `security-noncompliant`, `backup-problem`, `job-failed`,
  `monitor-uncovered` and `device` — so every number drills down. The console
  renders a tone-coded tile grid + an **Agents** tab (the version spread) with a
  **live toggle** subscribed to the Task-16 event bus (`EV.on`) and a
  drill-down device-list modal.
- **`window.ERP.rmmReports`** (`RP`, `src/rmm.reporting.js`, Task 41) —
  **reporting**. Seven report definitions (`RP.REPORTS`: device-health,
  patch-compliance, monitor-compliance, alert-summary, asset-inventory,
  backup-status, security-posture), each runnable on demand via
  `RP.run(providerId, id)` producing a **stable, versioned export**
  (`{schema:"rmm.report", version:1, reportId, title, generatedAt, columns,
  rows, summary, totals}`) with `toCsv`/`toJson`/`export`/`download`.
  **Schedules** live in the hidden `reportschedules` document
  (`report-schedule` records) with `addSchedule`/`updateSchedule`/
  `removeSchedule`/`listSchedules`/`dueSchedules`/`runSchedule`/`runDue`
  and a `nextRun` calculator (daily/weekly/monthly, UTC). **Deliveries** live
  in the hidden `reportdeliveries` document: `deliver`/`deliverReport` route
  by email through `NOT.send` (Task 25's notification service) or produce an
  in-app `link`, and `listDeliveries`/`getDelivery` read the delivery log.
  Console: a **Client reports** library, **Report schedules** and
  **Deliveries** view, rendered by `RP.renderLibrary`/`renderSchedules`/
  `renderDeliveries` (each with a provider picker) into the Reports station.
- **`window.ERP.integrations`** (`INT`, `src/rmm.integrations.js`, Task 42)
  — **integrations & bus publication** (plus the `window.ERP.api` facade).
  **Consumption**: `INT.ingest` accepts company/site/configuration records from
  the psa-u and documentation sources; `records`/`getRecord` list them;
  **explicit field ownership** (`INT.DEFAULT_OWNERSHIP`, `ownershipFor`/
  `ownershipMap`/`setOwnership`) decides which system may set each field, and
  **`INT.drift`**/`driftCount` detect when an external system overwrites an
  owned field, with `resolve`/`resolveAll` and `INT.setRmmField` for the RMM
  side. **Publication**: a versioned envelope (`ENVELOPE_VERSION = 1`,
  `ENVELOPE_SCHEMA = "rmm.event.v1"`) built by `INT.envelope`, sent by
  `INT.publish` through a swappable `INT.sender` (signed with an
  `X-RMM-Signature` header), logged in `publications`, with `dispatch` (and
  `startAutoPublish`/`stopAutoPublish`) publishing device-health and alert
  events from the Task-16 event bus. **Outbound webhooks**: `addWebhook`/
  `updateWebhook`/`removeWebhook`/`listWebhooks`/`testWebhook`. **Analytics
  extract**: `ANALYTICS_VERSION = 1`, `ANALYTICS_SCHEMA = "rmm.analytics.v1"`,
  `analyticsExtract` over six tables (devices, alerts, patchCompliance,
  securityPosture, backupStatus, jobs) and `exportAnalytics` as JSON or NDJSON.
  Console: an Integrations tab (sources & drift, webhooks & bus, analytics)
  rendered by `INT.render`.
- **Wiring** — `erp.modules.js` points the `dashboard` station at
  `ERP.fleet.render` and the `integrations` station at
  `ERP.integrations.render`; the Reports station's continuity console gained
  **Client reports**, **Report schedules** and **Deliveries** tabs that delegate
  to the reporting service (`rmm.continuity.js` `validTab` +
  `renderReportTab`), with the station-tab router guarding against hijacking
  the nested report controls. `rmm.tenancy.js` added **`integrationsState`**
  (`{sources, ownership, external, drift, webhooks, publications}`) to
  `OBJECT_COLLECTIONS` so it syncs/merges with the other object collections.
  `index.html` loads the three new scripts after `rmm.remote.js` (dashboard
  before integrations — `INT` captures `ERP.fleet` at load). `erp.css` gained
  the `.rmm-dash*`/`.rmm-tile*`/`.rmm-reports-inner`/`.rmm-integrations*`
  blocks + responsive rules. Two hidden documents added to `erp.modules.js`:
  `reportschedules` and `reportdeliveries`.
- **Tests**: `await window.RMMDashboardTest()` (23 checks), `await
  window.RMMReportsTest()` (35 checks) and `await window.RMMIntegrationsTest()`
  (42 checks) — see the test list below.

## RMM Task 43 (done) — data-quality linter

> (This is the **RMM-U** backlog's Task 43.)

Phase 10 closes with the audit layer. A real RMM accumulates rot: agents that
stopped reporting months ago, devices nobody owns, monitors whose alerts reach
no one, duplicate records from two enrollment attempts, groups pointing at a
deleted site, alerts that can never auto-clear, and scripts whose parameters
accept anything. None of it breaks the console — all of it quietly degrades the
service. The linter scans a client's whole aggregate and reports each problem
**with the offending record**, so it can be opened, inspected and fixed. It is
strictly **read-only**: the only thing it changes is your understanding of the
estate.

- **`window.ERP.dataQuality`** (`DQ`, `src/rmm.dataquality.js`, Task 43) —
  **data-quality linter**. Eight checks (`DQ.CHECKS`, each with an id, label,
  category, default severity and description): `agent-stale` (liveness — agent
  offline past the threshold, stale, or never seen), `device-unassigned`
  (ownership — no site and no owner), `no-policy` (configuration — no enabled
  policy targets it), `duplicate-device` (hygiene — shared hostname / serial /
  MAC), `orphan-group` (hygiene — dangling site, or matches nothing),
  `unrouted-monitor` (alerting — no enabled route would deliver it, or it
  matches no devices), `alert-stuck` (alerting — its monitor or device is gone
  or disabled, or it is a manual alert left open too long), and `unsafe-script`
  (safety — parameters with no validation bounds). Each finding is
  `{check, severity, message, entity:{type,id,name}, hint, station, record}` —
  the `record` is the offending document, and `station` deep-links to the nav
  station that owns it (`DQ.STATIONS` / `DQ.stationFor`). `DQ.scanProvider(
  provider, opts)` is a **pure, synchronous** scan of an in-memory provider;
  `DQ.scan(providerId)` loads the tenant (and the notification routes, which
  live outside the provider aggregate via `RT.list`) and calls it;
  `DQ.scanAll(opts)` scans every non-archived client and aggregates totals.
  Pure helpers — `ownerOf`, `duplicateGroups`, `monitorRouted`, `alertStuck`,
  `isUnsafeParameter`, `unsafeParameters`, `humanDur`, `summaryText` — are
  exposed so the checks can be reasoned about and tested in isolation. The
  console (`DQ.renderPanel` / `DQ.renderInto`) is the **Data quality** tab of
  the Reports station's continuity console: a KPI summary grid, severity/check
  filters, a client picker, a Rescan button, the findings table, and a
  record-inspection modal with a "Go to <station>" deep link. Config (master
  config): `dataQualityEnabled` (master switch), `dqOfflineDays` (7),
  `dqManualAlertDays` (30) and `dqDuplicateFields` (`hostname,serial`).
- **Wiring** — `rmm.continuity.js`'s Reports console gained a **Data quality**
  tab (`validTab` accepts `"quality"`; `renderReportTab` delegates `"quality"`
  to `ERP.dataQuality.renderPanel`; the tab strip and both router checks include
  `"quality"`) — the console now has **8 tabs**. `index.html` loads
  `src/rmm.dataquality.js` after `rmm.integrations.js`. `erp.css` gained the
  `.rmm-dataquality` / `.rmm-dq-controls` / `.rmm-dq-record` blocks + responsive
  rules. No new documents (the linter reads existing state).
- **Tests**: `await window.RMMDataQualityTest()` (60 checks) — see the test list
  below.

---

## RMM Task 44 (done) — agent simulator & end-to-end suite

> (This is the **RMM-U** backlog's Task 44.)

Phase 11 opens by making the whole RMM testable end to end. A real RMM is
judged by the loop an endpoint drives — install, enrol with a one-time token,
heartbeat, send inventory & metrics, receive work, answer it — and everything
downstream reacting. This module manufactures that loop on demand so it can be
exercised without a fleet of real machines. Crucially, the simulator is a
**host that drives the platform's own agent-facing services**; it does not
re-implement them, so every byte a simulated agent posts travels the same
authenticated path (and blocking a simulated credential blocks it exactly like
a real one).

- **`window.ERP.simulator`** (`SIM`, `src/rmm.simulator.js`, Task 44) —
  **agent simulator & fixture host**.
  - **Deterministic**: `SIM.newSeed()` and a mulberry32 `SIM.rng(seed)`; a
    scenario that passes once passes every time.
  - **Identity & profiles**: `SIM.PROFILES` (Windows server / Windows
    workstation / Linux server / Mac laptop), `SIM.TEMPERAMENTS` (idle, normal,
    busy, hot, leak, full — each a metric distribution), `SIM.createAgent(...)`,
    and `SIM.buildInventory`/`SIM.buildSample`/`SIM.buildHeartbeat` which
    synthesize realistic hardware and telemetry payloads.
  - **Agent verbs** (each calls the real service): `SIM.enrollAgent` →
    `ERP.enrollment.enroll`, `SIM.heartbeat` → `ERP.heartbeat.heartbeat`,
    `SIM.sendInventory` → `ERP.rmmInventory.submit` (full snapshot, then deltas
    via `INV.agentPayload`), `SIM.sendMetrics` → `ERP.metrics.submit`,
    `SIM.answerJob` → `ERP.jobs.result`. `SIM.cycle(agent, opts)`/
    `SIM.run(agents, n, opts)` advance one agent / a fleet through check-ins.
  - **Fixtures**: `SIM.DEFAULT_SITES` (HQ / data centre / branch),
    `SIM.DEFAULT_GROUPS` (servers / workstations), and
    `SIM.fixtures(opts)` — builds a whole tenant (a provider with sites, device
    groups and an enrolled fleet distributed across them) in one call.
    `SIM.defaultFleet(n)` sizes a fleet.
  - **End-to-end loop**: `SIM.fullLoop(opts)` runs the canonical scenario —
    fixture → heartbeat → monitor → alert → route → automation → psa-u ticket →
    remediation job answered → recover → auto-clear → ticket resolved — and
    returns a structured trace (`steps`, `alert`, `automation`, `job`,
    `recovery`, `ticket`, `notifications`, `routeDeliveries`, …). It schedules
    the sweep at `SIM.cleanTime()` (a Wednesday midday outside every seeded
    maintenance window) so the breach is treated as genuine regardless of the
    day the test runs; recovery is scanned a minute later.
  - **Reads & console**: `SIM.stats(providerId)` (devices/online/stale/offline,
    alerts, tickets, jobs, monitored) and `SIM.renderPanel`/`SIM.renderInto`
    (the **Simulator** tab of the Devices station: fleet builder + KPI summary +
    run log + loop trace).
- **Wiring** — the Devices station (`src/rmm.devices.js`) gained a **Simulator**
  tab (`TABS` now `fleet, structure, deploy, simulator, inventory, …`;
  `renderPanel` delegates `"simulator"` to `ERP.simulator.renderPanel`).
  `index.html` loads `src/rmm.simulator.js` after `rmm.dataquality.js`.
  `erp.css` gained the `.rmm-simulator` block + responsive rules. No new
  documents (the simulator writes only through the real services).
- **Tests**: `await window.RMMSimulatorTest()` (39 checks) and
  `await window.RMMEndToEndTest()` (30 checks) — see the test list below.

---

## RMM Task 45 (done) — agent security tests

> (This is the **RMM-U** backlog's Task 45.)

The whole agent-facing surface rests on one property: a request is accepted only
when it carries a credential that proves the caller is *this* device, currently
enrolled, not revoked, and acting within its own provider/tenant. Task 45 adds a
dedicated adversarial suite that attacks that property from every angle — it is
**test-only** (no production module changed); every guarantee it asserts was
already provided by the enrolment/jobs/collector code, and the suite exists to
lock those guarantees down against regression.

`RMMAgentSecurityTest` (`window.RMMAgentSecurityTest`, in `src/erp.tests.js`)
covers seven areas:

- **Enrolment** — a token is single-use, provider-bound, rejects expired/revoked/
  unknown tokens, and is stored only as a hash; a fresh enrolment takes its site
  and group bindings from the token, not from the request (so a caller cannot
  place an agent into a tenant or group it wasn't issued for).
- **Authentication** — a valid credential is accepted and a forged one refused
  across every agent-facing service (`heartbeat`, `rmmInventory.submit`,
  `metrics.submit`, `jobs.claim`, `jobs.result`, `diagnostics.logs`,
  `diagnostics.selfTest`, `resilience.update`); an unknown device authenticates
  as `no_credential`.
- **Job isolation** — a job claimed by one device cannot be claimed or answered
  by another; a stolen credential is bound to its own device (`not_targeted`),
  and cross-provider answers are refused (`wrong_provider`).
- **Replay & tamper** — a genuine result is accepted; replaying it is reported
  `duplicate:true` and cannot overwrite the stored outcome (status/exit code/
  stdout); an unknown job id is `not_found`.
- **Revocation** — a revoked device is refused everywhere with reason `revoked`.
- **Collector core** — the authoritative core (`COL.createCore`) confirms all of
  the above at the server boundary: token stored hash-only, spent token refused,
  all nine device ops reject a forged credential, a job is delivered to its
  target only, a cross-device result is `wrong_device`, replay is idempotent and
  leaves state unchanged, and a revoked device is refused.
- **No static secret** — the public collector source (`<script
  type="text/x-server-plugin">`) contains the expected markers, no plaintext
  `cred_`/`rmm_` credential material, no baked-in credential/token hashes, no
  plaintext admin password, and never leaks the minted secret.

- **Tests**: `await window.RMMAgentSecurityTest()` (58 checks) — see the test
  list below.

---

## RMM Task 46 (done) — failure, storm & scale tests

> (This is the **RMM-U** backlog's Task 46.)

Phase 11 closes with an adversarial load suite: it pushes the platform into the
states a real fleet reaches only occasionally — jobs that time out, agents that
check in all at once, alerts that flap, oversized metric posts, a job fanned out
to an entire fleet, and retention running over years of accumulated history — and
asserts the system stays responsive and loses nothing it acknowledged.

`RMMStormTest` (`window.RMMStormTest`, in `src/erp.tests.js`) runs against a stub
backend and a mock hub, building a real enrolled fleet via the simulator, and
covers six areas:

- **Collector & console timeouts** — an agent-reported timeout lands as
  `timed-out`; a delivery the agent never started is requeued within
  `maxAttempts` and, once attempts are spent, abandoned; an over-running job is
  timed out by the reaper; an undelivered job past its expiry expires. The
  collector core (`COL.createCore`) is driven through the same lifecycle
  (deliver → requeue → running → abandon → prune) so both sides agree.
- **Reconnect storms** — the whole fleet checks in back-to-back and every device
  reads online; the collector's per-device rate cap clamps a hammering endpoint
  (5 allowed / 7 throttled at a cap of 5) without touching its neighbour and
  counts the rejections; an oversized `batch` op is refused as a unit; and the
  console event stream absorbs a 2,000-event burst (bounded ring, every event
  delivered once), survives a dropped/reopened socket, and exposes the new
  jittered reconnect backoff (`EV.reconnectDelayMs`).
- **Alert flapping** — a repeat breach de-duplicates onto one alert, severity
  escalation is recorded, an acknowledged alert stays acknowledged through
  further breaches, re-firing within the flap window flags the alert `flapping`
  with a full resolve/reopen history, and — crucially — `AL.prune` removes an
  aged **resolved** alert while never dropping an **acknowledged** one (even
  through `AL.scan({prune:true})`).
- **Large metric payloads** — a 560-sample post is clipped to
  `MAX_SAMPLES_PER_POST`, rejected samples are dropped without corrupting the
  series, repeated posts keep the raw ring exactly at `RAW_LIMIT`, hourly/daily
  roll-ups accumulate, a garbage-only post is refused (not crashed), the codec
  round-trips and shrinks a huge body, and the collector caps a 3,000-sample op.
- **Bulk job dispatch** — a single job enqueued against the entire fleet (and
  both `all` and `online` target resolution) is claimed by every device exactly
  once — never twice — and answered by all of them; enqueue/claim/answer each
  stay inside the responsiveness budget.
- **Retention & pruning at scale** — terminal jobs past the window are pruned in
  bulk while a queued job survives both `J.reap` and `RET.apply`; an over-full
  metric ring is trimmed to exactly the policy limit; the collector's
  `applyRetention` bounds every durable region (samples/hourly/daily/logs/
  self-tests); and capacity/namespace invariants hold.

The suite also asserts the whole run stays inside a generous wall-clock budget,
catching accidental O(n²) blowups. The only production change this task needed
was the reconnect-jitter hardening in `src/rmm.events.js`; everything else the
tests assert was already enforced by the existing code.

- **Tests**: `await window.RMMStormTest()` (69 checks) — see the test list below.

---

## RMM Task 47 (done) — README & playbook

> (This is the **RMM-U** backlog's Task 47.)

Phase 11 closes by making the system legible to the people who run and extend
it. Everything below is documentation — **no production code changed** — and it
lives in a new `src/PLAYBOOK.md` that the README links to.

- **The playbook** (`src/PLAYBOOK.md`) is the operator/developer companion to
  this README, with seven parts:
  1. **Architecture** — the three tiers (agent → collector hub → console), the
     13 nav stations and their controllers, the data model (canonical store,
     per-tenant aggregate, hidden system documents) and the full `window.ERP.*`
     service map, plus one request traced end to end (a monitor breach).
  2. **The agent lifecycle** — install (`AG.installer`/`installerForProvider`,
     what the installer embeds) → enroll (`E.enroll`, token bindings, re-key-in-
     place) → heartbeat (`H.heartbeat`, skew/version/capabilities, the pull
     channel) → collect (`INV`/`MET`/`DIAG`, the spool) → act (`J`/`DSP`, base64
     transport, timeouts) → update (`RS`, checksum → stage → self-test →
     rollback) → uninstall/decommission (revoke first, then uninstall).
  3. **Credentials, tokens & the no-static-secret rule** — the two hashed-only
     secrets and the one-time plaintext return, the admin gate, the rule that
     the public collector script holds no static secret, and how
     `RMMCollectorTest`'s core **drift guard** + `RMMAgentSecurityTest`'s
     no-secret assertions enforce it; rotation and revocation.
  4. **Extending the platform** — step-by-step cookbooks for adding a **monitor
     type** (catalogue entry + `M.evaluate` case + optional `latestReading`),
     a **script** (typed parameters + `LIB.safeLiteral` escaping), a **patch
     policy** (class rules + precedence + provenance), and an **automation
     action** (`AUTO.ACTIONS` + `executeAction` case).
  5. **Integration ownership** — the psa-u / documentation-tool field-ownership
     table, ingest + drift + resolution, and publication (the `rmm.event.v1`
     envelope, webhooks, the `rmm.analytics.v1` extract).
  6. **Operating runbook — agents that go dark** — the detection layers, the
     triage sequence, the ten `DIAG.SELF_TEST_CHECKS`, the
     `DIAG.TROUBLESHOOTING` symptom→cause→fix table, and remediation/prevention.
  7. **Reference** — the collector's device + admin op lists, the test suites,
     and the house rules.
- **README** — the build-state line now records Phase 11 complete, and this
  section links the playbook so a new operator or agent knows where to start.
- **Tests**: none (documentation task). Existing suites unchanged; the full RMM
  regression sweep is 41 suites / 1,786 checks.

---

## RMM Task 48 (done) — role & access model

> (This is the **RMM-U** backlog's Task 48.) Phase 12 begins.

Until now the console's "role" was a single global selector (owner / manager /
staff) that only hid parts of the UI. Task 48 replaces that with a real,
**server-enforced** access model: named roles scoped to a site and optionally to
a single device, with the destructive capabilities gated separately from
read-only ones.

- **`window.ERP.access`** (`A`, `src/rmm.access.js`) — the client-side access
  service. It exposes the role catalogue, capability resolution, the user/grant
  store and the "Roles & access" panel render.
  - **Roles** (`ACC.ROLES`): `read-only`, `technician`, `dispatcher` and
    `security-admin` (plus the legacy `owner`/`manager` inherited from the ERP
    framework's global role selector, which stays as a coarse fallback).
  - **Capabilities** (`ACC.CAPS`) are the fine-grained permissions — view,
    triage, patch deploy, script run, remote shell, file transfer, policy
    edit, user manage, etc. `ACC.ROLE_CAPS` maps each role to its default
    capability set; `ACC.CAP_ORDER` gives the panel's display order.
  - **Destructive actions** (`ACC.DESTRUCTIVE`) are the four caps that can
    change or exfiltrate a device — **script execution, patch denial, remote
    shell and file transfer** — and are gated separately: a role can hold a
    normal capability without inheriting the destructive one.
  - **Scope** — every grant is scoped to a **site** and optionally narrowed to
    a single **device**. `ACC.effectiveScope(id)` / `ACC.effectiveCaps(id)`
    resolve the caps in force for a given target, and `ACC.can(cap, target)` is
    the single predicate every controller asks before acting.
  - **`ACC.identity()`** — the effective identity: the live hub's authenticated
    user when `T.status === "online"`, otherwise the locally-stored
    `erp.team.userId.v1` + `ERP.role`. The resolver is **hub-gated** (via
    `ACC.hubLive()`): stale `me`/caps from a previous online session are never
    trusted while the hub is offline, so a read-only user can't be locked out
    or a technician silently elevated by cached state.
  - **`ACC.require(...)`** is the throwing form used by gates; **`ACC.describe`**
    renders a human-readable summary for the panel and toasts.
  - **Panel** — `ACC.render`/`ACC.paint` produce the **"Your access"** summary
    card, the **"Role capabilities"** matrix (roles as columns, caps as rows,
    destructive rows flagged), the users table and the access log. CSS lives in
    `src/erp.css` (`.erp-cap-cloud`, `.erp-cap-chip`, `.erp-yes`, `.erp-no`).
- **Server-side enforcement** — restrictions are not merely hidden in the UI.
  The public collector hub (`index.html`, `RMM-COLLECTOR-CORE` block) resolves
  the **acting** user and calls `collectorCore.guardAdmin(acting, action, body)`
  plus `collectorScopeFilter` before every admin/device operation, so a crafted
  request that bypasses the console is still rejected. New team-hub RPCs
  (`T.rmmAuthorize`, `rmmListAccess`, `rmmSetRole`, `rmmSetScopes`, `rmmSetCaps`,
  `rmmRemoveAccess`, `rmmCatalog`) are themselves gated on the `access.manage`
  capability, so only an admin can ever read or mutate grants.
- **Consumers** — the distinction between "normal" and "destructive" is wired
  through the existing controllers:
  - `src/rmm.remote.js` — `REM.canShell` / `canTransfer` / `canTool` route
    through `ACCESS.can(cap, deviceId)` with a legacy-role fallback so the old
    `rmm.remoteAllowStaff` relaxation still works.
  - `src/rmm.patch.js` — `patchGate("patch.deny"/"patch.deploy", target)` guards
    policy edits and deployment; deploy also checks the target is in scope and
    returns `{error:"out_of_scope"}` otherwise.
  - `src/rmm.master.js` — a 14th master-config tab, **"Roles & access"**, renders
    the `ACC` panel.
- **Storage** — grants live in the per-user/tenant store (`rmm-v1-access`, via
  the canonical document store) so they sync and back up like every other
  document; the client keeps a small in-memory cache.
- **Tests**: `await window.RMMAccessTest()` (**75 checks**) — the role/cap
  catalogue, default role caps, the four destructive caps, scope resolution
  (site vs device), the hub-gated stale-cache behaviour, the `can`/`require`
  predicate and its legacy fallback, grant CRUD + catalog RPCs, the
  panel/matrix render, and the server-side `guardAdmin`/`scopeFilter` wiring.
  The full RMM regression sweep is now **42 suites / 1,862 checks**, all green
  (plus `RMMShellTest` unchanged at 49/0 — still 13 stations).
- **Legacy Business-ERP failures** — the thirteen legacy suites that used to
  fail (`ERPMasterTest`, `ERPReportTest`, `ERPCrmTest`, `ERPProjectsTest`, …)
  exercised `crm`/`sales`/`purchasing`/`projects`/`finance` documents that were
  never registered as ERP modules, so `master.mergeParties` etc. could not
  resolve them. That vestigial framework has since been **deleted** along with
  the suites and controllers, so there is nothing left to fail.

---

## RMM Tasks 49–50 (done) — realtime console & multi-user audit

> (These are the **RMM-U** backlog's Tasks 49–50.) Phase 12 — and the 50-task
> backlog — completes here: every connected console session sees the same
> reality within seconds, and every remote action is attributed to the **true
> actor** and guarded against a concurrent editor.

Two client modules land on top of the existing hub (Task 41's authenticated
console session + Task 16's event transport + Task 48's access model), and the
public server block in `index.html` grows the multi-user RPCs they need — all
**outside** the `RMM-COLLECTOR-CORE-START/END` region, so the collector-core
drift guard is untouched.

- **`window.ERP.live`** (`LIVE`, `src/rmm.live.js`, Task 49) — **the realtime
  console**. Streams device-state, alert and job changes to every connected
  session and tracks *presence* — who else is looking at the device you are.
  - **Mode & fallback** — `mode`/`modeLabel`/`isLive` report `live` / `polling`
    / `offline` (the event transport's own mode, so it stays honest even when
    the identity hub is up); `presenceAvailable` needs a hub-authenticated
    session; `fallback` explains the degradation. Watched views still refresh
    from the polling-derived event stream when there is no socket.
  - **Focus & viewers** — `focus(deviceId, providerId)` announces the viewed
    device to the hub (`rmmFocus`); the hub fans the viewer list back out.
    `viewers`/`others`(excludes this session)/`viewerCount`, and `onViewers(fn)`
    subscribe to changes. `blur()` clears the focus (wired into closeModal).
  - **Throttled live refresh** — `watch(fn, opts)` registers a view's re-render
    function; a relevant event (device-state / alert / job) schedules a
    debounced refresh (`liveAutoRefreshSeconds`, default 3). `refreshNow` forces
    one; `status()` summarises the whole layer.
  - **Panel & indicator** — the topbar `#rmmLive` dot/text (mode colour + the
    online-session count) opens the **Realtime console** modal (`openPanel` /
    `render`): realtime mode, console-session presence, who else is on the
    focused device, and the recent event stream by kind.
  - **Device presence strip** — the device-detail modal (`rmm.devices.js`) now
    calls `LIVE.focus` on open and shows "N other technicians here" / "only
    technician" / "presence unavailable" (`[data-dev-presence]`).
- **`window.ERP.multiuser`** (`MU`, `src/rmm.multiuser.js`, Task 50) —
  **multi-user audit & rate control** — four guarantees on top of the
  single-user console:
  1. **Authenticated identity with a role** — `identity()` reads the
     hub-authenticated `T.me` (never a client-supplied actor).
  2. **Grouped connections & rate control** — `connections()` returns the hub's
     `rmmConnStats` grouping (session count / distinct users per
     privacy-preserving network bucket, proxy flag); `limits()` surfaces the
     numbers actually in force (`rateLimitPerNetConnections` 10,
     `rateLimitActionsPerMinute` 240, `rateLimitClaimsPerMinute` 60,
     `docClaimTtlSeconds` 900, `docClaimsEnabled`, `auditRemoteActions`).
  3. **Document claims** — `claim`/`release`/`claims` mediate the hub's
     `rmmClaim`/`rmmRelease`/`rmmClaims` so a second technician editing the same
     document is told **who holds it** (`editGuard` returns
     `{conflict:true, holder, message}` and refuses the write) instead of
     clobbering it.
  4. **The true-actor audit trail** — `auditRemote(action, opts)` stamps a
     console action against the hub-resolved identity; `auditTail` reads the
     hub's signed audit ring (`rmm:` remote action, `deny:` refused, `act:`
     console action). `conflicts()`/`onConflict` show pending overwrite
     conflicts and the last broadcast conflict.
  - **Panel** — the **Multi-user & rate control** panel (`openPanel`/`render`),
    rendered as a section **inside Admin → Roles & access** (not a 14th
    master-config tab — `RMMMasterConfigTest` still asserts 14): the
    authenticated session, connections & rate control, live edit claims,
    overwrite safety, and the true-actor audit trail.
- **Server-side enforcement** (the public `text/x-server-plugin` block in
  `index.html`) —
  - **Presence** — `netKey`/`sessionsForNet`/`netKey`-scoped rate limiting,
    `viewersOf`/`publishViewers` (focus is cleared and viewers re-published on
    close), `setFocus`, and the RPCs `rmmFocus`, `rmmViewers`,
    `rmmPresenceList`, `rmmConnStats`.
  - **Connection grouping & cap** — `hello` refuses a new session once the
    network bucket already holds `MAX_SESSIONS_PER_NET` (10) with
    `err:"net_full"`.
  - **Claims** — a `docClaims` Map with `claimActive`/`claimOf`/`releaseClaim`
    and the `rmmClaim`/`rmmRelease`/`rmmClaims` RPCs (`CLAIM_TTL_MS` = 15 min).
  - **True-actor audit** — `auditRemote(acting, action, ok)` records **both**
    allowed and denied remote actions (`collectorAdmin` calls it on allow and
    deny), exposed by the `rmmAudit` RPC.
  - **No silent overwrite** — `announce` refuses a **stale** or claim-held write
    (`{ok:false, conflict:true, …}`) and broadcasts `{t:"conflict"}` so every
    session is warned; the canonical store independently refuses a stale write.
- **Config** (`config.rmm`): `liveEnabled`, `livePresenceEnabled`,
  `liveAutoRefreshSeconds`, `livePanelHistory`, `rateLimitPerNetConnections`,
  `rateLimitActionsPerMinute`, `rateLimitClaimsPerMinute`, `docClaimsEnabled`,
  `docClaimTtlSeconds`, `auditRemoteActions`.
- **Wiring** — `index.html` loads `src/rmm.live.js` then
  `src/rmm.multiuser.js` after `src/rmm.access.js`; the topbar gained
  `#rmmLive`/`#rmmLiveDot`/`#rmmLiveText`; `src/erp.team.js` handles the
  `viewers`/`conflict` hub messages and pass-throughs the new RPCs;
  `src/rmm.master.js`'s access panel renders `ERP.multiuser.render` alongside
  `ERP.access.render`; `src/erp.css` gained the
  `.rmm-live-*`/`.rmm-mu-*`/`.rmm-device-presence` blocks.
- **Tests**: `await window.RMMLiveTest()` (26 checks) and
  `await window.RMMMultiUserTest()` (24 checks), both stub-backend with mock
  hub/event transports — the live/polling/offline mode + fallback, throttled
  watched-view refresh, focus announcement + viewer fan-out + `others`/
  `onViewers`, the realtime panel and presence RPCs; the hub-authenticated
  identity, grouped connection stats + limits, claims/`editGuard`/release, the
  true-actor audit + cursor + tail, conflict broadcast, the store's refusal to
  silently apply a stale write (the other user's change survives), the panel,
  and the server RPC/guard assertions. **The full RMM regression sweep is
  44 suites / 1,912 checks** (plus `RMMShellTest` at 49/0 — still 13 stations).

---

## Polish pass (post-review)

A full-code review pass fixed the concrete defects it surfaced. All RMM
regression suites stay green (**44 suites / 1,912 checks, 0 failures**).

- **Presence list no longer goes stale** — in `src/erp.team.js`, `T.peersList`
  and `T.hubIndex` were assigned *by value* once at init, while the internal
  `peers` array is reassigned on `hello` and `hubIndex` is sliced in
  `bumpIndex`. The exported references detached from the live arrays, so the
  topbar "N online" indicator under-reported after the first hello. Both are
  now live getters (`Object.defineProperty(T, "peersList", { get … })`),
  matching the existing `online`/`status`/`me` accessors. Confirmed with a
  second connected session: the indicator now tracks the hub.
- **Closing an unrelated modal no longer clears realtime focus** —
  `src/rmm.live.js` wrapped `ui.closeModal` to call `LIVE.blur()` on *every*
  close, silently dropping the viewed device (and this session's viewer entry)
  whenever any dialog closed. It now blurs only when the Realtime console
  panel itself was open; device focus survives unrelated modal closes.
- **Regression tests added** — `RMMLiveTest` now pins both fixes (23 → 26
  checks): `peersList`/`hubIndex` must be live getters (a data-property
  descriptor fails the check), and `ui.closeModal` must keep device focus when
  an unrelated modal closes while clearing it when the Realtime panel closes.
- **Production payload trimmed** — `src/erp.tests.js` (then 805 KB) and the
  seven dormant legacy ERP controllers are no longer `<script src>` tags in
  `index.html`. A small inline loader at the end of the body loads the test
  suite **on demand**: automatically while `window.generatorIsUnsaved`, or on
  any page whose query string contains `tests`; `window.rmmLoadTests()` loads
  it manually. The public (saved) page ships neither.
- **Legacy ERP removed entirely** — the seven controllers
  (`erp.crm/sales/purch/projects/finance/reporting/quality`, ~394 KB) and the
  thirteen legacy validation suites (`ERPStoreTest` … `ERPRecoveryTest`,
  ~155 KB) were deleted. Nothing referenced the controllers outside those
  suites, and the RMM-U stations fully replace them; the RMM sweep dropped no
  checks (44 suites / 1,912, all green). The "Business ERP" section below is
  kept as historical build-log only.
- **Shell header comment** updated from the old ERP nav list to the 13 RMM-U
  stations.

> Because the suites now load on demand, call `window.rmmLoadTests()` first if
> you are on a saved page without `?tests`; otherwise `window.RMM*Test` is not
> defined.

# Business ERP

> **HISTORICAL — the code this section documents no longer exists.** Its seven
> controllers (`src/erp.crm/sales/purch/projects/finance/reporting/quality.js`)
> and thirteen validation suites (`ERPStoreTest` … `ERPRecoveryTest`) were
> deleted in the post-review cleanup; the **RMM-U** stations replace them and
> nothing referenced them. Everything below is kept as build-log history only —
> do not treat it as a description of the current tree.

> Note (RMM-U rebrand): the storage namespace is now `rmm` — documents are
> `rmm-v1-<doc>` with the `rmm-doc` envelope and `rmm-v1-index` (see Task 2
> above). The legacy text below still says `erp-v1-`/`erp-doc`/`erp.store.v1.`
> in places; read those as `rmm-v1-`/`rmm-doc`/`rmm.store.v1.`.

A small-business ERP on Perchance — CRM & opportunities, sales (quotes → orders →
invoices), purchasing & inventory, projects & time, and double-entry bookkeeping,
all sharing one master-data core (parties, catalog, chart of accounts).

Generator: `business-erp` (https://perchance.org/business-erp). Built on the
`business-template` generator (config-driven marketing page) — the config list in
`main.pjs` is now the ERP's business-profile/branding data, and the page is the
ERP application shell.

## Build state

Task-by-task checklist lives in the comment block at the top of `main.pjs`
(Phases 1–10). Workflow: implement the first uncompleted task, add validation
tests, flip it to `[x]`, stop for review.

## Architecture

- `main.pjs` — pjs config lists (branding, theme, colors, product, `erp` app
  settings) + plugin imports (`super-fetch-plugin`, `data-visualization-plugin`,
  `upload-plugin`, `ai-text-plugin`).
- `index.html` — static ERP shell markup (sidebar, topbar, view container).
- `src/erp.js` — shell framework: module registry (`ERP.registerModule`), hash
  router (`#/moduleId`), role model (owner/manager/staff, `ERP.role`), state
  renderers (`ERP.states.loading/empty/error`), theme, responsive drawer.
- `src/erp.modules.js` — the 8 module definitions (Dashboard, CRM, Sales,
  Purchasing, Inventory, Projects, Finance, Reports). New modules register here
  via `ERP.registerModule({id, label, group, icon, roles, render})`.
- `src/erp.store.js` — the canonical document store (`window.ERP.store`):
  versioned `erp-doc` envelopes, one document per module (split by fiscal year
  for inventory & finance), fast localStorage cache, cached editable edit keys,
  monotone per-doc revision counter, 4 MiB write ceiling, throttled background
  refresh, dirty-flush retry, and a debounced store index. See "Task 2" below.
- `src/erp.sync.js` — Sync Center UI controller (Task 3): topbar sync button +
  conflict badge, attention banner, conflict modal (keep-mine / keep-theirs /
  merge, per-field decision picker), auto-commit on last field choice.
- `src/erp.ui.js` — shared UI toolkit (`ERP.ui`): `esc`, formatting
  (`fmt/money/pct/qty/date/dateTime`), `badge`/`statusBadge`, `btn`, `table`,
  `card`/`statCard`, `grid`, `tabs`, `modal`/`confirm`, form controls
  (`field/text/number/select/textarea/dateInput/check/radioGroup/form`),
  delegated `bind`, `pageHead`, `summary`, `alert`, `loading`,
  `stateEmpty/stateError`. Every module controller builds its UI through it.
- `src/erp.master.js` — master data service (Tasks 6–9): party directory
  (CRUD + merge-rewrites-everywhere), product catalog, chart of accounts, tax
  rates, posting defaults, business profile + document numbering
  (`master.allocateNumber(type)` → e.g. `INV-0001`), seeded idempotently at
  boot. Exposes `ERP.master.*` and `ERP.MASTER` doc ids; the chart/taxes/
  settings/parties/catalog/defaults/audit/archive UIs live in the visible
  modules (CRM parties tab, Finance chart/tax/settings tabs, Reports audit).
- `src/erp.backup.js` — backup & restore + capacity & archival (Tasks 4–5):
  `ERP.backup.backupBundle/downloadBackup/publishBackup/publishedBackup/
  validateBundle/restoreBundle`, `capacity()`, `archiveDoc/archivedDocs/
  viewArchived/restoreArchive`, and `renderPanel` (hosted under Reports).
- `src/rmm.tenancy.js` — **RMM-U tenant store** (`window.ERP.tenancy`, Task 2):
  each managed-service provider is a versioned aggregate document
  (`rmm-v1-provider-<id>`) holding its sites, device groups, devices, policies,
  monitor definitions, alerts, script library, patch/software state and
  automation rules, listed by a summary registry (`rmm-v1-providers`). CRUD
  (`create/update/save/archive/restore/remove`), collection helpers
  (`addItem/updateItem/removeItem/item`), `stats/validate/onChange`, and an
  idempotent first-run demo seed. `T.ready` resolves after the boot seed.
- `src/rmm.devices.js` — **device hierarchy & inventory** (`window.ERP.devices`,
  Task 3): the provider → site → device-group → device hierarchy, the rich
  device record (identity, OS, hardware, disks, network, users, tags,
  warranty/support, agent & last-seen, documentation link), filtering, the
  `tree`/`ancestry` projections, stats, derived attributes & liveness, group/
  site membership, `markSeen` agent check-in, and the Devices station UI
  (Fleet + Structure tabs, device detail/edit modals). See "Task 3" above.
- `src/rmm.master.js` — **master configuration** (`window.ERP.masterConfig`
  aliased `M`, Task 4): the schema-driven service that owns the eleven
  tenant-wide reference sections (severities, monitor types, channels,
  schedules, calendars, maintenance windows, patch classifications, software
  categories, tag & group taxonomies, script categories) as the
  `rmm-v1-config` document. CRUD + reorder/enable/default, id-resolving
  lookups, `refOptions`, business-hours/maintenance-window resolvers, an
  attributable change history, an idempotent seed, and the Admin console
  (`M.render` → the `admin` station; owner/manager editable, staff read-only).
  See "Task 4" above.
- `src/rmm.continuity.js` — **sync, conflict, backup & versioning**
  (`window.ERP.continuity`, `DC`, Task 5): startup reconciliation of the local
  cache vs canonical, a bounded per-document version-history ring
  (`rmm-v1-versions`, capture/compare/restore-with-pre-snapshot/prune/clear,
  wired into `store.saveDoc/put/forceSet/clearDoc`), one-click download +
  published backup with validated restore (via `ERP.backup`), capacity over
  every owned document (incl. tenant `provider-<id>` aggregates) with guided
  archival + tenant archive/restore, and the Reports "Data & continuity"
  console (`DC.render`). See "Task 5" above.
- `src/rmm.enrollment.js` — **enrollment & device identity**
  (`window.ERP.enrollment`, `E`, Task 7): the SHA-256 primitive, one-time
  (hashed-only) tokens bound to a provider/site/groups or to an existing device,
  the enroll handshake that exchanges a token for a durable (hashed-only)
  per-device credential, constant-time authentication, credential rotation,
  device revocation (refused on reconnect) and device-bound re-enrollment that
  re-keys the record in place. Persists in the hidden `rmm-v1-enrollment`
  document.
- `src/rmm.heartbeat.js` — **heartbeat, presence & capabilities**
  (`window.ERP.heartbeat`, `H`, Task 8): the authenticated check-in, clock-skew
  + agent-version + capability reporting, network-change detection with a
  bounded per-device history, per-device online/stale/offline presence and the
  tenant sweep that records presence transitions (the input to agent-offline
  alerts).
- `src/rmm.agent.js` — **agent packaging & installer generator**
  (`window.ERP.agent`, `AG`, Task 6): the platform + capability catalogues, the
  per-provider PowerShell / systemd / launchd installer generator (embedded
  collector address, provider identity, site/groups and a one-time token, boot
  service registration, first enroll + heartbeat, success/failure output with
  the device id), the download helper, and the Devices → Deploy console (token
  table, agent table, rotate/re-enroll/revoke). See "Tasks 6–8" above.
- `src/rmm.groups.js` — **device groups & tags** (`window.ERP.groups`, `G`,
  Task 18): static + rule-based dynamic groups over typed device/inventory
  conditions, the tag registry + bulk apply, membership evaluation, and the
  shared `matchTargets` targeting resolver (specificity device > tag > group >
  site > provider-wide) used by policies, monitors and dispatch. See
  "Tasks 18–20" above.
- `src/rmm.policies.js` — **policy engine** (`window.ERP.policies`, `P`,
  Task 19): sparse named policies across monitoring/patch/software/automation
  settings, targeted at devices via `matchTargets`, with an explicit precedence
  (priority → specificity → recency → id) and a per-setting effective-policy
  preview showing which policy supplied each value. See "Tasks 18–20" above.
- `src/rmm.monitors.js` — **monitor catalogue & engine** (`window.ERP.monitors`,
  `M`, Task 20): the 16-type catalogue (up/down, cpu, memory, disk, service,
  process, eventlog, application, port, web, script, snmp, agent, patch, av,
  backup) with settings/thresholds/defaults, per-group + per-device overrides,
  the pure threshold `evaluate`, and the "for N minutes" `assess` duration
  state machine. See "Tasks 18–20" above.
- `src/rmm.notify.js` — **notification service** (`window.ERP.notify`, `NOT`):
  severity/business-hours/cooldown-filtered notification queue with a hidden
  `notifications` doc and swappable transport, used by the automation
  `send-notification` action. See "Tasks 21–23" above.
- `src/rmm.schedules.js` — **schedules, business hours & maintenance windows**
  (`window.ERP.schedules`, `SCH`, Task 21): timezone-aware schedules (interval/
  daily/weekly/monthly/cron) + a cron matcher and next-run resolver, per-client
  business-hours calendars, scoped maintenance windows, severity suppression,
  the suppression audit log and the non-essential job deferral gate. See
  "Tasks 21–23" above.
- `src/rmm.scripts.js` — **script & component library** (`window.ERP.scripts`,
  `LIB`, Task 23): versioned scripts/components with typed parameters and per-OS
  variants, validated-then-shell-escaped substitution (`safeLiteral`, so a
  parameter can never inject commands), recursive component expansion with cycle
  detection, per-OS-family job dispatch and import/export. See "Tasks 21–23"
  above.
- `src/rmm.automations.js` — **automation engine** (`window.ERP.automations`,
  `AUTO`, Task 22): trigger → condition → action rules with dry-run preview,
  approval gating for destructive actions, maintenance deferral, cooldown, run
  history and event ingest/schedule sweeps. See "Tasks 21–23" above.
- `src/rmm.alerts.js` — **alert lifecycle** (`window.ERP.alerts`, `AL`,
  Task 24): the alert record + timeline with de-duplication, flapping
  suppression, severity escalation, acknowledge/resolve/auto-clear, snooze,
  maintenance suppression, device/site/group context, the assessment-state
  memory in `rmm-v1-alertstate` and the `scan` that drives the lifecycle from
  the monitor engine. See "Tasks 24–26" above.
- `src/rmm.routing.js` — **notification routing & escalation**
  (`window.ERP.routing`, `RT`, Task 25): recipients, severity/site routes,
  escalation policies, on-call rotations and digests in `rmm-v1-routing`, with
  delivery de-duplication, quiet hours and the escalation sweep. See
  "Tasks 24–26" above.
- `src/rmm.psa.js` — **PSA ticket integration** (`window.ERP.psa`, `PSA`,
  Task 26): alert → psa-u ticket creation + de-dup, device/configuration-record
  linkage, status sync both ways, auto-open on critical / auto-resolve on clear
  and the memory-only API token, in `rmm-v1-psa`. See "Tasks 24–26" above.
- `src/rmm.triage.js` — **alert triage workspace** (`window.ERP.triage`, `TR`,
  Task 27): the explainable priority model, the filterable/sortable/groupable
  prioritized queue, bulk acknowledge/assign/resolve/snooze through the alert
  lifecycle, and the volume / MTTA / MTTR / SLA response metrics, rendered as
  the Alerts station's **Triage queue** tab. See "Task 27" above.
- `src/rmm.patch.js` — **patch policy, scanning, compliance, deployment &
  audit** (`window.ERP.patch`, `PA`, Tasks 28–30): the deny-by-default
  patch-policy engine (per-OS/classification approvals, deferrals, deadlines,
  reboot policy, maintenance windows) with targeting + precedence and per-field
  provenance; agent-driven scanning (probe → report → derived) that classifies
  every missing patch through the effective policy and persists a compact scan
  record to `rmm-v1-patchscan`; compliance counting, ageing and rollups per
  device / group / site / provider, mirrored onto
  `device.custom.patchCompliance`; the optional alert bridge; deploying the
  approved plan as one agent job per device with per-patch `PATCHRESULT`
  attribution, automatic retry, before/after compliance capture and a
  policy-driven reboot queue; the auditable per-client compliance report + JSON
  export; and the four-tab Patches console. See "Tasks 28–29" and "Task 30"
  above.
- `src/rmm.software.js` — **software catalog, deployment & licensing**
  (`window.ERP.software`, `SW`, Tasks 31–33): the package catalog with per-OS
  install/uninstall/update/rollback command templates + detection rules and
  parameters; detection-driven action resolution (install/update/skip/
  uninstall/rollback/downgrade/blocked); one-agent-job-per-device deployment
  through the job queue with `SWSRESULT`/`SWDETECT` reconciliation and retry;
  per-device assignment compliance; owned-licence seat tracking with
  over-deployed/expired/unsanctioned reconciliation and an exportable
  per-client inventory report; the four-tab Software console, the package
  editor and the device-modal deployment section. See "Tasks 31–33" above.
- `src/rmm.security.js` — **security posture, compliance baselines & backup
  verification** (`window.ERP.security`, `SEC`, Tasks 34–36): the configurable
  endpoint-security check catalogue scored per device from `INV.snapshot`
  (`evaluateCheck`/`evaluateDevice`/`scan`/`postureRows`/`rollup`) with
  posture alerts; named baselines with priority/site/group targeting, effective
  baseline resolution, drift detection against live posture with capped drift
  history and accepted deviations; remediation hand-off to the automation engine
  via a `compliance.drift` trigger; backup expectations with last-successful-
  backup age/next-due tracking, `BACKUP_PRODUCTS` ingestion, missed/failed
  backup alerts and dated recovery-test confirmations; state on
  `provider.securityState` (added to `OBJECT_COLLECTIONS`); the three-tab
  Security console and the device-modal security section. See "Tasks 34–36"
  above.
- `src/rmm.remote.js` — **remote access & field actions** (`window.ERP.remote`,
  `REM`, Tasks 37–39): the browser remote terminal driving commands through the
  collector → agent job path (`openSession`/`runCommand`/`closeSession`/
  `sessionLog`) with role gating, a confirmation step, a configurable
  dangerous-command deny-list and clear no-output/timeout handling; the
  third-party remote-tool catalogue (`addTool`/`launchTool`/`createHandoff`)
  that launches pre-targeted sessions or generates per-device handoff links and
  records them against the device; and audited file push/pull
  (`pushFile`/`pullFile`) with a SHA-256 integrity trailer, size caps, chunking
  and an upload quarantine/permission check. State on `provider.remoteState`
  (added to `OBJECT_COLLECTIONS`); rendered as the Devices station's Remote
  sub-tab and the device-modal remote-access section. See "RMM Tasks 37–39"
  above.
- `src/rmm.dashboard.js` — **operational dashboards** (`window.ERP.fleet`,
  `FL`, Task 40): the tenant snapshot (device liveness, agent version spread,
  alert counts by severity/age, patch + security + backup compliance, monitor
  coverage, job success rate) and the per-tile `affected()` drill-down that
  resolves any number to its exact device list; rendered by `FL.render` as the
  Dashboard station (tone-coded tile grid + Agents tab + live event-bus toggle
  + device drill-down modal). See "RMM Tasks 40–42" above.
- `src/rmm.reporting.js` — **reporting** (`window.ERP.rmmReports`, `RP`,
  Task 41): seven report definitions with `RP.run` producing a versioned,
  schema-stable export (columns/rows/summary/totals) plus CSV/JSON download;
  scheduled runs (`reportschedules` doc, daily/weekly/monthly `nextRun`) and
  email/link deliveries (`reportdeliveries` doc, routed through `NOT.send`);
  rendered as the Reports station's Client reports / Report schedules /
  Deliveries tabs. See "RMM Tasks 40–42" above.
- `src/rmm.integrations.js` — **integrations & bus publication**
  (`window.ERP.integrations`, `INT`, plus the `window.ERP.api` facade,
  Task 42): consumes company/site/configuration records with explicit field
  ownership and drift detection; publishes device-health/alert events through
  the shared `rmm.event.v1` envelope via a signed sender with outbound
  webhooks; and produces a schema-stable `rmm.analytics.v1` extract (JSON or
  NDJSON) over six tables. State on `provider.integrationsState` (added to
  `OBJECT_COLLECTIONS`); rendered as the Integrations station. See "RMM Tasks
  40–42" above.
- `src/rmm.dataquality.js` — **data-quality linter** (`window.ERP.dataQuality`,
  `DQ`, Task 43): eight read-only checks (stale/offline agents, unassigned
  devices, devices without a policy, duplicate device records, orphaned groups,
  unrouted monitors, alerts that can never clear, unsafe script parameters)
  over one tenant or every tenant, each finding naming the offending record and
  the station that owns it. `DQ.scanProvider` is pure/synchronous; `DQ.scan` /
  `DQ.scanAll` load state and routes. Rendered as the Reports station's Data
  quality tab. See "RMM Task 43" above.
- `src/rmm.simulator.js` — **agent simulator & end-to-end fixture**
  (`window.ERP.simulator`, `SIM`, Task 44): deterministic agents with hardware
  profiles and temperaments that drive the real enrolment/heartbeat/inventory/
  metrics/jobs services; `SIM.fixtures` builds a whole tenant and
  `SIM.fullLoop` runs the canonical end-to-end scenario (breach → alert →
  route → automate → psa-u ticket → job answered → recover → auto-clear),
  returning a trace. Rendered as the Devices station's Simulator tab. See
  "RMM Task 44" above.
- `src/erp.team.js` — multi-user & realtime hub client (`ERP.team`, Tasks
  41–44): connects to the server hub in index.html, exchanges a hello for a
  server-authorised role, exposes `T.online/status/me`, `T.guard(action)`
  (server-side role authorization), `T.authAdmin(password)` (owner unlock),
  `T.setRole/removeUser/listUsers/peers/whoami/auditTail`, `T.signAudit`
  (signed audit entries through `master.audit`), `T.announceChange` (committed
  writes announce the new doc version) and `T.renderTeam` (Reports → "Team &
  access" tab + topbar state + #teamBtn modal). `T.setTransport(t)` lets tests
  swap in an in-memory hub.
- *(Removed — see "Business ERP" below)* the seven legacy controllers
  (`src/erp.crm.js`, `erp.sales.js`, `erp.purch.js`, `erp.projects.js`,
  `erp.finance.js`, `erp.reporting.js`, `erp.quality.js`, ~394 KB) and their
  13 validation suites were deleted. The RMM-U stations fully replace them and
  nothing referenced them; the historical docs are kept in the "Business ERP"
  section for reference only.
- `src/erp.tests.js` — validation suites; run with `await window.RMMShellTest()`
  (RMM Task 1), `await window.RMMTenancyTest()` (RMM Task 2),
  `await window.RMMDevicesTest()` (RMM Task 3),
  `await window.RMMMasterConfigTest()` (RMM Task 4, 81 checks),
  `await window.RMMContinuityTest()` (RMM Task 5, 50 checks),
  `await window.RMMAgentTest()` (RMM Task 6, 40 checks),
  `await window.RMMEnrollmentTest()` (RMM Task 7, 36 checks),
  `await window.RMMHeartbeatTest()` (RMM Task 8, 25 checks),
  `await window.RMMInventoryTest()` (RMM Task 9, 46 checks),
  `await window.RMMMetricsTest()` (RMM Task 10, 32 checks),
  `await window.RMMJobsTest()` (RMM Task 11, 53 checks),
  `await window.RMMDispatchTest()` (RMM Task 15, 42 checks),
  `await window.RMMEventsTest()` (RMM Task 16, 22 checks),
  `await window.RMMRetentionTest()` (RMM Task 17, 33 checks),
  `await window.RMMGroupsTest()` (RMM Task 18, 47 checks),
  `await window.RMMPoliciesTest()` (RMM Task 19, 26 checks),
  `await window.RMMMonitorsTest()` (RMM Task 20, 45 checks),
  `await window.RMMSchedulesTest()` (RMM Task 21, 35 checks),
  `await window.RMMScriptsTest()` (RMM Task 23, 42 checks),
  `await window.RMMAutomationsTest()` (RMM Task 22, 37 checks),
  `await window.RMMAlertsTest()` (RMM Task 24, 45 checks),
  `await window.RMMRoutingTest()` (RMM Task 25, 35 checks),
  `await window.RMMPsaTest()` (RMM Task 26, 24 checks),
  `await window.RMMTriageTest()` (RMM Task 27, 48 checks),
  `await window.RMMPatchPolicyTest()` (RMM Task 28, 41 checks),
  `await window.RMMPatchComplianceTest()` (RMM Task 29, 35 checks),
  `await window.RMMPatchDeployTest()` (RMM Task 30, 43 checks),
  `await window.RMMSoftwareTest()` (RMM Tasks 31–33, 56 checks),
  `await window.RMMSecurityTest()` (RMM Tasks 34–36, 60 checks),
  `await window.RMMRemoteTest()` (RMM Tasks 37–39, 82 checks),
  `await window.RMMDashboardTest()` (RMM Task 40, 23 checks),
  `await window.RMMReportsTest()` (RMM Task 41, 35 checks),
  `await window.RMMIntegrationsTest()` (RMM Task 42, 42 checks),
  `await window.RMMDataQualityTest()` (RMM Task 43, 60 checks),
  `await window.RMMSimulatorTest()` (RMM Task 44, 39 checks),
  `await window.RMMEndToEndTest()` (RMM Task 44, 30 checks — the full
  enrol → alert → automate → ticket → resolve loop),
  `await window.RMMAgentSecurityTest()` (RMM Task 45, 58 checks — enrolment
  token, credential, job isolation, replay/tamper, revocation, collector core
  and no-static-secret assertions),
  `await window.RMMStormTest()` (RMM Task 46, 69 checks — job timeouts,
  reconnect storms, flapping alerts, huge metric payloads, bulk dispatch,
  retention at scale, and the no-lost-alert/no-lost-job invariants),
  `await window.RMMAccessTest()` (RMM Task 48, 75 checks — role/cap
  catalogue, destructive caps, scope resolution, the hub-gated identity, the
  `can`/`require` predicate, grant CRUD and the server-side `guardAdmin` wiring),
  `await window.RMMLiveTest()` (RMM Task 49, 26 checks — live/polling/offline
  mode, throttled watched-view refresh, focus + viewer fan-out + `onViewers`,
  the realtime panel and the server presence RPCs),
  `await window.RMMMultiUserTest()` (RMM Task 50, 24 checks — hub-authenticated
  identity, grouped connection stats + limits, document claims/`editGuard`,
  the true-actor audit trail, conflict broadcast, the store's refusal to
  silently overwrite, the panel and the server RPCs).
  (The 13 legacy Business-ERP suites — `ERPStoreTest`, `ERPSyncTest`,
  `ERPBackupTest`, `ERPMasterTest`, `ERPCrmTest`, `ERPSalesTest`,
  `ERPPurchTest`, `ERPProjectsTest`, `ERPFinanceTest`, `ERPReportTest`,
  `ERPQualityTest`, `ERPTeamTest`, `ERPRecoveryTest` — were removed along with
  their controllers; see "Business ERP" below.)
- `src/template.css` — base design tokens + shared components (from
  business-template).
- `src/erp.css` — shell styles (sidebar, topbar, states, KPI cards, responsive).
- `src/template.js` — the marketing-page renderer from business-template,
  currently NOT loaded by index.html (kept for reference; its theme/panel
  utilities were folded into `src/erp.js`).

## Task 1 (done) — module shell & navigation

- Frame: header + side nav listing all 8 modules, grouped Operations / Finance.
- Role-aware visibility: `roles: []` = every role; finance/reports are
  `["owner","manager"]`. Role is a persisted local demo setting (topbar
  "Acting as") until server-authorised roles arrive in Phase 10; route guards
  redirect rather than just hide.
- Consistent states: `ERP.states.loading` (spinner), `empty` (icon + message +
  phase note + optional action), `error` (icon + message + retry) used by every
  module and the unknown-route 404 path.
- Responsive: fixed sidebar ≥1024px; off-canvas drawer + overlay <1024px.

## Task 3 (done) — sync, conflict & concurrency handling- **Sync model**: every document keeps a local *base watermark* — the exact
  canonical revision (`rev`, `updatedAt`, `updatedBy`) this device last read
  or wrote. Writes are compare-and-set: before overwriting a doc, the store
  reads the canonical revision and compares it to the base; if the canonical
  moved on (another device wrote while this one was offline), the write is
  refused with `{error:"conflict"}` rather than silently clobbering. The
  conflicted doc is parked (never auto-dropped) in a durable conflicts list
  (`LS.conflicts`) and surfaced in the UI.
- **Sync Center** (`src/erp.sync.js` + `#syncBtn`/`#syncBadge`/`#syncBanner`/
  `#syncModal` in index.html): topbar button (red badge = unresolved conflict
  count, spins while syncing), attention banner under the topbar while any
  conflict is open, and a modal listing conflict cards — human doc name,
  base/canonical revs, record counts — with three actions per conflict:
  *Keep mine*, *Keep theirs*, *Merge changes*. Sync runs at boot, on "Sync
  now", and every 60 s. The modal is a body-level sibling of `#app`, so
  full-page screenshots must capture `document.documentElement`, not `#app`.
- **3-way merge** (`threeWayMerge`): merges at *record* level using base =
  this device's last-known revision. Records changed on only one side are
  auto-taken; records changed on both sides (or added on both) surface as
  per-field conflicts needing a decision. Merging never drops a record that
  either side had. `resolveConflict(conflictId, "keep_mine"|"keep_theirs"|
  "merge")` commits the resolution; `merge` auto-commits when unambiguous,
  otherwise enters `needs_decisions` and each field is settled via
  `resolveFieldConflict(conflictId, key, which)`. The UI's field picker
  (My value / Their value chips) auto-commits once the last field is chosen.
- **Store API added**: `sync`/`syncDoc` (startup reconcile + manual),
  `conflicts`, `conflictFor`, `resolveConflict`, `resolveFieldConflict`,
  `setSyncListener`, `humanDocName`, `cachedDoc`, `pendingMerge`,
  `resetLocal`/`resetAllLocal` now also clear base/merge/conflicts state.
- **Known edges** (documented, not bugs): the editable layer's ~10 s read lag
  can produce *equal-rev, different-content* conflicts — surfaced as
  conflicts, never silent loss. Two devices writing within the lag window get
  a merge whose ancestor may be this device's own last write (slightly
  imperfect 3-way base, accepted trade-off). `flushDirty` skips conflicted
  docs; the dirty doc stays cached until resolved.
- **Tests**: `await window.ERPSyncTest()` (20 checks) in `src/erp.tests.js`,
  run against an in-memory fake backend (`makeServer()`) simulating two
  devices — avoids the editable layer's read lag entirely. Covers fast
  forward, offline-edit-then-push on reconnect, conflict-on-write refusal,
  conflict persistence, keep-mine/keep-theirs, unambiguous auto-merge, true
  field conflict → `needs_decisions` → per-field resolution, record-adds
  merge, `humanDocName`, and the sync report shape.

## Task 2 (done) — canonical document store

- Backend: `root.uploadPlugin.editable`, namespaced `erp-v1-<doc>[-<year>]`
  under the generator's own editable namespace, so records survive reloads and
  move across devices. Documents are versioned `erp-doc` envelopes
  (`schema`, `schemaVersion`, `doc`, `year`, `rev`, `updatedAt`, `updatedBy`,
  `records`).
- One document per data module, declared as `doc: {name, splitByYear}` on the
  module definition (`src/erp.modules.js`). Inventory & finance split by fiscal
  year (`splitByYear: true`), so growing documents stay under the ceiling;
  the rest stay in a single doc. `saveDoc`/`loadDoc` handle the split:
  `loadDoc(m, {year})` for one year, `{all:true}` merges every year in the
  index.
- Fast local cache (localStorage) serves reads instantly; the canonical copy
  is only written when something changes. Cached editable edit keys mean
  rewrites never lose the right to edit. `rev` is bumped from the newest
  revision this device has seen (cache, else canonical on a cold device), so a
  fresh device can't blindly overwrite another device's newer doc.
- Write ceiling `maxDocBytes` (4 MiB) — oversized writes are refused with
  `document_too_large` (message suggests splitting/archiving). Identical
  re-saves are idempotent no-ops. Failed/superseded canonical writes are
  retried by `flushDirty` from the local cache.
- Index (`erp-v1-index`) records every written document (bytes, recordCount,
  year, rev) — updated locally on write, synced to canonical debounced 600 ms.
- Gotcha: the editable layer's reads lag a write by ~10 s, so the tests assert
  index state from the synchronous local copy, not a force-refreshed
  canonical read. Tests use `erp-v1-test-*` docs + throwaway modules and clean
  local state in `finally`; `useBackend(null)` restores the real editable layer.
  API on `window.ERP.store`: `loadDoc/saveDoc`, `get/set`, `getIndex`,
  `refreshIndex`, `status`, `docName/docConfig/declaredDocs`, `fiscalYearOf`,
  `currentFiscalYear`, `useBackend`, `resetLocal/resetAllLocal`,
  `canonicalAvailable`, `fmtBytes`.

## Task 4+5 (done) — backup/restore + capacity & archival

- `ERP.backup.backupBundle()` collects every owned document (index + declared
  docs, byte-complete `erp-doc` envelopes) into an `erp-backup` bundle and
  never includes the backup doc itself. `downloadBackup()` saves it as a JSON
  file. `publishBackup()` force-writes the same bundle to the ERP's own
  namespace (`erp-v1-backup`); re-publishing with identical document content
  is a true no-op (exportedAt ignored). `publishedBackup()` reads it back for
  cross-device restore.
- `validateBundle()` schema-checks every document (skips anything not a
  versioned `erp-doc`); `restoreBundle(bundle, {allowPartial})` force-writes
  the valid ones (bypassing CAS deliberately) and resets the local cache.
- `capacity()` reports every declared module document's size/records/rev vs
  the 4 MiB ceiling. `archiveDoc(moduleId, year)` moves a closed period's
  records into the read-only archive (`erp-v1-archive-<year>`) and empties the
  live doc; `archivedDocs()/viewArchived()/restoreArchive()` list, view and
  restore (restore clears the specific archive year's doc, keeping the
  archive accurate). Archival is audited. UI: Reports → Data utilities.
- Store additions: `readCanonical(name)` (fresh canonical read), `forceSet`
  (bypasses CAS), `clearDoc(moduleId, year)`, `cachedDocNames()`. `store.set`
  /`forceSet` now wrap plain records with the module's logical doc name and
  always update the store index (local + debounced canonical), so ad-hoc docs
  written through them behave like module docs.
- **Tests**: `await window.ERPBackupTest()` (20 checks, fake backend) — bundle
  assembly/schema, validation of malformed docs, restore roundtrip
  byte-faithfulness, publish + idempotent re-publish, capacity rows vs
  ceiling, and the full archive → view → restore → entry-removed lifecycle.

## Task 6+7+8+9 (done) — master data & configuration

- `ERP.master` (in `src/erp.master.js`) is the single source for parties,
  catalog, chart of accounts, taxes, posting defaults and settings. All are
  persisted as module documents under `ERP.MASTER` ids (`parties`, `catalog`,
  `chart`, `taxes`, `defaults`, `settings`, `audit`, `archive`) and loaded
  through a memoised cache (`master.flush()` clears it — tests call this
  after switching backends).
- Parties: typed `customer`/`supplier`/`both`, with contacts, addresses, tax
  id, payment terms, credit limit, active flag. `master.mergeParties(fromId,
  intoId)` rewrites every `partyId`/`supplierId`/`customerId` reference across
  crm/sales/purchasing/projects/audit/finance docs and removes the merged
  party — one rename/merge updates the whole system.
- Catalog: `product`/`service` items with uom, default sale price, default
  cost, tax treatment, active flag. Chart: account codes/names/classes with
  defaults for AR (1100), AP (2000), inventory (1200), COGS (5000), sales
  revenue, tax collected (2100), tax paid (1300). Taxes: NONE/VAT0/VAT10/VAT20.
- Settings: business profile (company name, address, currency, fiscal-year
  start month, tax scheme) + per-type document numbering (prefixes QT/SO/INV/
  CN/PO/REC/BILL/PAY/PRJ/JRNL/BK, zero-padded counter). `master.allocateNumber(
  type)` bumps the counter CAS-style (keep-theirs on conflict) and returns the
  next number. `master.seed()` is idempotent and runs at boot.
- `master.audit({action, targetType, targetId, summary})` appends a
  chronological, read-only audit entry (split by fiscal year); `auditLog()`
  reads it back.
- **Tests**: `await window.ERPMasterTest()` (17 checks) — idempotent seed,
  party CRUD with full profile, merge rewriting across real module docs (crm/
  purchasing) + directory cleanup, catalog CRUD, chart/tax/defaults seeding,
  settings persistence + no-op re-seed, and audit log capture.

## Task 10+11+12+13 (done) — CRM module

- `ERP.crm` (in `src/erp.crm.js`) is the CRM controller. It keeps two kinds of
  records in the `crm` doc (single, not split by year): `record` (a per-party
  CRM record) and `opportunity` (a pipeline deal). `ERP.crm.records()` is the
  cached read; `C.invalidate()` clears the cache (call after any external
  write, e.g. `mergeParties`). `byKind(list, kind)` splits the two kinds.
- **Parties tab** (Task 6 UI): typed customer/supplier/both directory with
  contacts, addresses, tax id, payment terms, credit limit and active flag;
  add/edit/merge/deactivate all operate through `master.saveParties` /
  `master.mergeParties`, so one rename/merge updates the whole system.
- **CRM records tab** (Task 10): records with source (website/referral/event/
  cold call/ad/partner/other), owner, status (new/contacted/active/inactive),
  tags, first contact, notes, a chronological activity timeline (add notes
  inline) and dated reminders with a "Reminders due" summary + overdue banner.
  A per-party detail modal shows the party's opportunities and activity.
- **Pipeline tab** (Tasks 11–12): stages lead → qualified → proposal → won/
  lost. Board view (column per stage with counts + totals and move ‹/›
  buttons), list view, filters by owner/party/search, per-party history via
  the opportunity detail modal, and timestamped `wonAt`/`lostAt` when a deal
  closes. `ERP.crm.wonToProject(opp)` turns a won opportunity into a project
  record (`projects` doc, `source: "opportunity:<id>"`) — deduplicated, so
  calling it twice never creates a second project.
- **Ports tab** (Task 13): `ERP.crm.parseIdeas(raw)` flexibly parses an
  idea-incubator bundle (`{ideas:[{title,summary,tags,category,partyName,
  value}]}` or a bare array) and `ERP.crm.importIdeas(ideas, recs, parties)`
  imports each idea as a CRM record + a **qualified** pipeline lead; ideas
  naming a known party link to it, unknown names create a party. Won
  opportunities export as a project-seeds bundle (download / clipboard).
- **Tests**: `await window.ERPCrmTest()` (14 checks, fake backend) — record
  lifecycle, stage moves + wonAt stamping, won→project handoff + dedupe,
  bundle parse/import (records + qualified leads + party reuse/creation),
  and merge-rewrites-crm-references.

## Task 14+15+16+17+18 (done) — Sales module

- `ERP.sales` (in `src/erp.sales.js`) is the sales controller over the `sales`
  doc (single, not split by year). `S.records()` is the cached read,
  `S.invalidate()` clears it; `S.byKind(list, kind)` splits quotes / orders /
  invoices / credit notes. Line + doc math: `S.lineTotals(l)` and
  `S.computeTotals(lines)` (subtotal − discount + tax).
- **Catalog tab** (Task 7 UI): product/service catalog with sku, uom, default
  sale price, default cost and tax treatment — stored in master data via
  `master.saveCatalog`, shared with purchasing/inventory later.
- **Quotes tab** (Task 14): catalog line items with a manual line editor
  (item autofill, per-line discount %, auto tax from the party-inherited tax
  codes), validity/expiry, states draft → sent → accepted / declined.
  `S.sendQuote` stamps `sentAt`, `S.declineQuote` stamps `declinedAt`;
  `S.acceptQuote` converts a sent quote into a sales order without retyping
  (source + quoteId/quoteNum kept, quote marked accepted with
  `acceptedOrderId`). `S.createQuote`/`S.updateDoc` persist form data.
- **Orders tab** (Task 15): sales orders entered directly or from an accepted
  quote; per-line fulfillment (shipped/delivered/invoiced/backordered),
  delivery promise dates, status stamps open → confirmed → shipped →
  delivered → invoiced. `S.recordShipment`/`S.recordDelivery` take a
  `{lineNo: qty}` map (partial quantities allowed); the status advances only
  when every line is complete. `S.confirmOrder` is the stock gate (see 17).
- **Stock checks & backorders** (Task 17): `S.confirmOrder` calls
  `ERP.inventory.available(itemId)` when the inventory module exists (Phase 5;
  `Infinity` until then), splits shippable vs backordered, sets
  `order.hasBackorder` + per-line `qtyBackordered`, and calls
  `S.raiseShortfall(order, backordered)` which drafts a PO
  (`kind: "po"`, `source: "shortfall"`, linked to the order) into the
  purchasing doc. Backorders are relieved in order-date order as goods
  receipts land (wired up in Phase 5).
- **Invoicing** (Task 16): `S.invoiceFromOrder(order, qtyMap)` invoices
  selected delivered lines (partial invoicing allowed), computes the due date
  from the party's payment terms (immediate/net15/30/60/90), posts the
  invoice with order + party refs, marks lines `qtyInvoiced` and stamps the
  order invoiced when complete. `postInvoice()` calls
  `ERP.finance.postSalesInvoice(inv)` when the Phase-7 finance module exists
  (no-op until then).
- **Credit notes** (Task 18): `S.createCreditNote(inv, amount, reason)` — a
  reason is required, amount cannot exceed what's left (total − credited −
  paid); marks the invoice credited/partially_credited and calls
  `reverseInvoice(cn)` → `ERP.finance.reverseInvoice` (guarded until Phase 7).
- **Tests**: `await window.ERPSalesTest()` (25 checks, fake backend) — totals
  math, quote lifecycle + errors, accept→order, confirm with a stubbed
  `ERP.inventory.available` forcing backorders + shortfall PO in purchasing,
  ship/deliver/invoice, credit-note validation and full credit, direct-order
  numbering, and delete.

## Task 19+20+21+22+23 (done) — Purchasing & Inventory

- `ERP.purchasing` + `ERP.inventory` (in `src/erp.purch.js`, one IIFE exposing
  both controllers). Purchasing data lives in the `purchasing` doc (single),
  inventory movements in the `inventory` doc (`splitByYear: true`, so reads
  use `{all: true}`). Both have cached reads + `invalidate()`.
- **Movement log & derived stock** (Task 19): inventory is an append-only
  movement log — `I.postReceipt/postIssue/postOpening/postAdjustment/
  postTransfer` each append a movement (type, itemId, location, qty, unitCost,
  date, refType/refId/refNum, note). Current quantity is always derived from
  the log, never free-edited. `I.stock()` returns per-product rows with on-hand
  qty per location, moving-average cost, value and reorder point;
  `I.available(itemId)` = on-hand; `I.valuation()` totals by type.
- **Moving-average cost & COGS** (Task 23): receipts/openings update the
  weighted average; issues/adjustments keep it (issues cost at the then-current
  average, i.e. COGS); transfers are valuation-neutral. `postReceipt` also
  auto-relieves any backorders for that item (`I.relieveBackorders`) in
  order-date order.
- **Purchase orders** (Task 20): `P.createPO(data)` (lines required, totals
  stored, `PO-xxxx` numbering), `sendPO` (draft→sent), `deletePO` (draft/sent
  only), `receivePO(po, qtyMap)` — per-line receipt posts stock-in at purchase
  cost, auto-relieves backorders, and creates the supplier bill from the goods
  receipt in the same action. PO status advances received/partial.
- **Bills & supplier payments** (Task 21): `createBillFromPO(po, received)`
  (from goods receipt) or `createBill(data)` (direct, due date from supplier
  terms), `payBill(bill, amount, method, date, ref)` (partial/full, never
  overpay), `supplierBalance(supplierId)` ties to open bills.
- **Reorder suggestions** (Task 22): `I.reorderSuggestions()` lists products
  with `reorderPoint > 0` currently below it (suggested qty = reorder point,
  supplier/unit cost/tax from the catalog); `I.createReorderPOs(suggestions)`
  groups by supplier into draft POs (`source: "reorder"`) ready to send.
- **Ledger hooks**: goods receipts/bills/payments/inventory movements call
  `ERP.finance.postGoodsIn/postGoodsOut/postInventoryAdjustment/postBill/
  postSupplierPayment` (guarded; since Phase 7 these post for real, and
  always before the source doc saves). Sales shipments post their own stock
  issue at moving-average cost via `I.postIssue`.
- **Tests**: `await window.ERPPurchTest()` (29 checks, fake backend) — movement
  log + derived stock/valuation/available, PO lifecycle (draft→send→receive →
  stock-in + auto supplier bill + payment), backorder relief on receipt (with
  the COGS issue movement at moving-average cost), reorder suggestions → PO,
  direct bills + partial/full payments + supplier balance, and guards
  (unsent PO can't be received, overpay rejected, received PO can't be
  deleted).

## Task 24+25+26+27 (done) — Projects, time & service delivery

- `ERP.projects` (in `src/erp.projects.js`) is the projects controller over
  the `projects` doc (single, not split by year). `P.records()` is the cached
  read, `P.invalidate()` clears it; `P.byKind(list, kind)` splits projects /
  milestones / tasks / timeEntry / expense records.
- **Projects** (Task 24): `P.createProject(data)` (title required, `PRJ-xxxx`
  numbering, linked to a party and optionally a sales order, budget,
  currency, start/end dates, description, tags, status), `updateProject`,
  `setProjectStatus` (planned/active/on_hold/completed/cancelled — each
  transition is recorded on the project activity timeline). Milestones sit
  under projects with a billing value, status (planned/in_progress/completed/
  cancelled) and planned/due dates.
- **Tasks & timesheets** (Task 25): tasks under a project (optionally under a
  milestone) with assignee, due date, estimated hours, states todo/in_progress/
  done. Time entries carry date, hours, billable flag, billable rate, loaded
  cost-per-hour, note; `P.projectTimeTotals` rolls up hours / billable hours /
  billable value / unbilled backlog. The Tasks tab is a cross-project view with
  filters (project/status/assignee + overdue badges); Timesheets tab is the
  cross-project time ledger.
- **Expenses & progress billing** (Task 26): `P.addExpense` (category, amount,
  vendor, optional supplier-bill link) plus `P.deleteExpense`. `P.progressInvoice(
  project, {mode: "milestones"|"time", ids})` generates a progress invoice
  from completed, uninvoiced milestones (with a billing value) or billable,
  uninvoiced time (aggregated by task) — written into the **sales** doc as a
  regular invoice (`kind: "invoice"`, `source: "project"`), so it shares the
  same numbering, due-date-from-party-terms logic and guarded
  `ERP.finance.postSalesInvoice` hook as sales invoices, and appears in
  Sales → Invoices and AR aging. Milestones/time entries are stamped with the
  invoice so double-invoicing is rejected.
- **Profitability** (`P.projectMetrics`): billed = progress-invoice total in
  the sales doc only (never double-counted), unbilled = uninvoiced billable
  time × rate, cost = expenses + labour (hours × loaded cost), profit =
  billed − cost, plus % of budget billed, milestone/task completion counts and
  the invoice list.
- **Timeline & ports** (Task 27): every project keeps a chronological activity
  timeline (`P.projectTimeline`). `P.exportBundle()` publishes an
  `erp-project-bundles` JSON; `P.ingestBundle()` ingests
  `erp-project-seeds` (from CRM won opportunities), `erp-project-bundles` and
  `erp-ledger-receipts`, matching by source key / projNum so re-imports never
  duplicate.
- **Tests**: `await window.ERPProjectsTest()` (44 checks, fake backend) —
  project/milestone/task/time/expense lifecycle + validation, metrics math
  (incl. billed-no-double-count, cost = expenses+labour, unbilled tracking),
  milestone & time progress invoicing (stamps, rejects, lands in the sales
  doc, due-date from party terms), timeline chronology, export/ingest with
  dedupe, and cross-call invoice protection.

## Task 28+29+30+31+32 (done) — Finance: ledger, AR/AP, bank & period close

- `ERP.finance` (in `src/erp.finance.js`) is the finance controller over the
  **finance** doc (split by fiscal year — every journal carries a `date`, so
  postings land in the right year). `F.records()` is the cached read,
  `F.invalidate()` clears it; `F.journals({from,to,source,account})` filters
  and sorts the journal.
- **Double-entry journals** (Task 28): `F.postJournal({date,memo,source,refType,
  refId,refNum,lines})` — every posting is a balanced set of debit/credit lines
  (`lines.length ≥ 2`, debits must equal credits within 0.01, every account must
  be on the chart), auto-numbered `JRNL-xxxx` with a `period` (YYYY-MM). Posted
  entries are immutable; `F.reverseJournal(j, reason, {date})` posts a negated
  reversing entry and stamps `reversedBy`/`reverses` (double reversal rejected).
- **Automatic postings map** (Task 29) — guarded cross-module hooks that fire
  when `ERP.finance` exists, and always POST BEFORE the source doc saves so a
  posting failure throws (naming the offending document) and stops the action:
  `postSalesInvoice` (Dr AR / Cr revenue per line — 4000 sales vs 4100 service/
  project — Cr tax collected), `reverseInvoice` (credit note, scaled),
  `postGoodsIn` (Dr Inventory / Cr AP), `postGoodsOut` (Dr COGS / Cr Inventory
  at moving-average cost), `postInventoryAdjustment`, `postOpening`,
  `postSupplierBill` (from-receipt bills book only input VAT so AP ties to the
  bill total; direct bills Dr Inventory/Expense + input VAT / Cr AP),
  `postSupplierPayment` (Dr AP / Cr Bank), `recordCustomerReceipt` (Dr Bank /
  Cr AR, writes back `amountPaid` and flips invoices to `status:"paid"`).
  All are idempotent via `findPosting(refType, refId)`.
- **Receivables & payables** (Task 30): `F.receivableAging()`/`F.payableAging()`
  return `{rows, totals}` bucketed current/1-30/31-60/61-90/90+ with overdue
  totals; `F.customerStatement(partyId)`/`F.supplierStatement(supplierId)` are
  chronological running-balance statements (receipts/payments negative).
  `F.recordCustomerReceipt` applies a payment to one or more invoices (partial /
  split), rejects over-allocation and sum mismatches.
- **Bank & cash** (Task 31): `F.addBankEntry({type:deposit|withdrawal, ...})`
  posts bank journal entries; `F.bankRegister()` derives the register (every
  journal touching the bank account, running balance, chronological);
  `F.markCleared(journalId, cleared, statementRef)` implements statement
  matching so reported cash reconciles to the bank statement.
- **Period close & financial statements** (Task 32): `F.trialBalance({from,to})`
  (per-account net debit/credit + totals + drill-down), `F.profitLoss(...)`,
  `F.balanceSheet({asOf})` (A = L + E + current earnings). `F.closePeriod("YYYY-MM",
  reason)` locks the period, rolls income/expense to retained earnings via a
  closing journal, and marks every journal `periodClosed`; `F.reopenPeriod`
  reverses the closing journal (dated in the same period) and removes the lock.
  Posting into a closed period is blocked. The module also hosts the Chart of
  accounts / Tax / Settings tabs: `F.chartAccounts()/saveChart()`,
  `F.taxRates()` (= master.taxes).
- **UI**: `F.renderPanel` renders 8 tabs (Ledger / Receivables / Payables /
  Bank / Reports / Chart / Tax / Settings), each with its own render function;
  the Finance nav module wraps it (`F.render = F.renderPanel`).
- **Tests**: `await window.ERPFinanceTest()` (54 checks, fake backend) — journal
  semantics + reversal audit trail, the full posting pipeline with a trial
  balance that ties out (820/820), P&L + balance sheet (A = L + E), AR/AP aging
  + statements + partial/split receipts + allocation errors, bank register +
  statement matching, period close/reopen (net income −100, closing journal,
  closed-period lock/unlock), project-invoice → service revenue, direct bills,
  idempotent re-posting, and chart/tax CRUD.

## Task 33+34+35+36 (done) — Dashboard, reports & data utilities

- **Dashboard KPIs** (Task 33): `ERP.dashboard.kpis()` computes cash (bank
  register), receivables/payables totals + overdue, open orders/POs/bills,
  revenue this month vs last, stock value, low-stock (catalog items past their
  reorder point with no/insufficient on-hand), and top customers by invoiced
  revenue. The dashboard grid renders each KPI as a `statCard` that
  deep-links to its source module tab (`#/finance:bank`, `#/sales:orders`,
  …) via the hash-tab router; the "Needs attention" panel lists overdue
  invoices/bills and low-stock alerts; recent activity shows the latest audit
  entries. `renderPanel` is `render` for the Dashboard nav module.
- **Report library** (Task 34): `ERP.reports` seeds 8 definitions into the
  `reports` doc (id/title/desc/module/type). `R.runReport(def)` returns
  `{title, subtitle, columns, rows, summary}` for sales by period/customer/
  product, purchasing spend, project profitability, aged receivables,
  inventory valuation and tax summary. The Reports tab lists them as cards;
  each Run opens a modal table, Export CSV downloads via `R.toCsv` +
  `R.downloadCsv`, Print renders into `#erpPrintArea` (`@media print`).
- **Guided CSV import** (Task 35): `R.prepareImport(kind, text)` parses
  (quoting-aware, header-mapped) and validates every row — parties (name
  required, dup check, creditLimit via headers), catalog (tax-code + sku-dup
  checks), stock-counts (resolves items by SKU, unknown-item flagged) and
  opening-balances (unknown account, unbalanced = fatal). The Import tab shows
  a preview table with per-row OK/Error badges before anything is committed;
  `R.applyImport` commits only valid rows and audits the result. Stock counts
  post opening-style movements; opening balances post one balanced journal.
- **Audit log** (Task 36): `master.audit({action, summary, targetType,
  targetId, meta})` appends (never throws; split by year) and
  `master.auditLog({all:true})` merges all years. The Audit tab is read-only,
  sorted newest-first, with a free-text filter (`R.filterAudit` matches
  summary/actor/action/target) and per-action counts. Every state-changing
  action across the app calls `master.audit`.
- **Hash-tab deep-linking**: `navigate("module:tab")` sets `#view.__tab` and
  `onHashChange` parses `#/module:tab`; module renderPanels read `el.__tab` to
  open the right tab on load.
- **Tests**: `await window.ERPReportTest()` (50 checks, fake backend) — full
  setup pipeline, every KPI value (cash 1000, AR 540/300 overdue, AP 620/500
  overdue, open orders/POs/bills, revenue 200 vs 0, stock 5000, Gizmo
  low-stock, top customers Zeta→Acme), deep-link navigation, all 8 reports,
  CSV parse/export round-trips, all 4 import kinds (+ re-import dup detection,
  unbalanced-fatal), and audit search semantics.

## Task 37+38+39 (done) — system health, fixtures & error copy

- **Accounting invariants** (`Q.invariants()` in `src/erp.quality.js`): seven
  checks — every posted journal sums to zero; the trial balance is balanced;
  AR ties open invoices to the AR ledger; AP ties open bills to the AP ledger;
  inventory value ties to the movement log; the bank register ties to the bank
  ledger; and the balance-sheet identity holds (A = L + E). Returns
  `{ok, failCount, errorCount, checks:[{key,label,status,detail}], ranAt}` and
  never throws. Each check carries a recovery `nextStep` from `Q.guide(key)`.
- **Auto re-check** (Task 37): every finance mutator (`postJournal`,
  `reverseJournal`, `postSalesInvoice`, `reverseInvoice`, `postGoodsIn/Out`,
  `postInventoryAdjustment`, `postOpening`, `postSupplierBill`,
  `postSupplierPayment`, `recordCustomerReceipt`, `addBankEntry`, `markCleared`,
  `closePeriod`, `reopenPeriod`) is wrapped transparently at boot so a
  successful posting schedules a debounced (800 ms) `Q.check()`. The result
  drives the topbar health dot (`#healthDot` — green/amber/red/gray, in
  `index.html` next to the sync button) and the Reports → System health tab
  (`Q.renderHealth`, a summary + per-check table with "If it fails" guidance
  and a Run-checks-now button). `Q.setAuto(false)` disables the auto re-check
  (tests rely on it).
- **Friendly error copy** (Task 39): `Q.friendlyError(e)` recognises
  `document_too_large`, quota/over_daily_allowance, lost edit key, offline
  divergence, corrupt/schema-mismatched documents, unbalanced entries and
  storage-unavailable failures and returns `{title, message, nextStep}` in
  plain language — anything unrecognised falls back to a generic message that
  still tells the user to back up first.
- **Fixtures** (Task 38): `Q.FIXTURES.docs` provides valid records for every
  module document (parties, catalog, chart, taxes, defaults, settings, crm,
  sales, purchasing, inventory, projects, finance, audit, archive);
  `Q.FIXTURES.olderSchema(moduleId)` builds an earlier-pipeline `erp-doc`
  (schemaVersion 0, records missing the fields the current pipeline writes);
  `Q.FIXTURES.malformed` covers bad JSON, non-ERP documents, missing record
  arrays, and unbalanced/unknown-account journal entries. `Q.FIXTURES.setup()`
  seeds a complete world (customer, supplier, product, opening stock, opening
  cash) and `Q.FIXTURES.chain(refs)` drives the full quote → order → delivery →
  invoice → payment chain, verifying the books stay tied (invoice 360, payment
  settles it, bank 10360, all seven invariants green).
- **Tests**: `await window.ERPQualityTest()` (71 checks, fake backend) — clean
  invariants, chain invariants, unbalanced-entry detection + recovery, auto
  re-check, all error-copy cases + generic fallback + per-check guides,
  older-schema tolerance in store & master, malformed JSON → `corrupt_document`,
  validateBundle rejection/partial, document_too_large refusal,
  backup/restore round-trip (undoes a temp write), sync conflict + keep-theirs,
  the system-health UI (dot turns green, Reports → System health table ≥ 7
  rows), and a save/load fixture round-trip for every module document.

## Task 41+42+43+44 (done) — multi-user & realtime team hub

- **Server hub** (in `index.html`, the `<script type="text/x-server-plugin">`
  block): authoritative registry of users (hello → staff by default), roles
  (0 staff / 1 manager / 2 owner), the SHA-256 of a single admin password
  (`authAdmin`), server-side `authorize` per action (each sensitive action maps
  to a minimum role), a signed audit ring (seq, ts, role, user, action) that
  broadcasts `audit` events to managers+, an announce/index/`chg` fan-out for
  document-version changes, `peers`/`listUsers`/`setRole`/`removeUser`
  (owner-only), and coarse per-connection rate limiting grouped by network
  signal. The hub holds *identity and version metadata only* — document
  payloads stay in the editable store, so a compromised client cannot read or
  write other users' data through the hub itself.
- **Role & access model** (Task 41): the client's `ERP.role` is *overridden by
  the server* on connect — the topbar "Acting as" selector is locked while the
  hub is online. Every guarded action calls `T.guard(action)` before it runs;
  the hub authorises by role, so hiding buttons is never the security boundary.
  Guarded actions: `post_journal`, `reverse_journal`, `receive_payment`,
  `bank_entry`, `clear_bank`, `close_period`, `reopen_period`, `chart_update`,
  `tax_update`, `settings_update`, `defaults_update`, `pay_bill`,
  `restore_backup`, `publish_backup`, `archive_doc` (all manager+);
  `credit_note`, `invoice_from_order` (staff+).
- **Signed audit** (Tasks 44): `master.audit` routes through `ERP.team.signAudit`
  when online — the hub returns a signed `{id, actor, userId, role}` and the
  entry is recorded as verified; denied actions are recorded as
  `denied:<action>` with a "Rejected by the team server…" summary. The finance
  and master mutators (`postJournal`, `markCleared`, `saveChart`, `saveTaxes`,
  `saveSettings`, `payBill`, restore) now audit through the hub so the true
  actor is captured even in multi-user mode.
- **Realtime concurrency** (Tasks 42–43): committed writes call
  `T.announceChange` → the hub records the new doc version and broadcasts
  `chg`; every connected client re-syncs that document from the canonical
  store (the same version-checked CAS layer as Task 3), so two users on the
  same record see each other's saved changes live with a "changed" marker.
  When the hub is unreachable the app degrades gracefully to local mode —
  guards no-op, writes proceed unverified, and the sync/conflict machinery
  handles convergence on reconnect.
- **Admin unlock & first-time setup**: the owner authenticates once per
  session via the Team modal ("Unlock as owner") with the admin password
  (plaintext is given to the owner in chat and stored nowhere — only its
  SHA-256 hash lives in the server block; the hash is acceptable because the
  password is a long random string, not a human-chosen one). `authAdmin`
  grants the *connection* owner rights and promotes the local role.
- **Editable edit-key self-healing** (`ERPRecoveryTest`, 12 checks): if the
  editable layer reports `edit_key_required` (the cached edit key was lost —
  e.g. another device re-created the document), the store adopts a fresh
  random editable name, keeps a `erp.store.v1.alias.<name>` → real-name map in
  localStorage, and reads/writes resolve through the alias, so the app recovers
  with no data loss. The real store namespace the alias points at is preserved.
- **Tests**: `await window.ERPTeamTest()` (27 checks) runs the client against
  an in-memory hub mirroring the index.html protocol — hello/role bootstrap,
  staff-guard rejection vs owner pass, admin unlock + bad password, owner
  registry management (demote/promote/remove), signed audit entry + server ring
  + denied audit, live `chg` re-sync from canonical, committed-write announce
  (a real, non-noop write), and offline degradation (guard no-op + journal
  still posts locally). `await window.ERPRecoveryTest()` (12 checks) simulates
  edit-key loss against a fake editable backend and verifies alias recovery.

## User workflow per module (the day-to-day playbook)

**Dashboard** — the landing view. Read the KPI grid: cash, receivables,
payables, open orders/POs/bills, this month's revenue vs last, stock value and
low-stock alerts, top customers. Click any KPI card to jump to the module tab
that produced it. Act on the "Needs attention" panel (overdue invoices/bills,
low stock) and the recent-activity feed.

**CRM** — start with the **Parties** tab: add customers and suppliers (typed,
with contacts, payment terms, credit limits; merge duplicates to rewrite every
reference in one step). The **CRM records** tab tracks leads/accounts with an
owner, status and a dated activity timeline + reminders. The **Pipeline** tab
is the deal board: drag (‹/›) opportunities through lead → qualified →
proposal → won/lost; a won deal becomes a project in one click. **Ports**
imports idea bundles from the idea incubator as qualified leads.

**Sales** — the **Catalog** tab holds products/services (default prices and tax
treatment). **Quotes**: build a quote from catalog lines (discounts, auto-tax),
send it; an accepted quote becomes an order without retyping. **Orders**: track
per-line fulfillment (ship/deliver/invoice); confirming an order checks stock
and flags backorders — a shortfall auto-drafts a PO. **Invoices**: invoice
delivered lines (partial allowed), due date from the customer's terms;
**Credit notes** require a reason and reverse the ledger.

**Purchasing & Inventory** — **Purchase orders**: draft → send → receive;
receiving posts stock in at purchase cost, auto-relieves backorders and raises
the supplier bill. **Bills & payments**: pay bills fully or partially (never
overpay); supplier balances tie to open bills. **Stock**: the movement log
receipts/issues/openings/adjustments/transfers drives on-hand quantity,
moving-average cost and valuation; **reorder suggestions** draft POs for items
below their reorder point.

**Projects** — set up a project (linked to a party, budget, dates, tags), add
milestones (with billing values) and tasks, log time and expenses. When work is
done, **progress invoice** bills completed milestones or billable time straight
into Sales as a regular invoice (double-invoicing is rejected); the
profitability panel shows billed vs unbilled vs cost.

**Finance** — the **Ledger** tab is the double-entry journal (auto-numbered,
immutable, reversal via a negated entry with a reason). **Receivables** /
**Payables** show aging buckets and per-party statements; record customer
receipts by applying payments to one or more invoices (partial/split allowed).
**Bank**: add deposits/withdrawals, read the derived register, mark statement
lines cleared to reconcile. **Reports**: trial balance, P&L and balance sheet
(every posting flows in automatically from sales/purchasing/inventory). Close a
period when done; posting into a closed period is blocked.

**Reports** — run the 8 saved report definitions (sales by period/customer/
product, purchasing spend, project profitability, aged receivables, inventory
valuation, tax summary), export any to CSV or print. **CSV import** previews
every row with per-row errors before committing (parties, catalog, stock
counts, opening balances). **Audit log** is the read-only, searchable history
of every state-changing action. **Backup & restore** downloads/publishes a full
bundle, restores it, archives closed fiscal years to keep documents under the
ceiling, and shows capacity. **System health** runs the seven accounting
invariant checks (also surfaced as the topbar dot) with recovery guidance per
check.

**Team & access** (Reports → Team & access, plus the topbar hub dot and
#teamBtn modal) — the hub connects automatically; the dot shows online/amber/
offline and the topbar "Acting as" role is server-authorised while online. The
owner unlocks once per session with the admin password (Team modal), then can
promote/demote staff↔manager↔owner and remove users; the access tab shows who's
online, the identity, and the signed audit ring. Staff see their own status and
identity; manager+ actions are authorised by the hub, denied actions are
recorded as denied in the audit log, and remote edits to the same record appear
live (with a changed marker) via the version-change fan-out.

## Adding a new ERP module (the full playbook)

1. **Register the module** — add `ERP.registerModule({id, label, group,
   icon, roles, render})` to `src/erp.modules.js`. `group` is `ops` or `fin`
   (or absent for a top-level module); `roles: []` means every role, otherwise
   an explicit list. It appears in the nav and router automatically — no other
   wiring.
2. **Declare the document(s)** — set `doc: {name, splitByYear}` on the module
   definition. One document per data module, `erp-v1-<name>` (add `-<year>` and
   `splitByYear: true` when records accumulate, e.g. movements, journals, audit
   — fiscal-year partitioning keeps documents under the 4 MiB ceiling).
   Everything else (cache, edit keys, revisions, conflict handling, index,
   dirty-flush) comes free from `src/erp.store.js`.
3. **Add document numbering** — if records carry human-readable numbers, add a
   prefix + counter to `master.DEFAULT_NUMBERING` (and the seed settings doc)
   and allocate with `master.allocateNumber(type)` — CAS-style, so concurrent
   devices never reuse a number.
4. **Add automatic postings** — if the module touches the books, add a guarded
   hook to the finance posting map (`src/erp.finance.js`, Tasks 29): POST
   BEFORE the source document saves so a posting failure throws and stops the
   action, make it idempotent via `findPosting(refType, refId)`, and invalidate
   the finance cache after. The system-health auto re-check picks it up
   automatically if the new posting goes through an existing finance mutator.
5. **Wire the UI** — build the controller as a `renderPanel(ctx)` (reads
   `ctx.el`, `ctx.error`) using the `ERP.ui` toolkit; expose `render =
   renderPanel`. Deep-linkable tabs (`el.__tab`, `#/module:tab`) follow the
   other modules. Dashboard KPI cards can deep-link to your tab.
6. **Audit + test + document** — call `master.audit({action, targetType,
   targetId, summary})` for every state-changing action. Add a `window.ERPXTest`
   suite to `src/erp.tests.js` against `makeServer()` (fake backend), add a
   fixture to `Q.FIXTURES.docs` if you want round-trip coverage, and keep this
   README's workflow + file-list entries up to date. Flip the checklist task in
   `main.pjs` only after the new suite passes in the live page.

## Backup & continuity schedule

- **Continuous**: every write lands locally first (fast cache) and flushes to
  the canonical editable store; sync runs at boot, on "Sync now", and every
  60 s. Conflicts are parked, never auto-dropped.
- **On demand**: Reports → Backup & restore → Download (JSON file) or Publish
  (to the ERP's own namespace, idempotent) any time; restore force-writes a
  validated bundle. Keep a downloaded copy off the device.
- **Periodic**: at the end of each fiscal period, close the period in Finance
  (locks posting, rolls net income to retained earnings) and archive the closed
  year's records (Reports → Backup & restore → Archival) so live documents
  stay small. System health (topbar dot) confirms the books still balance after
  every finance-affecting action.
