import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { OPENRPA_TARGET_TYPES } from "../core/openrpa/linking.js";
import { OPENRPA_SYNC_POLICIES, OPENRPA_SYNC_POLICY_LABELS, OPENRPA_SYNC_POLICY_NOTES, OPENRPA_SYNC_ACTIONS } from "../core/openrpa/sync.js";
import { OPENRPA_DRIFT_LABELS, OPENRPA_DRIFT_SEVERITY } from "../core/openrpa/drift.js";
import { OPENRPA_OWNERSHIP_VERSION, ownershipTable, registerOwnership } from "../core/openrpa/ownership.js";
import { DIRECTIONS } from "../core/catalog.js";

function statCard(label, value, hint, tone) {
  const card = el("article.pu-card.pu-stat");
  card.appendChild(el("span.pu-stat-label", { text: label }));
  if (tone) {
    const row = el("span");
    row.appendChild(el("span.pu-chip", { class: tone, text: String(value) }));
    card.appendChild(row);
  } else {
    card.appendChild(el("span.pu-stat-value", { text: String(value) }));
  }
  if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
  return card;
}

function field(label, control, hint) {
  const wrap = el("label.pu-field");
  wrap.appendChild(el("span.pu-small.pu-muted", { text: label }));
  wrap.appendChild(control);
  if (hint) wrap.appendChild(el("span.pu-small.pu-muted", { text: hint }));
  return wrap;
}

function chip(text, tone) {
  return el("span.pu-chip", { class: tone || "", text });
}

function loadingRow(label) {
  return el("div.pu-loading", { text: label });
}

function alertNode(text, tone = "fail") {
  return el(`div.pu-alert.${tone}`, { text });
}

function emptyNode(text) {
  return el("p.pu-empty", { text });
}

function formatDate(value) {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

function truncate(value, max = 60) {
  const text = String(value == null ? "" : value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function withBusy(button, busyLabel, task) {
  const original = button.textContent;
  button.disabled = true;
  button.textContent = busyLabel;
  try {
    return await task();
  } finally {
    button.disabled = false;
    button.textContent = original;
  }
}

function table(headers) {
  const scroll = el("div.pu-table-scroll");
  const node = el("table.pu-table");
  const thead = el("thead");
  const row = el("tr");
  for (const label of headers) row.appendChild(el("th", { text: label }));
  thead.appendChild(row);
  node.appendChild(thead);
  const tbody = el("tbody");
  node.appendChild(tbody);
  scroll.appendChild(node);
  return { scroll, tbody };
}

function addRow(tbody, cells, { empty = "—" } = {}) {
  const tr = el("tr");
  for (const cell of cells) {
    const td = el("td");
    if (cell instanceof Node) td.appendChild(cell);
    else if (cell == null) td.textContent = empty;
    else td.textContent = String(cell);
    tr.appendChild(td);
  }
  tbody.appendChild(tr);
  return tr;
}

function button(label, tone, permission) {
  const node = el(`button.pu-btn${tone ? `.${tone}` : ""}`, { type: "button", text: label });
  if (permission) {
    node.setAttribute("data-permission", permission);
    node.setAttribute("data-mutating", "");
  }
  return node;
}

function selectOf(options, { label } = {}) {
  const select = el("select.pu-select", label ? { "aria-label": label } : {});
  for (const option of options) select.appendChild(el("option", { value: option.value, text: option.label }));
  return select;
}

const DIRECTION_LABELS = Object.fromEntries(DIRECTIONS.map((entry) => [entry.id, entry.label]));

const SEVERITY_TONES = { error: "fail", warning: "warn", info: "" };
const ACTION_TONES = { adopt: "ok", push: "warn", capture: "", unlink: "fail", review: "warn" };

export const openrpaSyncView = {
  id: "openrpa-sync",
  title: "Sync & conflicts",
  group: "OpenRPA",
  icon: "rpa",
  nav: true,
  render({ hub, onDestroy }) {
    const or = hub.openrpa;
    const root = el("div");
    let destroyed = false;

    const state = {
      loading: true,
      loadError: null,
      overview: null,
      ownership: [],
      report: null,
      drift: null,
      proposals: [],
      links: [],
      targets: [],
      history: [],
      decisions: [],
      policy: "manual",
      lastAction: null,
    };

    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const errorCtn = el("div", { style: { "margin-bottom": "1rem" } });
    const ownershipCtn = el("div");
    const controlCtn = el("div");
    const proposalsCtn = el("div");
    const linksCtn = el("div");
    const historyCtn = el("div");

    const policySelect = selectOf(
      OPENRPA_SYNC_POLICIES.map((value) => ({ value, label: OPENRPA_SYNC_POLICY_LABELS[value] })),
      { label: "Reconciliation policy" }
    );
    const refreshBtn = button("Refresh targets", "secondary");
    const scanBtn = button("Scan for drift", null, "sync.run");
    const captureBtn = button("Capture baseline", "secondary", "sync.run");
    const reconcileBtn = button("Reconcile now", null, "sync.run");
    const autolinkBtn = button("Auto-link", null, "sync.run");

    const entitySelect = selectOf([], { label: "Hub entity" });
    const targetSelect = selectOf([], { label: "OpenRPA target" });
    const linkBtn = button("Link", null, "links.write");

    function rerender() {
      if (destroyed) return;
      renderStats();
      mount(errorCtn, state.loadError ? alertNode(state.loadError, "fail") : null);
      mount(ownershipCtn, buildOwnership());
      mount(controlCtn, buildControl());
      mount(proposalsCtn, buildProposals());
      mount(linksCtn, buildLinks());
      mount(historyCtn, buildHistory());
    }

    function renderStats() {
      const overview = state.overview || {};
      const drift = state.drift || {};
      mount(
        statsCtn,
        statCard("Entity links", overview.links || 0, `${overview.linksUnresolved || 0} unresolved`),
        statCard("Drift signals", drift.open || 0, `${drift.byKind ? Object.keys(drift.byKind).length : 0} kind(s)`, drift.open ? "warn" : "ok"),
        statCard("Proposals", state.proposals.length, `${state.proposals.filter((entry) => entry.auto).length} auto`),
        statCard("Applied changes", overview.syncChanges || 0, `${state.decisions.length} decision(s)`)
      );
    }

    function refreshState() {
      state.overview = or.stats();
      state.ownership = ownershipTable({ registry: hub.registry });
      state.report = registerOwnership({ registry: hub.registry });
      state.drift = or.drift.stats();
      state.proposals = or.sync.proposals({ policy: state.policy });
      state.links = or.linking.browse({});
      state.targets = or.linking.targets({});
      state.history = or.sync.history({ limit: 25 });
      state.decisions = or.conflicts.decisionRecords();
      state.overview.links = or.linking.stats().links;
      state.overview.linksUnresolved = or.linking.stats().unresolved;
    }

    async function load() {
      state.loading = true;
      state.loadError = null;
      rerender();
      const connected = await or.connect({ announce: false });
      if (!connected.ok) {
        state.loading = false;
        state.loadError = connected.error || "Could not reach the OpenFlow endpoint.";
        rerender();
        return;
      }
      await or.linking.refreshTargets();
      await or.drift.scan({ refresh: false });
      refreshState();
      state.loading = false;
      rerender();
    }

    function entityOptions() {
      const options = [];
      for (const type of hub.registry.entityTypes) {
        for (const entity of hub.identity.all(type.id)) {
          options.push({ value: `${type.id}|${entity.id}`, label: `${hub.identity.nameOf(type.id, entity)} · ${type.label}` });
        }
      }
      return options;
    }

    function populateSelects() {
      const entityValue = entitySelect.value;
      entitySelect.innerHTML = "";
      const entities = entityOptions();
      for (const option of entities) entitySelect.appendChild(el("option", { value: option.value, text: option.label }));
      if (entityValue && entities.some((entry) => entry.value === entityValue)) entitySelect.value = entityValue;

      const targetValue = targetSelect.value;
      targetSelect.innerHTML = "";
      for (const target of state.targets) {
        targetSelect.appendChild(el("option", { value: `${target.type}|${target.id}`, text: `${target.name} · ${target.type}` }));
      }
      if (targetValue && state.targets.some((entry) => `${entry.type}|${entry.id}` === targetValue)) targetSelect.value = targetValue;
    }

    function buildOwnership() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Field ownership" }));
      head.appendChild(chip(`v${OPENRPA_OWNERSHIP_VERSION}`, ""));
      if (state.report) head.appendChild(chip(state.report.ok ? "consistent" : "incomplete", state.report.ok ? "ok" : "warn"));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Which fields OpenRPA owns on each entity type, the sync direction, and the precedence used when the hub and OpenFlow disagree." }));
      section.appendChild(head);

      if (!state.ownership.length) {
        section.appendChild(loadingRow("Reading the ownership model…"));
        return section;
      }
      const { scroll, tbody } = table(["Entity type", "Field", "Owner", "Direction", "Priority", ""]);
      for (const type of state.ownership) {
        for (const entry of type.fields) {
          addRow(tbody, [
            type.label,
            entry.label,
            entry.ownerName,
            chip(DIRECTION_LABELS[entry.direction] || entry.direction, entry.direction === "none" ? "warn" : ""),
            entry.priority,
            entry.automation ? chip("automation", "ok") : entry.computed ? chip("computed", "") : "—",
          ]);
        }
      }
      section.appendChild(scroll);
      if (state.report && !state.report.ok) section.appendChild(alertNode(state.report.issues.map((issue) => issue.message).join(" "), "warn"));
      return section;
    }

    function buildControl() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Drift-aware reconciliation" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Compare the hub snapshot against the linked OpenFlow documents, then apply the ownership rules under a chosen policy." }));
      head.appendChild(el("span", { style: { "margin-left": "auto", display: "flex", gap: "0.4rem", "flex-wrap": "wrap" } }, [refreshBtn, captureBtn, scanBtn, reconcileBtn]));
      section.appendChild(head);

      const form = el("div.pu-form-row", { style: { "margin-top": "0.5rem" } });
      form.appendChild(field("Policy", policySelect, OPENRPA_SYNC_POLICY_NOTES[state.policy]));
      section.appendChild(form);

      const drift = state.drift || {};
      const chips = el("div.pu-toolbar");
      for (const kind of Object.keys(OPENRPA_DRIFT_LABELS)) {
        chips.appendChild(chip(`${OPENRPA_DRIFT_LABELS[kind]} ${drift.byKind ? drift.byKind[kind] || 0 : 0}`, SEVERITY_TONES[OPENRPA_DRIFT_SEVERITY[kind]] || ""));
      }
      chips.appendChild(chip(`snapshots ${drift.snapshots || 0}`, ""));
      chips.appendChild(chip(`targets ${(state.targets || []).length}`, ""));
      section.appendChild(chips);
      if (state.lastAction) section.appendChild(el("p.pu-small.pu-muted", { text: state.lastAction }));
      return section;
    }

    function buildProposals() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Reconciliation proposals" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Every open drift signal as a proposed change, with the hub value, the OpenRPA value, the winning side and the decision." }));
      section.appendChild(head);

      if (state.loading) {
        section.appendChild(loadingRow("Reading drift signals…"));
        return section;
      }
      if (!state.proposals.length) {
        section.appendChild(emptyNode("No open drift — the hub and OpenFlow agree."));
        return section;
      }
      const { scroll, tbody } = table(["Entity", "Target", "Field", "Hub", "OpenRPA", "Winner", "Action", ""]);
      for (const proposal of state.proposals) {
        const approveBtn = button("Approve", "secondary", "conflicts.resolve");
        const rejectBtn = button("Reject", "secondary", "conflicts.resolve");
        approveBtn.addEventListener("click", () =>
          withBusy(approveBtn, "Applying…", async () => {
            const result = await or.conflicts.approve(proposal.id, { policy: state.policy });
            await or.drift.scan({ refresh: false });
            refreshState();
            rerender();
            toast(result.ok ? `Proposal applied (${result.action}).` : result.error || "The proposal could not be applied.");
          })
        );
        rejectBtn.addEventListener("click", () =>
          withBusy(rejectBtn, "Rejecting…", async () => {
            await or.conflicts.reject(proposal.id, { reason: "rejected in the review screen", policy: state.policy });
            refreshState();
            rerender();
            toast("Proposal rejected.");
          })
        );
        addRow(tbody, [
          `${proposal.entityName} · ${proposal.entityType}`,
          `${proposal.targetName} · ${proposal.targetType}`,
          proposal.label,
          proposal.kind === "field" ? truncate(proposal.hubValue, 40) : truncate(proposal.held, 40),
          proposal.kind === "field" ? truncate(proposal.remoteValue, 40) : truncate(proposal.expected, 40),
          chip(proposal.winner || "—", proposal.winner === "openrpa" ? "warn" : proposal.winner === "hub" ? "ok" : ""),
          chip(OPENRPA_SYNC_ACTIONS[proposal.action] || proposal.action, ACTION_TONES[proposal.action] || ""),
          el("span", { style: { display: "flex", gap: "0.3rem" } }, [approveBtn, rejectBtn]),
        ]);
      }
      section.appendChild(scroll);
      return section;
    }

    function buildLinks() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Entity links" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Bind canonical hub entities to the OpenRPA workflows, queues and work items that automate them." }));
      head.appendChild(el("span", { style: { "margin-left": "auto" } }, [autolinkBtn]));
      section.appendChild(head);

      populateSelects();
      const form = el("div.pu-form-row", { style: { "margin-top": "0.5rem" } });
      form.appendChild(field("Hub entity", entitySelect));
      form.appendChild(field("OpenRPA target", targetSelect));
      const linkField = el("div.pu-field");
      linkField.appendChild(el("span.pu-small.pu-muted", { text: " " }));
      linkField.appendChild(linkBtn);
      form.appendChild(linkField);
      section.appendChild(form);

      if (!state.links.length) {
        section.appendChild(emptyNode("No entity links yet — link an entity or press Auto-link."));
        return section;
      }
      const { scroll, tbody } = table(["Entity", "Target", "Origin", "Status", "Updated", ""]);
      for (const edge of state.links) {
        const unlinkBtn = button("Unlink", "secondary", "links.write");
        unlinkBtn.addEventListener("click", () =>
          withBusy(unlinkBtn, "Unlinking…", async () => {
            await or.linking.unlink(edge.id);
            await or.drift.scan({ refresh: false });
            refreshState();
            rerender();
            toast("Link removed.");
          })
        );
        addRow(tbody, [
          `${edge.entityName} · ${edge.entityType}`,
          `${edge.targetName} · ${edge.targetType}`,
          chip(edge.origin, edge.origin === "auto" ? "" : "ok"),
          edge.resolved ? chip("resolved", "ok") : chip("missing", "fail"),
          formatDate(edge.updatedAt),
          unlinkBtn,
        ]);
      }
      section.appendChild(scroll);
      return section;
    }

    function buildHistory() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Change & decision history" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Every applied reconciliation with its source, plus every approve/reject decision." }));
      section.appendChild(head);

      if (!state.history.length && !state.decisions.length) {
        section.appendChild(emptyNode("Nothing has been reconciled yet."));
        return section;
      }
      const { scroll, tbody } = table(["When", "Kind", "Change / decision", "Source", "Detail"]);
      for (const decision of state.decisions) {
        addRow(tbody, [
          formatDate(decision.at),
          chip("decision", decision.decision === "approved" ? "ok" : "warn"),
          decision.decision,
          decision.policy || "—",
          truncate(decision.note || decision.result || "—", 80),
        ]);
      }
      for (const change of state.history) {
        addRow(tbody, [
          formatDate(change.at),
          chip("change", change.applied ? "ok" : "warn"),
          `${change.action} · ${change.label}`,
          change.source,
          truncate(`${change.entityName} → ${change.targetName}: ${change.from ?? "—"} → ${change.to ?? "—"}`, 90),
        ]);
      }
      section.appendChild(scroll);
      return section;
    }

    policySelect.addEventListener("change", () => {
      state.policy = policySelect.value;
      refreshState();
      rerender();
    });
    refreshBtn.addEventListener("click", () =>
      withBusy(refreshBtn, "Refreshing…", async () => {
        const result = await or.linking.refreshTargets();
        refreshState();
        rerender();
        toast(result.ok ? `Read ${result.targets} OpenRPA target(s).` : result.error || "The target refresh failed.");
      })
    );
    scanBtn.addEventListener("click", () =>
      withBusy(scanBtn, "Scanning…", async () => {
        const result = await or.drift.scan({ refresh: true });
        refreshState();
        rerender();
        state.lastAction = `Scanned at ${formatDate(result.at)}: ${result.found} signal(s), ${result.opened} opened, ${result.resolved} resolved.`;
        rerender();
        toast(`${result.found} drift signal(s) found.`);
      })
    );
    captureBtn.addEventListener("click", () =>
      withBusy(captureBtn, "Capturing…", async () => {
        const result = await or.drift.captureTargets();
        refreshState();
        rerender();
        toast(`Captured ${result.captured} baseline(s).`);
      })
    );
    reconcileBtn.addEventListener("click", () =>
      withBusy(reconcileBtn, "Reconciling…", async () => {
        const result = await or.sync.reconcile({ policy: state.policy });
        refreshState();
        rerender();
        state.lastAction = `Reconciled under ${OPENRPA_SYNC_POLICY_LABELS[result.policy]}: ${result.applied} applied, ${result.pending} pending${result.failed.length ? `, ${result.failed.length} failed` : ""}.`;
        rerender();
        toast(`Applied ${result.applied} change(s).`);
      })
    );
    autolinkBtn.addEventListener("click", () =>
      withBusy(autolinkBtn, "Linking…", async () => {
        await or.linking.refreshTargets();
        const result = await or.linking.autolink();
        await or.drift.scan({ refresh: false });
        refreshState();
        rerender();
        toast(`Auto-linked ${result.created}, removed ${result.removed}.`);
      })
    );
    linkBtn.addEventListener("click", () =>
      withBusy(linkBtn, "Linking…", async () => {
        const [entityType, entityId] = entitySelect.value.split("|");
        const [targetType, targetId] = targetSelect.value.split("|");
        if (!entityType || !targetType) {
          toast("Choose a hub entity and an OpenRPA target.");
          return;
        }
        const result = await or.linking.link({ entityType, entityId, targetType, targetId, origin: "manual" });
        if (!result.ok) {
          toast(result.error);
          return;
        }
        await or.drift.captureTarget({ targetType, targetId });
        await or.drift.scan({ refresh: false });
        refreshState();
        rerender();
        toast("Entity linked.");
      })
    );

    const header = pageHead({
      eyebrow: "OpenRPA / OpenFlow",
      title: "Sync & conflicts",
      subtitle: "Declare which fields OpenRPA owns, link hub entities to their OpenRPA workflows, queues and work items, detect field-, record- and relationship-level drift, and reconcile it under an ownership policy with a full decision history.",
    });

    mount(root, header, statsCtn, errorCtn, ownershipCtn, controlCtn, proposalsCtn, linksCtn, historyCtn);
    rerender();

    load();

    if (typeof onDestroy === "function") {
      onDestroy(() => {
        destroyed = true;
      });
    }
    return root;
  },
};
