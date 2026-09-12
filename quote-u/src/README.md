# quote-u

The **quoting system of record** for the small-business pipeline — an internal
quote builder plus a tokenized client approval portal and an approval
orchestrator. Quotes are immutable versions made of line items (one-time and
MRR) and option groups; every price is captured as an immutable snapshot; a
sent version is frozen and is never re-priced. The client opens a tokenized
link, toggles options and approves; approval recomputes totals from frozen data
and drives idempotent external writes (opportunity, note, revenue line,
invoice). All money is integer cents, the portal never exposes cost or margin,
and every transition is append-only audited.

Pipeline sibling: **CRM-U** is the CRM/PSA and business source of truth
(accounts, contacts, deals/opportunities, the service book). quote-u talks to
it through the connector gateway / pipeline bus — never by sharing storage.

## Build process

The build is driven by the atomic roadmap in the project-root `roadmap.pjs`
(checklist file; root files don't ship with the generator and reset between
sessions — re-derive from the attached spec if it's missing). One task at a
time: implement → validate (self-tests) → mark `[x]` → await review.

The previous generator in this workspace was CRM-U. Its full source is
preserved at
`https://user.uploads.dev/file/6c5becd3a57822f960375fcda04d7260.zip`
(main.pjs + index.html + src/**) — **vendor from it** when a roadmap phase
says to reuse CRM-U's document store / sync / backup / capacity / hub / bus
infrastructure, rather than re-inventing it.

## Layout of the code (current)

- `main.pjs` — `$meta` (title/description/tags) + the three plugin imports the
  app builds on: `kv-plugin` (local cache + hub config), `upload-plugin`
  (versioned editable-file document store) and `server-plugin` (the
  authoritative server socket added in later phases).
- `index.html` — application shell markup: topbar, station sidebar, view root.
- `src/quote-u.css` — the design system (CSS custom props, topbar/sidebar/drawer
  shell, cards, buttons, states, self-test report, toasts). Seeded from CRM-U so
  the pipeline shares one visual language; extend it, don't fork it.
- `src/app.js` — the station framework (`window.QU`): module registry + hash
  router + shell states (loading / empty / error), the responsive drawer, the
  env pill and the self-test report view. Every later station registers into
  this.
- `src/modules.js` — the nine station descriptors (`window.QU_MODULES`): id,
  label, tagline, icon, empty-state copy. Quote-rendering code attaches to
  `window.QU_RENDERERS.<id>`.
- `src/selftest.js` — the self-test runner (`window.QU_SELFTEST`).
- `src/store.js` — the versioned document store (`window.QU_STORE`), adapted
  from CRM-U's proven layer: one canonical editable-file document per entity
  group (head + numbered part files), a monotonic revision and SHA-256 content
  hash on every write, a locally cached edit key, a fast kv local cache, and a
  revision guard so no device silently overwrites a newer revision.
- `src/money.js` — the money engine (`window.QU_MONEY`): every monetary value is
  integer cents (fixed CAD in v1, with a reserved `currency` column), exact
  BigInt-backed arithmetic, basis-point rates, exact parsing/formatting and a
  stored-field auditor that proves no float reached a money-shaped field.
- `src/totals.js` — the totals engine (`window.QU_TOTALS`): one pure
  implementation of one-time / MRR / twelve-month / deal-value totals plus
  selection resolution, shared by the builder preview, the portal and the
  approval record so no surface can disagree.
- `src/tax.js` — the indicative-tax policy (`window.QU_TAX`): normalizes the
  configurable `quoteTaxPolicy` (`main.pjs`: `gst_rate_bp`, `gst_label`, `show`,
  `disclaimer`) and derives an **indicative** tax line from the shared totals
  via `QU_MONEY.tax`. It never asserts an authoritative figure — the DTO marks
  the amount indicative and names the invoicing/accounting system as the
  authoritative source, so quote-u cannot contradict finance.
- `src/lineitems.js` — the line-item model (`window.QU_LINEITEMS`): the
  canonical line shape (sort order, section, kind, description, MPN, SKU,
  quantity, unit cost/sell cents, optional flag, option-group reference,
  selected-by-default, catalog/price-snapshot references, pricing mode,
  currency), its validation/normalisation, and its DERIVED values. No
  authoritative total and no margin is ever stored — `derive()` computes the
  amount/cost/margin/rates on demand and `audit()` proves a stored record
  carries neither a derived value nor a float.
- `src/optiongroups.js` — the option-group model (`window.QU_OPTIONGROUPS`): a
  group's name and selection type (`bundle` | `multi` | `optional`; the legacy
  spelling `single` is still accepted as a read-time alias — see task 56),
  membership
  validation (every grouped line references a real, same-version, optional
  group), and the enforcement that a single-select group has at most one
  selected line in any selection state. Delegates to `QU_TOTALS` for repair.
- `src/catalog.js` — the internal product catalog (`window.QU_CATALOG`): item
  shape (SKU, MPN, description, category, default kind, unit cost, default
  markup bp, currency, active), search/matching, cost+markup sell pricing,
  add-to-quote line building, pluggable `content_provider`s (default `none`),
  and a service that persists into the `catalog_items` document and installs the
  bundled pipeline seed (`main.pjs` `catalogSeed`) once.
- `src/pricesnapshots.js` — immutable price capture (`window.QU_PRICESNAPSHOTS`):
  a sealed `price_snapshot` (source, distributor SKU, MPN, unit cost / list
  price cents, quantity available, warehouse, currency, captured_at + the full
  raw source response), hash-sealed and never edited or deleted; `bind` /
  `applyCost` attach a snapshot to a line; age + staleness; a service over the
  `price_snapshots` document that dedupes identical captures and refuses
  `update`/`remove` as `immutable`.
- `src/lifecycle.js` — the quote-version lifecycle state machine
  (`window.QU_LIFECYCLE`): the single place every transition is validated, the
  source of each transition's audit event, and the client half of the
  server-authoritative check (`applyChecked` / `attachServerValidator`).
- `src/audit.js` — the append-only audit log (`window.QU_AUDIT`): the
  `quote_events` record shape, the event catalog + categories, the deterministic
  canonical-JSON hash chain, the pure append-only proofs (`verifyAppendOnly` /
  `verifyTail` / `verifyChain`) and the `createService` that appends through the
  revision-guarded document store.
- `src/numbering.js` — quote identity (`window.QU_NUMBERING`): the configurable
  number scheme (tokens, UTC date parts, sequence width/bucketing), the pure
  render/parse helpers, and the service that allocates unique, stable,
  never-reused numbers through the quotes document's `numbering` header.
- `src/mailpermission.js` — the mail permission (`window.QU_MAIL`, task 48): one
  application permission `Mail.Send` scoped to the `sales` group, with
  `send_as: "own_mailbox"` and shared mailboxes never allowed. `authorize`
  resolves the sender and returns a precise refusal (`unknown_sender`,
  `not_in_scope`, `shared_mailbox_forbidden`, `not_own_mailbox`,
  `sender_required`) or a `send_as_rep` grant. The mail connector enforces the
  gate on every send (including the `mailto:` transport), and the grant persists
  as the `mail_permission` document.
- `src/fieldmaps.js` — the field-map registry (`window.QU_FIELDMAPS`, task 49):
  mappings are DECLARED (derived from the same `SCHEMA` the normalizer uses, so
  map and parser cannot drift) and PROVEN against a captured payload
  (`verifyCapture` records the capture ref, matched/absent fields and extra
  keys). A capture missing a required field fails `capture_mismatch`; an
  unverified mapping is `mapping_not_verified` and `enablement()` blocks it, so
  a guessed mapping can never be enabled.
- `src/secrets.js` — secret discipline (`window.QU_SECRETS`, task 49): recognises
  credential-shaped values (private keys, provider tokens, bearer/JWT, long
  hex), refuses any declaration or client surface that carries one
  (`assertClean`/`assertSurfaces`), models a secret as an identity
  `reference(name)` that cannot carry a value, and `redact`s without disclosing
  even the length.
- `src/bus.js` — the pipeline bus (`window.QU_BUS`, task 50): publishes audit
  events as the versioned `pipeline.quote-event` envelope to the
  `bus-quote-events` stream, persists them (idempotent by envelope id) in the
  `bus_events` document, delivers to the gateway `bus.publish` and fans out to
  registered webhooks (`bus.webhookPost`), retrying offline pending events.
- `src/connectors.js` — the connector gateway (`window.QU_CONNECTORS`): every
  cross-system read/write goes through one allowlisted `call()` that carries the
  caller's account scope and records a call log. Ships `createMockPsa()` (the
  stand-in PSA adapter seeded with companies/contacts/opportunities) so quote
  creation and external linking are testable end-to-end until the real pipeline
  bus arrives in Phase 8. Task 46 added governance on top: a per-connector
  MANIFEST declaring each function's effect (`read`/`write`; an unlisted
  function is refused), per-connector enable/disable
  (`setEnabled`/`isEnabled`/`effectOf`), identity ROLES
  (`roles`/`assignRole`/`defaultRole`; an unknown role is denied fail-closed and
  a per-connector restricted role list is honoured), a GATEWAY KEY indirection
  holding a NAME only (`keyName`; a secret-shaped declaration is refused)
  resolved at call time by an injected KEYSTORE (`setKeystore`), `setLogSink`
  for the centralized call log, and `verify()`.
- `src/quotes.js` — quote creation & external linking (`window.QU_QUOTES`):
  `createQuote` validates company + contact (contact must belong to the company)
  and allocates a number via `QU_NUMBERING`; `linkOpportunity` /
  `createOpportunity` tie a quote to a PSA opportunity (only when it has none,
  and only within the same account); `listQuotes`/`getQuote` are scope-filtered.
  All lookups go through the gateway's IDOR guard; creation and opportunity
  writes are appended to the audit log.
- `src/portalview.js` — the client-safe portal serializer (`window.QU_PORTALVIEW`):
  one function that turns a quote + version + lines + groups + selection into
  the DTO every client-facing surface (portal, print, later the approval
  record) renders — an allowlist of client-visible fields, so unit cost,
  margin, snapshot cost and every other internal field can never leak
  (invariant I4). Also exposes `renderHtml` (the `.pqv*` web/print view) and
  `toText`.
- `src/quoteversions.js` — versioning & freeze (`window.QU_VERSIONS`): the
  version record shape + validation, the **only** producer of a frozen record
  (`freezeVersion`, which seals the frozen record itself), the pure
  immutability proofs (`sealBundle`/`immutability`/`assertImmutable`), the
  freeze-field stripper used by every mutator, and `createService` — the CRUD,
  totals, freeze / revise-into-a-new-draft, client-view and
  verify-against-server surface over the `quote_versions` / `line_items` /
  `option_groups` documents. The service also installs a **store write guard**
  so a frozen version (and its lines/groups) is refused at the storage layer
  even if some future code path tried to bypass the module.
- `src/portaltokens.js` — portal token scheme (`window.QU_PORTALTOKENS`): mints
  opaque, high-entropy secrets (64 hex chars) that are stored **only** as a
  SHA-256 hash with a fixed prefix (the plaintext is never persisted —
  `assertNoSecret` proves a stored record carries no `secret`/`token` field),
  with a token id distinct from the secret, plus expiry, revocation and
  single-use (`markUsed`). `verify` uses a constant-time compare and
  `statusOf`/`isActive` classify active/expired/revoked/used; `linkFor` builds
  the client URL `https://perchance.org/<gen>#/q/<secret>`. `createService`
  persists into the `portal_tokens` document.
- `src/sendpipeline.js` — the ordered, failure-aware send pipeline
  (`window.QU_SEND`): `send` freezes the current version (minting provenance —
  task 17), mints a portal token, delivers the client link by email through the
  connector gateway's `mail` adapter as the rep's own mailbox, then flips the
  quote to `sent`; a failure at any later step **compensates** by revoking the
  freshly minted token and recording the failure, so a failure never leaves a
  half-sent quote nor a sent quote without a valid link. Also exposes `resend`,
  `revokeLinks`, `linkState`, `preflight`, `staleness` and the normalized
  expiry/staleness `policy`.
- `src/portal.js` — the tokenized portal's front door (`window.QU_PORTAL`): the
  `#/q/<secret>` route helpers (`parseHash`/`isPortalRoute`/`routeFor`), a
  proxy-aware `resolveIp` (x-forwarded-for / x-real-ip / cf-connecting-ip, with
  a right-most-hop default so a client cannot spoof its own address), a sliding
  window `createRateLimiter`, and `createApi` — a **default-deny** dispatcher
  that mounts read/action services' routes, rate-limits per IP and per token
  (429 + `retry-after`), and answers 404 for any unknown path/method/token,
  410 for revoked/expired/used links, and 500 `internal` on a handler throw.
- `src/portalread.js` — the portal read surface (`window.QU_PORTALREAD`): the
  ONLY way a token holder pulls quote data. It verifies the secret, refuses a
  version that is not frozen (409 `not_frozen`) or belongs to another quote,
  builds the response through the single client-safe serializer
  (`QU_VERSIONS.clientView` → `QU_PORTALVIEW`), re-audits it (invariant I4),
  consumes a `single_use` link on first open, emits a `viewed` portal event
  (task 26), and returns a token DTO that carries the token id but never the
  secret or its hash.
- `src/portalevents.js` — portal event capture (`window.QU_PORTALEVENTS`): the
  portal's policy over the append-only audit log. Opening a link records ONE
  `viewed` event per token (deduped) and each real option change records an
  `option_changed` event with the selected ids; both carry the token id, the
  resolved IP and the user agent and never the secret. Metadata is bounded
  (`clampText`) and selections are deduped/order-independent; `history`/
  `summary` expose the per-token trail.
- `src/portalactions.js` — the portal selection & decision actions
  (`window.QU_PORTALACTIONS`): `select` validates a proposed option set against
  the shared group rules and returns display-only recomputed totals (no write),
  recording an `option_changed` event when the selection actually changes;
  `approve` (typed name required) and `decline` validate the selection and move
  the **quote's** status through `QU_LIFECYCLE.applyChecked` — always consulting
  the authoritative server validator, so the client is never the authority —
  then persist the decision, audit it with the token id, and revoke the
  version's remaining links; `expire` is allowed only past expiry (or with
  `ctx.force`). A successful approval also writes exactly one acceptance record
  through `QU_APPROVALS` (task 28). The frozen version is never mutated.
- `src/approvals.js` — the acceptance record (`window.QU_APPROVALS`): the
  immutable `approvals` document with exactly one row per quote VERSION
  (invariant I2), enforced by a revision-guarded read-check-append-save (a racing
  writer loses `conflict`, re-reads and finds the winner's row). Each row holds
  the server-recomputed integer cents, the selected line ids, the typed approver
  name, the token id, IP, user agent and `approved_at`, and never the secret
  (`assertNoSecret` + `QU_MONEY.auditStoredMoney`); `verify`/`uniqueByVersion`
  detect a doctored duplicate.
- `src/recompute.js` — the server-side recompute (`window.QU_RECOMPUTE`): the
  authoritative totals pass that refuses any version that isn't frozen
  (`not_frozen`) and any line/group that belongs to a different version
  (`foreign_line`/`foreign_group`), then delegates to the shared `QU_TOTALS`
  engine over the frozen records — browser math is display-only. Also extracts
  and compares a client's claimed totals (`claimedTotals`/`compareClaimed`), so
  a tampered client total is recorded and ignored rather than trusted.
- `src/outbox.js` — the idempotent outbox (`window.QU_OUTBOX`, document
  `outbox_jobs`): the side-effect queue with a unique key per
  `version_id + action` (re-enqueue dedupes), states pending/running/done/
  failed, attempt count, last error and an exponential backoff
  (`backoffMs`), plus an interval worker (`runDue`) that retries failed jobs and
  marks one terminal after `maxAttempts` (or immediately when no handler is
  registered). A `done` job is never re-run.
- `src/oppsync.js` — opportunity update on approval (`window.QU_OPPSYNC`): the
  outbox handler that, when a linked quote is won, performs the gated
  `psa.updateOpportunity` write with the deal value = selected one-time +
  12 × MRR (the 12-month value) and audits it (`opp_updated`). The stage is the
  policy `won_stage` when `auto_close` is on, otherwise the `fallback_stage`
  (set-stage and let a human close); the write is idempotent by the outbox key.
- `src/oppnote.js` — opportunity note write on approval (`window.QU_OPPNOTE`,
  task 32): the outbox handler that attaches a products/costs/part-numbers note
  to the linked PSA opportunity so its downstream deal sync carries the sold
  detail, not just a bare amount. The block is derived from the FROZEN version's
  accepted lines (join the immutable price snapshots the lines reference) and
  written through the gated `psa.writeNote` adapter (idempotent by the outbox
  key), audited as `note_written`. It is an INTERNAL write, so costs are
  included; it never touches a client surface.
- `src/revenue.js` — revenue-line write on approval (`window.QU_REVENUE`,
  task 33): the outbox handler that writes one revenue/product line per accepted
  frozen line (`psa.writeRevenueLines`), carrying description/sku/mpn/kind/
  quantity/unit price/amount/currency/recurring, audited as `products_written`.
  Keyed by version so a retried job applies at most once.
- `src/invoiceintents.js` — invoice-intent double-billing guard
  (`window.QU_INVOICEINTENTS`, document `invoice_intents`, task 34): exactly one
  row per quote VERSION (invariant I2), recording the chosen path (direct | psa),
  status and external reference. The row is claimed inside a revision-guarded
  read-check-append-save BEFORE any external invoicing call, so a second attempt
  — same path or the other — is refused with `already_invoiced`; the loser of a
  revision race re-reads and refuses rather than overwriting the winner.
  `version_id`/`path`/`amount_cents` are immutable; only the status block
  (`status`/`external_reference`/`error`) may reconcile an update back.
- `src/invoicedirect.js` — Path A: direct accounting invoice
  (`window.QU_INVOICEDIRECT`, task 35): the outbox handler (`invoice_direct`)
  that turns an approved frozen version into an accounting invoice — upserts the
  accounting customer (keyed by the company mapping, idempotent), creates the
  pre-tax invoice from the accepted frozen lines through the gated accounting
  connector (which owns the authoritative tax/total), reconciles the created
  reference into the `invoice_intents` row and audits `invoice_created`. It
  CLAIMS the intent before the external call, so a version already claimed on
  the other path is refused terminally (`already_invoiced`) and a retry cannot
  create a second invoice.
- `src/invoicepsa.js` — Path B: PSA invoice
  (`window.QU_INVOICEPSA`, task 36): the outbox handler (`invoice_psa`) that
  hands the approved selection's product/revenue records to the PSA (CRM-U)
  through the gated connector; the PSA's own accounting sync produces the
  invoice and quote-u reconciles the returned PSA reference into the
  `invoice_intents` row, auditing `invoice_created`. Same double-billing guard
  as Path A (the intent is claimed before the call, so the two paths are
  mutually exclusive), idempotent by a stable `invoice_psa:<version>` key, and
  never asserts a tax figure (the PSA owns it).
- `src/invoicemapping.js` — company↔customer & product↔PSA-catalog mappings
  (`window.QU_INVOICEMAPPING`, document `invoice_mappings`, task 37):
  `company_customer` maps a company to one accounting customer key (and may set
  a `preferred_path`); `product_catalog` maps a line's SKU/MPN/catalog ref to a
  PSA catalog product id. Pure `resolveCustomerKey`/`resolvePsaProduct`/
  `preferredPath` helpers plus a persistable service (upsert replaces an active
  duplicate, `remove` deactivates, secrets are refused) and an Admin `renderZone`.
- `src/invoicepaths.js` — invoice path selection (`window.QU_INVOICEPATHS`,
  task 37): the policy that decides which invoicing path a version uses —
  explicit → company mapping `preferred_path` → `default_path` → only-enabled —
  refusing (`path_disabled`/`no_path`) rather than silently doing nothing, plus
  a router that delegates to the chosen path's service. The intent guard stays
  the authority on which path a version actually used (`usedPathFor` reads it back).
- `src/features.js` — operational flags & data mode (`window.QU_FEATURES`,
  document `feature_flags`, task 38): the single control surface over external
  effects — `kill_switch`, per-feature `write_flags`, `data_mode`
  (live | mock | lockdown) and `require_internal_review`. `wrapGateway` wraps the
  connector gateway so every call is classified (write vs read) and checked at
  one boundary; a refusal is a policy result (`policy: true`) the outbox treats
  as terminal, so a disabled write is not retried forever. `sendGate` gates
  sends on the internal-review state, and an Admin `renderZone` edits the flags.
  Distributor reads are classified and gated on the `distributor_read` flag;
  `wrapGateway` also forwards `callAsync`/`register` so async distributor calls
  are checked at the same boundary. Task 45 added a `content_read` flag (its
  `content` connector is classified and gated like the distributor reads), and
  the wrapper also forwards the task-46 governance surface
  (`effectOf`/`manifest`/`setEnabled`/`isEnabled`/`enable`/`disable`/`roles`/
  `assignRole`/`defaultRole`/`setKeystore`/`keyName`/`setLogSink`/`verify`).
- `src/distributors.js` — shared read-only distributor layer
  (`window.QU_DISTRIBUTORS`, tasks 40–44): the one canonical record shape
  (`RECORD_FIELDS`) and the declarative `SCHEMA` behind it (per-field types +
  wire aliases, incl. explicit integer-cents aliases) with `normalizeWire`
  resolving ANY source's keys to that shape (unknown keys dropped; `strict`
  refuses them), `validateRecord`/`assertRecord`/`toDisplay`, the executable
  read-only guarantee (`assertReadOnly` refuses any non-read with
  `destructive_call`; the HTTP transport hard-codes `GET` and whitelists its
  query params), the polite request engine (`createThrottle` = start-to-start
  spacing + concurrency ceiling; `createReadEngine` = bounded exponential-
  backoff retries honouring Retry-After), part grouping (`partKey` by
  UPC→MPN→SKU, `groupParts`/`compareOffers` → cheapest-first side-by-side
  offers), the immutable-snapshot mapping (`toSnapshotInput` →
  QU_PRICESNAPSHOTS), and `createService` (search / `searchParts` /
  side-by-side `compare` / price / availability / `capture`).
- `src/pricing.js` — distributor pricing bridge (`window.QU_PRICING`, tasks
  42–44): pure `sellCents` (cost + basis-point markup, exact cents) and
  `buildLineInput` (a snapshot-priced line whose cost is the CAPTURED cost;
  refuses a non-canonical record or a missing snapshot), `staleness`/`ageDays`
  and `normalizePolicy` over `quoteDistributorPolicy`, and the service
  `addToQuote(versionId, offer)` = validate → capture (dedupes an identical
  seal) → build line → `versions.addLine`, so a searched part becomes an
  immutable-snapshot-backed line in one action (a frozen version refuses it).
- `src/distributora.js` — primary distributor connector
  (`window.QU_DISTRIBUTORA`, task 40): a thin wire/auth adapter over
  `QU_DISTRIBUTORS.createDistributor` with its own API-key auth (`X-Api-Key`
  header + `api_key` query), wire parsers, a seeded mock and a live
  `createHttpTransport`.
- `src/distributorb.js` — secondary distributor connector
  (`window.QU_DISTRIBUTORB`, task 41): the same interface and canonical record
  with a DIFFERENT auth model (`Authorization: Bearer` + `X-Api-Version`, no
  query key) and wire format, so the two are interchangeable behind one gateway.
- `src/reconciliation.js` — finance reconciliation
  (`window.QU_RECONCILIATION`, task 39): pure `buildReport` compares the
  acceptance record (approved subtotal, line count, currency) against the
  invoice read back through the gated gateway (accounting or PSA), deriving
  `no_approval`/`awaiting_invoice`/`pending`/`failed`/`unverified`/`matched`/
  `mismatch` with per-check detail, variance and tolerance. `reconcile` (the one
  write) marks a matched intent reconciled and audits `invoice_reconciled`.
- `src/invoicing.js` — the Invoicing station renderer (`QU_RENDERERS.invoicing`,
  task 39): a filterable reconciliation table (status chips, approved vs
  invoiced vs variance, per-row checks, Mark-reconciled action) over
  `QU.reconciliation`.
- `src/portalpage.js` — the standalone client page (`window.QU_PORTALPAGE`):
  rendered chrome-less at `#/q/<secret>`, it reads the frozen client-safe view
  through the API, renders option groups as radio (a mutually-exclusive
  `bundle`/`single` group, labelled "Choose one") or checkbox (multi/optional,
  "Choose any") controls, asks `POST /select` to recompute the totals on every
  change, and drives approve/decline/expire back through the API. It paints a
  terminal Approved/Declined/Expired banner once decided and friendly
  `link isn’t valid` / `no longer active` / `too many requests` states for
  404/410/429/500.
- `src/builder.js` — the quote builder (`window.QU_BUILDER` pure half +
  `renderBuilderStation`, registered as `window.QU_RENDERERS.builder`): the
  start screen (quote list + new-quote form), the authoring screen (version
  toolbar, one-time + MRR line tables, option groups, live totals from the
  shared totals engine, quote details + PSA opportunity linking, catalog
  picker), and the client web/print view (QU_PORTALVIEW HTML + Print). Every
  write goes through QU_VERSIONS, so frozen versions are refused here too.
- `src/syncpanel.js` — conflict-resolution panel (`window.QU_SYNC`): renders
  unresolved cross-device conflicts with keep-mine / keep-theirs / field-level
  merge and the moved-conflict guard.
- `src/backup.js` — full backup & validated restore panel (`window.QU_BACKUP`):
  publish + download, preview-every-change restore, pending-sync refusal,
  replaced-version archival.
- `src/capacity.js` — capacity & archive panel (`window.QU_CAPACITY`): per-document
  size / files / largest-file-vs-ceiling reporting and guided archival
  (preview → read-only batch → prune, browse, restore).
- `src/history.js` — version history with restore (`window.QU_HISTORY`): lists a
  document's conflict-resolution / backup-restore / history-restore entries and
  republishes any archived version as a new revision.
- `src/admin.js` — the Admin station renderer (`window.QU_RENDERERS.admin`): live
  sync status, "Sync now", and it mounts the four panels above.
- `src/content.js` — pluggable product content (`window.QU_CONTENT`, task 45):
  the tiny contentProvider interface `{name,label,description,license,free,
  resolve({item,ref})}`, a normalized enrichment shape (`normalizeEnrichment`),
  and `createService` (register/resolve/enrich/listProviders/getProvider/
  setProvider/escalationPlan), with `applyToItem` merging an enrichment onto a
  catalog item (derived fields only). The DEFAULT provider is `none` (the
  catalog stays self-contained); shipping are the free, open, key-less
  `wikidata` (CC0) and `openfoodfacts` (ODbL) sources, both resolving through
  the `content` connector so content reads are allowlisted, logged and gated
  like any other cross-system call. `escalationPlan()` records the paid options
  (Icecat, Digi-Key, UPCitemdb PRO) — none wired in.
- `src/gatedwrites.js` — gated writes (`window.QU_GATED`, task 47): a reviewed
  WRITE POLICY allowlist of `<connector>.<fn>` entries that fails closed (an
  unapproved write is `write_not_approved`; a missing `ctx.confirm` is
  `confirmation_required`), `createService` (approve/revoke/
  setRequireConfirmation/declaredWrites/pending/clearLedger) plus
  `wrap(gateway)` (writes flow gate → feature guard → connector; reads pass
  through), and a LEDGER of every gated attempt (performed or refused) with
  who/what/key/role/scope/decision/outcome. Policy + ledger persist as the
  versioned `write_policy`/`gated_writes` documents, seeded from `main.pjs`
  `quoteWritePolicy` (an absent/empty doc keeps the seed).
- `src/connectorspage.js` — the Connectors station renderer
  (`window.QU_RENDERERS.connectors`, tasks 45–50): eight cards — the connector
  gateway (manifest/effects/enable/roles/keys), the write policy, the
  gated-write ledger, product content (providers + escalation + enrich), mail
  send-as-rep (permission/scope/send-as + members), field maps & secret
  discipline (verified mappings + surface scan) and the pipeline bus (stream,
  schema, event types, webhooks, recent envelopes) — plus the gateway call log.
- `src/esignature.js` — typed-name e-signature (task 51,
  `window.QU_ESIGN`): pure `build`/`verify`/`hashOf`/`canonicalize`/
  `normalizePolicy` seal a `{type:"typed_name", name, consent, signed_at,
  quote_id, version_id, content_seal, ip, user_agent, hash}` record that binds
  the typed name and the exact consent to the version's frozen content seal;
  `verify` re-derives the seal and refuses a tampered/re-sealed signature, a
  nameless signature, a signature on the wrong version and any secret-shaped
  field. `createService({store,policy})` gates the capability behind a recorded
  scope sign-off (`status`/`signOff`/`revokeSignOff`/`history`, persisted in the
  `esignature` document) and, when `quoteSignaturePolicy.require_signature` is
  set, refuses approval rather than collecting an unauthorised signature. The
  signature is stored on the approval record and surfaced on the acceptance
  artifact.
- `src/artifacts.js` — acceptance artifact snapshot (task 52,
  `window.QU_ARTIFACTS`): one IMMUTABLE, durable record of what was accepted per
  frozen version, in the `quote_artifacts` document. `build` seals the
  client-safe view + signature + totals + content seal into `{id, version_id,
  kind:"acceptance", payload, view, html, text, json, content_hash}`;
  `auditArtifact` re-scans every rendering for a cost/margin leak (I4). The
  canonical snapshots are `renderText`/`renderHtml`, and `renderToCanvas` draws
  the "Accepted quote" document (header, line table with per-line amounts,
  totals, e-signature block, content-seal footer) — the renderer spike.
  `createService()` records exactly one artifact per version (`record`/
  `getForVersion`/`getById`/`list`/`count`/`verify`; `update`/`remove` refused as
  `immutable`); `src/portalactions.js` records one best-effort on approval.
- `src/bundles.js` — bundle cost composition & margin roll-up (task 54,
  `window.QU_BUNDLES`): pure `compose`/`groupComposition`/`rollup`/`describe`
  over the money engine. Rolls sell, cost and margin up by kind (one-time / MRR /
  twelve-month) with margin basis points and per-component share basis points;
  an uncaptured cost is flagged `missing_cost` (never a fake rate) and a
  zero-sell roll-up reports a null rate. `createService({versions,optionGroups})
  .forVersion` rolls a stored version up. INTERNAL ONLY — the builder shows an
  internal cost & margin block; the portal never carries cost/margin.
- `src/advisory.js` — advisory send-time completeness checks (task 55,
  `window.QU_ADVISORY`): non-blocking checks (`missing_description`,
  `missing_part_number`, `zero_quantity`, `stale_cost`, `unpriced_optional`,
  `missing_cost`, `group_empty`) with per-code severities, `counts`, and a
  readable `summarize`. Always `blocking:false` — a rep may deliberately send an
  incomplete quote; `src/sendpipeline.js` surfaces them in `preflight`
  (`advisories`/`advisory_counts` + a non-blocking warning) and the builder's
  send flow warns without vetoing. `quoteAdvisoryPolicy` lives in `main.pjs`.
- `src/migrate.js` — deprecations & migration cleanup (task 56,
  `window.QU_MIGRATE`): `DEPRECATIONS` records the two superseded concepts — the
  `single` option-group selection type (canonical spelling is now `bundle`;
  `single` remains a READ-TIME alias) and the `internal_review` lifecycle state
  (ratified flow is draft → sent). `plan`/`apply` are pure; `createService`
  (`inspect`/`run`/`reconcile`) rewrites the live option_groups / quote_versions
  / quotes documents through the revision-guarded store while NEVER touching a
  frozen version or member (reported `skip: frozen_version`), then re-plans to
  prove nothing actionable remains. Idempotent.
- `src/prospect.js` — prospect mode (task 57, `window.QU_PROSPECT`): a
  `mode` flag on quotes ("quote" | "prospect", validated + audited by
  `src/quotes.js setMode`) plus an authoring flow that reuses the portal /
  e-signature / artifact spine. `bespokeInput`/`templateLines`/`isProspect`/
  `modeOf` are pure; `createService({quotes,versions,artifacts,audit}).{create
  Prospect, addBespoke, bindTemplate, promote}` create a prospect, add normalized
  `bespoke:true` lines, bind an accepted artifact's client-safe lines as bespoke
  template lines (idempotent), and promote the prospect to a normal quote. The
  builder's Quote details card shows the mode and a Mark-as-prospect / Promote
  toggle.
- `src/reports.js` — quote dashboards & reports (task 58, `window.QU_REPORTS`):
  ONE pure analytics engine over the system of record. `build(dataset, filter)`
  returns quote volume, win/loss (`won ÷ decided`; expired counted as lapsed),
  average margin (INTERNAL, derived over accepted lines and never stored), cycle
  time (sent→decided, average + median) and the open pipeline (a CURRENT
  snapshot of sent/viewed stages with its one-time/MRR/deal value);
  `versionFacts` distills one fact row per quote version from the quotes /
  quote_versions / quote_events / approvals / line_items, `normalizeFilter` and
  `periodFromPreset` (30d/90d/12m/ytd/all) scope every metric by rep, company
  and period, and `by_rep`/`by_company` breakdowns reuse the same aggregation. A
  line with no captured cost is flagged (`missing_cost_lines`), never silently
  profitable. `createService` loads a live dataset and offers `report`/`facets`.
- `src/reportspage.js` — the Reports station renderer
  (`window.QU_RENDERERS.reports`, tasks 58 + 60): a filter bar (period presets,
  rep/company selects, from/to dates), five KPI cards, by-rep/by-company
  breakdown tables, and the Analytics & BI handoff card (schema info, build /
  publish / download-JSON / download-CSV). Margin is shown here and nowhere a
  client can reach.
- `src/quoteread.js` — read-only quote connector/API (task 59,
  `window.QU_QUOTEREAD`): `search`/`getQuote`/`getQuoteEvents` over pure DTO
  builders (`quoteSummary`/`versionDto`/`approvalDto`/`eventDto`/`quoteDetail`)
  that carry the client-safe sell side and deliberately omit unit cost, margin
  and the raw signature body. It is mounted as the `quoteread` CONNECTOR on the
  connector gateway (`readOnly:true`; every function declared `effect:"read"`;
  owner/manager/viewer), so reads are allowlisted, role-gated and logged like
  every cross-system call. The connector delegates through a boot-time holder to
  the service built after the quote/version/approval services exist (the read
  path is classified in `src/features.js READ_FUNCTIONS`).
- `src/analytics.js` — analytics & BI handoff (task 60, `window.QU_ANALYTICS`):
  a schema-stable three-table extract (`quotes`/`decisions`/`margins`) built
  from the SAME version facts the reports engine uses, so dashboards and extract
  cannot disagree. Stability is enforced: a frozen ordered column list
  (`TABLES`), `SCHEMA`/`SCHEMA_VERSION`, a pin-able `fingerprint()`,
  `extract`/`extractFrom` projecting every row to exactly those columns, a
  strict `verify` refusing missing/extra/renamed columns, and CSV renderers
  (`toCsv`/`csvBundle`). `createService.publish` sends a versioned
  `pipeline.analytics-extract` envelope on the shared bus (`bus-quote-analytics`)
  through the gateway (`bus.publish` with a confirm) — never a raw write.
  `quoteAnalyticsPolicy` lives in `main.pjs`.
- `src/legacyimport.js` — legacy quoting migration (task 61, `window.QU_LEGACY`):
  a CSV/JSON import adapter (`parseCsv` handles quoted fields, embedded
  commas/quotes and CRLF; `readRows`/`moneyToCents`) with row mappers
  (`mapCatalogRow`/`mapQuoteRow`/`mapLineRow`/`mapHistoryRow`) and a pure
  `reconcile` (source vs imported counts + money totals with an explicit
  variance and named checks). The service imports the catalog, re-keys open
  quotes to fresh quote-u ids while preserving the legacy number when free
  (through `quotes.importQuote`, the ONE non-gateway quote-creation path, audited
  `imported_quote`), exports historical quotes as a schema-valid analytics
  extract, persists each run durably in the `legacy_migrations` document, and
  records the read-only `cutover`. The adapter only ever reads the legacy
  source. `quoteLegacyPolicy` lives in `main.pjs`.
- `src/integrity.js` — invariants & integrity checks (task 66,
  `window.QU_INTEGRITY`): ONE pure engine over a loaded dataset — `checkFrozen`
  (I1), `checkUnique` (I2: exactly one approval and one invoice intent per
  version), `checkEvents` (I3: re-derives the append-only audit hash chain and
  catches an edited or removed record), `checkCostLeak` (I4: scans every stored
  client DTO), `checkOutbox` (I5), plus `checkStoredMoney` and `checkTokens`.
  `loadDataset`/`check`/`run`/`summarize`/`renderZone` drive it from an Admin
  card.
- `src/observability.js` — observability (task 65,
  `window.QU_OBSERVABILITY`): `tokenHealth` (outstanding portal-link age with a
  ceiling alert), `outboxHealth` (terminal-failed + stale-running alerts),
  `rateLimitMetrics` (live portal limiter utilisation) and a bounded structured
  log (`log`/`logs`/`logStats`) persisted to the `ops_log` document via
  `flush`/`load`; `probes`/`alerts`/`health` plus an Admin `renderZone`.
  `quoteObservabilityPolicy` lives in `main.pjs`.
- `src/verification.js` — live verification gates (task 64,
  `window.QU_VERIFICATION`): the 12 integration GATES, each a live read probe
  with required evidence. `probe` runs the real read; `verify`/`isVerified`
  record one evidence row per gate only on a live success (into
  `verification_gates` + an `integration_verified` audit event) and
  `assertVerified` fails closed; `enablement` reports per-connector partial
  enablement; `renderZone` surfaces them on the Admin station.
  `quoteVerificationPolicy` lives in `main.pjs`.
- `src/e2e.js` — end-to-end harness (task 63, `window.QU_E2E`): a
  Playwright-class scenario over a self-contained mock namespace — `createHarness`
  builds the full service graph, `runScenario` drives build → send → open →
  toggle → approve → downstream → abuse, and `bootSmoke` proves the live shell
  rendered every station. The "CI" gate is the in-app SELFTEST runner (no
  Playwright).
- `src/roles.js` — the role & access model (task 68, `window.QU_ROLES`): the
  internal owner/manager/viewer roles (plus the compatibility aliases
  admin→owner, user/member→viewer) and a separate PORTAL_REGIME that refuses
  every internal action. A per-module MATRIX (owner all; manager all but
  `manage_members`/`manage_policy`/below-floor `discount`; viewer view-only) and
  a MODULE_ACTION map of the 22 modules (5 admin documents require
  `manage_policy`) drive the pure `writeVerdict(caps, module, content, previous)`
  — the single decision for create/send/revoke/discount-floor, returning
  `{ok:false, code}` (`portal_regime`/`forbidden`/`discount_floor`).
  `createService` resolves the current identity + scope, exposes
  `can`/`assert`/`canDiscount`/`capabilities`/`scope`, installs STORE WRITE
  GUARDS (`registerGuards`) so a forbidden write fails at the storage layer (not
  only hidden in the UI), and `wrapGateway` injects the resolved scope/actor
  into every connector call. An Admin "Roles & access" card. `quoteRolePolicy`
  lives in `main.pjs`.
- `src/hub.js` — the optional realtime collaboration hub (tasks 69–70,
  `window.QU_HUB`): an off|connecting|open|needs_auth|degraded state machine with
  its config persisted in kv (name only; the password is memory-only), an
  injectable `socketFactory` (default `root.createServerSocket()`), presence +
  document-change streams, a throttled `setContext`/`flushContext` sharing the
  open page/record, and presence markers (`renderPresenceMarker`) wired into the
  builder. When the socket is unreachable it degrades to a 30 s poll that still
  surfaces changes (`via:"poll"`). It mirrors the server's role into QU_ROLES
  (`setIdentity({source:"hub"})`), reports local writes from the wrapped
  `saveChecked`/`saveDoc` (only on `res.ok && !res.noop`), and drives a topbar
  role pill + `body.role-viewer`. The authoritative server half is the QUHUB
  block in index.html's `x-server-plugin` (member slots, hashed-password auth,
  `hubReportWrite` deriving the actor itself, an audit ring, rate limiting and
  the `hqp`+`hqc:<module>` subscription groups). Signing out drops the local
  identity to the least-privilege role (viewer) once a hub exists, so a stale
  owner session never lingers on the page; change detection diffs per-record
  snapshots (revision + JSON map) so an in-place edit or a delete is noticed —
  not only an added id; and the low-level `saveDoc` runs the same write guards
  as `saveChecked`. The server half is hardened: `hubInfo` hides the roster from
  anonymous callers, `hubReportWrite` refuses a stale revision, removing or
  resetting a member drops that member's live sessions, and passwords use a
  salted iterated SHA-256 KDF (legacy v1 hashes still verify and upgrade on the
  next sign-in). Known limitation: the freeze/token registries still accept an
  anonymous write (the standalone app's registry socket is unauthenticated);
  gating them behind hub membership is future work. The builder's free-text
  `actor` field is a local convenience only: the hub
  trusts an actor it derived itself (`identity.source === "hub"`), so a non-hub
  local actor is recorded as-is and is not an authentication claim. An Admin
  "Team & live hub" card.
- `src/selftests/shell.test.js` — shell validation tests (navigation, routing,
  loading/empty/error states, drawer, document title).
- `src/selftests/store.test.js` — storage validation tests (entity documents,
  create/cache/canonical read-back, edit-key loss, revision guard, part
  splitting, corruption handling, reload + second-device recovery, namespaces).
- `src/selftests/money.test.js` — money validation tests (integer-cents rule,
  exact parsing/formatting, arithmetic + allocation conservation, derived
  margin, currency enforcement, overflow refusal, and the stored-field audit).
- `src/selftests/totals.test.js` — totals validation tests (roll-ups, the
  twelve-month identity, selection forms + repairs, required lines, single-select
  groups, exact quantity math, term math, purity, currency, float-freeness, and
  that every surface shares the one implementation).
- `src/selftests/lifecycle.test.js` — lifecycle validation tests (state/terminal
  map, exact transition table + events, purity/timestamps, created/view
  semantics, quote_events shape + secret refusal, server-authority behaviour,
  drift detection, and a live check against the server plugin).
- `src/selftests/audit.test.js` — audit-log validation tests (event catalog +
  categories, record shape + genesis anchor, secret/bad-actor refusal, pure
  append-only semantics, hash-chain tamper detection, rewrite refusal on a
  diverged log, conflict retry, external events, lifecycle feed-through, query
  filters, stats, and a live round-trip through the document store).
- `src/selftests/numbering.test.js` — numbering validation tests (scheme parser
  + refusals, rendering/padding/overflow, bucket reset, sequential minting,
  no-reuse after deletion, conflict retry, idempotent/stable ensure+attach,
  forward-only scheme change, ledger guard against a lost counter, `verify`,
  and a live document-store round-trip).
- `src/selftests/sync.test.js` — sync validation tests (expectedBase guard,
  two-device divergence, keep-mine / keep-theirs / field-level merge,
  startup reconciliation, moved-conflict refusal, the resolution UI flow,
  statusSummary states, and a live two-device round-trip).
- `src/selftests/backup.test.js` — backup/restore validation tests (build,
  validate + tamper refusal, idempotent publish, preview rollback/noop/pending,
  restore replaces at a new revision and archives the old, fresh-namespace
  create, keyless ownership recovery, published backups carry no keys, the UI
  zone, and a live publish→edit→restore round-trip).
- `src/selftests/capacity.test.js` — capacity/archive validation tests (sizing,
  multi-part documents, archive preview guards, read-only batches + prune,
  split batches, corrupt-index refusal, keyless archiving, batch restore +
  no-op, vanished batch files, the UI flow, and a live archive→restore
  round-trip).
- `src/selftests/history.test.js` — version-history tests (entry kinds/labels,
  restorable-version selection, bad-content refusal, restore publishes a new
  revision and archives the replaced one, pending/keyless refusals, the UI
  restore flow, and a live history-restore round-trip).
- `src/selftests/quotes.test.js` — quote-creation & linking tests (gateway
  allowlist + call log, the scope/IDOR guard on every lookup, quote creation
  validation + numbering + audit, scoped creation, same-account-only
  opportunity linking/creation, scope-filtered quote reads, and a live
  create→read-back round-trip).
- `src/selftests/lineitems.test.js` — line-item model tests (the full field
  set + derived-field refusal, defaulting without mutation, the
  null-snapshot-only-for-manual rule, malformed kind/description/quantity/price
  refusal, exact derive() math, agreement with QU_TOTALS, the
  no-derived/no-float storage audit, and ordering).
- `src/selftests/optiongroups.test.js` — option-group tests (fields + selection
  types + single-select limit, malformed-group refusal, membership validation,
  the single-select invariant across defaults/maps/id-arrays, multi/optional
  subsets, composition with QU_TOTALS repair, ordering/version filtering, and
  the aggregate validator).
- `src/selftests/catalog.test.js` — catalog tests (field set + defaults +
  refusals, exact cost+markup sell pricing, search/filters/inactive handling,
  add-to-quote line building with provenance and option flags, pluggable
  content providers, the seed/list/get/search/upsert/remove service, stable
  seed ids, and a live document-store seed round-trip).
- `src/selftests/pricesnapshots.test.js` — price-snapshot tests (field set +
  defaults + refusals, deterministic order-independent sealing + tamper
  detection, raw-payload preservation, bind/applyCost without mutation,
  provenance, age/staleness, the capture/dedupe/immutability service, service
  bind + age, and a live capture/seal/verify round-trip).
- `src/selftests/quoteversions.test.js` — versioning/freeze tests (version
  record + defaults + refusal, deterministic sealing, pure immutability, the
  store write-guard backstop against out-of-band tampering, service CRUD +
  totals + client view, freeze locking every mutator, verify detecting a
  tampered frozen record, revise cloning a sent version, live server
  immutability-check / freeze-register / frozen-verify RPCs, a live
  freeze + verifyAgainstServer, and a live author→freeze→revise round-trip).
- `src/selftests/builder.test.js` — builder tests (money/quantity form
  parsing, `lineFromForm`, `groupFromForm` + membership, selection + the
  single-select rule, `summarize`/client-view wiring, and a DOM smoke test
  that renders the start screen).
- `src/selftests/portal.test.js` — portal-route tests (route parsing, proxy-aware
  IP resolution incl. spoof-safety, the sliding-window rate limiter, and the
  default-deny dispatcher: 404 unknown, token + IP 429, `no_verifier` 500, and a
  handler throw → 500 `internal`).
- `src/selftests/portalread.test.js` — portal-read tests (the frozen client-safe
  view + totals with no cost/margin/snapshot/hash leak, the token DTO carrying no
  hash, revoked/expired/unknown/single-use refusals with the right statuses, an
  unfrozen draft refused 409, and the `GET /view` API route serving the same
  DTO).
- `src/selftests/portalactions.test.js` — portal-action tests (select validation
  + display-only totals + single-select conflict refusal; approve requiring a
  typed name, flipping the quote, auditing a portal event with the token id,
  revoking the link and leaving the frozen seal intact; a server veto failing
  closed; and decline / expire / the API routes).
- `src/selftests/portalevents.test.js` — portal-event tests (one deduped
  `viewed` event per token carrying the token id / IP / user agent and never the
  secret; `option_changed` recorded on a real change and deduped when unchanged;
  and the bounded-metadata / order-independent-selection helpers).
- `src/selftests/approvals.test.js` — approval-record tests (validate/normalize
  refuse a missing name, fractional cents and any secret-shaped field;
  uniqueness-per-version under the revision-guarded write plus `verify`; and
  `approve()` writing exactly one row with the server-recomputed totals and the
  token id).
- `src/selftests/portalabuse.test.js` — the portal threat suite (guessed /
  missing / revoked tokens refused and echoing nothing; oversized, mistyped,
  nested and `__proto__` payloads contained without a 500; the client view
  deep-scanned for cost/margin/hash and hostile text rendered escaped; and
  replay / expiry / one-approval enforcement).
- `src/selftests/content.test.js` — product-content tests (the default `none`
  provider leaves an item untouched; a registered provider resolves through the
  gateway and `applyToItem` merges derived fields only; and the escalation plan
  records the paid options while the default stays `none`).
- `src/selftests/gateway.test.js` — gateway-governance tests (the manifest
  allowlist refuses an unlisted function and `effectOf` labels read vs write; an
  individual `disable` refuses and re-`enable` restores; an unknown role is
  denied and a restricted role list is honoured; and a gateway key is a NAME,
  not a secret — a secret-shaped declaration is refused while the keystore
  resolves the credential at call time).
- `src/selftests/gatedwrites.test.js` — gated-write tests (an unapproved write
  is `write_not_approved` and an approved one without confirmation is
  `confirmation_required`; an approved + confirmed write performs and is
  ledgered; and reads pass straight through the wrapper).
- `src/selftests/mailpermission.test.js` — mail send-as-rep tests (the grant is
  one application permission scoped to the sales group with send-as = own
  mailbox and shared mailboxes refused; `authorize` refuses an out-of-scope,
  shared, foreign and unknown sender and allows only the sender's own mailbox;
  and the connector enforces the gate on every send, records a permitted send or
  builds a `mailto:` link, and persists the grant in the `mail_permission`
  document).
- `src/selftests/fieldmaps.test.js` — field-map tests (a declaration derived from
  the shared `SCHEMA` carries every wire alias and an empty/wire-less mapping is
  refused; and a map cannot be enabled until verified against a captured
  payload, both distributor wire shapes prove the one declaration, and a capture
  missing a required field fails with the field named).
- `src/selftests/secrets.test.js` — secret-discipline tests (credential shapes
  are recognised, a clean declaration passes while one carrying a credential is
  refused with its findings, and an identity reference cannot carry a value; and
  clean client surfaces pass while a leaked bearer/credential is caught with the
  surface named).
- `src/selftests/bus.test.js` — pipeline-bus tests (the type map and versioned
  envelope; emitting publishes to the bus + the webhook and dedupes by envelope
  id; and persistence records the event while an offline event stays pending and
  flushes on the next attempt).
- `src/selftests/esignature.test.js` — e-signature tests (the sealed signature
  binds the typed name, consent and the frozen content seal + refuses a
  tampered/re-sealed, nameless or wrong-version record; policy normalization is
  order-independent; and the capability is gated behind a recorded scope
  sign-off).
- `src/selftests/artifacts.test.js` — acceptance-artifact tests (build seals the
  client-safe acceptance and never carries cost or margin; one immutable
  artifact per version is stored + verified; an approval records the signature
  and the artifact, live; and the canvas renderer draws the acceptance
  document).
- `src/selftests/bundles.test.js` — bundle cost/margin tests (compose rolls
  sell, cost and margin up by kind and over twelve months; an uncaptured cost is
  flagged `missing_cost` rather than pretended profitable; a bundle group rolls
  up its SELECTED member only; and the service rolls up a stored version, live).
- `src/selftests/advisory.test.js` — advisory check tests (each completeness
  problem is detected and reported with a severity; checks are advisory — never
  blocking — and produce a readable summary; and the send preflight surfaces
  advisories without blocking, live).
- `src/selftests/migrate.test.js` — migration tests (plan finds the deprecated
  values and refuses to touch a frozen member; apply is a pure transform with
  the input untouched and frozen members byte-identical; and the service
  migrates the live documents and reconciles to zero, live).
- `src/selftests/prospect.test.js` — prospect-mode tests (bespoke lines and
  template lines are derived purely; a prospect is created and bespoke lines
  added; and an accepted artifact is bound as a template before the prospect is
  promoted).
- `src/selftests/reports.test.js` — reports tests (volume/win-loss/cycle come
  from the lifecycle timeline; average margin is derived over the accepted
  lines and an uncaptured cost is flagged; period/rep/company filters scope
  every metric while the open pipeline stays a current snapshot; and the
  service builds the report from live documents).
- `src/selftests/quoteread.test.js` — read-only API tests (search by
  number/title/company with mode/limit filters; `getQuote` carries the
  acceptance summary and NO cost/margin; the connector is read-only with every
  function declared/classified read; and `getQuoteEvents` returns the
  append-only timeline with token ids, live).
- `src/selftests/analytics.test.js` — analytics tests (the extract matches the
  frozen schema and verifies; decisions carry cycle time and margins the
  derived margin; verify refuses a drifted row and the fingerprint is
  data-independent; and publish sends a versioned envelope through the gateway
  while an invalid extract never reaches it).
- `src/selftests/legacyimport.test.js` — legacy-import tests (the CSV adapter
  keeps quoted fields and maps money to cents; reconciliation reports counts
  and totals with a variance; `run` imports the catalog, re-keys quotes and
  exports history, live; and `cutover` records the legacy tool read-only).
- `src/selftests/integration.test.js` — integration tests (money→totals across
  mixed terms, the lifecycle gate incl. portal-needs-token, token
  hash/expiry/revocation, the cost/margin-free client DTO, outbox
  backoff/due/duplicate-key, and one approval→invoice→all-invariants run against
  a live system of record).
- `src/selftests/e2e.test.js` — the end-to-end gate (the full build→send→open→
  toggle→approve→downstream→abuse scenario, a boot smoke, and the scenario's
  abuse posture).
- `src/selftests/integrity.test.js` — integrity tests (the pure checks catch a
  tampered freeze, a duplicate approval/intent and a duplicated outbox key; the
  audit hash chain catches an edited/removed record; the cost-leak scan holds
  every DTO to I4; and a live frozen/approved/invoiced system passes all
  checks).
- `src/selftests/verification.test.js` — verification-gate tests (a gate needs a
  live probe and recorded evidence before it is trusted; a failed/absent probe
  writes nothing and `assertVerified` fails closed; all 12 gates are declared
  with normalized evidence).
- `src/selftests/observability.test.js` — observability tests (token-age and
  outbox probes raise the right alerts; rate-limit metrics track limiter
  utilisation; the structured log is bounded, filterable and round-trips
  through `ops_log`).
- `src/selftests/roles.test.js` — role/access tests (the matrix, aliases and the
  separate portal regime; `writeVerdict` refusing a viewer, an un-sent send, a
  revoke and a below-floor discount — the floor only re-checks lines that were
  actually re-priced, so a description-only edit or an unrelated healthy change
  is never blocked; identity resolution + per-member scope + the gateway
  injection; sign-out resolving to the least-privilege role once a hub exists;
  the `saveDoc` write guard; and enforcement at the STORAGE layer, not only the
  UI).
- `src/selftests/hub.test.js` — realtime-hub tests (sign-in mirrors the server's
  role and reports writes as the authenticated member; a document change is
  streamed, re-read and attributed, with the client's own-actor echo ignored;
  presence marks collaborators editing the same record; an unreachable hub
  degrades to polling and its snapshot diff still surfaces in-place edits and
  deletes; and a live server `hubInfo` smoke that skips when unavailable).
- the `<script type="text/x-server-plugin">` block at the end of `index.html` —
  the authoritative server-side lifecycle validator (the public mirror of the
  same transition table) + the freeze/immutability registry (`QUFREEZE` magic
  header): a tiny canonical `id~seal` registry with `immutabilityCheck`,
  `freezeRegister`, `frozenVerify` and `frozenRegistry` RPCs, so a frozen
  version's seal can be checked against a server-side copy of record.

## Money (roadmap task 3)

Money is never a float. `window.QU_MONEY` is the single source of truth:

- **Representation** — an integer number of cents in a currency's minor unit
  (`Number.isSafeInteger`). `currency` is a reserved column; v1 is fixed CAD
  (`DEFAULT_CURRENCY`), and mixing currencies throws `currency_mismatch`.
- **Arithmetic** — `add`/`sub`/`sum`/`negate`/`abs` are exact integer ops;
  `mulByInt`, `mulDiv` (round half-away-from-zero), `applyBp`/`bpOf` (basis
  points: 10000 bp = 100%), `lineTotal`, `allocate` (remainder cents
  distributed so parts sum exactly), and indicative `tax`. Every op rejects a
  fractional input rather than rounding it silently, and overflow throws
  `out_of_range`.
- **Parsing/formatting** — `parse`/`fromMajor` do pure string arithmetic
  (`"1.005"` → 101 cents, where `1.005 * 100` floats to 100.49999…);
  `format`/`majorString`/`formatBp` render from the integer digits, so even
  `Number.MAX_SAFE_INTEGER` cents format exactly.
- **Margin is derived, never stored** — `marginCents`/`marginBp`/`markupBp`
  recompute from sell/cost cents on demand; no margin field exists in the model.
- **The hard rule is enforced** — `auditStoredMoney(document)` walks a document
  and flags any money-shaped field (`*_cents`, `unitCost`, `listPrice`, …) that
  is fractional, unsafe-sized or a string; `assertStored` throws
  `float_in_stored_money`. It is the executable form of the invariant, and the
  live self-test runs it over every entity document. `raw` distributor payloads
  are exempt (they preserve the source format for audit).

## Totals (roadmap task 4)

`window.QU_TOTALS` is the ONE implementation of quote totals — the builder's
live preview, the portal's display-only totals and the approval record all call
`computeTotals`, so they cannot disagree. It is pure: no mutation, no clock, no
randomness, no I/O.

- **Definitions (v1)** — `one_time_cents` = Σ selected one-time line amounts;
  `mrr_cents` = Σ selected MRR line amounts; `annual_mrr_cents` = 12 × MRR;
  `twelve_month_value_cents` = one-time + 12 × MRR (a fixed 12-month metric);
  `deal_value_cents` = one-time + `term_months` × MRR (`term_months` defaults to
  12; Phase 9's per-service terms supersede the flat term). A line amount is
  `unit_sell_cents × quantity`, computed exactly through `QU_MONEY`.
- **Selection** — `resolveSelection(lineItems, selection, optionGroups)` takes a
  map/object (per-line booleans) or an id array (a complete selected set),
  always keeps required (non-optional) lines, defaults optional lines to
  `selected_by_default`, and repairs a single-select option group down to at
  most one line (an explicit choice beats the default; ties resolve in sort
  order, and every repair is reported in `selection.repairs`). The result also
  carries a per-line breakdown (`lines`) with integer `amount_cents`.
- **Shared proof** — `sameTotals(a, b)` compares two results and the self-tests
  assert preview = portal = approval; `describeTotals(totals)` produces the
  display strings for the UI.


## Lifecycle (roadmap task 5)

`window.QU_LIFECYCLE` is the ONE service that owns a quote **version's** state.
It is pure (no storage, no network, no mutation) and is the single source of
every lifecycle transition and its audit event:

```
draft ─▶ internal_review (deprecated) ─▶ sent ─▶ viewed ─▶ approved
                                                 └──▶ declined / expired (terminal)
```

> Task 56 deprecates `internal_review`: the ratified flow is the direct
> `draft → sent` path. The state and its transitions are kept only so old data
> still validates, and `QU_MIGRATE` returns any mutable version parked in it to
> `draft` (a frozen version is never touched).

- **States** — `draft`, `internal_review`, `sent`, `viewed`, `approved`,
  `declined`, `expired`. A version starts in `draft` (`beginVersion`, which also
  emits the `created` event); `approved`/`declined`/`expired` are terminal
  (nothing transitions out of them). `internal_review` is optional but
  **deprecated** (task 56) and can return to `draft` or go straight to `sent`.
- **Transition table** — `TRANSITIONS[from][to] = eventName` is the whole
  machine: `draft→internal_review` (`internal_review_started`), `draft→sent`
  (`sent`), `internal_review→draft` (`internal_review_returned`),
  `internal_review→sent` (`sent`), `sent→viewed/approved/declined/expired`,
  `viewed→approved/declined/expired`. `canTransition`/`allowedFrom`/`eventFor`
  read it; `attempt(from, to, ctx)` validates without touching a version and
  returns `{ok, from, state, event, terminal}` or `{ok:false, code, detail}`.
  A `portal` actor must carry a `token_id` (`portal_needs_token`) — never the
  token secret.
- **`apply(version, to, ctx)`** is pure: it returns `{version, record}` with a
  NEW version whose state changed and whose transition timestamp
  (`sent_at`/`viewed_at`/…) is stamped once, plus the `quote_events` record.
  `noteView` models the portal: the first view transitions `sent→viewed`; every
  later view, and a re-open after a decision, still appends a `viewed` event
  without changing state.
- **`createEvent`** builds the append-only audit record
  (`quote_id`, `version_id`, `event`, `actor_type`, `actor`, `token_id`, `ip`,
  `user_agent`, `detail`, `at`) and refuses to record a secret-shaped field
  anywhere in `detail` (`secret_in_event`). Task 6 persists these.
- **Server authority** — the same table lives in the `type="text/x-server-plugin"`
  script at the end of `index.html` (public mirror + `QULIFE` magic/layout state
  header). `attachServerValidator(fn)` routes `applyChecked` through the server
  first: a server veto (or a server/client event disagreement,
  `server_disagrees`) refuses the transition; if the server is unreachable the
  result is still applied but marked `authority:"local", degraded:true` rather
  than pretending to be authoritative. `verifyAgainst(serverTable)` proves the
  client and server tables have not drifted.
- Validated by `src/selftests/lifecycle.test.js` (10 tests), including a **live**
  check that opens a real `createServerSocket()`, fetches the server's
  transition table, proves it matches the client, and asserts the server
  validates legal / illegal / unknown / portal-without-token transitions and can
  veto an `applyChecked` call.

## Audit log (roadmap task 6)

`window.QU_AUDIT` makes `quote_events` an **append-only** log: the system's
memory of every lifecycle transition and every external write. Records are never
edited or deleted, and each is sealed into a **hash chain** so a rewrite is
provable.

- **Record shape** — the audit facts `quote_id`, `version_id`, `event`,
  `actor_type` (`internal` | `portal` | `system`), `actor` (a UPN, or a token
  **id** — never the token secret), `token_id`, `ip`, `user_agent`, `detail`
  (JSON) and `at`, plus the log bookkeeping `seq` (1-based, contiguous), `id`
  (`ev-…`), `prev_hash` and `hash`. The first record's `prev_hash` is the
  all-zero `GENESIS_HASH`, anchoring the chain.
- **Event catalog** — `EVENT_CATEGORY` groups every event the log must record:
  `lifecycle` (`created`, `revised`, `internal_review_started`,
  `internal_review_returned`, `sent`, `viewed`, `option_changed`, `approved`,
  `declined`, `expired`, `link_revoked`) and `external` (`opp_created`,
  `opp_updated`, `note_written`, `email_sent`, `invoice_created`,
  `products_written`, `error`). `EVENT_LABEL` supplies display copy; `events(category)` /
  `eventCategory(name)` read the catalog.
- **Hashing** — `canonicalize` renders deterministic JSON (sorted keys, arrays in
  order, `undefined → null`) so every device hashes a record identically;
  `hashOf(prevHash, record, digest)` hashes `prevHash + "\n" + canonicalize(record
  sans hash)`. With a document store the store's SHA-256 digest is used; a
  self-contained `localDigest` (64 hex) is the fallback. `stripHash` gives the
  exact material a record's hash covers.
- **Normalizing** — `normalizeInput` validates an event (unknown → `unknown_event`,
  bad actor type → `bad_actor`, a portal actor without a token id →
  `portal_needs_token`) and **refuses any secret-shaped field**, at the top level
  or anywhere inside `detail` (`secret_in_event`). `extractRecord` pulls the
  `quote_events` record straight out of a `QU_LIFECYCLE.apply`/`beginVersion`
  result, so a transition feeds the log verbatim. `buildRecord(records, input,
  digest)` seals one record onto the end (assigning `seq`/`id`/`prev_hash`/`hash`);
  `appendRecord(log, record)` is the pure, non-mutating append.
- **Append-only proofs** — `verifyAppendOnly(before, after)` proves a log only
  ever grew: every earlier record is byte-identical and still present in order
  (otherwise `log_shrunk` / `log_rewritten`). `verifyTail(records)` is the cheap
  O(1) check run on every append (last `seq` contiguous, last link correct), and
  `verifyChain(records, digest)` is the full walk that re-derives every hash and
  reports each break.
- **Service** — `createService({ store, digest?, module?, maxRetries? })` exposes
  `load`, `append`, `appendMany`, `list(filter)`, `forQuote`, `forVersion`,
  `sinceSeq`, `count`, `stats`, `verify` and `ready`. Every append goes through
  the revision-guarded `store.saveChecked`. If the stored log no longer extends
  what was read (a concurrent rewrite) the service **refuses** with
  `log_rewritten` rather than clobbering it; on an ordinary revision conflict it
  re-verifies the newer tail and retries. Wired into `src/app.js` boot
  (`QU.audit`, `QU.auditReady`).
- Validated by `src/selftests/audit.test.js` (12 tests), including a **live**
  round-trip that appends through a real document-store namespace, reloads, and
  verifies the chain.

## Quote numbering (roadmap task 7)

`window.QU_NUMBERING` gives every quote a human-readable number from a
**configurable scheme** (default `QU-{YYYY}-{####}` → `QU-2026-0001`). A number
is **unique**, **stable** and **never reused** — deleting or archiving a quote
does not free its number.

- **Scheme** — a pattern string (or `{ id, pattern, description }` object,
  configured in `main.pjs` as `quoteNumberScheme`). Tokens: `{YYYY}` `{YY}`
  `{MM}` `{DD}` (the UTC date of allocation) and **exactly one** `{#...}`
  sequence token whose width = the number of `#`. `parsePattern`/`normalizeScheme`
  validate it (unknown tokens, a missing or duplicated sequence, and unmatched
  braces all fail as `bad_scheme`). `render`/`format`/`bucketKey`/`sample` are
  pure. `QU.scheme` reads the live scheme and `setScheme` changes it.
- **Bucketing** — the sequence is keyed by the rendered **non-sequence prefix**,
  so a pattern containing `{YYYY}` resets to `0001` each year (a `{MM}` pattern
  each month) automatically; a date-free pattern keeps one continuous sequence.
- **Allocation** — the counter + a ledger of every issued number live in the
  header of the `quotes` document (`content.numbering`), beside the quote
  records. `mint`/`ensure`/`attach` do a revision-guarded read-modify-write, so
  two devices racing the same document cannot mint the same number: the loser
  re-reads the winner's revision and takes the next sequence (`conflict` /
  `conflict_stale` / `server_lag` are retried). The ledger is the final
  authority on reuse — even if a counter were lost or reset, an already-issued
  number is skipped rather than reissued.
- **Stability & idempotency** — `ensure(quoteId)` returns a quote's existing
  number or allocates one (never a second); `attach(quote)` returns the quote
  with a stable `quote_number`. Numbers persist with the document and survive a
  cache wipe/reload.
- **Verification** — `verify(records)` proves the ledger and the quote records
  agree: no number used twice, no quote carrying an unrecorded number, no quote
  claiming another quote's number, and every counter at least as high as the
  sequence it has issued.
- Validated by `src/selftests/numbering.test.js` (11 tests), including a **live**
  round-trip through a real document-store namespace.

## Sync, conflict, backup & versioning (roadmap task 8)

The document store reconciles every entity document against its canonical copy
on startup; the Admin station (`src/admin.js`) exposes the rest.

- **Startup reconciliation** — `QU.storeReady` / `boot()` walks every document:
  a fast-forward staged edit (local ahead of the canonical) auto-publishes; a
  true cross-device divergence materializes a conflict record and **writes
  nothing**. `reconcileAll()` can be re-run on demand ("Sync now").
- **Conflict resolution** (`window.QU_SYNC`) — for each unresolved conflict the
  panel offers **keep this device's changes**, **keep the other changes**, or a
  **field-level merge** (per-field radio picks, added records from both sides
  kept). A conflict that moved while under review is refused
  (`conflict_moved`) rather than overwritten. The losing side is always archived
  to the document's resolution history.
- **Version history with restore** (`window.QU_HISTORY`) — lists a document's
  archived versions (conflict resolutions, backup restores and earlier history
  restores) and republishes any of them as a **new revision** through
  `store.restoreHistoryVersion` (revision-guarded; refuses `bad_content`,
  `pending_changes` — an unresolved sync item — and `no_edit_key`). The version
  it replaces is itself archived, so a restore is never lossy.
- **Full backup & validated restore** (`window.QU_BACKUP`) — one action publishes
  every document (data only, **no write keys**) and downloads a copy carrying
  this device's write keys. Restore validates the file (JSON shape + the
  per-document SHA-256), previews exactly what will change (flagging rollbacks
  and blocking on pending sync items), then replaces documents at a new
  revision and archives the pre-restore content. A downloaded backup can also
  recover this device's write keys; a published backup cannot.
- **Capacity & archive** (`window.QU_CAPACITY`) — reports each document's live
  bytes, file count and largest file against the 5 MiB editable ceiling, and
  drives guided archival: preview the records older than a chosen date field,
  move them into a read-only hash-verified batch, prune the live document, then
  browse or restore a batch back into live data.

Suite: 130 tests total — `sync.test.js` (12), `backup.test.js` (12),
`capacity.test.js` (11), `history.test.js` (8), plus the earlier suites. Live
checks (against real server files) skip cleanly when the generator is unsaved
or the upload daily allowance is exhausted.

## Quote creation & external linking (roadmap task 9)

A quote begins life tied to an account and a contact, with an optional link to a
PSA opportunity. Two services do the work, and every cross-system hop goes
through the gateway.

- **Connector gateway** (`window.QU_CONNECTORS`) — the one door to any other
  system. `createGateway({connectors})` exposes `call(connector, fn, payload,
  ctx)`; a connector is a named adapter with an **allowlist** of functions, so an
  unknown connector (`unknown_connector`) or an off-list function
  (`function_not_allowed`) is refused. Every attempt — allowed or refused — is
  recorded in a call log with the caller's scope. The caller's `scope` (an array
  of account ids, or the `"*"` all-accounts sentinel) is the **IDOR guard**:
  `getCompany`/`getContact`/`getOpportunity` return `null` (never a 403 that
  leaks existence) outside it, and the list functions return `[]`; the guard is
  applied inside the adapter, so no caller-side code can bypass it.
- **Mock PSA adapter** — `createMockPsa()` is a seeded stand-in for CRM-U
  (`DEFAULT_PSA_SEED`: companies `c1`–`c3`, contacts, opportunities). It is
  replaced by the real pipeline connector in Phase 8; the gateway contract is
  what stays fixed.
- **Quote service** (`window.QU_QUOTES`) — `createQuote({company_id,
  contact_id, opportunity_id?, title?, actor?})` validates that the company and
  contact exist **and that the contact belongs to the company**
  (`contact_company_mismatch`), copies the account/contact/opportunity
  particulars onto the record, allocates a `QU-YYYY-####` number through
  `QU_NUMBERING.attach`, persists it through the revision-guarded store, and
  appends a `created` audit event. A quote that arrives with an opportunity gets
  it verified (`opportunity_company_mismatch` if it belongs to another account).
- **External linking** — `linkOpportunity(quoteId, oppId)` attaches an existing
  PSA opportunity, and `createOpportunity(quoteId, {name, stage, amount_cents})`
  creates one and writes the id back. Both are one-way guards: a quote with a
  linked opportunity refuses a second link (`already_linked`) — exactly one
  opportunity per quote.
- **Scoped reads** — `listQuotes`/`getQuote` filter by the caller's scope, so an
  internal user only ever sees their accounts' quotes. The account scope is
  configured in `main.pjs` as `quoteAccessScope` (currently `["*"]`, kept as the
  default account scope); Phase 12's `src/roles.js` adds the owner/manager/
  viewer capability model on top of it.
- Validated by `src/selftests/quotes.test.js` (8 tests), including a **live**
  create→read-back round-trip through a real document-store namespace.

Suite: 138 tests total — `quotes.test.js` (8), `sync.test.js` (12),
`backup.test.js` (12), `capacity.test.js` (11), `history.test.js` (8), plus the
earlier suites. Live checks (against real server files) skip cleanly when the
generator is unsaved or the upload daily allowance is exhausted.

## Line items (roadmap task 10)

`window.QU_LINEITEMS` is the canonical shape of a line item and the one place
its derived values are computed. A line belongs to a quote **version**, sits in
a **section** at a **sort_order**, and is either one-time or MRR.

- **The model** — `id`, `quote_version_id`, `sort_order`, `section`, `kind`
  (`one_time` | `mrr`), `description`, `manufacturer_part_number`, `sku`,
  `quantity`, `unit_cost_cents`, `unit_sell_cents`, `optional`,
  `option_group_id`, `selected_by_default`, `catalog_ref`,
  `price_snapshot_ref`, `pricing_mode` and `currency`. `FIELDS` documents each
  with its default. `normalize(input, opts)` fills every default, validates and
  returns a NEW record; `validate(input)` is the non-throwing form and reports
  **every** violation (`bad_kind`, `bad_description`, `bad_quantity`,
  `fractional_cents`, `bad_unit_sell_cents`, `snapshot_required`,
  `snapshot_not_manual`, …).
- **Pricing provenance** — a line is priced either from an immutable
  `price_snapshot` (`pricing_mode: "snapshot"`, which requires the reference) or
  **manually** (`pricing_mode: "manual"`), and the `price_snapshot_ref` is null
  in exactly that case. Supplying a reference without the mode infers
  `snapshot`; the two contradictions are refused.
- **Derived, never stored** — `derive(line)` returns `amount_cents`
  (unit_sell × quantity), `cost_total_cents` (unit_cost × quantity, internal
  only), `unit_margin_cents`, `margin_cents`, `margin_bp` and `markup_bp` (both
  `null` rather than `NaN` when the denominator is zero) — all exact through
  `QU_MONEY`. Nothing is written back onto the line. `audit(lines)` proves a
  stored record carries **no** derived/authoritative field (`amount_cents`,
  `margin_*`, `cost_total_cents`, …) and only integer cents, and `assertStored`
  throws `stored_derived_field` / `float_in_stored_money` otherwise.
- **Composition** — `toTotalsLine` maps a record into the vocabulary
  `QU_TOTALS` reads (the two engines share it, so binding is lossless), and
  `sortLines` provides stable section/sort_order ordering. A self-test asserts
  the derived amounts equal `QU_TOTALS`' line amounts on the same lines.
- Validated by `src/selftests/lineitems.test.js` (8 tests).

## Option groups (roadmap task 11)

`window.QU_OPTIONGROUPS` models the bundles a client chooses between. A group
has a `name` and a `selection_type`:

- **bundle** — a mutually-exclusive choice (exactly one selected line, or none).
  This is the canonical spelling as of task 56; the older `single` spelling is
  still accepted as a read-time alias and is rewritten to `bundle` on migration.
- **multi** — any number selected;
- **optional** — a free-standing add-on set.

`normalize(input, opts)` fills defaults (empty description, `sort_order: 0`) and
refuses malformed groups (`bad_group_name`, `bad_selection_type`,
`bad_sort_order`). Membership is validated by `validateMembership(lines, groups`):
every line with an `option_group_id` must reference a real group
(`group_not_found`), that group must belong to the same version
(`group_version_mismatch`), ids must be unique (`duplicate_group`), and a
grouped line must be `optional` (`grouped_line_not_optional`). The single-select
invariant is enforced by `checkSelection(lines, groups, selection)`: it accepts
the same selection forms as `QU_TOTALS` (defaults / id-map / id-array) and
refuses any state with two selected lines in one single group
(`single_select_conflict`). `QU_TOTALS` remains the repair authority — a
self-test proves `QU_OPTIONGROUPS` refuses exactly the states `QU_TOTALS`
repairs, so the two cannot drift. Wired into `src/app.js` as `QU.optiongroups`.
Validated by `src/selftests/optiongroups.test.js` (8 tests).

## Catalog (roadmap task 12)

`window.QU_CATALOG` is the internal book of sellable things — hardware,
circuits, licences and services. An item carries `sku`,
`manufacturer_part_number`, `description`, `category`, `default_kind`,
`unit_cost_cents`, `default_markup_bp`, `currency`, `active`, and a pluggable
`content_provider` + `content_ref` (default `none` → self-contained; register an
adapter with `registerProvider(name, resolveFn)` to enrich).

- **Pricing** — `sellPriceCents(item)` is exact integer cents: cost plus a
  basis-point markup, through `QU_MONEY`.
- **Search** — `search(items, query, filter)` is whitespace-AND across
  SKU/MPN/description/category with category/kind filters; inactive items are
  hidden unless `includeInactive`.
- **Add to quote** — `buildLineItem(item, opts)` produces a validated
  `QU_LINEITEMS` record with `catalog_ref` recorded, the sell price derived (or
  an explicit snapshot reference for snapshot pricing), and option flags
  (`optional`, `option_group_id`, `selected_by_default`) passthrough.
- **Persistence** — `createService({store})` reads/writes the `catalog_items`
  document through the revision-guarded store (`list`/`search`/`get`/`upsert`/
  `remove`), and `seedIfEmpty(seedList)` installs the bundled pipeline catalog
  (`main.pjs` `catalogSeed`, 24 items spanning hardware, internet, voip,
  sip-trunk, managed-it, cloud, colocation, mobile and services) exactly once.
  Seed ids are deterministic slugs, so a re-seed is idempotent.

Wired into `src/app.js` boot as `QU.catalog` / `QU.catalogReady` (seeding is
chained off `QU.storeReady` and is non-fatal). Validated by
`src/selftests/catalog.test.js` (8 tests, incl. a live seed round-trip).

## Manual pricing & price snapshots (roadmap task 13)

`window.QU_PRICESNAPSHOTS` captures every price as an **immutable** record —
source, distributor SKU, MPN, unit cost / list price cents, quantity available,
warehouse, currency, `captured_at`, and the **full raw source response**. Every
field except the hash is covered by a deterministic seal (`hashOf`/
`canonicalize`, shared with `QU_AUDIT`), so provenance is reconstructible and
tampering is provable:

- `capture(input)` normalises then seals (throws on malformed input);
  `tryCapture` is the non-throwing form. Defaults are filled (`currency: CAD`,
  zero list/count, `captured_at` stamped).
- `verify(snapshot)` checks the seal (`snapshot_tampered` if a value or an added
  field diverges, `unsealed` if the hash is absent).
- `bind(line, snapshot)` / `applyCost(line, snapshot, {markup_bp|unit_sell_cents})`
  attach a snapshot to a line item (validated through `QU_LINEITEMS` so the two
  cannot drift) and stamp the cost, without mutating the input.
- `provenance(snapshot)` returns everything needed to explain a price, including
  the raw payload; `ageDays`/`isStale` report freshness against a configurable
  window (default 7 days — the roadmap's staleness threshold).
- `createService({store})` persists into the `price_snapshots` document,
  **dedupes** identical captures by seal, and exposes `get`/`list`/`bind`/
  `verifyAll`/`ageDays`/`isStale`. `update`/`remove` always refuse with
  `immutable` — a snapshot is never edited or deleted. Identical captures are
  deduped by a content hash that excludes the generated id (the seal itself
  covers every field including the id).

Wired into `src/app.js` boot as `QU.priceSnapshots` / `QU.priceSnapshotsReady`.
Validated by `src/selftests/pricesnapshots.test.js` (9 tests, incl. a live
capture/seal/verify round-trip).

Suite: 367 tests total — `reports.test.js` (4), `quoteread.test.js` (4),
`analytics.test.js` (4), `legacyimport.test.js` (4), `features.test.js` (3),
`reconciliation.test.js` (3),
`distributora.test.js` (3), `distributorb.test.js` (3), `distributors.test.js` (3),
`pricing.test.js` (3), `invoicepaths.test.js` (3),
`invoicepsa.test.js` (3), `invoicedirect.test.js` (3), `invoiceintents.test.js`
(3), `revenue.test.js` (3), `oppnote.test.js` (3), `oppsync.test.js` (3),
`outbox.test.js` (4),
`recompute.test.js` (3), `portalabuse.test.js` (4), `approvals.test.js` (3),
`portalevents.test.js` (3), `portal.test.js` (4), `portalread.test.js` (3),
`portalactions.test.js` (4), `quoteversions.test.js` (11), `builder.test.js` (6),
`pricesnapshots.test.js` (9), `catalog.test.js` (8), `optiongroups.test.js` (8),
`lineitems.test.js` (8), `quotes.test.js` (8), `sendpipeline.test.js` (8),
`sync.test.js` (12), `backup.test.js` (12), `capacity.test.js` (11),
`history.test.js` (8), `portaltokens.test.js` (4), `tax.test.js` (3),
`connectors.test.js` (1), `content.test.js` (3), `gateway.test.js` (3),
`gatedwrites.test.js` (3), `mailpermission.test.js` (3), `fieldmaps.test.js`
(2), `secrets.test.js` (2), `bus.test.js` (3), `esignature.test.js` (3),
`artifacts.test.js` (4), `bundles.test.js` (4), `advisory.test.js` (3),
`migrate.test.js` (3), `prospect.test.js` (3), `integration.test.js` (6),
`e2e.test.js` (3), `integrity.test.js` (4), `verification.test.js` (3),
`observability.test.js` (3), `roles.test.js` (4), `hub.test.js` (6),
`portalpage.test.js` (2), plus the earlier suites. Live checks (against real server files) skip cleanly when the
generator is unsaved or the upload daily allowance is exhausted.

## Client-safe serialization (roadmap task 14)

Every client-facing surface — the portal the client opens, the builder's
"Client view", and the print stylesheet — renders the **same** DTO, produced
by one allowlist serializer (`window.QU_PORTALVIEW.serialize`). It copies only
the fields a client may see (title, company/contact display names, the
client-visible line fields, option groups, the shared totals and the
indicative-tax note) and never unit cost, unit margin, snapshot cost, made-up
costs, or any internal id beyond the line id. `renderHtml` emits the `.pqv*`
markup (the web view; `body.printing` restyles it for print/PDF — there is no
server-side PDF engine in v1) and `toText` the plain-text fallback. Invariant
I4 holds by construction: the serializer is an allowlist, so a new internal
field is invisible until someone deliberately adds it here.

Validated by `src/selftests/quoteversions.test.js` (the client-view cases) —
the cost/margin exclusion is asserted on the serialized DTO, not just on the
rendered markup.

## Builder UI & web/print view (roadmap task 15)

`src/builder.js` is the internal authoring surface, registered as the `builder`
station renderer. Its pure half (`window.QU_BUILDER`) holds form parsing
(money/quantity), the single-select-aware selection maths, and `summarize`,
which returns the shared totals + the client-safe view; its DOM half renders
the start screen (open a quote / create one), the authoring screen (version
toolbar, one-time + MRR line tables with inline add/edit, option groups with
member checkboxes, live totals from `QU_TOTALS`, quote details + "Create PSA
opportunity"), the catalog picker, and the client view (QU_PORTALVIEW HTML +
Print / Copy). Every mutation goes through `QU_VERSIONS`, so a frozen version
is read-only here. The layout is responsive: a two-column desktop grid that
collapses to one column ≤1080px, and at ≤640px the line tables become stacked
label/value cards so nothing is clipped or needs horizontal scrolling.

Validated by `src/selftests/builder.test.js` (6 tests).

## Freeze & immutability (roadmap task 16)

Freezing is the **only** transition into the frozen state, and a frozen version
is immutable through four independent layers:

1. **Pure** — `QU_VERSIONS.isFrozen` / `assertImmutable`; `freezeVersion` is
   the only function that writes the freeze fields and it seals the *frozen*
   record itself (so `verify` recomputes a matching seal).
2. **Every mutator** strips freeze fields from its patch and refuses a frozen
   target (`requireMutable`), and the builder disables its controls.
3. **The store** runs a registered write guard on every canonical write, so a
   frozen version — or a line/group belonging to one — is refused at the
   storage layer even if a future code path tried to bypass the module.
4. **The server** keeps a canonical `id~seal` registry in its `QUFREEZE` state
   header; `immutabilityCheck`, `freezeRegister`, `frozenVerify` and
   `frozenRegistry` RPCs let a client verify a frozen version against the
   server's copy of record. The seal is a deterministic canonical hash, so a
   tampered field (or an added field) is detected.

`revise` creates a **new draft version** from a sent one and leaves the sent
version untouched.

Validated by `src/selftests/quoteversions.test.js` (11 tests, incl. live server
RPCs, a live author→freeze→revise round-trip, and the task-17 snapshot-minting
cases).

## Snapshot minting at freeze (roadmap task 17)

Every sent version must be able to explain its prices, even when a rep typed
the cost by hand. `QU_VERSIONS` now mints provenance at freeze time:
`manualSnapshotInput(line, opts)` turns a line's cost/sell/MPN/SKU into a
`QU_PRICESNAPSHOTS` capture input tagged `source:"manual"` (`MINT_SOURCE`), and
the service method `mintSnapshots(versionId, ctx)` mints a manual snapshot for
**every** line that lacks a `price_snapshot_ref`, binds it back onto the line,
and is idempotent — a second call is a no-op and already-bound lines are left
alone. `freeze` mints *before* sealing; if minting fails it refuses with
`mint_failed` and writes nothing, so a version can never be frozen with a line
that has no provenance. The freeze result carries a `mint` summary.

Validated by the task-17 cases in `src/selftests/quoteversions.test.js` (freeze
mints for hand-priced lines, leaves pre-bound lines alone, idempotent, refuses a
frozen target, degrades cleanly when no snapshot service is attached).

## Send pipeline (roadmap task 18)

Sending is **one ordered, failure-aware operation** owned by `src/sendpipeline.js`
(`window.QU_SEND`). `createService` takes the quote/version/token/snapshot
services, the connector `gateway`, the `audit` log, a `policy`, a `clock` and the
`generatorName`, and exposes `policy`/`staleness`/`preflight`/`send`/`resend`/
`revokeLinks`/`linkState`/`resolveRep`.

`send` runs the steps in a fixed order: (1) freeze the current version (which
mints provenance — task 17); (2) mint a portal token; (3) compose the client
email and deliver it through the gateway's `mail` adapter **as the rep's own
mailbox**; (4) set the quote's status to `sent`. If any step after minting fails,
it **compensates** by revoking the freshly minted token and recording the failure
event, and writes no `sent` status — so a failure never leaves a half-sent quote
and there is never a sent quote without a valid link. `resend` re-delivers an
existing link (minting a fresh one only if none is active) and `revokeLinks`
revokes every active token for a quote. Opaque, hash-at-rest tokens come from
`src/portaltokens.js` (see the module list).

Validated by `src/selftests/sendpipeline.test.js` (6 tests, incl. the happy-path
step order + task-17 mint, resend, delivery-failure compensation, and that a
blocked preflight writes nothing), `src/selftests/portaltokens.test.js` (2) and
`src/selftests/connectors.test.js` (1).

## Expiry & staleness policy (roadmap task 19)

The send policy is configurable in `main.pjs` as `quoteSendPolicy`
(`expiry_days: 30`, `stale_cost_days: 7`, `default_from_mailbox`) and normalized
by `QU_SEND.normalizePolicy`. `expiryFrom` stamps the default 30-day expiry onto
the version at send. `staleness(versionId)` reports each line's snapshot age
against the configurable 7-day window, and the builder paints an amber
"stale cost" badge next to affected lines. Crucially, `preflight` **refuses** a
stale send unless the caller explicitly acknowledges it (`acknowledgeStale`), so
stale pricing is never sent silently — the rep is warned and must opt in, and the
acknowledgement is recorded.

Validated by the pure policy/expiry/staleness/email and stale-ack cases in
`src/selftests/sendpipeline.test.js`.

## Indicative tax display (roadmap task 20)

The display policy is configurable in `main.pjs` as `quoteTaxPolicy`
(`gst_rate_bp: 500`, `gst_label: "GST"`, `show: true`, plus a `disclaimer`) and
normalized by `QU_TAX.normalizePolicy` (which reads `window.root.quoteTaxPolicy`
as its default). `QU_TAX.summary(totals, policy)` derives an **indicative** tax
line from the shared totals via `QU_MONEY.tax` — one amount against the one-time
total, one against the 12-month value — and always names the invoicing/
accounting system as the authoritative source, so quote-u never asserts a tax
figure finance will contradict. `QU_PORTALVIEW.serialize` attaches a
client-safe `tax` DTO (rate, label, indicative amounts, disclaimer — never
cost/margin keys), and both the portal HTML and the builder's Live-totals card
render the two grey rows plus the disclaimer, renaming the grand total to
"12-month value (pre-tax)". Setting `show: false` omits tax entirely.

Validated by `src/selftests/tax.test.js` (3 tests: policy normalization/percent
labels, summary derivation + the non-authoritative flag, and client-view
carry/render/custom-rate/show-off/no-cost-leak).

## Revision & link re-issue (roadmap task 21)

Revising after send creates a **new draft version** and re-issues a fresh portal
link while revoking the prior one. `QU_SEND.send` accepts `allowSupersede`:
`preflight` refuses with `already_sent` unless the caller explicitly opts to
supersede a *different* already-sent version, and once the new version is marked
sent the prior sent version's tokens are revoked (a `revoke_prior` step, plus
`superseded_version_id`/`revoked_prior` in the result). `QU_SEND.reissue(quoteId,
versionId, ctx)` performs revise → send in one call (and refuses with `not_sent`
when the source was never sent). The prior version stays frozen and read-only
and its events remain in the append-only log for audit. The builder's
sent-version head surfaces the three actions `[Client view][Revise into a new
draft][Resend link]`.

Validated by the task-21 cases in `src/selftests/sendpipeline.test.js`
(superseding send revokes the prior link while leaving the prior version frozen
and audited; the `reissue` one-call flow and its `not_sent` refusal).

## Portal token scheme (roadmap task 22)

`window.QU_PORTALTOKENS` mints `{id, secret}`: the id is a stable public
identifier, the secret is a high-entropy opaque token. Only the SHA-256 hash is
persisted — the plaintext is returned exactly once and is never recoverable
(`assertNoSecret` proves it, and the `portal_tokens` document never carries a
plaintext secret). Each token carries `expires_at`, `single_use`, and
revoked/used state. This task makes the service **server-authoritative**: every
minted hash is registered with the server plugin's `QUTOKEN` registry (a
mirrored pure-JS SHA-256 plus a registry stored at a dedicated state offset) via
`tokenRegister`; `verifySecret` consults `tokenVerify` on every check, where a
server veto (revoked / expired / used / hash-mismatch) always wins, while
`not_found` or an unreachable server degrades to the local check with
`authority: "local"`, `degraded: true`; and `revoke`/`markUsed` mirror through
`tokenRevoke`/`tokenMarkUsed`. The server script is public source and holds no
secret — only hashes.

Validated by `src/selftests/portaltokens.test.js` (hash/expiry/revocation/
single-use/no-plaintext cases, a fake-server authority/veto/fallback test, and a
LIVE server-plugin registry round-trip covering hash conflict, verify, revoke,
single-use, and no-hash-exposure).

## Tokenized portal routes & rate limiting (roadmap task 23)

The client portal is a route, not a station: `#/q/<secret>` is parsed out of the
hash before the normal station router runs (`parseRoute` → `{ id: "q" }`) and
rendered **outside** the internal shell (chrome-less, no nav), so it needs no
Entra/internal auth. Everything the page does goes through
`window.QU_PORTAL.createApi(...)` — a **default-deny** dispatcher whose posture is:
any unknown path, method or token is `404`; a route registered with a token
requirement is unreachable without a verifier (`500 no_verifier`); a
revoked/expired/used link is `410`; over-limit traffic is `429` with a
`retry-after`; and a handler that throws is a `500 internal` (never a stack
trace to the client). Rate limiting is two sliding windows — per client IP and
per token — and the IP is resolved **proxy-aware**: trusted forwarding headers
are consulted, malformed hops are skipped, and the default takes the right-most
hop so a client cannot forge its own address. The server plugin is public source
and holds no secret.

Validated by `src/selftests/portal.test.js` (4 tests: route round-trips,
proxy-aware/spoof-safe IP resolution, the sliding-window limiter, and the
default-deny + token/IP-429 dispatcher behaviour).

## Portal read surface (roadmap task 24)

`window.QU_PORTALREAD` is the only way a token holder reads quote data, and it
is deliberately thin and paranoid: verify the secret; require a **frozen**
version (an editable draft is refused `409 not_frozen`); require the token's and
version's `quote_id` to agree; build the DTO through the one client-safe
serializer (`QU_VERSIONS.clientView` → `QU_PORTALVIEW`); and **re-audit the
finished DTO** (`assertClientSafe`) before it can leave, so no cost, margin,
snapshot provenance or internal note can escape even if a serializer changed.
The read returns the frozen client view, a token DTO carrying the token id and
lifecycle metadata (never the secret or its hash), and the version/quote
summary. A `single_use` link is consumed by its first successful open
(`markUsed`). Read is otherwise side-effect free.

Validated by `src/selftests/portalread.test.js` (3 tests: the frozen view +
totals and the no-secret/no-hash/no-cost assertions, the 404/410/single-use
refusals, and the unfrozen-draft + `GET /view` route cases).

## Option selection & decisions (roadmap task 25)

`window.QU_PORTALACTIONS` owns the client's choices. `select` validates a
proposed option set against the **shared** group rules
(`QU_OPTIONGROUPS.enforceSelection` — the same code the builder uses) and returns
the recomputed totals via `QU_TOTALS`; it is display-only and writes nothing, so
the numbers a client sees are produced by exactly the rules the approval will
use. `approve` (a typed name is required) and `decline` re-validate the
selection, then move the **quote's** status through `QU_LIFECYCLE.applyChecked`,
which consults the authoritative server validator — the client is never the
authority, and a server veto fails closed. On a decision the service persists
the approved/declined stamps + totals on the quote, appends an audited portal
event carrying the token id (never the secret), and revokes the version's
remaining links; `expire` is allowed only past expiry unless forced. The frozen
version itself is never mutated, so its seal and provenance stay intact.

`src/portalpage.js` is the client page: it fetches the read DTO, renders option
groups as radio (a mutually-exclusive `bundle`/`single` group, labelled "Choose
one") or checkbox (multi/optional) controls, recomputes the totals through
`POST /select` on every change, and drives approve/decline back
through the API. Once decided it paints a terminal Approved/Declined banner and
shows friendly dead-link states for 404/410/429/500.

Validated by `src/selftests/portalactions.test.js` (4 tests: select validation +
display-only totals + single-select conflict refusal; approve with typed-name,
quote flip, audit + link revocation + intact seal; a server veto failing closed;
and decline/expire over the API routes).

## Portal event capture (roadmap task 26)

`window.QU_PORTALEVENTS` turns "what did the client see and change?" into an
auditable trail on top of the append-only `QU_AUDIT` log. It is deliberately
thin: the client half is pure, the service half is best-effort and never throws
into a request path (an audit failure must not break a read). Opening a link
records exactly one `viewed` event per token — re-opens are deduped — and each
change to the option selection records an `option_changed` event carrying the
selected ids; resending an unchanged selection (a chatty UI) records nothing.
Both events carry the token **id**, the resolved IP and the user agent, and
never the token secret (the audit log independently refuses secret-shaped
fields). Hostile metadata is bounded (`clampText` → 64-char IP / 300-char UA)
and selections are deduped + order-independent, so a hostile client cannot
write an unbounded blob into the log. `history`/`summary` expose the per-token
trail (first/last view, option-change count, last selection). `src/portalread.js`
emits `viewed` and `src/portalactions.js` emits `option_changed`.

Validated by `src/selftests/portalevents.test.js` (3 tests) and the end-to-end
portal flow (viewed → option_changed → approved, each with a token id).

## Portal threat model (roadmap task 27)

The portal is the only surface reachable without internal auth, so it is
modelled as hostile by default and the abuse suite exercises it as an attacker
would:

- **Token guessing** — unknown, empty, oversized or random secrets are refused
  `404`; the refusal body carries no hash/secret and never echoes what the
  client presented. A revoked/expired/used link is `410` (`revoked`/`expired`/
  `used`). The secret is only ever a hash at rest and is never returned.
- **Replay** — a `single_use` link is consumed by its first successful open and
  refused (`used`) afterwards; revocation kills a live link immediately.
- **No approval without a valid token** — missing / bad / revoked / expired /
  used tokens are all refused before any state changes.
- **Over-posting & hostile input** — oversized (thousands of ids), mistyped,
  nested and `__proto__` payloads are contained by the dispatcher's
  `isPlainObject` body coercion and per-route try/catch: never a `500`, never a
  crash, `Object.prototype` stays clean, and an oversized selection is bounded.
- **Cost-leak probes** — the client view is deep-scanned for any
  cost/margin/snapshot/hash-named key (I4), and a hostile line description is
  rendered **escaped** by `QU_PORTALVIEW.renderHtml` (no live markup).
- **One approval** — a decided version accepts exactly one acceptance record no
  matter how many fresh links are minted.

Validated by `src/selftests/portalabuse.test.js` (4 tests).

## Approval record (roadmap task 28)

`window.QU_APPROVALS` owns the immutable `approvals` document — the system's
acceptance record and the executable form of invariant I2 (**exactly one
approval per quote version**). Each row holds the selected line-item ids, the
one-time / MRR / twelve-month totals as **integer cents recomputed server-side
at approval time**, the typed approver name, the token id, IP, user agent and
`approved_at` — and never the secret (`assertNoSecret` + `QU_MONEY.auditStoredMoney`).
Nothing in the app ever updates an approval. Uniqueness is enforced **inside**
the revision-guarded write: the service reads, checks for an existing
`version_id`, appends and saves at the read revision, so two racing writers
cannot both win — the loser sees `conflict`, re-reads and finds the winner's row
(`already_approved`). `uniqueByVersion` is the pure detector and `verify()`
audits every row. `src/portalactions.js` `approve()` refuses early when a
version already has an approval and, after the lifecycle transition, writes
exactly one row through `approvals.record(...)` (with the totals it recomputed
from the frozen version) and returns its `approval_id`.

Validated by `src/selftests/approvals.test.js` (3 tests), plus the
approve()→row end-to-end case in the portal flow.

## Server-side recompute from frozen data (roadmap task 29)

`window.QU_RECOMPUTE` is the one authoritative totals pass for an approval.
`recompute({version, selection, claimed})` refuses a version that is not frozen
(`not_frozen`) and any line item or option group whose `quote_version_id` is not
that version (`foreign_line` / `foreign_group`), then runs the shared
`QU_TOTALS.computeTotals` engine over the frozen records — so approval totals
can never be derived from browser-supplied data. A client's claimed totals
(`claimed`) are extracted by `claimedTotals()` and reported by
`compareClaimed()`, and the service returns `claimed_ignored` /
`claimed_compared` alongside the authoritative `totals`; `statusForCode()` maps
the refusal codes to HTTP (`not_frozen`/`foreign_*` → 409, `version_not_found`
→ 404, else 400). `src/portalactions.js` `reviewSelection`/`approve` route
through this service and record `client_totals_ignored` when a client total was
sent.

Validated by `src/selftests/recompute.test.js` (3 tests) — the pure pass ignores
claimed totals and refuses unfrozen/foreign data, the service reproduces the
shared totals engine, and a tampered client total on approve is ignored.

## Idempotent outbox (roadmap task 30)

`window.QU_OUTBOX` owns the `outbox_jobs` document — the side-effect queue that
makes an approval's external writes exactly-once (invariant I5). Each job has a
unique key `version_id + action` (`keyOf`), so enqueueing the same action for the
same version dedupes (`{ok, deduped}`); a job moves through
pending → running → done / failed with an `attempts` count, `last_error` and a
`next_attempt_at`. `backoffMs` is exponential (`base·2^(attempts−1)` capped at
`maxBackoffMs`). A handler can be registered per action; `runDue` is the
in-flight-guarded worker tick that claims due jobs, runs them, retries a failure
until `maxAttempts` (then marks it terminal) and never re-runs a `done` job. A
job whose action has no handler fails terminally immediately.

Validated by `src/selftests/outbox.test.js` (4 tests) — the pure state machine
(key/backoff/due/dup), enqueue dedupe by key, worker retry + backoff +
done-never-reruns, and persistent failure → terminal.

## Opportunity update on approval (roadmap task 31)

`window.QU_OPPSYNC` is the outbox handler that closes the loop back to the PSA.
When an approval succeeds, `src/portalactions.js` enqueues an `opp_update` job
(deduped by version) and runs one worker tick; the handler `buildPayload`s the
linked opportunity + the deal value = selected one-time + 12 × MRR
(`amountFromTotals`, i.e. the twelve-month value) and performs the gated
`psa.updateOpportunity` write, then appends an `opp_updated` audit event
(actor `system`) recording the stage, amount, `auto_close` and idempotency key.
The stage is the policy `won_stage` when `auto_close` is on, otherwise the
`fallback_stage` — "set-stage and let a human close" — so auto-close can be
disabled without losing the deal-value write. The connector write is idempotent
by the outbox key, so a retried job can never apply the same update twice.

Validated by `src/selftests/oppsync.test.js` (3 tests) — payload/no-opportunity/
bad-amount; approval → Won at the 12-month value with one audit event and one
external write; and the `auto_close:false` fallback stage.

## Opportunity note write (roadmap task 32)

`window.QU_OPPNOTE` is the outbox handler that attaches the
products/costs/part-numbers block to the linked PSA opportunity on approval, so
the PSA's downstream deal sync can carry the sold detail (which items, at what
cost, from which captured snapshot) and not just a bare amount. The block is
built purely from the FROZEN version's own accepted line items (task 29's rule:
frozen data is the only source) joined to the immutable price snapshots the
lines reference (`buildRows`/`renderText`/`buildPayload`); it is an INTERNAL
write, so costs are present. On approval `src/portalactions.js` enqueues a
`note_write` job (deduped by version) alongside the opportunity and revenue
writes, and one worker tick runs them; the gated `psa.writeNote` adapter is
itself idempotent by `idempotency_key`, so a retry can never attach the same
note twice (I5). The write appends a `note_written` audit event (actor
`system`).

Validated by `src/selftests/oppnote.test.js` (3 tests) — the pure builder lists
only the accepted lines with their MPN/SKU and snapshot provenance and refuses
an unlinked quote; approval attaches exactly one note and a re-enqueue cannot
add a second; and a disabled `write_note` flag skips the note entirely.

## Revenue-line / product write on approval (roadmap task 33)

`window.QU_REVENUE` is the outbox handler that writes the accepted frozen lines
to the PSA as revenue/product lines (`psa.writeRevenueLines`), one row per
accepted line carrying description/sku/mpn/kind/quantity/unit price/amount/
currency/recurring. The payload is derived from the frozen version (never the
client) and audited as `products_written`. It is keyed `version_id:revenue_write`
on the idempotent outbox and the adapter is idempotent by `idempotency_key`, so
a retried job applies at most once.

Validated by `src/selftests/revenue.test.js` (3 tests) — the pure builder emits
one row per accepted line with correct cents; approval writes the lines once and
is idempotent on re-enqueue; and a disabled `write_revenue` flag skips the
write.

## Invoice-intent double-billing guard (roadmap task 34)

`window.QU_INVOICEINTENTS` owns the `invoice_intents` document — the hard
double-billing guard. There is exactly ONE intent row per quote VERSION
(invariant I2), recording the chosen path (`direct` | `psa`), the status
(`pending`/`created`/`failed`/`reconciled`) and the external reference. The row
is claimed BEFORE any external invoicing call, inside a revision-guarded
read-check-append-save, so any second attempt for that version — along the same
path or the other path — is refused with `already_invoiced` (naming the winning
path); the loser of a revision race re-reads and refuses rather than
overwriting the winner. `version_id`, `path` and `amount_cents` are immutable
once claimed; only the status block (status / external_reference /
external_system / error / attempt) may be updated, which is how a path
reconciles its created invoice back in (`markCreated`/`markFailed`/
`markReconciled`). No secret is ever stored (`assertNoSecret`), money is integer
cents (`QU_MONEY`), and `verify`/`uniqueByVersion` detect a doctored duplicate.

Validated by `src/selftests/invoiceintents.test.js` (3 tests) — one row per
version with a same-path and other-path second claim refused; external-reference
reconciliation with immutable identity fields and refusal of bad
amounts/paths/secrets; and a claim that loses the revision race retries,
re-reads and refuses with `already_invoiced` so the winner survives.

## Path A — direct accounting invoice (roadmap task 35)

`window.QU_INVOICEDIRECT` is the DIRECT invoicing path: it turns an approved
frozen version into an invoice in the accounting system. On finance's
instruction it upserts the accounting customer for the quote's company (the
company ↔ accounting-customer mapping resolves to one external key,
`buildCustomerPayload`; an explicit `accounting_customer_key` wins, else the
company id) and creates the invoice from the approved selection's own frozen
lines (`buildInvoiceLines`, one pre-tax line per accepted line). quote-u never
asserts the authoritative tax (task 20): it sends the pre-tax lines and the
accounting system owns the tax/total, returning the created invoice reference,
which is reconciled into the `invoice_intents` row (`markCreated`,
`external_system: "accounting"`) and audited as `invoice_created`.

The intent guard is the gate. The handler CLAIMS the version before any external
call, so a version already claimed on the other path is refused terminally
(`already_invoiced`) and no second invoice is ever created; a version already
invoiced on the direct path is a clean idempotent skip. The whole thing is an
idempotent outbox job (`version_id:invoice_direct`) whose failure is marked
terminal on a cross-path refusal, and the accounting adapter is idempotent by a
stable `idempotency_key` (`invoice_direct:<version_id>`), so a retry cannot bill
twice (I5). `enqueueForVersion` refuses an unfrozen or unapproved version (the
approved selection is the only valid source). The gated `accounting` mock
connector (`createMockAccounting`) ships in `src/connectors.js` with
`upsertCustomer`/`createInvoice`/`getInvoice` plus `invoiceCount`/`customerCount`
read hooks; the policy lives in `main.pjs` `quoteAccountingPolicy`.

Validated by `src/selftests/invoicedirect.test.js` (3 tests) — the pure builders
emit pre-tax invoice lines and the customer key, refusing a missing
version/company/lines; approval → customer upsert → invoice create → the intent
reconciles the accounting reference with one `invoice_created` audit, and
re-running creates no second invoice; and a version already claimed on the psa
path makes the direct job fail terminally with no invoice created, while a
disabled `write_invoice` flag skips the path.

## Path B — PSA invoice (roadmap task 36)

`window.QU_INVOICEPSA` is the PSA invoicing path. Where Path A sends pre-tax
lines to the accounting system, this path is deliberately indirect: quote-u
hands the approved selection's PRODUCT/REVENUE records to the PSA (CRM-U)
through the gated connector, and the PSA's own accounting sync produces the
invoice. quote-u never asserts the tax here either — it records the reference
the PSA returns. `buildRevenueLines` (reusing `QU_REVENUE.buildLines` when
present) emits one record per accepted line, annotated with the PSA catalog
product id the mapping resolves (task 37) when one exists; `buildPayload`
carries the opportunity id, tax rate and a stable `invoice_psa:<version>`
idempotency key.

The double-billing guard is the same gate as Path A: the handler CLAIMS the
intent for the `psa` path before any external call, so a version already claimed
on the other path is refused terminally (`already_invoiced`), one already
invoiced here is a clean idempotent skip, and a retry on the same path cannot
produce a second invoice. On success the handler calls
`psa.requestInvoice` (which writes the product records onto the opportunity and
lets the simulated accounting sync create the PSA invoice), reconciles the
returned `invoice_id` into the intent (`markCreated`, `external_system: "psa"`)
and audits `invoice_created`. `enqueueForVersion` refuses an unfrozen or
unapproved version. The `requestInvoice`/`getPsaInvoice`/`psaInvoiceCount` mock
hooks ship in `src/connectors.js`; the policy lives in `main.pjs`
`quotePsaInvoicingPolicy`.

Validated by `src/selftests/invoicepsa.test.js` (3 tests) — the pure builders
emit product records and the payload, refusing a missing
version/opportunity/lines; approval → psa enqueue → `requestInvoice` → the
intent reconciles the PSA reference with one `invoice_created` audit, and
re-running creates no second invoice; and a version already claimed on the
direct path makes the psa job fail terminally with no invoice created, while a
disabled `write_invoice` flag skips the path.

## Mapping & path selection (roadmap task 37)

`window.QU_INVOICEMAPPING` owns the `invoice_mappings` document — the admin
mapping that lets quote-u speak each downstream system's language.
`company_customer` maps a company id to one accounting customer key (and may set
a per-company `preferred_path`); `product_catalog` maps a line's SKU / MPN /
catalog ref to a PSA catalog product id. The resolution helpers
(`resolveCustomerKey`, `resolvePsaProduct`, `preferredPath`) are pure; the
service upserts (replacing an active duplicate), deactivates on `remove`,
refuses secret-shaped fields, and renders an Admin zone. The direct path
resolves its accounting customer key from here when the caller supplies none;
the PSA path annotates its records with the resolved product id.

`window.QU_INVOICEPATHS` owns the selection POLICY and the ROUTER. Resolution
order (most specific first): an explicit path on the request → the company's
mapped `preferred_path` → the policy `default_path` → the only enabled path. If
no path is enabled the request is refused (`no_path`), and a disabled
explicit/company path is refused (`path_disabled`) rather than silently doing
nothing. The router delegates `enqueueForVersion` to the chosen path's service
and `usedPathFor` reads the path a version actually claimed back from the intent
guard — the choice is recorded once and cannot be re-decided. The policy lives in
`main.pjs` `quoteInvoicePolicy` (with the router's own `by_company` fallback).

Validated by `src/selftests/invoicepaths.test.js` (3 tests) — the pure resolver's
explicit → company → default precedence and its `path_disabled`/`no_path`
refusals; the mapping service's upsert/resolve/replace/deactivate + secret
refusal; and the router picking the mapped company path and delegating (mapped →
direct with the mapped customer key, otherwise → psa) with `usedPathFor` reading
the claimed path back.

## Operational flags & data mode (roadmap task 38)

`window.QU_FEATURES` owns the `feature_flags` document — the single control
surface over every external effect. `kill_switch` blocks ALL external writes;
`write_flags.<feature>` sets a per-feature write flag (the catalog is
`QU_FEATURES.FEATURES`: opp_create, opp_update, note_write, revenue_write,
email_send, invoice_direct, invoice_psa, distributor_read); `data_mode` is
`live` | `mock` | `lockdown` (mock refuses LIVE calls so no real effect happens,
lockdown blocks every external write while reads still pass); and
`require_internal_review` gates sends on the version having passed through the
`internal_review` state.

Enforcement is at ONE boundary: `wrapGateway` wraps the connector gateway, so
every outbound call is classified (a known write feature, a known read, or an
UNKNOWN function which fails closed as a write) and checked before it leaves. A
blocked call returns a policy refusal (`policy: true`) that the outbox treats as
terminal (src/outbox.js), so a disabled write is not retried forever. `sendGate`
is the pure internal-review gate consumed by the send pipeline's `preflight`,
and the Admin station renders a control panel (`renderZone`) for the flags, mode
and kill switch. The default lives in `main.pjs` `quoteFeaturePolicy`; runtime
edits persist in the `feature_flags` document.

Validated by `src/selftests/features.test.js` (3 tests) — normalizeConfig
defaults + overrides and the pure guard (mock blocks live, lockdown blocks
writes not reads, kill switch, disabled flags, unknown function fails closed);
the wrapped gateway blocking a write before it reaches the adapter while reads
pass and the refusal is logged, plus the internal-review send gate; and the
service persisting flags/mode/kill-switch in the document (a fresh service reads
them back) with `verify` passing.

## Finance reconciliation & guard proof (roadmap task 39)

`window.QU_RECONCILIATION` is the finance view over the invoice intents. For a
version it compares two authoritative records: the immutable ACCEPTANCE record
(the approval's one-time + MRR subtotal, line count and currency, recomputed
server-side at acceptance) and the invoice actually produced externally, read
back through the GATED connector gateway — `accounting.getInvoice` for a
`direct` intent, `psa.getPsaInvoice` for a `psa` intent. Pure `buildReport`
derives a status (`no_approval`, `awaiting_invoice`, `pending`, `failed`,
`unverified`, `matched`, `mismatch`) plus a per-check breakdown (amount equals
the intent, currency, quote identity, invoice subtotal, line count, external
reference), a signed variance and a tolerance policy. An invoice that cannot be
read (system unreachable) is `unverified`, never a guessed figure; a failed
check on an otherwise matched report flips it to `mismatch`. `list`/`forQuote`
summarize the verdicts. `reconcile` is the only write: it refuses anything but
`matched`, marks the intent `reconciled` and appends the `invoice_reconciled`
audit event (added to `src/audit.js`), and is idempotent on a repeat.

`src/invoicing.js` registers the Invoicing station renderer — a filterable table
(all / needs attention / matched / awaiting) of status chips, approved vs
invoiced vs variance, per-row `Checks` and a Mark-reconciled button — and
`src/admin.js` mounts a small link card to it.

The double-billing guard itself lives one layer down (QU_INVOICEINTENTS): one
intent row per version, claimed before any external call. `src/selftests/reconciliation.test.js`
proves it from the finance side (3 tests): the pure report's classification and
checks; a real approved + direct-invoiced version reconciling matched, marking
reconciled and auditing `invoice_reconciled` exactly once (a repeat is a no-op);
and the guard proof — with both paths attempted on one version, exactly one
external invoice exists (accounting), the PSA is refused terminally with
`already_invoiced`, and the intent row stays `direct`/`created`.

## Distributor pricing (roadmap tasks 40–44)

`window.QU_DISTRIBUTORS` is the shared, read-only distributor layer.

- **Read-only, made executable.** `READ_FUNCTIONS` is the whole surface
  (searchCatalog / getPrice / getAvailability); `assertReadOnly` refuses any
  other name with `destructive_call`, the mock transport refuses a non-read at
  its boundary, and `createHttpTransport` hard-codes `GET` and only ever puts
  whitelisted params (`QUERY_PARAMS`) on the query string — no payload can turn
  a price lookup into a destructive call.
- **Canonical record.** `normalizeRecord` maps any adapter's wire shape into the
  one `RECORD_FIELDS` object (`source`, `distributor_sku`,
  `manufacturer_part_number`, `upc`, `description`, `category`, `currency`,
  `unit_cost_cents`, `list_price_cents`, `quantity_available`, `warehouse`,
  `captured_at`, `raw_response`), parsing major-unit money exactly into integer
  cents. Task 42 formalises this across sources: the declarative `SCHEMA`
  declares each field's type and wire aliases (plus explicit integer-cents
  aliases), and `normalizeWire` resolves ANY source's keys (camelCase,
  snake_case or raw wire spelling; case/separator-insensitive) onto that one
  shape — cents used as-is, unknown keys dropped (`strict` refuses them),
  `validateRecord`/`assertRecord`/`toDisplay` proving the exact shape. Both
  adapters route through it, so their very different wire formats land on the
  same record. `toSnapshotInput` feeds QU_PRICESNAPSHOTS so a captured price is
  sealed forever.
- **Polite request engine.** `createThrottle` enforces start-to-start spacing
  (`min_interval_ms`) and a concurrency ceiling (`max_concurrent`);
  `createReadEngine` retries only retryable codes with bounded exponential
  backoff, honouring a Retry-After hint (`timeout`/`rate_limited`/
  `server_error`/`transport_error`/`bad_response` retry; `not_found`,
  `unauthorized` do not). `now`/`wait` are injectable, so pacing is deterministic
  under test.
- **The two connectors.** `src/distributora.js` (window.QU_DISTRIBUTORA) is the
  primary adapter — API key on the `X-Api-Key` header AND the `api_key` query;
  `src/distributorb.js` (window.QU_DISTRIBUTORB) is the secondary, with a
  different auth model (`Authorization: Bearer <token>` + `X-Api-Version`, no
  query key) and wire format. Both are thin adapters over
  `createDistributor` and normalize to the identical record, so they are
  interchangeable behind one gateway. Each ships a seeded mock speaking its own
  wire shape plus a live `createHttpTransport`; keys/tokens come from the caller
  and are never embedded.
- **The service.** `createService({gateway, names, priceSnapshots})` routes every
  read through the gated gateway (`gateway.callAsync`), so the feature flags and
  data mode apply: `search` merges sources, `compare` returns both sources
  cheapest-first with explicit list price / currency / in-stock and one
  `cheapest` flag, and `capture` seals the chosen (default cheapest, or
  `source`-forced) price as an immutable snapshot. `searchParts` (task 43) is the
  side-by-side view the builder uses: one query fans out to every distributor
  and the hits merge into parts (`partKey` groups by UPC, else MPN, else SKU;
  `groupParts` sorts offers cheapest-first, in-stock breaking ties, cost-less
  last) each carrying per-source unit cost, list, quantity, warehouse and a
  `best`/`cheapest` marker, with any failing source reported in `errors` rather
  than silently omitted.
- **Pricing & add-to-quote (tasks 42/44).** `src/pricing.js`
  (`window.QU_PRICING`) turns a chosen offer into a quote line. Pure
  `sellCents(cost, bp)` adds a basis-point markup in exact integer cents, and
  `buildLineInput(record, snapshot)` produces a SNAPSHOT-priced line whose
  `unit_cost_cents` is the captured cost (it refuses a non-canonical record or a
  missing snapshot, and never writes a derived field). `staleness`/`ageDays`
  measure a capture against the policy threshold. The service
  `addToQuote(versionId, offer, opts)` does the whole action atomically:
  validate → `distributors.capture` (an identical capture dedupes to the SAME
  sealed snapshot) → build the line → `versions.addLine`. A frozen version
  refuses it (I1). Policy lives in `main.pjs` `quoteDistributorPolicy`
  (`default_markup_bp`, `default_kind`, `stale_cost_days`). The builder gained a
  **Distributor pricing** toolbar button and panel: search, per-part offer rows
  (source, unit cost, proposed sell, stock + warehouse, capture age, a green
  `cheapest` chip and an amber stale badge past the threshold), a per-offer
  quantity and an **Add to quote** button.

`src/connectors.js` gained `register(name, connector)` and an async `callAsync`
(same allowlist/scope/logging as `call`); `src/features.js` classifies the
distributor read functions and gates them on `distributor_read`, and its
`wrapGateway` forwards `callAsync`/`register`. `src/app.js` registers both
distributors on the base gateway BEFORE wrapping it, creates `QU.versions` then
`QU.pricing` (`QU.pricingReady`), and exposes `QU.distributors`/`QU.pricing`.

Validated by `src/selftests/distributora.test.js` (3 tests: canonical
shape/cents, engine pacing/retries/read-only, live GET-only auth + snapshot),
`src/selftests/distributorb.test.js` (3 tests: its own auth model and identical
canonical shape, interchangeability and cheapest-first compare, capture
sealing + the feature/data-mode gate), `src/selftests/distributors.test.js`
(3 tests: the shared schema/alias index normalises both wire shapes to the SAME
record and proves it; parts group by UPC/MPN with cheapest-first offers; one
`searchParts` reads both connectors and `compare` exposes stock + a single
cheapest flag) and `src/selftests/pricing.test.js` (3 tests: cost+markup →
exact cents and refusals; staleness vs threshold + policy fallback; and an
end-to-end add-to-quote that captures/seals, dedupes on re-add, refuses a
non-canonical record before writing, and refuses a frozen version).

## Integrations & integration governance (roadmap tasks 45–50)

Phase 8 makes quote-u's external surface governable. Every cross-system call
goes through the ONE connector gateway (`src/connectors.js`), now governed by a
manifest, roles and keys; product-content reads ride the same gateway through a
pluggable contentProvider (`src/content.js`); and every outbound WRITE
additionally passes a gated path (`src/gatedwrites.js`) that requires an
approved allowlist entry plus an explicit confirmation, and records a full
audit ledger. In `src/app.js` the wrapping order is
`connectorGateway = gated.wrap(features.wrap(baseGateway))`, so a write flows
gate → feature guard → connector while a read goes straight to the
feature-guarded connector.

- **Connector gateway governance (task 46).** The gateway holds a per-connector
  MANIFEST of allowlisted functions, each declared `read` or `write`; a function
  not in the manifest cannot be called at all. Each connector can be
  individually disabled (`setEnabled`/`enable`/`disable`/`isEnabled`,
  `effectOf`). Identity ROLES (`roles`/`assignRole`/`defaultRole`) decide who may
  use a connector — an unknown role is denied (fail closed) and a connector may
  declare its own restricted role list. Crucially the app holds a GATEWAY KEY —
  a NAME, never the credential — which an injected KEYSTORE (`setKeystore`)
  resolves to the real secret at call time; a secret-shaped declaration is
  refused, and `setLogSink` receives the centralized call log. `verify()` proves
  the whole surface. `src/app.js` builds the manifest for all six connectors
  (psa / mail / accounting mixed; distributor_a / distributor_b / content read),
  the owner/manager/viewer roles and the keystore from `main.pjs`
  `quoteGatewayPolicy`, so the app holds only keys and role assignments.
- **Pluggable product content (task 45).** `src/content.js` defines the tiny
  contentProvider interface and a normalized enrichment shape. The default
  provider is `none` (the catalog stays self-contained); the free, open,
  key-less `wikidata` (CC0) and `openfoodfacts` (ODbL) sources ship and resolve
  through the `content` connector, so a product-content read is allowlisted,
  centralized and logged like any other cross-system call — the provider layer
  never touches the network directly. `escalationPlan()` records the paid
  options (Icecat, Digi-Key, UPCitemdb PRO) and the trigger for adopting one;
  none is wired in, so paying for content is a deliberate, reviewed change.
  `applyToItem` merges an enrichment onto a catalog item (derived fields only).
- **Gated writes (task 47).** `src/gatedwrites.js` owns the WRITE POLICY: a
  reviewed allowlist of `<connector>.<fn>` entries, each recording who approved
  it, when and why. It fails closed — an unapproved write is refused with
  `write_not_approved`, and an approved write missing its explicit
  `ctx.confirm` (`{by,at?,note?}`) with `confirmation_required`. `wrap(gateway)`
  interposes the gate so reads pass through and writes are checked at the one
  boundary. Every gated attempt, performed or refused, lands in the LEDGER with
  who/what/key/role/scope/decision/outcome; policy and ledger persist as the
  versioned `write_policy`/`gated_writes` documents (seeded from `main.pjs`
  `quoteWritePolicy`; an absent/empty doc keeps the seed), and all eight external
  write call sites now pass `ctx.confirm`.
- **The Connectors station (tasks 45–47).** `src/connectorspage.js` renders the
  governance cards over these services: the connector gateway (manifest,
  per-function effect, enable/disable, roles, key names), the write policy, the
  gated-write ledger, product content (providers, escalation, enrich) and the
  gateway call log.
- **Mail send-as-rep (task 48).** `src/mailpermission.js` models ONE
  application permission (`Mail.Send`) scoped to the `sales` group with
  `send_as: "own_mailbox"` and shared mailboxes always refused — there is no
  shared mailbox and no extra mailbox license. `authorize({actor,from,to})`
  returns a `send_as_rep` grant or a precise refusal (`unknown_sender`,
  `not_in_scope`, `shared_mailbox_forbidden`, `not_own_mailbox`,
  `sender_required`). The gate lives inside the mail connector, so every send
  path (including the `mailto:` client transport, which still logs the
  delivery) is subject to it before a message can leave; the grant persists as
  the `mail_permission` document.
- **Field-map & secret discipline (task 49).** `src/fieldmaps.js` never lets a
  mapping be guessed: a declaration is DERIVED from the same `SCHEMA` the
  normalizer uses (so map and parser cannot drift) and must be PROVEN against a
  captured payload (`verifyCapture` records the capture ref, matched/absent
  fields and extra keys). A capture missing a required field fails
  `capture_mismatch`; an unverified map is `mapping_not_verified` and
  `enablement()` blocks it. `src/secrets.js` is the executable half of the
  no-credential rule: it recognises credential shapes, refuses any declaration
  or client surface (portal DTO, print, call log) that carries one, models a
  secret as an identity `reference(name)` that cannot carry a value, and
  `redact`s without revealing even the length.
- **Event publication & the pipeline bus (task 50).** `src/bus.js` publishes
  audit events as the versioned `pipeline.quote-event` envelope to the
  `bus-quote-events` stream, so the pipeline's knowledge base, BI and other
  tools can consume the same events (created, sent, viewed, approved, declined,
  expired, invoiced). Events persist (idempotent by envelope id) in the
  `bus_events` document, are delivered through the gateway `bus.publish` and
  fanned out to registered webhooks (`bus.webhookPost`); an offline event stays
  `pending` and flushes on the next attempt. `app.js` wraps `audit.append` so
  any publishable record is published after it is appended, and the new `bus`
  connector (mock stream + deliveries) is registered like any other.

Validated by `src/selftests/content.test.js` (3 tests), `gateway.test.js`
(3 tests), `gatedwrites.test.js` (3 tests), `mailpermission.test.js` (3 tests),
`fieldmaps.test.js` (2 tests), `secrets.test.js` (2 tests) and `bus.test.js`
(3 tests).

## Phase 9 — signature, acceptance artifacts, bundles, advisories, migration & prospect mode (roadmap tasks 51–57)

Phase 9 closes the loop on the sent → accepted path and tidies the model.

- **Typed-name e-signature (task 51).** `src/esignature.js` (`QU_ESIGN`) seals a
  `{type:"typed_name", name, consent, signed_at, quote_id, version_id,
  content_seal, ip, user_agent, hash}` record that binds the typed name and the
  exact consent text to the version's frozen content seal. `verify` re-derives
  the seal and refuses a tampered/re-sealed record, a nameless signature, one
  bound to the wrong version, and any secret-shaped field. The capability is
  gated behind a recorded scope sign-off (`createService` → `status`/`signOff`/
  `revokeSignOff`/`history`, persisted in the `esignature` document); when
  `quoteSignaturePolicy.require_signature` is set, approval is refused rather
  than collecting an unauthorised signature. `src/portalactions.js` collects the
  signature and stores it on the approval record.
- **Acceptance artifact (task 52).** `src/artifacts.js` (`QU_ARTIFACTS`) records
  one IMMUTABLE, durable snapshot of what was accepted per frozen version in the
  `quote_artifacts` document: the client-safe view + signature + totals + content
  seal → `{id, version_id, kind:"acceptance", payload, view, html, text, json,
  content_hash}`. `renderText`/`renderHtml` are the canonical snapshots and
  `renderToCanvas` draws the "Accepted quote" document (header, line table with
  per-line amounts, totals, e-signature block, content-seal footer);
  `auditArtifact` re-scans every rendering for a cost/margin leak (I4). The
  service records exactly one artifact per version (`update`/`remove` refused as
  `immutable`).
- **Bundle composition & margin roll-up (task 54).** `src/bundles.js`
  (`QU_BUNDLES`) rolls sell, cost and margin up by kind (one-time / MRR /
  twelve-month) with margin basis points and per-component share basis points.
  An uncaptured cost is flagged `missing_cost` rather than invented; a zero-sell
  roll-up reports a null rate. INTERNAL ONLY — the builder shows the internal
  cost & margin block; the portal never carries cost/margin.
- **Advisory send-time checks (task 55).** `src/advisory.js` (`QU_ADVISORY`)
  produces non-blocking completeness findings (`missing_description`,
  `missing_part_number`, `zero_quantity`, `stale_cost`, `unpriced_optional`,
  `missing_cost`, `group_empty`) with severities + a readable `summarize`.
  Always `blocking:false` — a rep may deliberately send an incomplete quote;
  `src/sendpipeline.js` surfaces them in `preflight`
  (`advisories`/`advisory_counts`) and the builder's send flow warns without
  vetoing. Policy lives in `main.pjs` `quoteAdvisoryPolicy`.
- **Deprecations & migration (task 56).** `src/migrate.js` (`QU_MIGRATE`)
  records the two superseded concepts — the `single` option-group type
  (canonical `bundle`, `single` a read-time alias) and the `internal_review`
  lifecycle state (ratified flow is draft → sent). `plan`/`apply` are pure; the
  service rewrites the live option_groups / quote_versions / quotes documents
  through the revision-guarded store while NEVER touching a frozen version or
  member (`skip: frozen_version`), then re-plans to prove nothing actionable
  remains. Idempotent.
- **Prospect mode (task 57).** `src/prospect.js` (`QU_PROSPECT`) adds a `mode`
  flag on quotes ("quote" | "prospect", validated + audited by `QU.quotes`) plus
  an authoring flow reusing the portal / e-signature / artifact spine.
  `createProspect`/`addBespoke` (normalized `bespoke:true` lines)/
  `bindTemplate` (bind an accepted artifact's client-safe lines, idempotent)/
  `promote` turn a prospect into a normal quote. The builder's Quote details
  card shows the mode and a Mark-as-prospect / Promote toggle.

Validated by `src/selftests/esignature.test.js` (3), `artifacts.test.js` (4),
`bundles.test.js` (4), `advisory.test.js` (3), `migrate.test.js` (3) and
`prospect.test.js` (3); the full suite is 354 tests (all passing in the verified
run; the live server-file round-trips skip cleanly while the generator is
unsaved or the upload daily allowance is exhausted).

## Reporting, analytics & ecosystem exposure (roadmap phase 10)

- **Quote dashboards & reports (task 58).** `src/reports.js` (`QU_REPORTS`) is
  ONE pure analytics engine: volume, win/loss, average margin (internal,
  derived over accepted lines and never stored), cycle time and the open
  pipeline, all filterable by rep, company and period, plus by-rep/by-company
  breakdowns. `src/reportspage.js` renders the Reports station.
  `quoteReportsPolicy` lives in `main.pjs`.
- **Read-only quote API (task 59).** `src/quoteread.js` (`QU_QUOTEREAD`) exposes
  `search`/`getQuote`/`getQuoteEvents` as the read-only `quoteread` connector on
  the gateway — every function declared and classified `read`, owner/manager/
  viewer only, and the DTOs never carry unit cost or margin.
- **Analytics & BI handoff (task 60).** `src/analytics.js` (`QU_ANALYTICS`)
  publishes a schema-stable `quotes`/`decisions`/`margins` extract (frozen
  columns + fingerprint, strict `verify`, CSV/JSON) as a versioned
  `pipeline.analytics-extract` envelope on the bus. `quoteAnalyticsPolicy` lives
  in `main.pjs`.
- **Legacy quoting migration (task 61).** `src/legacyimport.js` (`QU_LEGACY`) is
  the CSV/JSON adapter: import the catalog, re-key open quotes, export history
  for analytics, and record the read-only cutover — with a documented
  reconciliation persisted in the `legacy_migrations` document.
  `quoteLegacyPolicy` lives in `main.pjs`.

Validated by `src/selftests/reports.test.js` (4), `quoteread.test.js` (4),
`analytics.test.js` (4) and `legacyimport.test.js` (4); the full suite is 354
tests (all passing in the verified run).

## Quality, verification & operations (roadmap phase 11)

- **Unit & integration tests (task 62).** `src/selftests/integration.test.js`
  adds 6 cross-module tests for the seams the per-module suites cannot own,
  while the runnable suite covers the money math, option selection, the
  lifecycle, token hashing, the DTO leak scan, invoice-intent idempotency and
  outbox retry, with I1–I5 asserted directly.
- **End-to-end & abuse suites (task 63).** `src/e2e.js` (`QU_E2E`) drives the
  whole build → send → open → toggle → approve → downstream → abuse scenario
  over a self-contained mock namespace; `src/selftests/e2e.test.js` is the CI
  gate (plus a boot smoke) and `src/selftests/portalabuse.test.js` is the
  hostile-input pass.
- **Live verification gates (task 64).** `src/verification.js`
  (`QU_VERIFICATION`) declares the 12 integration gates, each a live read probe
  with required evidence; evidence is recorded only on a live success (into
  `verification_gates` + an `integration_verified` audit event) and
  `assertVerified` fails closed. `quoteVerificationPolicy` lives in `main.pjs`.
- **Observability (task 65).** `src/observability.js` (`QU_OBSERVABILITY`)
  probes portal-link age and outbox failures, reports live rate-limit
  utilisation and keeps a bounded structured log persisted to `ops_log`.
  `quoteObservabilityPolicy` lives in `main.pjs`.
- **Invariants & integrity checks (task 66).** `src/integrity.js`
  (`QU_INTEGRITY`) re-checks I1–I5 (plus stored money and token hygiene) over a
  loaded dataset and renders on the Admin station.
- **README & playbook (task 67).** `src/PLAYBOOK.md` documents the architecture,
  the domain model + invariants, the lifecycle, the flag reference, the
  connector/gated-write model, the invoicing paths and the double-billing guard,
  and the checklists for a new connector, a change order, or a new report.
- **Role & access model (task 68).** `src/roles.js` (`QU_ROLES`) adds the
  internal owner/manager/viewer model (with a separate tokenized portal regime),
  a per-module capability matrix and the pure `writeVerdict`; it installs store
  write guards so a forbidden write fails at the storage layer, and injects the
  resolved scope/actor into every connector call. `quoteRolePolicy` lives in
  `main.pjs`.
- **Realtime hub & multi-user audit (tasks 69–70).** `src/hub.js` (`QU_HUB`) is
  the optional companion hub — presence + document-change streaming with a
  graceful 30 s polling fallback, throttled shared context, presence markers and
  write reporting — backed by the authoritative QUHUB server block in
  index.html's `x-server-plugin` (hashed-password auth, server-derived actor on
  every reported write, rate limiting and a readable audit ring).

Validated by `src/selftests/integration.test.js` (6), `e2e.test.js` (3),
`integrity.test.js` (4), `verification.test.js` (3), `observability.test.js`
(3), `roles.test.js` (4) and `hub.test.js` (6); the full suite is 367 tests, all
passing in the verified run.

## Multi-user & realtime collaboration (roadmap phase 12)

- **Role & access model (task 68).** `src/roles.js` (`QU_ROLES`) is the internal
  owner/manager/viewer model (aliases admin→owner, user/member→viewer) with a
  separate tokenized PORTAL_REGIME, a per-module capability matrix and the pure
  `writeVerdict`. It installs store write guards (a forbidden write is refused at
  the storage layer) and injects the resolved scope/actor into every connector
  call. `quoteRolePolicy` lives in `main.pjs`.
- **Realtime hub & collaborative quoting (task 69).** `src/hub.js` (`QU_HUB`) is
  the optional companion hub — presence + document-change streaming, throttled
  shared context, presence markers in the builder and a graceful 30 s polling
  fallback. The Admin station gains a "Team & live hub" card.
- **Multi-user audit & rate control (task 70).** The authoritative QUHUB block in
  index.html's `x-server-plugin` authenticates members with hashed passwords,
  derives the actor of every reported write itself, rate-limits and groups
  connections and keeps a readable audit ring; the client mirrors the server's
  role into `QU_ROLES`, reports writes only after a real revision, and ignores
  its own-actor echo — so no approval or invoice write is misattributed.

Validated by `src/selftests/roles.test.js` (4) and `hub.test.js` (6); the full
suite is 367 tests, all passing in the verified run.

## System of record (storage)

The quoting system of record is **twenty-two versioned documents**, one per
entity group (`QU_ENTITIES` in `src/store.js`): `quotes`, `quote_versions`,
`line_items`, `option_groups`, `price_snapshots`, `catalog_items`,
`portal_tokens`, `quote_events`, `approvals`, `invoice_intents`,
`invoice_mappings`, `feature_flags`, `outbox_jobs`,
`write_policy`, `gated_writes`,
`quote_artifacts`, `esignature`, `mail_permission`, `bus_events`,
`legacy_migrations`, `verification_gates`, `ops_log`. Each document is
`{ records: [...] }` plus any header fields
the owning module needs (e.g. numbering state).

- **Canonical copies** live as `upload-plugin` editable files named
  `qu-<module>-<generatorToken>` (plus `-p<n>` part files when a document
  outgrows one file), in the generator's own namespace. Editable file names may
  only contain lowercase letters, numbers and hyphens, so entity ids with
  underscores are slugged (`quote_versions` → `qu-quote-versions-<token>`); the
  document envelope still records the true entity id in its `module` field.
- **Local cache + edit key** live in the `qu` `kv-plugin` folder
  (`doc:<ns>:<module>`, `editkey:<ns>:<file>`), so a reload is instant and a
  device can keep writing to documents it created.
- Every write is revision-guarded (`saveChecked` takes the revision the content
  was loaded from) and content-hashed; a stale base is refused with
  `conflict_stale` rather than overwritten. Sync, conflict resolution, backup
  and capacity layers ride on top of this (roadmap task 8).
- **Portal token secrets are never persisted** — only hashes (invariant I2/I4
  hold at the storage layer: the `portal_tokens` document must never carry the
  plaintext secret).


## Station framework contract

A station = `{ id, label, tagline, icon, empty:{title,message}, render(ctx)? }`.
`render(ctx)` returns a DOM element (or nothing → the empty state is shown);
it may be async. `ctx = { id, def, params, moduleList, env, navigate, store }`.
Routes are `#/<station>` (+ `/…` params for sub-pages). A descriptor may set
`hidden:true` to keep it out of the side nav. The hidden `selftest` station is
added by `app.js` and is reachable via its route and `QU.go("selftest")`.

Stations (from the roadmap): Quotes, Quote Builder, Catalog, Portal, Approvals,
Invoicing, Connectors, Reports, Admin.

## Non-negotiable invariants

1. A sent/frozen version is immutable — no code path re-prices it.
2. Exactly one approval and one invoice intent per version.
3. `quote_events` is append-only.
4. No portal or print surface ever contains unit cost, margin or snapshot cost.
5. The outbox never performs the same external write twice.

See `roadmap.pjs` for the full phased backlog and the Perchance platform
mapping (server-plugin = server-side authority, editable-file document store,
connector gateway, hub roles instead of Entra, in-app self-test harness instead
of Playwright, mock/live connector adapters).
