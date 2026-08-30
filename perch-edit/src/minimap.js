import { bus } from "./store.js";

let view = null;
let wrap = null;
let canvas = null;
let raf = null;
let dragging = false;
let scale = 2;
let colors = { bg: "#252526", base: "#6e6e6e", accent: "#007acc" };

export function initMinimap(viewRef) {
  view = viewRef;
  const host = view.dom.parentElement;
  wrap = document.createElement("div");
  wrap.className = "minimap";
  canvas = document.createElement("canvas");
  wrap.appendChild(canvas);
  host.appendChild(wrap);
  const sd = view.scrollDOM;
  sd.addEventListener("scroll", schedule);
  wrap.addEventListener("mousedown", onDown);
  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
  bus.on("docchange", schedule);
  bus.on("open", schedule);
  schedule();
}

export function setMinimapVisible(v) {
  if (!wrap) return;
  wrap.hidden = !v;
  const host = wrap.parentElement;
  if (host) host.classList.toggle("has-minimap", !!v);
}

function schedule() {
  if (raf) return;
  raf = requestAnimationFrame(() => {
    raf = null;
    render();
  });
}

function pickColor() {
  const cs = getComputedStyle(document.documentElement);
  colors.bg = cs.getPropertyValue("--bg2").trim() || "#252526";
  colors.base = cs.getPropertyValue("--fg-dim").trim() || "#6e6e6e";
  colors.accent = cs.getPropertyValue("--accent").trim() || "#007acc";
}

function rgba(hex, alpha) {
  const h = String(hex).replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  if (isNaN(n)) return "rgba(128,128,128," + alpha + ")";
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}

function yToScrollTop(y) {
  const h = canvas.clientHeight || 1;
  const sd = view.scrollDOM;
  const maxScroll = sd.scrollHeight - sd.clientHeight;
  if (maxScroll <= 0) return 0;
  return Math.max(0, Math.min(1, y / h)) * maxScroll;
}

function onDown(e) {
  if (!view) return;
  dragging = true;
  view.scrollDOM.scrollTop = yToScrollTop(e.clientY - canvas.getBoundingClientRect().top);
  e.preventDefault();
}

function onMove(e) {
  if (!dragging) return;
  view.scrollDOM.scrollTop = yToScrollTop(e.clientY - canvas.getBoundingClientRect().top);
}

function onUp() {
  dragging = false;
}

function render() {
  if (!view || !canvas || !wrap || wrap.hidden) return;
  const doc = view.state.doc;
  const lines = doc.lines;
  const hostW = wrap.clientWidth;
  const hostH = wrap.clientHeight;
  if (!hostW || !hostH) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.max(1, Math.round(hostW * dpr));
  canvas.height = Math.max(1, Math.round(hostH * dpr));
  canvas.style.width = hostW + "px";
  canvas.style.height = hostH + "px";
  const ctx = canvas.getContext("2d");
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  pickColor();
  ctx.fillStyle = colors.bg;
  ctx.fillRect(0, 0, hostW, hostH);
  if (lines === 0) return;
  scale = lines * 2 <= hostH ? 2 : Math.max(0.5, hostH / lines);
  let lastLine = -1;
  let lastAlpha = 0;
  const pxH = Math.round(hostH);
  for (let y = 0; y < pxH; y++) {
    const line = Math.min(lines - 1, Math.floor(y / scale));
    if (line !== lastLine) {
      lastLine = line;
      const t = doc.line(line + 1).text.trim();
      if (!t) lastAlpha = 0;
      else lastAlpha = Math.min(0.85, 0.22 + t.replace(/\s/g, "").length * 0.012);
    }
    if (lastAlpha > 0) {
      ctx.fillStyle = rgba(colors.base, lastAlpha);
      ctx.fillRect(0, y, hostW, 1);
    }
  }
  const head = view.state.selection.main.head;
  const cLine = doc.lineAt(Math.min(Math.max(0, head), doc.length)).number;
  const cy = Math.floor((cLine - 1) * scale);
  ctx.fillStyle = colors.accent;
  ctx.fillRect(0, cy, 2, Math.max(1, scale));
  const sd = view.scrollDOM;
  if (sd.scrollHeight > sd.clientHeight) {
    const total = lines * scale;
    const topFrac = sd.scrollTop / (sd.scrollHeight - sd.clientHeight);
    const vpFrac = sd.clientHeight / sd.scrollHeight;
    const vTop = Math.max(0, topFrac * total);
    const vH = Math.max(8, vpFrac * total);
    ctx.fillStyle = "rgba(255,255,255,0.09)";
    ctx.fillRect(0, vTop, hostW, vH);
    ctx.strokeStyle = "rgba(255,255,255,0.4)";
    ctx.strokeRect(0.5, vTop + 0.5, hostW - 1, vH - 1);
  }
}
