/*
 * Muscle rig — an anatomical muscle layer built on top of the Auto-armature.
 *
 * The base Auto-armature gives an unrigged mesh a humanoid skeleton that Motion, the Shape
 * keys and the exporter all understand. A *muscle rig* adds a second layer to that same
 * skeleton: one bone per muscle belly, placed on the fitted joints (so it tracks whatever
 * proportions the fitter chose), bound into the same skin, and driven automatically.
 *
 * Each belly swells — scaling across its own axis, not along it — in proportion to how far
 * the joint it crosses is flexed. Pose the elbow and the biceps / triceps / brachialis fill
 * out; hinge the knee and the hamstring / calf fire; rotate a hip and the glutes / quads
 * engage; bend the spine and the abs / obliques contract. Nothing is keyframed: the flex is
 * read straight off the live bone rotations every frame, so it also responds to imported
 * clips, authored keys and the procedural Motion presets.
 *
 *   MUSCLE_DEFS            the anatomical table (belly, anchors, drivers, gains)
 *   muscleSpec(baseSpec,…) the humanoid spec + a muscle bone per belly
 *   createMuscleRig({…})   forge → add muscles → bind → auto-flex, as one object
 *
 * Rendering the mesh is cheap: the muscles are ordinary bones in the skeleton, so the only
 * runtime cost is one quaternion angle per driver per frame.
 */

import { THREE } from "./three.js";

const { Vector3 } = THREE;

const vec = (x, y, z) => new Vector3(x, y, z);

function lerp3(a, b, t) {
  return new Vector3(
    a.x + (b.x - a.x) * t,
    a.y + (b.y - a.y) * t,
    a.z + (b.z - a.z) * t,
  );
}

/*
 * The anatomical table. Every entry is expressed as a span between two of the fitted
 * skeleton's own joints (`a` → `b`, parameterised by t0..t1) plus a small offset `off`
 * in model-height fractions. `off.x` is treated as "outward" and is mirrored per side;
 * +z is "front" (the toe landmark points +z, so a humanoid spec faces +z).
 *
 *   name      belly bone name (side suffix L/R appended for the paired muscles)
 *   parent    joint the belly hangs off, so it inherits that joint's motion
 *   group     label only, for the UI/tooltip
 *   gain      how much the belly swells at full flex (0.3 = +30%)
 *   drivers   [{ bone, full, weight }] — `bone`'s local rotation drives the bulge, `full`
 *             is the rotation (radians) counted as "fully flexed", `weight` its share
 *             when several joints drive one belly.
 */
export const MUSCLE_DEFS = [
  /* --- shoulder / arm --- */
  { id: "deltoid", name: "Deltoid", group: "Shoulder", parent: "{A}Arm", a: "{A}Shoulder", b: "{A}Arm", t0: -0.05, t1: 0.35, off: [0.012, 0.012, 0.005], gain: 0.22,
    drivers: [{ bone: "{A}Arm", full: 1.1 }] },
  { id: "biceps", name: "Biceps", group: "Arm", parent: "{A}Arm", a: "{A}Shoulder", b: "{A}Arm", t0: 0.25, t1: 0.75, off: [0, 0, 0.028], gain: 0.32,
    drivers: [{ bone: "{A}ForeArm", full: 1.5 }] },
  { id: "triceps", name: "Triceps", group: "Arm", parent: "{A}Arm", a: "{A}Shoulder", b: "{A}Arm", t0: 0.2, t1: 0.8, off: [0, 0, -0.026], gain: 0.18,
    drivers: [{ bone: "{A}ForeArm", full: 1.5, weight: 0.5 }] },
  { id: "brachialis", name: "Brachialis", group: "Arm", parent: "{A}Arm", a: "{A}Shoulder", b: "{A}Arm", t0: 0.55, t1: 0.95, off: [0, 0, 0.026], gain: 0.2,
    drivers: [{ bone: "{A}ForeArm", full: 1.5 }] },
  { id: "forearmflex", name: "ForearmFlex", group: "Forearm", parent: "{A}ForeArm", a: "{A}Arm", b: "{A}ForeArm", t0: 0.15, t1: 0.62, off: [0, 0, 0.022], gain: 0.22,
    drivers: [{ bone: "{A}Hand", full: 1.0 }] },
  { id: "forearmext", name: "ForearmExt", group: "Forearm", parent: "{A}ForeArm", a: "{A}Arm", b: "{A}ForeArm", t0: 0.12, t1: 0.6, off: [0, 0, -0.02], gain: 0.16,
    drivers: [{ bone: "{A}Hand", full: 1.0 }] },

  /* --- torso --- */
  { id: "pectoralis", name: "Pectoralis", group: "Chest", parent: "{CHEST}", a: "{CHEST}", b: "{A}Shoulder", t0: 0.05, t1: 0.85, off: [0, -0.005, 0.03], gain: 0.2,
    drivers: [{ bone: "{A}Arm", full: 1.2, weight: 0.7 }, { bone: "{CHEST}", full: 0.5, weight: 0.3 }] },
  { id: "latissimus", name: "Latissimus", group: "Back", parent: "{CHEST}", a: "{SPINE}", b: "{A}Shoulder", t0: 0.2, t1: 1.0, off: [0, -0.03, -0.03], gain: 0.18,
    drivers: [{ bone: "{A}Arm", full: 0.9 }] },
  { id: "trapezius", name: "Trapezius", group: "Back", parent: "{CHEST}", a: "{CHEST}", b: "{A}Shoulder", t0: 0.1, t1: 0.9, off: [0, 0.025, -0.02], gain: 0.15,
    drivers: [{ bone: "{A}Arm", full: 0.7, weight: 0.5 }, { bone: "Neck", full: 0.6, weight: 0.5 }] },
  { id: "obliques", name: "Obliques", group: "Core", parent: "{CHEST}", a: "Root", b: "{CHEST}", t0: 0.15, t1: 0.8, off: [0.045, 0, 0], gain: 0.15,
    drivers: "{SPINE_CHAIN}" },

  /* --- hips / legs --- */
  { id: "gluteus", name: "Gluteus", group: "Glute", parent: "{A}UpLeg", a: "{A}UpLeg", b: "{A}Leg", t0: -0.15, t1: 0.05, off: [0, 0, -0.045], gain: 0.26,
    drivers: [{ bone: "{A}UpLeg", full: 1.2 }] },
  { id: "quadriceps", name: "Quadriceps", group: "Thigh", parent: "{A}UpLeg", a: "{A}UpLeg", b: "{A}Leg", t0: 0.2, t1: 0.85, off: [0, 0, 0.026], gain: 0.22,
    drivers: [{ bone: "{A}Leg", full: 1.5, weight: 0.6 }, { bone: "{A}UpLeg", full: 1.2, weight: 0.4 }] },
  { id: "hamstring", name: "Hamstring", group: "Thigh", parent: "{A}UpLeg", a: "{A}UpLeg", b: "{A}Leg", t0: 0.2, t1: 0.85, off: [0, 0, -0.026], gain: 0.24,
    drivers: [{ bone: "{A}Leg", full: 1.5 }] },
  { id: "adductor", name: "Adductor", group: "Thigh", parent: "{A}UpLeg", a: "{A}UpLeg", b: "{A}Leg", t0: 0.1, t1: 0.6, off: [-0.028, 0, 0], gain: 0.16,
    drivers: [{ bone: "{A}UpLeg", full: 0.8 }] },
  { id: "gastrocnemius", name: "Gastrocnemius", group: "Calf", parent: "{A}Leg", a: "{A}Leg", b: "{A}Foot", t0: 0.05, t1: 0.55, off: [0, 0, -0.024], gain: 0.3,
    drivers: [{ bone: "{A}Foot", full: 0.9, weight: 0.6 }, { bone: "{A}Leg", full: 1.5, weight: 0.4 }] },
  { id: "soleus", name: "Soleus", group: "Calf", parent: "{A}Leg", a: "{A}Leg", b: "{A}Foot", t0: 0.4, t1: 0.85, off: [0, 0, -0.018], gain: 0.2,
    drivers: [{ bone: "{A}Foot", full: 0.9 }] },
  { id: "tibialis", name: "Tibialis", group: "Calf", parent: "{A}Leg", a: "{A}Leg", b: "{A}Foot", t0: 0.1, t1: 0.6, off: [0, 0, 0.02], gain: 0.16,
    drivers: [{ bone: "{A}Foot", full: 0.9 }] },
];

/* Centre (unpaired) bellies — one per body. */
const CENTRE_DEFS = [
  { id: "rectusabdominis", name: "RectusAbdominis", group: "Core", parent: "Root", a: "Root", b: "{CHEST}", t0: 0.12, t1: 0.85, off: [0, 0, 0.03], gain: 0.22,
    drivers: "{SPINE_CHAIN}" },
  { id: "erectorspinae", name: "ErectorSpinae", group: "Back", parent: "Root", a: "Root", b: "{CHEST}", t0: 0.12, t1: 0.85, off: [0, 0, -0.03], gain: 0.16,
    drivers: "{SPINE_CHAIN}" },
];

function subst(str, ctx) {
  return str
    .replace(/\{A\}/g, ctx.tag)
    .replace(/\{CHEST\}/g, ctx.chest)
    .replace(/\{SPINE\}/g, ctx.spineLower);
}

function resolve(template, ctx, sgn) {
  if (typeof template === "string") {
    if (template === "{SPINE_CHAIN}") {
      const chain = ctx.spineChain;
      return chain.map((name) => ({ bone: name, full: 0.5, weight: 1 / chain.length }));
    }
    return subst(template, ctx);
  }
  if (Array.isArray(template)) return template.map((d) => resolve(d, ctx, sgn));
  if (template === null || typeof template !== "object") return template;
  const out = {};
  for (const k in template) out[k] = resolve(template[k], ctx, sgn);
  return out;
}

/*
 * Extends a humanoid spec with one bone per muscle belly. Returns
 * `{ spec, defs }` where `spec` is the base spec + the muscle bones (ready for
 * bonesFromSpec) and `defs` is the list the flex controller needs
 * ({ name, gain, drivers:[{bone, full, weight}] }).
 *
 * `baseSpec` is the array humanoidSpec() produced; positions are read from it so the
 * muscles land on whatever body the fitter measured. `body` is the analyzeBody() result.
 */
export function muscleSpec(baseSpec, body, opts = {}) {
  if (!Array.isArray(baseSpec) || !baseSpec.length) return { spec: baseSpec, defs: [] };
  const H = body && body.height ? body.height : 1;
  /* How close each belly sits to the *limb axis*, and how much it swells. Placing a belly
     on the skin (large `off`) makes it nearly useless: the surface vertices it owns lie on
     its own axis, so scaling it barely moves them. Pulling the bellies in toward the limb
     axis (offScale) puts the skin a real radius away from the scale axis, so a flex throws
     the surface outward as a visible bulge. Kept as fractions so the same numbers fit any
     body the fitter measured. */
  const offScale = opts.offScale != null ? opts.offScale : 0.4;
  const gainScale = opts.gainScale != null ? opts.gainScale : 2.5;
  const P = new Map();
  for (const n of baseSpec) P.set(n.name, n.pos);
  const at = (name) => P.get(name) || null;

  const spineChain = baseSpec
    .map((n) => n.name)
    .filter((n) => /^Spine(\d*)$/.test(n))
    .sort((a, b) => a.length - b.length);
  const chest = spineChain.length ? spineChain[spineChain.length - 1] : (at("Spine") ? "Spine" : "Root");
  const spineLower = spineChain.length ? spineChain[0] : chest;
  const groups = opts.groups ? new Set(opts.groups) : null;

  const spec = baseSpec.slice();
  const defs = [];

  const place = (def, sgn) => {
    if (!def || (groups && !groups.has(def.group))) return;
    const ctx = { tag: sgn < 0 ? "Left" : "Right", chest, spineLower, spineChain };
    const parent = resolve(def.parent, ctx, sgn);
    const a = at(resolve(def.a, ctx, sgn));
    const b = at(resolve(def.b, ctx, sgn));
    if (!a || !b || !P.has(parent)) return;
    const off = vec(def.off[0] * sgn, def.off[1], def.off[2]).multiplyScalar(H * offScale);
    const head = lerp3(a, b, def.t0).add(off);
    const tail = lerp3(a, b, def.t1).add(off);
    const dir = tail.clone().sub(head);
    const len = dir.length();
    if (len < 1e-6) return;
    dir.divideScalar(len);
    const name = sgn === 0 ? def.name : def.name + (sgn < 0 ? "L" : "R");
    spec.push({ name, parent, pos: head, dir, len, muscle: true });
    defs.push({ name, group: def.group, gain: def.gain * gainScale, drivers: resolve(def.drivers, ctx, sgn) });
  };

  for (const def of MUSCLE_DEFS) {
    place(def, -1);
    place(def, 1);
  }
  for (const def of CENTRE_DEFS) place(def, 0);

  return { spec, defs };
}

/* ---------------------------------------------------------------- controller */

/*
 * createMuscleRig({ getRoot, getRig, refreshRig, render, autoArmature, toast })
 *
 *   .generate(opts)  forge the humanoid skeleton *with* the muscle layer and bind it
 *                    (opts: spine/fingers/toes/armSpread/legStance/force/flex/intensity)
 *   .update(dt)      read the live pose and swell the bellies (call once per frame,
 *                    AFTER motion.js's update)
 *   .remove()        drop the whole armature (muscles included)
 *   .setOptions({})  { flex, intensity, spine, fingers, toes }
 *   .state()         { muscles, flex, intensity, linked, hasArmature, bones }
 */
export function createMuscleRig({ getRoot, getRig, refreshRig, render, autoArmature, toast } = {}) {
  const say = (m, ms) => {
    if (typeof toast === "function") toast(m, ms);
  };

  let flexList = [];
  let lastDefs = [];
  let enabled = true;
  let intensity = 1.5;
  let params = { spine: 3, fingers: false, toes: true, flex: true, intensity: 1.5, offScale: 0.4, gainScale: 2.5, muscleMax: 0.6 };

  const currentRig = () => (typeof getRig === "function" ? getRig() : null);

  function afterChange() {
    if (typeof refreshRig === "function") refreshRig();
    if (typeof render === "function") render();
  }

  /* The stage model / rig can be replaced under us — drop bellies whose bones are gone so we
     never scale a detached bone (e.g. after the plain Auto-armature re-forges without muscles). */
  function sync() {
    if (!flexList.length) return;
    const rig = currentRig();
    if (!rig || !rig.bones || !rig.bones.length) {
      flexList = [];
      return;
    }
    const set = new Set(rig.bones);
    if (flexList.some((m) => !set.has(m.bone))) flexList = [];
  }

  /* Capture the bind pose of each driver joint so the flex reads "rotation since bind". */
  function install() {
    const rig = currentRig();
    flexList = [];
    if (!rig || !rig.bones || !rig.bones.length) return 0;
    const byName = new Map();
    rig.bones.forEach((b, i) => byName.set(rig.names[i] || b.name, b));
    for (const def of lastDefs) {
      const bone = byName.get(def.name);
      if (!bone) continue;
      const drivers = [];
      for (const d of def.drivers || []) {
        const db = byName.get(d.bone);
        if (!db) continue;
        drivers.push({
          bone: db,
          bindQ: db.quaternion.clone(),
          full: d.full > 1e-3 ? d.full : 1,
          weight: d.weight == null ? 1 : d.weight,
        });
      }
      if (!drivers.length) continue;
      flexList.push({ bone, drivers, gain: def.gain != null ? def.gain : 0.2 });
    }
    return flexList.length;
  }

  function generate(opts = {}) {
    if (!autoArmature) {
      say("Auto-armature engine unavailable", 2600);
      return { ok: false, reason: "no-engine" };
    }
    const spine = opts.spine != null ? opts.spine : params.spine;
    const fingers = opts.fingers != null ? opts.fingers : params.fingers;
    const toes = opts.toes != null ? opts.toes : params.toes;
    const offScale = opts.offScale != null ? opts.offScale : params.offScale;
    const gainScale = opts.gainScale != null ? opts.gainScale : params.gainScale;
    const muscleMax = opts.muscleMax != null ? opts.muscleMax : params.muscleMax;
    lastDefs = [];
    const f = autoArmature.forge({
      spine,
      fingers,
      toes,
      armSpread: opts.armSpread,
      legStance: opts.legStance,
      force: opts.force,
      muscleMax,
      decorate: (spec, body) => {
        const built = muscleSpec(spec, body, { groups: opts.groups, offScale, gainScale });
        lastDefs = built.defs;
        return built.spec;
      },
    });
    if (!f || f.ok === false) {
      say(
        f && f.reason === "already-rigged"
          ? "This model already has a skeleton — replace it below"
          : "Couldn't forge a muscle rig",
        3000,
      );
      return f || { ok: false, reason: "forge-failed" };
    }
    const muscles = install();
    const b = autoArmature.bind();
    enabled = opts.flex != null ? !!opts.flex : params.flex;
    if (opts.intensity != null) intensity = opts.intensity;
    params = { spine, fingers, toes, flex: enabled, intensity, offScale, gainScale, muscleMax };
    afterChange();
    say(
      "Muscle rig: " + muscles + " muscles on " + f.bones + " bones",
      3000,
    );
    return { ok: !!b.ok, muscles, bones: f.bones, linked: b.linked };
  }

  function remove(silent) {
    flexList = [];
    lastDefs = [];
    if (autoArmature) autoArmature.remove(silent);
    if (silent && typeof refreshRig === "function") refreshRig();
  }

  function update() {
    if (!flexList.length) return;
    sync();
    if (!flexList.length) return;
    if (!enabled) {
      for (const m of flexList) m.bone.scale.set(1, 1, 1);
      return;
    }
    for (const m of flexList) {
      let f = 0;
      for (const d of m.drivers) {
        let a = d.bone.quaternion.angleTo(d.bindQ);
        a /= d.full;
        if (a > 1) a = 1;
        f += a * d.weight;
      }
      if (f > 1) f = 1;
      if (f < 0) f = 0;
      const s = 1 + f * intensity * m.gain;
      m.bone.scale.set(s, 1, s);
    }
    const rig = currentRig();
    if (rig && rig.updateSkeleton) rig.updateSkeleton();
  }

  function state() {
    sync();
    const rig = currentRig();
    const st = autoArmature && autoArmature.state ? autoArmature.state() : null;
    return {
      muscles: flexList.length,
      flex: enabled,
      intensity,
      linked: st ? st.linked : 0,
      hasArmature: st ? st.hasArmature : false,
      rigBones: st ? st.rigBones : 0,
      bones: st ? st.bones : 0,
      spine: params.spine,
      fingers: params.fingers,
      toes: params.toes,
    };
  }

  function setOptions(patch = {}) {
    if (patch.flex != null) enabled = !!patch.flex;
    if (patch.intensity != null) intensity = Math.max(0, Math.min(4, Number(patch.intensity) || 0));
    if (patch.spine != null) params.spine = patch.spine;
    if (patch.fingers != null) params.fingers = !!patch.fingers;
    if (patch.toes != null) params.toes = !!patch.toes;
    params.flex = enabled;
    params.intensity = intensity;
    return { flex: enabled, intensity, ...params };
  }

  return {
    generate,
    remove,
    update,
    state,
    setOptions,
    get muscles() {
      sync();
      return flexList.length;
    },
    get enabled() {
      return enabled;
    },
    get intensity() {
      return intensity;
    },
    get defs() {
      return lastDefs.slice();
    },
  };
}
