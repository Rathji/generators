/*
 * motion.js — procedural, bone-level motion presets for a rigged model.
 *
 * Where armature.js plays back the clips a file already contains, this module
 * *generates* motion directly on the skeleton: it drives every bone from the
 * bind pose, so a model with no animation at all (or a pose the user made by
 * hand) can be brought to life — and so can a specific, explicit kind of motion
 * that no stock clip would ever ship with.
 *
 * How a motion is written
 * -----------------------
 * A motion is a pure function `(h, p)` where `p` is the normalised phase 0→1
 * and `h` is a helper bound to the current skeleton. Bones are grouped by their
 * anatomical role (armature.js `classifyBone`) and by bind-pose side, so the same
 * preset drives very different rigs. The helpers rotate about *world* axes in
 * bind space:
 *
 *   h.rot(bone, x, y, z)      – add a world-space euler (radians) to one bone
 *   h.rotAll(list, x, y, z)   – add the same rotation to each bone of a group
 *   h.rotChain(list, t, x,y,z)– rotate the bone nearest fraction `t` of a limb chain
 *   h.move(bone, x, y, z)     – translate a bone (world units) — used for hip travel
 *
 * A rotating parent carries its children (real FK), so rotating a shoulder or a
 * thigh swings the whole limb, and a hip rotation carries the legs.
 *
 * While a motion is active it owns the pose: it stops any clip and keys off the
 * bind pose each frame, so it is deterministic and cannot drift.
 */

import * as T3 from "./three.js";

const THREE = T3.THREE;

export const MOTION_CATEGORIES = [
  { id: "Basic", label: "Basic" },
  { id: "Cycle", label: "Locomotion" },
  { id: "Action", label: "Action" },
  { id: "Intimate", label: "Intimate" },
  { id: "Partner", label: "Partner" },
];

const TAU = Math.PI * 2;

/* ------------------------------------------------------------------ helpers */

function pick(list, t) {
  if (!list || !list.length) return -1;
  const i = Math.min(list.length - 1, Math.max(0, Math.round(t * (list.length - 1))));
  return list[i];
}

const firstOf = (list) => (list && list.length ? list[0] : -1);
const lastOf = (list) => (list && list.length ? list[list.length - 1] : -1);

/* --------------------------------------------------------------- partner poses
 * Reusable stances for the paired presets, written against the layer's named joints
 * (`h.joint(limb, root|mid|end, ...)`) rather than raw bone fractions, so the two
 * bodies share one vocabulary and the presets stay readable. `drop`/`spread` and
 * friends are the knobs a preset tweaks to layer its own rhythm on the stance.
 */

/* Bottom, flat on her back: pelvis on the floor, knees up and open, arms reaching up
   toward whoever is on top. */
function poseOnBack(h, { knee = 1.2, open = 0.55, fold = -1.55, armUp = -1.3, drop = -0.9 } = {}) {
  h.rot(h.p.root, -1.5, 0, 0);
  h.move(h.p.root, 0, drop, 0);
  h.joint("legL", "mid", knee, 0, open);
  h.joint("legR", "mid", knee, 0, -open);
  h.joint("legL", "end", fold, 0, 0);
  h.joint("legR", "end", fold, 0, 0);
  h.joint("armL", "mid", armUp, 0, 0.4);
  h.joint("armR", "mid", armUp, 0, -0.4);
  h.joint("armL", "end", -0.7, 0, 0);
  h.joint("armR", "end", -0.7, 0, 0);
}

/* Top, kneeling astride: thighs forward and spread, shins folded under the body,
   arms hanging forward to brace on the bottom's chest. */
function poseKneelStraddle(h, { thigh = 1.5, spread = 0.5, fold = -1.95, armFwd = -1.1, drop = 0 } = {}) {
  h.move(h.p.root, 0, drop, 0);
  h.joint("legL", "mid", thigh, 0, spread);
  h.joint("legR", "mid", thigh, 0, -spread);
  h.joint("legL", "end", fold, 0, 0);
  h.joint("legR", "end", fold, 0, 0);
  h.joint("armL", "mid", armFwd, 0, 0.3);
  h.joint("armR", "mid", armFwd, 0, -0.3);
  h.joint("armL", "end", -0.5, 0, 0);
  h.joint("armR", "end", -0.5, 0, 0);
}

/* Bottom, standing and bent forward over the hips, arms braced ahead, knees soft. */
function poseBendOver(h, { lean = 0.95, chest = 0.35, head = -0.85, thigh = 0.5, shin = -0.95 } = {}) {
  h.rotChain(h.p.spine, 0.5, lean, 0, 0);
  h.rot(h.p.chest, chest, 0, 0);
  h.rot(h.p.head, head, 0, 0);
  h.joint("legL", "mid", thigh, 0, 0);
  h.joint("legR", "mid", thigh, 0, 0);
  h.joint("legL", "end", shin, 0, 0);
  h.joint("legR", "end", shin, 0, 0);
  h.joint("armL", "mid", -1.5, 0, 0);
  h.joint("armR", "mid", -1.5, 0, 0);
  h.joint("armL", "end", -0.25, 0, 0);
  h.joint("armR", "end", -0.25, 0, 0);
}

/* Top, standing close behind: a squared stance with the hips driving forward through
   the stroke, hands reaching ahead onto the bottom's hips. */
function poseStandBehind(h, { drive = 0, thigh = 0.45, shin = -0.7, lean = 0.4 } = {}) {
  h.rot(h.p.hips, -0.28 + drive * 0.3, 0, 0);
  h.move(h.p.root, 0, 0, drive * 0.07);
  h.rotChain(h.p.spine, 0.5, lean - drive * 0.12, 0, 0);
  h.rot(h.p.chest, 0.15, 0, 0);
  h.rot(h.p.head, 0.1, 0, 0);
  h.joint("legL", "mid", thigh + Math.max(0, drive) * 0.2, 0, 0);
  h.joint("legR", "mid", thigh + Math.max(0, drive) * 0.2, 0, 0);
  h.joint("legL", "end", shin, 0, 0);
  h.joint("legR", "end", shin, 0, 0);
  h.joint("armL", "mid", -1.65, 0, 0.15);
  h.joint("armR", "mid", -1.65, 0, -0.15);
  h.joint("armL", "end", -0.5, 0, 0);
  h.joint("armR", "end", -0.5, 0, 0);
}

/* ------------------------------------------------------------------- presets */

/*
 * Each entry: id, label, category, desc, duration (seconds per loop), loop,
 * and step(h, p). `p` runs 0→1 across `duration`.
 */
export const MOTIONS = [
  /* ---------------------------------------------------------------- Basic */
  {
    id: "breathe",
    label: "Breathe",
    category: "Basic",
    desc: "Slow chest rise and fall with a gentle shoulder roll.",
    duration: 4,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      h.rotAll(h.p.spine, s * 0.02, 0, 0);
      h.rot(h.p.chest, s * 0.03, 0, 0);
      h.rotAll(h.p.arms.map(firstOf).filter((i) => i >= 0), 0, 0, s * 0.05);
      h.rot(h.p.head, s * 0.015, 0, 0);
    },
  },
  {
    id: "idle",
    label: "Idle sway",
    category: "Basic",
    desc: "Weight shifts side to side with a soft head drift — a natural resting pose.",
    duration: 6,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      h.rot(h.p.hips, 0, s * 0.06, s * 0.03);
      h.rotChain(h.p.spine, 0.7, 0, -s * 0.06, s * 0.04);
      h.rot(h.p.head, 0, -s * 0.12, s * 0.03);
      h.rotAll(h.p.arms.map(firstOf).filter((i) => i >= 0), 0, 0, s * 0.06);
    },
  },
  {
    id: "lookaround",
    label: "Look around",
    category: "Basic",
    desc: "Head turns left and right, scanning.",
    duration: 6,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      const t = Math.sin(p * TAU * 2);
      h.rot(h.p.head, t * 0.06, s * 0.5, -s * 0.08);
      h.rotChain(h.p.spine, 0.9, 0, s * 0.08, 0);
    },
  },
  {
    id: "nod",
    label: "Nod",
    category: "Basic",
    desc: "Head nods up and down.",
    duration: 2.4,
    loop: true,
    step(h, p) {
      h.rot(h.p.head, Math.sin(p * TAU) * 0.28, 0, 0);
    },
  },

  /* ------------------------------------------------------------ Locomotion */
  {
    id: "walk",
    label: "Walk",
    category: "Cycle",
    desc: "Alternating leg stride with counter-swinging arms and a body bob.",
    duration: 1.6,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      const c = Math.cos(p * TAU);
      const amp = 0.5;
      h.rotChain(h.p.legL, 0.34, s * amp, 0, 0);
      h.rotChain(h.p.legR, 0.34, -s * amp, 0, 0);
      h.rotChain(h.p.legL, 0.72, -Math.max(0, s) * 0.7, 0, 0);
      h.rotChain(h.p.legR, 0.72, -Math.max(0, -s) * 0.7, 0, 0);
      h.rotChain(h.p.armL, 0.3, -s * amp * 0.7, 0, 0);
      h.rotChain(h.p.armR, 0.3, s * amp * 0.7, 0, 0);
      h.rot(h.p.hips, 0, -s * 0.12, c * 0.05);
      h.move(h.p.root, 0, Math.abs(c) * 0.03, 0);
      h.rot(h.p.chest, 0.05, s * 0.08, 0);
    },
  },
  {
    id: "run",
    label: "Run",
    category: "Cycle",
    desc: "Faster, larger stride with a forward lean and bigger arm swing.",
    duration: 1,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      const c = Math.cos(p * TAU);
      h.rotChain(h.p.spine, 0.5, 0.24, 0, 0);
      h.rotChain(h.p.legL, 0.34, s * 0.95, 0, 0);
      h.rotChain(h.p.legR, 0.34, -s * 0.95, 0, 0);
      h.rotChain(h.p.legL, 0.72, -Math.max(0, s) * 1.3, 0, 0);
      h.rotChain(h.p.legR, 0.72, -Math.max(0, -s) * 1.3, 0, 0);
      h.rotChain(h.p.armL, 0.3, -s * 0.9, 0, 0);
      h.rotChain(h.p.armR, 0.3, s * 0.9, 0, 0);
      h.rotChain(h.p.armL, 0.6, -0.9, 0, 0);
      h.rotChain(h.p.armR, 0.6, -0.9, 0, 0);
      h.rot(h.p.hips, 0, -s * 0.2, c * 0.08);
      h.move(h.p.root, 0, Math.abs(c) * 0.09, 0);
    },
  },
  {
    id: "jump",
    label: "Jump",
    category: "Cycle",
    desc: "Crouch, launch, tuck and land — a full jump arc.",
    duration: 1.8,
    loop: false,
    step(h, p) {
      const crouch = (t) => Math.max(0, Math.sin(t * Math.PI)) * 1.1;
      if (p < 0.25) {
        const k = crouch(p / 0.25);
        h.rotAll([pick(h.p.legL, 0.34), pick(h.p.legR, 0.34)].filter((i) => i >= 0), k, 0, 0);
        h.rotAll([pick(h.p.legL, 0.72), pick(h.p.legR, 0.72)].filter((i) => i >= 0), -k * 1.6, 0, 0);
        h.move(h.p.root, 0, -0.12 * (p / 0.25), 0);
        h.rotChain(h.p.armL, 0.3, -k, 0, 0);
        h.rotChain(h.p.armR, 0.3, -k, 0, 0);
      } else if (p < 0.62) {
        const up = (p - 0.25) / 0.37;
        h.move(h.p.root, 0, -0.12 + up * 0.5 + Math.sin(up * Math.PI) * 0.25, 0);
        h.rotAll([pick(h.p.legL, 0.34), pick(h.p.legR, 0.34)].filter((i) => i >= 0), -0.5, 0, 0);
        h.rotChain(h.p.armL, 0.3, -2.4, 0, 0);
        h.rotChain(h.p.armR, 0.3, -2.4, 0, 0);
      } else {
        const dn = (p - 0.62) / 0.38;
        h.move(h.p.root, 0, 0.63 - dn * 0.72, 0);
        const land = Math.max(0, Math.sin(dn * Math.PI)) * 0.9;
        h.rotAll([pick(h.p.legL, 0.34), pick(h.p.legR, 0.34)].filter((i) => i >= 0), land, 0, 0);
        h.rotAll([pick(h.p.legL, 0.72), pick(h.p.legR, 0.72)].filter((i) => i >= 0), -land * 1.6, 0, 0);
      }
    },
  },
  {
    id: "wave",
    label: "Wave",
    category: "Cycle",
    desc: "One arm raised, waving side to side.",
    duration: 2.4,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU * 2);
      const arm = firstOf(h.p.armR) >= 0 ? h.p.armR : h.p.armL;
      h.rotChain(arm, 0.3, -2.3, 0, 0);
      h.rotChain(arm, 0.6, 0, 0, s * 0.5);
      h.rot(h.p.head, 0, 0, 0.08);
    },
  },

  /* ---------------------------------------------------------------- Action */
  {
    id: "dance",
    label: "Dance",
    category: "Action",
    desc: "Rhythmic hip and shoulder groove.",
    duration: 2,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      const t = Math.sin(p * TAU * 2);
      h.rot(h.p.hips, t * 0.08, s * 0.22, s * 0.2);
      h.rotChain(h.p.spine, 0.7, -t * 0.06, s * 0.18, -s * 0.12);
      h.rot(h.p.head, t * 0.1, -s * 0.2, s * 0.1);
      h.rotAll(h.p.arms.map(firstOf).filter((i) => i >= 0), -1.2 + t * 0.4, 0, 0);
      h.rotChain(h.p.armL, 0.6, 0, 0, 1.1 + s * 0.3);
      h.rotChain(h.p.armR, 0.6, 0, 0, -1.1 - s * 0.3);
      h.rotChain(h.p.legL, 0.34, s * 0.25, 0, 0);
      h.rotChain(h.p.legR, 0.34, -s * 0.25, 0, 0);
      h.move(h.p.root, 0, Math.abs(t) * 0.04, 0);
    },
  },
  {
    id: "squat",
    label: "Squat",
    category: "Action",
    desc: "Deep knee-bend cycle, hips dropping and rising.",
    duration: 2.4,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU) * 0.5 + 0.5;
      const k = s * 1.2;
      h.rotAll([pick(h.p.legL, 0.34), pick(h.p.legR, 0.34)].filter((i) => i >= 0), k, 0, 0);
      h.rotAll([pick(h.p.legL, 0.72), pick(h.p.legR, 0.72)].filter((i) => i >= 0), -k * 1.7, 0, 0);
      h.move(h.p.root, 0, -s * 0.16, 0);
      h.rotChain(h.p.spine, 0.5, s * 0.2, 0, 0);
    },
  },
  {
    id: "punch",
    label: "Punch",
    category: "Action",
    desc: "Wind up and throw a straight jab with the right arm.",
    duration: 1,
    loop: false,
    step(h, p) {
      const k = p < 0.3 ? -p / 0.3 : (p - 0.3) / 0.7;
      const ext = Math.max(0, Math.min(1, k));
      h.rot(h.p.hips, 0, -ext * 0.5, 0);
      h.rotChain(h.p.spine, 0.6, 0, -ext * 0.7, 0);
      h.rotChain(h.p.armR, 0.3, -ext * 1.5, 0, 0);
      h.rotChain(h.p.armR, 0.6, -ext * 0.9, 0, 0);
      h.rotChain(h.p.armL, 0.3, ext * 0.7, 0, 0);
      h.rotChain(h.p.armL, 0.6, -1.4, 0, 0);
    },
  },
  {
    id: "kick",
    label: "Kick",
    category: "Action",
    desc: "Lift the right leg and kick forward.",
    duration: 1.2,
    loop: false,
    step(h, p) {
      const k = p < 0.4 ? p / 0.4 : (1 - p) / 0.6;
      const ext = Math.max(0, k);
      h.rotChain(h.p.legR, 0.34, -ext * 1.5, 0, 0);
      h.rotChain(h.p.legR, 0.72, ext * 0.9, 0, 0);
      h.rotChain(h.p.spine, 0.5, ext * 0.25, 0, 0);
      h.rotChain(h.p.armL, 0.3, -ext * 0.9, 0, 0);
      h.rotChain(h.p.armR, 0.3, ext * 0.5, 0, 0);
    },
  },

  /* -------------------------------------------------------------- Intimate */
  {
    id: "hip-thrust",
    label: "Hip thrust",
    category: "Intimate",
    desc: "Adult: rhythmic forward/back pelvic thrust, hips driving the motion.",
    duration: 1.4,
    loop: true,
    step(h, p) {
      const push = Math.sin(p * TAU);
      h.rot(h.p.hips, push * 0.32, 0, 0);
      h.move(h.p.root, 0, 0, push * 0.06);
      h.rotChain(h.p.spine, 0.4, -push * 0.14, 0, 0);
      h.rot(h.p.chest, -push * 0.1, 0, 0);
      h.rot(h.p.head, push * 0.12, 0, 0);
      h.rotChain(h.p.armL, 0.3, -0.5, 0, 0);
      h.rotChain(h.p.armR, 0.3, -0.5, 0, 0);
      h.rotAll([pick(h.p.legL, 0.34), pick(h.p.legR, 0.34)].filter((i) => i >= 0), 0.25 + push * 0.08, 0, 0);
      h.rotAll([pick(h.p.legL, 0.72), pick(h.p.legR, 0.72)].filter((i) => i >= 0), -0.5, 0, 0);
    },
  },
  {
    id: "grind",
    label: "Grind",
    category: "Intimate",
    desc: "Adult: slow circular grinding with the hips, torso following.",
    duration: 2.6,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      const c = Math.cos(p * TAU);
      h.rot(h.p.hips, s * 0.12, c * 0.24, s * 0.16);
      h.move(h.p.root, c * 0.05, Math.abs(s) * 0.02, 0);
      h.rotChain(h.p.spine, 0.5, s * 0.08, c * 0.14, 0);
      h.rot(h.p.head, -s * 0.08, -c * 0.1, 0);
      h.rotChain(h.p.armL, 0.6, 0, 0, 1.2);
      h.rotChain(h.p.armR, 0.6, 0, 0, -1.2);
    },
  },
  {
    id: "cowgirl",
    label: "Ride",
    category: "Intimate",
    desc: "Adult: straddling bounce-and-rock, hips rising and dropping with a forward tilt.",
    duration: 1.1,
    loop: true,
    step(h, p) {
      const bounce = Math.abs(Math.sin(p * TAU));
      const rock = Math.sin(p * TAU + 0.5);
      h.move(h.p.root, 0, -bounce * 0.09, rock * 0.03);
      h.rot(h.p.hips, 0.3 + rock * 0.16, 0, 0);
      h.rotChain(h.p.spine, 0.5, -0.12 + Math.abs(Math.sin(p * TAU)) * 0.1, 0, rock * 0.06);
      h.rot(h.p.head, -0.1 - rock * 0.1, 0, 0);
      h.rotAll([pick(h.p.legL, 0.34), pick(h.p.legR, 0.34)].filter((i) => i >= 0), 1.1, 0, 0.35);
      h.rotAll([pick(h.p.legL, 0.72), pick(h.p.legR, 0.72)].filter((i) => i >= 0), -1.9, 0, 0);
      h.rotChain(h.p.armL, 0.5, 0, 0, 0.9);
      h.rotChain(h.p.armR, 0.5, 0, 0, -0.9);
    },
  },
  {
    id: "doggy",
    label: "From behind",
    category: "Intimate",
    desc: "Adult: bent-over stance with sharp, driving hips and a braced upper body.",
    duration: 1.2,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      h.rotChain(h.p.spine, 0.5, 1.15, 0, 0);
      h.rot(h.p.chest, 0.35, 0, 0);
      h.rot(h.p.head, -1.1, 0, 0);
      h.rot(h.p.hips, s * 0.3, 0, 0);
      h.move(h.p.root, 0, 0, s * 0.07);
      h.rotAll([pick(h.p.legL, 0.34), pick(h.p.legR, 0.34)].filter((i) => i >= 0), 1.25, 0, 0);
      h.rotAll([pick(h.p.legL, 0.72), pick(h.p.legR, 0.72)].filter((i) => i >= 0), -1.6, 0, 0);
      h.rotChain(h.p.armL, 0.3, -1.5, 0, 0);
      h.rotChain(h.p.armR, 0.3, -1.5, 0, 0);
      h.rotChain(h.p.armL, 0.6, -0.3, 0, 0);
      h.rotChain(h.p.armR, 0.6, -0.3, 0, 0);
    },
  },
  {
    id: "suck",
    label: "Head bob",
    category: "Intimate",
    desc: "Adult: forward head bob from a kneeling, leaned-over stance.",
    duration: 0.9,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      h.rotChain(h.p.spine, 0.5, 0.55, 0, 0);
      h.rot(h.p.head, 0.5 + s * 0.45, 0, 0);
      h.move(h.p.root, 0, -Math.max(0, s) * 0.04, 0);
      h.rotAll([pick(h.p.legL, 0.34), pick(h.p.legR, 0.34)].filter((i) => i >= 0), 1.2, 0, 0);
      h.rotAll([pick(h.p.legL, 0.72), pick(h.p.legR, 0.72)].filter((i) => i >= 0), -1.9, 0, 0);
    },
  },
  {
    id: "handjob",
    label: "Stroking",
    category: "Intimate",
    desc: "Adult: one hand moving up and down in a rhythmic stroke.",
    duration: 1,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      h.rotChain(h.p.spine, 0.6, 0.25, 0, 0);
      h.rotChain(h.p.armR, 0.3, -1.15, 0, 0);
      h.rotChain(h.p.armR, 0.6, -0.7 + s * 0.4, 0, 0);
      h.rotChain(h.p.armL, 0.3, -0.3, 0, 0);
      h.rot(h.p.head, 0.35, 0, 0);
    },
  },
  {
    id: "spread",
    label: "Spread legs",
    category: "Intimate",
    desc: "Adult: legs opening and closing from a seated / reclined pose.",
    duration: 2.2,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU) * 0.5 + 0.5;
      const k = 0.25 + s * 0.85;
      h.rotChain(h.p.spine, 0.5, -0.5, 0, 0);
      h.rotAll([pick(h.p.legL, 0.34), pick(h.p.legR, 0.34)].filter((i) => i >= 0), 1.2, 0, 0);
      if (pick(h.p.legL, 0.34) >= 0) h.rot(pick(h.p.legL, 0.34), 0, 0, k);
      if (pick(h.p.legR, 0.34) >= 0) h.rot(pick(h.p.legR, 0.34), 0, 0, -k);
      h.rotAll([pick(h.p.legL, 0.72), pick(h.p.legR, 0.72)].filter((i) => i >= 0), -0.9, 0, 0);
      h.rotChain(h.p.armL, 0.3, -0.4, 0, 0);
      h.rotChain(h.p.armR, 0.3, -0.4, 0, 0);
    },
  },

  /* --------------------------------------------------------------- Partner */
  /*
   * Paired presets — two bodies, one act. `step` drives the model already on the
   * stage (the "bottom"); `partner.step` drives the duplicated body (the "top"),
   * and `partner.place` seats it relative to the bottom's HIPS: `pos` is
   * [x, y, z] as a fraction of the model size and `face` turns it (-1 = face the
   * bottom, 1 = face the same way). The Partner system builds the duplicate, seats
   * it, and then frame-locks its phase to this motion's phase, so the driving
   * rhythm and the reactive counter-rhythm can never drift apart — the difference
   * between "two loops" and "two bodies".
   *
   * The animation language is deliberate: the top's hips lead, the bottom answers a
   * fraction of a phase late (secondary action), the torso carries a smaller wave
   * than the hips, and the head/jaw lag again — so the contact reads as one act.
   */
  {
    id: "pair-ride",
    label: "On top — ride",
    category: "Partner",
    desc: "Adult, two bodies: the duplicate straddles the body on stage and rides it, hands braced on her chest.",
    duration: 1.1,
    loop: true,
    step(h, p) {
      // Bottom: flat on her back, hips rocking up into the rider, head tipped back.
      const rock = Math.sin(p * TAU + 0.5);
      poseOnBack(h);
      h.rot(h.p.hips, 0.12 - rock * 0.2, 0, 0);
      h.rot(h.p.chest, -0.12 - rock * 0.06, 0, 0);
      h.rot(h.p.head, 0.26 + rock * 0.1, 0, 0);
    },
    partner: {
      place: { pos: [0, 0.16, 0.06], face: -1 },
      step(h, p) {
        // Top: kneeling straddle — bounce from the hips, torso folding over her.
        const bounce = Math.abs(Math.sin(p * TAU));
        const rock = Math.sin(p * TAU + 0.5);
        poseKneelStraddle(h, { drop: -bounce * 0.09 });
        h.rot(h.p.hips, 0.3 + rock * 0.16, 0, 0);
        h.rotChain(h.p.spine, 0.5, 0.18 + bounce * 0.07, 0, rock * 0.05);
        h.rot(h.p.chest, 0.08, 0, 0);
        h.rot(h.p.head, -0.05 - rock * 0.08, 0, 0);
      },
    },
  },
  {
    id: "pair-grind",
    label: "On top — grind",
    category: "Partner",
    desc: "Adult, two bodies: she straddles and grinds in slow circles, her weight rolling over the hips.",
    duration: 2.6,
    loop: true,
    step(h, p) {
      const s = Math.sin(p * TAU);
      const c = Math.cos(p * TAU);
      poseOnBack(h);
      h.rot(h.p.hips, 0.1 + s * 0.1, c * 0.16, s * 0.12);
      h.rot(h.p.chest, -0.1, c * 0.06, 0);
      h.rot(h.p.head, 0.24, -c * 0.08, 0);
    },
    partner: {
      place: { pos: [0, 0.16, 0.06], face: -1 },
      step(h, p) {
        const s = Math.sin(p * TAU);
        const c = Math.cos(p * TAU);
        poseKneelStraddle(h);
        h.rot(h.p.hips, 0.24 + s * 0.14, c * 0.22, s * 0.18);
        h.move(h.p.root, c * 0.05, Math.abs(s) * 0.02, 0);
        h.rotChain(h.p.spine, 0.5, 0.16, c * 0.12, 0);
        h.rot(h.p.chest, 0.08, c * 0.06, 0);
        h.rot(h.p.head, -0.05 - s * 0.06, -c * 0.06, 0);
      },
    },
  },
  {
    id: "pair-stand",
    label: "From behind — stand",
    category: "Partner",
    desc: "Adult, two bodies: she bends over in front while the duplicate stands behind and drives into her.",
    duration: 1.2,
    loop: true,
    step(h, p) {
      // Bottom: standing, braced forward, taking the driving rhythm in the hips.
      const s = Math.sin(p * TAU);
      poseBendOver(h);
      h.rot(h.p.hips, s * 0.26, 0, 0);
      h.move(h.p.root, 0, 0, s * 0.05);
    },
    partner: {
      place: { pos: [0, 0.02, -0.22], face: 1 },
      step(h, p) {
        // Top: standing behind, hips driving forward and back through the stroke.
        const s = Math.sin(p * TAU);
        poseStandBehind(h, { drive: s });
      },
    },
  },
];


export function getMotion(id) {
  return MOTIONS.find((m) => m.id === id) || null;
}

/* ------------------------------------------------------------- part mapping */

/*
 * Groups a rig's bones into the semantic parts every preset above expects.
 * Purely name/role + bind-pose-side based, so it adapts to arbitrary rigs.
 * Returns null when there is no skeleton.
 */
function buildParts(rig) {
  const n = rig.boneCount;
  if (!n) return null;
  const { classes, parent, bones, names } = rig;
  bones[0].updateWorldMatrix(true, false);
  const wpos = bones.map((b) => new THREE.Vector3().setFromMatrixPosition(b.matrixWorld));

  const depth = new Array(n);
  for (let i = 0; i < n; i++) {
    let d = 0;
    let p = parent[i];
    while (p >= 0) {
      d++;
      p = parent[p];
      if (d > 500) break;
    }
    depth[i] = d;
  }

  const idx = [];
  for (let i = 0; i < n; i++) idx.push(i);
  const byDepth = (list) => list.slice().sort((a, b) => depth[a] - depth[b]);
  const clsList = (c) => byDepth(idx.filter((i) => classes[i] === c));

  let spine = clsList("spine");
  if (!spine.length) {
    const roots = idx.filter((i) => parent[i] === -1);
    spine = roots.length ? [roots[0]] : [0];
  }
  const headChain = clsList("head");
  const arm = clsList("arm");
  const leg = clsList("leg");

  // Split limbs by bind-pose X relative to the skeleton's centre.
  let cx = 0;
  for (const p of wpos) cx += p.x;
  cx /= n || 1;
  const split = (list) => {
    const l = [];
    const r = [];
    for (const i of list) (wpos[i].x >= cx ? r : l).push(i);
    return { l, r };
  };
  const armSide = split(arm);
  const legSide = split(leg);

  /* A limb chain is polluted by non-deforming helper bones: leaf "…001" extras, the
     individual fingers/toes, and rings of small bones hanging off the forearm/shin.
     `pick(chain, 0.34)` then lands on a fingertip instead of the thigh, which is why a
     naive rig renders every pose as a T-pose. Two filters fix it:
       1. keep only the true PATH — the bones that are actually ancestors of the
          chain's deepest bone (the hand/foot) — which drops every side leaf;
       2. trim at the hand/foot so the chain ends at the wrist/ankle.
     The result runs root → tip over the real limb joints, so a fraction along it hits
     a joint. `jointMap` gives each limb named joints (root/mid/end) so presets can
     address "the thigh" or "the forearm" without counting bones. */
  const pathOf = (list) => {
    if (!list.length) return list;
    let deepest = list[0];
    for (const i of list) if (depth[i] > depth[deepest]) deepest = i;
    const onPath = new Set();
    let i = deepest;
    while (i >= 0) {
      onPath.add(i);
      i = parent[i];
      if (onPath.size > 600) break;
    }
    const path = list.filter((j) => onPath.has(j));
    return path.length >= 2 ? path : list;
  };
  const trimAt = (list, re) => {
    const i = list.findIndex((j) => re.test(names[j] || ""));
    const core = i > 0 ? list.slice(0, i) : list.slice();
    return core.length >= 2 ? core : list;
  };
  const limbCore = (list, re) => trimAt(pathOf(list), re);

  // Robust fallback: if a side came out empty (a centred rig), give both sides
  // the same chain so presets still move something.
  const armRe = /hand|wrist|palm|finger|thumb|index|middle|ring|pinky|claw/i;
  const legRe = /foot|ankle|toe|heel|sole/i;
  const armL = limbCore(armSide.l.length ? armSide.l : arm, armRe);
  const armR = limbCore(armSide.r.length ? armSide.r : arm, armRe);
  const legL = limbCore(legSide.l.length ? legSide.l : leg, legRe);
  const legR = limbCore(legSide.r.length ? legSide.r : leg, legRe);

  const hips = firstOf(spine);
  const chest = spine.length > 1 ? spine[Math.max(1, spine.length - 1)] : firstOf(spine);
  const head = lastOf(headChain) >= 0 ? lastOf(headChain) : chest;
  const root = idx.find((i) => parent[i] === -1);

  /* Named joints along a limb core: root = hip/shoulder attachment, mid = the upper
     segment (thigh / upper arm), end = the lower segment (shin-knee / forearm-elbow).
     Rotating `mid` swings the whole limb from the hip/shoulder; rotating `end` flexes
     the knee/elbow. */
  const limb = (core) => {
    const n = core.length;
    if (!n) return { root: -1, mid: -1, end: -1, list: core };
    const at = (f) => core[Math.max(0, Math.min(n - 1, Math.round((n - 1) * f)))];
    return { root: core[0], mid: at(0.45), end: core[n - 1], list: core };
  };

  return {
    all: idx,
    root: root >= 0 ? root : hips,
    spine,
    hips,
    chest,
    head,
    armL,
    armR,
    legL,
    legR,
    arms: [armL, armR],
    legs: [legL, legR],
    jointMap: {
      armL: limb(armL),
      armR: limb(armR),
      legL: limb(legL),
      legR: limb(legR),
    },
  };
}

/* -------------------------------------------------------------- the layer */

/*
 * createMotionLayer({ getRig })
 *   .setRig(rig)        – (re)build parts from the current skeleton (call on load)
 *   .play(id)           – start a preset by id (stops any clip / authored timeline)
 *   .stop()             – release the rig
 *   .update(dt)         – advance + apply; call once per frame AFTER the mixer
 *   state: motion, playing, phase, time
 */
export function createMotionLayer({ getRig } = {}) {
  let rig = null;
  let parts = null;
  let motion = null;
  let loop = true;
  let speed = 1;
  let playing = false;
  let phase = 0;
  let time = 0;

  // bind snapshot
  let bindQ = [];
  let bindPos = [];
  let bindScale = [];
  let bindWorld = [];
  let invBindWorld = [];
  let invParentWorld = [];

  const acc = new Map(); // boneIndex -> world-space delta quaternion
  const moveAcc = new Map(); // boneIndex -> world-space offset (Vector3)
  const _e = new THREE.Euler();
  const _q = new THREE.Quaternion();

  function release() {
    parts = null;
    motion = null;
    playing = false;
    phase = 0;
    time = 0;
    bindQ = [];
  }

  function setRig(next) {
    rig = next || null;
    release();
    if (!rig) return null;
    const bones = rig.bones;
    const n = rig.boneCount;
    bones[0].updateWorldMatrix(true, false);
    bindQ = bones.map((b) => b.quaternion.clone().normalize());
    bindPos = bones.map((b) => b.position.clone());
    bindScale = bones.map((b) => b.scale.clone());
    /* Normalise: setFromRotationMatrix does not, and a scaled matrixWorld (very
       common after normalising an imported model) would give a non-unit bind
       quaternion — which silently turns every later slerp into a no-op. */
    bindWorld = bones.map((b) => new THREE.Quaternion().setFromRotationMatrix(b.matrixWorld).normalize());
    invBindWorld = bindWorld.map((q) => q.clone().invert());
    invParentWorld = bones.map((b, i) => {
      const p = rig.parent[i];
      if (p >= 0) return bindWorld[p].clone().invert();
      return new THREE.Quaternion();
    });
    parts = buildParts(rig);
    return parts;
  }

  function rot(i, x, y, z) {
    if (i < 0) return;
    _e.set(x || 0, y || 0, z || 0, "XYZ");
    _q.setFromEuler(_e);
    const cur = acc.get(i);
    if (cur) cur.multiply(_q);
    else acc.set(i, _q.clone());
  }

  function rotAll(list, x, y, z) {
    if (!list) return;
    for (const i of list) rot(i, x, y, z);
  }

  function rotChain(list, t, x, y, z) {
    rot(pick(list, t), x, y, z);
  }

  function move(i, x, y, z) {
    if (i < 0) return;
    let v = moveAcc.get(i);
    if (!v) {
      v = new THREE.Vector3();
      moveAcc.set(i, v);
    }
    v.x += x || 0;
    v.y += y || 0;
    v.z += z || 0;
  }

  /* `joint(key, which, x,y,z)` rotates a NAMED joint of a limb: which ∈ {root, mid,
     end} — mid = thigh/upper-arm, end = shin-forearm (the knee/elbow). `bone(key)`
     returns the whole joint triple for anything that needs the raw indices. */
  function joint(key, which, x, y, z) {
    const j = parts && parts.jointMap && parts.jointMap[key];
    if (!j) return;
    const i = j[which];
    rot(i == null ? -1 : i, x, y, z);
  }

  const h = {
    rot,
    rotAll,
    rotChain,
    move,
    joint,
    bone(key) {
      return (parts && parts.jointMap && parts.jointMap[key]) || null;
    },
    get p() {
      return parts;
    },
  };

  /* Apply one frame of the current motion (or the bind pose when none). */
  function commit() {
    if (!rig) return;
    acc.clear();
    moveAcc.clear();
    if (motion && parts) motion.step(h, phase);

    const bones = rig.bones;
    const n = rig.boneCount;
    const tmp = new THREE.Quaternion();
    for (let i = 0; i < n; i++) {
      const d = acc.get(i);
      if (d) {
        tmp.copy(invBindWorld[i]).multiply(d).multiply(bindWorld[i]);
        bones[i].quaternion.copy(bindQ[i]).multiply(tmp);
      } else {
        bones[i].quaternion.copy(bindQ[i]);
      }
      const mv = moveAcc.get(i);
      if (mv) {
        const local = mv.clone().applyQuaternion(invParentWorld[i]);
        bones[i].position.copy(bindPos[i]).add(local);
      } else {
        bones[i].position.copy(bindPos[i]);
      }
      if (bindScale[i]) bones[i].scale.copy(bindScale[i]);
    }
    rig.updateSkeleton && rig.updateSkeleton();
  }

  function play(id) {
    const m = getMotion(id);
    if (!m) return false;
    if (!rig || !parts) return false;
    motion = m;
    loop = m.loop !== false;
    phase = 0;
    time = 0;
    playing = true;
    // Stop anything else that drives the pose so the motion is unambiguous.
    try {
      rig.stopClip();
    } catch (e) {
      /* ignore */
    }
    commit();
    return true;
  }

  /* Start a motion object supplied directly (rather than looked up by id) — used by
     the Partner system to drive a second rig with a preset's `partner.step`. Keeps
     the same phase clock contract as play(), so two layers started together stay
     frame-locked (both advance by the same dt over the same duration). */
  function playMotion(raw) {
    if (!raw || typeof raw.step !== "function") return false;
    if (!rig || !parts) return false;
    motion = raw;
    loop = raw.loop !== false;
    phase = raw.phase != null ? raw.phase : 0;
    time = 0;
    playing = raw.playing !== false;
    try {
      rig.stopClip();
    } catch (e) {
      /* ignore */
    }
    commit();
    return true;
  }

  function stop() {
    const wasActive = !!motion;
    motion = null;
    playing = false;
    acc.clear();
    moveAcc.clear();
    if (rig && wasActive) {
      rig.resetPose && rig.resetPose();
      rig.updateSkeleton && rig.updateSkeleton();
    }
    return wasActive;
  }

  function setPlaying(on) {
    playing = !!on;
  }

  /* Force the phase (0→1) — lets a caller re-lock a follower layer to a leader. */
  function setPhase(p) {
    phase = Math.max(0, Number(p) || 0);
    commit();
  }

  /* Pose the rig directly from a spec of world-axis euler deltas (radians) keyed
     by bone index: { rot: {index:[x,y,z]}, move: {index:[x,y,z]} }. Used by the
     AI animation generator to turn one authored keyframe into a real pose it can
     capture with anim-author. Leaves the pose applied (call stop() to reset). */
  function applySpec(spec) {
    if (!rig || !parts) return false;
    const step = (hh) => {
      if (!spec) return;
      const r = spec.rot || {};
      for (const k in r) {
        const a = r[k] || [0, 0, 0];
        hh.rot(Number(k), a[0] || 0, a[1] || 0, a[2] || 0);
      }
      const m = spec.move || {};
      for (const k in m) {
        const a = m[k] || [0, 0, 0];
        hh.move(Number(k), a[0] || 0, a[1] || 0, a[2] || 0);
      }
    };
    motion = {
      step,
      id: spec && spec.id ? spec.id : "__spec__",
      duration: spec && spec.duration ? spec.duration : 2,
      loop: false,
    };
    playing = false;
    phase = 0;
    time = 0;
    try {
      rig.stopClip();
    } catch (e) {
      /* ignore */
    }
    commit();
    return true;
  }

  function setSpeed(v) {
    speed = Math.max(0.05, Math.min(4, Number(v) || 1));
  }

  function setLoop(on) {
    loop = !!on;
  }

  function update(dt) {
    if (!motion || !rig) return;
    if (playing) {
      const dur = Math.max(0.05, motion.duration || 2);
      phase += (dt * speed) / dur;
      time += dt * speed;
      if (loop) {
        phase -= Math.floor(phase);
      } else if (phase >= 1) {
        phase = 1;
        playing = false;
      }
    }
    commit();
  }

  return {
    setRig,
    play,
    playMotion,
    stop,
    applySpec,
    setPlaying,
    setPhase,
    setSpeed,
    setLoop,
    update,
    commit,
    get motion() {
      return motion;
    },
    get motionId() {
      return motion ? motion.id : null;
    },
    get playing() {
      return playing;
    },
    get phase() {
      return phase;
    },
    get time() {
      return time;
    },
    get loop() {
      return loop;
    },
    get speed() {
      return speed;
    },
    get parts() {
      return parts;
    },
    get hasRig() {
      return !!rig && !!parts;
    },
  };
}
