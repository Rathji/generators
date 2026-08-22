// src/map.js — World map generation & rendering (Roadmap task 2).
// A coordinate-based tile grid with randomized terrain (water/grass/forest/
// swamp/mountain), resource nodes (Gold, Gems), and static encounter markers.
// Exposed globally as window.WorldMap so later tasks (hero movement, fog of
// war) can build on the same grid.

export function mulberry32(seed) {
  let a = seed >>> 0;
  return function () {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(w, h, rand, cellSize) {
  const gw = Math.ceil(w / cellSize) + 2;
  const gh = Math.ceil(h / cellSize) + 2;
  const lattice = new Array(gw * gh);
  for (let i = 0; i < lattice.length; i++) lattice[i] = rand();
  return function (x, y) {
    const gx = x / cellSize, gy = y / cellSize;
    const x0 = Math.floor(gx), y0 = Math.floor(gy);
    const fx = gx - x0, fy = gy - y0;
    const sx = fx * fx * (3 - 2 * fx);
    const sy = fy * fy * (3 - 2 * fy);
    const i00 = lattice[(y0 % gh) * gw + (x0 % gw)];
    const i10 = lattice[(y0 % gh) * gw + ((x0 + 1) % gw)];
    const i01 = lattice[((y0 + 1) % gh) * gw + (x0 % gw)];
    const i11 = lattice[((y0 + 1) % gh) * gw + ((x0 + 1) % gw)];
    return i00 + (i10 - i00) * sx + (i01 - i00) * sy + (i11 - i10 - i01 + i00) * sx * sy;
  };
}

export const MAP_W = 44;
export const MAP_H = 30;
export const TILE = 24;

export const TERRAINS = ["water", "grass", "forest", "swamp", "mountain"];
export const RESOURCE_TYPES = ["gold", "gems"];

export function generateMap(seed) {
  const rand = mulberry32(seed);
  const elev = makeNoise(MAP_W, MAP_H, rand, 7);
  const moist = makeNoise(MAP_W, MAP_H, rand, 5);

  const grid = [];
  for (let y = 0; y < MAP_H; y++) {
    const row = [];
    for (let x = 0; x < MAP_W; x++) {
      const e = elev(x, y), m = moist(x, y);
      let t;
      if (e < 0.36) t = "water";
      else if (e < 0.44 && m > 0.55) t = "swamp";
      else if (e < 0.58) t = "grass";
      else if (e < 0.73) t = m > 0.5 ? "forest" : "grass";
      else t = "mountain";
      row.push({ t, resource: null, encounter: false, town: false });
    }
    grid.push(row);
  }

  const isLand = (x, y) => {
    if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
    return grid[y][x].t !== "water" && grid[y][x].t !== "mountain";
  };

  const resources = [];
  const encounters = [];

  function place(count, spots, kind) {
    const spotsLeft = spots.slice();
    for (let i = 0; i < count && spotsLeft.length; i++) {
      const idx = Math.floor(rand() * spotsLeft.length);
      const [x, y] = spotsLeft.splice(idx, 1)[0];
      if (kind === "gold") { grid[y][x].resource = "gold"; resources.push({ x, y, type: "gold" }); }
      else { grid[y][x].resource = "gems"; resources.push({ x, y, type: "gems" }); }
    }
  }

  const open = [];
  for (let y = 1; y < MAP_H - 1; y++) {
    for (let x = 1; x < MAP_W - 1; x++) {
      if (isLand(x, y)) open.push([x, y]);
    }
  }
  const shuffled = open.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
  }
  let cursor = 0;
  const pickSpaced = (n) => {
    const chosen = [];
    let guard = 0;
    while (chosen.length < n && guard++ < shuffled.length * 4) {
      const [x, y] = shuffled[cursor % shuffled.length];
      cursor++;
      if (!isLand(x, y)) continue;
      const ok = chosen.every(([cx, cy]) => Math.abs(cx - x) + Math.abs(cy - y) >= 4);
      if (ok) chosen.push([x, y]);
    }
    return chosen;
  };

  place(4, pickSpaced(4), "gold");
  place(4, pickSpaced(4), "gems");

  const ENEMY_BANDS = ["Goblin Raiders", "Dire Wolves", "Bandit Crew", "Orc Warband"];
  const encSpots = pickSpaced(8);
  for (const [x, y] of encSpots) {
    grid[y][x].encounter = true;
    encounters.push({ x, y, name: ENEMY_BANDS[Math.floor(rand() * ENEMY_BANDS.length)], count: 8 + Math.floor(rand() * 15) });
  }

  const towns = [];
  const townSpots = pickSpaced(2);
  for (const [x, y] of townSpots) {
    grid[y][x].town = true;
    towns.push({ x, y });
  }

  const stats = {
    seed,
    tiles: { water: 0, grass: 0, forest: 0, swamp: 0, mountain: 0 },
    goldMines: resources.filter(r => r.type === "gold").length,
    gemPiles: resources.filter(r => r.type === "gems").length,
    encounters: encounters.length,
    towns: towns.length
  };
  for (const row of grid) for (const c of row) stats.tiles[c.t]++;

  return { grid, resources, encounters, towns, stats };
}

const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];

export function isPassable(map, x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  const t = map.grid[y][x].t;
  return t !== "water" && t !== "mountain";
}

export function terrainCost(map, x, y) {
  return map.grid[y][x].t === "swamp" ? 2 : 1;
}

const cellKey = (x, y) => y * MAP_W + x;

export function dijkstra(map, sx, sy, maxCost) {
  const dist = new Map();
  const prev = new Map();
  dist.set(cellKey(sx, sy), 0);
  const pq = [{ x: sx, y: sy, d: 0 }];
  while (pq.length) {
    pq.sort((a, b) => a.d - b.d);
    const cur = pq.shift();
    const k = cellKey(cur.x, cur.y);
    if (cur.d > dist.get(k)) continue;
    for (const [dx, dy] of DIRS) {
      const nx = cur.x + dx, ny = cur.y + dy;
      if (!isPassable(map, nx, ny)) continue;
      const c = terrainCost(map, nx, ny);
      if (cur.d + c > maxCost) continue;
      const nk = cellKey(nx, ny);
      const nd = cur.d + c;
      if (nd < (dist.get(nk) ?? Infinity)) {
        dist.set(nk, nd);
        prev.set(nk, { x: cur.x, y: cur.y });
        pq.push({ x: nx, y: ny, d: nd });
      }
    }
  }
  return { dist, prev };
}

export function reachableTiles(map, x, y, movesLeft) {
  const { dist } = dijkstra(map, x, y, movesLeft);
  const tiles = [];
  dist.forEach((d, k) => {
    if (k !== cellKey(x, y) && d <= movesLeft) tiles.push({ x: k % MAP_W, y: Math.floor(k / MAP_W) });
  });
  return tiles;
}

export function pathTo(map, sx, sy, tx, ty) {
  const { prev } = dijkstra(map, sx, sy, Infinity);
  if (!prev.has(cellKey(tx, ty))) return null;
  const path = [];
  let cur = cellKey(tx, ty);
  while (cur !== cellKey(sx, sy)) {
    path.unshift({ x: cur % MAP_W, y: Math.floor(cur / MAP_W) });
    const p = prev.get(cur);
    if (!p) return null;
    cur = cellKey(p.x, p.y);
  }
  return path;
}

// ── Fog of war ─────────────────────────────────────────────────────────
// Each tile's visibility: 0 = hidden (unexplored), 1 = explored (previously
// seen), 2 = currently visible (inside the hero's sight radius).
export const SIGHT_RADIUS = 5;

export function initFog(map) {
  map.visibility = new Uint8Array(MAP_W * MAP_H);
}

export function updateFog(map, hero) {
  const v = map.visibility;
  const r2 = SIGHT_RADIUS * SIGHT_RADIUS;
  for (let ty = 0; ty < MAP_H; ty++) {
    for (let tx = 0; tx < MAP_W; tx++) {
      const idx = ty * MAP_W + tx;
      const dx = tx - hero.x, dy = ty - hero.y;
      if (dx * dx + dy * dy <= r2) v[idx] = 2;
      else if (v[idx] === 2) v[idx] = 1;
    }
  }
}

export function isVisible(map, x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  return map.visibility[y * MAP_W + x] === 2;
}

export function isExplored(map, x, y) {
  if (x < 0 || y < 0 || x >= MAP_W || y >= MAP_H) return false;
  return map.visibility[y * MAP_W + x] >= 1;
}

export function exploredPercent(map) {
  let seen = 0;
  for (let i = 0; i < map.visibility.length; i++) if (map.visibility[i]) seen++;
  return Math.round((seen / map.visibility.length) * 100);
}

function hash2(x, y) {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >> 13)) | 0;
  h = Math.imul(h, 1274126177);
  return ((h ^ (h >> 16)) >>> 0) / 4294967296;
}

const TERRAIN_COLORS = {
  water: ["#2e5f92", "#3a6fa3"],
  grass: ["#4a7a2c", "#5d9237"],
  forest: ["#2f5722", "#3c6b2b"],
  swamp: ["#6b6a33", "#7d7c3e"],
  mountain: ["#7a7266", "#8d857a"]
};

function shade(ctx, px, py, rnd) {
  ctx.fillStyle = "rgba(0,0,0," + (0.04 + rnd() * 0.05).toFixed(3) + ")";
  ctx.fillRect(px, py, TILE, TILE);
}

function drawTerrain(ctx, x, y, t, rnd) {
  const px = x * TILE, py = y * TILE;
  const base = TERRAIN_COLORS[t][rnd() < 0.5 ? 0 : 1];
  ctx.fillStyle = base;
  ctx.fillRect(px, py, TILE, TILE);

  if (t === "water") {
    if (rnd() < 0.35) {
      ctx.strokeStyle = "rgba(255,255,255,.12)";
      ctx.lineWidth = 1;
      ctx.beginPath();
      const wy = py + 5 + rnd() * 9;
      ctx.moveTo(px + 4, wy);
      ctx.lineTo(px + 9 + rnd() * 9, wy);
      ctx.stroke();
    }
  } else if (t === "forest") {
    const ntrees = rnd() < 0.3 ? 2 : 1;
    for (let i = 0; i < ntrees; i++) {
      const tx = px + 6 + rnd() * 11;
      const ty = py + 6 + rnd() * 11;
      ctx.fillStyle = "#1d3d15";
      ctx.beginPath(); ctx.arc(tx, ty, 6, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = "#2f5a22";
      ctx.beginPath(); ctx.arc(tx - 1, ty - 2, 4, 0, Math.PI * 2); ctx.fill();
    }
  } else if (t === "mountain") {
    const rocks = 2 + Math.floor(rnd() * 2);
    for (let i = 0; i < rocks; i++) {
      const rx = px + 4 + rnd() * 15;
      const ry = py + 4 + rnd() * 15;
      const s = 4 + rnd() * 5;
      ctx.fillStyle = ["#8b8272", "#5f5a4d", "#a89f8c"][i === 0 ? 0 : Math.floor(rnd() * 3)];
      ctx.beginPath();
      ctx.moveTo(rx - s * 0.7, ry + s * 0.2);
      ctx.lineTo(rx - s * 0.3, ry - s * 0.6);
      ctx.lineTo(rx + s * 0.4, ry - s * 0.5);
      ctx.lineTo(rx + s * 0.7, ry + s * 0.2);
      ctx.lineTo(rx + s * 0.2, ry + s * 0.7);
      ctx.lineTo(rx - s * 0.5, ry + s * 0.6);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = "rgba(255,255,255,.18)";
      ctx.beginPath();
      ctx.moveTo(rx - s * 0.3, ry - s * 0.6);
      ctx.lineTo(rx + s * 0.4, ry - s * 0.5);
      ctx.lineTo(rx, ry);
      ctx.closePath(); ctx.fill();
      if (rnd() < 0.35) {
        ctx.fillStyle = "#eeeae0";
        ctx.beginPath();
        ctx.arc(rx, ry - s * 0.45, 1.8, 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else if (t === "swamp") {
    ctx.fillStyle = "#4d4c22";
    ctx.beginPath(); ctx.arc(px + 6 + rnd() * 12, py + 6 + rnd() * 12, 5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#8a883f";
    ctx.beginPath(); ctx.arc(px + 11 + rnd() * 9, py + 12 + rnd() * 8, 3.5, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = "#3f4d1f";
    for (let i = 0; i < 3; i++) ctx.fillRect(px + 3 + rnd() * 17, py + 3 + rnd() * 17, 2, 3);
  } else {
    for (let i = 0; i < 3; i++) {
      ctx.fillStyle = "rgba(255,255,255,.10)";
      ctx.fillRect(px + rnd() * (TILE - 3), py + rnd() * (TILE - 3), 2, 2);
    }
  }

  shade(ctx, px, py, rnd);
}

function neighborTouches(grid, x, y, t) {
  for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
    const nx = x + dx, ny = y + dy;
    if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
    if (grid[ny][nx].t === t) return true;
  }
  return false;
}

function drawCoastlines(ctx, grid) {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      if (grid[y][x].t !== "water") continue;
      if (!neighborTouches(grid, x, y, "water")) { // open water — darker depth
        ctx.fillStyle = "rgba(8,20,40,.18)";
        ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
      }
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H) continue;
        if (grid[ny][nx].t === "water") continue;
        const px = x * TILE, py = y * TILE;
        ctx.fillStyle = "rgba(224,206,152,.85)";
        if (dx === 1) ctx.fillRect(px + TILE - 5, py, 5, TILE);
        else if (dx === -1) ctx.fillRect(px, py, 5, TILE);
        else if (dy === 1) ctx.fillRect(px, py + TILE - 5, TILE, 5);
        else ctx.fillRect(px, py, TILE, 5);
        ctx.fillStyle = "rgba(232,216,170,.45)";
        if (dx === 1 && grid[ny][nx].t !== "mountain") ctx.fillRect(px + TILE - 2, py, 2, TILE);
        else if (dx === -1 && grid[ny][nx].t !== "mountain") ctx.fillRect(px, py, 2, TILE);
        else if (dy === 1 && grid[ny][nx].t !== "mountain") ctx.fillRect(px, py + TILE - 2, TILE, 2);
        else if (dy === -1 && grid[ny][nx].t !== "mountain") ctx.fillRect(px, py, TILE, 2);
      }
    }
  }
}

function drawMountainShadows(ctx, grid) {
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      const t = grid[y][x].t;
      if (t === "water" || t === "mountain") continue;
      const px = x * TILE, py = y * TILE;
      ctx.fillStyle = "rgba(30,20,10,.25)";
      if (x + 1 < MAP_W && grid[y][x + 1].t === "mountain") ctx.fillRect(px + TILE - 4, py, 4, TILE);
      if (y + 1 < MAP_H && grid[y + 1][x].t === "mountain") ctx.fillRect(px, py + TILE - 4, TILE, 4);
    }
  }
}

function drawResource(ctx, x, y, type) {
  const px = x * TILE, py = y * TILE;
  if (type === "gold") {
    ctx.fillStyle = "#4a3a1c";
    ctx.beginPath(); ctx.ellipse(px + 12, py + 18, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = "#6d541f";
    ctx.lineWidth = 1.5;
    ctx.beginPath(); ctx.arc(px + 12, py + 11, 7, 0, Math.PI * 2); ctx.fillStyle = "#e8c83a"; ctx.fill(); ctx.stroke();
    ctx.beginPath(); ctx.arc(px + 17, py + 14, 4.5, 0, Math.PI * 2); ctx.fillStyle = "#c9a62c"; ctx.fill(); ctx.stroke();
    ctx.fillStyle = "#fff3b0";
    ctx.beginPath(); ctx.arc(px + 10, py + 9, 2, 0, Math.PI * 2); ctx.fill();
  } else {
    ctx.fillStyle = "#3a2c50";
    ctx.beginPath(); ctx.ellipse(px + 12, py + 18, 10, 6, 0, 0, Math.PI * 2); ctx.fill();
    const gem = (gx, gy, s, c, hc) => {
      ctx.fillStyle = c;
      ctx.beginPath();
      ctx.moveTo(gx, gy - s);
      ctx.lineTo(gx + s * 0.8, gy);
      ctx.lineTo(gx, gy + s);
      ctx.lineTo(gx - s * 0.8, gy);
      ctx.closePath(); ctx.fill();
      ctx.fillStyle = hc;
      ctx.beginPath();
      ctx.moveTo(gx, gy - s);
      ctx.lineTo(gx, gy);
      ctx.lineTo(gx - s * 0.8, gy);
      ctx.closePath(); ctx.fill();
    };
    gem(px + 9, py + 10, 5.5, "#3fd6c8", "#b8fff7");
    gem(px + 16, py + 13, 5, "#5a8bff", "#cfe0ff");
  }
}

function drawEncounter(ctx, x, y) {
  const px = x * TILE, py = y * TILE;
  const cx = px + TILE / 2, cy = py + TILE / 2;
  ctx.strokeStyle = "#3a2a18";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(cx - 7, cy + 7); ctx.lineTo(cx - 7, cy - 8); ctx.stroke();
  ctx.fillStyle = "#b02a1a";
  ctx.beginPath();
  ctx.moveTo(cx - 6, cy - 8);
  ctx.lineTo(cx + 9, cy - 3);
  ctx.lineTo(cx - 6, cy + 2);
  ctx.closePath(); ctx.fill();
  ctx.fillStyle = "#ffe4cf";
  ctx.beginPath();
  ctx.moveTo(cx - 4, cy - 4.5);
  ctx.lineTo(cx + 3, cy - 2.5);
  ctx.lineTo(cx - 4, cy - 0.5);
  ctx.closePath(); ctx.fill();
}

function drawStar(ctx, cx, cy, outerR, innerR, points) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = -Math.PI / 2 + (i / (points * 2)) * Math.PI * 2;
    const x = cx + Math.cos(a) * r, y = cy + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
  }
  ctx.closePath(); ctx.fill();
}

export function drawHero(ctx, hero) {
  const cx = hero.x * TILE + TILE / 2;
  const cy = hero.y * TILE + TILE / 2;
  ctx.fillStyle = "rgba(0,0,0,.35)";
  ctx.beginPath(); ctx.ellipse(cx, cy + 6, 7, 3, 0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#2b4a8f";
  ctx.beginPath(); ctx.arc(cx, cy - 1, 7, 0, Math.PI * 2); ctx.fill();
  ctx.strokeStyle = "#f0d98c";
  ctx.lineWidth = 2;
  ctx.beginPath(); ctx.arc(cx, cy - 1, 7, 0, Math.PI * 2); ctx.stroke();
  ctx.fillStyle = "#f0d98c";
  drawStar(ctx, cx, cy - 1, 3.6, 1.7, 5);
}

function drawFogTile(ctx, x, y, rnd) {
  const px = x * TILE, py = y * TILE;
  ctx.fillStyle = "#0b100d";
  ctx.fillRect(px, py, TILE, TILE);
  ctx.fillStyle = "rgba(255,255,255," + (0.02 + rnd() * 0.03).toFixed(3) + ")";
  ctx.fillRect(px + rnd() * (TILE - 4), py + rnd() * (TILE - 4), 3, 3);
  ctx.fillStyle = "rgba(0,0,0,.3)";
  ctx.fillRect(px + rnd() * (TILE - 5), py + rnd() * (TILE - 4), 4, 2);
}

function drawCastle(ctx, x, y) {
  const px = x * TILE, py = y * TILE;
  ctx.fillStyle = "#6b5d4a";
  ctx.fillRect(px + 4, py + 9, 16, 10);
  ctx.fillRect(px + 4, py + 4, 4, 5);
  ctx.fillRect(px + 16, py + 4, 4, 5);
  ctx.fillStyle = "#8a7a64";
  ctx.fillRect(px + 5, py + 5, 2, 4);
  ctx.fillRect(px + 17, py + 5, 2, 4);
  ctx.fillStyle = "#4a3a24";
  ctx.fillRect(px + 10, py + 13, 4, 6);
  ctx.strokeStyle = "#3a2a18";
  ctx.lineWidth = 1;
  ctx.beginPath(); ctx.moveTo(px + 12, py + 4); ctx.lineTo(px + 12, py + 1); ctx.stroke();
  ctx.fillStyle = "#d4af37";
  ctx.beginPath(); ctx.moveTo(px + 12, py + 1); ctx.lineTo(px + 17, py + 3); ctx.lineTo(px + 12, py + 5); ctx.closePath(); ctx.fill();
}

export function drawReachables(ctx, map, hero) {
  const tiles = reachableTiles(map, hero.x, hero.y, hero.movesLeft);
  ctx.fillStyle = "rgba(255,240,190,.10)";
  ctx.strokeStyle = "rgba(255,240,190,.4)";
  ctx.lineWidth = 1;
  for (const t of tiles) {
    if (!isVisible(map, t.x, t.y)) continue;
    const px = t.x * TILE, py = t.y * TILE;
    ctx.fillRect(px + 1, py + 1, TILE - 2, TILE - 2);
    ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
  }
}

export function drawHover(ctx, tile, blocked) {
  if (!tile) return;
  const px = tile.x * TILE, py = tile.y * TILE;
  ctx.strokeStyle = blocked ? "rgba(220,70,50,.9)" : "rgba(255,240,190,.95)";
  ctx.lineWidth = 2;
  ctx.strokeRect(px + 1, py + 1, TILE - 2, TILE - 2);
}

export function renderMap(canvas, map) {
  const ctx = canvas.getContext("2d");
  canvas.width = MAP_W * TILE;
  canvas.height = MAP_H * TILE;
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const { grid } = map;
  const fog = map.visibility;
  for (let y = 0; y < MAP_H; y++) {
    for (let x = 0; x < MAP_W; x++) {
      drawTerrain(ctx, x, y, grid[y][x].t, () => hash2(x, y));
    }
  }
  drawCoastlines(ctx, grid);
  drawMountainShadows(ctx, grid);

  if (fog) {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const v = fog[y * MAP_W + x];
        if (v === 0) continue;
        ctx.globalAlpha = v === 1 ? 0.55 : 1;
        const cell = grid[y][x];
        if (cell.resource) drawResource(ctx, x, y, cell.resource);
        if (cell.encounter) drawEncounter(ctx, x, y);
        if (cell.town) drawCastle(ctx, x, y);
      }
    }
    ctx.globalAlpha = 1;
  } else {
    for (const r of map.resources) drawResource(ctx, r.x, r.y, r.type);
    for (const e of map.encounters) drawEncounter(ctx, e.x, e.y);
    for (const t of map.towns) drawCastle(ctx, t.x, t.y);
  }

  if (fog) {
    for (let y = 0; y < MAP_H; y++) {
      for (let x = 0; x < MAP_W; x++) {
        const v = fog[y * MAP_W + x];
        if (v === 0) drawFogTile(ctx, x, y, () => hash2(x * 7 + 3, y * 13 + 1));
        else if (v === 1) {
          ctx.fillStyle = "rgba(10,16,24,.42)";
          ctx.fillRect(x * TILE, y * TILE, TILE, TILE);
        }
      }
    }
  }
}

export function validateMap(map) {
  const { grid, resources, encounters, towns, stats } = map;
  const errs = [];
  if (resources.length !== stats.goldMines + stats.gemPiles) errs.push("resource count mismatch");
  if (stats.goldMines !== 4) errs.push("expected 4 gold mines, got " + stats.goldMines);
  if (stats.gemPiles !== 4) errs.push("expected 4 gem piles, got " + stats.gemPiles);
  if (stats.encounters !== 8) errs.push("expected 8 encounters, got " + stats.encounters);
  if (stats.towns !== 2) errs.push("expected 2 towns, got " + stats.towns);
  for (const r of resources) {
    const c = grid[r.y][r.x];
    if (c.t === "water" || c.t === "mountain") errs.push("resource on invalid terrain " + c.t);
    if (c.resource !== r.type) errs.push("resource grid mismatch");
  }
  for (const e of encounters) {
    const c = grid[e.y][e.x];
    if (c.t === "water" || c.t === "mountain") errs.push("encounter on invalid terrain");
    if (!c.encounter) errs.push("encounter grid mismatch");
    if (!e.name || !e.count) errs.push("encounter missing name/count");
  }
  for (const t of towns) {
    const c = grid[t.y][t.x];
    if (c.t === "water" || c.t === "mountain") errs.push("town on invalid terrain");
    if (!c.town) errs.push("town grid mismatch");
    if (c.resource || c.encounter) errs.push("town overlaps another feature");
  }
  return errs;
}

export function initWorldMap(canvas, seed) {
  const map = generateMap(seed);
  initFog(map);
  renderMap(canvas, map);
  return map;
}
