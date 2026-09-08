// src/psa/pipeline.js — the "small-business bus" (tasks 33–36). The PSA
// publishes and consumes versioned JSON bundles as editable files. Bundles
// published by the PSA live in this generator's namespace; bundles published
// by other pipeline participants (idea-incubator, CRM, project-master,
// the-ledger, ERP) are discovered via their own public editable files. If a
// participant doesn't exist yet, discovery degrades gracefully to "no bundles
// yet" with the schema documented for them to adopt.

import store from "./store.js";
import { toast, todayIso } from "./core.js";
import { snapshot, byId, unbilledItems, projectPaymentState, timeRevenue, effectiveRate, healthOf } from "./derive.js";

const BUS_GENERATORS = ["idea-incubator", "crm", "project-master", "the-ledger", "erp"];
export const BUNDLE_KINDS = {
  idea: { label: "Idea", from: ["idea-incubator"] },
  "crm-won-deal": { label: "Won deal", from: ["crm"] },
  "project-state": { label: "Project state", from: ["project-master"], both: true },
  invoice: { label: "Invoice", from: ["the-ledger"] },
  receipt: { label: "Receipt", from: ["the-ledger"], fromInbound: true },
  purchase: { label: "Purchase", from: ["erp"], fromInbound: true },
};

export function randName(len = 24) {
  const A = "abcdefghijklmnopqrstuvwxyz0123456789";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  let s = "";
  for (let i = 0; i < len; i++) s += A[arr[i] % A.length];
  return s;
}

const sf = () => (window.root && window.root.superFetch) || (async (url) => { throw new Error("superFetch not available"); });

async function editableNameFor(generator, name) {
  return "https://editable.uploads.dev/file/" + generator + "/" + name;
}

export async function readEditable(generator, name) {
  const url = await editableNameFor(generator, name);
  const res = await sf()(url);
  if (!res || !res.ok) throw new Error("not found");
  return res.text();
}

async function tryReadEditable(generator, name) {
  try {
    const t = await readEditable(generator, name);
    return t == null || t === "404" ? null : t;
  } catch (e) {
    return null;
  }
}

// ---- publish (from PSA to the bus) ----

export async function publishBundle(kind, payload, opts = {}) {
  await store.ready();
  const name = "psa-bus-" + kind + "-" + randName();
  const doc = {
    kind,
    schemaVersion: 1,
    publisher: window.generatorName || "business-psa",
    publishedAt: new Date().toISOString(),
    generator: window.generatorName || null,
    ids: Array.isArray(payload) ? payload.map((p) => p.id) : (payload && payload.id ? [payload.id] : []),
    payload,
  };
  const created = await window.root.uploadPlugin.editable.set(name, JSON.stringify(doc));
  if (created.error) throw new Error(created.error);
  const meta = {
    id: name,
    kind,
    publishedAt: doc.publishedAt,
    count: doc.ids.length,
    name,
    editKey: created.editKey || null,
    summary: opts.summary || "",
    status: "published",
  };
  await store.saveRecord("pipeline", { id: name, ...meta });
  await refreshManifest();
  return meta;
}

async function refreshManifest() {
  try {
    const bundleDocs = store.getAllRecords("pipeline");
    const manifest = {
      kind: "psa-bus-manifest",
      schemaVersion: 1,
      publisher: window.generatorName || "business-psa",
      updatedAt: new Date().toISOString(),
      bundles: bundleDocs.map((b) => ({ kind: b.kind, name: b.name, publishedAt: b.publishedAt, count: b.count, summary: b.summary })),
    };
    await window.root.uploadPlugin.editable.set("psa-bus-manifest", JSON.stringify(manifest), { editKey: (bundleDocs.length === 0 ? null : undefined) });
  } catch (e) {
    console.warn("[psa] manifest refresh failed:", e && e.message);
  }
}

// ---- discover (from other participants to PSA) ----

export async function discoverBundles() {
  const found = [];
  for (const g of BUS_GENERATORS) {
    for (const kind of Object.keys(BUNDLE_KINDS)) {
      const t = await tryReadEditable(g, "psa-bus-manifest");
      if (t) {
        try {
          const m = JSON.parse(t);
          for (const b of m.bundles || []) {
            found.push({ kind: b.kind, name: b.name, generator: g, publishedAt: b.publishedAt, count: b.count, summary: b.summary, source: "manifest" });
          }
        } catch (e) {}
      }
      const direct = await tryReadEditable(g, "psa-bus-" + kind + "-manifest");
      if (direct) {
        try {
          const m = JSON.parse(direct);
          for (const b of m.bundles || []) {
            if (!found.some((f) => f.generator === g && f.name === b.name)) {
              found.push({ kind: b.kind, name: b.name, generator: g, publishedAt: b.publishedAt, count: b.count, summary: b.summary, source: "manifest" });
            }
          }
        } catch (e) {}
      }
    }
  }
  const inbound = store.getAllRecords("pipeline");
  return { external: dedupe(found), local: inbound };
}

function dedupe(list) {
  const seen = new Set();
  return list.filter((b) => {
    const k = b.generator + "/" + b.name;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

export async function fetchBundle(generator, name) {
  const t = await readEditable(generator, name);
  return JSON.parse(t);
}

// ---- task 33: opportunity ingestion ----

export async function ingestOpportunities() {
  const created = [];
  const D = snapshot();
  const existing = new Set(D.opportunities.map((o) => o.bundleRef || o.id));
  const dis = await discoverBundles();
  for (const b of dis.external) {
    if (b.kind !== "idea" && b.kind !== "crm-won-deal") continue;
    if (existing.has(b.generator + "/" + b.name)) continue;
    let payload = null;
    try { payload = (await fetchBundle(b.generator, b.name)).payload; } catch (e) { continue; }
    const items = Array.isArray(payload) ? payload : (payload ? [payload] : []);
    for (const it of items) {
      const id = "opp-" + randName(12);
      const title = it.title || it.name || "Untitled opportunity";
      const opp = {
        id,
        bundleRef: b.generator + "/" + b.name,
        source: b.kind === "idea" ? "idea-incubator" : "crm",
        sourceGenerator: b.generator,
        title,
        value: Number(it.value) || Number(it.estimatedValue) || 0,
        scope: it.scope || it.description || "",
        status: "new",
        createdAt: new Date().toISOString(),
        raw: payload,
      };
      await store.saveRecord("opportunities", opp);
      created.push(opp);
    }
  }
  if (created.length) toast("Ingested " + created.length + " opportunity" + (created.length === 1 ? "" : "s") + " from the pipeline");
  return created;
}

export async function convertOpportunityToSow(oppId) {
  await store.ready();
  const opp = store.getRecord("opportunities", oppId);
  if (!opp) throw new Error("Opportunity not found.");
  const sow = {
    id: "sow-" + randName(12),
    name: opp.title,
    status: "draft",
    pricingModel: "tm",
    budgetHours: 0,
    budgetValue: opp.value || 0,
    scope: opp.scope || "",
    opportunityId: oppId,
    createdAt: new Date().toISOString(),
  };
  await store.saveRecord("sows", sow);
  await store.saveRecord("opportunities", Object.assign({}, opp, { status: "converted", convertedToSowId: sow.id, convertedAt: new Date().toISOString() }));
  return sow;
}

// ---- task 34: project state exchange ----

export async function publishProjectState(projectId) {
  await store.ready();
  const p = store.getRecord("projects", projectId);
  if (!p) throw new Error("Project not found.");
  const D = snapshot();
  const tasks = D.workplans.filter((t) => t.projectId === projectId);
  const payload = {
    id: p.id,
    name: p.name,
    clientId: p.clientId,
    status: p.status,
    phases: p.phases || [],
    milestones: p.milestones || [],
    health: healthOf(p, D),
    tasks: tasks.map((t) => ({ id: t.id, name: t.name, status: t.status, start: t.plannedStart, end: t.plannedEnd })),
    updatedAt: new Date().toISOString(),
  };
  return publishBundle("project-state", payload, { summary: "Project state for “" + p.name + "”" });
}

export async function ingestProjectState() {
  const applied = [];
  const D = snapshot();
  const projects = byId(D.projects);
  const dis = await discoverBundles();
  for (const b of dis.external) {
    if (b.kind !== "project-state") continue;
    let payload = null;
    try { payload = (await fetchBundle(b.generator, b.name)).payload; } catch (e) { continue; }
    const items = Array.isArray(payload) ? payload : [payload];
    for (const it of items) {
      const p = projects[it.id] || projects[it.name];
      if (!p) continue;
      if (it.status && it.status !== p.status) {
        await store.saveRecord("projects", Object.assign({}, p, { status: it.status, externalStatusAt: new Date().toISOString() }));
        applied.push("status");
      }
    }
  }
  if (applied.length) toast("Applied " + applied.length + " external project update" + (applied.length === 1 ? "" : "s"));
  return applied;
}

// ---- task 35: invoice & receipt exchange ----

export async function publishInvoice(invoiceId) {
  await store.ready();
  const inv = store.getRecord("billing", invoiceId);
  if (!inv) throw new Error("Invoice not found.");
  const payload = {
    id: inv.id,
    number: inv.number,
    clientId: inv.clientId,
    projectId: inv.projectId,
    date: inv.date,
    dueDate: inv.dueDate,
    currency: inv.currency,
    lineItems: inv.lineItems || [],
    subtotal: inv.subtotal, tax: inv.tax, total: inv.total,
    billingMethod: inv.billingMethod,
    status: inv.status,
    publishedAt: new Date().toISOString(),
  };
  const meta = await publishBundle("invoice", payload, { summary: "Invoice " + (inv.number || inv.id) });
  await store.saveRecord("billing", Object.assign({}, inv, { ledgerBundleId: meta.id, publishedAt: payload.publishedAt }));
  return meta;
}

export async function ingestReceipts() {
  const applied = [];
  const D = snapshot();
  const dis = await discoverBundles();
  for (const b of dis.external) {
    if (b.kind !== "receipt") continue;
    let payload = null;
    try { payload = (await fetchBundle(b.generator, b.name)).payload; } catch (e) { continue; }
    const items = Array.isArray(payload) ? payload : [payload];
    for (const r of items) {
      const inv = D.billing.find((x) => x.kind === "invoice" && (x.id === r.invoiceId || x.number === r.invoiceNumber));
      if (!inv) continue;
      const payments = inv.payments || [];
      const exists = payments.some((pm) => pm.ledgerReceiptId === r.id);
      if (exists) continue;
      const pm = { id: "pay-" + randName(10), date: r.date || todayIso(), amount: Number(r.amount) || 0, method: r.method || "bank", ledgerReceiptId: r.id, receivedAt: new Date().toISOString() };
      payments.push(pm);
      const total = Number(inv.total) || 0;
      const paid = payments.reduce((s, x) => s + (Number(x.amount) || 0), 0);
      const next = Object.assign({}, inv, { payments });
      next.status = paid >= total - 0.005 ? "paid" : (paid > 0 ? "partial" : next.status);
      await store.saveRecord("billing", next);
      applied.push(r.id);
    }
  }
  if (applied.length) toast("Applied " + applied.length + " payment receipt" + (applied.length === 1 ? "" : "s") + " from the ledger");
  return applied;
}

// ---- task 36: cost & purchase exchange with the ERP ----

export async function publishPurchases(expenseIds) {
  await store.ready();
  const items = expenseIds.map((id) => store.getRecord("expenses", id)).filter(Boolean);
  if (!items.length) throw new Error("No expenses to publish.");
  const payload = items.map((e) => ({
    id: e.id, projectId: e.projectId, type: e.type, amount: e.amount, currency: e.currency, date: e.date,
    billable: e.billable, note: e.note, source: "psa",
  }));
  return publishBundle("purchase", payload, { summary: "Purchases for " + items.length + " expense" + (items.length === 1 ? "" : "s") });
}

export async function ingestPurchases() {
  const applied = [];
  const D = snapshot();
  const existing = new Set(D.expenses.map((e) => e.externalId).filter(Boolean));
  const dis = await discoverBundles();
  for (const b of dis.external) {
    if (b.kind !== "purchase") continue;
    let payload = null;
    try { payload = (await fetchBundle(b.generator, b.name)).payload; } catch (e) { continue; }
    const items = Array.isArray(payload) ? payload : [payload];
    for (const it of items) {
      const extId = (it.id || "") + "@" + b.generator;
      if (existing.has(extId)) continue;
      const project = D.projectsById && D.projectsById[it.projectId] ? D.projectsById[it.projectId] : null;
      if (!project) continue;
      const e = {
        id: "exp-" + randName(12),
        externalId: extId,
        projectId: project.id,
        taskId: it.taskId || null,
        type: it.type || "Purchase",
        amount: Number(it.amount) || 0,
        currency: it.currency || null,
        date: it.date || todayIso(),
        billable: !!it.billable,
        note: it.note || "Imported from " + b.generator,
        status: "approved",
        locked: false,
        createdAt: new Date().toISOString(),
      };
      await store.saveRecord("expenses", e);
      applied.push(e.id);
    }
  }
  if (applied.length) toast("Imported " + applied.length + " purchase" + (applied.length === 1 ? "" : "s") + " from the ERP");
  return applied;
}
