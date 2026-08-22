// Perchance Archive Search — all logic lives here.
// ARCHIVE_URL is the gzip'd JSON dump of ~111k generators (name, views, lastEditTime,
// metaData.title/description/tags). To refresh the data, re-upload a newer dump and
// update this constant (and the kv cache via the "Re-download archive" button).

"use strict";

const ARCHIVE_URL = "https://user.uploads.dev/file/eff2948bf72349130432995c63f4c2e6.gz";
const CACHE_KEY = "perchance-archive-search-v1";
const MAX_RESULTS = 500;
const MAX_DISPLAY_LINES = 1500;
const MAX_DISPLAY_CHARS = 140000;

const el = (id) => document.getElementById(id);
const searchInput = el("searchInput");
const sortSelect = el("sortSelect");
const tagBarEl = el("tagBarEl");
const exportBarEl = el("exportBarEl");
const exportNoteEl = el("exportNoteEl");
const statusEl = el("statusEl");
const resultsEl = el("resultsEl");
const countEl = el("countEl");
const reloadBtn = el("reloadBtn");

let GEN = null;
let GEN_INDEX = null;
let activeTags = [];
let currentResults = [];
let inspectSources = { pjs: "", html: "" };
let inspectTab = "pjs";

const esc = (s) => String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
  ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const fmtViews = (v) => (v == null ? "0" : Number(v).toLocaleString());

function setStatus(text, spinner) {
  statusEl.innerHTML = (spinner ? '<span class="spinner"></span>' : "") + text;
}

async function gunzip(buf) {
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This browser has no DecompressionStream support — please use a recent Chrome/Edge/Firefox/Safari.");
  }
  const ds = new DecompressionStream("gzip");
  const stream = new Blob([buf]).stream().pipeThrough(ds);
  const ab = await new Response(stream).arrayBuffer();
  return new TextDecoder().decode(ab);
}

async function fetchArchive() {
  const resp = await fetch(ARCHIVE_URL);
  if (!resp.ok) throw new Error("archive download failed: HTTP " + resp.status);
  return new Uint8Array(await resp.arrayBuffer());
}

async function loadArchive(force) {
  setStatus("Loading archive…", true);
  try {
    let buf = null;
    if (!force) {
      try {
        if (root && root.kv) buf = await root.kv.archiveSearch.get(CACHE_KEY);
      } catch (e) { /* kv unavailable — fall through to fetch */ }
    }
    if (!buf || !buf.length) {
      buf = await fetchArchive();
      try {
        if (root && root.kv) await root.kv.archiveSearch.set(CACHE_KEY, buf);
      } catch (e) { /* cache write is optional */ }
    }
    const text = await gunzip(buf);
    GEN = JSON.parse(text);
    GEN_INDEX = buildIndex(GEN);
    countEl.textContent = GEN.length.toLocaleString();
    setStatus(GEN.length.toLocaleString() + " generators indexed — type to search");
    if (searchInput.value.trim()) doSearch();
  } catch (e) {
    setStatus("Couldn't load archive: " + e.message + " — try the Re-download button, or a modern browser.");
  }
}

function buildIndex(gen) {
  return gen.map((g, i) => {
    const md = g.metaData || {};
    const tags = Array.isArray(md.tags) ? md.tags.join(" ") : "";
    return {
      i,
      nameL: (g.name || "").toLowerCase(),
      titleL: (md.title || "").toLowerCase(),
      tagsL: tags.toLowerCase(),
      hay: ((g.name || "") + " " + (md.title || "") + " " + tags + " " + (md.description || "")).toLowerCase()
    };
  });
}

function doSearch() {
  const q = searchInput.value.trim().toLowerCase();
  clearTags();
  if (!GEN) return;
  if (!q) {
    resultsEl.innerHTML = '<div class="empty">Type a query to search 110k+ generators.<br><br>Try <b>gacha</b>, <b>rng</b>, <b>pity</b>, <b>idle</b>, <b>pixel</b>, <b>dungeon</b>, <b>monster</b>…</div>';
    setStatus(GEN.length.toLocaleString() + " generators indexed");
    currentResults = [];
    exportBarEl.hidden = true;
    return;
  }
  const terms = q.split(/\s+/).filter(Boolean);
  const t0 = performance.now();
  const scored = [];
  for (const g of GEN_INDEX) {
    let ok = true;
    let score = 0;
    for (const t of terms) {
      if (g.hay.includes(t)) {
        if (g.nameL.includes(t)) score += 60;
        else if (g.titleL.includes(t)) score += 25;
        else if (g.tagsL.includes(t)) score += 12;
        else score += 5;
      } else { ok = false; break; }
    }
    if (ok) {
      score += Math.log10((GEN[g.i].views || 0) + 1) * 8;
      scored.push([g, score]);
    }
  }
  const ms = Math.round(performance.now() - t0);
  const sort = sortSelect.value;
  scored.sort((a, b) => {
    if (sort === "views") return (GEN[b[0].i].views || 0) - (GEN[a[0].i].views || 0);
    if (sort === "recent") return (GEN[b[0].i].lastEditTime || 0) - (GEN[a[0].i].lastEditTime || 0);
    return b[1] - a[1];
  });
  renderResults(scored, ms, q);
}

function renderResults(scored, ms, q) {
  const total = scored.length;
  currentResults = scored;
  const shown = scored.slice(0, MAX_RESULTS);
  if (!shown.length) {
    resultsEl.innerHTML = '<div class="empty">No matches for <b>' + esc(q) + '</b>.<br>Try fewer or broader words.</div>';
  } else {
    const cards = shown.map(([g]) => {
      const raw = GEN[g.i];
      const md = raw.metaData || {};
      const tags = Array.isArray(md.tags) ? md.tags : [];
      const title = md.title || raw.name || "(untitled)";
      const desc = (md.description || "").trim() || "(no description)";
      const when = raw.lastEditTime ? new Date(raw.lastEditTime).toLocaleDateString() : "?";
      const descHtml = desc.length > 220 ? esc(desc.slice(0, 220)) + "…" : esc(desc);
      return '<div class="card">' +
        '<div class="card-top">' +
          '<a class="card-title" href="https://perchance.org/' + encodeURIComponent(raw.name) + '" target="_blank" rel="noopener">' + esc(title) + '</a>' +
          '<span class="card-slug">' + esc(raw.name) + '</span>' +
          '<button class="inspect-btn" data-name="' + esc(raw.name) + '">Inspect source</button>' +
        '</div>' +
        '<div class="card-meta">👁 ' + fmtViews(raw.views) + ' · updated ' + when + '</div>' +
        (tags.length ? '<div class="card-tags">' + tags.map((t) =>
          '<button class="tag" data-tag="' + esc(t) + '">' + esc(t) + '</button>').join("") + '</div>' : "") +
        '<div class="card-desc">' + descHtml + '</div>' +
      '</div>';
    }).join("");
    resultsEl.innerHTML = cards +
      (total > MAX_RESULTS ? '<div class="more-note">Showing top ' + MAX_RESULTS.toLocaleString() + ' of ' + total.toLocaleString() + ' matches.</div>' : "");
  }
  setStatus(total.toLocaleString() + " match" + (total === 1 ? "" : "es") + " in " + ms + " ms");
  exportBarEl.hidden = total === 0;
  exportNoteEl.textContent = total ? "Exporting all " + total.toLocaleString() + " matches (not just the " + MAX_RESULTS.toLocaleString() + " shown)." : "";
}

function clearTags() {
  activeTags = [];
  tagBarEl.hidden = true;
  tagBarEl.innerHTML = "";
}

function applyActiveTags() {
  if (!activeTags.length) return true;
  return (g) => {
    const tags = (g.metaData && g.metaData.tags) || [];
    return activeTags.every((t) => tags.includes(t));
  };
}

resultsEl.addEventListener("click", (e) => {
  const tagBtn = e.target.closest(".tag");
  if (tagBtn) {
    const t = tagBtn.dataset.tag;
    if (!activeTags.includes(t)) activeTags.push(t);
    else activeTags = activeTags.filter((x) => x !== t);
    renderTagBar();
    reRenderFromTags();
    return;
  }
  const inspectBtn = e.target.closest(".inspect-btn");
  if (inspectBtn) openInspect(inspectBtn.dataset.name);
});

function renderTagBar() {
  if (!activeTags.length) { tagBarEl.hidden = true; return; }
  tagBarEl.hidden = false;
  tagBarEl.innerHTML = '<span class="lbl">Filtering:</span>' +
    activeTags.map((t) => '<span class="chip">' + esc(t) + '<span class="x" data-x="' + esc(t) + '">✕</span></span>').join("");
}

tagBarEl.addEventListener("click", (e) => {
  const x = e.target.closest(".x");
  if (!x) return;
  activeTags = activeTags.filter((t) => t !== x.dataset.x);
  renderTagBar();
  reRenderFromTags();
});

function reRenderFromTags() {
  if (!GEN) return;
  const q = searchInput.value.trim().toLowerCase();
  const terms = q.split(/\s+/).filter(Boolean);
  const t0 = performance.now();
  const matches = [];
  for (const g of GEN_INDEX) {
    let ok = true;
    for (const t of terms) { if (!g.hay.includes(t)) { ok = false; break; } }
    if (!ok) continue;
    const raw = GEN[g.i];
    if (activeTags.length) {
      const tags = (raw.metaData && raw.metaData.tags) || [];
      if (!activeTags.every((t) => tags.includes(t))) continue;
    }
    matches.push([g, 0]);
  }
  const sort = sortSelect.value;
  matches.sort((a, b) => {
    if (sort === "views") return (GEN[b[0].i].views || 0) - (GEN[a[0].i].views || 0);
    if (sort === "recent") return (GEN[b[0].i].lastEditTime || 0) - (GEN[a[0].i].lastEditTime || 0);
    return (GEN[b[0].i].views || 0) - (GEN[a[0].i].views || 0);
  });
  renderResults(matches, Math.round(performance.now() - t0), q);
}

let searchTimer = null;
searchInput.addEventListener("input", () => {
  clearTimeout(searchTimer);
  searchTimer = setTimeout(doSearch, 120);
});

sortSelect.addEventListener("change", () => {
  if (activeTags.length) reRenderFromTags();
  else doSearch();
});

reloadBtn.addEventListener("click", async () => {
  try {
    if (root && root.kv) await root.kv.archiveSearch.delete(CACHE_KEY);
  } catch (e) { /* ignore */ }
  await loadArchive(true);
});

/* ---------- export ---------- */

function currentExportEntries() {
  return currentResults.map(([g]) => {
    const raw = GEN[g.i];
    const md = raw.metaData || {};
    return {
      name: raw.name,
      title: md.title || raw.name || "(untitled)",
      views: raw.views || 0,
      lastEditTime: raw.lastEditTime || 0,
      updated: raw.lastEditTime ? new Date(raw.lastEditTime).toLocaleDateString() : "?",
      description: (md.description || "").trim(),
      tags: Array.isArray(md.tags) ? md.tags.slice() : [],
      url: "https://perchance.org/" + encodeURIComponent(raw.name)
    };
  });
}

function buildJsonExport(entries) {
  return JSON.stringify({
    generatedBy: "Perchance Archive Search",
    query: searchInput.value.trim(),
    exportedAt: new Date().toISOString(),
    count: entries.length,
    results: entries
  }, null, 2);
}

function mdCell(s) {
  return String(s == null ? "" : s).replace(/\|/g, "\\|").replace(/\r?\n/g, " ").trim();
}

function buildMdExport(entries) {
  const q = searchInput.value.trim();
  const lines = [];
  lines.push("# Perchance Archive Search" + (q ? " — results for \"" + q + "\"" : ""));
  lines.push("");
  lines.push("_" + entries.length.toLocaleString() + " matches · exported " + new Date().toLocaleString() + "_");
  lines.push("");
  if (entries.length === 0) {
    lines.push("No matches.");
    return lines.join("\n");
  }
  lines.push("| # | Title | Slug | Views | Updated |");
  lines.push("|---:|------|------|-------:|---------|");
  entries.forEach((e, i) => {
    lines.push("| " + (i + 1) + " | [" + mdCell(e.title) + "](" + e.url + ") | " + mdCell(e.name) + " | " + e.views + " | " + mdCell(e.updated) + " |");
  });
  lines.push("");
  lines.push("## Details");
  lines.push("");
  entries.forEach((e, i) => {
    lines.push("### " + (i + 1) + ". " + mdCell(e.title));
    lines.push("");
    lines.push("- **URL:** " + e.url);
    lines.push("- **Slug:** `" + mdCell(e.name) + "`");
    lines.push("- **Views:** " + e.views + " · **Updated:** " + mdCell(e.updated));
    if (e.tags.length) lines.push("- **Tags:** " + e.tags.map((t) => "`" + mdCell(t) + "`").join(", "));
    if (e.description) lines.push("");
    if (e.description) lines.push(mdCell(e.description));
    lines.push("");
    lines.push("---");
    lines.push("");
  });
  return lines.join("\n");
}

function safeFilename(q, ext) {
  const base = (q || "all").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "search";
  return "perchance-search-" + base.slice(0, 60) + "." + ext;
}

function downloadText(filename, text, mime) {
  const blob = new Blob([text], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { a.remove(); URL.revokeObjectURL(url); }, 1000);
}

function doExportJson() {
  const text = buildJsonExport(currentExportEntries());
  const n = currentResults.length;
  downloadText(safeFilename(searchInput.value, "json"), text, "application/json");
  copyFallback(text, n);
}

function doExportMd() {
  const text = buildMdExport(currentExportEntries());
  const n = currentResults.length;
  downloadText(safeFilename(searchInput.value, "md"), text, "text/markdown");
  copyFallback(text, n);
}

function copyFallback(text, n) {
  if (!navigator.clipboard || !navigator.clipboard.writeText) {
    exportNoteEl.textContent = "Exported " + n.toLocaleString() + " results (download).";
    return;
  }
  navigator.clipboard.writeText(text).then(
    () => { exportNoteEl.textContent = "Exported " + n.toLocaleString() + " results — downloaded and copied to clipboard."; },
    () => { exportNoteEl.textContent = "Exported " + n.toLocaleString() + " results (download)."; }
  );
}

el("exportJsonBtn").addEventListener("click", doExportJson);
el("exportMdBtn").addEventListener("click", doExportMd);

/* ---------- source inspection ---------- */

async function openInspect(name) {
  const modal = el("inspectEl");
  modal.hidden = false;
  el("inspectName").textContent = name;
  el("inspectName").href = "https://perchance.org/" + encodeURIComponent(name);
  el("srcSearchInput").value = "";
  el("srcHint").textContent = "Fetching source…";
  el("srcView").textContent = "Loading…";
  inspectSources = { pjs: "", html: "" };
  inspectTab = "pjs";
  const tabs = modal.querySelectorAll(".tab-btn");
  tabs.forEach((b) => b.classList.toggle("active", b.dataset.tab === "pjs"));

  const [pjsRes, htmlRes] = await Promise.allSettled([
    fetch("https://perchance.org/api/getGeneratorsAndDependencies?generatorNames=" + encodeURIComponent(name))
      .then((r) => r.json()),
    fetch("https://perchance.org/api/getGeneratorHtml?generatorName=" + encodeURIComponent(name))
      .then((r) => r.text())
  ]);

  if (pjsRes.status === "fulfilled" && pjsRes.value && pjsRes.value.generators && pjsRes.value.generators[name]) {
    inspectSources.pjs = pjsRes.value.generators[name].code || "";
  } else {
    inspectSources.pjs = "// Couldn't fetch main.pjs (deleted generator or API error).";
  }
  if (htmlRes.status === "fulfilled") {
    inspectSources.html = htmlRes.value || "";
  } else {
    inspectSources.html = "<!-- Couldn't fetch index.html. -->";
  }

  if (inspectSources.pjs && inspectSources.pjs.trim().length < 800 && inspectSources.html.length > 5000) {
    el("srcHint").textContent = "main.pjs is short — this generator's real logic probably lives in the HTML below, or in src/ files.";
  } else {
    el("srcHint").textContent = "";
  }
  renderSource();
}

function renderSource() {
  const q = el("srcSearchInput").value.trim().toLowerCase();
  const src = inspectSources[inspectTab] || "";
  const lines = src.split("\n");
  const out = [];
  let chars = 0;
  for (let i = 0; i < lines.length; i++) {
    if (q && !lines[i].toLowerCase().includes(q)) continue;
    const line = String(i + 1).padStart(5, " ") + "  " + lines[i];
    out.push(line);
    chars += line.length;
    if (out.length >= MAX_DISPLAY_LINES || chars >= MAX_DISPLAY_CHARS) {
      out.push("… (truncated)");
      break;
    }
  }
  el("srcView").textContent = out.length
    ? out.join("\n")
    : (q ? "No matching lines." : "(empty source)");
}

el("inspectModal").querySelector(".modal-tabs").addEventListener("click", (e) => {
  const btn = e.target.closest(".tab-btn");
  if (!btn) return;
  inspectTab = btn.dataset.tab;
  el("inspectModal").querySelectorAll(".tab-btn").forEach((b) => b.classList.toggle("active", b === btn));
  renderSource();
});

el("srcSearchInput").addEventListener("input", renderSource);

function closeInspect() {
  el("inspectEl").hidden = true;
}
el("inspectClose").addEventListener("click", closeInspect);
el("inspectBackdrop").addEventListener("click", closeInspect);
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape" && !el("inspectEl").hidden) closeInspect();
});

loadArchive(false);
