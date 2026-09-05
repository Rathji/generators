// layout.js — text sizing, wrapping, and all graph layouts (theme-agnostic
// geometry; render.js turns the results into SVG). Mutates graph.nodes /
// graph.edges with positions & edge geometry.

import { canonKind, boxFor, anchorFor } from "./shapes.js";

export const TYPES = ["flowchart", "tree", "mindmap", "architecture", "network", "sequence"];

// ---------- text ----------

export function makeMeasure() {
  const ctx = document.createElement("canvas").getContext("2d");
  const cache = new Map();
  return function measure(text, f) {
    if (!text) return 0;
    const key = `${f.family}|${f.size}|${f.weight}|${text}`;
    let w = cache.get(key);
    if (w === undefined) {
      ctx.font = `${f.weight} ${f.size}px ${f.family}`;
      w = ctx.measureText(text).width;
      cache.set(key, w);
    }
    return w;
  };
}

const WRAP_FACTOR = {
  decision: 0.62, data: 0.84, note: 0.8, cloud: 0.92,
  person: 0.95, server: 1, process: 1, start: 0.98, end: 0.98,
  database: 0.9, document: 0.95, device: 1,
};

export function wrapText(text, measure, font, capWidth) {
  const words = String(text).split(/\s+/).filter(Boolean);
  if (!words.length) return [""];
  const spacing = font.spacingPx || 0;
  const widthOf = (s) => measure(s, font) + spacing * Math.max(0, s.length - 1);
  const lines = [];
  let cur = "";
  const commit = (s) => lines.push(s);
  for (const w of words) {
    const trial = cur ? cur + " " + w : w;
    if (cur && widthOf(trial) > capWidth) { commit(cur); cur = w; }
    else cur = trial;
    if (widthOf(cur) > capWidth) {
      let word = cur; cur = "";
      let chunk = "";
      for (const ch of word) {
        if (chunk && widthOf(chunk + ch) > capWidth) { commit(chunk); chunk = ch; }
        else chunk += ch;
      }
      cur = chunk;
    }
  }
  if (cur) lines.push(cur);
  return lines.slice(0, 4).map((l, i) => i === 3 ? l.slice(0, Math.max(1, l.length - 1)) + "…" : l);
}

export function sizeNodes(graph, theme) {
  const measure = makeMeasure();
  const applyCase = (s) => theme.case === "upper" ? s.toUpperCase() : s;
  for (const n of graph.nodes) {
    n.kind = canonKind(n.kind);
    const cap = theme.wrap * (WRAP_FACTOR[n.kind] || 1);
    const main = applyCase(String(n.label ?? "").trim().slice(0, 70)) || (theme.case === "upper" ? "STEP" : "Step");
    const lines = wrapText(main, measure, theme.f.main, cap);
    let textW = 0;
    for (const l of lines) textW = Math.max(textW, measure(l, theme.f.main) + (theme.f.main.spacingPx || 0) * Math.max(0, l.length - 1));
    const lh = theme.f.main.size * 1.28;
    let textH = lines.length * lh;
    let sub = null;
    if (n.sub) {
      sub = applyCase(String(n.sub).trim().slice(0, 50));
      sub = wrapText(sub, measure, theme.f.sub, cap * 0.95)[0];
      textH += 6 + theme.f.sub.size * 1.3;
      textW = Math.max(textW, measure(sub, theme.f.sub) + (theme.f.sub.spacingPx || 0) * Math.max(0, sub.length - 1));
    }
    const box = boxFor(n.kind, textW, textH);
    n._w = box.w; n._h = box.h;
    n.lines = lines; n.subLine = sub; n._textH = textH; n._lh = lh;
  }
  return graph;
}

// ---------- graph normalization (post-AI) ----------

export function typeFrom(s) {
  const t = String(s || "").toLowerCase();
  if (t.includes("sequence") || t.includes("seq")) return "sequence";
  if (t.includes("mind") || t.includes("brain")) return "mindmap";
  if (t.includes("tree") || t.includes("hierarch") || t.includes("org") || t.includes("family")) return "tree";
  if (t.includes("architecture") || t.includes("deploy") || t.includes("system") || t.includes("infra")) return "architecture";
  if (t.includes("network") || t.includes("topolog") || t.includes("entity") || t.includes("relation")) return "network";
  if (t.includes("flow") || t.includes("process") || t.includes("workflow") || t.includes("algorithm") || t.includes("chart") || t.includes("pipeline") || t.includes("loop")) return "flowchart";
  return "flowchart";
}

export function normalizeGraph(raw) {
  const g = { ...raw };
  g.type = typeFrom(g.type);
  if (g.type === "sequence") return normalizeSequence(g);
  const nodes = [];
  const byId = new Map();
  const seen = new Set();
  for (const rn of Array.isArray(g.nodes) ? g.nodes : []) {
    const id = String(rn.id ?? rn.i ?? "").trim();
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const n = {
      id, kind: canonKind(rn.kind),
      label: String(rn.label ?? rn.text ?? rn.title ?? rn.name ?? id),
      sub: rn.sub ? String(rn.sub) : null,
      band: rn.band ? String(rn.band) : null,
    };
    nodes.push(n); byId.set(id, n);
  }
  if (nodes.length === 0) { nodes.push({ id: "a", kind: "start", label: "Start", sub: null, band: null }); byId.set("a", nodes[0]); }
  if (nodes.length === 1) {
    const n = nodes[0];
    nodes.push({ id: "b", kind: "end", label: "End", sub: null, band: n.band });
    byId.set("b", nodes[1]);
  }
  const edges = [];
  const dup = new Set();
  for (const re of Array.isArray(g.edges) ? g.edges : []) {
    const f = byId.get(String(re.from ?? re.source ?? re.a ?? "").trim());
    const t = byId.get(String(re.to ?? re.target ?? re.b ?? "").trim());
    if (!f || !t || f === t) continue;
    const k = f.id + "\u0000" + t.id;
    if (dup.has(k)) continue;
    dup.add(k);
    const es = String(re.style ?? re.line ?? "").toLowerCase();
    edges.push({
      from: f.id, to: t.id,
      label: re.label ? String(re.label).slice(0, 60) : null,
      dashed: es.includes("dash"),
      dotted: es.includes("dot") && !es.includes("dash"),
      arrow: arrowFrom(re.arrow, g.type),
    });
  }
  if (nodes.length > 1 && edges.length === 0 && g.type !== "mindmap") {
    for (let i = 0; i < nodes.length - 1; i++) edges.push({ from: nodes[i].id, to: nodes[i + 1].id, label: null, dashed: false, dotted: false, arrow: "end" });
  }
  g.nodes = nodes; g.edges = edges; g._byId = byId;
  return g;
}

export function arrowFrom(a, type) {
  const s = String(a ?? "").toLowerCase();
  if (s.includes("none") || s.includes("no") || s === "false") return "none";
  if (s.includes("both")) return "both";
  if (s.includes("open")) return "open";
  if (s.includes("start") || s.includes("reverse")) return "start";
  const d = type === "flowchart" || type === "architecture" || type === "network";
  return d ? "end" : "none";
}

function normalizeSequence(g) {
  const actors = [];
  const byId = new Map();
  for (const ra of Array.isArray(g.actors) ? g.actors : []) {
    const id = String(ra.id ?? ra.name ?? "").trim();
    if (!id || byId.has(id)) continue;
    const a = { id, label: String(ra.label ?? id).slice(0, 26) };
    actors.push(a); byId.set(id, a);
  }
  const messages = [];
  const seen = new Set();
  for (const rm of Array.isArray(g.messages) ? g.messages : []) {
    const f = String(rm.from ?? "").trim(), t = String(rm.to ?? "").trim();
    if (!f || !t) continue;
    if (!byId.has(f) && actors.length < 8) { const a = { id: f, label: f }; actors.push(a); byId.set(f, a); }
    if (!byId.has(t) && actors.length < 8) { const a = { id: t, label: t }; actors.push(a); byId.set(t, a); }
    if (!byId.has(f) || !byId.has(t)) continue;
    const key = `${f}>${t}>${rm.label ?? ""}`;
    if (seen.has(key)) continue; seen.add(key);
    const s = String(rm.style ?? "").toLowerCase();
    messages.push({
      from: f, to: t,
      label: String(rm.label ?? "").slice(0, 80),
      dashed: s.includes("dash") || s.includes("resp") || s.includes("return"),
    });
  }
  if (actors.length < 2) {
    while (actors.length < 2) {
      const id = "p" + (actors.length + 1);
      actors.push({ id, label: id });
    }
  }
  if (!messages.length && actors.length >= 2) {
    messages.push({ from: actors[0].id, to: actors[1].id, label: "…", dashed: false });
  }
  g.actors = actors; g.messages = messages; g.nodes = []; g.edges = [];
  return g;
}

// ---------- layered layout (flowchart; LR or TB) ----------

function computeRanks(graph) {
  const rank = new Map(graph.nodes.map((n) => [n.id, 0]));
  for (let pass = 0; pass < graph.nodes.length + 2; pass++) {
    let changed = false;
    for (const e of graph.edges) {
      const a = rank.get(e.from), b = rank.get(e.to);
      if (a >= b) { rank.set(e.to, a + 1); changed = true; }
    }
    if (!changed) break;
  }
  return rank;
}

// barycenter crossing minimization over rank order
function orderRanks(lists, graph) {
  const order = lists.map((l) => [...l]);
  const posIn = new Map();
  const score = new Map();
  for (let iter = 0; iter < 6; iter++) {
    const fwd = iter % 2 === 0;
    order.forEach((l) => l.forEach((n, i) => posIn.set(n.id, i)));
    for (const n of graph.nodes) score.set(n.id, order.findIndex((l) => l.includes(n)));
    const seq = fwd ? order : [...order].reverse();
    for (const list of seq) {
      const scored = list.map((n) => {
        const preds = graph.edges.filter((e) => fwd ? e.to === n.id : e.from === n.id)
          .map((e) => posIn.get(fwd ? e.from : e.to)).filter((p) => p !== undefined);
        const sc = preds.length ? preds.reduce((a, b) => a + b, 0) / preds.length : list.indexOf(n);
        return [n, sc];
      });
      scored.sort((a, b) => a[1] - b[1]);
      scored.forEach((s, i) => { list[i] = s[0]; });
    }
  }
  return order;
}

export function layoutLayered(graph, theme, dir) {
  const rank = computeRanks(graph);
  const maxRank = Math.max(...graph.nodes.map((n) => rank.get(n.id)), 0);
  const lists = [];
  for (let r = 0; r <= maxRank; r++) lists.push(graph.nodes.filter((n) => rank.get(n.id) === r));
  const ordered = orderRanks(lists, graph);
  const horizontal = dir !== "TB";
  const gapAlong = horizontal ? theme.lgx : theme.lgy;
  const gapStack = horizontal ? theme.lgy : theme.lgx;
  const ext = (n) => horizontal ? n._w : n._h;   // extent along the rank axis

  // column/row widths
  const colW = [];
  for (let r = 0; r <= maxRank; r++) {
    const here = ordered[r];
    let s = 0;
    for (const n of here) s += ext(n);
    s += gapStack * (Math.max(0, here.length - 1));
    colW.push(Math.max(s, ...here.map((n) => ext(n))));
  }
  const maxCol = Math.max(...colW, 0);
  const axis1 = [];
  let cursor = 0;
  for (let r = 0; r <= maxRank; r++) { axis1.push(cursor + colW[r] / 2); cursor += colW[r] + gapAlong; }

  // per-rank stacking, centered against the widest rank
  const stackMap = new Map();
  for (let r = 0; r <= maxRank; r++) {
    let s = 0;
    for (const n of ordered[r]) {
      const sz = ext(n);
      stackMap.set(n.id, s + sz / 2);
      s += sz + gapStack;
    }
    const total = s - gapStack;
    const shift = (maxCol - total) / 2;
    for (const n of ordered[r]) stackMap.set(n.id, stackMap.get(n.id) + shift);
  }

  for (const n of graph.nodes) {
    const a1 = axis1[rank.get(n.id)];
    const a2 = stackMap.get(n.id);
    if (horizontal) { n.x = a1 - n._w / 2; n.y = a2 - n._h / 2; }
    else { n.x = a2 - n._w / 2; n.y = a1 - n._h / 2; }
  }
}

// ---------- tree layout (org / hierarchy); mind maps reuse it transposed ----------

function layoutTreeCore(graph, theme) {
  const children = new Map(graph.nodes.map((n) => [n.id, []]));
  const hasParent = new Set();
  for (const e of graph.edges) {
    if (!children.has(e.from)) children.set(e.from, []);
    children.get(e.from).push(e.to);
    hasParent.add(e.to);
  }
  const roots = graph.nodes.filter((n) => !hasParent.has(n.id));
  const rootsList = roots.length ? roots : [graph.nodes[0]];

  const GAP = 42;
  const subW = new Map();
  function treeW(id) {
    if (subW.has(id)) return subW.get(id);
    const ch = children.get(id) || [];
    let w = 0;
    if (ch.length) {
      let s = 0;
      for (const c of ch) s += treeW(c);
      w = s + GAP * (ch.length - 1);
    }
    const self = graph._byId.get(id);
    subW.set(id, Math.max(w, self ? self._w : 0));
    return subW.get(id);
  }
  for (const r of rootsList) treeW(r.id);

  const depthOf = new Map();
  function setDepth(id, d) {
    if ((depthOf.get(id) ?? -1) >= d) return;
    depthOf.set(id, d);
    for (const c of children.get(id) || []) setDepth(c, d + 1);
  }
  for (const r of rootsList) setDepth(r.id, 0);
  for (const n of graph.nodes) if (depthOf.get(n.id) === undefined) setDepth(n.id, 0);

  const byDepth = [];
  for (const n of graph.nodes) {
    const d = depthOf.get(n.id) ?? 0;
    (byDepth[d] = byDepth[d] || []).push(n);
  }
  const rowGap = theme.lgy;
  const rowH = byDepth.map((row) => {
    let h = 0;
    for (const n of row) h = Math.max(h, n._h);
    return h + rowGap;
  });

  const xPos = new Map(), yPos = new Map();
  function place(id, depth, cx, yPrev) {
    const ch = children.get(id) || [];
    const y = yPrev + rowH[depth];
    yPos.set(id, y);
    if (!ch.length) { xPos.set(id, cx); return; }
    let total = 0;
    for (const c of ch) total += subW.get(c);
    total += GAP * (ch.length - 1);
    let start = cx - total / 2;
    for (const c of ch) {
      place(c, depth + 1, start + subW.get(c) / 2, y);
      start += subW.get(c) + GAP;
    }
    const firstC = xPos.get(ch[0]);
    const lastC = xPos.get(ch[ch.length - 1]);
    xPos.set(id, (firstC + lastC) / 2);
  }

  let rootCursor = 0;
  for (const r of rootsList) {
    place(r.id, 0, rootCursor + Math.max(r._w, subW.get(r.id)) / 2, -rowH[0]);
    rootCursor += subW.get(r.id) + 100;
  }

  let minX = Infinity;
  for (const n of graph.nodes) minX = Math.min(minX, xPos.get(n.id) - n._w / 2);
  for (const n of graph.nodes) {
    n.x = xPos.get(n.id) - n._w / 2 - minX;
    n.y = yPos.get(n.id);
  }
}

function swapBoxes(graph) {
  for (const n of graph.nodes) { const t = n._w; n._w = n._h; n._h = t; }
}

// transpose the (already-computed, pre-swap) layout for LR direction
function transposeResult(graph) {
  swapBoxes(graph);
  for (const n of graph.nodes) { const nx = n.y, ny = n.x; n.x = nx; n.y = ny; }
}

export function layoutTreeGraph(graph, theme, dir) {
  const horizontal = dir === "LR";
  if (horizontal) swapBoxes(graph);
  layoutTreeCore(graph, theme);
  if (horizontal) transposeResult(graph);
}

// ---------- architecture (banded layered) ----------

export function layoutArchitecture(graph, theme) {
  if (!graph.nodes.some((n) => n.band)) { layoutLayered(graph, theme, "LR"); return []; }

  const rank = computeRanks(graph);
  const maxRank = Math.max(...graph.nodes.map((n) => rank.get(n.id)), 0);

  const bands = [];
  for (const n of graph.nodes) if (n.band && !bands.includes(n.band)) bands.push(n.band);
  bands.sort((a, b) => {
    const rankOf = (x) => Math.min(...graph.nodes.filter((n) => n.band === x).map((n) => rank.get(n.id)));
    const d = rankOf(a) - rankOf(b);
    return d !== 0 ? d : graph.nodes.findIndex((n) => n.band === a) - graph.nodes.findIndex((n) => n.band === b);
  });
  if (graph.nodes.some((n) => !n.band)) bands.push(""); // nodes without a band get the bottom lane

  // column widths, considering (band × rank) groups laid side by side
  const colW = [];
  for (let r = 0; r <= maxRank; r++) {
    const here = graph.nodes.filter((n) => rank.get(n.id) === r);
    const groups = new Map();
    for (const n of here) {
      const key = n.band ?? "";
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(n);
    }
    let worst = 0;
    for (const grp of groups.values()) {
      let s = 0;
      for (const n of grp) s += n._w;
      s += 14 * (grp.length - 1);
      worst = Math.max(worst, s);
    }
    colW.push(worst);
  }
  const xStart = [];
  let cx = 0;
  for (let r = 0; r <= maxRank; r++) { xStart.push(cx); cx += colW[r] + theme.lgx; }

  // lane rows
  const laneTop = [];
  let ty = 0;
  const laneH = [];
  for (let b = 0; b < bands.length; b++) {
    const members = graph.nodes.filter((n) => (n.band ?? "") === bands[b]);
    let h = 0;
    for (const n of members) h = Math.max(h, n._h);
    laneTop.push(ty);
    laneH.push(h + theme.lanePad * 2);
    ty += h + theme.lanePad * 2;
  }

  for (const n of graph.nodes) {
    const r = rank.get(n.id);
    const key = n.band ?? "";
    const b = Math.max(0, bands.indexOf(key));
    const group = graph.nodes.filter((m) => rank.get(m.id) === r && (m.band ?? "") === key);
    const grpW = group.reduce((s, m) => s + m._w, 0) + 14 * (group.length - 1);
    let gx = xStart[r] + (colW[r] - grpW) / 2;
    for (const m of group) {
      if (m === n) break;
      gx += m._w + 14;
    }
    n.x = gx;
    n.y = laneTop[b] + (laneH[b] - n._h) / 2;
  }
  return bands.map((band, i) => {
    const members = graph.nodes.filter((n) => (n.band ?? "") === band);
    let minX = Infinity, maxX = -Infinity;
    for (const n of members) { minX = Math.min(minX, n.x); maxX = Math.max(maxX, n.x + n._w); }
    if (!members.length) { minX = 0; maxX = 0; }
    return { band, x: minX - 14, y: laneTop[i], w: maxX - minX + 28, h: laneH[i] };
  });
}

// ---------- force layout (network) ----------

export function layoutForce(graph, theme) {
  const nodes = graph.nodes;
  const n = nodes.length;
  const idx = new Map(nodes.map((node, i) => [node.id, i]));
  const k = Math.max(190, Math.min(300, 36 * Math.sqrt(n * 3)));
  const es = graph.edges.map((e) => [idx.get(e.from), idx.get(e.to)]).filter((x) => x[0] !== undefined && x[1] !== undefined);
  const w = nodes.map((no) => no._w), h = nodes.map((no) => no._h);
  const xs = new Array(n), ys = new Array(n);
  const bestXs = new Array(n), bestYs = new Array(n);
  function runOnce() {
    for (let i = 0; i < n; i++) {
      const ang = (i / n) * Math.PI * 2 + Math.random() * 0.8;
      const rad = n * 30 + (Math.random() - 0.5) * 60;
      xs[i] = Math.cos(ang) * rad;
      ys[i] = Math.sin(ang) * rad;
    }
    const fx = new Array(n), fy = new Array(n);
    const ITER = 300;
    for (let it = 0; it < ITER; it++) {
      fx.fill(0); fy.fill(0);
      const t = Math.max(0.05, 1 - it / ITER);
      for (const [a, b] of es) {
        let dx = xs[b] - xs[a], dy = ys[b] - ys[a];
        let d = Math.hypot(dx, dy) || 1;
        const f = (d - k * 1.25) * 0.035;
        dx /= d; dy /= d;
        fx[a] += dx * f; fy[a] += dy * f;
        fx[b] -= dx * f; fy[b] -= dy * f;
      }
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          let dx = xs[b] - xs[a], dy = ys[b] - ys[a];
          let d = Math.hypot(dx, dy) || 1;
          if (d < 1) { d = 1; dx = 1; dy = 0; }
          const f = Math.min(3400 / (d * d), 2.4) * t;
          fx[a] -= (dx / d) * f; fy[a] -= (dy / d) * f;
          fx[b] += (dx / d) * f; fy[b] += (dy / d) * f;
        }
        fx[a] -= xs[a] * 0.009 * t + Math.sign(xs[a]) * 0.35 * t;
        fy[a] -= ys[a] * 0.009 * t + Math.sign(ys[a]) * 0.35 * t;
      }
      for (const [a, b] of es) {
        const ax = xs[a], ay = ys[a], bx = xs[b], by = ys[b];
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy || 1;
        for (let m = 0; m < n; m++) {
          if (m === a || m === b) continue;
          let tt = ((xs[m] - ax) * dx + (ys[m] - ay) * dy) / l2;
          tt = Math.max(0, Math.min(1, tt));
          const qx = ax + dx * tt, qy = ay + dy * tt;
          const rdx = xs[m] - qx, rdy = ys[m] - qy;
          const dist = Math.hypot(rdx, rdy) || 1;
          const R = 118;
          if (dist < R) {
            const push = ((R - dist) / R) * 1.5 * t;
            fx[m] += (rdx / dist) * push; fy[m] += (rdy / dist) * push;
          }
        }
      }
      for (let a = 0; a < n; a++) { xs[a] += fx[a]; ys[a] += fy[a]; }
    }
    for (let pass = 0; pass < 200; pass++) {
      let moved = false;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const dx = xs[b] - xs[a], dy = ys[b] - ys[a];
          const d = Math.hypot(dx, dy) || 1;
          const minD = Math.max(w[a], w[b]) * 0.9 + 40;
          if (d < minD) {
            const push = (minD - d) * 0.5;
            xs[a] -= (dx / d) * push; ys[a] -= (dy / d) * push;
            xs[b] += (dx / d) * push; ys[b] += (dy / d) * push;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }
  function hits(m, ax, ay, bx, by) {
    const hw = w[m] / 2 + 6, hh = h[m] / 2 + 6;
    const pax = ax - xs[m], pay = ay - ys[m], pbx = bx - xs[m], pby = by - ys[m];
    if (Math.max(pax, pbx) < -hw || Math.min(pax, pbx) > hw || Math.max(pay, pby) < -hh || Math.min(pay, pby) > hh) return false;
    const dx = pbx - pax, dy = pby - pay;
    const L2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, (-pax * dx - pay * dy) / L2));
    const qx = pax + dx * t, qy = pay + dy * t;
    return Math.abs(qx) <= hw && Math.abs(qy) <= hh;
  }
  function scoreRun() {
    let s = 0;
    for (let a = 0; a < n; a++) {
      for (let b = a + 1; b < n; b++) {
        if (Math.abs(xs[a] - xs[b]) < (w[a] + w[b]) / 2 && Math.abs(ys[a] - ys[b]) < (h[a] + h[b]) / 2) s += 60;
      }
    }
    for (const [a, b] of es) {
      for (let m = 0; m < n; m++) {
        if (m === a || m === b) continue;
        if (hits(m, xs[a], ys[a], xs[b], ys[b])) s += 3;
      }
    }
    let mnx = Infinity, mny = Infinity, mxx = -Infinity, mxy = -Infinity;
    for (let i = 0; i < n; i++) {
      mnx = Math.min(mnx, xs[i] - w[i] / 2); mxx = Math.max(mxx, xs[i] + w[i] / 2);
      mny = Math.min(mny, ys[i] - h[i] / 2); mxy = Math.max(mxy, ys[i] + h[i] / 2);
    }
    s += (mxx - mnx + mxy - mny) / 4000;
    return s;
  }
  function settle() {
    for (let pass = 0; pass < 800; pass++) {
      let moved = false;
      for (const [a, b] of es) {
        const ax = xs[a], ay = ys[a], bx = xs[b], by = ys[b];
        const dx = bx - ax, dy = by - ay;
        const l2 = dx * dx + dy * dy || 1;
        for (let m = 0; m < n; m++) {
          if (m === a || m === b) continue;
          if (!hits(m, ax, ay, bx, by)) continue;
          let tt = ((xs[m] - ax) * dx + (ys[m] - ay) * dy) / l2;
          tt = Math.max(0, Math.min(1, tt));
          const qx = ax + dx * tt, qy = ay + dy * tt;
          let rx = xs[m] - qx, ry = ys[m] - qy;
          let dd = Math.hypot(rx, ry);
          if (dd < 1) {
            const inv = 1 / Math.sqrt(l2);
            rx = -dy * inv; ry = dx * inv; dd = 1;
          }
          xs[m] += (rx / dd) * 2.2; ys[m] += (ry / dd) * 2.2;
          moved = true;
        }
      }
      if (!moved) break;
    }
    for (let pass = 0; pass < 300; pass++) {
      let moved = false;
      for (let a = 0; a < n; a++) {
        for (let b = a + 1; b < n; b++) {
          const dx = xs[b] - xs[a], dy = ys[b] - ys[a];
          const d = Math.hypot(dx, dy) || 1;
          const minD = (w[a] + w[b]) * 0.62 + 34;
          if (d < minD) {
            const push = (minD - d) * 0.5;
            xs[a] -= (dx / d) * push; ys[a] -= (dy / d) * push;
            xs[b] += (dx / d) * push; ys[b] += (dy / d) * push;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
  }
  let best = Infinity;
  for (let r = 0; r < 11; r++) {
    runOnce();
    settle();
    const s = scoreRun();
    if (s < best) { best = s; for (let i = 0; i < n; i++) { bestXs[i] = xs[i]; bestYs[i] = ys[i]; } }
  }
  for (let i = 0; i < n; i++) { xs[i] = bestXs[i]; ys[i] = bestYs[i]; }
  let minX = Infinity, minY = Infinity;
  for (let i = 0; i < n; i++) {
    minX = Math.min(minX, xs[i] - nodes[i]._w / 2);
    minY = Math.min(minY, ys[i] - nodes[i]._h / 2);
  }
  for (let i = 0; i < n; i++) { nodes[i].x = xs[i] - nodes[i]._w / 2 - minX; nodes[i].y = ys[i] - nodes[i]._h / 2 - minY; }
}

// ---------- edge geometry ----------

const r2 = (v) => Math.round(v * 100) / 100;

function cubicPoint(p0, c1, c2, p1, t) {
  const u = 1 - t;
  return {
    x: u * u * u * p0.x + 3 * u * u * t * c1.x + 3 * u * t * t * c2.x + t * t * t * p1.x,
    y: u * u * u * p0.y + 3 * u * u * t * c1.y + 3 * u * t * t * c2.y + t * t * t * p1.y,
  };
}

function arrowGeom(px, py, angle, closed) {
  const L = 11, W = 5.5;
  const dirX = Math.cos(angle), dirY = Math.sin(angle);
  const nx = -dirY, ny = dirX;
  const bx = px - dirX * L, by = py - dirY * L;
  if (closed) {
    return {
      closed: true,
      pts: [[Math.round(px), Math.round(py)],
        [Math.round(bx + nx * W), Math.round(by + ny * W)],
        [Math.round(bx - nx * W), Math.round(by - ny * W)]],
    };
  }
  return {
    closed: false,
    lines: [[[Math.round(px), Math.round(py)], [Math.round(bx + nx * W), Math.round(by + ny * W)]],
            [[Math.round(px), Math.round(py)], [Math.round(bx - nx * W), Math.round(by - ny * W)]]],
  };
}

function setArrows(e, endAngle, startPt) {
  const tips = [];
  const push = (x, y, a, closed) => {
    const g = arrowGeom(x, y, a, closed);
    if (closed) tips.push({ closed: true, pts: g.pts });
    else tips.push({ closed: false, lines: g.lines });
  };
  if (e.arrow === "end" || e.arrow === "both") push(e.geom.p1.x, e.geom.p1.y, endAngle, true);
  if (e.arrow === "open") push(e.geom.p1.x, e.geom.p1.y, endAngle, false);
  if (e.arrow === "both" || e.arrow === "start") push(startPt.x, startPt.y, endAngle + Math.PI, true);
  e.geom.arrow = tips.length ? tips : null;
}

const boxOf = (n) => ({ x: n.x, y: n.y, w: n._w, h: n._h });

function sCurveGeom(graph, e, horizontal) {
  const s = graph._byId.get(e.from), t = graph._byId.get(e.to);
  if (!s || !t) return null;
  const sc = { x: s.x + s._w / 2, y: s.y + s._h / 2 };
  const tc = { x: t.x + t._w / 2, y: t.y + t._h / 2 };
  const dx = tc.x - sc.x, dy = tc.y - sc.y;
  const p0 = anchorFor(s.kind, boxOf(s), horizontal ? (dx >= 0 ? "r" : "l") : (dy >= 0 ? "b" : "t"));
  const p1 = anchorFor(t.kind, boxOf(t), horizontal ? (dx >= 0 ? "l" : "r") : (dy >= 0 ? "t" : "b"));
  const dist = horizontal ? Math.max(40, Math.abs(dx)) : Math.max(40, Math.abs(dy));
  let c1, c2;
  if (horizontal) {
    const kx = Math.min(0.42, 120 / dist);
    c1 = { x: p0.x + Math.sign(dx || 1) * dist * kx, y: p0.y };
    c2 = { x: p1.x - Math.sign(dx || 1) * dist * kx, y: p1.y };
  } else {
    const ky = Math.min(0.42, 120 / dist);
    c1 = { x: p0.x, y: p0.y + Math.sign(dy || 1) * dist * ky };
    c2 = { x: p1.x, y: p1.y - Math.sign(dy || 1) * dist * ky };
  }
  const d = `M ${r2(p0.x)} ${r2(p0.y)} C ${r2(c1.x)} ${r2(c1.y)} ${r2(c2.x)} ${r2(c2.y)} ${r2(p1.x)} ${r2(p1.y)}`;
  const mid = cubicPoint(p0, c1, c2, p1, 0.5);
  const endAngle = Math.atan2(p1.y - c2.y, p1.x - c2.x);
  const g = { p0, p1, mid, lbl: { x: mid.x, y: mid.y - 10 }, ang: endAngle, d };
  e.geom = g;
  setArrows(e, endAngle, p0);
}

function roundedElbowD(pts, r) {
  if (pts.length < 3) {
    return pts.map((p, i) => `${i ? "L" : "M"} ${r2(p.x)} ${r2(p.y)}`).join(" ");
  }
  let d = `M ${r2(pts[0].x)} ${r2(pts[0].y)}`;
  for (let i = 1; i < pts.length - 1; i++) {
    const a = pts[i - 1], b = pts[i], c = pts[i + 1];
    const v1x = b.x - a.x, v1y = b.y - a.y;
    const v2x = c.x - b.x, v2y = c.y - b.y;
    const l1 = Math.hypot(v1x, v1y), l2 = Math.hypot(v2x, v2y);
    const rr = Math.min(r, l1 / 2, l2 / 2);
    const q0 = { x: b.x - (v1x / l1) * rr, y: b.y - (v1y / l1) * rr };
    const q1 = { x: b.x + (v2x / l2) * rr, y: b.y + (v2y / l2) * rr };
    d += ` L ${r2(q0.x)} ${r2(q0.y)} Q ${r2(b.x)} ${r2(b.y)} ${r2(q1.x)} ${r2(q1.y)}`;
  }
  const last = pts[pts.length - 1];
  d += ` L ${r2(last.x)} ${r2(last.y)}`;
  return d;
}

// TB ortho edges: parent bottom → rail → child top (rounded corners)
function orthoVGeom(graph, e) {
  const s = graph._byId.get(e.from), t = graph._byId.get(e.to);
  if (!s || !t) return null;
  const p0 = anchorFor(s.kind, boxOf(s), "b");
  const p1 = anchorFor(t.kind, boxOf(t), "t");
  const midY = (p0.y + p1.y) / 2;
  const pts = [p0, { x: p0.x, y: midY }, { x: p1.x, y: midY }, p1];
  const g = { p0, p1, mid: { x: (p0.x + p1.x) / 2, y: midY }, lbl: { x: (p0.x + p1.x) / 2, y: midY - 10 }, ang: Math.PI / 2, d: roundedElbowD(pts, 9) };
  e.geom = g;
  setArrows(e, Math.PI / 2, p0);
}

function straightGeom(graph, e) {
  const s = graph._byId.get(e.from), t = graph._byId.get(e.to);
  if (!s || !t) return null;
  const sc = { x: s.x + s._w / 2, y: s.y + s._h / 2 };
  const tc = { x: t.x + t._w / 2, y: t.y + t._h / 2 };
  const dx = tc.x - sc.x, dy = tc.y - sc.y;
  const h = Math.abs(dx) >= Math.abs(dy);
  const side0 = h ? (dx >= 0 ? "r" : "l") : (dy >= 0 ? "b" : "t");
  const side1 = h ? (dx >= 0 ? "l" : "r") : (dy >= 0 ? "t" : "b");
  const p0 = anchorFor(s.kind, boxOf(s), side0);
  const p1 = anchorFor(t.kind, boxOf(t), side1);
  const ang = Math.atan2(p1.y - p0.y, p1.x - p0.x);
  const g = { p0, p1, mid: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 }, lbl: { x: (p0.x + p1.x) / 2, y: (p0.y + p1.y) / 2 - 10 }, ang, d: `M ${r2(p0.x)} ${r2(p0.y)} L ${r2(p1.x)} ${r2(p1.y)}` };
  e.geom = g;
  setArrows(e, ang, p0);
}

export function buildEdgeGeometry(graph, mode) {
  for (const e of graph.edges) {
    if (mode === "s-h" || mode === "s-v") sCurveGeom(graph, e, mode === "s-h");
    else if (mode === "ortho-v") orthoVGeom(graph, e);
    else straightGeom(graph, e);
  }
}

// ---------- sequence layout ----------

export function layoutSequence(graph, theme) {
  const measure = makeMeasure();
  const applyCase = (s) => theme.case === "upper" ? s.toUpperCase() : s;
  const actors = graph.actors;
  for (const a of actors) {
    a._label = applyCase(a.label);
    a._w = Math.max(86, measure(a._label, theme.f.main) + 38);
  }
  const totalW = actors.reduce((s, a) => s + a._w, 0);
  const minW = Math.max(560, totalW + (actors.length + 1) * 72);
  const extra = Math.max(0, (minW - totalW) / (actors.length + 1));
  let x = extra;
  const W = [];
  for (const a of actors) { a.x = x + a._w / 2; x += a._w + extra; }
  W.push(x);
  const headH = 96;
  const rowH = 64;
  const bottom = 60;
  const H = headH + graph.messages.length * rowH + bottom;
  graph.messages.forEach((m, i) => { m.y = headH + i * rowH + rowH * 0.5; });
  graph._seqW = W[0];
  graph._seqH = H;
  return actors;
}

// ---------- top-level dispatch ----------

export function contentBox(nodes, edges) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const n of nodes) {
    minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
    maxX = Math.max(maxX, n.x + n._w); maxY = Math.max(maxY, n.y + n._h);
  }
  for (const e of edges) {
    const g = e.geom;
    if (!g || !e.label) continue;
    minY = Math.min(minY, g.lbl.y - 30);
    maxY = Math.max(maxY, g.lbl.y + 6);
  }
  if (!isFinite(minX)) { minX = 0; minY = 0; maxX = 220; maxY = 140; }
  return { minX, minY, maxX, maxY };
}

export function layoutGraph(graph, theme, dirOverride) {
  const dir = dirOverride === "TB" || graph.direction === "TB" ? "TB" : dirOverride === "LR" || graph.direction === "LR" ? "LR" : null;
  switch (graph.type) {
    case "mindmap":
      layoutTreeGraph(graph, theme, "LR");
      buildEdgeGeometry(graph, "s-h");
      return [];
    case "tree":
      layoutTreeGraph(graph, theme, dir || "TB");
      buildEdgeGeometry(graph, dir === "LR" ? "s-h" : "ortho-v");
      return [];
    case "architecture": {
      const bands = layoutArchitecture(graph, theme);
      buildEdgeGeometry(graph, "s-h");
      return bands;
    }
    case "network":
      layoutForce(graph, theme);
      buildEdgeGeometry(graph, "straight");
      return [];
    case "sequence":
      layoutSequence(graph, theme);
      return [];
    case "flowchart":
    default:
      layoutLayered(graph, theme, dir || "LR");
      buildEdgeGeometry(graph, dir === "TB" ? "s-v" : "s-h");
      return [];
  }
}
