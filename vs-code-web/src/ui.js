import { store, bus, schedulePersist } from "./store.js";
import * as editor from "./editor.js";

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
  branch: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M5 3a2 2 0 1 0-3 1.7V11.3A2 2 0 1 0 5 11V6.9a4 4 0 0 0 4 0v1.4a2 2 0 1 0 1 1.7V6A2 2 0 0 0 8 4H5zm-2 0a1 1 0 1 1 0 2 1 1 0 0 1 0-2zm0 12a1 1 0 1 1 0-2 1 1 0 0 1 0 2zm11-3a1 1 0 1 1-2 0 1 1 0 0 1 2 0z"/></svg>',
  check: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M6.5 12.5 2.2 8.2l1.4-1.4 2.9 2.9 5.9-5.9 1.4 1.4z"/></svg>',
  sync: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M13 8a5 5 0 0 1-8.8 3.4l1.2-1.2A3.5 3.5 0 0 0 11.5 8H13zm.9-2H11.4a3.5 3.5 0 0 0-6.2 2.1l1.2-1.2A5 5 0 0 1 13.9 6zM8 1.5A6.5 6.5 0 0 0 1.5 8H4A4 4 0 0 1 8 4zM8 14.5A6.5 6.5 0 0 0 14.5 8H12A4 4 0 0 1 8 12z"/></svg>',
  bell: '<svg viewBox="0 0 16 16" fill="currentColor"><path d="M8 1a4.5 4.5 0 0 1 4.5 4.5v2.7l1.4 2.2a.7.7 0 0 1-.6 1.1H2.7a.7.7 0 0 1-.6-1.1l1.4-2.2V5.5A4.5 4.5 0 0 1 8 1zm-1 11h2a1.5 1.5 0 0 1-2 0z"/></svg>',
  eye: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/></svg>',
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
let panelVisible = false;
let panelTab = "terminal";
let cursorInfo = { line: 1, col: 1 };
let pendingCreate = null;
let pendingRename = null;
let termHistory = [];
let termHistIdx = -1;
let searchQuery = "";
let searchTimer = null;
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
  bus.on("docchange", (path, dirty) => markTabDirty(path, dirty));
  bus.on("saved", (path) => {
    markTabDirty(path, false);
    renderSidebar();
  });
  bus.on("open", () => {
    renderTabs();
    renderSidebar();
    renderStatus();
  });
  bus.on("commit", onCommit);
  document.addEventListener("click", (e) => {
    if (!e.target.closest("#ctxmenu")) hideMenu();
  });
  window.addEventListener("blur", () => hideMenu());
  const mq = window.matchMedia("(max-width: 780px)");
  if (mq.matches) showSidebar(false);
  mq.addEventListener("change", (e) => {
    if (e.matches && sidebarVisible) showSidebar(false);
    else if (!e.matches && !sidebarVisible && currentView === "explorer") showSidebar(true);
  });
}

function buildChrome() {
  const actBtns = [
    { id: "explorer", icon: "files", title: "Explorer (Ctrl+Shift+E)" },
    { id: "search", icon: "search", title: "Search (Ctrl+Shift+F)" },
    { id: "scm", icon: "scm", title: "Source Control" },
    { id: "run", icon: "run", title: "Run and Debug (Ctrl+F5)" },
    { id: "extensions", icon: "ext", title: "Extensions" },
  ];
  $("#activitybar").innerHTML =
    `<div class="act-top">${actBtns.map((b) => `<button class="act-btn" data-view="${b.id}" title="${b.title}">${icon(b.icon)}</button>`).join("")}</div>` +
    `<div class="act-bottom"><button class="act-btn" id="actSettings" title="Settings (Ctrl+,)">${icon("gear")}</button></div>`;
  document.querySelectorAll(".act-btn[data-view]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.dataset.view;
      if (currentView === id && sidebarVisible) showSidebar(false);
      else {
        setView(id);
        showSidebar(true);
      }
    });
  });
  $("#actSettings").addEventListener("click", () => openSettings());

  $("#sidebar").innerHTML = `<div class="sidebar-title"><span class="st-label"></span><span class="st-actions"></span></div><div class="sidebar-body"></div>`;
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
  $("#sidebar").hidden = !sidebarVisible;
}

export function toggleSidebar() {
  showSidebar(!sidebarVisible);
}

const VIEW_LABELS = { explorer: "EXPLORER", search: "SEARCH", scm: "SOURCE CONTROL", run: "RUN AND DEBUG", extensions: "EXTENSIONS" };

function renderSidebar() {
  const label = $(".st-label");
  const actions = $(".st-actions");
  label.textContent = VIEW_LABELS[currentView] || currentView;
  actions.innerHTML = "";
  if (currentView === "explorer") {
    addActionBtn(actions, "newFile", "New File", () => startCreate("", false));
    addActionBtn(actions, "newFolder", "New Folder", () => startCreate("", true));
    addActionBtn(actions, "collapse", "Collapse All Folders", collapseAll);
  }
  for (const id of Object.keys(viewEls)) viewEls[id].style.display = id === currentView ? "" : "none";
  const el = ensureViewEl(currentView);
  if (currentView === "explorer") renderTreeInto(el);
  else if (currentView === "search") renderSearchInto(el);
  else if (currentView === "scm") renderScmInto(el);
  else if (currentView === "run") renderRunInto(el);
  else if (currentView === "extensions") renderExtensionsInto(el);
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
  return row;
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
}

export function closeAllTabs() {
  store.tabs = [];
  store.activePath = null;
  schedulePersist();
  showWelcome(true);
  renderTabs();
  renderSidebar();
  renderStatus();
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
    t.className = "tab" + (path === store.activePath ? " active" : "");
    t.dataset.path = path;
    t.title = path;
    const name = path.split("/").pop();
    t.innerHTML = `${fileIcon(path)}<span class="tname">${esc(name)}</span><span class="tab-dirty">${store.dirty.has(path) ? "●" : ""}</span><span class="tab-close">×</span>`;
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
    <p class="welcome-sub">A VS Code&ndash;style editor running inside your generator. Files live in your browser and persist across reloads.</p>
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
  $("#editorhost").hidden = !!show;
  $("#welcome").hidden = !show;
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
      <span class="st-item" id="st-branch" title="Branch: main (simulated)">${icon("branch")} main</span>
      <span class="st-item" id="st-sync" title="Sync">${icon("sync")}</span>
      <span class="st-item" id="st-changes" title="Changed files">${icon("check")} ${dirtyN ? dirtyN : "0"}</span>
      <span class="st-item">0 0</span>
    </div>
    <div class="st-right">
      <span class="st-item" id="st-cursor" title="Go to Line">Ln ${cursorInfo.line}, Col ${cursorInfo.col}</span>
      <span class="st-item">Spaces: ${store.settings.tabSize}</span>
      <span class="st-item">UTF-8</span>
      <span class="st-item">LF</span>
      <span class="st-item" id="st-lang" title="${store.langOverride && store.langOverride[store.activePath] ? "Language: " + lang + " (manual override) — click to change" : "Language: " + lang + " — click to change"}">${esc(lang)}</span>
      <span class="st-item" id="st-bell" title="Notifications">${icon("bell")}</span>
      <span class="st-item" id="st-gear" title="Settings (Ctrl+,)">${icon("gear")}</span>
    </div>`;
  $("#st-cursor").onclick = () => promptModal("Go to Line", "Line number", cursorInfo.line, (v) => editor.goToLine(+v));
  $("#st-bell").onclick = () => toast("You're all caught up!");
  $("#st-gear").onclick = () => openSettings();
  $("#st-branch").onclick = () => toast("Branch: main (simulated)");
  $("#st-lang").onclick = () => {
    if (!store.activePath) {
      toast("Open a file to change its language");
      return;
    }
    openPalette("lang");
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

export function openPalette(kind) {
  const isCmd = kind === "cmd";
  const isLang = kind === "lang";
  const placeholder = isCmd
    ? "Type a command name&hellip;"
    : isLang
      ? "Select a language&hellip;"
      : "Open file&hellip;";
  pItems = isCmd
    ? store.cmds.map((c) => ({ label: c.title, keys: c.keys || "", icon: c.icon || "", run: c.run }))
    : isLang
      ? languageItems()
      : store.vfs.walkFiles().map((p) => ({ label: p, keys: "", icon: fileIcon(p), run: () => openFile(p) }));
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
  return [
    { label: "Open", run: () => openFile(path) },
    { sep: true },
    { label: "Rename\u2026", run: () => { pendingRename = path; renderSidebar(); } },
    { label: "Delete", run: () => deleteConfirm(path) },
    { sep: true },
    { label: "Copy Path", run: () => copyPath(path) },
  ];
}

function dirMenu(path) {
  return [
    { label: "New File", run: () => startCreate(path, false) },
    { label: "New Folder", run: () => startCreate(path, true) },
    { sep: true },
    { label: "Rename\u2026", run: () => { pendingRename = path; renderSidebar(); } },
    { label: "Delete", run: () => deleteConfirm(path) },
  ];
}

function tabMenu(path) {
  return [
    { label: "Close", run: () => closeTab(path) },
    { label: "Close Others", run: () => { store.tabs = [path]; store.activePath = path; editor.openFile(path); schedulePersist(); renderTabs(); renderSidebar(); renderStatus(); } },
    { label: "Close All", run: () => closeAllTabs() },
    { sep: true },
    { label: "Copy Path", run: () => copyPath(path) },
  ];
}

function copyPath(path) {
  try {
    navigator.clipboard.writeText(path);
    toast("Copied path");
  } catch {
    toast("Clipboard unavailable");
  }
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
  updatePanelTabs();
}

function updatePanelTabs() {
  document.querySelectorAll(".panel-tab").forEach((b) => b.classList.toggle("active", b.dataset.panel === panelTab));
  $("#pane-terminal").hidden = panelTab !== "terminal";
  $("#pane-output").hidden = panelTab !== "output";
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
      out("Commands: help, ls, cd, cat, pwd, touch, mkdir, rm, echo, open, run, clear, date, whoami");
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
      const p = resolveTerm(args[0]);
      if (store.vfs.write(p, store.vfs.read(p) ?? "")) {
        schedulePersist();
        uiSync();
        out("created " + (p || "?"));
      } else out("touch: cannot create " + (args[0] || ""));
      break;
    }
    case "mkdir": {
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

function renderSearchInto(el) {
  el.innerHTML = `<div class="search-wrap"><input class="search-input" placeholder="Search workspace" spellcheck="false" value="${esc(searchQuery)}"></div><div class="search-meta"></div><div class="search-results"></div>`;
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
  res.innerHTML = "";
  if (!q.trim()) {
    meta.textContent = "Type to search across files.";
    return;
  }
  const query = q.trim();
  const ql = query.toLowerCase();
  let fileCount = 0, matchCount = 0;
  for (const path of store.vfs.walkFiles()) {
    if (matchCount >= 100) break;
    const content = store.vfs.read(path) || "";
    const lower = content.toLowerCase();
    const matches = [];
    let idx = -1;
    while ((idx = lower.indexOf(ql, idx + 1)) !== -1 && matches.length < 20) matches.push(idx);
    if (!matches.length) continue;
    fileCount++;
    matchCount += matches.length;
    const head = document.createElement("div");
    head.className = "s-filehead";
    head.innerHTML = `${fileIcon(path)}<span class="s-path">${esc(path)}</span><span class="s-count">${matches.length}</span>`;
    head.addEventListener("click", async () => {
      await openFile(path);
      editor.goTo(matches[0]);
    });
    res.appendChild(head);
    for (const m of matches.slice(0, 5)) {
      const lineStart = content.lastIndexOf("\n", m) + 1;
      const lineEnd = content.indexOf("\n", m);
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
      mk.textContent = content.slice(m, m + query.length);
      txt.append(content.slice(lineStart, m), mk, content.slice(m + query.length, end));
      row.append(num, txt);
      row.addEventListener("click", async () => {
        await openFile(path);
        editor.selectRange(m, m + query.length);
      });
      res.appendChild(row);
    }
  }
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
    store.saved[p] = store.vfs.read(p) || "";
    store.dirty.delete(p);
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
  overlayShow(`<div class="modal"><div class="modal-head">Settings<button class="modal-close">&times;</button></div><div class="modal-body">
    <label class="set-row"><span>Theme</span><select id="set-theme"><option value="dark">Dark (VS Code)</option><option value="light">Light</option></select></label>
    <label class="set-row"><span>Font size</span><span class="set-ctrl"><input type="range" id="set-font" min="10" max="22" step="1"><b id="set-fontv"></b></span></label>
    <label class="set-row"><span>Tab size</span><select id="set-tab"><option value="2">2</option><option value="4">4</option><option value="8">8</option></select></label>
    <label class="set-row"><span>Word wrap</span><input type="checkbox" id="set-wrap" class="chk"></label>
    <div class="set-foot">Settings are stored in your browser.</div>
  </div></div>`);
  $("#set-theme").value = s.theme;
  $("#set-font").value = s.fontSize;
  $("#set-fontv").textContent = s.fontSize + "px";
  $("#set-tab").value = String(s.tabSize);
  $("#set-wrap").checked = s.wordWrap;
  $("#set-theme").onchange = (e) => { s.theme = e.target.value; applySettings(); };
  $("#set-font").oninput = (e) => { s.fontSize = +e.target.value; $("#set-fontv").textContent = s.fontSize + "px"; applySettings(); };
  $("#set-tab").onchange = (e) => { s.tabSize = +e.target.value; applySettings(); };
  $("#set-wrap").onchange = (e) => { s.wordWrap = e.target.checked; applySettings(); };
  $(".modal-close").onclick = () => overlayHide();
}

export function applySettings() {
  document.documentElement.dataset.theme = store.settings.theme;
  document.documentElement.style.setProperty("--edfont", store.settings.fontSize + "px");
  editor.rebuild();
  schedulePersist();
  renderStatus();
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
