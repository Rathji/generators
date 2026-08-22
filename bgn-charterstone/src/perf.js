// src/perf.js — Phase 16 performance safeguards (Task 77).
// Dirty-flag re-renders, memoized card data, and board culling keep a
// 6-player late-campaign board smooth. The game UI uses these helpers for
// its heavy per-frame paths: describeBuilding results are memoized per
// state, the board build is a single batched string (not per-cell DOM
// churn), and huge boards are culled to the visible viewport. A
// 200-building stress board must render in under 16ms per frame.

export const PERF_VERSION = 1;
export const FRAME_BUDGET_MS = 16;

export function measureFrame(fn) {
  if (typeof performance === "undefined") return 0;
  for (let i = 0; i < 3; i++) fn(); // warm-up
  const t0 = performance.now();
  fn();
  return performance.now() - t0;
}

// Build a chunk of HTML from many rows with ONE string append per row —
// the fast path game UI / stress boards use instead of innerHTML per cell.
export function batchedRender(rows, renderRow) {
  let out = "";
  for (let i = 0; i < rows.length; i++) out += renderRow(rows[i], i);
  return out;
}

export function createDirtyFlags(initial = {}) {
  let flags = { ...initial };
  return {
    get(key) { return flags[key] ?? false; },
    set(key, value = true) { flags[key] = !!value; return flags[key]; },
    clear(key) { delete flags[key]; return false; },
    dirty(key) {
      const d = flags[key] === true;
      delete flags[key];
      return d;
    },
    all() { return { ...flags }; },
    snapshot() { return JSON.stringify(flags); },
    reset(init = {}) { flags = { ...init }; },
  };
}

// Memoize a pure function by key (last-N LRU so a memory leak is impossible).
export function memoize(fn, keyOf, { max = 128 } = {}) {
  const cache = new Map();
  return function (...args) {
    const key = keyOf ? keyOf(...args) : args.length === 1 ? String(args[0]) : JSON.stringify(args);
    if (cache.has(key)) {
      const v = cache.get(key);
      cache.delete(key);
      cache.set(key, v);
      return v;
    }
    const v = fn.apply(this, args);
    cache.set(key, v);
    if (cache.size > max) cache.delete(cache.keys().next().value);
    return v;
  };
}

// Board culling: keep only cells whose pixel centre is inside `bounds`
// (with margin), so huge boards don't render off-screen hexes.
export function cullCells(cells, bounds, { margin = 40 } = {}) {
  const [x0, y0, x1, y1] = bounds;
  return cells.filter(cell => {
    const p = cell.pixel;
    return p.x >= x0 - margin && p.x <= x1 + margin && p.y >= y0 - margin && p.y <= y1 + margin;
  });
}

// The stress test's fixture: n building hexes (a "200-building board").
export function renderStressBoard(n = 200, { size = 34 } = {}) {
  const sq = Math.sqrt(3);
  const rows = [];
  for (let i = 0; i < n; i++) {
    const ring = Math.floor(i / 6) + 2;
    const side = i % 6;
    const q = ring * (side < 3 ? 1 : -1) + (side === 1 || side === 2 || side === 5 ? -1 : 0);
    const r = ring * (side >= 3 ? 1 : -1) + (side === 2 || side === 3 || side === 4 ? 1 : 0);
    rows.push({ q, r, buildingId: "bldg-" + (i % 12), vp: 1 + (i % 5) });
  }
  const bounds = [-320, -240, 320, 240];
  return {
    n,
    visible: cullCells(rows.map(cell => ({
      ...cell,
      pixel: { x: size * sq * (cell.q + cell.r / 2), y: size * 1.5 * cell.r },
    })), bounds).length,
    html: batchedRender(rows, (c, i) =>
      '<g class="g-cell" data-cell="' + c.q + "," + c.r + '"><polygon points="' + hexPoints(c.q, c.r, size) + '"></polygon><text x="0" y="0">' + c.buildingId + "</text></g>"),
  };
}

export function hexPoints(q, r, size = 34) {
  const sq = Math.sqrt(3);
  const cx = size * sq * (q + r / 2);
  const cy = size * 1.5 * r;
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI / 180) * (60 * i - 30);
    pts.push((cx + size * Math.cos(a)).toFixed(1) + "," + (cy + size * Math.sin(a)).toFixed(1));
  }
  return pts.join(" ");
}

// A compact fingerprint of everything that affects a full re-render. When it
// is unchanged across render() calls, the UI skips the rebuild (dirty flag).
export function gameRenderFingerprint(state) {
  const st = state;
  const parts = [];
  for (const p of st.players) {
    const e = st.economy.balance(p.id);
    parts.push(p.id + ":" + p.vp + ":" + p.workers + ":" + (st.influence.availableOf(p.id)) + ":" + JSON.stringify(e));
  }
  parts.push("T" + JSON.stringify(st.turns.counts()));
  parts.push("L" + st.log().length);
  parts.push("P" + st.progress.history().length);
  parts.push("B" + st.board.constructedBuildings().length + ":" + st.board.workerCells().length);
  if (st.reputation) parts.push("R" + st.reputation.occupied().length);
  if (st.quota) parts.push("Q" + st.quota.spaces().filter(s => s.occupiedBy !== null).length);
  return parts.join("|");
}
