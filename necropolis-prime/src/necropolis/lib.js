import * as THREE from "https://esm.sh/three@0.160.0";
import { makeRng } from "./rng.js";

// =====================================================================
//  Geometry factory — every primitive has its origin at its BASE center
//  (except the sphere), so placing something at ground level is `y = 0`.
// =====================================================================
export function buildGeometries(){
  const g = {};

  const box = new THREE.BoxGeometry(1, 1, 1);
  box.translate(0, 0.5, 0);
  g.box = box;

  const slab = new THREE.BoxGeometry(1, 1, 1);
  slab.translate(0, 0.5, 0);
  g.slab = slab;

  for (const seg of [4, 5, 6, 8, 12]){
    g["cyl" + seg] = new THREE.CylinderGeometry(1, 1, 1, seg, 1);
    g["cyl" + seg].translate(0, 0.5, 0);
    g["cone" + seg] = new THREE.ConeGeometry(1, 1, seg, 1);
    g["cone" + seg].translate(0, 0.5, 0);
    g["frustum" + seg] = new THREE.CylinderGeometry(0.55, 1, 1, seg, 1);
    g["frustum" + seg].translate(0, 0.5, 0);
  }

  g.sphere = new THREE.SphereGeometry(1, 16, 12);
  g.ico = new THREE.IcosahedronGeometry(1, 1);

  // four-sided pyramid, base 1x1 at y=0, apex at y=1
  {
    const v = [
      -0.5, 0, -0.5,  0.5, 0, -0.5,  0.5, 0, 0.5,  -0.5, 0, 0.5,
      0, 1, 0,
    ];
    const idx = [0, 1, 4, 1, 2, 4, 2, 3, 4, 3, 0, 4, 0, 2, 1, 0, 3, 2];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.pyramid = geo;
  }

  // ridge roof: base 1(x) x 1(z) at y=0, ridge along X at y=1
  {
    const v = [
      -0.5, 0, -0.5,  0.5, 0, -0.5,  0.5, 0, 0.5,  -0.5, 0, 0.5,
      -0.5, 1, 0,  0.5, 1, 0,
    ];
    const idx = [
      0, 1, 5, 0, 5, 4,  3, 4, 5, 3, 5, 2,  0, 4, 3,  1, 2, 5,  0, 3, 2, 0, 2, 1,
    ];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.roof = geo;
  }

  // stair / wedge: right triangle profile, depth 1
  {
    const v = [
      -0.5, 0, -0.5,  0.5, 0, -0.5,  0.5, 0, 0.5,  -0.5, 0, 0.5,
      -0.5, 1, 0.5,  0.5, 1, 0.5,
    ];
    const idx = [0, 1, 5, 0, 5, 4, 3, 4, 5, 3, 5, 2, 0, 4, 3, 1, 2, 5, 0, 3, 2, 0, 2, 1];
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(v, 3));
    geo.setIndex(idx);
    geo.computeVertexNormals();
    g.wedge = geo;
  }

  return g;
}

// =====================================================================
//  Per-instance batching: accumulate (geometry, material, transform, tint)
//  then emit one InstancedMesh per combo — a whole city in a few draw calls.
// =====================================================================
export class Batcher {
  constructor(geometries, materials){
    this.geos = geometries;
    this.mats = materials;
    this.groups = new Map();
  }
  add(geoKey, matKey, m4, color){
    const key = geoKey + "|" + matKey;
    let g = this.groups.get(key);
    if (!g){ g = { geoKey, matKey, mats: [], cols: [] }; this.groups.set(key, g); }
    g.mats.push(m4);
    g.cols.push(color || null);
  }
  build(parent, opts = {}){
    const meshes = [];
    const tmp = new THREE.Color();
    for (const g of this.groups.values()){
      const geo = this.geos[g.geoKey];
      const mat = this.mats[g.matKey];
      if (!geo || !mat) continue;
      const n = g.mats.length;
      const mesh = new THREE.InstancedMesh(geo, mat, n);
      let anyColor = false;
      for (let i = 0; i < n; i++){
        mesh.setMatrixAt(i, g.mats[i]);
        if (g.cols[i]) anyColor = true;
      }
      if (anyColor){
        for (let i = 0; i < n; i++){
          tmp.set(g.cols[i] || 0xffffff);
          mesh.setColorAt(i, tmp);
        }
        mesh.instanceColor.needsUpdate = true;
      }
      mesh.instanceMatrix.needsUpdate = true;
      mesh.castShadow = opts.castShadow !== false;
      mesh.receiveShadow = opts.receiveShadow !== false;
      mesh.frustumCulled = false;
      parent.add(mesh);
      meshes.push(mesh);
    }
    return meshes;
  }
}

const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _s = new THREE.Vector3();
const _e = new THREE.Euler();

export function composeMatrix(x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0){
  _p.set(x, y, z);
  _s.set(sx, sy, sz);
  _e.set(rx, ry, rz, "YXZ");
  _q.setFromEuler(_e);
  return new THREE.Matrix4().compose(_p, _q, _s);
}

// convenient capsule-ish "place a part at height with rotation about base"
export function part(x, y, z, sx, sy, sz, ry = 0, rx = 0, rz = 0){
  return composeMatrix(x, y, z, sx, sy, sz, ry, rx, rz);
}

// =====================================================================
//  Procedural tiling textures (no external assets)
// =====================================================================
function latticeNoise(seed){
  const rng = makeRng(seed);
  const P = 64;
  const grid = new Float32Array(P * P);
  for (let i = 0; i < P * P; i++) grid[i] = rng.next();
  const smooth = (t) => t * t * (3 - 2 * t);
  const sample = (x, y) => {
    const xi = Math.floor(x), yi = Math.floor(y);
    const xf = x - xi, yf = y - yi;
    const x0 = ((xi % P) + P) % P, x1 = (x0 + 1) % P;
    const y0 = ((yi % P) + P) % P, y1 = (y0 + 1) % P;
    const a = grid[y0 * P + x0], b = grid[y0 * P + x1];
    const c = grid[y1 * P + x0], d = grid[y1 * P + x1];
    const u = smooth(xf), v = smooth(yf);
    return (a * (1 - u) + b * u) * (1 - v) + (c * (1 - u) + d * u) * v;
  };
  return { sample, P };
}

export function makeNoiseTexture(size = 256, seed = "n", opts = {}){
  const bases = [3, 6, 12, 24, 48];
  const noises = bases.map((b, i) => ({ b, n: latticeNoise(seed + "-" + i), amp: 1 / Math.pow(2, i * 0.85) }));
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const tint = opts.tint || [1, 1, 1];
  const contrast = opts.contrast || 1;
  const grain = opts.grain || 0.06;
  const rng = makeRng(seed + "-grain");
  for (let y = 0; y < size; y++){
    for (let x = 0; x < size; x++){
      let v = 0, amp = 0;
      for (const { b, n, amp: a } of noises){
        v += n.sample((x / size) * b, (y / size) * b) * a;
        amp += a;
      }
      v = v / amp;
      v = 0.5 + (v - 0.5) * contrast;
      const range = opts.range || [0, 1];
      v = range[0] + v * (range[1] - range[0]);
      v += (rng.next() - 0.5) * grain;
      v = Math.max(0, Math.min(1, v));
      const i = (y * size + x) * 4;
      img.data[i] = v * 255 * tint[0];
      img.data[i + 1] = v * 255 * tint[1];
      img.data[i + 2] = v * 255 * tint[2];
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export function makeBumpTexture(size = 256, seed = "b", freq = 30){
  const n = latticeNoise(seed);
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const rng = makeRng(seed + "-g");
  for (let y = 0; y < size; y++){
    for (let x = 0; x < size; x++){
      const v = n.sample((x / size) * freq, (y / size) * freq) * 0.7 + rng.next() * 0.3;
      const i = (y * size + x) * 4;
      const c = v * 255;
      img.data[i] = img.data[i + 1] = img.data[i + 2] = c;
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  return tex;
}

// A tiling cobblestone/flagstone texture: jittered Voronoi cells with darker
// mortar joints between them, wrapped toroidally so it tiles seamlessly.
export function makeCobbleTexture(size = 512, seed = "cob", opts = {}){
  const rng = makeRng(seed);
  const G = opts.cells || 8;                 // cells per side
  const cw = size / G;
  const joint = opts.joint != null ? opts.joint : 0.16;  // joint darkness width
  const contrast = opts.contrast != null ? opts.contrast : 1;
  const grime = opts.grime != null ? opts.grime : 0.12;
  const tint = opts.tint || [1, 0.985, 0.95];

  const sx = new Float32Array(G * G), sy = new Float32Array(G * G);
  const bright = new Float32Array(G * G);
  const jitter = opts.jitter != null ? opts.jitter : 0.42;
  for (let gy = 0; gy < G; gy++){
    for (let gx = 0; gx < G; gx++){
      const i = gy * G + gx;
      sx[i] = (gx + 0.5 + (rng.next() - 0.5) * jitter) * cw;
      sy[i] = (gy + 0.5 + (rng.next() - 0.5) * jitter) * cw;
      bright[i] = 0.62 + rng.next() * 0.55;
    }
  }

  const grain = latticeNoise(seed + "-grain");
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const img = ctx.createImageData(size, size);
  const half = size / 2;

  for (let y = 0; y < size; y++){
    for (let x = 0; x < size; x++){
      // Nearest/second-nearest over the 5x5 wrapped neighbourhood of cells.
      // The true Voronoi neighbours always live within two cells (jitter is
      // < 1 cell), so this is visually identical but O(size^2 * 25) rather
      // than O(size^2 * G^2).
      const gx0 = Math.floor(x / cw), gy0 = Math.floor(y / cw);
      let d1 = 1e9, d2 = 1e9, bi = 0;
      for (let oy = -2; oy <= 2; oy++){
        const gy = ((gy0 + oy) % G + G) % G;
        for (let ox = -2; ox <= 2; ox++){
          const gxi = ((gx0 + ox) % G + G) % G;
          const i = gy * G + gxi;
          let dx = x - sx[i]; if (dx > half) dx -= size; else if (dx < -half) dx += size;
          let dy = y - sy[i]; if (dy > half) dy -= size; else if (dy < -half) dy += size;
          const d2v = dx * dx + dy * dy;
          if (d2v < d1){ d2 = d1; d1 = d2v; bi = i; }
          else if (d2v < d2){ d2 = d2v; }
        }
      }
      const edge = Math.sqrt(d2) - Math.sqrt(d1);   // distance to the 2nd-nearest cell boundary
      let jf = edge / (joint * cw);
      jf = jf < 0 ? 0 : (jf > 1 ? 1 : jf);
      jf = jf * jf * (3 - 2 * jf);                  // smoothstep
      let v = (0.30 + 0.70 * jf);                   // dark at the joint, bright in the stone
      let stone = bright[bi];
      stone = 1 + (stone - 1) * contrast;
      v *= stone;
      v += (grain.sample((x / size) * 26, (y / size) * 26) - 0.5) * grime;
      v = v < 0 ? 0 : (v > 1 ? 1 : v);
      const o = (y * size + x) * 4;
      img.data[o] = v * 255 * tint[0];
      img.data[o + 1] = v * 255 * tint[1];
      img.data[o + 2] = v * 255 * tint[2];
      img.data[o + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.anisotropy = 4;
  return tex;
}

export function makeGlowTexture(size = 128, inner = "#dffcf0", outer = "rgba(0,0,0,0)"){  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grd = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grd.addColorStop(0, inner);
  grd.addColorStop(0.18, inner);
  grd.addColorStop(0.5, "rgba(143,230,200,0.35)");
  grd.addColorStop(1, outer);
  ctx.fillStyle = grd;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(canvas);
  return tex;
}

export { THREE };
