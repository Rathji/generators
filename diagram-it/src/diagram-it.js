/* ====================================================================
   DIAGRAM-IT — minimalist Excalidraw-style diagramming app.
   - Full-window canvas (draw area = most of the screen)
   - Tools: select / rectangle / ellipse / arrow / text / pan
   - Pan & zoom (wheel, space/middle/right-drag, pinch)
   - Undo/redo, autosave, PNG + JSON export/import
   - Color themes come from diagramIt.theme in main.pjs
     (business-template palettes). Settings modal = Appearance / Canvas / Roadmap.
   ==================================================================== */
(() => {
  "use strict";

  /* ------------------------------- helpers ------------------------------- */
  const $ = (id) => document.getElementById(id);
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const S = (v) => (v == null ? "" : (typeof v === "object" && typeof v.evaluateItem === "function" ? String(v.evaluateItem) : String(v)));
  function loadJSON(key, fb) { try { const v = JSON.parse(localStorage.getItem(key)); return v == null ? fb : v; } catch (e) { return fb; } }
  function saveJSON(key, v) { try { localStorage.setItem(key, JSON.stringify(v)); } catch (e) {} }
  function esc(s) { return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c])); }
  function uid() { return "e" + (idSeq++); }

  /* --------------------------- pjs data (roadmap) --------------------------- */
  const RD = (typeof root !== "undefined" && root && root.diagramIt) ? root.diagramIt : null;

  /* ------------------------------- settings ------------------------------- */
  const LS_SETTINGS = "diagram-it:settings:v1";
  const LS_CANVAS = "diagram-it:canvas:v1";
  const DEFAULTS = {
    mode: "light",
    preset: "blue",
    accent: "",
    canvasBg: "default",
    showGrid: true,
    snap: true,
    strokeColor: "#1e293b",
    fontSize: 16,
    strokeWidth: 2,
  };
  let settings = Object.assign({}, DEFAULTS, loadJSON(LS_SETTINGS, {}));
  if (!["light", "dark"].includes(settings.mode)) settings.mode = "light";

  /* --------------------------- theme presets --------------------------- */
  const presets = {};
  if (RD && RD.theme) {
    try {
      for (const key of Object.keys(RD.theme.presets)) {
        const p = RD.theme.presets[key];
        const mk = (n) => ({
          primary: S(n.primary), secondary: S(n.secondary), accent: S(n.accent),
          background: S(n.background), surface: S(n.surface), text: S(n.text), textMuted: S(n.textMuted),
        });
        presets[key] = { key, label: S(p.label) || key, swatch: S(p.swatch) || "#0a58ca", light: mk(p.light), dark: mk(p.dark) };
      }
    } catch (e) { console.warn("diagram-it: could not read theme presets", e); }
  }
  if (!Object.keys(presets).length) {
    presets.blue = {
      key: "blue", label: "Business Blue", swatch: "#0a58ca",
      light: { primary: "#0a58ca", secondary: "#6ea8fe", accent: "#084298", background: "#f8f9fa", surface: "#ffffff", text: "#212529", textMuted: "#6c757d" },
      dark: { primary: "#3b82f6", secondary: "#60a5fa", accent: "#93c5fd", background: "#0d1420", surface: "#16203a", text: "#e6edf7", textMuted: "#8ea0bd" },
    };
  }
  if (!presets[settings.preset]) settings.preset = Object.keys(presets)[0];

  function currentPalette() {
    const p = presets[settings.preset] || presets[Object.keys(presets)[0]];
    const c = p ? p[settings.mode] : {};
    return Object.assign({}, c, { accent: settings.accent || c.accent || "#0a58ca" });
  }
  const SUN = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>';
  const MOON = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>';

  function applyTheme() {
    const rootEl = document.documentElement;
    rootEl.dataset.theme = settings.mode;
    const c = currentPalette();
    const set = (k, v) => rootEl.style.setProperty(k, v || "");
    set("--primary", c.primary); set("--secondary", c.secondary); set("--accent", c.accent);
    set("--bg", c.background); set("--surface", c.surface); set("--text", c.text); set("--muted", c.textMuted);
    set("--sel", settings.mode === "dark" ? c.accent : c.primary);
    set("--canvas-bg", settings.mode === "dark" ? "#0e1626" : "#ffffff");
    $("themeToggle").innerHTML = settings.mode === "dark" ? SUN : MOON;
    retintElements();
    scheduleDraw();
  }

  /* Elements created with default colors re-map to the active theme so shapes
     stay legible when switching light <-> dark. Explicitly chosen colors
     (custom ink picker) are preserved. */
  function retintElements() {
    const dark = settings.mode === "dark";
    const ink = dark ? "#dbe6f5" : (settings.strokeColor || "#1e293b");
    const fill = elementFill();
    for (const el of elements) {
      if (el.type === "text") {
        if (el.color === "#1e293b" || el.color === "#dbe6f5") el.color = ink;
      } else {
        if (el.fill === "#ffffff" || el.fill === "#1b2740") el.fill = fill;
        if (el.stroke === "#1e293b" || el.stroke === "#dbe6f5") el.stroke = ink;
      }
    }
  }

  function canvasBgColor() {
    const dark = settings.mode === "dark";
    switch (settings.canvasBg) {
      case "white": return "#ffffff";
      case "paper": return dark ? "#182232" : "#fbf7ef";
      case "graph": return dark ? "#0c1424" : "#ffffff";
      default: return dark ? "#0e1626" : "#ffffff";
    }
  }
  function gridColor() { return settings.mode === "dark" ? "rgba(148,163,184,0.09)" : "rgba(15,23,42,0.07)"; }
  function elementFill() { return settings.mode === "dark" ? "#1b2740" : "#ffffff"; }

  /* ------------------------------- state ------------------------------- */
  const cv = $("canvas");
  const ctx = cv.getContext("2d");
  const stage = $("stage");
  let dpr = window.devicePixelRatio || 1;
  let idSeq = 1;
  let elements = [];
  let selectedIds = new Set();
  let view = { ox: 60, oy: 60, scale: 1 };
  let tool = "select";
  let history = [];
  let histPos = -1;
  let drag = null;
  let marquee = null;
  let editingEl = null;
  let spaceDown = false;
  const pointers = new Map();
  let pinch = null;
  let saveTimer = null;
  let drawPending = false;

  const savedCanvas = loadJSON(LS_CANVAS, null);
  if (savedCanvas && Array.isArray(savedCanvas.elements)) {
    elements = savedCanvas.elements.map(normalizeElement);
    if (savedCanvas.view) view = Object.assign(view, savedCanvas.view);
    for (const el of elements) idSeq = Math.max(idSeq, (parseInt(String(el.id).replace(/^\D+/g, ""), 10) || 0) + 1);
  } else {
    seedWelcome();
    elements.forEach(normalizeElement);
  }
  pushHistory();

  function normalizeElement(el) {
    if (!el.id) el.id = uid();
    if (el.stroke == null) el.stroke = "#1e293b";
    if (el.strokeWidth == null) el.strokeWidth = 2;
    if (el.fill == null) el.fill = elementFill();
    if (el.fontSize == null) el.fontSize = 16;
    if (el.color == null) el.color = el.stroke;
    if (el.label == null) el.label = "";
    if (el.text == null) el.text = "";
    if (el.arrowhead == null) el.arrowhead = true;
    if ((el.type === "rect" || el.type === "ellipse") && el.w != null) {
      if (el.w < 0) { el.x += el.w; el.w = -el.w; }
      if (el.h < 0) { el.y += el.h; el.h = -el.h; }
    }
    return el;
  }

  function seedWelcome() {
    elements = [
      { id: uid(), type: "text", x: 60, y: 40, w: 460, text: "diagram-it — click & drag to draw", fontSize: 24, color: currentPalette().primary },
      { id: uid(), type: "rect", x: 60, y: 140, w: 220, h: 110, stroke: "#1e293b", strokeWidth: 2, fill: "#ffffff", label: "API Gateway" },
      { id: uid(), type: "rect", x: 400, y: 140, w: 220, h: 110, stroke: "#1e293b", strokeWidth: 2, fill: "#ffffff", label: "Kubernetes" },
      { id: uid(), type: "arrow", x: 280, y: 195, x2: 400, y2: 195, stroke: "#1e293b", strokeWidth: 2, arrowhead: true },
      { id: uid(), type: "ellipse", x: 60, y: 350, w: 240, h: 100, stroke: "#1e293b", strokeWidth: 2, fill: "#ffffff", label: "Database" },
      { id: uid(), type: "arrow", x: 180, y: 250, x2: 180, y2: 350, stroke: "#1e293b", strokeWidth: 2, arrowhead: true },
    ];
  }

  /* ------------------------------- canvas ------------------------------- */
  function resizeCanvas() {
    const r = stage.getBoundingClientRect();
    dpr = window.devicePixelRatio || 1;
    const w = Math.max(1, Math.round(r.width));
    const h = Math.max(1, Math.round(r.height));
    cv.width = Math.round(w * dpr);
    cv.height = Math.round(h * dpr);
    cv.style.width = w + "px";
    cv.style.height = h + "px";
    scheduleDraw();
  }

  function toScene(sx, sy) { return { x: (sx - view.ox) / view.scale, y: (sy - view.oy) / view.scale }; }
  function toScreen(sx, sy) { return { x: sx * view.scale + view.ox, y: sy * view.scale + view.oy }; }

  /* ------------------------------- drawing ------------------------------- */
  function scheduleDraw() {
    if (drawPending) return;
    drawPending = true;
    requestAnimationFrame(() => { drawPending = false; draw(); });
  }
  function draw() {
    const w = cv.width / dpr, h = cv.height / dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    ctx.fillStyle = canvasBgColor();
    ctx.fillRect(0, 0, w, h);
    if (settings.showGrid) drawGrid(w, h);

    ctx.save();
    ctx.translate(view.ox, view.oy);
    ctx.scale(view.scale, view.scale);
    for (const el of elements) drawElement(ctx, el);
    if (drag && drag.kind === "create") drawElement(ctx, drag.el);
    ctx.restore();

    if (tool === "select" || tool === "pan") drawSelectionOverlay();
    if (marquee) drawMarquee();
    updateStatus();
  }

  function drawGrid(w, h) {
    const step = 24 * view.scale;
    if (step < 8) return;
    ctx.save();
    ctx.strokeStyle = gridColor();
    ctx.lineWidth = 1;
    ctx.beginPath();
    const ox = ((-view.ox) % step + step) % step;
    const oy = ((-view.oy) % step + step) % step;
    for (let x = ox; x <= w; x += step) { ctx.moveTo(x, 0); ctx.lineTo(x, h); }
    for (let y = oy; y <= h; y += step) { ctx.moveTo(0, y); ctx.lineTo(w, y); }
    ctx.stroke();
    ctx.restore();
  }

  function wrapText(text, maxW, fontSize, g) {
    const words = String(text).split(/\s+/).filter(Boolean);
    if (!words.length) return [];
    g.save();
    g.font = fontSize + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    const lines = [];
    let line = "";
    for (const wd of words) {
      const t = line ? line + " " + wd : wd;
      if (g.measureText(t).width <= maxW || !line) line = t;
      else { lines.push(line); line = wd; }
    }
    if (line) lines.push(line);
    g.restore();
    return lines;
  }

  function drawLabel(g, text, x, y, w, h, pad) {
    const fontSize = clamp(Math.min(h * 0.32, 18), 9, 24);
    const lines = wrapText(text, Math.max(20, w - pad * 2), fontSize, g);
    g.font = "600 " + fontSize + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
    g.fillStyle = settings.mode === "dark" ? "#dbe6f5" : "#26324a";
    const lh = fontSize * 1.3;
    let ty = y + h / 2 - (lines.length * lh) / 2 + lh * 0.8;
    for (const ln of lines) {
      const tw = g.measureText(ln).width;
      g.fillText(ln, x + (w - tw) / 2, ty);
      ty += lh;
    }
  }

  function drawArrowhead(g, el, scale) {
    const ang = Math.atan2(el.y2 - el.y, el.x2 - el.x);
    const len = Math.min(16 / scale, Math.hypot(el.x2 - el.x, el.y2 - el.y) * 0.45);
    const a = Math.PI / 7;
    g.fillStyle = el.stroke;
    g.beginPath();
    g.moveTo(el.x2, el.y2);
    g.lineTo(el.x2 - len * Math.cos(ang - a), el.y2 - len * Math.sin(ang - a));
    g.lineTo(el.x2 - len * Math.cos(ang + a), el.y2 - len * Math.sin(ang + a));
    g.closePath();
    g.fill();
  }

  function drawElement(g, el, scale) {
    scale = scale || view.scale;
    g.save();
    g.lineCap = "round";
    g.lineJoin = "round";
    const sw = el.strokeWidth || 2;
    if (el.type === "rect") {
      g.strokeStyle = el.stroke;
      g.lineWidth = sw;
      g.fillStyle = el.fill || "#ffffff";
      g.beginPath();
      g.rect(el.x, el.y, el.w, el.h);
      g.fill();
      g.stroke();
      if (el.label) drawLabel(g, el.label, el.x, el.y, el.w, el.h, 12 / scale);
    } else if (el.type === "ellipse") {
      g.strokeStyle = el.stroke;
      g.lineWidth = sw;
      g.fillStyle = el.fill || "#ffffff";
      g.beginPath();
      g.ellipse(el.x + el.w / 2, el.y + el.h / 2, Math.max(0.5, el.w / 2), Math.max(0.5, el.h / 2), 0, 0, Math.PI * 2);
      g.fill();
      g.stroke();
      if (el.label) drawLabel(g, el.label, el.x, el.y, el.w, el.h, 12 / scale);
    } else if (el.type === "arrow") {
      g.strokeStyle = el.stroke;
      g.lineWidth = sw;
      g.beginPath();
      g.moveTo(el.x, el.y);
      g.lineTo(el.x2, el.y2);
      g.stroke();
      if (el.arrowhead !== false) drawArrowhead(g, el, scale);
      if (el.label) {
        const mx = (el.x + el.x2) / 2, my = (el.y + el.y2) / 2;
        const fs = clamp(13 / scale, 9, 18);
        g.font = "700 " + fs + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
        const tw = g.measureText(el.label).width;
        const halo = 4 / scale;
        g.fillStyle = canvasBgColor();
        g.globalAlpha = 0.85;
        g.beginPath();
        g.roundRect(mx - tw / 2 - halo, my - fs - halo * 0.4, tw + halo * 2, fs + halo * 0.8, halo);
        g.fill();
        g.globalAlpha = 1;
        g.fillStyle = settings.mode === "dark" ? "#dbe6f5" : "#26324a";
        g.fillText(el.label, mx - tw / 2, my - 4);
      }
    } else if (el.type === "text") {
      const lines = wrapText(el.text || "", el.w, el.fontSize, g);
      const lh = el.fontSize * 1.35;
      g.fillStyle = el.color || el.stroke;
      g.font = el.fontSize + "px system-ui, -apple-system, Segoe UI, Roboto, sans-serif";
      lines.forEach((ln, i) => g.fillText(ln, el.x, el.y + lh * (i + 1)));
    }
    g.restore();
  }

  /* --------------------------- selection / bbox --------------------------- */
  const HANDLES = ["nw", "n", "ne", "e", "se", "s", "sw", "w"];
  function elBBox(el) {
    if (el.type === "arrow") {
      return { x: Math.min(el.x, el.x2), y: Math.min(el.y, el.y2), w: Math.abs(el.x - el.x2), h: Math.abs(el.y - el.y2) };
    }
    if (el.type === "text") {
      const lines = wrapText(el.text || "", el.w, el.fontSize, ctx);
      return { x: el.x, y: el.y, w: el.w, h: Math.max(el.fontSize, lines.length * el.fontSize * 1.35) };
    }
    return { x: el.x, y: el.y, w: el.w, h: el.h };
  }
  function selectionBBox() {
    if (!selectedIds.size) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      if (!selectedIds.has(el.id)) continue;
      const b = elBBox(el);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    if (!isFinite(minX)) return null;
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  function sceneBBox() {
    if (!elements.length) return null;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const el of elements) {
      const b = elBBox(el);
      minX = Math.min(minX, b.x); minY = Math.min(minY, b.y);
      maxX = Math.max(maxX, b.x + b.w); maxY = Math.max(maxY, b.y + b.h);
    }
    return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
  }
  function handlePos(bbox, h) {
    const pts = {
      nw: [bbox.x, bbox.y], n: [bbox.x + bbox.w / 2, bbox.y], ne: [bbox.x + bbox.w, bbox.y],
      e: [bbox.x + bbox.w, bbox.y + bbox.h / 2], se: [bbox.x + bbox.w, bbox.y + bbox.h],
      s: [bbox.x + bbox.w / 2, bbox.y + bbox.h], sw: [bbox.x, bbox.y + bbox.h], w: [bbox.x, bbox.y + bbox.h / 2],
    };
    const s = toScreen(pts[h][0], pts[h][1]);
    return { x: s.x, y: s.y };
  }
  function findHandle(sp, bbox) {
    if (!bbox) return null;
    const tol = 9;
    for (const h of HANDLES) {
      const pos = handlePos(bbox, h);
      if (Math.abs(sp.x - pos.x) <= tol && Math.abs(sp.y - pos.y) <= tol) return h;
    }
    return null;
  }
  function drawSelectionOverlay() {
    if (editingEl || !selectedIds.size) return;
    const bbox = selectionBBox();
    if (!bbox) return;
    const p0 = toScreen(bbox.x, bbox.y);
    const p1 = toScreen(bbox.x + bbox.w, bbox.y + bbox.h);
    const c = currentPalette();
    const selColor = settings.mode === "dark" ? c.accent : c.primary;
    ctx.save();
    ctx.strokeStyle = selColor;
    ctx.lineWidth = 1.4;
    ctx.setLineDash([4, 3]);
    ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    ctx.setLineDash([]);
    const hs = 7;
    ctx.fillStyle = "#ffffff";
    ctx.strokeStyle = selColor;
    ctx.lineWidth = 1.5;
    for (const h of HANDLES) {
      const pos = handlePos(bbox, h);
      ctx.fillRect(pos.x - hs / 2, pos.y - hs / 2, hs, hs);
      ctx.strokeRect(pos.x - hs / 2, pos.y - hs / 2, hs, hs);
    }
    ctx.restore();
  }
  function drawMarquee() {
    if (!marquee) return;
    const p0 = toScreen(marquee.x0, marquee.y0);
    const p1 = toScreen(marquee.x1, marquee.y1);
    ctx.save();
    ctx.fillStyle = "rgba(59,130,246,0.10)";
    ctx.strokeStyle = "#3b82f6";
    ctx.lineWidth = 1.2;
    ctx.fillRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    ctx.strokeRect(p0.x, p0.y, p1.x - p0.x, p1.y - p0.y);
    ctx.restore();
  }

  /* ------------------------------- hit testing ------------------------------- */
  function distToSeg(p, a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    if (!L2) return Math.hypot(p.x - a.x, p.y - a.y);
    let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2;
    t = clamp(t, 0, 1);
    return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
  }
  function pointInEl(el, p) {
    const pad = 5 / view.scale;
    if (el.type === "rect") {
      return p.x >= el.x - pad && p.x <= el.x + el.w + pad && p.y >= el.y - pad && p.y <= el.y + el.h + pad;
    }
    if (el.type === "ellipse") {
      const cx = el.x + el.w / 2, cy = el.y + el.h / 2;
      const rx = Math.max(1, Math.abs(el.w) / 2) + pad, ry = Math.max(1, Math.abs(el.h) / 2) + pad;
      const dx = (p.x - cx) / rx, dy = (p.y - cy) / ry;
      return dx * dx + dy * dy <= 1;
    }
    if (el.type === "arrow") {
      return distToSeg(p, { x: el.x, y: el.y }, { x: el.x2, y: el.y2 }) <= Math.max(8 / view.scale, el.strokeWidth / 2 + 2 / view.scale);
    }
    if (el.type === "text") {
      return p.x >= el.x - pad && p.x <= el.x + el.w + pad && p.y >= el.y - pad && p.y <= el.y + el.h + pad;
    }
    return false;
  }
  function hitTest(p) {
    for (let i = elements.length - 1; i >= 0; i--) if (pointInEl(elements[i], p)) return elements[i];
    return null;
  }

  /* ------------------------------- element factory ------------------------------- */
  function newEl(type) {
    return {
      id: uid(), type,
      x: 0, y: 0, w: 0, h: 0, x2: 0, y2: 0,
      stroke: settings.strokeColor, strokeWidth: settings.strokeWidth,
      fill: elementFill(), color: settings.strokeColor,
      fontSize: settings.fontSize, text: "", label: "", arrowhead: true,
    };
  }
  function snapScene(p) { const gs = 24; return { x: Math.round(p.x / gs) * gs, y: Math.round(p.y / gs) * gs }; }
  function snapshotSelected() {
    const arr = [];
    for (const el of elements) if (selectedIds.has(el.id)) arr.push({ id: el.id, x: el.x, y: el.y, w: el.w, h: el.h, x2: el.x2, y2: el.y2, fontSize: el.fontSize });
    return arr;
  }

  /* ------------------------------- interactions ------------------------------- */
  function canvasPos(e) {
    const r = cv.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  }
  function cancelDrag() {
    if (drag && drag.kind === "create") elements = elements.filter((x) => x !== drag.el);
    drag = null;
    marquee = null;
    stage.classList.remove("panning");
  }
  function onPointerDown(e) {
    cv.setPointerCapture(e.pointerId);
    const cl = { x: e.clientX, y: e.clientY };
    pointers.set(e.pointerId, cl);
    if (pointers.size === 2) {
      cancelDrag();
      const [a, b] = [...pointers.values()];
      pinch = { dist: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, lastDist: null };
      return;
    }
    if (e.button === 1 || e.button === 2 || spaceDown || tool === "pan") {
      drag = { kind: "pan", startX: e.clientX, startY: e.clientY, ox: view.ox, oy: view.oy };
      stage.classList.add("panning");
      e.preventDefault();
      return;
    }
    if (e.button !== 0) return;
    commitText();
    const sp = canvasPos(e);
    const sc = toScene(sp.x, sp.y);

    if (tool === "select") {
      const bbox = selectionBBox();
      const h = findHandle(sp, bbox);
      if (h) {
        drag = { kind: "resize", handle: h, bbox: { ...bbox }, orig: snapshotSelected() };
        scheduleDraw();
        return;
      }
      const hit = hitTest(sc);
      if (hit) {
        if (e.shiftKey) {
          if (selectedIds.has(hit.id)) selectedIds.delete(hit.id);
          else selectedIds.add(hit.id);
        } else if (!selectedIds.has(hit.id)) {
          selectedIds = new Set([hit.id]);
        }
        drag = { kind: "move", startScene: sc, orig: snapshotSelected() };
        scheduleDraw();
        return;
      }
      if (!e.shiftKey) selectedIds.clear();
      marquee = { x0: sc.x, y0: sc.y, x1: sc.x, y1: sc.y };
      drag = { kind: "marquee" };
      scheduleDraw();
      return;
    }
    if (tool === "text") {
      const p = settings.snap ? snapScene(sc) : sc;
      const el = newEl("text");
      el.x = p.x; el.y = p.y; el.w = 180;
      elements.push(el);
      selectedIds = new Set([el.id]);
      pushHistory();
      startTextEdit(el);
      scheduleDraw();
      return;
    }
    const start = settings.snap ? snapScene(sc) : sc;
    const el = newEl(tool);
    if (tool === "arrow") { el.x = start.x; el.y = start.y; el.x2 = start.x; el.y2 = start.y; }
    else { el.x = start.x; el.y = start.y; el.w = 0; el.h = 0; }
    drag = { kind: "create", el, start };
    scheduleDraw();
  }

  function applyResize(sc) {
    const { bbox, handle, orig } = drag;
    let px = sc.x, py = sc.y;
    if (settings.snap) { const gs = 24; px = Math.round(px / gs) * gs; py = Math.round(py / gs) * gs; }
    let left = bbox.x, top = bbox.y, right = bbox.x + bbox.w, bottom = bbox.y + bbox.h;
    if (handle.includes("e")) right = Math.max(px, left + 1);
    if (handle.includes("w")) left = Math.min(px, right - 1);
    if (handle.includes("s")) bottom = Math.max(py, top + 1);
    if (handle.includes("n")) top = Math.min(py, bottom - 1);
    const sx = (right - left) / Math.max(bbox.w, 0.001);
    const sy = (bottom - top) / Math.max(bbox.h, 0.001);
    if (!isFinite(sx) || !isFinite(sy)) return;
    for (const s of orig) {
      const el = elements.find((x) => x.id === s.id);
      if (!el) continue;
      if (el.type === "arrow") {
        el.x = left + (s.x - bbox.x) * sx;
        el.y = top + (s.y - bbox.y) * sy;
        el.x2 = left + (s.x2 - bbox.x) * sx;
        el.y2 = top + (s.y2 - bbox.y) * sy;
        if (Math.abs(el.x2 - el.x) < 0.5 && Math.abs(el.y2 - el.y) < 0.5) el.x2 += 1;
      } else {
        el.x = left + (s.x - bbox.x) * sx;
        el.y = top + (s.y - bbox.y) * sy;
        el.w = Math.max(1, s.w * sx);
        el.h = Math.max(1, s.h * sy);
        if (el.type === "text") el.fontSize = Math.max(6, (s.fontSize || 16) * (sx + sy) / 2);
      }
    }
  }

  function onPointerMove(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pinch && pointers.size >= 2) {
      const [a, b] = [...pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      if (pinch.lastDist && pinch.lastDist > 0) {
        const r = cv.getBoundingClientRect();
        zoomAt(mid.x - r.left, mid.y - r.top, dist / pinch.lastDist);
      }
      pinch.lastDist = dist;
      return;
    }
    if (!drag) return;
    const r = cv.getBoundingClientRect();
    const sp = { x: e.clientX - r.left, y: e.clientY - r.top };
    const sc = toScene(sp.x, sp.y);
    if (drag.kind === "pan") {
      view.ox = drag.ox + (e.clientX - drag.startX);
      view.oy = drag.oy + (e.clientY - drag.startY);
      updateZoomLabel();
      scheduleDraw();
      return;
    }
    if (drag.kind === "move") {
      const dx = sc.x - drag.startScene.x, dy = sc.y - drag.startScene.y;
      for (const s of drag.orig) {
        const el = elements.find((x) => x.id === s.id);
        if (!el) continue;
        el.x = s.x + dx; el.y = s.y + dy;
        if (el.x2 != null) { el.x2 = s.x2 + dx; el.y2 = s.y2 + dy; }
      }
      scheduleDraw();
      return;
    }
    if (drag.kind === "resize") { applyResize(sc); scheduleDraw(); return; }
    if (drag.kind === "create") {
      const el = drag.el;
      const cur = settings.snap ? snapScene(sc) : sc;
      if (el.type === "arrow") { el.x2 = cur.x; el.y2 = cur.y; }
      else {
        el.x = Math.min(drag.start.x, cur.x);
        el.y = Math.min(drag.start.y, cur.y);
        el.w = Math.abs(cur.x - drag.start.x);
        el.h = Math.abs(cur.y - drag.start.y);
      }
      scheduleDraw();
      return;
    }
    if (drag.kind === "marquee") { marquee.x1 = sc.x; marquee.y1 = sc.y; scheduleDraw(); }
  }

  function onPointerUp(e) {
    if (!pointers.has(e.pointerId)) return;
    pointers.delete(e.pointerId);
    if (pinch && pointers.size < 2) pinch = null;
    if (!drag) return;
    const k = drag.kind;
    stage.classList.remove("panning");
    if (k === "create") {
      const el = drag.el;
      const tooSmall = el.type === "arrow"
        ? Math.hypot(el.x2 - el.x, el.y2 - el.y) < 8
        : (Math.abs(el.w) < 5 && Math.abs(el.h) < 5);
      if (tooSmall) elements = elements.filter((x) => x.id !== el.id);
      else {
        elements.push(el);
        selectedIds = new Set([el.id]);
        pushHistory();
        autosave();
      }
    } else if (k === "move" || k === "resize") {
      pushHistory();
      autosave();
    } else if (k === "marquee") {
      const r = {
        x: Math.min(marquee.x0, marquee.x1), y: Math.min(marquee.y0, marquee.y1),
        w: Math.abs(marquee.x1 - marquee.x0), h: Math.abs(marquee.y1 - marquee.y0),
      };
      for (const el of elements) {
        const b = elBBox(el);
        if (r.x < b.x + b.w && r.x + r.w > b.x && r.y < b.y + b.h && r.y + r.h > b.y) selectedIds.add(el.id);
      }
    }
    marquee = null;
    drag = null;
    scheduleDraw();
  }

  /* ------------------------------- zoom / fit ------------------------------- */
  function zoomAt(sx, sy, factor) {
    const ns = clamp(view.scale * factor, 0.12, 8);
    factor = ns / view.scale;
    view.ox = sx - (sx - view.ox) * factor;
    view.oy = sy - (sy - view.oy) * factor;
    view.scale = ns;
    updateZoomLabel();
    scheduleDraw();
  }
  function zoomBy(f) { const w = cv.width / dpr, h = cv.height / dpr; zoomAt(w / 2, h / 2, f); }
  function fitView() {
    const bb = sceneBBox();
    if (!bb) return;
    const w = cv.width / dpr, h = cv.height / dpr;
    const pad = 60;
    const scale = clamp(Math.min((w - pad * 2) / Math.max(bb.w, 1), (h - pad * 2) / Math.max(bb.h, 1)), 0.12, 2);
    view.scale = scale;
    view.ox = (w - bb.w * scale) / 2 - bb.x * scale;
    view.oy = (h - bb.h * scale) / 2 - bb.y * scale;
    updateZoomLabel();
    scheduleDraw();
  }
  function updateZoomLabel() { const z = $("zoomLabel"); if (z) z.textContent = Math.round(view.scale * 100) + "%"; }
  function updateStatus() { $("statusRight").textContent = elements.length + (elements.length === 1 ? " shape" : " shapes") + "  ·  " + Math.round(view.scale * 100) + "%"; }

  /* ------------------------------- text editing ------------------------------- */
  function startTextEdit(el) {
    if (editingEl) commitText();
    editingEl = el;
    const ed = $("textEditor");
    const p = toScreen(el.x, el.y);
    ed.hidden = false;
    ed.style.left = p.x + "px";
    ed.style.top = p.y + "px";
    ed.style.width = Math.max(60, el.w * view.scale - (el.type === "text" ? 0 : 24)) + "px";
    ed.style.fontSize = (el.type === "text" ? el.fontSize : clamp(el.h * 0.3, 12, 20)) * view.scale + "px";
    ed.style.lineHeight = "1.35";
    ed.style.textAlign = el.type === "text" ? "left" : "center";
    ed.textContent = el.type === "text" ? el.text : (el.label || "");
    ed.focus();
    const range = document.createRange();
    range.selectNodeContents(ed);
    range.collapse(false);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
    scheduleDraw();
  }
  function commitText() {
    if (!editingEl) return;
    const el = editingEl;
    editingEl = null;
    const ed = $("textEditor");
    ed.hidden = true;
    const val = ed.textContent.replace(/\u00a0/g, " ").trimEnd();
    if (el.type === "text") {
      if (!val.trim()) {
        elements = elements.filter((x) => x.id !== el.id);
        selectedIds.delete(el.id);
      } else {
        el.text = val;
        el.w = Math.max(el.w, 40);
      }
    } else {
      el.label = val.trim();
    }
    pushHistory();
    autosave();
    scheduleDraw();
  }

  /* ------------------------------- history ------------------------------- */
  function pushHistory() {
    history = history.slice(0, histPos + 1);
    history.push(JSON.stringify(elements));
    if (history.length > 300) history.shift();
    histPos = history.length - 1;
  }
  function undo() {
    if (editingEl) commitText();
    if (histPos > 0) { histPos--; elements = JSON.parse(history[histPos]); selectedIds.clear(); scheduleDraw(); autosave(); }
  }
  function redo() {
    if (editingEl) commitText();
    if (histPos < history.length - 1) { histPos++; elements = JSON.parse(history[histPos]); selectedIds.clear(); scheduleDraw(); autosave(); }
  }

  /* ------------------------------- persistence ------------------------------- */
  function autosave() {
    if (saveTimer) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => saveJSON(LS_CANVAS, { elements, view }), 600);
  }

  /* ------------------------------- import / export ------------------------------- */
  function exportPng() {
    const bb = sceneBBox();
    if (!bb) { toast("Nothing to export yet"); return; }
    const pad = 40;
    const W = Math.max(120, Math.ceil(bb.w + pad * 2));
    const H = Math.max(120, Math.ceil(bb.h + pad * 2));
    const c = document.createElement("canvas");
    c.width = W * 2; c.height = H * 2;
    const g = c.getContext("2d");
    g.scale(2, 2);
    g.fillStyle = canvasBgColor();
    g.fillRect(0, 0, W, H);
    g.translate(pad - bb.x, pad - bb.y);
    for (const el of elements) drawElement(g, el, 1);
    const a = document.createElement("a");
    a.download = "diagram.png";
    a.href = c.toDataURL("image/png");
    a.click();
    toast("PNG exported");
  }
  function exportJson() {
    const data = { app: "diagram-it", version: 1, view, elements };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "diagram.json";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    toast("JSON exported");
  }
  function importJson(file) {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(reader.result);
        if (!Array.isArray(data.elements)) throw new Error("not a diagram-it JSON file");
        elements = data.elements.map(normalizeElement);
        if (data.view) view = Object.assign(view, data.view);
        selectedIds.clear();
        pushHistory();
        autosave();
        scheduleDraw();
        toast("Diagram imported");
      } catch (err) {
        toast("Import failed: " + err.message);
      }
    };
    reader.readAsText(file);
  }

  /* ------------------------------- tools ------------------------------- */
  function setTool(t) {
    tool = t;
    document.querySelectorAll("#tools .tool-btn[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    updateCursor();
  }
  function updateCursor() {
    if (spaceDown || tool === "pan" || stage.classList.contains("panning")) cv.style.cursor = "grab";
    else if (tool === "select") cv.style.cursor = "default";
    else if (tool === "text") cv.style.cursor = "text";
    else cv.style.cursor = "crosshair";
  }

  /* ------------------------------- operations ------------------------------- */
  function deleteSelected() {
    if (!selectedIds.size) return;
    elements = elements.filter((el) => !selectedIds.has(el.id));
    selectedIds.clear();
    pushHistory();
    autosave();
    scheduleDraw();
  }
  function duplicate() {
    if (!selectedIds.size) return;
    const copies = [];
    for (const el of elements) {
      if (!selectedIds.has(el.id)) continue;
      const c = JSON.parse(JSON.stringify(el));
      c.id = uid();
      c.x += 16; c.y += 16;
      if (c.x2 != null) { c.x2 += 16; c.y2 += 16; }
      copies.push(c);
    }
    elements.push(...copies);
    selectedIds = new Set(copies.map((c) => c.id));
    pushHistory();
    autosave();
    scheduleDraw();
  }
  function selectAll() { selectedIds = new Set(elements.map((el) => el.id)); scheduleDraw(); }

  /* ------------------------------- keyboard ------------------------------- */
  function onKeyDown(e) {
    if (editingEl) {
      if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); commitText(); }
      else if (e.key === "Escape") commitText();
      return;
    }
    const mod = e.ctrlKey || e.metaKey;
    const k = e.key.toLowerCase();
    if (mod && k === "z") { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
    if (mod && k === "y") { e.preventDefault(); redo(); return; }
    if (mod && k === "d") { e.preventDefault(); duplicate(); return; }
    if (mod && k === "a") { e.preventDefault(); selectAll(); return; }
    if (e.key === "Delete" || e.key === "Backspace") { e.preventDefault(); deleteSelected(); return; }
    if (e.key === "Escape") { drag = null; marquee = null; selectedIds.clear(); scheduleDraw(); return; }
    if (e.key === " ") { spaceDown = true; updateCursor(); e.preventDefault(); return; }
    const toolKeys = { v: "select", r: "rect", o: "ellipse", a: "arrow", t: "text", h: "pan", p: "pan" };
    if (toolKeys[k] && !mod) { setTool(toolKeys[k]); return; }
    const step = e.shiftKey ? 20 : 4;
    let dx = 0, dy = 0;
    if (e.key === "ArrowLeft") dx = -step;
    else if (e.key === "ArrowRight") dx = step;
    else if (e.key === "ArrowUp") dy = -step;
    else if (e.key === "ArrowDown") dy = step;
    if ((dx || dy) && selectedIds.size) {
      e.preventDefault();
      for (const el of elements) {
        if (!selectedIds.has(el.id)) continue;
        el.x += dx; el.y += dy;
        if (el.x2 != null) { el.x2 += dx; el.y2 += dy; }
      }
      pushHistory();
      autosave();
      scheduleDraw();
    }
  }
  function onKeyUp(e) { if (e.key === " ") { spaceDown = false; updateCursor(); } }

  /* ------------------------------- settings modal ------------------------------- */
  let modalDirty = false;
  function markDirty() { modalDirty = true; $("dirtyHint").hidden = false; }
  function syncControls() {
    document.querySelectorAll("#modeSeg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.mode === settings.mode));
    document.querySelectorAll("#bgSeg .seg-btn").forEach((b) => b.classList.toggle("active", b.dataset.bg === settings.canvasBg));
    document.querySelectorAll("#presetGrid .preset").forEach((b) => b.classList.toggle("active", b.dataset.preset === settings.preset));
    $("accentInput").value = settings.accent || currentPalette().accent;
    $("strokeColorSetting").value = settings.strokeColor;
    $("fontSizeInput").value = settings.fontSize;
    $("fontSizeVal").textContent = settings.fontSize + "px";
    $("strokeWidthInput").value = settings.strokeWidth;
    $("strokeWidthVal").textContent = settings.strokeWidth;
    $("gridCheck").checked = settings.showGrid;
    $("snapCheck").checked = settings.snap;
  }
  function renderPresets() {
    const grid = $("presetGrid");
    grid.innerHTML = "";
    for (const key of Object.keys(presets)) {
      const p = presets[key];
      const b = document.createElement("button");
      b.type = "button";
      b.className = "preset";
      b.dataset.preset = key;
      b.title = p.label;
      b.innerHTML = '<span class="p-dot" style="background:linear-gradient(135deg,' + p.light.primary + ' 50%,' + p.dark.primary + ' 50%)"></span><span>' + esc(p.label) + "</span>";
      b.addEventListener("click", () => { settings.preset = key; applyTheme(); syncControls(); markDirty(); });
      grid.appendChild(b);
    }
  }
  function renderRoadmap() {
    const ctn = $("roadmapList");
    if (!RD) { ctn.innerHTML = "<p class='panel-intro'>Roadmap data not found — check <code>diagramIt.roadmap</code> in main.pjs.</p>"; return; }
    let html = "";
    try {
      for (const phaseKey of Object.keys(RD.roadmap)) {
        const phase = RD.roadmap[phaseKey];
        const phaseTitle = S(phase.title);
        const tasksNode = phase.tasks;
        html += '<div class="rm-phase"><div class="rm-phase-title">' + esc(phaseTitle) + "</div><ul class='rm-tasks'>";
        for (const tKey of Object.keys(tasksNode)) {
          const t = tasksNode[tKey];
          const done = S(t.status) === "done";
          html += '<li class="rm-task' + (done ? " done" : "") + '"><span class="rm-check">' + (done ? "✓" : "") + '</span><span class="rm-text">' + esc(S(t.title)) + "</span></li>";
        }
        html += "</ul></div>";
      }
    } catch (e) {
      html = "<p class='panel-intro'>Could not read roadmap: " + esc(e.message) + "</p>";
    }
    ctn.innerHTML = html;
  }
  function openSettings() {
    syncControls();
    modalDirty = false;
    $("dirtyHint").hidden = true;
    renderRoadmap();
    $("settingsModal").hidden = false;
  }
  function closeSettings() { $("settingsModal").hidden = true; }
  function saveSettings() {
    saveJSON(LS_SETTINGS, settings);
    modalDirty = false;
    $("dirtyHint").hidden = true;
    closeSettings();
    applyTheme();
    toast("Settings saved");
  }
  function resetSettings() {
    settings = Object.assign({}, DEFAULTS);
    applyTheme();
    syncControls();
    markDirty();
    toast("Reset to defaults — press Save to apply");
  }

  /* ------------------------------- toast ------------------------------- */
  function toast(msg) {
    const ctn = $("toastCtn");
    const t = document.createElement("div");
    t.className = "toast";
    t.textContent = msg;
    ctn.appendChild(t);
    setTimeout(() => { t.style.opacity = "0"; t.style.transition = "opacity .25s"; }, 1700);
    setTimeout(() => t.remove(), 2000);
  }

  /* ------------------------------- init ------------------------------- */
  function init() {
    applyTheme();
    renderPresets();

    document.querySelectorAll("#tools .tool-btn[data-tool]").forEach((b) => b.addEventListener("click", () => setTool(b.dataset.tool)));
    $("undoBtn").addEventListener("click", undo);
    $("redoBtn").addEventListener("click", redo);
    $("clearBtn").addEventListener("click", () => {
      if (!elements.length) return;
      if (window.confirm("Clear the canvas? This cannot be undone.")) {
        elements = [];
        selectedIds.clear();
        pushHistory();
        autosave();
        scheduleDraw();
        toast("Canvas cleared");
      }
    });
    $("zoomInBtn").addEventListener("click", () => zoomBy(1.25));
    $("zoomOutBtn").addEventListener("click", () => zoomBy(1 / 1.25));
    $("fitBtn").addEventListener("click", fitView);
    $("themeToggle").addEventListener("click", () => {
      settings.mode = settings.mode === "dark" ? "light" : "dark";
      applyTheme();
      saveJSON(LS_SETTINGS, settings);
      toast(settings.mode === "dark" ? "Dark mode" : "Light mode");
    });
    $("settingsBtn").addEventListener("click", openSettings);
    $("settingsCloseBtn").addEventListener("click", closeSettings);
    $("saveSettingsBtn").addEventListener("click", saveSettings);
    $("resetSettingsBtn").addEventListener("click", resetSettings);
    $("strokeColorInput").addEventListener("input", () => {
      settings.strokeColor = $("strokeColorInput").value;
      saveJSON(LS_SETTINGS, settings);
    });

    $("textEditor").addEventListener("blur", commitText);

    $("exportBtn").addEventListener("click", exportPng);
    $("exportJsonBtn").addEventListener("click", exportJson);
    $("importJsonBtn").addEventListener("click", () => $("importFile").click());
    $("importFile").addEventListener("change", (e) => { if (e.target.files[0]) importJson(e.target.files[0]); e.target.value = ""; });

    document.querySelectorAll(".tab").forEach((tab) => tab.addEventListener("click", () => {
      document.querySelectorAll(".tab").forEach((t) => t.classList.toggle("active", t === tab));
      document.querySelectorAll(".tab-panel").forEach((p) => p.classList.toggle("active", p.dataset.panel === tab.dataset.tab));
    }));
    document.querySelectorAll("#modeSeg .seg-btn").forEach((b) => b.addEventListener("click", () => {
      settings.mode = b.dataset.mode; applyTheme(); syncControls(); markDirty();
    }));
    document.querySelectorAll("#bgSeg .seg-btn").forEach((b) => b.addEventListener("click", () => {
      settings.canvasBg = b.dataset.bg; syncControls(); markDirty(); scheduleDraw();
    }));
    $("accentInput").addEventListener("input", () => { settings.accent = $("accentInput").value; applyTheme(); markDirty(); });
    $("accentResetBtn").addEventListener("click", () => { settings.accent = ""; applyTheme(); syncControls(); markDirty(); });
    $("strokeColorSetting").addEventListener("input", () => { settings.strokeColor = $("strokeColorSetting").value; markDirty(); });
    $("fontSizeInput").addEventListener("input", () => {
      settings.fontSize = Number($("fontSizeInput").value);
      $("fontSizeVal").textContent = settings.fontSize + "px";
      markDirty();
    });
    $("strokeWidthInput").addEventListener("input", () => {
      settings.strokeWidth = Number($("strokeWidthInput").value);
      $("strokeWidthVal").textContent = settings.strokeWidth;
      markDirty();
    });
    $("gridCheck").addEventListener("change", () => { settings.showGrid = $("gridCheck").checked; scheduleDraw(); markDirty(); });
    $("snapCheck").addEventListener("change", () => { settings.snap = $("snapCheck").checked; markDirty(); });

    cv.addEventListener("pointerdown", onPointerDown);
    cv.addEventListener("pointermove", onPointerMove);
    cv.addEventListener("pointerup", onPointerUp);
    cv.addEventListener("pointercancel", onPointerUp);
    cv.addEventListener("wheel", (e) => { e.preventDefault(); const r = cv.getBoundingClientRect(); zoomAt(e.clientX - r.left, e.clientY - r.top, e.deltaY < 0 ? 1.1 : 1 / 1.1); }, { passive: false });
    cv.addEventListener("dblclick", (e) => { const sc = toScene(canvasPos(e).x, canvasPos(e).y); const hit = hitTest(sc); if (hit) startTextEdit(hit); });
    cv.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("resize", resizeCanvas);
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    setTool("select");
    resizeCanvas();
    if (!savedCanvas) needsInitialFit = true;
    updateZoomLabel();
    scheduleDraw();
    tryInitialFit();
  }

  let needsInitialFit = false;
  let fitAttempts = 0;
  let fitW = 0, fitH = 0, fitScheduled = false;
  function tryInitialFit() {
    if (!needsInitialFit) return;
    const w = cv.width / dpr, h = cv.height / dpr;
    if (w < 240 || h < 180) {
      if (fitAttempts++ < 80) setTimeout(tryInitialFit, 80);
      else needsInitialFit = false;
      return;
    }
    const changed = Math.abs(w - fitW) > 4 || Math.abs(h - fitH) > 4;
    if (changed && !fitScheduled) {
      fitW = w; fitH = h; fitScheduled = true;
      requestAnimationFrame(() => { fitView(); fitScheduled = false; setTimeout(tryInitialFit, 200); });
    } else if (!changed && !fitScheduled) {
      needsInitialFit = false;
      fitAttempts = 0;
    } else {
      setTimeout(tryInitialFit, 200);
    }
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init);
  else init();

  window.diagramIt = {
    get elements() { return elements; },
    get view() { return view; },
    get tool() { return tool; },
    get selected() { return [...selectedIds]; },
    setTool, undo, redo, fitView, zoomBy,
  };
})();
