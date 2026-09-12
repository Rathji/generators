// src/framework/ai-context.js — the per-screen context digests the "Ask AI"
// button sends to the model.
//
// When a user is looking at a client, an asset type or a Settings section, the
// Ask AI assistant should be able to answer questions about exactly THAT
// context — the client's records and relationships, the asset type's fields,
// the runbooks, the storage status. This module turns a screen key (the same
// key the help catalog uses: a station id, "<station>:detail", or
// "settings:<card>") plus the live service context into a compact, bounded
// text digest:
//
//   buildScreenContext(key, { ctx, sub })
//     → { title, subtitle, digest, suggestions }
//
// Everything here is plain text (no markup) and bounded (joinLines), so a
// digest can never blow the model's context window; the caller (framework/ai.js)
// also token-checks the fully-assembled prompt. Credential material is never
// included — a credential is named, its secret is redacted.

import { CLASSIFIED_TYPES, RECORD_TYPE_META, RECORD_KIND_LABELS } from "./docsets.js";
import { recordDetailLine } from "./standardized.js";
import { completenessReport, configurationCompleteness } from "./configuration.js";
import { assetFieldsOf } from "./flexible.js";
import { refKey } from "./relationships.js";
import { LIBRARY_ARTICLES, libraryArticle, libraryTopicLabel } from "./library.js";
import { HELP } from "./help.js";
import { connectivitySummary } from "./field.js";
import { ROLE_LABELS, scopeLabel } from "./roles.js";

// The Settings cards that carry their own context (mirrors the help catalog).
export const SETTINGS_CARDS = ["appearance", "storage", "conflicts", "capacity", "backup", "templates", "access", "roles", "idp", "activity", "integrity", "playbook"];

// A screen digest is capped well below the model budget (the caller adds the
// system preamble + the conversation on top).
const DIGEST_MAX = 9000;

// A field whose key/label looks secret is never rendered into a digest.
const SECRET_KEY = /(secret|password|passwd|passphrase|token|private|credential|pwd|\bpin\b|licen[cs]e.?key)/i;

const typeLabel = (t) => (RECORD_TYPE_META[t] && RECORD_TYPE_META[t].label) || t;
const singular = (t) => (RECORD_TYPE_META[t] && RECORD_TYPE_META[t].singular) || t;

function clip(value, n) {
  let s = String(value == null ? "" : value).replace(/\s+/g, " ").trim();
  if (s.length > n) s = s.slice(0, Math.max(0, n - 1)).trimEnd() + "…";
  return s;
}

// Join lines but never exceed maxChars — the last line is replaced by a note
// counting what was dropped, so the model knows the digest is truncated.
function joinLines(lines, maxChars = DIGEST_MAX) {
  const out = [];
  let n = 0;
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] == null ? "" : String(lines[i]);
    if (n + line.length + 1 > maxChars) {
      out.push(`… (${lines.length - i} further line${lines.length - i === 1 ? "" : "s"} omitted — the repository is larger than this summary)`);
      break;
    }
    out.push(line);
    n += line.length + 1;
  }
  return out.join("\n").trim();
}

function day(ts) {
  const n = Number(ts);
  if (!n) return "—";
  try {
    return new Date(n).toISOString().slice(0, 10);
  } catch {
    return "—";
  }
}

const findType = (types, id) => (types instanceof Map ? types.get(id) : (types || []).find((t) => t.id === id)) || null;

async function loadAssetTypes(ctx) {
  try {
    return (ctx && ctx.assetTypes && (await ctx.assetTypes.list())) || [];
  } catch {
    return [];
  }
}

// One record, as a digest line. Standardized types use their own detail line;
// flexible assets render their template's filled fields (secrets skipped);
// credentials never render their material.
function recordLine(type, record, set, assetTypes) {
  const model = record.informationModel || "none";
  const prov = record.provenance || "none";
  let detail = "";
  if (type === "flexibleAssets") {
    const t = findType(assetTypes, record.assetTypeId);
    const values = assetFieldsOf(record);
    const bits = [];
    for (const f of (t && t.fields) || []) {
      if (SECRET_KEY.test(f.key || "") || SECRET_KEY.test(f.label || "")) continue;
      const v = values[f.key];
      if (v == null || v === "" || v === false || (Array.isArray(v) && !v.length)) continue;
      bits.push(`${clip(f.label || f.key, 28)}: ${clip(Array.isArray(v) ? v.join(", ") : v, 60)}`);
      if (bits.length >= 4) break;
    }
    detail = [t ? t.name : "unknown type", bits.join("; ")].filter(Boolean).join(" — ");
  } else {
    detail = recordDetailLine(record, set, { assetTypes }) || "";
  }
  const origin = record.origin && (record.origin.source || record.origin.file) ? ` [origin: ${clip(record.origin.source || record.origin.file, 30)}]` : "";
  const secretNote = type === "passwords" ? " [secret not shown]" : "";
  return `  - ${clip(record.name, 70)}${detail ? " — " + clip(detail, 170) : ""} · ${model}/${prov}${secretNote}${origin}`;
}

function nameMap(set) {
  const map = new Map();
  for (const t of CLASSIFIED_TYPES) for (const r of set.records[t] || []) map.set(refKey({ type: t, id: r.id }), r.name);
  return map;
}

function countsSummary(counts) {
  if (!counts) return "";
  const bits = CLASSIFIED_TYPES.filter((t) => counts[t]).map((t) => `${counts[t]} ${typeLabel(t).toLowerCase()}`);
  return bits.length ? " (" + bits.join(", ") + ")" : "";
}

// ---------------------------------------------------------------------------
// repository-wide reads
// ---------------------------------------------------------------------------
async function summaries(ctx) {
  try {
    return (ctx && ctx.docs && (await ctx.docs.summaries({ includeArchived: true }))) || [];
  } catch {
    return [];
  }
}

function overviewLines(all) {
  const active = all.filter((s) => !s.archived);
  const archived = all.filter((s) => s.archived);
  const totalRecords = all.reduce((n, s) => n + (s.recordCount || 0), 0);
  const lines = [];
  lines.push(`REPOSITORY OVERVIEW: ${all.length} documentation set${all.length === 1 ? "" : "s"} — ${active.length} active, ${archived.length} archived; ${totalRecords} records in total.`);
  if (active.length) {
    lines.push("");
    lines.push(`ACTIVE CLIENTS (${active.length}):`);
    for (const s of active) lines.push(`  - ${clip(s.name, 60)} — ${s.recordCount || 0} records${countsSummary(s.counts)} · v${s.version || 1} · updated ${day(s.updatedAt)}`);
  }
  if (archived.length) {
    lines.push("");
    lines.push(`ARCHIVED CLIENTS (${archived.length}):`);
    for (const s of archived) lines.push(`  - ${clip(s.name, 60)} — ${s.recordCount || 0} records · archived ${day(s.archivedAt)}`);
  }
  return lines;
}

// How many instances each asset type has, and in which clients.
async function instanceIndex(ctx) {
  const map = new Map();
  for (const s of await summaries(ctx)) {
    let set;
    try {
      set = await ctx.docs.get(s.id);
    } catch {
      continue;
    }
    for (const r of (set && set.records && set.records.flexibleAssets) || []) {
      const e = map.get(r.assetTypeId) || { count: 0, clients: new Set() };
      e.count += 1;
      e.clients.add(s.name);
      map.set(r.assetTypeId, e);
    }
  }
  const out = new Map();
  for (const [id, v] of map) out.set(id, { count: v.count, clients: [...v.clients] });
  return out;
}

// ---------------------------------------------------------------------------
// screen digests
// ---------------------------------------------------------------------------
async function organizationsDigest(ctx) {
  const lines = overviewLines(await summaries(ctx));
  lines.push("");
  lines.push("A documentation set is the unit of storage, sync and backup — one client, one set. Open a client to work on its records; create a set from a blank template or a built-in starter.");
  return {
    title: "Organizations",
    subtitle: "All client documentation sets",
    digest: joinLines(lines),
    suggestions: [
      "Summarise my repository — how many clients and what is documented.",
      "Which clients have the least documentation?",
      "What should I document for a brand-new client?",
    ],
  };
}

async function clientDigest(ctx, id, { focus = null, sections = null, suggestions = null } = {}) {
  let set;
  try {
    set = await ctx.docs.get(id, { force: true });
  } catch {
    set = null;
  }
  if (!set) {
    return {
      title: "Unknown client",
      subtitle: "Documentation set not found",
      digest: "This documentation set could not be loaded (it may have been deleted).",
      suggestions: SUGGESTIONS["organizations:detail"],
    };
  }
  const assetTypes = await loadAssetTypes(ctx);
  const total = CLASSIFIED_TYPES.reduce((n, t) => n + ((set.records[t] || []).length), 0);
  const rels = (set.records.relationships || []).length;
  const lines = [];
  lines.push(`CLIENT DOCUMENTATION SET: ${set.name}`);
  lines.push(
    `Kind: ${RECORD_KIND_LABELS[set.kind] || set.kind} · status: ${set.archived ? "ARCHIVED (read-only)" : "active"} · version ${set.version || 1} · updated ${day(set.updatedAt)} by ${set.updatedBy || "—"}.`,
  );
  lines.push(`Holds ${total} records and ${rels} typed relationships in ONE versioned document (id ${set.id}).`);
  if (focus) lines.push(`The user is on the ${focus} view for this client.`);

  const present = CLASSIFIED_TYPES.filter((t) => (sections ? sections.includes(t) : true)).filter((t) => (set.records[t] || []).length);
  lines.push("");
  lines.push(`RECORD TYPES PRESENT: ${present.map((t) => `${(set.records[t] || []).length} ${typeLabel(t).toLowerCase()}`).join(", ") || "none"}.`);
  lines.push("");
  const order = ["organizations", "locations", "contacts", "configurations", "flexibleAssets", "passwords", "documents", "domains", "certificates", "sites", "diagrams", "checklists", "runbooks"];
  const ordered = order.filter((t) => present.includes(t)).concat(present.filter((t) => !order.includes(t)));
  for (const t of ordered) {
    const recs = set.records[t] || [];
    lines.push(`${typeLabel(t)} (${recs.length}):`);
    const cap = t === "documents" ? 40 : 60;
    for (const r of recs.slice(0, cap)) lines.push(recordLine(t, r, set, assetTypes));
    if (recs.length > cap) lines.push(`  … and ${recs.length - cap} more ${typeLabel(t).toLowerCase()}.`);
    lines.push("");
  }

  if (rels) {
    const names = nameMap(set);
    lines.push(`RELATIONSHIPS (${rels}) — each is a typed, directional link stored once and visible from both records:`);
    const cap = 90;
    for (const r of (set.records.relationships || []).slice(0, cap)) {
      const from = names.get(refKey(r.from)) || (r.from && r.from.type) || "?";
      const to = names.get(refKey(r.to)) || (r.to && r.to.type) || "?";
      lines.push(`  - ${clip(from, 52)} —[${r.kind}]→ ${clip(to, 52)}`);
    }
    if (rels > cap) lines.push(`  … and ${rels - cap} more relationships.`);
    lines.push("");
  }

  const rep = completenessReport(set);
  if (rep && rep.total) {
    lines.push(`CONFIGURATION COMPLETENESS: ${rep.completeCount} of ${rep.total} configurations complete${rep.incompleteCount ? `; ${rep.incompleteCount} incomplete` : ""}.`);
    const incomplete = (set.records.configurations || []).filter((r) => {
      try {
        const c = configurationCompleteness(r, set, set.completeness);
        return c && !c.complete;
      } catch {
        return false;
      }
    });
    for (const r of incomplete.slice(0, 20)) {
      let missing = [];
      try {
        missing = configurationCompleteness(r, set, set.completeness).missingLabels || [];
      } catch {}
      lines.push(`  - ${clip(r.name, 55)} is missing: ${missing.join(", ") || "—"}`);
    }
    if (incomplete.length > 20) lines.push(`  … and ${incomplete.length - 20} more incomplete configurations.`);
    lines.push("");
  }

  try {
    const lc = await ctx.docs.lifecycle(id);
    const items = (lc && lc.items) || [];
    const attention = items
      .filter((it) => it.date && it.state !== "ok")
      .sort((a, b) => (a.daysUntil == null ? 1e9 : a.daysUntil) - (b.daysUntil == null ? 1e9 : b.daysUntil));
    if (attention.length) {
      lines.push(`LIFECYCLE — expiries/renewals needing attention (${attention.length}):`);
      for (const it of attention.slice(0, 25)) {
        lines.push(`  - ${clip(it.sourceName, 52)} — ${it.title}${it.typeName ? ` (${it.typeName})` : ""}: ${it.label}${it.iso ? ` (${it.iso})` : ""}`);
      }
      if (attention.length > 25) lines.push(`  … and ${attention.length - 25} more.`);
      lines.push("");
    }
  } catch {}

  return {
    title: set.name,
    subtitle: `${RECORD_KIND_LABELS[set.kind] || set.kind} · ${total} records${set.archived ? " · archived" : ""}`,
    digest: joinLines(lines),
    suggestions: suggestions || SUGGESTIONS["organizations:detail"],
  };
}

async function assetsDigest(ctx) {
  const types = await loadAssetTypes(ctx);
  const instances = await instanceIndex(ctx);
  const lines = [];
  lines.push(`ASSET TYPE LIBRARY: ${types.length} flexible-asset templates, shared across every client (defined once, used by all).`);
  lines.push("");
  for (const t of types) {
    const inst = instances.get(t.id) || { count: 0, clients: [] };
    lines.push(
      `  - ${clip(t.name, 55)} [${t.category || "uncategorised"}] — ${(t.fields || []).length} fields; ${inst.count} instance${inst.count === 1 ? "" : "s"}` +
        (inst.clients.length ? ` in ${inst.clients.map((c) => clip(c, 28)).join(", ")}` : ""),
    );
  }
  return {
    title: "Assets",
    subtitle: `${types.length} asset types`,
    digest: joinLines(lines),
    suggestions: [
      "Which asset types have no instances yet?",
      "What is the difference between a core asset and a flexible asset?",
      "Which clients use the applications asset type?",
    ],
  };
}

async function assetTypeDigest(ctx, id) {
  const types = await loadAssetTypes(ctx);
  const t = findType(types, id);
  if (!t) {
    return { title: "Asset type", subtitle: "Not found", digest: "This asset type could not be found in the library.", suggestions: SUGGESTIONS.assets };
  }
  const instances = await instanceIndex(ctx);
  const inst = instances.get(id) || { count: 0, clients: [] };
  const lines = [];
  lines.push(`ASSET TYPE: ${t.name}`);
  lines.push(`Category: ${t.category || "uncategorised"}${t.description ? ` · ${clip(t.description, 160)}` : ""}.`);
  lines.push(`Fields (${(t.fields || []).length}):`);
  for (const f of t.fields || []) {
    const flags = [f.type || "text", f.required ? "required" : "optional"];
    if (f.refTypes || f.reference || f.allowedTypes) {
      const rt = f.refTypes || f.reference || f.allowedTypes;
      flags.push("references " + (Array.isArray(rt) ? rt.map((x) => typeLabel(x)).join("/") : rt));
    }
    lines.push(`  - ${f.label || f.key} (${flags.join(", ")})`);
  }
  lines.push("");
  lines.push(`USAGE: ${inst.count} instance${inst.count === 1 ? "" : "s"} across the repository${inst.clients.length ? ` — ${inst.clients.map((c) => clip(c, 28)).join(", ")}` : ""}.`);
  return {
    title: t.name,
    subtitle: `Asset type · ${(t.fields || []).length} fields · ${inst.count} instance${inst.count === 1 ? "" : "s"}`,
    digest: joinLines(lines),
    suggestions: [
      "What fields does this asset type have?",
      "Which clients use this asset type?",
      "What fields am I missing for this kind of asset?",
    ],
  };
}

function libraryDigest() {
  const lines = [];
  lines.push(`LIBRARY: ${LIBRARY_ARTICLES.length} ready-to-use service processes and operational topics, each declaring the asset templates it supports and the document type it reads as.`);
  lines.push("");
  const byTopic = new Map();
  for (const a of LIBRARY_ARTICLES) {
    const k = libraryTopicLabel(a.topic);
    if (!byTopic.has(k)) byTopic.set(k, []);
    byTopic.get(k).push(a);
  }
  for (const [topic, arts] of byTopic) {
    lines.push(`${topic} (${arts.length}):`);
    for (const a of arts) lines.push(`  - ${clip(a.title, 70)} — ${clip(a.summary, 150)}`);
    lines.push("");
  }
  return {
    title: "Library",
    subtitle: `${LIBRARY_ARTICLES.length} articles`,
    digest: joinLines(lines),
    suggestions: ["Which article covers client onboarding?", "What do I need to know about documentation standards?", "Which articles apply to a VoIP deployment?"],
  };
}

function libraryArticleDigest(id) {
  const a = libraryArticle(id);
  if (!a) {
    return { title: "Library article", subtitle: "Not found", digest: "This library article could not be found.", suggestions: SUGGESTIONS.library };
  }
  const lines = [];
  lines.push(`LIBRARY ARTICLE: ${a.title}`);
  lines.push(`Topic: ${libraryTopicLabel(a.topic)} · audience: ${a.audience || "provider"} · reads as: ${(a.docTypes || []).join(", ") || "document"}.`);
  lines.push(`Summary: ${clip(a.summary, 300)}`);
  if (a.tags && a.tags.length) lines.push(`Tags: ${a.tags.join(", ")}.`);
  if (a.assetTypeIds && a.assetTypeIds.length) lines.push(`Supports asset templates: ${a.assetTypeIds.join(", ")}.`);
  if (a.related && a.related.length) lines.push(`Related articles: ${a.related.join(", ")}.`);
  lines.push("");
  lines.push("ARTICLE BODY:");
  const body = Array.isArray(a.body) ? a.body.join("\n") : a.body;
  lines.push(clip(body || "", 4500));
  return {
    title: a.title,
    subtitle: `Library article · ${libraryTopicLabel(a.topic)}`,
    digest: joinLines(lines),
    suggestions: ["Summarise this article in a few bullet points.", "How would I apply this to a specific client?", "What should I check before following these steps?"],
  };
}

async function servicesDigest(ctx) {
  const all = (await summaries(ctx)).filter((s) => !s.archived);
  const lines = [];
  lines.push("SERVICES — how delivered services (email, backup, network, security, virtualization, voice/PBX, resold internet) are modelled today: as the matching structured service asset in each client's set, plus its runbooks and documents.");
  lines.push("");
  for (const s of all) {
    let set;
    try {
      set = await ctx.docs.get(s.id);
    } catch {
      continue;
    }
    const assets = (set && set.records && set.records.flexibleAssets) || [];
    if (!assets.length) continue;
    const types = await loadAssetTypes(ctx);
    lines.push(`${s.name}:`);
    for (const r of assets.slice(0, 30)) {
      const t = findType(types, r.assetTypeId);
      lines.push(`  - ${clip(r.name, 55)} [${t ? t.name : "asset"}]`);
    }
    if (assets.length > 30) lines.push(`  … and ${assets.length - 30} more.`);
    lines.push("");
  }
  if (lines.length <= 2) lines.push("No flexible-asset service records are documented yet.");
  return {
    title: "Services",
    subtitle: "Delivered services across clients",
    digest: joinLines(lines),
    suggestions: ["Which clients have voice/VoIP documented?", "How is a delivered service modelled in IT-U?", "Which clients have resold internet circuits documented?"],
  };
}

async function deploymentsDigest(ctx) {
  const all = await summaries(ctx);
  const lines = overviewLines(all);
  lines.push("");
  lines.push("DEPLOYMENTS — the procedural counterpart of the service assets: runbooks that capture the full build of a service, generated from the client's service asset and its records.");
  return {
    title: "Deployments",
    subtitle: "Client deployment runbooks",
    digest: joinLines(lines),
    suggestions: ["Which clients have deployment runbooks?", "What does a VoIP runbook cover?", "How do I generate a circuit provisioning runbook?"],
  };
}

async function integrationsDigest(ctx) {
  const all = (await summaries(ctx)).filter((s) => !s.archived);
  const lines = [];
  lines.push("INTEGRATIONS — each client can connect a PSA or RMM; syncs are deterministic reconciliations against a remote snapshot, so records are never duplicated.");
  lines.push("");
  for (const s of all) {
    let list = [];
    try {
      list = (await ctx.docs.listIntegrations(s.id)) || [];
    } catch {}
    if (!list.length) continue;
    lines.push(`${s.name}:`);
    for (const d of list) lines.push(`  - ${clip(d.name || d.id, 50)} — ${d.kind || "other"} via ${d.provider || "generic"}`);
  }
  if (lines.length <= 2) lines.push("No integrations are configured yet.");
  return {
    title: "Integrations",
    subtitle: "PSA/RMM connections",
    digest: joinLines(lines),
    suggestions: ["Which clients have a PSA connected?", "How do integration conflicts get resolved?", "What can an RMM sync manage?"],
  };
}

async function linterDigest(ctx) {
  const lines = overviewLines(await summaries(ctx));
  lines.push("");
  lines.push("LINTER — a completeness and quality audit across every client: missing required fields, unlinked records, structured data buried in prose, known services with no coverage, expiries needing attention, and stale records. Findings are grouped by check and severity, each with a one-click fix.");
  return {
    title: "Linter",
    subtitle: "Completeness & quality audit",
    digest: joinLines(lines),
    suggestions: ["What kinds of problems does the linter find?", "Which clients are likely to have the most findings?", "What is the difference between the linter and the integrity checks?"],
  };
}

async function searchDigest(ctx) {
  const lines = overviewLines(await summaries(ctx));
  lines.push("");
  lines.push("SEARCH — full-text search across every record in every client, then a relationship view that draws a record's typed links as a graph. Filters: record type, information model, provenance, client, lifecycle status and expiry window.");
  return {
    title: "Search & relationships",
    subtitle: "Search across all records",
    digest: joinLines(lines),
    suggestions: ["Find records that mention a particular hostname or vendor.", "What record types can I search?", "How do relationships help me find related records?"],
  };
}

async function exportsDigest(ctx) {
  const lines = overviewLines(await summaries(ctx));
  lines.push("");
  lines.push("EXPORTS — publish a client's documentation as a bundle (the whole set) or a deployment bundle (runbooks, checklists and related records for a service or site), and produce printable packets. Redaction is default-deny: credentials are withheld unless explicitly requested, and secrets are never published.");
  return {
    title: "Exports",
    subtitle: "Bundles & printables",
    digest: joinLines(lines),
    suggestions: ["What is the difference between a documentation bundle and a deployment bundle?", "Are credentials included in an export?", "How do I produce a printable packet?"],
  };
}

async function settingsDigest(ctx, card = null) {
  const entry = HELP[card ? "settings:" + card : "settings"];
  const lines = [];
  if (entry) {
    lines.push(`SETTINGS${card ? " SECTION" : ""}: ${entry.title} — ${entry.tagline}`);
    for (const w of entry.what || []) lines.push(`  • ${w}`);
    for (const f of entry.fields || []) lines.push(`  ${f.name}: ${f.desc}`);
    lines.push("");
  }
  const status = await (ctx && ctx.store && ctx.store.getStatus().catch(() => null));
  const overview = await (ctx && ctx.sync && ctx.sync.getOverview().catch(() => null));
  const capacity = await (ctx && ctx.archive && ctx.archive.capacity().catch(() => null));
  const templates = await (ctx && ctx.templates && ctx.templates.listAll().catch(() => []));
  lines.push("LIVE STATUS:");
  if (status) lines.push(`  - Documents: ${status.docCount || 0}; stored: ${status.totalBytes || 0} bytes; namespace: ${status.namespace || "—"}.`);
  if (overview) lines.push(`  - Open conflicts: ${(overview.conflicts || []).length}; pending drafts: ${(overview.drafts || []).length}.`);
  if (capacity && capacity.sets) {
    const list = capacity.sets.map((c) => `${c.name} (${c.recordCount || 0} records)`).slice(0, 30);
    lines.push(`  - ${capacity.sets.length} documentation sets: ${list.join(", ")}.`);
  }
  if (Array.isArray(templates)) lines.push(`  - Templates available: ${templates.length}.`);
  return {
    title: card ? entry ? entry.title : card : "Settings",
    subtitle: card ? "Settings section" : "Storage, sync, backup, access",
    digest: joinLines(lines),
    suggestions: SUGGESTIONS.settings,
  };
}

async function statusDigest(ctx) {
  const lines = [];
  lines.push("STATUS — the live health of every service IT-U runs on (the header's old Online/Cloud pills now live here).");
  lines.push("");

  const snap = ctx && ctx.connectivity && ctx.connectivity.state ? ctx.connectivity.state() : null;
  const pending = (ctx && ctx.status && ctx.status.pending) || 0;
  lines.push("CONNECTION:");
  if (snap) {
    const summary = connectivitySummary(snap, pending);
    lines.push(`  - State: ${summary.label} — ${summary.title}`);
    lines.push(`  - Online: ${snap.online === false ? "no" : "yes"}; syncing: ${snap.syncing ? "yes" : "no"}; pending local changes: ${pending}.`);
    lines.push(`  - Last checked: ${day(snap.lastCheckAt)}; last sync: ${snap.lastSyncAt ? day(snap.lastSyncAt) : "never"}.`);
    if (snap.lastResult) {
      const r = snap.lastResult;
      lines.push(`  - Last reconcile result: ${r.error ? "failed — " + clip(r.error, 120) : `pushed ${r.pushed || 0}, conflicts ${(r.conflicts && r.conflicts.length) || 0}`}.`);
    }
  } else {
    lines.push("  - Connectivity state is unavailable in this session.");
  }

  const cloudEnabled = !!(ctx && ctx.status && ctx.status.cloudEnabled);
  let status = (ctx && ctx.status && ctx.status.storageStatus) || null;
  if (!status && ctx && ctx.store && ctx.store.getStatus) {
    try {
      status = await ctx.store.getStatus();
    } catch {
      status = null;
    }
  }
  lines.push("");
  lines.push("CLOUD STORE:");
  lines.push(`  - Mode: ${cloudEnabled ? "cloud-backed versioned storage with a local cache" : "LOCAL ONLY — records live in memory and will not survive a reload"}.`);
  if (status) lines.push(`  - Documents: ${status.docCount || 0}; stored: ${status.totalBytes || 0} bytes; namespace: ${status.namespace || "—"}.`);

  const hub = ctx && ctx.hub;
  lines.push("");
  lines.push("REALTIME HUB:");
  if (hub) {
    lines.push(`  - Available: ${hub.available ? "yes" : "no"}; connected: ${hub.connected ? "yes" : "no"}; signed in: ${hub.authenticated ? "yes as " + clip(hub.username, 60) : "no"}.`);
    if (hub.authenticated) {
      lines.push(`  - Can write: ${hub.canWrite ? "yes" : "no"}; administrator: ${hub.isAdmin ? "yes" : "no"}.`);
      const roles = (hub.assignments && hub.assignments()) || [];
      if (roles.length) lines.push(`  - Scoped roles: ${roles.map((a) => `${ROLE_LABELS[a.role] || a.role} at ${scopeLabel(a.scope)}`).join("; ")}.`);
      else lines.push("  - Scoped roles: none assigned.");
    }
  } else {
    lines.push("  - No realtime hub is wired into this session (single-device mode).");
  }

  lines.push("");
  lines.push("SYNCHRONIZATION:");
  try {
    const overview = ctx && ctx.sync ? await ctx.sync.getOverview() : null;
    if (overview) {
      lines.push(`  - Pending drafts: ${(overview.drafts || []).length}; open conflicts: ${(overview.conflicts || []).length}.`);
      lines.push(`  - Last reconciled: ${overview.lastReconciledAt ? day(overview.lastReconciledAt) : "never"}.`);
      for (const c of (overview.conflicts || []).slice(0, 15)) lines.push(`  - Conflict in ${clip(c.id, 60)}.`);
    } else {
      lines.push("  - Sync overview is unavailable in this session.");
    }
  } catch {
    lines.push("  - Sync overview is unavailable in this session.");
  }

  return {
    title: "Status",
    subtitle: "Live service health",
    digest: joinLines(lines),
    suggestions: SUGGESTIONS.status,
  };
}

// ---------------------------------------------------------------------------
// the screen-key registry
// ---------------------------------------------------------------------------
const SUGGESTIONS = {
  _: ["What can I do on this screen?", "Explain the key terms on this page.", "What should I do next?"],
  organizations: [
    "Summarise my repository — how many clients and what is documented.",
    "Which clients have the least documentation?",
    "What should I document for a brand-new client?",
  ],
  "organizations:detail": [
    "Summarise this client's documentation.",
    "What is missing or incomplete for this client?",
    "What credentials, domains or expiries need attention?",
    "Draft a handover briefing for a technician picking up this client.",
  ],
  assets: ["Which asset types have no instances yet?", "What is the difference between a core asset and a flexible asset?", "Which clients use the applications asset type?"],
  "assets:detail": ["What fields does this asset type have?", "Which clients use this asset type?", "What fields am I missing for this kind of asset?"],
  documents: ["Which clients have the most documents?", "What kinds of documents should I keep?", "When would I use a document instead of a structured asset?"],
  "documents:detail": ["Summarise this client's documents.", "Which documents are due for review?", "What documents are missing for this client?"],
  trackers: ["Which clients have expiries coming up?", "What does the renewal queue track?", "How do I add a domain or certificate?"],
  "trackers:detail": ["What is expiring soonest for this client?", "Summarise this client's domains and certificates.", "Which expiries are overdue?"],
  services: ["Which clients have voice/VoIP documented?", "How is a delivered service modelled in IT-U?", "Which clients have resold internet circuits documented?"],
  library: ["Which article covers client onboarding?", "What do I need to know about documentation standards?", "Which articles apply to a VoIP deployment?"],
  "library:detail": ["Summarise this article in a few bullet points.", "How would I apply this to a specific client?", "What should I check before following these steps?"],
  deployments: ["Which clients have deployment runbooks?", "What does a VoIP runbook cover?", "How do I generate a circuit provisioning runbook?"],
  "deployments:detail": ["Summarise this client's runbooks.", "What is still missing from these runbooks?", "Walk me through this client's VoIP deployment."],
  integrations: ["Which clients have a PSA connected?", "How do integration conflicts get resolved?", "What can an RMM sync manage?"],
  "integrations:detail": ["Summarise this client's integrations.", "What does this integration sync?", "Are there any open conflicts?"],
  import: ["What can I import and how?", "How do I prepare a spreadsheet for import?", "What happens if a row is rejected?"],
  "import:detail": ["Why might rows be rejected?", "How do I map columns to fields?", "What happens when I commit an import?"],
  search: ["Find records that mention a particular hostname or vendor.", "What record types can I search?", "How do relationships help me find related records?"],
  linter: ["What kinds of problems does the linter find?", "Which checks does the audit run?", "What is the difference between the linter and the integrity checks?"],
  exports: ["What is the difference between a documentation bundle and a deployment bundle?", "Are credentials included in an export?", "How do I produce a printable packet?"],
  settings: ["Explain the storage and sync model.", "How do I back up the repository?", "What do the roles and permission levels mean?"],
  status: [
    "Am I connected, and is everything synced?",
    "Why might I be working offline, and what happens to my edits?",
    "What do the pending changes and conflicts mean, and what should I do?",
  ],
};

const BUILDERS = {
  organizations: (o) => organizationsDigest(o.ctx),
  "organizations:detail": (o) => clientDigest(o.ctx, o.sub),
  assets: (o) => assetsDigest(o.ctx),
  "assets:detail": (o) => assetTypeDigest(o.ctx, o.sub),
  documents: (o) => documentsDigest(o.ctx),
  "documents:detail": (o) => clientDigest(o.ctx, o.sub, { focus: "Documents", sections: ["documents"], suggestions: SUGGESTIONS["documents:detail"] }),
  trackers: (o) => trackersDigest(o.ctx),
  "trackers:detail": (o) => clientDigest(o.ctx, o.sub, { focus: "Trackers (domains, certificates, expiries)", suggestions: SUGGESTIONS["trackers:detail"] }),
  services: (o) => servicesDigest(o.ctx),
  library: () => libraryDigest(),
  "library:detail": (o) => libraryArticleDigest(o.sub),
  deployments: (o) => deploymentsDigest(o.ctx),
  "deployments:detail": (o) => clientDigest(o.ctx, o.sub, { focus: "Deployments / runbooks", suggestions: SUGGESTIONS["deployments:detail"] }),
  integrations: (o) => integrationsDigest(o.ctx),
  "integrations:detail": (o) => clientDigest(o.ctx, o.sub, { focus: "Integrations", suggestions: SUGGESTIONS["integrations:detail"] }),
  import: (o) => importDigest(o.ctx),
  "import:detail": () => ({
    title: "Import — mapping & dry-run",
    subtitle: "The import workspace",
    digest:
      "IMPORT WORKSPACE — one import's mapping, validation and commit. The screen shows a row-by-row dry-run report for the chosen target and file, the column→field mapping, and the per-row outcome with the exact reason a problem row was rejected. Nothing is written until Import is clicked, and the whole import is one transaction in the client's documentation-set service.",
    suggestions: SUGGESTIONS["import:detail"],
  }),
  search: (o) => searchDigest(o.ctx),
  linter: (o) => linterDigest(o.ctx),
  exports: (o) => exportsDigest(o.ctx),
  settings: (o) => settingsDigest(o.ctx, null),
  status: (o) => statusDigest(o.ctx),
};

// The list-screen digests that are just "the repository" plus a pointer.
async function documentsDigest(ctx) {
  const all = (await summaries(ctx)).filter((s) => !s.archived);
  const lines = [];
  lines.push("DOCUMENTS — procedures, guides, SOPs and reference material, grouped by the client they belong to. Each document has its own revision history, a review cadence and links to the records it concerns.");
  lines.push("");
  lines.push("DOCUMENTS PER CLIENT:");
  for (const s of all) lines.push(`  - ${clip(s.name, 60)} — ${(s.counts && s.counts.documents) || 0} documents${countsSummary(s.counts)}`);
  return { title: "Documents", subtitle: "Documents by client", digest: joinLines(lines), suggestions: SUGGESTIONS.documents };
}

async function trackersDigest(ctx) {
  const all = (await summaries(ctx)).filter((s) => !s.archived);
  const lines = [];
  lines.push("TRACKERS — every date that matters for a client, aggregated and queued by urgency: domain and certificate expiries, licence and subscription renewals, warranty, support, end-of-life and document-review dates.");
  lines.push("");
  lines.push("PER CLIENT:");
  for (const s of all) {
    const c = s.counts || {};
    lines.push(`  - ${clip(s.name, 60)} — ${c.domains || 0} domains, ${c.certificates || 0} certificates`);
  }
  return { title: "Trackers", subtitle: "Lifecycle dates by client", digest: joinLines(lines), suggestions: SUGGESTIONS.trackers };
}

async function importDigest(ctx) {
  const all = await summaries(ctx);
  const lines = [];
  lines.push("IMPORT — bulk-import records from a CSV/spreadsheet source into a client's documentation set, with a mapping review and a row-by-row dry run before anything is written.");
  lines.push("");
  lines.push(...overviewLines(all));
  return { title: "Import", subtitle: "Bulk record import", digest: joinLines(lines), suggestions: SUGGESTIONS.import };
}

// Settings cards are registered individually so hasContext()/contextKeys() stay
// in lockstep with the help catalog (each card carries its own context).
for (const card of SETTINGS_CARDS) {
  BUILDERS["settings:" + card] = (o) => settingsDigest(o.ctx, card);
}

const FALLBACK = (key) => ({
  title: (HELP[key] && HELP[key].title) || "IT-U",
  subtitle: key,
  digest: (HELP[key] && `${HELP[key].title} — ${HELP[key].tagline}`) || "No specific context is available for this screen.",
  suggestions: SUGGESTIONS._,
});

export const hasContext = (key) => !!BUILDERS[key];
export const contextKeys = () => Object.keys(BUILDERS);

// Build the digest for a screen key. Never throws: an unbuildable context
// falls back to the screen's help text, so the assistant still has something to
// answer from.
export async function buildScreenContext(key, { ctx, sub } = {}) {
  const builder = BUILDERS[key];
  if (!builder) return FALLBACK(key);
  try {
    const res = await builder({ ctx, sub });
    if (res && res.digest) return { suggestions: SUGGESTIONS._, ...res };
  } catch (e) {
    return {
      title: (HELP[key] && HELP[key].title) || "IT-U",
      subtitle: key,
      digest: `(Could not assemble this screen's context: ${clip((e && e.message) || e, 160)})`,
      suggestions: SUGGESTIONS._,
    };
  }
  return FALLBACK(key);
}
