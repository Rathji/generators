import { THREE, GLTFExporter, STLExporter, OBJExporter, PLYExporter } from "./three.js";

/* STL/OBJ/PLY exporters (unlike GLTFExporter) have no `onlyVisible` option: they walk every
   mesh they can reach, so the invisible placeholders the auto-armature leaves in the graph —
   the hidden unrigged originals plus the 1-vertex `AutoArmature · bind` proxy — both double
   the geometry and crash the exporters (the proxy has no index / isn't a triangle). Export a
   pruned clone instead: drop invisible nodes (and their subtrees), share geometry + material
   by reference so it stays cheap, and keep local transforms so world space is preserved. */
function pruneInvisible(object) {
  const roots = Array.isArray(object) ? object : [object];
  const out = [];
  for (const root of roots) {
    const clone = cloneVisible(root);
    if (clone) out.push(clone);
  }
  if (!out.length) return object;
  const result = out.length === 1 ? out[0] : out;
  for (const root of Array.isArray(result) ? result : [result]) root.updateMatrixWorld(true);
  return result;
}

function cloneVisible(node) {
  if (!node || node.visible === false) return null;
  let copy;
  if (node.isMesh) copy = new THREE.Mesh(node.geometry, node.material);
  else if (node.isLine) copy = new THREE.Line(node.geometry, node.material);
  else if (node.isPoints) copy = new THREE.Points(node.geometry, node.material);
  else copy = new THREE.Object3D();
  copy.name = node.name;
  copy.position.copy(node.position);
  copy.quaternion.copy(node.quaternion);
  copy.scale.copy(node.scale);
  for (const child of node.children) {
    const childCopy = cloneVisible(child);
    if (childCopy) copy.add(childCopy);
  }
  return copy;
}

export function download(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 8000);
}

export async function toGLB(object, options = {}) {
  const exporter = new GLTFExporter();
  const animations = options.animations === false ? [] : (options.animations || collectAnimations(object));
  const opts = { binary: true, onlyVisible: true };
  if (animations.length) opts.animations = animations;
  const result = await exporter.parseAsync(object, opts);
  return new Blob([result], { type: "model/gltf-binary" });
}

/* three's GLTFExporter does not pick up clips on its own — it only writes the clips you
   hand it via `options.animations`. Every node can carry its own `.animations`, so gather
   them (de-duped by identity) across the whole export tree. */
function collectAnimations(object) {
  const seen = new Set();
  const out = [];
  const roots = Array.isArray(object) ? object : [object];
  for (const root of roots) {
    if (!root || !root.traverse) continue;
    root.traverse((o) => {
      const list = o.animations;
      if (!list || !list.length) return;
      for (const clip of list) {
        if (!clip || seen.has(clip)) continue;
        seen.add(clip);
        out.push(clip);
      }
    });
  }
  return out;
}

export function toSTL(object) {
  const exporter = new STLExporter();
  const result = exporter.parse(pruneInvisible(object), { binary: true });
  return new Blob([result], { type: "model/stl" });
}

export function toOBJ(object) {
  const exporter = new OBJExporter();
  return new Blob([exporter.parse(pruneInvisible(object))], { type: "text/plain" });
}

/* PLY carries per-vertex colours (unlike STL/OBJ), and both Blender and most DCC tools import it
   natively - handy for the AI reconstruction's coloured meshes. (three's PLYExporter returns the
   text synchronously here and ignores the onDone/options args, so we use the return value.) */
export function toPLY(object) {
  const result = new PLYExporter().parse(pruneInvisible(object));
  return new Blob([result], { type: "application/octet-stream" });
}

export function slug(value) {
  return (
    String(value || "model")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/(^-|-$)/g, "")
      .slice(0, 42) || "model"
  );
}
