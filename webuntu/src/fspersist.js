// Webuntu OS — Filesystem persistence (Phase 4, Task 21)
// The virtual FS (created/renamed/deleted folders, files, shortcuts), the
// wallpaper choice and the settings all persist across reloads, per user.
//   • FS trees live in localStorage under `webuntu.fs.<username>` (the
//     in-memory tree in window.FS is a plain JSON-serializable object, so a
//     whole-tree save/load round-trips cleanly). Trees are keyed by the
//     current account (window.OS.currentUser); signing in as a different user
//     reloads that user's tree.
//   • Every FS mutation auto-saves: the module registers itself as
//     window.FS.onChange (fs.js fires it after create/remove/reset).
//   • `resetDesktop()` wipes the user's tree + settings and restores defaults.
//   • If localStorage is unavailable the module falls back to in-memory only
//     (never errors), and reports that state via `note()` for the Settings app.
//   Wallpaper + settings keys live in `webuntu.settings` (Desktop/Theme).

(function () {
  "use strict";

  const SETTINGS_KEY = "webuntu.settings";

  function currentUser() { return (window.OS && window.OS.currentUser) || "default"; }
  function fsKey() { return "webuntu.fs." + currentUser(); }

  let available = (function () {
    try { localStorage.setItem("webuntu.__probe", "1"); localStorage.removeItem("webuntu.__probe"); return true; }
    catch (e) { return false; }
  })();

  function save() {
    if (!available) return false;
    try {
      localStorage.setItem(fsKey(), JSON.stringify(window.FS.root));
      return true;
    } catch (e) { available = false; return false; }
  }

  // Rebuild the in-memory tree from this user's stored tree (or defaults).
  function loadStored() {
    let loadedFromStorage = false;
    if (!available) { window.FS.reset(true); }
    else {
      try {
        const raw = localStorage.getItem(fsKey());
        if (raw) {
          const tree = JSON.parse(raw);
          if (tree && typeof tree === "object" && typeof tree.name === "string") {
            window.FS.load(tree);
            loadedFromStorage = true;
          }
        }
      } catch (e) { available = false; }
      if (!loadedFromStorage) window.FS.reset(true);
    }
    // Bring pre-Task-22 stored trees up to date (Desktop folder + home-folder
    // seeds, gated by the tree's fsVersion) and persist the migration once.
    if (window.FS.ensureSeeds()) save();
    // fs.js loads after desktop.js, so re-render the desktop now that the tree
    // (and its /home/user/Desktop shortcuts) is in place.
    if (window.Desktop) window.Desktop.refresh();
    return loadedFromStorage;
  }

  function resetDesktop() {
    try { localStorage.removeItem(fsKey()); } catch (e) {}
    try { localStorage.removeItem(SETTINGS_KEY); } catch (e) {}
    window.FS.reset();                                   // fires onChange → persists defaults
    if (window.Theme) window.Theme.apply("dark");        // re-apply the default look
    if (window.Theme && window.Theme.setAccent) window.Theme.setAccent(null, false);
    if (window.Desktop && window.Desktop.clearWallpaper) window.Desktop.clearWallpaper();
    if (window.Desktop && window.Desktop.refresh) window.Desktop.refresh();
    // Task 23 — re-apply the now-empty settings: default text size, motion on,
    // icons visible, taskbar at bottom, sounds off.
    if (window.Settings && window.Settings.applyAll) window.Settings.applyAll();
  }

  // Per-user trees: reload from the newly signed-in user's storage on unlock.
  (function wrapUnlock() {
    if (!window.OS || typeof window.OS.unlock !== "function") return;
    const orig = window.OS.unlock;
    window.OS.unlock = function () {
      orig.apply(this, arguments);
      loadStored();
    };
  })();

  window.FS.onChange = save;
  loadStored();

  window.FSPersist = {
    save,
    reload: loadStored,
    resetDesktop,
    get user() { return currentUser(); },
    get storageAvailable() { return available; },
    // Human-readable storage status for the Settings app (Task 23).
    note() {
      return available
        ? "Persisting to browser storage as \u201c" + currentUser() + "\u201d."
        : "Browser storage unavailable \u2014 running in memory only (changes won\u2019t survive reloads).";
    },
  };
})();
