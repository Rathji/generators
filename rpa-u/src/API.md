# RPA-U API reference

This document describes the internal JavaScript APIs of the hub for developers
extending RPA-U or writing a connector that talks to it. The two APIs at
the centre of everything are the **event bus** (how tools communicate) and the
**integration registry** (who owns which data).

All managers are created together by `createHub()` in `src/core/hub.js` and are
reachable from the running app:

```js
const hub = window.puApp.hub;   // in the browser console / module scripts
```

`window.puApp` (set by `src/app.js`) exposes `{ config, router, routes, hub }`.
Inside Perchance templates and inline classic `<script>` tags, use
`window.puApp.hub` too; note that `root` is the *generator root list* (home of
imported plugins like `root.kv`), not the browser window, so `root.puApp` does
not exist. See [`README.md`](./README.md) for the platform's execution-order
rules.

`hub` exposes every subsystem: `db`, `registry`, `permissions`, `identity`,
`log`, `bus`, `subscriptions`, `linker`, `references`, `search`, `reconciler`,
`jobs`, `conflicts`, `alerts`, `drift`, `bundles`, `audit`, `monitor`, `openrpa`,
plus the high-level `publish`, `ingest`, `merge`, `seed`, `seedIfEmpty`,
`seedDriftJobs`, `primeIntegrity`, `resetData` and `ready`.

> Conventions: every `publish*`/`register*` is async and returns a plain object
> (never throws for expected conditions — check `.ok`). Ids are string-prefixed
> (`ev_`, `co`, `ct`, `dv`, `tk`, `iv`, `sub_`). Managers are created once and
> are safe to call repeatedly.

---

## Event bus

`hub.bus` — `createEventBus()` in `src/core/event-bus.js`.

### The envelope

Every event is a versioned envelope, built by the bus and validated before it is
persisted or delivered:

```js
{
  id: "ev_ab12cd",                 // string matching /^ev_[0-9a-z]{3,}$/
  type: "ticket.created",          // a known EVENT_TYPES type
  version: 1,                      // positive integer; should match the catalog
  source: "psa-u",                 // the connector that emitted it (warn if unknown)
  time: "2026-09-12T13:51:23.071Z",// ISO timestamp
  seq: 42,                         // non-negative integer, assigned by the bus
  payload: { /* validated against the type's schema */ },
  subject: { entityType: "ticket", entityId: "tk_7" }, // optional
  correlationId: "…",              // optional
  causationId: "…",                // optional, the event that caused this one
  meta: { /* optional free-form object */ }
}
```

### `hub.publish(type, payload, options)` / `hub.bus.publish(...)`

Publishes an event. `hub.publish` wraps `hub.bus.publish` and also records
publish latency for the **Connector monitor**.

**Options**

| Option | Type | Meaning |
| --- | --- | --- |
| `source` | string | Connector id emitting the event. Default `"ru"`. |
| `time` | string | ISO timestamp. Default now. |
| `id` | string | Override the generated envelope id (tests/replay). |
| `subject` | object | `{ entityType, entityId }` the event is about. |
| `version` | number | Override the schema version (defaults to the catalog's). |
| `seq` | number | Override the bus-assigned sequence number. |
| `correlationId` / `causationId` | string | Link related / causing events. |
| `meta` | object | Free-form metadata. |
| `strict` | boolean | Default `true`. When `false`, validation *errors* do not block the publish. |
| `persist` | boolean | Default `true`. When `false`, skip the event log (and the audit trail). |

**Returns** `{ ok, event, issues, deliveries }`:

- `ok` — `false` if the type is unknown or validation failed in strict mode.
- `event` — the built envelope (or `null` for an unknown type).
- `issues` — validation issues: `{ level: "error"|"warn"|"info", code, path, message }`.
- `deliveries` — one entry per matching subscriber:
  `{ subscriptionId, pattern, ok, error? }`.

```js
const result = await hub.publish(
  "invoice.created",
  { invoiceId: "iv_123", companyId: "co_9", amount: 4800 },
  { source: "psa-u", subject: { entityType: "invoice", entityId: "iv_123" } }
);
if (!result.ok) console.warn(result.issues);
```

**Behaviour.** Unknown types are rejected outright. Validation *errors* block
the publish unless `strict: false`; *warnings* never block. On success the event
is appended to the event log (unless `persist: false`), added to the in-memory
history (last 200), then delivered to matching active subscribers in
**priority order** (higher first), ties broken by registration order. A
subscriber that throws does **not** stop the others: the failure is caught,
logged via `console.warn` and reported in `deliveries` with `ok: false`.

### Subscribing

```js
const handle = hub.bus.subscribe(pattern, handler, options);
```

- `pattern` — a topic pattern. `topicMatches()` supports exact types
  (`"ticket.created"`), topic wildcards (`"ticket.*"`), any trailing `*` prefix
  (`"sync.*"`, `"ticket.*"`), and `"*"` to match every event.
- `handler` — `async (event) => …`, receives the full envelope.
- `options.id` — explicit subscription id (must be unique).
- `options.priority` — higher delivers first (default `0`).
- `options.once` — auto-unsubscribe after the first delivery.
- `options.label` / `options.connector` — descriptive metadata.

**Returns a handle**: `{ id, pattern, active, delivered, unsubscribe() }`
(`active`/`delivered` are live getters).

```js
const handle = hub.bus.subscribe("ticket.*", async (event) => {
  console.log("ticket event", event.type, event.payload);
}, { connector: "inv-u", priority: 10 });
// later:
handle.unsubscribe();
```

### The rest of `hub.bus`

| Member | Description |
| --- | --- |
| `hub.bus.publish(type, payload, options)` | Publish (see above). |
| `hub.bus.subscribe(pattern, handler, options)` | Register a subscriber; returns a handle. |
| `hub.bus.unsubscribe(id)` | Remove a subscriber by id; returns `true` if it existed. |
| `hub.bus.subscribersOf(type)` | Active subscribers matching a concrete type: `{ id, pattern, connector, delivered }`. |
| `hub.bus.subscriberList()` | All subscriptions with `pattern`, `connector`, `label`, `once`, `priority`, `delivered`, `lastSeq`, `createdAt`. |
| `hub.bus.recentPublished(n = 20)` | The last `n` published envelopes from in-memory history. |
| `hub.bus.matchingSubscriptions(type)` | The (sorted) subscription records that would receive `type`. |
| `hub.bus.stats()` | Counters and breakdowns (see below). |
| `hub.bus.reset()` | Clear subscriptions, history and all counters. |
| `hub.bus.resetStats()` | Clear history and counters but keep subscriptions. |
| `hub.bus.knownType(type)` | `true` if `type` is in the catalog. |
| `hub.bus.lastSeq()` | The most recent sequence number. |
| `hub.bus.catalog` | The raw `EVENT_TYPES` array. |

`hub.bus.stats()` returns `{ published, rejected, deliveryCount, failureCount,
subscriberCount, activeSubscribers, types, topics, byTopic, byType,
recentRejections }`.

---

## Event catalog & schema

`src/core/event-catalog.js` is the single source of truth for event types.

- `EVENT_TYPES` — array of `{ type, version, category, topic, description, payload }`.
  `payload` uses `{ type: "object", required: [...], fields: { key: {type, required, enum, min, max, minLength, maxLength, pattern} } }`.
- `EVENT_TYPE_MAP` — `Map<type, entry>`.
- `EVENT_CATEGORIES` — the distinct categories (e.g. `identity`, `monitor`).
- `TOPICS` — the distinct topic prefixes.
- `topicOf(type)` — the topic of a qualified type.
- `topicMatches(pattern, type)` — the matcher used by subscriptions.

`src/core/event-schema.js` validates events and helps you build them:

| Function | Description |
| --- | --- |
| `validateEnvelope(envelope, { connectors })` | Validates a full envelope. Returns `{ ok, issues, counts }`. An error-level issue means `ok: false`. |
| `validatePayload(type, payload)` | Validates just a payload against its type; returns an array of issues. |
| `validateValue(value, schema, path)` | Low-level schema/value check used recursively. |
| `samplePayload(type)` | A representative payload for a type — handy for demos and tests. |
| `describePayload(type)` | `[{ key, …schema, description }]`, used to document an event's fields in the UI. |
| `knownEventTypes()` | All known type strings. |

---

## Event log & subscriptions

### `hub.log` — `createEventLog()`

Durable short-term event history (collection `events`), the recovery checkpoint
store (collection `checkpoints`) and the source the audit ledger is derived from.

| Member | Description |
| --- | --- |
| `hydrate()` | Load persisted events into memory. Called by `hub.ready()`. |
| `append(event)` | Append an envelope (called by the bus); returns it. |
| `prune(keep = 500)` | Trim the log to the newest `keep` entries. |
| `all()` / `size()` / `lastSeq()` | The entries, their count, and the last sequence. |
| `get(id)` / `recent(n)` | Look up by envelope id / newest `n`. |
| `since(seq)` / `range(fromSeq, toSeq)` / `byType(type)` / `byTopic(topic)` / `bySource(id)` | Slice the log. |
| `replay(handler, { since, to })` | Call `handler(event)` for each entry in range; returns how many were replayed. |
| `saveCheckpoint(connectorId, seq, meta)` / `checkpointOf(connectorId)` | Persist/read a connector's recovery checkpoint. |
| `recover(connectorId)` | `{ connector, from, events, replayed }` — everything since the checkpoint. |
| `clear()` | Empty the log and checkpoints. |
| `stats()` | `{ size, limit, lastSeq, dropped, byType, bySource, checkpoints }`. |
| `collection` / `checkpointCollection` | The underlying collection names. |

### `hub.subscriptions` — `createSubscriptionManager()`

The persisted, per-connector subscription registry (collection
`subscriptions`). It wraps `hub.bus.subscribe` so subscriptions survive reloads
and can be inspected/registered from the UI.

| Member | Description |
| --- | --- |
| `register({ connector, topic, label, description, priority, sink })` | Persist a subscription and attach it to the bus (optional custom `sink` handler). |
| `unregister(id)` | Remove and detach a subscription. |
| `list()` / `forConnector(id)` / `forTopic(topic)` / `matching(type)` / `recordFor(id)` / `countFor(connector)` | Query subscriptions. |
| `recentDeliveries(n)` | Recent delivery records. |
| `seedDefaults()` / `ready()` / `reset()` | Seed the default matrix / hydrate / clear. |
| `topicIsKnown(pattern)` / `topicMatches(pattern, type)` | Pattern helpers. |
| `stats()` / `defaults` / `collection` | Summary and metadata. |

`DEFAULT_SUBSCRIPTIONS` in the same module declares the out-of-the-box
subscription matrix.

---

## Integration registry

`hub.registry` — `createRegistry()` in `src/core/registry.js`. Built from
`src/core/catalog.js`.

| Member | Description |
| --- | --- |
| `hub.registry.connectors` | The `CONNECTORS` array (every tool plus the hub). |
| `hub.registry.entityTypes` | The `ENTITY_TYPES` array. |
| `hub.registry.directions` | The `DIRECTIONS` array (`push` / `pull` / `bidirectional` / `none`). |
| `hub.registry.connector(id)` | Look up a connector by id; `null` if unknown. |
| `hub.registry.entityType(id)` | Look up an entity type by id; `null` if unknown. |
| `hub.registry.fieldsFor(typeId)` | Copies of every field declared for an entity type. |
| `hub.registry.field(typeId, key)` | One field definition, or `null`. |
| `hub.registry.owner(typeId, key)` | The connector id that owns a field, or `null`. |
| `hub.registry.directionOf(typeId, key)` | The field's sync direction, or `null`. |
| `hub.registry.isAuthoritative(typeId, key)` | `true` if the field is marked authoritative. |
| `hub.registry.connectorsFor(typeId)` | Connectors that declare an entity type. |
| `hub.registry.declares(connectorId, typeId)` | `true` if a connector declares an entity type. |
| `hub.registry.canWrite(connectorId, typeId, key)` | `true` if the connector owns the field. |
| `hub.registry.writableFields(connectorId, typeId)` | Fields a connector owns for a type. |
| `hub.registry.fieldsOwnedBy(connectorId)` | Every field owned by a connector, across all types (each tagged with `entityType`). |
| `hub.registry.validate()` | Catalog self-check → `{ ok, issues, counts }`. |
| `hub.registry.stats()` | `{ connectorCount, entityTypeCount, fieldCount, authoritativeCount, directions }`. |

```js
const r = hub.registry;
r.owner("company", "domain");            // "crm-u"
r.directionOf("company", "assetCount");  // "pull"
r.fieldsOwnedBy("psa-u").length;         // every PSA-U-owned field
r.validate().ok;                         // true when the catalog is consistent
```

### Field definition shape

```js
{
  key: "domain",          // field name on the entity
  label: "Primary domain",// human label
  owner: "crm-u",         // the connector that holds the truth
  authoritative: true,    // trust the owner's value over any copy
  direction: "push",      // push | pull | bidirectional | none
  computed: false,        // true for hub-derived/count fields
  sensitive: false        // true → stripped from bundles unless opted in
}
```

---

## Other hub APIs (quick reference)

These are documented in full by their own modules in `src/core/`; the lists below
are a map of the surface area.

- **`hub.identity`** — canonical entity store: `upsert`, `get`, `all`, `search`,
  `findByKey`, `findByRef`, `findDuplicates`, `matchEntity`, `merge`,
  `setField`, `nameOf`, `naturalKey`, `refKey`, `count`, `stats`, `typeDef`,
  `collectionFor`, `entityTypes`, `reset`.
- **`hub.permissions`** — role translation: `roles`, `capabilities`,
  `mappings`, `roleMaps`, `toolRoles`, `canonicalRolesFor`, `rolesFor`,
  `capabilitiesFor`, `hasCapability`, `hasAny`, `hasAll`, `explain`, `validate`,
  `stats`.
- **`hub.linker`** — entity linking: `resolveField`, `linkField`, `linkEntity`,
  `override`, `clearField`, `rebuild`, `edgesFor`, `outgoing`, `incoming`,
  `report`, `summary`, `candidates`, `referenceRecords`, `removeEntity`,
  `decorate`, `linkTypes`, `typeById`, `knownTypeId`, `linkCount`, `store`.
- **`hub.references`** — reference-not-copy: `ownerValue`, `fetch`, `refresh`,
  `fieldReference`, `entityReference`, `derivations`, `stats`.
- **`hub.search`** — `query`, `byId`, `byRef`, `scoreEntity`, `suggestions`.
- **`hub.reconciler`** — `findings`, `allFindings`, `dismissedFindings`,
  `groupedByKind`, `resolve`, `dismiss`, `restore`, `copyHygiene`, `hydrate`,
  `reset`, `stats`, `collection`.
- **`hub.jobs`** — idempotent sync jobs: `register`, `enqueue`, `execute`,
  `executeAll`, `retry`, `cancel`, `applyOnce`, `hasEffect`, `runnable`,
  `deadLetters`, `effectsList`, `jobKey`, `kinds`, `known`, `get`, `has`,
  `list`, `remove`, `hydrate`, `reset`, `stats`.
- **`hub.conflicts`** — `plan`, `detect`, `resolve`, `resolveAll`, `simulate`,
  `ruleFor`, `ruleForDirection`, `rules`, `keyOf`, `fingerprint`, `history`,
  `announce`, `reset`, `stats`.
- **`hub.alerts`** — `raise`, `acknowledge`, `clear`, `clearMatches`, `list`,
  `open`, `openCount`, `counts`, `forEntity`, `get`, `stats`, `severities`.
- **`hub.drift`** — `scan`, `signals`, `entries`, `open`, `resolved`,
  `forEntity`, `suggest`, `stage`, `alertKeyFor`, `alertSeverityFor`, `reset`,
  `stats`.
- **`hub.bundles`** — `build`, `publish`, `list`, `latest`, `get`, `remove`,
  `scopes`, `targets`, `formats`, `refKey`, `hydrate`, `reset`, `stats`.
- **`hub.audit`** — `verify`, `filter`, `search`, `moves`, `lifecycle`,
  `facets`, `actions`, `all`, `recent`, `get`, `matches`, `appendEvent`,
  `note`, `refresh`, `catchUp`, `hydrate`, `reset`, `stats`.
- **`hub.monitor`** — `probe`, `heartbeat`, `start`, `stop`, `running`,
  `summary`, `stats`, `latency`, `errors`, `connectors`, `connector`, `samples`,
  `injectIncident`, `clearIncident`, `incidents`, `recordPublish`,
  `recordError`, `recordSyncFailure`, `observe`, `catchUp`, `hydrate`, `reset`,
  `collection`, `statuses`, `thresholds`, `intervalMs`, `lastSweep`, `overrides`.

---

## OpenRPA connector

`hub.openrpa` — `createOpenRpaConnector()` in `src/core/openrpa/connector.js` —
composes the profile store, the offline emulator, the wire-protocol client and
the session manager, and speaks the OpenRPA / OpenFlow envelope
(`{ id, replyto, command, data }`, where `data` is a JSON string).

| Member | Description |
| --- | --- |
| `hub.openrpa.connect({ profileId, mode, announce })` | Open the transport (emulator or a live WebSocket profile); resolves when it is up. |
| `hub.openrpa.disconnect()` | Close the transport and reject any in-flight requests. |
| `hub.openrpa.request(command, data, options)` | Send a command and await its correlated reply (auto-connects); rejects on timeout or protocol error. |
| `hub.openrpa.notify(command, data)` | Fire-and-forget command with no reply. |
| `hub.openrpa.probe()` | A `ping` round trip → `{ ok, latencyMs }`. |
| `hub.openrpa.signIn({ username, password } \| { jwt })` / `signOut()` | Authenticate and map the token user's OpenFlow roles onto canonical roles. |
| `hub.openrpa.setMode("emulator" \| "live")` / `mode()` | Choose the transport source. |
| `hub.openrpa.health()` | The rolled-up connector health: `{ connector, name, mode, state, connected, status, latencyMs, reconnects, queueDepths, queueTotal, sent, received, failed, timeouts, retried, errorCount, errorRate, attempts, thresholds, checkedAt }`, where `status` is `up \| degraded \| down`. |
| `hub.openrpa.status()` | `{ mode, state, connected, endpoint, profile, session, protocol, profiles, emulator, documents, acl, workitems, files, invocation, robots, nodered, bridge, linking, drift, sync, conflicts, bundles }`. |
| `hub.openrpa.entry()` | The registry entry carrying its live `connectionState`. |
| `hub.openrpa.validateProfile(input)` / `parseEndpoint(input)` | Profile validation and endpoint decomposition. |
| `hub.openrpa.profiles` | The persisted profile store: `list`, `get`, `create`, `update`, `remove`, `setActive`, `active`, `stats`, `ready`, `reset`. |
| `hub.openrpa.session` | The session manager: `signIn`, `signOut`, `refresh`, `ensureFresh`, `sessionInfo`, `capabilities`, `hasCapability`, `isExpired`, `secondsRemaining`, `stats`. |
| `hub.openrpa.emulator` | The offline emulator: `transport`, `process`, `emit`, `setOnline`, `setDelay`, `injectFailure`, `clearFailures`, `stats`, `dataset`, `reset`. |
| `hub.openrpa.protocol` | The wire client: `request`, `notify`, `connect`, `disconnect`, `ping`, `onState`, `onMessage`, `onCommand`, `stats`. |
| `hub.openrpa.bundles` | The portable bundle store (see [Bundles, export & import](#bundles-export--import)). |
| `hub.openrpa.ready()` / `reset()` | Hydrate / clear persisted profiles and the session. |

Its state lives in the `openrpa_profiles`, `openrpa_session`,
`openrpa_emulator`, `openrpa_bridge`, `openrpa_links`, `openrpa_sync` and
`openrpa_bundles` collections. See
[`CUSTOMIZATION.md`](./CUSTOMIZATION.md) §2.

### Collections, documents & ACL

`hub.openrpa.documents` — `createDocumentService()` in
`src/core/openrpa/documents.js` — turns raw OpenFlow documents into typed hub
records (`normalizeDocument`) and back (`serializeDocument`) without losing
unknown fields, and wraps the document commands. Query/list calls return an
array (or a number for `count`); every write and paged call returns
`{ ok: true, ... }` or `{ ok: false, error: { kind, code, message, retryable } }`
where `kind` distinguishes `conflict`, `validation`, `transport`, `not-found`
and `server`.

| Member | Description |
| --- | --- |
| `hub.openrpa.documents.types` | The modelled document-type descriptors (`OPENRPA_DOCUMENT_TYPES`). |
| `hub.openrpa.documents.listCollections()` | Every collection with `{ name, count, type, label }`. |
| `hub.openrpa.documents.count(collection, query?)` | Matching-document count. |
| `hub.openrpa.documents.query(collection, { query, projection, orderby, top, skip })` | Normalized records. |
| `hub.openrpa.documents.page(collection, { page, pageSize, query, orderby, projection })` | `{ ok, documents, page, pageSize, pageCount, total, from, to, hasPrev, hasNext }`. |
| `hub.openrpa.documents.get(collection, id)` | `{ ok, document }` (or `null`). |
| `hub.openrpa.documents.insert` / `insertMany` | Create one / many documents. |
| `hub.openrpa.documents.upsert(collection, item, { uniq })` | Insert-or-update by a uniqueness key. |
| `hub.openrpa.documents.update(collection, item, { expectedVersion })` | Optimistic-concurrency update; a stale `_version` returns `kind: "conflict"`. |
| `hub.openrpa.documents.remove` / `removeMany` | Delete one / many by id. |
| `hub.openrpa.documents.normalize` / `serialize` / `templateFor` | Low-level record helpers. |
| `hub.openrpa.documents.stats()` / `reset()` | Counters and state reset. |

`hub.openrpa.acl` — `createAclMirror()` in `src/core/openrpa/acl.js` — mirrors
the OpenFlow users, roles and per-document ACL entries, decodes the numeric
rights bitmask, and resolves the effective rights for a subject (deny wins, and
anything unmatched is denied by default).

| Member | Description |
| --- | --- |
| `hub.openrpa.acl.sync()` / `synced()` | Mirror (or report) the OpenFlow directory. |
| `hub.openrpa.acl.users()` / `roles()` / `userFor(id)` | The mirrored directory. |
| `hub.openrpa.acl.rolesForUser(user)` / `subjectFor(sessionInfo)` / `subjectForUser(user)` | Build an evaluation subject. |
| `hub.openrpa.acl.rightsForDocument(doc, subject)` | `{ full, granted, rights, actions, matched, defaulted }` effective rights. |
| `hub.openrpa.acl.actionForDocument(doc, subject, action)` | `{ allowed, reason }` for a named action (`get`/`insert`/`update`/`delete`/…). |
| `hub.openrpa.acl.stats()` / `reset()` | Counters and state reset. |

The constants `OPENRPA_RIGHTS`, `OPENRPA_ACTIONS` and `OPENRPA_FULL_RIGHTS`
define the bitmask and action vocabulary. `presentWorkflow()` in
`src/core/openrpa/workflows.js` (used by the OpenRPA data screen) presents a
workflow document's parameters, flags and queue binding without exposing its raw
XAML.

### Work items, queues & file storage

`hub.openrpa.workitems` — `createWorkItemService()` in
`src/core/openrpa/workitems.js` — manages work-item queues and drives an item
through its lifecycle. The state machine is `new → processing → success` /
`failed` (plus `abandoned`), a transient failure obeying the queue's retry policy
returns the item to `new` with an incremented retry count and a next-run delay,
a business-rule failure or an exhausted retry budget makes it `failed`, and the
queue's success / failed queue id is where the item is routed on settlement.
Every write returns `{ ok: true, ... }` or
`{ ok: false, error: { kind, code, message, retryable } }`.

| Member | Description |
| --- | --- |
| `hub.openrpa.workitems.states` / `priorities` | The state vocabulary and the priority vocabulary (`low`, `normal`, `high`). |
| `hub.openrpa.workitems.listQueues()` / `getQueue(id)` | Queues normalised to `{ id, name, workflowId, robotQueue, amqpQueue, maxRetries, retryDelay, initialDelay, successQueueId, failedQueueId, … }`. |
| `hub.openrpa.workitems.createQueue(input)` / `updateQueue(id, input)` / `deleteQueue(id, { purge })` | Queue CRUD; `purge` removes the queue's items first. |
| `hub.openrpa.workitems.purgeQueue(id, { states })` | Delete a queue's work items (optionally only the chosen states). |
| `hub.openrpa.workitems.queueOverview()` | Per-queue item counts plus any orphaned queue ids. |
| `hub.openrpa.workitems.enqueue(queueId, input)` | Add one item; `input` may carry `payload`, `priority`, `nextRun`, `maxRetries` and `files`; the payload shape, priority and date are validated. |
| `hub.openrpa.workitems.enqueueMany(queueId, inputs)` | Bulk add with a per-item `{ ok, index, item \| error }` result. |
| `hub.openrpa.workitems.claim(queueId, { worker })` / `claimMany(queueId, count)` | Pop the next due item (priority order, skipping items whose next-run is in the future) and mark it `processing`. |
| `hub.openrpa.workitems.complete(item, { error, businessRule, result })` | Apply the outcome: success, retry within the policy, or terminal failure with routing to the failed queue. |
| `hub.openrpa.workitems.setState(item, to, { reason })` | Move an item through an allowed transition. |
| `hub.openrpa.workitems.retry(item)` / `requeue(item)` / `cancel(item)` | Return an item to `new` (keeping or clearing retries) or abandon it. |
| `hub.openrpa.workitems.updateItem(item, patch)` | Edit payload, priority, retries and error message/source/type. |
| `hub.openrpa.workitems.deleteItem(id)` / `deleteMany(ids)` | Delete one / many items. |
| `hub.openrpa.workitems.get(id)` / `queryItems(filters)` / `countsFor(queueId)` | Read and count items. |
| `hub.openrpa.workitems.board({ page, pageSize, queueId, state, priority, search })` | `{ items, counts, total, page, pageSize, pageCount, from, to, hasPrev, hasNext }` — the filtered board. |
| `hub.openrpa.workitems.stats()` / `reset()` | Counters and state reset. |

`hub.openrpa.files` — `createFileStore()` in `src/core/openrpa/files.js` —
stores a file's metadata record beside its content (mirroring
`OpenRPA.PS/Files/AddFile.cs` + `GetFile.cs`), guesses a content type from the
extension, verifies a stored checksum, and is the storage layer reused by the
asset-export work. The per-file limit is `OPENRPA_FILE_LIMIT` (5 MiB).

| Member | Description |
| --- | --- |
| `hub.openrpa.files.list({ refId, ref, search })` | Stored files, newest first. |
| `hub.openrpa.files.get(id)` / `content(id)` | `{ ok, file, content }` — the metadata plus its content. |
| `hub.openrpa.files.verify(id)` | `{ ok, valid, expected, actual, length }` — recompute the checksum. |
| `hub.openrpa.files.upload(input)` / `uploadMany(list)` | Store a file (`filename`, `content`, optional `contentType`, `encoding`, `refId`, `ref`). |
| `hub.openrpa.files.remove(id)` / `removeMany(ids)` | Delete one / many files. |
| `hub.openrpa.files.dataUrl(id)` | A `data:` URL for download/preview. |
| `hub.openrpa.files.attachToWorkItem(workItemId, input)` / `detachFromWorkItem(workItemId, fileId, { deleteFile })` | Wire a file into a work item's attachment list (and back out). |
| `hub.openrpa.files.stats()` / `reset()` | Counters and state reset. |

The OpenRPA work board screen (`#/openrpa-work`) surfaces all of the above:
queue CRUD with retry/routing policy, single and bulk enqueue, the claim /
lifecycle / retry / cancel / requeue / delete actions, the filterable board with
payload and error inspection, and the file storage with attach/detach.

### Workflow invocation, robots & Node-RED

`hub.openrpa.invocation` — `createInvocationService()` in
`src/core/openrpa/invocation.js` — dispatches a workflow and resolves the
correlated terminal reply into a normalised record. The states are `pending`,
`success`, `failed`, `timeout` and `cancelled` (`success`/`failed`/`timeout`/
`cancelled` are terminal). A caller can `wait: false` to fire-and-forget; the
service emits `workflow.invoked`, then `workflow.completed` or
`workflow.failed` onto the hub bus when it is wired through the hub.

| Member | Description |
| --- | --- |
| `hub.openrpa.invocation.states` / `terminalStates` | The state vocabulary and the terminal subset. |
| `hub.openrpa.invocation.invoke({ workflowId, queue, payload, correlationId, timeoutMs, wait, actor, simulateError, errorMessage, durationMs })` | Dispatch `createworkflowinstance` and (unless `wait: false`) await the correlated `workflowinstance` push → `{ ok, invocation, timedOut? }` (or `{ ok: true, invocation, awaiting: true }`). |
| `hub.openrpa.invocation.cancel(correlationId, { reason })` | Cancel a pending invocation (marks it `cancelled`). |
| `hub.openrpa.invocation.handleServerCommand({ command, data })` | Feed a server push through the correlation registry; returns whether it matched a pending invocation. |
| `hub.openrpa.invocation.pending()` / `history()` / `get(correlationId)` | The in-flight records, the completed history (bounded) and a single lookup. |
| `hub.openrpa.invocation.stats()` / `reset()` | Counters (`invoked`, `completed`, `failed`, `timedOut`, `cancelled`, `errors`, `unsolicited`, …) plus `pending`/`history` sizes, and state reset. |

`hub.openrpa.robots` — `createRobotRegistry()` in `src/core/openrpa/robots.js` —
lists the OpenFlow machines and derives presence from heartbeat age against
tunable thresholds (`staleAfterMs` default 120 s, `offlineAfterMs` default
600 s): `online`, `stale` or `offline`.

| Member | Description |
| --- | --- |
| `hub.openrpa.robots.presenceStates` / `thresholds` | The presence vocabulary and the active stale/offline thresholds. |
| `hub.openrpa.robots.list()` / `get(id)` | Normalised robots with presence, last heartbeat and age. |
| `hub.openrpa.robots.heartbeat(id, { metrics })` / `heartbeatAll()` | Write a heartbeat (optionally with metrics) for one robot or the whole fleet. |
| `hub.openrpa.robots.summary()` / `summarize(robots)` | `{ total, online, stale, offline, … }` fleet counts. |
| `hub.openrpa.robots.stats()` / `reset()` | Counters (`listed`, `heartbeats`, `errors`) and state reset. |

`hub.openrpa.nodered` — `createNodeRedRegistry()` in
`src/core/openrpa/nodered.js` — manages the Node-RED instances over the OpenFlow
document store. Instances normalise to `{ id, name, url, state, version,
docVersion, connectorId, linked }` with states `running`, `stopped`, `error`,
`unknown`.

| Member | Description |
| --- | --- |
| `hub.openrpa.nodered.list()` / `get(name)` | Normalised instances (or one). |
| `hub.openrpa.nodered.ensure(name, { url })` | Idempotently create/fetch an instance by name. |
| `hub.openrpa.nodered.restart(name)` / `remove(name)` | Restart or delete an instance. |
| `hub.openrpa.nodered.link(name, { connectorId })` / `unlink(name)` / `links()` | Link an instance to a hub connector (or list the links). |
| `hub.openrpa.nodered.summary()` / `summarize(instances)` / `stats()` / `reset()` | Fleet summary (`{ total, running, stopped, error, linked }`), counters and reset. |

`hub.openrpa.health()` folds the above together with the protocol counters and
queue depths into one probe; `hub.openrpa.status()` reports each subsystem's
stats. The **Automation & monitoring** screen (`#/openrpa-automation`) drives
all of it.

### Real-time event bridge

`hub.openrpa.bridge` — `createEventBridge()` in `src/core/openrpa/bridge.js` —
registers an OpenFlow exchange and every work-item queue, subscribes to document
watches, and translates the connector's server pushes into normalized hub
events from the `openrpa` taxonomy (`workitem.*`, `workflow.progress`,
`robot.*`, `collection.changed`). The terminal `workflowinstance` pushes are
left to the invocation service, so the two never both emit a completion.

`translateOpenRpaCommand(command, payload)` is exported for direct use and maps
`workitem`/`queuemessage` by lifecycle state, `watchevent`/`collectionchanged`
to `collection.changed`, `robot` to a heartbeat/stale/offline event, and a
non-terminal `workflowinstance` to `workflow.progress`.

| Member | Description |
| --- | --- |
| `hub.openrpa.bridge.dropPolicies` / `commands` / `watchCollections` / `exchange` | The vocabulary: `["drop-oldest","drop-newest","coalesce"]`, the translated server commands, the default watch collections and the exchange name. |
| `hub.openrpa.bridge.enable({ collections, exchange })` | Register the exchange and queues, watch the given collections and start the stream → `{ ok, enabled, registration, queues, watches }`. |
| `hub.openrpa.bridge.disable()` / `enabled()` | Stop the stream (and stop watching). |
| `hub.openrpa.bridge.register(exchange?)` | (Re-)register the exchange and every queue → `{ ok, exchange, queues, errors }`. |
| `hub.openrpa.bridge.registration()` | The registration snapshot: `{ exchange, connected, registeredAt, attempts, errors, queues, lastError }`. |
| `hub.openrpa.bridge.watch(collection, { filter })` / `watchMany(list)` / `unwatch(id)` / `unwatchAll()` / `watches()` | Manage OpenFlow document watches. |
| `hub.openrpa.bridge.handleState({ to })` | React to a connection-state change; on `connected` it re-registers and re-watches. |
| `hub.openrpa.bridge.handleServerCommand({ command, data })` / `deliver(command, payload)` / `translate(command, payload)` | Feed a push through translation and buffering. |
| `hub.openrpa.bridge.push(message)` / `drain()` / `flush()` / `buffered()` | Buffer with per-correlation ordering and the active backpressure policy, then emit in bounded batches (`flush()` drains everything). |
| `hub.openrpa.bridge.setDropPolicy(policy)` | Choose `drop-oldest`, `drop-newest` or `coalesce`. |
| `hub.openrpa.bridge.journal()` / `recent(n)` / `audit(filter)` / `replay(filter, handler)` | The persisted, sequence-numbered journal and its filtered replay/audit by `topic`, `type`, `correlationId`, `from`, `to` and `limit`. |
| `hub.openrpa.bridge.stats()` / `ready()` / `reset()` | Counters (`received`, `translated`, `ignored`, `emitted`, `rejected`, `dropped`, `coalesced`, `errors`, `reconnects`, …) plus buffer/journal sizes; hydration from and clearing of the `openrpa_bridge` collection. |

The **Event bus bridge** screen (`#/openrpa-events`) drives the enable/disable,
the registration and watches, the backpressure policy and the filtered
replay/audit over the bridged stream.

### Field ownership, entity links & drift-aware sync

`src/core/openrpa/ownership.js` declares which fields OpenRPA owns on each
mapped entity type and how a disagreement is resolved:

| Member | Description |
| --- | --- |
| `OPENRPA_FIELD_MODEL` | The OpenRPA-owned fields per entity type (`automationStatus`, `automationWorkflow`, `automationQueue`, `lastAutomationRun`, …), merged into `FIELD_MODEL` in `src/core/catalog.js`. |
| `OWNERSHIP_PRIORITIES` / `priorityOf(id)` | The per-connector conflict priority (`openrpa` 60, `rmm-u` 50, `it-u` 40, `psa-u` 30, `crm-u` 20, `ru` 10). |
| `OPENRPA_REMOTE_FIELDS` | The read/write mapping from each hub automation field to its OpenFlow document value. |
| `ownershipTable({ registry })` | The per-entity-type ownership matrix (field, owner, direction, priority, automation flag). |
| `registerOwnership({ registry })` | Validate the ownership declaration against the shipped registry → `{ ok, version, fields, priorities, issues, counts }`. |

`hub.openrpa.linking` — `createOpenRpaLinker()` in
`src/core/openrpa/linking.js` — binds canonical entities to OpenRPA targets:

| Member | Description |
| --- | --- |
| `hub.openrpa.linking.targetTypes` / `origins` | The link vocabulary: `workitem`, `queue`, `workflow`, `robot`, `invocation`, `nodered`, and `auto`/`manual`. |
| `hub.openrpa.linking.refreshTargets()` | Read the live endpoint and index every target, resolving work-item payload references (`companyId`, `hostname`, …) back to canonical entities → `{ ok, targets, refreshedAt }`. |
| `hub.openrpa.linking.targets({ targetType })` / `target(type, id)` / `remoteFor(type, id)` | The discovered targets and a normalized remote record. |
| `hub.openrpa.linking.link(input)` / `unlink(id)` / `unlinkWhere(pred)` / `unlinkEntity(type, id)` / `unlinkTarget(type, id)` | Write / remove links. |
| `hub.openrpa.linking.linksFor(type, id)` / `forTarget(type, id)` / `browse(filters)` | Read links (decorated with `entityName`, `targetName`, `resolved`, `missing`). |
| `hub.openrpa.linking.suggestions(type, id)` / `autolink({ entityTypes })` / `orphanReferences()` | Name-similarity suggestions, auto-linking from automation fields and payloads, and dangling payload references. |
| `hub.openrpa.linking.stats()` / `hydrate()` / `reset()` | Counters (`links`, `entities`, `resolved`, `unresolved`, `targets`, …) and the `openrpa_links` collection lifecycle. |

`hub.openrpa.drift` — `createOpenRpaDriftMonitor()` in
`src/core/openrpa/drift.js` — flags divergence as field, record or
relationship drift:

| Member | Description |
| --- | --- |
| `hub.openrpa.drift.scan({ refresh, capture })` | Refresh targets, compare, and update the ledger → `{ at, found, opened, updated, resolved, open }`. |
| `hub.openrpa.drift.open()` / `resolved()` / `entries()` / `forEntity(type, id)` | The drift ledger (`{ kind, severity, entityType, entityId, targetType, targetId, field, held, expected, detail, status }`). |
| `hub.openrpa.drift.snapshotFor(type, id)` / `captureTarget({ targetType, targetId })` / `captureTargets()` / `forgetTarget(type, id)` | The captured OpenFlow baselines (version + values) a record drift is measured against. |
| `hub.openrpa.drift.stats()` / `hydrate()` / `reset()` | Counters plus the drift/snapshot totals, and the `openrpa_sync` collection lifecycle. |

`hub.openrpa.sync` — `createOpenRpaSyncService()` in
`src/core/openrpa/sync.js` — turns drift into applied change:

| Member | Description |
| --- | --- |
| `hub.openrpa.sync.policies` / `policyLabels` / `policyNotes` | `manual`, `prefer-hub`, `prefer-openrpa` and their descriptions. |
| `hub.openrpa.sync.proposals({ policy })` | One proposal per open drift signal: `{ id, kind, entityType, entityId, field, hubValue, remoteValue, owner, priority, winner, action, auto, reason }`. |
| `hub.openrpa.sync.apply(proposal)` | Adopt (`openrpa` wins), push (`hub` wins), capture (re-baseline) or unlink, logging the change. |
| `hub.openrpa.sync.reconcile({ policy })` | Scan, then apply every automatic proposal → `{ policy, planned, applied, pending, failed }`. |
| `hub.openrpa.sync.history({ limit })` / `stats()` / `hydrate()` / `reset()` | The applied-change ledger (with `source`) and its counters. |

`hub.openrpa.conflicts` — `createOpenRpaConflictReview()` in
`src/core/openrpa/conflicts.js` — is the review surface:

| Member | Description |
| --- | --- |
| `hub.openrpa.conflicts.proposals({ policy, includeDecided })` / `diff(proposal)` | Pending proposals (each with its decision) and a hub-vs-OpenRPA diff. |
| `hub.openrpa.conflicts.approve(id, { policy, resolution })` / `reject(id, { reason })` / `undo(id)` | Decide a proposal; approving applies it through `sync`. |
| `hub.openrpa.conflicts.decisionRecords()` / `decisionFor(id)` / `stats()` / `hydrate()` / `reset()` | The persisted decision history. |

The **Sync & conflicts** screen (`#/openrpa-sync`) drives all of it: the
ownership matrix, entity linking, drift scanning, policy reconciliation and
proposal review.

### Bundles, export & import

`src/core/openrpa/bundles.js` defines the portable format and its store:

| Member | Description |
| --- | --- |
| `OPENRPA_BUNDLE_FORMAT` / `OPENRPA_BUNDLE_VERSION` / `OPENRPA_BUNDLE_MIN_VERSION` | The bundle writer identity (`rpa-u/openrpa-bundle`) and the supported read range (v1). |
| `OPENRPA_BUNDLE_SECTIONS` / `sectionLabel(id)` | The five sections: `profiles`, `ownership`, `links`, `documents`, `assets`, and their labels. |
| `OPENRPA_BUNDLE_DOCUMENT_COLLECTIONS` | The OpenFlow collections snapshotted by default (`workflows`, `openrpa_queue`, `openrpa_workitem`, `openrpa_robot`, `nodered`, `companies`). |
| `OPENRPA_PROFILE_FIELDS` / `sanitizeProfile(profile)` / `isSecretKey(key)` | The connection-profile allow-list; `sanitizeProfile` returns `{ profile, excluded, secrets }`, so a credential-like field is stripped and reported. |
| `parseBundle(text)` | Parse bundle text → `{ ok, bundle }` or `{ ok: false, error: { code, message } }` (`empty`, `invalid-json`). |

`hub.openrpa.bundles` — `createOpenRpaBundleStore()` — builds and applies them:

| Member | Description |
| --- | --- |
| `hub.openrpa.bundles.build(options)` | Snapshot the hub → `{ ok, bundle }`. `options` carries `name`, `description`, `profileIds`, `collections` and the `includeProfiles`/`includeOwnership`/`includeLinks`/`includeDocuments`/`includeAssets` toggles. The bundle has `counts`, a per-item `manifest` and a `fingerprint`. |
| `hub.openrpa.bundles.export(options)` | Build, publish (unless `publish: false`) and return `{ ok, bundle, json, filename, bytes }`. |
| `hub.openrpa.bundles.validate(input)` | Format, version (`newer-version`, `older-version`) and section-shape checks → `{ ok, errors, warnings, counts, version, id, name, createdAt }`. |
| `hub.openrpa.bundles.plan(input, { sections })` / `preview(...)` | A dry run: per-section entries with an `action` (`create`/`update`/`skip`) and a `summary`, plus warnings for unknown target types, missing entities and already-stored assets. |
| `hub.openrpa.bundles.import(input, { dryRun })` | Apply the plan through `profiles.create`, `linking.link`, `documents.upsert` and `files.upload` → `{ ok, applied, failed, warnings, summary }`. |
| `hub.openrpa.bundles.register(bundle)` / `list()` / `get(id)` / `latest()` / `remove(id)` / `stats()` / `hydrate()` / `reset()` | The published-bundle history (bounded), its counters, and the `openrpa_bundles` collection lifecycle. |

The **Export & import** screen (`#/openrpa-bundles`) drives the store end to
end. The **OpenRPA guide** screen (`#/openrpa-guide`) renders the `OPENRPA_HELP`
topic notes (`src/views/guides.js`) as an in-app walkthrough, including
troubleshooting a failed connection.

---

## Persistence

`hub.db` — `createDb()` in `src/core/db.js` — is a thin, collection-oriented
store over `kv-plugin`, with an in-memory fallback so the app degrades gracefully
when kv is unavailable (`hub.storageMode()` reports `"kv"` or `"memory"`).

| Member | Description |
| --- | --- |
| `register(collection)` | Ensure a collection exists. |
| `put(collection, key, value)` / `putMany(collection, entries)` | Write one/many records. |
| `get(collection, key)` / `has(collection, key)` | Read one record / test existence. |
| `all(collection)` / `entries(collection)` / `count(collection)` | Read a collection. |
| `remove(collection, key)` / `clear(collection)` | Delete a record / a whole collection. |
| `ready()` / `mode` / `namespace` / `collections` | Lifecycle and metadata. |

Collections are named `<storageNamespace>__<collection>` (e.g.
`pu-rpa-u__companies`). See [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) §4
before changing the namespace.
