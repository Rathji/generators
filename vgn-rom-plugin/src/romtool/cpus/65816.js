// WDC 65C816 disassembler (SNES CPU).
// M/X register width is configurable (cpu.opts.m / cpu.opts.x) as in most static disassemblers.

const IMP = 0, ACC = 1, IMM_M = 2, IMM_X = 3, IMM = 4, DP = 5, DPX = 6, DPY = 7,
  ABS = 8, ABX = 9, ABY = 10, LONG = 11, LONGX = 12, IND = 13, INDX = 14,
  IDP = 15, IDPX = 16, IDPY = 17, IDPL = 18, SREL = 19, SRELY = 20,
  REL8 = 21, REL16 = 22, BLK = 23, WDM = 24, PEA_M = 25, PEI = 26, PER_M = 27;

export const MODE = { IMP: 0, ACC: 1, IMM_M: 2, IMM_X: 3, IMM: 4, DP: 5, DPX: 6, DPY: 7, ABS: 8, ABX: 9, ABY: 10, LONG: 11, LONGX: 12, IND: 13, INDX: 14, IDP: 15, IDPX: 16, IDPY: 17, IDPL: 18, SREL: 19, SRELY: 20, REL8: 21, REL16: 22, BLK: 23, WDM: 24, PEA_M: 25, PEI: 26, PER_M: 27 };

const OP = new Array(256);
function S(m, mode, code) { OP[code] = [m, mode]; }

S('BRK', IMM, 0x00); S('ORA', IDPX, 0x01); S('COP', IMM, 0x02); S('ORA', IDPL, 0x03); S('TSB', DP, 0x04); S('ORA', DP, 0x05); S('ASL', DP, 0x06); S('ORA', IDPL, 0x07);
S('PHP', IMP, 0x08); S('ORA', IMM_M, 0x09); S('ASL', ACC, 0x0a); S('PHD', IMP, 0x0b); S('TSB', ABS, 0x0c); S('ORA', ABS, 0x0d); S('ASL', ABS, 0x0e); S('ORA', LONG, 0x0f);
S('BPL', REL8, 0x10); S('ORA', IDPY, 0x11); S('ORA', IDP, 0x12); S('ORA', SRELY, 0x13); S('TRB', DP, 0x14); S('ORA', DPX, 0x15); S('ASL', DPX, 0x16); S('ORA', IDPY, 0x17);
S('CLC', IMP, 0x18); S('ORA', ABY, 0x19); S('INC', ACC, 0x1a); S('TCS', IMP, 0x1b); S('TRB', ABS, 0x1c); S('ORA', ABX, 0x1d); S('ASL', ABX, 0x1e); S('ORA', LONGX, 0x1f);
S('JSR', ABS, 0x20); S('AND', IDPX, 0x21); S('JSL', LONG, 0x22); S('AND', IDPL, 0x23); S('BIT', DP, 0x24); S('AND', DP, 0x25); S('ROL', DP, 0x26); S('AND', IDPL, 0x27);
S('PLP', IMP, 0x28); S('AND', IMM_M, 0x29); S('ROL', ACC, 0x2a); S('PLD', IMP, 0x2b); S('BIT', ABS, 0x2c); S('AND', ABS, 0x2d); S('ROL', ABS, 0x2e); S('AND', LONG, 0x2f);
S('BMI', REL8, 0x30); S('AND', IDPY, 0x31); S('AND', IDP, 0x32); S('AND', SRELY, 0x33); S('BIT', DPX, 0x34); S('AND', DPX, 0x35); S('ROL', DPX, 0x36); S('AND', IDPY, 0x37);
S('SEC', IMP, 0x38); S('AND', ABY, 0x39); S('DEC', ACC, 0x3a); S('TSC', IMP, 0x3b); S('BIT', ABX, 0x3c); S('AND', ABX, 0x3d); S('ROL', ABX, 0x3e); S('AND', LONGX, 0x3f);
S('RTI', IMP, 0x40); S('EOR', IDPX, 0x41); S('WDM', WDM, 0x42); S('EOR', IDPL, 0x43); S('MVP', BLK, 0x44); S('EOR', DP, 0x45); S('LSR', DP, 0x46); S('EOR', IDPL, 0x47);
S('PHA', IMP, 0x48); S('EOR', IMM_M, 0x49); S('LSR', ACC, 0x4a); S('PHK', IMP, 0x4b); S('JMP', ABS, 0x4c); S('EOR', ABS, 0x4d); S('LSR', ABS, 0x4e); S('EOR', LONG, 0x4f);
S('BVC', REL8, 0x50); S('EOR', IDPY, 0x51); S('EOR', IDP, 0x52); S('EOR', SRELY, 0x53); S('MVN', BLK, 0x54); S('EOR', DPX, 0x55); S('LSR', DPX, 0x56); S('EOR', IDPY, 0x57);
S('CLI', IMP, 0x58); S('EOR', ABY, 0x59); S('PHY', IMP, 0x5a); S('TCD', IMP, 0x5b); S('JMP', LONG, 0x5c); S('EOR', ABX, 0x5d); S('LSR', ABX, 0x5e); S('EOR', LONGX, 0x5f);
S('RTS', IMP, 0x60); S('ADC', IDPX, 0x61); S('PER', PER_M, 0x62); S('ADC', IDPL, 0x63); S('STZ', DP, 0x64); S('ADC', DP, 0x65); S('ROR', DP, 0x66); S('ADC', IDPL, 0x67);
S('PLA', IMP, 0x68); S('ADC', IMM_M, 0x69); S('ROR', ACC, 0x6a); S('RTL', IMP, 0x6b); S('JMP', IND, 0x6c); S('ADC', ABS, 0x6d); S('ROR', ABS, 0x6e); S('ADC', LONG, 0x6f);
S('BVS', REL8, 0x70); S('ADC', IDPY, 0x71); S('ADC', IDP, 0x72); S('ADC', SRELY, 0x73); S('STZ', DPX, 0x74); S('ADC', DPX, 0x75); S('ROR', DPX, 0x76); S('ADC', IDPY, 0x77);
S('SEI', IMP, 0x78); S('ADC', ABY, 0x79); S('PLY', IMP, 0x7a); S('TDC', IMP, 0x7b); S('JMP', INDX, 0x7c); S('ADC', ABX, 0x7d); S('ROR', ABX, 0x7e); S('ADC', LONGX, 0x7f);
S('BRA', REL8, 0x80); S('STA', IDPX, 0x81); S('BRL', REL16, 0x82); S('STA', IDPL, 0x83); S('STY', DP, 0x84); S('STA', DP, 0x85); S('STX', DP, 0x86); S('STA', IDPL, 0x87);
S('DEY', IMP, 0x88); S('BIT', IMM_M, 0x89); S('TXA', IMP, 0x8a); S('PHB', IMP, 0x8b); S('STY', ABS, 0x8c); S('STA', ABS, 0x8d); S('STX', ABS, 0x8e); S('STA', LONG, 0x8f);
S('BCC', REL8, 0x90); S('STA', IDPY, 0x91); S('STA', IDP, 0x92); S('STA', SRELY, 0x93); S('STY', DPX, 0x94); S('STA', DPX, 0x95); S('STX', DPY, 0x96); S('STA', IDPY, 0x97);
S('TYA', IMP, 0x98); S('STA', ABY, 0x99); S('TXS', IMP, 0x9a); S('TXY', IMP, 0x9b); S('STZ', ABS, 0x9c); S('STA', ABX, 0x9d); S('STZ', ABX, 0x9e); S('STA', LONGX, 0x9f);
S('LDY', IMM_X, 0xa0); S('LDA', IDPX, 0xa1); S('LDX', IMM_X, 0xa2); S('LDA', IDPL, 0xa3); S('LDY', DP, 0xa4); S('LDA', DP, 0xa5); S('LDX', DP, 0xa6); S('LDA', IDPL, 0xa7);
S('TAY', IMP, 0xa8); S('LDA', IMM_M, 0xa9); S('TAX', IMP, 0xaa); S('PLB', IMP, 0xab); S('LDY', ABS, 0xac); S('LDA', ABS, 0xad); S('LDX', ABS, 0xae); S('LDA', LONG, 0xaf);
S('BCS', REL8, 0xb0); S('LDA', IDPY, 0xb1); S('LDA', IDP, 0xb2); S('LDA', SRELY, 0xb3); S('LDY', DPX, 0xb4); S('LDA', DPX, 0xb5); S('LDX', DPY, 0xb6); S('LDA', IDPY, 0xb7);
S('CLV', IMP, 0xb8); S('LDA', ABY, 0xb9); S('TSX', IMP, 0xba); S('TYX', IMP, 0xbb); S('LDY', ABX, 0xbc); S('LDA', ABX, 0xbd); S('LDX', ABY, 0xbe); S('LDA', LONGX, 0xbf);
S('CPY', IMM_X, 0xc0); S('CMP', IDPX, 0xc1); S('REP', IMM, 0xc2); S('CMP', IDPL, 0xc3); S('CPY', DP, 0xc4); S('CMP', DP, 0xc5); S('DEC', DP, 0xc6); S('CMP', IDPL, 0xc7);
S('INY', IMP, 0xc8); S('CMP', IMM_M, 0xc9); S('DEX', IMP, 0xca); S('WAI', IMP, 0xcb); S('CPY', ABS, 0xcc); S('CMP', ABS, 0xcd); S('DEC', ABS, 0xce); S('CMP', LONG, 0xcf);
S('BNE', REL8, 0xd0); S('CMP', IDPY, 0xd1); S('CMP', IDP, 0xd2); S('CMP', SRELY, 0xd3); S('PEI', PEI, 0xd4); S('CMP', DPX, 0xd5); S('DEC', DPX, 0xd6); S('CMP', IDPY, 0xd7);
S('CLD', IMP, 0xd8); S('CMP', ABY, 0xd9); S('PHX', IMP, 0xda); S('STP', IMP, 0xdb); S('JMP', IND, 0xdc); S('CMP', ABX, 0xdd); S('DEC', ABX, 0xde); S('CMP', LONGX, 0xdf);
S('CPX', IMM_X, 0xe0); S('SBC', IDPX, 0xe1); S('SEP', IMM, 0xe2); S('SBC', IDPL, 0xe3); S('CPX', DP, 0xe4); S('SBC', DP, 0xe5); S('INC', DP, 0xe6); S('SBC', IDPL, 0xe7);
S('INX', IMP, 0xe8); S('SBC', IMM_M, 0xe9); S('NOP', IMP, 0xea); S('XBA', IMP, 0xeb); S('CPX', ABS, 0xec); S('SBC', ABS, 0xed); S('INC', ABS, 0xee); S('SBC', LONG, 0xef);
S('BEQ', REL8, 0xf0); S('SBC', IDPY, 0xf1); S('SBC', IDP, 0xf2); S('SBC', SRELY, 0xf3); S('PEA', PEA_M, 0xf4); S('SBC', DPX, 0xf5); S('INC', DPX, 0xf6); S('SBC', IDPY, 0xf7);
S('SED', IMP, 0xf8); S('SBC', ABY, 0xf9); S('PLX', IMP, 0xfa); S('XCE', IMP, 0xfb); S('JSR', INDX, 0xfc); S('SBC', ABX, 0xfd); S('INC', ABX, 0xfe); S('SBC', LONGX, 0xff);

function modeSize(mode, m, x) {
  switch (mode) {
    case IMP: case ACC: return 1;
    case IMM_M: return m ? 3 : 2;
    case IMM_X: return x ? 3 : 2;
    case IMM: case WDM: return 2;
    case DP: case DPX: case DPY: case REL8: case PEI: case IDP: case IDPX: case IDPY: case IDPL: return 2;
    case ABS: case ABX: case ABY: case IND: case INDX: case SREL: case SRELY: case REL16: case PER_M: case PEA_M: return 3;
    case BLK: return 3;
    case LONG: case LONGX: return 4;
  }
  return 1;
}

const COND = { BPL: 'N==0', BMI: 'N==1', BVC: 'V==0', BVS: 'V==1', BCC: 'C==0', BCS: 'C==1', BNE: 'Z==0', BEQ: 'Z==1', BRA: '1', BRL: '1' };

export const cpu = {
  id: '65816',
  label: 'SNES · 65C816',
  opts: { m: 8, x: 8 },
  addrFmt: (a) => '$' + (a & 0xffffff).toString(16).toUpperCase().padStart(6, '0'),
  condText: COND,

  decode(mem, addr) {
    const op = mem.readByte(addr);
    if (op == null) return null;
    const [mnemonic, mode] = OP[op];
    const m = this.opts.m === 16, x = this.opts.x === 16;
    const size = modeSize(mode, m, x);
    const bytes = mem.readBytes(addr, size);
    if (!bytes) return null;
    const pc = (addr + size) & 0xffffff;
    const bank = addr & 0xff0000;
    let operands = '';
    let target = null;

    const abs16 = (b) => (b[2] << 8) | b[1];
    const long24 = (b) => (b[3] << 16) | (b[2] << 8) | b[1];

    switch (mode) {
      case IMM_M: operands = '#$' + (m ? hex4((bytes[2] << 8) | bytes[1]) : hex2(bytes[1])); break;
      case IMM_X: operands = '#$' + (x ? hex4((bytes[2] << 8) | bytes[1]) : hex2(bytes[1])); break;
      case IMM: case WDM: operands = '#$' + hex2(bytes[1]); break;
      case DP: operands = '$' + hex2(bytes[1]); break;
      case DPX: operands = '$' + hex2(bytes[1]) + ',X'; break;
      case DPY: operands = '$' + hex2(bytes[1]) + ',Y'; break;
      case ABS: operands = '$' + hex4(abs16(bytes)); break;
      case ABX: operands = '$' + hex4(abs16(bytes)) + ',X'; break;
      case ABY: operands = '$' + hex4(abs16(bytes)) + ',Y'; break;
      case LONG: operands = '$' + hex6(long24(bytes)); break;
      case LONGX: operands = '$' + hex6(long24(bytes)) + ',X'; break;
      case IDP: operands = '($' + hex2(bytes[1]) + ')'; break;
      case IDPX: operands = '($' + hex2(bytes[1]) + ',X)'; break;
      case IDPY: operands = '($' + hex2(bytes[1]) + '),Y'; break;
      case IDPL: operands = '[$' + hex2(bytes[1]) + ']'; break;
      case SREL: operands = '$' + hex2(bytes[1]) + ',S'; break;
      case SRELY: operands = '($' + hex2(bytes[1]) + ',S),Y'; break;
      case IND: operands = '($' + hex4(abs16(bytes)) + ')'; break;
      case INDX: operands = '($' + hex4(abs16(bytes)) + ',X)'; break;
      case REL8: {
        const off = bytes[1] & 0x80 ? bytes[1] - 0x100 : bytes[1];
        target = bank | (((pc & 0xffff) + off) & 0xffff);
        operands = '$' + hex6(target);
        break;
      }
      case REL16: case PER_M: {
        const off16 = (bytes[2] << 8) | bytes[1];
        const s16 = off16 & 0x8000 ? off16 - 0x10000 : off16;
        target = bank | (((pc & 0xffff) + s16) & 0xffff);
        operands = '$' + hex6(target);
        break;
      }
      case PEA_M: operands = '$' + hex4(abs16(bytes)); break;
      case PEI: operands = '($' + hex2(bytes[1]) + ')'; break;
      case BLK: operands = '$' + hex2(bytes[2]) + ',$' + hex2(bytes[1]); break;
      case ACC: operands = 'A'; break;
      default: break;
    }

    let branch = null;
    if (mode === REL8 || mode === REL16) {
      branch = { kind: mnemonic === 'BRA' || mnemonic === 'BRL' ? 'jump' : 'cond', target, fallthrough: mnemonic === 'BRA' || mnemonic === 'BRL' ? false : true };
    } else if (mnemonic === 'JMP' || mnemonic === 'STP') {
      target = (mode === IND || mode === INDX) ? null : (mode === ABS ? (bank | abs16(bytes)) : long24(bytes));
      branch = { kind: 'jump', target, fallthrough: false };
    } else if (mnemonic === 'JSR') {
      target = mode === INDX ? null : (bank | abs16(bytes));
      branch = { kind: 'call', target, fallthrough: true };
    } else if (mnemonic === 'JSL') {
      branch = { kind: 'call', target: long24(bytes), fallthrough: true };
    } else if (mnemonic === 'RTS' || mnemonic === 'RTL' || mnemonic === 'RTI') {
      branch = { kind: 'ret', target: null, fallthrough: false };
    }

    if ((mnemonic === 'JSR' || mnemonic === 'JMP') && mode === ABS) operands = '$' + hex6(target);

    return { addr, size, bytes, mnemonic, operands, text: mnemonic + (operands ? ' ' + operands : ''), branch, op, mode };
  },
};

function hex2(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }
function hex4(n) { return n.toString(16).toUpperCase().padStart(4, '0'); }
function hex6(n) { return n.toString(16).toUpperCase().padStart(6, '0'); }
