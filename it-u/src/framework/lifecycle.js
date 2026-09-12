// src/framework/lifecycle.js — the unified lifecycle / expiry aggregation layer
// (roadmap task 26, "Expiry aggregation").
//
// Task 16's renewals engine watches ONE kind of thing — a flexible asset's
// renewal date. Task 26 asks for every dated item in a client's documentation
// set in one place: domain registration expiry, certificate expiry, licence and
// subscription expiry, warranty and support dates, and hardware end-of-life,
// aggregated into a single lifecycle view PER CLIENT and grouped PER ASSET.
//
// This module is the aggregation half and is entirely PURE (no storage, no
// network). `LIFECYCLE_KINDS` is the catalog: one entry per kind of dated item,
// naming the record collection and field it comes from plus its default lead
// time and due-soon window. `collectLifecycle(set, opts)` walks a documentation
// set, extracts every dated item, classifies it (overdue / due-soon / upcoming /
// ok / none) against its effective lead time, and returns the items plus the
// roll-ups — by kind, by group, and by source asset — that the Trackers station
// renders and the workflow engine (framework/workflow.js, task 27) acts on.
//
// The two "dynamic" kinds cannot be read off a fixed field: a flexible asset's
// expiry field depends on its template (so a `typeOf` resolver is injected), and
// a document's next review date is *computed* from its cadence. Both are folded
// into the same item shape so nothing downstream needs to special-case them.

import { parseDate, isoDate, expiryFieldOf, DEFAULT_ALERT_DAYS, DUE_SOON_DAYS } from "./renewals.js";
import { assetFieldsOf } from "./flexible.js";
import { documentReviewStatus } from "./document.js";
import { configurationTypeLabel } from "./configuration.js";
import { VOICE_PBX_TYPE_ID } from "./voice.js";

// ---- state vocabulary -------------------------------------------------------
// The five lifecycle states, shared (deliberately) with the renewals engine so
// the whole app speaks one expiry language. Tone drives the badge colour.
export const LIFECYCLE_STATES = [
  { id: "overdue", label: "Overdue", tone: "danger", rank: 0 },
  { id: "due-soon", label: "Due soon", tone: "warn", rank: 1 },
  { id: "upcoming", label: "Upcoming", tone: "info", rank: 2 },
  { id: "ok", label: "OK", tone: "ok", rank: 3 },
  { id: "none", label: "No date", tone: "muted", rank: 4 },
];

export const lifecycleStateDef = (id) => LIFECYCLE_STATES.find((s) => s.id === id) || null;

// The states that need a human to do something, worst first.
export const ATTENTION_STATES = ["overdue", "due-soon", "upcoming"];
export const isAttention = (state) => ATTENTION_STATES.includes(state);

// ---- the kind catalog -------------------------------------------------------
// `group` is the section a kind is shown under; `defaultLeadDays` is how early
// an item starts warning; `dueSoonDays` is the inner window that escalates it
// from `upcoming` to `due-soon`. `perRecordLead` marks kinds whose record may
// carry its own `renewalAlertDays` override. `dynamic` marks the two kinds whose
// date is derived rather than read from `field`.
export const LIFECYCLE_KINDS = [
  {
    id: "domain-expiry",
    label: "Domain renewal",
    subject: "Domain",
    icon: "globe",
    group: "Domains & certificates",
    collection: "domains",
    field: "expiresAt",
    defaultLeadDays: 60,
    dueSoonDays: 14,
    perRecordLead: true,
    flagUndated: true,
  },
  {
    id: "certificate-expiry",
    label: "Certificate renewal",
    subject: "SSL certificate",
    icon: "lock",
    group: "Domains & certificates",
    collection: "certificates",
    field: "validTo",
    defaultLeadDays: 30,
    dueSoonDays: 14,
    perRecordLead: true,
    flagUndated: true,
  },
  {
    id: "warranty-expiry",
    label: "Warranty expiry",
    subject: "Warranty",
    icon: "shield",
    group: "Hardware",
    collection: "configurations",
    field: "warrantyExpiryDate",
    defaultLeadDays: 60,
    dueSoonDays: 14,
  },
  {
    id: "support-expiry",
    label: "Support expiry",
    subject: "Support coverage",
    icon: "shield",
    group: "Hardware",
    collection: "configurations",
    field: "supportExpiryDate",
    defaultLeadDays: 60,
    dueSoonDays: 14,
  },
  {
    id: "hardware-eol",
    label: "End of life",
    subject: "End of life",
    icon: "server",
    group: "Hardware",
    collection: "configurations",
    field: "endOfLifeDate",
    defaultLeadDays: 180,
    dueSoonDays: 30,
  },
  {
    id: "asset-expiry",
    label: "Licence / subscription renewal",
    subject: "Licence or subscription",
    icon: "layers",
    group: "Licences & subscriptions",
    collection: "flexibleAssets",
    dynamic: "flexible",
    defaultLeadDays: 60,
    dueSoonDays: 14,
    perRecordLead: true,
  },
  {
    id: "number-port",
    label: "Number port date",
    subject: "Number port",
    icon: "phone",
    group: "Voice & numbering",
    collection: "flexibleAssets",
    dynamic: "voice-port",
    defaultLeadDays: 30,
    dueSoonDays: 7,
  },
  {
    id: "document-review",
    label: "Document review",
    subject: "Document review",
    icon: "article",
    group: "Documents",
    collection: "documents",
    dynamic: "document",
    defaultLeadDays: 30,
    dueSoonDays: 30,
  },
];

export const lifecycleKind = (id) => LIFECYCLE_KINDS.find((k) => k.id === id) || null;

// The groups, in catalog order.
export const LIFECYCLE_GROUPS = [...new Set(LIFECYCLE_KINDS.map((k) => k.group))];
export const kindsOfGroup = (group) => LIFECYCLE_KINDS.filter((k) => k.group === group);

// ---- lead times & classification -------------------------------------------
const num = (v) => (Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : null);

// The configured lead time for a kind (falls back to the kind's default).
export function kindLeadDays(kindDef, config) {
  const override = config && config.leadDays ? num(config.leadDays[kindDef.id]) : null;
  return override != null ? override : kindDef.defaultLeadDays;
}

// The configured due-soon window for a kind (falls back to the kind's default).
export function kindDueSoonDays(kindDef, config) {
  const override = config && config.dueSoonDays ? num(config.dueSoonDays[kindDef.id]) : null;
  return override != null ? override : kindDef.dueSoonDays;
}

// The effective lead time for one record: its own `renewalAlertDays` (for the
// kinds that allow it) wins over the configured kind lead, which wins over the
// kind default. Mirrors how the trackers already resolve their alert window.
export function recordLeadDays(record, kindDef, config) {
  if (kindDef.perRecordLead) {
    const own = num(record && record.renewalAlertDays);
    if (own != null) return own;
  }
  return kindLeadDays(kindDef, config);
}

// Classify a day-count against a lead time and a due-soon window.
export function classifyLifecycle(daysUntil, { leadDays = DEFAULT_ALERT_DAYS, dueSoonDays = DUE_SOON_DAYS } = {}) {
  if (daysUntil == null) return "none";
  if (daysUntil < 0) return "overdue";
  if (daysUntil <= Math.min(leadDays, dueSoonDays)) return "due-soon";
  if (daysUntil <= leadDays) return "upcoming";
  return "ok";
}

const midnight = (now) => {
  const d = new Date(now);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
};

// Whole days from today (local midnight) to `date`.
export function daysUntil(date, now = Date.now()) {
  if (!date) return null;
  return Math.round((date.getTime() - midnight(now)) / 86400000);
}

// ---- the item factory -------------------------------------------------------
export function lifecycleItemId(kindId, source, field) {
  return kindId + ":" + source.type + ":" + source.id + ":" + (field || "");
}

function refOf(record) {
  return { type: record.type, id: record.id, name: record.name };
}

function sourceDetail(record) {
  if (record.type === "configurations") return configurationTypeLabel(record.configType) || "Configuration";
  if (record.type === "flexibleAssets") return "Flexible asset";
  if (record.type === "domains") return record.registrar || "Domain";
  if (record.type === "certificates") return record.issuer || "Certificate";
  if (record.type === "documents") return "Document";
  return null;
}

export function makeLifecycleItem({ kindDef, record, field, fieldLabel, date, now, config, typeName = null }) {
  const leadDays = recordLeadDays(record, kindDef, config);
  const dueSoonDays = kindDueSoonDays(kindDef, config);
  const du = daysUntil(date, now);
  const state = classifyLifecycle(du, { leadDays, dueSoonDays });
  const source = refOf(record);
  const label =
    state === "none"
      ? "No date"
      : state === "overdue"
        ? `Expired ${Math.abs(du)} day${Math.abs(du) === 1 ? "" : "s"} ago`
        : `Expires in ${du} day${du === 1 ? "" : "s"}`;
  return {
    id: lifecycleItemId(kindDef.id, source, field),
    kind: kindDef.id,
    kindDef,
    group: kindDef.group,
    title: kindDef.label,
    subject: kindDef.subject,
    icon: kindDef.icon,
    source,
    sourceType: record.type,
    sourceName: record.name,
    sourceDetail: sourceDetail(record),
    typeName,
    field,
    fieldLabel: fieldLabel || kindDef.label,
    date,
    iso: date ? isoDate(date) : null,
    daysUntil: du,
    leadDays,
    dueSoonDays,
    state,
    label,
    undated: !date,
    record,
  };
}

// The date (and field label) for one record against one kind. Returns null when
// the kind does not apply to the record at all (an untracked template, a
// document with no review cadence); an object with a null `date` means the kind
// applies but no date is recorded.
function dateForKind(kindDef, record, { now, typeOf }) {
  if (kindDef.dynamic === "voice-port") {
    if (record.assetTypeId !== VOICE_PBX_TYPE_ID) return null;
    const fields = assetFieldsOf(record);
    if (!fields.portDate) return null;
    return { field: "portDate", fieldLabel: "Number port date", date: parseDate(fields.portDate) };
  }
  if (kindDef.dynamic === "flexible") {
    const type = typeOf ? typeOf(record) : null;
    const field = expiryFieldOf(type);
    if (!field) return null;
    return { field: field.key, fieldLabel: field.label, date: parseDate(assetFieldsOf(record)[field.key]), typeName: (type && type.name) || null };
  }
  if (kindDef.dynamic === "document") {
    const st = documentReviewStatus(record, { now });
    if (st.state === "none") return null;
    const date = st.dueAt ? parseDate(st.dueAt) : null;
    return { field: "review", fieldLabel: "Next review", date };
  }
  return { field: kindDef.field, fieldLabel: kindDef.label, date: parseDate(record[kindDef.field]) };
}

// ---- extraction & roll-up ---------------------------------------------------
// Every lifecycle item a documentation set holds. `opts.typeOf(record)` resolves
// a flexible asset's template (required for the asset-expiry kind to be read);
// `opts.includeUndated` (default true) keeps "no date recorded" items — but only
// for the kinds that flag them (domains and certificates, where a missing date is
// itself a finding). Optional dates (warranty, support, end-of-life, licence
// expiry, review cadence) simply contribute nothing until they are recorded.
export function extractLifecycleItems(set, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const config = opts.config || null;
  const typeOf = typeof opts.typeOf === "function" ? opts.typeOf : null;
  const includeUndated = opts.includeUndated !== false;
  const items = [];
  if (!set || !set.records) return items;
  for (const kindDef of LIFECYCLE_KINDS) {
    const records = set.records[kindDef.collection] || [];
    for (const record of records) {
      const info = dateForKind(kindDef, record, { now, typeOf });
      if (!info) continue;
      if (!info.date && !(includeUndated && kindDef.flagUndated)) continue;
      items.push(makeLifecycleItem({ kindDef, record, field: info.field, fieldLabel: info.fieldLabel, date: info.date, now, config, typeName: info.typeName || null }));
    }
  }
  return items;
}

// Soonest first, undated last.
export function sortLifecycle(items) {
  return [...items].sort((a, b) => {
    const ad = a.daysUntil == null ? Infinity : a.daysUntil;
    const bd = b.daysUntil == null ? Infinity : b.daysUntil;
    if (ad !== bd) return ad - bd;
    return String(a.sourceName).localeCompare(String(b.sourceName)) || String(a.kind).localeCompare(String(b.kind));
  });
}

export function lifecycleCounts(items = []) {
  const counts = { overdue: 0, "due-soon": 0, upcoming: 0, ok: 0, none: 0, total: items.length, tracked: 0 };
  for (const it of items) {
    counts[it.state] = (counts[it.state] || 0) + 1;
    if (it.state !== "none") counts.tracked += 1;
  }
  return counts;
}

// The worst state among a set of items (drives an asset roll-up's tone).
export function worstState(items = []) {
  let best = "none";
  let bestRank = 99;
  for (const it of items) {
    const def = lifecycleStateDef(it.state);
    if (def && def.rank < bestRank) {
      bestRank = def.rank;
      best = it.state;
    }
  }
  return best;
}

const assetKey = (ref) => ref.type + ":" + ref.id;

// Group items by their source asset — the "per asset" half of the aggregate.
// Each asset carries its items (soonest first), its soonest item and its worst
// state; assets are ordered by their soonest item.
export function groupByAsset(items = []) {
  const map = new Map();
  for (const it of items) {
    const key = assetKey(it.source);
    if (!map.has(key)) map.set(key, { key, ref: it.source, name: it.sourceName, type: it.sourceType, detail: it.sourceDetail, items: [] });
    map.get(key).items.push(it);
  }
  const assets = [...map.values()].map((a) => {
    a.items = sortLifecycle(a.items);
    a.next = a.items.find((i) => i.daysUntil != null) || null;
    a.state = worstState(a.items);
    a.dated = a.items.filter((i) => i.daysUntil != null).length;
    return a;
  });
  assets.sort((a, b) => {
    const ad = a.next ? a.next.daysUntil : Infinity;
    const bd = b.next ? b.next.daysUntil : Infinity;
    if (ad !== bd) return ad - bd;
    return String(a.name).localeCompare(String(b.name));
  });
  return assets;
}

// The full aggregate for one client. `items` is everything; `attention` is the
// dated items that need a human, soonest first; `byKind` and `groups` roll up by
// catalog; `assets` is the per-asset view.
export function collectLifecycle(set, opts = {}) {
  const items = extractLifecycleItems(set, opts);
  return rollUpLifecycle(items);
}

export function rollUpLifecycle(items = []) {
  const sorted = sortLifecycle(items);
  const byKind = {};
  for (const kindDef of LIFECYCLE_KINDS) {
    const list = sorted.filter((i) => i.kind === kindDef.id);
    byKind[kindDef.id] = { kind: kindDef.id, kindDef, items: list, counts: lifecycleCounts(list) };
  }
  const groups = LIFECYCLE_GROUPS.map((group) => {
    const list = sorted.filter((i) => i.group === group);
    return { group, label: group, items: list, counts: lifecycleCounts(list) };
  }).filter((g) => g.items.length);
  const attention = sorted.filter((i) => isAttention(i.state));
  const dated = sorted.filter((i) => i.daysUntil != null);
  return {
    items: sorted,
    dated,
    undated: sorted.filter((i) => i.daysUntil == null),
    attention,
    counts: lifecycleCounts(sorted),
    byKind,
    groups,
    assets: groupByAsset(sorted),
  };
}

// A short human phrase for an item ("in 12 days", "3 days ago").
export function lifecyclePhrase(item) {
  if (!item || item.daysUntil == null) return "no date";
  const n = item.daysUntil;
  if (n === 0) return "today";
  if (n < 0) return Math.abs(n) + " day" + (n === -1 ? "" : "s") + " ago";
  return "in " + n + " day" + (n === 1 ? "" : "s");
}

// A one-line description of an item's source, for a table cell.
export function lifecycleSourceLine(item) {
  if (!item) return "";
  const bits = [item.sourceName];
  if (item.typeName) bits.push(item.typeName);
  else if (item.sourceDetail && item.sourceDetail !== item.sourceName) bits.push(item.sourceDetail);
  return bits.filter(Boolean).join(" · ");
}
