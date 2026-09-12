// ============================================================================
// quote-u — legacy quoting migration (roadmap task 61)
// ----------------------------------------------------------------------------
// Bring the legacy quoting tool's data across and put the old tool to rest:
//
//   • import the CATALOG        — map legacy product rows → catalog items
//   • migrate / RE-KEY open     — create quote-u quotes (fresh ids) from legacy
//     quotes                      open quotes, preserving the legacy number when
//                                 free, with their lines as a draft version
//   • EXPORT historical quotes  — project decided legacy quotes into the
//                                 schema-stable analytics extract (task 60) for
//                                 BI ingestion
//   • put legacy READ-ONLY      — a recorded CUTOVER marks the legacy tool as
//                                 read-only (this adapter never writes back)
//   • RECONCILE                 — a documented report of record counts and
//                                 totals (source vs imported, with variances)
//
// The legacy source is a CSV or JSON import adapter (`parseCsv` + mappers).
// Everything is pure up to the service, which writes through the same
// version-guarded store as the rest of quote-u and keeps a durable
// `legacy_migrations` record of each run (the reconciliation of record).
// ============================================================================
window.QU_LEGACY = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u legacy migration requires window.QU_MONEY (load src/money.js first)");
  const A = window.QU_ANALYTICS || null;

  const VERSION = "1.0.0";
  const DOC = "legacy_migrations";
  const LEGACY_SYSTEM = "legacy";
  const DEFAULT_MAX_RETRIES = 4;

  // The columns each legacy table is expected to carry (aliases accepted below).
  const COLUMNS = Object.freeze({
    catalog: ["sku", "mpn", "description", "category", "kind", "unit_cost", "markup_bp", "currency", "active"],
    quotes: ["quote_number", "company", "contact", "title", "status", "created_at", "rep", "one_time", "mrr", "total", "currency"],
    lines: ["quote_number", "description", "mpn", "sku", "quantity", "unit_price", "unit_cost", "kind"],
    history: ["quote_number", "company", "rep", "decision", "sent_at", "decided_at", "one_time", "mrr", "total", "sell", "cost", "currency"]
  });

  function isPlainObject(v) { return !!v && typeof v === "object" && !Array.isArray(v); }
  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.records)) return v.records;
    return [];
  }
  function str(v) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    return s ? s : null;
  }
  function slug(s) {
    return String(s == null ? "" : s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60);
  }
  function field(row, names) {
    for (const n of names) {
      if (row && row[n] !== undefined && row[n] !== null && String(row[n]).trim() !== "") return row[n];
    }
    return undefined;
  }

  // Money text → integer cents (null when unparseable/empty).
  function moneyToCents(text) {
    const s = str(text);
    if (s === null) return null;
    try { return M.parse(s, { currency: M.DEFAULT_CURRENCY }); } catch (e) { return null; }
  }
  function intOf(text) {
    const s = str(text);
    if (s === null) return null;
    const cleaned = s.replace(/[^0-9.\-]/g, "");
    if (cleaned === "" || isNaN(Number(cleaned))) return null;
    return Math.round(Number(cleaned));
  }
  function boolOf(text, def) {
    const s = str(text);
    if (s === null) return def;
    return !/^(false|0|no|inactive|n)$/i.test(s);
  }

  // ---- CSV / JSON adapters --------------------------------------------------

  // A small RFC4180-style CSV parser: quoted fields, embedded commas/quotes and
  // CRLF. Returns { header, rows, errors } where each row is an object keyed by
  // the (trimmed) header.
  function parseCsv(text) {
    const errors = [];
    const src = String(text == null ? "" : text);
    const table = [];
    let field = "";
    let row = [];
    let inQuotes = false;
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (inQuotes) {
        if (c === '"') {
          if (src[i + 1] === '"') { field += '"'; i++; }
          else inQuotes = false;
        } else field += c;
      } else if (c === '"') {
        inQuotes = true;
      } else if (c === ",") {
        row.push(field); field = "";
      } else if (c === "\n" || c === "\r") {
        if (c === "\r" && src[i + 1] === "\n") i++;
        row.push(field); field = "";
        table.push(row); row = [];
      } else field += c;
    }
    row.push(field);
    table.push(row);
    const nonEmpty = table.filter(r => r.length && !(r.length === 1 && String(r[0]).trim() === ""));
    if (!nonEmpty.length) return { header: [], rows: [], errors: [{ code: "empty", detail: "No CSV rows found." }] };
    const header = nonEmpty[0].map(h => String(h).trim());
    const rows = nonEmpty.slice(1).map((r, i) => {
      if (r.length !== header.length) errors.push({ code: "ragged_row", detail: `Row ${i + 2} has ${r.length} cells, expected ${header.length}.` });
      const obj = {};
      header.forEach((h, j) => { obj[h] = r[j] === undefined ? null : r[j]; });
      return obj;
    });
    return { header: header, rows: rows, errors: errors };
  }

  // Accept either parsed rows or raw text/JSON, and return the row array.
  function readRows(input) {
    if (input === undefined || input === null) return [];
    if (typeof input === "string") {
      const s = input.trim();
      if (!s) return [];
      if (s.charAt(0) === "[" || s.charAt(0) === "{") {
        try {
          const j = JSON.parse(s);
          if (Array.isArray(j)) return j;
          if (isPlainObject(j)) {
            for (const k of ["rows", "items", "records", "data", "catalog", "quotes", "lines", "history"]) {
              if (Array.isArray(j[k])) return j[k];
            }
          }
          return [];
        } catch (e) { return []; }
      }
      return parseCsv(s).rows;
    }
    if (Array.isArray(input)) return input;
    if (isPlainObject(input)) {
      for (const k of ["rows", "items", "records", "data"]) if (Array.isArray(input[k])) return input[k];
    }
    return [];
  }

  // ---- mappers (legacy row → quote-u input) ---------------------------------

  function mapCatalogRow(row) {
    const sku = str(field(row, ["sku", "SKU", "code"]));
    const mpn = str(field(row, ["mpn", "MPN", "manufacturer_part_number", "part_number", "mfr_part"]));
    const description = str(field(row, ["description", "desc", "name", "product", "item"]));
    const category = str(field(row, ["category", "type", "group"])) || "other";
    const kindText = (str(field(row, ["kind", "billing_kind", "frequency"])) || "").toLowerCase();
    const kind = /mrr|month|recur|subscription/.test(kindText) ? "mrr" : "one_time";
    const cost = moneyToCents(field(row, ["unit_cost", "cost", "cost_cents", "unit_cost_cents"]));
    const markup = intOf(field(row, ["markup_bp", "markup", "margin_bp"]));
    const id = "cat-legacy-" + (slug(sku) || slug(mpn) || slug(description) || "item");
    return {
      id: id,
      sku: sku || null,
      manufacturer_part_number: mpn || null,
      description: description || sku || mpn || "Imported item",
      category: category,
      default_kind: kind,
      unit_cost_cents: cost === null ? 0 : cost,
      default_markup_bp: markup === null ? 0 : markup,
      currency: str(field(row, ["currency"])) || M.DEFAULT_CURRENCY,
      active: boolOf(field(row, ["active", "enabled", "status"]), true),
      legacy_ref: sku || mpn || null
    };
  }

  function mapLineRow(row) {
    const qn = str(field(row, ["quote_number", "quote", "quote_no", "number", "ref"]));
    const desc = str(field(row, ["description", "desc", "item", "product"]));
    const kindText = (str(field(row, ["kind", "billing_kind", "frequency"])) || "").toLowerCase();
    const qty = intOf(field(row, ["quantity", "qty"])) || 1;
    const sell = moneyToCents(field(row, ["unit_price", "unit_sell", "price", "sell", "unit_sell_cents"]));
    const cost = moneyToCents(field(row, ["unit_cost", "cost", "unit_cost_cents"]));
    return {
      quote_number: qn,
      description: desc || "Imported line",
      manufacturer_part_number: str(field(row, ["mpn", "manufacturer_part_number", "part_number"])) || null,
      sku: str(field(row, ["sku", "code"])) || null,
      quantity: qty < 0 ? 0 : qty,
      kind: /mrr|month|recur|subscription/.test(kindText) ? "mrr" : "one_time",
      unit_sell_cents: sell === null ? 0 : sell,
      unit_cost_cents: cost === null ? 0 : cost
    };
  }

  function mapQuoteRow(row, lines) {
    const qn = str(field(row, ["quote_number", "quote", "quote_no", "number", "ref"]));
    const company = str(field(row, ["company", "account", "customer", "client"])) || "Imported account";
    const contact = str(field(row, ["contact", "contact_name"]));
    const title = str(field(row, ["title", "subject", "name"])) || (company + " quote");
    const status = str(field(row, ["status", "state"])) || "draft";
    const oneTime = moneyToCents(field(row, ["one_time", "one_time_cents"]));
    const mrr = moneyToCents(field(row, ["mrr", "mrr_cents"]));
    const total = moneyToCents(field(row, ["total", "total_cents", "amount", "value"]));
    const legacyRef = qn || str(field(row, ["id", "legacy_id", "ref"])) || ("row-" + Math.random().toString(36).slice(2, 8));
    return {
      legacy_ref: legacyRef,
      quote_number: qn,
      company_id: "legacy-" + (slug(company) || "account"),
      company_name: company,
      contact_id: contact ? "legacy-" + (slug(contact) || "contact") : null,
      contact_name: contact,
      title: title,
      status: /sent|viewed|open|pending|approved|won|won|lost|declined|expired/i.test(status) ? status : "draft",
      legacy_status: status,
      created_at: str(field(row, ["created_at", "created", "date"])) || null,
      created_by: str(field(row, ["rep", "owner", "created_by", "sales_rep"])) || null,
      currency: str(field(row, ["currency"])) || M.DEFAULT_CURRENCY,
      legacy_total_cents: total !== null ? total : (oneTime !== null || mrr !== null ? M.add(oneTime || 0, M.mulByInt(mrr || 0, 12)) : null),
      legacy_one_time_cents: oneTime,
      legacy_mrr_cents: mrr,
      lines: (lines || []).map(mapLineRow).filter(l => l.quote_number === null || l.quote_number === qn)
    };
  }

  // Group flat line rows by their quote number.
  function groupLines(lineRows) {
    const map = new Map();
    asArray(lineRows).forEach(l => {
      if (!l) return;
      const key = str(field(l, ["quote_number", "quote", "quote_no", "number", "ref"]));
      if (key === null) return;
      if (!map.has(key)) map.set(key, []);
      map.get(key).push(l);
    });
    return map;
  }

  function mapHistoryRow(row) {
    const qn = str(field(row, ["quote_number", "quote", "quote_no", "number", "ref"]));
    const company = str(field(row, ["company", "account", "customer", "client"])) || "Imported account";
    const decisionText = (str(field(row, ["decision", "status", "outcome", "result"])) || "").toLowerCase();
    let decision = "expired";
    if (/approv|won|accept|sold/.test(decisionText)) decision = "approved";
    else if (/declin|lost|reject|no.deal/.test(decisionText)) decision = "declined";
    const oneTime = moneyToCents(field(row, ["one_time", "one_time_cents"]));
    const mrr = moneyToCents(field(row, ["mrr", "mrr_cents"]));
    const total = moneyToCents(field(row, ["total", "total_cents", "amount", "value", "sell"]));
    const sell = total !== null ? total : (oneTime !== null || mrr !== null ? M.add(oneTime || 0, M.mulByInt(mrr || 0, 12)) : 0);
    const cost = moneyToCents(field(row, ["cost", "cost_cents", "unit_cost"]));
    return {
      legacy_ref: qn || str(field(row, ["id", "legacy_id"])) || ("hist-" + Math.random().toString(36).slice(2, 8)),
      quote_number: qn,
      company_id: "legacy-" + (slug(company) || "account"),
      company_name: company,
      rep: str(field(row, ["rep", "owner", "sales_rep"])) || "unassigned",
      decision: decision,
      sent_at: str(field(row, ["sent_at", "sent", "sent_date"])) || null,
      decided_at: str(field(row, ["decided_at", "decided", "closed_at", "close_date"])) || null,
      one_time_cents: oneTime === null ? 0 : oneTime,
      mrr_cents: mrr === null ? 0 : mrr,
      sell_cents: sell,
      cost_cents: cost === null ? null : cost,
      currency: str(field(row, ["currency"])) || M.DEFAULT_CURRENCY
    };
  }

  // ---- reconciliation -------------------------------------------------------

  function daysBetween(a, b) {
    const am = a ? Date.parse(a) : NaN, bm = b ? Date.parse(b) : NaN;
    if (isNaN(am) || isNaN(bm) || bm < am) return null;
    return Math.round(((bm - am) / 86400000) * 1000) / 1000;
  }

  // Compare the legacy source against what was imported: record counts and the
  // money totals, with an explicit variance. Pure.
  function reconcile(input) {
    input = input || {};
    const sourceQuotes = asArray(input.source_quotes);
    const importedQuotes = asArray(input.imported_quotes);
    const sourceCatalog = asArray(input.source_catalog);
    const importedCatalog = asArray(input.imported_catalog);
    const sourceHistory = asArray(input.source_history);
    const exportedHistory = asArray(input.exported_history);

    const srcRefs = new Set(sourceQuotes.map(q => str(q.legacy_ref)).filter(Boolean));
    const impRefs = new Set(importedQuotes.map(q => str(q.legacy_ref)).filter(Boolean));
    const missing = Array.from(srcRefs).filter(r => !impRefs.has(r));
    const extra = Array.from(impRefs).filter(r => !srcRefs.has(r));

    let sourceTotal = 0, importedTotal = 0;
    sourceQuotes.forEach(q => { if (Number.isSafeInteger(q.legacy_total_cents)) sourceTotal = M.add(sourceTotal, q.legacy_total_cents); });
    importedQuotes.forEach(q => { if (Number.isSafeInteger(q.imported_total_cents)) importedTotal = M.add(importedTotal, q.imported_total_cents); });

    const checks = [];
    checks.push({ key: "quotes_count", ok: sourceQuotes.length === importedQuotes.length, expected: sourceQuotes.length, actual: importedQuotes.length });
    checks.push({ key: "quotes_matched", ok: missing.length === 0, expected: 0, actual: missing.length });
    checks.push({ key: "quotes_extra", ok: extra.length === 0, expected: 0, actual: extra.length });
    checks.push({ key: "catalog_count", ok: importedCatalog.length >= sourceCatalog.length, expected: sourceCatalog.length, actual: importedCatalog.length });
    checks.push({ key: "history_exported", ok: exportedHistory.length === sourceHistory.length, expected: sourceHistory.length, actual: exportedHistory.length });
    checks.push({ key: "open_quote_totals", ok: sourceTotal === importedTotal, expected: sourceTotal, actual: importedTotal });

    return {
      ok: checks.every(c => c.ok),
      generated_at: input.generated_at || new Date().toISOString(),
      counts: {
        source_quotes: sourceQuotes.length,
        imported_quotes: importedQuotes.length,
        source_catalog: sourceCatalog.length,
        imported_catalog: importedCatalog.length,
        source_history: sourceHistory.length,
        exported_history: exportedHistory.length
      },
      refs: { missing: missing, extra: extra },
      totals: {
        source_cents: sourceTotal,
        imported_cents: importedTotal,
        variance_cents: M.sub(importedTotal, sourceTotal)
      },
      checks: checks
    };
  }

  // ---- historical export (analytics ingestion) ------------------------------

  function historyTables(rows) {
    const quotes = [], decisions = [], margins = [];
    asArray(rows).forEach(h => {
      if (!h) return;
      const id = "legacyq-" + slug(h.legacy_ref || h.quote_number || Math.random().toString(36).slice(2, 8));
      const versionId = "legacyv-" + slug(h.legacy_ref || h.quote_number || Math.random().toString(36).slice(2, 8));
      const twelve = M.add(h.one_time_cents || 0, M.mulByInt(h.mrr_cents || 0, 12));
      const deal = M.add(h.one_time_cents || 0, M.mulByInt(h.mrr_cents || 0, 12));
      quotes.push({
        quote_id: id, quote_number: h.quote_number, mode: "quote", status: "imported_history",
        company_id: h.company_id, company_name: h.company_name, contact_id: null,
        created_at: h.sent_at, created_by: h.rep, opportunity_id: null,
        version_count: 1, latest_version_id: versionId, latest_state: h.decision
      });
      decisions.push({
        version_id: versionId, quote_id: id, quote_number: h.quote_number, company_id: h.company_id,
        company_name: h.company_name, rep: h.rep, mode: "quote", decision: h.decision,
        sent_at: h.sent_at, decided_at: h.decided_at, cycle_days: daysBetween(h.sent_at, h.decided_at),
        one_time_cents: h.one_time_cents, mrr_cents: h.mrr_cents, twelve_month_value_cents: twelve,
        deal_value_cents: deal, currency: h.currency, approver_name: null, line_count: 0, selected_count: 0
      });
      if (h.decision === "approved" && h.cost_cents !== null) {
        const margin = M.sub(h.sell_cents, h.cost_cents);
        margins.push({
          version_id: versionId, quote_id: id, quote_number: h.quote_number, company_id: h.company_id,
          company_name: h.company_name, rep: h.rep, approved_at: h.decided_at,
          sell_cents: h.sell_cents, cost_cents: h.cost_cents, margin_cents: margin,
          margin_bp: (h.sell_cents ? (function () { try { return M.bpOf(margin, h.sell_cents); } catch (e) { return null; } })() : null),
          missing_cost_lines: 0, currency: h.currency
        });
      }
    });
    return { quotes: quotes, decisions: decisions, margins: margins };
  }

  function exportHistory(rows, opts) {
    const tables = historyTables(asArray(rows).map(mapHistoryRow));
    if (A) return A.extractFrom(tables, Object.assign({ source: "quote-u-legacy" }, opts || {}));
    return { schema: "quote-u.analytics", version: 1, fingerprint: null, generated_at: new Date().toISOString(), source: "quote-u-legacy", counts: { quotes: tables.quotes.length, decisions: tables.decisions.length, margins: tables.margins.length }, tables: tables };
  }

  // ---- the service ----------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;
    const catalog = opts.catalog || null;
    const quotes = opts.quotes || null;
    const versions = opts.versions || null;
    const audit = opts.audit || null;
    const policy = isPlainObject(opts.policy) ? opts.policy : {};
    const system = policy.legacy_system ? String(policy.legacy_system) : LEGACY_SYSTEM;
    const clock = opts.clock || null;
    const maxRetries = opts.maxRetries === undefined ? DEFAULT_MAX_RETRIES : opts.maxRetries;

    function nowIso() { return typeof clock === "function" ? String(clock()) : new Date().toISOString(); }

    // Import mapped catalog items (idempotent by sku/mpn-derived id).
    async function importCatalog(items) {
      const rows = asArray(items).map(i => (isPlainObject(i) && i.sku !== undefined ? i : mapCatalogRow(i))).filter(Boolean);
      if (!catalog || typeof catalog.upsert !== "function") return { ok: false, code: "no_catalog", detail: "The legacy import needs the catalog service." };
      let created = 0, updated = 0, attempts = 0; const invalid = [];
      for (const item of rows) {
        const res = await catalog.upsert(item);
        attempts++;
        if (!res.ok) { invalid.push({ id: item.id, code: res.code, detail: res.detail }); continue; }
        if (res.created) created++; else updated++;
      }
      return { ok: invalid.length === 0, attempted: attempts, created: created, updated: updated, invalid: invalid };
    }

    // Create quote-u quotes from mapped legacy quote records (re-keyed), each
    // with a draft version and its lines.
    async function importQuotes(records) {
      const list = asArray(records);
      if (!quotes || typeof quotes.importQuote !== "function") return { ok: false, code: "no_quotes", detail: "The legacy import needs the quote service." };
      const imported = [], failures = [];
      for (const rec of list) {
        const r = isPlainObject(rec) && rec.legacy_ref !== undefined ? rec : mapQuoteRow(rec, []);
        const res = await quotes.importQuote({
          legacy_ref: r.legacy_ref,
          legacy_system: system,
          quote_number: r.quote_number,
          company_id: r.company_id,
          company_name: r.company_name,
          contact_id: r.contact_id,
          contact_name: r.contact_name,
          contact_email: r.contact_email || null,
          title: r.title,
          mode: r.mode,
          status: "draft",
          legacy_status: r.legacy_status || r.status,
          legacy_total_cents: r.legacy_total_cents,
          created_at: r.created_at,
          created_by: r.created_by,
          actor: "migration"
        });
        if (!res.ok) { failures.push({ legacy_ref: r.legacy_ref, code: res.code, detail: res.detail }); continue; }
        let versionId = null, lineCount = 0;
        const lines = asArray(r.lines);
        if (versions && typeof versions.createVersion === "function") {
          const v = await versions.createVersion({
            quote_id: res.quote.id, quote_number: res.quote.quote_number, title: r.title,
            state: "draft", created_by: r.created_by, notes: "Imported from " + system + " (legacy state: " + (r.legacy_status || r.status) + ")"
          });
          if (v.ok) {
            versionId = v.version.id;
            if (typeof versions.addLine === "function") {
              for (const line of lines) {
                const add = await versions.addLine(versionId, {
                  kind: line.kind, description: line.description, quantity: line.quantity,
                  unit_sell_cents: line.unit_sell_cents, unit_cost_cents: line.unit_cost_cents,
                  manufacturer_part_number: line.manufacturer_part_number, sku: line.sku
                });
                if (add.ok) lineCount++;
              }
            }
          }
        }
        let importedTotal = 0;
        lines.forEach(l => {
          importedTotal = l.kind === "mrr"
            ? M.add(importedTotal, M.mulByInt(M.mulByInt(l.unit_sell_cents || 0, l.quantity || 1), 12))
            : M.add(importedTotal, M.mulByInt(l.unit_sell_cents || 0, l.quantity || 1));
        });
        imported.push({
          legacy_ref: r.legacy_ref,
          quote_id: res.quote.id,
          quote_number: res.quote.quote_number,
          version_id: versionId,
          line_count: lineCount,
          legacy_total_cents: r.legacy_total_cents,
          imported_total_cents: importedTotal,
          company_name: r.company_name,
          created_by: r.created_by
        });
      }
      return { ok: failures.length === 0, imported: imported, failures: failures, count: imported.length };
    }

    async function load() {
      const d = await store.loadDoc(DOC);
      if (!d.ok) return d;
      const content = isPlainObject(d.content) ? d.content : { records: [] };
      return { ok: true, state: d.state, revision: d.revision, content: content, records: asArray(content) };
    }

    // Persist a migration record (append-only history of runs).
    async function persist(record) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await load();
        if (!l.ok) return l;
        const next = Object.assign({}, l.content, { records: l.records.concat([record]) });
        const save = await store.saveChecked(DOC, next, { expectedBase: l.revision });
        if (save.ok) return { ok: true, revision: save.revision, record: record };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "migration_conflict", detail: `Could not write the ${DOC} document after ${maxRetries + 1} attempts.` };
    }

    // Run a full migration: import catalog, re-key open quotes, export history,
    // reconcile, and record the run (with the read-only cutover when asked).
    async function run(input) {
      input = input || {};
      const catalogRows = readRows(input.catalog);
      const quoteRows = readRows(input.quotes);
      const lineRows = readRows(input.lines);
      const historyRows = readRows(input.history);
      const lineMap = groupLines(lineRows);

      const catalogImported = catalogRows.length ? await importCatalog(catalogRows.map(mapCatalogRow)) : { ok: true, attempted: 0, created: 0, updated: 0, invalid: [] };
      const mappedQuotes = quoteRows.map(r => {
        const qn = str(field(r, ["quote_number", "quote", "quote_no", "number", "ref"]));
        return mapQuoteRow(r, qn && lineMap.has(qn) ? lineMap.get(qn) : []);
      });
      const quoteImported = mappedQuotes.length ? await importQuotes(mappedQuotes) : { ok: true, imported: [], failures: [], count: 0 };
      const historyExtract = historyRows.length ? exportHistory(historyRows) : null;

      const reconciliation = reconcile({
        source_quotes: mappedQuotes,
        imported_quotes: quoteImported.imported,
        source_catalog: catalogRows,
        imported_catalog: Array.from({ length: catalogImported.attempted || 0 }),
        source_history: historyRows,
        exported_history: historyExtract ? (historyExtract.tables.decisions || []) : [],
        generated_at: nowIso()
      });

      const rand = window.QU_STORE && window.QU_STORE.randHex ? window.QU_STORE.randHex(6) : Math.random().toString(36).slice(2, 8);
      const record = {
        id: "mig-" + Date.now().toString(36) + "-" + rand,
        at: nowIso(),
        by: input.by ? String(input.by) : "migration",
        legacy_system: system,
        counts: reconciliation.counts,
        totals: reconciliation.totals,
        checks: reconciliation.checks,
        refs: reconciliation.refs,
        read_only: input.cutover === true,
        cutover_at: input.cutover === true ? nowIso() : null,
        ok: reconciliation.ok && quoteImported.ok && catalogImported.ok,
        history_fingerprint: historyExtract ? historyExtract.fingerprint : null,
        history_counts: historyExtract ? historyExtract.counts : null
      };
      const saved = store ? await persist(record) : { ok: true, record: record };
      if (!saved.ok) return saved;
      if (audit && typeof audit.append === "function") {
        try {
          await audit.append({
            event: "revised", actor_type: "system", actor: record.by,
            detail: { action: "legacy_migration", migration_id: record.id, legacy_system: system, counts: record.counts, totals: record.totals, read_only: record.read_only }
          });
        } catch (e) { /* the migration record is the durable evidence */ }
      }
      return { ok: true, record: saved.record || record, reconciliation: reconciliation, history: historyExtract, catalog: catalogImported, quotes: quoteImported };
    }

    // Mark the legacy tool READ-ONLY (the cutover). Appends a marker record.
    async function cutover(input) {
      input = input || {};
      const record = {
        id: "mig-cutover-" + Date.now().toString(36),
        at: nowIso(),
        by: input.by ? String(input.by) : "migration",
        legacy_system: system,
        kind: "cutover",
        read_only: true,
        cutover_at: nowIso(),
        note: input.note ? String(input.note) : "The legacy quoting tool is now read-only; quote-u is the system of record."
      };
      const saved = store ? await persist(record) : { ok: true, record: record };
      return saved.ok ? { ok: true, record: saved.record || record } : saved;
    }

    async function list() {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, migrations: l.records, total: l.records.length };
    }

    function status() {
      return { system: system, read_only: true, note: "This adapter only reads a legacy source; it never writes back." };
    }

    function ready() { return Promise.resolve({ ok: true, doc: DOC }); }

    return { DOC, importCatalog, importQuotes, exportHistory, reconcile, run, cutover, list, status, ready };
  }

  return {
    VERSION,
    DOC,
    LEGACY_SYSTEM,
    COLUMNS,
    parseCsv,
    readRows,
    moneyToCents,
    mapCatalogRow,
    mapQuoteRow,
    mapLineRow,
    mapHistoryRow,
    groupLines,
    reconcile,
    historyTables,
    exportHistory,
    createService
  };
})();
