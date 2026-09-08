// Webuntu OS — System bar (Phase 3, Task 15)
// The bottom taskbar's extras: a pinned-app launcher, a tray (live clock,
// decorative network/battery icons, a volume popup with slider, and a
// power-menu button). Open-window entries themselves live in the taskbar
// center (Task 11, src/wm.js). The full animated Power menu (shutdown screen,
// suspend easter egg, confirm dialog) is Task 16 — these minimal Lock/Restart/
// Shut Down actions match the Start menu's for now.
//
// Pinned apps are configured in main.pjs (the `pinnedApps` list of app ids).
// Volume is persisted in webuntu.settings so the Music Player (Task 33) and
// UI sounds (Task 27) can read it later.

(function () {
  "use strict";

  const SETTINGS_KEY = "webuntu.settings";

  const pinnedEl   = document.getElementById("pinnedLauncher");
  const volBtn     = document.getElementById("trayVol");
  const volPopup   = document.getElementById("volPopup");
  const volSlider  = document.getElementById("volSlider");
  const volPct     = document.getElementById("volPct");
  const volMuteBtn = document.getElementById("volMute");
  const brightSlider = document.getElementById("brightSlider");
  const brightPct    = document.getElementById("brightPct");
  const nightSlider  = document.getElementById("nightSlider");
  const nightToggle  = document.getElementById("nightToggle");
  const timeEl     = document.getElementById("trayTime");
  const dateEl     = document.getElementById("trayDate");
  const clockBtn   = document.getElementById("trayClock");
  const clockPopup = document.getElementById("clockPopup");
  const clkPrev    = document.getElementById("clkPrev");
  const clkNext    = document.getElementById("clkNext");
  const clkMonthEl = document.getElementById("clkMonth");
  const clkWeekEl  = document.getElementById("clkWeekdays");
  const clkGridEl  = document.getElementById("clkGrid");
  const clkFootEl  = document.getElementById("clkFoot");
  const pwBtn      = document.getElementById("trayPower");
  const pwMenu     = document.getElementById("trayPowerMenu");
  const notifBtn   = document.getElementById("trayBell");
  const notifPanel = document.getElementById("notifPanel");
  const deskBtn    = document.getElementById("trayDesktop");

  const timeFmt = new Intl.DateTimeFormat(undefined, { hour: "2-digit", minute: "2-digit" });
  const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: "short", day: "numeric", month: "short" });

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveSettings(patch) {
    try {
      const s = Object.assign(loadSettings(), patch);
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(s));
    } catch (e) {}
  }

  // ---------- pinned launcher ----------
  let pins = [];
  function loadPins() {
    try { pins = root.pinnedApps.selectAll.map((n) => n.evaluateItem); }
    catch (e) { pins = []; }
  }

  function renderPins() {
    pinnedEl.textContent = "";
    for (const id of pins) {
      const app = window.Apps && window.Apps.getById(id);
      if (!app) continue;
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tb-pin";
      b.dataset.pin = id;
      b.title = app.name + " — " + (app.blurb || "");
      b.setAttribute("aria-label", app.name);
      b.innerHTML = '<span class="tb-pin-ico">' + app.icon + '</span><span class="run-dot"></span>';
      const launch = () => {
        if (window.StartMenu) window.StartMenu.close();
        if (window.Apps) window.Apps.launch(id);
      };
      b.addEventListener("click", launch);
      b.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter" || ev.key === " ") { ev.preventDefault(); launch(); }
      });
      pinnedEl.appendChild(b);
    }
    updatePins();
  }

  // Running = small dot; focused = gradient underline (polled, since windows
  // open/close/focus through src/wm.js with no event bus).
  function updatePins() {
    if (!window.WM) return;
    const focused = window.WM.getFocused ? window.WM.getFocused() : null;
    for (const b of pinnedEl.children) {
      const w = window.WM.findByAppId(b.dataset.pin);
      b.classList.toggle("running", !!w);
      b.classList.toggle("active", !!w && !!focused && w.id === focused.id);
    }
  }
  setInterval(() => { updatePins(); updateShowDesktop(); }, 400);

  // ---------- clock ----------
  function tick() {
    const now = new Date();
    if (timeEl) timeEl.textContent = timeFmt.format(now);
    if (dateEl) dateEl.textContent = dateFmt.format(now);
    if (clockBtn) clockBtn.title = "Webuntu — " + now.toLocaleString();
  }
  tick();
  setInterval(tick, 5000);

  // ---------- clock calendar popup (Task 66) ----------
  // Click the tray clock to open a month-view calendar: prev/next arrows
  // flip months, the month label jumps back to today, out-of-month days
  // navigate the view, and a footer shows today's full date.
  const clkToday = new Date();
  const clkView = { y: clkToday.getFullYear(), m: clkToday.getMonth() };

  function isSameDay(a, b) {
    return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
  }

  function renderWeekdays() {
    if (!clkWeekEl || clkWeekEl.children.length) return;
    const fmt = new Intl.DateTimeFormat(undefined, { weekday: "narrow" });
    for (let i = 0; i < 7; i++) {
      const d = new Date(2026, 0, 4 + i); // 2026-01-04 is a Sunday
      const s = document.createElement("span");
      s.className = "clk-wd";
      s.textContent = fmt.format(d);
      clkWeekEl.appendChild(s);
    }
  }

  function renderCalendar() {
    if (!clkGridEl || !clkMonthEl) return;
    const now = new Date();
    const y = clkView.y, m = clkView.m;
    const monthFmt = new Intl.DateTimeFormat(undefined, { month: "long", year: "numeric" });
    clkMonthEl.textContent = monthFmt.format(new Date(y, m, 1));
    const onCurrent = y === now.getFullYear() && m === now.getMonth();
    clkMonthEl.disabled = onCurrent;
    if (clkPrev) clkPrev.disabled = false;
    if (clkNext) clkNext.disabled = false;
    clkGridEl.textContent = "";
    const firstDow = new Date(y, m, 1).getDay(); // Sunday-first grid
    const gridStart = new Date(y, m, 1 - firstDow);
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart.getFullYear(), gridStart.getMonth(), gridStart.getDate() + i);
      const b = document.createElement("button");
      b.type = "button";
      b.className = "clk-day";
      b.textContent = d.getDate();
      b.setAttribute("aria-label", new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" }).format(d));
      if (d.getMonth() !== m) b.classList.add("out");
      if (isSameDay(d, now)) b.classList.add("today");
      b.addEventListener("click", () => {
        if (d.getMonth() !== m) {
          clkView.y = d.getFullYear();
          clkView.m = d.getMonth();
          renderCalendar();
          if (window.Sounds) window.Sounds.play("ok");
          return;
        }
        if (window.Sounds) window.Sounds.play("open");
        closePopups();
      });
      clkGridEl.appendChild(b);
    }
    if (clkFootEl) {
      const footFmt = new Intl.DateTimeFormat(undefined, { weekday: "long", day: "numeric", month: "long", year: "numeric" });
      clkFootEl.textContent = "Today is " + footFmt.format(now);
    }
  }

  if (clkPrev) clkPrev.addEventListener("click", () => {
    clkView.m--;
    if (clkView.m < 0) { clkView.m = 11; clkView.y--; }
    if (window.Sounds) window.Sounds.play("ok");
    renderCalendar();
  });
  if (clkNext) clkNext.addEventListener("click", () => {
    clkView.m++;
    if (clkView.m > 11) { clkView.m = 0; clkView.y++; }
    if (window.Sounds) window.Sounds.play("ok");
    renderCalendar();
  });
  if (clkMonthEl) clkMonthEl.addEventListener("click", () => {
    const now = new Date();
    clkView.y = now.getFullYear();
    clkView.m = now.getMonth();
    if (window.Sounds) window.Sounds.play("ok");
    renderCalendar();
  });
  renderWeekdays();
  renderCalendar();

  // ---------- volume ----------
  // The slider's feedback blip goes through the shared sound engine
  // (src/sounds.js, Task 27): un-gated by the uiSounds toggle (it IS the
  // volume indicator), scaled by the chosen volume, and never before the
  // first user gesture (autoplay policy).
  function playBlip(vol) {
    if (window.Sounds) window.Sounds.blip(880, 1320, 0.09, vol);
  }

  function renderVol(v) {
    const muted = v <= 0;
    volSlider.value = v;
    volPct.textContent = v + "%";
    volBtn.textContent = muted ? "🔇" : (v < 40 ? "🔉" : "🔊");
    volMuteBtn.textContent = muted ? "🔇" : "🔊";
    volMuteBtn.title = muted ? "Unmute" : "Mute";
  }

  function initVol() {
    let v = Math.round(Number(loadSettings().volume));
    if (!(v >= 0 && v <= 100)) v = 70;
    renderVol(v);
  }
  initVol();

  volSlider.addEventListener("input", () => {
    const v = Math.round(Number(volSlider.value));
    renderVol(v);
    saveSettings({ volume: v });
    if (v > 0) playBlip(v / 100);
  });
  volMuteBtn.addEventListener("click", () => {
    const cur = Number(volSlider.value);
    if (cur > 0) {
      renderVol(0);
      saveSettings({ volume: 0 });
    } else {
      renderVol(70);
      saveSettings({ volume: 70 });
      playBlip(0.7);
    }
  });

  // ---------- display quick controls (Task 69) ----------
  // Brightness + night light, mirroring Control Center → Display. Brightness
  // dims a full-screen overlay; night light warms the screen. The intensity
  // slider is disabled until night light is switched on (its value is still
  // remembered). Values always re-sync from window.Display when the popup
  // opens, so the two UIs stay in step.
  function syncDisplayControls() {
    if (!window.Display || !brightSlider) return;
    const b = Math.round(window.Display.getBrightness());
    brightSlider.value = b;
    brightPct.textContent = b + "%";
    const on = window.Display.getNightLight();
    nightSlider.value = Math.round(window.Display.getNightIntensity());
    nightSlider.disabled = !on;
    nightToggle.classList.toggle("on", on);
    nightToggle.setAttribute("aria-checked", String(on));
    nightToggle.textContent = on ? "On" : "Off";
    nightToggle.title = on ? "Turn night light off" : "Turn night light on";
  }

  if (brightSlider) {
    brightSlider.addEventListener("input", () => {
      const v = Math.round(Number(brightSlider.value));
      brightPct.textContent = v + "%";
      if (window.Display) window.Display.setBrightness(v);
    });
  }
  if (nightSlider) {
    nightSlider.addEventListener("input", () => {
      const v = Math.round(Number(nightSlider.value));
      if (window.Display) window.Display.setNightIntensity(v);
    });
  }
  if (nightToggle) {
    nightToggle.addEventListener("click", () => {
      if (!window.Display) return;
      window.Display.setNightLight(!window.Display.getNightLight());
      syncDisplayControls();
      if (window.Sounds) window.Sounds.play("ok");
    });
  }
  syncDisplayControls();

  // ---------- show desktop (Task 75) ----------
  // The far-right peek strip mirrors WM.toggleShowDesktop: it hides every
  // window on the current desktop and restores them on a second click. Its
  // state is polled with the pin dots so Super+D in shortcuts.js (which never
  // touches this module) keeps the button's highlight in sync.
  function updateShowDesktop() {
    if (!deskBtn) return;
    deskBtn.classList.toggle("active",
      !!(window.WM && window.WM.isShowDesktopActive && window.WM.isShowDesktopActive()));
  }
  if (deskBtn) {
    deskBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      if (window.OS && window.OS.isLocked) return;
      if (window.WM && window.WM.toggleShowDesktop) window.WM.toggleShowDesktop();
      updateShowDesktop();
    });
  }

  // ---------- tray popups ----------
  function closePopups() {
    volPopup.hidden = true;
    pwMenu.hidden = true;
    if (clockPopup) clockPopup.hidden = true;
    if (notifPanel) notifPanel.hidden = true;
    volBtn.classList.remove("active");
    pwBtn.classList.remove("active");
    if (clockBtn) clockBtn.classList.remove("active");
    if (notifBtn) notifBtn.classList.remove("active");
  }

  function openClock() {
    if (window.StartMenu) window.StartMenu.close();
    closePopups();
    if (!clockPopup) return;
    clockPopup.hidden = false;
    if (clockBtn) clockBtn.classList.add("active");
    renderCalendar();
  }

  function openVol() {
    if (window.StartMenu) window.StartMenu.close();
    closePopups();
    volPopup.hidden = false;
    volBtn.classList.add("active");
    syncDisplayControls();
    volSlider.focus();
  }

  function openPower() {
    if (window.StartMenu) window.StartMenu.close();
    closePopups();
    pwMenu.hidden = false;
    pwBtn.classList.add("active");
    const first = pwMenu.querySelector("button");
    if (first) first.focus();
  }

  // Power actions — dispatched through the unified PowerMenu (Task 16).
  function doPower(action) {
    closePopups();
    if (window.PowerMenu) window.PowerMenu.act(action);
  }

  volBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (volPopup.hidden) openVol(); else closePopups();
  });
  pwBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (pwMenu.hidden) openPower(); else closePopups();
  });
  if (clockBtn) clockBtn.addEventListener("click", (ev) => {
    ev.stopPropagation();
    if (clockPopup && clockPopup.hidden) openClock(); else closePopups();
  });
  pwMenu.addEventListener("click", (ev) => {
    const b = ev.target.closest("button[data-pw]");
    if (b) doPower(b.dataset.pw);
  });

  document.addEventListener("mousedown", (ev) => {
    if (volPopup.hidden && pwMenu.hidden && notifPanel.hidden && (!clockPopup || clockPopup.hidden)) return;
    if (ev.target.closest("#volPopup") || ev.target.closest("#trayVol")) return;
    if (ev.target.closest("#trayPowerMenu") || ev.target.closest("#trayPower")) return;
    if (ev.target.closest("#clockPopup") || ev.target.closest("#trayClock")) return;
    if (ev.target.closest("#notifPanel") || ev.target.closest("#trayBell")) return;
    closePopups();
  });
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape") closePopups();
  });

  window.SystemBar = {
    closePopups,
    refreshPins: () => { loadPins(); renderPins(); },
  };

  loadPins();
  renderPins();
})();
