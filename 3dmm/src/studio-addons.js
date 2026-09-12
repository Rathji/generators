/*
 * Studio Add-ons — a Blender-style add-on manager for the Studio (the "Add-ons"
 * workspace tab). Each add-on is an honest browser-side equivalent of the
 * similarly named Blender extension, wired to tools the app already has:
 *
 *   Mixamo Bridge  — import a rigged Mixamo character (FBX/GLB) and retarget the
 *                    procedural mocap library (motion.js) onto any humanoid rig.
 *   MetaHuman      — a "MetaHuman Creator"-style prompt builder that generates a
 *                    photoreal person with the text-to-image plugin, then sculpts
 *                    it into 3D through the app's AI mesh pipeline.
 *   MetaRforge     — forge a Mixamo-standard humanoid metarig fitted to the model
 *                    and (optionally) bind the mesh with automatic proximity
 *                    weights so the rig actually deforms it.
 *
 * There is no WebGL rigging kernel here — the metarig is a real THREE.Bone tree
 * registered as a live skeleton so the app's own armature controller, motion
 * layer, outliner and exporter all pick it up.
 *
 * See src/README.md ("Studio add-ons").
 */

import { THREE } from "./three.js";
import { MOTIONS, MOTION_CATEGORIES } from "./motion.js";
import { humanoidSpec, bonesFromSpec } from "./auto-armature.js";

const STORE_KEY = "tt3d.studio.addons";
const META_NAME = "MetaRforge Metarig";
const TAU = Math.PI * 2;

/* --------------------------------------------------------------- add-on list */

const ADDONS = [
  {
    id: "mixamo",
    name: "Mixamo Bridge",
    icon: "\uD83C\uDFAD",
    version: "2.1.0",
    author: "Community",
    blurb:
      "Import a rigged Mixamo character (FBX / GLB) and retarget the built-in mocap animation library onto any humanoid skeleton.",
    tags: ["Rig", "Animation", "Import"],
  },
  {
    id: "metahuman",
    name: "MetaHuman Creator",
    icon: "\uD83E\uDDD1",
    version: "1.4.2",
    author: "Epic-style",
    blurb:
      "Assemble a photoreal person from body / face parameters, generate the portrait with AI, then build a 3D human from it.",
    tags: ["AI", "Character", "Image"],
  },
  {
    id: "metarforge",
    name: "MetaRforge",
    icon: "\uD83E\uDDB4",
    version: "0.9.3",
    author: "MetaRforge",
    blurb:
      "Forge a Mixamo-standard humanoid metarig fitted to the model, then bind the mesh with automatic proximity weights.",
    tags: ["Rig", "Auto-rig", "Skeleton"],
  },
];

/* ------------------------------------------------------------- auto weighting */

/*
 * Binds one Mesh to the metarig with proximity weights: each vertex is weighted
 * to its 4 nearest bone joints by inverse-square distance, so rotating a bone
 * pulls the vertices around it. This is the "automatic weights" step, crudely.
 * The original mesh is hidden, not removed, so it stays referenced by the app.
 */
function bindMesh(mesh, skeleton, joints) {
  if (!mesh.geometry || !mesh.geometry.attributes.position) return null;
  const src = mesh.geometry;
  const geo = src.clone();
  const pos = geo.attributes.position;
  const n = pos.count;
  if (!n) return null;

  const idx = new Uint16Array(n * 4);
  const wgt = new Float32Array(n * 4);
  const world = new THREE.Matrix4().copy(mesh.matrixWorld);
  const v = new THREE.Vector3();
  const bestIdx = [0, 0, 0, 0];
  const bestD = [Infinity, Infinity, Infinity, Infinity];

  for (let i = 0; i < n; i++) {
    v.fromBufferAttribute(pos, i).applyMatrix4(world);
    bestIdx[0] = bestIdx[1] = bestIdx[2] = bestIdx[3] = 0;
    bestD[0] = bestD[1] = bestD[2] = bestD[3] = Infinity;
    for (let j = 0; j < joints.length; j++) {
      const dx = v.x - joints[j].x;
      const dy = v.y - joints[j].y;
      const dz = v.z - joints[j].z;
      const d = dx * dx + dy * dy + dz * dz;
      let k = 3;
      if (d >= bestD[3]) continue;
      while (k > 0 && d < bestD[k - 1]) {
        bestD[k] = bestD[k - 1];
        bestIdx[k] = bestIdx[k - 1];
        k--;
      }
      bestD[k] = d;
      bestIdx[k] = j;
    }
    let sum = 0;
    for (let k = 0; k < 4; k++) {
      const w = 1 / (bestD[k] + 1e-5);
      idx[i * 4 + k] = bestIdx[k];
      wgt[i * 4 + k] = w;
      sum += w;
    }
    for (let k = 0; k < 4; k++) wgt[i * 4 + k] /= sum;
  }

  geo.setAttribute("skinIndex", new THREE.BufferAttribute(idx, 4));
  geo.setAttribute("skinWeight", new THREE.BufferAttribute(wgt, 4));

  const skinned = new THREE.SkinnedMesh(geo, mesh.material);
  skinned.name = (mesh.name || "mesh") + " \u00b7 metarig";
  skinned.position.copy(mesh.position);
  skinned.quaternion.copy(mesh.quaternion);
  skinned.scale.copy(mesh.scale);
  skinned.frustumCulled = false;
  mesh.parent.add(skinned);
  skinned.bind(skeleton);
  return skinned;
}

/* ------------------------------------------------------------------ helpers */

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}

function clamp(v, a, b) {
  return Math.max(a, Math.min(b, v));
}

function loadEnabled() {
  const all = ADDONS.map((a) => a.id);
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || "null");
    if (Array.isArray(v)) return new Set(v.filter((x) => all.includes(x)));
  } catch (e) {
    /* ignore */
  }
  return new Set(all);
}

function saveEnabled(set) {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify([...set]));
  } catch (e) {
    /* ignore */
  }
}

/* ------------------------------------------------------------ add-on metadata */

const SEXES = [
  { value: "woman", label: "Female" },
  { value: "man", label: "Male" },
  { value: "person", label: "Androgynous" },
];
const AGES = [
  { value: "young adult", label: "Young adult" },
  { value: "adult", label: "Adult" },
  { value: "middle-aged", label: "Middle-aged" },
  { value: "elderly", label: "Elderly" },
];
const SKINS = [
  { value: "fair Nordic", label: "Fair / Nordic" },
  { value: "olive Mediterranean", label: "Olive / Mediterranean" },
  { value: "East Asian", label: "East Asian" },
  { value: "South Asian", label: "South Asian" },
  { value: "deep brown African", label: "Deep brown / African" },
  { value: "warm Latin American", label: "Latin American" },
  { value: "Middle Eastern", label: "Middle Eastern" },
  { value: "mixed-race", label: "Mixed-race" },
];
const BUILDS = [
  { value: "slim", label: "Slim" },
  { value: "athletic", label: "Athletic" },
  { value: "muscular", label: "Muscular" },
  { value: "curvy", label: "Curvy" },
  { value: "heavyset", label: "Heavyset" },
];
const HAIRS = [
  "long wavy auburn hair",
  "short cropped black hair",
  "a shaved head",
  "a sleek platinum bob",
  "tousled brown hair",
  "long braided dark hair",
  "grey swept-back hair",
  "curly shoulder-length hair",
];
const OUTFITS = [
  "a tailored charcoal suit",
  "a white tank top and blue jeans",
  "casual streetwear and a bomber jacket",
  "a red evening gown",
  "a futuristic dark bodysuit",
  "medieval leather armour",
  "a clean white lab coat",
  "a military fatigues uniform",
  "a knitted sweater and trousers",
];
const HUMAN_PRESETS = [
  { name: "Ava \u2014 model", sex: "woman", age: "young adult", skin: "fair Nordic", build: "slim", outfit: "a red evening gown" },
  { name: "Kai \u2014 soldier", sex: "man", age: "adult", skin: "East Asian", build: "athletic", outfit: "a military fatigues uniform" },
  { name: "Rosa \u2014 chef", sex: "woman", age: "middle-aged", skin: "warm Latin American", build: "curvy", outfit: "a clean white lab coat" },
  { name: "Dr. Vance", sex: "man", age: "elderly", skin: "olive Mediterranean", build: "slim", outfit: "a tailored charcoal suit" },
  { name: "Nyx \u2014 cyber", sex: "person", age: "young adult", skin: "mixed-race", build: "athletic", outfit: "a futuristic dark bodysuit" },
  { name: "Magnus \u2014 warrior", sex: "man", age: "adult", skin: "fair Nordic", build: "muscular", outfit: "medieval leather armour" },
];

const HUMAN_NEG =
  "multiple people, group, crowd, cropped, close-up, portrait only, headshot, text, watermark, signature, logo, blurry, low quality, deformed, extra limbs, missing limbs, fused fingers, dismembered, background clutter, duplicate";

/* =================================================================== factory */

export function createStudioAddons(ctx = {}) {
  const { body, toast = () => {}, studio = null, getRig = () => null, modelGroup, scene, render = () => {} } = ctx;
  const app = () => (ctx.app ? ctx.app() : window.textTo3d) || null;
  const say = (m, ms = 2600) => toast(m, ms);

  const enabled = loadEnabled();
  let selectedId = "mixamo";
  let mounted = false;
  let bodyEl = null;
  let listEl = null;
  let toolEl = null;
  let stylesInjected = false;

  const st = {
    mixamo: { motionId: null },
    human: {
      sex: "woman",
      age: "adult",
      skin: "fair Nordic",
      build: "athletic",
      hair: HAIRS[0],
      outfit: OUTFITS[0],
      seed: -1,
      dataUrl: null,
      label: "metahuman",
      busy: false,
    },
    forge: {
      spine: 3,
      fingers: false,
      toes: true,
      armSpread: 0.35,
      legStance: 0.06,
      fit: true,
      height: 1.8,
      holder: null,
      proxy: null,
      bones: null,
      skeleton: null,
      bound: [],
    },
  };

  /* ------------------------------------------------------------- style sheet */

  function injectStyles() {
    if (stylesInjected || document.getElementById("studioAddonStyles")) {
      stylesInjected = true;
      return;
    }
    const s = document.createElement("style");
    s.id = "studioAddonStyles";
    s.textContent = `
.stAdWrap { display: grid; grid-template-columns: 264px minmax(0,1fr); gap: 14px; align-items: start; max-width: 1100px; margin: 0 auto; }
.stAdList { display: flex; flex-direction: column; gap: 8px; }
.stAdCard { background: #242833; border: 1px solid #333a49; border-radius: 8px; padding: 10px 11px; cursor: pointer; }
.stAdCard:hover { background: #2a2f3c; }
.stAdCard.sel { border-color: #4772b3; box-shadow: inset 0 0 0 1px #4772b3; }
.stAdCard h4 { margin: 0; font-size: 12.5px; color: #fff; display: flex; align-items: center; gap: 6px; }
.stAdCard h4 .stAdIco { font-size: 15px; }
.stAdMeta { color: #8b93a7; font-size: 10.5px; margin: 2px 0 6px; }
.stAdBlurb { color: #c3cad8; font-size: 11px; line-height: 1.45; }
.stAdTags { display: flex; gap: 4px; flex-wrap: wrap; margin-top: 7px; }
.stAdTag { background: #1b1f28; border: 1px solid #333a49; border-radius: 999px; padding: 1px 7px; font-size: 10px; color: #93a0b8; }
.stAdSwitch { display: flex; align-items: center; gap: 6px; margin-top: 8px; font-size: 10.5px; color: #aab3c6; cursor: pointer; user-select: none; }
.stAdSwitch input { accent-color: #4772b3; }
.stAdTool { background: #20242c; border: 1px solid #2c3240; border-radius: 8px; padding: 13px 15px 17px; min-height: 300px; }
.stAdToolH { display: flex; align-items: center; gap: 8px; margin-bottom: 4px; }
.stAdToolH b { font-size: 14px; color: #fff; }
.stAdToolH .stAdVer { color: #7f8a9e; font-size: 10.5px; }
.stAdSub { color: #98a2b6; font-size: 11px; margin-bottom: 12px; line-height: 1.45; }
.stAdSec { border: 1px solid #2c3240; border-radius: 7px; overflow: hidden; margin-bottom: 9px; background: #232833; }
.stAdSecH { background: #2f3543; padding: 4px 9px; font-size: 11px; font-weight: 600; color: #dfe4ee; }
.stAdSecB { padding: 8px 9px; display: flex; flex-direction: column; gap: 7px; }
.stAdRow { display: flex; align-items: center; gap: 8px; }
.stAdRow > label { width: 92px; flex: none; color: #9aa3b8; font-size: 11px; }
.stAdRow select, .stAdRow input[type=number], .stAdRow input[type=text] {
  flex: 1; min-width: 0; background: #1a1e26; color: #e6e9f0; border: 1px solid #333a49; border-radius: 4px; padding: 3px 6px; outline: none; font: inherit;
}
.stAdRange { flex: 1; display: flex; align-items: center; gap: 8px; min-width: 0; }
.stAdRange input[type=range] { flex: 1; min-width: 0; accent-color: #4772b3; }
.stAdVal { width: 40px; text-align: right; color: #cdd5e6; font-size: 11px; font-variant-numeric: tabular-nums; }
.stAdBtn {
  background: #3a4152; border: 1px solid #202531; border-radius: 5px; padding: 5px 10px; cursor: pointer; color: #eef1f7; font: inherit;
}
.stAdBtn:hover { background: #475064; }
.stAdBtn:disabled { opacity: .5; cursor: default; }
.stAdBtn.pri { background: #4772b3; border-color: #2c4a75; }
.stAdBtn.pri:hover { background: #5680c2; }
.stAdBtn.danger { background: #6a3434; border-color: #3a1c1c; }
.stAdBtn.danger:hover { background: #7d3d3d; }
.stAdBtnRow { display: flex; gap: 7px; flex-wrap: wrap; }
.stAdHint { color: #7f8a9e; font-size: 10.5px; line-height: 1.45; }
.stAdWarn { color: #ffcf7a; font-size: 10.5px; line-height: 1.45; }
.stAdOk { color: #7fdc8a; font-size: 11px; }
.stAdErr { color: #ff8a7a; font-size: 11px; }
.stAdChips { display: flex; flex-wrap: wrap; gap: 5px; }
.stAdChip { background: #2c3340; border: 1px solid #39414f; border-radius: 999px; padding: 3px 9px; font-size: 11px; color: #d3dae8; cursor: pointer; }
.stAdChip:hover { background: #3a4356; }
.stAdChip.active { background: #4772b3; border-color: #2c4a75; color: #fff; }
.stAdChip.sk { background: #2a3540; }
.stAdChip.sk:hover { background: #35424f; }
.stAdCat { color: #8b93a7; font-size: 10px; text-transform: uppercase; letter-spacing: .06em; margin: 6px 0 1px; }
.stAdStatus { background: #1b1f28; border: 1px solid #2c3240; border-radius: 6px; padding: 7px 9px; font-size: 11px; color: #cdd5e6; line-height: 1.5; }
.stAdThumb { width: 148px; height: 148px; border-radius: 6px; border: 1px solid #333a49; object-fit: cover; background: #14171d; display: block; }
.stAdSpinner { display: inline-block; width: 12px; height: 12px; border: 2px solid rgba(255,255,255,.25); border-top-color: #fff; border-radius: 50%; animation: stAdSpin .7s linear infinite; vertical-align: -2px; margin-right: 6px; }
@keyframes stAdSpin { to { transform: rotate(360deg); } }
.stAdPrompt { background: #14171d; border: 1px solid #2c3240; border-radius: 6px; padding: 7px 9px; font-size: 10.5px; color: #a9b4c6; font-family: ui-monospace, Menlo, Consolas, monospace; line-height: 1.5; max-height: 96px; overflow-y: auto; }
.stAdLock { text-align: center; padding: 34px 20px; color: #98a2b6; }
.stAdLock .stAdBtn { margin-top: 12px; }
.stAdHumanTop { display: flex; gap: 12px; align-items: flex-start; }
.stAdHumanCol { flex: 1; min-width: 0; display: flex; flex-direction: column; gap: 7px; }
@media (max-width: 900px) {
  .stAdWrap { grid-template-columns: minmax(0,1fr); }
  .stAdHumanTop { flex-direction: column; }
}
`;
    document.head.appendChild(s);
    stylesInjected = true;
  }

  /* ------------------------------------------------------------- DOM helpers */

  function section(title) {
    const root = el("div", "stAdSec");
    root.appendChild(el("div", "stAdSecH", title));
    const b = el("div", "stAdSecB");
    root.appendChild(b);
    return { root, body: b };
  }

  function row(label, control) {
    const r = el("div", "stAdRow");
    r.appendChild(el("label", null, label));
    r.appendChild(control);
    return r;
  }

  function selectEl(opts, value, onChange) {
    const s = el("select");
    for (const o of opts) {
      const op = el("option", null, o.label != null ? o.label : o);
      op.value = o.value != null ? o.value : o;
      s.appendChild(op);
    }
    s.value = value;
    s.onchange = () => onChange(s.value);
    return s;
  }

  function range(min, max, step, value, onInput, fmt) {
    const w = el("div", "stAdRange");
    const r = el("input");
    r.type = "range";
    r.min = String(min);
    r.max = String(max);
    r.step = String(step);
    r.value = String(value);
    const v = el("span", "stAdVal", fmt ? fmt(value) : String(value));
    r.oninput = () => {
      if (fmt) v.textContent = fmt(r.value);
      else v.textContent = r.value;
      onInput(Number(r.value));
    };
    w.appendChild(r);
    w.appendChild(v);
    return w;
  }

  function btn(text, onClick, cls) {
    const b = el("button", "stAdBtn" + (cls ? " " + cls : ""), text);
    b.onclick = onClick;
    return b;
  }

  function hint(text) {
    return el("div", "stAdHint", text);
  }

  function chip(text, onClick, cls) {
    const c = el("div", "stAdChip" + (cls ? " " + cls : ""), text);
    c.onclick = onClick;
    return c;
  }

  /* --------------------------------------------------------------- add-on list */

  function renderList() {
    if (!listEl) return;
    listEl.innerHTML = "";
    for (const a of ADDONS) {
      const card = el("div", "stAdCard" + (a.id === selectedId ? " sel" : ""));
      const h = el("h4");
      h.appendChild(el("span", "stAdIco", a.icon));
      h.appendChild(el("span", null, a.name));
      card.appendChild(h);
      card.appendChild(el("div", "stAdMeta", "v" + a.version + " \u00b7 " + a.author));
      card.appendChild(el("div", "stAdBlurb", a.blurb));
      const tags = el("div", "stAdTags");
      for (const t of a.tags) tags.appendChild(el("span", "stAdTag", t));
      card.appendChild(tags);

      const sw = el("label", "stAdSwitch");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = enabled.has(a.id);
      cb.onclick = (e) => e.stopPropagation();
      cb.onchange = () => {
        setEnabled(a.id, cb.checked);
      };
      sw.appendChild(cb);
      sw.appendChild(el("span", null, "Enabled"));
      card.appendChild(sw);

      card.onclick = () => select(a.id);
      listEl.appendChild(card);
    }
  }

  /* ------------------------------------------------------------------ Mixamo */

  function renderMixamo(host) {
    const sec = section("Skeleton");
    const status = el("div", "stAdStatus");
    const rig = getRig();
    const boneCount = rig && rig.boneCount ? rig.boneCount : 0;
    status.innerHTML =
      boneCount > 0
        ? "Active rig: <b>" + boneCount + " bones</b> \u00b7 " + ((rig.clips && rig.clips.length) || 0) + " clip(s)"
        : "No skeleton on the current model.";
    sec.body.appendChild(status);
    if (!boneCount) sec.body.appendChild(hint("Import a rigged character below, or forge one with the MetaRforge add-on."));

    const impBtn = btn("\u2B06 Import Mixamo character (FBX / GLB)", () => importCharacter());
    sec.body.appendChild(impBtn);
    sec.body.appendChild(hint("Mixamo exports FBX \u2014 drop it straight in. The rig and any embedded clips are detected automatically."));

    const libSec = section("Animation library");
    libSec.body.appendChild(
      hint("Retargets onto the active rig by bone role, so it plays on any humanoid skeleton.")
    );
    for (const cat of MOTION_CATEGORIES) {
      const list = MOTIONS.filter((m) => m.category === cat.id);
      if (!list.length) continue;
      libSec.body.appendChild(el("div", "stAdCat", cat.label));
      const cw = el("div", "stAdChips");
      for (const m of list) {
        const c = chip(m.label, () => playMotion(m.id), "sk");
        c.dataset.motion = m.id;
        c.title = m.desc || m.label;
        cw.appendChild(c);
      }
      libSec.body.appendChild(cw);
    }
    sec.root.appendChild(libSec.root);

    const ctrl = section("Playback");
    ctrl.body.appendChild(range(0.2, 2.5, 0.1, 1, (v) => {
      const ap = app();
      if (ap && ap.motions) ap.motions.setSpeed(v);
    }, (v) => Number(v).toFixed(1) + "\u00D7"));
    const loopWrap = el("label", "stAdSwitch");
    const loopCb = el("input");
    loopCb.type = "checkbox";
    loopCb.checked = true;
    loopCb.onchange = () => {
      const ap = app();
      if (ap && ap.motions) ap.motions.setLoop(loopCb.checked);
    };
    loopWrap.appendChild(loopCb);
    loopWrap.appendChild(el("span", null, "Loop"));
    ctrl.body.appendChild(loopWrap);
    host.appendChild(sec.root);

    const live = el("div", "stAdStatus");
    live.dataset.live = "mixamo";
    live.textContent = "Playing: nothing";
    ctrl.body.appendChild(live);

    const stopBtn = btn("Stop", () => {
      const ap = app();
      if (ap && ap.motions) ap.motions.stop();
      st.mixamo.motionId = null;
      refreshLive();
    });
    ctrl.body.appendChild(stopBtn);
    refreshLive();
  }

  function importCharacter() {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = ".fbx,.glb,.gltf,.dae,.obj,.stl,.ply,.blend";
    input.onchange = async () => {
      const f = input.files && input.files[0];
      if (!f) return;
      const a = app();
      if (!a || !a.fromFiles) return say("Model loader unavailable", 2600);
      say("Importing " + f.name + "\u2026", 4000);
      try {
        await a.fromFiles([f]);
        say("Character imported", 2600);
        renderTool();
      } catch (e) {
        say("Import failed: " + ((e && e.message) || e), 3400);
      }
    };
    input.click();
  }

  function playMotion(id) {
    const a = app();
    if (!a || !a.motions) return say("Motion engine unavailable", 2200);
    const ok = a.motions.play(id);
    if (!ok) {
      say("No usable skeleton \u2014 import a rigged character or forge a metarig (MetaRforge)", 3600);
      return false;
    }
    st.mixamo.motionId = id;
    refreshLive();
    return true;
  }

  function refreshLive() {
    if (!toolEl) return;
    const live = toolEl.querySelector('[data-live="mixamo"]');
    if (live) {
      const a = app();
      const m = a && a.motions ? a.motions : null;
      const cur = m && m.motionId ? MOTIONS.find((x) => x.id === m.motionId) : null;
      const playing = m && m.playing;
      live.textContent = cur ? "Playing: " + cur.label + (playing ? " \u25B6" : " \u23F8") : "Playing: nothing";
    }
    toolEl.querySelectorAll(".stAdChip[data-motion]").forEach((c) => {
      const a = app();
      const m = a && a.motions ? a.motions : null;
      c.classList.toggle("active", !!(m && m.motionId === c.dataset.motion));
    });
  }

  /* --------------------------------------------------------------- MetaHuman */

  function humanPrompt() {
    const h = st.human;
    return (
      "Full-body photorealistic 3D character render of a " +
      h.age +
      " " +
      h.sex +
      " with " +
      h.skin +
      " skin, " +
      h.hair +
      ", wearing " +
      h.outfit +
      ", " +
      h.build +
      " build, standing in a relaxed A-pose facing the camera, full body head to toe, centred, " +
      "plain seamless light grey studio background, soft even lighting, ultra-detailed skin pores and eyes, " +
      "Unreal Engine MetaHuman style, octane render, masterpiece"
    );
  }

  function renderMetaHuman(host) {
    const h = st.human;
    host.appendChild(
      hint("Build a person from parameters, generate the portrait with AI, then sculpt a 3D human from it.")
    );

    const top = el("div", "stAdHumanTop");
    const col = el("div", "stAdHumanCol");
    const sec = section("Character");
    sec.body.appendChild(row("Sex", selectEl(SEXES, h.sex, (v) => { h.sex = v; refreshPrompt(); })));
    sec.body.appendChild(row("Age", selectEl(AGES, h.age, (v) => { h.age = v; refreshPrompt(); })));
    sec.body.appendChild(row("Skin", selectEl(SKINS, h.skin, (v) => { h.skin = v; refreshPrompt(); })));
    sec.body.appendChild(row("Build", selectEl(BUILDS, h.build, (v) => { h.build = v; refreshPrompt(); })));
    sec.body.appendChild(row("Hair", selectEl(HAIRS, h.hair, (v) => { h.hair = v; refreshPrompt(); })));
    sec.body.appendChild(row("Outfit", selectEl(OUTFITS, h.outfit, (v) => { h.outfit = v; refreshPrompt(); })));
    col.appendChild(sec.root);

    const presetSec = section("Presets");
    const pc = el("div", "stAdChips");
    for (const p of HUMAN_PRESETS) {
      pc.appendChild(
        chip(p.name, () => {
          h.sex = p.sex;
          h.age = p.age;
          h.skin = p.skin;
          h.build = p.build;
          h.outfit = p.outfit;
          renderTool();
        })
      );
    }
    presetSec.body.appendChild(pc);
    col.appendChild(presetSec.root);

    const promptSec = section("Prompt");
    const promptEl = el("div", "stAdPrompt");
    promptEl.dataset.prompt = "human";
    promptEl.textContent = humanPrompt();
    promptSec.body.appendChild(promptEl);
    const seedRow = el("div", "stAdRow");
    seedRow.appendChild(el("label", null, "Seed"));
    const seedIn = el("input");
    seedIn.type = "number";
    seedIn.value = String(h.seed);
    seedIn.onchange = () => {
      h.seed = Math.round(Number(seedIn.value) || -1);
    };
    seedRow.appendChild(seedIn);
    seedRow.appendChild(btn("Randomise", () => {
      h.seed = -1;
      seedIn.value = "-1";
    }));
    promptSec.body.appendChild(seedRow);
    col.appendChild(promptSec.root);
    top.appendChild(col);

    const rightCol = el("div", "stAdHumanCol");
    const imgWrap = el("div");
    const img = el("img", "stAdThumb");
    img.alt = "generated human";
    img.dataset.thumb = "human";
    if (h.dataUrl) {
      img.src = h.dataUrl;
      img.hidden = false;
    } else {
      img.hidden = true;
    }
    imgWrap.appendChild(img);
    rightCol.appendChild(imgWrap);

    const actions = section("Actions");
    const genBtn = btn("\u2728 Generate portrait", () => generatePortrait(), "pri");
    const buildBtn = btn("\uD83E\uDDB4 Build 3D human", () => buildHuman());
    const rigBtn = btn("Forge metarig \u2192 animate", () => {
      select("metarforge");
      say("Use MetaRforge to fit a metarig to this human", 3200);
    });
    genBtn.dataset.act = "gen";
    buildBtn.dataset.act = "build";
    const rowA = el("div", "stAdBtnRow");
    rowA.appendChild(genBtn);
    rowA.appendChild(buildBtn);
    actions.body.appendChild(rowA);
    actions.body.appendChild(rigBtn);
    const bstat = el("div", "stAdStatus", h.dataUrl ? "Portrait ready \u2014 build it into 3D." : "No portrait yet.");
    bstat.dataset.status = "human";
    actions.body.appendChild(bstat);
    rightCol.appendChild(actions.root);
    top.appendChild(rightCol);

    host.appendChild(top);
    refreshPrompt();
    setHumanBusy(h.busy);
  }

  function refreshPrompt() {
    if (!toolEl) return;
    const p = toolEl.querySelector('[data-prompt="human"]');
    if (p) p.textContent = humanPrompt();
  }

  function setHumanBusy(on) {
    st.human.busy = on;
    if (!toolEl) return;
    const g = toolEl.querySelector('[data-act="gen"]');
    const b = toolEl.querySelector('[data-act="build"]');
    if (g) g.disabled = on;
    if (b) b.disabled = on;
    const s = toolEl.querySelector('[data-status="human"]');
    if (s && on) s.innerHTML = '<span class="stAdSpinner"></span>Working\u2026 this can take a while.';
  }

  async function generatePortrait() {
    if (st.human.busy) return null;
    if (!window.root || !window.root.generateImage) {
      say("Image generator unavailable", 3000);
      return null;
    }
    setHumanBusy(true);
    try {
      const res = await window.root.generateImage({
        prompt: humanPrompt(),
        negativePrompt: HUMAN_NEG,
        resolution: "768x768",
        seed: st.human.seed,
      });
      const url = res && res.dataUrl;
      if (!url) throw new Error("no image returned");
      st.human.dataUrl = url;
      st.human.label = "metahuman " + st.human.sex + " " + st.human.age;
      const img = toolEl && toolEl.querySelector('[data-thumb="human"]');
      if (img) {
        img.src = url;
        img.hidden = false;
      }
      say("Portrait generated", 2200);
      return url;
    } catch (e) {
      say("Generation failed: " + ((e && e.message) || e), 3600);
      return null;
    } finally {
      setHumanBusy(false);
      const s = toolEl && toolEl.querySelector('[data-status="human"]');
      if (s) s.textContent = st.human.dataUrl ? "Portrait ready \u2014 build it into 3D." : "No portrait yet.";
    }
  }

  async function buildHuman() {
    if (st.human.busy) return false;
    const a = app();
    if (!a || !a.fromAiImage) {
      say("3D builder unavailable", 2600);
      return false;
    }
    if (!st.human.dataUrl) {
      say("Generate a portrait first", 2600);
      return false;
    }
    setHumanBusy(true);
    try {
      await a.fromAiImage(st.human.dataUrl, st.human.label);
      say("3D human built", 2600);
      return true;
    } catch (e) {
      say("Build failed: " + ((e && e.message) || e), 3600);
      return false;
    } finally {
      setHumanBusy(false);
      const s = toolEl && toolEl.querySelector('[data-status="human"]');
      if (s) s.textContent = "Built \u2014 open MetaRforge to fit a metarig.";
    }
  }

  /* --------------------------------------------------------------- MetaRforge */

  function renderMetarforge(host) {
    const f = st.forge;
    host.appendChild(
      hint("Forge a Mixamo-standard humanoid metarig sized to the model, then bind the mesh so the rig deforms it.")
    );

    const sec = section("Metarig");
    sec.body.appendChild(row("Spine", range(1, 3, 1, f.spine, (v) => { f.spine = v; }, (v) => v + " seg")));
    sec.body.appendChild(row("Arm spread", range(0, 1, 0.05, f.armSpread, (v) => { f.armSpread = v; }, (v) => Number(v).toFixed(2))));
    sec.body.appendChild(row("Leg stance", range(0, 0.2, 0.01, f.legStance, (v) => { f.legStance = v; }, (v) => Number(v).toFixed(2))));
    const fin = el("label", "stAdSwitch");
    const finCb = el("input");
    finCb.type = "checkbox";
    finCb.checked = f.fingers;
    finCb.onchange = () => { f.fingers = finCb.checked; };
    fin.appendChild(finCb);
    fin.appendChild(el("span", null, "Fingers (5 per hand)"));
    sec.body.appendChild(fin);
    const toe = el("label", "stAdSwitch");
    const toeCb = el("input");
    toeCb.type = "checkbox";
    toeCb.checked = f.toes;
    toeCb.onchange = () => { f.toes = toeCb.checked; };
    toe.appendChild(toeCb);
    toe.appendChild(el("span", null, "Toe bones"));
    sec.body.appendChild(toe);

    const fit = el("label", "stAdSwitch");
    const fitCb = el("input");
    fitCb.type = "checkbox";
    fitCb.checked = f.fit;
    fitCb.onchange = () => {
      f.fit = fitCb.checked;
      renderTool();
    };
    fit.appendChild(fitCb);
    fit.appendChild(el("span", null, "Fit to model bounding box"));
    sec.body.appendChild(fit);
    if (!f.fit) {
      sec.body.appendChild(row("Height", range(0.5, 4, 0.05, f.height, (v) => { f.height = v; }, (v) => Number(v).toFixed(2) + " m")));
    }
    host.appendChild(sec.root);

    const act = section("Actions");
    const rowA = el("div", "stAdBtnRow");
    rowA.appendChild(btn("\uD83D\uDD28 Forge metarig", () => forgeMetarig(), "pri"));
    rowA.appendChild(btn("Link mesh (auto weights)", () => bindModel()));
    rowA.appendChild(btn("Remove", () => removeMetarig(), "danger"));
    act.body.appendChild(rowA);

    const info = el("div", "stAdStatus");
    const a = app();
    const rig = getRig();
    const active = rig && rig.boneCount ? rig.boneCount : 0;
    const built = f.bones ? f.bones.length : 0;
    if (f.holder) {
      info.innerHTML =
        "Metarig: <b>" + built + " bones</b> \u00b7 active rig: <b>" + active + " bones</b>" +
        (f.bound.length ? " \u00b7 linked " + f.bound.length + " mesh(es)" : "");
      if (active && built && active !== built) {
        info.appendChild(el("div", "stAdWarn", "The model's own skeleton has more bones, so it wins as the active rig. The metarig still shows in the viewport."));
      }
    } else {
      info.textContent = "No metarig forged yet.";
    }
    act.body.appendChild(info);
    act.body.appendChild(hint("Auto weights are proximity-based \u2014 best on humanoid meshes. The original mesh is hidden, not deleted, and 'Remove' restores it."));

    const animSec = section("Animate the metarig");
    const cw = el("div", "stAdChips");
    for (const m of MOTIONS.filter((x) => x.category === "Basic" || x.category === "Cycle" || x.category === "Action")) {
      cw.appendChild(chip(m.label, () => playMotion(m.id), "sk"));
    }
    animSec.body.appendChild(cw);
    act.body.appendChild(animSec.root);
    host.appendChild(act.root);
  }

  function metarigBox() {
    if (!modelGroup) return null;
    modelGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelGroup);
    if (box.isEmpty()) return null;
    return box;
  }

  function forgeMetarig() {
    const a = app();
    if (!a || !a.model) {
      say("No model loaded", 2600);
      return false;
    }
    const box = metarigBox();
    if (!box) {
      say("No model to fit", 2600);
      return false;
    }
    removeMetarig(true);
    const size = box.getSize(new THREE.Vector3());
    const center = box.getCenter(new THREE.Vector3());
    const f = st.forge;
    const H = f.fit ? Math.max(size.y, 0.01) : f.height;
    const baseY = f.fit ? box.min.y : center.y - H / 2;

    const spec = humanoidSpec({
      height: H,
      baseY,
      cx: center.x,
      cz: center.z,
      spine: f.spine,
      armSpread: f.armSpread,
      legStance: f.legStance,
      fingers: f.fingers,
      toes: f.toes,
    });
    const built = bonesFromSpec(spec);

    /* Visible Group carries the bones into the GLB export (onlyVisible:true skips hidden
       subtrees, which would export a skin with null joints); the hidden SkinnedMesh below
       it exists only so findSkeletons can see the skeleton before the mesh is bound. */
    const holder = new THREE.Group();
    holder.name = META_NAME;
    holder.userData.metaRforge = true;
    holder.add(built.root);
    a.model.add(holder);
    a.model.updateMatrixWorld(true);

    const proxyGeo = new THREE.BufferGeometry();
    proxyGeo.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([0, 0, 0, 0, 0, 0, 0, 0, 0], 3)
    );
    const proxyMat = new THREE.MeshBasicMaterial({ visible: false });
    const proxy = new THREE.SkinnedMesh(proxyGeo, proxyMat);
    proxy.name = META_NAME + " \u00b7 bind";
    proxy.visible = false;
    proxy.userData.metaRforge = true;
    holder.add(proxy);
    const skeleton = new THREE.Skeleton(built.bones);
    proxy.bind(skeleton);

    f.holder = holder;
    f.proxy = { geometry: proxyGeo, material: proxyMat };
    f.bones = built.bones;
    f.skeleton = skeleton;

    if (a.refreshRig) a.refreshRig();
    const rig = a.rig;
    if (rig && rig.setVisible) rig.setVisible(true);
    try {
      render();
    } catch (e) {
      /* ignore */
    }
    say("MetaRforge: " + built.bones.length + "-bone metarig forged", 2800);
    renderTool();
    return true;
  }

  function bindModel() {
    const a = app();
    const f = st.forge;
    if (!a || !a.model || !f.skeleton || !f.bones) {
      say("Forge a metarig first", 2600);
      return false;
    }
    f.bones.forEach((b) => b.updateWorldMatrix(true, false));
    const joints = f.bones.map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));

    const targets = [];
    a.model.traverse((o) => {
      if (f.holder && (o === f.holder || f.bound.some((bb) => bb.skinned === o))) return;
      if (o.isMesh && !o.isSkinnedMesh && o.visible !== false && o.geometry && o.geometry.attributes && o.geometry.attributes.position) {
        targets.push(o);
      }
    });
    if (!targets.length) {
      say("No mesh to link", 2600);
      return false;
    }
    let ok = 0;
    for (const mesh of targets) {
      try {
        const skinned = bindMesh(mesh, f.skeleton, joints);
        if (skinned) {
          f.bound.push({ mesh, skinned });
          mesh.visible = false;
          ok++;
        }
      } catch (e) {
        console.warn("MetaRforge bind failed", e);
      }
    }
    try {
      render();
    } catch (e) {
      /* ignore */
    }
    say("Linked " + ok + " mesh(es) to the metarig", 2800);
    renderTool();
    return ok > 0;
  }

  function removeMetarig(silent) {
    const a = app();
    const f = st.forge;
    for (const b of f.bound) {
      if (b.skinned && b.skinned.parent) b.skinned.parent.remove(b.skinned);
      if (b.skinned && b.skinned.geometry) b.skinned.geometry.dispose();
      if (b.mesh) b.mesh.visible = true;
    }
    f.bound = [];
    if (f.holder && f.holder.parent) f.holder.parent.remove(f.holder);
    if (f.proxy) {
      if (f.proxy.geometry) f.proxy.geometry.dispose();
      if (f.proxy.material) f.proxy.material.dispose();
    }
    f.proxy = null;
    f.holder = null;
    f.bones = null;
    f.skeleton = null;
    if (a && a.refreshRig) a.refreshRig();
    try {
      render();
    } catch (e) {
      /* ignore */
    }
    if (!silent) {
      say("Metarig removed", 2200);
      renderTool();
    }
    return true;
  }

  /* ----------------------------------------------------------------- dispatch */

  function renderTool() {
    if (!toolEl || !mounted) return;
    toolEl.innerHTML = "";
    const a = ADDONS.find((x) => x.id === selectedId) || ADDONS[0];

    const head = el("div", "stAdToolH");
    head.appendChild(el("b", null, a.icon + " " + a.name));
    head.appendChild(el("span", "stAdVer", "v" + a.version + " \u00B7 " + a.author));
    toolEl.appendChild(head);

    if (!enabled.has(a.id)) {
      const lock = el("div", "stAdLock");
      lock.appendChild(el("div", null, a.blurb));
      lock.appendChild(
        btn("Enable " + a.name, () => setEnabled(a.id, true), "pri")
      );
      toolEl.appendChild(lock);
      return;
    }
    toolEl.appendChild(el("div", "stAdSub", a.blurb));

    if (a.id === "mixamo") renderMixamo(toolEl);
    else if (a.id === "metahuman") renderMetaHuman(toolEl);
    else renderMetarforge(toolEl);
  }

  function select(id) {
    selectedId = id;
    renderList();
    renderTool();
  }

  function setEnabled(id, on) {
    if (on) enabled.add(id);
    else enabled.delete(id);
    saveEnabled(enabled);
    if (on) selectedId = id;
    renderList();
    renderTool();
    if (on) say((ADDONS.find((a) => a.id === id) || {}).name + " enabled", 1800);
  }

  function isEnabled(id) {
    return enabled.has(id);
  }

  /* -------------------------------------------------------------------- mount */

  function mount(bodyElIn) {
    bodyEl = bodyElIn || body;
    if (!bodyEl) return;
    injectStyles();
    mounted = true;
    bodyEl.innerHTML = "";
    const wrap = el("div", "stAdWrap");
    listEl = el("div", "stAdList");
    toolEl = el("div", "stAdTool");
    wrap.appendChild(listEl);
    wrap.appendChild(toolEl);
    bodyEl.appendChild(wrap);
    renderList();
    renderTool();
  }

  function tick() {
    if (!mounted || !toolEl) return;
    if (selectedId === "mixamo" && !enabled.has("mixamo")) return;
    refreshLive();
  }

  return {
    mount,
    tick,
    select,
    setEnabled,
    isEnabled,
    get enabledIds() {
      return [...enabled];
    },
    get selected() {
      return selectedId;
    },
    render: renderTool,
    list: ADDONS.map((a) => ({ id: a.id, name: a.name, version: a.version, author: a.author, blurb: a.blurb, tags: a.tags.slice() })),
    /* programmatic hooks (used by the app / tests) */
    humanPrompt,
    generatePortrait,
    buildHuman,
    playMotion,
    forge: forgeMetarig,
    bind: bindModel,
    removeMetarig,
    state: () => ({
      human: { ...st.human, dataUrl: st.human.dataUrl ? "yes" : null },
      forge: {
        bones: st.forge.bones ? st.forge.bones.length : 0,
        bound: st.forge.bound.length,
        hasHolder: !!st.forge.holder,
        fit: st.forge.fit,
      },
      mixamo: { motionId: st.mixamo.motionId },
    }),
  };
}
