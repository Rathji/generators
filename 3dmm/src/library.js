/* Persistent asset library.
 *
 * Every file that is imported or dragged into the app (images, GLB / GLTF / OBJ /
 * STL / FBX / PLY / DAE models) is saved to the browser's IndexedDB via the
 * kv-plugin, so it survives reloads and browser restarts. This module owns that
 * storage *and* the overlay UI ("Library" button in the panel) where the user can
 * add files, load them back into the viewer, use an image as a reference, save
 * them out, or delete them.
 *
 * Layout inside the `library` kv folder:
 *   "index"        → array of light metadata records (one per asset, newest first)
 *   "asset:<sha>"  → the raw bytes of one asset
 * The bytes are content-addressed by their SHA-256, so re-importing the same file
 * never creates a duplicate — and loading an asset from the library does not
 * re-add it (the hash already exists).
 *
 * Model previews are rendered offscreen through ./thumb.js and cached as a small
 * JPEG data-URL inside the metadata, so the grid stays instant on later opens.
 */

import { createThumbRenderer, disposeTree } from "./thumb.js";
import { loadModelFile, fileKind } from "./loaders.js";
import { isTGA, tgaToCanvas } from "./tga.js";
import { analyzeRig } from "./armature.js";
import { collectClips } from "./anim.js";
import { download } from "./exporters.js";

const INDEX_KEY = "index";
const assetKey = (id) => "asset:" + id;
const ACCEPT = "image/*,.glb,.gltf,.obj,.stl,.fbx,.ply,.dae,.txt";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(name || "");
  return m ? m[1].toLowerCase() : "";
}

function baseName(name) {
  return (name || "file").replace(/\.[^.]+$/, "");
}

function fmtBytes(n) {
  if (!Number.isFinite(n)) return "";
  if (n < 1024) return n + " B";
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + " KB";
  if (n < 1024 * 1024 * 1024) return (n / (1024 * 1024)).toFixed(1) + " MB";
  return (n / (1024 * 1024 * 1024)).toFixed(2) + " GB";
}

function fmtDate(ts) {
  try {
    return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch (e) {
    return "";
  }
}

async function sha256(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  let out = "";
  const view = new Uint8Array(digest);
  for (let i = 0; i < view.length; i++) out += view[i].toString(16).padStart(2, "0");
  return out;
}

function modelStats(object) {
  let verts = 0;
  let tris = 0;
  object.traverse((o) => {
    if (!o.isMesh) return;
    const g = o.geometry;
    if (!g || !g.attributes || !g.attributes.position) return;
    verts += g.attributes.position.count;
    tris += g.index ? g.index.count / 3 : g.attributes.position.count / 3;
  });
  return `${verts.toLocaleString()} verts · ${Math.round(tris).toLocaleString()} tris`;
}

function rigMetaOf(object) {
  try {
    const info = analyzeRig(object);
    if (info) {
      return { rigged: true, sig: info.signature, bones: info.stats.bones, skinned: info.stats.skinnedMeshes, clips: info.clips.length };
    }
  } catch (e) {
    /* fall through to animation-only metadata */
  }
  /* Not rigged, but a file can still carry clips (morph targets / node transforms). */
  try {
    const clips = collectClips(object);
    if (clips.length) {
      let morphs = 0;
      object.traverse((o) => {
        if (o.isMesh && o.morphTargetDictionary) morphs += Object.keys(o.morphTargetDictionary).length;
      });
      return { rigged: false, clips: clips.length, morphs };
    }
  } catch (e) {
    /* ignore */
  }
  return { rigged: false };
}

function drawCover(bitmap, w, h) {
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  const sw = bitmap.width || w;
  const sh = bitmap.height || h;
  const scale = Math.max(w / sw, h / sh);
  const dw = sw * scale;
  const dh = sh * scale;
  ctx.drawImage(bitmap, (w - dw) / 2, (h - dh) / 2, dw, dh);
  return canvas.toDataURL("image/jpeg", 0.78);
}

function bytesToDataURL(bytes, mime) {
  return new Promise((resolve, reject) => {
    const blob = new Blob([bytes], { type: mime || "application/octet-stream" });
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("read failed"));
    reader.readAsDataURL(blob);
  });
}

export function createLibrary({ getKv, loadFiles, setReference, toast, onChange, onVisible, getAddons, onBuildVolume, canAiVolume }) {
  let entries = [];
  let ready = false;
  let overlay = null;
  let grid = null;
  let statusEl = null;
  let input = null;
  let busyDepth = 0;
  let thumbRenderer = null;
  let tabAssets = null;
  let tabAddons = null;
  let assetsView = null;
  let addonsView = null;
  let addonsHost = null;
  let addonsCount = null;
  let addBtn = null;
  let clearBtn = null;
  let activeTab = "assets";

  const list = () => entries.slice();

  function updateBadge() {
    if (typeof onChange === "function") onChange(entries.length);
  }

  async function saveIndex() {
    const kv = getKv();
    if (!kv) return;
    try {
      await kv.library.set(INDEX_KEY, entries);
    } catch (e) {
      console.warn("library index save failed", e);
    }
  }

  async function init() {
    const kv = getKv();
    if (kv) {
      try {
        const stored = await kv.library.get(INDEX_KEY);
        if (Array.isArray(stored)) entries = stored;
      } catch (e) {
        console.warn("library load failed", e);
      }
    }
    ready = true;
    updateBadge();
    if (overlay && !overlay.hidden) render();
    return list();
  }

  /* ------------------------------------------------------------------ storage */

  async function addBytes(name, mime, rawBytes) {
    const kv = getKv();
    if (!kv) {
      toast("Local storage unavailable", 2600);
      return null;
    }
    const bytes = rawBytes instanceof Uint8Array ? rawBytes : new Uint8Array(rawBytes);
    const id = await sha256(bytes);
    const existing = entries.find((e) => e.id === id);
    if (existing) return existing;

    const kind = fileKind({ name, type: mime || "" });
    const meta = {
      id,
      name: name || "file",
      kind,
      mime: mime || "",
      ext: extOf(name),
      size: bytes.byteLength,
      addedAt: Date.now(),
      thumb: null,
      stats: null,
    };
    try {
      await kv.library.set(assetKey(id), bytes);
    } catch (e) {
      console.error("library store failed", e);
      toast("Couldn't save \"" + meta.name + "\" (too large?)", 3600);
      return null;
    }
    entries.unshift(meta);
    await saveIndex();
    updateBadge();
    unlessBusy(() => render());
    buildThumb(meta, bytes).catch((e) => console.warn("thumb build failed", e));
    return meta;
  }

  async function addFile(file) {
    try {
      const bytes = new Uint8Array(await file.arrayBuffer());
      return await addBytes(file.name || "file", file.type || "", bytes);
    } catch (e) {
      console.warn("library add failed", e);
      return null;
    }
  }

  async function addFiles(files) {
    if (!files || !files.length) return [];
    const added = [];
    beginBusy(`Saving ${files.length} file${files.length > 1 ? "s" : ""}\u2026`);
    for (const file of files) {
      const meta = await addFile(file);
      if (meta) added.push(meta);
    }
    endBusy(added.length ? `Saved ${added.length} file${added.length > 1 ? "s" : ""} to the library` : "Already in the library");
    return added;
  }

  async function getBytes(id) {
    const kv = getKv();
    if (!kv) return null;
    try {
      return await kv.library.get(assetKey(id));
    } catch (e) {
      console.warn("library byte read failed", e);
      return null;
    }
  }

  async function remove(id) {
    const kv = getKv();
    entries = entries.filter((e) => e.id !== id);
    if (kv) {
      try {
        await kv.library.delete(assetKey(id));
      } catch (e) {
        console.warn("library delete failed", e);
      }
    }
    await saveIndex();
    updateBadge();
    render();
  }

  async function clear() {
    const kv = getKv();
    const ids = entries.map((e) => e.id);
    entries = [];
    if (kv) {
      for (const id of ids) {
        try {
          await kv.library.delete(assetKey(id));
        } catch (e) {
          /* keep going */
        }
      }
    }
    await saveIndex();
    updateBadge();
    render();
  }

  /* --------------------------------------------------------------- thumbnails */

  async function buildThumb(meta, bytes) {
    if (!thumbRenderer) thumbRenderer = createThumbRenderer(240, 170);
    const mime = meta.mime || "application/octet-stream";
    if (meta.kind === "image") {
      try {
        // TGA can't be handed to createImageBitmap - decode it ourselves.
        if (isTGA(bytes, meta.name)) {
          const canvas = tgaToCanvas(bytes);
          meta.thumb = drawCover(canvas, 240, 170);
          meta.stats = `${canvas.width}\u00d7${canvas.height} px`;
        } else {
          const bitmap = await createImageBitmap(new Blob([bytes], { type: mime }));
          meta.thumb = drawCover(bitmap, 240, 170);
          meta.stats = `${bitmap.width}\u00d7${bitmap.height} px`;
          if (bitmap.close) bitmap.close();
        }
      } catch (e) {
        console.warn("image thumb failed", e);
      }
    } else if (meta.kind === "model") {
      let object = null;
      try {
        const file = new File([bytes], meta.name, { type: mime });
        object = await loadModelFile(file);
        meta.stats = modelStats(object);
        meta.rig = rigMetaOf(object);
        const canvas = document.createElement("canvas");
        const thumb = thumbRenderer.render(object, canvas);
        if (thumb) meta.thumb = thumb;
      } catch (e) {
        console.warn("model thumb failed", e);
      } finally {
        if (object) disposeTree(object);
      }
    }
    await saveIndex();
    unlessBusy(() => render());
  }

  /* --------------------------------------------------------------------- load */

  async function loadAsset(id) {
    const meta = entries.find((e) => e.id === id);
    const bytes = await getBytes(id);
    if (!bytes || !meta) {
      toast("That asset is missing from storage", 3000);
      return false;
    }
    const file = new File([bytes], meta.name, { type: meta.mime || "application/octet-stream" });
    close();
    await loadFiles([file], { skipLibrary: true });
    return true;
  }

  async function useAsReference(id) {
    const meta = entries.find((e) => e.id === id);
    if (!meta || meta.kind !== "image") return false;
    const bytes = await getBytes(id);
    if (!bytes) return false;
    const dataUrl = await bytesToDataURL(bytes, meta.mime || "image/png");
    await setReference(dataUrl, baseName(meta.name));
    close();
    return true;
  }

  /* Turn a saved image into a real solid volume with a measurable interior. The heavy work
     (depth → closed solid → measurement, or the neural network) lives in main.js; this just
     hands it the pixels. `opts.method` is "fast" (depth) or "ai" (TripoSR). */
  async function buildVolume(id, opts = {}) {
    const meta = entries.find((e) => e.id === id);
    if (!meta || meta.kind !== "image") return false;
    if (typeof onBuildVolume !== "function") return false;
    const bytes = await getBytes(id);
    if (!bytes) {
      toast("That image is missing from storage", 3000);
      return false;
    }
    const dataUrl = await bytesToDataURL(bytes, meta.mime || "image/png");
    close();
    try {
      await onBuildVolume(dataUrl, baseName(meta.name), opts);
    } catch (e) {
      console.warn("build volume failed", e);
      toast("Couldn't build a volume from that image", 3200);
      return false;
    }
    return true;
  }

  async function saveAsset(id) {
    const meta = entries.find((e) => e.id === id);
    const bytes = await getBytes(id);
    if (!bytes || !meta) {
      toast("That asset is missing from storage", 3000);
      return false;
    }
    download(new Blob([bytes], { type: meta.mime || "application/octet-stream" }), meta.name);
    return true;
  }

  /* ----------------------------------------------------------------------- UI */

  function beginBusy(text) {
    busyDepth++;
    if (statusEl) {
      statusEl.textContent = text;
      statusEl.classList.remove("warn");
    }
  }

  function endBusy(text) {
    busyDepth = Math.max(0, busyDepth - 1);
    if (statusEl) {
      statusEl.textContent = text || defaultStatus();
      statusEl.classList.remove("warn");
    }
  }

  function unlessBusy(fn) {
    if (!busyDepth) fn();
  }

  function defaultStatus() {
    if (!entries.length) return "Your library is empty. Drop files here, or use \u201cAdd files\u201d.";
    const bytes = entries.reduce((a, e) => a + (e.size || 0), 0);
    return `${entries.length} item${entries.length > 1 ? "s" : ""} \u00b7 ${fmtBytes(bytes)} stored on this device. Drop files here to add more.`;
  }

  function cardEl(meta) {
    const card = el("div", "testCard");
    card.dataset.id = meta.id;

    const thumb = el("div", "testThumb");
    if (meta.thumb) {
      const img = el("img");
      img.src = meta.thumb;
      img.alt = meta.name;
      thumb.append(img);
    } else {
      const ph = el("div", "libPlaceholder");
      ph.textContent = meta.kind === "image" ? "\ud83d\uddbc" : meta.kind === "model" ? "\u25c8" : "\ud83d\udcc4";
      thumb.append(ph);
    }
    card.append(thumb);

    card.append(el("div", "testLabel", baseName(meta.name)));
    const sub = el("div", "testStats");
    sub.textContent = [meta.stats, fmtBytes(meta.size), fmtDate(meta.addedAt)].filter(Boolean).join(" \u00b7 ");
    card.append(sub);

    if (meta.rig && meta.rig.rigged) {
      let text = `\u2723 rigged \u00b7 ${meta.rig.bones} bone${meta.rig.bones === 1 ? "" : "s"}`;
      if (meta.rig.clips) text += ` \u00b7 ${meta.rig.clips} clip${meta.rig.clips === 1 ? "" : "s"}`;
      const badge = el("div", "libRig", text);
      badge.title = `Skeleton signature ${meta.rig.sig} \u2014 load it and open Rig to inspect or share poses`;
      card.append(badge);
    } else if (meta.rig && (meta.rig.clips || meta.rig.morphs)) {
      const bits = [];
      if (meta.rig.clips) bits.push(`${meta.rig.clips} clip${meta.rig.clips === 1 ? "" : "s"}`);
      if (meta.rig.morphs) bits.push(`${meta.rig.morphs} morph${meta.rig.morphs === 1 ? "" : "s"}`);
      const badge = el("div", "libRig", "animated \u00b7 " + bits.join(" \u00b7 "));
      badge.title = "This file carries animation but no skeleton \u2014 load it and play the clips from the Animation panel";
      card.append(badge);
    }

    const canLoad = meta.kind === "image" || meta.kind === "model";
    const row1 = el("div", "testRow");
    if (canLoad) {
      const load = el("button", "btn ghost", meta.kind === "image" ? "Image \u2192 3D" : "Load");
      load.title = meta.kind === "image" ? "Build a 3D model from this image" : "Load this model into the viewer";
      load.addEventListener("click", () => loadAsset(meta.id));
      row1.append(load);
    }
    const save = el("button", "btn ghost", "Save");
    save.title = "Download this file";
    save.addEventListener("click", () => saveAsset(meta.id));
    const del = el("button", "btn ghost libDel", "\u00d7");
    del.title = "Remove from the library";
    del.addEventListener("click", () => {
      if (window.confirm(`Remove "${meta.name}" from the library?`)) remove(meta.id);
    });
    row1.append(save, del);
    card.append(row1);

    if (meta.kind === "image") {
      const row2 = el("div", "testRow");
      const ref = el("button", "btn ghost", "Use as reference");
      ref.title = "Attach this image as the reference for the next generation";
      ref.addEventListener("click", () => useAsReference(meta.id));
      row2.append(ref);
      if (typeof onBuildVolume === "function") {
        const vol = el("button", "btn ghost", "Solid");
        vol.title = "Fast: estimate depth and build a watertight solid volume, then measure it";
        vol.addEventListener("click", () => buildVolume(meta.id, { method: "fast" }));
        row2.append(vol);
        if (typeof canAiVolume === "function" && canAiVolume()) {
          const ai = el("button", "btn ghost", "AI volume");
          ai.title = "Accurate: the TripoSR neural network reconstructs a real 3D volume from this image";
          ai.addEventListener("click", () => buildVolume(meta.id, { method: "ai" }));
          row2.append(ai);
        }
      }
      card.append(row2);
    }
    return card;
  }

  function render() {
    if (!grid) return;
    grid.innerHTML = "";
    if (!ready) {
      grid.append(el("div", "libEmpty", "Loading library\u2026"));
      return;
    }
    if (!entries.length) {
      grid.append(el("div", "libEmpty", "Nothing saved yet \u2014 drop files here, or click \u201cAdd files\u201d."));
      return;
    }
    for (const meta of entries) grid.append(cardEl(meta));
  }

  function buildOverlay() {
    overlay = el("div", "testsOverlay libOverlay");
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Asset library");

    const sheet = el("div", "testsSheet");
    const head = el("div", "testsHead");
    head.append(el("span", "testsTitle", "Library"));
    const count = el("span", "testsCount", "0 items");
    head.append(count);
    head.append(el("div", "testsSpacer"));

    input = document.createElement("input");
    input.type = "file";
    input.accept = ACCEPT;
    input.multiple = true;
    input.hidden = true;
    input.addEventListener("change", () => {
      addFiles([...input.files]);
      input.value = "";
    });

    const addBtnEl = el("button", "btn ghost", "Add files");
    addBtnEl.id = "libAddBtn";
    addBtnEl.addEventListener("click", () => input.click());
    const clearBtnEl = el("button", "btn ghost", "Clear");
    clearBtnEl.id = "libClearBtn";
    clearBtnEl.title = "Remove every asset from the library";
    clearBtnEl.addEventListener("click", () => {
      if (entries.length && window.confirm("Remove all " + entries.length + " assets from the library?")) clear();
    });
    const closeBtn = el("button", "btn ghost testsClose", "\u00d7");
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", close);
    head.append(addBtnEl, clearBtnEl, closeBtn);
    addBtn = addBtnEl;
    clearBtn = clearBtnEl;

    const tabs = el("div", "libTabs");
    tabAssets = el("button", "libTab active", "Assets");
    tabAssets.addEventListener("click", () => showTab("assets"));
    tabs.append(tabAssets);
    if (typeof getAddons === "function" && getAddons()) {
      tabAddons = el("button", "libTab");
      tabAddons.append(document.createTextNode("Add-ons"));
      addonsCount = el("span", "libTabCount", "0");
      tabAddons.append(addonsCount);
      tabAddons.addEventListener("click", () => showTab("addons"));
      tabs.append(tabAddons);
    }

    statusEl = el("div", "testsStatus");
    statusEl.textContent = defaultStatus();

    grid = el("div", "testsGrid");

    assetsView = el("div", "libView");
    assetsView.append(statusEl, grid);

    addonsView = el("div", "libView");
    addonsView.hidden = true;
    addonsHost = el("div", "addonHost");
    addonsView.append(addonsHost);

    sheet.append(head, tabs, assetsView, addonsView, input);
    overlay.append(sheet);
    tabs.hidden = !tabAddons;
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });

    overlay.addEventListener("dragover", (e) => {
      e.preventDefault();
      e.stopPropagation();
      overlay.classList.add("libDropActive");
    });
    overlay.addEventListener("dragleave", (e) => {
      if (e.target === overlay || e.relatedTarget == null) overlay.classList.remove("libDropActive");
    });
    overlay.addEventListener("drop", (e) => {
      e.preventDefault();
      e.stopPropagation();
      overlay.classList.remove("libDropActive");
      const files = e.dataTransfer && e.dataTransfer.files ? [...e.dataTransfer.files] : [];
      if (files.length) addFiles(files);
    });

    (document.getElementById("app") || document.body).append(overlay);
    return overlay;
  }

  function syncCount() {
    if (!overlay) return;
    const c = overlay.querySelector(".testsCount");
    if (c) c.textContent = `${entries.length} item${entries.length === 1 ? "" : "s"}`;
    syncAddonBadge();
  }

  function syncAddonBadge() {
    if (!addonsCount) return;
    const addons = typeof getAddons === "function" ? getAddons() : null;
    addonsCount.textContent = addons ? String(addons.count) : "0";
  }

  function showTab(name) {
    if (!tabAddons) return;
    activeTab = name === "addons" ? "addons" : "assets";
    const onAddons = activeTab === "addons";
    tabAssets.classList.toggle("active", !onAddons);
    tabAddons.classList.toggle("active", onAddons);
    assetsView.hidden = onAddons;
    addonsView.hidden = !onAddons;
    if (addBtn) addBtn.hidden = onAddons;
    if (clearBtn) clearBtn.hidden = onAddons;
    if (onAddons) renderAddons();
  }

  function renderAddons() {
    const addons = typeof getAddons === "function" ? getAddons() : null;
    if (!addons || !addonsHost) return;
    addons.render(addonsHost);
    syncAddonBadge();
  }

  /* Called by the add-ons manager whenever one is switched on/off. */
  function refreshAddonBadge() {
    syncAddonBadge();
  }

  /* One-time pass: models that were added before rig metadata existed are scanned
     so their card can show a skeleton/clip summary (and the shared-pose layer knows
     what rig a saved file belongs to). Cheap models finish fast; the scan is
     skipped entirely once every model has a verdict, and unrigged ones are
     remembered so they are never rescanned. */
  let rigScanRunning = false;
  async function backfillRigs() {
    if (rigScanRunning) return;
    const todo = entries.filter((e) => e.kind === "model" && !e.rig);
    if (!todo.length) return;
    rigScanRunning = true;
    try {
      for (const meta of todo) {
        try {
          const bytes = await getBytes(meta.id);
          if (!bytes) { meta.rig = { rigged: false }; continue; }
          const file = new File([bytes], meta.name, { type: meta.mime || "application/octet-stream" });
          const object = await loadModelFile(file);
          try { meta.rig = rigMetaOf(object); } finally { disposeTree(object); }
        } catch (e) {
          console.warn("rig scan failed", meta.name, e);
          meta.rig = { rigged: false };
        }
        await saveIndex();
        unlessBusy(() => render());
      }
    } finally {
      rigScanRunning = false;
    }
  }

  function open() {
    if (!overlay) buildOverlay();
    overlay.hidden = false;
    syncCount();
    statusEl.textContent = defaultStatus();
    render();
    if (tabAddons && activeTab === "addons") showTab("addons");
    if (!ready) init().then(() => { render(); backfillRigs(); });
    else backfillRigs();
    if (typeof onVisible === "function") onVisible(true);
  }

  function close() {
    if (overlay) overlay.hidden = true;
    if (thumbRenderer) {
      thumbRenderer.dispose();
      thumbRenderer = null;
    }
    if (typeof onVisible === "function") onVisible(false);
  }

  function toggle() {
    if (overlay && !overlay.hidden) close();
    else open();
  }

  return {
    init,
    open,
    close,
    toggle,
    addFile,
    addFiles,
    addBytes,
    remove,
    clear,
    loadAsset,
    saveAsset,
    useAsReference,
    buildVolume,
    getBytes,
    list,
    refreshAddonBadge,
    showTab,
    showAddons: () => {
      if (!overlay) buildOverlay();
      if (!overlay.hidden) showTab("addons");
    },
    get isOpen() {
      return !!overlay && !overlay.hidden;
    },
    get count() {
      return entries.length;
    },
  };
}
