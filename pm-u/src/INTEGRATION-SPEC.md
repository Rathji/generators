# Project U — Integration Spec (reference, don't copy)

PM-U is one member of the **Project U** family (`project-u`, `pm-u`, `crm-u`, `psa-u`,
`quote-u`, `it-u`, `rmm-u`, `integrate-u`, `template-u`, …). This document is the
normative description of how PM-U links to its siblings, and the checklist a future
member should follow to interoperate the same way.

---

## 1. The rule

> **Members link to each other. They never import each other's code.**

There is no shared backend and no published hub wire protocol. Every member is its own
generator with its own origin, its own store and its own schema. A member therefore
integrates by **reference**:

- it **lists** the other members (a registry),
- it **identifies** shared real-world things (companies/customers) by a **global shared
  id**, and
- it **deep-links** into the owning member for any data it does not own.

Nothing is copied, mirrored or kept in sync by the platform. The only shared thing is an
identifier string.

**Why:** importing a sibling's `src/` would fork its code into PM-U and cause divergence;
there is no CDN-retrievable cross-member module and no hub API to call. Reference-only
integration is testable in isolation, safe (read-only links), and leaves each member free
to evolve.

Implementation lives in [`src/pm/integrate.js`](pm/integrate.js) (pure — registry,
shared ids, deep links, descriptor) and [`src/pm/identities.js`](pm/identities.js)
(identity records + cross-app references).

---

## 2. The member registry

`MEMBERS` in `src/pm/integrate.js` is the single source of truth for the family. Each
entry:

```js
{
  id: "crm-u",                 // generator slug
  title: "CRM-U",              // display name
  short: "CRM",                // compact badge
  accent: "#2563eb",           // brand colour for launcher cards
  role: "hub" | "member",
  description: "…",
  entities: [ { type, label, route } ]   // the record kinds it owns, and the hash-route
                                          // where one opens in that member
}
```

Helpers: `member(id)`, `members()`, `memberUrl(id)` (`https://perchance.org/<id>`),
`entityTypes(id)`, `entityLabel(id, type)`, `isKnownEntity(id, type)`.

Only ids present in `MEMBERS` can be referenced or deep-linked.

---

## 3. The shared-id scheme

A **shared id** is an opaque, self-describing string:

```
puid~<app>~<kind>~<uid>
```

e.g. `puid~pm-u~company~3f9a…`, `puid~crm-u~account~ab12…`.

| Helper | Purpose |
| --- | --- |
| `mintSharedId(app, kind, uid?)` | Create a new shared id (random uid if omitted). |
| `parseSharedId(value)` | → `{ app, kind, uid }` or `null`. |
| `isSharedId(value)` | Validity check. |
| `sharedIdApp(value)` / `sharedIdKind(value)` | Extract one part. |

The scheme is exported as `SHARED_ID_SCHEME` and `SHARED_ID_PREFIX = "puid"`. Shared ids
are **identifiers, not secrets** — they travel in URLs and are safe to display and copy.

---

## 4. Shared identities (companies & customers)

PM-U treats `company` and `customer` as first-class local records (schema **v2**). Each
carries a `sharedId`; the *same* shared id means the *same* real-world entity inside the
other members.

```
{ id, type: "company"|"customer", name, sharedId, email, domain, phone, notes, externalRef }
```

- `createIdentity(store, kind, fields)` — new local record, mints a shared id if none given.
- `ensureIdentity(store, sharedId, fields)` — **idempotent adopt**: if the shared id is
  already local it updates the display name, otherwise it creates the record. This is what
  makes re-linking safe.
- `identityBySharedId(store, sharedId)`, `identityProjects(store, identity)` — lookup and
  the projects that point at the identity.

Projects point at an identity through `companyId` / `customerId`, so a project can be
associated with a shared company/customer without copying any CRM/PSA data.

---

## 5. Identity cross-links (read-only)

`identityTargets(kind)` declares which siblings hold which identity kinds, and
`identityLinks(kind, sharedId)` turns that into read-only links:

| Identity | Members that hold it |
| --- | --- |
| `company` | CRM-U (`account`), PSA-U (`client`), IT-U (`organization`), RMM-U (`organization`) |
| `customer` | CRM-U (`contact`), PSA-U (`client`), Quote-U (`customer`) |

Each link is a `recordHref({ app, type, id: sharedId })` — a deep link that opens the
owning member with the shared id attached. PM-U renders them as chips; it never edits the
remote record.

---

## 6. Cross-app references

Any owner record can carry a list of references to records that live elsewhere:

```js
refs: [ { app: "crm-u", type: "account", id: "puid~crm-u~account~…", label: "Acme Ltd" } ]
```

Owner types: `project`, `task`, `event`, `checklist`, `note`, `habit`, `board`
(`REF_OWNER_TYPES`).

| Helper | Purpose |
| --- | --- |
| `normalizeRef(ref)` | Coerce/validate → `{ app, type, id, label }`; `null` if the app is unknown or the id is missing. |
| `refKey(ref)` | Stable dedupe key `app/type/id`. |
| `addRef(store, ownerType, ownerId, ref)` | Add (deduped by `refKey`; rejects invalid refs). |
| `removeRef(store, ownerType, ownerId, key)` | Remove by key. |
| `recordHref({ app, type, id, route })` | Build the deep link to the owning member's record. |
| `allRefs(store)` / `recordRefs(rec)` | Enumerate references. |

References are always rendered **read-only** (badge + "open in app" + delete chip). Editing
the remote record happens in the owning member.

---

## 7. Deep links

A deep link to another member is:

```
https://perchance.org/<app>#/<route>?ref=<sharedId>
```

- `route` is the owner's own hash-route (best-effort; from the member's `entities` map).
- The **shared id always rides in the `ref` query param** — the route is a hint, the ref
  is what actually identifies the record. A member that doesn't recognise the route still
  receives the reference.

**Inbound** (`?ref=&name=`): at boot, PM-U parses the query, calls
`importIdentityFromParams(store, params)`, and if it recognises a shared id it adopts the
identity (via `ensureIdentity`), toasts, and opens the **Project U** (ecosystem) view. This
is how a sibling hands PM-U an identity. `kind` + `sid` params are also accepted for a
plain (non-`puid`) identity handshake.

`REF_PARAM` (`"ref"`) is exported so both sides use the same parameter name.

---

## 8. The member descriptor

PM-U publishes a machine-readable manifest so the central hub (and Integrate-U) can list,
theme and launch it. It exists in two places, kept identical:

- **Runtime:** `PU.member` (also `window.pm.integrate.descriptor`), built by
  `buildMemberDescriptor()`.
- **Static:** [`src/member.json`](member.json), the committed copy.

```json
{
  "$schema": "project-u/member-descriptor@1",
  "family": "Project U",
  "id": "pm-u",
  "title": "PM-U",
  "short": "PMU",
  "accent": "#0d9488",
  "description": "…",
  "version": "0.1.0",
  "url": "https://perchance.org/pm-u",
  "launch": { "group": "Business", "icon": "briefcase", "order": 30 },
  "entities": [ { "type": "project", "label": "Project" }, … ],
  "primaryEntities": ["project", "task"],
  "sharedIdScheme": "puid~<app>~<kind>~<uid>",
  "refParam": "ref"
}
```

- `launch.{group,icon,order}` tells the hub where to place PM-U in its launcher.
- `entities` / `primaryEntities` tell the hub (and siblings) what PM-U owns.
- The descriptor is available to Integrate-U via `window.pm.integrate` and the static file.

Inside PM-U, the command palette exposes `/open <member>` for every sibling, which opens
that member's canonical `memberUrl`.

---

## 9. Implementing this in a new member

To join the family the same way:

- [ ] Add your member to `MEMBERS` in your own `integrate.js` (id, title, accent, entities,
      routes) and to PM-U's `MEMBERS` so it can link to you.
- [ ] Adopt the shared-id scheme `puid~<your-app>~<kind>~<uid>` for any shared identity.
- [ ] Store identities as `company` / `customer` (or your equivalents) with a `sharedId`,
      and implement an idempotent adopt (`ensureIdentity` behaviour).
- [ ] Support an inbound `?ref=<sharedId>` (and `&name=`) deep link: adopt the identity,
      don't duplicate it.
- [ ] Build outbound links with the `#/<route>?ref=<sharedId>` form.
- [ ] Carry cross-app references on owner records as `refs:[{app,type,id,label}]`, rendered
      read-only.
- [ ] Publish a member descriptor (`PU.member` + a static `member.json`) with your
      `launch` placement.
- [ ] **Never** import another member's source or copy its records.

---

## 10. Constraints & security

- Shared ids and descriptors are **public** — never put secrets, tokens or personal data in
  them.
- Cross-member references are **read-only**; PM-U does not write to sibling generators and
  does not fetch their data.
- All PM-U data stays local (IndexedDB via `kv`); integrating with a sibling never uploads
  anything.
- Because there is no hub API, the contract is enforced **on the PM-U side** and verified
  by the `integrate` and `identity` test suites. Any future hub protocol should extend this
  spec rather than bypass it.
