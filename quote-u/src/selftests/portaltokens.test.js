(function () {
  const T = window.QU_SELFTEST;
  const P = window.QU_PORTALTOKENS;
  const QS = window.QU_STORE;
  if (!T || !P || !QS) return;

  const CAPTURED = "2026-08-10T09:00:00.000Z";

  function throws(fn, code) {
    try {
      fn();
    } catch (err) {
      if (code && err.code !== code) return "threw " + err.code + " instead of " + code;
      return null;
    }
    return "did not throw";
  }

  function makeKv(kvStore) {
    return {
      get: async k => kvStore.get(k),
      set: async (k, v) => { kvStore.set(k, v); },
      delete: async k => { kvStore.delete(k); }
    };
  }

  function makeEditable(files) {
    return {
      get: async name => {
        const f = files.get(name);
        return f ? f.text : null;
      },
      set: async (name, text, o) => {
        o = o || {};
        let f = files.get(name);
        if (!f) {
          f = { text, key: "ek." + name, count: 0 };
          files.set(name, f);
          f.count = 1;
          return { error: null, editKey: f.key, editCount: 1, created: true };
        }
        if (!o.editKey || o.editKey !== f.key) return { error: "invalid or missing edit key", created: false };
        if (f.text === text) return { error: null, editCount: f.count, unchanged: true };
        f.text = text;
        f.count++;
        return { error: null, editCount: f.count, unchanged: false };
      }
    };
  }

  function makeEnv() {
    const ns = "tok" + QS.randHex(6);
    const store = QS.create({ ns, kv: makeKv(new Map()), editable: makeEditable(new Map()), modules: [P.DOC] });
    const svc = P.createService({ store });
    return { ns, store, svc };
  }

  T.register("portal tokens: SHA-256 is correct and the secret is never stored", () => {
    const bad = [];
    const vectors = [
      ["", "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"],
      ["abc", "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"],
      ["abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq", "248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1"]
    ];
    vectors.forEach(([input, want]) => {
      const got = P.sha256Hex(input);
      if (got !== want) bad.push("sha256(" + JSON.stringify(input) + ") = " + got + " (want " + want + ")");
    });
    if (P.hashSecret("abc") !== P.sha256Hex("qu-portal-v1:abc")) bad.push("hashSecret is not domain-separated sha256");
    if (!/^[0-9a-f]{64}$/.test(P.hashSecret("x"))) bad.push("hashSecret is not 64-char hex");

    const a = P.genSecret();
    const b = P.genSecret();
    if (!/^[0-9a-f]{64}$/.test(a)) bad.push("genSecret is not 64-char hex: " + a);
    if (a === b) bad.push("two secrets collided");
    if (a.length !== P.SECRET_HEX_LEN) bad.push("SECRET_HEX_LEN mismatch");

    const minted = P.mint({ quote_id: "q-1", version_id: "v-1", created_at: CAPTURED, secret: a });
    if (minted.secret !== a) bad.push("mint did not return the secret once");
    const rec = minted.record;
    if (rec.token_hash !== P.hashSecret(a)) bad.push("stored hash mismatch");
    if (JSON.stringify(rec).indexOf(a) !== -1) bad.push("the plaintext secret appears in the record");
    if (rec.id === a) bad.push("the token id must be distinct from the secret");
    if (!/^tok-/.test(rec.id)) bad.push("token id missing prefix: " + rec.id);
    if (rec.quote_id !== "q-1" || rec.version_id !== "v-1") bad.push("quote/version binding lost");
    Object.keys(rec).forEach(k => { if (k !== "token_hash" && /secret|plaintext/i.test(k)) bad.push("secret-shaped field " + k); });

    if (throws(() => P.assertNoSecret({ id: "t", token_secret: "x" }), "secret_not_allowed")) bad.push("token_secret field accepted");
    if (throws(() => P.assertNoSecret({ secret: "x" }), "secret_not_allowed")) bad.push("secret field accepted");
    let tokenHashOk = true;
    try { P.assertNoSecret({ id: "t", token_hash: "x" }); } catch (e) { tokenHashOk = false; }
    if (!tokenHashOk) bad.push("token_hash wrongly refused");
    if (throws(() => P.mint({ version_id: "v-1" }), "quote_required")) bad.push("missing quote_id accepted");
    if (throws(() => P.mint({ quote_id: "q-1" }), "version_required")) bad.push("missing version_id accepted");
    if (throws(() => P.mint({ quote_id: "q-1", version_id: "v-1", secret: "short" }), "weak_secret")) bad.push("weak secret accepted");

    const ok = P.verify(a, rec, CAPTURED);
    if (!ok.ok || ok.status !== "active") bad.push("verify of the right secret failed: " + JSON.stringify(ok));
    const wrong = P.verify("deadbeef", rec, CAPTURED);
    if (wrong.ok || wrong.code !== "hash_mismatch") bad.push("wrong secret not refused: " + JSON.stringify(wrong));
    if (P.verify("", rec, CAPTURED).code !== "bad_secret") bad.push("empty secret not refused");
    if (P.verify(a, null, CAPTURED).code !== "not_found") bad.push("null record not refused");
    const revoked = P.verify(a, Object.assign({}, rec, { revoked_at: CAPTURED }), CAPTURED);
    if (revoked.ok || revoked.code !== "revoked") bad.push("revoked token accepted");
    const expired = P.verify(a, Object.assign({}, rec, { expires_at: "2026-08-01T00:00:00.000Z" }), CAPTURED);
    if (expired.ok || expired.code !== "expired") bad.push("expired token accepted");
    const used = P.verify(a, Object.assign({}, rec, { single_use: true, use_count: 1 }), CAPTURED);
    if (used.ok || used.code !== "used") bad.push("single-use token accepted twice");
    if (P.statusOf(rec, CAPTURED) !== "active") bad.push("statusOf(active)");

    const link = P.linkFor(a, "quote-u");
    if (link !== "https://perchance.org/quote-u#/q/" + encodeURIComponent(a)) bad.push("linkFor: " + link);
    if (P.linkFor("x", "quote-u").indexOf("#/q/x") === -1) bad.push("linkFor route missing");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "SHA-256 matches the known vectors; the secret is 32 random bytes returned once; the record carries only token_hash; verify refuses wrong/revoked/expired/used secrets" };
  });

  T.register("portal tokens: the service persists hash-only tokens and verifies, expires and revokes them", async () => {
    const env = makeEnv();
    const bad = [];
    const m = await env.svc.mint({ quote_id: "q-1", version_id: "v-1", created_by: "rep", expires_at: "2026-09-09T09:00:00.000Z", label: "Q-0001" });
    if (!m.ok) return { pass: false, detail: "mint: " + JSON.stringify(m) };
    if (!m.secret || !m.token) bad.push("mint did not return secret+token");

    const byId = await env.svc.getById(m.token.id);
    if (!byId.ok || !byId.token) bad.push("getById: " + JSON.stringify(byId));
    else if (byId.token.token_hash !== P.hashSecret(m.secret) || JSON.stringify(byId.token).indexOf(m.secret) !== -1) bad.push("persisted record is not hash-only");

    const bySecret = await env.svc.getBySecret(m.secret);
    if (!bySecret.ok || !bySecret.token || bySecret.token.id !== m.token.id) bad.push("getBySecret did not find the token");
    const v1 = await env.svc.verify(m.secret, CAPTURED);
    if (!v1.ok || v1.token_id !== m.token.id) bad.push("verify: " + JSON.stringify(v1));
    const vWrong = await env.svc.verify("nope", CAPTURED);
    if (vWrong.ok || vWrong.code !== "not_found") bad.push("wrong secret verified: " + JSON.stringify(vWrong.code));

    const forQuote = await env.svc.listForQuote("q-1");
    if (!forQuote.ok || forQuote.tokens.length !== 1) bad.push("listForQuote: " + JSON.stringify(forQuote && forQuote.tokens));
    const forVersion = await env.svc.listForVersion("v-1");
    if (!forVersion.ok || forVersion.tokens.length !== 1) bad.push("listForVersion");
    const other = await env.svc.listForQuote("q-other");
    if (!other.ok || other.tokens.length !== 0) bad.push("listForQuote leaked another quote's tokens");

    const active = await env.svc.activeForVersion("v-1", CAPTURED);
    if (!active.ok || !active.token || active.token.id !== m.token.id) bad.push("activeForVersion: " + JSON.stringify(active && active.code));

    const revoked = await env.svc.revoke(m.token.id, { actor: "rep" });
    if (!revoked.ok || !revoked.token.revoked_at) bad.push("revoke: " + JSON.stringify(revoked));
    const vRevoked = await env.svc.verify(m.secret, CAPTURED);
    if (vRevoked.ok || vRevoked.code !== "revoked") bad.push("revoked token still verifies");
    const again = await env.svc.revoke(m.token.id, { actor: "rep" });
    if (!again.ok || !again.already) bad.push("idempotent revoke: " + JSON.stringify(again));

    // A second token that has already expired never counts as active.
    const past = await env.svc.mint({ quote_id: "q-1", version_id: "v-1", expires_at: "2026-08-01T00:00:00.000Z" });
    if (!past.ok) bad.push("expiring mint: " + JSON.stringify(past));
    const vExpired = await env.svc.verify(past.secret, CAPTURED);
    if (vExpired.ok || vExpired.code !== "expired") bad.push("expired token verified");
    const active2 = await env.svc.activeForVersion("v-1", CAPTURED);
    if (!active2.ok || active2.token !== null) bad.push("expired token counted active");

    // A single-use token is consumed by markUsed.
    const su = await env.svc.mint({ quote_id: "q-1", version_id: "v-1", single_use: true });
    if (!su.ok) bad.push("single-use mint");
    if (!(await env.svc.verify(su.secret, CAPTURED)).ok) bad.push("fresh single-use token failed");
    await env.svc.markUsed(su.token.id, CAPTURED);
    const vUsed = await env.svc.verify(su.secret, CAPTURED);
    if (vUsed.ok || vUsed.code !== "used") bad.push("used single-use token verified again: " + JSON.stringify(vUsed));
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "minted tokens persist hash-only through the store, verify by hash, expire by timestamp, revoke idempotently, and a single-use token is consumed by markUsed" };
  });

  T.register("portal tokens: the attached server is the authority and the local document is the fallback", async () => {
    const env = makeEnv();
    const bad = [];
    const registered = [];
    const fake = {
      register: async r => { registered.push(r); return { ok: true, id: r.id, registered: true }; },
      verify: async () => ({ ok: true, token_id: "server-tok", status: "active" }),
      revoke: async () => ({ ok: true }),
      markUsed: async () => ({ ok: true })
    };
    env.svc.attachServer(fake);
    if (!env.svc.hasServer()) bad.push("hasServer false after attachServer");
    const m = await env.svc.mint({ quote_id: "q-1", version_id: "v-1", expires_at: "2026-09-09T09:00:00.000Z" });
    if (!m.ok) return { pass: false, detail: "mint: " + JSON.stringify(m) };
    if (m.server_registered !== true) bad.push("mint did not report server registration: " + JSON.stringify(m.server_registered));
    if (registered.length !== 1 || registered[0].token_hash !== P.hashSecret(m.secret)) bad.push("the server was not given the hash");
    if (registered[0].token_hash === m.secret) bad.push("the server was sent the plaintext secret!");
    if (JSON.stringify(registered[0]).indexOf(m.secret) !== -1) bad.push("the plaintext secret appears in the server payload");

    const v = await env.svc.verify(m.secret, CAPTURED);
    if (!v.ok || v.authority !== "server") bad.push("verify did not consult the server: " + JSON.stringify(v));

    // A server veto wins over a locally-valid token.
    env.svc.attachServer({ verify: async () => ({ ok: false, code: "revoked", detail: "vetoed", token_id: m.token.id }) });
    const veto = await env.svc.verify(m.secret, CAPTURED);
    if (veto.ok || veto.code !== "revoked" || veto.authority !== "server") bad.push("server veto ignored: " + JSON.stringify(veto));

    // A token the server has never seen falls back to the local document.
    env.svc.attachServer({ verify: async () => ({ ok: false, code: "not_found" }) });
    const local = await env.svc.verify(m.secret, CAPTURED);
    if (!local.ok || local.authority !== "local") bad.push("unknown-to-server token did not fall back: " + JSON.stringify(local));

    // An unreachable server degrades gracefully instead of breaking the app.
    env.svc.attachServer({ verify: async () => { throw new Error("offline"); } });
    const deg = await env.svc.verify(m.secret, CAPTURED);
    if (!deg.ok || deg.authority !== "local") bad.push("offline server broke local verify: " + JSON.stringify(deg));

    env.svc.detachServer();
    if (env.svc.hasServer()) bad.push("detachServer did not detach");
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the server receives only the hash; a server veto wins; an unknown or unreachable server falls back to the local document and marks authority local" };
  });

  T.register("portal tokens: the server plugin holds the token registry authoritatively (live)", async () => {
    const r = window.root;
    if (!r || typeof r.createServerSocket !== "function") return { pass: true, skip: true, detail: "createServerSocket unavailable" };
    let sock = null;
    try {
      sock = r.createServerSocket();
      await sock.opened;
    } catch (e) {
      return { pass: false, detail: "could not connect to the server plugin: " + ((e && e.message) || e) };
    }
    const bad = [];
    const asText = reply => (typeof reply === "string" ? reply : new TextDecoder().decode(reply));
    const jrpc = async (name, obj) => JSON.parse(asText(await sock.rpc[name](obj === undefined ? "" : JSON.stringify(obj))));
    const secret = P.genSecret();
    const id = "tok-live-" + QS.randHex(8);
    const expires = new Date(Date.now() + 86400000).toISOString();
    try {
      const reg = await jrpc("tokenRegister", { id, token_hash: P.hashSecret(secret), expires_at: expires });
      if (!reg.ok || !reg.registered) bad.push("register: " + JSON.stringify(reg));
      const reg2 = await jrpc("tokenRegister", { id, token_hash: P.hashSecret(secret) });
      if (!reg2.ok || reg2.registered) bad.push("idempotent register: " + JSON.stringify(reg2));
      const conflict = await jrpc("tokenRegister", { id, token_hash: P.hashSecret(P.genSecret()) });
      if (conflict.ok || conflict.code !== "hash_conflict") bad.push("hash conflict not refused: " + JSON.stringify(conflict));

      const v = await jrpc("tokenVerify", { secret });
      if (!v.ok || v.token_id !== id || v.status !== "active") bad.push("verify: " + JSON.stringify(v));
      if (JSON.stringify(v).indexOf("token_hash") !== -1) bad.push("verify returned the stored hash");
      const wrong = await jrpc("tokenVerify", { secret: P.genSecret() });
      if (wrong.ok || wrong.code !== "not_found") bad.push("wrong secret accepted: " + JSON.stringify(wrong));

      const list = await jrpc("tokenList");
      if (!list.ok || !list.tokens.some(t => t.id === id)) bad.push("tokenList missing the token: " + JSON.stringify(list));
      if (JSON.stringify(list).indexOf(P.hashSecret(secret)) !== -1) bad.push("tokenList exposed the stored hash");

      const rev = await jrpc("tokenRevoke", { id });
      if (!rev.ok || rev.already) bad.push("revoke: " + JSON.stringify(rev));
      const v2 = await jrpc("tokenVerify", { secret });
      if (v2.ok || v2.code !== "revoked") bad.push("revoked token verified: " + JSON.stringify(v2));

      const id2 = "tok-live-" + QS.randHex(8);
      const s2 = P.genSecret();
      const reg3 = await jrpc("tokenRegister", { id: id2, token_hash: P.hashSecret(s2), single_use: true });
      if (!reg3.ok) bad.push("single-use register: " + JSON.stringify(reg3));
      if (!(await jrpc("tokenVerify", { secret: s2 })).ok) bad.push("fresh single-use token failed");
      const mu = await jrpc("tokenMarkUsed", { id: id2 });
      if (!mu.ok || mu.use_count !== 1) bad.push("markUsed: " + JSON.stringify(mu));
      const v3 = await jrpc("tokenVerify", { secret: s2 });
      if (v3.ok || v3.code !== "used") bad.push("used single-use token verified: " + JSON.stringify(v3));
    } catch (err) {
      bad.push("live server check threw: " + ((err && err.message) || err));
    } finally {
      try { sock.close(1000); } catch (e) {}
    }
    return bad.length ? { pass: false, detail: bad.join(" | ") } : { pass: true, detail: "the server registers hashes idempotently, refuses hash conflicts, verifies by hashing the presented secret, revokes, and consumes single-use tokens — never exposing the stored hash" };
  });
})();
