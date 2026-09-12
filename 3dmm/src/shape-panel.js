/*
 * shape-panel.js - the "Shape" overlay: Blender-style Shape Keys for the stage mesh.
 *
 * A thin controller over ./shape-keys.js (like volume-panel.js is over volume.js). Three
 * blocks:
 *   Auto shape       - one-click procedural morphs (Inflate … Muscle), ten of them.
 *   Rig shape keys   - automatic corrective keys derived from the current skeleton.
 *   Shape keys       - the live list, each with a weight slider, plus reset/clear/export.
 *
 * The shape list is rebuilt only when its *signature* changes, so dragging a weight
 * slider is not interrupted by the poll tick.
 */

import { AUTO_SHAPES } from "./shape-keys.js";

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function btn(label, cls, onClick, title) {
  const b = el("button", "btn " + (cls || "ghost"), label);
  if (title) b.title = title;
  b.addEventListener("click", onClick);
  return b;
}

export function createShapePanel({ app, toast } = {}) {
  let overlay = null;
  let wrapper = null;
  let open = false;
  let tick = 0;
  let keysCtn = null;
  let statEl = null;
  let rigStatEl = null;
  let lastSig = "";
  const chips = new Map();

  const say = (t, ms) => {
    if (typeof toast === "function") toast(t, ms);
  };
  const run = async (fn, label) => {
    try {
      if (label && app.setStatus) app.setStatus(label, true);
      await fn();
      refresh(true);
    } catch (e) {
      console.warn("shape action failed", e);
      say((e && e.message) || "That didn't work", 3000);
    } finally {
      if (app.clearStatus) app.clearStatus();
    }
  };

  /* ------------------------------------------------------------------- build */

  function section(title, hint) {
    const box = el("div", "volStep");
    const body = el("div", "volBody");
    body.append(el("div", "volTitle", title));
    if (hint) body.append(el("div", "volHint", hint));
    box.append(body);
    return { box, body };
  }

  function buildAuto() {
    const { box, body } = section(
      "Auto shape",
      "Real morph targets computed from the geometry \u2014 each one stores the per-vertex difference, exactly like a Blender Shape Key. Click to add it (and drive it), click again to zero it."
    );
    const grid = el("div", "shapeGrid");
    for (const s of AUTO_SHAPES) {
      const b = el("button", "shapeChip");
      b.textContent = s.label;
      b.title = s.hint;
      b.dataset.shape = s.id;
      b.addEventListener("click", () => run(() => toggleShape(s), null));
      chips.set(s.id, b);
      grid.append(b);
    }
    body.append(grid);
    const row = el("div", "testRow");
    row.append(
      btn("Generate all", "ghost", () => run(() => app.autoShape("all"), "Building shapes\u2026")),
      btn("Reset weights", "ghost", () => run(() => app.resetShapes(), null)),
      btn("Clear all", "ghost", () => run(() => app.clearShapes(), null)),
    );
    body.append(row);
    return box;
  }

  function buildRig() {
    const { box, body } = section(
      "Rig shape keys",
      "Automatic corrective shape keys from the skeleton: for every important joint the mesh region around that bone is bent (Flex) and bulged (Bulge), using the bone's own position and direction. Forge or import a rig first."
    );
    const row = el("div", "testRow");
    row.append(btn("\uD83D\uDD27 Generate from rig", "ghost pri", () => run(() => app.autoShapeKeys(), "Keying the rig\u2026")));
    if (app.autoArmature) {
      const aaRow = el("div", "testRow");
      aaRow.append(btn("Auto-armature (forge a rig)", "ghost", () => run(() => app.autoArmature(), "Forging armature...")));
      body.append(aaRow);
    }
    body.append(row);
    rigStatEl = el("div", "volSub");
    body.append(rigStatEl);
    return box;
  }

  function buildKeys() {
    const { box, body } = section("Shape keys", "Drag a weight to blend the morph live. \u00d7 removes the key.");
    keysCtn = el("div", "shapeKeys");
    body.append(keysCtn);
    const row = el("div", "testRow");
    row.append(btn("Export GLB (with shapes)", "ghost pri", () => run(() => app.exportGlb && app.exportGlb(), "Exporting\u2026")));
    body.append(row);
    return box;
  }

  function build() {
    overlay = el("div", "testsOverlay shapeOverlay");
    overlay.hidden = true;
    overlay.setAttribute("role", "dialog");
    overlay.setAttribute("aria-label", "Shape keys");
    const sheet = el("div", "testsSheet");
    const head = el("div", "testsHead");
    head.append(el("span", "testsTitle", "Shape \u2014 automatic Shape Keys (morph targets)"));
    statEl = el("span", "shapeStat");
    head.append(el("div", "testsSpacer"), statEl);
    const closeBtn = el("button", "btn ghost testsClose", "\u00d7");
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", close);
    head.append(closeBtn);
    wrapper = el("div", "volWrap");
    wrapper.append(buildAuto(), buildRig(), buildKeys());
    sheet.append(head, wrapper);
    overlay.append(sheet);
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) close();
    });
    (document.getElementById("app") || document.body).append(overlay);
    return overlay;
  }

  /* ------------------------------------------------------------------ logic */

  function toggleShape(spec) {
    const exists = app.listShapes().some((k) => k.name === app.shapeName(spec));
    if (exists) {
      const cur = app.getWeight(app.shapeName(spec));
      app.setWeight(app.shapeName(spec), cur > 0.02 ? 0 : 0.6);
    } else {
      app.autoShape([spec.id]);
      app.setWeight(app.shapeName(spec), 0.6);
    }
  }

  function rowFor(key) {
    const row = el("div", "shapeKeyRow");
    const name = el("div", "shapeKeyName", key.name);
    name.title = key.name + (key.own ? "" : " (imported)");
    if (!key.own) name.classList.add("imported");
    const range = document.createElement("input");
    range.type = "range";
    range.min = "0";
    range.max = "1";
    range.step = "0.01";
    range.value = String(key.value || 0);
    range.className = "shapeRange";
    range.addEventListener("input", () => {
      app.setWeight(key.name, Number(range.value));
      val.textContent = Number(range.value).toFixed(2);
    });
    const val = el("div", "shapeVal", (key.value || 0).toFixed(2));
    const del = el("button", "shapeDel", "\u00d7");
    del.title = "Remove this shape key";
    del.addEventListener("click", () => run(() => app.removeShape(key.name), null));
    row.append(name, range, val, del);
    return row;
  }

  function renderKeys(keys) {
    keysCtn.innerHTML = "";
    if (!keys.length) {
      keysCtn.append(el("div", "volHint", "No shape keys yet \u2014 use Auto shape or Generate from rig."));
      return;
    }
    for (const k of keys) keysCtn.append(rowFor(k));
  }

  function refresh(force) {
    if (!open || !keysCtn) return;
    const info = app.info ? app.info() : {};
    const keys = app.listShapes ? app.listShapes() : [];
    if (statEl) statEl.textContent = info.hasMesh ? info.meshes + " mesh \u00b7 " + info.vertices.toLocaleString() + " v \u00b7 " + keys.length + " key" + (keys.length === 1 ? "" : "s") : "no model";
    if (rigStatEl) rigStatEl.textContent = app.hasRig && app.hasRig() ? "Skeleton detected \u2014 ready to key." : "No skeleton on the stage.";
    const sig = keys.map((k) => k.name + (k.own ? "1" : "0")).join("|");
    if (force || sig !== lastSig) {
      lastSig = sig;
      renderKeys(keys);
    } else {
      const rows = keysCtn.querySelectorAll(".shapeKeyRow");
      keys.forEach((k, i) => {
        const r = rows[i];
        if (!r) return;
        const range = r.querySelector(".shapeRange");
        const val = r.querySelector(".shapeVal");
        if (document.activeElement === range) return;
        if (range) range.value = String(k.value || 0);
        if (val) val.textContent = (k.value || 0).toFixed(2);
      });
    }
    const own = new Set(keys.filter((k) => k.own).map((k) => k.name));
    for (const [id, chip] of chips) {
      const name = app.shapeName(AUTO_SHAPES.find((s) => s.id === id));
      const on = own.has(name) && app.getWeight && app.getWeight(name) > 0.02;
      const present = own.has(name);
      chip.classList.toggle("on", !!on);
      chip.classList.toggle("added", !!present);
    }
  }

  function openPanel() {
    if (!overlay) build();
    overlay.hidden = false;
    open = true;
    refresh(true);
    clearInterval(tick);
    tick = setInterval(() => {
      if (open) refresh(false);
    }, 1000);
  }

  function close() {
    open = false;
    if (overlay) overlay.hidden = true;
    clearInterval(tick);
  }

  function toggle() {
    if (open) close();
    else openPanel();
  }

  return {
    open: openPanel,
    close,
    toggle,
    refresh,
    get isOpen() {
      return open;
    },
  };
}
