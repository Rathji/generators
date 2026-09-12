// ============================================================================
// quote-u — Path B: PSA invoicing (roadmap task 36)
// ----------------------------------------------------------------------------
// The PSA invoicing path. On finance's instruction quote-u hands the approved
// selection's PRODUCT/REVENUE records to the PSA (CRM-U) through the gated
// connector gateway; the PSA's own accounting sync then produces the invoice,
// and quote-u reconciles the returned PSA invoice reference back into the
// `invoice_intents` row.
//
// Where the DIRECT path (task 35) sends pre-tax lines to the accounting system,
// this path is deliberately indirect: quote-u writes the product records and
// the PSA — the business source of truth — owns the invoice. quote-u therefore
// never asserts a tax figure here either; it records the reference the PSA
// returns.
//
// The double-billing guard is the same gate as the direct path: the intent row
// is CLAIMED for the `psa` path BEFORE any external call, so a version already
// claimed on the other path is refused terminally (`already_invoiced`) and a
// retry on the same path is a clean idempotent skip. The whole thing is an
// idempotent outbox job (`version_id:invoice_psa`), and the PSA adapter is
// idempotent by a stable `idempotency_key` (`invoice_psa:<version_id>`), so a
// retry cannot produce a second invoice (I5).
// ============================================================================
window.QU_INVOICEPSA = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u psa invoice requires window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const ACTION = "invoice_psa";
  const SYSTEM = "psa";
  const DEFAULT_TAX_RATE_BP = 500;
  const DEFAULT_POLICY = Object.freeze({ enabled: true, tax_rate_bp: DEFAULT_TAX_RATE_BP, source: "quote-u" });

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizePolicy(input) {
    const p = Object.assign({}, DEFAULT_POLICY, isPlainObject(input) ? input : {});
    const rateBp = Number.isInteger(p.tax_rate_bp) && p.tax_rate_bp >= 0 ? p.tax_rate_bp : DEFAULT_TAX_RATE_BP;
    return {
      enabled: p.enabled !== false && p.write_invoice !== false,
      tax_rate_bp: rateBp,
      source: p.source === undefined || p.source === null ? DEFAULT_POLICY.source : String(p.source)
    };
  }

  function sortedLines(lineItems) {
    return (Array.isArray(lineItems) ? lineItems.slice() : [])
      .sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.id || "").localeCompare(String(b.id || "")));
  }

  // Pure: the selected line ids for a frozen version, reusing the shared totals
  // engine's selection resolution (optional lines off, required on, single
  // groups collapsed) so the PSA records match the approved totals exactly.
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

  // Pure: one product/revenue row per accepted line, annotated with the PSA
  // catalog id the product mapping resolves (when one exists).
  function buildRevenueLines(input) {
    input = input || {};
    if (window.QU_REVENUE && typeof window.QU_REVENUE.buildLines === "function" && !input.psa_product_ids) {
      const base = window.QU_REVENUE.buildLines(input);
      return base.map(l => Object.assign({}, l, { psa_product_id: null }));
    }
    const currency = input.currency || (input.totals && input.totals.currency) || M.DEFAULT_CURRENCY;
    const selected = new Set(selectedIdsFor(input).map(String));
    const productIds = isPlainObject(input.psa_product_ids) ? input.psa_product_ids : null;
    return sortedLines(input.line_items)
      .filter(l => selected.has(String(l.id)))
      .map(l => {
        const qty = Number.isSafeInteger(l.quantity) ? l.quantity : 0;
        const unit = Number.isSafeInteger(l.unit_sell_cents) ? l.unit_sell_cents : 0;
        const kind = l.kind === "mrr" ? "mrr" : "one_time";
        const psaId = productIds
          ? (productIds[String(l.id)] || productIds[String(l.sku || "")] || productIds[String(l.catalog_ref || "")] || null)
          : (l.psa_product_id || null);
        return {
          description: String(l.description || "").trim(),
          sku: l.sku || null,
          mpn: l.manufacturer_part_number || null,
          psa_product_id: psaId === undefined || psaId === null ? null : String(psaId),
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
    const policy = opts.policy || normalizePolicy(null);
    const version = input.version || {};
    const quote = input.quote || {};
    const versionId = input.version_id || version.id;
    const opportunityId = input.opportunity_id || quote.opportunity_id;
    if (!versionId) return { ok: false, code: "version_required", detail: "A PSA invoice needs the version id." };
    if (!opportunityId) return { ok: false, code: "no_opportunity", detail: "This quote is not linked to an opportunity, so the PSA cannot produce an invoice for it." };
    const lines = input.lines || buildRevenueLines(input);
    if (!lines.length) return { ok: false, code: "no_lines", detail: "The approved selection has no product lines to invoice through the PSA." };
    const total = lines.reduce((sum, l) => sum + (Number.isSafeInteger(l.amount_cents) ? l.amount_cents : 0), 0);
    const key = opts.key || (window.QU_OUTBOX ? window.QU_OUTBOX.keyOf(versionId, ACTION) : versionId + ":" + ACTION);
    return {
      ok: true,
      payload: {
        version_id: String(versionId),
        quote_id: quote.id || input.quote_id || null,
        company_id: quote.company_id || input.company_id || null,
        opportunity_id: String(opportunityId),
        currency: input.currency || (input.totals && input.totals.currency) || quote.currency || M.DEFAULT_CURRENCY,
        selection: selectedIdsFor(input),
        path: "psa",
        tax_rate_bp: policy.tax_rate_bp,
        subtotal_cents: total,
        line_count: lines.length,
        lines: lines,
        idempotency_key: key
      }
    };
  }

  // ---- the outbox handler ---------------------------------------------------

  function createHandler(opts) {
    opts = opts || {};
    const gateway = opts.gateway || null;
    const invoiceIntents = opts.invoiceIntents || null;
    const audit = opts.audit || null;
    const defaultScope = opts.scope === undefined ? "*" : opts.scope;

    async function auditAppend(input) {
      if (!audit || typeof audit.append !== "function") return { ok: true, skipped: true };
      try { return await audit.append(input); }
      catch (e) { return { ok: false, code: "audit_failed", detail: (e && e.message) || String(e) }; }
    }

    function failExternal(intentId, call) {
      const out = { ok: false, code: call.code || "connector_error", detail: call.detail || "The PSA invoice request was refused." };
      if (invoiceIntents && intentId !== undefined && intentId !== null && typeof invoiceIntents.markFailed === "function") {
        return invoiceIntents.markFailed(intentId, { error: out.detail }).then(() => out);
      }
      return Promise.resolve(out);
    }

    return async function invoicePsaHandler({ job }, ctx) {
      ctx = ctx || {};
      if (!gateway || typeof gateway.call !== "function") {
        return { ok: false, code: "no_gateway", detail: "The PSA invoice needs the connector gateway." };
      }
      if (!invoiceIntents || typeof invoiceIntents.getForVersion !== "function" || typeof invoiceIntents.claim !== "function") {
        return { ok: false, code: "no_intents", detail: "The PSA invoice needs the invoice-intent guard." };
      }
      const payload = job.payload || {};
      const versionId = payload.version_id || job.version_id;
      if (!versionId) return { ok: false, code: "version_required", detail: "The job carries no version id.", terminal: true };
      if (!payload.opportunity_id) return { ok: false, code: "no_opportunity", detail: "The job carries no opportunity id.", terminal: true };
      if (!Array.isArray(payload.lines) || !payload.lines.length) return { ok: false, code: "no_lines", detail: "The job carries no product lines.", terminal: true };

      // 1. Claim the intent BEFORE any external call. A version already claimed
      // on the other path is refused terminally; one already invoiced here is an
      // idempotent skip.
      const existing = await invoiceIntents.getForVersion(versionId);
      if (!existing.ok) return existing;
      let intent = existing.intent || null;
      if (intent) {
        if (intent.path !== "psa") {
          return { ok: false, code: "already_invoiced", detail: `Version ${versionId} was already invoiced on the "${intent.path}" path; the psa path is refused.`, terminal: true, path: intent.path, status: intent.status };
        }
        if (intent.status === "created" || intent.status === "reconciled") {
          return { ok: true, skipped: true, reason: "already_created", external_reference: intent.external_reference, path: "psa" };
        }
      } else {
        let claimed;
        try {
          claimed = await invoiceIntents.claim({
            quote_id: payload.quote_id,
            version_id: versionId,
            path: "psa",
            amount_cents: payload.subtotal_cents,
            currency: payload.currency,
            created_by: payload.created_by || "system"
          });
        } catch (e) {
          return { ok: false, code: (e && e.code) || "claim_failed", detail: (e && e.message) || String(e) };
        }
        if (!claimed.ok) {
          return { ok: false, code: claimed.code || "claim_refused", detail: claimed.detail || "The invoice intent could not be claimed.", terminal: claimed.code === "already_invoiced", path: claimed.path, status: claimed.status };
        }
        intent = claimed.intent;
      }

      const scope = ctx.scope !== undefined ? ctx.scope : (defaultScope !== "*" ? defaultScope : (payload.company_id ? [payload.company_id] : "*"));
      const source = { system: "quote-u", quote_id: payload.quote_id, version_id: versionId, path: "psa" };

      // 2. Write the product/revenue records and ask the PSA to invoice them.
      // The PSA's accounting sync produces the invoice and returns its
      // reference; the idempotency key is stable per version.
      const inv = gateway.call(SYSTEM, "requestInvoice", {
        id: payload.opportunity_id,
        opportunity_id: payload.opportunity_id,
        company_id: payload.company_id,
        quote_id: payload.quote_id,
        version_id: versionId,
        currency: payload.currency,
        lines: payload.lines,
        tax_rate_bp: payload.tax_rate_bp,
        source: source,
        idempotency_key: "invoice_psa:" + versionId
      }, { scope: scope, confirm: { by: payload.created_by || "system", note: "invoice psa: request invoice for " + versionId } });
      if (!inv.ok) return failExternal(intent.id, inv);
      const result = inv.result || {};

      // 3. Reconcile the PSA's invoice reference back into the intent row.
      const reconciled = await invoiceIntents.markCreated(intent.id, { external_reference: result.invoice_id, external_system: SYSTEM });
      if (!reconciled.ok) {
        return { ok: false, code: reconciled.code || "reconcile_failed", detail: reconciled.detail || "The PSA invoice reference could not be reconciled into the intent." };
      }

      // 4. Audit the external creation.
      await auditAppend({
        quote_id: payload.quote_id,
        version_id: versionId,
        event: "invoice_created",
        actor_type: "system",
        actor: payload.created_by || "system",
        detail: {
          path: "psa",
          external_system: SYSTEM,
          invoice_id: result.invoice_id || null,
          invoice_number: result.invoice_number || null,
          opportunity_id: String(payload.opportunity_id),
          subtotal_cents: result.subtotal_cents === undefined ? payload.subtotal_cents : result.subtotal_cents,
          tax_cents: result.tax_cents === undefined ? null : result.tax_cents,
          total_cents: result.total_cents === undefined ? null : result.total_cents,
          line_count: result.line_count === undefined ? payload.line_count : result.line_count,
          idempotency_key: "invoice_psa:" + versionId
        }
      });

      return {
        ok: true,
        path: "psa",
        intent_id: intent.id,
        opportunity_id: String(payload.opportunity_id),
        external_reference: result.invoice_id || null,
        invoice_number: result.invoice_number || null,
        subtotal_cents: result.subtotal_cents === undefined ? payload.subtotal_cents : result.subtotal_cents,
        tax_cents: result.tax_cents === undefined ? null : result.tax_cents,
        total_cents: result.total_cents === undefined ? null : result.total_cents,
        line_count: result.line_count === undefined ? payload.line_count : result.line_count
      };
    };
  }

  function createService(opts) {
    opts = opts || {};
    const outbox = opts.outbox || null;
    const gateway = opts.gateway || null;
    const invoiceIntents = opts.invoiceIntents || null;
    const quotes = opts.quotes || null;
    const versions = opts.versions || null;
    const audit = opts.audit || null;
    const mapping = opts.mapping || null;
    const policy = normalizePolicy(opts.policy);
    const scope = opts.scope === undefined ? "*" : opts.scope;
    const handler = createHandler({ gateway, invoiceIntents, audit, scope });
    if (outbox && typeof outbox.registerHandler === "function") outbox.registerHandler(ACTION, handler);

    // Resolve the PSA catalog id for each line through the mapping (task 37)
    // when a mapping service is available; otherwise the lines carry none.
    async function psaProductIdsFor(lines) {
      if (!mapping || typeof mapping.resolvePsaProduct !== "function" || !lines || !lines.length) return null;
      const map = {};
      for (const l of lines) {
        const r = await mapping.resolvePsaProduct({ sku: l.sku, mpn: l.manufacturer_part_number, catalog_ref: l.catalog_ref, description: l.description });
        const pid = r && r.ok ? r.psa_product_id : null;
        if (pid) map[String(l.id)] = pid;
      }
      return Object.keys(map).length ? map : null;
    }

    async function enqueueForVersion(input) {
      input = input || {};
      if (!policy.enabled) return { ok: true, skipped: true, reason: "disabled" };
      if (!outbox || typeof outbox.enqueue !== "function") {
        return { ok: false, code: "no_outbox", detail: "The PSA invoice needs the outbox." };
      }
      const version = input.version || null;
      if (!version || !version.id) return { ok: false, code: "version_required", detail: "A PSA invoice needs the frozen version." };
      const frozen = window.QU_VERSIONS && typeof window.QU_VERSIONS.isFrozen === "function"
        ? window.QU_VERSIONS.isFrozen(version)
        : !!(version.frozen_at);
      if (!frozen) return { ok: false, code: "not_frozen", detail: "Only a frozen (approved) version can be invoiced." };

      let quote = input.quote || null;
      if (!quote && quotes && input.quote_id) {
        const q = await quotes.getQuote(input.quote_id, { scope: scope === "*" ? "*" : scope });
        if (q && q.ok) quote = q.quote;
      }
      if (quote && quote.status !== "approved" && input.force !== true) {
        return { ok: false, code: "not_approved", detail: `Quote ${quote.id} is "${quote.status}"; only an approved quote can be invoiced on the psa path.` };
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
      const psaProductIds = await psaProductIdsFor(lineItems || []);
      const built = buildPayload(Object.assign({}, input, { version: version, quote: quote, line_items: lineItems || [], option_groups: groups || [], psa_product_ids: psaProductIds }), { policy });
      if (!built.ok) return built;
      return outbox.enqueue({
        version_id: built.payload.version_id,
        action: ACTION,
        quote_id: built.payload.quote_id,
        payload: built.payload
      });
    }

    function runDue(ctx) {
      if (!outbox || typeof outbox.runDue !== "function") return Promise.resolve({ ok: false, code: "no_outbox", detail: "The PSA invoice needs the outbox." });
      return outbox.runDue(ctx);
    }

    return {
      ACTION,
      SYSTEM,
      policy,
      handler,
      buildRevenueLines,
      selectedIdsFor,
      buildPayload: (input, o) => buildPayload(input, Object.assign({ policy }, o || {})),
      enqueueForVersion,
      enqueueForApproval: enqueueForVersion,
      runDue,
      ready: () => Promise.resolve({ ok: true })
    };
  }

  return {
    VERSION,
    ACTION,
    SYSTEM,
    DEFAULT_TAX_RATE_BP,
    DEFAULT_POLICY,
    normalizePolicy,
    selectedIdsFor,
    buildRevenueLines,
    buildPayload,
    createHandler,
    createService
  };
})();
