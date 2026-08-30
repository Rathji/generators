// Motorola 68000 disassembler (Sega Mega Drive / Genesis CPU).
// Faithful port of the MAME m68kdasm opcode table + handlers (68000 subset only,
// which is what Genesis games use).

const CC = ['t', 'f', 'hi', 'ls', 'cc', 'cs', 'ne', 'eq', 'vc', 'vs', 'pl', 'mi', 'ge', 'lt', 'gt', 'le'];
const QDATA = [8, 1, 2, 3, 4, 5, 6, 7];
const DATA5 = [32, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31];

// [mask, match, eaMask, handlerName]
const TABLE = [
  [0xf000, 0xa000, 0x000, 'op1010'],
  [0xf000, 0xf000, 0x000, 'op1111'],
  [0xf1f8, 0xc100, 0x000, 'abcd_rr'], [0xf1f8, 0xc108, 0x000, 'abcd_mm'],
  [0xf1c0, 0xd000, 0xbff, 'add_er8'], [0xf1c0, 0xd040, 0xfff, 'add_er16'], [0xf1c0, 0xd080, 0xfff, 'add_er32'],
  [0xf1c0, 0xd100, 0x3f8, 'add_re8'], [0xf1c0, 0xd140, 0x3f8, 'add_re16'], [0xf1c0, 0xd180, 0x3f8, 'add_re32'],
  [0xf1c0, 0xd0c0, 0xfff, 'adda16'], [0xf1c0, 0xd1c0, 0xfff, 'adda32'],
  [0xffc0, 0x0600, 0xbf8, 'addi8'], [0xffc0, 0x0640, 0xbf8, 'addi16'], [0xffc0, 0x0680, 0xbf8, 'addi32'],
  [0xf1c0, 0x5000, 0xbf8, 'addq8'], [0xf1c0, 0x5040, 0xff8, 'addq16'], [0xf1c0, 0x5080, 0xff8, 'addq32'],
  [0xf1f8, 0xd100, 0x000, 'addx_rr8'], [0xf1f8, 0xd140, 0x000, 'addx_rr16'], [0xf1f8, 0xd180, 0x000, 'addx_rr32'],
  [0xf1f8, 0xd108, 0x000, 'addx_mm8'], [0xf1f8, 0xd148, 0x000, 'addx_mm16'], [0xf1f8, 0xd188, 0x000, 'addx_mm32'],
  [0xf1c0, 0xc000, 0xbff, 'and_er8'], [0xf1c0, 0xc040, 0xbff, 'and_er16'], [0xf1c0, 0xc080, 0xbff, 'and_er32'],
  [0xf1c0, 0xc100, 0x3f8, 'and_re8'], [0xf1c0, 0xc140, 0x3f8, 'and_re16'], [0xf1c0, 0xc180, 0x3f8, 'and_re32'],
  [0xffff, 0x023c, 0x000, 'andi_ccr'], [0xffff, 0x027c, 0x000, 'andi_sr'],
  [0xffc0, 0x0200, 0xbf8, 'andi8'], [0xffc0, 0x0240, 0xbf8, 'andi16'], [0xffc0, 0x0280, 0xbf8, 'andi32'],
  [0xf1f8, 0xe000, 0x000, 'asr_s8'], [0xf1f8, 0xe040, 0x000, 'asr_s16'], [0xf1f8, 0xe080, 0x000, 'asr_s32'],
  [0xf1f8, 0xe020, 0x000, 'asr_r8'], [0xf1f8, 0xe060, 0x000, 'asr_r16'], [0xf1f8, 0xe0a0, 0x000, 'asr_r32'],
  [0xffc0, 0xe0c0, 0x3f8, 'asr_ea'],
  [0xf1f8, 0xe100, 0x000, 'asl_s8'], [0xf1f8, 0xe140, 0x000, 'asl_s16'], [0xf1f8, 0xe180, 0x000, 'asl_s32'],
  [0xf1f8, 0xe120, 0x000, 'asl_r8'], [0xf1f8, 0xe160, 0x000, 'asl_r16'], [0xf1f8, 0xe1a0, 0x000, 'asl_r32'],
  [0xffc0, 0xe1c0, 0x3f8, 'asl_ea'],
  [0xf000, 0x6000, 0x000, 'bcc8'], [0xf0ff, 0x6000, 0x000, 'bcc16'],
  [0xf1c0, 0x0140, 0xbf8, 'bchg_r'], [0xffc0, 0x0840, 0xbf8, 'bchg_s'],
  [0xf1c0, 0x0180, 0xbf8, 'bclr_r'], [0xffc0, 0x0880, 0xbf8, 'bclr_s'],
  [0xf1c0, 0x01c0, 0xbf8, 'bset_r'], [0xffc0, 0x08c0, 0xbf8, 'bset_s'],
  [0xff00, 0x6000, 0x000, 'bra8'], [0xffff, 0x6000, 0x000, 'bra16'],
  [0xff00, 0x6100, 0x000, 'bsr8'], [0xffff, 0x6100, 0x000, 'bsr16'],
  [0xf1c0, 0x0100, 0xbff, 'btst_r'], [0xffc0, 0x0800, 0xbfb, 'btst_s'],
  [0xf1c0, 0x4180, 0xbff, 'chk16'],
  [0xffc0, 0x4200, 0xbf8, 'clr8'], [0xffc0, 0x4240, 0xbf8, 'clr16'], [0xffc0, 0x4280, 0xbf8, 'clr32'],
  [0xf1c0, 0xb000, 0xbff, 'cmp8'], [0xf1c0, 0xb040, 0xfff, 'cmp16'], [0xf1c0, 0xb080, 0xfff, 'cmp32'],
  [0xf1c0, 0xb0c0, 0xfff, 'cmpa16'], [0xf1c0, 0xb1c0, 0xfff, 'cmpa32'],
  [0xffc0, 0x0c00, 0xbf8, 'cmpi8'], [0xffc0, 0x0c40, 0xbf8, 'cmpi16'], [0xffc0, 0x0c80, 0xbf8, 'cmpi32'],
  [0xf1f8, 0xb108, 0x000, 'cmpm8'], [0xf1f8, 0xb148, 0x000, 'cmpm16'], [0xf1f8, 0xb188, 0x000, 'cmpm32'],
  [0xf0f8, 0x50c8, 0x000, 'dbcc'], [0xfff8, 0x51c8, 0x000, 'dbra'],
  [0xf1c0, 0x81c0, 0xbff, 'divs'], [0xf1c0, 0x80c0, 0xbff, 'divu'],
  [0xf1c0, 0xb100, 0xbf8, 'eor8'], [0xf1c0, 0xb140, 0xbf8, 'eor16'], [0xf1c0, 0xb180, 0xbf8, 'eor32'],
  [0xffff, 0x0a3c, 0x000, 'eori_ccr'], [0xffff, 0x0a7c, 0x000, 'eori_sr'],
  [0xffc0, 0x0a00, 0xbf8, 'eori8'], [0xffc0, 0x0a40, 0xbf8, 'eori16'], [0xffc0, 0x0a80, 0xbf8, 'eori32'],
  [0xf1f8, 0xc140, 0x000, 'exg_dd'], [0xf1f8, 0xc148, 0x000, 'exg_aa'], [0xf1f8, 0xc188, 0x000, 'exg_da'],
  [0xfff8, 0x4880, 0x000, 'ext16'], [0xfff8, 0x48c0, 0x000, 'ext32'],
  [0xffff, 0x4afc, 0x000, 'illegal'],
  [0xffc0, 0x4ec0, 0x27b, 'jmp'], [0xffc0, 0x4e80, 0x27b, 'jsr'],
  [0xf1c0, 0x41c0, 0x27b, 'lea'],
  [0xfff8, 0x4e50, 0x000, 'link'],
  [0xf1f8, 0xe008, 0x000, 'lsr_s8'], [0xf1f8, 0xe048, 0x000, 'lsr_s16'], [0xf1f8, 0xe088, 0x000, 'lsr_s32'],
  [0xf1f8, 0xe028, 0x000, 'lsr_r8'], [0xf1f8, 0xe068, 0x000, 'lsr_r16'], [0xf1f8, 0xe0a8, 0x000, 'lsr_r32'],
  [0xffc0, 0xe2c0, 0x3f8, 'lsr_ea'],
  [0xf1f8, 0xe108, 0x000, 'lsl_s8'], [0xf1f8, 0xe148, 0x000, 'lsl_s16'], [0xf1f8, 0xe188, 0x000, 'lsl_s32'],
  [0xf1f8, 0xe128, 0x000, 'lsl_r8'], [0xf1f8, 0xe168, 0x000, 'lsl_r16'], [0xf1f8, 0xe1a8, 0x000, 'lsl_r32'],
  [0xffc0, 0xe3c0, 0x3f8, 'lsl_ea'],
  [0xf000, 0x1000, 0xbff, 'move8'], [0xf000, 0x3000, 0xfff, 'move16'], [0xf000, 0x2000, 0xfff, 'move32'],
  [0xf1c0, 0x3040, 0xfff, 'movea16'], [0xf1c0, 0x2040, 0xfff, 'movea32'],
  [0xffc0, 0x44c0, 0xbff, 'move_ccr'], [0xffc0, 0x46c0, 0xbff, 'move_sr'], [0xffc0, 0x40c0, 0xbf8, 'move_fr_sr'],
  [0xfff8, 0x4e60, 0x000, 'move_usp_to'], [0xfff8, 0x4e68, 0x000, 'move_usp_fr'],
  [0xfff8, 0x48a0, 0x000, 'movem_pd16'], [0xfff8, 0x48e0, 0x000, 'movem_pd32'],
  [0xffc0, 0x4880, 0x2f8, 'movem_re16'], [0xffc0, 0x48c0, 0x2f8, 'movem_re32'],
  [0xffc0, 0x4c80, 0x37b, 'movem_er16'], [0xffc0, 0x4cc0, 0x37b, 'movem_er32'],
  [0xf1f8, 0x0108, 0x000, 'movep_er16'], [0xf1f8, 0x0148, 0x000, 'movep_er32'],
  [0xf1f8, 0x0188, 0x000, 'movep_re16'], [0xf1f8, 0x01c8, 0x000, 'movep_re32'],
  [0xf100, 0x7000, 0x000, 'moveq'],
  [0xf1c0, 0xc1c0, 0xbff, 'muls'], [0xf1c0, 0xc0c0, 0xbff, 'mulu'],
  [0xffc0, 0x4800, 0xbf8, 'nbcd'],
  [0xffc0, 0x4400, 0xbf8, 'neg8'], [0xffc0, 0x4440, 0xbf8, 'neg16'], [0xffc0, 0x4480, 0xbf8, 'neg32'],
  [0xffc0, 0x4000, 0xbf8, 'negx8'], [0xffc0, 0x4040, 0xbf8, 'negx16'], [0xffc0, 0x4080, 0xbf8, 'negx32'],
  [0xffff, 0x4e71, 0x000, 'nop'],
  [0xffc0, 0x4600, 0xbf8, 'not8'], [0xffc0, 0x4640, 0xbf8, 'not16'], [0xffc0, 0x4680, 0xbf8, 'not32'],
  [0xf1c0, 0x8000, 0xbff, 'or_er8'], [0xf1c0, 0x8040, 0xbff, 'or_er16'], [0xf1c0, 0x8080, 0xbff, 'or_er32'],
  [0xf1c0, 0x8100, 0x3f8, 'or_re8'], [0xf1c0, 0x8140, 0x3f8, 'or_re16'], [0xf1c0, 0x8180, 0x3f8, 'or_re32'],
  [0xffff, 0x003c, 0x000, 'ori_ccr'], [0xffff, 0x007c, 0x000, 'ori_sr'],
  [0xffc0, 0x0000, 0xbf8, 'ori8'], [0xffc0, 0x0040, 0xbf8, 'ori16'], [0xffc0, 0x0080, 0xbf8, 'ori32'],
  [0xffc0, 0x4840, 0x27b, 'pea'],
  [0xffff, 0x4e70, 0x000, 'reset'],
  [0xf1f8, 0xe018, 0x000, 'ror_s8'], [0xf1f8, 0xe058, 0x000, 'ror_s16'], [0xf1f8, 0xe098, 0x000, 'ror_s32'],
  [0xf1f8, 0xe038, 0x000, 'ror_r8'], [0xf1f8, 0xe078, 0x000, 'ror_r16'], [0xf1f8, 0xe0b8, 0x000, 'ror_r32'],
  [0xffc0, 0xe6c0, 0x3f8, 'ror_ea'],
  [0xf1f8, 0xe118, 0x000, 'rol_s8'], [0xf1f8, 0xe158, 0x000, 'rol_s16'], [0xf1f8, 0xe198, 0x000, 'rol_s32'],
  [0xf1f8, 0xe138, 0x000, 'rol_r8'], [0xf1f8, 0xe178, 0x000, 'rol_r16'], [0xf1f8, 0xe1b8, 0x000, 'rol_r32'],
  [0xffc0, 0xe7c0, 0x3f8, 'rol_ea'],
  [0xf1f8, 0xe010, 0x000, 'roxr_s8'], [0xf1f8, 0xe050, 0x000, 'roxr_s16'], [0xf1f8, 0xe090, 0x000, 'roxr_s32'],
  [0xf1f8, 0xe030, 0x000, 'roxr_r8'], [0xf1f8, 0xe070, 0x000, 'roxr_r16'], [0xf1f8, 0xe0b0, 0x000, 'roxr_r32'],
  [0xffc0, 0xe4c0, 0x3f8, 'roxr_ea'],
  [0xf1f8, 0xe110, 0x000, 'roxl_s8'], [0xf1f8, 0xe150, 0x000, 'roxl_s16'], [0xf1f8, 0xe190, 0x000, 'roxl_s32'],
  [0xf1f8, 0xe130, 0x000, 'roxl_r8'], [0xf1f8, 0xe170, 0x000, 'roxl_r16'], [0xf1f8, 0xe1b0, 0x000, 'roxl_r32'],
  [0xffc0, 0xe5c0, 0x3f8, 'roxl_ea'],
  [0xffff, 0x4e73, 0x000, 'rte'], [0xffff, 0x4e77, 0x000, 'rtr'], [0xffff, 0x4e75, 0x000, 'rts'],
  [0xf1f8, 0x8100, 0x000, 'sbcd_rr'], [0xf1f8, 0x8108, 0x000, 'sbcd_mm'],
  [0xf0c0, 0x50c0, 0xbf8, 'scc'],
  [0xffff, 0x4e72, 0x000, 'stop'],
  [0xf1c0, 0x9000, 0xbff, 'sub_er8'], [0xf1c0, 0x9040, 0xfff, 'sub_er16'], [0xf1c0, 0x9080, 0xfff, 'sub_er32'],
  [0xf1c0, 0x9100, 0x3f8, 'sub_re8'], [0xf1c0, 0x9140, 0x3f8, 'sub_re16'], [0xf1c0, 0x9180, 0x3f8, 'sub_re32'],
  [0xf1c0, 0x90c0, 0xfff, 'suba16'], [0xf1c0, 0x91c0, 0xfff, 'suba32'],
  [0xffc0, 0x0400, 0xbf8, 'subi8'], [0xffc0, 0x0440, 0xbf8, 'subi16'], [0xffc0, 0x0480, 0xbf8, 'subi32'],
  [0xf1c0, 0x5100, 0xbf8, 'subq8'], [0xf1c0, 0x5140, 0xff8, 'subq16'], [0xf1c0, 0x5180, 0xff8, 'subq32'],
  [0xf1f8, 0x9100, 0x000, 'subx_rr8'], [0xf1f8, 0x9140, 0x000, 'subx_rr16'], [0xf1f8, 0x9180, 0x000, 'subx_rr32'],
  [0xf1f8, 0x9108, 0x000, 'subx_mm8'], [0xf1f8, 0x9148, 0x000, 'subx_mm16'], [0xf1f8, 0x9188, 0x000, 'subx_mm32'],
  [0xfff8, 0x4840, 0x000, 'swap'],
  [0xffc0, 0x4ac0, 0xbf8, 'tas'],
  [0xfff0, 0x4e40, 0x000, 'trap'], [0xffff, 0x4e76, 0x000, 'trapv'],
  [0xffc0, 0x4a00, 0xbf8, 'tst8'], [0xffc0, 0x4a40, 0xbf8, 'tst16'], [0xffc0, 0x4a80, 0xbf8, 'tst32'],
  [0xfff8, 0x4e58, 0x000, 'unlk'],
];

TABLE.sort((a, b) => popcount(b[0]) - popcount(a[0]) || 0);
function popcount(n) { let c = 0; while (n) { c += n & 1; n >>>= 1; } return c; }

function validEA(op, mask) {
  if (mask === 0) return true;
  const m = (op >> 3) & 7;
  const bits = [0x800, 0x400, 0x200, 0x100, 0x080, 0x040, 0x020, 0x010, 0x008, 0x002, 0x001, 0x004];
  const lower = op & 0x3f;
  if (lower < 0x38) return (mask & bits[m]) !== 0;
  if (lower === 0x38) return (mask & 0x010) !== 0;
  if (lower === 0x39) return (mask & 0x008) !== 0;
  if (lower === 0x3a) return (mask & 0x002) !== 0;
  if (lower === 0x3b) return (mask & 0x001) !== 0;
  if (lower === 0x3c) return (mask & 0x004) !== 0;
  return false;
}

// ---------- helpers ----------
function h2(n) { return n.toString(16).toUpperCase().padStart(2, '0'); }
function h4(n) { return n.toString(16).toUpperCase().padStart(4, '0'); }
function h6(n) { return n.toString(16).toUpperCase().padStart(6, '0'); }
function h8(n) { return n.toString(16).toUpperCase().padStart(8, '0'); }
function sgn8(v) { return v & 0x80 ? v - 0x100 : v; }
function sgn16(v) { return v & 0x8000 ? v - 0x10000 : v; }
function sgn32(v) { return v | 0; }
function shex8(v) { const s = sgn8(v); return (s < 0 ? '-$' + h2(-s) : '$' + h2(s)); }
function shex16(v) { const s = sgn16(v); return (s < 0 ? '-$' + h4(-s) : '$' + h4(s)); }

export const cpu = {
  id: '68000',
  label: 'Mega Drive · 68000',
  addrFmt: (a) => '$' + (a >>> 0).toString(16).toUpperCase().padStart(8, '0'),
  condText: {
    'bhi': 'C==0 && Z==0', 'bls': 'C==1 || Z==1', 'bcc': 'C==0', 'bcs': 'C==1',
    'bne': 'Z==0', 'beq': 'Z==1', 'bvc': 'V==0', 'bvs': 'V==1',
    'bpl': 'N==0', 'bmi': 'N==1', 'bge': 'N==V', 'blt': 'N!=V', 'bgt': 'Z==0 && N==V', 'ble': 'Z==1 || N!=V',
  },

  decode(mem, addr) {
    const w = mem.readWordBE(addr);
    if (w == null) return null;
    let hit = null;
    for (const entry of TABLE) {
      const [mask, match, ext] = entry;
      if ((w & mask) === match) {
        if (entry[3] === 'move8' || entry[3] === 'move16' || entry[3] === 'move32') {
          const dest = (((w >> 6) & 7) << 3) | ((w >> 9) & 7);
          if (!validEA(dest, 0xff8)) continue;
        }
        if (!validEA(w, ext)) continue;
        hit = entry;
        break;
      }
    }
    const ctx = { mem, addr, w, pc: addr + 2 };
    let res;
    if (!hit) res = { text: 'dc.w  $' + h4(w) };
    else res = HANDLERS[hit[3]](ctx);
    const size = ctx.pc - ctx.addr;
    const bytes = mem.readBytes(addr, size);
    if (!bytes) return null;
    const sp = res.text.split(' ');
    return {
      addr, size, bytes,
      mnemonic: sp[0].replace(/\d$/, ''),
      operands: sp.slice(1).join(' '),
      text: res.text,
      branch: res.branch || null,
    };
  },
};

function read16(ctx) { const v = ctx.mem.readWordBE(ctx.pc); ctx.pc += 2; return v == null ? 0 : v; }
function read8(ctx) { return read16(ctx) & 0xff; }
function read32(ctx) { return ((read16(ctx) << 16) | read16(ctx)) >>> 0; }

function eaStr(ctx, size, mode, reg) {
  let str, target = null;
  switch (mode) {
    case 0: str = 'D' + reg; break;
    case 1: str = 'A' + reg; break;
    case 2: str = '(A' + reg + ')'; break;
    case 3: str = '(A' + reg + ')+'; break;
    case 4: str = '-(A' + reg + ')'; break;
    case 5: {
      const d = read16(ctx);
      str = '(' + shex16(d) + ',A' + reg + ')';
      break;
    }
    case 6: {
      const ext = read16(ctx);
      const ar = ext & 0x8000 ? 'A' : 'D';
      const r = ext & 7;
      const l = ext & 0x0800 ? 'l' : 'w';
      const d8 = ext & 0x100;
      const scale = (ext >> 9) & 7;
      if (d8) str = '(' + shex8(ext & 0xff) + ',A' + reg + ',' + ar + r + '.' + l + (scale ? '*' + (1 << scale) : '') + ')';
      else str = '(A' + reg + ',' + ar + r + '.' + l + (scale ? '*' + (1 << scale) : '') + ')';
      break;
    }
    case 7:
      switch (reg) {
        case 0: { const v = read16(ctx); str = '$' + h4(v) + '.w'; target = v & 0xffffffff; break; }
        case 1: { const v = read32(ctx); str = '$' + h8(v) + '.l'; target = v; break; }
        case 2: {
          const d = read16(ctx);
          target = (ctx.addr + 2 + sgn16(d)) & 0xffffffff;
          str = '($' + h4(target) + ',PC)';
          break;
        }
        case 3: {
          const ext = read16(ctx);
          const ar = ext & 0x8000 ? 'A' : 'D';
          const r = ext & 7;
          const l = ext & 0x0800 ? 'l' : 'w';
          const d8 = ext & 0x100;
          if (d8) str = '(' + shex8(ext & 0xff) + ',PC,' + ar + r + '.' + l + ')';
          else str = '(PC,' + ar + r + '.' + l + ')';
          break;
        }
        case 4: {
          let v = read16(ctx);
          if (size === 8) v = v & 0xff;
          else if (size === 32) { const lo = read16(ctx); v = (((v & 0xffff) << 16) | lo) >>> 0; }
          str = '#' + '\x24' + (size === 8 ? h2(v) : size === 16 ? h4(v) : h8(v));
          break;
        }
        default: str = 'INVALID';
      }
      break;
  }
  return { str, target };
}
function eaCtx(ctx, size) { return eaStr(ctx, size, (ctx.w >> 3) & 7, ctx.w & 7); }

// ---------- handlers ----------
const HANDLERS = {
  op1010(ctx) { return { size: 2, text: 'dc.w  $' + h4(ctx.w) + '  ; 1010' }; },
  op1111(ctx) { return { size: 2, text: 'dc.w  $' + h4(ctx.w) + '  ; 1111' }; },
  illegal(ctx) { return { size: 2, text: 'dc.w  $' + h4(ctx.w) + '  ; ILLEGAL' }; },

  abcd_rr(ctx) { return { size: 2, text: `abcd    D${ctx.w & 7}, D${(ctx.w >> 9) & 7}` }; },
  abcd_mm(ctx) { return { size: 2, text: `abcd    -(A${ctx.w & 7}), -(A${(ctx.w >> 9) & 7})` }; },
  sbcd_rr(ctx) { return { size: 2, text: `sbcd    D${ctx.w & 7}, D${(ctx.w >> 9) & 7}` }; },
  sbcd_mm(ctx) { return { size: 2, text: `sbcd    -(A${ctx.w & 7}), -(A${(ctx.w >> 9) & 7})` }; },

  add_er8(ctx) { return { size: 2, text: `add.b   ${eaCtx(ctx, 8).str}, D${(ctx.w >> 9) & 7}` }; },
  add_er16(ctx) { return { size: 2, text: `add.w   ${eaCtx(ctx, 16).str}, D${(ctx.w >> 9) & 7}` }; },
  add_er32(ctx) { return { size: 2, text: `add.l   ${eaCtx(ctx, 32).str}, D${(ctx.w >> 9) & 7}` }; },
  add_re8(ctx) { return { size: 2, text: `add.b   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 8).str}` }; },
  add_re16(ctx) { return { size: 2, text: `add.w   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 16).str}` }; },
  add_re32(ctx) { return { size: 2, text: `add.l   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 32).str}` }; },
  adda16(ctx) { return { size: 2, text: `adda.w  ${eaCtx(ctx, 16).str}, A${(ctx.w >> 9) & 7}` }; },
  adda32(ctx) { return { size: 2, text: `adda.l  ${eaCtx(ctx, 32).str}, A${(ctx.w >> 9) & 7}` }; },
  addx_rr8(ctx) { return { size: 2, text: `addx.b  D${ctx.w & 7}, D${(ctx.w >> 9) & 7}` }; },
  addx_rr16(ctx) { return { size: 2, text: `addx.w  D${ctx.w & 7}, D${(ctx.w >> 9) & 7}` }; },
  addx_rr32(ctx) { return { size: 2, text: `addx.l  D${ctx.w & 7}, D${(ctx.w >> 9) & 7}` }; },
  addx_mm8(ctx) { return { size: 2, text: `addx.b  -(A${ctx.w & 7}), -(A${(ctx.w >> 9) & 7})` }; },
  addx_mm16(ctx) { return { size: 2, text: `addx.w  -(A${ctx.w & 7}), -(A${(ctx.w >> 9) & 7})` }; },
  addx_mm32(ctx) { return { size: 2, text: `addx.l  -(A${ctx.w & 7}), -(A${(ctx.w >> 9) & 7})` }; },
  sub_er8(ctx) { return { size: 2, text: `sub.b   ${eaCtx(ctx, 8).str}, D${(ctx.w >> 9) & 7}` }; },
  sub_er16(ctx) { return { size: 2, text: `sub.w   ${eaCtx(ctx, 16).str}, D${(ctx.w >> 9) & 7}` }; },
  sub_er32(ctx) { return { size: 2, text: `sub.l   ${eaCtx(ctx, 32).str}, D${(ctx.w >> 9) & 7}` }; },
  sub_re8(ctx) { return { size: 2, text: `sub.b   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 8).str}` }; },
  sub_re16(ctx) { return { size: 2, text: `sub.w   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 16).str}` }; },
  sub_re32(ctx) { return { size: 2, text: `sub.l   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 32).str}` }; },
  suba16(ctx) { return { size: 2, text: `suba.w  ${eaCtx(ctx, 16).str}, A${(ctx.w >> 9) & 7}` }; },
  suba32(ctx) { return { size: 2, text: `suba.l  ${eaCtx(ctx, 32).str}, A${(ctx.w >> 9) & 7}` }; },
  subx_rr8(ctx) { return { size: 2, text: `subx.b  D${ctx.w & 7}, D${(ctx.w >> 9) & 7}` }; },
  subx_rr16(ctx) { return { size: 2, text: `subx.w  D${ctx.w & 7}, D${(ctx.w >> 9) & 7}` }; },
  subx_rr32(ctx) { return { size: 2, text: `subx.l  D${ctx.w & 7}, D${(ctx.w >> 9) & 7}` }; },
  subx_mm8(ctx) { return { size: 2, text: `subx.b  -(A${ctx.w & 7}), -(A${(ctx.w >> 9) & 7})` }; },
  subx_mm16(ctx) { return { size: 2, text: `subx.w  -(A${ctx.w & 7}), -(A${(ctx.w >> 9) & 7})` }; },
  subx_mm32(ctx) { return { size: 2, text: `subx.l  -(A${ctx.w & 7}), -(A${(ctx.w >> 9) & 7})` }; },
  and_er8(ctx) { return { size: 2, text: `and.b   ${eaCtx(ctx, 8).str}, D${(ctx.w >> 9) & 7}` }; },
  and_er16(ctx) { return { size: 2, text: `and.w   ${eaCtx(ctx, 16).str}, D${(ctx.w >> 9) & 7}` }; },
  and_er32(ctx) { return { size: 2, text: `and.l   ${eaCtx(ctx, 32).str}, D${(ctx.w >> 9) & 7}` }; },
  and_re8(ctx) { return { size: 2, text: `and.b   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 8).str}` }; },
  and_re16(ctx) { return { size: 2, text: `and.w   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 16).str}` }; },
  and_re32(ctx) { return { size: 2, text: `and.l   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 32).str}` }; },
  or_er8(ctx) { return { size: 2, text: `or.b    ${eaCtx(ctx, 8).str}, D${(ctx.w >> 9) & 7}` }; },
  or_er16(ctx) { return { size: 2, text: `or.w    ${eaCtx(ctx, 16).str}, D${(ctx.w >> 9) & 7}` }; },
  or_er32(ctx) { return { size: 2, text: `or.l    ${eaCtx(ctx, 32).str}, D${(ctx.w >> 9) & 7}` }; },
  or_re8(ctx) { return { size: 2, text: `or.b    D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 8).str}` }; },
  or_re16(ctx) { return { size: 2, text: `or.w    D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 16).str}` }; },
  or_re32(ctx) { return { size: 2, text: `or.l    D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 32).str}` }; },
  eor8(ctx) { return { size: 2, text: `eor.b   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 8).str}` }; },
  eor16(ctx) { return { size: 2, text: `eor.w   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 16).str}` }; },
  eor32(ctx) { return { size: 2, text: `eor.l   D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 32).str}` }; },
  cmp8(ctx) { return { size: 2, text: `cmp.b   ${eaCtx(ctx, 8).str}, D${(ctx.w >> 9) & 7}` }; },
  cmp16(ctx) { return { size: 2, text: `cmp.w   ${eaCtx(ctx, 16).str}, D${(ctx.w >> 9) & 7}` }; },
  cmp32(ctx) { return { size: 2, text: `cmp.l   ${eaCtx(ctx, 32).str}, D${(ctx.w >> 9) & 7}` }; },
  cmpa16(ctx) { return { size: 2, text: `cmpa.w  ${eaCtx(ctx, 16).str}, A${(ctx.w >> 9) & 7}` }; },
  cmpa32(ctx) { return { size: 2, text: `cmpa.l  ${eaCtx(ctx, 32).str}, A${(ctx.w >> 9) & 7}` }; },
  cmpm8(ctx) { return { size: 2, text: `cmpm.b  (A${ctx.w & 7})+, (A${(ctx.w >> 9) & 7})+` }; },
  cmpm16(ctx) { return { size: 2, text: `cmpm.w  (A${ctx.w & 7})+, (A${(ctx.w >> 9) & 7})+` }; },
  cmpm32(ctx) { return { size: 2, text: `cmpm.l  (A${ctx.w & 7})+, (A${(ctx.w >> 9) & 7})+` }; },

  addi8(ctx) { const i = shex8(read8(ctx)); return { size: 4, text: `addi.b  #${i}, ${eaCtx(ctx, 8).str}` }; },
  addi16(ctx) { const i = shex16(read16(ctx)); return { size: 4, text: `addi.w  #${i}, ${eaCtx(ctx, 16).str}` }; },
  addi32(ctx) { const i = '$' + h8(read32(ctx)); return { size: 6, text: `addi.l  #${i}, ${eaCtx(ctx, 32).str}` }; },
  subi8(ctx) { const i = shex8(read8(ctx)); return { size: 4, text: `subi.b  #${i}, ${eaCtx(ctx, 8).str}` }; },
  subi16(ctx) { const i = shex16(read16(ctx)); return { size: 4, text: `subi.w  #${i}, ${eaCtx(ctx, 16).str}` }; },
  subi32(ctx) { const i = '$' + h8(read32(ctx)); return { size: 6, text: `subi.l  #${i}, ${eaCtx(ctx, 32).str}` }; },
  andi8(ctx) { const i = '$' + h2(read8(ctx)); return { size: 4, text: `andi.b  #${i}, ${eaCtx(ctx, 8).str}` }; },
  andi16(ctx) { const i = '$' + h4(read16(ctx)); return { size: 4, text: `andi.w  #${i}, ${eaCtx(ctx, 16).str}` }; },
  andi32(ctx) { const i = '$' + h8(read32(ctx)); return { size: 6, text: `andi.l  #${i}, ${eaCtx(ctx, 32).str}` }; },
  ori8(ctx) { const i = '$' + h2(read8(ctx)); return { size: 4, text: `ori.b   #${i}, ${eaCtx(ctx, 8).str}` }; },
  ori16(ctx) { const i = '$' + h4(read16(ctx)); return { size: 4, text: `ori.w   #${i}, ${eaCtx(ctx, 16).str}` }; },
  ori32(ctx) { const i = '$' + h8(read32(ctx)); return { size: 6, text: `ori.l   #${i}, ${eaCtx(ctx, 32).str}` }; },
  eori8(ctx) { const i = '$' + h2(read8(ctx)); return { size: 4, text: `eori.b  #${i}, ${eaCtx(ctx, 8).str}` }; },
  eori16(ctx) { const i = '$' + h4(read16(ctx)); return { size: 4, text: `eori.w  #${i}, ${eaCtx(ctx, 16).str}` }; },
  eori32(ctx) { const i = '$' + h8(read32(ctx)); return { size: 6, text: `eori.l  #${i}, ${eaCtx(ctx, 32).str}` }; },
  cmpi8(ctx) { const i = '$' + h2(read8(ctx)); return { size: 4, text: `cmpi.b  #${i}, ${eaCtx(ctx, 8).str}` }; },
  cmpi16(ctx) { const i = '$' + h4(read16(ctx)); return { size: 4, text: `cmpi.w  #${i}, ${eaCtx(ctx, 16).str}` }; },
  cmpi32(ctx) { const i = '$' + h8(read32(ctx)); return { size: 6, text: `cmpi.l  #${i}, ${eaCtx(ctx, 32).str}` }; },
  andi_ccr(ctx) { return { size: 4, text: `andi    #$${h2(read8(ctx))}, CCR` }; },
  andi_sr(ctx) { return { size: 4, text: `andi    #$${h4(read16(ctx))}, SR` }; },
  ori_ccr(ctx) { return { size: 4, text: `ori     #$${h2(read8(ctx))}, CCR` }; },
  ori_sr(ctx) { return { size: 4, text: `ori     #$${h4(read16(ctx))}, SR` }; },
  eori_ccr(ctx) { return { size: 4, text: `eori    #$${h2(read8(ctx))}, CCR` }; },
  eori_sr(ctx) { return { size: 4, text: `eori    #$${h4(read16(ctx))}, SR` }; },

  addq8(ctx) { return { size: 2, text: `addq.b  #${QDATA[(ctx.w >> 9) & 7]}, ${eaCtx(ctx, 8).str}` }; },
  addq16(ctx) { return { size: 2, text: `addq.w  #${QDATA[(ctx.w >> 9) & 7]}, ${eaCtx(ctx, 16).str}` }; },
  addq32(ctx) { return { size: 2, text: `addq.l  #${QDATA[(ctx.w >> 9) & 7]}, ${eaCtx(ctx, 32).str}` }; },
  subq8(ctx) { return { size: 2, text: `subq.b  #${QDATA[(ctx.w >> 9) & 7]}, ${eaCtx(ctx, 8).str}` }; },
  subq16(ctx) { return { size: 2, text: `subq.w  #${QDATA[(ctx.w >> 9) & 7]}, ${eaCtx(ctx, 16).str}` }; },
  subq32(ctx) { return { size: 2, text: `subq.l  #${QDATA[(ctx.w >> 9) & 7]}, ${eaCtx(ctx, 32).str}` }; },

  asr_s8(ctx) { return { size: 2, text: `asr.b   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  asr_s16(ctx) { return { size: 2, text: `asr.w   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  asr_s32(ctx) { return { size: 2, text: `asr.l   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  asr_r8(ctx) { return { size: 2, text: `asr.b   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  asr_r16(ctx) { return { size: 2, text: `asr.w   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  asr_r32(ctx) { return { size: 2, text: `asr.l   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  asr_ea(ctx) { return { size: 2, text: `asr.w   ${eaCtx(ctx, 16).str}` }; },
  asl_s8(ctx) { return { size: 2, text: `asl.b   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  asl_s16(ctx) { return { size: 2, text: `asl.w   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  asl_s32(ctx) { return { size: 2, text: `asl.l   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  asl_r8(ctx) { return { size: 2, text: `asl.b   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  asl_r16(ctx) { return { size: 2, text: `asl.w   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  asl_r32(ctx) { return { size: 2, text: `asl.l   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  asl_ea(ctx) { return { size: 2, text: `asl.w   ${eaCtx(ctx, 16).str}` }; },
  lsr_s8(ctx) { return { size: 2, text: `lsr.b   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  lsr_s16(ctx) { return { size: 2, text: `lsr.w   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  lsr_s32(ctx) { return { size: 2, text: `lsr.l   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  lsr_r8(ctx) { return { size: 2, text: `lsr.b   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  lsr_r16(ctx) { return { size: 2, text: `lsr.w   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  lsr_r32(ctx) { return { size: 2, text: `lsr.l   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  lsr_ea(ctx) { return { size: 2, text: `lsr.w   ${eaCtx(ctx, 16).str}` }; },
  lsl_s8(ctx) { return { size: 2, text: `lsl.b   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  lsl_s16(ctx) { return { size: 2, text: `lsl.w   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  lsl_s32(ctx) { return { size: 2, text: `lsl.l   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  lsl_r8(ctx) { return { size: 2, text: `lsl.b   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  lsl_r16(ctx) { return { size: 2, text: `lsl.w   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  lsl_r32(ctx) { return { size: 2, text: `lsl.l   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  lsl_ea(ctx) { return { size: 2, text: `lsl.w   ${eaCtx(ctx, 16).str}` }; },
  ror_s8(ctx) { return { size: 2, text: `ror.b   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  ror_s16(ctx) { return { size: 2, text: `ror.w   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  ror_s32(ctx) { return { size: 2, text: `ror.l   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  ror_r8(ctx) { return { size: 2, text: `ror.b   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  ror_r16(ctx) { return { size: 2, text: `ror.w   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  ror_r32(ctx) { return { size: 2, text: `ror.l   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  ror_ea(ctx) { return { size: 2, text: `ror.w   ${eaCtx(ctx, 16).str}` }; },
  rol_s8(ctx) { return { size: 2, text: `rol.b   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  rol_s16(ctx) { return { size: 2, text: `rol.w   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  rol_s32(ctx) { return { size: 2, text: `rol.l   #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  rol_r8(ctx) { return { size: 2, text: `rol.b   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  rol_r16(ctx) { return { size: 2, text: `rol.w   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  rol_r32(ctx) { return { size: 2, text: `rol.l   D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  rol_ea(ctx) { return { size: 2, text: `rol.w   ${eaCtx(ctx, 16).str}` }; },
  roxr_s8(ctx) { return { size: 2, text: `roxr.b  #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  roxr_s16(ctx) { return { size: 2, text: `roxr.w  #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  roxr_s32(ctx) { return { size: 2, text: `roxr.l  #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  roxr_r8(ctx) { return { size: 2, text: `roxr.b  D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  roxr_r16(ctx) { return { size: 2, text: `roxr.w  D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  roxr_r32(ctx) { return { size: 2, text: `roxr.l  D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  roxr_ea(ctx) { return { size: 2, text: `roxr.w  ${eaCtx(ctx, 16).str}` }; },
  roxl_s8(ctx) { return { size: 2, text: `roxl.b  #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  roxl_s16(ctx) { return { size: 2, text: `roxl.w  #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  roxl_s32(ctx) { return { size: 2, text: `roxl.l  #${QDATA[(ctx.w >> 9) & 7]}, D${ctx.w & 7}` }; },
  roxl_r8(ctx) { return { size: 2, text: `roxl.b  D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  roxl_r16(ctx) { return { size: 2, text: `roxl.w  D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  roxl_r32(ctx) { return { size: 2, text: `roxl.l  D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  roxl_ea(ctx) { return { size: 2, text: `roxl.w  ${eaCtx(ctx, 16).str}` }; },

  clr8(ctx) { return { size: 2, text: `clr.b   ${eaCtx(ctx, 8).str}` }; },
  clr16(ctx) { return { size: 2, text: `clr.w   ${eaCtx(ctx, 16).str}` }; },
  clr32(ctx) { return { size: 2, text: `clr.l   ${eaCtx(ctx, 32).str}` }; },
  neg8(ctx) { return { size: 2, text: `neg.b   ${eaCtx(ctx, 8).str}` }; },
  neg16(ctx) { return { size: 2, text: `neg.w   ${eaCtx(ctx, 16).str}` }; },
  neg32(ctx) { return { size: 2, text: `neg.l   ${eaCtx(ctx, 32).str}` }; },
  negx8(ctx) { return { size: 2, text: `negx.b  ${eaCtx(ctx, 8).str}` }; },
  negx16(ctx) { return { size: 2, text: `negx.w  ${eaCtx(ctx, 16).str}` }; },
  negx32(ctx) { return { size: 2, text: `negx.l  ${eaCtx(ctx, 32).str}` }; },
  not8(ctx) { return { size: 2, text: `not.b   ${eaCtx(ctx, 8).str}` }; },
  not16(ctx) { return { size: 2, text: `not.w   ${eaCtx(ctx, 16).str}` }; },
  not32(ctx) { return { size: 2, text: `not.l   ${eaCtx(ctx, 32).str}` }; },
  nbcd(ctx) { return { size: 2, text: `nbcd    ${eaCtx(ctx, 8).str}` }; },
  tas(ctx) { return { size: 2, text: `tas     ${eaCtx(ctx, 8).str}` }; },
  tst8(ctx) { return { size: 2, text: `tst.b   ${eaCtx(ctx, 8).str}` }; },
  tst16(ctx) { return { size: 2, text: `tst.w   ${eaCtx(ctx, 16).str}` }; },
  tst32(ctx) { return { size: 2, text: `tst.l   ${eaCtx(ctx, 32).str}` }; },
  ext16(ctx) { return { size: 2, text: `ext.w   D${ctx.w & 7}` }; },
  ext32(ctx) { return { size: 2, text: `ext.l   D${ctx.w & 7}` }; },
  swap(ctx) { return { size: 2, text: `swap    D${ctx.w & 7}` }; },
  exg_dd(ctx) { return { size: 2, text: `exg     D${(ctx.w >> 9) & 7}, D${ctx.w & 7}` }; },
  exg_aa(ctx) { return { size: 2, text: `exg     A${(ctx.w >> 9) & 7}, A${ctx.w & 7}` }; },
  exg_da(ctx) { return { size: 2, text: `exg     D${(ctx.w >> 9) & 7}, A${ctx.w & 7}` }; },

  bchg_r(ctx) { return { size: 2, text: `bchg    D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 8).str}` }; },
  bchg_s(ctx) { return { size: 4, text: `bchg    #$${h2(read8(ctx))}, ${eaCtx(ctx, 8).str}` }; },
  bclr_r(ctx) { return { size: 2, text: `bclr    D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 8).str}` }; },
  bclr_s(ctx) { return { size: 4, text: `bclr    #$${h2(read8(ctx))}, ${eaCtx(ctx, 8).str}` }; },
  bset_r(ctx) { return { size: 2, text: `bset    D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 8).str}` }; },
  bset_s(ctx) { return { size: 4, text: `bset    #$${h2(read8(ctx))}, ${eaCtx(ctx, 8).str}` }; },
  btst_r(ctx) { return { size: 2, text: `btst    D${(ctx.w >> 9) & 7}, ${eaCtx(ctx, 8).str}` }; },
  btst_s(ctx) { return { size: 4, text: `btst    #$${h2(read8(ctx))}, ${eaCtx(ctx, 8).str}` }; },

  chk16(ctx) { return { size: 2, text: `chk.w   ${eaCtx(ctx, 16).str}, D${(ctx.w >> 9) & 7}` }; },
  divs(ctx) { return { size: 2, text: `divs.w  ${eaCtx(ctx, 16).str}, D${(ctx.w >> 9) & 7}` }; },
  divu(ctx) { return { size: 2, text: `divu.w  ${eaCtx(ctx, 16).str}, D${(ctx.w >> 9) & 7}` }; },
  muls(ctx) { return { size: 2, text: `muls.w  ${eaCtx(ctx, 16).str}, D${(ctx.w >> 9) & 7}` }; },
  mulu(ctx) { return { size: 2, text: `mulu.w  ${eaCtx(ctx, 16).str}, D${(ctx.w >> 9) & 7}` }; },
  lea(ctx) { return { size: 2, text: `lea     ${eaCtx(ctx, 32).str}, A${(ctx.w >> 9) & 7}` }; },
  pea(ctx) { return { size: 2, text: `pea     ${eaCtx(ctx, 32).str}` }; },

  move8(ctx) {
    const src = eaCtx(ctx, 8);
    const dst = eaStr(ctx, 8, (ctx.w >> 6) & 7, (ctx.w >> 9) & 7);
    return { size: 2, text: `move.b  ${src.str}, ${dst.str}` };
  },
  move16(ctx) {
    const src = eaCtx(ctx, 16);
    const dst = eaStr(ctx, 16, (ctx.w >> 6) & 7, (ctx.w >> 9) & 7);
    return { size: 2, text: `move.w  ${src.str}, ${dst.str}` };
  },
  move32(ctx) {
    const src = eaCtx(ctx, 32);
    const dst = eaStr(ctx, 32, (ctx.w >> 6) & 7, (ctx.w >> 9) & 7);
    return { size: 2, text: `move.l  ${src.str}, ${dst.str}` };
  },
  movea16(ctx) { return { size: 2, text: `movea.w ${eaCtx(ctx, 16).str}, A${(ctx.w >> 9) & 7}` }; },
  movea32(ctx) { return { size: 2, text: `movea.l ${eaCtx(ctx, 32).str}, A${(ctx.w >> 9) & 7}` }; },
  move_ccr(ctx) { return { size: 2, text: `move    ${eaCtx(ctx, 8).str}, CCR` }; },
  move_sr(ctx) { return { size: 2, text: `move    ${eaCtx(ctx, 16).str}, SR` }; },
  move_fr_sr(ctx) { return { size: 2, text: `move    SR, ${eaCtx(ctx, 16).str}` }; },
  move_usp_to(ctx) { return { size: 2, text: `move    A${ctx.w & 7}, USP` }; },
  move_usp_fr(ctx) { return { size: 2, text: `move    USP, A${ctx.w & 7}` }; },
  moveq(ctx) { return { size: 2, text: `moveq   #${shex8(ctx.w & 0xff)}, D${(ctx.w >> 9) & 7}` }; },

  movep_er16(ctx) { const d = read16(ctx); return { size: 4, text: `movep.w ($${h4(d)},A${ctx.w & 7}), D${(ctx.w >> 9) & 7}` }; },
  movep_er32(ctx) { const d = read16(ctx); return { size: 4, text: `movep.l ($${h4(d)},A${ctx.w & 7}), D${(ctx.w >> 9) & 7}` }; },
  movep_re16(ctx) { const d = read16(ctx); return { size: 4, text: `movep.w D${(ctx.w >> 9) & 7}, ($${h4(d)},A${ctx.w & 7})` }; },
  movep_re32(ctx) { const d = read16(ctx); return { size: 4, text: `movep.l D${(ctx.w >> 9) & 7}, ($${h4(d)},A${ctx.w & 7})` }; },

  movem_pd16(ctx) { return movemHelper(ctx, 'w', true, 16); },
  movem_pd32(ctx) { return movemHelper(ctx, 'l', true, 32); },
  movem_re16(ctx) { return movemHelper(ctx, 'w', false, 16); },
  movem_re32(ctx) { return movemHelper(ctx, 'l', false, 32); },
  movem_er16(ctx) { return movemHelper(ctx, 'w', false, 16, true); },
  movem_er32(ctx) { return movemHelper(ctx, 'l', false, 32, true); },

  bra8(ctx) { return branchHelper(ctx, 'bra'); },
  bra16(ctx) { return branchHelper(ctx, 'bra'); },
  bsr8(ctx) { return branchHelper(ctx, 'bsr'); },
  bsr16(ctx) { return branchHelper(ctx, 'bsr'); },
  bcc8(ctx) { return branchHelper(ctx, 'bcc'); },
  bcc16(ctx) { return branchHelper(ctx, 'bcc'); },

  dbcc(ctx) {
    const d = read16(ctx);
    const cc = (ctx.w >> 8) & 0xf;
    const target = (ctx.addr + 2 + sgn16(d)) & 0xffffffff;
    return { size: 4, text: `db${CC[cc]}     D${ctx.w & 7}, ${cpu.addrFmt(target)}`, branch: { kind: 'cond', target, fallthrough: true } };
  },
  dbra(ctx) {
    const d = read16(ctx);
    const target = (ctx.addr + 2 + sgn16(d)) & 0xffffffff;
    return { size: 4, text: `dbra    D${ctx.w & 7}, ${cpu.addrFmt(target)}`, branch: { kind: 'cond', target, fallthrough: true, conditional: true } };
  },

  jmp(ctx) {
    const ea = eaCtx(ctx, 32);
    return { size: 2, text: `jmp     ${ea.str}`, branch: { kind: 'jump', target: ea.target, fallthrough: false } };
  },
  jsr(ctx) {
    const ea = eaCtx(ctx, 32);
    return { size: 2, text: `jsr     ${ea.str}`, branch: { kind: 'call', target: ea.target, fallthrough: true } };
  },

  link(ctx) { const d = read16(ctx); return { size: 4, text: `link    A${ctx.w & 7}, #${shex16(d)}` }; },
  unlk(ctx) { return { size: 2, text: `unlk    A${ctx.w & 7}` }; },
  nop(ctx) { return { size: 2, text: 'nop' }; },
  reset(ctx) { return { size: 2, text: 'reset' }; },
  rts(ctx) { return { size: 2, text: 'rts', branch: { kind: 'ret', target: null, fallthrough: false } }; },
  rte(ctx) { return { size: 2, text: 'rte', branch: { kind: 'ret', target: null, fallthrough: false } }; },
  rtr(ctx) { return { size: 2, text: 'rtr', branch: { kind: 'ret', target: null, fallthrough: false } }; },
  stop(ctx) { const i = read16(ctx); return { size: 4, text: `stop    #$${h4(i)}`, branch: { kind: 'jump', target: null, fallthrough: false } }; },
  trap(ctx) { return { size: 2, text: `trap    #$${h2(ctx.w & 0xf)}`, branch: { kind: 'call', target: null, fallthrough: true } }; },
  trapv(ctx) { return { size: 2, text: 'trapv' }; },
  scc(ctx) { return { size: 2, text: `s${CC[(ctx.w >> 8) & 0xf]}      ${eaCtx(ctx, 8).str}` }; },
};

function movemHelper(ctx, size, isPredec, sz, isEr) {
  const data = read16(ctx);
  const regs = formatRegList(data, isPredec);
  const mnem = 'movem.' + size;
  const ea = eaCtx(ctx, sz);
  if (isEr) return { size: 4, text: `${mnem}  ${ea.str}, ${regs}` };
  return { size: 4, text: `${mnem}  ${regs}, ${ea.str}` };
}
function formatRegList(data, isPredec) {
  const list = [];
  for (let i = 0; i < 16; i++) {
    if (data & (1 << i)) {
      const name = (i < 8 ? 'D' : 'A') + (i % 8);
      const last = list[list.length - 1];
      const cur = parseInt(name.slice(1), 10);
      if (last && last[0] === name[0]) {
        const parts = last.slice(1).split('-');
        const lastStart = parseInt(parts[0], 10);
        const lastEnd = parseInt((parts[1] || parts[0]).replace(/\D/g, ''), 10);
        if (lastEnd === cur - 1) {
          list[list.length - 1] = last[0] + lastStart + '-' + name;
          continue;
        }
      }
      list.push(name);
    }
  }
  return list.join('/') || '; ';
}

function branchHelper(ctx, mnem) {
  const cc = (ctx.w >> 8) & 0xf;
  const byte = ctx.w & 0xff;
  let target, size;
  if (byte === 0x00) {
    const d = read16(ctx);
    size = 4;
    target = (ctx.addr + 2 + sgn16(d)) & 0xffffffff;
  } else {
    size = 2;
    target = (ctx.addr + 2 + sgn8(byte)) & 0xffffffff;
  }
  let text;
  if (mnem === 'bra') text = 'bra     ' + cpu.addrFmt(target);
  else if (mnem === 'bsr') text = 'bsr     ' + cpu.addrFmt(target);
  else text = 'b' + CC[cc] + '      ' + cpu.addrFmt(target);
  const branch = mnem === 'bra' ? { kind: 'jump', target, fallthrough: false }
    : mnem === 'bsr' ? { kind: 'call', target, fallthrough: true }
      : { kind: 'cond', target, fallthrough: true };
  return { size, text, branch };
}