// ============================================================================
// quote-u — Path A: direct accounting invoice (roadmap task 35)
// ----------------------------------------------------------------------------
// The DIRECT invoicing path. On finance's instruction quote-u turns an APPROVED
// frozen version into an invoice in the accounting system: it upserts the
// accounting customer for the quote's company (the company ↔ accounting-customer
// mapping resolves to one external key), creates the invoice from the approved
// selection's own frozen lines, and reconciles the created invoice reference
// back into the `invoice_intents` row.
//
// The double-billing guard (task 34) is the gate: the intent row is CLAIMED
// BEFORE any external call, so if the PSA path already claimed the version — or
// a second direct attempt arrives — the claim (or the pre-read) refuses with
// `already_invoiced` and no second invoice is ever created. The claim is what
// makes the two paths mutually exclusive (invariant I2).
//
// Tax: quote-u never asserts an authoritative tax figure (task 20). The caller
// sends the PRE-TAX lines and the accounting system owns the real computation;
// its result's tax/total come back on the invoice. The intent's `amount_cents`
// records the pre-tax billed subtotal (known before the call).
//
// Every external call goes through the gated connector gateway and every
// creation is audited as `invoice_created`. The whole thing is an idempotent
// outbox job (`version_id:invoice_direct`), and the accounting adapter is
// idempotent by `idempotency_key`, so a retry can never bill twice (I5).
// ============================================================================
window.QU_INVOICEDIRECT = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u direct invoice requires window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const ACTION = "invoice_direct";
  const SYSTEM = "accounting";
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
  // engine's selection resolution so the invoice lines match the approved
  // totals exactly (optional lines off, required lines on, single-select groups
  // collapsed).
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

  // Pure: one invoice line per accepted line (pre-tax).
  function buildInvoiceLines(input) {
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
          quantity: qty,
          unit_price_cents: unit,
          amount_cents: unit * qty,
          currency: l.currency || currency,
          kind: kind,
          recurring: kind === "mrr",
          sku: l.sku || null,
          mpn: l.manufacturer_part_number || null
        };
      });
  }

  // Pure: the accounting customer to upsert. The external key is the explicit
  // mapping when one exists, else the company id — so the same company always
  // resolves to one accounting customer.
  function buildCustomerPayload(input) {
    input = input || {};
    const quote = input.quote || {};
    const companyId = input.company_id || quote.company_id || null;
    const externalKey = input.accounting_customer_key || quote.accounting_customer_key || companyId;
    return {
      external_key: externalKey === undefined || externalKey === null ? null : String(externalKey),
      company_id: companyId === undefined || companyId === null ? null : String(companyId),
      name: input.company_name || quote.company_name || null,
      email: input.contact_email || null,
      contact_name: input.contact_name || null
    };
  }

  // Pure payload builder. Returns { ok, payload } or { ok:false, code, detail }.
  function buildPayload(input, opts) {
    input = input || {};
    opts = opts || {};
    const policy = opts.policy || normalizePolicy(null);
    const version = input.version || {};
    const quote = input.quote || {};
    const versionId = input.version_id || version.id;
    if (!versionId) return { ok: false, code: "version_required", detail: "A direct invoice needs the version id." };
    const customer = input.customer || buildCustomerPayload(input);
    if (!customer.external_key) return { ok: false, code: "no_customer", detail: "A direct invoice needs a company to create/upsert the accounting customer for." };
    const lines = input.lines || buildInvoiceLines(input);
    if (!lines.length) return { ok: false, code: "no_lines", detail: "The approved selection has no lines to invoice." };
    const total = lines.reduce((sum, l) => sum + (Number.isSafeInteger(l.amount_cents) ? l.amount_cents : 0), 0);
    const key = opts.key || (window.QU_OUTBOX ? window.QU_OUTBOX.keyOf(versionId, ACTION) : versionId + ":" + ACTION);
    return {
      ok: true,
      payload: {
        version_id: String(versionId),
        quote_id: quote.id || input.quote_id || null,
        company_id: customer.company_id,
        currency: input.currency || (input.totals && input.totals.currency) || quote.currency || M.DEFAULT_CURRENCY,
        selection: selectedIdsFor(input),
        path: "direct",
        tax_rate_bp: policy.tax_rate_bp,
        subtotal_cents: total,
        line_count: lines.length,
        customer: customer,
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
      const out = { ok: false, code: call.code || "connector_error", detail: call.detail || "The accounting write was refused." };
      if (invoiceIntents && intentId !== undefined && intentId !== null && typeof invoiceIntents.markFailed === "function") {
        return invoiceIntents.markFailed(intentId, { error: out.detail }).then(() => out);
      }
      return Promise.resolve(out);
    }

    return async function invoiceDirectHandler({ job }, ctx) {
      ctx = ctx || {};
      if (!gateway || typeof gateway.call !== "function") {
        return { ok: false, code: "no_gateway", detail: "The direct invoice needs the connector gateway." };
      }
      if (!invoiceIntents || typeof invoiceIntents.getForVersion !== "function" || typeof invoiceIntents.claim !== "function") {
        return { ok: false, code: "no_intents", detail: "The direct invoice needs the invoice-intent guard." };
      }
      const payload = job.payload || {};
      const versionId = payload.version_id || job.version_id;
      if (!versionId) return { ok: false, code: "version_required", detail: "The job carries no version id.", terminal: true };
      if (!Array.isArray(payload.lines) || !payload.lines.length) return { ok: false, code: "no_lines", detail: "The job carries no invoice lines.", terminal: true };

      // 1. Resolve the intent. The row is the hard double-billing guard, so it
      // is CLAIMED here — before any external call. A version already claimed on
      // the other path is refused terminally; one already invoiced on this path
      // is an idempotent skip; a pending/failed one is retried.
      const existing = await invoiceIntents.getForVersion(versionId);
      if (!existing.ok) return existing;
      let intent = existing.intent || null;
      if (intent) {
        if (intent.path !== "direct") {
          return { ok: false, code: "already_invoiced", detail: `Version ${versionId} was already invoiced on the "${intent.path}" path; the direct path is refused.`, terminal: true, path: intent.path, status: intent.status };
        }
        if (intent.status === "created" || intent.status === "reconciled") {
          return { ok: true, skipped: true, reason: "already_created", external_reference: intent.external_reference, path: "direct" };
        }
      } else {
        let claimed;
        try {
          claimed = await invoiceIntents.claim({
            quote_id: payload.quote_id,
            version_id: versionId,
            path: "direct",
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
      const source = { system: "quote-u", quote_id: payload.quote_id, version_id: versionId, path: "direct" };

      // 2. Upsert the accounting customer (idempotent by external key).
      const customer = payload.customer || {};
      const up = gateway.call(SYSTEM, "upsertCustomer", {
        external_key: customer.external_key,
        company_id: customer.company_id,
        name: customer.name,
        email: customer.email,
        contact_name: customer.contact_name,
        source: source
      }, { scope: scope, confirm: { by: payload.created_by || "system", note: "invoice direct: upsert accounting customer" } });
      if (!up.ok) return failExternal(intent.id, up);
      const customerId = up.result && up.result.customer_id;
      if (!customerId) return failExternal(intent.id, { code: "bad_customer", detail: "The accounting system returned no customer id." });

      // 3. Create the invoice from the approved selection. The accounting system
      // computes the authoritative tax/total; the idempotency key is stable per
      // version so a retry can never create a second invoice.
      const inv = gateway.call(SYSTEM, "createInvoice", {
        customer_id: customerId,
        company_id: payload.company_id,
        quote_id: payload.quote_id,
        version_id: versionId,
        currency: payload.currency,
        lines: payload.lines,
        tax_rate_bp: payload.tax_rate_bp,
        source: source,
        idempotency_key: "invoice_direct:" + versionId
      }, { scope: scope, confirm: { by: payload.created_by || "system", note: "invoice direct: create invoice for " + versionId } });
      if (!inv.ok) return failExternal(intent.id, inv);
      const result = inv.result || {};

      // 4. Reconcile the created reference back into the intent row.
      const reconciled = await invoiceIntents.markCreated(intent.id, { external_reference: result.invoice_id, external_system: SYSTEM });
      if (!reconciled.ok) {
        // The invoice exists; surface the reconciliation failure so the outbox
        // retries — the next run sees the intent still claimed and re-reads the
        // SAME invoice by its idempotency key (no double billing).
        return { ok: false, code: reconciled.code || "reconcile_failed", detail: reconciled.detail || "The created invoice could not be reconciled into the intent." };
      }

      // 5. Audit the external creation.
      await auditAppend({
        quote_id: payload.quote_id,
        version_id: versionId,
        event: "invoice_created",
        actor_type: "system",
        actor: payload.created_by || "system",
        detail: {
          path: "direct",
          external_system: SYSTEM,
          invoice_id: result.invoice_id || null,
          invoice_number: result.invoice_number || null,
          customer_id: customerId,
          subtotal_cents: result.subtotal_cents === undefined ? payload.subtotal_cents : result.subtotal_cents,
          tax_cents: result.tax_cents === undefined ? null : result.tax_cents,
          total_cents: result.total_cents === undefined ? null : result.total_cents,
          line_count: result.line_count === undefined ? payload.line_count : result.line_count,
          idempotency_key: "invoice_direct:" + versionId
        }
      });

      return {
        ok: true,
        path: "direct",
        intent_id: intent.id,
        customer_id: customerId,
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

    // Build the invoice job for an approved, frozen version. `enqueueForVersion`
    // is the finance/automation entry point; it refuses an unapproved or
    // unfrozen version (the approved selection is the only valid source).
    async function enqueueForVersion(input) {
      input = input || {};
      if (!policy.enabled) return { ok: true, skipped: true, reason: "disabled" };
      if (!outbox || typeof outbox.enqueue !== "function") {
        return { ok: false, code: "no_outbox", detail: "The direct invoice needs the outbox." };
      }
      const version = input.version || null;
      if (!version || !version.id) return { ok: false, code: "version_required", detail: "A direct invoice needs the frozen version." };
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
        return { ok: false, code: "not_approved", detail: `Quote ${quote.id} is "${quote.status}"; only an approved quote can be invoiced on the direct path.` };
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
      // Resolve the accounting customer key through the admin mapping (task 37)
      // when the caller did not supply one directly, so the same company always
      // resolves to one accounting customer.
      let accountingCustomerKey = input.accounting_customer_key || null;
      const companyId = input.company_id || (quote && quote.company_id) || null;
      if (!accountingCustomerKey && mapping && typeof mapping.customerKey === "function" && companyId) {
        const mk = await mapping.customerKey(companyId);
        if (mk && mk.ok && mk.key) accountingCustomerKey = mk.key;
      }
      const built = buildPayload(Object.assign({}, input, { version: version, quote: quote, line_items: lineItems || [], option_groups: groups || [], accounting_customer_key: accountingCustomerKey }), { policy });
      if (!built.ok) return built;
      return outbox.enqueue({
        version_id: built.payload.version_id,
        action: ACTION,
        quote_id: built.payload.quote_id,
        payload: built.payload
      });
    }

    function runDue(ctx) {
      if (!outbox || typeof outbox.runDue !== "function") return Promise.resolve({ ok: false, code: "no_outbox", detail: "The direct invoice needs the outbox." });
      return outbox.runDue(ctx);
    }

    return {
      ACTION,
      SYSTEM,
      policy,
      handler,
      buildCustomerPayload,
      buildInvoiceLines,
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
    buildCustomerPayload,
    buildInvoiceLines,
    buildPayload,
    createHandler,
    createService
  };
})();
