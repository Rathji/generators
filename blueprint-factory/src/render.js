// render.js — themes + SVG rendering of a laid-out graph.
// One diagram = one <svg> "sheet": themed paper, grid, lanes, edges, node
// glyphs, labels, frame + title block. Export rasterizes the sheet to PNG.

import { makeMeasure } from "./layout.js";
import { nodeGlyphOps, textCenter, isStartEnd } from "./shapes.js";

export const TYPE_LABELS = {
  flowchart: "Flowchart", tree: "Hierarchy", mindmap: "Mind map",
  architecture: "Architecture", network: "Network", sequence: "Sequence",
};

// ----------------------------------------------------------------- themes

export const THEMES = [
  {
    id: "blueprint", name: "Blueprint", tagline: "white lines on blue",
    crisp: true, case: "upper", wrap: 210,
    lgx: 104, lgy: 42, lanePad: 26,
    ew: 1.5,
    paper: { colors: ["#163f66", "#0e2c4b"] },
    grid: { minor: "rgba(180,225,255,0.055)", major: "rgba(180,225,255,0.13)", step: 20, every: 5, crisp: true },
    edge: "#cdeaff", edgeText: "#d9edff",
    nodeStroke: "rgba(225,244,255,0.92)", nodeFill: "rgba(215,240,255,0.07)",
    text: "#ecf6ff", sub: "#9cc3e0", laneFill: "rgba(255,255,255,0.032)", laneStroke: "rgba(190,225,250,0.5)",
    chipFill: "#123b60", faint: "rgba(205,233,255,0.55)", accent: "#ffd98a",
    f: {
      main: { family: "Oswald", size: 14.5, weight: 500, spacingPx: 0.8 },
      sub: { family: "Oswald", size: 9.5, weight: 400, spacingPx: 0.5 },
      edge: { family: "Oswald", size: 10.5, weight: 400, spacingPx: 0.6 },
      block: { family: "Oswald", size: 9, weight: 400, spacingPx: 0.6 },
    },
  },
  {
    id: "graph", name: "Graph paper", tagline: "pencil on grid",
    crisp: true, case: null, wrap: 205,
    lgx: 100, lgy: 40, lanePad: 24,
    ew: 1.4,
    paper: { colors: ["#fffefb", "#f6f4ed"] },
    grid: { minor: "rgba(112,128,150,0.13)", major: "rgba(112,128,150,0.22)", step: 16, every: 5, crisp: true },
    edge: "#46536a", edgeText: "#46536a",
    nodeStroke: "#3f4c63", nodeFill: "#fffef9",
    text: "#28323f", sub: "#8b97a8", laneFill: "rgba(70,90,120,0.045)", laneStroke: "rgba(70,90,120,0.3)",
    chipFill: "#f4f1e7", faint: "rgba(60,75,100,0.5)", accent: "#c43d30",
    f: {
      main: { family: "Space Grotesk", size: 13.5, weight: 500, spacingPx: 0 },
      sub: { family: "Space Grotesk", size: 9.5, weight: 400, spacingPx: 0 },
      edge: { family: "Space Grotesk", size: 10, weight: 400, spacingPx: 0 },
      block: { family: "Space Grotesk", size: 9, weight: 500, spacingPx: 0.4 },
    },
  },
  {
    id: "hand", name: "Hand drawn", tagline: "pen & pencil sketch",
    crisp: false, case: null, wrap: 235, skew: 2.2,
    lgx: 118, lgy: 52, lanePad: 26,
    rough: { roughness: 1.55, bowing: 1.1, nodeW: 1.6, edgeW: 1.5 },
    paper: { colors: ["#fcf8ef", "#f6efe0"] },
    grid: null,
    edge: "#6a5f4d", edgeText: "#6a5f4d",
    nodeStroke: "#57503f", nodeFill: "#fffdf3",
    text: "#3a352b", sub: "#8d8474", laneFill: "rgba(120,105,80,0.05)", laneStroke: "rgba(120,105,80,0.4)",
    chipFill: "#fbf3e2", faint: "rgba(90,80,60,0.55)", accent: "#bd4a2f",
    f: {
      main: { family: "Caveat", size: 19.5, weight: 600, spacingPx: 0 },
      sub: { family: "Caveat", size: 13, weight: 500, spacingPx: 0 },
      edge: { family: "Caveat", size: 14, weight: 600, spacingPx: 0 },
      block: { family: "Caveat", size: 12.5, weight: 500, spacingPx: 0 },
    },
  },
  {
    id: "chalk", name: "Chalkboard", tagline: "chalk on slate",
    crisp: false, case: null, wrap: 215, skew: 0.6,
    lgx: 110, lgy: 46, lanePad: 26,
    rough: { roughness: 0.7, bowing: 0.5, nodeW: 3, edgeW: 2.6 },
    paper: { colors: ["#35523f", "#24362a"] },
    grid: { minor: "rgba(255,255,255,0.03)", major: "rgba(255,255,255,0.05)", step: 24, every: 5, crisp: true },
    edge: "rgba(244,242,230,0.85)", edgeText: "#efece0",
    nodeStroke: "rgba(246,244,232,0.9)", nodeFill: "rgba(255,255,255,0)",
    text: "#f6f3e5", sub: "#c4cdba", laneFill: "rgba(255,255,255,0.04)", laneStroke: "rgba(255,255,255,0.35)",
    chipFill: "#2f4636", faint: "rgba(240,240,225,0.5)", accent: "#edcf7a",
    f: {
      main: { family: "Shadows Into Light", size: 21, weight: 400, spacingPx: 0 },
      sub: { family: "Shadows Into Light", size: 13.5, weight: 400, spacingPx: 0 },
      edge: { family: "Shadows Into Light", size: 17, weight: 400, spacingPx: 0 },
      block: { family: "Shadows Into Light", size: 12, weight: 400, spacingPx: 0 },
    },
  },
];

export function themeById(id) {
  return THEMES.find((t) => t.id === id) || THEMES[0];
}

// ----------------------------------------------------------------- svg utils

const SVGNS = "http://www.w3.org/2000/svg";

export function el(tag, attrs, parent) {
  const e = document.createElementNS(SVGNS, tag);
  for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  if (parent) parent.appendChild(e);
  return e;
}

const FONT_CACHE = new Map();
let roughLib = null;
export async function ensureRough() {
  if (roughLib) return roughLib;
  try {
    const mod = await import("https://esm.sh/roughjs@4.6.6");
    roughLib = mod.default || mod;
  } catch (err) { console.warn("rough.js unavailable:", err); roughLib = null; }
  return roughLib;
}

// ----------------------------------------------------------------- geometry helpers

export const FRAME = 26;     // outer frame inset from paper edge
export const CONTENT_INSET = 30; // frame → content
export const TITLE_RESERVE = 180; // bottom space reserved for title block
const TB_W = 430, TB_H = 104;

function rectOuter(o) { return { x: o.FRAME, y: o.FRAME, w: o.W - o.FRAME * 2, h: o.H - o.FRAME * 2 }; }

// ----------------------------------------------------------------- drawing

export function drawDiagram(svg, graph, theme, opts) {
  svg.textContent = "";
  const measure = makeMeasure();
  const dateStr = opts.dateStr;

  // sheet metrics
  const seq = graph.type === "sequence";
  let cw, ch;
  if (seq) {
    cw = Math.max(0, graph._seqW || 600);
    ch = Math.max(0, graph._seqH || 320);
  } else {
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of graph.nodes) {
      minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + n._w); maxY = Math.max(maxY, n.y + n._h);
    }
    for (const e of graph.edges) {
      if (e.geom && e.label) {
        minY = Math.min(minY, e.geom.lbl.y - 34);
        maxY = Math.max(maxY, e.geom.lbl.y + 10);
      }
    }
    if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 200; maxY = 120; }
    cw = maxX - minX; ch = maxY - minY;
  }
  const X0 = FRAME + CONTENT_INSET;
  const W = Math.max(620, X0 + cw + X0);
  const H = Math.max(560, X0 + ch + TITLE_RESERVE);

  const o = { FRAME, W, H, X0, theme, measure };
  svg.setAttribute("viewBox", `0 0 ${W} ${H}`);
  svg.setAttribute("width", W);
  svg.setAttribute("height", H);
  const defs = el("defs", {}, svg);
  addPaperDefs(defs, theme, o);

  // paper
  el("rect", { x: 0, y: 0, width: W, height: H, fill: `url(#paper-${theme.id})` }, svg);
  if (theme.grid) {
    const gr = el("rect", { x: X0, y: X0, width: cw + (seq ? 0 : 40), height: ch, fill: `url(#grid-minor-${theme.id})` }, svg);
    if (theme.grid.major) el("rect", { x: X0, y: X0, width: cw + (seq ? 0 : 40), height: ch, fill: `url(#grid-major-${theme.id})` }, svg);
    void gr;
  }

  const content = el("g", { transform: `translate(${X0} ${X0})` }, svg);
  const ctx = { svg, content, theme, measure, rough: null, seq };
  ctx.rough = !theme.crisp && roughLib ? roughLib.svg(svg) : null;

  if (seq) drawSequence(ctx, graph);
  else {
    // lanes (architecture)
    for (const lane of graph._lanes || []) drawLane(ctx, lane);
    // edges
    for (const e of graph.edges) drawEdge(ctx, e);
    // nodes
    for (const n of graph.nodes) drawNode(ctx, n);
  }

  drawFrameAndBlock({ ...ctx, content: svg }, o, graph, theme, dateStr);
  return { W, H, cw, ch };
}

function addPaperDefs(defs, theme, o) {
  const g = el("linearGradient", { id: `paper-${theme.id}`, x1: 0, y1: 0, x2: 0, y2: 1 }, defs);
  el("stop", { offset: "0%", "stop-color": theme.paper.colors[0] }, g);
  el("stop", { offset: "100%", "stop-color": theme.paper.colors[1] }, g);
  if (theme.grid && theme.grid.crisp) {
    const s = theme.grid.step;
    const mk = (id, color) => {
      const p = el("pattern", { id: `grid-${id}-${theme.id}`, width: s * (id === "major" ? theme.grid.every : 1), height: s * (id === "major" ? theme.grid.every : 1), patternUnits: "userSpaceOnUse" }, defs);
      const w = s * (id === "major" ? theme.grid.every : 1);
      const path = el("path", { d: `M ${s} 0 V ${w} M 0 ${s} H ${w}`, stroke: color, "stroke-width": id === "major" ? 1.1 : 0.7 }, p);
      void path;
    };
    mk("minor", theme.grid.minor);
    mk("major", theme.grid.major);
  } else if (theme.grid) {
    // non-crisp grid: single faint tile pattern
    const s = theme.grid.step;
    for (const which of ["minor", "major"]) {
      const p = el("pattern", { id: `grid-${which}-${theme.id}`, width: s * (which === "major" ? theme.grid.every : 1), height: s * (which === "major" ? theme.grid.every : 1), patternUnits: "userSpaceOnUse" }, defs);
      const w = s * (which === "major" ? theme.grid.every : 1);
      el("path", { d: `M ${s} 0 V ${w} M 0 ${s} H ${w}`, stroke: theme.grid[which], "stroke-width": 0.6 }, p);
    }
  }
  void o;
}

// ---- ops → SVG (crisp) or rough ----------------------------

function strokeDash(theme, e) {
  if (theme.crisp) {
    if (e.dotted) return "1.5 6";
    if (e.dashed) return "7 6";
    return null;
  }
  if (e.dotted) return [1.5, 5];
  if (e.dashed) return [7, 6];
  return null;
}

function crispShapeOp(ctx, op, stroke, fill, w) {
  const g = ctx.content;
  switch (op.k) {
    case "rect": {
      const r = el("rect", { x: op.x, y: op.y, width: op.w, height: op.h, rx: op.r ?? 0, fill: fill ?? "none", stroke, "stroke-width": w, "stroke-linejoin": "round" }, g);
      void r; break;
    }
    case "poly": {
      const pts = op.pts.map((p) => p.join(",")).join(" ");
      el("polygon", { points: pts, fill: fill ?? "none", stroke, "stroke-width": w, "stroke-linejoin": "round" }, g);
      break;
    }
    case "path": {
      el("path", { d: op.d, fill: fill ?? "none", stroke, "stroke-width": w, "stroke-linejoin": "round", "stroke-linecap": "round" }, g);
      break;
    }
    case "circle": {
      el("circle", { cx: op.cx, cy: op.cy, r: op.r, fill: fill ?? "none", stroke, "stroke-width": w }, g);
      break;
    }
    case "line": {
      el("line", { x1: op.x1, y1: op.y1, x2: op.x2, y2: op.y2, stroke, "stroke-width": w, "stroke-linecap": "round" }, g);
      break;
    }
  }
}

async function roughShapeOp(ctx, op, stroke, fill, lw) {
  if (!ctx.rough) return;
  const rc = ctx.rough;
  const opts = { stroke, strokeWidth: lw, roughness: ctx.theme.rough.roughness, bowing: ctx.theme.rough.bowing, seed: Math.floor(Math.random() * 1e9) };
  if (fill && ctx.theme.id !== "chalk") {
    opts.fill = fill;
    opts.fillStyle = "solid";
  }
  let node;
  switch (op.k) {
    case "rect": node = rc.rectangle(op.x, op.y, op.w, op.h, { ...opts, fill: fill && ctx.theme.id !== "chalk" ? fill : "none", fillStyle: "solid", roughness: Math.max(0.4, ctx.theme.rough.roughness - 0.4) }); break;
    case "poly": node = rc.polygon(op.pts, opts); break;
    case "path": node = rc.path(op.d, opts); break;
    case "circle": node = rc.circle(op.cx, op.cy, op.r, { ...opts, roughness: Math.max(0.4, ctx.theme.rough.roughness - 0.5) }); break;
    case "line": node = rc.line(op.x1, op.y1, op.x2, op.y2, opts); break;
  }
  if (node) ctx.content.appendChild(node);
}

// ---- text ----------------------------------------------------

function addText(ctx, x, y, str, f, fill, opts) {
  const t = el("text", {
    x, y,
    fill,
    "font-family": f.family,
    "font-size": f.size,
    "font-weight": f.weight,
    "text-anchor": opts.anchor || "middle",
    "dominant-baseline": opts.baseline || "central",
  }, ctx.content);
  if (opts.spacing) t.setAttribute("letter-spacing", opts.spacing);
  if (opts.rot) t.setAttribute("transform", `rotate(${opts.rot} ${x} ${y})`);
  t.textContent = str;
  return t;
}

// ---- nodes ---------------------------------------------------

function drawNode(ctx, n) {
  const theme = ctx.theme;
  const box = { x: n.x, y: n.y, w: n._w, h: n._h };
  const ops = nodeGlyphOps(n.kind, box);
  const group = el("g", {}, ctx.content);
  const saved = ctx.content;
  ctx.content = group;
  const rot = !theme.crisp && theme.skew ? (Math.random() * 2 - 1) * theme.skew : 0;
  if (rot) group.setAttribute("transform", `rotate(${rot} ${box.x + box.w / 2} ${box.y + box.h / 2})`);

  if (theme.crisp) {
    const fill = isStartEnd(n.kind) ? theme.nodeFill : theme.nodeFill;
    for (const op of ops) crispShapeOp(ctx, op, theme.nodeStroke, fill, theme.ew);
  } else {
    for (const op of ops) roughShapeOp(ctx, op, theme.nodeStroke, theme.nodeFill, theme.rough.nodeW);
  }

  // text
  const tc = textCenter(n.kind, box);
  const mainF = theme.f.main;
  const lh = mainF.size * 1.28;
  const totalH = n._textH;
  if (n.lines.length === 1 && !n.subLine) {
    addText(ctx, tc.x, tc.y, n.lines[0], mainF, theme.text, { spacing: mainF.spacingPx || undefined });
  } else {
    const yTop = tc.y - totalH / 2;
    n.lines.forEach((line, i) => {
      addText(ctx, tc.x, yTop + i * lh + lh * 0.5, line, mainF, theme.text, { spacing: mainF.spacingPx || undefined });
    });
  }
  if (n.subLine) {
    const subF = theme.f.sub;
    const yTop = tc.y - totalH / 2;
    addText(ctx, tc.x, yTop + n.lines.length * lh + 4 + subF.size * 0.5, n.subLine, subF, theme.sub, { spacing: subF.spacingPx || undefined });
  }
  ctx.content = saved;
}

// ---- edges ---------------------------------------------------

function drawEdge(ctx, e) {
  const theme = ctx.theme;
  const g = e.geom;
  if (!g) return;
  const dash = strokeDash(theme, e);
  if (theme.crisp) {
    const p = el("path", { d: g.d, fill: "none", stroke: theme.edge, "stroke-width": theme.ew, "stroke-linecap": "round" }, ctx.content);
    if (dash) p.setAttribute("stroke-dasharray", dash);
  } else {
    const opts = { stroke: theme.edge, strokeWidth: theme.rough.edgeW, roughness: theme.rough.roughness, bowing: theme.rough.bowing, seed: Math.floor(Math.random() * 1e9) };
    if (dash) opts.strokeLineDash = dash;
    const node = ctx.rough.path(g.d, opts);
    if (node) ctx.content.appendChild(node);
  }
  // arrowheads
  if (g.arrow) {
    for (const tip of g.arrow) {
      if (theme.crisp) {
        if (tip.closed) {
          el("polygon", { points: tip.pts.map((p) => p.join(",")).join(" "), fill: theme.edge, stroke: "none" }, ctx.content);
        } else {
          for (const seg of tip.lines) {
            el("line", { x1: seg[0][0], y1: seg[0][1], x2: seg[1][0], y2: seg[1][1], stroke: theme.edge, "stroke-width": theme.ew }, ctx.content);
          }
        }
      } else if (ctx.rough) {
        const seed = Math.floor(Math.random() * 1e9);
        if (tip.closed) {
          const node = ctx.rough.polygon(tip.pts, { fill: theme.edge, fillStyle: "solid", stroke: "none", roughness: 0.5, seed });
          if (node) ctx.content.appendChild(node);
        } else {
          for (const seg of tip.lines) {
            const node = ctx.rough.line(seg[0][0], seg[0][1], seg[1][0], seg[1][1], { stroke: theme.edge, strokeWidth: theme.rough.edgeW, roughness: 0.5, seed });
            if (node) ctx.content.appendChild(node);
          }
        }
      }
    }
  }
  // label
  if (e.label && g.lbl) {
    const f = theme.f.edge;
    const m = ctx.measure(e.label, f) + (f.spacingPx || 0) * Math.max(0, e.label.length - 1);
    const bw = m + 12, bh = f.size + 8;
    const x = g.lbl.x, y = g.lbl.y + (theme.crisp ? -1 : 0);
    if (theme.crisp) {
      el("rect", { x: x - bw / 2, y: y - bh / 2, width: bw, height: bh, rx: Math.min(5, bh / 2), fill: theme.chipFill, stroke: "none" }, ctx.content);
    } else if (ctx.rough) {
      const node = ctx.rough.rectangle(x - bw / 2, y - bh / 2, bw, bh, { fill: theme.chipFill, fillStyle: "solid", stroke: "none", roughness: 0.9, seed: Math.floor(Math.random() * 1e9) });
      if (node) ctx.content.appendChild(node);
    }
    addText(ctx, x, y, e.label, f, theme.edgeText, { spacing: f.spacingPx || undefined });
  }
}

// ---- lanes ---------------------------------------------------

function drawLane(ctx, lane) {
  const theme = ctx.theme;
  const box = { x: lane.x, y: lane.y, w: lane.w, h: lane.h };
  if (theme.crisp) {
    el("rect", { x: box.x, y: box.y, width: box.w, height: box.h, fill: theme.laneFill, stroke: theme.laneStroke, "stroke-width": 1, "stroke-dasharray": lane.band ? "8 5" : "none" }, ctx.content);
    if (lane.band) {
      const f = theme.f.sub;
      addText(ctx, box.x + 12, box.y + 13, theme.case === "upper" ? lane.band.toUpperCase() : lane.band, f, theme.sub, { anchor: "start", baseline: "middle", spacing: f.spacingPx || undefined });
    }
  } else if (ctx.rough) {
    const seed = Math.floor(Math.random() * 1e9);
    const node = ctx.rough.rectangle(box.x, box.y, box.w, box.h, { stroke: theme.laneStroke, strokeWidth: 1.2, roughness: theme.rough.roughness * 0.7, seed, fill: theme.laneFill, fillStyle: "solid" });
    if (node) ctx.content.appendChild(node);
    if (lane.band) {
      const f = theme.f.sub;
      addText(ctx, box.x + 14, box.y + 16, lane.band, f, theme.sub, { anchor: "start", spacing: undefined });
    }
  }
}

// ---- sequence ------------------------------------------------

function lifelineX(a) { return a.x; }

const SEQ_ICON_Y = 22; // stick figure centre (above the actor box)

function drawSequence(ctx, graph) {
  const theme = ctx.theme;
  const actors = graph.actors;
  const rough = ctx.rough;
  const headY = 54;                 // actor box top
  const boxH = 46;                  // actor box height
  const lifelineTop = headY + boxH + 4;
  const lifelineBottom = graph._seqH - 74;

  // lifelines first
  for (const a of actors) {
    const x = lifelineX(a);
    if (theme.crisp) {
      const l = el("line", { x1: x, y1: lifelineTop, x2: x, y2: lifelineBottom, stroke: theme.edge, "stroke-width": theme.ew, opacity: 0.5, "stroke-dasharray": "3 7" }, ctx.content);
      void l;
    } else if (rough) {
      const node = rough.line(x, lifelineTop, x, lifelineBottom, { stroke: theme.edge, strokeWidth: theme.rough.edgeW * 0.55, roughness: 0.4, seed: Math.floor(Math.random() * 1e9) });
      if (node) ctx.content.appendChild(node);
    }
  }

  // actor headers (stick figure above a rounded box)
  for (const a of actors) {
    const x = lifelineX(a);
    const w = a._w;
    const box = { x: x - w / 2, y: headY, w, h: boxH };
    const cy = SEQ_ICON_Y;
    if (theme.crisp) {
      el("rect", { x: box.x, y: box.y, width: w, height: boxH, rx: 12, fill: theme.nodeFill, stroke: theme.nodeStroke, "stroke-width": theme.ew }, ctx.content);
      el("circle", { cx: x, cy, r: 5, fill: "none", stroke: theme.edge, "stroke-width": theme.ew }, ctx.content);
      el("line", { x1: x, y1: cy + 7, x2: x, y2: cy + 17, stroke: theme.edge, "stroke-width": theme.ew }, ctx.content);
      el("line", { x1: x - 8, y1: cy + 11, x2: x + 8, y2: cy + 11, stroke: theme.edge, "stroke-width": theme.ew }, ctx.content);
      el("line", { x1: x, y1: cy + 13, x2: x - 5.5, y2: cy + 21, stroke: theme.edge, "stroke-width": theme.ew }, ctx.content);
      el("line", { x1: x, y1: cy + 13, x2: x + 5.5, y2: cy + 21, stroke: theme.edge, "stroke-width": theme.ew }, ctx.content);
      addText(ctx, x, box.y + boxH / 2, a._label, theme.f.main, theme.text, { spacing: theme.f.main.spacingPx || undefined });
    } else if (rough) {
      const seed = Math.floor(Math.random() * 1e9);
      const rectNode = rough.rectangle(box.x, box.y, w, boxH, { stroke: theme.nodeStroke, strokeWidth: theme.rough.nodeW * 0.8, roughness: theme.rough.roughness * 0.7, seed, fill: theme.nodeFill, fillStyle: "solid" });
      if (rectNode) ctx.content.appendChild(rectNode);
      const parts = [
        ["circle", x, cy, 5],
        ["line", x - 8, cy + 11, x + 8, cy + 11],
      ];
      const lines = [[x, cy + 7, x, cy + 17], [x, cy + 13, x - 5.5, cy + 21], [x, cy + 13, x + 5.5, cy + 21]];
      for (const ln of lines) {
        const node = rough.line(ln[0], ln[1], ln[2], ln[3], { stroke: theme.edge, strokeWidth: theme.rough.edgeW * 0.7, roughness: 0.6, seed: Math.floor(Math.random() * 1e9) });
        if (node) ctx.content.appendChild(node);
      }
      void parts;
      const cnode = rough.circle(x, cy, 5, { stroke: theme.edge, strokeWidth: theme.rough.edgeW * 0.7, roughness: 0.5, seed: Math.floor(Math.random() * 1e9) });
      if (cnode) ctx.content.appendChild(cnode);
      addText(ctx, x, box.y + boxH / 2, a._label, theme.f.main, theme.text, {});
    }
  }

  // messages
  const xById = new Map(actors.map((a) => [a.id, lifelineX(a)]));
  for (const m of graph.messages) {
    const x1 = xById.get(m.from) ?? 0, x2 = xById.get(m.to) ?? 0;
    drawSeqMessage(ctx, m, x1, x2, m.y);
  }
}

function drawSeqMessage(ctx, m, x1, x2, y) {
  const theme = ctx.theme;
  const rough = ctx.rough;
  const self = Math.abs(x2 - x1) < 2;
  let d, endAngle = 0;
  let labelX = (x1 + x2) / 2;
  if (self) {
    const dir = 30;
    d = `M ${x1} ${y} L ${x1 + dir} ${y} Q ${x1 + dir + 10} ${y} ${x1 + dir + 10} ${y - 10} L ${x1 + dir + 10} ${y - 26} L ${x1 + 3} ${y - 26}`;
    endAngle = Math.PI;
    labelX = x1 + dir + 6;
  } else {
    d = `M ${x1} ${y} L ${x2} ${y}`;
    endAngle = x2 >= x1 ? 0 : Math.PI;
  }
  const closed = !m.dashed;
  if (theme.crisp) {
    const p = el("path", { d, fill: "none", stroke: theme.edge, "stroke-width": theme.ew, "stroke-linecap": "round" }, ctx.content);
    if (m.dashed) p.setAttribute("stroke-dasharray", "6 6");
    // arrow
    const ang = endAngle;
    const L = 10, W = 5;
    const tx = self ? x1 + 3 : x2;
    const ty = y;
    const bx = tx - Math.cos(ang) * L, by = ty - Math.sin(ang) * L;
    const nx = -Math.sin(ang), ny = Math.cos(ang);
    if (closed) {
      el("polygon", { points: [[tx, ty], [bx + nx * W, by + ny * W], [bx - nx * W, by - ny * W]].map((p) => p.join(",")).join(" "), fill: theme.edge, stroke: "none" }, ctx.content);
    } else {
      el("line", { x1: bx + nx * W, y1: by + ny * W, x2: tx, y2: ty, stroke: theme.edge, "stroke-width": theme.ew }, ctx.content);
      el("line", { x1: bx - nx * W, y1: by - ny * W, x2: tx, y2: ty, stroke: theme.edge, "stroke-width": theme.ew }, ctx.content);
    }
  } else if (rough) {
    const seed = Math.floor(Math.random() * 1e9);
    const lineNode = rough.path(d, { stroke: theme.edge, strokeWidth: theme.rough.edgeW, roughness: 0.5, seed, strokeLineDash: m.dashed ? [6, 6] : undefined });
    if (lineNode) ctx.content.appendChild(lineNode);
    const ang = endAngle;
    const tx = self ? x1 + 3 : x2, ty = y;
    const tips = closed
      ? rough.polygon([[tx, ty], [tx - Math.cos(ang) * 11 - Math.sin(ang) * 5, ty - Math.sin(ang) * 11 + Math.cos(ang) * 5], [tx - Math.cos(ang) * 11 + Math.sin(ang) * 5, ty - Math.sin(ang) * 11 - Math.cos(ang) * 5]], { fill: theme.edge, fillStyle: "solid", stroke: "none", seed })
      : null;
    if (tips) ctx.content.appendChild(tips);
  }
  if (m.label) {
    const f = theme.f.edge;
    const mw = ctx.measure(m.label, f) + 12;
    const bh = f.size + 8;
    if (theme.crisp) {
      el("rect", { x: labelX - mw / 2, y: y - bh / 2 - 11, width: mw, height: bh, rx: Math.min(5, bh / 2), fill: theme.chipFill }, ctx.content);
    } else if (rough) {
      const node = rough.rectangle(labelX - mw / 2, y - bh / 2 - 11, mw, bh, { fill: theme.chipFill, fillStyle: "solid", stroke: "none", roughness: 0.8, seed: Math.floor(Math.random() * 1e9) });
      if (node) ctx.content.appendChild(node);
    }
    addText(ctx, labelX, y - 11, m.label, f, theme.edgeText, {});
  }
}

// ---- frame, title block --------------------------------------

function drawFrameAndBlock(ctx, o, graph, theme, dateStr) {
  const { W, H } = o;
  const measure = ctx.measure;
  // frame
  const fx = FRAME, fy = FRAME, fw = W - FRAME * 2, fh = H - FRAME * 2;
  if (theme.crisp) {
    el("rect", { x: fx, y: fy, width: fw, height: fh, fill: "none", stroke: theme.edge, "stroke-width": 1.6, opacity: 0.85 }, ctx.content);
    el("rect", { x: fx + 7, y: fy + 7, width: fw - 14, height: fh - 14, fill: "none", stroke: theme.edge, "stroke-width": 0.6, opacity: 0.4 }, ctx.content);
    // corner ticks
    const t = 12;
    const corners = [[fx, fy, 1, 1], [fx + fw, fy, -1, 1], [fx, fy + fh, 1, -1], [fx + fw, fy + fh, -1, -1]];
    for (const [cx0, cy0, sx, sy] of corners) {
      el("line", { x1: cx0 + sx * t, y1: cy0, x2: cx0 + sx * 3, y2: cy0, stroke: theme.edge, "stroke-width": 1.4, opacity: 0.9 }, ctx.content);
      el("line", { x1: cx0, y1: cy0 + sy * t, x2: cx0, y2: cy0 + sy * 3, stroke: theme.edge, "stroke-width": 1.4, opacity: 0.9 }, ctx.content);
    }
  } else if (ctx.rough) {
    const node = ctx.rough.rectangle(fx, fy, fw, fh, { stroke: theme.edge, strokeWidth: 1.6, roughness: theme.rough.roughness * 0.8, seed: Math.floor(Math.random() * 1e9) });
    if (node) ctx.content.appendChild(node);
  }

  // top strip text
  const topF = theme.f.block;
  const up = theme.case === "upper";
  const t1 = up ? "AI DRAFTING BUREAU".toUpperCase() : "AI Drafting Bureau";
  addText(ctx, fx + 12, fy + 18, t1, topF, theme.faint, { anchor: "start", baseline: "central", spacing: topF.spacingPx || undefined });
  const t2 = up ? `SHEET TYPE · ${(TYPE_LABELS[graph.type] || "Diagram").toUpperCase()}` : `Sheet type · ${TYPE_LABELS[graph.type] || "Diagram"}`;
  addText(ctx, fx + fw - 12, fy + 18, t2, topF, theme.faint, { anchor: "end", baseline: "central", spacing: topF.spacingPx || undefined });

  // bottom-left meta (right side reserved for the title block's Date field)
  addText(ctx, fx + 12, fy + fh - 16, up ? "SCALE 1:1  ·  NTS".toUpperCase() : "Scale 1:1  ·  NTS", topF, theme.faint, { anchor: "start", baseline: "central", spacing: topF.spacingPx || undefined });

  // title block
  const tb = { x: fx + fw - TB_W - 14, y: fy + fh - TB_H - 10, w: TB_W, h: TB_H };
  const title = String(graph.title || "Untitled").slice(0, 54);
  const titleT = up ? title.toUpperCase() : title;
  if (theme.crisp) {
    el("rect", { x: tb.x, y: tb.y, width: tb.w, height: tb.h, fill: "none", stroke: theme.edge, "stroke-width": 1.4, opacity: 0.9 }, ctx.content);
    el("line", { x1: tb.x + tb.w * 0.42, y1: tb.y, x2: tb.x + tb.w * 0.42, y2: tb.y + tb.h, stroke: theme.edge, "stroke-width": 1, opacity: 0.7 }, ctx.content);
    el("line", { x1: tb.x, y1: tb.y + tb.h * 0.56, x2: tb.x + tb.w, y2: tb.y + tb.h * 0.56, stroke: theme.edge, "stroke-width": 1, opacity: 0.7 }, ctx.content);
    el("line", { x1: tb.x, y1: tb.y + tb.h * 0.72, x2: tb.x + tb.w, y2: tb.y + tb.h * 0.72, stroke: theme.edge, "stroke-width": 1, opacity: 0.7 }, ctx.content);
  } else if (ctx.rough) {
    const seed = Math.floor(Math.random() * 1e9);
    const node = ctx.rough.rectangle(tb.x, tb.y, tb.w, tb.h, { stroke: theme.edge, strokeWidth: 1.5, roughness: theme.rough.roughness * 0.7, seed });
    if (node) ctx.content.appendChild(node);
  }

  // project title (big)
  const bigF = { ...theme.f.main, size: theme.f.main.size + (theme.crisp ? 4 : 3) };
  const titleLines = wrapT(titleT, measure, bigF, tb.w * 0.42 - 24);
  const tArea = { x: tb.x + tb.w * 0.21 };
  const tLh = bigF.size * 1.18;
  const tBlockH = titleLines.length * tLh;
  let ty = tb.y + (tb.h - tBlockH) / 2 + tLh * 0.55;
  for (const l of titleLines) {
    addText(ctx, tArea.x, ty, l, bigF, theme.text, { spacing: bigF.spacingPx || undefined });
    ty += tLh;
  }
  // fields
  const fF = theme.f.block;
  const fields = [
    ["Kind", TYPE_LABELS[graph.type] || "Diagram", tb.y + tb.h * 0.3],
    ["Scale", "1:1", tb.y + tb.h * 0.45],
    ["Date", dateStr, tb.y + tb.h * 0.68],
    ["Sheet", "1 / 1", tb.y + tb.h * 0.84],
  ];
  const colL = tb.x + tb.w * 0.42 + 12;
  const colR = tb.x + tb.w - 10;
  for (const [k, v, yy] of fields) {
    const kk = up ? k.toUpperCase() : k;
    const vv = up ? String(v).toUpperCase() : String(v);
    addText(ctx, colL, yy, kk, fF, theme.faint, { anchor: "start", baseline: "central", spacing: fF.spacingPx || undefined });
    addText(ctx, colR, yy, vv, fF, theme.edgeText, { anchor: "end", baseline: "central", spacing: fF.spacingPx || undefined });
  }
}

function wrapT(text, measure, font, maxW) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = "";
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (cur && measure(trial, font) > maxW) { lines.push(cur); cur = w; }
    else cur = trial;
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 3).map((l, i) => i === 2 ? l.slice(0, Math.max(1, l.length - 1)) + "…" : l);
}

// ----------------------------------------------------------------- PNG export

let fontDataCache = new Map();
async function fontCSS(family, weights) {
  const key = `${family}|${weights.join(",")}`;
  if (fontDataCache.has(key)) return fontDataCache.get(key);
  const cssUrl = `https://fonts.googleapis.com/css2?family=${family.replace(/ /g, "+")}:wght@${weights.join(";")}&display=swap`;
  try {
    const css = await (await fetch(cssUrl)).text();
    const blocks = css.split("@font-face").slice(1);
    const urlByWeight = new Map();
    for (const b of blocks) {
      const w = (b.match(/font-weight:\s*(\d+)/) || [0, 400])[1];
      const url = (b.match(/url\((https:[^)]+\.woff2)\)/) || [])[1];
      if (!url || urlByWeight.has(w)) continue;
      const ur = (b.match(/unicode-range:\s*([^;]+);/) || [])[1] || "";
      if (!ur.includes("U+0000-00FF")) continue; // latin block only
      urlByWeight.set(w, url);
      if (urlByWeight.size >= weights.length) break;
    }
    const found = [];
    for (const w of weights) {
      const url = urlByWeight.get(String(w)) || urlByWeight.get("400");
      if (!url) continue;
      const buf = new Uint8Array(await (await fetch(url)).arrayBuffer());
      let bin = "";
      for (let i = 0; i < buf.length; i += 0x8000) bin += String.fromCharCode(...buf.subarray(i, i + 0x8000));
      found.push(`@font-face{font-family:'${family}';font-style:normal;font-weight:${w};src:url(data:font/woff2;base64,${btoa(bin)}) format('woff2');}`);
    }
    const cssText = found.join("\n") || "";
    fontDataCache.set(key, cssText);
    return cssText;
  } catch (err) {
    console.warn("font inline failed", err);
    fontDataCache.set(key, "");
    return "";
  }
}

async function buildSource(svg, theme) {
  await ensureRough();
  const famWeights = new Map();
  for (const key of ["main", "sub", "edge", "block"]) {
    const f = theme.f[key];
    if (!f) continue;
    if (!famWeights.has(f.family)) famWeights.set(f.family, new Set());
    famWeights.get(f.family).add(String(f.weight));
  }
  const style = (await Promise.all([...famWeights].map(([fam, ws]) => fontCSS(fam, [...ws])))).join("");
  const clone = svg.cloneNode(true);
  clone.removeAttribute("style");
  let defs = clone.querySelector("defs");
  if (!defs) { defs = el("defs", {}, clone); clone.insertBefore(defs, clone.firstChild); }
  const st = el("style", {}, defs);
  st.textContent = style;
  return new XMLSerializer().serializeToString(clone);
}

export async function svgSource(svg, theme) {
  return buildSource(svg, theme);
}

export async function exportPNG(svg, graph, theme, dateStr) {
  const xml = await buildSource(svg, theme);
  const W = parseFloat(svg.getAttribute("width"));
  const H = parseFloat(svg.getAttribute("height"));
  const blob = new Blob([xml], { type: "image/svg+xml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  try {
    const img = new Image();
    await new Promise((res, rej) => { img.onload = res; img.onerror = rej; img.src = url; });
    const dpr = Math.min(2.5, Math.max(1.5, 2000 / Math.max(W, H)));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(W * dpr);
    canvas.height = Math.round(H * dpr);
    const c2 = canvas.getContext("2d");
    c2.scale(dpr, dpr);
    c2.drawImage(img, 0, 0, W, H);
    const out = await new Promise((res) => canvas.toBlob(res, "image/png"));
    const a = document.createElement("a");
    a.href = URL.createObjectURL(out);
    const slug = (String(graph.title || "diagram")).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48) || "diagram";
    a.download = `${slug}-${theme.id}.png`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return out;
  } finally {
    URL.revokeObjectURL(url);
  }
}
