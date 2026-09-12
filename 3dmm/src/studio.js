import { THREE, TransformControls } from "./three.js";
import { createStudioAddons } from "./studio-addons.js";

const TAU = Math.PI * 2;
const DEG = Math.PI / 180;
const RAD = 180 / Math.PI;

const ANIMS = [
  { id: "none", label: "None", channels: [], apply: null },
  {
    id: "idle",
    label: "Idle",
    channels: [
      { name: "Location Y", fn: (p) => Math.sin(p * TAU) },
      { name: "Rotation Z", fn: (p) => Math.sin(p * TAU + 0.6) },
      { name: "Scale", fn: (p) => Math.sin(p * 2 * TAU) },
    ],
    apply: (o, p) => {
      o.position.y += Math.sin(p * TAU) * 0.03;
      o.rotateZ(Math.sin(p * TAU + 0.6) * 0.02);
      const s = 1 + Math.sin(p * 2 * TAU) * 0.006;
      o.scale.multiplyScalar(s);
    },
  },
  {
    id: "turntable",
    label: "Turntable",
    channels: [{ name: "Rotation Y", fn: (p) => p * 2 - 1 }],
    apply: (o, p) => o.rotateY(p * TAU),
  },
  {
    id: "bob",
    label: "Bob",
    channels: [{ name: "Location Y", fn: (p) => Math.sin(p * TAU) }],
    apply: (o, p) => {
      o.position.y += Math.sin(p * TAU) * 0.12;
    },
  },
  {
    id: "sway",
    label: "Sway",
    channels: [
      { name: "Rotation Z", fn: (p) => Math.sin(p * TAU) },
      { name: "Location X", fn: (p) => Math.sin(p * TAU) * 0.5 },
    ],
    apply: (o, p) => {
      o.position.x += Math.sin(p * TAU) * 0.06;
      o.rotateZ(Math.sin(p * TAU) * 0.09);
    },
  },
  {
    id: "breathe",
    label: "Breathe",
    channels: [{ name: "Scale", fn: (p) => Math.sin(p * TAU) }],
    apply: (o, p) => {
      o.scale.multiplyScalar(1 + Math.sin(p * TAU) * 0.035);
    },
  },
  {
    id: "float",
    label: "Float",
    channels: [
      { name: "Location Y", fn: (p) => Math.sin(p * TAU) },
      { name: "Rotation Z", fn: (p) => Math.sin(p * TAU + 1) },
    ],
    apply: (o, p) => {
      o.position.y += Math.sin(p * TAU) * 0.06;
      o.rotateZ(Math.sin(p * TAU + 1) * 0.05);
    },
  },
  {
    id: "wobble",
    label: "Wobble",
    channels: [
      { name: "Rotation X", fn: (p) => Math.sin(p * 2 * TAU) },
      { name: "Rotation Z", fn: (p) => Math.cos(p * 2 * TAU) },
    ],
    apply: (o, p) => {
      o.rotateX(Math.sin(p * 2 * TAU) * 0.08);
      o.rotateZ(Math.cos(p * 2 * TAU) * 0.08);
    },
  },
  {
    id: "tumble",
    label: "Tumble",
    channels: [
      { name: "Rotation X", fn: (p) => p * 2 - 1 },
      { name: "Rotation Z", fn: (p) => p * 2 - 1 },
    ],
    apply: (o, p) => {
      o.rotateX(p * TAU);
      o.rotateZ(p * TAU * 0.5);
    },
  },
];

const MAT_PRESETS = {
  gold: { color: "#d4af37", metalness: 1.0, roughness: 0.28, emissive: 0.05 },
  chrome: { color: "#e8edf5", metalness: 1.0, roughness: 0.08, emissive: 0 },
  plastic: { color: "#e2554d", metalness: 0.0, roughness: 0.4, emissive: 0 },
  rubber: { color: "#2c2f36", metalness: 0.0, roughness: 0.92, emissive: 0 },
  ceramic: { color: "#f2efe6", metalness: 0.05, roughness: 0.22, emissive: 0 },
};

const VIEW_DIRS = {
  persp: [0.55, 0.36, 1],
  top: [0, 1, 0.0001],
  bottom: [0, -1, 0.0001],
  front: [0, 0, 1],
  back: [0, 0, -1],
  right: [1, 0, 0],
  left: [-1, 0, 0],
};

const PRIMITIVES = {
  cube: () => new THREE.BoxGeometry(0.7, 0.7, 0.7),
  sphere: () => new THREE.SphereGeometry(0.45, 32, 20),
  cylinder: () => new THREE.CylinderGeometry(0.35, 0.35, 0.8, 32),
  cone: () => new THREE.ConeGeometry(0.4, 0.85, 32),
  torus: () => new THREE.TorusGeometry(0.4, 0.15, 20, 48),
  plane: () => new THREE.PlaneGeometry(1.1, 1.1),
};

const EXAMPLES = [
  {
    label: "Colour + spin the model",
    code: `// Tint the model and give it a turntable animation
const m = objects()[0];
color(m, "#6fe3c8");
anim("turntable");
time(0);
play();
log("Animating", m);`,
  },
  {
    label: "Add primitive shapes",
    code: `// Build a small still-life next to the model
const base = add("cylinder");
move(base, 1.1, -0.6, 0);
scale(base, 1, 0.4, 1);
const ball = add("sphere");
move(ball, 1.1, 0.1, 0);
color(ball, "#ffb347");
select(ball);`,
  },
  {
    label: "Animate everything differently",
    code: `// Each object gets its own preset
const list = objects();
anim("none");
for (let i = 0; i < list.length; i++) {
  select(list[i]);
  anim(["idle","bob","sway","float"][i % 4]);
  log("preset for", list[i]);
}
play();`,
  },
  {
    label: "Camera moves",
    code: `// Snap to a front view, then orbit around
view("front");
camera(0.6, 0.25, 3.2);
log("view set: front");`,
  },
];

export function initStudio(ctx) {
  const {
    THREE: _T,
    scene,
    camera,
    renderer,
    controls,
    modelGroup,
    ground,
    grid,
    sceneBase,
    hemiLight,
    keyLight,
    rimLight,
    frontMat,
    solidMat,
    state,
    stage,
    applyShading,
    frameObject,
    render,
    export: exportFn,
    toast,
    onMode,
    onBaseChange,
    getRig,
    getAnim,
  } = ctx;

  let layer = document.createElement("div");
  layer.id = "studioLayer";
  layer.hidden = true;
  layer.innerHTML = TEMPLATE;
  stage.appendChild(layer);
  injectStyles();

  const $id = (id) => layer.querySelector("#" + id);
  const qsa = (sel) => Array.from(layer.querySelectorAll(sel));

  keyLight.userData.studioName = "Key Light";
  rimLight.userData.studioName = "Rim Light";
  hemiLight.userData.studioName = "World Light";
  ground.userData.studioName = "Ground";
  grid.userData.studioName = "Grid";

  const tc = new TransformControls(camera, renderer.domElement);
  tc.size = 0.85;
  tc.setSpace("world");
  scene.add(tc);

  let on = false;
  let selected = null;
  let rest = null;
  let restObj = null;
  let tool = "select";
  let shading = "rendered";
  let viewName = "User Persp";
  let animDirty = false;
  let prevAutoRotate = controls.autoRotate;
  let extraObjects = [];
  let extraLights = [];
  let scriptOpen = false;
  let readmeOpen = false;
  let addonsOpen = false;
  let studioAddons = null;
  let readmeLoaded = false;
  let readmeRaw = "";
  let primCount = 0;
  let customColor = null;

  const anim = { preset: "none", playing: false, time: 0, duration: 4, speed: 1, loop: true };

  const fps = { frames: 0, last: performance.now(), value: 60 };

  /* ---------------------------------------------------------------- helpers */

  /* The model's own skeletal clips (from the loaded GLB/FBX rig) are surfaced in the
     Studio as extra "presets", so the armature's baked animation — e.g. a mocap take —
     can be played and scrubbed right here, alongside the procedural object presets. */
  let skelPresets = [];

  function rebuildSkelPresets() {
    const r = liveAnim();
    skelPresets = r
      ? r.clips.map((c, i) => ({
          id: "skel:" + i,
          label: (c.name || "Clip " + (i + 1)).slice(0, 26) + " \u00B7 " + (c.duration || 0).toFixed(1) + "s",
          skel: i,
          channels: [{ name: "Skeleton", fn: (p) => p }],
          apply: null,
        }))
      : [];
    if (anim.preset.indexOf("skel:") === 0 && !skelPresets.some((p) => p.id === anim.preset)) {
      anim.preset = "none";
    }
    rebuildAnimSelect();
  }

  function presetList() {
    return [...skelPresets, ...ANIMS];
  }

  function activePreset() {
    return presetList().find((a) => a.id === anim.preset) || ANIMS[0];
  }

  function skelIndex() {
    const p = activePreset();
    return p && p.skel != null ? p.skel : -1;
  }

  function modelOf() {
    return (state && state.mesh) || modelGroup.children[0] || null;
  }

  function liveRig() {
    return getRig ? getRig() : null;
  }

  /* Clip playback target: the rig's mixer when there is a rig, otherwise the app-level
     animator (morph-target / node-transform clips). Overlay & bone UI still use liveRig(). */
  function liveAnim() {
    const r = liveRig();
    if (r) return r;
    return getAnim ? getAnim() : null;
  }

  function labelOf(o) {
    if (!o) return "";
    if (o.isBone) return o.name || "Bone";
    if (o.userData && o.userData.studioName) return o.userData.studioName;
    return o.isMesh ? "Mesh" : o.type;
  }

  function nameOf(o) {
    return labelOf(o).toLowerCase();
  }

  function findByName(name) {
    const want = String(name).toLowerCase();
    const all = [...modelGroup.children, ...extraObjects, ...extraLights];
    return all.find((o) => nameOf(o) === want) || all.find((o) => nameOf(o).includes(want)) || null;
  }

  function captureRest() {
    if (!selected) return;
    rest = {
      pos: selected.position.clone(),
      quat: selected.quaternion.clone(),
      scale: selected.scale.clone(),
    };
    restObj = selected;
  }

  function resetToRest() {
    if (!selected || !rest || restObj !== selected) return;
    selected.position.copy(rest.pos);
    selected.quaternion.copy(rest.quat);
    selected.scale.copy(rest.scale);
  }

  function phase() {
    const d = anim.duration || 1;
    let t = anim.time % d;
    if (t < 0) t += d;
    return t / d;
  }

  function applyAnim() {
    const p = activePreset();
    if (p.skel != null) {
      const r = liveAnim();
      if (r) r.setClipTime(anim.time);
      return;
    }
    if (!selected || !p.apply) return;
    resetToRest();
    p.apply(selected, phase());
    selected.updateMatrix();
  }

  function isSharedMaterial(m) {
    return m === frontMat || m === solidMat;
  }

  /* ------------------------------------------------------------- selection */

  function select(obj) {
    selected = obj && obj.isObject3D ? obj : null;
    if (selected) {
      if (tool !== "select") tc.attach(selected);
      else tc.detach();
      if (restObj !== selected) captureRest();
      animDirty = true;
    } else {
      tc.detach();
      rest = null;
      restObj = null;
    }
    syncRigSelection();
    syncProps();
    renderOutliner();
    updateStatus();
  }

  /* Keep the armature overlay's highlight in step with the Studio selection, and make a
     picked bone visible so the user can see what they are posing. */
  function syncRigSelection() {
    const r = liveRig();
    if (!r) return;
    const idx = selected && selected.isBone ? r.bones.indexOf(selected) : -1;
    r.setSelected(idx);
    if (idx >= 0 && !r.group.visible) {
      r.setVisible(true);
      armatureBtn(true);
    }
  }

  function armatureBtn(on) {
    qsa('#sStrip .s-act[data-act="armature"]').forEach((b) => b.classList.toggle("active", !!on));
  }

  function toggleArmature() {
    const r = liveRig();
    if (!r) {
      toast("This model has no skeleton to show", 1800);
      return false;
    }
    const on = !r.group.visible;
    r.setVisible(on);
    if (on) {
      r.updateSkeleton();
      r.setColorByClass(true);
    }
    armatureBtn(on);
    renderOutliner();
    updateStatus();
    return on;
  }

  function pick(event) {
    const rect = renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const ray = new THREE.Raycaster();
    ray.setFromCamera(ndc, camera);

    /* The armature overlay is drawn on top of the mesh (depthTest off), so it must also
       win the pick — otherwise a bone that is visibly in front could never be selected. */
    const r = liveRig();
    if (r && r.group.visible) {
      const boneHits = ray.intersectObject(r.group, true);
      const hit = boneHits.find((h) => h.instanceId != null && h.instanceId >= 0);
      if (hit) {
        const bone = r.bones[hit.instanceId];
        if (bone) {
          select(bone);
          return;
        }
      }
    }

    const targets = [...modelGroup.children, ...extraObjects];
    const hits = ray.intersectObjects(targets, true);
    if (hits.length) {
      let o = hits[0].object;
      while (o && o.parent && !targets.includes(o)) o = o.parent;
      select(o);
    } else {
      select(null);
    }
  }

  /* ------------------------------------------------------------- animation */

  function setPreset(id) {
    const p = presetList().find((a) => a.id === id);
    if (!p) return;
    if (skelIndex() >= 0) {
      const old = liveAnim();
      if (old) old.stopClip();
    }
    resetToRest();
    anim.preset = id;
    anim.time = 0;
    const rigNow = liveRig();
    const a = liveAnim();
    if (p.skel != null && a) {
      if (rigNow) {
        rigNow.setVisible(true);
        armatureBtn(true);
      }
      a.playClip(p.skel, { loop: anim.loop, speed: anim.speed });
      anim.duration = Math.max(a.duration || 0, 0.001);
    } else {
      captureRest();
    }
    animDirty = true;
    syncAnimUI();
    buildTimeline();
    renderOutliner();
    updateStatus();
  }

  function setPlaying(v) {
    anim.playing = !!v;
    const r = liveAnim();
    if (skelIndex() >= 0 && r) r.setPlaying(anim.playing);
    const btn = $id("sTlPlay");
    if (btn) btn.innerHTML = anim.playing ? "&#10074;&#10074;" : "&#9654;";
    updateStatus();
  }

  function setSpeed(v) {
    anim.speed = Math.max(0.01, Number(v) || 1);
    if (skelIndex() >= 0) {
      const r = liveAnim();
      if (r) r.setSpeed(anim.speed);
    }
  }

  function setTime(t) {
    anim.time = Math.max(0, Math.min(anim.duration, t));
    animDirty = true;
    updatePlayhead();
  }

  function stepTime(dir) {
    anim.time = Math.max(0, Math.min(anim.duration, anim.time + dir * anim.duration / 20));
    animDirty = true;
    updatePlayhead();
  }

  /* -------------------------------------------------------------- outliner */

  function renderOutliner() {
    const body = $id("sOutlinerBody");
    if (!body) return;
    const filter = ($id("sOutlinerFilter").value || "").toLowerCase();
    body.innerHTML = "";

    const modelItems = modelGroup.children.map((o) => ({
      obj: o,
      icon: "&#9635;",
      removable: true,
    }));
    const lightItems = [
      { obj: keyLight, icon: "&#9728;" },
      { obj: rimLight, icon: "&#9728;" },
      { obj: hemiLight, icon: "&#9680;" },
      ...extraLights.map((o) => ({ obj: o, icon: "&#9728;", removable: true })),
    ];
    const envItems = [
      { obj: ground, icon: "&#9647;" },
      { obj: grid, icon: "&#9638;" },
    ];
    const extraItems = extraObjects.map((o) => ({ obj: o, icon: "&#9635;", removable: true }));
    const baseItems = sceneBase ? sceneBase.entries.map((e) => ({ obj: e.obj, icon: e.icon })) : [];

    const cols = [
      { name: "Model", icon: "\u2B21", items: [...modelItems, ...extraItems] },
      { name: "Lights", icon: "\u{1F4A1}", items: lightItems },
      { name: "Blender Base", icon: "\u{1F4D0}", items: baseItems },
      { name: "Environment", icon: "\u{1F30D}", items: envItems },
    ];

    const rigNow = liveRig();
    if (rigNow) armatureBtn(rigNow.group.visible);
    const boneFilterHit =
      !!filter && !!rigNow && rigNow.bones.some((b) => String(b.name || "").toLowerCase().includes(filter));

    const root = makeItem("Scene Collection", "\u{1F4C1}", 0, null, true);
    body.appendChild(root);

    for (const col of cols) {
      const items = col.items.filter((it) => !filter || nameOf(it.obj).includes(filter));
      if (filter && !items.length && !(col.name === "Model" && boneFilterHit)) continue;
      body.appendChild(makeItem(col.name, col.icon, 1, null, true));
      for (const it of items) body.appendChild(makeItem(labelOf(it.obj), it.icon, 2, it.obj, false, it.removable));
      if (col.name === "Model") appendBoneTree(body, filter);
    }
  }

  /* Bones are Object3Ds buried inside the model's own group tree, so the flat "Model"
     listing can't reach them. Draw the rig's bone hierarchy as an extra indented branch
     under the Model column — indent 3 sits one level below the model entry (indent 2). */

  const BONE_INDENT = 3;
  const collapsedBones = new Set();

  function appendBoneTree(body, filter) {
    const r = liveRig();
    const bones = r && r.bones;
    if (!bones || !bones.length) return;
    const parent = r.parent;
    const children = r.children;
    const n = bones.length;

    let keep = null;
    if (filter) {
      keep = new Array(n).fill(false);
      for (let i = 0; i < n; i++) {
        if (String(bones[i].name || "").toLowerCase().includes(filter)) keep[i] = true;
      }
      for (let pass = 0; pass < n; pass++) {
        let changed = false;
        for (let i = 0; i < n; i++) {
          if (!keep[i]) continue;
          const p = parent[i];
          if (p >= 0 && !keep[p]) {
            keep[p] = true;
            changed = true;
          }
        }
        if (!changed) break;
      }
    }

    const walk = (i, depth) => {
      if (keep && !keep[i]) return;
      const kids = children[i] || [];
      body.appendChild(boneItem(bones[i], i, depth, kids.length > 0));
      if (kids.length && collapsedBones.has(i)) return;
      for (const k of kids) walk(k, depth + 1);
    };
    for (let i = 0; i < n; i++) if (parent[i] === -1) walk(i, BONE_INDENT);
  }

  function boneItem(bone, idx, indent, hasKids) {
    const div = document.createElement("div");
    div.className = "s-oitem s-bone" + (selected === bone ? " sel" : "");
    div.style.paddingLeft = 6 + indent * 13 + "px";

    const car = document.createElement("span");
    car.className = "s-eye";
    car.textContent = hasKids ? (collapsedBones.has(idx) ? "\u25B8" : "\u25BE") : "";
    if (hasKids) {
      car.onclick = (e) => {
        e.stopPropagation();
        if (collapsedBones.has(idx)) collapsedBones.delete(idx);
        else collapsedBones.add(idx);
        renderOutliner();
      };
    }
    div.appendChild(car);

    const ic = document.createElement("span");
    ic.className = "s-oicon";
    ic.innerHTML = "&#9678;";
    div.appendChild(ic);

    const nm = document.createElement("span");
    nm.className = "s-oname";
    nm.textContent = labelOf(bone);
    div.appendChild(nm);

    div.onclick = () => select(bone);
    return div;
  }

  function makeItem(name, icon, indent, obj, isHeader, removable) {
    const div = document.createElement("div");
    div.className = "s-oitem" + (isHeader ? " header" : "") + (obj && obj === selected ? " sel" : "");
    div.style.paddingLeft = 6 + indent * 13 + "px";
    div.dataset.name = name.toLowerCase();

    if (!isHeader && obj) {
      const eye = document.createElement("span");
      eye.className = "s-eye";
      eye.textContent = obj.visible ? "\u25C9" : "\u25CB";
      eye.title = "Toggle visibility";
      eye.onclick = (e) => {
        e.stopPropagation();
        obj.visible = !obj.visible;
        renderOutliner();
      };
      div.appendChild(eye);
    } else {
      const sp = document.createElement("span");
      sp.className = "s-eye";
      sp.textContent = isHeader ? "\u25BE" : "";
      div.appendChild(sp);
    }

    const ic = document.createElement("span");
    ic.className = "s-oicon";
    ic.innerHTML = icon || "";
    div.appendChild(ic);

    const nm = document.createElement("span");
    nm.className = "s-oname";
    nm.textContent = name;
    div.appendChild(nm);

    if (removable) {
      const del = document.createElement("span");
      del.className = "s-odel";
      del.textContent = "\u00D7";
      del.title = "Delete";
      del.onclick = (e) => {
        e.stopPropagation();
        removeObject(obj);
      };
      div.appendChild(del);
    }

    if (!isHeader) div.onclick = () => select(obj);
    else div.onclick = () => div.classList.toggle("collapsed");
    return div;
  }

  function removeObject(obj) {
    if (!obj) return;
    if (selected === obj) select(null);
    if (obj.parent) obj.parent.remove(obj);
    if (obj.geometry && obj.geometry.dispose) obj.geometry.dispose();
    const mats = Array.isArray(obj.material) ? obj.material : obj.material ? [obj.material] : [];
    for (const m of mats) if (m && !isSharedMaterial(m) && m.dispose) m.dispose();
    extraObjects = extraObjects.filter((o) => o !== obj);
    extraLights = extraLights.filter((o) => o !== obj);
    renderOutliner();
    updateStatus();
  }

  /* -------------------------------------------------------------- properties */

  function setVec(prefix, v) {
    $id(prefix + "X").value = trim(v.x);
    $id(prefix + "Y").value = trim(v.y);
    $id(prefix + "Z").value = trim(v.z);
  }

  function trim(n) {
    return Math.abs(n) < 1e-4 ? "0" : String(Math.round(n * 1000) / 1000);
  }

  function syncProps() {
    const has = !!selected;
    qsa('.s-page[data-page="object"] input, .s-page[data-page="material"] input, .s-page[data-page="material"] select').forEach((el) => {
      el.disabled = !has;
    });
    const nameEl = $id("sPropName");
    if (!nameEl) return;
    if (!selected) {
      nameEl.value = "\u2014";
      $id("sPropType").value = "\u2014";
      $id("sVerts").value = "";
      $id("sFaces").value = "";
      return;
    }
    nameEl.value = labelOf(selected);
    $id("sPropType").value = selected.isMesh ? "Mesh" : selected.isLight ? "Light" : selected.type;
    if (selected.isMesh && selected.geometry) {
      const g = selected.geometry;
      $id("sVerts").value = g.attributes && g.attributes.position ? g.attributes.position.count : 0;
      const count = g.index ? g.index.count : g.attributes && g.attributes.position ? g.attributes.position.count : 0;
      $id("sFaces").value = Math.round(count / 3);
      const m = Array.isArray(selected.material) ? selected.material[0] : selected.material;
      if (m) {
        const cc = $id("sPrimaryColor");
        if (cc && m.color) cc.value = "#" + m.color.getHexString();
        if ("metalness" in m) $id("sMetal").value = m.metalness;
        if ("roughness" in m) $id("sRough").value = m.roughness;
        if (m.emissive) $id("sEmit").value = m.emissiveIntensity;
      }
    } else {
      $id("sVerts").value = "\u2014";
      $id("sFaces").value = "\u2014";
    }
    setVec("sLoc", selected.position);
    setVec("sRot", new THREE.Vector3(selected.rotation.x * RAD, selected.rotation.y * RAD, selected.rotation.z * RAD));
    setVec("sScl", selected.scale);
    $id("sVisChk").checked = selected.visible;
    $id("sShadowChk").checked = !!selected.castShadow;
  }

  function syncAnimUI() {
    const sel = $id("sAnimSel");
    if (sel) sel.value = anim.preset;
    const pill = $id("sAnimPill");
    if (pill) pill.textContent = activePreset().label;
    qsa("#sAnimTabs .s-animtab").forEach((t) => t.classList.toggle("active", t.dataset.anim === anim.preset));
  }

  function syncWorldUI() {
    const bg = $id("sBgColor");
    if (bg && scene.background && scene.background.isColor) bg.value = "#" + scene.background.getHexString();
    $id("sGridChk").checked = grid.visible;
    $id("sGroundChk").checked = ground.visible;
    const baseChk = $id("sBaseChk");
    if (baseChk && sceneBase) baseChk.checked = sceneBase.isEnabled();
    $id("sKeyLight").value = keyLight.intensity;
    $id("sRimLight").value = rimLight.intensity;
    $id("sAmbLight").value = hemiLight.intensity;
    $id("sOrbitChk").checked = controls.autoRotate;
    $id("sExposure").value = renderer.toneMappingExposure;
    $id("sShadowToggle").checked = renderer.shadowMap.enabled;
  }

  function applyMaterialPatch(patch) {
    if (!selected || !selected.isMesh) return;
    const mats = Array.isArray(selected.material) ? selected.material : [selected.material];
    for (const m of mats) {
      if (!m) continue;
      if (patch.color && m.color) m.color.set(patch.color);
      if (patch.metalness != null && "metalness" in m) m.metalness = patch.metalness;
      if (patch.roughness != null && "roughness" in m) m.roughness = patch.roughness;
      if (patch.emissive != null && m.emissive) {
        m.emissive.copy(m.color);
        m.emissiveIntensity = patch.emissive;
      }
      if (patch.map != null && "map" in m) m.map = patch.map;
      m.needsUpdate = true;
    }
    if (selected.material === frontMat || (Array.isArray(selected.material) && selected.material.includes(frontMat))) {
      customColor = patch.color || null;
    }
  }

  /* ---------------------------------------------------------------- timeline */

  function buildTimeline() {
    const tabs = $id("sAnimTabs");
    if (tabs) {
      tabs.innerHTML = "";
      for (const a of presetList()) {
        const b = document.createElement("div");
        b.className = "s-animtab" + (a.id === anim.preset ? " active" : "");
        b.dataset.anim = a.id;
        b.textContent = a.label;
        b.onclick = () => setPreset(a.id);
        tabs.appendChild(b);
      }
    }

    const chCtn = $id("sTlChannels");
    const trCtn = $id("sTlTracks");
    if (!chCtn || !trCtn) return;
    chCtn.innerHTML = "";
    trCtn.innerHTML = "";
    const phEl = document.createElement("div");
    phEl.className = "s-playhead";
    phEl.id = "sPlayhead";
    trCtn.appendChild(phEl);

    const chans = activePreset().channels;
    if (!chans.length) {
      const hint = document.createElement("div");
      hint.className = "s-empty";
      hint.textContent = "No animation \u2014 pick a preset below";
      chCtn.appendChild(hint);
      updatePlayhead();
      return;
    }

    for (const ch of chans) {
      const row = document.createElement("div");
      row.className = "s-channel";
      row.textContent = ch.name;
      chCtn.appendChild(row);

      const track = document.createElement("div");
      track.className = "s-track";
      const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
      svg.setAttribute("viewBox", "0 0 100 22");
      svg.setAttribute("preserveAspectRatio", "none");
      svg.classList.add("s-curve");
      const pts = [];
      let min = Infinity;
      let max = -Infinity;
      const N = 96;
      const vals = [];
      for (let i = 0; i <= N; i++) {
        const v = ch.fn(i / N);
        vals.push(v);
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (max - min < 1e-6) {
        max += 0.5;
        min -= 0.5;
      }
      for (let i = 0; i <= N; i++) {
        const x = (i / N) * 100;
        const y = 20 - ((vals[i] - min) / (max - min)) * 18;
        pts.push(x.toFixed(2) + "," + y.toFixed(2));
      }
      const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
      poly.setAttribute("points", pts.join(" "));
      poly.classList.add("s-poly");
      svg.appendChild(poly);
      const base = document.createElementNS("http://www.w3.org/2000/svg", "line");
      base.setAttribute("x1", "0");
      base.setAttribute("x2", "100");
      base.setAttribute("y1", "11");
      base.setAttribute("y2", "11");
      base.classList.add("s-baseline");
      svg.appendChild(base);
      const dot = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      dot.setAttribute("r", "1.6");
      dot.classList.add("s-dot");
      svg.appendChild(dot);
      track.appendChild(svg);
      track._chan = ch;
      track._min = min;
      track._max = max;
      trCtn.appendChild(track);
    }
    updatePlayhead();
  }

  function updatePlayhead() {
    const ph = $id("sPlayhead");
    if (!ph) return;
    const pct = (anim.time / (anim.duration || 1)) * 100;
    ph.style.left = pct + "%";
    const timeEl = $id("sTlTime");
    if (timeEl) timeEl.textContent = anim.time.toFixed(2) + "s";

    const p = phase();
    qsa("#sTlTracks .s-track").forEach((track) => {
      const ch = track._chan;
      if (!ch) return;
      const dot = track.querySelector(".s-dot");
      if (!dot) return;
      let min = track._min;
      let max = track._max;
      if (max - min < 1e-6) {
        max += 0.5;
        min -= 0.5;
      }
      const nm = (ch.fn(p) - min) / (max - min);
      dot.setAttribute("cx", (p * 100).toFixed(2));
      dot.setAttribute("cy", (20 - nm * 18).toFixed(2));
    });
  }

  function scrubFromEvent(e) {
    const track = $id("sTlTracks").querySelector(".s-track");
    if (!track) return;
    const rect = track.getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setTime(pct * anim.duration);
  }

  /* ------------------------------------------------------------------ views */

  function sceneCenter() {
    modelGroup.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(modelGroup.children.length ? modelGroup : ground);
    if (box.isEmpty()) return { center: new THREE.Vector3(), size: 2 };
    return { center: box.getCenter(new THREE.Vector3()), size: Math.max(box.getSize(new THREE.Vector3()).length(), 0.5) };
  }

  function setViewPreset(name) {
    const dir = VIEW_DIRS[name] || VIEW_DIRS.persp;
    const { center, size } = sceneCenter();
    const dist = size * 1.35;
    const v = new THREE.Vector3(dir[0], dir[1], dir[2]).normalize();
    camera.position.copy(center).addScaledVector(v, dist);
    controls.target.copy(center);
    camera.near = Math.max(dist / 400, 0.02);
    camera.far = dist * 40;
    camera.updateProjectionMatrix();
    controls.update();
    viewName = name === "persp" ? "User Persp" : name.charAt(0).toUpperCase() + name.slice(1) + " View";
    const vi = $id("sViewInfo");
    if (vi) vi.textContent = viewName;
    qsa(".s-ovbl .s-axis").forEach((b) => b.classList.toggle("active", b.dataset.view === name));
  }

  function frameSelected() {
    if (!selected) return frameObject();
    selected.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(selected);
    if (box.isEmpty()) return;
    const size = Math.max(box.getSize(new THREE.Vector3()).length(), 0.5);
    const center = box.getCenter(new THREE.Vector3());
    const dir = camera.position.clone().sub(controls.target).normalize();
    camera.position.copy(center).addScaledVector(dir, size * 1.6);
    controls.target.copy(center);
    controls.update();
  }

  function setCamera(az, el, dist) {
    const { center } = sceneCenter();
    const d = dist || sceneCenter().size * 1.35;
    const cp = Math.cos(el);
    camera.position.set(center.x + d * cp * Math.sin(az), center.y + d * Math.sin(el), center.z + d * cp * Math.cos(az));
    controls.target.copy(center);
    controls.update();
  }

  /* -------------------------------------------------------------- primitives */

  function addPrimitive(type) {
    const factory = PRIMITIVES[type] || PRIMITIVES.cube;
    primCount++;
    const mat = new THREE.MeshStandardMaterial({ color: 0xbfc6d2, roughness: 0.5, metalness: 0.1 });
    const mesh = new THREE.Mesh(factory(), mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.userData.studioName = type.charAt(0).toUpperCase() + type.slice(1) + " " + primCount;
    modelGroup.add(mesh);
    extraObjects.push(mesh);
    select(mesh);
    renderOutliner();
    return mesh.userData.studioName;
  }

  function addLight(type) {
    let light;
    if (type === "sun") light = new THREE.DirectionalLight(0xffe6c0, 1.6);
    else light = new THREE.PointLight(0x9fd0ff, 6, 12, 2);
    light.position.set(1.6, 2.2, 1.6);
    light.userData.studioName = type === "sun" ? "Sun Light" : "Point Light";
    scene.add(light);
    extraLights.push(light);
    renderOutliner();
    return light.userData.studioName;
  }

  function setShading(mode) {
    shading = mode;
    applyShading(mode);
    qsa("#sShading .s-sh-btn").forEach((b) => b.classList.toggle("active", b.dataset.shading === mode));
  }

  const TC_MODE = { move: "translate", rotate: "rotate", scale: "scale" };

  function setTool(t) {
    tool = t;
    if (t === "select") tc.detach();
    else {
      tc.setMode(TC_MODE[t] || "translate");
      if (selected) tc.attach(selected);
      else tc.detach();
    }
    qsa("#sStrip .s-tool[data-tool]").forEach((b) => b.classList.toggle("active", b.dataset.tool === t));
    const pill = $id("sModePill");
    const modeLabel = t === "select" ? "Object Mode" : t.charAt(0).toUpperCase() + t.slice(1) + " Tool";
    if (pill) pill.textContent = modeLabel;
    const mb = $id("sModeBtn");
    if (mb) mb.textContent = modeLabel;
  }

  /* ------------------------------------------------------------------ script */

  function scriptLog(text, cls) {
    const out = $id("sScriptOut");
    if (!out) return;
    const line = document.createElement("div");
    line.className = "s-line " + (cls || "out");
    line.textContent = text;
    out.appendChild(line);
    out.scrollTop = out.scrollHeight;
  }

  function buildApi() {
    return {
      add: (type) => addPrimitive(type),
      remove: (name) => {
        const o = findByName(name);
        if (o) removeObject(o);
        return !!o;
      },
      objects: () => [...modelGroup.children, ...extraLights].map((o) => labelOf(o)),
      select: (name) => {
        const o = findByName(name);
        if (o) select(o);
        return !!o;
      },
      move: (name, x, y, z) => {
        const o = findByName(name);
        if (!o) return false;
        o.position.set(x, y, z);
        if (o === selected) captureRest();
        syncProps();
        return true;
      },
      rotate: (name, x, y, z) => {
        const o = findByName(name);
        if (!o) return false;
        o.rotation.set((x || 0) * DEG, (y || 0) * DEG, (z || 0) * DEG);
        if (o === selected) captureRest();
        syncProps();
        return true;
      },
      scale: (name, x, y, z) => {
        const o = findByName(name);
        if (!o) return false;
        o.scale.set(x == null ? 1 : x, y == null ? x : y, z == null ? x : z);
        if (o === selected) captureRest();
        syncProps();
        return true;
      },
      color: (name, hex) => {
        const o = findByName(name);
        if (!o || !o.isMesh) return false;
        const mats = Array.isArray(o.material) ? o.material : [o.material];
        for (const m of mats) if (m && m.color) m.color.set(hex);
        if (mats.includes(frontMat)) customColor = hex;
        return true;
      },
      anim: (name) => {
        const a = ANIMS.find((p) => p.id === String(name).toLowerCase() || p.label.toLowerCase() === String(name).toLowerCase());
        if (!a) return false;
        setPreset(a.id);
        return true;
      },
      play: () => setPlaying(true),
      pause: () => setPlaying(false),
      time: (t) => setTime(t),
      view: (name) => {
        setViewPreset(String(name).toLowerCase());
        return true;
      },
      camera: (az, el, dist) => setCamera(az, el, dist),
      log: (...a) => scriptLog(a.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(" "), "log"),
    };
  }

  async function runScript(code) {
    const api = buildApi();
    const names = Object.keys(api);
    const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
    const fn = new AsyncFunction(...names, "THREE", "scene", code + "\n//# sourceURL=studio-script.js");
    scriptLog("\u25B6 run", "run");
    const orig = { log: console.log, warn: console.warn, error: console.error };
    const cat = (cls) => (...a) => scriptLog(a.map((v) => (typeof v === "object" ? JSON.stringify(v) : String(v))).join(" "), cls);
    console.log = cat("log");
    console.warn = cat("warn");
    console.error = cat("err");
    try {
      await fn(...names.map((n) => api[n]), THREE, scene);
      scriptLog("\u2713 done", "ok");
    } catch (e) {
      scriptLog("\u2717 " + (e && e.message ? e.message : String(e)), "err");
    } finally {
      console.log = orig.log;
      console.warn = orig.warn;
      console.error = orig.error;
      syncProps();
    }
  }

  /* -------------------------------------------------------------- scripting panel */

  function setWsActive(ws) {
    qsa("#sWsTabs .s-wstab").forEach((t) => t.classList.toggle("active", t.dataset.ws === ws));
  }

  function setScriptOpen(v) {
    scriptOpen = v;
    const panel = $id("sScript");
    if (panel) panel.hidden = !v;
    if (v) {
      readmeOpen = false;
      const rp = $id("sReadme");
      if (rp) rp.hidden = true;
      addonsOpen = false;
      const ap = $id("sAddons");
      if (ap) ap.hidden = true;
    }
    setWsActive(v ? "scripting" : readmeOpen ? "readme" : addonsOpen ? "addons" : "layout");
    if (v) {
      const ta = $id("sScriptCode");
      if (ta && !ta.value) ta.value = EXAMPLES[0].code;
      const sel = $id("sExamples");
      if (sel && !sel.options.length) {
        const ph = document.createElement("option");
        ph.value = "";
        ph.textContent = "Examples\u2026";
        sel.appendChild(ph);
        EXAMPLES.forEach((ex, i) => {
          const o = document.createElement("option");
          o.value = String(i);
          o.textContent = ex.label;
          sel.appendChild(o);
        });
      }
    }
  }

  /* ---------------------------------------------------------------- read-me panel */

  /* The Studio's "Read me" tab surfaces src/README.md — the project's single source of
     truth — so the accumulated architecture/gotcha knowledge stays one click away (and a
     future reader/agent can re-read it without leaving the app). It is fetched live (never
     duplicated into this file) and rendered with marked; if that import is unavailable it
     falls back to the raw markdown in a <pre>, which is still fully faithful. */
  async function loadReadme(force) {
    const body = $id("sReadmeBody");
    if (!body) return;
    if (readmeLoaded && !force) return;
    body.innerHTML = '<div class="s-rmloading">Loading project notes&#8230;</div>';
    try {
      const res = await fetch("src/README.md", { cache: "no-cache" });
      if (!res.ok) throw new Error("HTTP " + res.status);
      readmeRaw = await res.text();
      let html = null;
      try {
        const mod = await import("https://esm.sh/marked@12");
        const marked = mod.marked || mod.default || mod;
        html = marked.parse(readmeRaw);
      } catch (e) {
        html = null;
      }
      const esc = readmeRaw.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]));
      body.innerHTML = html
        ? '<div class="s-rmdoc">' + html + "</div>"
        : '<div class="s-rmdoc"><pre class="s-rmraw">' + esc + "</pre></div>";
      // Wide markdown tables can exceed a narrow panel; wrap each in a scroll container.
      body.querySelectorAll(".s-rmdoc table").forEach((t) => {
        const w = document.createElement("div");
        w.className = "s-rmtablewrap";
        t.parentNode.insertBefore(w, t);
        w.appendChild(t);
      });
      readmeLoaded = true;
    } catch (err) {
      body.innerHTML =
        '<div class="s-rmerr">Could not load <code>src/README.md</code> (' +
        (err && err.message ? err.message : String(err)) +
        ").<br>If you are previewing unsaved <code>src/</code> files in a browser without a service worker, save the generator and reopen.</div>";
    }
  }

  function setReadmeOpen(v) {
    readmeOpen = !!v;
    const panel = $id("sReadme");
    if (panel) panel.hidden = !readmeOpen;
    if (readmeOpen) {
      scriptOpen = false;
      const sp = $id("sScript");
      if (sp) sp.hidden = true;
      addonsOpen = false;
      const ap = $id("sAddons");
      if (ap) ap.hidden = true;
      setWsActive("readme");
      loadReadme(false);
    } else {
      setWsActive(scriptOpen ? "scripting" : addonsOpen ? "addons" : "layout");
    }
  }

  /* Add-ons panel — the Blender-style add-on manager (studio-addons.js). */
  function setAddonsOpen(v) {
    addonsOpen = !!v;
    const panel = $id("sAddons");
    if (panel) panel.hidden = !addonsOpen;
    if (addonsOpen) {
      scriptOpen = false;
      const sp = $id("sScript");
      if (sp) sp.hidden = true;
      readmeOpen = false;
      const rp = $id("sReadme");
      if (rp) rp.hidden = true;
      setWsActive("addons");
      if (studioAddons) studioAddons.render();
    } else {
      setWsActive(scriptOpen ? "scripting" : readmeOpen ? "readme" : "layout");
    }
  }

  /* ------------------------------------------------------------------ wiring */

  function openProps(name) {
    qsa("#sPropTabs .s-ptab").forEach((t) => t.classList.toggle("active", t.dataset.ptab === name));
    qsa(".s-page").forEach((p) => (p.hidden = p.dataset.page !== name));
  }

  function wire() {
    $id("sExit").onclick = () => api.setMode(false);

    qsa("#sWsTabs .s-wstab").forEach((t) => {
      t.onclick = () => {
        const ws = t.dataset.ws;
        if (ws === "scripting") {
          setReadmeOpen(false);
          setAddonsOpen(false);
          setScriptOpen(true);
          return;
        }
        if (ws === "readme") {
          setScriptOpen(false);
          setAddonsOpen(false);
          setReadmeOpen(true);
          return;
        }
        if (ws === "addons") {
          setScriptOpen(false);
          setReadmeOpen(false);
          setAddonsOpen(true);
          return;
        }
        setScriptOpen(false);
        setReadmeOpen(false);
        setAddonsOpen(false);
        if (ws === "shading") openProps("material");
        else if (ws === "animation") openProps("animation");
        else openProps("object");
        setWsActive(ws);
      };
    });

    qsa("#sStrip .s-tool[data-tool]").forEach((b) => {
      b.onclick = () => setTool(b.dataset.tool);
    });

    qsa("#sStrip .s-act").forEach((b) => {
      b.onclick = () => {
        const a = b.dataset.act;
        if (a === "frame-all") frameObject();
        else if (a === "frame-sel") frameSelected();
        else if (a === "reset") {
          if (selected && rest) {
            resetToRest();
            selected.rotation.set(0, 0, 0);
            selected.position.set(0, 0, 0);
            selected.scale.set(1, 1, 1);
            captureRest();
            syncProps();
          }
        } else if (a === "armature") toggleArmature();
        else if (a === "snapshot") snapshot();
        else if (a === "script") setScriptOpen(!scriptOpen);
        else if (a === "readme") setReadmeOpen(!readmeOpen);
        else if (a === "addons") setAddonsOpen(!addonsOpen);
      };
    });

    qsa("#sShading .s-sh-btn").forEach((b) => {
      b.onclick = () => setShading(b.dataset.shading);
    });

    qsa("[data-menu]").forEach((m) => {
      m.onclick = () => toast(m.dataset.menu + " menu is not part of this studio", 2000);
    });

    qsa("[data-dd]").forEach((dd) => {
      const menu = dd.parentElement.querySelector(".s-ddmenu");
      dd.onclick = (e) => {
        e.stopPropagation();
        qsa(".s-ddmenu").forEach((m) => {
          if (m !== menu) m.classList.remove("open");
        });
        menu.classList.toggle("open");
      };
    });
    layer.addEventListener("click", () => qsa(".s-ddmenu").forEach((m) => m.classList.remove("open")));

    qsa("[data-view]").forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.view;
        if (v === "frame-all") frameObject();
        else if (v === "frame-sel") frameSelected();
        else setViewPreset(v);
      };
    });
    qsa("[data-add]").forEach((b) => {
      b.onclick = () => {
        const v = b.dataset.add;
        if (v === "point" || v === "sun") addLight(v);
        else addPrimitive(v);
      };
    });

    // Object transform inputs
    const bind = (id, fn) => {
      const el = $id(id);
      el.oninput = () => {
        if (!selected) return;
        fn(Number(el.value) || 0);
        captureRest();
        animDirty = false;
      };
    };
    ["X", "Y", "Z"].forEach((ax) => {
      bind("sLoc" + ax, (v) => (selected.position[ax.toLowerCase()] = v));
      bind("sRot" + ax, (v) => (selected.rotation[ax.toLowerCase()] = v * DEG));
      bind("sScl" + ax, (v) => (selected.scale[ax.toLowerCase()] = v || 0.001));
    });

    $id("sVisChk").onchange = () => {
      if (selected) selected.visible = $id("sVisChk").checked;
      renderOutliner();
    };
    $id("sShadowChk").onchange = () => {
      if (selected) selected.castShadow = $id("sShadowChk").checked;
    };
    $id("sResetT").onclick = () => {
      if (!selected) return;
      selected.position.set(0, 0, 0);
      selected.rotation.set(0, 0, 0);
      selected.scale.set(1, 1, 1);
      captureRest();
      syncProps();
    };

    // Material
    $id("sPrimaryColor").oninput = () => {
      applyMaterialPatch({ color: $id("sPrimaryColor").value });
    };
    $id("sMetal").oninput = () => applyMaterialPatch({ metalness: Number($id("sMetal").value) });
    $id("sRough").oninput = () => applyMaterialPatch({ roughness: Number($id("sRough").value) });
    $id("sEmit").oninput = () => applyMaterialPatch({ emissive: Number($id("sEmit").value) });
    $id("sMatPreset").onchange = () => {
      const p = MAT_PRESETS[$id("sMatPreset").value];
      if (!p) return;
      $id("sPrimaryColor").value = p.color;
      $id("sMetal").value = p.metalness;
      $id("sRough").value = p.roughness;
      $id("sEmit").value = p.emissive;
      applyMaterialPatch(p);
    };

    // World
    $id("sBgColor").oninput = () => {
      scene.background = new THREE.Color($id("sBgColor").value);
    };
    $id("sBgGradient").onclick = () => {
      scene.background = makeGradient();
      toast("Gradient backdrop restored", 1600);
    };
    $id("sGridChk").onchange = () => (grid.visible = $id("sGridChk").checked);
    $id("sGroundChk").onchange = () => (ground.visible = $id("sGroundChk").checked);
    $id("sBaseChk").onchange = () => {
      if (sceneBase) sceneBase.setEnabled($id("sBaseChk").checked);
      if (onBaseChange) onBaseChange($id("sBaseChk").checked);
      renderOutliner();
    };
    $id("sKeyLight").oninput = () => (keyLight.intensity = Number($id("sKeyLight").value));
    $id("sRimLight").oninput = () => (rimLight.intensity = Number($id("sRimLight").value));
    $id("sAmbLight").oninput = () => (hemiLight.intensity = Number($id("sAmbLight").value));
    $id("sOrbitChk").onchange = () => (controls.autoRotate = $id("sOrbitChk").checked);

    // Render
    $id("sExposure").oninput = () => (renderer.toneMappingExposure = Number($id("sExposure").value));
    $id("sShadowToggle").onchange = () => (renderer.shadowMap.enabled = $id("sShadowToggle").checked);
    $id("sRenderBtn").onclick = () => snapshot();

    // Animation page
    $id("sAnimSel").onchange = () => setPreset($id("sAnimSel").value);
    $id("sAnimSpeed").oninput = () => setSpeed($id("sAnimSpeed").value);
    $id("sAnimLoop").onchange = () => (anim.loop = $id("sAnimLoop").checked);
    $id("sPlayBtn").onclick = () => setPlaying(!anim.playing);

    // Timeline
    $id("sTlStart").onclick = () => setTime(0);
    $id("sTlPrev").onclick = () => stepTime(-1);
    $id("sTlPlay").onclick = () => setPlaying(!anim.playing);
    $id("sTlNext").onclick = () => stepTime(1);
    $id("sTlEnd").onclick = () => setTime(anim.duration);
    $id("sTlSpeed").oninput = () => setSpeed($id("sTlSpeed").value);

    const tracks = $id("sTlTracks");
    let scrubbing = false;
    tracks.addEventListener("pointerdown", (e) => {
      scrubbing = true;
      setPlaying(false);
      scrubFromEvent(e);
      tracks.setPointerCapture(e.pointerId);
    });
    tracks.addEventListener("pointermove", (e) => {
      if (scrubbing) scrubFromEvent(e);
    });
    tracks.addEventListener("pointerup", (e) => {
      scrubbing = false;
      try {
        tracks.releasePointerCapture(e.pointerId);
      } catch (err) {}
    });

    // Outliner filter
    $id("sOutlinerFilter").oninput = () => renderOutliner();

    // Script panel
    $id("sScriptClose").onclick = () => setScriptOpen(false);
    $id("sScriptRun").onclick = () => runScript($id("sScriptCode").value);
    $id("sScriptClear").onclick = () => ($id("sScriptOut").innerHTML = "");
    $id("sExamples").onchange = () => {
      const ex = EXAMPLES[Number($id("sExamples").value)];
      if (ex) $id("sScriptCode").value = ex.code;
    };
    $id("sScriptCode").addEventListener("keydown", (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        runScript($id("sScriptCode").value);
      }
    });

    // Read-me panel
    $id("sReadmeClose").onclick = () => setReadmeOpen(false);
    $id("sReadmeReload").onclick = () => loadReadme(true);
    $id("sReadmeCopy").onclick = async () => {
      try {
        if (!readmeRaw) await loadReadme(false);
        await navigator.clipboard.writeText(readmeRaw || "");
        toast("README.md copied to clipboard", 1600);
      } catch (err) {
        toast("Could not copy README", 1800);
      }
    };

    // Add-ons panel
    if ($id("sAddonsClose")) $id("sAddonsClose").onclick = () => setAddonsOpen(false);

    // Gizmo / orbit interplay
    tc.addEventListener("dragging-changed", (e) => {
      controls.enabled = !e.value;
    });
    tc.addEventListener("objectChange", () => {
      syncProps();
    });
    tc.addEventListener("mouseUp", () => {
      if (selected && anim.preset !== "none" && !anim.playing) captureRest();
    });

    // viewport picking
    let downX = 0;
    let downY = 0;
    let downOnGizmo = false;
    renderer.domElement.addEventListener("pointerdown", (e) => {
      if (!on) return;
      downX = e.clientX;
      downY = e.clientY;
      downOnGizmo = tc.dragging || !!tc.axis;
    });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!on) return;
      if (downOnGizmo) return;
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
      if (e.button !== 0) return;
      pick(e);
    });

    // keyboard
    window.addEventListener("keydown", (e) => {
      if (!on) return;
      const tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      const k = e.key.toLowerCase();
      if (k === "escape") {
        if (readmeOpen) setReadmeOpen(false);
        else if (addonsOpen) setAddonsOpen(false);
        else if (scriptOpen) setScriptOpen(false);
        else api.setMode(false);
      } else if (k === "g") setTool("move");
      else if (k === "r") setTool("rotate");
      else if (k === "s") setTool("scale");
      else if (k === "q") setTool("select");
      else if (k === "f") frameSelected();
      else if (k === "home") frameObject();
      else if (k === " ") {
        e.preventDefault();
        setPlaying(!anim.playing);
      } else if (k === "x" || k === "delete") {
        if (selected && (modelGroup.children.includes(selected) || extraObjects.includes(selected) || extraLights.includes(selected))) {
          removeObject(selected);
        }
      }
    });

    qsa("#sPropTabs .s-ptab").forEach((t) => {
      t.onclick = () => openProps(t.dataset.ptab);
    });

    rebuildAnimSelect();
  }

  function rebuildAnimSelect() {
    const animSel = $id("sAnimSel");
    if (!animSel) return;
    animSel.innerHTML = "";
    for (const a of presetList()) {
      const o = document.createElement("option");
      o.value = a.id;
      o.textContent = a.label;
      animSel.appendChild(o);
    }
    animSel.value = anim.preset;
    if (!animSel.value) animSel.value = ANIMS[0].id;
  }

  function makeGradient() {
    const c = document.createElement("canvas");
    c.width = c.height = 512;
    const x = c.getContext("2d");
    const g = x.createRadialGradient(256, 190, 30, 256, 256, 380);
    g.addColorStop(0, "#1b2233");
    g.addColorStop(0.55, "#111621");
    g.addColorStop(1, "#07090e");
    x.fillStyle = g;
    x.fillRect(0, 0, 512, 512);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }

  function snapshot() {
    const attached = selected && tool !== "select";
    const prevVisible = tc.visible;
    tc.visible = false;
    (render || (() => renderer.render(scene, camera)))();
    const url = renderer.domElement.toDataURL("image/png");
    tc.visible = prevVisible;
    void attached;
    const a = document.createElement("a");
    a.href = url;
    a.download = (state && state.label ? state.label : "studio").replace(/[^a-z0-9]+/gi, "-").toLowerCase() + "-render.png";
    a.click();
    toast("Snapshot saved", 1800);
  }

  function updateStatus() {
    const st = $id("sStatusMode");
    if (st) st.textContent = tool === "select" ? "Object Mode" : tool.charAt(0).toUpperCase() + tool.slice(1) + " Tool";
    const vs = $id("sStatusVerts");
    if (vs) {
      if (selected && selected.isMesh && selected.geometry && selected.geometry.attributes.position) {
        const g = selected.geometry;
        const verts = g.attributes.position.count;
        const faces = Math.round((g.index ? g.index.count : verts) / 3);
        vs.textContent = "Verts: " + verts + "  |  Faces: " + faces;
      } else vs.textContent = "Verts: \u2014  |  Faces: \u2014";
    }
    const as = $id("sStatusAnim");
    if (as) as.textContent = "Anim: " + activePreset().label + (anim.playing ? " \u25B6" : "");
    const sceneStat = $id("sStatScene");
    if (sceneStat) sceneStat.textContent = "Scene: " + (modelGroup.children.length ? labelOf(modelGroup.children[0]) : "Empty");
  }

  function fpsTick(dt) {
    fps.frames++;
    const now = performance.now();
    if (now - fps.last >= 500) {
      fps.value = Math.round((fps.frames * 1000) / (now - fps.last));
      fps.frames = 0;
      fps.last = now;
      const el = $id("sFps");
      if (el) el.textContent = fps.value + " FPS";
    }
    void dt;
  }

  /* ------------------------------------------------------------------- core */

  const api = {
    setMode(v) {
      on = !!v;
      layer.hidden = !on;
      if (on) {
        prevAutoRotate = controls.autoRotate;
        controls.autoRotate = false;
        const m = modelOf();
        if (m && !m.userData.studioName) m.userData.studioName = (state && state.label) || "Model";
        if (!selected) {
          if (m) select(m);
        } else if (tool !== "select") {
          tc.attach(selected);
        }
        rebuildSkelPresets();
        syncProps();
        syncWorldUI();
        syncAnimUI();
        buildTimeline();
        renderOutliner();
        updateStatus();
        setShading(shading);
        setTool(tool);
        if (modelGroup.children.length) frameObject();
        else setViewPreset("persp");
        const r0 = liveRig();
        if (r0) {
          r0.setVisible(true);
          r0.updateSkeleton();
        }
        armatureBtn(!!r0 && r0.group.visible);
        viewName = "User Persp";
        const vi = $id("sViewInfo");
        if (vi) vi.textContent = viewName;
      } else {
        setPlaying(false);
        resetToRest();
        tc.detach();
        controls.autoRotate = prevAutoRotate;
        setScriptOpen(false);
        setReadmeOpen(false);
        setAddonsOpen(false);
      }
      if (onMode) onMode(on);
      return on;
    },
    isOn: () => on,
    onModelChanged() {
      extraObjects = extraObjects.filter((o) => modelGroup.children.includes(o));
      const valid = (o) => o && (modelGroup.children.includes(o) || extraObjects.includes(o) || extraLights.includes(o));
      if (!valid(selected)) {
        selected = null;
        rest = null;
        restObj = null;
        tc.detach();
      }
      const m = modelOf();
      if (m && !m.userData.studioName) m.userData.studioName = (state && state.label && state.label !== "model" ? state.label : "Model");
      if (on && !selected && m) select(m);
      else if (on && tool !== "select" && selected) tc.attach(selected);
      rebuildSkelPresets();
      const r = liveRig();
      const a = liveAnim();
      if (on && skelIndex() >= 0 && a) {
        a.playClip(skelIndex(), { loop: anim.loop, speed: anim.speed });
        anim.duration = Math.max(a.duration || 0, 0.001);
        anim.time = Math.min(anim.time, anim.duration);
      }
      if (on) armatureBtn(!!r && r.group.visible);
      syncAnimUI();
      buildTimeline();
      renderOutliner();
      syncProps();
      syncWorldUI();
      updateStatus();
    },
    update(dt) {
      if (!on) return;
      fpsTick(dt);
      const r = liveRig();
      const a = liveAnim();
      if (skelIndex() >= 0) {
        /* The model's own clip is advanced by the app's main loop (rig.update / animator.update),
           so here we only read the mixer's clock back into the timeline playhead. */
        if (anim.playing && a) anim.time = a.time;
      } else if (anim.playing) {
        anim.time += dt * anim.speed;
        if (anim.time >= anim.duration) {
          if (anim.loop) anim.time %= anim.duration;
          else {
            anim.time = anim.duration;
            setPlaying(false);
          }
        }
        animDirty = true;
      }
      if (animDirty && !tc.dragging) {
        applyAnim();
        animDirty = false;
      }
      if (on) updatePlayhead();
      if (r) r.updateSkeleton();
      if (studioAddons) studioAddons.tick();
    },
    select,
    setViewPreset,
    frameAll: frameObject,
    frameSelected,
    setTool,
    setShading,
    setPreset,
    setPlaying,
    setTime,
    addPrimitive,
    addLight,
    runScript,
    api: buildApi,
    setReadmeOpen,
    openReadme: () => setReadmeOpen(true),
    loadReadme,
    setAddonsOpen,
    openAddons: () => setAddonsOpen(true),
    get addonsOpen() {
      return addonsOpen;
    },
    get addons() {
      return studioAddons;
    },
    get readmeOpen() {
      return readmeOpen;
    },
    get selected() {
      return selected;
    },
    get anim() {
      return anim;
    },
    get tool() {
      return tool;
    },
  };

  wire();
  openProps("object");
  setScriptOpen(false);

  /* Blender-style add-on manager for the Studio (Mixamo Bridge, MetaHuman
     Creator, MetaRforge). The app API (window.textTo3d) is dereferenced
     lazily, since it is assigned after the Studio is constructed. */
  studioAddons = createStudioAddons({
    body: $id("sAddonsBody"),
    app: () => (typeof window !== "undefined" ? window.textTo3d : null),
    studio: api,
    getRig: () => liveRig(),
    modelGroup,
    scene,
    render,
    toast,
  });
  studioAddons.mount();

  return api;
}

/* =============================================================== markup ==== */

const TEMPLATE = `
<div class="s-header">
  <span class="s-logo">&#9673;</span>
  <span class="s-menu" data-menu="File">File</span>
  <span class="s-menu" data-menu="Edit">Edit</span>
  <span class="s-menu" data-menu="Render">Render</span>
  <span class="s-menu" data-menu="Window">Window</span>
  <span class="s-menu" data-menu="Help">Help</span>
  <span class="s-hspace"></span>
  <span class="s-stat" id="sStatScene">Scene: &#8212;</span>
  <span class="s-stat">Studio v1.0</span>
  <button class="s-exit" id="sExit">Exit Studio</button>
</div>

<div class="s-wstabs" id="sWsTabs">
  <div class="s-wstab active" data-ws="layout"><span>&#9638;</span> Layout</div>
  <div class="s-wstab" data-ws="animation"><span>&#127916;</span> Animation</div>
  <div class="s-wstab" data-ws="shading"><span>&#127912;</span> Shading</div>
  <div class="s-wstab" data-ws="scripting"><span>&#9998;</span> Scripting</div>
  <div class="s-wstab" data-ws="readme"><span>&#128214;</span> Read me</div>
  <div class="s-wstab" data-ws="addons"><span>&#129513;</span> Add-ons</div>
</div>

<div class="s-main">
  <div class="s-strip" id="sStrip">
    <button class="s-tool active" data-tool="select" title="Select (Q)">&#9723;</button>
    <button class="s-tool" data-tool="move" title="Move (G)">&#10021;</button>
    <button class="s-tool" data-tool="rotate" title="Rotate (R)">&#8634;</button>
    <button class="s-tool" data-tool="scale" title="Scale (S)">&#8596;</button>
    <div class="s-sep"></div>
    <button class="s-tool s-act" data-act="frame-all" title="Frame All (Home)">&#8982;</button>
    <button class="s-tool s-act" data-act="frame-sel" title="Frame Selected (F)">&#9635;</button>
    <button class="s-tool s-act" data-act="reset" title="Reset Transform">&#8635;</button>
    <div class="s-sep"></div>
    <button class="s-tool s-act" data-act="armature" title="Toggle Armature / Skeleton">&#9877;</button>
    <button class="s-tool s-act" data-act="snapshot" title="Render Snapshot">&#128247;</button>
    <button class="s-tool s-act" data-act="script" title="Scripting Console">&#8249;/&#8250;</button>
    <button class="s-tool s-act" data-act="readme" title="Read me &#8212; project notes">&#128214;</button>
    <button class="s-tool s-act" data-act="addons" title="Add-ons &#8212; Mixamo Bridge, MetaHuman Creator, MetaRforge">&#129513;</button>
  </div>

  <div class="s-view">
    <div class="s-vhead">
      <div class="s-dd">
        <button class="s-vbtn">View &#9662;</button>
        <div class="s-ddmenu">
          <div class="s-dditem" data-view="persp">Perspective</div>
          <div class="s-dditem" data-view="top">Top</div>
          <div class="s-dditem" data-view="front">Front</div>
          <div class="s-dditem" data-view="right">Right</div>
          <div class="s-dditem" data-view="left">Left</div>
          <div class="s-dditem" data-view="back">Back</div>
          <div class="s-ddsep"></div>
          <div class="s-dditem" data-view="frame-all">Frame All</div>
          <div class="s-dditem" data-view="frame-sel">Frame Selected</div>
        </div>
      </div>
      <div class="s-dd">
        <button class="s-vbtn">Add &#9662;</button>
        <div class="s-ddmenu">
          <div class="s-dditem" data-add="cube">Cube</div>
          <div class="s-dditem" data-add="sphere">UV Sphere</div>
          <div class="s-dditem" data-add="cylinder">Cylinder</div>
          <div class="s-dditem" data-add="cone">Cone</div>
          <div class="s-dditem" data-add="torus">Torus</div>
          <div class="s-dditem" data-add="plane">Plane</div>
          <div class="s-ddsep"></div>
          <div class="s-dditem" data-add="point">Point Light</div>
          <div class="s-dditem" data-add="sun">Sun Light</div>
        </div>
      </div>
      <span class="s-vsep"></span>
      <button class="s-vbtn" id="sModeBtn">Object Mode</button>
      <span class="s-vspace"></span>
      <div class="s-shad" id="sShading">
        <button class="s-sh-btn" data-shading="wireframe" title="Wireframe">&#9649;</button>
        <button class="s-sh-btn" data-shading="solid" title="Solid">&#11042;</button>
        <button class="s-sh-btn" data-shading="material" title="Material Preview">&#9635;</button>
        <button class="s-sh-btn active" data-shading="rendered" title="Rendered">&#9673;</button>
      </div>
    </div>

    <div class="s-ovtl">
      <div class="s-pill" id="sModePill">Object Mode</div>
      <div class="s-pill" id="sAnimPill">None</div>
    </div>
    <div class="s-ovtr">
      <div class="s-info" id="sFps">60 FPS</div>
      <div class="s-info" id="sViewInfo">User Persp</div>
    </div>
    <div class="s-ovbl">
      <button class="s-axis" data-view="persp" title="Perspective view (Home)">&#8962; Persp</button>
      <button class="s-axis" data-view="top" title="Top view">Top</button>
      <button class="s-axis" data-view="front" title="Front view">Front</button>
      <button class="s-axis" data-view="right" title="Right view">Right</button>
    </div>
  </div>

  <div class="s-right">
    <div class="s-outliner">
      <div class="s-panelhead"><span>Outliner</span><input id="sOutlinerFilter" class="s-filter" placeholder="Filter&#8230;"></div>
      <div class="s-obody" id="sOutlinerBody"></div>
    </div>
    <div class="s-props">
      <div class="s-ptabs" id="sPropTabs">
        <button class="s-ptab active" data-ptab="object" title="Object Properties">&#128230;</button>
        <button class="s-ptab" data-ptab="material" title="Material Properties">&#127912;</button>
        <button class="s-ptab" data-ptab="world" title="World Properties">&#127757;</button>
        <button class="s-ptab" data-ptab="animation" title="Animation">&#127916;</button>
        <button class="s-ptab" data-ptab="render" title="Render Properties">&#127909;</button>
      </div>
      <div class="s-pages">

        <div class="s-page" data-page="object">
          <div class="s-sec"><div class="s-sech">Transform</div><div class="s-secb">
            <div class="s-vrow"><label>Location</label><div class="s-vec">
              <input type="number" id="sLocX" step="0.02" class="ax"><input type="number" id="sLocY" step="0.02" class="ay"><input type="number" id="sLocZ" step="0.02" class="az"></div></div>
            <div class="s-vrow"><label>Rotation</label><div class="s-vec">
              <input type="number" id="sRotX" step="5" class="ax"><input type="number" id="sRotY" step="5" class="ay"><input type="number" id="sRotZ" step="5" class="az"></div></div>
            <div class="s-vrow"><label>Scale</label><div class="s-vec">
              <input type="number" id="sSclX" step="0.05" class="ax"><input type="number" id="sSclY" step="0.05" class="ay"><input type="number" id="sSclZ" step="0.05" class="az"></div></div>
            <button class="s-bbtn" id="sResetT" data-always="1">Reset Transform</button>
          </div></div>
          <div class="s-sec"><div class="s-sech">Item</div><div class="s-secb">
            <div class="s-row"><label>Name</label><input type="text" id="sPropName" readonly></div>
            <div class="s-row"><label>Type</label><input type="text" id="sPropType" readonly></div>
            <div class="s-row"><label>Verts</label><input type="text" id="sVerts" readonly></div>
            <div class="s-row"><label>Faces</label><input type="text" id="sFaces" readonly></div>
          </div></div>
          <div class="s-sec"><div class="s-sech">Visibility</div><div class="s-secb">
            <label class="s-chk"><input type="checkbox" id="sVisChk"> Show in viewport</label>
            <label class="s-chk"><input type="checkbox" id="sShadowChk"> Cast shadow</label>
          </div></div>
        </div>

        <div class="s-page" data-page="material" hidden>
          <div class="s-sec"><div class="s-sech">Surface</div><div class="s-secb">
            <div class="s-row"><label>Base colour</label><input type="color" id="sPrimaryColor" value="#ffffff"></div>
            <div class="s-row"><label>Metallic</label><input type="range" id="sMetal" min="0" max="1" step="0.02" value="0"></div>
            <div class="s-row"><label>Roughness</label><input type="range" id="sRough" min="0" max="1" step="0.02" value="0.6"></div>
            <div class="s-row"><label>Emission</label><input type="range" id="sEmit" min="0" max="1.5" step="0.05" value="0"></div>
          </div></div>
          <div class="s-sec"><div class="s-sech">Presets</div><div class="s-secb">
            <div class="s-row"><label>Preset</label><select id="sMatPreset">
              <option value="">Custom</option><option value="gold">Gold</option><option value="chrome">Chrome</option>
              <option value="plastic">Plastic</option><option value="rubber">Rubber</option><option value="ceramic">Ceramic</option>
            </select></div>
          </div></div>
        </div>

        <div class="s-page" data-page="world" hidden>
          <div class="s-sec"><div class="s-sech">World</div><div class="s-secb">
            <div class="s-row"><label>Backdrop</label><input type="color" id="sBgColor" value="#14161f"></div>
            <button class="s-bbtn" id="sBgGradient" data-always="1">Restore gradient</button>
            <label class="s-chk"><input type="checkbox" id="sGridChk" checked> Grid floor</label>
            <label class="s-chk"><input type="checkbox" id="sGroundChk" checked> Shadow catcher</label>
            <label class="s-chk"><input type="checkbox" id="sBaseChk" checked> Blender scene base</label>
            <label class="s-chk"><input type="checkbox" id="sOrbitChk"> Orbit camera</label>
          </div></div>
          <div class="s-sec"><div class="s-sech">Lights</div><div class="s-secb">
            <div class="s-row"><label>Key</label><input type="range" id="sKeyLight" min="0" max="5" step="0.1" value="2.4"></div>
            <div class="s-row"><label>Rim</label><input type="range" id="sRimLight" min="0" max="3" step="0.1" value="1.15"></div>
            <div class="s-row"><label>Ambient</label><input type="range" id="sAmbLight" min="0" max="2" step="0.05" value="0.45"></div>
          </div></div>
        </div>

        <div class="s-page" data-page="animation" hidden>
          <div class="s-sec"><div class="s-sech">Animation</div><div class="s-secb">
            <div class="s-row"><label>Preset</label><select id="sAnimSel"></select></div>
            <div class="s-row"><label>Speed</label><input type="range" id="sAnimSpeed" min="0.1" max="3" step="0.1" value="1"></div>
            <label class="s-chk"><input type="checkbox" id="sAnimLoop" checked> Loop</label>
            <button class="s-bbtn" id="sPlayBtn" data-always="1">Play / Pause</button>
          </div></div>
        </div>

        <div class="s-page" data-page="render" hidden>
          <div class="s-sec"><div class="s-sech">Render</div><div class="s-secb">
            <div class="s-row"><label>Exposure</label><input type="range" id="sExposure" min="0.4" max="2.2" step="0.02" value="1.02"></div>
            <label class="s-chk"><input type="checkbox" id="sShadowToggle" checked> Shadows</label>
            <button class="s-bbtn" id="sRenderBtn" data-always="1">Render Image</button>
          </div></div>
        </div>

      </div>
    </div>
  </div>
</div>

<div class="s-timeline">
  <div class="s-tlhead">
    <span class="s-tllabel">Timeline</span>
    <button class="s-tbtn" id="sTlStart">&#9198;</button>
    <button class="s-tbtn" id="sTlPrev">&#9664;</button>
    <button class="s-tbtn active" id="sTlPlay">&#9654;</button>
    <button class="s-tbtn" id="sTlNext">&#9654;</button>
    <button class="s-tbtn" id="sTlEnd">&#9197;</button>
    <span class="s-tsep"></span>
    <span id="sTlTime" class="s-time">0.00s</span>
    <span class="s-tsep"></span>
    <span class="s-tllabel">Speed</span>
    <input type="range" id="sTlSpeed" min="0.1" max="3" step="0.1" value="1" class="s-tspeed">
    <span class="s-hspace"></span>
    <div class="s-animtabs" id="sAnimTabs"></div>
  </div>
  <div class="s-tlbody">
    <div class="s-tlchannels" id="sTlChannels"></div>
    <div class="s-tltracks" id="sTlTracks"><div class="s-playhead" id="sPlayhead"></div></div>
  </div>
</div>

<div class="s-status">
  <span class="s-sdot"></span><span id="sStatusMode">Object Mode</span>
  <span id="sStatusVerts">Verts: &#8212;</span>
  <span id="sStatusAnim">Anim: None</span>
  <span style="margin-left:auto">3D Model Maker &mdash; Studio</span>
</div>

<div class="s-script" id="sScript" hidden>
  <div class="s-sphead">
    <span class="s-sptitle">&#9998; Scripting (JavaScript)</span>
    <button class="s-sbbtn run" id="sScriptRun">&#9654; Run <span class="s-kbd">Ctrl&#8629;</span></button>
    <select id="sExamples" class="s-ex"><option value="">Examples&#8230;</option></select>
    <button class="s-sbbtn" id="sScriptClear">Clear Console</button>
    <span class="s-hspace"></span>
    <button class="s-sbbtn" id="sScriptClose">&#10005;</button>
  </div>
  <div class="s-spbody">
    <textarea id="sScriptCode" spellcheck="false"></textarea>
    <div class="s-spout" id="sScriptOut"></div>
  </div>
  <div class="s-sphelp"><b>API:</b> add(type) &middot; remove(name) &middot; objects() &middot; select(name) &middot; move/rotate/scale(name,&#8230;) &middot; color(name,hex) &middot; anim(name) &middot; play()/pause() &middot; time(t) &middot; view(preset) &middot; camera(az,el,dist) &middot; log(&#8230;) &nbsp;&nbsp;<b>Ctrl&#8629;</b> run</div>
</div>

<div class="s-readme" id="sReadme" hidden>
  <div class="s-sphead">
    <span class="s-sptitle">&#128214; Read me &#8212; project notes (src/README.md)</span>
    <button class="s-sbbtn" id="sReadmeCopy">Copy Markdown</button>
    <button class="s-sbbtn" id="sReadmeReload">Reload</button>
    <span class="s-hspace"></span>
    <button class="s-sbbtn" id="sReadmeClose">&#10005;</button>
  </div>
  <div class="s-rmbody" id="sReadmeBody"></div>
</div>

<div class="s-addons" id="sAddons" hidden>
  <div class="s-sphead">
    <span class="s-sptitle">&#129513; Add-ons &mdash; Studio extensions</span>
    <span class="s-adnote">Enable a Blender-style add-on, then use its tools below.</span>
    <span class="s-hspace"></span>
    <button class="s-sbbtn" id="sAddonsClose">&#10005;</button>
  </div>
  <div class="s-adbody" id="sAddonsBody"></div>
</div>
`;

/* ================================================================ styles ==== */

const STYLE_ID = "studioStyles";
function injectStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const s = document.createElement("style");
  s.id = STYLE_ID;
  s.textContent = `
#studioLayer {
  position: absolute; inset: 0; z-index: 40; pointer-events: none;
  display: grid;
  grid-template-rows: 26px 30px minmax(0,1fr) auto 22px;
  grid-template-areas: "header" "wstabs" "main" "timeline" "status";
  background: transparent; color: #e6e6e6;
  font-family: "Segoe UI", ui-sans-serif, system-ui, -apple-system, Roboto, Helvetica, Arial, sans-serif;
  font-size: 12px; text-align: left;
  --b:#131313; --b2:#1d1d1d; --panel:#303030; --panel2:#282828; --head:#3d3d3d;
  --line:#4a4a4a; --btn:#545454; --btnh:#656565; --acc:#4772b3; --txt:#e6e6e6; --mut:#a0a0a0;
}
#studioLayer *, #studioLayer *::before, #studioLayer *::after { box-sizing: border-box; }
#studioLayer button, #studioLayer input, #studioLayer select, #studioLayer textarea { font: inherit; color: var(--txt); }
#studioLayer .s-hspace { flex: 1; }

#studioLayer .s-header {
  grid-area: header; display: flex; align-items: center; gap: 2px;
  background: var(--head); border-bottom: 1px solid var(--b);
  padding: 0 6px; pointer-events: auto;
}
#studioLayer .s-logo { color: #6aa2ff; font-size: 14px; margin-right: 6px; }
#studioLayer .s-menu { padding: 3px 9px; border-radius: 4px; color: #d6d6d6; cursor: pointer; }
#studioLayer .s-menu:hover { background: var(--btnh); }
#studioLayer .s-stat { color: var(--mut); padding: 0 8px; font-size: 11px; }
#studioLayer .s-exit {
  background: var(--acc); border: 1px solid #2c4a75; border-radius: 4px;
  padding: 2px 10px; cursor: pointer; margin-left: 6px;
}
#studioLayer .s-exit:hover { background: #5680c2; }

#studioLayer .s-wstabs { grid-area: wstabs; display: flex; align-items: stretch; gap: 1px; background: var(--b); pointer-events: auto; overflow-x: auto; scrollbar-width: none; }
#studioLayer .s-wstabs::-webkit-scrollbar { height: 0; }
#studioLayer .s-wstab {
  display: flex; align-items: center; gap: 6px; padding: 0 14px; cursor: pointer;
  background: var(--panel2); color: var(--mut); border-top: 2px solid transparent;
  flex: 0 0 auto; white-space: nowrap;
}
#studioLayer .s-wstab:hover { background: #333; color: var(--txt); }
#studioLayer .s-wstab.active { background: var(--b2); color: #fff; border-top-color: var(--acc); }

#studioLayer .s-main { grid-area: main; display: grid; grid-template-columns: 36px minmax(0,1fr) 252px; min-height: 0; }

#studioLayer .s-strip {
  display: flex; flex-direction: column; gap: 3px; padding: 5px 4px;
  background: var(--panel2); border-right: 1px solid var(--b); pointer-events: auto;
}
#studioLayer .s-tool {
  width: 28px; height: 26px; display: grid; place-items: center; font-size: 14px;
  background: var(--btn); border: 1px solid #202020; border-radius: 4px; color: #ddd; cursor: pointer;
}
#studioLayer .s-tool:hover { background: var(--btnh); }
#studioLayer .s-tool.active { background: var(--acc); border-color: #2c4a75; color: #fff; }
#studioLayer .s-sep { height: 1px; background: var(--line); margin: 3px 2px; }

#studioLayer .s-view { position: relative; min-width: 0; min-height: 0; }
#studioLayer .s-vhead {
  position: absolute; top: 0; left: 0; right: 0; height: 26px; z-index: 3;
  display: flex; align-items: center; gap: 2px; padding: 0 6px;
  background: rgba(40,40,40,.94); border-bottom: 1px solid var(--b); pointer-events: auto;
}
#studioLayer .s-vbtn {
  background: transparent; border: 1px solid transparent; border-radius: 4px;
  padding: 2px 9px; color: #dcdcdc; cursor: pointer;
}
#studioLayer .s-vbtn:hover { background: var(--btn); }
#studioLayer .s-vsep { width: 1px; height: 16px; background: var(--line); margin: 0 5px; }
#studioLayer .s-vspace { flex: 1; }
#studioLayer .s-dd { position: relative; }
#studioLayer .s-ddmenu {
  display: none; position: absolute; top: 100%; left: 0; min-width: 150px; z-index: 30;
  background: var(--panel); border: 1px solid var(--b); border-radius: 5px; padding: 4px;
  box-shadow: 0 10px 26px rgba(0,0,0,.5);
}
#studioLayer .s-ddmenu.open { display: block; }
#studioLayer .s-dditem { padding: 5px 9px; border-radius: 4px; cursor: pointer; white-space: nowrap; }
#studioLayer .s-dditem:hover { background: var(--acc); }
#studioLayer .s-ddsep { height: 1px; background: var(--line); margin: 4px 2px; }

#studioLayer .s-shad { display: flex; gap: 2px; }
#studioLayer .s-sh-btn {
  width: 26px; height: 20px; display: grid; place-items: center; font-size: 12px;
  background: var(--btn); border: 1px solid #202020; border-radius: 4px; cursor: pointer; color: #ddd;
}
#studioLayer .s-sh-btn.active { background: var(--acc); color: #fff; }

#studioLayer .s-ovtl { position: absolute; top: 32px; left: 8px; display: flex; gap: 6px; z-index: 2; pointer-events: none; }
#studioLayer .s-ovtr { position: absolute; top: 32px; right: 8px; display: flex; flex-direction: column; gap: 4px; align-items: flex-end; z-index: 2; pointer-events: none; }
#studioLayer .s-ovbl { position: absolute; bottom: 8px; left: 8px; display: flex; flex-direction: column; gap: 3px; z-index: 2; pointer-events: auto; }
#studioLayer .s-pill {
  background: rgba(20,20,20,.72); border: 1px solid rgba(255,255,255,.14);
  border-radius: 999px; padding: 2px 11px; font-size: 11px; color: #eaeaea;
}
#studioLayer .s-info { font-size: 11px; color: #c9c9c9; text-shadow: 0 1px 3px #000; }
#studioLayer .s-axis {
  min-width: 24px; height: 22px; padding: 0 8px; background: rgba(20,20,20,.7); border: 1px solid rgba(255,255,255,.16);
  border-radius: 4px; cursor: pointer; font-weight: 600; font-size: 11px; color: #d7dcE6;
}
#studioLayer .s-axis:hover { background: rgba(60,60,60,.9); }
#studioLayer .s-axis.active { background: var(--acc); color: #fff; border-color: var(--acc); }

#studioLayer .s-right {
  display: grid; grid-template-rows: minmax(90px, 32%) minmax(0,1fr);
  background: var(--panel); border-left: 1px solid var(--b); pointer-events: auto; min-height: 0;
}
#studioLayer .s-panelhead {
  display: flex; align-items: center; gap: 6px; padding: 4px 7px;
  background: var(--head); border-bottom: 1px solid var(--b); font-weight: 600; color: #e0e0e0;
}
#studioLayer .s-filter {
  flex: 1; min-width: 0; background: var(--b2); border: 1px solid var(--b); border-radius: 4px; padding: 2px 7px; font-size: 11px; outline: none;
}
#studioLayer .s-obody { overflow-y: auto; padding: 3px 0; }
#studioLayer .s-oitem {
  display: flex; align-items: center; gap: 6px; padding: 3px 8px; cursor: pointer; white-space: nowrap;
}
#studioLayer .s-oitem:hover { background: #3a3a3a; }
#studioLayer .s-oitem.sel { background: var(--acc); }
#studioLayer .s-oitem.header { color: #cfcfcf; font-weight: 600; cursor: default; }
#studioLayer .s-oitem.header:hover { background: transparent; }
#studioLayer .s-eye { width: 12px; color: var(--mut); font-size: 11px; }
#studioLayer .s-oicon { opacity: .85; }
#studioLayer .s-oname { overflow: hidden; text-overflow: ellipsis; }
#studioLayer .s-oitem.s-bone { color: #9fd8cc; font-size: 11px; padding-top: 1px; padding-bottom: 1px; }
#studioLayer .s-oitem.s-bone .s-oicon { color: #6fe3c8; opacity: 1; }
#studioLayer .s-oitem.s-bone.sel { color: #10141c; }
#studioLayer .s-odel { margin-left: auto; color: #c98; opacity: 0; padding: 0 3px; }
#studioLayer .s-oitem:hover .s-odel { opacity: .9; }
#studioLayer .s-odel:hover { color: #ff7a6a; }

#studioLayer .s-props { display: grid; grid-template-rows: 28px minmax(0,1fr); min-height: 0; border-top: 1px solid var(--b); }
#studioLayer .s-ptabs { display: flex; gap: 1px; background: var(--b); padding: 2px 3px 0; }
#studioLayer .s-ptab {
  width: 34px; height: 24px; display: grid; place-items: center; font-size: 14px;
  background: var(--panel2); border: none; border-bottom: 2px solid transparent; cursor: pointer; color: #cfcfcf;
}
#studioLayer .s-ptab:hover { background: #3a3a3a; }
#studioLayer .s-ptab.active { background: var(--b2); border-bottom-color: var(--acc); color: #fff; }
#studioLayer .s-pages { overflow-y: auto; min-height: 0; }
#studioLayer .s-page { padding: 4px; }
#studioLayer .s-sec { margin-bottom: 6px; border-radius: 5px; overflow: hidden; border: 1px solid var(--b); }
#studioLayer .s-sech { background: var(--head); padding: 4px 8px; font-size: 11px; font-weight: 600; color: #dcdcdc; }
#studioLayer .s-secb { background: var(--panel2); padding: 6px 8px; display: flex; flex-direction: column; gap: 5px; }
#studioLayer .s-row { display: flex; align-items: center; gap: 6px; }
#studioLayer .s-row > label { width: 62px; flex: none; color: var(--mut); font-size: 11px; }
#studioLayer .s-row input[type="text"], #studioLayer .s-row input[type="number"], #studioLayer .s-row select {
  flex: 1; min-width: 0; background: var(--b2); border: 1px solid var(--b); border-radius: 4px; padding: 2px 6px; outline: none;
}
#studioLayer .s-row input[readonly] { color: var(--mut); }
#studioLayer .s-row input[type="range"] { flex: 1; min-width: 0; accent-color: var(--acc); }
#studioLayer .s-row input[type="color"] { width: 44px; height: 20px; padding: 0; border: 1px solid var(--b); background: var(--b2); border-radius: 4px; }
#studioLayer .s-vrow { display: flex; align-items: center; gap: 6px; }
#studioLayer .s-vrow > label { width: 62px; flex: none; color: var(--mut); font-size: 11px; }
#studioLayer .s-vec { flex: 1; display: flex; gap: 3px; min-width: 0; }
#studioLayer .s-vec input { width: 100%; min-width: 0; background: var(--b2); border: 1px solid var(--b); border-radius: 4px; padding: 2px 4px; outline: none; text-align: center; }
#studioLayer .s-vec .ax { color: #ff9b9b; } #studioLayer .s-vec .ay { color: #9bff9b; } #studioLayer .s-vec .az { color: #9bc0ff; }
#studioLayer .s-chk { display: flex; align-items: center; gap: 6px; color: var(--txt); cursor: pointer; font-size: 11px; }
#studioLayer .s-chk input { accent-color: var(--acc); }
#studioLayer .s-bbtn {
  background: var(--btn); border: 1px solid #202020; border-radius: 4px; padding: 4px 8px; cursor: pointer; color: #eee;
}
#studioLayer .s-bbtn:hover { background: var(--btnh); }

#studioLayer .s-timeline {
  grid-area: timeline; background: var(--panel); border-top: 1px solid var(--b);
  display: grid; grid-template-rows: 28px 104px; pointer-events: auto;
}
#studioLayer .s-tlhead { display: flex; align-items: center; gap: 3px; padding: 0 8px; background: var(--head); border-bottom: 1px solid var(--b); overflow: hidden; }
#studioLayer .s-tllabel { color: var(--mut); font-weight: 600; padding: 0 4px; }
#studioLayer .s-tbtn {
  width: 26px; height: 20px; display: grid; place-items: center; background: var(--btn);
  border: 1px solid #202020; border-radius: 4px; cursor: pointer; color: #eee;
}
#studioLayer .s-tbtn:hover { background: var(--btnh); }
#studioLayer .s-tbtn.active { background: var(--acc); }
#studioLayer .s-tsep { width: 1px; height: 16px; background: var(--line); margin: 0 5px; }
#studioLayer .s-time { font-variant-numeric: tabular-nums; color: #dfe7ff; min-width: 46px; }
#studioLayer .s-tspeed { width: 84px; accent-color: var(--acc); }
#studioLayer .s-animtabs { display: flex; gap: 2px; margin-left: auto; overflow-x: auto; min-width: 0; flex-shrink: 1; padding-bottom: 1px; }
#studioLayer .s-animtab {
  padding: 3px 9px; border-radius: 4px; background: var(--btn); border: 1px solid #202020; cursor: pointer; color: #ddd; font-size: 11px; white-space: nowrap;
}
#studioLayer .s-animtab:hover { background: var(--btnh); }
#studioLayer .s-animtab.active { background: var(--acc); color: #fff; }

#studioLayer .s-tlbody { display: flex; min-height: 0; background: var(--b2); }
#studioLayer .s-tlchannels { width: 116px; flex: none; border-right: 1px solid var(--b); overflow: hidden; padding-top: 2px; }
#studioLayer .s-channel { height: 22px; display: flex; align-items: center; padding: 0 8px; color: var(--mut); font-size: 11px; white-space: nowrap; }
#studioLayer .s-tltracks { position: relative; flex: 1; min-width: 0; padding-top: 2px; }
#studioLayer .s-track { height: 22px; position: relative; }
#studioLayer .s-track svg { width: 100%; height: 22px; display: block; }
#studioLayer .s-poly { fill: none; stroke: #9ecbff; stroke-width: 1.6; vector-effect: non-scaling-stroke; }
#studioLayer .s-baseline { stroke: #4a5160; stroke-width: 1; stroke-dasharray: 2 3; vector-effect: non-scaling-stroke; }
#studioLayer .s-dot { fill: #ffd166; stroke: #1a1a1a; stroke-width: .6; }
#studioLayer .s-playhead {
  position: absolute; top: 0; bottom: 0; width: 2px; background: #ffcc44; left: 0; z-index: 3;
  box-shadow: 0 0 8px rgba(255,204,68,.9); pointer-events: none;
}
#studioLayer .s-playhead::before {
  content: ""; position: absolute; top: 0; left: -4px; width: 10px; height: 7px; background: #ffcc44; border-radius: 2px;
}
#studioLayer .s-empty { padding: 12px; color: #777; font-size: 11px; }

#studioLayer .s-status {
  grid-area: status; display: flex; align-items: center; gap: 14px; padding: 0 10px;
  background: var(--head); border-top: 1px solid var(--b); color: var(--mut); font-size: 11px;
  pointer-events: auto;
}
#studioLayer .s-sdot { width: 7px; height: 7px; border-radius: 50%; background: #6ad06a; }

#studioLayer .s-script {
  position: absolute; left: 0; right: 0; bottom: 0; height: 46%; z-index: 45;
  background: var(--panel); border-top: 2px solid var(--acc);
  display: grid; grid-template-rows: 30px minmax(0,1fr) 24px; pointer-events: auto;
}
#studioLayer .s-sphead { display: flex; align-items: center; gap: 6px; padding: 0 8px; background: var(--head); border-bottom: 1px solid var(--b); }
#studioLayer .s-sptitle { font-weight: 600; }
#studioLayer .s-sbbtn { background: var(--btn); border: 1px solid #202020; border-radius: 4px; padding: 3px 10px; cursor: pointer; color: #eee; }
#studioLayer .s-sbbtn:hover { background: var(--btnh); }
#studioLayer .s-sbbtn.run { background: var(--acc); }
#studioLayer .s-kbd { opacity: .7; font-size: 10px; }
#studioLayer .s-ex { background: var(--b2); border: 1px solid var(--b); border-radius: 4px; padding: 3px 6px; }
#studioLayer .s-spbody { display: grid; grid-template-columns: minmax(0,1fr) 300px; min-height: 0; }
#studioLayer .s-spbody textarea {
  width: 100%; height: 100%; resize: none; border: none; outline: none; padding: 8px 10px;
  background: #1b1b1b; color: #d6f5d6; font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 12px; line-height: 1.5;
}
#studioLayer .s-spout { border-left: 1px solid var(--b); background: #141414; overflow-y: auto; padding: 6px 8px; font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 11px; }
#studioLayer .s-line { padding: 1px 0; white-space: pre-wrap; }
#studioLayer .s-line.log { color: #cdd6e6; }
#studioLayer .s-line.run { color: #7fb3ff; }
#studioLayer .s-line.ok { color: #7fdc8a; }
#studioLayer .s-line.err { color: #ff8a7a; }
#studioLayer .s-line.warn { color: #ffcc66; }
#studioLayer .s-sphelp { display: flex; align-items: center; padding: 0 10px; background: var(--head); border-top: 1px solid var(--b); color: var(--mut); font-size: 10.5px; }

#studioLayer .s-readme {
  position: absolute; left: 0; right: 0; top: 56px; bottom: 0; z-index: 46;
  background: #1a1c22; border-top: 2px solid var(--acc);
  display: grid; grid-template-rows: 30px minmax(0,1fr); grid-template-columns: minmax(0,1fr);
  pointer-events: auto; overflow: hidden;
}
#studioLayer .s-readme[hidden] { display: none; }
#studioLayer .s-readme .s-sphead, #studioLayer .s-rmbody { min-width: 0; }
#studioLayer .s-rmbody { overflow-y: auto; overflow-x: hidden; padding: 18px 24px 48px; overscroll-behavior: contain; }
#studioLayer .s-rmdoc { max-width: 920px; margin: 0 auto; color: #dfe3ea; line-height: 1.6; text-align: left; overflow-wrap: anywhere; word-break: break-word; }
#studioLayer .s-rmdoc h1 { font-size: 22px; margin: 4px 0 14px; padding-bottom: 6px; border-bottom: 1px solid #34384a; color: #fff; }
#studioLayer .s-rmdoc h2 { font-size: 17px; margin: 24px 0 10px; padding-bottom: 4px; border-bottom: 1px solid #2a2d36; color: #cdd9ff; }
#studioLayer .s-rmdoc h3 { font-size: 14px; margin: 18px 0 8px; color: #bfe0d4; }
#studioLayer .s-rmdoc p, #studioLayer .s-rmdoc li { font-size: 12.5px; }
#studioLayer .s-rmdoc ul, #studioLayer .s-rmdoc ol { margin: 8px 0; padding-left: 22px; }
#studioLayer .s-rmdoc li { margin: 3px 0; }
#studioLayer .s-rmdoc a { color: #7fb3ff; }
#studioLayer .s-rmdoc strong { color: #fff; }
#studioLayer .s-rmdoc code {
  background: #262a33; padding: 1px 5px; border-radius: 4px;
  font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: 11.5px; color: #e6d9a8;
}
#studioLayer .s-rmdoc pre { background: #14161b; border: 1px solid #2a2d36; border-radius: 6px; padding: 10px 12px; overflow-x: auto; }
#studioLayer .s-rmdoc pre code { background: none; padding: 0; color: #cfe6c8; }
#studioLayer .s-rmdoc table { border-collapse: collapse; width: 100%; margin: 10px 0; font-size: 11.5px; }
#studioLayer .s-rmtablewrap { overflow-x: auto; margin: 10px 0; max-width: 100%; }
#studioLayer .s-rmtablewrap table { margin: 0; min-width: 100%; }
#studioLayer .s-rmtablewrap th, #studioLayer .s-rmtablewrap td { overflow-wrap: normal; word-break: normal; }
#studioLayer .s-rmtablewrap th:first-child, #studioLayer .s-rmtablewrap td:first-child { white-space: nowrap; }
#studioLayer .s-readme .s-sphead { gap: 5px; }
#studioLayer .s-readme .s-sptitle { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 11.5px; }
#studioLayer .s-readme .s-sbbtn { flex: none; }
#studioLayer .s-rmdoc th, #studioLayer .s-rmdoc td { border: 1px solid #333842; padding: 5px 9px; text-align: left; vertical-align: top; }
#studioLayer .s-rmdoc th { background: #242833; color: #dbe2f0; }
#studioLayer .s-rmdoc tr:nth-child(even) td { background: #1f222a; }
#studioLayer .s-rmdoc blockquote { border-left: 3px solid var(--acc); margin: 10px 0; padding: 2px 14px; color: #c7cdd8; background: #20242c; border-radius: 0 4px 4px 0; }
#studioLayer .s-rmdoc hr { border: none; border-top: 1px solid #333; margin: 20px 0; }
#studioLayer .s-rmdoc .s-rmraw { white-space: pre-wrap; font-size: 11.5px; }
#studioLayer .s-rmloading { padding: 30px; color: var(--mut); }
#studioLayer .s-rmerr { padding: 30px; color: #ff8a7a; line-height: 1.7; }
#studioLayer .s-rmerr code { background: #262a33; padding: 1px 5px; border-radius: 4px; }

#studioLayer .s-addons {
  position: absolute; left: 0; right: 0; top: 56px; bottom: 0; z-index: 46;
  background: #1a1c22; border-top: 2px solid var(--acc);
  display: grid; grid-template-rows: 30px minmax(0,1fr); grid-template-columns: minmax(0,1fr);
  pointer-events: auto; overflow: hidden;
}
#studioLayer .s-addons[hidden] { display: none; }
#studioLayer .s-addons .s-sptitle { flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
#studioLayer .s-adnote { color: var(--mut); font-size: 10.5px; flex: none; }
#studioLayer .s-adbody { overflow-y: auto; overflow-x: hidden; padding: 16px 18px 44px; overscroll-behavior: contain; }

@media (max-width: 900px) {
  #studioLayer .s-main { grid-template-columns: 32px minmax(0,1fr) 190px; }
  #studioLayer .s-menu { display: none; }
  #studioLayer .s-timeline { grid-template-rows: 28px 84px; }
  #studioLayer .s-animtabs { overflow-x: auto; }
}
`;
  document.head.appendChild(s);
}
