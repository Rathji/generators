import React, { useState, useMemo, useCallback } from "react";
import { createRoot } from "react-dom/client";

/* Inline lucide-style icons (lucide-react pulls in the entire icon set when
   bundled, so these four are hand-written instead — same paths, same API). */
function Icon({ children, size = 24, strokeWidth = 2 }) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const DownloadIcon = (p) => <Icon {...p}><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></Icon>;
const LayersIcon = (p) => <Icon {...p}><polygon points="12 2 2 7 12 12 22 7 12 2"/><polyline points="2 17 12 22 22 17"/><polyline points="2 12 12 17 22 12"/></Icon>;
const ImageIcon = (p) => <Icon {...p}><rect x="3" y="3" width="18" height="18" rx="2" ry="2"/><circle cx="8.5" cy="8.5" r="1.5"/><polyline points="21 15 16 10 5 21"/></Icon>;
const FrameIcon = (p) => <Icon {...p}><line x1="22" y1="6" x2="22" y2="18"/><line x1="6" y1="22" x2="18" y2="22"/><line x1="2" y1="6" x2="2" y2="18"/><line x1="6" y1="2" x2="18" y2="2"/></Icon>;

/* ────────────────────────────────────────────────────────────
   Colour helpers — a full acrylic palette derived from one hex
   ──────────────────────────────────────────────────────────── */

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  const v = h.length === 3 ? h.split("").map((c) => c + c).join("") : h;
  return [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16));
}
function rgbToHsl([r, g, b]) {
  r /= 255; g /= 255; b /= 255;
  const max = Math.max(r, g, b), min = Math.min(r, g, b);
  let h = 0, s = 0;
  const l = (max + min) / 2;
  const d = max - min;
  if (d) {
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0));
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    h *= 60;
  }
  return [h, s * 100, l * 100];
}
function hslToHex(h, s, l) {
  s /= 100; l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  const to = (x) => Math.round(255 * x).toString(16).padStart(2, "0");
  return `#${to(f(0))}${to(f(8))}${to(f(4))}`;
}
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function buildPalette(baseHex) {
  const [h, s, l] = rgbToHsl(hexToRgb(baseHex));
  const [r, g, b] = hexToRgb(baseHex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return {
    mid: baseHex,
    lit: hslToHex(h, clamp(s - 4, 0, 100), clamp(l + 24, 0, 96)),
    core: hslToHex(h, clamp(s + 4, 0, 100), clamp(l - 14, 3, 100)),
    deep: hslToHex(h, clamp(s + 8, 0, 100), clamp(l - 34, 2, 100)),
    mark: lum > 0.62 ? "#1c1c1e" : "#ffffff",
    markShade: lum > 0.62 ? "#ffffff" : "#000000",
    light: lum > 0.62,
  };
}

/* ────────────────────────────────────────────────────────────
   Face geometry — one authoring space of 1024, always square,
   always dead-on. Nothing here introduces perspective.
   ──────────────────────────────────────────────────────────── */

const S = 1024, CX = 512, CY = 512;

const SHAPES = {
  square: { label: "Square", radius: 36 },
  triangle: { label: "Triangle", radius: 30 },
  kite: { label: "Kite", radius: 26 },
  pentagon: { label: "Pentagon", radius: 30 },
  barrel: { label: "Barrel", radius: 44 },
  circle: { label: "Disc", radius: 0 },
};

// What each die is actually shaped like in the wild.
function autoShape(n) {
  if (n === 2) return "circle";
  if (n === 3 || n === 6) return "square";
  if (n === 4 || n === 8 || n === 20) return "triangle";
  if (n === 12) return "pentagon";
  if ([10, 14, 16, 18].includes(n)) return "kite";
  return "barrel"; // 5, 7, 9, 11, 13, 15, 17, 19 — spindle dice
}

function vertices(shape) {
  const poly = (count, R, rot = -90) =>
    Array.from({ length: count }, (_, i) => {
      const a = ((rot + (360 / count) * i) * Math.PI) / 180;
      return [CX + R * Math.cos(a), CY + R * Math.sin(a)];
    });
  switch (shape) {
    case "square": return poly(4, 452, -45);
    case "triangle": return poly(3, 386);
    case "pentagon": return poly(5, 356);
    case "kite": return [[CX, 176], [CX + 276, 438], [CX, 848], [CX - 276, 438]];
    case "barrel": {
      const w = 336, h = 232;
      return [[CX - w, CY - h], [CX + w, CY - h], [CX + w, CY + h], [CX - w, CY + h]];
    }
    default: return null; // circle
  }
}

const CIRCLE_R = 336;

function facePath(shape) {
  if (shape === "circle") {
    return `M ${CX - CIRCLE_R} ${CY} A ${CIRCLE_R} ${CIRCLE_R} 0 1 0 ${CX + CIRCLE_R} ${CY} A ${CIRCLE_R} ${CIRCLE_R} 0 1 0 ${CX - CIRCLE_R} ${CY} Z`;
  }
  const pts = vertices(shape);
  const r = SHAPES[shape].radius;
  const n = pts.length;
  let d = "";
  for (let i = 0; i < n; i++) {
    const prev = pts[(i - 1 + n) % n], cur = pts[i], next = pts[(i + 1) % n];
    const v1 = [prev[0] - cur[0], prev[1] - cur[1]];
    const v2 = [next[0] - cur[0], next[1] - cur[1]];
    const l1 = Math.hypot(...v1), l2 = Math.hypot(...v2);
    const rr = Math.min(r, l1 / 2.2, l2 / 2.2);
    const a = [cur[0] + (v1[0] / l1) * rr, cur[1] + (v1[1] / l1) * rr];
    const b = [cur[0] + (v2[0] / l2) * rr, cur[1] + (v2[1] / l2) * rr];
    d += i === 0 ? `M ${a[0].toFixed(1)} ${a[1].toFixed(1)} ` : `L ${a[0].toFixed(1)} ${a[1].toFixed(1)} `;
    d += `Q ${cur[0].toFixed(1)} ${cur[1].toFixed(1)} ${b[0].toFixed(1)} ${b[1].toFixed(1)} `;
  }
  return d + "Z";
}

function bounds(shape) {
  if (shape === "circle") {
    return { x0: CX - CIRCLE_R, x1: CX + CIRCLE_R, y0: CY - CIRCLE_R, y1: CY + CIRCLE_R };
  }
  const pts = vertices(shape);
  return {
    x0: Math.min(...pts.map((p) => p[0])), x1: Math.max(...pts.map((p) => p[0])),
    y0: Math.min(...pts.map((p) => p[1])), y1: Math.max(...pts.map((p) => p[1])),
  };
}

// Tight-crop rect — the bounding box of the face shape, rounded out to the
// path's 0.1-unit precision so nothing clips. A tight build sets its viewBox
// to this rect, making the face flush with the canvas edges.
function tightView(shape) {
  const bb = bounds(shape);
  const x0 = Math.floor(bb.x0 * 10) / 10, y0 = Math.floor(bb.y0 * 10) / 10;
  const x1 = Math.ceil(bb.x1 * 10) / 10, y1 = Math.ceil(bb.y1 * 10) / 10;
  return { x0, y0, w: x1 - x0, h: y1 - y0 };
}

// Pixel dimensions for a tight export: longest side = `size`, other side
// follows the shape's aspect (a triangle is wider than tall, a kite taller).
function tightDim(shape, size) {
  const tv = tightView(shape);
  const m = Math.max(tv.w, tv.h);
  const s = size / m;
  return { w: Math.max(1, Math.round(tv.w * s)), h: Math.max(1, Math.round(tv.h * s)) };
}

// Numerals need to sit at the optical centre, which is not the
// bounding-box centre on triangles, kites or pentagons.
const MARK_OFFSET = { triangle: 46, pentagon: 22, kite: 8, square: 0, barrel: 0, circle: 0 };
const MARK_SIZE = { square: 320, triangle: 250, pentagon: 290, kite: 268, barrel: 300, circle: 340 };

/* Pip lattice, d6 convention */
const CELLS = { TL: [0, 0], TC: [1, 0], TR: [2, 0], ML: [0, 1], MC: [1, 1], MR: [2, 1], BL: [0, 2], BC: [1, 2], BR: [2, 2] };
const PIP_FACES = {
  1: ["MC"], 2: ["TL", "BR"], 3: ["TL", "MC", "BR"],
  4: ["TL", "TR", "BL", "BR"], 5: ["TL", "TR", "MC", "BL", "BR"],
  6: ["TL", "ML", "BL", "TR", "MR", "BR"],
};

/* ────────────────────────────────────────────────────────────
   SVG builder — the preview and the export are the same string.
   Exported (tight) builds drop the studio backdrop/shadow and crop
   the viewBox flush to the face, so the face fills the canvas
   edge-to-edge and can be mapped straight onto a 3D die.
   ──────────────────────────────────────────────────────────── */

function buildFace({ value, shape, palette: c, marking, underline69, transparent, tight, uid, size = S }) {
  const path = facePath(shape);
  const bb = bounds(shape);
  const span = bb.x1 - bb.x0;
  const tall = bb.y1 - bb.y0;
  const id = (k) => `${k}-${uid}`;
  const tv = tight ? tightView(shape) : null;
  const viewBox = tv ? `${tv.x0} ${tv.y0} ${tv.w} ${tv.h}` : `0 0 ${S} ${S}`;
  const dim = tv ? tightDim(shape, size) : { w: size, h: size };

  // `transparent` means real see-through acrylic, not just a transparent
  // canvas: the body/core fills get real alpha instead of the implicit 1,
  // on top of dropping the studio backdrop below. No filter primitives
  // either way, so this stays identical across renderers.
  const bodyFillOpacity = transparent ? 0.55 : 1;
  const corePeakOpacity = transparent ? 0.5 : 0.92;

  let marks = "";
  if (marking === "pips" && shape === "square" && value <= 6) {
    const gx = [CX - 168, CX, CX + 168], gy = [CY - 168, CY, CY + 168];
    const R = 58;
    marks = PIP_FACES[value].map((k) => {
      const [i, j] = CELLS[k];
      return `<circle cx="${gx[i]}" cy="${gy[j] + 4}" r="${R + 3}" fill="${c.markShade}" opacity="0.22"/>` +
             `<circle cx="${gx[i]}" cy="${gy[j]}" r="${R}" fill="url(#${id("pip")})"/>`;
    }).join("");
  } else {
    const digits = String(value).length;
    const fs = MARK_SIZE[shape] * (digits > 1 ? 0.74 : 1);
    const my = CY + MARK_OFFSET[shape];
    const face = `font-family="Helvetica Neue, Helvetica, Arial, sans-serif" font-weight="700" font-size="${fs}" text-anchor="middle" dominant-baseline="central"`;
    const rule = (value === 6 || value === 9) && underline69
      ? `<rect x="${CX - fs * 0.3}" y="${my + fs * 0.44}" width="${fs * 0.6}" height="${fs * 0.075}" rx="${fs * 0.037}" fill="${c.mark}"/>`
      : "";
    marks =
      `<text x="${CX}" y="${my + 5}" ${face} fill="${c.markShade}" opacity="0.24">${value}</text>` +
      `<text x="${CX}" y="${my}" ${face} fill="${c.mark}">${value}</text>` + rule;
  }

  const ghost = marking === "pips" && shape === "square" && value <= 6
    ? PIP_FACES[7 - value].map((k) => {
        const [i, j] = CELLS[k];
        return `<circle cx="${[CX - 168, CX, CX + 168][i]}" cy="${[CY - 168, CY, CY + 168][j] + 26}" r="64" fill="url(#${id("ghost")})"/>`;
      }).join("")
    : "";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${dim.w}" height="${dim.h}" viewBox="${viewBox}">
<defs>
  <radialGradient id="${id("bg")}" cx="50%" cy="38%" r="78%">
    <stop offset="0%" stop-color="#48484c"/><stop offset="60%" stop-color="#38383b"/><stop offset="100%" stop-color="#252527"/>
  </radialGradient>
  <linearGradient id="${id("body")}" x1="0" y1="0" x2="0.2" y2="1">
    <stop offset="0%" stop-color="${c.lit}"/><stop offset="55%" stop-color="${c.mid}"/><stop offset="100%" stop-color="${c.mid}"/>
  </linearGradient>
  <radialGradient id="${id("core")}" cx="50%" cy="52%" r="60%">
    <stop offset="0%" stop-color="${c.deep}" stop-opacity="${corePeakOpacity}"/>
    <stop offset="55%" stop-color="${c.core}" stop-opacity="${(corePeakOpacity * 0.67).toFixed(3)}"/>
    <stop offset="100%" stop-color="${c.core}" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="${id("sheen")}" cx="26%" cy="20%" r="62%">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.16"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="${id("gloss")}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#ffffff" stop-opacity="0.22"/><stop offset="100%" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="${id("foot")}" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#000000" stop-opacity="0"/><stop offset="100%" stop-color="#000000" stop-opacity="0.34"/>
  </linearGradient>
  <radialGradient id="${id("pip")}" cx="36%" cy="32%" r="72%">
    <stop offset="0%" stop-color="${c.light ? "#2a2a2c" : "#ffffff"}"/>
    <stop offset="70%" stop-color="${c.light ? "#1c1c1e" : "#f4f4f2"}"/>
    <stop offset="100%" stop-color="${c.light ? "#0e0e10" : "#d8d8d4"}"/>
  </radialGradient>
  <radialGradient id="${id("ghost")}" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#000000" stop-opacity="0.20"/>
    <stop offset="62%" stop-color="#000000" stop-opacity="0.11"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="${id("shadow")}" cx="50%" cy="50%" r="50%">
    <stop offset="0%" stop-color="#000000" stop-opacity="0.55"/>
    <stop offset="55%" stop-color="#000000" stop-opacity="0.24"/>
    <stop offset="100%" stop-color="#000000" stop-opacity="0"/>
  </radialGradient>
  <clipPath id="${id("clip")}"><path d="${path}"/></clipPath>
</defs>
${transparent || tight ? "" : `<rect width="${S}" height="${S}" fill="url(#${id("bg")})"/>`}
${transparent || tight ? "" : `<ellipse cx="${CX}" cy="${bb.y1 + 34}" rx="${span * 0.52}" ry="52" fill="url(#${id("shadow")})"/>`}
<g clip-path="url(#${id("clip")})" fill-opacity="${bodyFillOpacity}">
  <rect x="${bb.x0}" y="${bb.y0}" width="${span}" height="${tall}" fill="url(#${id("body")})"/>
  <rect x="${bb.x0}" y="${bb.y0}" width="${span}" height="${tall}" fill="url(#${id("core")})"/>
  ${ghost}
  <rect x="${bb.x0}" y="${bb.y0}" width="${span}" height="${tall}" fill="url(#${id("sheen")})"/>
  <rect x="${bb.x0}" y="${bb.y1 - tall * 0.34}" width="${span}" height="${tall * 0.34}" fill="url(#${id("foot")})"/>
  <rect x="${bb.x0}" y="${bb.y0}" width="${span}" height="${tall * 0.17}" fill="url(#${id("gloss")})"/>
</g>
<path d="${path}" fill="none" stroke="#ffffff" stroke-opacity="0.42" stroke-width="4"/>
<path d="${path}" fill="none" stroke="#000000" stroke-opacity="0.16" stroke-width="2"/>
${marks}
</svg>`;
}

function buildSheet({ sides, shape, palette, marking, underline69, transparent, cell = 512 }) {
  const cols = Math.ceil(Math.sqrt(sides));
  const rows = Math.ceil(sides / cols);
  const cells = Array.from({ length: sides }, (_, i) => {
    const inner = buildFace({ value: i + 1, shape, palette, marking, underline69, transparent, uid: `s${i}` })
      .replace(/^<svg[^>]*>/, "").replace(/<\/svg>$/, "");
    const x = (i % cols) * cell, y = Math.floor(i / cols) * cell;
    return `<g transform="translate(${x},${y}) scale(${cell / S})">${inner}</g>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${cols * cell}" height="${rows * cell}" viewBox="0 0 ${cols * cell} ${rows * cell}">${cells}</svg>`;
}

/* ────────────────────────────────────────────────────────────
   Download plumbing
   ──────────────────────────────────────────────────────────── */

function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const svgDataUrl = (svg) =>
  "data:image/svg+xml;base64," + btoa(unescape(encodeURIComponent(svg)));

function rasterize(svg, w, h) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement("canvas");
      canvas.width = w; canvas.height = h;
      const ctx = canvas.getContext("2d");
      ctx.drawImage(img, 0, 0, w, h);
      canvas.toBlob((b) => (b ? resolve(b) : reject(new Error("encode failed"))), "image/png");
    };
    img.onerror = () => reject(new Error("render failed"));
    img.src = svgDataUrl(svg);
  });
}

/* ────────────────────────────────────────────────────────────
   UI
   ──────────────────────────────────────────────────────────── */

const PRESETS = [
  { name: "Casino red", hex: "#c40027" },
  { name: "Cobalt", hex: "#1546d8" },
  { name: "Jade", hex: "#0d8a55" },
  { name: "Amethyst", hex: "#6b2fb5" },
  { name: "Amber", hex: "#d98a00" },
  { name: "Onyx", hex: "#2b2b30" },
  { name: "Ivory", hex: "#e8e2d4" },
  { name: "Bone", hex: "#c9c2ae" },
];

const MONO = { fontFamily: "ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" };

function Label({ children, hint }) {
  return (
    <div className="flex items-baseline justify-between mb-2">
      <span style={MONO} className="text-[10px] uppercase tracking-[0.18em] text-neutral-500">{children}</span>
      {hint && <span style={MONO} className="text-[10px] text-neutral-600">{hint}</span>}
    </div>
  );
}

function Chip({ active, disabled, onClick, children, title }) {
  return (
    <button
      type="button" onClick={onClick} disabled={disabled} title={title} aria-pressed={active}
      style={MONO}
      className={`px-2.5 py-1.5 text-[11px] rounded-sm border transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 ${
        disabled
          ? "border-neutral-800 text-neutral-700 cursor-not-allowed"
          : active
          ? "border-amber-500/70 bg-amber-500/10 text-amber-300"
          : "border-neutral-800 text-neutral-400 hover:border-neutral-600 hover:text-neutral-200"
      }`}
    >
      {children}
    </button>
  );
}

function DieFaceGenerator() {
  const [sides, setSides] = useState(6);
  const [shapeMode, setShapeMode] = useState("auto");
  const [base, setBase] = useState("#c40027");
  const [marking, setMarking] = useState("pips");
  const [underline69, setUnderline69] = useState(true);
  const [transparent, setTransparent] = useState(false);
  const [exportSize, setExportSize] = useState(1024);
  const [face, setFace] = useState(1);
  const [guides, setGuides] = useState(true);
  const [busy, setBusy] = useState("");

  const shape = shapeMode === "auto" ? autoShape(sides) : shapeMode;
  const palette = useMemo(() => buildPalette(base), [base]);
  const pipsPossible = shape === "square" && sides <= 6;
  const mode = pipsPossible && marking === "pips" ? "pips" : "numerals";

  const changeSides = (n) => {
    setSides(n);
    setFace((f) => Math.min(f, n));
    const s = shapeMode === "auto" ? autoShape(n) : shapeMode;
    if (!(s === "square" && n <= 6)) setMarking("numerals");
    else setMarking("pips");
  };

  const cfg = { shape, palette, marking: mode, underline69, transparent };
  const hero = useMemo(
    () => buildFace({ ...cfg, value: face, uid: "hero" }),
    [face, shape, base, mode, underline69, transparent] // eslint-disable-line
  );

  const download = useCallback(async (kind) => {
    setBusy(kind);
    try {
      const stem = `d${sides}-${shape}-${base.replace("#", "")}`;
      if (kind === "svg") {
        saveBlob(new Blob([buildFace({ ...cfg, value: face, uid: "x", tight: true })], { type: "image/svg+xml" }), `${stem}-face-${face}.svg`);
      } else if (kind === "png") {
        const { w, h } = tightDim(shape, exportSize);
        const b = await rasterize(buildFace({ ...cfg, value: face, uid: "x", tight: true }), w, h);
        saveBlob(b, `${stem}-face-${face}.png`);
      } else if (kind === "sheet") {
        const svg = buildSheet({ ...cfg, sides });
        const cols = Math.ceil(Math.sqrt(sides)), rows = Math.ceil(sides / cols);
        const b = await rasterize(svg, cols * exportSize, rows * exportSize);
        saveBlob(b, `${stem}-contact-sheet.png`);
      } else if (kind === "all") {
        const { w, h } = tightDim(shape, exportSize);
        for (let v = 1; v <= sides; v++) {
          const b = await rasterize(buildFace({ ...cfg, value: v, uid: `x${v}`, tight: true }), w, h);
          saveBlob(b, `${stem}-face-${String(v).padStart(2, "0")}.png`);
          await new Promise((r) => setTimeout(r, 260));
        }
      }
    } catch {
      setBusy("error");
      setTimeout(() => setBusy(""), 2600);
      return;
    }
    setBusy("");
  }, [sides, shape, base, face, exportSize, mode, underline69, transparent]); // eslint-disable-line

  return (
    <div className="w-full text-neutral-200">
      <div className="max-w-[1180px] mx-auto px-5 py-6">

        <div className="grid gap-7 lg:grid-cols-[300px_1fr]">

          {/* Controls */}
          <div className="space-y-6">
            <section>
              <Label hint={`${shape}`}>Sides</Label>
              <div className="grid grid-cols-6 gap-1.5">
                {[4, 6, 8, 10, 12, 20].map((n) => (
                  <Chip key={n} active={n === sides} onClick={() => changeSides(n)}>d{n}</Chip>
                ))}
              </div>
            </section>

            <section>
              <Label hint={shapeMode === "auto" ? "matched to die" : "manual"}>Face shape</Label>
              <div className="flex flex-wrap gap-1.5">
                <Chip active={shapeMode === "auto"} onClick={() => setShapeMode("auto")}>Auto</Chip>
                {Object.entries(SHAPES).map(([k, v]) => (
                  <Chip key={k} active={shapeMode === k} onClick={() => setShapeMode(k)}>{v.label}</Chip>
                ))}
              </div>
            </section>

            <section>
              <Label>Body colour</Label>
              <div className="grid grid-cols-8 gap-1.5 mb-2.5">
                {PRESETS.map((p) => (
                  <button
                    key={p.hex} type="button" title={p.name} onClick={() => setBase(p.hex)}
                    aria-label={p.name} aria-pressed={base === p.hex}
                    className={`aspect-square rounded-sm border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 ${
                      base === p.hex ? "border-amber-400 scale-110" : "border-neutral-700 hover:border-neutral-500"
                    }`}
                    style={{ background: p.hex }}
                  />
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="color" value={base} onChange={(e) => setBase(e.target.value)}
                  aria-label="Custom colour"
                  className="h-8 w-9 bg-transparent border border-neutral-800 rounded-sm cursor-pointer"
                />
                <input
                  type="text" value={base} onChange={(e) => /^#[0-9a-fA-F]{0,6}$/.test(e.target.value) && setBase(e.target.value)}
                  style={MONO} aria-label="Hex value"
                  className="flex-1 h-8 px-2 text-[11px] bg-neutral-900 border border-neutral-800 rounded-sm text-neutral-300 focus:outline-none focus:border-amber-500/60"
                />
              </div>
            </section>

            <section>
              <Label hint={pipsPossible ? null : "pips need a square d6 or lower"}>Markings</Label>
              <div className="flex gap-1.5">
                <Chip active={mode === "pips"} disabled={!pipsPossible} onClick={() => setMarking("pips")}>Pips</Chip>
                <Chip active={mode === "numerals"} onClick={() => setMarking("numerals")}>Numerals</Chip>
              </div>
              <label className="flex items-center gap-2 mt-3 cursor-pointer select-none">
                <input
                  type="checkbox" checked={underline69} onChange={(e) => setUnderline69(e.target.checked)}
                  className="accent-amber-500 h-3.5 w-3.5"
                />
                <span style={MONO} className="text-[11px] text-neutral-400">Underline 6 and 9</span>
              </label>
            </section>

            <section>
              <Label>Export</Label>
              <div className="flex gap-1.5 mb-2.5">
                {[512, 1024, 2048].map((s) => (
                  <Chip key={s} active={exportSize === s} onClick={() => setExportSize(s)}>{s}px</Chip>
                ))}
              </div>
              <label className="flex items-center gap-2 mb-1.5 cursor-pointer select-none">
                <input type="checkbox" checked={transparent} onChange={(e) => setTransparent(e.target.checked)} className="accent-amber-500 h-3.5 w-3.5" />
                <span style={MONO} className="text-[11px] text-neutral-400">Clear acrylic (translucent body)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={guides} onChange={(e) => setGuides(e.target.checked)} className="accent-amber-500 h-3.5 w-3.5" />
                <span style={MONO} className="text-[11px] text-neutral-400">Alignment frame <span className="text-neutral-600">(preview only)</span></span>
              </label>
            </section>
          </div>

          {/* Stage */}
          <div className="space-y-5">
            <div className="relative bg-[#120f1f] border border-neutral-800 rounded-xl p-8 flex items-center justify-center">
              <div className="relative w-full max-w-[440px] aspect-square">
                <div
                  className="w-full h-full [&>svg]:w-full [&>svg]:h-full"
                  style={transparent ? {
                    backgroundImage:
                      "linear-gradient(45deg,#241f38 25%,transparent 25%),linear-gradient(-45deg,#241f38 25%,transparent 25%),linear-gradient(45deg,transparent 75%,#241f38 75%),linear-gradient(-45deg,transparent 75%,#241f38 75%)",
                    backgroundSize: "22px 22px",
                    backgroundPosition: "0 0,0 11px,11px -11px,-11px 0",
                  } : undefined}
                  dangerouslySetInnerHTML={{ __html: hero }}
                />
                {guides && (
                  <svg className="absolute inset-0 w-full h-full pointer-events-none" viewBox="0 0 1024 1024" aria-hidden="true">
                    <g stroke="#c9a227" strokeOpacity="0.55" strokeWidth="1.5">
                      <line x1="512" y1="0" x2="512" y2="34" /><line x1="512" y1="990" x2="512" y2="1024" />
                      <line x1="0" y1="512" x2="34" y2="512" /><line x1="990" y1="512" x2="1024" y2="512" />
                    </g>
                    <g stroke="#c9a227" strokeOpacity="0.22" strokeWidth="1" strokeDasharray="6 10">
                      <line x1="512" y1="34" x2="512" y2="990" /><line x1="34" y1="512" x2="990" y2="512" />
                    </g>
                    <rect x="6" y="6" width="1012" height="1012" fill="none" stroke="#c9a227" strokeOpacity="0.18" strokeWidth="1.5" />
                  </svg>
                )}
              </div>
              <div style={MONO} className="absolute top-3 left-4 text-[10px] tracking-[0.16em] uppercase text-neutral-600">
                d{sides} · face {face} · {shape}
              </div>
            </div>

            {/* Face strip */}
            <div>
              <Label hint={`${sides} face${sides > 1 ? "s" : ""}`}>Set</Label>
              <div className="flex flex-wrap gap-2">
                {Array.from({ length: sides }, (_, i) => i + 1).map((v) => (
                  <button
                    key={v} type="button" onClick={() => setFace(v)} aria-label={`Face ${v}`} aria-pressed={v === face}
                    className={`w-[62px] h-[62px] rounded-sm overflow-hidden border transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70 ${
                      v === face ? "border-amber-500/80" : "border-neutral-800 hover:border-neutral-600 opacity-75 hover:opacity-100"
                    } [&>svg]:w-full [&>svg]:h-full`}
                    dangerouslySetInnerHTML={{
                      __html: buildFace({ ...cfg, value: v, transparent: false, uid: `t${v}`, size: 62 }),
                    }}
                  />
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex flex-wrap gap-2 pt-1">
              {[
                { k: "png", icon: ImageIcon, text: `Face ${face} PNG` },
                { k: "svg", icon: FrameIcon, text: `Face ${face} SVG` },
                { k: "all", icon: DownloadIcon, text: `All ${sides} PNGs` },
                { k: "sheet", icon: LayersIcon, text: "Contact sheet" },
              ].map(({ k, icon: Icon, text }) => (
                <button
                  key={k} type="button" onClick={() => download(k)} disabled={!!busy}
                  style={MONO}
                  className="flex items-center gap-2 px-3.5 py-2 text-[11px] rounded-sm border border-neutral-700 text-neutral-300 hover:border-amber-500/70 hover:text-amber-300 disabled:opacity-40 disabled:hover:border-neutral-700 disabled:hover:text-neutral-300 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-500/70"
                >
                  <Icon size={13} strokeWidth={1.75} />
                  {busy === k ? "Working…" : text}
                </button>
              ))}
            </div>
            {busy === "error" && (
              <p style={MONO} className="text-[11px] text-red-400">
                PNG encoding was blocked by the browser. Download the SVG and convert it locally.
              </p>
            )}
            <p style={MONO} className="text-[10px] leading-relaxed text-neutral-600 pt-1">
              Face PNGs and SVGs are cropped flush to the die shape — no canvas margin — so they map
              straight onto a 3D die. Export size is the longest side; the other side follows the
              shape's aspect. The contact sheet keeps its margins for cutting.
            </p>
            <p style={MONO} className="text-[10px] leading-relaxed text-neutral-600 pt-1">
              Numerals render with the system sans at export time. For assets that must match
              across machines, take the SVG and convert its text to outlines.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default DieFaceGenerator;

/* ────────────────────────────────────────────────────────────
   Mount — bundle entry
   ──────────────────────────────────────────────────────────── */

const rootEl = document.getElementById("root");
if (rootEl) {
  createRoot(rootEl).render(<DieFaceGenerator />);
}
