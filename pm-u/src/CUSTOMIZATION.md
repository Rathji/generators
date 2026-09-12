# Customization Guide

PM-U is designed so that **rebranding and reshaping need no framework edits**. Everything
you are expected to change lives in four places, in order of how often you'll touch them:

1. `main.pjs` — the `$meta` block and the `pu` config block.
2. **Settings → Branding** — runtime overrides (no source edit at all).
3. `src/views.js` + `src/app.js` — add/remove/rename sections.
4. `src/pm/*` — feature behaviour.

Framework code in `src/framework/` should *not* need editing. If it does, upstream the
change to Template-U so every family member benefits (see
[`CLONE-GUIDE.md`](CLONE-GUIDE.md#keeping-the-family-consistent)).

---

## 1. `main.pjs` — config and metadata

This is the primary surface. Edit values; never hard-code them in views.

### `$meta`

| Key | Meaning |
| --- | --- |
| `$meta.title` | Generator title (listing page + social card). |
| `$meta.description` | Listing/SEO description. |
| `$meta.image` | Listing + social-share thumbnail URL. |
| `$meta.tags` | Comma-separated discovery tags. |
| `$meta.header.mode` | `minimal` keeps the Perchance header out of the way. |

### `pu` — the config block

Read by `src/app.js` (`readConfig`) and `src/framework/branding.js`.

| Key | Meaning |
| --- | --- |
| `appTitle` | Application + document title. |
| `appShortTitle` | Fallback logo mark. |
| `tagline` | Shown under the title and in metadata. |
| `companyName` | Owning company / organisation. |
| `version` | Member version (shown in the header badge). |
| `storageNamespace` | Prefix for all `localStorage` keys. **Change this on clone.** |
| `defaultTheme` | One of `navy`, `sky`, `sand`, `midnight`, `slate`. |
| `logoMark` | 1–3 character logo mark. |
| `footer` | Sidebar footer text. |
| `branding.primary` | Brand colour (hex) → `--pu-primary` + derived tokens. |
| `branding.accent` | Accent colour (hex) → `--pu-accent` + derived tokens. |
| `branding.fontSans` | Interface font family name. |
| `branding.logoUrl` | Optional image used in place of `logoMark`. |

### Rebranding example

```pjs
pu
  appTitle = Acme Tools
  appShortTitle = AC
  tagline = Manage your service business
  companyName = Acme Ltd
  storageNamespace = acme-tools
  logoMark = AC
  defaultTheme = navy
  branding
    primary = #0f766e
    accent = #b45309
    fontSans = Inter
```

Colours are converted into semantic tokens by `src/framework/branding.js`
(`--pu-primary`, `--pu-primary-hover/active/contrast/soft`, `--pu-ring`, `--pu-accent`,
`--pu-accent-soft`) so every component follows automatically.

**Branding precedence** (lowest → highest): framework defaults → `pu.branding` →
top-level `pu` naming values → **runtime overrides**. Because runtime overrides win, a
value saved in Settings survives despite the `main.pjs` defaults.

---

## 2. Runtime branding — Settings, no source edit

The **Settings → Branding** group writes overrides to framework storage under the key
`<storageNamespace>:branding:v1` (for PM-U: `pu-pm:branding:v1`). These are merged over
the `main.pjs` config at boot, so you can change the primary/accent colour and the app
title/tagline from inside the running app. **Reset to defaults** clears the overrides.

This is the right surface for *end-user* customization. Use `main.pjs` when you want a
value baked in for every user.

---

## 3. Sections — add, remove, rename

Sections are declared once in `src/app.js` and mounted from `src/views.js`. The registry
drives both the sidebar and the router, so there is no separate route table to edit.

```js
// src/app.js
registerView("invoices", {
  label: "Invoices",
  icon: "table",              // a key from src/pm/icons.js (PM's icon set)
  group: "Plan",              // Overview | Plan | Track | Tools | System
  order: 35,                  // position within its group
  optional: true,             // marked optional in the registry (see note below)
  description: "Create and send invoices.",
}, views.invoices);
```

```js
// src/views.js — the adapter
export const invoices = {
  render(outlet, ctx) {
    outlet.innerHTML = invoicesViewHTML(ctx.app.store, ctx);
    wireInvoicesView(ctx.app.store, ctx);
  },
};
```

- `optional: true` marks the section as optional in the registry. The framework can
  enable/disable sections at runtime (`app.registry.setEnabled(id, bool)` /
  `registry.toggle(id)`); PM-U does not currently render a Settings toggle for this, so an
  optional section is shown unless code disables it. Omit the flag (or set `false`) and the
  section is required and cannot be disabled.
- `group` orders navigation: `Overview`, `Plan`, `Track`, `Tools`, `System`.
- Remove a section by deleting its `registerView(...)` call (and, optionally, its adapter
  export and feature module).

PM-U ships two optional sections: **Assistant** and **Diagnostics**.

---

## 4. Feature behaviour — `src/pm/*`

Each feature module owns its data access and DOM. To change how a feature behaves, edit
its module (see the table in [`README.md`](README.md#feature-modules-srcpm)); keep the
`xxxViewHTML` + `wireXxx` split so the adapter layer stays thin. Form-heavy editors should
build through `src/pm/formkit.js` rather than hand-rolling markup, so they pick up the
shared input styling and validation.

Persisted shape changes go through `src/pm/store.js` (`ENTITY_TYPES`, `SCHEMA_VERSION`)
and, if the change is breaking, through `src/pm/migrate.js` so old backups still import.

---

## 5. Theming

- Theme palettes live in `src/framework/theme.js` (`THEMES`); `defaultTheme` picks the
  starting one, and users can switch at runtime from the header or Settings.
- Branding only overrides *tokens*; it never rewrites palette files. Add a new palette
  there if you need a whole new look, and keep the `--pu-*` naming so components inherit it.
- Never hard-code hex in components — use `var(--pu-*)`.

---

## Where NOT to change things

| Don't | Why |
| --- | --- |
| Edit `src/framework/*` per generator | Divergence breaks the shared-family guarantee. Upstream it instead. |
| Put hex colours in components | Use `var(--pu-*)` tokens so themes/branding apply. |
| Read `localStorage` directly for app state | Use `app.storage` (namespaced) or the kv `Store`. |
| Duplicate input/table/toast markup | Use the `src/components/*` suite (via `formkit` in PM views). |
| Hard-code the generator name/URL | Use `window.generatorName` for share links. |
| Add a plugin import you don't use | Keep `main.pjs` imports minimal (currently `kv` + `generateText`). |
| Import a sibling member's code | Follow the reference-not-copy rule — see [`INTEGRATION-SPEC.md`](INTEGRATION-SPEC.md). |

## Sharing state

PM-U's persistent state lives in the `Store` (`ctx.app.store` in a view). For local,
view-scoped state that doesn't need persistence, use the framework's reactive store:

```js
const store = PU.createStore({ query: "", rows: [] });
store.selectSubscribe((s) => s.query, (q) => table.setQuery(q));
```

See [`API.md`](API.md) for the full framework reference.
