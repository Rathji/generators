// src/modules/import.js — the Import station (roadmap task 29, "Bulk import").
//
// Onboarding a client usually starts with a spreadsheet: an export of contacts,
// a device inventory, a credentials list. This station turns that CSV into
// structured records — organizations, contacts, configurations, credentials or
// flexible assets — through a deliberate, dry-run-first workflow:
//
//   1. pick the record type (and, for flexible assets, the template);
//   2. paste or upload the CSV;
//   3. confirm the column → field mapping (proposed automatically);
//   4. review the dry-run report — ready / duplicate / invalid / empty per row,
//      with the exact reason each problem row was rejected;
//   5. import. Every ready row becomes a classified record ("imported once"),
//      duplicates are skipped (unless you opt in), and any row that still fails
//      is reported individually — never silently dropped.
//
// The planning is pure (framework/importer.js); the write is one transaction in
// the documentation-set service (docs.importRecords), which also logs each
// import so there is a record of what was brought in and when.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { emptyState, loadingState, errorState } from "../framework/states.js";
import { viewPanel, relTime, fmtDate, downloadCsv } from "./shared.js";
import { IMPORT_TARGETS, importTarget, parseCsv, autoMapColumns, buildImportPlan, planSummary } from "../framework/importer.js";

const DESC =
  "Bring a client's existing spreadsheets into IT-U. Import a CSV of organizations, contacts, configurations, credentials or flexible assets through a column-mapping step, review a dry-run validation report, then commit — duplicates are detected and problem rows are reported, never dropped.";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";

const TARGET_ICONS = { organizations: "building", contacts: "user", configurations: "server", passwords: "shield", flexibleAssets: "layers" };

const SAMPLES = {
  organizations: `Name,Kind,Legal name,Website,Primary phone,Notes\nNorthwind Trading,organization,Northwind Trading Pty Ltd,https://northwind.example,555-0100,Head office\nNorthwind Logistics,business-unit,Northwind Logistics Pty Ltd,https://logistics.northwind.example,555-0200,`,
  contacts: `Name,Role,Organization,Job title,Email,Phone\nJo Bloggs,Client technical,NORTHWIND,IT Manager,jo.bloggs@northwind.example,555-0101\nDana Lee,Client primary,NORTHWIND,Operations Lead,dana.lee@northwind.example,555-0102`,
  configurations: `Name,Type,Manufacturer,Model,Serial number,Hostname,IP address,Support expiry,Warranty expiry\nNW-DC01,Physical server,Dell,PowerEdge R650,SN-01,nw-dc01,10.20.0.10,2027-06-30,2027-03-31\nNW-FW01,Firewall,Fortinet,FortiGate 60F,SN-02,nw-fw01,10.20.0.1,2027-01-15,\nNW-WS-JB,Workstation,Lenovo,ThinkCentre M90q,SN-03,nw-ws-jb,10.20.1.42,,2028-02-28`,
  passwords: `Name,Category,Username,Password,URL,Notes\nDomain admin,user-account,EXAMPLE\\admin,Correct-Horse-9,https://dc.example,Directory service account\nWi-Fi PSK,network,N/A,Super-Secret-123,,Guest wireless`,
  flexibleAssets: `Name,Owner,Expiry date,Notes\nExample asset,Jo Bloggs,2027-01-01,`,
};

export default {
  id: "import",
  label: "Import",
  desc: DESC,
  icon: icons.upload,
  render(ctx) {
    renderList(ctx);
  },
  renderDetail(ctx, sub) {
    renderDetail(ctx, decodeURIComponent(sub));
  },
};

// ---------------------------------------------------------------------------
// list view — pick the client to import into
// ---------------------------------------------------------------------------
function renderList(ctx) {
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading documentation sets…" }));
  const actions = h(
    "div",
    { class: "kb-actions-row" },
    h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => newSet(ctx) }, "New documentation set"),
  );
  ctx.container.append(viewPanel({ crumb: "IT-U", title: "Import", desc: DESC, actions, body }));
  loadList(ctx, body);
}

async function loadList(ctx, body) {
  let sets;
  try {
    sets = (await ctx.docs.summaries({ includeArchived: false })) || [];
  } catch (e) {
    clear(body);
    body.append(errorState({ title: "Couldn’t load documentation sets", description: String((e && e.message) || e), onRetry: () => loadList(ctx, body) }));
    return;
  }
  const counts = {};
  for (const s of sets) counts[s.id] = await ctx.docs.importHistory(s.id).then((i) => i.length).catch(() => 0);
  clear(body);
  if (!sets.length) {
    body.append(
      emptyState({
        icon: icons.upload,
        title: "No clients to import into yet",
        description: "A CSV import populates one client's documentation set. Create the set first, then bring in the spreadsheets you already have.",
        action: h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => newSet(ctx) }, "New documentation set"),
      }),
    );
    return;
  }
  const grid = h("div", { class: "kb-docset-grid" });
  for (const s of sets) grid.append(setCard(s, counts[s.id] || 0));
  body.append(h("div", { class: "kb-docset-count" }, sets.length + " documentation set" + (sets.length === 1 ? "" : "s")), grid);
}

function setCard(s, importCount) {
  return h(
    "a",
    { class: "kb-docset-card", href: "#/import/" + s.id, dataset: { id: s.id } },
    h(
      "div",
      { class: "kb-docset-card-head" },
      h("span", { class: "kb-docset-avatar", html: icons.upload }),
      h("div", { class: "kb-docset-card-id" }, h("h3", { class: "kb-docset-name" }, s.name), h("div", { class: "kb-docset-kind" }, "Documentation set")),
    ),
    h("div", { class: "kb-docset-meta" }, importCount ? importCount + " import" + (importCount === 1 ? "" : "s") + " so far" : "No imports yet"),
    h("div", { class: "kb-chips" }, h("span", { class: "kb-chip" }, (s.recordCount || 0) + " record" + (s.recordCount === 1 ? "" : "s"))),
  );
}

async function newSet(ctx) {
  const name = await promptName();
  if (!name) return;
  try {
    const set = await ctx.docs.create({ name, createdBy: whoami(ctx), actor: whoami(ctx) });
    ctx.toast("Created “" + set.name + "”", "success");
    ctx.go("#/import/" + set.id);
  } catch (e) {
    ctx.toast(String((e && e.message) || e), "error", 5200);
  }
}

function promptName() {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      overlay.remove();
      resolve(v);
    };
    const input = h("input", { class: "kb-input", type: "text", placeholder: "Client, department or business unit name" });
    const overlay = h("div", { class: "kb-modal-overlay" });
    const box = h(
      "div",
      { class: "kb-modal", role: "dialog", "aria-modal": "true" },
      h("h3", { class: "kb-modal-title" }, "New documentation set"),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Name"), input),
      h(
        "div",
        { class: "kb-modal-actions" },
        h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => finish(null) }, "Cancel"),
        h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: () => finish(input.value.trim() || null) }, "Create"),
      ),
    );
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") finish(input.value.trim() || null);
    });
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) finish(null);
    });
    overlay.append(box);
    document.body.append(overlay);
    input.focus();
  });
}

// ---------------------------------------------------------------------------
// detail — the import wizard
// ---------------------------------------------------------------------------
function renderDetail(ctx, id) {
  const titleEl = h("h1", { class: "kb-view-title" }, "…");
  const crumbEl = h("div", { class: "kb-breadcrumb" }, "IT-U / Import");
  const actions = h("div", { class: "kb-actions-row" });
  const body = h("div", { class: "kb-docset-body" }, loadingState({ label: "Loading documentation set…" }));
  ctx.container.append(
    h(
      "div",
      { class: "kb-view" },
      h(
        "header",
        { class: "kb-view-head" },
        crumbEl,
        h("div", { class: "kb-view-title-row" }, titleEl, actions),
        h("p", { class: "kb-view-desc" }, "Import a CSV into this client's documentation. Map the columns, review the dry run, then commit."),
      ),
      body,
    ),
  );
  loadDetail(ctx, id, { titleEl, crumbEl, actions, body });
}

async function loadDetail(ctx, id, ui) {
  let set;
  try {
    set = await ctx.docs.get(id, { force: true });
  } catch (e) {
    clear(ui.body);
    ui.body.append(errorState({ title: "Couldn’t load this documentation set", description: String((e && e.message) || e), onRetry: () => loadDetail(ctx, id, ui) }));
    return;
  }
  if (!set) {
    ui.titleEl.textContent = "Not found";
    clear(ui.body);
    ui.body.append(
      emptyState({
        icon: icons.alert,
        title: "Documentation set not found",
        description: "It may have been deleted.",
        action: h("a", { class: "kb-btn kb-btn-ghost", href: "#/import" }, "Back to Import"),
      }),
    );
    return;
  }
  ui.titleEl.textContent = set.name;
  ui.crumbEl.replaceChildren(h("a", { class: "kb-bc-link", href: "#/import" }, "IT-U / Import"), h("span", { class: "kb-bc-current" }, " / " + set.name));
  const archived = !!set.archived;
  clear(ui.actions);
  ui.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => ctx.go("#/organizations/" + set.id) }, "Open full set"),
  );
  clear(ui.body);
  if (archived) {
    ui.body.append(
      h(
        "div",
        { class: "kb-banner kb-banner-archived" },
        h("span", { class: "kb-banner-icon", html: icons.history }),
        h("div", { class: "kb-banner-text" }, h("strong", null, "This documentation set is archived and read-only."), " Restore it from the set's version history before importing."),
      ),
    );
    return;
  }
  importWizard(ctx, set, ui);
}

function importWizard(ctx, set, ui) {
  const state = {
    target: "organizations",
    text: "",
    parsed: null,
    mapping: {},
    source: "CSV import",
    allowDuplicates: false,
    assetTypeId: null,
    templates: [],
    plan: null,
    result: null,
    importing: false,
  };

  const templatesReady = ctx.assetTypes
    .list()
    .then((t) => {
      state.templates = t || [];
      if (!state.assetTypeId && state.templates.length) state.assetTypeId = state.templates[0].id;
      if (ui.body.isConnected) {
        remap();
        rebuild();
        render();
      }
    })
    .catch(() => {});

  const fieldsFor = () => {
    const t = importTarget(state.target);
    if (!t) return [];
    if (!t.dynamic) return [];
    const tpl = state.templates.find((x) => x.id === state.assetTypeId);
    return (tpl && tpl.fields) || [];
  };
  const templateFor = () => state.templates.find((x) => x.id === state.assetTypeId) || null;

  function remap() {
    if (!state.parsed) return;
    state.mapping = autoMapColumns(state.parsed.headers, state.target, fieldsFor());
  }

  function rebuild() {
    state.plan = null;
    if (!state.parsed) return;
    const t = importTarget(state.target);
    state.plan = buildImportPlan({
      target: t,
      headers: state.parsed.headers,
      rows: state.parsed.rows,
      mapping: state.mapping,
      existing: (set.records && set.records[t.recordType]) || [],
      records: set.records || {},
      source: state.source,
      allowDuplicates: state.allowDuplicates,
      extraFields: fieldsFor(),
      assetType: templateFor(),
    });
  }

  function parseNow() {
    state.result = null;
    try {
      state.parsed = state.text.trim() ? parseCsv(state.text) : null;
    } catch (e) {
      state.parsed = null;
      ctx.toast("Couldn’t parse the CSV: " + String((e && e.message) || e), "error", 5200);
    }
    remap();
    rebuild();
  }

  function pickTarget(id) {
    state.target = id;
    state.result = null;
    remap();
    rebuild();
  }

  let tailEl = null;
  function renderTail() {
    if (!tailEl || !tailEl.isConnected) return;
    clear(tailEl);
    tailEl.append(...(state.parsed ? [stepMapping()] : []), stepReport(), historyCard());
  }
  function render() {
    clear(ui.body);
    tailEl = h("div", { class: "kb-import-tail" });
    ui.body.append(stepTargets(), stepCsv(), tailEl);
    renderTail();
  }

  // ---- step 1: target ------------------------------------------------------
  function stepTargets() {
    const chips = h("div", { class: "kb-import-targets" });
    for (const t of IMPORT_TARGETS) {
      chips.append(
        h(
          "button",
          {
            class: "kb-import-target" + (state.target === t.id ? " kb-import-target--on" : ""),
            type: "button",
            dataset: { target: t.id },
            onClick: () => {
              pickTarget(t.id);
              render();
            },
          },
          h("span", { class: "kb-import-target-icon", html: icons[TARGET_ICONS[t.id]] || icons.table || icons.upload }),
          h("span", { class: "kb-import-target-label" }, t.singular),
        ),
      );
    }
    const t = importTarget(state.target);
    const card = h(
      "section",
      { class: "kb-card kb-record-section", id: "kbImportStep1" },
      sectionHead("1", "What are you importing?", icons.layers),
      h("p", { class: "kb-muted" }, "Pick the record type this CSV holds. Everything imported is stamped as directly imported (`imported once`) so its origin is always visible."),
      chips,
    );
    if (t && t.dynamic) {
      const sel = h("select", { class: "kb-input", id: "kbImportTemplate" });
      sel.append(h("option", { value: "" }, "— choose a template —"));
      for (const tpl of state.templates) sel.append(h("option", { value: tpl.id }, tpl.name));
      sel.value = state.assetTypeId || "";
      sel.addEventListener("change", () => {
        state.assetTypeId = sel.value || null;
        remap();
        rebuild();
        render();
      });
      card.append(
        h(
          "div",
          { class: "kb-field kb-import-template" },
          h("span", { class: "kb-field-label" }, "Flexible-asset template"),
          sel,
          h("span", { class: "kb-field-help" }, state.templates.length ? "The template defines which columns can be mapped." : "No templates in the library yet — create one in Assets first."),
        ),
      );
    }
    return card;
  }

  // ---- step 2: CSV ---------------------------------------------------------
  function stepCsv() {
    const area = h("textarea", { class: "kb-input kb-code kb-import-csv", rows: 8, placeholder: "Name,Type,Manufacturer,Model,Serial number,…\nNW-DC01,Physical server,Dell,PowerEdge R650,…", id: "kbImportCsv" });
    area.value = state.text;
    area.addEventListener("input", () => {
      state.text = area.value;
      parseNow();
      renderTail();
    });
    const fileInput = h("input", { type: "file", accept: ".csv,text/csv,text/plain", class: "kb-import-file" });
    fileInput.addEventListener("change", async () => {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      try {
        state.text = await f.text();
        parseNow();
        render();
        ctx.toast("Loaded “" + f.name + "”", "success");
      } catch (e) {
        ctx.toast("Couldn’t read that file: " + String((e && e.message) || e), "error", 5200);
      }
    });
    const dl = () =>
      downloadCsv(state.target + "-template.csv", [
        targetFieldsForDownload().map((f) => f.label),
      ]);
    const card = h(
      "section",
      { class: "kb-card kb-record-section", id: "kbImportStep2" },
      sectionHead("2", "Paste or upload the CSV", icons.upload),
      h("p", { class: "kb-muted" }, "The first row must be column headings. Quoted fields, embedded commas and newlines are handled. Nothing is written until you import."),
      area,
      h(
        "div",
        { class: "kb-import-csv-actions" },
        h("label", { class: "kb-btn kb-btn-ghost kb-btn-sm kb-import-file-btn" }, h("span", { html: icons.upload }), "Choose file…", fileInput),
        h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: dl }, "Download template"),
        h(
          "button",
          {
            class: "kb-btn kb-btn-ghost kb-btn-sm",
            type: "button",
            onClick: () => {
              state.text = SAMPLES[state.target] || SAMPLES.organizations;
              parseNow();
              render();
              ctx.toast("Sample CSV inserted", "info", 2200);
            },
          },
          "Insert sample",
        ),
        state.parsed ? h("span", { class: "kb-import-parse-note kb-muted" }, state.parsed.rows.length + " data row" + (state.parsed.rows.length === 1 ? "" : "s") + " · “" + (state.parsed.delimiter === "\t" ? "tab" : state.parsed.delimiter) + "” separated") : null,
      ),
      state.text.trim() && !state.parsed ? h("p", { class: "kb-import-warn" }, "Couldn’t read any rows from that text — check the first row is a heading row.") : null,
    );
    return card;
  }

  function targetFieldsForDownload() {
    const t = importTarget(state.target);
    return [{ label: "Name" }, ...((t && t.fields) || []), ...(t && t.dynamic ? fieldsFor() : [])];
  }

  // ---- step 3: mapping -----------------------------------------------------
  function stepMapping() {
    const t = importTarget(state.target);
    const fields = [{ key: "name", label: "Name", required: true, type: "text" }, ...(t.fields || []), ...(t.dynamic ? fieldsFor() : [])];
    const rows = [];
    let mappedCount = 0;
    for (const f of fields) {
      const sel = h("select", { class: "kb-input kb-input-sm", dataset: { field: f.key } });
      sel.append(h("option", { value: "" }, "— not mapped —"));
      state.parsed.headers.forEach((heading, i) => {
        const sample = state.parsed.rows.find((r) => String(r[i] || "").trim() !== "");
        const label = (heading || "(column " + (i + 1) + ")") + (sample ? " · " + String(sample[i]).slice(0, 24) : "");
        sel.append(h("option", { value: String(i) }, label));
      });
      sel.value = state.mapping[f.key] == null ? "" : String(state.mapping[f.key]);
      if (state.mapping[f.key] != null) mappedCount += 1;
      sel.addEventListener("change", () => {
        if (sel.value === "") delete state.mapping[f.key];
        else state.mapping[f.key] = Number(sel.value);
        rebuild();
        renderTail();
      });
      rows.push(
        h(
          "tr",
          { class: "kb-import-map-row" },
          h("td", null, h("span", { class: "kb-import-map-label" }, f.label), f.required ? h("span", { class: "kb-import-req" }, "required") : null),
          h("td", null, sel),
        ),
      );
    }
    const table = h("table", { class: "kb-table kb-import-map-table" }, h("thead", null, h("tr", null, h("th", null, "Field"), h("th", null, "CSV column"))), h("tbody", null, ...rows));

    const sourceInput = h("input", { class: "kb-input", type: "text", value: state.source, placeholder: "e.g. CSV export from the old RMM" });
    sourceInput.addEventListener("input", () => {
      state.source = sourceInput.value;
      rebuild();
    });
    const dupChk = h("input", { class: "kb-check", type: "checkbox", id: "kbImportAllowDup" });
    dupChk.checked = state.allowDuplicates;
    dupChk.addEventListener("change", () => {
      state.allowDuplicates = dupChk.checked;
      rebuild();
      renderTail();
    });
    const toggle = h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", onClick: () => autoMap() }, "Auto-map columns");

    return h(
      "section",
      { class: "kb-card kb-record-section", id: "kbImportStep3" },
      sectionHead("3", "Map the columns", icons.filter),
      h("p", { class: "kb-muted" }, mappedCount + " of " + fields.length + " fields mapped — " + "the rest are left blank. Reference columns (an organization, a location) match records already in this set by name."),
      h("div", { class: "kb-import-map-actions" }, toggle),
      table,
      h(
        "div",
        { class: "kb-import-options" },
        h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Import source (recorded against every imported record)"), sourceInput),
        h("label", { class: "kb-check-label" }, dupChk, h("span", null, "Import rows whose name already exists (they will be added as new records)")),
      ),
    );
  }

  // ---- step 4: dry run + import -------------------------------------------
  function stepReport() {
    const plan = state.plan;
    const card = h("section", { class: "kb-card kb-record-section", id: "kbImportStep4" }, sectionHead("4", "Review the dry run, then import", icons.check));
    if (!plan) {
      card.append(h("p", { class: "kb-muted" }, "Paste a CSV above to see the validation report."));
      return card;
    }
    const c = plan.counts;
    card.append(
      h(
        "div",
        { class: "kb-kpi-row kb-import-kpis" },
        kpi(String(c.total), "Rows"),
        kpi(String(c.ready), "Ready", c.ready ? "ok" : ""),
        kpi(String(c.duplicate), "Duplicate", c.duplicate ? "warn" : ""),
        kpi(String(c.invalid), "Invalid", c.invalid ? "bad" : ""),
        kpi(String(c.empty), "Empty"),
      ),
    );

    const problem = plan.rows.filter((r) => r.status === "invalid" || (r.status === "duplicate" && !state.allowDuplicates));
    if (problem.length) {
      const table = h("table", { class: "kb-table kb-record-table kb-import-report-table" });
      table.append(h("thead", null, h("tr", null, h("th", null, "Row"), h("th", null, "Name"), h("th", null, "Status"), h("th", null, "Issue"))));
      const tbody = h("tbody", null);
      for (const r of problem.slice(0, 40)) tbody.append(reportRow(r));
      table.append(tbody);
      card.append(h("h4", { class: "kb-import-subhead" }, "Rows needing attention"), table);
      if (problem.length > 40) card.append(h("p", { class: "kb-muted" }, "+" + (problem.length - 40) + " more…"));
    }

    const readyPreview = plan.rows.filter((r) => r.status === "ready" || (state.allowDuplicates && r.status === "duplicate"));
    if (readyPreview.length) {
      const mappedKeys = new Set(Object.keys(state.mapping || {}));
      mappedKeys.add("name");
      const seen = new Set();
      const fieldKeys = [{ key: "name", label: "Name" }, ...(importTarget(state.target).fields || [])].filter(
        (f) => mappedKeys.has(f.key) && !seen.has(f.key) && seen.add(f.key),
      );
      const table = h("table", { class: "kb-table kb-record-table kb-import-preview-table" });
      table.append(h("thead", null, h("tr", null, h("th", null, "#"), ...fieldKeys.map((f) => h("th", null, f.label)))));
      const tbody = h("tbody", null);
      for (const r of readyPreview.slice(0, 12)) {
        tbody.append(
          h(
            "tr",
            { class: "kb-record-row" },
            h("td", null, String(r.line)),
            ...fieldKeys.map((f) => h("td", { class: "kb-import-cell" }, formatCell(r, f))),
          ),
        );
      }
      table.append(tbody);
      card.append(h("h4", { class: "kb-import-subhead" }, "Will be imported"), table);
      if (readyPreview.length > 12) card.append(h("p", { class: "kb-muted" }, "Previewing the first 12 of " + readyPreview.length + "."));
    }

    const canImport = readyPreview.length > 0 && !state.importing;
    card.append(
      h(
        "div",
        { class: "kb-import-commit-actions" },
        h(
          "button",
          {
            class: "kb-btn kb-btn-primary",
            type: "button",
            id: "kbImportRunBtn",
            disabled: !canImport,
            onClick: () => runImport(readyPreview.length),
          },
          state.importing ? "Importing…" : "Import " + readyPreview.length + " record" + (readyPreview.length === 1 ? "" : "s"),
        ),
        h("span", { class: "kb-muted" }, planSummary(plan)),
      ),
    );

    if (state.result) {
      const r = state.result;
      card.append(
        h(
          "div",
          { class: "kb-import-result kb-import-result--" + (r.failed ? "warn" : "ok"), id: "kbImportResult" },
          h("strong", null, "Imported " + r.created + " record" + (r.created === 1 ? "" : "s") + "."),
          r.skipped ? " " + r.skipped + " skipped as duplicates." : "",
          r.failed ? " " + r.failed + " failed." : "",
        ),
      );
      if (r.results && r.results.some((x) => x.status !== "created")) {
        const table = h("table", { class: "kb-table kb-record-table" });
        table.append(h("thead", null, h("tr", null, h("th", null, "Row"), h("th", null, "Name"), h("th", null, "Result"), h("th", null, "Detail"))));
        const tbody = h("tbody", null);
        for (const x of r.results.filter((z) => z.status !== "created")) {
          tbody.append(h("tr", { class: "kb-record-row" }, h("td", null, String(x.line || "")), h("td", null, x.name || "—"), h("td", null, x.status), h("td", null, x.error || "")));
        }
        table.append(tbody);
        card.append(table);
      }
    }
    return card;
  }

  function reportRow(r) {
    return h(
      "tr",
      { class: "kb-record-row" },
      h("td", null, String(r.line)),
      h("td", null, (r.candidate && r.candidate.name) || "—"),
      h("td", null, statusBadge(r.status)),
      h("td", { class: "kb-import-issue" }, (r.errors || []).join(" ")),
    );
  }

  function formatCell(row, f) {
    const v = row.candidate ? row.candidate[f.key] : undefined;
    if (v === undefined || v === null || v === "") return "—";
    if (Array.isArray(v)) return v.join(", ");
    if (typeof v === "boolean") return v ? "yes" : "no";
    return String(v);
  }

  async function autoMap() {
    remap();
    rebuild();
    render();
    ctx.toast("Columns mapped automatically", "success", 2200);
  }

  async function runImport(count) {
    if (!state.plan) return;
    state.importing = true;
    render();
    try {
      const res = await ctx.docs.importRecords(
        set.id,
        { target: state.target, plan: state.plan, source: state.source, allowDuplicates: state.allowDuplicates },
        { updatedBy: whoami(ctx), actor: whoami(ctx) },
      );
      state.result = res;
      state.importing = false;
      const fresh = await ctx.docs.get(set.id, { force: true }).catch(() => null);
      if (fresh) set = fresh;
      rebuild();
      ctx.toast("Imported " + res.created + " record" + (res.created === 1 ? "" : "s") + (res.failed ? " · " + res.failed + " failed" : ""), res.failed ? "warning" : "success", 5200);
    } catch (e) {
      state.importing = false;
      ctx.toast(String((e && e.message) || e), "error", 6000);
    }
    renderTail();
  }

  // ---- import history ------------------------------------------------------
  function historyCard() {
    const imports = Array.isArray(set.imports) ? set.imports : [];
    const section = h(
      "section",
      { class: "kb-card kb-record-section", dataset: { type: "import-history" } },
      h("div", { class: "kb-section-head" }, h("span", { class: "kb-section-icon", html: icons.history }), h("h2", { class: "kb-section-name" }, "Import history"), h("span", { class: "kb-count-pill" }, String(imports.length))),
    );
    if (!imports.length) {
      section.append(h("p", { class: "kb-muted" }, "No imports yet. Completed imports are logged here with what was brought in and when."));
      return section;
    }
    const table = h("table", { class: "kb-table kb-record-table" });
    table.append(h("thead", null, h("tr", null, h("th", null, "When"), h("th", null, "Type"), h("th", null, "Source"), h("th", null, "Imported"), h("th", null, "Skipped"), h("th", null, "Failed"))));
    const tbody = h("tbody", null);
    for (const l of imports.slice(0, 12)) {
      const t = importTarget(l.target);
      tbody.append(
        h(
          "tr",
          { class: "kb-record-row", dataset: { id: l.id } },
          h("td", { title: fmtDate(l.at) }, relTime(l.at)),
          h("td", null, (t && t.singular) || l.target),
          h("td", { class: "kb-import-source-cell" }, l.source || "—"),
          h("td", null, String(l.created)),
          h("td", null, String(l.skipped || 0)),
          h("td", null, String(l.failed || 0)),
        ),
      );
    }
    table.append(tbody);
    section.append(table);
    return section;
  }

  // initial paint; the async template list re-renders if this view is still open
  render();

  function sectionHead(n, title, icon) {
    return h(
      "div",
      { class: "kb-section-head" },
      h("span", { class: "kb-import-step-no" }, n),
      h("span", { class: "kb-section-icon", html: icon }),
      h("h2", { class: "kb-section-name" }, title),
    );
  }
}

function statusBadge(status) {
  if (status === "ready" || status === "created") return h("span", { class: "kb-badge kb-badge-prov--authored" }, status === "created" ? "Imported" : "Ready");
  if (status === "duplicate") return h("span", { class: "kb-badge kb-badge-warn" }, "Duplicate");
  if (status === "invalid" || status === "error") return h("span", { class: "kb-badge kb-badge-danger" }, status === "error" ? "Failed" : "Invalid");
  return h("span", { class: "kb-badge" }, status || "—");
}

function kpi(value, label, tone) {
  return h("div", { class: "kb-kpi" + (tone ? " kb-kpi--" + tone : "") }, h("span", { class: "kb-kpi-value" }, value), h("span", { class: "kb-kpi-label" }, label));
}
