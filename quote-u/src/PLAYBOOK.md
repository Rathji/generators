# quote-u — Engineering Playbook

This is the day-2 operating manual for the quote-u codebase: the mental model,
the rules that must never bend, and the checklists for the changes you will
actually make. Read it before touching the system of record. It complements
`src/README.md` (the module-by-module reference) and `roadmap.pjs` (the phased
backlog); where they disagree with this file, this file states intent — the code
is the final authority.

- **Public page:** `https://<generator-name>.perchance.org/` — the in-app shell.
- **Client portal:** reached only by a tokenized link (`#/q/<secret>`).
- **System of record:** versioned documents in `src/store.js` (`QU_ENTITIES`).

---

## 1. Architecture

```
                  ┌──────────────────────────────────────────────┐
   Admin / Rep ──▶│  app.js  (boot, routing, service graph)       │
                  │  admin.js, builder.js, connectorspage.js, …   │
                  └───────────────┬──────────────────────────────┘
                                  │  every external call goes through
                                  ▼
                        ┌────────────────────┐
                        │  connector gateway  │  src/connectors.js
                        │  allowlist · roles  │  + src/features.js (flags,
                        │  key resolution     │    data mode, kill switch)
                        └─────────┬──────────┘  + src/gatedwrites.js (write
                                  │              approval + confirmation)
              ┌───────────────────┼───────────────────────────┐
              ▼                   ▼                           ▼
        psa (CRM-U)          mail / accounting           bus (pipeline)
        opp + note +         invoice / customer          events + webhook
        revenue + invoice    creation
```

- **All state** is a set of versioned documents (`{ records: [...] }`) written
  through the revision-guarded store. There is no other persistence.
- **All external I/O** is a connector call routed through the gateway. A module
  never calls `fetch` to an integration directly.
- **All money** is integer cents (CAD by default). Formatting happens only at
  the UI edge (`src/money.js`), never in storage.
- **The client portal** is served by `src/portal.js` (default-deny dispatcher +
  IP/token rate limits) with routes mounted by `portalread.js` (reads) and
  `portalactions.js` (select/approve/decline/expire). It only ever sees a
  client-safe DTO built by `src/portalview.js`.

The module graph is loaded in dependency order by `index.html`; `src/app.js`
builds the live service graph on boot and exposes it on `window.QU`.

### The five non-negotiable invariants

These are executable (`window.QU_INTEGRITY`, `src/integrity.js`) — the Admin
station re-derives each from the stored bytes on demand.

| # | Invariant | Enforced by | Checked by |
|---|-----------|-------------|------------|
| I1 | A sent/frozen version is immutable | `quoteversions.js` freeze seal; `isFrozen` guards every mutation | `QU_INTEGRITY.checkFrozen` (recomputes `sealBundle`) |
| I2 | Exactly one approval + one invoice intent per version | `approvals.js` / `invoiceintents.js` `unique:["version_id"]` | `QU_INTEGRITY.checkUnique` |
| I3 | `quote_events` is append-only | `audit.js` hash chain; no update/delete path | `QU_INTEGRITY.checkEvents` (re-derives the chain) |
| I4 | No portal/print surface leaks cost or margin | `portalview.js` `serialize` picks client fields; `audit` scans | `QU_INTEGRITY.checkCostLeak` (deep-scans DTOs + artifacts) |
| I5 | The outbox never performs the same write twice | `outbox.js` idempotency key `keyOf(version_id, action)` | `QU_INTEGRITY.checkOutbox` |

Two disciplines ride alongside: **stored money is always integer cents**
(`QU_MONEY.auditStoredMoney`) and **portal tokens are stored hash-only**
(`QU_PORTALTOKENS.assertNoSecret`).

---

## 2. Domain model

| Concept | Document | Notes |
|---|---|---|
| Quote | `quotes` | The commercial container; links company/contact/opportunity; has a stable `quote_number`. |
| Quote version | `quote_versions` | The immutable unit of pricing. A quote has many versions; a sent version is frozen forever. |
| Line item | `line_items` | `kind` is `one_time` or `mrr`; carries `unit_cost_cents` (INTERNAL) and `unit_sell_cents` (client-safe). Optional lines belong to an option group. |
| Option group | `option_groups` | Selection rules (`bundle` = at most one member; `multi`). |
| Price snapshot | `price_snapshots` | An immutable captured cost at a point in time; a frozen version references snapshots, never live costs. |
| Catalog item | `catalog_items` | The sellable book, seeded once from `main.pjs catalogSeed`. |
| Portal token | `portal_tokens` | Hash-only credential behind a client link. |
| Event | `quote_events` | The append-only audit log (hash-chained). |
| Approval | `approvals` | The client's typed-name acceptance; one per version. |
| Invoice intent | `invoice_intents` | The double-billing guard — one row per version, recording which path claimed it. |
| Invoice mapping | `invoice_mappings` | Admin company↔customer / product↔PSA-catalog mappings. |
| Artifact | `quote_artifacts` | Sealed acceptance artifacts (client-safe view + text/html). |
| E-signature | `esignature` | Sealed typed-name signatures + the scope sign-off. |
| Outbox job | `outbox_jobs` | Idempotent side-effect queue keyed by version+action. |
| Flags / policy | `feature_flags`, `write_policy`, `gated_writes`, `mail_permission`, `bus_events` | Operational controls. |
| Legacy | `legacy_migrations` | Records of each legacy import run. |
| **Verification** | `verification_gates` | Recorded live-evidence rows, one per integration gate (task 64). |
| **Operations log** | `ops_log` | The bounded structured log tail (task 65). |

**Money rule:** a line's amount is `unit_sell_cents × quantity`; a version's
`twelve_month_value_cents = one_time + 12 × mrr`; `deal_value_cents` sums each
*selected* line over that line's own `term_months` (a one-time line over one
term). All arithmetic goes through `src/money.js` (`add`, `mulByInt`, `mulDiv`)
so it stays exact integer cents.

---

## 3. Lifecycle

The ratified flow is **draft → sent → viewed → approved | declined | expired**
(the `internal_review` state is deprecated — see `QU_MIGRATE`). The transition
table lives in `src/lifecycle.js` and is mirrored **authoritatively** in the
server plugin (`index.html`, `<script type="text/x-server-plugin">`); when the
server and client disagree, the server wins and the client refuses.

```
draft ──send──▶ sent ──view──▶ viewed ──approve──▶ approved (terminal)
                   └─────────decline─────────────▶ declined (terminal)
                   └─────────expire──────────────▶ expired  (terminal)
```

Rules:
- **Send freezes.** `src/sendpipeline.js` freezes the version (seal), mints the
  portal token, records expiry, and delivers the link. A frozen version can
  never be re-priced — revise it into a new version instead.
- **Approval recomputes from frozen data.** `src/recompute.js` re-derives totals
  from the frozen lines/groups and refuses if its result disagrees with what the
  client saw.
- **Approval is the trigger for all downstream effects**, each idempotent:
  opportunity update, product/cost note, revenue lines, invoicing. They are
  enqueued as outbox jobs and run once per version+action.
- **A portal transition always carries the token id**, never the secret
  (`QU_LIFECYCLE.attempt` returns `portal_needs_token`).

---

## 4. Operational flags & data mode

One control surface: `quoteFeaturePolicy` (`main.pjs`), persisted at runtime in
`feature_flags`, wrapped by `src/features.js` **around the connector gateway**.

| Control | Meaning |
|---|---|
| `kill_switch` | Blocks **all** external writes, immediately. |
| `data_mode` | `live` (real calls) · `mock` (refuses live calls) · `lockdown` (blocks all writes). |
| `write_flags` | Per-feature write toggles (`opp_create`, `opp_update`, `note_write`, `revenue_write`, `email_send`, `invoice_direct`, `invoice_psa`, `distributor_read`). Empty = each feature's default. |
| `require_internal_review` | Gates sends on the version having passed internal review (deprecated state). |
| `write_policy` / `gated_writes` | Every external write must be named + approved here before it can leave, and (when `require_confirmation`) confirmed by the actor. Fail closed. |

**Ordering at the boundary:** flags/data-mode → gateway allowlist + role → gated
write approval + confirmation → key resolution → live/mock adapter. A call that
fails any layer never reaches the network, and the refusal is explicit
(`code` + `detail`).

---

## 5. Connectors & the gateway

- `src/connectors.js` registers every adapter. `createDefault()` installs the
  **mock** psa/mail/accounting/bus adapters so the whole app runs end-to-end with
  no credentials.
- The gateway holds **only key names** (`quoteGatewayPolicy.gateway_keys`) —
  never a credential. The host injects the secret store as `window.QU_KEYSTORE`
  and the adapter resolves its credential by name at call time.
- Every connector declares its functions (`effect: "read" | "write"`, permitted
  roles). Reads are allowlisted; writes are additionally gated (see §4).
- **Read classification:** every read function is listed in
  `src/features.js READ_FUNCTIONS`.
- **Enabling a connector for live** requires a live credential in the key store
  and a **verified integration gate** (§6). Until every gate a connector backs
  is verified, `QU_VERIFICATION.enablement()` reports it as pending.

### Live verification gates (task 64)

`src/verification.js` (`window.QU_VERIFICATION`, document
`verification_gates`). Each gate is probed through the real gateway, then must be
**proven with recorded evidence** before it is trusted:

| Gate | Connector | Probe (read) | Evidence to record |
|---|---|---|---|
| `psa_account_link` | psa | `getCompany` | quote id + the opportunity id it links to |
| `psa_deal_value` | psa | `getOpportunity` | opportunity id + the deal value (integer cents) now on it |
| `psa_note` | psa | `getOpportunityNotes` | opportunity id + the note it now carries |
| `psa_revenue` | psa | `getRevenueLines` | revenue lines and their total |
| `mail_delivery` | mail | `listReps` | delivered message id + the rep's own mailbox |
| `accounting_invoice` | accounting | `invoiceCount` | external invoice id + the reconciled amount |
| `psa_invoice` | psa | `psaInvoiceCount` | the PSA invoice id |
| `distributor_a_read` | distributor_a | `searchCatalog` | a captured price-snapshot id |
| `distributor_b_read` | distributor_b | `searchCatalog` | a captured price-snapshot id |
| `content_read` | content | `wikidataSearch` | an enriched catalog item id |
| `bus_publish` | bus | `streamSize` | a published envelope id |
| `quoteread_read` | quoteread | `search` | a quote id returned by the read API |

`verify(id, { evidence, by })` probes first (a failed probe writes **nothing**),
requires evidence (`quoteVerificationPolicy.require_evidence`), upserts one row
per gate, and appends `integration_verified` to the audit log.
`assertVerified(id)` fails closed — a gated live write should call it first.
The **Admin station** renders the gate list with a Verify control per gate.

---

## 6. Invoicing & the double-billing guard

Two paths, one claim:

```
approved version ──▶ invoice_intents claim (ONE per version_id)
                         │
              ┌──────────┴───────────┐
              ▼                      ▼
       path = "direct"         path = "psa"
   accounting.upsertCustomer   psa.requestInvoice
   accounting.createInvoice    (PSA's own sync
              │                 produces the invoice)
              ▼                      ▼
        invoice_intents.status = created/reconciled, external_reference set
```

- `src/invoiceintents.js` enforces `unique: ["version_id"]` — the **first** path
  to claim a version wins; a second attempt is refused (this is the double-bill
  guard, invariant I2).
- `src/invoicedirect.js` and `src/invoicepsa.js` both go through the outbox with
  a deterministic idempotency key, so a retry can never create a second invoice.
- `src/invoicepaths.js` selects the path from `quoteInvoicePolicy`
  (`default_path`, `paths` allowlist).
- Reconciliation (`src/reconciliation.js`) compares what quote-u believes it
  invoiced against the accounting/PSA systems and reports variances.

---

## 7. Observability (task 65)

`src/observability.js` (`window.QU_OBSERVABILITY`, document `ops_log`) is the
operational nervous system — it **only reads** the services it watches:

- **Health probes** (`probes()`): `token_age` (outstanding portal links vs
  `token_age_alert_days`), `outbox` (terminal failures, stale runners, backlog),
  `rate_limits` (live portal IP/token limiter utilisation), `logs` (buffer/error
  counts). Each probe is `ok | warn | fail`; `alerts()` sorts the non-ok ones by
  severity.
- **Structured log** (`log(level, source, event, detail)`): a bounded in-memory
  ring (`log_cap`), persisted to `ops_log` by `flush()` and re-hydrated on boot
  by `load()`. Use it for approval side-effect facts: `log("info","approval",
  "opp_updated", {version_id})`, `log("error","outbox","job_failed", {job_id})`.
- A silent failure in an approval side effect should surface here rather than
  disappear. The Admin station renders the probes + a recent-log tail.

`quoteObservabilityPolicy` (`main.pjs`): `token_age_alert_days`,
`token_expiry_warn_days`, `outbox_backlog_alert`, `outbox_stale_running_ms`,
`rate_limit_alert_pct`, `log_cap`, `log_doc_cap`, `max_detail`.

---

## 8. Roles & realtime collaboration (tasks 68–70)

Access control has **two regimes** and they never mix:

- **Internal** — `src/roles.js` (`window.QU_ROLES`) recognises `owner`,
  `manager` and `viewer` (with compatibility aliases `admin`→owner,
  `user`/`member`→viewer). A per-module `MATRIX` says who may touch each module
  (owner: everything; manager: everything except `manage_members`,
  `manage_policy` and a **below-floor** discount; viewer: view only), and the
  pure `writeVerdict(caps, module, content, previous)` is the single decision for
  create / send / revoke / discount-floor. `createService` resolves the current
  identity + account scope from `quoteRolePolicy` (`main.pjs`).
- **Portal** — a tokenized client link is a separate `PORTAL_REGIME` that is
  refused every internal action. A portal actor can only read its own frozen
  version and approve/decline (§3).

Enforcement is **not** a UI concern: `registerGuards(store)` installs store
write guards, so a forbidden module write fails at the storage layer even if
some future code path bypassed the screen. `wrapGateway(gateway)` injects the
resolved scope + actor into every connector call, so the gateway's own role
check and call log see the true acting member.

### The hub (`src/hub.js`, tasks 69–70)

The realtime hub is **optional** — every screen works without it. When enabled
it is a thin client over the authoritative QUHUB server block in
`index.html`'s `<script type="text/x-server-plugin">`:

- **Client** — `QU_HUB` runs an `off | connecting | open | needs_auth | degraded`
  state machine. Config (hub name + host) persists in kv; the **password is
  memory-only** (never stored). It streams presence (`pres`) and document-change
  (`chg`) messages, throttles the shared context (`setContext`/`flushContext`
  publish the open page/record so collaborators see what you are editing), marks
  co-editors with `renderPresenceMarker`, and reports local writes only after a
  real, non-noop, revision-bearing save, and resolves a sign-out to the
  least-privilege role (viewer) once a hub exists. Change detection diffs
  per-record snapshots (revision + JSON map), so an in-place edit or a delete is
  noticed — not only an added id. When the socket cannot be reached it
  **degrades to a 30 s poll** that still surfaces changes.
- **Server** — the QUHUB block authenticates each connection with a salted,
  iterated SHA-256 password hash (`hubSetupOwner`/`hubAuth`/`hubSignout`; legacy
  hashes still verify and upgrade on the next sign-in), manages members
  (`hubMemberAdd`/`hubMemberRemove`/`hubMemberRole`/`hubMemberResetPw`/
  `hubTeam`), rates + groups connections, keeps an audit ring (`hubAuditTail`),
  and derives the **actor itself** in `hubReportWrite` — the client's claim is
  never trusted. It is default-deny on the hub surface: the online roster is
  hidden from anonymous callers, a write report with a stale revision is
  refused, and removing/resetting a member drops that member's live sessions.
  (The freeze/token registries remain open to anonymous writes for now — the
  app's registry socket is unauthenticated; gating them is future work.)
- **Audit attribution** — remote changes flow through the same revision-checked
  document layer; an `auditService.append` identity wrapper substitutes the
  authenticated actor for internal hub-sourced writes, and a client ignores its
  own-actor echo. So no approval or invoice write is ever attributed to the
  wrong user.

The Admin station shows a **Roles & access** card and a **Team & live hub** card
(sign-in, member management, live status, audit tail).

---

## 9. Testing

Everything runs in-app on the self-test runner (`window.QU_SELFTEST`), reachable
from the **Admin station** or the footer. There is no Playwright — the E2E
harness (`src/e2e.js`) *is* the automation: it builds a full isolated mock
service graph and runs the real flow.

| Layer | File(s) | What it proves |
|---|---|---|
| Unit | `src/selftests/*.test.js` (one per module) | Field sets, pure functions, edge cases. |
| Integration | `src/selftests/integration.test.js` | Cross-module disciplines: money→totals with mixed terms, lifecycle gating, token hash/expiry/revocation, client DTO cost exclusion, invoice-intent idempotency, outbox backoff. |
| E2E | `src/selftests/e2e.test.js` + `src/e2e.js` | build → send → open → toggle → approve → downstream → abuse, over the mock connectors. Plus a boot smoke. |
| Invariants | `src/selftests/integrity.test.js` + `src/integrity.js` | Each invariant (I1–I5) asserted directly against live documents. |
| Gates | `src/selftests/verification.test.js` | Evidence required, failed probe writes nothing, enablement partial. |
| Ops | `src/selftests/observability.test.js` | Probe alerts, rate metrics, bounded log + persistence round-trip. |
| Roles | `src/selftests/roles.test.js` | The capability matrix + aliases, the portal regime, `writeVerdict`, identity/scope, the gateway injection, and storage-layer enforcement. |
| Realtime | `src/selftests/hub.test.js` | Sign-in role mirroring, change attribution (own-actor echo ignored), presence scoping, degraded polling whose snapshot diff catches in-place edits and deletes, and a live `hubInfo` smoke. |

Run the whole suite with `await QU_SELFTEST.run("")` (async). The runner reports
`{ pass, skip, detail }` per test; a skipped test is one whose prerequisite
modules are unavailable.

---

## 10. Checklists

### Adding a connector

1. Implement the adapter in `src/connectors.js` (declare every function with
   `effect` + permitted roles), and register it in `createDefault()`.
2. Classify every **read** function in `src/features.js READ_FUNCTIONS`.
3. Name the write functions in `quoteWritePolicy` (`main.pjs`) with an approval
   note; a write that is not listed is refused.
4. Add the key name to `quoteGatewayPolicy.gateway_keys` if it needs a live
   credential (never the credential itself).
5. Add a **verification gate** to `src/verification.js GATES` (a read probe +
   the required evidence text) and document it here (§5).
6. Add a mock so the app still runs with `data_mode: "mock"`; add tests.

### Cutting a change order (new version of a sent quote)

1. Never edit a frozen version. `quoteversions.js` refuses (`frozen_version_immutable`).
2. Create a **new version** from the frozen one (the clone copies lines/groups
   and re-snapshots costs).
3. Re-price and re-send; the previous approval/intents stay bound to their own
   version ids (I2 is per version).
4. The client's old link is revoked at approval time; mint a fresh one on send.

### Adding a report or extract column

1. Add the fact to `src/reports.js versionFacts` / the aggregation — never
   compute a second time elsewhere.
2. If it is an extract column, add it to `src/analytics.js TABLES` **and** bump
   `SCHEMA_VERSION`; the strict `verify` refuses missing/extra/renamed columns,
   so dashboards and extract cannot silently disagree.
3. If it touches money, prove integer cents (`QU_MONEY.auditStoredMoney`).
4. Extend `src/selftests/reports.test.js` / `analytics.test.js`.

### Adding an integration write

1. Implement it as an outbox action with a deterministic `keyOf(version_id,
   action)` so retries are idempotent (I5).
2. Name it in `quoteWritePolicy` and gate it behind the right `write_flags` key.
3. Emit an audit event from `src/audit.js`'s catalog (append-only, I3).
4. Log the outcome with `QU_OBSERVABILITY.log(...)` so a silent failure surfaces.
5. Add a **gate** if it represents a new external system (§5).

---

## 11. Known boundaries & escalation

- **Editable-file document store:** 5 MiB per canonical file; large documents are
  split into part files by `src/store.js`. Capacity/archive UI lives in
  `src/capacity.js` / `src/backup.js`.
- **Distributor connectors** are mock by default (`live:false`); a live transport
  is supplied from the fleet secret store. A live distributor carries licensing
  and data-sharing terms — review before enabling.
- **Product content:** the two free/open providers (Wikidata, Open Food Facts)
  are always registered; the paid options are recorded in `quoteContentPolicy`
  as an escalation and are deliberately **not** wired in.
- **Auth/roles:** the internal owner/manager/viewer model (`src/roles.js`) is
  live, with `quoteAccessScope` kept as the default account scope. The realtime
  hub is optional and its password is never persisted; the hub server block
  holds only password hashes.
- **Never** put a credential, token, password or private key in `main.pjs`,
  `index.html`, `src/**`, or the public server plugin. Credentials live only in
  the host key store, resolved by name.
