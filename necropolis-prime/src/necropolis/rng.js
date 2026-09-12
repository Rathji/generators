export function hashSeed(str){
  let h = 2166136261 >>> 0;
  const s = String(str);
  for (let i = 0; i < s.length; i++){
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

export function makeRng(seed){
  let a = (typeof seed === "number" ? seed : hashSeed(seed)) >>> 0;
  const next = () => {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  const rng = {
    next,
    float: (min = 0, max = 1) => min + next() * (max - min),
    int: (min, max) => Math.floor(min + next() * (max - min + 1)),
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    pickWeighted: (arr, weights) => {
      let total = 0; for (const w of weights) total += w;
      let r = next() * total;
      for (let i = 0; i < arr.length; i++){ r -= weights[i]; if (r <= 0) return arr[i]; }
      return arr[arr.length - 1];
    },
    shuffle: (arr) => {
      for (let i = arr.length - 1; i > 0; i--){
        const j = Math.floor(next() * (i + 1));
        [arr[i], arr[j]] = [arr[j], arr[i]];
      }
      return arr;
    },
    gauss: () => {
      let u = 0, v = 0;
      while (u === 0) u = next();
      while (v === 0) v = next();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    fork: () => makeRng(Math.floor(next() * 4294967296)),
  };
  return rng;
}
