// Webuntu OS — Clipboard history (Task 76)
// Windows-style clipboard history for the whole OS. Every text copy/cut is
// recorded — copy/cut events are intercepted globally, and navigator.clipboard
// .writeText is wrapped so programmatic copies (emoji picker, terminal, copy
// buttons, apps) land in the history too. Super+V opens a picker card: ↑/↓
// move the selection, Enter pastes the highlighted entry at the caret of the
// field that had focus when the picker opened (falling back to copying it and
// showing a toast when no text field is focused), Delete/Backspace removes an
// entry, Esc / outside-click / resize close. Entries can be pinned (📌) so
// they survive "Clear all" and stay at the top of the list. Copying the same
// text again just bumps it to the top. History persists in webuntu.clipboard
// .history (reload-safe). While the picker is open it owns the keyboard — the
// global shortcut layer in src/shortcuts.js stands aside (see its guard).

(function () {
  "use strict";

  const STORE_KEY = "webuntu.clipboard.history";
  const MAX_ITEMS = 30;    // total entries (pinned are never dropped)
  const MAX_TEXT = 5000;   // per-entry stored text cap
  const PREVIEW_LEN = 150; // single-line preview length in the UI

  // ---------- helpers ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function locked() { return !!(window.OS && window.OS.isLocked); }
  function preview(t) {
    const one = String(t || "").replace(/\s+/g, " ").trim();
    return one.length > PREVIEW_LEN ? one.slice(0, PREVIEW_LEN) + "…" : one;
  }

  // ---------- storage ----------
  // Entry: { t: text, ts: copy/pin timestamp, p: 1 if pinned }
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(STORE_KEY) || "[]");
      return Array.isArray(v)
        ? v.filter((x) => x && typeof x.t === "string")
            .map((x) => ({ t: x.t, ts: Number(x.ts) || 0, p: x.p ? 1 : 0 }))
        : [];
    } catch (e) { return []; }
  }
  function save(items) {
    try { localStorage.setItem(STORE_KEY, JSON.stringify(items)); } catch (e) {}
  }

  // Display order: pinned entries first (most-recently-pinned first), then
  // unpinned recents (newest first).
  function ordered() {
    const items = load();
    const pinned = items.filter((x) => x.p).sort((a, b) => b.ts - a.ts);
    const recent = items.filter((x) => !x.p).sort((a, b) => b.ts - a.ts);
    return [...pinned.map((x) => ({ t: x.t, ts: x.ts, p: true })),
            ...recent.map((x) => ({ t: x.t, ts: x.ts, p: false }))];
  }

  function add(text) {
    const clean = String(text == null ? "" : text).trim();
    if (!clean) return;
    const entry = clean.length > MAX_TEXT ? clean.slice(0, MAX_TEXT) : clean;
    const now = Date.now();
    const items = load();
    const found = items.find((x) => x.t === entry);
    if (found) {
      found.ts = now; // copying the same text again just bumps it
      save(items);
    } else {
      items.unshift({ t: entry, ts: now, p: 0 });
      // Pinned entries are never dropped; unpinned recents fill the rest.
      const pinned = items.filter((x) => x.p);
      const recent = items.filter((x) => !x.p).sort((a, b) => b.ts - a.ts)
        .slice(0, Math.max(0, MAX_ITEMS - pinned.length));
      save([...pinned, ...recent]);
    }
    if (state.open) { render(); selTo(0); }
  }

  function togglePin(text) {
    const items = load();
    const f = items.find((x) => x.t === text);
    if (!f) return;
    f.p = f.p ? 0 : 1;
    f.ts = Date.now();
    save(items);
    render();
  }
  function remove(text) {
    save(load().filter((x) => x.t !== text));
    render();
  }
  function clearAll() {
    save(load().filter((x) => x.p)); // pinned survive Clear all (Windows-style)
    render();
  }

  // ---------- capture ----------
  // Real user copies/cuts: read the text straight off the event, falling back
  // to the current selection (some engines don't populate clipboardData — and
  // textarea/input selections live on the field, not in getSelection()).
  function captureFromEvent(ev) {
    let text = "";
    try {
      if (ev.clipboardData && typeof ev.clipboardData.getData === "function") {
        text = ev.clipboardData.getData("text/plain");
      }
    } catch (e) {}
    if (!text) {
      const s = window.getSelection();
      text = s ? s.toString() : "";
    }
    if (!text) {
      const a = document.activeElement;
      if (a && (a.tagName === "TEXTAREA" || a.tagName === "INPUT") && typeof a.selectionStart === "number") {
        text = (a.value || "").slice(a.selectionStart, a.selectionEnd);
      }
    }
    add(text);
  }
  document.addEventListener("copy", captureFromEvent);
  document.addEventListener("cut", captureFromEvent);

  // Programmatic copies (emoji picker, terminal, "copy" buttons…) don't fire a
  // copy event — wrap writeText so they land in history too.
  try {
    const nc = navigator.clipboard;
    if (nc && typeof nc.writeText === "function") {
      const orig = nc.writeText.bind(nc);
      nc.writeText = async (text) => {
        add(String(text == null ? "" : text));
        return orig(text);
      };
    }
  } catch (e) {}

  // ---------- editable-target helpers (same technique as src/emoji.js) ----------
  function editableTarget() {
    const a = document.activeElement;
    if (!a || !a.isConnected || a.disabled || a.readOnly) return null;
    if (a.tagName === "TEXTAREA") return a;
    if (a.tagName === "INPUT") {
      const t = (a.type || "text").toLowerCase();
      return ["text", "search", "url", "email", "tel", "password", "number", ""].includes(t) ? a : null;
    }
    return a.isContentEditable ? a : null;
  }
  function isEditable(a) {
    if (!a || !a.isConnected || a.disabled || a.readOnly) return false;
    if (a.tagName === "TEXTAREA") return true;
    if (a.tagName === "INPUT") {
      const t = (a.type || "text").toLowerCase();
      return ["text", "search", "url", "email", "tel", "password", "number", ""].includes(t);
    }
    return !!a.isContentEditable;
  }
  function insertInto(t, text) {
    const isField = t.tagName === "INPUT" || t.tagName === "TEXTAREA";
    const before = isField ? t.value : null;
    let s = 0, e = 0;
    if (isField) {
      s = t.selectionStart == null ? t.value.length : t.selectionStart;
      e = t.selectionEnd == null ? s : t.selectionEnd;
    }
    t.focus();
    if (isField) { try { t.setSelectionRange(s, e); } catch (err) {} }
    let ok = false;
    try { ok = document.execCommand("insertText", false, text); } catch (err) {}
    if (isField && ok && t.value === before) ok = false; // execCommand lied
    if (ok) return;
    if (isField) {
      t.value = t.value.slice(0, s) + text + t.value.slice(e);
      const pos = s + text.length;
      try { t.setSelectionRange(pos, pos); } catch (err) {}
      t.dispatchEvent(new Event("input", { bubbles: true }));
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
    const ta = el("textarea", "");
    ta.value = text;
    ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.pointerEvents = "none";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch (e) {}
    ta.remove();
  }

  // ---------- AI text transforms (Task 85) ----------
  // Shared by the Super+V picker's ✨ button and the right-click edit menu.
  const AI_TRANSFORMS = {
    polish: "Polish this text: fix grammar, spelling, punctuation and awkward phrasing while keeping the meaning and tone. Output only the polished text.",
    rewrite: "Rewrite this text so the meaning stays the same but the wording is fresh, clearer and more fluent. Output only the rewritten text.",
    summarize: "Summarize this text in a concise paragraph that captures the key points. Output only the summary.",
  };
  async function aiAction(kind, text) {
    const gen = window.root && window.root.generateText;
    if (typeof gen !== "function") throw new Error("the AI text plugin isn't loaded");
    const res = await gen({
      instruction: (AI_TRANSFORMS[kind] || AI_TRANSFORMS.polish) + "\n\n" + text,
    });
    const out = res && typeof res === "object" && res.text !== undefined ? res.text : res;
    return String(out == null ? "" : out).trim();
  }

  // ---------- DOM ----------
  const card = el("div", "");
  card.id = "clipHistory";
  card.hidden = true;
  card.tabIndex = -1;
  card.setAttribute("role", "dialog");
  card.setAttribute("aria-label", "Clipboard history");

  const head = el("div", "cl-head");
  const title = el("div", "cl-title");
  title.append(el("span", "", "📋"), el("b", "", "Clipboard history"));
  const clearBtn = el("button", "cl-clear", "Clear all");
  clearBtn.type = "button";
  clearBtn.title = "Remove all unpinned items";
  const closeBtn = el("button", "cl-close", "✕");
  closeBtn.type = "button";
  closeBtn.title = "Close (Esc)";
  head.append(title, clearBtn, closeBtn);

  const listEl = el("div", "cl-list");
  listEl.setAttribute("role", "listbox");
  listEl.setAttribute("aria-label", "Copied items");

  const foot = el("div", "cl-foot");
  const hint = el("div", "cl-hint");
  hint.append(
    el("span", "kbd", "Enter"), el("span", "", " paste · "),
    el("span", "kbd", "↑"), el("span", "kbd", "↓"), el("span", "", " move · "),
    el("span", "kbd", "⌫"), el("span", "", " remove · "),
    el("span", "kbd", "A"), el("span", "", " AI · "),
    el("span", "kbd", "Esc"), el("span", "", " close")
  );
  const countEl = el("div", "cl-count", "");
  foot.append(hint, countEl);

  card.append(head, listEl, foot);

  // Floating AI action menu, opened from a row's ✨ button (Task 85).
  const aiMenu = el("div", "cl-aimenu");
  aiMenu.hidden = true;
  aiMenu.setAttribute("role", "menu");
  card.appendChild(aiMenu);
  document.body.appendChild(card);

  const state = { open: false, sel: -1, target: null, items: [], aiMenu: false, aiIdx: 0, busy: null };

  // ---------- rendering ----------
  function buildRow(entry) {
    const row = el("div", "cl-entry");
    row.setAttribute("role", "option");
    row.setAttribute("aria-selected", "false");
    row.title = entry.t;
    const ico = el("span", "cl-ico", entry.p ? "📌" : "📋");
    const txt = el("span", "cl-text", preview(entry.t));
    const ai = el("button", "cl-ai", "✨");
    ai.type = "button";
    ai.title = "AI actions — Polish / Rewrite / Summarize";
    ai.setAttribute("aria-label", "AI actions");
    ai.addEventListener("click", (ev) => { ev.stopPropagation(); showAiMenu(row, entry); });
    const pin = el("button", "cl-pin" + (entry.p ? " pinned" : ""), "📌");
    pin.type = "button";
    pin.title = entry.p ? "Unpin" : "Pin";
    pin.setAttribute("aria-label", entry.p ? "Unpin" : "Pin");
    const del = el("button", "cl-del", "✕");
    del.type = "button";
    del.title = "Delete";
    del.setAttribute("aria-label", "Delete");
    pin.addEventListener("click", (ev) => { ev.stopPropagation(); togglePin(entry.t); });
    del.addEventListener("click", (ev) => { ev.stopPropagation(); remove(entry.t); });
    row.append(ico, txt, ai, pin, del);
    row.addEventListener("mousemove", () => { const i = rowIndex(row); if (i !== -1 && state.sel !== i) selTo(i); });
    row.addEventListener("click", () => activate(entry));
    return row;
  }
  function rowIndex(row) {
    return [...listEl.children].filter((c) => c.classList.contains("cl-entry")).indexOf(row);
  }
  function rows() {
    return [...listEl.children].filter((c) => c.classList.contains("cl-entry"));
  }

  function render() {
    hideAiMenu();
    state.items = ordered();
    listEl.textContent = "";
    const pinned = state.items.filter((x) => x.p);
    const recent = state.items.filter((x) => !x.p);
    if (pinned.length) {
      listEl.appendChild(el("div", "cl-label", "Pinned"));
      for (const e of pinned) listEl.appendChild(buildRow(e));
    }
    if (recent.length) {
      if (pinned.length) listEl.appendChild(el("div", "cl-label", "Recent"));
      for (const e of recent) listEl.appendChild(buildRow(e));
    }
    if (!state.items.length) {
      listEl.appendChild(el("div", "cl-empty", "Clipboard is empty — copy some text anywhere in Webuntu."));
    }
    countEl.textContent = state.items.length
      ? state.items.length + (state.items.length === 1 ? " item" : " items")
      : "";
  }

  function selTo(i) {
    const r = rows();
    if (!r.length) { state.sel = -1; return; }
    i = Math.max(0, Math.min(r.length - 1, i));
    state.sel = i;
    r.forEach((row, k) => {
      const on = k === i;
      row.classList.toggle("sel", on);
      row.setAttribute("aria-selected", on ? "true" : "false");
    });
    const cur = r[i];
    if (cur && typeof cur.scrollIntoView === "function") cur.scrollIntoView({ block: "nearest" });
  }

  // ---------- AI actions in the picker (Task 85) ----------
  const AI_LABELS = [
    { kind: "polish", icon: "✨", label: "Polish" },
    { kind: "rewrite", icon: "🔁", label: "Rewrite" },
    { kind: "summarize", icon: "📝", label: "Summarize" },
  ];
  function setAiActive(i) {
    const items = [...aiMenu.children];
    if (!items.length) return;
    i = Math.max(0, Math.min(items.length - 1, i));
    state.aiIdx = i;
    items.forEach((c, k) => c.classList.toggle("active", k === i));
  }
  function showAiMenu(row, entry) {
    if (state.busy) return;
    if (state.aiMenu) { hideAiMenu(); return; }
    aiMenu.textContent = "";
    AI_LABELS.forEach((it, i) => {
      const b = el("button", "cl-aimenu-item", "");
      b.type = "button";
      b.setAttribute("role", "menuitem");
      b.append(el("span", "cl-aimenu-ico", it.icon), el("span", "cl-aimenu-lbl", it.label));
      b.addEventListener("click", (ev) => { ev.stopPropagation(); hideAiMenu(); runAi(it.kind, entry, row); });
      b.addEventListener("mouseenter", () => setAiActive(i));
      aiMenu.appendChild(b);
    });
    state.aiMenu = true;
    state.aiIdx = 0;
    aiMenu.hidden = false;
    const btn = row.querySelector(".cl-ai");
    const r = btn.getBoundingClientRect();
    const mw = aiMenu.offsetWidth || 150;
    aiMenu.style.left = Math.max(8, Math.min(r.right - mw, innerWidth - mw - 8)) + "px";
    aiMenu.style.top = (r.bottom + 4) + "px";
    setAiActive(0);
  }
  function hideAiMenu() {
    if (!state.aiMenu) return;
    state.aiMenu = false;
    aiMenu.hidden = true;
    aiMenu.textContent = "";
  }
  // Runs an AI transform on a history entry. The picker stays open with a
  // spinner on the row while it generates; the result then replaces the
  // selection at the focused field (or goes to the real clipboard + a toast
  // when no field is focused). Esc cancels the running generation.
  async function runAi(kind, entry, row) {
    if (state.busy) return;
    const btn = row && row.querySelector(".cl-ai");
    const token = { cancelled: false };
    state.busy = { token };
    if (btn) { btn.classList.add("busy"); btn.textContent = "⏳"; }
    try {
      const promise = aiAction(kind, entry.t);
      state.busy.promise = promise;
      const out = await promise;
      if (token.cancelled) return;
      if (!out) throw new Error("the AI returned nothing");
      add(out);
      const tgt = state.target;
      const wasOpen = state.open;
      state.busy = null;
      if (btn) { btn.classList.remove("busy"); btn.textContent = "✨"; }
      close();
      if (wasOpen && isEditable(tgt)) {
        insertInto(tgt, out);
        if (window.Sounds) window.Sounds.play("ok");
      } else {
        copyText(out);
        if (window.Notify) window.Notify.toast("✨ " + kind, preview(out), { icon: "✨", app: "AI" });
      }
    } catch (e) {
      if (token.cancelled) return;
      state.busy = null;
      if (btn) { btn.classList.remove("busy"); btn.textContent = "✨"; }
      if (window.Notify) window.Notify.toast("AI " + kind + " failed", (e && e.message) || "error", { icon: "⚠️", app: "AI" });
    }
  }

  // ---------- paste ----------
  function activate(entry) {
    const tgt = state.target;
    const text = entry.t;
    close();
    if (isEditable(tgt)) {
      insertInto(tgt, text);
      if (window.Sounds) window.Sounds.play("ok");
    } else {
      // No text field was focused: put it on the real clipboard instead. The
      // writeText wrapper bumps it to the top of history automatically.
      copyText(text);
      if (window.Notify) {
        window.Notify.toast("Copied to clipboard", preview(text), { icon: "📋", app: "Clipboard" });
      }
    }
  }

  // ---------- positioning ----------
  function position() {
    const w = card.offsetWidth || 420;
    const h = card.offsetHeight || 360;
    let left = (innerWidth - w) / 2;
    let top = innerHeight - h - 64;
    const t = state.target;
    if (t && t.isConnected) {
      const r = t.getBoundingClientRect();
      if (r.width || r.height) {
        left = r.left + r.width / 2 - w / 2;
        top = r.top - h - 8;
      }
    }
    left = Math.max(8, Math.min(left, innerWidth - w - 8));
    top = Math.max(8, Math.min(top, innerHeight - h - 8));
    card.style.left = left + "px";
    card.style.top = top + "px";
  }

  // ---------- open / close ----------
  function open() {
    if (state.open || locked()) return;
    if (window.Overview && window.Overview.isOpen) return; // overview owns the screen
    if (window.StartMenu) window.StartMenu.close();
    if (window.SystemBar) window.SystemBar.closePopups();
    if (window.Shortcuts) {
      if (window.Shortcuts.closeHelp) window.Shortcuts.closeHelp();
      if (window.Shortcuts.closeRun) window.Shortcuts.closeRun();
    }
    if (window.ContextMenu && window.ContextMenu.isOpen) window.ContextMenu.hide();
    if (window.EmojiPicker && window.EmojiPicker.isOpen) window.EmojiPicker.close();
    state.target = editableTarget();
    state.open = true;
    card.hidden = false;
    render();
    position();
    selTo(0);
    card.focus({ preventScroll: true });
  }
  function close() {
    if (!state.open) return;
    state.open = false;
    state.target = null;
    state.sel = -1;
    hideAiMenu();
    card.hidden = true;
  }
  function toggle() { state.open ? close() : open(); }

  // ---------- events ----------
  clearBtn.addEventListener("click", () => {
    clearAll();
    if (!state.items.length) close();
    else selTo(0);
  });
  closeBtn.addEventListener("click", close);

  // While the picker is open it owns the keyboard (the shortcuts.js layer
  // early-returns for every key, so nothing else acts under the card). Super+V
  // when closed opens it — shortcuts.js passes that press through untouched.
  window.addEventListener("keydown", (ev) => {
    if (!state.open) {
      if (!locked() && ev.metaKey && !ev.ctrlKey && !ev.altKey && !ev.shiftKey &&
          (ev.key === "v" || ev.key === "V")) {
        ev.preventDefault();
        open();
      }
      return;
    }
    if (locked()) { close(); return; }
    if (state.busy) {
      // While an AI transform runs, only Esc works (cancels the generation).
      if (ev.key === "Escape") {
        ev.preventDefault();
        if (state.busy.token) state.busy.token.cancelled = true;
        const p = state.busy.promise;
        if (p && typeof p.stop === "function") { try { p.stop(); } catch (e) {} }
        state.busy = null;
        const r = rows()[state.sel];
        const b = r && r.querySelector(".cl-ai");
        if (b) { b.classList.remove("busy"); b.textContent = "✨"; }
      }
      return;
    }
    if (state.aiMenu) {
      if (ev.key === "Escape") { ev.preventDefault(); hideAiMenu(); return; }
      if (ev.key === "ArrowDown") { ev.preventDefault(); setAiActive(state.aiIdx + 1); return; }
      if (ev.key === "ArrowUp") { ev.preventDefault(); setAiActive(state.aiIdx - 1); return; }
      if (ev.key === "Enter" || ev.key === " ") {
        ev.preventDefault();
        const it = [...aiMenu.children][state.aiIdx];
        if (it) it.click();
        return;
      }
      return;
    }
    if (ev.key === "Escape") { ev.preventDefault(); close(); return; }
    if (ev.key === "ArrowDown") { ev.preventDefault(); selTo(state.sel + 1); return; }
    if (ev.key === "ArrowUp") { ev.preventDefault(); selTo(state.sel - 1); return; }
    if (ev.key === "Home") { ev.preventDefault(); selTo(0); return; }
    if (ev.key === "End") { ev.preventDefault(); selTo(state.items.length - 1); return; }
    if (ev.key === "Enter" || ev.key === " ") {
      ev.preventDefault();
      if (state.items[state.sel]) activate(state.items[state.sel]);
      return;
    }
    if (ev.key === "Delete" || ev.key === "Backspace") {
      ev.preventDefault();
      if (state.items[state.sel]) {
        const at = state.sel;
        remove(state.items[at].t);
        selTo(Math.min(at, Math.max(0, state.items.length - 1)));
      }
      return;
    }
    if (ev.key === "a" || ev.key === "A") {
      ev.preventDefault();
      if (state.items[state.sel]) {
        const r = rows()[state.sel];
        if (r) showAiMenu(r, state.items[state.sel]);
      }
    }
  });

  card.addEventListener("mousedown", (ev) => { ev.stopPropagation(); });
  document.addEventListener("mousedown", (ev) => {
    if (state.open && !card.contains(ev.target)) close();
  });
  window.addEventListener("resize", () => { if (state.open) close(); });

  // Account switch / unlock closes the picker (the lock screen sits above it).
  document.addEventListener("webuntu-userchange", () => { if (state.open) close(); });

  window.ClipboardHistory = {
    get isOpen() { return state.open; },
    open, close, toggle,
    add,
    get items() { return ordered(); },
    insertInto,
    aiAction,
  };
})();
