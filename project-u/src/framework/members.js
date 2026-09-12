// ============================================================================
//  Project U — Member Registry (Phase 1, task 2)
//  The CENTRAL configuration object for the Project U suite: one entry per -U
//  generator the hub knows how to launch. Everything the launcher, command
//  palette and activity feed need (name, URL, icon, accent, description) lives
//  here and nowhere else — update this file to add or retire a member.
// ============================================================================

const SUITE_ORIGIN = "https://perchance.org";

// kind: "tool" = launchable business generator · "framework" = shared base
export const MEMBERS = Object.freeze([
  Object.freeze({
    id: "it-u",
    name: "IT-U",
    slug: "it-u",
    kind: "tool",
    category: "Documentation",
    icon: "box",
    accent: "#4f46e5",
    description: "Client documentation for technology providers — organizations, assets, credentials, services and runbooks.",
    tags: ["documentation", "assets", "credentials", "runbooks", "tsp", "msp"],
  }),
  Object.freeze({
    id: "crm-u",
    name: "CRM-U",
    slug: "crm-u",
    kind: "tool",
    category: "Sales & Service",
    icon: "users",
    accent: "#0284c7",
    description: "Accounts, contacts, leads and pipeline, plus the service book for circuits, VoIP and managed IT.",
    tags: ["crm", "accounts", "contacts", "pipeline", "mrr", "renewals"],
  }),
  Object.freeze({
    id: "quote-u",
    name: "Quote-U",
    slug: "quote-u",
    kind: "tool",
    category: "Sales & Service",
    icon: "file",
    accent: "#d97706",
    description: "The quoting system of record — versioned quotes, option groups and a client approval portal.",
    tags: ["quotes", "pricing", "approvals", "pipeline", "mrr"],
  }),
  Object.freeze({
    id: "psa-u",
    name: "PSA-U",
    slug: "psa-u",
    kind: "tool",
    category: "Delivery",
    icon: "briefcase",
    accent: "#059669",
    description: "Professional services automation — engagements, resourcing, time, expenses and billing in one place.",
    tags: ["psa", "projects", "timesheets", "resourcing", "billing", "utilisation"],
  }),
  Object.freeze({
    id: "template-u",
    name: "Template-U",
    slug: "template-u",
    kind: "framework",
    category: "Framework",
    icon: "layout",
    accent: "#64748b",
    description: "The shared Project U framework that every member generator is built from.",
    tags: ["framework", "template", "design system", "starter"],
  }),
]);

// ------------------------------------------------------------------ lookups --

export function listMembers({ kind = null, category = null, includeFramework = true } = {}) {
  return MEMBERS.filter((member) => {
    if (!includeFramework && member.kind === "framework") return false;
    if (kind && member.kind !== kind) return false;
    if (category && member.category !== category) return false;
    return true;
  });
}

export function getMember(idOrSlug) {
  if (!idOrSlug) return null;
  const key = String(idOrSlug).toLowerCase();
  return MEMBERS.find((member) => member.id === key || member.slug === key) || null;
}

// Always a TOP-LEVEL perchance.org URL — never a subdomain, which cannot be
// navigated to directly.
export function memberUrl(member) {
  const slug = typeof member === "string" ? member : member && member.slug;
  return `${SUITE_ORIGIN}/${slug}`;
}

export function memberCategories({ includeFramework = true } = {}) {
  const seen = [];
  for (const member of listMembers({ includeFramework })) {
    if (!seen.includes(member.category)) seen.push(member.category);
  }
  return seen;
}

export function searchMembers(query, options = {}) {
  const q = String(query || "").trim().toLowerCase();
  const pool = listMembers(options);
  if (!q) return pool;
  return pool.filter((member) =>
    `${member.name} ${member.category} ${member.description} ${member.tags.join(" ")}`.toLowerCase().includes(q)
  );
}

// ----------------------------------------------------------------- source ----

// Async facade over the registry (Phase 6, tasks 27-28). A real hub would read
// its member directory from a server, so the launcher and command palette do
// the same: `fetch()` resolves the list asynchronously (a short simulated
// latency by default) and caches it. Inject a `loader` to point at a real
// endpoint; if it rejects, the caller can fall back to the bundled `MEMBERS`
// list that ships with the generator, so a directory outage never blanks the
// hub. `failWith` forces the simulated fetch to reject — used by the error
// states and the validation suite.
export function createMemberSource(options = {}) {
  const { members = listMembers(), latency = 240, loader = null, failWith = null } = options;

  let cache = null;
  let inflight = null;
  let failure = null;

  function load() {
    if (failWith) return Promise.reject(failWith instanceof Error ? failWith : new Error(String(failWith)));
    if (typeof loader === "function") {
      return Promise.resolve(loader()).then((list) => {
        if (!Array.isArray(list) || !list.length) throw new Error("member directory returned an empty payload");
        return list;
      });
    }
    if (!latency) return Promise.resolve(members);
    return new Promise((resolve) => setTimeout(() => resolve(members), latency));
  }

  function fetch({ force = false } = {}) {
    if (cache && !force) return Promise.resolve(cache);
    if (inflight) return inflight;
    inflight = load().then(
      (list) => {
        cache = list;
        failure = null;
        inflight = null;
        return list;
      },
      (error) => {
        failure = error instanceof Error ? error : new Error(String(error));
        inflight = null;
        throw failure;
      }
    );
    return inflight;
  }

  return {
    fetch,
    get members() {
      return cache;
    },
    get loaded() {
      return cache != null;
    },
    get error() {
      return failure;
    },
    get busy() {
      return inflight != null;
    },
    invalidate() {
      cache = null;
      inflight = null;
      failure = null;
    },
  };
}

// ---------------------------------------------------------------- validation --

const KEBAB = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const HEX = /^#[0-9a-f]{6}$/i;

export function validateMembers(list = MEMBERS) {
  const errors = [];
  const ids = new Set();
  const slugs = new Set();
  for (const member of list) {
    const where = member && member.id ? `"${member.id}"` : "member";
    if (!member || typeof member !== "object") {
      errors.push("every registry entry must be an object");
      continue;
    }
    if (!member.id || !KEBAB.test(member.id)) errors.push(`${where}: id must be kebab-case`);
    if (!member.slug || !KEBAB.test(member.slug)) errors.push(`${where}: slug must be kebab-case`);
    if (!member.name) errors.push(`${where}: name is required`);
    if (!member.description) errors.push(`${where}: description is required`);
    if (!member.icon) errors.push(`${where}: icon is required`);
    if (!HEX.test(member.accent || "")) errors.push(`${where}: accent must be a #rrggbb colour`);
    if (member.kind !== "tool" && member.kind !== "framework") errors.push(`${where}: kind must be "tool" or "framework"`);
    if (ids.has(member.id)) errors.push(`${where}: duplicate id`);
    if (slugs.has(member.slug)) errors.push(`${where}: duplicate slug`);
    ids.add(member.id);
    slugs.add(member.slug);
  }
  return { valid: errors.length === 0, errors };
}
