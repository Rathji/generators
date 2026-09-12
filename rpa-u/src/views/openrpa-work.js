import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import {
  OPENRPA_WORK_STATES,
  OPENRPA_STATE_LABELS,
  OPENRPA_STATE_TONES,
  OPENRPA_PRIORITIES,
  OPENRPA_STATE_TRANSITIONS,
  isTerminalState,
} from "../core/openrpa/workitems.js";
import { formatBytes, isImageContentType } from "../core/openrpa/files.js";

const KIND_TONE = { conflict: "warn", validation: "fail", transport: "fail", "not-found": "warn", server: "fail" };
const KIND_LABEL = { conflict: "version conflict", validation: "validation", transport: "transport", "not-found": "not found", server: "server" };
const TERMINAL_HINT = { success: "Terminal", failed: "Terminal", abandoned: "Terminal" };

function statCard(label, value, hint) {
  const card = el("article.pu-card.pu-stat");
  card.appendChild(el("span.pu-stat-label", { text: label }));
  card.appendChild(el("span.pu-stat-value", { text: String(value) }));
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

function formatDate(value) {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

function truncate(value, max = 120) {
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

export const openrpaWorkView = {
  id: "openrpa-work",
  title: "OpenRPA work board",
  group: "OpenRPA",
  icon: "rpa",
  nav: true,
  render({ hub, onDestroy }) {
    const or = hub.openrpa;
    const root = el("div");
    let destroyed = false;

    const state = {
      loaded: false,
      loading: false,
      loadError: null,
      queues: [],
      overview: { queues: [], orphans: [], total: 0 },
      files: [],
      globalCounts: { new: 0, processing: 0, success: 0, failed: 0, abandoned: 0 },
      board: null,
      boardLoading: false,
      filters: { queueId: "", state: "", priority: "", search: "", page: 1, pageSize: 10 },
      selectedId: null,
      selected: null,
      actionResult: null,
      editingQueueId: null,
      queueResult: null,
      enqueueResult: null,
      fileResult: null,
      worker: "operator",
      errorMessage: "",
      errorSource: "",
      errorType: "",
    };

    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const globalErrorCtn = el("div", { style: { "margin-bottom": "1rem" } });
    const boardCtn = el("div");
    const inspectorCtn = el("div");
    const enqueueCtn = el("div");
    const queuesCtn = el("div");
    const filesCtn = el("div");

    const boardQueueSelect = selectOf([{ value: "", label: "All queues" }], { label: "Filter by queue" });
    const boardStateSelect = selectOf([{ value: "", label: "All states" }, ...OPENRPA_WORK_STATES.map((s) => ({ value: s, label: OPENRPA_STATE_LABELS[s] }))], { label: "Filter by state" });
    const boardPrioritySelect = selectOf([{ value: "", label: "All priorities" }, ...OPENRPA_PRIORITIES.map((p) => ({ value: p, label: p }))], { label: "Filter by priority" });
    const boardSearchInput = el("input.pu-input", { type: "search", "aria-label": "Search work items", placeholder: "id, payload, error…" });
    const boardPageSizeSelect = selectOf([5, 10, 25, 50].map((n) => ({ value: String(n), label: `${n} per page` })), { value: "10", label: "Page size" });
    const workerInput = el("input.pu-input", { type: "text", "aria-label": "Worker name", placeholder: "worker", style: { "max-width": "12rem" } });
    const claimBtn = el("button.pu-btn", { type: "button", text: "Claim next", "data-permission": "openrpa.run", "data-mutating": "" });

    const enqueueQueueSelect = selectOf([], { label: "Enqueue queue" });
    const enqueueNameInput = el("input.pu-input", { type: "text", "aria-label": "Item name", placeholder: "optional label" });
    const enqueuePayloadInput = el("textarea.pu-textarea", { "aria-label": "Payload JSON", spellcheck: "false", placeholder: '{ "invoiceId": "iv_2001" }', style: { "min-height": "7rem", "font-family": "ui-monospace, Menlo, monospace", "font-size": "0.78rem" } });
    const enqueuePrioritySelect = selectOf(OPENRPA_PRIORITIES.map((p) => ({ value: p, label: p })), { value: "normal", label: "Priority" });
    const enqueueNextRunInput = el("input.pu-input", { type: "text", "aria-label": "Next run", placeholder: "2026-01-01T09:00:00Z (optional)" });
    const enqueueMaxRetriesInput = el("input.pu-input", { type: "number", min: "0", "aria-label": "Max retries override", placeholder: "override" });
    const enqueueFilesInput = el("input.pu-input", { type: "text", "aria-label": "Attach stored files by id", placeholder: "file ids, comma separated" });
    const batchInput = el("textarea.pu-textarea", { "aria-label": "Bulk items JSON", spellcheck: "false", placeholder: '[ { "payload": { "invoiceId": "iv_1" } }, { "payload": { "invoiceId": "iv_2" }, "priority": "high" } ]', style: { "min-height": "7rem", "font-family": "ui-monospace, Menlo, monospace", "font-size": "0.78rem" } });

    const queueNameInput = el("input.pu-input", { type: "text", "aria-label": "Queue name", placeholder: "invoice-queue" });
    const queueWorkflowInput = el("input.pu-input", { type: "text", "aria-label": "Workflow binding", placeholder: "wf_invoice" });
    const queueRobotInput = el("input.pu-input", { type: "text", "aria-label": "Robot queue", placeholder: "robot-invoice" });
    const queueAmqpInput = el("input.pu-input", { type: "text", "aria-label": "AMQP queue", placeholder: "openrpa.invoice" });
    const queueMaxRetriesInput = el("input.pu-input", { type: "number", min: "0", "aria-label": "Max retries" });
    const queueRetryDelayInput = el("input.pu-input", { type: "number", min: "0", "aria-label": "Retry delay seconds" });
    const queueInitialDelayInput = el("input.pu-input", { type: "number", min: "0", "aria-label": "Initial delay seconds" });
    const queueSuccessInput = el("input.pu-input", { type: "text", "aria-label": "Success queue id", placeholder: "queue id (optional)" });
    const queueFailedInput = el("input.pu-input", { type: "text", "aria-label": "Failed queue id", placeholder: "queue id (optional)" });
    const queuePurgeCheck = el("input", { type: "checkbox" });

    const fileFilenameInput = el("input.pu-input", { type: "text", "aria-label": "File name", placeholder: "report.csv" });
    const fileContentTypeInput = el("input.pu-input", { type: "text", "aria-label": "Content type", placeholder: "auto from extension" });
    const fileContentInput = el("textarea.pu-textarea", { "aria-label": "File content", spellcheck: "false", placeholder: "text content, or base64 when encoding=base64", style: { "min-height": "5rem", "font-family": "ui-monospace, Menlo, monospace", "font-size": "0.78rem" } });
    const fileEncodingSelect = selectOf([{ value: "utf8", label: "utf8 text" }, { value: "base64", label: "base64" }], { value: "utf8", label: "Content encoding" });
    const fileRefIdInput = el("input.pu-input", { type: "text", "aria-label": "File ref id", placeholder: "workflow or item id (optional)" });
    const fileRefInput = el("input.pu-input", { type: "text", "aria-label": "File ref kind", placeholder: "workflow / workitem" });

    const itemPayloadInput = el("textarea.pu-textarea", { "aria-label": "Item payload", spellcheck: "false", style: { "min-height": "6rem", "font-family": "ui-monospace, Menlo, monospace", "font-size": "0.78rem" } });
    const itemPrioritySelect = selectOf(OPENRPA_PRIORITIES.map((p) => ({ value: p, label: p })), { label: "Item priority" });
    const itemRetriesInput = el("input.pu-input", { type: "number", min: "0", "aria-label": "Item retries" });
    const itemErrorTypeInput = el("input.pu-input", { type: "text", "aria-label": "Error type", placeholder: "TimeoutException" });
    const itemErrorMessageInput = el("input.pu-input", { type: "text", "aria-label": "Error message", placeholder: "what went wrong" });
    const itemErrorSourceInput = el("input.pu-input", { type: "text", "aria-label": "Error source", placeholder: "wf_invoice" });
    const itemStateSelect = el("select.pu-select", { "aria-label": "Move item to state" });
    const attachFilenameInput = el("input.pu-input", { type: "text", "aria-label": "Attachment name", placeholder: "screenshot.png" });
    const attachContentInput = el("textarea.pu-textarea", { "aria-label": "Attachment content", spellcheck: "false", style: { "min-height": "4rem", "font-family": "ui-monospace, Menlo, monospace", "font-size": "0.78rem" } });

    function rerender() {
      if (destroyed) return;
      renderStats();
      mount(boardCtn, buildBoard());
      mount(inspectorCtn, buildInspector());
      mount(enqueueCtn, buildEnqueue());
      mount(queuesCtn, buildQueues());
      mount(filesCtn, buildFiles());
      mount(globalErrorCtn, state.loadError ? alertNode(state.loadError, "fail") : null);
    }

    function renderStats() {
      mount(
        statsCtn,
        statCard("Queues", state.queues.length, state.overview.orphans.length ? `${state.overview.orphans.length} orphaned queue id(s)` : "queue definitions"),
        statCard("Pending", state.globalCounts.new || 0, "state new"),
        statCard("In flight", state.globalCounts.processing || 0, "state processing"),
        statCard("Failed", state.globalCounts.failed || 0, `${state.globalCounts.success || 0} succeeded`),
        statCard("Stored files", state.files.length, "in OpenFlow")
      );
    }

    function syncQueueOptions() {
      const options = [{ value: "", label: "All queues" }, ...state.queues.map((queue) => ({ value: queue.id, label: `${queue.name} (${queue.id})` }))];
      mount(boardQueueSelect, ...options.map((option) => el("option", { value: option.value, text: option.label })));
      boardQueueSelect.value = state.filters.queueId || "";
      const enqueueOptions = state.queues.map((queue) => ({ value: queue.id, text: `${queue.name} (${queue.id})` }));
      mount(enqueueQueueSelect, ...enqueueOptions.map((option) => el("option", { value: option.value, text: option.text })));
      if (state.filters.queueId) enqueueQueueSelect.value = state.filters.queueId;
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
      const queuesResult = await or.workitems.listQueues();
      if (!queuesResult.ok) {
        state.loading = false;
        state.loadError = queuesResult.error.message;
        rerender();
        return;
      }
      state.queues = queuesResult.queues;
      const overviewResult = await or.workitems.queueOverview();
      if (overviewResult.ok) state.overview = overviewResult;
      const filesResult = await or.files.list({});
      if (filesResult.ok) state.files = filesResult.files;
      const countsResult = await or.workitems.countsFor(null);
      if (countsResult.ok) state.globalCounts = countsResult.counts;
      state.loading = false;
      syncQueueOptions();
      workerInput.value = state.worker;
      rerender();
      await runBoard({ page: 1 });
    }

    async function refreshCounts() {
      const countsResult = await or.workitems.countsFor(null);
      if (countsResult.ok) state.globalCounts = countsResult.counts;
    }

    async function runBoard({ page = 1 } = {}) {
      state.boardLoading = true;
      rerender();
      const result = await or.workitems.board({
        queueId: state.filters.queueId || null,
        state: state.filters.state || null,
        priority: state.filters.priority || null,
        search: state.filters.search,
        page,
        pageSize: state.filters.pageSize,
      });
      state.boardLoading = false;
      if (!result.ok) {
        state.loadError = result.error.message;
        rerender();
        return;
      }
      state.loadError = null;
      state.board = result;
      state.filters.page = result.page;
      if (state.selectedId && !result.items.some((item) => item.id === state.selectedId)) {
        state.selected = null;
        state.selectedId = null;
      }
      rerender();
    }

    function selectItem(item) {
      state.selectedId = item.id;
      state.selected = item;
      state.actionResult = null;
      state.errorMessage = item.error.message || "";
      state.errorSource = item.error.source || "";
      state.errorType = item.error.type || "";
      itemPayloadInput.value = item.payloadValid ? JSON.stringify(item.payload, null, 2) : item.payloadText;
      itemPrioritySelect.value = item.priority;
      itemRetriesInput.value = String(item.retries);
      itemErrorTypeInput.value = state.errorType;
      itemErrorMessageInput.value = state.errorMessage;
      itemErrorSourceInput.value = state.errorSource;
      const allowed = [item.state, ...(OPENRPA_STATE_TRANSITIONS[item.state] || [])];
      mount(itemStateSelect, ...allowed.map((s) => el("option", { value: s, text: OPENRPA_STATE_LABELS[s] || s })));
      itemStateSelect.value = item.state;
      attachFilenameInput.value = "";
      attachContentInput.value = "";
      rerender();
    }

    function clearSelection() {
      state.selectedId = null;
      state.selected = null;
      state.actionResult = null;
      rerender();
    }

    async function refreshAfterChange() {
      await refreshCounts();
      const overviewResult = await or.workitems.queueOverview();
      if (overviewResult.ok) state.overview = overviewResult;
      const filesResult = await or.files.list({});
      if (filesResult.ok) state.files = filesResult.files;
      await runBoard({ page: state.filters.page });
    }

    function describeResult(result) {
      if (!result) return null;
      if (result.ok === false) return { tone: "fail", kind: result.error.kind, title: result.error.message, retryable: result.error.retryable };
      return { tone: "ok", title: "Done." };
    }

    async function perform(label, task) {
      const result = await task();
      state.actionResult = describeResult(result);
      if (result && result.ok && result.item && state.selectedId === result.item.id) state.selected = result.item;
      toast(result && result.ok === false ? result.error.message : label, { tone: result && result.ok === false ? "error" : "success" });
      await refreshAfterChange();
      return result;
    }

    function buildBoard() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Work board" }));
      head.appendChild(chip(or.mode(), ""));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "Every work item, grouped by state with queue, priority and text filters. Claim the next due item from a queue, inspect a payload, drill into an error, then retry, cancel, requeue or delete it. Claiming honours the queue priority order and skips items whose next-run time is still in the future.",
        })
      );

      if (state.loading) {
        card.appendChild(el("div", { style: { "margin-top": "0.75rem" } }, loadingRow("Loading queues and work items…")));
        return card;
      }

      const controls = el("div.pu-form-grid", { style: { "margin-top": "0.75rem" } });
      const row1 = el("div.pu-form-row");
      row1.appendChild(field("Queue", boardQueueSelect));
      row1.appendChild(field("State", boardStateSelect));
      row1.appendChild(field("Priority", boardPrioritySelect));
      row1.appendChild(field("Search", boardSearchInput));
      controls.appendChild(row1);
      const row2 = el("div.pu-form-row");
      row2.appendChild(field("Worker", workerInput, "Recorded as the claimant when you pop an item."));
      row2.appendChild(field("Page size", boardPageSizeSelect));
      row2.appendChild(
        el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "flex-end", "flex-wrap": "wrap" } },
          claimBtn,
          (() => {
            const refreshBtn = el("button.pu-btn.secondary", { type: "button", text: "Refresh" });
            refreshBtn.addEventListener("click", () => withBusy(refreshBtn, "Refreshing…", () => refreshAfterChange()));
            return refreshBtn;
          })()
        )
      );
      controls.appendChild(row2);
      card.appendChild(controls);

      boardQueueSelect.onchange = () => withBusy(boardQueueSelect, "Filtering…", async () => {
        state.filters.queueId = boardQueueSelect.value;
        state.filters.page = 1;
        await runBoard({ page: 1 });
      });
      boardStateSelect.onchange = () => {
        state.filters.state = boardStateSelect.value;
        runBoard({ page: 1 });
      };
      boardPrioritySelect.onchange = () => {
        state.filters.priority = boardPrioritySelect.value;
        runBoard({ page: 1 });
      };
      let searchTimer = null;
      boardSearchInput.oninput = () => {
        if (searchTimer) clearTimeout(searchTimer);
        searchTimer = setTimeout(() => {
          state.filters.search = boardSearchInput.value;
          runBoard({ page: 1 });
        }, 250);
      };
      boardPageSizeSelect.onchange = () => {
        state.filters.pageSize = Number(boardPageSizeSelect.value);
        runBoard({ page: 1 });
      };
      claimBtn.disabled = !state.filters.queueId || state.boardLoading;
      claimBtn.onclick = () => withBusy(claimBtn, "Claiming…", async () => {
        state.worker = workerInput.value.trim() || "operator";
        const result = await perform("Claimed the next item", () => or.workitems.claim(state.filters.queueId, { worker: state.worker }));
        if (result.ok && result.item) selectItem(result.item);
      });

      if (state.board) {
        const countsRow = el("div", { style: { display: "flex", gap: "0.4rem", "flex-wrap": "wrap", "margin-top": "0.75rem" } });
        for (const workState of OPENRPA_WORK_STATES) {
          const count = state.board.counts[workState] || 0;
          const active = state.filters.state === workState;
          const button = el("button.pu-chip", { type: "button", class: `${OPENRPA_STATE_TONES[workState] || ""}${active ? " active" : ""}`, text: `${OPENRPA_STATE_LABELS[workState]} · ${count}`, style: { cursor: "pointer" } });
          button.addEventListener("click", () => {
            state.filters.state = active ? "" : workState;
            boardStateSelect.value = state.filters.state;
            runBoard({ page: 1 });
          });
          countsRow.appendChild(button);
        }
        countsRow.appendChild(el("span.pu-small.pu-muted", { style: { "align-self": "center" }, text: `${state.board.total} item(s) match the board filters · ${state.board.totalScope} in scope` }));
        card.appendChild(countsRow);
      }

      if (state.boardLoading) card.appendChild(el("div", { style: { "margin-top": "0.6rem" } }, loadingRow("Querying work items…")));

      if (state.board && !state.board.items.length && !state.boardLoading) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "0.75rem" }, text: "No work items match these filters. Enqueue one below, or clear the filters." }));
        return card;
      }

      if (state.board && state.board.items.length) {
        const scroll = el("div.pu-table-scroll", { style: { "margin-top": "0.6rem" } });
        const table = el("table.pu-table");
        const thead = el("thead");
        const headRow = el("tr");
        for (const label of ["Item", "Queue", "State", "Priority", "Retries", "Last run", "Error", ""]) headRow.appendChild(el("th", { text: label }));
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = el("tbody");
        for (const item of state.board.items) {
          const tr = el("tr");
          const nameCell = el("td");
          nameCell.appendChild(el("div.pu-entity-name", { text: item.name || "(unnamed item)" }));
          nameCell.appendChild(el("span.pu-ref", { text: item.id || "" }));
          tr.appendChild(nameCell);
          tr.appendChild(el("td", { text: item.queueId || "—" }));
          tr.appendChild(el("td", {}, chip(item.stateLabel, OPENRPA_STATE_TONES[item.state] || "")));
          tr.appendChild(el("td", {}, chip(item.priority, item.priority === "high" ? "warn" : "")));
          tr.appendChild(el("td", { text: item.maxRetries != null ? `${item.retries} / ${item.maxRetries}` : String(item.retries) }));
          tr.appendChild(el("td", {}, el("span.pu-small", { text: formatDate(item.lastRun) })));
          tr.appendChild(el("td", {}, el("span.pu-small.pu-muted", { text: item.error.present ? truncate(item.error.message || item.error.type || "error", 46) : "—" })));
          const actions = el("td");
          const inspectBtn = el("button.pu-btn.secondary", { type: "button", text: item.id === state.selectedId ? "Selected" : "Inspect" });
          inspectBtn.addEventListener("click", () => selectItem(item));
          actions.appendChild(inspectBtn);
          tr.appendChild(actions);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        scroll.appendChild(table);
        card.appendChild(scroll);

        const pager = el("div.pu-toolbar", { style: { "margin-top": "0.75rem", "margin-bottom": "0" } });
        const prevBtn = el("button.pu-btn.secondary", { type: "button", text: "← Previous" });
        prevBtn.disabled = !state.board.hasPrev;
        prevBtn.addEventListener("click", () => runBoard({ page: state.board.page - 1 }));
        const nextBtn = el("button.pu-btn.secondary", { type: "button", text: "Next →" });
        nextBtn.disabled = !state.board.hasNext;
        nextBtn.addEventListener("click", () => runBoard({ page: state.board.page + 1 }));
        pager.appendChild(prevBtn);
        pager.appendChild(el("span.pu-small.pu-muted", { text: `${state.board.from}–${state.board.to} of ${state.board.total}` }));
        pager.appendChild(nextBtn);
        card.appendChild(pager);
      }
      return card;
    }

    function buildInspector() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Item inspector" }));
      card.appendChild(head);

      if (!state.selected) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "0.75rem" }, text: "Select a work item on the board to inspect its payload, error detail, routing and attachments." }));
        return card;
      }

      const item = state.selected;
      head.appendChild(chip(item.stateLabel, OPENRPA_STATE_TONES[item.state] || ""));
      head.appendChild(chip(item.priority, item.priority === "high" ? "warn" : ""));
      head.appendChild(el("span.pu-ref", { text: item.id }));
      if (isTerminalState(item.state)) {
        head.appendChild(el("span.pu-small.pu-muted", { text: TERMINAL_HINT[item.state] || "" }));
      }
      const closeBtn = el("button.pu-btn.secondary", { type: "button", text: "Close", style: { "margin-left": "auto" } });
      closeBtn.addEventListener("click", () => clearSelection());
      head.appendChild(closeBtn);
      card.appendChild(head);

      const dl = el("dl.pu-kv", { style: { "margin-top": "0.75rem" } });
      for (const row of [
        ["Queue", item.queueId || "—"],
        ["Created", formatDate(item.created)],
        ["Modified", formatDate(item.modified)],
        ["Last run", formatDate(item.lastRun)],
        ["Next run", formatDate(item.nextRun)],
        ["Created by", item.createdBy || "—"],
        ["Version", String(item.version)],
      ]) {
        dl.appendChild(el("dt", { text: row[0] }));
        dl.appendChild(el("dd", {}, el("span.pu-small", { text: row[1] })));
      }
      card.appendChild(dl);

      card.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: "Payload & state" }));
      card.appendChild(el("div.pu-form-grid", {}, field("Payload (JSON object)", itemPayloadInput), el("div.pu-form-row", {}, field("Priority", itemPrioritySelect), field("Retries", itemRetriesInput)), el("div.pu-form-row", {}, field("Error type", itemErrorTypeInput), field("Error message", itemErrorMessageInput), field("Error source", itemErrorSourceInput))));
      const saveBtn = el("button.pu-btn", { type: "button", text: "Save fields", "data-permission": "openrpa.run", "data-mutating": "" });
      saveBtn.addEventListener("click", () => withBusy(saveBtn, "Saving…", () =>
        perform("Saved item fields", () => {
          let payload;
          try {
            payload = JSON.parse(itemPayloadInput.value || "{}");
          } catch (error) {
            return Promise.resolve({ ok: false, error: { kind: "validation", message: `Payload is not valid JSON: ${error.message}` } });
          }
          return or.workitems.updateItem(item, {
            payload,
            priority: itemPrioritySelect.value,
            retries: Number(itemRetriesInput.value) || 0,
            errortype: itemErrorTypeInput.value.trim() || null,
            errormessage: itemErrorMessageInput.value.trim() || null,
            errorsource: itemErrorSourceInput.value.trim() || null,
          });
        })
      ));
      card.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.5rem" } }, saveBtn));

      card.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: "Lifecycle" }));
      card.appendChild(el("p.pu-small.pu-muted", { text: `Allowed moves from ${item.stateLabel}: ${(OPENRPA_STATE_TRANSITIONS[item.state] || []).map((s) => OPENRPA_STATE_LABELS[s]).join(", ") || "none (terminal)"}.` }));
      const moveBtn = el("button.pu-btn.secondary", { type: "button", text: "Move state" });
      moveBtn.addEventListener("click", () => withBusy(moveBtn, "Moving…", () => perform(`Moved to ${itemStateSelect.value}`, () => or.workitems.setState(item, itemStateSelect.value))));
      const successBtn = el("button.pu-btn", { type: "button", text: "Complete success", "data-permission": "openrpa.run", "data-mutating": "" });
      successBtn.addEventListener("click", () => withBusy(successBtn, "Completing…", () => perform("Completed successfully", () => or.workitems.complete(item, { result: { ok: true } }))));
      const failBtn = el("button.pu-btn.secondary", { type: "button", text: "Complete failed" });
      failBtn.addEventListener("click", () =>
        withBusy(failBtn, "Completing…", () =>
          perform("Completed as failed", () =>
            or.workitems.complete(item, {
              error: {
                message: itemErrorMessageInput.value.trim() || "Failed by an operator",
                source: itemErrorSourceInput.value.trim() || item.queueId || null,
                type: itemErrorTypeInput.value.trim() || null,
              },
            })
          )
        )
      );
      card.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.5rem" } }, field("Move to", itemStateSelect), moveBtn, successBtn, failBtn));

      card.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: "Quick actions" }));
      const retryBtn = el("button.pu-btn.secondary", { type: "button", text: "Retry" });
      retryBtn.addEventListener("click", () => withBusy(retryBtn, "Retrying…", () => perform("Queued a retry", () => or.workitems.retry(item))));
      const requeueBtn = el("button.pu-btn.secondary", { type: "button", text: "Requeue" });
      requeueBtn.addEventListener("click", () => withBusy(requeueBtn, "Requeuing…", () => perform("Requeued as new", () => or.workitems.requeue(item))));
      const cancelBtn = el("button.pu-btn.secondary", { type: "button", text: "Cancel" });
      cancelBtn.addEventListener("click", () => withBusy(cancelBtn, "Cancelling…", () => perform("Cancelled the item", () => or.workitems.cancel(item))));
      const deleteBtn = el("button.pu-btn.secondary", { type: "button", text: "Delete" });
      deleteBtn.addEventListener("click", () =>
        withBusy(deleteBtn, "Deleting…", async () => {
          const result = await or.workitems.deleteItem(item.id);
          state.actionResult = describeResult(result);
          toast(result.ok ? "Deleted the work item" : result.error.message, { tone: result.ok ? "info" : "error" });
          if (result.ok) clearSelection();
          await refreshAfterChange();
        })
      );
      card.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.5rem" } }, retryBtn, requeueBtn, cancelBtn, deleteBtn));

      if (state.actionResult) {
        const result = state.actionResult;
        if (result.tone === "ok") card.appendChild(el("div", { style: { "margin-top": "0.5rem" } }, alertNode(result.title, "ok")));
        else {
          const box = el("div.pu-alert.fail", { style: { "margin-top": "0.5rem" } });
          const line = el("div", { style: { display: "flex", gap: "0.4rem", "align-items": "center", "flex-wrap": "wrap" } });
          line.appendChild(chip(KIND_LABEL[result.kind] || result.kind || "error", KIND_TONE[result.kind] || "fail"));
          line.appendChild(el("span", { text: result.title }));
          box.appendChild(line);
          card.appendChild(box);
        }
      }

      card.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: `Attachments (${item.files.length})` }));
      if (!item.files.length) {
        card.appendChild(el("p.pu-small.pu-muted", { text: "This item carries no files yet. Upload one below to attach it." }));
      } else {
        const list = el("ul.pu-list");
        for (const attachment of item.files) {
          const li = el("li");
          li.appendChild(el("span.pu-ref", { text: attachment.filename }));
          li.appendChild(el("span.pu-small.pu-muted", { text: `${attachment.contentType || "unknown type"} · ${formatBytes(attachment.length)}` }));
          const detachBtn = el("button.pu-btn.secondary", { type: "button", text: "Detach", style: { "margin-left": "0.5rem" } });
          detachBtn.addEventListener("click", () => withBusy(detachBtn, "Detaching…", () => perform("Detached the file", () => or.files.detachFromWorkItem(item.id, attachment.id))));
          li.appendChild(detachBtn);
          list.appendChild(li);
        }
        card.appendChild(list);
      }
      card.appendChild(el("div", { style: { "margin-top": "0.5rem" } }, field("Attach a new file — name", attachFilenameInput), el("div", { style: { "margin-top": "0.4rem" } }, field("Content", attachContentInput))));
      const attachBtn = el("button.pu-btn.secondary", { type: "button", text: "Attach file" });
      attachBtn.addEventListener("click", () =>
        withBusy(attachBtn, "Attaching…", () =>
          perform("Attached the file", () =>
            or.files.attachToWorkItem(item.id, { filename: attachFilenameInput.value.trim(), content: attachContentInput.value })
          )
        )
      );
      card.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.5rem" } }, attachBtn));
      return card;
    }

    function buildEnqueue() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Enqueue work" }));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "Add a single item or a batch to a queue. The payload must be a JSON object; the priority, an optional next-run time, a max-retries override and any stored files to attach are validated before anything is written, and a batch reports a per-item result.",
        })
      );

      if (state.loading) {
        card.appendChild(el("div", { style: { "margin-top": "0.75rem" } }, loadingRow("Loading queues…")));
        return card;
      }
      if (!state.queues.length) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "0.75rem" }, text: "Create a queue first — then you can enqueue into it." }));
        return card;
      }

      const form = el("div.pu-form-grid", { style: { "margin-top": "0.75rem" } });
      form.appendChild(el("div.pu-form-row", {}, field("Queue", enqueueQueueSelect), field("Name", enqueueNameInput), field("Priority", enqueuePrioritySelect)));
      form.appendChild(el("div.pu-form-row", {}, field("Next run", enqueueNextRunInput, "ISO date; the item is not claimable before then."), field("Max retries override", enqueueMaxRetriesInput, "Blank uses the queue policy."), field("Attach stored files", enqueueFilesInput, "Comma-separated ids from the file storage.")));
      form.appendChild(field("Payload (JSON object)", enqueuePayloadInput, "e.g. { \"invoiceId\": \"iv_2001\" }"));
      card.appendChild(form);

      const enqueueBtn = el("button.pu-btn", { type: "button", text: "Enqueue item", "data-permission": "openrpa.run", "data-mutating": "" });
      enqueueBtn.addEventListener("click", () =>
        withBusy(enqueueBtn, "Enqueuing…", async () => {
          const result = await or.workitems.enqueue(enqueueQueueSelect.value, readEnqueueInput());
          state.enqueueResult = result.ok ? { tone: "ok", title: `Enqueued ${result.item.id} into ${result.item.queueId}.` } : { tone: "fail", kind: result.error.kind, title: result.error.message };
          toast(result.ok ? `Enqueued ${result.item.id}` : result.error.message, { tone: result.ok ? "success" : "error" });
          if (result.ok) {
            enqueuePayloadInput.value = "";
            enqueueNameInput.value = "";
            await refreshAfterChange();
            const fresh = (state.board && state.board.items.find((entry) => entry.id === result.item.id)) || result.item;
            selectItem(fresh);
          }
        })
      );
      card.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.6rem" } }, enqueueBtn));

      const batchDetails = el("details.pu-details", { style: { "margin-top": "1rem" } });
      batchDetails.appendChild(el("summary", {}, el("span.pu-help-title", { text: "Bulk enqueue (JSON array)" })));
      const batchBody = el("div.pu-details-body");
      batchBody.appendChild(el("p.pu-small.pu-muted", { text: "An array of items; each may carry its own payload, priority, nextRun and maxRetries. Every entry gets its own result, so a bad row does not discard the good ones." }));
      batchBody.appendChild(field("Items", batchInput));
      const batchBtn = el("button.pu-btn.secondary", { type: "button", text: "Enqueue batch" });
      batchBtn.addEventListener("click", () =>
        withBusy(batchBtn, "Enqueuing…", async () => {
          let parsed;
          try {
            parsed = JSON.parse(batchInput.value || "[]");
          } catch (error) {
            state.enqueueResult = { tone: "fail", kind: "validation", title: `The batch is not valid JSON: ${error.message}` };
            toast("The batch is not valid JSON", { tone: "error" });
            rerender();
            return;
          }
          if (!Array.isArray(parsed)) {
            state.enqueueResult = { tone: "fail", kind: "validation", title: "A bulk enqueue needs a JSON array." };
            toast("A bulk enqueue needs a JSON array", { tone: "error" });
            rerender();
            return;
          }
          const result = await or.workitems.enqueueMany(enqueueQueueSelect.value, parsed);
          state.enqueueResult = {
            tone: result.inserted && !result.failed ? "ok" : result.inserted ? "warn" : "fail",
            title: `Batch finished: ${result.inserted} inserted, ${result.failed} rejected.`,
            results: result.results,
          };
          toast(`Batch: ${result.inserted} inserted, ${result.failed} rejected`, { tone: result.failed ? "error" : "success" });
          await refreshAfterChange();
        })
      );
      batchBody.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.5rem" } }, batchBtn));
      batchDetails.appendChild(batchBody);
      card.appendChild(batchDetails);

      if (state.enqueueResult) {
        const result = state.enqueueResult;
        const box = el(`div.pu-alert.${result.tone === "fail" ? "fail" : result.tone === "warn" ? "warn" : "ok"}`, { style: { "margin-top": "0.6rem" } });
        box.appendChild(el("span", { text: result.title }));
        if (Array.isArray(result.results)) {
          const ul = el("ul.pu-list");
          for (const entry of result.results) {
            const li = el("li");
            li.appendChild(chip(entry.ok ? "accepted" : "rejected", entry.ok ? "ok" : "fail"));
            li.appendChild(el("span.pu-small", { text: entry.ok ? `${entry.item.id}` : `#${entry.index}: ${entry.error.message}` }));
            ul.appendChild(li);
          }
          box.appendChild(ul);
        } else if (result.kind) {
          box.insertBefore(chip(KIND_LABEL[result.kind] || result.kind, KIND_TONE[result.kind] || "fail"), box.firstChild);
        }
        card.appendChild(box);
      }
      return card;
    }

    function readEnqueueInput() {
      const input = {
        payload: enqueuePayloadInput.value.trim() || "{}",
        priority: enqueuePrioritySelect.value,
      };
      const name = enqueueNameInput.value.trim();
      if (name) input.name = name;
      const nextRun = enqueueNextRunInput.value.trim();
      if (nextRun) input.nextRun = nextRun;
      const maxRetries = enqueueMaxRetriesInput.value.trim();
      if (maxRetries) input.maxRetries = Number(maxRetries);
      const fileIds = enqueueFilesInput.value.split(",").map((value) => value.trim()).filter(Boolean);
      if (fileIds.length) {
        input.files = fileIds
          .map((id) => state.files.find((file) => file.id === id))
          .filter(Boolean)
          .map((file) => ({ _id: file.id, name: file.name, filename: file.filename, contenttype: file.contentType, length: file.length, refid: file.id, ref: "file" }));
      }
      return input;
    }

    function buildQueues() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { "margin": "0" }, text: "Queues" }));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "Define a queue's workflow binding, its robot/AMQP names, its retry policy (max retries, retry delay, initial delay) and where successful and failed items are routed. Deleting a queue can optionally purge its items first.",
        })
      );

      if (state.loading) {
        card.appendChild(el("div", { style: { "margin-top": "0.75rem" } }, loadingRow("Loading queues…")));
        return card;
      }

      const list = el("div", { style: { "margin-top": "0.75rem" } });
      if (!state.queues.length) list.appendChild(el("div.pu-empty", { text: "No queues are defined yet." }));
      else {
        const scroll = el("div.pu-table-scroll");
        const table = el("table.pu-table");
        const thead = el("thead");
        const headRow = el("tr");
        for (const label of ["Queue", "Workflow", "Robot", "Retries", "Delays", "Routes", "Items", ""]) headRow.appendChild(el("th", { text: label }));
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = el("tbody");
        for (const queue of state.queues) {
          const counts = (state.overview.queues.find((entry) => entry.id === queue.id) || {}).counts || { total: 0 };
          const tr = el("tr");
          const nameCell = el("td");
          nameCell.appendChild(el("div.pu-entity-name", { text: queue.name }));
          nameCell.appendChild(el("span.pu-ref", { text: queue.id || "" }));
          tr.appendChild(nameCell);
          tr.appendChild(el("td", {}, el("span.pu-small", { text: queue.workflowId || "—" })));
          tr.appendChild(el("td", {}, el("span.pu-small", { text: queue.robotQueue || "—" })));
          tr.appendChild(el("td", { text: String(queue.maxRetries) }));
          tr.appendChild(el("td", {}, el("span.pu-small.pu-muted", { text: `retry ${queue.retryDelay}s · initial ${queue.initialDelay}s` })));
          tr.appendChild(el("td", {}, el("span.pu-small.pu-muted", { text: `${queue.successQueueId || "—"} / ${queue.failedQueueId || "—"}` })));
          tr.appendChild(el("td", { text: String(counts.total || 0) }));
          const actions = el("td");
          const editBtn = el("button.pu-btn.secondary", { type: "button", text: state.editingQueueId === queue.id ? "Editing" : "Edit" });
          editBtn.addEventListener("click", () => {
            state.editingQueueId = queue.id;
            queueNameInput.value = queue.name;
            queueWorkflowInput.value = queue.workflowId || "";
            queueRobotInput.value = queue.robotQueue || "";
            queueAmqpInput.value = queue.amqpQueue || "";
            queueMaxRetriesInput.value = String(queue.maxRetries);
            queueRetryDelayInput.value = String(queue.retryDelay);
            queueInitialDelayInput.value = String(queue.initialDelay);
            queueSuccessInput.value = queue.successQueueId || "";
            queueFailedInput.value = queue.failedQueueId || "";
            state.queueResult = null;
            rerender();
          });
          const deleteBtn = el("button.pu-btn.secondary", { type: "button", text: "Delete" });
          deleteBtn.addEventListener("click", () =>
            withBusy(deleteBtn, "Deleting…", async () => {
              const purge = !!queuePurgeCheck.checked;
              const result = await or.workitems.deleteQueue(queue.id, { purge });
              state.queueResult = result.ok ? { tone: "ok", title: `Deleted ${queue.name}${purge ? ` and purged ${result.purged} item(s)` : ""}.` } : { tone: "fail", title: result.error.message };
              toast(result.ok ? "Queue deleted" : result.error.message, { tone: result.ok ? "info" : "error" });
              if (state.editingQueueId === queue.id) resetQueueForm();
              await loadQueuesAndBoard();
            })
          );
          actions.appendChild(editBtn);
          actions.appendChild(deleteBtn);
          tr.appendChild(actions);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        scroll.appendChild(table);
        list.appendChild(scroll);
      }
      card.appendChild(list);

      const purgeLabel = el("label.pu-small", { style: { display: "flex", gap: "0.4rem", "align-items": "center", "margin-top": "0.6rem" } });
      purgeLabel.appendChild(queuePurgeCheck);
      purgeLabel.appendChild(el("span", { text: "Purge this queue's work items when deleting it" }));
      card.appendChild(purgeLabel);

      card.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: state.editingQueueId ? `Edit queue ${state.editingQueueId}` : "Create a queue" }));
      const form = el("div.pu-form-grid", { style: { "margin-top": "0.5rem" } });
      form.appendChild(el("div.pu-form-row", {}, field("Name", queueNameInput), field("Workflow binding", queueWorkflowInput), field("Robot queue", queueRobotInput)));
      form.appendChild(el("div.pu-form-row", {}, field("AMQP queue", queueAmqpInput), field("Max retries", queueMaxRetriesInput), field("Retry delay (s)", queueRetryDelayInput), field("Initial delay (s)", queueInitialDelayInput)));
      form.appendChild(el("div.pu-form-row", {}, field("Success queue id", queueSuccessInput), field("Failed queue id", queueFailedInput)));
      card.appendChild(form);

      const saveBtn = el("button.pu-btn", { type: "button", text: state.editingQueueId ? "Save queue" : "Create queue", "data-permission": "openrpa.write", "data-mutating": "" });
      saveBtn.addEventListener("click", () =>
        withBusy(saveBtn, "Saving…", async () => {
          const input = readQueueInput();
          const result = state.editingQueueId ? await or.workitems.updateQueue(state.editingQueueId, input) : await or.workitems.createQueue(input);
          state.queueResult = result.ok ? { tone: "ok", title: `${state.editingQueueId ? "Saved" : "Created"} queue ${result.queue.name}.` } : { tone: "fail", title: result.error.message };
          toast(result.ok ? "Queue saved" : result.error.message, { tone: result.ok ? "success" : "error" });
          if (result.ok) resetQueueForm();
          await loadQueuesAndBoard();
        })
      );
      const newBtn = el("button.pu-btn.secondary", { type: "button", text: "New queue" });
      newBtn.addEventListener("click", () => {
        resetQueueForm();
        rerender();
      });
      card.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.5rem" } }, saveBtn, newBtn));

      if (state.queueResult) {
        const result = state.queueResult;
        card.appendChild(el("div", { style: { "margin-top": "0.5rem" } }, alertNode(result.title, result.tone === "fail" ? "fail" : "ok")));
      }
      return card;
    }

    function readQueueInput() {
      const input = { name: queueNameInput.value.trim() };
      if (queueWorkflowInput.value.trim()) input.workflowid = queueWorkflowInput.value.trim();
      if (queueRobotInput.value.trim()) input.robotqueue = queueRobotInput.value.trim();
      if (queueAmqpInput.value.trim()) input.amqpqueue = queueAmqpInput.value.trim();
      input.maxretries = Number(queueMaxRetriesInput.value) || 0;
      input.retrydelay = Number(queueRetryDelayInput.value) || 0;
      input.initialdelay = Number(queueInitialDelayInput.value) || 0;
      input.success_wiqid = queueSuccessInput.value.trim() || null;
      input.failed_wiqid = queueFailedInput.value.trim() || null;
      return input;
    }

    function resetQueueForm() {
      state.editingQueueId = null;
      queueNameInput.value = "";
      queueWorkflowInput.value = "";
      queueRobotInput.value = "";
      queueAmqpInput.value = "";
      queueMaxRetriesInput.value = "0";
      queueRetryDelayInput.value = "0";
      queueInitialDelayInput.value = "0";
      queueSuccessInput.value = "";
      queueFailedInput.value = "";
    }

    function buildFiles() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "File storage" }));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "Upload file content with its metadata, list and download what is stored, verify a checksum and delete a file. Attachments are wired into work items above, so a job can carry the documents it needs.",
        })
      );

      const form = el("div.pu-form-grid", { style: { "margin-top": "0.75rem" } });
      form.appendChild(el("div.pu-form-row", {}, field("File name", fileFilenameInput), field("Content type", fileContentTypeInput, "Blank infers from the extension."), field("Ref id", fileRefIdInput), field("Ref kind", fileRefInput)));
      form.appendChild(el("div.pu-form-row", {}, field("Encoding", fileEncodingSelect)));
      form.appendChild(field("Content", fileContentInput));
      card.appendChild(form);
      const uploadBtn = el("button.pu-btn", { type: "button", text: "Upload file", "data-permission": "openrpa.write", "data-mutating": "" });
      uploadBtn.addEventListener("click", () =>
        withBusy(uploadBtn, "Uploading…", async () => {
          const result = await or.files.upload({
            filename: fileFilenameInput.value.trim(),
            contentType: fileContentTypeInput.value.trim() || undefined,
            content: fileContentInput.value,
            encoding: fileEncodingSelect.value,
            refId: fileRefIdInput.value.trim() || undefined,
            ref: fileRefInput.value.trim() || undefined,
          });
          state.fileResult = result.ok ? { tone: "ok", title: `Uploaded ${result.file.filename} (${formatBytes(result.file.length)}).` } : { tone: "fail", title: result.error.message };
          toast(result.ok ? "File uploaded" : result.error.message, { tone: result.ok ? "success" : "error" });
          if (result.ok) {
            fileContentInput.value = "";
            await refreshAfterChange();
          } else rerender();
        })
      );
      card.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.5rem" } }, uploadBtn));

      if (!state.files.length) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "0.75rem" }, text: "No files are stored in OpenFlow yet." }));
      } else {
        const scroll = el("div.pu-table-scroll", { style: { "margin-top": "0.6rem" } });
        const table = el("table.pu-table");
        const thead = el("thead");
        const headRow = el("tr");
        for (const label of ["File", "Type", "Size", "Ref", "Modified", ""]) headRow.appendChild(el("th", { text: label }));
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = el("tbody");
        for (const file of state.files) {
          const tr = el("tr");
          const nameCell = el("td");
          nameCell.appendChild(el("div.pu-entity-name", { text: file.filename }));
          nameCell.appendChild(el("span.pu-ref", { text: file.id || "" }));
          tr.appendChild(nameCell);
          tr.appendChild(el("td", {}, chip(isImageContentType(file.contentType) ? "image" : "file", "")));
          tr.appendChild(el("td", { text: formatBytes(file.length) }));
          tr.appendChild(el("td", {}, el("span.pu-small.pu-muted", { text: file.refId ? `${file.ref || "ref"}: ${file.refId}` : "—" })));
          tr.appendChild(el("td", {}, el("span.pu-small", { text: formatDate(file.modified) })));
          const actions = el("td");
          const downloadBtn = el("button.pu-btn.secondary", { type: "button", text: "Download" });
          downloadBtn.addEventListener("click", () =>
            withBusy(downloadBtn, "Loading…", async () => {
              const result = await or.files.dataUrl(file.id);
              if (!result.ok) {
                state.fileResult = { tone: "fail", title: result.error.message };
                rerender();
                return;
              }
              const link = el("a", { href: result.url, download: file.filename });
              document.body.appendChild(link);
              link.click();
              link.remove();
              toast(`Downloaded ${file.filename}`, { tone: "success" });
            })
          );
          const verifyBtn = el("button.pu-btn.secondary", { type: "button", text: "Verify" });
          verifyBtn.addEventListener("click", () =>
            withBusy(verifyBtn, "Verifying…", async () => {
              const result = await or.files.verify(file.id);
              const ok = result.ok && result.valid;
              state.fileResult = { tone: ok ? "ok" : "fail", title: ok ? `${file.filename} passed its checksum.` : `${file.filename} failed its checksum.` };
              toast(ok ? "Checksum OK" : "Checksum mismatch", { tone: ok ? "success" : "error" });
              rerender();
            })
          );
          const attachBtn = el("button.pu-btn.secondary", { type: "button", text: "Attach to selected" });
          attachBtn.disabled = !state.selectedId;
          attachBtn.addEventListener("click", () =>
            withBusy(attachBtn, "Attaching…", async () => {
              const content = await or.files.content(file.id);
              if (!content.ok) {
                state.fileResult = { tone: "fail", title: content.error.message };
                rerender();
                return;
              }
              const link = await or.files.attachToWorkItem(state.selectedId, {
                filename: file.filename,
                contentType: file.contentType,
                content: content.content,
                encoding: file.encoding,
              });
              state.fileResult = link.ok ? { tone: "ok", title: `Attached ${file.filename} to ${state.selectedId}.` } : { tone: "fail", title: link.error.message };
              toast(link.ok ? "Attached to the selected item" : link.error.message, { tone: link.ok ? "success" : "error" });
              await refreshAfterChange();
            })
          );
          const deleteBtn = el("button.pu-btn.secondary", { type: "button", text: "Delete" });
          deleteBtn.addEventListener("click", () =>
            withBusy(deleteBtn, "Deleting…", async () => {
              const result = await or.files.remove(file.id);
              state.fileResult = result.ok ? { tone: "ok", title: `Deleted ${file.filename}.` } : { tone: "fail", title: result.error.message };
              toast(result.ok ? "File deleted" : result.error.message, { tone: result.ok ? "info" : "error" });
              await refreshAfterChange();
            })
          );
          actions.appendChild(downloadBtn);
          actions.appendChild(verifyBtn);
          actions.appendChild(attachBtn);
          actions.appendChild(deleteBtn);
          tr.appendChild(actions);
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        scroll.appendChild(table);
        card.appendChild(scroll);
      }

      if (state.fileResult) {
        const result = state.fileResult;
        card.appendChild(el("div", { style: { "margin-top": "0.6rem" } }, alertNode(result.title, result.tone === "fail" ? "fail" : "ok")));
      }
      return card;
    }

    async function loadQueuesAndBoard() {
      const queuesResult = await or.workitems.listQueues();
      if (queuesResult.ok) state.queues = queuesResult.queues;
      const overviewResult = await or.workitems.queueOverview();
      if (overviewResult.ok) state.overview = overviewResult;
      syncQueueOptions();
      await refreshAfterChange();
    }

    root.appendChild(
      pageHead({
        eyebrow: "OpenRPA",
        title: "Work board & queues",
        subtitle: "Manage work-item queues and their retry/routing policy, enqueue single or bulk items, claim the next due item, drive the new → processing → success/failed lifecycle, inspect payloads and errors, and store the files an item carries.",
      })
    );
    root.appendChild(globalErrorCtn);
    root.appendChild(statsCtn);
    root.appendChild(boardCtn);
    root.appendChild(inspectorCtn);
    root.appendChild(enqueueCtn);
    root.appendChild(queuesCtn);
    root.appendChild(filesCtn);

    if (onDestroy) {
      onDestroy(() => {
        destroyed = true;
      });
    }

    resetQueueForm();
    syncQueueOptions();
    rerender();
    load().catch((error) => {
      state.loading = false;
      state.loadError = error && error.message ? error.message : "The screen could not load.";
      rerender();
    });
    return root;
  },
};
