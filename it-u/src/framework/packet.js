// src/framework/packet.js — printable & hostable client packets (roadmap task 50).
//
// A PACKET is the human-facing counterpart to task 49's machine envelope: one
// continuous, printable document assembled from a client's documentation set —
// a cover, an overview, an inventory, every document / runbook / checklist in
// full, reference tables for the record types, and a relationship map. There
// are two kinds, matching the bundles:
//
//   • a DOCUMENTATION packet covers one client's whole set;
//   • a DEPLOYMENT packet covers the runbooks, checklists and related records
//     for one service or site.
//
// Packets are built ON TOP of the publication engine (`buildDocumentationBundle`
// / `buildDeploymentBundle`), so they inherit exactly the same default-deny
// redaction posture: credential records are withheld, certificate private-key
// references are stripped, and PEM / otpauth / labelled secrets are scrubbed
// from prose. A packet is a document you can print and leave on-site, so it is
// the artifact that most needs that guarantee.
//
// A packet's `blocks` are { id, heading, kind, markdown } — the same markdown the
// rest of the app already renders (`renderMarkdown`), which is what makes both
// `packetToMarkdown` (a real `.md` download) and `packetToHtml` (the printable
// view and the standalone hosted file) trivial.

import { StoreError, CODES } from "./store/errors.js";
import { RECORD_TYPE_META, CLASSIFIED_TYPES } from "./docsets.js";
import { RECORD_FIELD_SCHEMAS, recordDetailLine } from "./standardized.js";
import { assetFieldsOf, hasAssetValue } from "./flexible.js";
import { relationshipKind } from "./relationships.js";
import { renderMarkdown } from "./markdown.js";
import {
  DEFAULT_REDACTION,
  normalizeRedaction,
  buildDocumentationBundle,
  buildDeploymentBundle,
  withheldSummary,
} from "./publication.js";

export const PACKET_SCHEMA = "itu-packet/1";

export const PACKET_KINDS = [
  { id: "documentation", label: "Documentation packet", description: "One client's whole documentation set as a single printable document." },
  { id: "deployment", label: "Deployment packet", description: "The runbooks, checklists and related records for deploying one service or site." },
];

export const packetKind = (id) => PACKET_KINDS.find((k) => k.id === id) || null;

const str = (v) => String(v == null ? "" : v).trim();
const isObj = (v) => typeof v === "object" && v !== null && !Array.isArray(v);
const isBlank = (v) => v == null || (typeof v === "string" && v.trim() === "");

const typeLabel = (t) => (RECORD_TYPE_META[t] || {}).label || t;

// Fields that are rendered by their own block (or are record plumbing) and so
// must never appear as an ordinary key/value row.
const NON_FIELD_KEYS = new Set([
  "id", "type", "name", "informationModel", "provenance", "createdAt", "updatedAt",
  "createdBy", "updatedBy", "rev", "version", "schema", "body", "items", "assetFields",
  "assetTypeId", "order",
]);

// markdown.js slugs heading ids the same way, so a packet TOC link resolves.
const slugify = (s) =>
  str(s)
    .toLowerCase()
    .replace(/[^a-z0-9\u00c0-\u024f]+/g, "-")
    .replace(/^-+|-+$/g, "") || "sec";

const humanizeKey = (key) =>
  str(key)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .replace(/^./, (c) => c.toUpperCase());

const cell = (s) => str(s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ");
const table = (rows) =>
  ["| Field | Value |", "| --- | --- |", ...rows.map(([k, v]) => `| ${cell(k)} | ${cell(v)} |`)].join("\n");

// Render any stored value as a short human string.
function humanValue(v) {
  if (v == null || v === "") return "";
  if (Array.isArray(v)) return v.map((x) => (isObj(x) ? x.name || x.label || x.title || x.id || "" : String(x))).filter(Boolean).join(", ");
  if (isObj(v)) return v.name || v.label || v.title || v.id || "";
  if (v === true) return "Yes";
  if (v === false) return "No";
  return String(v);
}

const selectLabel = (field, value) => {
  for (const o of field.options || []) {
    if (typeof o === "string") {
      if (o === value) return o;
    } else if (o && o.id === value) {
      return o.label || o.id;
    }
  }
  return value;
};

// Resolve a record's fields to display rows, using the standardized field
// schemas for a proper label + option label + record-reference name.
function fieldRows(set, type, record, opts) {
  const index = opts.index;
  const rows = [];

  if (type === "flexibleAssets") {
    const values = assetFieldsOf(record);
    const def = opts.assetTypeMap ? opts.assetTypeMap.get(record.assetTypeId) : null;
    if (def) {
      for (const f of def.fields || []) {
        const v = values[f.key];
        if (!hasAssetValue(f, v)) continue;
        rows.push([f.label, fieldValueString(f, v, index)]);
      }
    } else {
      for (const [k, v] of Object.entries(values)) {
        if (isBlank(v)) continue;
        rows.push([humanizeKey(k), humanValue(v)]);
      }
    }
    return rows;
  }

  const fields = RECORD_FIELD_SCHEMAS[type];
  if (fields) {
    for (const f of fields) {
      if (NON_FIELD_KEYS.has(f.key)) continue;
      const v = record[f.key];
      if (isBlank(v)) continue;
      rows.push([f.label, fieldValueString(f, v, index)]);
    }
    return rows;
  }

  for (const [k, v] of Object.entries(record)) {
    if (NON_FIELD_KEYS.has(k) || isBlank(v)) continue;
    if (isObj(v) && !(v.name || v.label || v.title || v.id)) continue;
    rows.push([humanizeKey(k), humanValue(v)]);
  }
  return rows;
}

function fieldValueString(field, value, index) {
  if (field.type === "select") return String(selectLabel(field, value));
  if (field.type === "checkbox") return value ? "Yes" : "No";
  if (field.type === "record" && typeof value === "string" && index) {
    return index.get((field.of || "") + "::" + value) || value;
  }
  return humanValue(value);
}

// Add a nesting level to the headings inside a document body so they sit below
// the packet's own headings. Fenced code is left untouched.
function demoteHeadings(md, by = 2) {
  let fence = false;
  return String(md)
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        fence = !fence;
        return line;
      }
      if (fence) return line;
      const m = line.match(/^(#{1,6})(\s+.*)$/);
      if (!m) return line;
      return "#".repeat(Math.min(6, m[1].length + by)) + m[2];
    })
    .join("\n");
}

// A reference name ("type::id" → name) so record-reference fields render as
// names rather than opaque ids.
function recordIndex(set) {
  const index = new Map();
  for (const t of CLASSIFIED_TYPES) {
    for (const r of (set && set.records && set.records[t]) || []) {
      if (r && r.id) index.set(t + "::" + r.id, r.name || r.id);
    }
  }
  return index;
}

// One record as markdown: a `###` heading, a one-line detail, a field table and
// (for types with a body) the body text.
function recordMarkdown(set, type, record, opts) {
  const rows = fieldRows(set, type, record, opts);
  const detail = recordDetailLine(set, record, { assetTypes: opts.assetTypeMap });
  const lines = ["### " + (record.name || record.id || typeLabel(type))];
  if (detail) lines.push("", "_" + detail + "_");
  if (rows.length) lines.push("", table(rows));
  if ((type === "documents" || type === "runbooks" || type === "sites") && str(record.body)) {
    lines.push("", demoteHeadings(record.body, 2));
  }
  return lines.join("\n");
}

function checklistMarkdown(set, cl) {
  const items = Array.isArray(cl.items) ? cl.items : [];
  const done = items.filter((i) => i && i.done).length;
  const detail = recordDetailLine(set, cl);
  const lines = ["### " + (cl.name || cl.id)];
  if (detail) lines.push("", "_" + detail + "_");
  lines.push("", `**${done} / ${items.length} complete**`, "");
  if (items.length) for (const it of items) lines.push("- [" + (it && it.done ? "x" : " ") + "] " + str(it && it.text));
  else lines.push("_No steps._");
  return lines.join("\n");
}

const refName = (ref) => (ref && (ref.name || ref.id)) || "—";

function relationshipsBlock(relationships) {
  const groups = new Map();
  for (const rel of relationships) {
    const k = (rel && rel.kind) || "related";
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(rel);
  }
  const lines = [];
  for (const [kind, list] of groups) {
    const label = (relationshipKind(kind) || {}).label || humanizeKey(kind);
    lines.push("### " + label, "");
    for (const rel of list) lines.push("- " + refName(rel.from) + " → " + refName(rel.to));
    lines.push("");
  }
  return lines.join("\n").trim();
}

function inventoryBlock(records) {
  const rows = [];
  for (const t of CLASSIFIED_TYPES) {
    const n = (records[t] || []).length;
    if (n) rows.push([typeLabel(t), String(n)]);
  }
  if (!rows.length) return "_No records._";
  return ["| Record type | Count |", "| --- | --- |", ...rows.map(([a, b]) => `| ${cell(a)} | ${cell(b)} |`)].join("\n");
}

function contentsLine(records) {
  const parts = CLASSIFIED_TYPES.filter((t) => (records[t] || []).length).map((t) => `${(records[t] || []).length} ${typeLabel(t).toLowerCase()}`);
  return parts.length ? parts.join(", ") : "no records";
}

function withheldNote(env) {
  const base = "_Credentials, secrets and private keys are never included in a published packet._";
  if (env.redaction && env.redaction.withheldTotal) {
    return base + "\n\n> _Withheld from this packet: " + withheldSummary(env.redaction.withheld) + "._";
  }
  return base;
}

// The section order each packet kind uses.
const DOCUMENTATION_ORDER = [
  "organizations", "locations", "contacts",
  "documents", "runbooks", "checklists",
  "configurations", "sites", "flexibleAssets",
  "certificates", "domains", "trackers", "diagrams",
];
const DEPLOYMENT_ORDER = ["runbooks", "checklists", "configurations", "sites", "flexibleAssets", "locations", "contacts", "documents"];

// Assemble a packet from an already-built publication envelope.
function packetFromEnvelope(set, env, opts, kind) {
  const index = recordIndex(set);
  const assetTypeMap = opts.assetTypes ? (opts.assetTypes instanceof Map ? opts.assetTypes : new Map((opts.assetTypes || []).map((t) => [t.id, t]))) : null;
  const rowOpts = { index, assetTypeMap };
  const records = env.records || {};
  const relationships = env.relationships || [];
  const blocks = [];

  const scopeName = opts.scopeLabel || null;
  const overview = kind === "deployment"
    ? [
        "**Client:** " + env.client.name,
        scopeName ? "**Scope:** " + scopeName : "",
        "",
        "**Contents:** " + contentsLine(records),
        "",
        withheldNote(env),
      ].filter((l) => l !== "").join("\n")
    : [
        "**Client:** " + env.client.name,
        "",
        "**Contents:** " + contentsLine(records),
        "",
        withheldNote(env),
      ].join("\n");
  blocks.push({ id: "overview", heading: "Overview", kind: "overview", refType: null, refId: null, markdown: overview });

  if (kind === "documentation") {
    blocks.push({ id: "inventory", heading: "Inventory", kind: "inventory", refType: null, refId: null, markdown: inventoryBlock(records) });
  }

  for (const type of (kind === "deployment" ? DEPLOYMENT_ORDER : DOCUMENTATION_ORDER)) {
    const list = records[type] || [];
    if (!list.length) continue;
    const markdown = list
      .map((r) => (type === "checklists" ? checklistMarkdown(set, r) : recordMarkdown(set, type, r, rowOpts)))
      .join("\n\n");
    blocks.push({ id: "records-" + type, heading: typeLabel(type), kind: "records", refType: type, refId: null, markdown });
  }

  if (relationships.length) {
    blocks.push({ id: "relationships", heading: "Relationship map", kind: "appendix", refType: "relationships", refId: null, markdown: relationshipsBlock(relationships) });
  }

  const counts = {
    records: CLASSIFIED_TYPES.reduce((n, t) => n + (records[t] || []).length, 0),
    relationships: relationships.length,
    documents: (records.documents || []).length,
    runbooks: (records.runbooks || []).length,
    checklists: (records.checklists || []).length,
    sections: blocks.length,
  };

  const clientName = env.client.name || env.client.id;
  const title = opts.title || (kind === "deployment" ? clientName + " — " + (scopeName || "deployment") + " packet" : clientName + " — documentation packet");

  return {
    schema: PACKET_SCHEMA,
    kind,
    title,
    subtitle: opts.subtitle || (kind === "deployment" ? "Deployment packet" : "Client documentation packet"),
    generatedAt: env.generatedAt,
    createdBy: env.createdBy || "system",
    app: env.app || { name: "IT-U", generator: opts.generatorName || null },
    client: env.client,
    scope: opts.scopeRef ? { ...opts.scopeRef, name: scopeName || opts.scopeRef.name || opts.scopeRef.id } : null,
    redaction: env.redaction,
    counts,
    blocks,
  };
}

// Build a DOCUMENTATION packet for one client's whole set.
export function buildDocumentationPacket(set, opts = {}) {
  const env = buildDocumentationBundle(set, { ...opts, policy: opts.policy == null ? DEFAULT_REDACTION : opts.policy });
  return packetFromEnvelope(set, env, opts, "documentation");
}

// Build a DEPLOYMENT packet for one service or site.
export function buildDeploymentPacket(set, opts = {}) {
  const env = buildDeploymentBundle(set, { ...opts, policy: opts.policy == null ? DEFAULT_REDACTION : opts.policy });
  const scopeLabel = deploymentScopeLabel(set, opts);
  return packetFromEnvelope(set, env, { ...opts, scopeLabel, scopeRef: opts.serviceRef || opts.siteRef || null }, "deployment");
}

// The human name of a deployment packet's scope (the service or site name).
export function deploymentScopeLabel(set, opts = {}) {
  const ref = opts.serviceRef || opts.siteRef || null;
  if (!ref) return null;
  if (ref.name) return ref.name;
  const list = ((set && set.records && set.records[ref.type]) || []);
  const found = list.find((r) => r.id === ref.id);
  return (found && found.name) || ref.id;
}

// ---- rendering --------------------------------------------------------------

export function packetToMarkdown(packet, opts = {}) {
  const lines = [];
  lines.push("# " + packet.title);
  if (packet.subtitle) lines.push("", packet.subtitle);
  const when = formatPacketDate(packet.generatedAt);
  lines.push("", "*" + (packet.client && packet.client.name ? packet.client.name + " · " : "") + "prepared " + when + (packet.createdBy ? " by " + packet.createdBy : "") + " · IT-U*");
  const blocks = packet.blocks || [];
  if (blocks.length && opts.toc !== false) {
    lines.push("", "## Contents");
    for (const b of blocks) lines.push("- [" + b.heading + "](#" + slugify(b.heading) + ")");
  }
  for (const b of blocks) {
    lines.push("", "---", "", "## " + b.heading, "", b.markdown || "");
  }
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim() + "\n";
}

// The rendered body (an HTML string), plus the heading table of contents.
export function packetToHtml(packet) {
  const rendered = renderMarkdown(packetToMarkdown(packet));
  return { html: rendered.html, toc: rendered.toc };
}

// A complete, self-contained printable HTML document — this is what "Download
// HTML" saves and what the hosted packet link serves. `print` shows a toolbar
// with a Print button that hides itself when printed.
export function packetToStandaloneHtml(packet, { print = true } = {}) {
  const { html } = packetToHtml(packet);
  const title = escapeHtml(packet.title);
  const toolbar = print
    ? `<div class="toolbar"><button type="button" onclick="window.print()">Print</button><span>${title}</span></div>`
    : "";
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${title}</title>
<style>${STANDALONE_CSS}</style>
</head>
<body>
${toolbar}
<article class="packet">${html}</article>
</body>
</html>
`;
}

const escapeHtml = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Print-first typography for the standalone file (system fonts; no dependency
// on the app's stylesheet).
const STANDALONE_CSS = `
:root { color-scheme: light; }
* { box-sizing: border-box; }
body { margin: 0; padding: 24px; font: 15px/1.6 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif; color: #1a1d21; background: #f4f5f7; }
.toolbar { position: sticky; top: 0; display: flex; gap: 12px; align-items: center; margin: -24px -24px 20px; padding: 12px 24px; background: #1b2430; color: #fff; }
.toolbar button { padding: 7px 16px; border: 0; border-radius: 6px; background: #3b82f6; color: #fff; font-weight: 600; cursor: pointer; }
.toolbar span { font-weight: 600; opacity: .85; }
article.packet { max-width: 820px; margin: 0 auto; padding: 40px 48px; background: #fff; border-radius: 10px; box-shadow: 0 1px 3px rgba(0,0,0,.12); }
article.packet h1 { font-size: 26px; margin: 0 0 6px; }
article.packet h2 { font-size: 20px; margin: 30px 0 10px; padding-bottom: 6px; border-bottom: 1px solid #e2e5e9; }
article.packet h3 { font-size: 16px; margin: 22px 0 8px; }
article.packet table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 13.5px; }
article.packet th, article.packet td { border: 1px solid #e2e5e9; padding: 6px 10px; text-align: left; vertical-align: top; }
article.packet th { background: #f4f5f7; }
article.packet blockquote { margin: 12px 0; padding: 8px 14px; border-left: 3px solid #cbd5e1; background: #f8fafc; color: #475569; }
article.packet code { background: #f1f3f5; padding: 1px 5px; border-radius: 4px; font-size: 12.5px; }
article.packet pre { background: #f8fafc; border: 1px solid #e2e5e9; border-radius: 8px; padding: 12px; overflow: auto; }
article.packet hr { border: 0; border-top: 1px solid #e2e5e9; margin: 26px 0; }
article.packet ul, article.packet ol { padding-left: 22px; }
article.packet a { color: #2563eb; }
@media print {
  body { padding: 0; background: #fff; }
  .toolbar { display: none !important; }
  article.packet { max-width: none; margin: 0; padding: 0; border-radius: 0; box-shadow: none; }
  article.packet h2 { break-after: avoid; }
  article.packet h3, article.packet table, article.packet pre { break-inside: avoid; }
}
`;

export function formatPacketDate(ts) {
  const d = new Date(ts || Date.now());
  return (Number.isNaN(d.getTime()) ? new Date() : d).toLocaleDateString(undefined, { year: "numeric", month: "long", day: "numeric" });
}

export function packetSummaryLine(packet) {
  const c = (packet && packet.counts) || {};
  const plural = (n, w) => n + " " + w + (n === 1 ? "" : "s");
  const client = packet && packet.client && packet.client.name ? " — " + packet.client.name : "";
  const kindLabel = (packetKind(packet && packet.kind) || { label: "Packet" }).label;
  return kindLabel + client + ": " + plural(c.records || 0, "record") + ", " + plural(c.sections || 0, "section") + (c.runbooks ? ", " + plural(c.runbooks, "runbook") : "") + (c.checklists ? ", " + plural(c.checklists, "checklist") : "");
}

export function packetFilename(packet, extension = "html") {
  const at = new Date((packet && packet.generatedAt) || Date.now());
  const stamp = (Number.isNaN(at.getTime()) ? new Date() : at).toISOString().replace(/[:.]/g, "-").slice(0, 19);
  const who = packet && packet.client && packet.client.name;
  const slug = str(who || (packet && packet.title)).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 60) || "client";
  return "itu-" + ((packet && packet.kind) || "packet") + "-packet-" + slug + "-" + stamp + "." + extension;
}

// ---- the service (build + host + packet log) --------------------------------

export const PACKET_LOG_KEY = "packet::log";

export function createPacketService({
  store,
  cache,
  upload = null,
  generatorName = null,
  now = () => Date.now(),
  prefix = "docset-",
  logKey = PACKET_LOG_KEY,
  maxLog = 50,
  getAssetTypes = null,
} = {}) {
  async function cacheGet(k) {
    try {
      return await cache.get(k);
    } catch {
      return undefined;
    }
  }
  async function cacheSet(k, v) {
    try {
      await cache.set(k, v);
    } catch {}
  }
  const isSetId = (id) => typeof id === "string" && id.startsWith(prefix);

  async function loadSet(clientId) {
    if (!isSetId(clientId)) throw new StoreError(CODES.INVALID_DATA, `“${clientId}” is not a documentation set id.`);
    const doc = await store.readDocument(clientId, { force: true }).catch(() => null);
    if (!doc) throw new StoreError(CODES.UNKNOWN_RECORD, `The documentation set “${clientId}” could not be loaded.`);
    return doc.data;
  }

  async function loadAssetTypes() {
    if (!getAssetTypes) return null;
    try {
      const types = await getAssetTypes();
      return Array.isArray(types) ? types : null;
    } catch {
      return null;
    }
  }

  async function buildDocumentation({ clientId, title, subtitle, policy, createdBy = "system" } = {}) {
    const set = await loadSet(clientId);
    const packet = buildDocumentationPacket(set, { title, subtitle, policy, createdBy, now: now(), generatorName, assetTypes: await loadAssetTypes() });
    return { packet, omitted: withheldSummary(packet.redaction.withheld) };
  }

  async function buildDeployment({ clientId, serviceRef, siteRef, runbookIds, checklistIds, title, subtitle, policy, createdBy = "system" } = {}) {
    const set = await loadSet(clientId);
    const packet = buildDeploymentPacket(set, { serviceRef, siteRef, runbookIds, checklistIds, title, subtitle, policy, createdBy, now: now(), generatorName, assetTypes: await loadAssetTypes() });
    return { packet, omitted: withheldSummary(packet.redaction.withheld) };
  }

  // Host a packet: upload its standalone HTML and record it in the packet log.
  async function host(packet, { createdBy = "system", note = "" } = {}) {
    if (!upload) throw new StoreError(CODES.STORAGE_UNAVAILABLE, "Hosting needs the generator to be saved (upload plugin unavailable).");
    const text = packetToStandaloneHtml(packet);
    const res = await upload(text, {});
    if (!res || !res.url) {
      throw new StoreError(CODES.STORAGE_UNAVAILABLE, res && res.error ? `Hosting failed: ${res.error}` : "Hosting failed.");
    }
    const entry = {
      id: "pkt_" + Math.random().toString(36).slice(2, 10) + now().toString(36),
      at: now(),
      kind: packet.kind,
      title: packet.title,
      clientId: packet.client && packet.client.id,
      clientName: packet.client && packet.client.name,
      scope: packet.scope || null,
      url: res.url,
      bytes: new TextEncoder().encode(text).length,
      counts: packet.counts || {},
      redaction: { withheldTotal: (packet.redaction && packet.redaction.withheldTotal) || 0 },
      schema: packet.schema,
      createdBy: createdBy || packet.createdBy,
      note,
    };
    const list = (await cacheGet(logKey)) || [];
    list.unshift(entry);
    await cacheSet(logKey, list.slice(0, maxLog));
    return entry;
  }

  async function listLog() {
    const list = (await cacheGet(logKey)) || [];
    return Array.isArray(list) ? list : [];
  }

  async function removeLogEntry(id) {
    const list = (await cacheGet(logKey)) || [];
    const next = list.filter((e) => e.id !== id);
    await cacheSet(logKey, next);
    return next;
  }

  async function clearLog() {
    await cacheSet(logKey, []);
    return [];
  }

  return {
    buildDocumentation,
    buildDeployment,
    host,
    listLog,
    removeLogEntry,
    clearLog,
    loadSet,
    packetToMarkdown,
    packetToHtml,
    packetToStandaloneHtml,
    packetFilename,
  };
}
