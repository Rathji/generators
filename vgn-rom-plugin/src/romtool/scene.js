// scene.js — reconstruction de SCÈNES COMPLÈTES (tilemaps / fonds de jeu) à partir
// de la ROM, à la façon de SNESTilesKitten : on lit la carte (grille d'indices de
// tuiles, avec bits de flip/palette) puis on rend chaque tuile à sa position avec la
// palette choisie → une image cohérente exportable en PNG.

import { paletteColors, defaultPaletteColors } from './extract.js';

// Décode une carte depuis la ROM.
//   entrySize : 8 (1 octet = indice) ou 16 (mot : indice + flip + palette)
// Retourne { w, h, entries:[{tile, hf, vf, pal}] }
export function decodeMap(platform, bytes, off, entrySize, mapW, mapH) {
  const entries = [];
  for (let i = 0; i < mapW * mapH; i++) {
    if (entrySize === 8) {
      const b = bytes[off + i];
      entries.push({ tile: b & 0xff, hf: 0, vf: 0, pal: 0 });
    } else {
      let w;
      if (platform === 'genesis' || platform === 'sms') w = (bytes[off + i * 2] << 8) | bytes[off + i * 2 + 1];
      else w = bytes[off + i * 2] | (bytes[off + i * 2 + 1] << 8);
      if (platform === 'snes') entries.push({ tile: w & 0x3ff, hf: (w >> 10) & 1, vf: (w >> 11) & 1, pal: (w >> 12) & 3 });
      else entries.push({ tile: w & 0x3ff, hf: (w >> 11) & 1, vf: (w >> 12) & 1, pal: (w >> 10) & 1 });
    }
  }
  return { w: mapW, h: mapH, entries };
}

// Rend une scène. tiles = Uint8Array (tuiles 8×8, 64 octets chacune) ;
// colors = tableau de [r,g,b] (et éventuellement a) indexé par la valeur de pixel ;
// chaque entrée de carte positionne une tuile avec flip H/V.
export function buildScene(tiles, entries, colors, mapW, mapH) {
  const W = mapW * 8, H = mapH * 8;
  const img = new ImageData(W, H);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const tx = (i % mapW) * 8, ty = Math.floor(i / mapW) * 8;
    const tbase = e.tile * 64;
    if (tbase < 0 || tbase + 64 > tiles.length) continue;
    for (let y = 0; y < 8; y++) {
      const sy = e.vf ? (7 - y) : y;
      for (let x = 0; x < 8; x++) {
        const sx = e.hf ? (7 - x) : x;
        const idx = tiles[tbase + sy * 8 + sx];
        const c = colors[idx] || [0, 0, 0, 255];
        const p = ((ty + y) * W + (tx + x)) * 4;
        img.data[p] = c[0]; img.data[p + 1] = c[1]; img.data[p + 2] = c[2];
        img.data[p + 3] = c.length > 3 ? c[3] : 255;
      }
    }
  }
  return img;
}

// Suggestions automatiques de cartes (fondées sur l'analyse matérielle déjà faite) :
// les DMA 68k → VRAM dont la destination tombe dans une zone de plan (Genesis) ou une
// zone de tilemap (SNES) sont de bons candidats pour une carte de fond.
export function findPlaneMaps(assets) {
  const out = [];
  const dm = (assets.analysis && assets.analysis.dmaUploads) || [];
  const pi = assets.analysis && assets.analysis.planInfo;
  const zones = [];
  if (pi) {
    if (pi.planeA != null) zones.push([pi.planeA, pi.planeA + 0x1000, 'Plan A']);
    if (pi.planeB != null) zones.push([pi.planeB, pi.planeB + 0x1000, 'Plan B']);
  }
  const dims = (len, kind) => {
    const n = Math.floor(len / 2);
    const widths = kind === 'genesis' ? [64, 40, 32] : [32, 64, 48];
    for (const w of widths) {
      if (n % w === 0) return { w, h: n / w };
    }
    return { w: widths[0], h: Math.ceil(n / widths[0]) };
  };
  for (const d of dm) {
    if (d.kind !== 'vram' || d.srcFile == null || d.len == null || d.len < 32) continue;
    let label = '';
    let score = 0;
    if (d.dest != null) {
      for (const [a, b, n] of zones) {
        if (d.dest >= a && d.dest < b) { label = n; score = 100; break; }
      }
    }
    if (assets.kind === 'snes' && !label && d.dest != null && d.dest < 0x4000 && d.len >= 64) { label = 'Tilemap VRAM'; score = 50; }
    const { w, h } = dims(d.len, assets.kind);
    out.push({
      off: d.srcFile, len: d.len, entrySize: 16, w, h,
      name: `${label ? label + ' — ' : ''}DMA → VRAM 0x${(d.dest != null ? d.dest : 0).toString(16).toUpperCase()} @0x${d.srcFile.toString(16).toUpperCase()} (${w}×${h})`,
      score,
    });
  }
  out.sort((a, b) => b.score - a.score);
  return out;
}

// Couleurs d'une palette pour une scène (même logique que l'onglet Graphismes).
export function colorsFor(assets, ts, palIdx) {
  if (ts.bpp === 2) return defaultPaletteColors('nes');
  if (palIdx > 0 && assets.palettes[palIdx - 1]) {
    const c = assets.palettes[palIdx - 1].raw;
    const arr = [];
    if (assets.kind === 'snes') for (let i = 0; i < 16; i++) arr.push(paletteColors('snes', c.subarray(i * 2, i * 2 + 2))[0]);
    else if (assets.kind === 'genesis') for (let i = 0; i < 16; i++) arr.push(paletteColors('genesis', c.subarray(i * 2, i * 2 + 2))[0]);
    else arr.push(...paletteColors(assets.kind, c));
    return arr;
  }
  return defaultPaletteColors(assets.kind);
}

// Score de « qualité » d'une scène rendue : une vraie scène utilise plusieurs couleurs
// (variété) et n'est ni vide ni noyée de contenu aléatoire uniforme.
function scoreScene(img) {
  const d = img.data;
  const colors = new Set();
  const total = img.width * img.height;
  let nonBlank = 0;
  for (let p = 0; p < total; p++) {
    const i = p * 4;
    if (d[i] || d[i + 1] || d[i + 2]) nonBlank++;
    if (colors.size < 256) colors.add((d[i] << 16) | (d[i + 1] << 8) | d[i + 2]);
  }
  if (nonBlank < total * 0.03) return -1;
  return colors.size * 12 + (nonBlank / total) * 25;
}

// Reconnaissance automatique : essaie chaque carte découverte × tileset × palette, rend la
// scène et garde la meilleure. Retourne { score, map, tilesetId, palIdx } ou null.
export function autoBuildScene(assets) {
  if (!assets || !assets.tilesets || !assets.tilesets.length) return null;
  const maps = findPlaneMaps(assets);
  if (!maps.length) return null;
  const maxPal = Math.min(assets.palettes.length, 4);
  let best = null;
  for (const map of maps) {
    const { entries } = decodeMap(assets.kind, assets.bytes, map.off, map.entrySize, map.w, map.h);
    for (const ts of assets.tilesets) {
      for (let pi = 0; pi <= maxPal; pi++) {
        const img = buildScene(ts.tiles, entries, colorsFor(assets, ts, pi), map.w, map.h);
        const s = scoreScene(img);
        if (s > 0 && (!best || s > best.score)) best = { score: s, map, tilesetId: ts.id, palIdx: pi };
      }
    }
  }
  return best;
}
