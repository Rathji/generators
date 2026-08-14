// Replacement for node's `crypto` module (only randomBytes is used).
function randomBytes(size: number): any {
  const b = new Uint8Array(size);
  for (let i = 0; i < size; i++) b[i] = Math.floor(Math.random() * 256);
  (b as any).readUInt32BE = function (offset: number = 0) {
    return ((this[offset] << 24) | (this[offset + 1] << 16) | (this[offset + 2] << 8) | this[offset + 3]) >>> 0;
  };
  return b;
}
export default { randomBytes };

