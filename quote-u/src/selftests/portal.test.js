(function () {
  const T = window.QU_SELFTEST;
  const P = window.QU_PORTAL;
  if (!T || !P) return;

  T.register("portal routes: #/q/<secret> parses, round-trips encoded secrets, and default-denies everything else", () => {
    const bad = [];
    if (!P.isPortalRoute("#/q/abc")) bad.push("did not recognize #/q/abc");
    if (P.secretFromHash("#/q/abc") !== "abc") bad.push("secret: " + P.secretFromHash("#/q/abc"));
    if (P.isPortalRoute("#/quotes")) bad.push("flagged #/quotes as a portal route");
    if (P.isPortalRoute("#/builder/q-1")) bad.push("flagged #/builder as a portal route");
    if (P.secretFromHash("#/quotes") !== null) bad.push("non-portal hash returned a secret");
    if (P.secretFromHash("#/q/") !== "") bad.push("empty secret: " + JSON.stringify(P.secretFromHash("#/q/")));
    const secret = "a/b+c d&e%f";
    const hash = P.routeFor(secret);
    if (!P.isPortalRoute(hash)) bad.push("routeFor hash not recognized: " + hash);
    if (P.secretFromHash(hash) !== secret) bad.push("round-trip: " + JSON.stringify(P.secretFromHash(hash)));
    const ph = P.parseHash("#/q/abc");
    if (!ph.portal || ph.secret !== "abc") bad.push("parseHash: " + JSON.stringify(ph));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "#/q/<secret> round-trips including encoded characters; non-portal and empty-secret hashes handled" };
  });

  T.register("portal IP: proxy headers honored, malformed hops skipped, spoof-safe by default", () => {
    const bad = [];
    const r1 = P.resolveIp({ headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" } });
    if (r1.ip !== "70.41.3.18" || r1.source !== "x-forwarded-for") bad.push("default rightmost: " + JSON.stringify(r1));
    const r2 = P.resolveIp({ headers: { "x-forwarded-for": "203.0.113.7, 70.41.3.18" } }, { trustedProxies: 1 });
    if (r2.ip !== "203.0.113.7") bad.push("trustedProxies=1: " + JSON.stringify(r2));
    const r3 = P.resolveIp({ headers: { "X-Forwarded-For": "not-an-ip, 198.51.100.9" } });
    if (r3.ip !== "198.51.100.9") bad.push("junk hop not skipped: " + JSON.stringify(r3));
    const r4 = P.resolveIp({ headers: { "x-real-ip": "198.51.100.4" } });
    if (r4.ip !== "198.51.100.4" || r4.source !== "x-real-ip") bad.push("x-real-ip: " + JSON.stringify(r4));
    const r5 = P.resolveIp({ headers: { "cf-connecting-ip": "198.51.100.5" } });
    if (r5.ip !== "198.51.100.5" || r5.source !== "cf-connecting-ip") bad.push("cf-connecting-ip: " + JSON.stringify(r5));
    const r6 = P.resolveIp({ remote_addr: "10.0.0.3:443" });
    if (r6.ip !== "10.0.0.3" || r6.source !== "socket") bad.push("socket peer: " + JSON.stringify(r6));
    const r7 = P.resolveIp({});
    if (r7.ip !== "unknown" || r7.source !== "unknown") bad.push("unknown: " + JSON.stringify(r7));
    const r8 = P.resolveIp({ headers: { "x-forwarded-for": "999.1.1.1, ::1" } });
    if (r8.ip !== "::1") bad.push("invalid hop + ipv6: " + JSON.stringify(r8));
    // A hostile client prepends a fake left-most hop; the default must still use
    // the right-most (the value the nearest trusted proxy appended).
    const r9 = P.resolveIp({ headers: { "x-forwarded-for": "1.2.3.4, 203.0.113.7" } });
    if (r9.ip !== "203.0.113.7") bad.push("spoofed left-most hop trusted: " + JSON.stringify(r9));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "x-forwarded-for/x-real-ip/cf-connecting-ip/socket honored; invalid hops skipped; a spoofed left-most hop cannot move the rate-limit key" };
  });

  T.register("portal rate limiter: sliding window admits max, refuses over, isolates keys and recovers", () => {
    const bad = [];
    const rl = P.createRateLimiter({ window_ms: 1000, max: 3 });
    const t0 = 1000000;
    for (let i = 0; i < 3; i++) {
      if (!rl.check("k", t0 + i).allowed) bad.push("refused within the limit at " + i);
    }
    const over = rl.check("k", t0 + 3);
    if (over.allowed) bad.push("did not refuse over the limit");
    if (!(over.retry_after_ms > 0)) bad.push("no retry-after reported");
    if (!rl.check("other", t0 + 3).allowed) bad.push("keys are not isolated");
    if (!rl.check("k", t0 + 1001).allowed) bad.push("did not recover after the window slid");
    const snap = rl.snapshot();
    if (typeof snap.k !== "number") bad.push("snapshot missing key");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "admits exactly max per window, reports a retry-after when over, isolates keys and recovers as the window slides" };
  });

  T.register("portal API: default-deny on unknown path/method, token gating, token + IP rate limits", async () => {
    const bad = [];
    const api = P.createApi({
      verify: async secret => {
        if (secret === "good") return { ok: true, token_id: "tok1", token: { id: "tok1" } };
        if (secret === "the-revoked") return { ok: false, code: "revoked", detail: "This portal link has been revoked." };
        if (secret === "the-expired") return { ok: false, code: "expired", detail: "This portal link has expired." };
        return { ok: false, code: "not_found" };
      },
      ipRate: { window_ms: 60000, max: 100 },
      tokenRate: { window_ms: 60000, max: 1 }
    });
    let hits = 0;
    api.register("GET /view", ctx => { hits++; return { status: 200, body: { ok: true, token_id: ctx.token_id } }; });
    api.register("GET /health", () => ({ status: 200, body: { ok: true } }), { token: false });
    api.register("GET /boom", () => { throw new Error("kaboom"); }, { token: false });

    const unknown = await api.handle({ method: "GET", path: "/nope", meta: {} });
    if (unknown.status !== 404) bad.push("unknown path: " + unknown.status);
    const wrongMethod = await api.handle({ method: "POST", path: "/view", meta: {} });
    if (wrongMethod.status !== 404) bad.push("wrong method: " + wrongMethod.status);
    const missingToken = await api.handle({ method: "GET", path: "/view", meta: {} });
    if (missingToken.status !== 404) bad.push("missing token: " + missingToken.status);
    const unknownToken = await api.handle({ method: "GET", path: "/view", secret: "nope", meta: {} });
    if (unknownToken.status !== 404) bad.push("unknown token: " + unknownToken.status);
    const revoked = await api.handle({ method: "GET", path: "/view", secret: "the-revoked", meta: {} });
    if (revoked.status !== 410) bad.push("revoked token: " + revoked.status);
    const expired = await api.handle({ method: "GET", path: "/view", secret: "the-expired", meta: {} });
    if (expired.status !== 410) bad.push("expired token: " + expired.status);
    const open = await api.handle({ method: "GET", path: "/health", meta: {} });
    if (open.status !== 200) bad.push("tokenless route: " + open.status);
    const ok = await api.handle({ method: "GET", path: "/view", secret: "good", meta: {} });
    if (ok.status !== 200 || !ok.body.ok || ok.body.token_id !== "tok1") bad.push("valid call: " + JSON.stringify(ok));
    const overToken = await api.handle({ method: "GET", path: "/view", secret: "good", meta: {} });
    if (overToken.status !== 429 || overToken.body.scope !== "token") bad.push("token rate limit: " + JSON.stringify(overToken));
    if (hits !== 1) bad.push("handler ran " + hits + " times past the token limit");
    const boom = await api.handle({ method: "GET", path: "/boom", meta: {} });
    if (boom.status !== 500 || boom.body.error !== "internal") bad.push("throwing handler: " + JSON.stringify(boom));

    // IP limiting is independent of the token: a fresh API with a 1-request IP
    // budget refuses the second call from the same address regardless of token.
    const ipApi = P.createApi({
      verify: async secret => (secret === "good" ? { ok: true, token_id: "tok-" + Math.random().toString(36).slice(2) } : { ok: false, code: "not_found" }),
      ipRate: { window_ms: 60000, max: 1 },
      tokenRate: { window_ms: 60000, max: 100 }
    });
    ipApi.register("GET /view", () => ({ status: 200 }));
    const first = await ipApi.handle({ method: "GET", path: "/view", secret: "good", meta: { headers: { "x-forwarded-for": "198.51.100.20" } } });
    const second = await ipApi.handle({ method: "GET", path: "/view", secret: "good", meta: { headers: { "x-forwarded-for": "198.51.100.20" } } });
    const other = await ipApi.handle({ method: "GET", path: "/view", secret: "good", meta: { headers: { "x-forwarded-for": "198.51.100.21" } } });
    if (first.status !== 200) bad.push("ip first: " + first.status);
    if (second.status !== 429 || second.body.scope !== "ip") bad.push("ip limited: " + JSON.stringify(second));
    if (other.status !== 200) bad.push("a different ip was limited too: " + other.status);

    // A token route with no verifier must fail closed.
    const noVer = P.createApi({ ipRate: { max: 100 }, tokenRate: { max: 100 } });
    noVer.register("GET /view", () => ({ status: 200 }));
    const fail = await noVer.handle({ method: "GET", path: "/view", secret: "x", meta: {} });
    if (fail.status !== 500 || fail.body.error !== "no_verifier") bad.push("no verifier: " + JSON.stringify(fail));

    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "unknown path/method/token all 404; revoked/expired 410; token and IP limits return 429 with a scope; handler crashes become a clean 500" };
  });
})();
