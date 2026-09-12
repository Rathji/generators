// src/pm/integrate.js — Project-U ecosystem integration (Roadmap Phase 5).
//
// "Reference, don't copy": pm-u never imports a sibling generator's code. It
// links OUT to them and shares records by GLOBAL SHARED IDS. This module is the
// single, pure source of truth for:
//
//   • the family MEMBER registry (identity + deep-link routes of every tool),
//   • the shared-id scheme (`puid~<app>~<kind>~<uid>`),
//   • deep-link construction for a record in another member,
//   • pm-u's own machine-readable MEMBER DESCRIPTOR (what the central
//     Project-U dashboard reads to list/launch pm-u).
//
// Everything here is pure (no store, no DOM) so it is unit-tested directly.

export const FAMILY = "Project U";
export const SHARED_ID_PREFIX = "puid";
export const SHARED_ID_SCHEME = "puid~<app>~<kind>~<uid>";
export const REF_PARAM = "ref";

// ── member registry ──────────────────────────────────────────────
// `route` values are the member's own hash-route where a record of that kind
// can be opened; the shared id always travels in the `ref` query parameter, so
// a member that doesn't recognise a route still receives the reference.
// `accent` mirrors each member's brand colour for launcher cards.
export const MEMBERS = [
  {
    id: "project-u",
    title: "Project-U",
    short: "PU",
    accent: "#1e3a8a",
    role: "hub",
    description: "The central command centre — launch every member tool and see what needs attention.",
    entities: [],
  },
  {
    id: "pm-u",
    title: "PM-U",
    short: "PMU",
    accent: "#0d9488",
    role: "member",
    description: "Project Manager — portfolios, projects, tasks, calendar, boards, notes, habits and focus.",
    entities: [
      { type: "project", label: "Project", route: "projects" },
      { type: "task", label: "Task", route: "tasks" },
      { type: "event", label: "Event", route: "calendar" },
      { type: "checklist", label: "Checklist", route: "checklists" },
      { type: "note", label: "Note", route: "notes" },
      { type: "habit", label: "Habit", route: "habits" },
      { type: "board", label: "Board", route: "boards" },
      { type: "company", label: "Company", route: "ecosystem" },
      { type: "customer", label: "Customer", route: "ecosystem" },
    ],
  },
  {
    id: "crm-u",
    title: "CRM-U",
    short: "CRM",
    accent: "#2563eb",
    role: "member",
    description: "CRM for IT, VoIP and internet providers — accounts, contacts, leads, pipeline and service book.",
    entities: [
      { type: "account", label: "Account", route: "home" },
      { type: "contact", label: "Contact", route: "home" },
      { type: "lead", label: "Lead", route: "home" },
      { type: "ticket", label: "Ticket", route: "home" },
      { type: "circuit", label: "Circuit", route: "home" },
    ],
  },
  {
    id: "psa-u",
    title: "PSA-U",
    short: "PSA",
    accent: "#7c3aed",
    role: "member",
    description: "Professional services automation — clients, delivery projects, time and tickets.",
    entities: [
      { type: "client", label: "Client", route: "home" },
      { type: "project", label: "Project", route: "home" },
      { type: "ticket", label: "Ticket", route: "home" },
      { type: "time", label: "Time entry", route: "home" },
    ],
  },
  {
    id: "quote-u",
    title: "Quote-U",
    short: "QT",
    accent: "#ea580c",
    role: "member",
    description: "Quoting and proposals — customers, quotes and invoices.",
    entities: [
      { type: "customer", label: "Customer", route: "home" },
      { type: "quote", label: "Quote", route: "home" },
      { type: "invoice", label: "Invoice", route: "home" },
    ],
  },
  {
    id: "it-u",
    title: "IT-U",
    short: "IT",
    accent: "#0891b2",
    role: "member",
    description: "Client documentation — organizations, assets, documents and deployments.",
    entities: [
      { type: "organization", label: "Organization", route: "home" },
      { type: "asset", label: "Asset", route: "home" },
      { type: "document", label: "Document", route: "home" },
      { type: "deployment", label: "Deployment", route: "home" },
    ],
  },
  {
    id: "rmm-u",
    title: "RMM-U",
    short: "RMM",
    accent: "#16a34a",
    role: "member",
    description: "Remote monitoring & management — organizations, sites, devices and alerts.",
    entities: [
      { type: "organization", label: "Organization", route: "home" },
      { type: "site", label: "Site", route: "home" },
      { type: "device", label: "Device", route: "home" },
      { type: "alert", label: "Alert", route: "home" },
    ],
  },
  {
    id: "integrate-u",
    title: "Integrate-U",
    short: "IU",
    accent: "#9333ea",
    role: "hub",
    description: "The integration hub — one canonical identity, a shared registry and a versioned event bus.",
    entities: [],
  },
  {
    id: "template-u",
    title: "Template-U",
    short: "TU",
    accent: "#64748b",
    role: "framework",
    description: "The shared framework every member is built on — shell, theme, router, components.",
    entities: [],
  },
];

export const PM_U = "pm-u";

export function member(id) {
  return MEMBERS.find((m) => m.id === id) || null;
}
export function members({ includeSelf = true, role = null } = {}) {
  return MEMBERS.filter((m) => (includeSelf || m.id !== PM_U) && (!role || m.role === role));
}
export function memberUrl(id) {
  return "https://perchance.org/" + id;
}
export function entityTypes(memberId) {
  const m = member(memberId);
  return m ? m.entities.slice() : [];
}
export function entityLabel(memberId, type) {
  const e = entityTypes(memberId).find((x) => x.type === type);
  return e ? e.label : String(type || "");
}
export function isKnownEntity(memberId, type) {
  return entityTypes(memberId).some((x) => x.type === type);
}

// ── shared ids ───────────────────────────────────────────────────
// A shared id identifies one record in the whole family, independent of the
// app that minted it: puid~<app>~<kind>~<uid>. Members exchange these (via a
// deep-link `ref` param, copy/paste, or an Integrate-U bundle) to link the
// same real-world entity across tools.
const UID_ALPHABET = "abcdefghijklmnopqrstuvwxyz0123456789";
function randomUid(len = 16) {
  let out = "";
  if (globalThis.crypto && typeof crypto.getRandomValues === "function") {
    const buf = new Uint8Array(len);
    crypto.getRandomValues(buf);
    for (const b of buf) out += UID_ALPHABET[b % UID_ALPHABET.length];
    return out;
  }
  for (let i = 0; i < len; i++) out += UID_ALPHABET[Math.floor(Math.random() * UID_ALPHABET.length)];
  return out;
}

export function mintSharedId(app, kind, uid = randomUid()) {
  return [SHARED_ID_PREFIX, app, kind, uid].join("~");
}

export function parseSharedId(value) {
  const s = String(value || "").trim();
  const parts = s.split("~");
  if (parts.length !== 4) return null;
  const [prefix, app, kind, uid] = parts;
  if (prefix !== SHARED_ID_PREFIX) return null;
  if (!app || !kind || !uid) return null;
  if (!/^[a-z0-9-]+$/.test(app) || !/^[a-z0-9-]+$/.test(kind)) return null;
  return { app, kind, uid };
}
export function isSharedId(value) {
  return parseSharedId(value) !== null;
}
export function sharedIdApp(value) {
  const p = parseSharedId(value);
  return p ? p.app : null;
}
export function sharedIdKind(value) {
  const p = parseSharedId(value);
  return p ? p.kind : null;
}

// ── deep links ───────────────────────────────────────────────────
// Build a read-only "open in the other app" URL for a referenced record. The
// record's shared id always rides in the `ref` query param; `route` is the
// owning member's own hash-route (best-effort — the ref is what matters).
export function recordHref({ app, type, id, route } = {}) {
  if (!app) return null;
  const m = member(app);
  const known = m && type ? m.entities.find((e) => e.type === type) : null;
  const r = route || (known && known.route) || "home";
  const base = memberUrl(app) + "#/" + r;
  if (!id) return base;
  return base + (base.includes("?") ? "&" : "?") + REF_PARAM + "=" + encodeURIComponent(id);
}

// Normalise an arbitrary cross-app reference into { app, type, id, label }.
// Returns null when it can't identify a target member + shared id.
export function normalizeRef(ref) {
  if (!ref || typeof ref !== "object") return null;
  const app = String(ref.app || "").trim();
  const id = String(ref.id || "").trim();
  if (!app || !id || !member(app)) return null;
  const type = String(ref.type || "").trim();
  return { app, type, id, label: String(ref.label || "").trim() || (type ? entityLabel(app, type) : id) };
}
export function refKey(ref) {
  const r = normalizeRef(ref);
  return r ? r.app + "/" + r.type + "/" + r.id : "";
}
export function refHref(ref) {
  return recordHref(ref);
}

// ── identity cross-links ─────────────────────────────────────────
// Which members hold a company/customer identity, so pm-u can render read-only
// links for a shared identity id.
const IDENTITY_TARGETS = {
  company: [
    { app: "crm-u", type: "account" },
    { app: "psa-u", type: "client" },
    { app: "it-u", type: "organization" },
    { app: "rmm-u", type: "organization" },
  ],
  customer: [
    { app: "crm-u", type: "contact" },
    { app: "psa-u", type: "client" },
    { app: "quote-u", type: "customer" },
  ],
};

export function identityTargets(kind) {
  return (IDENTITY_TARGETS[kind] || []).slice();
}

// Read-only links for one identity, e.g. a Company shared id → CRM-U account.
export function identityLinks(kind, sharedId) {
  return identityTargets(kind).map((t) => ({
    app: t.app,
    title: member(t.app) ? member(t.app).title : t.app,
    label: entityLabel(t.app, t.type),
    href: recordHref({ app: t.app, type: t.type, id: sharedId }),
  }));
}

// ── member descriptor (task 21) ──────────────────────────────────
// The machine-readable manifest pm-u publishes so the central Project-U
// dashboard (and Integrate-U) can list, theme and launch it. Kept in sync with
// the static copy at src/member.json.
export function buildMemberDescriptor(overrides = {}) {
  const base = member(PM_U);
  const merged = Object.assign({}, base, overrides);
  return {
    $schema: "project-u/member-descriptor@1",
    family: FAMILY,
    id: merged.id || PM_U,
    title: merged.title,
    short: merged.short,
    accent: merged.accent,
    description: merged.description,
    version: merged.version || "0.1.0",
    url: memberUrl(merged.id || PM_U),
    launch: { group: "Business", icon: "briefcase", order: 30 },
    entities: (merged.entities || []).map((e) => ({ type: e.type, label: e.label })),
    primaryEntities: ["project", "task"],
    sharedIdScheme: SHARED_ID_SCHEME,
    refParam: REF_PARAM,
  };
}
