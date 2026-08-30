// snesgfx.js — analyse graphique SNES guidée par le code.
//
// S'inspire (port de concepts, pas de code) de :
//  - DiztinGUIsh : suivi des pointeurs DP/indirects pour retrouver les écritures
//    registres (VADDL/VMDATA, CGRAM, DMA), balayage du code avec suivi M/X.
//  - snes2asm    : scores de plausibilité des régions de tuiles + détection d'entête.
//
// Démarche :
//  1. décode le 65C816 depuis les vecteurs en suivant les sauts/appels, en gardant
//     la largeur M/X (REP/SEP) → marque les octets de code (pour ne pas scanner
//     le code comme des tuiles).
//  2. collecte les valeurs immédiates qui pointent dans la ROM (pointeurs de
//     données style tcc : LDA #lo16 / STA $dp / LDA #bank / STA $dp+2) → points
//     de départ probables des données graphiques.
//  3. suit les écritures indirectes vers les registres PPU/DMA (STA [$dp] avec
//     $dp = pointeur) → uploads DMA, palettes CGRAM, écritures VRAM.
//  4. scanne les régions de tuiles et palettes restantes (code exclu, point de
//     départ prioritaire sur les pointeurs).

import { MODE } from './cpus/65816.js';
import { regionLooksPlausible, scoreRegion } from './extract.js';

const isRomReg = (v) =>
  (v >= 0x2100 && v <= 0x213f) || (v >= 0x4200 && v <= 0x421f) || (v >= 0x4300 && v <= 0x437f);

function cpuToFile(cpuAddr, mode, numBlocks, dataLen) {
  const a = cpuAddr & 0xffffff;
  const bank = a >>> 16;
  const off = a & 0xffff;
  if (mode === 'lo' || mode === 'exlo') {
    const idx = bank >= 0x80 ? (bank - 0x80) % numBlocks : (off >= 0x8000 ? bank % numBlocks : -1);
    if (idx < 0) return null;
    const f = idx * 0x8000 + (off & 0x7fff);
    return f < dataLen ? f : null;
  }
  if (mode === 'hi' || mode === 'exhi') {
    let f = null;
    if (bank >= 0xc0) f = (bank - 0xc0) % numBlocks * 0x10000 + off;
    else if (bank >= 0x80 && bank < 0xc0) f = (bank - 0x80) % numBlocks * 0x10000 + off;
    else if (off >= 0x8000) f = bank % numBlocks * 0x8000 + (off - 0x8000);
    return f != null && f < dataLen ? f : null;
  }
  return null;
}

export function analyzeSNESGraphics(rom, cpu, bytes) {
  const skip = (bytes.length & 0x3ff) === 512 ? 512 : 0;
  const data = bytes.subarray(skip);
  const info = rom.info || {};
  const mode = info.mappingMode || 'lo';
  const isLo = mode === 'lo' || mode === 'exlo';
  const numBlocks = Math.max(1, Math.floor(data.length / (isLo ? 0x8000 : 0x10000)));
  const fileOf = (cpuAddr) => cpuToFile(cpuAddr, mode, numBlocks, data.length);

  // --- 1. balayage du code -------------------------------------------------
  // Parcours strict du graphe de flot (comme DiztinGUIsh) : on ne descend
  // JAMAIS linéairement à travers un saut inconditionnel ou un retour, sinon
  // les tables de données intercalées sont décodées comme du code et faussent
  // la largeur M/X ainsi que le suivi de valeurs.
  const codeBytes = new Uint8Array(data.length);
  const pointers = new Set();
  const writes = [];
  const callSites = [];
  const hdrEnd = Math.max(0, data.length - (isLo ? 0x8000 : 0x10000) + 0x7f00);

  // Pointeurs DP connus globalement (écrits dans une fonction, relus dans une
  // autre) — style tcc : LDA #$4372: STA $18: STZ $1A puis A5 00: STA [$18].
  const dpHints = new Map();

  const starts = [];
  for (const e of rom.entries || []) {
    if (e.addr == null) continue;
    const f = fileOf(e.addr);
    if (f == null || f >= hdrEnd) continue;
    if (!starts.some((s) => fileOf(s) === f)) starts.push(e.addr);
  }

  const seen = new Map();
  const work = starts.map((a) => ({ addr: a & 0xffffff, m: 8, x: 8, entry: a & 0xffffff }));
  const m0 = cpu.opts.m, x0 = cpu.opts.x;
  let guard = 0, insns = 0;
  while (work.length && guard++ < 600000) {
    const item = work.pop();
    let addr = item.addr, m = item.m, x = item.x;
    const entry = item.entry;
    const ctxKey = (m === 16 ? 2 : 0) | (x === 16 ? 8 : 0);
    const localVar = new Map();
    const localPtr = new Map();
    const bankPending = new Map();
    const peaStack = [];
    let aVal = null, yVal = null, steps = 0;
    while (addr != null && steps++ < 500000) {
      const ctx = seen.get(addr);
      if (ctx && ctx.has(ctxKey)) break;
      if (!ctx) seen.set(addr, new Set());
      seen.get(addr).add(ctxKey);
      const sf = fileOf(addr);
      if (sf == null || sf >= hdrEnd) break;
      cpu.opts.m = m; cpu.opts.x = x;
      const ins = cpu.decode(rom.mem, addr);
      if (!ins) break;
      insns++;
      for (let i = 0; i < ins.size && sf + i < data.length; i++) codeBytes[sf + i] = 1;
      const md = ins.mode, mn = ins.mnemonic;

      // --- suivi de la pile (PEA/LDA #imm:PHA → arguments des appels tcc) ---
      if (mn === 'PEA') peaStack.push((ins.bytes[2] << 8) | ins.bytes[1]);
      else if (mn === 'PEI') peaStack.push((localVar.get('d' + ins.bytes[1]) || 0) & 0xffff);
      else if (mn === 'PHA' && aVal != null) peaStack.push(aVal & 0xffff);
      else if (mn === 'PLA') peaStack.pop();
      else if (mn === 'TSC' || mn === 'TCS') peaStack.length = 0;
      if (peaStack.length > 8) peaStack.shift();

      if (mn === 'REP' || mn === 'SEP') {
        const mask = ins.bytes[1];
        if (mask & 0x20) m = mn === 'REP' ? 16 : 8;
        if (mask & 0x10) x = mn === 'REP' ? 16 : 8;
      }

      // --- suivi de valeurs / pointeurs ---
      if (md === MODE.IMM_M || md === MODE.IMM_X || md === MODE.IMM) {
        const imm = (ins.bytes[2] << 8) | ins.bytes[1];
        aVal = md === MODE.IMM ? (ins.bytes[1] & 0xff) : imm;
      } else if (md === MODE.DP && mn === 'LDA') {
        const v = localVar.get('d' + ins.bytes[1]);
        aVal = v != null ? (m === 16 ? (v & 0xffff) : (v & 0xff)) : null;
      } else if ((md === MODE.IDPL || md === MODE.IDP) && mn === 'LDA') {
        // lecture de valeur via pointeur DP : LDA [$dp] / LDA ($dp) sur une
        // donnée en ROM (style tcc : copie d'un struct d'arguments).
        const p = localPtr.get('d' + ins.bytes[1]) || dpHints.get(ins.bytes[1]);
        aVal = null;
        if (p && p.lo != null && p.bank != null) {
          const full = ((p.bank << 16) | (p.lo & 0xffff)) >>> 0;
          const ff = fileOf(full);
          if (ff != null && ff + 2 <= data.length) aVal = data[ff] | (data[ff + 1] << 8);
        }
      } else if ((md === MODE.ABS || md === MODE.ABX || md === MODE.ABY) && mn === 'LDA') {
        aVal = null;
      } else if (mn === 'LDY' && (md === MODE.IMM_X || md === MODE.IMM)) {
        yVal = md === MODE.IMM_X ? ((ins.bytes[2] << 8) | ins.bytes[1]) : (ins.bytes[1] & 0xff);
      } else if (mn === 'INY') yVal = yVal != null ? yVal + 1 : null;
      else if (mn === 'DEY') yVal = yVal != null ? yVal - 1 : null;
      else if (mn === 'TAY') yVal = aVal;

      if (mn === 'STA' && md === MODE.DP && aVal != null) {
        const dp = ins.bytes[1];
        localVar.set('d' + dp, aVal & 0xffff);
        const av = aVal & 0xffff;
        if (av >= 0x100) {
          // lo d'un pointeur (ROM ≥0x8000, registres PPU/DMA 0x2100-0x437f, ...) :
          // la banque peut avoir été posée AVANT (LDA #bank: STA $02 puis LDA #lo: STA $00)
          // — bankPending la mémorise.
          const prev = localPtr.get('d' + dp);
          const bp = bankPending.get('d' + (dp + 2));
          bankPending.delete('d' + dp);
          bankPending.delete('d' + (dp + 2));
          const bank = bp != null ? bp : (prev ? prev.bank : null);
          localPtr.set('d' + dp, { lo: av, bank });
          if (bank != null && av >= 0x8000) {
            const full = ((bank << 16) | (av & 0xffff)) >>> 0;
            const f = fileOf(full);
            if (f != null && f >= 0x8000) {
              pointers.add(f);
              dpHints.set(dp, full);
            }
          }
        } else {
          // valeur de banque (8 bits) stockée : sert à compléter un lo posé ensuite.
          bankPending.set('d' + dp, av & 0xff);
          const prev = localPtr.get('d' + dp);
          localPtr.set('d' + dp, { lo: av, bank: prev ? prev.bank : null });
        }
      } else if (mn === 'STZ' && md === MODE.DP) {
        localVar.set('d' + ins.bytes[1], 0);
      } else if (mn === 'STA' && md === MODE.ABS && aVal != null) {
        const t = (ins.bytes[2] << 8) | ins.bytes[1];
        if (t >= 0x7e00 && t <= 0x7f1f) {
          const key = 'a' + t;
          localVar.set(key, aVal & 0xffff);
          if ((aVal & 0xffff) >= 0x8000) localPtr.set(key, { lo: aVal & 0xffff, bank: null });
        }
      }

      // complétion du pointeur : LDA #bank (8 bits) / STZ sur $dp+2
      if (md === MODE.DP && (mn === 'STA' || mn === 'STZ')) {
        const dp = ins.bytes[1];
        for (const [k, p] of localPtr) {
          if (p.lo != null && p.bank == null && k === 'd' + (dp - 2)) {
            p.bank = mn === 'STZ' ? 0 : (aVal != null ? (aVal & 0xff) : null);
            if (p.bank != null) {
              const full = ((p.bank << 16) | (p.lo & 0xffff)) >>> 0;
              const f = fileOf(full);
              if (f != null && f >= 0x8000) {
                pointers.add(f);
                dpHints.set(parseInt(k.slice(1), 16) & 0xff, full);
              }
            }
          }
        }
      }

      // --- écritures registres (directes) ---
      if (mn === 'STA' && (md === MODE.ABS || md === MODE.ABX || md === MODE.ABY || md === MODE.LONG || md === MODE.LONGX)) {
        const t = md === MODE.LONG || md === MODE.LONGX
          ? ((ins.bytes[3] << 16) | (ins.bytes[2] << 8) | ins.bytes[1])
          : ((ins.bytes[2] << 8) | ins.bytes[1]);
        if (isRomReg(t)) writes.push({ reg: t, value: aVal != null ? aVal & (m === 16 ? 0xffff : 0xff) : null, width: m, via: 'dir', siteCpu: addr, siteFile: sf, fn: entry });
      }

      // --- écritures registres (indirectes via pointeur DP) ---
      if ((mn === 'STA') && (md === MODE.IDPL || md === MODE.IDPY || md === MODE.IDP)) {
        const dp = ins.bytes[1];
        const p = localPtr.get('d' + dp);
        if (p && p.lo != null) {
          let reg = p.lo;
          if (md === MODE.IDPY && yVal != null) reg = (reg + yVal) & 0xffff;
          if (isRomReg(reg)) writes.push({ reg, value: aVal != null ? aVal & (m === 16 ? 0xffff : 0xff) : null, width: m, via: 'ind', siteCpu: addr, siteFile: sf, fn: entry });
        }
      }

      // --- contrôle de flot (strict : pas de glissement à travers les données) ---
      const br = ins.branch;
      let next;
      if (br) {
        if (br.kind === 'call' && br.target != null) {
          const t = br.target & 0xffffff;
          if (peaStack.length) callSites.push({ target: t, args: peaStack.slice(), siteCpu: addr, siteFile: sf, fn: entry });
          work.push({ addr: t, m, x, entry: t });
          next = (addr + ins.size) & 0xffffff;
        }
        else if (br.kind === 'jump' && br.target != null) { work.push({ addr: br.target & 0xffffff, m, x, entry }); next = null; }
        else if (br.kind === 'cond' && br.target != null) { work.push({ addr: br.target & 0xffffff, m, x, entry }); next = (addr + ins.size) & 0xffffff; }
        else if (br.kind === 'ret') next = null;
        else next = (addr + ins.size) & 0xffffff;
      } else {
        next = (addr + ins.size) & 0xffffff;
      }
      addr = next;
    }
  }
  cpu.opts.m = m0; cpu.opts.x = x0;

  // --- 2. synthèse des écritures -------------------------------------------
  const chState = new Map();
  const dmaUploads = [];
  const paletteUploads = [];
  const vramChunks = [];
  let vramAddr = null, vramPending = null, vramPendingHi = null;
  let cgAddr = null, cgPending = null, cgPendingHi = null;
  let cgColors = [];
  let bgMode = null;
  const screen = {};

  const flushCg = (siteFile) => {
    if (!cgColors.length) return;
    const raw = Uint8Array.from(cgColors);
    paletteUploads.push({ srcFile: null, siteFile, len: raw.length, raw, via: 'direct', cgAddr: cgAddr != null ? cgAddr : null });
    cgColors = [];
  };

  for (const w of writes) {
    const reg = w.reg, v = w.value;
    if (reg >= 0x4300 && reg < 0x4380) {
      const ch = Math.floor((reg - 0x4300) / 0x10);
      const sub = reg & 0x0f;
      const st = chState.get(ch) || {};
      if (v != null) {
        if (sub === 0) { st.dmap = v & 0xff; if (w.width === 16) st.bbad = (v >> 8) & 0xff; }
        else if (sub === 1) st.bbad = v & 0xff;
        else if (sub === 2) st.a1tl = v & 0xffff;
        else if (sub === 3) st.a1th = v & 0xff;
        else if (sub === 4) { st.a1b = v & 0xff; if (w.width === 16) st.dasl = (v >> 8) & 0xff; }
        else if (sub === 5) st.dasl = v & 0xffff;
        else if (sub === 6) st.dash = v & 0xff;
      }
      chState.set(ch, st);
    } else if (reg === 0x420b && v != null) {
      const mask = v & 0xff;
      for (let ch = 0; ch < 8; ch++) {
        if (!(mask & (1 << ch))) continue;
        const st = chState.get(ch) || {};
        const srcCpu = st.a1tl != null || st.a1b != null ? (st.a1b != null ? ((st.a1b << 16) | (st.a1tl || 0)) : (st.a1tl || 0)) : null;
        const len = st.dasl != null && st.dash != null ? ((st.dash << 16) | st.dasl) : (st.dasl != null ? st.dasl : null);
        const rec = {
          ch, srcCpu, srcFile: srcCpu != null ? fileOf(srcCpu) : null, len,
          dest: st.bbad != null ? st.bbad : null, dmap: st.dmap != null ? st.dmap : null,
          siteCpu: w.siteCpu, siteFile: w.siteFile,
        };
        if (rec.dest === 0x22 || rec.dest === 0x2122) paletteUploads.push({ srcFile: rec.srcFile, len, siteFile: rec.siteFile, via: 'dma' });
        else dmaUploads.push(rec);
        chState.set(ch, {});
      }
    } else if (reg === 0x2116 || reg === 0x2117) {
      if (v != null) {
        if (w.width === 16) vramAddr = reg === 0x2116 ? (v & 0xffff) : (((v & 0xff) << 16) | (vramAddr != null ? vramAddr & 0xffff : 0));
        else if (reg === 0x2116) {
          if (vramPending == null) vramPending = v & 0xff;
          else { vramAddr = ((vramAddr != null ? vramAddr & 0xff0000 : 0)) | (v << 8) | vramPending; vramPending = null; }
        } else {
          if (vramPendingHi == null) vramPendingHi = v & 0xff;
          else { vramAddr = (vramAddr != null ? vramAddr & 0xffff : 0) | ((v << 8) | vramPendingHi) << 16; vramPendingHi = null; }
        }
      } else vramAddr = null;
    } else if (reg === 0x2118 || reg === 0x2119) {
      if (v != null && vramAddr != null) {
        vramChunks.push({ addr: vramAddr, value: v, width: w.width, siteCpu: w.siteCpu, siteFile: w.siteFile });
        vramAddr = (vramAddr + 1) & 0xffff;
      }
    } else if (reg === 0x2121 || reg === 0x2122) {
      if (reg === 0x2121) {
        flushCg(w.siteFile);
        if (v != null) cgAddr = v & 0x1ff;
      } else if (v != null) {
        if (w.width === 16) {
          cgColors.push((v >> 8) & 0xff, v & 0xff);
          if (cgColors.length >= 32) flushCg(w.siteFile);
        } else {
          if (cgPending == null) cgPending = v & 0xff;
          else { cgColors.push(cgPending, v & 0xff); cgPending = null; if (cgColors.length >= 32) flushCg(w.siteFile); }
        }
      }
    } else if (reg === 0x2105 && v != null) bgMode = v & 7;
    else if (reg >= 0x2107 && reg <= 0x210c && v != null) screen['reg' + reg.toString(16).toUpperCase()] = v & 0xff;
  }
  flushCg(null);

  // routines connues pour écrire CGRAM (CGADDR/CGDATA) : un appel vers elles
  // avec dest < 0x8000 = mise à jour de palette (dest = adresse CGRAM, pas $22).
  const cgWriters = new Set();
  for (const w of writes) if (w.reg === 0x2121 || w.reg === 0x2122) if (w.fn != null) cgWriters.add(w.fn);

  // --- 2b. uploads dérivés des sites d'appel (PEA imm × 4 avant JSL) ------
  // Quand la routine DMA lit ses arguments dans une structure passée sur la
  // pile (LDA [$dp] avec $dp → zone de pile), le balayage ne résout pas A1T/DAS.
  // Le push des PEA donne directement [dest, src_lo, banque, taille] (l'ordre
  // de push est inverse des arguments C). On valide chaque site d'appel.
  //
  // Cas particulier (5 arguments) : copie ROM → WRAM style tcc
  //   copy_mem(dst, src, size) → push [size, srcBank, srcLo, dstBank, dstLo]
  // avec dstBank == 0x7E (WRAM). La donnée graphique vit alors en ROM mais le
  // DMA vers la VRAM se fait depuis le buffer WRAM (invisible pour le balayage
  // registres). On sème quand même l'adresse ROM pour le scan de tuiles.
  const callUploads = [];
  const wramCopies = [];
  const callSeen = new Set();
  for (const c of callSites) {
    const all = c.args;
    if (all.length === 5) {
      const [dstLo, dstBank, srcLo, srcBank, size] = all.slice().reverse();
      if (dstBank === 0x7e && srcBank <= 0x7f && size >= 32 && size <= 0x40000) {
        const srcCpu = ((srcBank << 16) | (srcLo & 0xffff)) >>> 0;
        const srcFile = fileOf(srcCpu);
        if (srcFile != null && srcFile + size <= data.length) {
          wramCopies.push({ srcCpu, srcFile, len: size, dstCpu: ((dstBank << 16) | dstLo) >>> 0, siteCpu: c.siteCpu, siteFile: c.siteFile, fn: c.target });
        }
      }
      continue;
    }
    const args = all.slice(-4).reverse();
    if (args.length !== 4) continue;
    const isPalTarget = cgWriters.has(c.target);
    let parsed = null;
    // ordre copy_to_vram : [dest, srcLo, banque, taille]
    {
      const [dest, srcLo, bank, size] = args;
      if (bank <= 0x7f && srcLo >= 0x8000 && size >= 32 && size <= 0x40000) parsed = { dest, srcLo, bank, size };
    }
    // ordre set_palette : [dest, taille, srcLo, banque] (dest = adresse CGRAM)
    if (parsed == null && isPalTarget) {
      const [dest, size, srcLo, bank] = args;
      if (bank <= 0x7f && srcLo >= 0x8000 && size >= 32 && size <= 0x40000) parsed = { dest, srcLo, bank, size };
    }
    if (parsed == null) continue;
    const { dest, srcLo, bank, size } = parsed;
    const isPal = dest === 0x22 || dest === 0x2122 || isPalTarget;
    if (!isPal && dest >= 0x8000) continue;
    const srcCpu = ((bank << 16) | srcLo) >>> 0;
    const srcFile = fileOf(srcCpu);
    if (srcFile == null || srcFile + size > data.length) continue;
    if (isPal) {
      let ok = true;
      for (let i = 0; i + 2 <= size && i < 32; i += 2) {
        if ((data[srcFile + i] | (data[srcFile + i + 1] << 8)) >= 0x8000) { ok = false; break; }
      }
      if (!ok) continue;
    } else if (!regionLooksPlausible(data, srcFile, 32)) {
      continue;
    }
    const key = srcFile + ':' + size + ':' + dest;
    if (callSeen.has(key)) continue;
    callSeen.add(key);
    if (isPal) paletteUploads.push({ srcFile, len: size, siteFile: c.siteFile, via: 'call' });
    else callUploads.push({ ch: null, srcCpu, srcFile, len: size, dest, dmap: null, via: 'call', siteCpu: c.siteCpu, siteFile: c.siteFile, fn: c.target });
  }
  for (const u of callUploads) {
    if (dmaUploads.some((d) => d.srcFile === u.srcFile && d.len === u.len && d.dest === u.dest)) continue;
    dmaUploads.push(u);
  }

  // --- 3. régions de tuiles (code exclu, seed = pointeurs + DMA) ----------
  const sizes = [{ bpp: 2, tileSize: 16 }, { bpp: 4, tileSize: 32 }, { bpp: 8, tileSize: 64 }];
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

  // prior par type de graine : un upload DMA / une copie vers WRAM sont des
  // faits confirmés par le code (40) ; un pointeur DP est plus heuristique
  // (25), avec pénalité s'il est décalé de la graine (les artefacts de
  // banque WRAM type 0x1807E ne doivent pas gagner face au vrai 0x18000).
  const seeds = [];
  const seedPrior = new Map();
  for (const p of pointers) { seeds.push(p); seedPrior.set(p, 25); }
  for (const u of dmaUploads) if (u.srcFile != null) { seeds.push(u.srcFile); seedPrior.set(u.srcFile, 40); }
  for (const p of paletteUploads) if (p.srcFile != null) { seeds.push(p.srcFile); seedPrior.set(p.srcFile, 40); }
  for (const w of wramCopies) if (w.srcFile != null) { seeds.push(w.srcFile); seedPrior.set(w.srcFile, 40); }

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
    // deux régions sont en conflit si leurs emprises (256 tuiles) se chevauchent
    // de plus de la moitié de la plus petite — sinon les vues 2bpp décalées d'un
    // même bloc de données inondent la sélection.
    if (picked.some((p) => Math.abs(p.off - c.off) < 0.5 * 256 * Math.min(p.tileSize, c.tileSize))) continue;
    picked.push(c);
    if (picked.length >= 24) break;
  }

  // --- 4. palettes (code exclu, seed = pointeurs + CGRAM) ------------------
  const palCands = [];
  const palSeeds = new Set(seeds);
  const palTried = new Set();
  const palScore = (off) => {
    let ok = true;
    const ws = [];
    for (let i = 0; i < 16; i++) {
      const w = data[off + i * 2] | (data[off + i * 2 + 1] << 8);
      if (w >= 0x8000) { ok = false; break; }
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
    } else addPal(p.srcFile != null ? p.srcFile : 0, 0);
  }
  for (const o of palSeeds) addPal(o, 12);
  for (let off = 0; off + 32 <= data.length; off += 2) addPal(off, 0);
  palCands.sort((a, b) => b.score - a.score);
  const palPicked = [];
  const palSim = (a, b) => {
    let same = 0;
    for (let i = 0; i < 32; i++) if (a.raw[i] === b.raw[i]) same++;
    return same / 32;
  };
  for (const c of palCands) {
    // les vraies palettes sont ≥ 32 octets ; les fenêtres décalées du scan
    // (±2 à ±14) sont quasi identiques → on dédoublonne au contenu, pas à la
    // distance seule (deux palettes à 32 octets l'une de l'autre sont valides).
    if (palPicked.some((p) => Math.abs(p.off - c.off) < 16 && palSim(p, c) > 0.6)) continue;
    palPicked.push(c);
    if (palPicked.length >= 16) break;
  }

  // --- 5. regroupement des écritures VRAM directes ------------------------
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

  return {
    skip, mode, codeBytes, pointers: [...pointers], writes, dmaUploads, paletteUploads,
    vramChunks, vramGroups, regionCands: picked, palettes: palPicked, bgMode, screen, vramAddr,
    wramCopies, callSites,
    stats: { codeCovered: codeBytes.reduce((a, b) => a + b, 0), insns, dmaCount: dmaUploads.length, ptrCount: pointers.size },
  };
}

// Choix du bpp le plus plausible pour une zone connue (upload DMA, région
// scannée). La plausibilité se score sur le nombre réel de tuiles (les uploads
// courts ne font pas 256 tuiles). Les statistiques par région ne PEUVENT PAS
// distinguer 2bpp/4bpp : une vue 2bpp d'une donnée 4bpp est toujours plausible
// (chaque moitié de tuile contient de l'encre). On tranche donc avec le
// contexte matériel : le mode d'affichage (mode 0 → 2bpp, mode 7 → 8bpp,
// sinon 4bpp, la norme SNES). Limite connue : une donnée réellement 8bpp dans
// un jeu en mode 3 est décodée en 4bpp (plans 0-3).
export function pickBpp(data, off, len, bgMode) {
  const opts = [{ bpp: 2, tileSize: 16 }, { bpp: 4, tileSize: 32 }, { bpp: 8, tileSize: 64 }];
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
  if (!plausible.length) return 4;
  if (bgMode != null) {
    const want = bgMode === 0 ? 2 : bgMode >= 6 ? 8 : 4;
    if (plausible.includes(want)) return want;
  }
  if (plausible.includes(4)) return 4;
  return plausible[0];
}
