import { N, T, hash2, idx, BUILDING_TYPES } from './world.js';
import { CLASSES, WEAPONS, MONSTERS, ITEMS } from './entities.js';

export const TW = 64, TH = 32;
export const isoX = (x, y) => (x - y) * (TW / 2);
export const isoY = (x, y) => (x + y) * (TH / 2);

const C = {
  GRASS: '#5d8a3c', GRASS2: '#53803a', GRASS_L: '#67933f', GRASS_D: '#4a7134',
  PATH: '#c2a878', PATH_D: '#a8895c',
  STONE: '#a0a6ae', STONE_D: '#82888f',
  PLAZA: '#b5a688', PLAZA_D: '#9d8f74',
  WATER: '#2f6f8f', WATER_L: '#4a93b5', WATER_D: '#275f7d',
  SAND: '#d6c188',
  ROCK: '#8b867e', ROCK_D: '#6f6a62', ROCK_L: '#9d9890',
  WALL_T: '#b6bcc4', WALL: '#9aa0a8', WALL_D: '#7e858e',
  BUILD: '#8a6f4d', BUILD_D: '#7c6344',
  FOUNTAIN: '#5a6670', FOUNTAIN_W: '#4a93b5',
  OUT: '#10131a',
};

function hexA(hex, a){
  const r = parseInt(hex.slice(1, 3), 16), g = parseInt(hex.slice(3, 5), 16), b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export class Renderer {
  constructor(canvas, miniCanvas){
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.miniCtx = miniCanvas ? miniCanvas.getContext('2d') : null;
    this.w = 0; this.h = 0;
    this.resize();
  }

  resize(){
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.w = window.innerWidth;
    this.h = window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.canvas.style.width = this.w + 'px';
    this.canvas.style.height = this.h + 'px';
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.dpr = dpr;
  }

  computeZoom(){
    const z = Math.min(this.w / (20 * TW), this.h / (13 * TH));
    return Math.max(0.55, Math.min(1.3, z));
  }

  render(g){
    const ctx = this.ctx;
    ctx.fillStyle = C.OUT;
    ctx.fillRect(0, 0, this.w, this.h);
    const z = g.cam.zoom;
    const ox = this.w / 2 - isoX(g.cam.x, g.cam.y) * z;
    const oy = this.h / 2 - isoY(g.cam.x, g.cam.y) * z;
    this.ox = ox; this.oy = oy; this.z = z;
    const grid = g.grid;

    const corners = [[0, 0], [this.w, 0], [0, this.h], [this.w, this.h]].map(([sx, sy]) => {
      const a = (sx - ox) / z, b = (sy - oy) / z;
      const u = 2 * a / TW, v = 2 * b / TH;
      return { x: (u + v) / 2, y: (v - u) / 2 };
    });
    const xs = corners.map(c => c.x), ys = corners.map(c => c.y);
    const minX = Math.max(0, Math.floor(Math.min(...xs)) - 1);
    const maxX = Math.min(N - 1, Math.ceil(Math.max(...xs)) + 1);
    const minY = Math.max(0, Math.floor(Math.min(...ys)) - 1);
    const maxY = Math.min(N - 1, Math.ceil(Math.max(...ys)) + 1);

    const draw = [];
    for (let y = minY; y <= maxY; y++) for (let x = minX; x <= maxX; x++){
      draw.push({ d: x + y, k: 0, x, y, t: grid[idx(x, y)] });
    }
    for (const b of g.buildings) draw.push({ d: (b.x + b.w - 1) + (b.y + b.h - 1), k: 1, b });
    for (const m of g.monsters){
      if (m.x < minX - 2 || m.x > maxX + 2 || m.y < minY - 2 || m.y > maxY + 2) continue;
      draw.push({ d: m.x + m.y, k: 2, m });
    }
    draw.push({ d: g.player.x + g.player.y, k: 2, p: g.player });
    for (const r of g.remote){
      draw.push({ d: r.x + r.y, k: 2, r });
    }
    for (const l of g.loot) draw.push({ d: l.x + l.y, k: 3, l });
    for (const f of g.fx) draw.push({ d: f.x + f.y, k: 4, f });
    for (const pr of g.projectiles) draw.push({ d: pr.x + pr.y, k: 5, pr });
    draw.sort((a, b) => (a.d - b.d) || (a.k - b.k));

    const t = g.time;
    for (const d of draw){
      if (d.k === 0) this.drawTile(d.x, d.y, d.t, t);
      else if (d.k === 1) this.drawBuilding(d.b, t);
      else if (d.k === 2){
        if (d.m) this.drawMonster(d.m, t, g);
        else if (d.p) this.drawPlayer(d.p, g);
        else if (d.r) this.drawRemote(d.r, g);
      }
      else if (d.k === 3) this.drawLoot(d.l);
      else if (d.k === 4) this.drawFx(d.f);
      else if (d.k === 5) this.drawProjectile(d.pr);
    }
  }

  drawTile(x, y, t, time){
    const ctx = this.ctx, z = this.z, ox = this.ox, oy = this.oy;
    const s0x = ox + isoX(x, y) * z, s0y = oy + isoY(x, y) * z;
    const s1x = ox + isoX(x + 1, y) * z, s1y = oy + isoY(x + 1, y) * z;
    const s2x = ox + isoX(x + 1, y + 1) * z, s2y = oy + isoY(x + 1, y + 1) * z;
    const s3x = ox + isoX(x, y + 1) * z, s3y = oy + isoY(x, y + 1) * z;
    const cx = (s0x + s2x) / 2, cy = (s0y + s2y) / 2;
    const h = hash2(x, y);

    const diamond = () => {
      ctx.beginPath();
      ctx.moveTo(s0x, s0y); ctx.lineTo(s1x, s1y); ctx.lineTo(s2x, s2y); ctx.lineTo(s3x, s3y);
      ctx.closePath();
    };

    if (t === T.WATER){
      diamond(); ctx.fillStyle = C.WATER; ctx.fill();
      const ph = (time * 0.7 + (x + y) * 0.5) % 1;
      ctx.fillStyle = hexA(C.WATER_L, 0.35);
      ctx.beginPath();
      ctx.moveTo(s0x, s0y + ph * TH * z * 0.8);
      ctx.lineTo(s1x, s1y + ph * TH * z * 0.8 + 2 * z);
      ctx.lineTo(s2x, s2y + ph * TH * z * 0.8);
      ctx.lineTo(s3x, s3y + ph * TH * z * 0.8 - 2 * z);
      ctx.closePath(); ctx.fill();
      return;
    }
    if (t === T.GRASS || t === T.GRASS2){
      const base = h < 0.28 ? C.GRASS_D : (h > 0.82 ? C.GRASS_L : (t === T.GRASS2 ? C.GRASS2 : C.GRASS));
      diamond(); ctx.fillStyle = base; ctx.fill();
      ctx.fillStyle = 'rgba(18,60,20,0.4)';
      const bx = (s0x + s2x) / 2 + (h * 24 - 12) * z * 0.35;
      const by = (s0y + s2y) / 2;
      ctx.fillRect(bx - 1, by - 3.5 * z, 1.6 * z, 4 * z);
      ctx.fillRect(bx - 8 * z, by - 1.5 * z, 1.2 * z, 3.2 * z);
      return;
    }
    if (t === T.PATH || t === T.PLAZA){
      diamond();
      ctx.fillStyle = t === T.PATH ? (h < 0.5 ? C.PATH : C.PATH_D) : (h < 0.5 ? C.PLAZA : C.PLAZA_D);
      ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.12)';
      ctx.fillRect(cx + (h * 20 - 10) * z * 0.3, cy - 1, 2 * z, 2 * z);
      ctx.fillRect(cx - 6 * z, cy + (h * 16 - 8) * z * 0.3, 1.6 * z, 1.6 * z);
      return;
    }
    if (t === T.STONE){
      diamond(); ctx.fillStyle = h < 0.5 ? C.STONE : C.STONE_D; ctx.fill();
      ctx.strokeStyle = 'rgba(60,64,70,0.35)'; ctx.lineWidth = Math.max(1, 1.2 * z);
      const w = 0.45;
      ctx.beginPath();
      ctx.moveTo(s0x + (s1x - s0x) * w, s0y + (s1y - s0y) * w);
      ctx.lineTo(s3x + (s2x - s3x) * w, s3y + (s2y - s3y) * w);
      ctx.moveTo(s1x + (s2x - s1x) * 0.55, s1y + (s2y - s1y) * 0.55);
      ctx.lineTo(s0x + (s3x - s0x) * 0.55, s0y + (s3y - s0y) * 0.55);
      ctx.stroke();
      return;
    }
    if (t === T.SAND){
      diamond(); ctx.fillStyle = C.SAND; ctx.fill();
      ctx.fillStyle = 'rgba(90,72,40,0.25)';
      ctx.fillRect(cx + (h * 18 - 9) * z * 0.4, cy - 1, 2 * z, 1.2 * z);
      return;
    }
    if (t === T.ROCK){
      diamond(); ctx.fillStyle = h < 0.5 ? C.ROCK : C.ROCK_D; ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.25)';
      ctx.beginPath(); ctx.ellipse(cx + 2 * z, cy + 2 * z, 6 * z, 3 * z, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.12)';
      ctx.beginPath(); ctx.ellipse(cx - 3 * z, cy - 2 * z, 5 * z, 2.5 * z, -0.4, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (t === T.TREE){
      diamond(); ctx.fillStyle = h < 0.5 ? C.GRASS : C.GRASS2; ctx.fill();
      const sway = Math.sin(time * 1.2 + h * 20) * 1.2 * z;
      ctx.fillStyle = '#5f4326';
      ctx.fillRect(cx - 1.6 * z + sway * 0.2, cy - 8 * z, 3.2 * z, 9 * z);
      const c0 = h < 0.5 ? '#3f6b2a' : '#47732f';
      const c1 = h < 0.5 ? '#54803a' : '#5c8a42';
      ctx.fillStyle = c0;
      ctx.beginPath(); ctx.arc(cx - 5 * z + sway, cy - 13 * z, 6.5 * z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c1;
      ctx.beginPath(); ctx.arc(cx + 4 * z + sway, cy - 14 * z, 5.5 * z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = c0;
      ctx.beginPath(); ctx.arc(cx + sway, cy - 18 * z, 6.5 * z, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.14)';
      ctx.beginPath(); ctx.ellipse(cx, cy - 1 * z, 9 * z, 3.5 * z, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (t === T.WALL){
      const wallH = 15 * z;
      diamond(); ctx.fillStyle = '#8a8f96'; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s1x, s1y); ctx.lineTo(s2x, s2y); ctx.lineTo(s2x, s2y - wallH); ctx.lineTo(s1x, s1y - wallH);
      ctx.closePath(); ctx.fillStyle = C.WALL; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s0x, s0y); ctx.lineTo(s3x, s3y); ctx.lineTo(s3x, s3y - wallH); ctx.lineTo(s0x, s0y - wallH);
      ctx.closePath(); ctx.fillStyle = C.WALL_D; ctx.fill();
      ctx.beginPath();
      ctx.moveTo(s0x, s0y - wallH); ctx.lineTo(s1x, s1y - wallH); ctx.lineTo(s2x, s2y - wallH); ctx.lineTo(s3x, s3y - wallH);
      ctx.closePath(); ctx.fillStyle = C.WALL_T; ctx.fill();
      ctx.strokeStyle = 'rgba(40,44,50,0.5)'; ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(s1x, s1y - wallH * 0.45); ctx.lineTo(s2x, s2y - wallH * 0.45);
      ctx.moveTo(s0x, s0y - wallH * 0.45); ctx.lineTo(s3x, s3y - wallH * 0.45);
      ctx.stroke();
      return;
    }
    if (t === T.DOOR){
      diamond(); ctx.fillStyle = '#6f6a62'; ctx.fill();
      ctx.fillStyle = 'rgba(0,0,0,0.35)';
      ctx.beginPath(); ctx.ellipse(cx, cy, 6 * z, 3 * z, 0, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (t === T.BUILD){
      diamond(); ctx.fillStyle = h < 0.5 ? C.BUILD : C.BUILD_D; ctx.fill();
      return;
    }
    if (t === T.FOUNTAIN){
      diamond(); ctx.fillStyle = C.PLAZA_D; ctx.fill();
      ctx.fillStyle = '#6a7680';
      ctx.beginPath(); ctx.ellipse(cx, cy, 7 * z, 3.6 * z, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#4a93b5';
      ctx.beginPath(); ctx.ellipse(cx, cy - 4 * z, 5 * z, 2.6 * z, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#8a949e';
      ctx.fillRect(cx - 1.4 * z, cy - 8 * z, 2.8 * z, 5 * z);
      ctx.fillStyle = '#4a93b5';
      ctx.beginPath(); ctx.arc(cx, cy - 9 * z, 2.2 * z, 0, Math.PI * 2); ctx.fill();
      return;
    }
  }

  drawBuilding(b, time){
    const ctx = this.ctx, z = this.z, ox = this.ox, oy = this.oy;
    const bt = BUILDING_TYPES[b.type];
    const { x, y, w, h } = b;
    const wallH = 26 * z;
    const P = (tx, ty, lift) => [ox + isoX(tx, ty) * z, oy + isoY(tx, ty) * z - lift * z];
    const TR = P(x + w - 1, y, 0), BR = P(x + w - 1, y + h - 1, 0);
    const TL = P(x, y, 0), BL = P(x, y + h - 1, 0);
    const TRt = P(x + w - 1, y, wallH), BRt = P(x + w - 1, y + h - 1, wallH);
    const TLt = P(x, y, wallH), BLt = P(x, y + h - 1, wallH);

    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath(); ctx.ellipse((BR[0] + BL[0]) / 2, (BR[1] + BL[1]) / 2 + 2 * z, 15 * z, 5 * z, 0, 0, Math.PI * 2); ctx.fill();

    ctx.beginPath();
    ctx.moveTo(BR[0], BR[1]); ctx.lineTo(TR[0], TR[1]); ctx.lineTo(TRt[0], TRt[1]); ctx.lineTo(BRt[0], BRt[1]);
    ctx.closePath(); ctx.fillStyle = bt.walls; ctx.fill();
    ctx.beginPath();
    ctx.moveTo(BR[0], BR[1]); ctx.lineTo(BL[0], BL[1]); ctx.lineTo(BLt[0], BLt[1]); ctx.lineTo(BRt[0], BRt[1]);
    ctx.closePath(); ctx.fillStyle = bt.wallDark; ctx.fill();

    const cxr = (TLt[0] + TRt[0] + BLt[0] + BRt[0]) / 4, cyr = (TLt[1] + TRt[1] + BLt[1] + BRt[1]) / 4;
    const push = p => [cxr + (p[0] - cxr) * 1.09, cyr + (p[1] - cyr) * 1.09];
    const rTL = push(TLt), rTR = push(TRt), rBR = push(BRt), rBL = push(BLt);
    ctx.beginPath();
    ctx.moveTo(rTL[0], rTL[1]); ctx.lineTo(rTR[0], rTR[1]); ctx.lineTo(rBR[0], rBR[1]); ctx.lineTo(rBL[0], rBL[1]);
    ctx.closePath(); ctx.fillStyle = bt.roof; ctx.fill();
    ctx.strokeStyle = bt.roofDark; ctx.lineWidth = Math.max(1, 1.6 * z);
    ctx.beginPath(); ctx.moveTo(rTL[0], rTL[1]); ctx.lineTo(rBR[0], rBR[1]); ctx.stroke();
    ctx.strokeStyle = hexA(bt.roofDark, 0.18); ctx.lineWidth = Math.max(1, 2 * z);
    ctx.beginPath(); ctx.moveTo(rTR[0], rTR[1]); ctx.lineTo(rBL[0], rBL[1]); ctx.stroke();

    ctx.fillStyle = 'rgba(0,0,0,0.22)';
    ctx.beginPath();
    ctx.moveTo(TR[0], TR[1]); ctx.lineTo(BR[0], BR[1]); ctx.lineTo(BR[0] + 1, BR[1] + 1);
    ctx.lineTo(BLt[0], BLt[1]); ctx.lineTo(TRt[0], TRt[1]);
    ctx.closePath(); ctx.fill();

    const door = (face) => {
      const f = face === 'r' ? [BR, TR, BRt, TRt] : [BR, BL, BRt, BLt];
      const [a, c, b, d] = f;
      const px0 = a[0] + (c[0] - a[0]) * 0.16;
      const py0 = a[1] + (c[1] - a[1]) * 0.16;
      const pw = 4.6 * z, ph = 8.5 * z;
      const vx = (c[0] - a[0]) / 1, vy = (c[1] - a[1]) / 1;
      const len = Math.hypot(vx, vy) || 1;
      const ux = vx / len * pw, uy = vy / len * pw;
      ctx.fillStyle = '#4a3626';
      ctx.beginPath();
      ctx.moveTo(px0, py0); ctx.lineTo(px0 + ux, py0 + uy);
      ctx.lineTo(px0 + ux, py0 + uy - ph); ctx.lineTo(px0, py0 - ph);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.beginPath();
      ctx.moveTo(px0, py0 - ph); ctx.lineTo(px0 + ux, py0 + uy - ph);
      ctx.lineTo((px0 + ux + px0) / 2, (py0 + uy + py0) / 2 - ph * 0.55);
      ctx.closePath(); ctx.fill();
    };
    door('r');

    const window = (face, fx, fy) => {
      const f = face === 'r' ? [BR, TR, BRt, TRt] : [BR, BL, BRt, BLt];
      const [a, c] = f;
      const vx = (c[0] - a[0]) / 1, vy = (c[1] - a[1]) / 1;
      const len = Math.hypot(vx, vy) || 1;
      const px0 = a[0] + vx / len * 3.4 * z + (c[0] - a[0]) * fx;
      const py0 = a[1] + vy / len * 3.4 * z + (c[1] - a[1]) * fy;
      const pw = 3 * z;
      const ux = vx / len * pw, uy = vy / len * pw;
      ctx.fillStyle = '#d9cfa8';
      ctx.beginPath();
      ctx.moveTo(px0, py0 - 3.4 * z); ctx.lineTo(px0 + ux, py0 + uy - 3.4 * z);
      ctx.lineTo(px0 + ux, py0 + uy - 6.4 * z); ctx.lineTo(px0, py0 - 6.4 * z);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(40,30,20,0.7)'; ctx.lineWidth = 1;
      ctx.stroke();
    };
    window('l', 0.5, 0.35);
    window('l', 0.5, 0.65);

    if (b.type === 'healer'){
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(BRt[0] - 3.4 * z, BRt[1] - wallH + 5 * z, 7 * z, 2 * z);
      ctx.fillRect(BRt[0] - 0.4 * z, BRt[1] - wallH + 2.6 * z, 2 * z, 7 * z);
    }
    if (b.type === 'inn'){
      ctx.fillStyle = '#4a3626';
      const sx0 = TRt[0] - 3 * z, sy0 = TRt[1] - wallH + 6 * z;
      ctx.fillRect(sx0, sy0, 9 * z, 5 * z);
      ctx.fillStyle = '#e8d287';
      ctx.fillRect(sx0 + 1 * z, sy0 + 1 * z, 7 * z, 3 * z);
    }
    if (b.type === 'smith'){
      ctx.fillStyle = bt.wallDark;
      ctx.fillRect(cxr - 2 * z, cyr - wallH - 12 * z, 4 * z, 13 * z);
      ctx.fillStyle = '#2c2f33';
      ctx.beginPath();
      ctx.moveTo(cxr - 4 * z, cyr - wallH - 12 * z);
      ctx.lineTo(cxr + 4 * z, cyr - wallH - 12 * z);
      ctx.lineTo(cxr, cyr - wallH - 17 * z);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = 'rgba(180,180,190,0.5)';
      ctx.beginPath(); ctx.arc(cxr + 2 * z, cyr - wallH - 16 * z, 3 * z * (0.6 + 0.4 * Math.sin(time * 2)), 0, Math.PI * 2); ctx.fill();
    }
    if (b.type === 'bank'){
      ctx.strokeStyle = '#d4af37'; ctx.lineWidth = Math.max(1, 1.4 * z);
      ctx.beginPath();
      ctx.moveTo(rTL[0], rTL[1]); ctx.lineTo(rTR[0], rTR[1]); ctx.lineTo(rBR[0], rBR[1]); ctx.lineTo(rBL[0], rBL[1]); ctx.closePath();
      ctx.stroke();
    }
    if (b.type === 'temple'){
      ctx.fillStyle = bt.roof;
      const spX = cxr, spY = cyr - wallH - 16 * z;
      ctx.fillRect(spX - 3 * z, spY + 4 * z, 6 * z, 17 * z);
      ctx.beginPath();
      ctx.moveTo(spX - 6 * z, spY + 4 * z); ctx.lineTo(spX + 6 * z, spY + 4 * z); ctx.lineTo(spX, spY - 9 * z);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8d287';
      ctx.beginPath(); ctx.arc(spX, spY + 6 * z, 1.6 * z, 0, Math.PI * 2); ctx.fill();
    }
  }

  drawPlayer(p, g){
    const ctx = this.ctx, z = this.z;
    const sx = this.ox + isoX(p.x, p.y) * z;
    const sy = this.oy + isoY(p.x, p.y) * z;
    const cls = CLASSES[p.cls];
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx, sy, 7 * z, 3.2 * z, 0, 0, Math.PI * 2); ctx.fill();
    if (p.dead) return;
    const mirror = p.mirror;
    const o = {
      tunic: cls.color, pants: '#3a3d42', skin: '#e0ac7a', hair: '#3a2a1a',
      walk: p.walk, attack: p.attack, casting: p.castT > 0 ? 1 : 0,
      weapon: WEAPONS[p.weapon] || WEAPONS.fists, mirror,
    };
    this.drawCharacter(sx, sy, o);
    const nameY = sy - 40 * z;
    ctx.font = `bold ${Math.max(9, 11 * z)}px Galdeano, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(p.name, sx + 1, nameY + 1);
    ctx.fillStyle = '#fff8e7';
    ctx.fillText(p.name, sx, nameY);
    this.drawHpBar(sx, nameY - 4, p.hp, p.maxHp, z);
  }

  drawRemote(r, g){
    const ctx = this.ctx, z = this.z;
    const sx = this.ox + isoX(r.x, r.y) * z;
    const sy = this.oy + isoY(r.x, r.y) * z;
    const cls = CLASSES[r.cls] || CLASSES.warrior;
    ctx.fillStyle = 'rgba(0,0,0,0.3)';
    ctx.beginPath(); ctx.ellipse(sx, sy, 7 * z, 3.2 * z, 0, 0, Math.PI * 2); ctx.fill();
    const o = {
      tunic: cls.color, pants: '#34363b', skin: '#dcb28a', hair: '#4a3a28',
      walk: r.walk, attack: 0, casting: 0,
      weapon: WEAPONS[r.weapon] || WEAPONS.fists, mirror: r.mirror,
    };
    this.drawCharacter(sx, sy, o);
    const nameY = sy - 40 * z;
    ctx.font = `bold ${Math.max(9, 11 * z)}px Galdeano, sans-serif`;
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillText(r.name, sx + 1, nameY + 1);
    ctx.fillStyle = cls.color;
    ctx.fillText(r.name, sx, nameY);
    if (r.hp !== undefined && r.hpPct !== undefined && r.hpPct < 0.99) this.drawHpBar(sx, nameY - 4, r.hp, r.maxHp, z);
  }

  drawHpBar(sx, sy, hp, maxHp, z){
    const ctx = this.ctx;
    const w = 18 * z, h = 2.6 * z;
    const pct = Math.max(0, Math.min(1, hp / maxHp));
    ctx.fillStyle = 'rgba(0,0,0,0.6)';
    ctx.fillRect(sx - w / 2, sy, w, h);
    ctx.fillStyle = pct > 0.5 ? '#5cb85c' : (pct > 0.25 ? '#e8c24a' : '#d4543a');
    ctx.fillRect(sx - w / 2 + 0.5, sy + 0.5, (w - 1) * pct, h - 1);
  }

  drawCharacter(sx, sy, o){
    const ctx = this.ctx, z = this.z;
    ctx.save();
    ctx.translate(sx, sy);
    ctx.scale(o.mirror ? -z : z, z);
    const w = o.weapon;
    const legSw = Math.sin(o.walk * 2.2) * 3;
    ctx.fillStyle = o.pants;
    ctx.fillRect(-3.2, -10, 2.6, 10 + legSw * 0.3);
    ctx.fillRect(0.6, -10, 2.6, 10 - legSw * 0.3);
    ctx.fillStyle = o.tunic;
    ctx.beginPath();
    ctx.moveTo(-5.5, -10.5); ctx.lineTo(-5.5, -22); ctx.lineTo(5.5, -22); ctx.lineTo(5.5, -10.5);
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.fillRect(-5.5, -14, 11, 1.8);
    const armSwing = o.attack > 0 ? Math.sin(o.attack * Math.PI) : 0;
    ctx.fillStyle = o.skin;
    ctx.fillRect(-7, -22 + armSwing * 2, 2, 8 - armSwing * 2);
    ctx.fillStyle = o.tunic;
    ctx.fillRect(-7, -22, 2, 2.5);
    ctx.fillRect(5, -22, 2.2, 2.5);
    const castLift = o.casting > 0 ? Math.sin(o.casting * 9) * 1.5 * 0 : 0;
    ctx.save();
    const handX = 6, handY = -21 + castLift;
    ctx.translate(handX, handY);
    if (o.attack > 0) ctx.rotate(-1.4 + o.attack * 2.4);
    ctx.fillStyle = o.skin;
    ctx.fillRect(-2.5, -1.5, 5, 3);
    this.drawWeapon(w, o.attack > 0.5 ? 1 : 0);
    ctx.restore();
    ctx.fillStyle = o.skin;
    ctx.beginPath(); ctx.arc(0, -27.5, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = o.hair;
    ctx.beginPath(); ctx.arc(0, -28.5, 5, Math.PI, Math.PI * 2); ctx.fill();
    ctx.fillRect(-5, -28.5, 10, 1.6);
    ctx.restore();
  }

  drawWeapon(w, swing){
    const ctx = this.ctx;
    ctx.lineCap = 'round';
    if (w.kind === 'fists'){
      ctx.fillStyle = w.color;
      ctx.beginPath(); ctx.arc(1, 0, 2, 0, Math.PI * 2); ctx.fill();
      return;
    }
    if (w.color){
      ctx.strokeStyle = w.color;
      if (w.name === 'Staff'){
        ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(1, 2); ctx.lineTo(1, -18); ctx.stroke();
        ctx.fillStyle = '#c9a53a';
        ctx.beginPath(); ctx.arc(1, -19, 2.2, 0, Math.PI * 2); ctx.fill();
        return;
      }
      if (w.name === 'Club'){
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(1, 2); ctx.lineTo(1, -13); ctx.stroke();
        ctx.fillStyle = w.color;
        ctx.beginPath(); ctx.arc(1, -14, 2.6, 0, Math.PI * 2); ctx.fill();
        return;
      }
      if (w.name === 'Mace'){
        ctx.strokeStyle = '#7a6a4a'; ctx.lineWidth = 1.8;
        ctx.beginPath(); ctx.moveTo(1, 2); ctx.lineTo(1, -13); ctx.stroke();
        ctx.fillStyle = '#9aa0a8';
        ctx.beginPath(); ctx.arc(1, -15, 2.8, 0, Math.PI * 2); ctx.fill();
        return;
      }
      ctx.lineWidth = w.name.includes('Great') ? 4 : (w.name.includes('Broad') || w.name.includes('Long') ? 3 : 2);
      ctx.beginPath(); ctx.moveTo(1, 1); ctx.lineTo(1, -16); ctx.stroke();
      ctx.strokeStyle = '#7a6a4a'; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-1.5, -8); ctx.lineTo(3.5, -8); ctx.stroke();
      if (w.name.includes('Axe')){
        ctx.fillStyle = '#9fb0c0';
        ctx.beginPath(); ctx.arc(1, -15, 3, -Math.PI * 0.5, Math.PI * 0.5); ctx.fill();
      }
    }
  }

  drawMonster(m, time, g){
    const ctx = this.ctx, z = this.z;
    const sx = this.ox + isoX(m.x, m.y) * z;
    const sy = this.oy + isoY(m.x, m.y) * z;
    const base = MONSTERS[m.type];
    ctx.save();
    ctx.translate(sx, sy);
    if (m.corpseT > 0){
      const fade = Math.max(0, m.corpseT) / 4;
      ctx.globalAlpha = fade;
      ctx.fillStyle = base.color;
      ctx.beginPath(); ctx.ellipse(0, -3 * z, 9 * z, 4 * z, 0, 0, Math.PI * 2); ctx.fill();
      ctx.restore();
      return;
    }
    ctx.scale(m.mirror ? -z : z, z);
    const bob = Math.sin(m.walk * 2) * 0;
    const hurt = m.hurt > 0 ? 1 : 0;
    this.drawMonsterShape(m.type, base, bob, hurt, time);
    ctx.restore();

    const show = m.hp < m.maxHp || g.hover === m || m.aggro;
    if (show){
      const hpY = sy - this.monsterH(m.type) * z - 12 * z;
      this.drawHpBar(sx, hpY, m.hp, m.maxHp, z);
      ctx.font = `bold ${Math.max(8, 10 * z)}px Galdeano, sans-serif`;
      ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillText(base.name, sx + 1, hpY - 3);
      ctx.fillStyle = '#e8e0cf';
      ctx.fillText(base.name, sx, hpY - 4);
    }
  }

  monsterH(type){
    const h = {
      rat: 8, beetle: 8, wolf: 12, goblin: 16, spider: 10, skeleton: 20,
      orc: 22, shadow: 14, ogre: 26, troll: 28, dragon: 34,
    };
    return h[type] || 16;
  }

  drawMonsterShape(type, base, bob, hurt, time){
    const ctx = this.ctx;
    ctx.lineJoin = 'round';
    const hit = hurt ? 1 : 0;
    const col = hit ? '#e04040' : base.color;
    const dark = 'rgba(0,0,0,0.3)';
    if (type === 'rat'){
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, -4, 8, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(7, -6, 4, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8b8b8';
      ctx.beginPath(); ctx.arc(9, -7, 1.2, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-8, -5); ctx.quadraticCurveTo(-13, -8, -11, -1); ctx.stroke();
      ctx.fillStyle = dark;
      ctx.fillRect(-4, -1, 2, 4); ctx.fillRect(1, -1, 2, 4); ctx.fillRect(-1, -1, 2, 4);
    } else if (type === 'beetle'){
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, -5, 6, 4.5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5, -5, 3, 3, 0, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.arc(0, -6, 4, Math.PI * 0.9, Math.PI * 1.6); ctx.stroke();
      ctx.strokeStyle = dark; ctx.lineWidth = 1.2;
      for (let i = 0; i < 3; i++){
        ctx.beginPath(); ctx.moveTo(-5 + i * 3, -3); ctx.lineTo(-6 + i * 3, 0); ctx.stroke();
      }
    } else if (type === 'wolf'){
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, -6, 11, 5, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(9, -8, 4.5, 3.6, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#e8e8e8';
      ctx.beginPath(); ctx.arc(12, -9, 1.4, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(6, -11); ctx.lineTo(9, -15); ctx.lineTo(10, -10); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(10, -11); ctx.lineTo(13, -14); ctx.lineTo(13, -10); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.6;
      ctx.beginPath(); ctx.moveTo(-9, -5); ctx.quadraticCurveTo(-15, -4, -14, 1); ctx.stroke();
      ctx.fillStyle = dark;
      for (let i = 0; i < 4; i++) ctx.fillRect(-7 + i * 4.5, -2, 2.4, 4);
    } else if (type === 'goblin'){
      ctx.fillStyle = col;
      ctx.fillRect(-4, -8, 8, 8);
      ctx.beginPath(); ctx.arc(0, -14, 5.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(-3, -3, 2, 3.6); ctx.fillRect(1, -3, 2, 3.6);
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(2.5, -13, 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(4, -16); ctx.lineTo(10, -20); ctx.stroke();
      ctx.fillStyle = '#9aa0a8';
      ctx.beginPath(); ctx.moveTo(10, -20); ctx.lineTo(4, -17); ctx.lineTo(8, -23); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(-5, -17); ctx.lineTo(-8, -20); ctx.lineTo(-4, -19); ctx.closePath(); ctx.fill();
      ctx.beginPath(); ctx.moveTo(5, -17); ctx.lineTo(8, -20); ctx.lineTo(4, -19); ctx.closePath(); ctx.fill();
    } else if (type === 'spider'){
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, -6, 5, 4, 0, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.ellipse(5, -7, 3.4, 2.8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#c0392b';
      ctx.beginPath(); ctx.arc(6.5, -8, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 1.1;
      for (let i = 0; i < 4; i++){
        const a = -0.9 + i * 0.5;
        ctx.beginPath(); ctx.moveTo(-3, -6); ctx.lineTo(-3 - Math.cos(a) * 7, -6 + Math.sin(a) * 7); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(2, -5); ctx.lineTo(2 + Math.cos(a) * 7, -5 + Math.sin(a) * 7); ctx.stroke();
      }
    } else if (type === 'skeleton' || type === 'orc'){
      ctx.fillStyle = col;
      ctx.fillRect(-4.5, -12, 9, 12);
      ctx.beginPath(); ctx.arc(0, -18, 5, 0, Math.PI * 2); ctx.fill();
      if (type === 'skeleton'){
        ctx.fillStyle = '#3a3a3a';
        ctx.fillRect(-2.5, -19, 1.4, 2); ctx.fillRect(1.1, -19, 1.4, 2);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)'; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(-3, -8); ctx.lineTo(3, -8); ctx.moveTo(-3, -6); ctx.lineTo(3, -6); ctx.stroke();
        ctx.strokeStyle = col; ctx.lineWidth = 1.6;
        ctx.beginPath(); ctx.moveTo(4, -12); ctx.lineTo(9, -15); ctx.lineTo(11, -10); ctx.stroke();
      } else {
        ctx.fillStyle = '#cfd3da';
        ctx.beginPath(); ctx.moveTo(-5, -16); ctx.lineTo(-8, -19); ctx.lineTo(-4, -18); ctx.closePath(); ctx.fill();
        ctx.beginPath(); ctx.moveTo(5, -16); ctx.lineTo(8, -19); ctx.lineTo(4, -18); ctx.closePath(); ctx.fill();
        ctx.fillStyle = dark;
        ctx.fillRect(-2.4, -12, 9, 3.4);
        ctx.strokeStyle = '#9fb0c0'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(4.5, -12); ctx.lineTo(10, -8); ctx.stroke();
        ctx.fillStyle = '#c8ccd2';
        ctx.beginPath(); ctx.moveTo(10, -8); ctx.lineTo(6, -10); ctx.lineTo(8, -14); ctx.closePath(); ctx.fill();
      }
    } else if (type === 'shadow'){
      ctx.globalAlpha = 0.82;
      const grd = ctx.createRadialGradient(0, -8, 2, 0, -8, 12);
      grd.addColorStop(0, '#4a3f66');
      grd.addColorStop(1, 'rgba(30,24,50,0)');
      ctx.fillStyle = grd;
      ctx.beginPath(); ctx.ellipse(0, -8, 11, 8, 0, 0, Math.PI * 2); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#ff5544';
      ctx.beginPath(); ctx.arc(-2, -9, 1.1, 0, Math.PI * 2); ctx.fill();
      ctx.beginPath(); ctx.arc(2, -9, 1.1, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'ogre' || type === 'troll'){
      ctx.fillStyle = col;
      ctx.fillRect(-6, -16, 12, 16);
      ctx.fillRect(-8, -15, 2, 14);
      ctx.fillRect(6, -15, 2, 14);
      ctx.beginPath(); ctx.arc(0, -22, 6.5, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = dark;
      ctx.fillRect(-3.4, -24, 1.8, 2.6); ctx.fillRect(1.6, -24, 1.8, 2.6);
      ctx.fillStyle = type === 'ogre' ? '#c8a878' : '#e8d8a0';
      ctx.beginPath(); ctx.arc(0, -20, 0.9, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = col; ctx.lineWidth = 2.6;
      ctx.beginPath(); ctx.moveTo(8, -14); ctx.lineTo(13, -18); ctx.stroke();
      ctx.fillStyle = '#6a5a4a';
      ctx.beginPath(); ctx.arc(15, -19, 3.4, 0, Math.PI * 2); ctx.fill();
    } else if (type === 'dragon'){
      const flap = Math.sin(time * 3 + bob) * 3;
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.ellipse(0, -10, 15, 8, -0.15, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#b0392f';
      ctx.beginPath(); ctx.moveTo(-8, -13); ctx.lineTo(-20, -16 + flap * 0.6); ctx.lineTo(-12, -5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#c64a3a';
      ctx.beginPath(); ctx.moveTo(-2, -14); ctx.lineTo(-13, -22 + flap); ctx.lineTo(-4, -6); ctx.closePath(); ctx.fill();
      ctx.fillStyle = col;
      ctx.beginPath(); ctx.moveTo(9, -13); ctx.quadraticCurveTo(14, -20, 12, -25); ctx.lineTo(16, -24); ctx.quadraticCurveTo(17, -17, 14, -11); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#e8e8c8';
      ctx.beginPath(); ctx.arc(13, -24, 1.6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = '#ff5544';
      ctx.beginPath(); ctx.arc(13.5, -24.5, 0.8, 0, Math.PI * 2); ctx.fill();
      ctx.strokeStyle = '#b0392f'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-14, -9); ctx.quadraticCurveTo(-22, -6, -24, 1); ctx.stroke();
      ctx.fillStyle = dark;
      for (let i = 0; i < 4; i++) ctx.fillRect(-10 + i * 5, -3, 3, 4);
      ctx.strokeStyle = '#6a1f1a'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(-6, -12); ctx.lineTo(-2, -6); ctx.stroke();
    }
  }

  drawLoot(l){
    const ctx = this.ctx, z = this.z;
    const sx = this.ox + isoX(l.x, l.y) * z;
    const sy = this.oy + isoY(l.x, l.y) * z;
    ctx.fillStyle = 'rgba(0,0,0,0.25)';
    ctx.beginPath(); ctx.ellipse(sx, sy, 5 * z, 2.4 * z, 0, 0, Math.PI * 2); ctx.fill();
    const item = ITEMS[l.key];
    const icon = l.key === 'goldbag' ? '💰' : (item ? item.icon : '•');
    ctx.font = `${Math.round(14 * z)}px serif`;
    ctx.textAlign = 'center';
    ctx.fillText(icon, sx, sy - 2 * z);
    if (l.key === 'goldbag' && l.amount){
      ctx.font = `bold ${Math.max(9, 11 * z)}px Galdeano, sans-serif`;
      ctx.fillStyle = '#f2d54a';
      ctx.fillText('+' + l.amount, sx, sy - 7 * z);
    }
  }

  drawFx(f){
    const ctx = this.ctx, z = this.z;
    const sx = this.ox + isoX(f.x, f.y) * z;
    const sy = this.oy + isoY(f.x, f.y) * z - f.t * 26 * z;
    const a = Math.min(1, f.ttl / 0.5);
    ctx.globalAlpha = a;
    ctx.font = `bold ${Math.max(10, 13 * z)}px Galdeano, sans-serif`;
    ctx.textAlign = 'center';
    ctx.lineWidth = 3;
    ctx.strokeStyle = 'rgba(0,0,0,0.7)';
    ctx.strokeText(f.text, sx, sy);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, sx, sy);
    ctx.globalAlpha = 1;
  }

  drawProjectile(pr){
    const ctx = this.ctx, z = this.z;
    const sx = this.ox + isoX(pr.x, pr.y) * z;
    const sy = this.oy + isoY(pr.x, pr.y) * z - 12 * z;
    const ex = this.ox + isoX(pr.px, pr.py) * z;
    const ey = this.oy + isoY(pr.px, pr.py) * z - 12 * z;
    ctx.strokeStyle = 'rgba(255,150,50,0.5)';
    ctx.lineWidth = 5 * z;
    ctx.beginPath(); ctx.moveTo(ex, ey); ctx.lineTo(sx, sy); ctx.stroke();
    ctx.fillStyle = '#ffb040';
    ctx.beginPath(); ctx.arc(sx, sy, 3.4 * z, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = '#fff0c0';
    ctx.beginPath(); ctx.arc(sx, sy, 1.6 * z, 0, Math.PI * 2); ctx.fill();
  }

  drawMini(g){
    if (!this.miniCtx) return;
    const mctx = this.miniCtx;
    const size = 132;
    mctx.clearRect(0, 0, size, size);
    const s = size / N;
    const mC = {
      0: '#3c5f2a', 1: '#355426', 2: '#8a6a44', 3: '#757b83', 4: '#1d4a63', 5: '#b8a05e',
      6: '#2c4a20', 7: '#5a564e', 8: '#7a8088', 9: '#8a6a44', 10: '#5c4632', 11: '#6a5e4a', 12: '#4a5560',
    };
    for (let y = 0; y < N; y++) for (let x = 0; x < N; x++){
      const t = g.grid[idx(x, y)];
      const col = mC[t] || '#333';
      mctx.fillStyle = col;
      mctx.fillRect(x * s, y * s, s + 0.4, s + 0.4);
    }
    mctx.fillStyle = '#ffd54a';
    mctx.fillRect(g.player.x * s - s * 0.5, g.player.y * s - s * 0.5, s * 2, s * 2);
    for (const r of g.remote){
      mctx.fillStyle = '#4aff6a';
      mctx.fillRect(r.x * s - s * 0.5, r.y * s - s * 0.5, s * 2, s * 2);
    }
    for (const m of g.monsters){
      const dx = m.x - g.player.x, dy = m.y - g.player.y;
      if (dx * dx + dy * dy > 260) continue;
      mctx.fillStyle = '#e04040';
      mctx.fillRect(m.x * s - s * 0.4, m.y * s - s * 0.4, s * 1.6, s * 1.6);
    }
  }
}

export function screenToTile(px, py, cam, canvasW, canvasH, zoom){
  const ox = canvasW / 2 - isoX(cam.x, cam.y) * zoom;
  const oy = canvasH / 2 - isoY(cam.x, cam.y) * zoom;
  const a = (px - ox) / zoom, b = (py - oy) / zoom;
  const u = 2 * a / TW, v = 2 * b / TH;
  const xf = (u + v) / 2, yf = (v - u) / 2;
  let best = null, bestD = Infinity;
  for (let i = Math.floor(xf) - 1; i <= Math.floor(xf) + 2; i++){
    for (let j = Math.floor(yf) - 1; j <= Math.floor(yf) + 2; j++){
      if (i < 0 || j < 0 || i >= N || j >= N) continue;
      const d = Math.abs(u - (i - j)) + Math.abs(v - (i + j));
      if (d <= 1 && d < bestD){
        bestD = d;
        best = { x: i, y: j };
      }
    }
  }
  return best;
}
