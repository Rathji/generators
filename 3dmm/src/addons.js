/*
 * Add-ons — a small extension system for the app, browsable from the Library overlay.
 *
 * An add-on is a plain object with metadata (name, author, version, category,
 * description) and an `activate(api)` function that hooks into the running app:
 * it may register action buttons, build its own settings UI, or subscribe to the
 * render loop. `deactivate` is handled for it — every hook it registers is torn
 * down automatically when the add-on is switched off.
 *
 * The set of enabled add-ons is persisted through the kv-plugin (`kv.addons`),
 * so a chosen toolset survives reloads. Everything here ships with the generator;
 * no network install path is exposed.
 *
 * API handed to `activate`:
 *   app            → the live `window.textTo3d` API (scene, camera, renderer, model,
 *                    rig, anim, look, library, export, setSize, render, …)
 *   THREE          → the pinned three namespace
 *   toast(msg)     → the app's transient toast
 *   addAction(label, fn, {title, primary}) → a button on the add-on's card
 *   setPanel(node) → a DOM node rendered as the add-on's settings
 *   onFrame(fn)    → called once per rendered frame with dt; auto-removed on disable
 *   onDispose(fn)  → extra teardown
 */

import * as T3 from "./three.js";
import { download } from "./exporters.js";

const THREE = T3.THREE;

const CATEGORY_ORDER = ["View", "Render", "Animation", "Material", "Pipeline", "Utility"];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const delay = (ms) => new Promise((r) => setTimeout(r, ms));

function standardMaterials(app) {
  const mats = new Set();
  try {
    app.model.traverse((o) => {
      if (!o.isMesh) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) if (m && (m.isMeshStandardMaterial || m.isMeshPhysicalMaterial)) mats.add(m);
    });
  } catch (e) {
    /* ignore */
  }
  if (!mats.size) {
    if (app.frontMat) mats.add(app.frontMat);
    if (app.solidMat) mats.add(app.solidMat);
  }
  return mats;
}

/* Render the camera around the model and stitch the frames into a horizontal
   sprite-sheet PNG. The viewport is temporarily squared so no frame is distorted,
   then every camera/size change is restored in a `finally`. */
async function renderTurntable(api, framesArg, sizeArg) {
  const app = api.app;
  if (!app || !app.setSize) throw new Error("App not ready");
  if (!app.model || !app.model.children.length) throw new Error("Load a model first");

  const frames = Math.max(6, Math.min(72, parseInt(framesArg, 10) || 24));
  const size = Math.max(96, Math.min(512, parseInt(sizeArg, 10) || 256));
  const renderer = app.renderer;
  const cam = app.camera;
  const ctl = app.controls;

  const prevW = renderer.domElement.clientWidth || renderer.domElement.width;
  const prevH = renderer.domElement.clientHeight || renderer.domElement.height;
  const prevPos = cam.position.clone();
  const prevUp = cam.up.clone();
  const prevTarget = ctl ? ctl.target.clone() : null;

  const target = ctl ? ctl.target.clone() : new THREE.Vector3();
  const sph = new THREE.Spherical().setFromVector3(prevPos.clone().sub(target));

  const sheet = document.createElement("canvas");
  sheet.width = size * frames;
  sheet.height = size;
  const ctx = sheet.getContext("2d");
  ctx.fillStyle = "#0c0f16";
  ctx.fillRect(0, 0, sheet.width, sheet.height);

  try {
    app.setSize(size, size);
    for (let i = 0; i < frames; i++) {
      sph.theta = (i / frames) * Math.PI * 2;
      cam.position.copy(new THREE.Vector3().setFromSpherical(sph).add(target));
      cam.up.set(0, 1, 0);
      cam.lookAt(target);
      cam.updateMatrixWorld(true);
      app.render();
      ctx.drawImage(renderer.domElement, 0, 0, renderer.domElement.width, renderer.domElement.height, i * size, 0, size, size);
    }
  } finally {
    cam.position.copy(prevPos);
    cam.up.copy(prevUp);
    if (ctl && prevTarget) {
      ctl.target.copy(prevTarget);
      ctl.update();
    }
    app.setSize(prevW, prevH);
    app.render();
  }

  const label = (app.model.userData && app.model.userData.label) || "model";
  const blob = await new Promise((r) => sheet.toBlob(r, "image/png"));
  if (!blob) throw new Error("Could not encode the image");
  download(blob, `${label}-turntable-${frames}.png`);
  api.toast(`Turntable saved · ${frames} frames`);
  return { frames, size };
}

export const BUILTIN_ADDONS = [
  {
    id: "stats-hud",
    name: "Stats HUD",
    icon: "\u25a4",
    category: "Utility",
    version: "1.0",
    author: "3D Model Maker",
    description:
      "A live readout over the viewport: fps, triangles, draw calls, vertices, meshes — plus bones and clip count when the model is rigged.",
    tags: ["overlay", "fps", "diagnostics"],
    activate(api) {
      const host = document.querySelector("#stage") || document.body;
      const hud = el("div", "addonHud");
      host.append(hud);
      let frames = 0;
      let last = performance.now();
      api.onFrame(() => {
        frames++;
        const now = performance.now();
        if (now - last < 500) return;
        const fps = Math.round((frames * 1000) / (now - last));
        frames = 0;
        last = now;
        const app = api.app;
        if (!app) return;
        const r = app.renderer;
        let verts = 0;
        let meshes = 0;
        try {
          app.model.traverse((o) => {
            if (!o.isMesh) return;
            meshes++;
            const g = o.geometry;
            if (g && g.attributes && g.attributes.position) verts += g.attributes.position.count;
          });
        } catch (e) {
          /* ignore */
        }
        let t = `${fps} fps \u00b7 ${(r.info.render.triangles || 0).toLocaleString()} tris \u00b7 ${r.info.render.calls} calls \u00b7 ${verts.toLocaleString()} verts \u00b7 ${meshes} mesh${meshes === 1 ? "" : "es"}`;
        const rig = app.rig;
        if (rig) t += ` \u00b7 ${rig.boneCount} bones \u00b7 ${rig.clips.length} clips`;
        hud.textContent = t;
      });
      api.onDispose(() => hud.remove());
    },
  },
  {
    id: "view-presets",
    name: "View presets",
    icon: "\u2316",
    category: "View",
    version: "1.0",
    author: "3D Model Maker",
    description:
      "One-click camera angles — front, back, left, right, top and isometric — framed on the model at its current distance.",
    tags: ["camera", "framing", "orbit"],
    activate(api) {
      const DIRS = {
        front: [0, 0, 1],
        back: [0, 0, -1],
        left: [-1, 0, 0],
        right: [1, 0, 0],
        top: [0, 1, 0.0001],
        iso: [1, 0.85, 1],
      };
      const go = (key) => {
        const app = api.app;
        if (!app) return;
        const cam = app.camera;
        const ctl = app.controls;
        const target = ctl ? ctl.target.clone() : new THREE.Vector3();
        const dist = Math.max(1.2, cam.position.distanceTo(target));
        cam.up.set(0, 1, 0);
        if (key === "top") cam.up.set(0, 0, -1);
        cam.position.copy(target).add(new THREE.Vector3(...DIRS[key]).normalize().multiplyScalar(dist));
        cam.lookAt(target);
        if (ctl) ctl.update();
        app.render();
      };
      for (const label of ["Front", "Right", "Top", "Iso", "Back", "Left"]) {
        api.addAction(label, () => go(label.toLowerCase()));
      }
    },
  },
  {
    id: "turntable",
    name: "Turntable render",
    icon: "\u21bb",
    category: "Render",
    version: "1.0",
    author: "3D Model Maker",
    description:
      "Orbits the camera around the model and writes a horizontal sprite-sheet PNG (one frame per step) — a rotation strip you can inspect or use as a texture.",
    tags: ["render", "spin", "sprite", "capture"],
    activate(api) {
      const framesIn = document.createElement("input");
      framesIn.type = "number";
      framesIn.min = "6";
      framesIn.max = "72";
      framesIn.value = "24";
      framesIn.className = "addonNum";
      const sizeIn = document.createElement("input");
      sizeIn.type = "number";
      sizeIn.min = "96";
      sizeIn.max = "512";
      sizeIn.step = "32";
      sizeIn.value = "256";
      sizeIn.className = "addonNum";

      const panel = el("div", "addonRow");
      panel.append(el("label", "addonField", "Frames"), framesIn, el("label", "addonField", "Cell px"), sizeIn);
      api.setPanel(panel);

      api.addAction("Render turntable", () => renderTurntable(api, framesIn.value, sizeIn.value), { primary: true });
    },
  },
  {
    id: "auto-ground",
    name: "Auto-ground",
    icon: "\u2b13",
    category: "Utility",
    version: "1.0",
    author: "3D Model Maker",
    description:
      "Drops the model so its lowest point rests exactly on the floor grid, and can do it automatically whenever a new model is built or loaded.",
    tags: ["floor", "placement", "scene"],
    activate(api) {
      const apply = (silent) => {
        const app = api.app;
        if (!app || !app.model || !app.model.children.length) {
          if (!silent) api.toast("Load a model first");
          return;
        }
        const g = app.model;
        g.updateMatrixWorld(true);
        const box = new THREE.Box3().setFromObject(g);
        if (box.isEmpty()) {
          if (!silent) api.toast("Model has no geometry");
          return;
        }
        const floorY = app.ground ? app.ground.position.y : 0;
        g.position.y += floorY - box.min.y;
        g.updateMatrixWorld(true);
        app.render();
        if (!silent) api.toast("Model grounded");
      };

      const chk = document.createElement("input");
      chk.type = "checkbox";
      const label = el("label", "check addonCheck");
      label.append(chk, el("span", null, "Ground automatically on load"));
      api.setPanel(label);

      let sig = null;
      api.onFrame(() => {
        if (!chk.checked) return;
        const app = api.app;
        if (!app || !app.model) return;
        const s = app.model.children.length + "|" + ((app.model.userData && app.model.userData.label) || "");
        if (s !== sig) {
          sig = s;
          if (app.model.children.length) apply(true);
        }
      });

      api.addAction("Ground model", () => apply(false), { primary: true });
    },
  },
  {
    id: "auto-play",
    name: "Auto-play animation",
    icon: "\u25b6",
    category: "Animation",
    version: "1.0",
    author: "3D Model Maker",
    description:
      "Starts the model's first animation clip the moment a file carrying animation is loaded, so rigged and animated models come to life on import.",
    tags: ["animation", "clip", "playback"],
    activate(api) {
      let armedFor = null;
      api.onFrame(() => {
        const app = api.app;
        const a = app && app.anim;
        if (!a) return;
        const root = (app.model && app.model.children[0]) || null;
        if (!root) {
          armedFor = null;
          return;
        }
        if (!a.clips.length || armedFor === root) return;
        armedFor = root;
        if (a.clipIndex < 0 && !a.playing) {
          try {
            a.playClip(0);
          } catch (e) {
            /* ignore */
          }
        }
      });
    },
  },
  {
    id: "material-presets",
    name: "Material presets",
    icon: "\u25cd",
    category: "Material",
    version: "1.0",
    author: "3D Model Maker",
    description:
      "Quick PBR presets applied to the model's materials — clay, polished metal, brushed metal, matte plastic and glossy resin.",
    tags: ["material", "pbr", "shading"],
    activate(api) {
      const PRESETS = {
        Clay: { roughness: 0.95, metalness: 0.0 },
        "Polished metal": { roughness: 0.18, metalness: 0.95 },
        "Brushed metal": { roughness: 0.45, metalness: 0.85 },
        "Matte plastic": { roughness: 0.62, metalness: 0.04 },
        "Glossy resin": { roughness: 0.12, metalness: 0.2 },
      };
      const apply = (name) => {
        const app = api.app;
        if (!app) return;
        const p = PRESETS[name];
        for (const m of standardMaterials(app)) {
          m.roughness = p.roughness;
          m.metalness = p.metalness;
          m.needsUpdate = true;
        }
        app.render();
        api.toast(name + " applied");
      };
      for (const name of Object.keys(PRESETS)) api.addAction(name, () => apply(name));
    },
  },
  {
    id: "export-all",
    name: "Export all formats",
    icon: "\u21e9",
    category: "Pipeline",
    version: "1.0",
    author: "3D Model Maker",
    description:
      "Saves the current model in several export formats in one go, named after the model. Pick which formats below.",
    tags: ["export", "batch", "pipeline"],
    activate(api) {
      const formats = ["glb", "obj", "stl", "ply"];
      const boxes = new Map();
      const panel = el("div", "addonRow");
      for (const f of formats) {
        const chk = document.createElement("input");
        chk.type = "checkbox";
        chk.checked = true;
        boxes.set(f, chk);
        const label = el("label", "check addonCheck");
        label.append(chk, el("span", null, f.toUpperCase()));
        panel.append(label);
      }
      api.setPanel(panel);

      api.addAction(
        "Export all",
        async () => {
          const app = api.app;
          if (!app || !app.export) return;
          const chosen = formats.filter((f) => boxes.get(f).checked);
          for (const f of chosen) {
            await app.export(f);
            await delay(260);
          }
          if (chosen.length) api.toast(`Exported ${chosen.length} format${chosen.length === 1 ? "" : "s"}`);
        },
        { primary: true }
      );
    },
  },
  {
    id: "look-randomizer",
    name: "Look randomizer",
    icon: "\u2726",
    category: "Material",
    version: "1.0",
    author: "3D Model Maker",
    description:
      "Rolls a random environment, lighting rig and post-processing grade — a fast way to find a flattering presentation for the current model.",
    tags: ["look", "preset", "random", "realism"],
    activate(api) {
      const LOOKS = ["studio", "cinematic", "product", "dramatic", "outdoor", "sunset", "night"];
      api.addAction(
        "Randomize look",
        () => {
          const app = api.app;
          if (!app || !app.look) return;
          const name = LOOKS[Math.floor(Math.random() * LOOKS.length)];
          app.look.setPreset(name);
          api.toast("Look: " + name);
        },
        { primary: true }
      );
    },
  },
];

export function createAddons({ getKv, getApp, toast, onChange } = {}) {
  const state = new Map();
  for (const def of BUILTIN_ADDONS) state.set(def.id, { def, enabled: false, reg: null });

  const frameHooks = new Set();
  let ready = false;
  let repaint = null;

  const say = (msg) => {
    if (typeof toast === "function") toast(msg, 3200);
    else console.warn(msg);
  };

  function enabledIds() {
    return [...state.values()].filter((s) => s.enabled).map((s) => s.def.id);
  }

  function count() {
    let n = 0;
    for (const s of state.values()) if (s.enabled) n++;
    return n;
  }

  function emit() {
    if (typeof onChange === "function") onChange(count());
  }

  function activate(def) {
    const st = state.get(def.id);
    if (!st || st.enabled) return;
    const reg = { disposers: [], actions: [], panel: null };
    const api = {
      get app() {
        return typeof getApp === "function" ? getApp() : null;
      },
      THREE,
      toast: say,
      addAction: (label, run, opts = {}) =>
        reg.actions.push({ label, run, title: opts.title, primary: !!opts.primary }),
      setPanel: (node) => {
        reg.panel = node;
      },
      onFrame: (fn) => {
        frameHooks.add(fn);
        const dispose = () => frameHooks.delete(fn);
        reg.disposers.push(dispose);
        return dispose;
      },
      onDispose: (fn) => reg.disposers.push(fn),
    };
    try {
      def.activate(api);
    } catch (e) {
      console.warn(`add-on "${def.id}" failed to start`, e);
      say(`Add-on "${def.name}" failed to start`);
    }
    st.reg = reg;
    st.enabled = true;
  }

  function deactivate(id) {
    const st = state.get(id);
    if (!st || !st.enabled) return;
    const reg = st.reg;
    if (reg) {
      for (let i = reg.disposers.length - 1; i >= 0; i--) {
        try {
          reg.disposers[i]();
        } catch (e) {
          console.warn("add-on teardown failed", id, e);
        }
      }
    }
    st.reg = null;
    st.enabled = false;
  }

  async function save() {
    const kv = typeof getKv === "function" ? getKv() : null;
    if (!kv) return;
    try {
      await kv.addons.set("enabled", enabledIds());
    } catch (e) {
      console.warn("add-on state save failed", e);
    }
  }

  function toggle(id) {
    const st = state.get(id);
    if (!st) return;
    if (st.enabled) deactivate(id);
    else activate(st.def);
    save();
    emit();
    if (repaint) repaint();
  }

  async function init() {
    const kv = typeof getKv === "function" ? getKv() : null;
    let ids = null;
    if (kv) {
      try {
        const stored = await kv.addons.get("enabled");
        if (Array.isArray(stored)) ids = stored;
      } catch (e) {
        console.warn("add-on state load failed", e);
      }
    }
    if (!ids) ids = BUILTIN_ADDONS.filter((d) => d.defaultEnabled).map((d) => d.id);
    for (const id of ids) if (state.has(id)) activate(state.get(id).def);
    ready = true;
    emit();
  }

  function update(dt) {
    if (!frameHooks.size) return;
    for (const fn of frameHooks) {
      try {
        fn(dt);
      } catch (e) {
        console.warn("add-on frame hook failed", e);
      }
    }
  }

  async function runAction(st, action) {
    try {
      const r = action.run();
      if (r && typeof r.then === "function") await r;
    } catch (e) {
      console.warn("add-on action failed", st.def.id, e);
      say(e && e.message ? e.message : "That action failed");
    }
  }

  function cardEl(st) {
    const d = st.def;
    const card = el("div", "addonCard" + (st.enabled ? " on" : ""));

    const head = el("div", "addonHead");
    head.append(el("div", "addonIcon", d.icon || "\u25c8"));
    const title = el("div", "addonTitle");
    title.append(el("div", "addonName", d.name));
    title.append(el("div", "addonMeta", `v${d.version || "1.0"} \u00b7 ${d.author || "3D Model Maker"} \u00b7 ${d.category || "Utility"}`));
    head.append(title);
    const sw = el("button", "addonToggle" + (st.enabled ? " on" : ""), st.enabled ? "On" : "Off");
    sw.title = st.enabled ? "Disable this add-on" : "Enable this add-on";
    sw.addEventListener("click", () => toggle(d.id));
    head.append(sw);
    card.append(head);

    card.append(el("div", "addonDesc", d.description || ""));

    if (d.tags && d.tags.length) {
      const tags = el("div", "addonTags");
      for (const tag of d.tags) tags.append(el("span", "addonTag", tag));
      card.append(tags);
    }

    if (st.enabled && st.reg) {
      if (st.reg.actions.length) {
        const row = el("div", "addonActions");
        for (const a of st.reg.actions) {
          const b = el("button", "btn " + (a.primary ? "primary" : "ghost"), a.label);
          if (a.title) b.title = a.title;
          b.addEventListener("click", () => runAction(st, a));
          row.append(b);
        }
        card.append(row);
      }
      if (st.reg.panel) {
        const panel = el("div", "addonPanel");
        panel.append(st.reg.panel);
        card.append(panel);
      }
    }
    return card;
  }

  function render(container) {
    if (!container) return;
    container.innerHTML = "";

    let filter = "All";
    let query = "";

    const bar = el("div", "addonBar");
    const search = document.createElement("input");
    search.type = "search";
    search.className = "addonSearch";
    search.placeholder = "Search add-ons\u2026";
    const chips = el("div", "addonChips");
    bar.append(search, chips);

    const grid = el("div", "addonGrid");
    container.append(bar, grid);

    const paint = () => {
      grid.innerHTML = "";
      const list = [...state.values()]
        .filter(({ def }) => {
          if (filter !== "All" && def.category !== filter) return false;
          if (query) {
            const hay = (def.name + " " + def.description + " " + (def.tags || []).join(" ")).toLowerCase();
            if (!hay.includes(query)) return false;
          }
          return true;
        })
        .sort(
          (a, b) =>
            CATEGORY_ORDER.indexOf(a.def.category) - CATEGORY_ORDER.indexOf(b.def.category) ||
            a.def.name.localeCompare(b.def.name)
        );
      if (!list.length) {
        grid.append(el("div", "libEmpty", "No add-ons match."));
        return;
      }
      for (const st of list) grid.append(cardEl(st));
    };

    for (const c of ["All", ...CATEGORY_ORDER]) {
      const b = el("button", "chip" + (c === "All" ? " active" : ""), c);
      b.addEventListener("click", () => {
        filter = c;
        for (const child of chips.children) child.classList.toggle("active", child === b);
        paint();
      });
      chips.append(b);
    }

    search.addEventListener("input", () => {
      query = search.value.trim().toLowerCase();
      paint();
    });

    repaint = () => {
      if (container.isConnected) paint();
    };
    paint();
  }

  return {
    init,
    update,
    render,
    enable: (id) => {
      const st = state.get(id);
      if (st) {
        activate(st.def);
        save();
        emit();
        if (repaint) repaint();
      }
    },
    disable: (id) => {
      deactivate(id);
      save();
      emit();
      if (repaint) repaint();
    },
    toggle,
    isEnabled: (id) => !!(state.get(id) && state.get(id).enabled),
    get list() {
      return [...state.values()].map((s) => ({
        id: s.def.id,
        name: s.def.name,
        category: s.def.category,
        description: s.def.description,
        enabled: s.enabled,
      }));
    },
    get count() {
      return count();
    },
    get ready() {
      return ready;
    },
    catalog: BUILTIN_ADDONS,
  };
}
