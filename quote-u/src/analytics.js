// ============================================================================
// quote-u — analytics & BI handoff (roadmap task 60)
// ----------------------------------------------------------------------------
// A SCHEMA-STABLE extract of quoting state for the pipeline's BI tool and
// analytics ingestion, so win-rate and margin analysis can be done OUTSIDE
// quote-u without coupling the two systems to each other's storage or release
// cadence.
//
// The extract is three flat tables, versioned by SCHEMA_VERSION:
//
//   quotes     — one row per quote (identity, account, mode, version count)
//   decisions  — one row per DECIDED version (approved/declined/expired) with
//                the sent→decided cycle time and the sell-side totals
//   margins    — one row per ACCEPTED version (INTERNAL: sell vs cost vs margin)
//
// SCHEMA STABILITY is enforced, not hoped for: every table has a frozen ordered
// column list (`TABLES`), rows are projected to exactly those columns, `verify`
// fails on a missing/extra/renamed column, and `fingerprint` gives the schema a
// content hash a consumer can pin. Adding or renaming a column is a deliberate
// act that bumps SCHEMA_VERSION.
//
// The extract is delivered through the connector gateway as a versioned
// envelope on the shared pipeline bus (stream `bus-quote-analytics`), so the
// handoff is allowlisted, gated and logged like every other cross-system write.
// CSV/JSON renderers are provided for a file-drop ingestion path as well.
// ============================================================================
window.QU_ANALYTICS = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u analytics require window.QU_MONEY (load src/money.js first)");
  const REPORTS = window.QU_REPORTS || null;

  const VERSION = "1.0.0";
  const SCHEMA = "quote-u.analytics";
  const SCHEMA_VERSION = 1;
  const STREAM = "bus-quote-analytics";
  const SOURCE = "quote-u";
  const EXTRACT_TYPE = "pipeline.analytics-extract";

  // The frozen, ordered column lists — the schema. A consumer pins these.
  const TABLES = Object.freeze({
    quotes: Object.freeze([
      "quote_id", "quote_number", "mode", "status", "company_id", "company_name",
      "contact_id", "created_at", "created_by", "opportunity_id",
      "version_count", "latest_version_id", "latest_state"
    ]),
    decisions: Object.freeze([
      "version_id", "quote_id", "quote_number", "company_id", "company_name", "rep",
      "mode", "decision", "sent_at", "decided_at", "cycle_days",
      "one_time_cents", "mrr_cents", "twelve_month_value_cents", "deal_value_cents",
      "currency", "approver_name", "line_count", "selected_count"
    ]),
    margins: Object.freeze([
      "version_id", "quote_id", "quote_number", "company_id", "company_name", "rep",
      "approved_at", "sell_cents", "cost_cents", "margin_cents", "margin_bp",
      "missing_cost_lines", "currency"
    ])
  });

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.records)) return v.records;
    return [];
  }
  function str(v) { return v === undefined || v === null ? null : String(v); }
  function dayDiff(aMs, bMs) {
    if (aMs === null || bMs === null || bMs < aMs) return null;
    return Math.round(((bMs - aMs) / 86400000) * 1000) / 1000;
  }
  function project(row, columns) {
    const out = {};
    columns.forEach(c => { out[c] = row[c] === undefined ? null : row[c]; });
    return out;
  }

  function schema() {
    const tables = {};
    Object.keys(TABLES).forEach(t => { tables[t] = TABLES[t].slice(); });
    return { name: SCHEMA, version: SCHEMA_VERSION, tables: tables };
  }

  // A deterministic content hash of the schema (order-sensitive), so a consumer
  // can pin exactly the shape it ingested.
  function fingerprint() {
    const text = SCHEMA + "@" + SCHEMA_VERSION + "|" + Object.keys(TABLES).map(t => t + ":" + TABLES[t].join(",")).join(";");
    let h = 0x811c9dc5;
    for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
    return "qax-" + h.toString(16).padStart(8, "0") + "-" + String(text.length);
  }

  // Build the decisions + margins rows from the version facts (shared with the
  // reports engine, so the extract and the dashboards can never disagree).
  function rowsFrom(dataset) {
    const facts = REPORTS ? REPORTS.versionFacts(dataset, {}) : [];
    const quotes = asArray(dataset && dataset.quotes);
    const versions = asArray(dataset && dataset.versions);
    const currency = M.DEFAULT_CURRENCY;

    const byQuote = new Map();
    versions.forEach(v => {
      if (!v || v.quote_id === undefined || v.quote_id === null) return;
      const k = String(v.quote_id);
      if (!byQuote.has(k)) byQuote.set(k, []);
      byQuote.get(k).push(v);
    });

    const quoteRows = quotes.map(q => {
      if (!q) return null;
      const vs = (byQuote.get(String(q.id)) || []).slice().sort((a, b) => (a.version_number || 0) - (b.version_number || 0));
      const latest = vs.length ? vs[vs.length - 1] : null;
      return {
        quote_id: str(q.id),
        quote_number: q.quote_number === undefined ? null : q.quote_number,
        mode: q.mode ? String(q.mode) : "quote",
        status: q.status ? String(q.status) : null,
        company_id: str(q.company_id),
        company_name: q.company_name === undefined ? null : q.company_name,
        contact_id: str(q.contact_id),
        created_at: q.created_at === undefined ? null : q.created_at,
        created_by: q.created_by === undefined ? null : q.created_by,
        opportunity_id: str(q.opportunity_id),
        version_count: vs.length,
        latest_version_id: latest ? str(latest.id) : null,
        latest_state: latest && latest.state ? String(latest.state) : null
      };
    }).filter(Boolean);

    const decisions = facts.filter(f => f.decision === "approved" || f.decision === "declined" || f.decision === "expired").map(f => ({
      version_id: f.version_id,
      quote_id: f.quote_id,
      quote_number: f.quote_number,
      company_id: f.company_id,
      company_name: f.company_name,
      rep: f.rep,
      mode: f.mode,
      decision: f.decision,
      sent_at: f.sent_at,
      decided_at: f.decided_at,
      cycle_days: dayDiff(REPORTS.toMs(f.sent_at), REPORTS.toMs(f.decided_at)),
      one_time_cents: f.one_time_cents,
      mrr_cents: f.mrr_cents,
      twelve_month_value_cents: f.twelve_month_value_cents,
      deal_value_cents: f.deal_value_cents,
      currency: currency,
      approver_name: f.approver_name || null,
      line_count: f.line_count,
      selected_count: f.selected_count
    }));

    const margins = facts.filter(f => f.approved).map(f => ({
      version_id: f.version_id,
      quote_id: f.quote_id,
      quote_number: f.quote_number,
      company_id: f.company_id,
      company_name: f.company_name,
      rep: f.rep,
      approved_at: f.approved_at || f.decided_at,
      sell_cents: f.sell_cents,
      cost_cents: f.cost_cents,
      margin_cents: f.margin_cents,
      margin_bp: f.margin_bp,
      missing_cost_lines: f.missing_cost_lines,
      currency: currency
    }));

    return { quotes: quoteRows, decisions: decisions, margins: margins };
  }

  // The full extract: schema + generated_at + the three tables, each projected
  // to its frozen columns so the shape is exactly the schema.
  function extractFrom(tablesIn, opts) {
    opts = opts || {};
    const raw = tablesIn || {};
    const tables = {};
    Object.keys(TABLES).forEach(t => { tables[t] = asArray(raw[t]).map(r => project(r, TABLES[t])); });
    const generatedAt = opts.generated_at || new Date().toISOString();
    return {
      schema: SCHEMA,
      version: SCHEMA_VERSION,
      fingerprint: fingerprint(),
      generated_at: generatedAt,
      source: opts.source ? String(opts.source) : SOURCE,
      counts: { quotes: tables.quotes.length, decisions: tables.decisions.length, margins: tables.margins.length },
      tables: tables
    };
  }

  function extract(dataset, opts) {
    return extractFrom(rowsFrom(dataset), opts);
  }

  // Verify every row matches the frozen schema exactly (no missing/extra keys).
  function verify(ex) {
    const violations = [];
    if (!isPlainObject(ex)) return { ok: false, violations: [{ code: "bad_extract", detail: "An extract must be an object." }] };
    if (ex.schema !== SCHEMA) violations.push({ code: "bad_schema", detail: `Expected schema ${SCHEMA}.` });
    if (ex.version !== SCHEMA_VERSION) violations.push({ code: "bad_version", detail: `Expected schema version ${SCHEMA_VERSION}, got ${ex.version}.` });
    if (!isPlainObject(ex.tables)) return { ok: false, violations: violations.concat([{ code: "no_tables", detail: "The extract has no tables." }]) };
    Object.keys(TABLES).forEach(t => {
      const cols = TABLES[t];
      const rows = ex.tables[t];
      if (!Array.isArray(rows)) { violations.push({ code: "missing_table", detail: `Table ${t} is missing.` }); return; }
      rows.forEach((r, i) => {
        if (!isPlainObject(r)) { violations.push({ code: "bad_row", detail: `${t}[${i}] is not an object.` }); return; }
        const keys = Object.keys(r);
        const missing = cols.filter(c => keys.indexOf(c) === -1);
        const extra = keys.filter(k => cols.indexOf(k) === -1);
        if (missing.length) violations.push({ code: "missing_column", detail: `${t}[${i}] missing ${missing.join(",")}.` });
        if (extra.length) violations.push({ code: "extra_column", detail: `${t}[${i}] has ${extra.join(",")}.` });
      });
    });
    return { ok: violations.length === 0, violations: violations, counts: ex.counts || null };
  }

  function csvCell(v) {
    if (v === undefined || v === null) return "";
    const s = String(v);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function toCsv(rows, columns) {
    const cols = columns || [];
    const head = cols.map(csvCell).join(",");
    const body = (rows || []).map(r => cols.map(c => csvCell(r ? r[c] : "")).join(",")).join("\n");
    return head + (body ? "\n" + body : "") + "\n";
  }

  // A CSV per table, keyed by file name — the file-drop ingestion path.
  function csvBundle(ex) {
    const out = {};
    Object.keys(TABLES).forEach(t => { out[t + ".csv"] = toCsv((ex.tables && ex.tables[t]) || [], TABLES[t]); });
    out["schema.json"] = JSON.stringify(schema(), null, 2);
    return out;
  }

  // ---- the service ----------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const gateway = opts.gateway || null;
    const store = opts.store || null;
    const policy = isPlainObject(opts.policy) ? opts.policy : {};
    const stream = policy.stream ? String(policy.stream) : STREAM;
    const source = policy.source ? String(policy.source) : SOURCE;
    const generatorName = opts.generatorName || null;

    let lastPublished = null;

    async function loadDataset() {
      const out = { quotes: [], versions: [], approvals: [], events: [], lines: [], groups: [] };
      const quotes = opts.quotes, versions = opts.versions, approvals = opts.approvals, audit = opts.audit;
      if (quotes && typeof quotes.listQuotes === "function") {
        const r = await quotes.listQuotes({ scope: opts.scope === undefined ? "*" : opts.scope }, {});
        if (r && r.ok) out.quotes = r.quotes || [];
      }
      if (versions && typeof versions.listVersions === "function") {
        const r = await versions.listVersions();
        if (r && r.ok) out.versions = r.versions || [];
      }
      if (audit && typeof audit.list === "function") {
        const r = await audit.list({});
        if (r && r.ok) out.events = r.records || [];
      }
      if (approvals && typeof approvals.list === "function") {
        const r = await approvals.list({});
        if (r && r.ok) out.approvals = r.approvals || [];
      }
      if (store && typeof store.loadDoc === "function") {
        const lines = await store.loadDoc("line_items");
        if (lines && lines.ok && lines.content) out.lines = asArray(lines.content);
        const groups = await store.loadDoc("option_groups");
        if (groups && groups.ok && groups.content) out.groups = asArray(groups.content);
      }
      return out;
    }

    async function buildExtract(o) {
      const ds = opts.dataset ? opts.dataset : await loadDataset();
      return extract(ds, { source: source, generated_at: o && o.generated_at });
    }

    // Publish the extract to the shared analytics stream through the gateway.
    // The envelope is versioned exactly like a bus event; publishing is a gated
    // write (`bus.publish`, already approved in the write policy).
    async function publish(ex, o) {
      o = o || {};
      const body = ex || await buildExtract(o);
      const v = verify(body);
      if (!v.ok) return { ok: false, code: "extract_invalid", detail: "The extract does not match its schema.", violations: v.violations };
      if (!gateway || typeof gateway.call !== "function") return { ok: false, code: "no_gateway", detail: "The analytics handoff needs the connector gateway." };
      const at = o.at || new Date().toISOString();
      const envelope = {
        schema: EXTRACT_TYPE,
        version: SCHEMA_VERSION,
        id: "ax-" + fingerprint() + "-" + at.replace(/[^0-9]/g, "").slice(0, 14),
        type: EXTRACT_TYPE,
        source: source,
        stream: stream,
        at: at,
        key: "analytics:" + source,
        subject: { kind: "analytics", id: source, version_id: null, company_id: null },
        actor: { type: "system", id: o.by ? String(o.by) : "analytics" },
        data: { schema: body.schema, fingerprint: body.fingerprint, counts: body.counts, generated_at: body.generated_at },
        tables: body.tables,
        meta: { generator: generatorName }
      };
      const res = gateway.call("bus", "publish", { stream: stream, envelope: envelope }, {
        scope: "*",
        confirm: { by: o.by ? String(o.by) : "analytics", note: "publish analytics extract " + body.fingerprint }
      });
      if (!res || !res.ok) return { ok: false, code: (res && res.code) || "publish_failed", detail: (res && res.detail) || "The analytics extract could not be published." };
      lastPublished = { at: at, fingerprint: body.fingerprint, counts: body.counts, id: envelope.id };
      return { ok: true, id: envelope.id, at: at, fingerprint: body.fingerprint, counts: body.counts, stream: stream };
    }

    function history() { return lastPublished ? Object.assign({}, lastPublished) : null; }
    function ready() { return Promise.resolve({ ok: true }); }

    return { buildExtract, extract: buildExtract, publish, history, ready, schema, fingerprint, STREAM: stream };
  }

  return {
    VERSION,
    SCHEMA,
    SCHEMA_VERSION,
    STREAM,
    SOURCE,
    EXTRACT_TYPE,
    TABLES,
    schema,
    fingerprint,
    rowsFrom,
    extract,
    extractFrom,
    verify,
    toCsv,
    csvBundle,
    createService
  };
})();
