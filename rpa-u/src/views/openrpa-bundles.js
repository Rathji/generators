import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { OPENRPA_BUNDLE_SECTIONS, OPENRPA_BUNDLE_DOCUMENT_COLLECTIONS, sectionLabel } from "../core/openrpa/bundles.js";

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

function chip(text, tone) {
  return el("span.pu-chip", { class: tone || "", text });
}

function field(label, control, hint) {
  const wrap = el("label.pu-field");
  wrap.appendChild(el("span.pu-small.pu-muted", { text: label }));
  wrap.appendChild(control);
  if (hint) wrap.appendChild(el("span.pu-small.pu-muted", { text: hint }));
  return wrap;
}

function button(label, tone, permission) {
  const node = el(`button.pu-btn${tone ? `.${tone}` : ""}`, { type: "button", text: label });
  if (permission) {
    node.setAttribute("data-permission", permission);
    node.setAttribute("data-mutating", "");
  }
  return node;
}

function emptyNode(text) {
  return el("p.pu-empty", { text });
}

function alertNode(text, tone = "fail") {
  return el(`div.pu-alert.${tone}`, { text });
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

function table(headers) {
  const scroll = el("div.pu-table-scroll");
  const node = el("table.pu-table");
  const thead = el("thead");
  const row = el("tr");
  for (const label of headers) row.appendChild(el("th", { text: label }));
  thead.appendChild(row);
  node.appendChild(thead);
  const tbody = el("tbody");
  node.appendChild(tbody);
  scroll.appendChild(node);
  return { scroll, tbody };
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

async function withBusy(node, busyLabel, task) {
  const original = node.textContent;
  node.disabled = true;
  node.textContent = busyLabel;
  try {
    return await task();
  } finally {
    node.disabled = false;
    node.textContent = original;
  }
}

function downloadText(filename, text, mime = "application/json") {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

async function copyText(text) {
  try {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch (error) {}
  const area = el("textarea", { style: { position: "fixed", top: "-1000px" } });
  area.value = text;
  document.body.appendChild(area);
  area.select();
  let ok = false;
  try {
    ok = document.execCommand("copy");
  } catch (error) {
    ok = false;
  }
  area.remove();
  return ok;
}

function checkbox(label, checked) {
  const wrap = el("label.pu-check");
  const input = el("input", { type: "checkbox" });
  input.checked = checked;
  wrap.appendChild(input);
  wrap.appendChild(el("span", { text: label }));
  return { wrap, input };
}

const TONES = { create: "ok", update: "warn", skip: "" };

export const openrpaBundlesView = {
  id: "openrpa-bundles",
  title: "Export & import",
  group: "OpenRPA",
  icon: "bundle",
  nav: true,
  render({ hub, onDestroy }) {
    const or = hub.openrpa;
    const root = el("div");
    let destroyed = false;

    const state = {
      loading: true,
      loadError: null,
      overview: null,
      bundle: null,
      bundleJson: "",
      buildError: null,
      importText: "",
      validation: null,
      preview: null,
      importResult: null,
      published: [],
    };

    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const errorCtn = el("div", { style: { "margin-bottom": "1rem" } });
    const buildCtn = el("div");
    const importCtn = el("div");
    const publishedCtn = el("div");

    const nameInput = el("input.pu-input", { type: "text", placeholder: "OpenRPA configuration bundle" });
    const descriptionInput = el("input.pu-input", { type: "text", placeholder: "What this bundle captures" });
    const includeToggles = {
      profiles: checkbox("Connection profiles", true),
      ownership: checkbox("Field ownership", true),
      links: checkbox("Entity links", true),
      documents: checkbox("Document snapshots", true),
      assets: checkbox("Workflow assets", true),
    };
    const buildBtn = button("Build & preview", null, "bundles.publish");
    const downloadBtn = button("Download JSON", "secondary", "bundles.publish");
    const publishBtn = button("Publish", "secondary", "bundles.publish");
    downloadBtn.disabled = true;
    publishBtn.disabled = true;

    const importArea = el("textarea.pu-textarea", { rows: 8, placeholder: "Paste an OpenRPA bundle JSON here, or choose a file below." });
    const fileInput = el("input", { type: "file", accept: ".json,application/json" });
    const validateBtn = button("Validate", "secondary");
    const dryRunBtn = button("Dry run", null, "bundles.publish");
    const importBtn = button("Import", null, "bundles.publish");
    const importReportCtn = el("div");

    const jsonPreview = el("textarea.pu-textarea", { rows: 10, readonly: true });

    function rerender() {
      if (destroyed) return;
      renderStats();
      mount(errorCtn, state.loadError ? alertNode(state.loadError, "fail") : null);
      mount(buildCtn, buildBuilder());
      mount(importCtn, buildImporter());
      mount(publishedCtn, buildPublished());
    }

    function renderStats() {
      const overview = state.overview || {};
      const bundles = overview.bundles || {};
      mount(
        statsCtn,
        statCard("Published bundles", bundles.total || 0, `${bundles.exported || 0} exported`),
        statCard("Connection profiles", (overview.profiles && overview.profiles.total) || 0, "secrets never exported", "ok"),
        statCard("Entity links", (overview.linking && overview.linking.links) || 0, `${(overview.linking && overview.linking.unresolved) || 0} unresolved`),
        statCard("OpenRPA documents", bundles.latest ? bundles.latest.counts.documents : 0, bundles.latest ? bundles.latest.name : "nothing published yet")
      );
    }

    function refreshState() {
      state.overview = or.stats();
      state.published = or.bundles.list();
    }

    async function load() {
      state.loading = true;
      state.loadError = null;
      rerender();
      const connected = await or.connect({ announce: false });
      if (!connected.ok) {
        state.loading = false;
        state.loadError = connected.error || "Could not reach the OpenFlow endpoint.";
        refreshState();
        rerender();
        return;
      }
      await or.linking.refreshTargets();
      refreshState();
      state.loading = false;
      rerender();
    }

    function buildOptions() {
      return {
        name: nameInput.value.trim() || undefined,
        description: descriptionInput.value.trim() || undefined,
        includeProfiles: includeToggles.profiles.input.checked,
        includeOwnership: includeToggles.ownership.input.checked,
        includeLinks: includeToggles.links.input.checked,
        includeDocuments: includeToggles.documents.input.checked,
        includeAssets: includeToggles.assets.input.checked,
      };
    }

    function buildBuilder() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Build a portable bundle" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Capture the connection settings, ownership rules, entity links, OpenRPA documents and workflow assets a second hub needs to reproduce this integration." }));
      head.appendChild(el("span", { style: { "margin-left": "auto", display: "flex", gap: "0.4rem", "flex-wrap": "wrap" } }, [buildBtn, downloadBtn, publishBtn]));
      section.appendChild(head);

      section.appendChild(el("p.pu-small.pu-muted", { text: "Credentials are never included: profiles carry connection settings only, and any field that looks like a password, token or key is stripped on export (and reported below)." }));

      const form = el("div.pu-form-row", { style: { "margin-top": "0.5rem" } });
      form.appendChild(field("Bundle name", nameInput));
      form.appendChild(field("Description", descriptionInput));
      section.appendChild(form);

      const toggles = el("div.pu-toolbar");
      toggles.appendChild(el("span.pu-small.pu-muted", { text: "Include:" }));
      for (const id of OPENRPA_BUNDLE_SECTIONS) toggles.appendChild(includeToggles[id].wrap);
      section.appendChild(toggles);
      section.appendChild(el("p.pu-small.pu-muted", { text: `Document collections: ${OPENRPA_BUNDLE_DOCUMENT_COLLECTIONS.join(", ")}.` }));

      if (state.buildError) section.appendChild(alertNode(state.buildError, "fail"));
      if (state.bundle) {
        const counts = state.bundle.counts;
        const row = el("div.pu-toolbar", { style: { "margin-top": "0.5rem" } });
        row.appendChild(chip(`${counts.profiles} profile(s)`, counts.profiles ? "ok" : ""));
        row.appendChild(chip(`${counts.ownershipFields} owned field(s)`, ""));
        row.appendChild(chip(`${counts.links} link(s)`, ""));
        row.appendChild(chip(`${counts.documents} document(s) in ${counts.collections} collection(s)`, ""));
        row.appendChild(chip(`${counts.assets} asset(s) · ${counts.assetsBytes} B`, ""));
        if (counts.excludedSecrets) row.appendChild(chip(`${counts.excludedSecrets} secret field(s) stripped`, "warn"));
        section.appendChild(row);
        section.appendChild(el("p.pu-small.pu-muted", { text: `Fingerprint ${state.bundle.fingerprint} · ${state.bundle.manifest.length} manifest entries · format ${state.bundle.format} v${state.bundle.version}` }));
        if (state.bundle.warnings.length) {
          const warn = el("div.pu-alert.warn");
          for (const entry of state.bundle.warnings) warn.appendChild(el("div", { text: entry.message }));
          section.appendChild(warn);
        }
        jsonPreview.value = state.bundleJson;
        section.appendChild(field("Bundle JSON", jsonPreview));
      } else if (state.loading) {
        section.appendChild(loadingRow("Reading the OpenRPA endpoint for a preview…"));
      }
      return section;
    }

    function planTable(plan) {
      const wrap = el("div", { style: { "margin-top": "0.75rem" } });
      const { scroll, tbody } = table(["Section", "Total", "Create", "Update", "Skip"]);
      for (const id of ["profiles", "links", "documents", "assets"]) {
        const entry = plan[id];
        addRow(tbody, [sectionLabel(id), entry.total, chip(String(entry.create), entry.create ? "ok" : ""), entry.update, entry.skip]);
      }
      wrap.appendChild(scroll);
      return wrap;
    }

    function buildImporter() {
      const section = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "align-items": "center" } });
      head.appendChild(el("h2", { text: "Validate & import" }));
      head.appendChild(el("span.pu-small.pu-muted", { text: "Paste a bundle to check its format and version, dry-run exactly what it would change, then apply it to this hub." }));
      head.appendChild(el("span", { style: { "margin-left": "auto", display: "flex", gap: "0.4rem", "flex-wrap": "wrap" } }, [validateBtn, dryRunBtn, importBtn]));
      section.appendChild(head);

      const form = el("div.pu-form-row", { style: { "margin-top": "0.5rem" } });
      form.appendChild(field("Bundle file", fileInput));
      section.appendChild(form);
      section.appendChild(field("Bundle JSON", importArea));

      mount(importReportCtn, buildImportReport());
      section.appendChild(importReportCtn);
      return section;
    }

    function buildImportReport() {
      const wrap = el("div");
      if (state.validation) {
        if (!state.validation.ok) {
          const bad = el("div.pu-alert.fail");
          for (const error of state.validation.errors) bad.appendChild(el("div", { text: error.message }));
          wrap.appendChild(bad);
        } else {
          wrap.appendChild(alertNode(`Valid ${OPENRPA_BUNDLE_SECTIONS.length}-section bundle v${state.validation.version}: ${state.validation.counts.profiles} profile(s), ${state.validation.counts.links} link(s), ${state.validation.counts.documents} document(s), ${state.validation.counts.assets} asset(s).`, "ok"));
        }
      }
      if (state.preview) {
        wrap.appendChild(el("h3", { text: "Dry run" }));
        wrap.appendChild(planTable(state.preview.plan));
        wrap.appendChild(el("p.pu-small.pu-muted", { text: `Would create ${state.preview.summary.create} item(s) and skip ${state.preview.summary.skip}, with ${state.preview.summary.warnings} warning(s).` }));
        for (const warning of state.preview.warnings) wrap.appendChild(el("p.pu-small.pu-muted", { text: `• ${warning.message}` }));
      }
      if (state.importResult) {
        const result = state.importResult;
        if (result.dryRun) {
          wrap.appendChild(alertNode("Dry run complete — nothing was changed.", "warn"));
        } else if (result.ok) {
          wrap.appendChild(alertNode(`Imported ${result.applied.profiles} profile(s), ${result.applied.links} link(s), ${result.applied.documents} document(s) and ${result.applied.assets} asset(s); skipped ${result.applied.skipped}.`, "ok"));
        } else {
          const failed = el("div.pu-alert.fail");
          failed.appendChild(el("div", { text: `Imported with ${result.failed.length} failure(s):` }));
          for (const entry of result.failed) failed.appendChild(el("div", { text: `${entry.section} · ${entry.ref}: ${entry.error}` }));
          wrap.appendChild(failed);
        }
      }
      return wrap;
    }

    function buildPublished() {
      const section = el("section.pu-card");
      section.appendChild(el("h2", { text: "Published bundles" }));
      section.appendChild(el("p.pu-small.pu-muted", { text: "Every bundle this hub has built is kept here so it can be re-downloaded, copied into another tenant or removed." }));
      if (!state.published.length) {
        section.appendChild(emptyNode("No bundles yet — build one above."));
        return section;
      }
      const { scroll, tbody } = table(["Name", "Created", "Contents", "Fingerprint", ""]);
      for (const bundle of state.published) {
        const download = button("Download", "secondary", "bundles.publish");
        const copy = button("Copy JSON", "secondary", "bundles.publish");
        const remove = button("Delete", "secondary", "bundles.publish");
        download.addEventListener("click", () => downloadText(`${bundle.id}.json`, JSON.stringify(bundle, null, 2)));
        copy.addEventListener("click", () => withBusy(copy, "Copying…", async () => {
          const ok = await copyText(JSON.stringify(bundle, null, 2));
          toast(ok ? "Bundle JSON copied." : "The clipboard was unavailable.");
        }));
        remove.addEventListener("click", () => withBusy(remove, "Removing…", async () => {
          await or.bundles.remove(bundle.id);
          refreshState();
          rerender();
          toast("Bundle removed.");
        }));
        addRow(tbody, [
          bundle.name,
          formatDate(bundle.createdAt),
          `${bundle.counts.profiles} profile(s) · ${bundle.counts.links} link(s) · ${bundle.counts.documents} doc(s) · ${bundle.counts.assets} asset(s)`,
          bundle.fingerprint,
          el("span", { style: { display: "flex", gap: "0.3rem", "flex-wrap": "wrap" } }, [download, copy, remove]),
        ]);
      }
      section.appendChild(scroll);
      return section;
    }

    buildBtn.addEventListener("click", () =>
      withBusy(buildBtn, "Building…", async () => {
        state.buildError = null;
        const result = await or.bundles.build(buildOptions());
        if (!result.ok) {
          state.buildError = result.error || "The bundle could not be built.";
          rerender();
          toast(state.buildError);
          return;
        }
        state.bundle = result.bundle;
        state.bundleJson = JSON.stringify(result.bundle, null, 2);
        downloadBtn.disabled = false;
        publishBtn.disabled = false;
        rerender();
        toast(`Bundle built: ${result.bundle.counts.documents} document(s), ${result.bundle.counts.assets} asset(s).`);
      })
    );
    downloadBtn.addEventListener("click", () => {
      if (!state.bundle) return;
      downloadText(`${state.bundle.id}.json`, state.bundleJson);
      toast("Bundle downloaded.");
    });
    publishBtn.addEventListener("click", () =>
      withBusy(publishBtn, "Publishing…", async () => {
        if (!state.bundle) return;
        await or.bundles.register(state.bundle);
        refreshState();
        rerender();
        toast("Bundle published to this hub.");
      })
    );

    fileInput.addEventListener("change", async () => {
      const file = fileInput.files && fileInput.files[0];
      if (!file) return;
      const text = await file.text();
      importArea.value = text;
      toast(`Loaded ${file.name}.`);
    });

    importArea.addEventListener("input", () => {
      state.validation = null;
      state.preview = null;
      state.importResult = null;
      mount(importReportCtn, buildImportReport());
    });

    validateBtn.addEventListener("click", () =>
      withBusy(validateBtn, "Checking…", async () => {
        state.preview = null;
        state.importResult = null;
        state.validation = or.bundles.validate(importArea.value);
        mount(importReportCtn, buildImportReport());
        toast(state.validation.ok ? "Bundle is valid." : "The bundle failed validation.");
      })
    );
    dryRunBtn.addEventListener("click", () =>
      withBusy(dryRunBtn, "Planning…", async () => {
        state.importResult = null;
        const result = await or.bundles.preview(importArea.value);
        if (!result.ok) {
          state.validation = { ok: false, errors: result.errors, warnings: result.warnings || [] };
          state.preview = null;
        } else {
          state.validation = or.bundles.validate(importArea.value);
          state.preview = result;
        }
        mount(importReportCtn, buildImportReport());
        toast(result.ok ? `Dry run: ${result.summary.create} create, ${result.summary.skip} skip.` : "The bundle failed validation.");
      })
    );
    importBtn.addEventListener("click", () =>
      withBusy(importBtn, "Importing…", async () => {
        const result = await or.bundles.import(importArea.value);
        state.importResult = result;
        state.preview = null;
        if (!result.ok) state.validation = { ok: false, errors: result.errors || [], warnings: result.warnings || [] };
        await or.linking.refreshTargets();
        refreshState();
        rerender();
        toast(result.ok ? `Imported ${result.applied.documents} document(s).` : "The import reported failures.");
      })
    );

    const header = pageHead({
      eyebrow: "OpenRPA / OpenFlow",
      title: "Export & import",
      subtitle: "Package an OpenRPA integration — connection profiles, field ownership, entity links, document snapshots and workflow assets — into a versioned, secret-free bundle that another hub can validate, dry-run and import.",
    });

    mount(root, header, statsCtn, errorCtn, buildCtn, importCtn, publishedCtn);
    refreshState();
    rerender();
    load();

    if (typeof onDestroy === "function") {
      onDestroy(() => {
        destroyed = true;
      });
    }
    return root;
  },
};
