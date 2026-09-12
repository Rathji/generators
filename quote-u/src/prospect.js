// ============================================================================
// quote-u — prospect mode (roadmap task 57)
// ----------------------------------------------------------------------------
// A PROSPECT is an early, lighter-weight proposal: a rep takes an already
// accepted quote (an immutable QU_ARTIFACTS record) as a BOUND TEMPLATE, adds
// BESPOKE elements on top, and sends it through the SAME spine as a normal
// quote — the send pipeline, the tokenized portal, the e-signature gate and the
// acceptance artifact are all reused, not duplicated.
//
// The only new state is a mode flag on the quote (`QU_QUOTES` reads/writes
// `mode: "quote" | "prospect"`). This module is the authoring flow around it:
//
//   createProspect(input)          create a quote in prospect mode
//   bindTemplate(quoteId, versionId, artifactId)
//                                  seed a version from an accepted artifact
//   addBespoke(input)              one bespoke line (unknown fields preserved)
//   templateLines(artifact)        pure: artifact view → bespoke line inputs
//   promote(quoteId)               flip a solidified prospect to a normal quote
//
// Bespoke lines are ordinary QU_LINEITEMS records carrying `bespoke: true` and
// a `template_ref`, so every existing surface (totals, freeze, snapshot,
// portal, artifact) treats them identically. The module is pure where it can
// be, and delegates all persistence to the quote/version services.
// ============================================================================
window.QU_PROSPECT = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const MODE = "prospect";
  const DEFAULT_SECTION = "Bespoke";

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function intOrNull(v) {
    return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
  }

  function nonNegInt(v, def) {
    return typeof v === "number" && Number.isInteger(v) && v >= 0 ? v : def;
  }

  function text(v) {
    return v === undefined || v === null ? "" : String(v);
  }

  // A bespoke line input derived from a (possibly template) view line. Pure:
  // the caller's unknown fields are preserved, and the line is always tagged
  // `bespoke: true` so its provenance is legible.
  function bespokeInput(input, opts) {
    opts = opts || {};
    if (!isPlainObject(input)) return null;
    const quantity = nonNegInt(input.quantity, 1);
    return {
      kind: input.kind === "mrr" ? "mrr" : "one_time",
      description: text(input.description).trim(),
      quantity: quantity,
      unit_sell_cents: intOrNull(input.unit_sell_cents) === null ? 0 : input.unit_sell_cents,
      unit_cost_cents: intOrNull(input.unit_cost_cents) === null ? 0 : input.unit_cost_cents,
      manufacturer_part_number: text(input.manufacturer_part_number),
      sku: text(input.sku),
      section: text(input.section) || opts.section || DEFAULT_SECTION,
      optional: input.optional === true,
      option_group_id: input.option_group_id || null,
      selected_by_default: input.selected_by_default === true,
      term_months: typeof input.term_months === "number" && Number.isInteger(input.term_months) && input.term_months >= 0 ? input.term_months : null,
      bespoke: true,
      template_ref: input.template_ref || opts.template_ref || null
    };
  }

  // Pure: turn an accepted artifact's client-safe view into bespoke line inputs.
  // The artifact holds only client-safe fields (no cost — invariant I4), so a
  // bound-template line is priced at the accepted sell with an unknown cost; the
  // rep edits it before sending.
  function templateLines(artifact, opts) {
    opts = opts || {};
    const view = artifact && isPlainObject(artifact.view) ? artifact.view : null;
    const src = view && Array.isArray(view.lines) ? view.lines
      : (view && Array.isArray(view.line_items) ? view.line_items : []);
    const templateRef = (artifact && artifact.id) || opts.template_ref || null;
    return src.map(l => bespokeInput({
      kind: l.kind,
      description: l.description !== undefined ? l.description : l.name,
      quantity: l.quantity,
      unit_sell_cents: l.unit_sell_cents !== undefined ? l.unit_sell_cents : l.unit_price_cents,
      section: l.section,
      manufacturer_part_number: l.manufacturer_part_number,
      sku: l.sku,
      optional: l.optional,
      option_group_id: l.option_group_id
    }, { section: opts.section, template_ref: templateRef }));
  }

  function modeOf(quote) {
    return (quote && quote.mode) === MODE ? MODE : "quote";
  }

  function isProspect(quote) {
    return modeOf(quote) === MODE;
  }

  function createService(opts) {
    opts = opts || {};
    const quotes = opts.quotes || null;
    if (!quotes || typeof quotes.createQuote !== "function") {
      const e = new Error("QU_PROSPECT needs the quote service (QU_QUOTES).");
      e.code = "no_quotes";
      throw e;
    }
    const versions = opts.versions || null;
    const artifacts = opts.artifacts || null;
    const audit = opts.audit || null;
    const scope = opts.scope === undefined ? "*" : opts.scope;

    async function auditAppend(input) {
      if (!audit || typeof audit.append !== "function") return { ok: true, skipped: true };
      try { return await audit.append(input); } catch (e) { return { ok: false, code: "audit_failed", detail: (e && e.message) || String(e) }; }
    }

    // Create a quote in prospect mode. All the normal creation rules (company,
    // contact, scope) still apply.
    async function createProspect(input) {
      input = input || {};
      const res = await quotes.createQuote(Object.assign({}, input, { mode: MODE }));
      if (!res.ok) return res;
      return { ok: true, quote: res.quote, number: res.number, mode: MODE, revision: res.revision };
    }

    // Bind an accepted artifact as a template onto a draft version: its accepted
    // lines become bespoke lines (priced at the accepted sell). Idempotent per
    // (version, artifact): a second bind of the same template is a no-op.
    async function bindTemplate(versionId, artifactId, ctx) {
      if (!versions || typeof versions.addLine !== "function") {
        return { ok: false, code: "no_versions", detail: "Prospect mode needs the version service to bind a template." };
      }
      if (!artifacts || typeof artifacts.getById !== "function") {
        return { ok: false, code: "no_artifacts", detail: "Prospect mode needs the artifact service to bind a template." };
      }
      const got = await artifacts.getById(artifactId);
      if (!got.ok) return got;
      if (!got.artifact) return { ok: false, code: "artifact_not_found", detail: `No acceptance artifact ${artifactId}.` };
      const artifact = got.artifact;
      const lines = await versions.listLines(versionId);
      if (!lines.ok) return lines;
      const already = lines.lines.some(l => l && l.template_ref === artifact.id);
      if (already) return { ok: true, bound: false, deduped: true, artifact_id: artifact.id, detail: "This template is already bound to the version." };
      const inputs = templateLines(artifact);
      if (!inputs.length) return { ok: false, code: "template_empty", detail: "That artifact has no lines to bind." };
      const added = [];
      for (const line of inputs) {
        const r = await versions.addLine(versionId, line);
        if (!r.ok) return { ok: false, code: r.code || "bind_failed", detail: r.detail || "A template line could not be added.", added };
        added.push(r.line);
      }
      await auditAppend({
        quote_id: (ctx && ctx.quote_id) || null, version_id: versionId,
        event: "revised", actor_type: "internal", actor: (ctx && ctx.actor) || "system",
        detail: { action: "template_bound", artifact_id: artifact.id, template_ref: artifact.id, line_count: added.length }
      });
      return { ok: true, bound: true, artifact_id: artifact.id, line_count: added.length, lines: added };
    }

    // Add one bespoke line to a prospect version.
    async function addBespoke(versionId, input, ctx) {
      if (!versions || typeof versions.addLine !== "function") {
        return { ok: false, code: "no_versions", detail: "Prospect mode needs the version service." };
      }
      const line = bespokeInput(input, {});
      if (!line) return { ok: false, code: "bad_bespoke", detail: "A bespoke line must be an object." };
      if (!line.description) return { ok: false, code: "bad_description", detail: "A bespoke line needs a description." };
      const r = await versions.addLine(versionId, line);
      if (!r.ok) return r;
      return { ok: true, line: r.line, bespoke: true };
    }

    // Flip a solidified prospect to a normal quote (or back). Delegates to the
    // quote service's validated, audited setMode.
    async function promote(quoteId, ctx) {
      if (typeof quotes.setMode !== "function") return { ok: false, code: "no_set_mode", detail: "The quote service cannot change modes." };
      return quotes.setMode(quoteId, "quote", ctx || { scope });
    }

    function ready() { return Promise.resolve({ ok: true }); }

    return {
      MODE,
      ready,
      createProspect,
      bindTemplate,
      addBespoke,
      promote,
      templateLines,
      bespokeInput,
      isProspect,
      modeOf
    };
  }

  return {
    VERSION,
    MODE,
    DEFAULT_SECTION,
    bespokeInput,
    templateLines,
    isProspect,
    modeOf,
    createService
  };
})();
