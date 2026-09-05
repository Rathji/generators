// Theme Depo — data layer
// Pulls the Obsidian community theme catalog and enriches it with the Obsidian Hub.

export const HUB_INFO = {
  name: "Obsidian Hub",
  url: "https://publish.obsidian.md/hub",
};

const STORE_URL = "https://raw.githubusercontent.com/obsidianmd/obsidian-releases/master/community-css-themes.json";
const HUB_ACCESS_BASE = "https://publish-01.obsidian.md/access/e25082da1bfe16d54e36618cd5bfee68/";
const HUB_PUBLIC_BASE = "https://publish.obsidian.md/hub/";
const THEMES_DIR = "02 - Community Expansions/02.05 All Community Expansions/Themes/";
const INDEX_NAME = "🗂️ Themes.md";

const CACHE_KEY = "themeDepo.catalog.v3";
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

function parseHubIndex(md) {
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

function buildTheme(t, hubMap) {
  const key = (t.name || "").toLowerCase();
  const hub = hubMap.get(key) || null;
  const screenshot = t.screenshot
    ? rawBase(t.repo) + encodePathKeepSlashes(t.screenshot)
    : null;
  return {
    name: t.name,
    author: t.author || "",
    repo: t.repo,
    repoUrl: "https://github.com/" + t.repo,
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
    pageCache.set(theme.name, theme.description);
  } catch {
    theme.description = "";
  }
  return theme;
}
