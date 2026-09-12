import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { ERROR_CATEGORIES, ERROR_SEVERITIES } from "../core/monitor.js";

const STATUS_LABEL = { up: "up", degraded: "degraded", down: "down", unknown: "unknown" };
const STATUS_CLASS = { up: "ok", degraded: "warn", down: "fail" };
const SEVERITY_CLASS = { error: "fail", warning: "warn" };
const CATEGORY_CLASS = { connectivity: "warn", delivery: "fail", validation: "warn", sync: "fail" };
const INTERVALS = [
  { value: 5000, label: "every 5s" },
  { value: 15000, label: "every 15s" },
  { value: 30000, label: "every 30s" },
  { value: 60000, label: "every 60s" },
];

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
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function timeAgo(value) {
  if (!value) return "never";
  const diff = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(diff)) return "—";
  const seconds = Math.max(0, Math.round(diff / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function ms(value) {
  return value == null ? "—" : `${value} ms`;
}

function statusChip(status) {
  return el("span.pu-chip", { class: STATUS_CLASS[status] || "", text: STATUS_LABEL[status] || status });
}

function latencyRows(card, title, overall, byKey) {
  card.appendChild(el("h3", { style: { margin: "0.9rem 0 0.4rem" }, text: title }));
  const wrap = el("div.pu-table-scroll");
  const table = el("table.pu-table");
  const thead = el("thead");
  const headRow = el("tr");
  for (const label of ["Group", "Samples", "Avg", "p50", "p95", "Max", "Last"]) headRow.appendChild(el("th", { text: label }));
  thead.appendChild(headRow);
  table.appendChild(thead);
  const tbody = el("tbody");
  const row = (label, stats) => {
    const tr = el("tr");
    tr.appendChild(el("td", { text: label }));
    tr.appendChild(el("td", { text: stats ? stats.count : "—" }));
    tr.appendChild(el("td", { text: stats ? ms(stats.avg) : "—" }));
    tr.appendChild(el("td", { text: stats ? ms(stats.p50) : "—" }));
    tr.appendChild(el("td", { text: stats ? ms(stats.p95) : "—" }));
    tr.appendChild(el("td", { text: stats ? ms(stats.max) : "—" }));
    tr.appendChild(el("td", { text: stats ? ms(stats.last) : "—" }));
    return tr;
  };
  tbody.appendChild(row("all", overall));
  for (const [key, stats] of Object.entries(byKey || {})) tbody.appendChild(row(key, stats));
  table.appendChild(tbody);
  wrap.appendChild(table);
  card.appendChild(wrap);
}

export const monitorView = {
  id: "monitor",
  title: "Connector monitor",
  group: "Monitoring",
  icon: "monitor",
  nav: true,
  render({ hub, onDestroy }) {
    const root = el("div");
    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const heartbeatCtn = el("div");
    const gridCtn = el("div");
    const latencyCtn = el("div");
    const errorsCtn = el("div");
    const state = { category: "", severity: "" };
    let uiTimer = null;

    function renderStats() {
      const s = hub.monitor.summary();
      mount(
        statsCtn,
        statCard("Availability", s.availability == null ? "—" : `${s.availability}%`, `${s.up} of ${s.total} connectors up`),
        statCard("Connector health", `${s.up}/${s.total}`, `${s.degraded} degraded · ${s.down} down`),
        statCard("Average latency", s.averageLatencyMs == null ? "—" : `${s.averageLatencyMs} ms`, `${s.heartbeats} heartbeat${s.heartbeats === 1 ? "" : "s"} run`),
        statCard("Open errors", hub.monitor.errors().total, `${hub.monitor.errors().withErrors} error-severity`)
      );
    }

    function buildHeartbeat() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "System heartbeat" }));
      head.appendChild(statusChip(hub.monitor.running() ? "up" : "unknown"));
      head.appendChild(el("span.pu-chip", { text: hub.monitor.running() ? `running ${hub.monitor.intervalMs() / 1000}s` : "idle" }));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: `The hub probes every connector on demand and on a schedule, recording reachability, round-trip latency and status transitions. A probe slower than ${hub.monitor.thresholds.degradedMs} ms is degraded; no response (or over ${hub.monitor.thresholds.downMs} ms) is down.`,
        })
      );

      const sweep = hub.monitor.lastSweep();
      if (sweep) {
        const bits = el("div", { style: { display: "flex", gap: "0.4rem", "flex-wrap": "wrap", "margin-top": "0.5rem" } });
        bits.appendChild(el("span.pu-chip", { text: `${sweep.probed} probed` }));
        bits.appendChild(el("span.pu-chip.ok", { text: `${sweep.up} up` }));
        if (sweep.degraded) bits.appendChild(el("span.pu-chip.warn", { text: `${sweep.degraded} degraded` }));
        if (sweep.down) bits.appendChild(el("span.pu-chip.fail", { text: `${sweep.down} down` }));
        bits.appendChild(el("span.pu-small.pu-muted", { text: `sweep took ${sweep.durationMs} ms · ${sweep.trigger} · ${timeAgo(sweep.at)}` }));
        card.appendChild(bits);
      }

      const intervalSelect = el("select.pu-select", { "aria-label": "Heartbeat interval" });
      for (const option of INTERVALS) intervalSelect.appendChild(el("option", { value: option.value, text: option.label }));
      intervalSelect.value = String(hub.monitor.intervalMs() || 15000);

      const beatBtn = el("button.pu-btn", { type: "button", text: "Send heartbeat" });
      beatBtn.addEventListener("click", async () => {
        beatBtn.disabled = true;
        beatBtn.textContent = "Probing…";
        try {
          const summary = await hub.monitor.heartbeat({ announce: true, force: true, trigger: "manual" });
          await hub.audit.refresh();
          toast(`Heartbeat: ${summary.up} up, ${summary.degraded} degraded, ${summary.down} down`, { tone: summary.down ? "error" : summary.degraded ? "info" : "success" });
          rerender();
        } finally {
          beatBtn.disabled = false;
          beatBtn.textContent = "Send heartbeat";
        }
      });

      const autoBtn = el("button.pu-btn.secondary", { type: "button", text: hub.monitor.running() ? "Stop auto heartbeat" : "Start auto heartbeat" });
      autoBtn.addEventListener("click", () => {
        if (hub.monitor.running()) {
          hub.monitor.stop();
          if (uiTimer) {
            clearInterval(uiTimer);
            uiTimer = null;
          }
          toast("Auto heartbeat stopped", { tone: "info" });
        } else {
          const result = hub.monitor.start({ intervalMs: Number(intervalSelect.value) });
          if (!result.ok) {
            toast(result.error, { tone: "error" });
            return;
          }
          uiTimer = setInterval(() => rerender(), 2000);
          toast(`Auto heartbeat started (${result.intervalMs / 1000}s)`, { tone: "success" });
        }
        rerender();
      });

      const row = el("div.pu-form-row", { style: { "margin-top": "0.75rem" } });
      row.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Interval" }), intervalSelect));
      card.appendChild(row);
      card.appendChild(el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "margin-top": "0.6rem" } }, beatBtn, autoBtn));
      return card;
    }

    function buildGrid() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Connectivity dashboard" }));
      head.appendChild(el("span.pu-chip", { text: `${hub.monitor.connectors().length} connectors` }));
      card.appendChild(head);
      card.appendChild(el("p.pu-small", { text: "Every active Project U member connector, its latest probe result and its recent uptime. Inject an incident to see how the dashboard, latency and error aggregator react." }));

      const grid = el("div.pu-grid.cols-3", { style: { "margin-top": "0.75rem" } });
      for (const connector of hub.monitor.connectors()) {
        const item = el("article.pu-card");
        const title = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "justify-content": "space-between" } });
        const nameWrap = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center" } });
        const dot = el("span", { style: { width: "10px", height: "10px", "border-radius": "999px", background: connector.accent, "flex-shrink": "0" } });
        nameWrap.appendChild(dot);
        nameWrap.appendChild(el("strong", { text: connector.name }));
        title.appendChild(nameWrap);
        title.appendChild(statusChip(connector.status));
        item.appendChild(title);
        item.appendChild(el("div.pu-small.pu-muted", { text: connector.label }));

        const facts = el("ul.pu-list", { style: { "margin-top": "0.5rem" } });
        const fact = (label, value) => {
          const li = el("li");
          li.appendChild(el("span.pu-small.pu-muted", { text: label }));
          li.appendChild(el("span.pu-small", { text: value }));
          return li;
        };
        facts.appendChild(fact("Latency", ms(connector.latencyMs)));
        facts.appendChild(fact("Average", ms(connector.averageLatencyMs)));
        facts.appendChild(fact("Uptime", connector.uptime == null ? "—" : `${connector.uptime}% of ${connector.attempts} probes`));
        facts.appendChild(fact("Last checked", connector.checkedAt ? timeAgo(connector.checkedAt) : "never"));
        facts.appendChild(fact("Errors", String(connector.errorCount)));
        if (connector.streak > 0) facts.appendChild(fact("Streak", `${connector.streak} failing`));
        item.appendChild(facts);

        const overridden = hub.monitor.incidents().some((entry) => entry.connector === connector.id);
        const action = el("button.pu-btn.secondary", { type: "button", text: overridden ? "Restore connector" : "Simulate outage" });
        action.addEventListener("click", async () => {
          action.disabled = true;
          if (overridden) hub.monitor.clearIncident(connector.id);
          else hub.monitor.injectIncident(connector.id, { status: "down" });
          await hub.monitor.heartbeat({ announce: true, force: true, trigger: "manual" });
          await hub.audit.refresh();
          toast(overridden ? `${connector.name} restored` : `${connector.name} taken offline`, { tone: overridden ? "success" : "error" });
          rerender();
        });
        item.appendChild(el("div", { style: { "margin-top": "0.6rem" } }, action));
        grid.appendChild(item);
      }
      card.appendChild(grid);
      return card;
    }

    function buildLatency() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Latency tracking" }));
      card.appendChild(el("p.pu-small", { text: "Round-trip timings gathered from the event bus (publish → validate → persist → deliver), from sync jobs and from connector probes." }));
      const sample = hub.monitor.latency();
      latencyRows(card, "Event bus publish", sample.bus, sample.busByTopic);
      latencyRows(card, "Sync jobs", sample.jobs, sample.jobsByKind);
      latencyRows(card, "Connector probes", sample.probe, sample.probeByConnector);
      return card;
    }

    function buildErrors() {
      const view = hub.monitor.errors({ category: state.category || null, severity: state.severity || null });
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Error aggregator" }));
      head.appendChild(el("span.pu-chip", { class: view.withErrors ? "fail" : "ok", text: `${view.total} open` }));
      card.appendChild(head);
      card.appendChild(el("p.pu-small", { text: "One place for every failure the hub has seen: failed sync attempts, events rejected by validation, subscribers that threw and connectors that stopped responding. Repeated failures collapse into a single row with a count." }));

      const toolbar = el("div.pu-form-row", { style: { "margin-top": "0.75rem" } });
      const categorySelect = el("select.pu-select", { "aria-label": "Filter by error category" });
      categorySelect.appendChild(el("option", { value: "", text: "All categories" }));
      for (const category of ERROR_CATEGORIES) {
        categorySelect.appendChild(el("option", { value: category, text: `${category}${view.byCategory[category] ? ` (${view.byCategory[category]})` : ""}` }));
      }
      categorySelect.value = state.category;
      categorySelect.addEventListener("change", () => {
        state.category = categorySelect.value;
        renderErrors();
      });
      const severitySelect = el("select.pu-select", { "aria-label": "Filter by severity" });
      severitySelect.appendChild(el("option", { value: "", text: "All severities" }));
      for (const severity of ERROR_SEVERITIES) severitySelect.appendChild(el("option", { value: severity, text: severity }));
      severitySelect.value = state.severity;
      severitySelect.addEventListener("change", () => {
        state.severity = severitySelect.value;
        renderErrors();
      });
      const resetBtn = el("button.pu-btn.secondary", { type: "button", text: "Reset filters" });
      resetBtn.addEventListener("click", () => {
        state.category = "";
        state.severity = "";
        renderErrors();
      });
      toolbar.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Category" }), categorySelect));
      toolbar.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Severity" }), severitySelect));
      toolbar.appendChild(el("div", {}, resetBtn));
      card.appendChild(toolbar);

      if (!view.items.length) {
        card.appendChild(el("div.pu-empty", { text: "No failures recorded. Every connector, event and sync attempt is healthy." }));
        return card;
      }

      const wrap = el("div.pu-table-scroll", { style: { "margin-top": "0.75rem" } });
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Severity", "Category", "Error", "Source", "Count", "Last seen"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const entry of view.items) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("span.pu-chip", { class: SEVERITY_CLASS[entry.severity] || "", text: entry.severity })));
        tr.appendChild(el("td", {}, el("span.pu-chip", { class: CATEGORY_CLASS[entry.category] || "", text: entry.category })));
        tr.appendChild(el("td", {}, el("div", { text: entry.title }), entry.detail ? el("span.pu-small.pu-muted", { text: entry.detail }) : null));
        tr.appendChild(el("td", {}, el("span.pu-ref", { text: entry.connector || entry.source }), entry.derived ? el("span.pu-small.pu-muted", { text: " current state" }) : null));
        tr.appendChild(el("td", { text: `×${entry.count}` }));
        tr.appendChild(el("td", {}, el("div", { text: timeOf(entry.lastAt) }), el("span.pu-small.pu-muted", { text: timeAgo(entry.lastAt) })));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      wrap.appendChild(table);
      card.appendChild(wrap);
      return card;
    }

    function renderHeartbeat() {
      mount(heartbeatCtn, buildHeartbeat());
    }
    function renderGrid() {
      mount(gridCtn, buildGrid());
    }
    function renderLatency() {
      mount(latencyCtn, buildLatency());
    }
    function renderErrors() {
      mount(errorsCtn, buildErrors());
    }

    function rerender() {
      renderStats();
      renderHeartbeat();
      renderGrid();
      renderLatency();
      renderErrors();
    }

    root.appendChild(
      pageHead({
        eyebrow: "Monitoring",
        title: "Connector monitor",
        subtitle: "A live health dashboard for every Project U member connector, with heartbeat reachability checks, latency tracking across the bus, sync jobs and probes, and a single aggregator for every failure the hub has seen.",
      })
    );
    root.appendChild(statsCtn);
    root.appendChild(heartbeatCtn);
    root.appendChild(gridCtn);
    root.appendChild(latencyCtn);
    root.appendChild(errorsCtn);

    if (onDestroy) {
      onDestroy(() => {
        if (uiTimer) {
          clearInterval(uiTimer);
          uiTimer = null;
        }
        hub.monitor.stop();
      });
    }

    rerender();
    return root;
  },
};
