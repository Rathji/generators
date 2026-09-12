import { GRID, TOWERS, ENEMIES, PLANETS } from "./config.js";

const TAU = Math.PI * 2;
const rand = (a, b) => a + Math.random() * (b - a);

export const CANVAS_W = GRID.cols * GRID.cell;
export const CANVAS_H = GRID.rows * GRID.cell;

let terrainCache = null;
let terrainKey = "";

function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function drawDecor(ctx, d, cell, planet) {
  const cx = (d.c + 0.5) * cell, cy = (d.r + 0.5) * cell;
  const rng = mulberry(Math.floor(d.seed * 1e9));

  const sh = ctx.createRadialGradient(cx + 2, cy + 6, 1, cx + 2, cy + 6, cell * 0.62);
  sh.addColorStop(0, "rgba(0,0,0,0.36)");
  sh.addColorStop(0.6, "rgba(0,0,0,0.14)");
  sh.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sh;
  ctx.beginPath(); ctx.ellipse(cx + 2, cy + 6, cell * 0.62, cell * 0.38, 0, 0, TAU); ctx.fill();

  if (d.type === "rock") {
    ctx.save();
    ctx.translate(cx, cy);
    const s = cell * (0.24 + rng() * 0.24);
    ctx.fillStyle = "rgba(45,28,10,0.42)";
    ctx.beginPath(); ctx.ellipse(2, 5, s * 1.08, s * 0.62, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = planet.palette.decor;
    ctx.beginPath();
    const n = 6;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * TAU + rng() * 0.3;
      const rr = s * (0.7 + rng() * 0.5);
      const x = Math.cos(a) * rr, y = Math.sin(a) * rr * 0.8;
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    }
    ctx.closePath(); ctx.fill();
    ctx.fillStyle = "rgba(255,240,210,0.28)";
    ctx.beginPath(); ctx.ellipse(-s * 0.25, -s * 0.3, s * 0.4, s * 0.28, -0.4, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.18)";
    ctx.beginPath(); ctx.ellipse(s * 0.22, s * 0.34, s * 0.5, s * 0.3, 0.3, 0, TAU); ctx.fill();
    ctx.restore();
  } else if (d.type === "tree") {
    ctx.save();
    ctx.translate(cx, cy);
    const sc = 0.72 + rng() * 0.5;
    ctx.fillStyle = "rgba(0,0,0,0.42)";
    ctx.beginPath(); ctx.ellipse(6, 9, cell * 0.4 * sc, cell * 0.24 * sc, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = "#4a3520";
    ctx.beginPath(); ctx.ellipse(1, 3, cell * 0.09 * sc, cell * 0.06 * sc, 0, 0, TAU); ctx.fill();
    const layers = 3;
    for (let i = layers; i >= 0; i--) {
      const rr = cell * (0.34 - i * 0.05) * sc;
      ctx.fillStyle = i % 2 ? "#2e5a2f" : "#376b38";
      ctx.beginPath();
      ctx.arc(rng() * 4 - 2, -i * 5 + rng() * 4 - 2, rr, 0, TAU);
      ctx.fill();
    }
    ctx.fillStyle = "rgba(150,220,120,0.32)";
    ctx.beginPath(); ctx.arc(-cell * 0.1, -cell * 0.16, cell * 0.12 * sc, 0, TAU); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,0.26)";
    ctx.beginPath(); ctx.arc(cell * 0.16, cell * 0.14, cell * 0.26 * sc, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(60,110,50,0.75)"; ctx.lineWidth = 1;
    for (let i = 0; i < 6; i++) {
      const bx = -cell * 0.28 + rng() * cell * 0.56, by = cell * 0.18 + rng() * cell * 0.1;
      ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + (rng() - 0.5) * 4, by - 3 - rng() * 4); ctx.stroke();
    }
    ctx.restore();
  } else if (d.type === "ice") {
    ctx.save();
    ctx.translate(cx, cy);
    ctx.fillStyle = "rgba(80,125,165,0.34)";
    ctx.beginPath(); ctx.ellipse(3, 5, cell * 0.32, cell * 0.17, 0, 0, TAU); ctx.fill();
    const n = 3 + Math.floor(rng() * 2);
    for (let i = 0; i < n; i++) {
      const a = rng() * TAU, h = cell * (0.22 + rng() * 0.22);
      ctx.save(); ctx.rotate(a);
      ctx.fillStyle = "rgba(200,232,250,0.95)";
      ctx.beginPath();
      ctx.moveTo(0, -h); ctx.lineTo(h * 0.42, h * 0.4); ctx.lineTo(-h * 0.42, h * 0.4);
      ctx.closePath(); ctx.fill();
      ctx.strokeStyle = "rgba(120,180,220,0.85)"; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = "rgba(255,255,255,0.7)";
      ctx.beginPath(); ctx.moveTo(0, -h); ctx.lineTo(h * 0.15, h * 0.32); ctx.lineTo(0, h * 0.06);
      ctx.closePath(); ctx.fill();
      ctx.restore();
    }
    ctx.restore();
  } else if (d.type === "panel") {
    ctx.save();
    ctx.translate(cx, cy);
    const s = cell * 0.72;
    ctx.fillStyle = "rgba(0,0,0,0.45)";
    roundRect(ctx, -s / 2 + 2, -s / 2 + 4, s, s, 4); ctx.fill();
    const pg = ctx.createLinearGradient(0, -s / 2, 0, s / 2);
    pg.addColorStop(0, "#3b424d"); pg.addColorStop(1, "#262b33");
    ctx.fillStyle = pg;
    roundRect(ctx, -s / 2, -s / 2, s, s, 4); ctx.fill();
    ctx.strokeStyle = "rgba(190,210,235,0.3)"; ctx.lineWidth = 1.4; ctx.stroke();
    ctx.strokeStyle = "rgba(0,0,0,0.4)"; ctx.lineWidth = 1;
    roundRect(ctx, -s / 2 + 2.5, -s / 2 + 2.5, s - 5, s - 5, 3); ctx.stroke();
    ctx.fillStyle = "rgba(190,210,235,0.2)";
    for (let i = 0; i < 4; i++) { const a = (i / 4) * TAU; ctx.beginPath(); ctx.arc(Math.cos(a) * s * 0.34, Math.sin(a) * s * 0.34, 2, 0, TAU); ctx.fill(); }
    if (rng() > 0.45) {
      ctx.fillStyle = rng() > 0.5 ? "rgba(90,200,255,0.6)" : "rgba(255,90,70,0.6)";
      ctx.fillRect(-s * 0.2, -s * 0.08, s * 0.4, s * 0.16);
    }
    ctx.restore();
  }
}

function parseHex(h) {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(h);
  return m ? { r: parseInt(m[1], 16), g: parseInt(m[2], 16), b: parseInt(m[3], 16) } : { r: 200, g: 170, b: 110 };
}
function tint(c, t) {
  const f = t >= 0 ? (v) => v + (255 - v) * t : (v) => v * (1 + t);
  return { r: Math.round(f(c.r)), g: Math.round(f(c.g)), b: Math.round(f(c.b)) };
}
function rgba(c, a) { return "rgba(" + c.r + "," + c.g + "," + c.b + "," + a + ")"; }
function softBlob(ctx, x, y, r, c, a) {
  const g = ctx.createRadialGradient(x, y, 0, x, y, r);
  g.addColorStop(0, rgba(c, a));
  g.addColorStop(1, rgba(c, 0));
  ctx.fillStyle = g;
  ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
}
function terrainPath(ctx, pts) {
  ctx.beginPath();
  ctx.moveTo(pts[0].x, pts[0].y);
  for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
}

function makeTerrain(game) {
  const { cell, cols, rows } = GRID;
  const P = game.planet.palette;
  const cv = document.createElement("canvas");
  cv.width = CANVAS_W; cv.height = CANVAS_H;
  const ctx = cv.getContext("2d");
  const W = CANVAS_W, H = CANVAS_H;
  const rng = mulberry(game.planetIndex * 7331 + 17);
  const base = parseHex(P.bg);
  const lighter = parseHex(P.tileA);
  const darker = parseHex(P.pathEdge);
  const style = game.planet.decor;

  const g = ctx.createLinearGradient(0, 0, 0, H);
  g.addColorStop(0, P.bg2); g.addColorStop(1, P.bg);
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

  for (let i = 0; i < 90; i++) {
    const c = rng() > 0.5 ? tint(base, 0.10 + rng() * 0.12) : tint(base, -(0.08 + rng() * 0.12));
    softBlob(ctx, rng() * W, rng() * H, 50 + rng() * 140, c, 0.06 + rng() * 0.10);
  }
  for (let i = 0; i < 260; i++) {
    const c = rng() > 0.5 ? tint(lighter, 0.05) : tint(darker, 0.0);
    softBlob(ctx, rng() * W, rng() * H, 12 + rng() * 46, c, 0.05 + rng() * 0.09);
  }

  for (let i = 0; i < 9000; i++) {
    const c = rng() > 0.5 ? tint(base, 0.22) : tint(base, -0.28);
    ctx.fillStyle = rgba(c, 0.05 + rng() * 0.12);
    ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 1.6, 1 + rng() * 1.6);
  }

  ctx.lineCap = "round";
  if (style === "rock") {
    for (let i = 0; i < 150; i++) {
      const x0 = rng() * W, y0 = rng() * H, len = 20 + rng() * 70, bow = (rng() - 0.5) * 18;
      ctx.strokeStyle = rng() > 0.5 ? rgba(tint(base, 0.18), 0.10 + rng() * 0.10) : rgba(tint(base, -0.22), 0.08 + rng() * 0.10);
      ctx.lineWidth = 1 + rng() * 2;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + len * 0.5, y0 + bow, x0 + len, y0 + bow * 0.3);
      ctx.stroke();
    }
    for (let i = 0; i < 260; i++) {
      const s = 0.6 + rng() * 1.8;
      ctx.fillStyle = rgba(tint(darker, -0.1), 0.18 + rng() * 0.25);
      ctx.fillRect(rng() * W, rng() * H, s, s);
    }
  } else if (style === "ice") {
    for (let i = 0; i < 26; i++) softBlob(ctx, rng() * W, rng() * H, 60 + rng() * 150, { r: 255, g: 255, b: 255 }, 0.05 + rng() * 0.07);
    for (let i = 0; i < 700; i++) {
      ctx.fillStyle = "rgba(150,190,220," + (0.05 + rng() * 0.10) + ")";
      ctx.fillRect(rng() * W, rng() * H, 1 + rng() * 1.6, 1 + rng() * 1.6);
    }
    for (let i = 0; i < 90; i++) {
      const x0 = rng() * W, y0 = rng() * H, len = 40 + rng() * 150;
      ctx.strokeStyle = "rgba(255,255,255," + (0.06 + rng() * 0.10) + ")";
      ctx.lineWidth = 1.2 + rng() * 2.6;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.quadraticCurveTo(x0 + len * 0.5, y0 + 4, x0 + len, y0 - len * (0.05 + rng() * 0.12));
      ctx.stroke();
    }
    for (let i = 0; i < 26; i++) {
      const x0 = rng() * W, y0 = rng() * H, len = 16 + rng() * 46;
      ctx.strokeStyle = "rgba(120,165,205," + (0.08 + rng() * 0.12) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x0, y0);
      ctx.lineTo(x0 + len, y0 + (rng() - 0.5) * len * 0.4);
      ctx.lineTo(x0 + len * 1.6, y0 + (rng() - 0.5) * len * 0.6);
      ctx.stroke();
    }
  } else if (style === "tree") {
    for (let i = 0; i < 1600; i++) {
      const x = rng() * W, y = rng() * H, h = 2 + rng() * 6, t = rng();
      ctx.strokeStyle = t > 0.6 ? "rgba(120,180,90," + (0.10 + rng() * 0.18) + ")"
        : t > 0.3 ? "rgba(40,90,40," + (0.12 + rng() * 0.2) + ")"
        : "rgba(70,120,55," + (0.12 + rng() * 0.2) + ")";
      ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + (rng() - 0.5) * 3, y - h); ctx.stroke();
    }
    for (let i = 0; i < 70; i++) softBlob(ctx, rng() * W, rng() * H, 14 + rng() * 40, { r: 60, g: 100, b: 55 }, 0.05 + rng() * 0.08);
    for (let i = 0; i < 110; i++) {
      const x = rng() * W, y = rng() * H, s = 1.5 + rng() * 3.4;
      ctx.fillStyle = "rgba(35,55,32,0.5)";
      ctx.beginPath(); ctx.ellipse(x, y, s, s * 0.7, rng() * TAU, 0, TAU); ctx.fill();
      ctx.fillStyle = "rgba(130,160,105,0.3)";
      ctx.beginPath(); ctx.ellipse(x - s * 0.3, y - s * 0.3, s * 0.5, s * 0.34, 0, 0, TAU); ctx.fill();
    }
    for (let i = 0; i < 34; i++) {
      const x = rng() * W, y = rng() * H, a = rng() * TAU, len = 18 + rng() * 34;
      ctx.save(); ctx.translate(x, y); ctx.rotate(a);
      ctx.fillStyle = "rgba(46,34,19,0.72)";
      roundRect(ctx, -len / 2, -3, len, 6, 3); ctx.fill();
      ctx.fillStyle = "rgba(96,74,46,0.5)";
      roundRect(ctx, -len / 2, -3, len, 2.5, 1.5); ctx.fill();
      ctx.restore();
    }
  } else if (style === "panel") {
    const bw = cell * 4;
    for (let by = 0; by < H; by += bw) {
      for (let bx = 0; bx < W; bx += bw) {
        const pg = ctx.createLinearGradient(bx, by, bx + bw, by + bw);
        pg.addColorStop(0, "rgba(255,255,255," + (0.02 + rng() * 0.05) + ")");
        pg.addColorStop(1, "rgba(0,0,0," + (0.05 + rng() * 0.05) + ")");
        ctx.fillStyle = pg; ctx.fillRect(bx + 1, by + 1, bw - 2, bw - 2);
        ctx.strokeStyle = "rgba(180,200,230,0.10)"; ctx.lineWidth = 1;
        ctx.strokeRect(bx + 1.5, by + 1.5, bw - 3, bw - 3);
        ctx.strokeStyle = "rgba(0,0,0,0.16)";
        ctx.beginPath(); ctx.moveTo(bx, by); ctx.lineTo(bx + bw, by); ctx.moveTo(bx, by); ctx.lineTo(bx, by + bw); ctx.stroke();
        ctx.strokeStyle = "rgba(255,255,255,0.10)"; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(bx + 2, by + bw - 2); ctx.lineTo(bx + 2, by + 2); ctx.lineTo(bx + bw - 2, by + 2); ctx.stroke();
        ctx.strokeStyle = "rgba(0,0,0,0.22)";
        ctx.beginPath(); ctx.moveTo(bx + bw - 2, by + 2); ctx.lineTo(bx + bw - 2, by + bw - 2); ctx.lineTo(bx + 2, by + bw - 2); ctx.stroke();
        for (let i = 0; i < 4; i++) {
          const rx = bx + 10 + rng() * (bw - 20), ry = by + 10 + rng() * (bw - 20);
          ctx.fillStyle = "rgba(15,18,22,0.55)";
          ctx.beginPath(); ctx.arc(rx + 0.8, ry + 0.8, 2.6, 0, TAU); ctx.fill();
          ctx.fillStyle = "rgba(200,220,245,0.5)";
          ctx.beginPath(); ctx.arc(rx, ry, 2.1, 0, TAU); ctx.fill();
        }
      }
    }
  }

  ctx.save();
  ctx.globalAlpha = 0.8;
  ctx.setLineDash([2, 5]);
  ctx.strokeStyle = P.grid; ctx.lineWidth = 1;
  for (let c = 0; c <= cols; c++) { ctx.beginPath(); ctx.moveTo(c * cell, 0); ctx.lineTo(c * cell, H); ctx.stroke(); }
  for (let r = 0; r <= rows; r++) { ctx.beginPath(); ctx.moveTo(0, r * cell); ctx.lineTo(W, r * cell); ctx.stroke(); }
  ctx.restore();

  game.map.decor.forEach((d) => drawDecor(ctx, d, cell, game.planet));

  const pts = game.map.pts;
  ctx.lineJoin = "round"; ctx.lineCap = "round";
  ctx.save();
  ctx.globalAlpha = 0.4; ctx.strokeStyle = "#000"; ctx.lineWidth = cell * 1.02;
  ctx.translate(2, 4); terrainPath(ctx, pts); ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = P.pathEdge; ctx.lineWidth = cell * 0.9; terrainPath(ctx, pts); ctx.stroke();
  ctx.strokeStyle = P.path; ctx.lineWidth = cell * 0.78; terrainPath(ctx, pts); ctx.stroke();
  ctx.save();
  ctx.globalAlpha = 0.16; ctx.strokeStyle = "#ffffff"; ctx.lineWidth = cell * 0.4;
  terrainPath(ctx, pts); ctx.stroke();
  ctx.restore();

  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
    const nx = -dy / len, ny = dx / len;
    const steps = Math.max(2, Math.round(len / 9));
    for (let s = 0; s <= steps; s++) {
      const tt = s / steps, px = a.x + dx * tt, py = a.y + dy * tt;
      for (const side of [-1, 1]) {
        const off = (0.38 + rng() * 0.18) * cell;
        const c = rng() > 0.5 ? tint(base, 0.06) : tint(base, -0.06);
        softBlob(ctx, px + nx * off * side + (rng() - 0.5) * 5, py + ny * off * side + (rng() - 0.5) * 5, 4 + rng() * 6, c, 0.20 + rng() * 0.30);
      }
    }
  }

  ctx.save();
  ctx.globalAlpha = 0.5;
  for (const side of [-1, 1]) {
    ctx.strokeStyle = P.pathEdge; ctx.lineWidth = cell * 0.1; ctx.lineCap = "round";
    ctx.beginPath();
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1];
      const dx = b.x - a.x, dy = b.y - a.y, len = Math.hypot(dx, dy);
      const nx = -dy / len, ny = dx / len;
      const ox = nx * cell * 0.17 * side, oy = ny * cell * 0.17 * side;
      if (i === 0) ctx.moveTo(a.x + ox, a.y + oy); else ctx.lineTo(a.x + ox, a.y + oy);
      ctx.lineTo(b.x + ox, b.y + oy);
    }
    ctx.stroke();
  }
  ctx.restore();
  for (let i = 0; i < 220; i++) {
    const seg = Math.floor(rng() * (pts.length - 1));
    const a = pts[seg], b = pts[seg + 1];
    const tt = rng(), x = a.x + (b.x - a.x) * tt, y = a.y + (b.y - a.y) * tt;
    ctx.fillStyle = rng() > 0.5 ? "rgba(255,240,210,0.10)" : "rgba(40,26,10,0.14)";
    const s = 0.8 + rng() * 2;
    ctx.fillRect(x + (rng() - 0.5) * cell * 0.5, y + (rng() - 0.5) * cell * 0.5, s, s);
  }

  ctx.save();
  ctx.setLineDash([10, 12]);
  ctx.strokeStyle = style === "panel" ? "rgba(120,200,255,0.20)" : "rgba(255,255,255,0.12)";
  ctx.lineWidth = 3;
  terrainPath(ctx, pts); ctx.stroke();
  ctx.restore();


  const vg = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.72);
  vg.addColorStop(0, "rgba(0,0,0,0)");
  vg.addColorStop(1, "rgba(0,0,0,0.22)");
  ctx.fillStyle = vg; ctx.fillRect(0, 0, W, H);

  const sp = game.map.spawn;
  drawGate(ctx, sp.x, sp.y, P, true);
  const ex = game.map.exit;
  drawGate(ctx, ex.x, ex.y, P, false);

  return cv;
}

function drawGate(ctx, x, y, P, isSpawn) {
  ctx.save();
  ctx.translate(x, y);
  const col = isSpawn ? "#ff5a6e" : "#5ad1ff";
  const grd = ctx.createRadialGradient(0, 0, 4, 0, 0, 42);
  grd.addColorStop(0, isSpawn ? "rgba(255,90,110,0.5)" : "rgba(90,209,255,0.45)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grd;
  ctx.beginPath(); ctx.arc(0, 0, 42, 0, TAU); ctx.fill();
  ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.globalAlpha = 0.85;
  ctx.beginPath(); ctx.arc(0, 0, 22, 0, TAU); ctx.stroke();
  ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.stroke();
  ctx.globalAlpha = 0.9;
  ctx.fillStyle = col;
  ctx.beginPath();
  const dir = isSpawn ? 1 : -1;
  ctx.moveTo(0, -8); ctx.lineTo(dir * 9, 0); ctx.lineTo(0, 8);
  ctx.closePath(); ctx.fill();
  ctx.restore();
}

export function invalidateTerrain() { terrainCache = null; terrainKey = ""; }

export function getTerrain(game) {
  const key = game.planet.id;
  if (terrainCache && terrainKey === key) return terrainCache;
  terrainCache = makeTerrain(game);
  terrainKey = key;
  return terrainCache;
}

export function drawTower(ctx, t, def, stats, game, selected) {
  const isDisabled = t.disabledUntil > game.time;
  const lvl = t.level || 0;
  ctx.save();
  ctx.translate(t.x, t.y);
  ctx.fillStyle = "rgba(0,0,0,0.34)";
  ctx.beginPath(); ctx.ellipse(2, 5, 17, 12, 0, 0, TAU); ctx.fill();

  ctx.save();
  ctx.rotate(Math.PI / 4);
  ctx.fillStyle = "#0d131c";
  ctx.strokeStyle = isDisabled ? "rgba(255,90,100,0.6)" : "rgba(150,195,255,0.35)";
  ctx.lineWidth = 2;
  roundRect(ctx, -14, -14, 28, 28, 6); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "rgba(150,195,255,0.06)";
  roundRect(ctx, -10, -10, 20, 20, 4); ctx.fill();
  ctx.restore();

  ctx.save();
  ctx.globalAlpha = 0.32 + lvl * 0.06;
  ctx.fillStyle = def.glow;
  ctx.beginPath(); ctx.arc(0, 0, 12, 0, TAU); ctx.fill();
  ctx.restore();

  ctx.strokeStyle = "rgba(10,14,20,0.9)"; ctx.lineWidth = 2.4; ctx.lineJoin = "round";
  ctx.fillStyle = isDisabled ? "#3d434d" : def.color;
  ctx.beginPath(); ctx.arc(0, 0, 8.5, 0, TAU); ctx.fill(); ctx.stroke();

  ctx.save();
  ctx.rotate(t.angle);
  ctx.translate(-(t.recoil || 0) * 3.4, 0);
  ctx.strokeStyle = "rgba(10,14,20,0.9)"; ctx.lineWidth = 2.6; ctx.lineCap = "round";
  ctx.fillStyle = isDisabled ? "#4a4f58" : "#232c3a";
  roundRect(ctx, -11, -7.5, 22, 15, 5); ctx.fill(); ctx.stroke();
  ctx.fillStyle = isDisabled ? "#6a6a72" : def.color;
  roundRect(ctx, 3, -3.4, 19, 6.8, 3); ctx.fill(); ctx.stroke();
  ctx.fillStyle = "#0a0e14";
  roundRect(ctx, 18, -2.4, 5, 4.8, 2); ctx.fill();
  ctx.fillStyle = isDisabled ? "#5a5f68" : "#eaf4ff";
  ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, TAU); ctx.fill();
  ctx.strokeStyle = def.glow; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(0, 0, 6.8, 0, TAU); ctx.stroke();
  ctx.restore();

  for (let i = 0; i < 4; i++) {
    const on = i <= lvl;
    ctx.fillStyle = on ? def.glow : "rgba(255,255,255,0.14)";
    ctx.strokeStyle = "rgba(0,0,0,0.5)"; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.arc(-9 + i * 6, 16, 2.4, 0, TAU); ctx.fill(); ctx.stroke();
  }

  if (isDisabled) {
    ctx.strokeStyle = "rgba(255,80,90,0.95)"; ctx.lineWidth = 2.4;
    ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.stroke();
    ctx.fillStyle = "rgba(255,80,90,0.9)"; ctx.font = "bold 13px sans-serif";
    ctx.textAlign = "center"; ctx.textBaseline = "middle";
    ctx.fillText("!", 0, -22);
  } else if (selected) {
    ctx.strokeStyle = def.glow; ctx.lineWidth = 2.6; ctx.globalAlpha = 0.95;
    ctx.beginPath(); ctx.arc(0, 0, 19, 0, TAU); ctx.stroke();
    ctx.globalAlpha = 1;
  }
  ctx.restore();
}
function drawHero(ctx, h, game) {
  ctx.save();
  ctx.translate(h.x, h.y);
  ctx.fillStyle = "rgba(0,0,0,0.3)";
  ctx.beginPath(); ctx.ellipse(2, 4, 13, 9, 0, 0, TAU); ctx.fill();
  ctx.save();
  ctx.rotate(h.angle);
  ctx.fillStyle = "#3a2a22";
  roundRect(ctx, -9, -9, 18, 18, 7); ctx.fill();
  ctx.strokeStyle = "#9a7a5a"; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = "#57e08a"; ctx.lineWidth = 3; ctx.lineCap = "round";
  ctx.beginPath(); ctx.moveTo(6, 4); ctx.lineTo(20, -6); ctx.stroke();
  ctx.restore();
  ctx.fillStyle = "#1c2430";
  ctx.beginPath(); ctx.arc(0, 0, 6, 0, TAU); ctx.fill();
  ctx.fillStyle = "#57e08a";
  ctx.beginPath(); ctx.arc(0, 0, 3.2, 0, TAU); ctx.fill();
  const hpR = Math.max(0, h.hp / h.maxHp);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, -16, -24, 32, 4, 2); ctx.fill();
  ctx.fillStyle = hpR > 0.5 ? "#57e08a" : hpR > 0.25 ? "#f5c542" : "#ff5a6e";
  roundRect(ctx, -16, -24, 32 * hpR, 4, 2); ctx.fill();
  ctx.restore();
}

function shade(ctx, e) {
  ctx.save();
  ctx.translate(e.x, e.y);
  ctx.fillStyle = "rgba(0,0,0,0.28)";
  const off = e.flying ? 12 : 4;
  ctx.beginPath(); ctx.ellipse(2, off, e.radius * 0.95, e.radius * 0.55, 0, 0, TAU); ctx.fill();
  ctx.restore();
}

export function body(ctx, e, r, t) {
  const d = e.def;
  const flash = e.hitFlash > 0.4;
  const main = flash ? "#ffffff" : d.body;
  const acc = d.accent;
  const line = (w) => { ctx.strokeStyle = "rgba(6,9,16,0.9)"; ctx.lineWidth = w == null ? 2 : w; ctx.stroke(); };
  ctx.lineJoin = "round"; ctx.lineCap = "round";

  if (d.shape === "trooper" || d.shape === "scout") {
    const small = d.shape === "scout";
    ctx.fillStyle = "#c8d0da"; roundRect(ctx, -r * 0.1, -r * 1.04, r * 0.72, r * 0.42, 3); ctx.fill(); line(1.5);
    roundRect(ctx, -r * 0.1, r * 0.62, r * 0.72, r * 0.42, 3); ctx.fill(); line(1.5);
    ctx.fillStyle = "#aeb8c4"; roundRect(ctx, -r * 1.0, -r * 0.52, r * 0.52, r * 1.04, 3); ctx.fill(); line(1.5);
    ctx.fillStyle = main; roundRect(ctx, -r * 0.6, -r * 0.8, r * 1.2, r * 1.6, r * 0.36); ctx.fill(); line(2.2);
    ctx.strokeStyle = "rgba(20,26,34,0.45)"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.moveTo(-r * 0.42, 0); ctx.lineTo(r * 0.25, 0); ctx.stroke();
    ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(r * 0.32, 0, r * 0.62, r * 0.7, 0, 0, TAU); ctx.fill(); line(2.2);
    ctx.fillStyle = small ? "#2b3340" : "#c8d0da"; roundRect(ctx, r * 0.02, -r * 1.08, r * 0.52, r * 0.32, 2); ctx.fill(); line(1.2);
    ctx.fillStyle = "#0b0f16"; roundRect(ctx, r * 0.34, -r * 0.5, r * 0.4, r * 1.0, 2); ctx.fill();
    if (small) {
      ctx.fillStyle = "#e0873a"; roundRect(ctx, -r * 0.16, -r * 0.76, r * 0.5, r * 0.44, 3); ctx.fill(); line(1.4);
      ctx.strokeStyle = "#cfd8e2"; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.moveTo(r * 0.12, -r * 0.9); ctx.lineTo(-r * 0.2, -r * 1.45); ctx.stroke();
      ctx.fillStyle = "#e0873a"; ctx.beginPath(); ctx.arc(-r * 0.2, -r * 1.45, r * 0.1, 0, TAU); ctx.fill();
    } else {
      ctx.fillStyle = "#0b0f16"; roundRect(ctx, r * 0.18, -r * 0.32, r * 0.44, r * 0.13, 1); ctx.fill();
      roundRect(ctx, r * 0.18, r * 0.16, r * 0.44, r * 0.13, 1); ctx.fill();
    }
  } else if (d.shape === "droid") {
    ctx.lineCap = "round";
    ctx.strokeStyle = "#3a3f46"; ctx.lineWidth = r * 0.18; ctx.beginPath(); ctx.moveTo(r * 0.12, -r * 0.3); ctx.lineTo(r * 0.85, -r * 0.9); ctx.stroke();
    ctx.fillStyle = "#4a4f57"; roundRect(ctx, r * 0.5, -r * 1.02, r * 0.72, r * 0.2, 1); ctx.fill(); line(1.2);
    ctx.strokeStyle = "#7a5f3a"; ctx.lineWidth = r * 0.22;
    ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.16); ctx.lineTo(-r * 0.98, -r * 0.62); ctx.moveTo(-r * 0.5, r * 0.16); ctx.lineTo(-r * 0.98, r * 0.62); ctx.stroke();
    ctx.strokeStyle = "#8a6a41"; ctx.lineWidth = r * 0.18;
    ctx.beginPath(); ctx.moveTo(-r * 0.1, -r * 0.26); ctx.lineTo(-r * 0.75, -r * 0.78); ctx.moveTo(-r * 0.1, r * 0.26); ctx.lineTo(-r * 0.75, r * 0.78); ctx.stroke();
    ctx.fillStyle = main; roundRect(ctx, -r * 0.62, -r * 0.34, r * 1.05, r * 0.68, 3); ctx.fill(); line(2);
    ctx.fillStyle = "#8a6a41"; roundRect(ctx, r * 0.0, -r * 0.22, r * 0.5, r * 0.44, 2); ctx.fill(); line(1.4);
    ctx.fillStyle = main; roundRect(ctx, r * 0.42, -r * 0.14, r * 0.36, r * 0.28, 2); ctx.fill(); line(1.4);
    ctx.fillStyle = main; ctx.beginPath(); ctx.ellipse(r * 1.02, 0, r * 0.5, r * 0.24, 0, 0, TAU); ctx.fill(); line(1.8);
    ctx.fillStyle = "#0b0f16"; ctx.beginPath(); ctx.arc(r * 1.05, -r * 0.1, r * 0.09, 0, TAU); ctx.fill(); ctx.beginPath(); ctx.arc(r * 1.05, r * 0.1, r * 0.09, 0, TAU); ctx.fill();
  } else if (d.shape === "superdroid") {
    ctx.strokeStyle = "#6f7885"; ctx.lineWidth = r * 0.3;
    ctx.beginPath(); ctx.moveTo(-r * 0.45, -r * 0.2); ctx.lineTo(-r * 0.95, -r * 0.85); ctx.moveTo(-r * 0.45, r * 0.2); ctx.lineTo(-r * 0.95, r * 0.85); ctx.stroke();
    ctx.fillStyle = main; roundRect(ctx, -r * 0.78, -r * 0.72, r * 1.55, r * 1.44, 5); ctx.fill(); line(2.2);
    ctx.fillStyle = "#39424d"; roundRect(ctx, r * 0.05, -r * 1.0, r * 0.8, r * 0.36, 2); ctx.fill(); line(1.5);
    roundRect(ctx, r * 0.05, r * 0.64, r * 0.8, r * 0.36, 2); ctx.fill(); line(1.5);
    ctx.fillStyle = "#4a525c"; ctx.beginPath(); ctx.arc(r * 0.12, 0, r * 0.42, 0, TAU); ctx.fill(); line(1.6);
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(r * 0.24, 0, r * 0.2, 0, TAU); ctx.fill();
  } else if (d.shape === "droideka") {
    ctx.strokeStyle = "#7a5f3a"; ctx.lineWidth = r * 0.3;
    for (let i = 0; i < 3; i++) { const a = -0.7 + i * 0.7; ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(Math.cos(a) * r * 1.25, Math.sin(a) * r * 1.25); ctx.stroke(); }
    ctx.fillStyle = main; ctx.beginPath(); ctx.arc(0, 0, r * 0.88, 0, TAU); ctx.fill(); line(2.2);
    ctx.fillStyle = "#8a6a41"; ctx.beginPath(); ctx.arc(0, 0, r * 0.52, 0, TAU); ctx.fill(); line(1.6);
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(0, 0, r * 0.24, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(130,200,255,0.55)"; ctx.lineWidth = 1.6; ctx.beginPath(); ctx.arc(0, 0, r * 1.05, 0, TAU); ctx.stroke();
  } else if (d.shape === "atst") {
    ctx.strokeStyle = "#8b95a1"; ctx.lineWidth = r * 0.32;
    ctx.beginPath(); ctx.moveTo(-r * 0.1, -r * 0.2); ctx.lineTo(-r * 0.55, -r * 1.05); ctx.moveTo(-r * 0.1, r * 0.2); ctx.lineTo(-r * 0.55, r * 1.05); ctx.stroke();
    ctx.fillStyle = main; roundRect(ctx, -r * 0.75, -r * 0.78, r * 1.45, r * 1.56, 5); ctx.fill(); line(2.2);
    ctx.fillStyle = "#39424d"; roundRect(ctx, r * 0.1, -r * 0.6, r * 0.8, r * 1.2, 3); ctx.fill(); line(1.8);
    ctx.fillStyle = "#111820"; roundRect(ctx, r * 0.28, -r * 0.44, r * 0.5, r * 0.88, 2); ctx.fill();
    ctx.fillStyle = "#c9d3df"; roundRect(ctx, r * 0.85, -r * 0.32, r * 1.05, r * 0.16, 1); ctx.fill(); line(1);
    roundRect(ctx, r * 0.85, r * 0.16, r * 1.05, r * 0.16, 1); ctx.fill(); line(1);
  } else if (d.shape === "atat") {
    ctx.lineCap = "round";
    for (const sx of [-r * 0.72, r * 0.28]) {
      for (const sy of [-1, 1]) {
        ctx.strokeStyle = "rgba(6,9,16,0.9)"; ctx.lineWidth = r * 0.4; ctx.beginPath(); ctx.moveTo(sx, sy * r * 0.34); ctx.lineTo(sx - r * 0.32, sy * r * 1.16); ctx.stroke();
        ctx.strokeStyle = "#b3bdc8"; ctx.lineWidth = r * 0.26; ctx.beginPath(); ctx.moveTo(sx, sy * r * 0.34); ctx.lineTo(sx - r * 0.32, sy * r * 1.16); ctx.stroke();
        ctx.fillStyle = "#8b96a2"; ctx.beginPath(); ctx.arc(sx - r * 0.32, sy * r * 1.16, r * 0.19, 0, TAU); ctx.fill(); line(1.4);
      }
    }
    ctx.fillStyle = main; roundRect(ctx, -r * 1.05, -r * 0.5, r * 1.7, r * 1.0, 8); ctx.fill(); line(2.6);
    ctx.fillStyle = "rgba(255,255,255,0.32)"; roundRect(ctx, -r * 0.94, -r * 0.4, r * 1.45, r * 0.16, 4); ctx.fill();
    ctx.strokeStyle = "rgba(20,26,34,0.5)"; ctx.lineWidth = 1.8;
    ctx.beginPath(); ctx.moveTo(-r * 0.7, -r * 0.34); ctx.lineTo(r * 0.5, -r * 0.34); ctx.moveTo(-r * 0.7, r * 0.34); ctx.lineTo(r * 0.5, r * 0.34); ctx.stroke();
    ctx.fillStyle = main; roundRect(ctx, r * 0.55, -r * 0.24, r * 0.5, r * 0.48, 5); ctx.fill(); line(2);
    ctx.fillStyle = main; roundRect(ctx, r * 0.92, -r * 0.44, r * 0.62, r * 0.88, 6); ctx.fill(); line(2.4);
    ctx.fillStyle = "#111820"; roundRect(ctx, r * 1.02, -r * 0.3, r * 0.42, r * 0.6, 2); ctx.fill();
    ctx.fillStyle = "#c9d3df"; roundRect(ctx, r * 1.4, -r * 0.28, r * 0.7, r * 0.15, 1); ctx.fill(); line(1);
    roundRect(ctx, r * 1.4, r * 0.13, r * 0.7, r * 0.15, 1); ctx.fill(); line(1);
    ctx.fillStyle = "rgba(255,70,80,0.85)"; roundRect(ctx, -r * 0.98, -r * 0.44, r * 0.26, r * 0.24, 2); ctx.fill(); roundRect(ctx, -r * 0.98, r * 0.2, r * 0.26, r * 0.24, 2); ctx.fill();
  } else if (d.shape === "tie" || d.shape === "interceptor") {
    const inter = d.shape === "interceptor";
    for (const s of [-1, 1]) {
      ctx.save(); ctx.translate(0, s * r * 0.92);
      ctx.fillStyle = "#63748a"; ctx.beginPath();
      if (!inter) {
        ctx.moveTo(-r * 0.85, 0); ctx.lineTo(-r * 0.42, -r * 0.52); ctx.lineTo(r * 0.42, -r * 0.52); ctx.lineTo(r * 0.85, 0); ctx.lineTo(r * 0.42, r * 0.52); ctx.lineTo(-r * 0.42, r * 0.52);
      } else {
        ctx.moveTo(-r * 0.92, 0); ctx.lineTo(-r * 0.15, -r * 0.62); ctx.lineTo(r * 0.7, -r * 0.5); ctx.lineTo(r * 0.7, r * 0.5); ctx.lineTo(-r * 0.15, r * 0.62);
      }
      ctx.closePath(); ctx.fill(); line(2.4);
      ctx.strokeStyle = "rgba(150,205,255,0.75)"; ctx.lineWidth = 1.4;
      ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.2); ctx.lineTo(r * 0.5, -r * 0.2); ctx.moveTo(-r * 0.5, r * 0.2); ctx.lineTo(r * 0.5, r * 0.2); ctx.stroke();
      if (inter) { ctx.beginPath(); ctx.moveTo(-r * 0.2, -r * 0.5); ctx.lineTo(-r * 0.2, r * 0.5); ctx.stroke(); }
      ctx.restore();
    }
    ctx.strokeStyle = "#2a333f"; ctx.lineWidth = r * 0.2; ctx.beginPath(); ctx.moveTo(0, -r * 0.9); ctx.lineTo(0, r * 0.9); ctx.stroke();
    ctx.fillStyle = main; ctx.beginPath(); ctx.arc(0, 0, r * 0.54, 0, TAU); ctx.fill(); line(2.4);
    ctx.fillStyle = "#0b0f16"; ctx.beginPath(); ctx.arc(r * 0.08, 0, r * 0.34, 0, TAU); ctx.fill();
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(r * 0.28, 0, r * 0.16, 0, TAU); ctx.fill();
  } else if (d.shape === "sith") {
    ctx.fillStyle = main; ctx.beginPath();
    ctx.moveTo(r * 1.05, 0);
    ctx.quadraticCurveTo(r * 0.5, -r * 0.98, -r * 0.92, -r * 0.56);
    ctx.quadraticCurveTo(-r * 1.18, 0, -r * 0.92, r * 0.56);
    ctx.quadraticCurveTo(r * 0.5, r * 0.98, r * 1.05, 0);
    ctx.closePath(); ctx.fill(); line(2.4);
    ctx.strokeStyle = "rgba(150,160,185,0.55)"; ctx.lineWidth = 1.2; ctx.stroke();
    ctx.fillStyle = "#0b0d12"; ctx.beginPath(); ctx.ellipse(r * 0.34, 0, r * 0.44, r * 0.4, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(r * 0.56, 0, r * 0.13, 0, TAU); ctx.fill();
    ctx.strokeStyle = "rgba(255,90,110,0.4)"; ctx.lineWidth = r * 0.3; ctx.beginPath(); ctx.moveTo(r * 0.2, r * 0.72); ctx.lineTo(r * 1.25, r * 0.36); ctx.stroke();
    ctx.strokeStyle = acc; ctx.lineWidth = r * 0.13; ctx.beginPath(); ctx.moveTo(r * 0.2, r * 0.72); ctx.lineTo(r * 1.25, r * 0.36); ctx.stroke();
    ctx.strokeStyle = "rgba(255,255,255,0.95)"; ctx.lineWidth = r * 0.05; ctx.beginPath(); ctx.moveTo(r * 0.2, r * 0.72); ctx.lineTo(r * 1.25, r * 0.36); ctx.stroke();
  } else if (d.shape === "guard") {
    ctx.fillStyle = main; ctx.beginPath();
    ctx.moveTo(r * 1.05, 0); ctx.quadraticCurveTo(r * 0.5, -r * 1.0, -r * 0.5, -r * 0.98); ctx.quadraticCurveTo(-r * 1.2, -r * 0.42, -r * 1.2, 0); ctx.quadraticCurveTo(-r * 1.2, r * 0.42, -r * 0.5, r * 0.98); ctx.quadraticCurveTo(r * 0.5, r * 1.0, r * 1.05, 0); ctx.closePath(); ctx.fill(); line(2.6);
    ctx.strokeStyle = "rgba(60,6,14,0.7)"; ctx.lineWidth = 2.2;
    ctx.beginPath(); ctx.moveTo(-r * 0.35, -r * 0.72); ctx.quadraticCurveTo(-r * 0.72, 0, -r * 0.35, r * 0.72); ctx.stroke();
    ctx.fillStyle = "#c01224"; ctx.beginPath(); ctx.ellipse(r * 0.38, 0, r * 0.44, r * 0.42, 0, 0, TAU); ctx.fill(); line(1.8);
    ctx.fillStyle = "#190406"; roundRect(ctx, r * 0.6, -r * 0.3, r * 0.36, r * 0.6, 3); ctx.fill();
    ctx.strokeStyle = acc; ctx.lineWidth = r * 0.08; ctx.beginPath(); ctx.moveTo(-r * 0.55, -r * 1.15); ctx.lineTo(r * 1.15, r * 0.72); ctx.stroke();
  } else if (d.shape === "darktrooper") {
    ctx.fillStyle = "#39414c"; roundRect(ctx, -r * 0.5, -r * 1.18, r * 0.95, r * 0.42, 3); ctx.fill(); line(2);
    roundRect(ctx, -r * 0.5, r * 0.76, r * 0.95, r * 0.42, 3); ctx.fill(); line(2);
    ctx.fillStyle = main; ctx.beginPath();
    ctx.moveTo(r * 1.0, 0); ctx.lineTo(r * 0.55, -r * 0.82); ctx.lineTo(-r * 0.35, -r * 0.98); ctx.lineTo(-r * 0.98, -r * 0.52); ctx.lineTo(-r * 0.98, r * 0.52); ctx.lineTo(-r * 0.35, r * 0.98); ctx.lineTo(r * 0.55, r * 0.82); ctx.closePath(); ctx.fill(); line(2.6);
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath(); ctx.moveTo(r * 0.85, 0); ctx.lineTo(r * 0.45, -r * 0.7); ctx.lineTo(-r * 0.2, -r * 0.82); ctx.lineTo(-r * 0.6, -r * 0.4); ctx.lineTo(r * 0.3, -r * 0.2); ctx.closePath(); ctx.fill();
    ctx.fillStyle = "#20242b"; roundRect(ctx, -r * 0.18, -r * 0.52, r * 0.9, r * 1.04, 3); ctx.fill(); line(1.8);
    ctx.fillStyle = acc; roundRect(ctx, r * 0.4, -r * 0.36, r * 0.52, r * 0.72, 3); ctx.fill(); line(1.6);
    ctx.fillStyle = "#ffe9df"; roundRect(ctx, r * 0.48, -r * 0.24, r * 0.36, r * 0.18, 2); ctx.fill();
    ctx.fillStyle = acc; ctx.beginPath(); ctx.arc(-r * 0.74, 0, r * 0.26, 0, TAU); ctx.fill(); line(1.6);
    ctx.strokeStyle = "rgba(255,120,80,0.5)"; ctx.lineWidth = r * 0.5; ctx.beginPath(); ctx.moveTo(-r * 1.0, 0); ctx.lineTo(-r * 1.55, 0); ctx.stroke();
  } else {
    ctx.fillStyle = main; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); line(2);
  }
}
export function drawEnemy(ctx, e, game, quality) {
  shade(ctx, e);
  ctx.save();
  ctx.translate(e.x, e.y - (e.flying ? 8 : 0));
  const hr = e.radius * (e.boss ? 2.0 : 1.8);
  const hg = ctx.createRadialGradient(0, 0, e.radius * 0.5, 0, 0, hr);
  hg.addColorStop(0, e.boss ? "rgba(255,120,140,0.22)" : "rgba(160,205,255,0.2)");
  hg.addColorStop(1, "rgba(160,205,255,0)");
  ctx.fillStyle = hg;
  ctx.beginPath(); ctx.arc(0, 0, hr, 0, TAU); ctx.fill();
  ctx.restore();
  ctx.save();
  ctx.translate(e.x, e.y);
  if (e.flying) ctx.translate(0, -8 + Math.sin(game.time * 6 + e.seed * 10) * 2);
  ctx.rotate(e.angle);
  body(ctx, e, e.radius, game.time);
  ctx.restore();

  if (e.shield > 0 && quality !== "low") {
    ctx.save();
    ctx.translate(e.x, e.y - (e.flying ? 8 : 0));
    const a = 0.18 + 0.22 * (e.shield / e.maxShield);
    ctx.strokeStyle = "rgba(120,200,255," + a + ")";
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.arc(0, 0, e.radius + 4, 0, TAU); ctx.stroke();
    ctx.fillStyle = "rgba(90,170,255,0.09)";
    ctx.beginPath(); ctx.arc(0, 0, e.radius + 4, 0, TAU); ctx.fill();
    ctx.restore();
  }

  const w = Math.max(26, e.radius * 2.6);
  const bx = e.x - w / 2, by = e.y - e.radius - (e.flying ? 20 : 13);
  ctx.fillStyle = "rgba(0,0,0,0.55)";
  roundRect(ctx, bx - 1, by - 1, w + 2, 6, 3); ctx.fill();
  const hpR = Math.max(0, e.hp / e.maxHp);
  ctx.fillStyle = e.boss ? "#ff5a6e" : hpR > 0.5 ? "#7ef0a6" : hpR > 0.25 ? "#f5c542" : "#ff7a5a";
  roundRect(ctx, bx, by, w * hpR, 4, 2); ctx.fill();
  if (e.maxShield > 0) {
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    roundRect(ctx, bx - 1, by - 5, w + 2, 4, 2); ctx.fill();
    ctx.fillStyle = "#5ac8ff";
    roundRect(ctx, bx, by - 4, w * Math.max(0, e.shield / e.maxShield), 2, 1); ctx.fill();
  }
  if (e.slowUntil > game.time) {
    ctx.fillStyle = "rgba(120,200,255,0.85)";
    ctx.beginPath(); ctx.arc(e.x + w / 2 + 4, by + 2, 2.4, 0, TAU); ctx.fill();
  }
  if (e.stunUntil > game.time) {
    ctx.fillStyle = "#ffe066";
    ctx.beginPath(); ctx.arc(e.x - w / 2 - 4, by + 2, 2.4, 0, TAU); ctx.fill();
  }
}

function drawProjectile(ctx, p) {
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(p.angle);
  ctx.shadowBlur = 12;
  ctx.shadowColor = p.color;
  if (p.type === "blaster") {
    ctx.fillStyle = "#fff";
    roundRect(ctx, -6, -1.6, 12, 3.2, 1.6); ctx.fill();
    ctx.fillStyle = p.color;
    roundRect(ctx, -9, -1, 10, 2, 1); ctx.fill();
  } else if (p.type === "laser") {
    ctx.fillStyle = "#fff";
    roundRect(ctx, -13, -1.4, 26, 2.8, 1.4); ctx.fill();
    ctx.fillStyle = p.color;
    roundRect(ctx, -18, -2.4, 30, 4.8, 2); ctx.fill();
  } else if (p.type === "missile") {
    ctx.fillStyle = "#cbd5e1";
    ctx.beginPath(); ctx.moveTo(8, 0); ctx.lineTo(-6, -4); ctx.lineTo(-6, 4); ctx.closePath(); ctx.fill();
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.moveTo(-6, -3); ctx.lineTo(-11 - Math.random() * 6, 0); ctx.lineTo(-6, 3); ctx.closePath(); ctx.fill();
  } else {
    ctx.fillStyle = "#e9d5ff";
    ctx.beginPath(); ctx.arc(0, 0, 4.6, 0, TAU); ctx.fill();
    ctx.fillStyle = p.color;
    ctx.beginPath(); ctx.arc(0, 0, 7, 0, TAU); ctx.fill();
  }
  ctx.restore();
}

export function draw(ctx, game, view = {}) {
  const quality = view.quality || "high";
  ctx.save();
  if (game.shake > 0.4) ctx.translate(rand(-game.shake, game.shake) * 0.4, rand(-game.shake, game.shake) * 0.4);

  ctx.drawImage(getTerrain(game), 0, 0);

  const hover = view.hover;
  if (view.ghostType && hover && hover.c >= 0) {
    const def = TOWERS.find((t) => t.id === view.ghostType);
    const ok = view.ghostValid;
    const cx = (hover.c + 0.5) * GRID.cell, cy = (hover.r + 0.5) * GRID.cell;
    ctx.save();
    ctx.globalAlpha = 0.28;
    ctx.fillStyle = ok ? "#57e08a" : "#ff5a6e";
    ctx.fillRect(hover.c * GRID.cell, hover.r * GRID.cell, GRID.cell, GRID.cell);
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = ok ? "#57e08a" : "#ff5a6e";
    ctx.lineWidth = 2;
    ctx.strokeRect(hover.c * GRID.cell + 1, hover.r * GRID.cell + 1, GRID.cell - 2, GRID.cell - 2);
    if (ok) {
      ctx.globalAlpha = 0.12;
      ctx.fillStyle = def.glow;
      ctx.beginPath(); ctx.arc(cx, cy, def.tiers[0].range, 0, TAU); ctx.fill();
    }
    ctx.restore();
    if (ok) {
      ctx.save();
      ctx.globalAlpha = 0.75;
      ctx.translate(cx, cy);
      ctx.fillStyle = def.color;
      roundRect(ctx, -12, -12, 24, 24, 5); ctx.fill();
      ctx.restore();
    }
  }

  const sel = game.towers.find((t) => t.id === game.selectedTowerId);
  if (sel) {
    const def = TOWERS.find((t) => t.id === sel.typeId);
    const s = def.tiers[sel.level];
    ctx.save();
    ctx.globalAlpha = 0.1;
    ctx.fillStyle = def.glow;
    ctx.beginPath(); ctx.arc(sel.x, sel.y, s.range, 0, TAU); ctx.fill();
    ctx.globalAlpha = 0.5;
    ctx.strokeStyle = def.glow; ctx.lineWidth = 1.6;
    ctx.setLineDash([6, 6]);
    ctx.beginPath(); ctx.arc(sel.x, sel.y, s.range, 0, TAU); ctx.stroke();
    ctx.restore();
  }

  for (const t of game.towers) {
    const def = TOWERS.find((d) => d.id === t.typeId);
    drawTower(ctx, t, def, def.tiers[t.level], game, t.id === game.selectedTowerId);
  }

  if (game.hero && game.hero.alive) drawHero(ctx, game.hero, game);

  const sorted = [...game.enemies].sort((a, b) => (a.y - b.y));
  for (const e of sorted) if (e.alive) drawEnemy(ctx, e, game, quality);

  for (const p of game.projectiles) drawProjectile(ctx, p);

  ctx.save();
  ctx.lineCap = "round";
  for (const b of game.beams) {
    const a = Math.max(0, b.life / b.max);
    ctx.globalAlpha = a;
    ctx.strokeStyle = b.color;
    ctx.shadowBlur = 10; ctx.shadowColor = b.color;
    ctx.lineWidth = b.width;
    ctx.beginPath(); ctx.moveTo(b.x1, b.y1); ctx.lineTo(b.x2, b.y2); ctx.stroke();
  }
  ctx.restore();

  if (quality !== "low") {
    for (const p of game.particles) {
      const a = Math.max(0, p.life / p.max);
      if (p.kind === "ring") {
        ctx.save();
        ctx.globalAlpha = a * 0.8;
        ctx.strokeStyle = p.color; ctx.lineWidth = 3 * a + 1;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.stroke();
        ctx.restore();
      } else if (p.kind === "smoke") {
        ctx.save();
        ctx.globalAlpha = a * 0.5;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * (1.6 - a), 0, TAU); ctx.fill();
        ctx.restore();
      } else {
        ctx.save();
        ctx.globalAlpha = a;
        ctx.fillStyle = p.color;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.size * a + 0.6, 0, TAU); ctx.fill();
        ctx.restore();
      }
    }
  }

  ctx.save();
  ctx.textAlign = "center";
  ctx.font = "700 13px Rajdhani, system-ui, sans-serif";
  for (const f of game.floaters) {
    ctx.globalAlpha = Math.min(1, f.life * 1.4);
    ctx.fillStyle = "rgba(0,0,0,0.6)";
    ctx.fillText(f.text, f.x + 1, f.y + 1);
    ctx.fillStyle = f.color;
    ctx.fillText(f.text, f.x, f.y);
  }
  ctx.restore();

  if (view.hover && game.hero && game.hero.alive && view.heroMove) {
    ctx.save();
    ctx.strokeStyle = "#57e08a"; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.strokeRect(view.hover.c * GRID.cell, view.hover.r * GRID.cell, GRID.cell, GRID.cell);
    ctx.restore();
  }

  ctx.restore();
}
