// Theme Depo — app controller

import { loadCatalog, refreshCatalog, fetchHubPage, HUB_INFO } from "./data.js";
import { fetchThemeCss, buildPreviewDoc } from "./preview.js";

const $ = (id) => document.getElementById(id);

const state = {
  themes: [],
  query: "",
  mode: "all",
  favOnly: false,
  sort: "name",
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
  let list = state.themes;
  const q = state.query.trim().toLowerCase();
  if (q) list = list.filter((t) => (t.name + " " + t.author).toLowerCase().includes(q));
  if (state.mode !== "all") list = list.filter((t) => t.modes.includes(state.mode));
  if (state.favOnly) list = list.filter((t) => state.favorites.has(t.name));
  list = list.slice();
  list.sort((a, b) =>
    state.sort === "name"
      ? a.name.localeCompare(b.name)
      : a.author.localeCompare(b.author) || a.name.localeCompare(b.name)
  );
  return list;
}

function initials(name) {
  return name
    .split(/\s+/)
    .map((w) => w[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
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
      ? `<img loading="lazy" decoding="async" src="${esc(t.screenshot)}" alt="" onerror="this.remove()">`
      : "";

    card.innerHTML = `
      <div class="thumb">${thumb}<div class="thumbFallback">${esc(initials(t.name))}</div></div>
      <div class="cardBody">
        <div class="cardTitle" title="${esc(t.name)}">${esc(t.name)}</div>
        <div class="cardAuthor">by ${esc(t.author)}</div>
        <div class="cardBadges">${badges.join("")}</div>
      </div>
      <div class="star ${state.favorites.has(t.name) ? "on" : ""}" title="Favorite">★</div>
    `;

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
  $("countLabel").textContent = `${list.length} of ${state.themes.length} themes`;
  $("sortToggle").textContent = `sort: ${state.sort} ↕`;
}

/* ---------------- detail ---------------- */

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
    state.sort = state.sort === "name" ? "author" : "name";
    renderGrid();
  });

  $("refreshBtn").addEventListener("click", async () => {
    $("loadingOverlay").hidden = false;
    try {
      state.themes = await refreshCatalog();
      $("sourceLine").textContent = `${HUB_INFO.name} · ${state.themes.length} themes`;
      renderGrid();
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
    $("searchInput").value = "";
    $("modeFilter").querySelectorAll("button").forEach((x) => x.classList.toggle("on", x.dataset.mode === "all"));
    $("favFilterBtn").classList.remove("active");
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
  try {
    state.themes = await loadCatalog();
    $("sourceLine").textContent = `${HUB_INFO.name} · ${state.themes.length} themes`;
    renderGrid();
  } catch (e) {
    showError(e);
  } finally {
    $("loadingOverlay").hidden = true;
  }
  await loadFavorites();
}

init();
