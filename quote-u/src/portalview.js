// ============================================================================
// quote-u — client-safe serialization (roadmap task 14)
// ----------------------------------------------------------------------------
// ONE serializer stands between the internal quoting data model and every
// surface a CLIENT can see (the tokenized portal and the web/print view). It
// exists to make invariant I4 true by construction rather than by discipline:
//
//   I4 — no portal or print response ever contains unit cost, margin or
//        snapshot cost.
//
// The serializer is a WHITELIST, not a blacklist: it copies only the fields a
// client is allowed to see, derives the client-visible amounts from
// unit_sell_cents alone, and then audits its own output. `audit` deep-walks the
// finished object and refuses (throws `cost_leak`) if ANY key anywhere looks
// like cost, margin, markup, snapshot provenance, supplier identity or an
// internal note. So a future field added to a line item cannot silently leak:
// it simply is not copied, and if someone ever copies it by hand the audit
// catches it before the response leaves the building.
//
// The module is pure: no clock (unless a caller supplies one), no randomness,
// no storage, no network. Totals come from the shared QU_TOTALS engine, so the
// client view can never disagree with the builder or the approval record.
// ============================================================================
window.QU_PORTALVIEW = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u portal view requires window.QU_MONEY (load src/money.js first)");

  const VERSION = "1.0.0";
  const VIEW_KIND = "quote-portal-view";
  const VIEW_SCHEMA = 1;

  // The ONLY line fields a client may see. Everything else — unit_cost_cents,
  // price_snapshot_ref, pricing_mode, catalog_ref — is internal and never
  // copied. Manufacturer part number and SKU are client-facing identifiers.
  const CLIENT_LINE_FIELDS = [
    "id", "sort_order", "section", "kind", "description",
    "manufacturer_part_number", "sku", "quantity", "unit_sell_cents",
    "optional", "option_group_id", "selected_by_default", "currency"
  ];

  const CLIENT_GROUP_FIELDS = ["id", "name", "selection_type", "sort_order", "description"];
  const CLIENT_QUOTE_FIELDS = [
    "id", "quote_number", "title", "company_name", "contact_name",
    "contact_email", "opportunity_name", "created_at"
  ];
  const CLIENT_VERSION_FIELDS = [
    "id", "quote_id", "version_number", "state", "title",
    "frozen_at", "sent_at", "expires_at", "created_at", "revision_of"
  ];

  // A key is forbidden if its NAME suggests internal cost/margin/provenance.
  // The check is substring-based on purpose: `unit_cost_cents`, `cost`,
  // `snapshotCost`, `margin_bp`, `list_price_cents`, `internal_note`,
  // `token_secret`, `raw_response` and `content_hash` are all refused.
  const FORBIDDEN_FRAGMENTS = [
    "cost", "margin", "markup", "profit", "snapshot", "list_price", "listprice",
    "wholesale", "supplier", "secret", "token", "internal", "hash"
  ];

  class PortalViewError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "PortalViewError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) {
    throw new PortalViewError(code, message, meta);
  }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function forbiddenReason(key) {
    const k = String(key).toLowerCase();
    if (k === "raw" || k.indexOf("raw_") === 0) return "raw source payload";
    for (const frag of FORBIDDEN_FRAGMENTS) {
      if (k.indexOf(frag) !== -1) return frag;
    }
    return null;
  }

  function pick(source, fields) {
    const out = {};
    if (!source) return out;
    for (const f of fields) {
      if (source[f] !== undefined) out[f] = source[f];
    }
    return out;
  }

  // --------------------------------------------------------------- the audit

  // Deep-walk any value and collect every forbidden key it carries, with the
  // path that reached it. Non-throwing: { ok, violations, keys }.
  function audit(value) {
    const violations = [];
    let keys = 0;
    const seen = new Set();
    const walk = (node, path, depth) => {
      if (depth > 24 || node === null || node === undefined) return;
      if (typeof node !== "object") return;
      if (seen.has(node)) return;
      seen.add(node);
      if (Array.isArray(node)) {
        node.forEach((v, i) => walk(v, path + "[" + i + "]", depth + 1));
        return;
      }
      for (const key of Object.keys(node)) {
        keys++;
        const reason = forbiddenReason(key);
        const childPath = path ? path + "." + key : key;
        if (reason) violations.push({ path: childPath, key, reason });
        walk(node[key], childPath, depth + 1);
      }
    };
    walk(value, "", 0);
    return { ok: violations.length === 0, violations, keys };
  }

  // The executable form of I4: refuse to hand out a client view that carries a
  // forbidden field. Used by serialize() on its own output, by the tests, and
  // by any portal surface before it returns a response.
  function assertClientSafe(value) {
    const out = audit(value);
    if (!out.ok) {
      const first = out.violations[0];
      fail("cost_leak",
        `Refusing to expose a client view: ${first.path} looks like "${first.reason}" (${out.violations.length} forbidden field${out.violations.length === 1 ? "" : "s"}).`,
        { violations: out.violations });
    }
    return value;
  }

  // A defensive strip: clone a value, dropping every forbidden key. Handy when
  // wrapping a third-party object that might carry extra fields.
  function sanitize(value) {
    const strip = node => {
      if (node === null || node === undefined || typeof node !== "object") return node;
      if (Array.isArray(node)) return node.map(strip);
      const out = {};
      for (const key of Object.keys(node)) {
        if (forbiddenReason(key)) continue;
        out[key] = strip(node[key]);
      }
      return out;
    };
    return strip(value);
  }

  // ------------------------------------------------------------- the DTOs

  function lineDTO(line, selected) {
    const dto = pick(line, CLIENT_LINE_FIELDS);
    dto.sort_order = typeof dto.sort_order === "number" ? dto.sort_order : 0;
    dto.quantity = typeof dto.quantity === "number" ? dto.quantity : 1;
    dto.amount_cents = M.lineTotal(dto.unit_sell_cents, dto.quantity);
    dto.optional = dto.optional === true;
    dto.selected_by_default = dto.selected_by_default === true;
    dto.option_group_id = dto.option_group_id === undefined ? null : dto.option_group_id;
    dto.selected = selected === true;
    return dto;
  }

  function groupDTO(group) {
    const dto = pick(group, CLIENT_GROUP_FIELDS);
    dto.sort_order = typeof dto.sort_order === "number" ? dto.sort_order : 0;
    return dto;
  }

  function quoteDTO(quote) {
    return pick(quote, CLIENT_QUOTE_FIELDS);
  }

  function versionDTO(version) {
    const dto = pick(version, CLIENT_VERSION_FIELDS);
    if (version && version.revised_from !== undefined && dto.revision_of === undefined) {
      dto.revision_of = version.revised_from;
    }
    return dto;
  }

  function totalsDTO(t) {
    return {
      currency: t.currency,
      term_months: t.term_months,
      one_time_cents: t.one_time_cents,
      mrr_cents: t.mrr_cents,
      annual_mrr_cents: t.annual_mrr_cents,
      twelve_month_value_cents: t.twelve_month_value_cents,
      deal_value_cents: t.deal_value_cents,
      selected_count: t.selected_count,
      line_count: t.line_count
    };
  }

  // Group the client lines into display sections keyed by kind + section, in a
  // stable order (one-time first, then MRR; sections in first-seen order).
  function buildSections(lines) {
    const order = [];
    const map = new Map();
    for (const line of lines) {
      const section = line.section || "";
      const key = line.kind + "/" + section;
      if (!map.has(key)) {
        const entry = {
          key,
          kind: line.kind,
          section,
          label: (line.kind === "mrr" ? "Monthly" : "One-time") + (section ? " · " + section : ""),
          lines: [],
          total_cents: 0
        };
        map.set(key, entry);
        order.push(entry);
      }
      const entry = map.get(key);
      entry.lines.push(line.id);
      if (line.selected) entry.total_cents = M.add(entry.total_cents, line.amount_cents);
    }
    order.sort((a, b) => {
      if (a.kind !== b.kind) return a.kind === "one_time" ? -1 : 1;
      return 0;
    });
    return order;
  }

  // ------------------------------------------------------------------ serialize

  // Build the single client-safe view. `input`:
  //   { quote?, version?, line_items, option_groups?, selection?, term_months? }
  // Returns a fresh DTO that has already passed assertClientSafe. Throws
  // PortalViewError(`cost_leak`) if it ever fails (which would be a bug).
  function serialize(input, opts) {
    input = input || {};
    opts = opts || {};
    const TOT = window.QU_TOTALS;
    if (!TOT) fail("no_totals", "QU_PORTALVIEW needs QU_TOTALS to compute the shared totals.");
    const rawLines = input.line_items || input.lines || [];
    if (!Array.isArray(rawLines)) fail("bad_lines", "line_items must be an array.");
    const groups = input.option_groups || input.groups || [];
    if (!Array.isArray(groups)) fail("bad_groups", "option_groups must be an array.");

    const totals = TOT.computeTotals({
      line_items: rawLines,
      selection: input.selection !== undefined ? input.selection : input.selected_ids,
      option_groups: groups,
      term_months: input.term_months,
      currency: input.currency
    });

    // Indicative tax (roadmap task 20). Never authoritative: the line is
    // labelled indicative and the DTO names the system that owns the real
    // figure. Absent policy means no tax line (the client shows pre-tax only).
    let tax = null;
    const TAX = window.QU_TAX;
    if (TAX && typeof TAX.summary === "function") {
      let policy = null;
      try {
        policy = TAX.normalizePolicy(input.tax_policy || input.taxPolicy || opts.taxPolicy || TAX.defaultPolicy());
      } catch (e) {
        policy = null;
      }
      if (policy && policy.show) tax = TAX.summary(totals, policy);
    }

    const selectedById = new Map();
    totals.lines.forEach(l => selectedById.set(String(l.id), l.selected));

    const lines = rawLines.map((line, index) => {
      const id = line && line.id !== undefined ? String(line.id) : "line@" + index;
      return lineDTO(line, selectedById.get(id));
    });
    lines.sort((a, b) => {
      const sa = a.sort_order === undefined ? 0 : a.sort_order;
      const sb = b.sort_order === undefined ? 0 : b.sort_order;
      if (sa !== sb) return sa - sb;
      return String(a.id).localeCompare(String(b.id));
    });

    const sortedGroups = groups.map(groupDTO).sort((a, b) => {
      const sa = a.sort_order === undefined ? 0 : a.sort_order;
      const sb = b.sort_order === undefined ? 0 : b.sort_order;
      if (sa !== sb) return sa - sb;
      return String(a.id).localeCompare(String(b.id));
    });

    const dto = {
      kind: VIEW_KIND,
      schema: VIEW_SCHEMA,
      engine: "QU_PORTALVIEW",
      version: VERSION,
      generated_at: nowIso(opts.clock || input.clock),
      quote: quoteDTO(input.quote),
      version: versionDTO(input.version),
      currency: totals.currency,
      term_months: totals.term_months,
      option_groups: sortedGroups,
      sections: buildSections(lines),
      lines,
      totals: totalsDTO(totals),
      tax,
      display: TOT.describeTotals(totals, opts.display)
    };

    assertClientSafe(dto);
    return dto;
  }

  // ------------------------------------------------------------------ rendering

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[c]));
  }

  const KIND_LABEL = { one_time: "One-time", mrr: "Monthly" };

  // A plain-text rendering of a client view (used by the print/copy surface).
  function toText(dto) {
    if (!dto) return "";
    const out = [];
    const q = dto.quote || {};
    out.push(q.title || "Quote");
    if (q.quote_number) out.push("Quote " + q.quote_number);
    if (q.company_name) out.push(q.company_name);
    if (dto.version && dto.version.version_number !== undefined) out.push("Version " + dto.version.version_number);
    out.push("");
    for (const section of dto.sections || []) {
      out.push(section.label.toUpperCase());
      for (const id of section.lines) {
        const line = (dto.lines || []).find(l => String(l.id) === String(id));
        if (!line) continue;
        const price = M.format(line.unit_sell_cents, { currency: dto.currency });
        out.push("  " + line.description + (line.quantity !== 1 ? " ×" + line.quantity : "") + " — " + price + (line.selected === false ? " (not selected)" : ""));
      }
      out.push("");
    }
    const t = dto.totals;
    out.push("One-time: " + M.format(t.one_time_cents, { currency: dto.currency }));
    out.push("Monthly (MRR): " + M.format(t.mrr_cents, { currency: dto.currency }));
    out.push("12-month value (pre-tax): " + M.format(t.twelve_month_value_cents, { currency: dto.currency }));
    if (dto.tax) {
      out.push(dto.tax.line_label + " on one-time: " + M.format(dto.tax.one_time_cents, { currency: dto.currency }));
      out.push(dto.tax.line_label + " on 12-month value: " + M.format(dto.tax.twelve_month_value_cents, { currency: dto.currency }));
      out.push(dto.tax.disclaimer);
    }
    return out.join("\n");
  }

  // A safe HTML fragment for the client web/print view. Every value is escaped,
  // and the DTO it renders has already been audited (and is re-audited here).
  function renderHtml(dto, opts) {
    opts = opts || {};
    assertClientSafe(dto);
    const q = dto.quote || {};
    const v = dto.version || {};
    const t = dto.totals;
    const cur = dto.currency;
    const lineById = new Map((dto.lines || []).map(l => [String(l.id), l]));
    const fmt = cents => M.format(cents, { currency: cur });
    const html = [];
    html.push('<article class="pqv">');
    html.push('<header class="pqv-head">');
    html.push('<h1 class="pqv-title">' + esc(q.title || "Quote") + "</h1>");
    const sub = [];
    if (q.quote_number) sub.push("Quote " + esc(q.quote_number));
    if (v.version_number !== undefined) sub.push("Version " + esc(v.version_number));
    if (q.company_name) sub.push(esc(q.company_name));
    html.push('<p class="pqv-sub">' + sub.join(" · ") + "</p>");
    html.push("</header>");
    for (const section of dto.sections || []) {
      html.push('<section class="pqv-section">');
      html.push('<h2 class="pqv-sect-title">' + esc(section.label) + "</h2>");
      html.push('<table class="pqv-table"><thead><tr><th>Description</th><th>Qty</th><th class="num">Unit price</th><th class="num">Amount</th></tr></thead><tbody>');
      for (const id of section.lines) {
        const line = lineById.get(String(id));
        if (!line) continue;
        html.push("<tr" + (line.selected === false ? ' class="pqv-off"' : "") + ">");
        html.push("<td>" + esc(line.description) + (line.sku ? ' <span class="pqv-sku">' + esc(line.sku) + "</span>" : "") + "</td>");
        html.push("<td>" + esc(line.quantity) + "</td>");
        html.push('<td class="num">' + esc(fmt(line.unit_sell_cents)) + "</td>");
        html.push('<td class="num">' + esc(fmt(line.amount_cents)) + "</td>");
        html.push("</tr>");
      }
      html.push("</tbody></table>");
      html.push("</section>");
    }
    if (dto.option_groups && dto.option_groups.length) {
      html.push('<section class="pqv-section pqv-groups"><h2 class="pqv-sect-title">Options</h2><ul>');
      dto.option_groups.forEach(g => {
        html.push("<li>" + esc(g.name) + ' <span class="pqv-sku">' + esc(g.selection_type) + "</span></li>");
      });
      html.push("</ul></section>");
    }
    html.push('<section class="pqv-totals"><div class="pqv-total-row"><span>One-time</span><b>' + esc(fmt(t.one_time_cents)) + "</b></div>");
    html.push('<div class="pqv-total-row"><span>Monthly (MRR)</span><b>' + esc(fmt(t.mrr_cents)) + "</b></div>");
    html.push('<div class="pqv-total-row"><span>Annual (12 × MRR)</span><b>' + esc(fmt(t.annual_mrr_cents)) + "</b></div>");
    html.push('<div class="pqv-total-row pqv-grand"><span>12-month value (pre-tax)</span><b>' + esc(fmt(t.twelve_month_value_cents)) + "</b></div>");
    if (dto.tax) {
      html.push('<div class="pqv-total-row pqv-taxrow"><span>' + esc(dto.tax.line_label) + ' on one-time</span><b>' + esc(fmt(dto.tax.one_time_cents)) + "</b></div>");
      html.push('<div class="pqv-total-row pqv-taxrow"><span>' + esc(dto.tax.line_label) + ' on 12-month value</span><b>' + esc(fmt(dto.tax.twelve_month_value_cents)) + "</b></div>");
      html.push('<p class="pqv-tax-note">' + esc(dto.tax.disclaimer) + "</p>");
    }
    html.push("</section>");
    if (opts.note) html.push('<p class="pqv-note">' + esc(opts.note) + "</p>");
    html.push("</article>");
    return html.join("");
  }

  return {
    VERSION,
    VIEW_KIND,
    VIEW_SCHEMA,
    CLIENT_LINE_FIELDS,
    CLIENT_GROUP_FIELDS,
    CLIENT_QUOTE_FIELDS,
    CLIENT_VERSION_FIELDS,
    FORBIDDEN_FRAGMENTS,
    PortalViewError,
    isForbiddenKey: forbiddenReason,
    pick,
    audit,
    assertClientSafe,
    sanitize,
    line: lineDTO,
    group: groupDTO,
    quote: quoteDTO,
    version: versionDTO,
    totals: totalsDTO,
    buildSections,
    serialize,
    portalResponse: serialize,
    toText,
    renderHtml
  };
})();
