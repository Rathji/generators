# MS365 Integration — source layout

Perchance plugin that plugs generators into Microsoft 365 (Outlook mail,
OneDrive/SharePoint files, Calendar, To Do/Planner) via the Microsoft Graph API.

**The whole implementation lives in `main.pjs`.** A Perchance `{import:x}`
pulls in *only* x's `main.pjs` — never x's `index.html`, never x's `src/` files.
So the API is assembled once in main.pjs and returned from `$output`; importing
this generator gives the importer the full API as `root.ms365`:

```
ms365 = {import:ms365-integration}

await root.ms365.configure({ clientId, tenant, relay: true });
await root.ms365.auth.handleCallback();       // no-op unless this load has ?code
const me = await root.ms365.graph.graphGet("/me");
```

No widget, no extra `<script>` tags, no plugin HTML, no `window.ms365`.

- `index.html` is the standalone **playground** (live demo + these docs) and the
  `?test=` runner. Nothing in it is required by an importer.
- Every file under `src/` is either the playground's own wiring, a **thin shim**
  onto the same main.pjs functions, or a validation suite.

## main.pjs layout

Single file, Perchance-js functions (`name(args) => { … }`), numbered sections:

| § | Section | Contents |
|---|---------|----------|
| 0 | imports | `superFetch = {import:super-fetch-plugin}` — the default transport |
| 1 | config | `ms365InitConfig()` defaults list; version; `ms365Internal()` (the one lazily-created `window.__ms365Internal` store) and `ms365FreshInternal()` |
| 2 | internal state | config, session, listeners, popups, refresh-in-flight promise, graph settings/stats |
| 3 | utilities | `ms365IsThenable`, default/injectable storage adapters, key namespacing |
| 4 | storage keys | `ms365StorageKeys()` (`…::<clientId>|<tenant>`) |
| 5 | token store | `ms365TokenStoreClass()` → `TokenStore` (save/load/clear session) |
| 6 | OAuth2 + PKCE + relay | PKCE helpers, `buildAuthorizeUrl`, `prepareAuth`, token exchange/refresh, single-flight `getValidToken`, auto-refresh, `launchAuthFlow`/`registerPopupAuth`/`handleCallback`, `ms365RelayToOpener` |
| 7 | error mapper | Graph code/status → `{code,status,friendly,category,hint,retryable}` |
| 8 | OData | `escapeODataStr`, `toODataDate`, `toGraphDateTime`, `anyOf` |
| 9 | Graph wrapper | `graphRequest` + verbs, retries/backoff/`Retry-After`, 401 refresh-and-retry, `getAllPages`, stats/settings |
| 10 | tenant validator | JWT / account / deep-tenant tiers |
| 11 | scoped permissions | feature → scopes map, `ensureScopes` incremental consent |
| 12 | mail | mailbox queries, `sendEmail`/drafts, calendar events |
| 13 | files | drive resolution, list/search/get, upload (simple + chunked), download, permission audit |
| 14 | tasks | To Do lists/tasks read + update |
| 15 | health | `testConnection` / `assertConnected` |
| 16 | widget | `ms365Widget()` HTML string (`ms365AuthWidget()` is a back-compat alias) |
| 17 | reset | `ms365Reset()` — clears config/session/pending/timers/popups |
| 18 | introspection | `ms365Capabilities()` |
| 19 | namespaces | the `root.ms365` shape (`graph`, `mail`, …) + `ms365ConfigureGuard()` |
| 20 | public API + `$output` | `ms365WrapBind` (keeps `.bind()` returning a wrapped fn), `getMs365Api()`, `$output = [getMs365Api()]` |

The API object is **callable** (it returns the widget HTML, so `[ms365]` renders
the auth card) and carries every namespace as a property.

## src/ files

- `runtime.js` — `ms365Api()`: lazy accessor returning `root.getMs365Api()`
  (falls back to `window.root` for module scripts). Everything under `src/`
  goes through it so the suites test the shipped code.
- `auth/oauth2.js`, `auth/token-store.js`, `auth/tenant-validator.js`,
  `auth/scoped-permissions.js`, `graph/graph-client.js`, `graph/error-mapper.js`,
  `odata.js`, `mail/{mailbox-query,email-dispatcher,calendar-sync}.js`,
  `files/{file-discovery,file-transfer,permission-auditor}.js`,
  `tasks/{task-sync,task-updater}.js`, `health/connection-check.js` — **thin
  shims**: each re-exports the matching namespace of `ms365Api()`, keeping the
  original export names (and `FEATURE_SCOPES`/`SIMPLE_UPLOAD_LIMIT`-style consts
  as `featureScopes()`/`simpleUploadLimit()` accessors). No logic here.
- `test-helpers.js` — `assert*`, `MemoryStorage`, `mockRes`, `fakeIdToken`,
  `makeEnv({scopes,routes,tokenHandler})`, `makeSuite()`.
- `*/**/*.test.js` — validation suites, each exporting `runAll()`.
- `consumer-contract.test.js` — **the import contract suite** (see below).

## How it works

- **Auth.** `auth.launchAuthFlow()` opens a popup at the Microsoft Identity
  Platform v2.0 authorize endpoint with a PKCE challenge + state;
  `handleCallback()` (safe on every load) exchanges the code and commits the
  session. The token endpoint is not CORS-enabled, so exchange/refresh go
  through `super-fetch-plugin` (default; override with `fetchImpl`).
- **Token lifecycle.** Tokens live in storage (default: this origin's
  `localStorage`). `getValidToken()` single-flight-refreshes near expiry;
  `scheduleAutoRefresh()` keeps a timer; `onSessionChange`/`onSessionExpired`
  notify the UI.
- **Injectable, async-capable storage.** Pass `storage` to `configure()` with
  `getItem`/`setItem`/`removeItem` (may return promises — awaited if thenable) to
  back tokens with kv-plugin/IndexedDB. Keys are namespaced per connection
  (`ms365.oauth2.session::<clientId>|<tenant>`), so configs don't collide.
- **Graph.** `graphRequest()` attaches the bearer token, builds OData queries
  with literal `$` keys, retries 429/503/504 with backoff (`Retry-After`
  honored), refreshes-and-retries once on 401, pages via `getAllPages()`, and
  normalizes every error through the error mapper.
- **Scopes.** `scopedPermissions.ensureScopes(feature)` re-runs auth with
  `prompt:"consent"` asking only for the missing scopes, then merges the grant.
- **Relay mode.** Set `relay: true` (or a generator name / https URL) in the
  config. The Azure redirect URI then points at *this plugin's own page*
  (`https://perchance.org/ms365-integration`, default). That page loads with
  `?code=…&state=…&__ms365_relay=1`, `handleCallback()` sees the relay marker and
  `postMessage`s `{type:"ms365:auth", code, state}` to `window.opener`, then
  closes. `launchAuthFlow()` accepts that message as well as the same-origin
  popup message, so every importer/fork can share **one** registered redirect
  URI instead of registering each `<publicId>.perchance.org/<name>` origin.

## Azure app registration

Public client, **PKCE only, no client secret anywhere** (this code is public).

- Authentication → Platform configurations → **Single-page application**:
  `https://perchance.org/ms365-integration` (the relay redirect; shared by all
  importers). Optionally also add a Web-platform redirect for per-generator
  return URIs.
- API permissions: `User.Read` plus the features you use — `Mail.ReadWrite`,
  `Calendars.ReadWrite`, `Files.ReadWrite.All`, `Tasks.ReadWrite`; deep tenant
  validation needs `Organization.Read.All` (admin consent).
- Native/mobile-style public clients may need the `http://localhost` redirect.

## Running the suites

`?test=<name>` on the generator page (`TEST_SUITES` in index.html), or
programmatically `await (await import("src/<path>.test.js")).runAll()`:

`oauth2` (35) · `tenant` (16) · `graph` (22) · `error` (12) · `mailbox` (7) ·
`email` (9) · `calendar` (7) · `files` (10) · `file-transfer` (9) ·
`file-perms` (9) · `tasks` (9) · `tasks-update` (10) · `health` (8) ·
`scoped` (5) · `consumer` (10) — **178 tests, all green**.

`consumer-contract.test.js` proves the whole API works the way an importer uses
it: headless, no DOM, injected fetch + injected **async** storage, and no
`window.__m365`. It asserts construction is side-effect-free (no fetch, no
popup, no DOM/window writes), `configure()` round-trips/merges, a generic Graph
call works through injected storage with namespaced keys, a 401 triggers
refresh-and-retry with persisted rotation, errors carry the friendly fields,
`reset()` clears, `$output` is the API object (not a string), relay mode points
`redirect_uri` at the plugin's page, the relay page forwards `{code,state}` to
its opener, and `launchAuthFlow()` accepts that cross-origin relay message and
closes the popup.

## Widget

`ms365Widget()` renders the auth card markup; the playground's module script
hydrates it (sign in/out, expiry countdown, Validate tenant, Test connection,
Graph request playground), restores a stored session, and calls
`handleCallback()`. The redirect URI shown in the widget is
`window.location.origin + window.location.pathname` unless a `relay`/`redirectUri`
config says otherwise.

## Theme (project-u)

`index.html` is re-skinned to the shared **project-u** visual theme. It is a
pure re-skin — no behaviour, ids, scripts or text content changed.

- **Tokens.** Light values live in `:root`; the dark set is duplicated in both
  `@media (prefers-color-scheme: dark) { :root:not([data-theme]) { … } }` and
  `:root[data-theme="dark"] { … }`, so the OS preference and the manual toggle
  both work. Accent `#2f6feb` (light) / `#6ea8ff` (dark). `--ok`/`--bad`/`--warn`
  are extra semantic status colours the suite runner and widget use
  (`status.style.color = "var(--ok)"`) — keep them defined.
- **Chrome.** Sticky 66px `.site-header` (`.brand-mark` + `#brandName`, set at
  runtime from `window.generatorName`), a `.hero` (`.eyebrow` + `h1` + `.lead`),
  `.codeblock`/`.codebar` cards around every `<pre>`, and a `.site-footer`.
- **Theme toggle.** A small classic `<script>` before the playground module
  script cycles Auto → Light → Dark → Auto, persists the choice in
  `localStorage["projectUTheme"]`, and **removes** the `data-theme` attribute for
  `auto` (setting it to `""` would still match `[data-theme]` and break the auto
  media query).
- **Widget.** `ms365Widget()` (main.pjs §16) emits class-only markup
  (`.ms365-*`); all of its styling lives in index.html, so re-theming it never
  requires touching main.pjs.

## Notes for future agents

- **Perchance `{import:x}` imports main.pjs only.** Never move implementation
  back into `src/` modules — importers would get a dead API. Keep `src/` shims
  thin, and keep `$output = [getMs365Api()]` returning the API object.
- **Template literals in pjs function bodies break the pjs parser** (backticks
  with `${…}` inside a `name() =>` body produce a parse error). Build strings as
  `[ 'a', 'b' ].join("\n")` arrays of single-quoted lines — that's how
  `ms365Widget()` is written.
- **`{import:…}` literal text in a comment is treated as a real import** by the
  engine, so don't write that token in prose/comments.
- `root` is a page global; individual pjs list/function names are not on
  `window` (they're only bare identifiers inside inline classic `<script>` tags).
- Async rejections from pjs functions are not reported by the engine's error
  logger, but **sync throws are** (attributed to a bogus "lists editor" line) —
  hence the plain-JS `ms365ConfigureGuard()` so deliberate validation errors
  don't spam the console.
- The editor **auto-saves**: any edit is immediately the saved copy, so avoid
  destructive rewrites.
