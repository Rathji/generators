# Integrate-U API reference

This document describes the internal JavaScript APIs of the hub for developers
extending Integrate-U or writing a connector that talks to it. The two APIs at
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
`jobs`, `conflicts`, `alerts`, `drift`, `bundles`, `audit`, `monitor`, plus the
high-level `publish`, `ingest`, `merge`, `seed`, `seedIfEmpty`, `seedDriftJobs`,
`primeIntegrity`, `resetData` and `ready`.

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
| `source` | string | Connector id emitting the event. Default `"iu"`. |
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
`pu-integrate-u__companies`). See [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) §4
before changing the namespace.
