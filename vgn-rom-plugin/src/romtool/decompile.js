// decompile.js — heuristic pseudo-C reconstruction from the disassembled control flow.
// Register tracking + copy propagation produce readable C-ish output; control flow
// is emitted as structured if/while/goto. Approximate by nature (no comments/symbols
// survive decompilation on any platform).

import { buildBlocks, nextAddr } from './analyze.js';

const HEX = (n, w) => '0x' + n.toString(16).toUpperCase().padStart(w, '0');

function mb(cpuId, a) { return cpuId === '68000' ? 'mem8[' + HEX(a, 8) + ']' : 'mem8[' + HEX(a, 4) + ']'; }
function mw(cpuId, a) { return cpuId === '68000' ? 'mem16[' + HEX(a, 8) + ']' : 'mem16[' + HEX(a, 4) + ']'; }
function ml(a) { return 'mem32[' + HEX(a, 8) + ']'; }

function isNum(s) { return /^-?\d+$/.test(s); }
function fold(op, a, b) {
  if (isNum(a) && isNum(b)) {
    const x = parseInt(a, 10), y = parseInt(b, 10);
    return String(eval(`(${x} ${op} ${y})`));
  }
  if (op === '+' && isNum(b) && parseInt(b, 10) === 0) return a;
  if (op === '+' && isNum(a) && parseInt(a, 10) === 0) return b;
  if (op === '-' && isNum(b) && parseInt(b, 10) === 0) return a;
  return a + ' ' + op + ' ' + b;
}

export function decompile(cpu, mem, scanResult, opts = {}) {
  const { code, callTargets, funcEntry } = scanResult;
  const maxFuncs = opts.maxFuncs || 80;

  const nameOf = new Map();
  let n = 0;
  for (const a of funcEntry) { nameOf.set(a, n++ === 0 ? 'main' : 'func_' + a.toString(16).toUpperCase()); }
  for (const a of callTargets) if (!nameOf.has(a)) nameOf.set(a, 'func_' + a.toString(16).toUpperCase());

  const functions = [];
  const seen = new Set();
  const entryList = [...funcEntry, ...callTargets];
  let warnings = [];

  for (const entry of entryList) {
    if (seen.has(entry)) continue;
    seen.add(entry);
    if (functions.length >= maxFuncs) break;
    if (!code.has(entry)) continue;
    try {
      const text = decompileFunction(cpu, mem, code, callTargets, nameOf, entry, warnings);
      if (text) functions.push({ addr: entry, name: nameOf.get(entry), text });
    } catch (e) {
      warnings.push('Error on ' + nameOf.get(entry) + ': ' + e.message);
    }
  }
  return { functions, warnings };
}

function decompileFunction(cpu, mem, code, callTargets, nameOf, entry, warnings) {
  const blocks = buildBlocks(cpu, mem, code, callTargets, entry);
  if (!blocks.size) return null;

  // pre-order traversal to get a natural emission order
  const order = [];
  const done = new Set();
  const visit = (addr) => {
    if (done.has(addr)) return;
    done.add(addr);
    const b = blocks.get(addr);
    if (!b) return;
    order.push(b);
    if (b.succ) {
      if (b.succ.next != null) visit(b.succ.next);
      if (b.succ.cond != null) visit(b.succ.cond);
      if (b.succ.jump != null) visit(b.succ.jump);
    }
  };
  visit(entry);

  // labels: blocks targeted by a cond/jump edge get a label
  const needLabel = new Set();
  for (const b of blocks.values()) {
    if (b.succ && b.succ.cond != null && b.succ.cond !== b.addr) needLabel.add(b.succ.cond);
    if (b.succ && b.succ.jump != null && b.succ.jump !== b.addr) needLabel.add(b.succ.jump);
    if (b.succ && b.succ.jump != null && b.succ.jump === b.addr) needLabel.add(b.addr);
  }
  needLabel.add(entry);

  const lbl = (a) => 'L' + a.toString(16).toUpperCase();

  // state: register value tracking (carried through the whole function)
  const state = createState(cpu);

  // per-block statement generation (uses shared state)
  const blockStmts = new Map();
  const blockSnap = new Map();
  for (const b of order) {
    const stmts = [];
    for (const ins of b.ins) {
      const res = mapIns(cpu, ins, state, mem, nameOf);
      if (res && res.length) for (const s of res) stmts.push(s);
    }
    blockStmts.set(b.addr, stmts);
    blockSnap.set(b.addr, { r: { ...state.r }, cmp: state.cmp, lastCond: state.lastCond });
  }

  // emission
  const out = [];
  out.push(`// ${nameOf.get(entry)} — heuristic (approximate) decompilation`);
  out.push(`void ${nameOf.get(entry)}(void) {`);
  const ind = (s) => '  ' + s;

  for (let k = 0; k < order.length; k++) {
    const b = order[k];
    const isEntry = b.addr === entry;
    const labeled = needLabel.has(b.addr);
    if (labeled && !isEntry) out.push(ind(lbl(b.addr) + ':'));
    else if (isEntry && needLabel.has(b.addr) && order.length > 1) out.push(ind(lbl(b.addr) + ':'));

    for (const s of blockStmts.get(b.addr)) out.push(ind(s));

    // terminator
    const br = b.lastBranch;
    const nextB = order[k + 1];
    const snap = blockSnap.get(b.addr);
    const cond = () => condText(cpu, b.ins.length ? b.ins[b.ins.length - 1].text : null, snap);
    if (br) {
      if (br.kind === 'ret') {
        if (br.conditional) out.push(ind('if (' + cond() + ') return;'));
        else out.push(ind(returnExpr(cpu, snap)));
      } else if (br.kind === 'jump') {
        if (br.target == null) out.push(ind('// indirect jump'));
        else if (br.target === b.addr) out.push(ind('while (1) ;  // infinite loop'));
        else if (nextB && nextB.addr === br.target) { /* fallthrough */ }
        else out.push(ind('goto ' + lbl(br.target) + ';'));
      } else if (br.kind === 'cond') {
        if (br.target == null) out.push(ind('if (' + cond() + ') return;'));
        else if (nextB && nextB.addr === br.target) { /* fallthrough */ }
        else out.push(ind('if (' + cond() + ') goto ' + lbl(br.target) + ';'));
      } else if (br.kind === 'call') {
        // call was emitted as a statement
      }
    } else if (nextB && b.succ && b.succ.jump != null && b.succ.jump === nextB.addr) {
      // unconditional jump that falls through naturally
    }
  }
  out.push('}');
  return out.join('\n');
}

function createState(cpu) {
  if (cpu.id === 'z80') return { r: { A: null, B: null, C: null, D: null, E: null, H: null, L: null, HL: null, IX: null, IY: null, SP: null, BC: null, DE: null }, cmp: null, lastCond: null };
  if (cpu.id === '68000') {
    const r = {};
    for (let i = 0; i < 8; i++) { r['D' + i] = null; r['A' + i] = null; }
    return { r, cmp: null, lastCond: null };
  }
  return { r: { A: null, X: null, Y: null }, cmp: null, lastCond: null };
}

function condText(cpu, text, state) {
  const cmp = state.cmp;
  if (cpu.id === '6502' || cpu.id === '65816') {
    const m = text ? text.split(' ')[0] : '';
    if (cmp) {
      const { a, b } = cmp;
      switch (m) {
        case 'BEQ': return a + ' == ' + b;
        case 'BNE': return a + ' != ' + b;
        case 'BCC': return a + ' < ' + b + ' (U)';
        case 'BCS': return a + ' >= ' + b + ' (U)';
        case 'BMI': return a + ' < 0';
        case 'BPL': return a + ' >= 0';
        case 'BVC': return '(flag V == 0)';
        case 'BVS': return '(flag V == 1)';
      }
    }
    return m || '?';
  }
  if (cpu.id === 'z80') {
    const t = text || '';
    const tok = t.split(' ');
    const m = tok[0] || '';
    const cc = (tok[1] || '').split(',')[0].trim();
    const ccMap = { NZ: '!=', Z: '==', NC: '< (U)', C: '>= (U)', PO: 'P even', PE: 'P odd', P: 'N==0', M: 'N==1' };
    if (m === 'DJNZ') return 'B-- != 0';
    if (cmp && ccMap[cc]) return cmp.a + ' ' + ccMap[cc] + ' ' + cmp.b;
    return (cc || m) + ' ?';
  }
  const t = (text || '').trim().toLowerCase();
  const m = t.split(' ')[0] || '';
  if (cmp) {
    const { a, b } = cmp;
    switch (m) {
      case 'beq': return a + ' == ' + b;
      case 'bne': return a + ' != ' + b;
      case 'bcs': return a + ' < ' + b + ' (U)';
      case 'bcc': return a + ' >= ' + b + ' (U)';
      case 'bls': return a + ' <= ' + b + ' (U)';
      case 'bhi': return a + ' > ' + b + ' (U)';
      case 'blt': return a + ' < ' + b;
      case 'bge': return a + ' >= ' + b;
      case 'bgt': return a + ' > ' + b;
      case 'ble': return a + ' <= ' + b;
    }
  }
  if (m.startsWith('db')) return 'D-- != 0';
  return m || '?';
}

function returnExpr(cpu, state) {
  if (cpu.id === '6502' || cpu.id === '65816') {
    const a = state.r.A;
    if (isNum(a)) return 'return ' + a + ';  // A';
    if (a) return 'return ' + a + ';';
    return 'return;';
  }
  if (cpu.id === 'z80') {
    const a = state.r.A;
    if (isNum(a)) return 'return ' + a + ';  // A';
    if (a) return 'return ' + a + ';';
    return 'return;';
  }
  const d0 = state.r.D0;
  if (isNum(d0)) return 'return ' + d0 + ';  // D0';
  if (d0) return 'return ' + d0 + ';';
  return 'return;';
}

// ---------------- instruction → C statements ----------------
function mapIns(cpu, ins, state, mem, nameOf) {
  const r = state.r;
  const m = ins.mnemonic.toUpperCase();
  const ops = ins.operands;
  const cmt = () => ['// ' + ins.text];
  if (ins.branch && ins.branch.kind === 'call') {
    const tgt = ins.branch.target;
    if (tgt != null) return [nameOf.get(tgt) || ('func_' + tgt.toString(16).toUpperCase()) + '();'];
    return cmt();
  }
  if (ins.branch && (ins.branch.kind === 'cond' || ins.branch.kind === 'jump')) {
    return [];
  }

  if (cpu.id === '6502' || cpu.id === '65816') return mapAccu(cpu, ins, state, cmt);
  if (cpu.id === 'z80') return mapZ80(ins, state, cmt);
  return map68k(cpu, ins, state, cmt);
}

// ---------- 6502 / 65816 ----------
function mapAccu(cpu, ins, state, cmt) {
  const r = state.r;
  const m = ins.mnemonic;
  const ops = ins.operands;
  const imm = (s) => { const v = s.slice(1).replace(/^\$/, ''); const n = parseInt(v, 16); return isNaN(n) ? null : String(n); };
  const immRaw = (s) => s.slice(1);
  const addrOf = (s) => {
    const hex = s.replace(/\$/, '').replace(/,X$/, '').replace(/,Y$/, '').toUpperCase();
    const n = parseInt(hex, 16);
    return isNaN(n) ? null : n;
  };
  const set = (reg, expr) => { r[reg] = expr; return null; };
  const asm = () => ['// ' + ins.text];

  const num = (s) => {
    if (s == null) return null;
    if (s[0] === '#') return imm(s);
    return null;
  };
  const val = (s) => (r[s] != null ? r[s] : s); // substitute register expr
  const idxReg = ops.includes(',X') ? 'X' : ops.includes(',Y') ? 'Y' : null;

  const ADDR = (s, idx) => {
    const n = addrOf(s);
    if (n == null) return null;
    if (idx) {
      const iv = val(idx);
      return iv != null ? mb(cpu.id, n) + ' + ' + iv : mb(cpu.id, n) + ' + ' + idx;
    }
    return mb(cpu.id, n);
  };
  const opVal = (s) => {
    if (s == null) return null;
    if (s[0] === '#') return imm(s);
    if (s[0] === '$') return ADDR(s, idxReg);
    return null;
  };
  const expr = (s) => { const v = opVal(s); return v != null ? v : s; };

  switch (m) {
    case 'LDA': r.A = ops[0] === '#' ? imm(ops) : ADDR(ops, idxReg); return [];
    case 'LDX': r.X = ops[0] === '#' ? imm(ops) : ADDR(ops); return [];
    case 'LDY': r.Y = ops[0] === '#' ? imm(ops) : ADDR(ops); return [];
    case 'STA': return [ADDR(ops, idxReg) + ' = ' + (r.A || 'A') + ';'];
    case 'STX': return [ADDR(ops, null) + ' = ' + (r.X || 'X') + ';'];
    case 'STY': return [ADDR(ops, null) + ' = ' + (r.Y || 'Y') + ';'];
    case 'TAX': r.X = r.A; return [];
    case 'TAY': r.Y = r.A; return [];
    case 'TXA': r.A = r.X; return [];
    case 'TYA': r.A = r.Y; return [];
    case 'TSX': r.X = 'SP'; return [];
    case 'TXS': r.A = r.A; return ['// ' + ins.text];
    case 'INX': r.X = fold('+', r.X == null ? 'X' : r.X, '1'); return [];
    case 'INY': r.Y = fold('+', r.Y == null ? 'Y' : r.Y, '1'); return [];
    case 'DEX': r.X = fold('-', r.X == null ? 'X' : r.X, '1'); return [];
    case 'DEY': r.Y = fold('-', r.Y == null ? 'Y' : r.Y, '1'); return [];
    case 'INC': { const d = ADDR(ops); return [d + ' += 1;']; }
    case 'DEC': { const d = ADDR(ops); return [d + ' -= 1;']; }
    case 'ADC': r.A = fold('+', r.A == null ? 'A' : r.A, expr(ops)); return [];
    case 'SBC': r.A = fold('-', r.A == null ? 'A' : r.A, expr(ops)); return [];
    case 'CMP': state.cmp = { a: r.A || 'A', b: expr(ops) }; return [];
    case 'CPX': state.cmp = { a: r.X || 'X', b: expr(ops) }; return [];
    case 'CPY': state.cmp = { a: r.Y || 'Y', b: expr(ops) }; return [];
    case 'AND': r.A = fold('&', r.A == null ? 'A' : r.A, expr(ops)); return [];
    case 'ORA': r.A = fold('|', r.A == null ? 'A' : r.A, expr(ops)); return [];
    case 'EOR': r.A = fold('^', r.A == null ? 'A' : r.A, expr(ops)); return [];
    case 'ASL': if (ops === 'A') { r.A = fold('<<', r.A == null ? 'A' : r.A, '1'); return []; } return cmt();
    case 'LSR': if (ops === 'A') { r.A = fold('>>', r.A == null ? 'A' : r.A, '1'); return []; } return cmt();
    case 'ROL': case 'ROR': return cmt();
    case 'CLC': case 'SEC': case 'CLD': case 'SED': case 'CLI': case 'SEI': case 'CLV': return [];
    case 'NOP': return [];
    case 'PHA': case 'PHP': case 'PLA': case 'PLP': return ['// ' + ins.text];
    case 'BIT': state.cmp = { a: r.A || 'A', b: ops }; return [];
    default: return asm();
  }
}

// ---------- Z80 ----------
function mapZ80(ins, state, cmt) {
  const r = state.r;
  const m = ins.mnemonic;
  const ops = ins.operands; // e.g. "B,$42" / "A,n"
  const memExpr = (s) => {
    if (s === '(HL)') return r.HL != null ? 'mem8[' + r.HL + ']' : 'mem8[HL]';
    if (s === '(BC)' || s === '(DE)') return 'mem8[' + s + ']';
    if (s.startsWith('(I') && s.includes('+')) return null;
    const mm = s.match(/^\(\$([0-9A-F]+)\)$/i);
    if (mm) return 'mem8[0x' + mm[1].padStart(4, '0') + ']';
    const hx = s.match(/^\(0x([0-9A-F]+)\)$/i);
    if (hx) return 'mem8[0x' + hx[1].padStart(4, '0') + ']';
    return null;
  };
  const val = (s) => {
    if (s == null) return null;
    if (s.startsWith('$')) { const n = parseInt(s.slice(1), 16); return isNaN(n) ? null : String(n); }
    if (s.startsWith('(')) { const me = memExpr(s); return me != null ? me : s; }
    if (/^\d+$/.test(s)) return s;
    return r[s] != null ? r[s] : s;
  };
  const set = (reg, expr) => { r[reg] = expr; return null; };
  const cm = (s) => '// ' + s;

  if (m === 'LD') {
    const [dst, src] = ops.split(',');
    if (!src) return [cm(ins.text)];
    const sd = dst.trim(), ss = src.trim();
    if (sd.startsWith('(')) {
      const me = memExpr(sd);
      if (me) return [me + ' = ' + val(ss) + ';'];
      return [cm(ins.text)];
    }
    if (sd === 'A' || /^[BCDEHL]$/.test(sd)) { set(sd, val(ss)); return []; }
    if (/^(BC|DE|HL|SP|IX|IY)$/.test(sd)) { set(sd, val(ss)); return []; }
    if (sd === '(BC)' || sd === '(DE)') { return ['mem8[' + sd + '] = ' + val(ss) + ';']; }
    return [cm(ins.text)];
  }
  if (m === 'ADD' || m === 'ADC' || m === 'SUB' || m === 'SBC' || m === 'AND' || m === 'XOR' || m === 'OR') {
    const t = ops.trim();
    if (t.startsWith('A,')) {
      const src = t.slice(2).trim();
      const op = m === 'ADD' ? '+' : m === 'ADC' ? '+' : m === 'SUB' ? '-' : m === 'SBC' ? '-' : m === 'AND' ? '&' : m === 'XOR' ? '^' : '|';
      r.A = fold(op, r.A == null ? 'A' : r.A, val(src));
      return [];
    }
    if (/^HL,/.test(t)) {
      const src = t.slice(3).trim();
      r.HL = fold('+', r.HL == null ? 'HL' : r.HL, val(src));
      return [];
    }
    return [cm(ins.text)];
  }
  if (m === 'CP') {
    state.cmp = { a: r.A || 'A', b: val(ops.trim()) };
    return [];
  }
  if (m === 'INC' || m === 'DEC') {
    const t = ops.trim();
    if (/^[ABCDEHL]$/.test(t)) { r[t] = fold(m === 'INC' ? '+' : '-', r[t] == null ? t : r[t], '1'); return []; }
    if (/^(BC|DE|HL|IX|IY|SP)$/.test(t)) { r[t] = fold(m === 'INC' ? '+' : '-', r[t] == null ? t : r[t], '1'); return []; }
    return [cm(ins.text)];
  }
  if (m === 'LDIR' || m === 'LDDR' || m === 'CPIR' || m === 'CPDR') return [cm(ins.text)];
  if (m === 'PUSH' || m === 'POP') return [cm(ins.text)];
  if (m === 'BIT' || m === 'RES' || m === 'SET') return [cm(ins.text)];
  if (m === 'IN' || m === 'OUT' || m === 'INI' || m === 'IND' || m === 'OUTI' || m === 'OUTD' || m === 'INIR' || m === 'INDR' || m === 'OTIR' || m === 'OTDR') return [cm(ins.text)];
  if (m === 'EX' || m === 'EXX' || m === 'DAA' || m === 'CPL' || m === 'SCF' || m === 'CCF' || m === 'NEG' || m === 'RLCA' || m === 'RRCA' || m === 'RLA' || m === 'RRA' || m === 'RLD' || m === 'RRD' || m === 'IM' || m === 'DI' || m === 'EI' || m === 'NOP' || m === 'HALT') return [];
  if (m === 'DEFB') return [cm(ins.text)];
  return [cm(ins.text)];
}

// ---------- 68000 ----------
function map68k(cpu, ins, state, cmt) {
  const r = state.r;
  const m = ins.mnemonic.toLowerCase().replace(/\.(b|w|l)$/, '');
  const ops = ins.operands;
  const cm = (s) => '// ' + s;
  const val = (s) => {
    if (s == null) return null;
    if (s.startsWith('#')) {
      const v = s.slice(1);
      const n = v.startsWith('$') ? parseInt(v.slice(1).replace(/[.lw]?$/, ''), 16) : parseInt(v, 10);
      return isNaN(n) ? v : String(n);
    }
    if (/^[DA]\d$/.test(s)) return r[s] != null ? r[s] : s;
    if (s.includes('.l') || s.includes('.w')) {
      const a = s.replace(/^#?/, '').replace(/\.(l|w)$/, '');
      const n = parseInt(a.slice(1), 16);
      if (!isNaN(n)) return s.includes('.l') ? ml(n) : mw('68000', n);
    }
    return s;
  };

  // move/movea: operands are "src, dst" — dst = src
  if (m === 'move' || m === 'movea') {
    const [s1, s2] = ops.split(',').map((s) => s.trim());
    if (/^[DA]\d$/.test(s2)) {
      r[s2] = val(s1);
      return [];
    }
    if (/^[DA]\d$/.test(s1)) {
      const n = parseInt(s2.replace(/[^0-9a-fA-F]/g, ''), 16);
      if (!isNaN(n)) {
        const addr = /\.l$/.test(s2) ? ml(n) : mw('68000', n);
        return [addr + ' = ' + val(s1) + ';'];
      }
      return [cm(ins.text)];
    }
    return [cm(ins.text)];
  }
  if (m === 'moveq') {
    const [s1, s2] = ops.split(',').map((s) => s.trim());
    if (/^[DA]\d$/.test(s2)) { r[s2] = val(s1); return []; }
    return [cm(ins.text)];
  }
  if (m === 'add' || m === 'sub' || m === 'addx' || m === 'subx') {
    const [s1, s2] = ops.split(',').map((s) => s.trim());
    if (/^[DA]\d$/.test(s2) && (/^[DA]\d$/.test(s1) || s1.startsWith('#'))) {
      const op = m.startsWith('add') ? '+' : '-';
      r[s2] = fold(op, r[s2] == null ? s2 : r[s2], val(s1));
      return [];
    }
    return [cm(ins.text)];
  }
  if (m === 'adda' || m === 'suba') {
    const [s1, s2] = ops.split(',').map((s) => s.trim());
    if (/^A\d$/.test(s2)) { r[s2] = fold(m === 'adda' ? '+' : '-', r[s2] == null ? s2 : r[s2], val(s1)); return []; }
    return [cm(ins.text)];
  }
  if (m === 'addq' || m === 'subq') {
    const [s1, s2] = ops.split(',').map((s) => s.trim());
    const n = val(s1);
    if (/^[DA]\d$/.test(s2)) { r[s2] = fold(m === 'addq' ? '+' : '-', r[s2] == null ? s2 : r[s2], n); return []; }
    return [cm(ins.text)];
  }
  if (m === 'cmp') {
    const [s1, s2] = ops.split(',').map((s) => s.trim());
    if (/^[DA]\d$/.test(s2)) { state.cmp = { a: r[s2] || s2, b: val(s1) }; return []; }
    return [cm(ins.text)];
  }
  if (m === 'cmpi') {
    const [s1, s2] = ops.split(',').map((s) => s.trim());
    if (/^[DA]\d$/.test(s2)) { state.cmp = { a: r[s2] || s2, b: val(s1) }; return []; }
    return [cm(ins.text)];
  }
  if (m === 'tst') {
    const s = ops.trim();
    if (/^[DA]\d$/.test(s)) { state.cmp = { a: r[s] || s, b: '0' }; return []; }
    return [cm(ins.text)];
  }
  if (m === 'clr') { const s = ops.trim(); if (/^[DA]\d$/.test(s)) { r[s] = '0'; return []; } return [cm(ins.text)]; }
  if (m === 'neg') { const s = ops.trim(); if (/^[DA]\d$/.test(s)) { r[s] = fold('-', '0', r[s] || s); return []; } return [cm(ins.text)]; }
  if (m === 'not') { const s = ops.trim(); if (/^[DA]\d$/.test(s)) { r[s] = '(~(' + (r[s] || s) + '))'; return []; } return [cm(ins.text)]; }
  if (m === 'andi' || m === 'ori' || m === 'eori') {
    const [s1, s2] = ops.split(',').map((s) => s.trim());
    if (/^[DA]\d$/.test(s2)) {
      const op = m === 'andi' ? '&' : m === 'ori' ? '|' : '^';
      r[s2] = fold(op, r[s2] == null ? s2 : r[s2], val(s1));
      return [];
    }
    return [cm(ins.text)];
  }
  if (m === 'asl' || m === 'asr' || m === 'lsl' || m === 'lsr' || m === 'rol' || m === 'ror') {
    const [s1, s2] = ops.split(',').map((s) => s.trim());
    if (/^[DA]\d$/.test(s2)) {
      const dir = m.includes('l') ? '<<' : '>>';
      r[s2] = '(' + (r[s2] || s2) + ' ' + dir + ' ' + val(s1) + ')';
      return [];
    }
    return [cm(ins.text)];
  }
  if (m === 'ext' || m === 'swap' || m === 'exg') return [cm(ins.text)];
  if (m === 'lea' || m === 'pea') return [cm(ins.text)];
  if (m === 'movep') return [cm(ins.text)];
  if (m === 'movem') return [cm(ins.text)];
  if (m === 'divu' || m === 'divs' || m === 'mulu' || m === 'muls') {
    const [s1, s2] = ops.split(',').map((s) => s.trim());
    if (/^D\d$/.test(s2)) { r[s2] = '(' + (r[s2] || s2) + ' ' + (m.includes('div') ? '/' : '*') + ' ' + val(s1) + ')'; return []; }
    return [cm(ins.text)];
  }
  if (m === 'link' || m === 'unlk') return [cm(ins.text)];
  if (m === 'nop' || m === 'reset' || m === 'stop' || m === 'rte' || m === 'rtr' || m === 'trapv') return [];
  if (m === 'trap') return [cm(ins.text)];
  if (m === 'btst' || m === 'bchg' || m === 'bclr' || m === 'bset') return [cm(ins.text)];
  if (m === 'scc' || m.startsWith('s')) return [cm(ins.text)];
  if (m === 'dc.w' || m === 'dc') return [cm(ins.text)];
  return [cm(ins.text)];
}
