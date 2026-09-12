// src/framework/diagram.js — diagrams, site maps & editable source files
// (roadmap Phase 5, task 23).
//
// A DIAGRAM record is one drawing and — crucially — BOTH its editable source
// and its rendered versions. The roadmap's rule is that the editable source is
// kept ALONGSIDE any rendered version: a network diagram is authored in
// draw.io / Visio / Lucidchart and exported to PNG/SVG/PDF for the client, and
// IT-U must never end up holding only the flattened picture.
//
// A diagram record therefore carries:
//   • a `diagramType` (site map, floor plan, network diagram, rack elevation,
//     logical/dependency diagram, infrastructure image, other);
//   • a SOURCE descriptor (file name, format, URL) — the editable original; and
//   • `renditions` — the rendered outputs (PNG/JPG/SVG/WebP/PDF), each with a
//     URL, format, size and label.
//
// The relationship kinds in ./relationships.js tie a diagram to the site
// summary, location, assets and documents it describes; `diagramIssues` is the
// audit that flags a diagram that has drifted from the rule (renditions with no
// source, or a source that was never rendered).
//
// This module is pure data + pure functions; the editor (renditions + uploads)
// is modules/diagram-view.js.

import { StoreError, CODES } from "./store/errors.js";

export const DIAGRAM_TYPES = [
  { id: "network-diagram", label: "Network diagram", group: "Network", icon: "layers", description: "The topology of the client's network." },
  { id: "rack-diagram", label: "Rack elevation", group: "Network", icon: "server", description: "A rack-by-rack elevation showing the mounted equipment." },
  { id: "logical-diagram", label: "Logical / dependency diagram", group: "Network", icon: "link", description: "Service dependencies and logical flows." },
  { id: "site-map", label: "Site map", group: "Site", icon: "map", description: "A plan of the site, campus or building layout." },
  { id: "floor-plan", label: "Floor plan", group: "Site", icon: "map", description: "A floor plan showing rooms, cabling and comms points." },
  { id: "infrastructure-image", label: "Infrastructure image / photo", group: "Site", icon: "image", description: "A photograph or scan of installed infrastructure." },
  { id: "other", label: "Other diagram", group: "Other", icon: "image", description: "A drawing that does not fit the standard types." },
];

export const DIAGRAM_GROUPS = ["Network", "Site", "Other"];

export const diagramType = (id) => DIAGRAM_TYPES.find((d) => d.id === id) || null;
export const diagramTypeLabel = (id) => (diagramType(id) || {}).label || null;
export const diagramsOfGroup = (group) => DIAGRAM_TYPES.filter((d) => d.group === group);

// Rendered output formats, and the editable source formats a TSP actually uses.
export const RENDITION_FORMATS = [
  { id: "png", label: "PNG", mime: "image/png", image: true },
  { id: "jpg", label: "JPEG", mime: "image/jpeg", image: true },
  { id: "svg", label: "SVG", mime: "image/svg+xml", image: true },
  { id: "webp", label: "WebP", mime: "image/webp", image: true },
  { id: "pdf", label: "PDF", mime: "application/pdf", image: false },
  { id: "other", label: "Other", mime: "", image: false },
];

export const SOURCE_FORMATS = [
  { id: "drawio", label: "draw.io / diagrams.net" },
  { id: "vsdx", label: "Visio (.vsdx)" },
  { id: "lucidchart", label: "Lucidchart" },
  { id: "omnigraffle", label: "OmniGraffle" },
  { id: "sketch", label: "Sketch" },
  { id: "psd", label: "Photoshop (.psd)" },
  { id: "xml", label: "XML / other text source" },
  { id: "other", label: "Other editable source" },
];

export const renditionFormat = (id) => RENDITION_FORMATS.find((f) => f.id === id) || null;
export const sourceFormat = (id) => SOURCE_FORMATS.find((f) => f.id === id) || null;
export const isImageFormat = (id) => !!(renditionFormat(id) || {}).image;

// The schema rendered by the standardized-field form. `renditions` is managed
// by the dedicated diagram editor, not this flat form, so it is not listed.
export const DIAGRAM_FIELDS = [
  { key: "diagramType", label: "Diagram type", type: "select", options: DIAGRAM_TYPES, required: true, default: "network-diagram" },
  { key: "sourceFileName", label: "Editable source — file name", type: "text", placeholder: "e.g. acme-network.drawio", help: "The original editable file, kept alongside every rendered version." },
  { key: "sourceUrl", label: "Editable source — URL", type: "text", placeholder: "https://…", help: "A link to the editable original (cloud file or upload)." },
  { key: "sourceFormat", label: "Editable source — format", type: "select", options: SOURCE_FORMATS, default: "drawio" },
  { key: "notes", label: "Notes", type: "textarea", placeholder: "What this drawing shows, and any legend or caveat." },
];

const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

// ---- renditions -----------------------------------------------------------
// A rendition is one rendered output of the diagram. Renditions are stored as a
// list on the record so the editable source and every rendered version travel
// together (and are exported together).
export function normalizeRenditions(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((r) => r && typeof r === "object")
    .map((r) => ({
      id: r.id || makeRenditionId(),
      label: String(r.label || "").trim(),
      format: renditionFormat(r.format) ? r.format : "other",
      url: String(r.url || "").trim(),
      bytes: Number.isFinite(Number(r.bytes)) && Number(r.bytes) > 0 ? Number(r.bytes) : null,
      width: Number.isFinite(Number(r.width)) ? Number(r.width) : null,
      height: Number.isFinite(Number(r.height)) ? Number(r.height) : null,
      uploadedBy: r.uploadedBy || "",
      uploadedAt: r.uploadedAt || null,
    }));
}

export function makeRenditionId() {
  return "rnd_" + Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
}

export function makeRendition({ label = "", format = "png", url = "", bytes = null, width = null, height = null, uploadedBy = "system", now = Date.now() } = {}) {
  return normalizeRenditions([{ id: makeRenditionId(), label, format, url, bytes, width, height, uploadedBy, uploadedAt: now }])[0];
}

export const diagramRenditions = (record) => normalizeRenditions(record && record.renditions);

// Pure list transforms — the caller persists the returned array (the editor
// passes it through updateRecord).
export function addRendition(record, rendition) {
  return [...diagramRenditions(record), rendition];
}

export function removeRendition(record, renditionId) {
  return diagramRenditions(record).filter((r) => r.id !== renditionId);
}

export function renditionLabel(rendition) {
  if (!rendition) return "";
  const f = renditionFormat(rendition.format);
  if (rendition.label) return f ? `${rendition.label} (${f.label})` : rendition.label;
  return f ? f.label : "Rendition";
}

// The rendition the UI shows first: the first image, else the first rendition.
export function primaryRendition(record) {
  const list = diagramRenditions(record);
  return list.find((r) => isImageFormat(r.format)) || list[0] || null;
}

// Does the record declare an editable source (a file name or a URL)?
export function hasEditableSource(record) {
  return !isBlank(record && record.sourceUrl) || !isBlank(record && record.sourceFileName);
}

// A one-line summary for a table row: type · N renditions · source format.
export function diagramDetailLine(record) {
  if (!record) return "";
  const t = diagramType(record.diagramType);
  const list = diagramRenditions(record);
  const bits = [t ? t.label : "Diagram"];
  bits.push(list.length ? list.length + " rendition" + (list.length === 1 ? "" : "s") : "no rendition");
  if (hasEditableSource(record)) {
    const sf = sourceFormat(record.sourceFormat);
    bits.push("source: " + (record.sourceFileName || (sf ? sf.label : record.sourceFormat)));
  } else {
    bits.push("no editable source");
  }
  return bits.join(" · ");
}

// ---- validation -----------------------------------------------------------
export function validateDiagram(record) {
  const errors = [];
  if (!record || typeof record !== "object") return { ok: false, errors: ["A diagram must be an object."] };
  if (!diagramType(record.diagramType)) {
    errors.push(`A diagram must declare a diagram type (${DIAGRAM_TYPES.map((d) => d.id).join(", ")}).`);
  }
  for (const r of diagramRenditions(record)) {
    if (!r.url) errors.push("Every rendition needs a URL.");
  }
  return { ok: errors.length === 0, errors };
}

export function requireDiagram(record) {
  const { ok, errors } = validateDiagram(record);
  if (!ok) {
    const name = record && (record.name || record.id) ? String(record.name || record.id) : "this diagram";
    throw new StoreError(CODES.INVALID_DATA, `“${name}” cannot be saved — ${errors.join(" ")}`);
  }
  return record;
}

// ---- audit ----------------------------------------------------------------
// The task-23 rule made checkable: rendered version(s) must keep the editable
// source alongside them. A diagram with renditions but no source is a warning
// (the original is at risk of being lost); a source with no rendition is an
// informational note (nothing client-facing has been produced yet).
export function diagramIssues(set) {
  const issues = [];
  if (!set || !set.records) return issues;
  for (const r of set.records.diagrams || []) {
    if (!diagramType(r.diagramType)) {
      issues.push({ level: "error", code: "unknown-diagram-type", recordId: r.id, message: `Diagram “${r.name}” has an unknown diagram type “${r.diagramType}”.` });
      continue;
    }
    const list = diagramRenditions(r);
    if (list.length && !hasEditableSource(r)) {
      issues.push({
        level: "warning",
        code: "rendition-without-source",
        recordId: r.id,
        message: `Diagram “${r.name}” has rendered version(s) but no editable source — keep the original alongside the output.`,
      });
    } else if (!list.length && hasEditableSource(r)) {
      issues.push({
        level: "info",
        code: "source-without-rendition",
        recordId: r.id,
        message: `Diagram “${r.name}” has an editable source but no rendered version yet.`,
      });
    }
  }
  return issues;
}
