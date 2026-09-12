// ============================================================================
// quote-u — portal read surface (roadmap task 24)
// ----------------------------------------------------------------------------
// The portal read service is the ONLY way a token holder pulls quote data. It
// is deliberately thin and paranoid:
//
//   1. verify the presented secret (QU_PORTALTOKENS.verify — hash-at-rest, and
//      the server plugin may veto);
//   2. refuse anything that is not a FROZEN version — a client never sees an
//      editable draft, a sent version is frozen by definition;
//   3. refuse when the token's quote_id and the version's quote_id disagree;
//   4. build the response through QU_VERSIONS.clientView → QU_PORTALVIEW, the
//      single client-safe whitelist, and re-audit it (invariant I4) so no cost,
//      margin, snapshot provenance or internal note can escape;
//   5. return a token DTO that carries the token id and lifecycle metadata but
//      NEVER the secret or its hash.
//
// Read is otherwise side-effect free except for single-use links: a successful
// open of a `single_use` token consumes it (QU_PORTALTOKENS.markUsed), which is
// exactly the point of a single-use link, and — when an event service is
// attached — the first open emits a `viewed` portal event (roadmap task 26)
// carrying the token id, IP and user agent.
// ============================================================================
window.QU_PORTALREAD = (function () {
  "use strict";

  const VERSION = "1.0.0";

  function isFrozenVersion(version) {
    if (window.QU_VERSIONS && typeof window.QU_VERSIONS.isFrozen === "function") return window.QU_VERSIONS.isFrozen(version);
    return !!(version && typeof version.frozen_at === "string" && version.frozen_at.length > 0);
  }

  function statusFor(code) {
    if (window.QU_PORTAL && typeof window.QU_PORTAL.statusForToken === "function") return window.QU_PORTAL.statusForToken(code);
    return (code === "revoked" || code === "expired" || code === "used") ? 410 : 404;
  }

  // The public token DTO. token_hash is NEVER copied; the id is safe to show.
  function publicToken(token) {
    if (!token) return null;
    return {
      id: token.id,
      quote_id: token.quote_id,
      version_id: token.version_id,
      created_at: token.created_at,
      expires_at: token.expires_at === undefined ? null : token.expires_at,
      single_use: token.single_use === true,
      use_count: token.use_count || 0,
      last_used_at: token.last_used_at === undefined ? null : token.last_used_at,
      label: token.label || ""
    };
  }

  function unavailable(code, detail) {
    return { ok: false, status: statusFor(code), code, detail: detail || "That portal link is not available." };
  }

  function createService(opts) {
    opts = opts || {};
    const quotes = opts.quotes || null;
    const versions = opts.versions || null;
    const portalTokens = opts.portalTokens || null;
    const taxPolicy = opts.taxPolicy || null;
    const clock = opts.clock || null;
    const events = opts.events || null;

    // Read the frozen, client-safe view behind a portal secret.
    // ctx: { at?, selection?, taxPolicy?, markUsed?, ip?, user_agent? }
    async function read(secret, ctx) {
      ctx = ctx || {};
      if (!portalTokens) return { ok: false, status: 500, code: "not_configured", detail: "The portal read service needs the portal-token service." };
      const at = ctx.at === undefined || ctx.at === null ? (typeof clock === "function" ? clock() : undefined) : ctx.at;
      let v;
      try { v = await portalTokens.verify(secret, at); } catch (e) { v = { ok: false, code: "verify_failed", detail: (e && e.message) || String(e) }; }
      if (!v || v.ok !== true) return unavailable((v && v.code) || "not_found", v && v.detail);
      const token = v.token;
      if (!token) return unavailable("not_found");

      const g = await versions.getVersion(token.version_id);
      if (!g.ok) return g;
      const version = g.version;
      if (!version) return unavailable("version_not_found", "That portal link no longer points at a quote.");
      if (!isFrozenVersion(version)) {
        return { ok: false, status: 409, code: "not_frozen", detail: "This quote version is not finalised, so it cannot be shown." };
      }
      if (version.quote_id !== token.quote_id) {
        return { ok: false, status: 410, code: "token_version_mismatch", detail: "That portal link is not valid for this quote." };
      }

      let quote = null;
      if (quotes && typeof quotes.getQuote === "function") {
        const q = await quotes.getQuote(version.quote_id, { scope: "*" });
        if (q && q.ok) quote = q.quote;
      }

      const cv = await versions.clientView(version.id, ctx.selection, {
        quote,
        taxPolicy: ctx.taxPolicy !== undefined ? ctx.taxPolicy : taxPolicy
      });
      if (!cv.ok) return cv;

      // I4 belt-and-braces: re-audit the finished DTO before it can leave.
      const PV = window.QU_PORTALVIEW;
      if (PV && typeof PV.assertClientSafe === "function") {
        try { PV.assertClientSafe(cv.view); }
        catch (e) { return { ok: false, status: 500, code: e.code || "cost_leak", detail: "Refusing to expose an internal field." }; }
      }

      // A single-use link is consumed by its first successful open.
      let consumed = false;
      if (token.single_use === true && ctx.markUsed !== false && typeof portalTokens.markUsed === "function") {
        const mu = await portalTokens.markUsed(token.id, at);
        consumed = !!(mu && mu.ok);
      }

      // Portal event capture (task 26): the first open by this token emits a
      // `viewed` event carrying the token id, IP and user agent — never the
      // secret. Best-effort: an audit failure must never block the read.
      if (events && typeof events.viewed === "function") {
        try {
          await events.viewed(
            { quote_id: version.quote_id, version_id: version.id, token_id: token.id, actor: "client", ip: ctx.ip, user_agent: ctx.user_agent },
            { ip: ctx.ip, user_agent: ctx.user_agent }
          );
        } catch (e) { /* best-effort */ }
      }

      return {
        ok: true,
        status: 200,
        view: cv.view,
        token: publicToken(token),
        expires_at: token.expires_at === undefined ? null : token.expires_at,
        single_use: token.single_use === true,
        consumed,
        version: {
          id: version.id,
          quote_id: version.quote_id,
          version_number: version.version_number,
          state: version.state,
          frozen_at: version.frozen_at,
          expires_at: version.expires_at === undefined ? null : version.expires_at
        },
        quote: { id: version.quote_id, status: quote ? quote.status : null }
      };
    }

    function routes() {
      return {
        "GET /view": async ctx => {
          const res = await read(ctx.secret, {
            at: ctx.at,
            selection: ctx.body ? ctx.body.selection : undefined,
            ip: ctx.ip,
            user_agent: ctx.user_agent
          });
          if (!res.ok) return { status: res.status || 404, body: { error: "link_unavailable", code: res.code, detail: res.detail } };
          return {
            status: 200,
            body: {
              ok: true,
              view: res.view,
              token: res.token,
              version: res.version,
              quote: res.quote,
              single_use: res.single_use,
              consumed: res.consumed
            }
          };
        }
      };
    }

    return { read, routes };
  }

  return { VERSION, createService, publicToken, statusFor, isFrozenVersion };
})();
