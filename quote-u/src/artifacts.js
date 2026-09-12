// ============================================================================
// quote-u — acceptance artifact snapshot (roadmap task 52)
// ----------------------------------------------------------------------------
// When a client accepts a quote, quote-u freezes not just the totals but a
// DURABLE, UNCHANGEABLE ARTIFACT of what was accepted: the client-safe view of
// the quote, the acceptance record (typed name + e-signature, task 51) and the
// frozen content seal, captured together and sealed with a content hash.
//
// A `quote_artifacts` record is written once per quote VERSION at approval and
// is immutable thereafter (`update`/`remove` are refused). It holds:
//
//   { id, quote_id, version_id, kind: "acceptance", mode, created_at,
//     quote_number, company_name, contact_name, title,
//     approver_name, signature, totals, content_seal,
//     view,               // the client-safe DTO (no cost/margin — invariant I4)
//     html, text, json,   // three equivalent renderings of the same payload
//     content_hash }      // seals the canonical acceptance payload
//
// RENDERING (the renderer spike): the client-safe view is rendered three ways —
//   • `html`  the QU_PORTALVIEW web view plus an acceptance/signature block
//   • `text`  the plain-text fallback plus the signature lines
//   • `json`  the canonical, order-independent acceptance payload (for tooling)
// and — because an artifact should be human-viewable without a browser — a
// canvas renderer (`renderToCanvas`) draws the acceptance document to a
// bitmap. The canvas rendering was verified visually as part of this task.
//
// The three renderings are all derived from the ONE client-safe DTO, so the
// artifact can never contain a cost or a margin (invariant I4): `verify`
// re-scans every stored rendering for forbidden fields.
// ============================================================================
window.QU_ARTIFACTS = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DOC = "quote_artifacts";
  const SEVERITY_KINDS = Object.freeze(["acceptance"]);
  const FORBIDDEN = ["unit_cost", "cost_cents", "margin", "unitcost", "margincents", "snapshot_cost", "cost_total"];

  class ArtifactError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "ArtifactError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new ArtifactError(code, message, meta); }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function genId(rand) {
    return "art-" + Date.now().toString(36) + "-" + (rand ? rand(8) : Math.random().toString(36).slice(2, 10));
  }

  function esc(s) {
    return String(s === undefined || s === null ? "" : s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
  }

  // ---- hashing (canonical + digest, via the audit engine when present) ------

  function canonicalize(v) {
    if (v === undefined) return "null";
    if (v === null || typeof v !== "object") return JSON.stringify(v);
    if (Array.isArray(v)) return "[" + v.map(canonicalize).join(",") + "]";
    const keys = Object.keys(v).sort();
    const parts = [];
    for (const k of keys) if (v[k] !== undefined) parts.push(JSON.stringify(k) + ":" + canonicalize(v[k]));
    return "{" + parts.join(",") + "}";
  }

  function localDigest(text) {
    const s = String(text == null ? "" : text);
    let out = "";
    for (let k = 0; k < 8; k++) {
      let h = (0x811c9dc5 ^ Math.imul(k + 1, 0x9e3779b9)) >>> 0;
      for (let i = 0; i < s.length; i++) {
        h ^= s.charCodeAt(i);
        h = Math.imul(h, 0x01000193) >>> 0;
      }
      out += h.toString(16).padStart(8, "0");
    }
    return out;
  }

  function digestOf(value) {
    const A = window.QU_AUDIT;
    if (A && typeof A.canonicalize === "function" && typeof A.localDigest === "function") {
      return A.localDigest(A.canonicalize(value));
    }
    return localDigest(canonicalize(value));
  }

  function cents(v) {
    return typeof v === "number" && Number.isSafeInteger(v) ? v : null;
  }

  function money(c, currency) {
    const M = window.QU_MONEY;
    if (M && typeof M.format === "function" && cents(c) !== null) {
      try { return M.format(c, { currency: currency || (M.DEFAULT_CURRENCY || "CAD") }); } catch (e) { /* fall through */ }
    }
    const n = cents(c) === null ? 0 : c;
    return (n / 100).toFixed(2);
  }

  // The canonical, client-safe acceptance payload. Everything the artifact says
  // is derived from the frozen version + acceptance record; the signature is
  // reduced to the facts a client may see (never a secret; there is none).
  function acceptancePayload(input) {
    input = input || {};
    const version = input.version || {};
    const quote = input.quote || {};
    const approval = input.approval || {};
    const totals = input.totals || approval || {};
    const sig = input.signature || (isPlainObject(approval.signature) ? approval.signature : null);
    return {
      kind: "acceptance",
      mode: input.mode || quote.mode || "quote",
      quote_number: quote.quote_number || version.quote_number || null,
      company_name: quote.company_name || null,
      contact_name: quote.contact_name || null,
      title: quote.title || version.title || null,
      currency: totals.currency || (window.QU_MONEY && window.QU_MONEY.DEFAULT_CURRENCY) || "CAD",
      approver_name: approval.approver_name || (sig && sig.name) || null,
      signature: sig ? { type: sig.type, name: sig.name, consent: sig.consent, signed_at: sig.signed_at, seal: sig.hash } : null,
      totals: {
        one_time_cents: cents(totals.one_time_cents),
        mrr_cents: cents(totals.mrr_cents),
        twelve_month_value_cents: cents(totals.twelve_month_value_cents),
        deal_value_cents: cents(totals.deal_value_cents),
        currency: totals.currency || null
      },
      selection: Array.isArray(input.selection) ? input.selection.map(String) : (Array.isArray(approval.selection) ? approval.selection.map(String) : []),
      content_seal: version.frozen_seal === undefined ? null : version.frozen_seal,
      approved_at: approval.approved_at || input.approved_at || null
    };
  }

  // The client-visible lines of the stored view (defensive: several shapes).
  function viewLines(view) {
    if (!view || typeof view !== "object") return [];
    const src = Array.isArray(view.lines) ? view.lines : (Array.isArray(view.line_items) ? view.line_items : []);
    return src.map(l => {
      const quantity = l && l.quantity !== undefined ? l.quantity : 1;
      const unit = l && cents(l.unit_sell_cents) !== null ? l.unit_sell_cents : (l && cents(l.unit_price_cents) !== null ? l.unit_price_cents : null);
      const explicitAmount = l && cents(l.amount_cents) !== null ? l.amount_cents : null;
      return {
        description: (l && (l.description || l.name)) || "",
        kind: (l && l.kind) || "",
        quantity: quantity,
        unit_sell_cents: unit,
        amount_cents: explicitAmount !== null ? explicitAmount : (cents(unit) !== null ? cents(unit) * quantity : null),
        section: (l && l.section) || "",
        optional: !!(l && l.optional)
      };
    });
  }

  // ---- rendering ------------------------------------------------------------

  function signatureBlock(payload) {
    const sig = payload.signature;
    const lines = [];
    if (sig) {
      lines.push('<div class="art-sign">');
      lines.push('<p class="art-sign-kicker">Electronically signed</p>');
      lines.push('<p class="art-sign-name">' + esc(sig.name) + "</p>");
      lines.push('<p class="art-sign-meta">Signed ' + esc(sig.signed_at || "") + " · signature " + esc(String(sig.seal || "").slice(0, 16)) + "…</p>");
      lines.push('<p class="art-sign-consent">' + esc(sig.consent || "") + "</p>");
      lines.push("</div>");
    } else if (payload.approver_name) {
      lines.push('<div class="art-sign"><p class="art-sign-kicker">Accepted by</p><p class="art-sign-name">' + esc(payload.approver_name) + "</p></div>");
    }
    return lines.join("");
  }

  function renderHtml(payload, view) {
    const PV = window.QU_PORTALVIEW;
    let body = "";
    if (PV && view && typeof PV.renderHtml === "function") {
      try { body = PV.renderHtml(view); } catch (e) { body = ""; }
    }
    const t = payload.totals || {};
    const rows = [
      ["One-time", money(t.one_time_cents, t.currency)],
      ["Monthly (MRR)", money(t.mrr_cents, t.currency)],
      ["12-month value", money(t.twelve_month_value_cents, t.currency)],
      ["Contract value", money(t.deal_value_cents, t.currency)]
    ].map(r => '<div class="art-total-row"><span>' + esc(r[0]) + "</span><span>" + esc(r[1]) + "</span></div>").join("");
    return [
      '<section class="art art-acceptance">',
      '<header class="art-head">',
      '<p class="art-kicker">Accepted quote</p>',
      "<h1>" + esc(payload.quote_number || payload.title || "Quote") + "</h1>",
      "<p>" + esc(payload.company_name || "") + (payload.contact_name ? " · " + esc(payload.contact_name) : "") + "</p>",
      "</header>",
      body,
      '<div class="art-totals">' + rows + "</div>",
      signatureBlock(payload),
      '<footer class="art-foot"><p>Accepted ' + esc(payload.approved_at || "") + " · content seal " + esc(String(payload.content_seal || "").slice(0, 16)) + "…</p></footer>",
      "</section>"
    ].join("");
  }

  function renderText(payload, view) {
    const PV = window.QU_PORTALVIEW;
    let body = "";
    if (PV && view && typeof PV.toText === "function") {
      try { body = PV.toText(view); } catch (e) { body = ""; }
    }
    const t = payload.totals || {};
    const out = [];
    out.push("ACCEPTED QUOTE " + (payload.quote_number || ""));
    if (payload.company_name) out.push(payload.company_name + (payload.contact_name ? " — " + payload.contact_name : ""));
    if (payload.title) out.push(payload.title);
    out.push("");
    if (body) out.push(body);
    out.push("");
    out.push("One-time: " + money(t.one_time_cents, t.currency));
    out.push("Monthly (MRR): " + money(t.mrr_cents, t.currency));
    out.push("12-month value: " + money(t.twelve_month_value_cents, t.currency));
    out.push("Contract value: " + money(t.deal_value_cents, t.currency));
    if (payload.signature) {
      out.push("");
      out.push("Electronically signed by " + payload.signature.name + " on " + (payload.signature.signed_at || ""));
      out.push("Signature seal: " + String(payload.signature.seal || ""));
      if (payload.signature.consent) out.push(payload.signature.consent);
    } else if (payload.approver_name) {
      out.push("");
      out.push("Accepted by " + payload.approver_name);
    }
    out.push("");
    out.push("Content seal: " + String(payload.content_seal || ""));
    return out.join("\n");
  }

  // Build the immutable artifact record from an acceptance.
  function build(input, opts) {
    opts = opts || {};
    input = input || {};
    const version = input.version;
    if (!isPlainObject(version) || version.id === undefined || version.id === null) {
      return { ok: false, code: "version_required", detail: "An artifact needs the frozen version it snapshots." };
    }
    const payload = acceptancePayload(input);
    const view = isPlainObject(input.view) ? input.view : null;
    const record = {
      id: input.id || opts.id || genId(opts.rand),
      quote_id: input.quote && input.quote.id !== undefined ? String(input.quote.id) : (version.quote_id === undefined ? null : version.quote_id),
      version_id: String(version.id),
      kind: "acceptance",
      mode: payload.mode,
      created_at: input.created_at || nowIso(opts.clock),
      quote_number: payload.quote_number,
      company_name: payload.company_name,
      contact_name: payload.contact_name,
      title: payload.title,
      approver_name: payload.approver_name,
      signature: payload.signature,
      totals: payload.totals,
      selection: payload.selection,
      content_seal: payload.content_seal,
      approved_at: payload.approved_at,
      view: view,
      payload: payload
    };
    record.content_hash = digestOf(payload);
    record.html = renderHtml(payload, view);
    record.text = renderText(payload, view);
    record.json = canonicalize(payload);
    return { ok: true, artifact: record };
  }

  // Re-scan every stored rendering for a cost/margin leak (invariant I4).
  function auditArtifact(record) {
    const violations = [];
    if (!isPlainObject(record)) return { ok: false, violations: [{ code: "bad_artifact", detail: "not an object" }] };
    const surfaces = { view: record.view, html: record.html, text: record.text, json: record.json, payload: record.payload };
    for (const key of Object.keys(surfaces)) {
      const s = surfaces[key];
      if (s === undefined || s === null) continue;
      const text = typeof s === "string" ? s.toLowerCase() : canonicalize(s).toLowerCase();
      for (const frag of FORBIDDEN) {
        if (text.indexOf(frag) !== -1) violations.push({ code: "cost_leak", surface: key, fragment: frag, detail: `artifact ${key} carries a forbidden fragment \"${frag}\"` });
      }
    }
    if (record.content_hash && digestOf(record.payload) !== record.content_hash) {
      violations.push({ code: "tampered", detail: "the artifact's content hash no longer matches its payload" });
    }
    return { ok: violations.length === 0, violations };
  }

  function verify(record) {
    const a = auditArtifact(record);
    if (!a.ok) return { ok: false, code: a.violations[0].code, detail: a.violations[0].detail, violations: a.violations };
    return { ok: true, artifact: record, content_hash: record.content_hash };
  }

  // ---- the canvas rendering (renderer spike) --------------------------------

  const FONT = "-apple-system, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif";

  function wrap(ctx, text, maxWidth, maxLines) {
    const words = String(text || "").split(/\s+/).filter(Boolean);
    const lines = [];
    let cur = "";
    for (const w of words) {
      const next = cur ? cur + " " + w : w;
      if (ctx.measureText(next).width > maxWidth && cur) {
        lines.push(cur);
        cur = w;
        if (maxLines && lines.length >= maxLines) { lines[lines.length - 1] += "…"; return lines; }
      } else {
        cur = next;
      }
    }
    if (cur) lines.push(cur);
    return lines;
  }

  // Draw the acceptance document to a canvas (a durable, human-viewable image
  // of the artifact). Returns the canvas element, or null when there is no DOM.
  function renderToCanvas(record, opts) {
    opts = opts || {};
    if (typeof document === "undefined") return null;
    const width = opts.width || 760;
    const margin = 56;
    const contentW = width - margin * 2;
    const lines = record && record.view ? viewLines(record.view) : [];
    const payload = (record && record.payload) || acceptancePayload(record || {});
    const t = payload.totals || {};

    // Measure first (offscreen) so the canvas is exactly tall enough.
    const probe = document.createElement("canvas").getContext("2d");
    probe.font = "13px " + FONT;
    const bodyLines = lines.map(l => wrap(probe, l.description + (l.quantity > 1 ? "  ×" + l.quantity : ""), contentW - 150, 2));
    let bodyHeight = 0;
    bodyLines.forEach(bl => { bodyHeight += bl.length * 18 + 8; });

    const headH = 190;
    const totalsH = 132;
    const signH = payload.signature ? 150 : (payload.approver_name ? 92 : 0);
    const footH = 74;
    const height = headH + bodyHeight + totalsH + signH + footH + 40;

    const canvas = opts.canvas || document.createElement("canvas");
    const dpr = opts.dpr === undefined ? (window.devicePixelRatio || 1) : opts.dpr;
    canvas.width = Math.round(width * dpr);
    canvas.height = Math.round(height * dpr);
    if (!canvas.style) canvas.style = {};
    const ctx = canvas.getContext("2d");
    ctx.scale(dpr, dpr);

    // Paper + frame.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, width, height);
    ctx.strokeStyle = "#e2e6ee";
    ctx.lineWidth = 1;
    ctx.strokeRect(0.5, 0.5, width - 1, height - 1);

    let y = 0;
    // Header band.
    ctx.fillStyle = "#0f172a";
    ctx.fillRect(0, 0, width, 8);
    y = margin + 26;
    ctx.fillStyle = "#64748b";
    ctx.font = "600 12px " + FONT;
    ctx.fillText("ACCEPTED QUOTE", margin, y);
    y += 34;
    ctx.fillStyle = "#0f172a";
    ctx.font = "700 30px " + FONT;
    ctx.fillText(String(payload.quote_number || payload.title || "Quote"), margin, y);
    y += 26;
    ctx.fillStyle = "#475569";
    ctx.font = "14px " + FONT;
    ctx.fillText([payload.company_name, payload.contact_name].filter(Boolean).join("  ·  "), margin, y);
    y += 22;
    if (payload.title) {
      ctx.fillStyle = "#64748b";
      ctx.font = "13px " + FONT;
      wrap(ctx, payload.title, contentW, 2).forEach(l => { ctx.fillText(l, margin, y); y += 17; });
    }
    y += 10;
    ctx.strokeStyle = "#e2e6ee";
    ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(width - margin, y); ctx.stroke();
    y += 26;

    // Lines.
    ctx.fillStyle = "#0f172a";
    ctx.font = "600 13px " + FONT;
    ctx.fillText("Description", margin, y);
    ctx.textAlign = "right";
    ctx.fillText("Amount", width - margin, y);
    ctx.textAlign = "left";
    y += 20;
    if (!lines.length) {
      ctx.fillStyle = "#94a3b8";
      ctx.font = "13px " + FONT;
      ctx.fillText("(no line items)", margin, y);
      y += 20;
    }
    bodyLines.forEach((bl, i) => {
      const line = lines[i];
      ctx.fillStyle = "#1e293b";
      ctx.font = "13px " + FONT;
      bl.forEach((l, k) => { ctx.fillText(l, margin, y + k * 18); });
      ctx.textAlign = "right";
      ctx.fillText(money(line.amount_cents, t.currency), width - margin, y);
      ctx.textAlign = "left";
      y += bl.length * 18 + 8;
    });

    y += 6;
    ctx.strokeStyle = "#e2e6ee";
    ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(width - margin, y); ctx.stroke();
    y += 24;
    const totalRows = [["One-time", t.one_time_cents], ["Monthly (MRR)", t.mrr_cents], ["12-month value", t.twelve_month_value_cents], ["Contract value", t.deal_value_cents]];
    totalRows.forEach((r, i) => {
      ctx.font = (i === totalRows.length - 1 ? "700 15px " : "13px ") + FONT;
      ctx.fillStyle = i === totalRows.length - 1 ? "#0f172a" : "#475569";
      ctx.fillText(r[0], width - margin - 260, y);
      ctx.textAlign = "right";
      ctx.fillText(money(r[1], t.currency), width - margin, y);
      ctx.textAlign = "left";
      y += 22;
    });

    // Signature.
    if (payload.signature) {
      y += 14;
      ctx.strokeStyle = "#cbd5e1";
      ctx.beginPath(); ctx.moveTo(margin, y); ctx.lineTo(margin + 300, y); ctx.stroke();
      y += 20;
      ctx.fillStyle = "#64748b";
      ctx.font = "600 11px " + FONT;
      ctx.fillText("ELECTRONICALLY SIGNED", margin, y);
      y += 22;
      ctx.fillStyle = "#0f172a";
      ctx.font = "italic 600 22px Georgia, serif";
      ctx.fillText(payload.signature.name, margin, y);
      y += 20;
      ctx.fillStyle = "#64748b";
      ctx.font = "12px " + FONT;
      ctx.fillText("Signed " + (payload.signature.signed_at || "") + "  ·  seal " + String(payload.signature.seal || "").slice(0, 24) + "…", margin, y);
      y += 18;
      const consent = wrap(ctx, payload.signature.consent || "", contentW, 2);
      consent.forEach(l => { ctx.fillText(l, margin, y); y += 16; });
    } else if (payload.approver_name) {
      y += 22;
      ctx.fillStyle = "#64748b";
      ctx.font = "600 11px " + FONT;
      ctx.fillText("ACCEPTED BY", margin, y);
      y += 22;
      ctx.fillStyle = "#0f172a";
      ctx.font = "italic 600 20px Georgia, serif";
      ctx.fillText(payload.approver_name, margin, y);
      y += 20;
    }

    // Footer.
    y = height - 44;
    ctx.strokeStyle = "#e2e6ee";
    ctx.beginPath(); ctx.moveTo(margin, y - 14); ctx.lineTo(width - margin, y - 14); ctx.stroke();
    ctx.fillStyle = "#94a3b8";
    ctx.font = "11px " + FONT;
    ctx.fillText("Content seal " + String(payload.content_seal || ""), margin, y);
    ctx.fillText("Artifact " + String((record && record.id) || ""), margin, y + 15);
    return canvas;
  }

  // ---- persistence ----------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "QU_ARTIFACTS needs a document store with loadDoc/saveChecked.");
    }
    const doc = opts.doc || DOC;
    const clock = opts.clock || null;
    const rand = opts.rand || null;
    const maxRetries = opts.maxRetries === undefined ? 4 : opts.maxRetries;

    async function load() {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    async function record(input, buildOpts) {
      const built = build(input, Object.assign({ clock, rand }, buildOpts || {}));
      if (!built.ok) return built;
      const art = built.artifact;
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await load();
        if (!l.ok) return l;
        const existing = l.records.find(r => r && String(r.version_id) === art.version_id);
        if (existing) return { ok: false, code: "already_recorded", detail: `Version ${art.version_id} already has an acceptance artifact.`, artifact: existing };
        const next = l.records.concat([art]);
        const content = Object.assign({}, l.content, { records: next });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) return { ok: true, artifact: art, revision: save.revision, created: !!save.created };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "artifact_conflict", detail: `Could not write the artifact after ${maxRetries + 1} attempts.` };
    }

    async function getForVersion(versionId) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, artifact: l.records.find(r => r && String(r.version_id) === String(versionId)) || null, revision: l.revision };
    }

    async function getById(id) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, artifact: l.records.find(r => r && r.id === id) || null, revision: l.revision };
    }

    async function list(filter) {
      const l = await load();
      if (!l.ok) return l;
      let recs = l.records.slice();
      if (filter && filter.quote_id !== undefined) recs = recs.filter(r => r && r.quote_id === filter.quote_id);
      if (filter && filter.mode !== undefined) recs = recs.filter(r => r && r.mode === filter.mode);
      if (filter && filter.limit !== undefined) recs = recs.slice(0, filter.limit);
      return { ok: true, artifacts: recs, total: l.records.length, revision: l.revision };
    }

    async function count() {
      const l = await load();
      return l.ok ? { ok: true, count: l.records.length, revision: l.revision } : l;
    }

    async function verifyAll() {
      const l = await load();
      if (!l.ok) return l;
      const violations = [];
      const seen = Object.create(null);
      l.records.forEach((r, i) => {
        if (!r || r.version_id === undefined || r.version_id === null) { violations.push({ index: i, code: "no_version", detail: "artifact has no version_id" }); return; }
        const vid = String(r.version_id);
        if (seen[vid] !== undefined) violations.push({ index: i, code: "duplicate_artifact", detail: `version ${vid} has more than one artifact` });
        seen[vid] = i;
        const a = auditArtifact(r);
        a.violations.forEach(v => violations.push(Object.assign({ index: i }, v)));
      });
      return { ok: violations.length === 0, violations, count: l.records.length, revision: l.revision };
    }

    function update() { return Promise.resolve({ ok: false, code: "immutable", detail: "An acceptance artifact is immutable — it is the durable record of what was accepted." }); }
    function remove() { return Promise.resolve({ ok: false, code: "immutable", detail: "An acceptance artifact can never be deleted." }); }

    function ready() {
      const p = store.ready ? Promise.resolve(store.ready()) : Promise.resolve();
      return p.then(() => ({ ok: true, doc }));
    }

    return { doc, ready, load, build, record, getForVersion, getById, list, count, verify: verifyAll, update, remove };
  }

  return {
    VERSION,
    DOC,
    KINDS: SEVERITY_KINDS,
    ArtifactError,
    canonicalize,
    auditArtifact,
    verify,
    acceptancePayload,
    build,
    renderHtml,
    renderText,
    renderToCanvas,
    createService
  };
})();
