// src/rbac-demo-server.js
// ============================================================================
// DEMO APP SERVER — extension on top of the generic rbac server core.
// This part is demo-specific: a "team workspace" with a shared document.
// Real apps replace this with their own logic (their own auth + handlers) but
// keep calling rbacInit/rbacBindIdentity/rbacRequire etc.
//
// BAN LIFECYCLE (demo): bans are enforced at every boundary — the permission
// layer (rbacDb.can returns false), login (rejected with "account banned"), and
// live sessions (rbac.banUser actively revokes them via rbacKickUser, closing
// each bound connection with code 4001 "banned").
// ============================================================================

rbacInit();

// ---- bootstrap: idempotently ensure roles + demo accounts ----
// Runs on every server start (and demo.reset). Each role/user is ensured
// individually, so existing saved state upgrades without clobbering admin's
// live tweaks (a demo user is only given its baseline role if it has none yet).
function rbacDemoBootstrap() {
  var changed = false;
  // viewer = baseline membership: read/create docs, and manage any doc you OWN
  // (own.doc.* only ever matches resources whose owner === you).
  if (!rbacDb.roleExists("viewer")) { rbacDb.defineRole("viewer", { perms: ["doc.read", "doc.create", "own.doc.*"] }); changed = true; }
  if (!rbacDb.roleExists("editor")) { rbacDb.defineRole("editor", { perms: ["doc.edit", "doc.publish", "share.doc.edit", "share.doc.publish"], inherits: ["viewer"] }); changed = true; }
  if (!rbacDb.roleExists("moderator")) { rbacDb.defineRole("moderator", { perms: ["doc.delete", "share.doc.delete"], inherits: ["editor"] }); changed = true; }
  if (!rbacDb.roleExists("owner")) { rbacDb.defineRole("owner", { perms: ["*"], inherits: ["moderator"] }); changed = true; }
  // guest = deny-overrides demo: inherits viewer (so it can read docs and
  // manage its own) but DENIES doc.create — the deny beats viewer's grant.
  if (!rbacDb.roleExists("guest")) { rbacDb.defineRole("guest", { inherits: ["viewer"], denies: ["doc.create"] }); changed = true; }
  var baseline = [["admin", "owner"], ["bob", "editor"], ["carol", "viewer"], ["mallory", "viewer"], ["guest", "guest"]];
  baseline.forEach(function (pair) {
    if (rbacDb.directRoles(pair[0]).size === 0) { rbacDb.grant(pair[0], pair[1]); changed = true; }
  });
  if (changed) { rbacRev = (rbacRev + 1) >>> 0; rbacSaveState(); }
}

rbacDemoBootstrap();

// ---- demo admin password (DEMO ONLY — shown on the demo page; replace in prod) ----
RBAC_ADMIN_PASSWORD_SHA256 = "__DEMO_HASH__";
RBAC_ADMIN_USERS = ["admin"];

// ---- presence ----
var demoConns = new Map();    // conn.id -> userId
var demoCount = new Map();    // userId -> connection count

function demoPresenceList() {
  var out = [];
  demoCount.forEach(function (n, uid) {
    out.push({ userId: uid, connections: n, roles: rbacRolesOf(uid), banned: rbacDb.isBanned(uid) });
  });
  out.sort(function (a, b) { return a.userId < b.userId ? -1 : 1; });
  return out;
}

function demoPublishPresence() {
  try { pubsub.publish("rbac:presence", JSON.stringify({ t: "presence", users: demoPresenceList() })); } catch (e) {}
}

function demoAddPresence(conn, userId) {
  demoConns.set(conn.id, userId);
  demoCount.set(userId, (demoCount.get(userId) || 0) + 1);
  demoPublishPresence();
}

function demoRemovePresence(conn) {
  var uid = demoConns.get(conn.id);
  if (uid !== undefined) {
    demoConns.delete(conn.id);
    var n = (demoCount.get(uid) || 1) - 1;
    if (n <= 0) demoCount.delete(uid); else demoCount.set(uid, n);
  }
  demoPublishPresence();
}

function demoUserPayload(userId) {
  return { userId: userId, roles: rbacRolesOf(userId), permissions: rbacEffectivePermissions(userId), banned: rbacDb.isBanned(userId) };
}

// ---- demo documents (in-memory; real apps persist via state/upload-plugin) ----
// Each doc: { title, body, owner, sharedWith: [userId], published }.
// Ownership + sharing drive the scoped permission checks — owners manage their
// own docs via own.doc.*, shared users get share.doc.* grants.
function demoSeedDocs() {
  return {
    shared: { title: "Project Proposal", body: "The RBAC plugin demo document. Editors can change this text; only owners can delete the document.", owner: "admin", sharedWith: [], published: false },
    "bob-notes": { title: "Bob's notes", body: "A private document. Only bob — the owner — can edit it, via the own.doc.* grant (not because he's an 'editor').", owner: "bob", sharedWith: [], published: false },
    "carol-doc": { title: "Carol's draft", body: "A draft. carol owns it, so she can edit/publish/delete it even though she's only a 'viewer'.", owner: "carol", sharedWith: [], published: false }
  };
}
var demoDocs = demoSeedDocs();
var demoDocSeq = 3;

function demoGetDoc(id) {
  var doc = demoDocs[String(id || "")];
  if (!doc) throw new Error("unknown document");
  return doc;
}
function demoRes(doc) { return { owner: doc.owner, sharedWith: doc.sharedWith }; }

// Lightweight public view of a doc (no body) — used by doc.list.
function demoDocPublic(id, doc, uid) {
  var res = demoRes(doc);
  var bound = uid !== null;
  return {
    id: id,
    title: doc.title,
    owner: doc.owner,
    sharedWith: doc.sharedWith.slice(),
    published: doc.published,
    canRead: bound && rbacDb.can(uid, "doc.read", res),
    canEdit: bound && rbacDb.can(uid, "doc.edit", res),
    canPublish: bound && rbacDb.can(uid, "doc.publish", res),
    canDelete: bound && rbacDb.can(uid, "doc.delete", res)
  };
}
function demoDocPayload(id, doc, uid) {
  var pub = demoDocPublic(id, doc, uid);
  pub.body = doc.body;
  return pub;
}

// ---- RPC surface: generic rbac + demo-specific methods ----
self.rpc = Object.assign({}, rbacRpc, {
  // Demo login: username-only (NO password) so the demo is easy to try.
  // Production apps: authenticate properly (password/secret) BEFORE binding.
  login: function (ctx, data) {
    var conn = ctx.conn;
    var d = rbacParse(data);
    var userId = String((d && d.userId) || "").trim().slice(0, 40);
    if (!/^[\w\u00C0-\uFFFF][\w\u00C0-\uFFFF ._-]{0,39}$/.test(userId)) throw new Error("invalid username");
    if (rbacDb.isBanned(userId)) throw new Error("account banned — contact an admin"); // bans are enforced at login too
    rbacBindIdentity(conn, userId);
    try { conn.subscribe("rbac:presence"); } catch (e) {}
    try { conn.subscribe("rbac:changed"); } catch (e) {}
    demoAddPresence(conn, userId);
    return JSON.stringify({ ok: true, user: demoUserPayload(userId), presence: demoPresenceList() });
  },

  logout: function (ctx) {
    var conn = ctx.conn;
    demoRemovePresence(conn);
    rbacForgetConn(conn);
    return JSON.stringify({ ok: true });
  },

  "demo.presence": function () {
    return JSON.stringify({ ok: true, users: demoPresenceList() });
  },

  // Document inventory for the admin console (admin-gated).
  "demo.adminDocs": function (ctx) {
    rbacRequireAdmin(ctx.conn);
    var out = [];
    Object.keys(demoDocs).forEach(function (id) {
      var d = demoDocs[id];
      out.push({ id: id, title: d.title, owner: d.owner, sharedWith: d.sharedWith.slice(), published: d.published, bodyLen: (d.body || "").length });
    });
    out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return JSON.stringify({ ok: true, docs: out });
  },

  // Authoritative server self-check (safe to run: no state is mutated — only
  // ephemeral conn bindings that are unbound before returning).
  "demo.selftest": function () {
    var results = [];
    var ok = function (name, cond, detail) { results.push({ name: name, ok: !!cond, detail: detail || "" }); };
    var fakeConn = function (id) {
      return { id: id, net: [0, 0, 0, 0], closed: null, subscribe: function () {}, unsubscribe: function () {}, send: function () {}, close: function (code, reason) { this.closed = { code: code, reason: reason }; } };
    };
    var conn = fakeConn("__selftest__");
    rbacBindIdentity(conn, "admin"); // admin ∈ RBAC_ADMIN_USERS
    try {
      ok("admin identity recognized", rbacIsAdmin(conn), "rbacIsAdmin(conn)");
      ok("admin passes rbacRequireAdmin", (function () { try { rbacRequireAdmin(conn); return true; } catch (e) { return false; } })(), "");
      ok("admin can do everything (owner=*)", rbacAllow(conn, "doc.read"), "rbacAllow(conn,'doc.read')");
      ok("unbound conn denied", !rbacAllow(fakeConn("__selftest2__"), "doc.read"), "rbacAllow(unbound,'doc.read')===false");

      var res = { owner: "carol", sharedWith: ["bob"] };
      ok("server: owner allowed via own.doc.*", (function () {
        var c = fakeConn("__selftest3__"); rbacBindIdentity(c, "carol");
        var a = rbacAllow(c, "doc.edit", { resource: res }); rbacUnbind(c); return a === true;
      })(), "rbacAllow(carol,'doc.edit',{resource})");
      ok("server: shared user allowed via share.doc.edit", (function () {
        var c = fakeConn("__selftest4__"); rbacBindIdentity(c, "bob");
        var a = rbacAllow(c, "doc.edit", { resource: res }); rbacUnbind(c); return a === true;
      })(), "rbacAllow(bob,'doc.edit',{resource})");
      ok("server: stranger denied on resource", (function () {
        var c = fakeConn("__selftest5__"); rbacBindIdentity(c, "mallory");
        var a = rbacAllow(c, "doc.edit", { resource: res }); rbacUnbind(c); return a === false;
      })(), "rbacAllow(mallory,'doc.edit',{resource})===false");
      ok("server: rbacRequire throws when denied", (function () {
        var c = fakeConn("__selftest6__"); rbacBindIdentity(c, "mallory");
        var threw = false;
        try { rbacRequire(c, "doc.edit", { resource: res }); } catch (e) { threw = true; }
        rbacUnbind(c); return threw;
      })(), "rbacRequire(mallory,...) throws");
      ok("server: rbacRequire passes when granted", (function () {
        var c = fakeConn("__selftest7__"); rbacBindIdentity(c, "carol");
        var threw = false;
        try { rbacRequire(c, "doc.edit", { resource: res }); } catch (e) { threw = true; }
        rbacUnbind(c); return !threw;
      })(), "rbacRequire(carol,...) does not throw");
      ok("audit machinery present", typeof rbacAuditAdd === "function" && Array.isArray(rbacAudit), "rbacAuditAdd + rbacAudit ring");

      // Ban enforcement (throwaway engine + fake conns — no shared state mutated)
      var te = __rbacEngine();
      te.defineRole("r", { perms: ["doc.read"] });
      te.grant("zoe", "r");
      te.ban("zoe");
      ok("banned user denied even with roles", !te.can("zoe", "doc.read"), "ban overrides role grant");
      te.unban("zoe");
      ok("unban restores access", te.can("zoe", "doc.read"), "unban restores role grant");

      var ck = fakeConn("__kicktest__");
      rbacBindIdentity(ck, "__kicktest__");
      var kickedN = rbacKickUser("__kicktest__");
      ok("ban revokes live sessions", kickedN === 1 && ck.closed && ck.closed.code === 4001 && ck.closed.reason === "banned", "rbacKickUser closes bound conn with 4001 'banned'");
      ok("kicked conn is unbound", rbacIdentityOf(ck) === null, "rbacIdentityOf(kicked conn)===null");

      // deny-overrides + doc.create enforcement (live role set; fake conns unbound)
      var cg = fakeConn("__guesttest__");
      rbacBindIdentity(cg, "guest");
      ok("deny overrides inherited grant (guest cannot create)", !rbacAllow(cg, "doc.create"), "guest inherits viewer (grants doc.create) but guest denies it");
      ok("inherited grant still applies elsewhere (guest can read)", rbacAllow(cg, "doc.read"), "guest can read via inherited viewer");
      rbacUnbind(cg);
      var cn = fakeConn("__nocreatetest__");
      rbacBindIdentity(cn, "no-role-user");
      ok("doc.create enforced: no-role user denied", !rbacAllow(cn, "doc.create"), "deny-by-default: no roles means no doc.create");
      rbacUnbind(cn);
      ok("doc.create enforced: editor allowed", (function () {
        var c = fakeConn("__createtest__"); rbacBindIdentity(c, "bob");
        var a = rbacAllow(c, "doc.create"); rbacUnbind(c); return a === true;
      })(), "bob (editor) can create");
    } finally {
      rbacForgetConn(conn);
    }
    var failed = results.filter(function (r) { return !r.ok; });
    return JSON.stringify({ ok: failed.length === 0, total: results.length, passed: results.length - failed.length, failed: failed.length, results: results });
  },

  // Wipe + reseed (demo convenience; admin-gated by rbacRequireAdmin below).
  "demo.reset": function (ctx) {
    rbacRequireAdmin(ctx.conn);
    rbacDb = __rbacEngine();
    rbacRev = 0;
    rbacDemoBootstrap();
    demoDocs = demoSeedDocs();
    demoDocSeq = 3;
    rbacAudit.length = 0;
    rbacAuditAdd("demo.reset", rbacActor(ctx.conn), "roles, users, docs and audit wiped + reseeded");
    try { pubsub.publish("rbac:changed", JSON.stringify({ t: "changed", rev: rbacRev })); } catch (e) {}
    demoPublishPresence();
    return JSON.stringify({ ok: true });
  },

  // ---- document actions: authoritative, resource-scoped enforcement ----
  // Every handler resolves the doc and passes { owner, sharedWith } to
  // rbacRequire, so global grants AND own.* / share.* grants are honoured.

  "doc.create": function (ctx, data) {
    var uid = rbacIdentityOf(ctx.conn);
    if (uid === null) throw new Error("log in first");
    rbacRequire(ctx.conn, "doc.create"); // not just identity — needs the permission (guest role denies it)
    var d = rbacParse(data);
    var id = "doc-" + (++demoDocSeq);
    demoDocs[id] = {
      title: String((d && d.title) || "Untitled").slice(0, 80),
      body: String((d && d.body) || "").slice(0, 20000),
      owner: uid,
      sharedWith: [],
      published: false
    };
    return JSON.stringify({ ok: true, id: id, doc: demoDocPayload(id, demoDocs[id], uid) });
  },

  "doc.list": function (ctx) {
    var uid = rbacIdentityOf(ctx.conn);
    if (uid === null) throw new Error("log in first");
    var out = [];
    Object.keys(demoDocs).forEach(function (id) {
      var doc = demoDocs[id];
      if (rbacDb.can(uid, "doc.read", demoRes(doc))) out.push(demoDocPublic(id, doc, uid));
    });
    out.sort(function (a, b) { return a.id < b.id ? -1 : 1; });
    return JSON.stringify({ ok: true, docs: out });
  },

  "doc.read": function (ctx, data) {
    var d = rbacParse(data);
    var id = String((d && d.id) || "");
    var doc = demoGetDoc(id);
    rbacRequire(ctx.conn, "doc.read", { resource: demoRes(doc) });
    return JSON.stringify({ ok: true, doc: demoDocPayload(id, doc, rbacIdentityOf(ctx.conn)) });
  },

  "doc.edit": function (ctx, data) {
    var d = rbacParse(data);
    var id = String((d && d.id) || "");
    var doc = demoGetDoc(id);
    rbacRequire(ctx.conn, "doc.edit", { resource: demoRes(doc) });
    doc.body = String((d && d.body) || "").slice(0, 20000);
    return JSON.stringify({ ok: true, doc: demoDocPayload(id, doc, rbacIdentityOf(ctx.conn)) });
  },

  "doc.publish": function (ctx, data) {
    var d = rbacParse(data);
    var id = String((d && d.id) || "");
    var doc = demoGetDoc(id);
    rbacRequire(ctx.conn, "doc.publish", { resource: demoRes(doc) });
    doc.published = true;
    return JSON.stringify({ ok: true, doc: demoDocPayload(id, doc, rbacIdentityOf(ctx.conn)) });
  },

  "doc.delete": function (ctx, data) {
    var d = rbacParse(data);
    var id = String((d && d.id) || "");
    var doc = demoGetDoc(id);
    rbacRequire(ctx.conn, "doc.delete", { resource: demoRes(doc) });
    delete demoDocs[id];
    return JSON.stringify({ ok: true, deleted: true });
  },

  // Ownership-gated: only the owner (via own.doc.share) may change sharing.
  "doc.share": function (ctx, data) {
    var d = rbacParse(data);
    var id = String((d && d.id) || "");
    var doc = demoGetDoc(id);
    rbacRequire(ctx.conn, "doc.share", { resource: demoRes(doc) });
    var user = String((d && d.user) || "").trim().slice(0, 40);
    if (!/^[\w\u00C0-\uFFFF][\w\u00C0-\uFFFF ._-]{0,39}$/.test(user)) throw new Error("invalid username");
    if (doc.sharedWith.indexOf(user) === -1) doc.sharedWith.push(user);
    return JSON.stringify({ ok: true, doc: demoDocPayload(id, doc, rbacIdentityOf(ctx.conn)) });
  },

  "doc.unshare": function (ctx, data) {
    var d = rbacParse(data);
    var id = String((d && d.id) || "");
    var doc = demoGetDoc(id);
    rbacRequire(ctx.conn, "doc.share", { resource: demoRes(doc) });
    var user = String((d && d.user) || "").trim();
    var i = doc.sharedWith.indexOf(user);
    if (i !== -1) doc.sharedWith.splice(i, 1);
    return JSON.stringify({ ok: true, doc: demoDocPayload(id, doc, rbacIdentityOf(ctx.conn)) });
  }
});

self.onclose = function (ev) {
  demoRemovePresence(ev.conn);
  rbacForgetConn(ev.conn);
};
