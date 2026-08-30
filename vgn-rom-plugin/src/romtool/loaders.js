// Loaders — detect the console/ROM format, parse headers, and map the file bytes
// into a CPU address space (MemoryView).

import { MemoryView } from './memory.js';

export const PLATFORMS = {
  nes: 'NES (6502)',
  snes: 'SNES (65C816)',
  sms: 'Master System (Z80)',
  genesis: 'Mega Drive / Genesis (68000)',
};

export function detectPlatform(bytes) {
  if (bytes.length >= 16 && bytes[0] === 0x4e && bytes[1] === 0x45 && bytes[2] === 0x53 && bytes[3] === 0x1a) return 'nes';
  if (bytes.length >= 0x110 && isAscii(bytes, 0x100, 'TMR SEGA')) return 'sms';
  if (bytes.length >= 0x110 && isAscii(bytes, 0x100, 'SEGA MEGA DRIVE')) return 'genesis';
  if (bytes.length >= 0x110 && isAscii(bytes, 0x100, 'SEGA GENESIS')) return 'genesis';
  if (bytes.length >= 0x110 && isAscii(bytes, 0x100, 'SEGA 32X')) return 'genesis';
  if ((bytes.length & 0x3ff) === 512 && bytes.length >= 0x8000) return 'snes';
  // SNES without copier header
  if ((bytes.length & 0x7fff) === 0 && bytes.length >= 0x8000 && plausibleSnesHeader(bytes)) return 'snes';
  // Sega Master System raw (multiples of 16KB)
  if (bytes.length >= 0x8000 && (bytes.length & 0x3fff) === 0 && bytes.length <= 0xc000) return 'sms';
  // Genesis raw
  if (bytes.length >= 0x10000 && (bytes.length % 0x20000) === 0) return 'genesis';
  return 'genesis';
}

function isAscii(bytes, off, str) {
  for (let i = 0; i < str.length; i++) if (bytes[off + i] !== str.charCodeAt(i)) return false;
  return true;
}

function plausibleSnesHeader(bytes) {
  for (const off of [0x7fc0, 0xffc0]) {
    if (off + 0x20 > bytes.length) continue;
    let letters = 0, printable = true;
    for (let i = 0; i < 21; i++) {
      const c = bytes[off + i];
      if (c >= 0x41 && c <= 0x7a) letters++;
      if (c !== 0 && (c < 0x20 || c > 0x7e)) printable = false;
    }
    if (printable && letters >= 2) return true;
  }
  return false;
}

export function loadRom(bytes, platform, opts = {}) {
  switch (platform) {
    case 'nes': return loadNES(bytes, opts);
    case 'snes': return loadSNES(bytes, opts);
    case 'sms': return loadSMS(bytes, opts);
    case 'genesis': return loadGenesis(bytes, opts);
  }
  throw new Error('platform inconnu');
}

// ---------------- NES ----------------
function loadNES(bytes, opts = {}) {
  const prgBanks = bytes[4] || 1;
  const chrBanks = bytes[5];
  const mapper = ((bytes[6] >> 4) | (bytes[7] & 0xf0)) & 0xff;
  const fourScreen = (bytes[6] & 0x08) !== 0;
  const mirror = fourScreen ? 'four-screen' : (bytes[6] & 1 ? 'vertical' : 'horizontal');
  const prgSize = prgBanks * 0x4000;
  const prg = bytes.subarray(16, 16 + prgSize);
  const segments = [];
  if (prgSize <= 0x8000) {
    segments.push({ start: 0xc000, bytes: prg, fileOffset: 16 });
    segments.push({ start: 0x8000, bytes: prg, fileOffset: 16 });
  } else {
    const count = Math.floor(prgSize / 0x8000);
    const lo = Math.min(opts.bank || 0, count - 1);
    const hi = count > 1 ? count - 1 : 0;
    segments.push({ start: 0x8000, bytes: prg.subarray(lo * 0x8000, lo * 0x8000 + 0x8000), fileOffset: 16 + lo * 0x8000 });
    if (hi !== lo) segments.push({ start: 0xc000, bytes: prg.subarray(hi * 0x8000, hi * 0x8000 + 0x8000), fileOffset: 16 + hi * 0x8000 });
  }
  const mem = new MemoryView(segments, { mask: 0xffff, coverRanges: segments.map((s) => [s.start, s.start + s.bytes.length]) });
  const reset = mem.readWord(0xfffc);
  const nmi = mem.readWord(0xfffa);
  const irq = mem.readWord(0xfffe);
  const info = {
    platform: 'nes', mapper, prgBanks, chrBanks, mirror,
    mapNote: mapper === 0 ? 'Mapper 0 (NROM): exact mapping.' :
      `Mapper ${mapper}: switchable bank. The static view shows the selected bank at $8000 and the last one at $C000.`,
  };
  const entries = [];
  if (reset != null) entries.push({ addr: reset, label: 'RESET vector' });
  entries.push({ addr: 0x8000, label: 'PRG start' });
  return { platform: 'nes', mem, info, entries, coverRanges: segments.map((s) => [s.start, s.start + s.bytes.length]), vectors: [
    { label: 'NMI', addr: 0xfffa, value: nmi },
    { label: 'RESET', addr: 0xfffc, value: reset },
    { label: 'IRQ/BRK', addr: 0xfffe, value: irq },
  ] };
}

// ---------------- SNES ----------------
function loadSNES(bytes, opts = {}) {
  const skip = (bytes.length & 0x3ff) === 512 ? 512 : 0;
  const data = bytes.subarray(skip);
  let mode = opts.snesMode || 'auto';
  if (mode === 'auto') {
    const d = detectSNESMap(data);
    mode = d.mode;
  }
  const isLo = mode === 'lo' || mode === 'exlo';
  const isEx = mode === 'exhi' || mode === 'exlo';
  const numBlocks = Math.floor(data.length / (isLo ? 0x8000 : 0x10000)) || 1;
  const unmirror = (off) => {
    if (off < data.length) return off;
    let repeatSize = 0x8000;
    while (repeatSize < data.length) repeatSize <<= 1;
    let r = off % repeatSize;
    if (r < data.length) return r;
    let small = 0x8000;
    while (data.length % (small << 1) === 0) small <<= 1;
    while (r >= data.length) r -= small;
    return r;
  };
  let readByte;
  if (mode === 'lo') {
    readByte = (addr) => {
      const a = addr & 0xffffff;
      const bank = (a >> 16) & 0x7f;
      const off = a & 0x7fff;
      return (bank % numBlocks) * 0x8000 + off < data.length ? data[(bank % numBlocks) * 0x8000 + off] : null;
    };
  } else if (mode === 'hi') {
    readByte = (addr) => {
      const a = addr & 0xffffff;
      const bank = (a >> 16) & 0x3f;
      const off = a & 0xffff;
      if (off < 0x8000) return (bank % numBlocks) * 0x8000 + off < data.length ? data[(bank % numBlocks) * 0x8000 + off] : null;
      return (bank % numBlocks) * 0x10000 + off < data.length ? data[(bank % numBlocks) * 0x10000 + off] : null;
    };
  } else if (mode === 'exhi') {
    readByte = (addr) => {
      const a = addr & 0xffffff;
      const off = unmirror(((~a & 0x800000) >> 1) | (a & 0x3fffff));
      return off < data.length ? data[off] : null;
    };
  } else { // exlo
    readByte = (addr) => {
      const a = addr & 0xffffff;
      const bank = ((a ^ 0x800000) >> 16) & 0x7f;
      const off = a & 0x7fff;
      return (bank % numBlocks) * 0x8000 + off < data.length ? data[(bank % numBlocks) * 0x8000 + off] : null;
    };
  }
  const coverRanges = isLo
    ? Array.from({ length: numBlocks }, (_, b) => [b * 0x10000 + 0x8000, b * 0x10000 + 0x10000])
    : Array.from({ length: numBlocks }, (_, b) => [b * 0x10000, (b + 1) * 0x10000]);
  const mem = new MemoryView([], { mask: 0xffffff, readByte, coverRanges });

  const hdr = findSNESHeader(data, mode, numBlocks);
  const info = parseSNESHeader(data, mode, skip, numBlocks, hdr.base);

  // Tables de vecteurs (offsets fichier relatifs à `data`) :
  // - le matériel lit toujours les vecteurs « émulation » dans la banque $00
  //   (LoROM → fichier 0x7FE0, HiROM → fichier 0xFFE0) ;
  // - les vecteurs « natifs » sont normalement dans la dernière banque, mais de
  //   nombreux homebrew ne remplissent que la banque 0 → on bascule si besoin.
  const bank0Vec = isLo ? 0x7fe0 : 0xffe0;
  const vecBase = hdr.base + 0x30;
  const readVec = (f) => {
    const w = (o) => (f + o + 1 < data.length ? (data[f + o] | (data[f + o + 1] << 8)) & 0xffff : null);
    return { cop: w(4), brk: w(6), abort: w(8), nmi: w(10), irq: w(14), reset: w(28) };
  };
  const valid = (t) => t.reset != null && t.reset !== 0;
  let nativeT = readVec(vecBase);
  let emuT = readVec(bank0Vec);
  let nativeFallback = false;
  if (!valid(nativeT) && valid(emuT) && vecBase !== bank0Vec) { nativeT = emuT; nativeFallback = true; }
  if (!valid(emuT) && valid(nativeT) && vecBase !== bank0Vec) emuT = nativeT;
  const bankOf = mode === 'lo' ? (numBlocks - 1) + 0x80 : mode === 'hi' ? (numBlocks - 1) + 0xc0 : mode === 'exhi' ? 0xc0 + ((numBlocks - 1) & 0x3f) : 0x80 + (numBlocks - 1);
  const full = (v) => (v == null ? null : ((bankOf << 16) | v) & 0xffffff);
  const full0 = (v) => (v == null ? null : v & 0xffffff);
  const vectors = [
    { label: 'NMI (émul.)', addr: 0xffea, value: full0(emuT.nmi) },
    { label: 'RESET (émul.)', addr: 0xfffc, value: full0(emuT.reset) },
    { label: 'IRQ (émul.)', addr: 0xffee, value: full0(emuT.irq) },
    { label: 'COP (émul.)', addr: 0xffe4, value: full0(emuT.cop) },
  ];
  if (!nativeFallback) vectors.push(
    { label: 'NMI (natif)', addr: 0xffea, value: full(nativeT.nmi) },
    { label: 'RESET (natif)', addr: 0xfffc, value: full(nativeT.reset) },
    { label: 'IRQ (natif)', addr: 0xffee, value: full(nativeT.irq) },
  );
  const entries = [];
  for (const v of vectors) if (v.value != null) entries.push({ addr: v.value, label: 'vector ' + v.label });
  entries.push({ addr: isLo ? 0x008000 : 0x000000, label: 'PRG start' });
  info.nativeFallback = nativeFallback;
  return { platform: 'snes', mem, info, entries, coverRanges, vectors };
}

const SNES_MAP_NAMES = { lo: 'LoROM', hi: 'HiROM', exlo: 'ExLoROM', exhi: 'ExHiROM', sa1: 'SA-1', exsa1: 'ExSA-1', sfx: 'SuperFX', mmc: 'SuperMMC' };
const SNES_CART_TYPES = ['ROM', 'ROM+RAM', 'ROM+RAM+BAT', 'ROM+RAM+BAT+0', 'ROM+0', 'ROM+RAM+0', 'ROM+RAM+BAT+0', 'ROM+0'];
const SNES_COUNTRIES = {
  0: 'Japan', 1: 'Japan', 2: 'North America', 3: 'North America', 4: 'Europe', 5: 'Europe',
  6: 'Australia', 7: 'Australia', 8: 'Asia', 9: 'Asia', 0xa: 'International', 0xb: 'International', 0xd: 'Brazil', 0xe: 'Scandinavia',
};

function parseSNESHeader(data, mode, skip, numBlocks, base) {
  // `base` = offset fichier de l'entête étendue ($FFB0/$7FB0), résolu par findSNESHeader.
  // Champs : maker +0x00, game code +0x02, titre +0x10, map +0x25, cart +0x26,
  // rom size +0x27, sram size +0x28, pays +0x29, version +0x2B, complément +0x2C, checksum +0x2E.
  const isLo = mode === 'lo' || mode === 'exlo';
  const b = (i) => (base + i < data.length ? data[base + i] : 0);
  const asc = (o, n) => String.fromCharCode.apply(null, [...data.subarray(base + o, base + o + n)]).replace(/[^\x20-\x7e]/g, ' ').trim();
  const title = asc(0x10, 21);
  const maker = asc(0x00, 2);
  const gameCode = asc(0x02, 4);
  const mapByte = b(0x25);
  const romSizeByte = b(0x27);
  const sramSizeByte = b(0x28);
  const country = b(0x29);
  const version = b(0x2b);
  const checksum = b(0x2e) | (b(0x2f) << 8);
  const compCheck = b(0x2c) | (b(0x2d) << 8);
  let sizeKB = Math.round(data.length / 1024);
  let declaredSize = romSizeByte ? Math.round(Math.pow(2, romSizeByte & 0x0f) * 0x800 / 1024) : 0;
  let sum = 0;
  for (let i = 0; i + 1 < data.length; i += 2) sum = (sum + ((data[i] | (data[i + 1] << 8)) & 0xffff)) & 0xffff;
  const checksumOK = (((checksum + compCheck) & 0xffff) === 0xffff) && (((checksum + sum) & 0xffff) === 0xffff);
  return {
    platform: 'snes', mapping: SNES_MAP_NAMES[mode] || mode.toUpperCase(), mappingMode: mode,
    title, makerCode: maker, gameCode, cartType: SNES_CART_TYPES[b(0x26)] || b(0x26),
    romSizeKB: sizeKB, declaredRomSizeKB: declaredSize, sramSizeKB: sramSizeByte ? Math.pow(2, sramSizeByte) * 1024 : 0,
    country: SNES_COUNTRIES[country] != null ? SNES_COUNTRIES[country] : `region ${country.toString(16).toUpperCase()}`, countryByte: country,
    version, checksum: checksum.toString(16).toUpperCase().padStart(4, '0'), checksumOK,
    mapByte: mapByte.toString(16).toUpperCase().padStart(2, '0'),
    copierHeader: skip > 0,
    mapNote: mode === 'lo' ? 'LoROM: banks $80-$FF, 32 KB half-bank mapped.' :
      mode === 'hi' ? 'HiROM: banks $C0-$FF, full 64 KB banks.' :
      mode === 'exhi' ? 'ExHiROM: extended addressing (>4 MB).' : 'ExLoROM: extended addressing (>4 MB).',
  };
}

// Cherche l'entête ($FFB0/$7FB0) : en priorité la dernière banque, sinon la
// banque 0 (beaucoup de homebrew n'y mettent que la table de la banque 0).
// Retourne le meilleur candidat selon un score (titre, checksum, taille, map byte).
function findSNESHeader(data, mode, numBlocks) {
  const isLo = mode === 'lo' || mode === 'exlo';
  const bankSize = isLo ? 0x8000 : 0x10000;
  const bases = [];
  if (mode === 'exhi') bases.push(0x40ffb0);
  else if (mode === 'exlo') bases.push(0x407fb0);
  else {
    bases.push((numBlocks - 1) * bankSize + (isLo ? 0x7fb0 : 0xffb0));
    bases.push(isLo ? 0x7fb0 : 0xffb0);
  }
  let best = null;
  for (const base of bases) {
    if (base + 0x20 > data.length) continue;
    let letters = 0, bad = false;
    for (let i = 0; i < 21; i++) {
      const c = data[base + 0x10 + i];
      if (c >= 0x41 && c <= 0x7a) letters++;
      if (c !== 0 && (c < 0x20 || c > 0x7e)) bad = true;
    }
    if (bad) continue;
    const b = (i) => (base + i < data.length ? data[base + i] : 0);
    let score = Math.min(letters, 12) * 2;
    if ((b(0x25) & 0x0f) < 4) score += 2;
    const declared = b(0x27) ? Math.pow(2, b(0x27) & 0x0f) * 0x800 : 0;
    if (declared && data.length >= declared * 0.5 && data.length <= declared * 8) score += 2;
    if ((((b(0x2c) | (b(0x2d) << 8)) + (b(0x2e) | (b(0x2f) << 8))) & 0xffff) === 0xffff) score += 2;
    if (score > 4 && (!best || score > best.score)) best = { base, score };
  }
  return best || { base: bases[0], score: 0 };
}

// Map-mode detection porté de DiztinGUIsh (Diz.Core/util/RomUtil.cs) avec scoring snes2asm.
function detectSNESMap(data) {
  const lorom = 0x7fd5, hirom = 0xffd5, exhi = 0x40ffd5;
  const at = (o) => (o < data.length ? data[o] : null);
  const printableTitle = (o) => {
    if (o + 0x15 > data.length) return false;
    let letters = 0;
    for (let i = 0; i < 21; i++) {
      const c = data[o - 0x15 + i];
      if (c >= 0x41 && c <= 0x7a) letters++;
      if (c !== 0 && (c < 0x20 || c > 0x7e)) return false;
    }
    return letters >= 2;
  };
  const snes2asmScore = (base) => {
    let s = 0;
    const b = (i) => (base + i < data.length ? data[base + i] : 0);
    if ((((b(0x2c) | (b(0x2d) << 8)) + (b(0x2e) | (b(0x2f) << 8))) & 0xffff) === 0xffff) s += 2;
    if (b(0x21) === 0x33) s += 2;
    if ((b(0x25) & 0x0f) < 4) s += 2;
    if ((b(0x2b) & 0x80) === 0) s -= 4;
    let letters = 0;
    for (let i = 0; i < 21; i++) {
      const c = b(0x10 + i);
      if (c >= 0x41 && c <= 0x7a) letters++;
    }
    s += Math.min(letters, 15);
    return s;
  };
  const loOK = printableTitle(lorom + 1);
  const hiOK = data.length >= 0x10000 && printableTitle(hirom + 1);
  const loByte = at(lorom), hiByte = at(hirom), exByte = at(exhi);

  // checks DiztinGUIsh (sur la bonne position d'entête)
  if (loOK) {
    if ((loByte & 0xef) === 0x23) return { mode: data.length > 0x400000 ? 'exsa1' : 'sa1', note: 'SA-1' };
    if ((loByte & 0xec) === 0x20) {
      const sub = at(lorom + 1);
      if ((sub & 0xf0) === 0x10) return { mode: 'sfx', note: 'SuperFX' };
      return { mode: 'lo', note: 'LoROM' };
    }
  }
  if (hiOK) {
    if ((hiByte & 0xef) === 0x21) return { mode: 'hi', note: 'HiROM' };
    if ((hiByte & 0xe7) === 0x22) return { mode: 'mmc', note: 'SuperMMC' };
  }
  if (data.length >= 0x410000 && exByte != null && (exByte & 0xef) === 0x25) return { mode: 'exhi', note: 'ExHiROM' };

  // échec : scoring snes2asm LoROM vs HiROM
  if (hiOK && loOK) return snes2asmScore(hirom - 0x25) >= snes2asmScore(lorom - 0x25) ? { mode: 'hi', note: 'HiROM (score)' } : { mode: 'lo', note: 'LoROM (score)' };
  if (hiOK) return { mode: 'hi', note: 'HiROM' };
  return { mode: 'lo', note: 'LoROM (défaut)' };
}

// ---------------- SMS ----------------
function loadSMS(bytes, opts = {}) {
  const hasHeader = bytes.length >= 0x108 && isAscii(bytes, 0x100, 'TMR SEGA');
  const skip = hasHeader ? 512 : 0;
  const data = bytes.subarray(skip);
  const segments = [];
  if (data.length >= 0x2000) segments.push({ start: 0x0000, bytes: data.subarray(0, 0x2000), fileOffset: skip });
  if (data.length >= 0x4000) segments.push({ start: 0x4000, bytes: data.subarray(0x2000, 0x4000), fileOffset: skip + 0x2000 });
  if (data.length >= 0x8000) {
    const bankCount = Math.ceil(data.length / 0x4000);
    const page = Math.min(opts.page8000 || 0, bankCount - 1);
    const off = page * 0x4000;
    if (off !== 0 && off < data.length) segments.push({ start: 0x8000, bytes: data.subarray(off, Math.min(off + 0x4000, data.length)), fileOffset: skip + off });
    else if (off === 0 && data.length >= 0x8000) segments.push({ start: 0x8000, bytes: data.subarray(0x4000, 0x8000), fileOffset: skip + 0x4000 });
  }
  const mem = new MemoryView(segments, { mask: 0xffff, coverRanges: segments.map((s) => [s.start, s.start + s.bytes.length]) });
  const info = {
    platform: 'sms',
    sizeKB: Math.round(data.length / 1024),
    header: hasHeader ? 'Sega header (512 B) detected' : 'no header',
    mapNote: 'Bank 0 ($0000-$3FFF) and bank 1 ($4000-$7FFF) are fixed; the $8000 window is switchable (selector in options).',
  };
  return { platform: 'sms', mem, info, entries: [{ addr: 0x0000, label: 'entry point' }], coverRanges: segments.map((s) => [s.start, s.start + s.bytes.length]), vectors: [] };
}

// ---------------- Genesis ----------------
function loadGenesis(bytes, opts = {}) {
  const mem = new MemoryView([{ start: 0, bytes, fileOffset: 0 }], { mask: 0x7fffff, coverRanges: [[0, bytes.length]] });
  const sp = mem.readWord32BE(0x00);
  const pc = mem.readWord32BE(0x04);
  const header = bytes.length >= 0x150 ? String.fromCharCode.apply(null, [...bytes.subarray(0x100, 0x150)]).replace(/[^\x20-\x7e]/g, '') : '';
  const vectors = [];
  for (let i = 0; i < 0x40; i++) {
    const v = mem.readWord32BE(i * 4);
    if (v == null) break;
    vectors.push({ label: `vector ${(i * 4).toString(16).padStart(2, '0').toUpperCase()}`, addr: i * 4, value: v });
  }
  const info = { platform: 'genesis', sizeKB: Math.round(bytes.length / 1024), header: header.slice(0, 40).trim() };
  return { platform: 'genesis', mem, info, entries: [{ addr: pc, label: 'initial PC (reset vector)' }], coverRanges: [[0, bytes.length]], vectors };
}
