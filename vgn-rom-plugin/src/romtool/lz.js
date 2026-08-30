// lz.js — décompresseur LZ « fenêtre » porté de SNESTilesKitten (Comp.cpp).
// Même format partagé par les plugins Konami1, BandaiNamco et Terranigma :
//   2 premiers octets gros-boutiste = taille décompressée ; puis :
//   b < 0x80        : LZ : b<<8|c → reps=((v>>10)&0xFF)+2, from=(v&0x3FF), copie depuis fenêtre
//   0x80 ≤ b < 0xC0 : brut : reps = b&0x1F octets littéraux
//   0xC0 ≤ b < 0xE0 : RLE : reps=(b&0x1F)+2 fois l'octet suivant
//   0xE0 ≤ b        : zéros : reps=(b&0x1F)+2 octets 0
export function konamiLzDecompress(bytes, start, maxOut) {
  const window = new Uint8Array(1024);
  const out = [];
  let wndOff = 0x3df;
  let r = start;
  const limit = Math.min(bytes.length, start + 0x100000);
  const size = (bytes[r] << 8) | bytes[r + 1];
  if (r + 2 > bytes.length) return null;
  r += 2;
  const outLimit = maxOut || 0x10000;
  try {
    while (r - 2 < size && out.length < outLimit && r < limit) {
      let b = bytes[r++];
      let reps, from = 0;
      if (b < 0x80) {
        const p = (b << 8) | bytes[r++];
        reps = ((p >> 10) & 0xff) + 2;
        from = p & 0x3ff;
      } else if (b < 0xc0) {
        reps = b & 0x1f;
        for (let i = 0; i < reps; i++) { const v = bytes[r++]; out.push(v); window[wndOff & 0x3ff] = v; wndOff++; }
        reps = 0;
      } else if (b < 0xe0) {
        reps = (b & 0x1f) + 2;
        const v = bytes[r++];
        for (let i = 0; i < reps; i++) { out.push(v); window[wndOff & 0x3ff] = v; wndOff++; }
        reps = 0;
      } else {
        reps = (b & 0x1f) + 2;
        for (let i = 0; i < reps; i++) { out.push(0); window[wndOff & 0x3ff] = 0; wndOff++; }
        reps = 0;
      }
      for (let i = 0; i < reps; i++) { const v = window[from & 0x3ff]; from++; out.push(v); window[wndOff & 0x3ff] = v; wndOff++; }
    }
  } catch (e) { return null; }
  return new Uint8Array(out);
}

// Vérifie si les données décompressées ressemblent à un tas de tuiles 4bpp plausible.
export function looksLikeTiles(data, tileSize) {
  if (!data || data.length < tileSize * 4) return false;
  let nz = 0;
  const vals = new Set();
  for (let i = 0; i < Math.min(data.length, tileSize * 8); i++) {
    if (data[i]) nz++;
    if (vals.size < 32) vals.add(data[i]);
  }
  return nz > 4 && vals.size >= 3;
}
