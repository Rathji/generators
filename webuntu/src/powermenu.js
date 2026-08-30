// Webuntu OS — Power menu actions (Phase 3, Task 16)
// Single dispatch for every power action, used by the Start menu's power
// button and the system-bar tray power menu:
//   - lock     -> lock screen (window.OS.lock, Task 4)
//   - restart  -> animated "Restarting Webuntu…" screen, then reload (replays boot)
//   - shutdown -> confirm, then animated "Shutting down Webuntu…" screen + reload
//   - suspend  -> easter egg: dim the screen, click anywhere (or Esc) to wake
// Respects prefers-reduced-motion (shortens the shutdown animation).

(function () {
  "use strict";

  const screenEl  = document.getElementById("powerScreen");
  const labelEl   = document.getElementById("powerLabel");
  const suspendEl = document.getElementById("suspendScreen");

  const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const DURATION = reduce ? 700 : 2000;

  let running = false;

  function showPower(label) {
    if (running) return;
    running = true;
    labelEl.textContent = label;
    screenEl.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => screenEl.classList.add("on")));
    setTimeout(() => { location.reload(); }, DURATION);
  }

  function suspend() {
    if (!suspendEl.hidden) return;
    suspendEl.hidden = false;
  }
  function wake() { suspendEl.hidden = true; }

  function act(action) {
    if (action === "switch-user") { if (window.OS && window.OS.switchUser) window.OS.switchUser(); return; }
    if (action === "lock") { if (window.OS) window.OS.lock(); return; }
    if (action === "restart") { showPower("Restarting Webuntu…"); return; }
    if (action === "shutdown") {
      if (confirm("Shut down Webuntu?")) showPower("Shutting down Webuntu…");
      return;
    }
    if (action === "suspend") { suspend(); return; }
  }

  suspendEl.addEventListener("click", wake);
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && !suspendEl.hidden) wake();
  });

  window.PowerMenu = { act, suspend, wake, showPower };
})();
