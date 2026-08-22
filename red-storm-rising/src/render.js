import { WEAPONS } from './data.js';
import { relCourse, bearingDeg, rangeNm, DR } from './world.js';

const PX = Math.PI / 180;

const COASTS = {
  'n-america': [
    [-82, 27], [-80, 30], [-77, 33], [-75, 36], [-74, 39], [-72, 41], [-70, 42], [-66, 44], [-62, 46],
    [-58, 48], [-55, 51], [-53, 56], [-50, 58], [-48, 60], [-45, 59], [-52, 53], [-54, 49], [-58, 46],
    [-63, 45], [-67, 44], [-70, 42], [-73, 39], [-76, 36], [-78, 33], [-80, 30],
  ],
  greenland: [
    [-55, 60], [-48, 62], [-42, 67], [-38, 74], [-30, 80], [-22, 79], [-18, 74], [-22, 69], [-28, 66], [-35, 62], [-44, 60],
  ],
  iceland: [
    [-24, 63.2], [-22, 64], [-18, 66], [-14, 66], [-13, 64.5], [-16, 63.5], [-20, 63],
  ],
  britain: [
    [-8, 50], [-5, 50], [-1, 51], [0, 53], [-1, 55], [-3, 57], [-2, 58], [-5, 57], [-6, 55], [-5, 53], [-4, 51], [-6, 50.5],
  ],
  norway: [
    [5, 58], [5, 61], [7, 63], [10, 66], [14, 68], [20, 70], [26, 71], [29, 70], [27, 68], [21, 66], [17, 64], [12, 61], [8, 59], [6, 58],
  ],
  iberia: [
    [0, 51], [-2, 48], [-4, 46], [-2, 44], [1, 42], [3, 43], [3, 41], [-2, 43], [-5, 44], [-1, 47], [2, 50],
  ],
};

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.wfCanvas = document.createElement('canvas');
    this.wfCtx = this.wfCanvas.getContext('2d');
    this.wfW = 720; this.wfH = 200;
    this.wfCanvas.width = this.wfW; this.wfCanvas.height = this.wfH;
    this.wfData = this.wfCtx.createImageData(this.wfW, this.wfH);
    this.wfRow = 0; this.wfLast = 0;
    this.resize();
  }

  resize() {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(50, Math.round(r.width * dpr));
    const h = Math.max(50, Math.round(r.height * dpr));
    if (w === this.canvas.width && h === this.canvas.height) return;
    this.canvas.width = w;
    this.canvas.height = h;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.w = r.width; this.h = r.height;
  }

  draw(world, ui, campaign) {
    this.resize();
    this.ctx.clearRect(0, 0, this.w, this.h);
    if (ui.view === 'sonar') this.drawSonar(world, ui);
    else if (ui.view === 'campaign') this.drawCampaign(world, ui, campaign);
    else this.drawTac(world, ui);
  }

  w2s(world, ui, wx, wy) {
    const sx = (wx - ui.cx) * ui.scale + this.w / 2;
    const sy = (ui.cy - wy) * ui.scale + this.h / 2;
    return { x: sx, y: sy };
  }

  drawTac(world, ui) {
    const ctx = this.ctx;
    ctx.fillStyle = '#04120a';
    ctx.fillRect(0, 0, this.w, this.h);

    this.drawGrid(world, ui);
    this.drawRangeRings(world, ui);

    const pl = world.player;
    const pls = this.w2s(world, ui, pl.x, pl.y);

    for (const w of world.weapons) {
      if (w.dead) continue;
      const a = this.w2s(world, ui, w.x, w.y);
      if (this.offScreen(a)) continue;
      this.drawWeaponPath(w, ui, world);
      this.drawWeapon(w, a);
    }

    for (const e of world.effects) {
      const age = (world.t - e.t0) / e.dur;
      if (age < 0 || age > 1) continue;
      if (e.type === 'pingEcho') {
        const a = e.bearing * PX;
        const d = e.range * ui.scale;
        const arcX = pls.x + Math.sin(a) * d;
        const arcY = pls.y - Math.cos(a) * d;
        ctx.strokeStyle = `rgba(180,255,200,${0.75 * (1 - age)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(arcX, arcY, 8 * (1 - age) + 3, 0, 6.29); ctx.stroke();
        continue;
      }
      const p = this.w2s(world, ui, e.x, e.y);
      if (e.type === 'ping') {
        const r = (e.scale || 10) * age * ui.scale;
        ctx.strokeStyle = `rgba(140,255,180,${0.5 * (1 - age)})`;
        ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, r), 0, 6.29); ctx.stroke();
      } else if (e.type === 'explosion') {
        const r = (e.big ? 16 : 8) * (0.4 + age) * ui.scale / 3;
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, Math.max(2, r));
        g.addColorStop(0, `rgba(255,240,180,${0.9 * (1 - age)})`);
        g.addColorStop(0.5, `rgba(255,150,60,${0.7 * (1 - age)})`);
        g.addColorStop(1, `rgba(255,80,40,0)`);
        ctx.fillStyle = g;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(2, r), 0, 6.29); ctx.fill();
      } else if (e.type === 'launch') {
        const r = 6 * (1 - age) * ui.scale / 3 + 2;
        ctx.strokeStyle = `rgba(255,255,255,${0.8 * (1 - age)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, Math.max(1, r), 0, 6.29); ctx.stroke();
      } else if (e.type === 'decoy') {
        ctx.strokeStyle = `rgba(255,220,120,${0.8 * (1 - age)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.12 * ui.scale, 0, 6.29); ctx.stroke();
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.03 * ui.scale, 0, 6.29); ctx.stroke();
      } else if (e.type === 'splash') {
        ctx.strokeStyle = `rgba(255,255,255,${0.6 * (1 - age)})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, 0.02 * ui.scale * (1 + age * 4), 0, 6.29); ctx.stroke();
      }
    }

    const showAll = world.debug.showAll;
    const drawn = new Set();
    if (showAll) {
      for (const t of world.platforms) {
        if (t.isPlayer || t.kind === 'buoy') continue;
        const c = world.contacts.get(t.id);
        const pos = c ? { x: pl.x + Math.sin(c.bearing * PX) * c.range, y: pl.y + Math.cos(c.bearing * PX) * c.range } : { x: t.x, y: t.y };
        const p = this.w2s(world, ui, pos.x, pos.y);
        if (this.offScreen(p)) continue;
        this.drawContactPip(c || null, t, p, world, ui);
        drawn.add(t.id);
      }
    } else {
      const pips = [];
      for (const c of world.contacts.values()) {
        const t = world.getById(c.targetId);
        if (!t) continue;
        let pip = null;
        if (c.range > 0) {
          pip = { x: pl.x + Math.sin(c.bearing * PX) * c.range, y: pl.y + Math.cos(c.bearing * PX) * c.range };
        }
        this.drawBearingLine(c, pls, pip);
        if (pip) {
          const p = this.w2s(world, ui, pip.x, pip.y);
          if (!this.offScreen(p)) pips.push({ c, t, p });
        }
        drawn.add(t.id);
      }
      for (let iter = 0; iter < 3; iter++) {
        for (let i = 0; i < pips.length; i++) {
          for (let j = i + 1; j < pips.length; j++) {
            const a = pips[i].p, b = pips[j].p;
            const dx = b.x - a.x, dy = b.y - a.y;
            const d = Math.hypot(dx, dy);
            if (d > 0.01 && d < 20) {
              const push = (20 - d) / 2;
              const ux = dx / d, uy = dy / d;
              a.x -= ux * push; a.y -= uy * push;
              b.x += ux * push; b.y += uy * push;
            }
          }
        }
      }
      for (const { c, t, p } of pips) this.drawContactPip(c, t, p, world, ui);
      for (const t of world.platforms) {
        if (t.isPlayer || t.kind === 'buoy') continue;
        if (t.sinking && !drawn.has(t.id)) {
          const p = this.w2s(world, ui, t.x, t.y);
          if (!this.offScreen(p)) this.drawSinking(t, p);
        }
      }
    }

    this.drawOwnShip(pl, pls, ui);
    this.drawIncoming(world, ui, pls);
    this.drawCursor(world, ui);
    this.drawHUD(world, ui);
    this.drawCompass(ui);
    this.drawLegend(ui);
  }

  drawGrid(world, ui) {
    const ctx = this.ctx;
    let step = 1;
    while (step * ui.scale < 22) step *= 2;
    const worldLeft = ui.cx - this.w / 2 / ui.scale;
    const worldTop = ui.cy + this.h / 2 / ui.scale;
    const firstX = Math.floor(worldLeft / step) * step;
    const firstY = Math.ceil(worldTop / step) * step;
    ctx.strokeStyle = 'rgba(60,140,90,0.13)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let gx = firstX; gx <= worldLeft + this.w / ui.scale; gx += step) {
      const p = this.w2s(world, ui, gx, worldTop);
      ctx.moveTo(p.x, 0); ctx.lineTo(p.x, this.h);
    }
    for (let gy = firstY; gy >= worldTop - this.h / ui.scale; gy -= step) {
      const p = this.w2s(world, ui, worldLeft, gy);
      ctx.moveTo(0, p.y); ctx.lineTo(this.w, p.y);
    }
    ctx.stroke();
  }

  drawRangeRings(world, ui) {
    const ctx = this.ctx;
    const pl = world.player;
    const c = this.w2s(world, ui, pl.x, pl.y);
    ctx.strokeStyle = 'rgba(120,220,150,0.14)';
    ctx.lineWidth = 1;
    for (const r of [2, 5, 10, 20, 40]) {
      if (r * ui.scale > this.w) break;
      ctx.beginPath(); ctx.arc(c.x, c.y, r * ui.scale, 0, 6.29); ctx.stroke();
      ctx.fillStyle = 'rgba(120,220,150,0.3)';
      ctx.font = '10px monospace';
      ctx.fillText(String(r), c.x + 3, c.y - r * ui.scale + 10);
    }
  }

  drawOwnShip(pl, pls, ui) {
    const ctx = this.ctx;
    const hdg = pl.heading * PX;
    ctx.save();
    ctx.translate(pls.x, pls.y);
    ctx.rotate(-hdg);
    ctx.strokeStyle = '#8dffb0';
    ctx.fillStyle = '#8dffb0';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(0, -11);
    ctx.lineTo(7, 9);
    ctx.lineTo(-7, 9);
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = 'rgba(141,255,176,0.4)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -30); ctx.stroke();
    ctx.restore();
    ctx.font = '11px monospace';
    const tw = ctx.measureText('DALLAS').width;
    ctx.fillStyle = 'rgba(4,18,10,0.75)';
    ctx.fillRect(pls.x + 10, pls.y - 10, tw + 6, 14);
    ctx.fillStyle = '#d7ffb0';
    ctx.fillText('DALLAS', pls.x + 13, pls.y + 1);
    if (pl.depth < 25) {
      ctx.strokeStyle = 'rgba(215,255,176,0.5)';
      ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.arc(pls.x, pls.y, 16, 0, 6.29); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawBearingLine(c, pls, pip) {
    const ctx = this.ctx;
    const a = c.bearing * PX;
    const ex = pip ? pip.x : pls.x + Math.sin(a) * 1e5;
    const ey = pip ? pip.y : pls.y - Math.cos(a) * 1e5;
    ctx.strokeStyle = c.esm ? 'rgba(255,200,120,0.4)' : 'rgba(140,220,160,0.22)';
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath(); ctx.moveTo(pls.x, pls.y); ctx.lineTo(ex, ey); ctx.stroke();
    ctx.setLineDash([]);
  }

  drawContactPip(c, t, p, world, ui) {
    const ctx = this.ctx;
    if (t.sinking) { this.drawSinking(t, p); return; }
    const color = c ? this.suspectColor(c.suspect) : '#9fcaa8';
    ctx.strokeStyle = color;
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 6, 0, 6.29); ctx.stroke();
    if (c && c.q > 0.15) {
      ctx.fillStyle = color;
      ctx.fillRect(p.x - 2, p.y - 2, 4, 4);
    }
    if (c) {
      const rangeErrPx = Math.max(5, (c.rangeErr || 0) * ui.scale);
      if (c.range > 0 && (c.rangeErr || 0) > 0.8 && rangeErrPx > 6) {
        ctx.strokeStyle = 'rgba(255,160,120,0.25)';
        ctx.setLineDash([2, 3]);
        ctx.beginPath(); ctx.arc(p.x, p.y, rangeErrPx, 0, 6.29); ctx.stroke();
        ctx.setLineDash([]);
      }
      const label = c.esm ? 'RDR' : `${c.num}${this.suspectChar(c.suspect)}`;
      ctx.font = '11px monospace';
      const tw = ctx.measureText(label).width;
      ctx.fillStyle = 'rgba(4,18,10,0.75)';
      ctx.fillRect(p.x + 9, p.y - 18, tw + 6, 13);
      ctx.fillStyle = color;
      ctx.fillText(label, p.x + 12, p.y - 8);
      if (c.range > 0) {
        const rtxt = `${c.range.toFixed(0)}±${c.rangeErr.toFixed(0)}`;
        const tw2 = ctx.measureText(rtxt).width;
        ctx.fillStyle = 'rgba(4,18,10,0.75)';
        ctx.fillRect(p.x + 9, p.y + 4, tw2 + 6, 12);
        ctx.fillStyle = 'rgba(160,220,170,0.75)';
        ctx.fillText(rtxt, p.x + 12, p.y + 13);
      }
    }
  }

  drawSinking(t, p) {
    const ctx = this.ctx;
    ctx.strokeStyle = 'rgba(255,90,80,0.8)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(p.x, p.y, 7, 0, 6.29); ctx.stroke();
    ctx.fillStyle = 'rgba(255,90,80,0.9)';
    ctx.font = '10px monospace';
    ctx.fillText('SINKING', p.x + 10, p.y + 4);
  }

  suspectColor(s) {
    if (s === 'MERCHANT') return '#d7ffb0';
    if (s === 'SURFACE') return '#b0ffd7';
    if (s === 'SUBMARINE') return '#ffd76a';
    if (s === 'SSBN') return '#ffd76a';
    if (s === 'AIR') return '#ffb06a';
    return '#9fcaa8';
  }
  suspectChar(s) {
    if (s === 'MERCHANT') return 'M';
    if (s === 'SURFACE') return 'S';
    if (s === 'SUBMARINE') return 'B';
    if (s === 'SSBN') return 'B';
    if (s === 'AIR') return 'A';
    return '?';
  }

  drawWeaponPath(w, ui, world) {
    if (!w.path || w.path.length < 2) return;
    const ctx = this.ctx;
    const col = w.side === 'sov' ? 'rgba(255,120,90,0.5)' : 'rgba(140,255,190,0.5)';
    ctx.strokeStyle = col;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let i = 0; i < w.path.length; i++) {
      const p = this.w2s(world, ui, w.path[i].x, w.path[i].y);
      if (i === 0) ctx.moveTo(p.x, p.y); else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
  }

  drawWeapon(w, a) {
    const ctx = this.ctx;
    const col = w.side === 'sov' ? '#ff8a6a' : '#a0ffc8';
    if (w.wire) {
      ctx.strokeStyle = 'rgba(140,255,190,0.3)';
      ctx.lineWidth = 1;
      ctx.setLineDash([2, 2]);
      ctx.beginPath(); ctx.moveTo(w.px - (w.x - w.px), w.py - (w.y - w.py)); ctx.lineTo(a.x, a.y); ctx.stroke();
      ctx.setLineDash([]);
    }
    ctx.fillStyle = col;
    if (w.kind === 'missile') {
      ctx.fillRect(a.x - 2, a.y - 1, 4, 2);
    } else {
      ctx.beginPath(); ctx.arc(a.x, a.y, 2.5, 0, 6.29); ctx.fill();
      if (w.state === 'homing') {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.beginPath(); ctx.arc(a.x, a.y, 4.5, 0, 6.29); ctx.stroke();
      }
    }
  }

  drawIncoming(world, ui, pls) {
    const ctx = this.ctx;
    const pl = world.player;
    for (const w of world.weapons) {
      if (w.dead || w.side !== 'sov') continue;
      if (w.kind === 'torpedo' && rangeNm({ x: w.x, y: w.y }, pl) < 14) {
        const brg = bearingDeg(pl, { x: w.x, y: w.y });
        const flash = Math.sin(world.t / 0.4) > 0 ? 1 : 0.3;
        const ang = brg * PX;
        const R = this.w * 0.42;
        const tip = { x: pls.x + Math.sin(ang) * R, y: pls.y - Math.cos(ang) * R };
        ctx.strokeStyle = `rgba(255,70,60,${0.75 * flash})`;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.moveTo(tip.x - 6, tip.y - 2);
        ctx.lineTo(tip.x, tip.y);
        ctx.lineTo(tip.x - 6, tip.y + 2);
        ctx.stroke();
        ctx.font = '11px monospace';
        ctx.fillStyle = `rgba(255,70,60,${flash})`;
        ctx.fillText('TORPEDO', Math.max(4, Math.min(this.w - 90, tip.x - 28)), tip.y - 6);
      }
    }
  }

  drawCursor(world, ui) {
    if (!ui.cursorValid) return;
    const ctx = this.ctx;
    const pl = world.player;
    const x = ui.cursor.x, y = ui.cursor.y;
    const p = this.w2s(world, ui, x, y);
    ctx.strokeStyle = 'rgba(180,255,200,0.8)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x - 8, p.y); ctx.lineTo(p.x + 8, p.y);
    ctx.moveTo(p.x, p.y - 8); ctx.lineTo(p.x, p.y + 8);
    ctx.stroke();
    const d = Math.hypot(x - pl.x, y - pl.y);
    const brg = bearingDeg(pl, { x, y });
    ctx.fillStyle = 'rgba(200,255,215,0.9)';
    ctx.font = '11px monospace';
    const txt = `${String(Math.round(brg)).padStart(3, '0')}°  ${d.toFixed(1)} nm`;
    const tw = ctx.measureText(txt).width;
    ctx.fillStyle = 'rgba(4,18,10,0.8)';
    ctx.fillRect(p.x + 10, p.y + 8, tw + 6, 14);
    ctx.fillStyle = 'rgba(200,255,215,0.9)';
    ctx.fillText(txt, p.x + 13, p.y + 19);
  }

  drawHUD(world, ui) {
    const ctx = this.ctx;
    const pl = world.player;
    ctx.font = '12px monospace';
    const lines = [
      ['SPD', pl.speed.toFixed(1) + ' kt'],
      ['CRS', String(Math.round(pl.heading)).padStart(3, '0') + '°'],
      ['DPT', pl.depth.toFixed(0) + ' m'],
      ['HULL', pl.hull.toFixed(0) + '%'],
      ['FLDG', pl.flooding.toFixed(0) + '%'],
    ];
    if (pl.silent) lines.push(['SILENT', 'RUNNING']);
    ctx.fillStyle = 'rgba(4,18,10,0.82)';
    ctx.fillRect(8, 8, 112, lines.length * 15 + 8);
    lines.forEach((l, i) => {
      ctx.fillStyle = 'rgba(150,255,180,0.8)';
      ctx.fillText(l[0], 14, 22 + i * 15);
      ctx.fillStyle = '#d7ffb0';
      ctx.fillText(l[1], 60, 22 + i * 15);
    });
  }

  drawCompass(ui) {
    const ctx = this.ctx;
    const x = this.w - 60, y = 60, r = 42;
    ctx.strokeStyle = 'rgba(140,255,180,0.5)';
    ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(x, y, r, 0, 6.29); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i * 30 * PX;
      const r1 = i % 3 === 0 ? r - 8 : r - 4;
      ctx.beginPath();
      ctx.moveTo(x + Math.sin(a) * r1, y - Math.cos(a) * r1);
      ctx.lineTo(x + Math.sin(a) * r, y - Math.cos(a) * r);
      ctx.stroke();
    }
    ctx.fillStyle = '#d7ffb0';
    ctx.font = '12px monospace';
    ctx.fillText('N', x - 4, y - r + 14);
    ctx.fillStyle = 'rgba(140,255,180,0.7)';
    ctx.font = '10px monospace';
    ctx.fillText('E', x + r - 10, y + 4);
    ctx.fillText('W', x - r + 4, y + 4);
    ctx.fillText('S', x - 4, y + r + 12);
  }

  drawLegend(ui) {
    const ctx = this.ctx;
    ctx.font = '11px monospace';
    const legend = [
      ['CONTACT ?', '#9fcaa8'],
      ['SURFACE', '#b0ffd7'],
      ['SUBMARINE', '#ffd76a'],
      ['MERCHANT', '#d7ffb0'],
      ['ENEMY WPN', '#ff8a6a'],
      ['OWN WPN', '#a0ffc8'],
    ];
    ctx.fillStyle = 'rgba(4,18,10,0.82)';
    ctx.fillRect(8, this.h - legend.length * 16 - 10, 118, legend.length * 16 + 6);
    legend.forEach((l, i) => {
      ctx.fillStyle = l[1];
      ctx.fillRect(14, this.h - legend.length * 16 + i * 16 + 2, 8, 8);
      ctx.fillStyle = 'rgba(200,255,215,0.85)';
      ctx.fillText(l[0], 27, this.h - legend.length * 16 + i * 16 + 10);
    });
  }

  drawSonar(world, ui) {
    const ctx = this.ctx;
    const pl = world.player;
    ctx.fillStyle = '#030d07';
    ctx.fillRect(0, 0, this.w, this.h);
    const cx = this.w / 2, cy = this.h * 0.34;
    const R = Math.min(this.w * 0.38, this.h * 0.3);
    ctx.strokeStyle = 'rgba(120,240,170,0.5)';
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(cx, cy, R, 0, 6.29); ctx.stroke();
    ctx.strokeStyle = 'rgba(120,240,170,0.15)';
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.66, 0, 6.29); ctx.stroke();
    ctx.beginPath(); ctx.arc(cx, cy, R * 0.33, 0, 6.29); ctx.stroke();
    for (let i = 0; i < 12; i++) {
      const a = i * 30 * PX;
      ctx.strokeStyle = i % 3 === 0 ? 'rgba(120,240,170,0.35)' : 'rgba(120,240,170,0.12)';
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * R * 0.1, cy - Math.cos(a) * R * 0.1);
      ctx.lineTo(cx + Math.sin(a) * R, cy - Math.cos(a) * R);
      ctx.stroke();
    }
    ctx.fillStyle = '#d7ffb0';
    ctx.font = '13px monospace';
    ctx.fillText('N', cx - 4, cy - R + 14);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(-pl.heading * PX);
    ctx.strokeStyle = '#8dffb0';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -R * 0.95); ctx.stroke();
    ctx.restore();
    for (const c of world.contacts.values()) {
      const a = c.bearing * PX;
      const inten = 0.35 + 0.65 * c.q;
      const r1 = R * 0.16, r2 = R * (0.16 + 0.55 * inten);
      ctx.strokeStyle = `rgba(255,215,110,${inten})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(cx + Math.sin(a) * r1, cy - Math.cos(a) * r1);
      ctx.lineTo(cx + Math.sin(a) * r2, cy - Math.cos(a) * r2);
      ctx.stroke();
      ctx.fillStyle = `rgba(255,230,140,${inten})`;
      ctx.beginPath(); ctx.arc(cx + Math.sin(a) * r2, cy - Math.cos(a) * r2, 2.5, 0, 6.29); ctx.fill();
      if (c.range > 0 && c.range < 40) {
        const rr = R * (0.16 + 0.7 * Math.min(1, c.range / 40) * 0.7);
        ctx.strokeStyle = `rgba(255,215,110,${0.45 * inten})`;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(cx + Math.sin(a - 0.05) * rr, cy - Math.cos(a - 0.05) * rr);
        ctx.lineTo(cx + Math.sin(a + 0.05) * rr, cy - Math.cos(a + 0.05) * rr);
        ctx.stroke();
      }
    }
    ctx.fillStyle = '#d7ffb0';
    ctx.font = '12px monospace';
    ctx.fillText(`OWN NOISE: ${pl.selfNoise.toFixed(0)}`, 12, 20);
    ctx.fillText(`SEA STATE: ${this.seaLabel(world)}`, 12, 36);
    ctx.fillText('ACTIVE PING [P]  ·  CLASSIFY IN CONTACTS PANEL', 12, this.h - 8);

    this.drawWaterfall(world, ui);
  }

  seaLabel(world) {
    const f = world.sea.factor;
    return f < 0.9 ? 'FAVORABLE' : f < 1.1 ? 'NORMAL' : 'NOISY';
  }

  drawWaterfall(world, ui) {
    const ctx = this.ctx;
    const wfW = this.wfW, wfH = this.wfH;
    const ROWT = 0.4;
    const targetRow = Math.floor(world.t / ROWT);
    const rowsToAdd = Math.min(Math.max(0, targetRow - this.wfRow), 150);
    for (let k = 0; k < rowsToAdd; k++) {
      this.wfData.data.copyWithin(0, wfW * 4);
      const off0 = (wfH - 1) * wfW * 4;
      for (let i = 0; i < wfW; i++) {
        const off = off0 + i * 4;
        this.wfData.data[off] = 3; this.wfData.data[off + 1] = 12; this.wfData.data[off + 2] = 6; this.wfData.data[off + 3] = 255;
      }
      for (const c of world.contacts.values()) {
        const col = Math.round(((c.bearing % 360) + 360) % 360 / 360 * wfW) % wfW;
        const bright = Math.round(60 + 195 * c.q);
        for (let row = 0; row < 2; row++) {
          for (let m = -3; m <= 3; m++) {
            const x = (col + m + wfW) % wfW;
            const off = off0 - row * wfW * 4 + x * 4;
            if (off < 0) continue;
            this.wfData.data[off] = c.esm ? 255 : 210;
            this.wfData.data[off + 1] = 245;
            this.wfData.data[off + 2] = c.esm ? 120 : bright;
            this.wfData.data[off + 3] = 255;
          }
        }
      }
      this.wfCtx.putImageData(this.wfData, 0, 0);
      this.wfRow++;
    }
    const y0 = this.h * 0.42;
    const availH = Math.max(60, this.h - y0 - 20);
    const scale = Math.min(1.4, (this.w - 8) / wfW, availH / wfH);
    const drawnW = wfW * scale;
    ctx.save();
    ctx.translate(0, y0);
    ctx.scale(scale, scale);
    ctx.drawImage(this.wfCanvas, 0, 0);
    ctx.restore();
    ctx.strokeStyle = 'rgba(120,240,170,0.3)';
    ctx.strokeRect(0, y0, drawnW, (this.h - y0 - 20));
    ctx.fillStyle = 'rgba(200,255,215,0.7)';
    ctx.font = '10px monospace';
    for (const b of [0, 90, 180, 270]) {
      ctx.fillText(`${String(b).padStart(3, '0')}`, b / 360 * drawnW, y0 + (this.h - y0 - 20) - 4);
    }
    ctx.fillText('TIME → BEARING (WATERFALL)', this.w / 2 - 90, y0 + (this.h - y0 - 20) + 14);
  }

  drawCampaign(world, ui, campaign) {
    const ctx = this.ctx;
    ctx.fillStyle = '#03100b';
    ctx.fillRect(0, 0, this.w, this.h);
    const W = this.w, H = this.h;
    const lon0 = -90, lon1 = 40, lat0 = 15, lat1 = 80;
    const mx = (lon) => (lon - lon0) / (lon1 - lon0) * W;
    const my = (lat) => (lat1 - lat) / (lat1 - lat0) * H;
    ctx.strokeStyle = 'rgba(80,170,110,0.12)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let lon = lon0; lon <= lon1; lon += 10) { ctx.moveTo(mx(lon), 0); ctx.lineTo(mx(lon), H); }
    for (let lat = lat0; lat <= lat1; lat += 10) { ctx.moveTo(0, my(lat)); ctx.lineTo(W, my(lat)); }
    ctx.stroke();
    for (const k in COASTS) {
      ctx.beginPath();
      COASTS[k].forEach(([lon, lat], i) => { if (i === 0) ctx.moveTo(mx(lon), my(lat)); else ctx.lineTo(mx(lon), my(lat)); });
      ctx.closePath();
      ctx.fillStyle = 'rgba(40,110,60,0.5)';
      ctx.fill();
      ctx.strokeStyle = 'rgba(110,220,140,0.7)';
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(200,255,215,0.55)';
    ctx.font = '11px monospace';
    for (const lon of [-70, -50, -30, -10, 10, 30]) ctx.fillText(`${lon >= 0 ? '' : ''}${lon}°`, mx(lon) + 3, H - 6);
    for (const lat of [25, 40, 55, 70]) ctx.fillText(`${lat}°`, 3, my(lat) + 12);

    const m = campaign.currentMission || campaign.missions.find(x => x.state === 'available');
    if (m && m.area) {
      ctx.strokeStyle = 'rgba(255,220,120,0.6)';
      ctx.setLineDash([5, 5]);
      ctx.beginPath(); ctx.arc(mx(m.area.lon), my(m.area.lat), 42, 0, 6.29); ctx.stroke();
      ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(255,220,120,0.9)';
      ctx.fillText('PATROL AREA', mx(m.area.lon) - 36, my(m.area.lat) - 46);
    }

    if (world) {
      const pl = world.player;
      const px = mx(-50), py = my(57);
      ctx.fillStyle = '#8dffb0';
      ctx.beginPath(); ctx.arc(px, py, 5, 0, 6.29); ctx.fill();
      ctx.fillStyle = '#d7ffb0';
      ctx.font = '11px monospace';
      ctx.fillText('USS DALLAS', px + 8, py + 4);
      const plLat = world.mission && world.mission.area ? world.mission.area.lat : 57;
      const plLon = world.mission && world.mission.area ? world.mission.area.lon - 1.5 : -50;
      ctx.fillStyle = '#b0ffd7';
      ctx.beginPath(); ctx.arc(mx(plLon), my(plLat), 3, 0, 6.29); ctx.fill();
    }

    ctx.fillStyle = 'rgba(4,18,10,0.85)';
    ctx.fillRect(8, 8, W - 16, 92);
    ctx.fillStyle = '#d7ffb0';
    ctx.font = 'bold 14px monospace';
    ctx.fillText('NORTH ATLANTIC — WAR SITUATION MAP', 16, 26);
    ctx.font = '12px monospace';
    ctx.fillStyle = 'rgba(200,255,215,0.9)';
    if (campaign) {
      let y = 42;
      ctx.fillText(`WAR DAY ${campaign.day}   TONNAGE SUNK ${campaign.tonnage.toLocaleString()}t   CONVOYS DELIVERED ${campaign.convoysDelivered}`, 16, y);
      y += 16;
      const news = campaign.news.slice(0, 2);
      for (const n of news) {
        ctx.fillStyle = 'rgba(255,215,120,0.85)';
        ctx.fillText('» ' + n, 16, y);
        y += 15;
      }
    }
    ctx.fillStyle = 'rgba(180,255,200,0.8)';
    ctx.fillText('[ESC] RETURN TO TACTICAL VIEW', W / 2 - 110, H - 6);
  }

  offScreen(p) {
    return p.x < -40 || p.y < -40 || p.x > this.w + 40 || p.y > this.h + 40;
  }
}
