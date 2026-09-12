// src/modules/trackers.js — the Trackers station (roadmap tasks 24–25; later
// phases extend it with licences, warranties and support dates).
//
// The Trackers station is the lifecycle surface: what expires, and when. Today
// it watches two things, each a standardized record type with a best-effort live
// lookup so the facts do not have to be retyped:
//   • DOMAINS (task 24) — registration, name servers and DNS records, watched
//     against their registration expiry (framework/domain.js); and
//   • SSL CERTIFICATES (task 25) — the host and port, issuer, SANs and validity
//     window, watched against their expiry (framework/certificate.js).
//
// The station lists the client documentation sets; opening one (`#/trackers/<id>`)
// shows that client's renewal outlook, then its domains and certificates, each
// opening the editors in tracker-view.js. The Organizations station's record
// table offers the same "Open" action.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState, loadingState, errorState } from "../framework/states.js";
import { viewPanel, confirmDialog, relTime, openModal } from "./shared.js";
import { openDomainEditor, openCertificateEditor, expiryBadge } from "./tracker-view.js";
import { renderLifecycle } from "./lifecycle-view.js";
import { INFORMATION_MODELS, PROVENANCE } from "../framework/classification.js";
import { domainExpiryStatus } from "../framework/domain.js";
import { certificateExpiryStatus } from "../framework/certificate.js";

const DESC =
  "Every date that matters for a client — domain and certificate expiries, licence and subscription renewals, warranty, support and end-of-life dates, document review — aggregated into one lifecycle view, queued by urgency, assigned an owner and exported as a renewal schedule.";
const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

export default {
  id: "trackers",
  label: "Trackers",
  desc: DESC,
  icon: icons.clock,
  render(ctx) {
    renderList(ctx);
  },
  renderDetail(ctx, sub) {
    renderDetail(ctx, decodeURIComponent(sub));
  },
};

// ---------------------------------------------------------------------------
// list view — the client picker
// ---------------------------------------------------------------------------
function renderList(ctx) {
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading documentation sets…" }));
  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewDocSetBtn", onClick: () => newSet(ctx) }, "New documentation set"),
  );
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Trackers", desc: DESC, actions, body }));
  loadList(ctx, body);
}

async function loadList(ctx, body) {
  let sets;
  try {
    sets = (await ctx.docs.summaries({ includeArchived: false })) || [];
  } catch (e) {
    clear(body);
    body.append(errorState({ title: "Couldn’t load documentation sets", description: String((e && e.message) || e), onRetry: () => loadList(ctx, body) }));
    return;
  }
  clear(body);
  if (!sets.length) {
    body.append(
      emptyState({
        icon: icons.clock,
        title: "Nothing being tracked yet",
        description:
          "Domains and SSL certificates live inside a client's documentation set. Create a documentation set, then track its domains and certificates here — with live lookups for DNS, registration and certificate details.",
        action: h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => newSet(ctx) }, "New documentation set"),
      }),
    );
    return;
  }
  const grid = h("div", { class: "kb-docset-grid" });
  for (const s of sets) grid.append(setCard(s));
  body.append(h("div", { class: "kb-docset-count" }, sets.length + " documentation set" + (sets.length === 1 ? "" : "s")), grid);
}

function setCard(s) {
  const c = s.counts || {};
  const domains = c.domains || 0;
  const certs = c.certificates || 0;
  const chips = [];
  if (domains) chips.push(h("span", { class: "kb-chip" }, domains + " domain" + (domains === 1 ? "" : "s")));
  if (certs) chips.push(h("span", { class: "kb-chip" }, certs + " certificate" + (certs === 1 ? "" : "s")));
  return h(
    "a",
    { class: "kb-docset-card", href: "#/trackers/" + s.id, dataset: { id: s.id } },
    h(
      "div",
      { class: "kb-docset-card-head" },
      h("span", { class: "kb-docset-avatar", html: icons.clock }),
      h("div", { class: "kb-docset-card-id" }, h("h3", { class: "kb-docset-name" }, s.name), h("div", { class: "kb-docset-kind" }, "Documentation set")),
    ),
    h("div", { class: "kb-docset-meta" }, domains + certs ? domains + " domain" + (domains === 1 ? "" : "s") + " · " + certs + " certificate" + (certs === 1 ? "" : "s") : "Nothing tracked yet"),
    chips.length ? h("div", { class: "kb-chips" }, chips) : h("div", { class: "kb-chips" }, h("span", { class: "kb-chip kb-chip-empty" }, "No domains or certificates")),
  );
}

async function newSet(ctx) {
  const name = await promptName();
  if (!name) return;
  try {
    const set = await ctx.docs.create({ name, createdBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Created “" + set.name + "”", "success");
    ctx.go("#/trackers/" + set.id);
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

function promptName() {
  return new Promise((resolve) => {
    const input = h("input", { class: "kb-input", type: "text", placeholder: "Client, department or business unit name" });
    const m = openModal({ title: "New documentation set", children: [h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Name"), input)] });
    m.actions.append(
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => { m.close(); resolve(null); } }, "Cancel"),
      h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => { const v = input.value.trim(); m.close(); resolve(v || null); } }, "Create"),
    );
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { const v = input.value.trim(); m.close(); resolve(v || null); }
    });
    input.focus();
  });
}

// ---------------------------------------------------------------------------
// detail view — this client's renewal outlook + domains + certificates
// ---------------------------------------------------------------------------
function renderDetail(ctx, id) {
  const titleEl = h("h1", { class: "kb-view-title" }, "…");
  const crumbEl = h("div", { class: "kb-breadcrumb" }, "IT-U / Trackers");
  const actions = h("div", { class: "kb-actions-row" });
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading trackers…" }));
  ctx.container.append(
    h(
      "div",
      { class: "kb-view" },
      h(
        "header",
        { class: "kb-view-head" },
        crumbEl,
        h("div", { class: "kb-view-title-row" }, titleEl, actions),
        h("p", { class: "kb-view-desc" }, "Everything with a date that matters for this client — aggregated across domains, certificates, configurations, licences and documents; queued by urgency with owner assignment, escalation and an exportable renewal schedule. Open an item to assign, snooze or record the action taken."),
      ),
      body,
    ),
  );
  loadDetail(ctx, id, { titleEl, crumbEl, actions, body });
}

async function loadDetail(ctx, id, ui) {
  let set;
  try {
    set = await ctx.docs.get(id, { force: true });
  } catch (e) {
    clear(ui.body);
    ui.body.append(errorState({ title: "Couldn’t load this documentation set", description: String((e && e.message) || e), onRetry: () => loadDetail(ctx, id, ui) }));
    return;
  }
  if (!set) {
    ui.titleEl.textContent = "Not found";
    clear(ui.body);
    ui.body.append(
      emptyState({
        icon: icons.alert,
        title: "Documentation set not found",
        description: "It may have been deleted.",
        action: h("a", { class: "kb-btn kb-btn-ghost", href: "#/trackers" }, "Back to Trackers"),
      }),
    );
    return;
  }
  ui.titleEl.textContent = set.name;
  ui.crumbEl.replaceChildren(
    h("a", { class: "kb-bc-link", href: "#/trackers" }, "IT-U / Trackers"),
    h("span", { class: "kb-bc-current" }, " / " + set.name),
  );
  const reload = () => loadDetail(ctx, id, ui);
  const archived = !!set.archived;
  clear(ui.actions);
  ui.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => ctx.go("#/organizations/" + set.id) }, "Open full set"),
    archived ? null : h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbAddDomainBtn", onClick: () => newTracked(ctx, set, "domains", reload) }, "+ Domain"),
    archived ? null : h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbAddCertBtn", onClick: () => newTracked(ctx, set, "certificates", reload) }, "+ Certificate"),
  );
  const typeOf = await buildTypeResolver(ctx);
  let wf = null;
  try {
    wf = await ctx.docs.lifecycleWorkflow(set.id, { typeOf });
  } catch {
    wf = null;
  }
  clear(ui.body);
  ui.body.append(...renderTrackers(ctx, set, reload, { archived, wf, typeOf }));
}

// Resolve a flexible asset's template by its assetTypeId, so the lifecycle
// aggregator can find an asset-expiry field. Returns a null-safe resolver.
async function buildTypeResolver(ctx) {
  const types = ctx.assetTypes ? await ctx.assetTypes.list().catch(() => []) : [];
  const map = new Map((types || []).map((t) => [t.id, t]));
  return (rec) => (rec && map.get(rec.assetTypeId)) || null;
}

function renderTrackers(ctx, set, reload, opts = {}) {
  const readonly = !!opts.archived;
  const wf = opts.wf || { items: [], counts: {}, queues: {}, byKind: {}, assets: [] };
  const typeOf = opts.typeOf;
  const domains = set.records.domains || [];
  const certs = set.records.certificates || [];
  const out = [];
  if (readonly) {
    out.push(
      h(
        "div",
        { class: "kb-banner kb-banner-archived" },
        h("span", { class: "kb-banner-icon", html: icons.history }),
        h("div", { class: "kb-banner-text" }, h("strong", null, "This documentation set is archived and read-only.")),
      ),
    );
  }

  const c = wf.counts || {};
  out.push(
    h(
      "div",
      { class: "kb-kpi-row", id: "kbTrackerKpis" },
      kpi(String(c.overdue || 0), "Overdue", c.overdue ? "bad" : ""),
      kpi(String(c.dueSoon || 0), "Due soon", c.dueSoon ? "warn" : ""),
      kpi(String(c.upcoming || 0), "Upcoming", c.upcoming ? "info" : ""),
      kpi(String(c.tracked || 0), "Dated items"),
      kpi(String(c.unassigned || 0), "Unassigned", c.unassigned ? "warn" : ""),
      kpi(String(c.escalated || 0), "Escalated", c.escalated ? "bad" : ""),
    ),
  );

  // The lifecycle view (tasks 26–27): queues, every dated item, the per-asset
  // roll-up and the exportable renewal schedule.
  if ((wf.items || []).length) {
    out.push(...renderLifecycle(ctx, set, wf, { readonly, reload, typeOf }));
  } else {
    out.push(
      h(
        "section",
        { class: "kb-card kb-record-section", id: "kbLifecycleEmpty" },
        h(
          "div",
          { class: "kb-section-head" },
          h("span", { class: "kb-section-icon", html: icons.bell }),
          h("h2", { class: "kb-section-name" }, "Lifecycle"),
        ),
        h("p", { class: "kb-muted" }, "No dated items yet. Add a domain or certificate, a configuration's warranty / support / end-of-life date, a licence expiry or a document review date and it will be aggregated here — queued by urgency, assigned an owner and exported as a renewal schedule."),
      ),
    );
  }

  out.push(domainSection(ctx, set, reload, readonly));
  out.push(certSection(ctx, set, reload, readonly));
  return out;
}

function kpi(value, label, tone) {
  return h("div", { class: "kb-kpi" + (tone ? " kb-kpi--" + tone : "") }, h("span", { class: "kb-kpi-value" }, value), h("span", { class: "kb-kpi-label" }, label));
}

function domainSection(ctx, set, reload, readonly) {
  const domains = set.records.domains || [];
  const section = h(
    "section",
    { class: "kb-card kb-record-section", dataset: { type: "domains" } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.globe }),
      h("h2", { class: "kb-section-name" }, "Domains"),
      h("span", { class: "kb-count-pill" }, String(domains.length)),
      readonly ? null : addButton(ctx, set, "domains", reload),
    ),
  );
  if (!domains.length) {
    section.append(h("p", { class: "kb-muted" }, "No domains tracked for this client yet. Add one and use the lookup to fill its registration, name servers and DNS records."));
    return section;
  }
  const table = h("table", { class: "kb-table kb-record-table" });
  table.append(h("thead", null, h("tr", null, h("th", null, "Domain"), h("th", null, "Registrar"), h("th", null, "DNS"), h("th", null, "Expiry"), h("th", null, "Links"), h("th", null, ""))));
  const tbody = h("tbody", null);
  for (const d of domains) {
    const st = domainExpiryStatus(d);
    tbody.append(
      h(
        "tr",
        { class: "kb-record-row", dataset: { id: d.id, type: "domains" } },
        h("td", null, h("div", { class: "kb-record-name-row" }, h("span", { class: "kb-record-name" }, d.name), d.autoRenew ? h("span", { class: "kb-badge kb-badge-required" }, "Auto-renew") : null)),
        h("td", null, d.registrar || "—"),
        h("td", null, String((d.dnsRecords || []).length) + " record" + ((d.dnsRecords || []).length === 1 ? "" : "s")),
        h("td", null, expiryBadge(st)),
        h("td", null, String(linkCount(set, d))),
        h(
          "td",
          { class: "kb-record-actions" },
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openDomainEditor(ctx, { setId: set.id, record: d, reload }) }, "Open"),
          readonly ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => removeTracked(ctx, set, d, "domains", reload) }, "Remove"),
        ),
      ),
    );
  }
  table.append(tbody);
  section.append(table);
  return section;
}

function certSection(ctx, set, reload, readonly) {
  const certs = set.records.certificates || [];
  const section = h(
    "section",
    { class: "kb-card kb-record-section", dataset: { type: "certificates" } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.lock }),
      h("h2", { class: "kb-section-name" }, "SSL certificates"),
      h("span", { class: "kb-count-pill" }, String(certs.length)),
      readonly ? null : addButton(ctx, set, "certificates", reload),
    ),
  );
  if (!certs.length) {
    section.append(h("p", { class: "kb-muted" }, "No certificates tracked for this client yet. Add one and use the lookup to read its issuer, SANs and validity window from the transparency logs."));
    return section;
  }
  const table = h("table", { class: "kb-table kb-record-table" });
  table.append(h("thead", null, h("tr", null, h("th", null, "Host"), h("th", null, "Issuer"), h("th", null, "Validity"), h("th", null, "Expiry"), h("th", null, "Links"), h("th", null, ""))));
  const tbody = h("tbody", null);
  for (const c of certs) {
    const st = certificateExpiryStatus(c);
    const host = c.name + (c.port ? ":" + c.port : "");
    tbody.append(
      h(
        "tr",
        { class: "kb-record-row", dataset: { id: c.id, type: "certificates" } },
        h("td", null, h("div", { class: "kb-record-name-row" }, h("span", { class: "kb-record-name" }, host), c.wildcard ? h("span", { class: "kb-badge kb-badge-model" }, "Wildcard") : null)),
        h("td", null, c.issuer || "—"),
        h("td", { class: "kb-record-details" }, (c.validFrom || "?") + " → " + (c.validTo || "?")),
        h("td", null, expiryBadge(st)),
        h("td", null, String(linkCount(set, c))),
        h(
          "td",
          { class: "kb-record-actions" },
          h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openCertificateEditor(ctx, { setId: set.id, record: c, reload }) }, "Open"),
          readonly ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => removeTracked(ctx, set, c, "certificates", reload) }, "Remove"),
        ),
      ),
    );
  }
  table.append(tbody);
  section.append(table);
  return section;
}

function addButton(ctx, set, type, reload) {
  const label = type === "domains" ? "+ Domain" : "+ Certificate";
  return h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => newTracked(ctx, set, type, reload) }, label);
}

function linkCount(set, rec) {
  return (set.records.relationships || []).filter((r) => (r.from.id === rec.id && r.from.type === rec.type) || (r.to.id === rec.id && r.to.type === rec.type)).length;
}

async function removeTracked(ctx, set, record, type, reload) {
  const ok = await confirmDialog({
    title: "Remove “" + record.name + "”?",
    message: "The record and its links are removed from this set. The set's version advances, so the removal can itself be recovered from history.",
    confirmLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.docs.removeRecord(set.id, { type, id: record.id }, { updatedBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Removed “" + record.name + "”", "success");
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

// A classification-aware "new tracked record" dialog. Domain and certificate
// records still carry the information model + provenance every record needs.
function newTracked(ctx, set, type, reload) {
  const isDomain = type === "domains";
  const nameInput = h("input", { class: "kb-input", type: "text", placeholder: isDomain ? "e.g. example.com" : "e.g. www.example.com", id: "kbNewTrackerName" });
  const modelSel = h("select", { class: "kb-input" });
  for (const mm of INFORMATION_MODELS) modelSel.append(h("option", { value: mm.id }, mm.label));
  modelSel.value = "core-asset";
  const provSel = h("select", { class: "kb-input" });
  for (const p of PROVENANCE) provSel.append(h("option", { value: p.id }, p.label));
  provSel.value = "authored";
  const m = openModal({
    title: isDomain ? "New domain" : "New certificate",
    description: isDomain
      ? "Give the domain its registrable name (e.g. example.com). The editor then opens so you can record its registration and DNS, or look them up."
      : "Give the certificate its hostname (e.g. www.example.com). The editor then opens so you can record its details, or read them from the transparency logs.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, isDomain ? "Domain name" : "Hostname"), nameInput),
      h(
        "div",
        { class: "kb-field-row" },
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Information model"), modelSel),
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Provenance"), provSel),
      ),
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewTrackerSaveBtn" }, isDomain ? "Create domain" : "Create certificate"),
  );
  const create = async () => {
    m.clearError();
    const name = nameInput.value.trim();
    if (!name) {
      m.showError(isDomain ? "Give the domain a name." : "Give the certificate a hostname.");
      return;
    }
    try {
      const res = await ctx.docs.addRecord(set.id, { type, name, informationModel: modelSel.value, provenance: provSel.value, ...(isDomain ? { dnsRecords: [] } : {}) }, { updatedBy: whoami(ctx), actor: whoami(ctx) });
      m.close();
      ctx.toast("Created “" + res.record.name + "”", "success");
      reload();
      if (isDomain) openDomainEditor(ctx, { setId: set.id, record: res.record, reload });
      else openCertificateEditor(ctx, { setId: set.id, record: res.record, reload });
    } catch (e) {
      m.showError(String((e && e.message) || e) + (e && e.hint ? " " + e.hint : ""));
    }
  };
  m.actions.querySelector("#kbNewTrackerSaveBtn").addEventListener("click", create);
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") create();
  });
  nameInput.focus();
}
