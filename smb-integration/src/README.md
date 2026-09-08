# SMB-integration — Small-Business Generator Pipeline

The **framework + connector layer** for a suite of Perchance generators
linked through a file-based data bus (editable uploads), so each tool's
output becomes importable input for the next. This generator ships the bus
protocol, the manifest, the workspace-store engine, safety nets, and the
realtime hub/bridge/dashboard — plus a live docs page and test harness.

**STATUS: complete — all 33 spec items implemented; 21 self-test suites, all
passing.** The original requirements are archived in `src/SPEC.md`.

## The pipeline

| Generator | Role | Publishes | Consumes |
|---|---|---|---|
| **smb-integration** (THIS one) | Shared bus protocol, manifest, connector toolkit every tool imports | (itself: manifests / framework) | — |
| **idea-incubator** | Brainstorming side | `idea`, `idea-index` | `project` bundles (receipts) |
| **project-master** | Project management side | `project`, `project-index`, `milestone-event` | `idea`, `payment-receipt` |
| **the-ledger** | Bookkeeping side | `payment-receipt`, `payment-receipt-index`, `backup` | `milestone-event` |
| (future tools) | join by registering in the manifest | — | — |
| (optional) **hub** | Realtime change index (server-plugin) | change events | — |

## Quick start — making a tool part of the pipeline

```perchance
// top of your tool's main.pjs
smbIntegration = {import:smb-integration}
```

Then, in your tool's UI code:

```js
const bus = root.smbConnector();            // lazy singleton, stubbed to your generator
await bus.configure();                       // loads the shared manifest

// publish something (validated, wrapped in an envelope, edit-key handled, idempotent)
await bus.publish("idea", { title, description, goals, scope, tags });

// discover + pull what upstream tools published
const list = await bus.listUpstream("payment-receipt");
const r = await bus.pull("payment-receipt"); // { ok, status: "fresh"|"unchanged"|"older", bundle, ... }
```

That's the whole integration surface. Everything below explains how it
works, the exact APIs, and the per-tool feature sets.

---

## How the pipeline works

Five moving parts — and every one of them is optional except the file bus
itself.

### 1. The file bus

Every bundle is a JSON text file under its tool's own namespace:

```
https://editable.uploads.dev/file/<toolStub>/<bundleName>
```

- **Files are the canonical, cross-device storage.** They survive reloads,
  they work while every tool is closed, and they never depend on a server
  being online — which is why the bus is file-based rather than server-based.
- **Each tool owns its namespace.** No tool ever writes into another tool's
  namespace. A tool's edit keys unlock only its own files.
- **Edit count as a change signal.** The upload service bumps a file's edit
  count on every write; tools use it (plus content hashing and `exportedAt`)
  to decide whether the file changed since they last read it.

**Bundle naming conventions** (stable, predictable, collision-free):

| Family | Per-item bundle | Cumulative index |
|---|---|---|
| Ideas | `idea-<ideaId>` | `idea-index` |
| Projects | `project-<projectId>` | `project-index` |
| Billing | `milestone-event-<eventId>` | — |
| Invoices / payments | `payment-receipt-<receiptId>` | `payment-receipt-index` |
| Backups | `backup-<timestamp>` | — |
| Framework | `manifest` | — |

The cumulative `<type>-index` bundles let a consumer discover everything a
tool has published by pulling one file instead of guessing names.

**The envelope** (`smbBuildEnvelope`) wraps every payload uniformly so any
consumer can verify provenance and freshness:

```json
{
  "schemaVersion": 1, "bundleType": "idea",
  "tool": "idea-incubator", "toolDisplayName": "Idea Incubator",
  "exportedAt": "2026-09-07T12:00:00.000Z", "source": "idea/idea-abc.json",
  "payload": { "schemaVersion": 1, "title": "...", ... }
}
```

**Bundle-type schemas** (`initSmbSchemas` → `smbValidatePayload` /
`smbValidateBundle`) version and validate each type — every `idea` must carry
title + goals + scope, every `payment-receipt` must reference an invoice id
and amount, and so on. A schema mismatch is a *typed* result
(`schema_gap`, naming both versions), never a crash.

### 2. The manifest

One shared bundle — `https://editable.uploads.dev/file/smb-integration/manifest`
— is the single source of truth: every tool's stub, display name, what it
publishes, what it consumes, the active bundle file names, and current schema
versions (auto-derived from the schema registry).

- Tools discover each other from it (`smbListUpstream` /
  `smbManifestToolsPublishing` / `smbManifestToolsConsuming`).
- A new tool joins by **registering itself** (`smbRegisterTool` +
  `smbToolRegistration`), not by code changes in the others.
- `smbValidateManifest` + `smbManifestWarnings` keep the manifest honest
  (unknown types, missing registrations, version drift).

### 3. Edit keys & the wallet

The upload service guards updates with an **edit key** (returned on first
create, required to update). The **wallet** (`smbCreateWallet` / `smbWallet`)
persists every edit key per tool in local storage and auto-hooks every
successful publish, so tools update their own files without the user ever
handling a key.

- Layout: `smb:editkey:<tool>:<name>` (flat, source of truth),
  `smb:wallet:tool:<tool>` (JSON index: bundles / activeNames / legacyNames),
  `smb:wallet:meta` (device id), `smb:wallet:recovery:<tool>` (recovery log).
- **Loss recovery:** on a new device or cleared storage, `detectLoss()`
  confirms which files are actually gone (against upstream), `recoveryPlan()`
  proposes a fresh bundle namespace per published type
  (`<type>-<deviceToken>-<time>-<rand>`), and `applyRecovery()` /
  `undoRecovery()` re-register the fresh names in the manifest
  (`activeNames`) while the old files stay readable as legacy names — no data
  is ever abandoned.

### 4. Reading & change detection

`smbPullBundle` returns one **typed result**:

- `{ ok:true, status:"fresh" }` — newer than what the caller has
- `{ ok:true, status:"unchanged" }` — same as what the caller has
- `{ ok:true, status:"older", ... }` — the upstream file is an *older version*
  (the gap named)
- `{ ok:false, code:"404" | "network" | "malformed" | "schema_gap", ... }` —
  each with a clear error

**Every publish is idempotent.** `smbPublishBundle` hashes the JSON body and
compares it to the last published hash (`smb:hash:<tool>:<name>`): identical
content is a safe no-op — it never creates duplicates and never burns quota.

**Freshness tracking** (`smbCreateSyncTracker`) records, per (tool, bundle):
last pull / last publish / upstream edit count. `smbPublishBundle` and
`connector.pull()` auto-note every success, so "last synced X ago" lines and
stale warnings come for free. Consumed bundles also report **data age** from
the upstream `exportedAt`.

### 5. Workspace stores

Each tool's canonical data lives in **one versioned JSON file of its own**
(`<toolStub>/workspace`), with a local kv cache for instant reads:

- **Optimistic local edits** — reads are instant from cache; the file is the
  durable copy written by `syncUp()`.
- **Monotonic timestamps** — `updatedAt` always moves strictly forward, so
  two edits inside the same millisecond (automated loops, emulated devices)
  can never collide into an equal timestamp.
- **Conflict-safe pulls** — `syncDown()` runs the remote file through the
  conflict resolver; on a `both-changed` result it returns a typed `conflict`
  instead of silently overwriting either side.
- **Backup / restore** — `backup()` returns a versioned snapshot object;
  `restore()` applies it; the safety-net layer adds file download/upload.

**Conflict resolution** (`smbCreateConflictResolver`,
`smbConflictPreviewHtml`): field-level diff of local vs remote with a
preview table, then **keep mine / keep theirs / field-level merge** — chosen
explicitly via `resolveConflict("mine"|"theirs"|"merge")`, never silently.

### 6. Notifications (polling)

`smbWatchUpstream({ connector, bundleName, intervalMs, onNew, onError })`
polls an upstream bundle and fires `onNew` the first time its `exportedAt` /
edit count advances — a tool wires this into a live view to auto-pull and
re-render, with a one-time "seen" ledger so re-renders don't re-notify.
`smbNotifier()` gives the same events as an on/emit subscription surface.

### 7. The realtime hub (optional layer)

The hub is a *separate saved generator* (server-plugin) that keeps **only a
lightweight index** — per (tool, bundle-type), the latest bundle name + edit
count + timestamp — never the payloads, so it stays far under server-plugin
state limits. Two ways to reach it:

- **Socket mode** — a tool imports the server-plugin and calls
  `smbHubIndex({ createSocket })` (a `smbCreateHubSocketClient`). Tools
  `report` publishes over RPC; the server appends to a compact binary log in
  durable state and **broadcasts a change event** on topic
  `smb-hub:<tool>:<bundleType>` (plus the `smb-hub:changes` fan-out) to
  subscribers, so updates land within seconds.
- **Bridge mode** — any tool embeds the hub page in a hidden iframe and
  exchanges `ready` / `report` / `query` / `subscribe` / `notify` JSON over
  postMessage (`smbCreateHubBridge`, router lives in the hub page). When the
  hub is unreachable the bridge **degrades to polling the file bus directly**
  — the pipeline never depends on the hub being open.

`connector.configureHub(hubClient)` wires auto-reporting into every publish.

### 8. Data-age dashboard

`smbPipelineStatusPanel({ ctn, tool, hub, ... })` renders a "pipeline
status" panel: one row per consumed bundle type with the upstream tool,
upstream last-published (from the hub index when live), data age, local sync
state, and a one-click per-row refresh — falling back to local freshness
timestamps when the hub is offline.

### 9. Error guidance

`smbGuidanceFor(result)` maps every typed failure to a user-facing message
with the exact next step — "the-ledger has never published an invoice bundle
yet — open that generator and export one", "project-master's file was
overwritten by a newer schema (v3 vs v2) — update project-master", "the file
is too large for the bus — split X", "editing quota reached — try again
later".

---

## Using the feature sets

### Idea Incubator (brainstorming side)

```js
const store = root.smbCreateIdeaStore({ toolStub: "idea-incubator" });
// store.getData().ideas → [{ id, title, description, goals, successCriteria, scope, tags, status, ... }]

root.smbIdeaRefine(store, id, { scope: [...], successCriteria: [...] }); // optional goal/scope edit step
root.smbIdeaSetStatus(store, id, "ready");        // draft → ready
root.smbReadyIdeasNotPublished(store);             // ready ideas never exported anywhere

await root.smbExportIdeas(store, [id1, id2]);       // one-click "Send to Project Master"
// writes idea-<id> + idea-index; records exportedAt/exportedName on each idea; idempotent

const receipts = await root.smbIdeaReceipts(store, bus);   // adopt / in-progress / milestone / done chips
receipts.receipts.forEach(r => r.chip);                    // HTML chip string via smbReceiptChipHtml
```

### Project Master (project management side)

```js
const store = root.smbCreateProjectStore({ toolStub: "project-master" });

const ideas = await root.smbListIdeaBundles(bus);          // from manifest-discovered upstream
const draft = root.smbBuildAdoptionDraft(ideaPayload);     // goals→milestones, scope→backlog tasks (editable)
await root.smbApplyAdoption(store, draft);                  // creates the project, links ideaId

await root.smbExportProject(store, projectId);              // explicit export
await root.smbSetMilestoneStatusAndExport(store, projectId, milestoneId, "done"); // auto-exports
await root.smbExportMilestoneEvent(store, projectId, milestoneId);   // billable → milestone-event bundle;
// guards against double-send via milestone.exportedForBilling

const paid = await root.smbPaymentStatuses(store, bus);    // per milestone: unpaid / paid / partially_paid
```

### The Ledger (bookkeeping side)

```js
const store = root.smbCreateLedgerStore({ toolStub: "the-ledger" });

await root.smbIngestFromBus(store, bus);                   // milestone-events → invoice DRAFTS (pending, never auto-posted)
await root.smbPostInvoice(store, invoiceId);               // balanced double-entry (debit/credit sum to zero);
// posted entries are immutable — only root.smbReverseEntry() can undo, keeping the audit trail
await root.smbRecordExpense(store, { amount, accountId, note, date });

await root.smbRecordPayment(store, invoiceId, 500, "2026-09-07"); // full/partial → payment-receipt bundle

root.smbLedgerReport(store, { from, to });                 // per-period income/expense
root.smbPerProjectPnl(store);                              // per-project profit/loss
await root.smbBackupBundle(store, bus);                    // published backup bundle
root.smbFullBackupDownload(store, "ledger-backup.json");   // downloadable file
```

---

## API reference

### Framework core

| Function | Purpose | § |
|---|---|---|
| `smbBuildEnvelope` / `smbValidateEnvelope` / `smbIsBundle` | build / validate the canonical envelope | §5 |
| `smbValidatePayload` / `smbValidateBundle` / `smbSchemaVersion` | per-type schema validation | §6 |
| `smbDefaultManifest` / `smbRegisterTool` / `smbToolRegistration` / `smbFindTool` | manifest build / self-register / lookup | §7 |
| `smbManifestToolsPublishing` / `smbManifestToolsConsuming` / `smbManifestSummary` / `smbValidateManifest` / `smbManifestWarnings` | manifest queries + hygiene | §7 |
| `smbPublishBundle` / `smbBusUrl` / `smbBusValidName` | write a bundle (idempotent, typed errors) | §8 |
| `smbPullBundle` / `smbClassifyBundle` / `smbBusAgeHuman` | read a bundle (fresh/unchanged/older/typed failure) | §9 |
| `smbGuidanceFor` / `smbGuidanceCatalog` | failure → actionable copy | §15 |
| `smbBusHash` / `smbBusGetHash` / `smbBusSaveHash` | idempotency content-hash layer | §16 |

### Connector toolkit

| Function | Purpose | § |
|---|---|---|
| `smbCreateConnector` / `smbConnector()` | one typed client per tool (`configure` / `publish` / `listUpstream` / `pull` / `getManifest` / `config` / `configureHub` / `hubReport`) | §11 |
| `smbCreateWallet` / `smbWallet` | edit-key keychain + loss recovery (`status` / `detectLoss` / `recoveryPlan` / `applyRecovery` / `undoRecovery` / `activeName` / `deviceId`) | §12 |
| `smbCreateSyncTracker` / `smbSyncTracker` / `smbSyncStatus` / `smbSyncNotePublish` / `smbSyncNotePull` | freshness records + "last synced X ago" | §13 |
| `smbCreateNotifier` / `smbNotifier` / `smbWatchUpstream` | change notifications (poll + seen-ledger) | §14 |

### Workspace stores (all three tools use the same engine)

| Function | Purpose | § |
|---|---|---|
| `smbCreateWorkspaceStore` | shared engine: `getData` / `snapshot` / `replaceData` / `touch` / `markClean` / `isDirty` / `info` / `syncUp` / `syncDown` / `resolveConflict` / `backup` / `restore` | §16 |
| `smbCreateConflictResolver` / `smbConflictPreviewHtml` | conflict detection + field-level merge | §16/§30 |
| `smbCreateIdeaStore` / `smbIdeaRefine` / `smbIdeaSetStatus` / `smbReadyIdeasNotPublished` | idea drafts + readiness | §16–17 |
| `smbPublishIdeaIndex` / `smbExportIdea` / `smbExportIdeas` | idea export (idempotent) | §18 |
| `smbBuildIdeaReceipt` / `smbReceiptChipHtml` / `smbIdeaReceipts` | receipt chips on ideas | §19 |
| `smbCreateProjectStore` / `smbListIdeaBundles` / `smbBuildAdoptionDraft` / `smbApplyAdoption` | projects + idea adoption | §20–21 |
| `smbProjectBundleName` / `smbProjectPayload` / `smbPublishProjectIndex` / `smbExportProject` / `smbSetMilestoneStatusAndExport` / `smbListProjectBundles` | project export + milestone transitions | §22 |
| `smbExportMilestoneEvent` | billable milestone → billing event (double-send guard) | §23 |
| `smbPaymentStatuses` | per-milestone paid/partial/unpaid rendering | §24 |
| `smbCreateLedgerStore` / `smbIngestMilestoneEvent` / `smbIngestFromBus` | books + milestone→invoice-draft ingestion | §25–26 |
| `smbPostInvoice` / `smbReverseEntry` / `smbRecordExpense` | double-entry posting (immutable trail) | §27 |
| `smbRecordPayment` / `smbPublishPaymentReceiptIndex` | payment → receipt bundle | §28 |
| `smbLedgerReport` / `smbPerProjectPnl` / `smbBackupBundle` / `smbFullBackupDownload` | reports + full backup | §29 |

### Safety nets

| Function | Purpose | § |
|---|---|---|
| `smbBackupDownload` / `smbRestoreFromFile` | download full backup / restore from file (conflict-aware) | §31 |
| `smbFixtures` / `smbIntegrationSelfTest` | fixture bundles + full three-tool integration suite | §32 |

### Realtime hub

| Function | Purpose | § |
|---|---|---|
| `smbHubIndex` | unified client — picks socket or bridge transport | §33 |
| `smbCreateHubSocketClient` | direct server-socket client (`configure` / `report` / `query` / `queryAll` / `onEvent` / `subscribe` / `available` / `status` / `close`) | §33 |
| `smbHubSocketReport` / `smbHubSocketQuery` / `smbHubSocketSubscribe` | low-level RPC helpers | §33 |
| `smbHubChangeEvent` / `smbHubTopic` / `smbHubSubRegistry` / `smbHubNotify` / `smbHubAttachGlue` | change-event construction + pub/sub glue (used by the hub page) | §33 |
| `smbCreateHubBridge` | hidden-iframe postMessage bridge + degrade-to-polling (`configure` / `report` / `query` / `queryAll` / `subscribe` / `unsubscribe` / `poll` / `startPolling` / `stopPolling` / `available` / `status` / `close`) | §34 |
| `smbHubRouter` / `smbHubIframeTransport` / `smbHubMockTransport` | the router (in the hub page) + transports | §34 |
| `smbPipelineStatus` / `smbPipelineStatusRefresh` / `smbPipelineStatusPanel` | data-age dashboard panel | §35 |

---

## Storage layout (local kv)

| Key | Holds |
|---|---|
| `smb:ws:data:<tool>:<bundle>` / `smb:ws:meta:<tool>:<bundle>` | workspace cache (data + version/updatedAt/dirty meta) |
| `smb:editkey:<tool>:<name>` | editable-file edit keys (source of truth) |
| `smb:editcount:<tool>:<name>` | local monotonic edit-count ledger |
| `smb:hash:<tool>:<name>` | last published content hash (idempotency) |
| `smb:wallet:*` | wallet device id, per-tool index, recovery logs |
| `smb:sync:<tool>:<bundle>` | freshness / sync-status records |
| `smb:notify:<tool>:<name>` | notifier "seen" ledger |

## Deploying tools & the hub

- **Business tools** (idea-incubator / project-master / the-ledger): add the
  one-line import, then call the feature-set APIs above from their UIs. The
  framework's functions are available as `root.smbX` immediately.
- **The hub**: create a saved generator named **smb-hub**, add the same
  import, then copy the two code blocks from this page's "Live pipeline hub"
  section into its index.html, in order: the
  `<script type="text/x-server-plugin">` block (binary index + RPC handlers),
  then the page-glue `<script>` (socket + registry + postMessage router).
  Save it and tools can connect by socket or by embedding it as an iframe.

## Testing

Every subsystem has a deterministic self-test (injected stores/clocks — no
network, no shared state) returning `{ ok, passCount, failCount }`. Run them
all from the page console:

```
smbEnvelopeSelfTest, smbSchemaSelfTest, smbManifestSelfTest, smbBusSelfTest,
smbBusReadSelfTest, smbE2ESelfTest, smbConnectorSelfTest, smbWalletSelfTest,
smbSyncSelfTest, smbNotificationSelfTest, smbGuidanceSelfTest,
smbIdeaStoreSelfTest, smbIdeaLifecycleSelfTest, smbProjectMasterSelfTest,
smbLedgerSelfTest, smbConflictSelfTest, smbSafetyNetSelfTest,
smbIntegrationSelfTest, smbHubSelfTest, smbBridgeSelfTest, smbDashboardSelfTest
```

21 suites, 400+ assertions, all passing. `smbIntegrationSelfTest` exercises
the full idea → adoption → milestone → billing event → invoice draft → post →
payment-receipt loop in-process over a fake bus.

## Troubleshooting

Run any failing operation through `smbGuidanceFor(result)` for a
user-facing message with the exact next step; common codes are covered
(`too_large`, `over_daily_allowance`, `schema_gap`, `404`, `conflict`,
`hub_unavailable`, `stale`, …). For storage problems, the wallet's
`status()` / `detectLoss()` / `recoveryPlan()` flow is the recovery path; for
edited-on-two-devices problems, `resolveConflict("mine"|"theirs"|"merge")`
is the resolution path.
