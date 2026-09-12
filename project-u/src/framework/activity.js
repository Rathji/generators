// ============================================================================
//  Project U — Aggregated Activity (Phase 5, tasks 21-24)
//  A centralized stream of "latest items" from every -U member: quotes from
//  Quote-U, tickets/invoices from PSA-U, renewals from CRM-U, documentation
//  changes from IT-U and framework releases from Template-U.
//
//  Until the members expose a real API, `createActivitySource` stands in as a
//  deterministic *simulated* API: it seeds a believable event stream, hands it
//  back through an async `fetch()` (so the UI exercises real loading behaviour)
//  and summarises it into the quick-stats row. Swap the source implementation
//  for a `fetch`-backed one and nothing else changes.
// ============================================================================

import { getMember, listMembers } from "./members.js";
import { formatCurrency, titleCase } from "./utils.js";

export const DEFAULT_ACTIVITY_COUNT = 28;
export const DEFAULT_ACTIVITY_SEED = 42;

const MINUTE = 60000;
const DAY = 86400000;

// ------------------------------------------------------------------- rng ----

// Small, fast, deterministic PRNG (mulberry32). Deterministic generation keeps
// the mock feed stable across renders *and* makes the suite reproducible.
export function createRng(seed = 1) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick(rng, arr) {
  return arr[Math.min(arr.length - 1, Math.floor(rng() * arr.length))];
}

function int(rng, min, max) {
  return min + Math.floor(rng() * (max - min + 1));
}

function weightedPick(rng, entries) {
  const total = entries.reduce((sum, entry) => sum + (entry.weight || 0), 0);
  let r = rng() * total;
  for (const entry of entries) {
    r -= entry.weight || 0;
    if (r <= 0) return entry.value;
  }
  return entries[entries.length - 1].value;
}

// ---------------------------------------------------------------- content ---

const CLIENTS = [
  "Northwind Trading",
  "Acme Fabrication",
  "Bluepeak Logistics",
  "Cedar & Stone Legal",
  "Harborline Dental",
  "Ironclad Security",
  "Meadowlark Clinic",
  "Redwood Accounting",
  "Summit Roofing",
  "Vector Robotics",
];

const PEOPLE = [
  "Dana Whitfield",
  "Marcus Lee",
  "Priya Nair",
  "Tom Okafor",
  "Elena Rossi",
  "Sam Bhatt",
  "Grace Lin",
  "Owen Park",
  "Nadia Haddad",
  "Chris Doyle",
];

const SERVICES = [
  "Managed IT",
  "VoIP estate",
  "Fibre circuit",
  "Backup & DR",
  "Endpoint security",
  "M365 migration",
  "Network refresh",
  "Website retainer",
];

const ASSETS = [
  "FW-Edge-Router",
  "Core-Switch-01",
  "NAS-Backup-01",
  "AP-Lobby",
  "M365-Tenant",
  "VPN-Hub",
  "RDS-01",
  "Fleet-Laptops",
];

const PROJECTS = ["Network refresh", "M365 migration", "Fibre rollout", "Security uplift", "VoIP migration", "Backup rollout"];

const STAGES = ["discovery", "proposal", "negotiation", "won"];

const COMPONENTS = ["command palette", "activity feed", "preference panel", "stat tiles", "data table"];

const TOKENS = ["--pu-primary", "--pu-accent", "--pu-surface", "--pu-radius-lg"];

const CONTACT_ROLES = ["Operations Manager", "Finance Lead", "Managing Director", "IT Coordinator", "Office Manager"];

function quoteRef(rng) {
  return `Q-${1200 + int(rng, 1, 480)}`;
}
function ticketRef(rng) {
  return `#${4200 + int(rng, 1, 1800)}`;
}
function invoiceRef(rng) {
  return `INV-${300 + int(rng, 1, 600)}`;
}
function money(rng, min, max) {
  return Math.round((min + rng() * (max - min)) / 50) * 50;
}

// ------------------------------------------------------------------ model ---

export const ACTIVITY_KINDS = Object.freeze({
  quote: { label: "Quote", icon: "file" },
  ticket: { label: "Ticket", icon: "briefcase" },
  engagement: { label: "Engagement", icon: "briefcase" },
  timesheet: { label: "Timesheet", icon: "clock" },
  invoice: { label: "Invoice", icon: "chart" },
  lead: { label: "Lead", icon: "users" },
  deal: { label: "Deal", icon: "users" },
  renewal: { label: "Renewal", icon: "users" },
  contact: { label: "Contact", icon: "users" },
  account: { label: "Account", icon: "users" },
  document: { label: "Document", icon: "book" },
  credential: { label: "Credential", icon: "lock" },
  asset: { label: "Asset", icon: "box" },
  service: { label: "Service", icon: "sliders" },
  framework: { label: "Framework", icon: "layout" },
});

export const STATUS_TONES = Object.freeze({
  draft: "neutral",
  sent: "info",
  viewed: "info",
  open: "info",
  new: "info",
  submitted: "info",
  updated: "info",
  assigned: "info",
  added: "info",
  discovery: "info",
  proposal: "info",
  pending: "warning",
  due: "warning",
  expiring: "warning",
  negotiation: "warning",
  accepted: "success",
  resolved: "success",
  completed: "success",
  secure: "success",
  released: "success",
  won: "success",
  declined: "danger",
  "at-risk": "danger",
  overdue: "danger",
});

const STATUS_LABELS = { "at-risk": "At risk", "on-track": "On track" };

// The quick-stats metrics — the counts the feed rolls up into the stats row.
export const ACTIVITY_METRICS = Object.freeze({
  "open-quotes": { label: "Open quotes", tone: "warning", icon: "file", memberId: "quote-u" },
  "pending-tickets": { label: "Pending tickets", tone: "danger", icon: "briefcase", memberId: "psa-u" },
  "renewals-due": { label: "Renewals due", tone: "warning", icon: "users", memberId: "crm-u" },
  "draft-invoices": { label: "Draft invoices", tone: "info", icon: "chart", memberId: "psa-u" },
  "open-tickets": { label: "Open tickets", tone: "info", icon: "briefcase", memberId: "psa-u" },
  "draft-quotes": { label: "Draft quotes", tone: "neutral", icon: "file", memberId: "quote-u" },
});

export const METRIC_ORDER = ["open-quotes", "pending-tickets", "renewals-due", "draft-invoices", "open-tickets", "draft-quotes"];

function event(memberId, kind, spec) {
  return { memberId, kind, weight: 1, ...spec };
}

// One entry per "thing that happens" in the suite. `weight` biases how often it
// shows up; `build(rng)` fills in the human-readable detail.
const EVENT_SPECS = Object.freeze([
  // ---------------------------------------------------------------- Quote-U --
  event("quote-u", "quote", {
    event: "created",
    status: "draft",
    metric: "draft-quotes",
    weight: 3,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const service = pick(rng, SERVICES);
      const amount = money(rng, 800, 18000);
      return { title: `Quote ${quoteRef(rng)} drafted for ${client}`, summary: `${service} — ${formatCurrency(amount)}`, amount, tags: ["quote", service] };
    },
  }),
  event("quote-u", "quote", {
    event: "sent",
    status: "sent",
    metric: "open-quotes",
    weight: 3,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const service = pick(rng, SERVICES);
      const amount = money(rng, 900, 24000);
      return { title: `Quote ${quoteRef(rng)} sent to ${client}`, summary: `${service} — ${formatCurrency(amount)}, awaiting decision`, amount, tags: ["quote", service] };
    },
  }),
  event("quote-u", "quote", {
    event: "accepted",
    status: "accepted",
    weight: 4,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const service = pick(rng, SERVICES);
      const amount = money(rng, 1200, 32000);
      return { title: `Quote ${quoteRef(rng)} accepted by ${client}`, summary: `${service} approved — ${formatCurrency(amount)}`, amount, tags: ["quote", "won"] };
    },
  }),
  event("quote-u", "quote", {
    event: "expiring",
    status: "expiring",
    metric: "open-quotes",
    priority: "high",
    weight: 2,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const days = int(rng, 1, 5);
      return { title: `Quote ${quoteRef(rng)} expires in ${days} day${days === 1 ? "" : "s"}`, summary: `${client} hasn't responded yet`, tags: ["quote", "expiring"] };
    },
  }),
  event("quote-u", "quote", {
    event: "declined",
    status: "declined",
    weight: 1,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const service = pick(rng, SERVICES);
      return { title: `Quote ${quoteRef(rng)} declined by ${client}`, summary: `${service} — lost to a competitor`, tags: ["quote", "lost"] };
    },
  }),

  // ------------------------------------------------------------------ PSA-U --
  event("psa-u", "ticket", {
    event: "opened",
    status: "open",
    metric: "open-tickets",
    priority: "high",
    weight: 4,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const service = pick(rng, SERVICES);
      return { title: `Ticket ${ticketRef(rng)} opened — ${client}`, summary: `${service} issue reported by ${pick(rng, PEOPLE)}`, actor: pick(rng, PEOPLE), tags: ["ticket", service] };
    },
  }),
  event("psa-u", "ticket", {
    event: "awaiting",
    status: "pending",
    metric: "pending-tickets",
    weight: 3,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const service = pick(rng, SERVICES);
      return { title: `Ticket ${ticketRef(rng)} awaiting client response`, summary: `${client} · ${service}`, tags: ["ticket", "waiting"] };
    },
  }),
  event("psa-u", "ticket", {
    event: "resolved",
    status: "resolved",
    weight: 3,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const service = pick(rng, SERVICES);
      return { title: `Ticket ${ticketRef(rng)} resolved`, summary: `${service} restored for ${client}`, tags: ["ticket", "resolved"] };
    },
  }),
  event("psa-u", "engagement", {
    event: "milestone",
    status: "completed",
    weight: 2,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const project = pick(rng, PROJECTS);
      const tasks = int(rng, 2, 9);
      return { title: `Milestone complete — ${client}`, summary: `${project} · ${tasks} tasks closed`, tags: ["psa", project] };
    },
  }),
  event("psa-u", "timesheet", {
    event: "submitted",
    status: "submitted",
    weight: 2,
    build: (rng) => {
      const person = pick(rng, PEOPLE);
      const hours = int(rng, 4, 42);
      return { title: `Timesheet submitted by ${person}`, summary: `${hours}h logged to ${pick(rng, PROJECTS)}`, actor: person, tags: ["timesheet"] };
    },
  }),
  event("psa-u", "invoice", {
    event: "drafted",
    status: "draft",
    metric: "draft-invoices",
    weight: 2,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const amount = money(rng, 1500, 40000);
      return { title: `Draft invoice ${invoiceRef(rng)} for ${client}`, summary: `${pick(rng, PROJECTS)} — ${formatCurrency(amount)}`, amount, tags: ["invoice", "billing"] };
    },
  }),

  // ------------------------------------------------------------------ CRM-U --
  event("crm-u", "lead", {
    event: "created",
    status: "new",
    weight: 3,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const service = pick(rng, SERVICES);
      return { title: `New lead — ${client}`, summary: `${service} enquiry via the website`, tags: ["lead", service] };
    },
  }),
  event("crm-u", "deal", {
    event: "stage",
    weight: 3,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const stage = pick(rng, STAGES);
      const amount = money(rng, 2000, 60000);
      return { title: `Deal moved to ${titleCase(stage)} — ${client}`, summary: `${pick(rng, SERVICES)} · ${formatCurrency(amount)} opportunity`, status: stage, amount, tags: ["deal", stage] };
    },
  }),
  event("crm-u", "renewal", {
    event: "due",
    status: "due",
    metric: "renewals-due",
    priority: "high",
    weight: 3,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const days = int(rng, 5, 45);
      return { title: `Renewal due in ${days} days — ${client}`, summary: `${pick(rng, SERVICES)} contract up for renewal`, tags: ["renewal", "mrr"] };
    },
  }),
  event("crm-u", "contact", {
    event: "added",
    status: "added",
    weight: 1,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const person = pick(rng, PEOPLE);
      return { title: `New contact at ${client}`, summary: `${person} · ${pick(rng, CONTACT_ROLES)}`, actor: person, tags: ["contact"] };
    },
  }),
  event("crm-u", "account", {
    event: "at-risk",
    status: "at-risk",
    priority: "high",
    weight: 2,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const weeks = int(rng, 3, 10);
      const mrr = money(rng, 400, 5000);
      return { title: `Account flagged at risk — ${client}`, summary: `No activity for ${weeks} weeks; ${formatCurrency(mrr)}/mo at stake`, amount: mrr, tags: ["account", "risk"] };
    },
  }),

  // ------------------------------------------------------------------- IT-U --
  event("it-u", "document", {
    event: "updated",
    status: "updated",
    weight: 3,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const asset = pick(rng, ASSETS);
      return { title: `Runbook updated — ${asset}`, summary: `${client} · change reviewed by ${pick(rng, PEOPLE)}`, tags: ["documentation", asset] };
    },
  }),
  event("it-u", "credential", {
    event: "rotated",
    status: "secure",
    weight: 2,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const asset = pick(rng, ASSETS);
      return { title: `Credential rotated — ${client}`, summary: `${asset} access keys cycled`, tags: ["credential", "security"] };
    },
  }),
  event("it-u", "asset", {
    event: "assigned",
    status: "assigned",
    weight: 2,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const asset = pick(rng, ASSETS);
      return { title: `Asset assigned — ${asset}`, summary: `Provisioned for ${client}`, tags: ["asset", asset] };
    },
  }),
  event("it-u", "service", {
    event: "added",
    status: "added",
    weight: 2,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      const service = pick(rng, SERVICES);
      return { title: `Service added — ${service}`, summary: `Now active for ${client}`, tags: ["service", service] };
    },
  }),
  event("it-u", "document", {
    event: "published",
    status: "completed",
    weight: 1,
    build: (rng) => {
      const client = pick(rng, CLIENTS);
      return { title: `Site documentation published`, summary: `${client} · onboarding pack sent to the client`, tags: ["documentation"] };
    },
  }),

  // -------------------------------------------------------------- Template-U --
  event("template-u", "framework", {
    event: "released",
    status: "released",
    weight: 2,
    build: (rng) => ({ title: `Framework v0.1.${int(rng, 1, 9)} released`, summary: "Project-U picks the update up automatically", tags: ["framework", "release"] }),
  }),
  event("template-u", "framework", {
    event: "token",
    status: "updated",
    weight: 1,
    build: (rng) => ({ title: `Theme token updated — ${pick(rng, TOKENS)}`, summary: "Applies to every member at runtime", tags: ["framework", "theme"] }),
  }),
  event("template-u", "framework", {
    event: "component",
    status: "added",
    weight: 1,
    build: (rng) => ({ title: `New component shipped — ${pick(rng, COMPONENTS)}`, summary: "Available to every member generator", tags: ["framework", "component"] }),
  }),
]);

const MEMBER_WEIGHTS = { "crm-u": 4, "it-u": 3, "psa-u": 6, "quote-u": 5, "template-u": 1 };

const MEMBER_ENTRIES = listMembers()
  .map((member) => ({ value: member.id, weight: MEMBER_WEIGHTS[member.id] || 1 }))
  .filter((entry) => EVENT_SPECS.some((spec) => spec.memberId === entry.value));

const SPECS_BY_MEMBER = EVENT_SPECS.reduce((map, spec) => {
  if (!map[spec.memberId]) map[spec.memberId] = [];
  map[spec.memberId].push(spec);
  return map;
}, {});

// ---------------------------------------------------------------- builders --

// Pure: same seed -> same stream. Items carry `ageMinutes` (relative) so the
// caller can materialise them against any clock without regenerating.
export function generateActivity({ count = DEFAULT_ACTIVITY_COUNT, seed = DEFAULT_ACTIVITY_SEED } = {}) {
  if (!(count > 0)) return [];
  const rng = createRng(seed);
  const items = [];
  let age = 1 + rng() * 7;
  for (let i = 0; i < count; i += 1) {
    const memberId = weightedPick(rng, MEMBER_ENTRIES);
    const spec = weightedPick(
      rng,
      SPECS_BY_MEMBER[memberId].map((entry) => ({ value: entry, weight: entry.weight || 1 }))
    );
    const member = getMember(memberId);
    const built = spec.build(rng, member) || {};
    const status = built.status || spec.status || "updated";
    items.push({
      id: `act-${seed}-${i + 1}`,
      memberId,
      kind: spec.kind,
      event: spec.event || spec.kind,
      metric: (built.metric !== undefined ? built.metric : spec.metric) || null,
      status,
      statusLabel: STATUS_LABELS[status] || titleCase(status),
      tone: built.tone || STATUS_TONES[status] || "neutral",
      priority: built.priority || spec.priority || "normal",
      actor: built.actor || pick(rng, PEOPLE),
      title: built.title || `${member ? member.name : memberId} activity`,
      summary: built.summary || "",
      amount: built.amount == null ? null : built.amount,
      tags: built.tags || [spec.kind],
      ageMinutes: Math.max(1, Math.round(age)),
    });
    age += 3 + rng() * 88;
  }
  return items;
}

export function materializeActivity(items, now = Date.now()) {
  return (items || []).map((item) => ({ ...item, at: now - item.ageMinutes * MINUTE }));
}

export function sortActivity(items) {
  return [...(items || [])].sort((a, b) => (b.at || 0) - (a.at || 0) || String(a.id).localeCompare(String(b.id)));
}

export function filterActivity(items, filters = {}) {
  const { memberId = null, kind = null, status = null, metric = null, priority = null, search = "" } = filters;
  const needle = String(search || "").trim().toLowerCase();
  return (items || []).filter((item) => {
    if (memberId && item.memberId !== memberId) return false;
    if (kind && item.kind !== kind) return false;
    if (status && item.status !== status) return false;
    if (metric && item.metric !== metric) return false;
    if (priority && item.priority !== priority) return false;
    if (needle) {
      const haystack = `${item.title} ${item.summary} ${item.actor} ${(item.tags || []).join(" ")}`.toLowerCase();
      if (!haystack.includes(needle)) return false;
    }
    return true;
  });
}

// ------------------------------------------------------------------ day -----

function startOfDay(ms) {
  const date = new Date(ms);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

export function groupActivityByDay(items, now = Date.now()) {
  const today = startOfDay(now);
  const buckets = [
    { key: "today", label: "Today" },
    { key: "yesterday", label: "Yesterday" },
    { key: "week", label: "Earlier this week" },
    { key: "older", label: "Older" },
  ];
  const map = new Map(buckets.map((bucket) => [bucket.key, []]));
  for (const item of sortActivity(items)) {
    const day = startOfDay(item.at == null ? now : item.at);
    const diff = Math.round((today - day) / DAY);
    const key = diff <= 0 ? "today" : diff === 1 ? "yesterday" : diff <= 6 ? "week" : "older";
    map.get(key).push(item);
  }
  return buckets.map((bucket) => ({ ...bucket, items: map.get(bucket.key) })).filter((bucket) => bucket.items.length);
}

// ---------------------------------------------------------------- summary ---

export function summarizeActivity(items, { metrics = ACTIVITY_METRICS, order = METRIC_ORDER } = {}) {
  const byMetric = {};
  const byMember = {};
  const byStatus = {};
  const byKind = {};
  let latest = null;
  let needsAttention = 0;
  for (const item of items || []) {
    if (item.metric) byMetric[item.metric] = (byMetric[item.metric] || 0) + 1;
    byMember[item.memberId] = (byMember[item.memberId] || 0) + 1;
    byStatus[item.status] = (byStatus[item.status] || 0) + 1;
    byKind[item.kind] = (byKind[item.kind] || 0) + 1;
    if (item.at != null && (latest == null || item.at > latest)) latest = item.at;
    if (item.priority === "high" || item.tone === "danger") needsAttention += 1;
  }
  const highlights = order
    .filter((id) => byMetric[id] && metrics[id])
    .map((id) => ({ id, count: byMetric[id], ...metrics[id] }));
  return {
    total: (items || []).length,
    byMetric,
    byMember,
    byStatus,
    byKind,
    latest,
    needsAttention,
    highlights,
  };
}

// ---------------------------------------------------- simulated API source --

export function createActivitySource(options = {}) {
  const {
    seed = DEFAULT_ACTIVITY_SEED,
    count = DEFAULT_ACTIVITY_COUNT,
    latency = 320,
    refreshAdds = 2,
    failWith = null,
    clock = () => Date.now(),
  } = options;

  let generation = 0;
  let base = generateActivity({ count, seed });

  function materialized() {
    return materializeActivity(base, clock());
  }

  function fetch(filters = {}) {
    const snapshot = materialized();
    const apply = () => {
      const filtered = sortActivity(filterActivity(snapshot, filters));
      return filters.limit ? filtered.slice(0, filters.limit) : filtered;
    };
    if (failWith) {
      const error = failWith instanceof Error ? failWith : new Error(String(failWith));
      if (!latency) return Promise.reject(error);
      return new Promise((resolve, reject) => setTimeout(() => reject(error), latency));
    }
    if (!latency) return Promise.resolve(apply());
    return new Promise((resolve) => setTimeout(() => resolve(apply()), latency));
  }

  // Simulates the stream advancing: age the existing items slightly and prepend
  // a couple of brand-new ones.
  function refresh(filters = {}) {
    generation += 1;
    const fresh = generateActivity({ count: refreshAdds, seed: seed + generation * 97 });
    base = [...fresh, ...base].slice(0, count + generation * refreshAdds);
    return fetch(filters);
  }

  function summarize(items) {
    return summarizeActivity(items || materialized());
  }

  return {
    fetch,
    refresh,
    summarize,
    all: materialized,
    get seed() {
      return seed;
    },
    get size() {
      return base.length;
    },
  };
}
