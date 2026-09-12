import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";

export const permissionsView = {
  id: "permissions",
  title: "Permission mapping",
  group: "Data",
  icon: "shield",
  nav: true,
  render({ hub }) {
    const permissions = hub.permissions;
    const root = el("div");
    const capLabel = new Map(permissions.capabilities.map((c) => [c.id, c.label]));

    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const rolesCtn = el("div.pu-grid.cols-2", { style: { "margin-bottom": "1rem" } });
    const mappingsCtn = el("div", { style: { "margin-bottom": "1rem" } });
    const checkerCtn = el("div");

    function statCard(label, value, hint) {
      const card = el("article.pu-card.pu-stat");
      card.appendChild(el("span.pu-stat-label", { text: label }));
      card.appendChild(el("span.pu-stat-value", { text: String(value) }));
      if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
      return card;
    }

    function renderStats() {
      const s = permissions.stats();
      mount(
        statsCtn,
        statCard("Canonical roles", s.roleCount, "shared across every tool"),
        statCard("Capabilities", s.capabilityCount, "permissions the hub understands"),
        statCard("Role mappings", s.mappingCount, `from ${s.mappedConnectors} connectors`),
        statCard("Unused roles", s.unusedRoles.length, s.unusedRoles.join(", ") || "every role is mapped")
      );
    }

    function renderRoles() {
      mount(rolesCtn);
      for (const [roleId, role] of Object.entries(permissions.roles)) {
        const card = el("section.pu-card");
        const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
        head.appendChild(el("h2", { style: { margin: "0" }, text: role.label }));
        head.appendChild(el("span.pu-ref", { text: roleId }));
        head.appendChild(el("span.pu-chip", { text: `${role.capabilities.length} caps` }));
        card.appendChild(head);
        card.appendChild(el("p.pu-small", { text: role.description }));
        const caps = el("div", { style: { display: "flex", gap: "0.3rem", "flex-wrap": "wrap", "margin-top": "0.4rem" } });
        const shown = role.capabilities.slice(0, 6);
        for (const cap of shown) caps.appendChild(el("span.pu-chip", { text: capLabel.get(cap) || cap }));
        if (role.capabilities.length > shown.length) caps.appendChild(el("span.pu-chip", { text: `+${role.capabilities.length - shown.length} more` }));
        card.appendChild(caps);
        rolesCtn.appendChild(card);
      }
    }

    function renderMappings() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Tool role mapping" }));
      card.appendChild(el("p.pu-small", { text: "Each connector keeps its own role names. The hub translates them into canonical roles so a permission question has one answer everywhere." }));
      const table = el("table.pu-table");
      const headRow = el("tr");
      for (const label of ["Connector", "Tool role", "Canonical role", "Capabilities"]) headRow.appendChild(el("th", { text: label }));
      const thead = el("thead");
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const mapping of permissions.mappings()) {
        const connector = hub.registry.connector(mapping.connector);
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("span.pu-ref", { text: connector ? connector.name : mapping.connector })));
        tr.appendChild(el("td", { text: mapping.toolRole }));
        tr.appendChild(el("td", {}, ...mapping.canonicalRoles.map((roleId) => el("span.pu-chip", { text: permissions.roles[roleId]?.label || roleId }))));
        const caps = permissions.capabilitiesFor(mapping.canonicalRoles);
        tr.appendChild(el("td", { text: String(caps.size) }));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      const scroll = el("div.pu-table-scroll");
      scroll.appendChild(table);
      card.appendChild(scroll);
      mappingsCtn.appendChild(card);
    }

    function renderChecker() {
      mount(checkerCtn);
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Permission checker" }));
      card.appendChild(el("p.pu-small", { text: "Pick a connector and one of its tool roles, then ask whether it can perform an action." }));

      const connectorSelect = el("select.pu-select", { "aria-label": "Connector" });
      for (const connector of hub.registry.connectors) {
        connectorSelect.appendChild(el("option", { value: connector.id, text: connector.name }));
      }
      const roleSelect = el("select.pu-select", { "aria-label": "Tool role" });
      const capSelect = el("select.pu-select", { "aria-label": "Capability" });
      for (const cap of permissions.capabilities.filter((c) => !c.wildcard)) {
        capSelect.appendChild(el("option", { value: cap.id, text: cap.label }));
      }
      const result = el("div", { style: { "margin-top": "0.75rem" } });

      function syncRoles() {
        mount(roleSelect);
        for (const role of permissions.toolRoles(connectorSelect.value)) {
          roleSelect.appendChild(el("option", { value: role, text: role }));
        }
      }

      function evaluate() {
        mount(result);
        const connectorId = connectorSelect.value;
        const toolRole = roleSelect.value;
        const capability = capSelect.value;
        const report = permissions.explain({ connector: connectorId, toolRole }, capability);
        const connector = hub.registry.connector(connectorId);
        const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
        head.appendChild(el("span", { class: report.allowed ? "pu-chip ok" : "pu-chip fail", text: report.allowed ? "Allowed" : "Denied" }));
        head.appendChild(el("span.pu-small", { text: `${connector?.name || connectorId} “${toolRole}” → ${capLabel.get(capability) || capability}` }));
        result.appendChild(head);
        result.appendChild(
          el("p.pu-small.pu-muted", {
            text: `Canonical roles: ${report.roles.map((r) => permissions.roles[r]?.label || r).join(", ") || "none"} · ${report.capabilities.length} capabilities granted`,
          })
        );
      }

      connectorSelect.addEventListener("change", () => {
        syncRoles();
        evaluate();
      });
      roleSelect.addEventListener("change", evaluate);
      capSelect.addEventListener("change", evaluate);

      const controls = el("div.pu-toolbar", { style: { "margin-top": "0.6rem" } }, connectorSelect, roleSelect, capSelect);
      card.appendChild(controls);
      card.appendChild(result);

      syncRoles();
      evaluate();
      checkerCtn.appendChild(card);
    }

    root.appendChild(
      pageHead({
        eyebrow: "Data",
        title: "Permission mapping",
        subtitle: "One permission model for the whole family. Connector-specific roles resolve to canonical roles, so access questions have a single consistent answer.",
      })
    );
    root.appendChild(statsCtn);
    root.appendChild(rolesCtn);
    root.appendChild(mappingsCtn);
    root.appendChild(checkerCtn);

    renderStats();
    renderRoles();
    renderMappings();
    renderChecker();
    return root;
  },
};
