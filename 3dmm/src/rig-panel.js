/*
 * rig-panel.js — the "Armature" workspace.
 *
 * Two halves, one panel:
 *   • Understanding the rig — skeleton overlay on/off, bone tree (searchable,
 *     colour-coded by anatomical role), clip playback/scrubbing, bind-pose reset,
 *     live rig statistics. Powered by ./armature.js.
 *   • Sharing it — a room join/leave, presence roster, live pose broadcast, and
 *     other users drawn as coloured wireframe skeletons; a durable, room-scoped
 *     named-pose library that survives reloads. Powered by ./net.js + the server
 *     script in index.html.
 *
 * The panel is created by main.js and gets the current rig through onRig().
 */

import { createGhostPuppet, BONE_CLASSES } from "./armature.js";
import { createNet } from "./net.js";
import { MOTIONS, MOTION_CATEGORIES } from "./motion.js";

const ROOM_PREFIX = "rig-";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtTime(s) {
  if (!Number.isFinite(s)) return "0.00s";
  return s.toFixed(2) + "s";
}

function fmtDate(ts) {
  try {
    return new Date(ts * 1000).toLocaleDateString(undefined, { month: "short", day: "numeric" });
  } catch (e) {
    return "";
  }
}

function slotColor(slot) {
  const h = (slot * 137.508) % 360;
  return { css: `hsl(${h.toFixed(0)} 72% 62%)`, hex: hslToHex(h, 72, 62) };
}

function hslToHex(h, s, l) {
  s /= 100;
  l /= 100;
  const k = (n) => (n + h / 30) % 12;
  const a = s * Math.min(l, 1 - l);
  const f = (n) => l - a * Math.max(-1, Math.min(k(n) - 3, Math.min(9 - k(n), 1)));
  return Math.round(f(0) * 255) * 65536 + Math.round(f(8) * 255) * 256 + Math.round(f(4) * 255);
}

export function createRigPanel({
  overlay,
  scene,
  stage,
  toast,
  getRig,
  getRoot,
  getModelSize,
  render,
  camera,
  renderer,
  motions,
  author,
  partner,
  autoArmature,
  muscleRig,
  onChange,
}) {
  const net = createNet({});
  let panel = null;
  let rig = null;
  let open = false;
  let bonesList = null;
  let statusEl = null;
  let bonesCol = null;
  let animCol = null;
  let poseCol = null;
  let netCol = null;
  let roomInput = null;
  let nameInput = null;
  let roomRowEl = null;
  let nameRowEl = null;
  let animTickRef = null;
  let keyTickRef = null;
  let keyframesHost = null;
  let keySavedFetched = false;
  let motionCat = "Basic";
  const aa = { spine: 3, fingers: false, toes: true };

  const ui = {
    showSkeleton: true,
    colorByRole: true,
    broadcast: true,
    showGhosts: true,
    restoreOnJoin: true,
  };

  let captured = null;
  let roomLastPose = null;
  const ghosts = new Map(); // slot -> { puppet, name, pending }
  const presence = [];

  /* ------------------------------------------------------------- stage HUD */

  const hud = el("div", "netHud");
  hud.hidden = true;
  if (stage) stage.append(hud);

  function updateHud() {
    if (!hud) return;
    if (net.online) {
      hud.hidden = false;
      hud.innerHTML = "";
      const dot = el("span", "netDot");
      hud.append(dot, el("span", "netHudText", `${presence.length || 1} in ${net.room || "room"}`));
    } else {
      hud.hidden = true;
    }
  }

  /* ------------------------------------------------------------- rig wiring */

  function onRig(next) {
    rig = next;
    if (next) {
      next.setColorByClass(ui.colorByRole);
      next.setVisible(ui.showSkeleton);
      if (overlay && next.group) overlay.visible = true;
    }
    if (open) renderPanel();
    if (next && net.wantsOnline) net.announceRig(next.netInfo());
    if (next && !net.wantsOnline && hashRoom()) maybeAutoJoin();
  }

  /* ------------------------------------------------------------- ghosts */

  function ghostOf(slot) {
    return ghosts.get(slot);
  }

  function ensureGhost(slot, name) {
    let g = ghosts.get(slot);
    if (!g) {
      g = { puppet: null, name: name || "", pending: null };
      ghosts.set(slot, g);
    }
    if (name) g.name = name;
    return g;
  }

  function buildGhost(slot, info) {
    const g = ensureGhost(slot, info.name);
    if (g.puppet) {
      overlay.remove(g.puppet.group);
      g.puppet.dispose();
    }
    const col = slotColor(slot);
    g.puppet = createGhostPuppet({ bones: info.bones, parent: info.parent, offs: info.offs, color: col.hex, opacity: 0.9, scale: info.scale });
    g.puppet.group.userData.slot = slot;
    g.puppet.group.userData.name = info.name || "";
    overlay.add(g.puppet.group);
    if (g.pending) {
      g.puppet.setPose(g.pending.quats, g.pending.deltas);
      g.puppet.update();
    }
    layoutGhosts();
  }

  function layoutGhosts() {
    const slots = [...ghosts.keys()].sort((a, b) => a - b);
    if (!slots.length) return;
    const size = (getModelSize && getModelSize()) || 2;
    const spacing = Math.max(size * 1.1, 1.6);
    slots.forEach((slot, i) => {
      const g = ghosts.get(slot);
      if (!g || !g.puppet) return;
      g.puppet.group.position.set((i - (slots.length - 1) / 2) * spacing, 0, -size * 0.85);
    });
  }

  function dropGhost(slot) {
    const g = ghosts.get(slot);
    if (!g) return;
    if (g.puppet) {
      overlay.remove(g.puppet.group);
      g.puppet.dispose();
    }
    ghosts.delete(slot);
    layoutGhosts();
    if (render) render();
  }

  function clearGhosts() {
    for (const slot of [...ghosts.keys()]) dropGhost(slot);
  }

  /* ------------------------------------------------------------- net wiring */

  let wasOnline = false;
  net.on("status", (s) => {
    updateHud();
    if (open) renderNetwork();
    if (open && s.online !== wasOnline) renderPose();
    if (s.online && !wasOnline) {
      // Just joined: push our current pose once so everyone already in the room sees us.
      setTimeout(() => {
        const r = getRig();
        if (r && net.online && ui.broadcast) net.sendPose(r.capturePose(), { force: true });
      }, 140);
    }
    wasOnline = s.online;
    if (s.state === "error" && s.detail) toast(s.detail, 3600);
  });

  const knownSlots = new Set();
  net.on("roster", (users) => {
    presence.length = 0;
    presence.push(...users);
    const alive = new Set(users.map((u) => u.slot));
    for (const slot of [...ghosts.keys()]) if (!alive.has(slot)) dropGhost(slot);
    for (const u of users) if (ghosts.has(u.slot)) ghosts.get(u.slot).name = u.name;
    // A new peer just arrived with no pose yet — send ours so their view isn't a bind-pose ghost.
    let newcomer = false;
    for (const u of users) {
      if (!u.isSelf && !knownSlots.has(u.slot)) newcomer = true;
      knownSlots.add(u.slot);
    }
    for (const slot of [...knownSlots]) if (!alive.has(slot)) knownSlots.delete(slot);
    if (newcomer) {
      const r = getRig();
      if (r && net.online && ui.broadcast) net.sendPose(r.capturePose(), { force: true });
    }
    updateHud();
    if (open) renderNetwork();
  });

  net.on("rig", (info) => {
    if (info.slot === net.slot) return;
    buildGhost(info.slot, info);
    if (open) renderNetwork();
    if (render) render();
  });

  net.on("pose", (p) => {
    if (p.room) {
      roomLastPose = p;
      if (ui.restoreOnJoin && rig && p.quats && p.quats.length === rig.boneCount * 4) {
        rig.applyPose(p);
        if (render) render();
      }
      return;
    }
    const g = ensureGhost(p.slot);
    if (g.puppet) {
      g.puppet.setPose(p.quats, p.deltas);
      g.puppet.update();
      if (ui.showGhosts) g.puppet.group.visible = true;
    } else {
      g.pending = p;
    }
  });

  net.on("notice", (n) => toast(n.text, 3000));

  /* ------------------------------------------------------------- broadcast */

  let broadcastTimer = null;
  function startBroadcast() {
    if (broadcastTimer) return;
    broadcastTimer = setInterval(() => {
      if (!net.online || !ui.broadcast) return;
      const r = getRig();
      if (!r) return;
      net.sendPose(r.capturePose());
    }, 66);
  }
  function stopBroadcast() {
    clearInterval(broadcastTimer);
    broadcastTimer = null;
  }
  startBroadcast();

  function updateGhostVisibility() {
    for (const g of ghosts.values()) {
      if (g.puppet) g.puppet.group.visible = ui.showGhosts;
    }
    if (render) render();
  }

  /* ------------------------------------------------------------- rooms */

  function hashRoom() {
    const m = /(?:^|[#&])rig=([A-Za-z0-9._-]{1,64})/.exec(location.hash || "");
    return m ? m[1] : "";
  }

  let autoJoined = false;
  function maybeAutoJoin() {
    if (autoJoined) return;
    autoJoined = true;
    const r = hashRoom();
    if (!r) return;
    if (roomInput) roomInput.value = r;
    join(r, (nameInput && nameInput.value) || "");
  }

  function roomForRig(r) {
    return r ? ROOM_PREFIX + r.signature : "lobby";
  }

  function join(room, name) {
    const r = room || (getRig() ? roomForRig(getRig()) : "lobby");
    net.name = name || (nameInput && nameInput.value) || "";
    net.connect({ room: r, name: net.name, info: getRig() ? getRig().netInfo() : null });
    if (roomInput) roomInput.value = r;
    if (open) renderNetwork();
  }

  function leave() {
    net.disconnect();
    clearGhosts();
    presence.length = 0;
    roomLastPose = null;
    if (open) renderNetwork();
  }

  function shareLink() {
    const room = net.room || (getRig() ? roomForRig(getRig()) : "lobby");
    const url = `https://perchance.org/${window.generatorName}#rig=${room}`;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(url).then(() => toast("Share link copied", 2400), () => toast(url, 5000));
    } else {
      toast(url, 5000);
    }
    return url;
  }

  /* ------------------------------------------------------------- DOM */

  function section(title) {
    const card = el("div", "rigCard");
    card.append(el("div", "rigCardHead", title));
    return card;
  }

  function toggleRow(label, checked, onChangeFn, title) {
    const l = el("label", "check");
    const input = document.createElement("input");
    input.type = "checkbox";
    input.checked = !!checked;
    if (title) l.title = title;
    input.addEventListener("change", () => onChangeFn(input.checked));
    l.append(input, el("span", null, label));
    return l;
  }

  function build() {
    panel = el("div", "testsOverlay rigOverlay");
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Armature");

    const sheet = el("div", "testsSheet rigSheet");
    const head = el("div", "testsHead");
    head.append(el("span", "testsTitle", "Armature"));
    head.append(el("span", "testsCount rigSig"));
    head.append(el("div", "testsSpacer"));
    const presenceChip = el("span", "presenceChip");
    head.append(presenceChip);
    const closeBtn = el("button", "btn ghost testsClose", "\u00d7");
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", () => close());
    head.append(closeBtn);

    const body = el("div", "rigBody");
    bonesCol = el("div", "rigCol");
    animCol = el("div", "rigCol");
    poseCol = el("div", "rigCol");
    netCol = el("div", "rigCol");
    body.append(bonesCol, animCol, poseCol, netCol);

    statusEl = el("div", "testsStatus");

    sheet.append(head, body, statusEl);
    panel.append(sheet);
    panel.addEventListener("click", (e) => {
      if (e.target === panel) close();
    });
    (document.getElementById("app") || document.body).append(panel);
    renderPanel();
    return panel;
  }

  function renderPanel() {
    if (!panel) return;
    renderBones();
    renderAnim();
    renderPose();
    renderNetwork();
    const sig = panel.querySelector(".rigSig");
    if (sig) sig.textContent = rig ? `sig ${rig.signature} \u00b7 ${rig.boneCount} bones` : "no skeleton";
  }

  /* ---- auto-armature ---- */

  /*
   * The one-click "make this model animatable" card. The engine (auto-armature.js) forges
   * a humanoid skeleton fitted to the model's bounding box and links the meshes with
   * automatic proximity weights; after that clips, Motion and the Shape keys all apply.
   */
  function renderAutoArmature(host) {
    const card = section("Auto-armature");
    if (!autoArmature) {
      card.append(el("div", "rigHint", "Auto-armature engine unavailable."));
      host.append(card);
      return;
    }
    const st = autoArmature.state();
    card.append(
      el(
        "div",
        "rigMuted",
        "Builds a humanoid skeleton fitted to the model, then links the meshes with automatic proximity weights. Works on a model with no rig \u2014 Motion and the Shape keys drive it straight away.",
      ),
    );

    const stat = el("div", "rigStatus " + (st.hasArmature ? "ok" : ""));
    if (st.hasArmature) {
      stat.textContent = `${st.bones} bones \u00b7 ${st.linked} mesh${st.linked === 1 ? "" : "es"} linked`;
    } else if (st.rigBones) {
      stat.textContent = `Model already carries a ${st.rigBones}-bone skeleton.`;
    } else {
      stat.textContent = "No armature on this model yet.";
    }
    card.append(stat);

    const spineRow = el("label", "slider");
    spineRow.append(el("span", null, "Spine"));
    const spine = document.createElement("input");
    spine.type = "range";
    spine.min = "1";
    spine.max = "4";
    spine.step = "1";
    spine.value = String(aa.spine);
    spine.addEventListener("input", () => {
      aa.spine = Number(spine.value);
      if (autoArmature.setOptions) autoArmature.setOptions({ spine: aa.spine });
    });
    spineRow.append(spine);
    card.append(spineRow);
    card.append(
      toggleRow("Finger bones", st.fingers, (v) => {
        aa.fingers = v;
        if (autoArmature.setOptions) autoArmature.setOptions({ fingers: v });
      }),
    );
    card.append(
      toggleRow("Toe bones", st.toes, (v) => {
        aa.toes = v;
        if (autoArmature.setOptions) autoArmature.setOptions({ toes: v });
      }),
    );

    const blocked = st.rigBones > 0 && !st.hasArmature;
    const row = el("div", "testRow");
    const forgeBtn = el("button", "btn primary", st.hasArmature ? "Forge again" : blocked ? "Replace skeleton" : "Forge armature");
    forgeBtn.title = blocked
      ? "This model has its own skeleton; the auto-armature takes over (the originals are hidden, and Remove restores them)"
      : "Build a humanoid skeleton fitted to the model";
    forgeBtn.addEventListener("click", () => {
      if (autoArmature.setOptions) autoArmature.setOptions({ spine: aa.spine, fingers: aa.fingers, toes: aa.toes });
      autoArmature.generate({ force: blocked });
      if (render) render();
      renderPanel();
    });
    const linkBtn = el("button", "btn ghost", "Link mesh");
    linkBtn.title = "Weight the meshes to the forged skeleton";
    linkBtn.disabled = !st.hasArmature;
    linkBtn.addEventListener("click", () => {
      autoArmature.bind();
      if (render) render();
      renderPanel();
    });
    const rmBtn = el("button", "btn ghost", "Remove");
    rmBtn.title = "Unlink the meshes and delete the forged skeleton";
    rmBtn.disabled = !st.hasArmature;
    rmBtn.addEventListener("click", () => {
      autoArmature.remove();
      if (render) render();
      renderPanel();
    });
    row.append(forgeBtn, linkBtn, rmBtn);
    card.append(row);

    if (blocked) {
      card.append(
        el("div", "rigMuted", "Prefer the rig the file shipped with? Just inspect it below \u2014 auto-armature is for meshes that arrive without one."),
      );
    }
    host.append(card);
  }

  /* ---- muscle rig ---- */

  /*
   * The anatomical layer on top of the auto-armature (muscle-rig.js): one bone per muscle
   * belly, bound into the same skin and swelling automatically as the joints it crosses
   * flex. Built from the base armature, so it replaces it.
   */
  function renderMuscleRig(host) {
    const card = section("Muscle rig");
    if (!muscleRig) {
      card.append(el("div", "rigHint", "Muscle rig engine unavailable."));
      host.append(card);
      return;
    }
    const st = muscleRig.state();
    card.append(
      el(
        "div",
        "rigMuted",
        "Adds ~36 anatomical muscle bones on top of the humanoid skeleton. Each belly swells automatically as the joint it crosses flexes \u2014 pose the elbow and the biceps fill out, bend the knee and the hamstring/calf fire.",
      ),
    );

    const stat = el("div", "rigStatus " + (st.muscles ? "ok" : ""));
    if (st.muscles) {
      stat.textContent = `${st.muscles} muscles \u00b7 ${st.linked} mesh${st.linked === 1 ? "" : "es"} bound`;
    } else if (st.rigBones) {
      stat.textContent = `Model carries a ${st.rigBones}-bone skeleton (no muscles yet).`;
    } else {
      stat.textContent = "No muscle rig on this model yet.";
    }
    card.append(stat);

    const bulgeRow = el("label", "slider");
    bulgeRow.append(el("span", null, "Bulge"));
    const bulge = document.createElement("input");
    bulge.type = "range";
    bulge.min = "0.2";
    bulge.max = "2.5";
    bulge.step = "0.05";
    bulge.value = String(st.intensity);
    bulge.addEventListener("input", () => {
      muscleRig.setOptions({ intensity: Number(bulge.value) });
      if (render) render();
    });
    bulgeRow.append(bulge);
    card.append(bulgeRow);

    card.append(
      toggleRow("Auto flex", st.flex, (v) => {
        muscleRig.setOptions({ flex: v });
        if (render) render();
      }, "Swell each muscle from the live pose every frame"),
    );

    const blocked = st.rigBones > 0 && !st.hasArmature;
    const row = el("div", "testRow");
    const forgeBtn = el("button", "btn primary", st.muscles ? "Rebuild muscle rig" : blocked ? "Replace skeleton" : "Forge muscle rig");
    forgeBtn.title = st.muscles
      ? "Re-forge the base skeleton and its muscle layer"
      : "Forge the humanoid skeleton with the anatomical muscle layer and bind it";
    forgeBtn.addEventListener("click", () => {
      if (autoArmature && autoArmature.setOptions) autoArmature.setOptions({ spine: aa.spine, fingers: aa.fingers, toes: aa.toes });
      muscleRig.generate({ spine: aa.spine, fingers: aa.fingers, toes: aa.toes, intensity: Number(bulge.value), force: blocked });
      if (render) render();
      renderPanel();
    });
    const rmBtn = el("button", "btn ghost", "Remove");
    rmBtn.title = "Remove the whole armature (muscles included)";
    rmBtn.disabled = !st.hasArmature;
    rmBtn.addEventListener("click", () => {
      muscleRig.remove();
      if (render) render();
      renderPanel();
    });
    row.append(forgeBtn, rmBtn);
    card.append(row);
    host.append(card);
  }

  /* ---- bones column ---- */

  function renderBones() {
    if (!bonesCol) return;
    bonesCol.innerHTML = "";
    renderAutoArmature(bonesCol);
    renderMuscleRig(bonesCol);
    const card = section("Skeleton");
    if (!rig) {
      card.append(el("div", "rigHint", "No armature on this model. Forge one with Auto-armature above, or load a rigged FBX / GLB / GLTF (with a skeleton) to inspect bones, clips and poses."));
      bonesCol.append(card);
      return;
    }

    card.append(toggleRow("Show skeleton", ui.showSkeleton, (v) => {
      ui.showSkeleton = v;
      rig.setVisible(v);
      if (render) render();
    }));
    card.append(toggleRow("Colour by bone role", ui.colorByRole, (v) => {
      ui.colorByRole = v;
      rig.setColorByClass(v);
      if (render) render();
    }));

    const sizeRow = el("label", "slider");
    sizeRow.append(el("span", null, "Bone size"));
    const sizeRange = document.createElement("input");
    sizeRange.type = "range";
    sizeRange.min = "0.3";
    sizeRange.max = "2.4";
    sizeRange.step = "0.05";
    sizeRange.value = "1";
    sizeRange.addEventListener("input", () => rig.setWidthScale(Number(sizeRange.value)));
    sizeRow.append(sizeRange);
    card.append(sizeRow);

    const legend = el("div", "boneLegend");
    const roleCounts = {};
    for (const c of rig.classes) roleCounts[c] = (roleCounts[c] || 0) + 1;
    for (const key of Object.keys(BONE_CLASSES)) {
      const n = roleCounts[key] || 0;
      const item = el("span", "boneLegendItem");
      const sw = el("span", "boneSwatch");
      sw.style.background = "#" + BONE_CLASSES[key].color.toString(16).padStart(6, "0");
      item.append(sw, el("span", null, BONE_CLASSES[key].label + " \u00b7 " + n));
      item.title = n + " bone" + (n === 1 ? "" : "s") + " in the " + BONE_CLASSES[key].label + " group";
      legend.append(item);
    }
    card.append(legend);

    const search = document.createElement("input");
    search.type = "search";
    search.placeholder = "Search bones\u2026";
    search.className = "rigSearch";
    card.append(search);

    bonesList = el("div", "boneList");
    card.append(bonesList);
    bonesCol.append(card);

    const collapsed = new Set();
    const sel = el("div", "boneInfo");

    function boneChildren(i) {
      return rig.children[i] || [];
    }

    function hasCollapsedAncestor(i) {
      let p = rig.parent[i];
      while (p >= 0) {
        if (collapsed.has(p)) return true;
        p = rig.parent[p];
      }
      return false;
    }

    function updateInfo() {
      sel.innerHTML = "";
      const i = rig.selected;
      if (i < 0) {
        sel.append(el("span", "rigMuted", "Click a bone to inspect it \u2014 in the tree or in the viewport."));
        return;
      }
      const row = (k, v) => {
        const r = el("div", "kv");
        r.append(el("span", null, k), el("b", null, v));
        return r;
      };
      const b = rig.bones[i];
      sel.append(row("Bone", rig.names[i]));
      sel.append(row("Role", BONE_CLASSES[rig.classes[i]].label));
      sel.append(row("Parent", rig.parent[i] >= 0 ? rig.names[rig.parent[i]] : "\u2014"));
      sel.append(row("Children", String(boneChildren(i).length)));
      sel.append(row("Local pos", b.position.toArray().map((v) => v.toFixed(3)).join(", ")));
    }

    function renderList() {
      bonesList.innerHTML = "";
      const q = search.value.trim().toLowerCase();
      let shown = 0;
      for (let i = 0; i < rig.boneCount; i++) {
        if (q) {
          // keep a bone when it (or a descendant) matches
          let hit = rig.names[i].toLowerCase().includes(q);
          if (!hit) {
            let p = rig.parent[i];
            while (p >= 0 && !hit) { hit = rig.names[p].toLowerCase().includes(q); p = rig.parent[p]; }
          }
          if (!hit) continue;
        } else if (hasCollapsedAncestor(i)) {
          continue;
        }
        const depth = (() => { let d = 0, p = rig.parent[i]; while (p >= 0) { d++; p = rig.parent[p]; } return d; })();
        const rowEl = el("div", "boneRow" + (i === rig.selected ? " active" : ""));
        rowEl.style.paddingLeft = 6 + depth * 13 + "px";
        const kids = boneChildren(i);
        const twisty = el("span", "boneTwisty", kids.length ? (collapsed.has(i) ? "\u25b8" : "\u25be") : "\u00b7");
        if (kids.length) {
          twisty.addEventListener("click", (e) => {
            e.stopPropagation();
            if (collapsed.has(i)) collapsed.delete(i); else collapsed.add(i);
            renderList();
          });
        }
        const dot = el("span", "boneDot");
        dot.style.background = "#" + BONE_CLASSES[rig.classes[i]].color.toString(16).padStart(6, "0");
        rowEl.append(twisty, dot, el("span", "boneName", rig.names[i]));
        rowEl.addEventListener("click", () => {
          rig.setSelected(i);
          if (render) render();
          renderList();
          updateInfo();
        });
        bonesList.append(rowEl);
        shown++;
      }
      if (!shown) bonesList.append(el("div", "rigMuted", "No bones match."));
    }

    search.addEventListener("input", renderList);
    renderList();
    bonesList.append(sel);
    updateInfo();

    // Re-render the selection info when the user picks a bone in the viewport.
    panel._boneInfo = updateInfo;
    panel._renderList = renderList;
  }

  /* ---- animation column ---- */

  function renderAnim() {
    if (!animCol) return;
    animCol.innerHTML = "";
    animTickRef = null;
    const card = section("Rig");
    if (!rig) {
      card.append(el("div", "rigHint", "Load a rigged model to see its bones, clips and stats."));
      animCol.append(card);
      return;
    }
    const stat = (k, v) => {
      const r = el("div", "kv");
      r.append(el("span", null, k), el("b", null, v));
      return r;
    };
    card.append(stat("Bones", String(rig.info.stats.bones)));
    card.append(stat("Skinned meshes", String(rig.info.stats.skinnedMeshes)));
    card.append(stat("Vertices", rig.info.stats.vertices.toLocaleString()));
    card.append(stat("Triangles", rig.info.stats.triangles.toLocaleString()));
    card.append(stat("Signature", rig.signature));
    animCol.append(card);

    const anim = section("Animation");
    if (!rig.clips.length) {
      anim.append(el("div", "rigHint", "This rig has no animation clips."));
    } else {
      const list = el("div", "clipList");
      rig.clips.forEach((c) => {
        const rowEl = el("div", "clipRow" + (c.index === rig.clipIndex ? " active" : ""));
        rowEl.append(el("span", "clipName", c.name));
        rowEl.append(el("span", "clipMeta", `${fmtTime(c.duration)} \u00b7 ${c.tracks} tracks`));
        rowEl.addEventListener("click", () => {
          rig.playClip(c.index);
          rig.setVisible(ui.showSkeleton);
          if (render) render();
          renderAnim();
        });
        list.append(rowEl);
      });
      anim.append(list);

      const row = el("div", "testRow");
      const playBtn = el("button", "btn ghost", rig.playing ? "\u23f8 Pause" : "\u25b6 Play");
      playBtn.addEventListener("click", () => {
        if (!rig.clipIndex && rig.clips.length) rig.playClip(0);
        else rig.setPlaying(!rig.playing);
        if (render) render();
        renderAnim();
      });
      const stopBtn = el("button", "btn ghost", "\u25a0 Stop");
      stopBtn.addEventListener("click", () => {
        rig.stopClip();
        if (render) render();
        renderAnim();
      });
      row.append(playBtn, stopBtn);
      anim.append(row);

      const timeRow = el("label", "slider");
      timeRow.append(el("span", null, "Time"));
      const timeRange = document.createElement("input");
      timeRange.type = "range";
      timeRange.min = "0";
      timeRange.max = String(rig.duration || 1);
      timeRange.step = "0.01";
      timeRange.value = String(rig.time);
      timeRange.addEventListener("input", () => {
        if (!rig.clipIndex && rig.clips.length) rig.playClip(0);
        rig.setPlaying(false);
        rig.setClipTime(Number(timeRange.value));
        if (render) render();
      });
      timeRow.append(timeRange);
      anim.append(timeRow);
      const timeLbl = el("div", "rigMuted", fmtTime(rig.time) + " / " + fmtTime(rig.duration));
      anim.append(timeLbl);

      const speedRow = el("label", "slider");
      speedRow.append(el("span", null, "Speed"));
      const speed = document.createElement("input");
      speed.type = "range";
      speed.min = "0.1";
      speed.max = "2.5";
      speed.step = "0.05";
      speed.value = "1";
      speed.addEventListener("input", () => rig.setSpeed(Number(speed.value)));
      speedRow.append(speed);
      anim.append(speedRow);
      animTickRef = () => {
        timeRange.value = String(rig.time);
        timeLbl.textContent = fmtTime(rig.time) + " / " + fmtTime(rig.duration);
      };
    }
    animCol.append(anim);
    renderMotions(animCol);
    renderPartner(animCol);
  }

  /* ---- partner (duplicate second body, partner.js) ---- */

  function renderPartner(host) {
    if (!partner) return;
    const card = section("Partner");
    card.append(
      el(
        "div",
        "rigMuted",
        "Duplicate the body on stage as a second character. The Partner motions pair both bodies and seat the duplicate by its hips; fine-tune it here.",
      ),
    );

    const row = el("div", "testRow");
    const dupBtn = el("button", "btn ghost", partner.active ? "Remove partner" : "Duplicate body");
    dupBtn.addEventListener("click", () => {
      if (partner.active) {
        partner.remove();
      } else if (!partner.duplicate()) {
        toast("Load a rigged model first", 2600);
      }
      if (render) render();
      renderAnim();
    });
    row.append(dupBtn);
    if (partner.active) {
      const snap = el("button", "btn ghost", "Match hips");
      snap.title = "Re-seat the duplicate's hips against the body on stage";
      snap.addEventListener("click", () => {
        partner.matchHips();
        if (render) render();
      });
      row.append(snap);
    }
    card.append(row);

    if (partner.active) {
      const addNudge = (label, axis, min, max, unit) => {
        const r = el("label", "slider");
        r.append(el("span", null, label));
        const inp = document.createElement("input");
        inp.type = "range";
        inp.min = String(min);
        inp.max = String(max);
        inp.step = "0.01";
        inp.value = String(partner.state().pos ? partner.state().pos[axis] : 0);
        inp.addEventListener("input", () => {
          const p = partner.state().pos;
          if (!p) return;
          const d = Number(inp.value) - p[axis];
          partner.translate(axis === 0 ? d : 0, axis === 1 ? d : 0, axis === 2 ? d : 0);
        });
        r.append(inp);
        card.append(r);
      };
      addNudge("Move X", 0, -3, 3);
      addNudge("Move up", 1, -3, 3);
      addNudge("Move Z", 2, -3, 3);

      const yawRow = el("label", "slider");
      yawRow.append(el("span", null, "Turn"));
      const yaw = document.createElement("input");
      yaw.type = "range";
      yaw.min = String(-Math.PI);
      yaw.max = String(Math.PI);
      yaw.step = "0.02";
      yaw.value = String(partner.state().yaw);
      yaw.addEventListener("input", () => partner.setYaw(Number(yaw.value)));
      yawRow.append(yaw);
      card.append(yawRow);
    }

    host.append(card);
  }

  /* ---- procedural motions (motion.js) ---- */

  function renderMotions(host) {
    const card = section("Motion");
    if (!motions) {
      card.append(el("div", "rigHint", "Motion engine unavailable."));
      host.append(card);
      return;
    }
    if (!rig) {
      card.append(el("div", "rigHint", "Load a rigged model to drive its bones procedurally."));
      host.append(card);
      return;
    }
    if (!motions.hasRig) motions.setRig(rig);
    card.append(
      el(
        "div",
        "rigMuted",
        "Generated straight on the skeleton — no clip needed. Selecting one stops clip playback; every motion is rebuilt from the bind pose each frame and can be exported as keys.",
      ),
    );

    const cats = el("div", "motionCats");
    for (const c of MOTION_CATEGORIES) {
      const b = el("button", "motionCat" + (c.id === motionCat ? " active" : ""), c.label);
      b.addEventListener("click", () => {
        motionCat = c.id;
        renderAnim();
      });
      cats.append(b);
    }
    card.append(cats);

    const list = el("div", "motionList");
    const items = MOTIONS.filter((m) => m.category === motionCat);
    for (const m of items) {
      const active = motions.motionId === m.id;
      const rowEl = el("div", "motionRow" + (active ? " active" : ""));
      rowEl.append(el("span", "motionName", m.label));
      rowEl.append(el("span", "motionDesc", m.desc));
      if (active) rowEl.append(el("span", "motionBadge", "playing"));
      rowEl.addEventListener("click", () => {
        if (author && author.playing) author.pause();
        if (m.partner && partner) {
          const on = !!(partner.preset && partner.preset.id === m.id);
          if (on) {
            motions.stop();
            partner.stopMotion();
          } else if (!partner.playPair(m)) {
            toast("Couldn't build a partner \u2014 load a rigged model first", 3000);
          }
        } else {
          if (motions.motionId === m.id) {
            motions.stop();
          } else if (!motions.play(m.id)) {
            toast("This model has no usable skeleton", 2600);
          }
          if (partner && partner.active) partner.stopMotion();
        }
        if (render) render();
        renderAnim();
      });
      list.append(rowEl);
    }
    card.append(list);

    if (motions.motion) {
      const row = el("div", "testRow");
      const playBtn = el("button", "btn ghost", motions.playing ? "\u23f8 Pause" : "\u25b6 Play");
      playBtn.addEventListener("click", () => {
        motions.setPlaying(!motions.playing);
        renderAnim();
      });
      const stopBtn = el("button", "btn ghost", "\u25a0 Stop");
      stopBtn.addEventListener("click", () => {
        motions.stop();
        if (render) render();
        renderAnim();
      });
      row.append(playBtn, stopBtn);
      card.append(row);

      const speedRow = el("label", "slider");
      speedRow.append(el("span", null, "Speed"));
      const speed = document.createElement("input");
      speed.type = "range";
      speed.min = "0.1";
      speed.max = "2.5";
      speed.step = "0.05";
      speed.value = "1";
      speed.addEventListener("input", () => motions.setSpeed(Number(speed.value)));
      speedRow.append(speed);
      card.append(speedRow);

      card.append(toggleRow("Loop", motions.loop, (v) => motions.setLoop(v)));
    }

    host.append(card);
  }

  /* ---- pose column ---- */

  function renderPose() {
    if (!poseCol) return;
    poseCol.innerHTML = "";
    const card = section("Pose");
    if (!rig) {
      card.append(el("div", "rigHint", "No rig loaded."));
      poseCol.append(card);
      return;
    }
    const row = el("div", "testRow");
    const resetBtn = el("button", "btn ghost", "Bind pose");
    resetBtn.title = "Return every bone to its rest transform";
    resetBtn.addEventListener("click", () => {
      rig.resetPose();
      if (render) render();
    });
    const capBtn = el("button", "btn ghost", "Capture");
    capBtn.title = "Remember the current pose";
    capBtn.addEventListener("click", () => {
      captured = rig.capturePose();
      toast("Pose captured", 1800);
      renderPose();
    });
    const applyBtn = el("button", "btn ghost", "Apply");
    applyBtn.disabled = !captured;
    applyBtn.title = "Restore the captured pose";
    applyBtn.addEventListener("click", () => {
      if (captured) { rig.applyPose(captured); if (render) render(); }
    });
    row.append(resetBtn, capBtn, applyBtn);
    card.append(row);

    const pasteRow = el("div", "testRow");
    const copyBtn = el("button", "btn ghost grow", "Copy pose JSON");
    copyBtn.title = "Copy the current bone rotations as JSON";
    copyBtn.addEventListener("click", () => {
      const pose = rig.capturePose();
      const obj = { bones: rig.names, quats: Array.from(pose.quats, (v) => +v.toFixed(4)), deltas: Array.from(pose.deltas, (v) => +v.toFixed(4)) };
      const txt = JSON.stringify(obj);
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(txt).then(() => toast("Pose JSON copied", 2200), () => toast("Copy failed", 2200));
    });
    pasteRow.append(copyBtn);
    card.append(pasteRow);
    card.append(el("div", "rigMuted", "Tip: drag the Studio gizmo onto a selected bone to pose it by hand."));
    poseCol.append(card);

    const lib = section("Shared poses");
    const netNote = el("div", "rigMuted", net.online ? "Saved to this room on the server \u2014 everyone here can load them." : "Join a room to save and load shared poses.");
    lib.append(netNote);

    const saveRow = el("div", "testRow");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.placeholder = "Pose name";
    nameInput.className = "rigSearch grow";
    nameInput.maxLength = 60;
    const saveBtn = el("button", "btn ghost", "Save");
    saveBtn.disabled = !net.online;
    saveBtn.addEventListener("click", async () => {
      const nm = nameInput.value.trim();
      if (!nm) { toast("Name the pose first", 2200); return; }
      saveBtn.disabled = true;
      try {
        await net.savePose(nm, rig.capturePose());
        nameInput.value = "";
        toast("Pose saved to the room", 2200);
        await renderPoseLib(listEl);
      } catch (e) {
        toast("Save failed: " + (e && e.message ? e.message : e), 3200);
      } finally {
        saveBtn.disabled = !net.online;
      }
    });
    saveRow.append(nameInput, saveBtn);
    lib.append(saveRow);

    const listEl = el("div", "poseList");
    lib.append(listEl);
    poseCol.append(lib);
    renderPoseLib(listEl);

    keyframesHost = el("div");
    poseCol.append(keyframesHost);
    renderKeyframes();
  }

  /* ---- keyframe authoring (anim-author.js) ---- */

  function renderKeyframes() {
    if (!keyframesHost) return;
    keyframesHost.innerHTML = "";
    keyTickRef = null;
    const card = section("Keyframes");
    if (!author) {
      card.append(el("div", "rigHint", "Animation author unavailable."));
      keyframesHost.append(card);
      return;
    }
    if (!rig) {
      card.append(el("div", "rigHint", "Load a rigged model to author an animation."));
      keyframesHost.append(card);
      return;
    }
    card.append(
      el(
        "div",
        "rigMuted",
        "Pose the rig (Studio gizmo, a shared pose, a Motion), then Set key at the playhead. Keys interpolate into a playable clip you can export to GLB.",
      ),
    );

    if (!author.keyCount) {
      card.append(el("div", "rigMuted", "No keys yet \u2014 add at least one."));
    }

    /* transport */
    const row = el("div", "testRow");
    const playBtn = el("button", "btn ghost", author.playing ? "\u23f8 Pause" : "\u25b6 Play");
    playBtn.addEventListener("click", () => {
      if (!author.keyCount) {
        toast("Set a key first", 2200);
        return;
      }
      author.toggle();
      renderKeyframes();
    });
    const stopBtn = el("button", "btn ghost", "\u25a0 Stop");
    stopBtn.addEventListener("click", () => {
      author.stop();
      if (render) render();
      renderKeyframes();
    });
    const setBtn = el("button", "btn primary", "+ Key");
    setBtn.title = "Capture the current pose at the playhead";
    setBtn.addEventListener("click", () => {
      if (motions && motions.motion) motions.stop();
      const k = author.captureKey(author.time);
      if (k) toast("Key set @ " + author.time.toFixed(2) + "s", 1800);
      renderKeyframes();
    });
    const delBtn = el("button", "btn ghost", "\u00d7 Key");
    delBtn.title = "Delete the key nearest the playhead";
    delBtn.addEventListener("click", () => {
      if (author.removeKeyNear(author.time)) toast("Key removed", 1600);
      renderKeyframes();
    });
    row.append(playBtn, stopBtn, setBtn, delBtn);
    card.append(row);

    /* timeline */
    const track = el("div", "keyTrack");
    track.title = "Click to move the playhead";
    for (let i = 0; i < author.keyCount; i++) {
      const t = author.keys[i];
      const tick = el("span", "keyTick");
      tick.style.left = (author.duration > 0 ? (t / author.duration) * 100 : 0) + "%";
      tick.title = t.toFixed(2) + "s";
      track.append(tick);
    }
    const playhead = el("span", "keyPlayhead");
    track.append(playhead);
    const seek = (e) => {
      const rect = track.getBoundingClientRect();
      if (!rect.width) return;
      const u = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
      if (motions && motions.motion) motions.stop();
      author.setTime(u * author.duration);
      if (render) render();
      updateKeyTick();
    };
    track.addEventListener("pointerdown", seek);
    card.append(track);
    const timeLbl = el("div", "rigMuted", fmtTime(author.time) + " / " + fmtTime(author.duration));
    card.append(timeLbl);

    /* duration + loop + autokey */
    const durRow = el("label", "slider");
    durRow.append(el("span", null, "Length"));
    const dur = document.createElement("input");
    dur.type = "range";
    dur.min = "0.2";
    dur.max = "30";
    dur.step = "0.1";
    dur.value = String(author.duration);
    dur.addEventListener("input", () => {
      author.setDuration(Number(dur.value));
      timeLbl.textContent = fmtTime(author.time) + " / " + fmtTime(author.duration);
      renderKeyframes();
    });
    durRow.append(dur);
    card.append(durRow);

    card.append(toggleRow("Loop", author.loop, (v) => author.setLoop(v)));
    card.append(toggleRow("Auto-key on pose", author.autoKey, (v) => author.setAutoKey(v)));

    const loopRow = el("div", "testRow");
    const closeBtn = el("button", "btn ghost grow", "Close loop");
    closeBtn.title = "Copy the first key to the end so the animation loops seamlessly";
    closeBtn.disabled = author.keyCount < 2;
    closeBtn.addEventListener("click", () => {
      if (author.closeLoop()) {
        toast("Loop closed", 1600);
        renderKeyframes();
      }
    });
    const clearBtn = el("button", "btn ghost", "Clear all");
    clearBtn.addEventListener("click", () => {
      if (!window.confirm("Delete every key?")) return;
      author.clear();
      renderKeyframes();
    });
    loopRow.append(closeBtn, clearBtn);
    card.append(loopRow);

    /* storage */
    const saveRow = el("div", "testRow");
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "rigSearch grow";
    nameInput.placeholder = "Animation name";
    nameInput.maxLength = 48;
    const saveBtn = el("button", "btn ghost", "Save");
    saveBtn.addEventListener("click", async () => {
      const nm = nameInput.value.trim() || "animation";
      if (!author.keyCount) {
        toast("Set a key first", 2200);
        return;
      }
      try {
        await author.save(nm);
        nameInput.value = "";
        toast("Animation saved", 2000);
        renderKeyframes();
      } catch (e) {
        toast("Save failed: " + (e && e.message ? e.message : e), 3000);
      }
    });
    saveRow.append(nameInput, saveBtn);
    card.append(saveRow);

    const savedWrap = el("div", "poseList");
    if (!author.saved.length) {
      savedWrap.append(el("div", "rigMuted", "No saved animations."));
    } else {
      for (const s of author.saved) {
        const r = el("div", "poseRow");
        r.append(el("span", "poseName", s.name));
        r.append(el("span", "poseMeta", `${s.keys} keys \u00b7 ${fmtTime(s.duration)}`));
        const loadBtn = el("button", "btn ghost", "Load");
        loadBtn.addEventListener("click", async () => {
          const ok = await author.load(s.name);
          if (ok) {
            if (render) render();
            toast("Loaded " + s.name, 1800);
          } else {
            toast("Different rig? Couldn't load", 2600);
          }
          renderKeyframes();
        });
        const delBtn2 = el("button", "btn ghost libDel", "\u00d7");
        delBtn2.addEventListener("click", async () => {
          if (!window.confirm(`Delete "${s.name}"?`)) return;
          await author.removeSaved(s.name);
          renderKeyframes();
        });
        r.append(loadBtn, delBtn2);
        savedWrap.append(r);
      }
    }
    card.append(savedWrap);
    if (!author.saved.length && !keySavedFetched) {
      keySavedFetched = true;
      author.refreshSaved().then(() => {
        if (open) renderKeyframes();
      });
    }

    const expBtn = el("button", "btn ghost", "Export animated GLB");
    expBtn.title = "Bake the keys into a real glTF animation and download the model + clip";
    expBtn.disabled = author.keyCount < 2;
    expBtn.addEventListener("click", async () => {
      try {
        expBtn.textContent = "Exporting\u2026";
        expBtn.disabled = true;
        const blob = await author.exportGlb();
        const a = document.createElement("a");
        const url = URL.createObjectURL(blob);
        a.href = url;
        a.download = "authored-animation.glb";
        document.body.appendChild(a);
        a.click();
        a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 8000);
        toast("Animated GLB exported", 2400);
      } catch (e) {
        toast("Export failed: " + (e && e.message ? e.message : e), 3200);
      } finally {
        expBtn.textContent = "Export animated GLB";
        expBtn.disabled = author.keyCount < 2;
      }
    });
    card.append(expBtn);

    keyframesHost.append(card);

    keyTickRef = () => {
      if (!author) return;
      playhead.style.left = (author.duration > 0 ? (author.time / author.duration) * 100 : 0) + "%";
      timeLbl.textContent = fmtTime(author.time) + " / " + fmtTime(author.duration);
    };
    updateKeyTick();
    function updateKeyTick() {
      if (keyTickRef) keyTickRef();
    }
  }

  async function renderPoseLib(listEl) {
    if (!listEl) return;
    listEl.innerHTML = "";
    if (!net.online) {
      listEl.append(el("div", "rigMuted", "Not connected."));
      return;
    }
    listEl.append(el("div", "rigMuted", "Loading\u2026"));
    let poses = [];
    try {
      poses = await net.listPoses();
    } catch (e) {
      listEl.innerHTML = "";
      listEl.append(el("div", "rigMuted", "Couldn't load poses."));
      return;
    }
    listEl.innerHTML = "";
    if (!poses.length) {
      listEl.append(el("div", "rigMuted", "No saved poses in this room yet."));
      return;
    }
    for (const p of poses) {
      const rowEl = el("div", "poseRow");
      rowEl.append(el("span", "poseName", p.name));
      rowEl.append(el("span", "poseMeta", `${p.author || "anon"} \u00b7 ${fmtDate(p.ts)}`));
      const loadBtn = el("button", "btn ghost", "Load");
      loadBtn.addEventListener("click", async () => {
        try {
          const q = await net.getPose(p.id);
          if (!q) { toast("Couldn't read that pose", 2400); return; }
          if (!rig) { toast("Load a rig first", 2400); return; }
          if (!q.quats || q.quats.length !== rig.boneCount * 4) {
            toast("That pose was made for a different rig", 3200);
            return;
          }
          rig.applyPose(q);
          if (render) render();
          toast("Pose loaded", 1800);
        } catch (e) {
          toast("Load failed", 2400);
        }
      });
      const delBtn = el("button", "btn ghost libDel", "\u00d7");
      delBtn.title = "Delete this pose";
      delBtn.addEventListener("click", async () => {
        if (!window.confirm(`Delete "${p.name}"?`)) return;
        try {
          await net.deletePose(p.id);
          renderPoseLib(listEl);
        } catch (e) {
          toast("Delete failed", 2400);
        }
      });
      rowEl.append(loadBtn, delBtn);
      listEl.append(rowEl);
    }
  }

  /* ---- network column ---- */

  function ensureNetInputs() {
    if (roomInput) return;
    roomInput = document.createElement("input");
    roomInput.type = "text";
    roomInput.className = "rigSearch grow";
    roomInput.placeholder = "room";
    roomInput.maxLength = 64;
    roomRowEl = el("div", "testRow");
    roomRowEl.append(el("span", "rigLabel", "Room"), roomInput);

    nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "rigSearch grow";
    nameInput.placeholder = "your name";
    nameInput.maxLength = 24;
    nameRowEl = el("div", "testRow");
    nameRowEl.append(el("span", "rigLabel", "Name"), nameInput);
  }

  function renderNetwork() {
    if (!netCol) return;
    ensureNetInputs();
    netCol.innerHTML = "";
    const card = section("Shared stage");
    card.append(el("div", "rigHint", "Everyone on the same rig meets in the same room automatically. Poses stream live and the room's last pose is remembered on the server."));

    if (net.room) roomInput.value = net.room;
    else if (!roomInput.value) roomInput.value = getRig() ? roomForRig(getRig()) : "lobby";
    if (net.name) nameInput.value = net.name;
    card.append(roomRowEl, nameRowEl);

    const joinRow = el("div", "testRow");
    if (net.online || net.wantsOnline) {
      const leaveBtn = el("button", "btn ghost grow", net.online ? "Leave room" : "Connecting\u2026");
      leaveBtn.addEventListener("click", leave);
      joinRow.append(leaveBtn);
    } else {
      const joinBtn = el("button", "btn primary grow", "Join room");
      joinBtn.addEventListener("click", () => join(roomInput.value, nameInput.value));
      joinRow.append(joinBtn);
    }
    const shareBtn = el("button", "btn ghost", "Share");
    shareBtn.title = "Copy a link that drops people straight into this room";
    shareBtn.addEventListener("click", shareLink);
    joinRow.append(shareBtn);
    card.append(joinRow);

    const st = el("div", "rigStatus " + (net.online ? "ok" : net.status === "error" ? "err" : ""));
    st.textContent = net.online
      ? `Connected \u00b7 slot ${net.slot} \u00b7 ${presence.length} here`
      : net.wantsOnline
        ? "Connecting\u2026 " + (net.detail || "")
        : net.detail || "Offline";
    card.append(st);

    card.append(toggleRow("Broadcast my pose", ui.broadcast, (v) => { ui.broadcast = v; }));
    card.append(toggleRow("Show other users", ui.showGhosts, (v) => { ui.showGhosts = v; updateGhostVisibility(); }) );
    card.append(toggleRow("Restore room pose on join", ui.restoreOnJoin, (v) => { ui.restoreOnJoin = v; }));
    netCol.append(card);

    const people = section("In the room");
    if (!presence.length) {
      people.append(el("div", "rigMuted", net.online ? "Nobody else yet \u2014 share the link." : "Join to see who's here."));
    } else {
      for (const u of presence) {
        const rowEl = el("div", "personRow" + (u.isSelf ? " self" : ""));
        const dot = el("span", "presenceDot");
        dot.style.background = slotColor(u.slot).css;
        rowEl.append(dot, el("span", "personName", u.name || "anon"));
        rowEl.append(el("span", "personMeta", u.sig ? "sig " + u.sig : "no rig"));
        if (u.isSelf) rowEl.append(el("span", "personYou", "you"));
        people.append(rowEl);
      }
    }
    netCol.append(people);
  }

  /* ------------------------------------------------------------- open/close */

  function openPanel() {
    if (!panel) build();
    open = true;
    panel.hidden = false;
    maybeAutoJoin();
    renderPanel();
    if (typeof onChange === "function") onChange(true);
  }

  function close() {
    open = false;
    if (panel) panel.hidden = true;
    if (typeof onChange === "function") onChange(false);
  }

  function toggle() {
    if (open) close();
    else openPanel();
  }

  /* ------------------------------------------------------------- viewport picking */

  let downX = 0;
  let downY = 0;
  if (renderer) {
    renderer.domElement.addEventListener("pointerdown", (e) => {
      downX = e.clientX;
      downY = e.clientY;
    });
    renderer.domElement.addEventListener("pointerup", (e) => {
      if (!open || !rig || !ui.showSkeleton) return;
      if (Math.abs(e.clientX - downX) > 4 || Math.abs(e.clientY - downY) > 4) return;
      const rect = renderer.domElement.getBoundingClientRect();
      const hit = rig.pickBone(e.clientX, e.clientY, camera, rect);
      if (hit >= 0) {
        if (render) render();
        if (panel && panel._renderList) panel._renderList();
        if (panel && panel._boneInfo) panel._boneInfo();
      }
    });
  }

  /* -------------------------------------------------- tiny per-frame updater */

  let lastAnimRefresh = 0;
  function update() {
    if (!open) return;
    const now = performance.now();
    if (now - lastAnimRefresh < 120) return;
    lastAnimRefresh = now;
    if (animTickRef && rig && rig.clipIndex >= 0) animTickRef();
    if (keyTickRef && author) keyTickRef();
    const chip = panel && panel.querySelector(".presenceChip");
    if (chip) chip.textContent = net.online ? `\u25cf live \u00b7 ${presence.length}` : "";
  }

  return {
    toggle,
    open: openPanel,
    close,
    onRig,
    update,
    refresh: renderPanel,
    refreshKeyframes: renderKeyframes,
    net,
    get isOpen() { return open; },
    get ghosts() { return ghosts; },
    join,
    leave,
    shareLink,
    get room() { return net.room; },
    get presence() { return presence.slice(); },
  };
}
