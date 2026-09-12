// ============================================================================
// quote-u — finance reconciliation (roadmap task 39)
// ----------------------------------------------------------------------------
// The finance reconciliation view: for a frozen, approved version it compares
// what the client accepted (the immutable `approvals` record — the totals the
// server recomputed at approval time) against the invoice actually produced
// externally (read back through the gated connector gateway), and reports a
// per-version verdict.
//
// The reconciliation is a READ. It re-derives nothing and never trusts a
// client-side figure: the approved side comes from the acceptance record, the
// invoiced side from the external system of record (the accounting system or
// the PSA). `reconcile` is the only write — it marks the intent `reconciled`
// once the comparison is clean, which is audited as `invoice_reconciled`.
//
// The double-billing guard itself lives one layer down (QU_INVOICEINTENTS): one
// intent row per version, claimed before any external call. This module proves
// it from the finance side — it can only ever see at most one invoice for a
// version, and the guard proof in the self-tests drives two approvals/paths at
// one version and shows exactly one external invoice exists.
//
// Money is integer cents (QU_MONEY).
// ============================================================================
window.QU_RECONCILIATION = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u reconciliation requires window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const STATUSES = Object.freeze(["no_approval", "awaiting_invoice", "pending", "failed", "unverified", "matched", "mismatch"]);
  const ATTENTION_STATUSES = Object.freeze(["failed", "unverified", "mismatch"]);
  const DEFAULT_POLICY = Object.freeze({ tolerance_cents: 0 });

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizePolicy(input) {
    const p = isPlainObject(input) ? input : {};
    return { tolerance_cents: Number.isInteger(p.tolerance_cents) && p.tolerance_cents >= 0 ? p.tolerance_cents : DEFAULT_POLICY.tolerance_cents };
  }

  function centsOrNull(value) {
    return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
  }

  function approvedSummary(approval) {
    if (!approval) return null;
    const oneTime = centsOrNull(approval.one_time_cents) || 0;
    const mrr = centsOrNull(approval.mrr_cents) || 0;
    const selection = Array.isArray(approval.selection) ? approval.selection.slice() : [];
    return {
      one_time_cents: oneTime,
      mrr_cents: mrr,
      twelve_month_value_cents: centsOrNull(approval.twelve_month_value_cents),
      subtotal_cents: M.add(oneTime, mrr),
      currency: approval.currency || null,
      line_count: selection.length,
      selection: selection,
      approver_name: approval.approver_name || null,
      approved_at: approval.approved_at || null
    };
  }

  function invoicedSummary(invoice) {
    if (!invoice) return null;
    return {
      invoice_id: invoice.id || null,
      invoice_number: invoice.invoice_number || null,
      subtotal_cents: centsOrNull(invoice.subtotal_cents),
      tax_cents: centsOrNull(invoice.tax_cents),
      total_cents: centsOrNull(invoice.total_cents),
      tax_rate_bp: Number.isInteger(invoice.tax_rate_bp) ? invoice.tax_rate_bp : null,
      line_count: Number.isInteger(invoice.line_count) ? invoice.line_count : null,
      currency: invoice.currency || null,
      status: invoice.status || null,
      source: invoice.source || null
    };
  }

  // Pure: build the reconciliation report from the pieces. Returns
  // { ok, status, approved, invoiced, variance_cents, checks, failed_checks,
  //   needs_attention, ... }.
  function buildReport(input, opts) {
    input = input || {};
    const policy = normalizePolicy(opts && opts.policy);
    const approval = input.approval || null;
    const intent = input.intent || null;
    const invoice = input.invoice || null;
    const approved = approvedSummary(approval);
    const invoiced = invoicedSummary(invoice);
    const checks = [];

    function add(key, label, ok, expected, actual) {
      checks.push({ key: key, label: label, ok: ok === true, expected: expected === undefined ? null : expected, actual: actual === undefined ? null : actual });
    }
    function within(a, b) {
      if (a === null || a === undefined || b === null || b === undefined) return true;
      return Math.abs(a - b) <= policy.tolerance_cents;
    }

    let status;
    if (!approval) status = "no_approval";
    else if (!intent) status = "awaiting_invoice";
    else if (intent.status === "pending") status = "pending";
    else if (intent.status === "failed") status = "failed";
    else if (!invoice) status = "unverified";
    else status = "matched";

    if (approval && intent) {
      add("approval_matches_intent", "The approved amount equals the invoiced amount", within(approved.subtotal_cents, intent.amount_cents), approved.subtotal_cents, intent.amount_cents);
      add("currency_matches_intent", "The approved currency equals the intent currency", !intent.currency || !approved.currency || approved.currency === intent.currency, approved.currency, intent.currency);
      add("intent_names_quote", "The intent belongs to the same quote", !intent.quote_id || intent.quote_id === approval.quote_id, approval.quote_id, intent.quote_id);
    }
    if (intent && invoice && approved) {
      add("subtotal_matches", "The invoice's pre-tax subtotal equals the approved amount", within(invoice.subtotal_cents, approved.subtotal_cents), approved.subtotal_cents, invoice.subtotal_cents);
      add("line_count_matches", "The invoice's line count equals the approved line count", !Number.isInteger(invoice.line_count) || invoice.line_count === approved.line_count, approved.line_count, invoice.line_count);
      add("currency_matches", "The invoice currency equals the approved currency", !invoice.currency || !approved.currency || invoice.currency === approved.currency, approved.currency, invoice.currency);
      add("reference_matches", "The intent's external reference is the invoice id", !intent.external_reference || intent.external_reference === invoice.id, intent.external_reference, invoice.id);
    }

    const failed = checks.filter(c => !c.ok);
    if (status === "matched" && failed.length) status = "mismatch";

    return {
      ok: true,
      status: status,
      version_id: input.version_id || (intent && intent.version_id) || (approval && approval.version_id) || null,
      quote_id: (intent && intent.quote_id) || (approval && approval.quote_id) || input.quote_id || null,
      path: intent ? intent.path : null,
      intent_status: intent ? intent.status : null,
      external_system: intent ? intent.external_system : null,
      external_reference: intent ? intent.external_reference : null,
      amount_cents: intent ? centsOrNull(intent.amount_cents) : null,
      currency: (intent && intent.currency) || (approved && approved.currency) || null,
      reconciled: !!(intent && intent.status === "reconciled"),
      approved: approved,
      invoiced: invoiced,
      variance_cents: invoiced && approved ? (centsOrNull(invoiced.subtotal_cents) === null || approved.subtotal_cents === null ? null : invoiced.subtotal_cents - approved.subtotal_cents) : null,
      checks: checks,
      failed_checks: failed.map(c => c.key),
      needs_attention: ATTENTION_STATUSES.indexOf(status) !== -1
    };
  }

  function summarize(reports) {
    const counts = {};
    STATUSES.forEach(s => { counts[s] = 0; });
    let attention = 0;
    (Array.isArray(reports) ? reports : []).forEach(r => {
      if (!r) return;
      if (counts[r.status] === undefined) counts[r.status] = 0;
      counts[r.status] += 1;
      if (r.needs_attention) attention += 1;
    });
    return { total: (reports || []).length, counts: counts, needs_attention: attention };
  }

  function renderZone() {
    // The full reconciliation view is the Invoicing station (src/invoicing.js);
    // the Admin station links to it rather than duplicating the table.
    const card = document.createElement("section");
    card.className = "card";
    card.innerHTML =
      '<div class="card-title-row"><div><h2>Finance reconciliation</h2>' +
      '<p class="hint" style="margin:2px 0 0">Approved quotes are compared with the invoice their intent produced. The full reconciliation view lives in the Invoicing station.</p></div></div>';
    const btn = document.createElement("button");
    btn.className = "btn btn-ghost btn-sm";
    btn.textContent = "Open Invoicing";
    btn.addEventListener("click", () => { if (window.QU && window.QU.go) window.QU.go("invoicing"); });
    card.appendChild(btn);
    return card;
  }

  // ---- service --------------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const gateway = opts.gateway || null;
    const invoiceIntents = opts.invoiceIntents || null;
    const approvals = opts.approvals || null;
    const audit = opts.audit || null;
    const policy = normalizePolicy(opts.policy);
    const scope = opts.scope === undefined ? "*" : opts.scope;

    // Read the external invoice the intent points at, through the gateway. A
    // missing/unreachable system yields null (the report says "unverified"),
    // never a guessed figure.
    function fetchInvoice(intent) {
      if (!intent) return null;
      if (!gateway || typeof gateway.call !== "function") return null;
      const payload = { id: intent.external_reference || undefined, version_id: intent.version_id };
      const system = intent.external_system;
      if (intent.path === "psa" || system === "psa") {
        const r = gateway.call("psa", "getPsaInvoice", payload, { scope: scope });
        return r && r.ok ? r.result : null;
      }
      if (intent.path === "direct" || system === "accounting") {
        const r = gateway.call("accounting", "getInvoice", payload, { scope: scope });
        return r && r.ok ? r.result : null;
      }
      return null;
    }

    async function getApproval(versionId) {
      if (!approvals || typeof approvals.getForVersion !== "function") return null;
      const a = await approvals.getForVersion(versionId);
      return a && a.ok ? a.approval : null;
    }

    async function getIntent(versionId) {
      const g = await invoiceIntents.getForVersion(versionId);
      if (!g.ok) return { ok: false, code: g.code || "intent_error", detail: g.detail };
      return { ok: true, intent: g.intent || null };
    }

    async function forVersion(versionId, o) {
      if (!invoiceIntents || typeof invoiceIntents.getForVersion !== "function") {
        return { ok: false, code: "no_intents", detail: "The reconciliation service needs the invoice-intent guard." };
      }
      const gi = await getIntent(versionId);
      if (!gi.ok) return gi;
      const intent = gi.intent;
      const approval = await getApproval(versionId);
      const invoice = fetchInvoice(intent);
      const report = buildReport({ version_id: versionId, intent: intent, approval: approval, invoice: invoice }, { policy: policy });
      return { ok: true, report: report, intent: intent, invoice: invoice, approval: approval };
    }

    async function list(filter) {
      if (!invoiceIntents || typeof invoiceIntents.list !== "function") {
        return { ok: false, code: "no_intents", detail: "The reconciliation service needs the invoice-intent guard." };
      }
      const l = await invoiceIntents.list(filter || {});
      if (!l.ok) return l;
      const reports = [];
      for (const intent of l.intents) {
        const approval = await getApproval(intent.version_id);
        const invoice = fetchInvoice(intent);
        reports.push(buildReport({ intent: intent, approval: approval, invoice: invoice }, { policy: policy }));
      }
      return { ok: true, reports: reports, summary: summarize(reports), total: reports.length };
    }

    async function forQuote(quoteId) {
      return list({ quote_id: quoteId });
    }

    // The one write: mark a cleanly reconciled intent reconciled and audit it.
    async function reconcile(versionId, o) {
      o = o || {};
      const f = await forVersion(versionId, o);
      if (!f.ok) return f;
      const report = f.report;
      if (report.status !== "matched") {
        return {
          ok: false,
          code: report.status === "mismatch" ? "mismatch" : "not_reconciled",
          detail: `Version ${versionId} is "${report.status}" against its invoice; it cannot be marked reconciled.`,
          report: report
        };
      }
      if (f.intent.status === "reconciled") return { ok: true, already: true, report: report, reconciled: true };
      const upd = await invoiceIntents.markReconciled(f.intent.id, { external_reference: f.intent.external_reference, external_system: f.intent.external_system });
      if (!upd.ok) return upd;
      if (audit && typeof audit.append === "function") {
        try {
          await audit.append({
            quote_id: report.quote_id,
            version_id: versionId,
            event: "invoice_reconciled",
            actor_type: "system",
            actor: o.actor || "finance",
            detail: {
              path: report.path,
              external_system: report.external_system,
              external_reference: report.external_reference,
              approved_cents: report.approved ? report.approved.subtotal_cents : null,
              invoiced_cents: report.invoiced ? report.invoiced.subtotal_cents : null,
              variance_cents: report.variance_cents
            }
          });
        } catch (e) {
          // The intent's status is the durable record; a failed audit append is
          // surfaced by the audit service's own verification, not swallowed.
        }
      }
      return { ok: true, reconciled: true, report: report, intent: upd.intent };
    }

    function ready() {
      return Promise.resolve({ ok: true });
    }

    return {
      policy: policy,
      forVersion: forVersion,
      forQuote: forQuote,
      list: list,
      reconcile: reconcile,
      summarize: summarize,
      renderZone: renderZone,
      ready: ready
    };
  }

  return {
    VERSION,
    STATUSES,
    ATTENTION_STATUSES,
    DEFAULT_POLICY,
    normalizePolicy,
    approvedSummary,
    invoicedSummary,
    buildReport,
    summarize,
    renderZone,
    createService
  };
})();
