// ============================================================================
// quote-u — revenue-line / product write on approval (roadmap task 33)
// ----------------------------------------------------------------------------
// The opportunity update writes the deal VALUE, but a CRM/PSA that computes a
// deal amount from its product/revenue records needs those records too — that
// is the design that makes the external deal amount populate rather than land
// empty. On approval this module writes the approved selection's revenue/
// product lines to the linked opportunity through the gated connector gateway,
// derived from the FROZEN version's own line items (frozen data is the only
// source).
//
// Only the lines the client actually accepted are written (the approval's
// server-recomputed selection), never cost or margin, and the write is a side
// effect: the approval enqueues a `revenue_write` job (keyed
// `version_id:revenue_write`) and this module's handler performs it. The
// adapter is idempotent by `idempotency_key`, so a retry cannot double-write
// (I5). Every write is audited as `products_written`.
// ============================================================================
window.QU_REVENUE = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u revenue write requires window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const ACTION = "revenue_write";
  const DEFAULT_POLICY = Object.freeze({ enabled: true });

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizePolicy(input) {
    const p = Object.assign({}, DEFAULT_POLICY, isPlainObject(input) ? input : {});
    return { enabled: p.enabled !== false && p.write_revenue !== false };
  }

  function sortedLines(lineItems) {
    return (Array.isArray(lineItems) ? lineItems.slice() : [])
      .sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.id || "").localeCompare(String(b.id || "")));
  }

  // Pure: the selected line ids for a frozen version. Reuses the shared totals
  // engine's selection resolution so the revenue lines match the approved
  // totals exactly (optional lines off, required lines on, single-select
  // groups collapsed).
  function selectedIdsFor(input) {
    input = input || {};
    const T = window.QU_TOTALS;
    if (T && typeof T.resolveSelection === "function") {
      const r = T.resolveSelection(input.line_items || [], input.selection, input.option_groups || []);
      return r.selectedIds;
    }
    const sel = isPlainObject(input.selection) || Array.isArray(input.selection)
      ? new Set(Array.isArray(input.selection) ? input.selection.map(String) : Object.keys(input.selection).filter(k => input.selection[k] === true).map(String))
      : null;
    return (input.line_items || []).filter(l => {
      if (sel) return sel.has(String(l.id));
      return l.optional !== true || l.selected_by_default === true;
    }).map(l => String(l.id));
  }

  // Pure: one revenue/product row per accepted line.
  function buildLines(input) {
    input = input || {};
    const currency = input.currency || (input.totals && input.totals.currency) || M.DEFAULT_CURRENCY;
    const selected = new Set(selectedIdsFor(input).map(String));
    return sortedLines(input.line_items)
      .filter(l => selected.has(String(l.id)))
      .map(l => {
        const qty = Number.isSafeInteger(l.quantity) ? l.quantity : 0;
        const unit = Number.isSafeInteger(l.unit_sell_cents) ? l.unit_sell_cents : 0;
        const kind = l.kind === "mrr" ? "mrr" : "one_time";
        return {
          description: String(l.description || "").trim(),
          sku: l.sku || null,
          mpn: l.manufacturer_part_number || null,
          kind: kind,
          quantity: qty,
          unit_price_cents: unit,
          amount_cents: unit * qty,
          currency: l.currency || currency,
          recurring: kind === "mrr"
        };
      });
  }

  // Pure payload builder. Returns { ok, payload } or { ok:false, code, detail }.
  function buildPayload(input, opts) {
    input = input || {};
    opts = opts || {};
    const version = input.version || {};
    const quote = input.quote || {};
    const versionId = input.version_id || version.id;
    const opportunityId = input.opportunity_id || quote.opportunity_id;
    if (!versionId) return { ok: false, code: "version_required", detail: "A revenue write needs the version id." };
    if (!opportunityId) return { ok: false, code: "no_opportunity", detail: "This quote is not linked to an opportunity, so there are no revenue records to write." };
    const lines = input.lines || buildLines(input);
    if (!lines.length) return { ok: false, code: "no_lines", detail: "The approved selection has no lines to write as revenue." };
    const totals = input.totals || {};
    const key = opts.key || (window.QU_OUTBOX ? window.QU_OUTBOX.keyOf(versionId, ACTION) : versionId + ":" + ACTION);
    const total = lines.reduce((sum, l) => sum + (Number.isSafeInteger(l.amount_cents) ? l.amount_cents : 0), 0);
    return {
      ok: true,
      payload: {
        version_id: String(versionId),
        quote_id: quote.id || input.quote_id || null,
        company_id: quote.company_id || input.company_id || null,
        opportunity_id: String(opportunityId),
        currency: totals.currency || quote.currency || M.DEFAULT_CURRENCY,
        selection: selectedIdsFor(input),
        line_count: lines.length,
        lines_total_cents: total,
        deal_value_cents: Number.isSafeInteger(totals.twelve_month_value_cents) ? totals.twelve_month_value_cents : null,
        lines: lines,
        idempotency_key: key
      }
    };
  }

  // ---- the outbox handler ---------------------------------------------------

  function createHandler(opts) {
    opts = opts || {};
    const gateway = opts.gateway || null;
    const audit = opts.audit || null;
    const defaultScope = opts.scope === undefined ? "*" : opts.scope;

    async function auditAppend(input) {
      if (!audit || typeof audit.append !== "function") return { ok: true, skipped: true };
      try { return await audit.append(input); }
      catch (e) { return { ok: false, code: "audit_failed", detail: (e && e.message) || String(e) }; }
    }

    return async function revenueHandler({ job }, ctx) {
      ctx = ctx || {};
      if (!gateway || typeof gateway.call !== "function") {
        return { ok: false, code: "no_gateway", detail: "The revenue write needs the connector gateway." };
      }
      const payload = job.payload || {};
      if (!payload.opportunity_id) return { ok: false, code: "no_opportunity", detail: "The job carries no opportunity id.", terminal: true };
      if (!Array.isArray(payload.lines) || !payload.lines.length) return { ok: false, code: "no_lines", detail: "The job carries no revenue lines.", terminal: true };
      const scope = ctx.scope !== undefined ? ctx.scope : (defaultScope !== "*" ? defaultScope : (payload.company_id ? [payload.company_id] : "*"));
      const call = gateway.call("psa", "writeRevenueLines", {
        id: payload.opportunity_id,
        lines: payload.lines,
        currency: payload.currency,
        deal_value_cents: payload.deal_value_cents,
        idempotency_key: job.key,
        source: { system: "quote-u", quote_id: payload.quote_id, version_id: payload.version_id }
      }, { scope: scope, confirm: { by: payload.approver_name || "system", at: payload.approved_at || null, note: "approval: write revenue lines on " + payload.opportunity_id } });
      if (!call.ok) return { ok: false, code: call.code || "connector_error", detail: call.detail || "The revenue write was refused." };
      const result = call.result || {};
      await auditAppend({
        quote_id: payload.quote_id,
        version_id: payload.version_id || job.version_id,
        event: "products_written",
        actor_type: "system",
        actor: payload.approver_name || "system",
        detail: {
          opportunity_id: String(payload.opportunity_id),
          line_count: result.line_count === undefined ? payload.line_count : result.line_count,
          revenue_total_cents: result.revenue_total_cents === undefined ? payload.lines_total_cents : result.revenue_total_cents,
          deal_value_cents: payload.deal_value_cents,
          idempotency_key: job.key
        }
      });
      return { ok: true, opportunity_id: String(payload.opportunity_id), line_count: result.line_count === undefined ? payload.line_count : result.line_count, revenue_total_cents: result.revenue_total_cents === undefined ? payload.lines_total_cents : result.revenue_total_cents };
    };
  }

  function createService(opts) {
    opts = opts || {};
    const outbox = opts.outbox || null;
    const gateway = opts.gateway || null;
    const quotes = opts.quotes || null;
    const versions = opts.versions || null;
    const audit = opts.audit || null;
    const policy = normalizePolicy(opts.policy);
    const scope = opts.scope === undefined ? "*" : opts.scope;
    const handler = createHandler({ gateway, audit, policy, scope });
    if (outbox && typeof outbox.registerHandler === "function") outbox.registerHandler(ACTION, handler);

    async function enqueueForApproval(input) {
      input = input || {};
      if (!policy.enabled) return { ok: true, skipped: true, reason: "disabled" };
      if (!outbox || typeof outbox.enqueue !== "function") {
        return { ok: false, code: "no_outbox", detail: "The revenue write needs the outbox." };
      }
      const version = input.version || null;
      if (!version || !version.id) return { ok: false, code: "version_required", detail: "A revenue write needs the frozen version." };
      let quote = input.quote || null;
      if (!quote && quotes && input.quote_id) {
        const q = await quotes.getQuote(input.quote_id, { scope: scope === "*" ? "*" : scope });
        if (q && q.ok) quote = q.quote;
      }
      let lineItems = input.line_items;
      if (!lineItems && versions && typeof versions.listLines === "function") {
        const l = await versions.listLines(version.id);
        if (l && l.ok) lineItems = l.lines;
      }
      let groups = input.option_groups;
      if (!groups && versions && typeof versions.listGroups === "function") {
        const g = await versions.listGroups(version.id);
        if (g && g.ok) groups = g.groups;
      }
      const built = buildPayload(Object.assign({}, input, { version: version, quote: quote, line_items: lineItems || [], option_groups: groups || [] }), {});
      if (!built.ok) return built;
      return outbox.enqueue({
        version_id: built.payload.version_id,
        action: ACTION,
        quote_id: built.payload.quote_id,
        payload: built.payload
      });
    }

    function runDue(ctx) {
      if (!outbox || typeof outbox.runDue !== "function") return Promise.resolve({ ok: false, code: "no_outbox", detail: "The revenue write needs the outbox." });
      return outbox.runDue(ctx);
    }

    return {
      ACTION,
      policy,
      handler,
      buildLines,
      selectedIdsFor,
      buildPayload: (input, o) => buildPayload(input, o || {}),
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
    selectedIdsFor,
    buildLines,
    buildPayload,
    createHandler,
    createService
  };
})();
