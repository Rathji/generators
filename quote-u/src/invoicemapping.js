// ============================================================================
// quote-u — company/customer & product mapping (roadmap task 37, part 1)
// ----------------------------------------------------------------------------
// The admin mapping that lets quote-u speak each downstream system's language:
//
//   company_customer — a quote's COMPANY maps to ONE accounting customer (its
//                      external key), so the direct path upserts the right
//                      customer; it may also carry a preferred invoice PATH.
//   product_catalog  — a line's SKU / MPN / catalog ref maps to ONE PSA
//                      catalog product id, so a PSA-written product matches
//                      the deal's catalog entry.
//
// Mappings are ordinary records in the versioned `invoice_mappings` document
// (durable, revision-guarded, audited by the store's history), so an admin can
// change them without touching code. Nothing here goes external; the resolution
// helpers are pure and the service is the persistable wrapper.
// ============================================================================
window.QU_INVOICEMAPPING = (function () {
  "use strict";

  const VERSION = "1.0.0";
  const DOC = "invoice_mappings";
  const KINDS = Object.freeze(["company_customer", "product_catalog"]);
  const DEFAULT_PATHS = Object.freeze(["direct", "psa"]);

  const FIELDS = [
    { name: "id", required: false, generated: true, note: "stable mapping id" },
    { name: "kind", required: true, note: "company_customer | product_catalog" },
    { name: "active", required: false, default: true, note: "inactive mappings are ignored" },
    // company_customer
    { name: "company_id", required: false, note: "the quote company (required for company_customer)" },
    { name: "accounting_customer_key", required: false, note: "the accounting system's external key for that company" },
    { name: "preferred_path", required: false, default: null, note: "direct | psa — an optional per-company invoice path preference" },
    // product_catalog
    { name: "sku", required: false, note: "distributor/manufacturer SKU" },
    { name: "mpn", required: false, note: "manufacturer part number" },
    { name: "catalog_ref", required: false, note: "the internal catalog item id" },
    { name: "psa_product_id", required: false, note: "the PSA catalog product id" },
    { name: "psa_sku", required: false, note: "the PSA catalog SKU (display only)" },
    { name: "label", required: false, note: "human-readable label for the admin table" },
    { name: "updated_at", required: false, default: null },
    { name: "updated_by", required: false, default: null }
  ];

  const SECRET_KEY_RE = /(?:^|_)(secret|plaintext|password|token_secret|tokensecret)(_|$)|^token$|secret$|plaintext$/i;

  class MappingError extends Error {
    constructor(code, message, meta) {
      super(message);
      this.name = "MappingError";
      this.code = code;
      if (meta) this.meta = meta;
    }
  }

  function fail(code, message, meta) { throw new MappingError(code, message, meta); }

  function isPlainObject(v) {
    return !!v && typeof v === "object" && !Array.isArray(v);
  }

  function genId(kind, rand) {
    const tag = String(kind || "map").replace(/[^a-z_]/gi, "").slice(0, 12) || "map";
    return tag + "-" + Date.now().toString(36) + "-" + (rand ? rand(6) : Math.random().toString(36).slice(2, 8));
  }

  function nowIso(clock) {
    if (typeof clock === "function") return String(clock());
    return new Date().toISOString();
  }

  function clampText(v, max) {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  }

  function normalizePolicy(input) {
    const p = isPlainObject(input) ? input : {};
    let paths = Array.isArray(p.paths) && p.paths.length ? p.paths.map(String) : DEFAULT_PATHS.slice();
    return { paths: paths };
  }

  // Pure, non-throwing assembly. Returns { ok, violations, record }.
  function collect(input, opts) {
    opts = opts || {};
    const policy = normalizePolicy(opts.policy);
    const violations = [];
    if (!isPlainObject(input)) {
      return { ok: false, violations: [{ field: null, code: "bad_mapping", detail: "A mapping must be an object" }], record: null };
    }
    for (const k of Object.keys(input)) {
      if (SECRET_KEY_RE.test(k)) violations.push({ field: k, code: "secret_not_allowed", detail: `A mapping must never carry the secret field "${k}"` });
    }
    const kind = clampText(input.kind, 40);
    if (!kind) violations.push({ field: "kind", code: "kind_required", detail: "A mapping needs a kind" });
    else if (KINDS.indexOf(kind) === -1) violations.push({ field: "kind", code: "bad_kind", detail: `Unknown mapping kind "${kind}"; expected one of ${KINDS.join(", ")}` });
    const active = input.active === undefined || input.active === null ? true : input.active !== false;

    const record = {
      id: input.id || opts.id || genId(kind || opts.kind, opts.rand),
      kind: kind,
      active: active,
      company_id: clampText(input.company_id, 120),
      accounting_customer_key: clampText(input.accounting_customer_key, 200),
      preferred_path: clampText(input.preferred_path, 20),
      sku: clampText(input.sku, 120),
      mpn: clampText(input.mpn, 120),
      catalog_ref: clampText(input.catalog_ref, 120),
      psa_product_id: clampText(input.psa_product_id, 200),
      psa_sku: clampText(input.psa_sku, 120),
      label: clampText(input.label, 200),
      updated_at: clampText(input.updated_at, 40),
      updated_by: clampText(input.updated_by, 200)
    };

    if (kind === "company_customer") {
      if (!record.company_id) violations.push({ field: "company_id", code: "company_required", detail: "A company↔customer mapping needs a company_id" });
      if (!record.accounting_customer_key) violations.push({ field: "accounting_customer_key", code: "customer_key_required", detail: "A company↔customer mapping needs the accounting customer key" });
      if (record.preferred_path && policy.paths.indexOf(record.preferred_path) === -1) violations.push({ field: "preferred_path", code: "bad_path", detail: `Unknown invoice path "${record.preferred_path}"; expected one of ${policy.paths.join(", ")}` });
    } else if (kind === "product_catalog") {
      if (!record.psa_product_id) violations.push({ field: "psa_product_id", code: "psa_product_required", detail: "A product↔catalog mapping needs the PSA product id" });
      if (!record.sku && !record.mpn && !record.catalog_ref) violations.push({ field: "sku", code: "product_key_required", detail: "A product↔catalog mapping needs at least one of sku, mpn or catalog_ref" });
    }
    return { ok: violations.length === 0, violations, record };
  }

  function validate(input, opts) { return collect(input, opts); }

  function normalize(input, opts) {
    const out = collect(input, opts);
    if (!out.ok) fail(out.violations[0].code, out.violations[0].detail, { violations: out.violations });
    return out.record;
  }

  function assertNoSecret(record) {
    if (!record || typeof record !== "object") return record;
    for (const k of Object.keys(record)) {
      if (SECRET_KEY_RE.test(k)) fail("secret_not_allowed", `A mapping must never carry a secret-shaped field ("${k}").`);
    }
    return record;
  }

  function isPathLike(v) {
    return typeof v === "string" && v.length > 0;
  }

  // Pure resolution: the accounting customer key for a company (explicit
  // mapping wins; the caller falls back to the company id when null).
  function resolveCustomerKey(records, companyId) {
    if (!companyId) return null;
    const rec = activeRecords(records).find(r => r.kind === "company_customer" && String(r.company_id) === String(companyId));
    return rec ? (rec.accounting_customer_key || null) : null;
  }

  // Pure resolution: the PSA catalog product id for a line, matched by SKU,
  // then MPN, then the internal catalog ref.
  function resolvePsaProduct(records, line) {
    line = line || {};
    const acts = activeRecords(records).filter(r => r.kind === "product_catalog");
    const keys = [
      ["sku", line.sku],
      ["mpn", line.mpn || line.manufacturer_part_number],
      ["catalog_ref", line.catalog_ref]
    ];
    for (const [field, value] of keys) {
      if (!isPathLike(value)) continue;
      const hit = acts.find(r => r[field] && String(r[field]).toLowerCase() === String(value).toLowerCase());
      if (hit) return hit.psa_product_id || null;
    }
    return null;
  }

  // Pure resolution: a company's preferred invoice path, if the admin set one.
  function preferredPath(records, companyId) {
    if (!companyId) return null;
    const rec = activeRecords(records).find(r => r.kind === "company_customer" && r.preferred_path && String(r.company_id) === String(companyId));
    return rec ? rec.preferred_path : null;
  }

  function activeRecords(records) {
    return (Array.isArray(records) ? records : []).filter(r => r && r.active !== false);
  }

  function auditRecords(records) {
    const list = Array.isArray(records) ? records : [records];
    const violations = [];
    const seen = Object.create(null);
    list.forEach((r, i) => {
      if (!isPlainObject(r)) { violations.push({ index: i, code: "bad_mapping", detail: "not an object" }); return; }
      const out = collect(r, {});
      if (!out.ok) out.violations.forEach(v => violations.push({ index: i, field: v.field, code: v.code, detail: v.detail }));
      const key = r.kind === "company_customer" ? "co:" + r.company_id : "prod:" + [r.sku || "", r.mpn || "", r.catalog_ref || ""].join("|");
      if (r.active !== false && seen[key] !== undefined) violations.push({ index: i, field: "kind", code: "duplicate_mapping", detail: `a duplicate active mapping for ${key} exists` });
      else if (r.active !== false) seen[key] = i;
    });
    return { ok: violations.length === 0, violations, count: list.length };
  }

  // ---- persistence ----------------------------------------------------------

  function createService(opts) {
    opts = opts || {};
    const store = opts.store;
    if (!store || typeof store.loadDoc !== "function" || typeof store.saveChecked !== "function") {
      fail("no_store", "QU_INVOICEMAPPING needs a document store with loadDoc/saveChecked.");
    }
    const doc = opts.doc || DOC;
    const rand = opts.rand || null;
    const clock = opts.clock || null;
    const actor = opts.actor || null;
    const policy = normalizePolicy(opts.policy);
    const maxRetries = opts.maxRetries === undefined ? 4 : opts.maxRetries;

    async function load() {
      const d = await store.loadDoc(doc);
      if (!d.ok) return d;
      const content = d.content && typeof d.content === "object" ? d.content : { records: [] };
      const records = Array.isArray(content.records) ? content.records : [];
      return { ok: true, state: d.state, revision: d.revision, content, records };
    }

    async function mutate(fn) {
      for (let attempt = 0; attempt <= maxRetries; attempt++) {
        const l = await load();
        if (!l.ok) return l;
        const next = fn(l.records.slice());
        if (next === null) return { ok: true, noop: true, revision: l.revision, records: l.records };
        const content = Object.assign({}, l.content, { records: next });
        const save = await store.saveChecked(doc, content, { expectedBase: l.revision });
        if (save.ok) return { ok: true, revision: save.revision, records: next, created: !!save.created };
        if (save.code === "conflict" || save.code === "conflict_stale" || save.code === "server_lag") continue;
        return save;
      }
      return { ok: false, code: "mapping_conflict", detail: `Could not write the ${doc} document after ${maxRetries + 1} attempts.` };
    }

    // Upsert a mapping. A company_customer mapping is unique per company, a
    // product_catalog mapping is unique per (sku|mpn|catalog_ref) key — upsert
    // replaces the existing active row rather than accumulating duplicates.
    async function upsert(input) {
      let built;
      try { built = normalize(input, { rand, clock: clock || undefined, policy }); }
      catch (e) { return { ok: false, code: e.code || "bad_mapping", detail: e.message, violations: e.meta && e.meta.violations }; }
      assertNoSecret(built);
      if (actor && !built.updated_by) built.updated_by = actor;
      built.updated_at = built.updated_at || nowIso(clock);
      const keyOf = r => r.kind === "company_customer"
        ? "co:" + r.company_id
        : "prod:" + [r.sku || "", r.mpn || "", r.catalog_ref || ""].join("|");
      const key = keyOf(built);
      let replaced = null;
      const res = await mutate(records => {
        const idx = records.findIndex(r => r && r.active !== false && keyOf(r) === key);
        if (idx !== -1) {
          replaced = records[idx];
          const copy = records.slice();
          copy[idx] = Object.assign({}, built, { id: replaced.id });
          built = copy[idx];
          return copy;
        }
        return records.concat([built]);
      });
      if (!res.ok) return res;
      return { ok: true, mapping: built, replaced: replaced ? { id: replaced.id } : null, revision: res.revision };
    }

    async function setActive(id, active) {
      let updated = null;
      const res = await mutate(records => records.map(r => {
        if (!r || r.id !== id) return r;
        updated = Object.assign({}, r, { active: active !== false, updated_at: nowIso(clock) });
        return updated;
      }));
      if (!res.ok) return res;
      if (!updated) return { ok: false, code: "mapping_not_found", detail: `No mapping ${id}.` };
      return { ok: true, mapping: updated, revision: res.revision };
    }

    async function remove(id) { return setActive(id, false); }

    async function get(id) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, mapping: l.records.find(r => r && r.id === id) || null, revision: l.revision };
    }

    async function list(filter) {
      const l = await load();
      if (!l.ok) return l;
      let recs = l.records.slice();
      if (filter) {
        if (filter.kind !== undefined) recs = recs.filter(r => r.kind === filter.kind);
        if (filter.company_id !== undefined) recs = recs.filter(r => r.company_id === filter.company_id);
        if (filter.active !== undefined) recs = recs.filter(r => (r.active !== false) === !!filter.active);
      }
      return { ok: true, mappings: recs, total: l.records.length, revision: l.revision };
    }

    async function customerKey(companyId) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, key: resolveCustomerKey(l.records, companyId) };
    }

    async function psaProduct(line) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, psa_product_id: resolvePsaProduct(l.records, line) };
    }

    async function pathFor(companyId) {
      const l = await load();
      if (!l.ok) return l;
      return { ok: true, preferred_path: preferredPath(l.records, companyId) };
    }

    async function verify() {
      const l = await load();
      if (!l.ok) return l;
      const out = auditRecords(l.records);
      out.revision = l.revision;
      return out;
    }

    function ready() {
      const p = store.ready ? Promise.resolve(store.ready()) : Promise.resolve();
      return p.then(() => ({ ok: true, doc }));
    }

    // ---- admin zone (Admin station) ----------------------------------------
    function renderZone(storeArg, zoneOpts) {
      zoneOpts = zoneOpts || {};
      const wrap = document.createElement("section");
      wrap.className = "card";
      wrap.innerHTML =
        '<div class="card-title-row"><div><h2>Invoice mappings</h2>' +
        '<p class="hint" style="margin:2px 0 0">Company → accounting customer, and product → PSA catalog. The direct path resolves the customer key from here; the PSA path resolves the product id.</p></div>' +
        '<span class="chip" data-map-chip>…</span></div>' +
        '<div data-map-list></div>' +
        '<div class="admin-actions" style="display:flex;gap:8px;flex-wrap:wrap;margin-top:12px">' +
        '<button class="btn btn-ghost btn-sm" data-map-add-company>Add company → customer</button>' +
        '<button class="btn btn-ghost btn-sm" data-map-add-product>Add product → PSA catalog</button>' +
        '</div>' +
        '<div data-map-form></div>';

      function esc(s) {
        return String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
      }

      async function refresh() {
        const chip = wrap.querySelector("[data-map-chip]");
        const listEl = wrap.querySelector("[data-map-list]");
        const l = await list();
        if (!l.ok) { chip.textContent = "unavailable"; listEl.innerHTML = '<p class="hint">Could not read the mappings.</p>'; return; }
        const active = l.mappings.filter(m => m.active !== false);
        chip.textContent = active.length + " active";
        if (!active.length) { listEl.innerHTML = '<p class="hint">No mappings yet.</p>'; return; }
        listEl.innerHTML = '<div class="sys-grid">' + active.map(m => {
          const label = m.kind === "company_customer"
            ? esc(m.company_id) + " → " + esc(m.accounting_customer_key) + (m.preferred_path ? " (" + esc(m.preferred_path) + ")" : "")
            : esc(m.sku || m.mpn || m.catalog_ref) + " → PSA " + esc(m.psa_product_id);
          return '<div class="sys-row"><span class="sys-k">' + (m.kind === "company_customer" ? "Customer" : "Product") + '</span>' +
            '<span class="sys-v muted">' + label + '</span>' +
            '<button class="btn btn-ghost btn-sm" data-map-del="' + esc(m.id) + '">Remove</button></div>';
        }).join("") + "</div>";
        listEl.querySelectorAll("[data-map-del]").forEach(btn => btn.addEventListener("click", async () => {
          btn.disabled = true;
          const r = await remove(btn.dataset.mapDel);
          if (window.QU && window.QU.toast) window.QU.toast(r.ok ? "Mapping removed" : "Could not remove: " + (r.detail || r.code));
          refresh();
        }));
      }

      function openForm(kind) {
        const formEl = wrap.querySelector("[data-map-form]");
        const isCompany = kind === "company_customer";
        formEl.innerHTML =
          '<div class="card" style="margin-top:12px"><div class="field-row">' +
          (isCompany
            ? '<label>Company id <input data-f="company_id" placeholder="c1"></label>' +
              '<label>Accounting customer key <input data-f="accounting_customer_key" placeholder="acct-c1"></label>' +
              '<label>Preferred path <select data-f="preferred_path"><option value="">(none)</option><option value="direct">direct</option><option value="psa">psa</option></select></label>'
            : '<label>SKU <input data-f="sku" placeholder="HW-AP-MR46"></label>' +
              '<label>MPN <input data-f="mpn" placeholder="MR46"></label>' +
              '<label>Catalog ref <input data-f="catalog_ref" placeholder="catalog item id"></label>' +
              '<label>PSA product id <input data-f="psa_product_id" placeholder="psa-prod-1"></label>') +
          '</div><div class="admin-actions" style="margin-top:10px">' +
          '<button class="btn btn-primary btn-sm" data-map-save>Save</button>' +
          '<button class="btn btn-ghost btn-sm" data-map-cancel>Cancel</button>' +
          '<span class="hint" data-map-msg></span></div></div>';
        formEl.querySelector("[data-map-cancel]").addEventListener("click", () => { formEl.innerHTML = ""; });
        formEl.querySelector("[data-map-save]").addEventListener("click", async () => {
          const input = { kind: kind };
          formEl.querySelectorAll("[data-f]").forEach(inp => {
            const v = inp.value.trim();
            if (v) input[inp.dataset.f] = v;
          });
          const r = await upsert(input);
          const msg = formEl.querySelector("[data-map-msg]");
          if (r.ok) { formEl.innerHTML = ""; if (window.QU && window.QU.toast) window.QU.toast("Mapping saved"); refresh(); }
          else msg.textContent = r.detail || r.code;
        });
      }

      wrap.querySelector("[data-map-add-company]").addEventListener("click", () => openForm("company_customer"));
      wrap.querySelector("[data-map-add-product]").addEventListener("click", () => openForm("product_catalog"));
      refresh();
      return wrap;
    }

    return {
      doc, policy, ready, load,
      upsert, setActive, remove, get, list,
      customerKey, psaProduct, pathFor,
      resolveCustomerKey: (companyId) => customerKey(companyId),
      resolvePsaProduct: (line) => psaProduct(line),
      preferredPath: (companyId) => pathFor(companyId),
      verify, renderZone
    };
  }

  return {
    VERSION,
    DOC,
    KINDS,
    FIELDS,
    MappingError,
    genId,
    normalizePolicy,
    validate,
    normalize,
    assertNoSecret,
    resolveCustomerKey,
    resolvePsaProduct,
    preferredPath,
    activeRecords,
    auditRecords,
    createService
  };
})();
