# Customizing RPA-U

This guide lists **exactly what to change** when you deploy your own copy of
RPA-U — whether you are rebranding the hub, pointing it at a different set
of connectors, or extending its field model. It is the companion to
[`CLONING.md`](./CLONING.md) (spinning up a *new member*) and
[`API.md`](./API.md) (the internal APIs).

Everything in this document is about *configuration*. The hub's behaviour lives
in `src/` and is described in [`README.md`](./README.md); you normally do not
have to touch it to deploy.

---

## 1. The `pu` block (`main.pjs`)

All deployment configuration lives in the declarative `pu` block at the top of
[`main.pjs`](../main.pjs). It is read once at startup by
`src/framework/config.js` (`getConfig()` → `normalizeConfig()`), which fills in
`DEFAULT_CONFIG` for any value you omit or leave blank. The tables below show
the values this generator currently ships in `main.pjs`.

```pjs
pu
  appId = rpa-u
  appTitle = RPA-U
  appShortTitle = RU
  tagline = One identity, one registry, every Project U tool
  companyName = Project U
  version = 0.1.0
  storageNamespace = pu-rpa-u
  defaultTheme = navy
  logoMark = RU
  copyright = Project U
  docsUrl = https://perchance.org/template-u

  branding
    primary = #1e3a8a
    accent = #0d9488
    fontSans = Inter
```

### Identity keys

| Key | Shipped value | What it controls | Change it? |
| --- | --- | --- | --- |
| `appId` | `rpa-u` | Machine id for the app. **Must be kebab-case** (`/^[a-z0-9]+(-[a-z0-9]+)*$/`); anything else silently falls back to the default. Used by tests and as a stable app identifier. | Yes — set to your hub's kebab-case stub. |
| `appTitle` | `RPA-U` | Full display name in the header, `<title>` and the sidebar logo. | Yes. |
| `appShortTitle` | `RU` | Short name used where space is tight. | Yes. |
| `tagline` | `One identity, one registry, every Project U tool` | Sub-title under the logo and on the overview hero. | Yes. |
| `companyName` | `Project U` | The organisation the hub belongs to; shown in footer/attribution copy. | Yes. |
| `version` | `0.1.0` | Displayed app version; surfaced on the overview/HUD. | Yes. |
| `storageNamespace` | `pu-rpa-u` | **Data namespace.** Every `kv-plugin` collection is stored under `<storageNamespace>__<collection>`. Renaming this **orphans all existing local data** (the hub will look empty and re-seed). | Yes, but only before real data exists — see §4. |
| `defaultTheme` | `navy` | Theme id applied on first visit (the user's own choice is remembered). | Optional. |
| `logoMark` | `RU` | Text drawn inside the logo tile when no `logoUrl` is set. | Yes. |
| `copyright` | `Project U` | Copyright holder in the footer. | Yes. |
| `docsUrl` | `https://perchance.org/template-u` | Link used by "docs" affordances (help/footer). Point it at your own instance's docs. | Yes. |

### Branding keys (`branding` sub-block)

Leave a value blank to inherit the Project U default. `logoUrl`, `fontSans` and
`footer` may be omitted entirely.

| Key | Shipped value | What it controls |
| --- | --- | --- |
| `primary` | `#1e3a8a` | Primary brand colour: buttons, active nav, links, chips, logo gradient. |
| `accent` | `#0d9488` | Accent colour: focus rings, secondary highlights. |
| `fontSans` | `Inter` | Sans-serif font family for the whole UI. |
| `logoUrl` | _(blank)_ | Image shown in the logo tile instead of `logoMark`. |
| `footer` | _(blank)_ | Extra footer/attribution line; falls back to `copyright`. |

> **Tip:** brand colours are also exposed as CSS custom properties
> (`--pu-primary`, `--pu-accent`, `--pu-font-sans`) via
> `src/framework/theme.js`, so anything in `src/styles.css` follows the config
> automatically. Prefer changing the config over editing `styles.css`.

The defaults live in `DEFAULT_CONFIG` in `src/framework/config.js`. If you add a
**new** config key, add it there too so there is a sane fallback.

---

## 2. The connector catalog (`src/core/catalog.js`)

The catalog is the hub's model of the world: which tools exist, which entity
types they hold, which field each one owns, and how roles map onto each tool.
Editing it is the main *domain* customization step.

`CONNECTORS` — one entry per Project U member plus the hub itself:

```js
{ id: "crm-u", name: "CRM-U", label: "Customer relationship management",
  accent: "#7c3aed", entityTypes: ["company", "customer"] }
```

- `id` — the connector id used as the event `source`, in ownership rules and in
  subscriptions. Keep it kebab-case and stable; it is the join key everywhere.
- `name` / `label` — display name and one-line purpose.
- `accent` — dot/badge colour in the connectivity dashboard.
- `entityTypes` — which `ENTITY_TYPES` ids this tool is allowed to hold.
- `hub: true` marks the hub itself (RPA-U); it declares every entity type.

`ENTITY_TYPES` — the canonical entity kinds (`company`, `customer`, `device`,
`ticket`, `invoice`). Each declares its `collection`, display labels, id prefix,
name field and the natural keys used for identity matching.

`FIELD_MODEL` — per entity type, the list of fields and **who owns each one**:

```js
{ key: "domain", label: "Primary domain", owner: "crm-u",
  authoritative: true, direction: "push" }
```

- `owner` — the connector that holds the truth for this field.
- `authoritative` — whether the owner's value is trusted over derived copies.
- `direction` — one of `push`, `pull`, `bidirectional`, `none`
  (see `DIRECTIONS`).
- `computed` — true for hub-derived/count fields (e.g. `assetCount`).
- `sensitive` — true for fields stripped from exported bundles unless opted in
  (e.g. `taxId`).

`CAPABILITIES`, `CANONICAL_ROLES` and `TOOL_ROLE_MAPS` — the permission model.
Add a capability to `CAPABILITIES`, grant it to canonical roles in
`CANONICAL_ROLES`, and map each tool's native role names to a canonical role in
`TOOL_ROLE_MAPS`.

`OPENRPA_DESCRIPTOR` (in `src/core/openrpa/constants.js`) is a connector entry
like any other: it is appended to `CONNECTORS`, and its OpenFlow role names are
mapped in `TOOL_ROLE_MAPS.openrpa`. The rest of the OpenRPA connector — the wire
protocol, the offline emulator, profile validation, the session manager, the
document model, the workflow presentation and the ACL mirror — lives under
`src/core/openrpa/`; edit those modules to change connector behaviour rather than
the hub core.

`OPENRPA_DOCUMENT_TYPES` (in `src/core/openrpa/documents.js`) declares the
modelled OpenFlow collections. Each entry carries `id`, `label`, `plural`,
`collection`, `summaryKeys` (the fields shown in the browser's summary column),
`large` (fields hidden behind a reveal, e.g. `xaml`) and a `fields` list of
`{ key, label, kind }` descriptors. Add an entry to model a new collection; any
field an entry does not declare is preserved losslessly as an “unmapped” field.
The same module holds `NAMED_QUERIES` (the named-query aliases shown in the
browser) and `OPENRPA_RIGHTS` / `OPENRPA_ACTIONS` (in `src/core/openrpa/acl.js`)
define the rights bitmask and the actions the ACL exposes.

After editing, the hub can self-check the catalog:

```js
window.puApp.hub.registry.validate();
// → { ok, issues: [{ level, code, message, ref }], counts }
```

`validate()` flags unknown owners, duplicate fields, invalid directions, entity
types an owner does not declare and empty entity types. The **Integration
registry** and **Permissions** screens render the result, so a mistake shows up
in the UI rather than as a silent mis-sync.

---

## 3. Demo data, views and routes

- **Demo data** — `src/core/demo-data.js` holds the seeded ground-truth feeds
  for the four connectors. Replace it with your own examples (or delete the seed
  call in `src/core/hub.js` → `seed()`) before publishing a real deployment.
- **Views** — each screen is a module in `src/views/` exporting a route object
  `{ id, title, group, icon, nav, render(ctx) }`. Add or remove screens there.
- **Routes** — register views in `src/app.js` (`routes: [...]`). The sidebar is
  generated from `nav: true` routes, grouped by `group`.
- **Icons** — add a glyph to `ICONS` in `src/framework/shell.js` if a new route
  needs one.
- **Branding/theme** — `src/framework/theme.js` turns the `branding` block into
  CSS variables; `src/styles.css` holds the components.

---

## 4. Renaming, storage and the "data orphaning" trap

Storage is keyed by `storageNamespace`, **not** by the generator name — but the
two are usually changed together, and both have consequences:

1. Changing `storageNamespace` makes the hub treat existing `kv-plugin` data as
   gone; on next load it re-seeds from `demo-data.js`. Do this **before** there
   is real data, or export first (the **Data bundles** screen) and re-import.
2. Renaming a **generator on Perchance** changes its subdomain, which re-partitions
   the browser's storage for that page. See the platform guidance: settle on a
   name (or fork deliberately) *before* accumulating data. Prefer forking and
   linking from the old generator over renaming an in-use one.
3. If you keep two hubs side by side, give them **different**
   `storageNamespace` values so they never share collections.

---

## 5. Deployment checklist

- [ ] Set every `pu` identity key (`appId` kebab-case, titles, tagline, version).
- [ ] Set a unique `storageNamespace` and confirm it holds no data you need.
- [ ] Apply `branding` colours/font/logo (or leave blank to inherit).
- [ ] Update `docsUrl` (and any generator links) to your own instance.
- [ ] Edit `CONNECTORS`, `ENTITY_TYPES`, `FIELD_MODEL`, roles and tool maps for
      your tools, then run `registry.validate()` until `ok` is `true`.
- [ ] Replace `demo-data.js`, or turn the seed off.
- [ ] Update `$meta.title` / `$meta.description` / `$meta.tags` in `main.pjs`.
- [ ] Run the in-app tests (**Validation tests** screen → *Run all tests*) and
      load the preview at phone (390×844) and desktop (1920×1080) widths with no
      console errors.
- [ ] Save/publish the generator.

See [`CLONING.md`](./CLONING.md) for spinning up a *new connector* that talks to
the hub.
