# Clone / Instantiate Guide

How to spin up a **new Project U member** starting from PM-U. The same steps work for
starting a fresh project from PM-U directly.

---

## Option A — fork in the Perchance editor (recommended)

1. Open `https://perchance.org/pm-u`.
2. Click **save** (fork). The platform creates a randomly-named copy you own.
3. Open **Settings → rename** and give it its final name (e.g. `acme-invoices`)
   **before** storing any data. Renaming changes the iframe origin, so existing
   `localStorage` / `kv-plugin` data is not carried over. If you only want the data,
   export it first (see *Moving data* below) and re-import after the rename.
4. Work through the checklist below.

## Option B — copy the source

1. Download `main.pjs` and `index.html`.
2. Create a new generator and paste them in.
3. Recreate the `src/` tree (files panel → upload the `src/` folder).

---

## Customization checklist

- [ ] **`main.pjs` → `$meta`** — `title`, `description`, `tags`, `image`: describe the
      *new* generator, not PM-U.
- [ ] **`main.pjs` → `pu`** — `appTitle`, `appShortTitle`, `tagline`, `companyName`,
      `version`, `logoMark`, `footer`.
- [ ] **`main.pjs` → `pu.storageNamespace`** — change it (e.g. `acme-invoices`). This is
      the prefix for every `localStorage` key and must be unique per member.
- [ ] **`index.html` boot script** — update the storage key to
      `<storageNamespace>:theme:v1`.
- [ ] **`main.pjs` → `pu.branding`** — `primary`, `accent`, `fontSans` (and optional
      `logoUrl`).
- [ ] **`index.html`** — swap the Google Fonts `<link>` if `fontSans` changed. Keep the
      theme pre-paint script (update its key too).
- [ ] **`src/app.js`** — delete the `registerView(...)` calls for sections you don't want
      and add your own (see *Adding a section*).
- [ ] **`src/views.js`** — delete/replace the adapters for removed/new sections.
- [ ] **`src/pm/*`** — remove feature modules you no longer use, and their imports in
      `src/views.js` / `src/app.js`.
- [ ] **`src/styles.css` / `src/views.css`** — trim view styles you no longer need.
- [ ] **`main.pjs` plugins** — keep `kv` if you persist anything; keep `generateText`
      only if you use the Assistant / weekly report. Remove the other.
- [ ] **`src/pm/tests.js`** — prune suites for deleted features; add tests for your logic.
- [ ] **`src/README.md`** — rewrite the purpose/architecture sections for the new member.
- [ ] **`src/member.json`** — update the id/title/url/entities descriptor (see
      [`INTEGRATION-SPEC.md`](INTEGRATION-SPEC.md)).
- [ ] Run **Tests** (Diagnostics) and confirm green; check phone + desktop widths.

## Adding a section

1. Write the feature module (e.g. `src/pm/invoices.js`) exporting
   `invoicesViewHTML(store, ctx)` + `wireInvoicesView(store, ctx)`.
2. Add an adapter in `src/views.js`:
   `export const invoices = { render(outlet, ctx) { outlet.innerHTML = invoicesViewHTML(ctx.app.store, ctx); wireInvoicesView(ctx.app.store, ctx); } };`
3. Register it in `src/app.js` with `registerView("invoices", { label, icon, group, order, optional }, views.invoices)`.
4. Add a test suite and register it in `runAllTests()` (see [`CUSTOMIZATION.md`](CUSTOMIZATION.md)).

No router edits are needed — routes derive from the registry.

## Removing the AI features

PM-U's only two AI surfaces are the **Assistant** section and the **weekly report** on the
Dashboard. To strip them: remove `generateText = {import:ai-text-plugin}` from `main.pjs`,
delete `src/pm/assistant.js` and `src/pm/report.js`, remove the `assistant` `registerView`
and the Dashboard report button, and drop their suites. Everything else works offline.

---

## Moving data

The store has a schema version (`SCHEMA_VERSION`, currently **2**). When cloning:

- **Same member, new name:** export a JSON backup from the Dashboard, rename, then import
  it. Data does not survive a rename on its own (different origin).
- **From `project-master`:** use the **Migrate from Project Master** button (Dashboard or
  Settings). It upgrades a v1 backup to v2, repairs references and previews the change.
- **To a structurally different member:** change `ENTITY_TYPES` in `src/pm/store.js` and
  extend `src/pm/migrate.js` so old envelopes still import.

---

## Keeping the family consistent

- Keep the `pu-` CSS prefix and the `--pu-*` tokens.
- Keep the shell structure (header / sidebar / `#puMain`) so users feel at home.
- Keep `window.pm` as the app/instance namespace and `window.PU` as the framework API.
- Don't fork `src/framework/*` or `src/components/*`; upstream generic improvements to
  Template-U instead so every member benefits.
- Follow the reference-not-copy rule for cross-member links
  ([`INTEGRATION-SPEC.md`](INTEGRATION-SPEC.md)).
- Publish a member descriptor so the hub can list and launch you.

## Naming

- Generator slug: lowercase, hyphenated, no spaces (`acme-invoices`).
- Display title: the `pu.appTitle` value; keep the `-u` suffix for family members.
- Keep `storageNamespace` stable once users have data — renaming the generator or the
  namespace orphans saved data.
