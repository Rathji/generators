import * as THREE from "https://esm.sh/three@0.160.0";
import { Batcher, part } from "./lib.js";

// =====================================================================
//  Districts — a ward is a pie-slice of the city, themed by how its
//  dead died. Theme drives palette, density, grandeur and the mix of
//  structures the ward is built from.
// =====================================================================
export const THEMES = [
  {
    key: "kings", tint: 0xa79a7c, accent: 0xc9a86a, light: 0xffd98a, fill: 0.5, cell: 13, grand: 1.0,
    mix: [["mausoleum", 6], ["obelisk", 3], ["statue", 2], ["sarcophagus", 2], ["crypt", 2]],
  },
  {
    key: "ossuary", tint: 0xd6cdb6, accent: 0xb8ae94, light: 0xd8f0e0, fill: 0.62, cell: 10, grand: 0.6,
    mix: [["tower", 4], ["mausoleum", 3], ["crypt", 3], ["tombRow", 5], ["grave", 4], ["brazier", 2]],
  },
  {
    key: "drowned", tint: 0x7c8c92, accent: 0x5f7d84, light: 0x8fd8e0, fill: 0.42, cell: 12, grand: 0.7,
    mix: [["crypt", 4], ["statue", 4], ["sarcophagus", 3], ["obelisk", 2], ["tree", 3]],
  },
  {
    key: "furnace", tint: 0x7a6a60, accent: 0xff7a2a, light: 0xff8a3a, fill: 0.5, cell: 11, grand: 0.5,
    mix: [["ruin", 5], ["crypt", 3], ["tower", 2], ["sarcophagus", 2], ["brazier", 5]],
  },
  {
    key: "gardens", tint: 0x8c9078, accent: 0xa8b090, light: 0xd8f0c0, fill: 0.34, cell: 11, grand: 0.45,
    mix: [["tree", 6], ["tombRow", 4], ["grave", 6], ["statue", 2], ["crypt", 2], ["lanternPost", 2]],
  },
  {
    key: "choir", tint: 0x9aa0b4, accent: 0xd8e4ff, light: 0xcfe0ff, fill: 0.45, cell: 12, grand: 0.9,
    mix: [["tower", 7], ["mausoleum", 3], ["obelisk", 3], ["lanternPost", 3]],
  },
  {
    key: "silence", tint: 0x6f747a, accent: 0x9aa0a8, light: 0xbfe8d8, fill: 0.24, cell: 15, grand: 0.8,
    mix: [["monolith", 5], ["mausoleum", 3], ["obelisk", 2], ["statue", 2]],
  },
  {
    key: "sorrow", tint: 0x8a8fa0, accent: 0x8fe6c8, light: 0x8fe6c8, fill: 0.48, cell: 10, grand: 0.55,
    mix: [["statue", 6], ["tombRow", 5], ["grave", 6], ["crypt", 3], ["sarcophagus", 3], ["brazier", 2]],
  },
  {
    key: "vaults", tint: 0x7d7b74, accent: 0xa79a7c, light: 0xffcf8a, fill: 0.55, cell: 9, grand: 0.5,
    mix: [["crypt", 5], ["sarcophagus", 4], ["mausoleum", 3], ["ossuaryStack", 3], ["brazier", 2]],
  },
  {
    key: "lantern", tint: 0x9a9a86, accent: 0x8fe6c8, light: 0x8fe6c8, fill: 0.4, cell: 10, grand: 0.5,
    mix: [["tombRow", 4], ["grave", 5], ["lanternPost", 6], ["statue", 2], ["crypt", 2], ["tree", 2]],
  },
  {
    key: "colonnade", tint: 0xb4aa96, accent: 0xc9a86a, light: 0xffd98a, fill: 0.42, cell: 12, grand: 0.85,
    mix: [["mausoleum", 5], ["colonnade", 5], ["obelisk", 2], ["statue", 3]],
  },
  {
    key: "ruins", tint: 0x74706a, accent: 0x8fe6c8, light: 0xbfe8d8, fill: 0.4, cell: 12, grand: 0.4,
    mix: [["ruin", 6], ["monolith", 3], ["tree", 3], ["grave", 4], ["brazier", 2]],
  },
];

const ROAD_W = 6;
const AVENUE_W = 7;
const GATE_ANGLE = -Math.PI / 2;

function vary(hex, rng, amt = 0.14){
  const c = new THREE.Color(hex);
  const f = 1 + (rng.next() * 2 - 1) * amt;
  // widen the palette: each instance drifts warm or cool
  const drift = (rng.next() * 2 - 1) * amt * 0.5;
  c.r = Math.min(1, Math.max(0, c.r * f * (1 + drift)));
  c.g = Math.min(1, Math.max(0, c.g * f));
  c.b = Math.min(1, Math.max(0, c.b * f * (1 - drift)));
  return c.getHex();
}

function polar(r, a){ return [Math.cos(a) * r, Math.sin(a) * r]; }

export function generateCity({ rng, geos, mats, config, titles, onProgress = () => {} }){
  const WALL_R = config.cityRadius || 250;
  const group = new THREE.Group();
  const B = new Batcher(geos, mats);
  const footprints = [];
  const grounds = [];
  const lanterns = [];
  const shrines = [];
  const spirits = [];
  const wards = [];
  const readables = [];
  let instances = 0;

  const addFoot = (x, z, w, d, yaw) => {
    footprints.push({ x, z, hw: w / 2, hd: d / 2, c: Math.cos(yaw), s: Math.sin(yaw) });
  };
  const addGround = (x, z, w, d, yaw, h, r = 0) => {
    grounds.push({ x, z, hw: w / 2, hd: d / 2, c: Math.cos(yaw), s: Math.sin(yaw), h, r });
  };
  const addLantern = (x, y, z, color, power = 1, radius = 9) => {
    lanterns.push({ x, y, z, color, power, radius });
  };

  const place = (env, geoKey, matKey, lx, ly, lz, sx, sy, sz, lry = 0, color = null, rx = 0, rz = 0) => {
    const c = Math.cos(env.yaw), s = Math.sin(env.yaw);
    const wx = env.x + lx * c + lz * s;
    const wz = env.z - lx * s + lz * c;
    env.B.add(geoKey, matKey, part(wx, env.oy + ly, wz, sx, sy, sz, env.yaw + lry, rx, rz), color);
    instances++;
  };

  const worldOf = (env, lx, ly, lz) => {
    const c = Math.cos(env.yaw), s = Math.sin(env.yaw);
    return { x: env.x + lx * c + lz * s, y: env.oy + ly, z: env.z - lx * s + lz * c };
  };

  // a gilded plaque on a structure that can be read in-world
  const addReadable = (env, lx, ly, lz, w = 1.4, h = 0.5) => {
    place(env, "box", "relief", lx, ly, lz, w, h, 0.12, 0, null);
    const p = worldOf(env, lx, ly, lz);
    readables.push({ x: p.x, y: p.y, z: p.z, ward: env.ward });
  };

  // ==================================================================
  //  GROUND + ROADS
  // ==================================================================
  const groundGeo = new THREE.CircleGeometry(WALL_R + 140, 64);
  groundGeo.rotateX(-Math.PI / 2);
  const ground = new THREE.Mesh(groundGeo, mats.ground);
  ground.receiveShadow = true;
  ground.position.y = -0.02;
  group.add(ground);

  const ringRadii = [24, 62, 102, 150, 206, 250];
  const avenueCount = config.avenueCount;
  const roadGeo = new THREE.RingGeometry(0, 1, 40, 1);
  roadGeo.rotateX(-Math.PI / 2);

  // paving that keeps a consistent world-space tile size on every road mesh
  const PAVE_TILE = 11;
  const _baseRoadMap = mats.road.map;
  const _baseRoadBump = mats.road.bumpMap;
  // Road meshes share one material per (rounded) tile repeat, so identical
  // avenues reuse a single material/texture pair instead of cloning a new
  // pair (with its own GPU upload) for every strip.
  const roadMatCache = new Map();
  function roadMaterial(worldW, worldH){
    const rx = Math.max(1, worldW / PAVE_TILE);
    const rz = Math.max(1, worldH / PAVE_TILE);
    const key = rx.toFixed(2) + "x" + rz.toFixed(2);
    let mat = roadMatCache.get(key);
    if (mat) return mat;
    mat = mats.road.clone();
    if (_baseRoadMap){
      const t = _baseRoadMap.clone(); t.needsUpdate = true;
      t.repeat.set(rx, rz);
      mat.map = t;
    }
    if (_baseRoadBump){
      const b = _baseRoadBump.clone(); b.needsUpdate = true;
      b.repeat.set(rx, rz);
      mat.bumpMap = b;
    }
    roadMatCache.set(key, mat);
    return mat;
  }

  const RING_W = 7;
  for (let i = 1; i < ringRadii.length - 1; i++){
    const r = ringRadii[i];
    const rr = new THREE.RingGeometry(r - RING_W / 2, r + RING_W / 2, 128, 1);
    rr.rotateX(-Math.PI / 2);
    const ring = new THREE.Mesh(rr, roadMaterial((r + RING_W) * 2, (r + RING_W) * 2));
    ring.position.y = 0.02;
    group.add(ring);
  }

  for (let j = 0; j < avenueCount; j++){
    const a = (j / avenueCount) * Math.PI * 2;
    const len = WALL_R - 20;
    const g = new THREE.PlaneGeometry(AVENUE_W, len);
    g.rotateX(-Math.PI / 2);
    const strip = new THREE.Mesh(g, roadMaterial(AVENUE_W, len));
    const [mx, mz] = polar(20 + len / 2, a);
    strip.position.set(mx, 0.021, mz);
    strip.rotation.y = Math.PI / 2 - a;
    group.add(strip);
  }

  const plazaGeo = new THREE.CircleGeometry(24, 48);
  plazaGeo.rotateX(-Math.PI / 2);
  const plaza = new THREE.Mesh(plazaGeo, roadMaterial(48, 48));
  plaza.position.y = 0.03;
  group.add(plaza);

  onProgress(0.12);

  // ==================================================================
  //  WARD LAYOUT — assign a theme + name to each pie slice
  // ==================================================================
  const themeOrder = rng.shuffle(THEMES.slice());
  const namePool = titles && titles.length ? rng.shuffle(titles.slice()) : [];
  for (let w = 0; w < avenueCount; w++){
    const theme = themeOrder[w % themeOrder.length];
    wards.push({
      index: w,
      a0: (w / avenueCount) * Math.PI * 2,
      a1: ((w + 1) / avenueCount) * Math.PI * 2,
      theme,
      name: namePool[w % Math.max(1, namePool.length)] || theme.key,
    });
  }

  // ==================================================================
  //  STRUCTURE BUILDERS
  // ==================================================================
  const builders = {};

  // ---- shared facade ornament --------------------------------------
  const cornice = (env, y, w, d, t = 0.35) => {
    place(env, "box", "stone", 0, y, 0, w + t * 2, t, d + t * 2, 0, env.stone(1.08));
  };
  const cornerPilasters = (env, w, d, h, base) => {
    const pw = 0.42;
    for (const sx of [-1, 1]) for (const sz of [-1, 1]){
      place(env, "box", "stone", sx * (w / 2 - pw / 2 + 0.02), base, sz * (d / 2 - pw / 2 + 0.02), pw, h, pw, 0, env.stone(1.05));
    }
  };
  const facadeNiches = (env, w, d, h, base, rows, cols) => {
    const usable = w * 0.7;
    for (let r = 0; r < rows; r++){
      const y = base + h * (0.26 + 0.42 * (r / Math.max(1, rows - 1)));
      for (let c = 0; c < cols; c++){
        const x = -usable / 2 + (c + 0.5) * (usable / cols);
        for (const sz of [1, -1]){
          place(env, "box", "void", x, y, sz * (d / 2 + 0.02), 0.68, 1.1, 0.16, 0, 0x05070a);
          place(env, "box", "stone", x, y + 1.1, sz * (d / 2 + 0.1), 0.92, 0.16, 0.26, 0, env.stone(1.06));
        }
      }
    }
  };
  const crenellate = (env, y, w, d, count) => {
    const step = w / count;
    for (let i = 0; i < count; i++){
      const x = -w / 2 + (i + 0.5) * step;
      place(env, "box", "stone", x, y, d / 2 - 0.3, step * 0.55, 0.85, 0.6, 0, env.stone(1.02));
      place(env, "box", "stone", x, y, -d / 2 + 0.3, step * 0.55, 0.85, 0.6, 0, env.stone(1.02));
    }
  };
  const urnOn = (env, x, y, z, s) => {
    place(env, "box", "stone", x, y, z, s * 1.5, s * 0.5, s * 1.5, 0, env.stone(0.9));
    place(env, "frustum6", "stone", x, y + s * 0.5, z, s * 0.6, s * 1.0, s * 0.6, 0, env.stone(1.05));
    place(env, "sphere", "stone", x, y + s * 1.5, z, s * 0.75, s * 0.7, s * 0.75, 0, env.stone(1.02));
  };


  builders.mausoleum = (env) => {
    const r = env.rng;
    const grand = env.theme.grand;
    const w = env.scale * r.float(4.5, 8) * (0.8 + grand * 0.5);
    const d = w * r.float(0.7, 1.15);
    const h = env.scale * r.float(3, 6.5) * (0.7 + grand * 0.6);
    const st = env.stone();
    const roofStyle = r.pick(grand > 0.75 ? ["pyramid", "dome", "roof", "pyramid"] : ["roof", "pyramid", "flat", "dome"]);
    const plinth = env.stone(0.85);
    place(env, "box", "stone", 0, 0, 0, w + 1, 0.5, d + 1, 0, plinth);
    place(env, "box", "stone", 0, 0.5, 0, w, h, d, 0, st);
    place(env, "box", "stone", 0, 0.5 + h, 0, w + 0.6, 0.5, d + 0.6, 0, plinth);
    const top = 1 + h;
    if (roofStyle === "pyramid") place(env, "pyramid", "stone", 0, top, 0, w + 0.9, env.scale * r.float(2, 4.5), d + 0.9, 0, env.stone(0.9));
    else if (roofStyle === "roof") place(env, "roof", "stone", 0, top, 0, w + 0.9, env.scale * r.float(1.8, 3.4), d + 0.9, 0, env.stone(0.9));
    else if (roofStyle === "dome") place(env, "sphere", "stone", 0, top, 0, (w + 0.6) / 2, env.scale * r.float(2, 3.4), (d + 0.6) / 2, 0, env.stone(1.02));
    else place(env, "box", "stone", 0, top, 0, w + 0.8, 0.5, d + 0.8, 0, plinth);

    // doorway recess
    const dw = Math.min(1.6, w * 0.3);
    place(env, "box", "void", 0, 0.5, d / 2 - 0.05, dw, h * 0.62, 0.5, 0, 0x05070a);
    place(env, "box", "stone", 0, 0.5, d / 2 + 0.1, dw + 0.7, 0.55, 0.4, 0, plinth);
    place(env, "box", "stone", -dw / 2 - 0.3, 0.5, d / 2 + 0.1, 0.45, h * 0.7, 0.45, 0, plinth);
    place(env, "box", "stone", dw / 2 + 0.3, 0.5, d / 2 + 0.1, 0.45, h * 0.7, 0.45, 0, plinth);

    // columns
    if (env.grand && r.chance(0.5 + grand * 0.4)){
      const n = r.int(2, 4);
      for (let i = 0; i < n; i++){
        const cx = -w / 2 + (i / (n - 1 || 1)) * w;
        place(env, "cyl8", "stone", cx, 0.5, d / 2 + 0.55, 0.3, h * r.float(0.6, 0.85), 0.3, 0, env.stone(1.05));
      }
    }
    // facade ornament
    cornerPilasters(env, w, d, h, 0.5);
    const nrows = h > 4.6 ? 2 : 1;
    facadeNiches(env, w, d, h, 0.62, nrows, Math.max(2, Math.round(w / 2.4)));
    if (grand > 0.75 || r.chance(0.5)) cornice(env, 0.5 + h, w, d, 0.42);
    if (r.chance(0.4)) urnOn(env, -w / 2, 0.5 + h + 0.4, d / 2 - 0.6, 0.4);
    if (r.chance(0.4)) urnOn(env, w / 2, 0.5 + h + 0.4, d / 2 - 0.6, 0.4);
    // gilded nameplate
    if (r.chance(0.28 + grand * 0.25)){
      place(env, "box", "relief", 0, 0.5 + h * 0.75, d / 2 + 0.16, dw + 0.4, 0.35, 0.1, 0, null);
    }
    if (r.chance(0.4)) addReadable(env, 0, 0.5 + h * 0.5, d / 2 + 0.18, Math.min(1.6, w * 0.5), 0.5);
    addFoot(env.x, env.z, w + 1.2, d + 1.2, env.yaw);
  };

  // a long, tall facade that lines avenues — the "street wall" of the necropolis
  builders.streetVault = (env) => {
    const r = env.rng;
    const w = env.scale * r.float(5.5, 10);
    const d = env.scale * r.float(3.4, 5.0);
    const h = env.scale * r.float(6.5, 12) * (0.75 + env.theme.grand * 0.55);
    const plinth = env.stone(0.84);
    place(env, "box", "stone", 0, 0, 0, w + 1, 0.5, d + 1, 0, plinth);
    place(env, "box", "stone", 0, 0.5, 0, w, h, d, 0, env.stone());
    place(env, "box", "stone", 0, 0.5 + h, 0, w + 0.7, 0.5, d + 0.7, 0, plinth);
    place(env, "box", "stone", 0, 1 + h, 0, w * 0.82, env.scale * r.float(0.8, 2.2), d * 0.76, 0, env.stone(0.92));
    // doorway + niches on the street face
    const dw = Math.min(1.8, w * 0.26);
    place(env, "box", "void", 0, 0.5, d / 2 + 0.04, dw, h * 0.6, 0.5, 0, 0x05070a);
    place(env, "box", "stone", 0, 0.5, d / 2 + 0.2, dw + 0.8, 0.5, 0.4, 0, plinth);
    facadeNiches(env, w, d, h, 0.62, h > 8 ? 3 : (h > 4.5 ? 2 : 1), Math.max(3, Math.round(w / 1.35)));
    cornerPilasters(env, w, d, h, 0.5);
    cornice(env, 0.5 + h, w, d, 0.34);
    if (r.chance(0.5)) urnOn(env, -w / 2 + 0.6, 1 + h + env.scale * r.float(0.6, 1.8), d / 2 - 0.5, 0.42);
    if (r.chance(0.5)) urnOn(env, w / 2 - 0.6, 1 + h + env.scale * r.float(0.6, 1.8), d / 2 - 0.5, 0.42);
    if (r.chance(0.4)) addReadable(env, 0, 0.5 + h * 0.55, d / 2 + 0.22, Math.min(2.2, w * 0.5), 0.55);
    addFoot(env.x, env.z, w + 1, d + 1, env.yaw);
  };

  builders.tower = (env) => {
    const r = env.rng;
    const w = env.scale * r.float(2.6, 4.2);
    let h = env.scale * r.float(9, 18) * (0.8 + env.theme.grand * 0.6);
    const st = env.stone();
    place(env, "box", "stone", 0, 0, 0, w + 1, 0.6, w + 1, 0, env.stone(0.8));
    const tiers = r.int(3, 5);
    let y = 0.6, tw = w;
    for (let t = 0; t < tiers; t++){
      const th = h / tiers;
      place(env, "box", "stone", 0, y, 0, tw, th, tw, 0, st);
      if (t < tiers - 1){
        place(env, "box", "stone", 0, y + th, 0, tw + 0.6, 0.35, tw + 0.6, 0, env.stone(0.85));
        // columbarium niches
        const rows = Math.max(1, Math.floor(th / 1.6));
        const cols = Math.max(1, Math.floor(tw / 1.4));
        for (let ry = 0; ry < rows; ry++){
          for (let cx = 0; cx < cols; cx++){
            const nx = -tw / 2 + (cx + 0.5) * (tw / cols);
            const ny = y + 0.8 + ry * 1.5;
            place(env, "box", "void", nx, ny, tw / 2 + 0.02, 0.8, 1.0, 0.12, 0, 0x05070a);
            place(env, "box", "void", nx, ny, -tw / 2 - 0.02, 0.8, 1.0, 0.12, 0, 0x05070a);
          }
        }
      }
      y += th; tw *= 0.86;
    }
    if (env.theme.grand > 0.7 || r.chance(0.5)) crenellate(env, y, tw + 0.6, tw + 0.6, Math.max(3, Math.round(tw / 1.6)));
    const cap = r.pick(["cone8", "pyramid", "cone6"]);
    place(env, cap, "stone", 0, y, 0, tw + 0.4, env.scale * r.float(2.5, 5.5), tw + 0.4, 0, env.stone(1.05));
    if (r.chance(0.5)){
      addLantern(env.x, y + env.scale * 2.2, env.z, env.theme.light, 0.7, 7);
    }
    addFoot(env.x, env.z, w + 1, w + 1, env.yaw);
  };

  builders.crypt = (env) => {
    const r = env.rng;
    const w = env.scale * r.float(5, 10);
    const d = env.scale * r.float(4, 8);
    const h = env.scale * r.float(2.2, 3.6);
    const st = env.stone();
    place(env, "box", "stone", 0, 0, 0, w + 1, 0.4, d + 1, 0, env.stone(0.82));
    place(env, "box", "stone", 0, 0.4, 0, w, h, d, 0, st);
    place(env, "box", "stone", 0, 0.4 + h, 0, w + 1.2, 0.5, d + 1.2, 0, env.stone(0.88));
    place(env, "box", "stone", 0, 0.4 + h + 0.5, 0, w * 0.7, 0.9, d * 0.7, 0, env.stone(0.95));
    // ornament
    cornerPilasters(env, w, d, h, 0.4);
    if (w > 6) facadeNiches(env, w, d, h, 0.5, 1, Math.max(2, Math.round(w / 3)));
    cornice(env, 0.4 + h, w + 1.2, d + 1.2, 0.3);
    // downward steps
    place(env, "wedge", "stone", 0, 0.4, -d / 2 - 0.9, w * 0.5, 1.0, 1.6, Math.PI, env.stone(0.8));
    const dw = Math.min(1.6, w * 0.28);
    place(env, "box", "void", 0, 0.4, -d / 2 + 0.05, dw, h * 0.75, 0.4, 0, 0x05070a);
    if (r.chance(0.35)) addReadable(env, 0, 0.4 + h * 0.55, -d / 2 - 0.06, Math.min(2, w * 0.4), 0.4);
    addFoot(env.x, env.z, w + 1, d + 1, env.yaw);
  };

  builders.monolith = (env) => {
    const r = env.rng;
    const w = env.scale * r.float(1.8, 3.4);
    const d = env.scale * r.float(0.6, 1.2);
    const h = env.scale * r.float(8, 20);
    const st = env.stone();
    place(env, "box", "stone", 0, 0, 0, w + 1.2, 0.5, d + 1.4, 0, env.stone(0.8));
    place(env, "box", "stone", 0, 0.5, 0, w, h, d, 0, st);
    place(env, "box", "stone", 0, 0.5 + h, 0, w * 0.7, 0.6, d * 1.2, 0, env.stone(0.9));
    // carved glyphs
    const rows = Math.floor(h / 2.2);
    for (let i = 0; i < rows; i++){
      if (r.chance(0.5)) place(env, "box", "relief", 0, 1.6 + i * 2.2, d / 2 + 0.03, w * 0.5, 0.22, 0.06, 0, null);
    }
    if (r.chance(0.7)) addReadable(env, 0, h * 0.45, d / 2 + 0.07, w * 0.6, 0.4);
    addFoot(env.x, env.z, w + 1, d + 1.6, env.yaw);
  };

  builders.obelisk = (env) => {
    const r = env.rng;
    const w = env.scale * r.float(1.6, 2.6);
    const h = env.scale * r.float(7, 15);
    place(env, "box", "stone", 0, 0, 0, w + 1.4, 0.7, w + 1.4, 0, env.stone(0.8));
    place(env, "box", "stone", 0, 0.7, 0, w + 0.6, 1.2, w + 0.6, 0, env.stone(0.9));
    place(env, "frustum4", "stone", 0, 1.9, 0, w, h, w, 0, env.stone(1.0));
    place(env, "pyramid", "gold", 0, 1.9 + h, 0, w * 1.05, w * 1.6, w * 1.05, 0, 0xc9a24a);
    addFoot(env.x, env.z, w + 1.6, w + 1.6, env.yaw);
  };

  builders.colonnade = (env) => {
    const r = env.rng;
    const n = r.int(4, 8);
    const span = env.scale * r.float(8, 16);
    const h = env.scale * r.float(5, 8);
    for (let i = 0; i < n; i++){
      const cx = -span / 2 + (i / (n - 1 || 1)) * span;
      place(env, "cyl8", "stone", cx, 0, 0, 0.5, h, 0.5, 0, env.stone(1.0));
      place(env, "box", "stone", cx, h, 0, 1.1, 0.35, 1.1, 0, env.stone(0.9));
    }
    place(env, "box", "stone", 0, h + 0.35, 0, span + 1.4, 0.7, 1.6, 0, env.stone(0.88));
    if (r.chance(0.5)) addReadable(env, 0, h * 0.95, 0.95, Math.min(3, span * 0.4), 0.4);
    addFoot(env.x, env.z, span + 1, 2, env.yaw);
  };

  builders.ossuaryStack = (env) => {
    const r = env.rng;
    const w = env.scale * r.float(3, 6);
    const d = env.scale * r.float(3, 5);
    const layers = r.int(4, 9);
    const lh = env.scale * 0.9;
    place(env, "box", "crypt", 0, 0, 0, w + 1, 0.4, d + 1, 0, null);
    for (let i = 0; i < layers; i++){
      const shrink = 1 - i * 0.06;
      place(env, "box", "bone", 0, 0.4 + i * lh, 0, w * shrink, lh * 0.92, d * shrink, 0, vary(0xcfc6ae, r, 0.1));
    }
    // skulls on the face
    const cols = Math.max(1, Math.floor(w / 1.1));
    for (let cx = 0; cx < cols; cx++){
      const nx = -w / 2 + (cx + 0.5) * (w / cols);
      for (let ry = 0; ry < layers - 1; ry++){
        if (r.chance(0.5)) place(env, "sphere", "bone", nx, 0.4 + ry * lh + lh * 0.5, d / 2 + 0.1, 0.22, 0.25, 0.22, 0, vary(0xe0d8c0, r, 0.08));
      }
    }
    if (r.chance(0.3)) addReadable(env, 0, 0.4 + layers * lh * 0.55, d / 2 + 0.16, w * 0.5, 0.4);
    addFoot(env.x, env.z, w + 1, d + 1, env.yaw);
  };

  builders.statue = (env) => {
    const r = env.rng;
    const s = env.scale * r.float(1.1, 1.9);
    const ph = s * r.float(0.7, 1.2);
    const fh = s * r.float(3.2, 5.2);
    const col = env.stone(1.02);
    place(env, "box", "stone", 0, 0, 0, s * 1.7, ph, s * 1.7, 0, env.stone(0.82));
    place(env, "box", "stone", 0, ph, 0, s * 1.2, 0.35, s * 1.2, 0, env.stone(0.9));
    // robe
    place(env, "cone6", "stone", 0, ph + 0.35, 0, s * 0.6, fh, s * 0.6, 0, col);
    // shoulders + head
    place(env, "sphere", "stone", 0, ph + 0.35 + fh * 0.92, 0, s * 0.42, s * 0.42, s * 0.42, 0, env.stone(1.05));
    place(env, "sphere", "stone", 0, ph + 0.35 + fh * 1.12, 0, s * 0.26, s * 0.3, s * 0.26, 0, col);
    // wings
    if (r.chance(0.45)){
      place(env, "box", "stone", -s * 0.55, ph + fh * 0.4, -s * 0.2, s * 0.12, fh * 1.15, s * 0.9, 0, col, 0, 0.35);
      place(env, "box", "stone", s * 0.55, ph + fh * 0.4, -s * 0.2, s * 0.12, fh * 1.15, s * 0.9, 0, col, 0, -0.35);
    }
    // arms
    place(env, "cyl6", "stone", -s * 0.42, ph + 0.35 + fh * 0.45, s * 0.12, s * 0.14, fh * 0.5, s * 0.14, 0, col, 0.5, 0);
    place(env, "cyl6", "stone", s * 0.42, ph + 0.35 + fh * 0.45, s * 0.12, s * 0.14, fh * 0.5, s * 0.14, 0, col, 0.5, 0);
    addFoot(env.x, env.z, s * 1.7, s * 1.7, env.yaw);
  };

  builders.sarcophagus = (env) => {
    const r = env.rng;
    const w = env.scale * r.float(1.0, 1.6);
    const l = env.scale * r.float(2.4, 3.4);
    const h = env.scale * r.float(0.8, 1.2);
    const col = env.stone(0.95);
    place(env, "box", "stone", 0, 0, 0, w + 0.7, 0.3, l + 0.7, 0, env.stone(0.8));
    place(env, "box", "stone", 0, 0.3, 0, w, h, l, 0, col);
    place(env, "box", "stone", 0, 0.3 + h, 0, w + 0.25, 0.28, l + 0.25, 0, env.stone(1.05));
    // recumbent effigy
    place(env, "box", "stone", 0, 0.3 + h + 0.28, 0, w * 0.45, 0.28, l * 0.8, 0, env.stone(1.08));
    place(env, "sphere", "stone", 0, 0.3 + h + 0.5, l * 0.32, w * 0.2, w * 0.22, w * 0.2, 0, col);
    addFoot(env.x, env.z, w + 0.8, l + 0.8, env.yaw);
  };

  builders.grave = (env) => {
    const r = env.rng;
    const n = r.int(1, 5);
    for (let i = 0; i < n; i++){
      const ox = r.float(-2.4, 2.4), oz = r.float(-2.4, 2.4);
      const h = env.scale * r.float(0.5, 1.5);
      const w = env.scale * r.float(0.3, 0.7);
      const tilt = r.chance(0.35) ? r.float(-0.28, 0.28) : 0;
      const stone = vary(0x9a948a, r, 0.16);
      // grave mound
      place(env, "box", "stone", ox, 0.0, oz, w * 1.9, 0.14, w * 1.5, 0, env.stone(0.74));
      place(env, "roof", "stone", ox, 0.14, oz, w * 1.7, 0.28, w * 1.3, 0, env.stone(0.8));
      // headstone (slab, cross, or obelisk)
      const style = r.pick(["slab", "slab", "cross", "point"]);
      if (style === "slab"){
        place(env, "box", "stone", ox, 0.12, oz, w, h, w * 0.5, r.float(0, Math.PI), stone, tilt, tilt);
      } else if (style === "cross"){
        place(env, "box", "stone", ox, 0.12, oz, w * 0.5, h, w * 0.45, 0, stone);
        place(env, "box", "stone", ox, 0.12 + h * 0.62, oz, w * 1.5, w * 0.5, w * 0.45, 0, stone);
      } else {
        place(env, "frustum4", "stone", ox, 0.12, oz, w * 0.85, h * 1.25, w * 0.85, 0, stone);
        place(env, "pyramid", "stone", ox, 0.12 + h * 1.25, oz, w * 0.95, w * 1.1, w * 0.95, 0, env.stone(0.95));
      }
      if (r.chance(0.10)) addReadable(env, ox, 0.3, oz, w * 1.4, h * 0.5);
    }
  };

  builders.tombRow = (env) => {
    const r = env.rng;
    const n = r.int(3, 8);
    const span = env.scale * r.float(7, 14);
    const doubleRow = r.chance(0.55);
    for (let row = 0; row < (doubleRow ? 2 : 1); row++){
      const zoff = doubleRow ? (row === 0 ? -1.4 : 1.4) : 0;
      for (let i = 0; i < n; i++){
        const x = -span / 2 + (i / (n - 1 || 1)) * span + r.float(-0.4, 0.4);
        const hh = env.scale * r.float(0.5, 1.6);
        const ww = env.scale * r.float(0.35, 0.7);
        const stone = vary(0x9c968a, r, 0.18);
        place(env, "box", "stone", x, 0, zoff, ww * 1.8, 0.12, ww * 1.4, 0, env.stone(0.76));
        if (r.chance(0.45)){
          place(env, "box", "stone", x, 0.12, zoff, ww * 0.5, hh, ww * 0.45, 0, stone);
          place(env, "box", "stone", x, 0.12 + hh * 0.62, zoff, ww * 1.4, ww * 0.45, ww * 0.45, 0, stone);
        } else {
          place(env, "box", "stone", x, 0.12, zoff, ww, hh, ww * 0.5, r.float(-0.15, 0.15), stone, r.chance(0.25) ? r.float(-0.2, 0.2) : 0, 0);
        }
        if (r.chance(0.10)) addReadable(env, x, 0.3, zoff + 0.4, ww * 1.5, hh * 0.5);
      }
    }
    // wrought-iron rail along the plot edge
    const railMat = "metal";
    for (let i = 0; i <= n; i++){
      const x = -span / 2 - 0.6 + (i / n) * (span + 1.2);
      const z = doubleRow ? 2.6 : 1.4;
      place(env, "cyl6", railMat, x, 0, z, 0.08, 1.15, 0.08, 0, 0x2a3230);
      place(env, "cyl6", railMat, x, 0, -z, 0.08, 1.15, 0.08, 0, 0x2a3230);
    }
    place(env, "box", railMat, 0, 1.05, doubleRow ? 2.6 : 1.4, span + 1.4, 0.1, 0.1, 0, 0x2a3230);
    place(env, "box", railMat, 0, 1.05, doubleRow ? -2.6 : -1.4, span + 1.4, 0.1, 0.1, 0, 0x2a3230);
    addFoot(env.x, env.z, span * 0.55, doubleRow ? 3.6 : 2.2, env.yaw);
  };

  builders.tree = (env) => {
    const r = env.rng;
    const h = env.scale * r.float(4, 9);
    const col = vary(0x4a4038, r, 0.15);
    place(env, "frustum5", "stone", 0, 0, 0, env.scale * r.float(0.22, 0.4), h, env.scale * r.float(0.22, 0.4), 0, col);
    const branches = r.int(3, 6);
    for (let i = 0; i < branches; i++){
      const ang = r.float(0, Math.PI * 2);
      const len = r.float(1.5, 3.5) * env.scale;
      const y = h * r.float(0.55, 0.95);
      place(env, "frustum5", "stone", Math.cos(ang) * 0.2, y, Math.sin(ang) * 0.2, 0.12, len, 0.12, -ang, col, 0, r.float(0.5, 1.1));
    }
    addFoot(env.x, env.z, 1.1, 1.1, env.yaw);
  };

  builders.ruin = (env) => {
    const r = env.rng;
    const w = env.scale * r.float(3, 8);
    const d = env.scale * r.float(3, 7);
    const segs = r.int(2, 5);
    for (let i = 0; i < segs; i++){
      const sw = w * r.float(0.2, 0.6), sd = d * r.float(0.2, 0.6);
      const sh = env.scale * r.float(0.8, 4);
      const ox = r.float(-w / 2, w / 2), oz = r.float(-d / 2, d / 2);
      place(env, "box", "stone", ox, 0, oz, sw, sh, sd, r.float(0, Math.PI), env.stone(r.float(0.7, 1.0)));
    }
    for (let i = 0; i < r.int(2, 6); i++){
      place(env, "box", "stone", r.float(-w / 2, w / 2), 0, r.float(-d / 2, d / 2), r.float(0.4, 1.2), r.float(0.2, 0.5), r.float(0.4, 1.2), r.float(0, 3), env.stone(0.75), r.float(-0.4, 0.4), r.float(-0.4, 0.4));
    }
    addFoot(env.x, env.z, w * 0.6, d * 0.6, env.yaw);
  };

  builders.brazier = (env) => {
    const r = env.rng;
    const s = env.scale * r.float(0.5, 0.8);
    const warm = env.theme.key === "furnace";
    place(env, "cyl6", "stone", 0, 0, 0, s * 0.5, s * 3, s * 0.5, 0, env.stone(0.85));
    place(env, "frustum6", "metal", 0, s * 3, 0, s * 1.1, s * 0.9, s * 1.1, 0, 0x4a5a55);
    place(env, "sphere", warm ? "ember" : "soul", 0, s * 3.7, 0, s * 0.7, s * 0.7, s * 0.7, 0, null);
    addLantern(env.x, s * 3.9, env.z, warm ? 0xff8a3a : env.theme.light, 1.3, 12);
    addFoot(env.x, env.z, s * 1.4, s * 1.4, env.yaw);
  };

  builders.lanternPost = (env) => {
    const r = env.rng;
    const h = env.scale * r.float(3.5, 6.5);
    place(env, "cyl6", "metal", 0, 0, 0, 0.16, h, 0.16, 0, 0x2a3230);
    place(env, "box", "metal", 0, h, 0, 0.12, 0.12, 0.12, 0, 0x2a3230);
    place(env, "cyl6", "metal", 0, h, 0, 0.5, 0.1, 0.5, 0, 0x2a3230);
    place(env, "ico", env.theme.key === "furnace" ? "ember" : "soul", 0, h - 0.5, 0, 0.35, 0.42, 0.35, 0, null);
    addLantern(env.x, h - 0.5, env.z, env.theme.light, 1.0, 10);
    addFoot(env.x, env.z, 0.4, 0.4, env.yaw);
  };

  // ==================================================================
  //  FILL THE WARDS
  // ==================================================================
  const wedgeSpan = (Math.PI * 2) / avenueCount;
  const totalBands = ringRadii.length - 1;
  let bandDone = 0;

  for (let band = 0; band < totalBands; band++){
    const inner = ringRadii[band] + 4;
    const outer = ringRadii[band + 1] - 4;
    const depth = outer - inner;
    if (depth < 6){ bandDone++; continue; }
    const ringT = band / (totalBands - 1);

    for (let w = 0; w < avenueCount; w++){
      const ward = wards[w];
      const theme = ward.theme;
      const midA = (w + 0.5) * wedgeSpan;
      const midR = (inner + outer) / 2;
      const halfAng = Math.max(0.02, wedgeSpan / 2 - (AVENUE_W / 2 + 12.0) / midR);
      const arc = midR * halfAng * 2;
      if (arc < 3) continue;

      // local frame for this block: X tangential, Z radial
      const yaw = midA;
      const [cx, cz] = polar(midR, midA);
      const envBase = { B, rng, theme, oy: 0 };

      const cell = theme.cell * (0.65 + ringT * 0.55);
      const cols = Math.max(1, Math.round(arc / cell));
      const rows = Math.max(1, Math.round(depth / cell));
      const cw = arc / cols, cd = depth / rows;

      for (let rw = 0; rw < rows; rw++){
        if (instances > 260000) break;
        for (let cl = 0; cl < cols; cl++){
          if (instances > 260000) break;
          // position within block (local)
          const lx = -arc / 2 + (cl + 0.5) * cw + rng.float(-cw * 0.14, cw * 0.14);
          const lz = -depth / 2 + (rw + 0.5) * cd + rng.float(-cd * 0.14, cd * 0.14);
          const wc = Math.cos(yaw), ws = Math.sin(yaw);
          const wx = cx + lx * wc + lz * ws;
          const wz = cz - lx * ws + lz * wc;
          const rr = Math.hypot(wx, wz);

          // density falls off toward the walls
          const edgeFall = 1 - Math.max(0, (rr - inner) / (WALL_R - inner)) * 0.45;
          const fill = theme.fill * edgeFall * (0.7 + ringT * 0.4);
          if (!rng.chance(fill)) continue;

          const grand = theme.grand * (1 - ringT * 0.55);
          const orientation = rng.pick([yaw, yaw + Math.PI / 2, yaw + Math.PI, yaw - Math.PI / 2, yaw + rng.float(-0.3, 0.3)]);
          const env = {
            ...envBase,
            x: wx, z: wz, yaw: orientation,
            ward,
            scale: 1.0 + grand * 0.55,
            grand: grand > 0.6,
            stone: (b = 1) => rng.chance(0.13)
              ? vary(theme.accent, rng, 0.18)
              : vary(theme.tint, rng, 0.18 * b),
          };

          const builderName = rng.pickWeighted(theme.mix.map(a => a[0]), theme.mix.map(a => a[1]));
          (builders[builderName] || builders.grave)(env);
        }
      }
    }
    bandDone++;
    onProgress(0.12 + 0.55 * (bandDone / totalBands));
  }

  onProgress(0.7);

  // ==================================================================
  //  STREET FRONTAGE — line every avenue with tombs and lamps so the
  //  city reads as streets and processional ways, not open ground.
  // ==================================================================
  const frontageKeys = ["mausoleum", "crypt", "tombRow", "statue", "sarcophagus", "obelisk", "monolith", "ossuaryStack", "grave"];
  for (let j = 0; j < avenueCount; j++){
    const a = (j / avenueCount) * Math.PI * 2;
    const cosA = Math.cos(a), sinA = Math.sin(a);
    const perpX = -sinA, perpZ = cosA;
    for (const side of [1, -1]){
      const ward = wards[side > 0 ? (j % avenueCount) : ((j - 1 + avenueCount) % avenueCount)];
      const theme = ward.theme;
      const yaw = side > 0 ? (Math.PI - a) : (-a);
      const off = AVENUE_W / 2 + 5.0;
      const lampOff = AVENUE_W / 2 + 1.1;

      // a run of lamps along the curb
      for (let r = 34; r < WALL_R - 12; r += 26){
        let nearRing = false;
        for (const rr of ringRadii){ if (Math.abs(r - rr) < 6){ nearRing = true; break; } }
        if (nearRing) continue;
        const lx = cosA * r + perpX * lampOff * side;
        const lz = sinA * r + perpZ * lampOff * side;
        builders.lanternPost({
          B, rng, theme, oy: 0, x: lx, z: lz, yaw, ward, scale: 0.95, grand: false,
          stone: (b = 1) => vary(theme.tint, rng, 0.16 * b),
        });
      }

      // facades facing the street
      let r = 34;
      while (r < WALL_R - 16){
        r += rng.float(4.5, 7.5) * (0.92 + theme.grand * 0.16);
        let nearRing = false;
        for (const rr of ringRadii){ if (Math.abs(r - rr) < 6){ nearRing = true; break; } }
        if (nearRing || !rng.chance(0.95)) continue;
        const bx = cosA * r + perpX * off * side;
        const bz = sinA * r + perpZ * off * side;
        const use = [["streetVault", 6], ["tombRow", 2.4], ["crypt", 1.8], ["mausoleum", 1.8], ["ossuaryStack", 0.7], ["sarcophagus", 0.7], ["statue", 0.4], ["monolith", 0.35], ["obelisk", 0.3], ["grave", 0.5]];
        const pick = rng.pickWeighted(use.map(m => m[0]), use.map(m => m[1]));
        builders[pick]({
          B, rng, theme, oy: 0, x: bx, z: bz, yaw, ward,
          scale: 0.7 + theme.grand * 0.4, grand: theme.grand > 0.72,
          stone: (b = 1) => rng.chance(0.13)
            ? vary(theme.accent, rng, 0.18)
            : vary(theme.tint, rng, 0.18 * b),
        });
      }
    }
  }

  // ==================================================================
  //  PERIMETER WALL + GATES
  // ==================================================================
  const segs = 96;
  for (let i = 0; i < segs; i++){
    const a = (i / segs) * Math.PI * 2;
    const [x, z] = polar(WALL_R, a);
    const isGateAvenue = (() => {
      const rel = ((a % wedgeSpan) + wedgeSpan) % wedgeSpan;
      return Math.min(rel, wedgeSpan - rel) < (AVENUE_W / 2 + 1.2) / WALL_R;
    })();
    if (isGateAvenue){
      const isMain = Math.abs(((a - GATE_ANGLE) % (Math.PI * 2) + Math.PI * 3) % (Math.PI * 2) - Math.PI) < 0.5;
      place({ B, x, z, yaw: a + Math.PI / 2, oy: 0 }, "box", "stone", 0, 0, 0, WALL_R * wedgeSpan + 1, isMain ? 4 : 3.2, 3, 0, vary(0x8a857a, rng, 0.1));
      continue;
    }
    const h = 9 + Math.sin(i * 2.3) * 1.5 + rng.float(-0.6, 0.6);
    place({ B, x, z, yaw: a + Math.PI / 2, oy: 0 }, "box", "stone", 0, 0, 0, WALL_R * wedgeSpan + 1.2, h, 5, 0, vary(0x827d72, rng, 0.1));
    // crenellations
    if (i % 2 === 0){
      place({ B, x, z, yaw: a + Math.PI / 2, oy: 0 }, "box", "stone", 0, h, -1.4, 3, 1.6, 2, 0, vary(0x8a857a, rng, 0.08));
      place({ B, x, z, yaw: a + Math.PI / 2, oy: 0 }, "box", "stone", 0, h, 1.4, 3, 1.6, 2, 0, vary(0x8a857a, rng, 0.08));
    }
  }

  // gate towers at each avenue
  for (let j = 0; j < avenueCount; j++){
    const a = (j / avenueCount) * Math.PI * 2;
    for (const sgn of [-1, 1]){
      const off = (AVENUE_W / 2 + 2.2) * sgn;
      const tx = Math.cos(a) * WALL_R - Math.sin(a) * off;
      const tz = Math.sin(a) * WALL_R + Math.cos(a) * off;
      addFoot(tx, tz, 7, 7, a);
      place({ B, x: tx, z: tz, yaw: a, oy: 0 }, "box", "stone", 0, 0, 0, 7, 1, 7, 0, vary(0x7d786d, rng, 0.08));
      place({ B, x: tx, z: tz, yaw: a, oy: 0 }, "cyl8", "stone", 0, 1, 0, 3, 15, 3, 0, vary(0x87827a, rng, 0.08));
      place({ B, x: tx, z: tz, yaw: a, oy: 0 }, "cone8", "stone", 0, 16, 0, 3.6, 4, 3.6, 0, vary(0x6f6a62, rng, 0.08));
      addLantern(tx, 16, tz, j === Math.round((GATE_ANGLE / (Math.PI * 2)) * avenueCount + avenueCount) % avenueCount ? 0xffd98a : 0x8fe6c8, 0.8, 9);
    }
  }

  // ==================================================================
  //  THE SANCTUM (central temple)
  // ==================================================================
  const templeEnv = { B, rng, theme: THEMES[0], oy: 0, x: 0, z: 0, yaw: 0, scale: 1, grand: true, stone: (b = 1) => vary(0xb4aa96, rng, 0.08 * b) };
  {
    const t = templeEnv;
    // stepped platform
    place(t, "cyl12", "stone", 0, 0, 0, 22, 1.2, 22, 0, 0x8f8a80);
    place(t, "cyl12", "stone", 0, 1.2, 0, 19, 1.0, 19, 0, 0x9a958b);
    place(t, "cyl12", "plaza", 0, 2.2, 0, 16.5, 0.4, 16.5, 0, null);
    // walkable steps (the player can climb these to the temple)
    addGround(0, 0, 0, 0, 0, 1.2, 22);
    addGround(0, 0, 0, 0, 0, 2.2, 19);
    addGround(0, 0, 0, 0, 0, 2.6, 16.5);
    // ring of columns
    const cols = 16;
    for (let i = 0; i < cols; i++){
      const a = ((i + 0.5) / cols) * Math.PI * 2;
      const [x, z] = polar(13.5, a);
      place(t, "cyl8", "marble", x, 2.6, z, 0.75, 11, 0.75, 0, vary(0xbfc2c6, rng, 0.07));
      place(t, "box", "marble", x, 13.6, z, 1.7, 0.6, 1.7, -a, vary(0xbfc2c6, rng, 0.05));
      addFoot(x, z, 1.7, 1.7, 0);
    }
    // architrave ring
    place(t, "cyl12", "stone", 0, 14.2, 0, 15.2, 1.3, 15.2, 0, 0xa39d92);
    place(t, "cyl12", "stone", 0, 15.5, 0, 14.2, 1.0, 14.2, 0, 0x9a958b);
    // inner sanctum
    place(t, "box", "marble", 0, 2.6, 0, 12, 14, 12, 0, 0xb8bcc0);
    // great doors (animated later) — two halves on +Z face
    place(t, "box", "goldGlow", -2.2, 2.6, 6.1, 4.2, 11, 0.5, 0, null);
    place(t, "box", "goldGlow", 2.2, 2.6, 6.1, 4.2, 11, 0.5, 0, null);
    // dome
    place(t, "sphere", "stone", 0, 16.5, 0, 13.5, 11, 13.5, 0, 0xa8a49a);
    place(t, "cyl12", "stone", 0, 16.5, 0, 13.8, 0.8, 13.8, 0, 0x8f8a80);
    // lantern crown / spire
    place(t, "cone8", "goldGlow", 0, 27.5, 0, 1.6, 6, 1.6, 0, null);
    place(t, "ico", "soul", 0, 35, 0, 1.6, 1.9, 1.6, 0, null);
    addLantern(0, 34, 0, 0x8fe6c8, 1.2, 26);

    // four corner obelisks
    for (let i = 0; i < 4; i++){
      const a = Math.PI / 4 + i * Math.PI / 2;
      const [x, z] = polar(20, a);
      place(t, "box", "stone", x, 0, z, 3, 1.0, 3, -a, 0x8a857a);
      place(t, "frustum4", "gold", x, 1.0, z, 1.6, 12, 1.6, -a, 0xc9a24a);
      place(t, "pyramid", "gold", x, 13, z, 1.7, 2.4, 1.7, -a, 0xc9a24a);
    }
    // the inner sanctum is a solid monument; the player can climb the steps
    // and stand at the doors, but the doors themselves stay sealed.
    addFoot(0, 0, 12, 12, 0);
  }

  // ==================================================================
  //  SHRINES (the seven sigils) + spirit spawns
  // ==================================================================
  const shrineWards = rng.shuffle(wards.slice()).slice(0, Math.min(config.sigilsRequired, wards.length));
  for (const wd of shrineWards){
    const a = (wd.index + 0.5) * wedgeSpan;
    const r = rng.float(70, 210);
    const [x, z] = polar(r, a);
    // clear-ish shrine: octagonal dais + pillars + floating sigil
    const t = { B, rng, theme: wd.theme, oy: 0, x, z, yaw: a, scale: 1, grand: true, stone: (b = 1) => vary(0xbfc2c6, rng, 0.06 * b) };
    place(t, "cyl8", "stone", 0, 0, 0, 3.4, 0.5, 3.4, 0, 0x8f8a80);
    place(t, "cyl8", "marble", 0, 0.5, 0, 2.6, 0.6, 2.6, 0, 0xb8bcc0);
    for (let i = 0; i < 4; i++){
      const pa = (i / 4) * Math.PI * 2 + Math.PI / 4;
      const [px, pz] = [Math.cos(pa) * 2.2, Math.sin(pa) * 2.2];
      place(t, "cyl6", "marble", px, 1.1, pz, 0.3, 3.2, 0.3, 0, 0xbfc2c6);
    }
    place(t, "cyl8", "marble", 0, 4.3, 0, 3.0, 0.4, 3.0, 0, 0xa8acb0);
    addFoot(x, z, 5.5, 5.5, a);
    addLantern(x, 5.2, z, wd.theme.light, 1.6, 16);
    // the floating sigil itself (live mesh, animated)
    const sigilGeo = new THREE.TorusGeometry(0.85, 0.16, 8, 4);
    const sigilMat = new THREE.MeshStandardMaterial({ color: 0x0a1a16, emissive: 0x8fe6c8, emissiveIntensity: 1.6, roughness: 0.3 });
    const sigil = new THREE.Mesh(sigilGeo, sigilMat);
    sigil.position.set(x, 6.2, z);
    sigil.rotation.x = Math.PI / 2;
    group.add(sigil);
    const glow = new THREE.PointLight(0x8fe6c8, 12, 22, 2);
    glow.position.copy(sigil.position);
    group.add(glow);
    shrines.push({ x, y: 6.2, z, mesh: sigil, glow, ward: wd, taken: false });
  }

  for (let i = 0; i < config.spiritCount; i++){
    const a = rng.float(0, Math.PI * 2);
    const r = rng.float(35, WALL_R - 15);
    const [x, z] = polar(r, a);
    spirits.push({ x, z, ang: rng.float(0, Math.PI * 2), ward: wards[Math.floor((((a % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2)) / wedgeSpan) % avenueCount] });
  }

  onProgress(0.86);

  // ==================================================================
  //  BUILD THE INSTANCED MESHES
  // ==================================================================
  const meshes = B.build(group, { castShadow: true, receiveShadow: true });

  // spawn at the south gate looking inward
  const [sx, sz] = polar(WALL_R - 12, GATE_ANGLE);
  const spawn = { x: sx, z: sz, yaw: -GATE_ANGLE + Math.PI / 2 };

  onProgress(0.95);

  return {
    group, meshes, footprints, grounds, lanterns, shrines, spirits, wards, readables,
    spawn, radius: WALL_R, avenueCount, ringRadii,
    instanceCount: instances,
  };
}
