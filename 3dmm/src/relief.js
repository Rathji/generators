import { THREE, mergeGeometries } from "./three.js";

export function bilinear(data, w, h, u, v) {
  const x = (u < 0 ? 0 : u > 1 ? 1 : u) * (w - 1);
  const y = (v < 0 ? 0 : v > 1 ? 1 : v) * (h - 1);
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const x1 = Math.min(x0 + 1, w - 1);
  const y1 = Math.min(y0 + 1, h - 1);
  const fx = x - x0;
  const fy = y - y0;
  const a = data[y0 * w + x0];
  const b = data[y0 * w + x1];
  const c = data[y1 * w + x0];
  const d = data[y1 * w + x1];
  return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
}

function percentileRange(arr, lo, hi) {
  const s = Float32Array.from(arr).sort();
  return [s[Math.floor(s.length * lo)], s[Math.floor(s.length * hi)]];
}

function boxBlur(src, w, h, radius) {
  if (radius < 1) return src;
  const tmp = new Float32Array(src.length);
  const out = new Float32Array(src.length);
  const win = radius * 2 + 1;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const xx = x + k < 0 ? 0 : x + k >= w ? w - 1 : x + k;
        s += src[y * w + xx];
      }
      tmp[y * w + x] = s / win;
    }
  }
  for (let x = 0; x < w; x++) {
    for (let y = 0; y < h; y++) {
      let s = 0;
      for (let k = -radius; k <= radius; k++) {
        const yy = y + k < 0 ? 0 : y + k >= h ? h - 1 : y + k;
        s += tmp[yy * w + x];
      }
      out[y * w + x] = s / win;
    }
  }
  return out;
}

export const smoothstep = (t) => {
  const x = t < 0 ? 0 : t > 1 ? 1 : t;
  return x * x * (3 - 2 * x);
};

function keepLargeComponents(mask, gw, gh, minFrac) {
  const labels = new Int32Array(mask.length).fill(-1);
  const stack = [];
  const sizes = [];
  for (let start = 0; start < mask.length; start++) {
    if (!mask[start] || labels[start] !== -1) continue;
    const id = sizes.length;
    let size = 0;
    stack.push(start);
    labels[start] = id;
    while (stack.length) {
      const k = stack.pop();
      size++;
      const x = k % gw;
      const y = (k / gw) | 0;
      if (x > 0) { const n = k - 1; if (mask[n] && labels[n] === -1) { labels[n] = id; stack.push(n); } }
      if (x < gw - 1) { const n = k + 1; if (mask[n] && labels[n] === -1) { labels[n] = id; stack.push(n); } }
      if (y > 0) { const n = k - gw; if (mask[n] && labels[n] === -1) { labels[n] = id; stack.push(n); } }
      if (y < gh - 1) { const n = k + gw; if (mask[n] && labels[n] === -1) { labels[n] = id; stack.push(n); } }
    }
    sizes.push(size);
  }
  if (!sizes.length) return mask;
  const minSize = Math.max(40, Math.max(...sizes) * minFrac);
  const out = new Uint8Array(mask.length);
  for (let k = 0; k < mask.length; k++) {
    const l = labels[k];
    if (l >= 0 && sizes[l] >= minSize) out[k] = 1;
  }
  return out;
}

function distanceTransform(mask, gw, gh) {
  const INF = 1e9;
  const D1 = 1;
  const D2 = 1.41421356;
  const d = new Float32Array(gw * gh);
  for (let k = 0; k < mask.length; k++) d[k] = mask[k] ? INF : 0;
  for (let y = 0; y < gh; y++) {
    for (let x = 0; x < gw; x++) {
      const k = y * gw + x;
      let m = d[k];
      if (x > 0) m = Math.min(m, d[k - 1] + D1);
      if (y > 0) m = Math.min(m, d[k - gw] + D1);
      if (x > 0 && y > 0) m = Math.min(m, d[k - gw - 1] + D2);
      if (x < gw - 1 && y > 0) m = Math.min(m, d[k - gw + 1] + D2);
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) m = Math.min(m, D1);
      d[k] = m;
    }
  }
  for (let y = gh - 1; y >= 0; y--) {
    for (let x = gw - 1; x >= 0; x--) {
      const k = y * gw + x;
      let m = d[k];
      if (x < gw - 1) m = Math.min(m, d[k + 1] + D1);
      if (y < gh - 1) m = Math.min(m, d[k + gw] + D1);
      if (x < gw - 1 && y < gh - 1) m = Math.min(m, d[k + gw + 1] + D2);
      if (x > 0 && y < gh - 1) m = Math.min(m, d[k + gw - 1] + D2);
      if (x === 0 || y === 0 || x === gw - 1 || y === gh - 1) m = Math.min(m, D1);
      d[k] = m;
    }
  }
  return d;
}

function gridDims(width, height, segments) {
  const aspect = width / height;
  let gW, gH;
  if (aspect >= 1) {
    gW = segments;
    gH = Math.max(4, Math.round(segments / aspect));
  } else {
    gH = segments;
    gW = Math.max(4, Math.round(segments * aspect));
  }
  return { gW, gH, aspect };
}

export function computeCutoutMask(alpha, width, height, segments) {
  const { gW, gH } = gridDims(width, height, segments);
  const gw = gW + 1;
  const gh = gH + 1;
  const agrid = new Float32Array(gw * gh);
  for (let j = 0; j < gh; j++) {
    const v = j / gH;
    for (let i = 0; i < gw; i++) {
      agrid[j * gw + i] = bilinear(alpha, width, height, i / gW, v);
    }
  }
  const m = Math.min(gw, gh);
  const field = boxBlur(agrid, gw, gh, Math.max(1, Math.round(m / 30)));
  /* Force the outermost grid ring to read as "outside" the silhouette. A subject that runs
     off the edge of the frame would otherwise leave the marching-squares contour open at
     the border, which cannot be closed into a solid. Pulling the contour one cell inside
     the frame lets it close cleanly (the solid is simply cut a hair short of the border). */
  for (let x = 0; x < gw; x++) {
    if (field[x] > 0.45) field[x] = 0.45;
    const b = (gh - 1) * gw + x;
    if (field[b] > 0.45) field[b] = 0.45;
  }
  for (let y = 0; y < gh; y++) {
    if (field[y * gw] > 0.45) field[y * gw] = 0.45;
    const r = y * gw + gw - 1;
    if (field[r] > 0.45) field[r] = 0.45;
  }
  const raw = new Uint8Array(gw * gh);
  let count = 0;
  for (let k = 0; k < field.length; k++) {
    if (field[k] >= 0.5) { raw[k] = 1; count++; }
  }
  if (count <= 8) return { mask: null, field, gw, gh, gW, gH };
  const mask = keepLargeComponents(raw, gw, gh, 0.02);

  const reachable = new Uint8Array(gw * gh);
  const bfs = [];
  for (let x = 0; x < gw; x++) { bfs.push(x, (gh - 1) * gw + x); }
  for (let y = 0; y < gh; y++) { bfs.push(y * gw, y * gw + gw - 1); }
  while (bfs.length) {
    const k = bfs.pop();
    if (k < 0 || k >= mask.length || reachable[k] || mask[k]) continue;
    reachable[k] = 1;
    const x = k % gw;
    const y = (k / gw) | 0;
    if (x > 0) bfs.push(k - 1);
    if (x < gw - 1) bfs.push(k + 1);
    if (y > 0) bfs.push(k - gw);
    if (y < gh - 1) bfs.push(k + gw);
    if (x > 0 && y > 0) bfs.push(k - gw - 1);
    if (x < gw - 1 && y > 0) bfs.push(k - gw + 1);
    if (x > 0 && y < gh - 1) bfs.push(k + gw - 1);
    if (x < gw - 1 && y < gh - 1) bfs.push(k + gw + 1);
  }
  let covered = 0;
  for (let k = 0; k < mask.length; k++) if (mask[k]) covered++;
  const maxHole = Math.max(32, covered * 0.02);
  const seen = new Uint8Array(mask.length);
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] || reachable[start] || seen[start]) continue;
    const comp = [];
    const st = [start];
    seen[start] = 1;
    while (st.length) {
      const k = st.pop();
      comp.push(k);
      const x = k % gw;
      const y = (k / gw) | 0;
      if (x > 0) { const n = k - 1; if (!mask[n] && !reachable[n] && !seen[n]) { seen[n] = 1; st.push(n); } }
      if (x < gw - 1) { const n = k + 1; if (!mask[n] && !reachable[n] && !seen[n]) { seen[n] = 1; st.push(n); } }
      if (y > 0) { const n = k - gw; if (!mask[n] && !reachable[n] && !seen[n]) { seen[n] = 1; st.push(n); } }
      if (y < gh - 1) { const n = k + gw; if (!mask[n] && !reachable[n] && !seen[n]) { seen[n] = 1; st.push(n); } }
    }
    if (comp.length <= maxHole) for (const k of comp) { mask[k] = 1; field[k] = 1; }
  }

  for (let k = 0; k < field.length; k++) {
    if (!mask[k] && field[k] > 0.42) field[k] = 0.42;
  }
  return { mask, field, gw, gh, gW, gH };
}

/* The two arrays below describe, for a marching-squares cell, its four grid corners
   (in (x, y) cell space) and the four edge pairs between consecutive corners. Hoisted
   to module scope because reliefCellPolys runs once per grid cell. */
const CORNER_UV = [[0, 0], [1, 0], [1, 1], [0, 1]];
const EDGE_CORNERS = [[0, 1], [1, 2], [2, 3], [3, 0]];

/* Extract the iso-polygon(s) of the blurred alpha field F inside one grid cell.
   Each returned polygon is an array of { u, v, cross } points in [0,1] domain space,
   where `cross` marks a point that lies exactly on the iso-contour. Walking cells and
   using the same polygons for our front and back sheets (with z forced to 0 at the
   crossing points) is what makes a masked solid watertight: the front rim edge and the
   back rim edge are then the *same* segment, so each is shared by exactly two triangles.
   `centerInside(i, j)` disambiguates the four-crossing saddle case. */
export function reliefCellPolys(F, gW, gH, gw, i, j, centerInside) {
  const val = [];
  for (let k = 0; k < 4; k++) val.push(F[(j + CORNER_UV[k][1]) * gw + (i + CORNER_UV[k][0])]);
  const inside = val.map((v) => v >= 0.5);
  const nIn = inside.filter(Boolean).length;
  const polys = [];
  if (nIn === 0) return polys;
  if (nIn === 4) {
    polys.push(CORNER_UV.map((c) => ({ u: (i + c[0]) / gW, v: (j + c[1]) / gH, cross: false })));
    return polys;
  }
  const cross = [];
  const items = [];
  for (let k = 0; k < 4; k++) {
    items.push({ corner: k, cross: false });
    const ec = EDGE_CORNERS[k];
    if (inside[ec[0]] !== inside[ec[1]]) {
      /* Keep the crossing strictly inside the edge. A crossing that lands exactly on a
         grid corner would share the corner's (u, v) key — and, for the solid builder, that
         would collapse the z = 0 rim point into the corner's raised point, tearing the
         shared rim. A tiny inset keeps the two distinct; neighbouring cells sample the
         same edge with the same values, so they still agree on the point. */
      const EPS = 0.02;
      let t = (0.5 - val[ec[0]]) / (val[ec[1]] - val[ec[0]]);
      t = t < EPS ? EPS : t > 1 - EPS ? 1 - EPS : t;
      const cu = i + CORNER_UV[ec[0]][0] + t * (CORNER_UV[ec[1]][0] - CORNER_UV[ec[0]][0]);
      const cv = j + CORNER_UV[ec[0]][1] + t * (CORNER_UV[ec[1]][1] - CORNER_UV[ec[0]][1]);
      const pt = { u: cu / gW, v: cv / gH, cross: true, edge: k };
      cross.push(pt);
      items.push({ corner: k, cross: true, pt });
    }
  }
  const cp = (k) => ({ u: (i + CORNER_UV[k][0]) / gW, v: (j + CORNER_UV[k][1]) / gH, cross: false });
  if (cross.length === 4) {
    if (centerInside(i, j)) {
      const poly = [];
      for (const it of items) {
        if (it.cross) poly.push(it.pt);
        else if (inside[it.corner]) poly.push(cp(it.corner));
      }
      let start = 0;
      for (let s = 0; s < poly.length; s++) if (poly[s].cross) { start = s; break; }
      polys.push(poly.slice(start).concat(poly.slice(0, start)));
    } else {
      for (let k = 0; k < 4; k++) {
        if (!inside[k]) continue;
        const next = cross.find((p) => p.edge === k);
        const prev = cross.find((p) => p.edge === (k + 3) % 4);
        if (next && prev) polys.push([prev, cp(k), next]);
      }
    }
  } else if (cross.length >= 2) {
    let start = 0;
    for (let s = 0; s < items.length; s++) if (items[s].cross) { start = s; break; }
    const rot = items.slice(start).concat(items.slice(0, start));
    const groups = [];
    let g = null;
    for (const it of rot) {
      if (it.cross) {
        g = { from: it.pt, keys: [] };
        groups.push(g);
      } else if (g) g.keys.push(it.corner);
    }
    for (let s = 0; s < groups.length; s++) {
      const a = groups[s];
      const b = groups[(s + 1) % groups.length];
      if (a.keys.length && a.keys.every((k) => inside[k])) {
        polys.push([a.from, ...a.keys.map(cp), b.from]);
      }
    }
  }
  return polys;
}

/* Turn a depth map (plus optional alpha) into the normalised height grid that both the
   relief sheet and the solid-volume builder start from: bilinear resample, percentile
   normalise, optional smooth, silhouette bevel (height -> 0 at the cut-out rim) and the
   optional rectangular falloff. Returns the grid plus every derived field the callers
   need, so the two builders cannot drift apart. */
export function prepareReliefGrid(opts) {
  const {
    depth, width, height, alpha = null,
    segments = 220, relief = 0.45, thickness = 0.06,
    invert = false, smooth = 0.25, useAlpha = true,
    cutout = false, falloff = 0.0, size = 2,
  } = opts;

  const { gW, gH, aspect } = gridDims(width, height, segments);
  const gw = gW + 1;
  const gh = gH + 1;

  const hasAlpha = !!(alpha && useAlpha);
  let grid = new Float32Array(gw * gh);

  for (let j = 0; j < gh; j++) {
    const v = j / gH;
    for (let i = 0; i < gw; i++) {
      const u = i / gW;
      grid[j * gw + i] = bilinear(depth, width, height, u, v);
    }
  }

  const [lo, hi] = percentileRange(grid, 0.01, 0.99);
  const span = hi - lo || 1;
  for (let k = 0; k < grid.length; k++) {
    let t = (grid[k] - lo) / span;
    t = t < 0 ? 0 : t > 1 ? 1 : t;
    grid[k] = invert ? 1 - t : t;
  }

  if (smooth > 0) {
    const r = Math.round((smooth * Math.min(gw, gh)) / 32);
    if (r >= 1) grid = boxBlur(grid, gw, gh, r);
  }

  let mask = null;
  let maskField = null;
  let dist = null;
  let bevel = 0;
  if (hasAlpha) {
    const res = computeCutoutMask(alpha, width, height, segments);
    if (cutout && res.mask) mask = res.mask;
    maskField = res.field;
    if (mask) {
      dist = distanceTransform(mask, gw, gh);
      bevel = Math.max(3, Math.min(gw, gh) / 38);
      for (let k = 0; k < grid.length; k++) {
        grid[k] *= smoothstep(dist[k] / bevel);
      }
    } else {
      for (let k = 0; k < grid.length; k++) {
        grid[k] *= smoothstep((res.field[k] - 0.42) / 0.5);
      }
    }
  }

  if (!mask && falloff > 0) {
    for (let j = 0; j < gh; j++) {
      const v = j / gH;
      const wy = Math.min(1, Math.min(v, 1 - v) / falloff);
      for (let i = 0; i < gw; i++) {
        const u = i / gW;
        const wx = Math.min(1, Math.min(u, 1 - u) / falloff);
        grid[j * gw + i] *= smoothstep(Math.min(wx, wy));
      }
    }
  }

  const W = aspect >= 1 ? size : size * aspect;
  const H = aspect >= 1 ? size / aspect : size;
  const zScale = relief * size * 0.5;
  const back = -thickness * size;
  return { grid, mask, maskField, dist, bevel, hasAlpha, gw, gh, gW, gH, aspect, W, H, zScale, back };
}

export function buildReliefGeometry(opts) {
  const { size = 2, volume = false } = opts;
  const { grid, mask, maskField, gw, gh, gW, gH, W, H, zScale, back } = prepareReliefGrid(opts);

  const fx = (i) => (i / gW - 0.5) * W;
  const fy = (j) => (0.5 - j / gH) * H;
  const fz = (i, j) => grid[j * gw + i] * zScale;

  const f0 = (i, j) => [fx(i), fy(j), fz(i, j)];
  const b0 = (i, j) => [fx(i), fy(j), back];

  function addQuad(p0, p1, p2, p3, outward, into) {
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    let n = [
      e1[1] * e2[2] - e1[2] * e2[1],
      e1[2] * e2[0] - e1[0] * e2[2],
      e1[0] * e2[1] - e1[1] * e2[0],
    ];
    const d = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2];
    let pts = [p0, p1, p2, p3];
    if (d < 0) {
      pts = [p0, p3, p2, p1];
      n = [-n[0], -n[1], -n[2]];
    }
    const len = Math.hypot(n[0], n[1], n[2]) || 1;
    n = [n[0] / len, n[1] / len, n[2] / len];
    return { pts, n, into };
  }

  const wallPts = [];
  const wallNor = [];
  const wallUv = [];
  const wallIdx = [];

  function pushWall(p0, p1, p2, p3, outward) {
    const q = addQuad(p0, p1, p2, p3, outward, "wall");
    const base = wallPts.length / 3;
    const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
    for (let i = 0; i < 4; i++) {
      wallPts.push(q.pts[i][0], q.pts[i][1], q.pts[i][2]);
      wallNor.push(q.n[0], q.n[1], q.n[2]);
      wallUv.push(uvs[i][0], uvs[i][1]);
    }
    wallIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }

  function pushBackTri(p0, p1, p2) {
    const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const nz = e1[0] * e2[1] - e1[1] * e2[0];
    const pts = nz > 0 ? [p0, p2, p1] : [p0, p1, p2];
    const base = wallPts.length / 3;
    for (const p of pts) {
      wallPts.push(p[0], p[1], p[2]);
      wallNor.push(0, 0, -1);
    }
    wallUv.push(0, 0, 1, 0, 0, 1);
    wallIdx.push(base, base + 1, base + 2);
  }

  let fpos, fuv, fidx;

  if (mask) {
    const F = maskField;
    const xAt = (u) => (u - 0.5) * W;
    const yAt = (v) => (0.5 - v) * H;
    const zAt = (u, v) => bilinear(grid, gw, gh, u, v) * zScale;
    const hstep = W / gW / 2;
    const sampleF = (x, y) => bilinear(F, gw, gh, x / W + 0.5, 0.5 - y / H);
    const outwardAt = (x, y) => {
      const gx = (sampleF(x + hstep, y) - sampleF(x - hstep, y)) / (2 * hstep);
      const gy = (sampleF(x, y + hstep) - sampleF(x, y - hstep)) / (2 * hstep);
      let ox = -gx;
      let oy = -gy;
      const l = Math.hypot(ox, oy) || 1;
      return [ox / l, oy / l, 0];
    };

    const fMap = new Map();
    const Fpos = [];
    const Fuv = [];
    const Fidx = [];
    const keyUV = (u, v) => Math.round(u * 1e6) + ":" + Math.round(v * 1e6);
    const fvid = (u, v) => {
      const key = keyUV(u, v);
      let id = fMap.get(key);
      if (id === undefined) {
        id = Fpos.length / 3;
        fMap.set(key, id);
        Fpos.push(xAt(u), yAt(v), zAt(u, v));
        Fuv.push(u, 1 - v);
      }
      return id;
    };

    const centerInside = (i, j) => sampleF(xAt((i + 0.5) / gW), yAt((j + 0.5) / gH)) >= 0.5;

    for (let j = 0; j < gH; j++) {
      for (let i = 0; i < gW; i++) {
        const polys = reliefCellPolys(F, gW, gH, gw, i, j, centerInside);

        for (let pi = 0; pi < polys.length; pi++) {
          let poly = polys[pi];
          const wx = (p) => (p.u - 0.5) * W;
          const wy = (p) => (0.5 - p.v) * H;
          let area = 0;
          for (let s = 0; s < poly.length; s++) {
            const a = poly[s];
            const b = poly[(s + 1) % poly.length];
            area += wx(a) * wy(b) - wx(b) * wy(a);
          }
          if (area < 0) poly = poly.slice().reverse();
          const ids = poly.map((p) => fvid(p.u, p.v));
          for (let t = 1; t < ids.length - 1; t++) Fidx.push(ids[0], ids[t], ids[t + 1]);
          const bz = (p) => (volume ? -zAt(p.u, p.v) : back);
          const bpts = poly.map((p) => [wx(p), wy(p), bz(p)]);
          for (let t = 1; t < bpts.length - 1; t++) pushBackTri(bpts[0], bpts[t], bpts[t + 1]);
          for (let t = 0; t < poly.length; t++) {
            const a = poly[t];
            const b = poly[(t + 1) % poly.length];
            if (!a.cross && !b.cross) continue;
            const pA = [xAt(a.u), yAt(a.v), zAt(a.u, a.v)];
            const pB = [xAt(b.u), yAt(b.v), zAt(b.u, b.v)];
            const out = outwardAt((pA[0] + pB[0]) / 2, (pA[1] + pB[1]) / 2);
            pushWall(pA, pB, [pB[0], pB[1], bz(b)], [pA[0], pA[1], bz(a)], out);
          }
        }
      }
    }

    fpos = new Float32Array(Fpos);
    fuv = new Float32Array(Fuv);
    for (let t = 0; t < Fidx.length; t += 3) {
      const a = Fidx[t] * 3;
      const b = Fidx[t + 1] * 3;
      const c = Fidx[t + 2] * 3;
      const nz = (Fpos[b] - Fpos[a]) * (Fpos[c + 1] - Fpos[a + 1]) - (Fpos[b + 1] - Fpos[a + 1]) * (Fpos[c] - Fpos[a]);
      if (nz < 0) {
        const tmp = Fidx[t + 1];
        Fidx[t + 1] = Fidx[t + 2];
        Fidx[t + 2] = tmp;
      }
    }
    fidx = Fidx;
  } else {
    fpos = new Float32Array(gw * gh * 3);
    fuv = new Float32Array(gw * gh * 2);
    fidx = [];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        fpos[k * 3] = fx(i);
        fpos[k * 3 + 1] = fy(j);
        fpos[k * 3 + 2] = grid[k] * zScale;
        fuv[k * 2] = i / gW;
        fuv[k * 2 + 1] = 1 - j / gH;
      }
    }
    for (let j = 0; j < gH; j++) {
      for (let i = 0; i < gW; i++) {
        const a = j * gw + i;
        const b = a + 1;
        const c = a + gw;
        const d = c + 1;
        fidx.push(a, c, b, b, c, d);
      }
    }
  }

  if (!mask) {
    pushWall([-W / 2, H / 2, back], [W / 2, H / 2, back], [W / 2, -H / 2, back], [-W / 2, -H / 2, back], [0, 0, -1]);
    for (let i = 0; i < gW; i++) {
      pushWall(f0(i, 0), f0(i + 1, 0), b0(i + 1, 0), b0(i, 0), [0, 1, 0]);
    }
    for (let i = 0; i < gW; i++) {
      pushWall(f0(i + 1, gH), f0(i, gH), b0(i, gH), b0(i + 1, gH), [0, -1, 0]);
    }
    for (let j = 0; j < gH; j++) {
      pushWall(f0(0, j), f0(0, j + 1), b0(0, j + 1), b0(0, j), [-1, 0, 0]);
    }
    for (let j = 0; j < gH; j++) {
      pushWall(f0(gW, j), f0(gW, j + 1), b0(gW, j + 1), b0(gW, j), [1, 0, 0]);
    }
  }

  const front = new THREE.BufferGeometry();
  front.setAttribute("position", new THREE.BufferAttribute(fpos, 3));
  front.setAttribute("uv", new THREE.BufferAttribute(fuv, 2));
  front.setIndex(new THREE.BufferAttribute(new Uint32Array(fidx), 1));
  front.computeVertexNormals();
  front.computeBoundingSphere();

  const solid = new THREE.BufferGeometry();
  solid.setAttribute("position", new THREE.BufferAttribute(new Float32Array(wallPts), 3));
  solid.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(wallNor), 3));
  solid.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(wallUv), 2));
  solid.setIndex(new THREE.BufferAttribute(new Uint32Array(wallIdx), 1));
  if (volume) solid.computeVertexNormals();
  solid.computeBoundingSphere();

  const geometry = mergeGeometries([front, solid], true);
  const triangles = fidx.length / 3 + wallIdx.length / 3;
  front.dispose();
  solid.dispose();
  if (!geometry) throw new Error("Failed to build geometry");
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
  return { geometry, width: W, height: H, triangles, cutout: !!mask };
}
