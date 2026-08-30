// Webuntu OS — Voice everywhere (Phase 10, Task 79)
// OS-wide dictation backed by the voice-tools-plugin (`root.voiceTools`):
//   • Super+H or the tray 🎤 button starts/stops listening (Win+H style).
//   • Speech is inserted at the caret of the text field that had focus when
//     dictation started; with no editable field focused the text is copied to
//     the real clipboard on stop.
//   • A floating bar (#dictBar) shows the live transcript while listening, and
//     the tray mic pulses.
// Dictation needs Chrome/Edge/Safari (Web Speech recognition); the tray button
// and shortcut are inert on other browsers (with a toast explaining why).

(function () {
  "use strict";

  // Force the voice-tools-plugin import to materialize on boot: the plugin
  // caches its API object on window.__voiceToolsPluginApi the first time it's
  // evaluated, and that object is the reliable way to reach its methods
  // (property access on the bare import node doesn't proxy through).
  try { if (!window.__voiceToolsPluginApi) root.voiceTools.evaluateItem; } catch (e) {}

  function voiceApi() {
    if (window.__voiceToolsPluginApi) return window.__voiceToolsPluginApi;
    try { root.voiceTools.evaluateItem; } catch (e) {}
    return window.__voiceToolsPluginApi || root.voiceTools;
  }

  const micBtn = document.getElementById("trayMic");
  const bar = document.getElementById("dictBar");
  const barText = document.getElementById("dictText");

  let listening = false;
  let session = null;      // the voiceTools.listen promise (has .stop())
  let target = null;       // {el, s, e, field} captured when dictation started
  let pendingNoField = []; // final utterances while no editable field is focused

  function isEditable(el) {
    if (!el) return false;
    const tag = el.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return true;
    return el.isContentEditable === true;
  }

  // Insert at the captured caret, mirroring emoji.js / cliphistory.js:
  // execCommand("insertText") with a manual fallback that still fires `input`
  // so editors' dirty/undo tracking keeps working.
  function insertText(text) {
    const t = target.el;
    const isField = target.field;
    const before = isField ? t.value : null;
    let s = target.s, e = target.e;
    if (document.activeElement !== t) t.focus();
    if (isField) { try { t.setSelectionRange(s, e); } catch (err) {} }
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (err) {}
    if (isField && ok && t.value === before) ok = false;
    if (ok) {
      target.s = target.e = s + text.length;
      return;
    }
    if (isField) {
      t.value = t.value.slice(0, s) + text + t.value.slice(e);
      const pos = s + text.length;
      try { t.setSelectionRange(pos, pos); } catch (err) {}
      t.dispatchEvent(new Event("input", { bubbles: true }));
      target.s = target.e = pos;
    } else {
      const sel = window.getSelection();
      if (sel && sel.rangeCount && sel.getRangeAt(0)) {
        const r = sel.getRangeAt(0);
        r.deleteContents();
        const node = document.createTextNode(text);
        r.insertNode(node);
        r.setStartAfter(node);
        r.collapse(true);
        sel.removeAllRanges();
        sel.addRange(r);
      } else t.textContent += text;
    }
  }

  function copyText(text) {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).catch(() => legacyCopy(text));
    } else legacyCopy(text);
  }
  function legacyCopy(text) {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  function setBarText(t) { if (barText) barText.textContent = t; }
  function showBar(on) {
    if (!bar) return;
    bar.hidden = !on;
    if (on) setBarText("Listening…");
  }
  function setMic(on) {
    if (!micBtn) return;
    micBtn.classList.toggle("listening", on);
    micBtn.setAttribute("aria-pressed", String(on));
    micBtn.title = on ? "Stop dictation — Super+H" : "Dictation — Super+H";
  }

  async function start() {
    if (listening) return;
    const vt = voiceApi();
    if (!vt || !vt.sttSupported) {
      if (window.Notify) window.Notify.toast("Dictation", "Speech recognition isn't supported in this browser — try Chrome, Edge or Safari.", { icon: "🎤", app: "Dictation" });
      return;
    }
    const active = document.activeElement;
    if (isEditable(active)) {
      if (active.tagName === "INPUT" || active.tagName === "TEXTAREA") {
        const s = active.selectionStart == null ? active.value.length : active.selectionStart;
        const e = active.selectionEnd == null ? s : active.selectionEnd;
        target = { el: active, s, e, field: true };
      } else {
        target = { el: active, s: 0, e: 0, field: false };
      }
    } else {
      target = null;
    }
    if (window.SystemBar && window.SystemBar.closePopups) window.SystemBar.closePopups();
    if (window.StartMenu && window.StartMenu.close) window.StartMenu.close();
    listening = true;
    showBar(true);
    setMic(true);
    pendingNoField = [];
    try {
      session = vt.listen({
        continuous: true,
        interim: true,
        lang: "en-US",
        onInterim: (r) => setBarText("Listening… " + ((r && (r.fullText || r.text)) || "")),
        onFinal: (r) => {
          const t = String((r && r.text) || "").trim();
          if (!t) return;
          if (target) insertText(t);
          else pendingNoField.push(t);
          if (window.Sounds && window.Sounds.play) window.Sounds.play("ok");
        },
        onEnd: () => stop(),
        onError: (e) => {
          if (window.Notify && window.Notify.toast) {
            window.Notify.toast("Dictation", (e && e.message) ? e.message : "Speech recognition error", { icon: "🎤", app: "Dictation" });
          }
          stop();
        },
      });
    } catch (err) {
      stop();
      return;
    }
    if (target) target.el.focus();
  }

  async function stop() {
    if (!listening) return;
    listening = false;
    showBar(false);
    setMic(false);
    if (session && session.stop) { try { session.stop(); } catch (e) {} }
    session = null;
    const text = pendingNoField.join(" ").trim();
    pendingNoField = [];
    if (!target && text) {
      copyText(text);
      if (window.Notify && window.Notify.toast) {
        window.Notify.toast("Dictated to clipboard", text.length > 60 ? text.slice(0, 60) + "…" : text, { icon: "🎤", app: "Dictation" });
      }
    }
    target = null;
  }

  function toggle() {
    if (window.OS && window.OS.isLocked) return;
    if (listening) { stop(); return; }
    start();
  }

  if (micBtn) {
    micBtn.addEventListener("click", (ev) => {
      ev.stopPropagation();
      toggle();
    });
  }
  document.addEventListener("keydown", (ev) => {
    if (ev.key === "Escape" && listening) { ev.preventDefault(); stop(); }
  });

  window.Dictation = {
    get supported() {
      try {
        const a = voiceApi();
        return !!(a && a.sttSupported);
      } catch (e) { return false; }
    },
    get isListening() { return listening; },
    toggle,
    stop,
  };
})();
