/*
 * .blend importer.
 *
 * Parsing is done by `jsblender` (MIT) — an SDNA-driven reader that walks Blender's own
 * struct descriptors out of the DNA1 block, so a single codepath spans Blender 2.8 → 5.x.
 * This module turns its output into a THREE.Group.
 *
 * Two mesh layouts exist in the wild:
 *   • Blender 5.x — the new `attribute_storage` arrays (jsblender's extractMeshes).
 *   • Blender 2.8–4.x — the older CustomData layer stacks (vdata/ldata/pdata). In 4.x the
 *     `mvert`/`mpoly`/`mloop` pointers are null and the geometry lives in named CustomData
 *     layers (`position`, `.corner_vert`, `UVMap`, …); in 2.8–3.x those pointers are live.
 *     `extractMeshesLegacy` handles both, preferring named layers and falling back to pointers.
 *
 * Geometry is unwelded per face-corner so per-corner UVs/colours survive, normals are
 * rebuilt with angle-limited smoothing (so cubes stay crisp and organic meshes stay smooth),
 * and each face's `material_index` becomes a geometry group.
 */
import { THREE } from "./three.js";
import { isTGA, tgaToCanvas } from "./tga.js";
import {
  readBlendObjects,
  readDeformGroups,
  readDeformVerts,
  readArmatures,
  buildSkeleton,
  buildSkinAttributes,
  buildClips,
  readSceneFps,
} from "./blend-rig.js";

const JSB_URL = "https://esm.sh/jsblender@0.0.4";
let jsbModule = null;

async function jsblender() {
  if (!jsbModule) jsbModule = await import(JSB_URL);
  return jsbModule;
}

const GZIP = [0x1f, 0x8b];
const ZSTD = [0x28, 0xb5, 0x2f, 0xfd];

function hasMagic(buf, magic) {
  if (!buf || buf.length < magic.length) return false;
  for (let i = 0; i < magic.length; i++) if (buf[i] !== magic[i]) return false;
  return true;
}

/* jsblender decompresses zstd itself, but its sync API can't gunzip (browsers have no sync
   gunzip) — and old .blend files are frequently gzip. Do that here, asynchronously. */
async function decompress(raw) {
  if (!hasMagic(raw, GZIP)) return raw;
  if (typeof DecompressionStream === "undefined") {
    throw new Error("This .blend is gzip-compressed and this browser can't decompress it.");
  }
  const stream = new Blob([raw]).stream().pipeThrough(new DecompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/* ------------------------------------------------------------------ colour */

function srgbToLinear(c) {
  return c <= 0.04045 ? c * 0.0773993808 : Math.pow((c + 0.055) / 1.055, 2.4);
}

/* --------------------------------------------------------- CustomData layers */

/* Every Blender version's `CustomData`/`CustomDataLayer` struct is described in the SDNA, so
   field offsets come from the file itself rather than from hardcoded per-version tables. */
function readCDLayers(reader, meshLayout, meshBase, fieldName) {
  const field = meshLayout.fieldByName.get(fieldName);
  if (!field) return [];
  let cd;
  try {
    cd = reader.layoutOf("CustomData");
  } catch {
    return [];
  }
  const fLayers = cd.fieldByName.get("layers");
  const fTot = cd.fieldByName.get("totlayer");
  if (!fLayers || !fTot) return [];
  const cdBase = meshBase + field.offset;
  const total = reader.readInt32(cdBase + fTot.offset);
  if (total <= 0) return [];
  const block = reader.blockAt(reader.readPointer(cdBase + fLayers.offset), meshBase);
  if (!block) return [];
  let cl;
  try {
    cl = reader.layoutOf("CustomDataLayer");
  } catch {
    return [];
  }
  const fType = cl.fieldByName.get("type");
  const fName = cl.fieldByName.get("name");
  const fData = cl.fieldByName.get("data");
  const stride = cl.size;
  const out = [];
  for (let i = 0; i < total; i++) {
    const o = block.dataOffset + i * stride;
    const type = fType ? reader.readInt32(o + fType.offset) : reader.readInt32(o);
    const name = fName ? reader.readCString(o + fName.offset, fName.size) : "";
    const dataPtr = fData ? reader.readPointer(o + fData.offset) : 0n;
    const dataBlock = reader.blockAt(dataPtr, block.dataOffset);
    if (!dataBlock) continue;
    out.push({ type, name, dataOffset: dataBlock.dataOffset, byteSize: dataBlock.size, blockCount: dataBlock.count });
    if (out.length > 2000) break;
  }
  return out;
}

/* Element width by CD_* type (the union of the legacy and the 4.x+ `CD_PROP_*` enums). */
const CD_STRIDE = {
  1: 4, 2: 16, 3: 8, 4: 12, 5: 12, 6: 4, 7: 4, 8: 12, 10: 4, 11: 4, 13: 12, 14: 12, 15: 4,
  16: 12, 17: 4, 20: 4, 23: 12, 25: 4, 26: 4, 27: 4, 28: 16, 29: 4, 30: 4, 32: 4, 36: 12,
  39: 16, 40: 4, 41: 8, 42: 4, 45: 1, 46: 8, 47: 16, 48: 12, 49: 8, 50: 1, 51: 4, 52: 16,
};

function strideOf(layer, count, natural, structSize) {
  if (count > 0 && layer.byteSize % count === 0 && layer.byteSize / count >= natural) {
    return layer.byteSize / count;
  }
  if (structSize && layer.blockCount > 0 && layer.byteSize % layer.blockCount === 0) {
    return layer.byteSize / layer.blockCount;
  }
  return natural;
}

function readVecLayer(reader, layer, count, channels, forcedStride) {
  const natural = channels * 4;
  const stride = forcedStride || strideOf(layer, count, natural);
  const out = new Float32Array(count * channels);
  for (let i = 0; i < count; i++) {
    const o = layer.dataOffset + i * stride;
    for (let c = 0; c < channels; c++) out[i * channels + c] = reader.readFloat32(o + c * 4);
  }
  return out;
}

function readIntLayer(reader, layer, count) {
  const stride = strideOf(layer, count, 4);
  const out = new Uint32Array(count);
  for (let i = 0; i < count; i++) out[i] = reader.readInt32(layer.dataOffset + i * stride) >>> 0;
  return out;
}

/* ------------------------------------------------- legacy (2.8 – 4.x) meshes */

function extractMeshesLegacy(data, meshLayout) {
  const reader = data.reader;
  let idLayout;
  try {
    idLayout = reader.layoutOf("ID");
  } catch {
    return [];
  }
  const fIdName = reader.fieldOf(idLayout, "name");
  const fId = meshLayout.fieldByName.get("id");
  const idNameOffset = fId ? fId.offset + fIdName.offset : fIdName.offset;

  let mvertLayout = null;
  let mpolyLayout = null;
  let mloopLayout = null;
  try {
    mvertLayout = reader.layoutOf("MVert");
  } catch {}
  try {
    mpolyLayout = reader.layoutOf("MPoly");
  } catch {}
  try {
    mloopLayout = reader.layoutOf("MLoop");
  } catch {}

  const mvertStructSize = mvertLayout ? mvertLayout.size : 16;
  const mpolyStructSize = mpolyLayout ? mpolyLayout.size : 12;
  const mloopStructSize = mloopLayout ? mloopLayout.size : 8;
  const coOffset = mvertLayout && mvertLayout.fieldByName.get("co") ? mvertLayout.fieldByName.get("co").offset : 0;
  const loopstartOffset = mpolyLayout && mpolyLayout.fieldByName.get("loopstart") ? mpolyLayout.fieldByName.get("loopstart").offset : 0;
  const totloopOffset = mpolyLayout && mpolyLayout.fieldByName.get("totloop") ? mpolyLayout.fieldByName.get("totloop").offset : 4;
  const matnrOffset = mpolyLayout && mpolyLayout.fieldByName.get("mat_nr") ? mpolyLayout.fieldByName.get("mat_nr").offset : 8;
  const loopVOffset = mloopLayout && mloopLayout.fieldByName.get("v") ? mloopLayout.fieldByName.get("v").offset : 0;

  const intField = (base, name) => {
    const f = meshLayout.fieldByName.get(name);
    return f ? reader.readInt32(base + f.offset) : 0;
  };

  /* Pre-2.63 files have no loop/poly arrays: each face is a legacy MFace holding
     three or four vertex indices (v4 == 0 marks a triangle), with UVs on the parallel
     MTFace array and face colours on MCol. Fan-triangulate the same way buildGeometry
     does for modern files. */
  const readMFaceGeometry = (base) => {
    const fMface = meshLayout.fieldByName.get("mface");
    if (!fMface) return null;
    const totface = intField(base, "totface");
    if (!totface) return null;
    const fb = reader.blockAt(reader.readPointer(base + fMface.offset), base);
    if (!fb) return null;
    let layout = null;
    let mtLayout = null;
    try { layout = reader.layoutOf("MFace"); } catch {}
    try { mtLayout = reader.layoutOf("MTFace"); } catch {}
    const stride = layout ? layout.size : 20;
    const fo = (n, d) => {
      const f = layout && layout.fieldByName.get(n);
      return f ? f.offset : d;
    };
    const oV1 = fo("v1", 0);
    const oV2 = fo("v2", 4);
    const oV3 = fo("v3", 8);
    const oV4 = fo("v4", 12);
    const oMat = fo("mat_nr", 17);
    const max = Math.min(totface, Math.floor(fb.size / stride));

    let uvBlock = null;
    const fMt = meshLayout.fieldByName.get("mtface");
    if (fMt) uvBlock = reader.blockAt(reader.readPointer(base + fMt.offset), base);
    const uvStride = mtLayout ? mtLayout.size : 44;
    const uvOff = mtLayout && mtLayout.fieldByName.get("uv") ? mtLayout.fieldByName.get("uv").offset : 0;
    const hasUV = uvBlock && uvBlock.size >= max * uvStride;

    let colBlock = null;
    const fMc = meshLayout.fieldByName.get("mcol");
    if (fMc) colBlock = reader.blockAt(reader.readPointer(base + fMc.offset), base);
    const hasCol = colBlock && colBlock.size >= max * 4;

    const corners = [];
    const offsets = [0];
    const mats = [];
    const uvList = [];
    const colList = [];
    for (let i = 0; i < max; i++) {
      const o = fb.dataOffset + i * stride;
      const verts = [
        reader.readInt32(o + oV1),
        reader.readInt32(o + oV2),
        reader.readInt32(o + oV3),
      ];
      if (reader.readInt32(o + oV4) !== 0) verts.push(reader.readInt32(o + oV4));
      for (const vv of verts) corners.push(vv);
      offsets.push(corners.length);
      mats.push(Math.max(0, reader.readInt16(o + oMat)));
      if (hasUV) {
        const uo = uvBlock.dataOffset + i * uvStride + uvOff;
        for (let k = 0; k < verts.length; k++) uvList.push(reader.readFloat32(uo + k * 8), reader.readFloat32(uo + k * 8 + 4));
      }
      if (hasCol) {
        const co = colBlock.dataOffset + i * 4;
        const a = reader.readUint8(co);
        const r = reader.readUint8(co + 1);
        const g = reader.readUint8(co + 2);
        const b = reader.readUint8(co + 3);
        for (let k = 0; k < verts.length; k++) colList.push(srgbToLinear(r / 255), srgbToLinear(g / 255), srgbToLinear(b / 255), a / 255);
      }
    }
    return {
      cornerVertices: new Uint32Array(corners),
      faceOffsets: new Uint32Array(offsets),
      materialIndices: new Uint32Array(mats),
      uv: uvList.length ? new Float32Array(uvList) : null,
      color: colList.length ? new Float32Array(colList) : null,
    };
  };

  const out = [];
  for (const block of data.blocks) {
    if (block.code !== "ME") continue;
    const base = block.dataOffset;
    const rawName = fId ? reader.readCString(base + idNameOffset, 64) : "";
    const name = rawName.startsWith("ME") ? rawName.slice(2) : rawName || "mesh" + out.length;
    const vertexCount = intField(base, "totvert");
    const faceCount = intField(base, "totpoly");
    const cornerCount = intField(base, "totloop");
    const totcolField = meshLayout.fieldByName.get("totcol");
    const totcol = totcolField ? reader.readInt16(base + totcolField.offset) : 0;

    const vLayers = readCDLayers(reader, meshLayout, base, "vdata");
    const lLayers = readCDLayers(reader, meshLayout, base, "ldata");
    const pLayers = readCDLayers(reader, meshLayout, base, "pdata");

    /* ---- positions: named layer first, then the MVert pointer ---- */
    let positions = new Float32Array(vertexCount * 3);
    const posLayer = vLayers.find((l) => l.name === "position" && l.type === 48);
    if (posLayer && vertexCount) {
      positions = readVecLayer(reader, posLayer, vertexCount, 3);
    } else {
      const f = meshLayout.fieldByName.get("mvert");
      if (f) {
        const mb = reader.blockAt(reader.readPointer(base + f.offset), base);
        if (mb && vertexCount) {
          const stride = strideOf({ ...mb, byteSize: mb.size, blockCount: mb.count }, vertexCount, 12, mvertStructSize);
          for (let i = 0; i < vertexCount; i++) {
            const o = mb.dataOffset + i * stride + coOffset;
            positions[i * 3] = reader.readFloat32(o);
            positions[i * 3 + 1] = reader.readFloat32(o + 4);
            positions[i * 3 + 2] = reader.readFloat32(o + 8);
          }
        }
      }
    }

    /* ---- per-corner vertex index ---- */
    let cornerVertices = null;
    const cvLayer = lLayers.find((l) => l.name === ".corner_vert");
    if (cvLayer && cornerCount) {
      cornerVertices = readIntLayer(reader, cvLayer, cornerCount);
    } else {
      const f = meshLayout.fieldByName.get("mloop");
      if (f) {
        const mb = reader.blockAt(reader.readPointer(base + f.offset), base);
        if (mb && cornerCount) {
          const stride = strideOf({ ...mb, byteSize: mb.size, blockCount: mb.count }, cornerCount, 8, mloopStructSize);
          cornerVertices = new Uint32Array(cornerCount);
          for (let i = 0; i < cornerCount; i++) {
            cornerVertices[i] = reader.readInt32(mb.dataOffset + i * stride + loopVOffset) >>> 0;
          }
        }
      }
    }
    if (!cornerVertices) cornerVertices = new Uint32Array(cornerCount);

    /* ---- face offsets (first corner of each face) ---- */
    let faceOffsets = null;
    const fOff = meshLayout.fieldByName.get("poly_offset_indices");
    if (fOff) {
      const mb = reader.blockAt(reader.readPointer(base + fOff.offset), base);
      if (mb && faceCount >= 0 && mb.size >= (faceCount + 1) * 4) {
        faceOffsets = new Uint32Array(faceCount + 1);
        for (let i = 0; i <= faceCount; i++) faceOffsets[i] = reader.readInt32(mb.dataOffset + i * 4) >>> 0;
      }
    }
    if (!faceOffsets) {
      const f = meshLayout.fieldByName.get("mpoly");
      if (f) {
        const mb = reader.blockAt(reader.readPointer(base + f.offset), base);
        if (mb && faceCount) {
          const stride = strideOf({ ...mb, byteSize: mb.size, blockCount: mb.count }, faceCount, 8, mpolyStructSize);
          faceOffsets = new Uint32Array(faceCount + 1);
          let acc = 0;
          for (let i = 0; i < faceCount; i++) {
            const o = mb.dataOffset + i * stride;
            const start = reader.readInt32(o + loopstartOffset) || acc;
            faceOffsets[i] = start;
            acc = start + (reader.readInt32(o + totloopOffset) || 0);
          }
          faceOffsets[faceCount] = acc;
        }
      }
    }
    if (!faceOffsets) faceOffsets = new Uint32Array(faceCount + 1);

    /* ---- per-face material index ---- */
    let materialIndices = null;
    const miLayer = pLayers.find((l) => l.name === "material_index");
    if (miLayer && faceCount) {
      materialIndices = readIntLayer(reader, miLayer, faceCount);
    } else {
      const f = meshLayout.fieldByName.get("mpoly");
      if (f) {
        const mb = reader.blockAt(reader.readPointer(base + f.offset), base);
        if (mb && faceCount) {
          const stride = strideOf({ ...mb, byteSize: mb.size, blockCount: mb.count }, faceCount, 8, mpolyStructSize);
          materialIndices = new Uint32Array(faceCount);
          for (let i = 0; i < faceCount; i++) {
            materialIndices[i] = Math.max(0, reader.readInt16(mb.dataOffset + i * stride + matnrOffset));
          }
        }
      }
    }
    if (!materialIndices) materialIndices = new Uint32Array(faceCount);

    /* ---- legacy MFace geometry (files older than 2.63 have no loops) ---- */
    let mfaceUV = null;
    let mfaceColor = null;
    if (!meshLayout.fieldByName.get("mloop")) {
      const mf = readMFaceGeometry(base);
      if (mf) {
        cornerVertices = mf.cornerVertices;
        faceOffsets = mf.faceOffsets;
        materialIndices = mf.materialIndices;
        mfaceUV = mf.uv;
        mfaceColor = mf.color;
      }
    }

    /* ---- UV maps (corner domain) ---- */
    const uvMaps = {};
    let uvFallback = 0;
    if (mfaceUV) uvMaps.UVMap = mfaceUV;
    for (const l of lLayers) {
      if (!cornerCount) break;
      if (l.name === ".corner_vert" || l.name === ".corner_edge") continue;
      let arr = null;
      if (l.type === 16) arr = readVecLayer(reader, l, cornerCount, 2, 12); // CD_MLOOPUV (uv + flag)
      else if (l.type === 49) arr = readVecLayer(reader, l, cornerCount, 2); // CD_PROP_FLOAT2
      if (!arr) continue;
      uvMaps[l.name || "UVMap" + (uvFallback || "")] = arr;
      uvFallback++;
    }

    /* ---- colour layers (point *or* corner domain) ---- */
    const colorMaps = {};
    const readColor = (l, count) => {
      if (l.type === 47) return readVecLayer(reader, l, count, 4); // CD_PROP_COLOR (float4, linear)
      if (l.type === 17 || l.type === 6) {
        const bgra = l.type === 6; // legacy MCol stored B,G,R,A
        const stride = strideOf(l, count, 4);
        const arr = new Float32Array(count * 4);
        for (let i = 0; i < count; i++) {
          const o = l.dataOffset + i * stride;
          const b = reader.readUint8(o + (bgra ? 0 : 2));
          const g = reader.readUint8(o + 1);
          const r = reader.readUint8(o + (bgra ? 2 : 0));
          const a = reader.readUint8(o + 3);
          arr[i * 4] = srgbToLinear(r / 255);
          arr[i * 4 + 1] = srgbToLinear(g / 255);
          arr[i * 4 + 2] = srgbToLinear(b / 255);
          arr[i * 4 + 3] = a / 255;
        }
        return arr;
      }
      return null;
    };
    /* vdata layers are point-domain, ldata layers are corner-domain. */
    for (const l of vLayers) {
      if (l.type !== 47 && l.type !== 17) continue;
      if (!vertexCount) continue;
      const arr = readColor(l, vertexCount);
      if (arr) colorMaps[l.name || "Color"] = arr;
    }
    for (const l of lLayers) {
      if (l.type !== 47 && l.type !== 17 && l.type !== 6) continue;
      if (!cornerCount) continue;
      const arr = readColor(l, cornerCount);
      if (arr) colorMaps[l.name || "Color"] = arr;
    }
    if (mfaceColor && !Object.keys(colorMaps).length) colorMaps.Color = mfaceColor;

    out.push({
      name,
      vertexCount,
      faceCount: Math.max(faceCount, Math.max(0, faceOffsets.length - 1)),
      cornerCount: cornerVertices.length,
      positions,
      cornerVertices,
      faceOffsets,
      materialIndices,
      slotNames: readSlotNames(data, meshLayout, block, totcol),
      uvMaps,
      colorMaps,
      dvert: readDeformVerts(data, block, vertexCount),
      vertexGroupNames: [],
    });
  }
  return out;
}

function readSlotNames(data, meshLayout, meshBlock, totcol) {
  const reader = data.reader;
  const f = meshLayout.fieldByName.get("mat");
  if (!f || totcol <= 0) return [];
  const block = reader.blockAt(reader.readPointer(meshBlock.dataOffset + f.offset), meshBlock.dataOffset);
  if (!block) return [];
  let idLayout;
  try {
    idLayout = reader.layoutOf("ID");
  } catch {
    return [];
  }
  const fName = reader.fieldOf(idLayout, "name");
  const names = [];
  for (let i = 0; i < totcol; i++) {
    const ptr = reader.readPointer(block.dataOffset + i * reader.header.pointerSize);
    const mb = reader.blockAt(ptr);
    if (!mb) {
      names.push("");
      continue;
    }
    const raw = reader.readCString(mb.dataOffset + fName.offset, 64);
    names.push(raw.startsWith("MA") ? raw.slice(2) : raw);
  }
  return names;
}

/* ---------------------------------------------------- normalise modern meshes */

function fromModern(m) {
  const uvMaps = {};
  for (const [k, v] of Object.entries(m.uvMaps || {})) uvMaps[k] = new Float32Array(v);
  const colorMaps = {};
  for (const [k, v] of Object.entries(m.vertexColors || {})) colorMaps[k] = new Float32Array(v);
  for (const [k, v] of Object.entries(m.vertexByteColors || {})) {
    const n = Math.floor(v.length / 4);
    const arr = new Float32Array(n * 4);
    for (let i = 0; i < n * 4; i++) arr[i] = srgbToLinear(v[i] / 255);
    colorMaps[k] = arr;
  }
  return {
    name: m.name,
    vertexCount: m.vertexCount,
    faceCount: m.faceCount,
    cornerCount: m.cornerCount,
    positions: new Float32Array(m.vertices),
    cornerVertices: new Uint32Array(m.cornerVertices),
    faceOffsets: new Uint32Array(m.faceOffsets),
    materialIndices: new Uint32Array(m.materialIndices),
    slotNames: m.materialSlotNames || [],
    uvMaps,
    colorMaps,
    dvert: (m.dvert || []).map((d) => (d && d.weights ? d.weights : null)),
    vertexGroupNames: m.vertexGroupNames || [],
  };
}

/* --------------------------------------------------------------- materials */

function readMaterials(data, lib) {
  const reader = data.reader;
  let ml;
  try {
    ml = reader.layoutOf("Material");
  } catch {
    return new Map();
  }
  let idLayout;
  try {
    idLayout = reader.layoutOf("ID");
  } catch {
    return new Map();
  }
  const fId = ml.fieldByName.get("id");
  const fIdName = reader.fieldOf(idLayout, "name");
  const idOff = (fId ? fId.offset : 0) + fIdName.offset;
  const out = new Map();
  for (const block of data.blocks) {
    if (block.code !== "MA") continue;
    const base = block.dataOffset;
    const raw = reader.readCString(base + idOff, 64);
    const name = raw.startsWith("MA") ? raw.slice(2) : raw;
    const num = (n, d) => {
      const f = ml.fieldByName.get(n);
      return f ? reader.readFloat32(base + f.offset) : d;
    };
    const desc = {
      name,
      color: [num("r", 0.8), num("g", 0.8), num("b", 0.8), num("a", 1)],
      metallic: num("metallic", 0),
      roughness: num("roughness", 0.4),
      baseColorImage: null,
      normalImage: null,
    };
    const fNode = ml.fieldByName.get("nodetree");
    const hasNodes = fNode ? reader.readPointer(base + fNode.offset) !== 0n : false;
    if (hasNodes) {
      try {
        const graph = lib.readMaterialShaderGraph(data, base);
        const p = graph && graph.principled;
        if (p) {
          if (Array.isArray(p.baseColor)) desc.color = [p.baseColor[0], p.baseColor[1], p.baseColor[2], p.baseColor[3]];
          if (typeof p.metallic === "number") desc.metallic = p.metallic;
          if (typeof p.roughness === "number") desc.roughness = p.roughness;
          if (p.baseColorImage) desc.baseColorImage = p.baseColorImage;
          if (p.normalImage) desc.normalImage = p.normalImage;
        }
      } catch {
        /* node graph unreadable — the flat material fields above are still fine */
      }
    }
    out.set(name, desc);
  }
  return out;
}

async function readTextures(data, lib) {
  const map = new Map();
  let images = [];
  try {
    images = lib.extractImages(data);
  } catch {
    return map;
  }
  for (const img of images) {
    if (!img.packed || !img.packed.length) continue;
    try {
      // Browsers cannot decode TGA at all, and Blender packs .tga textures constantly,
      // so route those through our own decoder into a CanvasTexture.
      if (isTGA(img.packed, img.name)) {
        const canvas = tgaToCanvas(img.packed, (w, h) => {
          const c = document.createElement("canvas");
          c.width = w;
          c.height = h;
          return c;
        });
        const tex = new THREE.CanvasTexture(canvas);
        tex.colorSpace = THREE.SRGBColorSpace;
        tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
        tex.flipY = true;
        tex.needsUpdate = true;
        tex.userData.packedName = img.name;
        tex.userData.tga = true;
        map.set(img.name, tex);
        continue;
      }
      const blob = new Blob([img.packed]);
      const url = URL.createObjectURL(blob);
      const tex = await new THREE.TextureLoader().loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
      tex.flipY = true;
      tex.userData.packedName = img.name;
      map.set(img.name, tex);
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (e) {
      console.warn("blend: texture", img.name, "failed", e);
    }
  }
  return map;
}

function makeMaterial(desc, textures) {
  const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : lo));
  const mat = new THREE.MeshStandardMaterial({
    color: new THREE.Color(desc.color[0], desc.color[1], desc.color[2]),
    metalness: clamp(desc.metallic, 0, 1),
    roughness: clamp(desc.roughness, 0, 1),
  });
  mat.name = desc.name || "material";
  if (desc.color[3] < 0.999) {
    mat.opacity = clamp(desc.color[3], 0, 1);
    mat.transparent = true;
  }
  const map = desc.baseColorImage ? textures.get(desc.baseColorImage) : null;
  if (map) {
    mat.map = map;
    mat.color.set(0xffffff);
  }
  const normal = desc.normalImage ? textures.get(desc.normalImage) : null;
  if (normal) {
    const nm = normal.clone();
    nm.colorSpace = THREE.NoColorSpace;
    nm.needsUpdate = true;
    mat.normalMap = nm;
  }
  return mat;
}

/* ---------------------------------------------------------------- geometry */

/* Per-corner normals with angle-limited smoothing: a corner averages only the faces whose
   normal is within ~58° of its own, so a cube keeps hard edges while a sphere stays smooth. */
function computeNormals(positions, cornerVertices, faceOffsets) {
  const faceCount = Math.max(0, faceOffsets.length - 1);
  const cornerCount = cornerVertices.length;
  const faceN = new Float32Array(faceCount * 3);
  for (let f = 0; f < faceCount; f++) {
    const s = faceOffsets[f];
    const e = faceOffsets[f + 1];
    let nx = 0;
    let ny = 0;
    let nz = 0;
    for (let k = s; k < e; k++) {
      const i = cornerVertices[k] * 3;
      const j = cornerVertices[k + 1 < e ? k + 1 : s] * 3;
      const ix = positions[i];
      const iy = positions[i + 1];
      const iz = positions[i + 2];
      const jx = positions[j];
      const jy = positions[j + 1];
      const jz = positions[j + 2];
      nx += (iy - jy) * (iz + jz);
      ny += (iz - jz) * (ix + jx);
      nz += (ix - jx) * (iy + jy);
    }
    const len = Math.hypot(nx, ny, nz) || 1;
    faceN[f * 3] = nx / len;
    faceN[f * 3 + 1] = ny / len;
    faceN[f * 3 + 2] = nz / len;
  }
  const vertexCount = positions.length / 3;
  const incident = new Array(vertexCount);
  for (let f = 0; f < faceCount; f++) {
    for (let k = faceOffsets[f]; k < faceOffsets[f + 1]; k++) {
      const v = cornerVertices[k];
      (incident[v] || (incident[v] = [])).push(f);
    }
  }
  const COS = 0.53; // ~58°
  const out = new Float32Array(cornerCount * 3);
  for (let f = 0; f < faceCount; f++) {
    const fx = faceN[f * 3];
    const fy = faceN[f * 3 + 1];
    const fz = faceN[f * 3 + 2];
    for (let k = faceOffsets[f]; k < faceOffsets[f + 1]; k++) {
      const list = incident[cornerVertices[k]] || [];
      let nx = 0;
      let ny = 0;
      let nz = 0;
      for (let t = 0; t < list.length; t++) {
        const g = list[t];
        const gx = faceN[g * 3];
        const gy = faceN[g * 3 + 1];
        const gz = faceN[g * 3 + 2];
        if (gx * fx + gy * fy + gz * fz >= COS) {
          nx += gx;
          ny += gy;
          nz += gz;
        }
      }
      const len = Math.hypot(nx, ny, nz);
      if (len < 1e-6) {
        out[k * 3] = fx;
        out[k * 3 + 1] = fy;
        out[k * 3 + 2] = fz;
      } else {
        out[k * 3] = nx / len;
        out[k * 3 + 1] = ny / len;
        out[k * 3 + 2] = nz / len;
      }
    }
  }
  return out;
}

function resolveCornerColor(arr, cornerVertices, vertexCount, cornerCount) {
  if (!arr) return null;
  if (arr.length >= cornerCount * 4) return arr;
  if (arr.length >= vertexCount * 4) {
    const out = new Float32Array(cornerCount * 4);
    for (let k = 0; k < cornerCount; k++) {
      const v = cornerVertices[k] * 4;
      out[k * 4] = arr[v];
      out[k * 4 + 1] = arr[v + 1];
      out[k * 4 + 2] = arr[v + 2];
      out[k * 4 + 3] = arr[v + 3];
    }
    return out;
  }
  return null;
}

function buildGeometry(m) {
  const geo = new THREE.BufferGeometry();
  const cornerCount = m.cornerVertices.length;
  const positions = new Float32Array(cornerCount * 3);
  for (let k = 0; k < cornerCount; k++) {
    const v = m.cornerVertices[k] * 3;
    positions[k * 3] = m.positions[v] || 0;
    positions[k * 3 + 1] = m.positions[v + 1] || 0;
    positions[k * 3 + 2] = m.positions[v + 2] || 0;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  const normals = computeNormals(m.positions, m.cornerVertices, m.faceOffsets);
  geo.setAttribute("normal", new THREE.BufferAttribute(normals, 3));

  const uvNames = Object.keys(m.uvMaps || {});
  if (uvNames.length) {
    const uv = m.uvMaps[uvNames[0]];
    if (uv && uv.length >= cornerCount * 2) geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uv.subarray(0, cornerCount * 2)), 2));
    if (uvNames.length > 1) {
      const uv1 = m.uvMaps[uvNames[1]];
      if (uv1 && uv1.length >= cornerCount * 2) geo.setAttribute("uv1", new THREE.BufferAttribute(new Float32Array(uv1.subarray(0, cornerCount * 2)), 2));
    }
  }
  const colorNames = Object.keys(m.colorMaps || {});
  if (colorNames.length) {
    const col = resolveCornerColor(m.colorMaps[colorNames[0]], m.cornerVertices, m.vertexCount, cornerCount);
    if (col) geo.setAttribute("color", new THREE.BufferAttribute(col, 4));
  }

  /* Index in corner space (output vertex == corner), grouped by material index. */
  const faceCount = Math.max(0, m.faceOffsets.length - 1);
  const buckets = new Map();
  for (let f = 0; f < faceCount; f++) {
    const s = m.faceOffsets[f];
    const e = m.faceOffsets[f + 1];
    if (e - s < 3) continue;
    const mat = m.materialIndices[f] | 0;
    let arr = buckets.get(mat);
    if (!arr) {
      arr = [];
      buckets.set(mat, arr);
    }
    for (let k = s + 1; k < e - 1; k++) arr.push(s, k, k + 1);
  }
  let total = 0;
  for (const arr of buckets.values()) total += arr.length;
  const index = total > 65535 ? new Uint32Array(total) : new Uint16Array(total);
  let cursor = 0;
  const groups = [];
  for (const [mat, arr] of buckets) {
    for (let i = 0; i < arr.length; i++) index[cursor + i] = arr[i];
    groups.push({ start: cursor, count: arr.length, materialIndex: mat });
    cursor += arr.length;
  }
  geo.setIndex(new THREE.BufferAttribute(index, 1));
  for (const g of groups) geo.addGroup(g.start, g.count, g.materialIndex);
  geo.computeBoundingSphere();
  geo.computeBoundingBox();
  return geo;
}

/* ------------------------------------------------------------------ assemble */

function safe(fn, fallback) {
  try {
    return fn();
  } catch (e) {
    console.warn("blend:", e && e.message ? e.message : e);
    return fallback;
  }
}

function flattenBones(rootBones) {
  const out = [];
  const walk = (b) => {
    out.push(b);
    for (const c of b.children) walk(c);
  };
  for (const b of rootBones) walk(b);
  return out;
}

function defaultMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xc9ced9, roughness: 0.5, metalness: 0.12 });
}

function buildScene(parts) {
  const { objects, meshByName, matMap, textures, armatures, groups, clips } = parts;
  const root = new THREE.Group();
  root.name = "blend";
  /* Blender is Z-up; the viewer is Y-up. Stand the whole scene on its feet. */
  root.rotation.x = -Math.PI / 2;

  const matCache = new Map();
  const geoCache = new Map();
  const instances = [];

  const materialsFor = (md) => {
    const slots = md.slotNames && md.slotNames.length ? md.slotNames : [""];
    return slots.map((slotName) => {
      if (matCache.has(slotName)) return matCache.get(slotName);
      const desc = matMap.get(slotName);
      const mat = desc ? makeMaterial(desc, textures) : defaultMaterial();
      mat.name = slotName || "material";
      matCache.set(slotName, mat);
      return mat;
    });
  };

  const objectByName = new Map();
  for (const o of objects) if (!objectByName.has(o.name)) objectByName.set(o.name, o);

  const rigCache = new Map();
  const skeletonForArmatureObject = (obj) => {
    if (!obj || obj.type !== 25) return null;
    if (rigCache.has(obj.name)) return rigCache.get(obj.name);
    const raw = armatures.get(obj.dataName) || armatures.get("AR" + obj.dataName);
    if (!raw) return null;
    const handle = buildSkeleton(raw, obj.world);
    const bones = flattenBones(handle.rootBones);
    handle.bones = bones;
    handle.index = new Map(bones.map((b, i) => [b.name, i]));
    root.add(handle.group);
    rigCache.set(obj.name, handle);
    return handle;
  };

  const armatureOfMeshObject = (obj) => {
    let p = obj.parentName ? objectByName.get(obj.parentName) : null;
    let guard = 0;
    while (p && guard++ < 128) {
      if (p.type === 25) return skeletonForArmatureObject(p);
      p = p.parentName ? objectByName.get(p.parentName) : null;
    }
    const only = objects.filter((o) => o.type === 25);
    return only.length === 1 ? skeletonForArmatureObject(only[0]) : null;
  };

  const geometryFor = (md) => {
    if (geoCache.has(md.name)) return geoCache.get(md.name);
    const g = buildGeometry(md);
    geoCache.set(md.name, g);
    return g;
  };

  const skinnedGeometryFor = (md, handle, groupNames) => {
    const key = "skin:" + md.name;
    if (geoCache.has(key)) return geoCache.get(key);
    const g = buildGeometry(md);
    const skin = buildSkinAttributes(md.cornerVertices, md.dvert, groupNames, handle.index);
    if (skin.skinned) {
      g.setAttribute("skinIndex", new THREE.BufferAttribute(skin.skinIndex, 4));
      g.setAttribute("skinWeight", new THREE.BufferAttribute(skin.skinWeight, 4));
    }
    geoCache.set(key, g);
    return g;
  };

  const addInstance = (md, obj) => {
    const slots = materialsFor(md);
    const materials = slots.length > 1 ? slots : slots[0];
    const handle = obj ? armatureOfMeshObject(obj) : null;
    const groupNames = (obj && groups.byObject.get(obj.name)) || md.vertexGroupNames || [];
    let mesh;
    if (handle && md.dvert && handle.index.size) {
      const geo = skinnedGeometryFor(md, handle, groupNames);
      if (geo.getAttribute("skinIndex")) {
        mesh = new THREE.SkinnedMesh(geo, materials);
        mesh.userData.rig = handle;
      }
    }
    if (!mesh) mesh = new THREE.Mesh(geometryFor(md), materials);
    mesh.name = obj && obj.name ? obj.name : md.name || "mesh";
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (mesh.isSkinnedMesh || (mesh.morphTargetInfluences && mesh.morphTargetInfluences.length)) mesh.frustumCulled = false;
    if (obj) {
      const p = new THREE.Vector3();
      const q = new THREE.Quaternion();
      const s = new THREE.Vector3();
      obj.world.decompose(p, q, s);
      mesh.position.copy(p);
      mesh.quaternion.copy(q);
      mesh.scale.copy(s);
    }
    root.add(mesh);
    instances.push(mesh);
    return mesh;
  };

  const used = new Set();
  for (const obj of objects) {
    if (obj.type !== 1) continue;
    const md = meshByName.get(obj.dataName);
    if (!md) continue;
    used.add(md.name);
    addInstance(md, obj);
  }
  /* Meshes not referenced by any object (or a broken object list) still belong in the scene. */
  for (const md of meshByName.values()) {
    if (used.has(md.name)) continue;
    if (!md.faceCount) continue;
    addInstance(md, null);
  }

  /* Bind skinned meshes once every bone world matrix exists. */
  root.updateMatrixWorld(true);
  for (const mesh of instances) {
    if (!mesh.isSkinnedMesh || !mesh.userData.rig) continue;
    mesh.bind(new THREE.Skeleton(mesh.userData.rig.bones));
  }

  root.animations = clips || [];
  return root;
}

export async function loadBlendFile(file) {
  const raw = new Uint8Array(await file.arrayBuffer());
  const bytes = await decompress(raw);
  const lib = await jsblender();
  let data;
  try {
    data = lib.parseBlend(bytes);
  } catch (e) {
    throw new Error("Couldn't read this .blend file: " + (e && e.message ? e.message : e));
  }

  const reader = data.reader;
  let meshLayout;
  try {
    meshLayout = reader.layoutOf("Mesh");
  } catch {
    throw new Error("This .blend file contains no mesh data.");
  }

  let meshes;
  if (meshLayout.fieldByName.has("attribute_storage")) {
    meshes = safe(() => lib.extractMeshes(data).map(fromModern), null);
  }
  if (!meshes) meshes = extractMeshesLegacy(data, meshLayout);

  const meshByName = new Map();
  for (const md of meshes) meshByName.set(md.name, md);

  const matMap = safe(() => readMaterials(data, lib), new Map());
  const textures = await readTextures(data, lib);
  const objects = safe(() => readBlendObjects(data), []);
  const armatures = safe(() => readArmatures(data, lib), new Map());
  const groups = safe(() => readDeformGroups(data), { byObject: new Map(), byMesh: new Map() });
  const fps = safe(() => readSceneFps(data), 24);

  const byObjectName = new Map();
  for (const o of objects) if (!byObjectName.has(o.name)) byObjectName.set(o.name, o);

  const rigByArmature = new Map();
  const boneIndexForObject = (objectName) => {
    const obj = byObjectName.get(objectName);
    if (!obj || obj.type !== 25) return null;
    const raw2 = armatures.get(obj.dataName) || armatures.get("AR" + obj.dataName);
    if (!raw2) return null;
    if (!rigByArmature.has(obj.name)) {
      const handle = buildSkeleton(raw2, obj.world);
      handle.index = new Map(flattenBones(handle.rootBones).map((b, i) => [b.name, i]));
      rigByArmature.set(obj.name, handle);
    }
    return rigByArmature.get(obj.name).index;
  };

  const clips = safe(() => buildClips(data, { fps, bonesForObject: boneIndexForObject }), []);

  const group = buildScene({ objects, meshByName, matMap, textures, armatures, groups, clips });
  const skinned = [];
  group.traverse((o) => {
    if (o.isSkinnedMesh && o.userData.rig) skinned.push(o.userData.rig.index.size);
  });
  group.userData.blendInfo = {
    version: data.header.versionString,
    meshes: meshByName.size,
    materials: matMap.size,
    textures: textures.size,
    objects: objects.filter((o) => o.type === 1).length,
    bones: Math.max(0, ...skinned),
    skinnedMeshes: skinned.length,
    clips: clips.length,
    fps,
  };
  return group;
}
