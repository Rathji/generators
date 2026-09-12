# Developer API Reference

Everything is available on `window.PU` (see `src/framework/pu.js`), or by importing
the module directly. `window.PU.app` exposes the live instances
(`storage`, `branding`, `theme`, `registry`, `router`, `toaster`).

```js
const { utils, dom, createStore, bus } = PU;
```

---

## `utils` — shared utility library (`framework/utils.js`)

Strings: `escapeHtml`, `titleCase`, `slugify`, `truncate(value, len, suffix)`,
`pluralize(count, singular, plural)`.
Numbers: `clamp`, `formatNumber`, `formatCurrency(value, currency, opts)`,
`formatPercent`, `formatBytes`.
Dates: `formatDate`, `formatDateTime`, `formatRelativeTime(value, now?)`, `nowIso`.
Functions: `debounce(fn, ms)`, `throttle(fn, ms)`.
Objects: `isPlainObject`, `deepClone`, `deepMerge`, `pick`, `omit`, `uid(prefix)`, `cx(...)`.
Collections: `groupBy`, `sortBy(items, keyFn, dir)`, `unique`, `sum`, `average`, `range`.
URL/raster: `parseQuery`, `buildQuery`, `initials`, `colorFromString`.

```js
utils.formatCurrency(1250);            // "$1,250.00"
utils.sortBy(rows, (r) => r.amount, "desc");
```

## `dom` — element helpers (`framework/dom.js`)

```js
h("div", { class: "card", onclick: fn, dataset: { id: 1 } }, child, "text")
svgIcon("settings", { size: 18 })
qs(sel, root?) · qsa(sel, root?) · on(el, ev, fn) · clear(el) · mount(el, ...children)
```
`h()` never interprets strings as HTML — pass trusted markup via `{ html }`.
`ICONS` holds the icon set used across the framework.

## `bus` — event bus (`framework/bus.js`)

```js
bus.on(topic, handler) → off          bus.once(topic, handler)
bus.off(topic, handler)               bus.emit(topic, payload, meta?)
bus.listenerCount(topic?)             bus.clear(topic?) · bus.pause()/resume()
```
`"*"` receives every event. A throwing handler is isolated (logged, others run).
`createBus()` returns an independent instance.

## `createStore(initial, { name, onChange })` (`framework/store.js`)

```js
const store = createStore({ count: 0 });
store.get() · store.select(fn)
store.set(patchOrFn) · store.patch(deepPartial) · store.replace(next) · store.reset()
store.subscribe(s => …) → off
store.selectSubscribe(s => s.count, (next, prev) => …) → off
```
Also `withPersistence(store, storage, key)` — loads on creation and saves on every
change.

## `createStorage({ namespace, backend })` (`framework/storage.js`)

```js
storage.get(key, fallback?) · storage.set(key, value) · storage.remove(key)
storage.has(key) · storage.keys() · storage.clear() · storage.subscribe(fn) → off
storage.isPersistent   // false when running on the in-memory fallback
```
Keys are stored as `` `${namespace}:${key}` `` as JSON. Blocked storage degrades to
memory with a console warning instead of throwing.

## `theme` (`framework/theme.js`)

```js
THEMES · LIGHT_BASE · DARK_BASE · DEFAULT_THEME   // DEFAULT_THEME === "navy"
themeList() · resolveTheme(id, extraTokens?) → { themeId, mode, label, tokens }
createTheme({ storage, defaultTheme, extraTokens, target })
  .get() → { themeId, label, mode, description, preferred }
  .set(id) · .setMode("light"|"dark") · .toggleMode() · .reset()
  .apply() · .resolved() · .tokens · .list() · .subscribe(fn, { immediate })
bootScript(storageKey?) → the inline pre-paint script
```
`extraTokens` is how branding feeds colour overrides into the resolver.

## `branding` (`framework/branding.js`)

```js
createBranding(overrides, { config }) → {
  get(), tokens(), update(partial), applyTo(doc?), defaults
}
mix(a, b, weight) · luminance(hex) · contrastText(hex)   // colour helpers
```
`tokens()` returns `--pu-primary*` / `--pu-accent*` / `--pu-font-sans` overrides.
Invalid hex values are ignored (never applied).

## `createRouter({ routes, defaultRoute, notFound })` (`framework/router.js`)

```js
router.start(outletEl) · router.stop() · router.render()
router.navigate(path, { query, replace }) · router.href(path, query?)
router.parse(hash) → { path, query, raw } · router.resolve()
router.add(route) · router.setRoutes(routes) · router.routes · router.current
router.subscribe((ctx, result) => …) → off
```
Routes are `{ path, render(outlet, ctx) }`. Hash format: `#/section?param=value`.

## `createRegistry({ storage, onChange })` (`framework/registry.js`)

```js
registry.register({ id, label, icon, group, order, optional, description, render })
registry.list({ enabledOnly? }) · registry.get(id)
registry.isEnabled(id) · registry.setEnabled(id, bool) · registry.toggle(id)
registry.enabledRoutes() · registry.subscribe(fn) → off · registry.reset()
```
Required components (`optional: false`) refuse to be disabled.

## `meta` (`framework/meta.js`)

`TEMPLATE_META` · `describe()` · `dependencyReport(root)` · `compareVersions(a, b)`.

## Components

### Inputs (`components/inputs.js`)
`textField`, `textareaField`, `selectField`, `toggleField`, `checkboxField`,
`radioField`, `button`. Each field returns:

```js
{ el, input, value (get/set), setError(msg), clearError(), setDisabled(bool), focus() }
```

```js
const email = textField({ name: "email", label: "Email", type: "email", required: true });
form.appendChild(email.el);
email.value = "a@b.co";
```

### Toaster (`components/toast.js`)
```js
createToaster({ container, duration, max })
  .show(msg, { type, title, duration, action, dismissible })
  .success/.error/.warning/.info(msg, opts?) · .dismiss(id) · .clear() · .count
```
Pausing on hover; errors/warnings use `role="alert"`.

### Data table (`components/datatable.js`)
```js
createDataTable({ columns, rows, pageSize, searchable, sortable, emptyMessage,
                  caption, title, onRowClick, getRowId })
  → { el, state, setRows(rows), getRows(), setQuery(q), sort(key, dir), refresh() }
```
Columns: `{ key, label, align, width, sortable, sortValue(row), format(value, row),
hideOnMobile, cellClass }`. Reflows to labelled cards below 640 px.

---

## Runtime (`window.PU.app`)

```js
app.config      // read from main.pjs
app.storage · app.branding · app.theme · app.registry · app.router · app.toaster
app.navigate(section) · app.renderNav() · app.views
```

## Patterns

**Cross-component communication**
```js
bus.on("invoice:saved", ({ id }) => toaster.success(`Invoice ${id} saved`));
bus.emit("invoice:saved", { id: "INV-1004" });
```

**Reactive UI from a store**
```js
store.selectSubscribe((s) => s.filter, (filter) => table.setQuery(filter));
```

**Themed markup** — always use tokens, never hex:
```html
<div style="background: var(--pu-primary-soft); color: var(--pu-primary);">…</div>
```
