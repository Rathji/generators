// src/framework/collab.js — the collaborative-editing engine (roadmap task 55).
//
// Task 55 makes the realtime hub actually useful for two people working at once:
// a session announces which record/runbook it has open (an "editor marker"), and
// when a remote save lands on a record someone else is editing, that session
// classifies the collision and offers an inline resolution rather than silently
// clobbering — or silently losing — work. This file is the PURE half of that: no
// DOM, no network, no hub. Everything here is unit-testable on its own.
//
// Three ideas:
//   • PRESENCE — normalize an ephemeral editor list (who has a record open),
//     prune stale markers, and describe them in one short sentence.
//   • STAMPS — a stable fingerprint of a record's *content* (structure, not the
//     bookkeeping `updatedAt`/`updatedBy`), so the three versions of a
//     concurrent edit (base, mine, theirs) can be compared precisely.
//   • MERGE — a three-way, field-level merge of a record. Adopt whatever only
//     one side changed; flag the fields both sides changed to different values
//     as genuine conflicts for the user to settle, rather than guessing.

// How long an editor marker survives without a refresh. The hub re-claims on a
// timer, so a closed tab's marker falls away on its own.
export const EDIT_TTL_MS = 45000;

// ---- stable serialization / stamps -----------------------------------------

// Deterministic JSON: object keys sorted, so two structurally-equal values
// serialize identically regardless of key order.
export function sortedJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value === undefined ? null : value);
  if (Array.isArray(value)) return "[" + value.map(sortedJson).join(",") + "]";
  const keys = Object.keys(value).sort();
  return "{" + keys.map((k) => JSON.stringify(k) + ":" + sortedJson(value[k])).join(",") + "}";
}

export function deepEqual(a, b) {
  return sortedJson(a) === sortedJson(b);
}

// The bookkeeping keys that must NOT count as a content change: an edit that
// only bumps these is not a change a collaborator needs to reconcile.
export const STAMP_IGNORED_KEYS = ["updatedAt", "updatedBy", "lastSeenAt", "reviewedAt"];

// A content fingerprint of a record: a stable JSON string with the volatile
// bookkeeping keys removed. `null`/missing → "" so comparisons are total.
export function recordStamp(record) {
  if (!record || typeof record !== "object") return "";
  const copy = {};
  for (const k of Object.keys(record)) {
    if (STAMP_IGNORED_KEYS.includes(k)) continue;
    copy[k] = record[k];
  }
  return sortedJson(copy);
}

// ---- presence --------------------------------------------------------------

// Keep only markers refreshed within `ttl`. A marker with no `at` is treated as
// fresh (we have no reason to distrust it).
export function pruneEditors(list, now = Date.now(), ttl = EDIT_TTL_MS) {
  return (Array.isArray(list) ? list : []).filter((e) => e && (e.at == null || now - e.at <= ttl));
}

// Unique editor usernames, most-recent first, with the current user's own entry
// collapsed to a single "you".
export function editorNames(list, me) {
  const seen = new Set();
  const names = [];
  for (const e of list) {
    const u = e && e.user;
    if (!u) continue;
    const key = u === me ? "\u0000me" : u;
    if (seen.has(key)) continue;
    seen.add(key);
    names.push(u);
  }
  // Put "you" first so the sentence reads naturally.
  names.sort((a, b) => (a === me ? -1 : b === me ? 1 : 0));
  return names;
}

// A short sentence for the presence strip: "" when nobody, then "You are
// editing", "Alice is editing", "You and Alice are editing",
// "Alice and Bob are editing", "You and 2 others are editing".
export function editingSummary(list, me) {
  const names = editorNames(list, me);
  if (!names.length) return "";
  const meHere = names.includes(me);
  const others = names.filter((n) => n !== me);
  const who = (names2) => (names2.length === 1 ? names2[0] : names2.slice(0, -1).join(", ") + " and " + names2[names2.length - 1]);
  if (meHere && !others.length) return "You are editing";
  if (!meHere && names.length === 1) return names[0] + " is editing";
  if (meHere) {
    if (others.length === 1) return "You and " + others[0] + " are editing";
    if (others.length === 2) return "You, " + others[0] + " and " + others[1] + " are editing";
    return "You and " + others.length + " others are editing";
  }
  if (names.length === 2) return names[0] + " and " + names[1] + " are editing";
  if (names.length === 3) return who(names) + " are editing";
  const rest = names.length - 2;
  return names[0] + ", " + names[1] + " and " + rest + (rest === 1 ? " other" : " others") + " are editing";
}

// Two capital letters for a marker chip.
export function editorInitials(username) {
  const s = String(username || "?").replace(/[^a-z0-9]/gi, "");
  return (s.slice(0, 2) || "?").toUpperCase();
}

// ---- remote-change classification ------------------------------------------

// Given the three content stamps of the open record, decide what a remote save
// means for this session:
//   "unchanged"    — the remote doc moved, but NOT the record we're editing.
//   "remote-only"  — the remote changed the record and we have no local edits:
//                    safe to adopt it silently.
//   "converged"    — we independently made the same edit: nothing to reconcile.
//   "conflict"     — both sides changed the record differently: needs a decision.
export function classifyRemoteChange({ base, mine, theirs }) {
  const b = base == null ? "" : base;
  const m = mine == null ? "" : mine;
  const t = theirs == null ? "" : theirs;
  if (t === b) return "unchanged";
  if (m === b) return "remote-only";
  if (m === t) return "converged";
  return "conflict";
}

// ---- three-way record merge ------------------------------------------------

// Field-level three-way merge. For each (top-level) field:
//   • both sides equal → keep it
//   • only mine changed → keep mine
//   • only theirs changed → adopt theirs
//   • both changed to DIFFERENT values → KEEP MINE and record a conflict
// `updatedAt`/`updatedBy`-style keys are ignored (kept from mine when present).
// Returns { merged, conflicts:[{field, base, mine, theirs}], adopted:[field] };
// `clean` is true when there are no conflicts.
export function mergeRecords(base, mine, theirs, opts = {}) {
  const ignore = new Set([...(opts.ignore || []), ...STAMP_IGNORED_KEYS]);
  const b = base && typeof base === "object" ? base : {};
  const m = mine && typeof mine === "object" ? mine : {};
  const t = theirs && typeof theirs === "object" ? theirs : {};
  const fields = new Set([...Object.keys(m), ...Object.keys(t), ...Object.keys(b)]);
  const merged = {};
  const conflicts = [];
  const adopted = [];
  for (const field of fields) {
    if (ignore.has(field)) {
      if (field in m) merged[field] = m[field];
      else if (field in t) merged[field] = t[field];
      continue;
    }
    const bv = b[field];
    const mv = m[field];
    const tv = t[field];
    if (deepEqual(mv, tv)) {
      if (mv !== undefined) merged[field] = mv;
      continue;
    }
    const mineChanged = !deepEqual(mv, bv);
    const theirsChanged = !deepEqual(tv, bv);
    if (mineChanged && !theirsChanged) {
      if (mv !== undefined) merged[field] = mv;
    } else if (!mineChanged && theirsChanged) {
      if (tv !== undefined) merged[field] = tv;
      adopted.push(field);
    } else {
      // Both diverged from base — an irreconcilable field. Keep mine; surface it.
      if (mv !== undefined) merged[field] = mv;
      conflicts.push({ field, base: bv, mine: mv, theirs: tv });
    }
  }
  return { merged, conflicts, adopted, clean: conflicts.length === 0 };
}

// A human phrase for a field id, for the conflict list.
export function describeField(field) {
  if (!field) return "field";
  const spaced = String(field)
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/[_-]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  const lower = spaced.toLowerCase();
  return lower.charAt(0).toUpperCase() + lower.slice(1);
}

// Render a value for a one-line conflict preview (kept "safe" for text display).
export function previewValue(value) {
  if (value === undefined) return "(empty)";
  if (value === null) return "(none)";
  if (typeof value === "string") {
    const flat = value.replace(/\s+/g, " ").trim();
    return flat.length > 80 ? flat.slice(0, 77) + "…" : flat;
  }
  if (Array.isArray(value)) return value.length + " item" + (value.length === 1 ? "" : "s");
  if (typeof value === "object") return "record";
  return String(value);
}
