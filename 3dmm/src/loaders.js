import { THREE, GLTFLoader, DRACOLoader, KTX2Loader, MeshoptDecoder, OBJLoader, STLLoader, FBXLoader, PLYLoader, ColladaLoader } from "./three.js";
import { loadBlendFile } from "./blend.js";

export const MODEL_EXTS = [".glb", ".gltf", ".obj", ".stl", ".fbx", ".ply", ".dae", ".blend"];
export const IMAGE_EXTS = [".png", ".jpg", ".jpeg", ".webp", ".gif", ".bmp", ".tga", ".icb", ".vda", ".vst"];

/* TGA is a first-class Blender format but no browser can decode it - so anything that
   turns an image File into pixels must special-case it (see ./tga.js). */
export function isTgaFile(file) {
  if (!file) return false;
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  return /\.(tga|icb|vda|vst)$/.test(name) || type === "image/x-tga" || type === "image/tga" || type === "image/x-targa";
}

/* Absolute base URL for a /src/decoders/<sub>/ asset. The loaders fetch these from a
   worker / by XHR, so they must not be resolved relative to an arbitrary module URL.
   Resolve against the page URL: relative paths drop the page's last path segment, which
   is what the rest of the app's `src/...` references rely on. */
function decoderBase(sub) {
  try {
    return new URL("src/decoders/" + sub + "/", window.location.href).href;
  } catch (e) {
    return "src/decoders/" + sub + "/";
  }
}

let rendererRef = null;
let gltfLoader = null;

/* KTX2 transcoding needs a renderer to pick the right GPU texture format, so the app
   hands its renderer in right after creating it. */
export function setLoaderRenderer(renderer) {
  rendererRef = renderer;
  gltfLoader = null;
}

/* A single GLTFLoader pre-wired with the optional glTF extensions that real-world files
   use: Draco mesh compression, Meshopt, and KTX2/Basis textures. Each is added lazily and
   defensively so a decoder that fails to initialise never breaks plain glTF loading. */
export function getGLTFLoader() {
  if (gltfLoader) return gltfLoader;
  const loader = new GLTFLoader();
  try {
    const draco = new DRACOLoader();
    draco.setDecoderPath(decoderBase("draco"));
    draco.setDecoderConfig({ type: "wasm" });
    loader.setDRACOLoader(draco);
  } catch (e) {
    console.warn("Draco decoder unavailable", e);
  }
  try {
    const ktx2 = new KTX2Loader();
    ktx2.setTranscoderPath(decoderBase("basis"));
    if (rendererRef) ktx2.detectSupport(rendererRef);
    loader.setKTX2Loader(ktx2);
  } catch (e) {
    console.warn("KTX2 decoder unavailable", e);
  }
  try {
    loader.setMeshoptDecoder(MeshoptDecoder);
  } catch (e) {
    console.warn("Meshopt decoder unavailable", e);
  }
  gltfLoader = loader;
  return loader;
}

export function fileKind(file) {
  const name = (file.name || "").toLowerCase();
  const type = (file.type || "").toLowerCase();
  if (type.startsWith("image/")) return "image";
  if (IMAGE_EXTS.some((e) => name.endsWith(e))) return "image";
  if (MODEL_EXTS.some((e) => name.endsWith(e)) || /\.blend[0-9]+$/.test(name)) return "model";
  if (type === "text/plain" || name.endsWith(".txt")) return "text";
  return "unknown";
}

function solidMaterial() {
  return new THREE.MeshStandardMaterial({ color: 0xc9ced9, roughness: 0.5, metalness: 0.12 });
}

function markShadows(object) {
  object.traverse((o) => {
    if (o.isMesh) {
      o.castShadow = true;
      o.receiveShadow = true;
      // A skinned mesh's bounding box is computed from the bind pose; an animation
      // can push vertices well outside it, so let the GPU keep drawing it.
      if (o.isSkinnedMesh) o.frustumCulled = false;
      // Morph targets change the silhouette for the same reason.
      if (o.morphTargetInfluences && o.morphTargetInfluences.length) o.frustumCulled = false;
    }
  });
  return object;
}

/* Make a loaded model describe itself uniformly: every animation clip that travelled with
   the file is attached to the object's own `.animations`, so a single traversal finds them
   regardless of which node the loader parked them on (see anim.js / armature.js). */
function adoptAnimations(object, clips) {
  const list = (clips || []).filter(Boolean);
  if (list.length) object.animations = list;
  else if (!object.animations) object.animations = [];
  return object;
}

export async function loadModelFile(file) {
  const name = (file.name || "").toLowerCase();
  const url = URL.createObjectURL(file);
  try {
    if (name.endsWith(".glb") || name.endsWith(".gltf")) {
      const gltf = await getGLTFLoader().loadAsync(url);
      return markShadows(adoptAnimations(gltf.scene, gltf.animations));
    }
    if (name.endsWith(".obj")) {
      const obj = new OBJLoader().parse(await file.text());
      obj.traverse((o) => {
        if (o.isMesh) o.material = solidMaterial();
      });
      return markShadows(adoptAnimations(obj));
    }
    if (name.endsWith(".stl")) {
      const geo = new STLLoader().parse(await file.arrayBuffer());
      geo.computeVertexNormals();
      return markShadows(adoptAnimations(new THREE.Mesh(geo, solidMaterial())));
    }
    if (name.endsWith(".fbx")) {
      const obj = new FBXLoader().parse(await file.arrayBuffer(), "");
      obj.traverse((o) => {
        if (o.isMesh) {
          const mats = Array.isArray(o.material) ? o.material : [o.material];
          // Keep an FBX material when it actually carries a texture; only fall back
          // to a neutral solid for bare, untextured Phong materials.
          const hasTexture = mats.some((m) => m && (m.map || m.emissiveMap || m.normalMap));
          if (!mats.length || mats.some((m) => !m) || (!hasTexture && mats.some((m) => m.type === "MeshPhongMaterial"))) {
            o.material = solidMaterial();
          }
        }
      });
      return markShadows(adoptAnimations(obj, obj.animations));
    }
    if (name.endsWith(".ply")) {
      const geo = new PLYLoader().parse(await file.arrayBuffer());
      if (!geo.attributes.normal) geo.computeVertexNormals();
      const mat = solidMaterial();
      if (geo.attributes.color) {
        mat.vertexColors = true;
        mat.color.set(0xffffff);
      }
      return markShadows(adoptAnimations(new THREE.Mesh(geo, mat)));
    }
    if (name.endsWith(".dae")) {
      const parsed = new ColladaLoader().parse(await file.text(), "");
      return markShadows(adoptAnimations(parsed.scene, parsed.animations));
    }
    if (name.endsWith(".blend") || /\.blend[0-9]+$/.test(name)) {
      return markShadows(adoptAnimations(await loadBlendFile(file)));
    }
    throw new Error(`Unsupported 3D file: ${file.name}`);
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 4000);
  }
}

export function normalizeObject(object, target = 2) {
  // Box3.setFromObject only composes an object's own matrix against its (possibly stale)
  // parent chain, so a freshly loaded GLB with nested transform nodes (and any skinned
  // mesh, whose real extent lives in the bones) measures far too small here. Update the
  // whole tree first or the model is scaled several times too large and framed off-screen.
  object.updateMatrixWorld(true);
  const box = new THREE.Box3().setFromObject(object);
  if (box.isEmpty()) return object;
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxDim = Math.max(size.x, size.y, size.z) || 1;
  const scale = target / maxDim;
  object.position.sub(center.multiplyScalar(scale));
  object.scale.multiplyScalar(scale);
  object.updateMatrixWorld(true);
  return object;
}
