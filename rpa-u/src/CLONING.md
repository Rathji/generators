# Cloning & instantiating a Project U member

RPA-U is the *hub*. The tools it integrates — IT-U, CRM-U, PSA-U, RMM-U
and any future member — are separate generators built from the same base
framework, **template-u** (`https://perchance.org/template-u`). This guide walks
through creating a new member and wiring it to the hub.

There are two ways to start a member:

- **From the template** (recommended) — `template-u` is the canonical, minimal
  framework: shell, theme, router, persistence, UI components and docs, with no
  domain logic. This is the intended starting point.
- **By forking RPA-U** — only if you want a member that already contains
  the hub's domain code (registry, bus, linking, …). Heavier, but useful when
  the new member is another *hub-like* integration tool.

---

## Part A — Spin up the member generator

1. **Open the template.** Go to `https://perchance.org/template-u` (or your own
   fork of it).
2. **Save / fork it.** Click save. Perchance will fork it into a generator you
   own with a generated name like `vibrant-forest`.
3. **Rename it.** Open the generator **settings** and set a kebab-case name for
   your member, e.g. `inv-u` (invoicing) or `kb-u` (knowledge base). Do this
   **before** the member collects any data — renaming later re-partitions the
   browser storage (see [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) §4).
4. **Edit the `pu` block** in `main.pjs` (the full key reference is in
   [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) §1):
   - `appId` — the member's kebab-case id, e.g. `inv-u`.
   - `appTitle`, `appShortTitle`, `tagline`, `logoMark`, `copyright`.
   - `storageNamespace` — a **unique** namespace, e.g. `pu-inv-u`. Never reuse
     another generator's namespace.
   - `branding.primary` / `branding.accent` — give the member its own colour so
     it is distinguishable in the hub's connectivity dashboard.
5. **Update metadata** in `main.pjs`: `$meta.title`, `$meta.description`,
   `$meta.tags`. For query-aware metadata, see the platform's `$meta.dynamic`.
6. **Add the member's views/routes.** Create modules in `src/views/` exporting
   route objects `{ id, title, group, icon, nav, render(ctx) }` and register
   them in the `routes` array in `src/app.js`. Add any new icons to `ICONS` in
   `src/framework/shell.js`.
7. **Run the framework tests** (**Validation tests** screen → *Run all tests*)
   and preview at phone + desktop widths with no console errors.
8. **Publish** when the member stands on its own.

> **Keep generator links portable.** Never hardcode a generator's name or its
> 32-char `publicId` in URLs. Link to `https://perchance.org/<name>` (read the
> name from `window.generatorName` if you must build it) and use
> `https://null.perchance.org/<name>` when embedding another generator in an
> iframe.

---

## Part B — Register the member with the hub

The hub only knows about tools that appear in its catalog. Registering is a
one-file change plus whatever domain wiring the member needs.

### B.1 Declare the connector

In RPA-U's `src/core/catalog.js`, add an entry to `CONNECTORS`:

```js
{
  id: "inv-u",                       // stable kebab-case; the event `source`
  name: "INV-U",
  label: "Invoicing & billing",
  accent: "#be123c",                 // colour in the connectivity dashboard
  entityTypes: ["company", "invoice"], // which ENTITY_TYPES it may hold
}
```

If the member introduces a brand-new entity kind, add it to `ENTITY_TYPES`
first (with its `collection`, labels, id prefix, name field and natural keys).

### B.2 Declare field ownership

Decide, for every shared field, which tool owns it. Add or amend entries in
`FIELD_MODEL` for the affected entity types:

```js
invoice: [
  { key: "amount", label: "Amount", owner: "inv-u", authoritative: true, direction: "push" },
  // …
]
```

Rules of thumb:

- Exactly one `owner` per field; the owner is the single source of truth.
- `pull` for on-demand reads (the value is never copied elsewhere);
  `push` when the owner broadcasts changes; `bidirectional` when either side may
  propose but the owner wins; `none` for tool-private fields.
- Mark hub-derived values `computed: true`, and personal/financial fields
  `sensitive: true` so they are stripped from exported bundles by default.

Then map the member's native roles onto canonical roles in `TOOL_ROLE_MAPS`
(`"inv-u": { "Billing Clerk": "billing", "Finance Manager": "admin", … }`) and
grant any new capabilities through `CAPABILITIES` / `CANONICAL_ROLES`.

### B.3 Run the registry self-check

```js
window.puApp.hub.registry.validate();
```

Resolve every `error` (and review the `warn`s) until `ok === true`. The
**Integration registry** screen shows the same report.

### B.4 Wire the member to the event bus

Members are connected through the **event bus** — never by editing each other's
data. A member integration does three things:

1. **Publish** events with `source` set to its connector id:

   ```js
   hub.publish("invoice.created", { invoiceId, companyId, amount }, { source: "inv-u" });
   ```

   Only catalog event types are accepted; unknown types are rejected. See
   [`API.md`](./API.md) for the envelope, payload validation and return value.

2. **Subscribe** to the topics it cares about:

   ```js
   hub.bus.subscribe("ticket.*", async (event) => { /* react */ }, { connector: "inv-u" });
   ```

3. **Recover** missed events from its checkpoint after downtime:

   ```js
   hub.log.recover("inv-u"); // events since this connector's last checkpoint
   ```

If the member is a *real* Perchance generator, it participates by honouring the
same event contracts: it publishes its own events with its connector id as the
`source`, and reacts to the topics it subscribes to. Keep the contracts in
`event-catalog.js` as the single source of truth so both sides validate the same
schema.

### B.5 Simulate and verify

Before shipping a member, prove the integration in the hub:

- **Demo data:** in the hub's `src/core/demo-data.js`, add ground
  truth records for the new connector so `seed()` produces data it owns.
- **Check the screens:** the **Integration registry** shows the new owner rules,
  **Entity links** / **Search** surface its entities, and the **Connector
  monitor** probes it (inject an outage to watch it go degraded/down).
- **Run the tests:** `await window.puTests.run()` must stay green.

---

## Part C — Minimal example: adding `INV-U`

```js
// src/core/catalog.js
CONNECTORS.push({
  id: "inv-u", name: "INV-U", label: "Invoicing & billing",
  accent: "#be123c", entityTypes: ["company", "invoice"],
});

// invoice fields already owned by psa-u; move nothing unless INV-U is the
// authoritative billing system. If it is, re-own the billing fields:
//   { key: "amount", label: "Amount", owner: "inv-u", authoritative: true, direction: "push" }

TOOL_ROLE_MAPS["inv-u"] = { "Finance Manager": "admin", "Billing Clerk": "billing" };
```

Publish/subscribe from INV-U:

```js
// publish — INV-U raises an invoice
await hub.publish("invoice.created",
  { invoiceId: "iv_123", companyId: "co_9", amount: 4800 },
  { source: "inv-u", subject: { entityType: "invoice", entityId: "iv_123" } });

// subscribe — INV-U wants to hear about new tickets and companies
const handle = hub.bus.subscribe("ticket.*", handler, { connector: "inv-u", label: "invoice-from-ticket" });
// handle.unsubscribe() to stop
```

Then run `registry.validate()` and the test suite.

---

## Reference

- [`README.md`](./README.md) — purpose, architecture, conventions.
- [`CUSTOMIZATION.md`](./CUSTOMIZATION.md) — every config key and the catalog.
- [`API.md`](./API.md) — the event bus, registry and the rest of the hub APIs.
- Base framework: `https://perchance.org/template-u`.
