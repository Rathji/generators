// 20-entities.js — tanks, weapons, projectiles, explosions, fire, particles
(function () {
  "use strict";

  const SE = window.SE, W = SE.W, H = SE.H;

  const WEAPONS = SE.WEAPONS = {
    normal:  { name: "SHELL",   ammo: Infinity, dmg: 35,  crater: 13, blast: 26, speed: 1.0 },
    baby:    { name: "BABY",    ammo: 6, dmg: 14,  crater: 7,  blast: 16, speed: 1.05 },
    big:     { name: "BIG",     ammo: 4, dmg: 65,  crater: 22, blast: 40, speed: 0.92 },
    shotgun: { name: "SHOTGUN", ammo: 5, dmg: 9,   crater: 4,  blast: 12, speed: 1.1, pellets: 5, spread: 5 },
    missile: { name: "MISSILE", ammo: 3, dmg: 45,  crater: 15, blast: 30, speed: 1.0, homing: true },
    napalm:  { name: "NAPALM",  ammo: 3, dmg: 22,  crater: 26, craterDepth: 0.4, blast: 44, speed: 1.0, fireX: 26, fireDur: 5, fireTick: 0.65, burn: 6 },
    nuke:    { name: "NUKE",    ammo: 1, dmg: 120, crater: 46, blast: 95, speed: 0.85, shake: 1, flash: 1 },
  };

  const PALETTE = ["#e40000", "#1f6df0", "#26a832", "#f2c234", "#e05ae0", "#25d7fd", "#ff8c1f", "#e8e8e8"];
  SE.PALETTE = PALETTE;

  const E = SE.ent = {
    tanks: [],
    explosions: [],
    particles: [],
  };

  E.createTank = function (opts) {
    const tank = {
      id: opts.id,
      name: opts.name,
      color: opts.color,
      x: opts.x,
      y: opts.y,
      vy: 0,
      fall: 0,
      angle: 45,
      power: 50,
      weapon: "normal",
      ammo: {},
      hp: 100,
      alive: true,
      ai: !!opts.ai,
      damage: 0,
      kills: 0,
      shots: 0,
      hurt: 0,
    };
    for (const k in WEAPONS) tank.ammo[k] = WEAPONS[k].ammo;
    return tank;
  };

  function nearestEnemy(tank) {
    let best = null, bd = 1e9;
    for (const t of E.tanks) {
      if (t === tank || !t.alive) continue;
      const d = Math.abs(t.x - tank.x);
      if (d < bd) { bd = d; best = t; }
    }
    return best;
  }
  E.nearestEnemy = nearestEnemy;

  // angle in degrees, 0 = straight right, 90 = up, 180 = left
  function angleTo(a, b) {
    const dx = b.x - a.x, dy = b.y - a.y;
    return Math.round(SE.clamp(Math.atan2(-dy, dx) * 180 / Math.PI, 1, 179));
  }
  E.angleTo = angleTo;

  E.fireWeapon = function (tank) {
    const b = SE.battle;
    const w = WEAPONS[tank.weapon];
    if (!tank.alive || !(tank.ammo[tank.weapon] > 0)) return false;
    tank.ammo[tank.weapon]--;
    tank.shots++;
    b.lastShooter = tank;
    if (w.pellets) {
      for (let i = 0; i < w.pellets; i++) {
        spawnProj(tank, w, (i - (w.pellets - 1) / 2) * w.spread);
      }
    } else {
      spawnProj(tank, w, 0);
    }
    // muzzle flash
    const a = tank.angle * Math.PI / 180;
    const mx = tank.x + Math.cos(a) * 11, my = tank.y - 8 - Math.sin(a) * 11;
    E.explosions.push({ x: mx, y: my, r: 9, t: 0, dur: 0.14, flash: false });
    for (let i = 0; i < 5; i++) E.spark(mx, my, 8, "#ffe066");
    SE.sfx("fire");
    SE.ui.updateHud();
    return true;
  };

  function spawnProj(tank, w, angleOff) {
    const p = {
      x: tank.x,
      y: tank.y - 7,
      angle: tank.angle + angleOff,
      w,
      tank,
      homing: !!w.homing,
      done: false,
      vx: 0,
      vy: 0,
      trail: [],
      target: w.homing ? nearestEnemy(tank) : null,
    };
    const a = p.angle * Math.PI / 180;
    const v0 = SE.MAXV * (w.speed || 1) * (tank.power / 100);
    p.vx = Math.cos(a) * v0;
    p.vy = -Math.sin(a) * v0;
    SE.battle.flying.push(p);
  }

  function stepProj(p, f) {
    for (let k = 0; k < f; k++) {
      if (p.done) break;
      // homing steering
      if (p.homing && p.target && p.target.alive) {
        const dx = p.target.x - p.x, dy = (p.target.y - 8) - p.y;
        const want = Math.atan2(dy, dx);
        let cur = Math.atan2(p.vy, p.vx);
        let da = want - cur;
        while (da > Math.PI) da -= Math.PI * 2;
        while (da < -Math.PI) da += Math.PI * 2;
        da = SE.clamp(da, -0.06, 0.06);
        const na = cur + da, sp = Math.hypot(p.vx, p.vy);
        p.vx = Math.cos(na) * sp;
        p.vy = Math.sin(na) * sp;
      }
      p.vx += SE.battle.wind * SE.WIND_K;
      p.vy += SE.GRAV;
      const px = p.x, py = p.y;
      p.x += p.vx;
      p.y += p.vy;
      p.trail.push([p.x, p.y]);
      if (p.trail.length > 16) p.trail.shift();
      const hit = traceSeg(px, py, p.x, p.y);
      if (hit) {
        p.done = true;
        impact(p, hit);
        break;
      }
      if (p.x < -40 || p.x > W + 40 || p.y > H + 80) { p.done = true; break; }
    }
  }

  function traceSeg(x0, y0, x1, y1) {
    const steps = Math.max(1, Math.ceil(Math.max(Math.abs(x1 - x0), Math.abs(y1 - y0))));
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const xi = Math.round(x);
      if (xi < 0 || xi >= W) return { x, y, ground: false, wall: true };
      if (y >= SE.terrain.h[xi]) return { x, y: SE.terrain.h[xi], ground: true, wall: false };
    }
    return null;
  }

  function impact(p, hit) {
    const w = p.w;
    const x = hit.x, y = hit.y;
    SE.terrain.destruct(x, y, w.crater, w.craterDepth);
    E.explosions.push({ x, y, r: w.blast, t: 0, dur: 0.42 + w.blast * 0.006, flash: !!w.flash });
    const n = Math.min(34, 10 + Math.round(w.blast * 0.5));
    for (let i = 0; i < n; i++) E.spark(x, y, w.blast, SE.ri(0, 1) ? "#caa050" : "#6b5a3a");
    if (w.shake) SE.shake = 8;
    if (w.flash) SE.battle.flash = 1;
    if (w.fireX) {
      SE.battle.fires.push({ x0: x - w.fireX, x1: x + w.fireX, dur: w.fireDur, t: 0, tick: w.fireTick, tickT: 0, burn: w.burn });
    }
    SE.sfx("explode", { size: w.blast });
    // "direct hit" flair
    if (!w.pellets) {
      for (const tank of E.tanks) {
        if (tank.alive && Math.hypot(tank.x - x, tank.y - 8 - y) < 13) {
          SE.banner("DIRECT HIT!", "turn");
          break;
        }
      }
    }
    blastDamage(p.tank, x, y, w);
  }

  function blastDamage(shooter, x, y, w) {
    for (const tank of E.tanks) {
      if (!tank.alive) continue;
      const d = Math.hypot(tank.x - x, tank.y - 8 - y);
      const rr = w.blast + 8;
      if (d < rr) {
        const dmg = w.dmg * (1 - d / rr);
        if (dmg <= 0) continue;
        tank.hp -= dmg;
        tank.hurt = 0.35;
        if (shooter && shooter !== tank) shooter.damage += dmg;
        if (tank.hp <= 0) killTank(tank, shooter);
      }
    }
  }

  function killTank(tank, shooter) {
    tank.alive = false;
    tank.hp = 0;
    E.explosions.push({ x: tank.x, y: tank.y - 6, r: 42, t: 0, dur: 0.7, flash: false });
    for (let i = 0; i < 40; i++) E.spark(tank.x, tank.y - 6, 40, SE.ri(0, 1) ? "#ff7a1f" : "#333");
    if (shooter && shooter !== tank) shooter.kills++;
    SE.sfx("kill");
    SE.banner(tank.name + " IS DESTROYED", "dest");
  }

  E.spark = function (x, y, spread, color) {
    const a = SE.rand(0, Math.PI * 2);
    const sp = SE.rand(0.5, 3.5) * (spread / 20 + 0.5);
    E.particles.push({ x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp - 1.5, life: 0, dur: SE.rand(0.4, 1.0), color, size: SE.ri(1, 2) });
  };

  E.update = function (dt) {
    const b = SE.battle;
    if (!b) return;
    const f = SE.clamp(dt * 60, 0, 3);
    // projectiles
    for (const p of b.flying) stepProj(p, f);
    b.flying = b.flying.filter((p) => !p.done);
    // explosions
    for (const e of E.explosions) e.t += dt;
    E.explosions = E.explosions.filter((e) => e.t < e.dur);
    // nuke flash decay
    if (b.flash) b.flash = Math.max(0, b.flash - dt * 2.2);
    // particles
    for (const p of E.particles) {
      p.life += dt;
      p.vy += 0.22 * f;
      p.x += p.vx * f;
      p.y += p.vy * f;
      const xi = SE.clamp(Math.round(p.x), 0, W - 1);
      if (p.y > SE.terrain.h[xi]) { p.y = SE.terrain.h[xi]; p.vy *= -0.35; p.vx *= 0.55; }
    }
    E.particles = E.particles.filter((p) => p.life < p.dur);
    // napalm fire
    for (const fz of b.fires) {
      fz.t += dt;
      fz.tickT += dt;
      if (fz.tickT >= fz.tick) {
        fz.tickT = 0;
        for (const tank of E.tanks) {
          if (!tank.alive) continue;
          if (tank.x > fz.x0 && tank.x < fz.x1) {
            tank.hp -= fz.burn;
            tank.hurt = 0.35;
            if (tank.hp <= 0) killTank(tank, b.lastShooter);
            SE.sfx("hurt");
          }
        }
      }
    }
    b.fires = b.fires.filter((fz) => fz.t < fz.dur);
    // tanks settle / fall / slide
    for (const tank of E.tanks) {
      if (!tank.alive) continue;
      if (tank.hurt > 0) tank.hurt -= dt;
      settleTank(tank, f);
    }
  };

  function settleTank(tank, f) {
    const xi = SE.clamp(Math.round(tank.x), 0, W - 1);
    const ground = SE.terrain.h[xi];
    if (tank.y > ground + 0.01) {
      tank.vy += SE.GRAV * f;
      tank.y += tank.vy * f;
      tank.fall += tank.vy * f;
      if (tank.y >= ground) {
        tank.y = ground;
        tank.vy = 0;
        if (tank.fall > 42) {
          const dmg = Math.min(55, (tank.fall - 42) * 0.8);
          tank.hp -= dmg;
          tank.hurt = 0.35;
          SE.banner(tank.name + " TAKES " + Math.round(dmg) + " FALL DAMAGE", "dest");
          if (tank.hp <= 0) killTank(tank, SE.battle.lastShooter);
        }
        tank.fall = 0;
      }
    } else {
      tank.y = ground;
      tank.vy = 0;
      tank.fall = 0;
      // slide downhill
      const lx = SE.clamp(xi - 1, 0, W - 1), rx = SE.clamp(xi + 1, 0, W - 1);
      const gl = SE.terrain.h[lx], gr = SE.terrain.h[rx];
      if (gl < ground - 3 && gr >= ground - 3) tank.x -= 1.1 * f;
      else if (gr < ground - 3 && gl >= ground - 3) tank.x += 1.1 * f;
      tank.x = SE.clamp(tank.x, 30, W - 30);
    }
  }

  // ── RENDERING ──────────────────────────────────────────
  E.render = function () {
    const c = SE.ctx;
    const b = SE.battle;
    c.save();
    if (SE.shake > 0) {
      c.translate(SE.ri(-SE.shake, SE.shake), SE.ri(-SE.shake, SE.shake));
      SE.shake = Math.max(0, SE.shake - 0.4);
    }
    if (SE.terrain.groundCv) c.drawImage(SE.terrain.groundCv, 0, 0);
    if (b) {
      drawFires(c, b);
      drawTanks(c, b);
      drawProjectiles(c, b);
      drawExplosions(c);
      drawParticles(c);
      if (b.flash) {
        c.fillStyle = "rgba(255,255,255," + (b.flash * 0.9).toFixed(3) + ")";
        c.fillRect(-20, -20, W + 40, H + 40);
      }
      if (b.currentTank && !b.currentTank.ai && b.currentTank.alive && !b.flying.length) drawAimArc(c);
    }
    c.restore();
  };

  function drawTanks(c, b) {
    const sorted = E.tanks.filter((t) => t.alive).sort((a, b) => a.y - b.y);
    const now = performance.now() / 1000;
    for (const t of sorted) {
      const cx = Math.round(t.x), cy = Math.round(t.y);
      if (b.currentTank === t) {
        const pul = 0.6 + 0.4 * Math.sin(now * 6);
        c.fillStyle = "rgba(255,255,120," + pul.toFixed(3) + ")";
        c.fillRect(cx - 2, cy - 32, 4, 7);
      }
      // shadow
      c.fillStyle = "rgba(0,0,0,0.25)";
      c.fillRect(cx - 7, cy, 14, 3);
      // tracks
      c.fillStyle = "#232323";
      c.fillRect(cx - 6, cy - 3, 12, 3);
      c.fillStyle = "#3c3c3c";
      for (let i = 0; i < 6; i++) c.fillRect(cx - 6 + i * 2, cy - 3, 1, 3);
      // hull
      c.fillStyle = t.color;
      c.fillRect(cx - 5, cy - 6, 10, 3);
      c.fillStyle = "rgba(0,0,0,0.3)";
      c.fillRect(cx - 5, cy - 5, 10, 1);
      // turret
      c.fillStyle = "#3a3a3a";
      c.fillRect(cx - 2, cy - 8, 4, 2);
      // barrel
      const a = t.angle * Math.PI / 180;
      const bx = Math.cos(a), by = -Math.sin(a);
      c.strokeStyle = "#151515";
      c.lineWidth = 2;
      c.beginPath();
      c.moveTo(cx, cy - 8);
      c.lineTo(cx + bx * 11, cy - 8 + by * 11);
      c.stroke();
      // name plate
      c.fillStyle = "rgba(0,0,0,0.55)";
      c.fillRect(cx - 26, cy - 24, 52, 9);
      c.fillStyle = "#fff";
      c.font = "bold 8px Courier New, monospace";
      c.textAlign = "center";
      c.fillText(t.name.length > 12 ? t.name.slice(0, 11) + "." : t.name, cx, cy - 16);
      // hp bar
      const hpw = 30, pct = Math.max(0, t.hp) / 100;
      c.fillStyle = "#111";
      c.fillRect(cx - hpw / 2, cy - 14, hpw, 4);
      c.fillStyle = pct > 0.5 ? "#4cde3c" : pct > 0.25 ? "#f2c234" : "#e40000";
      c.fillRect(cx - hpw / 2, cy - 14, hpw * pct, 4);
      // hurt flash
      if (t.hurt > 0) {
        c.fillStyle = "rgba(255,40,20," + Math.min(1, t.hurt * 2).toFixed(3) + ")";
        c.fillRect(cx - 7, cy - 9, 14, 9);
      }
    }
  }

  function drawProjectiles(c, b) {
    for (const p of b.flying) {
      c.strokeStyle = "rgba(255,255,255,0.5)";
      c.lineWidth = 1;
      c.beginPath();
      for (let i = 0; i < p.trail.length; i++) {
        const pt = p.trail[i];
        if (i === 0) c.moveTo(pt[0], pt[1]);
        else c.lineTo(pt[0], pt[1]);
      }
      c.stroke();
      c.fillStyle = p.homing ? "#ff7ad9" : "#fff2b0";
      c.fillRect(p.x - 2, p.y - 2, 4, 4);
      c.fillStyle = "#fff";
      c.fillRect(p.x - 1, p.y - 1, 2, 2);
    }
  }

  function drawExplosions(c) {
    for (const e of E.explosions) {
      const k = e.t / e.dur;
      const r = e.r * (0.3 + 0.7 * k);
      const a = 1 - k;
      c.globalAlpha = a;
      c.fillStyle = "#ff7a1f";
      c.beginPath(); c.arc(e.x, e.y, r, 0, 7); c.fill();
      c.fillStyle = "#ffc21f";
      c.beginPath(); c.arc(e.x, e.y, r * 0.65, 0, 7); c.fill();
      c.fillStyle = "#fff7c0";
      c.beginPath(); c.arc(e.x, e.y, r * 0.3, 0, 7); c.fill();
      c.globalAlpha = 1;
    }
  }

  function drawParticles(c) {
    for (const p of E.particles) {
      const a = 1 - p.life / p.dur;
      c.globalAlpha = a;
      c.fillStyle = p.color;
      c.fillRect(p.x, p.y, p.size, p.size);
    }
    c.globalAlpha = 1;
  }

  function drawFires(c, b) {
    const now = performance.now() / 1000;
    for (const fz of b.fires) {
      c.globalAlpha = 1 - (fz.t / fz.dur) * 0.6;
      for (let x = Math.floor(fz.x0); x <= fz.x1; x += 2) {
        const gy = SE.terrain.h[SE.clamp(x, 0, W - 1)];
        const fl = 4 + 6 * Math.abs(Math.sin(now * 9 + x * 0.7));
        c.fillStyle = "#ff9c2a";
        c.fillRect(x, gy - fl, 2, fl);
        c.fillStyle = "#ffd23a";
        c.fillRect(x, gy - fl * 0.6, 2, fl * 0.6);
      }
      c.globalAlpha = 1;
    }
  }

  // dotted preview arc for the human player's current aim
  function drawAimArc(c) {
    const t = SE.battle.currentTank;
    const v0 = SE.MAXV * (WEAPONS[t.weapon].speed || 1) * (t.power / 100);
    const a = t.angle * Math.PI / 180;
    let x = t.x, y = t.y - 7;
    let vx = Math.cos(a) * v0, vy = -Math.sin(a) * v0;
    const wind = SE.battle.wind * SE.WIND_K;
    for (let i = 0; i < 46; i++) {
      vx += wind;
      vy += SE.GRAV;
      x += vx;
      y += vy;
      const xi = Math.round(x);
      if (xi < 0 || xi >= W || y >= SE.terrain.h[xi]) break;
      if (i % 2 === 0) {
        c.fillStyle = "rgba(255,255,255,0.5)";
        c.fillRect(x - 1, y - 1, 2, 2);
      }
    }
  }
})();
