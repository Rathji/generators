import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";

function secondaryFor(typeId, entity) {
  const f = entity.fields || {};
  if (typeId === "company") return f.domain || f.city || "";
  if (typeId === "customer") return f.email || f.company || "";
  if (typeId === "device") return [f.serial, f.os].filter(Boolean).join(" · ");
  if (typeId === "ticket") return [f.status, f.priority].filter(Boolean).join(" · ");
  if (typeId === "invoice") return f.amount != null ? `${f.status || ""} · ${f.amount}` : f.status || "";
  return "";
}

function confirmButton(button, label, action) {
  let armed = false;
  let timer = null;
  button.addEventListener("click", async () => {
    if (!armed) {
      armed = true;
      button.textContent = "Click again to confirm";
      timer = setTimeout(() => {
        armed = false;
        button.textContent = label;
      }, 3200);
      return;
    }
    clearTimeout(timer);
    button.disabled = true;
    await action();
  });
  return button;
}

export const identityView = {
  id: "identity",
  title: "Canonical identity",
  group: "Data",
  icon: "id",
  nav: true,
  render({ hub }) {
    const root = el("div");
    const entityTypes = hub.registry.entityTypes;
    const state = { query: "", type: entityTypes[0].id };

    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const dupCtn = el("div");
    const listCtn = el("div");

    const searchInput = el("input.pu-input", {
      type: "search",
      placeholder: "Search names, IDs, domains, emails, references…",
      "aria-label": "Search canonical identities",
      on: {
        input: (event) => {
          state.query = event.target.value;
          renderList();
        },
      },
    });

    const tabs = el("div.pu-tabs", { role: "tablist" });
    for (const type of entityTypes) {
      const tab = el("button.pu-tab", { type: "button", role: "tab" });
      tab.appendChild(el("span", { text: type.plural }));
      tab.appendChild(el("span.pu-tab-count", { text: String(hub.identity.count(type.id)) }));
      tab.addEventListener("click", () => {
        state.type = type.id;
        renderList();
        renderTabs();
      });
      tab.dataset.type = type.id;
      tabs.appendChild(tab);
    }

    function renderTabs() {
      for (const tab of tabs.children) {
        const active = tab.dataset.type === state.type;
        tab.setAttribute("aria-selected", active ? "true" : "false");
        tab.classList.toggle("active", active);
      }
    }

    function statCard(label, value, hint) {
      const card = el("article.pu-card.pu-stat");
      card.appendChild(el("span.pu-stat-label", { text: label }));
      card.appendChild(el("span.pu-stat-value", { text: String(value) }));
      if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
      return card;
    }

    function renderStats() {
      const s = hub.identity.stats();
      mount(
        statsCtn,
        statCard("Directory records", s.total, "across all connectors"),
        statCard("Companies", s.byType.company || 0, "canonical company identities"),
        statCard("Customers", s.byType.customer || 0, "canonical customer identities"),
        statCard("Linked references", s.refs, `${s.sources} source systems`)
      );
    }

    function renderDuplicates() {
      const duplicates = hub.identity.findDuplicates();
      mount(dupCtn);
      if (!duplicates.length) return;
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: `Possible duplicates (${duplicates.length})` }));
      card.appendChild(el("p.pu-small", { text: "These records did not share a strong natural key, so they were kept apart. Merging keeps one canonical ID and records the other as a duplicate." }));
      const list = el("div", { style: { "margin-top": "0.6rem" } });
      for (const dup of duplicates) {
        const typeDef = entityTypes.find((t) => t.id === dup.type);
        const keep = hub.identity.get(dup.type, dup.keepId);
        const drop = hub.identity.get(dup.type, dup.dropId);
        if (!keep || !drop) continue;
        const row = el("div.pu-test-row");
        row.appendChild(el("span", { class: "pu-chip", text: typeDef.label }));
        row.appendChild(el("span.pu-test-name", { text: `${hub.identity.nameOf(dup.type, keep)} + ${hub.identity.nameOf(dup.type, drop)}` }));
        row.appendChild(el("span.pu-small.pu-muted", { text: dup.reason }));
        const mergeBtn = el("button.pu-btn.secondary", { type: "button", text: "Merge", "data-permission": "identity.merge", "data-mutating": "" });
        mergeBtn.addEventListener("click", async () => {
          mergeBtn.disabled = true;
          await hub.merge(dup.type, dup.keepId, dup.dropId, { confidence: dup.confidence });
          toast(`Merged into ${dup.keepId}`, { tone: "success" });
          renderAll();
        });
        row.appendChild(mergeBtn);
        list.appendChild(row);
      }
      card.appendChild(list);
      dupCtn.appendChild(card);
    }

    function fieldTable(typeId, entity) {
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Field", "Value", "Provided by", "Registry owner"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      const rows = Object.entries(entity.fields || {});
      for (const [key, value] of rows) {
        const field = hub.registry.field(typeId, key);
        const source = entity.fieldSources?.[key] || "—";
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("span.pu-small", { text: field ? field.label : key }), el("div.pu-mono.pu-muted", { text: key })));
        tr.appendChild(el("td", { text: String(value) }));
        tr.appendChild(el("td", {}, el("span.pu-ref", { text: source })));
        const ownerCell = el("td");
        if (field) {
          const connector = hub.registry.connector(field.owner);
          ownerCell.appendChild(el("span.pu-ref", { text: connector ? connector.name : field.owner }));
          if (field.owner !== source) ownerCell.appendChild(el("span.pu-chip.warn", { text: "awaiting owner value" }));
        } else {
          ownerCell.appendChild(el("span.pu-muted.pu-small", { text: "unregistered field" }));
        }
        tr.appendChild(ownerCell);
        tbody.appendChild(tr);
      }
      if (!rows.length) {
        const tr = el("tr");
        tr.appendChild(el("td", { colspan: "4", text: "No field values yet." }));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      const wrap = el("div.pu-table-scroll");
      wrap.appendChild(table);
      return wrap;
    }

    function entityRow(typeDef, entity) {
      const details = el("details.pu-details");
      const summary = el("summary");
      summary.appendChild(el("span.pu-mono.pu-id", { text: entity.id }));
      summary.appendChild(el("span.pu-entity-name", { text: hub.identity.nameOf(typeDef.id, entity) }));
      const secondary = secondaryFor(typeDef.id, entity);
      if (secondary) summary.appendChild(el("span.pu-muted.pu-small", { text: secondary }));
      const refs = el("span.pu-refs");
      for (const ref of entity.refs || []) refs.appendChild(el("span.pu-ref", { text: `${ref.connector}:${ref.nativeId}` }));
      summary.appendChild(refs);
      details.appendChild(summary);

      const body = el("div.pu-details-body");
      body.appendChild(fieldTable(typeDef.id, entity));

      const meta = el("dl.pu-kv", { style: { "margin-top": "0.6rem" } });
      meta.appendChild(el("dt", { text: "Natural keys" }));
      meta.appendChild(el("dd", {}, ...(entity.keys || []).map((key) => el("span.pu-ref", { text: key }))));
      meta.appendChild(el("dt", { text: "References" }));
      meta.appendChild(el("dd", { text: (entity.refs || []).map((r) => `${r.connector}:${r.nativeId}`).join(", ") || "—" }));
      if (entity.aliases?.length) {
        meta.appendChild(el("dt", { text: "Also known as" }));
        meta.appendChild(el("dd", { text: entity.aliases.join(", ") }));
      }
      if (entity.mergedFrom?.length) {
        meta.appendChild(el("dt", { text: "Merged duplicates" }));
        meta.appendChild(el("dd", { text: entity.mergedFrom.map((m) => `${m.displayName} (${m.id})`).join(", ") }));
      }
      meta.appendChild(el("dt", { text: "Created" }));
      meta.appendChild(el("dd", { text: entity.createdAt || "—" }));
      body.appendChild(meta);

      details.appendChild(body);
      return details;
    }

    function renderList() {
      mount(listCtn);
      const typeDef = entityTypes.find((t) => t.id === state.type);
      const results = hub.identity.search(state.query, { type: state.type });
      results.sort((a, b) => hub.identity.nameOf(state.type, a).localeCompare(hub.identity.nameOf(state.type, b)));

      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: `${typeDef.plural} (${results.length})` }));
      card.appendChild(el("p.pu-small", { text: `Canonical ${typeDef.label.toLowerCase()} identities are matched by ${typeDef.naturalKeys.join(", ")}.` }));
      const list = el("div", { style: { "margin-top": "0.6rem" } });
      for (const entity of results) list.appendChild(entityRow(typeDef, entity));
      if (!results.length) {
        list.appendChild(el("div.pu-empty", { text: state.query ? "No records match that search." : "No records yet — run the demo import." }));
      }
      card.appendChild(list);
      listCtn.appendChild(card);
    }

    function renderAll() {
      renderStats();
      renderDuplicates();
      renderTabs();
      renderList();
    }

    const toolbar = el("div.pu-toolbar");
    const reseedBtn = el("button.pu-btn.secondary", { type: "button", text: "Re-run demo import", "data-permission": "identity.write", "data-mutating": "" });
    reseedBtn.addEventListener("click", async () => {
      reseedBtn.disabled = true;
      await hub.seed();
      toast("Demo connectors re-imported", { tone: "success" });
      reseedBtn.disabled = false;
      renderAll();
    });
    const resetBtn = confirmButton(el("button.pu-btn.secondary", { type: "button", text: "Reset hub data", "data-permission": "settings.manage", "data-mutating": "" }), "Reset hub data", async () => {
      await hub.resetData();
      toast("Hub data reset and re-seeded", { tone: "success" });
      renderAll();
    });
    toolbar.appendChild(searchInput);
    toolbar.appendChild(reseedBtn);
    toolbar.appendChild(resetBtn);

    root.appendChild(
      pageHead({
        eyebrow: "Data",
        title: "Canonical identity",
        subtitle: "One shared identifier per real-world company, customer, device, ticket and invoice — derived deterministically so every tool resolves the same record, even before the hub sees it.",
      })
    );
    root.appendChild(toolbar);
    root.appendChild(statsCtn);
    root.appendChild(dupCtn);
    root.appendChild(tabs);
    root.appendChild(listCtn);

    renderAll();
    return root;
  },
};
