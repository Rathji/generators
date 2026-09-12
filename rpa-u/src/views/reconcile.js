import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";

const KIND_LABEL = {
  "unresolved-reference": "Unresolved references",
  "inconsistent-link": "Inconsistent links",
  "field-conflict": "Field conflicts",
  "copy-drift": "Copy drift",
  "stale-value": "Stale values",
  "duplicate-identity": "Possible duplicates",
  "orphan-link": "Orphan links",
};

const REFERENCE_STATUS = {
  owner: { label: "owner", cls: "ok" },
  derived: { label: "derived", cls: "ok" },
  copy: { label: "copy", cls: "warn" },
  cached: { label: "cached", cls: "warn" },
  conflict: { label: "conflict", cls: "fail" },
  stale: { label: "stale", cls: "fail" },
  missing: { label: "missing", cls: "fail" },
  private: { label: "hub-local", cls: "" },
  unregistered: { label: "unregistered", cls: "warn" },
};

function severityClass(severity) {
  if (severity === "error") return "fail";
  if (severity === "warning") return "warn";
  return "";
}

function statCard(label, value, hint) {
  const card = el("article.pu-card.pu-stat");
  card.appendChild(el("span.pu-stat-label", { text: label }));
  card.appendChild(el("span.pu-stat-value", { text: String(value) }));
  if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
  return card;
}

function entityOptions(hub, typeId) {
  return hub.identity
    .all(typeId)
    .map((entity) => ({ id: entity.id, name: hub.identity.nameOf(typeId, entity) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export const reconcileView = {
  id: "reconcile",
  title: "Reconciliation",
  group: "Integrity",
  icon: "reconcile",
  nav: true,
  render({ hub }) {
    const root = el("div");
    const state = { severity: "info", refType: "company", refId: null };
    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const referenceCtn = el("div");
    const findingsCtn = el("div");
    const hygieneCtn = el("div");
    const dismissedCtn = el("div");

    function renderStats() {
      const stats = hub.reconciler.stats();
      const bySeverity = stats.bySeverity || {};
      mount(
        statsCtn,
        statCard("Open findings", stats.open, `${stats.total} total`),
        statCard("Errors", bySeverity.error || 0, "links that contradict each other"),
        statCard("Warnings", bySeverity.warning || 0, "unresolved or stale values"),
        statCard("Copy hygiene", hub.reconciler.copyHygiene().length, "records holding copied values")
      );
    }

    function renderReference() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Field resolution" }));
      card.appendChild(el("p.pu-small", { text: "Reference, don't copy. Each field is traced back to the connector that owns it; the hub shows what it holds, where that value came from, and what the owner reports." }));

      const entities = hub.registry.entityTypes;
      if (!state.refId || !hub.identity.get(state.refType, state.refId)) {
        state.refId = hub.identity.all(state.refType)[0]?.id || null;
      }

      const controls = el("div.pu-toolbar", { style: { "margin-top": "0.6rem" } });
      const typeSelect = el("select.pu-select", { "aria-label": "Entity type" });
      for (const type of entities) typeSelect.appendChild(el("option", { value: type.id, text: type.plural }));
      typeSelect.value = state.refType;
      const entitySelect = el("select.pu-select", { "aria-label": "Entity" });
      for (const option of entityOptions(hub, state.refType)) entitySelect.appendChild(el("option", { value: option.id, text: option.name }));
      entitySelect.value = state.refId || "";
      typeSelect.addEventListener("change", () => {
        state.refType = typeSelect.value;
        state.refId = null;
        renderReference();
      });
      entitySelect.addEventListener("change", () => {
        state.refId = entitySelect.value;
        renderReference();
      });
      controls.appendChild(typeSelect);
      controls.appendChild(entitySelect);
      card.appendChild(controls);

      if (!state.refId) {
        card.appendChild(el("div.pu-empty", { text: "No records of this type." }));
        mount(referenceCtn, card);
        return;
      }

      const records = hub.references.entityReference(state.refType, state.refId);
      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const head = el("tr");
      for (const label of ["Field", "Status", "Hub holds", "Owner", "Held from", "Owner reports", ""]) head.appendChild(el("th", { text: label }));
      const thead = el("thead");
      thead.appendChild(head);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const reference of records) {
        const status = REFERENCE_STATUS[reference.status] || { label: reference.status, cls: "" };
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("div", { text: reference.label }), el("span.pu-mono.pu-muted", { text: reference.field })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { class: status.cls, text: status.label })));
        tr.appendChild(el("td", { text: reference.held == null ? "—" : String(reference.held) }));
        tr.appendChild(el("td", { text: reference.ownerName || "—" }));
        tr.appendChild(el("td", { text: reference.heldSourceName || "—" }));
        tr.appendChild(el("td", { text: reference.ownerHeld == null ? (reference.status === "derived" ? String(reference.value) : "—") : String(reference.ownerHeld) }));
        const actionCell = el("td");
        const canFetch = reference.owner && reference.status !== "owner" && reference.status !== "private" && reference.status !== "unregistered";
        if (canFetch) {
          const fetchBtn = el("button.pu-btn.secondary", { type: "button", text: "Fetch from owner", "data-permission": "sync.run", "data-mutating": "" });
          fetchBtn.addEventListener("click", async () => {
            fetchBtn.disabled = true;
            const result = await hub.references.refresh(state.refType, state.refId, reference.field);
            if (result.adopted) toast(`Adopted ${reference.field} = ${result.adoptedValue}`, { tone: "success" });
            else toast(`No owner value for ${reference.field}`, { tone: "info" });
            renderAll();
          });
          actionCell.appendChild(fetchBtn);
        }
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
      mount(referenceCtn, card);
    }

    function actionSelect(options) {
      const select = el("select.pu-select");
      for (const option of options) select.appendChild(el("option", { value: option.id, text: option.name }));
      return select;
    }

    async function runAction(item, action, payload) {
      const result = await hub.reconciler.resolve(item, action, payload);
      if (result && result.ok === false) toast(result.error || "Action failed", { tone: "error" });
      else toast("Finding resolved", { tone: "success" });
      renderAll();
    }

    function findingRow(item) {
      const row = el("div.pu-test-row");
      row.appendChild(el("span.pu-chip", { class: severityClass(item.severity), text: item.severity }));
      const body = el("div.pu-test-name");
      body.appendChild(el("div", {}, el("strong", { text: item.title })));
      body.appendChild(el("div.pu-small.pu-muted", { text: item.detail }));
      if (item.entity) body.appendChild(el("span.pu-ref", { text: `${item.entity.typeId}:${item.entity.id}` }));
      row.appendChild(body);

      if (item.actions.includes("link")) {
        const candidates = item.candidates && item.candidates.length ? item.candidates.map((candidate) => ({ id: candidate.entityId, name: `${candidate.name}${candidate.reason ? ` — ${candidate.reason}` : ""}` })) : entityOptions(hub, item.toType);
        if (candidates.length) {
          const select = actionSelect(candidates);
          row.appendChild(select);
          const linkBtn = el("button.pu-btn.secondary", { type: "button", text: "Link", "data-permission": "sync.write", "data-mutating": "" });
          linkBtn.addEventListener("click", () => runAction(item, "link", { toId: select.value }));
          row.appendChild(linkBtn);
        }
      }
      if (item.actions.includes("merge")) {
        const mergeBtn = el("button.pu-btn.secondary", { type: "button", text: "Merge", "data-permission": "identity.merge", "data-mutating": "" });
        mergeBtn.addEventListener("click", () => runAction(item, "merge"));
        row.appendChild(mergeBtn);
      }
      if (item.actions.includes("refresh")) {
        const refreshBtn = el("button.pu-btn.secondary", { type: "button", text: "Adopt owner value", "data-permission": "sync.run", "data-mutating": "" });
        refreshBtn.addEventListener("click", () => runAction(item, "refresh"));
        row.appendChild(refreshBtn);
      }
      if (item.actions.includes("prune")) {
        const pruneBtn = el("button.pu-btn.secondary", { type: "button", text: "Prune", "data-permission": "sync.write", "data-mutating": "" });
        pruneBtn.addEventListener("click", () => runAction(item, "prune"));
        row.appendChild(pruneBtn);
      }
      const dismissBtn = el("button.pu-btn.secondary", { type: "button", text: "Dismiss", "data-permission": "sync.write", "data-mutating": "" });
      dismissBtn.addEventListener("click", () => runAction(item, "dismiss"));
      row.appendChild(dismissBtn);
      return row;
    }

    function renderFindings() {
      const groups = hub.reconciler.groupedByKind({ minSeverity: state.severity === "warning" ? "warning" : state.severity === "error" ? "error" : null });
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.6rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Findings" }));
      const severitySelect = el("select.pu-select", { "aria-label": "Filter findings by severity" });
      severitySelect.appendChild(el("option", { value: "info", text: "Everything" }));
      severitySelect.appendChild(el("option", { value: "warning", text: "Warnings and errors" }));
      severitySelect.appendChild(el("option", { value: "error", text: "Errors only" }));
      severitySelect.value = state.severity;
      severitySelect.addEventListener("change", () => {
        state.severity = severitySelect.value;
        renderFindings();
      });
      head.appendChild(severitySelect);
      card.appendChild(head);
      card.appendChild(el("p.pu-small", { text: "The reconciler compares the link graph, the field registry and every connector's data to surface contradictions before they spread." }));
      if (!groups.length) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "0.6rem" }, text: "No findings at this severity — the hub is consistent." }));
        mount(findingsCtn, card);
        return;
      }
      for (const group of groups) {
        const groupHead = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "margin-top": "0.75rem" } });
        groupHead.appendChild(el("h3", { style: { margin: "0" }, text: KIND_LABEL[group.kind] || group.kind }));
        groupHead.appendChild(el("span.pu-chip", { class: severityClass(group.severity), text: String(group.items.length) }));
        card.appendChild(groupHead);
        for (const item of group.items) card.appendChild(findingRow(item));
      }
      mount(findingsCtn, card);
    }

    function renderHygiene() {
      const groups = hub.reconciler.copyHygiene();
      mount(hygieneCtn);
      if (!groups.length) return;
      const card = el("section.pu-card");
      const details = el("details.pu-details", { open: false });
      const summary = el("summary");
      summary.appendChild(el("span.pu-entity-name", { text: "Copy hygiene" }));
      summary.appendChild(el("span.pu-chip", { text: `${groups.length} records` }));
      summary.appendChild(el("span.pu-small.pu-muted", { text: "values that agree but are copied, not referenced" }));
      details.appendChild(summary);
      const body = el("div.pu-details-body");
      for (const group of groups) {
        const row = el("div", { style: { "margin-top": "0.5rem" } });
        const line = el("div");
        line.appendChild(el("span.pu-ref", { text: `${group.entity.typeId}:${group.entity.id}` }));
        line.appendChild(el("span", { text: group.entity.name }));
        line.appendChild(el("span.pu-small.pu-muted", { text: ` · owned by ${group.ownerNames.join(", ")}` }));
        row.appendChild(line);
        const list = el("ul.pu-list");
        for (const field of group.fields) {
          const li = el("li");
          li.appendChild(el("span.pu-small", { text: `${field.label}: “${field.held}” from ${field.heldSourceName || "unknown"}` }));
          const dismissBtn = el("button.pu-btn.secondary", { type: "button", text: "Dismiss", "data-permission": "sync.write", "data-mutating": "" });
          dismissBtn.addEventListener("click", async () => {
            await hub.reconciler.dismiss(field.key, { kind: "copy-drift" });
            renderAll();
          });
          li.appendChild(dismissBtn);
          list.appendChild(li);
        }
        row.appendChild(list);
        body.appendChild(row);
      }
      details.appendChild(body);
      card.appendChild(details);
      hygieneCtn.appendChild(card);
    }

    function renderDismissed() {
      const dismissed = hub.reconciler.dismissedFindings();
      mount(dismissedCtn);
      if (!dismissed.length) return;
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: `Dismissed (${dismissed.length})` }));
      card.appendChild(el("p.pu-small", { text: "Dismissed findings are hidden until restored. Their source data is untouched." }));
      const list = el("div", { style: { "margin-top": "0.5rem" } });
      for (const item of dismissed) {
        const row = el("div.pu-test-row");
        row.appendChild(el("span.pu-chip", { class: severityClass(item.severity), text: item.severity }));
        row.appendChild(el("span.pu-test-name", { text: item.title }));
        const restoreBtn = el("button.pu-btn.secondary", { type: "button", text: "Restore" });
        restoreBtn.addEventListener("click", async () => {
          await hub.reconciler.restore(item.key);
          renderAll();
        });
        row.appendChild(restoreBtn);
        list.appendChild(row);
      }
      card.appendChild(list);
      dismissedCtn.appendChild(card);
    }

    function renderAll() {
      renderStats();
      renderReference();
      renderFindings();
      renderHygiene();
      renderDismissed();
    }

    root.appendChild(
      pageHead({
        eyebrow: "Integrity",
        title: "Reconciliation",
        subtitle: "Where the tools disagree, the hub says so. It flags unresolved links, contradictory records, stale derived values and duplicates, and gives you a one-click way to put them right.",
      })
    );
    root.appendChild(statsCtn);
    root.appendChild(referenceCtn);
    root.appendChild(findingsCtn);
    root.appendChild(hygieneCtn);
    root.appendChild(dismissedCtn);

    renderAll();
    return root;
  },
};
