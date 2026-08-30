// MOS 6502 disassembler (NES CPU).
// Covers official opcodes + the commonly used undocumented NMOS opcodes.

const IMP = 0, ACC = 1, IMM = 2, ZP = 3, ZPX = 4, ZPY = 5, ABS = 6, ABX = 7, ABY = 8, IND = 9, IZX = 10, IZY = 11, REL = 12;

const OP = new Array(256);
function S(m, mode, code) { OP[code] = [m, mode]; }

// official
S('BRK', IMP, 0x00); S('ORA', IZX, 0x01); S('ORA', ZP, 0x05); S('ASL', ZP, 0x06); S('PHP', IMP, 0x08); S('ORA', IMM, 0x09); S('ASL', ACC, 0x0a); S('ORA', ABS, 0x0d); S('ASL', ABS, 0x0e);
S('BPL', REL, 0x10); S('ORA', IZY, 0x11); S('ORA', ZPX, 0x15); S('ASL', ZPX, 0x16); S('CLC', IMP, 0x18); S('ORA', ABY, 0x19); S('ORA', ABX, 0x1d); S('ASL', ABX, 0x1e);
S('JSR', ABS, 0x20); S('AND', IZX, 0x21); S('BIT', ZP, 0x24); S('AND', ZP, 0x25); S('ROL', ZP, 0x26); S('PLP', IMP, 0x28); S('AND', IMM, 0x29); S('ROL', ACC, 0x2a); S('BIT', ABS, 0x2c); S('AND', ABS, 0x2d); S('ROL', ABS, 0x2e);
S('BMI', REL, 0x30); S('AND', IZY, 0x31); S('AND', ZPX, 0x35); S('ROL', ZPX, 0x36); S('SEC', IMP, 0x38); S('AND', ABY, 0x39); S('AND', ABX, 0x3d); S('ROL', ABX, 0x3e);
S('RTI', IMP, 0x40); S('EOR', IZX, 0x41); S('EOR', ZP, 0x45); S('LSR', ZP, 0x46); S('PHA', IMP, 0x48); S('EOR', IMM, 0x49); S('LSR', ACC, 0x4a); S('JMP', ABS, 0x4c); S('EOR', ABS, 0x4d); S('LSR', ABS, 0x4e);
S('BVC', REL, 0x50); S('EOR', IZY, 0x51); S('EOR', ZPX, 0x55); S('LSR', ZPX, 0x56); S('CLI', IMP, 0x58); S('EOR', ABY, 0x59); S('EOR', ABX, 0x5d); S('LSR', ABX, 0x5e);
S('RTS', IMP, 0x60); S('ADC', IZX, 0x61); S('ADC', ZP, 0x65); S('ROR', ZP, 0x66); S('PLA', IMP, 0x68); S('ADC', IMM, 0x69); S('ROR', ACC, 0x6a); S('JMP', IND, 0x6c); S('ADC', ABS, 0x6d); S('ROR', ABS, 0x6e);
S('BVS', REL, 0x70); S('ADC', IZY, 0x71); S('ADC', ZPX, 0x75); S('ROR', ZPX, 0x76); S('SEI', IMP, 0x78); S('ADC', ABY, 0x79); S('ADC', ABX, 0x7d); S('ROR', ABX, 0x7e);
S('STA', IZX, 0x81); S('STY', ZP, 0x84); S('STA', ZP, 0x85); S('STX', ZP, 0x86); S('DEY', IMP, 0x88); S('TXA', IMP, 0x8a); S('STY', ABS, 0x8c); S('STA', ABS, 0x8d); S('STX', ABS, 0x8e);
S('BCC', REL, 0x90); S('STA', IZY, 0x91); S('STY', ZPX, 0x94); S('STA', ZPX, 0x95); S('STX', ZPY, 0x96); S('TYA', IMP, 0x98); S('STA', ABY, 0x99); S('TXS', IMP, 0x9a); S('STA', ABX, 0x9d);
S('LDY', IMM, 0xa0); S('LDA', IZX, 0xa1); S('LDX', IMM, 0xa2); S('LDY', ZP, 0xa4); S('LDA', ZP, 0xa5); S('LDX', ZP, 0xa6); S('TAY', IMP, 0xa8); S('LDA', IMM, 0xa9); S('TAX', IMP, 0xaa); S('LDY', ABS, 0xac); S('LDA', ABS, 0xad); S('LDX', ABS, 0xae);
S('BCS', REL, 0xb0); S('LDA', IZY, 0xb1); S('LDY', ZPX, 0xb4); S('LDA', ZPX, 0xb5); S('LDX', ZPY, 0xb6); S('CLV', IMP, 0xb8); S('LDA', ABY, 0xb9); S('TSX', IMP, 0xba); S('LDY', ABX, 0xbc); S('LDA', ABX, 0xbd); S('LDX', ABY, 0xbe);
S('CPY', IMM, 0xc0); S('CMP', IZX, 0xc1); S('CPY', ZP, 0xc4); S('CMP', ZP, 0xc5); S('DEC', ZP, 0xc6); S('INY', IMP, 0xc8); S('CMP', IMM, 0xc9); S('DEX', IMP, 0xca); S('CPY', ABS, 0xcc); S('CMP', ABS, 0xcd); S('DEC', ABS, 0xce);
S('BNE', REL, 0xd0); S('CMP', IZY, 0xd1); S('CMP', ZPX, 0xd5); S('DEC', ZPX, 0xd6); S('CLD', IMP, 0xd8); S('CMP', ABY, 0xd9); S('CMP', ABX, 0xdd); S('DEC', ABX, 0xde);
S('CPX', IMM, 0xe0); S('SBC', IZX, 0xe1); S('CPX', ZP, 0xe4); S('SBC', ZP, 0xe5); S('INC', ZP, 0xe6); S('INX', IMP, 0xe8); S('SBC', IMM, 0xe9); S('NOP', IMP, 0xea); S('CPX', ABS, 0xec); S('SBC', ABS, 0xed); S('INC', ABS, 0xee);
S('BEQ', REL, 0xf0); S('SBC', IZY, 0xf1); S('SBC', ZPX, 0xf5); S('INC', ZPX, 0xf6); S('SED', IMP, 0xf8); S('SBC', ABY, 0xf9); S('SBC', ABX, 0xfd); S('INC', ABX, 0xfe);

// undocumented NMOS opcodes
const UNDOC = [
  [0x02, 'JAM', IMP], [0x12, 'JAM', IMP], [0x22, 'JAM', IMP], [0x32, 'JAM', IMP], [0x42, 'JAM', IMP], [0x52, 'JAM', IMP],
  [0x62, 'JAM', IMP], [0x72, 'JAM', IMP], [0x92, 'JAM', IMP], [0xb2, 'JAM', IMP], [0xd2, 'JAM', IMP], [0xf2, 'JAM', IMP],
  [0x03, 'SLO', IZX], [0x07, 'SLO', ZP], [0x0b, 'ANC', IMM], [0x0f, 'SLO', ABS],
  [0x13, 'RLA', IZX], [0x17, 'RLA', ZP], [0x1b, 'ANC', IMM], [0x1f, 'RLA', ABS],
  [0x23, 'SRE', IZX], [0x27, 'SRE', ZP], [0x2b, 'ANC', IMM], [0x2f, 'SRE', ABS],
  [0x33, 'RRA', IZX], [0x37, 'RRA', ZP], [0x3b, 'ANC', IMM], [0x3f, 'RRA', ABS],
  [0x43, 'SAX', IZX], [0x47, 'SAX', ZP], [0x4b, 'ALR', IMM], [0x4f, 'SAX', ABS],
  [0x53, 'LAX', IZX], [0x57, 'LAX', ZP], [0x5b, 'SRE', ABY], [0x5f, 'LAX', ABS],
  [0x63, 'SLO', IZX], [0x67, 'RLA', ZP], [0x6b, 'ARR', IMM], [0x6f, 'RRA', ABS],
  [0x73, 'RLA', IZX], [0x77, 'RLA', ZP], [0x7b, 'ANC', IMM], [0x7f, 'RRA', ABS],
  [0x83, 'SAX', IZX], [0x87, 'SAX', ZP], [0x8b, 'XAA', IMM], [0x8f, 'SAX', ABS],
  [0x93, 'AHX', IZY], [0x97, 'SAX', ZPY], [0x9b, 'TAS', ABY], [0x9c, 'SHY', ABX], [0x9f, 'AHX', ABY],
  [0xa3, 'LAX', IZX], [0xa7, 'LAX', ZP], [0xab, 'LAX', IMM], [0xaf, 'LAX', ABS],
  [0xb3, 'LAX', IZY], [0xb7, 'LAX', ZPY], [0xbb, 'LAS', ABY], [0xbf, 'LAX', ABX],
  [0xc3, 'DCP', IZX], [0xc7, 'DCP', ZP], [0xcb, 'AXS', IMM], [0xcf, 'DCP', ABS],
  [0xd3, 'DCP', IZY], [0xd7, 'DCP', ZPX], [0xdb, 'DCP', ABY], [0xdf, 'DCP', ABX],
  [0xe3, 'ISC', IZX], [0xe7, 'ISC', ZP], [0xeb, 'SBC', IMM], [0xef, 'ISC', ABS],
  [0xf3, 'ISC', IZY], [0xf7, 'ISC', ZPX], [0xfb, 'ISC', ABY], [0xff, 'ISC', ABX],
];
for (const [c, m, mo] of UNDOC) OP[c] = [m, mo];

// NOP variants
for (const c of [0x80, 0x82, 0x89, 0xc2, 0xe2]) OP[c] = ['NOP', IMM];
for (const c of [0x04, 0x44, 0x64]) OP[c] = ['NOP', ZP];
for (const c of [0x14, 0x34, 0x54, 0x74, 0xd4, 0xf4]) OP[c] = ['NOP', ZPX];
OP[0x0c] = ['NOP', ABS];
for (const c of [0x1c, 0x3c, 0x5c, 0x7c, 0xdc, 0xfc]) OP[c] = ['NOP', ABX];
for (const c of [0x1a, 0x3a, 0x5a, 0x7a, 0xda, 0xfa]) OP[c] = ['NOP', IMP];
OP[0x9e] = ['SHX', ABY];

const MODE_SIZE = [1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 2, 2, 2];

const COND = { BPL: 'N==0', BMI: 'N==1', BVC: 'V==0', BVS: 'V==1', BCC: 'C==0', BCS: 'C==1', BNE: 'Z==0', BEQ: 'Z==1' };

function hex2(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }
function hex4(n) { return n.toString(16).toUpperCase().padStart(4, '0'); }

export const cpu = {
  id: '6502',
  label: 'NES · 6502',
  addrFmt: (a) => '$' + (a & 0xffff).toString(16).toUpperCase().padStart(4, '0'),
  condText: COND,

  decode(mem, addr) {
    const op = mem.readByte(addr);
    if (op == null) return null;
    const entry = OP[op];
    if (!entry) {
      const bytes = mem.readBytes(addr, 1);
      return { addr, size: 1, bytes, mnemonic: '.byte', operands: '$' + hex2(op), text: '.byte $' + hex2(op), branch: null };
    }
    const mnemonic = entry[0];
    const mode = entry[1];
    const size = MODE_SIZE[mode];
    const bytes = mem.readBytes(addr, size);
    if (!bytes) return null;
    const next = (addr + size) & 0xffff;
    let operands = '';
    let target = null;

    switch (mode) {
      case IMM: operands = '#$' + hex2(bytes[1]); break;
      case ZP: operands = '$' + hex2(bytes[1]); break;
      case ZPX: operands = '$' + hex2(bytes[1]) + ',X'; break;
      case ZPY: operands = '$' + hex2(bytes[1]) + ',Y'; break;
      case ABS: operands = '$' + hex4((bytes[2] << 8) | bytes[1]); break;
      case ABX: operands = '$' + hex4((bytes[2] << 8) | bytes[1]) + ',X'; break;
      case ABY: operands = '$' + hex4((bytes[2] << 8) | bytes[1]) + ',Y'; break;
      case IND: operands = '($' + hex4((bytes[2] << 8) | bytes[1]) + ')'; break;
      case IZX: operands = '($' + hex2(bytes[1]) + ',X)'; break;
      case IZY: operands = '($' + hex2(bytes[1]) + '),Y'; break;
      case REL: {
        const off = (bytes[1] & 0x80) ? bytes[1] - 0x100 : bytes[1];
        target = (next + off) & 0xffff;
        operands = '$' + hex4(target);
        break;
      }
      case ACC: operands = 'A'; break;
      default: break;
    }

    let branch = null;
    if (mode === REL) {
      branch = { kind: 'cond', target, fallthrough: true };
    } else if (mnemonic === 'JMP') {
      if (mode === ABS) target = (bytes[2] << 8) | bytes[1];
      branch = { kind: 'jump', target: mode === IND ? null : target, fallthrough: false };
    } else if (mnemonic === 'JSR') {
      target = (bytes[2] << 8) | bytes[1];
      branch = { kind: 'call', target, fallthrough: true };
    } else if (mnemonic === 'RTS' || mnemonic === 'RTI') {
      branch = { kind: 'ret', target: null, fallthrough: false };
    } else if (mnemonic === 'JAM') {
      branch = { kind: 'jump', target: null, fallthrough: false };
    }

    return { addr, size, bytes, mnemonic, operands, text: mnemonic + (operands ? ' ' + operands : ''), branch };
  },
};
