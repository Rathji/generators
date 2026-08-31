// main.js — Chance Code application controller: workspace store (kv), file tree,
// tabs, editor wiring, run/preview, panels, command palette, search, history, docs.

import { createEditor, langForPath, FILE_ICONS } from "./editor.js";
import { createTerminal } from "./terminal.js";
import { createAI } from "./ai.js";
import { renderProject, evalAgainstTree } from "./run.js";
import { initSettings } from "./settings.js";

const $ = (id) => document.getElementById(id);

const SEED_PJS = `// main.pjs — Perchance lists. Edit me, then press Run (Ctrl+Enter).
// Top-level lists are usable in index.html via [square blocks].

hero
  [names] the [classes]

names
  Aria
  Bram
  Kael
  Nyx
  Thera

classes
  Warrior
  Mage
  Rogue
  Cleric

quest
  Slay the [monster] in the [place]
  Rescue [names] from the [place]
  Find the [artifact] hidden in the [place]

monster = {Dragon|Goblin King|Shadow Wolf|Troll}
place = {Forgotten Crypt|Sunken Temple|Sky Castle|Bramblewood}
artifact = {Amulet of Dawn|Crown of Echoes|Blade of Stars}

$output = [hero]
`;

const SEED_HTML = `<h1>⚔️ [hero]</h1>
<p>Today's quest: <b>[quest]</b></p>
<button onclick="update()">Re-roll</button>
<p style="color:#888;font-size:12px">The <code>update()</code> button re-rolls the blocks. This preview is rendered by Chance Code's built-in mini-engine.</p>
`;

const EXAMPLES = [
  { name: "battle-simulator-example", desc: "State mutation + recursion-with-odds game loop" },
  { name: "consumable-list-with-dynamic-odds-example", desc: "Distinct picks + mutual exclusion via dynamic odds" },
  { name: "create-instance-plugin-example", desc: "createInstance object-building" },
  { name: "dynamic-sublist-referencing-example", desc: "Computing sub-list names dynamically" },
  { name: "goto-and-remember-plugins-example", desc: "Text adventure (goto + remember plugins)" },
  { name: "multiline-pro-example", desc: "Multi-line block output" },
  { name: "p5js-basic-example", desc: "p5.js canvas integration" },
  { name: "seed-from-url-example", desc: "Deterministic seeding from URL" },
  { name: "simple-if-else-example", desc: "if/else branch syntax" },
  { name: "storing-selections-example-1", desc: "Capturing & reusing a selection" }
];

const DOCS = [
  { file: "perchance-platform.md", title: "Platform Reference", desc: "The engine: execution model, selection semantics, odds, if/else, list-tree API, $meta, public APIs, plugin directory, gotchas." },
  { file: "operating-manual.md", title: "Operating Manual", desc: "The full pjs syntax reference, plugin quick-reference, and coding conventions." },
  { file: "README.md", title: "Library Index", desc: "How the reference library is organized." },
  { file: "ai-text-plugin.md", title: "ai-text-plugin", desc: "generateText: LLM text generation, streaming, vision attachments." },
  { file: "text-to-image-plugin.md", title: "text-to-image-plugin", desc: "generateImage: options, result objects, gallery + moderation." },
  { file: "kv-plugin.md", title: "kv-plugin", desc: "Persistent per-user key/value storage." },
  { file: "upload-plugin.md", title: "upload-plugin", desc: "File hosting, editable text files, moderation." },
  { file: "comments-plugin.md", title: "comments-plugin", desc: "Comments/chat widgets, moderation, permissioned channels." },
  { file: "server-plugin.md", title: "server-plugin", desc: "Realtime multiplayer servers, RPC, durable state, security." },
  { file: "super-fetch-plugin.md", title: "super-fetch-plugin", desc: "CORS-free fetch for runtime generator code." },
  { file: "secret-plugin.md", title: "secret-plugin", desc: "Post-quantum public-key encryption." },
  { file: "dynamic-metadata.md", title: "dynamic-metadata", desc: "Query-aware titles/descriptions/social images." },
  { file: "music-generation.md", title: "music-generation", desc: "Composing music and wiring it into generators." }
];

/* ---------------- state ---------------- */
const openTabs = [];      // {path, kind:'file'|'doc', title, content, dirty, docHtml?}
let activePath = null;
let autosaveTimer = null;
let lastRun = null;
let histFile = "";
let currentLang = "plain";

/* ---------------- kv / workspace ---------------- */
const kv = () => window.root.kv.perchcode;

const ws = {
  async listFiles() {
    const entries = await kv().entries();
    return entries.map(([k]) => k).filter((k) => k.startsWith("ws/")).map((k) => k.slice(3)).filter(Boolean);
  },
  async read(path) {
    const v = await kv().get("ws/" + path);
    return v === undefined || v === null ? null : v;
  },
  async write(path, content, opts = {}) {
    await kv().set("ws/" + path, content);
    if (opts.snapshot) await pushSnapshot(path, content);
  },
  async del(path) {
    await kv().delete("ws/" + path);
    await kv().delete("hist/" + path);
  },
  async exists(path) {
    return (await kv().get("ws/" + path)) !== null && (await kv().get("ws/" + path)) !== undefined;
  }
};

async function pushSnapshot(path, content) {
  const key = "hist/" + path;
  let hist = (await kv().get(key)) || [];
  hist.push({ t: Date.now(), content });
  if (hist.length > 30) hist = hist.slice(-30);
  await kv().set(key, hist);
}

async function ensureSeeded() {
  let meta = await kv().get("meta");
  if (meta && meta.seeded) return;
  await ws.write("main.pjs", SEED_PJS, { snapshot: true });
  await ws.write("index.html", SEED_HTML, { snapshot: true });
  await kv().set("meta", { seeded: true, name: "My Project", active: "index.html" });
}

/* ---------------- boot ---------------- */
async function boot() {
  try {
    await ensureSeeded();
    buildEditor();
    initSettings({ toast });
    buildTerminal();
    buildAI();
    wireUi();
    await refreshTree();
    switchView("explorer");
    const meta = await kv().get("meta");
    if (meta && meta.active) {
      await openFile(meta.active);
    } else {
      showWelcome();
    }
    $("boot").hidden = true;
    $("app").hidden = false;
    updateStatus();
    focusEditor();
  } catch (e) {
    console.error(e);
    $("boot").textContent = "Failed to load Chance Code: " + ((e && e.message) || e);
  }
}

/* ---------------- editor ---------------- */
let editor = null;
function buildEditor() {
  editor = createEditor($("editorhost"), {
    onChange: () => {
      const t = activeTab();
      if (!t || t.kind !== "file") return;
      t.content = editor.getValue();
      t.dirty = true;
      refreshTabs();
      refreshTree();
      updateStatus();
      clearTimeout(autosaveTimer);
      autosaveTimer = setTimeout(() => { flushActive(); }, 900);
    },
    onCursor: (p) => {
      sbRight_ln = p.line;
      sbRight_col = p.col;
      updateStatus();
    }
  });
}
let sbRight_ln = 1, sbRight_col = 0;

/* ---------------- tabs ---------------- */
function activeTab() { return openTabs.find((t) => t.path === activePath) || null; }

async function flushActive() {
  const t = activeTab();
  if (t && t.kind === "file" && t.dirty) {
    await ws.write(t.path, t.content);
    t.dirty = false;
    refreshTabs();
    refreshTree();
    updateStatus();
  }
}

async function openFile(path) {
  await flushActive();
  let tab = openTabs.find((t) => t.path === path);
  if (!tab) {
    const content = await ws.read(path);
    if (content === null) { toast("No such file: " + path, "err"); return; }
    tab = { path, kind: "file", title: path, content, dirty: false };
    openTabs.push(tab);
    if (openTabs.length === 1) hideWelcome();
  }
  setActive(tab.path);
}

function openDocTab(file, title) {
  const path = "docs/" + file;
  let tab = openTabs.find((t) => t.path === path);
  if (!tab) {
    tab = { path, kind: "doc", title: title || file, docHtml: null };
    openTabs.push(tab);
    if (openTabs.length === 1) hideWelcome();
  }
  setActive(tab.path);
}

async function setActive(path) {
  await flushActive();
  activePath = path;
  const t = activeTab();
  if (!t) return;
  if (t.kind === "doc") {
    $("editorhost").hidden = true;
    $("docsview").hidden = false;
    if (!t.docHtml) {
      $("docsview").innerHTML = "<div class='dim' style='padding:20px'>Loading…</div>";
      try {
        const r = await fetch("src/docs/" + t.path.slice(5));
        const md = r.ok ? await r.text() : "# Not found\n\nThis document is missing.";
        t.docHtml = await renderMarkdown(md);
        if (activePath === path) $("docsview").innerHTML = t.docHtml;
      } catch (e) {
        $("docsview").innerHTML = "<div class='dim' style='padding:20px'>Failed to load doc.</div>";
      }
    } else {
      $("docsview").innerHTML = t.docHtml;
    }
    currentLang = "markdown";
  } else {
    $("docsview").hidden = true;
    $("editorhost").hidden = false;
    currentLang = langForPath(t.path);
    editor.open(t.path, t.content, currentLang);
    editor.setLang(currentLang);
    focusEditor();
  }
  refreshTabs();
  refreshTree();
  updateStatus();
  const meta = await kv().get("meta");
  if (meta) { meta.active = t.path; await kv().set("meta", meta); }
}

async function closeTab(path, opts = {}) {
  const idx = openTabs.findIndex((t) => t.path === path);
  if (idx === -1) return;
  const wasActive = activePath === path;
  if (openTabs[idx].kind === "file" && !opts.skipWrite) {
    await ws.write(path, openTabs[idx].content);
  }
  openTabs.splice(idx, 1);
  if (openTabs.length === 0) {
    activePath = null;
    $("editorhost").hidden = true;
    $("docsview").hidden = true;
    showWelcome();
  } else if (wasActive) {
    const next = openTabs[Math.min(idx, openTabs.length - 1)];
    activePath = null;
    setActive(next.path);
  }
  refreshTabs();
  refreshTree();
  updateStatus();
}

async function closeAllTabs() {
  for (const t of [...openTabs]) if (t.kind === "file") await ws.write(t.path, t.content);
  openTabs.length = 0;
  activePath = null;
  $("editorhost").hidden = true;
  $("docsview").hidden = true;
  showWelcome();
  refreshTabs();
  refreshTree();
  updateStatus();
}

function refreshTabs() {
  const ctn = $("tabs");
  ctn.innerHTML = "";
  for (const t of openTabs) {
    const el = document.createElement("div");
    el.className = "tab" + (t.path === activePath ? " active" : "");
    const icon = document.createElement("span");
    icon.textContent = t.kind === "doc" ? "📖" : (FILE_ICONS["." + (t.title.split(".").pop() || "")] || "📄");
    icon.style.fontSize = "12px";
    const name = document.createElement("span");
    name.textContent = t.title;
    name.style.overflow = "hidden";
    name.style.textOverflow = "ellipsis";
    name.style.maxWidth = "180px";
    const x = document.createElement("button");
    x.className = "x";
    x.textContent = "×";
    x.onclick = (e) => { e.stopPropagation(); closeTab(t.path); };
    if (t.kind === "file" && t.dirty) {
      const d = document.createElement("span");
      d.className = "dot";
      d.textContent = "●";
      el.append(icon, name, d);
    } else {
      el.append(icon, name);
    }
    el.append(x);
    el.onclick = () => setActive(t.path);
    el.onauxclick = (e) => { if (e.button === 1) closeTab(t.path); };
    ctn.appendChild(el);
  }
}

/* ---------------- file tree ---------------- */
async function syncOpenTabsFromDisk(path) {
  for (const t of openTabs) {
    if (t.kind !== "file") continue;
    if (path && t.path !== path) continue;
    const fresh = await ws.read(t.path);
    if (fresh !== null && fresh !== t.content) {
      t.content = fresh;
      t.dirty = false;
    }
  }
  const act = activeTab();
  if (act && act.kind === "file" && editor) editor.setValue(act.content);
  refreshTabs();
  refreshTree();
  updateStatus();
}
async function refreshTree() {
  const ctn = $("fileTree");
  const files = await ws.listFiles();
  files.sort((a, b) => {
    const extA = a.split(".").pop(), extB = b.split(".").pop();
    if (extA === "pjs" && extB !== "pjs") return -1;
    if (extA !== "pjs" && extB === "pjs") return 1;
    return a.localeCompare(b);
  });
  ctn.innerHTML = "";
  if (!files.length) {
    const empty = document.createElement("div");
    empty.className = "node";
    empty.innerHTML = "<span class='name dim'>empty workspace — new file…</span>";
    ctn.appendChild(empty);
    return;
  }
  for (const f of files) {
    const node = document.createElement("div");
    node.className = "node file" + (f === activePath ? " sel" : "");
    const ico = document.createElement("span");
    ico.className = "ico";
    ico.textContent = FILE_ICONS["." + (f.split(".").pop() || "")] || "📄";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = f;
    node.append(ico, name);
    node.onclick = () => openFile(f);
    node.oncontextmenu = (e) => { e.preventDefault(); showCtxMenu(e.clientX, e.clientY, fileMenuItems(f)); };
    ctn.appendChild(node);
  }
}

function fileMenuItems(path) {
  return [
    { label: "Open", run: () => openFile(path) },
    { label: "Rename…", run: async () => {
        const val = await promptModal("Rename file", "New name", path);
        if (!val || val === path) return;
        const content = await ws.read(path);
        await ws.del(path);
        await ws.write(val, content, { snapshot: true });
        for (const t of openTabs) if (t.path === path) { t.path = val; t.title = val; }
        if (activePath === path) activePath = val;
        refreshTabs();
        refreshTree();
        await renderHistorySel();
      } },
    { label: "Duplicate", run: async () => {
        const dot = path.lastIndexOf(".");
        const base = dot === -1 ? path : path.slice(0, dot);
        const ext = dot === -1 ? "" : path.slice(dot);
        const copy = base + " copy" + ext;
        const content = await ws.read(path);
        await ws.write(copy, content, { snapshot: true });
        refreshTree();
        await renderHistorySel();
        toast("Duplicated to " + copy, "ok");
      } },
    { label: "Delete", danger: true, run: async () => {
        if (!(await confirmModal("Delete " + path + "?", "This removes the file and its history. This cannot be undone."))) return;
        await ws.del(path);
        const idx = openTabs.findIndex((t) => t.path === path);
        if (idx !== -1) await closeTab(path, { skipWrite: true });
        refreshTree();
        await renderHistorySel();
      } }
  ];
}

/* ---------------- welcome / docs view ---------------- */
function showWelcome() { $("welcomescreen").hidden = false; }
function hideWelcome() { $("welcomescreen").hidden = true; }
function showDocsView() {
  $("editorhost").hidden = true;
  $("docsview").hidden = false;
}
function showEditorView() {
  $("docsview").hidden = true;
  $("editorhost").hidden = false;
}

let markedMod = null;
async function renderMarkdown(text) {
  if (!markedMod) markedMod = await import("https://esm.sh/marked@12");
  let html = markedMod.marked.parse(text);
  html = html.replace(/<a href="(https?:)/g, '<a target="_blank" rel="noopener" href="$1');
  return '<div class="doc-body">' + html + "</div>";
}

/* ---------------- run / preview ---------------- */
function wrapPreview(body) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8">'
    + '<style>body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,Helvetica,Arial,sans-serif;'
    + 'max-width:780px;margin:0 auto;padding:20px;line-height:1.55;color:#222;text-align:left}'
    + 'button{font:inherit;padding:8px 14px;border-radius:8px;border:1px solid #bbb;background:#fafafa;cursor:pointer}'
    + 'button:hover{background:#eee}</style>'
    + '<script>window.update=function(){parent.postMessage({type:"pc-reroll"},"*")};<\/script>'
    + "</head><body>" + body + "</body></html>";
}

async function readFileForRun(path) {
  const t = openTabs.find((x) => x.path === path);
  if (t && t.kind === "file") return t.content;
  return await ws.read(path);
}

async function runProject() {
  if (isRunning) return lastRun;
  isRunning = true;
  try {
    const files = {
      "main.pjs": (await readFileForRun("main.pjs")) || "",
      "index.html": (await readFileForRun("index.html")) || ""
    };
    const result = renderProject(files);
    lastRun = result;
    showPreview();
    renderProblems(result);
    logOutput(result);
    if (result.pjsError) {
      $("pvframe").hidden = true;
      $("pvmsg").hidden = false;
      $("pvmsg").textContent = "⚠ " + result.pjsError;
    } else if (result.html != null) {
      $("pvmsg").hidden = true;
      $("pvframe").hidden = false;
      $("pvframe").srcdoc = wrapPreview(result.html);
    }
    return result;
  } finally {
    isRunning = false;
  }
}
let isRunning = false;

function showPreview() {
  $("previewpane").hidden = false;
  $("tabPreviewBtn").classList.add("on");
}

window.addEventListener("message", (e) => {
  if (e.data && e.data.type === "pc-reroll") runProject();
});

window.PC = { ws, runProject, syncOpenTabsFromDisk, openFile, switchView, editor: () => editor };

/* ---------------- panels ---------------- */
let panelOpen = false;
let panelTab = "terminal";
let terminal = null;
let ai = null;

function buildTerminal() {
  terminal = createTerminal($("pane-terminal"), {
    listFiles: () => ws.listFiles(),
    read: (p) => ws.read(p),
    write: (p, c) => ws.write(p, c),
    del: (p) => ws.del(p),
    exists: (p) => ws.exists(p),
    run: async () => {
      const r = await runProject();
      terminal.log(r.ok ? "✓ ran clean" : "⚠ errors — see Problems/Output", r.ok ? "ln" : "le");
    },
    evalTree: (expr) => {
      if (!lastRun || !lastRun.tree) return { text: "(run the project first — press Ctrl+Enter)", errors: [] };
      return evalAgainstTree(expr, lastRun.tree);
    }
  });
}

function buildAI() {
  let suggestions = [];
  let agentPresets = [];
  try {
    const cs = window.root.chatSuggestions;
    if (cs && cs.selectAll) suggestions = cs.selectAll.map((n) => n.evaluateItem);
    const ap = window.root.agentPresets;
    if (ap && ap.selectAll) agentPresets = ap.selectAll.map((n) => n.evaluateItem);
  } catch (e) {}
  ai = createAI($("pane-ai"), {
    generateText: (o) => window.root.generateText(o),
    ws,
    runProject: async () => {
      showPanel("output");
      return await runProject();
    },
    getOpenPath: () => (activeTab() && activeTab().kind === "file" ? activeTab().path : null),
    getOpenContent: () => (activeTab() && activeTab().kind === "file" ? activeTab().content : null),
    syncOpenTabsFromDisk: (path) => syncOpenTabsFromDisk(path),
    suggestions,
    agentPresets,
    toast: (m, k) => toast(m, k)
  });
}

function showPanel(tab) {
  panelOpen = true;
  panelTab = tab || panelTab;
  $("panel").hidden = false;
  const tabs = { terminal: 0, problems: 1, output: 2, ai: 3 };
  const order = ["terminal", "problems", "output", "ai"];
  order.forEach((name, i) => {
    const btn = document.querySelector(`.panel-tab[data-panel="${name}"]`);
    btn.classList.toggle("active", name === panelTab);
    $("pane-" + name).hidden = name !== panelTab;
  });
  if (panelTab === "terminal" && terminal) setTimeout(() => terminal.focus(), 50);
  if (panelTab === "ai" && ai) setTimeout(() => ai.focus(), 50);
}
function hidePanel() {
  panelOpen = false;
  $("panel").hidden = true;
}
function togglePanel() { panelOpen ? hidePanel() : showPanel("terminal"); }

function renderProblems(result) {
  const ctn = $("pane-problems");
  const badge = $("pb-problems");
  const list = [];
  if (result && result.pjsError) list.push({ sev: "err", loc: "main.pjs", msg: result.pjsError, line: 0 });
  if (result && result.errors) for (const e of result.errors) list.push({ sev: "err", loc: "index.html:" + e.line, msg: e.msg, line: e.line || 0 });
  ctn.innerHTML = "";
  if (!list.length) {
    const el = document.createElement("div");
    el.className = "dim";
    el.textContent = "No problems. ✓";
    el.style.padding = "10px 14px";
    ctn.appendChild(el);
  }
  for (const p of list) {
    const el = document.createElement("div");
    el.className = "prob";
    const sev = document.createElement("span");
    sev.className = "sev " + p.sev;
    const loc = document.createElement("span");
    loc.className = "loc";
    loc.textContent = p.loc;
    const msg = document.createElement("span");
    msg.className = "msg";
    msg.textContent = p.msg;
    el.append(sev, loc, msg);
    el.onclick = async () => {
      const path = p.loc.startsWith("index.html") ? "index.html" : "main.pjs";
      await openFile(path);
      if (p.line) setTimeout(() => editor.jumpTo(p.line), 80);
    };
    ctn.appendChild(el);
  }
  badge.textContent = list.length ? String(list.length) : "";
  badge.style.display = list.length ? "" : "none";
}

function logOutput(result) {
  const ctn = $("pane-output");
  const t = new Date().toLocaleTimeString();
  const line = document.createElement("div");
  if (result.pjsError) {
    line.className = "oerr";
    line.textContent = "[" + t + "] ✗ main.pjs: " + result.pjsError;
  } else if (result.errors && result.errors.length) {
    line.className = "oerr";
    line.textContent = "[" + t + "] ✗ " + result.errors.length + " error(s) in index.html: " + result.errors[0].msg;
  } else {
    line.className = "ook";
    line.textContent = "[" + t + "] ✓ ran clean";
  }
  ctn.appendChild(line);
  ctn.scrollTop = ctn.scrollHeight;
}

/* ---------------- search ---------------- */
let searchTimer = null;

async function doSearch() {
  const q = $("searchInput").value.trim();
  const ctn = $("searchResults");
  ctn.innerHTML = "";
  if (!q) { $("searchStatus").textContent = ""; return; }
  let re = null;
  try { re = new RegExp(q, "g"); } catch (e) { re = null; }
  const files = await ws.listFiles();
  let total = 0;
  for (const f of files) {
    const content = (await ws.read(f)) || "";
    const lines = content.split("\n");
    const hits = [];
    for (let i = 0; i < lines.length; i++) {
      let idx;
      const line = lines[i];
      if (re) {
        re.lastIndex = 0;
        const m = re.exec(line);
        if (m) hits.push({ n: i + 1, text: line, hl: m.index, len: Math.max(m[0].length, q.length) });
      } else {
        idx = line.indexOf(q);
        if (idx !== -1) hits.push({ n: i + 1, text: line, hl: idx, len: q.length });
      }
    }
    if (hits.length) {
      total += hits.length;
      const fh = document.createElement("div");
      fh.className = "search-file";
      fh.textContent = f + " — " + hits.length;
      ctn.appendChild(fh);
      for (const h of hits) {
        const el = document.createElement("div");
        el.className = "search-line";
        const before = esc(h.text.slice(Math.max(0, h.hl - 40), h.hl));
        const match = esc(h.text.slice(h.hl, h.hl + h.len));
        const after = esc(h.text.slice(h.hl + h.len, h.hl + h.len + 60));
        el.innerHTML = h.n + ": " + before + "<b>" + match + "</b>" + after;
        el.onclick = async () => { await openFile(f); setTimeout(() => editor.jumpTo(h.n, 0), 80); };
        ctn.appendChild(el);
      }
    }
  }
  $("searchStatus").textContent = total ? total + " match(es)" : "no matches";
}
function esc(s) { return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;"); }

/* ---------------- history ---------------- */
async function renderHistorySel() {
  const files = await ws.listFiles();
  const sel = $("histFileSel");
  sel.innerHTML = "";
  for (const f of files) {
    const o = document.createElement("option");
    o.value = f;
    o.textContent = f;
    sel.appendChild(o);
  }
  if (files.includes(histFile)) sel.value = histFile;
  else if (files.length) { sel.value = files[0]; histFile = files[0]; }
  renderHistoryList();
}
async function renderHistoryList() {
  const ctn = $("histList");
  ctn.innerHTML = "";
  if (!histFile) return;
  const hist = (await kv().get("hist/" + histFile)) || [];
  if (!hist.length) {
    const el = document.createElement("div");
    el.className = "dim";
    el.textContent = "No snapshots yet — press Ctrl+S to save a version.";
    el.style.padding = "8px";
    ctn.appendChild(el);
    return;
  }
  const current = (await ws.read(histFile)) || "";
  for (let i = hist.length - 1; i >= 0; i--) {
    const s = hist[i];
    const el = document.createElement("div");
    el.className = "hist-item";
    const t = document.createElement("div");
    t.className = "t";
    t.textContent = "#" + (i + 1) + " · " + new Date(s.t).toLocaleString();
    const d = document.createElement("div");
    d.className = "d";
    const viewBtn = document.createElement("button");
    viewBtn.textContent = "View";
    viewBtn.onclick = () => showDiff(s.content, current);
    const restBtn = document.createElement("button");
    restBtn.textContent = "Restore";
    restBtn.onclick = async () => {
      await ws.write(histFile, s.content, { snapshot: true });
      const tab = openTabs.find((x) => x.path === histFile);
      if (tab && tab.kind === "file") { tab.content = s.content; tab.dirty = true; await setActive(tab.path); }
      toast("Restored snapshot #" + (i + 1) + " of " + histFile, "ok");
      renderHistoryList();
    };
    d.append(viewBtn, restBtn);
    el.append(t, d);
    ctn.appendChild(el);
  }
}

function showDiff(oldText, newText) {
  const modal = $("diffModal");
  const body = $("diffBody");
  body.innerHTML = "";
  const diff = lineDiff(oldText, newText);
  for (const part of diff) {
    const pre = document.createElement("pre");
    pre.className = "diff-" + (part.added ? "add" : part.removed ? "del" : "same");
    pre.textContent = (part.added ? "+ " : part.removed ? "- " : "  ") + part.value.replace(/\n$/, "");
    body.appendChild(pre);
  }
  modal.hidden = false;
  $("diffTitle").textContent = "Diff — old vs current";
  $("diffCloseBtn").onclick = () => { modal.hidden = true; };
}

function lineDiff(a, b) {
  const A = a.split("\n"), B = b.split("\n");
  const n = A.length, m = B.length;
  const dp = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--)
      dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { out.push({ value: A[i] + "\n", added: false, removed: false }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { out.push({ value: A[i] + "\n", removed: true }); i++; }
    else { out.push({ value: B[j] + "\n", added: true }); j++; }
  }
  while (i < n) { out.push({ value: A[i] + "\n", removed: true }); i++; }
  while (j < m) { out.push({ value: B[j] + "\n", added: true }); j++; }
  return out;
}

/* ---------------- docs ---------------- */
function buildDocs() {
  const ctn = $("docsList");
  ctn.innerHTML = "";
  for (const d of DOCS) {
    const node = document.createElement("div");
    node.className = "node file";
    const ico = document.createElement("span");
    ico.className = "ico";
    ico.textContent = "📖";
    const name = document.createElement("span");
    name.className = "name";
    name.textContent = d.title;
    name.title = d.desc;
    node.append(ico, name);
    node.onclick = () => openDocTab(d.file, d.title);
    ctn.appendChild(node);
  }
}

/* ---------------- examples ---------------- */
async function openExample(name) {
  const hadFiles = (await ws.exists("main.pjs")) || (await ws.exists("index.html"));
  if (hadFiles && !(await confirmModal("Replace workspace with " + name + "?", "This overwrites main.pjs and index.html with the example files. Your current files stay in history, but to be safe, Save (Ctrl+S) first if you care about them."))) return;
  for (const f of ["main.pjs", "index.html"]) {
    const r = await fetch("src/examples/" + name + "/" + f);
    const content = r.ok ? await r.text() : "";
    await ws.write(f, content, { snapshot: true });
    const tab = openTabs.find((x) => x.path === f);
    if (tab) { tab.content = content; tab.dirty = true; }
  }
  refreshTree();
  await openFile("index.html");
  runProject();
  toast("Opened example: " + name, "ok");
}

/* ---------------- command palette ---------------- */
let palItems = [];
let palSel = 0;
function buildPalette() {
  const input = $("paletteInput");
  input.addEventListener("input", () => renderPalette(input.value));
  input.addEventListener("keydown", (e) => {
    if (e.key === "ArrowDown") { e.preventDefault(); palSel = Math.min(palSel + 1, palItems.length - 1); renderPalette(input.value); }
    else if (e.key === "ArrowUp") { e.preventDefault(); palSel = Math.max(palSel - 1, 0); renderPalette(input.value); }
    else if (e.key === "Enter") { e.preventDefault(); const it = palItems[palSel]; if (it) { closePalette(); it.run(); } }
    else if (e.key === "Escape") { closePalette(); }
  });
}
function openPalette() {
  palItems = getCommands();
  palSel = 0;
  $("palette").hidden = false;
  $("paletteInput").value = "";
  renderPalette("");
  $("paletteInput").focus();
}
function closePalette() {
  $("palette").hidden = true;
  focusEditor();
}
function renderPalette(query) {
  const list = $("paletteList");
  const q = query.trim().toLowerCase();
  const items = palItems.filter((it) => !q || (it.label + " " + (it.desc || "") + " " + (it.keys || "")).toLowerCase().includes(q));
  list.innerHTML = "";
  if (palSel >= items.length) palSel = 0;
  items.forEach((it, i) => {
    const el = document.createElement("div");
    el.className = "pal-item" + (i === palSel ? " sel" : "");
    const lbl = document.createElement("span");
    lbl.textContent = it.label;
    const d = document.createElement("span");
    d.className = "d";
    d.textContent = it.desc || "";
    const k = document.createElement("span");
    k.className = "k";
    k.textContent = it.keys || "";
    el.append(lbl, d, k);
    el.onclick = () => { closePalette(); it.run(); };
    el.onmousemove = () => { palSel = i; renderPalette(query); };
    list.appendChild(el);
  });
  if (!items.length) {
    const el = document.createElement("div");
    el.className = "dim";
    el.textContent = "no matching commands";
    el.style.padding = "10px 12px";
    list.appendChild(el);
  }
}
function getCommands() {
  return [
    { label: "Run project", desc: "render main.pjs + index.html in the preview", keys: "Ctrl+Enter", run: () => runProject() },
    { label: "Save file (snapshot)", desc: "persist + record a version in History", keys: "Ctrl+S", run: saveSnapshot },
    { label: "New file…", run: newFile },
    { label: "Open example…", run: () => openExampleMenu() },
    { label: "Reference library", run: () => switchView("docs") },
    { label: "AI — chat", desc: "ask about building Perchance generators", keys: "Ctrl+J", run: () => { showPanel("ai"); ai.setMode("chat"); } },
    { label: "AI — agent mode", desc: "autonomous build/edit of the workspace", keys: "Ctrl+Shift+A", run: () => { showPanel("ai"); ai.setMode("agent"); } },
    { label: "Find in workspace", keys: "Ctrl+Shift+F", run: () => { switchView("search"); setTimeout(() => $("searchInput").focus(), 50); } },
    { label: "Explorer", keys: "Ctrl+Shift+E", run: () => switchView("explorer") },
    { label: "History", desc: "browse snapshots & restore", run: () => switchView("history") },
    { label: "Toggle panel", keys: "Ctrl+`", run: () => togglePanel() },
    { label: "Toggle preview", keys: "Ctrl+Shift+P", run: () => { $("previewpane").hidden = !$("previewpane").hidden; } },
    { label: "Clear terminal", run: () => { if (terminal) terminal.clear(); } },
    { label: "Close all tabs", run: () => closeAllTabs() }
  ];
}

/* ---------------- modals / context menu ---------------- */
function showCtxMenu(x, y, items) {
  const menu = $("ctxmenu");
  menu.innerHTML = "";
  for (const it of items) {
    const el = document.createElement("div");
    el.className = "item" + (it.danger ? " danger" : "");
    el.textContent = it.label;
    el.onclick = () => { menu.hidden = true; it.run(); };
    menu.appendChild(el);
  }
  menu.hidden = false;
  const r = menu.getBoundingClientRect();
  menu.style.left = Math.min(x, window.innerWidth - r.width - 8) + "px";
  menu.style.top = Math.min(y, window.innerHeight - r.height - 8) + "px";
}
document.addEventListener("click", (e) => {
  if (!$("ctxmenu").contains(e.target)) $("ctxmenu").hidden = true;
  if (!$("palette").hidden && !$("palette").contains(e.target) && !(e.target instanceof Element && e.target.closest("#actCmdBtn"))) closePalette();
});

function promptModal(title, placeholder, initial) {
  return new Promise((resolve) => {
    const m = $("promptModal");
    $("promptTitle").textContent = title;
    const input = $("promptInput");
    input.value = initial || "";
    input.placeholder = placeholder || "";
    m.hidden = false;
    input.focus();
    input.select();
    const done = (val) => { m.hidden = true; resolve(val); };
    $("promptOkBtn").onclick = () => done(input.value.trim());
    $("promptCancelBtn").onclick = () => done(null);
    input.onkeydown = (e) => { if (e.key === "Enter") done(input.value.trim()); if (e.key === "Escape") done(null); };
  });
}
function confirmModal(title, msg) {
  return new Promise((resolve) => {
    const m = $("confirmModal");
    $("confirmTitle").textContent = title;
    $("confirmMsg").textContent = msg;
    m.hidden = false;
    const done = (v) => { m.hidden = true; resolve(v); };
    $("confirmOkBtn").onclick = () => done(true);
    $("confirmCancelBtn").onclick = () => done(false);
  });
}

async function newFile() {
  const name = await promptModal("New file", "e.g. data.md or js/helper.js");
  if (!name) return;
  const sanitized = name.replace(/^ws\//, "");
  if (await ws.exists(sanitized)) { toast("File already exists: " + sanitized, "err"); return; }
  await ws.write(sanitized, "", { snapshot: true });
  refreshTree();
  await renderHistorySel();
  await openFile(sanitized);
}

function openExampleMenu() {
  const items = EXAMPLES.map((e) => ({ label: e.name, desc: e.desc, run: () => openExample(e.name) }));
  showCtxMenu($("openExampleBtn").getBoundingClientRect().right, $("openExampleBtn").getBoundingClientRect().bottom + 4, items);
}

/* ---------------- views / status ---------------- */
let currentView = "explorer";
let sidebarCollapsed = false;
function setSidebarCollapsed(v) {
  sidebarCollapsed = v;
  $("sidebar").hidden = v;
  $("dragbar").hidden = v;
}
function switchView(name) {
  setSidebarCollapsed(false);
  currentView = name;
  const views = ["explorer", "search", "history", "docs"];
  views.forEach((v) => {
    $("view-" + v).hidden = v !== name;
    document.querySelector(`.act[data-view="${v}"]`).classList.toggle("active", v === name);
  });
  if (name === "history") { renderHistorySel(); }
  if (name === "docs") buildDocs();
}

async function saveSnapshot() {
  const t = activeTab();
  if (!t || t.kind !== "file") { toast("No file open to save", "err"); return; }
  await ws.write(t.path, t.content, { snapshot: true });
  t.dirty = false;
  refreshTabs();
  refreshTree();
  updateStatus();
  toast("Saved " + t.path + " (snapshot recorded)", "ok");
}

function updateStatus() {
  $("wsNameEl").textContent = "workspace";
  const files = openTabs.length;
  $("sbLeft").textContent = "Chance Code · " + (activeTab() ? activeTab().title : "no file open") + (activeTab() && activeTab().dirty ? " ●" : "");
  const lang = currentLang === "plain" ? "txt" : currentLang;
  $("sbRight").textContent = lang + "  Ln " + sbRight_ln + ", Col " + sbRight_col;
}

function focusEditor() { if (editor && !$("editorhost").hidden) editor.focus(); }

/* ---------------- toasts ---------------- */
function toast(msg, kind) {
  const el = document.createElement("div");
  el.className = "toast" + (kind ? " " + kind : "");
  el.textContent = msg;
  $("toasts").appendChild(el);
  setTimeout(() => { el.style.opacity = "0"; el.style.transition = "opacity .3s"; setTimeout(() => el.remove(), 320); }, 2600);
}

/* ---------------- wire UI ---------------- */
function wireUi() {
  // activity bar
  document.querySelectorAll(".act[data-view]").forEach((b) => b.onclick = () => {
    const v = b.dataset.view;
    if (!sidebarCollapsed && currentView === v) setSidebarCollapsed(true);
    else switchView(v);
  });
  document.querySelectorAll(".collapse-btn").forEach((b) => b.onclick = () => setSidebarCollapsed(true));
  $("actRunBtn").onclick = () => runProject();
  $("actAiBtn").onclick = () => { showPanel("ai"); };
  $("actCmdBtn").onclick = () => { $("palette").hidden ? openPalette() : closePalette(); };

  // tabs actions
  $("tabRunBtn").onclick = () => runProject();
  $("tabPreviewBtn").onclick = () => { $("previewpane").hidden = !$("previewpane").hidden; };
  $("tabSaveBtn").onclick = () => saveSnapshot();
  $("pvReloadBtn").onclick = () => runProject();
  $("pvCloseBtn").onclick = () => { $("previewpane").hidden = true; };
  $("newFileBtn").onclick = () => newFile();
  $("openExampleBtn").onclick = () => openExampleMenu();

  // welcome
  $("wcNewBtn").onclick = () => newFile();
  $("wcExampleBtn").onclick = () => openExampleMenu();
  $("wcRunBtn").onclick = async () => { if (!openTabs.length) await openFile("index.html"); runProject(); };
  $("wcDocsBtn").onclick = () => switchView("docs");

  // panel tabs
  document.querySelectorAll(".panel-tab").forEach((b) => b.onclick = () => showPanel(b.dataset.panel));
  $("panelCloseBtn").onclick = () => hidePanel();

  // sidebar resize
  const dragbar = $("dragbar");
  let dragging = false;
  dragbar.addEventListener("mousedown", (e) => {
    dragging = true;
    dragbar.classList.add("dragging");
    const startX = e.clientX;
    const startW = $("sidebar").getBoundingClientRect().width;
    const move = (ev) => {
      const w = Math.min(480, Math.max(150, startW + (ev.clientX - startX)));
      $("sidebar").style.width = w + "px";
    };
    const up = () => {
      dragging = false;
      dragbar.classList.remove("dragging");
      document.removeEventListener("mousemove", move);
      document.removeEventListener("mouseup", up);
    };
    document.addEventListener("mousemove", move);
    document.addEventListener("mouseup", up);
  });

  // palette
  buildPalette();

  // keyboard
  document.addEventListener("keydown", (e) => {
    const mod = e.ctrlKey || e.metaKey;
    if (mod && e.key.toLowerCase() === "s") { e.preventDefault(); saveSnapshot(); return; }
    if (mod && e.key === "Enter") { e.preventDefault(); runProject(); return; }
    if (mod && e.key === "`") { e.preventDefault(); togglePanel(); return; }
    if (mod && e.key.toLowerCase() === "j") { e.preventDefault(); showPanel("ai"); return; }
    if (mod && e.key.toLowerCase() === "k") { e.preventDefault(); openPalette(); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "f") { e.preventDefault(); switchView("search"); setTimeout(() => $("searchInput").focus(), 50); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "e") { e.preventDefault(); switchView("explorer"); return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "p") { e.preventDefault(); $("previewpane").hidden = !$("previewpane").hidden; return; }
    if (mod && e.shiftKey && e.key.toLowerCase() === "a") { e.preventDefault(); showPanel("ai"); ai.setMode("agent"); return; }
  });

  $("searchInput").addEventListener("input", debounceSearch);
}

function debounceSearch() { clearTimeout(searchTimer); searchTimer = setTimeout(doSearch, 300); }

/* ---------------- start ---------------- */
boot();
