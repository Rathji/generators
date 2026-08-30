// genesisgfx.js — analyse graphique Mega Drive / Genesis guidée par le code 68000.
//
// Porte les concepts de sega2asm (annotateur VDP : décode des `move.w/move.l #imm`
// vers $C00004 → registres VDP, commandes d'adresse VRAM/CRAM, DMA) en un
// analyseur automatique qui retrouve, à partir du code, où vivent les données
// graphiques dans la ROM :
//   1. parcourt le 68000 depuis les vecteurs en suivant les sauts/appels ;
//   2. intercepte les écritures vers le port de contrôle VDP ($C00004) :
//      registres (0x13-0x17 = DMA, 0x02/0x04/0x05 = plans/sprites, 0x0F = inc),
//      commandes d'adresse VRAM/CRAM/VSRAM, écritures `move.l #imm` (2 mots) ;
//   3. détecte les DMA 68k → VRAM/CRAM (source + longueur + destination) → ce
//      sont des régions de tuiles / palettes SÛRES dans la ROM ;
//   4. capture les palettes écrites en direct (port données $C00000 en mode CRAM)
//      et les données VRAM écrites en direct ;
//   5. scanne le reste (code exclu) avec des scores de plausibilité, les graines
//      étant les sources DMA et les pointeurs chargés par le code.

import { regionLooksPlausible, scoreRegion } from './extract.js';

const isVdpPort = (hex) => {
  const v = parseInt(hex, 16);
  if (v == null || isNaN(v)) return null;
  if ((v & 0xffff00) !== 0xc00000) return null;
  const lo = v & 0xff;
  if (lo === 0x04 || lo === 0x06) return 'ctrl';
  if (lo === 0x00 || lo === 0x02) return 'data';
  return null;
};

export function analyzeGenesisGraphics(rom, cpu, bytes) {
  const data = bytes;
  const fileOf = (a) => {
    a = a >>> 0;
    if (a < data.length) return a;
    if (a >= 0x800000 && a - 0x800000 < data.length) return a - 0x800000;
    return null;
  };

  const codeBytes = new Uint8Array(data.length);
  const pointers = new Set();
  const regWrites = [];
  const dmaUploads = [];
  const paletteUploads = [];
  const vramChunks = [];
  const cramPalettes = [];
  const callSites = [];

  // ---- regexes sur le texte de désassemblage (comme sega2asm) ----
  const re = {
    lea: /^lea\s+\$([0-9a-f]{1,8})\.l\s*,\s*A([0-7])$/i,
    movea: /^movea\.(?:w|l)\s+#\$([0-9a-f]{1,8})\s*,\s*A([0-7])$/i,
    movewImm: /^move\.w\s+#\$([0-9a-f]{1,4})\s*,\s*\$?([0-9a-f]{1,8})\.l$/i,
    movelImm: /^move\.l\s+#\$([0-9a-f]{1,8})\s*,\s*\$?([0-9a-f]{1,8})\.l$/i,
    movewImmAn: /^move\.w\s+#\$([0-9a-f]{1,4})\s*,\s*\(A([0-7])\)(?:\+)?$/i,
    movelImmAn: /^move\.l\s+#\$([0-9a-f]{1,8})\s*,\s*\(A([0-7])\)(?:\+)?$/i,
    movewDAn: /^move\.w\s+D([0-7])\s*,\s*\(A([0-7])\)(?:\+)?$/i,
    movelDAn: /^move\.l\s+D([0-7])\s*,\s*\(A([0-7])\)(?:\+)?$/i,
    movewDAbs: /^move\.w\s+D([0-7])\s*,\s*\$?([0-9a-f]{1,8})\.l$/i,
    moveq: /^moveq\s+#\$([0-9a-f]{1,2}),\s*D([0-7])$/i,
    movewD: /^move\.w\s+#\$([0-9a-f]{1,4})\s*,\s*D([0-7])$/i,
    movelD: /^move\.l\s+#\$([0-9a-f]{1,8})\s*,\s*D([0-7])$/i,
  };

  // ---- état VDP (global : faits du matériel) ----
  const vdpRegs = new Array(24).fill(null);
  let autoInc = 2;

  const handleCtrlWord = (w, siteFile, siteCpu) => {
    w &= 0xffff;
    if ((w >> 14) === 2) {
      const reg = (w >> 8) & 0x1f;
      const val = w & 0xff;
      vdpRegs[reg] = val;
      regWrites.push({ reg, val, siteFile, siteCpu });
      if (reg === 15 && val !== 0) autoInc = val;
      return null;
    }
    return w;
  };

  // le pending commande d'adresse est local à chaque parcours linéaire
  // (évite la corruption entre fonctions entrelacées par la pile de parcours).
  const drainDma = (cd, addr) => {
    const dmaReady = [19, 20, 21, 22, 23].every((r) => vdpRegs[r] != null);
    if (!dmaReady) return null;
    const dmaType = (vdpRegs[23] >> 6) & 3;
    if (dmaType > 1) return null; // fill (2) ou copie VRAM (3) : pas de source ROM
    const isWrite = cd === 1 || cd === 3 || cd === 5 || cd === 0x21 || cd === 0x23 || cd === 0x25;
    if (!isWrite) return null;
    const src = ((vdpRegs[23] & 0x7f) << 17) | (vdpRegs[22] << 9) | (vdpRegs[21] << 1);
    const words = (((vdpRegs[20] << 8) | vdpRegs[19]) + 1) & 0xffff; // compteur mots, base 1
    const len = words * 2;
    const kind = cd === 3 || cd === 0x23 ? 'cram' : cd === 5 || cd === 0x25 ? 'vsram' : 'vram';
    for (const r of [19, 20, 21, 22, 23]) vdpRegs[r] = null;
    return { src, len, dest: addr, kind };
  };

  const starts = [];
  for (const e of rom.entries || []) if (e.addr != null) starts.push(e.addr >>> 0);
  for (const v of rom.vectors || []) {
    if (v.value != null && v.value !== 0 && v.value < 0x400000 && fileOf(v.value) != null) starts.push(v.value >>> 0);
  }

  const seen = new Set();
  const work = starts.map((a) => ({ addr: a }));
  let guard = 0, insns = 0;
  while (work.length && guard++ < 600000) {
    const item = work.pop();
    let addr = item.addr >>> 0;
    const dReg = new Array(8).fill(null);
    const aPort = new Array(8).fill(null);
    let vdpCmdLo = null, vdpCmdHi = null;
    let vramMode = null, vramAddr = null, cramAddr = null;
    let cramBuf = [];
    let steps = 0;
    const flushCram = () => {
      if (!cramBuf.length) return;
      cramPalettes.push({ raw: Uint8Array.from(cramBuf), addr: cramAddr, siteFile: item.siteFile });
      cramBuf = [];
    };
    while (addr != null && steps++ < 500000) {
      if (seen.has(addr)) break;
      seen.add(addr);
      const sf = fileOf(addr);
      if (sf == null) break;
      const ins = cpu.decode(rom.mem, addr);
      if (!ins) break;
      insns++;
      for (let i = 0; i < ins.size && sf + i < data.length; i++) codeBytes[sf + i] = 1;
      const t = ins.text;
      const site = { siteFile: sf, siteCpu: addr };

      // --- pointeurs de données chargés par le code (graines de scan) ---
      let m;
      if ((m = re.lea.exec(t))) {
        const target = parseInt(m[1], 16);
        if (target >= 0x100 && target < 0x400000 && fileOf(target) != null) pointers.add(target);
        const port = isVdpPort(m[1]);
        if (port) aPort[parseInt(m[2], 10)] = port;
      } else if ((m = re.movea.exec(t))) {
        const target = parseInt(m[1], 16);
        if (target >= 0x100 && target < 0x400000 && fileOf(target) != null) pointers.add(target);
        if (target < 0x10000) { const port = isVdpPort(target.toString(16).padStart(8, '0')); if (port) aPort[parseInt(m[2], 10)] = port; }
      } else if ((m = re.moveq.exec(t))) {
        const v = parseInt(m[1], 16) & 0xff;
        dReg[parseInt(m[2], 10)] = v & 0x80 ? (v | 0xffffff00) : v;
      } else if ((m = re.movewD.exec(t))) {
        dReg[parseInt(m[2], 10)] = parseInt(m[1], 16) & 0xffff;
      } else if ((m = re.movelD.exec(t))) {
        const v = parseInt(m[1], 16);
        dReg[parseInt(m[2], 10)] = v;
        if (v >= 0x100 && v < 0x400000 && fileOf(v) != null) pointers.add(v);
      }

      // --- écritures vers le VDP ---
      const ctrlTo = (w) => {
        const res = handleCtrlWord(w, sf, addr);
        if (res == null) return;
        if (vdpCmdLo == null) { vdpCmdLo = res; return; }
        vdpCmdHi = res;
        const lo = vdpCmdLo, hi = vdpCmdHi;
        vdpCmdLo = vdpCmdHi = null;
        const cd = (((hi >> 4) & 0xf) << 2) | ((lo >> 14) & 3);
        const cmdAddr = (lo & 0x3fff) | ((hi & 3) << 14);
        const dma = drainDma(cd, cmdAddr);
        if (dma) {
          const srcFile = fileOf(dma.src);
          if (srcFile != null && srcFile + dma.len <= data.length) {
            const rec = { srcFile, len: dma.len, via: 'dma', kind: dma.kind, siteFile: sf, siteCpu: addr };
            if (dma.kind === 'cram') paletteUploads.push(rec);
            else dmaUploads.push({ ...rec, dest: dma.dest });
          }
          vramMode = null;
          return;
        }
        if (cd === 0x20 || cd === 0x30) { vramMode = null; return; } // DMA fill / copie VRAM
        if (cd === 1) { vramMode = 'vram'; vramAddr = cmdAddr; flushCram(); }
        else if (cd === 3) { vramMode = 'cram'; cramAddr = cmdAddr & 0x3f; flushCram(); }
        else if (cd === 5) { vramMode = 'vsram'; }
        else vramMode = null; // lectures
      };
      const dataTo = (w) => {
        w &= 0xffff;
        if (vramMode === 'vram' && vramAddr != null) {
          vramChunks.push({ addr: vramAddr, value: w, siteFile: sf, siteCpu: addr });
          vramAddr = (vramAddr + autoInc) & 0x7fff;
        } else if (vramMode === 'cram') {
          cramBuf.push((w >> 8) & 0xff, w & 0xff);
          if (cramBuf.length >= 64) flushCram();
        }
      };

      if ((m = re.movewImm.exec(t))) {
        const port = isVdpPort(m[2]);
        if (port === 'ctrl') ctrlTo(parseInt(m[1], 16));
        else if (port === 'data') dataTo(parseInt(m[1], 16));
      } else if ((m = re.movelImm.exec(t))) {
        const v = parseInt(m[1], 16);
        const port = isVdpPort(m[2]);
        if (port === 'ctrl') { ctrlTo(v >>> 16); ctrlTo(v & 0xffff); }
        else if (port === 'data') { dataTo(v >>> 16); dataTo(v & 0xffff); }
      } else if ((m = re.movewImmAn.exec(t))) {
        const an = parseInt(m[2], 10);
        if (aPort[an] === 'ctrl') ctrlTo(parseInt(m[1], 16));
        else if (aPort[an] === 'data') dataTo(parseInt(m[1], 16));
      } else if ((m = re.movelImmAn.exec(t))) {
        const an = parseInt(m[2], 10);
        if (aPort[an] === 'ctrl') { const v = parseInt(m[1], 16); ctrlTo(v >>> 16); ctrlTo(v & 0xffff); }
        else if (aPort[an] === 'data') { const v = parseInt(m[1], 16); dataTo(v >>> 16); dataTo(v & 0xffff); }
      } else if ((m = re.movewDAn.exec(t))) {
        const an = parseInt(m[2], 10), dn = parseInt(m[1], 10);
        if (dReg[dn] == null) { /* inconnu */ }
        else if (aPort[an] === 'ctrl') ctrlTo(dReg[dn] & 0xffff);
        else if (aPort[an] === 'data') dataTo(dReg[dn] & 0xffff);
      } else if ((m = re.movelDAn.exec(t))) {
        const an = parseInt(m[2], 10), dn = parseInt(m[1], 10);
        if (dReg[dn] == null) { /* inconnu */ }
        else if (aPort[an] === 'ctrl') { ctrlTo((dReg[dn] >>> 16) & 0xffff); ctrlTo(dReg[dn] & 0xffff); }
        else if (aPort[an] === 'data') { dataTo((dReg[dn] >>> 16) & 0xffff); dataTo(dReg[dn] & 0xffff); }
      } else if ((m = re.movewDAbs.exec(t))) {
        const dn = parseInt(m[1], 10);
        const port = isVdpPort(m[2]);
        if (dReg[dn] != null && port === 'ctrl') ctrlTo(dReg[dn] & 0xffff);
        else if (dReg[dn] != null && port === 'data') dataTo(dReg[dn] & 0xffff);
      }

      // --- contrôle de flot (strict : pas de glissement dans les données) ---
      const br = ins.branch;
      let next = null;
      if (br) {
        if (br.kind === 'call') {
          if (br.target != null) {
            work.push({ addr: br.target >>> 0 });
            callSites.push({ target: br.target >>> 0, siteFile: sf, siteCpu: addr });
          }
          next = (addr + ins.size) >>> 0;
        } else if (br.kind === 'jump') {
          if (br.target != null) work.push({ addr: br.target >>> 0 });
          next = null;
        } else if (br.kind === 'cond') {
          if (br.target != null) work.push({ addr: br.target >>> 0 });
          next = (addr + ins.size) >>> 0;
        } else { // ret, trap inconnu
          next = br.fallthrough ? (addr + ins.size) >>> 0 : null;
        }
      } else {
        next = (addr + ins.size) >>> 0;
      }
      addr = next;
    }
    flushCram();
  }

  // ---- régions de tuiles (code exclu, seed = DMA + pointeurs) ----
  const sizes = [{ bpp: 4, tileSize: 32 }, { bpp: 8, tileSize: 64 }];
  const codeRatio = (off, len) => {
    if (len <= 0) return 0;
    let c = 0;
    const end = Math.min(off + len, data.length);
    for (let i = off; i < end; i++) c += codeBytes[i];
    return c / (end - off);
  };
  const regionCands = [];
  const tried = new Set();
  const consider = (off, s, source, prior = 0) => {
    if (off == null || off < 0 || off + 256 * s.tileSize > data.length) return;
    const key = off + ':' + s.bpp;
    if (tried.has(key)) return;
    tried.add(key);
    if (codeRatio(off, 256 * s.tileSize) > 0.05) return;
    if (!regionLooksPlausible(data, off, s.tileSize)) return;
    const sc = scoreRegion(data, off, s.tileSize);
    if (!sc.ok) return;
    regionCands.push({ off, bpp: s.bpp, tileSize: s.tileSize, score: sc.score + prior, source });
  };
  const seeds = [];
  const seedPrior = new Map();
  for (const p of pointers) { seeds.push(p); seedPrior.set(p, 25); }
  for (const u of dmaUploads) if (u.srcFile != null) { seeds.push(u.srcFile); seedPrior.set(u.srcFile, 40); }
  for (const p of paletteUploads) if (p.srcFile != null) { seeds.push(p.srcFile); seedPrior.set(p.srcFile, 40); }
  for (const o of seeds) {
    const base = seedPrior.get(o) || 20;
    for (const s of sizes) {
      const a = o - (o % s.tileSize);
      consider(a, s, 'ref', Math.abs(o - a) === 0 ? base : base - 15);
      consider(a + s.tileSize, s, 'ref', base - 15);
      consider(o, s, 'ref', base);
    }
  }
  for (const s of sizes) {
    for (let off = 0; off + 256 * s.tileSize <= data.length; off += s.tileSize) consider(off, s, 'scan');
  }
  regionCands.sort((a, b) => b.score - a.score);
  const picked = [];
  for (const c of regionCands) {
    if (picked.some((p) => Math.abs(p.off - c.off) < 0.5 * 256 * Math.min(p.tileSize, c.tileSize))) continue;
    picked.push(c);
    if (picked.length >= 24) break;
  }

  // ---- palettes candidates (code exclu, seed = DMA CRAM + pointeurs) ----
  const palCands = [];
  const palTried = new Set();
  const palScore = (off) => {
    let ok = true;
    const ws = [];
    for (let i = 0; i < 16; i++) {
      const w = (data[off + i * 2] << 8) | data[off + i * 2 + 1];
      if (w > 0x0fff) { ok = false; break; }
      ws.push(w);
    }
    if (!ok) return null;
    const distinct = new Set(ws);
    if (distinct.size < 4) return null;
    return distinct.size * 3 + 8;
  };
  const addPal = (off, extra) => {
    if (off == null || off < 0 || off + 32 > data.length) return;
    if (palTried.has(off)) return;
    palTried.add(off);
    if (codeRatio(off, 32) > 0.2) return;
    const base = palScore(off);
    if (base == null) return;
    palCands.push({ off, raw: data.slice(off, off + 32), score: base + (extra || 0) });
  };
  for (const p of paletteUploads) {
    if (p.srcFile != null) {
      const len = p.len || 32;
      for (let o = 0; o < len && p.srcFile + o + 32 <= data.length; o += 2) addPal(p.srcFile + o, 30);
    }
  }
  for (const o of seeds) addPal(o, 12);
  for (let off = 0; off + 32 <= data.length; off += 2) addPal(off, 0);
  palCands.sort((a, b) => b.score - a.score);
  const palPicked = [];
  const palSim = (a, b) => {
    let same = 0;
    for (let i = 0; i < 32; i++) if (a.raw[i] === b.raw[i]) same++;
    return same / 32;
  };
  for (const c of palCands) {
    if (palPicked.some((p) => Math.abs(p.off - c.off) < 16 && palSim(p, c) > 0.6)) continue;
    palPicked.push(c);
    if (palPicked.length >= 16) break;
  }

  // ---- regroupement des écritures VRAM directes ----
  const vramGroups = [];
  for (const c of vramChunks) {
    const g = vramGroups[vramGroups.length - 1];
    if (g && Math.abs(g.siteFile - c.siteFile) < 8 && Math.abs(g.addrEnd - c.addr) < 64) {
      g.addrEnd = c.addr + 1;
      g.siteEnd = c.siteFile;
      g.count++;
      g.bytes.push(c.value & 0xff, (c.value >> 8) & 0xff);
    } else {
      vramGroups.push({ addr: c.addr, addrEnd: c.addr + 1, siteFile: c.siteFile, siteEnd: c.siteFile, count: 1, bytes: [c.value & 0xff, (c.value >> 8) & 0xff] });
    }
  }

  const planInfo = {
    reg: Object.fromEntries(regWrites.map((r) => [r.reg, r.val])),
    planeA: vdpRegs[2] != null ? (vdpRegs[2] & 0x38) << 10 : null,
    planeB: vdpRegs[4] != null ? (vdpRegs[4] & 0x07) << 13 : null,
    sprites: vdpRegs[5] != null ? (vdpRegs[5] & 0x7f) << 9 : null,
  };

  return {
    codeBytes, pointers: [...pointers], regWrites, dmaUploads, paletteUploads,
    vramChunks, vramGroups, cramPalettes, regionCands: picked, palettes: palPicked,
    callSites, planInfo,
    stats: { codeCovered: codeBytes.reduce((a, b) => a + b, 0), insns, dmaCount: dmaUploads.length, ptrCount: pointers.size },
  };
}

// Choix du bpp : la quasi-totalité des jeux Genesis est en 4bpp (32 o/tuile) ;
// certains utilisent le mode 8bpp (64 o/tuile). On ne garde 8bpp que si le 4bpp
// n'est pas plausible (les statistiques 4bpp d'une donnée 8bpp sont mauvaises :
// chaque « tuile » 4bpp contient peu d'encre).
export function pickBppGen(data, off, len) {
  const opts = [{ bpp: 4, tileSize: 32 }, { bpp: 8, tileSize: 64 }];
  const plausible = [];
  for (const s of opts) {
    const n = Math.floor(len / s.tileSize);
    if (n < 4) continue;
    let nonEmpty = 0, textured = 0;
    for (let t = 0; t < n; t++) {
      const o = off + t * s.tileSize;
      let nz = 0;
      const vals = new Set();
      for (let i = 0; i < s.tileSize; i++) {
        const v = data[o + i];
        if (v) nz++;
        if (vals.size < 32) vals.add(v);
      }
      if (nz > 0) nonEmpty++;
      if (vals.size >= 2 && nz >= Math.ceil(s.tileSize / 2)) textured++;
    }
    if (nonEmpty < Math.max(4, Math.floor(n * 0.5))) continue;
    if (textured < Math.max(2, Math.floor(n * 0.1))) continue;
    plausible.push(s.bpp);
  }
  if (plausible.includes(4)) return 4;
  if (plausible.length) return plausible[0];
  return 4;
}
