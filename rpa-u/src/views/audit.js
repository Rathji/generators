import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";

const DIRECTION_LABEL = { in: "inbound", out: "outbound", internal: "internal" };
const DIRECTION_CLASS = { in: "ok", out: "warn", internal: "" };

function statCard(label, value, hint) {
  const card = el("article.pu-card.pu-stat");
  card.appendChild(el("span.pu-stat-label", { text: label }));
  card.appendChild(el("span.pu-stat-value", { text: String(value) }));
  if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
  return card;
}

function timeOf(value, { long = false } = {}) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return long
    ? date.toLocaleString([], { year: "numeric", month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" })
    : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export const auditView = {
  id: "audit",
  title: "Audit log",
  group: "Output",
  icon: "audit",
  nav: true,
  render({ hub }) {
    const root = el("div");
    const state = { text: "", action: "", connector: "", entityType: "", direction: "", expanded: new Set() };
    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const tableCtn = el("div");
    const lifecycleCtn = el("div");
    const order = { value: "desc" };

    function refresh() {
      hub.audit.refresh().then(() => renderAll());
    }

    function renderStats() {
      const s = hub.audit.stats();
      mount(
        statsCtn,
        statCard("Audit entries", s.total, `seq ${s.lastSeq} · immutable ledger`),
        statCard("Inbound movements", s.inbound, `${s.outbound} outbound`),
        statCard("Chain integrity", s.chain.ok ? "verified" : "broken", s.chain.ok ? `${s.chain.checked} links checked` : `fails at ${s.chain.brokenAt}`),
        statCard("Last recorded", s.total ? timeOf(hub.audit.all()[hub.audit.all().length - 1]?.at) : "—", "newest at the bottom")
      );
    }

    function filters() {
      return {
        text: state.text,
        action: state.action || null,
        connector: state.connector || null,
        entityType: state.entityType || null,
        direction: state.direction || null,
        order: order.value,
      };
    }

    function controls() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Filter the ledger" }));
      head.appendChild(el("span.pu-chip", { text: `${hub.audit.filter(filters()).length} shown` }));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "The audit log is derived from the validated event stream and stored as a hash-chained ledger, so entries survive event-log pruning and any tampering is detectable. Filter by action, connector, entity type or direction, or search the summaries.",
        })
      );

      const facets = hub.audit.facets();
      const row = el("div.pu-form-row", { style: { "margin-top": "0.75rem" } });

      const search = el("input.pu-input", {
        type: "search",
        placeholder: "Search summaries, entities, actors…",
        "aria-label": "Search audit log",
        value: state.text,
        on: {
          input: (event) => {
            state.text = event.target.value;
            renderTable();
          },
        },
      });

      const actionSelect = el("select.pu-select", { "aria-label": "Filter by action" });
      actionSelect.appendChild(el("option", { value: "", text: "All actions" }));
      for (const facet of facets.actions) actionSelect.appendChild(el("option", { value: facet.value, text: `${facet.value} (${facet.count})` }));
      actionSelect.value = state.action;
      actionSelect.addEventListener("change", () => {
        state.action = actionSelect.value;
        renderTable();
      });

      const connectorSelect = el("select.pu-select", { "aria-label": "Filter by connector" });
      connectorSelect.appendChild(el("option", { value: "", text: "All connectors" }));
      for (const facet of facets.connectors) connectorSelect.appendChild(el("option", { value: facet.value, text: `${facet.value} (${facet.count})` }));
      connectorSelect.value = state.connector;
      connectorSelect.addEventListener("change", () => {
        state.connector = connectorSelect.value;
        renderTable();
      });

      const typeSelect = el("select.pu-select", { "aria-label": "Filter by entity type" });
      typeSelect.appendChild(el("option", { value: "", text: "All entity types" }));
      for (const type of hub.registry.entityTypes) typeSelect.appendChild(el("option", { value: type.id, text: type.plural }));
      typeSelect.appendChild(el("option", { value: "bundle", text: "Bundles" }));
      typeSelect.value = state.entityType;
      typeSelect.addEventListener("change", () => {
        state.entityType = typeSelect.value;
        renderTable();
      });

      const directionSelect = el("select.pu-select", { "aria-label": "Filter by direction" });
      directionSelect.appendChild(el("option", { value: "", text: "All directions" }));
      for (const direction of ["in", "out", "internal"]) directionSelect.appendChild(el("option", { value: direction, text: DIRECTION_LABEL[direction] }));
      directionSelect.value = state.direction;
      directionSelect.addEventListener("change", () => {
        state.direction = directionSelect.value;
        renderTable();
      });

      const orderSelect = el("select.pu-select", { "aria-label": "Sort order" });
      orderSelect.appendChild(el("option", { value: "desc", text: "Newest first" }));
      orderSelect.appendChild(el("option", { value: "asc", text: "Oldest first" }));
      orderSelect.value = order.value;
      orderSelect.addEventListener("change", () => {
        order.value = orderSelect.value;
        renderTable();
      });

      const resetBtn = el("button.pu-btn.secondary", { type: "button", text: "Reset filters" });
      resetBtn.addEventListener("click", () => {
        state.text = "";
        state.action = "";
        state.connector = "";
        state.entityType = "";
        state.direction = "";
        order.value = "desc";
        renderControls();
        renderTable();
      });

      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Search" }), search));
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Action" }), actionSelect));
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Connector" }), connectorSelect));
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Entity type" }), typeSelect));
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Direction" }), directionSelect));
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Order" }), orderSelect));
      card.appendChild(row);
      card.appendChild(el("div", { style: { "margin-top": "0.6rem", display: "flex", gap: "0.5rem", "flex-wrap": "wrap" } }, resetBtn));
      return card;
    }

    function entryRow(entry) {
      const tr = el("tr");
      tr.appendChild(el("td", {}, el("span.pu-mono.pu-id", { text: `#${entry.seq}` })));
      tr.appendChild(el("td", {}, el("div", { text: timeOf(entry.at) }), el("span.pu-small.pu-muted", { text: timeOf(entry.at, { long: true }).split(", ")[0] })));
      tr.appendChild(el("td", {}, el("div", { text: entry.actionLabel }), el("span.pu-mono.pu-small.pu-muted", { text: entry.type })));
      tr.appendChild(
        el("td", {},
          el("div", { text: entry.entityName || entry.entityId || "—" }),
          entry.entityType ? el("span.pu-mono.pu-small.pu-muted", { text: `${entry.entityType}:${entry.entityId}` }) : null
        )
      );
      tr.appendChild(el("td", {}, el("span.pu-chip", { class: DIRECTION_CLASS[entry.direction] || "", text: DIRECTION_LABEL[entry.direction] || entry.direction }), entry.movement ? el("span.pu-small.pu-muted", { text: ` ${entry.movement.from} → ${entry.movement.to}` }) : null));
      tr.appendChild(el("td", {}, el("span.pu-ref", { text: entry.source })));
      tr.appendChild(el("td", {}, el("span.pu-small", { text: entry.summary })));
      const detailCell = el("td");
      const toggle = el("button.pu-btn.secondary", { type: "button", text: state.expanded.has(entry.id) ? "Hide" : "Details" });
      detailCell.appendChild(toggle);
      tr.appendChild(detailCell);

      const detailRow = el("tr");
      detailRow.hidden = !state.expanded.has(entry.id);
      const td = el("td", { colspan: 8 });
      td.appendChild(el("pre.pu-code", { style: { "max-height": "16rem", overflow: "auto" }, text: JSON.stringify(entry.payload, null, 2) }));
      const chain = el("p.pu-small.pu-muted", { style: { "margin-top": "0.4rem" } });
      chain.appendChild(el("span.pu-mono.pu-small", { text: `hash ${entry.hash} · prev ${entry.prevHash || "genesis"}` }));
      if (entry.field) chain.appendChild(el("span", { text: ` · field ${entry.field}` }));
      chain.appendChild(el("span", { text: ` · actor ${entry.actor}` }));
      td.appendChild(chain);
      detailRow.appendChild(td);

      toggle.addEventListener("click", () => {
        const nowOpen = !state.expanded.has(entry.id);
        if (nowOpen) state.expanded.add(entry.id);
        else state.expanded.delete(entry.id);
        detailRow.hidden = !nowOpen;
        toggle.textContent = nowOpen ? "Hide" : "Details";
      });
      return [tr, detailRow];
    }

    function renderTable() {
      const entries = hub.audit.filter(filters());
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Ledger entries" }));
      head.appendChild(el("span.pu-chip", { text: `${entries.length} entries` }));
      card.appendChild(head);
      card.appendChild(el("p.pu-small", { text: "Every cross-tool movement and modification is stamped with its actor, source connector, subject entity and a hash linking it to the entry before it." }));

      if (!entries.length) {
        card.appendChild(el("div.pu-empty", { text: hub.audit.all().length ? "No entries match the current filter." : "Nothing recorded yet — publish an event, run a sync, or record a note." }));
        mount(tableCtn, card);
        return;
      }

      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Seq", "When", "Action", "Entity", "Direction", "Source", "Summary", ""]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const entry of entries) {
        for (const row of entryRow(entry)) tbody.appendChild(row);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
      mount(tableCtn, card);
    }

    function buildLifecycle() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Entity lifecycle" }));
      card.appendChild(el("p.pu-small", { text: "Trace one record across every tool that touched it: when it arrived, who changed it, which fields moved, and where it went." }));

      const typeSelect = el("select.pu-select", { "aria-label": "Lifecycle entity type" });
      for (const type of hub.registry.entityTypes) typeSelect.appendChild(el("option", { value: type.id, text: type.plural }));
      const entitySelect = el("select.pu-select", { "aria-label": "Lifecycle entity" });

      function syncEntities() {
        mount(entitySelect);
        for (const entity of hub.identity.all(typeSelect.value)) {
          entitySelect.appendChild(el("option", { value: entity.id, text: `${hub.identity.nameOf(typeSelect.value, entity)} — ${entity.id}` }));
        }
      }
      typeSelect.addEventListener("change", syncEntities);
      syncEntities();

      const traceBtn = el("button.pu-btn", { type: "button", text: "Trace lifecycle" });
      const row = el("div.pu-form-row", { style: { "margin-top": "0.75rem" } });
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Entity type" }), typeSelect));
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Record" }), entitySelect));
      card.appendChild(row);
      card.appendChild(el("div", { style: { "margin-top": "0.6rem" } }, traceBtn));

      const output = el("div", { style: { "margin-top": "0.75rem" } });
      card.appendChild(output);

      function trace() {
        const typeId = typeSelect.value;
        const entityId = entitySelect.value;
        const life = hub.audit.lifecycle(typeId, entityId);
        mount(output);
        if (!life.count) {
          output.appendChild(el("div.pu-empty", { text: "No audit entries reference this record yet." }));
          return;
        }
        const meta = el("div", { style: { display: "flex", gap: "0.4rem", "flex-wrap": "wrap", "margin-bottom": "0.6rem" } });
        meta.appendChild(el("span.pu-chip.ok", { text: `${life.count} events` }));
        meta.appendChild(el("span.pu-chip", { text: `${life.actions.length} action types` }));
        if (life.connectors.length) meta.appendChild(el("span.pu-chip", { text: `via ${life.connectors.join(", ")}` }));
        if (life.fields.length) meta.appendChild(el("span.pu-chip", { text: `fields ${life.fields.join(", ")}` }));
        meta.appendChild(el("span.pu-small.pu-muted", { text: `${timeOf(life.firstAt, { long: true })} → ${timeOf(life.lastAt, { long: true })}` }));
        output.appendChild(meta);
        const list = el("ul.pu-list");
        for (const entry of life.entries) {
          const li = el("li");
          li.appendChild(el("span.pu-mono.pu-id", { text: `#${entry.seq}` }));
          li.appendChild(el("span.pu-chip", { class: DIRECTION_CLASS[entry.direction] || "", text: entry.actionLabel }));
          li.appendChild(el("span.pu-small", { text: entry.summary }));
          li.appendChild(el("span.pu-small.pu-muted", { text: `${entry.source} · ${timeOf(entry.at, { long: true })}` }));
          list.appendChild(li);
        }
        output.appendChild(list);
      }
      traceBtn.addEventListener("click", trace);
      trace();
      return card;
    }

    function buildIntegrity() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Ledger integrity" }));
      card.appendChild(el("p.pu-small", { text: "Each entry hashes the one before it. Re-running the chain proves no stored entry was edited, reordered or removed after it was written." }));
      const output = el("div", { style: { "margin-top": "0.6rem" } });
      const verifyBtn = el("button.pu-btn", { type: "button", text: "Verify chain" });
      verifyBtn.addEventListener("click", () => {
        const result = hub.audit.verify();
        mount(
          output,
          el("div.pu-alert", { class: result.ok ? "ok" : "fail", text: result.ok ? `Chain intact — ${result.checked} entries verified.` : `Chain broken at ${result.brokenAt} (seq ${result.seq}).` })
        );
      });
      card.appendChild(verifyBtn);
      card.appendChild(output);

      const noteRow = el("div.pu-form-grid", { style: { "margin-top": "1rem" } });
      const noteArea = el("textarea.pu-input.pu-textarea", { rows: 2, placeholder: "Record a manual note against the integration log…", "aria-label": "Audit note" });
      const actorInput = el("input.pu-input", { type: "text", value: "operator", "aria-label": "Note actor" });
      const noteBtn = el("button.pu-btn", { type: "button", text: "Record note", "data-permission": "audit.write", "data-mutating": "" });
      noteRow.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Note" }), noteArea));
      noteRow.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Actor" }), actorInput));
      noteRow.appendChild(el("div", {}, noteBtn));
      noteBtn.addEventListener("click", async () => {
        noteBtn.disabled = true;
        try {
          const result = await hub.audit.note({ message: noteArea.value, actor: actorInput.value.trim() || "operator" });
          if (!result.ok) {
            toast(result.error, { tone: "error" });
            return;
          }
          noteArea.value = "";
          toast("Note recorded on the audit ledger", { tone: "success" });
          renderAll();
        } finally {
          noteBtn.disabled = false;
        }
      });
      card.appendChild(noteRow);
      return card;
    }

    let controlsCtn = el("div");
    function renderControls() {
      mount(controlsCtn, controls());
    }

    function renderAll() {
      renderStats();
      renderControls();
      renderTable();
    }

    root.appendChild(
      pageHead({
        eyebrow: "Governance",
        title: "Audit log",
        subtitle: "An immutable, filterable record of every cross-tool data movement and modification — inbound imports, outbound bundles, sync writes, conflicts and operator notes.",
      })
    );
    root.appendChild(statsCtn);
    root.appendChild(controlsCtn);
    root.appendChild(tableCtn);
    root.appendChild(buildLifecycle());
    root.appendChild(buildIntegrity());

    renderAll();
    refresh();
    return root;
  },
};
