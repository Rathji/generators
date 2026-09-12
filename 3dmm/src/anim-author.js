/*
 * anim-author.js — keyframe animation authoring for a rigged model.
 *
 * The clips a file ships with can only be played; this module lets you *make*
 * one. Pose the rig however you like (the Studio gizmo, a shared pose, a motion
 * preset — anything that moves the bones), drop a keyframe at the current time,
 * pose it again, drop another. The author then interpolates between the keys
 * (per-bone slerp for rotation, lerp for translation) and plays it back, so a
 * handful of poses becomes a smooth, accurate animation — including motion no
 * stock clip would ever contain.
 *
 * Keys are stored as `{ t, quats, deltas }`, the exact shape armature.js uses
 * for poses, so a key IS a pose and everything that can produce a pose can fill
 * a key. Authoring is per-device: saved animations live in `kv.animations`.
 *
 * The authored clip can be exported: `exportGlb()` bakes the keys into a real
 * three `AnimationClip` (QuaternionKeyframeTrack / VectorKeyframeTrack per bone)
 * and writes the model + that clip to a GLB, so your animation survives the trip
 * into Blender or any glTF viewer.
 */

import * as T3 from "./three.js";
import { toGLB, slug } from "./exporters.js";

const THREE = T3.THREE;

const EPS = 1e-4;

function invLerp(a, b, v) {
  if (b <= a) return 0;
  return Math.max(0, Math.min(1, (v - a) / (b - a)));
}

function cloneKey(k) {
  return { t: k.t, quats: k.quats.slice(), deltas: k.deltas.slice() };
}

/* Bone quaternions can arrive slightly non-unit (a scaled matrixWorld run through
   setFromRotationMatrix, a hand-built pose) and a non-unit quaternion whose dot
   product exceeds 1 makes three's slerp a silent no-op. Normalise on the way in. */
function normaliseQuats(src) {
  const out = new Float32Array(src.length);
  for (let i = 0; i < src.length; i += 4) {
    const x = src[i];
    const y = src[i + 1];
    const z = src[i + 2];
    const w = src[i + 3];
    const len = Math.hypot(x, y, z, w) || 1;
    out[i] = x / len;
    out[i + 1] = y / len;
    out[i + 2] = z / len;
    out[i + 3] = w / len;
  }
  return out;
}

export function createAuthor({ getRig, getKv, getModel, onApply } = {}) {
  let keys = []; // sorted by t
  let duration = 3;
  let playing = false;
  let time = 0;
  let loop = true;
  let speed = 1;
  let autoKey = false;
  let savedList = [];
  let lastApplied = null;
  let lastAppliedDeltas = null;

  const kv = () => (typeof getKv === "function" ? getKv() : null);

  function sortKeys() {
    keys.sort((a, b) => a.t - b.t);
  }

  function ensureDuration() {
    if (!keys.length) return;
    const last = keys[keys.length - 1].t;
    if (duration < last + EPS) duration = Math.ceil((last + 0.001) * 10) / 10;
  }

  /* ---- authoring ---------------------------------------------------------- */

  /* Capture the current rig pose as a key at `t` (default: the playhead). */
  function captureKey(t = time) {
    const rig = getRig && getRig();
    if (!rig || !rig.capturePose) return null;
    const pose = rig.capturePose();
    const k = { t: Math.max(0, Number(t) || 0), quats: normaliseQuats(pose.quats), deltas: pose.deltas };
    const near = keys.findIndex((x) => Math.abs(x.t - k.t) < 0.02);
    if (near >= 0) keys[near] = k;
    else keys.push(k);
    sortKeys();
    ensureDuration();
    return k;
  }

  function removeKey(index) {
    if (index < 0 || index >= keys.length) return false;
    keys.splice(index, 1);
    return true;
  }

  function removeKeyNear(t, tol = 0.03) {
    const i = keys.findIndex((k) => Math.abs(k.t - t) <= tol);
    return i >= 0 ? removeKey(i) : false;
  }

  function clear() {
    keys = [];
    playing = false;
    time = 0;
  }

  /* Copy the first key to `duration`, so a loop closes seamlessly. */
  function closeLoop() {
    if (keys.length < 2) return false;
    const first = cloneKey(keys[0]);
    first.t = duration;
    const i = keys.findIndex((k) => Math.abs(k.t - duration) < 0.02);
    if (i >= 0) keys[i] = first;
    else keys.push(first);
    sortKeys();
    return true;
  }

  /* ---- sampling ----------------------------------------------------------- */

  function sample(t) {
    if (!keys.length) return null;
    if (keys.length === 1 || t <= keys[0].t) return { quats: keys[0].quats, deltas: keys[0].deltas };
    const last = keys[keys.length - 1];
    if (t >= last.t) return { quats: last.quats, deltas: last.deltas };
    let a = keys[0];
    let b = keys[1];
    for (let i = 1; i < keys.length; i++) {
      if (keys[i].t >= t) {
        a = keys[i - 1];
        b = keys[i];
        break;
      }
    }
    const u = invLerp(a.t, b.t, t);
    const n = a.quats.length / 4;
    const quats = new Float32Array(n * 4);
    const deltas = new Float32Array(n * 3);
    const qa = new THREE.Quaternion();
    const qb = new THREE.Quaternion();
    const qr = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      qa.fromArray(a.quats, i * 4).normalize();
      qb.fromArray(b.quats, i * 4).normalize();
      qr.copy(qa).slerp(qb, u);
      qr.toArray(quats, i * 4);
      const da = a.deltas && a.deltas.length >= n * 3 ? a.deltas : null;
      const db = b.deltas && b.deltas.length >= n * 3 ? b.deltas : null;
      for (let c = 0; c < 3; c++) {
        const va = da ? da[i * 3 + c] : 0;
        const vb = db ? db[i * 3 + c] : 0;
        deltas[i * 3 + c] = va + (vb - va) * u;
      }
    }
    return { quats, deltas };
  }

  function applyAt(t) {
    const rig = getRig && getRig();
    if (!rig || !rig.applyPose) return false;
    const pose = sample(t);
    if (!pose) return false;
    const ok = rig.applyPose(pose);
    lastApplied = pose.quats.slice();
    lastAppliedDeltas = pose.deltas ? pose.deltas.slice() : null;
    if (typeof onApply === "function") onApply(pose, t);
    return ok;
  }

  /* Auto-key: if the user moved bones by hand since the last applied pose, drop a
     key at the playhead. Called once per frame from the app loop while autoKey is on. */
  function captureIfChanged() {
    if (!autoKey) return false;
    const rig = getRig && getRig();
    if (!rig || !rig.capturePose) return false;
    const pose = rig.capturePose();
    if (lastApplied && lastApplied.length === pose.quats.length) {
      let same = true;
      for (let i = 0; i < pose.quats.length; i++) {
        if (Math.abs(pose.quats[i] - lastApplied[i]) > 1e-4) {
          same = false;
          break;
        }
      }
      if (same && lastAppliedDeltas && lastAppliedDeltas.length === pose.deltas.length) {
        for (let i = 0; i < pose.deltas.length; i++) {
          if (Math.abs(pose.deltas[i] - lastAppliedDeltas[i]) > 1e-4) {
            same = false;
            break;
          }
        }
      }
      if (same) return false;
    }
    captureKey(time);
    lastApplied = pose.quats.slice();
    lastAppliedDeltas = pose.deltas.slice();
    return true;
  }

  /* ---- transport ---------------------------------------------------------- */

  function setTime(t, { apply = true } = {}) {
    time = Math.max(0, Math.min(duration, Number(t) || 0));
    if (apply) applyAt(time);
    return time;
  }

  function play() {
    if (!keys.length) return false;
    playing = true;
    if (time >= duration - EPS) time = 0;
    return true;
  }

  function pause() {
    playing = false;
  }

  function stop() {
    playing = false;
    setTime(0);
    const rig = getRig && getRig();
    if (rig && rig.resetPose) {
      rig.resetPose();
      if (rig.updateSkeleton) rig.updateSkeleton();
    }
  }

  function toggle() {
    if (playing) pause();
    else play();
  }

  function setLoop(on) {
    loop = !!on;
  }

  function setSpeed(v) {
    speed = Math.max(0.05, Math.min(4, Number(v) || 1));
  }

  function setDuration(d) {
    duration = Math.max(0.1, Math.min(120, Number(d) || 1));
    if (time > duration) setTime(duration);
    return duration;
  }

  function setAutoKey(on) {
    autoKey = !!on;
  }

  /* Called by the UI when the user moves bones by hand, so the pose becomes a key. */
  function notePoseChanged() {
    if (!autoKey) return false;
    captureKey(time);
    return true;
  }

  function update(dt) {
    if (!playing || !keys.length) return;
    time += dt * speed;
    if (time >= duration) {
      if (loop) time = time % duration;
      else {
        time = duration;
        playing = false;
      }
    }
    applyAt(time);
  }

  /* ---- persistence -------------------------------------------------------- */

  function serialise() {
    return {
      duration,
      keys: keys.map((k) => ({
        t: +k.t.toFixed(4),
        quats: Array.from(k.quats, (v) => +v.toFixed(5)),
        deltas: Array.from(k.deltas, (v) => +v.toFixed(5)),
      })),
    };
  }

  function deserialise(rec) {
    if (!rec || !Array.isArray(rec.keys)) return false;
    const out = [];
    for (const k of rec.keys) {
      if (!k || !Array.isArray(k.quats)) continue;
      out.push({
        t: Number(k.t) || 0,
        quats: Float32Array.from(k.quats),
        deltas: Float32Array.from(k.deltas || []),
      });
    }
    if (!out.length) return false;
    keys = out;
    sortKeys();
    duration = Math.max(0.1, Number(rec.duration) || duration);
    time = 0;
    return true;
  }

  async function refreshSaved() {
    const f = kv() && kv().animations;
    if (!f) return savedList;
    try {
      const entries = await f.entries();
      savedList = entries
        .map(([name, rec]) => ({ name, keys: (rec && rec.keys && rec.keys.length) || 0, duration: (rec && rec.duration) || 0, ts: (rec && rec.ts) || 0 }))
        .sort((a, b) => (b.ts || 0) - (a.ts || 0));
    } catch (e) {
      console.warn("[author] list failed", e);
      savedList = [];
    }
    return savedList;
  }

  async function save(name) {
    const folder = kv() && kv().animations;
    if (!folder) throw new Error("storage unavailable");
    const nm = slug(name).slice(0, 48) || "animation";
    if (!keys.length) throw new Error("no keyframes");
    await folder.set(nm, { ...serialise(), ts: Date.now() });
    await refreshSaved();
    return nm;
  }

  async function load(name) {
    const folder = kv() && kv().animations;
    if (!folder) return false;
    const rec = await folder.get(name);
    return deserialise(rec);
  }

  async function removeSaved(name) {
    const folder = kv() && kv().animations;
    if (!folder) return false;
    await folder.delete(name);
    await refreshSaved();
    return true;
  }

  /* ---- export ------------------------------------------------------------- */

  function buildClip(name = "Authored") {
    const rig = getRig && getRig();
    if (!rig || !keys.length) throw new Error("no rig / no keys");
    const bones = rig.bones;
    const n = rig.boneCount;
    const times = keys.map((k) => k.t);

    // Absolute bind positions, so translation tracks are correct.
    const bindPos = new Array(n);
    rig.resetPose();
    for (let i = 0; i < n; i++) bindPos[i] = bones[i].position.clone();

    const tracks = [];
    const used = new Set();
    for (let i = 0; i < n; i++) {
      const b = bones[i];
      const nm = b.name || "bone" + i;
      if (used.has(nm)) continue; // duplicate names would collide in the binding
      used.add(nm);
      const qvals = new Float32Array(times.length * 4);
      const pvals = new Float32Array(times.length * 3);
      keys.forEach((k, ki) => {
        qvals.set(k.quats.subarray(i * 4, i * 4 + 4), ki * 4);
        const dx = k.deltas && k.deltas.length >= n * 3 ? k.deltas[i * 3] : 0;
        const dy = k.deltas && k.deltas.length >= n * 3 ? k.deltas[i * 3 + 1] : 0;
        const dz = k.deltas && k.deltas.length >= n * 3 ? k.deltas[i * 3 + 2] : 0;
        pvals[ki * 3] = bindPos[i].x + dx;
        pvals[ki * 3 + 1] = bindPos[i].y + dy;
        pvals[ki * 3 + 2] = bindPos[i].z + dz;
      });
      tracks.push(new THREE.QuaternionKeyframeTrack(`${nm}.quaternion`, times, qvals));
      tracks.push(new THREE.VectorKeyframeTrack(`${nm}.position`, times, pvals));
    }
    const clip = new THREE.AnimationClip(name || "Authored", duration, tracks);
    return { clip, bindPos };
  }

  /* Export the model with the authored clip baked in. Returns a Blob. */
  async function exportGlb() {
    const model = getModel && getModel();
    if (!model) throw new Error("no model");
    const { clip } = buildClip("Authored");
    // Restore the current authored pose before the exporter walks the graph.
    applyAt(time);
    return toGLB(model, { animations: [clip] });
  }

  return {
    captureKey,
    removeKey,
    removeKeyNear,
    clear,
    closeLoop,
    sample,
    applyAt,
    setTime,
    play,
    pause,
    stop,
    toggle,
    setLoop,
    setSpeed,
    setDuration,
    setAutoKey,
    notePoseChanged,
    captureIfChanged,
    update,
    refreshSaved,
    save,
    load,
    removeSaved,
    buildClip,
    exportGlb,
    get keys() {
      return keys.map((k) => k.t);
    },
    get keyCount() {
      return keys.length;
    },
    get duration() {
      return duration;
    },
    get time() {
      return time;
    },
    get playing() {
      return playing;
    },
    get loop() {
      return loop;
    },
    get autoKey() {
      return autoKey;
    },
    get saved() {
      return savedList.slice();
    },
  };
}
