/* Shared offscreen thumbnail renderer.
 *
 * Renders a small preview image of any Object3D (a freshly parsed model file, for
 * example) onto a 2D canvas. Used by the persistent asset library (see library.js)
 * and the bundled-fixture test panel (see test-panel.js), so both draw model
 * previews exactly the same way.
 *
 * The WebGL context is created with preserveDrawingBuffer so the pixels can be
 * read back with drawImage at any time, not just inside the rAF callback that
 * drew them.
 */

import * as T3 from "./three.js";

const THREE = T3.THREE;

export function createThumbRenderer(width = 240, height = 170) {
  let renderer = null;
  let scene = null;
  let camera = null;

  function ensure() {
    if (renderer) return;
    renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: true });
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    renderer.outputColorSpace = THREE.SRGBColorSpace;

    scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffffff, 0x33383f, 1.6));
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 4, 3.5);
    scene.add(key);
    const rim = new THREE.DirectionalLight(0x9fb4ff, 1.1);
    rim.position.set(-3, 1.4, -2.5);
    scene.add(rim);

    camera = new THREE.PerspectiveCamera(38, width / height, 0.01, 100);
  }

  /* Frames `object` from a 3/4 angle and writes the render onto `canvas`.
     Dispose of `object` yourself afterwards (see disposeTree). */
  function render(object, canvas) {
    ensure();
    const ctx = canvas.getContext("2d");
    canvas.width = width;
    canvas.height = height;
    try {
      scene.add(object);
      object.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(object);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDim = Math.max(size.x, size.y, size.z) || 1;
      const dist = (maxDim / (2 * Math.tan((camera.fov * Math.PI) / 360))) * 1.55;
      const dir = new THREE.Vector3(1, 0.72, 1).normalize();
      camera.position.copy(center).addScaledVector(dir, dist);
      camera.lookAt(center);
      camera.updateProjectionMatrix();
      renderer.render(scene, camera);
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(renderer.domElement, 0, 0, width, height);
      return canvas.toDataURL("image/jpeg", 0.75);
    } catch (e) {
      console.warn("thumb render failed", e);
      return null;
    } finally {
      scene.remove(object);
    }
  }

  function dispose() {
    if (!renderer) return;
    renderer.dispose();
    renderer = null;
    scene = null;
    camera = null;
  }

  return {
    render,
    dispose,
    get isReady() {
      return !!renderer;
    },
  };
}

const TEXTURE_KEYS = ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap", "aoMap", "alphaMap"];

export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.geometry) o.geometry.dispose();
    if (!o.material) return;
    for (const m of Array.isArray(o.material) ? o.material : [o.material]) {
      for (const k of TEXTURE_KEYS) if (m[k]) m[k].dispose();
      m.dispose();
    }
  });
}
