// ============================================================================
// quote-u — portal selection & decision actions (roadmap task 25)
// ----------------------------------------------------------------------------
// The client-facing actions behind the portal API:
//
//   select  — validate a proposed option selection against the shared group
//             rules and return the recomputed (DISPLAY-ONLY) totals. Nothing
//             is written: the selection only becomes real when it is approved.
//   approve — validate the selection, recompute the totals from the FROZEN
//             version, and move the quote to `approved` through
//             QU_LIFECYCLE.applyChecked (which consults the authoritative
//             server plugin — the client is never the authority).
//   decline — move the quote to `declined`.
//   expire  — move a quote whose link has passed its expiry to `expired`.
//
// Every decision is server-validated, audited with the token id (never the
// secret), and — because a decided quote is over — revokes the remaining portal
// links for that version. The frozen version itself is NEVER mutated: the
// decision lives on the quote (`status`, plus the approval/decline stamps), so
// the freeze seal and its provenance stay intact. A successful approval also
// writes the formal acceptance record through QU_APPROVALS (roadmap task 28):
// exactly one row per version, carrying the server-recomputed totals and the
// token id — never the secret.
//
// The totals used for every decision come from QU_RECOMPUTE (roadmap task 29):
// they are re-derived from the frozen version's own line items and groups, and
// any money the client put on the request body is ignored (never trusted). A
// successful approval then enqueues the idempotent external writes on
// QU_OUTBOX (tasks 30–33) — the opportunity update (`version_id:opp_update`),
// the products/costs/part-numbers note (`version_id:note_write`) and the
// revenue/product lines (`version_id:revenue_write`) — so no external write
// happens twice per version no matter how many times approve runs.
// ============================================================================
window.QU_PORTALACTIONS = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DECIDABLE = ["sent", "viewed"];

  function isFrozenVersion(version) {
    if (window.QU_VERSIONS && typeof window.QU_VERSIONS.isFrozen === "function") return window.QU_VERSIONS.isFrozen(version);
    return !!(version && typeof version.frozen_at === "string" && version.frozen_at.length > 0);
  }

  function statusFor(code) {
    if (window.QU_PORTAL && typeof window.QU_PORTAL.statusForToken === "function") return window.QU_PORTAL.statusForToken(code);
    return (code === "revoked" || code === "expired" || code === "used") ? 410 : 404;
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function ms(at) {
    if (at === undefined || at === null) return Date.now();
    if (typeof at === "number") return at;
    const t = Date.parse(at);
    return isNaN(t) ? Date.now() : t;
  }

  function createService(opts) {
    opts = opts || {};
    const quotes = opts.quotes || null;
    const versions = opts.versions || null;
    const portalTokens = opts.portalTokens || null;
    const audit = opts.audit || null;
    const clock = opts.clock || null;
    const lifecycle = opts.lifecycle || window.QU_LIFECYCLE || null;
    const taxPolicy = opts.taxPolicy || null;
    const events = opts.events || null;
    const approvals = opts.approvals || null;
    const recompute = opts.recompute || null;
    const outbox = opts.outbox || null;
    const oppSync = opts.oppSync || null;
    const oppNote = opts.oppNote || null;
    const revenue = opts.revenue || null;
    const esign = opts.esign || null;
    const artifacts = opts.artifacts || null;

    function auditAppend(input) {
      if (!audit || typeof audit.append !== "function") return Promise.resolve({ ok: true, skipped: true });
      return audit.append(input);
    }

    // Verify the secret and load the frozen version + its quote.
    async function contextFor(secret, ctx) {
      if (!portalTokens || !versions || !quotes) {
        return { ok: false, status: 500, code: "not_configured", detail: "The portal actions need the quotes, versions and token services." };
      }
      let v;
      try { v = await portalTokens.verify(secret, ctx.at); }
      catch (e) { v = { ok: false, code: "verify_failed", detail: (e && e.message) || String(e) }; }
      if (!v || v.ok !== true) {
        return { ok: false, status: statusFor((v && v.code) || "not_found"), code: (v && v.code) || "not_found", detail: (v && v.detail) || "That portal link is not available." };
      }
      const token = v.token;
      if (!token) return { ok: false, status: 404, code: "not_found", detail: "That portal link is not available." };
      const g = await versions.getVersion(token.version_id);
      if (!g.ok) return g;
      const version = g.version;
      if (!version) return { ok: false, status: 404, code: "version_not_found", detail: "That portal link no longer points at a quote." };
      if (!isFrozenVersion(version)) return { ok: false, status: 409, code: "not_frozen", detail: "This quote version is not finalised." };
      if (version.quote_id !== token.quote_id) return { ok: false, status: 410, code: "token_version_mismatch", detail: "That portal link is not valid for this quote." };
      let quote = null;
      const q = await quotes.getQuote(version.quote_id, { scope: "*" });
      if (q && q.ok) quote = q.quote;
      if (!quote) return { ok: false, status: 404, code: "quote_not_found", detail: "That portal link's quote is not available." };
      return { ok: true, token, version, quote };
    }

    // Validate a proposed selection against the shared option-group rules and
    // recompute the totals from the FROZEN version. `claimed` (any money the
    // client put on the body) is never trusted — QU_RECOMPUTE ignores it and
    // reports the difference. Never writes.
    async function reviewSelection(version, selectedIds, claimed) {
      const OG = window.QU_OPTIONGROUPS;
      const TOT = window.QU_TOTALS;
      if (!OG || !TOT) return { ok: false, status: 500, code: "not_configured", detail: "The selection rules are not loaded." };
      const lines = await versions.listLines(version.id);
      if (!lines.ok) return lines;
      const groups = await versions.listGroups(version.id);
      if (!groups.ok) return groups;
      let enforced;
      try { enforced = OG.enforceSelection(lines.lines, groups.groups, selectedIds); }
      catch (e) { return { ok: false, status: 400, code: e.code || "bad_selection", detail: e.message }; }
      if (!enforced.ok) {
        return { ok: false, status: 400, code: enforced.code || "invalid_selection", detail: enforced.detail || "That option selection is not valid.", violations: enforced.violations || [] };
      }
      // Task 29: the authoritative totals are recomputed from frozen data. The
      // frozen version must be frozen and every line must belong to it; any
      // client-supplied money is ignored, not trusted.
      let totals;
      let claimedInfo = null;
      if (recompute && typeof recompute.compute === "function") {
        const rc = await recompute.compute({ version, selection: enforced.selected_ids, claimed, line_items: lines.lines, option_groups: groups.groups });
        if (!rc.ok) {
          const status = (window.QU_RECOMPUTE && window.QU_RECOMPUTE.statusForCode) ? window.QU_RECOMPUTE.statusForCode(rc.code) : 400;
          return { ok: false, status, code: rc.code || "recompute_failed", detail: rc.detail || "The frozen totals could not be recomputed.", violations: rc.violations };
        }
        totals = rc.totals;
        claimedInfo = { ignored: !!rc.claimed_ignored, compared: rc.claimed_compared, claimed: rc.claimed };
      } else {
        totals = TOT.computeTotals({ line_items: lines.lines, option_groups: groups.groups, selection: enforced.selected_ids });
      }
      return { ok: true, selected_ids: enforced.selected_ids, repairs: enforced.repairs || [], totals, lines: lines.lines, groups: groups.groups, claimed: claimedInfo };
    }

    // Move the quote's status through the single lifecycle machine, consulting
    // the authoritative server validator attached to QU_LIFECYCLE.
    async function transition(quote, to, ctx, detail, actorType) {
      if (!lifecycle || typeof lifecycle.applyChecked !== "function") {
        return { ok: false, status: 500, code: "no_lifecycle", detail: "The lifecycle validator is not available." };
      }
      const from = quote.status;
      const applied = await lifecycle.applyChecked(
        { id: quote.sent_version_id || quote.id, quote_id: quote.id, state: from },
        to,
        { actor_type: actorType || "portal", actor: ctx.actor || "client", token_id: ctx.token_id, ip: ctx.ip, user_agent: ctx.user_agent, detail: detail, at: ctx.at }
      );
      return applied;
    }

    function transitionFailed(applied) {
      const status = applied.authority === "server" ? 409 : (applied.code === "illegal_transition" ? 409 : 500);
      return { ok: false, status, code: applied.code || "transition_refused", detail: applied.detail || "That decision is not allowed right now." };
    }

    // A decided quote is over — kill its remaining links.
    async function revokeVersionLinks(versionId, quoteId, ctx, reason) {
      if (!portalTokens || typeof portalTokens.listForVersion !== "function") return [];
      const l = await portalTokens.listForVersion(versionId);
      if (!l || !l.ok) return [];
      const revoked = [];
      for (const t of l.tokens) {
        if (t.revoked_at) continue;
        const r = await portalTokens.revoke(t.id, { actor: ctx.actor || "portal" });
        if (r && r.ok) revoked.push(t.id);
      }
      if (revoked.length) {
        await auditAppend({
          quote_id: quoteId, version_id: versionId, event: "link_revoked",
          actor_type: "portal", actor: ctx.actor || "client", token_id: ctx.token_id,
          ip: ctx.ip, user_agent: ctx.user_agent,
          detail: { reason: reason || "decided", token_ids: revoked }
        });
      }
      return revoked;
    }

    function notDecidable(quote) {
      if (DECIDABLE.indexOf(quote.status) === -1) {
        return { ok: false, status: 409, code: "not_decidable", detail: `This quote is "${quote.status}" and can no longer be decided by the client.` };
      }
      return null;
    }

    // ---- actions ----------------------------------------------------------

    // Validate a proposed selection and return the recomputed client view
    // (display-only totals). No write.
    async function select(secret, selectedIds, ctx) {
      ctx = ctx || {};
      const auth = await contextFor(secret, ctx);
      if (!auth.ok) return auth;
      const rv = await reviewSelection(auth.version, selectedIds);
      if (!rv.ok) return rv;
      let view = null;
      const cv = await versions.clientView(auth.version.id, rv.selected_ids, { quote: auth.quote, taxPolicy });
      if (cv && cv.ok) view = cv.view;
      // Portal event capture (task 26): an actual change to the selection is
      // recorded with the token id, IP and user agent (never the secret). An
      // unchanged selection (the UI can resend one) records nothing.
      if (events && typeof events.optionChanged === "function") {
        try {
          await events.optionChanged(
            { quote_id: auth.quote.id, version_id: auth.version.id, token_id: auth.token.id, selection: rv.selected_ids, ip: ctx.ip, user_agent: ctx.user_agent },
            { ip: ctx.ip, user_agent: ctx.user_agent }
          );
        } catch (e) { /* best-effort */ }
      }
      return { ok: true, status: 200, selection: rv.selected_ids, repairs: rv.repairs, totals: rv.totals, view, token: auth.token, version: auth.version, quote: auth.quote };
    }

    async function approve(secret, input, ctx) {
      ctx = ctx || {};
      input = input || {};
      const auth = await contextFor(secret, ctx);
      if (!auth.ok) return auth;
      const blocked = notDecidable(auth.quote);
      if (blocked) return blocked;
      // Invariant I2 (task 28): a version can be approved exactly once. If the
      // acceptance record already exists, refuse before doing any work.
      if (approvals && typeof approvals.has === "function") {
        const seen = await approvals.has(auth.version.id);
        if (seen && seen.ok && seen.has) {
          return { ok: false, status: 409, code: "already_approved", detail: "This quote version has already been accepted." };
        }
      }
      const rv = await reviewSelection(auth.version, input.selection, input);
      if (!rv.ok) return rv;
      const approverName = String(input.approver_name || input.approver || "").trim();
      if (!approverName) return { ok: false, status: 400, code: "approver_required", detail: "A typed name is required to approve this quote." };

      // Task 51: capture the typed-name e-signature when the capability is
      // enabled (it is gated behind a scope sign-off in QU_ESIGN). A policy that
      // REQUIRES a signature refuses the approval when the capability is not
      // enabled, rather than quietly accepting an unsigned quote.
      let signature = null;
      if (esign && typeof esign.status === "function" && typeof esign.build === "function") {
        const st = await esign.status();
        if (st && st.ok && st.enabled) {
          const built = await esign.build({
            name: approverName,
            quote_id: auth.quote.id,
            version: auth.version,
            consent: input.signature_consent,
            ip: ctx.ip,
            user_agent: ctx.user_agent
          });
          if (!built || !built.ok) {
            return { ok: false, status: 400, code: (built && built.code) || "signature_failed", detail: (built && built.detail) || "The typed-name e-signature could not be captured." };
          }
          signature = built.signature;
        } else if (st && st.ok && !st.enabled) {
          const pol = typeof esign.policy === "function" ? esign.policy() : (st.policy || {});
          if (pol && pol.require_signature) {
            return { ok: false, status: 409, code: "signature_required", detail: "This quote requires a typed-name e-signature, which is not enabled (a scope sign-off is required)." };
          }
        }
      }

      const totals = rv.totals;
      const detail = {
        selection: rv.selected_ids,
        one_time_cents: totals.one_time_cents,
        mrr_cents: totals.mrr_cents,
        twelve_month_value_cents: totals.twelve_month_value_cents,
        deal_value_cents: totals.deal_value_cents,
        approver_name: approverName,
        signed: !!signature,
        signature_id: signature ? signature.id : null,
        client_totals_ignored: rv.claimed ? !!rv.claimed.ignored : false
      };
      const applied = await transition(auth.quote, "approved", Object.assign({}, ctx, { token_id: auth.token.id, actor: approverName }), detail, "portal");
      if (!applied.ok) return transitionFailed(applied);

      const now = nowIso(clock);
      const upd = await quotes.updateQuote(auth.quote.id, {
        status: "approved",
        approved_at: now,
        approved_version_id: auth.version.id,
        approval_token_id: auth.token.id,
        approver_name: approverName,
        approved_totals: {
          one_time_cents: totals.one_time_cents,
          mrr_cents: totals.mrr_cents,
          twelve_month_value_cents: totals.twelve_month_value_cents,
          deal_value_cents: totals.deal_value_cents,
          currency: totals.currency
        }
      });
      if (!upd.ok) return upd;

      // Persist the formal acceptance record (task 28). The totals here are the
      // ones the SERVER recomputed from the frozen version, and only the token
      // id is stored — never the secret.
      let approval = null;
      if (approvals && typeof approvals.record === "function") {
        const rec = await approvals.record({
          quote_id: auth.quote.id,
          version_id: auth.version.id,
          selection: rv.selected_ids,
          one_time_cents: totals.one_time_cents,
          mrr_cents: totals.mrr_cents,
          twelve_month_value_cents: totals.twelve_month_value_cents,
          deal_value_cents: totals.deal_value_cents,
          currency: totals.currency,
          approver_name: approverName,
          signature: signature,
          token_id: auth.token.id,
          ip: ctx.ip,
          user_agent: ctx.user_agent,
          approved_at: now
        });
        if (rec && rec.ok) approval = rec.approval;
        else if (rec && rec.code === "already_approved") {
          return { ok: false, status: 409, code: "already_approved", detail: "This quote version has already been accepted." };
        }
      }

      await auditAppend({
        quote_id: auth.quote.id, version_id: auth.version.id, event: "approved",
        actor_type: "portal", actor: approverName, token_id: auth.token.id,
        ip: ctx.ip, user_agent: ctx.user_agent, detail
      });
      const revoked = await revokeVersionLinks(auth.version.id, auth.quote.id, Object.assign({}, ctx, { token_id: auth.token.id, actor: approverName }), "approved");

      // Task 52: snapshot the acceptance into an immutable `quote_artifacts`
      // record — the client-safe view, the typed-name signature and the frozen
      // content seal, sealed with a content hash. Best-effort: an artifact
      // failure never undoes the acceptance, and the service records at most one
      // artifact per version.
      let artifact = null;
      if (artifacts && typeof artifacts.record === "function") {
        try {
          const cv = await versions.clientView(auth.version.id, rv.selected_ids, { quote: upd.quote || auth.quote, taxPolicy });
          const builtArt = await artifacts.record({
            quote: upd.quote || auth.quote,
            version: auth.version,
            approval: approval,
            signature: signature,
            totals: totals,
            selection: rv.selected_ids,
            view: cv && cv.ok ? cv.view : null,
            approved_at: now,
            created_at: now
          });
          if (builtArt && builtArt.ok) artifact = builtArt.artifact;
        } catch (e) { /* best-effort */ }
      }

      // Tasks 30–33: every external write is a side effect of acceptance, so
      // each is enqueued on the idempotent outbox — the opportunity update
      // (`version_id:opp_update`, task 31), the products/costs/part-numbers
      // note (`version_id:note_write`, task 32) and the revenue/product lines
      // (`version_id:revenue_write`, task 33) — then ONE worker tick runs them.
      // Re-approving the same version can never produce a second external
      // write, and a quote not linked to an opportunity is a clean no-op.
      const sideInput = {
        quote: upd.quote || auth.quote,
        version: auth.version,
        approval: approval,
        totals: totals,
        selection: rv.selected_ids,
        amount_cents: Number.isSafeInteger(totals.deal_value_cents) ? totals.deal_value_cents : totals.twelve_month_value_cents,
        approver_name: approverName,
        approved_at: now,
        company_id: auth.quote.company_id
      };
      const pending = [];
      async function enqueueSide(label, service) {
        if (!service || typeof service.enqueueForApproval !== "function") return;
        try {
          const enq = await service.enqueueForApproval(sideInput);
          pending.push({ label: label, enq: enq });
        } catch (e) {
          pending.push({ label: label, enq: { ok: false, code: label + "_enqueue_failed", detail: (e && e.message) || String(e) } });
        }
      }
      await enqueueSide("opp_update", oppSync);
      await enqueueSide("note_write", oppNote);
      await enqueueSide("revenue_write", revenue);
      let run = null;
      if (pending.length && outbox && typeof outbox.runDue === "function") {
        try { run = await outbox.runDue({ scope: auth.quote.company_id ? [auth.quote.company_id] : "*" }); }
        catch (e) { run = null; }
      }
      function summarize(label) {
        const p = pending.find(x => x.label === label);
        if (!p) return null;
        const enq = p.enq;
        if (!enq || !enq.ok) return { ok: false, code: enq && enq.code, detail: enq && enq.detail };
        if (enq.skipped) return { ok: true, skipped: true, reason: enq.reason || null };
        const entry = run && run.ran ? run.ran.find(r => r.action === label) : null;
        return { enqueued: !enq.deduped, deduped: !!enq.deduped, state: entry ? (entry.ok ? "done" : "failed") : (enq.job ? enq.job.state : null), external_ok: entry ? !!entry.ok : null, external_code: entry ? entry.code : null };
      }
      return {
        ok: true, status: 200, decision: "approved",
        selection: rv.selected_ids, totals, approver_name: approverName,
        approval_id: approval ? approval.id : null, approval,
        artifact_id: artifact ? artifact.id : null, artifact,
        signed: !!signature, signature_id: signature ? signature.id : null,
        client_totals_ignored: rv.claimed ? !!rv.claimed.ignored : false,
        opp_update: summarize("opp_update"),
        note_write: summarize("note_write"),
        revenue_write: summarize("revenue_write"),
        quote: upd.quote, revoked_tokens: revoked, authority: applied.authority || "local"
      };
    }

    async function decline(secret, input, ctx) {
      ctx = ctx || {};
      input = input || {};
      const auth = await contextFor(secret, ctx);
      if (!auth.ok) return auth;
      const blocked = notDecidable(auth.quote);
      if (blocked) return blocked;
      const reason = String(input.reason || input.decline_reason || "").trim();
      const detail = { reason: reason || null };
      const applied = await transition(auth.quote, "declined", Object.assign({}, ctx, { token_id: auth.token.id, actor: ctx.actor || "client" }), detail, "portal");
      if (!applied.ok) return transitionFailed(applied);

      const upd = await quotes.updateQuote(auth.quote.id, { status: "declined", declined_at: nowIso(clock), declined_version_id: auth.version.id, decline_reason: reason || null });
      if (!upd.ok) return upd;
      await auditAppend({
        quote_id: auth.quote.id, version_id: auth.version.id, event: "declined",
        actor_type: "portal", actor: ctx.actor || "client", token_id: auth.token.id,
        ip: ctx.ip, user_agent: ctx.user_agent, detail
      });
      const revoked = await revokeVersionLinks(auth.version.id, auth.quote.id, Object.assign({}, ctx, { token_id: auth.token.id }), "declined");
      return { ok: true, status: 200, decision: "declined", reason: reason || null, quote: upd.quote, revoked_tokens: revoked, authority: applied.authority || "local" };
    }

    async function expire(secret, ctx) {
      ctx = ctx || {};
      const auth = await contextFor(secret, ctx);
      if (!auth.ok) return auth;
      const blocked = notDecidable(auth.quote);
      if (blocked) return blocked;
      const exp = auth.version.expires_at || auth.token.expires_at || null;
      if (exp && ms(ctx.at) <= Date.parse(exp) && ctx.force !== true) {
        return { ok: false, status: 409, code: "not_expired", detail: `This quote is valid until ${exp}; it cannot be expired yet.` };
      }
      const applied = await transition(auth.quote, "expired", Object.assign({}, ctx, { token_id: auth.token.id, actor: "system" }), { expires_at: exp, reason: "expired" }, "system");
      if (!applied.ok) return transitionFailed(applied);

      const upd = await quotes.updateQuote(auth.quote.id, { status: "expired", expired_at: nowIso(clock) });
      if (!upd.ok) return upd;
      await auditAppend({
        quote_id: auth.quote.id, version_id: auth.version.id, event: "expired",
        actor_type: "system", actor: "system", token_id: auth.token.id,
        ip: ctx.ip, user_agent: ctx.user_agent, detail: { expires_at: exp }
      });
      const revoked = await revokeVersionLinks(auth.version.id, auth.quote.id, Object.assign({}, ctx, { token_id: auth.token.id }), "expired");
      return { ok: true, status: 200, decision: "expired", expires_at: exp, quote: upd.quote, revoked_tokens: revoked, authority: applied.authority || "local" };
    }

    function routes() {
      function shape(res, errorCode) {
        if (!res.ok) {
          return {
            status: res.status || 400,
            body: { error: errorCode || "action_refused", code: res.code, detail: res.detail, violations: res.violations }
          };
        }
        return { status: res.status || 200, body: Object.assign({ ok: true }, res, { status: undefined }) };
      }
      return {
        "POST /select": async ctx => shape(await select(ctx.secret, ctx.body.selection, ctx), "selection_rejected"),
        "POST /approve": async ctx => shape(await approve(ctx.secret, ctx.body, ctx), "approval_refused"),
        "POST /decline": async ctx => shape(await decline(ctx.secret, ctx.body, ctx), "decline_refused"),
        "POST /expire": async ctx => shape(await expire(ctx.secret, ctx), "expire_refused")
      };
    }

    return { select, approve, decline, expire, reviewSelection, routes };
  }

  return { VERSION, DECIDABLE, createService, isFrozenVersion, statusFor };
})();
