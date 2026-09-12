/*
 * Auto-armature — build a rig for a model that doesn't have one.
 *
 * The app already understands a rig that *arrives* with a file (armature.js) and can
 * author motion on it (motion.js / anim-author.js). This module closes the loop: it
 * forges a humanoid skeleton fitted to the stage mesh, then links the mesh to it with
 * automatic proximity weights. From then on the model behaves like any imported rig —
 * the Armature workspace shows it, Motion drives it, Shape Keys can key it, and the
 * GLB exporter writes the skin + joints.
 *
 * Three primitives, each usable alone:
 *
 *   analyzeBody(root)          measure the mesh: box, height, stance, pose spread
 *   humanoidSpec(opts)         a Mixamo/Rigify-style bone spec fitted to that box
 *   bonesFromSpec(spec)        the spec as a real THREE.Bone hierarchy
 *   boneSegments(bones)        bind-pose joint positions, as capsules (for weighting)
 *   bindMeshAuto(mesh, skel)   a SkinnedMesh with 4-influence automatic weights
 *   createAutoArmature({…})    the whole recipe (forge → bind → remove) as one object
 *
 * Bone names follow the Mixamo convention on purpose: armature.js `classifyBone` then
 * maps them to spine / head / arm / leg roles with no special-casing, which is what
 * motion.js and shape-keys.js key off.
 */

import { THREE } from "./three.js";

const { Vector3, Quaternion, Matrix4, Float32BufferAttribute } = THREE;

/* Bone positions as fractions of the model height H, measured up from the feet.
   They reproduce the classic 8-head human proportion and are the defaults every
   fitter blends toward, so a mesh with an unusual silhouette still gets a sane rig. */
export const HUMANOID_LANDMARKS = {
  root: 0.52,
  spineStart: 0.585,
  chest: 0.735,
  neck: 0.845,
  head: 0.885,
  shoulder: 0.8,
  shoulderX: 0.085,
  hipX: 0.055,
  knee: 0.28,
  ankle: 0.045,
  toeY: 0.028,
  toeZ: 0.085,
  upperArm: 0.17,
  foreArm: 0.16,
  hand: 0.05,
};

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

/* --------------------------------------------------------------- body analysis */

/*
 * Measures the visible geometry under `root` and returns everything the fitter needs.
 * Cheap: it uses each mesh's bounding-box corners, not its vertices, except for the
 * one stance pass that samples the bottom band.
 *
 *   { box, size, center, baseY, cx, cz, height, width, depth, aspect, armSpread, legStance }
 *
 * `armSpread` (0..1) estimates how far the arms leave the body from the width/height
 * ratio — arms-down gets ~0, a T-pose ~1 — and `legStance` is the half-width of the
 * feet, so a wide-stance sculpt gets a matching leg splay.
 */
export function analyzeBody(root) {
  if (!root) return null;
  root.updateMatrixWorld(true);

  const box = new THREE.Box3();
  const corner = new Vector3();
  const meshes = [];
  root.traverse((o) => {
    if (!o.isMesh || !o.geometry) return;
    if (o.userData && o.userData.autoArmature) return;
    if (o.visible === false && !o.isSkinnedMesh) return;
    const g = o.geometry;
    if (!g.attributes || !g.attributes.position) return;
    if (!g.boundingBox) g.computeBoundingBox();
    const bb = g.boundingBox;
    if (!bb || bb.isEmpty()) return;
    for (let i = 0; i < 8; i++) {
      corner
        .set(i & 1 ? bb.max.x : bb.min.x, i & 2 ? bb.max.y : bb.min.y, i & 4 ? bb.max.z : bb.min.z)
        .applyMatrix4(o.matrixWorld);
      box.expandByPoint(corner);
    }
    meshes.push(o);
  });
  if (!meshes.length || box.isEmpty()) return null;

  const size = box.getSize(new Vector3());
  const center = box.getCenter(new Vector3());
  const height = Math.max(size.y, 1e-4);
  const baseY = box.min.y;
  const cx = center.x;
  const cz = center.z;

  const aspect = size.x / height;

  /* One vertex pass yields two silhouettes: the foot stance (lateral spread just above
     the floor, skipping a plinth or flared base) and a per-height lateral profile from
     which `armSpread` is read. The profile matters because overall width/height says
     nothing about the arms — a wide relief plane and a T-pose are both merely "wide" —
     whereas the ratio of the shoulder band to the hip band separates arms-down (~1) from
     arms-out (3–5). */
  const BANDS = 20;
  const bandMax = new Float32Array(BANDS);
  const bandLo = baseY + height * 0.02;
  const bandHi = baseY + height * 0.09;
  let stance = 0;
  let sampled = 0;
  let profiled = 0;
  const v = new Vector3();
  for (const mesh of meshes) {
    const pos = mesh.geometry.attributes.position;
    const step = pos.count > 60000 ? 4 : pos.count > 20000 ? 2 : 1;
    for (let i = 0; i < pos.count; i += step) {
      v.fromBufferAttribute(pos, i).applyMatrix4(mesh.matrixWorld);
      const dev = Math.abs(v.x - cx);
      const bi = clamp(Math.floor(((v.y - baseY) / height) * BANDS), 0, BANDS - 1);
      if (dev > bandMax[bi]) bandMax[bi] = dev;
      profiled++;
      if (v.y < bandLo || v.y > bandHi) continue;
      if (dev > stance) stance = dev;
      sampled++;
    }
  }
  const bandRange = (a, b) => {
    let m = 0;
    const i0 = clamp(Math.floor(a * BANDS), 0, BANDS - 1);
    const i1 = clamp(Math.ceil(b * BANDS) - 1, 0, BANDS - 1);
    for (let i = i0; i <= i1; i++) if (bandMax[i] > m) m = bandMax[i];
    return m;
  };
  const hipHalf = bandRange(0.42, 0.56);
  const shoulderHalf = bandRange(0.62, 0.86);
  const spreadRatio = hipHalf > 1e-6 ? shoulderHalf / hipHalf : 1;
  let armSpread = clamp((spreadRatio - 1.3) / 3, 0, 1);
  if (!profiled) armSpread = clamp((aspect - 0.28) / 0.5, 0, 1);

  const ankleFrac = sampled ? stance / height : 0;
  const legStance = clamp(ankleFrac - HUMANOID_LANDMARKS.hipX, 0, 0.12);

  return {
    box,
    size,
    center,
    baseY,
    cx,
    cz,
    height,
    width: size.x,
    depth: size.z,
    aspect,
    armSpread,
    legStance,
  };
}

/* ------------------------------------------------------------- humanoid spec */

/*
 * A flat [{name, parent, pos}] spec of a standing humanoid, anchored to the feet
 * (`baseY`) and centred on `cx`/`cz`. `height` is the model height. The defaults match
 * HUMANOID_LANDMARKS; pass `landmarks` to override any fraction of the height.
 *
 * Returns absolute positions, so the caller can hand the result straight to
 * bonesFromSpec (which converts them to parent-relative local positions).
 */
export function humanoidSpec(opts = {}) {
  const H = opts.height ?? 1.8;
  const baseY = opts.baseY ?? 0;
  const cx = opts.cx ?? 0;
  const cz = opts.cz ?? 0;
  const spineCount = clamp(Math.round(opts.spine ?? 3), 1, 4);
  const armSpread = clamp(opts.armSpread ?? 0.35, 0, 1);
  const legStance = clamp(opts.legStance ?? 0.06, 0, 0.25);
  const fingers = !!opts.fingers;
  const toes = opts.toes !== false;
  const L = Object.assign({}, HUMANOID_LANDMARKS, opts.landmarks || {});

  const V = (x, f, z) => new Vector3(cx + x * H, baseY + f * H, cz + z * H);
  const spec = [];
  const add = (name, parent, pos) => spec.push({ name, parent, pos });

  /* Spine: Root(hips) → Spine → … → chest. */
  add("Root", null, V(0, L.root, 0));
  let prev = "Root";
  for (let i = 1; i <= spineCount; i++) {
    const name = i === 1 ? "Spine" : "Spine" + (i - 1);
    const f =
      spineCount <= 1
        ? L.chest
        : L.spineStart + ((i - 1) * (L.chest - L.spineStart)) / (spineCount - 1);
    add(name, prev, V(0, f, 0));
    prev = name;
  }
  const chest = prev;
  add("Neck", chest, V(0, L.neck, 0));
  add("Head", "Neck", V(0, L.head, 0));

  /* Arms: shoulder joint inside the body, then upper arm → forearm → hand, angled
     outward in proportion to `armSpread` (A-pose at 0, near T-pose at 1). */
  const armAngle = 0.16 + armSpread * 0.72;
  for (const side of [-1, 1]) {
    const tag = side < 0 ? "Left" : "Right";
    const shoulder = V(side * L.shoulderX, L.shoulder, 0);
    const elbow = new Vector3(
      shoulder.x + side * Math.sin(armAngle) * L.upperArm * H,
      shoulder.y - Math.cos(armAngle) * L.upperArm * H,
      shoulder.z,
    );
    const wrist = new Vector3(
      elbow.x + side * Math.sin(armAngle) * L.foreArm * H,
      elbow.y - Math.cos(armAngle) * L.foreArm * H,
      elbow.z,
    );
    const handEnd = new Vector3(
      wrist.x + side * Math.sin(armAngle) * L.hand * H,
      wrist.y - Math.cos(armAngle) * L.hand * H,
      wrist.z,
    );
    add(tag + "Shoulder", chest, shoulder);
    add(tag + "Arm", tag + "Shoulder", elbow);
    add(tag + "ForeArm", tag + "Arm", wrist);
    add(tag + "Hand", tag + "ForeArm", handEnd);
    if (fingers) {
      ["Thumb", "Index", "Middle", "Ring", "Pinky"].forEach((fn, k) => {
        const across = (k - 2) * 0.016 * H;
        add(
          tag + "Hand" + fn + "1",
          tag + "Hand",
          new Vector3(handEnd.x + side * across * 0.4, handEnd.y - 0.012 * H, handEnd.z + across),
        );
      });
    }

    /* Legs: hips → knee → ankle → toe, splaying by `legStance`. */
    const hip = V(side * L.hipX, L.root, 0);
    const knee = V(side * (L.hipX + legStance * 0.5), L.knee, 0);
    const ankle = V(side * (L.hipX + legStance), L.ankle, 0);
    add(tag + "UpLeg", "Root", hip);
    add(tag + "Leg", tag + "UpLeg", knee);
    add(tag + "Foot", tag + "Leg", ankle);
    if (toes) add(tag + "ToeBase", tag + "Foot", V(side * (L.hipX + legStance), L.toeY, L.toeZ));
  }
  return spec;
}

/* Turns the flat spec into a real THREE.Bone hierarchy (absolute positions become
   parent-relative local positions). The running absolute positions are kept in a local Map,
   not in `userData`, so nothing extra leaks into the GLB `extras` on export.
 *
 * Two OPTIONAL per-entry extras let a decorator (the muscle rig) shape bones the plain
 * humanoid spec can't express: `dir` (a Vector3 the bone's +Y should point along) and
 * `len` (an explicit length for a childless bone, so its weighting capsule is the belly
 * it describes rather than "half the parent"). A custom `__autoLen` property holds the
 * length — not `userData` — so it never reaches the exporter. */
export function bonesFromSpec(spec) {
  const byName = new Map();
  const abs = new Map();
  const bones = [];
  const UP = new Vector3(0, 1, 0);
  for (const n of spec) {
    const b = new THREE.Bone();
    b.name = n.name;
    const parent = n.parent ? byName.get(n.parent) : null;
    b.position.copy(n.pos);
    if (parent) b.position.sub(abs.get(n.parent));
    abs.set(n.name, n.pos);
    if (n.dir && n.dir.lengthSq && n.dir.lengthSq() > 1e-12) {
      b.quaternion.setFromUnitVectors(UP, n.dir.clone().normalize());
    }
    if (Number.isFinite(n.len) && n.len > 0) b.__autoLen = n.len;
    if (n.muscle) b.__muscle = true;
    if (parent) parent.add(b);
    byName.set(n.name, b);
    bones.push(b);
  }
  return { root: bones[0], bones, byName };
}

/* ------------------------------------------------------------- weight binding */

/*
 * Each bone as a capsule in world space: { head, tail, len } flat arrays plus a
 * firstChild map. A childless bone is extended along its own +Y by half its parent's
 * length (or `fallbackLen`), so leaf regions — hands, toes, the head — still own their
 * geometry instead of losing it to the nearest joint.
 */
export function boneSegments(bones, fallbackLen = 0.1) {
  const n = bones.length;
  const head = new Float32Array(n * 3);
  const tail = new Float32Array(n * 3);
  const len = new Float32Array(n);
  const childOf = new Int32Array(n).fill(-1);
  const indexOf = new Map();
  bones.forEach((b, i) => indexOf.set(b, i));

  const p = new Vector3();
  for (let i = 0; i < n; i++) {
    p.setFromMatrixPosition(bones[i].matrixWorld);
    head[i * 3] = p.x;
    head[i * 3 + 1] = p.y;
    head[i * 3 + 2] = p.z;
  }
  for (let i = 0; i < n; i++) {
    const j = indexOf.has(bones[i].parent) ? indexOf.get(bones[i].parent) : -1;
    if (j >= 0 && childOf[j] === -1) childOf[j] = i;
  }
  for (let i = 0; i < n; i++) {
    const c = childOf[i];
    if (c < 0) continue;
    const dx = head[c * 3] - head[i * 3];
    const dy = head[c * 3 + 1] - head[i * 3 + 1];
    const dz = head[c * 3 + 2] - head[i * 3 + 2];
    len[i] = Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  const q = new Quaternion();
  const dir = new Vector3();
  for (let i = 0; i < n; i++) {
    const c = childOf[i];
    if (c >= 0) {
      tail[i * 3] = head[c * 3];
      tail[i * 3 + 1] = head[c * 3 + 1];
      tail[i * 3 + 2] = head[c * 3 + 2];
      continue;
    }
    const j = indexOf.has(bones[i].parent) ? indexOf.get(bones[i].parent) : -1;
    len[i] = j >= 0 && len[j] > 1e-6 ? len[j] * 0.5 : Math.max(fallbackLen, 1e-4);
    /* A decorator (muscle rig) can pin a leaf's length explicitly (see bonesFromSpec). */
    if (Number.isFinite(bones[i].__autoLen)) len[i] = Math.max(bones[i].__autoLen, 1e-4);
    bones[i].getWorldQuaternion(q);
    dir.set(0, 1, 0).applyQuaternion(q).multiplyScalar(len[i]);
    tail[i * 3] = head[i * 3] + dir.x;
    tail[i * 3 + 1] = head[i * 3 + 1] + dir.y;
    tail[i * 3 + 2] = head[i * 3 + 2] + dir.z;
  }
  return { head, tail, len, childOf, count: n };
}

function pointSegDistSq(px, py, pz, ax, ay, az, bx, by, bz) {
  const abx = bx - ax, aby = by - ay, abz = bz - az;
  const apx = px - ax, apy = py - ay, apz = pz - az;
  const ab2 = abx * abx + aby * aby + abz * abz;
  let t = ab2 > 1e-12 ? (apx * abx + apy * aby + apz * abz) / ab2 : 0;
  t = t < 0 ? 0 : t > 1 ? 1 : t;
  const dx = px - (ax + abx * t);
  const dy = py - (ay + aby * t);
  const dz = pz - (az + abz * t);
  return dx * dx + dy * dy + dz * dz;
}

/*
 * Clone `mesh`'s geometry and give it 4-influence skin weights: every vertex is
 * weighted to the 4 nearest bone capsules by inverse-square distance. Working
 * against segments (not joint points) is what makes limbs bend along their length
 * instead of collapsing to the elbow, which is the difference between a toy rig and
 * one that actually deforms.
 *
 * The clone keeps the mesh's transform, morph targets and materials; the original is
 * left untouched so `remove()` can restore it. `segs` is a boneSegments result for the
 * skeleton being bound to.
 */
export function bindMeshAuto(mesh, skeleton, segs, opts = {}) {
  if (!mesh || !mesh.geometry || !segs || !segs.count) return null;
  const src = mesh.geometry;
  const pos0 = src.attributes.position;
  if (!pos0 || !pos0.count) return null;
  const power = opts.power != null ? opts.power : 2;
  const eps = 1e-6;
  /* A muscle rig marks its belly bones (`__muscle`). Those must stay a SECONDARY layer:
     proximity alone would hand a muscle bone most of the weight near the surface (it sits
     on the skin, the real bone runs through the centre), and a belly that out-votes the
     limb bones tears the joint apart when it swells. So base bones are ranked first, a
     single muscle may take one influence, and the muscle's total share is capped — the
     base skeleton always keeps at least (1 - muscleMax). Plain rigs have no muscle bones
     and take the original path unchanged. */
  const muscleMax = opts.muscleMax != null ? clamp(opts.muscleMax, 0, 1) : 0.6;
  const bonesRef = skeleton && skeleton.bones ? skeleton.bones : null;
  const hasMuscles = !!(bonesRef && bonesRef.some((b) => b && b.__muscle));

  const geo = src.clone();
  const count = geo.attributes.position.count;
  const idx = new Uint16Array(count * 4);
  const wgt = new Float32Array(count * 4);
  const m = new Matrix4().copy(mesh.matrixWorld);
  const v = new Vector3();
  const bestI = [0, 0, 0, 0];
  const bestD = [Infinity, Infinity, Infinity, Infinity];
  const { head, tail, count: nb } = segs;

  for (let i = 0; i < count; i++) {
    v.fromBufferAttribute(geo.attributes.position, i).applyMatrix4(m);
    bestI[0] = bestI[1] = bestI[2] = bestI[3] = 0;
    bestD[0] = bestD[1] = bestD[2] = bestD[3] = Infinity;
    let musD = Infinity;
    let musI = -1;
    let baseRawSum = 0;
    for (let j = 0; j < nb; j++) {
      const d = pointSegDistSq(
        v.x, v.y, v.z,
        head[j * 3], head[j * 3 + 1], head[j * 3 + 2],
        tail[j * 3], tail[j * 3 + 1], tail[j * 3 + 2],
      );
      if (hasMuscles) {
        const raw = Number.isFinite(d) ? 1 / (Math.pow(d, power / 2) + eps) : 0;
        if (bonesRef[j] && bonesRef[j].__muscle) {
          if (d < musD) {
            musD = d;
            musI = j;
          }
          continue;
        }
        baseRawSum += raw;
      }
      if (d >= bestD[3]) continue;
      let k = 3;
      while (k > 0 && d < bestD[k - 1]) {
        bestD[k] = bestD[k - 1];
        bestI[k] = bestI[k - 1];
        k--;
      }
      bestD[k] = d;
      bestI[k] = j;
    }
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const d = bestD[k];
      const w = Number.isFinite(d) ? 1 / (Math.pow(d, power / 2) + eps) : 0;
      idx[i * 4 + k] = bestI[k];
      wgt[i * 4 + k] = w;
      sum += w;
    }
    if (sum <= 0) {
      idx[i * 4] = 0;
      wgt[i * 4] = 1;
      continue;
    }
    for (let k = 0; k < 4; k++) wgt[i * 4 + k] /= sum;
    /* Secondary muscle pass: replace the weakest influence with the nearest belly, capped
       so the base skeleton always keeps at least (1 - muscleMax) of the weight. */
    if (hasMuscles && musI >= 0 && Number.isFinite(musD)) {
      const rawMus = 1 / (Math.pow(musD, power / 2) + eps);
      const denom = rawMus + baseRawSum;
      const share = denom > 0 ? muscleMax * (rawMus / denom) : 0;
      if (share > 1e-4) {
        for (let k = 0; k < 3; k++) wgt[i * 4 + k] *= 1 - share;
        idx[i * 4 + 3] = musI;
        wgt[i * 4 + 3] = wgt[i * 4 + 3] * (1 - share) + share;
      }
    }
  }

  geo.setAttribute("skinIndex", new THREE.BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(wgt, 4));

  const skinned = new THREE.SkinnedMesh(geo, mesh.material);
  skinned.name = (mesh.name || "mesh") + " \u00b7 armature";
  skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);
  skinned.scale.copy(mesh.scale);
  skinned.castShadow = mesh.castShadow;
  skinned.receiveShadow = mesh.receiveShadow;
  skinned.frustumCulled = false;
  mesh.parent.add(skinned);
  skinned.bind(skeleton);
  return skinned;
}

/* ---------------------------------------------------------------- controller */

/*
 * createAutoArmature({ getRoot, getRig, refreshRig, render, toast })
 *
 *   .forge(opts)     build the bone hierarchy (+ a hidden holder mesh that carries the
 *                    skeleton) fitted to the current model. Refuses on a model that
 *                    already has its own skeleton unless opts.force.
 *   .bind()          link every visible mesh with automatic weights
 *   .generate(opts)  forge + bind, i.e. the one-click auto-rig
 *   .remove()        unlink/restore, leaving the model as it was
 *   .state()         { bones, linked, hasArmature, rigBones, spine, fingers, toes }
 *
 * `refreshRig` is called after every change so the Armature workspace, Motion and the
 * Shape keys all see the new skeleton immediately.
 */
export function createAutoArmature({ getRoot, getRig, refreshRig, render, toast } = {}) {
  const say = (m, ms) => {
    if (typeof toast === "function") toast(m, ms);
  };

  let holder = null;
  let proxyGeometry = null;
  let proxyMaterial = null;
  let boneList = null;
  let skeleton = null;
  let segs = null;
  let bound = [];
  let fallbackLen = 0.1;
  let muscleMax = 0.6;
  let params = { spine: 3, fingers: false, toes: true };

  const root = () => (typeof getRoot === "function" ? getRoot() : null);
  const currentRig = () => (typeof getRig === "function" ? getRig() : null);

  /* `clearModel()` empties `modelGroup.children` by popping, which does NOT clear the
     child's `.parent` — so a stale armature still looks attached. Walk the real children
     arrays instead of trusting `.parent`. */
  function isAttached(node) {
    const r = root();
    let o = node;
    while (o) {
      if (o === r) return true;
      const p = o.parent;
      if (!p || p.children.indexOf(o) === -1) return false;
      o = p;
    }
    return false;
  }

  /* The stage model can be replaced under us; drop refs that no longer belong to it. */
  function sync() {
    if (holder && !isAttached(holder)) {
      if (proxyGeometry) proxyGeometry.dispose();
      if (proxyMaterial) proxyMaterial.dispose();
      proxyGeometry = null;
      proxyMaterial = null;
      holder = null;
      boneList = null;
      skeleton = null;
      segs = null;
    }
    if (bound.some((b) => !isAttached(b.skinned))) {
      bound = bound.filter((b) => isAttached(b.skinned));
    }
  }

  function ownsArmature() {
    return isAttached(holder);
  }

  function afterChange() {
    if (typeof refreshRig === "function") refreshRig();
    if (typeof render === "function") render();
  }

  function forge(opts = {}) {
    const r = root();
    sync();
    if (!r) {
      say("Load a model first", 2400);
      return { ok: false, reason: "no-model" };
    }
    const body = analyzeBody(r);
    if (!body) {
      say("Nothing to rig \u2014 no visible geometry", 2600);
      return { ok: false, reason: "no-body" };
    }
    const rig = currentRig();
    if (rig && rig.boneCount && !ownsArmature() && !opts.force) {
      say("This model already has a skeleton", 3000);
      return { ok: false, reason: "already-rigged", bones: rig.boneCount };
    }

    if (ownsArmature()) remove(true);

    const spine = clamp(Math.round(opts.spine != null ? opts.spine : params.spine), 1, 4);
    const fingers = opts.fingers != null ? !!opts.fingers : params.fingers;
    const toes = opts.toes != null ? !!opts.toes : params.toes;
    const armSpread = opts.armSpread != null ? clamp(opts.armSpread, 0, 1) : body.armSpread;
    const legStance = opts.legStance != null ? clamp(opts.legStance, 0, 0.25) : body.legStance;
    if (opts.muscleMax != null) muscleMax = clamp(opts.muscleMax, 0, 1);

    const spec = humanoidSpec({
      height: body.height,
      baseY: body.baseY,
      cx: body.cx,
      cz: body.cz,
      spine,
      fingers,
      toes,
      armSpread,
      legStance,
    });
    /* A decorator may extend the humanoid spec with extra bones (the Muscle rig appends one
       bone per muscle belly). It is handed the base spec + the body measurement, and the
       returned array replaces the spec when it is a non-empty array. */
    let finalSpec = spec;
    if (typeof opts.decorate === "function") {
      const decorated = opts.decorate(spec, body, { spine, fingers, toes, armSpread, legStance });
      if (Array.isArray(decorated) && decorated.length) finalSpec = decorated;
    }
    const built = bonesFromSpec(finalSpec);

    /* The armature root is a plain, VISIBLE Group. The GLB exporter runs with
       `onlyVisible:true` and skips invisible subtrees — hiding the bone parent would
       export a skin whose joints all resolve to null — so the bone hierarchy has to hang
       off something visible. Beneath it sits an invisible SkinnedMesh whose only job is to
       carry the skeleton into `findSkeletons` (armature.js looks for a SkinnedMesh) before
       the meshes are linked; hidden, it neither renders nor exports. */
    holder = new THREE.Group();
    holder.name = "AutoArmature";
    holder.userData.autoArmature = true;
    holder.add(built.root);
    r.add(holder);
    r.updateMatrixWorld(true);

    const proxyGeo = new THREE.BufferGeometry();
    proxyGeo.setAttribute("position", new Float32BufferAttribute([0, 0, 0], 3));
    /* A SkinnedMesh must carry skinIndex/skinWeight: three's SkinnedMesh.computeBoundingBox
       (reached by Box3.setFromObject, e.g. frameObject after forging) reads them through
       applyBoneTransform and throws "reading 'getX'" on a plain geometry. One vertex, fully
       weighted to bone 0, keeps the invisible proxy boxable. */
    proxyGeo.setAttribute("skinIndex", new Float32BufferAttribute([0, 0, 0, 0], 4));
    proxyGeo.setAttribute("skinWeight", new Float32BufferAttribute([1, 0, 0, 0], 4));
    proxyGeometry = proxyGeo;
    proxyMaterial = new THREE.MeshBasicMaterial({ visible: false });
    const proxy = new THREE.SkinnedMesh(proxyGeo, proxyMaterial);
    proxy.name = "AutoArmature \u00b7 bind";
    proxy.visible = false;
    proxy.frustumCulled = false;
    proxy.userData.autoArmature = true;
    holder.add(proxy);
    skeleton = new THREE.Skeleton(built.bones);
    proxy.bind(skeleton);
    boneList = built.bones;
    fallbackLen = body.height * 0.05;
    segs = boneSegments(boneList, fallbackLen);
    params = { spine, fingers, toes };

    afterChange();
    say("Auto-armature: " + boneList.length + " bones forged", 2600);
    return { ok: true, bones: boneList.length, body };
  }

  function bind() {
    const r = root();
    sync();
    if (!r || !skeleton || !boneList) {
      say("Forge an armature first", 2400);
      return { ok: false, reason: "no-armature" };
    }
    r.updateMatrixWorld(true);
    if (!segs) segs = boneSegments(boneList, fallbackLen);

    const targets = [];
    r.traverse((o) => {
      if (!o.isMesh) return;
      if (o.userData && o.userData.autoArmature) return;
      if (bound.some((b) => b.skinned === o)) return;
      if (o.visible === false && !o.isSkinnedMesh) return;
      if (!o.geometry || !o.geometry.attributes || !o.geometry.attributes.position) return;
      if (!o.geometry.attributes.position.count) return;
      targets.push(o);
    });

    let linked = 0;
    for (const mesh of targets) {
      const prev = bound.find((b) => b.mesh === mesh);
      if (prev) {
        if (prev.skinned && prev.skinned.parent) prev.skinned.parent.remove(prev.skinned);
        if (prev.skinned && prev.skinned.geometry) prev.skinned.geometry.dispose();
        bound = bound.filter((b) => b !== prev);
      }
      try {
        const skinned = bindMeshAuto(mesh, skeleton, segs, { muscleMax });
        if (skinned) {
          /* A mesh that arrived with its own skeleton is taken OUT of the graph rather than
             merely hidden: `findSkeletons` reads the graph regardless of visibility, so
             hiding it would leave the old rig as the "active" one (most bones wins) while
             our weights drive nothing the overlay can see. Detaching makes the auto-armature
             the active rig; `remove()` re-attaches the original. */
          let detached = null;
          if (mesh.isSkinnedMesh && mesh.parent) {
            detached = mesh.parent;
            detached.remove(mesh);
          } else {
            mesh.visible = false;
          }
          bound.push({ mesh, skinned, parent: detached });
          linked++;
        }
      } catch (e) {
        console.warn("[auto-armature] bind failed", e);
      }
    }
    afterChange();
    say(
      linked
        ? "Linked " + linked + " mesh" + (linked === 1 ? "" : "es") + " with automatic weights"
        : "No mesh to link",
      2800,
    );
    return { ok: linked > 0, linked };
  }

  function generate(opts) {
    const f = forge(opts);
    if (f && f.ok === false) return f;
    const b = bind();
    return { ok: !!b.ok, bones: f.bones, linked: b.linked };
  }

  function remove(silent) {
    for (const b of bound) {
      if (b.skinned && b.skinned.parent) b.skinned.parent.remove(b.skinned);
      if (b.skinned && b.skinned.geometry) b.skinned.geometry.dispose();
      if (b.mesh && b.parent) b.parent.add(b.mesh);
      else if (b.mesh) b.mesh.visible = true;
    }
    bound = [];
    if (holder) {
      if (holder.parent) holder.parent.remove(holder);
      if (holder.geometry) holder.geometry.dispose();
      if (holder.material) holder.material.dispose();
    }
    if (proxyGeometry) proxyGeometry.dispose();
    if (proxyMaterial) proxyMaterial.dispose();
    proxyGeometry = null;
    proxyMaterial = null;
    holder = null;
    boneList = null;
    skeleton = null;
    segs = null;
    if (!silent) {
      afterChange();
      say("Auto-armature removed", 2200);
    } else if (typeof refreshRig === "function") {
      refreshRig();
    }
    return true;
  }

  function state() {
    sync();
    const rig = currentRig();
    return {
      bones: boneList ? boneList.length : 0,
      linked: bound.length,
      hasArmature: ownsArmature(),
      rigBones: rig && rig.boneCount ? rig.boneCount : 0,
      spine: params.spine,
      fingers: params.fingers,
      toes: params.toes,
    };
  }

  return {
    forge,
    bind,
    generate,
    remove,
    state,
    analyze: () => analyzeBody(root()),
    setOptions(patch = {}) {
      if (patch.spine != null) params.spine = clamp(Math.round(patch.spine), 1, 4);
      if (patch.fingers != null) params.fingers = !!patch.fingers;
      if (patch.toes != null) params.toes = !!patch.toes;
      return { ...params };
    },
    get bones() {
      return boneList ? boneList.length : 0;
    },
    get linked() {
      return bound.length;
    },
    get hasArmature() {
      return ownsArmature();
    },
    get skeleton() {
      return skeleton;
    },
    get holder() {
      return holder;
    },
  };
}
