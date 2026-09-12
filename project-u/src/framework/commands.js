// ============================================================================
//  Project U — command model + global search (Phase 3, tasks 11-14)
//  Turns the hub's launchable members, enabled sections and quick actions into
//  one flat, searchable command list. The command palette renders it; anything
//  else that needs a unified launcher can too. Pure data + a small scorer + an
//  injectable run dispatch, so search and execution are testable without a DOM.
// ============================================================================

import { listMembers } from "./members.js";

export const COMMAND_KINDS = Object.freeze({
  MEMBER: "member",
  SECTION: "section",
  ACTION: "action",
});

export const COMMAND_GROUPS = Object.freeze({
  GENERATORS: "Generators",
  SECTIONS: "Sections",
  ACTIONS: "Actions",
});

// Default display order when the query is empty (or as a tie-breaker).
const KIND_ORDER = [COMMAND_KINDS.MEMBER, COMMAND_KINDS.SECTION, COMMAND_KINDS.ACTION];

// ------------------------------------------------------------------ builders --

export function memberCommand(member) {
  return {
    id: `member:${member.id}`,
    kind: COMMAND_KINDS.MEMBER,
    title: member.name,
    subtitle: member.category,
    description: member.description,
    icon: member.icon,
    accent: member.accent,
    keywords: [member.id, member.slug, member.name, member.category, ...(member.tags || [])],
    group: COMMAND_GROUPS.GENERATORS,
    order: member.kind === "framework" ? 20 : 10,
    action: { type: "launch", memberId: member.id },
    member,
  };
}

export function sectionCommand(section) {
  const id = section.id || section.path;
  return {
    id: `section:${id}`,
    kind: COMMAND_KINDS.SECTION,
    title: section.title || section.label || id,
    subtitle: section.group || "Section",
    description: section.description || "",
    icon: section.icon || "box",
    keywords: [id, section.group || "", section.description || ""],
    group: COMMAND_GROUPS.SECTIONS,
    order: section.order == null ? 100 : section.order,
    action: { type: "navigate", path: section.path || section.id },
  };
}

export function actionCommand(action) {
  return {
    id: `action:${action.id}`,
    kind: COMMAND_KINDS.ACTION,
    title: action.title,
    subtitle: action.subtitle || "Action",
    description: action.description || "",
    icon: action.icon || "sparkle",
    accent: action.accent || null,
    keywords: [action.id, ...(action.keywords || [])],
    group: COMMAND_GROUPS.ACTIONS,
    order: action.order == null ? 100 : action.order,
    action: { type: "invoke", id: action.id, run: action.run },
  };
}

// Combine a member list, section list and action list into one command list.
export function buildCommands({ members = listMembers(), sections = [], actions = [] } = {}) {
  return [...members.map(memberCommand), ...sections.map(sectionCommand), ...actions.map(actionCommand)];
}

// ------------------------------------------------------------------- search --

function normalize(text) {
  return String(text == null ? "" : text)
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Fuzzy subsequence score — all query characters must appear in order in the
// title. Rewards contiguous runs and compact matches; 0 means "no match".
function subsequenceScore(haystack, needle) {
  let hi = 0;
  let matched = 0;
  let streak = 0;
  let bestStreak = 0;
  let first = -1;
  for (const ch of needle) {
    if (ch === " ") continue;
    const found = haystack.indexOf(ch, hi);
    if (found === -1) return 0;
    if (first === -1) first = found;
    streak = found === hi ? streak + 1 : 1;
    bestStreak = Math.max(bestStreak, streak);
    hi = found + 1;
    matched++;
  }
  if (!matched) return 0;
  const span = Math.max(hi - first, 1);
  const compactness = matched / span; // 0..1 — tighter matches score higher
  return 40 + compactness * 60 + bestStreak * 4;
}

// Score a single keyword term against one command. Returns 0 when no field
// matches. Field weights are deliberately title-first so exact names win.
function termScore(command, term) {
  const title = normalize(command.title);
  const subtitle = normalize(command.subtitle);
  const description = normalize(command.description);
  const keywordText = normalize([(command.keywords || []).join(" "), command.kind, command.group].join(" "));
  let score = 0;

  if (title === term) score = Math.max(score, 1000);
  else if (title.startsWith(term)) score = Math.max(score, 650);
  else if (new RegExp(`(^|[\\s\\-_:·])${escapeRegExp(term)}`).test(title)) score = Math.max(score, 520);
  else if (title.includes(term)) score = Math.max(score, 380);

  const tokens = keywordText.split(/[\s,·]+/).filter(Boolean);
  if (tokens.includes(term)) score = Math.max(score, 430);
  else if (tokens.some((token) => token.startsWith(term))) score = Math.max(score, 300);
  else if (keywordText.includes(term)) score = Math.max(score, 180);

  if (subtitle.includes(term)) score = Math.max(score, 140);
  if (description.includes(term)) score = Math.max(score, 90);

  if (!score && term.length >= 2) {
    const fuzzy = subsequenceScore(title, term);
    // Only accept a *tight* subsequence — "crm" must not fuzzy-match
    // "switch to dark mode" just because those letters appear in order.
    if (fuzzy >= 65) score = fuzzy;
  }
  return score;
}

// Every whitespace-separated term must match (AND semantics), so "crm pipeline"
// narrows results rather than widening them. A multi-word title phrase earns a
// bonus so the obvious target floats to the top.
export function scoreCommand(command, query) {
  const q = normalize(query);
  if (!q) return 0;
  const terms = q.split(" ").filter(Boolean);
  let total = 0;
  for (const term of terms) {
    const score = termScore(command, term);
    if (!score) return 0;
    total += score;
  }
  if (terms.length > 1 && normalize(command.title).includes(q)) total += 200;
  return total;
}

function defaultCompare(a, b) {
  const kindDiff = KIND_ORDER.indexOf(a.kind) - KIND_ORDER.indexOf(b.kind);
  if (kindDiff) return kindDiff;
  const orderDiff = (a.order == null ? 100 : a.order) - (b.order == null ? 100 : b.order);
  if (orderDiff) return orderDiff;
  return String(a.title).localeCompare(String(b.title));
}

// Filter + rank the command list for a query. An empty query returns the
// default ordering (members, then sections, then actions). Results are new
// objects carrying a `score` so callers can debug ranking.
export function searchCommands(commands, query, options = {}) {
  const { limit = 40 } = options;
  const list = Array.isArray(commands) ? commands : [];
  const q = normalize(query);
  if (!q) return [...list].sort(defaultCompare).slice(0, limit);
  const scored = [];
  for (const command of list) {
    const score = scoreCommand(command, q);
    if (score > 0) scored.push({ ...command, score });
  }
  scored.sort((a, b) => b.score - a.score || defaultCompare(a, b));
  return scored.slice(0, limit);
}

// Group a flat result list into ordered { group, commands } buckets — the
// palette renders a heading per group.
export function groupCommands(results) {
  const groups = [];
  const index = new Map();
  for (const command of results || []) {
    const key = command.group || "Results";
    if (!index.has(key)) {
      const bucket = { group: key, commands: [] };
      index.set(key, bucket);
      groups.push(bucket);
    }
    index.get(key).commands.push(command);
  }
  return groups;
}

// ------------------------------------------------------------------- run --

// Execute a command's default action. Dependencies are injected so the palette,
// tests and any future caller can share one dispatch without owning app state.
export function runCommand(command, deps = {}) {
  const { launchMember = null, navigate = null } = deps;
  if (!command || !command.action) return { ok: false, command: command || null, error: "no command" };
  const action = command.action;
  try {
    if (action.type === "launch") {
      if (typeof launchMember !== "function") return { ok: false, command, error: "no launcher available" };
      const result = launchMember(command.member || action.memberId) || {};
      return { ...result, command };
    }
    if (action.type === "navigate") {
      if (typeof navigate !== "function") return { ok: false, command, error: "no navigator available" };
      navigate(action.path, action.query);
      return { ok: true, command, path: action.path };
    }
    if (action.type === "invoke") {
      if (typeof action.run !== "function") return { ok: false, command, error: `action "${action.id}" has no run()` };
      const value = action.run(deps);
      return { ok: true, command, value };
    }
    return { ok: false, command, error: `unknown action "${action.type}"` };
  } catch (error) {
    return { ok: false, command, error: error && error.message ? error.message : String(error) };
  }
}
