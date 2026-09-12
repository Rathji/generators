/* ============================================================
   RMM-U — collector service  (Phase 3 · Task 14)

   The collector is the agent-facing half of the platform: the endpoint
   checks in with a per-device credential, the collector authenticates it
   against the stored credential HASH, accepts inventory / metrics / job
   results into durable state, tracks last-seen, and answers with any
   queued jobs and configuration in the same response.

   It ships in two places that share ONE implementation:

     • The server-plugin hub in index.html (`<script
       type="text/x-server-plugin">`) — the authoritative, production
       collector. Its code runs on every client and is public, so it holds
       NO static secret: the console authenticates to it with a password
       whose SHA-256 is embedded, and the only device secret is the
       credential hash minted at enrollment.
     • This module (`window.ERP.collector`, aliased COL) — the same core,
       used by the console/simulator and as the degraded-mode fallback,
       plus the socket client that talks to the hub.

   The core is copied verbatim between the two files, delimited by the
   RMM-COLLECTOR-CORE markers. `RMMCollectorTest` rebuilds the server's
   copy from the live DOM and asserts it behaves identically to this one,
   so the two can never silently drift.

   Device protocol (one JSON request → one JSON response):
     ping, enroll, heartbeat, inventory, metrics, job-result, job-start,
     batch, logs, diagnostics, update-result, uninstall
   Console protocol (admin, over RPC):
     auth, registerToken, revokeToken, pushJob, pushJobs, pushConfig,
     requestLogs, requestSelfTest, queueUpdate, revokeDevice, retryJob,
     cancelJob, reapJobs, applyRetention, fleet, device, job, jobs,
     inventory, metrics, logs, diagnostics, seedEntropy

   Task 15 adds the job queue & dispatch state machine (job-start →
   running; retry/expiry/reap on the collector), Task 16 the transition
   tick the hub broadcasts, and Task 17 retention/roll-ups, the batch
   op, the pack/unpack wire codec and the per-device rate cap.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  if (!ERP) return;
  const COL = (ERP.collector = {});

  COL.PROTOCOL_VERSION = 2;
  COL.CORE_MARKERS = { start: "RMM-COLLECTOR-CORE-START", end: "RMM-COLLECTOR-CORE-END" };
  COL.DEVICE_OPS = ["ping", "enroll", "heartbeat", "inventory", "metrics", "job-result", "job-start", "batch", "logs", "diagnostics", "update-result", "uninstall"];
  COL.ADMIN_OPS = ["registerToken", "revokeToken", "pushJob", "pushJobs", "pushConfig", "requestLogs", "requestSelfTest", "queueUpdate", "revokeDevice", "retryJob", "cancelJob", "reapJobs", "applyRetention", "fleet", "device", "job", "jobs", "inventory", "metrics", "logs", "diagnostics", "seedEntropy", "setAccessRole", "setAccessScopes", "setAccessCaps", "removeAccess", "listAccess", "accessCatalog", "accessCheck"];

  /* ==RMM-COLLECTOR-CORE-START==
     The shared collector core. It is intentionally dependency-free and
     synchronous: the server runtime has no crypto, no TextEncoder, no
     atob/btoa, no imports and no async, so everything it needs — UTF-8,
     base64 and SHA-256 — is implemented here. Editing this block without
     editing the copy in index.html will fail RMMCollectorTest.
     ================================================================= */
  function createCollectorCore(opts) {
    opts = opts || {};
    var CORE_VERSION = 1;
    var now = typeof opts.now === "function" ? opts.now : function () { return new Date().toISOString(); };
    var limits = Object.assign({
      maxDevices: 2000,
      maxJobsPerDevice: 200,
      maxJobScriptBytes: 262144,
      maxJobOutputBytes: 65536,
      maxInventoryBytes: 524288,
      maxMetricsSamples: 720,
      maxLogBytes: 262144,
      maxLogKeep: 10,
      maxSelfTestKeep: 20,
      maxUpdatesKeep: 20,
      heartbeatSeconds: 300,
      staleAfterMinutes: 15,
      jobDeliveryLimit: 5,
      deviceOpsPerMinute: 900,
      maxBatchOps: 32,
      rawMetricsMax: 720,
      hourlyMetricsMax: 168,
      dailyMetricsMax: 90,
      correlationMaxBytes: 400,
      jobReapLimit: 500
    }, opts.limits || {});

    /* ── UTF-8 ── */
    function utf8Encode(str) {
      str = String(str == null ? "" : str);
      var out = [];
      for (var i = 0; i < str.length; i++) {
        var c = str.charCodeAt(i);
        if (c < 128) out.push(c);
        else if (c < 2048) out.push(192 | (c >> 6), 128 | (c & 63));
        else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < str.length) {
          var c2 = str.charCodeAt(i + 1);
          if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
            var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
            out.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63));
            i++;
          } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
        } else out.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
      }
      return typeof Uint8Array !== "undefined" ? new Uint8Array(out) : out;
    }
    function utf8Decode(bytes) {
      var s = "";
      for (var i = 0; i < bytes.length;) {
        var b = bytes[i++];
        if (b < 128) s += String.fromCharCode(b);
        else if (b < 224) s += String.fromCharCode(((b & 31) << 6) | (bytes[i++] & 63));
        else if (b < 240) s += String.fromCharCode(((b & 15) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63));
        else {
          var cp = ((b & 7) << 18) | ((bytes[i++] & 63) << 12) | ((bytes[i++] & 63) << 6) | (bytes[i++] & 63);
          cp -= 0x10000;
          s += String.fromCharCode(0xD800 + (cp >> 10), 0xDC00 + (cp & 1023));
        }
      }
      return s;
    }

    /* ── base64 (server has no btoa/atob) ── */
    var B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    function b64encode(str) {
      var bytes = utf8Encode(str), out = "";
      for (var i = 0; i < bytes.length; i += 3) {
        var b0 = bytes[i], b1 = i + 1 < bytes.length ? bytes[i + 1] : 0, b2 = i + 2 < bytes.length ? bytes[i + 2] : 0;
        out += B64[b0 >> 2] + B64[((b0 & 3) << 4) | (b1 >> 4)];
        out += i + 1 < bytes.length ? B64[((b1 & 15) << 2) | (b2 >> 6)] : "=";
        out += i + 2 < bytes.length ? B64[b2 & 63] : "=";
      }
      return out;
    }
    function b64decode(b64) {
      var s = String(b64 == null ? "" : b64).replace(/[^A-Za-z0-9+/=]/g, "");
      var bytes = [];
      for (var i = 0; i < s.length; i += 4) {
        var c0 = B64.indexOf(s.charAt(i)), c1 = B64.indexOf(s.charAt(i + 1));
        var c2 = s.charAt(i + 2) === "=" ? -1 : B64.indexOf(s.charAt(i + 2));
        var c3 = s.charAt(i + 3) === "=" ? -1 : B64.indexOf(s.charAt(i + 3));
        if (c0 < 0 || c1 < 0) break;
        bytes.push((c0 << 2) | (c1 >> 4));
        if (c2 >= 0) bytes.push(((c1 & 15) << 4) | (c2 >> 2));
        if (c3 >= 0) bytes.push(((c2 & 3) << 6) | c3);
      }
      return utf8Decode(bytes);
    }

    /* ── SHA-256 (pure sync JS) ── */
    function sha256Hex(input) {
      var bytes = [];
      for (var i = 0; i < input.length; i++) {
        var c = input.charCodeAt(i);
        if (c < 128) bytes.push(c);
        else if (c < 2048) bytes.push(192 | (c >> 6), 128 | (c & 63));
        else if (c >= 0xD800 && c <= 0xDBFF && i + 1 < input.length) {
          var c2 = input.charCodeAt(i + 1);
          if (c2 >= 0xDC00 && c2 <= 0xDFFF) {
            var cp = 0x10000 + ((c - 0xD800) << 10) + (c2 - 0xDC00);
            bytes.push(240 | (cp >> 18), 128 | ((cp >> 12) & 63), 128 | ((cp >> 6) & 63), 128 | (cp & 63));
            i++;
          } else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
        } else bytes.push(224 | (c >> 12), 128 | ((c >> 6) & 63), 128 | (c & 63));
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
    }
    function ctEqual(a, b) {
      a = String(a || ""); b = String(b || "");
      if (a.length !== b.length) return false;
      var diff = 0;
      for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
      return diff === 0;
    }

    /* ── payload codec (Task 17) ──
       A tiny, dependency-free, exactly-reversible packer for JSON text.
       It replaces every *quoted string literal* that occurs more than once
       (object keys and repeated values — the bulk of an inventory or metric
       payload) with a two-character code, and prepends a dictionary. The
       server has no zlib/atob, so this is the collector's compression: the
       agent/hub may send a packed body and the receiver unpacks it here.
       Output never contains a raw 0x01 unless it is one of our codes. */
    var PACK_MARK = "\u0001";
    var PACK_SEP = "\u0002";
    var PACK_END = "\u0003";
    var PACK_CAP = 220;
    function packText(text) {
      text = String(text == null ? "" : text);
      if (text.length < 64) return text;
      var re = /"((?:[^"\\]|\\.)*)"/g;
      var counts = {}, m;
      while ((m = re.exec(text))) {
        var tok = m[0];
        if (tok.length < 5) continue;
        counts[tok] = (counts[tok] || 0) + 1;
      }
      var cands = [];
      for (var t in counts) if (counts[t] > 1) cands.push(t);
      if (!cands.length) return text;
      cands.sort(function (a, b) { return b.length - a.length; });
      cands = cands.slice(0, PACK_CAP);
      var map = {}, entries = [];
      for (var i = 0; i < cands.length; i++) {
        var code = PACK_MARK + String.fromCharCode(0x40 + i);
        map[cands[i]] = code;
        entries.push(code + cands[i]);
      }
      var body = text.replace(re, function (s) { return map[s] || s; });
      if (body.length >= text.length) return text;
      return PACK_MARK + entries.join(PACK_SEP) + PACK_END + body;
    }
    function unpackText(text) {
      text = String(text == null ? "" : text);
      if (text.charAt(0) !== PACK_MARK) return text;
      var end = text.indexOf(PACK_END, 1);
      if (end === -1) return text;
      var dict = text.slice(1, end).split(PACK_SEP);
      var map = {};
      for (var i = 0; i < dict.length; i++) {
        if (dict[i].length < 3) continue;
        map[dict[i].slice(0, 2)] = dict[i].slice(2);
      }
      var src = text.slice(end + 1), out = "";
      for (var j = 0; j < src.length;) {
        if (src.charAt(j) === PACK_MARK && j + 1 < src.length) {
          var code = src.substr(j, 2), rep = map[code];
          if (rep != null) { out += rep; j += 2; continue; }
        }
        out += src.charAt(j); j++;
      }
      return out;
    }

    /* ── ids & entropy ──
       The server runtime has no crypto, so the console tops up an entropy
       pool (admin seedEntropy) and this mixes it with time + Math.random.
       The pool is the difference between "unguessable" and "annoying". */
    var counter = 0;
    var entropy = String(opts.entropy || "");
    function seedEntropy(s) { entropy = (String(s || "") + entropy).slice(0, 8192); }
    function randomToken(n) {
      var alpha = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
      var out = "";
      for (var i = 0; i < n; i++) {
        var m = (Math.random() * 4294967296) >>> 0;
        var e = entropy.length ? entropy.charCodeAt((counter + i) % entropy.length) : 0;
        var idx = ((m ^ (e * 7) ^ (counter * 13)) >>> 0) % alpha.length;
        out += alpha[idx];
      }
      counter++;
      return out;
    }
    function newId(prefix) { return prefix + "-" + Date.now().toString(36) + randomToken(6).toLowerCase(); }
    function newDeviceId() { return "dev-" + randomToken(10).toLowerCase(); }
    function newCredential() { return "cred_" + randomToken(40); }
    function newJobId() { return "job-" + randomToken(8).toLowerCase(); }

    /* ── state ── */
    var state = {
      v: CORE_VERSION,
      createdAt: now(),
      devices: {},
      creds: {},
      tokens: {},
      jobs: {},
      inventory: {},
      metrics: {},
      logs: {},
      diagnostics: {},
      updates: {},
      config: {},
      rate: {},
      lastStatus: {},
      access: {},
      accessLog: [],
      counters: { enrollments: 0, heartbeats: 0, inventory: 0, metrics: 0, jobResults: 0, rejected: 0, rateLimited: 0 },
    };
    function load(obj) {
      if (obj && typeof obj === "object") {
        state = Object.assign({ v: CORE_VERSION, createdAt: now(), devices: {}, creds: {}, tokens: {}, jobs: {}, inventory: {}, metrics: {}, logs: {}, diagnostics: {}, updates: {}, config: {}, rate: {}, lastStatus: {}, access: {}, accessLog: [], counters: {} }, obj);
        state.v = CORE_VERSION;
      }
      return state;
    }
    function dump() { return state; }

    /* ── helpers ── */
    function isStr(x) { return typeof x === "string"; }
    function trim(x, cap) { x = x == null ? "" : String(x); return cap && x.length > cap ? x.slice(0, cap) : x; }
    function num(v, d) { var n = Number(v); return isFinite(n) ? n : (d == null ? 0 : d); }
    function bool(v) { return v === true || v === "true"; }
    function arr(v) { return Array.isArray(v) ? v : []; }

    /* ── role & access model (Task 48) ──
       Four console roles — read-only, technician, dispatcher and
       security-admin — each a fixed set of capabilities. A capability may
       also be granted or revoked per user, so the four destructive actions
       (script execution, patch denial, remote shell, file transfer) are
       gated individually rather than as one undifferentiated "admin" bit.
       Every grant is further bounded to a set of sites and/or devices.
       `authorize` is the single rule engine: the hub calls it from its
       admin RPC (`guardAdmin`), so a crafted client that skips the UI is
       still refused by the server. */
    var RMM_ROLES = ["read-only", "technician", "dispatcher", "security-admin"];
    var ROLE_DESC = {
      "read-only": "Sees the fleet, devices, inventory and metrics. Changes nothing.",
      "technician": "Works devices: diagnostics, alert work, approved scripts and patch deployment.",
      "dispatcher": "Runs the desk: schedules, routing, dispatch, config pushes and agent updates.",
      "security-admin": "Full control, including the destructive remote actions and access management."
    };
    var CAPS = {
      "fleet.view": { label: "View the fleet & devices", group: "view" },
      "device.diagnose": { label: "Request diagnostics, logs & self-tests", group: "operate" },
      "alert.work": { label: "Acknowledge, assign & resolve alerts", group: "operate" },
      "job.run": { label: "Run approved scripts & monitors", group: "operate" },
      "job.manage": { label: "Retry, cancel & requeue jobs", group: "operate" },
      "dispatch.manage": { label: "Manage schedules, routing & dispatch", group: "operate" },
      "patch.deploy": { label: "Approve & deploy patches", group: "deploy" },
      "config.push": { label: "Push agent config & queue updates", group: "deploy" },
      "enrollment.manage": { label: "Mint & revoke enrollment tokens", group: "security" },
      "device.revoke": { label: "Revoke device credentials", group: "security" },
      "script.execute": { label: "Execute arbitrary scripts & commands", group: "destructive", destructive: true },
      "patch.deny": { label: "Deny & block patches", group: "destructive", destructive: true },
      "remote.shell": { label: "Open an interactive remote shell", group: "destructive", destructive: true },
      "remote.file": { label: "Transfer files to & from devices", group: "destructive", destructive: true },
      "access.manage": { label: "Manage roles, scopes & capabilities", group: "admin" }
    };
    var DESTRUCTIVE_CAPS = ["script.execute", "patch.deny", "remote.shell", "remote.file"];
    var ROLE_CAPS = {
      "read-only": ["fleet.view"],
      "technician": ["fleet.view", "device.diagnose", "alert.work", "job.run", "patch.deploy"],
      "dispatcher": ["fleet.view", "device.diagnose", "alert.work", "job.run", "job.manage", "dispatch.manage", "patch.deploy", "config.push"],
      "security-admin": ["fleet.view", "device.diagnose", "alert.work", "job.run", "job.manage", "dispatch.manage", "patch.deploy", "config.push", "enrollment.manage", "device.revoke", "script.execute", "patch.deny", "remote.shell", "remote.file", "access.manage"]
    };
    function roleIndex(r) { return RMM_ROLES.indexOf(String(r)); }
    function baseCaps(role) {
      var list = ROLE_CAPS[role] || ROLE_CAPS["read-only"], out = {};
      for (var i = 0; i < list.length; i++) out[list[i]] = true;
      return out;
    }
    function capsFor(role, rec) {
      var out = baseCaps(role), k;
      if (rec && arr(rec.allow).length) { var a = arr(rec.allow); for (k = 0; k < a.length; k++) if (CAPS[a[k]]) out[a[k]] = true; }
      if (rec && arr(rec.deny).length) { var d = arr(rec.deny); for (k = 0; k < d.length; k++) delete out[d[k]]; }
      return out;
    }
    function derivedRole(teamRole) {
      teamRole = Number(teamRole);
      if (teamRole === 2) return "security-admin";
      if (teamRole === 1) return "dispatcher";
      return "read-only";
    }
    function resolveRole(userId, teamRole, rec) {
      if (Number(teamRole) === 2) return "security-admin"; // the owner can never be locked out
      rec = rec || state.access[String(userId || "")] || null;
      if (rec && roleIndex(rec.role) >= 0) return rec.role;
      return derivedRole(teamRole);
    }
    function scopeOf(userId, teamRole, rec) {
      if (Number(teamRole) === 2) return { all: true, sites: [], devices: [] };
      rec = rec || state.access[String(userId || "")] || null;
      if (!rec || !rec.scopes) return { all: true, sites: [], devices: [] };
      return rec.scopes;
    }
    function normalizeScopes(input) {
      input = input || {};
      if (input.all === true || (!arr(input.sites).length && !arr(input.devices).length)) return { all: true, sites: [], devices: [] };
      var seenS = {}, seenD = {}, sites = [], devices = [], i;
      var rawS = arr(input.sites);
      for (i = 0; i < rawS.length && sites.length < 200; i++) { var s1 = trim(rawS[i], 80); if (s1 && !seenS[s1]) { seenS[s1] = 1; sites.push(s1); } }
      var rawD = arr(input.devices);
      for (i = 0; i < rawD.length && devices.length < 500; i++) { var d1 = trim(rawD[i], 80); if (d1 && !seenD[d1]) { seenD[d1] = 1; devices.push(d1); } }
      return { all: false, sites: sites, devices: devices };
    }
    function inScope(scope, siteId, deviceId) {
      if (!scope || scope.all) return true;
      var sid = siteId == null ? "" : String(siteId), did = deviceId == null ? "" : String(deviceId);
      if (did && arr(scope.devices).indexOf(did) !== -1) return true;
      if (sid && arr(scope.sites).indexOf(sid) !== -1) return true;
      return false;
    }
    function minRoleFor(action) {
      for (var i = 0; i < RMM_ROLES.length; i++) if (ROLE_CAPS[RMM_ROLES[i]].indexOf(action) !== -1) return RMM_ROLES[i];
      return "security-admin";
    }
    function capForJobSource(source, explicit) {
      if (explicit && CAPS[explicit]) return explicit;
      source = String(source == null ? "" : source).toLowerCase();
      if (source.indexOf("remote-shell") === 0) return "remote.shell";
      if (source.indexOf("remote-transfer") === 0) return "remote.file";
      if (source.indexOf("patch") === 0) return "patch.deploy";
      if (source === "console" || source === "adhoc" || source === "command") return "script.execute";
      return "job.run";
    }
    function authorize(opts) {
      opts = opts || {};
      var userId = String(opts.userId == null ? "" : opts.userId);
      var action = String(opts.action == null ? "" : opts.action);
      var deviceId = opts.deviceId == null ? "" : String(opts.deviceId);
      var siteId = opts.siteId == null ? "" : String(opts.siteId);
      var teamRole = opts.teamRole == null ? -1 : Number(opts.teamRole);
      var rec = state.access[userId] || null;
      var role = resolveRole(userId, teamRole, rec);
      var out = { ok: false, userId: userId, role: role, action: action, deviceId: deviceId, siteId: siteId, requiredRole: null, destructive: false, reason: "" };
      if (!userId) { out.reason = "no_user"; return out; }
      if (!CAPS[action]) { out.reason = "unknown_action"; return out; }
      out.destructive = !!CAPS[action].destructive;
      if (!inScope(scopeOf(userId, teamRole, rec), siteId, deviceId)) { out.reason = "out_of_scope"; out.requiredRole = minRoleFor(action); return out; }
      if (!capsFor(role, Number(teamRole) === 2 ? null : rec)[action]) { out.reason = "forbidden"; out.requiredRole = minRoleFor(action); return out; }
      out.ok = true;
      return out;
    }
    function describeAuth(r) {
      if (!r) return "Not permitted.";
      if (r.ok) return "Permitted as " + r.role + ".";
      if (r.reason === "out_of_scope") return "This device or site is outside your assigned scope.";
      if (r.reason === "forbidden") return "The " + r.role + " role may not " + (CAPS[r.action] ? CAPS[r.action].label.toLowerCase() : r.action) + ".";
      if (r.reason === "no_user") return "No console identity — connect to the team hub first.";
      if (r.reason === "unknown_action") return "Unknown action.";
      return "Not permitted.";
    }
    /* Maps every collector admin action to the capability it needs. Ops that
       target devices resolve the device's site so a site-scoped grant works. */
    var ADMIN_CAP = {
      registerToken: "enrollment.manage", revokeToken: "enrollment.manage",
      pushJob: "job.run", pushJobs: "job.run", pushConfig: "config.push",
      requestLogs: "device.diagnose", requestSelfTest: "device.diagnose", queueUpdate: "config.push",
      revokeDevice: "device.revoke", retryJob: "job.manage", cancelJob: "job.manage", reapJobs: "job.manage",
      applyRetention: "config.push", seedEntropy: "config.push",
      fleet: "fleet.view", device: "fleet.view", job: "fleet.view", jobs: "fleet.view",
      inventory: "fleet.view", metrics: "fleet.view", logs: "fleet.view", diagnostics: "fleet.view",
      setAccessRole: "access.manage", setAccessScopes: "access.manage", setAccessCaps: "access.manage",
      removeAccess: "access.manage", listAccess: "access.manage", accessCheck: "fleet.view", accessCatalog: "fleet.view"
    };
    var ADMIN_DEVICE = { device: "deviceId", pushJob: "deviceId", pushConfig: "deviceId", revokeDevice: "deviceId", inventory: "deviceId", metrics: "deviceId", logs: "deviceId", diagnostics: "deviceId", accessCheck: "deviceId" };
    var ADMIN_DEVICES = { requestLogs: "deviceIds", requestSelfTest: "deviceIds", queueUpdate: "deviceIds", pushJobs: "deviceIds" };
    function guardAdmin(acting, action, payload) {
      acting = acting || {}; payload = payload || {};
      action = String(action || "");
      var base = ADMIN_CAP[action];
      if (!base) return { ok: false, error: "unknown_action", reason: "unknown_action" };
      var cap = base;
      if (action === "pushJob" || action === "pushJobs") { var job = payload.job || {}; cap = capForJobSource(job.source, job.requiredCap); }
      var targets = [], i, checked = false;
      if (ADMIN_DEVICE[action]) targets.push(String(payload[ADMIN_DEVICE[action]] || ""));
      if (ADMIN_DEVICES[action]) { var list = arr(payload[ADMIN_DEVICES[action]]); for (i = 0; i < list.length; i++) targets.push(String(list[i])); }
      for (i = 0; i < targets.length; i++) {
        var devId = targets[i];
        if (!devId) continue;
        checked = true;
        var dev = state.devices[devId];
        var r = authorize({ userId: acting.userId, teamRole: acting.teamRole, action: cap, siteId: (dev && dev.siteId) || "", deviceId: devId });
        if (!r.ok) return { ok: false, error: r.reason === "out_of_scope" ? "out_of_scope" : "forbidden", reason: r.reason, capability: cap, requiredRole: r.requiredRole, deviceId: devId, message: describeAuth(r) };
      }
      if (!checked) {
        var rr = authorize({ userId: acting.userId, teamRole: acting.teamRole, action: cap, siteId: payload.siteId, deviceId: payload.deviceId });
        if (!rr.ok) return { ok: false, error: rr.reason === "out_of_scope" ? "out_of_scope" : "forbidden", reason: rr.reason, capability: cap, requiredRole: rr.requiredRole, message: describeAuth(rr) };
      }
      return { ok: true, capability: cap, role: resolveRole(acting.userId, acting.teamRole) };
    }
    function accessRecord(userId) {
      var r = state.access[userId] || {};
      return { userId: userId, role: roleIndex(r.role) >= 0 ? r.role : null, scopes: r.scopes || { all: true, sites: [], devices: [] }, allow: arr(r.allow), deny: arr(r.deny), updatedAt: r.updatedAt || "" };
    }
    function logAccess(kind, userId, detail) {
      state.accessLog = arr(state.accessLog);
      state.accessLog.push({ at: now(), kind: String(kind || ""), userId: trim(userId, 64), detail: trim(detail, 160) });
      while (state.accessLog.length > 200) state.accessLog.shift();
    }
    function roleCatalog() {
      var out = [];
      for (var i = 0; i < RMM_ROLES.length; i++) out.push({ id: RMM_ROLES[i], label: RMM_ROLES[i], rank: i, description: ROLE_DESC[RMM_ROLES[i]] || "", capabilities: ROLE_CAPS[RMM_ROLES[i]].slice() });
      return out;
    }
    function capCatalog() {
      var out = [];
      for (var id in CAPS) out.push({ id: id, label: CAPS[id].label, group: CAPS[id].group, destructive: !!CAPS[id].destructive });
      return out;
    }

    /* ── per-device rate cap (Task 17) ──
       A compromised or misbehaving endpoint must not be able to exhaust the
       collector. Each device gets a bounded number of check-ins per minute. */
    function rateAllow(deviceId) {
      if (!deviceId) return true;
      var t = Date.now();
      var r = state.rate[deviceId];
      if (!r || t - r.t > 60000) { state.rate[deviceId] = { t: t, c: 1 }; return true; }
      r.c++;
      return r.c <= limits.deviceOpsPerMinute;
    }

    /* ── metric roll-ups (Task 17) ──
       Raw samples are bounded; each sample also folds into a running hourly
       and daily average so the collector keeps long history in a bounded
       amount of durable state. */
    function bucketKey(at, unit) {
      var t = at ? Date.parse(at) : NaN;
      var d = new Date(isFinite(t) ? t : Date.now());
      d.setUTCMinutes(0, 0, 0);
      if (unit === "day") d.setUTCHours(0, 0, 0, 0);
      return d.toISOString();
    }
    function foldAvg(entry, sample) {
      var key = entry.at;
      entry.n = num(entry.n, 0) + 1;
      for (var k in sample) {
        if (k === "at" || k === "n") continue;
        var v = sample[k];
        if (typeof v === "number" && isFinite(v)) entry[k] = entry[k] == null ? v : entry[k] + (v - entry[k]) / entry.n;
      }
      entry.at = key;
      return entry;
    }
    function foldTier(list, sample, unit, cap) {
      var key = bucketKey(sample.at || sample.t || sample.time || sample.timestamp, unit);
      var last = list.length ? list[list.length - 1] : null;
      if (last && last.at === key) foldAvg(last, sample);
      else list.push(foldAvg({ at: key, n: 0 }, sample));
      while (list.length > cap) list.shift();
      return list;
    }

    function activeCreds(deviceId) {
      var out = [];
      for (var id in state.creds) {
        var c = state.creds[id];
        if (String(c.deviceId) === String(deviceId) && !c.revokedAt) out.push(c);
      }
      return out;
    }
    function allCreds(deviceId) {
      var out = [];
      for (var id in state.creds) if (String(state.creds[id].deviceId) === String(deviceId)) out.push(state.creds[id]);
      return out;
    }
    function authenticate(deviceId, credential) {
      if (!deviceId) return { ok: false, reason: "no_device" };
      var all = allCreds(deviceId);
      if (!all.length) return { ok: false, reason: "no_credential", deviceId: deviceId };
      var active = activeCreds(deviceId);
      if (!active.length) return { ok: false, reason: "revoked", deviceId: deviceId };
      var h = sha256Hex(String(credential == null ? "" : credential));
      for (var i = 0; i < active.length; i++) {
        if (ctEqual(active[i].credentialHash, h)) {
          active[i].lastAuthAt = now();
          return { ok: true, deviceId: deviceId, providerId: active[i].providerId, credentialId: active[i].id };
        }
      }
      return { ok: false, reason: "invalid_credential", deviceId: deviceId };
    }

    function capJobOutput(text) {
      text = text == null ? "" : String(text);
      var cap = limits.maxJobOutputBytes;
      if (text.length <= cap) return text;
      return text.slice(0, cap) + "\n…[truncated " + (text.length - cap) + " chars]";
    }
    function commandLine(job) {
      var lang = job.language;
      var dir = job.workingDir || "/tmp";
      var file = "job" + (lang === "powershell" ? ".ps1" : lang === "cmd" ? ".cmd" : lang === "python" ? ".py" : ".sh");
      if (lang === "powershell") return "powershell.exe -NoProfile -NonInteractive -ExecutionPolicy Bypass -File \"" + dir + "\\" + file + "\"";
      if (lang === "cmd") return "cmd.exe /d /s /c \"" + dir + "\\" + file + "\"";
      if (lang === "bash") return "/bin/bash \"" + dir + "/" + file + "\"";
      if (lang === "sh") return "/bin/sh \"" + dir + "/" + file + "\"";
      if (lang === "python") return "python3 \"" + dir + "/" + file + "\"";
      return "\"" + dir + "/" + file + "\"";
    }

    /* ── device operations ── */

    function opPing() {
      return { ok: true, protocol: CORE_VERSION, serverTime: now(), core: "rmm-collector" };
    }

    function opEnroll(body) {
      body = body || {};
      var hash = sha256Hex(String(body.token == null ? "" : body.token));
      var tok = null, tokId = "";
      for (var id in state.tokens) {
        var t = state.tokens[id];
        if (ctEqual(t.tokenHash, hash)) { tok = t; tokId = id; break; }
      }
      if (!tok) return { ok: false, error: "invalid_token", message: "That enrollment token is not recognised." };
      if (tok.revokedAt) return { ok: false, error: "revoked_token", message: "That enrollment token has been revoked." };
      if (tok.expiresAt && Date.parse(tok.expiresAt) < Date.now()) return { ok: false, error: "expired_token", message: "That enrollment token has expired." };
      if (num(tok.uses, 0) >= num(tok.maxUses, 1)) return { ok: false, error: "used_token", message: "That enrollment token has already been used." };
      var providerId = String(body.providerId || tok.providerId || "");
      if (!providerId) return { ok: false, error: "no_provider", message: "The token is not bound to a provider." };

      tok.uses = num(tok.uses, 0) + 1;
      tok.usedAt = now();
      tok.status = tok.uses >= num(tok.maxUses, 1) ? "used" : "active";

      var deviceId = tok.deviceId || "";
      var reenroll = false;
      if (deviceId && state.devices[deviceId]) {
        reenroll = true;
        var all = allCreds(deviceId);
        for (var i = 0; i < all.length; i++) if (!all[i].revokedAt) { all[i].revokedAt = now(); all[i].status = "rotated"; }
      }
      if (!deviceId) {
        if (Object.keys(state.devices).length >= limits.maxDevices) return { ok: false, error: "at_capacity", message: "The collector is at its device capacity." };
        deviceId = newDeviceId();
      }
      var incoming = body.device && typeof body.device === "object" ? body.device : {};
      var prev = state.devices[deviceId] || {};
      var at = now();
      state.devices[deviceId] = Object.assign({}, prev, {
        deviceId: deviceId,
        providerId: providerId,
        hostname: trim(body.hostname || incoming.hostname || prev.hostname || deviceId, 200),
        siteId: tok.siteId || prev.siteId || "",
        groupIds: arr(tok.groupIds).length ? arr(tok.groupIds) : arr(prev.groupIds),
        agentVersion: trim(body.agentVersion || prev.agentVersion || "", 40),
        capabilities: arr(body.capabilities).length ? arr(body.capabilities) : arr(prev.capabilities),
        os: incoming.os || prev.os || {},
        interfaces: incoming.interfaces || prev.interfaces || [],
        listedAt: at,
        firstSeenAt: prev.firstSeenAt || at,
        enrolledAt: prev.enrolledAt || at,
        lastSeenAt: at,
        reenrolledAt: reenroll ? at : (prev.reenrolledAt || ""),
        revokedAt: "",
        uninstalledAt: "",
      });
      var plaintext = newCredential();
      var credId = newId("cred");
      state.creds[credId] = {
        id: credId, deviceId: deviceId, providerId: providerId,
        credentialHash: sha256Hex(plaintext), tokenId: tokId,
        issuedAt: at, revokedAt: "", status: "active", lastAuthAt: "",
      };
      state.counters.enrollments = num(state.counters.enrollments, 0) + 1;
      return {
        ok: true, deviceId: deviceId, providerId: providerId,
        siteId: state.devices[deviceId].siteId || null,
        groupIds: arr(state.devices[deviceId].groupIds),
        credential: plaintext, credentialId: credId, tokenId: tokId,
        reenrolled: reenroll, serverTime: at,
      };
    }

    function staleState(dev) {
      if (dev.uninstalledAt) return "retired";
      if (dev.revokedAt) return "offline";
      var last = dev.lastSeenAt ? Date.parse(dev.lastSeenAt) : 0;
      var age = Date.now() - last;
      var staleMs = limits.staleAfterMinutes * 60000;
      if (!last) return "offline";
      if (age <= staleMs) return "online";
      if (age <= staleMs * 3) return "stale";
      return "offline";
    }

    function opHeartbeat(body) {
      body = body || {};
      var auth = authenticate(body.deviceId, body.credential);
      if (!auth.ok) { state.counters.rejected = num(state.counters.rejected, 0) + 1; return { ok: false, error: auth.reason, message: auth.reason }; }
      var dev = state.devices[auth.deviceId];
      var payload = body.payload && typeof body.payload === "object" ? body.payload : {};
      var at = now();
      var serverMs = Date.parse(at);
      var interval = Math.max(30, num(payload.intervalSeconds, limits.heartbeatSeconds));
      var skew = null;
      if (payload.clientTime) { var t = Date.parse(payload.clientTime); if (isFinite(t)) skew = Math.round(((t - serverMs) / 1000) * 10) / 10; }
      var prevFp = dev.networkFingerprint || "";
      var interfaces = payload.interfaces ? arr(payload.interfaces) : dev.interfaces;
      var nextFp = fingerprint(interfaces);
      var networkChanged = !!(payload.interfaces && prevFp && nextFp && prevFp !== nextFp);

      dev.lastSeenAt = at;
      dev.status = "online";
      dev.clockSkewSeconds = skew;
      dev.agentVersion = payload.agentVersion ? trim(payload.agentVersion, 40) : dev.agentVersion;
      if (payload.capabilities) dev.capabilities = arr(payload.capabilities);
      if (payload.capabilities) dev.capabilities = arr(payload.capabilities);
      if (payload.interfaces) dev.interfaces = interfaces;
      if (payload.hostname) dev.hostname = trim(payload.hostname, 200);
      if (payload.spool && typeof payload.spool === "object") dev.spool = { pending: num(payload.spool.pending, 0), bytes: num(payload.spool.bytes, 0), oldestAt: trim(payload.spool.oldestAt, 40), updatedAt: at };
      if (nextFp) dev.networkFingerprint = nextFp;
      if (networkChanged) { dev.networkChanges = num(dev.networkChanges, 0) + 1; dev.lastNetworkChangeAt = at; }

      var cfg = Object.assign({}, state.config[auth.deviceId] || {}, {
        heartbeatSeconds: interval,
        staleAfterMinutes: limits.staleAfterMinutes,
        metricsSampleSeconds: limits.metricsSampleSeconds || 60,
      });
      var requests = dev.requests && typeof dev.requests === "object" ? dev.requests : {};
      var collectInventory = !!requests.collectInventory;
      var collectMetrics = !!requests.collectMetrics;
      if (collectInventory) requests.collectInventory = false;
      if (collectMetrics) requests.collectMetrics = false;
      var collectLogs = null;
      if (requests.collectLogs) {
        collectLogs = { requestId: requests.collectLogs.requestId, lines: num(requests.collectLogs.lines, 400) };
        delete requests.collectLogs;
      }
      var selfTest = null;
      if (requests.selfTest) { selfTest = { requestId: requests.selfTest.requestId }; delete requests.selfTest; }
      var update = requests.update ? Object.assign({}, requests.update) : null;
      if (update) delete requests.update;
      dev.requests = requests;

      var jobs = [];
      var jobIds = dev.jobIds || [];
      for (var i = 0; i < jobIds.length && jobs.length < limits.jobDeliveryLimit; i++) {
        var job = state.jobs[jobIds[i]];
        if (!job || job.state !== "queued") continue;
        if (job.expiresAt && Date.parse(job.expiresAt) < Date.now()) { job.state = "expired"; continue; }
        job.state = "delivered";
        job.deliveredAt = at;
        job.attempts = num(job.attempts, 0) + 1;
        jobs.push({
          jobId: job.id, name: job.name, language: job.language,
          script: job.script, scriptB64: b64encode(job.script), argsB64: b64encode(arr(job.args).join("\n")),
          timeoutSeconds: num(job.timeoutSeconds, 300), workingDir: job.workingDir || "",
          command: commandLine(job), attempt: job.attempts, maxAttempts: num(job.maxAttempts, 1),
        });
      }

      state.counters.heartbeats = num(state.counters.heartbeats, 0) + 1;
      return {
        ok: true, deviceId: auth.deviceId, providerId: auth.providerId,
        serverTime: at, intervalSeconds: interval,
        nextHeartbeatAt: new Date(serverMs + interval * 1000).toISOString(),
        clockSkewSeconds: skew, networkChanged: networkChanged,
        agentVersion: dev.agentVersion, capabilities: arr(dev.capabilities),
        status: staleState(dev), jobs: jobs,
        collectInventory: collectInventory, collectMetrics: collectMetrics,
        collectLogs: collectLogs, selfTest: selfTest, update: update,
        config: cfg,
      };
    }

    function fingerprint(interfaces) {
      if (!interfaces || !interfaces.length) return "";
      var parts = [];
      for (var i = 0; i < interfaces.length; i++) {
        var o = interfaces[i] || {};
        parts.push(String(o.mac || "").toLowerCase() + ":" + arr(o.ip4).map(String).sort().join("|") + ":" + (o.gateway || ""));
      }
      parts.sort();
      return parts.join(";");
    }

    function opInventory(body) {
      body = body || {};
      var auth = authenticate(body.deviceId, body.credential);
      if (!auth.ok) { state.counters.rejected = num(state.counters.rejected, 0) + 1; return { ok: false, error: auth.reason }; }
      var payload = body.payload || {};
      var size = JSON.stringify(payload).length;
      if (size > limits.maxInventoryBytes) return { ok: false, error: "too_large", message: "The inventory payload exceeds the limit." };
      var prev = state.inventory[auth.deviceId] || { revision: 0 };
      var rec = { deviceId: auth.deviceId, providerId: auth.providerId, revision: num(prev.revision, 0) + 1, receivedAt: now(), mode: trim(payload.mode || "full", 16), collectedAt: trim(payload.collectedAt || "", 40), payload: payload };
      state.inventory[auth.deviceId] = rec;
      var dev = state.devices[auth.deviceId];
      if (dev) { dev.lastInventoryAt = rec.receivedAt; dev.inventoryRevision = rec.revision; }
      state.counters.inventory = num(state.counters.inventory, 0) + 1;
      return { ok: true, revision: rec.revision, receivedAt: rec.receivedAt };
    }

    function opMetrics(body) {
      body = body || {};
      var auth = authenticate(body.deviceId, body.credential);
      if (!auth.ok) { state.counters.rejected = num(state.counters.rejected, 0) + 1; return { ok: false, error: auth.reason }; }
      var payload = body.payload || {};
      var samples = arr(payload.samples).slice(0, limits.maxMetricsSamples);
      var store = state.metrics[auth.deviceId] || { samples: [] };
      if (!arr(store.samples).length) store.samples = [];
      if (!arr(store.hourly).length) store.hourly = [];
      if (!arr(store.daily).length) store.daily = [];
      var accepted = 0;
      for (var i = 0; i < samples.length; i++) {
        var s = samples[i];
        if (!s || typeof s !== "object") continue;
        store.samples.push(s);
        foldTier(store.hourly, s, "hour", limits.hourlyMetricsMax);
        foldTier(store.daily, s, "day", limits.dailyMetricsMax);
        accepted++;
      }
      while (store.samples.length > limits.rawMetricsMax) store.samples.shift();
      store.latest = store.samples.length ? store.samples[store.samples.length - 1] : null;
      store.updatedAt = now();
      state.metrics[auth.deviceId] = store;
      var dev = state.devices[auth.deviceId];
      if (dev) dev.lastMetricsAt = store.updatedAt;
      state.counters.metrics = num(state.counters.metrics, 0) + 1;
      return { ok: true, accepted: accepted, stored: store.samples.length, hourly: store.hourly.length, daily: store.daily.length };
    }

    function opJobResult(body) {
      body = body || {};
      var auth = authenticate(body.deviceId, body.credential);
      if (!auth.ok) { state.counters.rejected = num(state.counters.rejected, 0) + 1; return { ok: false, error: auth.reason }; }
      var job = state.jobs[body.jobId];
      if (!job) return { ok: false, error: "not_found" };
      if (String(job.deviceId) !== String(auth.deviceId)) return { ok: false, error: "wrong_device" };
      if (job.state === "succeeded" || job.state === "failed" || job.state === "timed-out") return { ok: true, duplicate: true };
      var timedOut = body.timedOut === true || body.state === "timed-out";
      var ok = body.ok === true || (body.exitCode != null && num(body.exitCode, -1) === 0);
      job.state = timedOut ? "timed-out" : (ok ? "succeeded" : "failed");
      job.exitCode = body.exitCode == null ? null : num(body.exitCode, 0);
      job.stdout = capJobOutput(body.stdoutB64 ? b64decode(body.stdoutB64) : (body.stdout || ""));
      job.stderr = capJobOutput(body.stderrB64 ? b64decode(body.stderrB64) : (body.stderr || ""));
      job.error = trim(body.error || "", 400);
      job.startedAt = trim(body.startedAt || job.startedAt || "", 40);
      job.endedAt = trim(body.endedAt || now(), 40);
      job.durationMs = job.startedAt ? Math.max(0, Date.parse(job.endedAt) - Date.parse(job.startedAt)) : num(body.durationMs, 0);
      state.counters.jobResults = num(state.counters.jobResults, 0) + 1;
      var dev = state.devices[auth.deviceId];
      if (dev) {
        dev.lastJobAt = now();
        var hist = arr(dev.jobHistory); hist.push({ jobId: job.id, state: job.state, at: job.endedAt }); dev.jobHistory = hist.slice(-50);
      }
      return { ok: true, jobId: job.id, state: job.state, duplicate: false };
    }

    /* The agent reports it has begun running a job (Task 15). This makes
       `running` a real, observable state rather than an inference. */
    function opJobStart(body) {
      body = body || {};
      var auth = authenticate(body.deviceId, body.credential);
      if (!auth.ok) { state.counters.rejected = num(state.counters.rejected, 0) + 1; return { ok: false, error: auth.reason }; }
      var job = state.jobs[body.jobId];
      if (!job) return { ok: false, error: "not_found" };
      if (String(job.deviceId) !== String(auth.deviceId)) return { ok: false, error: "wrong_device" };
      if (job.state === "running") return { ok: true, jobId: job.id, state: job.state, duplicate: true };
      if (job.state !== "queued" && job.state !== "delivered") return { ok: false, error: "wrong_state", state: job.state };
      job.state = "running";
      job.startedAt = trim(body.startedAt || now(), 40);
      var dev = state.devices[auth.deviceId];
      if (dev) dev.runningJobs = num(dev.runningJobs, 0) + 1;
      return { ok: true, jobId: job.id, state: job.state };
    }

    /* A batch of device ops in one authenticated round-trip (Task 17), so a
       check-in can carry inventory + metrics + finished job results without
       three separate posts. Each inner op is authenticated and rate-checked
       exactly as if it arrived on its own. */
    function opBatch(body) {
      body = body || {};
      var ops = arr(body.ops);
      if (!ops.length) return { ok: false, error: "empty_batch" };
      if (ops.length > limits.maxBatchOps) return { ok: false, error: "batch_too_large" };
      var results = [];
      for (var i = 0; i < ops.length; i++) {
        var one = ops[i] || {};
        var op = String(one.op || "");
        if (!op || op === "batch") { results.push({ ok: false, error: "bad_op" }); continue; }
        if (!rateAllow((one.body && one.body.deviceId) || "")) { state.counters.rateLimited = num(state.counters.rateLimited, 0) + 1; results.push({ ok: false, error: "rate_limited" }); continue; }
        results.push(handle(op, one.body || {}));
      }
      return { ok: true, count: results.length, results: results };
    }

    function opLogs(body) {
      body = body || {};
      var auth = authenticate(body.deviceId, body.credential);
      if (!auth.ok) { state.counters.rejected = num(state.counters.rejected, 0) + 1; return { ok: false, error: auth.reason }; }
      var text = body.textB64 ? b64decode(body.textB64) : (body.text || "");
      text = String(text);
      if (text.length > limits.maxLogBytes) text = "…[earlier lines omitted]…\n" + text.slice(text.length - limits.maxLogBytes);
      var list = state.logs[auth.deviceId] || [];
      list.push({ requestId: trim(body.requestId || "", 60), receivedAt: now(), lines: num(body.lines, text.split("\n").length), bytes: text.length, truncated: !!body.truncated || text.length >= limits.maxLogBytes, text: text });
      while (list.length > limits.maxLogKeep) list.shift();
      state.logs[auth.deviceId] = list;
      var dev = state.devices[auth.deviceId];
      if (dev) dev.lastLogAt = now();
      return { ok: true, stored: list.length };
    }

    function opDiagnostics(body) {
      body = body || {};
      var auth = authenticate(body.deviceId, body.credential);
      if (!auth.ok) { state.counters.rejected = num(state.counters.rejected, 0) + 1; return { ok: false, error: auth.reason }; }
      var checks = arr(body.checks).map(function (c) { return { id: trim(c && c.id, 40), name: trim(c && c.name, 80), ok: !!(c && c.ok), detail: trim(c && c.detail, 300) }; }).slice(0, 32);
      var rec = { requestId: trim(body.requestId || "", 60), receivedAt: now(), ok: checks.length ? checks.every(function (c) { return c.ok; }) : body.ok === true, agentVersion: trim(body.agentVersion || "", 40), checks: checks, context: body.context || {} };
      var list = state.diagnostics[auth.deviceId] || [];
      list.push(rec);
      while (list.length > limits.maxSelfTestKeep) list.shift();
      state.diagnostics[auth.deviceId] = list;
      var dev = state.devices[auth.deviceId];
      if (dev) { dev.lastSelfTestAt = rec.receivedAt; dev.lastSelfTestOk = rec.ok; }
      return { ok: true, passed: rec.ok };
    }

    function opUpdateResult(body) {
      body = body || {};
      var auth = authenticate(body.deviceId, body.credential);
      if (!auth.ok) { state.counters.rejected = num(state.counters.rejected, 0) + 1; return { ok: false, error: auth.reason }; }
      var dev = state.devices[auth.deviceId];
      var at = now();
      var fromVersion = trim(body.fromVersion || (dev && dev.agentVersion) || "", 40);
      var version = trim(body.version || fromVersion, 40);
      var ok = body.ok !== false;
      var rolledBack = body.rolledBack === true || (!ok && body.rolledBack !== false);
      var entry = { at: at, fromVersion: fromVersion, version: rolledBack ? fromVersion : version, targetVersion: trim(body.targetVersion || "", 40), ok: ok, rolledBack: rolledBack, error: trim(body.error || "", 300) };
      if (dev) {
        if (ok && !rolledBack && version) dev.agentVersion = version;
        var hist = arr(dev.updateHistory); hist.push(entry); dev.updateHistory = hist.slice(-limits.maxUpdatesKeep);
        dev.lastUpdate = entry;
        dev.updatedAt = at;
      }
      state.updates[auth.deviceId] = entry;
      return { ok: true, state: rolledBack ? "rolled-back" : (ok ? "updated" : "failed") };
    }

    function opUninstall(body) {
      body = body || {};
      var auth = authenticate(body.deviceId, body.credential);
      if (!auth.ok) return { ok: false, error: auth.reason };
      var all = allCreds(auth.deviceId);
      for (var i = 0; i < all.length; i++) if (!all[i].revokedAt) { all[i].revokedAt = now(); all[i].status = "revoked"; }
      var dev = state.devices[auth.deviceId];
      if (dev) { dev.uninstalledAt = now(); dev.status = "uninstalled"; }
      return { ok: true, deviceId: auth.deviceId };
    }

    function handle(op, body) {
      if (op === "ping") return opPing();
      if (op === "enroll") return opEnroll(body);
      if (op === "batch") return opBatch(body);
      var deviceId = body && body.deviceId;
      if (op !== "ping" && !rateAllow(deviceId)) { state.counters.rateLimited = num(state.counters.rateLimited, 0) + 1; return { ok: false, error: "rate_limited", message: "This device is checking in too often." }; }
      if (op === "heartbeat") return opHeartbeat(body);
      if (op === "inventory") return opInventory(body);
      if (op === "metrics") return opMetrics(body);
      if (op === "job-result") return opJobResult(body);
      if (op === "job-start") return opJobStart(body);
      if (op === "logs") return opLogs(body);
      if (op === "diagnostics") return opDiagnostics(body);
      if (op === "update-result") return opUpdateResult(body);
      if (op === "uninstall") return opUninstall(body);
      return { ok: false, error: "unknown_op", message: "Unknown collector operation: " + op };
    }

    /* ── presence transitions (Task 16) ──
       Recompute every device's liveness and return any that changed since the
       last tick, so the hub can broadcast device-state changes (and an
       agent-offline alert) to open console sessions. The first tick after a
       fresh start establishes a baseline without emitting. */
    function tick() {
      var transitions = [];
      for (var id in state.devices) {
        var dev = state.devices[id];
        var status = staleState(dev);
        var prev = state.lastStatus[id];
        if (prev === undefined) { state.lastStatus[id] = status; continue; }
        if (prev !== status) {
          state.lastStatus[id] = status;
          transitions.push({ deviceId: id, providerId: dev.providerId, hostname: dev.hostname, from: prev, to: status, at: now() });
        }
      }
      return transitions;
    }

    /* ── console (admin) operations ──
       The server adapter is responsible for authenticating the admin; the
       core only enforces binding and caps. */

    function deviceSummary(dev) {
      return {
        deviceId: dev.deviceId, providerId: dev.providerId, hostname: dev.hostname,
        siteId: dev.siteId, groupIds: arr(dev.groupIds), agentVersion: dev.agentVersion,
        capabilities: arr(dev.capabilities), os: dev.os,
        firstSeenAt: dev.firstSeenAt, lastSeenAt: dev.lastSeenAt, enrolledAt: dev.enrolledAt,
        status: staleState(dev), spool: dev.spool || null,
        lastInventoryAt: dev.lastInventoryAt || "", lastMetricsAt: dev.lastMetricsAt || "",
        lastSelfTestAt: dev.lastSelfTestAt || "", lastSelfTestOk: dev.lastSelfTestOk === true,
        lastUpdate: dev.lastUpdate || null, uninstalledAt: dev.uninstalledAt || "",
      };
    }

    var admin = {
      registerToken: function (body) {
        body = body || {};
        if (!body.tokenHash) return { ok: false, error: "no_hash" };
        var id = body.id || newId("tok");
        state.tokens[id] = {
          id: id, tokenHash: String(body.tokenHash),
          providerId: String(body.providerId || ""), siteId: body.siteId ? String(body.siteId) : null,
          groupIds: arr(body.groupIds).map(String), deviceId: body.deviceId ? String(body.deviceId) : "",
          label: trim(body.label || "", 160), createdAt: now(),
          expiresAt: trim(body.expiresAt || "", 40), maxUses: Math.max(1, num(body.maxUses, 1)),
          uses: 0, revokedAt: "", status: "active",
        };
        return { ok: true, tokenId: id };
      },
      revokeToken: function (body) {
        var t = state.tokens[body && body.tokenId];
        if (!t) return { ok: false, error: "not_found" };
        t.revokedAt = now(); t.status = "revoked";
        return { ok: true };
      },
      pushJob: function (body) {
        body = body || {};
        var deviceId = String(body.deviceId || "");
        var dev = state.devices[deviceId];
        if (!dev) return { ok: false, error: "unknown_device" };
        var input = body.job || {};
        var script = String(input.script == null ? "" : input.script);
        if (!script.trim()) return { ok: false, error: "empty_script" };
        if (script.length > limits.maxJobScriptBytes) return { ok: false, error: "script_too_large" };
        var ids = dev.jobIds || [];
        if (ids.length >= limits.maxJobsPerDevice) return { ok: false, error: "at_capacity" };
        var id = input.id || newJobId();
        state.jobs[id] = {
          id: id, deviceId: deviceId, providerId: dev.providerId,
          name: trim(input.name || "Ad-hoc command", 160), language: trim(input.language || "powershell", 24),
          script: script, args: arr(input.args).map(function (a) { return trim(a, 200); }),
          timeoutSeconds: Math.max(10, num(input.timeoutSeconds, 300)), workingDir: trim(input.workingDir || "", 240),
          state: "queued", attempts: 0, maxAttempts: Math.max(1, num(input.maxAttempts, 2)),
          createdAt: now(), deliveredAt: "", startedAt: "", endedAt: "",
          expiresAt: trim(input.expiresAt || new Date(Date.now() + 1440 * 60000).toISOString(), 40),
          source: trim(input.source || "console", 80),
          ref: trim(input.ref || "", 80),
          correlation: trim(input.correlation || "", limits.correlationMaxBytes),
        };
        ids.push(id); dev.jobIds = ids;
        return { ok: true, jobId: id };
      },
      pushJobs: function (body) {
        body = body || {};
        var deviceIds = arr(body.deviceIds);
        if (!deviceIds.length) return { ok: false, error: "no_targets" };
        var results = [], queued = 0;
        for (var i = 0; i < deviceIds.length; i++) {
          var one = this.pushJob({ deviceId: deviceIds[i], job: body.job || {} });
          if (one.ok) queued++;
          results.push({ deviceId: String(deviceIds[i]), ok: one.ok === true, jobId: one.jobId || "", error: one.error || "" });
        }
        return { ok: true, queued: queued, skipped: results.length - queued, results: results };
      },
      pushConfig: function (body) {
        body = body || {};
        if (!body.deviceId) return { ok: false, error: "no_device" };
        state.config[String(body.deviceId)] = Object.assign({}, state.config[String(body.deviceId)] || {}, body.config || {});
        return { ok: true };
      },
      requestLogs: function (body) {
        body = body || {};
        var n = 0;
        for (var i = 0; i < arr(body.deviceIds).length; i++) {
          var dev = state.devices[String(body.deviceIds[i])];
          if (!dev) continue;
          dev.requests = dev.requests || {};
          dev.requests.collectLogs = { requestId: body.requestId || newId("log"), lines: Math.max(20, num(body.lines, 400)), requestedAt: now() };
          n++;
        }
        return { ok: true, queued: n };
      },
      requestSelfTest: function (body) {
        body = body || {};
        var n = 0;
        for (var i = 0; i < arr(body.deviceIds).length; i++) {
          var dev = state.devices[String(body.deviceIds[i])];
          if (!dev) continue;
          dev.requests = dev.requests || {};
          dev.requests.selfTest = { requestId: body.requestId || newId("st"), requestedAt: now() };
          n++;
        }
        return { ok: true, queued: n };
      },
      queueUpdate: function (body) {
        body = body || {};
        var n = 0;
        for (var i = 0; i < arr(body.deviceIds).length; i++) {
          var dev = state.devices[String(body.deviceIds[i])];
          if (!dev) continue;
          dev.requests = dev.requests || {};
          dev.requests.update = Object.assign({ requestId: newId("upd"), requestedAt: now() }, body.update || {});
          n++;
        }
        return { ok: true, queued: n };
      },
      revokeDevice: function (body) {
        body = body || {};
        var deviceId = String(body.deviceId || "");
        var all = allCreds(deviceId);
        for (var i = 0; i < all.length; i++) if (!all[i].revokedAt) { all[i].revokedAt = now(); all[i].status = "revoked"; }
        var dev = state.devices[deviceId];
        if (dev) dev.revokedAt = now();
        return { ok: true, revoked: all.length };
      },

      /* ── job queue & dispatch (Task 15) ── */

      retryJob: function (body) {
        body = body || {};
        var job = state.jobs[body.jobId];
        if (!job) return { ok: false, error: "not_found" };
        var terminal = ["succeeded", "failed", "timed-out", "expired", "cancelled"];
        if (terminal.indexOf(job.state) === -1) return { ok: false, error: "not_terminal", state: job.state };
        if (num(job.attempts, 0) >= num(job.maxAttempts, 1)) return { ok: false, error: "attempts_exhausted" };
        job.state = "queued";
        job.deliveredAt = ""; job.startedAt = ""; job.endedAt = "";
        job.exitCode = null; job.stdout = ""; job.stderr = ""; job.error = "";
        job.retriedAt = now();
        job.expiresAt = new Date(Date.now() + 1440 * 60000).toISOString();
        var dev = state.devices[job.deviceId];
        if (dev) { var ids = dev.jobIds || []; if (ids.indexOf(job.id) === -1) { ids.push(job.id); dev.jobIds = ids; } }
        return { ok: true, jobId: job.id, state: job.state };
      },

      cancelJob: function (body) {
        body = body || {};
        var job = state.jobs[body.jobId];
        if (!job) return { ok: false, error: "not_found" };
        var terminal = ["succeeded", "failed", "timed-out", "expired", "cancelled"];
        if (terminal.indexOf(job.state) === -1) { job.state = "cancelled"; job.cancelledAt = now(); job.endedAt = now(); job.error = "Cancelled from the console."; }
        return { ok: true, jobId: job.id, state: job.state };
      },

      /* Requeue delivered-but-never-started runs, time out over-runners,
         expire stale queues and prune past-retention terminal jobs. */
      reapJobs: function (body) {
        body = body || {};
        var providerId = body.providerId ? String(body.providerId) : "";
        var nowMs = Date.now();
        var deliveryMs = Math.max(1, num(body.deliveryTimeoutMinutes, 30)) * 60000;
        var retentionMs = Math.max(1, num(body.retentionHours, 168)) * 3600000;
        var out = { requeued: 0, timedOut: 0, expired: 0, pruned: 0, scanned: 0 };
        for (var id in state.jobs) {
          var job = state.jobs[id];
          if (providerId && String(job.providerId) !== providerId) continue;
          out.scanned++;
          if (job.state === "delivered" && job.deliveredAt && nowMs - Date.parse(job.deliveredAt) > deliveryMs) {
            if (num(job.attempts, 0) < num(job.maxAttempts, 1)) { job.state = "queued"; job.deliveredAt = ""; out.requeued++; }
            else { job.state = "timed-out"; job.endedAt = now(); job.error = "The agent did not start the job before the delivery window closed."; out.timedOut++; }
          } else if (job.state === "running" && job.startedAt && nowMs - Date.parse(job.startedAt) > num(job.timeoutSeconds, 300) * 2000) {
            job.state = "timed-out"; job.endedAt = now(); job.error = "The job exceeded its timeout and was abandoned."; out.timedOut++;
          } else if (job.state === "queued" && job.expiresAt && Date.parse(job.expiresAt) < nowMs) {
            job.state = "expired"; job.endedAt = now(); job.error = "The job expired before it was delivered."; out.expired++;
          } else if (["succeeded", "failed", "timed-out", "expired", "cancelled"].indexOf(job.state) !== -1 && job.endedAt && nowMs - Date.parse(job.endedAt) > retentionMs) {
            delete state.jobs[id];
            for (var d in state.devices) { var ids = state.devices[d].jobIds; if (ids) { var i = ids.indexOf(id); if (i >= 0) ids.splice(i, 1); } }
            out.pruned++;
            continue;
          }
        }
        return Object.assign({ ok: true }, out);
      },

      /* Retention & scale (Task 17): bound every durable per-device region. */
      applyRetention: function (body) {
        body = body || {};
        var p = {
          rawMax: Math.max(1, num(body.rawMax, limits.rawMetricsMax)),
          hourlyMax: Math.max(1, num(body.hourlyMax, limits.hourlyMetricsMax)),
          dailyMax: Math.max(1, num(body.dailyMax, limits.dailyMetricsMax)),
          logKeep: Math.max(1, num(body.logKeep, limits.maxLogKeep)),
          selfTestKeep: Math.max(1, num(body.selfTestKeep, limits.maxSelfTestKeep)),
          updateKeep: Math.max(1, num(body.updateKeep, limits.maxUpdatesKeep)),
          historyKeep: Math.max(1, num(body.historyKeep, 50)),
          jobRetentionMs: Math.max(1, num(body.jobRetentionHours, 168)) * 3600000
        };
        var out = { metrics: 0, logs: 0, diagnostics: 0, updates: 0, jobs: 0, history: 0, inventory: 0 };
        for (var m in state.metrics) {
          var store = state.metrics[m];
          if (arr(store.samples).length > p.rawMax) { store.samples.splice(0, store.samples.length - p.rawMax); out.metrics++; }
          if (arr(store.hourly).length > p.hourlyMax) { store.hourly.splice(0, store.hourly.length - p.hourlyMax); out.metrics++; }
          if (arr(store.daily).length > p.dailyMax) { store.daily.splice(0, store.daily.length - p.dailyMax); out.metrics++; }
        }
        for (var l in state.logs) { var before = arr(state.logs[l]).length; if (before > p.logKeep) { state.logs[l] = state.logs[l].slice(before - p.logKeep); out.logs += before - p.logKeep; } }
        for (var g in state.diagnostics) { var b2 = arr(state.diagnostics[g]).length; if (b2 > p.selfTestKeep) { state.diagnostics[g] = state.diagnostics[g].slice(b2 - p.selfTestKeep); out.diagnostics += b2 - p.selfTestKeep; } }
        var nowMs = Date.now();
        for (var id in state.devices) {
          var dev = state.devices[id];
          if (arr(dev.jobHistory).length > p.historyKeep) { dev.jobHistory = dev.jobHistory.slice(-p.historyKeep); out.history++; }
          if (arr(dev.updateHistory).length > p.updateKeep) { dev.updateHistory = dev.updateHistory.slice(-p.updateKeep); out.updates++; }
          if (arr(dev.custom && dev.custom.networkHistory).length > p.historyKeep) { dev.custom.networkHistory = dev.custom.networkHistory.slice(-p.historyKeep); out.history++; }
          if (dev.uninstalledAt && nowMs - Date.parse(dev.uninstalledAt) > p.jobRetentionMs) { delete state.inventory[id]; delete state.metrics[id]; out.inventory++; }
        }
        for (var jid in state.jobs) {
          var job = state.jobs[jid];
          if (["succeeded", "failed", "timed-out", "expired", "cancelled"].indexOf(job.state) !== -1 && job.endedAt && nowMs - Date.parse(job.endedAt) > p.jobRetentionMs) { delete state.jobs[jid]; out.jobs++; }
        }
        return Object.assign({ ok: true }, out);
      },

      job: function (body) {
        var job = state.jobs[body && body.jobId];
        return job ? { ok: true, job: job } : { ok: false, error: "not_found" };
      },
      fleet: function (body) {
        body = body || {};
        var out = [];
        for (var id in state.devices) {
          var dev = state.devices[id];
          if (body.providerId && String(dev.providerId) !== String(body.providerId)) continue;
          out.push(deviceSummary(dev));
        }
        var counts = { total: out.length, online: 0, stale: 0, offline: 0, retired: 0 };
        for (var i = 0; i < out.length; i++) if (counts[out[i].status] != null) counts[out[i].status]++;
        return { ok: true, devices: out, counts: counts };
      },
      device: function (body) {
        var dev = state.devices[body && body.deviceId];
        if (!dev) return { ok: false, error: "not_found" };
        return { ok: true, device: deviceSummary(dev), requests: dev.requests || {}, jobIds: arr(dev.jobIds), updateHistory: arr(dev.updateHistory) };
      },
      jobs: function (body) {
        body = body || {};
        var out = [];
        for (var id in state.jobs) {
          var j = state.jobs[id];
          if (body.deviceId && String(j.deviceId) !== String(body.deviceId)) continue;
          if (body.providerId && String(j.providerId) !== String(body.providerId)) continue;
          if (body.state && j.state !== body.state) continue;
          if (body.correlation && String(j.correlation) !== String(body.correlation)) continue;
          if (body.ref && String(j.ref) !== String(body.ref)) continue;
          out.push(j);
        }
        out.sort(function (a, b) { return (b.createdAt || "").localeCompare(a.createdAt || ""); });
        return { ok: true, jobs: out.slice(0, 500) };
      },
      inventory: function (body) {
        var rec = state.inventory[body && body.deviceId];
        return rec ? { ok: true, inventory: rec } : { ok: false, error: "not_found" };
      },
      metrics: function (body) {
        var rec = state.metrics[body && body.deviceId];
        return rec ? { ok: true, metrics: rec } : { ok: false, error: "not_found" };
      },
      logs: function (body) {
        return { ok: true, logs: state.logs[body && body.deviceId] || [] };
      },
      diagnostics: function (body) {
        return { ok: true, diagnostics: state.diagnostics[body && body.deviceId] || [] };
      },
      seedEntropy: function (body) {
        seedEntropy(body && body.entropy);
        return { ok: true, pool: entropy.length };
      },

      /* ── role & access (Task 48) ── */

      setAccessRole: function (body) {
        body = body || {};
        var userId = trim(body.userId, 64);
        if (!userId) return { ok: false, error: "no_user" };
        if (roleIndex(body.role) < 0) return { ok: false, error: "bad_role" };
        var rec = state.access[userId] || (state.access[userId] = { userId: userId, createdAt: now() });
        rec.role = String(body.role);
        rec.updatedAt = now();
        logAccess("role", userId, rec.role);
        return { ok: true, userId: userId, role: rec.role };
      },
      setAccessScopes: function (body) {
        body = body || {};
        var userId = trim(body.userId, 64);
        if (!userId) return { ok: false, error: "no_user" };
        var rec = state.access[userId] || (state.access[userId] = { userId: userId, createdAt: now() });
        rec.scopes = normalizeScopes(body.scopes);
        rec.updatedAt = now();
        logAccess("scopes", userId, rec.scopes.all ? "all sites & devices" : rec.scopes.sites.length + " site(s), " + rec.scopes.devices.length + " device(s)");
        return { ok: true, userId: userId, scopes: rec.scopes };
      },
      setAccessCaps: function (body) {
        body = body || {};
        var userId = trim(body.userId, 64);
        if (!userId) return { ok: false, error: "no_user" };
        var rec = state.access[userId] || (state.access[userId] = { userId: userId, createdAt: now() });
        var allow = [], deny = [], i;
        var rawA = arr(body.allow);
        for (i = 0; i < rawA.length; i++) { var a = String(rawA[i]); if (CAPS[a] && allow.indexOf(a) === -1) allow.push(a); }
        var rawD = arr(body.deny);
        for (i = 0; i < rawD.length; i++) { var d = String(rawD[i]); if (CAPS[d] && allow.indexOf(d) === -1 && deny.indexOf(d) === -1) deny.push(d); }
        rec.allow = allow; rec.deny = deny;
        rec.updatedAt = now();
        logAccess("capabilities", userId, "+" + allow.length + " / -" + deny.length);
        return { ok: true, userId: userId, allow: allow, deny: deny };
      },
      removeAccess: function (body) {
        var userId = trim((body || {}).userId, 64);
        if (!userId) return { ok: false, error: "no_user" };
        if (state.access[userId]) { delete state.access[userId]; logAccess("remove", userId, ""); return { ok: true, userId: userId, removed: true }; }
        return { ok: true, userId: userId, removed: false };
      },
      listAccess: function () {
        var users = [], id;
        for (id in state.access) users.push(accessRecord(id));
        users.sort(function (a, b) { return String(a.userId).localeCompare(String(b.userId)); });
        return { ok: true, users: users, roles: roleCatalog(), log: arr(state.accessLog).slice(-50) };
      },
      accessCatalog: function () { return { ok: true, roles: roleCatalog(), capabilities: capCatalog(), destructive: DESTRUCTIVE_CAPS.slice() }; },
      accessCheck: function (body) {
        var r = authorize(body || {});
        return Object.assign({ error: r.ok ? "" : r.reason, message: describeAuth(r) }, r);
      },
    };

    return {
      CORE_VERSION: CORE_VERSION,
      handle: handle,
      admin: admin,
      load: load,
      dump: dump,
      state: function () { return state; },
      limits: limits,
      seedEntropy: seedEntropy,
      sha256Hex: sha256Hex,
      b64encode: b64encode,
      b64decode: b64decode,
      utf8Encode: utf8Encode,
      utf8Decode: utf8Decode,
      packText: packText,
      unpackText: unpackText,
      staleState: staleState,
      summary: function (deviceId) { var d = state.devices[deviceId]; return d ? deviceSummary(d) : null; },
      tick: tick,
      /* role & access (Task 48) */
      authorize: authorize,
      guardAdmin: guardAdmin,
      resolveRole: resolveRole,
      capsFor: capsFor,
      scopeOf: scopeOf,
      inScope: inScope,
      capForJobSource: capForJobSource,
      roles: RMM_ROLES.slice(),
      roleCaps: ROLE_CAPS,
      rolesCatalog: roleCatalog,
      capabilities: capCatalog,
      caps: CAPS,
      destructiveCaps: DESTRUCTIVE_CAPS.slice(),
      minRoleFor: minRoleFor,
      describeAuth: describeAuth,
    };
  }
  /* ==RMM-COLLECTOR-CORE-END== */

  COL.createCore = createCollectorCore;
  COL.CORE_VERSION = 2;

  /* ── payload codec (Task 17) ──
     The same pack/unpack the server runs, so a large device body or admin
     payload can travel compressed and be inflated by the hub. */
  COL.packText = function (text) { return COL.localCore().packText(text); };
  COL.unpackText = function (text) { return COL.localCore().unpackText(text); };
  COL.PACK_THRESHOLD = 4096;

  /* Pack a body only when it is big enough for the compression to pay for
     itself; small control messages travel as plain objects. */
  function wireBody(body) {
    if (body == null || typeof body !== "object") return body;
    try {
      const json = JSON.stringify(body);
      if (json.length < COL.PACK_THRESHOLD) return body;
      const packed = COL.localCore().packText(json);
      return packed.length < json.length ? packed : body;
    } catch (e) { return body; }
  }

  /* ─────────────────────── admin password gate ─────────────────────── */

  /* The collector hub embeds the SHA-256 of a high-entropy password the
     user keeps; the console prompts for it (never prefilled) and the hub
     rate-limits failed attempts per network group. */
  COL.adminUnlock = async function (password) {
    const t = COL.transport();
    if (!t) return { ok: false, error: "no_socket", message: "The collector is not reachable." };
    try {
      const res = JSON.parse(await t.rpc("collectorAuth", JSON.stringify({ password: String(password == null ? "" : password) })));
      return res;
    } catch (e) { return { ok: false, error: "transport", message: String(e && e.message || e) }; }
  };

  /* ─────────────────────── transport ─────────────────────── */

  let transport = null;

  function socketFactory() {
    if (typeof ERP.createServerSocket === "function") return ERP.createServerSocket;
    try { if (typeof window !== "undefined" && window.root && typeof window.root.createServerSocket === "function") return window.root.createServerSocket; } catch (e) {}
    try { if (typeof window !== "undefined" && typeof window.createServerSocket === "function") return window.createServerSocket; } catch (e) {}
    try { if (typeof root !== "undefined" && typeof root.createServerSocket === "function") return root.createServerSocket; } catch (e) {}
    return null;
  }

  function defaultTransport() {
    const mk = socketFactory();
    if (!mk) return null;
    let socket = null;
    let state = "idle";
    const pending = [];
    function ensure() {
      if (socket) return socket;
      try { socket = mk(); } catch (e) { socket = null; }
      if (!socket) return null;
      state = "connecting";
      socket.addEventListener("open", () => { state = "open"; while (pending.length) { try { pending.shift()(); } catch (e) {} } });
      socket.addEventListener("close", () => { state = "closed"; socket = null; });
      socket.addEventListener("error", () => { state = "closed"; });
      return socket;
    }
    const ready = () => new Promise((resolve, reject) => {
      const s = ensure();
      if (!s) return reject(new Error("no socket"));
      if (state === "open") return resolve(s);
      pending.push(() => resolve(s));
      setTimeout(() => { if (state !== "open") reject(new Error("collector connect timed out")); }, 8000);
    });
    return {
      kind: "socket",
      status: () => state,
      ready,
      async rpc(method, payload) {
        const s = await ready();
        return s.rpc[method](payload);
      },
      send(obj) { const s = ensure(); if (s && state === "open") s.send(JSON.stringify(obj)); },
    };
  }

  COL.setTransport = function (t) { transport = t; return COL; };
  COL.transport = function () {
    if (transport) return transport;
    if (!socketFactory()) return null;
    transport = defaultTransport();
    return transport;
  };
  COL.status = function () {
    const t = COL.transport();
    return { available: !!t, mode: t ? t.kind : "none", state: t ? t.status() : "unavailable" };
  };

  async function deviceOp(op, body) {
    const t = COL.transport();
    if (t) {
      try {
        const res = JSON.parse(await t.rpc("collectorDevice", JSON.stringify({ op, body: wireBody(body) })));
        if (res && res.__collector !== false) return res;
      } catch (e) { /* fall through to the local core */ }
    }
    const core = COL.localCore();
    return core.handle(op, body);
  }
  COL.deviceOp = deviceOp;

  async function adminOp(action, body) {
    const t = COL.transport();
    if (t) {
      try {
        const res = JSON.parse(await t.rpc("collectorAdmin", JSON.stringify({ action, payload: wireBody(body) })));
        return res;
      } catch (e) { /* fall through */ }
    }
    const core = COL.localCore();
    if (!core.admin[action]) return { ok: false, error: "unknown_action" };
    return core.admin[action](body || {});
  }
  COL.admin = adminOp;

  /* A local core used by the console/simulator and as degraded mode when
     the hub is unreachable. It is the same implementation the server runs. */
  let local = null;
  COL.localCore = function () { if (!local) local = createCollectorCore({ entropy: String(Date.now()) + Math.random() }); return local; };
  COL.resetLocal = function () { local = null; return COL.localCore(); };

  /* Seed the hub's entropy pool from the browser's CSPRNG so its minted
     credentials are not merely Math.random-guessable. */
  COL.seedEntropy = async function () {
    let entropy = "";
    try {
      const a = new Uint8Array(48);
      (window.crypto || {}).getRandomValues ? window.crypto.getRandomValues(a) : null;
      entropy = Array.prototype.map.call(a, (x) => ("0" + x.toString(16)).slice(-2)).join("");
    } catch (e) { entropy = String(Date.now()) + Math.random(); }
    try { return await adminOp("seedEntropy", { entropy }); } catch (e) { return { ok: false }; }
  };

  /* ─────────────────────── console helpers ─────────────────────── */

  /* Push a job to one or many devices through the collector. */
  COL.pushJob = async function (opts) {
    opts = opts || {};
    const ids = [...new Set((opts.deviceIds || []).map(String).filter(Boolean))];
    if (!ids.length) return { error: "no_targets" };
    const results = [];
    for (const deviceId of ids) results.push(Object.assign({ deviceId }, await adminOp("pushJob", { deviceId, job: opts.job || {} })));
    return { ok: results.some((r) => r.ok), queued: results.filter((r) => r.ok).length, results };
  };

  COL.pushConfig = (deviceId, config) => adminOp("pushConfig", { deviceId, config });
  COL.requestLogs = (deviceIds, lines) => adminOp("requestLogs", { deviceIds: [].concat(deviceIds), lines });
  COL.requestSelfTest = (deviceIds) => adminOp("requestSelfTest", { deviceIds: [].concat(deviceIds) });
  COL.queueUpdate = (deviceIds, update) => adminOp("queueUpdate", { deviceIds: [].concat(deviceIds), update });
  COL.revokeDevice = (deviceId) => adminOp("revokeDevice", { deviceId });
  COL.fleet = (providerId) => adminOp("fleet", { providerId });
  COL.device = (deviceId) => adminOp("device", { deviceId });
  COL.jobs = (opts) => adminOp("jobs", opts || {});
  COL.inventory = (deviceId) => adminOp("inventory", { deviceId });
  COL.metrics = (deviceId) => adminOp("metrics", { deviceId });
  COL.logs = (deviceId) => adminOp("logs", { deviceId });
  COL.diagnostics = (deviceId) => adminOp("diagnostics", { deviceId });
  COL.retryJob = (jobId) => adminOp("retryJob", { jobId });
  COL.cancelJob = (jobId) => adminOp("cancelJob", { jobId });
  COL.reapJobs = (opts) => adminOp("reapJobs", opts || {});
  COL.applyRetention = (opts) => adminOp("applyRetention", opts || {});
  COL.job = (jobId) => adminOp("job", { jobId });

  COL.init = function () { return COL; };
})();
