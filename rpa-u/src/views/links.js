import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";

const STATUS_LABEL = {
  linked: "linked",
  manual: "linked by hand",
  ambiguous: "ambiguous",
  dangling: "no match",
  missing: "required",
  empty: "not set",
  orphan: "orphan",
};

function statusClass(status) {
  if (status === "linked" || status === "manual") return "ok";
  if (status === "empty") return "warn";
  return "fail";
}

function statusChip(status) {
  return el("span.pu-chip", { class: statusClass(status), text: STATUS_LABEL[status] || status });
}

function entityOptions(hub, typeId) {
  return hub.identity
    .all(typeId)
    .map((entity) => ({ id: entity.id, name: hub.identity.nameOf(typeId, entity) }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

function statCard(label, value, hint) {
  const card = el("article.pu-card.pu-stat");
  card.appendChild(el("span.pu-stat-label", { text: label }));
  card.appendChild(el("span.pu-stat-value", { text: String(value) }));
  if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
  return card;
}

export const linksView = {
  id: "links",
  title: "Entity links",
  group: "Linking",
  icon: "link",
  nav: true,
  render({ hub }) {
    const root = el("div");
    const state = { type: "device" };
    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const matrixCtn = el("div");
    const unresolvedCtn = el("div");
    const explorerCtn = el("div");

    function renderStats() {
      const summary = hub.linker.summary();
      mount(
        statsCtn,
        statCard("Links in graph", summary.edges, `${summary.linkedEntities} records connected`),
        statCard("References", summary.references, "declared cross-tool fields"),
        statCard("Resolved", summary.resolved, "linked automatically or by hand"),
        statCard("Needs attention", summary.unresolved, "ambiguous or unmatched")
      );
    }

    function renderMatrix() {
      const summary = hub.linker.summary();
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Link types" }));
      card.appendChild(el("p.pu-small", { text: "Every cross-tool reference the hub understands. Each incoming value is resolved to a canonical record and stored as an edge rather than a copy." }));
      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const head = el("tr");
      for (const label of ["Reference", "Connects", "Cardinality", "Edges", "Unresolved"]) head.appendChild(el("th", { text: label }));
      const thead = el("thead");
      thead.appendChild(head);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const type of hub.linker.linkTypes) {
        const counts = summary.byLinkTypeStatus[type.id] || { total: 0, resolved: 0, unresolved: 0 };
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("div", { text: type.label }), el("span.pu-mono.pu-muted", { text: type.id })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { text: type.fromType }), el("span.pu-muted", { text: " → " }), el("span.pu-chip", { text: type.toType })));
        tr.appendChild(el("td", { text: type.cardinality === "one" ? "one-to-one" : "many" }));
        tr.appendChild(el("td", { text: `${summary.byType[type.id] || 0} / ${counts.total}` }));
        const unresolvedCell = el("td");
        if (counts.unresolved) unresolvedCell.appendChild(el("span.pu-chip.fail", { text: String(counts.unresolved) }));
        else unresolvedCell.appendChild(el("span.pu-small.pu-muted", { text: "none" }));
        tr.appendChild(unresolvedCell);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
      mount(matrixCtn, card);
    }

    function renderUnresolved() {
      const records = hub.linker.report({ status: ["dangling", "ambiguous", "missing"] });
      if (!records.length) {
        mount(unresolvedCtn);
        return;
      }
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: `Unresolved references (${records.length})` }));
      card.appendChild(el("p.pu-small", { text: "These references could not be matched to a single canonical record. Pick the right one, or rebuild the graph after the source data is corrected." }));
      const list = el("div", { style: { "margin-top": "0.6rem" } });
      for (const record of records) {
        const row = el("div.pu-test-row");
        row.appendChild(statusChip(record.status));
        row.appendChild(el("span.pu-test-name", {}, el("strong", { text: record.fromName }), el("span.pu-muted", { text: " · " }), el("span.pu-small", { text: record.field }), el("span.pu-mono.pu-muted", { text: record.raw ? ` “${record.raw}”` : " (blank)" })));
        if (record.status !== "missing") {
          const select = el("select.pu-select");
          const suggested = record.candidates.map((candidate) => ({ id: candidate.entityId, name: `${candidate.name} — ${candidate.reason}` }));
          if (!suggested.length) select.appendChild(el("option", { value: "", text: `Choose a ${record.toType}…` }));
          for (const option of (suggested.length ? suggested : entityOptions(hub, record.toType))) select.appendChild(el("option", { value: option.id, text: option.name }));
          const linkBtn = el("button.pu-btn.secondary", { type: "button", text: "Link" });
          linkBtn.addEventListener("click", async () => {
            if (!select.value) {
              toast(`Choose a ${record.toType} to link first`, { tone: "error" });
              return;
            }
            linkBtn.disabled = true;
            const result = await hub.linker.override({ fromType: record.fromType, fromId: record.fromId, field: record.field, toType: record.toType, toId: select.value, note: "linked from the links screen" });
            if (result.ok) {
              toast(`Linked ${record.fromName}`, { tone: "success" });
              renderAll();
            } else {
              toast(result.error, { tone: "error" });
              linkBtn.disabled = false;
            }
          });
          row.appendChild(select);
          row.appendChild(linkBtn);
        }
        list.appendChild(row);
      }
      card.appendChild(list);
      mount(unresolvedCtn, card);
    }

    function edgeLine(edge) {
      const line = el("div.pu-test-row");
      line.appendChild(el("span.pu-chip", { text: edge.origin || "auto" }));
      line.appendChild(el("span.pu-small", { text: edge.label }));
      line.appendChild(el("span.pu-muted", { text: "→" }));
      line.appendChild(el("span", { text: edge.toName }));
      line.appendChild(el("span.pu-ref", { text: `${edge.toType}:${edge.toId}` }));
      if (edge.raw) line.appendChild(el("span.pu-small.pu-muted", { text: `from “${edge.raw}”` }));
      if (edge.confidence != null && edge.confidence < 1) line.appendChild(el("span.pu-chip.warn", { text: `${Math.round(edge.confidence * 100)}%` }));
      return line;
    }

    function incomingLine(edge) {
      const line = el("div.pu-test-row");
      line.appendChild(el("span.pu-chip", { text: edge.origin || "auto" }));
      line.appendChild(el("span.pu-small", { text: edge.inverseLabel || "Referenced by" }));
      line.appendChild(el("span.pu-muted", { text: "←" }));
      line.appendChild(el("span", { text: edge.fromName }));
      line.appendChild(el("span.pu-ref", { text: `${edge.fromType}:${edge.fromId}` }));
      return line;
    }

    function renderExplorer() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Link explorer" }));
      card.appendChild(el("p.pu-small", { text: "Follow the graph from any record: outgoing references it declares and incoming references that point back at it." }));
      const tabs = el("div.pu-tabs", { style: { "margin-top": "0.6rem" } });
      for (const type of hub.registry.entityTypes) {
        const tab = el("button.pu-tab", { type: "button" });
        tab.appendChild(el("span", { text: type.plural }));
        tab.appendChild(el("span.pu-tab-count", { text: String(hub.identity.count(type.id)) }));
        tab.addEventListener("click", () => {
          state.type = type.id;
          renderExplorer();
        });
        if (type.id === state.type) tab.classList.add("active");
        tabs.appendChild(tab);
      }
      card.appendChild(tabs);
      const list = el("div", { style: { "margin-top": "0.6rem" } });
      const entities = hub.identity.all(state.type).slice().sort((a, b) => hub.identity.nameOf(state.type, a).localeCompare(hub.identity.nameOf(state.type, b)));
      for (const entity of entities) {
        const edges = hub.linker.edgesFor(state.type, entity.id);
        if (!edges.outgoing.length && !edges.incoming.length) continue;
        const details = el("details.pu-details");
        const summary = el("summary");
        summary.appendChild(el("span.pu-mono.pu-id", { text: entity.id }));
        summary.appendChild(el("span.pu-entity-name", { text: hub.identity.nameOf(state.type, entity) }));
        summary.appendChild(el("span.pu-chip", { text: `${edges.outgoing.length + edges.incoming.length} links` }));
        details.appendChild(summary);
        const body = el("div.pu-details-body");
        if (edges.outgoing.length) {
          body.appendChild(el("h3", { text: "Outgoing" }));
          for (const edge of edges.outgoing) body.appendChild(edgeLine(edge));
        }
        if (edges.incoming.length) {
          body.appendChild(el("h3", { style: { "margin-top": "0.6rem" }, text: "Incoming" }));
          for (const edge of edges.incoming) body.appendChild(incomingLine(edge));
        }
        details.appendChild(body);
        list.appendChild(details);
      }
      if (!list.children.length) list.appendChild(el("div.pu-empty", { text: "No links touch these records yet." }));
      card.appendChild(list);
      mount(explorerCtn, card);
    }

    function renderAll() {
      renderStats();
      renderMatrix();
      renderUnresolved();
      renderExplorer();
    }

    const toolbar = el("div.pu-toolbar");
    const rebuildBtn = el("button.pu-btn.secondary", { type: "button", text: "Rebuild link graph" });
    rebuildBtn.addEventListener("click", async () => {
      rebuildBtn.disabled = true;
      rebuildBtn.textContent = "Rebuilding…";
      const result = await hub.linker.rebuild();
      toast(`Rebuilt ${result.created} links (${result.removed} replaced, ${result.pruned} pruned)`, { tone: "success" });
      rebuildBtn.disabled = false;
      rebuildBtn.textContent = "Rebuild link graph";
      renderAll();
    });
    toolbar.appendChild(rebuildBtn);

    root.appendChild(
      pageHead({
        eyebrow: "Linking",
        title: "Entity links",
        subtitle: "A device in RMM-U, a ticket in PSA-U and an invoice in PSA-U all point at the same canonical company. The hub resolves every declared reference into an edge, so data is linked rather than duplicated.",
      })
    );
    root.appendChild(toolbar);
    root.appendChild(statsCtn);
    root.appendChild(matrixCtn);
    root.appendChild(unresolvedCtn);
    root.appendChild(explorerCtn);

    renderAll();
    return root;
  },
};
