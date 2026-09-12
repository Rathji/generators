/* Test panel — an in-app browser for the bundled fixtures in ./test-assets/.
 *
 * Opens from the panel's "Tests" button (or `textTo3d.tests.open()`). It lists
 * every bundled input image (build a 3D model straight from it, or use it as a
 * reference) and every bundled model (render a thumbnail, load it into the
 * viewer, download it), and can run a self-check that fetches each fixture and
 * verifies it decodes / parses.
 */

import * as T3 from "./three.js";
import { TEST_IMAGES, TEST_MODELS, fetchTestAsset, testImageFile, testModelFile, glbSummary } from "./test-assets.js";
import { createThumbRenderer, disposeTree } from "./thumb.js";

export function createTestPanel() {
  let overlay = null;
  let running = false;
  let thumbRenderer = null;

  const api = () => window.textTo3d;

  function renderThumb(gltfScene, canvas) {
    if (!thumbRenderer) thumbRenderer = createThumbRenderer(240, 170);
    const url = thumbRenderer.render(gltfScene, canvas);
    disposeTree(gltfScene);
    return !!url;
  }

  function ensureTextures(root) {
    const jobs = [];
    root.traverse((o) => {
      const mats = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
      for (const m of mats) {
        for (const key of ["map", "normalMap", "roughnessMap", "metalnessMap", "emissiveMap"]) {
          const tex = m[key];
          const image = tex && tex.image;
          if (!image) continue;
          if (image.decode) jobs.push(image.decode().catch(() => {}));
          else if (image.complete === false) {
            jobs.push(
              new Promise((res) => {
                image.addEventListener("load", res, { once: true });
                image.addEventListener("error", res, { once: true });
              })
            );
          }
          tex.needsUpdate = true;
        }
      }
    });
    return Promise.all(jobs);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function buildOverlay() {
    overlay = el("div", "testsOverlay");
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Test assets");

    const sheet = el("div", "testsSheet");
    const head = el("div", "testsHead");
    head.append(el("span", "testsTitle", "Test assets"));
    const count = el("span", "testsCount", `${TEST_IMAGES.length} images · ${TEST_MODELS.length} models`);
    head.append(count);
    const spacer = el("div", "testsSpacer");
    const checkBtn = el("button", "btn ghost", "Run self-check");
    checkBtn.id = "testsCheckBtn";
    const closeBtn = el("button", "btn ghost testsClose", "\u00d7");
    closeBtn.id = "testsCloseBtn";
    closeBtn.title = "Close";
    head.append(spacer, checkBtn, closeBtn);

    const status = el("div", "testsStatus");
    status.id = "testsStatus";
    status.textContent =
      "Bundled fixtures from ./src/test-assets/. Build a model from any image, load any model, or run the self-check.";

    const grid = el("div", "testsGrid");
    grid.id = "testsGrid";

    sheet.append(head, status, grid);
    overlay.append(sheet);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    closeBtn.addEventListener("click", close);
    checkBtn.addEventListener("click", runSelfCheck);

    for (const img of TEST_IMAGES) grid.append(imageCard(img));
    for (const model of TEST_MODELS) grid.append(modelCard(model));

    (document.getElementById("app") || document.body).append(overlay);
    return overlay;
  }

  function imageCard(asset) {
    const card = el("div", "testCard");
    const thumb = el("a", "testThumb");
    thumb.href = asset.url;
    thumb.target = "_blank";
    thumb.title = "Open full size";
    const img = el("img");
    img.src = asset.url;
    img.alt = asset.label;
    thumb.append(img);
    card.append(thumb, el("div", "testLabel", asset.label));
    const row = el("div", "testRow");
    const build = el("button", "btn ghost", "Build 3D");
    build.addEventListener("click", async () => {
      close();
      await api().fromImage(asset.url, asset.label);
    });
    const ref = el("button", "btn ghost", "Reference");
    ref.title = "Use as the reference image for the next generation";
    ref.addEventListener("click", async () => {
      await api().setReference(asset.url, asset.label);
    });
    row.append(build, ref);
    card.append(row);
    return card;
  }

  function modelCard(asset) {
    const card = el("div", "testCard");
    const canvas = document.createElement("canvas");
    canvas.width = 240;
    canvas.height = 170;
    canvas.className = "testThumb testCanvas";
    card.append(canvas, el("div", "testLabel", asset.label));
    const stats = el("div", "testStats", "not loaded");
    card.append(stats);
    const row = el("div", "testRow");
    const load = el("button", "btn ghost", "Load");
    load.addEventListener("click", async () => {
      close();
      const file = await testModelFile(asset.id);
      await api().fromFiles([file]);
    });
    const dl = el("a", "btn ghost testDownload", "Download");
    dl.href = asset.url;
    dl.download = asset.file;
    row.append(load, dl);
    card.append(row);

    (async () => {
      try {
        const { blob } = await fetchTestAsset(asset.id, "model");
        const buf = await blob.arrayBuffer();
        const info = glbSummary(buf);
        stats.textContent = info
          ? `${info.vertices.toLocaleString()} verts · ${info.triangles.toLocaleString()} tris · ${info.textures} tex`
          : `${(blob.size / 1024).toFixed(0)} KB`;
        const gltf = await new T3.GLTFLoader().parseAsync(buf, "");
        await ensureTextures(gltf.scene);
        if (!renderThumb(gltf.scene, canvas)) stats.textContent += " · thumb failed";
      } catch (e) {
        stats.textContent = "failed: " + e.message;
      }
    })();
    return card;
  }

  function setStatus(text, warn) {
    const s = overlay && overlay.querySelector("#testsStatus");
    if (!s) return null;
    s.textContent = text;
    s.classList.toggle("warn", !!warn);
    return s;
  }

  async function runSelfCheck() {
    if (running || !overlay) return null;
    running = true;
    const btn = overlay.querySelector("#testsCheckBtn");
    if (btn) btn.disabled = true;
    setStatus("Running self-check\u2026");
    const results = [];
    for (const asset of TEST_IMAGES) {
      try {
        const { blob } = await fetchTestAsset(asset.id, "image");
        const bmp = await createImageBitmap(blob);
        results.push({ id: asset.id, ok: bmp.width > 0 && bmp.height > 0, detail: `${bmp.width}\u00d7${bmp.height}` });
        bmp.close?.();
      } catch (e) {
        results.push({ id: asset.id, ok: false, detail: e.message });
      }
    }
    for (const asset of TEST_MODELS) {
      try {
        const { blob } = await fetchTestAsset(asset.id, "model");
        const info = glbSummary(await blob.arrayBuffer());
        results.push({
          id: asset.id,
          ok: !!info && info.vertices > 0 && info.triangles > 0,
          detail: info ? `${info.vertices.toLocaleString()}v / ${info.triangles.toLocaleString()}t` : "not a GLB",
        });
      } catch (e) {
        results.push({ id: asset.id, ok: false, detail: e.message });
      }
    }
    const failed = results.filter((r) => !r.ok);
    const summary = `${results.length - failed.length}/${results.length} fixtures OK`;
    setStatus(summary + (failed.length ? " \u2014 failed: " + failed.map((f) => f.id).join(", ") : ""), failed.length > 0);
    if (btn) btn.disabled = false;
    running = false;
    return { summary, results };
  }

  function open() {
    if (!overlay) buildOverlay();
    overlay.hidden = false;
  }

  function close() {
    if (overlay) overlay.hidden = true;
    if (thumbRenderer) {
      thumbRenderer.dispose();
      thumbRenderer = null;
    }
  }

  function toggle() {
    if (overlay && !overlay.hidden) close();
    else open();
  }

  return {
    open,
    close,
    toggle,
    get isOpen() {
      return !!overlay && !overlay.hidden;
    },
    runSelfCheck,
    imageFile: testImageFile,
    modelFile: testModelFile,
    list: () => ({ images: TEST_IMAGES.map((a) => a.id), models: TEST_MODELS.map((a) => a.id) }),
  };
}
