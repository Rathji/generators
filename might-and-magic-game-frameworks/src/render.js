import { TERRAIN, RES_BY_ID, CREATURES, FACTIONS } from './data.js';
import { hexToPixel, hexCorners, hexDist, DIRS } from './hex.js';
import { terrainOf, objAt, townAt, heroAt, reachable, moveCost } from './engine.js';
import { stackInfo } from './combat.js';

export const MAP_CW = 1100, MAP_CH = 640;
export const BAT_CW = 760, BAT_CH = 480;

export function mapLayout(game) {
  const cw = MAP_CW, ch = MAP_CH;
  const size = Math.min((cw - 16) / (game.w * 1.732 + 1), (ch - 16) / (game.h * 1.5 + 1));
  const ox = (cw - size * 1.732 * game.w) / 2 + size * 0.866;
  const oy = (ch - size * 1.5 * game.h) / 2 + size * 0.75;
  return { size, ox, oy };
}
export function mapPx(game, q, r) {
  const L = mapLayout(game);
  const p = hexToPixel(q, r, L.size);
  return { x: p.x + L.ox, y: p.y + L.oy };
}

function hexPath(ctx, px, py, size) {
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i - Math.PI / 6;
    const x = px + size * Math.cos(a), y = py + size * Math.sin(a);
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
}

function fillHex(ctx, px, py, size, color, stroke = 'rgba(0,0,0,0.25)') {
  hexPath(ctx, px, py, size);
  ctx.fillStyle = color;
  ctx.fill();
  if (stroke) { ctx.strokeStyle = stroke; ctx.lineWidth = 1; ctx.stroke(); }
}

function darken(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
  r = Math.round(r * f); g = Math.round(g * f); b = Math.round(b * f);
  return `rgb(${r},${g},${b})`;
}

// ---------- map ----------
export function drawMap(ctx, game, S) {
  ctx.clearRect(0, 0, MAP_CW, MAP_CH);
  const L = mapLayout(game);
  const { size, ox, oy } = L;
  const hero = S.selectedHeroId ? game.heroes.find(h => h.id === S.selectedHeroId) : null;
  let reach = null;
  if (hero && !game.gameOver) reach = reachable(game, hero, hero.move).costs;

  for (let r = 0; r < game.h; r++) {
    for (let q = 0; q < game.w; q++) {
      const p = hexToPixel(q, r, size);
      const px = p.x + ox, py = p.y + oy;
      const t = TERRAIN[terrainOf(game, q, r)];
      const c = t.colors[(q * 7 + r * 13) % 3];
      fillHex(ctx, px, py, size, c);
      // terrain accents
      if (t === TERRAIN.water) {
        fillHex(ctx, px, py, size * 0.82, darken(c, 1.15), null);
      } else if (t === TERRAIN.rock) {
        drawMountain(ctx, px, py - size * 0.35, size * 0.5);
      } else if (t === TERRAIN.trees) {
        ctx.fillStyle = 'rgba(20,60,10,0.5)';
        for (const [dx, dy] of [[-0.28, -0.1], [0.3, -0.05], [0, 0.25]]) {
          ctx.beginPath();
          ctx.arc(px + dx * size, py + dy * size, size * 0.16, 0, 7);
          ctx.fill();
        }
      } else if (t === TERRAIN.snow) {
        fillHex(ctx, px, py, size * 0.9, 'rgba(255,255,255,0.5)', null);
      }
      // reachable highlight
      if (reach && reach.has(q + ',' + r)) {
        fillHex(ctx, px, py, size, 'rgba(140,220,120,0.22)', null);
      }
    }
  }

  // path preview
  if (S.pathPreview && S.pathPreview.length) {
    ctx.strokeStyle = 'rgba(255,220,120,0.9)';
    ctx.lineWidth = 3;
    ctx.beginPath();
    S.pathPreview.forEach((h, i) => {
      const p = mapPx(game, h.q, h.r);
      i === 0 ? ctx.moveTo(p.x, p.y) : ctx.lineTo(p.x, p.y);
    });
    ctx.stroke();
    for (const h of S.pathPreview) {
      const p = mapPx(game, h.q, h.r);
      fillHex(ctx, p.x, p.y, size * 0.62, 'rgba(255,220,120,0.28)', null);
    }
  }

  // towns
  for (const town of game.towns) {
    const p = mapPx(game, town.q, town.r);
    drawTown(ctx, p.x, p.y, size, town);
  }
  // objects
  for (const o of game.objects) {
    const p = mapPx(game, o.q, o.r);
    drawObject(ctx, p.x, p.y, size, o, game);
  }
  // heroes (on top)
  for (const h of game.heroes) {
    const p = mapPx(game, h.q, h.r);
    drawHero(ctx, p.x, p.y, size, h, S.selectedHeroId === h.id);
  }
  // hover tooltip
  if (S.hover) {
    const t = hoverInfo(game, S.hover.q, S.hover.r);
    if (t) drawTooltip(ctx, game, S.hover, t);
  }
}

function drawMountain(ctx, x, y, s) {
  ctx.fillStyle = 'rgba(255,255,255,0.35)';
  ctx.beginPath();
  ctx.moveTo(x - s, y + s);
  ctx.lineTo(x, y - s);
  ctx.lineTo(x + s, y + s);
  ctx.closePath();
  ctx.fill();
}

function drawTown(ctx, x, y, size, town) {
  const s = size * 0.75;
  const color = town.owner !== null && town.owner !== undefined ? ['#4a7fd6', '#c6483e'][town.owner] : '#6a6a72';
  const faction = FACTIONS[town.faction]?.color || color;
  // keep
  ctx.fillStyle = color;
  ctx.fillRect(x - s * 0.8, y - s * 0.6, s * 1.6, s * 1.2);
  // battlements
  for (let i = -1; i <= 1; i++) {
    ctx.fillRect(x - s * 0.5 + i * s * 0.55, y - s * 0.9, s * 0.3, s * 0.35);
  }
  // gate
  ctx.fillStyle = darken(color, 0.55);
  ctx.beginPath();
  ctx.arc(x, y + s * 0.5, s * 0.22, Math.PI, 0);
  ctx.fill();
  ctx.fillRect(x - s * 0.22, y + s * 0.5 - s * 0.05, s * 0.44, s * 0.1);
  // roof
  ctx.fillStyle = faction;
  ctx.beginPath();
  ctx.moveTo(x - s * 0.5, y - s * 0.55);
  ctx.lineTo(x, y - s * 1.3);
  ctx.lineTo(x + s * 0.5, y - s * 0.55);
  ctx.closePath();
  ctx.fill();
  // flag
  ctx.strokeStyle = '#ddd';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 1.3);
  ctx.lineTo(x, y - s * 1.75);
  ctx.stroke();
  ctx.fillStyle = faction;
  ctx.beginPath();
  ctx.moveTo(x, y - s * 1.75);
  ctx.lineTo(x + s * 0.55, y - s * 1.55);
  ctx.lineTo(x, y - s * 1.35);
  ctx.closePath();
  ctx.fill();
}

function drawObject(ctx, x, y, size, o, game) {
  const s = size * 0.5;
  if (['gold', 'wood', 'ore', 'gems', 'crystal', 'sulfur', 'mercury'].includes(o.type)) {
    const c = RES_BY_ID[o.type].color;
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.arc(x, y, s * 0.75, 0, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.4)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${s}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(RES_BY_ID[o.type].name[0], x, y + 1);
  } else if (o.type === 'mine') {
    const c = RES_BY_ID[o.sub].color;
    const owner = o.owner;
    const oc = owner !== null && owner !== undefined ? (owner === 0 ? '#4a7fd6' : '#c6483e') : 'rgba(255,255,255,0.35)';
    // mine house
    ctx.fillStyle = '#7a6a52';
    ctx.fillRect(x - s * 0.7, y - s * 0.15, s * 1.4, s * 0.85);
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.8, y - s * 0.15);
    ctx.lineTo(x, y - s * 0.8);
    ctx.lineTo(x + s * 0.8, y - s * 0.15);
    ctx.closePath();
    ctx.fill();
    // owner dot
    ctx.fillStyle = oc;
    ctx.beginPath();
    ctx.arc(x, y + s * 0.85, s * 0.22, 0, 7);
    ctx.fill();
  } else if (o.type === 'chest') {
    ctx.fillStyle = '#8a5f2e';
    ctx.fillRect(x - s * 0.6, y - s * 0.45, s * 1.2, s * 0.9);
    ctx.fillStyle = '#c9a24a';
    ctx.fillRect(x - s * 0.6, y - s * 0.45, s * 1.2, s * 0.18);
    ctx.fillStyle = '#5c3d1a';
    ctx.fillRect(x - s * 0.08, y - s * 0.4, s * 0.16, s * 0.8);
  } else if (o.type === 'dwelling') {
    const free = !o.guard;
    const c = FACTIONS[CREATURES[o.creatureId].faction].color;
    ctx.fillStyle = '#6b4a2a';
    ctx.beginPath();
    ctx.moveTo(x - s, y + s * 0.5);
    ctx.lineTo(x, y - s * 0.7);
    ctx.lineTo(x + s, y + s * 0.5);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = c;
    ctx.beginPath();
    ctx.moveTo(x - s * 0.6, y + s * 0.2);
    ctx.lineTo(x, y - s * 0.4);
    ctx.lineTo(x + s * 0.6, y + s * 0.2);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = free ? 'rgba(120,220,120,0.95)' : 'rgba(220,90,80,0.95)';
    ctx.beginPath();
    ctx.arc(x, y + s * 0.6, s * 0.22, 0, 7);
    ctx.fill();
  } else if (o.type === 'stack') {
    const val = o.army.reduce((a, s) => a + s.count, 0);
    ctx.fillStyle = 'rgba(190,60,50,0.9)';
    ctx.beginPath();
    ctx.arc(x, y, s * 0.85, 0, 7);
    ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.fillStyle = '#fff';
    ctx.font = `bold ${s * 0.85}px system-ui`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(String(val), x, y + 1);
  }
}

function drawHero(ctx, x, y, size, hero, selected) {
  const s = size * 0.6;
  const color = hero.pid === 0 ? '#4a7fd6' : '#c6483e';
  ctx.beginPath();
  ctx.arc(x, y, s * 1.35, 0, 7);
  ctx.fillStyle = selected ? 'rgba(255,220,120,0.9)' : 'rgba(0,0,0,0.45)';
  ctx.fill();
  if (selected) {
    ctx.strokeStyle = '#ffdc78';
    ctx.lineWidth = 2.5;
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(x, y, s, 0, 7);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)';
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${s * 0.95}px system-ui`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(hero.name[0], x, y + 1);
  // army count
  const count = hero.army.reduce((a, st) => a + (st ? st.count : 0), 0);
  ctx.fillStyle = 'rgba(10,12,16,0.85)';
  ctx.beginPath();
  ctx.arc(x + s * 0.75, y - s * 0.75, s * 0.5, 0, 7);
  ctx.fill();
  ctx.fillStyle = '#fff';
  ctx.font = `bold ${s * 0.55}px system-ui`;
  ctx.fillText(String(count), x + s * 0.75, y - s * 0.75 + 1);
}

function hoverInfo(game, q, r) {
  const town = townAt(game, q, r);
  if (town) {
    const ownerName = town.owner !== null && town.owner !== undefined ? game.players[town.owner].name : 'Neutral';
    return `${town.name} (${FACTIONS[town.faction].name}) — ${ownerName}`;
  }
  const hero = heroAt(game, q, r);
  if (hero) return `${hero.name} — Lv ${hero.level} — ${hero.army.reduce((a, s) => a + (s ? s.count : 0), 0)} creatures`;
  const o = objAt(game, q, r);
  if (o) {
    if (['gold', 'wood', 'ore', 'gems', 'crystal', 'sulfur', 'mercury'].includes(o.type))
      return `${RES_BY_ID[o.type].name}: ${o.amt}`;
    if (o.type === 'mine') {
      const own = o.owner !== null && o.owner !== undefined ? game.players[o.owner].name : 'Neutral';
      return `${RES_BY_ID[o.sub].name} Mine — ${own}`;
    }
    if (o.type === 'chest') return o.gold ? `Chest: ${o.gold} gold` : `Chest: ${o.xp} XP`;
    if (o.type === 'dwelling') {
      const c = CREATURES[o.creatureId];
      return `${c.name} Dwelling — ${o.guard ? 'guarded' : 'free'} (${o.stock} in stock)`;
    }
    if (o.type === 'stack') {
      const names = o.army.map(s => `${CREATURES[s.id].name} x${s.count}`).join(', ');
      return `Monsters: ${names}`;
    }
  }
  return TERRAIN[terrainOf(game, q, r)].name;
}

function drawTooltip(ctx, game, hex, text) {
  const p = mapPx(game, hex.q, hex.r);
  ctx.font = '12px system-ui';
  const w = ctx.measureText(text).width + 12;
  const x = Math.min(MAP_CW - w - 6, Math.max(6, p.x - w / 2));
  const y = Math.max(6, p.y - 34);
  ctx.fillStyle = 'rgba(12,14,20,0.92)';
  ctx.beginPath();
  ctx.roundRect(x, y, w, 22, 5);
  ctx.fill();
  ctx.fillStyle = '#eee';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x + 6, y + 11);
}

// ---------- combat ----------
export function battleLayout() {
  const cw = BAT_CW, ch = BAT_CH;
  const cols = 11, rows = 8;
  const size = Math.min((cw - 20) / (cols * 1.732 + 1), (ch - 20) / (rows * 1.5 + 1));
  const ox = (cw - size * 1.732 * cols) / 2 + size * 0.866;
  const oy = (ch - size * 1.5 * rows) / 2 + size * 0.75;
  return { size, ox, oy };
}
export function battlePx(q, r) {
  const L = battleLayout();
  const p = hexToPixel(q, r, L.size);
  return { x: p.x + L.ox, y: p.y + L.oy };
}

export function drawBattle(ctx, battle, sel = null, reach = null, targets = null) {
  ctx.clearRect(0, 0, BAT_CW, BAT_CH);
  ctx.fillStyle = '#171a22';
  ctx.fillRect(0, 0, BAT_CW, BAT_CH);
  const L = battleLayout();
  const { size, ox, oy } = L;
  // field
  for (let r = 0; r < 8; r++) for (let q = 0; q < 11; q++) {
    const p = hexToPixel(q, r, size);
    const px = p.x + ox, py = p.y + oy;
    const c = (q + r) % 2 === 0 ? '#2a3140' : '#262d3b';
    fillHex(ctx, px, py, size, c);
  }
  if (reach) for (const k of reach) {
    const [q, r] = k.split(',').map(Number);
    const p = hexToPixel(q, r, size);
    fillHex(ctx, p.x + ox, p.y + oy, size, 'rgba(140,220,120,0.25)', null);
  }
  if (targets) {
    const all = [...battle.attacker.stacks, ...battle.defender.stacks];
    for (const st of all) {
      if (!targets.has(st.uid)) continue;
      const p = hexToPixel(st.pos.q, st.pos.r, size);
      fillHex(ctx, p.x + ox, p.y + oy, size, 'rgba(255,120,100,0.35)', null);
    }
  }
  // stacks
  for (const side of [battle.attacker, battle.defender]) {
    for (const st of side.stacks) {
      if (st.count <= 0) continue;
      const info = stackInfo(st);
      const p = hexToPixel(st.pos.q, st.pos.r, size);
      const px = p.x + ox, py = p.y + oy;
      const selThis = sel && sel.uid === st.uid;
      const color = st.side === battle.attacker ? '#4a7fd6' : '#c6483e';
      ctx.beginPath();
      ctx.arc(px, py, size * 0.62, 0, 7);
      ctx.fillStyle = selThis ? 'rgba(255,220,120,0.85)' : 'rgba(0,0,0,0.5)';
      ctx.fill();
      if (selThis) { ctx.strokeStyle = '#ffdc78'; ctx.lineWidth = 2.5; ctx.stroke(); }
      ctx.beginPath();
      ctx.arc(px, py, size * 0.5, 0, 7);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)';
      ctx.lineWidth = 1.5;
      ctx.stroke();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${size * 0.42}px system-ui`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(info.name[0], px, py);
      // count badge
      ctx.fillStyle = 'rgba(10,12,16,0.85)';
      ctx.beginPath();
      ctx.arc(px + size * 0.45, py - size * 0.45, size * 0.3, 0, 7);
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.font = `bold ${size * 0.3}px system-ui`;
      ctx.fillText(String(info.count), px + size * 0.45, py - size * 0.45 + 1);
    }
  }
  // effects rings (haste/slow etc)
  for (const side of [battle.attacker, battle.defender]) for (const st of side.stacks) {
    if (st.count <= 0 || Object.keys(st.effects).length === 0) continue;
    const p = hexToPixel(st.pos.q, st.pos.r, size);
    ctx.beginPath();
    ctx.arc(p.x + ox, p.y + oy, size * 0.68, 0, 7);
    ctx.strokeStyle = 'rgba(180,140,255,0.8)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
}
