/*
 * volume.js — real 3D volume estimation for arbitrary triangle meshes.
 *
 * This module is deliberately dependency-free pure math (no three.js, no DOM), so the
 * main thread AND the AI worker can both import it. Given any triangle soup it returns
 * the physically meaningful quantities of the solid the mesh bounds:
 *
 *   volume        signed-tetrahedron integral (divergence theorem) — in mesh units³
 *   surfaceArea   summed triangle areas
 *   bbox / dims   axis-aligned box + principal extents (√eigenvalues of the covariance)
 *   centroid      1st moment / volume
 *   inertia       mass moment of inertia about the centroid (unit density)
 *   watertight    every edge shared by exactly two triangles, none flipped, one shell
 *
 * A mesh only *has* a well-defined interior volume when it is watertight — an open sheet
 * makes the tetrahedron sum depend on where the origin is. So `watertight` and `closed`
 * are reported next to the number rather than hidden, and `analyzeMesh` welds coincident
 * vertices first (the volume builders emit the front and back rim as separate vertices
 * at the same position, which is geometrically closed but not index-closed).
 *
 * With a real-world scale (calibrate()) every unit becomes a physical quantity: m, m²,
 * m³ and, for a chosen material density, kg.
 */

/* Reference densities (kg/m³) offered in the UI. Bodies are treated as mostly water. */
export const DENSITIES = [
  { id: "generic", label: "Generic solid", kgm3: 1000 },
  { id: "water", label: "Water", kgm3: 997 },
  { id: "body", label: "Human body", kgm3: 985 },
  { id: "wood", label: "Wood (pine)", kgm3: 600 },
  { id: "plastic", label: "Plastic (PLA)", kgm3: 1240 },
  { id: "glass", label: "Glass", kgm3: 2500 },
  { id: "concrete", label: "Concrete", kgm3: 2400 },
  { id: "steel", label: "Steel", kgm3: 7850 },
  { id: "gold", label: "Gold", kgm3: 19300 },
];

/* -------------------------------------------------------------- linear algebra */

/* Jacobi eigenvalue iteration for a symmetric 3x3 matrix stored as
   [xx, yy, zz, xy, xz, yz]. Returns ascending eigenvalues. */
function eigenSymmetric3(m) {
  const a = [
    [m[0], m[3], m[4]],
    [m[3], m[1], m[5]],
    [m[4], m[5], m[2]],
  ];
  for (let sweep = 0; sweep < 12; sweep++) {
    let off = Math.abs(a[0][1]) + Math.abs(a[0][2]) + Math.abs(a[1][2]);
    if (off < 1e-12) break;
    for (let p = 0; p < 2; p++) {
      for (let q = p + 1; q < 3; q++) {
        const apq = a[p][q];
        if (Math.abs(apq) < 1e-18) continue;
        const theta = (a[q][q] - a[p][p]) / (2 * apq);
        const t = Math.sign(theta || 1) / (Math.abs(theta) + Math.sqrt(theta * theta + 1));
        const c = 1 / Math.sqrt(t * t + 1);
        const s = t * c;
        for (let k = 0; k < 3; k++) {
          const akp = a[k][p];
          const akq = a[k][q];
          a[k][p] = c * akp - s * akq;
          a[k][q] = s * akp + c * akq;
        }
        for (let k = 0; k < 3; k++) {
          const apk = a[p][k];
          const aqk = a[q][k];
          a[p][k] = c * apk - s * aqk;
          a[q][k] = s * apk + c * aqk;
        }
      }
    }
  }
  return [a[0][0], a[1][1], a[2][2]].sort((x, y) => x - y);
}

/* ------------------------------------------------------------------ welding */

/* Map every vertex onto a canonical id, merging vertices closer than `tol`. A spatial
   hash keyed on tol-sized cells makes this O(n); the 27-cell neighbourhood test keeps it
   correct when two near-identical points straddle a cell boundary. */
function weld(positions, count, tol) {
  const inv = 1 / tol;
  const cells = new Map();
  const remap = new Int32Array(count).fill(-1);
  const wx = [];
  const wy = [];
  const wz = [];
  for (let v = 0; v < count; v++) {
    const x = positions[v * 3];
    const y = positions[v * 3 + 1];
    const z = positions[v * 3 + 2];
    const cx = Math.floor(x * inv);
    const cy = Math.floor(y * inv);
    const cz = Math.floor(z * inv);
    let found = -1;
    for (let dx = -1; dx <= 1 && found < 0; dx++) {
      for (let dy = -1; dy <= 1 && found < 0; dy++) {
        for (let dz = -1; dz <= 1 && found < 0; dz++) {
          const bucket = cells.get(((cx + dx) + 73856093) ^ ((cy + dy) * 19349663) ^ ((cz + dz) * 83492791));
          if (!bucket) continue;
          for (const id of bucket) {
            if (Math.abs(wx[id] - x) <= tol && Math.abs(wy[id] - y) <= tol && Math.abs(wz[id] - z) <= tol) {
              found = id;
              break;
            }
          }
        }
      }
    }
    if (found < 0) {
      found = wx.length;
      wx.push(x);
      wy.push(y);
      wz.push(z);
      const key = (cx + 73856093) ^ (cy * 19349663) ^ (cz * 83492791);
      let bucket = cells.get(key);
      if (!bucket) {
        bucket = [];
        cells.set(key, bucket);
      }
      bucket.push(found);
    }
    remap[v] = found;
  }
  return { remap, count: wx.length, wx, wy, wz };
}

/* --------------------------------------------------------------- analysis */

/*
 * analyzeMesh({ positions, indices }) -> report | null
 * `positions` is a flat xyz array (Float32Array or plain array); `indices` is optional —
 * when absent the positions are read as consecutive triangles.
 */
export function analyzeMesh({ positions, indices } = {}) {
  if (!positions || positions.length < 9) return null;
  const vcount = Math.floor(positions.length / 3);
  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(vcount / 3);
  if (triCount < 1) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < vcount; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const size = [maxX - minX, maxY - minY, maxZ - minZ];
  const center = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const maxDim = Math.max(size[0], size[1], size[2]) || 1;
  /* Coincident-by-construction vertices (the two sheets' shared rim, marching-tetrahedra
     seams, duplicated wall corners) are exactly equal, so the weld tolerance can be very
     tight — tight enough never to merge two points that are genuinely distinct. */
  const tol = maxDim * 5e-6;

  const { remap, count: welded } = weld(positions, vcount, tol);

  const ax = new Float64Array(triCount);
  const ay = new Float64Array(triCount);
  const az = new Float64Array(triCount);
  const bx = new Float64Array(triCount);
  const by = new Float64Array(triCount);
  const bz = new Float64Array(triCount);
  const cx = new Float64Array(triCount);
  const cy = new Float64Array(triCount);
  const cz = new Float64Array(triCount);
  const wa = new Int32Array(triCount);
  const wb = new Int32Array(triCount);
  const wc = new Int32Array(triCount);

  const edgeMap = new Map();
  /* union-find over welded vertices to count connected shells */
  const parent = new Int32Array(welded);
  for (let i = 0; i < welded; i++) parent[i] = i;
  const find = (i) => {
    while (parent[i] !== i) {
      parent[i] = parent[parent[i]];
      i = parent[i];
    }
    return i;
  };
  const union = (a, b) => {
    const ra = find(a), rb = find(b);
    if (ra !== rb) parent[ra] = rb;
  };
  const linkEdge = (a, b) => {
    const da = remap[a], db = remap[b];
    const key = da < db ? da + "_" + db : db + "_" + da;
    const e = edgeMap.get(key);
    if (e) {
      e.count++;
      if (e.dir === (da < db)) e.flipped++;
    } else {
      edgeMap.set(key, { count: 1, flipped: 0, dir: da < db });
    }
  };

  // Pass 0: geometry accumulation (translate to bbox centre for a stable integral).
  for (let t = 0; t < triCount; t++) {
    const i0 = indices ? indices[t * 3] : t * 3;
    const i1 = indices ? indices[t * 3 + 1] : t * 3 + 1;
    const i2 = indices ? indices[t * 3 + 2] : t * 3 + 2;
    ax[t] = positions[i0 * 3] - center[0];
    ay[t] = positions[i0 * 3 + 1] - center[1];
    az[t] = positions[i0 * 3 + 2] - center[2];
    bx[t] = positions[i1 * 3] - center[0];
    by[t] = positions[i1 * 3 + 1] - center[1];
    bz[t] = positions[i1 * 3 + 2] - center[2];
    cx[t] = positions[i2 * 3] - center[0];
    cy[t] = positions[i2 * 3 + 1] - center[1];
    cz[t] = positions[i2 * 3 + 2] - center[2];
    wa[t] = remap[i0];
    wb[t] = remap[i1];
    wc[t] = remap[i2];
  }

  let area = 0;
  let vol6 = 0; // 6 * signed volume
  let cxSum = 0, cySum = 0, czSum = 0;
  // covariance (second moment of volume) about the bbox centre — symmetric 6-tuple
  let cxx = 0, cyy = 0, czz = 0, cxy = 0, cxz = 0, cyz = 0;

  for (let t = 0; t < triCount; t++) {
    const e1x = bx[t] - ax[t], e1y = by[t] - ay[t], e1z = bz[t] - az[t];
    const e2x = cx[t] - ax[t], e2y = cy[t] - ay[t], e2z = cz[t] - az[t];
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    area += 0.5 * Math.hypot(nx, ny, nz);

    const a = [ax[t], ay[t], az[t]];
    const b = [bx[t], by[t], bz[t]];
    const c = [cx[t], cy[t], cz[t]];
    const d6 =
      a[0] * (b[1] * c[2] - b[2] * c[1]) -
      a[1] * (b[0] * c[2] - b[2] * c[0]) +
      a[2] * (b[0] * c[1] - b[1] * c[0]);
    vol6 += d6;
    const v = d6 / 6;
    // centroid of tetra (0, a, b, c)
    cxSum += v * (a[0] + b[0] + c[0]) / 4;
    cySum += v * (a[1] + b[1] + c[1]) / 4;
    czSum += v * (a[2] + b[2] + c[2]) / 4;
    // ∫ x_i x_j dV over the tetra = V/20 (Σ r_k,i r_k,j + (Σ r_k,i)(Σ r_k,j))
    const sx = a[0] + b[0] + c[0];
    const sy = a[1] + b[1] + c[1];
    const sz = a[2] + b[2] + c[2];
    const f = v / 20;
    cxx += f * (a[0] * a[0] + b[0] * b[0] + c[0] * c[0] + sx * sx);
    cyy += f * (a[1] * a[1] + b[1] * b[1] + c[1] * c[1] + sy * sy);
    czz += f * (a[2] * a[2] + b[2] * b[2] + c[2] * c[2] + sz * sz);
    cxy += f * (a[0] * a[1] + b[0] * b[1] + c[0] * c[1] + sx * sy);
    cxz += f * (a[0] * a[2] + b[0] * b[2] + c[0] * c[2] + sx * sz);
    cyz += f * (a[1] * a[2] + b[1] * b[2] + c[1] * c[2] + sy * sz);
  }

  for (let t = 0; t < triCount; t++) {
    linkEdge(indices ? indices[t * 3] : t * 3, indices ? indices[t * 3 + 1] : t * 3 + 1);
    linkEdge(indices ? indices[t * 3 + 1] : t * 3 + 1, indices ? indices[t * 3 + 2] : t * 3 + 2);
    linkEdge(indices ? indices[t * 3 + 2] : t * 3 + 2, indices ? indices[t * 3] : t * 3);
    union(wa[t], wb[t]);
    union(wb[t], wc[t]);
  }

  let boundary = 0;
  let nonManifold = 0;
  let flipped = 0;
  for (const e of edgeMap.values()) {
    if (e.count === 1) boundary++;
    else if (e.count > 2) nonManifold++;
    else if (e.flipped === 2) flipped++; // both directed edges the same way
  }
  const roots = new Set();
  for (let i = 0; i < welded; i++) roots.add(find(i));

  const signedVolume = vol6 / 6;
  const volume = Math.abs(signedVolume);
  const watertight = boundary === 0 && nonManifold === 0 && flipped === 0;
  const closed = watertight && roots.size === 1;

  const centroid = volume > 1e-12
    ? [cxSum / signedVolume + center[0], cySum / signedVolume + center[1], czSum / signedVolume + center[2]]
    : [center[0], center[1], center[2]];

  // inertia about the centroid: I = trace(C')·Identity − C',  C' = C − V·ccᵀ
  let principal = null;
  if (volume > 1e-12) {
    const ox = centroid[0] - center[0];
    const oy = centroid[1] - center[1];
    const oz = centroid[2] - center[2];
    const mxx = cxx - volume * ox * ox;
    const myy = cyy - volume * oy * oy;
    const mzz = czz - volume * oz * oz;
    const mxy = cxy - volume * ox * oy;
    const mxz = cxz - volume * ox * oz;
    const myz = cyz - volume * oy * oz;
    const tr = mxx + myy + mzz;
    const inertia = [tr - mxx, tr - myy, tr - mzz, -mxy, -mxz, -myz];
    principal = eigenSymmetric3(inertia).filter((x) => x >= 0);
  }

  const bboxVolume = size[0] * size[1] * size[2] || 1;
  return {
    vertices: welded,
    rawVertices: vcount,
    triangles: triCount,
    edges: edgeMap.size,
    bbox: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], size, center },
    dims: size.slice(),
    surfaceArea: area,
    signedVolume,
    volume,
    oriented: signedVolume > 0,
    centroid,
    inertia: principal,
    principalExtents: principal ? principal.map((m) => Math.sqrt(Math.max(0, m / (volume || 1)))) : null,
    watertight,
    closed,
    boundaryEdges: boundary,
    nonManifoldEdges: nonManifold,
    flippedEdges: flipped,
    shells: roots.size,
    euler: welded - edgeMap.size + triCount,
    fillRatio: volume / bboxVolume,
    generatedAt: Date.now(),
  };
}

/* ------------------------------------------------------------------ closing */

/*
 * closeMesh({ positions, indices }) ->
 *   { positions, indices, loops, cappedTriangles, boundaryEdges, vertices } | null
 *
 * Turn an OPEN surface into a watertight solid by capping every boundary loop. A mesh only
 * *has* a well-defined interior volume when it is closed (see the header note), and the
 * meshes that most need measuring — a TripoSR iso-surface cut at its sampling box, a photo
 * scan, a single-sided sheet, a Blender plane — arrive open. This is the honest fix: it
 * finds the free edges, chains them into loops, drops one centroid vertex per loop and fan
 * caps the loop onto it, with the fan wound opposite the boundary so the patch's normal
 * matches the surface's outward orientation.
 *
 * Original vertices are preserved in order (so a caller can carry vertex colours, UVs, … over
 * by index); every loop appends exactly one new vertex. `loops[i].verts` lists the *original*
 * vertex indices of that loop, so the caller can average their attributes into the centroid.
 */
export function closeMesh({ positions, indices } = {}) {
  if (!positions || positions.length < 9) return null;
  const vcount = Math.floor(positions.length / 3);
  const triCount = indices ? Math.floor(indices.length / 3) : Math.floor(vcount / 3);
  if (triCount < 1) return null;

  let minX = Infinity, minY = Infinity, minZ = Infinity, maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let v = 0; v < vcount; v++) {
    const x = positions[v * 3], y = positions[v * 3 + 1], z = positions[v * 3 + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ) || 1;
  const { remap, count: welded, wx, wy, wz } = weld(positions, vcount, maxDim * 5e-6);

  const idxAt = (t, k) => (indices ? indices[t * 3 + k] : t * 3 + k);
  const directed = new Set();
  const undirected = new Map();
  for (let t = 0; t < triCount; t++) {
    const i0 = remap[idxAt(t, 0)], i1 = remap[idxAt(t, 1)], i2 = remap[idxAt(t, 2)];
    const tri = [i0, i1, i2];
    for (let k = 0; k < 3; k++) {
      const a = tri[k], b = tri[(k + 1) % 3];
      directed.add(a + "_" + b);
      const u = a < b ? a + "_" + b : b + "_" + a;
      undirected.set(u, (undirected.get(u) || 0) + 1);
    }
  }

  /* A free (boundary) directed edge is one whose reverse is absent. Edges shared by more than
     two faces are non-manifold seams — capping those would be guesswork, so they are left. */
  const bcand = [];
  const out = new Map();
  for (const key of directed) {
    const i = key.indexOf("_");
    const a = +key.slice(0, i), b = +key.slice(i + 1);
    if (directed.has(b + "_" + a)) continue;
    const u = a < b ? a + "_" + b : b + "_" + a;
    if ((undirected.get(u) || 0) > 2) continue;
    bcand.push(key);
    let arr = out.get(a);
    if (!arr) {
      arr = [];
      out.set(a, arr);
    }
    arr.push(b);
  }
  const boundaryEdges = bcand.length;

  const used = new Set();
  const loops = [];
  for (const start of bcand) {
    if (used.has(start)) continue;
    const verts = [];
    let key = start;
    let guard = 0;
    while (key && !used.has(key) && guard++ <= bcand.length + 2) {
      used.add(key);
      const i = key.indexOf("_");
      const u = +key.slice(0, i), v = +key.slice(i + 1);
      verts.push(u);
      let next = null;
      const cands = out.get(v);
      if (cands) {
        for (const w of cands) {
          const k = v + "_" + w;
          if (!used.has(k)) {
            next = k;
            break;
          }
        }
      }
      key = next;
    }
    if (verts.length >= 3) loops.push(verts);
  }

  const rep = new Int32Array(welded).fill(-1);
  for (let v = 0; v < vcount; v++) {
    const w = remap[v];
    if (rep[w] < 0) rep[w] = v;
  }

  const newPos = new Float32Array((vcount + loops.length) * 3);
  for (let i = 0; i < vcount * 3; i++) newPos[i] = positions[i];
  const outIdx = [];
  for (let i = 0; i < triCount * 3; i++) outIdx.push(indices ? indices[i] : i);

  const loopInfo = [];
  for (let j = 0; j < loops.length; j++) {
    const verts = loops[j];
    const n = verts.length;
    let sx = 0, sy = 0, sz = 0;
    for (const w of verts) {
      sx += wx[w];
      sy += wy[w];
      sz += wz[w];
    }
    const ci = vcount + j;
    newPos[ci * 3] = sx / n;
    newPos[ci * 3 + 1] = sy / n;
    newPos[ci * 3 + 2] = sz / n;
    for (let k = 0; k < n; k++) {
      const u = verts[k], v = verts[(k + 1) % n];
      outIdx.push(rep[v], rep[u], ci);
    }
    loopInfo.push({ centroid: ci, verts: verts.map((w) => rep[w]) });
  }

  return {
    positions: newPos,
    indices: new Uint32Array(outIdx),
    loops: loopInfo,
    cappedTriangles: outIdx.length / 3 - triCount,
    boundaryEdges,
    vertices: vcount + loops.length,
  };
}

/* --------------------------------------------------------------- calibration */

/*
 * Turn a mesh-space report into physical units. `realHeight` is the real-world size of the
 * model along `axis` (a chosen dimension, default the tallest) expressed in metres; every
 * other dimension, the area and the volume follow from the single isotropic scale.
 */
export function calibrate(report, { realHeight, axis = "y", density = 1000 } = {}) {
  if (!report) return null;
  const dims = report.dims || report.bbox.size;
  const axisIndex = axis === "x" ? 0 : axis === "z" ? 2 : 1;
  const span = dims[axisIndex] || Math.max(dims[0], dims[1], dims[2]) || 1;
  const scale = realHeight > 0 ? realHeight / span : 1;
  const volume = report.volume * scale ** 3;
  return {
    scale,
    axis,
    height: realHeight,
    dims: dims.map((d) => d * scale),
    volume,
    surfaceArea: report.surfaceArea * scale ** 2,
    mass: volume * (density || 0),
    density: density || 0,
  };
}

/* ------------------------------------------------------------- AI density grid */

/*
 * Volume of an occupancy field straight off the neural network, before any surface is
 * extracted — a cross-check on the mesh volume (they should agree to within one voxel
 * layer). `spacing` is the world distance between neighbouring samples.
 */
export function integrateDensityVolume(density, resolution, threshold, spacing) {
  const R = resolution;
  const t = threshold == null ? 0 : threshold;
  let occupied = 0;
  let soft = 0;
  for (let i = 0; i < density.length; i++) {
    const d = density[i];
    if (d >= t) occupied++;
    soft += Math.min(1, Math.max(0, d));
  }
  const cell = (spacing || 1) ** 3;
  return {
    samples: density.length,
    resolution: R,
    occupied,
    occupancy: density.length ? occupied / density.length : 0,
    volume: occupied * cell,
    softVolume: soft * cell,
  };
}

/* Mirror an occupancy grid along X (i axis of an i·R² + j·R + k layout). Multi-view AI
   reconstruction averages the density of the original and the horizontally-flipped view,
   and the flipped view's grid has to be mirrored back into canonical space first. */
export function flipDensityX(density, resolution) {
  const R = resolution;
  const R2 = R * R;
  const out = new Float32Array(density.length);
  for (let i = 0; i < R; i++) {
    const src = i * R2;
    const dst = (R - 1 - i) * R2;
    for (let j = 0; j < R2; j++) out[dst + j] = density[src + j];
  }
  return out;
}

/* Fuse several occupancy grids (already in canonical space) into one by averaging.
   `views` is an array of Float32Array of equal length. */
export function fuseDensity(views) {
  if (!views || !views.length) return null;
  if (views.length === 1) return views[0];
  const n = views[0].length;
  const out = new Float32Array(n);
  for (const v of views) {
    if (!v || v.length !== n) continue;
    for (let i = 0; i < n; i++) out[i] += v[i];
  }
  const inv = 1 / views.length;
  for (let i = 0; i < n; i++) out[i] *= inv;
  return out;
}

/* Rotate a canonical occupancy grid by a multiple of 90° about the vertical (Y) axis, so
   a reconstruction from a profile view can be turned to face the same way as the front
   view before fusion. `quarterTurns` is applied clockwise seen from +Y. */
export function rotateDensityY(density, resolution, quarterTurns) {
  let q = ((quarterTurns % 4) + 4) % 4;
  if (!q) return density;
  const R = resolution;
  let src = density;
  for (let step = 0; step < q; step++) {
    const out = new Float32Array(src.length);
    for (let x = 0; x < R; x++) {
      for (let y = 0; y < R; y++) {
        for (let z = 0; z < R; z++) {
          // (x, y, z) <- (z, y, R-1-x): +90° about Y
          out[x * R * R + y * R + z] = src[z * R * R + y * R + (R - 1 - x)];
        }
      }
    }
    src = out;
  }
  return src;
}

/* ----------------------------------------------------------------- formatting */

export function formatLength(meters) {
  if (!Number.isFinite(meters)) return "—";
  const a = Math.abs(meters);
  if (a < 0.01) return (meters * 1000).toFixed(a < 0.001 ? 2 : 1) + " mm";
  if (a < 1) return (meters * 100).toFixed(a < 0.1 ? 1 : 0) + " cm";
  return meters.toFixed(a < 10 ? 3 : 2) + " m";
}

export function formatArea(m2) {
  if (!Number.isFinite(m2)) return "—";
  const a = Math.abs(m2);
  if (a < 0.01) return (m2 * 1e4).toFixed(1) + " cm²";
  return m2.toFixed(a < 1 ? 4 : 3) + " m²";
}

export function formatVolume(m3) {
  if (!Number.isFinite(m3)) return "—";
  const a = Math.abs(m3);
  if (a < 1e-6) return (m3 * 1e9).toFixed(1) + " mm³";
  if (a < 1e-3) return (m3 * 1e6).toFixed(a < 1e-4 ? 2 : 1) + " cm³";
  if (a < 1) return (m3 * 1000).toFixed(a < 0.01 ? 3 : 2) + " L";
  return m3.toFixed(a < 10 ? 3 : 2) + " m³";
}

export function formatMass(kg) {
  if (!Number.isFinite(kg)) return "—";
  const a = Math.abs(kg);
  if (a < 0.001) return (kg * 1e6).toFixed(1) + " mg";
  if (a < 1) return (kg * 1000).toFixed(a < 0.01 ? 2 : 1) + " g";
  if (a < 1000) return kg.toFixed(a < 10 ? 3 : 2) + " kg";
  return (kg / 1000).toFixed(2) + " t";
}
