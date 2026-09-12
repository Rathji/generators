// src/framework/search.js — search & relationship navigation (roadmap task 45).
//
// Task 45 asks for two things that are really one: find any record fast, and
// then move through the links between records — from an application to its
// server, credentials, vendor, licence and supporting documentation — without
// knowing where any of it lives. This module is the pure engine behind both.
//
//   • buildSearchIndex(set, opts) walks one client's documentation set once and
//     flattens every record into a searchable entry: its identity, its
//     information-model / provenance classification, its worst lifecycle state
//     and soonest expiry, and the full text of every value it holds (including
//     a flexible asset's nested fields). Searching then never touches storage.
//   • searchRecords(index, query, filters) matches an AND of whitespace-split
//     terms against each entry's haystack, ranking a name hit above a body hit,
//     and narrows by classification, client, record collection, lifecycle state
//     and expiry window. searchFacets(index) returns the counts the filter
//     dropdowns need.
//   • recordNeighbors(set, ref) reports every link touching a record, grouped
//     by relationship kind and direction. relationshipGraph(set, ref, {depth})
//     returns the reachable sub-graph, and shortestPath(set, from, to) the
//     route between two records — the traversal half of the task.
//   • summarizeRecord(record, set, opts) is the one-line detail the result rows
//     and neighbour chips show.
//
// All of it is pure: no storage, no network. The Search station builds indexes
// from the sets it has already loaded and re-renders from the returned objects.

import { RECORD_TYPES, RECORD_TYPE_META } from "./docsets.js";
import { classificationOf, informationModel } from "./classification.js";
import { relationsOf, relationshipKind, findRecord, refKey } from "./relationships.js";
import { extractLifecycleItems, worstState, lifecycleStateDef } from "./lifecycle.js";
import { recordDetailLine } from "./standardized.js";

export { refKey };

// Keys whose values are secrets and must never be indexed as searchable text.
const SECRET_KEYS = new Set(["secret", "otpSecret"]);

// The lifecycle states that count as "needs attention" for the filter.
export const ATTENTION_STATES = ["overdue", "due-soon", "upcoming"];

// ---- indexing ---------------------------------------------------------------

// Every searchable leaf of a record, flattened to one lowercase string. Nested
// objects (a flexible asset's `assetFields`, an `origin` block) and arrays are
// walked; secret fields are skipped so a credential's value is never indexed.
export function recordSearchText(record) {
  const parts = [];
  const seen = new Set();
  const walk = (value, key) => {
    if (value == null) return;
    if (key != null && SECRET_KEYS.has(key)) return;
    if (typeof value === "string") {
      const s = value.trim();
      if (s) parts.push(s);
      return;
    }
    if (typeof value === "number" || typeof value === "boolean") {
      parts.push(String(value));
      return;
    }
    if (typeof value === "object") {
      if (Array.isArray(value)) {
        for (const v of value) walk(v, key);
        return;
      }
      if (seen.has(value)) return;
      seen.add(value);
      for (const [k, v] of Object.entries(value)) walk(v, k);
    }
  };
  walk(record, null);
  return parts.join(" · ");
}

// The collections a search index covers (everything except typed links, whose
// content is a from/to/kind triple rather than a documented entity).
export const SEARCHABLE_COLLECTIONS = RECORD_TYPES.filter((t) => t !== "relationships");

// Build the flat search index for one documentation set. `opts.client` names the
// client the set belongs to; `opts.typeOf(record)` resolves a flexible asset's
// template (required to read its expiry field); `opts.now` fixes the clock for
// a stable lifecycle snapshot (used by tests).
export function buildSearchIndex(set, opts = {}) {
  const now = opts.now != null ? opts.now : Date.now();
  const typeOf = typeof opts.typeOf === "function" ? opts.typeOf : null;
  const client = opts.client || (set ? { id: set.id, name: set.name } : null);
  const entries = [];
  if (!set || !set.records) return { set, client, entries };

  // One lifecycle pass over the set, then indexed by source record, so the
  // per-record lookup below is O(1) instead of re-walking every kind.
  const lifecycleByRecord = new Map();
  try {
    for (const item of extractLifecycleItems(set, { now, typeOf, includeUndated: false })) {
      const key = refKey(item.source);
      if (!key) continue;
      if (!lifecycleByRecord.has(key)) lifecycleByRecord.set(key, []);
      lifecycleByRecord.get(key).push(item);
    }
  } catch {
    // A malformed set must still be searchable — lifecycle is an enrichment.
  }

  for (const collection of SEARCHABLE_COLLECTIONS) {
    for (const record of set.records[collection] || []) {
      const key = refKey(record);
      const items = lifecycleByRecord.get(key) || [];
      const dated = items.filter((i) => i.daysUntil != null);
      const soonest = dated.length
        ? dated.reduce((a, b) => (a.daysUntil <= b.daysUntil ? a : b))
        : null;
      const cls = classificationOf(record);
      const text = recordSearchText(record);
      entries.push({
        key,
        collection,
        ref: { type: record.type, id: record.id },
        type: record.type,
        name: record.name || "",
        client,
        informationModel: cls.informationModel,
        provenance: cls.provenance,
        model: cls.model,
        provenanceDef: cls.provenanceDef,
        modelLabel: cls.modelLabel,
        provenanceLabel: cls.provenanceLabel,
        lifecycle: items.length ? worstState(items) : "none",
        expiryDays: soonest ? soonest.daysUntil : null,
        expiryDate: soonest ? soonest.iso : null,
        itemCount: items.length,
        text,
        haystack: (record.name || "") + " \u0000 " + text,
        record,
      });
    }
  }
  return { set, client, entries };
}

// ---- searching --------------------------------------------------------------

const TERM_SPLIT = /\s+/;
const norm = (s) => String(s == null ? "" : s).toLowerCase();

// Score one entry against one term: a name hit always outranks a body-only hit.
function scoreEntry(entry, terms) {
  let score = 0;
  const name = norm(entry.name);
  const hay = norm(entry.haystack);
  for (const term of terms) {
    if (!hay.includes(term)) return -1; // AND across terms
    if (name === term) score += 120;
    else if (name.startsWith(term)) score += 70;
    else if (name.includes(term)) score += 45;
    else score += 12;
  }
  return score;
}

function matchFilter(entry, filters) {
  if (!filters) return true;
  const {
    collection,
    informationModel: model,
    provenance,
    client,
    lifecycle,
    lifecycleStates,
    expiryDays,
    expiryWindow,
  } = filters;
  if (collection) {
    const want = Array.isArray(collection) ? collection : [collection];
    if (want.length && !want.includes(entry.collection)) return false;
  }
  if (model) {
    const want = Array.isArray(model) ? model : [model];
    if (want.length && !want.includes(entry.informationModel)) return false;
  }
  if (provenance) {
    const want = Array.isArray(provenance) ? provenance : [provenance];
    if (want.length && !want.includes(entry.provenance)) return false;
  }
  if (client && entry.client && entry.client.id !== client) return false;
  if (lifecycle === "attention") {
    if (!ATTENTION_STATES.includes(entry.lifecycle)) return false;
  } else if (lifecycle) {
    const want = Array.isArray(lifecycle) ? lifecycle : [lifecycle];
    if (want.length && !want.includes(entry.lifecycle)) return false;
  }
  if (Array.isArray(lifecycleStates) && lifecycleStates.length) {
    if (!lifecycleStates.includes(entry.lifecycle)) return false;
  }
  const window = expiryDays != null ? expiryDays : expiryWindow;
  if (window != null && window !== "") {
    // A negative window means "already expired"; a positive one "expiring
    // within N days". Undated records never match a window filter.
    if (entry.expiryDays == null) return false;
    if (entry.expiryDays > Number(window)) return false;
  }
  return true;
}

// Search the index: `query` is an AND of whitespace-split terms; `filters` is
// the object described by matchFilter. Returns the matching entries (best first)
// plus the facet counts of the FULL index so the filter dropdowns stay stable.
export function searchRecords(index, query, filters = {}) {
  const entries = (index && index.entries) || [];
  const terms = String(query == null ? "" : query)
    .trim()
    .toLowerCase()
    .split(TERM_SPLIT)
    .filter(Boolean);
  const scored = [];
  for (const entry of entries) {
    if (!matchFilter(entry, filters)) continue;
    const score = terms.length ? scoreEntry(entry, terms) : 0;
    if (score < 0) continue;
    scored.push({ entry, score });
  }
  scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    return String(a.entry.name).localeCompare(String(b.entry.name));
  });
  const results = scored.map((s) => s.entry);
  return {
    query: String(query == null ? "" : query),
    terms,
    total: results.length,
    results,
    entries: results,
    facets: searchFacets(entries),
    filteredFacets: searchFacets(results),
  };
}

// Facet counts over a list of index entries: by record collection, model,
// provenance, client and lifecycle state. Each is an array of
// `{ value, label, count }`, biggest first.
export function searchFacets(entries = []) {
  const byCollection = new Map();
  const byModel = new Map();
  const byProvenance = new Map();
  const byClient = new Map();
  const byLifecycle = new Map();
  const bump = (map, key, label) => {
    if (!key) return;
    const cur = map.get(key) || { value: key, label: label == null ? key : label, count: 0 };
    cur.count += 1;
    map.set(key, cur);
  };
  for (const e of entries) {
    bump(byCollection, e.collection, (RECORD_TYPE_META[e.collection] || {}).label || e.collection);
    bump(byModel, e.informationModel, e.modelLabel);
    bump(byProvenance, e.provenance, e.provenanceLabel);
    bump(byLifecycle, e.lifecycle, (lifecycleStateDef(e.lifecycle) || {}).label || e.lifecycle);
    if (e.client && e.client.id) bump(byClient, e.client.id, e.client.name || e.client.id);
  }
  const toSorted = (map) => [...map.values()].sort((a, b) => b.count - a.count || String(a.label).localeCompare(String(b.label)));
  return {
    collection: toSorted(byCollection),
    informationModel: toSorted(byModel),
    provenance: toSorted(byProvenance),
    client: toSorted(byClient),
    lifecycle: toSorted(byLifecycle),
  };
}

// A union index across several clients' sets — the Search station's default.
// Each set carries its OWN client identity (id/name), so a combined search can
// filter by client even though every set is indexed in one pass. `opts` may
// still provide `now`/`typeOf`.
export function buildCombinedIndex(docSets = [], opts = {}) {
  const entries = [];
  const bySet = new Map();
  for (const set of docSets) {
    if (!set) continue;
    const one = buildSearchIndex(set, { ...opts, client: { id: set.id, name: set.name } });
    bySet.set(set.id, one);
    for (const e of one.entries) entries.push(e);
  }
  return { entries, bySet, sets: docSets };
}

// ---- relationship navigation ------------------------------------------------

// Every link touching `ref`, grouped by kind and direction. Each group carries
// the far-side record resolved to a name/type, so a UI can render chips and the
// traversal graph can be walked without re-reading storage.
export function recordNeighbors(set, ref) {
  const key = refKey(ref);
  if (!key) return [];
  const groups = new Map();
  for (const rel of relationsOf(set, ref)) {
    const kindId = rel.relationship.kind;
    const kindDef = relationshipKind(kindId);
    const otherRef = rel.other;
    const other = findRecord(set, otherRef);
    const gkey = kindId + "|" + rel.direction;
    if (!groups.has(gkey)) {
      groups.set(gkey, {
        key: gkey,
        kind: kindId,
        label: kindDef ? kindDef.label : kindId,
        group: (kindDef && kindDef.group) || null,
        direction: rel.direction,
        items: [],
      });
    }
    groups.get(gkey).items.push({
      relationshipId: rel.relationship.id,
      kind: kindId,
      direction: rel.direction,
      ref: otherRef,
      name: other ? other.name : "(missing record)",
      type: otherRef.type,
      missing: !other,
      note: rel.relationship.note || "",
      record: other,
    });
  }
  const list = [...groups.values()];
  for (const g of list) g.items.sort((a, b) => String(a.name).localeCompare(String(b.name)));
  list.sort((a, b) => (a.direction === b.direction ? String(a.label).localeCompare(String(b.label)) : a.direction === "out" ? -1 : 1));
  return list;
}

// Breadth-first expansion of the relationship graph around `ref` up to `depth`
// hops. Returns `{ root, nodes, edges }`; nodes are deduped by `refKey` and
// edges by `kind|from|to` so a link seen from both ends appears once.
export function relationshipGraph(set, ref, opts = {}) {
  const rootKey = refKey(ref);
  const depth = opts.depth == null ? 1 : Math.max(0, Math.floor(Number(opts.depth) || 0));
  const nodes = new Map();
  const edges = new Map();
  if (!rootKey) return { root: null, nodes: [], edges: [] };
  const rootRecord = findRecord(set, ref);
  nodes.set(rootKey, {
    key: rootKey,
    ref: { type: ref.type, id: ref.id },
    name: rootRecord ? rootRecord.name : "(missing record)",
    type: ref.type,
    record: rootRecord,
    depth: 0,
    isRoot: true,
  });
  let frontier = [{ ref: { type: ref.type, id: ref.id }, key: rootKey }];
  for (let d = 1; d <= depth; d += 1) {
    const next = [];
    for (const cur of frontier) {
      for (const rel of relationsOf(set, cur.ref)) {
        const otherRef = rel.other;
        const okey = refKey(otherRef);
        if (!okey) continue;
        const kindDef = relationshipKind(rel.relationship.kind);
        const ekey = rel.relationship.kind + "|" + refKey(rel.relationship.from) + "|" + refKey(rel.relationship.to);
        if (!edges.has(ekey)) {
          edges.set(ekey, {
            id: rel.relationship.id,
            kind: rel.relationship.kind,
            label: kindDef ? kindDef.label : rel.relationship.kind,
            from: rel.relationship.from,
            to: rel.relationship.to,
          });
        }
        if (nodes.has(okey)) continue;
        const other = findRecord(set, otherRef);
        nodes.set(okey, {
          key: okey,
          ref: otherRef,
          name: other ? other.name : "(missing record)",
          type: otherRef.type,
          record: other,
          depth: d,
          isRoot: false,
        });
        if (d < depth) next.push({ ref: otherRef, key: okey });
      }
    }
    frontier = next;
  }
  const nodeList = [...nodes.values()].sort((a, b) => a.depth - b.depth || String(a.name).localeCompare(String(b.name)));
  return { root: nodes.get(rootKey), nodes: nodeList, edges: [...edges.values()] };
}

// The shortest chain of links connecting two records, returned as an array of
// refs from `fromRef` to `toRef` (inclusive), or null when they are not
// connected. BFS over the undirected relationship graph.
export function shortestPath(set, fromRef, toRef) {
  const startKey = refKey(fromRef);
  const goalKey = refKey(toRef);
  if (!startKey || !goalKey) return null;
  if (startKey === goalKey) return [{ type: fromRef.type, id: fromRef.id }];
  const start = { type: fromRef.type, id: fromRef.id };
  const goal = { type: toRef.type, id: toRef.id };
  const prev = new Map([[startKey, null]]);
  const queue = [start];
  while (queue.length) {
    const cur = queue.shift();
    const curKey = refKey(cur);
    for (const rel of relationsOf(set, cur)) {
      const otherRef = rel.other;
      const okey = refKey(otherRef);
      if (!okey || prev.has(okey)) continue;
      prev.set(okey, cur);
      if (okey === goalKey) {
        const path = [];
        let node = otherRef;
        let nodeKey = okey;
        while (node) {
          path.unshift({ type: node.type, id: node.id });
          node = prev.get(nodeKey);
          nodeKey = node ? refKey(node) : null;
        }
        return path;
      }
      queue.push(otherRef);
    }
  }
  return null;
}

// The one-line detail shown for a record in a result row or neighbour chip.
export function summarizeRecord(record, set, opts = {}) {
  return recordDetailLine(record, set, opts);
}

// The human name of a record type (the station's filter labels read from here).
export function typeLabel(type) {
  const meta = RECORD_TYPE_META[type];
  return meta ? meta.label : type;
}

// The label of an information model (used for filter options).
export function modelLabel(id) {
  const m = informationModel(id);
  return m ? m.label : id;
}
