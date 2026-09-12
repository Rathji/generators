/*
 * geo-ops.js — the mesh toolkit behind the export targets (src/targets.js).
 *
 * Everything here works on plain flat arrays (`positions` = xyz triplets, optional per-vertex
 * `normals`/`uvs`/`colors`, optional `indices`) rather than on THREE objects, because the same
 * code has to run on a freshly baked scene graph, on a repaired solid, on a decimated LOD and
 * on a generated base — and because STL/OBJ/PLY all want raw triangles in the end anyway.
 *
 * The operations, in the order the export pipeline uses them:
 *
 *   bakeGeometry(root)            scene graph -> one world-space soup (+ which textures it uses)
 *   indexed()                     weld a soup into an indexed mesh with smooth vertex normals
 *   repair()                      cap boundary loops so an open surface becomes a solid (volume.js)
 *   hollow()                      offset an inner shell inward -> a print-ready hollow solid
 *   addBase()                     drop a round/hex/square print base under the model
 *   vertexCluster()               fast, robust decimation (LODs + collision proxies)
 *   fitHeight()/ground()/center() real-world scaling and placement
 *   toBinarySTL()/toAsciiSTL()    hand-written STL writers (exact control over units + triangles)
 *   toOBJ()/toMTL()               text formats with UVs + a material library (Tabletop Simulator)
 */

import { THREE, ConvexGeometry } from "./three.js";
import { analyzeMesh, closeMesh } from "./volume.js";

/* --------------------------------------------------------------- scene baking */

/*
 * Walk `root`, skip invisible subtrees (the auto-armature parks hidden originals + a 1-vertex
 * bind proxy in the graph), and flatten every mesh into ONE world-space triangle soup. This is
 * the exact geometry an STL/OBJ/PLY export represents, minus the hierarchy, so all the target
 * processing can work on one array.
 *
 * Returns { positions, normals, uvs, colors, hasNormals, hasUvs, hasColors, textures, triangles }.
 * `textures` lists { slot, image } for every distinct material map, de-duped by image identity.
 */
export function bakeGeometry(root, opts = {}) {
  const includeInvisible = !!opts.includeInvisible;
  const positions = [];
  const normals = [];
  const uvs = [];
  const colors = [];
  const textures = [];
  const seenTex = new Set();
  let hasNormals = true;
  let hasUvs = true;
  let hasColors = true;
  let anyMaterialColor = false;

  root.updateMatrixWorld(true);

  const nm = new THREE.Matrix3();
  const v = new THREE.Vector3();

  function visit(node) {
    if (!node) return;
    if (!includeInvisible && node.visible === false) return;
    if (node.isMesh) {
      const geo = node.geometry;
      if (geo && geo.attributes && geo.attributes.position) {
        const nMat = nm.getNormalMatrix(node.matrixWorld);
        const pos = geo.attributes.position;
        const nor = geo.attributes.normal;
        const uv = geo.attributes.uv;
        const col = geo.attributes.color;
        const index = geo.index;
        const tri = index ? index.count / 3 : pos.count / 3;
        const material = Array.isArray(node.material) ? node.material[0] : node.material;
        const matColor = material && material.color ? material.color : null;
        if (matColor) anyMaterialColor = true;
        if (!nor) hasNormals = false;
        if (!uv) hasUvs = false;
        if (!col) hasColors = false;
        if (material && material.map && material.map.image && !seenTex.has(material.map.image)) {
          seenTex.add(material.map.image);
          textures.push({ slot: textures.length, image: material.map.image });
        }

        for (let t = 0; t < tri; t++) {
          for (let k = 0; k < 3; k++) {
            const i = index ? index.getX(t * 3 + k) : t * 3 + k;
            v.fromBufferAttribute(pos, i).applyMatrix4(node.matrixWorld);
            positions.push(v.x, v.y, v.z);
            if (nor) {
              v.fromBufferAttribute(nor, i).applyMatrix3(nMat).normalize();
              normals.push(v.x, v.y, v.z);
            } else {
              normals.push(0, 0, 0);
            }
            if (uv) uvs.push(uv.getX(i), uv.getY(i));
            else uvs.push(0, 0);
            if (col) colors.push(col.getX(i), col.getY(i), col.getZ(i));
            else if (matColor) colors.push(matColor.r, matColor.g, matColor.b);
            else colors.push(1, 1, 1);
          }
        }
      }
    }
    for (const child of node.children) visit(child);
  }

  visit(root);

  const out = {
    positions: new Float32Array(positions),
    normals: new Float32Array(normals),
    uvs: new Float32Array(uvs),
    colors: new Float32Array(colors),
    hasNormals,
    hasUvs,
    hasColors: hasColors || anyMaterialColor,
    textures,
    triangles: positions.length / 9,
  };
  if (!out.hasNormals) computeNormals(out);
  return out;
}

/* --------------------------------------------------------------- array helpers */

export function cloneSoup(s) {
  return {
    positions: s.positions.slice(),
    normals: s.normals.slice(),
    uvs: s.uvs.slice(),
    colors: s.colors.slice(),
    hasNormals: s.hasNormals,
    hasUvs: s.hasUvs,
    hasColors: s.hasColors,
    textures: s.textures || [],
    triangles: s.triangles != null ? s.triangles : s.positions.length / 9,
  };
}

export function triangleCount(s) {
  return s.indices ? s.indices.length / 3 : s.positions.length / 9;
}

/* Expand an indexed soup into a flat (non-indexed) one, so a merged piece can append triangles
   without re-indexing. Used by addBase, which combines a baked model with a generated base. */
export function expand(soup) {
  if (!soup.indices) return soup;
  const idx = soup.indices;
  const n = idx.length;
  const out = {
    positions: new Float32Array(n * 3),
    normals: new Float32Array(n * 3),
    uvs: new Float32Array(n * 2),
    colors: new Float32Array(n * 3),
    hasNormals: true,
    hasUvs: true,
    hasColors: true,
    textures: soup.textures || [],
    triangles: n / 3,
  };
  for (let i = 0; i < n; i++) {
    const v = idx[i];
    out.positions[i * 3] = soup.positions[v * 3];
    out.positions[i * 3 + 1] = soup.positions[v * 3 + 1];
    out.positions[i * 3 + 2] = soup.positions[v * 3 + 2];
    out.normals[i * 3] = soup.normals[v * 3] || 0;
    out.normals[i * 3 + 1] = soup.normals[v * 3 + 1] || 0;
    out.normals[i * 3 + 2] = soup.normals[v * 3 + 2] || 0;
    out.uvs[i * 2] = soup.uvs[v * 2] || 0;
    out.uvs[i * 2 + 1] = soup.uvs[v * 2 + 1] || 0;
    out.colors[i * 3] = soup.colors[v * 3] || 1;
    out.colors[i * 3 + 1] = soup.colors[v * 3 + 1] || 1;
    out.colors[i * 3 + 2] = soup.colors[v * 3 + 2] || 1;
  }
  return out;
}

export function bounds(positions) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  if (!positions.length) return { min: [0, 0, 0], max: [0, 0, 0], size: [0, 0, 0], center: [0, 0, 0] };
  return {
    min: [minX, minY, minZ],
    max: [maxX, maxY, maxZ],
    size: [maxX - minX, maxY - minY, maxZ - minZ],
    center: [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2],
  };
}

/* --------------------------------------------------------------- welding/indexing */

/*
 * Weld a triangle soup into an indexed mesh using a tight positional tolerance, producing one
 * shared vertex per (position, normal, uv) triple. Deduping by all three attributes keeps hard
 * edges and UV seams intact (an OBJ/GLB that merged across a UV seam would smear its texture),
 * while still collapsing the soup's 3 duplicates per corner.
 */
export function indexed(soup, opts = {}) {
  const positions = soup.positions;
  const normals = soup.normals;
  const uvs = soup.uvs;
  const colors = soup.colors;
  const b = bounds(positions);
  const maxDim = Math.max(b.size[0], b.size[1], b.size[2]) || 1;
  const tol = opts.tol || maxDim * 1e-5;
  const q = (x) => Math.round(x / tol);

  const map = new Map();
  const op = [];
  const on = [];
  const ou = [];
  const oc = [];
  const indices = new Uint32Array(positions.length / 3);
  for (let i = 0; i < positions.length / 3; i++) {
    const key =
      q(positions[i * 3]) + "_" + q(positions[i * 3 + 1]) + "_" + q(positions[i * 3 + 2]) + "|" +
      q(normals[i * 3] * 64) + "_" + q(normals[i * 3 + 1] * 64) + "_" + q(normals[i * 3 + 2] * 64) + "|" +
      q(uvs[i * 2] * 4096) + "_" + q(uvs[i * 2 + 1] * 4096);
    let idx = map.get(key);
    if (idx === undefined) {
      idx = op.length / 3;
      map.set(key, idx);
      op.push(positions[i * 3], positions[i * 3 + 1], positions[i * 3 + 2]);
      on.push(normals[i * 3], normals[i * 3 + 1], normals[i * 3 + 2]);
      ou.push(uvs[i * 2], uvs[i * 2 + 1]);
      oc.push(colors[i * 3], colors[i * 3 + 1], colors[i * 3 + 2]);
    }
    indices[i] = idx;
  }
  return {
    positions: new Float32Array(op),
    normals: new Float32Array(on),
    uvs: new Float32Array(ou),
    colors: new Float32Array(oc),
    indices,
    hasNormals: true,
    hasUvs: true,
    hasColors: true,
    textures: soup.textures || [],
  };
}

/* Smooth (area-weighted) vertex normals over an indexed mesh. */
export function computeNormals(soup) {
  const p = soup.positions;
  const idx = soup.indices;
  const n = new Float32Array(p.length);
  const count = idx ? idx.length / 3 : p.length / 9;
  const at = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);
  for (let t = 0; t < count; t++) {
    const a = at(t, 0), b = at(t, 1), c = at(t, 2);
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    // un-normalised cross product is already area-weighted
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const i of [a, b, c]) {
      n[i * 3] += nx;
      n[i * 3 + 1] += ny;
      n[i * 3 + 2] += nz;
    }
  }
  for (let i = 0; i < n.length / 3; i++) {
    const len = Math.hypot(n[i * 3], n[i * 3 + 1], n[i * 3 + 2]) || 1;
    n[i * 3] /= len;
    n[i * 3 + 1] /= len;
    n[i * 3 + 2] /= len;
  }
  soup.normals = n;
  soup.hasNormals = true;
  return n;
}

/* --------------------------------------------------------------- transforms */

export function transformSoup(soup, fn) {
  const p = soup.positions;
  for (let i = 0; i < p.length; i += 3) {
    const r = fn(p[i], p[i + 1], p[i + 2]);
    p[i] = r[0];
    p[i + 1] = r[1];
    p[i + 2] = r[2];
  }
  return soup;
}

export function scaleSoup(soup, s, sy) {
  const ky = sy == null ? s : sy;
  return transformSoup(soup, (x, y, z) => [x * s, y * ky, z * s]);
}

export function translateSoup(soup, dx, dy, dz) {
  return transformSoup(soup, (x, y, z) => [x + dx, y + dy, z + dz]);
}

/* Y-up (three.js / glTF / Unity) -> Z-up (Blender / Unreal). Rotating +90 degrees about X sends
   the up axis (0,1,0) to (0,0,1), which is exactly what a Z-up importer expects. */
export function yUpToZUp(soup) {
  return transformSoup(soup, (x, y, z) => [x, -z, y]);
}

/* Centre the model on the origin on every axis (Tabletop Simulator pivots a custom model at its
   origin, so a centred model drops onto the table the way you expect). */
export function centerOnOrigin(soup) {
  const b = bounds(soup.positions);
  return translateSoup(soup, -b.center[0], -b.center[1], -b.center[2]);
}

/* A THREE.BufferGeometry built from a soup — used to hand a processed mesh (an LOD, a collision
   hull, a hollowed solid) to the GLB exporter. */
export function toGeometry(soup) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(soup.positions, 3));
  if (soup.normals && soup.normals.length) g.setAttribute("normal", new THREE.BufferAttribute(soup.normals, 3));
  if (soup.uvs && soup.uvs.length) g.setAttribute("uv", new THREE.BufferAttribute(soup.uvs, 2));
  if (soup.colors && soup.colors.length) g.setAttribute("color", new THREE.BufferAttribute(soup.colors, 3));
  if (soup.indices) g.setIndex(new THREE.BufferAttribute(soup.indices, 1));
  return g;
}

export function toObject3D(soup, material) {
  return new THREE.Mesh(toGeometry(soup), material);
}

/* Uniformly scale so the model is `height` units tall, and put its feet at y = 0 with its
   footprint centred on the origin — the orientation every slicer and game engine expects. */
export function standOnOrigin(soup, opts = {}) {
  const b = bounds(soup.positions);
  const target = opts.height;
  if (target && b.size[1] > 0) {
    const s = target / b.size[1];
    transformSoup(soup, (x, y, z) => [x * s, y * s, z * s]);
  }
  const nb = bounds(soup.positions);
  translateSoup(soup, -nb.center[0], -nb.min[1], -nb.center[2]);
  return soup;
}

/* --------------------------------------------------------------- repair + hollow */

/* Cap every boundary loop so an open surface (an AI iso-surface cut at its box, a scan, a
   single-sided sheet) becomes a genuinely closed solid. Attributes are carried across by the
   original vertex order; `closeMesh` appends one centroid per loop. */
export function repair(soup) {
  const res = closeMesh({ positions: soup.positions, indices: soup.indices });
  if (!res || !res.cappedTriangles) return { soup, capped: 0 };
  const origCount = soup.positions.length / 3;
  const merged = cloneSoup(soup);
  merged.positions = res.positions;
  merged.normals = new Float32Array(res.positions.length);
  merged.uvs = new Float32Array((res.positions.length / 3) * 2);
  merged.colors = new Float32Array(res.positions.length);
  const orig = soup.positions.length / 3;
  if (soup.normals && soup.normals.length) merged.normals.set(soup.normals.subarray(0, orig * 3), 0);
  if (soup.uvs && soup.uvs.length) merged.uvs.set(soup.uvs.subarray(0, orig * 2), 0);
  if (soup.colors && soup.colors.length) merged.colors.set(soup.colors.subarray(0, orig * 3), 0);
  // average the loop's attributes into each new centroid vertex
  const loops = res.loops || [];
  for (let j = 0; j < loops.length; j++) {
    const ci = origCount + j;
    const verts = loops[j].verts;
    let nx = 0, ny = 0, nz = 0, u = 0, vv = 0, cr = 0, cg = 0, cb = 0;
    for (const vi of verts) {
      nx += merged.normals[vi * 3]; ny += merged.normals[vi * 3 + 1]; nz += merged.normals[vi * 3 + 2];
      u += merged.uvs[vi * 2]; vv += merged.uvs[vi * 2 + 1];
      cr += merged.colors[vi * 3]; cg += merged.colors[vi * 3 + 1]; cb += merged.colors[vi * 3 + 2];
    }
    const n = verts.length || 1;
    const len = Math.hypot(nx, ny, nz) || 1;
    merged.normals[ci * 3] = nx / len; merged.normals[ci * 3 + 1] = ny / len; merged.normals[ci * 3 + 2] = nz / len;
    merged.uvs[ci * 2] = u / n; merged.uvs[ci * 2 + 1] = vv / n;
    merged.colors[ci * 3] = cr / n; merged.colors[ci * 3 + 1] = cg / n; merged.colors[ci * 3 + 2] = cb / n;
  }
  merged.indices = res.indices;
  merged.triangles = res.indices.length / 3;
  computeNormals(merged);
  return { soup: merged, capped: res.cappedTriangles, boundaryEdges: res.boundaryEdges };
}

/*
 * Turn a closed solid into a hollow shell with a wall of `thickness`.
 *
 * This is the standard two-shell trick: the outer surface plus the same surface pushed inward
 * along its smooth vertex normals with its winding reversed. A slicer reads the inner surface
 * as a cavity, so the print comes out hollow with the requested wall — which is what saves
 * resin on a miniature and what makes a big display piece affordable. It requires a watertight
 * input (call `repair` first) and, like any offset, self-intersects on features thinner than
 * the wall; the panel warns about that and the thickness slider defaults conservatively.
 */
export function hollow(soup, thickness) {
  const solid = soup.indices ? soup : indexed(soup);
  const p = solid.positions;
  const idx = solid.indices;
  const outerCount = p.length / 3;

  /* The inner shell must be built on a *positionally welded* copy of the surface. `indexed()`
     deliberately keeps hard-edge/UV-seam vertices split (one per attribute triple), so offsetting
     each split copy along its own normal tears the shell open at every crease — which is every
     edge of a flat-shaded AI mesh. Welding first gives one continuous inward offset. The outer
     shell keeps the original attributes; only the (hidden) cavity uses the welded mesh. */
  const b = bounds(p);
  const maxDim = Math.max(b.size[0], b.size[1], b.size[2]) || 1;
  const tol = maxDim * 1e-5;
  const q = (x) => Math.round(x / tol);
  const map = new Map();
  const wpos = [];
  const wmap = new Uint32Array(outerCount);
  for (let i = 0; i < outerCount; i++) {
    const key = q(p[i * 3]) + "_" + q(p[i * 3 + 1]) + "_" + q(p[i * 3 + 2]);
    let w = map.get(key);
    if (w === undefined) {
      w = wpos.length / 3;
      map.set(key, w);
      wpos.push(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]);
    }
    wmap[i] = w;
  }
  const wCount = wpos.length / 3;
  const wn = new Float32Array(wpos.length);
  for (let t = 0; t < idx.length; t += 3) {
    const a = wmap[idx[t]], b2 = wmap[idx[t + 1]], c = wmap[idx[t + 2]];
    const ax = wpos[a * 3], ay = wpos[a * 3 + 1], az = wpos[a * 3 + 2];
    const e1x = wpos[b2 * 3] - ax, e1y = wpos[b2 * 3 + 1] - ay, e1z = wpos[b2 * 3 + 2] - az;
    const e2x = wpos[c * 3] - ax, e2y = wpos[c * 3 + 1] - ay, e2z = wpos[c * 3 + 2] - az;
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    for (const i of [a, b2, c]) {
      wn[i * 3] += nx; wn[i * 3 + 1] += ny; wn[i * 3 + 2] += nz;
    }
  }

  const inner = new Float32Array(wpos.length);
  for (let i = 0; i < wCount; i++) {
    const len = Math.hypot(wn[i * 3], wn[i * 3 + 1], wn[i * 3 + 2]) || 1;
    inner[i * 3] = wpos[i * 3] - (wn[i * 3] / len) * thickness;
    inner[i * 3 + 1] = wpos[i * 3 + 1] - (wn[i * 3 + 1] / len) * thickness;
    inner[i * 3 + 2] = wpos[i * 3 + 2] - (wn[i * 3 + 2] / len) * thickness;
  }

  const merged = new Float32Array(p.length + inner.length);
  merged.set(p, 0);
  merged.set(inner, p.length);

  const innerIdx = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = wmap[idx[t]], b2 = wmap[idx[t + 1]], c = wmap[idx[t + 2]];
    if (a === b2 || b2 === c || a === c) continue; // weld-degenerated triangle: skip
    innerIdx.push(a + outerCount, c + outerCount, b2 + outerCount); // reversed -> cavity
  }
  const tri = idx.length;
  const outIdx = new Uint32Array(tri + innerIdx.length);
  outIdx.set(idx, 0);
  outIdx.set(innerIdx, tri);

  const res = {
    positions: merged,
    normals: new Float32Array(merged.length),
    uvs: new Float32Array((merged.length / 3) * 2),
    colors: new Float32Array(merged.length).fill(1),
    indices: outIdx,
    hasNormals: true,
    hasUvs: true,
    hasColors: true,
    textures: solid.textures || [],
    triangles: outIdx.length / 3,
  };
  if (solid.uvs && solid.uvs.length === outerCount * 2) res.uvs.set(solid.uvs, 0);
  if (solid.colors && solid.colors.length === outerCount * 3) res.colors.set(solid.colors, 0);
  computeNormals(res);
  return res;
}

/* --------------------------------------------------------------- decimation */

/*
 * Vertex clustering: snap every vertex to a cell of a `grid`-resolution lattice over the model's
 * bounding box and rebuild the triangles on the averaged cell positions. It is not as pretty as
 * quadric edge collapse, but it is fast, needs no topology, never fails on a dirty mesh, and is
 * exactly what a collision proxy wants. Returns a new indexed soup.
 */
export function vertexCluster(soup, grid) {
  const indexedSoup = soup.indices ? soup : indexed(soup);
  const p = indexedSoup.positions;
  const idx = indexedSoup.indices;
  const b = bounds(p);
  const maxDim = Math.max(b.size[0], b.size[1], b.size[2]) || 1;
  const cell = Math.max(maxDim / Math.max(2, grid), 1e-9);
  const buckets = new Map();
  const vmap = new Uint32Array(p.length / 3);
  for (let i = 0; i < p.length / 3; i++) {
    const cx = Math.floor((p[i * 3] - b.min[0]) / cell);
    const cy = Math.floor((p[i * 3 + 1] - b.min[1]) / cell);
    const cz = Math.floor((p[i * 3 + 2] - b.min[2]) / cell);
    const key = cx + "_" + cy + "_" + cz;
    let acc = buckets.get(key);
    if (!acc) {
      acc = { n: 0, x: 0, y: 0, z: 0, uvx: 0, uvy: 0, r: 0, g: 0, bl: 0 };
      buckets.set(key, acc);
    }
    acc.n++;
    acc.x += p[i * 3]; acc.y += p[i * 3 + 1]; acc.z += p[i * 3 + 2];
    acc.uvx += indexedSoup.uvs[i * 2] || 0; acc.uvy += indexedSoup.uvs[i * 2 + 1] || 0;
    acc.r += indexedSoup.colors[i * 3] || 1; acc.g += indexedSoup.colors[i * 3 + 1] || 1; acc.bl += indexedSoup.colors[i * 3 + 2] || 1;
    vmap[i] = -1;
  }
  const keys = [...buckets.keys()];
  const keyIndex = new Map();
  keys.forEach((k, i) => keyIndex.set(k, i));
  const pos = new Float32Array(keys.length * 3);
  const uv = new Float32Array(keys.length * 2);
  const col = new Float32Array(keys.length * 3);
  keys.forEach((key, i) => {
    const a = buckets.get(key);
    pos[i * 3] = a.x / a.n; pos[i * 3 + 1] = a.y / a.n; pos[i * 3 + 2] = a.z / a.n;
    uv[i * 2] = a.uvx / a.n; uv[i * 2 + 1] = a.uvy / a.n;
    col[i * 3] = a.r / a.n; col[i * 3 + 1] = a.g / a.n; col[i * 3 + 2] = a.bl / a.n;
  });
  for (let i = 0; i < vmap.length; i++) {
    const cx = Math.floor((p[i * 3] - b.min[0]) / cell);
    const cy = Math.floor((p[i * 3 + 1] - b.min[1]) / cell);
    const cz = Math.floor((p[i * 3 + 2] - b.min[2]) / cell);
    vmap[i] = keyIndex.get(cx + "_" + cy + "_" + cz);
  }
  const out = [];
  for (let t = 0; t < idx.length; t += 3) {
    const a = vmap[idx[t]], bb = vmap[idx[t + 1]], c = vmap[idx[t + 2]];
    if (a === bb || bb === c || a === c) continue;
    out.push(a, bb, c);
  }
  const res = {
    positions: pos,
    normals: new Float32Array(pos.length),
    uvs: uv,
    colors: col,
    indices: new Uint32Array(out),
    hasNormals: true,
    hasUvs: true,
    hasColors: true,
    textures: indexedSoup.textures || [],
    triangles: out.length / 3,
  };
  computeNormals(res);
  return res;
}

/* Möller–Trumbore-free n-gon decimation is not needed here: for a target triangle budget we
   binary-search the cluster grid, which is monotonic in triangle count. */
export function decimateTo(soup, targetTriangles) {
  let lo = 4, hi = 400;
  let best = vertexCluster(soup, hi);
  if (triangleCount(best) <= targetTriangles) return best;
  for (let iter = 0; iter < 22; iter++) {
    const mid = Math.round((lo + hi) / 2);
    const c = vertexCluster(soup, mid);
    if (triangleCount(c) > targetTriangles) hi = mid;
    else {
      best = c;
      lo = mid;
    }
    if (hi - lo <= 1) break;
  }
  return best;
}

/*
 * A convex-hull collision proxy. Game engines want a cheap shape for physics, and a hull is the
 * usual answer for a prop or a character. QuickHull is roughly O(n log n) in the point count, so
 * the vertex list is stride-sampled down to a few thousand points first — hull accuracy at that
 * sampling is more than enough for collision, and it keeps the call interactive on a 100k-vert mesh.
 */
export function convexHull(soup, opts = {}) {
  const p = soup.positions;
  const total = p.length / 3;
  const target = Math.max(200, Math.min(opts.samples || 4000, total));
  const stride = Math.max(1, Math.floor(total / target));
  const pts = [];
  for (let i = 0; i < total; i += stride) pts.push(new THREE.Vector3(p[i * 3], p[i * 3 + 1], p[i * 3 + 2]));
  if (pts.length < 4) return indexed(soup);
  let geo;
  try {
    geo = new ConvexGeometry(pts);
  } catch (e) {
    return vertexCluster(soup, 12);
  }
  const g = geo.index ? geo.toNonIndexed() : geo;
  const arr = g.attributes.position.array;
  const out = {
    positions: new Float32Array(arr),
    normals: new Float32Array(arr.length),
    uvs: new Float32Array((arr.length / 3) * 2),
    colors: new Float32Array(arr.length).fill(0.85),
    hasNormals: true,
    hasUvs: true,
    hasColors: true,
    textures: [],
    triangles: arr.length / 9,
  };
  computeNormals(out);
  geo.dispose();
  g.dispose();
  return out;
}

/* --------------------------------------------------------------- bases */

const BASE_SEGMENTS = { round: 64, hex: 6, square: 4 };

/*
 * A print/tabletop base under the model. `atY` is the model's foot height: the base is placed
 * so its top face is flush with `atY` and it extends down to `atY - height`. A round base gets
 * 64 segments, a hex 6 and a square 4 — the same primitives a slicer would generate, but baked
 * into the model so the exported STL is already one piece.
 */
export function addBase(soup, opts = {}) {
  const shape = opts.shape || "round";
  const radius = Math.max(1e-6, opts.radius || 1);
  const height = Math.max(1e-6, opts.height || radius * 0.2);
  const atY = opts.atY != null ? opts.atY : bounds(soup.positions).min[1];
  const body = expand(soup);
  let geo;
  if (shape === "square") geo = new THREE.BoxGeometry(radius * 2, height, radius * 2, 1, 1, 1);
  else geo = new THREE.CylinderGeometry(radius, radius, height, BASE_SEGMENTS[shape] || 64, 1);
  const g = geo.index ? geo.toNonIndexed() : geo;
  const bp = g.attributes.position.array;
  const outPos = new Float32Array(bp.length + body.positions.length);
  outPos.set(bp, 0);
  outPos.set(body.positions, bp.length);
  // cylinder/box are centred on their own origin -> shift so the top sits at `atY`
  const dy = atY - height / 2;
  for (let i = 0; i < bp.length; i += 3) outPos[i + 1] += dy;
  geo.dispose();
  g.dispose();
  const out = {
    positions: outPos,
    normals: new Float32Array(outPos.length),
    uvs: new Float32Array((outPos.length / 3) * 2),
    colors: new Float32Array(outPos.length),
    hasNormals: true,
    hasUvs: true,
    hasColors: true,
    textures: soup.textures || [],
    triangles: outPos.length / 9,
  };
  const baseVerts = bp.length / 3;
  if (body.colors && body.colors.length) out.colors.set(body.colors, bp.length);
  for (let i = 0; i < baseVerts * 3; i++) out.colors[i] = 0.72;
  computeNormals(out);
  return out;
}

/* --------------------------------------------------------------- STL writers */

/*
 * Binary STL: 80-byte header, u32 triangle count, then 50 bytes per triangle (normal + 3
 * vertices, all float32LE). Written by hand rather than through three's STLExporter so the
 * output is exactly the processed array above — after scaling to millimetres, after repair,
 * after a base was merged in — with no scene-graph surprises.
 */
export function toBinarySTL(soup, opts = {}) {
  const p = soup.positions;
  const idx = soup.indices;
  const count = triangleCount(soup);
  const buf = new ArrayBuffer(84 + count * 50);
  const dv = new DataView(buf);
  const header = opts.header || "Exported from Perchance 3D Model Maker";
  for (let i = 0; i < Math.min(header.length, 79); i++) dv.setUint8(i, header.charCodeAt(i) & 0x7f);
  dv.setUint32(80, count, true);
  const at = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);
  let o = 84;
  for (let t = 0; t < count; t++) {
    const a = at(t, 0), b = at(t, 1), c = at(t, 2);
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    dv.setFloat32(o, nx, true); dv.setFloat32(o + 4, ny, true); dv.setFloat32(o + 8, nz, true);
    dv.setFloat32(o + 12, ax, true); dv.setFloat32(o + 16, ay, true); dv.setFloat32(o + 20, az, true);
    dv.setFloat32(o + 24, p[b * 3], true); dv.setFloat32(o + 28, p[b * 3 + 1], true); dv.setFloat32(o + 32, p[b * 3 + 2], true);
    dv.setFloat32(o + 36, p[c * 3], true); dv.setFloat32(o + 40, p[c * 3 + 1], true); dv.setFloat32(o + 44, p[c * 3 + 2], true);
    dv.setUint16(o + 48, 0, true);
    o += 50;
  }
  return buf;
}

export function toAsciiSTL(soup, name = "model") {
  const p = soup.positions;
  const idx = soup.indices;
  const count = triangleCount(soup);
  const at = (t, k) => (idx ? idx[t * 3 + k] : t * 3 + k);
  const lines = [`solid ${name}`];
  const f = (n) => (Math.round(n * 1e6) / 1e6).toString();
  for (let t = 0; t < count; t++) {
    const a = at(t, 0), b = at(t, 1), c = at(t, 2);
    const ax = p[a * 3], ay = p[a * 3 + 1], az = p[a * 3 + 2];
    const e1x = p[b * 3] - ax, e1y = p[b * 3 + 1] - ay, e1z = p[b * 3 + 2] - az;
    const e2x = p[c * 3] - ax, e2y = p[c * 3 + 1] - ay, e2z = p[c * 3 + 2] - az;
    let nx = e1y * e2z - e1z * e2y;
    let ny = e1z * e2x - e1x * e2z;
    let nz = e1x * e2y - e1y * e2x;
    const len = Math.hypot(nx, ny, nz) || 1;
    lines.push(`  facet normal ${f(nx / len)} ${f(ny / len)} ${f(nz / len)}`);
    lines.push("    outer loop");
    for (const i of [a, b, c]) lines.push(`      vertex ${f(p[i * 3])} ${f(p[i * 3 + 1])} ${f(p[i * 3 + 2])}`);
    lines.push("    endloop");
    lines.push("  endfacet");
  }
  lines.push(`endsolid ${name}`);
  return lines.join("\n");
}

/* --------------------------------------------------------------- OBJ / MTL writers */

/*
 * Text OBJ with optional UVs and a `mtllib`/`usemtl` reference, plus the matching .mtl. three's
 * OBJExporter drops materials, and Tabletop Simulator's custom-model importer wants exactly
 * this trio: model.obj + model.mtl + texture.png in one folder. Vertices are indexed so a
 * textured mesh does not blow up to 3x size.
 */
export function toOBJ(soup, opts = {}) {
  const s = soup.indices ? soup : indexed(soup);
  const p = s.positions;
  const out = [];
  out.push("# Exported from Perchance 3D Model Maker");
  out.push(`# ${p.length / 3} vertices, ${triangleCount(s)} triangles`);
  if (opts.mtl) out.push(`mtllib ${opts.mtl}`);
  const f = (n) => (Math.round(n * 1e6) / 1e6).toString();
  for (let i = 0; i < p.length / 3; i++) out.push(`v ${f(p[i * 3])} ${f(p[i * 3 + 1])} ${f(p[i * 3 + 2])}`);
  const useUv = opts.uvs !== false && s.hasUvs && s.uvs && s.uvs.length;
  if (useUv) for (let i = 0; i < s.uvs.length / 2; i++) out.push(`vt ${f(s.uvs[i * 2])} ${f(s.uvs[i * 2 + 1])}`);
  const useN = opts.normals !== false && s.normals && s.normals.length === p.length;
  if (useN) for (let i = 0; i < p.length / 3; i++) out.push(`vn ${f(s.normals[i * 3])} ${f(s.normals[i * 3 + 1])} ${f(s.normals[i * 3 + 2])}`);
  if (opts.material) out.push(`usemtl ${opts.material}`);
  const idx = s.indices;
  for (let t = 0; t < idx.length; t += 3) {
    const verts = [];
    for (let k = 0; k < 3; k++) {
      const i = idx[t + k] + 1;
      let token = String(i);
      if (useUv || useN) token += "/" + (useUv ? String(i) : "") + (useN ? "/" + String(i) : "");
      verts.push(token);
    }
    out.push(`f ${verts.join(" ")}`);
  }
  return out.join("\n") + "\n";
}

export function toMTL(opts = {}) {
  const c = opts.color || [0.8, 0.8, 0.8];
  const lines = [
    "# Exported from Perchance 3D Model Maker",
    `newmtl ${opts.name || "model"}`,
    `Kd ${c[0].toFixed(4)} ${c[1].toFixed(4)} ${c[2].toFixed(4)}`,
    "Ka 0.0000 0.0000 0.0000",
    `Ks ${(opts.specular != null ? opts.specular : 0.15).toFixed(4)} ${(opts.specular != null ? opts.specular : 0.15).toFixed(4)} ${(opts.specular != null ? opts.specular : 0.15).toFixed(4)}`,
    `Ns ${Math.round(opts.shininess != null ? opts.shininess : 32)}`,
    "d 1.0000",
    "illum 2",
  ];
  if (opts.texture) lines.push(`map_Kd ${opts.texture}`);
  return lines.join("\n") + "\n";
}

/* --------------------------------------------------------------- report formatting */

/* A compact, honest printability readout using the volume.js analysis. */
export function printReport(soup) {
  const r = analyzeMesh({ positions: soup.positions, indices: soup.indices });
  return r;
}

export function fmt(n, d = 2) {
  if (!Number.isFinite(n)) return "—";
  return n.toFixed(d);
}
