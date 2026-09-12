/*
 * Armature — reading and driving a rigged model.
 *
 * A rigged file (FBX / GLB / GLTF / DAE with a skeleton) is not one mesh: it is a
 * tree of bones + one or more SkinnedMeshes, and usually one or more AnimationClips
 * that pose those bones over time. This module is the single place that reads that
 * structure so the rest of the app can "understand" it:
 *
 *   analyzeRig(root)      → what the skeleton *is* (bones, hierarchy, clips, stats)
 *   createRig({root,…})   → a live controller: skeleton overlay, clip mixer,
 *                           pose capture/apply, network description
 *   createGhostPuppet(…)  → a bone-only stand-in for another user's rig (wireframe)
 *
 * It never touches the model's materials or geometry — the overlay lives in its own
 * group so it can't leak into an export.
 */

import * as T3 from "./three.js";

const THREE = T3.THREE;

const UP = new THREE.Vector3(0, 1, 0);

/* Bone colouring by anatomical role, so a 240-bone rig reads at a glance. */
export const BONE_CLASSES = {
  head: { label: "Head", color: 0xffd166 },
  spine: { label: "Spine", color: 0x7c6cff },
  arm: { label: "Arm", color: 0x3ddad7 },
  leg: { label: "Leg", color: 0xff8fb1 },
  muscle: { label: "Muscle", color: 0xff5d5d },
  tail: { label: "Tail / extra", color: 0xb48cff },
  other: { label: "Other", color: 0x8b93a7 },
};

const CLASS_RULES = [
  /* Muscle-rig bellies first, so an anatomical name (GluteusL → leg rule 'glute',
     TibialisL → 'tibia', ForearmFlexL → 'forearm') is not stolen by a body-part rule.
     Tokens are chosen to NOT collide with the base skeleton's own bone names
     (e.g. 'forearmflex' does not match 'LeftForeArm'). */
  ["muscle", /muscl|biceps|triceps|brachialis|deltoid|forearmflex|forearmext|pectoralis|latissimus|trapezius|infraspinatus|gluteus|quadriceps|hamstring|adductor|gastrocnemius|soleus|tibialis|sartorius|rectusabdominis|erectorspinae|obliques/i],
  ["head", /head|skull|cranium|face|neck|jaw|chin|mouth|lip|tongue|tooth|teeth|eye|eyelid|lid|iris|pupil|brow|cheek|nose|nostril|ear(?!m)|horn|hair|beard|mane|snout|beak|antenna|levator|orbicularis|oculi|temporalis|risorius|zygomatic|frontalis|oris/i],
  ["arm", /arm|shoulder|clavicle|scapula|hand|palm|wrist|finger|thumb|index|middle|ring|pinky|knuckle|metacarpal|phalanx|phalange|forearm|upperarm|elbow|claw|wing|feather/i],
  ["leg", /leg|thigh|knee|shin|calf|crus|femur|tibia|foot|toe|ankle|heel|sole|hip|pelv|buttock|glute|fesse/i],
  ["spine", /spine|torso|chest|body|waist|belly|abdomen|ribs?|root|colon|back|sternum|breast|boob|sein|teton|nipel|nipple/i],
  ["tail", /tail|tentacle|chain|dq|twist|ik|pole|nub|helper|locator|null|ctrl|control/i],
];

export function classifyBone(name) {
  const n = String(name || "");
  for (const [cls, re] of CLASS_RULES) if (re.test(n)) return cls;
  return "other";
}

/* --------------------------------------------------------------- discovery */

export function findSkeletons(root) {
  const skeletons = [];
  const skinnedMeshes = [];
  root.traverse((o) => {
    if (o.isSkinnedMesh && o.skeleton) {
      skinnedMeshes.push(o);
      if (skeletons.indexOf(o.skeleton) === -1) skeletons.push(o.skeleton);
    }
  });
  return { skeletons, skinnedMeshes };
}

function hash32(str) {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h >>> 0;
}

export function rigSignature(boneNames) {
  return hash32(boneNames.join("|")).toString(16).padStart(8, "0");
}

function isDescendantOf(node, ancestor) {
  let o = node;
  while (o) {
    if (o === ancestor) return true;
    o = o.parent;
  }
  return false;
}

/*
 * Armature repair — a "customized armature" pass for rigs that do not import cleanly.
 *
 * Some exporters (mostly FBX and hand-edited GLTF) leave a skeleton's root outside the
 * model group — under the scene root — so the bones keep their own world pose while the
 * mesh gets normalised/scaled/moved underneath them, and the armature no longer follows
 * the model. Re-home every root bone that isn't already under `root`, preserving its
 * world transform exactly, so the rig behaves like a properly authored one. Runs on the
 * live graph and is a no-op for well-formed files (e.g. the toga GLB, whose single
 * `root` bone is already parented under the model).
 */
export function repairArmature(root, bones, parent) {
  root.updateMatrixWorld(true);
  const rootInv = root.matrixWorld.clone().invert();
  const world = new THREE.Matrix4();
  let changed = 0;
  for (let i = 0; i < bones.length; i++) {
    if (parent[i] !== -1) continue;
    const b = bones[i];
    if (isDescendantOf(b, root)) continue;
    world.copy(b.matrixWorld);
    b.removeFromParent();
    root.add(b);
    b.matrix.multiplyMatrices(rootInv, world);
    b.matrix.decompose(b.position, b.quaternion, b.scale);
    changed++;
  }
  if (changed) {
    root.updateMatrixWorld(true);
    console.info("[armature] re-homed " + changed + " root bone(s) under the model group");
  }
  return changed;
}

/* --------------------------------------------------------------- analysis */

/*
 * Reads the skeleton out of `root` (usually the viewer's modelGroup). Returns null
 * for an unrigged mesh. The returned `bones` array is the *primary* skeleton (the
 * one with the most bones); `skeletons`/`skinnedMeshes` list every one found.
 */
export function analyzeRig(root) {
  const { skeletons, skinnedMeshes } = findSkeletons(root);
  if (!skeletons.length) return null;
  const sorted = skeletons.slice().sort((a, b) => b.bones.length - a.bones.length);
  const skeleton = sorted[0];
  const bones = skeleton.bones;

  const indexOf = new Map();
  bones.forEach((b, i) => indexOf.set(b, i));

  const parent = bones.map((b) => {
    let p = b.parent;
    while (p) {
      if (indexOf.has(p)) return indexOf.get(p);
      p = p.parent;
    }
    return -1;
  });

  const children = bones.map(() => []);
  parent.forEach((p, i) => {
    if (p >= 0) children[p].push(i);
  });

  const names = bones.map((b) => b.name || "bone" + indexOf.get(b));
  const classes = names.map(classifyBone);

  let vertices = 0;
  let triangles = 0;
  const skinned = skinnedMeshes.map((m) => {
    const g = m.geometry;
    const v = g && g.attributes && g.attributes.position ? g.attributes.position.count : 0;
    const t = g ? (g.index ? g.index.count / 3 : v / 3) : 0;
    vertices += v;
    triangles += t;
    return {
      name: m.name || "skinned",
      bones: m.skeleton ? m.skeleton.bones.length : 0,
      vertices: v,
      triangles: Math.round(t),
      material: m.material && m.material.type,
    };
  });

  const clips = ((findAnimRoot(root, bones[0]).animations) || root.animations || []).map((c, i) => ({
    index: i,
    name: c.name || "clip " + (i + 1),
    duration: c.duration,
    tracks: c.tracks.length,
  }));

  return {
    bones,
    names,
    classes,
    parent,
    children,
    skeleton,
    skeletons,
    skinnedMeshes,
    skinned,
    clips,
    animRoot: findAnimRoot(root, bones[0]),
    signature: rigSignature(names),
    stats: { bones: bones.length, skeletons: skeletons.length, skinnedMeshes: skinnedMeshes.length, vertices, triangles: Math.round(triangles) },
  };
}

/* --------------------------------------------------------------- bone shape */

/* Blender-style octahedral bone: head at the origin, tail at (0,1,0). */
function boneGeometry() {
  const w = 0.11;
  const h = 0.24;
  const v = new Float32Array([
    0, 0, 0,
    w, h, w,
    -w, h, w,
    -w, h, -w,
    w, h, -w,
    0, 1, 0,
  ]);
  const idx = [
    0, 1, 2, 0, 2, 3, 0, 3, 4, 0, 4, 1,
    5, 2, 1, 5, 3, 2, 5, 4, 3, 5, 1, 4,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.BufferAttribute(v, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

/* --------------------------------------------------------------- live rig */

/*
 * createRig({ root, overlay, size })
 *   root    — the Object3D that contains the bones (modelGroup)
 *   overlay — a group added to the scene; the skeleton lives here, NOT in root
 *   size    — world size of the model (for default bone lengths)
 *
 * Returns null when `root` has no skeleton.
 */
export function createRig({ root, overlay, size = 2 }) {
  const info = analyzeRig(root);
  if (!info) return null;
  const { bones, names, classes, parent, children } = info;
  const n = bones.length;

  /* ---- repair (customize) the armature if it imported mis-parented ---------- */
  repairArmature(root, bones, parent);

  /* ---- bind pose snapshot -------------------------------------------------- */
  root.updateMatrixWorld(true);
  const bindPos = bones.map((b) => b.position.clone());
  const bindQuat = bones.map((b) => b.quaternion.clone());
  const bindScale = bones.map((b) => b.scale.clone());
  const bindWorldPos = bones.map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));
  const bindWorldQuat = bones.map((b) => new THREE.Quaternion().setFromRotationMatrix(b.matrixWorld));
  const bindWorldInv = bones.map((b) => b.matrixWorld.clone().invert());

  const firstChild = bones.map(() => -1);
  parent.forEach((p, i) => {
    if (p >= 0 && firstChild[p] === -1) firstChild[p] = i;
  });

  const restDirLocal = new Array(n);
  const restDirWorld = new Array(n);
  const restLen = new Array(n);
  const unitScale = new THREE.Vector3();
  bones[0] && bones[0].matrixWorld.decompose(new THREE.Vector3(), new THREE.Quaternion(), unitScale);
  const fallbackLen = Math.max((Math.abs(unitScale.x) + Math.abs(unitScale.y) + Math.abs(unitScale.z)) / 3, 1) * size * 0.06;

  for (let i = 0; i < n; i++) {
    const fc = firstChild[i];
    if (fc >= 0) {
      const d = bindWorldPos[fc].clone().sub(bindWorldPos[i]);
      const len = d.length();
      restLen[i] = len > 1e-7 ? len : fallbackLen;
      restDirWorld[i] = len > 1e-7 ? d.divideScalar(len) : new THREE.Vector3(0, 1, 0);
    } else {
      const p = parent[i];
      restLen[i] = p >= 0 ? restLen[p] * 0.42 : fallbackLen;
      restDirWorld[i] = p >= 0 && restDirWorld[p] ? restDirWorld[p].clone() : new THREE.Vector3(0, 1, 0);
    }
    restDirLocal[i] = restDirWorld[i].clone().applyQuaternion(bindWorldQuat[i].clone().invert()).normalize();
  }

  /* ---- skeleton overlay ---------------------------------------------------- */
  // Drawn on top of the mesh (depthTest off) so a rig inside a solid, opaque character —
  // e.g. a heavy skinned GLB like the toga — is actually visible instead of buried in it.
  const mkMat = (opacity) => new THREE.MeshBasicMaterial({
    toneMapped: false, transparent: true, opacity, depthTest: false, depthWrite: false,
  });
  const bonesMat = mkMat(0.96);
  const bonesMesh = new THREE.InstancedMesh(boneGeometry(), bonesMat, n);
  bonesMesh.frustumCulled = false;
  bonesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  bonesMesh.renderOrder = 6;
  const jointsMat = mkMat(0.9);
  const jointsMesh = new THREE.InstancedMesh(new THREE.SphereGeometry(0.5, 10, 8), jointsMat, n);
  jointsMesh.frustumCulled = false;
  jointsMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  jointsMesh.renderOrder = 6;

  const skeletonGroup = new THREE.Group();
  skeletonGroup.name = "armature-overlay";
  skeletonGroup.add(bonesMesh, jointsMesh);
  overlay.add(skeletonGroup);

  let selected = -1;
  let colorByClass = true;
  const colorTmp = new THREE.Color();
  const BASE_COLOR = new THREE.Color(0x9aa4bb);
  const SEL_COLOR = new THREE.Color(0xffe066);

  function paint() {
    for (let i = 0; i < n; i++) {
      if (i === selected) colorTmp.copy(SEL_COLOR);
      else if (colorByClass) colorTmp.setHex(BONE_CLASSES[classes[i]].color);
      else colorTmp.copy(BASE_COLOR);
      bonesMesh.setColorAt(i, colorTmp);
      jointsMesh.setColorAt(i, colorTmp);
    }
    if (bonesMesh.instanceColor) bonesMesh.instanceColor.needsUpdate = true;
    if (jointsMesh.instanceColor) jointsMesh.instanceColor.needsUpdate = true;
  }
  paint();

  const mTmp = new THREE.Matrix4();
  const qTmp = new THREE.Quaternion();
  const pTmp = new THREE.Vector3();
  const pChild = new THREE.Vector3();
  const dTmp = new THREE.Vector3();
  const sTmp = new THREE.Vector3();
  const qIdent = new THREE.Quaternion();
  let widthScale = 1;

  function updateSkeleton() {
    if (!skeletonGroup.visible) return;
    root.updateMatrixWorld(true);
    for (let i = 0; i < n; i++) {
      pTmp.setFromMatrixPosition(bones[i].matrixWorld);
      let len;
      const fc = firstChild[i];
      if (fc >= 0) {
        pChild.setFromMatrixPosition(bones[fc].matrixWorld);
        dTmp.subVectors(pChild, pTmp);
        len = dTmp.length();
        if (len > 1e-7) dTmp.divideScalar(len);
        else {
          dTmp.copy(restDirLocal[i]).applyQuaternion(qTmp.setFromRotationMatrix(bones[i].matrixWorld));
          len = restLen[i];
        }
      } else {
        qTmp.setFromRotationMatrix(bones[i].matrixWorld);
        dTmp.copy(restDirLocal[i]).applyQuaternion(qTmp);
        len = restLen[i];
      }
      const r = Math.max(len * 0.16, len * 0.0001);
      qTmp.setFromUnitVectors(UP, dTmp);
      sTmp.set(r * widthScale, len, r * widthScale);
      mTmp.compose(pTmp, qTmp, sTmp);
      bonesMesh.setMatrixAt(i, mTmp);
      const jr = Math.max(r * 1.5, fallbackLen * 0.05);
      sTmp.set(jr, jr, jr);
      mTmp.compose(pTmp, qIdent, sTmp);
      jointsMesh.setMatrixAt(i, mTmp);
    }
    bonesMesh.instanceMatrix.needsUpdate = true;
    jointsMesh.instanceMatrix.needsUpdate = true;
  }
  updateSkeleton();

  /* ---- animation ----------------------------------------------------------- */
  let mixer = null;
  let action = null;
  let clipIndex = -1;
  const animRoot = info.animRoot || findAnimRoot(root, bones[0]);

  function ensureMixer() {
    if (!mixer) mixer = new THREE.AnimationMixer(animRoot);
    return mixer;
  }

  function playClip(i, { loop = true, speed = 1 } = {}) {
    const clips = info.clips;
    if (!clips.length) return false;
    i = Math.max(0, Math.min(clips.length - 1, i | 0));
    const raw = (animRoot.animations || [])[i];
    if (!raw) return false;
    const mx = ensureMixer();
    const prev = action;
    action = mx.clipAction(raw);
    if (prev && prev !== action) prev.stop();
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.timeScale = speed;
    action.play();
    clipIndex = i;
    return true;
  }

  function stopClip() {
    if (action) action.stop();
    action = null;
    clipIndex = -1;
    resetPose();
  }

  function setClipTime(t) {
    if (!action) return;
    action.time = Math.max(0, Math.min(action.getClip().duration, t));
    ensureMixer().update(0);
    root.updateMatrixWorld(true);
    updateSkeleton();
  }

  function setSpeed(v) {
    if (action) action.timeScale = v;
  }

  function setPlaying(on) {
    if (action) action.paused = !on;
  }

  function update(dt) {
    if (mixer) mixer.update(dt);
    updateSkeleton();
  }

  /* ---- pose ---------------------------------------------------------------- */
  /* A pose is { quats: Float32Array(n*4), deltas: Float32Array(n*3) } where each
     delta is the bone's local position minus its bind position. Most deltas are
     zero (exporters bake constant position tracks), so the wire codec sends only
     the bones that actually moved — see encodePose. */
  function capturePose() {
    const quats = new Float32Array(n * 4);
    const deltas = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      bones[i].quaternion.toArray(quats, i * 4);
      deltas[i * 3] = bones[i].position.x - bindPos[i].x;
      deltas[i * 3 + 1] = bones[i].position.y - bindPos[i].y;
      deltas[i * 3 + 2] = bones[i].position.z - bindPos[i].z;
    }
    return { quats, deltas, boneCount: n, signature: info.signature };
  }

  function applyPose(pose) {
    if (!pose) return false;
    const quats = pose.quats || (pose.length === n * 4 ? pose : null);
    if (!quats || quats.length !== n * 4) return false;
    const deltas = pose.deltas && pose.deltas.length >= n * 3 ? pose.deltas : null;
    for (let i = 0; i < n; i++) {
      bones[i].quaternion.fromArray(quats, i * 4);
      if (deltas) {
        bones[i].position.set(
          bindPos[i].x + deltas[i * 3],
          bindPos[i].y + deltas[i * 3 + 1],
          bindPos[i].z + deltas[i * 3 + 2],
        );
      }
    }
    root.updateMatrixWorld(true);
    updateSkeleton();
    return true;
  }

  function resetPose() {
    for (let i = 0; i < n; i++) {
      bones[i].position.copy(bindPos[i]);
      bones[i].quaternion.copy(bindQuat[i]);
      bones[i].scale.copy(bindScale[i]);
    }
    root.updateMatrixWorld(true);
    updateSkeleton();
  }

  /* ---- network description ------------------------------------------------- */
  /* The compact recipe another client needs to draw this rig as a wireframe:
     bone names, each bone's parent index, and its bind local offset (relative to
     its bone parent). Quaternion poses are then absolute local rotations, so a
     puppet can replay them without knowing anything else. */
  function netInfo() {
    const offs = new Float32Array(n * 3);
    const local = new THREE.Vector3();
    for (let i = 0; i < n; i++) {
      const p = parent[i];
      if (p >= 0) {
        // Bind offset relative to the parent bone's *bind* world matrix. It must come
        // from the frozen bind snapshot — using bones[p].matrixWorld would bake the
        // current animation into the recipe and every remote ghost would come out
        // mangled whenever we announce while a clip is playing or a pose is applied.
        local.copy(bindWorldPos[i]).applyMatrix4(bindWorldInv[p]);
        local.toArray(offs, i * 3);
      } else {
        // A parentless bone is placed at its own bind *local* position, so the ghost
        // hierarchy matches the pose deltas (which are local too).
        offs[i * 3] = bindPos[i].x;
        offs[i * 3 + 1] = bindPos[i].y;
        offs[i * 3 + 2] = bindPos[i].z;
      }
    }
    // Uniform world scale of the skeleton (includes the model's normalisation scale).
    // The ghost applies it to its group so a remote skeleton is the same size here.
    const sc = Math.abs(unitScale.x) > 1e-6 ? (Math.abs(unitScale.x) + Math.abs(unitScale.y) + Math.abs(unitScale.z)) / 3 : 1;
    return { bones: names.slice(), parent: parent.slice(), offs, signature: info.signature, scale: sc };
  }

  /* ---- picking ------------------------------------------------------------- */
  const raycaster = new THREE.Raycaster();
  function pickBone(clientX, clientY, camera, rect) {
    if (!skeletonGroup.visible) return -1;
    const nx = ((clientX - rect.left) / rect.width) * 2 - 1;
    const ny = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera({ x: nx, y: ny }, camera);
    const hits = raycaster.intersectObjects([jointsMesh, bonesMesh], false);
    if (!hits.length) return -1;
    setSelected(hits[0].instanceId);
    return hits[0].instanceId;
  }

  function setSelected(i) {
    selected = i >= 0 && i < n ? i : -1;
    paint();
  }

  function setColorByClass(on) {
    colorByClass = on;
    paint();
  }

  function setVisible(on) {
    skeletonGroup.visible = on;
  }

  function setWidthScale(v) {
    widthScale = v;
    updateSkeleton();
  }

  function dispose() {
    if (mixer) mixer.stopAllAction();
    overlay.remove(skeletonGroup);
    bonesMesh.geometry.dispose();
    bonesMesh.material.dispose();
    jointsMesh.geometry.dispose();
    jointsMesh.material.dispose();
  }

  return {
    info,
    get bones() { return bones; },
    get names() { return names; },
    get classes() { return classes; },
    get parent() { return parent; },
    get children() { return children; },
    get signature() { return info.signature; },
    get clips() { return info.clips; },
    get group() { return skeletonGroup; },
    get selected() { return selected; },
    get clipIndex() { return clipIndex; },
    get playing() { return !!action && !action.paused; },
    get time() { return action ? action.time : 0; },
    get duration() { return action ? action.getClip().duration : (info.clips[0] ? info.clips[0].duration : 0); },
    get boneCount() { return n; },
    update,
    updateSkeleton,
    capturePose,
    applyPose,
    resetPose,
    netInfo,
    playClip,
    stopClip,
    setClipTime,
    setSpeed,
    setPlaying,
    pickBone,
    setSelected,
    setColorByClass,
    setVisible,
    setWidthScale,
    dispose,
  };
}

function findAnimRoot(root, bone) {
  let o = bone;
  while (o) {
    if (o.animations && o.animations.length) return o;
    o = o.parent;
  }
  let found = null;
  root.traverse((c) => {
    if (found) return;
    if (c.animations && c.animations.length) found = c;
  });
  return found || root;
}

/* --------------------------------------------------------------- ghost puppet */

/*
 * A bone-only stand-in for another user's rig: just Object3Ds in the right
 * hierarchy with the right bind offsets, drawn as coloured line segments. Cheap
 * (one draw call) and needs no mesh, so any joiner can see any other rig.
 */
export function createGhostPuppet({ bones, parent, offs, color = 0x3ddad7, opacity = 0.85, scale = 1 }) {
  const n = bones.length;
  const group = new THREE.Group();
  if (scale && Math.abs(scale - 1) > 1e-6) group.scale.setScalar(scale);
  const nodes = new Array(n);
  const base = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    const o = new THREE.Object3D();
    o.name = bones[i];
    nodes[i] = o;
  }
  for (let i = 0; i < n; i++) {
    const off = offs && offs.length >= (i + 1) * 3 ? [offs[i * 3], offs[i * 3 + 1], offs[i * 3 + 2]] : [0, 0, 0];
    base[i * 3] = off[0]; base[i * 3 + 1] = off[1]; base[i * 3 + 2] = off[2];
    nodes[i].position.set(off[0], off[1], off[2]);
    const p = parent ? parent[i] : -1;
    if (p >= 0 && p < n) nodes[p].add(nodes[i]);
    else group.add(nodes[i]);
  }

  const segCount = n;
  const positions = new Float32Array(segCount * 2 * 3);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity, toneMapped: false, depthTest: false });
  const lines = new THREE.LineSegments(geo, mat);
  lines.frustumCulled = false;
  lines.renderOrder = 7;
  group.add(lines);

  const a = new THREE.Vector3();
  const b = new THREE.Vector3();

  function setPose(quats, deltas) {
    if (!quats || quats.length < n * 4) return;
    for (let i = 0; i < n; i++) {
      nodes[i].quaternion.fromArray(quats, i * 4);
      if (deltas && deltas.length >= n * 3) {
        nodes[i].position.set(base[i * 3] + deltas[i * 3], base[i * 3 + 1] + deltas[i * 3 + 1], base[i * 3 + 2] + deltas[i * 3 + 2]);
      }
    }
  }

  function update() {
    group.updateMatrixWorld(true);
    let w = 0;
    for (let i = 0; i < n; i++) {
      a.setFromMatrixPosition(nodes[i].matrixWorld);
      const p = parent ? parent[i] : -1;
      if (p >= 0 && p < n) b.setFromMatrixPosition(nodes[p].matrixWorld);
      else b.copy(a);
      positions[w++] = a.x; positions[w++] = a.y; positions[w++] = a.z;
      positions[w++] = b.x; positions[w++] = b.y; positions[w++] = b.z;
    }
    geo.attributes.position.needsUpdate = true;
    geo.computeBoundingSphere();
  }
  update();

  function dispose() {
    geo.dispose();
    mat.dispose();
  }

  return { group, nodes, setPose, update, dispose, get boneCount() { return n; } };
}

/* --------------------------------------------------------------- pose codec */

export const POSE_FORMAT = 2;        // quaternions + sparse bind-relative position deltas
export const POSE_FORMAT_QUATS = 1;  // quaternions only (legacy / positionless rigs)

const POS_EPSILON = 1e-4;

function quatsOf(pose) {
  if (!pose) return null;
  if (pose.quats instanceof Float32Array) return pose.quats;
  if (pose instanceof Float32Array && pose.length % 4 === 0) return pose;
  return null;
}

/*
 * A pose → bytes.
 *   format 1: [u8 1][u16 count][int16 x4 x count]
 *   format 2: [u8 2][u16 count][f32 posScale][mask ceil(count/8)][int16 x3 per set bit][int16 x4 x count]
 * The mask marks bones whose local position differs from its bind position; each
 * such bone's delta is quantised by posScale. Quantised quaternions land on a
 * ±32767 grid, i.e. ~3e-5 per component — far below anything visible.
 */
export function encodePose(pose) {
  const quats = quatsOf(pose);
  if (!quats) throw new Error("encodePose: need quaternions");
  const n = (quats.length / 4) | 0;
  const deltas = pose && pose.deltas && pose.deltas.length >= n * 3 ? pose.deltas : null;

  let moved = 0;
  let maxAbs = 0;
  const maskLen = Math.ceil(n / 8);
  const mask = new Uint8Array(maskLen);
  if (deltas) {
    for (let i = 0; i < n; i++) {
      const x = deltas[i * 3], y = deltas[i * 3 + 1], z = deltas[i * 3 + 2];
      if (x > POS_EPSILON || x < -POS_EPSILON || y > POS_EPSILON || y < -POS_EPSILON || z > POS_EPSILON || z < -POS_EPSILON) {
        mask[i >> 3] |= 1 << (i & 7);
        moved++;
        if (Math.abs(x) > maxAbs) maxAbs = Math.abs(x);
        if (Math.abs(y) > maxAbs) maxAbs = Math.abs(y);
        if (Math.abs(z) > maxAbs) maxAbs = Math.abs(z);
      }
    }
  }
  const scale = maxAbs > 0 ? maxAbs : 1;
  const fmt = deltas ? POSE_FORMAT : POSE_FORMAT_QUATS;
  const head = deltas ? 7 : 4;
  const out = new Uint8Array(head + (deltas ? maskLen + moved * 6 : 0) + n * 8);
  const dv = new DataView(out.buffer);
  out[0] = fmt;
  dv.setUint16(1, n, true);
  let o = 4;
  if (deltas) {
    dv.setFloat32(3, scale, true);
    out.set(mask, 7);
    o = 7 + maskLen;
    const k = 32767 / scale;
    for (let i = 0; i < n; i++) {
      if (!(mask[i >> 3] & (1 << (i & 7)))) continue;
      dv.setInt16(o, Math.round(Math.max(-1, Math.min(1, deltas[i * 3] / scale)) * 32767), true); o += 2;
      dv.setInt16(o, Math.round(Math.max(-1, Math.min(1, deltas[i * 3 + 1] / scale)) * 32767), true); o += 2;
      dv.setInt16(o, Math.round(Math.max(-1, Math.min(1, deltas[i * 3 + 2] / scale)) * 32767), true); o += 2;
    }
  }
  for (let i = 0; i < n * 4; i++) {
    const v = Math.max(-1, Math.min(1, quats[i]));
    dv.setInt16(o, Math.round(v * 32767), true);
    o += 2;
  }
  return out;
}

export function decodePose(bytes) {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  if (u8.length < 4) return null;
  const fmt = u8[0];
  if (fmt !== POSE_FORMAT && fmt !== POSE_FORMAT_QUATS) return null;
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  const n = dv.getUint16(1, true);
  let o = 4;
  let deltas = null;
  if (fmt === POSE_FORMAT) {
    if (u8.length < 7) return null;
    const scale = dv.getFloat32(3, true);
    const maskLen = Math.ceil(n / 8);
    if (u8.length < 7 + maskLen) return null;
    const mask = u8.subarray(7, 7 + maskLen);
    o = 7 + maskLen;
    deltas = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      if (!(mask[i >> 3] & (1 << (i & 7)))) continue;
      if (o + 6 > u8.length) return null;
      deltas[i * 3] = (dv.getInt16(o, true) / 32767) * scale; o += 2;
      deltas[i * 3 + 1] = (dv.getInt16(o, true) / 32767) * scale; o += 2;
      deltas[i * 3 + 2] = (dv.getInt16(o, true) / 32767) * scale; o += 2;
    }
  }
  if (u8.length < o + n * 8) return null;
  const quats = new Float32Array(n * 4);
  for (let i = 0; i < n * 4; i++) {
    quats[i] = dv.getInt16(o, true) / 32767;
    o += 2;
  }
  return { quats, deltas, boneCount: n };
}
