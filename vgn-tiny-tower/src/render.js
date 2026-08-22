import { byId, floorById } from "./engine.js";

const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

function hexToRgb(hex) {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

function shade(hex, amt) {
  const { r, g, b } = hexToRgb(hex);
  const f = (v) => clamp(Math.round(v * (1 + amt / 100)), 0, 255);
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}

function roundRectPath(ctx, x, y, w, h, r) {
  r = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    this.dpr = 1;
    this.w = 1;
    this.h = 1;
    this.maxFloors = 5;
    this.clouds = [];
    for (let i = 0; i < 5; i++) {
      this.clouds.push({ x: Math.random() * 2000 - 200, y: 0.05 + Math.random() * 0.3, s: 0.5 + Math.random() * 0.8, v: 2.5 + Math.random() * 5 });
    }
    this.effects = [];
    this.resize();
  }

  resize() {
    const r = this.canvas.getBoundingClientRect();
    this.dpr = window.devicePixelRatio || 1;
    this.w = Math.max(20, r.width);
    this.h = Math.max(20, r.height);
    this.canvas.width = Math.round(this.w * this.dpr);
    this.canvas.height = Math.round(this.h * this.dpr);
  }

  layout(state) {
    const n = Math.max(state.floors.length, 5);
    this.floorH = clamp((this.h - 120) / n, 14, 60);
    this.groundY = this.h - 46;
    this.towerW = clamp(this.w * 0.62, 150, this.floorH * 4.8);
    this.towerX = Math.round((this.w - this.towerW) / 2);
    this.shaftW = Math.max(14, Math.round(this.floorH * 0.5));
    this.shaftX = this.towerX + this.towerW - this.shaftW - 2;
    this.towerTop = this.groundY - this.floorH * (state.floors.length + 1);
    this.lobbyTop = this.groundY - this.floorH;
    this.maxFloors = state.floors.length;
  }

  isShaft(x) {
    return x >= this.shaftX && x <= this.shaftX + this.shaftW;
  }

  floorFromY(y) {
    const raw = (this.groundY - y) / this.floorH;
    const i = Math.floor(raw);
    if (i >= 1 && i <= this.maxFloors) return i;
    return 0;
  }

  lobbySpots(state) {
    const n = state.lobby.length;
    const spacing = this.floorH * 1.6;
    const total = Math.max(n - 1, 0) * spacing;
    const start = this.towerX + this.towerW / 2 - total / 2;
    const lbH = Math.max(this.floorH * 0.62, 12);
    const feetY = this.groundY + Math.max(12, this.floorH * 0.62);
    const ph = Math.max(11, this.floorH * 0.42);
    const by = feetY - lbH - ph - 3;
    const out = [];
    for (let j = 0; j < n; j++) {
      out.push({ id: state.lobby[j], x: start + j * spacing, by });
    }
    return out;
  }

  updateEffects(dt) {
    for (const c of this.clouds) {
      c.x += c.v * dt;
      if (c.x > this.w + 160) c.x = -180;
    }
    for (const e of this.effects) {
      e.ttl -= dt;
      e.y -= 22 * dt;
    }
    this.effects = this.effects.filter((e) => e.ttl > 0);
  }

  addEffect(x, y, text, color = "#ffd94d", size = 16) {
    this.effects.push({ x, y, text, color, size, ttl: 1.3 });
  }

  draw(state, t) {
    const ctx = this.ctx;
    this.layout(state);
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawSky(t);
    this.drawGround(state);
    this.drawTower(state, t);
    this.drawLobby(state, t);
    this.drawBitizens(state, t);
    this.drawEffects();
  }

  drawSky(t) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, 0, 0, this.h);
    g.addColorStop(0, "#7fc4ef");
    g.addColorStop(0.7, "#bde3fb");
    g.addColorStop(1, "#e8f6ff");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.save();
    ctx.globalAlpha = 0.22;
    ctx.fillStyle = "#fff3b0";
    ctx.beginPath();
    ctx.arc(this.w - 70, 60, 44, 0, 7);
    ctx.fill();
    ctx.restore();
    ctx.fillStyle = "#ffe98a";
    ctx.beginPath();
    ctx.arc(this.w - 70, 60, 26, 0, 7);
    ctx.fill();
    for (const c of this.clouds) {
      this.drawCloud(c.x, c.y * this.h, c.s);
    }
  }

  drawCloud(x, y, s) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(255,255,255,0.85)";
    ctx.beginPath();
    ctx.arc(x, y, 22 * s, 0, 7);
    ctx.arc(x + 24 * s, y - 12 * s, 18 * s, 0, 7);
    ctx.arc(x + 48 * s, y, 20 * s, 0, 7);
    ctx.fill();
  }

  drawGround(state) {
    const ctx = this.ctx;
    const g = ctx.createLinearGradient(0, this.groundY, 0, this.h);
    g.addColorStop(0, "#74bd60");
    g.addColorStop(1, "#5da54c");
    ctx.fillStyle = g;
    ctx.fillRect(0, this.groundY, this.w, this.h - this.groundY);
    ctx.fillStyle = "#c9c2b2";
    ctx.fillRect(0, this.groundY, this.w, 8);
    ctx.fillStyle = "#b3ac9d";
    ctx.fillRect(0, this.groundY + 8, this.w, 2);
    ctx.fillStyle = "#4c5563";
    ctx.fillRect(0, this.h - 16, this.w, 16);
    ctx.fillStyle = "#e8d15a";
    ctx.fillRect(0, this.h - 8, this.w, 2);
    ctx.fillStyle = "rgba(20,40,15,0.28)";
    ctx.beginPath();
    ctx.ellipse(this.towerX + this.towerW / 2, this.groundY + 9, this.towerW * 0.62, 7, 0, 0, 7);
    ctx.fill();
    if (this.towerX > 40) this.drawTree(this.towerX - 26, this.groundY);
    if (this.towerX + this.towerW + 24 < this.w - 12) this.drawBush(this.towerX + this.towerW + 24, this.groundY);
  }

  drawTree(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = "#5d4632";
    ctx.fillRect(x - 4, y - 26, 8, 26);
    ctx.fillStyle = "#3f8f4f";
    ctx.beginPath();
    ctx.arc(x, y - 44, 20, 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x - 16, y - 32, 15, 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 16, y - 32, 15, 0, 7);
    ctx.fill();
  }

  drawBush(x, y) {
    const ctx = this.ctx;
    ctx.fillStyle = "#3f8f4f";
    ctx.beginPath();
    ctx.arc(x, y - 10, 13, 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + 14, y - 8, 11, 0, 7);
    ctx.fill();
  }

  drawTower(state, t) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(18,24,34,0.9)";
    ctx.fillRect(this.towerX - 3, this.towerTop - 4, this.towerW + 6, this.groundY - this.towerTop + 8);
    for (let i = 1; i <= state.floors.length; i++) {
      this.drawFloor(state.floors[i - 1], i);
    }
    ctx.fillStyle = "#39424f";
    ctx.fillRect(this.towerX + this.towerW / 2 - 2, this.towerTop - 16, 4, 16);
    ctx.fillStyle = "#ff5b5b";
    ctx.beginPath();
    ctx.moveTo(this.towerX + this.towerW / 2 + 2, this.towerTop - 16);
    ctx.lineTo(this.towerX + this.towerW / 2 + 2 + 12, this.towerTop - 12);
    ctx.lineTo(this.towerX + this.towerW / 2 + 2, this.towerTop - 8);
    ctx.closePath();
    ctx.fill();
    this.drawShaft(state, t);
  }

  drawFloor(f, i) {
    const ctx = this.ctx;
    const x = this.towerX;
    const w = this.towerW;
    const y = this.groundY - (i + 1) * this.floorH;
    const grad = ctx.createLinearGradient(0, y, 0, y + this.floorH);
    grad.addColorStop(0, shade(f.color, 18));
    grad.addColorStop(0.55, shade(f.color, 2));
    grad.addColorStop(1, shade(f.color, -14));
    ctx.fillStyle = grad;
    roundRectPath(ctx, x + 2, y + 2, w - 4, this.floorH - 3, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(15,20,30,0.9)";
    ctx.lineWidth = 2;
    roundRectPath(ctx, x + 2, y + 2, w - 4, this.floorH - 3, 5);
    ctx.stroke();
    const label = String(i);
    const fs = Math.max(6, this.floorH * 0.18);
    ctx.font = `600 ${fs}px system-ui`;
    const tw = ctx.measureText(label).width;
    const pw = Math.max(10, Math.min(this.floorH * 0.72, tw + 9));
    const ph = Math.max(8, this.floorH * 0.26);
    ctx.fillStyle = "#1d2531";
    roundRectPath(ctx, x + 6, y + this.floorH / 2 - ph / 2, pw, ph, 3);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x + 6 + pw / 2, y + this.floorH / 2 + 0.5);
    if (f.type === "residential") this.drawResidential(f, x, y, w);
    else this.drawBusiness(f, x, y, w);
  }

  drawResidential(f, x, y, w) {
    const ctx = this.ctx;
    const h = this.floorH;
    const innerW = w - this.shaftW - 24;
    const nWin = 3;
    const winW = Math.min(h * 0.46, innerW / nWin - 10);
    const winH = h * 0.44;
    const gap = (innerW - nWin * winW) / (nWin + 1);
    let wx = x + 12 + gap;
    const wy = y + (h - winH) / 2;
    for (let k = 0; k < nWin; k++) {
      ctx.fillStyle = "rgba(15,20,30,0.55)";
      roundRectPath(ctx, wx - 2, wy - 2, winW + 4, winH + 4, 2);
      ctx.fill();
      ctx.fillStyle = f.residents.length > 0 ? "#ffe9a8" : "#cfe3f4";
      roundRectPath(ctx, wx, wy, winW, winH, 2);
      ctx.fill();
      ctx.strokeStyle = "rgba(255,255,255,0.6)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(wx + winW / 2, wy);
      ctx.lineTo(wx + winW / 2, wy + winH);
      ctx.stroke();
      ctx.fillStyle = shade(f.color, -20);
      ctx.fillRect(wx - 2, wy + winH, winW + 4, 3);
      wx += winW + gap;
    }
    ctx.fillStyle = "rgba(15,20,30,0.7)";
    ctx.fillRect(x + 12, y + h - 7, innerW, 3);
  }

  drawBusiness(f, x, y, w) {
    const ctx = this.ctx;
    const h = this.floorH;
    const innerW = w - this.shaftW - 24;
    const awH = Math.max(7, h * 0.28);
    ctx.save();
    roundRectPath(ctx, x + 12, y + 2, innerW, awH, 4);
    ctx.clip();
    const stripe = Math.max(8, innerW / 12);
    let ax = x + 12;
    let i = 0;
    while (ax < x + 12 + innerW) {
      ctx.fillStyle = i % 2 ? shade(f.color, -26) : shade(f.color, 22);
      ctx.fillRect(ax, y + 2, stripe, awH);
      ax += stripe;
      i++;
    }
    ctx.fillStyle = "rgba(15,20,30,0.35)";
    ctx.fillRect(x + 12, y + 2, innerW, 3);
    ctx.restore();
    ctx.fillStyle = shade(f.color, -10);
    const sc = Math.max(5, innerW / 10);
    if (h >= 26) {
      for (let sx = x + 12; sx < x + 12 + innerW; sx += sc) {
        ctx.beginPath();
        ctx.arc(sx + sc / 2, y + 2 + awH, sc / 2, 0, Math.PI);
        ctx.fill();
      }
    }
    if (h >= 20 && f.name) {
      const signW = innerW - 4;
      const signY = y + 2 + awH + 3;
      const signH = Math.max(7, h * 0.18);
      ctx.fillStyle = "#ffffff";
      roundRectPath(ctx, x + 14, signY, signW, signH, 3);
      ctx.fill();
      ctx.fillStyle = "#2a3342";
      let fs = h * 0.16;
      ctx.font = `700 ${fs}px system-ui`;
      let tw = ctx.measureText(f.name).width;
      while (tw > signW - 10 && fs > 5.5) {
        fs *= 0.92;
        ctx.font = `700 ${fs}px system-ui`;
        tw = ctx.measureText(f.name).width;
      }
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(f.name, x + 14 + signW / 2, signY + signH / 2 + 0.5);
    }
    const nWin = 2;
    const winW = Math.min(h * 0.4, (innerW - 20) / nWin);
    const winH = Math.max(6, h * 0.3);
    const gap = (innerW - nWin * winW) / (nWin + 1);
    let wx = x + 12 + gap;
    const wy = y + h - winH - 6;
    for (let k = 0; k < nWin; k++) {
      ctx.fillStyle = "rgba(15,20,30,0.6)";
      roundRectPath(ctx, wx - 2, wy - 2, winW + 4, winH + 4, 3);
      ctx.fill();
      const wg = ctx.createLinearGradient(0, wy, 0, wy + winH);
      wg.addColorStop(0, "#dff2ff");
      wg.addColorStop(1, "#9ec8e8");
      ctx.fillStyle = wg;
      ctx.fillRect(wx, wy, winW, winH);
      ctx.fillStyle = "rgba(255,255,255,0.5)";
      ctx.beginPath();
      ctx.moveTo(wx, wy + winH);
      ctx.lineTo(wx + winW * 0.6, wy);
      ctx.lineTo(wx + winW * 0.6, wy + winH);
      ctx.closePath();
      ctx.fill();
      wx += winW + gap;
    }
  }

  drawShaft(state, t) {
    const ctx = this.ctx;
    ctx.fillStyle = "rgba(13,16,22,0.94)";
    ctx.fillRect(this.shaftX, this.towerTop, this.shaftW, this.groundY - this.towerTop);
    ctx.strokeStyle = "#0a0d12";
    ctx.lineWidth = 2;
    ctx.strokeRect(this.shaftX, this.towerTop, this.shaftW, this.groundY - this.towerTop);
    ctx.fillStyle = "#2b3646";
    ctx.fillRect(this.shaftX + 2, this.towerTop, 2, this.groundY - this.towerTop);
    ctx.fillRect(this.shaftX + this.shaftW - 4, this.towerTop, 2, this.groundY - this.towerTop);
    const e = state.elevator;
    const carY = this.groundY - e.floor * this.floorH;
    const carH = this.floorH * 0.92;
    const carW = this.shaftW - 6;
    const carX = this.shaftX + 3;
    ctx.fillStyle = "#1b2430";
    ctx.fillRect(this.shaftX + this.shaftW / 2 - 1, this.towerTop, 2, Math.max(0, carY - carH + 4));
    ctx.fillStyle = "#4b5a70";
    roundRectPath(ctx, carX, carY - carH, carW, carH, 4);
    ctx.fill();
    ctx.strokeStyle = "#222c3a";
    ctx.lineWidth = 2;
    roundRectPath(ctx, carX, carY - carH, carW, carH, 4);
    ctx.stroke();
    ctx.fillStyle = "#39465a";
    roundRectPath(ctx, carX - 2, carY - carH - 4, carW + 4, 6, 2);
    ctx.fill();
    ctx.fillStyle = "#cfe9ff";
    roundRectPath(ctx, carX + 3, carY - carH + 5, carW - 6, carH * 0.5, 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1.5;
    roundRectPath(ctx, carX + 3, carY - carH + 5, carW - 6, carH * 0.5, 2);
    ctx.stroke();
    if (e.passengerId != null) {
      const b = byId(state, e.passengerId);
      if (b) this.drawBitizen(ctx, carX + carW / 2, carY - carH + 5 + carH * 0.5, carH * 0.55, b, t);
    }
    ctx.fillStyle = e.moving ? "#ffe98a" : "#5a6c85";
    ctx.beginPath();
    ctx.arc(carX + carW / 2, carY - carH + 2.5, 2.5, 0, 7);
    ctx.fill();
  }

  drawLobby(state, t) {
    const ctx = this.ctx;
    const x = this.towerX;
    const w = this.towerW;
    ctx.fillStyle = "#d8e6d8";
    roundRectPath(ctx, x + 2, this.lobbyTop + 2, w - 4, this.floorH - 3, 5);
    ctx.fill();
    ctx.strokeStyle = "rgba(15,20,30,0.9)";
    ctx.lineWidth = 2;
    roundRectPath(ctx, x + 2, this.lobbyTop + 2, w - 4, this.floorH - 3, 5);
    ctx.stroke();
    const doorW = Math.min(w * 0.32, this.floorH * 1.15);
    const doorX = x + w / 2 - doorW / 2;
    const doorH = this.floorH * 0.76;
    const doorY = this.groundY - doorH;
    ctx.fillStyle = "#33404f";
    roundRectPath(ctx, doorX - 5, doorY - 4, doorW + 10, doorH + 4, 5);
    ctx.fill();
    const dg = ctx.createLinearGradient(0, doorY, 0, doorY + doorH);
    dg.addColorStop(0, "#cfefff");
    dg.addColorStop(1, "#7fb9dd");
    ctx.fillStyle = dg;
    roundRectPath(ctx, doorX, doorY, doorW, doorH, 4);
    ctx.fill();
    ctx.fillStyle = "#33404f";
    ctx.fillRect(doorX + doorW / 2 - 2, doorY, 4, doorH);
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    ctx.beginPath();
    ctx.moveTo(doorX + 4, doorY + doorH);
    ctx.lineTo(doorX + doorW * 0.42, doorY);
    ctx.lineTo(doorX + doorW * 0.42, doorY + doorH);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = "#f0c05a";
    ctx.fillRect(doorX + doorW * 0.22, doorY + doorH * 0.5, 2.5, 8);
    ctx.fillRect(doorX + doorW * 0.78 - 2.5, doorY + doorH * 0.5, 2.5, 8);
    ctx.fillStyle = "#3a4454";
    roundRectPath(ctx, doorX - 12, doorY - 12, doorW + 24, 9, 3);
    ctx.fill();
    ctx.fillStyle = "#2b3646";
    roundRectPath(ctx, doorX - 12, doorY - 3, doorW + 24, 3, 1.5);
    ctx.fill();
    const signW = Math.min(72, w * 0.22);
    const signH = Math.max(7, this.floorH * 0.22);
    ctx.fillStyle = "#1d2531";
    roundRectPath(ctx, x + w / 2 - signW / 2, this.lobbyTop + 2, signW, signH, 3);
    ctx.fill();
    ctx.fillStyle = "#ffffff";
    ctx.font = `700 ${Math.max(6, this.floorH * 0.13)}px system-ui`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("LOBBY", x + w / 2, this.lobbyTop + 2 + signH / 2 + 0.5);
  }

  drawBitizens(state, t) {
    const ctx = this.ctx;
    for (const b of state.bitizens) {
      if (b.location !== "home") continue;
      const f = b.workFloorId != null ? floorById(state, b.workFloorId) : floorById(state, b.homeFloorId);
      if (!f) continue;
      const h = Math.max(this.floorH * 0.55, 12);
      const usable = this.towerW - this.shaftW - 18;
      const x = this.towerX + 10 + b.walkPhase * (usable - 24);
      const feetY = this.groundY - f.index * this.floorH - 3;
      this.drawBitizen(ctx, x, feetY, h, b, t);
    }
    const spots = this.lobbySpots(state);
    for (let j = 0; j < spots.length; j++) {
      const sp = spots[j];
      const b = byId(state, sp.id);
      if (!b) continue;
      const lbH = Math.max(this.floorH * 0.62, 12);
      const feetY = this.groundY + Math.max(12, this.floorH * 0.62);
      this.drawBitizen(ctx, sp.x, feetY, lbH, b, t);
      const f = b.wantsFloorId != null ? floorById(state, b.wantsFloorId) : null;
      const bob = Math.sin(t * 3 + sp.id) * 1;
      const cy = sp.by + bob;
      const pw = Math.max(18, this.floorH * 1.05);
      const ph = Math.max(11, this.floorH * 0.42);
      ctx.fillStyle = "#ffffff";
      roundRectPath(ctx, sp.x - pw / 2, cy - ph / 2, pw, ph, ph / 2);
      ctx.fill();
      ctx.lineWidth = 2;
      ctx.strokeStyle = f ? f.color : "#888";
      roundRectPath(ctx, sp.x - pw / 2, cy - ph / 2, pw, ph, ph / 2);
      ctx.stroke();
      ctx.fillStyle = "#223046";
      ctx.font = `700 ${Math.max(7, this.floorH * 0.24)}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(f ? "F" + f.index : "?", sp.x, cy + 0.5);
    }
  }

  drawBitizen(ctx, x, feetY, h, b, t) {
    const bob = Math.sin(t * 4 + b.id) * h * 0.05;
    const bodyW = h * 0.52;
    const headR = h * 0.19;
    const topY = feetY - bob;
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath();
    ctx.ellipse(x, feetY + 1, h * 0.26, h * 0.07, 0, 0, 7);
    ctx.fill();
    ctx.fillStyle = "#2c313c";
    ctx.fillRect(x - bodyW * 0.24, topY - h * 0.3, bodyW * 0.16, h * 0.3);
    ctx.fillRect(x + bodyW * 0.08, topY - h * 0.3, bodyW * 0.16, h * 0.3);
    ctx.fillStyle = b.favoriteColor;
    ctx.strokeStyle = "rgba(15,20,30,0.55)";
    ctx.lineWidth = 1;
    roundRectPath(ctx, x - bodyW / 2, topY - h * 0.8, bodyW, h * 0.52, bodyW * 0.2);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#ffd9b3";
    ctx.strokeStyle = "rgba(15,20,30,0.55)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.arc(x, topY - h * 0.9, headR, 0, 7);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#5a4632";
    ctx.beginPath();
    ctx.arc(x, topY - h * 0.92, headR, Math.PI, 7);
    ctx.fill();
    ctx.fillStyle = "#2b2b33";
    ctx.beginPath();
    ctx.arc(x - headR * 0.32, topY - h * 0.9, Math.max(1, headR * 0.13), 0, 7);
    ctx.fill();
    ctx.beginPath();
    ctx.arc(x + headR * 0.32, topY - h * 0.9, Math.max(1, headR * 0.13), 0, 7);
    ctx.fill();
    ctx.strokeStyle = "#2b2b33";
    ctx.lineWidth = Math.max(1, h * 0.02);
    ctx.beginPath();
    ctx.arc(x, topY - h * 0.84, headR * 0.35, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.stroke();
  }

  drawEffects() {
    const ctx = this.ctx;
    for (const e of this.effects) {
      ctx.globalAlpha = clamp(e.ttl / 0.4, 0, 1);
      ctx.fillStyle = e.color;
      ctx.font = `700 ${e.size}px system-ui`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(e.text, e.x, e.y);
    }
    ctx.globalAlpha = 1;
  }
}
