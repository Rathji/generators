/* ============================================================
   RMM-U — enrollment & device identity  (Phase 2 · Task 7)

   The enroll handshake, and the credential/token security model
   the whole agent story rests on:

     • A per-provider installer carries a ONE-TIME enrollment token
       (see src/rmm.agent.js). The token is high-entropy, is bound to
       a provider + optional site/groups, and expires.
     • On first contact the agent exchanges that token for a durable
       per-device credential. Only the SHA-256 HASH of the token and
       of the credential are ever persisted here (or, later, on the
       collector) — the plaintext is returned exactly once, to the
       caller that just created it.
     • The installer token is single-use. A legitimate reinstall uses
       a re-enrollment token (or the previous credential) to rotate to
       a fresh credential; the old one is revoked.
     • A revoked device is refused on reconnect: every check-in is
       authenticated per device against its stored credential hash.

   The engine is deliberately a plain, dependency-light service that
   the console drives today and that the Phase-3 collector
   (src/rmm.collector, Task 14) will mirror server-side — the server
   script cannot import this file, so the same rules are re-stated
   there, but the data model and semantics are defined once, here.

   Records live in the hidden `enrollment` document
   (rmm-v1-enrollment), so tokens & credentials travel in backups and
   survive across devices. Two record kinds:

     { kind:"token",      id, tokenHash, providerId, siteId,
       groupIds[], deviceId?, label, createdAt, expiresAt, maxUses,
       uses, usedAt, usedBy, revokedAt, status, createdBy }
     { kind:"credential", id, deviceId, providerId, credentialHash,
       tokenId, issuedAt, rotatedAt, revokedAt, status, lastAuthAt }

   window.ERP.enrollment is the service.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP || !ERP.tenancy) return;
  const T = ERP.tenancy;
  const D = ERP.devices;
  const E = (ERP.enrollment = {});

  E.MODULE = "enrollment";
  E.DOC_KIND = "enrollment";
  E.KINDS = ["token", "credential"];

  /* ─────────────────────── helpers ─────────────────────── */

  const cfg = (path, fallback) => { try { return ERP.configVal(path, fallback); } catch (e) { return fallback; } };
  const clone = (v) => (v == null ? v : JSON.parse(JSON.stringify(v)));
  const asArr = (v) => (Array.isArray(v) ? v.slice() : []);
  const asObj = (v) => (v && typeof v === "object" && !Array.isArray(v) ? v : {});
  const num = (v, d) => { const n = Number(v); return isFinite(n) ? n : (d || 0); };
  const now = () => new Date().toISOString();
  const rid = (p) => p + "-" + randomCode(8).toLowerCase();

  /* 32-symbol unambiguous alphabet (no I, O, 0, 1) — length divides 256,
     so a single byte maps to a symbol with no modulo bias. */
  const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

  function randomBytes(n) {
    const a = new Uint8Array(n);
    try {
      if (typeof crypto !== "undefined" && crypto.getRandomValues) { crypto.getRandomValues(a); return a; }
    } catch (e) {}
    for (let i = 0; i < n; i++) a[i] = (Math.random() * 256) | 0;
    return a;
  }

  function randomCode(n) {
    const b = randomBytes(n);
    let s = "";
    for (let i = 0; i < n; i++) s += ALPHABET[b[i] % ALPHABET.length];
    return s;
  }

  E.newToken = () => "rmm_" + randomCode(32);
  E.newCredential = () => "cred_" + randomCode(40);
  E.newTokenId = () => rid("tok");
  E.newCredentialId = () => rid("cred");

  function actorName() {
    try {
      if (ERP.team && typeof ERP.team.me === "function") {
        const me = ERP.team.me();
        if (me && me.displayName) return String(me.displayName);
      }
    } catch (e) {}
    return ERP.role || "owner";
  }

  async function audit(action, targetType, targetId, summary) {
    try {
      if (ERP.master && typeof ERP.master.audit === "function") {
        await ERP.master.audit({ action, targetType, targetId, summary });
      }
    } catch (e) {}
  }

  /* ─────────────────────── SHA-256 (pure sync JS) ───────────────────────
     Tokens and credentials are only ever stored as hashes, so enrollment
     needs a synchronous, dependency-free SHA-256 (crypto.subtle is async
     and unavailable on the server-plugin side, which mirrors this). */
  E.sha256Hex = function (input) {
    var bytes = [];
    for (var i = 0; i < input.length; i++) {
      var c = input.charCodeAt(i);
      if (c < 128) bytes.push(c);
      else if (c < 2048) bytes.push(192 | c >> 6, 128 | c & 63);
      else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < input.length) {
        var c2 = input.charCodeAt(i + 1);
        if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
          var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
          bytes.push(240 | cp >> 18, 128 | cp >> 12 & 63, 128 | cp >> 6 & 63, 128 | cp & 63);
          i++;
        } else bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
      } else bytes.push(224 | c >> 12, 128 | c >> 6 & 63, 128 | c & 63);
    }
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while (bytes.length % 64 !== 56) bytes.push(0);
    for (var k = 7; k >= 0; k--) bytes.push((bitLen / Math.pow(2, 8 * k)) & 255);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var K = [0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
      0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
      0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
      0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
      0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
      0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
      0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
      0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2];
    var w = new Array(64);
    for (var blk = 0; blk < bytes.length; blk += 64) {
      for (var t = 0; t < 16; t++) w[t] = ((bytes[blk + t * 4] << 24) | (bytes[blk + t * 4 + 1] << 16) | (bytes[blk + t * 4 + 2] << 8) | bytes[blk + t * 4 + 3]) >>> 0;
      for (var t2 = 16; t2 < 64; t2++) {
        var w15 = w[t2 - 15], w2 = w[t2 - 2];
        var s0 = ((w15 >>> 7) | (w15 << 25)) ^ ((w15 >>> 18) | (w15 << 14)) ^ (w15 >>> 3);
        var s1 = ((w2 >>> 17) | (w2 << 15)) ^ ((w2 >>> 19) | (w2 << 13)) ^ (w2 >>> 10);
        w[t2] = (w[t2 - 16] + s0 + w[t2 - 7] + s1) >>> 0;
      }
      var a = H[0], b = H[1], c = H[2], d = H[3], e = H[4], f = H[5], g = H[6], h = H[7];
      for (var j = 0; j < 64; j++) {
        var S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
        var ch = (e & f) ^ (~e & g);
        var t1 = (h + S1 + ch + K[j] + w[j]) >>> 0;
        var S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
        var maj = (a & b) ^ (a & c) ^ (b & c);
        var t22 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + t1) >>> 0; d = c; c = b; b = a; a = (t1 + t22) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0; H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0; H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var hex = "";
    function hx(v) { v = v & 255; return (v < 16 ? "0" : "") + v.toString(16); }
    for (var q = 0; q < 8; q++) { var v2 = H[q]; hex += hx(v2 >>> 24) + hx(v2 >>> 16) + hx(v2 >>> 8) + hx(v2); }
    return hex;
  };

  E.constantTimeEqual = function (a, b) {
    a = String(a || ""); b = String(b || "");
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
  };

  /* ─────────────────────── persistence ─────────────────────── */

  async function load() {
    const r = await store();
    return asArr(r.error ? [] : r.records);
  }
  function store() { return ERP.store.loadDoc(E.MODULE); }
  async function save(list) { return ERP.store.saveDoc(E.MODULE, list); }

  /* A token/credential record without its hash — the only shape that ever
     leaves this module for display. */
  function publicToken(r) {
    const c = Object.assign({}, r);
    delete c.tokenHash;
    return c;
  }
  function publicCredential(r) {
    const c = Object.assign({}, r);
    delete c.credentialHash;
    return c;
  }
  E.publicToken = publicToken;
  E.publicCredential = publicCredential;

  /* ─────────────────────── change notification ─────────────────────── */

  const listeners = [];
  E.onChange = function (fn) {
    if (typeof fn !== "function") return () => {};
    listeners.push(fn);
    return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
  };
  function notify(type, payload) { listeners.slice().forEach((fn) => { try { fn(type, payload); } catch (e) {} }); }

  /* ─────────────────────── tokens ─────────────────────── */

  /* Issue a one-time enrollment token. Returns the plaintext token — the
     ONLY time it is ever available — plus the stored (hashed) record.
     `deviceId` marks a re-enrollment token bound to an existing device. */
  E.issueToken = async function (opts) {
    opts = opts || {};
    if (!opts.providerId && !opts.deviceId) return { error: "no_provider", message: "An enrollment token must belong to a provider." };
    const plaintext = opts.token || E.newToken();
    const ttl = opts.expiresInMinutes == null ? num(cfg("rmm.enrollmentTokenTtlMinutes", 1440), 1440) : num(opts.expiresInMinutes, 0);
    const expiresAt = ttl > 0 ? new Date(Date.now() + ttl * 60000).toISOString() : (ttl < 0 ? new Date(Date.now() + ttl * 60000).toISOString() : "");
    const rec = {
      kind: "token",
      id: E.newTokenId(),
      tokenHash: E.sha256Hex(plaintext),
      providerId: String(opts.providerId || ""),
      siteId: opts.siteId ? String(opts.siteId) : null,
      groupIds: asArr(opts.groupIds).map(String),
      deviceId: opts.deviceId ? String(opts.deviceId) : "",
      label: String(opts.label || ""),
      createdAt: now(),
      expiresAt,
      maxUses: Math.max(1, num(opts.maxUses, 1)),
      uses: 0,
      usedAt: "",
      usedBy: "",
      revokedAt: "",
      status: "active",
      createdBy: actorName(),
    };
    const list = await load();
    list.push(rec);
    const w = await save(list);
    if (w && w.error) return { error: w.error, message: w.message };
    notify("token", publicToken(rec));
    return { ok: true, token: plaintext, record: publicToken(rec) };
  };

  E.listTokens = async function (opts) {
    opts = opts || {};
    let list = (await load()).filter((r) => r.kind === "token");
    if (opts.providerId) list = list.filter((r) => String(r.providerId) === String(opts.providerId));
    if (opts.deviceId) list = list.filter((r) => String(r.deviceId) === String(opts.deviceId));
    if (opts.status) list = list.filter((r) => r.status === opts.status);
    list.sort((a, b) => (b.createdAt || "").localeCompare(a.createdAt || ""));
    return list.map(publicToken);
  };

  E.getToken = async function (id) {
    const r = (await load()).find((x) => x.kind === "token" && String(x.id) === String(id));
    return r ? publicToken(r) : null;
  };

  E.revokeToken = async function (id) {
    const list = await load();
    const t = list.find((x) => x.kind === "token" && String(x.id) === String(id));
    if (!t) return { error: "not_found" };
    t.revokedAt = now();
    t.status = "revoked";
    const w = await save(list);
    if (w && w.error) return { error: w.error, message: w.message };
    notify("token_revoked", publicToken(t));
    await audit("revoke_enrollment_token", "enrollment_token", t.id, "Revoked enrollment token " + t.id + ".");
    return { ok: true, token: publicToken(t) };
  };

  /* Exchange a plaintext token for permission to enroll. Validates the
     token is recognised, active, unexpired and unused, then burns one use.
     Internal — callers use E.enroll, which needs the record's bindings. */
  E.consumeToken = async function (plaintext, meta) {
    const hash = E.sha256Hex(String(plaintext == null ? "" : plaintext));
    const list = await load();
    const t = list.find((r) => r.kind === "token" && E.constantTimeEqual(r.tokenHash || "", hash));
    if (!t) return { error: "invalid_token", message: "That enrollment token is not recognised." };
    if (t.revokedAt) return { error: "revoked_token", message: "That enrollment token has been revoked." };
    if (t.expiresAt && Date.parse(t.expiresAt) < Date.now()) return { error: "expired_token", message: "That enrollment token has expired." };
    if (t.uses >= t.maxUses) return { error: "used_token", message: "That enrollment token has already been used." };
    t.uses += 1;
    t.usedAt = now();
    t.usedBy = (meta && meta.deviceId) || "";
    t.status = t.uses >= t.maxUses ? "used" : "active";
    const w = await save(list);
    if (w && w.error) return { error: w.error, message: w.message };
    notify("token_used", publicToken(t));
    return { ok: true, token: publicToken(t), record: t };
  };

  /* ─────────────────────── device identity helpers ─────────────────────── */

  async function touchIdentity(deviceId, providerId, patch) {
    if (!providerId) return { error: "no_provider" };
    const g = await D.get(providerId, deviceId);
    if (g.error) return g;
    const custom = Object.assign({}, asObj(g.device.custom));
    custom.identity = Object.assign({}, asObj(custom.identity), patch, { updatedAt: now() });
    return D.update(providerId, deviceId, { custom });
  }

  /* ─────────────────────── enroll ─────────────────────── */

  /* req: { token, deviceId?, hostname?, displayName?, os?, agentVersion?,
            capabilities?, device?{...extra device fields}, providerId? }
     Returns the durable per-device credential ONCE (plaintext), after
     creating the device (or, for a re-enrollment token, updating the
     existing one and revoking its previous credential). */
  E.enroll = async function (req) {
    req = req || {};
    const consumed = await E.consumeToken(req.token, {});
    if (consumed.error) return { ok: false, error: consumed.error, message: consumed.message };
    const tok = consumed.record;
    const providerId = String(req.providerId || tok.providerId || "");
    if (!providerId) return { ok: false, error: "no_provider", message: "The enrollment token is not bound to a provider." };
    const g = await T.get(providerId);
    if (g.error) return { ok: false, error: "unknown_provider", message: "The token's provider no longer exists." };

    const list = await load();
    const incoming = asObj(req.device);
    const data = Object.assign({}, incoming, {
      hostname: String(req.hostname || incoming.hostname || ""),
      displayName: String(req.displayName || incoming.displayName || req.hostname || ""),
      os: asObj(req.os).name || incoming.os ? Object.assign({}, asObj(incoming.os), asObj(req.os)) : incoming.os,
      agentVersion: String(req.agentVersion || incoming.agentVersion || cfg("rmm.agentVersion", "1.0.0")),
    });

    let deviceId = tok.deviceId || "";
    let reenroll = false;
    if (deviceId) {
      const ex = await D.get(providerId, deviceId);
      if (!ex.error) {
        reenroll = true;
        /* revoke any credential the device still holds before issuing a new one */
        list.forEach((r) => {
          if (r.kind === "credential" && String(r.deviceId) === String(deviceId) && !r.revokedAt) {
            r.revokedAt = now(); r.status = "rotated";
          }
        });
      } else {
        deviceId = ""; /* token pointed at a device that no longer exists — enrol fresh */
      }
    }

    let device;
    if (reenroll) {
      const ex = await D.get(providerId, deviceId);
      const custom = Object.assign({}, asObj(ex.device.custom));
      const patch = Object.assign({}, data, { status: "online" });
      delete patch.os;
      if (asObj(req.os).name || asObj(incoming.os).name) patch.os = Object.assign({}, asObj(ex.device.os), asObj(incoming.os), asObj(req.os));
      const u = await D.update(providerId, deviceId, patch);
      if (u.error) return { ok: false, error: u.error, message: u.message };
      device = u.device;
    } else {
      const addData = Object.assign({}, data, {
        siteId: tok.siteId || null,
        groupIds: asArr(tok.groupIds),
        status: "online",
        enrolledAt: now(),
      });
      const a = await D.add(providerId, addData);
      if (a.error) return { ok: false, error: a.error, message: a.message };
      device = a.device;
      deviceId = device.id;
    }

    /* mint the durable credential — only its hash is stored */
    const plaintext = E.newCredential();
    const cred = {
      kind: "credential",
      id: E.newCredentialId(),
      deviceId,
      providerId,
      credentialHash: E.sha256Hex(plaintext),
      tokenId: tok.id,
      issuedAt: now(),
      rotatedAt: reenroll ? now() : "",
      revokedAt: "",
      status: "active",
      lastAuthAt: "",
    };
    list.push(cred);
    const w = await save(list);
    if (w && w.error) return { ok: false, error: w.error, message: w.message };

    /* reflect the identity on the device so the console can show it */
    const g2 = await D.get(providerId, deviceId);
    if (!g2.error) {
      const custom = Object.assign({}, asObj(g2.device.custom));
      custom.identity = Object.assign({}, asObj(custom.identity), {
        enrolledAt: g2.device.enrolledAt || now(),
        credentialId: cred.id,
        tokenId: tok.id,
        status: "active",
        reenrolledAt: reenroll ? now() : "",
        revokedAt: "",
        updatedAt: now(),
      });
      await D.update(providerId, deviceId, { custom, status: "online", enrolledAt: g2.device.enrolledAt || now() });
    }

    notify(reenroll ? "reenroll" : "enroll", { deviceId, providerId });
    await audit(reenroll ? "reenroll_device" : "enroll_device", "device", deviceId,
      (reenroll ? "Re-enrolled " : "Enrolled ") + (device.hostname || deviceId) + " under token " + tok.id + ".");
    return {
      ok: true, deviceId, providerId,
      siteId: device.siteId || tok.siteId || null,
      groupIds: asArr(device.groupIds),
      credential: plaintext,
      credentialId: cred.id,
      tokenId: tok.id,
      reenrolled: reenroll,
      serverTime: now(),
    };
  };

  /* ─────────────────────── authenticate ─────────────────────── */

  /* Every check-in is authenticated per device against its stored
     credential HASH. A revoked (or unknown) device is refused. */
  E.authenticate = async function (deviceId, credential) {
    if (!deviceId) return { ok: false, reason: "no_device" };
    const list = await load();
    const creds = list.filter((r) => r.kind === "credential" && String(r.deviceId) === String(deviceId));
    if (!creds.length) return { ok: false, reason: "no_credential", deviceId };
    const active = creds.filter((c) => !c.revokedAt && c.status === "active");
    if (!active.length) return { ok: false, reason: "revoked", deviceId };
    const hash = E.sha256Hex(String(credential == null ? "" : credential));
    const match = active.find((c) => E.constantTimeEqual(c.credentialHash || "", hash));
    if (!match) return { ok: false, reason: "invalid_credential", deviceId };
    match.lastAuthAt = now();
    await save(list);
    return { ok: true, deviceId, providerId: match.providerId, credentialId: match.id };
  };

  E.isRevoked = async function (deviceId) {
    const list = await load();
    const creds = list.filter((r) => r.kind === "credential" && String(r.deviceId) === String(deviceId));
    return creds.length > 0 && !creds.some((c) => !c.revokedAt && c.status === "active");
  };

  /* ─────────────────────── rotation & revocation ─────────────────────── */

  /* Rotate a device's credential (legitimate reinstall / compromise
     response). The previous credential must authenticate unless
     opts.force (an admin action) is set. Returns the new credential
     plaintext once; the old one is revoked immediately. */
  E.rotateCredential = async function (deviceId, opts) {
    opts = opts || {};
    if (!deviceId) return { error: "no_device" };
    const list = await load();
    const creds = list.filter((r) => r.kind === "credential" && String(r.deviceId) === String(deviceId));
    let providerId = opts.providerId || (creds[0] && creds[0].providerId) || "";
    if (!opts.force) {
      const auth = await E.authenticate(deviceId, opts.credential);
      if (!auth.ok) return { error: auth.reason, message: "The current credential did not authenticate." };
      providerId = auth.providerId || providerId;
    }
    if (!providerId) return { error: "no_provider" };
    list.forEach((r) => { if (r.kind === "credential" && String(r.deviceId) === String(deviceId) && !r.revokedAt) { r.revokedAt = now(); r.status = "rotated"; } });
    const plaintext = E.newCredential();
    const cred = {
      kind: "credential", id: E.newCredentialId(), deviceId, providerId,
      credentialHash: E.sha256Hex(plaintext),
      tokenId: (creds[0] && creds[0].tokenId) || "",
      issuedAt: now(), rotatedAt: now(), revokedAt: "", status: "active", lastAuthAt: "",
    };
    list.push(cred);
    const w = await save(list);
    if (w && w.error) return { error: w.error, message: w.message };
    await touchIdentity(deviceId, providerId, { credentialId: cred.id, status: "active", rotatedAt: now(), revokedAt: "" });
    notify("rotate", { deviceId, providerId });
    await audit("rotate_credential", "device", deviceId, "Rotated the agent credential for " + deviceId + ".");
    return { ok: true, deviceId, providerId, credential: plaintext, credentialId: cred.id };
  };

  /* Issue a one-time re-enrollment token bound to an existing device, so a
     legitimate reinstall can re-key without an admin typing a credential. */
  E.beginReenroll = async function (deviceId, opts) {
    opts = opts || {};
    const list = await load();
    const cred = list.find((r) => r.kind === "credential" && String(r.deviceId) === String(deviceId));
    const providerId = opts.providerId || (cred && cred.providerId) || "";
    if (!providerId) return { error: "no_provider" };
    return E.issueToken({
      providerId, siteId: opts.siteId || null, label: opts.label || ("Re-enroll " + (opts.hostname || deviceId)),
      deviceId, maxUses: 1, expiresInMinutes: opts.expiresInMinutes,
    });
  };

  /* Revoke a device: every credential it holds is invalidated, so the next
     check-in is refused (reason "revoked"). */
  E.revokeDevice = async function (deviceId, opts) {
    opts = opts || {};
    if (!deviceId) return { error: "no_device" };
    const list = await load();
    let n = 0;
    list.forEach((r) => {
      if (r.kind === "credential" && String(r.deviceId) === String(deviceId) && !r.revokedAt) { r.revokedAt = now(); r.status = "revoked"; n++; }
      if (r.kind === "token" && String(r.deviceId) === String(deviceId) && !r.revokedAt && r.status === "active") { r.revokedAt = now(); r.status = "revoked"; }
    });
    const w = await save(list);
    if (w && w.error) return { error: w.error, message: w.message };
    if (opts.providerId) await touchIdentity(deviceId, opts.providerId, { status: "revoked", revokedAt: now() });
    notify("revoke", { deviceId });
    await audit("revoke_device", "device", deviceId, "Revoked the agent credential for " + deviceId + ".");
    return { ok: true, deviceId, revoked: n };
  };

  /* ─────────────────────── reads ─────────────────────── */

  E.identity = async function (deviceId) {
    const list = await load();
    const creds = list.filter((r) => r.kind === "credential" && String(r.deviceId) === String(deviceId))
      .sort((a, b) => (b.issuedAt || "").localeCompare(a.issuedAt || ""));
    const active = creds.find((c) => !c.revokedAt && c.status === "active") || null;
    return {
      deviceId,
      enrolled: creds.length > 0,
      revoked: creds.length > 0 && !active,
      active: active ? { id: active.id, issuedAt: active.issuedAt, rotatedAt: active.rotatedAt, lastAuthAt: active.lastAuthAt } : null,
      credentials: creds.map((c) => ({ id: c.id, issuedAt: c.issuedAt, rotatedAt: c.rotatedAt, revokedAt: c.revokedAt, status: c.status, lastAuthAt: c.lastAuthAt })),
    };
  };
  E.summary = E.identity;

  E.listCredentials = async function (opts) {
    opts = opts || {};
    let list = (await load()).filter((r) => r.kind === "credential");
    if (opts.providerId) list = list.filter((r) => String(r.providerId) === String(opts.providerId));
    if (opts.deviceId) list = list.filter((r) => String(r.deviceId) === String(opts.deviceId));
    list.sort((a, b) => (b.issuedAt || "").localeCompare(a.issuedAt || ""));
    return list.map(publicCredential);
  };

  E.stats = async function (opts) {
    opts = opts || {};
    const list = await load();
    const scope = (r) => !opts.providerId || String(r.providerId) === String(opts.providerId);
    const tokens = list.filter((r) => r.kind === "token" && scope(r));
    const creds = list.filter((r) => r.kind === "credential" && scope(r));
    const expired = (t) => t.expiresAt && Date.parse(t.expiresAt) < Date.now();
    return {
      tokens: tokens.length,
      tokensActive: tokens.filter((t) => t.status === "active" && !t.revokedAt && !expired(t)).length,
      tokensUsed: tokens.filter((t) => t.status === "used").length,
      tokensRevoked: tokens.filter((t) => !!t.revokedAt).length,
      tokensExpired: tokens.filter((t) => expired(t) && !t.revokedAt && t.status === "active").length,
      credentials: creds.length,
      credentialsActive: creds.filter((c) => !c.revokedAt && c.status === "active").length,
      credentialsRevoked: creds.filter((c) => !!c.revokedAt).length,
      devices: new Set(creds.map((c) => String(c.deviceId))).size,
      bytes: 0,
    };
  };

  /* ─────────────────────── boot ─────────────────────── */
  E.init = function () { return E; };
})();
