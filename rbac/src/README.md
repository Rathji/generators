# rbac — role-based access control for Perchance apps

A Perchance plugin (this generator) that gives apps roles + permissions with two
security layers, structured following Rathji's plugin template conventions
(box-drawing banner, sections 0–4, thin never-throwing `$output`).

- **Pure engine** (client-side, offline) — roles, wildcard permission patterns,
  deny-overrides, role inheritance, bans, and **resource scoping** (ownership +
  sharing). For UI gating / single-player apps. Deny-overrides are
  **order-independent**: a deny in any role — including one reached only via
  inheritance — beats a grant anywhere else in the role set (a grant never
  shadows an inherited deny).
- **Authoritative server** (server-plugin) — durable user/role state in the 50MiB
  `state` store, admin auth (identity OR rate-limited password handshake), a
  full admin RPC surface, and a **persisted audit log** of every admin mutation.
  This is the real security layer; client checks are cosmetic.

The generator's own page is the docs + live demo (log in as `carol`/`bob`/`admin`,
try actions, grant roles, watch the server deny what the UI let through).
Demo admin password: `demo-admin-pw` (hash-only in the demo server script; the
plaintext exists only so the demo page can show it — never ship a plaintext
password in production).

## Quickstart

```pjs
// main.pjs (top of lists editor)
rbac = {import:rbac-plugin}
```

```js
// index.html — client
const engine = root.rbac("engine");                    // offline engine
engine.defineRole("editor", { perms: ["doc.edit", "doc.publish"], inherits: ["viewer"] });
engine.grant("bob", "editor");
engine.can("bob", "doc.edit");                         // true

// Resource scoping: a resource is just { owner, sharedWith } — your app knows
// who owns what. can() also checks "own."+perm and "share."+perm.
const doc = { owner: "carol", sharedWith: ["bob"] };
engine.can("carol", "doc.edit", doc);                  // true — she owns it
engine.can("bob", "doc.edit", doc);                    // true — shared with him
engine.isOwner("carol", doc);                          // true

const client = root.rbacServerCreate();                // or root.rbac("server")
await client.opened;
const res = await client.login("bob");                 // YOUR auth, then server binds identity
await client.rpc("doc.edit", { id, body });            // server re-checks authoritatively
await client.adminAudit();                             // last 200 admin ops (admin)
```

```html
<!-- index.html — paste root.rbac("serverScript") into a text/x-server-plugin
     block, set RBAC_ADMIN_USERS / RBAC_ADMIN_PASSWORD_SHA256 at its top, then
     gate your own handlers: rbacRequire(conn, "doc.edit"); -->
```

`$output` actions: `"engine"` (aliases `"createEngine"`, `"create"`),
`"can"` (`{perms, permission}`), `"match"` (`{pattern, permission}`),
`"owns"` / `"shared"` (`{user, resource}`), `"selfTest"` (offline engine
self-test → `{ok, total, passed, failed, results}`),
`"server"` (`"client"`, `"createServer"`; opts `socketFactory`),
`"serverScript"` (`"getServerScript"`, `"script"`),
`"demoServerScript"` (`"demoScript"`). All shapes work: action string,
action+opts, or `{action: ...}` object. Bad input returns a `(rbac: …)`
placeholder — never throws.

## How it works

### Permission matching

Permissions are dot-separated strings (`doc.edit`, `admin.users.ban`); roles
grant **patterns**. Matching walks both strings segment by segment:

| pattern | grants |
| --- | --- |
| `*` | everything |
| `doc.*` | `doc`, `doc.read`, `doc.a.b`, … |
| `doc.edit` | exactly `doc.edit` — never a sibling or a deeper permission |
| `doc.edit.*` | `doc.edit` and anything below it |

A pattern never grants outside its own branch, and an exact pattern never
grants deeper or sibling permissions.

### Grants, denies and the deny-overrides rule

A role is `{ perms, denies, inherits }`. A request for permission `p` is
allowed **iff** the user's *whole* role set (direct + every inherited role,
transitively) contains a grant that matches `p` **and** contains no deny that
matches `p`.

Deny-overrides is **order-independent**: `grantCheck` accumulates any grant
while still walking the entire closure for denies (it only stops early once a
deny is found, because the outcome is then fixed). So a deny reached through an
inherited role or a sibling role always beats a grant anywhere in the set — a
grant can never shadow a deny, no matter which role or line declared it.

### Role inheritance

Roles inherit other roles transitively. `rolesOf(user)` returns the full
closure, `hasRole` sees inherited roles, and `effectivePermissions(user)` is
the union of every granted pattern. Cycles (A inherits B inherits A) are
handled with a visited set, so a self- or mutually-referential graph can never
hang a check.

### Bans

A banned user is denied everything — a ban overrides even a `*` grant. Bans are
enforced at **every boundary**:

1. the permission layer — `can()` returns `false`;
2. login — your handler should reject them (the demo does: "account banned");
3. live sessions — `rbac.banUser` revokes them via `rbacKickUser`, which unbinds
   and closes each bound connection with code `4001`, reason `"banned"`.

Bans persist in `state` with everything else.

### Resource scoping

A resource is `{ owner, sharedWith }`. `can(user, perm, resource)` runs up to
**three** deny-aware checks and allows if any passes:

- the plain permission (global grant),
- `"own."+perm` — only when `resource.owner === user`,
- `"share."+perm` — only when `resource.sharedWith` includes the user.

Each dimension is a full grant+deny check. `isOwner` / `isShared` report the
two dimensions. So grant `own.doc.*` to a baseline role ("members manage their
own docs") and `share.doc.edit` to editors, and ownership/sharing work with no
per-document ACL bookkeeping.

### The server layer

The authoritative server runs inside a server-plugin socket. At boot it rebuilds
its in-memory model from a **versioned binary layout** stored in the durable
`state` Uint8Array (roles, user→role assignments, bans, and a ring of the last
200 audit entries). Corrupt or unknown-version state is discarded and rebuilt
deny-by-default rather than crashing. Key mechanics:

- **Identity binding** — `rbacBindIdentity(conn, userId)` is called **only**
  from your own authenticated `login` handler (it is deliberately not an RPC).
  `rbacAllow` / `rbacRequire` gate your handlers, optionally with `{resource}`
  for scoped checks.
- **Admin gate** — a connection is admin if it is bound to a userId in
  `RBAC_ADMIN_USERS`, or if it completed the rate-limited (10/min/IP) password
  handshake against `RBAC_ADMIN_PASSWORD_SHA256`. The script is public source,
  so only the SHA-256 **hash** of the admin password may live in it.
- **Mutations** — every admin mutation bumps a revision counter, persists to
  `state`, notifies subscribers on the `rbac:changed` pubsub channel, and is
  written to the audit ring (`client.adminAudit()` reads it).
- **Bans are live** — `rbac.banUser` kicks the user's current sessions on the
  spot (see Bans above).

## Usage

### Engine: UI gating / single-player

```js
const engine = root.rbac("engine");            // or root.rbacCreateEngine()

// 1. Define roles: grants + denies + inherited roles.
engine.defineRole("viewer",    { perms: ["doc.read", "own.doc.*"] });
engine.defineRole("editor",    { perms: ["doc.edit", "doc.publish", "share.doc.edit"], inherits: ["viewer"] });
engine.defineRole("moderator", { perms: ["doc.delete", "share.doc.delete"], inherits: ["editor"] });
engine.defineRole("guest",     { inherits: ["viewer"], denies: ["doc.create"] }); // deny beats viewer's grant

// 2. Assign roles (grant / revoke / setUserRoles / removeUser).
engine.grant("carol", "viewer");
engine.grant("bob", "editor");

// 3. Check — global, then resource-scoped.
engine.can("bob", "doc.edit");                  // true  — global grant
const doc = { owner: "carol", sharedWith: ["bob"] };
engine.can("carol", "doc.edit", doc);           // true  — own.doc.*
engine.can("bob",   "doc.edit", doc);           // true  — share.doc.edit
engine.can("mallory", "doc.edit", doc);         // false
engine.can("guest", "doc.create");              // false — deny wins over viewer's grant

// 4. Bans + persistence.
engine.ban("mallory");  engine.isBanned("mallory");             // true
const snap = engine.serialize(); const eng2 = root.rbac("engine"); eng2.load(snap);
```

### Server: authoritative enforcement

Paste `rbac("serverScript")` into a `<script type="text/x-server-plugin">`
block, set the two `RBAC_ADMIN_*` constants, then add your own handlers and
gate them:

```js
// ---- your config (edit these at the top of the core) ----
RBAC_ADMIN_USERS = ["yourname"];                              // trusted account(s)
RBAC_ADMIN_PASSWORD_SHA256 = "<sha256-of-a-high-entropy-password>";

rbacInit();                                                   // load state, rebuild the model
rbacDb.defineRole("editor", { perms: ["doc.edit"], inherits: ["viewer"] }); // or define live via admin RPCs

// YOUR authenticated login — the ONLY place identity is bound:
"login": (ctx, data) => {
  const userId = /* … from your credential check … */;
  if (rbacDb.isBanned(userId)) throw new Error("account banned");
  rbacBindIdentity(ctx.conn, userId);
  return JSON.stringify({ ok: true });
},

// YOUR gated handlers — global and resource-scoped:
"doc.edit": (ctx, data) => {
  const doc = /* … resolve the target document … */;
  rbacRequire(ctx.conn, "doc.edit", { resource: { owner: doc.owner, sharedWith: doc.sharedWith } });
  /* do the work */
},

self.rpc = Object.assign({}, rbacRpc, { login, logout, "doc.edit": /* … */ });
self.onclose = ({conn}) => rbacForgetConn(conn);
```

### Client helper

```js
const client = root.rbac("server");            // or root.rbacServerCreate()
await client.opened;
const res = await client.login("bob");         // YOUR auth, then the server binds identity
res.user;                                      // { userId, roles, permissions, banned }
await client.can("doc.edit");                  // server-authoritative boolean
await client.amAdmin();                        // is this connection admin?
await client.adminAuth("s3cret");              // admin password handshake (rate-limited)
await client.grantRole("carol", "moderator");  // admin
await client.banUser("mallory", true);         // admin — kicks live sessions (4001 "banned")
await client.adminSnapshot();                  // admin — roles + users + revision + audit
await client.adminAudit();                     // admin — last 200 admin operations
```

### Admin operations

Admin = a connection bound to an `RBAC_ADMIN_USERS` account, **or** one that
completed the password handshake (`client.adminAuth`, rate-limited 10/min/IP).
Everything admin is a `client.*` call: `defineRole` / `deleteRole`,
`grantRole` / `revokeRole` / `setUserRoles`, `banUser` / `forgetUser`,
`canAs(user, perm, resource?)` (check another user, optionally scoped), and the
read-only `adminSnapshot` / `adminAudit`. The live demo page has a working admin
console you can exercise (log in as `admin`).

### Common patterns

- **Baseline `own.*` role** — give every member `own.doc.*`; they can then
  manage resources they own (`own.doc.edit`, `own.doc.delete`, …) with no
  per-document bookkeeping.
- **Editors share** — give the editor role `share.doc.edit`; its holders can
  edit any document explicitly shared with them.
- **Deny a capability globally** — a `denies` entry always wins. Grant `*` but
  `denies: ["admin.*"]` and the role can do everything except admin.
- **Admin by identity vs password** — `RBAC_ADMIN_USERS` is zero-setup (trusted
  account names); the password handshake promotes a session without a special
  account and is rate-limited.
- **Deny by default** — a user with no roles is allowed nothing. `can()` without
  a resource is the plain global check.

## Files

- `src/rbac-engine.js` — pure engine. `__rbacMatchPermission(pattern, permission)`
  and `__rbacEngine()` are extracted by name and embedded into main.pjs (and into
  the server core). **Keep those two function names stable.**
- `src/rbac-server-core.js` — authoritative server core: binary state layout over
  `state`, `rbacInit` / `rbacBindIdentity` / `rbacUnbind` / `rbacIdentityOf` /
  `rbacAllow` / `rbacRequire` (both take an optional `opts.resource` =
  `{owner, sharedWith}` for scoped checks) / admin gate (`rbacIsAdmin`,
  `rbacRequireAdmin`, rate-limited `rbacAuthenticateAdmin`) / `rbacBump` /
  `rbacAuditAdd` (persisted audit ring, last 200) / `rbacRpc` (the `rbac.*`
  RPC object: ping, me, can, hasRole, rolesOf, amAdmin, authenticateAdmin,
  adminLogout, adminSnapshot [+audit], adminAudit, canAs (optional `resource`
  `{owner, sharedWith}` for scoped checks), defineRole,
  deleteRole, grantRole, revokeRole, setUserRoles, banUser, forgetUser). Merge
  with your app's RPCs: `self.rpc = Object.assign({}, rbacRpc, {...})`.
- `src/rbac-demo-server.js` — demo app extension: **idempotently** bootstraps
  roles viewer (doc.read/doc.create/own.doc.*) / editor (+doc.edit/doc.publish/
  share.doc.edit/share.doc.publish) / moderator (+doc.delete/share.doc.delete) /
  owner (all) / guest (inherits viewer, **denies doc.create** — a live
  deny-overrides demo) and users admin→owner, bob→editor, carol→viewer,
  mallory→viewer, guest→guest (bootstrap runs on every start and only adds
  missing roles / baseline grants, so existing state upgrades without clobbering
  admin's tweaks); presence pubsub; a document store with per-doc **ownership +
  sharing**
  (`doc.create` / `doc.list` / `doc.read` / `doc.edit` / `doc.publish` /
  `doc.delete` / `doc.share` / `doc.unshare`, all resource-scoped);
  `login`/`logout`/`demo.*` (incl. admin-gated `demo.adminDocs` — the document
  inventory shown in the admin console — and non-mutating `demo.selftest`,
  the authoritative server self-check shown on the page's Self-test card). Sets `RBAC_ADMIN_PASSWORD_SHA256 = "__DEMO_HASH__"`
  (replaced at build time).
- `src/rbac-templates/main.pjs` + `index.html` — hand-written plugin API + docs/
  demo page with `@@RBAC_*@@` markers.
- `src/rbac-build.mjs` — regenerates `main.pjs` + `index.html` from the above.
  Run via execute_js:
  ```js
  const src = await fs.readTextFile("src/rbac-build.mjs");
  await (0, eval)(src);        // defines build()
  await build();               // writes main.pjs + index.html
  ```

## Security model

- Deny by default: users with no roles are allowed nothing.
- **Ban lifecycle (enforced at every boundary):** a banned user is denied at the
  permission layer (`rbacDb.can` returns false — bans override even a `*`
  grant), your login handler should reject them (the demo does: "account
  banned"), and `rbac.banUser` actively revokes their live sessions via
  `rbacKickUser` — each bound connection is unbound and closed with code
  `4001`, reason `"banned"`. Bans persist in `state` with everything else.
- A deny pattern overrides every grant, across the whole inherited role set.
- **Resource scoping:** a resource is `{ owner, sharedWith }`. `can(user, perm,
  resource)` / `rbacRequire(conn, perm, {resource})` try the plain permission,
  then `"own."+perm` when `owner === user`, then `"share."+perm` when the user
  is in `sharedWith`. Grant `own.doc.*` to a baseline role ("users manage their
  own docs") and `share.doc.edit` to editors — no per-document ACL bookkeeping.
- `rbacBindIdentity` is deliberately NOT an RPC — call it from your own
  authenticated `login` handler after verifying credentials.
- Admin = connection bound to a user in `RBAC_ADMIN_USERS`, OR a connection that
  completed the (rate-limited, 10/min/IP) password handshake against
  `RBAC_ADMIN_PASSWORD_SHA256`. The server script is public source, so only the
  SHA-256 **hash** of the admin password may live in it (high-entropy generated
  passwords only). Compute it in a browser:
  `await crypto.subtle.digest("SHA-256", new TextEncoder().encode("pw")).then(b => Array.from(new Uint8Array(b)).map(x => x.toString(16).padStart(2,"0")).join(""))`
- The server core ships a pure-JS SHA-256 (`rbacSha256Hex`) because the server
  sandbox has no `crypto.subtle`.
- Every admin mutation (and each successful password handshake) is written to a
  **durable audit ring** (last 200, survives restarts) — read it with
  `rbac.adminAudit` / `client.adminAudit()`.

### Demo caveats (this page's demo only — not the plugin)

- The demo's `login` is **username-only** (no password) so it is easy to try.
  Real apps must verify credentials in their own `login` handler before calling
  `rbacBindIdentity`.
- The demo's **documents are in-memory** and reset on a server restart — only
  roles, users, bans and the audit log are durable (they live in `state`). Real
  apps persist their own domain data.
- Identity is bound to the authenticated **socket**, so a reconnect means a
  re-login. That is by design — a socket identity should never outlive the
  session that authenticated it.
- Only the demo server script embeds a real hash (for `demo-admin-pw`); the
  generic `rbac("serverScript")` keeps a `PASTE-SHA256-HERE` placeholder for
  each app to fill in.

## Build gotchas (learned the hard way — do not "fix" these)

1. **Giant single-line string literals hang the pjs parser.** Embedding a server
   script as one big string with quotes/braces/backslashes hangs page render. The
   server scripts are therefore embedded **base64** (`b64Utf8` in the build,
   `rbacB64decode` at runtime) — base64 content is parser-safe.
2. **Non-uniform indentation in embedded function bodies hangs the parser.**
   `norm()` trims every body line to zero indent and `embedBlock()` re-indents so
   the first line lands on the marker's own indent and every later line lands at
   exactly 4 spaces. If a body's first line ends up deeper than its later lines,
   the whole page render hangs. Keep this invariant when editing the build.
3. The pjs parser does not parse `[...]`/`{...}` inside `<script>` blocks or CSS,
   but it DOES parse them in plain HTML text — escape curlies (`\{...\}`) or
   reword to avoid brackets in any HTML text node (see the hash note on the page).

## Admin hash / versioning

- `RBAC_STATE_VERSION = 3` in the core: v3 added the persisted audit log; v2
  fixed a buggy `rbacUtf8Encode` (it duplicated each char with a spurious 3-byte
  sequence, so the admin password handshake and any non-ASCII strings were
  corrupted). State written by an older version is discarded and reseeded. Bump
  it again if the state layout or encoding changes.
