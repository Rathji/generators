/* Bundled test fixtures for the Text→3D pipeline.
 *
 * Real artefacts captured during development, shipped with the generator so the
 * whole pipeline can be exercised (and regression-tested) without any external
 * files:
 *
 *   test-assets/image-01…08.jpg   eight input images used for image→3D runs
 *   test-assets/model-01…08.glb   the GLB exports produced from those runs
 *                                 (each carries its own baked texture + solid shell)
 *   test-assets/model-solid-01.glb  one high-poly (≈113k vert) solid-volume export
 *
 * The binaries are fetched lazily — importing this module is free. Everything
 * under src/test-assets/ is public and ships with the generator.
 */

const BASE = new URL("./test-assets/", import.meta.url);

function entry(kind, file, extra = {}) {
  return {
    kind,
    id: file.replace(/\.[^.]+$/, ""),
    file,
    url: new URL(file, BASE).href,
    ...extra,
  };
}

export const TEST_IMAGES = [
  entry("image", "image-01.jpg", { label: "Input image 01" }),
  entry("image", "image-02.jpg", { label: "Input image 02" }),
  entry("image", "image-03.jpg", { label: "Input image 03" }),
  entry("image", "image-04.jpg", { label: "Input image 04" }),
  entry("image", "image-05.jpg", { label: "Input image 05" }),
  entry("image", "image-06.jpg", { label: "Input image 06" }),
  entry("image", "image-07.jpg", { label: "Input image 07" }),
  entry("image", "image-08.jpg", { label: "Input image 08" }),
];

export const TEST_MODELS = [
  entry("model", "model-01.glb", { label: "Model 01" }),
  entry("model", "model-02.glb", { label: "Model 02" }),
  entry("model", "model-03.glb", { label: "Model 03" }),
  entry("model", "model-04.glb", { label: "Model 04" }),
  entry("model", "model-05.glb", { label: "Model 05" }),
  entry("model", "model-06.glb", { label: "Model 06" }),
  entry("model", "model-07.glb", { label: "Model 07" }),
  entry("model", "model-08.glb", { label: "Model 08" }),
  entry("model", "model-solid-01.glb", { label: "Solid volume (high-poly)", solid: true }),
];

export const TEST_ASSETS = { images: TEST_IMAGES, models: TEST_MODELS };

export function listTestAssets() {
  return { images: TEST_IMAGES.map((a) => ({ ...a })), models: TEST_MODELS.map((a) => ({ ...a })) };
}

function find(list, ref) {
  if (typeof ref === "number") return list[ref] || null;
  return list.find((a) => a.id === ref || a.file === ref) || null;
}

export async function fetchTestAsset(ref, kind = "model") {
  const list = kind === "image" ? TEST_IMAGES : TEST_MODELS;
  const asset = find(list, ref);
  if (!asset) throw new Error("Unknown test asset: " + ref);
  const res = await fetch(asset.url);
  if (!res.ok) throw new Error(`Failed to fetch ${asset.file} (HTTP ${res.status})`);
  return { asset, blob: await res.blob() };
}

export async function testImageFile(ref) {
  const { asset, blob } = await fetchTestAsset(ref, "image");
  return new File([blob], asset.file, { type: blob.type || "image/jpeg" });
}

export async function testModelFile(ref) {
  const { asset, blob } = await fetchTestAsset(ref, "model");
  return new File([blob], asset.file, { type: "model/gltf-binary" });
}

/* Cheap GLB header reader — used by the self-check to report geometry counts
   without pulling in a full loader. Returns null when the blob isn't a GLB. */
export function glbSummary(buffer) {
  try {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== 0x46546c67) return null; // "glTF"
    const jsonLen = dv.getUint32(12, true);
    const json = JSON.parse(new TextDecoder().decode(new Uint8Array(buffer, 20, jsonLen)));
    let vertices = 0;
    let triangles = 0;
    for (const mesh of json.meshes || []) {
      for (const prim of mesh.primitives || []) {
        const pos = json.accessors[prim.attributes?.POSITION];
        if (pos) vertices += pos.count;
        if (prim.indices != null) triangles += json.accessors[prim.indices].count / 3;
      }
    }
    return {
      vertices,
      triangles: Math.round(triangles),
      materials: (json.materials || []).length,
      textures: (json.images || []).length,
      generator: json.asset?.generator || "",
    };
  } catch {
    return null;
  }
}
