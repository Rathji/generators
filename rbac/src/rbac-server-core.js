// src/rbac-server-core.js
// ============================================================================
// Authoritative RBAC server core for the Perchance server-plugin sandbox.
//
// Self-contained: it expects the pure engine from rbac-engine.js to be defined
// above it in the same script (build step concatenates them). It uses ONLY
// primitives available in the server sandbox — no crypto, no TextEncoder/
// TextDecoder, no fetch, no imports, no async. All handlers are synchronous.
//
// Persistence: a compact, versioned binary layout over the durable `state`
// Uint8Array (see STATE LAYOUT below). Roles, user->role assignments and bans
// survive restarts; a small in-memory model is rebuilt from `state` at boot.
//
// HOW AN APP USES THIS (paste this core into <script type="text/x-server-plugin">):
//   rbacInit();                              // load state, build in-memory model
//   ...define your roles + grants (see rbac.defineRole / rbac.grantRole RPCs)
//   self.rpc = Object.assign({}, rbacRpc, { YOUR_METHODS });
//   // inside YOUR privileged methods:
//   //   rbacBindIdentity(conn, userId)   // ONLY after YOUR app authenticated the user
//   //   rbacRequire(conn, "posts.delete") // throw if not allowed
//   //   rbacAllow(conn, "posts.delete")   // boolean check
//   self.onclose = ({conn}) => rbacForgetConn(conn);
//
// SECURITY NOTES (read carefully):
//   - Client-side role checks are COSMETIC. Enforce inside your server handlers
//     with rbacRequire/rbacAllow — that is the only real gate.
//   - rbacBindIdentity is deliberately NOT exposed as an RPC. Your app must
//     call it from its OWN login handler, only after authenticating the user.
//   - BANS are enforced everywhere: rbacDb.can() returns false for banned users
//     (permission layer), your login handler should reject them, and
//     rbac.banUser actively revokes their live sessions via rbacKickUser
//     (closes each bound connection with 4001 "banned").
//   - Role/user mutations are admin-gated. Admin = bound identity that is a
//     member of RBAC_ADMIN_USERS, OR a connection that completed a password
//     handshake against RBAC_ADMIN_PASSWORD_SHA256 (rate limited).
//   - Everything in this file is public source. Never store a plaintext
//     password here — store only the SHA-256 hash of a high-entropy password.
// ============================================================================

// ---- APP-SPECIFIC CONFIG (edit these) ----
var RBAC_ADMIN_USERS = ["admin"];   // userIds whose bound identity grants admin
var RBAC_ADMIN_PASSWORD_SHA256 = "PASTE-SHA256-HERE"; // hash of your admin password

// ---------------------------------------------------------------------------
// UTF-8 helpers (the sandbox has no TextEncoder/TextDecoder)
// ---------------------------------------------------------------------------

function rbacUtf8Len(str) {
  var n = 0;
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) n += 1;
    else if (c < 0x800) n += 2;
    else if (c >= 0xd800 && c <= 0xdbff) { n += 4; i++; } // surrogate pair
    else n += 3;
  }
  return n;
}

function rbacUtf8Encode(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var c = str.charCodeAt(i);
    if (c < 0x80) { bytes.push(c); continue; }
    if (c < 0x800) { bytes.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f)); continue; }
    if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
      var c2 = str.charCodeAt(i + 1);
      if (c2 >= 0xdc00 && c2 <= 0xdfff) {
        var cp = 0x10000 + ((c - 0xd800) << 10) + (c2 - 0xdc00);
        bytes.push(0xf0 | (cp >> 18), 0x80 | ((cp >> 12) & 0x3f), 0x80 | ((cp >> 6) & 0x3f), 0x80 | (cp & 0x3f));
        i++;
        continue;
      }
    }
    if (c < 0x10000) { bytes.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
    else { bytes.push(0xf0 | (c >> 18), 0x80 | ((c >> 12) & 0x3f), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f)); }
  }
  return new Uint8Array(bytes);
}

function rbacUtf8Decode(bytes, start, end) {
  var out = "";
  var i = start;
  while (i < end) {
    var b = bytes[i];
    if (b < 0x80) { out += String.fromCharCode(b); i++; }
    else if ((b & 0xe0) === 0xc0) {
      out += String.fromCharCode(((b & 0x1f) << 6) | (bytes[i + 1] & 0x3f)); i += 2;
    }
    else if ((b & 0xf0) === 0xe0) {
      out += String.fromCharCode(((b & 0x0f) << 12) | ((bytes[i + 1] & 0x3f) << 6) | (bytes[i + 2] & 0x3f)); i += 3;
    }
    else if ((b & 0xf8) === 0xf0) {
      var cp = ((b & 0x07) << 18) | ((bytes[i + 1] & 0x3f) << 12) | ((bytes[i + 2] & 0x3f) << 6) | (bytes[i + 3] & 0x3f);
      var u = cp - 0x10000;
      out += String.fromCharCode(0xd800 + (u >> 10), 0xdc00 + (u & 0x3ff));
      i += 4;
    } else { i++; }
  }
  return out;
}

// ---------------------------------------------------------------------------
// SHA-256 (pure JS; the sandbox has no crypto.subtle). Used only for the admin
// password handshake. Suitable because the password is expected to be a
// high-entropy generated secret — see AGENTS/security notes.
// ---------------------------------------------------------------------------

function rbacSha256Hex(bytes) {
  var K = [0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
           0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
           0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
           0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
           0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
           0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
           0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
           0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2];
  var H = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
  var ml = bytes.length;
  var bitLenHi = Math.floor(ml / 0x20000000);
  var bitLenLo = (ml << 3) >>> 0;
  var paddedLen = (((ml + 8) >> 6) + 1) << 6;
  var msg = new Uint8Array(paddedLen);
  msg.set(bytes);
  msg[ml] = 0x80;
  msg[paddedLen - 8] = (bitLenHi >>> 24) & 0xff;
  msg[paddedLen - 7] = (bitLenHi >>> 16) & 0xff;
  msg[paddedLen - 6] = (bitLenHi >>> 8) & 0xff;
  msg[paddedLen - 5] = bitLenHi & 0xff;
  msg[paddedLen - 4] = (bitLenLo >>> 24) & 0xff;
  msg[paddedLen - 3] = (bitLenLo >>> 16) & 0xff;
  msg[paddedLen - 2] = (bitLenLo >>> 8) & 0xff;
  msg[paddedLen - 1] = bitLenLo & 0xff;
  var w = new Int32Array(64);
  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }
  for (var off = 0; off < paddedLen; off += 64) {
    for (var j = 0; j < 16; j++) {
      var idx = off + j * 4;
      w[j] = ((msg[idx] << 24) | (msg[idx + 1] << 16) | (msg[idx + 2] << 8) | msg[idx + 3]) | 0;
    }
    for (j = 16; j < 64; j++) {
      var s0 = rotr(w[j - 15], 7) ^ rotr(w[j - 15], 18) ^ (w[j - 15] >>> 3);
      var s1 = rotr(w[j - 2], 17) ^ rotr(w[j - 2], 19) ^ (w[j - 2] >>> 10);
      w[j] = (w[j - 16] + s0 + w[j - 7] + s1) | 0;
    }
    var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
    for (j = 0; j < 64; j++) {
      var S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
      var ch = (e & f) ^ (~e & g);
      var t1 = (h + S1 + ch + K[j] + w[j]) | 0;
      var S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var t2 = (S0 + maj) | 0;
      h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b; b = a; a = (t1 + t2) | 0;
    }
    H[0] = (H[0] + a) | 0; H[1] = (H[1] + b) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
    H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
  }
  var hex = "";
  for (var i = 0; i < 8; i++) hex += ("00000000" + (H[i] >>> 0).toString(16)).slice(-8);
  return hex;
}

// ---------------------------------------------------------------------------
// Durable state — versioned binary layout over `state`
//
//   [0]        uint8   RBAC_STATE_VERSION
//   [1..5]     uint32  rbacRev (monotonic change counter)
//   [5..7]     uint16  roleCount
//   each role: u8 nameLen, name; u8 permCount, each: u8 len + bytes;
//              u8 denyCount, each: u8 len + bytes; u8 inheritCount, each: u8 len + bytes
//   [..]       uint32  userCount
//   each user: u8 idLen, id; u8 roleCount, each: u8 len + bytes; u8 banned
//   [..]       uint16  auditCount
//   each audit: u32 t (epoch SECONDS); u8 opLen, op; u8 actorLen, actor;
//               u8 detailLen, detail
// ---------------------------------------------------------------------------

var RBAC_STATE_VERSION = 3; // v3: + audit log (v2: utf8-encode fix — v1 state is discarded)
var RBAC_AUDIT_MAX = 200;
var rbacDb = null;               // __rbacEngine() instance
var rbacRev = 0;
var rbacConnUser = new Map();    // conn.id -> userId
var rbacConns = new Map();       // conn.id -> conn (for active ban enforcement)
var rbacAdminSessions = new Set(); // conn.id with a successful password handshake
var rbacAdminAttempts = new Map(); // netKey -> {count, resetAt}
var rbacAudit = [];              // ring, oldest -> newest: {t, op, actor, detail}

function rbacLoadState() {
  var s = state;
  if (s.length < 9 || s[0] !== RBAC_STATE_VERSION) return; // fresh / unknown
  try {
    var pos = 1;
    rbacRev = ((s[pos] * 0x1000000) + ((s[pos + 1] << 16) | (s[pos + 2] << 8) | s[pos + 3])) >>> 0; pos += 4;
    function need(n) { if (pos + n > s.length) throw new Error("rbac state corrupt"); }
    function readStr() {
      need(1);
      var len = s[pos]; pos++;
      need(len);
      var str = rbacUtf8Decode(s, pos, pos + len); pos += len;
      return str;
    }
    need(2);
    var roleCount = (s[pos] << 8) | s[pos + 1]; pos += 2;
    for (var i = 0; i < roleCount; i++) {
      var name = readStr();
      need(1); var pc = s[pos]; pos++;
      var perms = []; for (var j = 0; j < pc; j++) perms.push(readStr());
      need(1); var dc = s[pos]; pos++;
      var denies = []; for (j = 0; j < dc; j++) denies.push(readStr());
      need(1); var ic = s[pos]; pos++;
      var inherits = []; for (j = 0; j < ic; j++) inherits.push(readStr());
      rbacDb.defineRole(name, { perms: perms, denies: denies, inherits: inherits });
    }
    need(4);
    var userCount = ((s[pos] * 0x1000000) + ((s[pos + 1] << 16) | (s[pos + 2] << 8) | s[pos + 3])) >>> 0; pos += 4;
    for (i = 0; i < userCount; i++) {
      var uid = readStr();
      need(1); var rc = s[pos]; pos++;
      var roles = []; for (j = 0; j < rc; j++) roles.push(readStr());
      rbacDb.setUserRoles(uid, roles);
      need(1);
      if (s[pos] === 1) rbacDb.ban(uid);
      pos++;
    }
    need(2);
    var auditCount = (s[pos] << 8) | s[pos + 1]; pos += 2;
    rbacAudit = [];
    for (i = 0; i < auditCount && i < RBAC_AUDIT_MAX; i++) {
      need(4);
      var tsec = ((s[pos] * 0x1000000) + ((s[pos + 1] << 16) | (s[pos + 2] << 8) | s[pos + 3])) >>> 0; pos += 4;
      var op = readStr(), actor = readStr(), detail = readStr();
      rbacAudit.push({ t: tsec * 1000, op: op, actor: actor, detail: detail });
    }
  } catch (e) {
    // Corrupt/truncated state: rebuild clean (deny-by-default) rather than crash.
    rbacDb = __rbacEngine();
    rbacRev = 0;
    rbacAudit = [];
  }
}

function rbacSaveState() {
  var roles = rbacDb.listRoles();
  var users = rbacDb.listUsers();
  var total = 5 + 2 + 4;
  roles.forEach(function (name) {
    var d = rbacDb.roleDef(name);
    total += 1 + rbacUtf8Len(name) + 3;
    d.perms.forEach(function (p) { total += 1 + rbacUtf8Len(p); });
    d.denies.forEach(function (p) { total += 1 + rbacUtf8Len(p); });
    d.inherits.forEach(function (p) { total += 1 + rbacUtf8Len(p); });
  });
  users.forEach(function (uid) {
    total += 1 + rbacUtf8Len(uid) + 1 + 1;
    rbacDb.directRoles(uid).forEach(function (r) { total += 1 + rbacUtf8Len(r); });
  });
  var audit = rbacAudit.slice(-RBAC_AUDIT_MAX);
  total += 2;
  audit.forEach(function (e) {
    total += 4 + 1 + rbacUtf8Len(e.op) + 1 + rbacUtf8Len(e.actor) + 1 + rbacUtf8Len(e.detail);
  });
  if (total > state.length) throw new Error("rbac: durable state full (" + total + " > " + state.length + ")");

  var pos = 0;
  state[pos++] = RBAC_STATE_VERSION;
  state[pos++] = (rbacRev >>> 24) & 255; state[pos++] = (rbacRev >>> 16) & 255;
  state[pos++] = (rbacRev >>> 8) & 255; state[pos++] = rbacRev & 255;
  state[pos++] = (roles.length >> 8) & 255; state[pos++] = roles.length & 255;

  function putStr(str) {
    var b = rbacUtf8Encode(str);
    if (b.length > 255) throw new Error("rbac: string too long (>255 bytes): " + str.slice(0, 20));
    state[pos++] = b.length;
    state.set(b, pos);
    pos += b.length;
  }

  roles.forEach(function (name) {
    var d = rbacDb.roleDef(name);
    putStr(name);
    state[pos++] = d.perms.length; d.perms.forEach(putStr);
    state[pos++] = d.denies.length; d.denies.forEach(putStr);
    state[pos++] = d.inherits.length; d.inherits.forEach(putStr);
  });
  state[pos++] = (users.length >>> 24) & 255; state[pos++] = (users.length >>> 16) & 255;
  state[pos++] = (users.length >>> 8) & 255; state[pos++] = users.length & 255;
  users.forEach(function (uid) {
    putStr(uid);
    var rs = rbacDb.directRoles(uid);
    state[pos++] = rs.size;
    rs.forEach(putStr);
    state[pos++] = rbacDb.isBanned(uid) ? 1 : 0;
  });
  state[pos++] = (audit.length >> 8) & 255; state[pos++] = audit.length & 255;
  audit.forEach(function (e) {
    var tsec = Math.floor(e.t / 1000);
    state[pos++] = (tsec >>> 24) & 255; state[pos++] = (tsec >>> 16) & 255;
    state[pos++] = (tsec >>> 8) & 255; state[pos++] = tsec & 255;
    putStr(e.op); putStr(e.actor); putStr(e.detail);
  });
}

function rbacInit() {
  rbacDb = __rbacEngine();
  rbacLoadState();
}

// ---------------------------------------------------------------------------
// Identity binding + authorization helpers (used by the APP's own handlers)
// ---------------------------------------------------------------------------

// Bind an AUTHENTICATED connection to a userId. Call ONLY from your own login
// handler, after your app has verified the user's credentials. Your login
// handler should ALSO reject banned users (rbacDb.isBanned) — see rbacKickUser.
function rbacBindIdentity(conn, userId) {
  if (typeof userId !== "string" || userId === "") throw new Error("rbac: invalid userId");
  rbacConnUser.set(conn.id, userId);
  rbacConns.set(conn.id, conn);
}

function rbacUnbind(conn) {
  rbacConnUser.delete(conn.id);
  rbacConns.delete(conn.id);
}
function rbacIdentityOf(conn) { return rbacConnUser.has(conn.id) ? rbacConnUser.get(conn.id) : null; }

// Actively revoke every live session bound to a userId (used by ban). Each
// affected connection is unbound and closed with code 4001 / reason "banned" —
// the client sees a clean "you were banned" close instead of a silent timeout.
// Returns how many sessions were revoked. Bans are also enforced at the
// permission layer (rbacDb.can returns false for banned users), so this is a
// UX/correctness courtesy for ALREADY-connected sessions — the connection
// could do nothing anyway, but revoking it makes that obvious and drops its
// presence from the roster.
function rbacKickUser(userId) {
  var kicked = 0;
  rbacConns.forEach(function (conn, connId) {
    if (rbacConnUser.get(connId) !== userId) return;
    rbacUnbind(conn);
    rbacAdminSessions.delete(connId);
    try { conn.close(4001, "banned"); } catch (e) {}
    kicked++;
  });
  return kicked;
}

function rbacCan(userId, permission) { return rbacDb.can(userId, permission); }
function rbacRolesOf(userId) { return Array.from(rbacDb.rolesOf(userId)); }
function rbacDirectRolesOf(userId) { return Array.from(rbacDb.directRoles(userId)); }
function rbacEffectivePermissions(userId) { return Array.from(rbacDb.effectivePermissions(userId)); }

// THE enforcement check: identity required, bans deny, then role grants decide.
// opts.resource (optional) = { owner: userId, sharedWith: [ids] } enables the
// scoped "own."/"share." checks — see the engine's can().
function rbacAllow(conn, permission, opts) {
  var uid = rbacIdentityOf(conn);
  if (uid === null) return false;
  return rbacDb.can(uid, permission, opts && opts.resource);
}

function rbacRequire(conn, permission, opts) {
  if (!rbacAllow(conn, permission, opts)) throw new Error("forbidden: missing permission '" + permission + "'");
}

function rbacForgetConn(conn) {
  rbacUnbind(conn);
  rbacAdminSessions.delete(conn.id);
}

// ---------------------------------------------------------------------------
// Admin gate — identity in RBAC_ADMIN_USERS OR a rate-limited password session
// ---------------------------------------------------------------------------

function rbacIsAdmin(conn) {
  var uid = rbacIdentityOf(conn);
  if (uid !== null && RBAC_ADMIN_USERS.indexOf(uid) !== -1) return true;
  return rbacAdminSessions.has(conn.id);
}

function rbacRequireAdmin(conn) {
  if (!rbacIsAdmin(conn)) throw new Error("forbidden: admin access required");
}

function rbacAdminAttemptAllowed(conn) {
  var key = String(conn.net[3]);
  var now = Date.now();
  var rec = rbacAdminAttempts.get(key);
  if (!rec || now > rec.resetAt) { rec = { count: 0, resetAt: now + 60000 }; rbacAdminAttempts.set(key, rec); }
  rec.count++;
  return rec.count <= 10;
}

function rbacAuthenticateAdmin(conn, password) {
  if (!rbacAdminAttemptAllowed(conn)) throw new Error("rate limited: too many attempts, try again in a minute");
  if (typeof password !== "string") throw new Error("bad request");
  var want = RBAC_ADMIN_PASSWORD_SHA256;
  if (!want || want.indexOf("PASTE-SHA256") !== -1) throw new Error("admin password not configured on server");
  var hash = rbacSha256Hex(rbacUtf8Encode(password));
  if (hash !== want) throw new Error("invalid password");
  rbacAdminSessions.add(conn.id);
  return true;
}

// ---------------------------------------------------------------------------
// Mutations (admin-gated via RPC): bump rev, persist, notify clients
// ---------------------------------------------------------------------------

// Append an entry to the audit ring (persisted with the next rbacSaveState).
// op/actor/detail are char-capped so their UTF-8 bytes always fit a u8 length.
function rbacAuditAdd(op, actor, detail) {
  rbacAudit.push({
    t: Date.now(),
    op: String(op).slice(0, 40),
    actor: String(actor || "?").slice(0, 40),
    detail: String(detail || "").slice(0, 60)
  });
  if (rbacAudit.length > RBAC_AUDIT_MAX) rbacAudit.splice(0, rbacAudit.length - RBAC_AUDIT_MAX);
}

function rbacActor(conn) { return rbacIdentityOf(conn) || "(admin session)"; }

function rbacBump() {
  rbacRev = (rbacRev + 1) >>> 0;
  rbacSaveState();
  try { pubsub.publish("rbac:changed", JSON.stringify({ t: "changed", rev: rbacRev })); } catch (e) {}
}

function rbacSnapshotRoles() {
  return rbacDb.listRoles().map(function (name) {
    var d = rbacDb.roleDef(name);
    return { name: name, perms: d.perms, denies: d.denies, inherits: d.inherits };
  });
}

function rbacSnapshotUsers() {
  return rbacDb.listUsers().map(function (uid) {
    return { userId: uid, roles: rbacDirectRolesOf(uid), banned: rbacDb.isBanned(uid) };
  });
}

function rbacParse(data) {
  if (typeof data === "string") {
    try { return JSON.parse(data); } catch (e) { throw new Error("rbac: invalid JSON"); }
  }
  return data || {};
}

// ---------------------------------------------------------------------------
// RPC surface — merge into self.rpc:  self.rpc = Object.assign({}, rbacRpc, ...)
// ---------------------------------------------------------------------------

var rbacRpc = {
  "rbac.ping": function () { return JSON.stringify({ ok: true }); },

  "rbac.me": function (ctx) {
    var uid = rbacIdentityOf(ctx.conn);
    if (uid === null) return JSON.stringify({ ok: true, user: null });
    return JSON.stringify({
      ok: true,
      user: { userId: uid, roles: rbacRolesOf(uid), permissions: rbacEffectivePermissions(uid), banned: rbacDb.isBanned(uid) }
    });
  },

  "rbac.can": function (ctx, data) {
    var uid = rbacIdentityOf(ctx.conn);
    if (uid === null) return JSON.stringify({ ok: true, allowed: false });
    var d = rbacParse(data);
    return JSON.stringify({ ok: true, allowed: rbacDb.can(uid, String(d.permission)) });
  },

  "rbac.hasRole": function (ctx, data) {
    var uid = rbacIdentityOf(ctx.conn);
    var d = rbacParse(data);
    return JSON.stringify({ ok: true, has: uid !== null && rbacDb.hasRole(uid, String(d.role)) });
  },

  "rbac.rolesOf": function (ctx) {
    var uid = rbacIdentityOf(ctx.conn);
    return JSON.stringify({ ok: true, roles: uid === null ? [] : rbacRolesOf(uid) });
  },

  "rbac.amAdmin": function (ctx) {
    return JSON.stringify({ ok: true, admin: rbacIsAdmin(ctx.conn) });
  },

  // ---- admin-gated ----

  "rbac.authenticateAdmin": function (ctx, data) {
    var d = rbacParse(data);
    rbacAuthenticateAdmin(ctx.conn, d && d.password);
    rbacAuditAdd("admin.authenticate", rbacIdentityOf(ctx.conn) || "(password)", "password handshake ok");
    return JSON.stringify({ ok: true });
  },

  "rbac.adminLogout": function (ctx) {
    rbacAdminSessions.delete(ctx.conn.id);
    return JSON.stringify({ ok: true });
  },

  "rbac.adminSnapshot": function (ctx) {
    rbacRequireAdmin(ctx.conn);
    return JSON.stringify({ ok: true, rev: rbacRev, roles: rbacSnapshotRoles(), users: rbacSnapshotUsers(), audit: rbacAudit.slice() });
  },

  "rbac.adminAudit": function (ctx) {
    rbacRequireAdmin(ctx.conn);
    return JSON.stringify({ ok: true, entries: rbacAudit.slice() });
  },

  "rbac.canAs": function (ctx, data) {
    rbacRequireAdmin(ctx.conn);
    var d = rbacParse(data);
    var resource = (d.resource && typeof d.resource === "object") ? d.resource : null;
    if (resource && typeof resource.sharedWith === "string") resource.sharedWith = [resource.sharedWith];
    return JSON.stringify({ ok: true, allowed: rbacDb.can(String(d.userId), String(d.permission), resource || undefined) });
  },

  "rbac.defineRole": function (ctx, data) {
    rbacRequireAdmin(ctx.conn);
    var d = rbacParse(data);
    rbacDb.defineRole(String(d.name), { perms: d.perms || [], denies: d.denies || [], inherits: d.inherits || [] });
    rbacAuditAdd("role.define", rbacActor(ctx.conn), String(d.name));
    rbacBump();
    return JSON.stringify({ ok: true });
  },

  "rbac.deleteRole": function (ctx, data) {
    rbacRequireAdmin(ctx.conn);
    var d = rbacParse(data);
    rbacDb.deleteRole(String(d.name));
    rbacAuditAdd("role.delete", rbacActor(ctx.conn), String(d.name));
    rbacBump();
    return JSON.stringify({ ok: true });
  },

  "rbac.grantRole": function (ctx, data) {
    rbacRequireAdmin(ctx.conn);
    var d = rbacParse(data);
    if (!rbacDb.roleExists(String(d.role))) throw new Error("rbac: unknown role '" + d.role + "'");
    rbacDb.grant(String(d.userId), String(d.role));
    rbacAuditAdd("role.grant", rbacActor(ctx.conn), String(d.userId) + " += " + d.role);
    rbacBump();
    return JSON.stringify({ ok: true });
  },

  "rbac.revokeRole": function (ctx, data) {
    rbacRequireAdmin(ctx.conn);
    var d = rbacParse(data);
    rbacDb.revoke(String(d.userId), String(d.role));
    rbacAuditAdd("role.revoke", rbacActor(ctx.conn), String(d.userId) + " -= " + d.role);
    rbacBump();
    return JSON.stringify({ ok: true });
  },

  "rbac.setUserRoles": function (ctx, data) {
    rbacRequireAdmin(ctx.conn);
    var d = rbacParse(data);
    rbacDb.setUserRoles(String(d.userId), d.roles || []);
    rbacAuditAdd("user.roles", rbacActor(ctx.conn), String(d.userId) + " = " + (d.roles || []).join(","));
    rbacBump();
    return JSON.stringify({ ok: true });
  },

  "rbac.banUser": function (ctx, data) {
    rbacRequireAdmin(ctx.conn);
    var d = rbacParse(data);
    if (d.banned) {
      rbacDb.ban(String(d.userId));
      var kicked = rbacKickUser(String(d.userId)); // revoke any live sessions NOW
      rbacAuditAdd("user.ban", rbacActor(ctx.conn), String(d.userId) + (kicked ? " (" + kicked + " session" + (kicked > 1 ? "s" : "") + " revoked)" : ""));
    } else {
      rbacDb.unban(String(d.userId));
      rbacAuditAdd("user.unban", rbacActor(ctx.conn), String(d.userId));
    }
    rbacBump();
    return JSON.stringify({ ok: true });
  },

  "rbac.forgetUser": function (ctx, data) {
    rbacRequireAdmin(ctx.conn);
    var d = rbacParse(data);
    rbacDb.removeUser(String(d.userId));
    rbacAuditAdd("user.forget", rbacActor(ctx.conn), String(d.userId));
    rbacBump();
    return JSON.stringify({ ok: true });
  }
};
