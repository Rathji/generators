// Axial hex math for pointy-top hexes.
export const DIRS = [[1, 0], [1, -1], [0, -1], [-1, 0], [-1, 1], [0, 1]];

export function axialRound(q, r) {
  let s = -q - r;
  let rq = Math.round(q), rr = Math.round(r), rs = Math.round(s);
  const dq = Math.abs(rq - q), dr = Math.abs(rr - r), ds = Math.abs(rs - s);
  if (dq > dr && dq > ds) rq = -rr - rs;
  else if (dr > ds) rr = -rq - rs;
  return { q: rq, r: rr };
}

export function hexToPixel(q, r, size) {
  return { x: size * Math.sqrt(3) * (q + r / 2), y: size * 1.5 * r };
}

export function pixelToHex(x, y, size) {
  const q = (Math.sqrt(3) / 3 * x - y / 3) / size;
  const r = (2 / 3 * y) / size;
  return axialRound(q, r);
}

export function hexDist(a, b) {
  const dq = a.q - b.q, dr = a.r - b.r;
  return Math.round((Math.abs(dq) + Math.abs(dr) + Math.abs(dq + dr)) / 2);
}

export function inBounds(q, r, w, h) {
  return q >= 0 && q < w && r >= 0 && r < h;
}

export function key(q, r) { return q + ',' + r; }
export function keyOf(h) { return h.q + ',' + h.r; }

export function hexCorners(q, r, size) {
  const c = hexToPixel(q, r, size);
  const pts = [];
  for (let i = 0; i < 6; i++) {
    const a = Math.PI / 3 * i - Math.PI / 6;
    pts.push([c.x + size * Math.cos(a), c.y + size * Math.sin(a)]);
  }
  return pts;
}
