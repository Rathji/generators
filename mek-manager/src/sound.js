(function () {
  "use strict";

  const URLS = {
    menu: "https://user.uploads.dev/file/6f1b22d0ece7127a9f78eb47d0526358.mp3",
    battle: "https://user.uploads.dev/file/8869953edc6a464ec383207af750519f.mp3",
    victory: "https://user.uploads.dev/file/61db1a42d022a0cacfcbae6c4d1ede76.mp3",
    defeat: "https://user.uploads.dev/file/87edc944077640d40d7cdcbee9d6ab0d.mp3"
  };

  const BMS = {
    enabled: true,
    musicVol: 0.34,
    sfxVol: 0.6,
    _tracks: {},
    _current: null,
    _currentKey: null,
    _pending: null,
    _pendingRate: 1,
    _unlocked: false,
    _fade: null
  };

  function store(k, v) { try { localStorage.setItem("bmg-sound-" + k, JSON.stringify(v)); } catch (e) { } }
  function load(k, d) { try { const s = localStorage.getItem("bmg-sound-" + k); return s === null ? d : JSON.parse(s); } catch (e) { return d; } }

  function track(key) {
    if (!BMS._tracks[key]) {
      const a = new Audio(URLS[key]);
      a.preload = "auto";
      a.loop = (key === "menu" || key === "battle");
      a.volume = 0;
      BMS._tracks[key] = a;
    }
    return BMS._tracks[key];
  }

  function clearFade() { if (BMS._fade) { clearInterval(BMS._fade); BMS._fade = null; } }

  function fadeTo(key, targetVol, rate) {
    const next = track(key);
    if (BMS._current === next) {
      if (rate) next.playbackRate = rate;
      if (next.paused && BMS.enabled) next.play().catch(() => { });
      return;
    }
    clearFade();
    const old = BMS._current;
    BMS._current = next;
    BMS._currentKey = key;
    next.playbackRate = rate || 1;
    try { next.currentTime = 0; } catch (e) { }
    next.volume = 0.02;
    next.play().catch(() => { });
    BMS._fade = setInterval(() => {
      next.volume = Math.min(targetVol, next.volume + Math.max(0.02, targetVol / 10));
      if (old) old.volume = Math.max(0, old.volume - 0.04);
      if (next.volume >= targetVol - 0.005) {
        clearFade();
        if (old && old !== next) { try { old.pause(); old.currentTime = 0; } catch (e) { } old.volume = 0; }
      }
    }, 90);
  }

  function unlock() {
    if (BMS._unlocked) return;
    BMS._unlocked = true;
    const key = BMS._pending || (BMS._currentKey || "menu");
    const rate = BMS._pendingRate;
    BMS._pending = null;
    if (BMS.enabled) fadeTo(key, BMS.musicVol, rate);
  }

  function play(key, opts) {
    opts = opts || {};
    if (!BMS.enabled) { BMS._pending = key; BMS._pendingRate = opts.rate || 1; return; }
    if (!BMS._unlocked) { BMS._pending = key; BMS._pendingRate = opts.rate || 1; return; }
    fadeTo(key, opts.volume !== undefined ? opts.volume : BMS.musicVol, opts.rate);
  }

  function stinger(key) {
    if (!BMS.enabled || !BMS._unlocked) return;
    const a = new Audio(URLS[key]);
    a.volume = Math.min(1, BMS.musicVol + 0.22);
    a.play().catch(() => { });
    const cur = BMS._current;
    if (cur) {
      cur.volume = BMS.musicVol * 0.25;
      a.addEventListener("ended", () => { if (BMS._current === cur && BMS.enabled) cur.volume = BMS.musicVol; });
    }
  }

  function setEnabled(on) {
    BMS.enabled = !!on;
    store("enabled", BMS.enabled);
    if (!BMS.enabled) {
      clearFade();
      if (BMS._current) { BMS._current.volume = 0; BMS._current.pause(); }
    } else if (BMS._unlocked) {
      const key = BMS._currentKey || "menu";
      BMS._current = null;
      fadeTo(key, BMS.musicVol, BMS._pendingRate);
    }
    updateButton();
  }

  function toggle() { setEnabled(!BMS.enabled); return BMS.enabled; }

  function updateButton() {
    const b = document.getElementById("soundToggle");
    if (!b) return;
    b.textContent = "♪";
    b.title = BMS.enabled ? "Mute sound" : "Unmute sound";
    b.setAttribute("aria-label", BMS.enabled ? "Mute sound" : "Unmute sound");
    b.classList.toggle("sound-off", !BMS.enabled);
  }

  function init() {
    BMS.enabled = load("enabled", true);
    BMS.musicVol = load("musicVol", 0.34);
    BMS.sfxVol = load("sfxVol", 0.6);
    const kick = () => {
      window.removeEventListener("pointerdown", kick);
      window.removeEventListener("keydown", kick);
      unlock();
    };
    window.addEventListener("pointerdown", kick);
    window.addEventListener("keydown", kick);
    const btn = document.getElementById("soundToggle");
    if (btn) btn.addEventListener("click", (e) => { e.preventDefault(); toggle(); });
    document.addEventListener("visibilitychange", () => {
      if (!BMS._current || !BMS.enabled) return;
      if (document.hidden) BMS._current.pause();
      else BMS._current.play().catch(() => { });
    });
    updateButton();
  }

  window.BMS = {
    init, play, stinger, unlock, toggle, setEnabled, updateButton,
    isEnabled: () => BMS.enabled,
    currentKey: () => BMS._currentKey,
    setMusicVolume: (v) => { BMS.musicVol = Math.max(0, Math.min(1, v)); store("musicVol", BMS.musicVol); if (BMS._current && BMS.enabled && !BMS._current.paused) BMS._current.volume = BMS.musicVol; }
  };

  init();
})();
