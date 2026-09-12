/*
 * volume-build.js — build a *real* solid volume mesh from a depth map.
 *
 * The fast relief builder (relief.js) makes a surface with a flat or mirrored back and
 * adds side walls; that is fine to look at but its interior is not always a well-defined
 * solid (walls can leave T-junctions, and a mirrored back meets the front at the rim in
 * near-coincident points that never get welded). This module builds a genuinely closed
 * solid instead, so the result has a measurable, origin-independent volume.
 *
 * Two topologies, both watertight by construction:
 *
 *   Cut-out subject (alpha mask) — the front and back sheets are extracted from the SAME
 *   marching-squares polygon of the silhouette, and the crossing points (which lie exactly
 *   on the rim) are given z = 0 on both sheets. So the front rim edge and the back rim edge
 *   are the identical segment and every edge is shared by exactly two triangles: no walls
 *   are needed at all.
 *
 *   Full frame (no mask) — a rectangle cannot close without sides, so the front sheet, the
 *   back sheet and four subdivided side walls are emitted. Subdividing the walls per grid
 *   segment (rather than one quad per side) means the wall's inner edge matches the back
 *   sheet's border edge exactly, so the shell is again edge-complete.
 *
 * The back surface is shaped by `backMode`:
 *   "mirror"  front mirrored about z = 0 — an organic, symmetric solid (good for figures)
 *   "flat"    a slab of constant thickness (tapered to 0 at a cut-out rim)
 *   "dome"    thickness falls off towards the rim — a rounded, pillowy back
 */

import { THREE, mergeGeometries } from "./three.js";
import { prepareReliefGrid, reliefCellPolys, bilinear, smoothstep } from "./relief.js";
import { analyzeMesh } from "./volume.js";

export const BACK_MODES = [
  { id: "mirror", label: "Mirror front", hint: "Symmetric front/back — a solid blob that reads as real volume." },
  { id: "flat", label: "Flat slab", hint: "Constant thickness behind the subject — like a thick coin." },
  { id: "dome", label: "Dome", hint: "Thickness tapers to the rim — a rounded, pillowy back." },
];

function domeShape(t) {
  // 0 at the rim, 1 in the deep interior, with a rounded profile
  const c = t < 0 ? 0 : t > 1 ? 1 : t;
  return Math.sqrt(Math.max(0, c * (2 - c)));
}

function indexedGeometry(pos, uv, idx, withNormals) {
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pos), 3));
  if (uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv), 2));
  g.setIndex(new THREE.BufferAttribute(new Uint32Array(idx), 1));
  if (withNormals) g.computeVertexNormals();
  g.computeBoundingSphere();
  return g;
}

/* Signed volume / area / watertightness of the finished shell (see volume.js). */
function measure(geometry) {
  try {
    const pos = geometry.getAttribute("position").array;
    const idx = geometry.index ? geometry.index.array : null;
    const indexArr = idx ? (idx instanceof Uint32Array ? idx : Uint32Array.from(idx)) : null;
    return analyzeMesh({ positions: pos, indices: indexArr });
  } catch (e) {
    console.warn("solid measure failed", e);
    return null;
  }
}

export function buildSolidGeometry(opts = {}) {
  const { size = 2, thickness = 0.06, backMode = "mirror" } = opts;
  const P = prepareReliefGrid({ ...opts, size });
  const { grid, mask, maskField, dist, bevel, gw, gh, gW, gH, W, H, zScale } = P;

  const thicknessWorld = Math.max(0, thickness) * size;
  const mode = backMode;

  // ---- back height field (world units, <= 0) -------------------------------
  const backGrid = new Float32Array(gw * gh);
  for (let k = 0; k < backGrid.length; k++) {
    if (mask) {
      const tap = smoothstep((dist[k] / bevel) || 0);
      if (mode === "mirror") backGrid[k] = -grid[k] * zScale;
      else if (mode === "dome") backGrid[k] = -thicknessWorld * domeShape(tap);
      else backGrid[k] = -thicknessWorld * tap;
    } else {
      const i = k % gw;
      const j = (k / gw) | 0;
      const bx = Math.min(i / gW, 1 - i / gW);
      const by = Math.min(j / gH, 1 - j / gH);
      const bt = Math.min(1, Math.min(bx, by) * 2);
      if (mode === "mirror") backGrid[k] = -grid[k] * zScale;
      else if (mode === "dome") backGrid[k] = -thicknessWorld * domeShape(bt);
      else backGrid[k] = -thicknessWorld;
    }
  }

  /* A back vertex that lands exactly on the front sheet (both z = 0) would weld into a
     pinch point and leave edges shared by four triangles — non-manifold, and a place where
     "inside" is ambiguous. Keeping the back strictly behind the front by a hair removes
     every such coincidence while changing the volume negligibly. */
  const minBack = Math.max(size * 0.002, thicknessWorld * 0.01);
  for (let k = 0; k < backGrid.length; k++) if (backGrid[k] > -minBack) backGrid[k] = -minBack;

  const fx = (i) => (i / gW - 0.5) * W;
  const fy = (j) => (0.5 - j / gH) * H;

  let frontGeo;
  let backGeo;

  if (mask) {
    /* ---- masked: shared rim, no walls ---- */
    const F = maskField;
    const xAt = (u) => (u - 0.5) * W;
    const yAt = (v) => (0.5 - v) * H;
    const zAt = (u, v) => bilinear(grid, gw, gh, u, v) * zScale;
    const bzAt = (u, v) => bilinear(backGrid, gw, gh, u, v);
    const sampleF = (x, y) => bilinear(F, gw, gh, x / W + 0.5, 0.5 - y / H);
    const centerInside = (i, j) => sampleF(xAt((i + 0.5) / gW), yAt((j + 0.5) / gH)) >= 0.5;

    const fMap = new Map();
    const bMap = new Map();
    const fPos = [], fUv = [], fIdx = [];
    const bPos = [], bUv = [], bIdx = [];
    const keyUV = (u, v) => Math.round(u * 1e6) + ":" + Math.round(v * 1e6);
    /* A silhouette that runs off the edge of the frame is genuinely open, so the border
       itself becomes part of the rim: any polygon point lying on the grid border is given
       z = 0 on BOTH sheets, exactly like a marching-squares crossing point. The front and
       back then meet along the frame edge and the cut is closed with a knife edge. */
    const onRim = (p) => p.cross || p.u <= 0 || p.u >= 1 || p.v <= 0 || p.v >= 1;

    const fid = (p) => {
      const key = keyUV(p.u, p.v);
      let id = fMap.get(key);
      if (id === undefined) {
        id = fPos.length / 3;
        fMap.set(key, id);
        fPos.push(xAt(p.u), yAt(p.v), onRim(p) ? 0 : zAt(p.u, p.v));
        fUv.push(p.u, 1 - p.v);
      }
      return id;
    };
    const bid = (p) => {
      const key = keyUV(p.u, p.v);
      let id = bMap.get(key);
      if (id === undefined) {
        id = bPos.length / 3;
        bMap.set(key, id);
        bPos.push(xAt(p.u), yAt(p.v), onRim(p) ? 0 : bzAt(p.u, p.v));
        bUv.push(p.u, 1 - p.v);
      }
      return id;
    };

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
          const fids = poly.map(fid);
          for (let t = 1; t < fids.length - 1; t++) fIdx.push(fids[0], fids[t], fids[t + 1]);
          const bids = poly.map(bid);
          for (let t = 1; t < bids.length - 1; t++) bIdx.push(bids[0], bids[t + 1], bids[t]); // reversed -> -z
        }
      }
    }
    if (!fIdx.length || !bIdx.length) throw new Error("Could not build a solid from this silhouette");
    frontGeo = indexedGeometry(fPos, fUv, fIdx, true);
    backGeo = indexedGeometry(bPos, bUv, bIdx, true);
  } else {
    /* ---- full frame: front + back sheets + subdivided walls ---- */
    const fPos = [], fUv = [], fIdx = [];
    const bPos = [], bUv = [], bIdx = [];
    for (let j = 0; j < gh; j++) {
      for (let i = 0; i < gw; i++) {
        const k = j * gw + i;
        fPos.push(fx(i), fy(j), grid[k] * zScale);
        fUv.push(i / gW, 1 - j / gH);
        bPos.push(fx(i), fy(j), backGrid[k]);
        bUv.push(i / gW, 1 - j / gH);
      }
    }
    for (let j = 0; j < gH; j++) {
      for (let i = 0; i < gW; i++) {
        const a = j * gw + i;
        const b = a + 1;
        const c = a + gw;
        const d = c + 1;
        fIdx.push(a, c, b, b, c, d);
        bIdx.push(a, b, c, b, d, c);
      }
    }
    frontGeo = indexedGeometry(fPos, fUv, fIdx, true);
    const backSheet = indexedGeometry(bPos, bUv, bIdx, true);

    // walls, emitted with their own vertices + explicit outward normals
    const wPos = [], wNor = [], wUv = [], wIdx = [];
    const pushQuad = (p0, p1, p2, p3, outward) => {
      const e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
      const e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
      const n = [
        e1[1] * e2[2] - e1[2] * e2[1],
        e1[2] * e2[0] - e1[0] * e2[2],
        e1[0] * e2[1] - e1[1] * e2[0],
      ];
      const dot = n[0] * outward[0] + n[1] * outward[1] + n[2] * outward[2];
      let pts = [p0, p1, p2, p3];
      if (dot < 0) pts = [p0, p3, p2, p1];
      const len = Math.hypot(n[0], n[1], n[2]) || 1;
      const base = wPos.length / 3;
      const uvs = [[0, 0], [1, 0], [1, 1], [0, 1]];
      for (let s = 0; s < 4; s++) {
        wPos.push(pts[s][0], pts[s][1], pts[s][2]);
        wNor.push(n[0] / len, n[1] / len, n[2] / len);
        wUv.push(uvs[s][0], uvs[s][1]);
      }
      wIdx.push(base, base + 1, base + 2, base, base + 2, base + 3);
    };
    const fpt = (i, j) => [fx(i), fy(j), grid[j * gw + i] * zScale];
    const bpt = (i, j) => [fx(i), fy(j), backGrid[j * gw + i]];
    for (let i = 0; i < gW; i++) {
      pushQuad(fpt(i, 0), fpt(i + 1, 0), bpt(i + 1, 0), bpt(i, 0), [0, 1, 0]);
      pushQuad(fpt(i + 1, gH), fpt(i, gH), bpt(i, gH), bpt(i + 1, gH), [0, -1, 0]);
    }
    for (let j = 0; j < gH; j++) {
      pushQuad(fpt(0, j), fpt(0, j + 1), bpt(0, j + 1), bpt(0, j), [-1, 0, 0]);
      pushQuad(fpt(gW, j), fpt(gW, j + 1), bpt(gW, j + 1), bpt(gW, j), [1, 0, 0]);
    }
    const walls = new THREE.BufferGeometry();
    walls.setAttribute("position", new THREE.BufferAttribute(new Float32Array(wPos), 3));
    walls.setAttribute("normal", new THREE.BufferAttribute(new Float32Array(wNor), 3));
    walls.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(wUv), 2));
    walls.setIndex(new THREE.BufferAttribute(new Uint32Array(wIdx), 1));
    backGeo = mergeGeometries([backSheet, walls], false);
    backSheet.dispose();
    walls.dispose();
    if (!backGeo) throw new Error("Failed to build the solid's back");
  }

  const geometry = mergeGeometries([frontGeo, backGeo], true);
  const triangles = (frontGeo.index.count + backGeo.index.count) / 3;
  frontGeo.dispose();
  backGeo.dispose();
  if (!geometry) throw new Error("Failed to build the solid volume");
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();

  return {
    geometry,
    width: W,
    height: H,
    triangles,
    cutout: !!mask,
    backMode: mode,
    watertightByConstruction: true,
    metrics: measure(geometry),
  };
}
