/* ════════════════════════════════════════════════════════════════════
   BGN HEX FRAMEWORK — core rules engine (hex.js)
   ────────────────────────────────────────────────────────────────────
   Game-agnostic hex-grid math, board, tokens, and the movement +
   measurement rulebooks every BGN hex game shares — including
   ELEVATION (climbing costs, high ground sight) and water. No DOM,
   no game logic — just the rules. A game build provides a `rules`
   object of hooks (terrain costs, standability, sight, capture,
   events) and the framework does the rest.

   COORDINATES: the BOARD works in offset (col,row) space (odd-row
   stagger) so rectangular maps render clean; every distance / line /
   ring / disk measurement converts to true axial (q,r) cube space
   first, so all geometry is exact regardless of layout.

   LAYOUT
     HexMath     — pure grid math: axial conversions, neighbors,
                   distance, lines, rings, disks, pixel projection.
     HexBoard    — the map: cell props, terrain rules, LOS, shortest
                   path, serialization.
     Token       — a unit on the board: owner, movement points, range.
     HexGame     — one match: tokens + board + turn bookkeeping, the
                   movement engine (reachability, legal moves, capture)
                   and the measurement toolbox (distance, LOS, area).
   ════════════════════════════════════════════════════════════════════ */
"use strict";

const HexMath = (() => {
  const SQRT3 = Math.sqrt(3);

  // Six axial directions (cube neighbor vectors).
  const DIRS = [[1,0],[1,-1],[0,-1],[-1,0],[-1,1],[0,1]];

  const key = (q, r) => q + "," + r;

  /* ── offset (col,row, odd-r stagger)  ⇄  axial (q,r) ── */
  // odd row (row&1): row offset counts as +0.5 col in pixels, so a cell's
  // axial q is col minus (row - parity)/2.
  function offsetToAxial(col, row) { return [col - (row - (row & 1)) / 2, row]; }
  function axialToOffset(q, r) { return [q + (r - (r & 1)) / 2, r]; }

  // Axial neighbors (q±1,r), (q,r±1), (q+1,r-1), (q-1,r+1).
  function axialNeighbors(q, r) {
    return [[q+1,r],[q-1,r],[q,r+1],[q,r-1],[q+1,r-1],[q-1,r+1]];
  }
  // Board-space neighbors of an offset (col,row) cell.
  function neighbors(col, row) {
    const [aq, ar] = offsetToAxial(col, row);
    return axialNeighbors(aq, ar).map(([q, r]) => axialToOffset(q, r));
  }

  /* ── measurement (cube metric, always in axial space) ── */
  function axialDistance(a, b) {
    const x1 = a[0], z1 = a[1], y1 = -x1 - z1;
    const x2 = b[0], z2 = b[1], y2 = -x2 - z2;
    return (Math.abs(x1-x2) + Math.abs(y1-y2) + Math.abs(z1-z2)) / 2;
  }
  // Distance between two BOARD cells.
  function distance(a, b) {
    return axialDistance(offsetToAxial(a[0], a[1]), offsetToAxial(b[0], b[1]));
  }

  // Centre pixel of a board cell. Odd rows are nudged right by half a hex.
  function toPixel(q, r, size) {
    return [ size * SQRT3 * (q + 0.5 * (r & 1)), size * 1.5 * r ];
  }

  // Round floating-point axial coords to the nearest integer hex.
  function axialRound(qf, rf) {
    let x = qf, z = rf, y = -x - z;
    let rx = Math.round(x), ry = Math.round(y), rz = Math.round(z);
    const dx = Math.abs(rx - x), dy = Math.abs(ry - y), dz = Math.abs(rz - z);
    if (dx > dy && dx > dz) rx = -ry - rz;
    else if (dy > dz) ry = -rx - rz;
    else rz = -rx - ry;
    return [rx, rz];
  }

  // Find the board cell under a pixel (svg/screen space).
  function fromPixel(x, y, size) {
    const r = Math.round(y / (1.5 * size));
    const col = Math.round(x / (SQRT3 * size) - 0.5 * (r & 1));
    return [col, r];
  }

  // Straight line of BOARD cells from a to b, inclusive (sampled in
  // axial space, so the line is exact under the cube metric).
  function line(a, b) {
    const A = offsetToAxial(a[0], a[1]), B = offsetToAxial(b[0], b[1]);
    const n = axialDistance(A, B);
    const out = [];
    for (let i = 0; i <= n; i++) {
      const t = n === 0 ? 0 : i / n;
      const [aq, ar] = axialRound(A[0] + (B[0]-A[0]) * t, A[1] + (B[1]-A[1]) * t);
      out.push(axialToOffset(aq, ar));
    }
    return out;
  }

  // Exactly the BOARD cells `radius` steps from center c.
  function ring(c, radius) {
    const [aq, ar] = offsetToAxial(c[0], c[1]);
    if (radius === 0) return [[c[0], c[1]]];
    const out = [];
    let h = [aq - radius, ar + radius];          // start at dir 4
    for (let i = 0; i < 6; i++) {
      for (let j = 0; j < radius; j++) {
        out.push(axialToOffset(h[0], h[1]));
        h = [h[0] + DIRS[i][0], h[1] + DIRS[i][1]];
      }
    }
    return out;
  }

  // Every BOARD cell within `radius` of c (inclusive) — disk/area.
  function disk(c, radius) {
    const [aq, ar] = offsetToAxial(c[0], c[1]);
    const out = [];
    for (let dq = -radius; dq <= radius; dq++)
      for (let dr = -radius; dr <= radius; dr++)
        if (axialDistance([0,0],[dq,dr]) <= radius) out.push(axialToOffset(aq + dq, ar + dr));
    return out;
  }

  return {
    key, neighbors, distance, toPixel, fromPixel, axialRound, line, ring, disk,
    offsetToAxial, axialToOffset, axialNeighbors
  };
})();

/* ════════════════════════════════════════════════════════════════════
   HexBoard — the map.
   A cell is an object living in `cells` under "q,r":
     { q, r, terrain:int, elevation:int, cost?:number, passable?:bool,
       blocksSight?:bool, water?:bool, glyph?:string, label?:string }
   `terrain` is an int id interpreted by the GAME (the framework only
   reads the optional overrides below, so a game can attach anything).
   `elevation` is sea level 0 (buildings commonly use −2…+3); the
   framework charges MP for climbing, lets high ground block sight,
   and treats `water:true` cells as water.
   Hooks (game-provided, on this.rules):
     terrainCost(board, cell, token) -> MP to enter cell
     canStand(board, cell, token, from) -> bool
     canSeeThrough(board, cell) -> bool
     climbCost(board, fromCell, toCell, token) -> extra MP to step up
       (default: +climbRate per level climbed; climbRate defaults 1)
     isWater(board, cell) -> bool   (default: cell.water === true)
     eyeHeight -> number added to a unit's elevation for line of sight
       (default 1); a ridge reaching the lower observer's eye line
       blocks the view. Set blocksSightByElevation=false to disable.
   ════════════════════════════════════════════════════════════════════ */
class HexBoard {
  constructor(opts) {
    opts = opts || {};
    this.shape = opts.shape || "rect";         // "rect" | "hex"
    this.width = opts.width || 9;
    this.height = opts.height || 9;
    this.radius = opts.radius || 3;
    this.rules = opts.rules || {};
    this.cells = new Map();                     // "q,r" -> cell
    this._build();
    if (opts.cells) for (const [k, p] of Object.entries(opts.cells)) this.setCellProps(k, p);
  }
  _build() {
    if (this.shape === "hex") {
      for (let dq = -this.radius; dq <= this.radius; dq++)
        for (let dr = -this.radius; dr <= this.radius; dr++)
          if (HexMath.distance([0,0],[dq,dr]) <= this.radius) this._addCell(dq, dr);
    } else {
      for (let q = 0; q < this.width; q++)
        for (let r = 0; r < this.height; r++) this._addCell(q, r);
    }
  }
  _addCell(q, r) {
    this.cells.set(HexMath.key(q, r), { q, r, terrain: 0, elevation: 0 });
  }
  has(q, r) { return this.cells.has(HexMath.key(q, r)); }
  cell(q, r) { return this.cells.get(HexMath.key(q, r)) || null; }
  setCellProps(keyStr, props) { const c = this.cells.get(keyStr); if (c) Object.assign(c, props); }
  eachCell(fn) { for (const c of this.cells.values()) fn(c); }
  neighbors(q, r) { return HexMath.neighbors(q, r).filter(([nq,nr]) => this.has(nq, nr)); }
  distance(a, b) { return HexMath.distance(a, b); }
  line(a, b) { return HexMath.line(a, b); }
  ring(c, radius) { return HexMath.ring(c, radius); }
  disk(c, radius) { return HexMath.disk(c, radius); }

  /* ── terrain / movement-cost rules ── */
  terrainCost(cell, token) {
    if (!cell) return Infinity;
    if (cell.cost != null) return cell.cost;
    if (this.rules.terrainCost) return this.rules.terrainCost(this, cell, token);
    return 1;
  }
  canStand(cell, token, from) {
    if (!cell) return false;
    if (this.rules.canStand) return this.rules.canStand(this, cell, token, from);
    return cell.passable !== false;
  }
  canSeeThrough(cell) {
    if (!cell) return false;
    if (this.rules.canSeeThrough) return this.rules.canSeeThrough(this, cell);
    return cell.blocksSight !== true;
  }

  /* ── elevation rules ──
     Moving uphill costs extra MP; high ground helps (or blocks) sight.
     A game tunes this with rules.climbRate / rules.climbCost / the
     blocksSightByElevation flag — or ignores it entirely by leaving
     every cell at elevation 0. */
  elevationOf(q, r) { const c = this.cell(q, r); return c ? (c.elevation || 0) : 0; }

  // Extra MP to step FROM fromCell ONTO toCell (0 for level or downhill).
  climbCost(fromCell, toCell, token) {
    if (this.rules.climbCost) return this.rules.climbCost(this, fromCell, toCell, token);
    const d = (toCell ? toCell.elevation || 0 : 0) - (fromCell ? fromCell.elevation || 0 : 0);
    if (d <= 0) return 0;
    return d * (this.rules.climbRate != null ? this.rules.climbRate : 1);
  }

  isWater(cell) {
    if (!cell) return false;
    if (this.rules.isWater) return !!this.rules.isWater(this, cell);
    return cell.water === true;
  }

  /* ── measurement: LOS across the board ──
     A line is clear if every intermediate cell (a) passes the game's
     canSeeThrough hook (terrain) and (b) is below the straight sight
     line interpolated between the two observers' eye heights (their
     hex elevation + rules.eyeHeight, default 1). So high ground
     overlooks lower ridges, a ridge exactly at your eye level blocks
     you, and same/adjacent hexes always see each other. Disable the
     elevation rule with rules.blocksSightByElevation=false. */
  lineOfSight(a, b) {
    if (a[0] === b[0] && a[1] === b[1]) return true;
    const ac = this.cell(a[0], a[1]), bc = this.cell(b[0], b[1]);
    const pts = this.line(a, b);
    const n = Math.max(1, pts.length - 1);
    for (let i = 1; i < pts.length - 1; i++) {
      const mid = this.cell(pts[i][0], pts[i][1]);
      if (!this.canSeeThrough(mid)) return false;
      if (this.blocksByElevation(ac, bc, mid, i / n)) return false;
    }
    return true;
  }
  blocksByElevation(ac, bc, mid, t) {
    if (this.rules.blocksSightByElevation === false) return false;
    const eyeH = this.rules.eyeHeight != null ? this.rules.eyeHeight : 1;
    const hA = (ac ? ac.elevation || 0 : 0) + eyeH;
    const hB = (bc ? bc.elevation || 0 : 0) + eyeH;
    const lineH = hA + (hB - hA) * (t != null ? t : 0.5);
    return (mid ? mid.elevation || 0 : 0) >= lineH;
  }

  /* ── shortest path honoring terrain costs & standability ──
     Returns {path:[[q,r],...], cost} or null if unreachable.
     `token` optional — applies its terrain cost & canStand rules. */
  shortestPath(from, to, token) {
    if (!this.has(from[0], from[1]) || !this.has(to[0], to[1])) return null;
    const start = HexMath.key(from[0], from[1]);
    const goal = HexMath.key(to[0], to[1]);
    const dist = new Map([[start, 0]]);
    const prev = new Map();
    const q = [from];
    const qIdx = { [start]: true };
    while (q.length) {
      // crude but correct for small boards (a proper priority queue is
      // a per-game optimization, not a framework concern)
      let bi = 0;
      for (let i = 1; i < q.length; i++) if (dist.get(HexMath.key(q[i][0],q[i][1])) < dist.get(HexMath.key(q[bi][0],q[bi][1]))) bi = i;
      const cur = q.splice(bi, 1)[0];
      const ck = HexMath.key(cur[0], cur[1]);
      delete qIdx[ck];
      if (ck === goal) break;
      for (const [nq, nr] of this.neighbors(cur[0], cur[1])) {
        const cell = this.cell(nq, nr);
        if (!this.canStand(cell, token, cur)) continue;
        const cost = this.terrainCost(cell, token);
        if (!isFinite(cost)) continue;
        const nd = dist.get(ck) + cost;
        const nk = HexMath.key(nq, nr);
        if (nd < (dist.get(nk) ?? Infinity)) {
          dist.set(nk, nd); prev.set(nk, cur);
          if (!qIdx[nk]) { q.push([nq, nr]); qIdx[nk] = true; }
        }
      }
    }
    if (!prev.has(goal) && goal !== start) return null;
    const path = [];
    let cur = to;
    while (cur) { path.unshift([cur[0], cur[1]]); cur = prev.get(HexMath.key(cur[0], cur[1])); }
    return { path, cost: dist.get(goal) ?? 0 };
  }

  /* ── serialization (compact; terrain overrides only) ── */
  toJSON() {
    const overrides = {};
    this.eachCell(c => {
      const rest = {};
      for (const k in c) {
        if (k === "q" || k === "r") continue;
        if (k === "terrain" && c[k] === 0) continue;
        if (k === "elevation" && c[k] === 0) continue;
        rest[k] = c[k];
      }
      if (Object.keys(rest).length) overrides[HexMath.key(c.q, c.r)] = rest;
    });
    return { shape: this.shape, width: this.width, height: this.height, radius: this.radius, cells: overrides };
  }
  static fromJSON(o) {
    return new HexBoard({ shape: o.shape, width: o.width, height: o.height, radius: o.radius, cells: o.cells || {} });
  }
}

/* ════════════════════════════════════════════════════════════════════
   Token — a unit on the board.
     id      string   stable identifier (used for selection/UI)
     owner   string   which side ("host"/"guest" in BGN tables)
     q,r     int      current hex
     name    string   display name
     icon    string   one-char symbol on the board
     mp      int      maximum movement points per turn
     rem     int      remaining movement points this turn
     range   int      weapon/attack range (for measurement tools)
     blocked bool     blocks hostile movement through its hex
     meta    object   game-specific extras
   ════════════════════════════════════════════════════════════════════ */
class Token {
  constructor(o) {
    o = o || {};
    this.id = o.id || ("t" + Math.random().toString(36).slice(2, 8));
    this.owner = o.owner || "host";
    this.q = o.q || 0; this.r = o.r || 0;
    this.name = o.name || "Unit";
    this.icon = o.icon || "◆";
    this.mp = o.mp != null ? o.mp : 3;
    this.rem = o.rem != null ? o.rem : this.mp;
    this.range = o.range || 0;
    this.facing = o.facing != null ? o.facing : 0;
    this.twist = o.twist != null ? Math.max(-1, Math.min(1, o.twist)) : 0;
    this.blocked = o.blocked !== false;
    this.meta = o.meta || {};
  }
}

/* ════════════════════════════════════════════════════════════════════
   HexGame — one match. Owns the board, tokens, turn bookkeeping and
   the rule hooks. A BGN table drives exactly one of these.

   Game-provided rules (this.rules):
     terrainCost(game, cell, token)            — MP to enter (override)
     canStand(game, cell, token, from)         — may it stand there?
     moveCostModifier(game, token, from, to)   — extra MP (ZOC, etc.)
     canEnter(game, token, occupant, from, to) — may it move onto an
                                                 occupied hex? (return
                                                 MP cost, or false to
                                                 block, or undefined
                                                 to use the default)
     canCapture(game, token, occupant)         — may it capture? default:
                                                 different owner
     onTokenMoved(game, token, from, to, captured) — event hook
   Elevation settings (framework defaults in parens):
     climbRate (1)             MP per level climbed
     eyeHeight (1)             height above its hex a unit sees from
     blocksSightByElevation    false turns the elevation LOS rule off
   ════════════════════════════════════════════════════════════════════ */
class HexGame {
  constructor(opts) {
    opts = opts || {};
    this.board = opts.board || new HexBoard({});
    this.rules = opts.rules || {};
    this.board.rules = this.rules;               // board hooks = game hooks
    this.tokens = (opts.tokens || []).map(t => t instanceof Token ? t : new Token(t));
    this.turn = opts.turn || 0;                  // completed turns
    this.first = opts.first || 0;                // 0 host first, 1 guest first
    this.winner = opts.winner || null;           // "host" | "guest" | "draw"
    this.reason = opts.reason || null;
    this.log = (opts.log || []).slice();
  }

  /* ── helpers ── */
  tokenAt(q, r) {
    for (const t of this.tokens) if (t.q === q && t.r === r) return t;
    return null;
  }
  tokenById(id) { return this.tokens.find(t => t.id === id) || null; }
  tokensOf(owner) { return this.tokens.filter(t => t.owner === owner); }
  label(q, r) {
    return this.board.shape === "rect" ? String.fromCharCode(65 + q) + (r + 1) : "(" + q + "," + r + ")";
  }
  turnRole() { return ((this.turn + this.first) % 2) === 0 ? "host" : "guest"; }
  addLog(role, msg) { this.log.push({ r: role, m: msg }); if (this.log.length > 30) this.log.shift(); }

  /* ══ MOVEMENT RULES ══
     The MP economy: every token has `mp` and `rem`. On a player's turn
     they spend `rem` moving (each step costs the target terrain cost,
     plus any rules.moveCostModifier). `rem` resets to `mp` when that
     player's turn begins (call refreshMp). A token may keep moving
     until rem is spent or they pass — the UI decides. */

  refreshMp(role) { for (const t of this.tokens) if (t.owner === role) t.rem = t.mp; }

  // MP cost to step from `from` onto (q,r). Infinity if the hex is
  // off-board, not standable, or occupied (unless a rules.canEnter
  // hook opens occupied hexes up).
  enterCost(token, q, r, from) {
    const cell = this.board.cell(q, r);
    if (!cell) return Infinity;
    if (!this.board.canStand(cell, token, from)) return Infinity;
    const occ = this.tokenAt(q, r);
    if (occ && occ !== token) {
      if (this.rules.canEnter) {
        const v = this.rules.canEnter(this, token, occ, from, [q, r]);
        if (v !== undefined) return v;
      }
      return Infinity;                            // default: occupied blocks
    }
    let cost = this.board.terrainCost(cell, token);
    cost += this.board.climbCost(this.board.cell(from[0], from[1]), cell, token);
    if (this.rules.moveCostModifier) cost += this.rules.moveCostModifier(this, token, from, [q, r]);
    return cost;
  }

  // Every hex this token can reach with its remaining MP. Returns a
  // Map "q,r" -> {q, r, cost, capture?:bool, path:[[q,r],...]} (start
  // cell excluded). Occupied enemy hexes appear as capture targets
  // (cost 1); hexes beyond enemies are unreachable unless a
  // rules.canEnter hook opens them up.
  reachable(token) {
    const out = new Map();
    const queue = [[token.q, token.r, 0]];
    const best = new Map([[HexMath.key(token.q, token.r), 0]]);
    const paths = new Map([[HexMath.key(token.q, token.r), [[token.q, token.r]]]]);
    let i = 0;
    while (i < queue.length) {
      const [cq, cr, cost] = queue[i++];
      for (const [nq, nr] of this.board.neighbors(cq, cr)) {
        const k = HexMath.key(nq, nr);
        const occ = this.tokenAt(nq, nr);
        if (occ && occ !== token) {
          if (!this.canCapture(token, occ) || cost + 1 > token.rem) continue;
          if ((best.get(k) ?? Infinity) <= cost + 1) continue;
          best.set(k, cost + 1);
          paths.set(k, paths.get(HexMath.key(cq, cr)).concat([[nq, nr]]));
          out.set(k, { q: nq, r: nr, cost: cost + 1, capture: true, path: paths.get(k) });
          continue;
        }
        const nc = this.enterCost(token, nq, nr, [cq, cr]);
        if (!isFinite(nc) || cost + nc > token.rem) continue;
        if ((best.get(k) ?? Infinity) <= cost + nc) continue;
        best.set(k, cost + nc);
        paths.set(k, paths.get(HexMath.key(cq, cr)).concat([[nq, nr]]));
        out.set(k, { q: nq, r: nr, cost: cost + nc, path: paths.get(k) });
        queue.push([nq, nr, cost + nc]);
      }
    }
    return out;
  }

  // Is (q,r) a legal destination for this token right now?
  // Returns {capture?:bool, cost, path} | null. cost is the summed
  // terrain cost along the shortest legal path (plus any ZOC
  // modifiers); a capture costs the path to adjacency + 1 MP.
  canMoveTo(token, q, r) {
    if (!this.board.has(q, r)) return null;
    const occ = this.tokenAt(q, r);
    if (occ && occ !== token) {
      if (!this.canCapture(token, occ)) return null;
      const pc = this._pathCostTo(token, q, r);
      if (!pc) return null;
      return pc;
    }
    if (!this.board.canStand(this.board.cell(q, r), token, [token.q, token.r])) return null;
    const pc = this._pathCostTo(token, q, r);
    if (!pc || pc.cost > token.rem) return null;
    return pc;
  }

  // Dijkstra from the token's hex to a non-occupied destination,
  // honoring terrain costs and occupancy (occupied cells block).
  // (Correctness note: BFS with re-push-on-improvement — no early
  // return, so costs converge to true shortest paths.)
  _dijkstra(token, to) {
    const startKey = HexMath.key(token.q, token.r);
    const goal = HexMath.key(to[0], to[1]);
    if (startKey === goal) return { cost: 0, path: [[token.q, token.r]] };
    const best = new Map([[startKey, 0]]);
    const paths = new Map([[startKey, [[token.q, token.r]]]]);
    const queue = [[token.q, token.r, 0]];
    let i = 0;
    while (i < queue.length) {
      const [cq, cr, cost] = queue[i++];
      for (const [nq, nr] of this.board.neighbors(cq, cr)) {
        if (this.tokenAt(nq, nr)) continue;
        const nc = this.enterCost(token, nq, nr, [cq, cr]);
        if (!isFinite(nc)) continue;
        const nd = cost + nc;
        const k = HexMath.key(nq, nr);
        if ((best.get(k) ?? Infinity) <= nd) continue;
        best.set(k, nd);
        paths.set(k, paths.get(HexMath.key(cq, cr)).concat([[nq, nr]]));
        queue.push([nq, nr, nd]);
      }
    }
    if (!best.has(goal)) return null;
    return { cost: best.get(goal), path: paths.get(goal) };
  }

  // Path cost to (q,r) — handles capture destinations (path to an
  // adjacent cell + 1 MP for the capture step) and normal cells.
  _pathCostTo(token, q, r) {
    const occ = this.tokenAt(q, r);
    if (occ && occ !== token) {
      if (!this.canCapture(token, occ)) return null;
      let bestCost = Infinity, bestPath = null;
      for (const [nq, nr] of this.board.neighbors(q, r)) {
        if (this.tokenAt(nq, nr)) continue;
        const pc = this._dijkstra(token, [nq, nr]);
        if (pc && pc.cost + 1 <= token.rem && pc.cost + 1 < bestCost) {
          bestCost = pc.cost + 1;
          bestPath = pc.path.concat([[q, r]]);
        }
      }
      return isFinite(bestCost) ? { cost: bestCost, path: bestPath, capture: true } : null;
    }
    const pc = this._dijkstra(token, [q, r]);
    return pc ? { cost: pc.cost, path: pc.path } : null;
  }

  canCapture(attacker, victim) {
    if (this.rules.canCapture) return this.rules.canCapture(this, attacker, victim);
    return attacker.owner !== victim.owner;
  }

  // Perform a move. Throws on illegal moves. Returns the result object.
  moveToken(token, q, r, byRole) {
    const from = [token.q, token.r];
    const res = this.canMoveTo(token, q, r);
    if (!res) throw new Error("Illegal move: " + this.label(q, r));
    const captured = res.capture ? this.tokenAt(q, r) : null;
    const cost = res.cost;
    if (captured) this.removeToken(captured);
    token.rem -= cost;
    token.q = q; token.r = r;
    if (this.rules.onTokenMoved) this.rules.onTokenMoved(this, token, from, [q, r], captured);
    if (byRole) this.addLog(byRole, "Moved " + token.name + " " + this.label(from[0], from[1]) + " → " + this.label(q, r) + (cost > 1 ? " (" + cost + " MP)" : ""));
    return { from, to: [q, r], cost, captured, path: res.path };
  }

  addToken(t) { this.tokens.push(t); return t; }
  removeToken(t) { const i = this.tokens.indexOf(t); if (i !== -1) this.tokens.splice(i, 1); return t; }

  /* ══ MEASUREMENT RULES ══
     Everything a game needs to measure ranges, lines of sight and
     area templates, exposed for both the UI tools and game rules. */

  measure(a, b) {
    const line = this.board.line(a, b);
    let climb = 0;
    for (let i = 1; i < line.length; i++) {
      const d = this.board.elevationOf(line[i][0], line[i][1]) - this.board.elevationOf(line[i - 1][0], line[i - 1][1]);
      if (d > 0) climb += d;
    }
    return {
      distance: this.board.distance(a, b),
      los: this.board.lineOfSight(a, b),
      elevA: this.board.elevationOf(a[0], a[1]),
      elevB: this.board.elevationOf(b[0], b[1]),
      delta: this.board.elevationOf(b[0], b[1]) - this.board.elevationOf(a[0], a[1]),
      climb   // total uphill climbed along the straight line, in levels
    };
  }
  rangeCells(from, range) { return this.board.disk(from, range); }
  ringCells(c, radius) { return this.board.ring(c, radius); }
  lineCells(a, b) { return this.board.line(a, b); }

  /* ══ serialization — one snapshot = one JSON string, small enough
        for the BGN table server to carry per room (compact). ══ */
  toJSON() {
    return {
      v: 1,
      board: this.board.toJSON(),
      turn: this.turn,
      first: this.first,
      winner: this.winner,
      reason: this.reason,
      log: this.log,
      tokens: this.tokens.map(t => ({
        id: t.id, owner: t.owner, q: t.q, r: t.r, name: t.name, icon: t.icon,
        mp: t.mp, rem: t.rem, range: t.range, facing: t.facing, twist: t.twist, blocked: t.blocked, meta: t.meta
      }))
    };
  }
  // Attach the CURRENT game's rules on restore (functions don't serialize).
  static fromJSON(o, rules) {
    return new HexGame({
      board: HexBoard.fromJSON(o.board),
      rules,
      tokens: (o.tokens || []).map(t => new Token(t)),
      turn: o.turn || 0,
      first: o.first || 0,
      winner: o.winner || null,
      reason: o.reason || null,
      log: o.log || []
    });
  }
}

window.HexGame = HexGame;
window.HexBoard = HexBoard;
window.Token = Token;
window.HexMath = HexMath;
