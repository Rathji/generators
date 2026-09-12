// ============================================================================
// quote-u — read-only quote connector / API (roadmap task 59)
// ----------------------------------------------------------------------------
// A READ-ONLY window onto quoting state for the rest of the pipeline. Other
// tools (the knowledge base, BI, a dashboard) can search quotes, read one
// quote's current detail, and page its lifecycle events — and can NEVER write
// through this door:
//
//   quoteread.search        (query, filter) → matching quote summaries
//   quoteread.getQuote      (id | quote_number) → one quote's full read detail
//   quoteread.getQuoteEvents(id, filter) → the quote's append-only events
//
// It is exposed as a CONNECTOR on the connector gateway, so it is allowlisted,
// centralized, logged and (role-)gated exactly like every other cross-system
// call — the gateway manifest declares every function `read`. Nothing in this
// module mutates storage: the DTO builders are pure and the service only calls
// the read methods of the services it is handed.
//
// The DTO deliberately carries the CLIENT-VISIBLE sell side (totals, deal value,
// decision) and never unit cost or margin. Margin analysis is the analytics
// extract's job (roadmap task 60), a separate, deliberate surface.
// ============================================================================
window.QU_QUOTEREAD = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const CONNECTOR = "quoteread";
  const DEFAULT_LIMIT = 50;
  const MAX_LIMIT = 500;

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }
  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.records)) return v.records;
    return [];
  }
  function str(v) {
    return v === undefined || v === null ? null : String(v);
  }
  function numOrNull(v) {
    return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
  }

  // A quote summary row — the shape a search result (or a list) returns.
  function quoteSummary(quote) {
    if (!quote || typeof quote !== "object") return null;
    return {
      id: str(quote.id),
      quote_number: str(quote.quote_number),
      title: quote.title === undefined ? null : quote.title,
      mode: quote.mode ? String(quote.mode) : "quote",
      status: quote.status ? String(quote.status) : null,
      company_id: str(quote.company_id),
      company_name: quote.company_name === undefined ? null : quote.company_name,
      contact_id: str(quote.contact_id),
      contact_name: quote.contact_name === undefined ? null : quote.contact_name,
      opportunity_id: str(quote.opportunity_id),
      created_at: quote.created_at === undefined ? null : quote.created_at,
      created_by: quote.created_by === undefined ? null : quote.created_by,
      updated_at: quote.updated_at === undefined ? null : quote.updated_at
    };
  }

  function versionDto(version) {
    if (!version || typeof version !== "object") return null;
    return {
      id: str(version.id),
      version_number: version.version_number === undefined ? null : version.version_number,
      state: version.state ? String(version.state) : null,
      title: version.title === undefined ? null : version.title,
      frozen_at: version.frozen_at === undefined ? null : version.frozen_at,
      frozen_by: version.frozen_by === undefined ? null : version.frozen_by,
      revised_from: version.revised_from === undefined ? null : version.revised_from,
      created_at: version.created_at === undefined ? null : version.created_at,
      updated_at: version.updated_at === undefined ? null : version.updated_at
    };
  }

  // The acceptance summary. No signature body (it can be large) — only whether
  // the signature is present, plus the decision and the recomputed totals.
  function approvalDto(approval) {
    if (!approval || typeof approval !== "object") return null;
    return {
      id: str(approval.id),
      version_id: str(approval.version_id),
      decision: approval.decision === undefined ? "approved" : String(approval.decision),
      approver_name: approval.approver_name === undefined ? null : approval.approver_name,
      approved_at: approval.approved_at === undefined ? null : approval.approved_at,
      selection: Array.isArray(approval.selection) ? approval.selection.map(String) : [],
      one_time_cents: numOrNull(approval.one_time_cents),
      mrr_cents: numOrNull(approval.mrr_cents),
      twelve_month_value_cents: numOrNull(approval.twelve_month_value_cents),
      deal_value_cents: numOrNull(approval.deal_value_cents),
      currency: approval.currency === undefined ? null : approval.currency,
      signature_present: !!approval.signature
    };
  }

  // The lifecycle event as the read API presents it. The token id (never the
  // secret) is included; a raw payload is not.
  function eventDto(event) {
    if (!event || typeof event !== "object") return null;
    return {
      seq: event.seq === undefined ? null : event.seq,
      id: str(event.id),
      quote_id: str(event.quote_id),
      version_id: str(event.version_id),
      event: event.event ? String(event.event) : null,
      actor_type: event.actor_type ? String(event.actor_type) : null,
      actor: event.actor === undefined ? null : event.actor,
      token_id: str(event.token_id),
      at: event.at === undefined ? null : event.at,
      detail: isPlainObject(event.detail) ? event.detail : {}
    };
  }

  // One quote's full read detail: the quote, its versions (oldest first), the
  // latest version's client-safe totals and its acceptance summary.
  function quoteDetail(input) {
    input = input || {};
    const quote = input.quote || null;
    if (!quote) return null;
    const versions = asArray(input.versions).filter(v => v && String(v.quote_id) === String(quote.id));
    versions.sort((a, b) => (a.version_number || 0) - (b.version_number || 0));
    const approval = input.approval || null;
    return {
      quote: quoteSummary(quote),
      versions: versions.map(versionDto),
      latest_version: versions.length ? versionDto(versions[versions.length - 1]) : null,
      totals: input.totals || null,
      approval: approvalDto(approval),
      event_count: Array.isArray(input.events) ? input.events.length : (typeof input.event_count === "number" ? input.event_count : null)
    };
  }

  // Free-text match across the fields a human would search by.
  function matchesQuery(quote, query) {
    const q = String(query == null ? "" : query).trim().toLowerCase();
    if (!q) return true;
    const hay = [quote.id, quote.quote_number, quote.title, quote.company_name, quote.contact_name, quote.opportunity_name, quote.mode, quote.status]
      .filter(v => v !== undefined && v !== null)
      .join(" ")
      .toLowerCase();
    return q.split(/\s+/).every(tok => hay.indexOf(tok) !== -1);
  }

  function normalizeFilter(input) {
    const f = isPlainObject(input) ? input : {};
    let limit = Number.isInteger(f.limit) && f.limit > 0 ? f.limit : DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    return {
      company_id: f.company_id === undefined || f.company_id === null || f.company_id === "" ? null : String(f.company_id),
      opportunity_id: f.opportunity_id === undefined || f.opportunity_id === null || f.opportunity_id === "" ? null : String(f.opportunity_id),
      mode: f.mode === undefined || f.mode === null || f.mode === "" ? null : String(f.mode),
      status: f.status === undefined || f.status === null || f.status === "" ? null : String(f.status),
      limit: limit
    };
  }

  // ---- the service ----------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const quotes = opts.quotes || null;
    const versions = opts.versions || null;
    const approvals = opts.approvals || null;
    const audit = opts.audit || null;
    const scope = opts.scope === undefined ? "*" : opts.scope;

    async function listQuoteRecords() {
      if (!quotes || typeof quotes.listQuotes !== "function") return { ok: false, code: "no_quotes", detail: "The read-only API needs the quote service." };
      const r = await quotes.listQuotes({ scope: scope }, {});
      if (!r || !r.ok) return { ok: false, code: (r && r.code) || "list_failed", detail: (r && r.detail) || "Could not read quotes." };
      return { ok: true, quotes: r.quotes || [] };
    }

    async function findQuote(idOrNumber) {
      const l = await listQuoteRecords();
      if (!l.ok) return l;
      const key = String(idOrNumber == null ? "" : idOrNumber);
      if (!key) return { ok: true, quote: null };
      const quote = l.quotes.find(q => q && (String(q.id) === key || String(q.quote_number) === key)) || null;
      return { ok: true, quote: quote };
    }

    async function search(query, filter) {
      const l = await listQuoteRecords();
      if (!l.ok) return l;
      const f = normalizeFilter(filter);
      let recs = l.quotes.filter(q => q && matchesQuery(q, query));
      if (f.company_id) recs = recs.filter(q => String(q.company_id) === f.company_id);
      if (f.opportunity_id) recs = recs.filter(q => String(q.opportunity_id) === f.opportunity_id);
      if (f.mode) recs = recs.filter(q => String(q.mode || "quote") === f.mode);
      if (f.status) recs = recs.filter(q => String(q.status) === f.status);
      recs = recs.slice().sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")));
      const total = recs.length;
      return { ok: true, total: total, count: Math.min(total, f.limit), results: recs.slice(0, f.limit).map(quoteSummary) };
    }

    async function getQuote(idOrNumber) {
      const found = await findQuote(idOrNumber);
      if (!found.ok) return found;
      if (!found.quote) return { ok: true, quote: null };
      const quote = found.quote;
      let allVersions = [], approval = null, totals = null, events = null;
      if (versions && typeof versions.listVersions === "function") {
        const r = await versions.listVersions(quote.id);
        if (r && r.ok) allVersions = r.versions || [];
      }
      if (approvals && typeof approvals.list === "function") {
        const r = await approvals.list({ quote_id: quote.id });
        if (r && r.ok && (r.approvals || []).length) approval = r.approvals[0];
      }
      const latest = allVersions.length ? allVersions[allVersions.length - 1] : null;
      if (latest && versions && typeof versions.totals === "function") {
        const r = await versions.totals(latest.id, undefined);
        if (r && r.ok) totals = r.totals || null;
      }
      if (audit && typeof audit.forQuote === "function") {
        const r = await audit.forQuote(quote.id, {});
        if (r && r.ok) events = r.records || [];
      }
      return { ok: true, quote: quoteDetail({ quote: quote, versions: allVersions, approval: approval, totals: totals, events: events }) };
    }

    async function getQuoteEvents(idOrNumber, filter) {
      const found = await findQuote(idOrNumber);
      if (!found.ok) return found;
      if (!found.quote) return { ok: true, quote: null, events: [] };
      if (!audit || typeof audit.forQuote !== "function") return { ok: false, code: "no_audit", detail: "The read-only API needs the audit log." };
      const f = isPlainObject(filter) ? filter : {};
      const r = await audit.forQuote(found.quote.id, { order: f.order === "desc" ? "desc" : "asc", limit: Number.isInteger(f.limit) ? f.limit : undefined });
      if (!r || !r.ok) return { ok: false, code: (r && r.code) || "events_failed", detail: (r && r.detail) || "Could not read events." };
      return { ok: true, quote_id: found.quote.id, total: r.records.length, events: r.records.map(eventDto) };
    }

    function ready() { return Promise.resolve({ ok: true }); }

    return { CONNECTOR, search, getQuote, getQuoteEvents, ready, quoteSummary, quoteDetail, versionDto, approvalDto, eventDto };
  }

  // ---- the gateway connector ------------------------------------------------
  // Every function is a READ. The descriptor marks the connector read-only and
  // declares each function's effect so the gateway manifest proves it.
  function createConnector(opts) {
    opts = opts || {};
    const service = opts.service;
    if (!service || typeof service.search !== "function") throw new Error("QU_QUOTEREAD.createConnector needs a service.");
    async function unwrap(promise) {
      const r = await promise;
      if (r && r.ok === false) throw Object.assign(new Error(r.detail || r.code), { code: r.code || "read_failed" });
      return r;
    }
    const functions = {
      search(payload) { return unwrap(service.search(payload && payload.query, payload && payload.filter)); },
      getQuote(payload) { return unwrap(service.getQuote(payload && (payload.id || payload.quote_number))); },
      getQuoteEvents(payload) { return unwrap(service.getQuoteEvents(payload && (payload.id || payload.quote_number), payload && payload.filter)); }
    };
    return {
      name: CONNECTOR,
      functions: functions,
      readOnly: true,
      live: false,
      descriptor: {
        label: "Read-only quotes",
        kind: "read",
        gateway_key: null,
        roles: ["owner", "manager", "viewer"],
        functions: {
          search: { effect: "read" },
          getQuote: { effect: "read" },
          getQuoteEvents: { effect: "read" }
        }
      }
    };
  }

  return {
    VERSION,
    CONNECTOR,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    quoteSummary,
    versionDto,
    approvalDto,
    eventDto,
    quoteDetail,
    matchesQuery,
    normalizeFilter,
    createService,
    createConnector
  };
})();
