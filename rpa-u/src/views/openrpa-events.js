import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { OPENRPA_BRIDGE_WATCH_COLLECTIONS } from "../core/openrpa/constants.js";
import { OPENRPA_BRIDGE_DROP_POLICIES } from "../core/openrpa/bridge.js";
import { OPENRPA_TAXONOMY_VERSION, describeTaxonomy, registerOpenRpaTaxonomy } from "../core/openrpa/taxonomy.js";

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

const TOPIC_LABELS = { workitem: "Work items", workflow: "Workflows", robot: "Robots", collection: "Collections" };

export const openrpaEventsView = {
  id: "openrpa-events",
  title: "Event bus bridge",
  group: "OpenRPA",
  icon: "rpa",
  nav: true,
  render({ hub, onDestroy }) {
    const or = hub.openrpa;
    const bridge = or.bridge;
    const root = el("div");
    let destroyed = false;

    const state = {
      loading: true,
      loadError: null,
      stats: null,
      registration: null,
      watches: [],
      taxonomy: null,
      audit: null,
      filters: { topic: "", type: "", correlationId: "", from: "", to: "", limit: 40 },
      lastAction: null,
    };

    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const errorCtn = el("div", { style: { "margin-bottom": "1rem" } });
    const controlCtn = el("div");
    const taxonomyCtn = el("div");
    const watchCtn = el("div");
    const streamCtn = el("div");

    const enableBtn = button("Enable bridge", null, "openrpa.run");
    const disableBtn = button("Disable", "secondary", "openrpa.run");
    const registerBtn = button("Register now", "secondary", "openrpa.run");
    const watchAllBtn = button("Watch all defaults", "secondary", "openrpa.run");
    const policySelect = selectOf(
      OPENRPA_BRIDGE_DROP_POLICIES.map((value) => ({ value, label: value })),
      { label: "Backpressure policy" }
    );
    const watchCollectionSelect = selectOf(
      OPENRPA_BRIDGE_WATCH_COLLECTIONS.map((value) => ({ value, label: value })),
      { label: "Collection to watch" }
    );
    const watchFilterInput = el("input.pu-input", { type: "text", "aria-label": "Watch filter", placeholder: '{"state":"new"} (optional)' });
    const watchBtn = button("Watch collection", null, "openrpa.run");

    const topicFilter = el("input.pu-input", { type: "text", "aria-label": "Topic filter", placeholder: "workitem.*" });
    const typeFilter = el("input.pu-input", { type: "text", "aria-label": "Type filter", placeholder: "workitem.enqueued" });
    const correlationFilter = el("input.pu-input", { type: "text", "aria-label": "Correlation filter", placeholder: "wf_…" });
    const fromFilter = el("input.pu-input", { type: "text", "aria-label": "From time", placeholder: "2026-01-01T00:00:00Z" });
    const toFilter = el("input.pu-input", { type: "text", "aria-label": "To time", placeholder: "now" });
    const limitFilter = el("input.pu-input", { type: "number", min: "1", "aria-label": "Limit", placeholder: "40" });
    const auditBtn = button("Filter journal");
    const replayBtn = button("Replay to bus", null, "events.run");
    const clearFiltersBtn = button("Clear filters", "secondary");

    function rerender() {
      if (destroyed) return;
      renderStats();
      mount(errorCtn, state.loadError ? alertNode(state.loadError, "fail") : null);
      mount(controlCtn, buildControl());
      mount(taxonomyCtn, buildTaxonomy());
      mount(watchCtn, buildWatches());
      mount(streamCtn, buildStream());
    }

    function renderStats() {
      const stats = state.stats || {};
      const registration = state.registration || {};
      mount(
        statsCtn,
        statCard("Bridge", stats.enabled ? "enabled" : "disabled", registration.exchange || "openrpa.bridge", stats.enabled ? "ok" : "warn"),
        statCard("Registered queues", registration.queues ? registration.queues.length : 0, registration.connected ? "exchange + queues live" : "not registered", registration.connected ? "ok" : "warn"),
        statCard("Watches", (state.watches || []).length, "OpenFlow change streams"),
        statCard("Journal", stats.journal || 0, `${stats.emitted || 0} emitted · ${stats.rejected || 0} rejected`)
      );
    }

    function readFilters() {
      return {
        topic: topicFilter.value.trim() || null,
        type: typeFilter.value.trim() || null,
        correlationId: correlationFilter.value.trim() || null,
        from: fromFilter.value.trim() || null,
        to: toFilter.value.trim() || null,
        limit: limitFilter.value ? Math.max(1, Number(limitFilter.value)) : 40,
      };
    }

    function refreshState() {
      state.stats = bridge.stats();
      state.registration = bridge.registration();
      state.watches = bridge.watches();
      state.taxonomy = { version: OPENRPA_TAXONOMY_VERSION, entries: describeTaxonomy(), report: registerOpenRpaTaxonomy({ catalog: hub.bus.catalog }) };
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
      refreshState();
      runAudit();
      state.loading = false;
      rerender();
    }

    function runAudit() {
      state.audit = bridge.audit(readFilters());
      return state.audit;
    }

    function buildControl() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Bridge control" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Register the exchange and every queue, then stream OpenFlow change notifications onto the hub's versioned event bus." }));
      const buttons = el("span", { style: { "margin-left": "auto", display: "flex", gap: "0.4rem", "flex-wrap": "wrap" } }, [registerBtn, enableBtn, disableBtn]);
      head.appendChild(buttons);
      section.appendChild(head);

      const stats = state.stats || {};
      const chips = el("div.pu-toolbar");
      chips.appendChild(chip(`state ${stats.connected ? "connected" : "offline"}`, stats.connected ? "ok" : "warn"));
      chips.appendChild(chip(`policy ${stats.dropPolicy || "drop-oldest"}`, ""));
      chips.appendChild(chip(`buffer ${stats.buffered || 0}/${stats.bufferLimit || 0}`, ""));
      chips.appendChild(chip(`batch ${stats.batchSize || 0}`, ""));
      chips.appendChild(chip(`seq ${stats.seq || 0}`, ""));
      chips.appendChild(chip(`reconnects ${stats.reconnects || 0}`, stats.reconnects ? "warn" : ""));
      section.appendChild(chips);

      const form = el("div.pu-form-row", { style: { "margin-top": "0.5rem" } });
      form.appendChild(field("Backpressure policy", policySelect, "How the buffer behaves when it is full: drop the oldest, refuse the newest, or coalesce keyed heartbeats."));
      section.appendChild(form);

      if (stats.lastError) section.appendChild(alertNode(stats.lastError, "fail"));
      if (state.lastAction) section.appendChild(el("p.pu-small.pu-muted", { text: state.lastAction }));
      return section;
    }

    function buildTaxonomy() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "OpenRPA event taxonomy" }));
      const taxonomy = state.taxonomy;
      if (taxonomy) {
        head.appendChild(chip(`v${taxonomy.version}`, ""));
        head.appendChild(chip(taxonomy.report.ok ? "registered" : "incomplete", taxonomy.report.ok ? "ok" : "warn"));
      }
      section.appendChild(head);
      if (!taxonomy) {
        section.appendChild(loadingRow("Reading the taxonomy…"));
        return section;
      }
      section.appendChild(el("p.pu-small.pu-muted", { text: `${taxonomy.report.registered.length} of ${taxonomy.report.types.length} OpenRPA types are registered on the bus catalog, across ${taxonomy.report.topics.length} topics.` }));
      const grid = el("div.pu-grid.cols-2", { style: { "margin-top": "0.5rem" } });
      for (const entry of taxonomy.entries) {
        const card = el("div");
        card.appendChild(el("h3", { text: entry.label }));
        card.appendChild(el("p.pu-small.pu-muted", { text: entry.summary }));
        const list = el("ul.pu-list");
        for (const type of entry.types) {
          const row = el("li");
          const registered = taxonomy.report.registered.includes(type);
          row.appendChild(chip(type, registered ? "ok" : "warn"));
          list.appendChild(row);
        }
        card.appendChild(list);
        grid.appendChild(card);
      }
      section.appendChild(grid);
      if (!taxonomy.report.ok) {
        const missing = taxonomy.report.missing.concat(taxonomy.report.mismatched.map((entry) => `${entry.type}@${entry.found}`));
        section.appendChild(alertNode(`Unregistered: ${missing.join(", ")}`, "warn"));
      }
      return section;
    }

    function buildWatches() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Document change streams" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Subscribe to OpenFlow document watches; matching inserts, updates and deletes arrive as collection.changed events." }));
      head.appendChild(el("span", { style: { "margin-left": "auto" } }, [watchAllBtn]));
      section.appendChild(head);

      const form = el("div.pu-form-row", { style: { "margin-top": "0.5rem" } });
      form.appendChild(field("Collection", watchCollectionSelect));
      form.appendChild(field("Filter (JSON)", watchFilterInput, "Optional field filter, e.g. {\"state\":\"new\"}."));
      const watchField = el("div.pu-field");
      watchField.appendChild(el("span.pu-small.pu-muted", { text: " " }));
      watchField.appendChild(watchBtn);
      form.appendChild(watchField);
      section.appendChild(form);

      if (!state.watches.length) {
        section.appendChild(emptyNode("No watches registered — enable the bridge and watch a collection."));
        return section;
      }

      const scroll = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headerRow = el("tr");
      for (const label of ["Watch id", "Collection", "Filter", "Registered", ""]) headerRow.appendChild(el("th", { text: label }));
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const watch of state.watches) {
        const unwatchBtn = button("Unwatch", "secondary", "openrpa.run");
        unwatchBtn.disabled = !watch.watchId;
        unwatchBtn.addEventListener("click", () =>
          withBusy(unwatchBtn, "Removing…", async () => {
            const result = await bridge.unwatch(watch.watchId);
            refreshState();
            runAudit();
            rerender();
            toast(result.ok ? `Watch ${watch.collection} removed.` : result.error);
          })
        );
        addRow(tbody, [
          el("span.pu-mono", { text: watch.watchId || "—" }),
          watch.collection || "—",
          watch.filter ? el("span.pu-mono", { text: truncate(JSON.stringify(watch.filter), 60) }) : "—",
          formatDate(watch.at),
          unwatchBtn,
        ]);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
      section.appendChild(scroll);
      return section;
    }

    function buildStream() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Bridged event stream" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Every normalized envelope the connector has journaled, with its sequence number, correlation id and delivery status." }));
      section.appendChild(head);

      const grid = el("div.pu-form-grid", { style: { "margin-top": "0.5rem" } });
      const row = el("div.pu-form-row");
      row.appendChild(field("Topic", topicFilter, "Exact topic or a pattern like workitem.*"));
      row.appendChild(field("Type", typeFilter));
      row.appendChild(field("Correlation id", correlationFilter));
      row.appendChild(field("Limit", limitFilter));
      grid.appendChild(row);
      const row2 = el("div.pu-form-row");
      row2.appendChild(field("From", fromFilter, "ISO timestamp or sequence number."));
      row2.appendChild(field("To", toFilter, "ISO timestamp or sequence number."));
      row2.appendChild(field(" ", clearFiltersBtn));
      grid.appendChild(row2);
      section.appendChild(grid);

      const toolbar = el("div.pu-toolbar", { style: { "margin-top": "0.75rem", "margin-bottom": 0 } }, [auditBtn, replayBtn]);
      section.appendChild(toolbar);

      const audit = state.audit;
      if (!audit) {
        section.appendChild(loadingRow("Reading the journal…"));
        return section;
      }
      const summary = el("div.pu-toolbar", { style: { "margin-bottom": 0 } });
      summary.appendChild(chip(`${audit.total} journaled`, ""));
      summary.appendChild(chip(`${audit.matched} matched`, audit.matched ? "ok" : ""));
      for (const [topic, count] of Object.entries(audit.byTopic)) summary.appendChild(chip(`${topic} ${count}`, ""));
      section.appendChild(summary);

      if (!audit.events.length) {
        section.appendChild(emptyNode("No bridged events match these filters."));
        return section;
      }

      const scroll = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headerRow = el("tr");
      for (const label of ["Seq", "Time", "Topic", "Type", "Correlation id", "Delivery"]) headerRow.appendChild(el("th", { text: label }));
      thead.appendChild(headerRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const entry of audit.events) {
        addRow(tbody, [
          el("span.pu-mono", { text: String(entry.seq) }),
          formatDate(entry.at),
          chip(TOPIC_LABELS[entry.topic] || entry.topic, entry.topic === "workitem" ? "ok" : entry.topic === "workflow" ? "warn" : ""),
          el("span.pu-mono", { text: entry.type }),
          entry.correlationId ? el("span.pu-mono", { text: entry.correlationId }) : "—",
          entry.delivered ? chip("emitted", "ok") : chip("journaled", "warn"),
        ]);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
      section.appendChild(scroll);
      return section;
    }

    enableBtn.addEventListener("click", () =>
      withBusy(enableBtn, "Enabling…", async () => {
        const result = await bridge.enable({ collections: OPENRPA_BRIDGE_WATCH_COLLECTIONS });
        refreshState();
        runAudit();
        rerender();
        toast(result.ok ? `Bridge enabled · ${result.queues.length} queue(s) registered.` : "The bridge registered with errors.");
      })
    );
    disableBtn.addEventListener("click", () =>
      withBusy(disableBtn, "Disabling…", async () => {
        await bridge.disable();
        refreshState();
        rerender();
        toast("Bridge disabled.");
      })
    );
    registerBtn.addEventListener("click", () =>
      withBusy(registerBtn, "Registering…", async () => {
        const result = await bridge.register();
        state.lastAction = result.ok ? `Registered exchange and ${result.queues.length} queue(s) at ${formatDate(new Date().toISOString())}.` : `Registration reported: ${result.errors.join("; ")}`;
        refreshState();
        rerender();
        toast(result.ok ? "Exchange and queues registered." : "Registration reported errors.");
      })
    );
    watchAllBtn.addEventListener("click", () =>
      withBusy(watchAllBtn, "Watching…", async () => {
        const result = await bridge.watchMany(OPENRPA_BRIDGE_WATCH_COLLECTIONS);
        refreshState();
        rerender();
        toast(result.ok ? `Watching ${result.watches.length} collection(s).` : "Some watches could not be registered.");
      })
    );
    watchBtn.addEventListener("click", () =>
      withBusy(watchBtn, "Watching…", async () => {
        let filter = null;
        const raw = watchFilterInput.value.trim();
        if (raw) {
          try {
            filter = JSON.parse(raw);
          } catch (error) {
            toast(`The watch filter is not valid JSON: ${error.message}`);
            return;
          }
        }
        const result = await bridge.watch(watchCollectionSelect.value, { filter });
        refreshState();
        rerender();
        toast(result.ok ? `Watching ${result.watch.collection}.` : result.error);
      })
    );
    policySelect.addEventListener("change", () => {
      bridge.setDropPolicy(policySelect.value);
      refreshState();
      rerender();
    });
    auditBtn.addEventListener("click", () => {
      runAudit();
      rerender();
    });
    clearFiltersBtn.addEventListener("click", () => {
      topicFilter.value = "";
      typeFilter.value = "";
      correlationFilter.value = "";
      fromFilter.value = "";
      toFilter.value = "";
      limitFilter.value = "";
      runAudit();
      rerender();
    });
    replayBtn.addEventListener("click", () =>
      withBusy(replayBtn, "Replaying…", async () => {
        const filters = readFilters();
        const result = await bridge.replay(filters, async (entry) => {
          await hub.publish(entry.type, entry.payload, { source: "openrpa", ...(entry.correlationId ? { correlationId: entry.correlationId } : {}) });
        });
        state.lastAction = `Replayed ${result.replayed} of ${result.matched} matching event(s) onto the hub bus.`;
        runAudit();
        rerender();
        toast(`Replayed ${result.replayed} event(s).`);
      })
    );

    const header = pageHead({
      eyebrow: "OpenRPA / OpenFlow",
      title: "Event bus bridge",
      subtitle: "Register OpenFlow exchanges and queues, subscribe to document change streams, and translate the connector's notifications into normalized, versioned hub events with ordering, backpressure, replay and audit.",
    });

    mount(root, header, statsCtn, errorCtn, controlCtn, taxonomyCtn, watchCtn, streamCtn);
    mount(streamCtn, loadingRow("Reading the journal…"));

    load();

    if (typeof onDestroy === "function") {
      onDestroy(() => {
        destroyed = true;
      });
    }
    return root;
  },
};
