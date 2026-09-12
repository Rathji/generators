/*
 * shape-keys.js - automatic Shape Keys (morph targets / blendshapes) for the stage mesh.
 *
 * Blender's Shape Keys panel is how you make a static mesh expressive: deform it once,
 * store the difference, then drive it at any weight. This module brings that to the
 * viewer, and - importantly - it can drive it *from the rig*. Two generators:
 *
 *   autoShape(ids)      Procedural shapes computed straight from the geometry: Inflate,
 *                       Deflate, Taper, Twist, Bend, Stretch, Slim, Smooth, Spherify and
 *                       Muscle. Real per-vertex deltas, no rig needed - works on an
 *                       AI-reconstructed volume, a relief or any imported mesh.
 *
 *   autoShapeKeys(opts) Rig-aware shapes. For each important bone (spine, arms, legs,
 *                       head/neck) it bends the region around that joint, using the
 *                       bone's own position and direction, and adds a joint "Bulge".
 *                       So the auto-rig gets a matching automatic set of corrective
 *                       shape keys the moment you forge/fit one.
 *
 * Everything is committed as real `geometry.morphAttributes.position` + `morphTargetsRelative`
 * morphs with named influences, so the renderer shows them live AND the GLB exporter writes
 * them out as standard glTF morph targets (so Blender opens them as Shape Keys).
 */

import { THREE } from "./three.js";
import { analyzeRig } from "./armature.js";

const { Vector3, Quaternion, Matrix4, Float32BufferAttribute } = THREE;

export const AUTO_SHAPES = [
  { id: "inflate", label: "Inflate", hint: "Push every surface out along its normal", amount: 0.1 },
  { id: "deflate", label: "Deflate", hint: "Pull the surface in along its normal", amount: 0.1 },
  { id: "taper", label: "Taper", hint: "Narrow the top, widen the base", amount: 0.35 },
  { id: "twist", label: "Twist", hint: "Rotate the top relative to the bottom", amount: 0.65 },
  { id: "bend", label: "Bend", hint: "Curl the model about its width axis", amount: 0.7 },
  { id: "stretch", label: "Stretch", hint: "Scale up along the tallest axis", amount: 0.3 },
  { id: "slim", label: "Slim", hint: "Shrink the two horizontal axes", amount: 0.25 },
  { id: "smooth", label: "Smooth", hint: "Laplacian-relax the surface (melts detail)", amount: 0.55 },
  { id: "spherify", label: "Spherify", hint: "Blend the whole shape toward a sphere", amount: 0.6 },
  { id: "muscle", label: "Muscle", hint: "Bilateral bulge on the upper body", amount: 0.22 },
];

export const AUTO_SHAPE_IDS = AUTO_SHAPES.map((s) => s.id);

const JOINT_RE = /shoulder|elbow|knee|hip|spine|chest|neck|head|wrist|ankle|thigh|upperarm|forearm|calf|pelv|chest|torso/i;
const SKIP_RE = /ik|pole|helper|locator|null|ctrl|control|twist|nub|end|tip|target|constraint|_dummy/i;

const KEY_PREFIX = "Shape \u00b7 ";
const RIG_PREFIX = "Rig \u00b7 ";

function smoothstep(e0, e1, x) {
  let t = (x - e0) / (e1 - e0);
  if (!Number.isFinite(t)) t = x < e0 ? 0 : 1;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  return t * t * (3 - 2 * t);
}

function gauss(d, s) {
  return Math.exp(-(d * d) / (2 * s * s));
}

export function createShapeKeys({ getRoot, toast, onChange } = {}) {
  const baseline = new WeakMap(); // mesh -> { morphs, relative }
  const frames = new WeakMap(); // mesh -> cached frame
  const weights = new Map(); // name -> value (0..1)
  const owned = new Set(); // names this module created
  const meta = new Map(); // name -> {kind, created}

  const say = (t, ms) => {
    if (typeof toast === "function") toast(t, ms);
  };
  const changed = () => {
    if (typeof onChange === "function") onChange();
  };

  function root() {
    return typeof getRoot === "function" ? getRoot() : null;
  }

  function meshes() {
    const r = root();
    const out = [];
    if (!r) return out;
    r.traverse((o) => {
      if (!o.isMesh || !o.geometry) return;
      const g = o.geometry;
      if (!g.attributes || !g.attributes.position) return;
      if (o.visible === false && !o.isSkinnedMesh) return;
      out.push(o);
    });
    return out;
  }

  /* ---- morph plumbing ---------------------------------------------------------- */

  function ensureBaseline(mesh) {
    if (baseline.has(mesh)) return baseline.get(mesh);
    const geo = mesh.geometry;
    const morphs = geo.morphAttributes && geo.morphAttributes.position ? geo.morphAttributes.position.slice() : [];
    const entry = { morphs, relative: !!mesh.morphTargetsRelative, hadNormals: !!(geo.morphAttributes && geo.morphAttributes.normal) };
    baseline.set(mesh, entry);
    return entry;
  }

  function morphNames(mesh) {
    const g = mesh.geometry;
    const arr = (g.morphAttributes && g.morphAttributes.position) || [];
    return arr.map((a, i) => a.name || String(i));
  }

  function hasMorph(mesh, name) {
    return morphNames(mesh).indexOf(name) !== -1;
  }

  function addMorph(mesh, name, deltas) {
    ensureBaseline(mesh);
    const geo = mesh.geometry;
    if (!geo.morphAttributes) geo.morphAttributes = {};
    if (!geo.morphAttributes.position) geo.morphAttributes.position = [];
    if (!geo.userData) geo.userData = {};
    geo.morphAttributes.position = geo.morphAttributes.position.filter((a) => a.name !== name);
    const attr = new Float32BufferAttribute(deltas, 3);
    attr.name = name;
    attr.usage = THREE.DynamicDrawUsage;
    geo.morphAttributes.position.push(attr);
    // Mixed position/normal morph counts break the renderer's binding, and our shapes
    // carry no normal deltas, so drop any imported normal morphs once we take over.
    if (geo.morphAttributes.normal) delete geo.morphAttributes.normal;

    mesh.morphTargetsRelative = true;
    if (!mesh.morphTargetInfluences) mesh.morphTargetInfluences = [];
    const snap = snapshotInfluences(mesh);
    syncMorphs(mesh);
    restoreInfluences(mesh, snap);
    const idx = mesh.morphTargetDictionary[name];
    if (idx == null) return false;
    mesh.morphTargetInfluences[idx] = weights.get(name) || 0;
    mesh.frustumCulled = false;
    markMaterial(mesh);
    return true;
  }

  function removeMorph(mesh, name) {
    const geo = mesh.geometry;
    if (!geo.morphAttributes || !geo.morphAttributes.position) return false;
    const before = geo.morphAttributes.position.length;
    geo.morphAttributes.position = geo.morphAttributes.position.filter((a) => a.name !== name);
    if (geo.morphAttributes.position.length === before) return false;
    if (!geo.morphAttributes.position.length) delete geo.morphAttributes.position;
    syncMorphs(mesh);
    if (mesh.morphTargetInfluences) {
      const names = morphNames(mesh);
      for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
        const n = names[i];
        if (n != null && weights.has(n)) mesh.morphTargetInfluences[i] = weights.get(n);
      }
    }
    mesh.frustumCulled = false;
    markMaterial(mesh);
    return true;
  }

  /* three's updateMorphTargets() only rebuilds when morph attributes remain, so removing
     the last one leaves a stale dictionary/influence array - clear it by hand. */
  function syncMorphs(mesh) {
    const arr = (mesh.geometry.morphAttributes && mesh.geometry.morphAttributes.position) || [];
    if (!arr.length) {
      mesh.morphTargetDictionary = {};
      mesh.morphTargetInfluences = [];
      return;
    }
    mesh.updateMorphTargets();
  }

  function snapshotInfluences(mesh) {
    const snap = new Map();
    const dict = mesh.morphTargetDictionary || {};
    const inf = mesh.morphTargetInfluences || [];
    for (const name of Object.keys(dict)) snap.set(name, inf[dict[name]] || 0);
    return snap;
  }

  function restoreInfluences(mesh, snap) {
    const dict = mesh.morphTargetDictionary || {};
    const inf = mesh.morphTargetInfluences || [];
    for (const [name, v] of snap) {
      const idx = dict[name];
      if (idx != null) inf[idx] = v;
    }
  }

  function markMaterial(mesh) {
    if (!mesh.material) return;
    const list = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const m of list) if (m) m.needsUpdate = true;
  }

  function applyWeights() {
    for (const mesh of meshes()) {
      const names = morphNames(mesh);
      if (!mesh.morphTargetInfluences) continue;
      for (let i = 0; i < mesh.morphTargetInfluences.length; i++) {
        const n = names[i];
        if (n != null && weights.has(n)) mesh.morphTargetInfluences[i] = weights.get(n);
      }
    }
  }

  /* ---- geometry frame ---------------------------------------------------------- */

  function frameOf(mesh) {
    if (frames.has(mesh)) return frames.get(mesh);
    const geo = mesh.geometry;
    if (!geo.attributes.normal) geo.computeVertexNormals();
    geo.computeBoundingBox();
    const box = geo.boundingBox;
    const center = box.getCenter(new Vector3());
    const size = box.getSize(new Vector3());
    const f = { geo, pos: geo.attributes.position, nor: geo.attributes.normal, center, size, count: geo.attributes.position.count };
    frames.set(mesh, f);
    return f;
  }

  function adjacency(frame) {
    if (frame.adj) return frame.adj;
    const { geo, pos, count } = frame;
    const sums = new Float32Array(count * 3);
    const cnt = new Uint32Array(count);
    const add = (a, b) => {
      sums[a * 3] += pos.getX(b); sums[a * 3 + 1] += pos.getY(b); sums[a * 3 + 2] += pos.getZ(b);
      cnt[a]++;
    };
    const idx = geo.index;
    if (idx) {
      for (let f = 0; f < idx.count; f += 3) {
        const a = idx.getX(f), b = idx.getX(f + 1), c = idx.getX(f + 2);
        add(a, b); add(a, c); add(b, a); add(b, c); add(c, a); add(c, b);
      }
    } else {
      // Non-indexed: bucket by a coarse grid and average the 27 neighbouring cells.
      const cell = Math.max(frame.size.x, frame.size.y, frame.size.z) / 64 || 1;
      const map = new Map();
      const key = (x, y, z) => x + "," + y + "," + z;
      for (let i = 0; i < count; i++) {
        const k = key(Math.floor((pos.getX(i) - frame.center.x) / cell), Math.floor((pos.getY(i) - frame.center.y) / cell), Math.floor((pos.getZ(i) - frame.center.z) / cell));
        let bucket = map.get(k);
        if (!bucket) map.set(k, (bucket = []));
        bucket.push(i);
      }
      for (let i = 0; i < count; i++) {
        const cx = Math.floor((pos.getX(i) - frame.center.x) / cell);
        const cy = Math.floor((pos.getY(i) - frame.center.y) / cell);
        const cz = Math.floor((pos.getZ(i) - frame.center.z) / cell);
        for (let dx = -1; dx <= 1; dx++)
          for (let dy = -1; dy <= 1; dy++)
            for (let dz = -1; dz <= 1; dz++) {
              const bucket = map.get(key(cx + dx, cy + dy, cz + dz));
              if (!bucket) continue;
              for (const j of bucket) if (j !== i) add(i, j);
            }
      }
    }
    frame.adj = { sums, cnt };
    return frame.adj;
  }

  function meanRadius(frame) {
    if (frame.meanR != null) return frame.meanR;
    let sum = 0;
    const p = frame.pos;
    for (let i = 0; i < frame.count; i++) {
      const dx = p.getX(i) - frame.center.x, dy = p.getY(i) - frame.center.y, dz = p.getZ(i) - frame.center.z;
      sum += Math.sqrt(dx * dx + dy * dy + dz * dz);
    }
    frame.meanR = frame.count ? sum / frame.count : 0;
    return frame.meanR;
  }

  /* ---- procedural shapes ------------------------------------------------------- */

  function proceduralDeltas(kind, frame, amount) {
    const { pos, nor, center, size, count } = frame;
    const out = new Float32Array(count * 3);
    const hx = Math.max(Math.abs(size.x) / 2, 1e-6);
    const hy = Math.max(Math.abs(size.y) / 2, 1e-6);
    const hz = Math.max(Math.abs(size.z) / 2, 1e-6);
    const mean = (hx + hy + hz) / 3;
    const adj = kind === "smooth" ? adjacency(frame) : null;
    const R = kind === "spherify" ? meanRadius(frame) : 0;

    for (let i = 0; i < count; i++) {
      const px = pos.getX(i), py = pos.getY(i), pz = pos.getZ(i);
      const nx = (px - center.x) / hx, ny = (py - center.y) / hy, nz = (pz - center.z) / hz;
      let dx = 0, dy = 0, dz = 0;

      switch (kind) {
        case "inflate":
        case "deflate": {
          const s = amount * mean * (kind === "inflate" ? 1 : -1);
          dx = nor.getX(i) * s; dy = nor.getY(i) * s; dz = nor.getZ(i) * s;
          break;
        }
        case "taper": {
          const f = 1 - amount * (ny + 1) * 0.5;
          dx = (px - center.x) * (f - 1);
          dz = (pz - center.z) * (f - 1);
          break;
        }
        case "twist": {
          const a = amount * ny * (Math.PI / 3);
          const c = Math.cos(a), s = Math.sin(a);
          const x = px - center.x, z = pz - center.z;
          dx = x * c - z * s - x;
          dz = x * s + z * c - z;
          break;
        }
        case "bend": {
          const a = amount * ny * (Math.PI / 2.5);
          const c = Math.cos(a), s = Math.sin(a);
          const x = px - center.x, y = py - center.y;
          dx = x * c - y * s - x;
          dy = x * s + y * c - y;
          break;
        }
        case "stretch": {
          dy = (py - center.y) * amount;
          break;
        }
        case "slim": {
          dx = (px - center.x) * -amount;
          dz = (pz - center.z) * -amount;
          break;
        }
        case "smooth": {
          if (adj && adj.cnt[i]) {
            const ax = adj.sums[i * 3] / adj.cnt[i];
            const ay = adj.sums[i * 3 + 1] / adj.cnt[i];
            const az = adj.sums[i * 3 + 2] / adj.cnt[i];
            dx = (ax - px) * amount;
            dy = (ay - py) * amount;
            dz = (az - pz) * amount;
          }
          break;
        }
        case "spherify": {
          const x = px - center.x, y = py - center.y, z = pz - center.z;
          const r = Math.sqrt(x * x + y * y + z * z);
          if (r > 1e-6) {
            const k = (R / r - 1) * amount;
            dx = x * k; dy = y * k; dz = z * k;
          }
          break;
        }
        case "muscle": {
          const w = gauss(Math.abs(nx) - 0.55, 0.3) * gauss(ny - 0.05, 0.55);
          const s = amount * mean * w;
          dx = nor.getX(i) * s; dy = nor.getY(i) * s; dz = nor.getZ(i) * s;
          break;
        }
        default:
          break;
      }
      out[i * 3] = dx; out[i * 3 + 1] = dy; out[i * 3 + 2] = dz;
    }
    return out;
  }

  /* ---- rig-aware shapes -------------------------------------------------------- */

  function importantBones(info) {
    const picks = [];
    for (let i = 0; i < info.names.length; i++) {
      const name = info.names[i];
      const cls = info.classes[i];
      if (cls === "tail" || cls === "other" || cls === "muscle") continue;
      if (SKIP_RE.test(name)) continue;
      const depth = boneDepth(info, i);
      const score = (JOINT_RE.test(name) ? 2 : 0) + (cls === "arm" || cls === "leg" ? 1 : 0) + (depth < 3 ? 0.5 : 0);
      picks.push({ i, name, cls, score, depth });
    }
    picks.sort((a, b) => b.score - a.score || a.depth - b.depth);
    return picks.slice(0, 12);
  }

  function boneDepth(info, i) {
    let d = 0, p = info.parent[i];
    while (p >= 0 && d < 50) { d++; p = info.parent[p]; }
    return d;
  }

  function boneSegLocal(mesh, info, i) {
    const bone = info.bones[i];
    const headW = bone.getWorldPosition(new Vector3());
    let tailW;
    const kids = info.children[i];
    if (kids && kids.length) tailW = info.bones[kids[0]].getWorldPosition(new Vector3());
    else {
      const q = bone.getWorldQuaternion(new Quaternion());
      tailW = new Vector3(0, 1, 0).applyQuaternion(q).multiplyScalar(Math.max(bone.position.length(), 0.05)).add(headW);
    }
    const inv = new Matrix4().copy(mesh.matrixWorld).invert();
    const head = headW.clone().applyMatrix4(inv);
    const tail = tailW.clone().applyMatrix4(inv);
    const axis = tail.clone().sub(head);
    const len = axis.length();
    if (len < 1e-6) return null;
    axis.divideScalar(len);
    return { head, tail, axis, len };
  }

  function flexDeltas(mesh, info, i, amount) {
    const seg = boneSegLocal(mesh, info, i);
    if (!seg) return null;
    const frame = frameOf(mesh);
    const { pos, count, size } = frame;
    const mean = (Math.abs(size.x) + Math.abs(size.y) + Math.abs(size.z)) / 6 || 1;
    const radius = Math.max(seg.len * 1.6, mean * 0.75);
    const angle = amount * (Math.PI / 2.2);
    let bendAxis = new Vector3().crossVectors(seg.axis, new Vector3(0, 1, 0));
    if (bendAxis.lengthSq() < 1e-8) bendAxis.set(1, 0, 0);
    bendAxis.normalize();
    const out = new Float32Array(count * 3);
    let moved = 0;
    for (let v = 0; v < count; v++) {
      const rel = new Vector3(pos.getX(v) - seg.head.x, pos.getY(v) - seg.head.y, pos.getZ(v) - seg.head.z);
      const along = rel.dot(seg.axis);
      const t = along / seg.len;
      if (t < -0.3 || t > 2.2) continue;
      const perp = new Vector3().copy(rel).addScaledVector(seg.axis, -along);
      const dist = perp.length();
      if (dist > radius) continue;
      const w = smoothstep(-0.3, 0.15, t) * smoothstep(2.2, 1.0, t) * smoothstep(radius, radius * 0.35, dist);
      if (w <= 1e-4) continue;
      const a = angle * w;
      const c = Math.cos(a), s = Math.sin(a);
      // Rodrigues rotation of `rel` about the unit `bendAxis`.
      const dot = rel.dot(bendAxis);
      const cross = new Vector3().crossVectors(bendAxis, rel);
      const rot = new Vector3(
        rel.x * c + cross.x * s + bendAxis.x * dot * (1 - c),
        rel.y * c + cross.y * s + bendAxis.y * dot * (1 - c),
        rel.z * c + cross.z * s + bendAxis.z * dot * (1 - c)
      );
      out[v * 3] = rot.x - rel.x;
      out[v * 3 + 1] = rot.y - rel.y;
      out[v * 3 + 2] = rot.z - rel.z;
      moved++;
    }
    return moved ? out : null;
  }

  function bulgeDeltas(mesh, info, i, amount) {
    const seg = boneSegLocal(mesh, info, i);
    if (!seg) return null;
    const frame = frameOf(mesh);
    const { pos, count, size } = frame;
    const mean = (Math.abs(size.x) + Math.abs(size.y) + Math.abs(size.z)) / 6 || 1;
    const radius = Math.max(seg.len * 1.1, mean * 0.6);
    const out = new Float32Array(count * 3);
    let moved = 0;
    for (let v = 0; v < count; v++) {
      const rel = new Vector3(pos.getX(v) - seg.head.x, pos.getY(v) - seg.head.y, pos.getZ(v) - seg.head.z);
      const along = rel.dot(seg.axis);
      const t = along / seg.len;
      if (t < -0.2 || t > 1.2) continue;
      const perp = new Vector3().copy(rel).addScaledVector(seg.axis, -along);
      const dist = perp.length();
      if (dist < 1e-5 || dist > radius) continue;
      const w = smoothstep(-0.2, 0.1, t) * smoothstep(1.2, 0.6, t) * smoothstep(radius, radius * 0.3, dist);
      if (w <= 1e-4) continue;
      const s = amount * mean * 0.18 * w;
      perp.divideScalar(dist);
      out[v * 3] = perp.x * s;
      out[v * 3 + 1] = perp.y * s;
      out[v * 3 + 2] = perp.z * s;
      moved++;
    }
    return moved ? out : null;
  }

  /* ---- public operations ------------------------------------------------------- */

  function commit(name, deltasByMesh, kind) {
    let added = 0;
    for (const [mesh, deltas] of deltasByMesh) {
      if (addMorph(mesh, name, deltas)) added++;
    }
    if (!added) return false;
    owned.add(name);
    meta.set(name, { kind, created: Date.now() });
    if (!weights.has(name)) weights.set(name, 0);
    applyWeights();
    changed();
    return true;
  }

  function autoShape(ids, opts = {}) {
    const list = meshes();
    if (!list.length) {
      say("Load a model first", 2400);
      return 0;
    }
    let wanted;
    if (!ids || ids === "all" || (Array.isArray(ids) && !ids.length)) wanted = AUTO_SHAPE_IDS;
    else if (typeof ids === "string") wanted = [ids];
    else wanted = ids;
    let made = 0;
    for (const id of wanted) {
      const spec = AUTO_SHAPES.find((s) => s.id === id);
      if (!spec) continue;
      const amount = opts.amount != null ? opts.amount : spec.amount;
      const deltasByMesh = new Map();
      for (const mesh of list) {
        const frame = frameOf(mesh);
        deltasByMesh.set(mesh, proceduralDeltas(id, frame, amount));
      }
      if (commit(KEY_PREFIX + spec.label, deltasByMesh, id)) made++;
    }
    say(made ? "Generated " + made + " auto shape" + (made === 1 ? "" : "s") : "Nothing to shape", 2600);
    return made;
  }

  function autoShapeKeys(opts = {}) {
    const r = root();
    const list = meshes();
    if (!r || !list.length) {
      say("Load a model first", 2400);
      return { count: 0, rigged: false };
    }
    r.updateMatrixWorld(true);
    const info = analyzeRig(r);
    if (!info) {
      say("No skeleton found \u2014 forge a metarig or import a rigged model first", 3200);
      return { count: 0, rigged: false };
    }
    const picks = importantBones(info);
    if (!picks.length) {
      say("Skeleton has no bendable joints to key", 2800);
      return { count: 0, rigged: true };
    }
    const amount = opts.amount != null ? opts.amount : 1;
    let made = 0;
    for (const p of picks) {
      const flexByMesh = new Map();
      for (const mesh of list) {
        const d = flexDeltas(mesh, info, p.i, amount);
        if (d) flexByMesh.set(mesh, d);
      }
      if (commit(RIG_PREFIX + "Flex " + p.name, flexByMesh, "flex")) made++;

      const bulgeByMesh = new Map();
      for (const mesh of list) {
        const d = bulgeDeltas(mesh, info, p.i, amount);
        if (d) bulgeByMesh.set(mesh, d);
      }
      if (commit(RIG_PREFIX + "Bulge " + p.name, bulgeByMesh, "bulge")) made++;
    }
    say(made ? "Generated " + made + " rig shape keys" : "Could not build rig shapes", 3000);
    return { count: made, rigged: true, bones: picks.length };
  }

  function setWeight(name, value) {
    const v = Number.isFinite(value) ? value : 0;
    weights.set(name, v);
    for (const mesh of meshes()) {
      if (!mesh.morphTargetInfluences) continue;
      const names = morphNames(mesh);
      const idx = names.indexOf(name);
      if (idx !== -1) mesh.morphTargetInfluences[idx] = v;
    }
    changed();
    return v;
  }

  function getWeight(name) {
    let v = weights.has(name) ? weights.get(name) : 0;
    for (const mesh of meshes()) {
      const names = morphNames(mesh);
      const idx = names.indexOf(name);
      if (idx !== -1 && mesh.morphTargetInfluences && Math.abs(mesh.morphTargetInfluences[idx]) > Math.abs(v)) v = mesh.morphTargetInfluences[idx];
    }
    return v;
  }

  function list() {
    const seen = new Map();
    for (const mesh of meshes()) {
      const names = morphNames(mesh);
      for (const n of names) {
        if (!seen.has(n)) seen.set(n, { name: n, own: owned.has(n), kind: meta.get(n) ? meta.get(n).kind : "imported", meshes: 0 });
        seen.get(n).meshes++;
      }
    }
    const out = [];
    for (const e of seen.values()) out.push({ name: e.name, own: e.own, kind: e.kind, meshes: e.meshes, value: getWeight(e.name) });
    out.sort((a, b) => (a.own === b.own ? a.name.localeCompare(b.name) : a.own ? -1 : 1));
    return out;
  }

  function reset() {
    for (const mesh of meshes()) {
      if (!mesh.morphTargetInfluences) continue;
      for (let i = 0; i < mesh.morphTargetInfluences.length; i++) mesh.morphTargetInfluences[i] = 0;
    }
    for (const k of weights.keys()) weights.set(k, 0);
    changed();
  }

  function remove(name) {
    let removed = false;
    for (const mesh of meshes()) if (removeMorph(mesh, name)) removed = true;
    if (removed) {
      owned.delete(name);
      meta.delete(name);
      weights.delete(name);
      changed();
    }
    return removed;
  }

  function clear() {
    for (const mesh of meshes()) {
      const base = baseline.get(mesh);
      if (!base) continue;
      const geo = mesh.geometry;
      if (!geo.morphAttributes) geo.morphAttributes = {};
      geo.morphAttributes.position = base.morphs.slice();
      if (!geo.morphAttributes.position.length) delete geo.morphAttributes.position;
      mesh.morphTargetsRelative = base.relative;
      syncMorphs(mesh);
      if (mesh.morphTargetInfluences) for (let i = 0; i < mesh.morphTargetInfluences.length; i++) mesh.morphTargetInfluences[i] = 0;
      markMaterial(mesh);
    }
    owned.clear();
    meta.clear();
    weights.clear();
    changed();
    return true;
  }

  function info() {
    const list_ = meshes();
    let verts = 0, morphs = 0;
    for (const m of list_) {
      verts += m.geometry.attributes.position.count;
      morphs += morphNames(m).length;
    }
    const keys = list();
    return { meshes: list_.length, vertices: verts, morphTargets: morphs, shapes: keys.filter((k) => k.own).length, imported: keys.filter((k) => !k.own).length, hasMesh: list_.length > 0 };
  }

  return {
    meshes,
    info,
    list,
    autoShape,
    autoShapeKeys,
    setWeight,
    getWeight,
    reset,
    remove,
    clear,
    invalidate() {
      for (const m of meshes()) frames.delete(m);
    },
    get shapes() {
      return list();
    },
  };
}
