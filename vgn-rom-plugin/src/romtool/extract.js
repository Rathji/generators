// extract.js — extraction graphique depuis la ROM : tuiles 8×8 (bit-parfait),
// palettes candidates et export spritesheet/CSS/JSON.
//
// - NES    : le CHR-ROM est une région dédiée → tuiles décodées bit-parfaitement.
// - SNES   : analyse guidée par le code (snesgfx.js) : uploads DMA, palettes
//   CGRAM, puis scan des régions de tuiles restantes (code exclu).
// - SMS/Genesis : les données de tuiles vivent en ROM → scan heuristique.
// - Palettes : table matérielle de chaque console + recherche de candidats dans
//   les données de la ROM (les couleurs finales sont posées à l'exécution).

import { analyzeSNESGraphics, pickBpp } from './snesgfx.js';
import { analyzeGenesisGraphics, pickBppGen } from './genesisgfx.js';
import { konamiLzDecompress, looksLikeTiles } from './lz.js';

export const NES_PAL = [
  [124,124,124],[0,0,252],[0,0,188],[68,40,188],[148,0,132],[168,0,32],[168,16,0],[136,20,0],
  [80,48,0],[0,120,0],[0,104,0],[0,88,0],[0,64,88],[0,0,0],[0,0,0],[0,0,0],
  [188,188,188],[0,120,248],[0,88,248],[104,68,252],[216,0,204],[228,0,88],[248,56,0],[228,92,16],
  [172,124,0],[0,184,0],[0,168,0],[0,168,68],[0,136,136],[248,248,248],[0,0,0],[0,0,0],
  [252,252,252],[60,188,252],[104,136,252],[152,120,248],[248,120,248],[248,88,152],[248,120,88],[252,160,68],
  [248,184,0],[184,248,24],[88,216,84],[88,248,152],[0,232,216],[120,120,120],[252,252,252],[0,0,0],
  [252,252,252],[164,228,252],[184,184,248],[216,184,248],[248,184,248],[248,164,192],[240,208,176],[252,224,168],
  [248,216,120],[216,248,120],[184,248,184],[184,248,216],[24,252,252],[184,184,184],[248,248,248],[0,0,0],
];

function nesColor(i) {
  return NES_PAL[i & 0x3f] || [0, 0, 0];
}
function smsColor(i) {
  i &= 0x3f;
  return [(i & 3) * 85, ((i >> 2) & 3) * 85, ((i >> 4) & 3) * 85];
}
function genColor(w) {
  const sc = (v) => Math.round((v * 255) / 7);
  return [sc((w >> 1) & 7), sc((w >> 5) & 7), sc((w >> 9) & 7)];
}
function snesColor(w) {
  const sc = (v) => Math.round((v * 255) / 31);
  return [sc(w & 31), sc((w >> 5) & 31), sc((w >> 10) & 31)];
}

function kindColor(kind, v) {
  if (kind === 'nes') return nesColor(v);
  if (kind === 'sms') return smsColor(v);
  if (kind === 'genesis') return genColor(v);
  return snesColor(v);
}

export function paletteColors(kind, raw) {
  const n = kind === 'nes' ? 32 : 16;
  const arr = new Array(n);
  for (let i = 0; i < n; i++) {
    if (kind === 'genesis' || kind === 'snes') arr[i] = kindColor(kind, (raw[i * 2] << 8) | raw[i * 2 + 1]);
    else arr[i] = kindColor(kind, raw[i]);
  }
  return arr;
}

export function defaultPaletteColors(kind) {
  if (kind === 'nes') {
    const base = [0x0f, 0x16, 0x27, 0x30];
    const raw = new Uint8Array(32);
    for (let g = 0; g < 8; g++) for (let c = 0; c < 4; c++) raw[g * 4 + c] = base[c];
    return paletteColors('nes', raw);
  }
  let raw;
  if (kind === 'sms') raw = new Uint8Array([0x00, 0x03, 0x07, 0x0b, 0x0f, 0x13, 0x17, 0x1b, 0x1f, 0x23, 0x27, 0x2b, 0x2f, 0x33, 0x37, 0x3f]);
  else if (kind === 'genesis') raw = new Uint8Array([0x00, 0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88, 0x99, 0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff]);
  else raw = new Uint8Array([0x00, 0x21, 0x42, 0x63, 0x84, 0xa5, 0xc6, 0xe7, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff]);
  return paletteColors(kind, raw);
}

// ---------------- décodeurs de tuiles 8×8 ----------------

function decNes(bytes, base, i) {
  const b = base + i * 16;
  const px = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    const lo = bytes[b + y], hi = bytes[b + 8 + y];
    for (let x = 0; x < 8; x++) px[y * 8 + x] = (((hi >> x) & 1) << 1) | ((lo >> x) & 1);
  }
  return px;
}
function decSnes(bytes, base, i, bpp) {
  // Plan bpp par PAIRES de bit-planes : chaque bloc de 16 octets contient
  // 8 lignes × 2 plans (lo,hi), puis le bloc suivant pour les plans 3-4, etc.
  const b = base + i * 8 * bpp;
  const px = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let p = 0; p < bpp; p++) {
      const by = bytes[b + Math.floor(p / 2) * 16 + y * 2 + (p % 2)];
      for (let x = 0; x < 8; x++) px[y * 8 + x] |= ((by >> (7 - x)) & 1) << p;
    }
  }
  return px;
}
function decSms(bytes, base, i) {
  const b = base + i * 32;
  const px = new Uint8Array(64);
  for (let y = 0; y < 8; y++) {
    for (let p = 0; p < 4; p++) {
      const by = bytes[b + y * 4 + p];
      for (let x = 0; x < 8; x++) px[y * 8 + x] |= ((by >> (7 - x)) & 1) << p;
    }
  }
  return px;
}
function decGen(bytes, base, i, bpp) {
  // Genesis : tuile 4bpp = 32 o, NIBNLE entrelaces (2 pixels/octet, gros-boutiste) ;
  // tuile 8bpp = 64 o (1 octet/pixel). Disposition confirmee par gimp-rom-bin
  // (format_gens_4bpp.c) — ce n'est PAS planaire comme le SMS.
  const b = base + i * (bpp === 8 ? 64 : 32);
  const px = new Uint8Array(64);
  if (bpp === 8) {
    for (let y = 0; y < 8; y++) for (let x = 0; x < 8; x++) px[y * 8 + x] = bytes[b + y * 8 + x];
    return px;
  }
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 8; x++) {
      const by = bytes[b + y * 4 + (x >> 1)];
      px[y * 8 + x] = (by >> ((x & 1) ? 0 : 4)) & 0x0f;
    }
  }
  return px;
}

export function decodeTile(kind, bytes, off, index, bpp) {
  if (kind === 'nes') return decNes(bytes, off, index);
  if (kind === 'snes') return decSnes(bytes, off, index, bpp);
  if (kind === 'sms') return decSms(bytes, off, index);
  return decGen(bytes, off, index, bpp);
}

// ---------------- recherche de palettes candidates ----------------

export function scanPalettes(bytes, kind) {
  const out = [];
  const add = (raw, off, score) => out.push({ name: `Palette @0x${off.toString(16).toUpperCase()}`, raw, src: off, score });
  if (kind === 'nes') {
    for (let off = 0; off + 32 <= bytes.length; off++) {
      let ok = true;
      for (let i = 0; i < 32; i++) if (bytes[off + i] >= 0x40) { ok = false; break; }
      if (!ok) continue;
      const distinct = new Set(bytes.subarray(off, off + 32));
      let nz = 0;
      for (let i = 0; i < 32; i++) if (bytes[off + i]) nz++;
      if (distinct.size < 5 || nz < 12) continue;
      add(bytes.slice(off, off + 32), off, distinct.size * 2 + nz / 4);
    }
  } else if (kind === 'sms') {
    for (let off = 0; off + 16 <= bytes.length; off++) {
      let ok = true;
      for (let i = 0; i < 16; i++) if (bytes[off + i] >= 0x40) { ok = false; break; }
      if (!ok) continue;
      const distinct = new Set(bytes.subarray(off, off + 16));
      if (distinct.size < 4) continue;
      add(bytes.slice(off, off + 16), off, distinct.size);
    }
  } else if (kind === 'genesis') {
    for (let off = 0; off + 32 <= bytes.length; off += 2) {
      let ok = true;
      const ws = [];
      for (let i = 0; i < 16; i++) {
        const w = (bytes[off + i * 2] << 8) | bytes[off + i * 2 + 1];
        if (w > 0x0fff) { ok = false; break; }
        ws.push(w);
      }
      if (!ok) continue;
      const distinct = new Set(ws);
      if (distinct.size < 4) continue;
      add(bytes.slice(off, off + 32), off, distinct.size);
    }
  } else {
    for (let off = 0; off + 32 <= bytes.length; off += 2) {
      let ok = true;
      const ws = [];
      for (let i = 0; i < 16; i++) {
        const w = bytes[off + i * 2] | (bytes[off + i * 2 + 1] << 8);
        if (w >= 0x8000) { ok = false; break; }
        ws.push(w);
      }
      if (!ok) continue;
      const distinct = new Set(ws);
      if (distinct.size < 4) continue;
      add(bytes.slice(off, off + 32), off, distinct.size);
    }
  }
  out.sort((a, b) => b.score - a.score);
  const seen = new Set(), uniq = [];
  for (const p of out) {
    const k = p.raw.join(',');
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(p);
    if (uniq.length >= 10) break;
  }
  return uniq;
}

// ---------------- scan des régions de tuiles (SNES/SMS/Genesis) ----------------

export function regionLooksPlausible(bytes, off, tileSize) {  let nz = 0;
  const vals = new Set();
  for (let t = 0; t < 4; t++) {
    for (let i = 0; i < tileSize; i++) {
      const v = bytes[off + t * tileSize + i];
      if (v) nz++;
      if (vals.size < 32) vals.add(v);
    }
  }
  return nz > 0 && vals.size >= 3;
}

export function scoreRegion(bytes, off, tileSize) {
  let nonEmpty = 0, textured = 0, blank = 0;
  for (let t = 0; t < 256; t++) {
    const o = off + t * tileSize;
    let nz = 0;
    const vals = new Set();
    for (let i = 0; i < tileSize; i++) {
      const v = bytes[o + i];
      if (v) nz++;
      if (vals.size < 32) vals.add(v);
    }
    if (nz === 0) blank++;
    else nonEmpty++;
    if (vals.size >= 2 && nz >= Math.ceil(tileSize / 2)) textured++;
  }
  const score = textured * 4 + nonEmpty - blank * 2;
  return { ok: nonEmpty >= 140 && textured >= 30, score, nonEmpty, textured };
}

function scanTileRegions(bytes, sizes) {
  const cands = [];
  for (const s of sizes) {
    const step = s.tileSize;
    for (let off = 0; off + 256 * step <= bytes.length; off += step) {
      if (!regionLooksPlausible(bytes, off, step)) continue;
      const sc = scoreRegion(bytes, off, step);
      if (!sc.ok) continue;
      cands.push({ off, bpp: s.bpp, tileSize: step, score: sc.score });
    }
  }
  cands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of cands) {
    if (picked.some((p) => Math.abs(p.off - c.off) < 96 * c.tileSize)) continue;
    picked.push(c);
    if (picked.length >= 12) break;
  }
  return picked;
}

// ---------------- extraction ----------------

function countNonEmpty(tiles, maxN) {
  const n = maxN == null ? 256 : Math.min(maxN, 256);
  let count = 0;
  for (let i = 0; i < n; i++) {
    const b = i * 64;
    let nz = 0;
    for (let p = 0; p < 64; p++) if (tiles[b + p]) { nz = 1; break; }
    count += nz;
  }
  return count;
}

function extractNes(rom, bytes) {
  const { prgBanks, chrBanks } = rom.info;
  if (!chrBanks) {
    return { kind: 'nes', bytes, tilesets: [], palettes: [], notes: ['CHR-RAM: no static tile data in the ROM.'] };
  }
  const chrOff = 16 + (prgBanks || 1) * 0x4000;
  const chrLen = chrBanks * 0x2000;
  const avail = Math.min(chrLen, Math.max(0, bytes.length - chrOff));
  const tables = Math.floor(avail / 0x1000);
  const tilesets = [];
  for (let t = 0; t < tables; t++) {
    const off = chrOff + t * 0x1000;
    const tiles = new Uint8Array(256 * 64);
    for (let i = 0; i < 256; i++) tiles.set(decNes(bytes, off, i), i * 64);
    const ts = { id: t, name: `CHR table ${t}`, bpp: 2, tileSize: 16, off, tiles };
    tilesets.push({ ...ts, nonEmpty: countNonEmpty(tiles) });
  }
  return { kind: 'nes', bytes, tilesets, palettes: scanPalettes(bytes, 'nes'), notes: [] };
}

function extractScan(bytes, kind) {
  const sizes = kind === 'snes'
    ? [{ bpp: 2, tileSize: 16 }, { bpp: 4, tileSize: 32 }, { bpp: 8, tileSize: 64 }]
    : kind === 'genesis'
      ? [{ bpp: 4, tileSize: 32 }, { bpp: 8, tileSize: 64 }]
      : [{ bpp: 4, tileSize: 32 }];
  const regions = scanTileRegions(bytes, sizes);
  const tilesets = regions.map((r, i) => {
    const tiles = new Uint8Array(256 * 64);
    for (let j = 0; j < 256; j++) tiles.set(decodeTile(kind, bytes, r.off, j, r.bpp), j * 64);
    const ts = { id: i, name: `Tiles @0x${r.off.toString(16).toUpperCase()} (${r.bpp} bpp)`, bpp: r.bpp, tileSize: r.tileSize, off: r.off, tiles };
    return { ...ts, nonEmpty: countNonEmpty(tiles) };
  });
  return {
    kind, bytes, tilesets,
    palettes: scanPalettes(bytes, kind),
    notes: tilesets.length ? [] : ['No obvious tile region found (data may be compressed).'],
  };
}

function extractSnes(rom, bytes, cpu) {
  const an = analyzeSNESGraphics(rom, cpu, bytes);
  const data = bytes.subarray(an.skip);
  const tilesets = [];
  const usedRegions = [];
  let id = 0;
  const addTs = (off, bpp, count, name, extra = {}) => {
    const tileSize = bpp * 8;
    const tiles = new Uint8Array(256 * 64);
    const n = Math.min(count, 256);
    for (let j = 0; j < n; j++) tiles.set(decodeTile('snes', bytes, off, j, bpp), j * 64);
    const ts = { id: id++, name, bpp, tileSize, off, tiles, nonEmpty: countNonEmpty(tiles, n) };
    Object.assign(ts, extra);
    tilesets.push(ts);
    usedRegions.push([off, off + n * tileSize]);
  };

  // 1) uploads DMA connus (source + taille) → régions de tuiles sûres
  for (const u of an.dmaUploads) {
    if (u.srcFile == null || u.len == null || u.len < 32) continue;
    if (usedRegions.some(([a, b]) => u.srcFile >= a && u.srcFile < b)) continue;
    const bpp = pickBpp(data, u.srcFile, u.len, an.bgMode);
    const count = Math.min(256, Math.floor(u.len / (bpp * 8)));
    if (count < 8) continue;
    const dest = u.dest != null ? '0x' + u.dest.toString(16).toUpperCase().padStart(4, '0') : '?';
    addTs(u.srcFile, bpp, count, `DMA c${u.ch} → VRAM ${dest} @0x${u.srcFile.toString(16).toUpperCase()}`, { dma: true, vramAddr: u.dest });
  }

  // 2) régions de tuiles scannées (code exclu, seed = pointeurs)
  for (const r of an.regionCands) {
    if (usedRegions.some(([a, b]) => r.off >= a - 64 && r.off < b)) continue;
    const blen = Math.min(0x4000, data.length - r.off);
    const rbpp = pickBpp(data, r.off, blen, an.bgMode);
    const rcount = Math.min(256, Math.floor(blen / (rbpp * 8)));
    if (rcount < 8) continue;
    addTs(r.off, rbpp, rcount, `Tiles @0x${r.off.toString(16).toUpperCase()} (${rbpp} bpp, ${Math.round(r.score)} pts)`, { scanned: true });
  }

  // 3) écritures VRAM directes groupées (données posées par le code)
  for (const g of an.vramGroups) {
    if (g.count < 96) continue;
    const bpp = 4;
    const tiles = new Uint8Array(256 * 64);
    const n = Math.min(256, Math.floor(g.count * 2 / (bpp * 8)));
    for (let j = 0; j < n; j++) {
      const b = new Uint8Array(bpp * 8);
      for (let y = 0; y < 8; y++) for (let p = 0; p < bpp; p++) b[y * bpp + p] = g.bytes[j * bpp * 8 + y * bpp + p] || 0;
      for (let y = 0; y < 8; y++) {
        for (let p = 0; p < bpp; p++) {
          const by = b[y * bpp + p];
          for (let x = 0; x < 8; x++) tiles[j * 64 + y * 8 + x] |= ((by >> (7 - x)) & 1) << p;
        }
      }
    }
    tilesets.push({ id: id++, name: `VRAM 0x${g.addr.toString(16).toUpperCase().padStart(4, '0')} (direct write)`, bpp, tileSize: 32, off: g.siteFile, tiles, nonEmpty: countNonEmpty(tiles, n), virtual: true });
  }

  // palettes
  const palettes = [];
  const usedPal = [];
  for (const p of an.paletteUploads) {
    if (p.srcFile != null && p.len != null && p.srcFile + p.len <= data.length) {
      const n = Math.max(1, Math.floor(p.len / 32));
      for (let k = 0; k < n && k < 4; k++) {
        const off = p.srcFile + k * 32;
        if (usedPal.some((u) => Math.abs(u - off) < 16)) continue;
        usedPal.push(off);
        palettes.push({ name: `CGRAM palette @0x${off.toString(16).toUpperCase()} (DMA)`, raw: data.slice(off, off + 32), src: off, score: 1000 });
      }
    } else if (p.raw && p.raw.length >= 32) {
      palettes.push({ name: `CGRAM palette 0x${(p.cgAddr != null ? p.cgAddr : 0).toString(16).toUpperCase()} (direct write)`, raw: p.raw.slice(0, 32), src: p.siteFile || 0, score: 950, virtual: true });
    }
  }
  for (const c of an.palettes) {
    if (usedPal.some((u) => Math.abs(u - c.off) < 16)) continue;
    usedPal.push(c.off);
    palettes.push({ name: `Palette @0x${c.off.toString(16).toUpperCase()}`, raw: c.raw, src: c.off, score: c.score });
  }

  const notes = [];
  if (!tilesets.length && !an.dmaUploads.length) notes.push('Aucune région de tuiles évidente trouvée (données peut-être compressées).');
  if (an.dmaUploads.some((u) => u.srcFile == null)) notes.push(`${an.dmaUploads.filter((u) => u.srcFile == null).length} upload(s) DMA sans source connue (adresse passée par pointeur non résolu).`);
  return {
    kind: 'snes', bytes, tilesets, palettes, notes,
    analysis: {
      codeCovered: an.stats.codeCovered, insns: an.stats.insns, dmaCount: an.stats.dmaCount,
      ptrCount: an.stats.ptrCount, bgMode: an.bgMode, screen: an.screen,
    },
  };
}

function extractGenesis(rom, bytes, cpu) {
  const an = analyzeGenesisGraphics(rom, cpu, bytes);
  const data = bytes;
  const tilesets = [];
  const usedRegions = [];
  let id = 0;
  const addTs = (off, bpp, count, name, extra = {}) => {
    const tileSize = bpp * 8;
    const tiles = new Uint8Array(256 * 64);
    const n = Math.min(count, 256);
    for (let j = 0; j < n; j++) tiles.set(decodeTile('genesis', bytes, off, j, bpp), j * 64);
    const ts = { id: id++, name, bpp, tileSize, off, tiles, nonEmpty: countNonEmpty(tiles, n) };
    Object.assign(ts, extra);
    tilesets.push(ts);
    usedRegions.push([off, off + n * tileSize]);
  };

  // 1) DMA 68k → VRAM : régions de tuiles sûres (source + longueur connues)
  for (const u of an.dmaUploads) {
    if (u.srcFile == null || u.len == null || u.len < 32) continue;
    if (usedRegions.some(([a, b]) => u.srcFile >= a && u.srcFile < b)) continue;
    const bpp = pickBppGen(data, u.srcFile, u.len);
    const count = Math.min(256, Math.floor(u.len / (bpp * 8)));
    if (count < 8) continue;
    const dest = u.dest != null ? '0x' + u.dest.toString(16).toUpperCase().padStart(4, '0') : '?';
    addTs(u.srcFile, bpp, count, `DMA → VRAM ${dest} @0x${u.srcFile.toString(16).toUpperCase()}`, { dma: true, vramAddr: u.dest });
  }

  // 2) régions scannées (code exclu, seed = sources DMA + pointeurs)
  for (const r of an.regionCands) {
    if (usedRegions.some(([a, b]) => r.off >= a - 64 && r.off < b)) continue;
    const blen = Math.min(0x4000, data.length - r.off);
    const rbpp = r.bpp;
    const rcount = Math.min(256, Math.floor(blen / (rbpp * 8)));
    if (rcount < 8) continue;
    addTs(r.off, rbpp, rcount, `Tuiles @0x${r.off.toString(16).toUpperCase()} (${rbpp} bpp, ${Math.round(r.score)} pts)`, { scanned: true });
  }

  // 3) écritures VRAM directes groupées (données posées par le code)
  for (const g of an.vramGroups) {
    if (g.count < 96) continue;
    const bpp = 4;
    const tiles = new Uint8Array(256 * 64);
    const n = Math.min(256, Math.floor(g.count * 2 / (bpp * 8)));
    for (let j = 0; j < n; j++) {
      const b = new Uint8Array(bpp * 8);
      for (let y = 0; y < 8; y++) for (let p = 0; p < bpp; p++) b[y * bpp + p] = g.bytes[j * bpp * 8 + y * bpp + p] || 0;
      for (let y = 0; y < 8; y++) {
        for (let p = 0; p < bpp; p++) {
          const by = b[y * bpp + p];
          for (let x = 0; x < 8; x++) tiles[j * 64 + y * 8 + x] |= ((by >> (7 - x)) & 1) << p;
        }
      }
    }
    tilesets.push({ id: id++, name: `VRAM 0x${g.addr.toString(16).toUpperCase().padStart(4, '0')} (direct write)`, bpp, tileSize: 32, off: g.siteFile, tiles, nonEmpty: countNonEmpty(tiles, n), virtual: true });
  }

  // 2b) données compressées (LZ Konami/BandaiNamco/Terranigma) : tentative aux pointeurs
  for (const p of an.pointers) {
    if (usedRegions.some(([a, b]) => p >= a - 64 && p < b)) continue;
    const dec = konamiLzDecompress(data, p);
    if (!dec || !looksLikeTiles(dec, 32)) continue;
    usedRegions.push([p, p + 1]);
    const lcount = Math.min(256, Math.floor(dec.length / 32));
    if (lcount < 4) continue;
    const lt = new Uint8Array(256 * 64);
    for (let j = 0; j < lcount; j++) lt.set(decodeTile('genesis', dec, 0, j, 4), j * 64);
    const nn = countNonEmpty(lt, lcount);
    if (nn < 2) continue;
    tilesets.push({ id: id++, name: `LZ tiles @0x${p.toString(16).toUpperCase()} (Konami/Bandai/Namco)`, bpp: 4, tileSize: 32, off: p, tiles: lt, nonEmpty: nn });
  }

  // palettes
  const palettes = [];
  const usedPal = [];
  for (const p of an.paletteUploads) {
    if (p.srcFile != null && p.len != null && p.srcFile + p.len <= data.length) {
      const n = Math.max(1, Math.floor(p.len / 32));
      for (let k = 0; k < n && k < 4; k++) {
        const off = p.srcFile + k * 32;
        if (usedPal.some((u) => Math.abs(u - off) < 16)) continue;
        usedPal.push(off);
        palettes.push({ name: `CRAM palette @0x${off.toString(16).toUpperCase()} (DMA)`, raw: data.slice(off, off + 32), src: off, score: 1000 });
      }
    }
  }
  for (const p of an.cramPalettes) {
    if (!p.raw || p.raw.length < 32) continue;
    palettes.push({ name: `CRAM palette 0x${(p.addr != null ? p.addr : 0).toString(16).toUpperCase()} (direct write)`, raw: p.raw.slice(0, 32), src: p.siteFile || 0, score: 950, virtual: true });
  }
  for (const c of an.palettes) {
    if (usedPal.some((u) => Math.abs(u - c.off) < 16)) continue;
    usedPal.push(c.off);
    palettes.push({ name: `Palette @0x${c.off.toString(16).toUpperCase()}`, raw: c.raw, src: c.off, score: c.score });
  }

  const notes = [];
  if (!tilesets.length && !an.dmaUploads.length) notes.push('No obvious tile region found (data may be compressed).');
  if (an.dmaUploads.some((u) => u.srcFile == null)) notes.push(`${an.dmaUploads.filter((u) => u.srcFile == null).length} DMA with unknown source (source computed, not immediate).`);
  return {
    kind: 'genesis', bytes, tilesets, palettes, notes,
    analysis: {
      codeCovered: an.stats.codeCovered, insns: an.stats.insns, dmaCount: an.stats.dmaCount,
      ptrCount: an.stats.ptrCount, planInfo: an.planInfo,
    },
  };
}

export function extractAssets(rom, bytes, platform, cpu) {
  if (platform === 'nes') return extractNes(rom, bytes);
  if (platform === 'snes') return extractSnes(rom, bytes, cpu);
  if (platform === 'sms') return extractScan(bytes, 'sms');
  return extractGenesis(rom, bytes, cpu);
}
