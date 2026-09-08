import { clamp, pick, $ } from "./util.js";
import { clonePlan, addNode, addWire, removeNode, removeWire, nodeById, loopsOf } from "./model.js";
import { CATEGORIES, PORT_TYPES } from "./content.js";

const NODE_W = 208;
const CAT_FALLBACK = { color: "#475569", dot: "#64748b" };
const TYPE_FALLBACK = { color: "#94a3b8" };

const toolHints = {
  select: "Click to select · drag a box to move it · pull a wire from a ● dot · drag the background to marquee",
  pan: "Drag to pan the board · scroll to pan · Ctrl+scroll to zoom",
  note: "Click anywhere on the board to drop a sticky note",
};

export class Editor {
  constructor(stageEl, opts = {}) {
    this.stageEl = stageEl;
    this.plan = opts.plan || { nodes: [], wires: [], meta: {} };
    this.onChange = opts.onChange || (() => {});
    this.onHint = opts.onHint || (() => {});
    this.view = { x: 40, y: 20, zoom: 0.9 };
    this.tool = "select";
    this.sel = new Set();
    this.selW = new Set();
    this.history = [clonePlan(this.plan)];
    this.histPos = 0;
    this._anchors = new Map();
    this._nodeH = new Map();
    this._gesture = null;
    this._stagger = 0;
    this._buildDom();
    this._bind();
  }

  /* ---------------- DOM shell ---------------- */

  _buildDom() {
    const vp = document.createElement("div");
    vp.id = "viewport";
    vp.innerHTML =
      '<div id="plane">' +
      '<svg id="wireSvg" width="100" height="100"></svg>' +
      '<div id="nodeLayer"></div>' +
      "</div>" +
      '<div id="marquee"></div>';
    this.stageEl.insertBefore(vp, this.stageEl.firstChild);
    this.vp = vp;
    this.plane = $("#plane", vp);
    this.svg = $("#wireSvg", vp);
    this.nodeLayer = $("#nodeLayer", vp);
    this.marquee = $("#marquee", vp);

    this._tempWire = document.createElementNS("http://www.w3.org/2000/svg", "path");
    this._tempWire.setAttribute("class", "wire-temp");
    this._tempWire.setAttribute("d", "");
    this._tempWire.style.display = "none";
    this.svg.appendChild(this._tempWire);
  }

  _bind() {
    this.vp.addEventListener("pointerdown", (e) => this._bgDown(e));
    this.vp.addEventListener("wheel", (e) => this._wheel(e), { passive: false });
    window.addEventListener("pointermove", (e) => this._onMove(e));
    window.addEventListener("pointerup", (e) => this._onUp(e));
    this._ro = new ResizeObserver(() => this._geometry());
    this._ro.observe(this.stageEl);
  }

  /* ---------------- public helpers ---------------- */

  get selNodes() {
    return this.plan.nodes.filter((n) => this.sel.has(n.id));
  }
  get selWires() {
    return this.plan.wires.filter((w) => this.selW.has(w.id));
  }

  stats() {
    const loops = loopsOf(this.plan);
    return {
      nodes: this.plan.nodes.length,
      wires: this.plan.wires.length,
      loops: loops.sccs.filter((c) => c.length > 1 || this.plan.wires.some((w) => w.src.n === c[0] && w.dst.n === c[0])).length,
      loopNodes: loops.loopNodes,
    };
  }

  world(clientX, clientY) {
    const r = this.vp.getBoundingClientRect();
    return this.worldFromScreen(clientX - r.left, clientY - r.top);
  }
  worldFromScreen(sx, sy) {
    const z = this.view.zoom;
    return { x: (sx - this.view.x) / z, y: (sy - this.view.y) / z };
  }

  screenCenter() {
    const r = this.vp.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }

  hint(text) {
    this.onHint(text != null ? text : toolHints[this.tool] || "");
  }

  /* ---------------- view / zoom / pan ---------------- */

  _applyView() {
    this.plane.style.transform = `translate(${this.view.x}px, ${this.view.y}px) scale(${this.view.zoom})`;
    this._geometry();
  }

  _geometry() {
    const vw = this.vp.clientWidth || 100;
    const vh = this.vp.clientHeight || 100;
    const z = this.view.zoom;
    let maxX = 0, maxY = 0;
    for (const n of this.plan.nodes) {
      maxX = Math.max(maxX, n.x + NODE_W + 60);
      maxY = Math.max(maxY, n.y + (this._nodeH.get(n.id) || 90) + 60);
    }
    const w = Math.max(vw / z + 40, maxX + 160);
    const h = Math.max(vh / z + 40, maxY + 160);
    this.plane.style.width = w + "px";
    this.plane.style.height = h + "px";
    this.svg.setAttribute("width", w);
    this.svg.setAttribute("height", h);
  }

  zoomBy(factor, clientPt) {
    const r = this.vp.getBoundingClientRect();
    const cx = clientPt ? clientPt.x - r.left : r.width / 2;
    const cy = clientPt ? clientPt.y - r.top : r.height / 2;
    const z = clamp(this.view.zoom * factor, 0.12, 2.4);
    const wz = this.worldFromScreen(cx, cy);
    this.view.zoom = z;
    this.view.x = cx - wz.x * z;
    this.view.y = cy - wz.y * z;
    this._applyView();
    this.onChange("view");
  }

  zoomIn() {
    this.zoomBy(1.25);
  }
  zoomOut() {
    this.zoomBy(0.8);
  }

  fit() {
    const r = this.vp.getBoundingClientRect();
    const vw = r.width, vh = r.height;
    const nodes = this.plan.nodes;
    if (!nodes.length) {
      this.view.zoom = 0.9;
      this.view.x = 40;
      this.view.y = 20;
      this._applyView();
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const n of nodes) {
      minX = Math.min(minX, n.x);
      minY = Math.min(minY, n.y);
      maxX = Math.max(maxX, n.x + NODE_W);
      maxY = Math.max(maxY, n.y + (this._nodeH.get(n.id) || 90));
    }
    const bw = maxX - minX, bh = maxY - minY;
    let z = clamp(Math.min(vw / (bw + 140), vh / (bh + 140)) * 0.94, 0.12, 1.6);
    this.view.zoom = z;
    this.view.x = (vw - (bw + 60) * z) / 2 - minX * z + 10;
    this.view.y = (vh - (bh + 40) * z) / 2 - minY * z + 10;
    this._applyView();
    this.onChange("view");
  }

  _wheel(e) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const f = Math.exp(-e.deltaY * 0.0022);
      this.zoomBy(f, { x: e.clientX, y: e.clientY });
    } else {
      this.view.x -= e.deltaX || 0;
      this.view.y -= e.deltaY;
      this._applyView();
      this.onChange("view");
    }
  }

  centerWorld(pt) {
    const r = this.vp.getBoundingClientRect();
    this.view.x = r.width / 2 - pt.x * this.view.zoom;
    this.view.y = r.height / 2 - pt.y * this.view.zoom;
    this._applyView();
  }

  /* ---------------- selection ---------------- */

  _paintSel() {
    for (const card of this.nodeLayer.children) {
      const id = card.dataset.id;
      card.classList.toggle("sel", this.sel.has(id));
    }
    this._redrawWires();
  }

  clearSel() {
    this.sel.clear();
    this.selW.clear();
    this._paintSel();
  }

  selectNode(id, additive) {
    if (!additive) this.selW.clear();
    this.sel.add(id);
    this._paintSel();
  }

  selectNodes(ids, additive) {
    if (!additive) this.selW.clear();
    for (const id of ids) this.sel.add(id);
    this._paintSel();
  }

  selectWire(wid, additive) {
    if (!additive) this.sel.clear();
    this.selW.add(wid);
    this._paintSel();
  }

  selectAllNodes() {
    this.selW.clear();
    for (const n of this.plan.nodes) this.sel.add(n.id);
    this._paintSel();
  }

  focusNode(id) {
    this.sel.clear();
    this.selW.clear();
    this.sel.add(id);
    this._paintSel();
  }

  /* ---------------- history ---------------- */

  record() {
    this.history = this.history.slice(0, this.histPos + 1);
    this.history.push(clonePlan(this.plan));
    if (this.history.length > 150) this.history.shift();
    this.histPos = this.history.length - 1;
  }

  undo() {
    if (this.histPos <= 0) return false;
    this.histPos--;
    this._loadHist();
    return true;
  }

  redo() {
    if (this.histPos >= this.history.length - 1) return false;
    this.histPos++;
    this._loadHist();
    return true;
  }

  _loadHist() {
    this.plan = clonePlan(this.history[this.histPos]);
    this.sel.clear();
    this.selW.clear();
    this.render();
    this.onChange("undo");
  }

  canUndo() {
    return this.histPos > 0;
  }
  canRedo() {
    return this.histPos < this.history.length - 1;
  }

  replacePlan(newPlan) {
    this.plan = clonePlan(newPlan);
    this.sel.clear();
    this.selW.clear();
    this.record();
    this.render();
    this.onChange("replace");
  }

  /* ---------------- rendering ---------------- */

  render() {
    this.nodeLayer.innerHTML = "";
    for (const n of this.plan.nodes) this.nodeLayer.appendChild(this._buildCard(n));
    this._measure();
    this._paintSel();
    this._geometry();
  }

  _cat(node) {
    return CATEGORIES[node.category] || CAT_FALLBACK;
  }

  _buildCard(n) {
    const el = document.createElement("div");
    el.className = "node-card";
    el.dataset.id = n.id;
    el.style.left = n.x + "px";
    el.style.top = n.y + "px";
    el.style.width = NODE_W + "px";

    el.addEventListener("pointerdown", (e) => this._cardDown(e, n));
    if (n.note) {
      const body = document.createElement("div");
      body.className = "note-body";
      body.textContent = n.title || "Note";
      el.appendChild(body);
      el.classList.add("note-card");
    } else {
      const cat = this._cat(n);
      const head = document.createElement("div");
      head.className = "card-head";
      head.style.background = cat.color;
      const t = document.createElement("span");
      t.className = "card-title";
      t.textContent = n.title || "Untitled component";
      head.appendChild(t);
      if (n.kind) {
        const k = document.createElement("span");
        k.className = "card-kind";
        k.textContent = n.kind;
        head.appendChild(k);
      }
      el.appendChild(head);

      if (n.desc) {
        const d = document.createElement("div");
        d.className = "card-desc";
        d.textContent = n.desc;
        el.appendChild(d);
      }

      const rows = document.createElement("div");
      rows.className = "port-rows";
      const max = Math.max(n.inputs.length, n.outputs.length);
      for (let i = 0; i < max; i++) {
        const row = document.createElement("div");
        row.className = "port-row";
        const ic = document.createElement("div");
        ic.className = "in-cell";
        const inp = n.inputs[i];
        if (inp) {
          const dot = this._mkDot(n, "in", i, inp);
          ic.appendChild(dot);
          const lab = document.createElement("span");
          lab.className = "port-label";
          lab.textContent = inp.label;
          ic.appendChild(lab);
        }
        const oc = document.createElement("div");
        oc.className = "out-cell";
        const outp = n.outputs[i];
        if (outp) {
          const lab = document.createElement("span");
          lab.className = "port-label";
          lab.textContent = outp.label;
          oc.appendChild(lab);
          const dot = this._mkDot(n, "out", i, outp);
          oc.appendChild(dot);
        }
        row.appendChild(ic);
        row.appendChild(oc);
        rows.appendChild(row);
      }
      el.appendChild(rows);
    }
    return el;
  }

  _mkDot(n, side, idx, port) {
    const dot = document.createElement("span");
    dot.className = "port-dot";
    dot.dataset.side = side;
    dot.dataset.idx = idx;
    dot.dataset.id = n.id;
    const tc = PORT_TYPES[port.type] || TYPE_FALLBACK;
    dot.style.setProperty("--dotc", tc.color);
    dot.addEventListener("pointerdown", (e) => this._dotDown(e, side, idx, n));
    return dot;
  }

  _measure() {
    this._anchors.clear();
    this._nodeH.clear();
    const pr = this.plane.getBoundingClientRect();
    const z = this.view.zoom;
    for (const card of this.nodeLayer.children) {
      const id = card.dataset.id;
      const node = nodeById(this.plan, id);
      if (!node) continue;
      this._nodeH.set(id, card.offsetHeight);
      const ins = [], outs = [];
      for (const dot of card.querySelectorAll(".port-dot")) {
        const r = dot.getBoundingClientRect();
        const wx = (r.left - pr.left + r.width / 2) / z;
        const wy = (r.top - pr.top + r.height / 2) / z;
        const a = { x: wx - node.x, y: wy - node.y };
        (dot.dataset.side === "out" ? outs : ins)[+dot.dataset.idx] = a;
      }
      this._anchors.set(id, { ins, outs });
    }
  }

  _portPos(nodeId, side, idx) {
    const node = nodeById(this.plan, nodeId);
    const a = this._anchors.get(nodeId);
    if (!node || !a) return null;
    const off = (side === "out" ? a.outs : a.ins)[idx];
    if (!off) return null;
    return { x: node.x + off.x, y: node.y + off.y };
  }

  _curve(sx, sy, dx, dy) {
    const spanX = dx - sx;
    let bend;
    if (Math.abs(spanX) < 24) bend = 46;
    else bend = clamp(Math.abs(spanX) * 0.55, 28, 170) * Math.sign(spanX);
    const c1x = sx + bend, c2x = dx - bend;
    return `M ${sx} ${sy} C ${c1x} ${sy}, ${c2x} ${dy}, ${dx} ${dy}`;
  }

  _arrow(sx, sy, dx, dy, col) {
    const spanX = dx - sx;
    const dirX = Math.abs(spanX) < 24 ? 1 : Math.sign(spanX);
    const len = 9, half = 4;
    const p = document.createElementNS("http://www.w3.org/2000/svg", "path");
    p.setAttribute("class", "wire-arrow");
    const tipX = dx - dirX * 4;
    p.setAttribute("d", `M ${tipX} ${dy} l ${-dirX * len} ${-half} l 0 ${half * 2} z`);
    p.setAttribute("fill", col);
    return p;
  }

  _redrawWires() {
    this.svg.innerHTML = "";
    this.svg.appendChild(this._tempWire);
    for (const w of this.plan.wires) {
      const s = this._portPos(w.src.n, "out", w.src.o);
      const d = this._portPos(w.dst.n, "in", w.dst.i);
      if (!s || !d) continue;
      const srcNode = nodeById(this.plan, w.src.n);
      const srcPort = srcNode && srcNode.outputs[w.src.o];
      const col = (srcPort && PORT_TYPES[srcPort.type] ? PORT_TYPES[srcPort.type].color : TYPE_FALLBACK.color);
      const sel = this.selW.has(w.id);
      const vis = document.createElementNS("http://www.w3.org/2000/svg", "path");
      vis.setAttribute("class", "wire-vis");
      vis.setAttribute("d", this._curve(s.x, s.y, d.x, d.y));
      vis.setAttribute("fill", "none");
      vis.setAttribute("stroke", sel ? "#1e3a8a" : col);
      vis.setAttribute("stroke-width", sel ? 3.4 : 2);
      if (sel) vis.setAttribute("opacity", "0.92");
      this.svg.appendChild(vis);
      if (!sel) this.svg.appendChild(this._arrow(s.x, s.y, d.x, d.y, col));
      else this.svg.appendChild(this._arrow(s.x, s.y, d.x, d.y, "#1e3a8a"));
      const hit = document.createElementNS("http://www.w3.org/2000/svg", "path");
      hit.setAttribute("class", "wire-hit");
      hit.setAttribute("d", this._curve(s.x, s.y, d.x, d.y));
      hit.dataset.wid = w.id;
      hit.style.stroke = "none";
      hit.addEventListener("pointerdown", (e) => this._wireDown(e, w));
      this.svg.appendChild(hit);
    }
  }

  updateNodeView(id) {
    const node = nodeById(this.plan, id);
    const card = this.nodeLayer.querySelector(`[data-id="${id}"]`);
    if (!node || !card) return;
    if (node.note) {
      const b = card.querySelector(".note-body");
      if (b) b.textContent = node.title || "Note";
    } else {
      const t = card.querySelector(".card-title");
      if (t) t.textContent = node.title || "Untitled component";
      const cat = this._cat(node);
      const h = card.querySelector(".card-head");
      if (h) h.style.background = cat.color;
    }
  }

  _cardEl(id) {
    return this.nodeLayer.querySelector(`[data-id="${id}"]`);
  }

  /* ---------------- model mutations ---------------- */

  addNodeLike(def, at) {
    const n = addNode(this.plan, {
      category: def.category || "software",
      title: def.title != null ? def.title : pick(def.t || ["Component"]),
      kind: def.kind || "",
      desc: def.desc != null ? def.desc : pick(def.d || [""]),
      inputs: def.in || [],
      outputs: def.out || [],
      x: at.x,
      y: at.y,
      w: NODE_W,
    });
    this._stagger = (this._stagger + 1) % 4;
    n.x += this._stagger * 26;
    n.y += this._stagger * 26;
    this.record();
    this.render();
    this.focusNode(n.id);
    this.onChange("add");
    return n;
  }

  addNodeObject(obj, at) {
    const { id, ...rest } = obj;
    const n = addNode(this.plan, { ...rest, x: at.x, y: at.y, w: NODE_W });
    this._stagger = (this._stagger + 1) % 4;
    n.x += this._stagger * 26;
    n.y += this._stagger * 26;
    this.record();
    this.render();
    this.focusNode(n.id);
    this.onChange("add");
    return n;
  }

  addNodeQuiet(patch) {
    return addNode(this.plan, patch);
  }

  addWireQuiet(srcN, srcO, dstN, dstI) {
    return addWire(this.plan, srcN, srcO, dstN, dstI);
  }

  addNote(at) {
    const n = addNode(this.plan, {
      category: "human",
      title: "Note",
      kind: "",
      desc: "",
      note: true,
      inputs: [],
      outputs: [],
      x: at.x,
      y: at.y,
      w: 170,
    });
    this.record();
    this.render();
    this.focusNode(n.id);
    this.onChange("add");
    return n;
  }

  deleteSelection() {
    const nodeIds = this.selNodes.map((n) => n.id);
    const wireIds = this.selWires.map((w) => w.id);
    if (!nodeIds.length && !wireIds.length) return;
    for (const id of wireIds) removeWire(this.plan, id);
    for (const id of nodeIds) removeNode(this.plan, id);
    this.sel.clear();
    this.selW.clear();
    this.record();
    this.render();
    this.onChange("remove");
  }

  duplicateSelection() {
    const nodes = this.selNodes;
    if (!nodes.length) return;
    const idMap = new Map();
    const added = [];
    for (const n of nodes) {
      const { id, ...rest } = n;
      const copy = addNode(this.plan, { ...rest, x: n.x + 30, y: n.y + 30 });
      idMap.set(id, copy.id);
      added.push(copy);
    }
    const selIds = new Set(nodes.map((n) => n.id));
    for (const w of this.plan.wires) {
      if (selIds.has(w.src.n) && selIds.has(w.dst.n)) {
        addWire(this.plan, idMap.get(w.src.n), w.src.o, idMap.get(w.dst.n), w.dst.i);
      }
    }
    this.sel.clear();
    this.selW.clear();
    for (const c of added) this.sel.add(c.id);
    this.record();
    this.render();
    this.onChange("duplicate");
  }

  setTool(tool) {
    this.tool = tool;
    this.hint();
    this.vp.classList.toggle("want-pan", tool === "pan");
  }

  /* ---------------- gestures ---------------- */

  _bgDown(e) {
    if (e.button !== 0 || this._gesture) return;
    const g = (this._gesture = {
      mode: null,
      startClient: { x: e.clientX, y: e.clientY },
      additive: e.shiftKey || e.ctrlKey || e.metaKey,
    });
    if (this.tool === "pan") this._panStart(g);
    else if (this.tool === "note") {
      this._gesture = null;
      const at = this.world(e.clientX, e.clientY);
      this.addNote(at);
    } else this._marqueeStart(g);
  }

  _cardDown(e, node) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (this.tool === "pan") {
      this._bgDown(e);
      return;
    }
    if (this.tool !== "select") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (this.sel.has(node.id)) this.sel.delete(node.id);
      else this.sel.add(node.id);
      this._paintSel();
    } else if (!this.sel.has(node.id)) {
      this.selW.clear();
      this.sel.clear();
      this.sel.add(node.id);
      this._paintSel();
    }
    const g = (this._gesture = {
      mode: "move",
      startClient: { x: e.clientX, y: e.clientY },
      startWorld: this.world(e.clientX, e.clientY),
      started: false,
    });
    g.orig = this.selNodes.map((n) => [n, n.x, n.y]);
  }

  _dotDown(e, side, idx, node) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (this.tool !== "select") return;
    this._gesture = {
      mode: "wire",
      side,
      idx,
      node,
      startClient: { x: e.clientX, y: e.clientY },
      target: null,
      orig: this.selNodes.map((n) => [n, n.x, n.y]),
    };
    this.selW.clear();
    this.sel.clear();
    this.sel.add(node.id);
    this._paintSel();
    const p = this._portPos(node.id, side, idx);
    this._tempWire.setAttribute("d", this._curve(p.x, p.y, p.x, p.y));
    this._tempWire.style.display = "";
    this._tempWire.setAttribute("stroke", "#3b6fe0");
    this.hint("Release on a port of another box to connect · Esc to cancel");
  }

  _wireDown(e, wire) {
    if (e.button !== 0) return;
    e.stopPropagation();
    if (this.tool === "pan") {
      this._bgDown(e);
      return;
    }
    if (this.tool !== "select") return;
    if (e.shiftKey || e.ctrlKey || e.metaKey) {
      if (this.selW.has(wire.id)) this.selW.delete(wire.id);
      else this.selW.add(wire.id);
      if (!this.selW.has(wire.id) && this.selW.size === 0) this.sel.clear();
    } else {
      this.sel.clear();
      this.selW.clear();
      this.selW.add(wire.id);
    }
    this._paintSel();
  }

  _panStart(g) {
    g.mode = "pan";
    this.vp.classList.add("panning");
    this.hint("Drag to pan");
  }

  _marqueeStart(g) {
    g.mode = "marquee";
    this.marquee.style.display = "block";
    const r = this.vp.getBoundingClientRect();
    const x = g.startClient.x - r.left, y = g.startClient.y - r.top;
    this.marquee.style.left = x + "px";
    this.marquee.style.top = y + "px";
    this.marquee.style.width = "0px";
    this.marquee.style.height = "0px";
  }

  _onMove(e) {
    const g = this._gesture;
    if (!g) return;
    if (g.mode === "pan") {
      this.view.x += e.clientX - g.startClient.x;
      this.view.y += e.clientY - g.startClient.y;
      g.startClient = { x: e.clientX, y: e.clientY };
      this._applyView();
      return;
    }
    if (g.mode === "move") {
      const w = this.world(e.clientX, e.clientY);
      const dx = w.x - g.startWorld.x, dy = w.y - g.startWorld.y;
      if (!g.started) {
        const moved = Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y);
        if (moved < 3) return;
        g.started = true;
        this.hint("Move — release to drop");
      }
      for (const [n, ox, oy] of g.orig) {
        n.x = ox + dx;
        n.y = oy + dy;
        const card = this._cardEl(n.id);
        if (card) {
          card.style.left = n.x + "px";
          card.style.top = n.y + "px";
          card.classList.add("moving");
        }
      }
      this._redrawWires();
      return;
    }
    if (g.mode === "marquee") {
      const r = this.vp.getBoundingClientRect();
      const x = Math.min(g.startClient.x, e.clientX) - r.left;
      const y = Math.min(g.startClient.y, e.clientY) - r.top;
      this.marquee.style.left = x + "px";
      this.marquee.style.top = y + "px";
      this.marquee.style.width = Math.abs(e.clientX - g.startClient.x) + "px";
      this.marquee.style.height = Math.abs(e.clientY - g.startClient.y) + "px";
      return;
    }
    if (g.mode === "wire") {
      this._wireMove(e);
    }
  }

  _wireMove(e) {
    const g = this._gesture;
    const w = this.world(e.clientX, e.clientY);
    const from = this._portPos(g.node.id, g.side, g.idx);
    this._tempWire.setAttribute("d", this._curve(from.x, from.y, w.x, w.y));
    this._clearTargetMarks();
    const hit = this._pickPort(e);
    if (hit) {
      g.target = hit;
      const el = this._dotEl(hit.node.id, hit.side, hit.idx);
      const ok = this._portAccept(g, hit);
      if (el) el.classList.toggle(ok ? "valid-target" : "invalid-target", true);
    } else g.target = null;
  }

  _pickPort(e) {
    let best = null, bestDist = 16;
    const r = this.vp.getBoundingClientRect();
    for (const n of this.plan.nodes) {
      if (n.id === this._gesture.node.id) continue;
      const a = this._anchors.get(n.id);
      if (!a) continue;
      const sides = n.note ? [] : [["out", a.outs], ["in", a.ins]];
      for (const [side, arr] of sides) {
        for (let i = 0; i < arr.length; i++) {
          const off = arr[i];
          if (!off) continue;
          const wx = this.view.x + (n.x + off.x) * this.view.zoom;
          const wy = this.view.y + (n.y + off.y) * this.view.zoom;
          const dx = e.clientX - r.left - wx, dy = e.clientY - r.top - wy;
          const dist = Math.hypot(dx, dy);
          if (dist < bestDist) {
            bestDist = dist;
            best = { node: n, side, idx: i };
          }
        }
      }
    }
    return best;
  }

  _portAccept(origin, target) {
    if (origin.node.id === target.node.id) return false;
    if (origin.side === target.side) return false;
    const srcNode = origin.side === "out" ? origin.node : target.node;
    const dstNode = origin.side === "out" ? target.node : origin.node;
    const so = origin.side === "out" ? origin.idx : target.idx;
    const di = origin.side === "out" ? target.idx : origin.idx;
    return !this.plan.wires.some((w) => w.src.n === srcNode.id && w.src.o === so && w.dst.n === dstNode.id && w.dst.i === di);
  }

  _dotEl(nodeId, side, idx) {
    const card = this._cardEl(nodeId);
    if (!card) return null;
    return card.querySelector(`.port-dot[data-side="${side}"][data-idx="${idx}"]`);
  }

  _clearTargetMarks() {
    for (const dot of this.nodeLayer.querySelectorAll(".valid-target,.invalid-target")) {
      dot.classList.remove("valid-target", "invalid-target");
    }
  }

  _onUp(e) {
    const g = this._gesture;
    if (!g) return;
    this._gesture = null;
    if (g.mode === "move") {
      for (const [n] of g.orig) {
        const card = this._cardEl(n.id);
        if (card) card.classList.remove("moving");
      }
      if (g.started) {
        this.record();
        this.render();
        this.onChange("move");
      } else this.onChange("select");
      return;
    }
    if (g.mode === "pan") {
      this.vp.classList.remove("panning");
      return;
    }
    if (g.mode === "marquee") {
      this.marquee.style.display = "none";
      const moved = Math.hypot(e.clientX - g.startClient.x, e.clientY - g.startClient.y);
      if (moved > 3) {
        const a = this.world(g.startClient.x, g.startClient.y);
        const b = this.world(e.clientX, e.clientY);
        const minX = Math.min(a.x, b.x), maxX = Math.max(a.x, b.x);
        const minY = Math.min(a.y, b.y), maxY = Math.max(a.y, b.y);
        const picked = [];
        for (const n of this.plan.nodes) {
          if (n.x + NODE_W >= minX && n.x <= maxX && n.y + (this._nodeH.get(n.id) || 90) >= minY && n.y <= maxY) picked.push(n.id);
        }
        if (!g.additive) this.sel.clear();
        for (const id of picked) this.sel.add(id);
        this.selW.clear();
        this._paintSel();
        this.onChange("select");
      } else if (!g.additive) {
        this.sel.clear();
        this.selW.clear();
        this._paintSel();
        this.onChange("select");
      }
      return;
    }
    if (g.mode === "wire") {
      this._tempWire.style.display = "none";
      this._clearTargetMarks();
      const t = g.target;
      if (t && this._portAccept({ node: g.node, side: g.side, idx: g.idx }, t)) {
        const srcNode = g.side === "out" ? g.node : t.node;
        const dstNode = g.side === "out" ? t.node : g.node;
        const so = g.side === "out" ? g.idx : t.idx;
        const di = g.side === "out" ? t.idx : g.idx;
        const wire = addWire(this.plan, srcNode.id, so, dstNode.id, di);
        if (wire) {
          this.record();
          this.render();
          this.onChange("wire");
          return;
        }
      }
      this.hint();
      this.onChange("select");
    }
  }

  cancelGesture() {
    const g = this._gesture;
    if (!g) {
      if (this.sel.size || this.selW.size) {
        this.clearSel();
        this.onChange("select");
      }
      return;
    }
    this._gesture = null;
    if (g.mode === "move") {
      for (const [n, ox, oy] of g.orig) {
        n.x = ox;
        n.y = oy;
        const card = this._cardEl(n.id);
        if (card) {
          card.style.left = ox + "px";
          card.style.top = oy + "px";
          card.classList.remove("moving");
        }
      }
      this._redrawWires();
      this.render();
    } else if (g.mode === "wire") {
      this._tempWire.style.display = "none";
      this._clearTargetMarks();
    } else if (g.mode === "marquee") {
      this.marquee.style.display = "none";
    } else if (g.mode === "pan") {
      this.vp.classList.remove("panning");
    }
    this.hint();
    this.onChange("select");
  }
}

export { NODE_W };
