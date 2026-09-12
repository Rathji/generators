/*
 * partner.js — a second, independent body on the stage.
 *
 * The app is built around ONE rig (the model in `modelGroup`). This module adds a
 * duplicate of that model with its own skeleton, its own overlay and its own
 * procedural motion layer, so two characters can share a scene. The duplicate is a
 * real deep clone (three's SkeletonUtils.clone), so posing its bones cannot touch
 * the original — which is exactly what a paired animation needs.
 *
 * Seating: a partner is placed by MATCHING HIPS. The main rig's hip bone world
 * position is read (after the main motion has been applied), a small offset is
 * added, and the partner's group is translated so its own hip lands there. That
 * makes placement independent of how a file was scaled/centred, and makes the two
 * bodies meet at the pelvis rather than at their bounding-box centres.
 *
 * Frame-lock: a paired preset has a `step` for the bottom and a `partner.step` for
 * the top. The Partner layer does not free-run — every frame it copies the main
 * motion layer's phase (`setPhase`), so the two motions are locked by construction
 * and cannot drift, whatever the frame rate. See motion.js (Partner category).
 */

import * as T3 from "./three.js";
import { createRig } from "./armature.js";
import { createMotionLayer } from "./motion.js";

const THREE = T3.THREE;

const DEFAULT_PLACE = { pos: [0, 0.02, 0.5], face: -1 };

export function createPartner({ scene, getModel, getRig, getMainLayer, getSize, render, toast } = {}) {
  let group = null;
  let overlay = null;
  let model = null;
  let rig = null;
  let layer = null;
  let active = false;
  let preset = null;
  let place = DEFAULT_PLACE;

  const say = (msg, ms) => {
    if (toast) toast(msg, ms || 2600);
  };

  /* --------------------------------------------------------------- geometry */

  /* World position of a rig's hip bone. Reads the semantic `parts.hips` the motion
     layer built, so it works on any humanoid regardless of bone naming. */
  function hipsWorld(r, lay) {
    const parts = lay && lay.parts;
    const bones = r && r.bones;
    if (!parts || !bones) return null;
    const idx = parts.hips;
    if (idx == null || idx < 0) return null;
    const b = bones[idx];
    if (!b) return null;
    b.updateWorldMatrix(true, false);
    return new THREE.Vector3().setFromMatrixPosition(b.matrixWorld);
  }

  function modelCenter() {
    const src = getModel && getModel();
    if (!src) return new THREE.Vector3();
    src.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(src);
    if (box.isEmpty()) return new THREE.Vector3();
    return box.getCenter(new THREE.Vector3());
  }

  function modelSize() {
    try {
      const s = getSize && getSize();
      if (s && isFinite(s) && s > 0) return s;
    } catch (e) {
      /* ignore */
    }
    return 2;
  }

  /* ------------------------------------------------------------------- build */

  function duplicate(src) {
    remove();
    const root = src || (getModel && getModel());
    if (!root) {
      say("Load a model first");
      return false;
    }
    let clone;
    try {
      clone = T3.cloneSkeleton(root);
    } catch (e) {
      console.warn("partner: clone failed", e);
      say("Couldn't duplicate this model", 3200);
      return false;
    }

    model = clone;
    group = new THREE.Group();
    group.name = "partner-model";
    group.add(clone);
    scene.add(group);

    overlay = new THREE.Group();
    overlay.name = "partner-overlay";
    scene.add(overlay);

    rig = createRig({ root: group, overlay, size: modelSize() });
    if (!rig) {
      remove();
      say("That model has no skeleton to duplicate", 3200);
      return false;
    }
    rig.setVisible(false); // only the main rig's overlay is drawn by default
    layer = createMotionLayer({ getRig: () => rig });
    layer.setRig(rig);
    active = true;
    seat(place);
    if (render) render();
    return true;
  }

  /* Seat the partner by aligning its hips to a target derived from the main rig.
     `p = { pos:[x,y,z] (fraction of model size), face: 1|-1, turn: radians }`. */
  function seat(p) {
    if (!active || !group) return false;
    place = p || place || DEFAULT_PLACE;
    const size = modelSize();
    const off = place.pos || [0, 0, 0];
    const anchor = hipsWorld(getRig && getRig(), getMainLayer && getMainLayer()) || modelCenter();
    const target = anchor.clone().add(new THREE.Vector3(off[0] * size, off[1] * size, off[2] * size));

    const yaw = (place.face === 1 ? 0 : Math.PI) + (place.turn || 0);
    group.rotation.set(0, yaw, 0);
    group.updateMatrixWorld(true);

    const ph = hipsWorld(rig, layer);
    if (ph) group.position.add(target.sub(ph));
    else group.position.copy(target);
    group.updateMatrixWorld(true);
    if (rig) rig.updateSkeleton();
    if (render) render();
    return true;
  }

  function remove() {
    if (layer) {
      try {
        layer.stop();
      } catch (e) {
        /* ignore */
      }
      layer = null;
    }
    if (rig) {
      try {
        rig.dispose();
      } catch (e) {
        /* ignore */
      }
      rig = null;
    }
    if (group && group.parent) group.parent.remove(group);
    if (overlay && overlay.parent) overlay.parent.remove(overlay);
    group = null;
    overlay = null;
    model = null;
    active = false;
    preset = null;
    if (render) render();
  }

  /* ------------------------------------------------------------------- drive */

  function playPair(m) {
    if (!m || !m.partner) return false;
    if (!active && !duplicate()) return false;
    // 1) pose the bottom at phase 0 so the hips we aim at are the real posed hips
    const main = getMainLayer && getMainLayer();
    if (main) main.play(m.id);
    // 2) seat the top on those hips
    seat(m.partner.place || DEFAULT_PLACE);
    // 3) run the top's motion, frame-locked to the bottom
    if (!layer) return false;
    layer.playMotion({
      id: m.id + ":partner",
      duration: m.duration,
      loop: m.loop !== false,
      step: m.partner.step,
    });
    preset = m;
    if (render) render();
    return true;
  }

  function stopMotion() {
    if (layer) {
      layer.stop();
      if (render) render();
    }
  }

  function update(dt) {
    if (!active || !layer) return;
    const main = getMainLayer && getMainLayer();
    if (preset && main && main.motion) {
      // copy the leader's clock, not a free-running one -> exact frame-lock
      layer.setSpeed(main.speed);
      layer.setLoop(main.loop);
      layer.setPlaying(main.playing);
      layer.setPhase(main.phase);
    } else {
      layer.update(dt);
    }
  }

  /* ------------------------------------------------------------------ nudge */

  function translate(dx, dy, dz) {
    if (!group) return false;
    group.position.x += dx || 0;
    group.position.y += dy || 0;
    group.position.z += dz || 0;
    group.updateMatrixWorld(true);
    if (rig) rig.updateSkeleton();
    if (render) render();
    return true;
  }

  function setYaw(y) {
    if (!group) return false;
    group.rotation.set(0, Number(y) || 0, 0);
    group.updateMatrixWorld(true);
    if (rig) rig.updateSkeleton();
    if (render) render();
    return true;
  }

  function setVisible(on) {
    if (group) group.visible = !!on;
    if (rig) rig.setVisible(!!on && false);
    if (render) render();
  }

  /* Re-run seating from the current main pose — a one-click "snap back into contact". */
  function matchHips() {
    return seat(place);
  }

  function state() {
    return {
      active,
      rigged: !!(rig && rig.boneCount),
      bones: rig ? rig.boneCount : 0,
      preset: preset ? preset.id : null,
      pos: group ? [group.position.x, group.position.y, group.position.z] : null,
      yaw: group ? group.rotation.y : 0,
    };
  }

  return {
    duplicate,
    remove,
    seat,
    matchHips,
    playPair,
    stopMotion,
    translate,
    setYaw,
    setVisible,
    update,
    state,
    get active() {
      return active;
    },
    get rig() {
      return rig;
    },
    get layer() {
      return layer;
    },
    get model() {
      return model;
    },
    get group() {
      return group;
    },
    get preset() {
      return preset;
    },
  };
}
