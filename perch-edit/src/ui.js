import { store, bus, schedulePersist, problemsCount } from "./store.js";
import * as editor from "./editor.js";
import * as lint from "./lint.js";
import * as history from "./history.js";
import * as diff from "./diff.js";
import * as zip from "./zip.js";
import * as share from "./share.js";
import * as scratch from "./scratch.js";
import * as keyb from "./keybindings.js";

const $ = (sel) => document.querySelector(sel);

const ICONS = {
  files: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  search: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="11" cy="11" r="7"/><path d="m16.5 16.5 5 5"/></svg>',
  scm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="6" cy="4" r="2"/><circle cx="6" cy="20" r="2"/><circle cx="18" cy="14" r="2"/><path d="M6 6v12M6 12h8a4 4 0 0 1 4 2"/></svg>',
  run: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M8 5.5v13l11-6.5z"/></svg>',
  ext: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 2.5 21 7.5v9l-9 5-9-5v-9z"/><path d="M12 2.5v19M3 7.5l9 5 9-5"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/></svg>',
  folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
  folderOpen: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 8a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v3H3z"/><path d="M3 11h7l3 3h8"/></svg>',
  file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M7 3h7l5 5v12a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1z"/><path d="M14 3v5h5"/></svg>',
  chevron: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6 4l4 4-4 4z"/></svg>',
  newFile: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/></svg>',
  newFolder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><path d="M12 11v6M9 14h6"/></svg>',
  collapse: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M2 3h12v1H2zm0 5h8V7H2zm0 4h5v-1H2z"/></svg>',
  chevLeft: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M10.5 3.5 6 8l4.5 4.5z"/></svg>',
  more: '<svg viewBox="0 0 16 16" fill="currentColor"><circle cx="3" cy="8" r="1.7"/><circle cx="8" cy="8" r="1.7"/><circle cx="13" cy="8" r="1.7"/></svg>',
  branch: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3a2 2 0 1 0-3 1.7V11.3A2 2 0 1 0 5 11V6.9a4 4 0 0 0 4 0v1.4a2 2 0 1 0 1 1.7V6A2 2 0 0 0 8 4H5zm-2 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 12a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm11-3a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 12.5 2.2 8.2l1.4-1.4 2.9 2.9 5.9-5.9 1.4 1.4z"/></svg>',
  sync: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13 8a5 5 0 0 1-8.8 3.4l1.2-1.2A3.5 3.5 0 0 0 11.5 8H13zm.9-2H11.4a3.5 3.5 0 0 0-6.2 2.1l1.2-1.2A5 5 0 0 1 13.9 6zM8 1.5A6.5 6.5 0 0 0 1.5 8H4A4 4 0 0 1 8 4zM8 14.5A6.5 6.5 0 0 0 14.5 8H12A4 4 0 0 1 8 12z"/></svg>',
  bell: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a4.5 4.5 0 0 1 4.5 4.5v2.7l1.4 2.2a.7.7 0 0 1-.6 1.1H2.7a.7.7 0 0 1-.6-1.1l1.4-2.2V5.5A4.5 4.5 0 0 1 8 1zm-1 11h2a1.5 1.5 0 0 1-2 0z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
  clock: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3.5 2"/></svg>',
  spark: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><path d="M12 3l2.2 5.8L20 11l-5.8 2.2L12 19l-2.2-5.8L4 11l5.8-2.2z"/></svg>',
  download: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3v12m0 0 5-5m-5 5-5-5M4 17v2a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-2"/></svg>',
  upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 21V9m0 0 5 5m-5-5-5 5M4 7V5a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v2"/></svg>',
  share: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><circle cx="18" cy="5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="19" r="2.5"/><path d="m8.5 10.8 7-4.5M8.5 13.2l7 4.5"/></svg>',
  copy: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"><rect x="8" y="8" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h9"/></svg>',
  diffIcon: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M12 3v18M5 8H3v8h2l7 4V4L5 8zM19 8h2v8h-2l-7 4"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20l1.2-4.3L16.8 4.1a1.9 1.9 0 0 1 2.7 0l.4.4a1.9 1.9 0 0 1 0 2.7L8.3 18.8z"/><path d="M15 6.5l2.5 2.5"/></svg>',
};

function icon(name, cls) {
  return `<span class="ic ${cls || ""}">${ICONS[name] || ""}</span>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function fileColor(name) {
  const ext = name.includes(".") ? name.split(".").pop().toLowerCase() : "";
  const map = {
    js: "#f7df1e", mjs: "#f7df1e", cjs: "#f7df1e", ts: "#3178c6", jsx: "#f7df1e", tsx: "#3178c6",
    json: "#f0c674", html: "#e44d26", htm: "#e44d26", css: "#42a5f5", scss: "#c6538c",
    md: "#519aba", txt: "#9da5b4", py: "#ffd845", java: "#e76f00", c: "#569cd6", cpp: "#569cd6",
    h: "#569cd6", rs: "#dea584", go: "#00add8", php: "#777bb4", sh: "#89e051", yml: "#e6db74",
    yaml: "#e6db74", sql: "#e6db74", xml: "#e6db74", svg: "#ffa500", png: "#cc6699", jpg: "#cc6699",
  };
  return map[ext] || "#9da5b4";
}

function fileIcon(path) {
  const name = path.split("/").pop();
  return `<span class="ic ficon" style="color:${fileColor(name)}">${ICONS.file}</span>`;
}

let currentView = "explorer";
let sidebarVisible = true;
let smallScreen = false;
let panelVisible = false;
let panelTab = "terminal";
let cursorInfo = { line: 1, col: 1 };
let pendingCreate = null;
let pendingRename = null;
let termHistory = [];
let termHistIdx = -1;
let pItems = [];
let pList = [];
let pSel = 0;

const viewEls = {};

export function init() {
  buildChrome();
  const b = $("#boot");
  if (b) b.remove();
  bus.on("cursor", (c) => {
    cursorInfo = c;
    updateCursorStatus();
  });
  bus.on("docchange", (path, dirty) => {
    markTabDirty(path, dirty);
    applyScratchBar();
  });
  bus.on("saved", (path) => {
    markTabDirty(path, false);
    renderSidebar();
    applyScratchBar();
  });
  bus.on("scratch", () => {
    applyScratchBar();
    renderSidebar();
    renderTabs();
    renderStatus();
  });
  bus.on("split", () => {
    renderTabs();
    renderStatus();
  });
  bus.on("open", () => {
    renderTabs();
    renderSidebar();
    renderStatus();
    renderBreadcrumbs();
  });
  bus.on("problems", () => {
    renderTabs();
    renderStatus();
    renderProblemsBadges();
    if (panelTab === "problems") renderProblemsPane();
  });
  bus.on("restored", (path) => {
    renderTabs();
    renderSidebar();
    renderStatus();
    renderBreadcrumbs();
    if (path) toast("Restored " + path.split("/").pop());
  });
  bus.on("snapshots", () => {
    if (currentView === "history") renderSidebar();
  });
  bus.on("commit", onCommit);
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#ctxmenu")) hideMenu();
  });
  window.addEventListener("blur", () => hideMenu());
  const mq = window.matchMedia("(max-width: 780px)");
  smallScreen = mq.matches;
  showSidebar(store.settings.sidebarVisible !== false);
  mq.addEventListener("change", (e) => {
    smallScreen = e.matches;
    if (smallScreen) showSidebar(false);
    else showSidebar(store.settings.sidebarVisible !== false);
  });
}

function buildChrome() {
  const actBtns = [
    { id: "explorer", icon: "files", title: "Explorer (Ctrl+Shift+E)" },
    { id: "search", icon: "search", title: "Search (Ctrl+Shift+F)" },
    { id: "scm", icon: "scm", title: "Source Control" },
    { id: "run", icon: "run", title: "Run and Debug (Ctrl+F5)" },
    { id: "extensions", icon: "ext", title: "Extensions" },
    { id: "history", icon: "clock", title: "Timeline (version history)" },
    { id: "ai", icon: "spark", title: "AI Assistant" },
  ];
  $("#activitybar").innerHTML =
    `<div class="act-top">${actBtns.map((b) => `<button class="act-btn" data-view="${b.id}" title="${b.title}">${icon(b.icon)}</button>`).join("")}</div>` +
    `<div class="act-bottom"><button class="act-btn" id="actSettings" title="Settings (Ctrl+,)">${icon("gear")}</button></div>`;
  document.querySelectorAll(".act-btn[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.view;
      if (id === "ai") {
        showPanel("ai");
        return;
      }
      if (currentView === id && sidebarVisible) showSidebar(false);
      else {
        setView(id);
        showSidebar(true);
      }
    });
  });
  $("#actSettings").addEventListener("click", () => openSettings());

  $("#sidebar").innerHTML = `<div class="sidebar-title"><span class="st-label"></span><span class="st-actions"></span><button class="collapse-sidebar" id="collapseSidebarBtn" title="Collapse Sidebar (Ctrl+B)">${ICONS.chevLeft}</button></div><div class="sidebar-body"></div>`;
  $("#sidebar").hidden = false;
  $("#collapseSidebarBtn").addEventListener("click", () => showSidebar(false));
  $("#tabactions").innerHTML = `<button class="act-action" id="pvToggleBtn" title="Toggle Live Preview">${icon("eye")}</button>`;
  document.querySelectorAll(".panel-tab").forEach((b) => b.addEventListener("click", () => setPanelTab(b.dataset.panel)));
  $("#panelCloseBtn").addEventListener("click", () => setPanelVisible(false));
  buildTerminal();
  buildOutput();
  renderWelcome();
  renderStatus();
  updatePanelTabs();
  setView("explorer");
}

export function setView(view) {
  currentView = view;
  document.querySelectorAll(".act-btn[data-view]").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
  renderSidebar();
}

export function showSidebar(v) {
  sidebarVisible = !!v;
  const collapsed = smallScreen || !sidebarVisible;
  document.getElementById("app").classList.toggle("sidebar-collapsed", collapsed);
  if (!smallScreen) {
    store.settings.sidebarVisible = sidebarVisible;
    schedulePersist();
  }
}

export function toggleSidebar() {
  showSidebar(!sidebarVisible);
}

const VIEW_LABELS = { explorer: "EXPLORER", search: "SEARCH", scm: "SOURCE CONTROL", run: "RUN AND DEBUG", extensions: "EXTENSIONS", history: "TIMELINE" };

function renderSidebar() {
  const label = $(".st-label");
  const actions = $(".st-actions");
  label.textContent = VIEW_LABELS[currentView] || currentView;
  actions.innerHTML = "";
  if (currentView === "explorer") {
    addActionBtn(actions, "newFile", "New File", () => startCreate("", false));
    addActionBtn(actions, "newFolder", "New Folder", () => startCreate("", true));
    addActionBtn(actions, "collapse", "Collapse All Folders", collapseAll);
    addActionBtn(actions, "more", "More Actions…", openMoreMenu);
  }
  for (const id of Object.keys(viewEls)) viewEls[id].style.display = id === currentView ? "" : "none";
  const el = ensureViewEl(currentView);
  if (currentView === "explorer") renderTreeInto(el);
  else if (currentView === "search") renderSearchInto(el);
  else if (currentView === "scm") renderScmInto(el);
  else if (currentView === "run") renderRunInto(el);
  else if (currentView === "extensions") renderExtensionsInto(el);
  else if (currentView === "history") renderHistoryInto(el);
}

function ensureViewEl(id) {
  if (!viewEls[id]) {
    viewEls[id] = document.createElement("div");
    viewEls[id].className = "view";
    viewEls[id].id = "view-" + id;
    $(".sidebar-body").appendChild(viewEls[id]);
  }
  return viewEls[id];
}

function addActionBtn(parent, iconKey, title, fn) {
  const b = document.createElement("button");
  b.className = "act-action";
  b.title = title;
  b.innerHTML = icon(iconKey);
  b.addEventListener("click", fn);
  parent.appendChild(b);
}

function collapseAll() {
  store.expanded.clear();
  renderSidebar();
}

function openMoreMenu(e) {
  const items = [
    { label: "Export Workspace as ZIP", run: doExportZip },
    { label: "Import Workspace from ZIP", run: doImportZip },
    { sep: true },
    { label: "Copy Share Link", run: doShareLink },
    { label: "Edit This Generator (scratchpad)", run: editGenerator },
  ];
  const r = e.currentTarget.getBoundingClientRect();
  showMenu(r.left + 4, r.bottom + 2, items);
}

function renderTreeInto(el) {
  el.innerHTML = "";
  const tree = document.createElement("div");
  tree.className = "tree";
  buildDir("", tree, 0);
  el.appendChild(tree);
}

function buildDir(dir, parent, depth) {
  if (pendingCreate && pendingCreate.dir === dir) parent.appendChild(makeCreateRow(pendingCreate));
  for (const { name, node } of store.vfs.listDir(dir)) {
    const path = dir ? dir + "/" + name : name;
    const row = treeRow(dir, name, node, depth);
    parent.appendChild(row);
    if (node.type === "dir" && store.expanded.has(path)) buildDir(path, parent, depth + 1);
  }
}

function treeRow(dir, name, node, depth) {
  const path = dir ? dir + "/" + name : name;
  const row = document.createElement("div");
  row.className = "tree-row" + (node.type === "dir" ? " dir" : " file");
  row.dataset.path = path;
  row.style.paddingLeft = 8 + depth * 12 + "px";
  if (pendingRename === path) {
    row.appendChild(makeNameInput(name, (v) => doRename(path, v), () => (pendingRename = null)));
    return row;
  }
  if (node.type === "dir") {
    const open = store.expanded.has(path);
    row.classList.toggle("open", open);
    row.innerHTML = `<span class="chev">${ICONS.chevron}</span>${icon(open ? "folderOpen" : "folder")}<span class="name">${esc(name)}</span>`;
    row.addEventListener("click", () => toggleDir(path));
    row.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      e.stopPropagation();
      showMenu(e.clientX, e.clientY, dirMenu(path));
    });
    attachDragRow(row, path, true);
    return row;
  }
  row.classList.toggle("active", store.activePath === path);
  row.classList.toggle("dirty", store.dirty.has(path));
  row.innerHTML = `<span class="chev spacer"></span>${fileIcon(path)}<span class="name">${esc(name)}</span><span class="dirty-dot"></span>`;
  row.addEventListener("click", () => openFile(path));
  row.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    showMenu(e.clientX, e.clientY, fileMenu(path));
  });
  attachDragRow(row, path, false);
  return row;
}

let dragPath = null;
let dragEl = null;
let dropMode = null;

function attachDragRow(row, path, isDir) {
  row.draggable = true;
  row.addEventListener("dragstart", (e) => {
    dragPath = path;
    dragEl = row;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", path);
    row.classList.add("drag-src");
  });
  row.addEventListener("dragend", () => {
    clearDropState();
  });
  row.addEventListener("dragover", (e) => {
    if (!dragPath || dragPath === path) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const r = row.getBoundingClientRect();
    const y = e.clientY - r.top;
    let mode;
    if (isDir && y > r.height * 0.3 && y < r.height * 0.7) mode = "into";
    else if (y < r.height / 2) mode = "before";
    else mode = "after";
    if (dropMode !== mode) {
      dropMode = mode;
      row.classList.toggle("drop-into", mode === "into");
      row.classList.toggle("drop-before", mode === "before");
      row.classList.toggle("drop-after", mode === "after");
    }
  });
  row.addEventListener("dragleave", (e) => {
    if (row.contains(e.relatedTarget)) return;
    row.classList.remove("drop-into", "drop-before", "drop-after");
    if (dropMode) dropMode = null;
  });
  row.addEventListener("drop", (e) => {
    e.preventDefault();
    e.stopPropagation();
    const src = dragPath || e.dataTransfer.getData("text/plain");
    const mode = dropMode || (isDir ? "into" : "after");
    clearDropState();
    if (src && src !== path) doDrop(src, path, mode);
  });
}

function clearDropState() {
  if (dragEl) dragEl.classList.remove("drag-src");
  dragEl = null;
  dragPath = null;
  dropMode = null;
  document.querySelectorAll(".tree-row").forEach((r) => r.classList.remove("drop-into", "drop-before", "drop-after"));
}

function displayNames(dir) {
  return store.vfs.listDir(dir).map((x) => x.name);
}

function doDrop(srcPath, targetPath, mode) {
  if (store.readOnly) return toast("Read-only workspace");
  const srcName = srcPath.split("/").pop();
  const srcDir = store.vfs.parentDir(srcPath);
  const isDir = store.vfs.isDir(srcPath);
  let destDir;
  let insertIdx = -1;
  if (mode === "into") {
    if (!store.vfs.isDir(targetPath)) return toast("Can only move into a folder");
    destDir = targetPath;
  } else {
    destDir = store.vfs.isDir(targetPath) ? targetPath : store.vfs.parentDir(targetPath);
    const names = displayNames(destDir);
    const tIdx = names.indexOf(targetPath.split("/").pop());
    insertIdx = tIdx + (mode === "after" ? 1 : 0);
  }
  if (srcDir === destDir && (mode === "into" || insertIdx === -1)) {
    toast(srcName + " is already there");
    return;
  }
  const res = store.vfs.move(srcPath, destDir);
  if (res.error) return toast(res.error);
  const newPath = res.path;
  if (srcDir === destDir) {
    const names = displayNames(destDir);
    const from = names.indexOf(srcName);
    names.splice(from, 1);
    let idx = insertIdx > from ? insertIdx - 1 : insertIdx;
    idx = Math.max(0, Math.min(idx, names.length));
    names.splice(idx, 0, srcName);
    store.vfs.order[destDir || ""] = names;
  }
  updateRefs(srcPath, newPath, isDir);
  history.cleanSnapshots(srcPath, newPath, isDir);
  if (store.activePath && (store.activePath === srcPath || (isDir && store.activePath.startsWith(srcPath + "/")))) {
    editor.openFile(store.activePath);
  }
  schedulePersist();
  renderSidebar();
  renderTabs();
  renderStatus();
  toast("Moved to " + newPath);
}

function makeNameInput(initial, onCommit, onCancel) {
  const input = document.createElement("input");
  input.className = "rename-input";
  input.value = initial || "";
  input.spellcheck = false;
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") onCommit(input.value);
    else if (e.key === "Escape") {
      if (onCancel) onCancel();
      renderSidebar();
    }
  });
  setTimeout(() => {
    input.focus();
    input.select();
  }, 0);
  return input;
}

function startCreate(dir, isDir) {
  pendingCreate = { dir, isDir };
  renderSidebar();
}

function makeCreateRow({ dir, isDir }) {
  const row = document.createElement("div");
  row.className = "tree-row create-row";
  row.style.paddingLeft = "20px";
  const def = isDir ? "new-folder" : "untitled.txt";
  row.appendChild(
    makeNameInput(def, (v) => {
      pendingCreate = null;
      const name = v.trim();
      if (!name) {
        renderSidebar();
        return;
      }
      const path = (dir ? dir + "/" : "") + name;
      if (store.readOnly) { toast("Read-only workspace"); renderSidebar(); return; }
      const ok = isDir ? store.vfs.createDir(path) : store.vfs.createFile(path, "");
      if (!ok) {
        toast("Path already exists: " + name);
        renderSidebar();
        return;
      }
      if (isDir) store.expanded.add(path);
      schedulePersist();
      renderSidebar();
      if (!isDir) openFile(path);
    })
  );
  return row;
}

function toggleDir(path) {
  if (store.expanded.has(path)) store.expanded.delete(path);
  else store.expanded.add(path);
  schedulePersist();
  renderSidebar();
}

function doRename(path, newName) {
  pendingRename = null;
  if (store.readOnly) { toast("Read-only workspace"); renderSidebar(); return; }
  const oldName = path.split("/").pop();
  newName = (newName || "").trim();
  if (!newName || newName === oldName) {
    renderSidebar();
    return;
  }
  const isDir = store.vfs.isDir(path);
  if (!store.vfs.rename(path, newName)) {
    toast("Cannot rename to " + newName);
    renderSidebar();
    return;
  }
  const newPath = path.slice(0, path.length - oldName.length) + newName;
  updateRefs(path, newPath, isDir);
  history.cleanSnapshots(path, newPath, isDir);
  if (store.activePath && (store.activePath === path || (isDir && store.activePath.startsWith(path + "/")))) {
    editor.openFile(store.activePath);
  }
  schedulePersist();
  renderTabs();
  renderSidebar();
  renderStatus();
  toast("Renamed to " + newPath);
}

function updateRefs(oldP, newP, isDir) {
  for (let i = 0; i < store.tabs.length; i++) {
    const t = store.tabs[i];
    if (t === oldP || (isDir && t.startsWith(oldP + "/"))) {
      const nt = newP + t.slice(oldP.length);
      store.tabs[i] = nt;
      if (store.dirty.has(t)) {
        store.dirty.delete(t);
        store.dirty.add(nt);
      }
      if (store.activePath === t) store.activePath = nt;
      if (store.saved[t] !== undefined) {
        store.saved[nt] = store.saved[t];
        delete store.saved[t];
      }
    }
  }
  const ov = store.langOverride;
  if (ov) {
    for (const k of Object.keys(ov)) {
      if (k === oldP || (isDir && k.startsWith(oldP + "/"))) {
        const nk = newP + k.slice(oldP.length);
        ov[nk] = ov[k];
        delete ov[k];
      }
    }
  }
  const fld = store.folds;
  if (fld) {
    for (const k of Object.keys(fld)) {
      if (k === oldP || (isDir && k.startsWith(oldP + "/"))) {
        const nk = newP + k.slice(oldP.length);
        fld[nk] = fld[k];
        delete fld[k];
      }
    }
  }
  const exp = [...store.expanded];
  store.expanded.clear();
  for (const e of exp) {
    if (e === oldP || (isDir && e.startsWith(oldP + "/"))) store.expanded.add(newP + e.slice(oldP.length));
    else store.expanded.add(e);
  }
}

function doDelete(path) {
  if (store.readOnly) return toast("Read-only workspace");
  const isDir = store.vfs.isDir(path);
  if (isDir) {
    for (let i = store.tabs.length - 1; i >= 0; i--) {
      const t = store.tabs[i];
      if (t === path || t.startsWith(path + "/")) store.tabs.splice(i, 1);
    }
    if (store.activePath && (store.activePath === path || store.activePath.startsWith(path + "/"))) store.activePath = null;
    for (const d of [...store.expanded]) if (d === path || d.startsWith(path + "/")) store.expanded.delete(d);
  } else {
    const i = store.tabs.indexOf(path);
    if (i > -1) store.tabs.splice(i, 1);
    if (store.activePath === path) store.activePath = null;
  }
  store.vfs.delete(path);
  store.dirty.delete(path);
  if (store.langOverride) {
    for (const k of Object.keys(store.langOverride)) {
      if (k === path || (isDir && k.startsWith(path + "/"))) delete store.langOverride[k];
    }
  }
  if (store.folds) {
    for (const k of Object.keys(store.folds)) {
      if (k === path || (isDir && k.startsWith(path + "/"))) delete store.folds[k];
    }
  }
  if (store.problems) {
    for (const k of Object.keys(store.problems)) {
      if (k === path || (isDir && k.startsWith(path + "/"))) delete store.problems[k];
    }
  }
  history.cleanSnapshots(path, null, isDir);
  if (!store.activePath && store.tabs.length) store.activePath = store.tabs[store.tabs.length - 1];
  schedulePersist();
  if (store.activePath) {
    showWelcome(false);
    editor.openFile(store.activePath);
  } else {
    showWelcome(true);
  }
  renderTabs();
  renderSidebar();
  renderStatus();
  toast("Deleted " + path);
}

function deleteConfirm(path) {
  const isDir = store.vfs.isDir(path);
  overlayShow(
    `<div class="modal modal-sm"><div class="modal-head">Delete ${isDir ? "Folder" : "File"}<button class="modal-close">×</button></div><div class="modal-body"><p>Are you sure you want to delete <b>${esc(path)}</b>?</p><div class="modal-btns"><button class="btn danger" id="delYes">Delete</button><button class="btn" id="delNo">Cancel</button></div></div></div>`
  );
  $("#delYes").onclick = () => {
    overlayHide();
    doDelete(path);
  };
  $("#delNo").onclick = () => overlayHide();
  $(".modal-close").onclick = () => overlayHide();
}

export function openFile(path) {
  if (store.vfs.read(path) === null) {
    toast("No such file: " + path);
    return Promise.resolve();
  }
  if (!store.tabs.includes(path)) store.tabs.push(path);
  store.activePath = path;
  schedulePersist();
  showWelcome(false);
  return editor.openFile(path);
}

export function closeTab(path) {
  if (!path) return;
  const i = store.tabs.indexOf(path);
  if (i === -1) return;
  store.tabs.splice(i, 1);
  if (store.activePath === path) {
    store.activePath = store.tabs.length ? store.tabs[Math.min(i, store.tabs.length - 1)] : null;
    if (store.activePath) editor.openFile(store.activePath);
    else showWelcome(true);
  }
  schedulePersist();
  renderTabs();
  renderSidebar();
  renderStatus();
  renderBreadcrumbs();
}

export function closeAllTabs() {
  store.tabs = [];
  store.activePath = null;
  schedulePersist();
  showWelcome(true);
  renderTabs();
  renderSidebar();
  renderStatus();
  renderBreadcrumbs();
}

export function nextTab() {
  if (store.tabs.length < 2) return;
  const i = store.tabs.indexOf(store.activePath);
  const next = store.tabs[(i + 1) % store.tabs.length];
  openFile(next);
}

function renderTabs() {
  const tabsEl = $("#tabs");
  tabsEl.innerHTML = "";
  for (const path of store.tabs) {
    const t = document.createElement("div");
    t.className = "tab" + (path === store.activePath ? " active" : "") + (store.split && store.split.path === path ? " split-active" : "");
    t.dataset.path = path;
    t.title = path;
    const name = path.split("/").pop();
    const errs = store.problems[path];
    const badge = errs && errs.length ? `<span class="tab-badge">${errs.length}</span>` : "";
    t.innerHTML = `${fileIcon(path)}<span class="tname">${esc(name)}</span>${badge}<span class="tab-dirty">${store.dirty.has(path) ? "●" : ""}</span><span class="tab-close">×</span>`;
    t.addEventListener("click", () => openFile(path));
    t.addEventListener("auxclick", (e) => {
      if (e.button === 1) closeTab(path);
    });
    t.addEventListener("contextmenu", (e) => {
      e.preventDefault();
      showMenu(e.clientX, e.clientY, tabMenu(path));
    });
    t.querySelector(".tab-close").addEventListener("click", (e) => {
      e.stopPropagation();
      closeTab(path);
    });
    tabsEl.appendChild(t);
  }
  tabsEl.scrollLeft = tabsEl.scrollWidth;
}

function renderBreadcrumbs() {
  const bc = $("#breadcrumbs");
  if (!bc) return;
  const path = store.activePath;
  if (!path) {
    bc.hidden = true;
    bc.innerHTML = "";
    return;
  }
  bc.hidden = false;
  bc.innerHTML = "";
  const parts = path.split("/");
  let acc = "";
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    acc = acc ? acc + "/" + part : part;
    const isFile = i === parts.length - 1;
    if (i > 0) {
      const sep = document.createElement("span");
      sep.className = "crumb-sep";
      sep.textContent = "/";
      bc.appendChild(sep);
    }
    const seg = document.createElement("div");
    seg.className = "crumb" + (isFile ? " crumb-file" : "");
    seg.title = acc;
    if (isFile) {
      seg.innerHTML = fileIcon(acc);
      const name = document.createElement("span");
      name.textContent = part;
      seg.appendChild(name);
      seg.addEventListener("click", () => openFile(acc));
    } else {
      seg.innerHTML = icon("folderOpen");
      const name = document.createElement("span");
      name.textContent = part;
      seg.appendChild(name);
      seg.addEventListener("click", () => revealInTree(acc));
    }
    bc.appendChild(seg);
  }
}

function revealInTree(path) {
  if (!store.vfs.isDir(path)) return;
  let cur = "";
  for (const seg of path.split("/")) {
    cur = cur ? cur + "/" + seg : seg;
    if (store.vfs.isDir(cur)) store.expanded.add(cur);
  }
  setView("explorer");
  renderSidebar();
  const row = document.querySelector(`.tree-row[data-path="${CSS.escape(path)}"]`);
  if (row) row.scrollIntoView({ block: "nearest" });
}

function markTabDirty(path, dirty) {
  const tab = document.querySelector(`.tab[data-path="${CSS.escape(path)}"]`);
  if (tab) {
    tab.classList.toggle("dirty", dirty);
    const dot = tab.querySelector(".tab-dirty");
    if (dot) dot.textContent = dirty ? "●" : "";
  }
  const row = document.querySelector(`.tree-row[data-path="${CSS.escape(path)}"]`);
  if (row) row.classList.toggle("dirty", dirty);
  renderStatus();
}

function renderWelcome() {
  const files = store.vfs.walkFiles();
  $("#welcome").innerHTML = `<div class="welcome-inner">
    <div class="welcome-logo">&lt;/&gt;</div>
    <h1 class="welcome-title">Code</h1>
    <p class="welcome-sub">PerchEdit &mdash; a code editor running inside your generator. Files live in your browser and persist across reloads.</p>
    <div class="welcome-btns">
      <button class="wb primary" id="wbNew">+ New File</button>
      <button class="wb" id="wbOpen">Open File&hellip;</button>
      <button class="wb" id="wbRun">Run Sample</button>
      <button class="wb" id="wbCmd">Command Palette&hellip;</button>
    </div>
    <div class="welcome-cards">
      <div class="wc"><div class="wc-title">START</div><a class="wc-link" id="wc-readme">Read the README</a><a class="wc-link" id="wc-sample">Open src/main.js</a><a class="wc-link" id="wc-notes">Shortcuts (notes.txt)</a></div>
      <div class="wc"><div class="wc-title">WORKSPACE</div>${files.slice(0, 8).map((f) => `<a class="wc-link" data-file="${esc(f)}">${esc(f)}</a>`).join("")}</div>
      <div class="wc"><div class="wc-title">SHORTCUTS</div><span class="wc-text">Ctrl+Shift+P &middot; commands</span><span class="wc-text">Ctrl+P &middot; files</span><span class="wc-text">Ctrl+\` &middot; terminal</span><span class="wc-text">Ctrl+F5 &middot; run JS</span><span class="wc-text">Ctrl+S &middot; save</span><span class="wc-text">Ctrl+B &middot; sidebar</span></div>
    </div>
  </div>`;
  $("#wbNew").onclick = () => newFilePrompt();
  $("#wbOpen").onclick = () => openPalette("file");
  $("#wbRun").onclick = () => bus.emit("runfile", "src/main.js");
  $("#wbCmd").onclick = () => openPalette("cmd");
  $("#wc-readme").onclick = () => openFile("README.md");
  $("#wc-sample").onclick = () => openFile("src/main.js");
  $("#wc-notes").onclick = () => openFile("notes.txt");
  document.querySelectorAll("#welcome [data-file]").forEach((a) => (a.onclick = () => openFile(a.dataset.file)));
}

function showWelcome(show) {
  if (show) editor.closeSplit();
  $("#editorhost").hidden = !!show;
  $("#welcome").hidden = !show;
  renderBreadcrumbs();
  if (!show) editor.focus();
}

export function showWelcomeScreen() {
  showWelcome(true);
  setView("explorer");
}

function renderStatus() {
  const sb = $("#statusbar");
  const lang = store.activePath ? editor.langNameFor(store.activePath) : "Plain Text";
  const dirtyN = store.dirty.size;
  sb.innerHTML = `
    <div class="st-left">
      <span class="st-item st-int" id="st-branch" title="Branch: main (simulated)">${icon("branch")} main</span>
      <span class="st-item st-int" id="st-sync" title="Synchronize (simulated)">${icon("sync")}</span>
      <span class="st-item st-int" id="st-changes" title="Show Source Control">${icon("check")} ${dirtyN ? dirtyN : "0"}</span>
      <span class="st-item st-int" id="st-probcount" title="Show Problems">${icon("error")} ${problemsCount()}</span>
    </div>
    <div class="st-right">
      <span class="st-item st-int" id="st-cursor" title="Go to Line">Ln ${cursorInfo.line}, Col ${cursorInfo.col}</span>
      <span class="st-item st-int" id="st-spaces" title="Change Tab Size">Spaces: ${store.settings.tabSize}</span>
      <span class="st-item">UTF-8</span>
      <span class="st-item">LF</span>
      <span class="st-item st-int" id="st-lang" title="${store.langOverride && store.langOverride[store.activePath] ? "Language: " + lang + " (manual override) — click to change" : "Language: " + lang + " — click to change"}">${esc(lang)}</span>
      <span class="st-item st-int" id="st-bell" title="Notifications">${icon("bell")}</span>
      <span class="st-item st-int" id="st-gear" title="Settings (Ctrl+,)">${icon("gear")}</span>
    </div>`;
  $("#st-cursor").onclick = () => promptModal("Go to Line", "Line number", cursorInfo.line, (v) => editor.goToLine(+v));
  $("#st-bell").onclick = () => toast("You're all caught up!");
  $("#st-gear").onclick = () => openSettings();
  $("#st-branch").onclick = () => toast("Branch: main (simulated)");
  $("#st-sync").onclick = () => toast("Workspace in sync");
  $("#st-changes").onclick = () => { setView("scm"); showSidebar(true); };
  $("#st-probcount").onclick = () => { showPanel("problems"); setPanelTab("problems"); };
  $("#st-lang").onclick = () => {
    if (!store.activePath) {
      toast("Open a file to change its language");
      return;
    }
    openPalette("lang");
  };
  $("#st-spaces").onclick = (e) => {
    const el = $("#st-spaces");
    const r = el.getBoundingClientRect();
    showMenu(r.left, r.bottom + 2, [2, 4, 8].map((n) => ({
      label: n === store.settings.tabSize ? n + "  ✓" : String(n),
      run: () => {
        store.settings.tabSize = n;
        schedulePersist();
        applySettings();
      },
    })));
  };
}

function updateCursorStatus() {
  const el = $("#st-cursor");
  if (el) el.textContent = `Ln ${cursorInfo.line}, Col ${cursorInfo.col}`;
}

function overlayShow(html) {
  const o = $("#overlay");
  o.innerHTML = html;
  o.hidden = false;
}

function overlayHide() {
  const o = $("#overlay");
  o.hidden = true;
  o.innerHTML = "";
}

function fuzzy(q, s) {
  q = q.toLowerCase();
  s = s.toLowerCase();
  if (!q) return 0;
  let i = 0, score = 0, prev = -2;
  for (let j = 0; j < s.length && i < q.length; j++) {
    if (s[j] === q[i]) {
      score += j === prev + 1 ? 3 : 1;
      prev = j;
      i++;
    }
  }
  if (i !== q.length) return -1;
  return 1000 - score;
}

function languageItems() {
  const path = store.activePath;
  const cur = path ? editor.langNameFor(path) : "";
  const override = path ? editor.getLanguageOverride(path) : null;
  const mk = (label, val, isCur) => ({
    label: isCur ? label + "  \u2713" : label,
    keys: "",
    icon: "",
    run: () => editor.setLanguageOverride(path, val),
  });
  return [
    mk("Auto Detect", "auto", !override),
    mk("Plain Text", "Plain Text", override === "Plain Text" && cur === "Plain Text"),
    ...editor.languageList().map((name) => mk(name, name, override === name)),
  ];
}

export function openPalette(kind, opts) {
  const isCmd = kind === "cmd";
  const isLang = kind === "lang";
  const isCompare = kind === "compare";
  const placeholder = isCmd
    ? "Type a command name&hellip;"
    : isLang
      ? "Select a language&hellip;"
      : isCompare
        ? "Choose a file to compare with&hellip;"
        : "Open file&hellip;";
  if (isCompare) {
    const base = opts && opts.basePath;
    const files = (opts && opts.files) || [];
    pItems = files.map((p) => ({ label: p, keys: "", icon: fileIcon(p), run: () => compareFiles(base, p) }));
  } else {
    pItems = isCmd
      ? store.cmds.map((c) => ({ label: c.title, keys: keyb.effectiveKeys(c.id).map(keyb.prettyKey).join(", "), icon: c.icon || "", run: c.run }))
      : isLang
        ? languageItems()
        : store.vfs.walkFiles().map((p) => ({ label: p, keys: "", icon: fileIcon(p), run: () => openFile(p) }));
  }
  pSel = 0;
  pList = [];
  overlayShow(
    `<div class="palette"><input class="palette-input" spellcheck="false" autocomplete="off" placeholder="${placeholder}"><div class="palette-list"></div></div>`
  );
  const input = $(".palette-input");
  input.addEventListener("input", () => {
    pSel = 0;
    renderPList(input.value);
  });
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Escape") overlayHide();
    else if (e.key === "ArrowDown") {
      pMove(1);
      e.preventDefault();
    } else if (e.key === "ArrowUp") {
      pMove(-1);
      e.preventDefault();
    } else if (e.key === "Enter") {
      if (pList[pSel]) pick(pList[pSel].it);
    }
  });
  renderPList("");
  input.focus();
}

function renderPList(q) {
  const list = $(".palette-list");
  const scored = [];
  for (const it of pItems) {
    const s = fuzzy(q, it.label);
    if (s >= 0) scored.push({ it, s });
  }
  scored.sort((a, b) => b.s - a.s);
  pList = scored;
  list.innerHTML = "";
  if (!scored.length) {
    const none = document.createElement("div");
    none.className = "p-none";
    none.textContent = "No matching results";
    list.appendChild(none);
    return;
  }
  for (let i = 0; i < scored.length; i++) {
    const { it } = scored[i];
    const d = document.createElement("div");
    d.className = "p-item" + (i === pSel ? " active" : "");
    if (it.icon) d.insertAdjacentHTML("afterbegin", `<span class="p-icon">${it.icon}</span>`);
    const lbl = document.createElement("span");
    lbl.className = "p-label";
    lbl.textContent = it.label;
    d.appendChild(lbl);
    if (it.keys) {
      const k = document.createElement("span");
      k.className = "p-keys";
      k.textContent = it.keys;
      d.appendChild(k);
    }
    d.addEventListener("mousedown", (e) => {
      e.preventDefault();
      pSel = i;
      pick(scored[i].it);
    });
    d.addEventListener("mouseenter", () => {
      pSel = i;
      refreshPActive();
    });
    list.appendChild(d);
  }
}

function refreshPActive() {
  const list = $(".palette-list");
  for (let j = 0; j < list.children.length; j++) list.children[j].classList.toggle("active", j === pSel);
}

function pMove(delta) {
  if (!pList.length) return;
  pSel = Math.max(0, Math.min(pSel + delta, pList.length - 1));
  refreshPActive();
  const list = $(".palette-list");
  const a = list.children[pSel];
  if (a) a.scrollIntoView({ block: "nearest" });
}

function pick(item) {
  overlayHide();
  try {
    item.run();
  } catch (e) {
    console.error(e);
    toast("Command failed: " + e.message);
  }
}

function promptModal(title, placeholder, initial, onSubmit) {
  overlayShow(
    `<div class="palette prompt-modal"><div class="prompt-title">${esc(title)}</div><input class="palette-input" spellcheck="false" placeholder="${esc(placeholder)}" value="${esc(initial ?? "")}"><div class="prompt-hint">Enter to confirm &middot; Esc to cancel</div></div>`
  );
  const input = $(".palette-input");
  const go = () => {
    const v = input.value;
    overlayHide();
    onSubmit(v);
  };
  input.addEventListener("keydown", (e) => {
    e.stopPropagation();
    if (e.key === "Enter") go();
    else if (e.key === "Escape") overlayHide();
  });
  input.focus();
  input.select();
}

export function newFilePrompt() {
  if (store.readOnly) return toast("Read-only workspace");
  promptModal("New File", "path/to/file", "", (v) => {
    if (!v.trim()) return;
    const path = v.trim();
    ensureDirs(path);
    if (store.vfs.createFile(path, "")) {
      schedulePersist();
      renderSidebar();
      openFile(path);
    } else {
      toast("File already exists: " + path);
    }
  });
}

export function newFolderPrompt() {
  if (store.readOnly) return toast("Read-only workspace");
  promptModal("New Folder", "name", "", (v) => {
    const path = v.trim();
    if (!path) return;
    ensureDirs(path);
    if (store.vfs.createDir(path)) {
      store.expanded.add(path);
      schedulePersist();
      renderSidebar();
    } else {
      toast("Folder already exists: " + path);
    }
  });
}

function ensureDirs(path) {
  const parts = path.split("/").filter(Boolean);
  parts.pop();
  let cur = "";
  for (const p of parts) {
    cur = cur ? cur + "/" + p : p;
    if (!store.vfs.get(cur)) store.vfs.createDir(cur);
  }
}

function showMenu(x, y, items) {
  const m = $("#ctxmenu");
  m.innerHTML = "";
  for (const it of items) {
    if (it.sep) {
      const s = document.createElement("div");
      s.className = "ctx-sep";
      m.appendChild(s);
      continue;
    }
    const d = document.createElement("div");
    d.className = "ctx-item" + (it.disabled ? " disabled" : "");
    d.textContent = it.label;
    if (!it.disabled) {
      d.onclick = (e) => {
        e.stopPropagation();
        hideMenu();
        it.run();
      };
    }
    m.appendChild(d);
  }
  m.hidden = false;
  const r = m.getBoundingClientRect();
  m.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  m.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
}

function hideMenu() {
  $("#ctxmenu").hidden = true;
}

function fileMenu(path) {
  const ro = store.readOnly;
  return [
    { label: "Open", run: () => openFile(path) },
    { label: "Open to the Side", run: () => editor.openToSide(path) },
    { sep: true },
    { label: "Rename\u2026", disabled: ro, run: () => { pendingRename = path; renderSidebar(); } },
    { label: "Duplicate", disabled: ro, run: () => duplicateFile(path) },
    { label: "Delete", disabled: ro, run: () => deleteConfirm(path) },
    { sep: true },
    { label: "Compare With\u2026", run: () => openComparePicker(path) },
    { label: "Copy Path", run: () => copyPath(path) },
  ];
}

function dirMenu(path) {
  const ro = store.readOnly;
  return [
    { label: "New File", disabled: ro, run: () => startCreate(path, false) },
    { label: "New Folder", disabled: ro, run: () => startCreate(path, true) },
    { sep: true },
    { label: "Rename\u2026", disabled: ro, run: () => { pendingRename = path; renderSidebar(); } },
    { label: "Duplicate Folder", disabled: ro, run: () => duplicateFile(path) },
    { label: "Delete", disabled: ro, run: () => deleteConfirm(path) },
  ];
}

function tabMenu(path) {
  return [
    { label: "Close", run: () => closeTab(path) },
    { label: "Close Others", run: () => { store.tabs = [path]; store.activePath = path; editor.openFile(path); schedulePersist(); renderTabs(); renderSidebar(); renderStatus(); } },
    { label: "Close All", run: () => closeAllTabs() },
    { sep: true },
    { label: "Compare With\u2026", run: () => openComparePicker(path) },
    { label: "Copy Path", run: () => copyPath(path) },
  ];
}

function uniqueName(base, ext) {
  const cand = (n) => base + " copy" + (n === 1 ? "" : " " + n) + ext;
  let n = 1;
  while (store.vfs.get(cand(n)) !== null) n++;
  return cand(n);
}

export function duplicateFile(path) {
  if (store.readOnly) return toast("Read-only workspace");
  if (!store.vfs.get(path)) return toast("No such file: " + path);
  const isDir = store.vfs.isDir(path);
  const parts = path.split("/");
  const name = parts.pop();
  const dir = parts.join("/");
  const dot = name.lastIndexOf(".");
  const base = dot > 0 ? name.slice(0, dot) : name;
  const ext = dot > 0 ? name.slice(dot) : "";
  const newName = uniqueName(base, ext);
  const newPath = (dir ? dir + "/" : "") + newName;
  if (isDir) {
    for (const p of store.vfs.walkFiles()) {
      if (p !== path && p.startsWith(path + "/")) {
        store.vfs.write(newPath + p.slice(path.length), store.vfs.read(p) || "");
      }
    }
    store.vfs.createDir(newPath);
  } else {
    store.vfs.write(newPath, store.vfs.read(path) || "");
  }
  schedulePersist();
  renderSidebar();
  if (!isDir) openFile(newPath);
  toast("Duplicated to " + newPath);
}

function openComparePicker(basePath) {
  const files = store.vfs.walkFiles().filter((p) => p !== basePath);
  if (!files.length) return toast("No other files to compare");
  openPalette("compare", { basePath, files });
}

export function compareFiles(a, b) {
  if (!a || !b || a === b) return;
  const ca = store.vfs.read(a);
  const cb = store.vfs.read(b);
  if (ca === null || cb === null) return toast("Cannot compare — a file is missing");
  showDiffModal("Compare — " + a + " ↔ " + b, a, ca, b, cb);
}

export function compareActive() {
  if (!store.activePath) return toast("Open a file first");
  openComparePicker(store.activePath);
}

function copyPath(path) {
  try {
    navigator.clipboard.writeText(path);
    toast("Copied path");
  } catch {
    toast("Clipboard unavailable");
  }
}

let zipInput = null;

function getZipInput() {
  if (!zipInput) {
    zipInput = document.createElement("input");
    zipInput.type = "file";
    zipInput.accept = ".zip,application/zip";
    zipInput.style.display = "none";
    document.body.appendChild(zipInput);
    zipInput.addEventListener("change", () => {
      const f = zipInput.files && zipInput.files[0];
      zipInput.value = "";
      if (f) importZipFile(f);
    });
  }
  return zipInput;
}

export async function doExportZip() {
  if (store.readOnly) return toast("Read-only workspace");
  try {
    const { count } = await zip.exportWorkspaceZip();
    toast("Exported " + count + " file" + (count === 1 ? "" : "s") + " as perchedit-workspace.zip");
  } catch (e) {
    toast("Export failed: " + (e && e.message ? e.message : e), 4000);
  }
}

export function doImportZip() {
  if (store.readOnly) return toast("Read-only workspace");
  getZipInput().click();
}

async function importZipFile(file) {
  toast("Importing " + file.name + "…");
  try {
    const { count, skipped } = await zip.importWorkspaceZip(file);
    afterWorkspaceChange();
    toast("Imported " + count + " file" + (count === 1 ? "" : "s") + (skipped ? " (" + skipped + " unchanged)" : ""));
  } catch (e) {
    toast("Import failed: " + (e && e.message ? e.message : e), 5000);
  }
}

export async function doShareLink() {
  try {
    const { link, copied, uploaded } = await share.buildShareLink();
    showLinkModal(link, copied, uploaded);
  } catch (e) {
    toast("Share failed: " + (e && e.message ? e.message : e), 5000);
  }
}

function showLinkModal(link, copied, uploaded) {
  overlayShow(
    `<div class="modal modal-sm"><div class="modal-head">Share Workspace Link<button class="modal-close">×</button></div>
      <div class="modal-body">
        <p class="share-note">${uploaded ? "Workspace was too large for the URL, so its data was uploaded (valid ~1 year)." : "Workspace data is compressed inside the link."} Anyone who opens it sees the workspace restored <b>read-only</b>.</p>
        <input class="share-link" readonly spellcheck="false" value="${esc(link)}">
        <div class="modal-btns"><button class="btn primary" id="shareCopy">${copied ? "Link Copied ✓" : "Copy Link"}</button></div>
      </div></div>`
  );
  $(".modal-close").onclick = () => overlayHide();
  const btn = $("#shareCopy");
  btn.onclick = () => {
    try {
      navigator.clipboard.writeText(link);
      btn.textContent = "Link Copied ✓";
    } catch {
      btn.textContent = "Select the link above (Ctrl+C)";
      $(".share-link").select();
    }
  };
}

function afterWorkspaceChange() {
  schedulePersist();
  renderSidebar();
  renderTabs();
  renderStatus();
  if (store.activePath && store.vfs.read(store.activePath) !== null) editor.openFile(store.activePath);
  else if (!store.activePath && store.tabs.length) {
    store.activePath = store.tabs[store.tabs.length - 1];
    editor.openFile(store.activePath);
  }
}

export function applyReadOnlyBar() {
  const bar = $("#readonlybar");
  if (!bar) return;
  if (store.readOnly) {
    bar.innerHTML = `Read-only workspace — opened from a shared link. Editing is disabled. <button class="btn btn-xs" id="roExit">Open my workspace</button>`;
    bar.hidden = false;
    const btn = $("#roExit");
    if (btn) {
      btn.onclick = () => {
        store.readOnly = false;
        const url = location.href.split("#")[0].split("?")[0];
        location.href = url;
      };
    }
  } else bar.hidden = true;
}

export async function editGenerator() {
  if (store.readOnly) return toast("Read-only workspace");
  try {
    if (!scratch.isActive()) {
      toast("Loading " + scratch.genName() + " source…");
      await scratch.loadScratch();
    }
    store.expanded.add(scratch.GEN_DIR);
    await openFile(scratch.GEN_MAIN);
    applyScratchBar();
    toast("Scratchpad: " + scratch.genName() + " — edit freely, then Publish…");
  } catch (e) {
    toast(e && e.message ? e.message : "Scratchpad load failed", 5000);
  }
}

function scratchFileName(p) {
  return p === scratch.GEN_MAIN ? "main.pjs" : p === scratch.GEN_HTML ? "index.html" : p.split("/").pop();
}

export function applyScratchBar() {
  const bar = $("#scratchbar");
  if (!bar) return;
  if (!scratch.isActive()) {
    bar.hidden = true;
    return;
  }
  const name = scratch.genName();
  const files = [scratch.GEN_MAIN, scratch.GEN_HTML];
  const segs = files
    .map((p) => {
      const dirty = store.dirty.has(p);
      const pub = store.scratch.published[p];
      const dot = dirty ? "●" : pub ? "✓" : "·";
      const title = `${p}${dirty ? " — unsaved changes" : pub ? " — published (copied/exported)" : " — unchanged"}`;
      return `<span class="scr-file${dirty ? " dirty" : ""}" data-scrfile="${esc(p)}" title="${esc(title)}"><span class="scr-dot">${dot}</span> ${esc(scratchFileName(p))}</span>`;
    })
    .join("");
  bar.innerHTML = `<span class="scr-label">${icon("pencil")} SCRATCHPAD</span><span class="scr-name">${esc(name)}</span><span class="scr-files">${segs}</span><span class="scr-spacer"></span><button class="scr-btn scr-primary" id="scrPublish">Publish…</button><button class="scr-btn" id="scrReload">Reload live</button><button class="scr-btn" id="scrExit">Exit</button>`;
  bar.hidden = false;
  bar.querySelectorAll("[data-scrfile]").forEach((el) => {
    el.addEventListener("click", () => openFile(el.dataset.scrfile));
  });
  $("#scrPublish").onclick = () => openPublishModal();
  $("#scrReload").onclick = () => {
    const dirty = store.dirty.has(scratch.GEN_MAIN) || store.dirty.has(scratch.GEN_HTML);
    const go = async () => {
      try {
        toast("Reloading live source…");
        await scratch.reloadScratch();
        await openFile(scratch.GEN_MAIN);
        applyScratchBar();
        toast("Reloaded live source");
      } catch (e) {
        toast(e && e.message ? e.message : "Reload failed", 5000);
      }
    };
    if (dirty) confirmModal("Discard your local scratchpad changes and re-fetch the published source?", () => go());
    else go();
  };
  $("#scrExit").onclick = () => exitScratch();
}

function confirmModal(message, onYes) {
  overlayShow(
    `<div class="modal modal-sm"><div class="modal-head">Confirm<button class="modal-close">×</button></div><div class="modal-body"><p>${esc(message)}</p><div class="modal-btns"><button class="btn danger" id="cmYes">Confirm</button><button class="btn" id="cmNo">Cancel</button></div></div></div>`
  );
  $("#cmYes").onclick = () => {
    overlayHide();
    onYes();
  };
  $("#cmNo").onclick = () => overlayHide();
  $(".modal-close").onclick = () => overlayHide();
}

function openPublishModal() {
  if (!scratch.isActive()) return;
  const files = [scratch.GEN_MAIN, scratch.GEN_HTML];
  const rows = files
    .map((p) => {
      const dirty = store.dirty.has(p);
      const pub = store.scratch.published[p];
      const st = scratch.changeStats(p);
      const badge = dirty
        ? `<span class="scr-badge edited">● edited</span>`
        : pub
          ? `<span class="scr-badge staged">✓ staged</span>`
          : `<span class="scr-badge">· unchanged</span>`;
      const delta =
        dirty || st.added || st.removed
          ? `<span class="scr-delta"><b>${st.added}</b> added · <i>${st.removed}</i> removed</span>`
          : `<span class="scr-delta">(no changes)</span>`;
      return `<div class="scr-row" data-p="${esc(p)}">${fileIcon(p)}<span class="scr-rowhead"><span class="scr-name">${esc(scratchFileName(p))}</span></span>${badge}${delta}<span class="scr-rowbtns"><button class="btn btn-xs scr-copy">Copy</button><button class="btn btn-xs scr-dl">Download</button></span></div>`;
    })
    .join("");
  overlayShow(
    `<div class="modal modal-sm"><div class="modal-head">Publish Scratchpad — ${esc(scratch.genName())}<button class="modal-close">×</button></div><div class="modal-body">
      <p class="scr-note">Perchance has no save API, so to publish your edits: <b>Copy</b> a file, open this generator in the Perchance editor, paste it over the old code and press <b>Save</b>. Files you've copied or downloaded are marked ✓.</p>
      ${rows}
      <div class="scr-bothrow"><button class="btn scr-copyall" id="scrCopyAll">Copy both files</button><button class="btn" id="scrOpenEd">Open in Perchance editor</button></div>
      <div class="scr-bothrow"><button class="btn danger" id="scrExit2">Exit scratchpad</button></div>
    </div></div>`
  );
  $(".modal-close").onclick = () => overlayHide();
  document.querySelectorAll(".scr-copy").forEach((b) => {
    b.onclick = () => copyScratchFile(b.closest(".scr-row").dataset.p);
  });
  document.querySelectorAll(".scr-dl").forEach((b) => {
    b.onclick = () => downloadFile(b.closest(".scr-row").dataset.p);
  });
  $("#scrCopyAll").onclick = async () => {
    try {
      const text = files.map((p) => `// ===== ${scratchFileName(p)} =====\n\n${store.vfs.read(p) || ""}`).join("\n\n");
      await navigator.clipboard.writeText(text);
      for (const p of files) scratch.markPublished(p);
      toast("Copied both files to clipboard");
      openPublishModal();
    } catch {
      toast("Clipboard unavailable — use Download instead", 4000);
    }
  };
  $("#scrOpenEd").onclick = () => {
    window.open("https://perchance.org/" + encodeURIComponent(scratch.genName()), "_blank");
  };
  $("#scrExit2").onclick = () => {
    overlayHide();
    exitScratch();
  };
}

async function copyScratchFile(p) {
  const content = store.vfs.read(p);
  if (content === null) return toast("No such file");
  try {
    await navigator.clipboard.writeText(content);
    scratch.markPublished(p);
    toast("Copied " + scratchFileName(p) + " — paste it into the Perchance editor and Save");
    openPublishModal();
  } catch {
    toast("Clipboard unavailable — try Download", 4000);
  }
}

function downloadFile(p) {
  const content = store.vfs.read(p);
  if (content === null) return toast("No such file");
  const a = document.createElement("a");
  const blob = new Blob([content], { type: "text/plain;charset=utf-8" });
  a.href = URL.createObjectURL(blob);
  a.download = scratchFileName(p);
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(a.href);
    a.remove();
  }, 100);
  scratch.markPublished(p);
  toast("Downloaded " + scratchFileName(p));
  if (!$("#overlay").hidden) openPublishModal();
}

export function exitScratch() {
  const dirty = store.dirty.has(scratch.GEN_MAIN) || store.dirty.has(scratch.GEN_HTML);
  const go = () => {
    scratch.exitScratch();
    if (!store.tabs.length) showWelcome(true);
    renderTabs();
    renderSidebar();
    renderStatus();
    applyScratchBar();
    toast("Exited scratchpad");
  };
  if (dirty) confirmModal("You have unsaved scratchpad changes (they won't be published). Exit anyway?", go);
  else go();
}

export function openPublishModalSafe() {
  if (!scratch.isActive()) {
    toast("Load the scratchpad first (pencil button or Perchance: Edit This Generator)");
    return;
  }
  openPublishModal();
}

export function setPanelVisible(v) {
  panelVisible = !!v;
  $("#panel").hidden = !panelVisible;
}

export function togglePanel() {
  setPanelVisible(!panelVisible);
  if (panelVisible) focusTerminal();
}

export function showPanel(name) {
  panelTab = name;
  setPanelVisible(true);
  updatePanelTabs();
}

export function setPanelTab(name) {
  panelTab = name;
  if (name === "problems") {
    lint.lintAll();
    renderProblemsPane();
  }
  updatePanelTabs();
}

function updatePanelTabs() {
  document.querySelectorAll(".panel-tab").forEach((b) => b.classList.toggle("active", b.dataset.panel === panelTab));
  $("#pane-terminal").hidden = panelTab !== "terminal";
  $("#pane-output").hidden = panelTab !== "output";
  $("#pane-problems").hidden = panelTab !== "problems";
  $("#pane-ai").hidden = panelTab !== "ai";
}

export function focusTerminal() {
  setPanelTab("terminal");
  setPanelVisible(true);
  const i = document.querySelector(".term-input");
  if (i) setTimeout(() => i.focus(), 0);
}

function buildTerminal() {
  const pane = $("#pane-terminal");
  pane.innerHTML = `<div class="term"><div class="term-body"></div><div class="term-row"><span class="term-prompt"></span><input class="term-input" spellcheck="false" autocomplete="off"></div></div>`;
  const input = pane.querySelector(".term-input");
  const promptEl = pane.querySelector(".term-prompt");
  const body = pane.querySelector(".term-body");
  promptEl.textContent = termPrompt();
  termPrint("PerchanceOS terminal \u2014 type \"help\" to get started.");
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      const v = input.value;
      input.value = "";
      termHistIdx = -1;
      if (v.trim()) {
        termHistory.push(v);
        if (termHistory.length > 200) termHistory.shift();
      }
      termHandle(v);
    } else if (e.key === "ArrowUp") {
      if (termHistory.length) {
        termHistIdx = termHistIdx === -1 ? termHistory.length - 1 : Math.max(0, termHistIdx - 1);
        input.value = termHistory[termHistIdx];
      }
      e.preventDefault();
    } else if (e.key === "ArrowDown") {
      if (termHistIdx !== -1) {
        termHistIdx = Math.min(termHistory.length, termHistIdx + 1);
        input.value = termHistIdx === termHistory.length ? "" : termHistory[termHistIdx];
      }
      e.preventDefault();
    } else if (e.ctrlKey && e.key.toLowerCase() === "c") {
      input.value = "";
    }
  });
}

function termPrompt() {
  return (store.cwd ? "/" + store.cwd : "") + " $ ";
}

function termPrint(text, cls) {
  const body = document.querySelector(".term-body");
  if (!body) return;
  const d = document.createElement("div");
  d.className = "term-line" + (cls ? " " + cls : "");
  d.textContent = text;
  body.appendChild(d);
  body.scrollTop = body.scrollHeight;
  const p = document.querySelector(".term-prompt");
  if (p) p.textContent = termPrompt();
}

function resolveTerm(arg) {
  if (!arg) return store.cwd;
  let p = arg.startsWith("/") ? arg.slice(1) : (store.cwd ? store.cwd + "/" : "") + arg;
  const parts = [];
  for (const seg of p.split("/")) {
    if (seg === "" || seg === ".") continue;
    if (seg === "..") parts.pop();
    else parts.push(seg);
  }
  return parts.join("/");
}

function uiSync() {
  renderSidebar();
  renderTabs();
  renderStatus();
  if (store.activePath) editor.openFile(store.activePath);
}

function termHandle(line) {
  termPrint(line);
  const parts = line.trim().match(/("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|\S+)/g) || [];
  const cmd = (parts[0] || "").toLowerCase();
  const args = parts.slice(1).map((a) => a.replace(/^["']|["']$/g, ""));
  const out = (...a) => termPrint(a.join(" "));
  switch (cmd) {
    case "":
      break;
    case "help":
      out("Commands: help, ls, cd, cat, pwd, touch, mkdir, rm, echo, open, run, clear, date, whoami, cp, mv, grep, find, head, tail");
      break;
    case "clear":
      document.querySelector(".term-body").innerHTML = "";
      break;
    case "whoami":
      out("code");
      break;
    case "date":
      out(new Date().toString());
      break;
    case "pwd":
      out("/" + store.cwd);
      break;
    case "ls": {
      const p = resolveTerm(args[0]);
      if (store.vfs.isDir(p)) {
        for (const it of store.vfs.listDir(p)) out(it.name + (it.node.type === "dir" ? "/" : ""));
      } else {
        out("ls: " + (args[0] || "") + ": not a directory");
      }
      break;
    }
    case "cd": {
      if (!args[0]) store.cwd = "";
      else if (store.vfs.isDir(resolveTerm(args[0]))) store.cwd = resolveTerm(args[0]);
      else out("cd: no such directory: " + args[0]);
      break;
    }
    case "cat": {
      const p = resolveTerm(args[0]);
      const c = store.vfs.read(p);
      if (c === null) out("cat: " + (args[0] || "") + ": no such file");
      else for (const ln of c.split("\n").slice(0, 300)) termPrint(ln);
      break;
    }
    case "touch": {
      if (store.readOnly) { out("touch: read-only workspace"); break; }
      const p = resolveTerm(args[0]);
      if (store.vfs.write(p, store.vfs.read(p) ?? "")) {
        schedulePersist();
        uiSync();
        out("created " + (p || "?"));
      } else out("touch: cannot create " + (args[0] || ""));
      break;
    }
    case "mkdir": {
      if (store.readOnly) { out("mkdir: read-only workspace"); break; }
      const p = resolveTerm(args[0]);
      if (p && store.vfs.createDir(p)) {
        store.expanded.add(p);
        schedulePersist();
        uiSync();
        out("ok");
      } else out("mkdir: cannot create " + (args[0] || ""));
      break;
    }
    case "rm": {
      if (store.readOnly) { out("rm: read-only workspace"); break; }
      const p = resolveTerm(args[0]);
      if (p && store.vfs.delete(p)) {
        store.dirty.delete(p);
        const i = store.tabs.indexOf(p);
        if (i > -1) store.tabs.splice(i, 1);
        if (store.activePath === p) {
          store.activePath = store.tabs.length ? store.tabs[store.tabs.length - 1] : null;
          if (store.activePath) editor.openFile(store.activePath);
          else showWelcome(true);
        }
        schedulePersist();
        uiSync();
        out("removed " + p);
      } else out("rm: cannot remove " + (args[0] || ""));
      break;
    }
    case "echo": {
      if (store.readOnly) { out("echo: read-only workspace"); break; }
      const eq = args.indexOf(">");
      if (eq > -1) {
        const p = resolveTerm(args[eq + 1]);
        const content = args.slice(0, eq).join(" ") + "\n";
        if (store.vfs.write(p, (store.vfs.read(p) || "") + content)) {
          schedulePersist();
          uiSync();
          out("ok");
        } else out("echo: cannot write " + (args[eq + 1] || ""));
      } else out(args.join(" "));
      break;
    }
    case "open": {
      const p = resolveTerm(args[0]);
      if (store.vfs.read(p) !== null) openFile(p);
      else out("open: no such file: " + (args[0] || ""));
      break;
    }
    case "run": {
      const p = args[0] ? resolveTerm(args[0]) : store.activePath;
      if (p && store.vfs.read(p) !== null) bus.emit("runfile", p);
      else out("run: no such file");
      break;
    }
    case "cp": {
      if (store.readOnly) { out("cp: read-only workspace"); break; }
      const rec = args.includes("-r");
      const verbose = args.includes("-v");
      const pos = args.filter((a) => !a.startsWith("-"));
      if (pos.length < 2) { out("usage: cp [-r] [-v] <src> <dst>"); break; }
      const src = resolveTerm(pos[0]);
      const dst = resolveTerm(pos[pos.length - 1]);
      const srcNode = store.vfs.get(src);
      if (!srcNode) { out("cp: no such file: " + pos[0]); break; }
      if (srcNode.type === "dir" && !rec) { out("cp: -r required to copy a directory"); break; }
      let targetDir = dst;
      let targetName = src.split("/").pop();
      if (store.vfs.isDir(dst)) {
        if (store.vfs.get(dst + "/" + targetName)) { out("cp: " + dst + "/" + targetName + " already exists"); break; }
      } else {
        targetDir = store.vfs.parentDir(dst);
        targetName = dst.split("/").pop();
        if (!store.vfs.get(targetDir) || !store.vfs.isDir(targetDir)) { out("cp: no such directory: " + targetDir || "/"); break; }
        if (store.vfs.get(dst)) { out("cp: " + dst + " already exists"); break; }
      }
      const targetPath = (targetDir ? targetDir + "/" : "") + targetName;
      const copyInto = (from, to) => {
        for (const p of store.vfs.walkFiles()) {
          if (p === from || p.startsWith(from + "/")) {
            store.vfs.write(to + p.slice(from.length), store.vfs.read(p) || "");
            if (verbose) out("copied " + to + p.slice(from.length));
          }
        }
        if (srcNode.type === "dir") store.vfs.createDir(to);
      };
      copyInto(src, targetPath);
      if (store.vfs.get(targetPath) || srcNode.type === "dir") {
        schedulePersist();
        uiSync();
        out("copied " + src + " -> " + targetPath);
      } else out("cp: failed");
      break;
    }
    case "mv": {
      if (store.readOnly) { out("mv: read-only workspace"); break; }
      if (args.length < 2) { out("usage: mv <src> <dst>"); break; }
      const src = resolveTerm(args[0]);
      const dst = resolveTerm(args[args.length - 1]);
      const srcNode = store.vfs.get(src);
      if (!srcNode) { out("mv: no such file: " + args[0]); break; }
      const isDir = srcNode.type === "dir";
      let destDir;
      if (store.vfs.isDir(dst)) destDir = dst;
      else {
        destDir = store.vfs.parentDir(dst);
        if (!store.vfs.isDir(destDir)) { out("mv: no such directory: " + (destDir || "/")); break; }
        if (store.vfs.get(dst) !== null && dst !== src) { out("mv: " + dst + " already exists"); break; }
      }
      const res = store.vfs.move(src, destDir);
      if (res.error) { out("mv: " + res.error); break; }
      let newPath = res.path;
      if (!store.vfs.isDir(dst)) {
        const finalName = dst.split("/").pop();
        if (finalName !== newPath.split("/").pop()) {
          const r = store.vfs.rename(newPath, finalName);
          if (!r) { out("mv: rename failed"); break; }
          newPath = newPath.slice(0, newPath.length - newPath.split("/").pop().length) + finalName;
        }
      }
      updateRefs(src, newPath, isDir);
      history.cleanSnapshots(src, newPath, isDir);
      schedulePersist();
      uiSync();
      out("moved " + src + " -> " + newPath);
      break;
    }
    case "grep": {
      let iFlag = false, nFlag = false, rFlag = false;
      let rest = args.filter((a) => {
        if (a === "-i") { iFlag = true; return false; }
        if (a === "-n") { nFlag = true; return false; }
        if (a === "-r") { rFlag = true; return false; }
        return true;
      });
      if (rest.length < 1) { out("usage: grep [-i] [-n] [-r] <pattern> [path]"); break; }
      const pat = rest[0];
      const startPath = rest[1] !== undefined ? resolveTerm(rest[1]) : store.cwd;
      const files = rFlag || rest[1] === undefined
        ? store.vfs.walkFiles().filter((p) => !startPath || p.startsWith(startPath + "/") || p === startPath)
        : store.vfs.read(startPath) !== null ? [startPath] : [];
      const needle = iFlag ? pat.toLowerCase() : pat;
      let hits = 0;
      for (const p of files) {
        const content = store.vfs.read(p);
        if (content === null) continue;
        const lines = content.split("\n");
        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          const hay = iFlag ? line.toLowerCase() : line;
          if (hay.includes(needle)) {
            out((rFlag || rest[1] === undefined ? p + ":" : "") + (nFlag ? i + 1 + ":" : "") + line);
            hits++;
          }
        }
      }
      if (!hits) out("grep: no matches");
      break;
    }
    case "find": {
      let namePat = null, typePat = null;
      const rest = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-name" && args[i + 1]) { namePat = args[++i]; continue; }
        if (args[i] === "-type" && args[i + 1]) { typePat = args[++i]; continue; }
        rest.push(args[i]);
      }
      const startPath = rest.length ? resolveTerm(rest[0]) : store.cwd;
      if (!store.vfs.isDir(startPath)) { out("find: " + (rest[0] || "") + ": not a directory"); break; }
      const re = namePat ? new RegExp("^" + namePat.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*").replace(/\?/g, ".") + "$") : null;
      const prefix = startPath ? startPath + "/" : "";
      let found = 0;
      for (const p of store.vfs.walkNodes()) {
        if (p === startPath || (prefix && !p.startsWith(prefix))) continue;
        const node = store.vfs.get(p);
        const isD = node && node.type === "dir";
        if (typePat === "d" && !isD) continue;
        if (typePat === "f" && isD) continue;
        if (re && !re.test(p.split("/").pop())) continue;
        out(p + (isD ? "/" : ""));
        found++;
      }
      if (!found) out("find: no results");
      break;
    }
    case "head":
    case "tail": {
      let n = 10;
      let rest = [];
      for (let i = 0; i < args.length; i++) {
        if (args[i] === "-n" && args[i + 1] && /^\d+$/.test(args[i + 1])) { n = parseInt(args[++i], 10); continue; }
        rest.push(args[i]);
      }
      const p = resolveTerm(rest[0]);
      const c = store.vfs.read(p);
      if (c === null) { out(cmd + ": no such file: " + (rest[0] || "")); break; }
      const lines = c.split("\n");
      if (lines.length && lines[lines.length - 1] === "") lines.pop();
      const sel = cmd === "head" ? lines.slice(0, n) : lines.slice(Math.max(0, lines.length - n));
      for (const ln of sel) termPrint(ln);
      break;
    }
    default:
      out(cmd + ": command not found \u2014 try 'help'");
  }
}

function buildOutput() {
  $("#pane-output").innerHTML = `<div class="out-head"><span class="out-title"></span><span class="out-status"></span></div><div class="out-body"></div>`;
}

export function outputClear(path) {
  const b = document.querySelector(".out-body");
  if (b) b.innerHTML = "";
  const t = document.querySelector(".out-title");
  if (t) t.textContent = path ? "OUTPUT \u2014 " + path : "OUTPUT";
  outputStatus("");
}

export function outputStatus(text) {
  const s = document.querySelector(".out-status");
  if (!s) return;
  s.innerHTML = text ? `<span class="spinner"></span> ${esc(text)}` : "";
}

export function outputLine({ type = "log", text = "" }) {
  const b = document.querySelector(".out-body");
  if (!b) return;
  if (type === "clear") {
    b.innerHTML = "";
    return;
  }
  const d = document.createElement("div");
  d.className = "ol ol-" + (["log", "warn", "error", "info"].includes(type) ? type : "log");
  d.textContent = text;
  b.appendChild(d);
  b.scrollTop = b.scrollHeight;
}

function renderProblemsBadges() {
  const pb = $("#pb-problems");
  if (pb) {
    const n = problemsCount();
    pb.textContent = n ? n : "";
    pb.classList.toggle("show", n > 0);
  }
  document.querySelectorAll(".tab-badge").forEach((el) => {
    const tab = el.closest(".tab");
    if (tab) {
      const path = tab.dataset.path;
      const errs = store.problems[path];
      const n = errs ? errs.length : 0;
      el.textContent = n ? n : "";
      el.hidden = !n;
    }
  });
}

export function renderProblemsPane() {
  const pane = $("#pane-problems");
  if (!pane) return;
  pane.innerHTML = "";
  const groups = {};
  for (const [path, errs] of Object.entries(store.problems)) {
    if (errs && errs.length && store.vfs.read(path) !== null) groups[path] = errs;
  }
  const paths = Object.keys(groups).sort();
  if (!paths.length) {
    const empty = document.createElement("div");
    empty.className = "pr-empty";
    empty.textContent = "No problems detected in your JavaScript files.";
    pane.appendChild(empty);
    return;
  }
  for (const path of paths) {
    const errs = groups[path];
    const head = document.createElement("div");
    head.className = "pr-head";
    head.innerHTML = `${fileIcon(path)}<span class="pr-path">${esc(path)}</span><span class="pr-count">${errs.length}</span>`;
    head.addEventListener("click", () => openFile(path));
    pane.appendChild(head);
    for (const e of errs) {
      const row = document.createElement("div");
      row.className = "pr-entry";
      row.innerHTML = `<span class="pr-sev">✖</span><span class="pr-line">${e.line}, ${e.col + 1}</span><span class="pr-msg">${esc(e.message)}</span>`;
      row.addEventListener("click", async () => {
        await openFile(path);
        editor.goToLine(e.line, e.col + 1);
      });
      pane.appendChild(row);
    }
  }
}

function renderHistoryInto(el) {
  const files = Object.keys(store.snapshots).filter((p) => store.vfs.read(p) !== null).sort();
  const active = store.activePath;
  let pick = files.includes(active) ? active : files[0];
  el.innerHTML = `
    <div class="hist-head"><span>FILE</span>
      <select class="hist-file">${files.map((f) => `<option value="${esc(f)}"${f === pick ? " selected" : ""}>${esc(f)}</option>`).join("") || "<option value=''>no snapshots yet</option>"}</select>
    </div>
    <div class="hist-hint">Every file save is snapshotted. Restore any version or diff it against the current content.</div>
    <div class="hist-list"></div>`;
  const sel = el.querySelector(".hist-file");
  if (!sel) return;
  sel.addEventListener("change", () => {
    pick = sel.value;
    renderHistoryList(el, pick);
  });
  renderHistoryList(el, pick);
}

function renderHistoryList(el, pick) {
  const list = el.querySelector(".hist-list");
  list.innerHTML = "";
  const snaps = history.snapshotsFor(pick);
  if (!snaps.length) {
    const empty = document.createElement("div");
    empty.className = "hist-empty";
    empty.textContent = "No snapshots for this file yet — save the file to create one.";
    list.appendChild(empty);
    return;
  }
  for (let i = snaps.length - 1; i >= 0; i--) {
    const s = snaps[i];
    const d = new Date(s.ts);
    const when = d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
    const row = document.createElement("div");
    row.className = "hist-row";
    row.innerHTML = `<span class="hist-when">${esc(when)}</span><span class="hist-meta">${s.content.length} chars</span>
      <button class="btn hist-btn hist-restore">Restore</button>
      <button class="btn hist-btn hist-diff">Diff</button>`;
    row.querySelector(".hist-restore").addEventListener("click", () => {
      history.restoreSnapshot(pick, s.content);
    });
    row.querySelector(".hist-diff").addEventListener("click", () => {
      const current = store.vfs.read(pick) || "";
      showDiffModal("Diff — " + pick, "Snapshot (" + when + ")", s.content, "Current", current);
    });
    list.appendChild(row);
  }
}

export function showDiffModal(title, oldLabel, oldText, newLabel, newText, actions) {
  const rows = diff.buildRows(oldText, newText);
  let added = 0;
  let removed = 0;
  for (const r of rows) {
    if (r.t === "add") added++;
    else if (r.t === "del") removed++;
  }
  const hunks = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].t !== "ctx") {
      const start = i;
      while (i < rows.length && rows[i].t !== "ctx") i++;
      hunks.push({ start, end: i - 1 });
    }
  }
  const cur = { idx: hunks.length ? 0 : -1 };
  const elsA = [];
  const elsB = [];
  const buildCol = (side, els) => {
    const col = document.createElement("div");
    col.className = "diff-col";
    for (const r of rows) {
      const d = document.createElement("div");
      const num = side === "a" ? r.a : r.b;
      const text = side === "a" ? (r.t === "add" ? "" : r.text) : r.t === "del" ? "" : r.text;
      d.className = "diff-row";
      if (r.t === "add" && side === "b") d.classList.add("diff-add");
      if (r.t === "del" && side === "a") d.classList.add("diff-del");
      const ln = document.createElement("span");
      ln.className = "diff-ln";
      ln.textContent = num;
      const txt = document.createElement("span");
      txt.className = "diff-txt";
      txt.textContent = text;
      d.append(ln, txt);
      els.push(d);
      col.appendChild(d);
    }
    return col;
  };
  const actionsHtml = actions
    ? `<div class="modal-btns">${actions.rejectLabel ? `<button class="btn" id="dmReject">${esc(actions.rejectLabel)}</button>` : ""}<button class="btn ${actions.applyLabel ? "" : "primary"}" id="dmApply">${esc(actions.applyLabel || "Close")}</button></div>`
    : "";
  const navHtml = hunks.length
    ? `<div class="diff-nav"><button class="btn" id="dnPrev" title="Previous change">◀</button><span class="diff-pos" id="dnPos">1 / ${hunks.length}</span><button class="btn" id="dnNext" title="Next change">▶</button></div>`
    : "";
  overlayShow(
    `<div class="modal modal-diff"><div class="modal-head"><span class="diff-title">${esc(title)}</span>${navHtml}<button class="modal-close">×</button></div>
      <div class="diff-meta">${removed} removed &middot; ${added} added</div>
      <div class="diff-labels"><span class="diff-oldlabel">${esc(oldLabel)}</span><span class="diff-newlabel">${esc(newLabel)}</span></div>
      <div class="diff-scroll"></div>
      ${actionsHtml}
    </div>`
  );
  const scroll = $(".diff-scroll");
  if (scroll) scroll.append(buildCol("a", elsA), buildCol("b", elsB));
  const highlight = () => {
    elsA.forEach((el) => el.classList.remove("diff-cur"));
    elsB.forEach((el) => el.classList.remove("diff-cur"));
    if (cur.idx >= 0 && hunks[cur.idx]) {
      for (let i = hunks[cur.idx].start; i <= hunks[cur.idx].end; i++) {
        if (elsA[i]) elsA[i].classList.add("diff-cur");
        if (elsB[i]) elsB[i].classList.add("diff-cur");
      }
    }
  };
  const updatePos = () => {
    const p = $("#dnPos");
    if (p) p.textContent = hunks.length ? cur.idx + 1 + " / " + hunks.length : "";
  };
  const go = (d) => {
    if (!hunks.length) return;
    cur.idx = (cur.idx + d + hunks.length) % hunks.length;
    highlight();
    updatePos();
    const row = elsB[hunks[cur.idx].start] || elsA[hunks[cur.idx].start];
    if (row) row.scrollIntoView({ block: "center", behavior: "smooth" });
  };
  $(".modal-close").onclick = () => overlayHide();
  if (actions && actions.rejectLabel) {
    $("#dmReject").onclick = () => {
      overlayHide();
      if (actions.onReject) actions.onReject();
    };
  }
  const applyBtn = $("#dmApply");
  if (applyBtn) {
    applyBtn.onclick = () => {
      overlayHide();
      if (actions && actions.onApply) actions.onApply();
    };
  }
  const pv = $("#dnPrev");
  if (pv) pv.onclick = () => go(-1);
  const nx = $("#dnNext");
  if (nx) nx.onclick = () => go(1);
  highlight();
  updatePos();
  const redraw = () => {
    const cols = document.querySelectorAll(".modal-diff .diff-col");
    const st = scroll && scroll.scrollTop;
    cols.forEach((c) => (c.scrollTop = st || 0));
  };
  if (scroll) {
    scroll.addEventListener("scroll", redraw, { passive: true });
    redraw();
  }
}

let searchQuery = "";
let searchRegex = false;
let searchCase = false;
let searchTimer = null;

function renderSearchInto(el) {
  el.innerHTML = `
    <div class="search-wrap">
      <input class="search-input" placeholder="Search workspace" spellcheck="false" value="${esc(searchQuery)}">
      <div class="search-tools">
        <button class="s-tool${searchRegex ? " active" : ""}" id="stRegex" title="Use regular expression">.*</button>
        <button class="s-tool${searchCase ? " active" : ""}" id="stCase" title="Match case">Aa</button>
        <span class="search-err" id="searchErr"></span>
      </div>
    </div>
    <div class="search-meta"></div>
    <div class="search-results"></div>`;
  const input = el.querySelector(".search-input");
  input.addEventListener("input", () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchQuery = input.value;
      doSearch(searchQuery, el);
    }, 250);
  });
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      clearTimeout(searchTimer);
      searchQuery = input.value;
      doSearch(searchQuery, el);
    }
  });
  el.querySelector("#stRegex").addEventListener("click", () => {
    searchRegex = !searchRegex;
    renderSearchInto(el);
    const inp = el.querySelector(".search-input");
    if (inp) inp.focus();
  });
  el.querySelector("#stCase").addEventListener("click", () => {
    searchCase = !searchCase;
    renderSearchInto(el);
    const inp = el.querySelector(".search-input");
    if (inp) inp.focus();
  });
  if (searchQuery) doSearch(searchQuery, el);
}

export function focusSearch() {
  setView("search");
  const i = document.querySelector(".search-input");
  if (i) i.focus();
}

function doSearch(q, el) {
  const meta = el.querySelector(".search-meta");
  const res = el.querySelector(".search-results");
  const err = el.querySelector("#searchErr");
  res.innerHTML = "";
  if (err) err.textContent = "";
  if (!q.trim()) {
    if (meta) meta.textContent = "Type to search across files.";
    return;
  }
  const query = q.trim();
  let re = null;
  let flags = searchCase ? "" : "i";
  if (searchRegex) {
    try {
      re = new RegExp(query, flags + "g");
    } catch (e) {
      if (err) err.textContent = "Invalid regular expression";
      if (meta) meta.textContent = "";
      return;
    }
  }
  const ql = query.toLowerCase();
  let fileCount = 0;
  let matchCount = 0;
  for (const path of store.vfs.walkFiles()) {
    if (matchCount >= 100) break;
    const content = store.vfs.read(path) || "";
    const matches = [];
    if (re) {
      let m;
      re.lastIndex = 0;
      while ((m = re.exec(content)) !== null && matches.length < 20) {
        if (m[0].length === 0) {
          re.lastIndex++;
          if (re.lastIndex > content.length) break;
          continue;
        }
        matches.push({ from: m.index, len: m[0].length });
        if (m.index === re.lastIndex) re.lastIndex++;
        if (re.lastIndex > content.length) break;
      }
    } else {
      const lower = content.toLowerCase();
      let idx = -1;
      while ((idx = lower.indexOf(ql, idx + 1)) !== -1 && matches.length < 20) matches.push({ from: idx, len: query.length });
    }
    if (!matches.length) continue;
    fileCount++;
    matchCount += matches.length;
    const head = document.createElement("div");
    head.className = "s-filehead";
    head.innerHTML = `${fileIcon(path)}<span class="s-path">${esc(path)}</span><span class="s-count">${matches.length}</span>`;
    head.addEventListener("click", async () => {
      await openFile(path);
      editor.goTo(matches[0].from);
    });
    res.appendChild(head);
    for (const m of matches.slice(0, 5)) {
      const lineStart = content.lastIndexOf("\n", m.from) + 1;
      const lineEnd = content.indexOf("\n", m.from);
      const end = lineEnd === -1 ? content.length : lineEnd;
      const lineNo = content.slice(0, lineStart).split("\n").length;
      const row = document.createElement("div");
      row.className = "s-match";
      const num = document.createElement("span");
      num.className = "s-line";
      num.textContent = lineNo;
      const txt = document.createElement("span");
      txt.className = "s-text";
      const mk = document.createElement("mark");
      mk.textContent = content.slice(m.from, m.from + m.len);
      txt.append(content.slice(lineStart, m.from), mk, content.slice(m.from + m.len, end));
      row.append(num, txt);
      row.addEventListener("click", async () => {
        await openFile(path);
        editor.selectRange(m.from, m.from + m.len);
      });
      res.appendChild(row);
    }
  }
  if (meta)
    meta.textContent = matchCount
      ? `${matchCount} result${matchCount > 1 ? "s" : ""} in ${fileCount} file${fileCount > 1 ? "s" : ""}`
      : `No results for "${query}"`;
}

function renderScmInto(el) {
  const changes = [...store.dirty];
  el.innerHTML = `
    <div class="scm-bar">${icon("branch")} main <span class="scm-count">${changes.length ? changes.length + " changes" : ""}</span></div>
    ${changes.length ? `<div class="scm-message-row"><input class="scm-input" placeholder="Message (Ctrl+Enter to commit&hellip;)" spellcheck="false"><button class="scm-commit" title="Commit">&#10003;</button></div>` : ""}
    <div class="scm-changes"></div>`;
  const list = el.querySelector(".scm-changes");
  if (!changes.length) {
    list.innerHTML = `<div class="scm-empty">${icon("check")} You have no changes.</div>`;
  } else {
    const head = document.createElement("div");
    head.className = "scm-section-title";
    head.textContent = `CHANGES (${changes.length})`;
    list.appendChild(head);
    for (const p of changes) {
      const row = document.createElement("div");
      row.className = "change-row";
      row.title = p;
      row.innerHTML = `${fileIcon(p)}<span class="cname">${esc(p.split("/").pop())}</span><span class="m-badge">M</span>`;
      row.addEventListener("click", () => openFile(p));
      list.appendChild(row);
    }
  }
  const inp = el.querySelector(".scm-input");
  const btn = el.querySelector(".scm-commit");
  const commit = () => bus.emit("commit");
  if (inp) {
    inp.addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") commit();
    });
  }
  if (btn) btn.addEventListener("click", commit);
}

function onCommit() {
  const n = store.dirty.size;
  for (const p of [...store.dirty]) {
    const doc = store.vfs.read(p) || "";
    store.saved[p] = doc;
    store.dirty.delete(p);
    history.addSnapshot(p, doc);
  }
  schedulePersist();
  renderSidebar();
  renderStatus();
  renderTabs();
  toast(n ? "Committed " + n + " file" + (n > 1 ? "s" : "") + " to main" : "Nothing to commit");
}

function renderRunInto(el) {
  el.innerHTML = `
    <div class="run-section">
      <button class="run-btn" id="runActiveBtn">&#9654;&nbsp; Run and Debug</button>
      <div class="run-hint">Runs the active JavaScript file (Ctrl+F5). Output appears in the OUTPUT panel.</div>
    </div>
    <div class="run-group"><span class="run-title">VARIABLES</span><div class="run-placeholder">Not available</div></div>
    <div class="run-group"><span class="run-title">WATCH</span><div class="run-placeholder">Not available</div></div>
    <div class="run-group"><span class="run-title">CALL STACK</span><div class="run-placeholder">Not available</div></div>`;
  $("#runActiveBtn").addEventListener("click", () => bus.emit("runfile", store.activePath));
}

function renderExtensionsInto(el) {
  const exts = [
    { name: "Perchance Preview", desc: "Live preview for Perchance generators.", ver: "1.4.2", color: "#3794ff", glyph: "P" },
    { name: "Rainbow Brackets", desc: "Colorizes matching brackets.", ver: "6.21.0", color: "#7f5af0", glyph: "[]" },
    { name: "GitLens", desc: "Supercharge your source control.", ver: "14.8.2", color: "#f0762c", glyph: "G" },
    { name: "Prettier", desc: "Code formatter for JS, CSS, HTML and more.", ver: "10.5.0", color: "#56b3b4", glyph: "P" },
    { name: "Code Spell Checker", desc: "Catch typos as you type.", ver: "3.0.1", color: "#e26b9c", glyph: "S" },
  ];
  el.innerHTML = `<div class="ext-list">${exts
    .map(
      (x) => `<div class="ext-card"><div class="ext-logo" style="background:${x.color}">${x.glyph}</div><div class="ext-body"><div class="ext-name">${esc(x.name)}<span class="pill">Installed</span></div><div class="ext-desc">${esc(x.desc)}</div><div class="ext-ver">v${x.ver}</div></div></div>`
    )
    .join("")}</div>`;
}

export function openSettings() {
  const s = store.settings;
  const ac = store.settings.ai || { provider: "perchance", model: "", key: "", baseUrl: "" };
  const needsUrl = ac.provider === "foundry" || ac.provider === "custom";
  overlayShow(`<div class="modal"><div class="modal-head">Settings<button class="modal-close">&times;</button></div><div class="modal-body">
    <div class="set-head">Editor</div>
    <label class="set-row"><span>Theme</span><select id="set-theme"><option value="dark">Dark</option><option value="light">Light</option><option value="hc">High Contrast</option></select></label>
    <label class="set-row"><span>Accent color</span><span class="set-ctrl set-accent"><input type="color" id="set-accent"><b id="set-accentv"></b></span></label>
    <label class="set-row"><span>Font size</span><span class="set-ctrl"><input type="range" id="set-font" min="10" max="22" step="1"><b id="set-fontv"></b></span></label>
    <label class="set-row"><span>Tab size</span><select id="set-tab"><option value="2">2</option><option value="4">4</option><option value="8">8</option></select></label>
    <label class="set-row"><span>Word wrap</span><input type="checkbox" id="set-wrap" class="chk"></label>
    <label class="set-row"><span>Minimap</span><input type="checkbox" id="set-minimap" class="chk"></label>
    <div class="set-head">AI</div>
    <label class="set-row"><span>Provider</span><select id="set-ai-provider">
      <option value="perchance">Perchance (free)</option>
      <option value="openai">OpenAI</option>
      <option value="openrouter">OpenRouter</option>
      <option value="foundry">Microsoft Foundry</option>
      <option value="hf">Hugging Face</option>
      <option value="custom">Custom (OpenAI-compatible)</option>
    </select></label>
    <label class="set-row"><span>Model</span><input id="set-ai-model" type="text" spellcheck="false" placeholder="e.g. gpt-4o-mini"></label>
    <label class="set-row"><span>API key</span><input id="set-ai-key" type="password" spellcheck="false" placeholder="sk-…" autocomplete="off"></label>
    <label class="set-row" id="set-ai-urlrow"${needsUrl ? "" : " hidden"}><span>Base URL</span><input id="set-ai-url" type="text" spellcheck="false" placeholder="https://…/v1/chat/completions"></label>
    <div class="set-note">Perchance gives you free AI with no setup. For the other providers, paste your own API key — it is stored only in this browser and sent straight to that provider (via Perchance's proxy). If no key is set, Perchance (free) is used automatically.</div>
    <div class="set-foot">Settings are stored in your browser. <button class="btn-xs" id="set-openkb">Open keybindings.json</button></div>
  </div></div>`);
  $("#set-theme").value = s.theme;
  $("#set-font").value = s.fontSize;
  $("#set-fontv").textContent = s.fontSize + "px";
  $("#set-tab").value = String(s.tabSize);
  $("#set-wrap").checked = s.wordWrap;
  $("#set-minimap").checked = !!s.minimap;
  $("select[id='set-ai-provider']").value = ac.provider;
  $("input[id='set-ai-model']").value = ac.model || "";
  $("input[id='set-ai-key']").value = ac.key || "";
  $("input[id='set-ai-url']").value = ac.baseUrl || "";
  $("#set-accent").value = /^#[0-9a-fA-F]{6}$/.test(s.accent || "") ? s.accent : "#007acc";
  $("#set-accentv").textContent = s.accent;
  $("#set-theme").onchange = (e) => { s.theme = e.target.value; applySettings(); };
  $("#set-accent").oninput = (e) => { s.accent = e.target.value.toUpperCase(); $("#set-accentv").textContent = s.accent; applySettings(); };
  $("#set-font").oninput = (e) => { s.fontSize = +e.target.value; $("#set-fontv").textContent = s.fontSize + "px"; applySettings(); };
  $("#set-tab").onchange = (e) => { s.tabSize = +e.target.value; applySettings(); };
  $("#set-wrap").onchange = (e) => { s.wordWrap = e.target.checked; applySettings(); };
  $("#set-minimap").onchange = (e) => { s.minimap = e.target.checked; applySettings(); };
  const emitAi = () => bus.emit("settings-ai");
  $("#set-ai-provider").onchange = (e) => {
    ac.provider = e.target.value;
    $("label[id='set-ai-urlrow']").hidden = !(ac.provider === "foundry" || ac.provider === "custom");
    schedulePersist();
    emitAi();
  };
  $("#set-ai-model").oninput = (e) => { ac.model = e.target.value; schedulePersist(); emitAi(); };
  $("#set-ai-key").oninput = (e) => { ac.key = e.target.value; schedulePersist(); emitAi(); };
  $("#set-ai-url").oninput = (e) => { ac.baseUrl = e.target.value; schedulePersist(); emitAi(); };
  $(".modal-close").onclick = () => overlayHide();
  const openKbBtn = $("button[id='set-openkb']");
  if (openKbBtn) {
    openKbBtn.onclick = () => {
      overlayHide();
      openFile(keyb.openKeybindings());
      toast("Edit and save to apply keybindings");
    };
  }
}

export function applySettings() {
  document.documentElement.dataset.theme = store.settings.theme;
  const accent = /^#[0-9a-fA-F]{6}$/.test(store.settings.accent || "") ? store.settings.accent : "#007acc";
  document.documentElement.style.setProperty("--accent", accent);
  document.documentElement.style.setProperty("--statusbar", accent);
  document.documentElement.style.setProperty("--edfont", store.settings.fontSize + "px");
  editor.applyMinimap();
  editor.rebuild();
  schedulePersist();
  renderStatus();
}

export function toggleMinimap() {
  store.settings.minimap = !store.settings.minimap;
  applySettings();
  toast("Minimap: " + (store.settings.minimap ? "on" : "off"));
}

export function prompt(title, placeholder, initial, onSubmit) {
  promptModal(title, placeholder, initial, onSubmit);
}

export function changeFont(d) {
  store.settings.fontSize = Math.max(10, Math.min(22, store.settings.fontSize + d));
  applySettings();
  toast("Font size: " + store.settings.fontSize + "px");
}

export function toggleWordWrap() {
  store.settings.wordWrap = !store.settings.wordWrap;
  applySettings();
  toast("Word Wrap: " + (store.settings.wordWrap ? "on" : "off"));
}

export function toast(msg, ms = 2600) {
  const t = document.createElement("div");
  t.className = "toast";
  t.textContent = msg;
  $("#toasts").appendChild(t);
  setTimeout(() => {
    t.classList.add("out");
    setTimeout(() => t.remove(), 350);
  }, ms);
}
