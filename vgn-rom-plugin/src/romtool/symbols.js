// symbols.js — known hardware register names per platform.
// Applied to the pseudo-C output so mem8[0x2002] reads as PPUSTATUS, etc.

const SYMBOLS = {
  nes: [
    [0x2000, 'PPUCTRL'], [0x2001, 'PPUMASK'], [0x2002, 'PPUSTATUS'],
    [0x2003, 'OAMADDR'], [0x2004, 'OAMDATA'], [0x2005, 'PPUSCROLL'],
    [0x2006, 'PPUADDR'], [0x2007, 'PPUDATA'], [0x4014, 'OAMDMA'],
    [0x4015, 'APUCTRL'], [0x4016, 'JOY1'], [0x4017, 'JOY2'],
  ],
  snes: [
    [0x2100, 'INIDISP'], [0x2101, 'OBSEL'], [0x2102, 'OAMADDL'], [0x2103, 'OAMADDH'],
    [0x2104, 'OAMDATA'], [0x2105, 'BGMODE'], [0x2106, 'MOSAIC'],
    [0x2107, 'BG1SC'], [0x2108, 'BG2SC'], [0x2109, 'BG3SC'], [0x210A, 'BG4SC'],
    [0x210B, 'BG12NBA'], [0x210C, 'BG34NBA'],
    [0x210D, 'BG1HOFS'], [0x210E, 'BG1VOFS'], [0x210F, 'BG2HOFS'], [0x2110, 'BG2VOFS'],
    [0x2111, 'BG3HOFS'], [0x2112, 'BG3VOFS'], [0x2113, 'BG4HOFS'], [0x2114, 'BG4VOFS'],
    [0x2115, 'VMAIN'], [0x2116, 'VMADDL'], [0x2117, 'VMADDH'], [0x2118, 'VMDATAL'], [0x2119, 'VMDATAH'],
    [0x2121, 'CGADD'], [0x2122, 'CGDATA'],
    [0x2140, 'APUIO0'], [0x2141, 'APUIO1'], [0x2142, 'APUIO2'], [0x2143, 'APUIO3'],
    [0x4200, 'NMITIMEN'], [0x4201, 'WRIO'], [0x4202, 'WRMPYA'], [0x4203, 'WRMPYB'],
    [0x4204, 'WRDIVL'], [0x4205, 'WRDIVH'], [0x4206, 'WRDIVB'], [0x4207, 'HTIME'], [0x4209, 'VTIME'],
    [0x420B, 'MDMAEN'], [0x420C, 'HDMAEN'], [0x420D, 'MEMSEL'],
    [0x4210, 'RDNMI'], [0x4211, 'TIMEUP'], [0x4212, 'HVBJOY'],
    [0x4214, 'RDDIVL'], [0x4215, 'RDDIVH'], [0x4216, 'RDMPYL'], [0x4217, 'RDMPYH'],
    [0x4218, 'JOY1L'], [0x4219, 'JOY1H'], [0x421A, 'JOY2L'], [0x421B, 'JOY2H'],
    [0x421C, 'JOY3L'], [0x421D, 'JOY3H'], [0x421E, 'JOY4L'], [0x421F, 'JOY4H'],
    [0x4300, 'DMAP'], [0x4301, 'BBAD'], [0x4302, 'A1T0L'], [0x4303, 'A1T0H'], [0x4304, 'A1T0B'],
    [0x4305, 'DAS0L'], [0x4306, 'DAS0H'], [0x4307, 'DAS0B'], [0x4308, 'A2A0L'], [0x4309, 'A2A0H'], [0x430A, 'A2A0B'],
  ],
  sms: [
    [0x7f, 'PSG'], [0xbe, 'VDP_DATA'], [0xbf, 'VDP_CTRL'],
    [0xdc, 'JOY_PORT1'], [0xdd, 'JOY_PORT2'],
  ],
  genesis: [
    [0xc00000, 'VDP_DATA'], [0xc00004, 'VDP_CTRL'], [0xc00008, 'VDP_COUNTER'],
    [0xa10000, 'MEM_MODE'], [0xa10001, 'VERSION'],
    [0xa10003, 'JOY1'], [0xa10005, 'JOY2'], [0xa10007, 'JOY3'],
    [0xa11100, 'Z80_BUS'], [0xa11200, 'Z80_RESET'],
    [0xa00000, 'Z80_RAM'], [0xa14000, 'TMSS'],
    [0x7f, 'PSG'], [0x200000, 'SRAM'],
  ],
};

const RX = /mem(?:8|16|32)\[0x([0-9A-F]+)\]/g;

export function symbolNames(cpuId) {
  return SYMBOLS[cpuId] || [];
}

export function applyHwSymbols(text, cpuId) {
  const list = SYMBOLS[cpuId];
  if (!list || !list.length) return text;
  const map = new Map();
  for (const [a, n] of list) map.set(a, n);
  return text.replace(RX, (m, hex) => {
    let v = parseInt(hex, 16);
    const name = map.get(v) || (cpuId !== 'genesis' ? map.get(v & 0xffff) : undefined);
    return name ? name : m;
  });
}
