// Webuntu OS — virtual clipboard (Task 67)
// An OS-wide file clipboard shared by every File Manager instance:
// copy / cut / paste / duplicate on the virtual FS. Copy is sticky (you can
// paste again), cut clears after a successful paste (Esc cancels the cut).
// State is in-memory only — a fresh boot starts with an empty clipboard.
// Any change dispatches a "webuntu-clipboard" event so open File Manager
// windows can re-render cut dimming + status hints live.

(function () {
  "use strict";

  let mode = null;          // "copy" | "cut" | null
  let items = [];           // array of canonical FS paths

  function dispatch() {
    document.dispatchEvent(new CustomEvent("webuntu-clipboard"));
  }

  function set(paths, m) {
    const clean = (paths || [])
      .map((p) => (window.FS && window.FS.getPath) ? window.FS.getPath(window.FS.resolve(p)) : String(p))
      .filter(Boolean);
    items = Array.from(new Set(clean));
    mode = clean.length ? m : null;
    dispatch();
    return clean.length;
  }

  window.Clipboard = {
    get mode() { return mode; },
    get items() { return items.slice(); },
    get count() { return items.length; },
    get isEmpty() { return items.length === 0; },
    isCut(path) {
      if (mode !== "cut") return false;
      const p = window.FS.getPath(window.FS.resolve(path));
      return p !== null && items.includes(p);
    },
    copy(paths) { return set(paths, "copy"); },
    cut(paths) { return set(paths, "cut"); },
    clear() { items = []; mode = null; dispatch(); },

    // Esc cancels a pending cut (Windows-style).
    cancelCut() {
      if (mode === "cut") { items = []; mode = null; dispatch(); return true; }
      return false;
    },

    // Paste everything into destDir. Copy stays armed; cut is consumed on
    // success. Returns { ok, message }.
    paste(destDirPath) {
      const dir = window.FS.getPath(window.FS.resolve(destDirPath));
      if (!dir) return { ok: false, message: "That folder no longer exists." };
      if (!items.length) return { ok: false, message: "Clipboard is empty." };
      const wasCut = mode === "cut";
      let done = 0, skipped = 0, failed = [];
      for (const p of items) {
        const res = wasCut
          ? window.FS.moveInto(p, dir)
          : window.FS.copyInto(p, dir);
        if (res.ok) done++;
        else if (/already in that folder/.test(res.error)) skipped++;
        else failed.push(res.error);
      }
      if (wasCut && done) { items = []; mode = null; }
      dispatch();
      const verb = wasCut ? "Moved" : "Copied";
      const bits = [];
      if (done) bits.push(verb + " " + done + (done === 1 ? " item" : " items"));
      if (skipped) bits.push("skipped " + skipped + (skipped === 1 ? " already there" : " already there"));
      if (failed.length) bits.push(failed.length + " failed");
      const ok = done > 0 || skipped === items.length;
      return { ok, message: bits.join(" · ") || (wasCut ? "Nothing to move." : "Nothing to copy.") };
    },
  };
})();
