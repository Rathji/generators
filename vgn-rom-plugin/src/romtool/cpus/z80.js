// Zilog Z80 disassembler (Sega Master System / Game Gear CPU).
// Handles primary opcodes plus the ED, CB, DD and FD prefixes (incl. DD CB d).

const REGS = ['B', 'C', 'D', 'E', 'H', 'L', '(HL)', 'A'];
const CC = ['NZ', 'Z', 'NC', 'C', 'PO', 'PE', 'P', 'M'];

// Placeholders: %% = 16-bit immediate/address, % = 8-bit, ? = 8-bit relative
const OP = new Array(256);
function S(m, code) { OP[code] = m; }

S('NOP', 0x00); S('LD BC,%%', 0x01); S('LD (BC),A', 0x02); S('INC BC', 0x03); S('INC B', 0x04); S('DEC B', 0x05); S('LD B,%', 0x06); S('RLCA', 0x07);
S('EX AF,AF\'', 0x08); S('ADD HL,BC', 0x09); S('LD A,(BC)', 0x0a); S('DEC BC', 0x0b); S('INC C', 0x0c); S('DEC C', 0x0d); S('LD C,%', 0x0e); S('RRCA', 0x0f);
S('DJNZ ?', 0x10); S('LD DE,%%', 0x11); S('LD (DE),A', 0x12); S('INC DE', 0x13); S('INC D', 0x14); S('DEC D', 0x15); S('LD D,%', 0x16); S('RLA', 0x17);
S('JR ?', 0x18); S('ADD HL,DE', 0x19); S('LD A,(DE)', 0x1a); S('DEC DE', 0x1b); S('INC E', 0x1c); S('DEC E', 0x1d); S('LD E,%', 0x1e); S('RRA', 0x1f);
S('JR NZ,?', 0x20); S('LD HL,%%', 0x21); S('LD (%%),HL', 0x22); S('INC HL', 0x23); S('INC H', 0x24); S('DEC H', 0x25); S('LD H,%', 0x26); S('DAA', 0x27);
S('JR Z,?', 0x28); S('ADD HL,HL', 0x29); S('LD HL,(%%)', 0x2a); S('DEC HL', 0x2b); S('INC L', 0x2c); S('DEC L', 0x2d); S('LD L,%', 0x2e); S('CPL', 0x2f);
S('JR NC,?', 0x30); S('LD SP,%%', 0x31); S('LD (%%),A', 0x32); S('INC SP', 0x33); S('INC (HL)', 0x34); S('DEC (HL)', 0x35); S('LD (HL),%', 0x36); S('SCF', 0x37);
S('JR C,?', 0x38); S('ADD HL,SP', 0x39); S('LD A,(%%)', 0x3a); S('DEC SP', 0x3b); S('INC A', 0x3c); S('DEC A', 0x3d); S('LD A,%', 0x3e); S('CCF', 0x3f);
S('RET NZ', 0xc0); S('POP BC', 0xc1); S('JP NZ,%%', 0xc2); S('JP %%', 0xc3); S('CALL NZ,%%', 0xc4); S('PUSH BC', 0xc5); S('ADD A,%', 0xc6); S('RST ', 0xc7);
S('RET Z', 0xc8); S('RET', 0xc9); S('JP Z,%%', 0xca); S('CB', 0xcb); S('CALL Z,%%', 0xcc); S('CALL %%', 0xcd); S('ADC A,%', 0xce); S('RST ', 0xcf);
S('RET NC', 0xd0); S('POP DE', 0xd1); S('JP NC,%%', 0xd2); S('OUT (%),A', 0xd3); S('CALL NC,%%', 0xd4); S('PUSH DE', 0xd5); S('SUB %', 0xd6); S('RST ', 0xd7);
S('RET C', 0xd8); S('EXX', 0xd9); S('JP C,%%', 0xda); S('IN A,(%)', 0xdb); S('CALL C,%%', 0xdc); S('DD', 0xdd); S('SBC A,%', 0xde); S('RST ', 0xdf);
S('RET PO', 0xe0); S('POP HL', 0xe1); S('JP PO,%%', 0xe2); S('EX (SP),HL', 0xe3); S('CALL PO,%%', 0xe4); S('PUSH HL', 0xe5); S('AND %', 0xe6); S('RST ', 0xe7);
S('RET PE', 0xe8); S('JP (HL)', 0xe9); S('JP PE,%%', 0xea); S('EX DE,HL', 0xeb); S('CALL PE,%%', 0xec); S('ED', 0xed); S('XOR %', 0xee); S('RST ', 0xef);
S('RET P', 0xf0); S('POP AF', 0xf1); S('JP P,%%', 0xf2); S('DI', 0xf3); S('CALL P,%%', 0xf4); S('PUSH AF', 0xf5); S('OR %', 0xf6); S('RST ', 0xf7);
S('RET M', 0xf8); S('LD SP,HL', 0xf9); S('JP M,%%', 0xfa); S('EI', 0xfb); S('CALL M,%%', 0xfc); S('FD', 0xfd); S('CP %', 0xfe); S('RST ', 0xff);

const ALU = ['ADD A,', 'ADC A,', 'SUB ', 'SBC A,', 'AND ', 'XOR ', 'OR ', 'CP '];
const SHIFT = ['RLC ', 'RRC ', 'RL ', 'RR ', 'SLA ', 'SRA ', 'SLL ', 'SRL '];

const ED_TABLE = new Array(256).fill(null);
const ED = [
  ['IN B,(C)', 0x40], ['OUT (C),B', 0x41], ['SBC HL,BC', 0x42], ['LD (%%),BC', 0x43], ['NEG', 0x44], ['RETN', 0x45], ['IM 0', 0x46], ['LD I,A', 0x47],
  ['IN C,(C)', 0x48], ['OUT (C),C', 0x49], ['ADC HL,BC', 0x4a], ['LD BC,(%%)', 0x4b], ['NEG', 0x4c], ['RETI', 0x4d], ['IM 0', 0x4e], ['LD R,A', 0x4f],
  ['IN D,(C)', 0x50], ['OUT (C),D', 0x51], ['SBC HL,DE', 0x52], ['LD (%%),DE', 0x53], ['NEG', 0x54], ['RETN', 0x55], ['IM 1', 0x56], ['LD A,I', 0x57],
  ['IN E,(C)', 0x58], ['OUT (C),E', 0x59], ['ADC HL,DE', 0x5a], ['LD DE,(%%)', 0x5b], ['NEG', 0x5c], ['RETN', 0x5d], ['IM 2', 0x5e], ['LD A,R', 0x5f],
  ['IN H,(C)', 0x60], ['OUT (C),H', 0x61], ['SBC HL,HL', 0x62], ['LD (%%),HL', 0x63], ['NEG', 0x64], ['RETN', 0x65], ['IM 0', 0x66], ['RRD', 0x67],
  ['IN L,(C)', 0x68], ['OUT (C),L', 0x69], ['ADC HL,HL', 0x6a], ['LD HL,(%%)', 0x6b], ['NEG', 0x6c], ['RETN', 0x6d], ['IM 0', 0x6e], ['RLD', 0x6f],
  ['IN (C)', 0x70], ['OUT (C),0', 0x71], ['SBC HL,SP', 0x72], ['LD (%%),SP', 0x73], ['NEG', 0x74], ['RETN', 0x75], ['IM 1', 0x76], ['NOP', 0x77],
  ['IN A,(C)', 0x78], ['OUT (C),A', 0x79], ['ADC HL,SP', 0x7a], ['LD SP,(%%)', 0x7b], ['NEG', 0x7c], ['RETN', 0x7d], ['IM 2', 0x7e], ['NOP', 0x7f],
  ['LDI', 0xa0], ['CPI', 0xa1], ['INI', 0xa2], ['OUTI', 0xa3], ['LDD', 0xa4], ['CPD', 0xa5], ['IND', 0xa6], ['OUTD', 0xa7],
  ['LDIR', 0xa8], ['CPIR', 0xa9], ['INIR', 0xaa], ['OTIR', 0xab], ['LDDR', 0xac], ['CPDR', 0xad], ['INDR', 0xae], ['OTDR', 0xaf],
];
for (const [m, c] of ED) ED_TABLE[c] = m;

export const cpu = {
  id: 'z80',
  label: 'Master System · Z80',
  addrFmt: (a) => '$' + (a & 0xffff).toString(16).toUpperCase().padStart(4, '0'),
  condText: {
    'JR NZ': 'Z==0', 'JR Z': 'Z==1', 'JR NC': 'C==0', 'JR C': 'C==1', 'DJNZ': 'B!=0',
    'JP NZ': 'Z==0', 'JP Z': 'Z==1', 'JP NC': 'C==0', 'JP C': 'C==1',
    'CALL NZ': 'Z==0', 'CALL Z': 'Z==1', 'CALL NC': 'C==0', 'CALL C': 'C==1',
    'RET NZ': 'Z==0', 'RET Z': 'Z==1', 'RET NC': 'C==0', 'RET C': 'C==1',
  },

  decode(mem, addr) {
    const op = mem.readByte(addr);
    if (op == null) return null;
    if (op === 0xcb) return this._cb(mem, addr, addr + 1, null);
    if (op === 0xed) return this._ed(mem, addr, addr + 1);
    if (op === 0xdd || op === 0xfd) {
      const op2 = mem.readByte(addr + 1);
      if (op2 == null) return this._defb(mem, addr, op);
      if (op2 === 0xcb) return this._cb(mem, addr, addr + 3, op === 0xdd ? 'IX' : 'IY');
      if (op2 === 0xed) return this._ed(mem, addr, addr + 2);
      return this._plain(mem, addr, addr + 1, op2, op === 0xdd ? 'IX' : 'IY');
    }
    return this._plain(mem, addr, addr, op, null);
  },

  _plain(mem, startAddr, opAddr, op, ix) {
    let text, size, branch = null;

    if ((op & 0xc0) === 0x40) {
      if (ix == null && op === 0x76) {
        text = 'HALT';
        size = (opAddr + 1) - startAddr;
      } else {
        const dest = (op >> 3) & 7, src = op & 7;
        const needsDisp = ix != null && (usesMem(dest) || usesMem(src));
        text = 'LD ' + regStr(dest, ix) + ',' + regStr(src, ix);
        size = (opAddr - startAddr) + (needsDisp ? 2 : 1);
        if (needsDisp) {
          const d = readByte(mem, opAddr + 1);
          text = fillDisp(text, d);
        }
      }
    } else if ((op & 0xc0) === 0x80) {
      const grp = (op >> 3) & 7, src = op & 7;
      const needsDisp = ix != null && usesMem(src);
      text = ALU[grp] + regStr(src, ix);
      size = (opAddr - startAddr) + (needsDisp ? 2 : 1);
      if (needsDisp) {
        const d = readByte(mem, opAddr + 1);
        text = fillDisp(text, d);
      }
    } else {
      const base = OP[op];
      if (base == null) return this._defb(mem, startAddr, op);
      let text2 = ix != null ? ixSub(base, ix) : base;
      let disp = null;
      if (ix != null && text2.includes('+d)')) {
        disp = readByte(mem, opAddr + 1);
        text2 = fillDisp(text2, disp);
      }
      text = text2;
      const at = disp != null ? opAddr + 2 : opAddr + 1;
      const p1 = readByte(mem, at), p2 = readByte(mem, at + 1);

      if (text.includes('%%')) {
        const nn = (p1 == null ? 0 : p1) | ((p2 == null ? 0 : p2) << 8);
        text = text.replace('%%', hex4(nn));
        size = (at + 2) - startAddr;
        if (mnemonicOf(text) === 'JP') branch = hasCC(text)
          ? { kind: 'cond', target: nn, fallthrough: true, conditional: true }
          : { kind: 'jump', target: nn, fallthrough: false };
        else if (mnemonicOf(text) === 'CALL') branch = { kind: 'call', target: nn, fallthrough: true, conditional: hasCC(text) };
      } else if (text.includes('?')) {
        const rel = p1 == null ? 0 : p1;
        const off = rel & 0x80 ? rel - 0x100 : rel;
        const end = startAddr + ((at + 1) - startAddr);
        const target = (end + off) & 0xffff;
        text = text.replace('?', hex4(target));
        size = (at + 1) - startAddr;
        branch = (mnemonicOf(text) === 'JR' && !hasCC(text))
          ? { kind: 'jump', target, fallthrough: false }
          : { kind: 'cond', target, fallthrough: true, conditional: true };
      } else if (text.includes('%')) {
        text = text.replace('%', hex2(p1 == null ? 0 : p1));
        size = (at + 1) - startAddr;
      } else if (mnemonicOf(text) === 'RST') {
        text = 'RST ' + hex2(op & 0x38);
        size = (opAddr + 1) - startAddr;
        branch = { kind: 'call', target: op & 0x38, fallthrough: true };
      } else if (text.startsWith('RET ') && text !== 'RET') {
        size = (opAddr + 1) - startAddr;
        branch = { kind: 'ret', target: null, fallthrough: true, conditional: true };
      } else if (text === 'RET') {
        size = (opAddr + 1) - startAddr;
        branch = { kind: 'ret', target: null, fallthrough: false };
      } else if (text === 'JP (HL)' || text === 'JP (IX)' || text === 'JP (IY)') {
        size = (opAddr + 1) - startAddr;
        branch = { kind: 'jump', target: null, fallthrough: false };
      } else if (text === 'RETI' || text === 'RETN') {
        size = (opAddr + 1) - startAddr;
        branch = { kind: 'ret', target: null, fallthrough: false };
      } else {
        size = (opAddr + 1) - startAddr + (disp != null ? 1 : 0);
      }
    }

    return inst(mem, startAddr, text, size, branch, op);
  },

  _cb(mem, startAddr, opAddr, ix) {
    const op = readByte(mem, opAddr);
    if (op == null) return null;
    let text;
    if ((op & 0xc0) === 0) {
      text = SHIFT[(op >> 3) & 7] + regStr(op & 7, ix);
    } else {
      const opn = (op & 0xc0) === 0x40 ? 'BIT' : (op & 0xc0) === 0x80 ? 'RES' : 'SET';
      text = opn + ' ' + ((op >> 3) & 7) + ',' + regStr(op & 7, ix);
    }
    const size = (opAddr + 1) - startAddr;
    if (ix != null) {
      const d = readByte(mem, opAddr - 1);
      text = fillDisp(text, d);
    }
    return inst(mem, startAddr, text, size, null, op);
  },

  _ed(mem, startAddr, opAddr) {
    const op = readByte(mem, opAddr);
    if (op == null) return null;
    const base = ED_TABLE[op];
    if (base == null) return inst(mem, startAddr, 'DEFB ' + hex2(op), 2, null, op);
    let text = base;
    let branch = null;
    let size;
    if (text.includes('%%')) {
      const p1 = readByte(mem, opAddr + 1), p2 = readByte(mem, opAddr + 2);
      text = text.replace('%%', hex4((p1 == null ? 0 : p1) | ((p2 == null ? 0 : p2) << 8)));
      size = 4;
    } else {
      size = 2;
    }
    if (text === 'RETI' || text === 'RETN') branch = { kind: 'ret', target: null, fallthrough: false };
    return inst(mem, startAddr, text, size, branch, op);
  },

  _defb(mem, addr, op) {
    return inst(mem, addr, 'DEFB ' + hex2(op), 1, null, op);
  },
};

function inst(mem, startAddr, text, size, branch, op) {
  const bytes = mem.readBytes(startAddr, size);
  if (!bytes) return null;
  const sp = text.split(' ');
  return { addr: startAddr, size, bytes, mnemonic: sp[0], operands: sp.slice(1).join(' '), text, branch };
}
function mnemonicOf(text) { return text.split(' ')[0]; }
function hasCC(text) { return /^\S+\s+(NZ|Z|NC|C|PO|PE|P|M),/.test(text); }
function regStr(r, ix) {
  if (r === 4) return ix != null ? '(I' + (ix === 'IX' ? 'X' : 'Y') + '+d)' : 'H';
  if (r === 5) return ix != null ? '(I' + (ix === 'IX' ? 'X' : 'Y') + '+d)' : 'L';
  if (r === 6) return ix != null ? '(I' + (ix === 'IX' ? 'X' : 'Y') + '+d)' : '(HL)';
  return REGS[r];
}
function usesMem(r) { return r === 4 || r === 5 || r === 6; }
function ixSub(text, ix) {
  const n = ix;
  if (text === 'LD H,%') return 'LD (' + n + '+d),%';
  if (text === 'LD L,%') return 'LD (' + n + '+d),%';
  if (text === 'INC H' || text === 'INC L' || text === 'INC (HL)') return 'INC (' + n + '+d)';
  if (text === 'DEC H' || text === 'DEC L' || text === 'DEC (HL)') return 'DEC (' + n + '+d)';
  if (text === 'LD (HL),%') return 'LD (' + n + '+d),%';
  if (text === 'LD (HL),%%') return 'LD (' + n + '+d),%%';
  if (text === 'ADD HL,BC') return 'ADD ' + n + ',BC';
  if (text === 'ADD HL,DE') return 'ADD ' + n + ',DE';
  if (text === 'ADD HL,HL') return 'ADD ' + n + ',' + n;
  if (text === 'ADD HL,SP') return 'ADD ' + n + ',SP';
  if (text === 'LD HL,%%') return 'LD ' + n + ',%%';
  if (text === 'LD (%%),HL') return 'LD (%%),' + n;
  if (text === 'LD HL,(%%)') return 'LD ' + n + ',(%%)';
  if (text === 'INC HL') return 'INC ' + n;
  if (text === 'DEC HL') return 'DEC ' + n;
  if (text === 'POP HL') return 'POP ' + n;
  if (text === 'PUSH HL') return 'PUSH ' + n;
  if (text === 'EX (SP),HL') return 'EX (SP),' + n;
  if (text === 'EX DE,HL') return 'EX DE,' + n;
  if (text === 'JP (HL)') return 'JP (' + n + ')';
  if (text === 'LD SP,HL') return 'LD SP,' + n;
  return text;
}
function fillDisp(text, d) {
  if (d == null) return text;
  return text.replaceAll('+d)', fmtDisp(d) + ')');
}
function fmtDisp(b) {
  const s = b & 0x80 ? b - 0x100 : b;
  return (s < 0 ? '-' : '+') + '$' + hex2(Math.abs(s) & 0xff);
}
function readByte(mem, addr) { const b = mem.readByte(addr); return b == null ? null : b; }
function hex2(n) { return '$' + n.toString(16).toUpperCase().padStart(2, '0'); }
function hex4(n) { return '$' + n.toString(16).toUpperCase().padStart(4, '0'); }
