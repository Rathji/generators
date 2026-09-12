// src/framework/field.js — field access engine (roadmap task 51).
//
// Task 51 turns the documentation into something a technician can actually use
// standing in a comms room: quick search that finds any record in a couple of
// keystrokes, checklists that tick cleanly on a phone, and edits that survive a
// dropped connection and reconcile themselves once it comes back.
//
// This module is the pure engine behind that. It holds no storage and touches
// no DOM, so every rule below is unit-testable:
//
//   • Connectivity — createConnectivity watches the browser's online/offline
//     events (and an optional async `probe`) and tracks the sync lifecycle
//     (idle / syncing / last result), exposing a subscribable state the header
//     pill reads. `connectivitySummary()` turns that into a label + tone.
//   • Offline writes — the document store already stages a failed write as a
//     local draft and throws an error flagged `staged`; `isStagedWrite()` /
//     `stagedWriteNotice()` let callers treat that as "saved here, will sync"
//     rather than a failure, and `pendingDraftsSummary()` reads the draft log.
//   • Field checklists — `setChecklistStepDone()` / `toggleChecklistStep()`
//     produce a NEW items array with the who/when stamp, which is what the
//     field checklist saves on every tap.
//   • Quick search — `parseQuickQuery()` pulls `type:` / `client:` / `model:` /
//     `prov:` / `life:` / `due:` tokens out of the typed query, so a field
//     search can be "vlan type:configurations client:acme", and `quickSearch()`
//     runs it against a combined index and returns just the top hits.

import { searchRecords } from "./search.js";
import { RECORD_TYPE_META } from "./docsets.js";
import { INFORMATION_MODELS, PROVENANCE } from "./classification.js";
import { LIFECYCLE_STATES } from "./lifecycle.js";

const str = (v) => String(v == null ? "" : v).trim();

// ---- offline writes ---------------------------------------------------------

// A write the store couldn't push (offline, unsaved preview, lost edit key) is
// staged as a local draft and thrown with `staged` set. Callers should treat
// that as a soft success, not an error.
export function isStagedWrite(err) {
  if (!err) return false;
  if (err.staged) return true;
  const code = err.code || (err.name === "StoreError" ? err.code : null);
  return code === "STORAGE_UNAVAILABLE" || code === "EDIT_KEY_REQUIRED";
}

// The user-facing line for a staged write. The store already prefixes its own
// message with "Saved locally for later sync — …"; keep that if present.
export function stagedWriteNotice(err) {
  const msg = str(err && err.message);
  if (/saved locally/i.test(msg)) return msg;
  return "Saved on this device — it will sync automatically when the connection returns.";
}

// Summarize the sync engine's draft log (an array of `{ id, draft }`).
export function pendingDraftsSummary(drafts = []) {
  const list = Array.isArray(drafts) ? drafts.filter(Boolean) : [];
  return {
    count: list.length,
    ids: list.map((d) => d.id),
    label: list.length === 0 ? "No pending changes" : list.length === 1 ? "1 change waiting to sync" : list.length + " changes waiting to sync",
  };
}

// ---- connectivity -----------------------------------------------------------

// Watch online/offline and the reconcile lifecycle. `probe` (optional) is an
// async function that resolves when the network is genuinely usable and rejects
// when it isn't — used to catch the "connected but the cloud is unreachable"
// case the browser's own flag misses.
export function createConnectivity({ win, nav, now = () => Date.now(), probe = null } = {}) {
  const w = win !== undefined ? win : typeof window !== "undefined" ? window : null;
  const n = nav !== undefined ? nav : typeof navigator !== "undefined" ? navigator : null;
  const listeners = new Set();
  const state = {
    online: n ? n.onLine !== false : true,
    since: now(),
    lastCheckAt: now(),
    syncing: false,
    lastSyncAt: null,
    lastResult: null,
  };

  const snapshot = () => ({ ...state });

  function emit() {
    const snap = snapshot();
    for (const fn of [...listeners]) {
      try {
        fn(snap);
      } catch {}
    }
  }

  function setOnline(next, { reason = "manual" } = {}) {
    const value = !!next;
    const previous = state.online;
    state.lastCheckAt = now();
    if (value === previous) return snapSafe();
    state.online = value;
    state.since = now();
    const snap = { ...snapshot(), previous, reason };
    for (const fn of [...listeners]) {
      try {
        fn(snap);
      } catch {}
    }
    return snap;

    function snapSafe() {
      return { ...snapshot(), previous, reason };
    }
  }

  // Re-evaluate now: the browser flag first, then the optional probe. Returns
  // the resulting online state.
  async function check() {
    let online = n ? n.onLine !== false : true;
    if (online && typeof probe === "function") {
      try {
        await probe();
      } catch {
        online = false;
      }
    }
    setOnline(online, { reason: "check" });
    return state.online;
  }

  function onOnline() {
    setOnline(true, { reason: "browser" });
  }
  function onOffline() {
    setOnline(false, { reason: "browser" });
  }

  function start() {
    if (w && w.addEventListener) {
      w.addEventListener("online", onOnline);
      w.addEventListener("offline", onOffline);
    }
    return api;
  }
  function stop() {
    if (w && w.removeEventListener) {
      w.removeEventListener("online", onOnline);
      w.removeEventListener("offline", onOffline);
    }
    return api;
  }
  function subscribe(fn) {
    if (typeof fn !== "function") return () => {};
    listeners.add(fn);
    return () => listeners.delete(fn);
  }
  function beginSync() {
    state.syncing = true;
    emit();
  }
  function endSync(result = null) {
    state.syncing = false;
    state.lastSyncAt = now();
    state.lastResult = result;
    emit();
  }

  const api = {
    get online() {
      return state.online;
    },
    state: snapshot,
    start,
    stop,
    check,
    setOnline,
    subscribe,
    beginSync,
    endSync,
  };
  return api;
}

// The header pill's label + tone from the connectivity snapshot and the number
// of changes still waiting to sync.
export function connectivitySummary(state = {}, pendingCount = 0) {
  const pending = Number(pendingCount) || 0;
  if (state.syncing) return { tone: "syncing", label: "Syncing…", title: "Pushing your local changes to the cloud" };
  if (state.online === false) {
    return {
      tone: "offline",
      label: pending ? "Offline · " + pending + " pending" : "Offline",
      title: "Working offline — edits are saved on this device and sync when the connection returns.",
    };
  }
  if (pending > 0) {
    return { tone: "pending", label: pending + " to sync", title: pending + " local change" + (pending === 1 ? "" : "s") + " waiting to sync." };
  }
  return { tone: "online", label: "Online", title: "Connected — changes save straight to the cloud store." };
}

// ---- field checklists -------------------------------------------------------

// A new items array with one step's completion set. Never mutates the input, so
// a field tick can be committed straight through the store without the editor's
// local copy losing its place.
export function setChecklistStepDone(items, stepId, done, { by = "", at } = {}) {
  const stamp = at == null ? Date.now() : at;
  return (Array.isArray(items) ? items : []).map((it) => {
    if (!it || it.id !== stepId) return it;
    if (done) return { ...it, done: true, doneAt: it.doneAt || stamp, doneBy: str(by) || it.doneBy || "" };
    return { ...it, done: false, doneAt: null, doneBy: "" };
  });
}

export function toggleChecklistStep(items, stepId, opts = {}) {
  const cur = (Array.isArray(items) ? items : []).find((it) => it && it.id === stepId);
  return setChecklistStepDone(items, stepId, !(cur && cur.done), opts);
}

// The next still-open step after `stepId` (or the first open step when it is
// null) — what a field checklist scrolls to after a tick.
export function nextOpenStep(items, stepId = null) {
  const list = Array.isArray(items) ? items : [];
  if (stepId == null) return list.find((it) => it && !it.done) || null;
  const i = list.findIndex((it) => it && it.id === stepId);
  for (let j = i + 1; j < list.length; j += 1) if (list[j] && !list[j].done) return list[j];
  return null;
}

// ---- quick search -----------------------------------------------------------

export const QUICK_QUERY_HELP = [
  { key: "type", hint: "type:documents" },
  { key: "client", hint: "client:acme" },
  { key: "model", hint: "model:core" },
  { key: "prov", hint: "prov:synced" },
  { key: "life", hint: "life:attention" },
  { key: "due", hint: "due:30" },
];

const FILTER_ALIASES = {
  type: "collection",
  kind: "collection",
  collection: "collection",
  client: "client",
  set: "client",
  model: "informationModel",
  informationmodel: "informationModel",
  prov: "provenance",
  provenance: "provenance",
  life: "lifecycle",
  lifecycle: "lifecycle",
  status: "lifecycle",
  due: "expiryDays",
  expiry: "expiryDays",
  expiring: "expiryDays",
};

const FILTER_LABELS = {
  collection: "Type",
  client: "Client",
  informationModel: "Model",
  provenance: "Provenance",
  lifecycle: "Lifecycle",
  expiryDays: "Expiring",
};

// Split "vlan type:configurations client:acme" into free text plus structured
// filters. A `key:value` whose key is not a known filter stays as free text, so
// an ordinary query with a colon in it is never mangled.
export function parseQuickQuery(raw) {
  const text = [];
  const filters = {};
  const chips = [];
  const tokens = str(raw).split(/\s+/).filter(Boolean);
  for (const token of tokens) {
    const m = token.match(/^([A-Za-z]+)[:=](.+)$/);
    const key = m ? FILTER_ALIASES[m[1].toLowerCase()] : null;
    if (key && m[2]) {
      const value = m[2].replace(/^"|"$/g, "");
      filters[key] = value;
      chips.push({ key, label: FILTER_LABELS[key] || key, value });
    } else {
      text.push(token);
    }
  }
  return { text: text.join(" "), filters, chips };
}

// Resolve a `client:` token to a real client id when the operator typed the
// client's NAME rather than its id.
function resolveClientFilter(filters, entries) {
  const value = filters.client;
  if (!value) return filters;
  const lower = value.toLowerCase();
  const byId = entries.some((e) => e.client && e.client.id === value);
  if (byId) return filters;
  const match = entries.find((e) => e.client && String(e.client.name || "").toLowerCase().includes(lower));
  if (match && match.client) return { ...filters, client: match.client.id };
  return filters;
}

// Run a quick query against a combined index, returning only the top hits (the
// palette shows a handful, not the full result list). `limit` defaults to 8.
export function quickSearch(index, raw, { limit = 8 } = {}) {
  const parsed = parseQuickQuery(raw);
  const entries = (index && index.entries) || [];
  const filters = resolveClientFilter(parsed.filters, entries);
  const res = searchRecords(index, parsed.text, filters);
  return {
    ...parsed,
    filters,
    total: res.total,
    results: res.results.slice(0, Math.max(0, limit)),
  };
}

// The one-line "what am I filtering by" hint chips, plus the model/provenance/
// lifecycle labels resolved to their display names.
export function quickChips(raw) {
  const { chips } = parseQuickQuery(raw);
  return chips.map((c) => {
    if (c.key === "collection") {
      const meta = Object.entries(RECORD_TYPE_META).find(([id]) => id === c.value || (RECORD_TYPE_META[id].label || "").toLowerCase() === c.value.toLowerCase());
      return { ...c, display: meta ? meta[1].label : c.value };
    }
    if (c.key === "informationModel") {
      const m = INFORMATION_MODELS.find((x) => x.id === c.value);
      return { ...c, display: m ? m.label : c.value };
    }
    if (c.key === "provenance") {
      const p = PROVENANCE.find((x) => x.id === c.value);
      return { ...c, display: p ? p.label : c.value };
    }
    if (c.key === "lifecycle") {
      if (c.value === "attention") return { ...c, display: "Needs attention" };
      const l = LIFECYCLE_STATES.find((x) => x.id === c.value);
      return { ...c, display: l ? l.label : c.value };
    }
    return { ...c, display: c.value };
  });
}
