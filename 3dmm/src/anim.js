/*
 * Animator — clip playback for models that have animation but no skeleton.
 *
 * armature.js already drives the mixer for a *rigged* model (and its skeleton overlay).
 * But plenty of animated glTF/FBX files carry only node-transform or morph-target tracks:
 * no bones, so `createRig` returns null and those clips had nowhere to live. This module
 * plays them, exposing the same clip surface the rig does (`clips`, `playClip`,
 * `setClipTime`, `setPlaying`, `setSpeed`, `update`, …) so the Studio and the app can treat
 * both interchangeably.
 *
 * When a rig *is* present this controller defers to it entirely, so a clip is never driven
 * by two mixers at once.
 */
import * as T3 from "./three.js";

const THREE = T3.THREE;

/* Every node can own its own `.animations`; flatten and de-dupe by clip identity. */
export function collectClips(root) {
  const seen = new Set();
  const out = [];
  root.traverse((o) => {
    const list = o.animations;
    if (!list || !list.length) return;
    for (const clip of list) {
      if (!clip || seen.has(clip)) continue;
      seen.add(clip);
      out.push({ clip, owner: o });
    }
  });
  return out;
}

export function describeClip(clip, i) {
  let morphTracks = 0;
  for (const t of clip.tracks) {
    if (/morphTargetInfluences/.test(t.name)) morphTracks++;
  }
  return {
    index: i,
    name: clip.name || "Clip " + (i + 1),
    duration: clip.duration,
    tracks: clip.tracks.length,
    morphTracks,
    transformTracks: clip.tracks.length - morphTracks,
  };
}

export function createAnimator({ root, getRig }) {
  let entries = collectClips(root);
  let mixer = null;
  let action = null;
  let clipIndex = -1;
  let loop = true;
  let speed = 1;

  const isDelegated = () => !!(getRig && getRig());

  function ensureMixer() {
    if (!mixer) mixer = new THREE.AnimationMixer(root);
    return mixer;
  }

  function playClip(i, opts = {}) {
    if (isDelegated()) {
      const r = getRig();
      return r ? r.playClip(i, opts) : false;
    }
    if (!entries.length) return false;
    i = Math.max(0, Math.min(entries.length - 1, i | 0));
    if (opts.loop != null) loop = !!opts.loop;
    if (opts.speed != null) speed = opts.speed;
    const prev = action;
    action = ensureMixer().clipAction(entries[i].clip);
    if (prev && prev !== action) prev.stop();
    action.reset();
    action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    action.clampWhenFinished = !loop;
    action.timeScale = speed;
    action.play();
    clipIndex = i;
    return true;
  }

  function stopClip() {
    if (isDelegated()) {
      const r = getRig();
      if (r) r.stopClip();
      return;
    }
    if (action) action.stop();
    action = null;
    clipIndex = -1;
    resetMorphs();
  }

  function setClipTime(t) {
    if (isDelegated()) {
      const r = getRig();
      if (r) r.setClipTime(t);
      return;
    }
    if (!action) return;
    const d = action.getClip().duration;
    action.time = Math.max(0, Math.min(d, t));
    ensureMixer().update(0);
    root.updateMatrixWorld(true);
  }

  function setSpeed(v) {
    speed = v;
    if (isDelegated()) {
      const r = getRig();
      if (r) r.setSpeed(v);
      return;
    }
    if (action) action.timeScale = v;
  }

  function setPlaying(on) {
    if (isDelegated()) {
      const r = getRig();
      if (r) r.setPlaying(on);
      return;
    }
    if (action) action.paused = !on;
  }

  function setLoop(on) {
    loop = !!on;
    if (action) action.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
  }

  function update(dt) {
    if (isDelegated()) return; // the rig's mixer is advanced by the app loop
    if (mixer) mixer.update(dt);
  }

  /* Re-read the tree after the model changed. Returns the new clip list. */
  function refresh() {
    entries = collectClips(root);
    mixer = null;
    action = null;
    clipIndex = -1;
    return clipList();
  }

  /* ---- morph-target helpers ------------------------------------------------ */

  function morphMeshes() {
    const out = [];
    root.traverse((o) => {
      if (o.isMesh && o.morphTargetDictionary && Object.keys(o.morphTargetDictionary).length) out.push(o);
    });
    return out;
  }

  function morphTargets() {
    const list = [];
    for (const m of morphMeshes()) {
      for (const name of Object.keys(m.morphTargetDictionary)) {
        const idx = m.morphTargetDictionary[name];
        list.push({
          mesh: m.name || "mesh",
          name,
          index: idx,
          value: m.morphTargetInfluences ? m.morphTargetInfluences[idx] : 0,
        });
      }
    }
    return list;
  }

  function setMorph(meshName, nameOrIndex, value) {
    for (const m of morphMeshes()) {
      if (meshName && (m.name || "mesh") !== meshName) continue;
      const idx = typeof nameOrIndex === "number" ? nameOrIndex : m.morphTargetDictionary[nameOrIndex];
      if (idx == null || !m.morphTargetInfluences) continue;
      m.morphTargetInfluences[idx] = value;
      if (m.morphTargetInfluences.length) m.frustumCulled = false;
    }
  }

  function resetMorphs() {
    for (const m of morphMeshes()) {
      if (!m.morphTargetInfluences) continue;
      for (let i = 0; i < m.morphTargetInfluences.length; i++) m.morphTargetInfluences[i] = 0;
    }
  }

  function clipList() {
    return entries.map((e, i) => describeClip(e.clip, i));
  }

  return {
    get mode() {
      return isDelegated() ? "rig" : entries.length ? "mixer" : "none";
    },
    get clips() {
      return clipList();
    },
    get clipIndex() {
      return clipIndex;
    },
    get playing() {
      return !!action && !action.paused;
    },
    get time() {
      return action ? action.time : 0;
    },
    get duration() {
      if (isDelegated()) {
        const r = getRig();
        return r ? r.duration : 0;
      }
      return action ? action.getClip().duration : entries[0] ? entries[0].clip.duration : 0;
    },
    get loop() {
      return loop;
    },
    playClip,
    stopClip,
    setClipTime,
    setSpeed,
    setPlaying,
    setLoop,
    update,
    refresh,
    morphMeshes,
    morphTargets,
    setMorph,
    resetMorphs,
    dispose() {
      if (mixer) mixer.stopAllAction();
      mixer = null;
      action = null;
    },
  };
}
