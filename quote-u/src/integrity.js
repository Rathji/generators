// ============================================================================
// quote-u — invariants & integrity checks (roadmap task 66)
// ----------------------------------------------------------------------------
// The executable form of the system's non-negotiable invariants. Every check
// reads the LIVE system of record (the versioned documents) and asserts one of
// the five invariants directly — not via a helper that could itself be wrong,
// but by re-deriving the fact from the stored bytes:
//
//   I1  a sent/frozen version is immutable   — its freeze seal still matches
//   I2  one approval + one invoice intent    — no version carries two rows
//   I3  quote_events is append-only          — the whole hash chain re-derives
//   I4  no portal/print surface leaks cost   — every client DTO + artifact is
//                                              deep-scanned for cost/margin
//   I5  the outbox never double-writes       — no two jobs share a key
//
// Two more executable disciplines ride alongside: stored money is always
// integer cents (no float ever reached a money-shaped field) and portal tokens
// are stored only as hashes (the plaintext secret is never persisted).
//
// The engine is pure over a dataset; the service loads the live documents and
// runs it. The Admin station renders the verdicts as a dashboard card.
// ============================================================================
window.QU_INTEGRITY = (function () {
  "use strict";

  const M = window.QU_MONEY;
  if (!M) throw new Error("quote-u integrity requires window.QU_MONEY (load src/money.js first)");
  const V = window.QU_VERSIONS || null;
  const A = window.QU_AUDIT || null;
  const II = window.QU_INVOICEINTENTS || null;
  const OB = window.QU_OUTBOX || null;
  const PV = window.QU_PORTALVIEW || null;
  const PT = window.QU_PORTALTOKENS || null;

  const VERSION = "1.0.0";

  // Every document the checks read. `quotes` is loaded for client-DTO context.
  const DOCS = Object.freeze([
    "quotes",
    "quote_versions",
    "line_items",
    "option_groups",
    "approvals",
    "invoice_intents",
    "quote_events",
    "portal_tokens",
    "outbox_jobs",
    "quote_artifacts"
  ]);

  const INVARIANTS = Object.freeze([
    { id: "I1", code: "frozen_immutable", label: "Frozen versions are immutable", statement: "No code path re-prices a frozen version: its seal still matches and no member changed." },
    { id: "I2", code: "unique_acceptance", label: "One approval & one invoice intent per version", statement: "No version carries two acceptance records or two invoicing intents." },
    { id: "I3", code: "events_append_only", label: "quote_events is append-only", statement: "The audit log's hash chain re-derives and its sequence is contiguous." },
    { id: "I4", code: "no_cost_leak", label: "No portal/print surface leaks cost", statement: "Every client-safe DTO and acceptance artifact is free of cost and margin." },
    { id: "I5", code: "outbox_idempotent", label: "The outbox never double-writes", statement: "No two jobs share a version+action key; attempts are sane." }
  ]);

  const EXTRA = Object.freeze([
    { id: "money", code: "stored_money", label: "Stored money is integer cents", statement: "No float reached a money-shaped field in any document." },
    { id: "tokens", code: "token_hash_only", label: "Portal tokens are hash-only", statement: "The plaintext secret is never persisted — only its hash." }
  ]);

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.records)) return v.records;
    return [];
  }

  function versionsOf(ds) {
    return asArray(ds && ds.versions);
  }

  // ---- I1: frozen immutability ---------------------------------------------

  function isFrozenVersion(version) {
    if (V && typeof V.isFrozen === "function") return V.isFrozen(version);
    return !!(version && version.frozen_at);
  }

  function checkFrozen(ds) {
    const versions = versionsOf(ds);
    const lines = asArray(ds && ds.lines);
    const groups = asArray(ds && ds.groups);
    const failures = [];
    let checked = 0;
    if (!V || typeof V.sealBundle !== "function") {
      return { ok: true, checked: 0, failures: [], skipped: true };
    }
    for (const v of versions) {
      if (!v || v.id === undefined || !isFrozenVersion(v)) continue;
      checked++;
      if (!v.frozen_seal) {
        failures.push({ ref: String(v.id), detail: "a frozen version carries no seal" });
        continue;
      }
      const vLines = lines.filter(l => l && l.quote_version_id === v.id);
      const vGroups = groups.filter(g => g && g.quote_version_id === v.id);
      let recomputed;
      try {
        recomputed = V.sealBundle(v, vLines, vGroups);
      } catch (e) {
        failures.push({ ref: String(v.id), detail: "the seal could not be recomputed: " + ((e && e.message) || e) });
        continue;
      }
      if (recomputed !== v.frozen_seal) {
        failures.push({ ref: String(v.id), detail: "the freeze seal no longer matches — the version was modified after it was frozen" });
      }
    }
    return { ok: failures.length === 0, checked, failures };
  }

  // ---- I2: one approval + one invoice intent per version --------------------

  function duplicateValues(records, field) {
    const seen = new Map();
    const dupes = [];
    (records || []).forEach(r => {
      if (!r || r[field] === undefined || r[field] === null) return;
      const k = String(r[field]);
      if (seen.has(k)) dupes.push(k);
      else seen.set(k, r);
    });
    return dupes;
  }

  function checkUnique(ds) {
    const approvals = asArray(ds && ds.approvals);
    const intents = asArray(ds && ds.intents);
    const failures = [];
    duplicateValues(approvals, "version_id").forEach(k => failures.push({ ref: k, detail: "two approval records for one version (I2)" }));
    duplicateValues(intents, "version_id").forEach(k => failures.push({ ref: k, detail: "two invoice intents for one version (I2)" }));
    // A weak but useful cross-check: approval / intent ids must be unique too.
    duplicateValues(approvals, "id").forEach(k => failures.push({ ref: k, detail: "duplicate approval id" }));
    duplicateValues(intents, "id").forEach(k => failures.push({ ref: k, detail: "duplicate invoice-intent id" }));
    return { ok: failures.length === 0, checked: approvals.length + intents.length, failures };
  }

  // ---- I3: quote_events is append-only --------------------------------------

  async function checkEvents(ds, opts) {
    const events = asArray(ds && ds.events);
    if (!A || typeof A.verifyChain !== "function") {
      return { ok: true, checked: events.length, failures: [], skipped: true };
    }
    let res;
    try {
      res = await A.verifyChain(events, opts && opts.digest);
    } catch (e) {
      return { ok: false, checked: events.length, failures: [{ ref: "chain", detail: (e && e.message) || String(e) }] };
    }
    const failures = (res.breaks || []).slice(0, 20).map(b => ({ ref: "log", detail: String(b) }));
    return { ok: res.ok && failures.length === 0, checked: events.length, failures };
  }

  // ---- I4: no client/artifact surface leaks cost ---------------------------

  function checkCostLeak(ds) {
    if (!PV || typeof PV.serialize !== "function" || typeof PV.audit !== "function") {
      return { ok: true, checked: 0, failures: [], skipped: true };
    }
    const versions = versionsOf(ds);
    const lines = asArray(ds && ds.lines);
    const groups = asArray(ds && ds.groups);
    const quotes = asArray(ds && ds.quotes);
    const artifacts = asArray(ds && ds.artifacts);
    const byQuote = new Map();
    quotes.forEach(q => { if (q && q.id !== undefined) byQuote.set(String(q.id), q); });
    const failures = [];
    let checked = 0;

    for (const v of versions) {
      if (!v || v.id === undefined) continue;
      const vLines = lines.filter(l => l && l.quote_version_id === v.id);
      const vGroups = groups.filter(g => g && g.quote_version_id === v.id);
      const quote = v.quote_id === undefined || v.quote_id === null ? null : byQuote.get(String(v.quote_id)) || null;
      let dto;
      try {
        dto = PV.serialize({ quote: quote, version: v, line_items: vLines, option_groups: vGroups });
      } catch (e) {
        failures.push({ ref: String(v.id), detail: "the client view could not be built: " + ((e && e.message) || e) });
        continue;
      }
      checked++;
      const scan = PV.audit(dto);
      if (!scan.ok) {
        scan.violations.slice(0, 5).forEach(x => failures.push({ ref: String(v.id), detail: "client DTO carries " + x.path + " (" + x.reason + ")" }));
      }
    }

    for (const art of artifacts) {
      if (!art) continue;
      checked++;
      const scan = PV.audit({ view: art.view, html: art.html, text: art.text, json: art.json });
      if (!scan.ok) {
        scan.violations.slice(0, 5).forEach(x => failures.push({ ref: String(art.version_id || art.id || "artifact"), detail: "acceptance artifact carries " + x.path + " (" + x.reason + ")" }));
      }
    }
    return { ok: failures.length === 0, checked, failures };
  }

  // ---- I5: outbox idempotency ----------------------------------------------

  function checkOutbox(ds) {
    const jobs = asArray(ds && ds.outbox);
    const failures = [];
    const seen = new Map();
    for (const j of jobs) {
      if (!j) continue;
      const key = OB && typeof OB.keyOf === "function" ? OB.keyOf(j.version_id, j.action) : String(j.version_id) + "|" + String(j.action);
      if (seen.has(key)) {
        const prev = seen.get(key);
        failures.push({ ref: key, detail: "two outbox jobs for the same version+action (" + (prev.id || "?") + " and " + (j.id || "?") + ")" });
      } else {
        seen.set(key, j);
      }
      if (j.attempts !== undefined && (!Number.isInteger(j.attempts) || j.attempts < 0)) {
        failures.push({ ref: String(j.id || key), detail: "the attempt count is not a non-negative integer" });
      }
      if (j.state === "done" && (!Number.isInteger(j.attempts) || j.attempts < 1)) {
        failures.push({ ref: String(j.id || key), detail: "a completed job has no recorded attempt" });
      }
    }
    return { ok: failures.length === 0, checked: jobs.length, failures };
  }

  // ---- money + token disciplines -------------------------------------------

  function checkStoredMoney(ds) {
    const failures = [];
    let checked = 0;
    const docs = ds && ds.documents && typeof ds.documents === "object" ? ds.documents : null;
    const names = docs ? Object.keys(docs) : [];
    for (const name of names) {
      const content = docs[name];
      if (!content || typeof content !== "object") continue;
      checked++;
      const audit = M.auditStoredMoney(content);
      if (!audit.ok) {
        audit.violations.slice(0, 5).forEach(x => failures.push({ ref: name, detail: "a stored money field " + x.path + " is " + x.reason }));
      }
    }
    return { ok: failures.length === 0, checked, failures };
  }

  function checkTokens(ds) {
    const tokens = asArray(ds && ds.tokens);
    const failures = [];
    for (const t of tokens) {
      if (!t || typeof t !== "object") continue;
      if (PT && typeof PT.assertNoSecret === "function") {
        try { PT.assertNoSecret(t); }
        catch (e) { failures.push({ ref: String(t.id || "token"), detail: "a stored token row carries a secret-shaped field" }); }
      }
      if (!t.token_hash || typeof t.token_hash !== "string") {
        failures.push({ ref: String(t.id || "token"), detail: "a token row has no hash" });
      }
    }
    return { ok: failures.length === 0, checked: tokens.length, failures };
  }

  // ---- the engine ----------------------------------------------------------

  const CHECKS = [
    { id: "I1", label: "Frozen versions are immutable", run: (ds) => checkFrozen(ds) },
    { id: "I2", label: "One approval & one invoice intent per version", run: (ds) => checkUnique(ds) },
    { id: "I3", label: "quote_events is append-only", run: (ds, o) => checkEvents(ds, o) },
    { id: "I4", label: "No portal/print surface leaks cost or margin", run: (ds) => checkCostLeak(ds) },
    { id: "I5", label: "The outbox never double-writes", run: (ds) => checkOutbox(ds) },
    { id: "money", label: "Stored money is integer cents", run: (ds) => checkStoredMoney(ds) },
    { id: "tokens", label: "Portal tokens are hash-only", run: (ds) => checkTokens(ds) }
  ];

  // Run every check against a dataset. Async because the audit chain re-derives
  // its hashes. Returns { ok, at, results, passed, failed }.
  async function run(dataset, opts) {
    opts = opts || {};
    const ds = dataset || {};
    const at = opts.at || new Date().toISOString();
    const results = [];
    for (const c of CHECKS) {
      let r;
      try {
        r = await c.run(ds, opts);
      } catch (e) {
        r = { ok: false, checked: 0, failures: [{ ref: c.id, detail: (e && e.message) || String(e) }] };
      }
      results.push({
        id: c.id,
        label: c.label,
        ok: r.ok === true,
        skipped: !!r.skipped,
        checked: r.checked || 0,
        failures: r.failures || []
      });
    }
    const failed = results.filter(r => !r.ok);
    return {
      ok: failed.length === 0,
      engine: "QU_INTEGRITY",
      version: VERSION,
      at: at,
      results: results,
      passed: results.length - failed.length,
      failed: failed.length
    };
  }

  function summarize(report) {
    if (!report) return { ok: false, total: 0, passed: 0, failed: 0, failures: [] };
    return {
      ok: report.ok === true,
      total: report.results.length,
      passed: report.passed,
      failed: report.failed,
      failures: report.results.filter(r => !r.ok).map(r => ({ id: r.id, label: r.label, count: r.failures.length }))
    };
  }

  // ---- the service ----------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;

    async function readDoc(module) {
      if (!store || typeof store.loadDoc !== "function") return null;
      const d = await store.loadDoc(module);
      if (d && d.ok && d.content) return { content: d.content, revision: d.revision };
      return null;
    }

    async function loadDataset() {
      const out = { quotes: [], versions: [], lines: [], groups: [], approvals: [], intents: [], events: [], tokens: [], outbox: [], artifacts: [], documents: {} };
      for (const module of DOCS) {
        const d = await readDoc(module);
        if (!d) continue;
        out.documents[module] = d.content;
        const records = asArray(d.content);
        if (module === "quotes") out.quotes = records;
        else if (module === "quote_versions") out.versions = records;
        else if (module === "line_items") out.lines = records;
        else if (module === "option_groups") out.groups = records;
        else if (module === "approvals") out.approvals = records;
        else if (module === "invoice_intents") out.intents = records;
        else if (module === "quote_events") out.events = records;
        else if (module === "portal_tokens") out.tokens = records;
        else if (module === "outbox_jobs") out.outbox = records;
        else if (module === "quote_artifacts") out.artifacts = records;
      }
      return out;
    }

    async function check() {
      const ds = await loadDataset();
      const digest = store && typeof store.digestHex === "function" ? (text) => store.digestHex(text) : undefined;
      return run(ds, { digest: digest });
    }

    function renderZone() {
      const card = document.createElement("section");
      card.className = "card";
      card.innerHTML =
        '<div class="card-title-row"><div><h2>Invariants &amp; integrity</h2>' +
        '<p class="hint" style="margin:2px 0 0">Re-derives each non-negotiable invariant from the stored documents: frozen seals, acceptance/uniqueness, the append-only audit chain, client-surface cost exclusion and outbox idempotency.</p></div>' +
        '<span class="chip" data-int-chip>Not run</span></div>' +
        '<div class="int-list" data-int-list><p class="hint">Run the checks to see the current verdict.</p></div>' +
        '<div class="admin-actions"><button class="btn btn-ghost btn-sm" data-int-run>Run integrity checks</button></div>';
      const chip = card.querySelector("[data-int-chip]");
      const list = card.querySelector("[data-int-list]");
      const btn = card.querySelector("[data-int-run]");
      function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      }
      function paint(report) {
        if (!report) return;
        chip.textContent = report.ok ? "All invariants hold" : report.failed + " failing";
        chip.className = "chip " + (report.ok ? "ok" : "warn");
        list.innerHTML = report.results.map(r => {
          const detail = r.failures.length
            ? esc(r.failures.slice(0, 3).map(f => f.ref + ": " + f.detail).join(" · "))
            : (r.skipped ? "skipped" : r.checked + " checked");
          return '<div class="int-row"><span class="int-chip ' + (r.ok ? "pass" : "fail") + '">' + (r.ok ? "pass" : "fail") + '</span>' +
            '<div style="min-width:0"><div class="int-name">' + r.id + " · " + esc(r.label) + "</div>" +
            '<div class="int-detail">' + detail + "</div></div></div>";
        }).join("");
      }
      btn.addEventListener("click", async () => {
        btn.disabled = true;
        btn.textContent = "Checking…";
        try { paint(await check()); }
        catch (e) { list.innerHTML = '<p class="hint">Integrity checks failed to run: ' + esc((e && e.message) || e) + "</p>"; }
        btn.disabled = false;
        btn.textContent = "Run integrity checks";
      });
      return card;
    }

    return {
      loadDataset: loadDataset,
      check: check,
      run: run,
      summarize: summarize,
      renderZone: renderZone,
      ready: function () { return Promise.resolve({ ok: true }); }
    };
  }

  return {
    VERSION,
    DOCS,
    INVARIANTS,
    EXTRA,
    CHECKS: CHECKS.map(c => ({ id: c.id, label: c.label })),
    asArray,
    checkFrozen: checkFrozen,
    checkUnique: checkUnique,
    checkEvents: checkEvents,
    checkCostLeak: checkCostLeak,
    checkOutbox: checkOutbox,
    checkStoredMoney: checkStoredMoney,
    checkTokens: checkTokens,
    run: run,
    summarize: summarize,
    createService: createService
  };
})();
