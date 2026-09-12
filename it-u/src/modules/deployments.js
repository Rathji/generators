// src/modules/deployments.js — the Deployments station (roadmap tasks 37+).
//
// Deployments holds the DEPLOYMENT RUNBOOKS: the procedural counterpart of the
// structured service assets. A runbook captures the full build of a service —
// the platform/PBX configuration, the dial plan and trunks, the numbers and
// porting, emergency calling, codecs and QoS, the firewall/SBC path, failover,
// the handsets and the per-site network readiness checks, then the cutover,
// verification and rollback — written so a technician who did not design it can
// execute it, with the real values already filled in.
//
// The station lists the client documentation sets; opening one
// (`#/deployments/<id>`) shows that client's runbooks grouped by type, each
// opening the editor in runbook-view.js. For a VoIP deployment, the "Generate
// VoIP runbook" flow reads the set's Voice/PBX asset (task 36) and assembles a
// complete body in one step, flagging every gap it finds.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState, loadingState, errorState } from "../framework/states.js";
import { viewPanel, confirmDialog, relTime, openModal } from "./shared.js";
import { openRunbookEditor } from "./runbook-view.js";
import { openChecklistEditor } from "./checklist-view.js";
import { openDocumentEditor } from "./document-view.js";
import { INFORMATION_MODELS, PROVENANCE, provenanceDef } from "../framework/classification.js";
import { RUNBOOK_TYPES, RUNBOOK_STATUSES, runbookType, runbookStatus, runbookReviewStatus, generateVoipRunbook } from "../framework/runbook.js";
import { checklistProgress } from "../framework/checklist.js";
import {
  CUTOVER_PHASES,
  CUTOVER_CHECKS,
  generateVoipCutoverChecklist,
  isCutoverChecklist,
  cutoverAcceptanceLine,
  cutoverAcceptanceTone,
  voipCutoverCoverage,
} from "../framework/cutover.js";
import { VOICE_PBX_TYPE_ID, voicePlatformLabel } from "../framework/voice.js";
import { VOIP_COVERAGE_GROUPS, voipDeploymentCoverage } from "../framework/voipCoverage.js";
import { WAN_CIRCUIT_TYPE_ID, circuitSummaryLine, circuitProfile } from "../framework/circuit.js";
import {
  PROVISIONING_PHASES,
  CIRCUIT_PROVISIONING_SECTIONS,
  generateCircuitProvisioningRunbook,
  provisioningRecordCoverage,
  circuitProvisioningCoverage,
} from "../framework/circuitProvisioning.js";
import {
  circuitAddressingCoverage,
  circuitAddressingPlan,
  segmentationSummary,
  generateCircuitAddressingRecord,
} from "../framework/addressing.js";
import {
  billingProfile,
  usageReconciliation,
  clientBillingSummary,
  generateCircuitBillingRecord,
  generateClientBillingRecord,
} from "../framework/billing.js";
import {
  MIGRATION_SCENARIOS,
  migrationScenario,
  migrationImpact,
  migrationRecords,
  isMigrationChecklist,
  generateCircuitMigrationRunbook,
  generateCircuitMigrationChecklist,
} from "../framework/circuitMigration.js";

const DESC =
  "Deployment runbooks written for a technician who did not design the build — generated from the recorded service assets, then tracked through cutover.";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";
const typeIcon = (id) => icons[(runbookType(id) || {}).icon] || icons.rocket;

export default {
  id: "deployments",
  label: "Deployments",
  desc: DESC,
  icon: icons.rocket,
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
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewRunbookSetBtn", onClick: () => newSet(ctx) }, "New documentation set"),
  );
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Deployments", desc: DESC, actions, body }));
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
        icon: icons.rocket,
        title: "No deployments yet",
        description:
          "Deployment runbooks live inside a client's documentation set. Create a set, record the client's services as structured assets, then generate the runbook that stands each one up.",
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
  const counts = s.counts || {};
  const runbooks = counts.runbooks || 0;
  return h(
    "a",
    { class: "kb-docset-card", href: "#/deployments/" + s.id, dataset: { id: s.id } },
    h(
      "div",
      { class: "kb-docset-card-head" },
      h("span", { class: "kb-docset-avatar", html: icons.rocket }),
      h("div", { class: "kb-docset-card-id" }, h("h3", { class: "kb-docset-name" }, s.name), h("div", { class: "kb-docset-kind" }, countPhrase(s))),
    ),
    h("div", { class: "kb-docset-meta" }, runbooks + " runbook" + (runbooks === 1 ? "" : "s") + " · v" + s.version + " · " + relTime(s.updatedAt)),
  );
}

function countPhrase(s) {
  const c = s.counts || {};
  const others = (c.flexibleAssets || 0) + (c.configurations || 0) + (c.locations || 0);
  return others ? others + " linked record" + (others === 1 ? "" : "s") : "documentation set";
}

async function newSet(ctx) {
  const name = await promptName();
  if (!name) return;
  try {
    const set = await ctx.docs.create({ name, createdBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Created “" + set.name + "”", "success");
    ctx.go("#/deployments/" + set.id);
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
// detail view — this client's runbooks
// ---------------------------------------------------------------------------
function renderDetail(ctx, id) {
  const titleEl = h("h1", { class: "kb-view-title" }, "…");
  const crumbEl = h("div", { class: "kb-breadcrumb" }, "IT-U / Deployments");
  const actions = h("div", { class: "kb-actions-row" });
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading runbooks…" }));
  ctx.container.append(
    h(
      "div",
      { class: "kb-view" },
      h(
        "header",
        { class: "kb-view-head" },
        crumbEl,
        h("div", { class: "kb-view-title-row" }, titleEl, actions),
        h("p", { class: "kb-view-desc" }, "This client's deployment runbooks, grouped by type. Generate one from a recorded service asset, or write one by hand — then track it through cutover."),
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
        action: h("a", { class: "kb-btn kb-btn-ghost", href: "#/deployments" }, "Back to Deployments"),
      }),
    );
    return;
  }
  ui.titleEl.textContent = set.name;
  ui.crumbEl.replaceChildren(
    h("a", { class: "kb-bc-link", href: "#/deployments" }, "IT-U / Deployments"),
    h("span", { class: "kb-bc-current" }, " / " + set.name),
  );
  const reload = () => loadDetail(ctx, id, ui);
  const archived = !!set.archived;
  const voices = (set.records.flexibleAssets || []).filter((r) => r.assetTypeId === VOICE_PBX_TYPE_ID);
  const circuits = (set.records.flexibleAssets || []).filter((r) => r.assetTypeId === WAN_CIRCUIT_TYPE_ID);
  clear(ui.actions);
  ui.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => ctx.go("#/organizations/" + set.id) }, "Open full set"),
    archived
      ? null
      : voices.length
        ? h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbGenerateVoipBtn", onClick: () => generateVoipFlow(ctx, set, voices, reload) }, "+ Generate VoIP runbook")
        : null,
    archived
      ? null
      : voices.length
        ? h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbGenerateCutoverBtn", onClick: () => generateCutoverFlow(ctx, set, voices, reload) }, "+ Generate cutover checklist")
        : null,
    archived
      ? null
      : circuits.length
        ? h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbGenerateCircuitBtn", onClick: () => generateCircuitFlow(ctx, set, circuits, reload) }, "+ Generate circuit runbook")
        : null,
    archived
      ? null
      : circuits.length
        ? h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbGenerateAddressingBtn", onClick: () => generateAddressingFlow(ctx, set, circuits, reload) }, "+ Generate addressing record")
        : null,
    archived
      ? null
      : circuits.length
        ? h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbGenerateBillingBtn", onClick: () => generateBillingFlow(ctx, set, circuits, reload) }, "+ Generate billing record")
        : null,
    archived
      ? null
      : circuits.length
        ? h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbGenerateMigrationBtn", onClick: () => generateMigrationFlow(ctx, set, circuits, reload, "runbook") }, "+ Generate migration runbook")
        : null,
    archived
      ? null
      : circuits.length
        ? h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbGenerateMigrationChecklistBtn", onClick: () => generateMigrationFlow(ctx, set, circuits, reload, "checklist") }, "+ Generate migration checklist")
        : null,
    archived ? null : h("button", { class: "kb-btn " + (voices.length || circuits.length ? "kb-btn-ghost" : "kb-btn-primary"), type: "button", id: "kbNewRunbookBtn", onClick: () => newRunbook(ctx, set, reload) }, "+ New runbook"),
    archived ? null : h("button", { class: "kb-btn kb-btn-ghost", type: "button", id: "kbNewChecklistBtn", onClick: () => newChecklist(ctx, set, reload) }, "+ New checklist"),
  );
  clear(ui.body);
  ui.body.append(...renderRunbooks(ctx, set, reload, { archived }), ...renderChecklists(ctx, set, reload, { archived }), ...renderVoipCoverage(ctx, set), ...renderCircuitCoverage(ctx, set), ...renderAddressingCoverage(ctx, set), ...renderBillingCoverage(ctx, set), ...renderMigrationCoverage(ctx, set));
}

function renderRunbooks(ctx, set, reload, opts = {}) {
  const readonly = !!opts.archived;
  const all = set.records.runbooks || [];
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
  if (!all.length) {
    out.push(
      emptyState({
        icon: icons.rocket,
        title: "No runbooks in this set",
        description:
          "Generate a VoIP deployment runbook from the client's Voice/PBX asset, or write the ordered build of any service by hand.",
        action: readonly ? null : h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => newRunbook(ctx, set, reload) }, "+ New runbook"),
      }),
    );
    return out;
  }
  for (const type of RUNBOOK_TYPES) {
    const runbooks = all.filter((r) => r.runbookType === type.id);
    if (!runbooks.length) continue;
    out.push(runbookGroup(ctx, set, runbooks, type, reload, readonly));
  }
  const orphans = all.filter((r) => !runbookType(r.runbookType));
  if (orphans.length) out.push(runbookGroup(ctx, set, orphans, { id: "unknown", label: "Untyped", icon: "rocket" }, reload, readonly));
  return out;
}

function runbookGroup(ctx, set, runbooks, type, reload, readonly) {
  const table = h("table", { class: "kb-table kb-record-table" });
  table.append(
    h(
      "thead",
      null,
      h("tr", null, h("th", null, "Runbook"), h("th", null, "Type"), h("th", null, "Status"), h("th", null, "Details"), h("th", null, "Review"), h("th", null, "")),
    ),
  );
  const tbody = h("tbody", null);
  for (const r of runbooks) tbody.append(runbookRow(ctx, set, r, reload, readonly));
  table.append(tbody);
  return h(
    "section",
    { class: "kb-card kb-record-section", dataset: { group: type.id } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: typeIcon(type.id) }),
      h("h2", { class: "kb-section-name" }, type.label),
      h("span", { class: "kb-count-pill" }, String(runbooks.length)),
    ),
    table,
  );
}

function runbookRow(ctx, set, r, reload, readonly) {
  const status = runbookStatus(r.status);
  const review = runbookReviewStatus(r);
  const nameRow = h(
    "div",
    { class: "kb-record-name-row" },
    h("span", { class: "kb-record-name" }, r.name),
    h("span", { class: "kb-badge kb-badge-model" }, "v" + (Number(r.revision) || 1)),
    r.version ? h("span", { class: "kb-badge kb-badge-custom" }, String(r.version)) : null,
  );
  return h(
    "tr",
    { class: "kb-record-row", dataset: { id: r.id, type: "runbooks", runbookType: r.runbookType } },
    h("td", null, nameRow, r.summary ? h("span", { class: "kb-record-sub" }, r.summary) : null),
    h("td", null, runbookType(r.runbookType) ? runbookType(r.runbookType).label : "Untyped"),
    h("td", null, h("span", { class: "kb-runbook-status kb-runbook-status--" + (r.status || "draft") }, status ? status.label : "Draft")),
    h("td", { class: "kb-record-details" }, detailLine(r)),
    h("td", null, reviewChip(review)),
    h(
      "td",
      { class: "kb-record-actions" },
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openRunbookEditor(ctx, { setId: set.id, record: r, reload }) }, "Open"),
      readonly
        ? null
        : h(
            "button",
            { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => removeRunbook(ctx, set, r, reload) },
            "Remove",
          ),
    ),
  );
}

function detailLine(r) {
  const words = String(r.body || "").trim().split(/\s+/).filter(Boolean).length;
  const type = runbookType(r.runbookType);
  return [type ? type.label : "Runbook", words ? words + " word" + (words === 1 ? "" : "s") : null].filter(Boolean).join(" · ");
}

function reviewChip(review) {
  const tone = review.state === "overdue" ? "danger" : review.state === "due-soon" ? "warn" : review.state === "due" ? "info" : "muted";
  return h("span", { class: "kb-doc-review kb-doc-review--" + tone, title: review.dueAt ? "Next review " + review.dueAt : "" }, review.label);
}

async function removeRunbook(ctx, set, record, reload) {
  const ok = await confirmDialog({
    title: "Remove “" + record.name + "”?",
    message: "The runbook and its revision history are removed from this set. The set's version advances, so the removal can itself be recovered from history.",
    confirmLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.docs.removeRecord(set.id, { type: "runbooks", id: record.id }, { updatedBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Removed “" + record.name + "”", "success");
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

// ---------------------------------------------------------------------------
// generate-VoIP flow — read the Voice/PBX asset and assemble the runbook
// ---------------------------------------------------------------------------
function generateVoipFlow(ctx, set, voices, reload) {
  const voiceSel = h("select", { class: "kb-input", id: "kbVoipVoiceSel" });
  for (const v of voices) {
    const platform = voicePlatformLabel(v.assetFields && v.assetFields.platformType);
    voiceSel.append(h("option", { value: v.id }, v.name + (platform ? "  —  " + platform : "")));
  }
  const sites = (set.records.locations || []).filter((l) => l.type === "locations");
  const siteSel = h("select", { class: "kb-input" });
  siteSel.append(h("option", { value: "" }, "— none —"));
  for (const l of sites) siteSel.append(h("option", { value: l.id }, l.name));
  const titleInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. VoIP deployment — Acme (Head Office)" });
  const preparedInput = h("input", { class: "kb-input", type: "text", placeholder: "Your name" });
  preparedInput.value = whoami(ctx);

  const preview = h("p", { class: "kb-field-help" }, "");
  const syncPreview = () => {
    const v = voices.find((x) => x.id === voiceSel.value);
    if (!v) { preview.textContent = ""; return; }
    const gen = generateVoipRunbook({ voice: v, set, site: null, preparedBy: preparedInput.value.trim(), title: titleInput.value.trim() || undefined });
    preview.textContent = "Will assemble a " + gen.sections.filter((s) => s.required).length + "-section runbook" + (gen.warnings.length ? " and flag " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " to fill in" : "") + ".";
  };
  voiceSel.addEventListener("change", syncPreview);
  preparedInput.addEventListener("input", syncPreview);
  syncPreview();

  const m = openModal({
    title: "Generate VoIP runbook",
    description:
      "IT-U reads the selected Voice/PBX asset and its linked records and assembles the full deployment build — platform, dial plan, trunks, numbers, E911, codecs, firewall, failover, handsets, network readiness and cutover. Gaps are marked TO COMPLETE.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Voice/PBX asset"), voiceSel),
      h("div", { class: "kb-field-row" }, h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Title (optional)"), titleInput), h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Site"), siteSel)),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Prepared by"), preparedInput),
      preview,
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbVoipGenerateBtn" }, "Generate runbook"),
  );
  m.actions.querySelector("#kbVoipGenerateBtn").addEventListener("click", async () => {
    m.clearError();
    const voice = voices.find((x) => x.id === voiceSel.value);
    if (!voice) {
      m.showError("Pick a Voice/PBX asset to generate from.");
      return;
    }
    const site = siteSel.value ? (set.records.locations || []).find((l) => l.id === siteSel.value) : null;
    const preparedBy = preparedInput.value.trim();
    try {
      const gen = generateVoipRunbook({ voice, set, site, preparedBy, title: titleInput.value.trim() || undefined });
      const res = await ctx.docs.addRunbook(
        set.id,
        {
          name: gen.name,
          runbookType: gen.runbookType,
          status: "draft",
          version: "1.0",
          summary: gen.summary,
          body: gen.body,
          service: gen.service,
          site: gen.site,
          tags: ["voip", "deployment"],
          informationModel: "document",
          provenance: "authored",
          origin: { source: "voice-asset", voiceId: voice.id, warnings: gen.warnings, generatedAt: gen.generatedAt },
        },
        { updatedBy: whoami(ctx), actor: whoami(ctx) },
      );
      m.close();
      ctx.toast("Generated “" + res.record.name + "” — " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " flagged", "success", 5200);
      reload();
      openRunbookEditor(ctx, { setId: set.id, record: res.record, reload });
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
}

// ---------------------------------------------------------------------------
// migration & decommission readiness (task 44) — the change half of a resold
// circuit. Per circuit: the dependent services a change would touch, the records
// that must be updated or archived, and which migration/decommission runbooks
// and checklists exist, plus the flows that generate them.
// ---------------------------------------------------------------------------
function linkedMigrations(set, circuit) {
  const linkedTo = (r) => (r.service && r.service.id === circuit.id) || (r.origin && r.origin.circuitId === circuit.id);
  return {
    runbooks: (set.records.runbooks || []).filter((r) => r.runbookType === "circuit-migration" && linkedTo(r)),
    checklists: (set.records.checklists || []).filter((c) => isMigrationChecklist(c) && linkedTo(c)),
  };
}

function renderMigrationCoverage(ctx, set) {
  const circuits = (set.records.flexibleAssets || []).filter((r) => r.assetTypeId === WAN_CIRCUIT_TYPE_ID);
  if (!circuits.length) return [];
  return circuits.map((c) => migrationReadinessCard(c, set));
}

function migrationReadinessCard(circuit, set) {
  const impact = migrationImpact(circuit, set, "carrier-change");
  const { runbooks, checklists } = linkedMigrations(set, circuit);
  const parts = [
    { id: "dependents", label: "Dependents mapped", present: impact.dependents.length > 0, required: true },
    { id: "records", label: "Records to update", present: impact.recordsToUpdate.length > 0, required: false },
    { id: "runbook", label: "Migration runbook", present: runbooks.length > 0, required: false },
    { id: "checklist", label: "Migration checklist", present: checklists.length > 0, required: false },
    { id: "decommission", label: "Decommission plan", present: runbooks.some((r) => r.scenario === "decommission"), required: false },
  ];
  const requiredMet = parts.filter((p) => p.required && p.present).length;
  const requiredTotal = parts.filter((p) => p.required).length;
  const card = h(
    "section",
    { class: "kb-card kb-record-section", dataset: { group: "circuit-migration", id: circuit.id } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.link }),
      h("h2", { class: "kb-section-name" }, "Migration & decommission readiness"),
      h("span", { class: "kb-muted" }, circuit.name),
      h("span", { class: "kb-badge " + (requiredMet === requiredTotal ? "kb-badge-ok" : "kb-badge-custom") }, requiredMet + "/" + requiredTotal + " required"),
    ),
  );
  const chips = h("div", { class: "kb-voip-coverage-chips" });
  for (const p of parts) {
    const title = p.present ? p.label + " recorded" : (p.required ? "Required: " : "Recommended: ") + "record the " + p.label.toLowerCase();
    chips.append(h("span", { class: "kb-voip-cov" + (p.present ? " kb-voip-cov--on" : p.required ? " kb-voip-cov--missing" : " kb-voip-cov--optional"), title }, h("span", { class: "kb-icon", html: p.present ? icons.check : icons.alert }), p.label));
  }
  card.append(h("div", { class: "kb-voip-coverage-group" }, h("span", { class: "kb-field-label" }, "Change readiness"), chips));

  const lines = [];
  lines.push(["Dependent services", impact.dependents.length ? impact.dependents.map((d) => d.record.name).join(", ") : ""]);
  if (impact.contract.end) lines.push(["Contract", impact.contract.end + (impact.contract.daysLeft != null ? " (" + impact.contract.daysLeft + " days)" : "") + (impact.contract.expiringSoon ? " · expiring" : "")]);
  if (impact.recordsToUpdate.length) lines.push(["Records to update", impact.recordsToUpdate.map((r) => r.label).join(", ")]);
  if (impact.recordsToArchive.length) lines.push(["Records to archive", impact.recordsToArchive.map((r) => r.label).join(", ")]);
  if (impact.addressChange) lines.push(["Address-sensitive", "a renumber would move every published service"]);
  if (runbooks.length) lines.push(["Runbooks", runbooks.map((r) => migrationScenario(r.scenario) ? migrationScenario(r.scenario).label : "migration").join(", ")]);
  if (checklists.length) lines.push(["Checklists", checklists.map((c) => c.name).join(", ")]);
  if (!impact.dependents.length) {
    card.append(h("p", { class: "kb-muted kb-record-empty" }, "No dependent services are linked yet — link the LANs, voice platform, remote access, domains and contacts that run over this circuit so a change can be assessed."));
  } else {
    const box = h("div", { class: "kb-addr-summary" });
    for (const [label, value] of lines) box.append(h("div", { class: "kb-addr-line" }, h("span", { class: "kb-field-label" }, label), h("span", null, value)));
    card.append(box);
  }
  const warnings = impact.warnings.filter((w) => w.level === "warning");
  if (warnings.length) {
    const findings = h("div", { class: "kb-billing-findings" });
    for (const w of warnings) findings.append(h("div", { class: "kb-billing-finding" }, h("span", { class: "kb-icon", html: icons.alert }), h("span", null, w.message)));
    card.append(findings);
  }
  return card;
}

// ---------------------------------------------------------------------------
// generate-migration flow — pick a circuit and a scenario, then generate the
// migration/decommission RUNBOOK (a circuit-migration runbook) or the CUTOVER
// CHECKLIST (with rollback, verification and acceptance), task 44.
// ---------------------------------------------------------------------------
function generateMigrationFlow(ctx, set, circuits, reload, kind) {
  const isChecklist = kind === "checklist";
  const verb = isChecklist ? "checklist" : "runbook";
  const circuitSel = h("select", { class: "kb-input", id: "kbMigrationCircuitSel" });
  for (const c of circuits) {
    const p = circuitProfile(c);
    circuitSel.append(h("option", { value: c.id }, c.name + (p.accessLabel ? "  —  " + p.accessLabel : "")));
  }
  const scenarioSel = h("select", { class: "kb-input", id: "kbMigrationScenarioSel" });
  for (const sc of MIGRATION_SCENARIOS) scenarioSel.append(h("option", { value: sc.id }, sc.label));
  const titleInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Migration — Aurora 500 (Carrier change)" });
  const preview = h("p", { class: "kb-field-help" }, "");
  const syncPreview = () => {
    const circuit = circuits.find((x) => x.id === circuitSel.value);
    const sc = migrationScenario(scenarioSel.value);
    if (!circuit || !sc) { preview.textContent = ""; return; }
    const impact = migrationImpact(circuit, set, sc.id);
    const gen = isChecklist
      ? generateCircuitMigrationChecklist({ circuit, set, scenario: sc.id, title: titleInput.value.trim() || undefined })
      : generateCircuitMigrationRunbook({ circuit, set, scenario: sc.id, title: titleInput.value.trim() || undefined });
    const extra = isChecklist
      ? gen.coverage.present + "/" + gen.coverage.total + " verifications"
      : gen.body.split("\n").filter((l) => l.startsWith("## ")).length + " sections";
    preview.textContent = sc.label + " · " + impact.affected + " dependent service(s) · " + extra + (gen.warnings.length ? " — " + gen.warnings.length + " gap(s) to fill in" : " — no gaps found") + ".";
  };
  circuitSel.addEventListener("change", syncPreview);
  scenarioSel.addEventListener("change", syncPreview);
  titleInput.addEventListener("input", syncPreview);
  syncPreview();

  const m = openModal({
    title: "Generate migration " + verb,
    description:
      "IT-U reads the selected resold circuit and assembles a " +
      (isChecklist
        ? "cutover checklist for the chosen change — the impact assessment, preparation and rollback, the cutover, verification of every dependent service, the records to update or archive and the client's acceptance."
        : "change runbook for the chosen scenario — the impact assessment on every dependent service, the preparation and rollback plan, the cutover, verification, and the records that must be updated or archived when the circuit changes or ends."),
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Internet/WAN circuit"), circuitSel),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Change scenario"), scenarioSel),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Title (optional)"), titleInput),
      preview,
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbMigrationGenerateBtn" }, "Generate " + verb),
  );
  m.actions.querySelector("#kbMigrationGenerateBtn").addEventListener("click", async () => {
    m.clearError();
    const circuit = circuits.find((x) => x.id === circuitSel.value);
    const scenario = migrationScenario(scenarioSel.value);
    if (!circuit || !scenario) {
      m.showError("Pick a circuit and a change scenario to generate from.");
      return;
    }
    try {
      const title = titleInput.value.trim() || undefined;
      if (isChecklist) {
        const gen = generateCircuitMigrationChecklist({ circuit, set, scenario: scenario.id, title, preparedBy: whoami(ctx) });
        const res = await ctx.docs.addChecklist(
          set.id,
          {
            name: gen.name,
            description: gen.description,
            defaultAssignee: gen.defaultAssignee,
            phases: gen.phases,
            items: gen.items,
            signOff: gen.signOff,
            service: gen.service,
            scenario: gen.scenario,
            informationModel: "document",
            provenance: "authored",
            origin: { source: "circuit-asset", circuitId: circuit.id, scenario: scenario.id, warnings: gen.warnings, generatedAt: gen.generatedAt },
          },
          { updatedBy: whoami(ctx), actor: whoami(ctx) },
        );
        m.close();
        ctx.toast("Generated “" + res.record.name + "” — " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " flagged", "success", 5200);
        reload();
        openChecklistEditor(ctx, set, res.record, reload);
      } else {
        const gen = generateCircuitMigrationRunbook({ circuit, set, scenario: scenario.id, title, preparedBy: whoami(ctx) });
        const res = await ctx.docs.addRunbook(
          set.id,
          {
            name: gen.name,
            runbookType: gen.runbookType,
            status: "draft",
            version: "1.0",
            summary: gen.summary,
            body: gen.body,
            service: gen.service,
            scenario: gen.scenario,
            tags: ["circuit", "migration", scenario.id],
            informationModel: "document",
            provenance: "authored",
            origin: { source: "circuit-asset", circuitId: circuit.id, scenario: scenario.id, warnings: gen.warnings, generatedAt: gen.generatedAt },
          },
          { updatedBy: whoami(ctx), actor: whoami(ctx) },
        );
        m.close();
        ctx.toast("Generated “" + res.record.name + "” — " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " flagged", "success", 5200);
        reload();
        openRunbookEditor(ctx, { setId: set.id, record: res.record, reload });
      }
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
}

// ---------------------------------------------------------------------------
// billing & usage coverage (task 43) — the reseller commercial model. Shows,
// per circuit, cost vs sell and margin, the billing cycle/proration, the data
// cap and overage treatment, the latest usage and every reconciliation finding
// (over cap, cost drift, stale readings) — then the client-level rollup.
// ---------------------------------------------------------------------------
const moneyLine = (amount, currency) =>
  amount == null ? "—" : amount.toLocaleString(undefined, { maximumFractionDigits: 2 }) + " " + (currency || "");

function renderBillingCoverage(ctx, set) {
  const circuits = (set.records.flexibleAssets || []).filter((r) => r.assetTypeId === WAN_CIRCUIT_TYPE_ID);
  if (!circuits.length) return [];
  const out = [clientBillingCard(clientBillingSummary(set))];
  for (const c of circuits) out.push(billingCoverageCard(c));
  return out;
}

function billingTile(label, value, tone) {
  return h(
    "div",
    { class: "kb-billing-tile" + (tone ? " kb-billing-tile--" + tone : "") },
    h("span", { class: "kb-billing-tile-value" }, value),
    h("span", { class: "kb-billing-tile-label" }, label),
  );
}

function clientBillingCard(summary) {
  const card = h(
    "section",
    { class: "kb-card kb-record-section", dataset: { group: "client-billing" } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.reports }),
      h("h2", { class: "kb-section-name" }, "Reseller billing & usage"),
      h("span", { class: "kb-muted" }, summary.count + " circuit" + (summary.count === 1 ? "" : "s")),
      h("span", { class: "kb-badge " + (summary.flagCount ? "kb-badge-custom" : "kb-badge-ok") }, summary.flagCount ? summary.flagCount + " finding" + (summary.flagCount === 1 ? "" : "s") : "Within plan"),
    ),
  );
  const tiles = h("div", { class: "kb-billing-tiles" });
  tiles.append(
    billingTile("Monthly cost", moneyLine(summary.monthlyCost, summary.currency)),
    billingTile("Monthly sell", moneyLine(summary.monthlySell, summary.currency)),
    billingTile("Monthly margin", moneyLine(summary.monthlyMargin, summary.currency) + (summary.monthlyMarginPct != null ? " · " + summary.monthlyMarginPct + "%" : ""), summary.monthlyMargin < 0 ? "danger" : "ok"),
    billingTile("Annual margin", moneyLine(summary.annualMargin, summary.currency)),
  );
  card.append(tiles);
  const lines = [];
  lines.push(["Circuits", summary.count + " (" + summary.cappedCount + " capped, " + summary.overCapCount + " over cap)"]);
  if (summary.overageEstimate) lines.push(["Estimated overage", moneyLine(summary.overageEstimate, summary.currency)]);
  if (summary.byCycle.length) lines.push(["Billing cycles", summary.byCycle.map((c) => c.label + " ×" + c.count).join(", ")]);
  const watch = [summary.driftCount ? summary.driftCount + " with cost drift" : "", summary.staleCount ? summary.staleCount + " with stale readings" : ""].filter(Boolean);
  if (watch.length) lines.push(["Watch", watch.join(", ")]);
  const box = h("div", { class: "kb-addr-summary" });
  for (const [label, value] of lines) box.append(h("div", { class: "kb-addr-line" }, h("span", { class: "kb-field-label" }, label), h("span", null, value)));
  card.append(box);
  return card;
}

function billingCoverageCard(circuit) {
  const recon = usageReconciliation(circuit);
  const profile = recon.profile;
  const pricing = profile.pricing;
  const parts = [
    { id: "pricing", label: "Cost & sell price", present: pricing.hasPricing, required: true },
    { id: "cycle", label: "Billing cycle", present: !!profile.cycle, required: true },
    { id: "proration", label: "Proration", present: !!profile.proration, required: false },
    { id: "monitoring", label: "Usage monitoring", present: !!profile.usageMonitoring, required: false },
    { id: "cap", label: "Data cap", present: profile.hasCap, required: false },
    { id: "overage", label: "Overage treatment", present: !!profile.overage, required: false },
  ];
  const requiredMet = parts.filter((p) => p.required && p.present).length;
  const requiredTotal = parts.filter((p) => p.required).length;
  const warningCount = recon.flags.filter((f) => f.level === "warning").length;
  const card = h(
    "section",
    { class: "kb-card kb-record-section", dataset: { group: "circuit-billing", id: circuit.id } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.reports }),
      h("h2", { class: "kb-section-name" }, "Commercial & usage reconciliation"),
      h("span", { class: "kb-muted" }, circuit.name),
      h("span", { class: "kb-badge " + (recon.ok ? "kb-badge-ok" : "kb-badge-custom") }, recon.ok ? "Balanced" : warningCount + " finding" + (warningCount === 1 ? "" : "s")),
    ),
  );
  const chips = h("div", { class: "kb-voip-coverage-chips" });
  for (const p of parts) {
    const title = p.present ? p.label + " recorded" : (p.required ? "Required: " : "Recommended: ") + "record the " + p.label.toLowerCase();
    chips.append(h("span", { class: "kb-voip-cov" + (p.present ? " kb-voip-cov--on" : p.required ? " kb-voip-cov--missing" : " kb-voip-cov--optional"), title }, h("span", { class: "kb-icon", html: p.present ? icons.check : icons.alert }), p.label));
  }
  card.append(h("div", { class: "kb-voip-coverage-group" }, h("span", { class: "kb-field-label" }, "Commercial model · " + requiredMet + "/" + requiredTotal + " required"), chips));

  const lines = [];
  if (pricing.hasPricing) lines.push(["Cost / sell", moneyLine(pricing.cost, profile.currency) + " → " + moneyLine(pricing.sell, profile.currency)]);
  if (pricing.margin != null) lines.push(["Margin", moneyLine(pricing.margin, profile.currency) + (pricing.marginPct != null ? " (" + pricing.marginPct + "%)" : "")]);
  if (profile.annualMargin != null) lines.push(["Annual margin", moneyLine(profile.annualMargin, profile.currency)]);
  if (profile.cycle) lines.push(["Billing", profile.cycleLabel + (profile.billingDay != null ? " · day " + profile.billingDay : "") + (profile.prorationLabel ? " · " + profile.prorationLabel : "")]);
  if (profile.hasCap) lines.push(["Data cap", profile.cap + " GB/" + (profile.capPeriodLabel || "period").toLowerCase() + (profile.overageLabel ? " · overage: " + profile.overageLabel : "")]);
  if (recon.latestUsageGb != null) lines.push(["Latest usage", recon.latestUsageGb + " GB" + (recon.utilisationPct != null ? " (" + recon.utilisationPct + "% of cap)" : "") + (recon.overageEstimate ? " · est. overage " + moneyLine(recon.overageEstimate, profile.currency) : "")]);
  if (profile.usageMonitoring) lines.push(["Usage source", profile.usageMonitoring]);
  if (!lines.length) {
    card.append(h("p", { class: "kb-muted kb-record-empty" }, "No commercial terms recorded yet — add cost/sell pricing, a billing cycle and any data cap to reconcile the circuit against its sold plan."));
  } else {
    const box = h("div", { class: "kb-addr-summary" });
    for (const [label, value] of lines) box.append(h("div", { class: "kb-addr-line" }, h("span", { class: "kb-field-label" }, label), h("span", null, value)));
    card.append(box);
  }
  const warnings = recon.flags.filter((f) => f.level === "warning");
  if (warnings.length) {
    const findings = h("div", { class: "kb-billing-findings" });
    for (const f of warnings) findings.append(h("div", { class: "kb-billing-finding" }, h("span", { class: "kb-icon", html: icons.alert }), h("span", null, f.message)));
    card.append(findings);
  }
  return card;
}

// ---------------------------------------------------------------------------
// generate-billing flow — read one circuit (or the whole client) and assemble
// a client-technical record of the commercial model, billing cycle, data cap
// and usage reconciliation (task 43).
// ---------------------------------------------------------------------------
function generateBillingFlow(ctx, set, circuits, reload) {
  const scopeSel = h("select", { class: "kb-input", id: "kbBillingSel" });
  scopeSel.append(h("option", { value: "__client__" }, "Client summary — all circuits"));
  for (const c of circuits) scopeSel.append(h("option", { value: c.id }, c.name));
  const titleInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Billing & usage — Aurora" });
  const preview = h("p", { class: "kb-field-help" }, "");
  const syncPreview = () => {
    const title = titleInput.value.trim() || undefined;
    if (scopeSel.value === "__client__") {
      const gen = generateClientBillingRecord({ set, title });
      preview.textContent = "Client summary across " + clientBillingSummary(set).count + " circuit(s) — " + gen.warnings.length + " finding(s) flagged.";
      return;
    }
    const c = circuits.find((x) => x.id === scopeSel.value);
    if (!c) { preview.textContent = ""; return; }
    const gen = generateCircuitBillingRecord({ circuit: c, set, title });
    preview.textContent = "Will document " + gen.body.split("\n").filter((l) => l.startsWith("## ")).length + " sections" + (gen.warnings.length ? ", flagging " + gen.warnings.length + " gap(s) to fill in" : " — no gaps found") + ".";
  };
  scopeSel.addEventListener("change", syncPreview);
  titleInput.addEventListener("input", syncPreview);
  syncPreview();

  const m = openModal({
    title: "Generate billing & usage record",
    description:
      "IT-U reads a resold circuit — or rolls up every circuit for the client — and assembles a client-technical record of the wholesale cost versus sell price and margin, the billing cycle and proration, the data cap and overage treatment, the usage-monitoring sources and the reconciliation against the sold plan.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Scope"), scopeSel),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Title (optional)"), titleInput),
      preview,
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbBillingGenerateBtn" }, "Generate record"),
  );
  m.actions.querySelector("#kbBillingGenerateBtn").addEventListener("click", async () => {
    m.clearError();
    const isClient = scopeSel.value === "__client__";
    const circuit = circuits.find((x) => x.id === scopeSel.value);
    if (!isClient && !circuit) {
      m.showError("Pick a circuit or the client summary to generate from.");
      return;
    }
    try {
      const title = titleInput.value.trim() || undefined;
      const gen = isClient ? generateClientBillingRecord({ set, title }) : generateCircuitBillingRecord({ circuit, set, title });
      const origin = isClient
        ? { source: "docset", warnings: gen.warnings, generatedAt: gen.generatedAt }
        : { source: "circuit-asset", circuitId: circuit.id, warnings: gen.warnings, generatedAt: gen.generatedAt };
      const res = await ctx.docs.addDocument(
        set.id,
        {
          name: gen.name,
          docType: gen.docType,
          summary: gen.summary,
          body: gen.body,
          tags: ["circuit", "billing", "usage", "reseller"],
          informationModel: "document",
          provenance: "authored",
          origin,
        },
        { updatedBy: whoami(ctx), actor: whoami(ctx) },
      );
      m.close();
      ctx.toast("Generated “" + res.record.name + "” — " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " flagged", "success", 5200);
      reload();
      openDocumentEditor(ctx, { setId: set.id, record: res.record, reload });
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
}

// ---------------------------------------------------------------------------
// new-runbook dialog (by hand)
// ---------------------------------------------------------------------------
function newRunbook(ctx, set, reload) {
  const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Warehouse switch stack cutover" });
  const typeSel = h("select", { class: "kb-input" });
  for (const t of RUNBOOK_TYPES) typeSel.append(h("option", { value: t.id }, t.label));
  typeSel.value = "service-deployment";
  const summaryInput = h("input", { class: "kb-input", type: "text", placeholder: "One line saying what this runbook deploys" });
  const modelSel = h("select", { class: "kb-input" });
  for (const mm of INFORMATION_MODELS) modelSel.append(h("option", { value: mm.id }, mm.label));
  modelSel.value = "document";
  const provSel = h("select", { class: "kb-input" });
  for (const p of PROVENANCE) provSel.append(h("option", { value: p.id }, p.label));
  provSel.value = "authored";
  const originRow = h("div", { class: "kb-field-row" });
  const originBox = h("div", { class: "kb-origin-box", hidden: true });
  originBox.append(h("span", { class: "kb-field-label" }, "Origin"), originRow);
  function syncOrigin() {
    const p = provenanceDef(provSel.value);
    originRow.replaceChildren();
    const required = (p && p.requires) || [];
    originBox.hidden = required.length === 0;
    for (const f of required) {
      originRow.append(h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, p.requireLabel || f), h("input", { class: "kb-input", type: "text", placeholder: p.placeholder || "", dataset: { origin: f } })));
    }
  }
  provSel.addEventListener("change", syncOrigin);
  syncOrigin();

  const m = openModal({
    title: "New runbook",
    description: "Name the runbook and pick its type. IT-U starts the body, and the runbook's revisions are tracked independently.",
    children: [
      h("div", { class: "kb-field-row" }, h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Name"), nameInput), h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Runbook type"), typeSel)),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Summary"), summaryInput),
      h("div", { class: "kb-field-row" }, h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Information model"), modelSel), h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Provenance"), provSel)),
      originBox,
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewRunbookSaveBtn" }, "Create runbook"),
  );
  m.actions.querySelector("#kbNewRunbookSaveBtn").addEventListener("click", async () => {
    m.clearError();
    if (!nameInput.value.trim()) {
      m.showError("Give the runbook a name.");
      return;
    }
    const origin = {};
    for (const inp of originRow.querySelectorAll("[data-origin]")) origin[inp.dataset.origin] = inp.value.trim();
    const type = runbookType(typeSel.value);
    const input = {
      name: nameInput.value.trim(),
      runbookType: typeSel.value,
      summary: summaryInput.value.trim(),
      body: "# " + nameInput.value.trim() + "\n\n## Overview & scope\n\nWhat this runbook deploys.\n\n## Steps\n\n1. First step\n",
      informationModel: modelSel.value,
      provenance: provSel.value,
      origin,
    };
    try {
      const res = await ctx.docs.addRunbook(set.id, input, { updatedBy: whoami(ctx), actor: whoami(ctx) });
      m.close();
      ctx.toast("Created “" + res.record.name + "”", "success");
      reload();
      openRunbookEditor(ctx, { setId: set.id, record: res.record, reload });
    } catch (e) {
      m.showError(String((e && e.message) || e) + (e && e.hint ? " " + e.hint : ""));
    }
  });
  nameInput.focus();
}

// ---------------------------------------------------------------------------
// checklists — the generated cutover / deployment checklists in this set
// ---------------------------------------------------------------------------
function renderChecklists(ctx, set, reload, opts = {}) {
  const readonly = !!opts.archived;
  const all = set.records.checklists || [];
  const table = h("table", { class: "kb-table kb-record-table" });
  table.append(
    h(
      "thead",
      null,
      h("tr", null, h("th", null, "Checklist"), h("th", null, "Progress"), h("th", null, "Coverage"), h("th", null, "Acceptance"), h("th", null, "")),
    ),
  );
  const tbody = h("tbody", null);
  for (const c of all) tbody.append(checklistRow(ctx, set, c, reload, readonly));
  table.append(tbody);
  const section = h(
    "section",
    { class: "kb-card kb-record-section", dataset: { group: "checklists" } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.clipboard }),
      h("h2", { class: "kb-section-name" }, "Cutover & deployment checklists"),
      h("span", { class: "kb-count-pill" }, String(all.length)),
    ),
    all.length
      ? table
      : h("p", { class: "kb-muted kb-record-empty" }, "No checklists yet — generate a VoIP cutover checklist, or create one by hand."),
  );
  return [section];
}

function checklistRow(ctx, set, c, reload, readonly) {
  const p = checklistProgress(c);
  const isCut = isCutoverChecklist(c);
  const cov = isCut ? voipCutoverCoverage(c) : null;
  const progress = h(
    "div",
    { class: "kb-cutover-progress" },
    h("div", { class: "kb-progress" }, h("div", { class: "kb-progress-fill", style: { width: p.percent + "%" } })),
    h("span", { class: "kb-checklist-progress-text" }, p.total ? p.done + "/" + p.total : "no steps"),
  );
  return h(
    "tr",
    { class: "kb-record-row", dataset: { id: c.id, type: "checklists" } },
    h(
      "td",
      null,
      h("div", { class: "kb-record-name-row" }, h("span", { class: "kb-record-name" }, c.name), isCut ? h("span", { class: "kb-badge kb-badge-model" }, "Cutover") : null),
      c.description ? h("span", { class: "kb-record-sub" }, c.description) : null,
    ),
    h("td", null, progress),
    h(
      "td",
      null,
      cov
        ? h("span", { class: "kb-badge " + (cov.complete ? "kb-badge-ok" : "kb-badge-custom"), title: cov.complete ? "All required verifications present" : "Missing: " + cov.missing.join(", ") }, cov.present + "/" + cov.total)
        : h("span", { class: "kb-muted" }, "—"),
    ),
    h("td", null, h("span", { class: "kb-cutover-accept kb-cutover-accept--" + cutoverAcceptanceTone(c) }, cutoverAcceptanceLine(c))),
    h(
      "td",
      { class: "kb-record-actions" },
      h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => openChecklistEditor(ctx, set, c, reload) }, "Open"),
      readonly
        ? null
        : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text", type: "button", onClick: () => removeChecklist(ctx, set, c, reload) }, "Remove"),
    ),
  );
}

async function removeChecklist(ctx, set, record, reload) {
  const ok = await confirmDialog({
    title: "Remove “" + record.name + "”?",
    message: "The checklist and its step progress are removed from this set. The set's version advances, so the removal can itself be recovered from history.",
    confirmLabel: "Remove",
    danger: true,
  });
  if (!ok) return;
  try {
    await ctx.docs.removeRecord(set.id, { type: "checklists", id: record.id }, { updatedBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Removed “" + record.name + "”", "success");
    reload();
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

// ---------------------------------------------------------------------------
// generate-cutover flow — read the Voice/PBX asset and assemble the checklist
// ---------------------------------------------------------------------------
function generateCutoverFlow(ctx, set, voices, reload) {
  const voiceSel = h("select", { class: "kb-input", id: "kbCutoverVoiceSel" });
  for (const v of voices) {
    const platform = voicePlatformLabel(v.assetFields && v.assetFields.platformType);
    voiceSel.append(h("option", { value: v.id }, v.name + (platform ? "  —  " + platform : "")));
  }
  const sites = (set.records.locations || []).filter((l) => l.type === "locations");
  const siteSel = h("select", { class: "kb-input" });
  siteSel.append(h("option", { value: "" }, "— none —"));
  for (const l of sites) siteSel.append(h("option", { value: l.id }, l.name));
  const titleInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Acme cutover — Head Office" });
  const assigneeInput = h("input", { class: "kb-input", type: "text", placeholder: "Default assignee (optional)" });
  assigneeInput.value = whoami(ctx);

  const preview = h("p", { class: "kb-field-help" }, "");
  const syncPreview = () => {
    const v = voices.find((x) => x.id === voiceSel.value);
    if (!v) { preview.textContent = ""; return; }
    const site = siteSel.value ? sites.find((l) => l.id === siteSel.value) : null;
    const gen = generateVoipCutoverChecklist({ voice: v, set, site, assignee: assigneeInput.value.trim(), preparedBy: whoami(ctx), title: titleInput.value.trim() || undefined });
    preview.textContent =
      "Will build a " + gen.items.length + "-step checklist across " + CUTOVER_PHASES.length + " phases, covering " +
      gen.coverage.present + "/" + gen.coverage.total + " required verifications" +
      (gen.warnings.length ? " (" + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " flagged)" : "") + ".";
  };
  voiceSel.addEventListener("change", syncPreview);
  siteSel.addEventListener("change", syncPreview);
  assigneeInput.addEventListener("input", syncPreview);
  syncPreview();

  const m = openModal({
    title: "Generate VoIP cutover checklist",
    description:
      "IT-U assembles a pre-deployment, cutover and post-cutover checklist from the Voice/PBX asset — number port, test calls, voicemail, recording, failover, emergency calling, monitoring and rollback — ending with the client's recorded acceptance.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Voice/PBX asset"), voiceSel),
      h("div", { class: "kb-field-row" }, h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Title (optional)"), titleInput), h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Site"), siteSel)),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Default assignee"), assigneeInput),
      preview,
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbCutoverGenerateBtn" }, "Generate checklist"),
  );
  m.actions.querySelector("#kbCutoverGenerateBtn").addEventListener("click", async () => {
    m.clearError();
    const voice = voices.find((x) => x.id === voiceSel.value);
    if (!voice) {
      m.showError("Pick a Voice/PBX asset to generate from.");
      return;
    }
    const site = siteSel.value ? sites.find((l) => l.id === siteSel.value) : null;
    try {
      const gen = generateVoipCutoverChecklist({ voice, set, site, assignee: assigneeInput.value.trim(), preparedBy: whoami(ctx), title: titleInput.value.trim() || undefined });
      const res = await ctx.docs.addChecklist(
        set.id,
        {
          name: gen.name,
          description: gen.description,
          defaultAssignee: gen.defaultAssignee,
          phases: gen.phases,
          items: gen.items,
          signOff: gen.signOff,
          service: gen.service,
          site: gen.site,
          informationModel: "document",
          provenance: "authored",
          origin: { source: "voice-asset", voiceId: voice.id, warnings: gen.warnings, generatedAt: gen.generatedAt },
        },
        { updatedBy: whoami(ctx), actor: whoami(ctx) },
      );
      m.close();
      ctx.toast(
        "Generated “" + res.record.name + "” — " + gen.items.length + " steps" +
          (gen.warnings.length ? ", " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " flagged" : ""),
        "success",
        5200,
      );
      reload();
      openChecklistEditor(ctx, set, res.record, reload);
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
}

// ---------------------------------------------------------------------------
// new-checklist dialog (by hand)
// ---------------------------------------------------------------------------
function newChecklist(ctx, set, reload) {
  const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Warehouse switch stack cutover" });
  const descInput = h("input", { class: "kb-input", type: "text", placeholder: "What is this checklist for?" });
  const assigneeInput = h("input", { class: "kb-input", type: "text", placeholder: "Default assignee (optional)" });
  const m = openModal({
    title: "New checklist",
    description: "A plain checklist of ordered steps, with per-step completion, delegation and due dates. Add the steps once it is created.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Name"), nameInput),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Description"), descInput),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Default assignee"), assigneeInput),
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbNewChecklistSaveBtn" }, "Create checklist"),
  );
  m.actions.querySelector("#kbNewChecklistSaveBtn").addEventListener("click", async () => {
    m.clearError();
    if (!nameInput.value.trim()) {
      m.showError("Give the checklist a name.");
      return;
    }
    try {
      const res = await ctx.docs.addChecklist(
        set.id,
        {
          name: nameInput.value.trim(),
          description: descInput.value.trim(),
          defaultAssignee: assigneeInput.value.trim(),
          items: [],
          informationModel: "document",
          provenance: "authored",
          origin: {},
        },
        { updatedBy: whoami(ctx), actor: whoami(ctx) },
      );
      m.close();
      ctx.toast("Created “" + res.record.name + "”", "success");
      reload();
      openChecklistEditor(ctx, set, res.record, reload);
    } catch (e) {
      m.showError(String((e && e.message) || e) + (e && e.hint ? " " + e.hint : ""));
    }
  });
  nameInput.focus();
}

// ---------------------------------------------------------------------------
// deployment coverage — relationship & lifecycle coverage of each voice asset
// (task 39). Shows, per Voice/PBX asset, whether every part of the deployment
// is linked and lifecycle-aware, so a gap is fixed before the cutover rather
// than found on site.
// ---------------------------------------------------------------------------
function renderVoipCoverage(ctx, set) {
  const voices = (set.records.flexibleAssets || []).filter((r) => r.assetTypeId === VOICE_PBX_TYPE_ID);
  if (!voices.length) return [];
  return voices.map((voice) => coverageCard(voice, set));
}

function coverageCard(voice, set) {
  const report = voipDeploymentCoverage(voice, set);
  const platform = voicePlatformLabel(voice.assetFields && voice.assetFields.platformType);
  const card = h(
    "section",
    { class: "kb-card kb-record-section", dataset: { group: "voip-coverage", id: voice.id } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.check }),
      h("h2", { class: "kb-section-name" }, "Deployment coverage"),
      h("span", { class: "kb-muted" }, voice.name + (platform ? " · " + platform : "")),
      h("span", { class: "kb-badge " + (report.complete ? "kb-badge-ok" : "kb-badge-custom") }, report.requiredMet + "/" + report.requiredTotal + " required"),
    ),
  );
  for (const group of VOIP_COVERAGE_GROUPS) {
    const bucket = report.groups.find((g) => g.id === group.id);
    if (!bucket || !bucket.requirements.length) continue;
    const chips = h("div", { class: "kb-voip-coverage-chips" });
    for (const req of bucket.requirements) {
      chips.append(
        h(
          "span",
          {
            class: "kb-voip-cov" + (req.met ? " kb-voip-cov--on" : req.level === "required" ? " kb-voip-cov--missing" : " kb-voip-cov--optional"),
            title: req.met ? req.label + " — " + req.detail : (req.level === "required" ? "Required: " : "Recommended: ") + req.fix,
          },
          h("span", { class: "kb-icon", html: req.met ? icons.check : icons.alert }),
          req.label,
        ),
      );
    }
    card.append(h("div", { class: "kb-voip-coverage-group" }, h("span", { class: "kb-field-label" }, group.label), chips));
  }
  if (report.lifecycle.items.length) {
    card.append(
      h(
        "ul",
        { class: "kb-issue-list kb-voip-lifecycle" },
        report.lifecycle.items.map((it) => h("li", { class: "kb-voip-lifecycle-item" }, it.kindDef.label + ": " + (it.sourceName || "") + (it.iso ? " — " + it.iso : " (no date)"))),
      ),
    );
  }
  return card;
}

// ---------------------------------------------------------------------------
// circuit provisioning coverage — the record mapping of each resold circuit
// (task 41). Shows, per circuit, which records a provisioning touches and
// whether each is already linked, then the phase coverage of the generated
// runbook once one exists.
// ---------------------------------------------------------------------------
function renderCircuitCoverage(ctx, set) {
  const circuits = (set.records.flexibleAssets || []).filter((r) => r.assetTypeId === WAN_CIRCUIT_TYPE_ID);
  if (!circuits.length) return [];
  return circuits.map((c) => circuitCoverageCard(c, set));
}

function circuitCoverageCard(circuit, set) {
  const profile = circuitProfile(circuit);
  const coverage = provisioningRecordCoverage(circuit, set);
  const requiredMet = coverage.filter((c) => c.required && c.present).length;
  const requiredTotal = coverage.filter((c) => c.required).length;
  const runbook = (set.records.runbooks || []).find(
    (r) => r.runbookType === "circuit-provisioning" && ((r.service && r.service.id === circuit.id) || (r.origin && r.origin.circuitId === circuit.id)),
  );
  const card = h(
    "section",
    { class: "kb-card kb-record-section", dataset: { group: "circuit-coverage", id: circuit.id } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.globe }),
      h("h2", { class: "kb-section-name" }, "Circuit provisioning coverage"),
      h("span", { class: "kb-muted" }, circuit.name + (profile.accessLabel ? " · " + profile.accessLabel : "")),
      h("span", { class: "kb-badge " + (requiredMet === requiredTotal ? "kb-badge-ok" : "kb-badge-custom") }, requiredMet + "/" + requiredTotal + " required records"),
    ),
  );
  const chips = h("div", { class: "kb-voip-coverage-chips" });
  for (const c of coverage) {
    const names = c.records.map((r) => r.name).join(", ");
    chips.append(
      h(
        "span",
        {
          class: "kb-voip-cov" + (c.present ? " kb-voip-cov--on" : c.required ? " kb-voip-cov--missing" : " kb-voip-cov--optional"),
          title: c.present ? c.label + " — " + (names || "linked") : (c.required ? "Required: " : "Optional: ") + "record or link the " + c.label.toLowerCase(),
        },
        h("span", { class: "kb-icon", html: c.present ? icons.check : icons.alert }),
        c.label,
      ),
    );
  }
  card.append(h("div", { class: "kb-voip-coverage-group" }, h("span", { class: "kb-field-label" }, "Records this provisioning updates"), chips));
  if (runbook) {
    const cov = circuitProvisioningCoverage(runbook);
    const phaseChips = h("div", { class: "kb-voip-coverage-chips" });
    for (const s of CIRCUIT_PROVISIONING_SECTIONS) {
      if (s.id === "overview" || s.id === "signoff" || s.id === "records") continue;
      phaseChips.append(
        h(
          "span",
          { class: "kb-voip-cov" + (cov[s.id] ? " kb-voip-cov--on" : s.required ? " kb-voip-cov--missing" : " kb-voip-cov--optional"), title: s.heading },
          h("span", { class: "kb-icon", html: cov[s.id] ? icons.check : icons.alert }),
          s.heading,
        ),
      );
    }
    card.append(h("div", { class: "kb-voip-coverage-group" }, h("span", { class: "kb-field-label" }, "Runbook phases — " + runbook.name), phaseChips));
  } else {
    card.append(h("p", { class: "kb-muted kb-record-empty" }, "No circuit provisioning runbook yet — generate one to map every step to the records it updates."));
  }
  return card;
}

// ---------------------------------------------------------------------------
// generate-circuit flow — read the resold circuit asset and assemble the
// provisioning & activation runbook (task 41).
// ---------------------------------------------------------------------------
function generateCircuitFlow(ctx, set, circuits, reload) {
  const circuitSel = h("select", { class: "kb-input", id: "kbCircuitSel" });
  for (const c of circuits) {
    const p = circuitProfile(c);
    circuitSel.append(h("option", { value: c.id }, c.name + (p.accessLabel ? "  —  " + p.accessLabel : "")));
  }
  const sites = (set.records.locations || []).filter((l) => l.type === "locations");
  const siteSel = h("select", { class: "kb-input" });
  siteSel.append(h("option", { value: "" }, "— none —"));
  for (const l of sites) siteSel.append(h("option", { value: l.id }, l.name));
  const titleInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Circuit provisioning — Aurora 500 (Head Office)" });
  const preparedInput = h("input", { class: "kb-input", type: "text", placeholder: "Your name" });
  preparedInput.value = whoami(ctx);

  const preview = h("p", { class: "kb-field-help" }, "");
  const syncPreview = () => {
    const c = circuits.find((x) => x.id === circuitSel.value);
    if (!c) { preview.textContent = ""; return; }
    const site = siteSel.value ? sites.find((l) => l.id === siteSel.value) : null;
    const gen = generateCircuitProvisioningRunbook({ circuit: c, set, site, preparedBy: preparedInput.value.trim(), title: titleInput.value.trim() || undefined });
    preview.textContent =
      "Will assemble a " + gen.sections.filter((s) => s.required).length + "-section runbook across " + PROVISIONING_PHASES.length + " phases" +
      (gen.warnings.length ? ", flagging " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " to fill in" : "") + ".";
  };
  circuitSel.addEventListener("change", syncPreview);
  siteSel.addEventListener("change", syncPreview);
  preparedInput.addEventListener("input", syncPreview);
  syncPreview();

  const m = openModal({
    title: "Generate circuit provisioning runbook",
    description:
      "IT-U reads the selected resold circuit and the records it links to and assembles the full provisioning & activation procedure — order capture, carrier handoff, CPE, addressing and reverse DNS, firewall and routing, activation, throughput testing, redundancy and acceptance — with every step mapped to the records it updates.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Internet/WAN circuit"), circuitSel),
      h("div", { class: "kb-field-row" }, h("div", { class: "kb-field kb-field-grow" }, h("span", { class: "kb-field-label" }, "Title (optional)"), titleInput), h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Site"), siteSel)),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Prepared by"), preparedInput),
      preview,
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbCircuitGenerateBtn" }, "Generate runbook"),
  );
  m.actions.querySelector("#kbCircuitGenerateBtn").addEventListener("click", async () => {
    m.clearError();
    const circuit = circuits.find((x) => x.id === circuitSel.value);
    if (!circuit) {
      m.showError("Pick a resold circuit to generate from.");
      return;
    }
    const site = siteSel.value ? sites.find((l) => l.id === siteSel.value) : null;
    try {
      const gen = generateCircuitProvisioningRunbook({ circuit, set, site, preparedBy: preparedInput.value.trim(), title: titleInput.value.trim() || undefined });
      const res = await ctx.docs.addRunbook(
        set.id,
        {
          name: gen.name,
          runbookType: gen.runbookType,
          status: "draft",
          version: "1.0",
          summary: gen.summary,
          body: gen.body,
          service: gen.service,
          site: gen.site,
          tags: ["circuit", "provisioning", "internet"],
          informationModel: "document",
          provenance: "authored",
          origin: { source: "circuit-asset", circuitId: circuit.id, warnings: gen.warnings, generatedAt: gen.generatedAt },
        },
        { updatedBy: whoami(ctx), actor: whoami(ctx) },
      );
      m.close();
      ctx.toast("Generated “" + res.record.name + "” — " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " flagged", "success", 5200);
      reload();
      openRunbookEditor(ctx, { setId: set.id, record: res.record, reload });
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
}

// ---------------------------------------------------------------------------
// addressing & firewall coverage — the CPE, public addressing, reverse DNS,
// VLAN/segmentation and firewall relationship of each resold circuit (task 42).
// Shows, per circuit, whether every part of the addressing handover is recorded
// or linked, then the parsed plan itself so a renumber or migration is visible.
// ---------------------------------------------------------------------------
function renderAddressingCoverage(ctx, set) {
  const circuits = (set.records.flexibleAssets || []).filter((r) => r.assetTypeId === WAN_CIRCUIT_TYPE_ID);
  if (!circuits.length) return [];
  return circuits.map((c) => addressingCoverageCard(c, set));
}

function addressingCoverageCard(circuit, set) {
  const coverage = circuitAddressingCoverage(circuit, set);
  const requiredMet = coverage.filter((c) => c.required && c.present).length;
  const requiredTotal = coverage.filter((c) => c.required).length;
  const plan = circuitAddressingPlan(circuit);
  const seg = segmentationSummary(circuit, { key: "vlans" });
  const card = h(
    "section",
    { class: "kb-card kb-record-section", dataset: { group: "circuit-addressing", id: circuit.id } },
    h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-section-icon", html: icons.globe }),
      h("h2", { class: "kb-section-name" }, "Addressing & firewall coverage"),
      h("span", { class: "kb-muted" }, circuit.name),
      h("span", { class: "kb-badge " + (requiredMet === requiredTotal ? "kb-badge-ok" : "kb-badge-custom") }, requiredMet + "/" + requiredTotal + " required parts"),
    ),
  );
  const chips = h("div", { class: "kb-voip-coverage-chips" });
  for (const c of coverage) {
    const names = c.records.map((r) => r.name).join(", ");
    const title = c.present ? c.label + " — " + (names || c.detail || "recorded") : (c.required ? "Required: " : "Recommended: ") + "record the " + c.label.toLowerCase();
    chips.append(
      h(
        "span",
        { class: "kb-voip-cov" + (c.present ? " kb-voip-cov--on" : c.required ? " kb-voip-cov--missing" : " kb-voip-cov--optional"), title },
        h("span", { class: "kb-icon", html: c.present ? icons.check : icons.alert }),
        c.label,
      ),
    );
  }
  card.append(h("div", { class: "kb-voip-coverage-group" }, h("span", { class: "kb-field-label" }, "Addressing & firewall handover"), chips));

  const lines = [];
  if (plan.addressing.subnetStrings.length) lines.push(["Subnets", plan.addressing.subnetStrings.join(", ")]);
  if (plan.staticIps.length) lines.push(["Static IPs", plan.staticIps.map((x) => x.ip + " → " + x.ptrName).join(", ")]);
  if (plan.reverseZones.length) lines.push(["Reverse zones", plan.reverseZones.map((z) => z.zone).join(", ")]);
  if (plan.forwardRecords.length) lines.push(["Forward DNS", plan.forwardRecords.map((r) => r.name + " " + r.type + " → " + (r.value || "?")).join(", ")]);
  if (seg.vlans.length) lines.push(["VLANs", seg.vlans.map((v) => (v.number != null ? v.number + ": " : "") + (v.purposeLabel || v.name || "?")).join(", ")]);
  if (!lines.length) {
    card.append(h("p", { class: "kb-muted kb-record-empty" }, "No subnets, static addresses or VLANs recorded yet — generate an addressing record to document the handover."));
  } else {
    const box = h("div", { class: "kb-addr-summary" });
    for (const [label, value] of lines) box.append(h("div", { class: "kb-addr-line" }, h("span", { class: "kb-field-label" }, label), h("span", null, value)));
    card.append(box);
  }
  return card;
}

// ---------------------------------------------------------------------------
// generate-addressing flow — read the resold circuit and assemble a
// client-technical record of its public addressing, reverse DNS, VLANs, CPE and
// firewall relationship (task 42).
// ---------------------------------------------------------------------------
function generateAddressingFlow(ctx, set, circuits, reload) {
  const circuitSel = h("select", { class: "kb-input", id: "kbAddressingSel" });
  for (const c of circuits) {
    const p = circuitProfile(c);
    circuitSel.append(h("option", { value: c.id }, c.name + (p.accessLabel ? "  —  " + p.accessLabel : "")));
  }
  const titleInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Addressing & firewall — Aurora 500" });
  const preview = h("p", { class: "kb-field-help" }, "");
  const syncPreview = () => {
    const c = circuits.find((x) => x.id === circuitSel.value);
    if (!c) { preview.textContent = ""; return; }
    const gen = generateCircuitAddressingRecord({ circuit: c, set, title: titleInput.value.trim() || undefined });
    preview.textContent =
      "Will document " + gen.body.split("\n").filter((l) => l.startsWith("## ")).length + " sections" +
      (gen.warnings.length ? ", flagging " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " to fill in" : " — no gaps found") + ".";
  };
  circuitSel.addEventListener("change", syncPreview);
  titleInput.addEventListener("input", syncPreview);
  syncPreview();

  const m = openModal({
    title: "Generate addressing & firewall record",
    description:
      "IT-U reads the selected resold circuit and assembles a client-technical record of its public addressing, subnets, static IPs, forward and reverse DNS, VLANs/segmentation, router/CPE and the firewall relationship — naming every record it is linked to.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Internet/WAN circuit"), circuitSel),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Title (optional)"), titleInput),
      preview,
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbAddressingGenerateBtn" }, "Generate record"),
  );
  m.actions.querySelector("#kbAddressingGenerateBtn").addEventListener("click", async () => {
    m.clearError();
    const circuit = circuits.find((x) => x.id === circuitSel.value);
    if (!circuit) {
      m.showError("Pick a resold circuit to generate from.");
      return;
    }
    try {
      const gen = generateCircuitAddressingRecord({ circuit, set, title: titleInput.value.trim() || undefined });
      const res = await ctx.docs.addDocument(
        set.id,
        {
          name: gen.name,
          docType: gen.docType,
          summary: gen.summary,
          body: gen.body,
          tags: ["circuit", "addressing", "dns", "firewall"],
          informationModel: "document",
          provenance: "authored",
          origin: { source: "circuit-asset", circuitId: circuit.id, warnings: gen.warnings, generatedAt: gen.generatedAt },
        },
        { updatedBy: whoami(ctx), actor: whoami(ctx) },
      );
      m.close();
      ctx.toast("Generated “" + res.record.name + "” — " + gen.warnings.length + " gap" + (gen.warnings.length === 1 ? "" : "s") + " flagged", "success", 5200);
      reload();
      openDocumentEditor(ctx, { setId: set.id, record: res.record, reload });
    } catch (e) {
      m.showError(String((e && e.message) || e));
    }
  });
}
