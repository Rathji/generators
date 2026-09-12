import * as THREE from "https://esm.sh/three@0.160.0";

const CELL = 18;

export class Player {
  constructor({ camera, footprints, grounds, radius, config }){
    this.camera = camera;
    this.config = config;
    this.radius = radius;
    this.pos = new THREE.Vector3(0, config.eyeHeight, 0);
    this.yaw = 0;
    this.pitch = 0;
    this.bob = 0;
    this.colRadius = 0.55;
    this.vel = new THREE.Vector3();
    this.joy = { active: false, dx: 0, dy: 0 };
    this.frozen = false;

    // raised walkable platforms (steps, daises)
    this.grounds = grounds || [];
    this.groundY = 0;

    // spatial hash of collision footprints
    this.cell = CELL;
    this.grid = new Map();
    this.list = footprints;
    for (let i = 0; i < footprints.length; i++){
      const f = footprints[i];
      const minx = Math.floor((f.x - f.hw - f.hd) / CELL) - 1;
      const maxx = Math.floor((f.x + f.hw + f.hd) / CELL) + 1;
      const minz = Math.floor((f.z - f.hw - f.hd) / CELL) - 1;
      const maxz = Math.floor((f.z + f.hw + f.hd) / CELL) + 1;
      for (let gx = minx; gx <= maxx; gx++){
        for (let gz = minz; gz <= maxz; gz++){
          const k = gx + "," + gz;
          let arr = this.grid.get(k);
          if (!arr){ arr = []; this.grid.set(k, arr); }
          arr.push(i);
        }
      }
    }
  }

  setPosition(x, z, yaw){
    this.pos.set(x, this.config.eyeHeight, z);
    this.yaw = yaw;
    this.pitch = 0;
    this.groundY = this.groundHeightAt(x, z);
    this.pos.y = this.config.eyeHeight + this.groundY;
  }

  groundHeightAt(x, z){
    let h = 0;
    for (let i = 0; i < this.grounds.length; i++){
      const g = this.grounds[i];
      if (g.r){
        if ((x - g.x) * (x - g.x) + (z - g.z) * (z - g.z) <= g.r * g.r) h = Math.max(h, g.h);
        continue;
      }
      const dx = x - g.x, dz = z - g.z;
      const lx = g.c * dx - g.s * dz;
      const lz = g.s * dx + g.c * dz;
      if (Math.abs(lx) <= g.hw && Math.abs(lz) <= g.hd) h = Math.max(h, g.h);
    }
    return h;
  }

  look(dx, dy){
    const s = 0.0022;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    const lim = Math.PI / 2 - 0.05;
    this.pitch = Math.max(-lim, Math.min(lim, this.pitch));
  }

  collide(x, z){
    const r = this.colRadius;
    for (let iter = 0; iter < 4; iter++){
      let moved = false;
      const gx = Math.floor(x / CELL), gz = Math.floor(z / CELL);
      for (let ix = -1; ix <= 1; ix++){
        for (let iz = -1; iz <= 1; iz++){
          const arr = this.grid.get((gx + ix) + "," + (gz + iz));
          if (!arr) continue;
          for (const idx of arr){
            const f = this.list[idx];
            const dx = x - f.x, dz = z - f.z;
            const lx = f.c * dx - f.s * dz;
            const lz = f.s * dx + f.c * dz;
            if (Math.abs(lx) > f.hw + r + 1 || Math.abs(lz) > f.hd + r + 1) continue;
            const cx = Math.max(-f.hw, Math.min(f.hw, lx));
            const cz = Math.max(-f.hd, Math.min(f.hd, lz));
            let ddx = lx - cx, ddz = lz - cz;
            const d2 = ddx * ddx + ddz * ddz;
            if (d2 >= r * r) continue;
            let nlx, nlz;
            if (d2 > 1e-8){
              const d = Math.sqrt(d2);
              const push = (r - d) / d;
              nlx = ddx * push; nlz = ddz * push;
            } else {
              const penX = f.hw - Math.abs(lx) + r;
              const penZ = f.hd - Math.abs(lz) + r;
              if (penX < penZ){ nlx = Math.sign(lx || 1) * penX; nlz = 0; }
              else { nlz = Math.sign(lz || 1) * penZ; nlx = 0; }
            }
            x += f.c * nlx + f.s * nlz;
            z += -f.s * nlx + f.c * nlz;
            moved = true;
          }
        }
      }
      if (!moved) break;
    }
    return [x, z];
  }

  update(dt, keys){
    const c = this.config;
    let fx = 0, fz = 0;
    if (keys.forward) fz -= 1;
    if (keys.back) fz += 1;
    if (keys.left) fx -= 1;
    if (keys.right) fx += 1;
    if (!this.frozen && this.joy.active){ fx += this.joy.dx; fz += this.joy.dy; }

    const mag = Math.hypot(fx, fz);
    let speed = 0;
    if (mag > 0.01){
      fx /= mag; fz /= mag;
      speed = (keys.sprint ? c.sprintSpeed : c.walkSpeed) * Math.min(1, mag);
    }

    // yaw rotation of movement
    const cy = Math.cos(this.yaw), sy = Math.sin(this.yaw);
    const wx = fx * cy + fz * sy;
    const wz = -fx * sy + fz * cy;

    let nx = this.pos.x + wx * speed * dt;
    let nz = this.pos.z + wz * speed * dt;
    [nx, nz] = this.collide(nx, nz);

    // keep inside the walls
    const rr = Math.hypot(nx, nz);
    const maxR = this.radius - 3;
    if (rr > maxR){ nx = (nx / rr) * maxR; nz = (nz / rr) * maxR; }

    this.pos.x = nx; this.pos.z = nz;

    // follow raised ground (steps, daises) smoothly
    const gh = this.groundHeightAt(nx, nz);
    this.groundY += (gh - this.groundY) * Math.min(1, dt * 9);
    if (Math.abs(gh - this.groundY) < 0.01) this.groundY = gh;
    this.pos.y = c.eyeHeight + this.groundY;

    // head bob
    if (speed > 0.1){
      this.bob += dt * (keys.sprint ? 13 : 9);
    } else {
      this.bob += dt * 2;
    }
    const bobAmp = speed > 0.1 ? (keys.sprint ? 0.07 : 0.045) : 0.012;
    const bobY = Math.sin(this.bob) * bobAmp;
    const bobR = Math.cos(this.bob * 0.5) * bobAmp * 0.25;

    this.camera.position.set(nx, this.pos.y + bobY, nz);
    this.camera.rotation.set(this.pitch, this.yaw, bobR, "YXZ");
  }
}

export function bindControls(canvas, player, { onFirstInput, touchEnabled = false } = {}){
  const keys = { forward: false, back: false, left: false, right: false, sprint: false };
  let locked = false;
  let firstInput = false;
  let touchOn = !!touchEnabled;

  const keyMap = {
    KeyW: "forward", ArrowUp: "forward",
    KeyS: "back", ArrowDown: "back",
    KeyA: "left", ArrowLeft: "left",
    KeyD: "right", ArrowRight: "right",
    ShiftLeft: "sprint", ShiftRight: "sprint",
  };

  function down(e){
    if (keyMap[e.code]){
      keys[keyMap[e.code]] = true;
      if (!firstInput){ firstInput = true; onFirstInput && onFirstInput(); }
    }
  }
  function up(e){ if (keyMap[e.code]) keys[keyMap[e.code]] = false; }
  window.addEventListener("keydown", down);
  window.addEventListener("keyup", up);

  // mouse look via pointer lock
  function onMove(e){
    if (document.pointerLockElement === canvas && e.pointerType === "mouse"){
      player.look(e.movementX || 0, e.movementY || 0);
      if (!firstInput){ firstInput = true; onFirstInput && onFirstInput(); }
    }
  }
  document.addEventListener("mousemove", onMove);

  // touch: left half = move joystick, right half = look drag
  const touches = new Map();
  let lookId = null, moveId = null, moveOrigin = null;
  function clearTouch(){
    moveId = null; lookId = null; moveOrigin = null; touches.clear();
    player.joy.active = false; player.joy.dx = 0; player.joy.dy = 0;
  }
  function tstart(e){
    if (!touchOn) return;
    for (const t of e.changedTouches){
      if (t.clientX < innerWidth * 0.4 && moveId === null){
        moveId = t.identifier; moveOrigin = { x: t.clientX, y: t.clientY };
        player.joy.active = true; player.joy.dx = 0; player.joy.dy = 0;
      } else if (lookId === null){
        lookId = t.identifier; touches.set(t.identifier, { x: t.clientX, y: t.clientY });
      }
    }
  }
  function tmove(e){
    if (!touchOn) return;
    for (const t of e.changedTouches){
      if (t.identifier === lookId){
        const prev = touches.get(t.identifier);
        if (prev && !player.frozen){
          player.look((t.clientX - prev.x) * 0.9, (t.clientY - prev.y) * 0.9);
          prev.x = t.clientX; prev.y = t.clientY;
        }
      } else if (t.identifier === moveId && moveOrigin){
        const dx = (t.clientX - moveOrigin.x) / 60;
        const dy = (t.clientY - moveOrigin.y) / 60;
        const m = Math.hypot(dx, dy);
        const k = m > 1 ? 1 / m : 1;
        player.joy.dx = dx * k; player.joy.dy = dy * k;
      }
      if (!firstInput){ firstInput = true; onFirstInput && onFirstInput(); }
    }
  }
  function tend(e){
    for (const t of e.changedTouches){
      if (t.identifier === moveId){ moveId = null; player.joy.active = false; player.joy.dx = 0; player.joy.dy = 0; }
      if (t.identifier === lookId){ lookId = null; touches.delete(t.identifier); }
    }
  }
  canvas.addEventListener("touchstart", tstart, { passive: true });
  canvas.addEventListener("touchmove", tmove, { passive: true });
  canvas.addEventListener("touchend", tend);
  canvas.addEventListener("touchcancel", tend);

  return {
    keys,
    isLocked: () => document.pointerLockElement === canvas,
    setLocked: (v) => { locked = v; },
    isTouchEnabled: () => touchOn,
    setTouchEnabled: (v) => {
      touchOn = !!v;
      if (!touchOn) clearTouch();
    },
  };
}
