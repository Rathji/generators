// Theme Depo — app controller

import { loadCatalog, refreshCatalog, fetchHubPage, HUB_INFO, CATEGORIES, STRUCTURAL_CATEGORIES, computeQuality, computeRanks, curateCatalog, KEEP_FRACTION, QUALITY_LABELS } from "./data.js";
import { fetchThemeCss, buildPreviewDoc } from "./preview.js";
import { initAdmin } from "./admin.js";

const $ = (id) => document.getElementById(id);

const MIN_SLICE_COUNT = 2;

const state = {
  themes: [],
  active: [],
  dropped: [],
  query: "",
  mode: "all",
  favOnly: false,
  slice: null,
  sort: "quality",
  favorites: new Set(),
  detail: null,
  previewMode: "dark",
  previewToken: 0,
};

let kv = null;
try {
  kv = window.root && window.root.kv ? window.root.kv : null;
} catch {
  kv = null;
}

/* ---------------- favorites ---------------- */

async function loadFavorites() {
  if (!kv) return;
  try {
    const entries = await kv.themeDepo.entries();
    for (const e of entries) {
      const k = Array.isArray(e) ? e[0] : e.key;
      if (k) state.favorites.add(k);
    }
  } catch {}
  updateFavCount();
  renderGrid();
}

async function toggleFav(name) {
  if (state.favorites.has(name)) {
    state.favorites.delete(name);
    if (kv) {
      try {
        await kv.themeDepo.delete(name);
      } catch {}
    }
  } else {
    state.favorites.add(name);
    if (kv) {
      try {
        await kv.themeDepo.set(name, true);
      } catch {}
    }
  }
  updateFavCount();
  renderGrid();
}

function updateFavCount() {
  const el = $("favCount");
  if (el) el.textContent = state.favorites.size ? String(state.favorites.size) : "";
}

/* ---------------- catalog ---------------- */

function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function filtered() {
  let list = state.active;
  const q = state.query.trim().toLowerCase();
  if (q) list = list.filter((t) => (t.name + " " + t.author).toLowerCase().includes(q));
  if (state.mode !== "all") list = list.filter((t) => t.modes.includes(state.mode));
  if (state.favOnly) list = list.filter((t) => state.favorites.has(t.name));
  if (state.slice) list = list.filter((t) => t.categories.includes(state.slice));
  list = list.slice();
  if (state.sort === "quality") {
    list.sort((a, b) => {
      const qa = qualityOf(a) || -1;
      const qb = qualityOf(b) || -1;
      if (qb !== qa) return qb - qa;
      const sa = a._quality && a._quality.stars != null ? a._quality.stars : -1;
      const sb = b._quality && b._quality.stars != null ? b._quality.stars : -1;
      if (sb !== sa) return sb - sa;
      return a.name.localeCompare(b.name);
    });
  } else {
    list.sort((a, b) =>
      state.sort === "name"
        ? a.name.localeCompare(b.name)
        : a.author.localeCompare(b.author) || a.name.localeCompare(b.name)
    );
  }
  return list;
}

function qualityOf(t) {
  return (t._quality && t._quality.score) || (t.gh ? computeQuality(t, t.gh).score : null);
}

const GITHUB_ICON =
  '<svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor" aria-hidden="true"><path d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.01 8.01 0 0 0 16 8c0-4.42-3.58-8-8-8z"/></svg>';

function initials(name) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}

/* ---------------- slicer ---------------- */

// Overlay the precomputed categories from the bulk categorization run
// (src/categories.json) onto the catalog. Falls back silently to the built-in
// lazy classifyTheme() per theme if the file is missing/unreachable.
async function applyCategoriesOverlay() {
  try {
    const res = await fetch("src/categories.json");
    if (!res.ok) return 0;
    const data = await res.json();
    const map = data && data.themes;
    if (!map) return 0;
    let applied = 0;
    for (const t of state.themes) {
      if (Array.isArray(map[t.name])) {
        t.categories = map[t.name];
        applied++;
      }
    }
    return applied;
  } catch {
    return 0;
  }
}

// Overlay the precomputed quality signals from the bulk enrichment run
// (src/quality.json) onto the catalog, caching the computed score on each theme.
// Falls back silently to static-only scoring if the file is missing.
async function applyQualityOverlay() {
  try {
    const res = await fetch("src/quality.json");
    if (!res.ok) return 0;
    const data = await res.json();
    const map = data && data.themes;
    if (!map) return 0;
    let applied = 0;
    for (const t of state.themes) {
      const g = map[t.name];
      if (g) {
        t.gh = Array.isArray(g) ? { stars: g[0], lastCommitDays: g[1], docRichness: g[2] } : g;
        t._quality = computeQuality(t, t.gh);
        applied++;
      }
    }
    return applied;
  } catch {
    return 0;
  }
}

function renderSlicer() {
  const bar = $("slicerBar");
  const chipsCtn = $("slicerChips");
  const counts = new Map();
  for (const t of state.active) {
    for (const c of t.categories) counts.set(c, (counts.get(c) || 0) + 1);
  }
  const visible = [...CATEGORIES, ...STRUCTURAL_CATEGORIES].filter((d) => counts.get(d.key) >= MIN_SLICE_COUNT);
  bar.hidden = visible.length === 0;
  chipsCtn.textContent = "";
  for (const d of visible) {
    const n = counts.get(d.key);
    const b = document.createElement("button");
    b.className = "sliceChip" + (state.slice === d.key ? " on" : "");
    b.dataset.slice = d.key;
    b.title = `${d.label} — ${n} themes`;
    b.innerHTML = `<span class="sliceLabel">${esc(d.label)}</span><span class="sliceCount">${n}</span>`;
    b.addEventListener("click", () => {
      state.slice = state.slice === d.key ? null : d.key;
      renderSlicer();
      renderGrid();
    });
    chipsCtn.appendChild(b);
  }
  $("slicerClear").hidden = !state.slice;
}

function renderGrid() {
  const grid = $("grid");
  const list = filtered();
  grid.textContent = "";
  const frag = document.createDocumentFragment();

  for (const t of list) {
    const card = document.createElement("div");
    card.className = "card";
    card.tabIndex = 0;
    card.setAttribute("role", "button");

    const badges = [];
    for (const m of t.modes) badges.push(`<span class="badge ${m === "dark" ? "dark" : "light"}">${m}</span>`);
    if (t.legacy) badges.push(`<span class="badge legacy">legacy</span>`);
    if (t.inHub) badges.push(`<span class="badge hub">hub</span>`);

    const thumb = t.screenshot
      ? `<img loading="lazy" decoding="async" src="${esc(t.screenshot)}" alt="" onerror="this.closest('.thumb').classList.add('noimg')">`
      : "";
    const thumbClass = t.screenshot ? "" : "noimg";

    const q = t._quality || (t.gh ? computeQuality(t, t.gh) : null);
    const qBadge = q && q.hasGh
      ? `<div class="qBadge ${q.grade.toLowerCase()}" title="Quality ${q.score}/100 · ${q.stars || 0} stars">${esc(t.rank || q.grade)}</div>`
      : "";

    card.innerHTML = `
      <div class="thumb ${thumbClass}">${qBadge}${thumb}<div class="thumbFallback">${esc(initials(t.name))}</div></div>
      <div class="cardBody">
        <div class="cardTitle" title="${esc(t.name)}">${esc(t.name)}</div>
        <div class="cardAuthor">by ${esc(t.author)}</div>
        <div class="cardSource" title="${t.source ? esc(t.source.url) : ""}">
          ${t.source ? `<a class="sourceLink" href="${esc(t.source.url)}" target="_blank" rel="noopener">${GITHUB_ICON}<span>${esc(t.source.repo)}</span></a>` : `<span class="sourceLink none">${GITHUB_ICON}<span>source unknown</span></span>`}
        </div>
        <div class="cardBadges">${badges.join("")}</div>
      </div>
      <div class="star ${state.favorites.has(t.name) ? "on" : ""}" title="Favorite">★</div>
    `;

    const srcLink = card.querySelector(".sourceLink");
    if (srcLink && t.source) {
      srcLink.addEventListener("click", (e) => e.stopPropagation());
    }

    const star = card.querySelector(".star");
    star.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleFav(t.name);
    });

    card.addEventListener("click", () => openDetail(t));
    card.addEventListener("keydown", (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        openDetail(t);
      }
    });

    frag.appendChild(card);
  }

  grid.appendChild(frag);
  $("emptyState").hidden = list.length > 0;
  const keptNote = state.dropped.length
    ? `top ${Math.round(KEEP_FRACTION * 100)}% of ${state.themes.length} themes`
    : `${state.themes.length} themes`;
  $("countLabel").textContent = `${list.length} of ${state.active.length} · ${keptNote}`;
  const SORT_LABELS = { name: "name", author: "author", quality: "ranking" };
  $("sortToggle").textContent = `sort: ${SORT_LABELS[state.sort] || state.sort} ↕`;
}

/* ---------------- detail ---------------- */

function formatStars(n) {
  if (n == null) return "—";
  if (n >= 1000000) return (n / 1000000).toFixed(1).replace(/\.0$/, "") + "M";
  if (n >= 1000) return (n / 1000).toFixed(1).replace(/\.0$/, "") + "k";
  return String(n);
}

function timeAgo(days) {
  if (days == null) return null;
  if (days <= 1) return "today";
  if (days < 7) return `${Math.round(days)} days ago`;
  if (days < 30) return `${Math.round(days / 7)} weeks ago`;
  if (days < 365) return `${Math.round(days / 30)} months ago`;
  const y = Math.round(days / 365);
  return `${y} year${y > 1 ? "s" : ""} ago`;
}

function renderSource(theme) {
  const body = $("sourceBody");
  const s = theme.source;
  if (!s) {
    body.innerHTML = `<div class="sourceCard none"><span class="muted">No source recorded for this theme.</span></div>`;
    return;
  }
  const authorHref = `https://github.com/${encodeURIComponent(s.owner)}`;
  const repoLabel = esc(s.repo);
  body.innerHTML = `
    <div class="sourceCard">
      <a class="sourceRepo" href="${esc(s.url)}" target="_blank" rel="noopener" title="Open ${esc(s.url)}">
        ${GITHUB_ICON}<span class="sourceRepoText">${repoLabel}</span>
      </a>
      <a class="sourceAuthor" href="${authorHref}" target="_blank" rel="noopener" title="Author's GitHub profile">
        by <span>${esc(theme.author || s.owner)}</span>
      </a>
      <div class="sourceBadges">
        <span class="badge dark">github</span>
        <span class="badge light">css</span>
      </div>
      <button class="sourceCopy chipBtn" data-url="${esc(s.url)}">Copy repo URL</button>
    </div>
  `;
  body.querySelector(".sourceCopy").addEventListener("click", async (e) => {
    const b = e.currentTarget;
    const ok = await copyText(s.url);
    b.textContent = ok ? "Copied ✓" : "Copy failed";
    setTimeout(() => (b.textContent = "Copy repo URL"), 1400);
  });
}

function renderQuality(q) {
  const body = $("qualityBody");
  const dims = ["popularity", "maintenance", "completeness", "documentation", "polish"];
  const bars = dims
    .map((k) => {
      const pct = Math.round(q.parts[k] * 100);
      return `
      <div class="qDim" title="${esc(QUALITY_LABELS[k])} — ${pct}/100">
        <span class="qDimLabel">${esc(QUALITY_LABELS[k])}</span>
        <span class="qDimBar"><span class="qDimFill" style="width:${pct}%"></span></span>
      </div>`;
    })
    .join("");
  const meta = [];
  if (q.stars != null) meta.push(`<span title="GitHub stars">★ ${formatStars(q.stars)}</span>`);
  if (q.lastCommitDays != null) meta.push(`<span title="Last GitHub commit">↻ ${timeAgo(q.lastCommitDays)}</span>`);
  const note = q.hasGh ? "" : `<div class="qNote">No GitHub stats collected yet — score is from catalog data only.</div>`;
  body.innerHTML = `
    <div class="qHead">
      <span class="qGrade ${q.grade.toLowerCase()}">${esc(q.rank || q.grade)}</span>
      <span class="qScore">${q.score}<span class="qScoreMax">/100</span></span>
      ${meta.length ? `<span class="qMeta">${meta.join(" · ")}</span>` : ""}
    </div>
    ${bars}
    ${note}
  `;
}

function openDetail(theme) {
  state.detail = theme;
  state.previewToken++;
  const token = state.previewToken;
  window.scrollTo(0, 0);

  $("gridWrap").hidden = true;
  $("detail").hidden = false;

  $("detailName").textContent = theme.name;
  $("detailAuthor").textContent = theme.author ? `by ${theme.author}` : "";

  $("asideShot").innerHTML = theme.screenshot
    ? `<img src="${esc(theme.screenshot)}" alt="${esc(theme.name)} screenshot" loading="lazy">`
    : "";

  const links = [];
  links.push(`<a href="${esc(theme.repoUrl)}" target="_blank" rel="noopener">GitHub</a>`);
  if (theme.inHub && theme.hubUrl)
    links.push(`<a href="${esc(theme.hubUrl)}" target="_blank" rel="noopener">Hub page</a>`);
  $("detailLinks").innerHTML = links.join("");

  const supportsDark = theme.modes.includes("dark");
  const supportsLight = theme.modes.includes("light");
  state.previewMode = supportsLight && !supportsDark ? "light" : "dark";
  const seg = $("modeToggle");
  seg.textContent = "";
  const mk = (label, mode) => {
    const b = document.createElement("button");
    b.textContent = label;
    b.classList.toggle("on", state.previewMode === mode);
    b.addEventListener("click", () => {
      state.previewMode = mode;
      seg.querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
      setPreviewModeClass(mode);
    });
    return b;
  };
  if (supportsDark) seg.appendChild(mk("Dark", "dark"));
  if (supportsLight) seg.appendChild(mk("Light", "light"));
  seg.hidden = !(supportsDark && supportsLight);

  const acts = $("detailActions");
  acts.textContent = "";
  const mkBtn = (label, fn, copy = false) => {
    const b = document.createElement("button");
    b.className = "actionBtn";
    b.textContent = label;
    b.addEventListener("click", async () => {
      const ok = await fn();
      if (copy) {
        b.textContent = ok ? "Copied ✓" : "Copy failed";
        setTimeout(() => (b.textContent = label), 1400);
      }
    });
    return b;
  };
  acts.appendChild(mkBtn("Copy CSS URL", () => copyText(theme.cssUrl), true));
  acts.appendChild(mkBtn("Download .css", () => downloadCss(theme)));
  acts.appendChild(
    mkBtn("Embed in HTML", () => copyText(`<link rel="stylesheet" href="${theme.cssUrl}">`), true)
  );

  const rows = [
    ["Author", esc(theme.author)],
    ["Modes", theme.modes.join(", ") || "—"],
    ["Legacy", theme.legacy ? "Yes" : "No"],
    ["In store", "Yes"],
    ["In hub", theme.inHub ? "Yes" : "No"],
    ["Repo", `<a href="${esc(theme.repoUrl)}" target="_blank" rel="noopener">${esc(theme.repo)}</a>`],
  ];
  $("infoRows").innerHTML = rows
    .map(([k, v]) => `<div class="infoRow"><span class="k">${k}</span><span class="v">${v}</span></div>`)
    .join("");

  const q = theme._quality || (theme.gh ? computeQuality(theme, theme.gh) : computeQuality(theme, {}));
  if (!theme._quality) theme._quality = q;
  q.rank = theme.rank || q.grade;
  renderSource(theme);
  renderQuality(q);

  const descText = $("descText");
  descText.className = "muted";
  descText.innerHTML = `<span class="pulseDots">Loading description from the hub…</span>`;

  $("previewFallback").hidden = true;
  $("previewFrame").hidden = false;
  $("previewStatus").textContent = "Fetching stylesheet…";

  renderPreview(theme, state.previewMode, token);
  fetchHubPage(theme).then(() => {
    if (state.detail !== theme) return;
    if (theme.description) {
      descText.className = "";
      descText.textContent = theme.description;
    } else {
      descText.className = "muted";
      descText.textContent = theme.inHub
        ? "No description on the hub page for this theme."
        : "This theme isn't documented in the hub yet.";
    }
    renderSlicer();
    if (state.slice) renderGrid();
  });
}

function closeDetail() {
  state.detail = null;
  state.previewToken++;
  $("detail").hidden = true;
  $("gridWrap").hidden = false;
  window.scrollTo(0, 0);
}

/* ---------------- preview ---------------- */

async function renderPreview(theme, mode, token) {
  try {
    const { css, url } = await fetchThemeCss(theme);
    if (token !== state.previewToken || state.detail !== theme) return;
    $("previewFrame").srcdoc = buildPreviewDoc(theme, css, mode, url);
    $("previewFallback").hidden = true;
    $("previewFrame").hidden = false;
    $("previewStatus").textContent = "";
  } catch (e) {
    if (token !== state.previewToken || state.detail !== theme) return;
    showPreviewFallback(theme);
  }
}

function setPreviewModeClass(mode) {
  const frame = $("previewFrame");
  const doc = frame.contentDocument;
  if (!doc) return;
  doc.documentElement.className = "theme-" + mode;
  doc.body.className = "theme-" + mode;
}

function showPreviewFallback(theme) {
  const frame = $("previewFrame");
  frame.hidden = true;
  const fb = $("previewFallback");
  fb.hidden = false;
  fb.innerHTML = `
    ${theme.screenshot ? `<img src="${esc(theme.screenshot)}" alt="">` : ""}
    <p class="muted">Couldn't load this theme's stylesheet (legacy themes often predate the <code>theme.css</code> convention).
    Open it on <a href="${esc(theme.repoUrl)}" target="_blank" rel="noopener">GitHub</a> to grab the CSS manually.</p>
  `;
}

/* ---------------- actions ---------------- */

async function copyText(text) {
  try {
    if (navigator.clipboard && window.isSecureContext) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {}
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    const ok = document.execCommand("copy");
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}

async function downloadCss(theme) {
  try {
    const { css } = await fetchThemeCss(theme);
    const blob = new Blob([css], { type: "text/css" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = theme.name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".css";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  } catch {
    window.open(theme.repoUrl, "_blank");
  }
}

/* ---------------- curation ---------------- */

// Drop the bottom (1 − KEEP_FRACTION) of the catalog and re-scale letter grades
// for the kept set (see curateCatalog in src/data.js). Called after ranks are
// computed; the kept set becomes the visible catalog, dropped themes are kept
// around only so the user can download them.
function applyCuration() {
  const { kept, dropped } = curateCatalog(state.themes, KEEP_FRACTION);
  state.active = kept;
  state.dropped = dropped;
  const btn = $("downloadDroppedBtn");
  if (btn) {
    btn.hidden = dropped.length === 0;
    if (dropped.length) {
      btn.textContent = `Download removed (${dropped.length})`;
      btn.title = `Download the ${dropped.length} themes removed from the curated top ${Math.round(KEEP_FRACTION * 100)}%`;
    }
  }
}

function downloadDropped() {
  const list = state.dropped.map((t) => ({
    name: t.name,
    author: t.author,
    repo: t.repo,
    source: t.source && t.source.url,
    screenshot: t.screenshot,
    modes: t.modes,
    legacy: t.legacy,
    inHub: t.inHub,
    hubUrl: t.hubUrl,
    score: t._quality && t._quality.score,
    grade: t._quality && t._quality.grade,
    rank: t.origRank || t.rank || null,
    stars: t._quality && t._quality.stars,
    lastCommitDays: t._quality && t._quality.lastCommitDays,
    categories: t.categories || [],
  }));
  const payload = {
    generatedAt: new Date().toISOString(),
    description: "Themes removed from Theme Depot's curated top 25% (the bottom 75% by quality rank).",
    total: state.themes.length,
    keptCount: state.active.length,
    removedCount: list.length,
    keepFraction: KEEP_FRACTION,
    sortedBy: "quality score (desc), GitHub stars (desc), name",
    themes: list,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "theme-depot-removed-themes.json";
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

/* ---------------- vault backup (export / import) ---------------- */

function showVaultMsg(msg, isError) {
  const el = $("vaultMsg");
  if (!el) return;
  el.textContent = msg;
  el.classList.toggle("err", !!isError);
  clearTimeout(showVaultMsg._t);
  showVaultMsg._t = setTimeout(() => {
    el.textContent = "";
  }, 5000);
}

function downloadText(filename, text, type = "text/plain") {
  const blob = new Blob([text], { type });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function favoriteDetails() {
  const byName = new Map(state.themes.map((t) => [t.name, t]));
  return [...state.favorites].map((name) => {
    const t = byName.get(name);
    return t
      ? {
          name,
          author: t.author,
          repo: t.repo,
          source: (t.source && t.source.url) || t.repoUrl,
          screenshot: t.screenshot,
          modes: t.modes,
          categories: t.categories || [],
          inHub: t.inHub,
          hubUrl: t.hubUrl,
          rank: t.rank,
          score: t._quality && t._quality.score,
          stars: t._quality && t._quality.stars,
          lastCommitDays: t._quality && t._quality.lastCommitDays,
        }
      : { name };
  });
}

function exportVaultJson() {
  const favs = favoriteDetails();
  if (!favs.length) {
    showVaultMsg("Nothing to export yet — favorite some themes first.", true);
    return;
  }
  const payload = {
    format: "theme-depot-vault",
    version: 1,
    exportedAt: new Date().toISOString(),
    favorites: favs,
  };
  const ymd = new Date().toISOString().slice(0, 10);
  downloadText(`theme-depot-favorites-${ymd}.json`, JSON.stringify(payload, null, 2), "application/json");
  showVaultMsg(`Exported ${favs.length} favorite${favs.length === 1 ? "" : "s"}.`);
}

function buildVaultMarkdown(favs) {
  const lines = [];
  lines.push("# Theme Depot — Favorites");
  lines.push(`${favs.length} theme${favs.length === 1 ? "" : "s"} · exported ${new Date().toISOString().slice(0, 10)}`);
  for (const f of favs) {
    lines.push("");
    lines.push(`## ${f.name}`);
    if (f.author) lines.push(`- **Author:** ${f.author}`);
    if (f.source) lines.push(`- **Source:** ${f.source}`);
    if (f.modes && f.modes.length) lines.push(`- **Modes:** ${f.modes.join(", ")}`);
    if (f.categories && f.categories.length) lines.push(`- **Categories:** ${f.categories.join(", ")}`);
    if (f.rank) lines.push(`- **Rank:** ${f.rank}`);
  }
  return lines.join("\n");
}

function exportVaultMarkdown() {
  const favs = favoriteDetails();
  if (!favs.length) {
    showVaultMsg("Nothing to export yet — favorite some themes first.", true);
    return;
  }
  const ymd = new Date().toISOString().slice(0, 10);
  downloadText(`theme-depot-favorites-${ymd}.md`, buildVaultMarkdown(favs), "text/markdown");
  showVaultMsg(`Exported ${favs.length} favorite${favs.length === 1 ? "" : "s"}.`);
}

function parseVaultMarkdown(text) {
  const favs = [];
  let cur = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    const h = line.match(/^##\s+(.+)$/);
    if (h) {
      cur = { name: h[1].trim() };
      favs.push(cur);
      continue;
    }
    if (!cur) continue;
    const b = line.match(/^[-*]\s+\*\*(.+?):\*\*\s*(.*)$/);
    if (b) {
      const key = b[1].toLowerCase();
      const val = b[2].trim();
      if (key === "author") cur.author = val;
      else if (key === "source") cur.source = val;
      else if (key === "modes") cur.modes = val.split(",").map((s) => s.trim()).filter(Boolean);
      else if (key === "categories") cur.categories = val.split(",").map((s) => s.trim()).filter(Boolean);
      else if (key === "rank") cur.rank = val;
    }
  }
  return favs.filter((f) => f.name);
}

async function importVaultFile(file) {
  if (!file) return;
  let text;
  try {
    text = await file.text();
  } catch {
    showVaultMsg("Couldn't read that file.", true);
    return;
  }
  let names = [];
  const lower = file.name.toLowerCase();
  if (lower.endsWith(".json") || /^\s*[[{]/.test(text)) {
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      showVaultMsg("That JSON file couldn't be parsed.", true);
      return;
    }
    const list = Array.isArray(data) ? data : data && (data.favorites || data.cards || data.themes);
    if (!Array.isArray(list)) {
      showVaultMsg("No favorites found in that JSON file.", true);
      return;
    }
    names = list
      .map((x) => (typeof x === "string" ? x : x && (x.name || x.id)))
      .filter((x) => typeof x === "string" && x);
  } else {
    names = parseVaultMarkdown(text).map((f) => f.name);
  }

  if (!kv) {
    showVaultMsg("Storage isn't available — can't save favorites.", true);
    return;
  }
  let added = 0;
  let skipped = 0;
  for (const name of names) {
    if (state.favorites.has(name)) {
      skipped++;
      continue;
    }
    state.favorites.add(name);
    try {
      await kv.themeDepo.set(name, true);
      added++;
    } catch {
      state.favorites.delete(name);
    }
  }
  updateFavCount();
  renderGrid();
  if (!added && !skipped) showVaultMsg("No themes found in that file.", true);
  else if (added) showVaultMsg(`Imported ${added} theme${added === 1 ? "" : "s"} (${skipped} already in vault).`);
  else showVaultMsg(`Imported 0 themes (${skipped} already in vault).`);
}

window.parseVaultMarkdown = parseVaultMarkdown;
window.buildVaultMarkdown = buildVaultMarkdown;
window.importVaultFile = importVaultFile;

/* ---------------- init ---------------- */

function wireEvents() {
  $("searchInput").addEventListener("input", () => {
    state.query = $("searchInput").value;
    renderGrid();
  });

  $("modeFilter").addEventListener("click", (e) => {
    const b = e.target.closest("button[data-mode]");
    if (!b) return;
    state.mode = b.dataset.mode;
    $("modeFilter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x === b));
    renderGrid();
  });

  $("favFilterBtn").addEventListener("click", () => {
    state.favOnly = !state.favOnly;
    $("favFilterBtn").classList.toggle("active", state.favOnly);
    renderGrid();
  });

  $("sortToggle").addEventListener("click", () => {
    state.sort = state.sort === "quality" ? "name" : state.sort === "name" ? "author" : "quality";
    renderGrid();
  });

  $("downloadDroppedBtn").addEventListener("click", downloadDropped);

  $("exportJsonBtn").addEventListener("click", exportVaultJson);
  $("exportMdBtn").addEventListener("click", exportVaultMarkdown);
  $("importBtn").addEventListener("click", () => $("vaultFileInput").click());
  $("vaultFileInput").addEventListener("change", async (e) => {
    const file = e.target.files && e.target.files[0];
    if (file) await importVaultFile(file);
    e.target.value = "";
  });

  $("slicerClear").addEventListener("click", () => {
    state.slice = null;
    renderSlicer();
    renderGrid();
  });

  $("refreshBtn").addEventListener("click", async () => {
    $("loadingOverlay").hidden = false;
    try {
      state.themes = await refreshCatalog();
      $("sourceLine").textContent = `${HUB_INFO.name} · ${state.themes.length} themes`;
      computeRanks(state.themes);
      renderGrid();
      renderSlicer();
      await applyCategoriesOverlay();
      await applyQualityOverlay();
      computeRanks(state.themes);
      applyCuration();
      renderGrid();
      renderSlicer();
    } catch (e) {
      showError(e);
    } finally {
      $("loadingOverlay").hidden = true;
    }
  });

  $("backBtn").addEventListener("click", closeDetail);
  $("clearFiltersBtn").addEventListener("click", () => {
    state.query = "";
    state.mode = "all";
    state.favOnly = false;
    state.slice = null;
    $("searchInput").value = "";
    $("modeFilter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.mode === "all"));
    $("favFilterBtn").classList.remove("active");
    renderSlicer();
    renderGrid();
  });
}

function showError(e) {
  $("errorMsg").textContent = String((e && e.message) || e || "Unknown error");
  $("errorOverlay").hidden = false;
}

async function init() {
  $("retryBtn").addEventListener("click", () => location.reload());
  wireEvents();
  initAdmin();
  try {
    state.themes = await loadCatalog();
    $("sourceLine").textContent = `${HUB_INFO.name} · ${state.themes.length} themes`;
    computeRanks(state.themes);
    renderGrid();
    renderSlicer();
    await applyCategoriesOverlay();
    await applyQualityOverlay();
    computeRanks(state.themes);
    applyCuration();
    renderGrid();
    renderSlicer();
  } catch (e) {
    showError(e);
  } finally {
    $("loadingOverlay").hidden = true;
  }
  await loadFavorites();
}

init();
