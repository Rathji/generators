# RMM-U — Operator & Developer Playbook

> This is the practical companion to `src/README.md` (which documents the
> 50-task build log and the Business ERP framework underneath) and `src/SPEC.md`
> (the verbatim backlog). Where the README says *what was built and why*, this
> playbook says **how it works and how to operate or extend it**:
>
> 1. [Architecture](#1-architecture)
> 2. [The agent lifecycle](#2-the-agent-lifecycle)
> 3. [Credentials, tokens & the no-static-secret rule](#3-credentials-tokens--the-no-static-secret-rule)
> 4. [Extending the platform](#4-extending-the-platform) — monitor type, script,
>    patch policy, automation action
> 5. [Integration ownership (psa-u & the documentation tool)](#5-integration-ownership)
> 6. [Operating runbook — agents that go dark](#6-operating-runbook--agents-that-go-dark)
> 7. [Reference](#7-reference)

---

## 1. Architecture

RMM-U is three cooperating tiers. Only the middle tier is authoritative; the
other two are clients of it.

```
 ┌────────────────────────── endpoints (managed devices) ──────────────────────────┐
 │  RMM-U agent  —  PowerShell / bash / sh runtime                                  │
 │  install dir + rotating log + offline spool + boot service (Task / systemd /     │
 │  launchd). Speaks HTTP(S) to the collector; holds ONE secret (its credential).   │
 └───────────────┬─────────────────────────────────────────────────────────────────┘
                 │  device ops: ping · enroll · heartbeat · inventory · metrics
                 │              job-result · job-start · batch · logs · diagnostics
                 │              update-result · uninstall
                 ▼
 ┌──────────────────────── collector hub (perchance server plugin) ─────────────────┐
 │  <script type="text/x-server-plugin"> in index.html — ONE public script holding  │
 │  the team hub AND the collector core (RMM-COLLECTOR-CORE-START/END).              │
 │  Authoritative: authenticates every device op against a stored credential hash,   │
 │  keeps durable fleet/job/metric/log state, mints enrollment credentials, gates    │
 │  admin RPC, publishes the `rmm` pub/sub topic.                                    │
 └───────────────┬─────────────────────────────────────────────────────────────────┘
                 │  RPC: team-hello / collectorDevice / collectorAdmin / collectorAuth
                 │  pub/sub topic: rmm
                 ▼
 ┌────────────────────────── console (browser) ─────────────────────────────────────┐
 │  window.ERP.* services + the 13-station UI. Reads/writes the canonical document   │
 │  store, drives the collector over its RPC facade, subscribes to the event bus.    │
 └──────────────────────────────────────────────────────────────────────────────────┘
```

### 1.1 The console — 13 stations

Every feature renders into one of **13 fixed nav stations** (`STATIONS` in
`src/erp.modules.js`, grouped in `GROUPS` in `src/erp.js`). Adding a 14th breaks
`RMMShellTest` (it asserts exactly 13) — fold new work into an existing station
as a tab or sub-tab.

| Group | Station id | Controller / role |
|---|---|---|
| — | `dashboard` | `ERP.fleet.render` — the live operational tile grid |
| Endpoints | `devices` | `ERP.devices.render` — Fleet, Structure, Deploy, Simulator, Inventory, Metrics, Jobs, Retention, Remote sub-tabs |
| Endpoints | `groups` | `ERP.groups.render` — Groups + Tags |
| Endpoints | `policies` | `ERP.policies.render` — Policies + Effective policy |
| Monitoring & response | `monitors` | `ERP.monitors.render` — Monitors + Catalogue |
| Monitoring & response | `alerts` | `ERP.alerts.render` — Alerts + Triage queue + Routing + Tickets |
| Monitoring & response | `automations` | `ERP.automations.render` — Rules, Run history, Schedules & windows, Script library |
| Deployment | `patches` | `ERP.patch.render` — Compliance, Patch policy, Scan history, Deployment & audit |
| Deployment | `software` | `ERP.software.render` — Catalog, Deployment, Licences & reconciliation, Inventory |
| Deployment | `security` | `ERP.security.render` — Security posture, Baselines & drift, Backup verification |
| Insights | `reports` | `ERP.continuity.render` — the Data & continuity console (Sync, Versions, Backup, Capacity, Client reports, Report schedules, Deliveries, Data quality) |
| Insights | `integrations` | `ERP.integrations.render` — sources & drift, webhooks & bus, analytics |
| System | `admin` | `ERP.masterConfig.render` — master configuration + change history |

The framework shell (`src/erp.js`) supplies the hash router (`#/<station>`),
the role guard, the loading/empty/error states, the theme and the responsive
drawer. `src/erp.ui.js` supplies every widget the controllers build with.

### 1.2 The data model

- **Canonical document store** (`src/erp.store.js`, `window.ERP.store`). One
  versioned JSON document per store name in platform storage; the RMM namespace
  is `rmm`, so documents are `rmm-v1-<doc>` under the `rmm-doc` envelope with a
  `rmm-v1-index` registry. The store gives every write a monotone revision, an
  editable edit-key, a fast local cache for offline reads, a 4 MiB write
  ceiling, and compare-and-set conflict protection. Never treat the local cache
  as truth — `store.readCanonical(name)` is truth, and `DC.reconcile()` tells
  you where a device diverged.
- **Tenant aggregate** (`rmm-v1-provider-<id>`, service `window.ERP.tenancy`,
  alias `T`). One document per MSP tenant holding `sites`, `deviceGroups`,
  `devices`, `policies`, `monitorDefinitions`, `alerts`, `scriptLibrary`,
  `automationRules`, plus object collections `patchState`, `softwareState`,
  `securityState`, `remoteState`, `integrationsState`. `T.addItem` /
  `T.updateItem` / `T.removeItem` / `T.item` stamp ids and timestamps and commit
  under CAS. The summary registry `rmm-v1-providers` lists tenants without
  loading each aggregate.
- **Hidden system documents** (`erp.modules.js` → `SYSTEM`, never in nav):
  `providers`, `config`, `enrollment`, `inventory`, `metrics`, `jobs`,
  `updates`, `diagnostics`, `dispatch`, `suppressions`, `notifications`,
  `alertstate`, `routing`, `psa`, `patchscan`, `reportschedules`,
  `reportdeliveries`, `versions` (plus the retained legacy ERP docs — parties,
  catalog, chart, taxes, defaults, settings, audit, archive). These are
  declared so the store names them correctly and so backup/capacity sees them.

### 1.3 Service map

Everything top-level is exposed on `window.ERP` (never use a bare identifier in
module code — that only works inside inline classic `<script>` in `index.html`).

| Global | Alias | Source | Responsibility |
|---|---|---|---|
| `ERP.tenancy` | `T` | `src/rmm.tenancy.js` | tenant aggregates, registry, collection CRUD |
| `ERP.devices` | `D` | `src/rmm.devices.js` | hierarchy, rich device record, liveness, station UI |
| `ERP.masterConfig` | `M` | `src/rmm.master.js` | 11 tenant-wide reference sections + Admin console |
| `ERP.continuity` | `DC` | `src/rmm.continuity.js` | reconcile, version ring, backup/restore, capacity |
| `ERP.agent` | `AG` | `src/rmm.agent.js` | platform/capability catalogues, installer generator |
| `ERP.enrollment` | `E` | `src/rmm.enrollment.js` | token + credential lifecycle, enroll, auth |
| `ERP.heartbeat` | `H` | `src/rmm.heartbeat.js` | check-in, presence sweep, capabilities |
| `ERP.rmmInventory` | `INV` | `src/rmm.inventory.js` | inventory snapshot + delta |
| `ERP.metrics` | `MET` | `src/rmm.metrics.js` | tiered metric rings, roll-ups |
| `ERP.jobs` | `J` | `src/rmm.jobs.js` | job record + agent claim/result |
| `ERP.resilience` | `RS` | `src/rmm.resilience.js` | backoff/TLS policy, release registry, self-update |
| `ERP.diagnostics` | `DIAG` | `src/rmm.diagnostics.js` | on-demand logs, self-test, troubleshooting |
| `ERP.collector` | `COL` | `src/rmm.collector.js` | client to the hub + the shared core |
| `ERP.dispatch` | `DSP` | `src/rmm.dispatch.js` | console↔collector job bridge, correlation |
| `ERP.events` | `EV` | `src/rmm.events.js` | event bus, live/polling/offline modes |
| `ERP.retention` | `RET` | `src/rmm.retention.js` | policy, codec, batching, retention |
| `ERP.groups` | `G` | `src/rmm.groups.js` | static/dynamic groups, tags, `matchTargets` |
| `ERP.policies` | `P` | `src/rmm.policies.js` | sparse settings policies + precedence |
| `ERP.monitors` | `M` | `src/rmm.monitors.js` | 16-type catalogue + evaluate/assess |
| `ERP.schedules` | `SCH` | `src/rmm.schedules.js` | schedules, calendars, maintenance, suppression |
| `ERP.scripts` | `LIB` | `src/rmm.scripts.js` | script/component library, safe substitution |
| `ERP.automations` | `AUTO` | `src/rmm.automations.js` | trigger→condition→action engine |
| `ERP.notify` | `NOT` | `src/rmm.notify.js` | notification queue + transport |
| `ERP.alerts` | `AL` | `src/rmm.alerts.js` | alert lifecycle + scan |
| `ERP.routing` | `RT` | `src/rmm.routing.js` | routes, escalation, on-call, digests |
| `ERP.psa` | `PSA` | `src/rmm.psa.js` | ticket create/update/sync |
| `ERP.triage` | `TR` | `src/rmm.triage.js` | priority queue, bulk actions, MTTA/MTTR |
| `ERP.patch` | `PA` | `src/rmm.patch.js` | patch policy, scan, compliance, deploy |
| `ERP.software` | `SW` | `src/rmm.software.js` | package catalog + deployment + licences |
| `ERP.security` | `SEC` | `src/rmm.security.js` | posture, baselines/drift, backup verification |
| `ERP.remote` | `REM` | `src/rmm.remote.js` | remote shell, tool handoff, file transfer |
| `ERP.fleet` | `FL` | `src/rmm.dashboard.js` | operational snapshot + drill-down |
| `ERP.rmmReports` | `RP` | `src/rmm.reporting.js` | report defs, schedules, deliveries |
| `ERP.integrations` | `INT` | `src/rmm.integrations.js` | ingest + ownership + bus/webhooks/analytics |
| `ERP.dataQuality` | `DQ` | `src/rmm.dataquality.js` | read-only rot linter |
| `ERP.simulator` | `SIM` | `src/rmm.simulator.js` | deterministic agents + end-to-end loop |
| `ERP.access` | `A` | `src/rmm.access.js` | roles, capabilities, scope gates (Task 48) |
| `ERP.live` | `LIVE` | `src/rmm.live.js` | realtime console: presence, focus, live refresh (Task 49) |
| `ERP.multiuser` | `MU` | `src/rmm.multiuser.js` | connections, claims, true-actor audit (Task 50) |
| `ERP.team` | `T` | `src/erp.team.js` | authenticated console session + hub RPC client |

### 1.4 One request, end to end

A **monitor breach** is the canonical example of the whole pipeline:

1. An agent check-in (`heartbeat`) carries metrics; `MET.submit` folds samples
   into the tiered rings.
2. `AL.scan(providerId)` re-evaluates every applicable monitor through
   `M.forDevice` → `M.latestReading` → `M.evaluate` → `M.assess` (the
   "for N minutes" state machine, persisted in `rmm-v1-alertstate`).
3. A sustained breach calls `AL.fire`, which de-duplicates onto the existing
   alert record, appends its timeline, and fans out through the alert
   `postHooks`: `RT.routeAlert` (delivery), `PSA.onAlert` (ticket),
   `AUTO.ingest` (automation).
4. Notifications go out via `NOT.send`; a critical alert opens a psa-u ticket
   with the device's configuration-record link; matching automation rules run
   their actions (`AUTO.run`), dispatching jobs through `DSP.enqueue`.
5. When the reading recovers, `AL.scan` auto-clears the alert, the ticket
   auto-resolves, and `SIM.fullLoop` shows the whole trace.

---

## 2. The agent lifecycle

```
 install ──▶ enroll ──▶ heartbeat ──▶ collect ──▶ act ──▶ update ──▶ uninstall
   (AG)       (E)         (H)          (INV/MET)   (J/DSP)   (RS)       (AG/H)
```

### install

The console generates a **per-platform, self-contained installer** under
**Devices → Deploy** (`AG.installerForProvider` issues the one-time token and
resolves the tenant names; `AG.installer(opts)` builds the script;
`AG.downloadScript(script, name)` downloads it as a Blob).

- Platforms (`AG.PLATFORMS`): **Windows** (Scheduled Task + PowerShell),
  **Linux** (systemd unit + sh), **macOS** (launchd daemon + sh). Each installs
  the runtime, writes an embedded config, registers the agent to run on boot,
  performs the first `enroll` + `heartbeat`, and prints success/failure **with
  the device's initial id**.
- The embedded config carries the collector address, provider identity, site and
  group bindings, the agent version, heartbeat/sample intervals, the resilience
  policy (backoff, spool caps, TLS mode/pin), and **one secret only: the
  one-time enrollment token**.
- The installer refuses to build without a collector URL and a token
  (`no_collector` / `no_token`) — you cannot ship a credential-less agent.

### enroll

`E.enroll({ token, providerId?, hostname?, displayName?, os?, agentVersion?,
device? })` exchanges the token for a durable per-device credential (a
device-bound token makes it a re-enrollment that re-keys in place).

- Validates the token: known, unexpired, not revoked, uses remaining, and bound
  to the claimed provider (and site/groups — the *token's* bindings win, so a
  caller cannot place an agent into a tenant or group it wasn't issued for).
- Creates the device (or **re-keys in place** when the token is bound to an
  existing device, so re-enrollment never duplicates a record).
- Mints a credential, stores **only its hash**, records the identity on the
  device, and burns one use of the token.
- Returns the plaintext credential exactly once. The agent persists it locally
  and reuses it for every later call.

### heartbeat

`H.heartbeat({ deviceId, credential, payload })` is the agent's regular
check-in (every `rmm.heartbeatSeconds`, default 300).

- Authenticates the credential (`E.authenticate`, constant-time), stamps
  `lastSeenAt`, computes **clock skew** against `payload.clientTime`, records
  the **agent version + normalised capabilities**, and detects a **network
  change** via an order-independent MAC/IP/gateway fingerprint (bounded history
  in `custom.networkHistory`).
- Answers with **server time, the next interval**, and the outstanding work:
  `collectInventory` / `collectMetrics` flags, `collectLogs` / `selfTest`
  requests, and the queued **jobs** (delivered through `J.claim`). This is the
  agent's whole pull channel.
- `H.sweep(providerId)` derives per-device online/stale/offline (via the
  `config.rmm.staleAfterMinutes` liveness rule) and records **presence
  transitions** — the input the event bus turns into agent-offline alerts.

### collect

On the collector's flags, the agent ships state:

- **Inventory** (`INV.submit`): eleven sections (hardware, OS, software,
  services, patches, disks, interfaces, users, groups, security, backup),
  hashed for a stable fingerprint, sent **delta-first** (`INV.agentPayload`
  decides full-vs-delta; `INV.diff`/`INV.apply` round-trip it). The console
  patches the device record's asset fields and stores a compact summary.
- **Metrics** (`MET.submit`): a batch of samples (capped by
  `metricsMaxSamplesPerPost`) into raw/hourly/daily rings.
- **Diagnostics** (`DIAG.submitLogs` / `DIAG.submitSelfTest`): a UTF-8 log body
  (byte-capped, truncated+marked) or the ten self-test check results.
- **Job results** (`J.result`): exit code, bounded stdout/stderr, timeout flag.

Failed posts are queued in the **offline spool** and replayed on reconnect, so
a brief collector outage loses nothing acknowledged.

### act

The console dispatches work and the agent claims it:

- `J.enqueue` creates one job for many devices; `DSP.enqueue` also pushes a
  matching collector job per target and records a dispatch ledger row.
- The agent's next heartbeat claims queued jobs; `J.claim` authenticates,
  delivers, **fails incompatible jobs with a clear reason instead of running
  them**, and expires stale queues.
- Jobs arrive **base64-encoded** (`scriptB64`/`argsB64`) so any byte survives;
  the agent runs them under a timeout and posts the outcome back
  (`stdoutB64`/`stderrB64`). `DSP.sync` mirrors the collector state back onto
  the ERP job's per-device results and fires `onTerminal` when a dispatch
  finishes.

### update

Self-update is agent-driven and safe by construction (service `RS`):

- `RS.publish({ providerId, platform, version, channel, source, sha256, notes,
  mandatory })` stores an **immutable, checksummed** build.
- `RS.push(targets, release)` queues an update request on each device
  (`custom.updateRequest`), surfaced through the heartbeat contract.
- The agent downloads, **verifies the checksum**, stages, self-tests, and
  **rolls back to the prior version on failure**. `RS.recordResult` (the
  authenticated `/update-result` path) keeps a bounded per-device history and a
  failed build is marked `rolled-back`.
- `RS.rolloutStatus` reports the version spread / pending / buffered counts;
  `RS.reapUpdates` bounds the history.

### uninstall

A decommissioned endpoint is removed in two steps:

1. **Revoke** from **Devices → Deploy → Agents** (`E.revokeDevice`). From that
   moment the credential is refused everywhere with reason `revoked` — the
   device can no longer post data or fetch jobs, on the console side *and* at
   the collector core.
2. **Uninstall** the agent (the installer's clean self-remove path) which
   reports back via the `uninstall` device op. Then **delete/archive** the
   device record from the console.

Revocation is the security boundary; uninstall is housekeeping. Always revoke
first — an uninstalled agent whose credential is still valid is not a problem
(the process is gone), but a *lost* endpoint that is neither revoked nor
uninstalled is.

---

## 3. Credentials, tokens & the no-static-secret rule

### 3.1 The threat model

The collector hub is the only thing that accepts agent input, so it must answer
one question on every request: **is this caller *this* device, currently
enrolled, not revoked, acting within its own tenant?** Everything else follows.

### 3.2 Two kinds of secret, both stored as hashes

| Secret | Lifetime | Where it lives | Returned in plaintext |
|---|---|---|---|
| **Enrollment token** | single-use (or max-uses), TTL-bounded | `rmm-v1-enrollment`, as a SHA-256 **hash** | once, when issued |
| **Device credential** | durable until rotated/revoked | collector state (device record), as a SHA-256 **hash** | once, when minted |

`E` carries its own pure-JS SHA-256 so the collector mirror uses the **same
primitive** (the server cannot `import` client modules and cannot use
`crypto.subtle`). `E.authenticate` compares stored hashes in constant time.
`E.issueToken` / `E.enroll` / `E.rotateCredential` are the only paths that ever
return plaintext, and each returns it *once*. Sub-modules: `E.beginReenroll`,
`E.revokeToken`, `E.revokeDevice`, `E.identity`, `E.listTokens`,
`E.listCredentials`, `E.stats`.

### 3.3 The admin gate

The console's admin RPC (push job, request logs, revoke, reap, retention…) is
gated at the hub by a **SHA-256 password hash** (`COLLECTOR_ADMIN_SHA256`).

- The admin password is **high-entropy and generated**, given to the operator
  out-of-band; only its hash is in the source.
- The hash itself is public but cannot be replayed, and a high-entropy password
  is not offline-guessable. **Do not substitute a human-chosen password** — a
  weak password whose hash is public is brute-forceable.
- A rejected admin call is surfaced as `DSP.locked`; the UI offers an **Unlock**
  modal and `DSP.redispatch` retries the blocked targets.

### 3.4 The rule: the public collector script holds no static secret

Everything inside `<script type="text/x-server-plugin">` in `index.html` is
**public source** — every visitor and anyone who downloads the generator can
read it. It executes authoritatively, but it is not private. Therefore:

> **Never** put a plaintext password, API token, private key, deletion URL, or
> device credential in the server script — or in client JS, pjs, URLs, or
> browser storage. Secrets are **minted at runtime** and stored **only as
> hashes** (device credentials/state in the durable server state; the admin
> password only as its SHA-256 hash).

This is enforced, not just documented:

- `RMMCollectorTest` runs a **drift guard**: it parses the server block's
  `RMM-COLLECTOR-CORE-START/END` region and asserts it is **byte-identical** to
  `COL.createCore` in `src/rmm.collector.js`, so the authoritative rules cannot
  silently diverge from the reviewed client core.
- `RMMAgentSecurityTest` asserts the server block contains **no plaintext
  `cred_…` / `rmm_…` credential material, no baked-in credential/token hashes**
  (`credentialHash: "…"` / `tokenHash: "…"`), **no plaintext admin password**,
  and never contains a secret minted during the test. It also confirms tokens
  are stored hash-only and that a spent token is refused.

### 3.5 Rotation and revocation

- **Rotate** a credential from **Devices → Deploy → Agents → Rotate key**
  (`E.rotateCredential`): a new secret is minted and returned once; the device
  stores it on its next successful write. Do this on suspicion of compromise.
- **Revoke a token** (`E.revokeToken`) if an installer is lost before use.
- **Revoke a device** (`E.revokeDevice`) when an endpoint is lost, stolen or
  retired. Revocation is immediate and total across the console and core.

### 3.6 Roles, capabilities & server-side enforcement

The console's coarse global role selector (owner / manager / staff) only hides
UI. Since Task 48 the real authorization model lives in **`window.ERP.access`**
(`A`, `src/rmm.access.js`) and is **enforced at the hub**, not merely in the
browser.

- **Roles** — `read-only`, `technician`, `dispatcher`, `security-admin`
  (`ACC.ROLES`). Each maps to a default capability set (`ACC.ROLE_CAPS`).
- **Capabilities** — the fine-grained `ACC.CAPS` (view, triage, patch deploy,
  policy edit, user manage, script run, remote shell, file transfer, …).
- **Scope** — a grant is scoped to a **site** and optionally to a single
  **device**. `ACC.effectiveScope(target)` / `ACC.effectiveCaps(target)` resolve
  what is in force, and `ACC.can(cap, target)` is the one predicate controllers
  ask before acting.
- **Destructive actions are gated separately** (`ACC.DESTRUCTIVE`): **script
  execution, patch denial, remote shell, file transfer**. A role can hold the
  ordinary capability without inheriting the destructive one — so `rmm.remote.js`
  and `rmm.patch.js` call `ACCESS.can("remote.shell", deviceId)` etc. rather than
  a blanket role check.
- **Identity is hub-gated** — `ACC.identity()` trusts the live hub's
  authenticated user only while `T.status === "online"`; otherwise it falls back
  to the local `erp.team.userId.v1` + `ERP.role`. Stale online state (a cached
  `me` / cap set) is **never** trusted offline, so nobody is elevated or locked
  out by a previous session.
- **Server-side enforcement** — the collector hub resolves the acting user and
  runs `collectorCore.guardAdmin(acting, action, body)` +
  `collectorScopeFilter` before every admin/device op, so a hand-crafted request
  that skips the console is still refused. The team-hub RPCs that read or mutate
  grants are themselves gated on the `access.manage` capability.
- **Where to configure** — **Admin → Roles & access** (the 14th master-config
  tab): the "Your access" summary, the role-capability matrix (destructive rows
  flagged) and the user grants table.

### 3.7 Realtime console & multi-user control

Two layers sit on top of the access model. **`ERP.live`** (`LIVE`) keeps every
connected console session seeing the same reality; **`ERP.multiuser`** (`MU`)
makes sure no two of them silently clobber each other and that every remote
action is attributed to the **true actor**.

**Realtime & presence (`LIVE`, `src/rmm.live.js`).**

- The **mode** is the event transport's own (`EV.mode()`): `live` when the
  socket is up, `polling` when it has degraded to `EV.pollOnce`, `offline` when
  neither answers. **Presence is only claimed when the hub is online**
  (`presenceAvailable`); otherwise it is reported unavailable rather than stale.
  `LIVE.fallback()` gives the human-readable reason. Never gate the UI on a
  socket — watched views refresh off the polling-derived event stream too.
- **Focus & viewers** — opening a device detail modal calls
  `LIVE.focus(deviceId, providerId)`, which tells the hub (`rmmFocus`) that this
  session is viewing that device; the hub fans the viewer list back to everyone
  on it (`{t:"viewers"}` → `T.viewersByDevice`). `LIVE.viewers`/`others`/
  `viewerCount` read it; `onViewers(fn)` subscribes. Closing the modal
  `blur()`s — focus is cleared and viewers re-published, so a stale "who is
  here" list is impossible.
- **Watched views** — `LIVE.watch(fn)` registers a re-render callback; a
  relevant `device-state`/`alert`/`job` event schedules a debounced refresh
  (`rmm.liveAutoRefreshSeconds`, default 3s). So a change made by one technician
  appears on another's screen within seconds without a manual reload.
- **Surfaces** — the topbar `#rmmLive` indicator (dot + session count + focus)
  opens the **Realtime console** modal; the device modal shows the presence
  strip.

**Multi-user audit & rate control (`MU`, `src/rmm.multiuser.js`).** Four
guarantees:

1. **Identity with a role** — `MU.identity()` is the hub-authenticated `T.me`
   (Task 41), never a client-supplied actor.
2. **Grouped connections & rate control** — the hub buckets sessions by a
   **privacy-preserving network key** (`netKey`), caps them at
   `rateLimitPerNetConnections` (default 10) with `err:"net_full"`, and
   rate-limits guarded ops per connection. `MU.connections()`/`MU.limits()`
   surface the grouping and the numbers in force; the limits are config-driven
   in `config.rmm`.
3. **Document claims** — `MU.claim(doc, baseRev)` reserves a document for a
   session for `docClaimTtlSeconds` (default 15 min); `MU.editGuard(doc, baseRev)`
   is the save-time check — it returns `{ok:false, conflict:true, holder,
   message}` naming the other technician instead of letting you overwrite them.
   `MU.release`/`claims` manage the set. Claims require the hub; offline editing
   is unaffected (a claim is an advisory lock, not a write barrier — the store's
   CAS is the hard barrier).
4. **The true-actor audit trail** — remote (device-affecting) actions are
   stamped **at the hub** against the hub-resolved identity
   (`collectorAdmin` → `auditRemote(acting, action, ok)` on both allow and
   deny), and console-only actions go through `MU.auditRemote`. The ring is
   readable via `MU.auditTail` with the prefixes `rmm:` (remote), `deny:`
   (refused) and `act:` (console).

**No silent overwrite — two independent barriers.** The **canonical store**
(`erp.store.js`) refuses a write whose base revision is behind the server and
records a pending conflict (Task 5). On top of that, the **hub's `announce`
refuses a stale or claim-held write** and broadcasts `{t:"conflict"}` to every
session, so all consoles are warned that someone else saved first. The
**Multi-user & rate control** panel (rendered inside Admin → Roles & access —
*not* a new master-config tab) shows the session, the grouped connections and
limits, live edit claims, overwrite safety and the audit tail.

> Config keys: `liveEnabled`, `livePresenceEnabled`, `liveAutoRefreshSeconds`,
> `livePanelHistory`, `rateLimitPerNetConnections`, `rateLimitActionsPerMinute`,
> `rateLimitClaimsPerMinute`, `docClaimsEnabled`, `docClaimTtlSeconds`,
> `auditRemoteActions`.

---

## 4. Extending the platform

The console UI is generated from schemas wherever possible, so most extensions
are **data changes in one place**.

### 4.1 Add a monitor type

Monitor types live in `TYPES` in `src/rmm.monitors.js`. Each entry declares its
settings, thresholds, defaults, category and whether it needs a live probe:

```js
{
  id: "battery", label: "Battery health", category: "hardware", icon: "devices",
  desc: "Fires when a laptop battery's health drops below the threshold.",
  settings: [{ key: "deviceFilter", label: "Device filter", type: "select", options: ["all", "laptops"], default: "laptops" }],
  thresholds: [{ key: "warning", label: "Warn below", unit: "%", default: 80, direction: "below" }],
  defaults: { severity: "sev-warning", forMinutes: 5, intervalSeconds: 3600 },
}
```

Steps:

1. Add the entry to `TYPES`. Pick an existing `category` (or a new one — the
   Catalogue groups by category automatically). Optionally add a matching
   `monitorTypes` record in the master config for the reference table.
2. Add a `case "<id>":` to **`M.evaluate(type, reading, opts)`** mapping a
   reading to `{ state, value, message }` (`ok`/`warning`/`critical`/`unknown`).
   Use `numericState(value, th, direction)` for threshold types and `breach()`
   for one-off comparisons. The `opts` it receives are the *effective*
   thresholds/settings (monitor ← group override ← device override).
3. If the type reads data that `M.latestReading` does not already return,
   extend `M.latestReading` — and the agent's collection path and the
   inventory/metrics schemas that feed it.
4. **Probe types** (web/port/script/snmp set `probe: true`): evaluation is
   `unknown` until a probe result is supplied via `opts.probe`; the console's
   on-demand probe fills it.
5. The editor, the threshold rows, the simulate modal and validation all
   generate from the schema — **no UI code**. `M.normalizeMonitor` /
   `M.normalizeOverride` / `M.validate` pick up the new type automatically.
6. Add checks to `RMMMonitorsTest` for the new type's `evaluate` and required
   settings, then run the suite.

### 4.2 Add a script

Scripts are **library entries** (`window.ERP.scripts`, `LIB`), created under
**Automations → Script library** or programmatically. An entry is a `script` or
a `component` (includable with `{{component:id}}`) with one or more **per-OS
variants** and **typed parameters**.

1. Add an entry via the library UI or `LIB.normalizeScript({ kind, name,
   description, category, tags, variants, parameters })`. Each variant carries
   `{ os: windows|linux|macos|any, language, script, args, timeoutSeconds }`.
2. Declare parameters (`LIB.PARAM_TYPES`: `string` / `number` / `bool` /
   `enum`) with `required`, `default`, `options`, `min`/`max`, `maxLength` and
   an optional `pattern`. **Always bound your parameters** — the data-quality
   linter flags scripts whose parameters have no validation (`unsafe-script`).
3. In the script body, reference parameters only through the platform's
   substitution. `LIB.validateParameters` validates/coerces every value first;
   substitution goes **only** through `LIB.safeLiteral(value, shell)`, a
   per-shell quoting routine (powershell/cmd/bash/python/generic) so a value
   can never break out of its literal and inject a command. `LIB.prepareRun`
   refuses unknown tokens / invalid parameters.
4. Put reusable fragments in a `component`; `LIB.expandComponents` inlines them
   recursively with **cycle detection**, depth and size caps.
5. Run it on devices with `LIB.runOn(providerId, deviceIds, scriptId, values)`
   — it groups targets **by OS family** and enqueues one job per family with
   the matching variant. Entries are versioned (`LIB.bumpVersion` / `restore` /
   `diffVersions`) and can be exported/imported as a bundle.
6. Cover it in `RMMScriptsTest` (including a hostile parameter value that must
   be escaped).

### 4.3 Add a patch policy

Patch policies live in `provider.patchState.policies`; the `PA` service owns
them and `PA.defaultPolicy()` is the read-only tenant baseline (deny by
default).

1. Create a policy under **Patches → Patch policy → New policy**, or
   `PA.addPolicy(providerId, {...})`. Fields: `name`, `description`,
   `priority`, `osFamily`, `siteId`, `targets` (`{groupIds, tags, deviceIds}`),
   `installWindowId` / `rebootWindowId`, `rebootPolicy` (`never` /
   `if-required` / `in-window`), `rebootGraceMinutes`, `enforceDeadline`,
   `missingGraceDays`, a `default` class rule, and a `classifications` map.
2. Each classification rule is `{ decision: approve|deny|defer|inherit,
   deferralDays, deadlineDays, requiresReboot }`, keyed by the master-config
   patch classification id (`pc-critical`, `pc-security`, `pc-definition`,
   `pc-feature`, `pc-driver`, `pc-servicepack`, `pc-tools`, `pc-updates`,
   `pc-upgrades`). Unclassified and `inherit` fall through to the `default`
   rule. A deferral must precede its deadline (`PA.validatePolicy` rejects
   otherwise).
3. **Precedence** is `priority → OS-specificity → specificity → recency → id`,
   with the baseline always last; `PA.effectiveOf(provider, device)` resolves
   every field *and* each classification decision with **per-field provenance**
   (which policy supplied it) — visible in the Patches → Patch policy tab.
4. Run `PA.scan` to classify missing patches through the effective policy, then
   `PA.plan` / `PA.deploy` / `PA.reconcileDeployment`.
5. Cover it in `RMMPatchPolicyTest` / `RMMPatchComplianceTest`.

### 4.4 Add an automation action

Automation rules are trigger → optional conditions → ordered actions.
Triggers and actions live in `AUTO.TRIGGERS` / `AUTO.ACTIONS`
(`src/rmm.automations.js`).

1. Add an entry to **`AUTO.ACTIONS`** declaring `id`, `label`, `category`,
   `params[]` (each `{ key, label, type, required, default, ref?, options? }`),
   an optional `destructive: true` flag, and (only if not yet implemented) a
   `phase` string — a `phase` makes `executeAction` return `skipped` until the
   phase lands.
2. Implement a `case "<id>":` in **`executeAction(provider, rule, action, dev,
   run, at)`** (`src/rmm.automations.js`). Return
   `{ type, status, detail, jobId? }` where status is one of `queued`,
   `failed`, `skipped`, `sent`/`suppressed`, `done`. Use `renderTemplate(...)`
   with `vars` (`{{rule}}`, `{{device}}`, `{{event}}`, `{{at}}`, …) for
   parameter text. Dispatch jobs via `enqueue(provider.id, dev.id, name, spec,
   { correlation })` so provenance is recorded.
3. If `destructive: true`, approval gating and maintenance deferral apply
   automatically (`AUTO.run` → `pending-approval`; `AUTO.approve`/`AUTO.reject`;
   non-essential actions deferred with a recorded suppression unless
   `allowDuringMaintenance` or the action is marked essential).
4. The rule editor's action builder generates from `params` — **no UI code**.
5. Cover it in `RMMAutomationsTest` (execution + the plan's dry-run status).

> Adding a **trigger** is the same idea: add to `AUTO.TRIGGERS`, then make the
> event router (`AUTO.ingest`) or a sweep (`AUTO.scheduleDue`) emit it.

---

## 5. Integration ownership

RMM-U is not the system of record for company/site/configuration data — psa-u
and the documentation tool are. The integration layer (`window.ERP.integrations`,
`INT`) makes that two-way relationship **safe** by giving every field a single
declared owner.

### 5.1 Sources and entities

`INT.SOURCES` = **`psa-u`** (companies, sites, service-plan configuration) and
**`docs`** (configuration records and documentation links). Entity types are
`company`, `site`, `configuration`.

### 5.2 Ownership is what makes sync safe

`INT.DEFAULT_OWNERSHIP` declares, per entity type, whether each field is owned
by `external` (the source writes it) or by `rmm` (RMM writes it and external
must not silently overwrite):

| Entity | `external`-owned | `rmm`-owned |
|---|---|---|
| `company` | name, servicePlan, accountManager, phone, email | tags, siteIds, notes |
| `site` | name, address, timezone, companyId | deviceGroupIds, notes |
| `configuration` | assetTag, documentationUrl, owner, status | hostname, serial, ip, os, notes |

`INT.ownershipFor(state, type)` merges the tenant's overrides over the defaults;
`INT.setOwnership` changes a field; `INT.ownershipMap` returns the current map
shown in the Integrations console.

### 5.3 Ingest and drift

`INT.ingest(providerId, sourceId, payload, opts)` accepts one or many external
records. For each field: if `external`-owned, the incoming value is applied; if
`rmm`-owned, the local value is **kept**. Any disagreement is recorded as
**drift** with both values and the owner (`INT.drift` / `driftCount`), so it is
visible rather than silently lost.

- **Reviews & resolution**: `INT.resolve` / `INT.resolveAll` settle a drift
  point in favour of one side (with an audit trail); `INT.setRmmField` is the
  RMM-side writer.
- **The docs link** is a first-class device field:
  `device.documentation{ refId, refUrl, systemId, syncedAt }`. psa-u tickets
  derive their configuration-record link from it, so a ticket always points at
  the endpoint's documentation page.

### 5.4 Publication, webhooks, analytics

- **Versioned envelope**: `INT.envelope(...)` builds `{ schema: "rmm.event.v1",
  version: 1, … }`; `INT.publish` sends it through a swappable `INT.sender`
  signed with an `X-RMM-Signature` header, logged in `publications`.
  `INT.dispatch` (and `startAutoPublish`/`stopAutoPublish`) publishes
  device-health and alert events straight off the Task-16 event bus.
- **Outbound webhooks**: `INT.addWebhook` / `updateWebhook` / `removeWebhook` /
  `listWebhooks` / `testWebhook`.
- **BI extract**: `INT.analyticsExtract` produces a schema-stable
  `rmm.analytics.v1` extract over six tables (devices, alerts,
  patchCompliance, securityPosture, backupStatus, jobs); `INT.exportAnalytics`
  emits JSON or NDJSON.
- **API facade**: `window.ERP.api`.

> Rule of thumb: if a field is shown in the console but edited in psa-u or the
> docs tool, it is `external`-owned; if RMM discovers it from the agent, it is
> `rmm`-owned. When in doubt, add the field and decide its owner — never leave
> a field unowned and hope.

---

## 6. Operating runbook — agents that go dark

"Dark" means an agent that has stopped checking in, or is checking in but not
reporting. This runbook is the operator procedure; the console ships the same
material as the **Devices → Diagnostics** tab's troubleshooting playbook
(`DIAG.TROUBLESHOOTING`) and the **Data quality** tab's `agent-stale` check.

### 6.1 How you find out

Multiple independent layers will tell you, in this order of speed:

| Signal | Where | Meaning |
|---|---|---|
| `agent-offline` / `agent-stale` alert | Alerts, Triage queue | `EV.pollOnce` synthesised it from a presence transition, or a monitor of type `agent` fired |
| Device liveness `offline` / `stale` | Dashboard tile → drill-down, Devices table | derived from `lastSeenAt` vs `staleAfterMinutes` |
| `monitor.state` breach | Monitors / Alerts | an up/down or agent monitor crossed its threshold past `forMinutes` |
| Data-quality findings | Reports → Data quality | `agent-stale` (offline past `dqOfflineDays`), `device-unassigned`, `no-policy`, … |
| Agent version spread | Dashboard → Agents | an entire version cohort going quiet points at that build |

A **presence transition** is only emitted when the status actually changes, so
the alerts are not noisy — and a maintenance window suppresses non-critical
agent alerts for the covered devices.

### 6.2 Triage sequence

1. **Confirm it is real and how long.** Open the device; check `lastSeenAt`,
   the liveness badge and any open alert age. If many devices went dark at once,
   suspect the collector or a network, not the endpoints — check the topbar hub
   state (`live` / `polling` / `offline`).
2. **Look at the collector view.** Devices → Retention → capacity reports the
   hub's fleet; `EV` polling diffs the collector's fleet/job views. A device the
   collector still sees but the console does not is a console-side sync issue,
   not a dark agent.
3. **Ask the agent directly.** Devices → Diagnostics → **Pull logs** and
   **Run self-test** (`DIAG.requestLogs` / `DIAG.requestSelfTest`). Both ride
   the heartbeat, so this only works if the agent is still checking in — but a
   self-test that fails a specific check tells you exactly where the break is.
4. **Match the failing check to the fix** (next section). If the device is
   truly unreachable, the self-test will not run — go to the on-site/remote
   path (Remote tool handoff) or the endpoint's local log.

### 6.3 The self-test checks (`DIAG.SELF_TEST_CHECKS`)

| Check | Fails when |
|---|---|
| Configuration | the embedded config does not parse or lacks a collector address / device record |
| Collector reachable | the collector address does not answer |
| Collector identity | TLS is invalid (or the pin no longer matches) |
| Enrolled | the endpoint holds no device id / credential |
| Authenticated | the stored credential is rejected |
| Clock | the endpoint clock is too far from the collector's |
| Service | the boot service / task / timer is not registered |
| Offline buffer | the replay spool is over its cap |
| Disk space | the install volume is full |
| Job runtime | no supported script runner is present |

### 6.4 Symptom → cause → fix (`DIAG.TROUBLESHOOTING`)

| Symptom | Likely cause | Fix |
|---|---|---|
| Self-test fails at **Collector reachable** | DNS, firewall/proxy, or a wrong collector address in the installer | Resolve/connect to the collector from the endpoint (Test-NetConnection / `curl -v`); confirm outbound TCP 443; if wrong, re-issue an installer with the correct URL and re-enroll |
| Reachable but handshake **rejected** | TLS-intercepting proxy, expired cert, or a stale pin | Install the proxy root CA, or rotate `rmm.tlsPinSha256` to the new SPKI hash. Never set `tlsAllowInsecure` in production |
| **Enrolled** fails | the one-time token was already used, expired or revoked | Issue a fresh installer (or a device-bound re-enrollment token) from Devices → Deploy and re-run it. The old token cannot be reused by design |
| **Authenticated** fails, "revoked" | the device was revoked from the console | If legitimate, re-enroll with a fresh token; otherwise leave revoked. Check the audit trail for who revoked it |
| **Clock** fails / large skew | endpoint clock drifted (dead CMOS battery, blocked NTP) | Fix time sync (`w32tm /resync`, `chronyc makestep`, `sntp -sS`). Heartbeats are accepted, but do not trust a skewed timestamp |
| **Service** fails | scheduled task / systemd unit / launchd daemon removed, disabled, or install dir moved | Re-run the installer (re-registers the service) or re-enable the unit. The agent must live in its install directory for self-update to work |
| Growing **offline buffer** | the collector has been unreachable; the agent is spooling | Restore connectivity — the spool replays with backoff and is bounded. Cancel stale update/log requests if the device is being retired |
| **Disk space** fails | install volume full | Free space, then reduce `rmm.agentLogMaxBytes` / `agentLogKeep`. Logs and job output are already bounded |
| **Job runtime** fails | no supported script runner installed | Install the runtime, or restrict this endpoint's jobs to a supported language. Unsupported-language jobs fail with a clear message rather than running |
| Installed but **offline with no self-test** | the service is registered but the process crashes at start-up (bad config, permissions) | Read the local rotating log (`<install>/../Logs/agent.log` or `/opt/rmm-u/logs`), fix the error, Pull logs to confirm, re-run the installer if the config file is corrupt |

### 6.5 Remediate and prevent

- **Automate the recovery.** A rule on `device.offline` can tag the device,
  notify the on-call recipient, or hand off to the remote tool — see §4.4. An
  `agent`-type monitor with `offlineAfterMinutes` / `staleAfterMinutes` gives
  you the alert and the duration in one place.
- **Set a maintenance window** for planned outages so legitimate downtime does
  not page anyone (severity suppression, §"schedules" in the README).
- **Fix the root causes the linter finds**: the Data-quality tab flags stale
  agents, duplicate device records from failed re-enrollments, and devices with
  no policy — clean those up so "dark" is always anomalous.
- **Watch the version spread**: if one agent version is disproportionately
  offline, the release is the problem. Roll back or re-push via `RS`.

---

## 7. Reference

### 7.1 Collector device ops (`COL.DEVICE_OPS`)

`ping` · `enroll` · `heartbeat` · `inventory` · `metrics` · `job-result` ·
`job-start` · `batch` · `logs` · `diagnostics` · `update-result` · `uninstall`

Each is authenticated against the device credential (except `ping`/`enroll`),
rate-limited per device (`deviceOpsPerMinute`), and may be coalesced via
`batch`.

### 7.2 Collector admin ops (`COL.ADMIN_OPS`)

`registerToken` · `revokeToken` · `pushJob` · `pushJobs` · `pushConfig` ·
`requestLogs` · `requestSelfTest` · `queueUpdate` · `revokeDevice` · `retryJob` ·
`cancelJob` · `reapJobs` · `applyRetention` · `fleet` · `device` · `job` ·
`jobs` · `inventory` · `metrics` · `logs` · `diagnostics` · `seedEntropy`

All gated by the admin password hash at the hub.

### 7.3 Test suites

Run any suite from the browser console / `page_eval`. All RMM suites are
stub-backend (they never touch real documents) and most use a **mock collector
hub** that runs a real core behind the transport API.

```
await window.RMMShellTest();            // Task 1  (13 stations)
await window.RMMAccessTest();           // Task 48 (75 checks)
await window.RMMLiveTest();             // Task 49 (23 checks)
await window.RMMMultiUserTest();        // Task 50 (24 checks)
await window.RMMAgentSecurityTest();    // Task 45 (58 checks)
await window.RMMStormTest();            // Task 46 (69 checks)
await window.RMMEndToEndTest();         // Task 44 (full loop)
await window.RMMSimulatorTest();        // Task 44
```

The full list is in `src/README.md` ("Architecture" → `src/erp.tests.js`). The
whole RMM regression sweep is **44 suites / 1909 checks**; run them all after
any change to a shared service.

### 7.4 Where to look in the source

- **Architecture & task log** → `src/README.md`.
- **The backlog** → the comment block at the top of `main.pjs` (mirrored in
  `src/SPEC.md`).
- **Config keys** → `config.rmm` in `main.pjs`.
- **The authoritative collector** → the `RMM-COLLECTOR-CORE-START/END` region in
  `index.html` (mirrored from `COL.createCore` in `src/rmm.collector.js`).
- **The access model** → `src/rmm.access.js` (roles, capabilities, scope gates).
- **Tests** → `src/erp.tests.js` (`RMM*Test`).

### 7.5 House rules

- Fold features into the **13 stations**; never add a 14th.
- Always reach services via **`window.ERP.<x>`** — bare identifiers only work in
  inline classic `<script>` in `index.html`.
- Prefer the **hidden-document** pattern for service state, and the **provider
  aggregate** for tenant data.
- Never put a secret in public source (§3.4).
- Enforce access **server-side** (§3.6): hide in the UI, but *decide* at the hub
  (`guardAdmin` + `collectorScopeFilter`, grant RPCs gated on `access.manage`).
- **Realtime must degrade, not fail** (§3.7): never gate the UI on the socket —
  fall back to polling, report presence as unavailable when the hub is down, and
  keep every watched view refreshing off the event stream either way.
- **Never silently overwrite** (§3.7): the store's CAS is the hard barrier and
  the hub's claim/`announce` check is the advisory one — a stale or claim-held
  write is refused and broadcast, never applied.
- Every new service ships with a **stub-backend test suite**, and the README
  build-state line is updated when a task lands.
