// 00-core.js — canvas, game loop, input, shared helpers
(function () {
  "use strict";

  const W = 720, H = 480;
  const cv = document.getElementById("game");
  const ctx = cv.getContext("2d");
  ctx.imageSmoothingEnabled = false;

  const SE = window.SE = {
    W, H, cv, ctx,
    GRAV: 0.075,          // px/frame^2
    MAXV: 8.2,            // px/frame at 100 power
    WIND_K: 0.0012,       // wind accel scale (wind in -10..10 m/s)
    state: "title",       // title | setup | battle
    audioOn: true,
    input: { down: {}, pressed: {} },
    shake: 0,
    battle: null,
    battleGen: 0,
    ui: null, ent: null, terrain: null, ai: null, audio: null,
  };

  SE.$ = (id) => document.getElementById(id);
  SE.rand = (a, b) => a + Math.random() * (b - a);
  SE.ri = (a, b) => Math.floor(SE.rand(a, b + 1));
  SE.clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  SE.sleep = (ms) => new Promise((r) => setTimeout(r, ms));
  SE.banner = (t, c) => SE.ui && SE.ui.banner(t, c);
  SE.sfx = (n, o) => SE.audio && SE.audio.play(n, o);
  SE.esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

  // keyboard
  const down = SE.input.down, pressed = SE.input.pressed;
  const PREVENT = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Space", "KeyA", "KeyD", "KeyW", "KeyS", "KeyQ", "KeyE", "BracketLeft", "BracketRight", "Enter"];
  window.addEventListener("keydown", (e) => {
    if (PREVENT.includes(e.code)) e.preventDefault();
    if (!down[e.code]) pressed[e.code] = true;
    down[e.code] = true;
  });
  window.addEventListener("keyup", (e) => { down[e.code] = false; });
  window.addEventListener("blur", () => { for (const k in down) down[k] = false; });

  // game loop
  let last = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000 || 0);
    last = now;
    if (SE.state === "battle" && SE.battle && !SE.battle.paused && SE.ent) {
      SE.ent.update(dt);
    }
    if (SE.ent) SE.ent.render();
    for (const k in pressed) pressed[k] = false;
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
})();
