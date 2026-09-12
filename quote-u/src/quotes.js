// ============================================================================
// quote-u — quote creation & external linking (roadmap task 9)
// ----------------------------------------------------------------------------
// Creates a quote tied to a company and a contact, optionally linked to an
// existing PSA opportunity, and can create the opportunity itself — but only
// when the quote has none. Every company/contact/opportunity lookup goes
// through the connector gateway, which carries the caller's account scope and
// never returns a record outside it (the IDOR guard). The quote document is
// written through the revision-guarded store; numbers come from QU_NUMBERING;
// creation and opportunity writes are appended to the audit log.
// ============================================================================
window.QU_QUOTES = (function () {
  const DOC = "quotes";
  const DEFAULT_MAX_RETRIES = 4;
  // Task 57: a quote is authored either as a normal quote or as a PROSPECT —
  // an early, lighter-weight proposal built from a bound template plus bespoke
  // lines. The mode is a flag on the quote; the send/portal/e-signature/artifact
  // spine is shared, not duplicated.
  const MODES = ["quote", "prospect"];

  function normalizeMode(v) {
    return MODES.indexOf(String(v)) === -1 ? "quote" : String(v);
  }

  function fail(code, detail) {
    const e = new Error(detail || code);
    e.code = code;
    return e;
  }
  function genId(rand) {
    return "q-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
  }
  function nowIso(clock) {
    return typeof clock === "function" ? clock() : new Date().toISOString();
  }

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "QU_QUOTES needs a document store with loadDoc/saveChecked.");
    }
    const gateway = opts.gateway;
    if (!gateway || typeof gateway.call !== "function") {
      fail("no_gateway", "QU_QUOTES needs the connector gateway (QU_CONNECTORS.createGateway).");
    }
    const numbering = opts.numbering || null;
    const audit = opts.audit || null;
    const doc = opts.doc || DOC;
    const clock = opts.clock || null;
    const rand = opts.rand || null;
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;
    const defaultScope = window.QU_CONNECTORS ? window.QU_CONNECTORS.normalizeScope(opts.scope === undefined ? "*" : opts.scope) : [];

    function scopeOf(ctx) {
      if (ctx && ctx.scope !== undefined) {
        return window.QU_CONNECTORS ? window.QU_CONNECTORS.normalizeScope(ctx.scope) : ctx.scope;
      }
      return defaultScope;
    }

    async function psa(fn, payload, scope, confirm) {
      const ctx = { scope };
      if (confirm) ctx.confirm = confirm;
      const res = await gateway.call("psa", fn, payload, ctx);
      return res;
    }

    async function loadQuotes() {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    // Lookups — all through the gateway, all scope-guarded there.
    async function listCompanies(query, ctx) {
      const res = await psa("listCompanies", { query: query || "" }, scopeOf(ctx));
      return res.ok ? { ok: true, companies: res.result || [] } : res;
    }
    async function getCompany(id, ctx) {
      const res = await psa("getCompany", { id }, scopeOf(ctx));
      return res.ok ? { ok: true, company: res.result || null } : res;
    }
    async function listContacts(companyId, query, ctx) {
      const res = await psa("listContacts", { company_id: companyId, query: query || "" }, scopeOf(ctx));
      return res.ok ? { ok: true, contacts: res.result || [] } : res;
    }
    async function getContact(id, ctx) {
      const res = await psa("getContact", { id }, scopeOf(ctx));
      return res.ok ? { ok: true, contact: res.result || null } : res;
    }
    async function listOpportunities(companyId, query, ctx) {
      const res = await psa("listOpportunities", { company_id: companyId, query: query || "" }, scopeOf(ctx));
      return res.ok ? { ok: true, opportunities: res.result || [] } : res;
    }
    async function getOpportunity(id, ctx) {
      const res = await psa("getOpportunity", { id }, scopeOf(ctx));
      return res.ok ? { ok: true, opportunity: res.result || null } : res;
    }

    function inScope(quote, ctx) {
      if (!quote) return false;
      if (!window.QU_CONNECTORS) return true;
      return window.QU_CONNECTORS.scopeAllows(scopeOf(ctx), quote.company_id);
    }

    async function getQuote(id, ctx) {
      const l = await loadQuotes();
      if (!l.ok) return l;
      const quote = l.records.find(r => r && r.id === id) || null;
      if (!quote) return { ok: true, quote: null };
      if (!inScope(quote, ctx)) return { ok: true, quote: null };
      return { ok: true, quote, revision: l.revision };
    }

    async function listQuotes(ctx, filter) {
      const l = await loadQuotes();
      if (!l.ok) return l;
      filter = filter || {};
      let records = l.records;
      if (window.QU_CONNECTORS) records = records.filter(r => window.QU_CONNECTORS.scopeAllows(scopeOf(ctx), r.company_id));
      if (filter.company_id) records = records.filter(r => r.company_id === filter.company_id);
      return { ok: true, quotes: records.slice(), revision: l.revision };
    }

    // Append a quote to the quotes document, revision-guarded, retrying while
    // the document moves under us.
    async function persistNew(quote) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await loadQuotes();
        if (!l.ok) return l;
        if (l.records.some(r => r && r.id === quote.id)) return { ok: true, noop: true, revision: l.revision, quote };
        const next = Object.assign({}, l.content, { records: l.records.concat([quote]) });
        const save = await store.saveChecked(doc, next, { expectedBase: l.revision });
        if (save.ok) return { ok: true, revision: save.revision, quote };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "quote_conflict", detail: `Could not create the quote after ${maxRetries + 1} attempts; the ${doc} document kept moving.` };
    }

    // Patch an existing quote record, revision-guarded, retrying while it moves.
    async function updateQuote(id, patch) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await loadQuotes();
        if (!l.ok) return l;
        const idx = l.records.findIndex(r => r && r.id === id);
        if (idx === -1) return { ok: false, code: "quote_not_found", detail: `No quote ${id}.` };
        const records = l.records.slice();
        records[idx] = Object.assign({}, records[idx], patch, { updated_at: nowIso(clock) });
        const next = Object.assign({}, l.content, { records });
        const save = await store.saveChecked(doc, next, { expectedBase: l.revision });
        if (save.ok) return { ok: true, revision: save.revision, quote: records[idx] };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "quote_conflict", detail: `Could not update the quote after ${maxRetries + 1} attempts.` };
    }

    async function auditAppend(input) {
      if (!audit || typeof audit.append !== "function") return { ok: true, skipped: true };
      return audit.append(input);
    }

    // Create a quote tied to a company + contact, optionally linked to an
    // existing opportunity. Nothing outside the caller's scope is reachable.
    async function createQuote(input) {
      input = input || {};
      const companyId = input.company_id;
      const contactId = input.contact_id;
      if (!companyId) return { ok: false, code: "company_required", detail: "A quote needs a company." };
      if (!contactId) return { ok: false, code: "contact_required", detail: "A quote needs a contact." };
      const ctx = { scope: input.scope };
      const companyRes = await getCompany(companyId, ctx);
      if (!companyRes.ok) return companyRes;
      const company = companyRes.company;
      if (!company) return { ok: false, code: "company_not_found", detail: "That company is not available to you." };
      const contactRes = await getContact(contactId, ctx);
      if (!contactRes.ok) return contactRes;
      const contact = contactRes.contact;
      if (!contact) return { ok: false, code: "contact_not_found", detail: "That contact is not available to you." };
      if (contact.company_id !== companyId) return { ok: false, code: "contact_company_mismatch", detail: "That contact does not belong to that company." };

      let opportunity = null;
      if (input.opportunity_id) {
        const oppRes = await getOpportunity(input.opportunity_id, ctx);
        if (!oppRes.ok) return oppRes;
        opportunity = oppRes.opportunity;
        if (!opportunity) return { ok: false, code: "opportunity_not_found", detail: "That opportunity is not available to you." };
        if (opportunity.company_id !== companyId) return { ok: false, code: "opportunity_company_mismatch", detail: "That opportunity belongs to a different company." };
      }

      const id = input.id || genId(rand);
      let quote = {
        id,
        quote_number: null,
        company_id: company.id,
        company_name: company.name,
        contact_id: contact.id,
        contact_name: contact.name,
        contact_email: contact.email || null,
        opportunity_id: opportunity ? opportunity.id : null,
        opportunity_name: opportunity ? opportunity.name : null,
        title: input.title ? String(input.title) : (opportunity ? opportunity.name : company.name + " quote"),
        mode: normalizeMode(input.mode),
        status: "draft",
        created_at: nowIso(clock),
        created_by: input.actor || null,
        updated_at: nowIso(clock)
      };

      if (numbering && typeof numbering.attach === "function") {
        const num = await numbering.attach(quote, { at: input.at });
        if (!num.ok) return num;
        quote = num.quote || Object.assign({}, quote, { quote_number: num.number });
      }

      const saved = await persistNew(quote);
      if (!saved.ok) return saved;
      const auditRes = await auditAppend({
        quote_id: quote.id,
        event: "created",
        actor_type: input.actor ? "internal" : "system",
        actor: input.actor || "system",
        detail: { kind: "quote", quote_number: quote.quote_number, company_id: quote.company_id, contact_id: quote.contact_id, opportunity_id: quote.opportunity_id }
      });
      return { ok: true, quote: saved.quote || quote, revision: saved.revision, number: quote.quote_number, audit: auditRes };
    }

    // Task 61: import a quote from the legacy quoting tool. This is the ONE
    // quote-creation path that does NOT go through the gateway: a migrated quote
    // has no CRM account/contact to validate against, so the legacy identity is
    // recorded verbatim and re-keyed to a fresh internal quote id. The legacy
    // number is preserved when it is still free, otherwise a new number is
    // allocated. Audited as a normal `created` with an `imported` marker.
    async function importQuote(input) {
      input = input || {};
      const legacyRef = input.legacy_ref === undefined || input.legacy_ref === null ? null : String(input.legacy_ref);
      if (!legacyRef) return { ok: false, code: "legacy_ref_required", detail: "An imported quote needs its legacy reference." };
      const now = nowIso(clock);
      const id = input.id || genId(rand);
      let quote = {
        id,
        quote_number: null,
        company_id: input.company_id === undefined ? null : input.company_id,
        company_name: input.company_name ? String(input.company_name) : "Imported account",
        contact_id: input.contact_id === undefined ? null : input.contact_id,
        contact_name: input.contact_name ? String(input.contact_name) : null,
        contact_email: input.contact_email ? String(input.contact_email) : null,
        opportunity_id: null,
        opportunity_name: null,
        title: input.title ? String(input.title) : ("Imported quote " + legacyRef),
        mode: normalizeMode(input.mode),
        status: input.status ? String(input.status) : "draft",
        imported: true,
        legacy_ref: legacyRef,
        legacy_system: input.legacy_system ? String(input.legacy_system) : "legacy",
        legacy_status: input.legacy_status ? String(input.legacy_status) : (input.status ? String(input.status) : null),
        legacy_total_cents: Number.isSafeInteger(input.legacy_total_cents) ? input.legacy_total_cents : null,
        created_at: input.created_at ? String(input.created_at) : now,
        created_by: input.created_by ? String(input.created_by) : null,
        updated_at: now
      };
      // Preserve the legacy number only when it is not already taken.
      const wanted = input.quote_number === undefined || input.quote_number === null || input.quote_number === "" ? null : String(input.quote_number);
      if (wanted) {
        const l = await loadQuotes();
        if (!l.ok) return l;
        if (!l.records.some(r => r && String(r.quote_number) === wanted)) quote.quote_number = wanted;
      }
      if (!quote.quote_number && numbering && typeof numbering.attach === "function") {
        const num = await numbering.attach(quote, { at: input.at });
        if (!num.ok) return num;
        quote = num.quote || Object.assign({}, quote, { quote_number: num.number });
      }
      const saved = await persistNew(quote);
      if (!saved.ok) return saved;
      await auditAppend({
        quote_id: quote.id,
        event: "created",
        actor_type: "system",
        actor: input.actor || "migration",
        detail: { kind: "imported_quote", legacy_ref: legacyRef, legacy_system: quote.legacy_system, quote_number: quote.quote_number, legacy_total_cents: quote.legacy_total_cents }
      });
      return { ok: true, quote: saved.quote || quote, revision: saved.revision, number: quote.quote_number, legacy_ref: legacyRef, rekeyed: true };
    }

    // Create the PSA opportunity for a quote that has none.
    async function createOpportunity(quoteId, input, ctx) {      input = input || {};
      const q = await getQuote(quoteId, ctx);
      if (!q.ok) return q;
      if (!q.quote) return { ok: false, code: "quote_not_found", detail: `No quote ${quoteId} in scope.` };
      if (q.quote.opportunity_id) {
        return { ok: false, code: "already_linked", detail: "This quote is already linked to an opportunity.", opportunity_id: q.quote.opportunity_id };
      }
      const res = await psa("createOpportunity", {
        company_id: q.quote.company_id,
        name: input.name || q.quote.title || q.quote.company_name + " quote",
        stage: input.stage,
        amount_cents: input.amount_cents
      }, scopeOf(ctx), { by: (ctx && (ctx.actor || ctx.by)) || "system", note: "create PSA opportunity for " + quoteId });
      if (!res.ok) return res;
      const opp = res.result;
      const upd = await updateQuote(quoteId, { opportunity_id: opp.id, opportunity_name: opp.name });
      if (!upd.ok) {
        await auditAppend({ quote_id: quoteId, event: "error", actor_type: "system", actor: "system", detail: { action: "link_created_opportunity", opportunity_id: opp.id, code: upd.code } });
        return upd;
      }
      const auditRes = await auditAppend({ quote_id: quoteId, event: "opp_created", actor_type: "system", actor: "system", detail: { opportunity_id: opp.id, company_id: opp.company_id } });
      return { ok: true, quote: upd.quote, opportunity: opp, audit: auditRes };
    }

    // Link an existing PSA opportunity to a quote that has none.
    async function linkOpportunity(quoteId, opportunityId, ctx) {
      const q = await getQuote(quoteId, ctx);
      if (!q.ok) return q;
      if (!q.quote) return { ok: false, code: "quote_not_found", detail: `No quote ${quoteId} in scope.` };
      if (q.quote.opportunity_id) {
        return { ok: false, code: "already_linked", detail: "This quote is already linked to an opportunity.", opportunity_id: q.quote.opportunity_id };
      }
      const oppRes = await getOpportunity(opportunityId, ctx);
      if (!oppRes.ok) return oppRes;
      if (!oppRes.opportunity) return { ok: false, code: "opportunity_not_found", detail: "That opportunity is not available to you." };
      if (oppRes.opportunity.company_id !== q.quote.company_id) return { ok: false, code: "opportunity_company_mismatch", detail: "That opportunity belongs to a different company." };
      const upd = await updateQuote(quoteId, { opportunity_id: oppRes.opportunity.id, opportunity_name: oppRes.opportunity.name });
      if (!upd.ok) return upd;
      return { ok: true, quote: upd.quote, opportunity: oppRes.opportunity };
    }

    // Task 57: flip a quote's mode (quote ↔ prospect). Promoting a prospect to
    // a normal quote (or demoting a quote) is a deliberate, audited act; the
    // rest of the spine is mode-agnostic.
    async function setMode(quoteId, mode, ctx) {
      const next = String(mode);
      if (MODES.indexOf(next) === -1) return { ok: false, code: "bad_mode", detail: `Unknown quote mode "${next}"; expected one of ${MODES.join(" | ")}.` };
      const q = await getQuote(quoteId, ctx);
      if (!q.ok) return q;
      if (!q.quote) return { ok: false, code: "quote_not_found", detail: `No quote ${quoteId} in scope.` };
      const from = q.quote.mode || "quote";
      if (from === next) return { ok: true, quote: q.quote, unchanged: true };
      const upd = await updateQuote(quoteId, { mode: next });
      if (!upd.ok) return upd;
      await auditAppend({
        quote_id: quoteId,
        event: "revised",
        actor_type: "internal",
        actor: (ctx && ctx.actor) || "system",
        detail: { action: "mode_changed", from: from, mode: next }
      });
      return { ok: true, quote: upd.quote, from: from, mode: next };
    }

    return {
      doc,
      defaultScope,
      listCompanies,
      getCompany,
      listContacts,
      getContact,
      listOpportunities,
      getOpportunity,
      listQuotes,
      getQuote,
      createQuote,
      importQuote,
      createOpportunity,
      linkOpportunity,
      setMode,
      updateQuote
    };
  }

  return { createService, genId, DOC, MODES, normalizeMode };
})();
