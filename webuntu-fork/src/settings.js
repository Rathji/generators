// Webuntu OS — Control Center (Phase 5, Task 23)
// A windowed Settings app with sidebar sections: Appearance (theme, accent,
// text size, reduce motion, wallpaper), Personalization (desktop icons,
// taskbar position), Sound (UI sounds), System (About, storage, reset).
// Every option applies instantly and persists in webuntu.settings.
//
// The app registers itself as the content builder for the "settings" catalog
// entry (apps.js consults window.AppContent), so Apps.launch("settings") opens
// this real windowed app instead of the stub/coming-soon window.
//
// Accent + text-size live in src/theme.js / index.html tokens; the accent
// swatch polish is Task 24 and the wallpaper picker (built-ins + custom URL)
// is Task 25 — the picker UI lives in src/wallpapers.js and is reused here.

(function () {
  "use strict";

  const SETTINGS_KEY = "webuntu.settings";
  const ACCENT_SWATCHES = ["#7c6cff", "#22d3ee", "#ec4899", "#22c55e", "#f59e0b"];
  const TEXT_SIZES = [
    { value: "s", label: "Small",  scale: "0.9"  },
    { value: "m", label: "Medium", scale: null   },
    { value: "l", label: "Large",  scale: "1.15" },
  ];

  let uiSoundsEnabled = false;
  let devTimer = null; // Developer view's system-monitor ticker (Task 86)

  function loadSettings() {
    try { return JSON.parse(localStorage.getItem(SETTINGS_KEY) || "{}"); }
    catch (e) { return {}; }
  }
  function saveSettings(patch) {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(Object.assign(loadSettings(), patch)));
    } catch (e) {}
  }

  // ---------- DOM helpers ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function row(title, desc, control) {
    const r = el("div", "set-row");
    const info = el("div", "set-row-info");
    info.appendChild(el("h4", null, title));
    if (desc) info.appendChild(el("p", null, desc));
    r.appendChild(info);
    const ctl = el("div", "set-row-ctl");
    ctl.appendChild(control);
    r.appendChild(ctl);
    return r;
  }
  function segmented(options, selected, onPick) {
    const wrap = el("div", "set-seg");
    for (const o of options) {
      const b = el("button", "set-seg-btn" + (o.value === selected ? " sel" : ""), o.label);
      b.type = "button";
      b.dataset.value = o.value;
      b.addEventListener("click", () => onPick(o.value));
      wrap.appendChild(b);
    }
    return wrap;
  }
  function makeToggle(checked, onChange) {
    const b = el("button", "set-switch" + (checked ? " on" : ""));
    b.type = "button";
    b.setAttribute("role", "switch");
    b.setAttribute("aria-checked", String(checked));
    b.innerHTML = '<span class="set-switch-knob"></span>';
    b.addEventListener("click", () => {
      const next = !b.classList.contains("on");
      b.classList.toggle("on", next);
      b.setAttribute("aria-checked", String(next));
      onChange(next);
    });
    return b;
  }

  let audioCtx = null;
  // Short WebAudio blip — the uiSounds toggle's enable preview is played via
  // the shared sound engine (src/sounds.js, Task 27); this local fallback only
  // exists if that engine failed to load. Fires on a click, so autoplay is
  // satisfied either way.
  function previewBlip(freqA, freqB, dur) {
    if (window.Sounds) { window.Sounds.play("notify"); return; }
    try {
      if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
      if (audioCtx.state === "suspended") audioCtx.resume();
      const t = audioCtx.currentTime;
      const osc = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      osc.type = "sine";
      osc.frequency.setValueAtTime(freqA, t);
      osc.frequency.exponentialRampToValueAtTime(freqB, t + dur);
      g.gain.setValueAtTime(0.25, t);
      g.gain.exponentialRampToValueAtTime(0.001, t + dur);
      osc.connect(g);
      g.connect(audioCtx.destination);
      osc.start(t);
      osc.stop(t + dur + 0.02);
    } catch (e) {}
  }

  // ---------- applying settings (instant + persistent) ----------
  function applyTextSize(size) {
    const html = document.documentElement;
    const valid = size === "s" || size === "l";
    if (valid) html.setAttribute("data-text-size", size);
    else html.removeAttribute("data-text-size");
  }
  function applyReduceMotion(on) {
    document.documentElement.classList.toggle("reduce-motion", !!on);
  }
  function applyTaskbar(pos) {
    const html = document.documentElement;
    if (pos === "top") html.setAttribute("data-taskbar", "top");
    else html.removeAttribute("data-taskbar");
    if (window.WM && window.WM.layout) window.WM.layout();
  }
  function applyDesktopIcons(visible) {
    if (window.Desktop && window.Desktop.setIconsVisible) window.Desktop.setIconsVisible(visible, false);
  }
  function applyAccent(hex) {
    if (window.Theme && window.Theme.setAccent) window.Theme.setAccent(hex, false);
  }

  // Re-apply every stored setting to the live page (boot, after Reset, and
  // when the app re-opens). Values come from storage; nothing is written here.
  function applyAll() {
    const s = loadSettings();
    applyTextSize(s.textSize);
    applyReduceMotion(s.reduceMotion);
    applyTaskbar(s.taskbar);
    applyDesktopIcons(s.desktopIcons === undefined ? true : !!s.desktopIcons);
    applyAccent(s.accent || null);
    uiSoundsEnabled = !!s.uiSounds;
    if (window.Display && window.Display.applyAll) window.Display.applyAll();
    if (window.Desktop && window.Desktop.getIconsVisible) {
      // setIconsVisible(false) above already toggled the DOM class; confirm.
      applyDesktopIcons(window.Desktop.getIconsVisible());
    }
  }

  // ---------- app window ----------
  let rootEl = null;
  let mainEl = null;
  let navBtns = null;
  let activeSec = "appearance";

  function distroInfo() {
    try {
      const d = root.distro;
      return {
        name: d.name.evaluateItem,
        codename: d.codename.evaluateItem,
        version: d.version.evaluateItem,
        basedOn: d.basedOn.evaluateItem,
        desktopEnv: d.desktopEnv.evaluateItem,
        kernel: d.kernel.evaluateItem,
        shell: d.shell.evaluateItem,
      };
    } catch (e) {
      return { name: "Webuntu", codename: "Perch Mint", version: "12", basedOn: "Debian 12",
               desktopEnv: "Perch Desktop", kernel: "6.8.0-perch-mint", shell: "Perch Shell" };
    }
  }

  function wallpaperStatus() {
    if (!window.Desktop) return "Radial Glow (default)";
    const w = window.Desktop.getWallpaper();
    if (!w) return "Radial Glow (default)";
    if (window.Desktop.isBuiltin) {
      const b = (window.Desktop.WALLPAPERS || []).find((x) => x.name === w);
      if (b) return b.label + " (built-in)";
    }
    if (/^(https?:|data:|blob:)/i.test(w)) return "Custom image";
    return "Custom wallpaper";
  }

  function card(title) {
    const c = el("div", "set-card");
    if (title) c.appendChild(el("h3", "set-card-title", title));
    return c;
  }

  function renderSection(name) {
    if (devTimer) { clearInterval(devTimer); devTimer = null; }
    mainEl.textContent = "";
    const set = loadSettings();
    activeSec = name;

    if (name === "appearance") {
      const cTheme = card("Theme");
      cTheme.appendChild(row(
        "Appearance",
        "Dark is the Rathji signature; Light flips every token in place.",
        segmented([{ value: "dark", label: "Dark" }, { value: "light", label: "Light" }],
          (window.Theme ? window.Theme.current : "dark"), (v) => { window.Theme.apply(v); })
      ));

      const cAccent = card("Accent color");
      const accWrap = el("div", "set-acc");
      const swatchRow = el("div", "set-swatches");
      const currentAccent = (window.Theme ? window.Theme.getAccent() : null) || "#7c6cff";
      for (const hex of ACCENT_SWATCHES) {
        const b = el("button", "set-swatch" + (hex === currentAccent ? " sel" : ""));
        b.type = "button";
        b.style.background = hex;
        b.title = hex;
        b.dataset.hex = hex;
        b.addEventListener("click", () => { window.Theme.setAccent(hex); renderSection("appearance"); });
        if (hex === currentAccent) b.textContent = "✓";
        swatchRow.appendChild(b);
      }
      const custom = el("div", "set-acc-custom");
      const hexInput = el("input", "set-input");
      hexInput.type = "text";
      hexInput.placeholder = "#rrggbb";
      hexInput.value = /^#[0-9a-f]{6}$/i.test(currentAccent) && !ACCENT_SWATCHES.includes(currentAccent.toLowerCase())
        ? currentAccent : "";
      hexInput.maxLength = 7;
      hexInput.addEventListener("keydown", (ev) => {
        if (ev.key === "Enter") {
          const hex = hexInput.value.trim();
          if (/^#[0-9a-f]{6}$/i.test(hex)) { window.Theme.setAccent(hex.toLowerCase()); renderSection("appearance"); }
        }
      });
      const applyBtn = el("button", "set-btn", "Apply");
      applyBtn.type = "button";
      applyBtn.addEventListener("click", () => {
        const hex = hexInput.value.trim();
        if (/^#[0-9a-f]{6}$/i.test(hex)) { window.Theme.setAccent(hex.toLowerCase()); renderSection("appearance"); }
      });
      const resetBtn = el("button", "set-btn", "Default");
      resetBtn.type = "button";
      resetBtn.addEventListener("click", () => { window.Theme.setAccent(null); renderSection("appearance"); });
      custom.append(hexInput, applyBtn, resetBtn);
      accWrap.append(swatchRow, custom);
      cAccent.appendChild(row("Accent color", "Rathji presets, or any hex. Applies to windows, taskbar, menus and apps.", accWrap));

      const cText = card("Text size");
      cText.appendChild(row(
        "Text size",
        "Scales the OS chrome and app text.",
        segmented(TEXT_SIZES.map((t) => ({ value: t.value, label: t.label })),
          set.textSize || "m", (v) => { applyTextSize(v); saveSettings({ textSize: v }); renderSection("appearance"); })
      ));

      const cMotion = card("Motion");
      cMotion.appendChild(row(
        "Reduce motion",
        "Disables animations and transitions across the desktop.",
        makeToggle(!!set.reduceMotion, (on) => { applyReduceMotion(on); saveSettings({ reduceMotion: on }); })
      ));

      const cWall = card("Wallpaper");
      const wallCtl = el("div", "set-wall");
      wallCtl.appendChild(el("div", "set-wall-status", "Currently: " + wallpaperStatus() + "."));
      const thumbs = (window.Wallpapers && window.Wallpapers.thumbnailsRow)
        ? window.Wallpapers.thumbnailsRow(() => renderSection("appearance"))
        : el("p", "set-note", "Wallpapers unavailable.");
      wallCtl.appendChild(thumbs);
      const urlRow = el("div", "set-wall-url");
      const urlInput = el("input", "set-input");
      urlInput.type = "text";
      urlInput.placeholder = "Paste an image URL…";
      urlInput.maxLength = 500;
      const urlBtn = el("button", "set-btn", "Apply");
      urlBtn.type = "button";
      const applyUrl = () => {
        const v = urlInput.value.trim();
        if (/^(https?:|data:|blob:)/i.test(v) && window.Desktop) {
          window.Desktop.setWallpaper(v);
          renderSection("appearance");
        }
      };
      urlBtn.addEventListener("click", applyUrl);
      urlInput.addEventListener("keydown", (ev) => { if (ev.key === "Enter") applyUrl(); });
      urlRow.append(urlInput, urlBtn);
      wallCtl.appendChild(urlRow);
      const clearBtn = el("button", "set-btn", "Reset to default");
      clearBtn.type = "button";
      clearBtn.disabled = !window.Desktop || !window.Desktop.getWallpaper();
      clearBtn.addEventListener("click", () => {
        if (window.Desktop && window.Desktop.clearWallpaper) window.Desktop.clearWallpaper();
        renderSection("appearance");
      });
      wallCtl.appendChild(clearBtn);
      const randBtn = el("button", "set-btn", "Random");
      randBtn.type = "button";
      randBtn.title = "Pick a random built-in wallpaper";
      randBtn.addEventListener("click", () => {
        if (window.Wallpapers && window.Wallpapers.shuffle) {
          window.Wallpapers.shuffle();
          renderSection("appearance");
        }
      });
      wallCtl.appendChild(randBtn);
      cWall.appendChild(row("Wallpaper", "Built-in Rathji wallpapers, or paste any image URL.", wallCtl));

      mainEl.append(cTheme, cAccent, cText, cMotion, cWall);
    }

    else if (name === "display") {
      const disp = window.Display || null;

      const cBright = card("Brightness");
      const brightWrap = el("div", "set-slider-row");
      const brightSlider = el("input", "set-slider");
      brightSlider.type = "range";
      brightSlider.min = "5"; brightSlider.max = "100"; brightSlider.step = "1";
      brightSlider.value = String(disp ? disp.getBrightness() : 100);
      const brightVal = el("span", "set-slider-val", brightSlider.value + "%");
      brightSlider.addEventListener("input", () => {
        const v = Math.round(Number(brightSlider.value));
        brightVal.textContent = v + "%";
        if (disp) disp.setBrightness(v);
      });
      brightWrap.append(brightSlider, brightVal);
      cBright.appendChild(row("Brightness", "Dims or brightens the entire screen — windows, menus and all.", brightWrap));

      const nightOn = !!(disp && disp.getNightLight());
      const cNight = card("Night light");
      cNight.appendChild(row(
        "Night light",
        "A warm orange tint that eases blue light in the evening.",
        makeToggle(nightOn, (on) => { if (disp) disp.setNightLight(on); renderSection("display"); })
      ));

      const cNightInt = card("Night light intensity");
      const nightWrap = el("div", "set-slider-row");
      const nightSlider = el("input", "set-slider");
      nightSlider.type = "range";
      nightSlider.min = "0"; nightSlider.max = "100"; nightSlider.step = "1";
      nightSlider.value = String(disp ? disp.getNightIntensity() : 50);
      const nightVal = el("span", "set-slider-val", nightSlider.value + "%");
      nightSlider.disabled = !nightOn;
      nightSlider.addEventListener("input", () => {
        const v = Math.round(Number(nightSlider.value));
        nightVal.textContent = v + "%";
        if (disp) disp.setNightIntensity(v);
      });
      nightWrap.append(nightSlider, nightVal);
      cNightInt.appendChild(row("Intensity", "How strong the warm tint is.", nightWrap));

      mainEl.append(cBright, cNight, cNightInt);
    }

    else if (name === "personalization") {
      const cIcons = card("Desktop");
      cIcons.appendChild(row(
        "Show desktop icons",
        "Hides or shows the icon grid on the desktop.",
        makeToggle(set.desktopIcons === undefined ? true : !!set.desktopIcons, (on) => {
          applyDesktopIcons(on);
          saveSettings({ desktopIcons: on });
        })
      ));

      const cBar = card("Taskbar");
      cBar.appendChild(row(
        "Taskbar position",
        "Dock the taskbar and Start menu to the bottom or top edge.",
        segmented([{ value: "bottom", label: "Bottom" }, { value: "top", label: "Top" }],
          set.taskbar || "bottom", (v) => { applyTaskbar(v); saveSettings({ taskbar: v }); renderSection("personalization"); })
      ));

      mainEl.append(cIcons, cBar);

      const wsCount = (window.Workspaces && window.Workspaces.count) || 4;
      const cWs = card("Workspaces");
      cWs.appendChild(row(
        "Number of desktops",
        "Virtual desktops you can switch between (pager chips in the taskbar, Ctrl+Alt+arrows). Windows stay on the desktop where you opened them.",
        segmented([1, 2, 3, 4, 5, 6].map((n) => ({ value: String(n), label: String(n) })),
          String(wsCount), (v) => {
            if (window.Workspaces) window.Workspaces.setCount(Number(v));
            renderSection("personalization");
          })
      ));
      mainEl.append(cWs);
    }

    else if (name === "sound") {
      const c = card("Sound");
      c.appendChild(row(
        "UI sounds",
        "Subtle sounds for opening, closing and errors. Off by default — plays only after an interaction.",
        makeToggle(!!set.uiSounds, (on) => {
          uiSoundsEnabled = on;
          saveSettings({ uiSounds: on });
          if (on) previewBlip(660, 990, 0.12);
        })
      ));
      mainEl.append(c);

      const themes = (window.Sounds && window.Sounds.themes) || [];
      if (themes.length) {
        const cTheme = card("Sound theme");
        const cur = themes.some(t => t.id === set.soundTheme) ? set.soundTheme : "default";
        const grid = el("div", "set-theme-grid");
        const chips = [];
        for (const t of themes) {
          const chip = el("button", "set-theme-chip" + (t.id === cur ? " sel" : ""));
          chip.type = "button";
          chip.dataset.theme = t.id;
          chip.appendChild(el("b", null, t.name));
          chip.appendChild(el("small", null, t.desc));
          chip.addEventListener("click", () => {
            saveSettings({ soundTheme: t.id });
            for (const c2 of chips) c2.classList.toggle("sel", c2 === chip);
            if (window.Sounds) window.Sounds.preview(t.id);
          });
          chips.push(chip);
          grid.appendChild(chip);
        }
        cTheme.appendChild(grid);
        mainEl.append(cTheme);
      }
    }

    else if (name === "notifications") {
      const c = card("Notifications");
      c.appendChild(row(
        "Show notifications",
        "Transient toast popups from apps (chat, games…). The tray bell and its center keep a record either way.",
        makeToggle(set.uiNotifications !== false, (on) => saveSettings({ uiNotifications: on }))
      ));
      c.appendChild(row(
        "Notification sounds",
        "A small blip when a notification pops up. Independent of UI sounds.",
        makeToggle(set.notifySounds !== false, (on) => saveSettings({ notifySounds: on }))
      ));
      mainEl.append(c);
    }

    else if (name === "users") {
      const current = (window.OS && window.OS.currentUser) || null;
      const infos = (window.OS && window.OS.accountsInfo) ? window.OS.accountsInfo() : [];

      const cMe = card("Your account");
      const meBox = el("div", "set-user-prof");
      const av = el("div", "set-user-avatar", current ? window.OS.avatar(current) : "👤");
      const ptxt = el("div", "set-user-txt");
      ptxt.appendChild(el("b", null, current ? window.OS.displayName(current) : "Not signed in"));
      ptxt.appendChild(el("small", null, (current ? current + "@" : "") + "webuntu"));
      meBox.append(av, ptxt);
      const meBtns = el("div", "set-row-btns");
      const editBtn = el("button", "set-btn", "Edit profile…");
      editBtn.type = "button";
      editBtn.disabled = !current;
      editBtn.addEventListener("click", () => current && openEditor(current));
      const pwBtn = el("button", "set-btn", "Change password…");
      pwBtn.type = "button";
      pwBtn.disabled = !current;
      pwBtn.addEventListener("click", () => current && openEditor(current));
      meBtns.append(editBtn, pwBtn);
      meBox.appendChild(meBtns);
      cMe.appendChild(meBox);

      const cAccts = card("Accounts");
      const note = el("p", "set-note", "Each account signs in with its own username and password. The desktop, files and settings are shared between accounts.");
      cAccts.appendChild(note);
      const list = el("div", "set-user-list");
      const delErr = el("div", "set-error", "");
      for (const a of infos) {
        const it = el("div", "set-user-item" + (a.username === current ? " cur" : ""));
        const iav = el("div", "set-user-avatar small", a.avatar);
        const itxt = el("div", "set-user-txt");
        itxt.appendChild(el("b", null, a.displayName));
        itxt.appendChild(el("small", null, a.username + "@webuntu" + (a.username === current ? " · you" : "")));
        it.append(iav, itxt);
        const ibtns = el("div", "set-row-btns");
        const iEdit = el("button", "set-btn", "Edit");
        iEdit.type = "button";
        iEdit.addEventListener("click", () => openEditor(a.username));
        const iDel = el("button", "set-btn danger", "Delete");
        iDel.type = "button";
        iDel.disabled = infos.length <= 1;
        iDel.title = infos.length <= 1 ? "Keep at least one account" : "Delete this account";
        iDel.addEventListener("click", () => {
          if (!window.confirm("Delete the account \"" + a.username + "\"? You can create it again later.")) return;
          const res = window.OS.deleteAccount(a.username);
          if (res.error) { delErr.textContent = res.error; return; }
          delErr.textContent = "";
          if (res.selfDeleted) { window.OS.switchUser(); return; }
          renderSection("users");
        });
        ibtns.append(iEdit, iDel);
        it.appendChild(ibtns);
        list.appendChild(it);
      }
      cAccts.appendChild(list);
      cAccts.appendChild(delErr);
      const addBtn = el("button", "set-btn", "+ Add account");
      addBtn.type = "button";
      addBtn.addEventListener("click", () => openAddAccount());
      const acts = el("div", "set-card-actions");
      acts.appendChild(addBtn);
      cAccts.appendChild(acts);

      mainEl.append(cMe, cAccts);
    }

    else if (name === "system") {
      const info = distroInfo();
      const cAbout = card("About");
      const about = el("div", "set-about");
      const logo = el("div", "set-about-logo", "W");
      const lines = el("div", "set-about-lines");
      const pairs = [
        ["OS", `${info.name} ${info.version} "${info.codename}"`],
        ["Based on", info.basedOn],
        ["Desktop Environment", info.desktopEnv],
        ["Kernel", info.kernel],
        ["Default Shell", info.shell],
      ];
      for (const [k, v] of pairs) {
        const ln = el("div", "set-about-line");
        ln.appendChild(el("span", "set-about-k", k));
        ln.appendChild(el("span", "set-about-v", v));
        lines.appendChild(ln);
      }
      about.append(logo, lines);
      cAbout.appendChild(about);

      const cStore = card("Storage");
      const storeTxt = el("p", "set-note", (window.FSPersist && window.FSPersist.note) ? window.FSPersist.note() : "Storage status unavailable.");
      cStore.appendChild(storeTxt);

      const cReset = card("Reset");
      const resetCtl = el("div", "set-reset");
      const resetBtn = el("button", "set-btn danger", "Reset desktop…");
      resetBtn.type = "button";
      resetBtn.addEventListener("click", () => {
        if (window.confirm("Reset Webuntu to its default desktop? Your files, shortcuts, wallpaper and settings for this account will be wiped.")) {
          if (window.FSPersist && window.FSPersist.resetDesktop) window.FSPersist.resetDesktop();
          else { applyAll(); }
          renderSection("system");
          if (window.WM && window.WM.layout) window.WM.layout();
        }
      });
      const resetNote = el("p", "set-note", "Restores the default desktop icons, wallpaper and all settings. Your account stays signed in.");
      resetCtl.append(resetBtn, resetNote);
      cReset.appendChild(resetCtl);

      mainEl.append(cAbout, cStore, cReset);
    }

    else if (name === "developer") {
      // Task 86 — Dev dashboard: live status tiles, today's tasks, weather,
      // uploads summary, a mini system-monitor graph and quick AI prompts.
      const d = new Date();
      const cStatus = card("Status");
      const tiles = el("div", "set-dev-tiles");
      const mkTile = (ico, lbl, val) => {
        const t = el("div", "set-dev-tile");
        t.append(el("span", "set-dev-tile-ico", ico), el("span", "set-dev-tile-lbl", lbl), el("span", "set-dev-tile-val", val));
        return t;
      };
      const tToday = mkTile("📅", "Today", d.toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" }));
      const tOnline = mkTile("🌐", "Online", "—");
      const tUploads = mkTile("📤", "Session uploads", uploadsDevSummary());
      const tWins = mkTile("🪟", "Open windows", "—");
      tiles.append(tToday, tOnline, tUploads, tWins);
      cStatus.appendChild(tiles);
      mainEl.appendChild(cStatus);

      const cTasks = card("Today's tasks");
      const taskBody = el("div", "set-dev-tasks");
      taskBody.appendChild(el("div", "set-note", "Loading…"));
      cTasks.appendChild(taskBody);
      const taskActs = el("div", "set-card-actions");
      const openProjects = el("button", "set-btn", "Open Projects");
      openProjects.type = "button";
      openProjects.addEventListener("click", () => { if (window.Apps) window.Apps.launch("projects"); });
      taskActs.appendChild(openProjects);
      cTasks.appendChild(taskActs);
      mainEl.appendChild(cTasks);
      devTasksFill(taskBody);

      const cWx = card("Weather");
      const wxBody = el("div", "set-dev-wx");
      cWx.appendChild(wxBody);
      const wxActs = el("div", "set-card-actions");
      const openWx = el("button", "set-btn", "Open Weather");
      openWx.type = "button";
      openWx.addEventListener("click", () => { if (window.Apps) window.Apps.launch("weather"); });
      wxActs.appendChild(openWx);
      cWx.appendChild(wxActs);
      mainEl.appendChild(cWx);
      devWeatherFill(wxBody);

      const cMon = card("System activity");
      cMon.appendChild(el("p", "set-note", "Fictional machine stats for the Webuntu VM — updates live."));
      cMon.appendChild(devMon(tOnline, tWins));
      mainEl.appendChild(cMon);

      const cAi = card("Quick AI");
      cAi.appendChild(el("p", "set-note", "One-click AI using the desktop Assistant's model. Results stream below."));
      cAi.appendChild(devQuickAi());
      mainEl.appendChild(cAi);
    }

    for (const b of navBtns) b.classList.toggle("active", b.dataset.sec === name);
  }

  // ---------- Developer section helpers (Task 86) ----------
  const WX_CODES = {
    0: { label: "Clear sky", emoji: "☀️" }, 1: { label: "Mostly clear", emoji: "🌤️" },
    2: { label: "Partly cloudy", emoji: "⛅" }, 3: { label: "Overcast", emoji: "☁️" },
    45: { label: "Fog", emoji: "🌫️" }, 48: { label: "Rime fog", emoji: "🌫️" },
    51: { label: "Light drizzle", emoji: "🌦️" }, 53: { label: "Drizzle", emoji: "🌦️" }, 55: { label: "Heavy drizzle", emoji: "🌧️" },
    61: { label: "Light rain", emoji: "🌦️" }, 63: { label: "Rain", emoji: "🌧️" }, 65: { label: "Heavy rain", emoji: "🌧️" },
    71: { label: "Light snow", emoji: "🌨️" }, 73: { label: "Snow", emoji: "🌨️" }, 75: { label: "Heavy snow", emoji: "❄️" },
    80: { label: "Light showers", emoji: "🌦️" }, 81: { label: "Showers", emoji: "🌦️" }, 82: { label: "Heavy showers", emoji: "🌧️" },
    85: { label: "Snow showers", emoji: "🌨️" }, 86: { label: "Snow showers", emoji: "🌨️" },
    95: { label: "Thunderstorm", emoji: "⛈️" }, 96: { label: "Thunder + hail", emoji: "⛈️" }, 99: { label: "Thunder + hail", emoji: "⛈️" },
  };
  function fmtUptimeDev(ms) {
    const s = Math.max(0, Math.floor((ms || 0) / 1000));
    const hh = String(Math.floor(s / 3600)).padStart(2, "0");
    const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
    const ss = String(s % 60).padStart(2, "0");
    return hh + ":" + mm + ":" + ss;
  }
  function uploadsDevSummary() {
    const q = window.Uploads ? window.Uploads.quota : null;
    if (!q) return "—";
    const bytes = q.uploadedBytes || 0;
    const n = q.count || 0;
    const units = ["B", "KB", "MB"];
    let v = bytes, u = 0;
    while (v >= 1024 && u < units.length - 1) { v /= 1024; u++; }
    return n + (n === 1 ? " file · " : " files · ") + (v >= 10 || u === 0 ? v.toFixed(0) : v.toFixed(1)) + " " + units[u];
  }
  async function collectOpenTasks() {
    if (!window.Projects) return [];
    try {
      const projects = await window.Projects.listProjects() || {};
      const lines = [];
      for (const id of Object.keys(projects)) {
        const tasks = await window.Projects.loadTasks(id);
        for (const t of tasks.filter((x) => x.status === "todo" || x.status === "doing")) {
          lines.push((projects[id].name || "?") + ": " + t.title + (t.status === "doing" ? " (in progress)" : ""));
        }
      }
      return lines.slice(0, 15);
    } catch (e) { return []; }
  }
  async function devTasksFill(body) {
    try {
      if (!window.Projects) { body.textContent = ""; body.appendChild(el("div", "set-note", "Projects module unavailable.")); return; }
      const projects = await window.Projects.listProjects();
      if (!body.isConnected) return;
      const ids = Object.keys(projects || {});
      if (!ids.length) { body.textContent = ""; body.appendChild(el("div", "set-note", "No projects yet — create one in the Projects app.")); return; }
      const rows = [];
      for (const id of ids) {
        const tasks = await window.Projects.loadTasks(id);
        if (!body.isConnected) return;
        const todo = tasks.filter((t) => t.status === "todo").length;
        const doing = tasks.filter((t) => t.status === "doing").length;
        if (todo + doing) rows.push({ p: projects[id], todo, doing });
      }
      body.textContent = "";
      if (!rows.length) {
        body.appendChild(el("div", "set-note", "All caught up — no open tasks across " + ids.length + " project" + (ids.length === 1 ? "" : "s") + "."));
        return;
      }
      for (const r of rows) {
        const ln = el("div", "set-dev-task");
        ln.append(el("span", "set-dev-task-ico", r.p.icon || "📁"), el("span", "set-dev-task-name", r.p.name));
        const cnt = el("span", "set-dev-task-cnt", r.todo + " to do · " + r.doing + " doing");
        if (r.doing) cnt.classList.add("hot");
        ln.appendChild(cnt);
        body.appendChild(ln);
      }
      let best = null;
      for (const id of ids) {
        const n = await window.Projects.nextTask(id);
        if (!body.isConnected) return;
        if (n && n.task && (!best || (n.reason === "in progress" && best.reason !== "in progress"))) best = n;
      }
      if (best) {
        const row = el("div", "set-dev-next");
        row.append(
          el("span", "set-dev-next-ico", best.reason === "in progress" ? "🔥" : "🎯"),
          el("span", "set-dev-next-txt", "Next: " + ((projects[best.project] && projects[best.project].name) ? projects[best.project].name + " — " : "") + best.task.title)
        );
        const done = el("button", "set-btn", "✓ Done");
        done.type = "button";
        done.addEventListener("click", async () => {
          try { await window.Projects.setStatus(best.project, best.task.id, "done"); } catch (e) {}
          if (!body.isConnected) return;
          body.textContent = "";
          body.appendChild(el("div", "set-note", "Marked \" " + best.task.title + "\" done."));
          devTasksFill(body);
        });
        row.appendChild(done);
        body.appendChild(row);
      }
    } catch (e) {
      if (!body.isConnected) return;
      body.textContent = "";
      body.appendChild(el("div", "set-note", "Couldn't load projects."));
    }
  }
  function devWeatherFill(wxBody) {
    wxBody.textContent = "";
    try {
      const set = JSON.parse(localStorage.getItem("webuntu.settings") || "{}");
      const city = (set.weatherCity && set.weatherCity.name) ? set.weatherCity : { name: "London", country: "UK" };
      const unit = set.tempUnit === "f" ? "F" : "C";
      const cache = JSON.parse(localStorage.getItem("webuntu.weather.cache") || "null");
      const cur = cache && cache.data && cache.data.current ? cache.data.current : null;
      if (!cur || cur.temperature_2m == null) {
        wxBody.appendChild(el("div", "set-note", "No cached forecast for " + city.name + " — open the Weather app to fetch one."));
        return;
      }
      const info = WX_CODES[cur.weather_code] || { label: "Forecast", emoji: "🌐" };
      const deg = Math.round(Number(cur.temperature_2m)) + "°" + unit;
      const feel = Math.round(Number(cur.apparent_temperature)) + "°";
      const when = cache.at ? new Date(cache.at).toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" }) : "";
      const ln = el("div", "set-dev-wx-line");
      ln.append(el("span", "set-dev-wx-ico", info.emoji), el("span", "set-dev-wx-txt", city.name + " · " + deg + " (" + info.label + "), feels " + feel), el("span", "set-dev-wx-when", when ? "cached " + when : ""));
      wxBody.appendChild(ln);
    } catch (e) {
      wxBody.appendChild(el("div", "set-note", "Weather unavailable."));
    }
  }
  function devLine(ctx, hist, color, W, H) {
    if (hist.length < 2) return;
    ctx.strokeStyle = color;
    ctx.lineWidth = 2;
    ctx.lineJoin = "round";
    ctx.beginPath();
    const step = W / 59;
    hist.forEach((v, i) => {
      const x = W - (hist.length - 1 - i) * step;
      const y = H - 2 - (Math.min(100, v) / 100) * (H - 6);
      if (i === 0) ctx.moveTo(x, y); else ctx.lineTo(x, y);
    });
    ctx.stroke();
  }
  function devMon(tOnline, tWins) {
    const wrap = el("div", "set-mon");
    const canvas = el("canvas", "set-mon-canvas");
    canvas.width = 320; canvas.height = 72;
    const meta = el("div", "set-mon-meta");
    const cpuB = el("b", "", "—");
    const ramB = el("b", "", "—");
    const upB = el("b", "", "—");
    const winB = el("b", "", "—");
    meta.append(el("span", "", "CPU "), cpuB, el("span", "", " · RAM "), ramB, el("span", "", " · up "), upB, el("span", "", " · "), winB, el("span", "", " windows"));
    wrap.append(canvas, meta);
    const cpuHist = [], ramHist = [];
    // Pre-seed ~2 minutes of history so the graph is alive the moment the
    // view opens (each snapshot() walks the same fictional model forward).
    for (let i = 0; i < 60; i++) {
      const s0 = window.SystemMonitor ? window.SystemMonitor.snapshot() : null;
      cpuHist.push(s0 ? s0.cpu : 0);
      ramHist.push(s0 ? (s0.ram / (s0.ramTotal || 8)) * 100 : 0);
    }
    function tick() {
      const s = window.SystemMonitor ? window.SystemMonitor.snapshot() : { cpu: 0, ram: 2, ramTotal: 8, uptimeMs: 0, windows: 0 };
      cpuHist.push(s.cpu); if (cpuHist.length > 60) cpuHist.shift();
      ramHist.push((s.ram / (s.ramTotal || 8)) * 100); if (ramHist.length > 60) ramHist.shift();
      const ctx = canvas.getContext("2d");
      const W = canvas.width, H = canvas.height;
      ctx.clearRect(0, 0, W, H);
      ctx.strokeStyle = "rgba(148,163,184,.14)";
      ctx.lineWidth = 1;
      for (let i = 1; i < 4; i++) {
        ctx.beginPath(); ctx.moveTo(0, (H * i) / 4); ctx.lineTo(W, (H * i) / 4); ctx.stroke();
      }
      devLine(ctx, cpuHist, "#22d3ee", W, H);
      devLine(ctx, ramHist, "#8b5cf6", W, H);
      cpuB.textContent = s.cpu + "%";
      ramB.textContent = s.ram.toFixed(1) + " / " + s.ramTotal.toFixed(0) + " GB";
      upB.textContent = fmtUptimeDev(s.uptimeMs);
      winB.textContent = s.windows;
      if (tOnline && tOnline.isConnected) {
        const n = window.Net ? window.Net.onlineCount : 0;
        tOnline.lastChild.textContent = n > 0 ? n + (n === 1 ? " user" : " users") : (window.Net && window.Net.status === "online" ? "online" : "offline");
      }
      if (tWins && tWins.isConnected) tWins.lastChild.textContent = s.windows;
    }
    tick();
    devTimer = setInterval(tick, 2000);
    return wrap;
  }
  function devQuickAi() {
    const wrap = el("div", "set-dev-ai");
    const chips = el("div", "set-dev-ai-chips");
    const out = el("pre", "set-dev-ai-out");
    const inputRow = el("div", "set-dev-ai-row");
    const input = el("input", "set-input");
    input.type = "text";
    input.placeholder = "Ask anything…";
    input.style.width = "100%";
    const btn = el("button", "set-btn", "Run");
    btn.type = "button";
    inputRow.append(input, btn);
    wrap.append(chips, inputRow, out);

    let cur = null;
    function stop() {
      if (cur && typeof cur.stop === "function") { try { cur.stop(); } catch (e) {} }
      cur = null;
      btn.textContent = "Run";
    }
    async function run(prompt) {
      const gen = window.root && window.root.generateText;
      if (typeof gen !== "function") { out.textContent = "The AI text plugin isn't loaded."; return; }
      stop();
      const finalPrompt = String(prompt == null ? "" : prompt).trim();
      if (!finalPrompt) { input.focus(); return; }
      btn.textContent = "Stop";
      out.textContent = "";
      out.classList.add("busy");
      const wait = el("span", "set-dev-ai-wait", "✨ thinking…");
      out.appendChild(wait);
      try {
        cur = gen({
          instruction: finalPrompt,
          onChunk: (d) => {
            if (!out.isConnected) return;
            if (wait.isConnected) wait.remove();
            const t = d && d.textChunk != null ? String(d.textChunk) : "";
            if (t) { out.textContent += t; out.scrollTop = out.scrollHeight; }
          },
        });
        await cur;
      } catch (e) {
        if (out.isConnected) {
          if (wait.isConnected) wait.remove();
          out.textContent += "\n[error] " + ((e && e.message) || "stopped");
        }
      } finally {
        if (out.isConnected) out.classList.remove("busy");
        btn.textContent = "Run";
        cur = null;
      }
    }

    const presets = [
      ["🎯", "Today's focus", "planFocus"],
      ["💡", "Brainstorm", "You're building a browser-based desktop OS. Give three fresh feature ideas, each with a one-line pitch."],
      ["✍️", "Draft email", "Write a short, friendly, professional email that I can send right away."],
    ];
    for (const [ico, label, prompt] of presets) {
      const b = el("button", "set-dev-ai-chip", ico + " " + label);
      b.type = "button";
      b.addEventListener("click", async () => {
        let p = prompt;
        if (p === "planFocus") {
          p = "Suggest the single most important task to focus on today and why, in two short sentences.";
          const tasks = await collectOpenTasks();
          if (tasks && tasks.length) p = "My open tasks:\n" + tasks.map((t) => "- " + t).join("\n") + "\n\n" + p;
        }
        run(p);
      });
      chips.appendChild(b);
    }
    btn.addEventListener("click", () => { cur ? stop() : run(input.value); });
    input.addEventListener("keydown", (ev) => { if (ev.key === "Enter") run(input.value); });
    return wrap;
  }

  // ---------- Users section helpers (Task 62) ----------
  function avatarPicker(selected, onPick) {
    const wrap = el("div", "set-avatar-grid");
    const choices = (window.OS && window.OS.avatarChoices) ? window.OS.avatarChoices : ["🦊", "🐼", "🦉", "🚀"];
    for (const a of choices) {
      const b = el("button", "set-avatar-chip" + (a === selected ? " sel" : ""), a);
      b.type = "button";
      b.title = a;
      b.addEventListener("click", () => {
        for (const c of wrap.querySelectorAll(".set-avatar-chip")) c.classList.toggle("sel", c === b);
        onPick(a);
      });
      wrap.appendChild(b);
    }
    return wrap;
  }

  function openEditor(username) {
    const info = (window.OS && window.OS.accountsInfo ? window.OS.accountsInfo().find((x) => x.username === username) : null);
    if (!info || !window.OS.updateAccount) { renderSection("users"); return; }
    const current = (window.OS && window.OS.currentUser) || null;
    mainEl.textContent = "";
    const head = el("div", "set-user-ed-head");
    const back = el("button", "set-btn", "← Back");
    back.type = "button";
    back.addEventListener("click", () => renderSection("users"));
    head.append(back, el("b", "set-ed-title", "Edit account — " + info.username));
    mainEl.appendChild(head);

    const cProf = card("Profile");
    const form = el("div", "set-user-ed");
    form.appendChild(el("label", "set-label", "Display name"));
    const nameInput = el("input", "set-input");
    nameInput.type = "text";
    nameInput.placeholder = "Display name";
    nameInput.maxLength = 30;
    nameInput.value = info.displayName === info.username ? "" : info.displayName;
    form.appendChild(nameInput);
    form.appendChild(el("label", "set-label", "Avatar"));
    let chosen = info.avatar;
    form.appendChild(avatarPicker(chosen, (a) => { chosen = a; }));
    const err = el("div", "set-error", "");
    const save = el("button", "set-btn", "Save");
    save.type = "button";
    save.addEventListener("click", async () => {
      const res = await window.OS.updateAccount(info.username, { displayName: nameInput.value.trim(), avatar: chosen });
      if (res.error) { err.textContent = res.error; return; }
      renderSection("users");
    });
    form.append(err, save);
    cProf.appendChild(form);
    mainEl.appendChild(cProf);

    if (info.username === current) {
      const cPw = card("Change password");
      const pwForm = el("div", "set-user-ed");
      const pw1 = el("input", "set-input");
      pw1.type = "password";
      pw1.placeholder = "New password (min 4 chars)";
      const pw2 = el("input", "set-input");
      pw2.type = "password";
      pw2.placeholder = "Confirm new password";
      const pwErr = el("div", "set-error", "");
      const pwOk = el("div", "set-note-ok", "");
      const pwSave = el("button", "set-btn", "Set password");
      pwSave.type = "button";
      pwSave.addEventListener("click", async () => {
        pwErr.textContent = "";
        pwOk.textContent = "";
        if (pw1.value !== pw2.value) { pwErr.textContent = "Passwords don't match."; return; }
        const res = await window.OS.updateAccount(info.username, { password: pw1.value });
        if (res.error) { pwErr.textContent = res.error; return; }
        pw1.value = ""; pw2.value = "";
        pwOk.textContent = "Password updated.";
      });
      pwForm.append(pw1, pw2, pwErr, pwOk, pwSave);
      cPw.appendChild(pwForm);
      mainEl.appendChild(cPw);
    }
  }

  function openAddAccount() {
    mainEl.textContent = "";
    const head = el("div", "set-user-ed-head");
    const back = el("button", "set-btn", "← Back");
    back.type = "button";
    back.addEventListener("click", () => renderSection("users"));
    head.append(back, el("b", "set-ed-title", "Add an account"));
    mainEl.appendChild(head);

    const c = card("New account");
    const form = el("div", "set-user-ed");
    form.appendChild(el("label", "set-label", "Username (3–20 letters/numbers/._-)"));
    const uInput = el("input", "set-input");
    uInput.type = "text";
    uInput.placeholder = "e.g. jane";
    uInput.spellcheck = false;
    uInput.autocapitalize = "off";
    form.appendChild(uInput);
    form.appendChild(el("label", "set-label", "Display name (optional)"));
    const dInput = el("input", "set-input");
    dInput.type = "text";
    dInput.placeholder = "Jane";
    form.appendChild(dInput);
    form.appendChild(el("label", "set-label", "Password"));
    const p1 = el("input", "set-input");
    p1.type = "password";
    p1.placeholder = "Password (min 4 chars)";
    const p2 = el("input", "set-input");
    p2.type = "password";
    p2.placeholder = "Confirm password";
    form.append(p1, p2);
    const err = el("div", "set-error", "");
    const create = el("button", "set-btn", "Create account");
    create.type = "button";
    create.addEventListener("click", async () => {
      err.textContent = "";
      if (p1.value !== p2.value) { err.textContent = "Passwords don't match."; return; }
      const res = await window.OS.createAccount(uInput.value.trim(), dInput.value.trim(), p1.value);
      if (res.error) { err.textContent = res.error; return; }
      renderSection("users");
    });
    form.append(err, create);
    c.appendChild(form);
    mainEl.appendChild(c);
  }

  function buildApp() {
    rootEl = el("div", "set");
    const side = el("aside", "set-side");
    const head = el("div", "set-side-head");
    const logo = el("div", "set-side-logo", "W");
    const headTxt = el("div", "set-side-txt");
    headTxt.appendChild(el("b", null, "Control Center"));
    headTxt.appendChild(el("small", null, "Webuntu 12"));
    head.append(logo, headTxt);

    const nav = el("nav", "set-nav");
    navBtns = [];
    const sections = [
      ["appearance", "🎨", "Appearance"],
      ["display", "🌓", "Display"],
      ["personalization", "🧩", "Personalization"],
      ["sound", "🔊", "Sound"],
      ["notifications", "🔔", "Notifications"],
      ["developer", "🛠️", "Developer"],
      ["users", "👥", "Users"],
      ["system", "🖥️", "System"],
    ];
    for (const [id, ico, label] of sections) {
      const b = el("button", "set-nav-btn", "");
      b.type = "button";
      b.dataset.sec = id;
      b.appendChild(el("span", "set-nav-ico", ico));
      b.appendChild(el("span", null, label));
      b.addEventListener("click", () => renderSection(id));
      nav.appendChild(b);
      navBtns.push(b);
    }

    mainEl = el("div", "set-main");
    side.append(head, nav);
    rootEl.append(side, mainEl);

    renderSection(activeSec);
    return rootEl;
  }

  // Register as the content builder for the "settings" catalog app.
  window.AppContent = window.AppContent || {};
  window.AppContent.settings = function () {
    return {
      content: buildApp(), w: 760, h: 520, minW: 640, minH: 420,
      onCloseRequest: () => { if (devTimer) { clearInterval(devTimer); devTimer = null; } },
    };
  };

  window.Settings = {
    open() { if (window.Apps) window.Apps.launch("settings"); },
    openSection(id) {
      const valid = ["appearance", "display", "personalization", "sound", "notifications", "developer", "users", "system"].includes(id);
      if (!valid) return;
      activeSec = id;
      const existing = window.WM && window.WM.findByAppId ? window.WM.findByAppId("settings") : null;
      if (existing && !existing.closed) {
        if (mainEl) renderSection(id);
        if (window.WM.focus) window.WM.focus(existing.id);
      } else if (window.Apps) {
        window.Apps.launch("settings");
      }
    },
    applyAll,
    get uiSounds() { return uiSoundsEnabled; },
    get activeSection() { return activeSec; },
  };

  // Apply stored settings as soon as the module loads (Desktop/Theme/WM are
  // already initialized — script order guarantees it).
  applyAll();
})();
