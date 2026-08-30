// MemoryView — abstract CPU address space backed by segments of the ROM file.
// Supports linear segments (NES/SMS/Genesis) and custom read functions (SNES banking).

export class MemoryView {
  constructor(segments = [], opts = {}) {
    this.segments = segments.filter((s) => s.bytes.length > 0).sort((a, b) => a.start - b.start);
    this.opts = opts;
    this.mask = opts.mask != null ? opts.mask : 0xffffff;
    this.customRead = opts.readByte || null;
    this.mirroredSegs = opts.mirroredSegs || null;
    this.coverRanges = opts.coverRanges || null;
  }

  _locate(addr) {
    const segs = this.segments;
    let lo = 0, hi = segs.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1;
      const s = segs[mid];
      if (addr < s.start) hi = mid - 1;
      else if (addr >= s.start + s.bytes.length) lo = mid + 1;
      else return s;
    }
    return null;
  }

  readByte(addr) {
    if (this.customRead) {
      const v = this.customRead(addr);
      if (v != null && v >= 0) return v;
    }
    const a = addr & this.mask;
    const s = this._locate(a);
    return s ? s.bytes[a - s.start] : null;
  }

  readBytes(addr, n) {
    const out = [];
    for (let i = 0; i < n; i++) {
      const b = this.readByte(addr + i);
      if (b === null || b === undefined) return null;
      out.push(b);
    }
    return out;
  }

  readWord(addr) {
    const b0 = this.readByte(addr), b1 = this.readByte(addr + 1);
    if (b0 == null || b1 == null) return null;
    return (b0 | (b1 << 8)) & 0xffff;
  }

  readWordBE(addr) {
    const b0 = this.readByte(addr), b1 = this.readByte(addr + 1);
    if (b0 == null || b1 == null) return null;
    return ((b0 << 8) | b1) & 0xffff;
  }

  readLong24(addr) {
    const b0 = this.readByte(addr), b1 = this.readByte(addr + 1), b2 = this.readByte(addr + 2);
    if (b0 == null || b1 == null || b2 == null) return null;
    return ((b0 << 16) | (b1 << 8) | b2) & 0xffffff;
  }

  readWord32(addr) {
    const b0 = this.readByte(addr), b1 = this.readByte(addr + 1), b2 = this.readByte(addr + 2), b3 = this.readByte(addr + 3);
    if (b0 == null || b1 == null || b2 == null || b3 == null) return null;
    return ((b0 | (b1 << 8) | (b2 << 16) | (b3 << 24)) | 0) >>> 0;
  }

  readWord32BE(addr) {
    const b0 = this.readByte(addr), b1 = this.readByte(addr + 1), b2 = this.readByte(addr + 2), b3 = this.readByte(addr + 3);
    if (b0 == null || b1 == null || b2 == null || b3 == null) return null;
    return ((((b0 << 24) | (b1 << 16) | (b2 << 8) | b3) | 0) >>> 0);
  }

  contains(addr) {
    if (this.customRead) return this.readByte(addr) != null;
    return this._locate(addr & this.mask) != null;
  }

  fileOffset(addr) {
    if (this.customRead) return null;
    const s = this._locate(addr & this.mask);
    if (!s) return null;
    const off = s.fileOffset != null ? s.fileOffset + (addr & this.mask) - s.start : null;
    return off;
  }
}
