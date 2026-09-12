# Roadmap — OpenRPA / OpenFlow integration for the Project U hub

> **Status:** persisted backlog. **Phases 1–7 are complete** (connector
> foundation & identity; collections & document model; work items & queues;
> workflow invocation, robots & Node-RED; real-time event bus bridge;
> field ownership, entity linking, drift-aware sync & conflict review; bundles,
> export/import & the in-app OpenRPA guide);
> Phase 8 remains. Each later phase
> starts only when its predecessor's code review is done and its tests pass.
>
> **Part B** of this file queues a second, independent roadmap — Microsoft
> Entra ID RBAC for RPA-U (7 phases, tasks 1–40) — which begins only after
> Part A (the OpenRPA roadmap, Phases 1–8) is fully complete.
>
> **Confirmed generator identity:** the hub runs as generator `rpa-u`, appId
> `rpa-u`, storage namespace `pu-rpa-u`. **`rpa-u` is the single stub** that
> every new id, storage key, topic and module path in this roadmap uses. Where
> this checklist names `integrate-u`, read it as `rpa-u`. OpenRPA's own
> namespaced files use the `openrpa` / `openrpa_*` prefix
> (`src/core/openrpa/`, storage collections `openrpa_profiles`,
> `openrpa_session`, `openrpa_emulator`, event source `openrpa`).

You are building OpenRPA (OpenIAP) automation capability into the **Project U
integration hub** — the generator that gives IT-U, CRM-U, PSA-U and RMM-U one
canonical identity, a shared integration registry with field ownership and sync
rules, a versioned event bus, cross-tool entity linking, drift-aware sync,
exportable data bundles, and connector monitoring. The work adds OpenRPA /
OpenFlow as a first-class, real-time connector in that hub.

This roadmap has 8 phases, with 5–7 tasks in each (the final phase holds the
fixed 4-task wrap-up).

### Workflow & Execution Rules
1. Persist this checklist in the generator's durable, permanent file tree —
   `src/ROADMAP-openrpa.md` — never in ephemeral scratch storage.
2. **STRICT HOLD - DO NOT START IMPLEMENTATION:** Do NOT write any
   implementation code, create source files, or execute any task yet. Wait until
   I explicitly instruct you that the backlog is complete.
3. Once I give you the signal to proceed, pick ONLY the first uncompleted task
   from the persisted checklist.
4. Implement that single task, write corresponding validation tests, update the
   checklist to mark it complete, and stop to await review before proceeding to
   the next task.

### Platform Rules (apply to every task)
- **Responsive:** every screen stays usable at phone (≈390px) and desktop
  (≈1920px) widths.
- **No secrets in source:** OpenFlow URLs, usernames, passwords and JWTs are
  entered at runtime by the user and stored only in the hub's namespaced local
  storage — never hard-coded in main.pjs, index.html or `src/`.
- **Live sanity:** after each task the generator's live preview loads with no
  console errors.
- **Thumbnail:** ensure `$meta.image` is set to a representative image URL for
  the finished, visually-rich hub.

---

### Core Framework Tasks

Reference template: template-u

OpenRPA reference pack — 65 curated repo files (wire protocol, document/ACL
model, work items, the PowerShell invoke / entity-CRUD / file-storage flows,
browser bridge):
https://user.uploads.dev/file/4c187d77f45ed6ae30969978c51f361a.zip — read its
`INDEX.md` first; start the protocol work in `OpenRPA.Net/WebSocketClient.cs` +
`OpenRPA.Interfaces/IWebSocketClient.cs`, and the file-upload/download API in
`OpenRPA.PS/Files/AddFile.cs` + `GetFile.cs`.

#### Phase 1: Connector Foundation & Identity
1. **[x] [Generator identity]:** Confirm and align the hub's identity — set the
   generator name (kebab-case stub) and `$meta.title` / `$meta.description`
   (+ version) — and record the single stub that every new id, storage key,
   topic and module path in this roadmap must use.
2. **[x] [Connector registry entry]:** Register OpenRPA as a first-class
   connector type in the hub's integration registry, declaring its id, display
   name and branding, capability set (collections, work items, workflows, watch,
   Node-RED), its required connection fields, and its current connection state.
3. **[x] [Connection profiles]:** Let a user create and manage multiple OpenFlow
   endpoints (WebSocket URL/scheme/host/port, tenant/organization, TLS/insecure
   toggle, optional REST base) with field validation and precise error messages,
   persisted under the hub's storage namespace.
4. **[x] [Authentication & session]:** Sign in to OpenFlow with a
   username/password or a pasted JWT, capture the returned token user and its
   roles, detect expiry, refresh/reconnect automatically, and map OpenFlow roles
   onto the hub's permission model.
5. **[x] [Wire protocol client]:** Implement the OpenRPA/OpenFlow message
   envelope (request id, reply-to, command, JSON data) with promise-based
   request/response correlation, per-request timeouts, retry-with-backoff on
   transport failures, and connection-state events surfaced to the rest of the
   hub.
6. **[x] [Offline emulator]:** Provide an in-browser mock of the OpenFlow
   endpoint (a small fixture set of workflows, queues, robots and documents)
   used while the generator is unsaved/previewed or the endpoint is unreachable,
   so every connector feature is demonstrable and testable without a live robot.
7. **[x] [Code review]:** Review this phase end to end — protocol correctness,
   error/edge cases, credential handling, consistency with the hub's existing
   connector conventions, and tests — fix any findings, confirm the phase's
   tests pass, and verify the live preview loads with no console errors at both
   phone and desktop widths.

#### Phase 2: Collections & Document Model
1. **[x] [Document model]:** Normalize OpenFlow documents (id, type, name,
   created/modified timestamps and authors, ACL, version) into typed hub records
   while preserving unknown fields losslessly.
2. **[x] [Collection browser]:** List available collections and browse/query
   documents with paging, projection, ordering, and a query builder supporting
   OpenFlow's JSON query syntax and named-query aliases.
3. **[x] [Create / upsert / update / delete]:** Insert, upsert (by uniqueness
   key), update and delete single or many documents, enforcing optimistic
   concurrency on document version and reporting conflicts distinctly from
   validation and transport errors.
4. **[x] [Workflow documents]:** Read workflow documents and present their queue
   binding, RPA/web flags, parameters (name/type/direction), filename, and
   background/serializable flags, without dumping raw workflow XAML by default.
5. **[x] [ACL, users & roles]:** Mirror OpenFlow users, roles and per-document
   ACL entries, compute the signed-in user's effective rights, and warn before
   any operation that user cannot perform.
6. **[x] [Code review]:** Review this phase end to end — model fidelity,
   query/paging edge cases, concurrency handling, ACL correctness, and tests —
   fix any findings, confirm the phase's tests pass, and verify the live preview
   loads with no console errors at both phone and desktop widths.

#### Phase 3: Work Items & Queues
1. **[x] [Queue management]:** Create, edit and delete work-item queues
   including their workflow binding, robot queue, max retries, retry delay,
   initial delay and success/failed routing queues, with optional purge.
2. **[x] [Enqueue]:** Add single and bulk work items with a JSON payload,
   priority, optional next-run time and file attachments, validating payload
   shape and surfacing per-item results.
3. **[x] [Claim / update / delete]:** Pop the next item from a queue, update an
   item's state, payload, retries and error message/source/type, and delete
   items, honoring the queue's retry policy and any max-retries override.
4. **[x] [Lifecycle semantics]:** Model the item state machine (new → processing
   → success/failed, retries, business-rule failures) and enforce the queue's
   post-processing behavior, including movement to success/failure queues.
5. **[x] [File attachments & storage]:** Upload and download files to and from
   OpenFlow — the metadata record plus its content — list and delete stored
   files, and wire this into work-item attachments so an item can carry its
   files (mirroring `OpenRPA.PS/Files/AddFile.cs` + `GetFile.cs`; this is also
   the storage layer reused by Phase 7's asset export).
6. **[x] [Work board]:** Present items in a filterable board/table grouped by
   state with search, payload inspection, error drill-down, and quick actions
   (retry, cancel, requeue).
7. **[x] [Code review]:** Review this phase end to end — state-transition
   correctness, retry/failure edge cases, bulk-result handling, file-storage
   integrity, and tests — fix any findings, confirm the phase's tests pass, and
   verify the live preview loads with no console errors at both phone and
   desktop widths.

#### Phase 4: Workflow Invocation, Robots & Node-RED
1. **[x] [Invoke workflow]:** Trigger an OpenFlow workflow by queue name or
   workflow id with a payload and correlation id, register the reply route, and
   await the correlated completion with a timeout.
2. **[x] [Results & correlation]:** Map completed/failed replies into hub results
   and events, preserving correlation id, payload, error detail and duration for
   audit.
3. **[x] [Robot registry & presence]:** Discover robot instances and their
   heartbeats/metrics, and show online / offline / stale status with last-seen
   time and version.
4. **[x] [Node-RED instances]:** Ensure, restart and delete Node-RED instances,
   and link each instance to its hub connector record.
5. **[x] [Connector monitoring]:** Provide a live health view per connection
   (state, latency, reconnect count, queue depths, error rate) with thresholds
   and alerts, reusing the hub's existing connector-monitoring surface.
6. **[x] [Code review]:** Review this phase end to end — invocation/timeout
   correctness, presence accuracy, monitoring thresholds, and tests — fix any
   findings, confirm the phase's tests pass, and verify the live preview loads
   with no console errors at both phone and desktop widths.

#### Phase 5: Real-Time Event Bus Bridge
1. **[x] [Register queue / exchange]:** Register the connector's queues and
   exchanges, define their lifecycle across connect/disconnect/reconnect, and
   translate inbound queue messages into normalized hub events.
2. **[x] [Watch change streams]:** Subscribe to OpenFlow document watches for
   configured filters and convert change notifications into normalized events
   carrying collection, id, type and version.
3. **[x] [Event taxonomy]:** Define the OpenRPA topic taxonomy and payload
   schemas (workitem.*, workflow.*, robot.*, collection.*) with a schema version,
   and register them with the hub's versioned event bus.
4. **[x] [Ordering & backpressure]:** Buffer and order events per correlation id
   under load, apply bounded queues with safe drop/compaction, and keep the UI
   thread responsive.
5. **[x] [Replay & audit]:** Persist the connector's event log with sequence
   numbers and support filtered replay and audit by topic, correlation id and
   time range.
6. **[x] [Code review]:** Review this phase end to end — event ordering
   guarantees, backpressure behavior, taxonomy versioning, replay correctness,
   and tests — fix any findings, confirm the phase's tests pass, and verify the
   live preview loads with no console errors at both phone and desktop widths.

#### Phase 6: Registry, Field Ownership, Linking & Drift-Aware Sync
1. **[x] [Field ownership mappings]:** Declare, per mapped entity type, which
   fields are owned by OpenRPA versus each other Project U tool, with sync
   direction and conflict priority.
2. **[x] [Entity linking]:** Link hub entities from IT-U/CRM-U/PSA-U/RMM-U to
   OpenRPA workflows, queues, work items and invocation correlations, with a link
   browser and unlink action.
3. **[x] [Drift detection]:** Compare hub snapshots against OpenFlow document
   versions/timestamps and flag field-, record- and relationship-level drift.
4. **[x] [Reconciliation]:** Apply the ownership rules to reconcile drift under a
   chosen policy (manual review, prefer-hub, prefer-OpenRPA), logging every
   applied change and its source.
5. **[x] [Conflict review]:** Provide a diff view to review and approve or reject
   reconciliation proposals, preserving a decision history.
6. **[x] [Code review]:** Review this phase end to end — ownership-rule
   correctness, conflict precedence, drift false-positive handling, and tests —
   fix any findings, confirm the phase's tests pass, and verify the live preview
   loads with no console errors at both phone and desktop widths.

#### Phase 7: Bundles, Export/Import & In-App Guide
1. **[x] [Bundle schema]:** Define a versioned portable bundle format covering
   connection profiles (secrets excluded), field mappings, entity links and
   OpenRPA document snapshots.
2. **[x] [Export / import]:** Export and import bundles with validation, version
   checks, a dry-run preview and clear error reporting.
3. **[x] [Workflow asset export]:** Export workflow definitions plus their
   referenced assets (images/metadata files) into the bundle, resolving stored
   ids to content via the file-storage layer built in Phase 3.
4. **[x] [In-app OpenRPA guide]:** Add a Help/About section covering connecting
   to OpenFlow, choosing collections, managing queues and work items, invoking
   workflows, reading events, and troubleshooting a failed connection.
5. **[x] [Code review]:** Review this phase end to end — bundle round-trip
   fidelity, secret exclusion, asset resolution, and tests — fix any findings,
   confirm the phase's tests pass, and verify the live preview loads with no
   console errors at both phone and desktop widths.

#### Phase 8: Final Review, Documentation & Polish
1. **[ ] [Code review]:** Review the entire OpenRPA integration end to end —
   correctness, integration between phases (and with the hub's existing
   registry/event-bus/sync code), dead code, console/runtime errors, and the full
   test suite — fix any findings, confirm all tests pass, and verify the live
   preview is error-free at both phone and desktop widths.
2. **[ ] [User instructions]:** Ensure every new page, screen, action and feature
   has corresponding user instructions (help/about section, tooltips, or written
   guidance) so a first-time user can connect OpenRPA and use each feature; fill
   any gaps found.
3. **[ ] [Cleanup]:** Remove the persisted roadmap checklist
   (`src/ROADMAP-openrpa.md`) once the project is finished, so the raw, completed
   checklist does not ship with the generator — keep any genuine documentation it
   produced and confirm nothing else broke.
4. **[ ] [Polish pass]:** Perform a final polish pass across the whole integration
   — spacing, states, transitions, responsive behavior at phone and desktop
   widths, consistent wording, and empty/error/loading states — until it feels
   finished.

---

## Part B — Microsoft Entra ID Role-Based Access Control (RBAC) for RPA-U

> **Status:** queued backlog. **Part B starts only after Part A (OpenRPA
> Phases 1–8) is fully complete.** Part B has 7 phases
> (`Part B · Phase 1` … `Part B · Phase 7`), 6–8 tasks in each, and reuses the
> reference template `it-u`.

You are building Microsoft Entra ID-based Role-Based Access Control (RBAC) for
RPA-U, the Project U integration hub. Focus entirely on delivering robust,
modular, and testable features based on the functional requirements provided.

### Part B Workflow & Execution Rules
1. Persist this checklist in the generator's durable, permanent file tree —
   this file (`src/ROADMAP-openrpa.md`, Part B) — never in ephemeral scratch
   storage.
2. **STRICT HOLD - DO NOT START IMPLEMENTATION:** do not begin any Part B task
   until every Part A task above is complete and Part B has been signalled.
3. Once Part B has been signalled, pick ONLY the first uncompleted Part B task
   from this checklist.
4. Implement that task, write corresponding validation tests, update the
   checklist to mark it complete, and stop to await review before proceeding to
   the next task.

### Part B Platform Rules (apply to every task)
- **Responsive:** every screen stays usable at phone (≈390px) and desktop
  (≈1920px) widths.
- **No secrets in source:** no client secrets, tokens or API keys are
  hard-coded in main.pjs, index.html or `src/`; all identity configuration is
  public-safe and entered at runtime.
- **Live sanity:** after each task the generator's live preview loads with no
  console errors.

### Part B Core Framework Tasks

Reference template: it-u

#### Part B · Phase 1: [Identity Foundation & Integration]
1. **[ ] [Generator Identity]:** Set the generator name and kebab-case stub, set
   `$meta.title` and `$meta.description`, and set `$meta.image` to a
   representative image URL.
2. **[ ] [Auth Integration]:** Integrate the Entra ID sign-in/sign-out and token
   acquisition/renewal logic by referencing the `it-u` generator's
   implementation.
3. **[ ] [Session State]:** Implement a global authentication state
   (Authenticated vs. Signed-out) that controls the initial app entry point and
   prevents access to hub screens when signed out.
4. **[ ] [Token Validation]:** Implement a mechanism to validate the existence
   and expiration of the identity token, triggering silent renewal or
   redirecting to sign-in.
5. **[ ] [Tenant Guard]:** Implement a check to verify the user belongs to the
   authorized Entra ID tenant, redirecting or showing an error for "Wrong
   Tenant" states.
6. **[ ] [Code review]:** Review this phase's work end to end — correctness,
   edge cases, error handling, consistency, and tests — and verify the live
   preview loads with no console errors at both phone and desktop widths.

#### Part B · Phase 2: [RBAC Model & Permission Matrix]
7. **[ ] [Role Definition]:** Define the role hierarchy (Administrator,
   Integration Manager, Operator, Auditor, Viewer) based on Entra ID app roles
   or security group claims.
8. **[ ] [Resource Mapping]:** Map all hub resources (Registry, Sync Rules,
   Event Bus, Entity Links, Bundles, Connector Monitoring, OpenRPA/OpenFlow,
   Settings) to a structured permission key system.
9. **[ ] [Permission Matrix]:** Implement a centralized permission matrix that
   defines the minimum role required for each mapped resource/action.
10. **[ ] [Claim Extraction]:** Implement logic to parse the Entra ID token and
    map the user's identity claims to the defined internal roles.
11. **[ ] [Role State Management]:** Create a reactive state for the current
    user's active permissions to be consumed by UI components.
12. **[ ] [Code review]:** Review this phase's work end to end — correctness,
    edge cases, error handling, consistency, and tests — and verify the live
    preview loads with no console errors at both phone and desktop widths.

#### Part B · Phase 3: [UI Authorization Layer]
13. **[ ] [Auth-Guard Component]:** Create a wrapper component/function that
    hides or disables UI elements based on the current user's permission level.
14. **[ ] [Navigation Guard]:** Implement route-level protection to prevent
    users from navigating to screens they are not authorized to view.
15. **[ ] [Read-Only State]:** Implement a "View-Only" mode for the
    Auditor/Viewer roles that disables all mutation controls across the registry
    and sync rules.
16. **[ ] [Action-Level Enforcement]:** Apply permission checks to specific
    high-impact buttons (e.g., "Deploy Sync," "Delete Registry Entry," "Trigger
    OpenFlow").
17. **[ ] [Unauthorized State]:** Implement a consistent "Unauthorized" UI
    state/toast for users attempting to access restricted areas.
18. **[ ] [Code review]:** Review this phase's work end to end — correctness,
    edge cases, error handling, consistency, and tests — and verify the live
    preview loads with no console errors at both phone and desktop widths.

#### Part B · Phase 4: [Data Mutation & Logic Enforcement]
19. **[ ] [Mutation Guards]:** Implement a client-side interceptor for all data
    mutation functions to verify the user's role before proceeding with the
    logic.
20. **[ ] [Integration Hub Lockdown]:** Secure the OpenRPA/OpenFlow connector
    actions to ensure only authorized roles can trigger agentic RPA automations.
21. **[ ] [Event Bus Access]:** Restrict the ability to publish or subscribe to
    specific versioned event bus topics based on the permission matrix.
22. **[ ] [Bundle Export Security]:** Secure the data bundle export functionality
    to ensure only authorized roles can extract hub configurations.
23. **[ ] [Conflict Resolution Guard]:** Restrict the "Sync/Conflict Resolution"
    tools to the Integration Manager and Administrator roles.
24. **[ ] [Code review]:** Review this phase's work end to end — correctness,
    edge cases, error handling, consistency, and tests — and verify the live
    preview loads with no console errors at both phone and desktop widths.

#### Part B · Phase 5: [Admin & Monitoring Experience]
25. **[ ] [Role Viewer]:** Create an admin screen to view the current user's
    resolved roles and the specific permissions granted by their Entra ID
    claims.
26. **[ ] [Audit Log View]:** Implement a read-only view for the Auditor role to
    monitor connector status and sync drift without mutation capabilities.
27. **[ ] [Identity Debugger]:** Implement a hidden/admin-only tool to inspect
    the raw Entra ID token claims for troubleshooting.
28. **[ ] [Role Management Guide]:** Provide a UI-based instruction set for
    admins on how to assign the required Entra ID App Roles/Groups.
29. **[ ] [Connectivity Status]:** Implement a visual indicator for the identity
    provider's state (Connected, Offline, or Degraded).
30. **[ ] [Code review]:** Review this phase's work end to end — correctness,
    edge cases, error handling, consistency, and tests — and verify the live
    preview loads with no console errors at both phone and desktop widths.

#### Part B · Phase 6: [Edge Case & Security Hardening]
31. **[ ] [Token Expiry Handling]:** Ensure the app gracefully handles expired
    tokens by forcing a re-auth flow without losing current view state.
32. **[ ] [Zero-Secret Audit]:** Verify that no client secrets, passwords, or API
    keys are hardcoded in the source; all config must be public-safe.
33. **[ ] [Client-Side Boundary]:** Document and verify the boundary between
    browser-enforced RBAC and the requirement for a trusted backend for true
    security.
34. **[ ] [Offline Mode]:** Implement a state where the app disables all
    auth-dependent features if the identity provider is unreachable.
35. **[ ] [Session Termination]:** Ensure that signing out clears all local
    session state and tokens, returning the app to a fully unauthenticated
    state.
36. **[ ] [Code review]:** Review this phase's work end to end — correctness,
    edge cases, error handling, consistency, and tests — and verify the live
    preview loads with no console errors at both phone and desktop widths.

#### Part B · Phase 7: [Final Review, Documentation & Polish]
37. **[ ] [Code review]:** Review the entire project end to end — correctness,
    integration between features, dead code, console/runtime errors, and the
    full test suite — fix any findings and confirm all tests pass.
38. **[ ] [User instructions]:** Ensure every page, screen, action, and feature
    has corresponding user instructions (a help/about section, tooltips, or
    written guidance) so a first-time user can understand and use each one; fill
    any gaps found.
39. **[ ] [Cleanup]:** Remove the persisted roadmap checklist (this Part B
    section, and the Part A section once both are done) so the raw, completed
    checklist does not ship with the finished project — keep any genuine
    documentation it produced and confirm nothing else broke.
40. **[ ] [Polish pass]:** Perform a final polish pass across the whole project —
    spacing, states, transitions, responsive behavior at phone and desktop
    widths, consistent wording, and empty/error/loading states — until it feels
    finished.


---

## Part C — RPA-U feature-set roadmap (Rewst capability parity)

> **Status:** queued backlog. **Part C starts only after Part A (OpenRPA
> Phases 1–8) and Part B (Entra ID RBAC) are fully complete.** Part C has 15
> phases (`Part C · Phase 1` … `Part C · Phase 15`), 4–7 tasks in
> each, and reuses the reference template `it-u`. It closes the remaining
> capability gaps between RPA-U and Rewst — identity, the visual workflow
> engine, the action/form/app builders, the integration runtime, AI features,
> developer tooling, endpoint management and platform operations.
>
> The tasks below retain their original numbering (Part C tasks 1–88) so they
> can be matched against the source backlog.

### Part C Workflow & Execution Rules
1. Persist this checklist in the generator's durable, permanent file tree —
   this file (`src/ROADMAP-openrpa.md`, Part C) — never in ephemeral scratch
   storage.
2. **STRICT HOLD - DO NOT START IMPLEMENTATION:** do not begin any Part C task
   until every Part A and Part B task above is complete and Part C has been
   signalled.
3. Once Part C has been signalled, pick ONLY the first uncompleted Part C task
   from this checklist.
4. Implement that task, write corresponding validation tests, update the
   checklist to mark it complete, and stop to await review before proceeding to
   the next task.

### Part C Platform Rules (apply to every task)
- **Responsive:** every screen stays usable at phone (≈390px) and desktop
  (≈1920px) widths.
- **No secrets in source:** no client secrets, tokens or API keys are
  hard-coded in main.pjs, index.html or `src/`; all configuration is
  public-safe and entered at runtime.
- **Live sanity:** after each task the generator's live preview loads with no
  console errors.

### Part C Core Framework Tasks

Reference template: it-u

You are building out RPA-U — the Project U integration/identity hub — into a full automation platform by closing the capability gaps against Rewst. Focus entirely on delivering robust, modular, and testable features based on the functional requirements provided.

This roadmap has 15 phases, with 5–7 tasks in each.

### Workflow & Execution Rules
1. Persist this checklist in durable, permanent project storage that survives across sessions — for example a `CLAUDE.md` file at the project root, or a roadmap file under `src/` (e.g. `src/ROADMAP.md`) — never in ephemeral scratch storage.
2. **STRICT HOLD - DO NOT START IMPLEMENTATION:** Do NOT write any implementation code, create source files, or execute any task yet. Wait until I explicitly instruct you that the backlog is complete.
3. Once I give you the signal to proceed, pick ONLY the first uncompleted task from the persisted checklist.
4. Implement that single task, write corresponding validation tests, update the checklist to mark it complete, and stop to await review before proceeding to the next task.

---

### Core Framework Tasks

Reference template: it-u

#### Part C · Phase 1: [Identity & Foundation]
1. **[ ] [Generator Setup]:** Set the generator name/slug to `rpa-u`, configure `$meta.title` and `$meta.description`, and set `$meta.image` to a representative automation platform visual.
2. **[ ] [RBAC Integration]:** Implement the Entra ID SSO and RBAC layer referencing `it-u` patterns for identity, roles, and session management.
3. **[ ] [Multi-Tenant Core]:** Establish the parent/child organization model ensuring strict data isolation for variables, forms, and workflows.
4. **[ ] [User Management UI]:** Create a user management interface to add/remove users and assign built-in or custom granular roles.
5. **[ ] [Tenant Onboarding]:** Build a bulk client onboarding mechanism capable of importing organization data from a PSA.
6. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 2: [Automation Engine - Canvas]
7. **[ ] [Visual Workflow Builder]:** Implement a drag-and-drop canvas where actions are represented as tasks with connection lines.
8. **[ ] [Execution Flow]:** Build the logic for success/failure/always/custom transitions between tasks.
9. **[ ] [Conditional Branching]:** Implement decision paths driven by boolean logic or custom expression evaluations.
10. **[ ] [Subworkflow Engine]:** Enable reusable subworkflows with typed inputs/outputs that publish results back to a parent workflow.
11. **[ ] [Looping Logic]:** Implement loop constructs with per-item iteration over data lists.
12. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 3: [Automation Engine - Reliability]
13. **[ ] [Error Isolation]:** Implement "try/catch" style error isolation for individual tasks to prevent total workflow collapse.
14. **[ ] [Retry & Skip]:** Build configurable retry policies and "skip-on-failure" logic for task execution.
15. **[ ] [Execution History]:** Create a run-log system tracking results per execution with retention and audit capabilities.
16. **[ ] [Time-Saved Analytics]:** Implement a tracker calculating estimated time saved per workflow run.
17. **[ ] [Workflow Bundling]:** Create a mechanism to export and import workflows as shareable JSON/YAML bundles.
18. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 4: [Action Library & Kits]
19. **[ ] [Action Registry]:** Build a per-integration callable action library categorized by core, transform, and workflow types.
20. **[ ] [Action Picker]:** Implement a browsable UI for selecting actions with strictly typed inputs and outputs.
21. **[ ] [Curated Kits]:** Develop "Action Kits" — pre-defined collections of actions tailored for specific integration use cases.
22. **[ ] [Input Mapping]:** Create a UI for mapping workflow context variables into action input fields.
23. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 5: [Triggers & Events]
24. **[ ] [Scheduling Engine]:** Implement cron-based and fixed-time interval triggers for automation.
25. **[ ] [Webhook System]:** Build inbound and outbound webhook handlers with payload mapping.
26. **[ ] [Form-Based Triggers]:** Connect form submissions to trigger specific workflow executions.
27. **[ ] [External Event Triggers]:** Implement listeners for connected tools (PSA ticket-saved, RMM events, M365 alerts).
28. **[ ] [Trigger Management]:** Build a dashboard to enable/disable triggers and monitor last-fired status.
29. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 6: [Form Builder - Core]
30. **[ ] [Form Canvas]:** Implement a drag-and-drop authoring canvas with a comprehensive component library.
31. **[ ] [Theming Engine]:** Build light, dark, and custom CSS theme support for form rendering.
32. **[ ] [Multi-Page Logic]:** Implement multi-page forms with named pages and sequential navigation.
33. **[ ] [Dynamic Options]:** Create a system for form options backed by static lists or live workflow-driven queries.
34. **[ ] [Filter Heuristics]:** Implement filter rules and manual overrides for dynamic form components.
35. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 7: [Form Builder - Advanced]
36. **[ ] [Form Access Control]:** Implement visibility rules (public, owner-only, allow-list, all-orgs).
37. **[ ] [Component Exceptions]:** Build a mechanism for per-customer component overrides without duplicating the form.
38. **[ ] [Workflow Binding]:** Enable binding a form to a workflow directly from the builder.
39. **[ ] [Form Lifecycle]:** Implement form cloning, embedding code generation, and export/import.
40. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 8: [App Builder]
41. **[ ] [App Canvas]:** Create a drag-and-drop builder for hosted pages using a layout grid of components (text, images, buttons, tables, charts).
42. **[ ] [White-Labeling]:** Implement custom subdomain mapping and theme overrides for hosted apps.
43. **[ ] [App Gating]:** Build a built-in login page to gate access to specific app pages.
44. **[ ] [App Permissions]:** Implement a granular role-based access system for app and page visibility.
45. **[ ] [Prebuilt App Library]:** Develop a set of starter apps (e.g., Admin Dashboard, Client Portal) to serve as templates.
46. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 9: [Integration Runtime - Core]
47. **[ ] [Integration Marketplace]:** Build a stock marketplace for discovering ready-made connectors and API action sets.
48. **[ ] [Custom Connector Builder]:** Implement a way to build integrations via hand-coding or OpenAPI spec import.
49. **[ ] [Credential Manager]:** Create a secure, reusable authentication store for managed credentials shared across integrations.
50. **[ ] [Organization Mapping]:** Implement a scalable org-mapping system with auto-suggestion and manual override.
51. **[ ] [Org Variable Engine]:** Build a variable system with hierarchical inheritance (Global -> Parent Org -> Child Org).
52. **[ ] [Config Overrides]:** Implement integration overrides allowing child orgs to execute using parent config.
53. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 10: [Integration Runtime - Bundles]
54. **[ ] [Microsoft Cloud Bundle]:** Implement the integrated bundle for Azure, M365, Intune, and Entra ID.
55. **[ ] [Context Injection]:** Build the mechanism to inject organization variables into workflow execution contexts.
56. **[ ] [API Action Set]:** Map the functional requirements of the cloud bundle to callable actions in the action library.
57. **[ ] [Bundle Auth Scoping]:** Ensure every Microsoft cloud bundle action resolves credentials and identity against the executing organization, refusing cross-tenant execution.
58. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 11: [AI Capabilities]
59. **[ ] [Platform Assistant]:** Implement an AI assistant for troubleshooting failures and answering platform questions.
60. **[ ] [AI Workflow Author]:** Build a "propose-then-approve" agent that authors workflows, forms, and scripts.
61. **[ ] [AI Documentation]:** Implement automated workflow documentation using custom instructions and guardrails.
62. **[ ] [MCP Endpoint]:** Create a token-authenticated MCP-style endpoint for external AI coding tools to interact with the tenant.
63. **[ ] [Custom AI Agents]:** Enable users to build and deploy their own agents to drive the platform from external interfaces.
64. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 12: [Developer Tooling]
65. **[ ] [Templating Engine]:** Implement a template engine with filters, data types, and list/dict comprehensions.
66. **[ ] [Deep Extraction]:** Build path-based extraction logic for nested payloads with integrated data redaction.
67. **[ ] [Scripting Interpreter]:** Implement the interpreter for the platform's internal alternate scripting language.
68. **[ ] [Live Debug Editor]:** Create a live editor for running/debugging individual steps, scripts, and variables against real data.
69. **[ ] [Advanced Code Editor]:** Integrate a rich editor with syntax highlighting, completion, and find/replace.
70. **[ ] [Context Viewer]:** Build a live viewer for task output schemas, published aliases, and workflow context.
71. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 13: [Endpoint & RMM]
72. **[ ] [Cross-Platform Agent]:** Implement the endpoint agent for Windows/macOS/Linux for device sync and script execution.
73. **[ ] [Deployment Tooling]:** Build integration for Intune and ImmyBot for agent distribution.
74. **[ ] [Bulk Onboarding]:** Implement the bulk deployment flow for endpoint agents.
75. **[ ] [Remote Scripting]:** Create the capability for custom remote scripting execution on endpoints.
76. **[ ] [Inventory Tracking]:** Build the agent-inventory tracking and status monitoring system.
77. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 14: [Platform Operations]
78. **[ ] [Usage Dashboard]:** Implement a dashboard for tasks performed, success rates, and time-saved metrics with CSV export.
79. **[ ] [Regional Deployment]:** Configure regional deployment zones with documented allow-list IPs.
80. **[ ] [Webhook Rate Limiting]:** Implement rate limiting for webhooks with documented limits and mitigation strategies.
81. **[ ] [Marketplace Versioning]:** Build a versioning system for prebuilt automations (synced vs unsynced).
82. **[ ] [Migration Engine]:** Implement version migration and deprecation handling for workflows.
83. **[ ] [Community Program]:** Establish a support/community framework for users.
84. **[ ] [Code review]:** Review this phase's work end to end — correctness, edge cases, error handling, consistency, and tests — ensure live preview loads without console errors at phone and desktop widths, and confirm tests pass.

#### Part C · Phase 15: [Final Review, Documentation & Polish]
85. **[ ] [Code review]:** Review the entire project end to end — correctness, integration between features, dead code, console/runtime errors, and the full test suite — fixing any findings and confirming all tests pass.
86. **[ ] [User instructions]:** Ensure every page, screen, action, and feature has corresponding user instructions (a help/about section, tooltips, or written guidance) so a first-time user can understand and use each one; fill any gaps found.
87. **[ ] [Cleanup]:** Remove the persisted roadmap checklist (e.g. `src/ROADMAP.md`, or the checklist section in `CLAUDE.md`) once the project is finished, so the raw, completed checklist does not ship with the finished project — keep any genuine documentation it produced and confirm nothing else broke.
88. **[ ] [Polish pass]:** Perform a final polish pass across the whole project — spacing, states, transitions, responsive behavior at phone and desktop widths, consistent wording, and empty/error/loading states — until it feels finished.
