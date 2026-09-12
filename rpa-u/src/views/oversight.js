import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { DRIFT_LABEL, DRIFT_SEVERITY } from "../core/drift.js";

function statCard(label, value, hint, tone) {
  const card = el("article.pu-card.pu-stat");
  if (tone) card.classList.add(`pu-stat-${tone}`);
  card.appendChild(el("span.pu-stat-label", { text: label }));
  card.appendChild(el("span.pu-stat-value", { text: String(value) }));
  if (hint) card.appendChild(el("span.pu-small.pu-muted", { text: hint }));
  return card;
}

function timeOf(value) {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleString([], { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

export const oversightView = {
  id: "oversight",
  title: "Auditor oversight",
  group: "Governance",
  icon: "shield",
  nav: true,
  permission: "audit.view",
  render({ hub }) {
    const root = el("div");

    root.appendChild(
      pageHead({
        eyebrow: "Governance · read-only",
        title: "Auditor oversight",
        subtitle: "A read-only command view for auditors: connector health, sync drift, open conflicts and the integrity of the audit chain — with every mutation control removed.",
      })
    );

    root.appendChild(
      el("div.pu-alert", {
        class: "info",
        text: "You are viewing the oversight dashboard in read-only mode. Buttons that would change data are disabled, and the hub's authority checks reject any mutation that reaches the backend.",
      })
    );

    const statsCtn = el("div.pu-grid.cols-4", { style: { margin: "1rem 0" } });
    const connectorsCtn = el("section.pu-card");
    const driftCtn = el("section.pu-card");
    const integrityCtn = el("section.pu-card");

    function renderStats() {
      const monitor = hub.monitor.summary();
      const drift = hub.drift.stats();
      const chain = hub.audit.stats().chain;
      mount(
        statsCtn,
        statCard("Connectors up", monitor.up, `${monitor.degraded} degraded · ${monitor.down} down`, monitor.down ? "fail" : monitor.degraded ? "warn" : "ok"),
        statCard("Open drift", drift.open, `${drift.total} total findings`),
        statCard("Average latency", monitor.averageLatencyMs != null ? `${monitor.averageLatencyMs}ms` : "—", `last sweep ${timeOf(monitor.lastHeartbeatAt)}`),
        statCard("Audit chain", chain.ok ? "verified" : "broken", chain.ok ? `${chain.checked} links checked` : `fails at ${chain.brokenAt}`)
      );
    }

    function renderConnectors() {
      mount(connectorsCtn);
      connectorsCtn.appendChild(el("h2", { text: "Connector status" }));
      connectorsCtn.appendChild(el("p.pu-small", { text: "Every Project U tool and the OpenRPA connector, with its current availability, response time and last check." }));
      const list = hub.monitor.connectors();
      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Connector", "Status", "Latency", "Uptime", "Checked", "Last error"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const connector of list) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("span.pu-ref", { text: connector.name }), el("span.pu-small.pu-muted", { text: connector.id })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { class: connector.status === "up" ? "ok" : connector.status === "degraded" ? "warn" : connector.status === "down" ? "fail" : "", text: connector.status })));
        tr.appendChild(el("td", {}, el("span.pu-small", { text: connector.latencyMs != null ? `${connector.latencyMs}ms` : "—" })));
        tr.appendChild(el("td", {}, el("span.pu-small", { text: connector.uptime != null ? `${connector.uptime}%` : "—" })));
        tr.appendChild(el("td", {}, el("span.pu-small.pu-muted", { text: timeOf(connector.checkedAt) })));
        tr.appendChild(el("td", {}, connector.error ? el("span.pu-small.pu-muted", { text: connector.error }) : el("span.pu-small.pu-muted", { text: "—" })));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      connectorsCtn.appendChild(wrap);
    }

    function renderDrift() {
      mount(driftCtn);
      driftCtn.appendChild(el("h2", { text: "Sync drift" }));
      const open = hub.drift.open();
      driftCtn.appendChild(el("p.pu-small", { text: "Linked values that no longer match their authoritative source. An auditor cannot change these — the fix actions live on the Reconciliation and Drift & alerts screens." }));
      if (!open.length) {
        driftCtn.appendChild(el("div.pu-empty", { text: "No drift detected — every linked value matches its source." }));
        return;
      }
      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Entity", "Kind", "Field", "Severity", "Held", "Expected"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const entry of open) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("div", { text: entry.entityName || entry.entityId }), el("span.pu-small.pu-muted", { text: entry.entityType })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { text: DRIFT_LABEL[entry.kind] || entry.kind })));
        tr.appendChild(el("td", {}, el("span.pu-mono.pu-small", { text: entry.label || entry.field })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { class: DRIFT_SEVERITY[entry.severity] || "", text: entry.severity })));
        tr.appendChild(el("td", {}, el("span.pu-small", { text: entry.held || "—" })));
        tr.appendChild(el("td", {}, el("span.pu-small", { text: entry.expected || "—" })));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      driftCtn.appendChild(wrap);
    }

    function renderIntegrity() {
      mount(integrityCtn);
      integrityCtn.appendChild(el("h2", { text: "Audit ledger integrity" }));
      integrityCtn.appendChild(el("p.pu-small", { text: "Re-verify the hash chain to prove no audit entry was edited, reordered or removed." }));
      const output = el("div", { style: { "margin-top": "0.6rem" } });
      const verify = el("button.pu-btn", { type: "button", text: "Verify audit chain" });
      verify.addEventListener("click", () => {
        const result = hub.audit.verify();
        mount(output, el("div.pu-alert", { class: result.ok ? "ok" : "fail", text: result.ok ? `Chain intact — ${result.checked} entries verified.` : `Chain broken at ${result.brokenAt} (seq ${result.seq}).` }));
      });
      integrityCtn.appendChild(el("div.pu-form-actions", {}, verify));
      integrityCtn.appendChild(output);
      const links = el("div.pu-form-actions", { style: { "margin-top": "0.6rem" } });
      links.appendChild(el("a.pu-btn.secondary", { href: "#/audit", text: "Open the audit log" }));
      links.appendChild(el("a.pu-btn.secondary", { href: "#/drift", text: "Open drift & alerts" }));
      integrityCtn.appendChild(links);
    }

    root.appendChild(statsCtn);
    root.appendChild(connectorsCtn);
    root.appendChild(driftCtn);
    root.appendChild(integrityCtn);

    renderStats();
    renderConnectors();
    renderDrift();
    renderIntegrity();
    return root;
  },
};
