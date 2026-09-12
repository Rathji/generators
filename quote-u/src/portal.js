// ============================================================================
// quote-u — tokenized portal routes, proxy-aware IP handling, rate limiting and
// the portal API namespace (roadmap task 23)
// ----------------------------------------------------------------------------
// The client portal is a SEPARATE, tokenized regime: no internal login and no
// station chrome. A client reaches it at the hash route
//
//     #/q/<secret>
//
// and the page talks to one logical "portal API namespace" (`/api/portal/...`).
// This module owns the transport-neutral plumbing every portal surface shares:
//
//   • route parsing   — isPortalRoute / secretFromHash / routeFor / parseHash
//   • proxy-aware IP  — resolveIp() honors x-forwarded-for, x-real-ip and
//                       cf-connecting-ip before the socket peer, skipping any
//                       hop that is not a syntactically valid IP. With no
//                       trust declaration it takes the LAST hop (the address
//                       the nearest trusted proxy appended) rather than the
//                       left-most, so a client cannot spoof its rate-limit key
//                       by prepending a fake x-forwarded-for entry.
//   • rate limiting   — a sliding-window limiter keyed by IP and, once a token
//                       is authenticated, by token id as well. It runs BEFORE
//                       any handler, so no handler can be reached unmetered.
//   • the dispatcher  — createApi() maps "METHOD /path" to a handler and is
//                       DEFAULT-DENY: an unknown path, an unknown method, or a
//                       missing/invalid token all return 404, so a probe can
//                       never tell a live route or token from a fake one. A
//                       token that IS valid but dead (revoked/expired/used)
//                       returns 410 — the caller already held the secret, so
//                       this leaks nothing an attacker did not have.
//
// The client is never the authority on anything that matters: tokens are
// verified (locally and by the server plugin) and approval transitions go
// through QU_LIFECYCLE.applyChecked (server-validated). This module only
// guarantees a request was authenticated and rate-limited before it reached a
// handler.
// ============================================================================
window.QU_PORTAL = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const ROUTE_PREFIX = "#/q/";
  const PAGE_STATION = "q";
  const API_NAMESPACE = "/api/portal";
  const DEFAULT_IP_RATE = { window_ms: 60000, max: 120 };
  const DEFAULT_TOKEN_RATE = { window_ms: 60000, max: 60 };

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  // ------------------------------------------------------------- route parsing

  function pathOf(hash) {
    return String(hash === undefined || hash === null ? "" : hash)
      .replace(/^#/, "")
      .replace(/^\/+/, "");
  }

  // Parse a hash into either { portal:true, secret } or { portal:false, parts }.
  function parseHash(hash) {
    const h = pathOf(hash);
    if (!h) return { portal: false, parts: [] };
    const parts = h.split("/").filter(Boolean);
    if (parts[0] !== PAGE_STATION) return { portal: false, parts };
    const raw = parts.slice(1).join("/");
    let secret = raw;
    try { secret = decodeURIComponent(raw); } catch (e) { secret = raw; }
    return { portal: true, secret: secret || "", parts };
  }

  function isPortalRoute(hash) {
    return parseHash(hash).portal === true;
  }

  function secretFromHash(hash) {
    const p = parseHash(hash);
    if (!p.portal) return null;
    return p.secret || "";
  }

  function routeFor(secret) {
    return ROUTE_PREFIX + encodeURIComponent(secret === undefined || secret === null ? "" : String(secret));
  }

  // --------------------------------------------------------- proxy-aware IP

  const IPV4_RE = /^(\d{1,3}(?:\.\d{1,3}){3})$/;

  // Normalize a single hop to a bare IP, or return null when it is not one.
  function normalizeIp(raw) {
    if (raw === undefined || raw === null) return null;
    let s = String(raw).trim();
    if (!s) return null;
    // Bracketed IPv6, optionally with a port: [2001:db8::1]:443
    const bracket = s.match(/^\[([^\]]+)\](?::\d+)?$/);
    if (bracket) s = bracket[1];
    const v4 = s.match(IPV4_RE);
    if (v4) {
      const octets = v4[1].split(".").map(Number);
      if (octets.some(n => n > 255)) return null;
      return v4[1];
    }
    // IPv4 with a port (1.2.3.4:5678) — but only when the whole string is that.
    const v4port = s.match(/^(\d{1,3}(?:\.\d{1,3}){3}):\d+$/);
    if (v4port) {
      const octets = v4port[1].split(".").map(Number);
      if (octets.some(n => n > 255)) return null;
      return v4port[1];
    }
    // IPv6 (with or without a zone id)
    const v6 = s.replace(/%[0-9a-z]+$/i, "").toLowerCase();
    if (v6.indexOf(":") !== -1 && /^[0-9a-f:]+$/.test(v6) && v6.split(":").length <= 8) return v6;
    return null;
  }

  function headerValue(headers, name) {
    if (!headers) return null;
    if (typeof headers.get === "function") {
      try { return headers.get(name); } catch (e) { return null; }
    }
    const lower = String(name).toLowerCase();
    for (const k of Object.keys(headers)) {
      if (String(k).toLowerCase() === lower) return headers[k];
    }
    return null;
  }

  // Resolve the client IP from request metadata. `opts.trustedProxies` is the
  // number of proxies in front of the app that are trusted to append to
  // x-forwarded-for (default 0 → take the right-most hop, the one the nearest
  // trusted proxy wrote). Returns { ip, source }.
  function resolveIp(meta, opts) {
    meta = meta || {};
    opts = opts || {};
    const trusted = Number.isFinite(Number(opts.trustedProxies)) ? Math.max(0, Number(opts.trustedProxies)) : 0;
    const headers = meta.headers || meta.header || null;

    const xff = headerValue(headers, "x-forwarded-for");
    if (xff !== undefined && xff !== null && String(xff).trim()) {
      const hops = String(xff).split(",").map(h => normalizeIp(h)).filter(Boolean);
      if (hops.length) {
        const idx = Math.max(0, hops.length - 1 - trusted);
        return { ip: hops[idx], source: "x-forwarded-for", hops: hops.length };
      }
    }
    const xri = normalizeIp(headerValue(headers, "x-real-ip"));
    if (xri) return { ip: xri, source: "x-real-ip" };
    const cf = normalizeIp(headerValue(headers, "cf-connecting-ip"));
    if (cf) return { ip: cf, source: "cf-connecting-ip" };
    const peer = normalizeIp(meta.remote_addr) || normalizeIp(meta.remoteAddress) || normalizeIp(meta.ip);
    if (peer) return { ip: peer, source: "socket" };
    return { ip: "unknown", source: "unknown" };
  }

  // ------------------------------------------------------------- rate limiting

  // A sliding-window limiter: at most `max` admitted hits per `window_ms` for a
  // key. Pure in-memory (the portal is edge-metered); deterministic given `at`.
  function createRateLimiter(opts) {
    opts = opts || {};
    const windowMs = Number.isFinite(Number(opts.window_ms)) && Number(opts.window_ms) > 0 ? Number(opts.window_ms) : 60000;
    const max = Number.isFinite(Number(opts.max)) && Number(opts.max) > 0 ? Number(opts.max) : 60;
    const maxKeys = Number.isFinite(Number(opts.max_keys)) ? Number(opts.max_keys) : 10000;
    const hits = new Map();

    function atMs(at) {
      if (at === undefined || at === null) return Date.now();
      if (typeof at === "number") return at;
      const t = Date.parse(at);
      return isNaN(t) ? Date.now() : t;
    }

    function check(key, at) {
      const t = atMs(at);
      let arr = hits.get(key) || [];
      const cutoff = t - windowMs;
      let drop = 0;
      while (drop < arr.length && arr[drop] <= cutoff) drop++;
      if (drop) arr = arr.slice(drop);
      if (arr.length >= max) {
        if (arr.length) hits.set(key, arr);
        const retry = Math.max(0, arr[0] + windowMs - t);
        return { allowed: false, remaining: 0, count: arr.length, retry_after_ms: retry, window_ms: windowMs, max };
      }
      arr = arr.concat([t]);
      hits.set(key, arr);
      if (hits.size > maxKeys) {
        const oldest = hits.keys().next().value;
        if (oldest !== undefined && oldest !== key) hits.delete(oldest);
      }
      return { allowed: true, remaining: Math.max(0, max - arr.length), count: arr.length, retry_after_ms: 0, window_ms: windowMs, max };
    }

    function reset(key) {
      if (key === undefined) hits.clear();
      else hits.delete(key);
    }

    function snapshot() {
      const out = {};
      hits.forEach((v, k) => { out[k] = v.length; });
      return out;
    }

    return { check, reset, snapshot, window_ms: windowMs, max, size: () => hits.size };
  }

  // -------------------------------------------------------------- the API

  function statusForToken(code) {
    if (code === "revoked" || code === "expired" || code === "used") return 410;
    return 404; // not_found | bad_secret | hash_mismatch | anything else — deny
  }

  function noStore(extra) {
    return Object.assign({ "cache-control": "no-store" }, extra || {});
  }

  function notFound(detail) {
    return { status: 404, headers: noStore(), body: { error: "not_found", detail: detail || "Not found." } };
  }

  function normalizeMethod(method) {
    return String(method === undefined || method === null || method === "" ? "GET" : method).trim().toUpperCase();
  }

  function normalizePath(path) {
    let s = String(path === undefined || path === null ? "" : path).trim();
    const q = s.indexOf("?");
    if (q !== -1) s = s.slice(0, q);
    if (s.charAt(0) !== "/") s = "/" + s;
    if (s.length > 1) s = s.replace(/\/+$/, "");
    return s || "/";
  }

  // Create the portal API dispatcher. opts:
  //   verify(secret, at) → token verification result (required for token routes)
  //   ipLimiter / tokenLimiter, or ipRate / tokenRate to build defaults
  //   resolveIp(meta) → {ip, source} (defaults to the proxy-aware resolver)
  //   clock, routes
  function createApi(opts) {
    opts = opts || {};
    const routes = new Map();
    const verify = typeof opts.verify === "function" ? opts.verify : null;
    const ipLimiter = opts.ipLimiter || createRateLimiter(opts.ipRate || DEFAULT_IP_RATE);
    const tokenLimiter = opts.tokenLimiter || createRateLimiter(opts.tokenRate || DEFAULT_TOKEN_RATE);
    const resolver = typeof opts.resolveIp === "function" ? opts.resolveIp : (meta => resolveIp(meta, opts.ip || {}));
    const clock = opts.clock || null;
    const namespace = normalizePath(opts.namespace || API_NAMESPACE);

    function atMs(at) {
      if (at === undefined || at === null) {
        if (typeof clock === "function") { const t = Date.parse(clock()); return isNaN(t) ? Date.now() : t; }
        return Date.now();
      }
      if (typeof at === "number") return at;
      const t = Date.parse(at);
      return isNaN(t) ? Date.now() : t;
    }

    function register(spec, fn, options) {
      if (typeof fn !== "function") throw new Error("QU_PORTAL.register expects a handler function.");
      const parts = String(spec).trim().split(/\s+/);
      const method = parts.length > 1 ? normalizeMethod(parts[0]) : "GET";
      const path = normalizePath(parts.length > 1 ? parts[parts.length - 1] : parts[0]);
      routes.set(method + " " + path, { fn, token: !(options && options.token === false), spec: method + " " + path });
      return api;
    }

    function mount(map) {
      if (!map) return api;
      Object.keys(map).forEach(key => {
        const entry = map[key];
        if (typeof entry === "function") register(key, entry);
        else if (entry && typeof entry.handler === "function") register(key, entry.handler, entry);
      });
      return api;
    }

    function mountService(service) {
      if (service && typeof service.routes === "function") mount(service.routes());
      return api;
    }

    async function handle(req) {
      req = req || {};
      const method = normalizeMethod(req.method);
      const path = normalizePath(req.path);
      const at = atMs(req.at);
      const ipInfo = resolver(req.meta || {});
      const ip = ipInfo && ipInfo.ip ? ipInfo.ip : "unknown";

      const ipCheck = ipLimiter.check("ip:" + ip, at);
      if (!ipCheck.allowed) {
        return {
          status: 429,
          headers: noStore({ "retry-after": String(Math.ceil(ipCheck.retry_after_ms / 1000)) }),
          body: { error: "rate_limited", detail: "Too many portal requests. Please wait a moment and try again.", retry_after_ms: ipCheck.retry_after_ms, scope: "ip" }
        };
      }

      const route = routes.get(method + " " + path);
      if (!route) return notFound();

      const ctx = {
        req,
        method,
        path,
        at,
        ip,
        ip_source: (ipInfo && ipInfo.source) || "unknown",
        user_agent: (req.meta && (req.meta.user_agent || req.meta.userAgent)) || null,
        body: isPlainObject(req.body) ? req.body : {}
      };

      if (route.token) {
        if (!verify) return { status: 500, headers: noStore(), body: { error: "no_verifier", detail: "The portal has no token verifier." } };
        let secret = req.secret;
        if (secret === undefined || secret === null) secret = ctx.body.secret;
        if (secret === undefined || secret === null) secret = ctx.body.token;
        let v;
        try { v = await verify(secret, at); } catch (e) { v = { ok: false, code: "verify_failed", detail: (e && e.message) || String(e) }; }
        if (!v || v.ok !== true) {
          const code = (v && v.code) || "not_found";
          return {
            status: statusForToken(code),
            headers: noStore(),
            body: { error: "link_unavailable", code, detail: (v && v.detail) || "That portal link is not available." }
          };
        }
        const tokenId = v.token_id || (v.token && v.token.id) || "unknown";
        const tokenCheck = tokenLimiter.check("tok:" + tokenId, at);
        if (!tokenCheck.allowed) {
          return {
            status: 429,
            headers: noStore({ "retry-after": String(Math.ceil(tokenCheck.retry_after_ms / 1000)) }),
            body: { error: "rate_limited", detail: "Too many requests for this link. Please wait a moment and try again.", retry_after_ms: tokenCheck.retry_after_ms, scope: "token" }
          };
        }
        ctx.secret = secret;
        ctx.token = v.token || null;
        ctx.token_id = tokenId;
        ctx.verification = v;
      }

      let out;
      try {
        out = await route.fn(ctx);
      } catch (e) {
        return { status: 500, headers: noStore(), body: { error: "internal", detail: "The portal could not complete that request." } };
      }
      if (out === undefined || out === null) return { status: 200, headers: noStore(), body: {} };
      if (typeof out !== "object") return { status: 200, headers: noStore(), body: { value: out } };
      const status = Number.isFinite(Number(out.status)) ? Number(out.status) : 200;
      const body = out.body === undefined ? out : out.body;
      return { status, headers: noStore(out.headers || {}), body };
    }

    const api = {
      VERSION,
      namespace,
      handle,
      register,
      mount,
      mountService,
      routes: () => Array.from(routes.values()).map(r => r.spec).sort(),
      ipLimiter,
      tokenLimiter,
      resolveIp: meta => resolver(meta)
    };
    if (opts.routes) mount(opts.routes);
    return api;
  }

  return {
    VERSION,
    ROUTE_PREFIX,
    PAGE_STATION,
    API_NAMESPACE,
    DEFAULT_IP_RATE,
    DEFAULT_TOKEN_RATE,
    parseHash,
    isPortalRoute,
    secretFromHash,
    routeFor,
    normalizeIp,
    headerValue,
    resolveIp,
    createRateLimiter,
    statusForToken,
    createApi
  };
})();
