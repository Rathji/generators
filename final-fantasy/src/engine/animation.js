// Task #17: Sprite Animation Controller — cycles sprite-sheet frames for
// idle, walking, and combat animations based on entity state.

export class SpriteAnimation {
  constructor(opts = {}) {
    this.name = opts.name;
    this.frames = opts.frames ?? [0];
    this.fps = opts.fps ?? 6;
    this.loop = opts.loop ?? true;
  }
}

export class SpriteAnimationController {
  constructor(opts = {}) {
    this.animations = {};
    this.stateMap = opts.stateMap ?? {};
    this.current = null;
    this.frameIndex = 0;
    this.timer = 0;
    this.currentAnimation = null;
    for (const name in (opts.animations ?? {})) {
      this.addAnimation(name, opts.animations[name]);
    }
    this.setAnimation(opts.defaultAnimation ?? "idle");
  }

  addAnimation(name, anim) {
    this.animations[name] = anim instanceof SpriteAnimation ? anim : new SpriteAnimation({ name, ...anim });
    return this;
  }

  setAnimation(name) {
    if (this.current === name) return this;
    this.current = name;
    this.currentAnimation = this.animations[name] ?? null;
    this.frameIndex = 0;
    this.timer = 0;
    return this;
  }

  setState(state) {
    if (this.stateMap[state]) this.setAnimation(this.stateMap[state]);
    return this;
  }

  // Derive an animation from an entity's current state.
  sync(entity) {
    if (!entity) return this;
    const state =
      entity.action === "attack" ? "attack" : entity.moving ? "walking" : "idle";
    return this.setState(state);
  }

  update(dtMs) {
    const anim = this.currentAnimation;
    if (!anim) return this;
    this.timer += dtMs;
    const frameDuration = 1000 / anim.fps;
    if (this.timer >= frameDuration) {
      const steps = Math.floor(this.timer / frameDuration);
      this.timer %= frameDuration;
      this.frameIndex += steps;
      if (this.frameIndex >= anim.frames.length) {
        if (anim.loop) this.frameIndex %= anim.frames.length;
        else this.frameIndex = anim.frames.length - 1;
      }
    }
    return this;
  }

  getFrame() {
    return this.currentAnimation ? this.currentAnimation.frames[this.frameIndex] : 0;
  }

  getFrameIndex() {
    return this.frameIndex;
  }

  getAnimationName() {
    return this.current;
  }

  reset() {
    this.frameIndex = 0;
    this.timer = 0;
    return this;
  }
}
