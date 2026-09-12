// src/framework/store/chunking.js — byte-accurate splitting of a serialized
// document into ceiling-bounded pieces (so no single physical write can ever
// exceed the storage ceiling), plus a fast content hash used for change
// detection and integrity checks.
//
// Chunks are cut at UTF-8 byte boundaries but never split a surrogate pair,
// so joining the pieces verbatim and JSON.parse-ing the result is always valid.

export const CHUNK_CEILING = 200 * 1024;

export function byteLength(str) {
  return new TextEncoder().encode(str).length;
}

export function splitStringByBytes(str, maxBytes) {
  if (str.length === 0) return [""];
  const chunks = [];
  let start = 0;
  let bytes = 0;
  for (let i = 0; i < str.length; i++) {
    const cp = str.codePointAt(i);
    const b = cp <= 0x7f ? 1 : cp <= 0x7ff ? 2 : cp <= 0xffff ? 3 : 4;
    if (bytes + b > maxBytes && bytes > 0) {
      chunks.push(str.slice(start, i));
      start = i;
      bytes = 0;
    }
    bytes += b;
    if (cp > 0xffff) i++;
  }
  chunks.push(str.slice(start));
  return chunks;
}

// cyrb53 — fast 64-bit string hash (hex), used to detect content changes and
// verify chunk integrity on read. Not cryptographic; that's fine here since
// the store only needs accidental-corruption and change detection.
export function hashString(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, "0") + (h1 >>> 0).toString(16).padStart(8, "0");
}
