import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";

const KIND_LABEL = {
  "field-conflict": "Field conflict",
  "stale-value": "Stale derived value",
  "link-drift": "Link drift",
};

const SEVERITY_CLASS = {
  critical: "fail",
  error: "fail",
  warning: "warn",
  info: "",
};

function statCard(label, value, hint) {
  const card = el("article.pu-card.pu-stat");
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

function alertStatus(status) {
  if (status === "acknowledged") return "warn";
  return "fail";
}

export const driftView = {
  id: "drift",
  title: "Drift & alerts",
  group: "Integrity",
  icon: "drift",
  nav: true,
  render({ hub }) {
    const root = el("div");
    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const openCtn = el("div");
    const alertsCtn = el("div");
    const resolvedCtn = el("div");

    function renderStats() {
      const d = hub.drift.stats();
      const a = hub.alerts.stats();
      mount(
        statsCtn,
        statCard("Open drift", d.open, `${d.total} tracked in the ledger`),
        statCard("Errors", d.bySeverity.error || 0, `${d.critical} on sensitive fields`),
        statCard("Warnings", d.bySeverity.warning || 0, "stale derived values"),
        statCard("Open alerts", a.open + a.acknowledged, `${a.critical} critical · ${a.cleared} cleared`)
      );
    }

    async function runFix(record) {
      const suggestion = hub.drift.suggest(record);
      const result = await hub.jobs.enqueue({
        kind: suggestion.kind,
        target: suggestion.target,
        key: suggestion.kind === "link.rebuild" ? "link.rebuild|scheduled" : null,
        payload: { entityType: record.entityType, entityId: record.entityId, field: record.field, reason: record.kind },
        note: `${record.entityName} · ${record.label}`,
      });
      if (!result.ok) {
        toast(result.error, { tone: "error" });
        return;
      }
      const run = await hub.jobs.execute(result.job.key);
      await hub.drift.scan();
      if (!run.ok) toast(run.error || "The fix job failed", { tone: "error" });
      else if (run.reused) toast(`${suggestion.label} was already applied`, { tone: "info" });
      else toast(`Queued and ran: ${suggestion.label}`, { tone: "success" });
      rerender();
    }

    function buildOpen() {
      const records = hub.drift.open();
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Detected drift" }));
      head.appendChild(el("span.pu-chip", { class: records.length ? "fail" : "ok", text: String(records.length) }));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "Drift is recomputed on every scan: the hub compares each recorded value against the connector that owns it and against the link graph. Rows disappear on their own once the values converge.",
        })
      );

      if (!records.length) {
        card.appendChild(el("div.pu-empty", { text: "Nothing is drifting. Every linked value agrees with its authoritative source." }));
        mount(openCtn, card);
        return;
      }

      const wrap = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Entity", "Kind", "Field", "Hub holds", "Expected", "Severity", "First seen", ""]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const record of records) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("div", { text: record.entityName }), el("span.pu-mono.pu-muted", { text: `${record.entityType}:${record.entityId}` })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { class: SEVERITY_CLASS[record.severity] || "", text: KIND_LABEL[record.kind] || record.kind })));
        tr.appendChild(el("td", {}, el("div", { text: record.label }), el("span.pu-mono.pu-muted", { text: record.field })));
        tr.appendChild(el("td", { text: record.held == null ? "—" : String(record.held) }));
        tr.appendChild(el("td", { text: record.expected == null ? "—" : String(record.expected) }));
        tr.appendChild(el("td", {}, el("span.pu-chip", { class: SEVERITY_CLASS[record.severity] || "", text: record.severity })));
        tr.appendChild(el("td", {}, el("div", { text: timeOf(record.firstSeenAt) }), el("span.pu-small.pu-muted", { text: `seen ${record.seenCount}×` })));
        const actionCell = el("td");
        const fixBtn = el("button.pu-btn.secondary", { type: "button", text: "Queue & run fix", "data-permission": "sync.run", "data-mutating": "" });
        fixBtn.addEventListener("click", () => {
          fixBtn.disabled = true;
          runFix(record);
        });
        actionCell.appendChild(fixBtn);
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
      mount(openCtn, card);
    }

    function buildAlerts() {
      const alerts = hub.alerts.list({ openOnly: true });
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Alert inbox" }));
      head.appendChild(el("span.pu-chip", { class: alerts.length ? "fail" : "ok", text: String(alerts.length) }));
      card.appendChild(head);
      card.appendChild(el("p.pu-small", { text: "Repeated scans of the same drift escalate a single alert rather than piling up duplicates. Acknowledge to record that someone is on it; clear it to dismiss it early." }));

      if (!alerts.length) {
        card.appendChild(el("div.pu-empty", { text: "No open alerts. Drift that matters will raise one here." }));
        mount(alertsCtn, card);
        return;
      }

      const list = el("div", { style: { "margin-top": "0.75rem" } });
      for (const alert of alerts) {
        const row = el("div.pu-test-row");
        row.appendChild(el("span.pu-chip", { class: SEVERITY_CLASS[alert.severity] || "", text: alert.severity }));
        row.appendChild(el("span.pu-chip", { class: alertStatus(alert.status), text: alert.status }));
        const body = el("div.pu-test-name");
        body.appendChild(el("div", {}, el("strong", { text: alert.title })));
        body.appendChild(el("div.pu-small.pu-muted", { text: alert.detail }));
        const bits = el("div.pu-small.pu-muted");
        bits.appendChild(el("span", { text: `${alert.category} · raised ${timeOf(alert.firstSeenAt)} · seen ${alert.count}×` }));
        if (alert.entity) bits.appendChild(el("span.pu-ref", { text: `${alert.entity.typeId}:${alert.entity.id}` }));
        if (alert.items && alert.items.length) bits.appendChild(el("span", { text: ` · ${alert.items.length} field${alert.items.length === 1 ? "" : "s"}` }));
        body.appendChild(bits);
        row.appendChild(body);

        if (alert.status !== "acknowledged") {
          const ackBtn = el("button.pu-btn.secondary", { type: "button", text: "Acknowledge", "data-permission": "monitor.manage", "data-mutating": "" });
          ackBtn.addEventListener("click", async () => {
            ackBtn.disabled = true;
            const result = await hub.alerts.acknowledge(alert.key);
            if (!result.ok) toast(result.error, { tone: "error" });
            else toast("Alert acknowledged", { tone: "success" });
            rerender();
          });
          row.appendChild(ackBtn);
        }
        const clearBtn = el("button.pu-btn.secondary", { type: "button", text: "Clear", "data-permission": "monitor.manage", "data-mutating": "" });
        clearBtn.addEventListener("click", async () => {
          clearBtn.disabled = true;
          const result = await hub.alerts.clear(alert.key, { reason: "cleared from the drift screen" });
          if (!result.ok) toast(result.error, { tone: "error" });
          else toast("Alert cleared", { tone: "info" });
          rerender();
        });
        row.appendChild(clearBtn);
        list.appendChild(row);
      }
      card.appendChild(list);
      mount(alertsCtn, card);
    }

    function buildResolved() {
      const records = hub.drift.resolved();
      const cleared = hub.alerts.list({ status: "cleared" });
      mount(resolvedCtn);
      if (!records.length && !cleared.length) return;
      const card = el("section.pu-card");
      const details = el("details.pu-details", { open: false });
      const summary = el("summary");
      summary.appendChild(el("span.pu-entity-name", { text: "Resolved log" }));
      if (records.length) summary.appendChild(el("span.pu-chip.ok", { text: `${records.length} converged` }));
      if (cleared.length) summary.appendChild(el("span.pu-chip", { text: `${cleared.length} cleared alerts` }));
      details.appendChild(summary);
      const body = el("div.pu-details-body");
      const list = el("ul.pu-list");
      for (const record of records.slice(0, 30)) {
        const li = el("li");
        li.appendChild(el("span.pu-chip.ok", { text: "converged" }));
        li.appendChild(el("span.pu-small", { text: `${record.entityName} · ${record.label}` }));
        li.appendChild(el("span.pu-small.pu-muted", { text: `${KIND_LABEL[record.kind] || record.kind} · resolved ${timeOf(record.resolvedAt)}` }));
        list.appendChild(li);
      }
      for (const alert of cleared.slice(0, 20)) {
        const li = el("li");
        li.appendChild(el("span.pu-chip", { text: "cleared" }));
        li.appendChild(el("span.pu-small", { text: alert.title }));
        li.appendChild(el("span.pu-small.pu-muted", { text: `${alert.clearedReason || "no reason recorded"} · ${timeOf(alert.clearedAt)}` }));
        list.appendChild(li);
      }
      body.appendChild(list);
      details.appendChild(body);
      card.appendChild(details);
      resolvedCtn.appendChild(card);
    }

    function rerender() {
      renderStats();
      buildOpen();
      buildAlerts();
      buildResolved();
    }

    const toolbar = el("div.pu-toolbar");
    const scanBtn = el("button.pu-btn", { type: "button", text: "Scan now", "data-permission": "sync.run", "data-mutating": "" });
    scanBtn.addEventListener("click", async () => {
      scanBtn.disabled = true;
      scanBtn.textContent = "Scanning…";
      try {
        const summary = await hub.primeIntegrity({ announce: true });
        toast(`Scan found ${summary.found} signal${summary.found === 1 ? "" : "s"} · ${summary.opened} new, ${summary.resolved} resolved${summary.queued ? ` · ${summary.queued} fix jobs suggested` : ""}`, { tone: "info" });
        rerender();
      } finally {
        scanBtn.disabled = false;
        scanBtn.textContent = "Scan now";
      }
    });
    const runFixesBtn = el("button.pu-btn.secondary", { type: "button", text: "Run all suggested fixes" });
    runFixesBtn.addEventListener("click", async () => {
      runFixesBtn.disabled = true;
      runFixesBtn.textContent = "Working…";
      try {
        await hub.seedDriftJobs();
        const summary = await hub.jobs.executeAll();
        const scan = await hub.drift.scan();
        toast(`Ran ${summary.succeeded} fix${summary.succeeded === 1 ? "" : "es"} · ${scan.open} signal${scan.open === 1 ? "" : "s"} still open`, { tone: scan.open ? "error" : "success" });
        rerender();
      } finally {
        runFixesBtn.disabled = false;
        runFixesBtn.textContent = "Run all suggested fixes";
      }
    });
    toolbar.appendChild(scanBtn);
    toolbar.appendChild(runFixesBtn);

    root.appendChild(
      pageHead({
        eyebrow: "Integrity",
        title: "Drift detection & alerting",
        subtitle: "The hub keeps checking. Any linked value that stops matching its authoritative source is recorded in a drift ledger, grouped into an alert, and offered a one-click fix via the sync queue.",
      })
    );
    root.appendChild(toolbar);
    root.appendChild(statsCtn);
    root.appendChild(openCtn);
    root.appendChild(alertsCtn);
    root.appendChild(resolvedCtn);

    rerender();
    return root;
  },
};
