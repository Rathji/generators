/* ════════════════════════════════════════════════════════════════════
   BGN HEX FRAMEWORK — SVG board renderer (hexview.js)
   ────────────────────────────────────────────────────────────────────
   Draws a HexBoard + its tokens to an inline SVG, and reports clicks /
   hovers back to the game. Pure presentation: every rule decision
   belongs to HexGame. The game calls render(game, decorations) after
   any state change.

   render(game, dec) decorations (all optional):
     selectedId  string   token id to ring in gold
     reachable   Map      "q,r" -> {cost} — cells the selected token
                          can reach (green, tinted by MP cost)
     range       {center:[q,r], radius} — measurement disk (blue)
     ringCells   Array    [[q,r],...] — ring highlight (purple)
     measure     {a:[q,r], b:[q,r], distance, los} — ruler line
     cellMarks   Array    {cells:[[q,r],...], fill, label}
     hover       [q,r]    cell to outline
     tokenNotes  object   id -> short string (e.g. remaining MP)
   ELEVATION: cells tint lighter the higher they are and darker the
   deeper (water reads naturally bluer below sea level); non-zero
   elevations are labelled in the cell corner (opts.showElev, on by
   default).
   ════════════════════════════════════════════════════════════════════ */
"use strict";

class HexBoardView {
  constructor(container, opts) {
    opts = opts || {};
    this.opts = opts;
    this.hexSize = opts.hexSize || 36;
    this.padding = opts.padding != null ? opts.padding : this.hexSize;
    this.showCoords = opts.showCoords || false;
    this.showElev = opts.showElev !== false;
    this.palette = Object.assign({
      bg: "#161d2b",
      grid: "rgba(255,255,255,.16)",
      terrain: { 0: "#3a5a40" },
      owners: { host: "#e3b341", guest: "#5b8dd6", neutral: "#aeb6c4" },
      reachable: "rgba(76,222,128,.40)",
      reachableDeep: "rgba(76,222,128,.62)",
      range: "rgba(120,150,255,.30)",
      ring: "rgba(200,140,255,.35)",
      arcs: {
        torso: { fill: "rgba(255,215,60,.55)", line: "#ffe600" },
        la:    { fill: "rgba(80,225,205,.42)", line: "#5ae6c9" },
        ra:    { fill: "rgba(255,130,190,.42)", line: "#ff82be" },
        edge:  "rgba(255,255,255,.75)"
      },
      measure: "#ffd76a",
      selected: "#ffd76a",
      text: "#f6ecd2",
      dim: "rgba(6,9,16,.55)"
    }, opts.palette || {});
    this.game = null;
    this.onCellClick = null;
    this.onCellHover = null;
    this.onBoardClick = null;
    this.hovered = null;
    this.host = container;
    this.zoom = 1;
    this.minZoom = 1;
    this.maxZoom = 5;
    this.lastScale = 0;
    this.fitToContainer = false;   // when true, zoom 1 fits BOTH width and height
    this.onZoom = null;

    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "hex-svg");
    this.svg = svg;
    this.defs = document.createElementNS("http://www.w3.org/2000/svg", "defs");
    svg.appendChild(this.defs);
    this.sheet = new Map();   // "q,r" -> {cx, cy, pts}
    container.appendChild(svg);

    svg.addEventListener("click", e => {
      const [q, r] = this.eventToHex(e);
      if (q === null) { if (this.onBoardClick) this.onBoardClick(); return; }
      if (this.onCellClick) this.onCellClick(q, r);
    });
    svg.addEventListener("mousemove", e => {
      const [q, r] = this.eventToHex(e);
      if (this.hovered !== null && q === this.hovered[0] && r === this.hovered[1]) return;
      this.hovered = q === null ? null : [q, r];
      if (this.onCellHover) this.onCellHover(this.hovered);
    });
    svg.addEventListener("mouseleave", () => {
      if (this.hovered !== null) { this.hovered = null; if (this.onCellHover) this.onCellHover(null); }
    });
    this._onResize = () => this._refit();
    window.addEventListener("resize", this._onResize);
  }

  svgEl(tag, attrs, parent) {
    const el = document.createElementNS("http://www.w3.org/2000/svg", tag);
    for (const k in attrs) el.setAttribute(k, attrs[k]);
    (parent || this.svg).appendChild(el);
    return el;
  }

  // Blend a #rrggbb color toward an [r,g,b] target by t∈[0,1].
  _mix(hex, target, t) {
    if (typeof hex !== "string" || !/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
    const n = parseInt(hex.slice(1), 16);
    const r = n >> 16 & 255, g = n >> 8 & 255, b = n & 255;
    return "rgb(" + Math.round(r + (target[0] - r) * t) + "," +
      Math.round(g + (target[1] - g) * t) + "," +
      Math.round(b + (target[2] - b) * t) + ")";
  }

  hexPath(q, r) {
    const s = this.hexSize;
    const [cx, cy] = HexMath.toPixel(q, r, s);
    const pts = [];
    for (let i = 0; i < 6; i++) {
      const a = Math.PI / 180 * (60 * i - 90);
      pts.push((cx + s * Math.cos(a)).toFixed(2) + "," + (cy + s * Math.sin(a)).toFixed(2));
    }
    return { cx, cy, pts: pts.join(" ") };
  }

  bbox() {
    const s = this.hexSize, p = this.padding;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    if (!this.game) return { x0: 0, y0: 0, w: 2 * p, h: 2 * p };
    this.game.board.eachCell(c => {
      const [x, y] = HexMath.toPixel(c.q, c.r, s);
      x0 = Math.min(x0, x - s); y0 = Math.min(y0, y - s);
      x1 = Math.max(x1, x + s); y1 = Math.max(y1, y + s);
    });
    return { x0: x0 - p, y0: y0 - p, w: x1 - x0 + 2 * p, h: y1 - y0 + 2 * p };
  }

  // pixels per world unit at zoom 1 ("fit to container width",
  // or fit to both dimensions when fitToContainer is set)
  _fitScale() {
    const r = this.host.getBoundingClientRect();
    const bb = this.bbox();
    if (!r.width || !bb.w) return 1;
    let s = r.width / bb.w;
    if (this.fitToContainer && r.height) {
      const sh = r.height / bb.h;
      s = Math.min(s, sh);
    }
    return s;
  }

  // Size the SVG element to the current zoom; the viewBox stays the full
  // board, so a bigger element = bigger on-screen content (scrollable via
  // the container's overflow).
  _applySize() {
    const bb = this.bbox();
    const s = this._fitScale() * this.zoom;
    this.lastScale = s;
    this.svg.style.width = Math.round(bb.w * s) + "px";
    this.svg.style.height = Math.round(bb.h * s) + "px";
  }

  // Change zoom; if clientPt {x,y} is given the world point under it stays
  // under the cursor, otherwise the board centre stays put.
  setZoom(z, clientPt) {
    z = Math.min(this.maxZoom, Math.max(this.minZoom, z));
    if (z === this.zoom) return;
    const host = this.host, bb = this.bbox();
    const r = this.svg.getBoundingClientRect();
    const s0 = this.lastScale || this._fitScale() * this.zoom;
    if (!s0) return;
    const wx = clientPt ? bb.x0 + (clientPt.x - r.left) / s0 : bb.x0 + bb.w / 2;
    const wy = clientPt ? bb.y0 + (clientPt.y - r.top) / s0 : bb.y0 + bb.h / 2;
    this.zoom = z;
    this._applySize();
    const hr = host.getBoundingClientRect();
    const nr = this.svg.getBoundingClientRect();
    const cx = clientPt ? clientPt.x : hr.left + hr.width / 2;
    const cy = clientPt ? clientPt.y : hr.top + hr.height / 2;
    let sl = host.scrollLeft + (wx - bb.x0) * this.lastScale - (cx - nr.left);
    let st = host.scrollTop + (wy - bb.y0) * this.lastScale - (cy - nr.top);
    if (sl < 0) sl = 0;
    if (st < 0) st = 0;
    host.scrollLeft = sl;
    host.scrollTop = st;
    if (this.onZoom) this.onZoom();
  }

  // Re-fit after the container resizes, keeping the world point that was
  // at the container centre centred again.
  _refit() {
    const host = this.host;
    const hr = host.getBoundingClientRect();
    if (!hr.width) return;
    const bb = this.bbox();
    const r = this.svg.getBoundingClientRect();
    const s0 = this.lastScale || this._fitScale() * this.zoom;
    if (!s0) { this._applySize(); return; }
    const wx = bb.x0 + (hr.left + hr.width / 2 - r.left) / s0;
    const wy = bb.y0 + (hr.top + hr.height / 2 - r.top) / s0;
    this._applySize();
    const nr = this.svg.getBoundingClientRect();
    let sl = host.scrollLeft + (wx - bb.x0) * this.lastScale - (hr.left + hr.width / 2 - nr.left);
    let st = host.scrollTop + (wy - bb.y0) * this.lastScale - (hr.top + hr.height / 2 - nr.top);
    if (sl < 0) sl = 0;
    if (st < 0) st = 0;
    host.scrollLeft = sl;
    host.scrollTop = st;
  }

  // Pie-wedge path: centre (cx,cy), radius r, compass angles c0→c1
  // (clockwise from north). Sweep is always < 180° for our arcs.
  _sector(cx, cy, r, c0, c1) {
    while (c1 < c0) c1 += 360;
    const rad = d => d * Math.PI / 180;
    const p0 = [cx + r * Math.sin(rad(c0)), cy - r * Math.cos(rad(c0))];
    const p1 = [cx + r * Math.sin(rad(c1)), cy - r * Math.cos(rad(c1))];
    return "M" + cx + "," + cy + " L" + p0[0].toFixed(2) + "," + p0[1].toFixed(2) +
      " A" + r + "," + r + " 0 0 1 " + p1[0].toFixed(2) + "," + p1[1].toFixed(2) + " Z";
  }

  // Firing-arc wedges for a token: three 120° sectors (torso/left arm/
  // right arm) tiled around the token's facing, plus dashed boundary
  // rays so the partition is unmistakable.
  _drawArcs(decG, arcs, pal) {
    const s = this.hexSize;
    const R = arcs.radius != null ? arcs.radius : 21 * Math.sqrt(3) * s;
    const c = this.sheet.get(HexMath.key(arcs.center[0], arcs.center[1]));
    if (!c) return;
    const cx = c.cx, cy = c.cy, f = arcs.facing || 0;
    const segs = [["torso", f - 60, f + 60], ["ra", f + 60, f + 180], ["la", f - 60, f - 180]];
    for (const [arc, a0, a1] of segs) {
      const st = pal.arcs[arc];
      const d = this._sector(cx, cy, R, a0, a1);
      this.svgEl("path", { d, fill: st.fill, "pointer-events": "none" }, decG);
      const rEdge = Math.min(R, 10 * Math.sqrt(3) * s);
      const rLine = Math.min(R, 6.5 * Math.sqrt(3) * s);
      this.svgEl("path", { d: this._sector(cx, cy, rEdge, a0, a1), fill: "none", stroke: st.line, "stroke-width": 2.2, opacity: .95, "pointer-events": "none" }, decG);
      this.svgEl("line", { x1: cx, y1: cy, x2: cx + rLine * Math.sin(a0 * Math.PI / 180), y2: cy - rLine * Math.cos(a0 * Math.PI / 180), stroke: st.line, "stroke-width": 2.4, "stroke-dasharray": "7 6", opacity: .95, "pointer-events": "none" }, decG);
      this.svgEl("line", { x1: cx, y1: cy, x2: cx + rLine * Math.sin(a1 * Math.PI / 180), y2: cy - rLine * Math.cos(a1 * Math.PI / 180), stroke: st.line, "stroke-width": 2.4, "stroke-dasharray": "7 6", opacity: .95, "pointer-events": "none" }, decG);
      const mid = arc === "torso" ? f : arc === "la" ? f - 120 : f + 120;
      const rLbl = 4.4 * Math.sqrt(3) * s;
      let lx = cx + rLbl * Math.sin(mid * Math.PI / 180), ly = cy - rLbl * Math.cos(mid * Math.PI / 180);
      const bb = this.bbox();
      const x0 = bb.x0 + s * 2.2, x1 = bb.x0 + bb.w - s * 2.2;
      const y0 = bb.y0 + s * 2.1, y1 = bb.y0 + bb.h - s * 2.1;
      lx = Math.min(x1, Math.max(x0, lx));
      ly = Math.min(y1, Math.max(y0, ly));
      this.svgEl("text", { x: lx, y: ly + s * 0.16, "text-anchor": "middle", "font-size": s * 0.52, "font-weight": "800", "letter-spacing": ".08em", fill: st.line, stroke: "rgba(8,10,18,.85)", "stroke-width": 3, "paint-order": "stroke", "pointer-events": "none" }, decG).textContent = arc === "torso" ? "TORSO" : arc.toUpperCase();
    }
  }

  render(game, dec) {
    dec = dec || {};
    this.game = game;
    const pal = this.palette;
    while (this.svg.lastChild) this.svg.removeChild(this.svg.lastChild);
    this.defs = this.svgEl("defs", {});
    const bb = this.bbox();
    this.svg.setAttribute("viewBox", bb.x0 + " " + bb.y0 + " " + bb.w + " " + bb.h);
    this._applySize();

    const palShade = c => {
      // slightly darken terrain for depth
      if (typeof c !== "string" || !c.startsWith("#")) return c;
      const n = parseInt(c.slice(1), 16);
      const f = 0.86;
      return "rgb(" + Math.floor((n >> 16 & 255) * f) + "," + Math.floor((n >> 8 & 255) * f) + "," + Math.floor((n & 255) * f) + ")";
    };

    this.sheet = new Map();
    const boardG = this.svgEl("g", { class: "hex-board" });
    this.svgEl("rect", { x: bb.x0, y: bb.y0, width: bb.w, height: bb.h, fill: pal.bg, rx: 10 }, boardG);

    const elevTint = (base, e) => {
      if (!e) return base;
      return e > 0 ? this._mix(base, [242, 246, 250], Math.min(1, e * 0.07))
                   : this._mix(base, [10, 20, 34], Math.min(1, -e * 0.12));
    };
    game.board.eachCell(c => {
      const { cx, cy, pts } = this.hexPath(c.q, c.r);
      this.sheet.set(HexMath.key(c.q, c.r), { cx, cy });
      let fill = pal.terrain[c.terrain] != null ? palShade(pal.terrain[c.terrain]) : pal.terrain[0];
      if (c.elevation != null) fill = elevTint(fill, c.elevation);
      this.svgEl("polygon", { points: pts, fill, stroke: pal.grid, "stroke-width": 1.2 }, boardG);
      const glyph = c.glyph;
      if (glyph) this.svgEl("text", { x: cx, y: cy + this.hexSize * 0.36, "text-anchor": "middle", "font-size": this.hexSize * 0.62, fill: "rgba(255,255,255,.85)", "pointer-events": "none" }, boardG).textContent = glyph;
      if (this.showCoords) this.svgEl("text", { x: cx - this.hexSize * 0.62, y: cy - this.hexSize * 0.55, "font-size": this.hexSize * 0.24, fill: "rgba(255,255,255,.4)", "pointer-events": "none" }, boardG).textContent = c.q + "," + c.r;
      if (this.showElev && c.elevation != null && c.elevation !== 0) {
        this.svgEl("text", { x: cx - this.hexSize * 0.68, y: cy + this.hexSize * 0.52, "font-size": this.hexSize * 0.26, "font-weight": "700", fill: c.elevation < 0 ? "rgba(175,215,255,.85)" : "rgba(255,255,255,.55)", "pointer-events": "none" }, boardG).textContent = (c.elevation > 0 ? "+" : "") + c.elevation;
      }
    });

    // ── decorations ──
    const decG = this.svgEl("g", { class: "hex-decor", "pointer-events": "none" });

    if (dec.arcs) this._drawArcs(decG, dec.arcs, this.palette);

    const fillCells = (cells, fill, labelFn) => {
      for (const [q, r] of cells) {
        if (!this.sheet.has(HexMath.key(q, r))) continue;
        const { cx, cy, pts } = this.hexPath(q, r);
        this.svgEl("polygon", { points: pts, fill, "pointer-events": "none" }, decG);
        if (labelFn) this.svgEl("text", { x: cx, y: cy + this.hexSize * 0.4, "text-anchor": "middle", "font-size": this.hexSize * 0.42, fill: "#fff", "font-weight": "700", "pointer-events": "none" }, decG).textContent = labelFn(q, r);
      }
    };

    if (dec.range) {
      const cells = dec.range.cells || game.board.disk(dec.range.center, dec.range.radius);
      if (dec.range.soft) {
        // soft ring (e.g. a unit's weapon range while moving): dashed
        // outline so it never fights the movement highlights
        for (const [q, rq] of cells) {
          if (!this.sheet.has(HexMath.key(q, rq))) continue;
          const { cx, cy, pts } = this.hexPath(q, rq);
          this.svgEl("polygon", { points: pts, fill: "none", stroke: "rgba(150,185,255,.9)", "stroke-width": 2.4, "stroke-dasharray": "5 4", "pointer-events": "none" }, decG);
        }
      } else {
        fillCells(cells, pal.range);
      }
    }
    if (dec.ringCells && dec.ringCells.length) {
      fillCells(dec.ringCells, pal.ring);
    }
    if (dec.cellMarks) {
      for (const mark of dec.cellMarks) fillCells(mark.cells, mark.fill, mark.label ? (q, r) => mark.label : null);
    }
    // reachable drawn last so movement fills sit on top of range/rings
    if (dec.reachable) {
      dec.reachable.forEach(v => {
        if (v.capture) { fillCells([[v.q, v.r]], "rgba(255,90,90,.45)", () => "⚔"); return; }
        const deep = (v.cost || 0) >= 3;
        fillCells([[v.q, v.r]], deep ? pal.reachableDeep : pal.reachable, () => String(v.cost));
      });
    }
    if (dec.measure && this.sheet.has(HexMath.key(dec.measure.a[0], dec.measure.a[1])) && this.sheet.has(HexMath.key(dec.measure.b[0], dec.measure.b[1]))) {
      const A = this.sheet.get(HexMath.key(dec.measure.a[0], dec.measure.a[1]));
      const B = this.sheet.get(HexMath.key(dec.measure.b[0], dec.measure.b[1]));
      this.svgEl("line", { x1: A.cx, y1: A.cy, x2: B.cx, y2: B.cy, stroke: pal.measure, "stroke-width": 3, "stroke-dasharray": "7 5", "stroke-linecap": "round" }, decG);
      const mx = (A.cx + B.cx) / 2, my = (A.cy + B.cy) / 2;
      this.svgEl("circle", { cx: mx, cy: my, r: this.hexSize * 0.34, fill: pal.measure, stroke: "#161d2b", "stroke-width": 1.5 }, decG);
      this.svgEl("text", { x: mx, y: my + this.hexSize * 0.13, "text-anchor": "middle", "font-size": this.hexSize * 0.34, fill: "#1a1410", "font-weight": "800", "pointer-events": "none" }, decG).textContent = dec.measure.distance + " " + (dec.measure.los ? "· LOS" : "· LOS ✕");
    }

    // ── hover outline ──
    if (dec.hover && this.sheet.has(HexMath.key(dec.hover[0], dec.hover[1]))) {
      const { cx, cy, pts } = this.hexPath(dec.hover[0], dec.hover[1]);
      this.svgEl("polygon", { points: pts, fill: "none", stroke: pal.text, "stroke-width": 2.4, "pointer-events": "none" }, decG);
    }

    // ── tokens ──
    const tokG = this.svgEl("g", { class: "hex-tokens" });
    const ownerColor = o => pal.owners[o] || pal.owners.neutral;
    for (const t of game.tokens) {
      if (!this.sheet.has(HexMath.key(t.q, t.r))) continue;
      const { cx, cy } = this.sheet.get(HexMath.key(t.q, t.r));
      const R = this.hexSize * 0.42;
      const isSel = dec.selectedId === t.id;
      if (isSel) this.svgEl("circle", { cx, cy, r: this.hexSize * 0.88, fill: "none", stroke: pal.selected, "stroke-width": 2.6 }, tokG);
      if (dec.targetId === t.id) this.svgEl("circle", { cx, cy, r: this.hexSize * 0.96, fill: "none", stroke: "#ff5252", "stroke-width": 2.6, "stroke-dasharray": "4 4" }, tokG);
      const g = this.svgEl("g", { transform: "translate(" + cx + "," + cy + ")", "data-token-id": t.id }, tokG);
      g.style.color = ownerColor(t.owner);
      const title = t.name + (t.pilot ? " · " + t.pilot : "") + " (" + (t.owner === "host" ? "Host" : "Guest") + ") · MP " + t.rem + "/" + t.mp + (t.range ? " · Rng " + t.range : "");
      const hit = this.svgEl("circle", { r: t.graphic ? this.hexSize * 0.86 : R + 6, fill: "transparent", "pointer-events": "all" }, g);
      hit.innerHTML = "";
      const tEl = this.svgEl("title", {}, hit); tEl.textContent = title;
      if (t.graphic) {
        const gfx = this.svgEl("g", { transform: "rotate(" + (t.facing || 0) + ") scale(" + ((t.graphicScale || 1) * (R / 12.6)) + ")", "pointer-events": "none", class: "hex-tok-gfx" }, g);
        gfx.innerHTML = t.graphic;
      } else {
        this.svgEl("circle", { r: R, fill: ownerColor(t.owner), stroke: "rgba(0,0,0,.5)", "stroke-width": 2 }, g);
        this.svgEl("circle", { r: R, fill: "none", stroke: "rgba(255,255,255,.28)", "stroke-width": 1, "stroke-dasharray": "3 3" }, g);
        this.svgEl("text", { y: this.hexSize * 0.16, "text-anchor": "middle", "font-size": this.hexSize * 0.5, fill: "#fff", "font-weight": "700", "pointer-events": "none" }, g).textContent = t.icon;
      }
      this.svgEl("circle", { cx: -this.hexSize * 0.87, cy: -this.hexSize * 0.5, r: this.hexSize * 0.17, fill: "rgba(8,10,18,.88)", stroke: "rgba(255,255,255,.4)", "stroke-width": 1, "pointer-events": "none" }, g);
      this.svgEl("text", { x: -this.hexSize * 0.87, y: -this.hexSize * 0.5 + this.hexSize * 0.08, "text-anchor": "middle", "font-size": this.hexSize * 0.24, fill: "#fff", "font-weight": "800", "pointer-events": "none" }, g).textContent = t.icon;
      const note = dec.tokenNotes && dec.tokenNotes[t.id];
      if (note !== undefined) {
        this.svgEl("circle", { cx: this.hexSize * 0.87, cy: this.hexSize * 0.5, r: this.hexSize * 0.17, fill: "rgba(8,10,18,.82)", stroke: "rgba(255,255,255,.35)", "pointer-events": "none" }, g);
        this.svgEl("text", { x: this.hexSize * 0.87, y: this.hexSize * 0.5 + this.hexSize * 0.08, "text-anchor": "middle", "font-size": this.hexSize * 0.24, fill: "#fff", "font-weight": "700", "pointer-events": "none" }, g).textContent = note;
      }
      if (t.twist) {
        const a = (BT.effFacing(t)) * Math.PI / 180;
        const rr = this.hexSize * 0.58;
        const mx = Math.sin(a) * rr, my = -Math.cos(a) * rr;
        const tip = 0.16 * this.hexSize, wing = 0.12 * this.hexSize;
        const p = (mx + Math.sin(a) * tip) + "," + (my - Math.cos(a) * tip) + " " +
                  (mx + Math.sin(a + 2.4) * wing) + "," + (my - Math.cos(a + 2.4) * wing) + " " +
                  (mx + Math.sin(a - 2.4) * wing) + "," + (my - Math.cos(a - 2.4) * wing);
        this.svgEl("polygon", { points: p, fill: "#ffd76a", stroke: "rgba(8,10,18,.9)", "stroke-width": 1.4, "pointer-events": "none" }, g);
      }
    }

    if (dec.dim) this.svgEl("rect", { x: bb.x0, y: bb.y0, width: bb.w, height: bb.h, fill: pal.dim, rx: 10, "pointer-events": "none" }, this.svgEl("g", {}));
  }

  // Convert a DOM event to board coords (or [null,null]).
  eventToHex(e) {
    const r = this.svg.getBoundingClientRect();
    const bb = this.bbox();
    const s = this.lastScale || this._fitScale() * this.zoom;
    if (!r.width || !r.height || !s) return [null, null];
    const x = bb.x0 + (e.clientX - r.left) / s;
    const y = bb.y0 + (e.clientY - r.top) / s;
    const [q, rq] = HexMath.fromPixel(x, y, this.hexSize);
    if (!this.game || !this.game.board.has(q, rq)) return [null, null];
    return [q, rq];
  }
}

window.HexBoardView = HexBoardView;
