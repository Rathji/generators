import { registerModule, moduleShell, h, el, tabs, toast } from "../core.js";
import { renderCrud } from "../crud.js";
import store from "../store.js";
import { collectionStatusEl } from "../store-ui.js";
import { approveSow, seedProjectFromSow } from "../workflow.js";
import hub from "../hub.js";

const TABS = [
  { id: "clients", label: "Clients", href: "clients" },
  { id: "catalog", label: "Service catalog", href: "clients/catalog" },
  { id: "ratecards", label: "Rate cards", href: "clients/ratecards" },
  { id: "sows", label: "Statements of work", href: "clients/sows" },
];

const currencyOpts = ["USD", "EUR", "GBP", "CAD", "AUD"].map((c) => ({ value: c, label: c }));

const clientFields = [
  { key: "name", label: "Client name", type: "text", required: true, placeholder: "Acme Corp" },
  { key: "industry", label: "Industry", type: "text", placeholder: "Healthcare" },
  { key: "address", label: "Address", type: "textarea" },
  { key: "taxId", label: "Tax ID", type: "text", placeholder: "VAT / EIN" },
  { key: "paymentTerms", label: "Payment terms", type: "text", placeholder: "Net 30" },
  { key: "contacts", label: "Primary contacts", type: "tags", placeholder: "Jane Doe — jane@acme.com (PM)" },
  { key: "tags", label: "Tags", type: "tags", placeholder: "enterprise, healthcare" },
  { key: "currency", label: "Currency", type: "select", options: currencyOpts, default: "USD" },
  { key: "active", label: "Active", type: "checkbox", default: true },
];

const clientColumns = [
  { key: "name", label: "Client", render: (r) => "<strong>" + h(r.name) + "</strong>" },
  { key: "industry", label: "Industry" },
  { key: "paymentTerms", label: "Terms" },
  { key: "tags", label: "Tags", render: (r) => (r.tags || []).slice(0, 3).map((t) => '<span class="pill">' + h(t) + "</span>").join(" ") },
  { key: "active", label: "Status", render: (r) => r.active === false ? '<span class="badge badge-muted">Inactive</span>' : '<span class="badge badge-ok">Active</span>' },
];

function clientOpts() {
  return store.getAllRecords("clients").map((c) => ({ value: c.id, label: c.name }));
}
function projectOpts() {
  return store.getAllRecords("projects").map((p) => ({ value: p.id, label: p.name }));
}

const catalogFields = [
  { key: "code", label: "Code", type: "text", placeholder: "CONS-DAY" },
  { key: "name", label: "Service name", type: "text", required: true, placeholder: "Consulting day" },
  { key: "unit", label: "Unit", type: "select", options: ["day", "hour", "month", "fixed"].map((u) => ({ value: u, label: u })), default: "day" },
  { key: "defaultRate", label: "Default rate", type: "money" },
  { key: "taxTreatment", label: "Tax treatment", type: "select", options: ["taxable", "exempt", "zero-rated"].map((t) => ({ value: t, label: t })), default: "taxable" },
  { key: "active", label: "Active", type: "checkbox", default: true },
];

const catalogColumns = [
  { key: "code", label: "Code", render: (r) => "<code>" + h(r.code || "—") + "</code>" },
  { key: "name", label: "Service", render: (r) => "<strong>" + h(r.name) + "</strong>" },
  { key: "unit", label: "Unit" },
  { key: "defaultRate", label: "Default rate", render: (r) => r.defaultRate != null ? r.defaultRate.toLocaleString() : "—" },
  { key: "taxTreatment", label: "Tax" },
  { key: "active", label: "Status", render: (r) => r.active === false ? '<span class="badge badge-muted">Inactive</span>' : '<span class="badge badge-ok">Active</span>' },
];

const rateCardFields = [
  { key: "name", label: "Card name", type: "text", required: true, placeholder: "Acme — 2026 rates" },
  { key: "scope", label: "Applies to", type: "select", options: ["global", "client", "project"].map((s) => ({ value: s, label: s === "global" ? "All clients (global)" : s === "client" ? "A specific client" : "A specific project" })), default: "global" },
  { key: "clientId", label: "Client", type: "select", options: clientOpts, depends: (v) => v.scope === "client" },
  { key: "projectId", label: "Project", type: "select", options: projectOpts, depends: (v) => v.scope === "project" },
  { key: "currency", label: "Currency", type: "select", options: currencyOpts, default: "USD" },
  { key: "discount", label: "Card discount (%)", type: "number", default: 0 },
  { key: "lines", label: "Role rates (role | rate | effectiveFrom | effectiveTo | discount%)", type: "lines", placeholder: "Consultant | 150 | 2026-01-01 | | \nSenior | 220 | 2026-01-01 | | " },
  { key: "active", label: "Active", type: "checkbox", default: true },
];

const rateCardColumns = [
  { key: "name", label: "Card", render: (r) => "<strong>" + h(r.name) + "</strong>" },
  { key: "scope", label: "Scope", render: (r) => {
      if (r.scope === "client") return "Client";
      if (r.scope === "project") return "Project";
      return "Global";
    } },
  { key: "lines", label: "Roles", render: (r) => (r.lines || []).length + " rate line" + ((r.lines || []).length === 1 ? "" : "s") },
  { key: "discount", label: "Discount", render: (r) => (r.discount ? r.discount + "%" : "—") },
  { key: "active", label: "Status", render: (r) => r.active === false ? '<span class="badge badge-muted">Off</span>' : '<span class="badge badge-ok">On</span>' },
];

const sowFields = [
  { key: "name", label: "SOW name", type: "text", required: true, placeholder: "Phase 1 — Data migration" },
  { key: "clientId", label: "Client", type: "select", options: clientOpts, required: true },
  { key: "number", label: "Reference", type: "text", placeholder: "SOW-2026-001" },
  { key: "status", label: "Status", type: "select", options: ["draft", "sent", "approved", "rejected"].map((s) => ({ value: s, label: s })), default: "draft" },
  { key: "pricingModel", label: "Pricing", type: "select", options: ["tm", "fixed", "milestone"].map((s) => ({ value: s, label: s === "tm" ? "Time & materials" : s })), default: "tm" },
  { key: "budgetHours", label: "Budget (hours)", type: "number", default: 0 },
  { key: "budgetValue", label: "Budget (value)", type: "money", default: 0 },
  { key: "startDate", label: "Start date", type: "date" },
  { key: "endDate", label: "End date", type: "date" },
  { key: "scope", label: "Scope", type: "textarea", placeholder: "What's in and out of scope…" },
  { key: "deliverables", label: "Deliverables (one per line)", type: "lines" },
  { key: "milestones", label: "Milestones (title | value | dueDate)", type: "lines" },
  { key: "taxRate", label: "Tax rate (%)", type: "number", default: 0 },
];

const sowColumns = [
  { key: "name", label: "SOW", render: (r) => "<strong>" + h(r.name) + "</strong>" + (r.number ? "<div class='cell-sub'>" + h(r.number) + "</div>" : "") },
  { key: "clientId", label: "Client", render: (r) => { const c = store.getRecord("clients", r.clientId); return h(c ? c.name : "—"); } },
  { key: "pricingModel", label: "Pricing", render: (r) => h({ tm: "T&M", fixed: "Fixed", milestone: "Milestone" }[r.pricingModel] || r.pricingModel) },
  { key: "budgetValue", label: "Value", render: (r) => (r.budgetValue ? r.budgetValue.toLocaleString() : "—") },
  { key: "status", label: "Status", render: (r) => {
      const map = { draft: "badge-muted", sent: "badge-warn", approved: "badge-ok", rejected: "badge-err" };
      return '<span class="badge ' + (map[r.status] || "badge-muted") + '">' + h(r.status) + "</span>";
    } },
];

async function renderSowDetail(sec) {
  await renderCrud(sec, {
    collection: "sows",
    moduleId: "clients",
    title: "Statements of work",
    subtitle: "Draft, send, approve or reject — an approved SOW seeds its project automatically.",
    singular: "SOW",
    newLabel: "New SOW",
    columns: sowColumns,
    fields: sowFields,
    searchKeys: ["name", "number", "scope"],
    sortBy: (a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""),
    detailActions: (rec, ctx) => {
      const acts = [];
      if (rec.status === "draft") {
        acts.push({ label: "Send to client", icon: "arrow", onClick: async () => {
            await store.saveRecord("sows", Object.assign({}, rec, { status: "sent", sentAt: new Date().toISOString() }));
            toast("SOW sent to client");
            ctx.refresh();
          } });
      }
      if (rec.status === "sent") {
        acts.push({ label: "Approve", icon: "check", kind: "btn-primary", onClick: async () => {
            const auth = await hub.requireAction("sow.approve", "approved SOW " + (rec.number || rec.name));
            if (!auth.ok) return;
            await approveSow(rec, auth.actor || "local");
            hub.recordAudit("sow.approve", "approved SOW " + (rec.number || rec.name), auth.actor).catch(() => {});
            toast("SOW approved — project seeded");
            ctx.refresh();
          } });
        acts.push({ label: "Reject", kind: "btn-danger", onClick: async () => {
            const auth = await hub.requireAction("sow.approve", "rejected SOW " + (rec.number || rec.name));
            if (!auth.ok) return;
            await store.saveRecord("sows", Object.assign({}, rec, { status: "rejected", rejectedAt: new Date().toISOString() }));
            hub.recordAudit("sow.approve", "rejected SOW " + (rec.number || rec.name), auth.actor).catch(() => {});
            toast("SOW rejected");
            ctx.refresh();
          } });
      }
      if (rec.status === "approved") {
        const hasProject = store.getAllRecords("projects").some((p) => p.sowId === rec.id);
        if (!hasProject) {
          acts.push({ label: "Seed project", icon: "box", onClick: async () => {
              await seedProjectFromSow(rec, "local");
              toast("Project created from SOW");
              ctx.refresh();
            } });
        } else {
          acts.push({ label: "Open project", onClick: async (x) => {
              const p = store.getAllRecords("projects").find((p) => p.sowId === rec.id);
              if (p) location.hash = "#/projects/" + p.id;
            } });
        }
      }
      return acts;
    },
    detailSections: [
      (rec) => {
        const wrap = el("div", "psa-derive");
        const history = rec.revisionHistory || [];
        let html = "<h5>Revision history</h5>";
        if (!history.length) html += "<p class='dim'>No revisions yet.</p>";
        else {
          html += history.map((hx) => "<div class='rev-line'><strong>r" + hx.at.slice(0, 10) + "</strong> by " + h(hx.by || "—") + " — " + h(hx.note || "") + " (" + (hx.impactHours || 0) + "h, " + (hx.impactValue || 0) + " value)</div>").join("");
        }
        wrap.innerHTML = html;
        return wrap;
      }
    ],
  });
}

async function renderCrudTab(sec, cfg) {
  await renderCrud(sec, cfg);
}

export function renderClientsModule(view, route) {
  const active = route.parts[0] || "clients";
  const sec = moduleShell("clients");
  view.appendChild(sec);
  sec.appendChild(tabs(active, TABS));
  if (active === "clients" || !["clients", "catalog", "ratecards", "sows"].includes(active)) {
    return renderCrud(sec, {
      collection: "clients",
      moduleId: "clients",
      title: "Clients",
      subtitle: "The companies you work with — contacts, payment terms, tax details and rate cards.",
      singular: "Client",
      newLabel: "Add client",
      columns: clientColumns,
      fields: clientFields,
      searchKeys: ["name", "industry", "tags", "taxId"],
      sortBy: (a, b) => a.name.localeCompare(b.name),
      emptyState: { title: "No clients yet", message: "Add your first client to start scoping work.", action: { label: "Add client" } },
    });
  }
  if (active === "catalog") {
    return renderCrud(sec, {
      collection: "catalog",
      moduleId: "clients",
      title: "Service catalog",
      subtitle: "The services you sell — units, default rates, tax treatment — referenced by SOWs, plans and billing.",
      singular: "Service",
      newLabel: "Add service",
      columns: catalogColumns,
      fields: catalogFields,
      searchKeys: ["name", "code"],
      sortBy: (a, b) => a.name.localeCompare(b.name),
      emptyState: { title: "No services yet", message: "Add the services you sell so SOWs and rate cards can reference them.", action: { label: "Add service" } },
    });
  }
  if (active === "ratecards") {
    return renderCrud(sec, {
      collection: "ratecards",
      moduleId: "clients",
      title: "Rate cards",
      subtitle: "Per-client, per-project or global role-based rates. Quotes and invoices both resolve from here — one source of truth.",
      singular: "Rate card",
      newLabel: "Add rate card",
      columns: rateCardColumns,
      fields: rateCardFields,
      searchKeys: ["name"],
      sortBy: (a, b) => a.name.localeCompare(b.name),
      emptyState: { title: "No rate cards yet", message: "Add a global, client or project rate card so billing rates resolve automatically.", action: { label: "Add rate card" } },
      onBeforeSave: (rec) => {
        rec.lines = (rec.lines || []).map((l) => Array.isArray(l) ? { role: l[0] || "", rate: Number(l[1]) || 0, effectiveFrom: l[2] || null, effectiveTo: l[3] || null, discount: l[4] ? Number(l[4]) : 0 } : l);
        if (rec.scope !== "client") rec.clientId = null;
        if (rec.scope !== "project") rec.projectId = null;
      },
    });
  }
  if (active === "sows") {
    return renderSowDetail(sec);
  }
}

registerModule({
  id: "clients",
  label: "Clients",
  icon: "clients",
  async render({ view, route }) {
    await renderClientsModule(view, route);
    const sec = view.querySelector(".psa-module");
    if (sec) sec.appendChild(await collectionStatusEl("clients"));
  }
});
