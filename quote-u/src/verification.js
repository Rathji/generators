// ============================================================================
// quote-u — live verification gates (roadmap task 64)
// ----------------------------------------------------------------------------
// Every external integration must be actively VERIFIED before it is trusted,
// and the evidence is recorded. A gate is:
//
//   1. PROBED — a live read is made through the connector gateway, so the
//      allowlist, scope, role and key resolution all run for real (a mock
//      connector proves the wire is reachable; a live one proves the service).
//   2. PROVEN — the operator supplies evidence of the real outcome (the quote
//      id linked to the opportunity, the deal value visible downstream, the
//      finance-reconciled invoice, …). Evidence is REQUIRED; a probe alone
//      never marks an integration verified.
//   3. RECORDED — the evidence is persisted in the `verification_gates`
//      document and appended to the audit log (`integration_verified`), then
//      the README documents the gate list.
//
// The engine is what makes "enabled" mean something: `enablement()` tells the
// operator which integrations have been proven, and `assertVerified(id)` fails
// closed for anything that has not.
// ============================================================================
window.QU_VERIFICATION = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DOC = "verification_gates";

  const DEFAULT_POLICY = Object.freeze({ require_evidence: true, scope: "*" });

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function normalizePolicy(input) {
    const p = isPlainObject(input) ? input : {};
    return {
      require_evidence: p.require_evidence === false ? false : true,
      scope: p.scope === undefined || p.scope === null || p.scope === "" ? "*" : p.scope
    };
  }

  function nowIso(clock) {
    if (typeof clock === "function") {
      const v = clock();
      return v instanceof Date ? v.toISOString() : String(v);
    }
    return new Date().toISOString();
  }

  function asArray(v) {
    if (Array.isArray(v)) return v;
    if (v && Array.isArray(v.records)) return v.records;
    return [];
  }

  // The declared gates. Each probe is a READ function on a real connector, so
  // probing proves the gateway path end-to-end without mutating anything.
  const GATES = Object.freeze([
    { id: "psa_account_link", connector: "psa", label: "A real quote is linked to a real opportunity", probe: { fn: "getCompany", payload: { id: "c1" } }, evidence: "the quote id and the opportunity id it is linked to" },
    { id: "psa_deal_value", connector: "psa", label: "The approved deal value is visible downstream", probe: { fn: "getOpportunity", payload: { id: "op1" } }, evidence: "the opportunity id and the deal value (integer cents) now on it" },
    { id: "psa_note", connector: "psa", label: "The products/costs note is visible downstream", probe: { fn: "getOpportunityNotes", payload: { id: "op1" } }, evidence: "the opportunity id and the note it now carries" },
    { id: "psa_revenue", connector: "psa", label: "The revenue/product lines exist downstream", probe: { fn: "getRevenueLines", payload: { id: "op1" } }, evidence: "the revenue lines and their total" },
    { id: "mail_delivery", connector: "mail", label: "The quote link is delivered as the rep", probe: { fn: "listReps", payload: {} }, evidence: "the delivered message id and the rep's own mailbox" },
    { id: "accounting_invoice", connector: "accounting", label: "A finance-reconciled invoice exists", probe: { fn: "invoiceCount", payload: {} }, evidence: "the external invoice id and the reconciled amount" },
    { id: "psa_invoice", connector: "psa", label: "The PSA produced the invoice", probe: { fn: "psaInvoiceCount", payload: {} }, evidence: "the PSA invoice id" },
    { id: "distributor_a_read", connector: "distributor_a", label: "Primary distributor prices read", probe: { fn: "searchCatalog", payload: { query: "MR46" } }, evidence: "a captured price-snapshot id" },
    { id: "distributor_b_read", connector: "distributor_b", label: "Secondary distributor prices read", probe: { fn: "searchCatalog", payload: { query: "MR46" } }, evidence: "a captured price-snapshot id" },
    { id: "content_read", connector: "content", label: "Product content resolves", probe: { fn: "wikidataSearch", payload: { query: "Meraki MR46" } }, evidence: "an enriched catalog item id" },
    { id: "bus_publish", connector: "bus", label: "Events publish to the pipeline bus", probe: { fn: "streamSize", payload: { stream: "bus-quote-events" } }, evidence: "a published envelope id" },
    { id: "quoteread_read", connector: "quoteread", label: "The read-only quote API answers", probe: { fn: "search", payload: { query: "" } }, evidence: "a quote id returned by the read API" }
  ]);

  function gateById(id) {
    return GATES.find(g => g.id === id) || null;
  }

  function evidenceText(evidence) {
    if (evidence === undefined || evidence === null) return "";
    if (typeof evidence === "string") return evidence.trim();
    if (isPlainObject(evidence)) return Object.keys(evidence).length ? JSON.stringify(evidence) : "";
    if (Array.isArray(evidence)) return evidence.length ? JSON.stringify(evidence) : "";
    return String(evidence).trim();
  }

  function createService(opts) {
    opts = opts || {};
    const store = opts.store || null;
    const gateway = opts.gateway || null;
    const audit = opts.audit || null;
    const policy = normalizePolicy(opts.policy);
    const clock = opts.clock || null;
    const scope = opts.scope === undefined ? policy.scope : opts.scope;
    let maxRetries = Number.isInteger(opts.maxRetries) ? opts.maxRetries : 3;

    function gates() {
      return GATES.map(g => ({ id: g.id, connector: g.connector, label: g.label, evidence: g.evidence }));
    }

    async function load() {
      if (!store || typeof store.loadDoc !== "function") return { ok: true, records: [], revision: 0 };
      const d = await store.loadDoc(DOC);
      if (!d || !d.ok) return { ok: false, code: "verify_read_failed", detail: (d && d.detail) || "Could not read the verification registry." };
      return { ok: true, records: asArray(d.content), revision: d.revision || 0 };
    }

    // Read-check-upsert-save: exactly one evidence row per gate (the latest).
    async function mutate(fn) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await load();
        if (!l.ok) return l;
        const next = fn(l.records.slice());
        if (next === null) return { ok: true, noop: true, revision: l.revision };
        const save = await store.saveChecked(DOC, { records: next }, { expectedBase: l.revision });
        if (save && save.ok) return { ok: true, revision: save.revision, records: next };
        if (save && (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag")) continue;
        return save || { ok: false, code: "verify_write_failed", detail: "Could not persist the verification evidence." };
      }
      return { ok: false, code: "verify_conflict", detail: "The verification registry kept moving; please retry." };
    }

    async function invoke(connector, fn, payload) {
      if (!connector || !fn) return { ok: true, skipped: true, detail: "This gate has no probe." };
      if (!gateway) return { ok: false, code: "no_gateway", detail: "No connector gateway is attached." };
      try {
        if (typeof gateway.callAsync === "function") return await gateway.callAsync(connector, fn, payload || {}, { scope: scope });
        const res = gateway.call(connector, fn, payload || {}, { scope: scope });
        if (res && res.result && typeof res.result.then === "function") return Object.assign({}, res, { result: await res.result });
        return res;
      } catch (e) {
        return { ok: false, code: "probe_threw", detail: (e && e.message) || String(e) };
      }
    }

    async function probe(id) {
      const gate = gateById(id);
      if (!gate) return { ok: false, code: "unknown_gate", detail: `No verification gate named "${id}".` };
      const res = await invoke(gate.connector, gate.probe && gate.probe.fn, gate.probe && gate.probe.payload);
      return {
        ok: res && res.ok === true,
        connector: gate.connector,
        fn: gate.probe ? gate.probe.fn : null,
        code: res && res.code ? res.code : null,
        detail: res && res.ok === true ? "The connector answered." : ((res && res.detail) || "The connector did not answer."),
        result: res && res.ok === true ? res.result : undefined
      };
    }

    async function status() {
      const l = await load();
      if (!l.ok) return l;
      const byGate = new Map();
      l.records.forEach(r => { if (r && r.gate_id) byGate.set(r.gate_id, r); });
      const rows = GATES.map(g => {
        const rec = byGate.get(g.id) || null;
        return {
          id: g.id,
          connector: g.connector,
          label: g.label,
          evidence_required: g.evidence,
          verified: !!rec,
          verified_at: rec ? rec.verified_at || null : null,
          verified_by: rec ? rec.verified_by || null : null,
          evidence: rec ? rec.evidence || null : null,
          probe: rec ? rec.probe || null : null
        };
      });
      return { ok: true, gates: rows, verified_count: rows.filter(r => r.verified).length, total: rows.length };
    }

    async function isVerified(id) {
      const l = await load();
      if (!l.ok) return { ok: false, code: l.code, detail: l.detail, verified: false };
      const rec = l.records.find(r => r && r.gate_id === id) || null;
      return { ok: true, verified: !!rec, record: rec };
    }

    // Verify a gate: probe first (a failed probe writes nothing), then require
    // evidence, then record it durably and audit it.
    async function verify(id, o) {
      o = o || {};
      const gate = gateById(id);
      if (!gate) return { ok: false, code: "unknown_gate", detail: `No verification gate named "${id}".` };
      let p;
      if (typeof o.probe === "function") {
        try { p = await o.probe(gate); } catch (e) { p = { ok: false, code: "probe_threw", detail: (e && e.message) || String(e) }; }
      } else {
        p = await probe(id);
      }
      if (!p || p.ok !== true) {
        return { ok: false, code: p && p.code ? p.code : "probe_failed", detail: (p && p.detail) || `The ${gate.connector} probe failed.`, gate: gate.id, probe: p };
      }
      const evidence = evidenceText(o.evidence);
      if (policy.require_evidence && !evidence) {
        return { ok: false, code: "evidence_required", detail: `Verifying "${gate.label}" requires evidence: ${gate.evidence}.`, gate: gate.id, probe: p };
      }
      const at = o.at ? String(o.at) : nowIso(clock);
      const row = {
        id: "vg-" + gate.id,
        gate_id: gate.id,
        connector: gate.connector,
        label: gate.label,
        verified_at: at,
        verified_by: o.by ? String(o.by) : "operator",
        evidence: evidence || null,
        notes: o.notes ? String(o.notes) : null,
        probe: { ok: true, connector: gate.connector, fn: p.fn || null, at: at }
      };
      const res = await mutate(records => {
        const out = records.filter(r => !(r && r.gate_id === gate.id));
        out.push(row);
        return out;
      });
      if (!res.ok) return res;
      if (audit && typeof audit.append === "function") {
        try {
          await audit.append({
            event: "integration_verified",
            actor_type: "internal",
            actor: row.verified_by,
            detail: { gate_id: gate.id, connector: gate.connector, evidence: evidence || null, notes: row.notes }
          });
        } catch (e) { /* the durable evidence row is the record of truth */ }
      }
      return { ok: true, gate: gate.id, connector: gate.connector, record: row, revision: res.revision };
    }

    // Per-connector enablement: a connector is enabled only once every gate it
    // backs is verified.
    async function enablement() {
      const st = await status();
      if (!st.ok) return st;
      const byConnector = {};
      st.gates.forEach(g => {
        if (!byConnector[g.connector]) byConnector[g.connector] = { verified: true, total: 0, pending: [] };
        byConnector[g.connector].total++;
        if (!g.verified) {
          byConnector[g.connector].verified = false;
          byConnector[g.connector].pending.push(g.id);
        }
      });
      return { ok: true, connectors: byConnector, verified: Object.keys(byConnector).filter(k => byConnector[k].verified) };
    }

    async function assertVerified(id) {
      const g = await isVerified(id);
      if (!g.ok) return g;
      if (!g.verified) {
        return { ok: false, code: "integration_not_verified", detail: `The integration gate "${id}" has not been verified with live evidence.` };
      }
      return { ok: true, record: g.record };
    }

    async function list() {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, records: l.records.slice() };
    }

    function renderZone() {
      const card = document.createElement("section");
      card.className = "card";
      card.innerHTML =
        '<div class="card-title-row"><div><h2>Live verification gates</h2>' +
        '<p class="hint" style="margin:2px 0 0">Each external integration is probed through the connector gateway and then proven with recorded evidence before it is trusted.</p></div>' +
        '<span class="chip" data-vf-chip>…</span></div>' +
        '<div class="vf-list" data-vf-list><p class="hint">Loading gates…</p></div>';
      const chip = card.querySelector("[data-vf-chip]");
      const listEl = card.querySelector("[data-vf-list]");
      function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      }
      function paint(st) {
        chip.textContent = st.verified_count + "/" + st.total + " verified";
        chip.className = "chip " + (st.verified_count === st.total ? "ok" : "warn");
        listEl.innerHTML = st.gates.map(g =>
          '<div class="vf-row" data-gate="' + esc(g.id) + '">' +
            '<span class="int-chip ' + (g.verified ? "pass" : "fail") + '">' + (g.verified ? "verified" : "unverified") + '</span>' +
            '<div style="min-width:0;flex:1"><div class="int-name">' + esc(g.label) + ' <span class="muted">· ' + esc(g.connector) + '</span></div>' +
            '<div class="int-detail">' + (g.verified ? "verified by " + esc(g.verified_by) + " at " + esc(String(g.verified_at).slice(0, 19)) + " — " + esc(String(g.evidence || "")) : "needs: " + esc(g.evidence_required)) + "</div>" +
            '<div class="vf-controls"><input class="vf-evidence" placeholder="Evidence…" value="' + esc(g.verified ? "" : "") + '"><button class="btn btn-ghost btn-sm" data-vf-verify>Verify</button></div>' +
            "</div></div>"
        ).join("");
        listEl.querySelectorAll("[data-vf-verify]").forEach(btn => {
          btn.addEventListener("click", async () => {
            const row = btn.closest("[data-gate]");
            const id = row.getAttribute("data-gate");
            const input = row.querySelector(".vf-evidence");
            btn.disabled = true;
            btn.textContent = "Probing…";
            try {
              const r = await verify(id, { evidence: input.value, by: "admin" });
              if (window.QU && window.QU.toast) window.QU.toast(r.ok ? "Verified: " + id : "Verification failed: " + (r.detail || r.code));
            } catch (e) {
              if (window.QU && window.QU.toast) window.QU.toast("Verification failed: " + ((e && e.message) || e));
            }
            btn.disabled = false;
            btn.textContent = "Verify";
            const fresh = await status();
            if (fresh.ok) paint(fresh);
          });
        });
      }
      (async () => {
        try {
          const st = await status();
          if (st.ok) paint(st);
          else listEl.innerHTML = '<p class="hint">Could not read the verification registry.</p>';
        } catch (e) {
          listEl.innerHTML = '<p class="hint">Verification gates failed to load: ' + esc((e && e.message) || e) + "</p>";
        }
      })();
      return card;
    }

    function ready() {
      return Promise.resolve({ ok: true });
    }

    return {
      policy: policy,
      gates: gates,
      probe: probe,
      status: status,
      isVerified: isVerified,
      verify: verify,
      enablement: enablement,
      assertVerified: assertVerified,
      list: list,
      renderZone: renderZone,
      ready: ready
    };
  }

  return {
    VERSION,
    DOC,
    GATES,
    DEFAULT_POLICY,
    normalizePolicy,
    gateById,
    evidenceText,
    createService: createService
  };
})();
