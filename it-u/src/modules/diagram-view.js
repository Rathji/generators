// src/modules/diagram-view.js — the diagram editor (roadmap task 23).
//
// The Organizations station's record table shows a diagram's one-line summary
// and an "Open" action; the site summary's gallery also opens it. This module is
// the editor behind that action. It authors the diagram's standardized fields
// (type, editable source, notes), and — the task-23 rule made real — manages the
// diagram's RENDITIONS alongside its SOURCE, so IT-U never ends up holding only
// the flattened picture:
//   • upload a rendered PNG/JPG/SVG/WebP/PDF (hosted through the upload plugin),
//     or paste a URL to one already hosted elsewhere;
//   • list, preview and remove renditions; and
//   • flag a diagram that has output but no editable source (see diagramIssues).
//
// Renditions are edited as a draft and committed with Save, so cancelling leaves
// the record untouched.

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal, fmtBytes } from "./shared.js";
import { buildStandardizedFields } from "./std-fields.js";
import { linksSection } from "./record-links.js";
import {
  RENDITION_FORMATS,
  renditionFormat,
  isImageFormat,
  sourceFormat,
  diagramType,
  diagramRenditions,
  makeRendition,
  renditionLabel,
  hasEditableSource,
} from "../framework/diagram.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";
const typeIcon = (id) => icons[(diagramType(id) || {}).icon] || icons.image;

// The link groups the editor offers. `types` are the far-side collections; the
// site link is authored from the site's side, so this record is the link's `to`.
const LINK_KINDS = [
  { kind: "site-diagram", label: "Site it belongs to", types: ["sites"], side: "to" },
  { kind: "diagram-location", label: "Location", types: ["locations"] },
  { kind: "diagram-asset", label: "Depicted asset", types: ["configurations", "flexibleAssets"] },
  { kind: "diagram-document", label: "Accompanying document", types: ["documents"] },
];

export async function openDiagramEditor(ctx, { setId, record, reload } = {}) {
  if (!setId || !record) return;
  let set = await ctx.docs.get(setId, { force: true }).catch(() => null);
  const readonly = !!(set && set.archived);
  const body = h("div", { class: "kb-doc-editor" });
  const m = openModal({
    title: "Diagram — " + (record.name || "Untitled"),
    description:
      "Keep the editable source alongside every rendered version. Upload the output, describe the source, and link the diagram to the site, assets and documents it shows.",
    wide: true,
    children: [body],
  });
  const box = m.overlay.querySelector(".kb-modal");
  if (box) box.classList.add("kb-modal-editor");

  let current = record;
  let draft = diagramRenditions(record);
  let form = null;

  async function rerender() {
    set = await ctx.docs.get(setId, { force: true }).catch(() => null);
    current = ((set && set.records.diagrams) || []).find((r) => r.id === record.id) || current;
    draft = diagramRenditions(current);
    clear(body);
    body.append(...editorBlocks());
  }

  const liveRecord = () => ((set && set.records.diagrams) || []).find((r) => r.id === record.id) || current;

  // ---- header -----------------------------------------------------------
  function headerBlock() {
    const rec = liveRecord();
    const t = diagramType(rec.diagramType);
    const src = hasEditableSource(rec);
    return h(
      "div",
      { class: "kb-doc-editor-head" },
      h("span", { class: "kb-doc-editor-icon", html: typeIcon(rec.diagramType) }),
      h(
        "div",
        { class: "kb-doc-editor-head-text" },
        h("div", { class: "kb-doc-editor-title" }, rec.name),
        h(
          "div",
          { class: "kb-doc-editor-badges" },
          h("span", { class: "kb-badge kb-badge-custom" }, t ? t.label : "Unknown type"),
          h("span", { class: "kb-badge kb-badge-model" }, draft.length + " rendition" + (draft.length === 1 ? "" : "s")),
          h("span", { class: "kb-badge " + (src ? "kb-badge-required" : "kb-badge-incomplete") }, src ? "Editable source kept" : "No editable source"),
        ),
      ),
    );
  }

  // ---- fields -----------------------------------------------------------
  function fieldsBlock() {
    const rec = liveRecord();
    const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Acme HQ network diagram" });
    nameInput.value = rec.name || "";
    nameInput.disabled = readonly;
    const std = buildStandardizedFields(set, "diagrams", rec);
    const section = h(
      "section",
      { class: "kb-card kb-profile-section" },
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Name"), nameInput),
      std.node,
    );
    section.inputs = { nameInput };
    section.std = std;
    return section;
  }

  // ---- renditions -------------------------------------------------------
  function renditionsBlock() {
    const section = h(
      "section",
      { class: "kb-card kb-profile-section kb-renditions-section" },
      h(
        "div",
        { class: "kb-section-head" },
        h("span", { class: "kb-section-icon", html: icons.image }),
        h("h2", { class: "kb-section-name" }, "Renditions"),
        h("span", { class: "kb-count-pill" }, String(draft.length)),
      ),
      h(
        "p",
        { class: "kb-muted" },
        "Rendered outputs (PNG, JPG, SVG, WebP or PDF) shown to the client. The editable original above must always be kept alongside them.",
      ),
    );
    const listEl = h("div", { class: "kb-renditions" });
    const renderList = () => {
      clear(listEl);
      if (!draft.length) {
        listEl.append(h("p", { class: "kb-muted" }, "No rendered versions yet."));
        return;
      }
      for (const r of draft) listEl.append(renditionRow(r, renderList));
    };
    const renderAll = () => {
      renderList();
      const pill = section.querySelector(".kb-count-pill");
      if (pill) pill.textContent = String(draft.length);
    };
    renderList();
    section.append(listEl);

    if (!readonly) section.append(addControls(renderAll));
    return section;
  }

  function renditionRow(r, rerenderList) {
    const f = renditionFormat(r.format);
    const meta = [];
    if (f) meta.push(f.label);
    if (r.bytes) meta.push(fmtBytes(r.bytes));
    if (r.width && r.height) meta.push(r.width + "×" + r.height);
    return h(
      "div",
      { class: "kb-rendition", dataset: { id: r.id } },
      isImageFormat(r.format)
        ? h("div", { class: "kb-rendition-thumb" }, h("img", { src: r.url, alt: r.label || r.format }))
        : h("div", { class: "kb-rendition-thumb kb-rendition-thumb--file", html: icons.download }),
      h(
        "div",
        { class: "kb-rendition-info" },
        h("span", { class: "kb-rendition-label" }, renditionLabel(r) || "Rendition"),
        h("span", { class: "kb-rendition-meta kb-muted" }, meta.join(" · ") || "—"),
        h("a", { class: "kb-rendition-url", href: r.url, target: "_blank", rel: "noopener" }, r.url),
      ),
      readonly
        ? null
        : h(
            "button",
            {
              class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text",
              type: "button",
              title: "Remove this rendition (does not delete the hosted file)",
              onClick: () => {
                draft = draft.filter((x) => x.id !== r.id);
                rerenderList();
              },
            },
            "Remove",
          ),
    );
  }

  function addControls(onChange) {
    const status = h("span", { class: "kb-rendition-status kb-muted" });
    const labelInput = h("input", { class: "kb-input", type: "text", placeholder: "Label (optional)" });
    const urlInput = h("input", { class: "kb-input", type: "text", placeholder: "https://… link to a rendered file" });
    const formatSel = h("select", { class: "kb-input" });
    for (const f of RENDITION_FORMATS) formatSel.append(h("option", { value: f.id }, f.label));
    formatSel.value = "png";

    const fileInput = h("input", { type: "file", class: "kb-hidden-file", multiple: true, accept: ".png,.jpg,.jpeg,.webp,.svg,.pdf,image/*,application/pdf" });
    fileInput.addEventListener("change", async () => {
      const files = [...(fileInput.files || [])];
      fileInput.value = "";
      if (!files.length) return;
      for (const file of files) {
        status.textContent = "Uploading " + file.name + "…";
        try {
          const uploaded = await uploadFile(file);
          const size = file.type && file.type.startsWith("image/") ? await readImageSize(uploaded.url) : {};
          draft = [...draft, makeRendition({ label: labelInput.value.trim(), format: guessFormat(file.name, file.type), url: uploaded.url, bytes: uploaded.bytes, width: size.width || null, height: size.height || null, uploadedBy: whoami(ctx) })];
          onChange();
        } catch (e) {
          status.textContent = String((e && e.message) || e);
          ctx.toast(String((e && e.message) || e), "error", 5200);
          return;
        }
      }
      status.textContent = "";
      labelInput.value = "";
    });

    const addUrl = () => {
      const url = urlInput.value.trim();
      if (!url) {
        status.textContent = "Paste a URL first.";
        return;
      }
      draft = [...draft, makeRendition({ label: labelInput.value.trim(), format: formatSel.value, url, uploadedBy: whoami(ctx) })];
      urlInput.value = "";
      labelInput.value = "";
      status.textContent = "";
      onChange();
    };

    return h(
      "div",
      { class: "kb-rendition-add" },
      h(
        "div",
        { class: "kb-rendition-add-row" },
        labelInput,
        h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: () => fileInput.click() }, h("span", { class: "kb-icon", html: icons.upload }), "Upload rendered file"),
        fileInput,
      ),
      h(
        "div",
        { class: "kb-rendition-add-row" },
        urlInput,
        formatSel,
        h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: addUrl }, "Add link"),
      ),
      status,
    );
  }

  // ---- links ------------------------------------------------------------
  function linksBlock() {
    return linksSection(ctx, { setId, set, record: liveRecord(), kinds: LINK_KINDS, readonly, onChange: async () => { await rerender(); reload && reload(); } });
  }

  function editorBlocks() {
    const f = fieldsBlock();
    form = { nameInput: f.inputs.nameInput, std: f.std };
    return [headerBlock(), f, renditionsBlock(), linksBlock()];
  }

  // ---- actions ----------------------------------------------------------
  if (readonly) {
    m.actions.append(h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: m.close }, "Close"));
  } else {
    m.actions.append(
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
      h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbDiagramSaveBtn" }, "Save diagram"),
    );
    m.actions.querySelector("#kbDiagramSaveBtn").addEventListener("click", async () => {
      m.clearError();
      const name = form.nameInput.value.trim();
      if (!name) {
        m.showError("Give the diagram a name.");
        return;
      }
      const patch = { name, ...form.std.collect(), renditions: draft };
      try {
        await ctx.docs.updateRecord(setId, { type: "diagrams", id: record.id }, patch, { updatedBy: whoami(ctx), actor: whoami(ctx) });
        m.close();
        ctx.toast("Saved “" + name + "”", "success");
        reload && reload();
      } catch (e) {
        m.showError(String((e && e.message) || e));
      }
    });
  }

  await rerender();
  return m;
}

// Upload a rendered file through the upload plugin (available as root.uploadPlugin
// on a saved/shared generator; in the editor it is emulated). Returns {url,bytes}.
async function uploadFile(file) {
  const app = typeof window !== "undefined" ? window.root : null;
  if (!app || !app.uploadPlugin) {
    throw new Error("Uploads are unavailable here — paste the rendered file's URL instead.");
  }
  const res = await app.uploadPlugin(file);
  if (!res || res.error) throw new Error("Upload failed" + (res && res.error ? ": " + res.error : "."));
  return { url: res.url, bytes: res.size != null ? res.size : file.size || null };
}

function guessFormat(name, mime) {
  const ext = (String(name || "").split(".").pop() || "").toLowerCase();
  const byExt = { png: "png", jpg: "jpg", jpeg: "jpg", webp: "webp", svg: "svg", pdf: "pdf" };
  if (byExt[ext]) return byExt[ext];
  const m = String(mime || "").toLowerCase();
  if (m.includes("png")) return "png";
  if (m.includes("jpeg") || m.includes("jpg")) return "jpg";
  if (m.includes("webp")) return "webp";
  if (m.includes("svg")) return "svg";
  if (m.includes("pdf")) return "pdf";
  return "other";
}

function readImageSize(url) {
  return new Promise((resolve) => {
    try {
      const img = new Image();
      img.onload = () => resolve({ width: img.naturalWidth || null, height: img.naturalHeight || null });
      img.onerror = () => resolve({});
      img.src = url;
    } catch {
      resolve({});
    }
  });
}

// The source format label for a record, shown by callers that summarise a diagram.
export const diagramSourceLabel = (record) => {
  const sf = sourceFormat(record && record.sourceFormat);
  return hasEditableSource(record) ? (record.sourceFileName || (sf ? sf.label : record.sourceFormat)) : "no editable source";
};
