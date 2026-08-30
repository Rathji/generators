// main.js — glue : chargement automatique, analyse complète de la ROM,
// vue d'ensemble, désassemblage, décompilation pseudo-C et export du code.

import { PLATFORMS, detectPlatform, loadRom } from './loaders.js';
import { scan } from './analyze.js';
import { decompile } from './decompile.js';
import { applyHwSymbols, symbolNames } from './symbols.js';
import { cpu as c6502 } from './cpus/6502.js';
import { cpu as c65816 } from './cpus/65816.js';
import { cpu as cz80 } from './cpus/z80.js';
import { cpu as c68000 } from './cpus/68000.js';
import { extractAssets, paletteColors, defaultPaletteColors } from './extract.js';
import { analyzeSNESGraphics } from './snesgfx.js';
import { analyzeGenesisGraphics } from './genesisgfx.js';
import { decodeMap, buildScene, findPlaneMaps, autoBuildScene, colorsFor } from './scene.js';

const CPUS = { nes: c6502, snes: c65816, sms: cz80, genesis: c68000 };

let rawBytes = null;
let rom = null;
let curPlatform = 'nes';
let scanResult = null;
let decompResult = null;
let curEntry = null;
let shown = 0;
let fileName = 'rom';
const PAGE = 15000;

let assets = null;
let selTile = null;
let composer = [];

const $ = (id) => document.getElementById(id);

function setStatus(msg, err) {
  $('statusCtn').textContent = msg;
  $('statusCtn').style.color = err ? '#e06666' : '#9ad0a2';
}

function fmtBytes(ins) {
  const b = ins.bytes;
  if (b.length <= 4) return [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).join(' ');
  return [...b].map((x) => x.toString(16).toUpperCase().padStart(2, '0')).slice(0, 4).join(' ') + ' …';
}

function renderInfo() {
  const info = rom.info;
  const parts = [];
  parts.push(`<b>${PLATFORMS[rom.platform]}</b>`);
  const kb = info.romSizeKB || info.sizeKB;
  parts.push(`— ${kb ? kb + ' Ko' : ''}`);
  if (info.title) parts.push(`— « ${info.title} »`);
  if (info.mapping) parts.push(`— ${info.mapping}`);
  if (info.mapper != null) parts.push(`— mapper ${info.mapper}`);
  if (info.prgBanks != null) parts.push(`— PRG ${info.prgBanks}×16Ko · CHR ${info.chrBanks}×8Ko`);
  if (info.mirror) parts.push(`— miroir ${info.mirror}`);
  if (info.mapNote) parts.push(`<div class="note">${info.mapNote}</div>`);
  if (info.header) parts.push(`— ${info.header}`);
  $('infoCtn').innerHTML = parts.join(' ');

  const vec = rom.vectors || [];
  $('vecCtn').innerHTML = vec.length
    ? '<div class="hdr">Vectors</div>' + vec.map((v) =>
      `<div class="vec"><span>${v.label}</span><button class="mini" data-vec="${v.value}">${CPUS[rom.platform].addrFmt(v.value)}</button></div>`).join('')
    : '<div class="muted">No vector table.</div>';
}

function renderEntries() {
  const sel = $('entrySel');
  sel.innerHTML = '';
  for (const e of rom.entries) {
    const opt = document.createElement('option');
    opt.value = e.addr;
    opt.textContent = (e.label || '') + '  ' + CPUS[rom.platform].addrFmt(e.addr);
    sel.appendChild(opt);
  }
}

function readEntry() {
  const over = $('entryOverride').value.trim();
  if (over) {
    const n = parseInt(over.replace(/[$x]/gi, ''), 16);
    if (!isNaN(n)) return n & (CPUS[rom.platform].id === '65816' ? 0xffffff : CPUS[rom.platform].id === '68000' ? 0xffffffff : 0xffff);
  }
  return parseInt($('entrySel').value, 10);
}

// ---------------- analyse ----------------

function analyze(mode) {
  if (!rom) return;
  const cpu = CPUS[rom.platform];
  const auto = mode === 'auto';
  if (!auto) curEntry = readEntry();
  setStatus(auto ? 'Auto-analyzing the whole ROM…' : 'Targeted analysis from ' + cpu.addrFmt(curEntry) + '…');
  const t0 = performance.now();
  scanResult = scan(cpu, rom.mem, auto ? rom.entries.map((e) => ({ addr: e.addr, label: e.label })) : [{ addr: curEntry, label: 'entry' }], {
    maxIns: auto ? 500000 : 300000,
    cover: auto,
  });
  decompResult = decompile(cpu, rom.mem, scanResult, { maxFuncs: 250 });
  const ms = Math.round(performance.now() - t0);
  renderFuncs();
  renderDisasm(true);
  renderDecomp();
  renderOverview();
  const funcs = new Set([...scanResult.funcEntry, ...scanResult.callTargets]).size;
  const note = scanResult.truncated ? ' Limit reached — partial analysis.' : '';
  setStatus(`✓ ${scanResult.count} instructions · ${funcs} function(s) · ${decompResult.functions.length} decompiled · ${ms} ms.${note}`);
}

// ---------------- désassemblage ----------------

function renderDisasm(reset) {
  const cpu = CPUS[rom.platform];
  const ctn = $('disasmCtn');
  if (reset) { shown = 0; ctn.innerHTML = ''; }
  if (!scanResult) { ctn.innerHTML = ''; return; }
  const sorted = scanResult.sorted;
  const slice = sorted.slice(shown, shown + PAGE);
  shown += PAGE;

  const frag = document.createDocumentFragment();
  for (const addr of slice) {
    const ins = scanResult.code.get(addr);
    const label = scanResult.labels.get(addr);
    if (label) {
      const div = document.createElement('div');
      div.className = 'lbl';
      div.textContent = (label === 'ENTREE' ? '— entry — ' : '— function — ') + cpu.addrFmt(addr);
      frag.appendChild(div);
    }
    const row = document.createElement('div');
    row.className = 'ins' + (ins.branch ? ' br' : '');
    const br = ins.branch;
    row.innerHTML =
      `<span class="a" data-addr="${addr}">${cpu.addrFmt(addr)}</span>` +
      `<span class="b">${fmtBytes(ins)}</span>` +
      `<span class="t">${esc(ins.text)}</span>` +
      (br && br.target != null && br.kind !== 'call' ? `<span class="s" data-jump="${br.target}">→</span>` : '');
    frag.appendChild(row);
  }
  ctn.appendChild(frag);
  $('loadMoreBtn').style.display = shown < sorted.length ? 'inline-block' : 'none';
  $('loadMoreBtn').textContent = `Show more (${sorted.length - shown} remaining)`;
}

function scrollToAddr(addr) {
  const cpu = CPUS[rom.platform];
  const el = $('disasmCtn').querySelector(`[data-addr="${addr}"]`);
  if (el) { el.scrollIntoView({ block: 'center' }); el.classList.add('flash'); setTimeout(() => el.classList.remove('flash'), 900); }
}

function renderFuncs() {
  const ctn = $('funcsCtn');
  ctn.innerHTML = '';
  if (!scanResult) { $('funcCount').textContent = '0'; return; }
  const cpu = CPUS[rom.platform];
  const set = new Set([...scanResult.funcEntry, ...scanResult.callTargets]);
  const list = [...set].sort((a, b) => a - b);
  for (const a of list) {
    const btn = document.createElement('button');
    btn.className = 'func';
    btn.textContent = cpu.addrFmt(a);
    btn.title = 'Function at ' + cpu.addrFmt(a) + (scanResult.labels.get(a) === 'ENTREE' ? ' (entry)' : '');
    btn.dataset.faddr = a;
    ctn.appendChild(btn);
  }
  $('funcCount').textContent = list.length;
}

function doScanFrom(addr) {
  if (!rom) return;
  curEntry = addr;
  $('entryOverride').value = '';
  for (const o of $('entrySel').options) if (String(o.value) === String(addr)) { $('entrySel').value = o.value; break; }
  analyze('target');
}

// ---------------- pseudo-C ----------------

function renderDecomp() {
  const ctn = $('decompCtn');
  if (!decompResult) { ctn.innerHTML = '<span class="muted">Analyze the ROM first — everything happens automatically on load.</span>'; return; }
  ctn.innerHTML = '';
  if (!decompResult.functions.length) { ctn.textContent = 'No analyzable functions.'; return; }
  const head = document.createElement('pre');
  head.className = 'chead';
  head.textContent = `// ${decompResult.functions.length} function(s) reconstructed into pseudo-C\n` +
    `// Reading: mem8(x) = byte, mem16(x) = word, mem32(x) = long word. Heuristic (approximate) result.`;
  ctn.appendChild(head);
  for (const f of decompResult.functions) {
    const pre = document.createElement('pre');
    pre.className = 'cfunc';
    pre.textContent = applyHwSymbols(f.text, rom.platform);
    ctn.appendChild(pre);
  }
  if (decompResult.warnings.length) {
    const w = document.createElement('div');
    w.className = 'note';
    w.textContent = decompResult.warnings.join('\n');
    ctn.appendChild(w);
  }
}

// ---------------- vue d'ensemble ----------------

function renderOverview() {
  const ctn = $('overviewCtn');
  if (!rom) { ctn.innerHTML = '<span class="muted">Load a ROM: full analysis starts automatically.</span>'; return; }
  const cpu = CPUS[rom.platform];
  const info = rom.info;
  const kb = info.romSizeKB || info.sizeKB;
  const funcs = scanResult ? new Set([...scanResult.funcEntry, ...scanResult.callTargets]).size : 0;
  const coveredBytes = scanResult ? scanResult.sorted.reduce((s, a) => s + scanResult.code.get(a).size, 0) : 0;
  const rangeBytes = (rom.coverRanges || []).reduce((s, [a, b]) => s + (b - a), 0) || 1;
  const cov = Math.min(100, Math.round((coveredBytes / rangeBytes) * 100));

  const kv = (k, v) => `<tr><th>${k}</th><td>${v}</td></tr>`;
  let t = '<table class="ov">';
  t += kv('Console', `<b>${PLATFORMS[rom.platform]}</b>`);
  if (info.title) t += kv('Game title', `« ${info.title} »`);
  if (kb) t += kv('Size', `${kb} KB`);
  if (info.mapper != null) t += kv('Mapper', String(info.mapper));
  if (info.mapping) t += kv('Memory mapping', info.mapping);
  if (info.prgBanks != null) t += kv('PRG/CHR banks', `${info.prgBanks}×16 KB / ${info.chrBanks}×8 KB`);
  if (info.mirror) t += kv('Mirroring', info.mirror);
  if (info.header) t += kv('Header', info.header);
  t += kv('Instructions decoded', scanResult ? String(scanResult.count) : '—');
  t += kv('Functions detected', String(funcs));
  t += kv('Functions decompiled', decompResult ? String(decompResult.functions.length) : '—');
  t += kv('ROM coverage', `${cov} % ${scanResult && scanResult.truncated ? '<span class="muted">(partial analysis — limit reached)</span>' : ''}`);
  t += '</table>';

  let html = t;

  const entries = rom.entries || [];
  if (entries.length) {
    html += '<div class="hdr">Detected entry points</div><div class="ovbtns">' +
      entries.map((e) => `<button class="mini" data-ent="${e.addr}">${cpu.addrFmt(e.addr)} — ${e.label || ''}</button>`).join('') + '</div>';
  }

  html += '<div class="hdr">How to read this code?</div><div class="guide">' +
    '<p>This tool <b>automatically</b> translates the ROM\'s machine code: ' +
    'all of the game\'s code is disassembled, the functions are discovered and rebuilt into pseudo-C, and the console\'s hardware registers (PPU, VDP, APU…) are renamed to stay readable.</p>' +
    '<ul>' +
    '<li><b>Overview</b>: the ROM, its entry points and its statistics.</li>' +
    '<li><b>Pseudo-C</b>: every game function rebuilt — <span class="mono">mem8[address] = value</span> writes a byte (register or memory), <span class="mono">return n;  // A</span> returns the value in the accumulator.</li>' +
    '<li><b>Disassembly</b>: the full list of machine instructions (address, bytes, mnemonic).</li>' +
    '<li><b>Graphics</b>: the game\'s 8×8 tiles and palettes extracted from the ROM, with PNG (spritesheet), CSS and JSON export — for a re-skin or reuse of the assets.</li>' +
    '<li>Click an address to jump to its instruction, or "Download the code" to export everything to a <span class="mono">.c</span> file.</li>' +
    '</ul>' +
    '<p class="muted">The result is <b>heuristic</b>: it is meant to help understand a game, not to be recompiled as-is.</p></div>';

  html += '<div style="margin-top:12px"><button id="downloadBtn" class="btn-main">⬇ Download full code (.c)</button></div>';

  ctn.innerHTML = html;
}

// ---------------- graphismes (tuiles, palettes, sprites) ----------------

function currentTileset() {
  const tsSel = $('tileSetSel');
  if (!assets || !assets.tilesets.length) return null;
  return assets.tilesets[parseInt(tsSel.value, 10) || 0] || assets.tilesets[0];
}

function currentColors() {
  const palIdx = Math.min(parseInt($('palSel').value, 10) || 0, assets.palettes.length);
  const subPal = parseInt($('subPalSel').value, 10) || 0;
  const raw = palIdx > 0 && assets.palettes[palIdx - 1] ? assets.palettes[palIdx - 1].raw : null;
  if (assets.kind === 'nes') {
    const full = raw ? paletteColors('nes', raw) : defaultPaletteColors('nes');
    return full.slice(Math.min(subPal, 7) * 4, Math.min(subPal, 7) * 4 + 4);
  }
  return raw ? paletteColors(assets.kind, raw) : defaultPaletteColors(assets.kind);
}

function tileRGBA(ts, i, colors, sprite) {
  const out = new Uint8ClampedArray(8 * 8 * 4);
  const base = i * 64;
  for (let p = 0; p < 64; p++) {
    const idx = ts.tiles[base + p];
    if (sprite && idx === 0) continue;
    const col = colors[idx] || [0, 0, 0];
    out[p * 4] = col[0]; out[p * 4 + 1] = col[1]; out[p * 4 + 2] = col[2]; out[p * 4 + 3] = 255;
  }
  return out;
}

function fillSheet(canvas, ts, colors, sprite, zoom, cols) {
  const rows = Math.ceil(256 / cols);
  const w = cols * 8 * zoom, h = rows * 8 * zoom;
  canvas.width = w; canvas.height = h;
  const ctx = canvas.getContext('2d');
  const img = ctx.createImageData(w, h);
  const d = img.data;
  const put = (bx, by, c) => {
    for (let yy = 0; yy < zoom; yy++) {
      let p = ((by + yy) * w + bx) * 4;
      for (let xx = 0; xx < zoom; xx++, p += 4) {
        d[p] = c[0]; d[p + 1] = c[1]; d[p + 2] = c[2]; d[p + 3] = c[3];
      }
    }
  };
  for (let i = 0; i < 256; i++) {
    const ox = (i % cols) * 8 * zoom, oy = Math.floor(i / cols) * 8 * zoom;
    const base = i * 64;
    for (let py = 0; py < 8; py++) {
      for (let px = 0; px < 8; px++) {
        const idx = ts.tiles[base + py * 8 + px];
        let c;
        if (sprite && idx === 0) c = [0, 0, 0, 0];
        else {
          const col = colors[idx] || [0, 0, 0];
          c = [col[0], col[1], col[2], 255];
        }
        put(ox + px * zoom, oy + py * zoom, c);
      }
    }
  }
  ctx.putImageData(img, 0, 0);
}

function renderSwatches(colors) {
  $('palSwatchCtn').innerHTML = colors.map((c) =>
    `<span title="rgb(${c[0]},${c[1]},${c[2]})" style="display:inline-block;width:18px;height:18px;margin-right:3px;border:1px solid var(--line);background:rgb(${c[0]},${c[1]},${c[2]})"></span>`).join('');
}

function renderTileInfo(ts) {
  if (selTile == null) return;
  const i = selTile;
  if (ts.virtual) {
    $('tileInfoCtn').innerHTML = `<b>Tile #${i}</b> — « ${esc(ts.name)} »<br><span class="muted">Data written directly to VRAM by the code — no contiguous ROM source to display.</span>`;
    return;
  }
  const raw = assets.bytes.subarray(ts.off + i * ts.tileSize, ts.off + (i + 1) * ts.tileSize);
  const hex = [...raw].map((b) => b.toString(16).padStart(2, '0')).join(' ').replace(/((?:[0-9a-f]{2} ){8})/g, '$1\n');
  $('tileInfoCtn').innerHTML = `<b>Tile #${i}</b> — « ${esc(ts.name)} » — offset 0x${(ts.off + i * ts.tileSize).toString(16).toUpperCase()}<br>` +
    `<span class="mono" style="white-space:pre">${hex}</span>`;
}

function renderComposer() {
  const c = $('composerCanvas');
  if (!assets || !composer.length) {
    c.width = 2; c.height = 2;
    c.getContext('2d').clearRect(0, 0, 2, 2);
    return;
  }
  const ts = currentTileset();
  const colors = currentColors();
  const sprite = $('spriteModeChk').checked;
  const cols = 16, cell = 32, zoom = 4;
  const rows = Math.ceil(composer.length / cols);
  c.width = cols * cell; c.height = rows * cell;
  const ctx = c.getContext('2d');
  ctx.clearRect(0, 0, c.width, c.height);
  const tmp = document.createElement('canvas');
  tmp.width = 8; tmp.height = 8;
  const tctx = tmp.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  composer.forEach((t, i) => {
    const img = tctx.createImageData(8, 8);
    img.data.set(tileRGBA(ts, t, colors, sprite));
    tctx.putImageData(img, 0, 0);
    ctx.drawImage(tmp, (i % cols) * cell, Math.floor(i / cols) * cell, cell, cell);
  });
}

function refreshGraphics() {
  if (!assets || !assets.tilesets.length) return;
  const ts = currentTileset();
  const zoom = parseInt($('zoomSel').value, 10) || 4;
  const sprite = $('spriteModeChk').checked;
  fillSheet($('tilesCanvas'), ts, currentColors(), sprite, zoom, 32);
  renderSwatches(currentColors());
  if (selTile != null) renderTileInfo(ts);
  renderComposer();
}

function renderGraphics() {
  const tsSel = $('tileSetSel');
  const palSel = $('palSel');
  tsSel.innerHTML = '';
  palSel.innerHTML = '';
  $('palSwatchCtn').innerHTML = '';
  $('tileCanvasCtn').innerHTML = '<canvas id="tilesCanvas" style="image-rendering:pixelated;display:block"></canvas>';
  const pi = assets && assets.analysis && assets.analysis.planInfo;
  if (assets && pi) {
    const fmt = (a) => a != null ? '0x' + a.toString(16).toUpperCase().padStart(4, '0') : '—';
    const parts = [];
    if (pi.planeA != null) parts.push(`Plan A @${fmt(pi.planeA)}`);
    if (pi.planeB != null) parts.push(`Plan B @${fmt(pi.planeB)}`);
    if (pi.sprites != null) parts.push(`Sprites @${fmt(pi.sprites)}`);
    $('planInfoCtn').innerHTML = `<div class="note">Genesis — ${parts.join(' · ')}</div>`;
  } else {
    $('planInfoCtn').innerHTML = '';
  }
  if (!assets) {
    $('tileInfoCtn').innerHTML = '<span class="muted">Load a ROM to extract its graphics.</span>';
    return;
  }
  if (!assets.tilesets.length) {
    $('tileInfoCtn').innerHTML = '<span class="muted">' + esc((assets.notes || ['No extractable tiles.'])[0]) + '</span>';
    return;
  }
  const prevTs = tsSel.value;
  for (const ts of assets.tilesets) {
    const o = document.createElement('option');
    o.value = ts.id;
    o.textContent = `${ts.name} — ${ts.nonEmpty}/256 tiles`;
    tsSel.appendChild(o);
  }
  if (prevTs && tsSel.querySelector(`option[value="${prevTs}"]`)) tsSel.value = prevTs;
  const prevPal = palSel.value;
  const o0 = document.createElement('option');
  o0.value = '0'; o0.textContent = '— default —';
  palSel.appendChild(o0);
  assets.palettes.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i + 1);
    o.textContent = `${p.name} (${Math.round(p.score)} pts)`;
    palSel.appendChild(o);
  });
  if (prevPal && palSel.querySelector(`option[value="${prevPal}"]`)) palSel.value = prevPal;
  const sp = $('subPalSel');
  $('subPalLbl').style.display = assets.kind === 'nes' ? '' : 'none';
  if (assets.kind === 'nes' && sp.options.length !== 8) {
    sp.innerHTML = '';
    for (let i = 0; i < 8; i++) {
      const o = document.createElement('option');
      o.value = String(i);
      o.textContent = i < 4 ? `BG ${i}` : `SPR ${i - 4}`;
      sp.appendChild(o);
    }
  }
  refreshGraphics();
}

function downloadFile(name, blob) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

function sheetCanvas() {
  const ts = currentTileset();
  const canvas = document.createElement('canvas');
  fillSheet(canvas, ts, currentColors(), $('spriteModeChk').checked, 4, 32);
  return canvas;
}

function buildCssText() {
  const cell = 32;
  let css = '/* ROM Investigation — CSS spritesheet (32 tiles per row, 8×8 px, zoom 4) */\n';
  css += '.roms-sheet {\n  background-image: url(spritesheet.png);\n  background-repeat: no-repeat;\n  image-rendering: pixelated;\n  width: ' + cell + 'px;\n  height: ' + cell + 'px;\n}\n';
  for (let i = 0; i < 256; i++) {
    css += `.roms-t${i} { background-position: -${(i % 32) * cell}px -${Math.floor(i / 32) * cell}px; }\n`;
  }
  return css;
}

function buildJson() {
  const ts = currentTileset();
  const palIdx = parseInt($('palSel').value, 10) || 0;
  const rawPal = palIdx > 0 && assets.palettes[palIdx - 1] ? [...assets.palettes[palIdx - 1].raw] : null;
  const b64 = (i) => {
    const b = assets.bytes.subarray(ts.off + i * ts.tileSize, ts.off + (i + 1) * ts.tileSize);
    let s = '';
    for (const x of b) s += String.fromCharCode(x);
    return btoa(s);
  };
  const tiles = [];
  for (let i = 0; i < 256; i++) tiles.push({ index: i, x: (i % 32) * 8, y: Math.floor(i / 32) * 8, data: b64(i) });
  return {
    generator: 'ROM Investigation',
    game: rom.info.title || fileName,
    platform: rom.platform,
    tileset: ts.name,
    bpp: ts.bpp,
    tileSize: ts.tileSize,
    tileWidth: 8,
    tileHeight: 8,
    cols: 32,
    paletteRaw: rawPal,
    paletteColors: currentColors(),
    tiles,
  };
}

function exportCss() {
  const canvas = sheetCanvas();
  downloadFile('spritesheet.css', new Blob([buildCssText()], { type: 'text/css;charset=utf-8' }));
  canvas.toBlob((b) => b && downloadFile('spritesheet.png', b), 'image/png');
}

function exportJson() {
  downloadFile('tiles.json', new Blob([JSON.stringify(buildJson(), null, 2)], { type: 'application/json' }));
}

// ---------------- export ----------------

function buildExport() {
  const cpu = CPUS[rom.platform];
  const info = rom.info;
  const kb = info.romSizeKB || info.sizeKB;
  const L = [];
  L.push('/* ===============================================================');
  L.push('   ROM Investigation — reconstruction of the ROM code');
  L.push(`   Console : ${PLATFORMS[rom.platform]}`);
  if (info.title) L.push(`   Game    : ${info.title}`);
  L.push(`   Size    : ${kb ? kb + ' KB' : '?'}`);
  if (info.mapper != null) L.push(`   Mapper  : ${info.mapper}`);
  if (info.mapping) L.push(`   Mapping: ${info.mapping}`);
  L.push('');
  L.push('   File generated automatically (disassembly + heuristic');
  L.push('   decompilation into pseudo-C). Meant for READING and UNDERSTANDING the game.');
  L.push('   =============================================================== */');
  L.push('');

  const syms = symbolNames(rom.platform);
  if (syms.length) {
    L.push('/* Console hardware registers */');
    for (const [addr, name] of syms) {
      L.push(`#define ${name.padEnd(12)} 0x${addr.toString(16).toUpperCase().padStart(cpu.id === '68000' ? 8 : 4, '0')}`);
    }
    L.push('');
  }

  if (decompResult && decompResult.functions.length) {
    L.push('// ================== FUNCTIONS (pseudo-C) ==================');
    L.push('');
    for (const f of decompResult.functions) {
      L.push(`// ---------- ${f.name}  @  ${cpu.addrFmt(f.addr)} ----------`);
      L.push(applyHwSymbols(f.text, rom.platform));
      L.push('');
    }
  }

  L.push('// ================== FULL DISASSEMBLY ==================');
  L.push('');
  for (const addr of scanResult.sorted) {
    const ins = scanResult.code.get(addr);
    const label = scanResult.labels.get(addr);
    if (label) L.push(`// --- ${label} ${cpu.addrFmt(addr)} ---`);
    L.push(`${cpu.addrFmt(addr)}  ${fmtBytes(ins).padEnd(18)}${ins.text}`);
  }
  return L.join('\n');
}

function download() {
  if (!rom || !scanResult || !decompResult) return;
  const text = buildExport();
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = (fileName.replace(/\.[^.]+$/, '') || 'rom') + '_code.c';
  document.body.appendChild(a);
  a.click();
  setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
}

// ---------------- chargement ----------------

function switchTab(name) {
  $('tabOverview').classList.toggle('active', name === 'overview');
  $('tabDecomp').classList.toggle('active', name === 'decomp');
  $('tabDisasm').classList.toggle('active', name === 'disasm');
  $('tabGraphics').classList.toggle('active', name === 'graphics');
  $('panOverview').style.display = name === 'overview' ? '' : 'none';
  $('panDecomp').style.display = name === 'decomp' ? '' : 'none';
  $('panDisasm').style.display = name === 'disasm' ? '' : 'none';
  $('panGraphics').style.display = name === 'graphics' ? '' : 'none';
  $('panScene').style.display = name === 'scene' ? '' : 'none';
  $('tabScene').classList.toggle('active', name === 'scene');
  if (name === 'graphics') refreshGraphics();
  if (name === 'scene') renderScene();
}

function esc(s) {
  return (s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function onFile(file) {
  if (!file) return;
  fileName = file.name;
  const buf = await file.arrayBuffer();
  rawBytes = new Uint8Array(buf);
  const detected = detectPlatform(rawBytes);
  $('platformSel').value = detected;
  applyOptionsAndLoad();
}

function applyOptionsAndLoad() {
  if (!rawBytes) return;
  const platform = $('platformSel').value;
  curPlatform = platform;
  $('snesWidthLbl').style.display = platform === 'snes' ? '' : 'none';
  $('snesXLbl').style.display = platform === 'snes' ? '' : 'none';
  $('nesBankLbl').style.display = platform === 'nes' ? '' : 'none';
  $('smsPageLbl').style.display = platform === 'sms' ? '' : 'none';
  if (platform === 'nes') {
    const banks = Math.max(1, (rawBytes[4] || 1));
    const sel = $('nesBankSel');
    sel.innerHTML = '';
    for (let i = 0; i < banks; i++) {
      const o = document.createElement('option');
      o.value = i; o.textContent = i;
      sel.appendChild(o);
    }
  }
  if (platform === 'sms') {
    const n = Math.max(1, Math.ceil((rawBytes.length - ((rawBytes.length >= 0x108 && rawBytes[0x100] === 0x54 && rawBytes[0x101] === 0x4d) ? 512 : 0)) / 0x4000));
    const sel = $('smsPageSel');
    sel.innerHTML = '';
    for (let i = 0; i < n; i++) {
      const o = document.createElement('option');
      o.value = i; o.textContent = i;
      sel.appendChild(o);
    }
  }
  const opts = {};
  if (platform === 'snes') opts.snesMode = $('snesModeSel').value;
  if (platform === 'nes') opts.bank = parseInt($('nesBankSel').value, 10) || 0;
  if (platform === 'sms') opts.page8000 = parseInt($('smsPageSel').value, 10) || 0;
  try {
    rom = loadRom(rawBytes, platform, opts);
  } catch (e) {
    setStatus('Mapping error: ' + e.message, true);
    return;
  }
  const cpu = CPUS[platform];
  cpu.opts && (cpu.opts.m = parseInt($('mWidthSel').value, 10));
  cpu.opts && (cpu.opts.x = parseInt($('xWidthSel').value, 10));
  renderInfo();
  renderEntries();
  $('entryOverride').value = '';
  analyze('auto');
  assets = extractAssets(rom, rawBytes, platform, CPUS[platform]);
  selTile = null;
  composer = [];
  renderGraphics();
  fillSceneSelects();
  switchTab('overview');
}

// ---------------- scène (reconstruction de tilemaps) ----------------

function fillSceneSelects() {
  const tsSel = $('sceneTilesetSel');
  const palSel = $('scenePalSel');
  tsSel.innerHTML = '';
  palSel.innerHTML = '';
  if (!assets || !assets.tilesets.length) return;
  for (const ts of assets.tilesets) {
    const o = document.createElement('option');
    o.value = ts.id;
    o.textContent = `${ts.name} — ${ts.nonEmpty}/256 tuiles`;
    tsSel.appendChild(o);
  }
  const o0 = document.createElement('option');
  o0.value = '0'; o0.textContent = '— default —';
  palSel.appendChild(o0);
  assets.palettes.forEach((p, i) => {
    const o = document.createElement('option');
    o.value = String(i + 1);
    o.textContent = p.name;
    palSel.appendChild(o);
  });
  const mapSel = $('sceneMapSel');
  const cur = mapSel.value;
  mapSel.innerHTML = '<option value="">— carte auto / manuelle —</option>';
  for (const c of findPlaneMaps(assets)) {
    const o = document.createElement('option');
    o.value = c.off;
    o.textContent = c.name;
    mapSel.appendChild(o);
  }
  if (cur && mapSel.querySelector(`option[value="${cur}"]`)) mapSel.value = cur;
}

function sceneColors() {
  const palIdx = parseInt($('scenePalSel').value, 10) || 0;
  const ts = $('sceneTilesetSel').selectedOptions[0] ? assets.tilesets.find((t) => String(t.id) === $('sceneTilesetSel').value) : null;
  if (!ts) return defaultPaletteColors(assets.kind);
  return colorsFor(assets, ts, palIdx);
}

function renderScene() {
  const cv = $('sceneCanvas');
  if (!assets || !assets.tilesets.length) { cv.width = 2; cv.height = 2; cv.getContext('2d').clearRect(0, 0, 2, 2); $('sceneStatusCtn').textContent = 'Load a ROM with extracted tiles.'; return; }
  const ts = assets.tilesets.find((t) => String(t.id) === $('sceneTilesetSel').value);
  let offRaw = $('sceneMapOff').value.trim();
  if (offRaw === '') {
    const auto = autoBuildScene(assets);
    if (auto) {
      offRaw = auto.map.off.toString(16);
      $('sceneMapOff').value = offRaw.toUpperCase();
      $('sceneEntrySize').value = String(auto.map.entrySize);
      $('sceneMapW').value = auto.map.w;
      $('sceneMapH').value = auto.map.h;
      $('scenePalSel').value = String(auto.palIdx);
      if ($('sceneTilesetSel').querySelector(`option[value="${auto.tilesetId}"]`)) $('sceneTilesetSel').value = auto.tilesetId;
      renderScene();
      $('sceneStatusCtn').textContent += ` — auto: ${Math.round(auto.score)} pts`;
      return;
    }
    offRaw = '0';
  }
  const off = parseInt(offRaw.replace(/[$x]/gi, ''), 16);
  if (isNaN(off)) { $('sceneStatusCtn').textContent = 'Invalid map offset.'; return; }
  const es = parseInt($('sceneEntrySize').value, 10);
  const w = Math.max(1, parseInt($('sceneMapW').value, 10) || 40);
  const h = Math.max(1, parseInt($('sceneMapH').value, 10) || 28);
  const { entries } = decodeMap(assets.kind, assets.bytes, off, es, w, h);
  const colors = sceneColors();
  const img = buildScene(ts.tiles, entries, colors, w, h);
  cv.width = img.width; cv.height = img.height;
  cv.getContext('2d').putImageData(img, 0, 0);
  $('sceneStatusCtn').textContent = `Scene rebuilt: ${w}×${h} tiles @0x${off.toString(16).toUpperCase()} — ${w * 8}×${h * 8} px. Click "⬇ PNG" to export it.`;
}

// ---------------- événements (délégation : le DOM est re-rendu par Perchance) ----------------

function init() {
  window.__romStudioLoaded = true;
  document.addEventListener('change', (e) => {
    const t = e.target;
    if (!t || !t.id) return;
    if (t.id === 'fileInput') onFile(t.files && t.files[0]);
    else if (t.id === 'platformSel' || t.id === 'snesModeSel' || t.id === 'nesBankSel' || t.id === 'smsPageSel' || t.id === 'mWidthSel' || t.id === 'xWidthSel') applyOptionsAndLoad();
    else if (t.id === 'tileSetSel') { composer = []; selTile = null; refreshGraphics(); }
    else if (t.id === 'palSel' || t.id === 'subPalSel' || t.id === 'zoomSel' || t.id === 'spriteModeChk') refreshGraphics();
    else if (t.id === 'sceneTilesetSel' || t.id === 'scenePalSel') renderScene();
    else if (t.id === 'sceneMapSel') {
      if (t.value) {
        const cand = (findPlaneMaps(assets) || []).find((c) => c.name === t.value);
        if (cand) {
          $('sceneMapOff').value = cand.off.toString(16).toUpperCase();
          $('sceneEntrySize').value = String(cand.entrySize);
          $('sceneMapW').value = cand.w;
          $('sceneMapH').value = cand.h;
        }
      }
      renderScene();
    }
    else if (t.id === 'sceneMapOff' || t.id === 'sceneEntrySize' || t.id === 'sceneMapW' || t.id === 'sceneMapH') renderScene();
  });
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    const drop = t.closest('#fileDrop');
    if (drop) { $('fileInput').click(); return; }
    const id = t.id;
    if (id === 'scanBtn') analyze('target');
    else if (id === 'autoBtn') analyze('auto');
    else if (id === 'downloadBtn') download();
    else if (id === 'loadMoreBtn') renderDisasm(false);
    else if (id === 'tabOverview') switchTab('overview');
    else if (id === 'tabDisasm') switchTab('disasm');
    else if (id === 'tabDecomp') switchTab('decomp');
    else if (id === 'tabGraphics') switchTab('graphics');
    else if (id === 'tabScene') switchTab('scene');
    else if (id === 'sceneRenderBtn') renderScene();
    else if (id === 'sceneAutoBtn') { $('sceneMapOff').value = ''; renderScene(); }
    else if (id === 'scenePngBtn') $('sceneCanvas').toBlob((b) => b && downloadFile('scene.png', b), 'image/png');
    else if (id === 'exportPngBtn') sheetCanvas().toBlob((b) => b && downloadFile('spritesheet.png', b), 'image/png');
    else if (id === 'exportCssBtn') exportCss();
    else if (id === 'exportJsonBtn') exportJson();
    else if (id === 'compUndoBtn') { composer.pop(); renderComposer(); }
    else if (id === 'compClearBtn') { composer = []; renderComposer(); }
    else if (id === 'compPngBtn') $('composerCanvas').toBlob((b) => b && downloadFile('sprite.png', b), 'image/png');
    if (id === 'tilesCanvas') {
      if (!assets || !assets.tilesets.length) return;
      const rect = t.getBoundingClientRect();
      const zoom = parseInt($('zoomSel').value, 10) || 4;
      const col = Math.floor((e.clientX - rect.left) / (8 * zoom));
      const row = Math.floor((e.clientY - rect.top) / (8 * zoom));
      if (col >= 0 && col < 32 && row >= 0 && row < 8) {
        selTile = row * 32 + col;
        composer.push(selTile);
        renderTileInfo(currentTileset());
        renderComposer();
      }
      return;
    }
    if (t.dataset) {
      if (t.dataset.jump != null) scrollToAddr(parseInt(t.dataset.jump, 10));
      else if (t.dataset.vec != null) {
        scrollToAddr(parseInt(t.dataset.vec, 10));
        doScanFrom(parseInt(t.dataset.vec, 10));
      } else if (t.dataset.faddr != null) doScanFrom(parseInt(t.dataset.faddr, 10));
      else if (t.dataset.ent != null) {
        scrollToAddr(parseInt(t.dataset.ent, 10));
        switchTab('disasm');
      }
    }
  });
  document.addEventListener('dragover', (e) => {
    if (e.target && e.target.closest && e.target.closest('#fileDrop')) e.preventDefault();
  });
  document.addEventListener('drop', (e) => {
    const drop = e.target && e.target.closest && e.target.closest('#fileDrop');
    if (!drop) return;
    e.preventDefault();
    const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) onFile(f);
  });

  window.__extractAssets = extractAssets;
  window.__snesgfx = () => analyzeSNESGraphics(rom, CPUS.snes, rawBytes);
  window.__genesisgfx = () => analyzeGenesisGraphics(rom, CPUS.genesis, rawBytes);
  window.__buildCss = buildCssText;
  window.__buildJson = buildJson;
  window.__dbg = () => ({ rom, rawBytes, assets, platform: curPlatform, cpu: CPUS[curPlatform] });
  window.__disasm = (addr, n) => {
    const c = CPUS[curPlatform];
    const out = [];
    let a = addr;
    for (let i = 0; i < n; i++) {
      const ins = c.decode(rom.mem, a);
      if (!ins) break;
      out.push(a.toString(16).toUpperCase().padStart(6, '0') + '  ' + ins.text);
      a = (a + ins.size) & 0xffffff;
    }
    return out;
  };
  window.__loadRomBytes = (bytes, platform) => {
    rawBytes = bytes;
    $('platformSel').value = platform;
    applyOptionsAndLoad();
  };
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
else init();
