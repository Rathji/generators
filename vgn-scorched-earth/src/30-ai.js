// 30-ai.js — opponent aiming solver
(function () {
  "use strict";

  const SE = window.SE, W = SE.W, H = SE.H;

  const A = SE.ai = {
    difficulty: "medium",
  };

  function nearestEnemy(tank) {
    let best = null, bd = 1e9;
    for (const t of SE.ent.tanks) {
      if (t === tank || !t.alive) continue;
      const d = Math.abs(t.x - tank.x);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }

  // pure ballistic simulation — must mirror stepProj in 20-entities.js
  function simShot(x0, y0, ang, power, speedMul) {
    const v0 = SE.MAXV * speedMul * (power / 100);
    const a = ang * Math.PI / 180;
    let x = x0, y = y0;
    let vx = Math.cos(a) * v0, vy = -Math.sin(a) * v0;
    const wind = SE.battle.wind * SE.WIND_K;
    for (let i = 0; i < 900; i++) {
      vx += wind;
      vy += SE.GRAV;
      x += vx;
      y += vy;
      const xi = Math.round(x);
      if (xi < 0 || xi >= W) return { x, ground: false };
      if (y >= SE.terrain.h[xi]) return { x, ground: true };
      if (y > H + 60) return null;
    }
    return null;
  }

  function think(tank) {
    const target = nearestEnemy(tank);
    if (!target) return null;
    const dist = Math.abs(target.x - tank.x);
    const am = tank.ammo;

    // weapon pick
    let weapon = "normal";
    if (dist < 150 && am.shotgun > 0 && Math.random() < 0.65) weapon = "shotgun";
    else if (dist < 300 && am.big > 0) weapon = "big";
    else if (dist >= 300 && am.missile > 0) weapon = "missile";
    else if (dist >= 260 && am.big > 0) weapon = "big";
    if (weapon === "normal" && am.baby > 0 && dist < 120 && Math.random() < 0.4) weapon = "baby";
    if (am.napalm > 0 && Math.random() < 0.12 && dist < 400) weapon = "napalm";
    if (am.nuke > 0 && Math.random() < 0.2 && dist < 520) weapon = "nuke";
    if (!(am[weapon] > 0)) weapon = "normal";

    const w = SE.WEAPONS[weapon];
    let ang, power;

    if (weapon === "missile") {
      // homing corrects drift; a rough lob is enough
      const dx = target.x - tank.x, dy = target.y - 10 - (tank.y - 8);
      ang = SE.clamp(Math.round(Math.atan2(-dy, dx) * 180 / Math.PI), 15, 165);
      power = SE.ri(45, 75);
    } else {
      // grid search over the shared physics model
      const speedMul = w.speed || 1;
      let best = null;
      for (let a = 16; a <= 164; a += 3) {
        for (let p = 16; p <= 100; p += 4) {
          const res = simShot(tank.x, tank.y - 7, a, p, speedMul);
          if (!res || !res.ground) continue;
          const err = Math.abs(res.x - target.x);
          if (!best || err < best.err) best = { a, p, err };
        }
      }
      if (!best) { ang = 45; power = 60; }
      else { ang = best.a; power = best.p; }
    }

    // difficulty noise
    let na, np, chaos;
    if (A.difficulty === "easy") { na = 7; np = 16; chaos = 0.3; }
    else if (A.difficulty === "medium") { na = 3.5; np = 9; chaos = 0.12; }
    else { na = 1.5; np = 4; chaos = 0.02; }
    if (Math.random() < chaos) {
      ang = SE.ri(20, 160);
      power = SE.ri(25, 95);
    } else {
      ang = SE.clamp(Math.round(ang + SE.rand(-na, na)), 5, 175);
      power = SE.clamp(Math.round(power + SE.rand(-np, np)), 10, 100);
    }
    return { weapon, angle: ang, power };
  }
  A.think = think;

  A.thinkAndFire = async function (tank) {
    const plan = think(tank);
    if (!plan) return;
    tank.weapon = plan.weapon;
    tank.angle = plan.angle;
    tank.power = plan.power;
    SE.ui.updateHud();
    await SE.sleep(600 + SE.ri(0, 500));
    if (tank.alive && SE.battle && SE.battle.currentTank === tank) {
      SE.ent.fireWeapon(tank);
    }
  };
})();
