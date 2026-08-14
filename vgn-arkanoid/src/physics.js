// ============================================================================
//  src/physics.js — VGN 2D PHYSICS ENGINE
//  ----------------------------------------------------------------------------
//  A small, dependency-free 2D physics engine for arcade games — Breakout,
//  Arkanoid, Pong, and anything else that bounces, slides or falls in 2D.
//
//  WHAT YOU GET
//    • Two solid shapes: AABB rectangles (paddles, bricks, walls, platforms)
//      and circles (balls, coins, orbs). Each can be static (never moves,
//      infinite mass), dynamic (falls / bounces), or a SENSOR (detects
//      overlaps and fires events but never blocks anything — perfect for
//      power-up pickups and trigger zones).
//    • Velocity integration with per-body gravity, damping and speed caps.
//    • Restitution (bounciness) and friction (tangential drag on impact).
//    • AUTOMATIC SUBSTEPPING — the engine figures out how many physics steps
//      the frame needs so a small, fast ball can never tunnel through a brick.
//    • Collision layers via bitmasks (body.layer & other.mask). A ball can
//      smash bricks while ignoring power-up drops, and drops only get caught
//      by the paddle.
//    • Contact events: `onCollide(other, contact)` fires when a contact
//      BEGINS, `onEndCollide(other)` when it ends. The contact object carries
//      the collision normal (which way to bounce), the exact contact point
//      (angle a Pong bounce off where the ball hit the paddle) and depth.
//    • world.raycast(ox, oy, dx, dy, maxDist) — nearest hit along a ray
//      (lasers, line-of-sight, turret aim).
//    • world.queryCircle(cx, cy, r) — every body overlapping a point/radius
//      (area effects, pickups, proximity checks).
//    • Optional world-bounds walls: new World({ walls: ['top','left','right'] }).
//
//  DESIGN NOTE
//    This is deliberately an *impulse* engine, not a joint/constraint one:
//    bodies are axis-aligned boxes and circles; a circle hits a box by
//    clamping to its closest point. That covers every breakout/pong/brick
//    need and stays readable enough to fork and extend. Two full worked
//    examples live next door: src/breakoutgame.js and src/ponggame.js.
//  ============================================================================

export const T_AABB = 1;
export const T_CIRCLE = 2;

// Layer used by the auto-generated world walls (see World constructor).
export const WALL_LAYER = 1 << 30;

let _nextId = 1;

// ============================================================================
//  Body  — one physical object
//  ----------------------------------------------------------------------------
//  new Body(T_CIRCLE, { x, y, r })   new Body(T_AABB, { x, y, w, h })
//  x/y is the CENTER of the body. Use world.rect() / world.circle() to create
//  and register bodies in one call.
//
//  OPTIONS
//    static        never moves, infinite mass (bricks, walls)      [false]
//    sensor        detects overlaps + fires events, blocks nothing [false]
//    vx, vy        starting velocity
//    gravityScale  0 = ignore world gravity; 1 = full; 2 = double  [1]
//    damping       fraction of speed lost per second (air drag)    [0]
//    maxSpeed      clamps speed to this px/s (0 = unlimited)       [0]
//    restitution   0..1 bounciness on impact                       [0.8]
//    friction      0..1 tangential speed removed on impact         [0]
//    mass          override (default: w*h for boxes, r*r for balls)
//    layer, mask   collision bitmasks (see docs above)
//    onCollide     (other, contact) => void — fires when contact starts
//    onEndCollide  (other) => void — fires when contact ends
//    data          your game payload (type, hp, color, ...)        [null]
//  ============================================================================
export class Body {
  constructor(type, o = {}) {
    this.id = _nextId++;
    this.type = type;
    this.x = o.x ?? 0;
    this.y = o.y ?? 0;
    this.w = o.w ?? 0;                      // AABB size
    this.h = o.h ?? 0;
    this.r = o.r ?? 0;                      // circle radius
    this.static = !!o.static;
    this.sensor = !!o.sensor;
    this.vx = o.vx ?? 0;
    this.vy = o.vy ?? 0;
    this.gravityScale = o.gravityScale ?? 1;
    this.damping = o.damping ?? 0;
    this.maxSpeed = o.maxSpeed ?? 0;
    this.restitution = o.restitution ?? 0.8;
    this.friction = o.friction ?? 0;
    this.mass = o.static ? Infinity : (o.mass ?? this._area());
    this.layer = o.layer ?? 1;
    this.mask = o.mask ?? 0xffffffff;
    this.onCollide = o.onCollide || null;
    this.onEndCollide = o.onEndCollide || null;
    this.data = o.data || null;
    this.dead = false;                      // true after world.remove()
  }

  // Half-extents used by the broadphase grid. Circles store their radius in
  // `r` (w/h are 0), so their half-extents come from the radius.
  get hw() { return this.type === T_CIRCLE ? this.r : this.w / 2; }
  get hh() { return this.type === T_CIRCLE ? this.r : this.h / 2; }
  get speed() { return Math.hypot(this.vx, this.vy); }

  _area() { return this.type === T_AABB ? this.w * this.h : this.r * this.r; }
}

// ============================================================================
//  World  — owns every body and advances the simulation
//  ----------------------------------------------------------------------------
//  const world = new World({ width, height, gravity, walls });
//      gravity   px/s², +y = down (0 for breakout/pong — balls don't fall)
//      walls     ['top','bottom','left','right'] auto walls (thick, invisible)
//  Usage:
//      world.rect({...}) / world.circle({...})   create + register a body
//      world.step(dt)                            advance the simulation
//      world.remove(body)                        destroy (safe mid-step)
//      world.raycast(...) / world.queryCircle(...)
//  ============================================================================
export class World {
  constructor(o = {}) {
    this.bodies = new Set();
    this.width = o.width ?? 480;
    this.height = o.height ?? 270;
    this.gravity = o.gravity ?? 0;
    this.cell = o.cell ?? 48;                 // broadphase grid cell size
    this.maxSteps = o.maxSteps ?? 64;         // substep safety cap per frame
    this.wallThickness = o.wallThickness ?? 24;

    this._grid = new Map();                   // "cx:cy" -> [body]
    this._seen = new Set();                   // pair dedupe during broadphase
    this._pairs = [];                         // candidate pairs (reused array)
    this._contacts = new Map();               // persistent pairKey -> contact
    this._newContacts = new Map();            // contacts detected this step
    this._wallBodies = [];

    const walls = o.walls;
    if (walls) {
      const sides = Array.isArray(walls) ? walls : Object.keys(walls).filter(k => walls[k]);
      for (const s of sides) this._makeWall(s);
    }
  }

  // ---- factories ------------------------------------------------------------

  rect(o) { return this.add(new Body(T_AABB, o)); }
  circle(o) { return this.add(new Body(T_CIRCLE, o)); }
  add(b) { this.bodies.add(b); return b; }

  // Safe to call from inside an onCollide callback or mid-step: the body is
  // flagged dead immediately (it stops colliding), removed at step end.
  remove(b) { b.dead = true; }

  _makeWall(side) {
    const t = this.wallThickness;
    const W = this.width, H = this.height;
    let o = { x: 0, y: 0, w: 0, h: 0 };
    if (side === 'top')      { o = { x: W / 2, y: -t / 2, w: W + t * 2, h: t }; }
    else if (side === 'bottom') { o = { x: W / 2, y: H + t / 2, w: W + t * 2, h: t }; }
    else if (side === 'left')   { o = { x: -t / 2, y: H / 2, w: t, h: H + t * 2 }; }
    else if (side === 'right')  { o = { x: W + t / 2, y: H / 2, w: t, h: H + t * 2 }; }
    else return;
    const b = new Body(T_AABB, {
      ...o, static: true, restitution: 1, layer: WALL_LAYER,
      mask: 0xffffffff, data: { type: 'wall' },
    });
    this._wallBodies.push(b);
    this.bodies.add(b);
  }

  // ---- main loop --------------------------------------------------------------

  // Advance the simulation by dt seconds. Internally splits dt into smaller
  // substeps sized so the fastest body can't jump further than half the
  // smallest body feature per step — that's what kills tunneling.
  step(dt) {
    if (dt <= 0) return;
    const n = this._substeps(dt);
    const sdt = dt / n;
    this._newContacts.clear();
    for (let i = 0; i < n; i++) this._substep(sdt);
    this._flushContacts();
    for (const b of this.bodies) if (b.dead) this.bodies.delete(b);
  }

  _substeps(dt) {
    let maxSpeed = 0, minFeature = Infinity;
    for (const b of this.bodies) {
      if (b.static || b.dead) continue;
      const sp = b.speed;
      if (sp > maxSpeed) maxSpeed = sp;
      const f = b.type === T_AABB ? Math.min(b.hw, b.hh) : b.r;
      if (f < minFeature) minFeature = f;
    }
    if (!isFinite(minFeature) || minFeature <= 0) minFeature = Math.min(this.width, this.height) / 48;
    const cap = Math.max(1, minFeature * 0.5);
    return Math.max(1, Math.min(Math.ceil((maxSpeed * dt) / cap), this.maxSteps));
  }

  _substep(dt) {
    this._integrate(dt);
    this._broadphase();
    for (const pair of this._pairs) this._solve(pair[0], pair[1]);
  }

  _integrate(dt) {
    for (const b of this.bodies) {
      if (b.dead || b.static) continue;
      if (this.gravity !== 0 && b.gravityScale !== 0) b.vy += this.gravity * b.gravityScale * dt;
      if (b.damping > 0) {
        const k = Math.max(0, 1 - b.damping * dt);
        b.vx *= k; b.vy *= k;
      }
      if (b.maxSpeed > 0 && b.speed > b.maxSpeed) {
        const k = b.maxSpeed / b.speed;
        b.vx *= k; b.vy *= k;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
    }
  }

  // Uniform-grid broadphase: bucket bodies into cells, test only the pairs
  // that share a cell. O(n) in practice — a breakout board costs nothing.
  _broadphase() {
    const grid = this._grid;
    grid.clear();
    for (const b of this.bodies) {
      if (b.dead) continue;
      const x0 = Math.floor((b.x - b.hw) / this.cell);
      const x1 = Math.floor((b.x + b.hw) / this.cell);
      const y0 = Math.floor((b.y - b.hh) / this.cell);
      const y1 = Math.floor((b.y + b.hh) / this.cell);
      for (let cy = y0; cy <= y1; cy++) {
        for (let cx = x0; cx <= x1; cx++) {
          const key = cx + ':' + cy;
          let arr = grid.get(key);
          if (!arr) grid.set(key, arr = []);
          arr.push(b);
        }
      }
    }
    const pairs = this._pairs, seen = this._seen;
    pairs.length = 0;
    seen.clear();
    for (const arr of grid.values()) {
      for (let i = 0; i < arr.length; i++) {
        const a = arr[i];
        if (a.dead) continue;
        for (let j = i + 1; j < arr.length; j++) {
          const b = arr[j];
          if (b.dead || (a.static && b.static)) continue;
          if ((a.layer & b.mask) === 0 || (b.layer & a.mask) === 0) continue;
          const pk = a.id < b.id ? a.id * 1000000 + b.id : b.id * 1000000 + a.id;
          if (seen.has(pk)) continue;
          seen.add(pk);
          pairs.push([a, b]);
        }
      }
    }
  }

  // Narrowphase + response for one candidate pair.
  _solve(a, b) {
    const hit = collide(a, b);        // null, or {nx,ny,overlap,px,py} (normal b→a)
    if (!hit) return;

    // Record the contact — one event per pair per step (first substep that
    // overlaps). contact.approaching = "was self moving toward other?".
    const pk = a.id < b.id ? a.id * 1000000 + b.id : b.id * 1000000 + a.id;
    if (!this._newContacts.has(pk)) {
      const rel = (a.vx - b.vx) * hit.nx + (a.vy - b.vy) * hit.ny;
      hit.approaching = rel < 0;
      this._newContacts.set(pk, { a, b, hit });
    }

    if (a.sensor || b.sensor) return;  // sensors see, never touch
    if (a.static && b.static) return;

    if (!a.static && b.static)      this._bounce(a, b, hit, 1);
    else if (a.static && !b.static) this._bounce(b, a, hit, -1);
    else                            this._bounceBoth(a, b, hit);
  }

  // One moving body vs a solid (static) one. Reflect velocity only when the
  // mover is APPROACHING — a ball already separating gets pushed out, never
  // reflected twice. That's what lets a game override a bounce's angle.
  _bounce(mover, solid, hit, sign) {
    const nx = hit.nx * sign, ny = hit.ny * sign;   // solid → mover
    if (hit.approaching) {
      const vn = mover.vx * nx + mover.vy * ny;
      const e = mover.restitution * (solid.restitution || 1);
      mover.vx -= (1 + e) * vn * nx;
      mover.vy -= (1 + e) * vn * ny;
      if (mover.friction > 0) {
        const tx = -ny, ty = nx;                    // tangent
        const vt = mover.vx * tx + mover.vy * ty;
        mover.vx -= vt * mover.friction * tx;
        mover.vy -= vt * mover.friction * ty;
      }
    }
    mover.x += hit.overlap * nx;                    // separate (no sticking)
    mover.y += hit.overlap * ny;
  }

  // Two moving bodies: share the positional fix by inverse mass and exchange
  // an elastic impulse along the contact normal.
  // Contact normal `hit.n` points from b → a. To separate, a moves along +n,
  // b along -n. With n = b→a, the pair is APPROACHING when (vB - vA)·n > 0,
  // in which case a receives impulse +j·n and b receives -j·n.
  _bounceBoth(a, b, hit) {
    const invA = 1 / a.mass, invB = 1 / b.mass;
    const invSum = invA + invB;
    const kA = invA / invSum, kB = invB / invSum;
    a.x += hit.nx * hit.overlap * kA;  a.y += hit.ny * hit.overlap * kA;
    b.x -= hit.nx * hit.overlap * kB;  b.y -= hit.ny * hit.overlap * kB;
    const rel = (b.vx - a.vx) * hit.nx + (b.vy - a.vy) * hit.ny;
    if (rel > 0) {
      const e = (a.restitution + b.restitution) / 2;
      const j = (1 + e) * rel / invSum;
      a.vx += j * hit.nx * invA;  a.vy += j * hit.ny * invA;
      b.vx -= j * hit.nx * invB;  b.vy -= j * hit.ny * invB;
    }
  }

  _flushContacts() {
    const neu = this._newContacts;
    for (const { a, b, hit } of neu.values()) {
      if (a.onCollide) a.onCollide(b, { ...hit, other: b });
      if (b.onCollide) b.onCollide(a, { ...hit, nx: -hit.nx, ny: -hit.ny, other: a });
    }
    for (const [pk, entry] of this._contacts) {
      if (neu.has(pk)) continue;
      if (entry.a.onEndCollide) entry.a.onEndCollide(entry.b);
      if (entry.b.onEndCollide) entry.b.onEndCollide(entry.a);
    }
    this._contacts = neu;
  }

  // ---- queries ----------------------------------------------------------------

  // Nearest body hit by the ray from (ox,oy) along (dx,dy), out to maxDist.
  // Returns null or { body, dist, x, y, nx, ny }. Skips sensors.
  raycast(ox, oy, dx, dy, maxDist = 10000, filter = null) {
    const len = Math.hypot(dx, dy);
    if (!len) return null;
    const ux = dx / len, uy = dy / len;
    let best = null, bestD = maxDist;
    for (const b of this.bodies) {
      if (b.dead || b.sensor) continue;
      if (filter && !filter(b)) continue;
      const r = rayShape(ox, oy, ux, uy, b);
      if (r && r[0] >= 0 && r[0] <= bestD) {
        bestD = r[0];
        best = { body: b, dist: r[0], x: ox + ux * r[0], y: oy + uy * r[0], nx: r[1], ny: r[2] };
      }
    }
    return best;
  }

  // Every non-sensor body overlapping the circle centered at (cx,cy).
  queryCircle(cx, cy, r, filter = null) {
    const out = [];
    for (const b of this.bodies) {
      if (b.dead || b.sensor) continue;
      if (filter && !filter(b)) continue;
      if (b.type === T_AABB) {
        const bx = Math.max(b.x - b.hw, Math.min(cx, b.x + b.hw));
        const by = Math.max(b.y - b.hh, Math.min(cy, b.y + b.hh));
        const ddx = cx - bx, ddy = cy - by;
        if (ddx * ddx + ddy * ddy <= r * r) out.push(b);
      } else {
        const ddx = cx - b.x, ddy = cy - b.y;
        if (ddx * ddx + ddy * ddy <= (r + b.r) * (r + b.r)) out.push(b);
      }
    }
    return out;
  }
}

// ============================================================================
//  Shape collision — returns {nx, ny, overlap, px, py} or null.
//  The normal ALWAYS points from body `b` toward body `a`; px/py is the point
//  of contact in world space. (Callbacks get the normal flipped so each body
//  sees "from other to me".)
//  ============================================================================

function collide(a, b) {
  if (a.type === T_AABB && b.type === T_AABB) return aabbAabb(a, b);
  if (a.type === T_CIRCLE && b.type === T_CIRCLE) return circleCircle(a, b);
  if (a.type === T_CIRCLE) return circleAabb(a, b);       // a=circle, b=box
  return circleAabb(b, a, true);                          // a=box, b=circle
}

function aabbAabb(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  const ox = a.hw + b.hw - Math.abs(dx);
  if (ox <= 0) return null;
  const oy = a.hh + b.hh - Math.abs(dy);
  if (oy <= 0) return null;
  let nx, ny, overlap;
  if (ox < oy) { nx = Math.sign(dx) || 1; ny = 0; overlap = ox; }
  else         { nx = 0; ny = Math.sign(dy) || 1; overlap = oy; }
  const px = Math.max(b.x - b.hw, Math.min(a.x, b.x + b.hw));
  const py = Math.max(b.y - b.hh, Math.min(a.y, b.y + b.hh));
  return { nx, ny, overlap, px, py };
}

function circleCircle(a, b) {
  const dx = a.x - b.x, dy = a.y - b.y;
  const rr = a.r + b.r;
  const d2 = dx * dx + dy * dy;
  if (d2 >= rr * rr) return null;
  const d = Math.sqrt(d2);
  let nx = 1, ny = 0;
  if (d > 0.0001) { nx = dx / d; ny = dy / d; }
  return { nx, ny, overlap: rr - d, px: b.x + nx * b.r, py: b.y + ny * b.r };
}

// Circle `c` vs box `box`. `flip` negates the normal (used when the box is
// body `a` so the invariant "normal b→a" holds).
function circleAabb(c, box, flip = false) {
  const bx = Math.max(box.x - box.hw, Math.min(c.x, box.x + box.hw));
  const by = Math.max(box.y - box.hh, Math.min(c.y, box.y + box.hh));
  let dx = c.x - bx, dy = c.y - by;
  const r = c.r;
  let nx, ny, overlap;
  const d2 = dx * dx + dy * dy;
  if (d2 > r * r) return null;
  if (d2 > 0.0001) {
    const d = Math.sqrt(d2);
    nx = dx / d; ny = dy / d;            // box → circle
    overlap = r - d;
  } else {
    // circle center is inside the box — push it out the shallowest face
    const toR = box.x + box.hw - c.x, toL = c.x - (box.x - box.hw);
    const toB = box.y + box.hh - c.y, toT = c.y - (box.y - box.hh);
    const m = Math.min(toR, toL, toB, toT);
    if (m === toR)      { nx = 1;  ny = 0; overlap = toR + r; }
    else if (m === toL) { nx = -1; ny = 0; overlap = toL + r; }
    else if (m === toB) { nx = 0;  ny = 1; overlap = toB + r; }
    else                { nx = 0;  ny = -1; overlap = toT + r; }
  }
  if (flip) { nx = -nx; ny = -ny; }
  return { nx, ny, overlap, px: bx, py: by };
}

// ---- ray vs shape -------------------------------------------------------------

// Returns [dist, nx, ny] of the first intersection (normal points outward at
// the hit surface), or null. ux/uy must be a unit direction; ox/oy the origin.
function rayShape(ox, oy, ux, uy, bd) {
  if (bd.type === T_AABB) {
    const x0 = bd.x - bd.hw, x1 = bd.x + bd.hw;
    const y0 = bd.y - bd.hh, y1 = bd.y + bd.hh;
    let tNear = -Infinity, tFar = Infinity;
    let eNx = 0, eNy = 0;
    const slabs = [[ux, ox, x0, x1, 1, 0], [uy, oy, y0, y1, 0, 1]];
    for (const [u, o, s0, s1, nx, ny] of slabs) {
      if (Math.abs(u) < 1e-9) {
        if (o < s0 || o > s1) return null;
        continue;
      }
      let t1 = (s0 - o) / u, t2 = (s1 - o) / u;
      let nxn, nyn;
      if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; nxn = nx; nyn = ny; }
      else { nxn = -nx; nyn = -ny; }
      if (t1 > tNear) { tNear = t1; eNx = nxn; eNy = nyn; }
      if (t2 < tFar) tFar = t2;
      if (tNear > tFar || tFar < 0) return null;
    }
    if (tNear < 0) {                       // origin already inside
      const d = Math.hypot(ox - bd.x, oy - bd.y) || 1;
      return [0, (ox - bd.x) / d, (oy - bd.y) / d];
    }
    return [tNear, eNx, eNy];
  }
  // circle
  const dx = ox - bd.x, dy = oy - bd.y;
  const bcoef = dx * ux + dy * uy;
  const c = dx * dx + dy * dy - bd.r * bd.r;
  const disc = bcoef * bcoef - c;
  if (disc < 0) return null;
  const sq = Math.sqrt(disc);
  let t = -bcoef - sq;
  if (t < 0) t = -bcoef + sq;
  if (t < 0) return null;
  const hx = ox + ux * t, hy = oy + uy * t;
  return [t, (hx - bd.x) / bd.r, (hy - bd.y) / bd.r];
}
