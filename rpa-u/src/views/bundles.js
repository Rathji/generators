import { el, mount } from "../framework/dom.js";
import { pageHead } from "../framework/shell.js";
import { toast } from "../framework/toast.js";
import { preview as previewBundle, serialize, filenameFor } from "../core/exporters.js";

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

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const link = el("a", { href: url, download: filename });
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

export const bundlesView = {
  id: "bundles",
  title: "Data bundles",
  group: "Output",
  icon: "bundle",
  nav: true,
  render({ hub }) {
    const root = el("div");
    const statsCtn = el("div.pu-grid.cols-4", { style: { "margin-bottom": "1rem" } });
    const builderCtn = el("div");
    const historyCtn = el("div");

    function renderStats() {
      const s = hub.bundles.stats();
      const audit = hub.audit.stats();
      mount(
        statsCtn,
        statCard("Published bundles", s.total, s.limit ? `keeps the newest ${s.limit}` : "no limit"),
        statCard("Records exported", s.records, `${Object.keys(s.byTarget).length} target${Object.keys(s.byTarget).length === 1 ? "" : "s"}`),
        statCard("Outbound movements", audit.outbound, `${audit.inbound} inbound recorded`),
        statCard("Last published", s.total ? timeOf(s.lastAt) : "—", s.total ? s.byFormat && Object.keys(s.byFormat).join(" / ") : "never")
      );
    }

    function currentOptions() {
      return {
        target: targetSelect.value,
        scope: scopeSelect.value,
        format: formatSelect.value,
        name: nameInput.value.trim() || null,
        includeLinks: linksCheck.checked,
        includeRegistry: registryCheck.checked,
        includeSensitive: sensitiveCheck.checked,
        includePrivate: privateCheck.checked,
        createdBy: "operator",
      };
    }

    const targetSelect = el("select.pu-select", { "aria-label": "Bundle target" });
    for (const target of hub.bundles.targets) targetSelect.appendChild(el("option", { value: target.id, text: `${target.label} — ${target.description}` }));
    const scopeSelect = el("select.pu-select", { "aria-label": "Bundle scope" });
    for (const scope of hub.bundles.scopes) scopeSelect.appendChild(el("option", { value: scope.id, text: scope.label }));
    const formatSelect = el("select.pu-select", { "aria-label": "Export format" });
    for (const format of hub.bundles.formats) formatSelect.appendChild(el("option", { value: format, text: format.toUpperCase() }));
    const nameInput = el("input.pu-input", { type: "text", placeholder: "Snapshot name (optional)", "aria-label": "Bundle name" });
    const linksCheck = el("input", { type: "checkbox", checked: true });
    const registryCheck = el("input", { type: "checkbox", checked: true });
    const sensitiveCheck = el("input", { type: "checkbox" });
    const privateCheck = el("input", { type: "checkbox" });

    const previewPre = el("pre.pu-code", { style: { "max-height": "22rem", overflow: "auto", "margin-top": "0.75rem" } });
    const previewMeta = el("div", { style: { display: "flex", gap: "0.4rem", "flex-wrap": "wrap", "margin-top": "0.6rem" } });
    let lastBuild = null;

    function refreshPreview() {
      const options = currentOptions();
      const result = hub.bundles.build(options);
      if (!result.ok) {
        mount(previewMeta, el("span.pu-chip.fail", { text: result.error }));
        previewPre.textContent = result.error;
        lastBuild = null;
        return;
      }
      lastBuild = result.bundle;
      const view = previewBundle(result.bundle, { format: options.format, table: "entities", maxLines: 80 });
      previewPre.textContent = view.text;
      mount(
        previewMeta,
        el("span.pu-chip", { text: `${result.bundle.counts.entities} records` }),
        el("span.pu-chip", { text: `${result.bundle.counts.links} links` }),
        el("span.pu-chip", { text: `${result.bundle.counts.references} references` }),
        result.bundle.counts.redactions ? el("span.pu-chip.warn", { text: `${result.bundle.counts.redactions} redacted` }) : null,
        el("span.pu-chip", { class: result.bundle.integrity.healthy ? "ok" : "warn", text: result.bundle.integrity.healthy ? "healthy" : `${result.bundle.integrity.driftOpen} drift` }),
        el("span.pu-small.pu-muted", { text: `${view.bytes} bytes · ${view.lines} line${view.lines === 1 ? "" : "s"} · fingerprint ${result.bundle.fingerprint}` })
      );
    }

    function buildBuilder() {
      const card = el("section.pu-card");
      card.appendChild(el("h2", { text: "Build a bundle" }));
      card.appendChild(
        el("p.pu-small", {
          text: "A bundle is a point-in-time snapshot of the linked directory. Choose who it is for, which slice to include, and the format to ship. Private and sensitive fields are stripped unless you opt in.",
        })
      );

      const form = el("div.pu-form-grid", { style: { "margin-top": "0.75rem" } });
      const row1 = el("div.pu-form-row");
      row1.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Target" }), targetSelect));
      row1.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Scope" }), scopeSelect));
      row1.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Format" }), formatSelect));
      form.appendChild(row1);
      form.appendChild(el("label.pu-field", {}, el("span.pu-small.pu-muted", { text: "Name" }), nameInput));

      const toggles = el("div", { style: { display: "flex", gap: "1rem", "flex-wrap": "wrap" } });
      const toggle = (input, label, hint) => {
        const wrap = el("label.pu-field", { style: { flex: "0 0 auto" } });
        const line = el("span", { style: { display: "flex", gap: "0.4rem", "align-items": "center" } });
        line.appendChild(input);
        line.appendChild(el("span.pu-small", { text: label }));
        wrap.appendChild(line);
        if (hint) wrap.appendChild(el("span.pu-small.pu-muted", { text: hint }));
        return wrap;
      };
      toggles.appendChild(toggle(linksCheck, "Include links", "cross-tool edges"));
      toggles.appendChild(toggle(registryCheck, "Include registry", "field ownership map"));
      toggles.appendChild(toggle(sensitiveCheck, "Include sensitive", "tax IDs etc."));
      toggles.appendChild(toggle(privateCheck, "Include private", "hub-only notes"));
      form.appendChild(toggles);
      card.appendChild(form);

      const actions = el("div", { style: { display: "flex", gap: "0.5rem", "flex-wrap": "wrap", "margin-top": "0.75rem" } });
      const publishBtn = el("button.pu-btn", { type: "button", text: "Publish bundle", "data-permission": "bundles.publish", "data-mutating": "" });
      const previewBtn = el("button.pu-btn.secondary", { type: "button", text: "Refresh preview" });
      const downloadBtn = el("button.pu-btn.secondary", { type: "button", text: "Download preview" });
      actions.appendChild(publishBtn);
      actions.appendChild(previewBtn);
      actions.appendChild(downloadBtn);
      card.appendChild(actions);
      card.appendChild(previewMeta);
      card.appendChild(previewPre);

      for (const control of [targetSelect, scopeSelect, formatSelect]) control.addEventListener("change", refreshPreview);
      nameInput.addEventListener("input", () => {});
      for (const check of [linksCheck, registryCheck, sensitiveCheck, privateCheck]) check.addEventListener("change", refreshPreview);
      previewBtn.addEventListener("click", refreshPreview);

      downloadBtn.addEventListener("click", () => {
        if (!lastBuild) return;
        const options = currentOptions();
        downloadText(filenameFor(lastBuild, options.format), serialize(lastBuild, options.format), options.format === "csv" ? "text/csv" : "application/json");
        toast(`Downloaded ${options.format.toUpperCase()} preview`, { tone: "success" });
      });

      publishBtn.addEventListener("click", async () => {
        publishBtn.disabled = true;
        publishBtn.textContent = "Publishing…";
        try {
          const result = await hub.bundles.publish(currentOptions());
          if (!result.ok) {
            toast(result.error, { tone: "error" });
            return;
          }
          await hub.audit.refresh();
          toast(`Published “${result.bundle.name}” (${result.bundle.counts.entities} records)`, { tone: "success" });
          nameInput.value = "";
          rerender();
        } finally {
          publishBtn.disabled = false;
          publishBtn.textContent = "Publish bundle";
        }
      });

      refreshPreview();
      return card;
    }

    function bundleDetails(bundle) {
      const details = el("details.pu-details");
      const summary = el("summary");
      summary.appendChild(el("span.pu-entity-name", { text: bundle.name }));
      summary.appendChild(el("span.pu-chip", { text: bundle.target }));
      summary.appendChild(el("span.pu-chip", { text: (bundle.format || "json").toUpperCase() }));
      summary.appendChild(el("span.pu-chip", { text: `${bundle.counts?.entities ?? 0} records` }));
      summary.appendChild(el("span.pu-small.pu-muted", { text: timeOf(bundle.createdAt) }));
      details.appendChild(summary);

      const body = el("div.pu-details-body");
      const metaBits = el("div", { style: { display: "flex", gap: "0.4rem", "flex-wrap": "wrap", "margin-bottom": "0.6rem" } });
      metaBits.appendChild(el("span.pu-chip", { text: `scope ${bundle.scopeLabel || bundle.scope}` }));
      metaBits.appendChild(el("span.pu-chip", { text: `${bundle.counts?.links ?? 0} links` }));
      metaBits.appendChild(el("span.pu-chip", { text: `${bundle.counts?.references ?? 0} references` }));
      if (bundle.counts?.redactions) metaBits.appendChild(el("span.pu-chip.warn", { text: `${bundle.counts.redactions} redacted` }));
      metaBits.appendChild(el("span.pu-chip", { class: bundle.integrity?.healthy ? "ok" : "warn", text: bundle.integrity?.healthy ? "healthy snapshot" : `${bundle.integrity?.driftOpen ?? 0} drift at publish` }));
      metaBits.appendChild(el("span.pu-mono.pu-muted", { text: `${bundle.id} · ${bundle.fingerprint}` }));
      body.appendChild(metaBits);

      const actions = el("div", { style: { display: "flex", gap: "0.4rem", "flex-wrap": "wrap" } });
      const copyBtn = el("button.pu-btn.secondary", { type: "button", text: "Copy JSON" });
      copyBtn.addEventListener("click", async () => {
        const ok = await copyText(serialize(bundle, "json"));
        toast(ok ? "Bundle JSON copied" : "Copy is unavailable — download it instead", { tone: ok ? "success" : "error" });
      });
      const dlJsonBtn = el("button.pu-btn.secondary", { type: "button", text: "Download JSON" });
      dlJsonBtn.addEventListener("click", () => {
        downloadText(filenameFor(bundle, "json"), serialize(bundle, "json"), "application/json");
        toast("Downloaded JSON bundle", { tone: "success" });
      });
      const dlCsvBtn = el("button.pu-btn.secondary", { type: "button", text: "Download CSV" });
      dlCsvBtn.addEventListener("click", () => {
        downloadText(filenameFor(bundle, "csv"), serialize(bundle, "csv", { table: "entities" }), "text/csv");
        toast("Downloaded CSV entity export", { tone: "success" });
      });
      const dlLinksBtn = el("button.pu-btn.secondary", { type: "button", text: "Download link CSV" });
      dlLinksBtn.addEventListener("click", () => {
        downloadText(filenameFor(bundle, "csv", { table: "links" }), serialize(bundle, "csv", { table: "links" }), "text/csv");
        toast("Downloaded CSV link export", { tone: "success" });
      });
      const deleteBtn = el("button.pu-btn.secondary", { type: "button", text: "Delete", "data-permission": "bundles.publish", "data-mutating": "" });
      deleteBtn.addEventListener("click", async () => {
        deleteBtn.disabled = true;
        await hub.bundles.remove(bundle.id);
        toast("Bundle deleted", { tone: "info" });
        rerender();
      });
      actions.appendChild(copyBtn);
      actions.appendChild(dlJsonBtn);
      actions.appendChild(dlCsvBtn);
      actions.appendChild(dlLinksBtn);
      actions.appendChild(deleteBtn);
      body.appendChild(actions);

      const view = previewBundle(bundle, { format: "json", maxLines: 24 });
      body.appendChild(el("pre.pu-code", { style: { "margin-top": "0.6rem", "max-height": "18rem", overflow: "auto" }, text: view.text }));
      details.appendChild(body);
      return details;
    }

    function buildHistory() {
      const card = el("section.pu-card");
      const head = el("div", { style: { display: "flex", gap: "0.5rem", "align-items": "center", "flex-wrap": "wrap" } });
      head.appendChild(el("h2", { style: { margin: "0" }, text: "Published bundles" }));
      const bundles = hub.bundles.list();
      head.appendChild(el("span.pu-chip", { text: `${bundles.length} kept` }));
      card.appendChild(head);
      card.appendChild(el("p.pu-small", { text: "Every publish is stored as a frozen snapshot and recorded on the audit ledger. Expand a row to export it again in JSON or CSV." }));

      if (!bundles.length) {
        card.appendChild(el("div.pu-empty", { text: "No bundles yet. Build one above and publish it to a target." }));
        mount(historyCtn, card);
        return;
      }
      for (const bundle of bundles) card.appendChild(bundleDetails(bundle));
      mount(historyCtn, card);
    }

    function rerender() {
      renderStats();
      buildHistory();
    }

    root.appendChild(
      pageHead({
        eyebrow: "Output",
        title: "Data bundles",
        subtitle: "Package the linked directory into a snapshot that downstream AI assistants, knowledge bases and warehouses can consume — with sensitive fields stripped and every publish traced on the audit ledger.",
      })
    );
    root.appendChild(statsCtn);
    builderCtn.appendChild(buildBuilder());
    root.appendChild(builderCtn);
    root.appendChild(historyCtn);

    rerender();
    return root;
  },
};
