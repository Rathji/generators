# MS365 Integration — src/

Perchance plugin that plugs generators into Microsoft 365 (Outlook mail,
OneDrive/SharePoint files, Calendar, To Do/Planner) via the Microsoft Graph API.

Import it from another generator with `ms365 = {import:ms365-integration}`,
then either render the auth widget (`[ms365]`) or call the programmatic API on
`window.ms365`. The public page (index.html) is a live playground plus a full
usage walkthrough and "how it works" architecture section; this file is the
source-level layout reference.

## Layout

- `auth/oauth2.js` — OAuth2 authorization-code + PKCE flow against the
  Microsoft Identity Platform v2.0 endpoints, plus the token lifecycle manager
  (session persistence, single-flight auto-refresh, expiry listeners). Exports:
  `configure`, `getConfig`, `requireConfig`, PKCE helpers, `buildAuthorizeUrl`,
  `prepareAuth`, `exchangeCodeForTokens`, `refreshTokens`, `getValidToken`,
  `refreshSession`, `saveSession`/`loadSession`/`clearSession`,
  `scheduleAutoRefresh`/`stopAutoRefresh`, `onSessionChange`/`onSessionExpired`,
  `launchAuthFlow`/`registerPopupAuth`/`handleCallback`, `profileFromIdToken`,
  `buildAuthError`/`mapTokenError`, `resolveFetch`. Dependency-injectable for
  tests via `configure({ storage, fetchImpl, store, navigate, autoRefresh, ... })`.
  `buildAuthorizeUrl` honors an override `prompt` (used by the scoped-permission
  requestor's `prompt:"consent"`). Production network calls go through
  super-fetch-plugin (token endpoint is not CORS-enabled) via the
  `window.__m365.superFetch` bridge set up in index.html.
- `auth/token-store.js` — `TokenStore` class: save/load/clear a JSON session
  over injectable storage (default localStorage in the generator's own origin
  partition). Corrupt-safe loads.
- `auth/tenant-validator.js` — `validateTenant(opts)` → verdict
  `{ valid, checks, tenant, user, error }`. Three tiers:
  - JWT tier (needs only `openid`): tenant identity from the stored id_token
    profile (`tid`, `oid`/`sub`); rejects personal/consumer accounts via the
    well-known consumer tenant id `9188040d-6c67-4c5b-b112-36a304b66dad`.
  - Account tier (needs `User.Read`): `GET /me` — accountEnabled, userType
    (Member vs Guest), licenses, and that the Graph user id matches the id_token oid.
  - Deep tenant tier (needs `Organization.Read.All`, admin consent): `GET
    /organization` — verified domains + enabled plans + id_token/org id match.
    Auto-runs only when the granted scopes include `Organization.Read.All`;
    otherwise reports a soft "skipped" check. All requirements toggleable via
    opts (`requireMember`, `requireAccountEnabled`, `requireLicense`,
    `requireVerifiedDomain`, `requireTenantPlans`, `deepTenantCheck`).
- `auth/scoped-permissions.js` — Dynamic scope requestor.
  `FEATURE_SCOPES` maps feature keys (`mail`, `mailSend`, `calendar`, `files`,
  `tasks`, `tenant`) to Graph delegated scopes; `scopesForFeature` (arrays/raw
  passthrough), `missingScopes`, `hasScopes`, and `ensureScopes(feature, opts)`
  which launches incremental-consent auth (`prompt:"consent"`, `extraScopes` =
  only the missing scopes) and merges the grant into the active config. Returns
  `{granted, added, missing, aborted}` or throws.
- `graph/graph-client.js` — The generic Graph request wrapper.
  `graphRequest(method, path, opts)` → parsed JSON | text | null, plus
  `graphGet`/`graphPost`/`graphPatch`/`graphPut`/`graphDelete` and
  `getAllPages(path, opts)` (walks `@odata.nextLink`). Behavior:
  - Bearer auth via `getValidToken()` (auto-refreshed); per-call `token` override.
  - OData query params built with literal `$` keys (URLSearchParams would
    percent-encode `$`, breaking Graph) via `opts.query` (`$select`, `$filter`,
    `$top`, arrays → repeated keys).
  - 429/503/504 retried with exponential backoff + jitter (capped), honoring the
    `Retry-After` header when present; `opts.retryStatuses`, `maxRetries`,
    `baseBackoffMs`, `maxBackoffMs`, `onRetry` all tunable per call.
  - 401 → one forced token refresh (`getValidToken({force:true})`) + retry
    (disable with `allowTokenRetry:false`).
  - Empty 2xx/204 → null; non-JSON 2xx → raw text; Graph error bodies → Error
    with `{code, status, isGraphError, retryable, body, friendly, category, hint}`.
  - `opts.rawResponse:true` returns the raw Response (for downloads later).
  - Throttle stats via `getGraphStats()`/`resetGraphStats()`;
    `configureGraph()`/`resetGraphConfig()`/`getGraphSettings()`.
  Module-level `settings` is mutable across tests — always call
  `resetGraphConfig({...})` (now accepts overrides) at the top of tests.
- `graph/error-mapper.js` — Maps Graph `code`/`status` to friendly internal
  errors. `mapGraphError(err)` → `{code,status,friendly,category,hint,retryable}`;
  `toFriendlyError(err)` mutates+returns the same Error with `.friendly/.category/
  .hint/.mapped` attached (preserving `.code/.status/.body`); `formatFriendlyError`.
  Wired into graph-client: `not_authenticated`/`network_error` throws and all
  Graph HTTP errors pass through it.
- `mail/mailbox-query.js` — `searchEmails({from,to,subject,keyword,isRead,
  receivedAfter,receivedBefore,folder,top,skip})`, `listInbox`, `getMessage`,
  `resolveMailboxPath`, `normalizeMessage`. OData `$filter` builder with
  apostrophe escaping, `$orderby receivedDateTime desc`, paging via getAllPages.
  Scope: Mail.Read.
- `mail/email-dispatcher.js` — `sendEmail({to,cc,bcc,subject,body,html,
  importance,attachments,saveToSentItems,from})` → POST `/me/sendMail`;
  `createDraft`, `sendDraft`, `buildMessage`, `toAddress` (string | {address,name}
  | {emailAddress}), `encodeBase64`/`encodeContentToBase64` (chunked; Blob must be
  converted to ArrayBuffer/Uint8Array first). Scope: Mail.Send.
- `mail/calendar-sync.js` — `listUpcomingEvents({start,end,max,calendarId,
  includeAllDay,subject,...})`, `getEvent`, `createEvent({subject,start,end,
  attendees,location,body,isAllDay,onlineMeeting,calendarId,...})`,
  `buildEventBody` (all-day → date-only), `normalizeEvent`. Scopes:
  Calendars.Read / .ReadWrite.
- `files/file-discovery.js` — `resolveDrive` (me/driveId/siteId/groupId/
  sharepoint), `listFiles({drive,folder,top})`, `searchFiles({query})`,
  `getFileMeta`, `getFileByPath`, `normalizeItem`. Uses OneDrive
  `root:/path:/children` colon syntax. Scope: Files.Read / .ReadWrite.All.
- `files/file-transfer.js` — `uploadFile({name,data,mimeType,folder,drive,
  conflictBehavior,forceSimple,...})` — simple PUT ≤4MB (`SIMPLE_UPLOAD_LIMIT`),
  else chunked upload session (`DEFAULT_CHUNK_SIZE`, Content-Range bytes x-y/size);
  `downloadFile({drive,itemId,format,name})` → `{data,arrayBuffer,name,mimeType,
  size,format}` with extension preservation (`applyFormatExtension`). Scopes:
  Files.ReadWrite / Files.Read.
- `files/permission-auditor.js` — `getPermissions({drive,itemId})`,
  `checkAccess({drive,itemId,userId})` → `{access:"admin"|"write"|"read"|"none",
  canRead,canWrite,canAdmin,effectiveRoles,direct/inherited split,sharingLink}`,
  `analyzePermissions`, `describeAccess`, `normalizePermission`. Scopes:
  Sites.Read.All / Files.Read.
- `tasks/task-sync.js` — `listTaskLists`, `listTasks({listId,includeCompleted,
  importance,status,title,top})`, `getTask`, `normalizeTaskList`, `normalizeTask`.
  `$filter` composition with escaping, `$orderby createdDateTime desc`.
  Scope: Tasks.Read.
- `tasks/task-updater.js` — `updateTask({listId,taskId,complete,status,title,
  importance,dueDateTime,percentComplete,body,categories})` (PATCH), with
  `buildTaskPatch` (complete → status; dueDateTime null clears; percentComplete
  clamped 0–100) and convenience `setTaskComplete`/`setTaskDueDate`.
  Scope: Tasks.ReadWrite.
- `health/connection-check.js` — `testConnection({forceRefresh})` → pings `/me`
  (latency measured), reports `{ok,latencyMs,tokenStatus:"valid"|"refreshed"|
  "none"|"expired",scopes,user:{id,displayName,upn,mail,userType,mailboxSettings},
  error:{code,message,friendly,category}}`; `assertConnected()` throws friendly
  when unhealthy. `GET /me` 401 → graph's auto-refresh recovers automatically.
- `odata.js` — shared `escapeODataStr`, `toODataDate`, `toGraphDateTime`, `anyOf`.
- `test-helpers.js` — shared suite tooling: `assert*`, `MemoryStorage`, `mockRes`,
  `fakeIdToken`, `makeEnv({scopes,routes,tokenHandler})` (mock token endpoint +
  Graph routes keyed by pathname with `/v1.0` stripped; fn-routes for pagination),
  `makeSuite()` → `{TESTS,test,runAll}`. Always `makeEnv()` fresh per test (oauth2
  config/session is module-global); `navigate:()=>{}` is set so aborted-auth tests
  don't navigate.
- `*/**/*.test.js` — validation suites; each exports `runAll()` → results array.

## Usage

In your own generator's `main.pjs`:

```
ms365 = {import:ms365-integration}
ms365Config
  clientId = 01234567-89ab-cdef-0123-456789abcdef
  tenant = common
  scopes
    openid
    profile
    email
    offline_access
    User.Read
```

Render the widget in HTML with `[ms365]`, or configure at runtime from a script:
`root.ms365.oauth2.configure({ clientId: "...", tenant: "common" })`. The
widget's sign-in/sign-out, saved-config restore, callback handling and lifecycle
listeners are wired up by index.html's module script; it renders the auth card,
the Graph request playground and (once signed in) the tenant/connection check
buttons.

Programmatic examples (all promises):

```js
const res = await root.ms365.oauth2.launchAuthFlow();   // {status,tokens,profile} | null
const token = await root.ms365.oauth2.getValidToken();  // auto-refreshed

await root.ms365.mail.send.sendEmail({ to: "jane@corp.com", subject: "Hi", body: "..." });
const inbox = await root.ms365.mail.query.listInbox({ top: 10 });
const evt = await root.ms365.mail.calendar.createEvent({ subject: "Demo", start: new Date(), end: new Date(Date.now()+3600e3), attendees: ["jane@corp.com"] });

const files = await root.ms365.files.discover.listFiles({ top: 20 });
const up = await root.ms365.files.transfer.uploadFile({ name: "report.pdf", data: blob, conflictBehavior: "replace" });
const dl = await root.ms365.files.transfer.downloadFile({ itemId: up.id });

const lists = await root.ms365.tasks.sync.listTaskLists();
const open = await root.ms365.tasks.sync.listTasks({ listId: lists.value[0].id, includeCompleted: false });
await root.ms365.tasks.update.setTaskComplete({ listId: lists.value[0].id, taskId: open.value[0].id });

const health = await root.ms365.health.testConnection();
await root.ms365.scopedPermissions.ensureScopes("mailSend"); // on-demand incremental consent
```

Every Graph call routes through the error mapper: catch the promise and branch on
`err.code`/`err.status`, or surface `err.friendly` to the user.

## How it works

Single entry point: index.html's `<script type="module">` imports the 15 modules
under `src/` and assembles `window.ms365 = { oauth2, tokenStore, tenantValidator,
scopedPermissions, graph, errorMapper, mail:{query,send,calendar},
files:{discover,transfer,auditor}, tasks:{sync,update}, health, version }`.

- **Auth.** `oauth2.launchAuthFlow()` opens a popup at the v2.0 authorize
  endpoint with a PKCE challenge + state; the popup redirects back to the page
  URL; `handleCallback()` exchanges the code (via super-fetch, since the token
  endpoint is not CORS-enabled) and stores `{tokens, profile}` via
  `token-store`. `getValidToken()` single-flight-refreshes near expiry;
  `scheduleAutoRefresh()` keeps a timer; `onSessionChange`/`onSessionExpired`
  notify the UI.
- **Graph.** `graphRequest()` attaches the bearer token, builds OData query
  strings with literal `$` keys, retries 429/503/504 (exponential backoff,
  `Retry-After` honored), refreshes-and-retries once on 401, and pages through
  `@odata.nextLink` via `getAllPages()`. All errors normalize through
  `error-mapper` to `{code,status,category,friendly,hint,retryable}`.
- **Scopes.** `scopedPermissions.ensureScopes(feature)` compares the granted
  scopes against `FEATURE_SCOPES[feature]`; if anything is missing it re-runs
  `launchAuthFlow({extraScopes: missing, prompt:"consent"})` (incremental
  consent — the user stays signed in) and merges the grant into the config.
- **Features.** mail/files/tasks/health are thin wrappers: friendly options →
  Graph path + OData query → normalized response shape (see Layout above for
  exact per-module option/result schemas).

## Running the suites

On the generator page, each suite is a `?test=` route wired in index.html
(`TEST_SUITES`): `oauth2` (35) · `tenant` (16) · `graph` (22) · `error` (12) ·
`mailbox` (7) · `email` (9) · `calendar` (7) · `files` (10) · `file-transfer`
(9) · `file-perms` (9) · `tasks` (9) · `tasks-update` (10) · `health` (8) ·
`scoped` (5) — **168 tests total, all green**.
Programmatically: `await (await import("src/<path>.test.js")).runAll()`.

## Widget

`main.pjs` `ms365AuthWidget()` renders the auth card; `index.html` hydrates it
(sign in/out, token expiry countdown, Validate tenant verdict, **Test connection**,
Graph request playground), restores a stored session, processes the OAuth
callback, and exposes `window.ms365` (see How it works). Config bridge: a hidden
div evaluates `window.ms365InitConfig = ms365InitConfig()` at render time so the
module sees the `ms365Config` list values from main.pjs. Redirect URI is
`window.location.origin + window.location.pathname` (add it as a Single-page
application platform redirect in the Azure app registration; no client secret —
public client, PKCE).
