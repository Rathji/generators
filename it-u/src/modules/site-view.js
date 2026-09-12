// src/modules/site-view.js — the site summary view (roadmap task 23).
//
// A site summary is the structured record a technician reads before attending a
// facility (see framework/site.js). This module is the view the Organizations
// station's "Open" action reaches: it shows the site's standardized facts and —
// the other half of task 23 — the drawings of the site, gathered from the linked
// diagrams and shown as a gallery so the site map, floor plan, network diagram,
// rack elevations and photos are all one click away.
//
// From here a new diagram can be created and linked to the site in one step;
// each gallery tile then opens the diagram editor (modules/diagram-view.js).

import { h, clear } from "../framework/dom.js";
import { icons } from "../framework/icons.js";
import { openModal } from "./shared.js";
import { buildStandardizedFields } from "./std-fields.js";
import { linksSection } from "./record-links.js";
import { openDiagramEditor } from "./diagram-view.js";
import { siteType, siteDetailLine } from "../framework/site.js";
import {
  DIAGRAM_GROUPS,
  diagramsOfGroup,
  diagramType,
  diagramTypeLabel,
  diagramRenditions,
  primaryRendition,
  isImageFormat,
  hasEditableSource,
} from "../framework/diagram.js";
import { relationsOf, findRecord } from "../framework/relationships.js";

const whoami = (ctx) => (ctx.hub && ctx.hub.username) || "owner";
const siteIcon = (id) => icons[(siteType(id) || {}).icon] || icons.building;

const LINK_KINDS = [
  { kind: "site-contact", label: "Responsible contact", types: ["contacts"] },
  { kind: "site-asset", label: "Asset at this site", types: ["configurations", "flexibleAssets"] },
];

export async function openSiteView(ctx, { setId, record, reload } = {}) {
  if (!setId || !record) return;
  let set = await ctx.docs.get(setId, { force: true }).catch(() => null);
  const readonly = !!(set && set.archived);
  const body = h("div", { class: "kb-doc-editor" });
  const m = openModal({
    title: "Site — " + (record.name || "Untitled"),
    description:
      "The practical facts an engineer needs before attending — access, power, cooling, connectivity, security and escalation — and the drawings of the site.",
    wide: true,
    children: [body],
  });
  const box = m.overlay.querySelector(".kb-modal");
  if (box) box.classList.add("kb-modal-editor");

  let current = record;
  let form = null;

  async function rerender() {
    set = await ctx.docs.get(setId, { force: true }).catch(() => null);
    current = ((set && set.records.sites) || []).find((r) => r.id === record.id) || current;
    clear(body);
    body.append(...editorBlocks());
  }

  const liveRecord = () => ((set && set.records.sites) || []).find((r) => r.id === record.id) || current;

  // ---- header -----------------------------------------------------------
  function headerBlock() {
    const rec = liveRecord();
    const t = siteType(rec.siteType);
    const loc = rec.locationId ? findRecord(set, { type: "locations", id: rec.locationId }) : null;
    return h(
      "div",
      { class: "kb-doc-editor-head" },
      h("span", { class: "kb-doc-editor-icon", html: siteIcon(rec.siteType) }),
      h(
        "div",
        { class: "kb-doc-editor-head-text" },
        h("div", { class: "kb-doc-editor-title" }, rec.name),
        h(
          "div",
          { class: "kb-doc-editor-badges" },
          h("span", { class: "kb-badge kb-badge-custom" }, t ? t.label : "Unknown type"),
          loc ? h("span", { class: "kb-badge kb-badge-model" }, "📍 " + loc.name) : h("span", { class: "kb-badge kb-badge-incomplete" }, "No location linked"),
        ),
      ),
    );
  }

  // ---- fields -----------------------------------------------------------
  function fieldsBlock() {
    const rec = liveRecord();
    const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. Acme HQ" });
    nameInput.value = rec.name || "";
    nameInput.disabled = readonly;
    const std = buildStandardizedFields(set, "sites", rec);
    const section = h(
      "section",
      { class: "kb-card kb-profile-section" },
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Site name"), nameInput),
      h("p", { class: "kb-field-help" }, siteDetailLine(rec, set)),
      std.node,
    );
    section.inputs = { nameInput };
    section.std = std;
    return section;
  }

  // ---- diagrams gallery -------------------------------------------------
  function diagramsBlock() {
    const rec = liveRecord();
    const links = relationsOf(set, { type: "sites", id: rec.id }).filter((x) => x.relationship.kind === "site-diagram");
    const section = h(
      "section",
      { class: "kb-card kb-profile-section kb-gallery-section" },
      h(
        "div",
        { class: "kb-section-head" },
        h("span", { class: "kb-section-icon", html: icons.map }),
        h("h2", { class: "kb-section-name" }, "Site diagrams & drawings"),
        h("span", { class: "kb-count-pill" }, String(links.length)),
        readonly ? null : h("button", { class: "kb-btn kb-btn-ghost kb-btn-sm", type: "button", id: "kbSiteNewDiagramBtn", onClick: () => newDiagramDialog(ctx, setId, rec, set, rerender) }, "+ Add diagram"),
      ),
    );
    if (!links.length) {
      section.append(
        h("p", { class: "kb-muted" }, "No drawings of this site yet. Add its site map, floor plan, network diagram, rack elevations and photos — keeping each one's editable source alongside its rendered version."),
      );
      return section;
    }
    const grid = h("div", { class: "kb-gallery" });
    for (const { relationship, other } of links) {
      const dia = findRecord(set, other);
      grid.append(diagramTile(ctx, setId, rec, dia, relationship, rerender));
    }
    section.append(grid);
    return section;
  }

  function diagramTile(ctx0, setId0, site, dia, relationship, onRemove) {
    if (!dia) {
      return h("div", { class: "kb-gallery-tile kb-gallery-tile--missing" }, h("span", { class: "kb-muted" }, "(missing diagram)"));
    }
    const primary = primaryRendition(dia);
    const renditions = diagramRenditions(dia);
    const thumb = primary && isImageFormat(primary.format)
      ? h("img", { class: "kb-gallery-thumb", src: primary.url, alt: dia.name })
      : h("div", { class: "kb-gallery-thumb kb-gallery-thumb--icon", html: icons[(diagramType(dia.diagramType) || {}).icon] || icons.image });
    const tile = h(
      "div",
      { class: "kb-gallery-tile", dataset: { id: dia.id } },
      h(
        "button",
        { class: "kb-gallery-open", type: "button", title: "Open diagram", onClick: () => openDiagramEditor(ctx0, { setId: setId0, record: dia, reload: onRemove }) },
        thumb,
        h("span", { class: "kb-gallery-name" }, dia.name),
        h(
          "span",
          { class: "kb-gallery-meta kb-muted" },
          (diagramTypeLabel(dia.diagramType) || "Diagram") + " · " + renditions.length + " rendition" + (renditions.length === 1 ? "" : "s") + (hasEditableSource(dia) ? "" : " · no source"),
        ),
      ),
      readonly
        ? null
        : h(
            "button",
            {
              class: "kb-btn kb-btn-ghost kb-btn-sm kb-btn-danger-text kb-gallery-unlink",
              type: "button",
              title: "Unlink from this site",
              onClick: async () => {
                try {
                  await ctx.docs.unlinkRecords(setId, relationship.id, { updatedBy: whoami(ctx) });
                  ctx.toast("Unlinked from site", "success");
                  await rerender();
                  reload && reload();
                } catch (e) {
                  ctx.toast(String((e && e.message) || e), "error", 5200);
                }
              },
            },
            "Unlink",
          ),
    );
    return tile;
  }

  function linksBlock() {
    return linksSection(ctx, { setId, set, record: liveRecord(), kinds: LINK_KINDS, readonly, onChange: async () => { await rerender(); reload && reload(); } });
  }

  function editorBlocks() {
    const f = fieldsBlock();
    form = { nameInput: f.inputs.nameInput, std: f.std };
    return [headerBlock(), f, diagramsBlock(), linksBlock()];
  }

  // ---- actions ----------------------------------------------------------
  if (readonly) {
    m.actions.append(h("button", { class: "kb-btn kb-btn-primary", type: "button", onClick: m.close }, "Close"));
  } else {
    m.actions.append(
      h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
      h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbSiteSaveBtn" }, "Save site"),
    );
    m.actions.querySelector("#kbSiteSaveBtn").addEventListener("click", async () => {
      m.clearError();
      const name = form.nameInput.value.trim();
      if (!name) {
        m.showError("Give the site a name.");
        return;
      }
      const patch = { name, ...form.std.collect() };
      try {
        await ctx.docs.updateRecord(setId, { type: "sites", id: record.id }, patch, { updatedBy: whoami(ctx), actor: whoami(ctx) });
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

// Create a diagram, link it to the site, then open its editor.
function newDiagramDialog(ctx, setId, site, set, onChange) {
  const nameInput = h("input", { class: "kb-input", type: "text", placeholder: "e.g. " + site.name + " network diagram", value: site.name + " — network diagram" });
  const typeSel = h("select", { class: "kb-input" });
  for (const group of DIAGRAM_GROUPS) {
    const og = h("optgroup", { label: group });
    for (const t of diagramsOfGroup(group)) og.append(h("option", { value: t.id }, t.label));
    typeSel.append(og);
  }
  typeSel.value = "network-diagram";
  const m = openModal({
    title: "Add a diagram to " + site.name,
    description: "Create the drawing and link it to this site in one step. The editor then opens so you can upload its rendered version and record its editable source.",
    children: [
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Name"), nameInput),
      h("div", { class: "kb-field" }, h("span", { class: "kb-field-label" }, "Diagram type"), typeSel),
    ],
  });
  m.actions.append(
    h("button", { class: "kb-btn kb-btn-ghost", type: "button", onClick: m.close }, "Cancel"),
    h("button", { class: "kb-btn kb-btn-primary", type: "button", id: "kbSiteCreateDiagramBtn" }, "Create diagram"),
  );
  m.actions.querySelector("#kbSiteCreateDiagramBtn").addEventListener("click", async () => {
    m.clearError();
    const name = nameInput.value.trim();
    if (!name) {
      m.showError("Give the diagram a name.");
      return;
    }
    try {
      const res = await ctx.docs.addRecord(
        setId,
        { type: "diagrams", name, informationModel: "document", provenance: "authored", diagramType: typeSel.value, sourceFormat: "drawio" },
        { updatedBy: whoami(ctx), actor: whoami(ctx) },
      );
      await ctx.docs.linkRecords(setId, { from: { type: "sites", id: site.id }, to: { type: "diagrams", id: res.record.id }, kind: "site-diagram", createdBy: whoami(ctx) });
      m.close();
      ctx.toast("Added “" + name + "”", "success");
      await onChange();
      openDiagramEditor(ctx, { setId, record: res.record, reload: onChange });
    } catch (e) {
      m.showError(String((e && e.message) || e) + (e && e.hint ? " " + e.hint : ""));
    }
  });
}
