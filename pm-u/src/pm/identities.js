// src/pm/identities.js — shared identity + cross-app references (Phase 5).
//
// Companies and customers are first-class local records that carry a GLOBAL
// shared id (puid~pm-u~company~…). The same shared id identifies the same
// real-world entity inside CRM-U, PSA-U, Quote-U, IT-U and RMM-U, so we can
// render read-only links to them without copying their data.
//
// Cross-app references live on any owner record (a project, a task, …) as
// `refs: [{ app, type, id, label }]` and are always rendered read-only + a
// deep link to the owning member.

import { mintSharedId, parseSharedId, isSharedId, normalizeRef, refKey, identityLinks } from "./integrate.js";

export const IDENTITY_KINDS = ["company", "customer"];
export const REF_OWNER_TYPES = ["project", "task", "event", "checklist", "note", "habit", "board"];

// ── identities ───────────────────────────────────────────────────
export function identities(store, kind) {
  if (kind) return store.all(kind);
  return IDENTITY_KINDS.flatMap((k) => store.all(k));
}

export function identityBySharedId(store, sharedId) {
  if (!sharedId) return null;
  for (const kind of IDENTITY_KINDS) {
    const hit = store.all(kind).find((r) => r.sharedId === sharedId);
    if (hit) return hit;
  }
  return null;
}

export function createIdentity(store, kind, fields = {}) {
  if (!IDENTITY_KINDS.includes(kind)) return null;
  const name = String(fields.name || "").trim() || (kind === "company" ? "New company" : "New customer");
  return store.create(kind, {
    name,
    sharedId: fields.sharedId || mintSharedId("pm-u", kind),
    email: String(fields.email || "").trim(),
    domain: String(fields.domain || "").trim(),
    phone: String(fields.phone || "").trim(),
    notes: String(fields.notes || "").trim(),
    externalRef: String(fields.externalRef || "").trim(),
  });
}

// Import/adopt an identity by shared id. Idempotent: re-linking the same id
// updates the display name rather than duplicating the record.
export function ensureIdentity(store, sharedId, fields = {}) {
  if (!isSharedId(sharedId)) return null;
  const parsed = parseSharedId(sharedId);
  if (!parsed || !IDENTITY_KINDS.includes(parsed.kind)) return null;
  const existing = identityBySharedId(store, sharedId);
  if (existing) {
    if (fields.name && fields.name !== existing.name) store.upsert(parsed.kind, existing.id, { name: String(fields.name).trim() });
    return store.get(parsed.kind, existing.id);
  }
  return store.create(parsed.kind, {
    name: String(fields.name || "").trim() || (parsed.kind === "company" ? "Linked company" : "Linked customer"),
    sharedId,
    email: String(fields.email || "").trim(),
    domain: String(fields.domain || "").trim(),
    phone: String(fields.phone || "").trim(),
    notes: String(fields.notes || "").trim(),
    externalRef: "",
  });
}

export function identityProjects(store, identity) {
  if (!identity) return [];
  return store.all("project").filter((p) => p.companyId === identity.id || p.customerId === identity.id);
}
export function identityLinksFor(rec) {
  if (!rec || !rec.sharedId) return [];
  return identityLinks(rec.type, rec.sharedId);
}

// Adopt a shared identity from inbound deep-link params ({ ref, name, kind }).
export function importIdentityFromParams(store, params = {}) {
  const sharedId = String(params.ref || "").trim();
  const name = String(params.name || "").trim();
  if (isSharedId(sharedId)) return ensureIdentity(store, sharedId, { name });
  const kind = IDENTITY_KINDS.includes(params.kind) ? params.kind : null;
  if (kind && name) return createIdentity(store, kind, { name, sharedId: String(params.sid || "").trim() });
  return null;
}

// ── cross-app references on owner records ────────────────────────
export function recordRefs(rec) {
  return rec && Array.isArray(rec.refs) ? rec.refs : [];
}

export function addRef(store, ownerType, ownerId, ref) {
  const rec = store.get(ownerType, ownerId);
  if (!rec) return null;
  const n = normalizeRef(ref);
  if (!n) return null;
  const refs = recordRefs(rec);
  if (refs.some((r) => refKey(r) === refKey(n))) return rec;
  return store.upsert(ownerType, ownerId, { refs: [...refs, n] });
}

export function removeRef(store, ownerType, ownerId, key) {
  const rec = store.get(ownerType, ownerId);
  if (!rec) return null;
  return store.upsert(ownerType, ownerId, { refs: recordRefs(rec).filter((r) => refKey(r) !== key) });
}

export function ownerLabel(store, type, rec) {
  if (!rec) return "";
  if (type === "project") return rec.name || "Untitled project";
  return rec.title || rec.name || rec.id;
}

// Every cross-app reference in the workspace, annotated with its owner.
export function allRefs(store) {
  const out = [];
  for (const type of REF_OWNER_TYPES) {
    for (const rec of store.all(type)) {
      for (const ref of recordRefs(rec)) {
        out.push(Object.assign({ ownerType: type, ownerId: rec.id, ownerLabel: ownerLabel(store, type, rec) }, ref));
      }
    }
  }
  return out;
}
