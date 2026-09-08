import { uid } from "./util.js";

export const PLAN_VERSION = 1;
export const NODE_W = 208;

export const createPlan = () => ({ nodes: [], wires: [], meta: {} });

const normPort = (p) => {
  if (typeof p === "string") return { label: p, type: "data" };
  if (Array.isArray(p)) return { label: p[0] || "", type: p[1] || "data" };
  return { label: p.label || "", type: p.type || "data" };
};

export function makeNode(patch = {}) {
  const n = {
    id: uid("n"),
    category: "software",
    title: "Untitled component",
    kind: "",
    desc: "",
    inputs: [],
    outputs: [],
    x: 60,
    y: 60,
    w: NODE_W,
    note: false,
    ...patch,
  };
  n.inputs = (n.inputs || []).map(normPort);
  n.outputs = (n.outputs || []).map(normPort);
  return n;
}

export const nodeById = (plan, id) => plan.nodes.find((n) => n.id === id);
export const wireById = (plan, id) => plan.wires.find((w) => w.id === id);

export function addNode(plan, node) {
  const n = makeNode(node);
  plan.nodes.push(n);
  return n;
}

export function removeNode(plan, nodeId) {
  plan.nodes = plan.nodes.filter((n) => n.id !== nodeId);
  plan.wires = plan.wires.filter((w) => w.src.n !== nodeId && w.dst.n !== nodeId);
}

export function addWire(plan, srcN, srcO, dstN, dstI) {
  const src = nodeById(plan, srcN), dst = nodeById(plan, dstN);
  if (!src || !dst) return null;
  if (!src.outputs[srcO] || !dst.inputs[dstI]) return null;
  const dup = plan.wires.some((w) => w.src.n === srcN && w.src.o === srcO && w.dst.n === dstN && w.dst.i === dstI);
  if (dup) return null;
  const w = { id: uid("w"), src: { n: srcN, o: srcO }, dst: { n: dstN, i: dstI } };
  plan.wires.push(w);
  return w;
}

export function removeWire(plan, wireId) {
  plan.wires = plan.wires.filter((w) => w.id !== wireId);
}

export function removeWireBetween(plan, srcN, srcO, dstN, dstI) {
  plan.wires = plan.wires.filter((w) => !(w.src.n === srcN && w.src.o === srcO && w.dst.n === dstN && w.dst.i === dstI));
}

export function wiresOfNode(plan, id) {
  return plan.wires.filter((w) => w.src.n === id || w.dst.n === id);
}

export function trimBrokenWires(plan) {
  plan.wires = plan.wires.filter((w) => {
    const s = nodeById(plan, w.src.n), d = nodeById(plan, w.dst.n);
    return s && d && s.outputs[w.src.o] && d.inputs[w.dst.i];
  });
}

export function inWires(plan, nodeId) { return plan.wires.filter((w) => w.dst.n === nodeId); }
export function outWires(plan, nodeId) { return plan.wires.filter((w) => w.src.n === nodeId); }

export const clonePlan = (plan) => JSON.parse(JSON.stringify(plan));

export function serialize(plan) {
  return JSON.stringify({ app: "sys-plan", version: PLAN_VERSION, ts: Date.now(), plan: { nodes: plan.nodes, wires: plan.wires, meta: plan.meta || {} } });
}

export function parsePlan(text) {
  const o = JSON.parse(text);
  const p = (o && o.plan) || o;
  if (!p || !Array.isArray(p.nodes)) throw new Error("Not a sys-plan file");
  const plan = createPlan();
  plan.meta = p.meta || {};
  for (const raw of p.nodes) {
    const n = makeNode(raw);
    n.x = Number.isFinite(n.x) ? n.x : 60;
    n.y = Number.isFinite(n.y) ? n.y : 60;
    plan.nodes.push(n);
  }
  for (const w of Array.isArray(p.wires) ? p.wires : []) {
    if (!w || !w.src || !w.dst) continue;
    const src = nodeById(plan, w.src.n), dst = nodeById(plan, w.dst.n);
    if (!src || !dst) continue;
    const so = Number.isInteger(w.src.o) ? w.src.o : 0;
    const di = Number.isInteger(w.dst.i) ? w.dst.i : 0;
    if (src.outputs[so] && dst.inputs[di]) plan.wires.push({ id: uid("w"), src: { n: w.src.n, o: so }, dst: { n: w.dst.n, i: di } });
  }
  return plan;
}

/* ---------- cycle / loop detection (Tarjan SCC on wires) ---------- */
export function loopsOf(plan) {
  const idx = new Map();
  plan.nodes.forEach((n, i) => idx.set(n.id, i));
  const N = plan.nodes.length;
  const g = Array.from({ length: N }, () => []);
  for (const w of plan.wires) {
    const a = idx.get(w.src.n), b = idx.get(w.dst.n);
    if (a !== undefined && b !== undefined) g[a].push(b);
  }
  const index = new Array(N).fill(-1), low = new Array(N).fill(0), onStack = new Array(N).fill(false);
  const stack = [], sccs = [];
  let t = 0;
  const strong = (v) => {
    index[v] = low[v] = t++;
    stack.push(v); onStack[v] = true;
    for (const to of g[v]) {
      if (index[to] === -1) { strong(to); low[v] = Math.min(low[v], low[to]); }
      else if (onStack[to]) low[v] = Math.min(low[v], index[to]);
    }
    if (low[v] === index[v]) {
      const comp = [];
      let u;
      do { u = stack.pop(); onStack[u] = false; comp.push(plan.nodes[u].id); } while (u !== v);
      sccs.push(comp);
    }
  };
  for (let v = 0; v < N; v++) if (index[v] === -1) strong(v);
  const loopNodes = new Set();
  const loopSccs = [];
  for (const comp of sccs) {
    if (comp.length > 1) { comp.forEach((id) => loopNodes.add(id)); loopSccs.push(comp); }
    else {
      const id = comp[0];
      const self = plan.wires.some((w) => w.src.n === id && w.dst.n === id);
      if (self) { loopNodes.add(id); loopSccs.push(comp); }
    }
  }
  const inCycle = (id) => loopNodes.has(id);
  const loopWires = new Set(plan.wires.filter((w) => inCycle(w.src.n) && inCycle(w.dst.n)).map((w) => w.id));
  return { loopNodes, loopWires, sccs: loopSccs };
}

/* Longest-path rank from source-ish nodes; used for left→right layout. */
export function rankNodes(plan) {
  const idx = new Map();
  plan.nodes.forEach((n, i) => idx.set(n.id, i));
  const N = plan.nodes.length;
  const g = Array.from({ length: N }, () => []);
  for (const w of plan.wires) {
    const a = idx.get(w.src.n), b = idx.get(w.dst.n);
    if (a !== undefined && b !== undefined && a !== b) g[a].push(b);
  }
  const indeg = new Array(N).fill(0);
  g.forEach((tos) => tos.forEach((b) => indeg[b]++));
  const rank = new Array(N).fill(0);
  for (let pass = 0; pass < N; pass++) {
    let changed = false;
    for (let v = 0; v < N; v++) {
      const nextRank = rank[v] + 1;
      if (nextRank > N + 5) continue;
      for (const to of g[v]) {
        if (rank[to] < nextRank && nextRank <= N + 2) { rank[to] = nextRank; changed = true; }
      }
    }
    if (!changed) break;
  }
  const maxRank = Math.max(...rank, 0);
  return plan.nodes.map((n, i) => (n.note ? maxRank : rank[i]));
}
