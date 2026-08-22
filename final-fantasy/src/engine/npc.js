// Task #12: NPC Pathing & Idle Behaviors — stationary NPCs that idle in
// place, or patrolling NPCs that step between set waypoints.

export class NpcController {
  constructor(sys, entity, behavior = {}, opts = {}) {
    this.sys = sys;
    this.entity = entity;
    this.behavior = behavior;
    this.random = opts.random ?? Math.random;
    this.waypoints = behavior.waypoints ? [...behavior.waypoints] : [];
    this.targetIndex = 0;
    this.waitTicks = 0;
    this.stepsTaken = 0;
  }

  _randomDir() {
    const dirs = ["N", "S", "E", "W"];
    return dirs[Math.floor(this.random() * dirs.length)];
  }

  _stepToward(target) {
    const dx = target.x - this.entity.x;
    const dy = target.y - this.entity.y;
    if (dx === 0 && dy === 0) return null;
    if (Math.abs(dx) >= Math.abs(dy)) return dx > 0 ? "E" : "W";
    return dy > 0 ? "S" : "N";
  }

  // Advance one tick. Returns the direction actually moved, or null.
  update() {
    const b = this.behavior;
    if (this.waitTicks > 0) {
      this.waitTicks -= 1;
      return null;
    }
    if (b.type === "stationary" || !this.waypoints.length) {
      if (b.type === "stationary" && b.idleTurning !== false) {
        this.entity.facing = this._randomDir();
      }
      return null;
    }
    if (b.type === "patrol") {
      const target = this.waypoints[this.targetIndex];
      if (this.entity.x === target.x && this.entity.y === target.y) {
        this.targetIndex = (this.targetIndex + 1) % this.waypoints.length;
        this.waitTicks = b.pauseAtWaypoint ?? 0;
        return null;
      }
      const dir = this._stepToward(target);
      if (dir && this.sys.move(this.entity, dir)) {
        this.stepsTaken += 1;
        return dir;
      }
      this.entity.facing = dir ?? this.entity.facing;
      return null;
    }
    return null;
  }

  setWaypoints(waypoints) {
    this.waypoints = [...waypoints];
    this.targetIndex = 0;
  }
}
