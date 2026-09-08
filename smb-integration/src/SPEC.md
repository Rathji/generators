# SPEC — Small-Business Generator Pipeline (smb-integration)

> The original requirements given by the user, preserved here as the reference
> spec. Every item below is implemented (all 33 marked done); usage and
> how-it-works documentation lives in `src/README.md`. Keep this file in sync
> whenever the user adjusts the constraints of the project.

---

You are building a "Small-Business Generator Pipeline" for Perchance — a suite of separate, already-saved generators (a brainstorming tool called idea-incubator, a project management app called project-master, a bookkeeping app called the-ledger, plus future small-business tools) linked into a data pipeline so each tool's output becomes importable input for the next. The linking layer must be open-ended: adding a new tool later means declaring what it publishes and consumes, not rewiring the others. Focus entirely on delivering robust, modular, and testable features based on the functional requirements provided.

### Core Framework

#### Phase 1: [Shared Bus & Bundle Protocol]
1. [x] [Bundle envelope format]: Define one canonical JSON envelope that every tool publishes and consumes — fields for `schemaVersion`, `bundleType`, `tool` (the publishing generator's stub), `toolDisplayName`, `exportedAt` (ISO timestamp), `source` (which workspace file/records it was exported from), and `payload` — so consumers can always identify provenance and freshness without guessing.
2. [x] [Bundle-type schemas]: Specify a versioned JSON schema for each bundle type in the pipeline — `idea`, `project`, `milestone-event`, `invoice`, `payment-receipt`, and `pipeline-manifest` — with required fields, types, and per-type validation rules (e.g. every `idea` must carry title + goals + scope; every `payment-receipt` must reference an invoice id and amount).
3. [x] [Pipeline registry & manifest]: Design a single shared manifest file listing every participating tool — its generator stub, display name, the bundle types it publishes, the bundle types it consumes, and current schema versions — so any tool can discover the whole pipeline from one source of truth and a new tool joins by registering itself rather than by code changes in the others.
4. [x] [Bus write adapter]: Given a saved generator, publish any bundle as a text file under that tool's own namespace so the stable public URL is `https://editable.uploads.dev/file/<toolStub>/<bundleName>`; handle first-create versus update (edit key) paths, enforce the file size ceiling, surface quota/rate-limit failures as readable errors, and report the file's edit count for cache-busting.
5. [x] [Bus read adapter]: Fetch any upstream bundle by its public URL, parse and schema-validate it, compare its exported timestamp against what the reader already has, and return a clear, typed result — fresh bundle, unchanged bundle, older-version bundle (with the version gap named), or a specific failure (404/network/malformed).
6. [x] [End-to-end bus proof]: Wire the two adapters against real saved generators to demonstrate a full round trip — tool A publishes a bundle, tool B (a different generator) pulls it, validates it, and displays its contents — before any business logic is built.

#### Phase 2: [Reusable Tool Connector Toolkit]
7. [x] [Connector module]: Build one drop-in client module any future tool can import that exposes `configure(manifestUrl)`, `publish(bundleType, payload)`, `listUpstream(bundleType)`, and `pull(bundleName)`, returning the same typed results everywhere, so new business tools get bus access without reimplementing the protocol.
8. [x] [Edit-key wallet]: Persist each tool's editable-file edit keys in that tool's own local store with a documented layout, load them on startup, and on a new device or cleared storage detect the loss and offer a guided recovery: create a fresh bundle namespace and re-register it in the manifest, leaving previously published bundles readable under the old name.
9. [x] [Freshness & sync-status tracking]: Track, per bundle, the last time this tool pulled it, the last time this tool published it, and the upstream edit count; show a "last synced X ago" line and warn when a consumed bundle is older than the tool's last successful pull by a configurable threshold.
10. [x] [Change-notification hooks]: Provide a subscription surface (event listeners or callbacks) so each tool can react when an upstream bundle it consumes has a newer edit count — triggering an automatic pull and re-render in live views without manual refresh.
11. [x] [Guidance & error copy]: Give every pipeline failure mode a user-facing, actionable message with the exact next step — "the-ledger has never published an invoice bundle yet — open that generator and export one", "project-master's file was overwritten by a newer schema (v3 vs v2) — update project-master", "the file is too large for the bus — split X", "editing quota reached — try again later" — so a non-technical user can self-serve.

#### Phase 3: [Idea Incubator — Brainstorming Side]
12. [x] [Idea workspace store]: Persist the user's idea drafts (title, description, goals, success criteria, rough scope, tags, status) as versioned JSON in a file under idea-incubator's own namespace with the edit key stored locally, using the local store only as a fast cache so the canonical ideas survive across devices.
13. [x] [Idea refinement & readiness]: Let the user mark an idea "ready for the pipeline" (with an optional goal/scope breakdown edit step) and show which ready ideas have not yet been published anywhere.
14. [x] [Idea export action]: One-click "Send to Project Master" that publishes each selected idea as an `idea` bundle and records the export time + bundle name against the idea locally, so the same idea is never silently re-published as a duplicate.
15. [x] [Receipt rendering]: Pull any `project-created` and `project-status` receipts that reference this tool's idea ids and render a status chip on each idea — "adopted by Project Master", "in progress", "milestone reached", "done" — including the project name and last update time.

#### Phase 4: [Project Master — Project Management Side]
16. [x] [Project workspace store]: Persist the canonical project data (projects, tasks, milestones, owners, statuses, client references) as versioned JSON in a file under project-master's own namespace with the edit key stored locally, local store used only as cache/offline scratch, matching the ledger tool's storage pattern.
17. [x] [Idea ingestion]: List all `idea` bundles from the manifest-discovered upstream, let the user adopt an idea into a project, and seed that project's structure from the idea's fields (goals become milestones, scope items become backlog tasks) with an editable mapping step before confirmation.
18. [x] [Project export bundles]: Publish `project` bundles (project state incl. milestones and their statuses) on an explicit user action and on milestone transitions, with an export log showing what was sent when.
19. [x] [Billing-event publication]: From milestone data the user marks as billable (amount, client, date), publish `milestone-event` bundles that the ledger consumes, and track per-milestone whether it has been exported for billing to prevent double-sending.
20. [x] [Receipt rendering]: Pull `payment-receipt` bundles from the ledger and show, per invoice/milestone, whether it is unpaid, paid (with date and amount), or partially paid, closing the loop with the books.

#### Phase 5: [The Ledger — Bookkeeping Side]
21. [x] [Ledger workspace store]: Persist the canonical books (accounts, transactions, invoices, payments, running balances) as versioned JSON in a file under the-ledger's own namespace with the edit key stored locally, matching the other tools' storage pattern and safety expectations.
22. [x] [Milestone ingestion & invoice drafts]: Pull `milestone-event` bundles from project-master and turn each into an invoice draft (client, amount, reference to project/milestone) parked in a "pending approval" state rather than auto-recorded.
23. [x] [Posting with double-entry integrity]: Approving a draft records balanced double-entry transactions (debit/credit pairs that must sum to zero), updates account running balances, and forbids editing or deleting posted entries except via a reversing entry that keeps the audit trail intact.
24. [x] [Payment-receipt publication]: When an invoice is marked paid (full or partial), publish a `payment-receipt` bundle referencing the invoice id, amount, and date so project-master can reflect it.
25. [x] [Reports & exports]: Provide human-readable summaries (per-period income/expense, per-project profit/loss) and a one-click full-backup export of the complete books as a downloadable file plus a published backup bundle.

#### Phase 6: [Reliability, Safety & Documentation]
26. [x] [Sync-conflict handling]: Detect when the same workspace file was edited from two devices since the last pull (version/updatedAt mismatch) and offer a safe resolution — keep mine, keep theirs, or a field-level merge preview — instead of silently overwriting either side.
27. [x] [Data safety nets]: Add a manual "download full backup" button and a "restore from backup file" flow to every tool, and make every publish idempotent (publishing identical content is a safe no-op that never creates duplicates).
28. [x] [Integration test suite with fixtures]: Ship fixture bundles for every type (including older schema versions and malformed payloads) and test the full loop — publish from tool A, pull into tool B, validate, render, and reply with a receipt — asserting schema mismatches, stale data, and 404s are all handled with the correct typed results.
29. [x] [Demo wiring & README]: Write a README documenting the architecture (why the bus is file-based, what each tool owns, kv-vs-file roles), the manifest, how to run the three-tool demo end to end, and the exact checklist for adding a new business tool (declare bundle types → register in manifest → import connector → build export/import views).

#### Phase 7: [Optional — Live Realtime Hub (server-plugin)]
30. [x] [Hub generator]: Build one extra saved generator whose server-plugin script keeps durable state holding only a lightweight index — per tool, the latest published bundle name and edit count per bundle type — sized to stay far under state limits since bundle payloads themselves remain on the file bus.
31. [x] [Change-event pub/sub]: The hub publishes a change event on a per-tool, per-bundle-type topic whenever a tool reports a new edit count, so subscribed tools learn of upstream updates within seconds instead of on the next manual refresh.
32. [x] [Iframe bridge module]: Extend the connector toolkit so any tool can embed the hub page in a hidden iframe and exchange subscribe/notify JSON over postMessage, with a healthy degrade-to-polling fallback whenever the hub is unavailable, so the pipeline never depends on the hub being open.
33. [x] [Data-age dashboard]: In each tool, show a "pipeline status" panel powered by the hub's index when reachable — upstream tool last-published times, data age per consumed bundle, and a one-click refresh — falling back to local freshness timestamps when offline.
