import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";

const DIRECTION_LABELS = {
  push: "Push",
  pull: "Pull",
  bidirectional: "Two-way",
  none: "Not synced",
};

export const registryView = {
  id: "registry",
  title: "Integration registry",
  group: "Data",
  icon: "layers",
  nav: true,
  render({ hub }) {
    const registry = hub.registry;
    const root = el("div");
    const state = { type: registry.entityTypes[0].id };

    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const connectorsCtn = el("div.pu-grid.cols-2", { style: { "margin-bottom": "1rem" } });
    const validationCtn = el("div", { style: { "margin-bottom": "1rem" } });
    const fieldsCtn = el("div");

    function statCard(label, value, hint) {
      const card = el("article.pu-card.pu-stat");
      card.appendChild(el("span.pu-stat-label", { text: label }));
      card.appendChild(el("span.pu-stat-value", { text: String(value) }));
      if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
      return card;
    }

    function renderStats() {
      const s = registry.stats();
      mount(
        statsCtn,
        statCard("Connectors", s.connectorCount, "registered members"),
        statCard("Entity types", s.entityTypeCount, "shared record kinds"),
        statCard("Tracked fields", s.fieldCount, `${s.authoritativeCount} authoritative`),
        statCard("Sync directions", s.directions, "push · pull · two-way · none")
      );
    }

    function renderConnectors() {
      mount(connectorsCtn);
      for (const connector of registry.connectors) {
        const card = el("section.pu-card");
        const head = el("div", { style: { display: "flex", "align-items": "center", gap: "0.6rem", "flex-wrap": "wrap" } });
        head.appendChild(el("span.pu-swatch", { style: { background: connector.accent } }));
        head.appendChild(el("h2", { style: { margin: "0" }, text: connector.name }));
        if (connector.hub) head.appendChild(el("span.pu-chip", { text: "hub" }));
        head.appendChild(el("span.pu-chip", { text: `${registry.fieldsOwnedBy(connector.id).length} owned fields` }));
        card.appendChild(head);
        card.appendChild(el("p.pu-small", { text: connector.label }));

        const typeRow = el("div", { style: { display: "flex", gap: "0.35rem", "flex-wrap": "wrap", "margin-top": "0.5rem" } });
        for (const typeId of connector.entityTypes) {
          const typeDef = registry.entityType(typeId);
          typeRow.appendChild(el("span.pu-chip", { text: typeDef ? typeDef.label : typeId }));
        }
        card.appendChild(typeRow);

        const owned = registry.fieldsOwnedBy(connector.id).slice(0, 5);
        if (owned.length) {
          const list = el("ul.pu-list", { style: { "margin-top": "0.6rem" } });
          for (const field of owned) {
            const typeDef = registry.entityType(field.entityType);
            list.appendChild(
              el("li", {}, el("span.pu-small", { text: `${typeDef.label} · ${field.label}` }), el("span.pu-chip", { text: DIRECTION_LABELS[field.direction] || field.direction }))
            );
          }
          card.appendChild(list);
        }
        connectorsCtn.appendChild(card);
      }
    }

    function renderValidation() {
      const report = registry.validate();
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Registry validation" }));
      head.appendChild(el("span", { class: report.ok ? "pu-chip ok" : "pu-chip fail", text: report.ok ? "No errors" : `${report.counts.error} errors` }));
      if (report.counts.warn) head.appendChild(el("span.pu-chip.warn", { text: `${report.counts.warn} warnings` }));
      card.appendChild(head);
      card.appendChild(el("p.pu-small", { text: "Every field must have exactly one owner, an owner that declares the entity type, and a valid sync direction." }));

      const list = el("ul.pu-list", { style: { "margin-top": "0.6rem" } });
      if (!report.issues.length) {
        list.appendChild(el("li", {}, el("span.pu-chip.ok", { text: "ok" }), el("span.pu-small", { text: "The integration registry is internally consistent." })));
      }
      for (const issue of report.issues) {
        const row = el("li");
        row.appendChild(el("span", { class: issue.level === "error" ? "pu-chip fail" : "pu-chip warn", text: issue.level }));
        row.appendChild(el("span.pu-small", { text: issue.message }));
        row.appendChild(el("span.pu-ref", { text: issue.ref || "" }));
        list.appendChild(row);
      }
      card.appendChild(list);
      validationCtn.appendChild(card);
    }

    function renderFields() {
      mount(fieldsCtn);
      const typeDef = registry.entityType(state.type);

      const tabs = el("div.pu-tabs", { role: "tablist" });
      for (const type of registry.entityTypes) {
        const tab = el("button.pu-tab", { type: "button", role: "tab", text: type.plural });
        tab.classList.toggle("active", type.id === state.type);
        tab.setAttribute("aria-selected", type.id === state.type ? "true" : "false");
        tab.addEventListener("click", () => {
          state.type = type.id;
          renderFields();
        });
        tabs.appendChild(tab);
      }
      fieldsCtn.appendChild(tabs);

      const card = el("section.pu-card", { style: { "margin-top": "1rem" } });
      card.appendChild(el("h2", { text: `${typeDef.label} field ownership` }));
      card.appendChild(el("p.pu-small", { text: "Only the owning connector writes a field; everybody else reads it. Sync direction describes how the value reaches the hub." }));

      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Field", "Authoritative source", "Authoritative?", "Sync direction", "Who may write"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);

      const tbody = el("tbody");
      for (const field of registry.fieldsFor(state.type)) {
        const connector = registry.connector(field.owner);
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("span", { text: field.label }), el("div.pu-mono.pu-muted", { text: field.key })));
        tr.appendChild(el("td", {}, el("span.pu-ref", { text: connector ? connector.name : field.owner })));
        tr.appendChild(el("td", {}, el("span", { class: field.authoritative ? "pu-chip ok" : "pu-chip", text: field.authoritative ? "yes" : "no" })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { text: DIRECTION_LABELS[field.direction] || field.direction })));
        tr.appendChild(el("td", { text: connector ? connector.name : field.owner }));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      const scroll = el("div.pu-table-scroll");
      scroll.appendChild(table);
      card.appendChild(scroll);
      fieldsCtn.appendChild(card);
    }

    root.appendChild(
      pageHead({
        eyebrow: "Data",
        title: "Integration registry",
        subtitle: "The single declaration of who owns what. Each connector's fields are listed with their authoritative source and sync direction, so the hub never has to guess which tool is right.",
      })
    );
    root.appendChild(statsCtn);
    root.appendChild(connectorsCtn);
    root.appendChild(validationCtn);
    root.appendChild(fieldsCtn);

    renderStats();
    renderConnectors();
    renderValidation();
    renderFields();
    return root;
  },
};
