// Validation tests for Task #17: Sprite Animation Controller.

import { SpriteAnimation, SpriteAnimationController } from "../engine/animation.js";

export function run() {
  const out = { passed: 0, failed: 0, results: [] };
  const check = (name, ok, extra = "") => {
    out.results.push({ name, ok: !!ok, extra: String(extra) });
    if (ok) out.passed++;
    else out.failed++;
  };

  const ctrl = new SpriteAnimationController({
    defaultAnimation: "idle",
    animations: {
      idle: { frames: [0], fps: 2 },
      walking: { frames: [1, 2, 3, 4], fps: 8 },
      attack: { frames: [5, 6], fps: 4, loop: false },
    },
    stateMap: { idle: "idle", walking: "walking", attack: "attack" },
  });
  check("default animation idle", ctrl.getAnimationName() === "idle" && ctrl.getFrame() === 0);

  ctrl.setState("walking");
  check("walking starts on first frame", ctrl.getAnimationName() === "walking" && ctrl.getFrame() === 1);
  ctrl.update(125);
  check("walking advances frame", ctrl.getFrameIndex() === 1 && ctrl.getFrame() === 2);
  ctrl.update(125);
  ctrl.update(125);
  ctrl.update(125);
  check("walking loops", ctrl.getFrameIndex() === 0 && ctrl.getFrame() === 1);

  ctrl.setAnimation("attack");
  ctrl.update(250);
  ctrl.update(250);
  ctrl.update(250);
  check("non-looping attack holds last frame", ctrl.getFrameIndex() === 1 && ctrl.getFrame() === 6);

  ctrl.setAnimation("idle");
  check("setAnimation resets frame", ctrl.getFrameIndex() === 0 && ctrl.getFrame() === 0);

  const entity = { moving: true };
  ctrl.sync(entity);
  check("sync moving -> walking", ctrl.getAnimationName() === "walking");
  entity.moving = false;
  entity.action = "attack";
  ctrl.sync(entity);
  check("sync attack -> attack", ctrl.getAnimationName() === "attack");
  entity.moving = false;
  entity.action = null;
  ctrl.sync(entity);
  check("sync idle", ctrl.getAnimationName() === "idle");

  ctrl.addAnimation("dance", { frames: [7, 8], fps: 3 });
  ctrl.setAnimation("dance");
  check("addAnimation works", ctrl.getFrame() === 7);
  ctrl.update(400);
  check("dance advances", ctrl.getFrame() === 8);
  ctrl.reset();
  check("reset clears frame", ctrl.getFrameIndex() === 0 && ctrl.getFrame() === 7);

  ctrl.setAnimation("nope");
  check("unknown animation is safe", ctrl.getAnimationName() === "nope" && ctrl.getFrame() === 0);

  const anim = new SpriteAnimation({ name: "x", frames: [9], fps: 1 });
  check("SpriteAnimation fields", anim.name === "x" && anim.frames[0] === 9 && anim.loop === true);

  return out;
}
