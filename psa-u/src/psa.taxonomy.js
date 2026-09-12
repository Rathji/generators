/* ============================================================
   PSA-U — taxonomy & master configuration (Phase 1 · Task 5)
   The system-wide lookup data every other module reads: service
   boards, ticket statuses (open/closed + colour), priorities,
   ticket types / subtypes / items, sources, work types, charge
   roles, charge codes, billing terms, agreement types, project
   types, opportunity stages and product classes / categories.

   All of it lives in the active service provider's document as
   `taxonomy` records, so it is versioned, synced, backed up and
   covered by change history like every other tenant record. Each
   edit is additionally written to the shared audit log, and the
   version history service keeps a restorable snapshot.
   ============================================================ */

(function () {
  "use strict";

  const ERP = window.ERP;
  const T = (ERP.taxonomy = {});

  function ten() {
    if (!ERP.tenancy) throw new Error("taxonomy requires the tenancy service");
    return ERP.tenancy;
  }

  /* ─────────────────────────── category metadata ───────────────────────────
     `fields` lists the extra attributes a category's records may carry, which
     the admin console uses to build the editor for that category. */
  T.CATEGORIES = [
    { id: "board",            label: "Service boards",      hint: "Queues that own and route service work.", fields: ["color"] },
    { id: "ticketStatus",     label: "Ticket statuses",     hint: "The lifecycle a ticket moves through.", fields: ["color", "closed"] },
    { id: "priority",         label: "Priorities",          hint: "Urgency, used by SLA and dispatch.", fields: ["color", "weight"] },
    { id: "type",             label: "Ticket types",        hint: "The broad nature of the request.", fields: ["color"] },
    { id: "subtype",          label: "Ticket subtypes",     hint: "A refinement of a ticket type.", fields: ["parent"] },
    { id: "item",             label: "Ticket items",        hint: "The most specific classification.", fields: ["parent"] },
    { id: "source",           label: "Sources",             hint: "How the request arrived.", fields: [] },
    { id: "workType",         label: "Work types",          hint: "How time is classified and rated.", fields: ["color", "billable"] },
    { id: "chargeRole",       label: "Charge roles",        hint: "The labour role applied to billing.", fields: ["rate"] },
    { id: "chargeCode",       label: "Charge codes",        hint: "Treatment of the work for billing.", fields: ["color", "billable"] },
    { id: "expenseCategory",  label: "Expense categories",  hint: "Grouping and default treatment for expenses.", fields: ["color", "billable"] },
    { id: "billingTerm",      label: "Billing terms",       hint: "Payment terms offered to clients.", fields: ["days"] },
    { id: "agreementType",    label: "Agreement types",     hint: "The commercial shape of a recurring service.", fields: ["color"] },
    { id: "projectType",      label: "Project types",       hint: "How engagements are categorised.", fields: ["color"] },
    { id: "opportunityStage", label: "Opportunity stages",  hint: "Sales pipeline stages and probability.", fields: ["color", "probability", "closed", "tone"] },
    { id: "productClass",     label: "Product classes",     hint: "Top-level catalog grouping.", fields: [] },
    { id: "productCategory",  label: "Product categories",  hint: "Catalog grouping beneath a class.", fields: ["color"] },
  ];

  const CAT = {};
  T.CATEGORIES.forEach((c) => { CAT[c.id] = c; });

  T.category = (id) => CAT[id] || null;
  T.categoryLabel = (id) => (CAT[id] ? CAT[id].label : id);

  const FIELDS = [
    { id: "color", label: "Colour", type: "color" },
    { id: "parent", label: "Parent code", type: "text" },
    { id: "probability", label: "Probability (%)", type: "number" },
    { id: "weight", label: "Weight (1 = most urgent)", type: "number" },
    { id: "days", label: "Net days", type: "number" },
    { id: "rate", label: "Default rate", type: "number" },
    { id: "billable", label: "Billable by default", type: "bool" },
    { id: "closed", label: "Closed state", type: "bool" },
    { id: "tone", label: "Display tone", type: "text" },
  ];
  T.fieldDefs = FIELDS;
  T.fieldsFor = (category) => {
    const c = CAT[category];
    if (!c) return [];
    return (c.fields || []).map((f) => FIELDS.find((x) => x.id === f)).filter(Boolean);
  };

  /* ─────────────────────────── storage ───────────────────────────
     Taxonomy records live in the provider document as kind "taxonomy":
     { id, kind:"taxonomy", category, code, label, order, active, ...extra } */

  async function providerRecords(pid, kind) {
    return ten().records("provider", pid, kind);
  }

  async function writeTaxonomy(pid, records) {
    const t = ten();
    const all = await t.records("provider", pid);
    const others = all.filter((r) => r.kind !== "taxonomy");
    let max = 0;
    others.forEach((r) => { if (isFinite(r.id)) max = Math.max(max, Number(r.id)); });
    records.forEach((r) => {
      if (!isFinite(r.id)) r.id = ++max;
      else max = Math.max(max, Number(r.id));
    });
    return t.save("provider", pid, others.concat(records));
  }

  T.all = async function (pid) {
    const list = await providerRecords(pid, "taxonomy");
    return list.slice().sort((a, b) => (a.order || 0) - (b.order || 0) || String(a.label || "").localeCompare(String(b.label || "")));
  };

  T.list = async function (pid, category) {
    const list = await T.all(pid);
    return category ? list.filter((r) => r.category === category) : list;
  };

  T.find = async function (pid, category, code) {
    const list = await T.list(pid, category);
    return list.find((r) => String(r.code) === String(code)) || null;
  };

  T.label = async function (pid, category, code) {
    if (code == null || code === "") return "—";
    const r = await T.find(pid, category, code);
    return r ? r.label : String(code);
  };

  T.optionList = async function (pid, category, opts) {
    opts = opts || {};
    const list = (await T.list(pid, category)).filter((r) => opts.includeInactive || r.active !== false);
    return list.map((r) => ({ value: r.code, label: r.label }));
  };

  /* Replace the whole taxonomy record set (used by seeding/import). */
  T.save = function (pid, records) {
    return writeTaxonomy(pid, records || []);
  };

  /* Upsert one record. Assigns a stable code when one is not supplied. */
  T.upsert = async function (pid, rec) {
    const list = await T.list(pid);
    const incoming = Object.assign({ kind: "taxonomy", active: true }, rec);
    if (!incoming.code) incoming.code = slug(incoming.label) || "item";
    if (!incoming.category) return { error: "category_required" };
    /* keep codes unique within a category */
    const clash = list.find((r) => r.category === incoming.category && String(r.code) === String(incoming.code) && String(r.id) !== String(incoming.id));
    if (clash) incoming.code = incoming.code + "-" + Math.random().toString(36).slice(2, 5);
    const i = list.findIndex((r) => String(r.id) === String(incoming.id) && incoming.id != null);
    if (i >= 0) list[i] = Object.assign({}, list[i], incoming);
    else list.push(incoming);
    const res = await T.save(pid, list);
    return Object.assign({ record: incoming }, res);
  };

  T.remove = async function (pid, id) {
    const list = (await T.list(pid)).filter((r) => String(r.id) !== String(id));
    return T.save(pid, list);
  };

  function slug(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }
  T.slug = slug;

  T.count = async function (pid) {
    return (await T.all(pid)).length;
  };

  /* ─────────────────────────── default taxonomy ─────────────────────────── */

  const DEFAULTS = {
    board: [
      { code: "service-desk", label: "Service desk", color: "#0a58ca" },
      { code: "managed", label: "Managed services", color: "#0d9488" },
      { code: "projects", label: "Projects", color: "#7c3aed" },
      { code: "onboarding", label: "Onboarding", color: "#d97706" },
    ],
    ticketStatus: [
      { code: "new", label: "New", color: "#64748b", closed: false },
      { code: "in-progress", label: "In progress", color: "#0a58ca", closed: false },
      { code: "waiting-customer", label: "Waiting on client", color: "#d97706", closed: false },
      { code: "scheduled", label: "Scheduled", color: "#7c3aed", closed: false },
      { code: "resolved", label: "Resolved", color: "#0d9488", closed: false },
      { code: "closed", label: "Closed", color: "#16a34a", closed: true },
      { code: "cancelled", label: "Cancelled", color: "#dc2626", closed: true },
    ],
    priority: [
      { code: "p1", label: "Priority 1 — Critical", color: "#dc2626", weight: 1 },
      { code: "p2", label: "Priority 2 — High", color: "#ea580c", weight: 2 },
      { code: "p3", label: "Priority 3 — Medium", color: "#0a58ca", weight: 3 },
      { code: "p4", label: "Priority 4 — Low", color: "#64748b", weight: 4 },
    ],
    type: [
      { code: "incident", label: "Incident", color: "#dc2626" },
      { code: "request", label: "Service request", color: "#0a58ca" },
      { code: "problem", label: "Problem", color: "#7c3aed" },
      { code: "change", label: "Change", color: "#d97706" },
      { code: "maintenance", label: "Maintenance", color: "#0d9488" },
    ],
    subtype: [
      { code: "hardware", label: "Hardware", parent: "incident" },
      { code: "software", label: "Software", parent: "incident" },
      { code: "network", label: "Network", parent: "incident" },
      { code: "account", label: "Account & access", parent: "request" },
      { code: "procurement", label: "Procurement", parent: "request" },
    ],
    item: [
      { code: "desktop", label: "Desktop / laptop", parent: "hardware" },
      { code: "server", label: "Server", parent: "hardware" },
      { code: "printer", label: "Printer", parent: "hardware" },
      { code: "m365", label: "Microsoft 365", parent: "software" },
      { code: "password", label: "Password reset", parent: "account" },
    ],
    source: [
      { code: "phone", label: "Phone" },
      { code: "email", label: "Email" },
      { code: "portal", label: "Client portal" },
      { code: "monitoring", label: "Monitoring alert" },
      { code: "walk-in", label: "Walk-in" },
    ],
    workType: [
      { code: "remote", label: "Remote support", color: "#0a58ca", billable: true },
      { code: "onsite", label: "On-site service", color: "#7c3aed", billable: true },
      { code: "project", label: "Project work", color: "#0d9488", billable: true },
      { code: "admin", label: "Administration", color: "#64748b", billable: false },
      { code: "travel", label: "Travel", color: "#d97706", billable: true },
      { code: "training", label: "Training", color: "#0891b2", billable: true },
    ],
    chargeRole: [
      { code: "engineer", label: "Engineer", rate: 150 },
      { code: "senior", label: "Senior engineer", rate: 200 },
      { code: "consultant", label: "Consultant", rate: 250 },
      { code: "architect", label: "Architect", rate: 300 },
      { code: "pm", label: "Project manager", rate: 175 },
    ],
    chargeCode: [
      { code: "standard", label: "Standard", color: "#0a58ca", billable: true },
      { code: "after-hours", label: "After hours", color: "#7c3aed", billable: true },
      { code: "emergency", label: "Emergency", color: "#dc2626", billable: true },
      { code: "warranty", label: "Warranty", color: "#0d9488", billable: false },
      { code: "non-billable", label: "Non-billable", color: "#64748b", billable: false },
    ],
    expenseCategory: [
      { code: "travel", label: "Travel", color: "#0a58ca", billable: true },
      { code: "mileage", label: "Mileage", color: "#0d9488", billable: true },
      { code: "lodging", label: "Lodging", color: "#7c3aed", billable: true },
      { code: "meals", label: "Meals", color: "#d97706", billable: true },
      { code: "hardware", label: "Hardware & parts", color: "#0891b2", billable: true },
      { code: "software", label: "Software & subscriptions", color: "#dc2626", billable: true },
      { code: "shipping", label: "Shipping", color: "#64748b", billable: true },
      { code: "other", label: "Other", color: "#64748b", billable: true },
    ],
    billingTerm: [
      { code: "due-receipt", label: "Due on receipt", days: 0 },
      { code: "net-15", label: "Net 15", days: 15 },
      { code: "net-30", label: "Net 30", days: 30 },
      { code: "net-45", label: "Net 45", days: 45 },
    ],
    agreementType: [
      { code: "managed", label: "Managed / recurring service", color: "#0a58ca" },
      { code: "per-device", label: "Per-device", color: "#0d9488" },
      { code: "per-user", label: "Per-user", color: "#7c3aed" },
      { code: "block-hours", label: "Block of hours", color: "#d97706" },
      { code: "one-off", label: "One-off", color: "#64748b" },
    ],
    projectType: [
      { code: "implementation", label: "Implementation", color: "#0a58ca" },
      { code: "onboarding", label: "Onboarding", color: "#0d9488" },
      { code: "migration", label: "Migration", color: "#7c3aed" },
      { code: "assessment", label: "Assessment", color: "#d97706" },
      { code: "internal", label: "Internal", color: "#64748b" },
    ],
    opportunityStage: [
      { code: "lead", label: "Lead", color: "#64748b", probability: 10, closed: false, tone: "muted" },
      { code: "qualified", label: "Qualified", color: "#0a58ca", probability: 30, closed: false, tone: "info" },
      { code: "proposal", label: "Proposal", color: "#7c3aed", probability: 50, closed: false, tone: "info" },
      { code: "negotiation", label: "Negotiation", color: "#d97706", probability: 75, closed: false, tone: "warn" },
      { code: "won", label: "Won", color: "#16a34a", probability: 100, closed: true, tone: "success" },
      { code: "lost", label: "Lost", color: "#dc2626", probability: 0, closed: true, tone: "danger" },
    ],
    productClass: [
      { code: "hardware", label: "Hardware" },
      { code: "software", label: "Software" },
      { code: "service", label: "Service" },
      { code: "subscription", label: "Subscription" },
      { code: "labor", label: "Labour" },
    ],
    productCategory: [
      { code: "workstation", label: "Workstation", color: "#0a58ca" },
      { code: "server", label: "Server", color: "#7c3aed" },
      { code: "network", label: "Network", color: "#0d9488" },
      { code: "security", label: "Security", color: "#dc2626" },
      { code: "cloud", label: "Cloud", color: "#0891b2" },
      { code: "support", label: "Support", color: "#d97706" },
    ],
  };
  T.DEFAULTS = DEFAULTS;

  /* Idempotent per provider: only seeds a category that has no records yet, so
     a provider that has customised (or deliberately emptied) a category is
     never re-seeded. */
  T.seedProvider = async function (pid) {
    if (pid == null) return { skipped: "no_provider" };
    const existing = await providerRecords(pid, "taxonomy");
    if (existing.length) return { skipped: "already_seeded", count: existing.length };
    let id = 1;
    const records = [];
    for (const c of T.CATEGORIES) {
      const defs = DEFAULTS[c.id] || [];
      defs.forEach((d, i) => {
        records.push(Object.assign({
          id: id++, kind: "taxonomy", category: c.id,
          code: d.code, label: d.label, order: i + 1, active: true,
        }, d));
      });
    }
    await T.save(pid, records);
    return { seeded: records.length };
  };

  /* Idempotent for a SINGLE category: seeds one category only when it has no
     records at all, so a category added after a provider was first seeded
     (e.g. expense categories, Phase 4) still gets its defaults without
     disturbing any customisation. */
  T.ensureCategory = async function (pid, category) {
    if (pid == null) return { skipped: "no_provider" };
    if (!CAT[category]) return { error: "unknown_category" };
    const existing = await providerRecords(pid, "taxonomy");
    if (existing.some((r) => r.category === category)) return { skipped: "already_present" };
    const defs = DEFAULTS[category] || [];
    const all = await ten().records("provider", pid);
    let max = 0;
    all.forEach((r) => { if (isFinite(r.id)) max = Math.max(max, Number(r.id)); });
    const records = defs.map((d, i) => Object.assign({
      id: ++max, kind: "taxonomy", category: category,
      code: d.code, label: d.label, order: i + 1, active: true,
    }, d));
    const res = await ten().save("provider", pid, all.concat(records));
    return Object.assign({ seeded: records.length }, res);
  };

  /* Audit + history-friendly write wrapper used by the admin console. */
  T.recordChange = async function (summary, meta) {
    try {
      if (ERP.master && ERP.master.audit) {
        await ERP.master.audit({ action: "taxonomy_update", targetType: "config", targetId: 0, summary: summary, meta: meta || null });
      }
    } catch (e) {}
  };

  T.ready = null;
})();
