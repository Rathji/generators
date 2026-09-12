// ============================================================================
//  PERCHANCE OFFICE — application shell
//
//  Reads the `config` list from main.pjs and renders:
//    • a rail of apps + start page          (#/home)
//    • a windowed Desktop workspace         (#/desktop)
//    • opening an app (#/app/<key>) opens/focuses its window on the Desktop
//
//  Apps ship as modules in src/apps/ (registered in APPS below); windows are
//  managed by src/windows.js (T3) and documents by src/registry.js (T2).
// ============================================================================

import { docsApp } from "./apps/docs.js";
import { sheetsApp } from "./apps/sheets.js";
import { slidesApp } from "./apps/slides.js";
import { mailApp } from "./apps/mail.js";
import { sessionStore } from "./state.js";
import { documentRegistry } from "./registry.js";
import { windowManager } from "./windows.js";
import { fileSystem } from "./filesystem.js";

const APPS = { docs: docsApp, sheets: sheetsApp, slides: slidesApp, mail: mailApp };
const SUBTITLE = { docs: "word processor", sheets: "workbook", slides: "slide deck", mail: "inbox" };

const AC = "rgba(25,45,85,.42)";

const GLYPH = {
  home: `<svg viewBox="0 0 24 24"><rect x="3.6" y="3.6" width="7" height="7" rx="2" fill="#fff"/><rect x="13.4" y="3.6" width="7" height="7" rx="2" fill="#fff"/><rect x="3.6" y="13.4" width="7" height="7" rx="2" fill="#fff"/><rect x="13.4" y="13.4" width="7" height="7" rx="2" fill="#fff"/></svg>`,
  desktop: `<svg viewBox="0 0 24 24"><rect x="3.2" y="4" width="17.6" height="12.4" rx="2" fill="#fff"/><path fill="none" stroke="${AC}" stroke-width="1.4" stroke-linecap="round" d="M6.2 7.6h11.6M6.2 10.6h11.6M6.2 13.2h6"/><path d="M9.4 20.4h5.2L12 16.4Z" fill="#fff"/></svg>`,
  docs: `<svg viewBox="0 0 24 24"><path fill="#fff" d="M6.2 3.2h7.3l5.3 5.3v11.1a1.7 1.7 0 0 1-1.7 1.7H6.2A1.7 1.7 0 0 1 4.5 19.6V4.9a1.7 1.7 0 0 1 1.7-1.7Z"/><path fill="none" stroke="${AC}" stroke-width="1.3" stroke-linecap="round" d="M9.3 9h5.3M9.3 12h5.3M9.3 15h3.3"/></svg>`,
  sheets: `<svg viewBox="0 0 24 24"><rect x="4" y="4" width="16" height="16" rx="2.4" fill="#fff"/><path fill="none" stroke="${AC}" stroke-width="1.15" d="M9.4 4v16M14.6 4v16M4 9.4h16M4 14.6h16"/></svg>`,
  slides: `<svg viewBox="0 0 24 24"><path d="M9.7 20.2h4.6L12 16.5Z" fill="#fff"/><rect x="8.9" y="20.2" width="6.2" height="1.1" rx=".55" fill="#fff"/><rect x="3.4" y="3.8" width="17.2" height="12.6" rx="1.7" fill="#fff"/><rect x="6.4" y="13.4" width="1.9" height="2.4" rx=".5" fill="${AC}"/><rect x="8.9" y="11.5" width="1.9" height="4.3" rx=".5" fill="${AC}"/><rect x="11.4" y="14.2" width="1.9" height="1.6" rx=".5" fill="${AC}"/><rect x="15.2" y="6.6" width="3.9" height="1" rx=".5" fill="${AC}"/><rect x="15.2" y="8.5" width="2.9" height="1" rx=".5" fill="${AC}"/><rect x="15.2" y="10.4" width="2.3" height="1" rx=".5" fill="${AC}"/></svg>`,
  mail: `<svg viewBox="0 0 24 24"><rect x="3" y="5.2" width="18" height="13.6" rx="2.4" fill="#fff"/><path fill="none" stroke="${AC}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round" d="m4.6 7.2 7.4 5.3 7.4-5.3"/></svg>`,
};

const CHEV_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="m9 6 6 6-6 6"/></svg>`;
const CHECK_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M20 6 9 17l-5-5"/></svg>`;
const SEARCH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/></svg>`;
const X_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M18 6 6 18M6 6l12 12"/></svg>`;

// ── Small helpers ───────────────────────────────────────────────────────────
function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function timeAgo(ts) {
  const s = Math.max(1, Math.floor((Date.now() - ts) / 1000));
  if (s < 60) return "just now";
  const m = Math.floor(s / 60);
  if (m < 60) return m + "m ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  const d = Math.floor(h / 24);
  if (d < 7) return d + "d ago";
  return new Date(ts).toLocaleDateString();
}

/** Open a "blank" document for an app the first time it is needed. */
function ensureSessionDoc(appKey) {
  const existing = documentRegistry.find((d) => d.app === appKey);
  if (existing) return existing;
  const a = apps.find((x) => x.id === appKey);
  return documentRegistry.create({
    app: appKey,
    content: "",
    meta: { name: "Untitled " + (a ? a.name : appKey) },
  });
}

// ── Config loading (perchance list → plain objects) ─────────────────────────
let suite, brand, apps = [], recents = [];

function loadConfig() {
  const c = window.root.config;
  const scalar = (list, key, fallback) => (list[key] === undefined ? fallback : list[key]);
  suite = {
    name: scalar(c.suite, "name", "Perchance Office"),
    shortName: scalar(c.suite, "shortName", "POffice"),
    monogram: scalar(c.suite, "monogram", "P"),
    tagline: scalar(c.suite, "tagline", ""),
    homeTitle: scalar(c.suite, "homeTitle", "What will you create today?"),
    homeSub: scalar(c.suite, "homeSub", ""),
    version: scalar(c.suite, "version", ""),
  };
  brand = {
    primary: scalar(c.brand, "primary", "#0a58ca"),
    secondary: scalar(c.brand, "secondary", "#4f8ff7"),
    accent: scalar(c.brand, "accent", "#084298"),
  };
  apps = (c.apps && c.apps.selectAll ? c.apps.selectAll : [])
    .map((n) => ({
      id: n.id, name: n.name, blurb: n.blurb,
      badge: n.badge, color: n.color,
    }))
    .filter((a) => a.id && APPS[a.id]);
  recents = (c.recents && c.recents.selectAll ? c.recents.selectAll : [])
    .map((n) => ({ name: n.name, app: n.app, meta: n.meta }))
    .filter((r) => r.name && APPS[r.app]);
}

function applyTheme() {
  const s = document.documentElement.style;
  s.setProperty("--brand", brand.primary);
  s.setProperty("--brand-2", brand.secondary);
  s.setProperty("--brand-dark", brand.accent);
  document.title = suite.name;
}

// ── Shell ───────────────────────────────────────────────────────────────────
function railHTML(activeKey) {
  const item = (href, key, label, sub, extraStyle) => {
    const active = activeKey === key ? " active" : "";
    return `<a class="rail-item${active}" href="${href}"${extraStyle ? ` style="${extraStyle}"` : ""}>
      <span class="r-ic">${GLYPH[key]}</span>
      <span class="rl"><b>${label}</b><span>${sub}</span></span>
    </a>`;
  };
  const appItems = apps
    .map((a) => item(`#/app/${a.id}`, a.id, a.name, SUBTITLE[a.id], `--ac:${a.color}`))
    .join("");
  return `<aside class="rail">
    <div class="rail-head">
      <div class="logo-mark">${suite.monogram}</div>
      <div>
        <div class="rail-name">${suite.name}</div>
        <div class="rail-sub">${suite.shortName}</div>
      </div>
    </div>
    <nav class="rail-nav">
      ${item("#/home", "home", "Home", "start page")}
      ${item("#/desktop", "desktop", "Desktop", "workspace")}
      <div class="nav-label">Apps</div>
      ${appItems}
    </nav>
    <div class="rail-foot">
      <span class="version">${suite.version}</span>
      <span class="foot-glyph">${suite.monogram}</span>
    </div>
  </aside>`;
}

function render(mainHTML, activeKey, { desktop = false } = {}) {
  const appEl = document.getElementById("app");
  appEl.innerHTML = `<div class="layout">${railHTML(activeKey)}<main class="main"><div class="main-inner${desktop ? " desktop-mode" : ""}">${mainHTML}</div></main></div>`;
  window.scrollTo(0, 0);
}

// ── Home / start page ───────────────────────────────────────────────────────
function homeHTML() {
  const tiles = apps
    .map(
      (a) => `<a class="app-tile" href="#/app/${a.id}" style="--c:${a.color}" data-lbl="${(a.name + " " + a.blurb).toLowerCase()}">
      <span class="tile-ic">${GLYPH[a.id]}</span>
      <span class="tile-body">
        <span class="tile-title">${a.name}<span class="tile-badge">${a.badge}</span></span>
        <span class="tile-desc">${a.blurb}</span>
      </span>
      <span class="tile-go">${CHEV_SVG}</span>
    </a>`
    )
    .join("");

  // Recent files: prefer the real saved files (T13/T14); fall back to the
  // static demo list from config when nothing has been saved yet.
  const savedFiles = fileSystem.list().sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 8);
  const useSavedFiles = savedFiles.length > 0;
  const recentRows = useSavedFiles
    ? savedFiles
        .map((f) => {
          const a = apps.find((x) => x.id === f.app) || { name: f.app, color: "var(--brand)" };
          return `<button type="button" class="recent-row" data-file="${esc(f.id)}" data-lbl="${(f.name + " " + a.name).toLowerCase()}" style="--c:${a.color}" title="Open ${esc(f.name)}">
          <span class="rec-ic">${GLYPH[f.app] || GLYPH.home}</span>
          <span class="rec-name">${esc(f.name)}</span>
          <span class="rec-meta">${esc(a.name)} · ${timeAgo(f.updatedAt)}</span>
          <span class="rec-go">${CHEV_SVG}</span>
        </button>`;
        })
        .join("")
    : recents.length
      ? recents
          .map((r) => {
            const a = apps.find((x) => x.id === r.app);
            return `<a class="recent-row" href="#/app/${r.app}" style="--c:${a.color}" data-lbl="${(r.name + " " + a.name).toLowerCase()}">
          <span class="rec-ic">${GLYPH[r.app]}</span>
          <span class="rec-name">${r.name}</span>
          <span class="rec-meta">${a.name} · ${r.meta}</span>
          <span class="rec-go">${CHEV_SVG}</span>
        </a>`;
          })
          .join("")
      : `<div class="recents-empty">No recent files yet — open an app and start creating.</div>`;

  return `
    <section class="hero">
      <span class="hero-eyebrow">${suite.name} · runs entirely in your browser</span>
      <h1>${suite.homeTitle}</h1>
      <p>${suite.tagline} ${suite.homeSub}</p>
      <div class="search-row">
        ${SEARCH_SVG}
        <input id="appSearch" type="search" placeholder="Find an app or recent file…" autocomplete="off">
        <kbd>/</kbd>
      </div>
    </section>

    <section class="sec">
      <div class="sec-head">
        <div>
          <h2 class="sec-title">Your apps</h2>
          <p class="sec-sub">Four suites, one home — click a tile to open it in a window.</p>
        </div>
      </div>
      <div class="app-grid">${tiles}</div>
    </section>

    <section class="sec">
      <div class="sec-head">
        <div>
          <h2 class="sec-title">Recent files</h2>
          <p class="sec-sub">${useSavedFiles ? "Your saved files — open one to keep working." : "Jump back into your latest work (demo list from main.pjs → config → recents)."}</p>
        </div>
      </div>
      <div class="recent-card" id="recentCard">${recentRows}</div>
    </section>

    <p class="open-summary">${documentRegistry.count()} document${documentRegistry.count() === 1 ? "" : "s"} open across the suite — tracked by the document registry.</p>

    <div class="foot-note">Framework seed — every app ships as its own module under <code>src/apps/</code> and registers in <code>src/office.js</code>.</div>`;
}

let homeKeyHooked = false;

function wireHome() {
  const input = document.getElementById("appSearch");
  if (!input) return;
  input.addEventListener("input", () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll(".app-tile, .recent-row").forEach((el) => {
      el.classList.toggle("hidden", !!q && !el.dataset.lbl.includes(q));
    });
  });
  // Open real saved files straight from the home recents list.
  document.querySelectorAll(".recent-row[data-file]").forEach((row) => {
    row.addEventListener("click", () => {
      const f = fileSystem.get(row.dataset.file);
      if (f) openFile(f);
    });
  });
  if (homeKeyHooked) return;
  homeKeyHooked = true;
  // "/" focuses the home search — attach once, resolve the live input each time.
  document.addEventListener("keydown", (e) => {
    if (e.key !== "/") return;
    const el = document.getElementById("appSearch");
    if (!el) return;
    const tag = document.activeElement ? document.activeElement.tagName : "";
    if (document.activeElement !== el && !/^(INPUT|TEXTAREA)$/.test(tag)) {
      e.preventDefault();
      el.focus();
    }
  });
}

// ── App body (shared content rendered inside a window) ──────────────────────
function appBodyHTML(key) {
  const a = apps.find((x) => x.id === key);
  const mod = APPS[key];
  const openDocs = documentRegistry.listByApp(key);
  const odChips = openDocs.length
    ? openDocs
        .map(
          (d) =>
            `<span class="od-chip"><span class="od-name">${esc(d.meta.name || "Untitled")}</span><span class="od-id">${esc(d.id.slice(0, 8))}</span><span class="od-time">${timeAgo(d.updatedAt)}</span></span>`
        )
        .join("")
    : `<span class="od-empty">No documents open yet.</span>`;
  const roadItems = mod.roadmap.map((t) => `<li class="road-item">${CHECK_SVG}<span>${t}</span></li>`).join("");
  const files = [
    { path: mod.mountFile, sub: "this app's metadata + roadmap — grows its render() here" },
    { path: "src/office.js", sub: "shell, router & registry (line ~12: APPS)" },
    { path: "src/office.css", sub: "theme & shared components" },
    { path: "main.pjs", sub: "suite config — apps, colors, recents" },
  ].map((f) => `<li class="file-item"><code>${f.path}</code><span>${f.sub}</span></li>`).join("");
  const hints = mod.seedHints.map((t) => `<li class="road-item"><span class="mini-ic">${CHECK_SVG}</span><span>${t}</span></li>`).join("");

  return `
    <div class="open-docs">
      <span class="od-title">Open documents</span>
      <div class="od-row">${odChips}</div>
    </div>

    <div class="ws-zone">
      <span class="tile-ic" style="--c:${a.color}">${GLYPH[key]}</span>
      <div class="ws-name">${a.name} workspace</div>
      <p class="ws-note">${mod.workspaceNote}</p>
      <span class="ws-tag">empty stage — app build lands next</span>
    </div>

    <div class="cards-grid">
      <section class="card">
        <h3><span class="mini-ic">${GLYPH[key]}</span>${mod.roadTitle}</h3>
        <p>Capabilities planned for this app. Each is a work unit — tackle one at a time inside this module.</p>
        <ul class="road-list">${roadItems}</ul>
      </section>
      <section class="card">
        <h3><span class="mini-ic">${CHECK_SVG}</span>Project structure</h3>
        <p>Where the pieces live, and how to start the build.</p>
        <ul class="file-list">${files}</ul>
        <div class="tip-note">
          <b>Start here:</b> give <code>${mod.mountFile}</code> a <code>render()</code> that replaces the
          workspace zone above with real app chrome, then register any toolbar commands it needs.
        </div>
        <ul class="road-list" style="margin-top:10px">${hints}</ul>
      </section>
    </div>`;
}

// ── Desktop / window manager UI ─────────────────────────────────────────────
let desktopHooked = false;

/** Keep the desktop in sync with windowManager changes, even when they happen
 *  outside the router (e.g. programmatic open/close while already on desktop). */
function hookDesktopEvents() {
  if (desktopHooked) return;
  desktopHooked = true;
  windowManager.on((e) => {
    if ((e.type === "open" || e.type === "close") && location.hash === "#/desktop") {
      renderDesktop();
    }
  });
  fileSystem.on(() => {
    if (location.hash === "#/desktop" && document.querySelector(".fs-side")) refreshSidebar();
  });
  let winClampT;
  window.addEventListener("resize", () => {
    if (location.hash !== "#/desktop") return;
    clearTimeout(winClampT);
    const apply = () => {
      document.querySelectorAll(".desk-win").forEach((el) => {
        const w = el.dataset.id && windowManager.get(el.dataset.id);
        if (w) applyWinStyle(el, w);
      });
    };
    requestAnimationFrame(apply);
    winClampT = setTimeout(apply, 150);
  });
  if (window.ResizeObserver) {
    new ResizeObserver(() => {
      if (location.hash !== "#/desktop") return;
      document.querySelectorAll(".desk-win").forEach((el) => {
        const w = el.dataset.id && windowManager.get(el.dataset.id);
        if (w) applyWinStyle(el, w);
      });
    }).observe(document.body);
  }
}

function openAppWindow(appKey) {
  const doc = ensureSessionDoc(appKey);
  const existing = windowManager.list().find((w) => w.docId === doc.id);
  if (existing) {
    windowManager.focus(existing.id);
  } else {
    const a = apps.find((x) => x.id === appKey);
    windowManager.open({ docId: doc.id, app: appKey, title: doc.meta.name || a.name });
  }
}

function desktopActiveKey() {
  const a = windowManager.getActive();
  return a ? a.app : "desktop";
}

function renderDesktop() {
  render(desktopHTML(), desktopActiveKey(), { desktop: true });
  wireDesktop();
  return desktopActiveKey();
}

// ── File explorer sidebar (T13) + file naming (T14) ─────────────────────────
const FILES_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2Z"/></svg>`;
const PENCIL_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.8 2.8 0 0 1 4 4L7.5 20.5 2 22l1.5-5.5Z"/></svg>`;
const TRASH_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14"/></svg>`;
const PLUS_SVG = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M12 5v14M5 12h14"/></svg>`;

function showToast(msg) {
  let t = document.querySelector(".toast");
  if (!t) {
    t = document.createElement("div");
    t.className = "toast";
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add("show");
  clearTimeout(t._tm);
  t._tm = setTimeout(() => t.classList.remove("show"), 2400);
}

function fileRowHTML(file) {
  return `<div class="fs-row" data-id="${file.id}">
    <button type="button" class="fs-open" title="Open ${esc(file.name)}">${esc(file.name)}</button>
    <span class="fs-time">${timeAgo(file.updatedAt)}</span>
    <button type="button" class="fs-act fs-rename" title="Rename" aria-label="Rename ${esc(file.name)}">${PENCIL_SVG}</button>
    <button type="button" class="fs-act fs-del" title="Delete" aria-label="Delete ${esc(file.name)}">${TRASH_SVG}</button>
  </div>`;
}

function fileSidebarHTML() {
  const activeWin = windowManager.getActive();
  const groups = apps
    .map((a) => {
      const files = fileSystem.listByApp(a.id);
      return { a, files };
    })
    .filter((g) => g.files.length);
  const body = groups.length
    ? groups
        .map(
          (g) => `<div class="fs-group">
        <div class="fs-group-head"><span class="fs-ic" style="--ac:${g.a.color}">${GLYPH[g.a.id]}</span><span class="fs-group-name">${g.a.name}</span><span class="fs-count">${g.files.length}</span></div>
        ${g.files.map(fileRowHTML).join("")}
      </div>`
        )
        .join("")
    : `<div class="fs-empty">
        <div class="fs-empty-ic">${SEARCH_SVG}</div>
        <p>No saved files yet.</p>
        <p class="fs-empty-sub">Open a window, then press <b>Save…</b> to store it here.</p>
      </div>`;
  const canSave = !!(activeWin && activeWin.docId && documentRegistry.get(activeWin.docId));
  return `<aside class="fs-side">
    <div class="fs-head">
      <span class="fs-title">Files</span>
      <button type="button" class="fs-save btn btn-primary" ${canSave ? "" : "disabled"} title="${canSave ? "Save the active window as a file" : "Open a window first"}" data-save>${PLUS_SVG} Save…</button>
    </div>
    <div class="fs-body">${body}</div>
  </aside>`;
}

function refreshSidebar() {
  const side = document.querySelector(".fs-side");
  if (!side) return;
  side.outerHTML = fileSidebarHTML();
  wireFileSidebar();
  const count = document.querySelector(".desk-count");
  if (count) {
    const n = windowManager.count();
    const f = fileSystem.count();
    count.textContent = n + " window" + (n === 1 ? "" : "s") + " open · " + f + " saved file" + (f === 1 ? "" : "s");
  }
}

/** Open a saved file into the workspace: reuse its open window/doc if one is
 *  already showing it, otherwise create a fresh registry doc + window. */
function openFile(file) {
  const linked = documentRegistry.find((d) => d.meta && d.meta.fileId === file.id);
  const existingWin = linked ? windowManager.list().find((w) => w.docId === linked.id) : null;
  let doc;
  if (linked) {
    doc = linked;
  } else {
    doc = documentRegistry.create({
      app: file.app,
      content: file.content,
      meta: { name: file.name, fileId: file.id },
    });
  }
  if (existingWin) {
    windowManager.focus(existingWin.id);
  } else {
    windowManager.open({ docId: doc.id, app: file.app, title: file.name });
  }
  if (location.hash !== "#/desktop") location.hash = "#/desktop";
  else {
    renderDesktop();
    showToast("Opened " + file.name);
  }
}

/** Save the active window's document as a named file (upsert by name). */
function saveActiveWindow() {
  const win = windowManager.getActive();
  const doc = win && win.docId ? documentRegistry.get(win.docId) : null;
  if (!win || !doc) {
    showToast("Open a window to save it.");
    return;
  }
  const a = apps.find((x) => x.id === doc.app) || { name: doc.app };
  const suggested = doc.meta.name || "Untitled " + a.name;
  const side = document.querySelector(".fs-side");
  if (!side) return;
  const btn = side.querySelector(".fs-save");
  const form = document.createElement("div");
  form.className = "fs-save-form";
  form.innerHTML = `<input class="fs-save-name" type="text" maxlength="120" placeholder="File name…" value="${esc(suggested)}" aria-label="File name">
    <button type="button" class="fs-save-ok btn btn-primary">Save</button>
    <button type="button" class="fs-save-x btn">Cancel</button>`;
  btn.replaceWith(form);
  const input = form.querySelector(".fs-save-name");
  const commit = () => {
    const name = input.value.trim();
    if (!name) {
      showToast("A file needs a name.");
      input.focus();
      return;
    }
    const res = fileSystem.saveAs({ app: doc.app, name, content: doc.content, meta: { name } });
    if (!res.ok) {
      showToast("Could not save: " + res.error + ".");
      return;
    }
    documentRegistry.update(doc.id, { meta: { name: res.file.name, fileId: res.file.id } });
    showToast(res.created ? "Saved " + res.file.name : "Updated " + res.file.name);
    refreshSidebar();
  };
  form.querySelector(".fs-save-ok").addEventListener("click", commit);
  form.querySelector(".fs-save-x").addEventListener("click", refreshSidebar);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") commit();
    else if (e.key === "Escape") refreshSidebar();
  });
  input.focus();
  input.select();
}

function wireFileSidebar() {
  const side = document.querySelector(".fs-side");
  if (!side) return;
  const saveBtn = side.querySelector(".fs-save");
  if (saveBtn) saveBtn.addEventListener("click", saveActiveWindow);

  side.addEventListener("click", (e) => {
    const row = e.target.closest(".fs-row");
    if (!row) return;
    const id = row.dataset.id;
    const file = fileSystem.get(id);
    if (!file) return;
    if (e.target.closest(".fs-open")) {
      openFile(file);
      const fsSide = document.querySelector(".fs-side");
      if (fsSide) fsSide.classList.remove("open");
      const fsToggle = document.querySelector(".fs-toggle");
      if (fsToggle) fsToggle.classList.remove("open");
      return;
    }
    if (e.target.closest(".fs-del")) {
      if (row.classList.contains("confirm")) {
        fileSystem.remove(id);
        showToast("Deleted " + file.name);
      } else {
        row.classList.add("confirm");
        row.querySelector(".fs-del").title = "Click again to delete";
        const reset = () => {
          row.classList.remove("confirm");
          row.querySelector(".fs-del").title = "Delete";
          clearTimeout(row._resetTm);
        };
        row._resetTm = setTimeout(reset, 2600);
      }
      return;
    }
    if (e.target.closest(".fs-rename")) {
      startRename(row, file);
    }
  });
}

/** Swap a row's name into an inline editor; Enter/blur commits, Esc cancels. */
function startRename(row, file) {
  const openBtn = row.querySelector(".fs-open");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "fs-rename-input";
  input.maxLength = 120;
  input.value = file.name;
  input.setAttribute("aria-label", "New name");
  openBtn.replaceWith(input);
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const name = input.value.trim();
      const res = fileSystem.rename(file.id, name);
      if (!res.ok) {
        showToast(res.error === "duplicate" ? "A file named \u201C" + name + "\u201D already exists." : "A file needs a name.");
        input.focus();
        done = false;
        return;
      }
      if (res.renamed) {
        const doc = documentRegistry.find((d) => d.meta && d.meta.fileId === file.id);
        if (doc) documentRegistry.update(doc.id, { meta: { name: res.file.name } });
        showToast("Renamed to " + res.file.name);
      }
    }
    refreshSidebar();
  };
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") finish(true);
    else if (e.key === "Escape") finish(false);
    e.stopPropagation();
  });
  input.addEventListener("blur", () => finish(true));
  input.focus();
  input.select();
}

function desktopHTML() {
  const wins = windowManager.list();
  const empty = !wins.length
    ? `<div class="desk-empty">
        <div class="logo-mark">${suite.monogram}</div>
        <h2>No windows open</h2>
        <p>Open an app from Home or the sidebar and it appears here as a window.</p>
        <a class="btn btn-primary" href="#/home">Go to Home</a>
      </div>`
    : "";
  const html = wins
    .map((w) => {
      const a = apps.find((x) => x.id === w.app) || { color: "var(--brand)", badge: "" };
      const active = windowManager.getActive() && windowManager.getActive().id === w.id;
      const mod = APPS[w.app];
      const body = mod && mod.mount
        ? `<div class="win-body app-surface" data-app="${w.app}"></div>`
        : `<div class="win-body">${appBodyHTML(w.app)}</div>`;
      return `<section class="desk-win${active ? " active" : ""}" id="win-${w.id}" data-id="${w.id}" style="z-index:${w.z}">
      <header class="win-bar" title="Drag to move">
        <span class="win-ic" style="--ac:${a.color}">${GLYPH[w.app]}</span>
        <span class="win-title">${esc(w.title)}</span>
        ${a.badge ? `<span class="win-sub">${a.badge}</span>` : ""}
        <span class="win-spacer"></span>
        <button class="win-btn win-close" title="Close window" aria-label="Close window">${X_SVG}</button>
      </header>
      ${body}
    </section>`;
    })
    .join("");
  return `<div class="desktop">
    ${fileSidebarHTML()}
    <div class="desk-main">
      <div class="desk-bar">
        <button type="button" class="fs-toggle" aria-label="Toggle files panel" title="Files">${FILES_SVG}<span>Files</span></button>
        <span class="desk-title">Workspace</span>
        <span class="desk-count">${wins.length} window${wins.length === 1 ? "" : "s"} open · ${fileSystem.count()} saved file${fileSystem.count() === 1 ? "" : "s"}</span>
      </div>
      <div class="desk-layer">${wins.length ? html : empty}</div>
    </div>
  </div>`;
}

function wireDesktop() {
  wireFileSidebar();
  const layer = document.querySelector(".desk-layer");
  if (!layer) return;
  const fsToggle = document.querySelector(".fs-toggle");
  const fsSide = document.querySelector(".fs-side");
  if (fsToggle && fsSide) {
    fsToggle.addEventListener("click", () => {
      fsSide.classList.toggle("open");
      fsToggle.classList.toggle("open", fsSide.classList.contains("open"));
    });
  }
  document.querySelectorAll(".desk-win").forEach((el) => {
    const id = el.dataset.id;
    el.addEventListener("pointerdown", () => focusWindow(id));
    const bar = el.querySelector(".win-bar");
    if (bar) {
      bar.addEventListener("pointerdown", (e) => {
        if (e.target.closest(".win-btn")) return;
        startDrag(id, el, e);
      });
    }
    const closeBtn = el.querySelector(".win-close");
    if (closeBtn) {
      closeBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        closeWindow(id);
      });
    }
    applyWinStyle(el, windowManager.get(id));
  });
  mountAppSurfaces();
}

/** Mount real app surfaces (apps that ship a mount()) inside their windows. */
function mountAppSurfaces() {
  document.querySelectorAll(".app-surface").forEach((el) => {
    const key = el.dataset.app;
    const mod = APPS[key];
    if (!mod || typeof mod.mount !== "function") return;
    if (el._cleanup) {
      try { el._cleanup(); } catch { /* ignore */ }
      el._cleanup = null;
    }
    const win = el.closest(".desk-win");
    const winId = win && win.dataset.id;
    const w = winId ? windowManager.get(winId) : null;
    const doc = w && w.docId ? documentRegistry.get(w.docId) : null;
    const a = apps.find((x) => x.id === key) || { color: "var(--brand)" };
    try {
      const cleanup = mod.mount(el, { win: w, doc, apps, app: a, glyph: GLYPH[key] });
      if (typeof cleanup === "function") el._cleanup = cleanup;
    } catch (err) {
      console.error("mountAppSurfaces(" + key + ") failed:", err);
      el.innerHTML = `<div class="win-body"><div class="ws-zone"><p class="ws-note">The ${key} app failed to start.</p></div></div>`;
    }
  });
}

function applyWinStyle(el, w) {
  if (!w) return;
  const layer = document.querySelector(".desk-layer");
  const maxW = layer ? layer.clientWidth - 16 : 800;
  const maxH = layer ? layer.clientHeight - 16 : 600;
  const width = Math.min(w.w, maxW);
  const height = Math.min(w.h, maxH);
  const lw = layer ? layer.clientWidth : 800;
  const lh = layer ? layer.clientHeight : 600;
  const left = Math.min(Math.max(8, w.x), Math.max(8, lw - width - 8));
  const top = Math.min(Math.max(8, w.y), Math.max(8, lh - height - 8));
  el.style.left = left + "px";
  el.style.top = top + "px";
  el.style.width = width + "px";
  el.style.height = height + "px";
  el.style.zIndex = w.z;
}

function focusWindow(id) {
  const w = windowManager.get(id);
  if (!w) return;
  const active = windowManager.getActive();
  if (active && active.id === id) return;
  windowManager.focus(id);
  document.querySelectorAll(".desk-win.active").forEach((x) => x.classList.remove("active"));
  const el = document.getElementById("win-" + id);
  if (el) {
    el.classList.add("active");
    applyWinStyle(el, w);
  }
}

function closeWindow(id) {
  if (windowManager.close(id)) {
    renderDesktop();
  }
}

function startDrag(id, el, e) {
  const w = windowManager.get(id);
  if (!w) return;
  e.preventDefault();
  const layer = document.querySelector(".desk-layer");
  if (!layer) return;
  const lrect = layer.getBoundingClientRect();
  const rect = el.getBoundingClientRect();
  const dx = e.clientX - rect.left;
  const dy = e.clientY - rect.top;
  const maxX = Math.max(0, layer.clientWidth - 80);
  const maxY = Math.max(0, layer.clientHeight - 40);
  const move = (ev) => {
    const x = Math.min(Math.max(8, ev.clientX - dx - lrect.left), maxX);
    const y = Math.min(Math.max(8, ev.clientY - dy - lrect.top), maxY);
    windowManager.move(id, x, y);
    el.style.left = x + "px";
    el.style.top = y + "px";
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// ── Router ──────────────────────────────────────────────────────────────────
function route() {
  const raw = (location.hash || "#/home").replace(/^#\/?/, "");
  const m = raw.match(/^app\/([a-z]+)$/);
  let activeKey;
  let lastRoute = "#/home";
  if (raw === "desktop") {
    activeKey = renderDesktop();
    lastRoute = "#/desktop";
  } else if (m && APPS[m[1]]) {
    openAppWindow(m[1]);
    if (location.hash !== "#/desktop") {
      location.hash = "#/desktop";
      return; // hashchange will re-route into the desktop branch
    }
    activeKey = renderDesktop();
    lastRoute = "#/desktop";
  } else {
    render(homeHTML(), "home");
    wireHome();
    activeKey = "home";
  }
  sessionStore.set("lastRoute", lastRoute);
  sessionStore.set("lastVisitedAt", Date.now());
}

// ── Boot ────────────────────────────────────────────────────────────────────
function boot() {
  loadConfig();
  applyTheme();
  hookDesktopEvents();
  window.addEventListener("hashchange", route);
  const saved = sessionStore.get("lastRoute");
  if (saved && saved !== "#/home") {
    const m = String(saved).match(/^#\/app\/([a-z]+)$/);
    if (m && APPS[m[1]]) {
      if (location.hash !== saved) {
        location.hash = saved; // fires hashchange -> route()
      } else {
        route();
      }
      return;
    }
    if (String(saved) === "#/desktop") {
      if (location.hash !== "#/desktop") {
        location.hash = "#/desktop";
      } else {
        route();
      }
      return;
    }
  }
  route();
}

if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", boot);
else boot();
