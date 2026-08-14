// 50-ui.js — overlays, HUD, setup screen, turn orchestration
(function () {
  "use strict";

  const SE = window.SE, W = SE.W, H = SE.H;

  const U = SE.ui = {
    config: { n: 4, humans: [true, true, false, false], difficulty: "medium" },
    active: null,
    aiming: false,
    bannerTO: null,
  };

  const $ = SE.$;

  // ── overlays ─────────────────────────────────────────────
  function show(name) {
    $("titleOverlay").classList.toggle("hidden", name !== "title");
    $("setupOverlay").classList.toggle("hidden", name !== "setup");
    $("overOverlay").classList.toggle("hidden", name !== "over");
  }

  U.banner = function (text, cls) {
    const el = $("banner");
    el.textContent = text;
    el.className = "show" + (cls ? " " + cls : "");
    clearTimeout(U.bannerTO);
    U.bannerTO = setTimeout(() => { el.className = ""; }, 1700);
  };

  // ── setup screen ──────────────────────────────────────────
  const WEAPON_ORDER = ["normal", "baby", "big", "shotgun", "missile", "napalm", "nuke"];

  function buildPlayerRows() {
    const c = U.config;
    const box = $("playerRows");
    box.innerHTML = "";
    while (c.humans.length < c.n) c.humans.push(false);
    if (c.humans.length > c.n) c.humans.length = c.n;
    for (let i = 0; i < c.n; i++) {
      const row = document.createElement("div");
      row.className = "prow" + (c.humans[i] ? "" : " cpu");
      row.innerHTML =
        '<span class="pdot" style="background:' + SE.PALETTE[i % SE.PALETTE.length] + '"></span>' +
        '<span class="pname">' + (c.humans[i] ? "PLAYER " + (i + 1) : "CPU " + (i + 1)) + "</span>" +
        '<button class="ptype">' + (c.humans[i] ? "HUMAN" : "CPU") + "</button>";
      const btn = row.querySelector(".ptype");
      btn.onclick = () => {
        c.humans[i] = !c.humans[i];
        buildPlayerRows();
        SE.sfx("click");
      };
      box.appendChild(row);
    }
  }

  function openSetup() {
    SE.state = "setup";
    buildPlayerRows();
    setDiff();
    show("setup");
  }

  function setDiff() {
    document.querySelectorAll(".dif").forEach((b) => {
      b.classList.toggle("on", b.dataset.dif === U.config.difficulty);
    });
  }

  function aiName() {
    try {
      const s = "[aiNameAdj] [aiNameNoun]".evaluateItem;
      return s.trim() ? s : "CPU Tank";
    } catch (e) {
      return "CPU Tank";
    }
  }

  // ── battle setup ──────────────────────────────────────────
  function startBattle() {
    const c = U.config;
    SE.terrain.generate();
    SE.terrain.render();
    const tanks = [];
    const n = c.n;
    for (let i = 0; i < n; i++) {
      const x = SE.clamp(Math.round(W * (i + 1) / (n + 1) + SE.rand(-26, 26)), 40, W - 40);
      const human = c.humans[i];
      const tank = SE.ent.createTank({
        id: i,
        name: human ? "P" + (i + 1) : aiName(),
        color: SE.PALETTE[i % SE.PALETTE.length],
        x,
        y: SE.terrain.groundAt(x),
        ai: !human,
      });
      tank.angle = 45 + SE.rand(-10, 10);
      tanks.push(tank);
    }
    // face nearest enemy
    for (const t of tanks) {
      let best = null, bd = 1e9;
      for (const o of tanks) {
        if (o === t) continue;
        const d = Math.abs(o.x - t.x);
        if (d < bd) { bd = d; best = o; }
      }
      if (best) t.angle = SE.ent.angleTo(t, best);
    }
    SE.ent.tanks = tanks;
    SE.ent.explosions.length = 0;
    SE.ent.particles.length = 0;
    SE.battle = {
      tanks,
      idx: 0,
      turn: 1,
      wind: SE.rand(-4, 4),
      flying: [],
      fires: [],
      currentTank: null,
      lastShooter: null,
      paused: false,
      flash: 0,
    };
    show("none");
    SE.state = "battle";
    SE.sfx("click");
    U.updateHud();
    SE.runGame();
  }

  // ── turn orchestration ────────────────────────────────────
  async function waitFlying() {
    const b = SE.battle;
    const start = Date.now();
    while (b.flying.length && Date.now() - start < 25000) {
      await SE.sleep(25);
    }
    b.flying = [];
  }

  SE.runGame = async function () {
    const gen = ++SE.battleGen;
    const b = SE.battle;
    b.turn = 1;
    while (gen === SE.battleGen) {
      const alive = b.tanks.filter((t) => t.alive);
      if (alive.length <= 1) break;
      let t = null;
      for (let k = 0; k < b.tanks.length; k++) {
        const cand = b.tanks[(b.idx + k) % b.tanks.length];
        if (cand.alive) { t = cand; b.idx = (b.idx + k + 1) % b.tanks.length; break; }
      }
      if (!t) break;
      b.currentTank = t;
      b.wind = SE.clamp(b.wind + SE.rand(-5, 5), -10, 10);
      U.updateHud();
      if (t.ai) {
        U.banner(t.name + " AIMS", "turn");
        await SE.ai.thinkAndFire(t);
      } else {
        U.banner("YOUR TURN — " + t.name, "turn");
        await U.playerTurn(t);
      }
      await waitFlying();
      if (gen !== SE.battleGen) return;
      await SE.sleep(600);
      b.turn++;
    }
    if (gen !== SE.battleGen) return;
    const winner = b.tanks.find((t) => t.alive) || null;
    U.showGameOver(winner);
  };

  // ── human turn ────────────────────────────────────────────
  U.playerTurn = (tank) => new Promise((resolve) => {
    const active = { tank, timer: 40, fired: false, resolve };
    U.active = active;

    const iv = setInterval(() => {
      if (SE.state !== "battle" || U.active !== active) { clearInterval(iv); return; }
      pollInput(tank);
      U.updateHud();
      active.timer -= 0.05;
      if (active.timer <= 0) fire();
    }, 50);

    function finish() {
      clearInterval(iv);
      if (U.active === active) U.active = null;
    }
    function fire() {
      if (active.fired) return;
      if (!SE.ent.fireWeapon(tank)) {
        U.banner("OUT OF AMMO — SWITCHING", "dest");
        cycleWeapon(tank, 1);
        U.updateHud();
        return;
      }
      active.fired = true;
      finish();
      active.resolve();
    }
    U.fireActive = fire;
    U.passActive = () => {
      if (active.fired) return;
      active.fired = true;
      U.banner(tank.name + " PASSES", "turn");
      finish();
      active.resolve();
    };
  });

  function pollInput(tank) {
    const inp = SE.input;
    if (inp.pressed.KeyW || inp.pressed.ArrowUp) tank.angle = SE.clamp(tank.angle + 2, 1, 180);
    if (inp.pressed.KeyS || inp.pressed.ArrowDown) tank.angle = SE.clamp(tank.angle - 2, 1, 180);
    if (inp.pressed.KeyA || inp.pressed.ArrowLeft) tank.power = SE.clamp(tank.power - 2, 10, 100);
    if (inp.pressed.KeyD || inp.pressed.ArrowRight) tank.power = SE.clamp(tank.power + 2, 10, 100);
    if (inp.pressed.KeyQ || inp.pressed.BracketLeft) cycleWeapon(tank, -1);
    if (inp.pressed.KeyE || inp.pressed.BracketRight) cycleWeapon(tank, 1);
    if (inp.pressed.Space || inp.pressed.Enter) U.fireActive && U.fireActive();
  }

  function cycleWeapon(tank, dir) {
    const order = WEAPON_ORDER;
    let i = order.indexOf(tank.weapon);
    if (i < 0) i = 0;
    for (let k = 0; k < order.length; k++) {
      i = (i + dir + order.length) % order.length;
      if (tank.ammo[order[i]] > 0) {
        tank.weapon = order[i];
        SE.sfx("switch");
        U.updateHud();
        return;
      }
    }
  }

  // ── HUD ──────────────────────────────────────────────────
  U.updateHud = function () {
    const b = SE.battle;
    if (!b) return;
    const t = b.currentTank;
    $("turnBox").textContent = "TURN " + b.turn + " · " + (t ? t.name : "—");
    // wind
    $("windVal").textContent = Math.abs(Math.round(b.wind));
    $("windArrow").textContent = b.wind > 0.5 ? "→" : b.wind < -0.5 ? "←" : "·";
    $("windArrow").style.fontSize = (12 + Math.abs(b.wind) * 1.6) + "px";
    // roster
    const roster = $("roster");
    roster.innerHTML = "";
    for (const tank of b.tanks) {
      const chip = document.createElement("div");
      chip.className = "roster-chip" + (tank.alive ? "" : " dead");
      const pct = Math.max(0, tank.hp);
      chip.innerHTML =
        '<span class="rdot" style="background:' + tank.color + '"></span>' +
        '<span class="rname">' + SE.esc(tank.name) + "</span>" +
        '<span class="rhp"><span class="rbar" style="background:' + (pct > 50 ? "#4cde3c" : pct > 25 ? "#f2c234" : "#e40000") + ';width:' + pct + '%"></span></span>';
      roster.appendChild(chip);
    }
    // weapon chips
    if (t) {
      document.querySelectorAll(".wp").forEach((chip) => {
        const key = chip.dataset.w;
        const ammo = t.ammo[key];
        chip.classList.toggle("active", t.weapon === key);
        chip.classList.toggle("out", !(ammo > 0));
        chip.querySelector(".wp-ammo").textContent = (SE.WEAPONS[key].ammo === Infinity) ? "∞" : "x" + ammo;
      });
      $("aimAng").textContent = "ANGLE " + Math.round(t.angle) + "°";
      $("aimPow").textContent = "POWER " + Math.round(t.power);
      $("aimTimer").textContent = (U.active && !U.active.fired && U.active.tank === t) ? Math.ceil(U.active.timer) + "s" : "";
    }
    $("passBtn").disabled = !(U.active && U.active.tank && !U.active.tank.ai);
  };

  // ── game over ─────────────────────────────────────────────
  U.showGameOver = function (winner) {
    const b = SE.battle;
    b.paused = true;
    if (winner) {
      $("overWinner").textContent = winner.name + " WINS THE BATTLE!";
      SE.sfx("win");
    } else {
      $("overWinner").textContent = "STALEMATE — BOTH SIDES DESTROYED";
    }
    const stats = $("overStats");
    stats.innerHTML = "";
    const sorted = b.tanks.slice().sort((a, b) => b.damage - a.damage);
    for (const tank of sorted) {
      const row = document.createElement("div");
      row.className = "ostat" + (tank.alive ? " winner" : " dead");
      row.innerHTML =
        '<span class="sdot" style="background:' + tank.color + '"></span>' +
        '<span class="sname">' + SE.esc(tank.name) + (tank.alive ? " ★" : "") + "</span>" +
        '<span class="skills">' + tank.kills + " KILL" + (tank.kills === 1 ? "" : "S") + "</span>" +
        '<span class="skills">' + Math.round(tank.damage) + " DMG</span>";
      stats.appendChild(row);
    }
    show("over");
  };

  // ── pointer aiming ────────────────────────────────────────
  function updateAim(e) {
    const b = SE.battle;
    const t = b && b.currentTank;
    if (!t || t.ai || !U.active) return;
    const rect = SE.cv.getBoundingClientRect();
    const px = (e.clientX - rect.left) / rect.width * W;
    const py = (e.clientY - rect.top) / rect.height * H;
    const dx = px - t.x, dy = py - (t.y - 7);
    t.angle = SE.clamp(Math.round(Math.atan2(-dy, dx) * 180 / Math.PI), 1, 179);
    t.power = SE.clamp(Math.round(Math.hypot(dx, dy) / (W * 0.5) * 100), 10, 100);
    U.updateHud();
  }

  SE.cv.addEventListener("pointerdown", (e) => {
    if (SE.state !== "battle") return;
    const b = SE.battle;
    if (!b || b.flying.length) return;
    const t = b.currentTank;
    if (!t || t.ai || !U.active || U.active.fired) return;
    U.aiming = true;
    SE.cv.setPointerCapture(e.pointerId);
    updateAim(e);
  });
  SE.cv.addEventListener("pointermove", (e) => { if (U.aiming) updateAim(e); });
  SE.cv.addEventListener("pointerup", () => {
    if (!U.aiming) return;
    U.aiming = false;
    U.fireActive && U.fireActive();
  });
  SE.cv.addEventListener("contextmenu", (e) => e.preventDefault());

  // ── wiring ────────────────────────────────────────────────
  function boot() {
    SE.terrain.generate();
    SE.terrain.render();

    $("startBtn").onclick = () => { SE.sfx("click"); openSetup(); };
    $("backTitleBtn").onclick = () => { SE.sfx("click"); SE.state = "title"; show("title"); };
    $("playersMinus").onclick = () => { if (U.config.n > 2) { U.config.n--; SE.sfx("click"); buildPlayerRows(); $("playerCount").textContent = U.config.n; } };
    $("playersPlus").onclick = () => { if (U.config.n < 8) { U.config.n++; SE.sfx("click"); buildPlayerRows(); $("playerCount").textContent = U.config.n; } };
    document.querySelectorAll(".dif").forEach((btn) => {
      btn.onclick = () => { U.config.difficulty = btn.dataset.dif; SE.ai.difficulty = btn.dataset.dif; setDiff(); SE.sfx("click"); };
    });
    $("startBattleBtn").onclick = () => startBattle();
    $("rematchBtn").onclick = () => { SE.battle.paused = false; show("none"); startBattle(); };
    $("setupBtn").onclick = () => { SE.battle.paused = false; openSetup(); };
    $("passBtn").onclick = () => U.passActive && U.passActive();
    $("muteBtn").onclick = () => {
      SE.audioOn = !SE.audioOn;
      $("muteBtn").textContent = SE.audioOn ? "🔊" : "🔇";
    };

    // weapon chips
    const weapons = $("weapons");
    for (const key of WEAPON_ORDER) {
      const chip = document.createElement("button");
      chip.className = "wp";
      chip.dataset.w = key;
      chip.innerHTML = "<span class='wp-name'>" + SE.WEAPONS[key].name + "</span><small class='wp-ammo'></small>";
      chip.onclick = () => {
        const b = SE.battle, t = b && b.currentTank;
        if (!t || t.ai || b.flying.length) return;
        if (t.ammo[key] > 0) { t.weapon = key; SE.sfx("switch"); U.updateHud(); }
        else U.banner("OUT OF AMMO", "dest");
      };
      weapons.appendChild(chip);
    }

    $("playerCount").textContent = U.config.n;
    SE.state = "title";
    show("title");
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
