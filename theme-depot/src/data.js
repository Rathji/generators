// Theme Depo — data layer
// Pulls the Obsidian community theme catalog and enriches it with the Obsidian Hub.

export const HUB_INFO = {
  name: "Obsidian Hub",
  url: "https://publish.obsidian.md/hub",
};

export const STORE_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-css-themes.json";
export const HUB_ACCESS_BASE = "https://publish-01.obsidian.md/access/e25082da1bfe16d54e36618cd5bfee68/";
export const HUB_PUBLIC_BASE = "https://publish.obsidian.md/hub/";
export const THEMES_DIR = "02 - Community Expansions/02.05 All Community Expansions/Themes/";
export const INDEX_NAME = "🗂️ Themes.md";

const CACHE_KEY = "themeDepo.catalog.v5";
const CACHE_TTL = 1000 * 60 * 60 * 24;

const pageCache = new Map();

function rawBase(repo) {
  return `https://raw.githubusercontent.com/${repo}/HEAD/`;
}
function encodePath(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}
function encodePathKeepSlashes(p) {
  return p.split("/").map(encodeURIComponent).join("/");
}

async function fetchText(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} · ${url}`);
  return res.text();
}

export function parseHubIndex(md) {
  const map = new Map();
  const re = /\[\[[^\]|]+\/Themes\/([^\]|]+)\|([^\]]+)\]\]/g;
  let m;
  while ((m = re.exec(md))) {
    const file = (m[1] || "").trim();
    const display = (m[2] || file).trim();
    if (file) map.set(display.toLowerCase(), { file, display });
  }
  return map;
}

export const CATEGORIES = [
  { key: "minimal",    label: "Minimal",          re: /\bminimal\b|distraction|zen|clean|simple|plain/i },
  { key: "colorful",   label: "Colorful",         re: /\bcolorful\b|\bcolourful\b|vibrant|rainbow|pastel/i },
  { key: "gruvbox",    label: "Gruvbox",          re: /\bgruvbox\b/i },
  { key: "dracula",    label: "Dracula",          re: /\bdracula\b/i },
  { key: "catppuccin", label: "Catppuccin",       re: /\bcatppuccin\b/i },
  { key: "tokyonight", label: "Tokyo Night",      re: /\btokyo\b/i },
  { key: "nord",       label: "Nord",             re: /\bnord\b|polar night|frost/i },
  { key: "solarized",  label: "Solarized",        re: /\bsolarized\b/i },
  { key: "ayu",        label: "Ayu",              re: /\bayu\b/i },
  { key: "neon",       label: "Neon / Synthwave", re: /\bneon\b|\bsynthwave\b|\bvaporwave\b|\bcyber(punk)?\b/i },
  { key: "nature",     label: "Nature",           re: /forest|evergreen|nature|\bgreen\b|ocean|\bsea\b|seafoam|seaside|seashore|\bearth\b|earthy|mountain|garden|moss|leaf|rain|desert|aurora/i },
  { key: "retro",      label: "Retro / CRT",      re: /\bretro\b|\bvintage\b|\bcrt\b|\bterminal\b|\bnokia\b|\bcasio\b/i },
  { key: "anime",      label: "Anime",            re: /\banime\b|\bmanga\b|\bkawaii\b/i },
];

export const STRUCTURAL_CATEGORIES = [
  { key: "legacy", label: "Legacy", fn: (t) => t.legacy },
  { key: "hub",    label: "Hub-documented", fn: (t) => t.inHub },
];

export function classifyTheme(t) {
  const repo = (t.repo || "").split("/").slice(1).join("/");
  const hay = `${t.name} ${repo} ${t.description || ""}`.toLowerCase();
  const cats = [];
  for (const d of CATEGORIES) if (d.re.test(hay)) cats.push(d.key);
  for (const d of STRUCTURAL_CATEGORIES) if (d.fn(t)) cats.push(d.key);
  return cats;
}

/* ---------------- quality ---------------- */

export const QUALITY_WEIGHTS = {
  popularity: 0.4,
  maintenance: 0.25,
  completeness: 0.15,
  documentation: 0.1,
  polish: 0.1,
};

export const QUALITY_LABELS = {
  popularity: "Popularity",
  maintenance: "Maintenance",
  completeness: "Completeness",
  documentation: "Documentation",
  polish: "Polish",
};

// Parse shields.io star values: "5.4k" -> 5400, "1.2m" -> 1200000, "21" -> 21.
export function parseStars(s) {
  if (s == null) return 0;
  const m = String(s).trim().match(/^([\d.]+)([km])?$/i);
  if (!m) return 0;
  const n = parseFloat(m[1]);
  const mult = m[2] ? (m[2].toLowerCase() === "k" ? 1000 : 1000000) : 1;
  return Math.round(n * mult);
}

// Parse shields.io relative ages ("last friday", "3 months ago", "yesterday") or
// absolute month forms ("december 2024", "august") into approximate days, or null
// when unparseable.
const MONTH_NAMES = { january: 0, february: 1, march: 2, april: 3, may: 4, june: 5, july: 6, august: 7, september: 8, october: 9, november: 10, december: 11 };

export function parseRelativeAge(s) {
  if (s == null) return null;
  s = String(s).trim().toLowerCase();
  const m = s.match(/^(\d+)\s*(hours?|days?|weeks?|months?|years?)( ago)?$/);
  if (m) {
    const n = +m[1];
    const unit = m[2][0];
    const days = unit === "h" ? n / 24 : unit === "d" ? n : unit === "w" ? n * 7 : unit === "m" ? n * 30 : n * 365;
    return Math.round(days);
  }
  const mm = s.match(/^([a-z]+)\s*(\d{4})?$/);
  if (mm && MONTH_NAMES[mm[1]] != null) {
    const mon = MONTH_NAMES[mm[1]];
    const now = new Date();
    const year = mm[2] ? +mm[2] : mon <= now.getMonth() ? now.getFullYear() : now.getFullYear() - 1;
    return Math.max(0, Math.round((now.getFullYear() - year) * 365 + (now.getMonth() - mon) * 30));
  }
  if (/^(just now|today)$/.test(s)) return 0;
  if (/^yesterday/.test(s)) return 1;
  if (/^last (mon|tue|wed|thu|fri|sat|sun)/.test(s)) return 3;
  if (/^last (hour|day)/.test(s)) return 1;
  if (/^last week/.test(s)) return 7;
  if (/^last month/.test(s)) return 30;
  if (/^last year/.test(s)) return 365;
  return null;
}

export function qualityGrade(score) {
  return score >= 70 ? "A" : score >= 50 ? "B" : score >= 30 ? "C" : "D";
}

// How rich a theme's hub documentation is (0.15 = undocumented, up to 1 = long,
// feature-filled page). Shared by the bulk script and the app so scores stay stable.
export function docRichness(theme) {
  if (!theme.inHub) return 0.15;
  const l = (theme.description || "").length;
  return l >= 200 ? 1 : l >= 60 ? 0.7 : l >= 30 ? 0.55 : 0.5;
}

// gh: { stars, lastCommitDays, docRichness } from src/quality.json (or partial).
// Returns { score (0-100), grade, parts, stars, lastCommitDays, hasGh }.
export function computeQuality(theme, gh = {}) {
  const stars = gh.stars != null ? gh.stars : 0;
  const age = gh.lastCommitDays != null ? gh.lastCommitDays : null;
  const hasGh = gh.stars != null || gh.lastCommitDays != null;

  const popularity = Math.min(1, Math.log10(1 + Math.max(0, stars)) / Math.log10(1001));

  let maintenance = hasGh ? 0.2 : 0.3;
  if (age != null) {
    maintenance = age <= 90 ? 1 : age <= 365 ? 0.8 : age <= 730 ? 0.55 : age <= 1100 ? 0.35 : 0.15;
  }

  const modes = theme.modes || [];
  const modeScore = modes.includes("dark") && modes.includes("light") ? 1 : modes.length ? 0.55 : 0.4;
  const completeness = 0.6 * modeScore + 0.4 * (theme.legacy ? 0 : 1);

  const documentation = gh.docRichness != null ? gh.docRichness : docRichness(theme);

  const polish = theme.screenshot ? 1 : 0;

  const parts = { popularity, maintenance, completeness, documentation, polish };
  let score = 0;
  for (const k of Object.keys(QUALITY_WEIGHTS)) score += parts[k] * QUALITY_WEIGHTS[k];
  score = Math.max(0, Math.min(100, Math.round(score * 100)));
  return { score, grade: qualityGrade(score), parts, stars, lastCommitDays: age, hasGh };
}

// Assign each theme a sub-rank within its letter grade ("A.1", "A.2", …): the
// whole catalog is ordered by quality score (desc), then GitHub stars (desc), then
// name, and within each grade the best theme gets ".1". Also ensures every theme
// has a `_quality` object. This is the canonical ranking — used by the app at
// runtime (src/app.js) and persisted into src/quality.json by src/tools/quality.js.
export function computeRanks(themes) {
  for (const t of themes) {
    if (!t.source && t.repo) {
      t.source = { type: "github", repo: t.repo, owner: t.repo.split("/")[0], url: "https://github.com/" + t.repo };
    }
    if (!t._quality) t._quality = computeQuality(t, t.gh || {});
  }
  const groups = new Map();
  for (const t of themes) {
    if (!groups.has(t._quality.grade)) groups.set(t._quality.grade, []);
    groups.get(t._quality.grade).push(t);
  }
  for (const [grade, list] of groups) {
    list.sort(compareQuality);
    list.forEach((t, i) => {
      t.rank = `${grade}.${i + 1}`;
    });
  }
  return themes;
}

// Canonical quality ordering — score (desc), then stars (desc), then name.
// Shared by computeRanks (within-grade sub-ranks) and curateCatalog (the cut).
function compareQuality(a, b) {
  const qa = a._quality;
  const qb = b._quality;
  if (qb.score !== qa.score) return qb.score - qa.score;
  const sa = qa.stars != null ? qa.stars : -1;
  const sb = qb.stars != null ? qb.stars : -1;
  if (sb !== sa) return sb - sa;
  return a.name.localeCompare(b.name);
}

export const KEEP_FRACTION = 0.25;
export const GRADE_BINS = ["A", "B", "C", "D"];

// Curation: drop the bottom (1 − keepFrac) of the catalog (the cut uses the same
// ordering as computeRanks) and re-scale letter grades for the kept set so they
// distribute evenly — the kept set is split into equal bins across GRADE_BINS
// ("A" = best quarter of the kept set, …, "D" = worst quarter), then re-sub-ranked
// A.1/A.2/… within each new grade. Dropped themes keep their full-catalog rank as
// `origRank` and are flagged `curated: "dropped"` so the app can list/download
// them. Returns { kept, dropped } (mutates the passed themes).
export function curateCatalog(themes, keepFrac = KEEP_FRACTION) {
  const sorted = themes.slice().sort(compareQuality);
  const keepCount = Math.max(1, Math.round(sorted.length * keepFrac));
  const kept = sorted.slice(0, keepCount);
  const dropped = sorted.slice(keepCount);
  for (const t of dropped) {
    t.curated = "dropped";
    t.origRank = t.rank || t._quality.grade;
  }
  const n = kept.length;
  kept.forEach((t, i) => {
    t.curated = "kept";
    const bin = Math.min(GRADE_BINS.length - 1, Math.floor((i / n) * GRADE_BINS.length));
    t._quality.grade = GRADE_BINS[bin];
  });
  const groups = new Map();
  for (const t of kept) {
    if (!groups.has(t._quality.grade)) groups.set(t._quality.grade, []);
    groups.get(t._quality.grade).push(t);
  }
  for (const [grade, list] of groups) {
    list.sort(compareQuality);
    list.forEach((t, i) => {
      t.rank = `${grade}.${i + 1}`;
    });
  }
  return { kept, dropped };
}

export function buildTheme(t, hubMap) {
  const key = (t.name || "").toLowerCase();
  const hub = hubMap.get(key) || null;
  const screenshot = t.screenshot
    ? rawBase(t.repo) + encodePathKeepSlashes(t.screenshot)
    : null;
  const repo = t.repo || "";
  const theme = {
    name: t.name,
    author: t.author || "",
    repo,
    repoUrl: "https://github.com/" + repo,
    // The canonical source of the theme (where the CSS lives). Every store
    // entry is a GitHub repo; `source` is the single place that records it.
    source: repo
      ? { type: "github", repo, owner: repo.split("/")[0], url: "https://github.com/" + repo }
      : null,
    modes: Array.isArray(t.modes) ? t.modes : [],
    legacy: !!t.legacy,
    screenshot,
    cssUrl: rawBase(t.repo) + "theme.css",
    inHub: !!hub,
    hubFile: hub ? hub.file : null,
    hubUrl: hub ? HUB_PUBLIC_BASE + encodeURIComponent(hub.file) : null,
    hubMdUrl: hub ? HUB_ACCESS_BASE + encodePath(THEMES_DIR + (hub.file.endsWith(".md") ? hub.file : hub.file + ".md")) : null,
    description: null,
  };
  theme.categories = classifyTheme(theme);
  return theme;
}

export async function loadCatalog(force = false) {
  if (!force) {
    try {
      const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
      if (cached && Array.isArray(cached.themes) && cached.themes.length && Date.now() - cached.at < CACHE_TTL) {
        return cached.themes;
      }
    } catch {}
  }
  const [storeJson, hubIndexMd] = await Promise.all([
    fetchText(STORE_URL),
    fetchText(HUB_ACCESS_BASE + encodePath(THEMES_DIR + INDEX_NAME)),
  ]);
  const store = JSON.parse(storeJson);
  const hubMap = parseHubIndex(hubIndexMd);
  const themes = store.map((t) => buildTheme(t, hubMap));
  themes.sort((a, b) => a.name.localeCompare(b.name));
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), themes }));
  } catch {}
  return themes;
}

export async function refreshCatalog() {
  try {
    localStorage.removeItem(CACHE_KEY);
  } catch {}
  return loadCatalog(true);
}

// Fallback CSS file name candidates (legacy themes sometimes name it after the theme).
export function cssCandidates(theme) {
  const base = rawBase(theme.repo);
  const slug = (theme.name || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  const snake = slug.replace(/-/g, "_");
  const out = [base + "theme.css"];
  if (slug && slug !== "theme") out.push(base + slug + ".css");
  if (snake && snake !== slug) out.push(base + snake + ".css");
  return [...new Set(out)];
}

export function parseHubPage(md) {
  let repo = null;
  let author = null;
  let modes = [];
  const repoMatch = md.match(/Repository:\s*\[GitHub\]\(https?:\/\/github\.com\/([^)\s]+)\)/i);
  if (repoMatch) repo = repoMatch[1];
  const authorMatch = md.match(/Designed by:\s*\[\[([^\]]+)\]\]/);
  if (authorMatch) author = authorMatch[1];
  const modesMatch = md.match(/Modes:\s*([^\n]+)/);
  if (modesMatch) {
    modes = (modesMatch[1].match(/\[\[[^\]|]*\|([^\]]+)\]\]/g) || [])
      .map((s) => s.match(/\|([^\]]+)\]\]$/)[1].trim().toLowerCase())
      .filter((s) => s === "dark" || s === "light");
  }

  let body = md.replace(/^---[\s\S]*?---/, "");
  const marker = "Do not edit anything above this line";
  const mi = body.indexOf(marker);
  if (mi >= 0) {
    const nl = body.indexOf("\n", mi);
    body = body.slice(nl >= 0 ? nl + 1 : mi + marker.length);
  }
  body = body
    .replace(/%%[\s\S]*?%%/g, " ")
    .replace(/<!--[\s\S]*?-->/g, " ")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, " ")
    .replace(/\[\[([^\]|]+)\|([^\]]+)\]\]/g, "$2")
    .replace(/\[\[([^\]]+)\]\]/g, "$1")
    .replace(/\[([^\]]+)\]\((?:https?:\/\/)?[^)]*\)/g, "$1")
    .replace(/#[a-z0-9/_-]+/gi, " ");

  const lines = body.split("\n").map((l) => l.trim());
  const intro = [];
  for (const l of lines) {
    if (/^##\s/.test(l)) break;
    if (l && !/^#\s/.test(l)) intro.push(l);
  }
  let description = intro.join("\n");

  const cleanText = (s) =>
    s
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/[*_>`~]/g, " ")
      .replace(/[ \t]+/g, " ")
      .trim();

  if (cleanText(description).length < 30) {
    const feat = body.match(/##\s*Features([\s\S]*?)(?=##\s|$)/);
    if (feat) {
      const bullets = feat[1]
        .split("\n")
        .map((l) => l.trim())
        .filter((l) => /^[-*]/.test(l))
        .map((l) => l.replace(/^[-*]\s*/, ""));
      if (bullets.length) description = bullets.join(" · ");
    }
  }

  description = cleanText(description).slice(0, 700);

  return { repo, author, modes, description };
}

export async function fetchHubPage(theme) {
  if (theme.description !== null) return theme;
  if (!theme.hubMdUrl) {
    theme.description = "";
    return theme;
  }
  if (pageCache.has(theme.name)) {
    theme.description = pageCache.get(theme.name);
    return theme;
  }
  try {
    const md = await fetchText(theme.hubMdUrl);
    const info = parseHubPage(md);
    theme.description = info.description || "";
    if (info.modes.length) theme.modes = info.modes;
    if (info.author) theme.authorHub = info.author;
    theme.categories = classifyTheme(theme);
    pageCache.set(theme.name, theme.description);
  } catch {
    theme.description = "";
  }
  return theme;
}
