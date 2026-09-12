// ============================================================================
// quote-u — opportunity update on approval (roadmap task 31)
// ----------------------------------------------------------------------------
// When a client accepts a quote, the linked PSA opportunity must become Won
// with the deal value equal to the selected one-time total plus 12 × MRR (the
// twelve-month value). That write is a side effect, so it does NOT happen
// inline: the approval enqueues an `opp_update` job (keyed
// `version_id:opp_update`) on the outbox, and this module supplies the handler
// that performs the gated, audited connector write.
//
// Because the job key is unique per version+action, re-running an approval can
// never write the deal twice — the second enqueue dedupes to the existing job,
// and the connector adapter is itself idempotent by `idempotency_key`, so even
// a retry after a partial failure applies the update at most once (I5).
//
// `auto_close` policy: when true the opportunity is set straight to the won
// stage. When disabled (a shop that wants a human to close the deal), the
// handler writes the same deal value but leaves the stage at `fallback_stage`
// so completion stays a deliberate human act.
// ============================================================================
window.QU_OPPSYNC = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u opp sync requires window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const ACTION = "opp_update";
  const DEFAULT_POLICY = Object.freeze({
    auto_close: true,
    won_stage: "won",
    fallback_stage: "closed_pending"
  });

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizePolicy(input) {
    const p = Object.assign({}, DEFAULT_POLICY, isPlainObject(input) ? input : {});
    return {
      auto_close: p.auto_close !== false,
      won_stage: String(p.won_stage || DEFAULT_POLICY.won_stage),
      fallback_stage: String(p.fallback_stage || DEFAULT_POLICY.fallback_stage)
    };
  }

  // The deal value the client accepted. As of task 53 this is the PER-SERVICE
  // contract value (`deal_value_cents`): one-time amounts plus each MRR service
  // over its own contract term. When a caller only carries the older flat
  // twelve-month metric we fall back to it, and only then to one_time + 12×MRR.
  function amountFromTotals(totals) {
    if (!isPlainObject(totals)) return null;
    if (Number.isSafeInteger(totals.deal_value_cents)) return totals.deal_value_cents;
    if (Number.isSafeInteger(totals.twelve_month_value_cents)) return totals.twelve_month_value_cents;
    if (Number.isSafeInteger(totals.one_time_cents) && Number.isSafeInteger(totals.mrr_cents)) {
      return totals.one_time_cents + totals.mrr_cents * 12;
    }
    return null;
  }

  // Pure payload builder. Returns { ok, payload } or { ok:false, code, detail }.
  function buildPayload(input, opts) {
    input = input || {};
    opts = opts || {};
    const version = input.version || {};
    const quote = input.quote || {};
    const approval = input.approval || {};
    const versionId = input.version_id || version.id;
    const opportunityId = input.opportunity_id || quote.opportunity_id;
    if (!versionId) return { ok: false, code: "version_required", detail: "An opportunity update needs the version id." };
    if (!opportunityId) return { ok: false, code: "no_opportunity", detail: "This quote is not linked to an opportunity, so there is nothing to update." };
    const amount = input.amount_cents !== undefined
      ? input.amount_cents
      : (amountFromTotals(approval) !== null ? amountFromTotals(approval) : amountFromTotals(input.totals));
    if (!Number.isSafeInteger(amount)) {
      return { ok: false, code: "bad_amount", detail: "The opportunity update needs an integer-cent deal value from the approval totals." };
    }
    const key = opts.key || (window.QU_OUTBOX ? window.QU_OUTBOX.keyOf(versionId, ACTION) : versionId + ":" + ACTION);
    return {
      ok: true,
      payload: {
        version_id: String(versionId),
        quote_id: quote.id || input.quote_id || approval.quote_id || null,
        company_id: quote.company_id || input.company_id || null,
        opportunity_id: String(opportunityId),
        amount_cents: amount,
        currency: approval.currency || totalsCurrency(input) || M.DEFAULT_CURRENCY,
        selection: Array.isArray(approval.selection) ? approval.selection.slice() : [],
        approver_name: input.approver_name || approval.approver_name || null,
        approved_at: input.approved_at || approval.approved_at || null,
        idempotency_key: key
      }
    };
  }

  function totalsCurrency(input) {
    const t = input.approval && input.approval.currency;
    if (t) return t;
    const tt = input.totals && input.totals.currency;
    return tt || null;
  }

  // ---- the outbox handler ---------------------------------------------------

  function createHandler(opts) {
    opts = opts || {};
    const gateway = opts.gateway || null;
    const audit = opts.audit || null;
    const policy = normalizePolicy(opts.policy);
    const defaultScope = opts.scope === undefined ? "*" : opts.scope;

    async function auditAppend(input) {
      if (!audit || typeof audit.append !== "function") return { ok: true, skipped: true };
      try { return await audit.append(input); }
      catch (e) { return { ok: false, code: "audit_failed", detail: (e && e.message) || String(e) }; }
    }

    return async function oppUpdateHandler({ job }, ctx) {
      ctx = ctx || {};
      if (!gateway || typeof gateway.call !== "function") {
        return { ok: false, code: "no_gateway", detail: "The opportunity update needs the connector gateway." };
      }
      const payload = job.payload || {};
      const opportunityId = payload.opportunity_id;
      if (!opportunityId) return { ok: false, code: "no_opportunity", detail: "The job carries no opportunity id.", terminal: true };
      if (!Number.isSafeInteger(payload.amount_cents)) {
        return { ok: false, code: "bad_amount", detail: "The job carries no integer-cent deal value.", terminal: true };
      }
      const stage = policy.auto_close ? policy.won_stage : policy.fallback_stage;
      const scope = ctx.scope !== undefined ? ctx.scope : (defaultScope !== "*" ? defaultScope : (payload.company_id ? [payload.company_id] : "*"));
      const call = gateway.call("psa", "updateOpportunity", {
        id: opportunityId,
        stage: stage,
        amount_cents: payload.amount_cents,
        currency: payload.currency,
        idempotency_key: job.key,
        source: { system: "quote-u", quote_id: payload.quote_id, version_id: payload.version_id, approver_name: payload.approver_name, approved_at: payload.approved_at }
      }, { scope: scope, confirm: { by: payload.approver_name || "system", at: payload.approved_at || null, note: "approval: update opportunity " + opportunityId } });
      if (!call.ok) {
        return { ok: false, code: call.code || "connector_error", detail: call.detail || "The opportunity update was refused." };
      }
      const result = call.result || {};
      await auditAppend({
        quote_id: payload.quote_id,
        version_id: payload.version_id || job.version_id,
        event: "opp_updated",
        actor_type: "system",
        actor: payload.approver_name || "system",
        detail: {
          opportunity_id: String(opportunityId),
          stage: stage,
          amount_cents: payload.amount_cents,
          currency: payload.currency,
          auto_close: policy.auto_close,
          idempotency_key: job.key,
          write_count: result.write_count === undefined ? null : result.write_count
        }
      });
      return {
        ok: true,
        opportunity_id: String(opportunityId),
        stage: stage,
        amount_cents: payload.amount_cents,
        auto_close: policy.auto_close,
        opportunity: result
      };
    };
  }

  function createService(opts) {
    opts = opts || {};
    const outbox = opts.outbox || null;
    const gateway = opts.gateway || null;
    const quotes = opts.quotes || null;
    const audit = opts.audit || null;
    const policy = normalizePolicy(opts.policy);
    const scope = opts.scope === undefined ? "*" : opts.scope;
    const handler = createHandler({ gateway, audit, policy, scope });
    if (outbox && typeof outbox.registerHandler === "function") outbox.registerHandler(ACTION, handler);

    // Enqueue the opportunity update for an approved quote. Returns the
    // enqueued (or deduped) job; a quote with no linked opportunity is a clean
    // no-op, not an error.
    async function enqueueForApproval(input) {
      if (!outbox || typeof outbox.enqueue !== "function") {
        return { ok: false, code: "no_outbox", detail: "The opportunity sync needs the outbox." };
      }
      input = input || {};
      let quote = input.quote || null;
      if (!quote && quotes && input.quote_id) {
        const q = await quotes.getQuote(input.quote_id, { scope: scope === "*" ? "*" : scope });
        if (q && q.ok) quote = q.quote;
      }
      const built = buildPayload(Object.assign({}, input, { quote: quote }), {});
      if (!built.ok) return built;
      return outbox.enqueue({
        version_id: built.payload.version_id,
        action: ACTION,
        quote_id: built.payload.quote_id,
        payload: built.payload
      });
    }

    function runDue(ctx) {
      if (!outbox || typeof outbox.runDue !== "function") return Promise.resolve({ ok: false, code: "no_outbox", detail: "The opportunity sync needs the outbox." });
      return outbox.runDue(ctx);
    }

    return {
      ACTION,
      policy,
      handler,
      buildPayload: input => buildPayload(input, {}),
      amountFromTotals,
      enqueueForApproval,
      runDue,
      ready: () => Promise.resolve({ ok: true })
    };
  }

  return {
    VERSION,
    ACTION,
    DEFAULT_POLICY,
    normalizePolicy,
    amountFromTotals,
    buildPayload,
    createHandler,
    createService
  };
})();
