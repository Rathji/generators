// ============================================================================
// quote-u — opportunity note write (roadmap task 32)
// ----------------------------------------------------------------------------
// On approval the linked PSA opportunity gets a note carrying the
// products / costs / part-numbers block, so the PSA's downstream deal sync has
// the detail it needs (which items were sold, at what cost, and from which
// captured price snapshot) — not just a bare amount.
//
// The block is derived from the FROZEN version's own line items (task 29's
// rule: frozen data is the only source) plus the immutable price snapshots the
// lines reference, and it is written through the gated connector gateway. It is
// an INTERNAL write (to the PSA), so costs are included here — this note never
// touches a client surface.
//
// Like the opportunity update, the write is a side effect: the approval
// enqueues a `note_write` job (keyed `version_id:note_write`) on the idempotent
// outbox, and this module registers the handler. The connector adapter is
// itself idempotent by `idempotency_key`, so a retry can never attach the same
// note twice (I5).
// ============================================================================
window.QU_OPPNOTE = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u opp note requires window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const ACTION = "note_write";
  const DEFAULT_POLICY = Object.freeze({ enabled: true, max_chars: 20000 });

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizePolicy(input) {
    const p = Object.assign({}, DEFAULT_POLICY, isPlainObject(input) ? input : {});
    return {
      enabled: p.enabled !== false && p.write_note !== false,
      max_chars: Number.isFinite(p.max_chars) && p.max_chars > 0 ? Math.floor(p.max_chars) : DEFAULT_POLICY.max_chars
    };
  }

  function sortedLines(lineItems) {
    return (Array.isArray(lineItems) ? lineItems.slice() : [])
      .sort((a, b) => ((a.sort_order || 0) - (b.sort_order || 0)) || String(a.id || "").localeCompare(String(b.id || "")));
  }

  // Index the snapshots a version's lines reference. Accepts an array of
  // snapshot records or an id→record map.
  function snapshotIndex(snapshots) {
    const out = Object.create(null);
    if (Array.isArray(snapshots)) {
      for (const s of snapshots) if (s && s.id) out[s.id] = s;
    } else if (isPlainObject(snapshots)) {
      for (const k of Object.keys(snapshots)) if (snapshots[k]) out[k] = snapshots[k];
    }
    return out;
  }

  function money(cents, currency) {
    if (!Number.isSafeInteger(cents)) return "—";
    try { return M.format(cents, { currency: currency }); }
    catch (e) { return String(cents); }
  }

  // The selected line ids for the frozen version, using the shared totals
  // engine's resolution so the note lists exactly what the client accepted.
  function selectedIdsFor(input) {
    input = input || {};
    const T = window.QU_TOTALS;
    if (T && typeof T.resolveSelection === "function") {
      return T.resolveSelection(input.line_items || [], input.selection, input.option_groups || []).selectedIds;
    }
    const sel = Array.isArray(input.selection) ? new Set(input.selection.map(String)) : null;
    return (input.line_items || []).filter(l => sel ? sel.has(String(l.id)) : (l.optional !== true || l.selected_by_default === true)).map(l => String(l.id));
  }

  // Pure: one detail row per ACCEPTED frozen line item, joined to its snapshot.
  function buildRows(input) {
    input = input || {};
    const selected = new Set(selectedIdsFor(input).map(String));
    const byId = snapshotIndex(input.snapshots);
    return sortedLines(input.line_items).filter(line => selected.has(String(line.id))).map(line => {
      const snap = line.price_snapshot_ref ? (byId[line.price_snapshot_ref] || null) : null;
      const qty = Number.isSafeInteger(line.quantity) ? line.quantity : 0;
      const sell = Number.isSafeInteger(line.unit_sell_cents) ? line.unit_sell_cents : 0;
      const costSource = snap && Number.isSafeInteger(snap.unit_cost_cents) ? "snapshot"
        : (Number.isSafeInteger(line.unit_cost_cents) ? "line" : "none");
      const cost = costSource === "snapshot" ? snap.unit_cost_cents
        : (costSource === "line" ? line.unit_cost_cents : null);
      return {
        line_id: line.id,
        description: line.description || "",
        kind: line.kind || "one_time",
        quantity: qty,
        sku: line.sku || null,
        mpn: line.manufacturer_part_number || null,
        unit_sell_cents: sell,
        amount_cents: sell * qty,
        unit_cost_cents: cost,
        cost_source: costSource,
        snapshot: snap ? {
          id: snap.id,
          source: snap.source || null,
          distributor_sku: snap.distributor_sku || null,
          unit_cost_cents: Number.isSafeInteger(snap.unit_cost_cents) ? snap.unit_cost_cents : null,
          list_price_cents: Number.isSafeInteger(snap.list_price_cents) ? snap.list_price_cents : null,
          quantity_available: Number.isSafeInteger(snap.quantity_available) ? snap.quantity_available : 0,
          warehouse: snap.warehouse || "",
          captured_at: snap.captured_at || null
        } : null
      };
    });
  }

  // Pure: the human-readable note body.
  function renderText(input) {
    input = input || {};
    const rows = input.rows || buildRows(input);
    const quote = input.quote || {};
    const totals = input.totals || {};
    const cur = totals.currency || quote.currency || M.DEFAULT_CURRENCY;
    const out = [];
    out.push("ACCEPTED QUOTE [" + (quote.quote_number || quote.id || "quote") + "] " + String(quote.title || "").trim());
    out.push("Approved by " + String(input.approver_name || "").trim() + " on " + (input.approved_at || "") +
      (input.opportunity_id ? " · opportunity " + input.opportunity_id : ""));
    out.push("Products, costs and part numbers");
    if (!rows.length) out.push("  (no line items)");
    for (const r of rows) {
      out.push("- " + r.quantity + " x " + r.description + " [" + r.kind + "]");
      const parts = [];
      if (r.mpn) parts.push("MPN " + r.mpn);
      if (r.sku) parts.push("SKU " + r.sku);
      parts.push("sell " + money(r.unit_sell_cents, cur) + " ea -> " + money(r.amount_cents, cur));
      parts.push(r.unit_cost_cents === null ? "cost: unpriced" : "cost " + money(r.unit_cost_cents, cur) + " ea (" + r.cost_source + ")");
      out.push("    " + parts.join(" | "));
      if (r.snapshot) {
        const s = r.snapshot;
        out.push("    snapshot " + s.id + " from " + (s.source || "?") +
          (s.distributor_sku ? " (" + s.distributor_sku + ")" : "") +
          ", captured " + (s.captured_at || "?") +
          (s.warehouse ? ", warehouse " + s.warehouse : "") +
          ", qty available " + s.quantity_available);
      }
    }
    out.push("Totals: one-time " + money(totals.one_time_cents || 0, cur) +
      "; MRR " + money(totals.mrr_cents || 0, cur) + "/mo" +
      "; 12-month value " + money(totals.twelve_month_value_cents || 0, cur));
    return out.join("\n");
  }

  // Pure payload builder. Returns { ok, payload } or { ok:false, code, detail }.
  function buildPayload(input, opts) {
    input = input || {};
    opts = opts || {};
    const version = input.version || {};
    const quote = input.quote || {};
    const versionId = input.version_id || version.id;
    const opportunityId = input.opportunity_id || quote.opportunity_id;
    if (!versionId) return { ok: false, code: "version_required", detail: "An opportunity note needs the version id." };
    if (!opportunityId) return { ok: false, code: "no_opportunity", detail: "This quote is not linked to an opportunity, so there is nothing to annotate." };
    const rows = input.rows || buildRows(input);
    let note = renderText(Object.assign({}, input, { rows: rows, opportunity_id: opportunityId }));
    const max = opts.max_chars || DEFAULT_POLICY.max_chars;
    let truncated = false;
    if (note.length > max) { note = note.slice(0, max); truncated = true; }
    const key = opts.key || (window.QU_OUTBOX ? window.QU_OUTBOX.keyOf(versionId, ACTION) : versionId + ":" + ACTION);
    return {
      ok: true,
      payload: {
        version_id: String(versionId),
        quote_id: quote.id || input.quote_id || null,
        company_id: quote.company_id || input.company_id || null,
        opportunity_id: String(opportunityId),
        selection: selectedIdsFor(input),
        note: note,
        structured: { line_count: rows.length, truncated: truncated, rows: rows },
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

    return async function noteHandler({ job }, ctx) {
      ctx = ctx || {};
      if (!gateway || typeof gateway.call !== "function") {
        return { ok: false, code: "no_gateway", detail: "The opportunity note needs the connector gateway." };
      }
      const payload = job.payload || {};
      if (!payload.opportunity_id) return { ok: false, code: "no_opportunity", detail: "The job carries no opportunity id.", terminal: true };
      if (!payload.note) return { ok: false, code: "no_note", detail: "The job carries no note body.", terminal: true };
      const scope = ctx.scope !== undefined ? ctx.scope : (defaultScope !== "*" ? defaultScope : (payload.company_id ? [payload.company_id] : "*"));
      const call = gateway.call("psa", "writeNote", {
        id: payload.opportunity_id,
        note: payload.note,
        structured: payload.structured,
        idempotency_key: job.key,
        source: { system: "quote-u", quote_id: payload.quote_id, version_id: payload.version_id }
      }, { scope: scope, confirm: { by: payload.approver_name || "system", at: payload.approved_at || null, note: "approval: write note on " + payload.opportunity_id } });
      if (!call.ok) return { ok: false, code: call.code || "connector_error", detail: call.detail || "The opportunity note was refused." };
      const result = call.result || {};
      await auditAppend({
        quote_id: payload.quote_id,
        version_id: payload.version_id || job.version_id,
        event: "note_written",
        actor_type: "system",
        actor: payload.approver_name || "system",
        detail: {
          opportunity_id: String(payload.opportunity_id),
          note_id: result.note_id === undefined ? null : result.note_id,
          note_count: result.note_count === undefined ? null : result.note_count,
          line_count: payload.structured ? payload.structured.line_count : null,
          idempotency_key: job.key
        }
      });
      return { ok: true, opportunity_id: String(payload.opportunity_id), note_id: result.note_id === undefined ? null : result.note_id, note_count: result.note_count === undefined ? null : result.note_count };
    };
  }

  function createService(opts) {
    opts = opts || {};
    const outbox = opts.outbox || null;
    const gateway = opts.gateway || null;
    const quotes = opts.quotes || null;
    const versions = opts.versions || null;
    const priceSnapshots = opts.priceSnapshots || null;
    const audit = opts.audit || null;
    const policy = normalizePolicy(opts.policy);
    const scope = opts.scope === undefined ? "*" : opts.scope;
    const handler = createHandler({ gateway, audit, policy, scope });
    if (outbox && typeof outbox.registerHandler === "function") outbox.registerHandler(ACTION, handler);

    // Gather the frozen lines and the price snapshots they reference.
    async function gatherSnapshots(lines) {
      if (!priceSnapshots || typeof priceSnapshots.get !== "function") return [];
      const out = [];
      for (const line of lines) {
        if (!line || !line.price_snapshot_ref) continue;
        try {
          const g = await priceSnapshots.get(line.price_snapshot_ref);
          if (g && g.ok && g.snapshot) out.push(g.snapshot);
        } catch (e) { /* a missing snapshot degrades to the line's own cost */ }
      }
      return out;
    }

    async function enqueueForApproval(input) {
      input = input || {};
      if (!policy.enabled) return { ok: true, skipped: true, reason: "disabled" };
      if (!outbox || typeof outbox.enqueue !== "function") {
        return { ok: false, code: "no_outbox", detail: "The opportunity note needs the outbox." };
      }
      const version = input.version || null;
      if (!version || !version.id) return { ok: false, code: "version_required", detail: "An opportunity note needs the frozen version." };
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
      const snapshots = input.snapshots || await gatherSnapshots(lineItems || []);
      const built = buildPayload(Object.assign({}, input, { version: version, quote: quote, line_items: lineItems || [], option_groups: groups || [], snapshots: snapshots }), { max_chars: policy.max_chars });
      if (!built.ok) return built;
      return outbox.enqueue({
        version_id: built.payload.version_id,
        action: ACTION,
        quote_id: built.payload.quote_id,
        payload: built.payload
      });
    }

    function runDue(ctx) {
      if (!outbox || typeof outbox.runDue !== "function") return Promise.resolve({ ok: false, code: "no_outbox", detail: "The opportunity note needs the outbox." });
      return outbox.runDue(ctx);
    }

    return {
      ACTION,
      policy,
      handler,
      buildRows,
      renderText,
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
    snapshotIndex,
    selectedIdsFor,
    buildRows,
    renderText,
    buildPayload,
    createHandler,
    createService
  };
})();
