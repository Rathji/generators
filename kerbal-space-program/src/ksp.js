// ============================================================================
//  src/ksp.js — KERBAL SPACE PROGRAM · 2D orbital flight sim (VGN arcade shell)
//  ----------------------------------------------------------------------------
//  A mini orbital-mechanics sandbox: launch from a Kerbin-like planet, steer
//  through the atmosphere, stage your rocket, and circularize into orbit.
//  Real 2-body physics (RK2 integration), exponential atmosphere with drag,
//  weathercocking aero stability, a gravity-turn autopilot, live conic orbit
//  display (Ap/Pe from orbital elements), and milestone scoring.
//
//  GAME MODULE API (see index.html): default-export object with
//  init(ctx) / reset(ctx) / update(dt, ctx) / render(g, alpha, ctx)
//  plus getResult() for the shell's game-over screen.
//  ============================================================================

// ---- physical constants (a Kerbin-like world) -------------------------------
const G0 = 9.8;
const PLANET_R = 600000;              // planet radius (m)
const GM = G0 * PLANET_R * PLANET_R;  // gravitational parameter (m³/s²)
const RHO0 = 1.225;                   // sea-level air density (kg/m³)
const ATM_H = 5500;                   // atmospheric scale height (m)
const ATM_TOP = 60000;                // altitude where drag is ~nil (m)
const CD_A = 6.2;                     // drag coefficient × frontal area (m²)

const POD_MASS = 900;                 // kg — crew pod (never staged away)
const STAGES = [                      // index 0 = first stage (bottom)
  { name: 'S1', dry: 1600, fuel: 6500, thrust: 300000, isp: 255 },
  { name: 'S2', dry: 1200, fuel: 6000, thrust: 180000, isp: 300 },
  { name: 'S3', dry:  700, fuel: 3200, thrust:  90000, isp: 320 },
];
const ORBIT_ALT = 100000;             // circularization target (m)
const ORBIT_WIN_PE = 70000;           // periapsis needed to "achieve orbit"

const MILESTONES = [10000, 25000, 50000, 100000, 150000, 200000, 300000, 500000, 1000000];

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (t) => { t = clamp(t, 0, 1); return t * t * (3 - 2 * t); };
const wrapPi = (a) => ((a + Math.PI * 3) % TAU + TAU) % TAU - Math.PI;

const fmtAlt = (m) => (m >= 100000 ? (m / 1000).toFixed(0) + ' km' : (m / 1000).toFixed(1) + ' km');
const fmtAltS = (m) => (m >= 0 ? fmtAlt(m) : '-' + fmtAlt(-m));
const fmtVel = (m) => Math.round(m).toLocaleString('en-US') + ' m/s';
const fmtTime = (s) => {
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
};

// ---- starfield (fixed screen-space scatter, subtle parallax) ----------------
const STARS = [];
function initStars() {
  STARS.length = 0;
  for (let i = 0; i < 150; i++) {
    STARS.push({ x: Math.random() * 480, y: Math.random() * 270, r: Math.random() * 1.1 + 0.3, t: Math.random() * TAU });
  }
}
const G_ROCKS = []; // ground scatter near the pad (world meters)
function initRocks() {
  G_ROCKS.length = 0;
  for (let i = 0; i < 14; i++) {
    G_ROCKS.push({ x: (Math.random() - 0.5) * 150, w: 2 + Math.random() * 5, tone: 0.75 + Math.random() * 0.5 });
  }
}

// ---- fresh flight state -----------------------------------------------------
function makeState() {
  return {
    time: 0,
    pos: { x: 0, y: PLANET_R },
    vel: { x: 0, y: 0 },
    theta: 0,                 // pitch angle from local up (rad)
    prograde: 0,              // velocity direction from local up (rad)
    vr: 0, vt: 0, speed: 0, altitude: 0,
    throttle: 0,
    engineOn: false,
    grounded: true,
    stageIdx: 0,
    stageFuel: STAGES.map(s => s.fuel),
    guidance: true,           // autopilot default ON
    manualWin: false,
    steerTarget: 0,
    steerInput: 0,
    energy: -GM / PLANET_R,
    orbit: { a: 0, e: 0, ra: 0, rp: 0, ex: 0, ey: 0, esc: false },
    circTarget: false,
    coasting: false,
    debris: [],
    trail: [],
    trailTimer: 0,
    claimed: new Set(),
    msgs: [],
    endGameTimer: 0,
    result: null,
    achievedOrbit: false,
    escaped: false,
    crashed: false,
    reachedSpace: false,
    maxAlt: 0,
    maxSpeed: 0,
    forceHud: false,          // debugging/sim hook
  };
}

let shellCtx = null;

const game = {

  init(ctx) {
    shellCtx = ctx;
    initStars();
    initRocks();
    this.state = makeState();
    window.__ksp = {
      get state() { return game.state; },
      reset: () => { game.state = makeState(); },
      step: (n = 1) => { for (let i = 0; i < n && shellCtx; i++) game.update(1 / 60, shellCtx); },
      sim: () => { // fast-forward a full flight with guidance on
        const st = game.state;
        for (let i = 0; i < 400000 && shellCtx; i++) {
          game.update(1 / 60, shellCtx);
          if (st.achievedOrbit || st.escaped || st.result) break;
        }
        return game.getResult();
      },
      hud: () => ({ alt: game.state.altitude, speed: game.state.speed, ap: game.state.orbit.ra - PLANET_R, pe: game.state.orbit.rp - PLANET_R, fuel: game.fuelFrac(), throttle: game.state.throttle, stage: game.state.stageIdx + 1, guidance: game.state.guidance }),
    };
  },

  reset() { this.state = makeState(); },

  fuelFrac() {
    const st = this.state;
    const total = STAGES.reduce((a, s) => a + s.fuel, 0);
    const left = st.stageFuel.reduce((a, f) => a + f, 0);
    return left / total;
  },

  mass() {
    const st = this.state;
    let m = POD_MASS;
    for (let i = st.stageIdx; i < STAGES.length; i++) {
      m += STAGES[i].dry + (i === st.stageIdx ? st.stageFuel[i] : STAGES[i].fuel);
    }
    return m;
  },

  density(alt) {
    return alt <= 0 ? RHO0 : RHO0 * Math.exp(-alt / ATM_H);
  },

  msg(text, gold) {
    this.state.msgs.push({ text, t: 0, gold: !!gold });
  },

  stage(ctx, auto) {
    const st = this.state;
    if (st.stageIdx >= STAGES.length - 1) { this.msg('NO MORE STAGES'); return; }
    const s = STAGES[st.stageIdx];
    const m = s.dry + st.stageFuel[st.stageIdx];
    st.debris.push({ x: st.pos.x, y: st.pos.y, vx: st.vel.x, vy: st.vel.y, m, t: 0 });
    st.stageIdx++;
    this.msg('STAGE ' + (st.stageIdx + 1) + ' SEPARATED');
    if (ctx && ctx.audio) ctx.audio.sfx('jump');
    if (!auto && ctx && ctx.hud) { ctx.hud.addScore(500); st.claimed.add(-st.stageIdx); }
  },

  // ---- autopilot guidance (toggle with G) -----------------------------------
  guidance(ctx) {
    const st = this.state;
    if (!st.guidance) return;
    const stage = STAGES[st.stageIdx];
    if (st.achievedOrbit || st.escaped) { st.engineOn = false; st.throttle = 0; return; }
    if (st.energy > 0) { st.engineOn = false; st.throttle = 0; return; }   // hyperbolic: coast (safety)
    // auto-stage a spent stage during any phase (guidance only)
    if (stage && st.stageFuel[st.stageIdx] < 30 && st.stageIdx < STAGES.length - 1 && st.throttle > 0.05) {
      this.stage(ctx, true);
    }

    // PHASE C — circularization burn at apoapsis
    if (st.circTarget) {
      if (st.orbit.rp - PLANET_R >= ORBIT_ALT - 500) {
        st.circTarget = false;
        st.engineOn = false;
        st.throttle = 0;
        this.msg('CIRCULARIZATION COMPLETE', true);
      } else {
        st.engineOn = true; st.throttle = 1;
        st.steerTarget = st.prograde;
      }
      return;
    }

    const apAlt = st.orbit.ra - PLANET_R;
    // PHASE B — coast toward apoapsis (thrust cut once target Ap reached)
    if (st.coasting) {
      st.engineOn = false;
      st.throttle = 0;
      st.steerTarget = st.prograde;
      if (st.vr < 80 && st.altitude >= apAlt - 4000) {
        st.circTarget = true;
        this.msg('CIRCULARIZING AT APOAPSIS');
      } else if (st.vr < -60) {
        st.circTarget = true;
        this.msg('CIRCULARIZING — FALLING');
      }
      return;
    }

    // PHASE A — powered ascent with a gravity turn
    if (apAlt >= ORBIT_ALT) {
      st.coasting = true;
      st.engineOn = false;
      st.throttle = 0;
      st.steerTarget = st.prograde;
      this.msg('TARGET AP REACHED — COASTING');
      return;
    }
    st.engineOn = true;
    st.throttle = 1;
    // attitude profile (independent of current velocity): pitch over smoothly
    // with altitude; the velocity follows via gravity → classic gravity turn
    const alt = st.altitude;
    let target;
    if (alt < 200) target = 0;
    else if (alt < 1500) target = lerp(0, 0.14, (alt - 200) / 1300);      // turn-in kick
    else target = lerp(0.14, 1.2, Math.min(1, (alt - 1500) / 40000));     // 8° → 69°
    st.steerTarget = target;
  },

  // ---- physics --------------------------------------------------------------
  physics(dt, ctx) {
    const st = this.state;
    const stage = STAGES[st.stageIdx];
    const mass = this.mass();
    const fuelEmpty = !stage || st.stageFuel[st.stageIdx] <= 0;
    const thrusting = st.engineOn && st.throttle > 0 && !fuelEmpty;
    const T = thrusting ? stage.thrust * st.throttle : 0;

    if (thrusting) {
      const rate = stage.thrust / (stage.isp * G0);
      st.stageFuel[st.stageIdx] = Math.max(0, st.stageFuel[st.stageIdx] - rate * dt * st.throttle);
    }

    if (st.grounded) {
      st.pos.x = 0; st.pos.y = PLANET_R;
      st.vel.x = 0; st.vel.y = 0;
      st.theta = lerp(st.theta, 0, clamp(dt * 1.5, 0, 1));
      const weight = GM * mass / (PLANET_R * PLANET_R);
      if (!(thrusting && T > weight * 1.001)) {
        this.stepDebris(dt);
        return;
      }
      st.grounded = false;
      st.maxAlt = 0;
      this.msg('LIFTOFF');
      if (ctx && ctx.audio) ctx.audio.sfx('start');
      // fall through: integrate this frame so we're airborne before checks()
    } else {
      this.stepDebris(dt);
    }

    const { x, y } = st.pos;
    const { x: vx, y: vy } = st.vel;
    const phi = Math.atan2(y, x);
    const upx = Math.cos(phi), upy = Math.sin(phi);
    const c = Math.cos(st.theta), s = Math.sin(st.theta);
    const dx = upx * c - upy * s;    // thrust direction (world)
    const dy = upx * s + upy * c;

    const acc = (px, py, pvx, pvy) => {
      const r2 = px * px + py * py;
      const r = Math.sqrt(r2);
      const alt = r - PLANET_R;
      let ax = -GM * px / (r2 * r), ay = -GM * py / (r2 * r);
      const f = (st.engineOn && st.throttle > 0 && !fuelEmpty) ? stage.thrust * st.throttle / mass : 0;
      ax += dx * f; ay += dy * f;
      const rho = this.density(alt);
      if (rho > 1e-7) {
        const sp2 = pvx * pvx + pvy * pvy;
        const sp = Math.sqrt(sp2);
        if (sp > 1) { const d = 0.5 * rho * sp2 * CD_A / mass; ax -= pvx / sp * d; ay -= pvy / sp * d; }
      }
      return [ax, ay];
    };

    const [a1x, a1y] = acc(x, y, vx, vy);
    const mx = x + vx * dt * 0.5, my = y + vy * dt * 0.5;
    const mvx = vx + a1x * dt * 0.5, mvy = vy + a1y * dt * 0.5;
    const [a2x, a2y] = acc(mx, my, mvx, mvy);
    st.vel.x = vx + a2x * dt;
    st.vel.y = vy + a2y * dt;
    st.pos.x = x + st.vel.x * dt;
    st.pos.y = y + st.vel.y * dt;

    // local-frame velocities + prograde angle
    const r = Math.hypot(st.pos.x, st.pos.y);
    const alt = r - PLANET_R;
    const phi2 = Math.atan2(st.pos.y, st.pos.x);
    const upx2 = Math.cos(phi2), upy2 = Math.sin(phi2);
    const tx = -Math.sin(phi2), ty = Math.cos(phi2);
    const vr = st.vel.x * upx2 + st.vel.y * upy2;
    const vt = st.vel.x * tx + st.vel.y * ty;
    st.prograde = Math.atan2(vt, vr);
    st.vr = vr; st.vt = vt;
    st.altitude = alt;
    st.speed = Math.hypot(st.vel.x, st.vel.y);

    // steering input (manual) vs autopilot target
    if (st.steerInput !== 0) {
      st.theta += st.steerInput * dt * 1.15;
      st.steerTarget = st.theta;
    } else if (st.steerTarget !== null) {
      const maxTurn = 0.25 + 2.0 * clamp(alt / 60000, 0, 1);
      let d = st.steerTarget - st.theta;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      st.theta += clamp(d, -maxTurn * dt, maxTurn * dt);
    }
    // weathercocking: the rocket aligns with its velocity vector in air
    if (st.speed > 30) {
      const rho = this.density(alt);
      const q = 0.5 * rho * st.speed * st.speed;
      const rate = clamp(0.0004 * q, 0, 2.2);
      let d = st.prograde - st.theta;
      while (d > Math.PI) d -= TAU; while (d < -Math.PI) d += TAU;
      st.theta += clamp(d, -rate * dt, rate * dt);
    }
    st.theta = wrapPi(st.theta);

    this.stepDebris(dt);
  },

  stepDebris(dt) {
    const st = this.state;
    for (const d of st.debris) {
      d.t += dt;
      const r2 = d.x * d.x + d.y * d.y;
      const r = Math.sqrt(r2);
      let ax = -GM * d.x / (r2 * r), ay = -GM * d.y / (r2 * r);
      const rho = this.density(r - PLANET_R);
      const sp = Math.hypot(d.vx, d.vy);
      if (rho > 1e-6 && sp > 1) { const dd = 0.5 * rho * sp * sp * CD_A / Math.max(1, d.m); ax -= d.vx / sp * dd; ay -= d.vy / sp * dd; }
      d.vx += ax * dt; d.vy += ay * dt;
      d.x += d.vx * dt; d.y += d.vy * dt;
    }
    st.debris = st.debris.filter(d => d.x * d.x + d.y * d.y > PLANET_R * PLANET_R * 0.9999);
  },

  // ---- orbit elements, ground contact, achievements -------------------------
  checks(ctx) {
    const st = this.state;
    if (st.grounded) return;
    const { x, y } = st.pos;
    const { x: vx, y: vy } = st.vel;
    const r = Math.hypot(x, y);
    const alt = r - PLANET_R;
    const v2 = vx * vx + vy * vy;
    st.maxAlt = Math.max(st.maxAlt, alt);
    st.maxSpeed = Math.max(st.maxSpeed, st.speed);
    st.energy = v2 / 2 - GM / r;
    if (st.energy < 0) {
      const a = -GM / (2 * st.energy);
      const ex = ((v2 - GM / r) * x - (x * vx + y * vy) * vx) / GM;
      const ey = ((v2 - GM / r) * y - (x * vx + y * vy) * vy) / GM;
      const e = Math.hypot(ex, ey);
      st.orbit = { a, e, ra: a * (1 + e), rp: a * (1 - e), ex, ey, esc: false, omega: Math.atan2(ey, ex) };
    } else {
      st.orbit = { a: 0, e: 1, ra: 1e9, rp: 1e9, ex: 0, ey: 0, esc: true, omega: 0 };
    }

    // ground contact
    if (alt <= 0) {
      if (st.speed < 35) {
        st.grounded = true;
        st.pos.x = 0; st.pos.y = PLANET_R;
        st.vel.x = 0; st.vel.y = 0;
        st.theta = 0;
        if (st.result !== 'crash') st.result = 'landed';
      } else if (st.result !== 'crash') {
        st.result = 'crash';
        st.endGameTimer = 0.9;
        this.msg('CRASHED!');
        if (ctx && ctx.audio) ctx.audio.sfx('gameover');
      }
    }

    if (st.result) return;

    // altitude milestones
    for (const m of MILESTONES) {
      if (!st.claimed.has(m) && alt >= m) {
        st.claimed.add(m);
        const pts = m >= 300000 ? 10000 : m >= 100000 ? 5000 : 2000;
        ctx.hud.addScore(pts);
        this.msg('ALTITUDE ' + fmtAlt(m) + '  +' + pts, true);
        if (ctx.audio) ctx.audio.sfx('coin');
      }
    }
    if (!st.reachedSpace && alt > 100000) {
      st.reachedSpace = true;
      st.claimed.add('space');
      ctx.hud.addScore(5000);
      this.msg('REACHED SPACE  +5000', true);
      if (ctx.audio) ctx.audio.sfx('coin');
    }

    // ORBIT ACHIEVED — Pe above the atmosphere AND speed near circular
    // (this only becomes true once the circularization burn has actually
    // raised the periapsis, not while the ship is still on a steep arc)
    const vcirc = Math.sqrt(GM / r);
    const nearCirc = Math.abs(st.speed - vcirc) / vcirc < 0.22;
    if (!st.achievedOrbit && !st.orbit.esc && (st.orbit.rp - PLANET_R) > ORBIT_WIN_PE && alt > ORBIT_WIN_PE && nearCirc && st.time > 8) {
      st.achievedOrbit = true;
      st.endGameTimer = 1.8;
      this.msg('ORBIT ACHIEVED!  +30000', true);
      ctx.hud.addScore(30000);
      st.manualWin = !st.guidance;                       // guidance off at the win = full-pilot flight
      if (st.manualWin) { ctx.hud.addScore(5000); this.msg('+5000 MANUAL PILOT', true); }
      if (ctx.audio) ctx.audio.sfx('coin');
    }
    // ESCAPED
    if (!st.escaped && st.orbit.esc && r > PLANET_R * 4) {
      st.escaped = true;
      st.endGameTimer = 1.8;
      this.msg('ESCAPED KERBIN!  +50000', true);
      ctx.hud.addScore(50000);
      if (ctx.audio) ctx.audio.sfx('coin');
    }
  },

  // ---- shell hook: full frame update (fixed 60 Hz while PLAYING) ------------
  update(dt, ctx) {
    const st = this.state;
    if (!st) return;
    st.time += dt;
    st.trailTimer -= dt;

    const inp = ctx.input;
    if (inp.pressed('throttleToggle')) {
      st.engineOn = !st.engineOn;
      if (st.engineOn && st.throttle === 0) st.throttle = 0.5;
      if (ctx.audio) ctx.audio.sfx('move');
    }
    if (inp.isDown('up')) st.throttle = clamp(st.throttle + dt * 1.2, 0, 1);
    if (inp.isDown('down')) st.throttle = clamp(st.throttle - dt * 1.2, 0, 1);
    const steer = (inp.isDown('left') ? -1 : 0) + (inp.isDown('right') ? 1 : 0);
    if (steer !== 0 && st.guidance) {
      st.guidance = false;
      this.msg('GUIDANCE OFF — MANUAL');
    }
    st.steerInput = steer;
    if (inp.pressed('guidance')) {
      st.guidance = !st.guidance;
      this.msg('GUIDANCE ' + (st.guidance ? 'ON' : 'OFF'));
      if (ctx.audio) ctx.audio.sfx('select');
    }
    if (inp.pressed('stage')) this.stage(ctx, false);

    this.guidance(ctx);
    this.physics(dt, ctx);
    this.checks(ctx);

    if (st.trailTimer <= 0) {
      st.trail.push({ x: st.pos.x, y: st.pos.y });
      if (st.trail.length > 900) st.trail.shift();
      st.trailTimer = 0.2;
    }

    for (const m of st.msgs) m.t += dt;
    st.msgs = st.msgs.filter(m => m.t < 2.6);

    if (st.endGameTimer > 0) {
      st.endGameTimer -= dt;
      if (st.endGameTimer <= 0) ctx.gameOver();
    }

    ctx.hud.setTimer(st.time);
    ctx.hud.setLives(st.stageIdx + 1);
  },

  // ---- rendering ------------------------------------------------------------
  getCam() {
    const st = this.state;
    const alt = st.altitude;
    const extent = Math.max(st.orbit.ra, PLANET_R * 1.15, 300000);
    const mapHalf = Math.max(extent * 1.6, 700000);            // half-height to fit the whole trajectory
    // continuous zoom: pad-level close-up that pulls back with altitude until
    // the whole planet + orbit fit on screen (like a KSP chase cam pulling out)
    const halfView = Math.min(60 * Math.pow(mapHalf / 60, Math.min(1, alt / 25000)), mapHalf);
    const s = 135 / halfView;
    // camera: ship-centered when zoomed in, planet-centered when zoomed out
    const k = smooth(clamp((halfView - 60000) / 90000, 0, 1));
    const camX = lerp(st.pos.x, st.pos.x * 0.12, k);
    const camY = lerp(st.pos.y, st.pos.y * 0.12, k);
    const offY = lerp(168, 135, k);
    return { s, camX, camY, offY, halfView };
  },

  w2s(g, x, y) {
    const cam = this._cam;
    return [240 + (x - cam.camX) * cam.s, cam.offY + (cam.camY - y) * cam.s];
  },

  render(g, alpha, ctx) {
    const st = this.state;
    if (!st) return;
    this._cam = this.getCam();
    const cam = this._cam;
    const playing = ctx && ctx.state ? ctx.state() === 'PLAYING' : false;
    const drawHud = playing || st.forceHud;

    // ---- starfield
    g.fillStyle = '#070310';
    g.fillRect(0, 0, 480, 270);
    const par = 14 * (st.pos.x / PLANET_R);
    for (const s of STARS) {
      const x = ((s.x + par * 0.4 + 480 * 3) % 480) - par * 0.4;
      const y = ((s.y + par * 0.2 + 270 * 3) % 270) - par * 0.2;
      const tw = 0.5 + 0.5 * Math.sin(s.t + performance.now() / 700 + s.x);
      g.fillStyle = 'rgba(255,255,255,' + (0.35 + 0.5 * tw) + ')';
      g.fillRect(x, y, s.r, s.r);
    }
    g.fillStyle = 'rgba(140,160,255,0.06)';
    g.fillRect(0, 0, 480, 270);

    // near (flat ground) and map (planet disk) views overlap in the mid range —
    // both are tan at the seam so the transition is seamless
    if (cam.halfView < 150000) this.drawNearView(g, cam);
    if (cam.halfView > 80000) this.drawMapView(g, cam);

    // ---- orbit path (once it fits on screen)
    const orbitFit = Math.max(st.orbit.ra, PLANET_R * 1.15) * 1.15;
    if (cam.halfView >= orbitFit) this.drawOrbit(g);

    // ---- trail
    this.drawTrail(g, cam);

    // ---- debris
    for (const d of st.debris) {
      const [sx, sy] = this.w2s(g, d.x, d.y);
      const r = Math.max(1, Math.min(4, cam.s * 14));
      g.fillStyle = 'rgba(160,160,165,0.9)';
      g.fillRect(sx - r, sy - r, r * 2, r * 2);
    }

    // ---- ship
    this.drawShip(g, cam);

    if (drawHud) this.drawHud(g);

    // ---- event banners
    let i = 0;
    for (const m of st.msgs) {
      const a = m.t < 0.3 ? m.t / 0.3 : m.t > 2.0 ? (2.6 - m.t) / 0.6 : 1;
      g.globalAlpha = a * a;
      g.font = 'bold 13px VT323, monospace';
      g.textAlign = 'center';
      g.fillStyle = m.gold ? '#ffd23e' : '#2de1ff';
      g.shadowColor = '#000'; g.shadowBlur = 6;
      g.fillText(m.text, 240, 58 + i * 18);
      g.shadowBlur = 0;
      g.globalAlpha = 1;
      i++;
    }
  },

  drawNearView(g, cam) {
    const st = this.state;
    const s = cam.s;
    const groundY = cam.offY + (cam.camY - PLANET_R) * s;
    // sky glow just above the horizon
    const glowH = 70;
    const sky = g.createLinearGradient(0, groundY - glowH, 0, groundY);
    sky.addColorStop(0, 'rgba(20,40,110,0)');
    sky.addColorStop(1, 'rgba(90,140,230,0.55)');
    g.fillStyle = sky;
    g.fillRect(0, groundY - glowH, 480, glowH);
    // ground
    const grd = g.createLinearGradient(0, groundY, 0, groundY + 120);
    grd.addColorStop(0, '#8a6a42');
    grd.addColorStop(1, '#4a3520');
    g.fillStyle = grd;
    g.fillRect(0, groundY, 480, 270 - groundY);
    // ground scatter (rocks)
    for (const r of G_ROCKS) {
      const [sx, sy] = this.w2s(g, r.x, PLANET_R);
      if (sx < -10 || sx > 490) continue;
      g.fillStyle = 'rgba(60,42,26,0.8)';
      g.fillRect(sx - r.w * s * 0.5, sy - r.w * s * 0.35, r.w * s, r.w * s * 0.7);
    }
    // launch pad + gantry (near the pad only)
    if (st.pos.x * s < 250) {
      this.drawPad(g, cam);
    }
  },

  drawPad(g, cam) {
    const s = cam.s;
    const [px, py] = this.w2s(g, 0, PLANET_R);   // pad center on the ground
    const W = 30 * s, H = 6 * s;
    g.fillStyle = '#9aa0a8';
    g.fillRect(px - W / 2, py - H, W, H);
    g.fillStyle = '#6b7178';
    g.fillRect(px - W / 2 - 3, py - 2, W + 6, 2);
    // gantry tower
    g.strokeStyle = '#c8ccd2';
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(px + W / 2 - 4, py);
    g.lineTo(px + W / 2 + 8, py - 58);
    g.moveTo(px + W / 2 - 4, py);
    g.lineTo(px + W / 2 + 14, py - 56);
    g.stroke();
    g.fillStyle = '#3b4150';
    for (let i = 0; i < 5; i++) {
      g.fillRect(px + W / 2 + 6 + i * 2, py - 10 - i * 10, 1.5, 10);
    }
  },

  drawMapView(g, cam) {
    const s = cam.s;
    const [cx, cy] = this.w2s(g, 0, 0);
    const rPx = PLANET_R * s;
    const rAtm = (PLANET_R + ATM_TOP) * s;
    // atmosphere glow
    const grad = g.createRadialGradient(cx, cy, rPx, cx, cy, rAtm);
    grad.addColorStop(0, 'rgba(120,180,255,0.25)');
    grad.addColorStop(1, 'rgba(120,180,255,0)');
    g.fillStyle = grad;
    g.beginPath(); g.arc(cx, cy, rAtm, 0, TAU); g.fill();
    // planet
    const pg = g.createRadialGradient(cx - rPx * 0.3, cy - rPx * 0.3, rPx * 0.1, cx, cy, rPx);
    pg.addColorStop(0, '#e8d8b0');
    pg.addColorStop(0.8, '#d3bd8f');
    pg.addColorStop(1, '#9a8358');
    g.fillStyle = pg;
    g.beginPath(); g.arc(cx, cy, rPx, 0, TAU); g.fill();
    g.strokeStyle = 'rgba(90,74,40,0.8)';
    g.lineWidth = 1;
    g.beginPath(); g.arc(cx, cy, rPx, 0, TAU); g.stroke();
    // launch site dot
    const [lx, ly] = this.w2s(g, 0, PLANET_R);
    g.fillStyle = '#fff';
    g.fillRect(lx - 1.5, ly - 1.5, 3, 3);
    g.fillStyle = '#000';
    g.font = '8px VT323, monospace';
    g.textAlign = 'center';
    g.fillText('KSC', lx, ly - 4);
  },

  drawOrbit(g) {
    const st = this.state;
    if (!st.orbit || st.orbit.esc) return;
    const o = st.orbit;
    if (o.e >= 0.999) return;
    const ux = Math.cos(o.omega), uy = Math.sin(o.omega);
    const vx = -Math.sin(o.omega), vy = Math.cos(o.omega);
    const b = Math.sqrt(Math.max(0, 1 - o.e * o.e));
    // current true anomaly → eccentric anomaly
    const r = Math.hypot(st.pos.x, st.pos.y);
    const cosNu = clamp((o.ex * st.pos.x + o.ey * st.pos.y) / (o.e * r), -1, 1);
    const sinNu = st.vr < 0 ? -Math.sqrt(Math.max(0, 1 - cosNu * cosNu)) : Math.sqrt(Math.max(0, 1 - cosNu * cosNu));
    const nu0 = Math.atan2(sinNu, cosNu);
    const E0 = 2 * Math.atan2(Math.sqrt(1 - o.e) * Math.sin(nu0 / 2), Math.sqrt(1 + o.e) * Math.cos(nu0 / 2));
    const N = 120;
    g.strokeStyle = 'rgba(255,210,62,0.85)';
    g.lineWidth = 1.5;
    g.beginPath();
    for (let i = 0; i <= N; i++) {
      const E = E0 + (i / N) * TAU;
      const px = o.a * (Math.cos(E) - o.e);
      const py = o.a * b * Math.sin(E);
      const wx = px * ux + py * vx;
      const wy = px * uy + py * vy;
      const [sx, sy] = this.w2s(g, wx, wy);
      if (i === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy);
    }
    g.stroke();
    // periapsis / apoapsis markers
    for (const [tag, rr] of [['Ap', o.ra], ['Pe', Math.max(o.rp, PLANET_R * 1.001)]]) {
      const [sx, sy] = this.w2s(g, rr * ux, rr * uy);
      g.fillStyle = '#2de1ff';
      g.fillRect(sx - 2, sy - 2, 4, 4);
      g.font = '9px VT323, monospace';
      g.textAlign = 'center';
      g.fillText(tag, sx, sy - 6);
    }
  },

  drawTrail(g, cam) {
    const st = this.state;
    if (st.trail.length < 2) return;
    if (cam.halfView >= 150000) {
      g.strokeStyle = 'rgba(255,255,255,0.55)';
      g.lineWidth = 1;
      g.beginPath();
      for (let i = 0; i < st.trail.length; i++) {
        const [sx, sy] = this.w2s(g, st.trail[i].x, st.trail[i].y);
        if (i === 0) g.moveTo(sx, sy); else g.lineTo(sx, sy);
      }
      g.stroke();
    } else {
      for (let i = 0; i < st.trail.length; i++) {
        const t = st.trail[i];
        const dx = t.x - st.pos.x, dy = t.y - st.pos.y;
        if (dx * dx + dy * dy > 4e10) continue;
        const [sx, sy] = this.w2s(g, t.x, t.y);
        const a = clamp(1 - Math.hypot(dx, dy) / 200000, 0, 1);
        g.fillStyle = 'rgba(255,255,255,' + (0.5 * a) + ')';
        g.fillRect(sx, sy, 1.5, 1.5);
      }
    }
  },

  drawShip(g, cam) {
    const st = this.state;
    const [sx, sy] = this.w2s(g, st.pos.x, st.pos.y);
    const phi = Math.atan2(st.pos.y, st.pos.x);
    const upx = Math.cos(phi), upy = Math.sin(phi);
    const c = Math.cos(st.theta), s = Math.sin(st.theta);
    const dx = upx * c - upy * s;
    const dy = upx * s + upy * c;
    const burning = st.engineOn && st.throttle > 0 && st.stageIdx < STAGES.length && st.stageFuel[st.stageIdx] > 0;

    if (cam.halfView >= 400) {
      // map/chase marker (ship too small to draw the full rocket)
      const rot = Math.atan2(dx, -dy);
      g.save();
      g.translate(sx, sy);
      g.rotate(rot);
      g.fillStyle = '#ffffff';
      g.beginPath();
      g.moveTo(0, -7); g.lineTo(5, 6); g.lineTo(-5, 6);
      g.closePath(); g.fill();
      g.fillStyle = '#39ff6e';
      g.beginPath(); g.arc(0, 0, 1.8, 0, TAU); g.fill();
      if (burning) { g.fillStyle = '#ff9f2e'; g.fillRect(-1.5, 6, 3, 4 + st.throttle * 5); }
      g.restore();
      return;
    }

    const rot = Math.atan2(dx, -dy);
    g.save();
    g.translate(sx, sy);
    g.rotate(rot);

    const L = 38;   // rocket length in px
    const half = L / 2;
    // flame
    if (burning) {
      const fl = (8 + 7 * Math.random()) * (0.5 + st.throttle);
      const fg = g.createLinearGradient(0, half - 2, 0, half + fl);
      fg.addColorStop(0, '#fff7e0');
      fg.addColorStop(0.4, '#ffb347');
      fg.addColorStop(1, 'rgba(255,90,20,0)');
      g.fillStyle = fg;
      g.beginPath();
      g.moveTo(-4, half - 2);
      g.quadraticCurveTo(-2.5, half + fl * 0.7, 0, half + fl);
      g.quadraticCurveTo(2.5, half + fl * 0.7, 4, half - 2);
      g.closePath(); g.fill();
      // glow
      const gl = g.createRadialGradient(0, half, 2, 0, half, 16 + fl * 0.4);
      gl.addColorStop(0, 'rgba(255,180,80,0.5)');
      gl.addColorStop(1, 'rgba(255,180,80,0)');
      g.fillStyle = gl;
      g.beginPath(); g.arc(0, half, 16 + fl * 0.4, 0, TAU); g.fill();
    }

    // stage geometry (bottom-up), only remaining stages
    const geom = [
      { y0: half - 12, y1: half, w: 7 },       // S1
      { y0: half - 22, y1: half - 12, w: 6 },  // S2
      { y0: half - 32, y1: half - 22, w: 5 },  // S3
    ];
    const metals = ['#d6d9de', '#e2e4e8', '#eceef2'];
    for (let i = 0; i < 3; i++) {
      const gidx = st.stageIdx + i;
      if (gidx >= 3) break;
      const seg = geom[i];
      g.fillStyle = metals[gidx];
      g.fillRect(-seg.w / 2, seg.y0, seg.w, seg.y1 - seg.y0);
      g.fillStyle = 'rgba(0,0,0,0.25)';
      g.fillRect(-seg.w / 2, seg.y1 - 1, seg.w, 1);
      // engine bell (bottom of each stage)
      g.fillStyle = '#3a3f46';
      g.beginPath();
      g.moveTo(-seg.w / 2 + 1, seg.y1);
      g.lineTo(-seg.w / 2 - 1.5, seg.y1 + 2.5);
      g.lineTo(seg.w / 2 + 1.5, seg.y1 + 2.5);
      g.lineTo(seg.w / 2 - 1, seg.y1);
      g.closePath(); g.fill();
    }
    // fins on the booster
    if (st.stageIdx === 0) {
      g.fillStyle = '#c0342e';
      g.beginPath();
      g.moveTo(-3.5, half - 6); g.lineTo(-8.5, half - 0.5); g.lineTo(-3.5, half - 2); g.closePath(); g.fill();
      g.beginPath();
      g.moveTo(3.5, half - 6); g.lineTo(8.5, half - 0.5); g.lineTo(3.5, half - 2); g.closePath(); g.fill();
    }
    // crew pod + kerbal
    g.fillStyle = '#f0f2f5';
    g.beginPath();
    g.arc(0, -half + 3.5, 3.4, 0, TAU);
    g.fill();
    g.fillStyle = '#39ff6e';
    g.beginPath(); g.arc(0, -half + 3.5, 1.5, 0, TAU); g.fill();
    g.fillStyle = '#111';
    g.fillRect(-0.7, -half + 3.8, 0.7, 0.7);
    g.fillRect(0.3, -half + 3.8, 0.7, 0.7);

    // on the pad: hold-down smoke puffs
    if (st.grounded && burning && st.theta < 0.2) {
      for (let i = 0; i < 3; i++) {
        const px = (Math.random() - 0.5) * 26;
        const pr = 3 + Math.random() * 6;
        g.fillStyle = 'rgba(220,220,225,' + (0.35 - Math.random() * 0.15) + ')';
        g.beginPath(); g.arc(px, half + 3, pr, 0, TAU); g.fill();
      }
    }
    g.restore();
  },

  drawHud(g) {
    const st = this.state;
    const y0 = 270 - 36;
    g.fillStyle = 'rgba(3,6,18,0.62)';
    g.fillRect(0, y0, 480, 36);
    g.strokeStyle = 'rgba(45,225,255,0.35)';
    g.lineWidth = 1;
    g.beginPath(); g.moveTo(0, y0); g.lineTo(480, y0); g.stroke();

    const stg = STAGES[st.stageIdx];
    const fuelF = st.stageFuel[st.stageIdx] / (stg ? stg.fuel : 1);
    const engState = st.engineOn ? (st.throttle > 0 && fuelF > 0 ? 'BURN' : 'IDLE') : 'ENGINE OFF';

    g.font = '12px VT323, monospace';
    g.fillStyle = '#e8e3ff';
    g.textAlign = 'left';
    g.fillText('T+' + fmtTime(st.time) + '  STAGE ' + (st.stageIdx + 1) + '/3', 8, y0 + 12);
    g.textAlign = 'right';
    g.fillStyle = st.guidance ? '#39ff6e' : '#ffd23e';
    g.fillText('GUIDANCE ' + (st.guidance ? 'ON' : 'OFF'), 472, y0 + 12);

    g.textAlign = 'left';
    g.fillStyle = '#fff';
    g.font = '12px VT323, monospace';
    g.fillText('ALT ' + fmtAlt(st.altitude), 8, y0 + 25);
    g.fillText('VEL ' + fmtVel(st.speed), 88, y0 + 25);
    g.fillText('AP ' + fmtAltS(st.orbit.ra - PLANET_R), 188, y0 + 25);
    g.fillText('PE ' + fmtAltS(st.orbit.rp - PLANET_R), 288, y0 + 25);

    // throttle + fuel bars
    this.drawBar(g, 8, y0 + 29, 60, 4, st.throttle, '#ffb347');
    this.drawBar(g, 84, y0 + 29, 60, 4, fuelF, '#39ff6e');
    g.font = '9px VT323, monospace';
    g.fillStyle = '#9f96c9';
    g.fillText(Math.round(st.throttle * 100) + '%', 74, y0 + 33);
    g.fillText(Math.round(fuelF * 100) + '%', 150, y0 + 33);
    g.fillStyle = '#cfc6ff';
    g.fillText(engState, 250, y0 + 33);
    g.textAlign = 'right';
    g.fillStyle = st.orbit.esc ? '#ff5b5b' : '#9f96c9';
    g.fillText(st.orbit.esc ? 'ESCAPING' : (st.grounded ? 'ON PAD — SPACE TO IGNITE' : ''), 472, y0 + 33);
  },

  drawBar(g, x, y, w, h, frac, color) {
    g.fillStyle = 'rgba(255,255,255,0.18)';
    g.fillRect(x, y, w, h);
    g.fillStyle = color;
    g.fillRect(x, y, w * clamp(frac, 0, 1), h);
  },

  getResult() {
    const st = this.state;
    let title;
    if (st.achievedOrbit) title = 'ORBIT ACHIEVED!';
    else if (st.escaped) title = 'ESCAPED KERBIN!';
    else if (st.result === 'crash') title = 'MISSION FAILED';
    else title = 'LAUNCH COMPLETE';
    const lines = [
      'APEX ' + fmtAlt(st.maxAlt) + ' · MAX ' + fmtVel(st.maxSpeed),
      'MISSION TIME ' + fmtTime(st.time),
      'MILESTONES ' + st.claimed.size,
      st.achievedOrbit ? 'ORBIT ✓' : (st.escaped ? 'ORBIT — ESCAPED' : 'NO ORBIT'),
      st.manualWin ? '★ FULLY MANUAL PILOT' : 'GUIDANCE USED',
    ];
    return { title, lines };
  },
};

export default game;
