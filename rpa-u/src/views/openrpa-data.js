import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { OPENRPA_DOCUMENT_TYPES, namedQueries, buildQuery, paginate, templateFor, documentTypeForCollection } from "../core/openrpa/documents.js";
import { OPENRPA_ACTIONS, OPENRPA_RIGHTS } from "../core/openrpa/acl.js";
import { presentWorkflow } from "../core/openrpa/workflows.js";

const KIND_TONE = { conflict: "warn", validation: "fail", transport: "fail", "not-found": "warn", server: "fail" };
const KIND_LABEL = { conflict: "version conflict", validation: "validation", transport: "transport", "not-found": "not found", server: "server" };

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

function listItem(label, value) {
  const li = el("li");
  li.appendChild(el("span.pu-small.pu-muted", { text: label }));
  li.appendChild(el("span.pu-small", { text: value }));
  return li;
}

function loadingRow(label) {
  return el("div.pu-loading", { text: label });
}

function formatDate(value) {
  if (!value) return "—";
  const ms = Date.parse(value);
  if (Number.isNaN(ms)) return String(value);
  return new Date(ms).toLocaleString();
}

function truncate(value, max = 160) {
  const text = String(value == null ? "" : value);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

function orderbyToText(orderby) {
  if (!orderby) return "";
  return Object.entries(orderby)
    .map(([key, direction]) => (direction < 0 ? `-${key}` : key))
    .join(", ");
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

export const openrpaDataView = {
  id: "openrpa-data",
  title: "OpenRPA data",
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
      collections: [],
      collection: null,
      queryError: null,
      docsLoading: false,
      documents: [],
      pageInfo: paginate({ total: 0, page: 1, pageSize: 5 }),
      selectedId: null,
      selected: null,
      queueIds: [],
      mirrorReady: false,
      reveal: {},
      writeResult: null,
      aclUserId: "",
      deleteArmed: false,
    };

    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const browserCtn = el("div");
    const detailCtn = el("div");
    const writeCtn = el("div");
    const aclCtn = el("div");
    const globalErrorCtn = el("div", { style: { "margin-bottom": "1rem" } });

    function rerender() {
      if (destroyed) return;
      renderStats();
      mount(browserCtn, buildBrowser());
      mount(detailCtn, buildDetail());
      mount(writeCtn, buildWrite());
      mount(aclCtn, buildAcl());
      mount(globalErrorCtn, state.loadError ? alertNode(state.loadError, "fail") : null);
    }

    function alertNode(text, tone = "fail") {
      return el(`div.pu-alert.${tone}`, { text });
    }

    function renderStats() {
      const totalDocs = state.collections.reduce((sum, entry) => sum + (entry.count || 0), 0);
      const selected = state.selected;
      const subject = currentSubject();
      const rights = selected ? or.acl.rightsForDocument(selected.raw, subject) : null;
      mount(
        statsCtn,
        statCard("Collections", state.collections.length, state.loaded ? `${totalDocs} documents` : "loading…"),
        statCard("In view", state.pageInfo.total, state.collection || "no collection"),
        statCard("Page", `${state.pageInfo.page}/${state.pageInfo.pageCount}`, `${state.pageInfo.from}–${state.pageInfo.to}`),
        statCard("Signed in", signedInName(), subject.source),
        statCard("My rights", rights ? (rights.full ? "full" : `${rights.granted.length} right(s)`) : "—", selected ? selected.name : "no document selected")
      );
    }

    function signedInName() {
      const info = or.session.sessionInfo();
      return info.signedIn ? info.user.name : "signed out";
    }

    function currentSubject() {
      const info = or.session.sessionInfo();
      const base = or.acl.subjectFor(info);
      if (state.aclUserId) {
        const picked = or.acl.users().find((user) => user._id === state.aclUserId);
        if (picked) return or.acl.subjectForUser(picked);
      }
      return base;
    }

    const collectionSelect = el("select.pu-select", { "aria-label": "Collection" });
    const namedSelect = el("select.pu-select", { "aria-label": "Named query" });
    const queryInput = el("textarea.pu-textarea", { "aria-label": "JSON query", spellcheck: "false", placeholder: '{ "state": "new" }' });
    const orderbyInput = el("input.pu-input", { type: "text", "aria-label": "Order by", placeholder: "name, -_modified" });
    const pageSizeSelect = el("select.pu-select", { "aria-label": "Page size" }, ...[5, 10, 20, 50].map((size) => el("option", { value: String(size), text: `${size} per page` })));
    const pageInput = el("input.pu-input", { type: "number", min: "1", "aria-label": "Page", style: { "max-width": "5rem" } });
    const writeInput = el("textarea.pu-textarea", { "aria-label": "Document JSON", spellcheck: "false", style: { "min-height": "9rem", "font-family": "ui-monospace, Menlo, monospace", "font-size": "0.78rem" } });
    const uniqInput = el("input.pu-input", { type: "text", "aria-label": "Unique key", placeholder: '{ "domain": "foo.example" }' });
    const aclUserSelect = el("select.pu-select", { "aria-label": "Evaluate ACL for user" });
    const writeResultCtn = el("div", { style: { "margin-top": "0.6rem" } });

    function syncCollectionOptions() {
      mount(collectionSelect, ...state.collections.map((entry) => el("option", { value: entry.name, text: `${entry.label} (${entry.name}) · ${entry.count == null ? "?" : entry.count}` })));
      if (state.collection) collectionSelect.value = state.collection;
      syncNamedOptions();
    }

    function syncNamedOptions() {
      const options = namedQueries(state.collection);
      mount(namedSelect, el("option", { value: "", text: "— custom query —" }), ...options.map((entry) => el("option", { value: entry.id, text: entry.label })));
      namedSelect.value = state.namedQueryId || "";
    }

    function syncAclUserOptions() {
      const users = or.acl.users();
      mount(
        aclUserSelect,
        el("option", { value: "", text: currentSignedInLabel() }),
        ...users.map((user) => el("option", { value: user._id, text: `${user.name} (${user.username})` }))
      );
      aclUserSelect.value = state.aclUserId || "";
    }

    function currentSignedInLabel() {
      const info = or.session.sessionInfo();
      return info.signedIn ? `Signed in: ${info.user.name}` : "Signed-in user (none)";
    }

    collectionSelect.addEventListener("change", () => {
      state.collection = collectionSelect.value;
      state.selectedId = null;
      state.selected = null;
      state.namedQueryId = "";
      state.queryError = null;
      queryInput.value = "";
      orderbyInput.value = "";
      state.pageInfo = paginate({ total: 0, page: 1, pageSize: state.pageInfo.pageSize });
      syncNamedOptions();
      writeInput.value = JSON.stringify(templateFor(state.collection), null, 2);
      runQuery({ page: 1 });
    });

    namedSelect.addEventListener("change", () => {
      state.namedQueryId = namedSelect.value;
      const selected = namedQueries(state.collection).find((entry) => entry.id === state.namedQueryId);
      queryInput.value = selected && selected.query ? JSON.stringify(selected.query, null, 2) : "";
      orderbyInput.value = selected && selected.orderby ? orderbyToText(selected.orderby) : "";
      runQuery({ page: 1 });
    });

    pageSizeSelect.addEventListener("change", () => {
      state.pageInfo = paginate({ total: 0, page: 1, pageSize: Number(pageSizeSelect.value) });
      runQuery({ page: 1 });
    });

    aclUserSelect.addEventListener("change", () => {
      state.aclUserId = aclUserSelect.value;
      rerender();
    });

    function setState(patch) {
      Object.assign(state, patch);
      rerender();
    }

    async function load() {
      state.loading = true;
      state.loadError = null;
      rerender();
      const connected = await or.connect({ announce: false });
      if (!connected.ok) {
        state.loading = false;
        state.loadError = connected.error || "Could not reach the OpenFlow emulator.";
        rerender();
        return;
      }
      const collections = await or.documents.listCollections();
      if (!Array.isArray(collections)) {
        state.loading = false;
        state.loadError = collections && collections.error ? collections.error.message : "The collection list could not be read.";
        rerender();
        return;
      }
      state.collections = collections;
      if (!state.collection) state.collection = collections.find((entry) => entry.name === "workflows") ? "workflows" : collections[0] ? collections[0].name : null;
      const queueResult = await or.documents.query("openrpa_queue", { projection: ["_id"] });
      state.queueIds = Array.isArray(queueResult) ? queueResult.map((doc) => doc.id) : [];
      await or.acl.sync();
      state.mirrorReady = or.acl.synced();
      state.loading = false;
      syncCollectionOptions();
      pageSizeSelect.value = String(state.pageInfo.pageSize);
      syncAclUserOptions();
      if (state.collection && !writeInput.value) writeInput.value = JSON.stringify(templateFor(state.collection), null, 2);
      await runQuery({ page: 1 });
    }

    async function runQuery({ page = 1 } = {}) {
      if (!state.collection) {
        state.documents = [];
        rerender();
        return;
      }
      const spec = buildQuery({ queryText: queryInput.value, orderbyText: orderbyInput.value });
      if (!spec.ok) {
        state.queryError = spec.error.message;
        state.documents = [];
        state.pageInfo = paginate({ total: 0, page: 1, pageSize: state.pageInfo.pageSize });
        rerender();
        return;
      }
      state.queryError = null;
      state.docsLoading = true;
      rerender();
      const result = await or.documents.page(state.collection, {
        page,
        pageSize: state.pageInfo.pageSize,
        query: spec.query,
        orderby: spec.orderby,
        projection: spec.projection,
      });
      state.docsLoading = false;
      if (!result || result.ok === false) {
        state.loadError = result && result.error ? result.error.message : "The query failed.";
        state.documents = [];
        rerender();
        return;
      }
      state.loadError = null;
      state.documents = result.documents;
      state.pageInfo = result;
      if (state.selectedId && !result.documents.some((doc) => doc.id === state.selectedId)) {
        state.selected = null;
        state.selectedId = null;
      }
      rerender();
    }

    function selectDocument(record) {
      state.selectedId = record.id;
      state.selected = record;
      state.reveal = {};
      state.writeResult = null;
      state.deleteArmed = false;
      rerender();
    }

    function closeDocument() {
      state.selectedId = null;
      state.selected = null;
      state.deleteArmed = false;
      rerender();
    }

    function buildBrowser() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Collection browser" }));
      head.appendChild(chip(or.mode(), ""));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "List every OpenFlow collection and browse its documents with a JSON query, ordering and paging. Pick a named query for a ready-made filter, or edit the JSON to build your own — the same server-side query syntax OpenFlow uses.",
        })
      );

      if (state.loading) {
        card.appendChild(el("div", { style: { "margin-top": "0.75rem" } }, loadingRow("Loading collections from OpenFlow…")));
        return card;
      }

      const controls = el("div.pu-form-grid", { style: { "margin-top": "0.75rem" } });
      const row1 = el("div.pu-form-row");
      row1.appendChild(field("Collection", collectionSelect));
      row1.appendChild(field("Named query", namedSelect));
      controls.appendChild(row1);
      const row2 = el("div.pu-form-row");
      row2.appendChild(field("Order by", orderbyInput, "Comma-separated fields; prefix - for descending, e.g. name, -_modified."));
      row2.appendChild(field("Page size", pageSizeSelect));
      const goBtn = el("button.pu-btn", { type: "button", text: "Run query" });
      goBtn.addEventListener("click", () => withBusy(goBtn, "Running…", () => runQuery({ page: 1 })));
      const clearBtn = el("button.pu-btn.secondary", { type: "button", text: "Clear filters" });
      clearBtn.addEventListener("click", () => {
        state.namedQueryId = "";
        queryInput.value = "";
        orderbyInput.value = "";
        syncNamedOptions();
        runQuery({ page: 1 });
      });
      row2.appendChild(el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "flex-end" } }, goBtn, clearBtn));
      controls.appendChild(row2);
      controls.appendChild(field("Query (JSON)", queryInput));
      card.appendChild(controls);

      if (state.queryError) card.appendChild(el("div", { style: { "margin-top": "0.6rem" } }, alertNode(state.queryError, "fail")));
      if (state.docsLoading) card.appendChild(el("div", { style: { "margin-top": "0.6rem" } }, loadingRow("Querying OpenFlow…")));

      if (!state.documents.length && !state.docsLoading) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "0.75rem" }, text: "No documents match this query." }));
        return card;
      }

      const scroll = el("div.pu-table-scroll", { style: { "margin-top": "0.75rem" } });
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Document", "Type", "Version", "Modified", "Summary", ""]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const record of state.documents) {
        const tr = el("tr");
        const nameCell = el("td");
        nameCell.appendChild(el("div.pu-entity-name", { text: record.name || "(no name)" }));
        nameCell.appendChild(el("span.pu-ref", { text: record.id || "(new)" }));
        tr.appendChild(nameCell);
        tr.appendChild(el("td", {}, chip(record.typeLabel, "")));
        tr.appendChild(el("td", { text: `v${record.version}` }));
        tr.appendChild(el("td", {}, el("span.pu-small", { text: formatDate(record.modified) })));
        tr.appendChild(el("td", {}, el("span.pu-small.pu-muted", { text: summarize(record) || "—" })));
        const actionCell = el("td");
        const openBtn = el("button.pu-btn.secondary", { type: "button", text: record.id === state.selectedId ? "Selected" : "Open" });
        openBtn.addEventListener("click", () => selectDocument(record));
        actionCell.appendChild(openBtn);
        tr.appendChild(actionCell);
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
      card.appendChild(scroll);

      const pager = el("div.pu-toolbar", { style: { "margin-top": "0.75rem", "margin-bottom": "0" } });
      const prevBtn = el("button.pu-btn.secondary", { type: "button", text: "← Previous" });
      prevBtn.disabled = !state.pageInfo.hasPrev;
      prevBtn.addEventListener("click", () => runQuery({ page: state.pageInfo.page - 1 }));
      const nextBtn = el("button.pu-btn.secondary", { type: "button", text: "Next →" });
      nextBtn.disabled = !state.pageInfo.hasNext;
      nextBtn.addEventListener("click", () => runQuery({ page: state.pageInfo.page + 1 }));
      pageInput.value = String(state.pageInfo.page);
      pager.appendChild(prevBtn);
      pager.appendChild(el("span.pu-small.pu-muted", { text: `${state.pageInfo.from}–${state.pageInfo.to} of ${state.pageInfo.total}` }));
      pager.appendChild(nextBtn);
      pager.appendChild(field("Jump to page", pageInput));
      const jumpBtn = el("button.pu-btn.secondary", { type: "button", text: "Go" });
      jumpBtn.addEventListener("click", () => runQuery({ page: Number(pageInput.value) || 1 }));
      pager.appendChild(jumpBtn);
      card.appendChild(pager);
      return card;
    }

    function summarize(record) {
      const type = documentTypeForCollection(record.collection);
      if (!type || !type.summaryKeys) return "";
      return type.summaryKeys
        .filter((key) => key in record.values)
        .map((key) => `${key}=${truncate(String(record.values[key]), 30)}`)
        .join(" · ");
    }

    function buildDetail() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Document" }));
      card.appendChild(head);

      if (!state.selected) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "0.75rem" }, text: "Select a document from the browser above to inspect its typed fields, workflow definition, ACL and raw record." }));
        return card;
      }

      const record = state.selected;
      head.appendChild(chip(record.typeLabel, ""));
      head.appendChild(chip(`v${record.version}`, ""));
      head.appendChild(el("span.pu-ref", { text: record.id }));
      const editBtn = el("button.pu-btn.secondary", { type: "button", text: "Edit as JSON" });
      editBtn.addEventListener("click", () => {
        writeInput.value = JSON.stringify(record.raw, null, 2);
        state.writeResult = null;
        toast("Loaded into the editor below", { tone: "info" });
        rerender();
      });
      const closeBtn = el("button.pu-btn.secondary", { type: "button", text: "Close" });
      closeBtn.addEventListener("click", () => closeDocument());
      head.appendChild(el("div", { style: { "margin-left": "auto", display: "flex", gap: "0.4rem", "flex-wrap": "wrap" } }, editBtn, closeBtn));
      card.appendChild(head);

      const dl = el("dl.pu-kv", { style: { "margin-top": "0.75rem" } });
      for (const row of [
        ["Type", record.typeLabel],
        ["Name", record.name || "—"],
        ["Version", String(record.version)],
        ["Created", formatDate(record.created)],
        ["Modified", formatDate(record.modified)],
        ["Created by", record.createdBy || "—"],
        ["Modified by", record.modifiedBy || "—"],
        ["Encrypted", record.encrypt ? "yes" : "no"],
      ]) {
        dl.appendChild(el("dt", { text: row[0] }));
        dl.appendChild(el("dd", {}, el("span.pu-small", { text: row[1] })));
      }
      card.appendChild(dl);

      card.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: "Typed fields" }));
      card.appendChild(fieldTable(record));

      if (record.unknownKeys.length) {
        card.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: `Unmapped fields (${record.unknownKeys.length})` }));
        card.appendChild(el("p.pu-small", { text: "OpenFlow returned fields the hub does not model yet. They are preserved losslessly and written back untouched." }));
        const unknownTable = el("div.pu-table-scroll");
        const ut = el("table.pu-table");
        const uhead = el("thead");
        const uhr = el("tr");
        uhr.appendChild(el("th", { text: "Field" }));
        uhr.appendChild(el("th", { text: "Value" }));
        uhead.appendChild(uhr);
        ut.appendChild(uhead);
        const ubody = el("tbody");
        for (const key of record.unknownKeys) {
          const tr = el("tr");
          tr.appendChild(el("td", {}, el("span.pu-ref", { text: key })));
          tr.appendChild(el("td", {}, el("span.pu-small", { text: truncate(JSON.stringify(record.extra[key])) })));
          ubody.appendChild(tr);
        }
        ut.appendChild(ubody);
        unknownTable.appendChild(ut);
        card.appendChild(unknownTable);
      }

      if (record.type === "workflow") card.appendChild(workflowSection(record));

      card.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: "ACL" }));
      card.appendChild(aclSummary(record));

      const rawDetails = el("details.pu-details", { style: { "margin-top": "1rem" } });
      rawDetails.appendChild(el("summary", {}, el("span.pu-help-title", { text: "Raw document JSON" })));
      const rawBody = el("div.pu-details-body");
      rawBody.appendChild(el("pre.pu-code", { text: JSON.stringify(record.raw, null, 2) }));
      rawDetails.appendChild(rawBody);
      card.appendChild(rawDetails);
      return card;
    }

    function fieldTable(record) {
      const scroll = el("div.pu-table-scroll");
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Field", "Value", "Kind"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const entry of record.fields) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("span.pu-small", { text: entry.label })));
        const valueCell = el("td");
        if (entry.kind === "parameters" && Array.isArray(entry.value)) {
          valueCell.appendChild(parameterTable(entry.value));
        } else if (entry.large && entry.present) {
          valueCell.appendChild(largeValueNode(record, entry));
        } else {
          valueCell.appendChild(fieldValueNode(entry));
        }
        tr.appendChild(valueCell);
        tr.appendChild(el("td", {}, chip(entry.kind, entry.present ? "" : "warn")));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
      return scroll;
    }

    function fieldValueNode(entry) {
      if (!entry.present) return el("span.pu-small.pu-muted", { text: "not set" });
      if (entry.kind === "boolean") return chip(entry.value ? "yes" : "no", entry.value ? "ok" : "");
      if (entry.kind === "json") return el("span.pu-ref", { text: truncate(typeof entry.value === "string" ? entry.value : JSON.stringify(entry.value)) });
      if (entry.kind === "datetime") return el("span.pu-small", { text: formatDate(entry.value) });
      if (entry.kind === "list") return el("span.pu-small", { text: Array.isArray(entry.value) ? `${entry.value.length} entr${entry.value.length === 1 ? "y" : "ies"}` : String(entry.value) });
      if (entry.kind === "number") return el("span.pu-small", { text: String(entry.value) });
      if (entry.kind === "enum") return chip(String(entry.value), "");
      return el("span.pu-small", { text: truncate(String(entry.value)) });
    }

    function largeValueNode(record, entry) {
      const wrap = el("div");
      const revealed = !!state.reveal[entry.key];
      if (!revealed) {
        wrap.appendChild(el("span.pu-small.pu-muted", { text: `${String(entry.value).length} characters stored — hidden by default.` }));
        const revealBtn = el("button.pu-btn.secondary", { type: "button", text: "Reveal", style: { "margin-left": "0.5rem" } });
        revealBtn.addEventListener("click", () => {
          state.reveal[entry.key] = true;
          rerender();
        });
        wrap.appendChild(revealBtn);
        return wrap;
      }
      const hideBtn = el("button.pu-btn.secondary", { type: "button", text: "Hide" });
      hideBtn.addEventListener("click", () => {
        state.reveal[entry.key] = false;
        rerender();
      });
      wrap.appendChild(hideBtn);
      wrap.appendChild(el("pre.pu-code", { text: String(entry.value) }));
      return wrap;
    }

    function parameterTable(parameters) {
      const table = el("table.pu-table", { style: { "min-width": "320px" } });
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["Name", "Type", "Direction", "Required", "Default"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const parameter of parameters) {
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("span.pu-small", { text: parameter.name || "—" })));
        tr.appendChild(el("td", {}, el("span.pu-ref", { text: parameter.type })));
        tr.appendChild(el("td", {}, chip(parameter.direction, parameter.knownDirection ? "" : "warn")));
        tr.appendChild(el("td", {}, chip(parameter.required ? "yes" : "no", parameter.required ? "warn" : "")));
        tr.appendChild(el("td", { text: parameter.hasDefault ? String(parameter.default) : "—" }));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      return table;
    }

    function workflowSection(record) {
      const wrap = el("div");
      const presented = presentWorkflow(record.raw, { queueIds: state.queueIds });
      const workflow = presented.workflow;
      wrap.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: "Workflow definition" }));
      wrap.appendChild(el("p.pu-small", { text: presented.summary }));

      const flags = el("div", { style: { display: "flex", gap: "0.3rem", "flex-wrap": "wrap", "margin-top": "0.4rem" } });
      flags.appendChild(chip(`RPA ${workflow.rpa ? "yes" : "no"}`, workflow.rpa ? "ok" : ""));
      flags.appendChild(chip(`Web ${workflow.web ? "yes" : "no"}`, workflow.web ? "ok" : ""));
      flags.appendChild(chip(`Background ${workflow.background ? "yes" : "no"}`, ""));
      flags.appendChild(chip(`Serializable ${workflow.serializable ? "yes" : "no"}`, ""));
      flags.appendChild(chip(workflow.priority ? `priority ${workflow.priority}` : "no priority", ""));
      flags.appendChild(chip(workflow.queue ? `queue ${workflow.queue}` : "no queue binding", workflow.queue ? "" : "warn"));
      wrap.appendChild(flags);

      const dl = el("dl.pu-kv", { style: { "margin-top": "0.6rem" } });
      dl.appendChild(el("dt", { text: "File name" }));
      dl.appendChild(el("dd", {}, el("span.pu-small", { text: workflow.filename || "—" })));
      dl.appendChild(el("dt", { text: "Parameters" }));
      dl.appendChild(el("dd", {}, el("span.pu-small", { text: `${workflow.parameterCount} total · ${workflow.inputCount} input · ${workflow.outputCount} output` })));
      dl.appendChild(el("dt", { text: "Source" }));
      dl.appendChild(el("dd", {}, el("span.pu-small", { text: workflow.hasSource ? `${workflow.sourceLength} characters of XAML stored (hidden here)` : "no XAML stored" })));
      wrap.appendChild(dl);

      if (workflow.parameterCount) {
        wrap.appendChild(el("div.pu-table-scroll", { style: { "margin-top": "0.5rem" } }, parameterTable(presented.workflow.parameters)));
      }

      const issues = presented.issues;
      if (issues.length) {
        wrap.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: "Workflow checks" }));
        const ul = el("ul.pu-list");
        for (const issue of issues) {
          const li = el("li");
          li.appendChild(chip(issue.level, issue.level === "error" ? "fail" : issue.level === "warn" ? "warn" : ""));
          li.appendChild(el("span.pu-small", { text: issue.message }));
          ul.appendChild(li);
        }
        wrap.appendChild(ul);
      }
      return wrap;
    }

    function aclSummary(record) {
      const acl = record.acl;
      const wrap = el("div");
      const facts = el("ul.pu-list");
      facts.appendChild(listItem("ACL", acl.name));
      facts.appendChild(listItem("Members", `${acl.members} entr${acl.members === 1 ? "y" : "ies"}${acl.denied ? ` · ${acl.denied} denying` : ""}`));
      wrap.appendChild(facts);

      if (acl.ace.length) {
        const scroll = el("div.pu-table-scroll", { style: { "margin-top": "0.5rem" } });
        const table = el("table.pu-table");
        const thead = el("thead");
        const headRow = el("tr");
        for (const label of ["Entry", "Effect", "Rights"]) headRow.appendChild(el("th", { text: label }));
        thead.appendChild(headRow);
        table.appendChild(thead);
        const tbody = el("tbody");
        for (const ace of acl.ace) {
          const tr = el("tr");
          tr.appendChild(el("td", {}, el("span.pu-small", { text: ace.name || ace.id })));
          tr.appendChild(el("td", {}, chip(ace.deny ? "deny" : "allow", ace.deny ? "fail" : "ok")));
          tr.appendChild(el("td", { text: rightsText(ace.rights) }));
          tbody.appendChild(tr);
        }
        table.appendChild(tbody);
        scroll.appendChild(table);
        wrap.appendChild(scroll);
      }

      const subject = currentSubject();
      const rights = or.acl.rightsForDocument(record.raw, subject);
      wrap.appendChild(el("h4", { style: { "margin-top": "0.85rem" }, text: `Effective rights for ${subject.user.name}` }));
      wrap.appendChild(el("p.pu-small.pu-muted", { text: `Subject: ${subject.user.username || "anonymous"} · roles ${subject.roles.join(", ") || "none"} · source ${subject.source}` }));
      const chips = el("div", { style: { display: "flex", gap: "0.3rem", "flex-wrap": "wrap", "margin-top": "0.4rem" } });
      if (rights.granted.length) for (const key of rights.granted) chips.appendChild(chip(key, "ok"));
      else chips.appendChild(el("span.pu-small.pu-muted", { text: "No rights — OpenFlow denies by default." }));
      wrap.appendChild(chips);
      wrap.appendChild(actionGrid(record.raw, subject));
      return wrap;
    }

    function rightsText(mask) {
      const decoded = OPENRPA_RIGHTS.filter((right) => (mask & right.bit) === right.bit).map((right) => right.label);
      const known = OPENRPA_RIGHTS.reduce((acc, right) => acc | right.bit, 0);
      if (mask & ~known) decoded.push("Extended");
      if (mask === 65535) return "Full access";
      return decoded.join(", ") || "none";
    }

    function actionGrid(doc, subject) {
      const grid = el("div", { style: { display: "flex", gap: "0.3rem", "flex-wrap": "wrap", "margin-top": "0.5rem" } });
      for (const action of OPENRPA_ACTIONS) {
        const decision = or.acl.actionForDocument(doc, subject, action.id);
        const node = el("span.pu-chip", { class: decision.allowed ? "ok" : "fail", text: `${action.label} ${decision.allowed ? "✓" : "✕"}` });
        node.title = decision.reason;
        grid.appendChild(node);
      }
      return grid;
    }

    function buildWrite() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Write documents" }));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "Insert a new document, upsert by a uniqueness key, or update and delete the selected one. Updates carry the document version, so two writers cannot silently overwrite each other — a stale version comes back as a distinct conflict rather than a silent success.",
        })
      );

      if (!state.collection) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "0.75rem" }, text: "Load a collection first." }));
        return card;
      }

      card.appendChild(field("Document JSON", writeInput, `Target collection: ${state.collection}`));
      card.appendChild(el("div", { style: { "margin-top": "0.5rem" } }, field("Unique key (for upsert)", uniqInput)));

      const insertBtn = el("button.pu-btn", { type: "button", text: "Insert", "data-permission": "openrpa.write", "data-mutating": "" });
      insertBtn.addEventListener("click", () =>
        withBusy(insertBtn, "Inserting…", async () => {
          const parsed = parseDocumentInput();
          if (!parsed.ok) return reportResult(parsed);
          const result = await or.documents.insert(state.collection, parsed.item);
          if (result.ok) {
            toast(`Inserted ${result.document.name || result.document.id}`, { tone: "success" });
            state.writeResult = { tone: "ok", title: `Inserted ${result.document.name || result.document.id} at v${result.document.version}.` };
            await afterWrite(result.document);
          } else reportResult(result);
        })
      );

      const upsertBtn = el("button.pu-btn", { type: "button", text: "Upsert", "data-permission": "openrpa.write", "data-mutating": "" });
      upsertBtn.addEventListener("click", () =>
        withBusy(upsertBtn, "Upserting…", async () => {
          const parsed = parseDocumentInput();
          if (!parsed.ok) return reportResult(parsed);
          const unique = parseUniqInput();
          if (!unique.ok) return reportResult(unique);
          const result = await or.documents.upsert(state.collection, parsed.item, { uniq: unique.uniq });
          if (result.ok) {
            toast(result.created ? "Upserted (created)" : "Upserted (updated)", { tone: "success" });
            state.writeResult = { tone: "ok", title: `${result.created ? "Created" : "Updated"} ${result.document.name || result.document.id} at v${result.document.version}.` };
            await afterWrite(result.document);
          } else reportResult(result);
        })
      );

      const updateBtn = el("button.pu-btn.secondary", { type: "button", text: "Update selected", "data-permission": "openrpa.write", "data-mutating": "" });
      updateBtn.disabled = !state.selected;
      updateBtn.addEventListener("click", () =>
        withBusy(updateBtn, "Updating…", async () => {
          const selected = state.selected;
          const parsed = parseDocumentInput();
          if (!parsed.ok) return reportResult(parsed);
          const item = { ...parsed.item, _id: selected.id };
          const warning = warnFor(selected.raw, "update");
          const result = await or.documents.update(state.collection, item, { expectedVersion: selected.version });
          if (result.ok) {
            if (warning) toast(`Warning: ${warning}`, { tone: "error" });
            toast(`Updated ${result.document.name || result.document.id} to v${result.document.version}`, { tone: "success" });
            state.writeResult = { tone: "ok", title: `Updated to v${result.document.version}.${warning ? ` ${warning}` : ""}` };
            await afterWrite(result.document, { keepSelection: true });
          } else reportResult(result);
        })
      );

      const deleteBtn = el("button.pu-btn.secondary", { type: "button", text: state.deleteArmed ? "Confirm delete" : "Delete selected", "data-permission": "openrpa.write", "data-mutating": "" });
      deleteBtn.disabled = !state.selected;
      deleteBtn.addEventListener("click", () =>
        withBusy(deleteBtn, "Deleting…", async () => {
          const selected = state.selected;
          if (!state.deleteArmed) {
            state.deleteArmed = true;
            toast("Press again to confirm the delete", { tone: "info" });
            rerender();
            return;
          }
          const warning = warnFor(selected.raw, "delete");
          const result = await or.documents.remove(state.collection, selected.id);
          if (result.ok) {
            if (warning) toast(`Warning: ${warning}`, { tone: "error" });
            toast(`Deleted ${selected.name || selected.id}`, { tone: "info" });
            state.writeResult = { tone: "ok", title: `Deleted ${selected.name || selected.id}.${warning ? ` ${warning}` : ""}` };
            state.deleteArmed = false;
            state.selected = null;
            state.selectedId = null;
            await runQuery({ page: state.pageInfo.page });
          } else reportResult(result);
        })
      );

      const loadBtn = el("button.pu-btn.secondary", { type: "button", text: "New template" });
      loadBtn.addEventListener("click", () => {
        writeInput.value = JSON.stringify(templateFor(state.collection), null, 2);
        state.writeResult = null;
        rerender();
      });

      card.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.6rem" } }, insertBtn, upsertBtn, updateBtn, deleteBtn, loadBtn));
      card.appendChild(writeResultCtn);
      mount(writeResultCtn, writeResultNode());
      return card;
    }

    function parseDocumentInput() {
      const source = writeInput.value.trim();
      if (!source) return { ok: false, error: { kind: "validation", message: "The document editor is empty." } };
      let parsed;
      try {
        parsed = JSON.parse(source);
      } catch (error) {
        return { ok: false, error: { kind: "validation", message: `The document is not valid JSON: ${error.message}` } };
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
        return { ok: false, error: { kind: "validation", message: "A document must be a JSON object." } };
      }
      return { ok: true, item: parsed };
    }

    function parseUniqInput() {
      const source = uniqInput.value.trim();
      if (!source) return { ok: true, uniq: null };
      let parsed;
      try {
        parsed = JSON.parse(source);
      } catch (error) {
        return { ok: false, error: { kind: "validation", message: `The unique key is not valid JSON: ${error.message}` } };
      }
      if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return { ok: false, error: { kind: "validation", message: "A unique key must be a JSON object." } };
      return { ok: true, uniq: parsed };
    }

    function warnFor(doc, action) {
      const subject = currentSubject();
      const decision = or.acl.actionForDocument(doc, subject, action);
      return decision.allowed ? null : `You are not allowed to ${action} this document: ${decision.reason}`;
    }

    async function afterWrite(record, { keepSelection = false } = {}) {
      if (record) {
        state.selected = record;
        state.selectedId = record.id;
        if (!keepSelection) state.reveal = {};
      }
      state.deleteArmed = false;
      writeInput.value = JSON.stringify(record ? record.raw : templateFor(state.collection), null, 2);
      await runQuery({ page: state.pageInfo.page });
    }

    function reportResult(result) {
      state.writeResult = { tone: "fail", kind: result.error.kind, title: result.error.message, retryable: result.error.retryable };
      toast(result.error.message, { tone: "error" });
      rerender();
    }

    function writeResultNode() {
      if (!state.writeResult) return null;
      if (state.writeResult.tone === "ok") return alertNode(state.writeResult.title, "ok");
      const box = el("div.pu-alert.fail");
      const head = el("div", { style: { display: "flex", gap: "0.4rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(chip(KIND_LABEL[state.writeResult.kind] || state.writeResult.kind, KIND_TONE[state.writeResult.kind] || "fail"));
      head.appendChild(el("span", { text: state.writeResult.title }));
      box.appendChild(head);
      if (state.writeResult.retryable) box.appendChild(el("p.pu-small.pu-muted", { style: { "margin-top": "0.35rem" }, text: "This is a transport failure, so the same request can be retried safely." }));
      return box;
    }

    function buildAcl() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { "margin": "0" }, text: "Users, roles & access" }));
      head.appendChild(chip(state.mirrorReady ? "mirrored" : "not synced", state.mirrorReady ? "ok" : "warn"));
      card.appendChild(head);
      card.appendChild(
        el("p.pu-small", {
          text: "A mirror of the OpenFlow users, roles and per-document ACL entries. Rights are decoded from the OpenFlow access bitmask, deny always wins, and a user with no matching entry is denied by default — so you can see, before you act, whether the signed-in identity may read, update or delete a document.",
        })
      );

      const syncBtn = el("button.pu-btn.secondary", { type: "button", text: "Re-sync directory" });
      syncBtn.addEventListener("click", () =>
        withBusy(syncBtn, "Syncing…", async () => {
          await or.acl.sync();
          state.mirrorReady = or.acl.synced();
          syncAclUserOptions();
          toast("OpenFlow directory mirrored", { tone: "success" });
          rerender();
        })
      );
      card.appendChild(el("div.pu-toolbar", { style: { "margin-top": "0.6rem" } }, syncBtn, field("Evaluate ACL for", aclUserSelect)));

      const users = or.acl.users();
      if (!users.length) {
        card.appendChild(el("div.pu-empty", { style: { "margin-top": "0.75rem" }, text: "No OpenFlow users have been mirrored yet." }));
        return card;
      }

      const scroll = el("div.pu-table-scroll", { style: { "margin-top": "0.5rem" } });
      const table = el("table.pu-table");
      const thead = el("thead");
      const headRow = el("tr");
      for (const label of ["User", "Username", "OpenFlow roles", "Canonical roles"]) headRow.appendChild(el("th", { text: label }));
      thead.appendChild(headRow);
      table.appendChild(thead);
      const tbody = el("tbody");
      for (const user of users) {
        const roleNames = (user.roles || []).map((role) => (typeof role === "string" ? role : role.name)).filter(Boolean);
        const canonical = Array.from(new Set(roleNames.flatMap((role) => canonicalRoles(role))));
        const tr = el("tr");
        tr.appendChild(el("td", {}, el("div.pu-entity-name", { text: user.name || user.username }), el("span.pu-ref", { text: user._id || "" })));
        tr.appendChild(el("td", { text: user.username || "—" }));
        tr.appendChild(el("td", {}, ...roleNames.map((role) => chip(role, ""))));
        tr.appendChild(el("td", {}, ...canonical.map((role) => chip(role, "ok"))));
        tbody.appendChild(tr);
      }
      table.appendChild(tbody);
      scroll.appendChild(table);
      card.appendChild(scroll);

      if (state.selected) {
        card.appendChild(el("h3", { style: { "margin-top": "1rem" }, text: `Access to ${state.selected.name || state.selected.id}` }));
        card.appendChild(aclSummary(state.selected));
      } else {
        card.appendChild(el("p.pu-small.pu-muted", { style: { "margin-top": "0.75rem" }, text: "Select a document to inspect its ACL and your effective rights." }));
      }
      return card;
    }

    function canonicalRoles(roleName) {
      try {
        return hub.permissions.canonicalRolesFor("openrpa", roleName) || [];
      } catch (error) {
        return [];
      }
    }

    root.appendChild(
      pageHead({
        eyebrow: "OpenRPA",
        title: "Collections & documents",
        subtitle: "Browse OpenFlow's document collections with a JSON query builder, inspect typed documents and workflow definitions, write documents with optimistic concurrency, and read the ACL that governs each one.",
      })
    );
    root.appendChild(globalErrorCtn);
    root.appendChild(statsCtn);
    root.appendChild(browserCtn);
    root.appendChild(detailCtn);
    root.appendChild(writeCtn);
    root.appendChild(aclCtn);
    root.appendChild(
      el("p.pu-small.pu-muted", { style: { "margin-top": "1rem" }, text: `Modelled document types: ${OPENRPA_DOCUMENT_TYPES.map((type) => type.label).join(", ")}. Unknown fields on any document are preserved losslessly.` })
    );

    if (onDestroy) {
      onDestroy(() => {
        destroyed = true;
      });
    }

    syncCollectionOptions();
    syncAclUserOptions();
    rerender();
    load().catch((error) => {
      state.loading = false;
      state.loadError = error && error.message ? error.message : "The screen could not load.";
      rerender();
    });
    return root;
  },
};
