// A Bard's Tale — canvas setup and pseudo-3D (raycast) scene renderer.
// Wall shading is driven by the party's light radius: low light = short
// sight and a darker, closer fog. Walls carry a stone-brick texture,
// doors a wood grain, and the floor a perspective stone grid.

import { TILE_WALL, TILE_DOOR, TILE_DOOR_LOCKED, TILE_VALVE, TILE_GATE, TILE_DARK } from "./engine.js";
import { hasLightSource } from "./party.js";

export function initCanvas(canvas) {
  const ctx = canvas.getContext("2d");
  let w = 0, h = 0;

  function resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    w = canvas.clientWidth || 1;
    h = canvas.clientHeight || 1;
    canvas.width = Math.round(w * dpr);
    canvas.height = Math.round(h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  resize();
  window.addEventListener("resize", resize);
  return { ctx, get width() { return w; }, get height() { return h; }, resize };
}

// ── Procedural textures (one-time, cached) ─────────────────────
let wallTex = null, doorTex = null, lockedTex = null;

function makeWallTex() {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = "#98a1bc";
  g.fillRect(0, 0, 64, 64);
  for (let y = 0; y < 4; y++) {
    const off = (y % 2) * 8;
    for (let x = -1; x < 4; x++) {
      const bx = x * 16 + off, by = y * 16;
      const v = 168 + Math.floor(Math.random() * 44);
      g.fillStyle = "rgb(" + v + "," + (v + 6) + "," + (v + 26) + ")";
      g.fillRect(bx, by, 16, 16);
      g.fillStyle = "rgba(26,30,48,0.6)";
      g.fillRect(bx, by, 16, 2);
      g.fillRect(bx, by + 14, 16, 2);
      g.fillRect(bx, by, 2, 16);
    }
  }
  for (let i = 0; i < 900; i++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.09)" : "rgba(255,255,255,0.1)";
    g.fillRect(Math.floor(Math.random() * 64), Math.floor(Math.random() * 64), 1, 1);
  }
  return c;
}

function makeWoodTex(base, dark) {
  const c = document.createElement("canvas");
  c.width = 64; c.height = 64;
  const g = c.getContext("2d");
  g.fillStyle = base;
  g.fillRect(0, 0, 64, 64);
  for (let i = 0; i < 7; i++) {
    const y = 2 + i * 9 + Math.floor(Math.random() * 3);
    g.fillStyle = dark;
    g.fillRect(0, y, 64, 1 + Math.floor(Math.random() * 2));
    g.fillStyle = "rgba(255,210,150,0.10)";
    g.fillRect(0, y + 1, 64, 1);
  }
  for (let i = 0; i < 380; i++) {
    g.fillStyle = Math.random() < 0.5 ? "rgba(0,0,0,0.12)" : "rgba(255,220,170,0.08)";
    g.fillRect(Math.floor(Math.random() * 64), Math.floor(Math.random() * 64), 1, 1);
  }
  g.fillStyle = dark;
  g.fillRect(0, 0, 64, 3);
  g.fillRect(0, 61, 64, 3);
  g.fillRect(0, 0, 3, 64);
  g.fillRect(61, 0, 3, 64);
  return c;
}

function ensureTextures() {
  if (!wallTex) wallTex = makeWallTex();
  if (!doorTex) doorTex = makeWoodTex("#8a5a38", "#5c3c26");
  if (!lockedTex) lockedTex = makeWoodTex("#6e4a46", "#48302c");
}

// Standard DDA raycasting, cast per screen column against the integer grid.
export function renderScene(canvasInfo, state) {
  const { ctx, width: W, height: H } = canvasInfo;
  if (W < 2 || H < 2) return;
  const grid = state.currentMap && state.currentMap.grid;
  if (!grid) return;
  ensureTextures();

  // Pitch-black rooms: standing in one without a lit torch crushes the
  // light to nothing — sight range effectively zero.
  const standing = grid[state.player.y] ? grid[state.player.y][state.player.x] : TILE_DARK;
  const onDark = standing === TILE_DARK;
  const lit = !onDark || hasLightSource(state);
  const light = lit ? Math.max(2.5, state.lightRadius || 9) : 1.05;
  const dim = lit ? Math.max(0.2, Math.min(1, 0.62 + (light / 9) * 0.38)) : 0.16;

  const posX = state.player.x + 0.5;
  const posY = state.player.y + 0.5;
  const f = state.player.facing;
  const dirX = [0, 1, 0, -1][f];
  const dirY = [-1, 0, 1, 0][f];
  const planeLen = 0.66;
  const planeX = -dirY * planeLen;
  const planeY = dirX * planeLen;

  // Ceiling (sky)
  let g = ctx.createLinearGradient(0, 0, 0, H / 2);
  g.addColorStop(0, "rgb(" + Math.round(11 * dim) + "," + Math.round(13 * dim) + "," + Math.round(24 * dim) + ")");
  g.addColorStop(1, "rgb(" + Math.round(27 * dim) + "," + Math.round(34 * dim) + "," + Math.round(64 * dim) + ")");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, W, H / 2);
  // Floor base gradient
  g = ctx.createLinearGradient(0, H / 2, 0, H);
  g.addColorStop(0, "rgb(" + Math.round(20 * dim) + "," + Math.round(24 * dim) + "," + Math.round(44 * dim) + ")");
  g.addColorStop(1, "rgb(" + Math.round(8 * dim) + "," + Math.round(10 * dim) + "," + Math.round(17 * dim) + ")");
  ctx.fillStyle = g;
  ctx.fillRect(0, H / 2, W, H / 2);

  // Perspective stone floor grid — dark lines where world-space cells cross.
  const hor = H / 2;
  ctx.fillStyle = "rgba(0,0,0,0.42)";
  let prevTop = null;
  for (let y = hor + 1; y < H; y++) {
    const rowDist = (0.5 * H) / (y - hor);
    const stepX = (rowDist * planeX * 2) / W;
    const stepY = (rowDist * planeY * 2) / W;
    let fx = posX + rowDist * (dirX - planeX);
    let fy = posY + rowDist * (dirY - planeY);
    const cy = Math.floor(fy);
    if (cy !== prevTop) {
      ctx.fillRect(0, y, W, 1);
      prevTop = cy;
    }
    let prevCell = null;
    for (let x = 0; x < W; x += 2) {
      const cell = Math.floor(fx) + Math.floor(fy) * 4096;
      if (cell !== prevCell) {
        ctx.fillRect(x, y, 2, 1);
        prevCell = cell;
      }
      fx += stepX;
      fy += stepY;
    }
  }

  for (let x = 0; x < W; x++) {
    const cameraX = (2 * x) / W - 1;
    const rayDirX = dirX + planeX * cameraX;
    const rayDirY = dirY + planeY * cameraX;

    let mapX = Math.floor(posX);
    let mapY = Math.floor(posY);
    const deltaDistX = rayDirX === 0 ? 1e30 : Math.abs(1 / rayDirX);
    const deltaDistY = rayDirY === 0 ? 1e30 : Math.abs(1 / rayDirY);
    let stepX, stepY, sideDistX, sideDistY;
    if (rayDirX < 0) { stepX = -1; sideDistX = (posX - mapX) * deltaDistX; }
    else { stepX = 1; sideDistX = (mapX + 1 - posX) * deltaDistX; }
    if (rayDirY < 0) { stepY = -1; sideDistY = (posY - mapY) * deltaDistY; }
    else { stepY = 1; sideDistY = (mapY + 1 - posY) * deltaDistY; }

    let side = 0;
    let hitDist = -1;
    let hitTile = TILE_WALL;
    for (let i = 0; i < 64; i++) {
      if (sideDistX < sideDistY) { sideDistX += deltaDistX; mapX += stepX; side = 0; }
      else { sideDistY += deltaDistY; mapY += stepY; side = 1; }
      const row = grid[mapY];
      if (!row || row[mapX] === undefined) break;
      const t = row[mapX];
      if (t !== 0) { hitDist = side === 0 ? sideDistX - deltaDistX : sideDistY - deltaDistY; hitTile = t; break; }
    }
    if (hitDist < 0) continue;

    const perp = Math.max(0.0001, hitDist);
    const lineH = H / perp;
    const drawStart = Math.max(0, (H - lineH) / 2);
    const drawEnd = Math.min(H, (H + lineH) / 2);

    const edge = 1 - Math.abs(cameraX) * 0.3;
    const shade = Math.max(0, Math.min(1, (1.05 - perp / (light * 1.35)) * edge * dim));

    if (hitTile === TILE_VALVE || hitTile === TILE_GATE) {
      // Flat-coloured hazards keep their signature hue.
      let r, g2, b;
      if (hitTile === TILE_VALVE) { r = 138; g2 = 168; b = 74; }
      else { r = 158; g2 = 96; b = 180; }
      ctx.fillStyle = "rgb(" + Math.round(r * shade) + "," + Math.round(g2 * shade) + "," + Math.round(b * shade) + ")";
      ctx.fillRect(x, drawStart, 1, drawEnd - drawStart);
      continue;
    }

    // Textured wall/doors: draw a 1px column of the texture, tinted by shade.
    let wallX;
    if (side === 0) wallX = posY + perp * rayDirY;
    else wallX = posX + perp * rayDirX;
    wallX -= Math.floor(wallX);
    const tex = hitTile === TILE_DOOR ? doorTex : hitTile === TILE_DOOR_LOCKED ? lockedTex : wallTex;
    const texX = Math.min(63, Math.max(0, Math.floor(wallX * 64)));
    ctx.globalAlpha = shade * (side === 0 ? 1 : 0.72);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tex, texX, 0, 1, 64, x, drawStart, 1, drawEnd - drawStart);
    ctx.globalAlpha = 1;
  }
}
