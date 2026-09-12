/*
 * .blend rig + animation reader.
 *
 * jsblender exposes meshes/materials/objects/armatures, but not skin weights or
 * actions. This module fills those gaps directly from the SDNA-driven reader, so a
 * rigged, animated .blend imports as a posable SkinnedMesh with real AnimationClips
 * instead of a frozen statue.
 *
 * Everything is read by struct/field NAME (`reader.layoutOf("Bone")`, `fieldOf(...)`),
 * so one codepath spans Blender 2.5 → 5.x. Three quirks are handled explicitly:
 *   • Object.rotmode / Object.quat don't exist in 2.4x — fall back to Euler XYZ.
 *   • Mesh.vertex_group_names arrived in 2.90; older files keep the names in the
 *     owning Object's `defbase` list.
 *   • Blender 5.x moved F-curves out of bAction.curves into layer_array →
 *     strip → ActionStripKeyframeData → ActionChannelBag.fcurve_array.
 *
 * Matrices: jsblender's Float32Array matrices (both `armatureMatrix` and
 * `composeObjectMatrix`'s output) are stored like THREE.Matrix4.fromArray expects
 * (column-major), verified against a bone whose head is at the origin: its arm_mat
 * translation equals head and its Y basis equals (tail-head)/length.
 */
import { THREE } from "./three.js";

const EULER_ORDER = ["XYZ", "XYZ", "XZY", "YXZ", "YZX", "ZXY", "ZYX"];

/* ID datablock names carry a 2-char type prefix ("OBCube", "MECylinder", "ARSkeleton"). */
function idName(raw) {
  return raw && raw.length >= 2 ? raw.slice(2) : raw || "";
}

function fieldOf(layout, name) {
  return layout ? layout.fieldByName.get(name) : undefined;
}

/* Walk a Blender ListBase of `childType` datablocks, calling visit(offset, block)
   for each element. The anchor disambiguates Blender 5's reused oldPtr values. */
function eachListBase(reader, layout, fieldName, base, childType, visit) {
  const f = fieldOf(layout, fieldName);
  if (!f) return 0;
  let child;
  try {
    child = reader.layoutOf(childType);
  } catch (e) {
    return 0;
  }
  const fNext = reader.fieldOf(child, "next");
  let cursor = reader.readPointer(base + f.offset);
  let anchor = base;
  let count = 0;
  while (cursor !== 0n && count < 500000) {
    const block = reader.blockAt(cursor, anchor);
    if (!block) break;
    const offset = Number(cursor - block.oldPtr) + block.dataOffset;
    count++;
    if (visit(offset, block) === false) break;
    cursor = reader.readPointer(offset + fNext.offset);
    anchor = block.dataOffset;
  }
  return count;
}

/* Read a run of `count` structs that Blender stored in a pointer-allocated array
   (Block.count doesn't reflect the element count for these, so the count field of the
   owning struct is authoritative). Returns [{offset}] in the array's block. */
function pointerArray(reader, layout, fieldName, base, childType, count) {
  const f = fieldOf(layout, fieldName);
  if (!f || count <= 0) return [];
  const block = reader.blockAt(reader.readPointer(base + f.offset), base);
  if (!block) return [];
  let stride = 0;
  try {
    stride = reader.layoutOf(childType).size;
  } catch (e) {
    return [];
  }
  if (!stride) return [];
  const out = [];
  const max = Math.min(count, Math.floor(block.size / stride), 200000);
  for (let i = 0; i < max; i++) out.push(block.dataOffset + i * stride);
  return out;
}

/* ------------------------------------------------------------------- objects */

function vec3(reader, offset) {
  return [reader.readFloat32(offset), reader.readFloat32(offset + 4), reader.readFloat32(offset + 8)];
}

function objectLocalMatrix(reader, obLayout, base) {
  const locF = fieldOf(obLayout, "loc");
  const sizeF = fieldOf(obLayout, "size") || fieldOf(obLayout, "scale");
  const rotF = fieldOf(obLayout, "rot");
  const quatF = fieldOf(obLayout, "quat");
  const rotmodeF = fieldOf(obLayout, "rotmode");
  const loc = locF ? vec3(reader, base + locF.offset) : [0, 0, 0];
  const size = sizeF ? vec3(reader, base + sizeF.offset) : [1, 1, 1];
  /* 2.4x has no rotmode: its rotation is always Euler XYZ. */
  const rotmode = rotmodeF ? reader.readInt16(base + rotmodeF.offset) : quatF ? 0 : 1;
  const q = new THREE.Quaternion();
  const e = new THREE.Euler();
  if (rotmode === 0 && quatF) {
    q.set(
      reader.readFloat32(base + quatF.offset + 4),
      reader.readFloat32(base + quatF.offset + 8),
      reader.readFloat32(base + quatF.offset + 12),
      reader.readFloat32(base + quatF.offset),
    );
  } else if (rotmode === -1) {
    const axF = fieldOf(obLayout, "rotAxis");
    const anF = fieldOf(obLayout, "rotAngle");
    if (axF && anF) q.setFromAxisAngle(new THREE.Vector3(...vec3(reader, base + axF.offset)).normalize(), reader.readFloat32(base + anF.offset));
  } else if (rotF) {
    const r = vec3(reader, base + rotF.offset);
    e.set(r[0], r[1], r[2], EULER_ORDER[rotmode] || "XYZ");
    q.setFromEuler(e);
  }
  return new THREE.Matrix4().compose(
    new THREE.Vector3(loc[0], loc[1], loc[2]),
    q,
    new THREE.Vector3(size[0] || 1, size[1] || 1, size[2] || 1),
  );
}

/* Every OB datablock, with a resolved world matrix. Deliberately tolerant of missing
   fields (`rotmode`, `quat`, `parentinv`) so pre-2.5 files don't throw like
   jsblender's extractObjects does. */
export function readBlendObjects(data) {
  const reader = data.reader;
  let obLayout;
  let idLayout;
  try {
    obLayout = reader.layoutOf("Object");
    idLayout = reader.layoutOf("ID");
  } catch (e) {
    return [];
  }
  const fId = fieldOf(obLayout, "id");
  const fIdName = reader.fieldOf(idLayout, "name");
  const fType = fieldOf(obLayout, "type");
  const fData = fieldOf(obLayout, "data");
  const fParent = fieldOf(obLayout, "parent");
  const fParentinv = fieldOf(obLayout, "parentinv");
  const idOff = (fId ? fId.offset : 0) + fIdName.offset;

  const list = [];
  const byOffset = new Map();
  for (const block of data.blocks) {
    if (block.code !== "OB") continue;
    const base = block.dataOffset;
    const name = idName(reader.readCString(base + idOff, 64));
    let dataName = "";
    if (fData) {
      const db = reader.blockAt(reader.readPointer(base + fData.offset), base);
      if (db) dataName = idName(reader.readCString(db.dataOffset + fIdName.offset, 64));
    }
    const rec = {
      name,
      type: fType ? reader.readInt16(base + fType.offset) : 1,
      dataName,
      parentName: "",
      local: objectLocalMatrix(reader, obLayout, base),
      world: new THREE.Matrix4(),
      base,
    };
    if (fParent) {
      const pb = reader.blockAt(reader.readPointer(base + fParent.offset));
      if (pb) rec.parentName = idName(reader.readCString(pb.dataOffset + fIdName.offset, 64));
    }
    rec.parentinv = fParentinv ? new THREE.Matrix4().fromArray(reader.readFloatArray(base + fParentinv.offset, 16)) : new THREE.Matrix4();
    list.push(rec);
    byOffset.set(base, rec);
  }
  const byName = new Map();
  for (const rec of list) if (!byName.has(rec.name)) byName.set(rec.name, rec);
  const done = new Set();
  const resolve = (rec) => {
    if (done.has(rec)) return rec.world;
    done.add(rec);
    const parent = rec.parentName ? byName.get(rec.parentName) : null;
    if (!parent) rec.world.copy(rec.local);
    else rec.world.copy(resolve(parent)).multiply(rec.parentinv).multiply(rec.local);
    return rec.world;
  };
  for (const rec of list) resolve(rec);
  return list;
}

/* ------------------------------------------------------------- deform groups */

/* Vertex-group names live on Mesh from 2.90, but on the owning Object's `defbase`
   list before that. Return both maps so the caller can pick. */
export function readDeformGroups(data) {
  const reader = data.reader;
  let idLayout;
  try {
    idLayout = reader.layoutOf("ID");
  } catch (e) {
    idLayout = null;
  }
  const fIdName = idLayout ? reader.fieldOf(idLayout, "name") : null;

  const readGroupList = (layout, base, fieldName) => {
    const names = [];
    eachListBase(reader, layout, fieldName, base, "bDeformGroup", (offset) => {
      const fName = fieldOf(reader.layoutOf("bDeformGroup"), "name");
      names.push(reader.readCString(offset + fName.offset, 64));
    });
    return names;
  };

  const byObject = new Map();
  const byMesh = new Map();
  for (const block of data.blocks) {
    if (block.code === "ME") {
      const layout = reader.layoutOf("Mesh");
      if (fieldOf(layout, "vertex_group_names")) {
        const fId = fieldOf(layout, "id");
        const name = idName(reader.readCString(block.dataOffset + (fId ? fId.offset : 0) + fIdName.offset, 64));
        byMesh.set(name, readGroupList(layout, block.dataOffset, "vertex_group_names"));
      }
    } else if (block.code === "OB") {
      const layout = reader.layoutOf("Object");
      const fId = fieldOf(layout, "id");
      const name = idName(reader.readCString(block.dataOffset + (fId ? fId.offset : 0) + fIdName.offset, 64));
      const names = readGroupList(layout, block.dataOffset, "defbase");
      if (names.length) byObject.set(name, names);
    }
  }
  return { byObject, byMesh };
}

/* Per-vertex deform weights: [{groupIndex, weight}] for each of the mesh's ORIGINAL
   vertices (the caller maps them onto unwelded corners). */
export function readDeformVerts(data, meshBlock, vertexCount) {
  const reader = data.reader;
  const meshLayout = reader.layoutOf("Mesh");
  const fDvert = fieldOf(meshLayout, "dvert");
  if (!fDvert || vertexCount <= 0) return null;
  const block = reader.blockAt(reader.readPointer(meshBlock.dataOffset + fDvert.offset), meshBlock.dataOffset);
  if (!block) return null;
  let dvLayout;
  let dwLayout;
  try {
    dvLayout = reader.layoutOf("MDeformVert");
    dwLayout = reader.layoutOf("MDeformWeight");
  } catch (e) {
    return null;
  }
  const fDw = fieldOf(dvLayout, "dw");
  const fTot = fieldOf(dvLayout, "totweight");
  const fNr = fieldOf(dwLayout, "def_nr");
  const fWeight = fieldOf(dwLayout, "weight");
  const stride = dvLayout.size;
  const max = Math.min(vertexCount, Math.floor(block.size / stride));
  const out = new Array(vertexCount);
  for (let i = 0; i < vertexCount; i++) {
    if (i >= max) {
      out[i] = null;
      continue;
    }
    const base = block.dataOffset + i * stride;
    const total = reader.readInt32(base + fTot.offset);
    const dwBlock = reader.blockAt(reader.readPointer(base + fDw.offset), block.dataOffset);
    const weights = [];
    if (dwBlock && total > 0) {
      const wmax = Math.min(total, Math.floor(dwBlock.size / dwLayout.size));
      for (let w = 0; w < wmax; w++) {
        const wo = dwBlock.dataOffset + w * dwLayout.size;
        weights.push({ groupIndex: reader.readInt32(wo + fNr.offset), weight: reader.readFloat32(wo + fWeight.offset) });
      }
    }
    out[i] = weights;
  }
  return out;
}

/* ---------------------------------------------------------------- armatures */

export function readArmatures(data, lib) {
  let list = [];
  try {
    list = lib.extractArmatures(data);
  } catch (e) {
    console.warn("blend: armature read failed", e && e.message ? e.message : e);
    return new Map();
  }
  const map = new Map();
  for (const arm of list) {
    map.set(arm.name, arm);
    map.set("AR" + arm.name, arm);
  }
  return map;
}

/* Build a THREE.Bone tree in the armature object's local space. `armatureWorld` is the
   armature object's world matrix; bones end up with bone.matrixWorld == armatureWorld *
   arm_mat, which is exactly what SkinnedMesh needs (see buildSkinnedMesh). */
export function buildSkeleton(rawArmature, armatureWorld) {
  const group = new THREE.Group();
  group.name = rawArmature.name || "armature";
  group.matrixAutoUpdate = false;
  group.matrix.copy(armatureWorld || new THREE.Matrix4());
  const bonesByName = new Map();
  const restWorld = new Map();
  const rootBones = [];

  const build = (raw, parentWorld) => {
    const rest = new THREE.Matrix4().fromArray(raw.armatureMatrix);
    restWorld.set(raw.name, rest.clone());
    const bone = new THREE.Bone();
    bone.name = raw.name;
    const localMatrix = parentWorld ? parentWorld.clone().invert().multiply(rest) : rest.clone();
    localMatrix.decompose(bone.position, bone.quaternion, bone.scale);
    bone.userData.restMatrix = rest.clone();
    const children = Array.isArray(raw.children) ? raw.children : [];
    for (const child of children) bone.add(build(child, rest));
    bonesByName.set(raw.name, bone);
    return bone;
  };
  for (const raw of rawArmature.bones || []) {
    const bone = build(raw, null);
    group.add(bone);
    rootBones.push(bone);
  }
  return { group, bonesByName, rootBones, restWorld };
}

/* --------------------------------------------------------------- weights I/O */

/* Build the skinIndex/skinWeight attributes for an unwelded corner geometry from the
   per-original-vertex weights. `groupNames` maps group index -> bone name, and
   `boneIndex` maps bone name -> index in the skeleton's bone array. */
export function buildSkinAttributes(cornerVertices, deformVerts, groupNames, boneIndex) {
  const cornerCount = cornerVertices.length;
  const skinIndex = new Uint16Array(cornerCount * 4);
  const skinWeight = new Float32Array(cornerCount * 4);
  if (!deformVerts) return { skinIndex, skinWeight, skinned: false };
  let any = false;
  let maxBone = 0;
  for (let k = 0; k < cornerCount; k++) {
    const weights = deformVerts[cornerVertices[k]];
    if (!weights || !weights.length) continue;
    const resolved = weights
      .map((w) => ({ bone: boneIndex.get((groupNames && groupNames[w.groupIndex]) || ""), weight: w.weight }))
      .filter((w) => w.bone !== undefined && w.weight > 0)
      .sort((a, b) => b.weight - a.weight)
      .slice(0, 4);
    if (!resolved.length) continue;
    let sum = 0;
    for (const w of resolved) sum += w.weight;
    if (sum <= 0) continue;
    any = true;
    for (let i = 0; i < resolved.length; i++) {
      skinIndex[k * 4 + i] = resolved[i].bone;
      skinWeight[k * 4 + i] = resolved[i].weight / sum;
      if (resolved[i].bone > maxBone) maxBone = resolved[i].bone;
    }
  }
  return { skinIndex, skinWeight, skinned: any, boneCount: maxBone + 1 };
}

/* ---------------------------------------------------------------- animation */

function readFcurveList(data, animLayout, containerBase, fieldName) {
  const reader = data.reader;
  const out = [];
  eachListBase(reader, animLayout, fieldName, containerBase, "FCurve", (offset, block) => {
    const curve = readFcurve(data, offset, block.dataOffset);
    if (curve) out.push(curve);
  });
  return out;
}

function readFcurve(data, offset, anchor) {
  const reader = data.reader;
  let layout;
  let bezLayout;
  try {
    layout = reader.layoutOf("FCurve");
    bezLayout = reader.layoutOf("BezTriple");
  } catch (e) {
    return null;
  }
  const fRna = fieldOf(layout, "rna_path");
  const fIndex = fieldOf(layout, "array_index");
  const fTot = fieldOf(layout, "totvert");
  const fBezt = fieldOf(layout, "bezt");
  const fCurval = fieldOf(layout, "curval");
  if (!fRna || !fBezt) return null;
  const rnaBlock = reader.blockAt(reader.readPointer(offset + fRna.offset), anchor);
  const path = rnaBlock ? reader.readCString(rnaBlock.dataOffset, 256) : "";
  if (!path) return null;
  const index = fIndex ? reader.readInt32(offset + fIndex.offset) : 0;
  const total = fTot ? reader.readInt32(offset + fTot.offset) : 0;
  const value = fCurval ? reader.readFloat32(offset + fCurval.offset) : 0;
  const beztBlock = reader.blockAt(reader.readPointer(offset + fBezt.offset), anchor);
  const keys = [];
  if (beztBlock && total > 0) {
    const fVec = fieldOf(bezLayout, "vec");
    const fIpo = fieldOf(bezLayout, "ipo");
    const fEasing = fieldOf(bezLayout, "easing");
    const stride = bezLayout.size;
    const max = Math.min(total, Math.floor(beztBlock.size / stride));
    for (let i = 0; i < max; i++) {
      const base = beztBlock.dataOffset + i * stride;
      keys.push({
        x: reader.readFloat32(base + fVec.offset + 12),
        y: reader.readFloat32(base + fVec.offset + 16),
        lx: reader.readFloat32(base + fVec.offset + 0),
        ly: reader.readFloat32(base + fVec.offset + 4),
        rx: reader.readFloat32(base + fVec.offset + 24),
        ry: reader.readFloat32(base + fVec.offset + 28),
        ipo: fIpo ? reader.readInt8(base + fIpo.offset) : 2,
        easing: fEasing ? reader.readUint8(base + fEasing.offset) : 0,
      });
    }
  }
  return { path, index, value, keys };
}

/* Cubic bezier segment solve (Blender's default key interpolation). X is monotonic
   enough that a bounded Newton/bisection is safe. */
function bezierY(keys, i, x) {
  const a = keys[i];
  const b = keys[i + 1];
  if (!a || !b) return a ? a.y : 0;
  const x0 = a.x;
  const x1 = b.x;
  if (x1 - x0 <= 1e-9) return b.y;
  const t0x = a.rx;
  const t0y = a.ry;
  const t1x = b.lx;
  const t1y = b.ly;
  const t = Math.max(0, Math.min(1, (x - x0) / (x1 - x0)));
  let lo = 0;
  let hi = 1;
  let u = t;
  for (let it = 0; it < 24; it++) {
    const mt = 1 - u;
    const px = mt * mt * mt * x0 + 3 * mt * mt * u * t0x + 3 * mt * u * u * t1x + u * u * u * x1;
    if (Math.abs(px - x) < 1e-5) break;
    if (px < x) lo = u;
    else hi = u;
    u = (lo + hi) / 2;
  }
  const mu = 1 - u;
  return mu * mu * mu * a.y + 3 * mu * mu * u * t0y + 3 * mu * u * u * t1y + u * u * u * b.y;
}

function sampleCurve(curve, frame) {
  const keys = curve.keys;
  if (!keys || !keys.length) return curve.value;
  if (keys.length === 1) return keys[0].y;
  if (frame <= keys[0].x) return keys[0].y;
  if (frame >= keys[keys.length - 1].x) return keys[keys.length - 1].y;
  let i = 0;
  while (i < keys.length - 2 && keys[i + 1].x <= frame) i++;
  const a = keys[i];
  const b = keys[i + 1];
  if (a.ipo === 0) return a.y; // CONSTANT
  if (a.ipo === 1) {
    const t = (frame - a.x) / (b.x - a.x || 1);
    return a.y + (b.y - a.y) * t;
  }
  return bezierY(keys, i, frame);
}

function readActionCurves(data, actionBase, layout, fCurves) {
  let curves = readFcurveList(data, layout, actionBase, fCurves);
  if (curves.length) return curves;
  /* Blender 5.x: layers → strips → ActionStripKeyframeData → channelbags. */
  const reader = data.reader;
  const fLayers = fieldOf(layout, "layer_array");
  const fLayerNum = fieldOf(layout, "layer_array_num");
  const fKfData = fieldOf(layout, "strip_keyframe_data_array");
  const fKfNum = fieldOf(layout, "strip_keyframe_data_array_num");
  if (!fLayers || !fLayerNum) return curves;
  let layerLayout;
  let stripLayout;
  let kfDataLayout;
  let bagLayout;
  try {
    layerLayout = reader.layoutOf("ActionLayer");
    stripLayout = reader.layoutOf("ActionStrip");
    kfDataLayout = reader.layoutOf("ActionStripKeyframeData");
    bagLayout = reader.layoutOf("ActionChannelBag");
  } catch (e) {
    return curves;
  }
  const layers = pointerArray(reader, layout, "layer_array", actionBase, "ActionLayer", fLayerNum ? reader.readInt32(actionBase + fLayerNum.offset) : 0);
  const kfDatas = pointerArray(reader, layout, "strip_keyframe_data_array", actionBase, "ActionStripKeyframeData", fKfNum ? reader.readInt32(actionBase + fKfNum.offset) : 0);
  const fStripArray = fieldOf(layerLayout, "strip_array");
  const fStripNum = fieldOf(layerLayout, "strip_array_num");
  const fStripType = fieldOf(stripLayout, "strip_type");
  const fDataIndex = fieldOf(stripLayout, "data_index");
  const fBags = fieldOf(kfDataLayout, "channelbag_array");
  const fBagNum = fieldOf(kfDataLayout, "channelbag_array_num");
  const fFcurves = fieldOf(bagLayout, "fcurve_array");
  const fFcurveNum = fieldOf(bagLayout, "fcurve_array_num");
  for (const layerOffset of layers) {
    if (!fStripArray || !fStripNum) continue;
    const strips = pointerArray(reader, layerLayout, "strip_array", layerOffset, "ActionStrip", reader.readInt32(layerOffset + fStripNum.offset));
    for (const stripOffset of strips) {
      const type = fStripType ? reader.readInt8(stripOffset + fStripType.offset) : 0;
      if (type !== 0) continue; // 0 = KEYFRAME
      const dataIndex = fDataIndex ? reader.readInt32(stripOffset + fDataIndex.offset) : 0;
      const kfOffset = kfDatas[dataIndex];
      if (kfOffset === undefined || !fBags || !fBagNum) continue;
      const bags = pointerArray(reader, kfDataLayout, "channelbag_array", kfOffset, "ActionChannelBag", reader.readInt32(kfOffset + fBagNum.offset));
      for (const bagOffset of bags) {
        if (!fFcurves || !fFcurveNum) continue;
        const offsets = pointerArray(reader, bagLayout, "fcurve_array", bagOffset, "FCurve", reader.readInt32(bagOffset + fFcurveNum.offset));
        for (const off of offsets) {
          const curve = readFcurve(data, off, bagOffset);
          if (curve) curves.push(curve);
        }
      }
    }
  }
  return curves;
}

/* All AC datablocks, keyed by datablock name (prefix stripped). Each carries its
   fcurves plus the frame span derived from the key times. */
export function readActions(data) {
  const reader = data.reader;
  let layout;
  let idLayout;
  try {
    layout = reader.layoutOf("bAction");
    idLayout = reader.layoutOf("ID");
  } catch (e) {
    return new Map();
  }
  const fId = fieldOf(layout, "id");
  const fIdName = reader.fieldOf(idLayout, "name");
  const idOff = (fId ? fId.offset : 0) + fIdName.offset;
  const actions = new Map();
  for (const block of data.blocks) {
    if (block.code !== "AC") continue;
    const name = idName(reader.readCString(block.dataOffset + idOff, 64));
    const curves = readActionCurves(data, block.dataOffset, layout, "curves");
    let start = Infinity;
    let end = -Infinity;
    for (const c of curves) {
      for (const k of c.keys) {
        if (k.x < start) start = k.x;
        if (k.x > end) end = k.x;
      }
    }
    actions.set(name, {
      name,
      curves,
      frameStart: Number.isFinite(start) ? start : 0,
      frameEnd: Number.isFinite(end) ? end : 0,
    });
  }
  return actions;
}

/* objectName -> action datablock name, from AnimData.action (2.5+) or the legacy
   Object.action pointer (2.4x). */
export function readObjectActions(data) {
  const reader = data.reader;
  let obLayout;
  let idLayout;
  let adtLayout;
  try {
    obLayout = reader.layoutOf("Object");
    idLayout = reader.layoutOf("ID");
    adtLayout = reader.layoutOf("AnimData");
  } catch (e) {
    return new Map();
  }
  const fId = fieldOf(obLayout, "id");
  const fIdName = reader.fieldOf(idLayout, "name");
  const idOff = (fId ? fId.offset : 0) + fIdName.offset;
  const fAdt = fieldOf(obLayout, "adt");
  const fAction = fieldOf(obLayout, "action");
  const fAdtAction = fieldOf(adtLayout, "action");
  const map = new Map();
  for (const block of data.blocks) {
    if (block.code !== "OB") continue;
    const base = block.dataOffset;
    const name = idName(reader.readCString(base + idOff, 64));
    let actionName = "";
    if (fAdt) {
      const adtBlock = reader.blockAt(reader.readPointer(base + fAdt.offset), base);
      if (adtBlock && fAdtAction) {
        const ab = reader.blockAt(reader.readPointer(adtBlock.dataOffset + fAdtAction.offset), adtBlock.dataOffset);
        if (ab) actionName = idName(reader.readCString(ab.dataOffset + fIdName.offset, 64));
      }
    }
    if (!actionName && fAction) {
      const ab = reader.blockAt(reader.readPointer(base + fAction.offset), base);
      if (ab) actionName = idName(reader.readCString(ab.dataOffset + fIdName.offset, 64));
    }
    if (actionName) map.set(name, actionName);
  }
  return map;
}

/* Scene fps, tolerating struct drift across versions. */
export function readSceneFps(data) {
  try {
    const layout = data.reader.layoutOf("Scene");
    for (const block of data.blocks) {
      if (block.code !== "SC") continue;
      const fSec = fieldOf(layout, "frs_sec");
      const fBase = fieldOf(layout, "frs_sec_base");
      if (fSec) {
        const sec = data.reader.readInt32(block.dataOffset + fSec.offset) || 24;
        const base = fBase ? data.reader.readInt32(block.dataOffset + fBase.offset) || 1 : 1;
        const fps = sec / (base || 1);
        if (fps > 0 && fps < 240) return fps;
      }
    }
  } catch (e) {}
  return 24;
}

const BONE_PATH = /^pose\.bones\["([^"]+)"\]\.(.+)$/;

/* Turn one action into an AnimationClip.
   opts: { objectName, bonesByName, fps, frameStart, frameEnd } */
export function buildActionClip(action, opts) {
  const fps = opts.fps || 24;
  const start = Number.isFinite(opts.frameStart) ? opts.frameStart : action.frameStart;
  const end = Number.isFinite(opts.frameEnd) ? opts.frameEnd : action.frameEnd;
  let span = end - start;
  if (!(span > 0)) span = 1;
  const step = span > 900 ? span / 900 : 1;

  /* Group fcurves by (target, property). Bone paths target the bone; anything else
     targets the object that owns the action. */
  const groups = new Map();
  for (const curve of action.curves) {
    const m = BONE_PATH.exec(curve.path);
    let target;
    if (m) {
      if (!opts.bonesByName || !opts.bonesByName.has(m[1])) continue;
      target = m[1];
    } else {
      target = opts.objectName;
    }
    const prop = m ? m[2] : curve.path;
    const key = target + "|" + prop;
    let g = groups.get(key);
    if (!g) {
      g = { target, prop, curves: {} };
      groups.set(key, g);
    }
    g.curves[curve.index] = curve;
  }

  const times = [];
  for (let f = start; f <= end + 1e-6; f += step) times.push((f - start) / fps);
  const valueAt = (g, index, frame) => {
    const c = g.curves[index];
    return c ? sampleCurve(c, frame) : index === 3 ? 1 : 0;
  };
  const frameAt = (i) => start + i * step;

  const tracks = [];
  const pushPos = (g, prop) => {
    const out = [];
    for (let i = 0; i < times.length; i++) {
      const f = frameAt(i);
      out.push(valueAt(g, 0, f), valueAt(g, 1, f), valueAt(g, 2, f));
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${g.target}.${prop}`, times, out));
  };
  const pushQuat = (g, prop, euler) => {
    const out = [];
    const e = new THREE.Euler();
    const q = new THREE.Quaternion();
    for (let i = 0; i < times.length; i++) {
      const f = frameAt(i);
      if (euler) {
        e.set(valueAt(g, 0, f), valueAt(g, 1, f), valueAt(g, 2, f), "XYZ");
        q.setFromEuler(e);
      } else {
        q.set(valueAt(g, 0, f), valueAt(g, 1, f), valueAt(g, 2, f), valueAt(g, 3, f));
        q.normalize();
      }
      out.push(q.x, q.y, q.z, q.w);
    }
    tracks.push(new THREE.QuaternionKeyframeTrack(`${g.target}.${prop}`, times, out));
  };
  const pushScale = (g) => {
    const out = [];
    for (let i = 0; i < times.length; i++) {
      const f = frameAt(i);
      out.push(
        g.curves[0] ? sampleCurve(g.curves[0], f) : 1,
        g.curves[1] ? sampleCurve(g.curves[1], f) : 1,
        g.curves[2] ? sampleCurve(g.curves[2], f) : 1,
      );
    }
    tracks.push(new THREE.VectorKeyframeTrack(`${g.target}.scale`, times, out));
  };

  for (const g of groups.values()) {
    if (g.prop === "location") pushPos(g, "position");
    else if (g.prop === "scale") pushScale(g);
    else if (g.prop === "rotation_euler") pushQuat(g, "quaternion", true);
    else if (g.prop === "rotation_quaternion") pushQuat(g, "quaternion", false);
    else if (g.prop === "delta_location") pushPos(g, "position");
  }
  if (!tracks.length) return null;
  const clip = new THREE.AnimationClip(action.name || "action", span / fps);
  clip.tracks = tracks;
  return clip;
}

/* Convenience: build every clip a .blend carries, resolving each action's owner.
   opts.bonesForObject(objectName) -> Map<boneName, Bone> | null, so a clip that drives
   an armature's bones resolves against that armature and a mesh's own transform tracks
   resolve against the mesh object's name. */
export function buildClips(data, opts = {}) {
  const actions = readActions(data);
  if (!actions.size) return [];
  const objectActions = readObjectActions(data);
  const fps = opts.fps || readSceneFps(data);
  const clips = [];
  for (const [objectName, actionName] of objectActions) {
    const action = actions.get(actionName);
    if (!action || !action.curves.length) continue;
    const bonesByName = opts.bonesForObject ? opts.bonesForObject(objectName) : null;
    const clip = buildActionClip(action, { objectName, bonesByName, fps });
    if (clip) {
      clip.userData = { object: objectName, action: actionName };
      clips.push(clip);
    }
  }
  return clips;
}
