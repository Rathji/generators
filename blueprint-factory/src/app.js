import * as L from "./layout.js";
import * as R from "./render.js";
import { buildPrompt, buildRetryPrompt, buildRegeneratePrompt, parseDiagramJSON, sampleGraph } from "./ai.js";

const $ = (id) => document.getElementById(id);

const UI = {
  prompt: $("promptInput"),
  draftBtn: $("draftBtn"),
  typeSel: $("typeSel"),
  dirSel: $("dirSel"),
  themeRow: $("themeRow"),
  chipRow: $("chipRow"),
  exportBtn: $("exportBtn"),
  regenBtn: $("regenBtn"),
  rawBtn: $("rawBtn"),
  zoomOutBtn: $("zoomOutBtn"),
  zoomInBtn: $("zoomInBtn"),
  zoomEl: $("zoomEl"),
  svg: $("diagramSvg"),
  scroll: $("sheetScroll"),
  empty: $("emptyEl"),
  busy: $("busyEl"),
  busyText: $("busyText"),
  error: $("errorEl"),
  errorMsg: $("errorMsg"),
  errorCloseBtn: $("errorCloseBtn"),
  meta: $("metaEl"),
  toast: $("toastEl"),
};

const state = {
  graph: null,
  themeId: "blueprint",
  zoom: 1,
  busy: false,
  metrics: null,
  lastDesc: "",
};

const STATUS_WORDS = [
  "reading the brief",
  "choosing shapes",
  "weighing the layout",
  "inking the lines",
  "labelling the sheet",
];

function dateStr() {
  return new Date().toLocaleDateString("en-US", { month: "short", day: "2-digit", year: "numeric" });
}

async function waitFonts() {
  try {
    const loaded = [];
    for (const t of R.THEMES) {
      for (const key of ["main", "sub", "edge", "block"]) {
        const f = t.f[key];
        if (!f) continue;
        loaded.push(document.fonts.load(`${f.weight} 16px "${f.family}"`).catch(() => {}));
      }
    }
    await Promise.race([Promise.all(loaded), new Promise((res) => setTimeout(res, 3500))]);
    await new Promise((res) => setTimeout(res, 60));
  } catch (err) { console.warn("font wait failed", err); }
}

function typeHint() { return UI.typeSel.value; }
function direction() {
  const v = UI.dirSel.value;
  return v === "lr" ? "LR" : v === "tb" ? "TB" : null;
}

function currentTheme() { return R.themeById(state.themeId); }

// ---------- drawing ----------

function drawCurrent(fitNow) {
  const g = state.graph;
  if (!g) return;
  const theme = currentTheme();
  if (g.type !== "sequence") L.sizeNodes(g, theme);
  g._lanes = L.layoutGraph(g, theme, direction());
  const metrics = R.drawDiagram(UI.svg, g, theme, { dateStr: dateStr() });
  state.metrics = metrics;
  UI.exportBtn.disabled = false;
  UI.rawBtn.disabled = false;
  UI.regenBtn.disabled = false;
  UI.empty.hidden = true;
  applyZoom();
  if (fitNow !== false) fitSheet();
  else updateZoomLabel();
}

function applyZoom() {
  const m = state.metrics;
  if (!m) return;
  const z = state.zoom;
  UI.svg.style.width = Math.round(m.W * z) + "px";
  UI.svg.style.height = Math.round(m.H * z) + "px";
  updateZoomLabel();
}

function updateZoomLabel() {
  UI.zoomEl.textContent = Math.round(state.zoom * 100) + "%";
}

function fitSheet() {
  const m = state.metrics;
  if (!m) return;
  const w = Math.max(200, UI.scroll.clientWidth - 48);
  const h = Math.max(200, UI.scroll.clientHeight - 48);
  let z = Math.min(w / m.W, h / m.H, 1.6);
  z = Math.max(0.08, z);
  state.zoom = Math.round(z * 100) / 100;
  applyZoom();
  UI.scroll.scrollTop = 0;
  UI.scroll.scrollLeft = 0;
}

function zoomBy(factor) {
  state.zoom = Math.min(6, Math.max(0.1, state.zoom * factor));
  applyZoom();
}

function applyRaw(raw) {
  const graph = L.normalizeGraph(raw);
  if (!graph.title) graph.title = "Untitled";
  state.graph = graph;
  UI.typeSel.value = L.TYPES.includes(graph.type) ? graph.type : "auto";
  drawCurrent(true);
  UI.meta.hidden = false;
  UI.meta.textContent = metaText(graph);
}

function metaText(g) {
  if (g.type === "sequence") return `${R.TYPE_LABELS[g.type]} · ${g.actors.length} actors · ${g.messages.length} messages`;
  const links = g.edges.filter((e) => e.arrow === "end" || e.arrow === "both" || e.arrow === "open" || e.arrow === "start").length;
  return `${R.TYPE_LABELS[g.type]} · ${g.nodes.length} shapes · ${g.edges.length} links`;
}

// ---------- busy / errors / toast ----------

let statusTimer = null;
function setBusy(busy) {
  state.busy = busy;
  UI.busy.hidden = !busy;
  UI.draftBtn.disabled = busy;
  UI.exportBtn.disabled = busy || !state.graph;
  UI.rawBtn.disabled = busy || !state.graph;
  UI.regenBtn.disabled = busy || !state.graph;
  clearInterval(statusTimer);
  if (busy) {
    let i = Math.floor(Math.random() * STATUS_WORDS.length);
    UI.busyText.textContent = STATUS_WORDS[i];
    statusTimer = setInterval(() => {
      i = (i + 1) % STATUS_WORDS.length;
      UI.busyText.textContent = STATUS_WORDS[i];
    }, 1500);
  }
}

function showError(msg) {
  UI.errorMsg.textContent = msg;
  UI.error.hidden = false;
}

function toast(msg) {
  UI.toast.textContent = msg;
  UI.toast.hidden = false;
  clearTimeout(toast._t);
  toast._t = setTimeout(() => { UI.toast.hidden = true; }, 2600);
}

// ---------- drafting via AI ----------

async function runDraft(desc, opts) {
  desc = String(desc || "").trim();
  if (!desc || state.busy) return;
  if (!root.generateText) { showError("The text model is not available right now. Try again in a moment."); return; }
  const mode = opts && opts.regenerate ? "regenerate" : "draft";
  setBusy(true);
  UI.error.hidden = true;
  try {
    let raw = "";
    let parsed = null;
    let lastErr = "";
    for (let attempt = 1; attempt <= 2; attempt++) {
      const prompt = attempt === 1
        ? (mode === "regenerate" ? buildRegeneratePrompt(desc, typeHint(), state.graph) : buildPrompt(desc, typeHint()))
        : buildRetryPrompt(desc, typeHint(), raw, lastErr);
      raw = String(await root.generateText(prompt) ?? "");
      try { parsed = parseDiagramJSON(raw); break; }
      catch (err) { lastErr = err.message; }
    }
    if (!parsed) throw new Error("The drafter's reply could not be read as a diagram: " + lastErr);
    const graph = L.normalizeGraph(parsed);
    if (!graph.title) graph.title = "Untitled";
    state.graph = graph;
    state.lastDesc = desc;
    drawCurrent(true);
    UI.meta.hidden = false;
    UI.meta.textContent = metaText(graph);
    toast(mode === "regenerate" ? "Diagram redrafted" : "Diagram drafted");
  } catch (err) {
    console.error(err);
    if (!state.graph) UI.empty.hidden = true;
    showError(err.message || "Drafting failed");
  } finally {
    setBusy(false);
  }
}

function regenerate() {
  if (!state.graph || state.busy) return;
  const desc = state.lastDesc || UI.prompt.value;
  if (!desc) return;
  runDraft(desc, { regenerate: true });
}

function slugify(s) {
  return String(s || "diagram").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "diagram";
}

function cleanGraph(g) {
  const strip = (o) => {
    if (!o || typeof o !== "object") return o;
    const r = {};
    for (const k in o) {
      if (k.startsWith("_")) continue;
      const v = o[k];
      r[k] = Array.isArray(v) ? v.map(strip) : v && typeof v === "object" ? strip(v) : v;
    }
    return r;
  };
  return strip(JSON.parse(JSON.stringify(g)));
}

async function downloadRaw() {
  if (!state.graph || state.busy) return;
  const g = state.graph;
  const slug = slugify(g.title);
  const fire = (name, blob) => {
    const u = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = u;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(u), 4000);
  };
  try {
    const xml = await R.svgSource(UI.svg, currentTheme());
    fire(`${slug}.blueprint.json`, new Blob([JSON.stringify(cleanGraph(g), null, 2)], { type: "application/json" }));
    fire(`${slug}.blueprint.svg`, new Blob([xml], { type: "image/svg+xml;charset=utf-8" }));
    toast("Raw files downloaded");
  } catch (err) {
    console.error(err);
    toast("Download failed");
  }
}

// ---------- theme UI ----------

async function thumbFor(t, rough) {
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", "0 0 132 60");
  svg.setAttribute("width", "132");
  svg.setAttribute("height", "60");
  svg.setAttribute("aria-hidden", "true");
  const mk = (tag, attrs) => R.el(tag, attrs, svg);
  mk("rect", { x: 0, y: 0, width: 132, height: 60, fill: t.paper.colors[0] });
  const stroke = t.crisp ? t.nodeStroke : t.edge;
  const fill = t.nodeFill;
  const lw = t.crisp ? 1.4 : 2;
  const seed = 7;
  if (t.crisp || !rough) {
    mk("rect", { x: 8, y: 12, width: 52, height: 36, rx: 6, fill, stroke: stroke, "stroke-width": lw });
    mk("polygon", { points: "68,30 78,18 96,18 102,30 96,42 78,42", fill, stroke: stroke, "stroke-width": lw });
    mk("line", { x1: 102, y1: 30, x2: 120, y2: 30, stroke: stroke, "stroke-width": lw });
    mk("polygon", { points: "120,30 112,26 112,34", fill: stroke });
  } else {
    const rc = rough.svg(svg);
    const node = rc.rectangle(8, 12, 52, 36, { stroke, strokeWidth: 2.2, roughness: 1.6, bowing: 1, seed, fill, fillStyle: "solid" });
    void node;
    const db = rc.polygon([[70, 30], [82, 18], [100, 18], [106, 30], [100, 42], [82, 42]], { stroke, strokeWidth: 2.2, roughness: 1.4, bowing: 0.8, seed: seed + 1, fill, fillStyle: "solid" });
    void db;
    const ln = rc.line(106, 30, 122, 30, { stroke, strokeWidth: 2, roughness: 1.2, seed: seed + 2 });
    void ln;
  }
  return svg;
}

async function buildThemeUI() {
  const rough = await R.ensureRough();
  UI.themeRow.textContent = "";
  for (const t of R.THEMES) {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "tile" + (t.id === state.themeId ? " active" : "");
    btn.dataset.theme = t.id;
    const thumb = await thumbFor(t, rough);
    const name = document.createElement("div");
    name.className = "tileName";
    name.textContent = t.name;
    const tag = document.createElement("div");
    tag.className = "tileTag";
    tag.textContent = t.tagline;
    btn.append(thumb, name, tag);
    btn.addEventListener("click", () => chooseTheme(t.id));
    UI.themeRow.appendChild(btn);
  }
}

function chooseTheme(id) {
  if (state.themeId === id) return;
  state.themeId = id;
  for (const el of UI.themeRow.children) el.classList.toggle("active", el.dataset.theme === id);
  if (state.graph) drawCurrent(true);
}

// ---------- example chips ----------

function diagramIdeas() {
  try {
    if (!root.diagramIdeas || !root.diagramIdeas.selectAll) return [];
    return root.diagramIdeas.selectAll.map((it) => it.evaluateItem).filter((s) => String(s).trim());
  } catch (err) { return []; }
}

function buildChips() {
  UI.chipRow.textContent = "";
  const ideas = diagramIdeas();
  for (const idea of ideas) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "chip";
    chip.textContent = idea;
    chip.addEventListener("click", () => {
      UI.prompt.value = idea;
      runDraft(idea);
    });
    UI.chipRow.appendChild(chip);
  }
}

// ---------- wiring ----------

function wire() {
  UI.draftBtn.addEventListener("click", () => runDraft(UI.prompt.value));
  UI.prompt.addEventListener("keydown", (ev) => {
    if ((ev.metaKey || ev.ctrlKey) && ev.key === "Enter") { ev.preventDefault(); runDraft(UI.prompt.value); }
  });
  UI.dirSel.addEventListener("change", () => { if (state.graph) drawCurrent(true); });
  UI.zoomInBtn.addEventListener("click", () => zoomBy(1.3));
  UI.zoomOutBtn.addEventListener("click", () => zoomBy(1 / 1.3));
  UI.exportBtn.addEventListener("click", doExport);
  UI.regenBtn.addEventListener("click", regenerate);
  UI.rawBtn.addEventListener("click", downloadRaw);
  UI.errorCloseBtn.addEventListener("click", () => { UI.error.hidden = true; if (!state.graph) UI.empty.hidden = false; });
}

async function doExport() {
  if (!state.graph || state.busy || UI.exportBtn.disabled) return;
  UI.exportBtn.disabled = true;
  try {
    await R.exportPNG(UI.svg, state.graph, currentTheme(), dateStr());
    toast("PNG saved");
  } catch (err) {
    console.error(err);
    toast("Export failed");
  } finally {
    UI.exportBtn.disabled = false;
  }
}

function updateEmptyHint() {
  UI.empty.hidden = !!state.graph;
}

// ---------- boot ----------

function params() {
  return new URLSearchParams(location.search);
}

async function boot() {
  const p = params();
  const theme = p.get("theme");
  if (theme && R.themeById(theme).id === theme) state.themeId = theme;
  await buildThemeUI();
  buildChips();
  wire();
  UI.zoomEl.textContent = "100%";
  updateEmptyHint();
  await waitFonts();

  const test = p.get("test");
  const sampleIdx = p.get("sample");
  if (test) {
    const kind = L.TYPES.includes(test) ? test : "flowchart";
    applyRaw(sampleGraph(kind));
  } else if (sampleIdx !== null) {
    const ideas = diagramIdeas();
    const idx = Math.max(0, parseInt(sampleIdx, 10) || 0);
    const desc = ideas[idx] || "How a bill becomes a law";
    UI.prompt.value = desc;
    runDraft(desc);
  } else {
    UI.empty.hidden = false;
  }
  window.bp = {
    state,
    runDraft: (d) => runDraft(d),
    applyRaw: (r) => applyRaw(r),
    setTheme: chooseTheme,
    setType: (t) => { UI.typeSel.value = t; },
    sample: (kind) => applyRaw(sampleGraph(kind)),
    zoomBy,
    fitSheet,
    dateStr,
    regenerate: () => regenerate(),
    downloadRaw: () => downloadRaw(),
  };
}

boot();
