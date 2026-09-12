import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { OPENRPA_INVOCATION_LABELS, OPENRPA_INVOCATION_TONES } from "../core/openrpa/invocation.js";
import { OPENRPA_PRESENCE_LABELS, OPENRPA_PRESENCE_TONES, formatAge } from "../core/openrpa/robots.js";
import { OPENRPA_NODERED_LABELS, OPENRPA_NODERED_TONES } from "../core/openrpa/nodered.js";
import { normalizeWorkflow } from "../core/openrpa/workflows.js";

const HEALTH_TONE = { up: "ok", degraded: "warn", down: "fail" };

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

function truncate(value, max = 90) {
  const text = String(value == null ? "" : value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function formatJson(value) {
  if (value == null) return "—";
  try {
    return JSON.stringify(value, null, 2);
  } catch (error) {
    return String(value);
  }
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

function selectOf(options, { value = "", label } = {}) {
  const select = el("select.pu-select", label ? { "aria-label": label } : {});
  for (const option of options) select.appendChild(el("option", { value: option.value, text: option.label }));
  select.value = value;
  return select;
}

function button(label, tone, permission) {
  const node = el(`button.pu-btn${tone ? `.${tone}` : ""}`, { type: "button", text: label });
  if (permission) {
    node.setAttribute("data-permission", permission);
    node.setAttribute("data-mutating", "");
  }
  return node;
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

export const openrpaAutomationView = {
  id: "openrpa-automation",
  title: "Automation & monitoring",
  group: "OpenRPA",
  icon: "rpa",
  nav: true,
  render({ hub, onDestroy }) {
    const or = hub.openrpa;
    const monitor = hub.monitor;
    const root = el("div");
    let destroyed = false;

    const state = {
      loaded: false,
      loading: false,
      loadError: null,
      workflows: [],
      queues: [],
      invocations: [],
      pending: [],
      invocationResult: null,
      invoking: false,
      robots: [],
      robotSummary: null,
      heartbeatResult: null,
      instances: [],
      noderedResult: null,
      health: null,
      monitor: null,
      monitorSummary: null,
      monitorErrors: null,
      monitoring: false,
    };

    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const errorCtn = el("div", { style: { "margin-bottom": "1rem" } });
    const invokeCtn = el("div");
    const resultsCtn = el("div");
    const robotsCtn = el("div");
    const noderedCtn = el("div");
    const monitorCtn = el("div");

    const workflowSelect = selectOf([{ value: "", label: "No workflow selected" }], { label: "Workflow to invoke" });
    const queueSelect = selectOf([{ value: "", label: "No queue binding" }], { label: "Queue to invoke" });
    const payloadInput = el("textarea.pu-textarea", {
      "aria-label": "Invocation payload",
      spellcheck: "false",
      placeholder: '{ "invoiceId": "iv_2001", "amount": 42.5 }',
      style: { "min-height": "6rem", "font-family": "ui-monospace, Menlo, monospace", "font-size": "0.78rem" },
    });
    const correlationInput = el("input.pu-input", { type: "text", "aria-label": "Correlation id", placeholder: "auto-generated when blank" });
    const timeoutInput = el("input.pu-input", { type: "number", min: "250", step: "250", "aria-label": "Timeout in milliseconds", placeholder: "15000" });
    const actorInput = el("input.pu-input", { type: "text", "aria-label": "Dispatcher", placeholder: "operator" });
    const failCheck = el("input", { type: "checkbox" });
    const failMessageInput = el("input.pu-input", { type: "text", "aria-label": "Simulated failure message", placeholder: "Business rule failed" });
    const durationInput = el("input.pu-input", { type: "number", min: "0", "aria-label": "Completion delay in milliseconds", placeholder: "emulator default" });
    const workflowHint = el("p.pu-small.pu-muted", { text: "Pick a workflow or a queue to see its parameters." });
    const paramsHint = el("p.pu-small.pu-muted");

    const invokeBtn = button("Invoke & await", null, "openrpa.run");
    const dispatchBtn = button("Dispatch only", "secondary", "openrpa.run");

    const noderedNameInput = el("input.pu-input", { type: "text", "aria-label": "Node-RED instance name", placeholder: "flow-invoice" });
    const noderedUrlInput = el("input.pu-input", { type: "text", "aria-label": "Node-RED URL", placeholder: "https://nodered.example.com (optional)" });
    const ensureBtn = button("Ensure instance", null, "openrpa.manage");

    const probeBtn = button("Probe now", null, "openrpa.manage");
    const injectBtn = button("Simulate outage", "secondary", "monitor.manage");
    const restoreBtn = button("Restore connector", "secondary", "monitor.manage");

    const monitorProbe = el("div");

    function rerender() {
      if (destroyed) return;
      renderStats();
      mount(errorCtn, state.loadError ? alertNode(state.loadError, "fail") : null);
      mount(invokeCtn, buildInvoke());
      mount(resultsCtn, buildResults());
      mount(robotsCtn, buildRobots());
      mount(noderedCtn, buildNodeRed());
      mount(monitorCtn, buildMonitor());
    }

    function renderStats() {
      const health = state.health;
      const summary = state.robotSummary;
      const noderedSummary = state.instances.length;
      const running = state.instances.filter((entry) => entry.state === "running").length;
      mount(
        statsCtn,
        statCard("Connection", health ? health.status : "unknown", health ? `${health.mode} mode · ${health.state}` : "not measured", health ? HEALTH_TONE[health.status] : ""),
        statCard("Invocations", state.invocations.length, `${state.pending.length} awaiting a reply`),
        statCard("Robots online", summary ? `${summary.online}/${summary.total}` : "—", summary ? `${summary.stale} stale · ${summary.offline} offline` : "not loaded"),
        statCard("Node-RED", `${running}/${noderedSummary}`, "instances running")
      );
    }

    function syncOptions() {
      const workflowOptions = [{ value: "", label: "No workflow selected" }, ...state.workflows.map((entry) => ({ value: entry.id, label: `${entry.name || entry.filename || entry.id} (${entry.id})` }))];
      mount(workflowSelect, ...workflowOptions.map((option) => el("option", { value: option.value, text: option.label })));
      const queueOptions = [{ value: "", label: "No queue binding" }, ...state.queues.map((entry) => ({ value: entry.id, label: `${entry.name} (${entry.id})` }))];
      mount(queueSelect, ...queueOptions.map((option) => el("option", { value: option.value, text: option.label })));
    }

    function selectedWorkflow() {
      return state.workflows.find((entry) => entry.id === workflowSelect.value) || null;
    }

    function updateWorkflowHint() {
      const workflow = selectedWorkflow();
      const queue = state.queues.find((entry) => entry.id === queueSelect.value) || null;
      if (!workflow && !queue) {
        workflowHint.textContent = "Pick a workflow or a queue to see its parameters.";
        paramsHint.textContent = "";
        return;
      }
      if (workflow) {
        workflowHint.textContent = `${workflow.name || workflow.id} · ${workflow.queue ? `queue ${workflow.queue}` : "no queue binding"} · ${workflow.rpa ? "RPA" : "no RPA"}${workflow.web ? " + web" : ""}`;
        const params = workflow.parameters.map((entry) => `${entry.name}:${entry.type}${entry.required ? "*" : ""}`).join(", ");
        paramsHint.textContent = workflow.parameters.length ? `Parameters: ${params}` : "This workflow declares no parameters.";
      } else {
        workflowHint.textContent = `Queue ${queue.name}${queue.workflowId ? ` → workflow ${queue.workflowId}` : ""}`;
        paramsHint.textContent = queue.workflowId ? `The queue routes to ${queue.workflowId}.` : "This queue has no workflow binding.";
      }
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
      const [workflowResult, queueResult, robotResult, noderedResult] = await Promise.all([
        or.documents.query("workflows", { orderby: { name: 1 } }),
        or.workitems.listQueues(),
        or.robots.list(),
        or.nodered.list(),
      ]);
      if (Array.isArray(workflowResult)) state.workflows = workflowResult.map((entry) => normalizeWorkflow(entry.raw || entry));
      else state.loadError = workflowResult && workflowResult.error ? workflowResult.error.message : null;
      if (queueResult && queueResult.ok) state.queues = queueResult.queues;
      if (robotResult && robotResult.ok) {
        state.robots = robotResult.robots;
        state.robotSummary = or.robots.summarize(robotResult.robots);
      }
      if (noderedResult && noderedResult.ok) state.instances = noderedResult.instances;
      refreshHistory();
      syncOptions();
      updateWorkflowHint();
      state.loading = false;
      rerender();
      await refreshMonitor();
    }

    function refreshHistory() {
      state.invocations = or.invocation.history({ limit: 25 });
      state.pending = or.invocation.pending();
    }

    async function refreshMonitor() {
      state.monitor = monitor.connector("openrpa");
      state.monitorSummary = monitor.summary();
      state.monitorErrors = monitor.errors({ connector: "openrpa", limit: 6 });
      try {
        state.health = await or.health();
      } catch (error) {
        state.health = null;
      }
      rerender();
    }

    async function refreshRobots() {
      const result = await or.robots.list();
      if (result.ok) {
        state.robots = result.robots;
        state.robotSummary = or.robots.summarize(result.robots);
      } else {
        toast("Could not load robots.");
      }
      rerender();
    }

    async function refreshNodeRed() {
      const result = await or.nodered.list();
      if (result.ok) state.instances = result.instances;
      rerender();
    }

    function buildInvoke() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Invoke a workflow" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Trigger an OpenFlow workflow by id or by queue, await the correlated reply, and record it for audit." }));
      section.appendChild(head);
      section.appendChild(workflowHint);
      section.appendChild(paramsHint);

      const grid = el("div.pu-form-grid", { style: { "margin-top": "0.75rem" } });
      const row = el("div.pu-form-row");
      row.appendChild(field("Workflow", workflowSelect, "Invoke by workflow id when the workflow does not need a queue."));
      row.appendChild(field("Queue", queueSelect, "Invoke through a queue so an available robot claims it."));
      row.appendChild(field("Dispatcher", actorInput));
      row.appendChild(field("Timeout (ms)", timeoutInput, "How long to wait for the correlated completion."));
      grid.appendChild(row);
      grid.appendChild(field("Payload (JSON)", payloadInput));
      const row2 = el("div.pu-form-row");
      row2.appendChild(field("Correlation id", correlationInput, "Reuse a known id to correlate with an external system."));

      const failField = el("label.pu-field");
      const failLabel = el("span", { style: { display: "flex", gap: "0.4rem", "align-items": "center" } });
      failLabel.appendChild(failCheck);
      failLabel.appendChild(el("span.pu-small", { text: "Simulate a failure" }));
      failField.appendChild(failLabel);
      failField.appendChild(failMessageInput);
      row2.appendChild(failField);
      row2.appendChild(field("Delay (ms)", durationInput, "Emulator only — overrides the completion delay."));
      grid.appendChild(row2);
      section.appendChild(grid);

      const toolbar = el("div.pu-toolbar", { style: { "margin-top": "0.75rem", "margin-bottom": 0 } });
      toolbar.appendChild(invokeBtn);
      toolbar.appendChild(dispatchBtn);
      section.appendChild(toolbar);

      const resultCtn = el("div", { style: { "margin-top": "0.75rem" } });
      mount(resultCtn, buildInvocationResult());
      section.appendChild(resultCtn);
      return section;
    }

    function buildInvocationResult() {
      const wrap = el("div");
      if (!state.invocationResult) return wrap;
      const result = state.invocationResult;
      if (result.error && result.ok === false) {
        wrap.appendChild(alertNode(result.error.message || "The invocation failed.", "fail"));
        return wrap;
      }
      const record = result.invocation || null;
      if (!record) {
        wrap.appendChild(alertNode("The invocation returned no record.", "warn"));
        return wrap;
      }
      const alert = el(`div.pu-alert.${record.tone === "fail" ? "fail" : "ok"}`);
      const header = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      header.appendChild(el("strong", { text: record.stateLabel || record.state }));
      header.appendChild(chip(record.correlationId || "no correlation id", record.tone));
      if (result.timedOut || record.state === "timeout") header.appendChild(chip("timed out", "fail"));
      alert.appendChild(header);
      alert.appendChild(el("p.pu-small", { text: `${record.workflowId || record.queue || "workflow"} · instance ${record.instanceId || "—"} · ${record.durationMs != null ? `${record.durationMs} ms` : "—"}` }));
      if (record.error) alert.appendChild(el("p", { text: record.error }));
      if (result.awaiting) alert.appendChild(el("p.pu-small.pu-muted", { text: "Dispatched — the completion will appear in the results table below." }));
      wrap.appendChild(alert);
      if (record.result) {
        wrap.appendChild(el("h3", { text: "Result" }));
        wrap.appendChild(el("pre.pu-mono", { text: truncate(formatJson(record.result), 1200), style: { "white-space": "pre-wrap", "overflow-x": "auto" } }));
      }
      return wrap;
    }

    function buildResults() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Results & correlation" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Every invocation, its correlation id, duration and outcome are kept for audit." }));
      section.appendChild(head);

      if (state.pending.length) {
        section.appendChild(el("h3", { text: `Awaiting a reply (${state.pending.length})` }));
        const pendingList = el("ul.pu-list");
        for (const record of state.pending) {
          const li = el("li");
          li.appendChild(chip(record.correlationId, "warn"));
          li.appendChild(el("span.pu-small", { text: record.workflowId || record.queue || "workflow" }));
          const cancelBtn = button("Cancel", "secondary");
          cancelBtn.addEventListener("click", async () => {
            await or.invocation.cancel(record.correlationId);
            refreshHistory();
            rerender();
          });
          li.appendChild(cancelBtn);
          pendingList.appendChild(li);
        }
        section.appendChild(pendingList);
      }

      if (!state.invocations.length) {
        section.appendChild(emptyNode("No invocations yet — trigger a workflow above."));
        return section;
      }

      const scroll = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headerRow = el("tr");
      for (const label of ["Correlation id", "Workflow / queue", "State", "Duration", "Dispatched", "Outcome"]) headerRow.appendChild(el("th", { text: label }));
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const record of state.invocations) {
        const outcome = el("div");
        if (record.error) outcome.appendChild(el("span.pu-small", { text: truncate(record.error, 90) }));
        else outcome.appendChild(el("span.pu-small.pu-muted", { text: record.result ? truncate(formatJson(record.result), 90) : "—" }));
        addRow(tbody, [
          el("span.pu-mono", { text: record.correlationId || "—" }),
          `${record.workflowId || "—"}${record.queue ? ` · ${record.queue}` : ""}`,
          chip(record.stateLabel || record.state, record.tone),
          record.durationMs != null ? `${record.durationMs} ms` : "—",
          formatDate(record.invokedAt),
          outcome,
        ]);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
      section.appendChild(scroll);
      return section;
    }

    function buildRobots() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Robot registry & presence" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Robots discovered on OpenFlow, with their last heartbeat, version and load." }));
      const refreshBtn = button("Refresh", "secondary");
      refreshBtn.addEventListener("click", () => withBusy(refreshBtn, "Refreshing…", () => refreshRobots()));
      const beatAllBtn = button("Heartbeat all", null, "monitor.manage");
      beatAllBtn.addEventListener("click", () =>
        withBusy(beatAllBtn, "Sending…", async () => {
          const result = await or.robots.heartbeatAll({ metricsFor: (robot) => ({ cpu: robot.cpu != null ? robot.cpu : 10, memory: robot.memory != null ? robot.memory : 30 }) });
          state.heartbeatResult = result;
          await refreshRobots();
          toast(result.ok ? `Heartbeat sent to ${result.sent} robot(s).` : "Heartbeat failed.");
        })
      );
      head.appendChild(el("span", { style: { "margin-left": "auto", display: "flex", gap: "0.4rem", "flex-wrap": "wrap" } }, [refreshBtn, beatAllBtn]));
      section.appendChild(head);

      const summary = state.robotSummary;
      if (summary) {
        const chips = el("div.pu-toolbar");
        chips.appendChild(chip(`${summary.total} robots`, ""));
        chips.appendChild(chip(`${summary.online} online`, "ok"));
        chips.appendChild(chip(`${summary.stale} stale`, "warn"));
        chips.appendChild(chip(`${summary.offline} offline`, "fail"));
        const versions = Object.keys(summary.versions);
        if (versions.length) chips.appendChild(chip(`versions ${versions.join(", ")}`, ""));
        section.appendChild(chips);
      }

      if (!state.robots.length) {
        section.appendChild(emptyNode("No robots reported in."));
        return section;
      }

      const scroll = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headerRow = el("tr");
      for (const label of ["Robot", "Presence", "Last seen", "Version", "CPU / memory", "Queue", ""]) headerRow.appendChild(el("th", { text: label }));
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const robot of state.robots) {
        const beatBtn = button("Heartbeat", "secondary", "monitor.manage");
        beatBtn.addEventListener("click", () =>
          withBusy(beatBtn, "Sending…", async () => {
            const result = await or.robots.heartbeat(robot.id, { metrics: { cpu: robot.cpu != null ? robot.cpu : 12, memory: robot.memory != null ? robot.memory : 40 } });
            state.heartbeatResult = result;
            await refreshRobots();
            toast(result.ok ? `${robot.name} checked in.` : "Heartbeat failed.");
          })
        );
        const load = robot.cpu == null && robot.memory == null ? "—" : `${robot.cpu != null ? `${robot.cpu}%` : "—"} / ${robot.memory != null ? `${robot.memory}%` : "—"}`;
        addRow(tbody, [
          el("span.pu-entity-name", { text: robot.name }),
          chip(robot.presenceLabel, robot.tone),
          `${robot.ageLabel} · ${formatDate(robot.lastSeen)}`,
          robot.version || "—",
          load,
          robot.robotQueue || "—",
          beatBtn,
        ]);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
      section.appendChild(scroll);
      return section;
    }

    function buildNodeRed() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Node-RED instances" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Ensure, restart, delete and link the Node-RED instances this tenant owns." }));
      section.appendChild(head);

      const form = el("div.pu-form-row", { style: { "margin-top": "0.5rem" } });
      form.appendChild(field("Instance name", noderedNameInput));
      form.appendChild(field("URL", noderedUrlInput));
      const ensureField = el("div.pu-field");
      ensureField.appendChild(el("span.pu-small.pu-muted", { text: " " }));
      ensureField.appendChild(ensureBtn);
      form.appendChild(ensureField);
      section.appendChild(form);
      ensureBtn.addEventListener("click", () =>
        withBusy(ensureBtn, "Ensuring…", async () => {
          const result = await or.nodered.ensure(noderedNameInput.value, { url: noderedUrlInput.value || null });
          state.noderedResult = result;
          await refreshNodeRed();
          toast(result.ok ? `Instance "${result.instance.name}" is ready.` : result.error.message);
        })
      );

      if (state.noderedResult && state.noderedResult.ok === false) {
        section.appendChild(alertNode(state.noderedResult.error.message, "fail"));
      }

      if (!state.instances.length) {
        section.appendChild(emptyNode("No Node-RED instances registered."));
        return section;
      }

      const scroll = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headerRow = el("tr");
      for (const label of ["Instance", "State", "Version", "URL", "Hub connector", ""]) headerRow.appendChild(el("th", { text: label }));
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const instance of state.instances) {
        const actions = el("div", { style: { display: "flex", gap: "0.35rem", "flex-wrap": "wrap" } });
        const restartBtn = button("Restart", "secondary", "openrpa.manage");
        restartBtn.addEventListener("click", () =>
          withBusy(restartBtn, "Restarting…", async () => {
            const result = await or.nodered.restart(instance.name);
            await refreshNodeRed();
            toast(result.ok ? `${instance.name} restarted.` : result.error.message);
          })
        );
        const linkBtn = button(instance.linked ? "Unlink" : "Link to hub", "secondary", "openrpa.manage");
        linkBtn.addEventListener("click", () =>
          withBusy(linkBtn, "Linking…", async () => {
            const result = instance.linked ? await or.nodered.unlink(instance.name) : await or.nodered.link(instance.name, { connectorId: "openrpa" });
            await refreshNodeRed();
            toast(result.ok ? `${instance.name} ${instance.linked ? "unlinked" : "linked to openrpa"}.` : result.error.message);
          })
        );
        const deleteBtn = button("Delete", "secondary", "openrpa.manage");
        deleteBtn.addEventListener("click", () =>
          withBusy(deleteBtn, "Deleting…", async () => {
            const result = await or.nodered.remove(instance.name);
            await refreshNodeRed();
            toast(result.ok ? `${instance.name} deleted.` : result.error.message);
          })
        );
        actions.appendChild(restartBtn);
        actions.appendChild(linkBtn);
        actions.appendChild(deleteBtn);
        addRow(tbody, [
          el("span.pu-entity-name", { text: instance.name }),
          chip(OPENRPA_NODERED_LABELS[instance.state] || instance.state, OPENRPA_NODERED_TONES[instance.state] || instance.tone),
          instance.version || "—",
          instance.url || "—",
          instance.linked ? chip(instance.connectorId, "ok") : chip("unlinked", "warn"),
          actions,
        ]);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
      section.appendChild(scroll);
      return section;
    }

    function buildMonitor() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Connector monitoring" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Live health for the OpenRPA connection: state, latency, reconnects, queue depths and error rate." }));
      const actions = el("span", { style: { "margin-left": "auto", display: "flex", gap: "0.4rem", "flex-wrap": "wrap" } }, [probeBtn, injectBtn, restoreBtn]);
      head.appendChild(actions);
      section.appendChild(head);

      function syncMonitorButtons() {
        const active = monitor.incidents().some((entry) => entry.connector === "openrpa");
        injectBtn.disabled = active;
        restoreBtn.disabled = !active;
      }
      syncMonitorButtons();

      const health = state.health;
      const record = state.monitor;
      if (!health) {
        section.appendChild(loadingRow("Measuring the connection…"));
        return section;
      }

      const chips = el("div.pu-toolbar");
      chips.appendChild(chip(health.status, HEALTH_TONE[health.status] || ""));
      chips.appendChild(chip(`state ${health.state}`, ""));
      chips.appendChild(chip(`latency ${health.latencyMs != null ? `${health.latencyMs} ms` : "—"}`, ""));
      chips.appendChild(chip(`reconnects ${health.reconnectCount}`, health.reconnectWarning ? "warn" : ""));
      chips.appendChild(chip(`error rate ${Math.round(health.errorRate * 100)}%`, health.errorRate >= health.thresholds.errorRate ? "fail" : ""));
      section.appendChild(chips);

      const grid = el("div.pu-grid.cols-2");
      const left = el("div");
      left.appendChild(el("h3", { text: "Connection" }));
      const details = el("ul.pu-list");
      const rows = [
        ["Endpoint", health.mode === "live" ? "live WebSocket" : "in-browser emulator"],
        ["Sent / received", `${health.sent} / ${health.received}`],
        ["Failed / timeouts / retried", `${health.failed} / ${health.timeouts} / ${health.retried}`],
        ["Last probe", formatDate(record ? record.checkedAt : health.checkedAt)],
        ["Uptime (probes)", record && record.uptime != null ? `${record.uptime}% · ${record.attempts} attempts` : "—"],
        ["Thresholds", `${health.thresholds.degradedMs} ms degraded · ${health.thresholds.downMs} ms down`],
      ];
      for (const [label, value] of rows) {
        const li = el("li");
        li.appendChild(el("span.pu-small.pu-muted", { text: `${label}: ` }));
        li.appendChild(el("span.pu-small", { text: String(value) }));
        details.appendChild(li);
      }
      left.appendChild(details);
      grid.appendChild(left);

      const right = el("div");
      right.appendChild(el("h3", { text: "Queue depths" }));
      const depths = el("ul.pu-list");
      for (const [stateName, count] of Object.entries(health.queueDepths)) {
        const li = el("li");
        li.appendChild(chip(stateName, ""));
        li.appendChild(el("span.pu-small", { text: `${count} item(s)` }));
        depths.appendChild(li);
      }
      depths.appendChild(el("li", {}, [el("span.pu-small.pu-muted", { text: `Total ${health.queueTotal} item(s) across all queues.` })]));
      right.appendChild(depths);
      grid.appendChild(right);
      section.appendChild(grid);

      const errorBox = el("div", { style: { "margin-top": "0.75rem" } });
      const errs = state.monitorErrors;
      if (errs && errs.items && errs.items.length) {
        errorBox.appendChild(el("h3", { text: "Recent open errors" }));
        const list = el("ul.pu-list");
        for (const entry of errs.items) {
          const li = el("li");
          li.appendChild(chip(entry.severity, entry.severity === "error" ? "fail" : "warn"));
          li.appendChild(el("span.pu-small", { text: `${entry.title}${entry.detail ? ` — ${truncate(entry.detail, 120)}` : ""} (×${entry.count})` }));
          list.appendChild(li);
        }
        errorBox.appendChild(list);
      } else {
        errorBox.appendChild(el("p.pu-small.pu-muted", { text: `No open errors. Monitor availability across all connectors: ${state.monitorSummary ? `${state.monitorSummary.availability}%` : "—"}.` }));
      }
      section.appendChild(errorBox);
      return section;
    }

    invokeBtn.addEventListener("click", () => runInvocation(true, invokeBtn));
    dispatchBtn.addEventListener("click", () => runInvocation(false, dispatchBtn));
    workflowSelect.addEventListener("change", () => {
      updateWorkflowHint();
      rerender();
    });
    queueSelect.addEventListener("change", () => {
      updateWorkflowHint();
      rerender();
    });

    probeBtn.addEventListener("click", () =>
      withBusy(probeBtn, "Probing…", async () => {
        await monitor.heartbeat({ connectors: ["openrpa"], trigger: "manual", force: true });
        await refreshMonitor();
        toast("Probe complete.");
      })
    );
    injectBtn.addEventListener("click", () =>
      withBusy(injectBtn, "Injecting…", async () => {
        monitor.injectIncident("openrpa", { status: "down", latencyMs: 0 });
        await monitor.heartbeat({ connectors: ["openrpa"], trigger: "manual", force: true });
        await refreshMonitor();
        toast("Outage simulated.");
      })
    );
    restoreBtn.addEventListener("click", () =>
      withBusy(restoreBtn, "Restoring…", async () => {
        monitor.clearIncident("openrpa");
        await monitor.heartbeat({ connectors: ["openrpa"], trigger: "manual", force: true });
        await refreshMonitor();
        toast("Connector restored.");
      })
    );

    async function runInvocation(wait, triggerBtn) {
      const workflowId = workflowSelect.value || null;
      const queue = queueSelect.value || null;
      if (!workflowId && !queue) {
        state.invocationResult = { ok: false, error: { message: "Choose a workflow id or a queue to invoke." } };
        rerender();
        return;
      }
      const raw = payloadInput.value.trim();
      let payload = {};
      if (raw) {
        try {
          payload = JSON.parse(raw);
        } catch (error) {
          state.invocationResult = { ok: false, error: { message: `The payload is not valid JSON: ${error.message}` } };
          rerender();
          return;
        }
        if (payload == null || typeof payload !== "object" || Array.isArray(payload)) {
          state.invocationResult = { ok: false, error: { message: "An invocation payload must be a JSON object." } };
          rerender();
          return;
        }
      }
      await withBusy(triggerBtn, wait ? "Invoking…" : "Dispatching…", async () => {
        state.invoking = true;
        const result = await or.invocation.invoke({
          workflowId,
          queue,
          payload,
          correlationId: correlationInput.value.trim() || null,
          timeoutMs: timeoutInput.value ? Number(timeoutInput.value) : null,
          actor: actorInput.value.trim() || null,
          simulateError: failCheck.checked,
          errorMessage: failMessageInput.value.trim() || null,
          durationMs: durationInput.value !== "" ? Number(durationInput.value) : null,
          wait,
        });
        state.invocationResult = result;
        state.invoking = false;
        refreshHistory();
        await refreshMonitor();
        rerender();
        if (result.ok) toast(wait ? "Invocation finished." : "Invocation dispatched.");
        else toast(result.error ? result.error.message : "The invocation failed.");
      });
    }

    const header = pageHead({
      eyebrow: "OpenRPA / OpenFlow",
      title: "Automation & monitoring",
      subtitle: "Invoke workflows with a correlated reply, watch the robot fleet, manage Node-RED instances, and read the live health of the connection.",
    });

    mount(root, header, statsCtn, errorCtn, invokeCtn, resultsCtn, robotsCtn, noderedCtn, monitorCtn);
    mount(resultsCtn, loadingRow("Loading invocations…"));

    load();

    if (typeof onDestroy === "function") {
      onDestroy(() => {
        destroyed = true;
      });
    }
    return root;
  },
};
