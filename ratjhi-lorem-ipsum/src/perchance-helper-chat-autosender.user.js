// ==UserScript==
// @name         Perchance Helper Chat Autosender
// @namespace    perchance-helper-chat-autosender
// @version      1.0
// @description  Feeds a stored list of prompts into the Perchance AI helper chat at a timed interval you set. Auto-detects the chat box, or click-select it once and it remembers.
// @author       you
// @match        *://perchance.org/*
// @match        *://*.perchance.org/*
// @noframes
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_registerMenuCommand
// ==/UserScript==

(function () {
  "use strict";

  const STORE_KEY = "phcAutosenderCfg";

  // Known element ids/selectors to try automatically. Edit here or use the ⚙ calibrate buttons.
  const INPUT_SELECTORS = [
    "#inputEl",            // perchance.org/ai-chat
    "#chatInput",
    "#messageInput",
    "#aiChatInput",
    "textarea",
    '[contenteditable="true"]',
  ];
  const SEND_SELECTORS = [
    "#sendMessageBtn",     // perchance.org/ai-chat
    "#sendBtn",
    "#sendButton",
    "#submitBtn",
    'button[type="submit"]',
    'button[aria-label*="send" i]',
    'button[title*="send" i]',
    'button[data-testid*="send"]',
  ];

  const DEFAULTS = {
    prompts: [
      "Write a short poem about a cat.",
      "Explain the plot of Inception in one sentence.",
      "Give me three ideas for a cozy game.",
      "Translate 'good morning' into five languages.",
    ],
    intervalSec: 60,
    loop: true,
    shuffle: false,
    skipIfInputHasText: true,
    waitForIdle: true,
    ctrlSBeforeSend: false, // dispatch Ctrl+S (e.g. to save the editor) before each prompt
    burstMode: false,   // send the whole prompt list as one rapid series, then repeat
    burstGapSec: 2,     // seconds between prompts inside a series
    inputSelector: "",
    sendSelector: "",
  };

  let cfg = load();
  let running = false;
  let order = [];      // current send order (indices into parsed prompt list)
  let orderPos = 0;
  let lastSentAt = 0;
  let awaitingIdle = false;
  let sentCount = 0;
  let tickHandle = null;
  let seriesInProgress = false;
  let seriesEndAt = 0;
  let calibration = null; // {kind, overlayEl} while active

  // ---------- storage ----------

  function load() {
    let raw = null;
    try { raw = GM_getValue(STORE_KEY, null); } catch (e) {}
    if (raw == null) { try { raw = localStorage.getItem(STORE_KEY); } catch (e) {} }
    const base = Object.assign({}, DEFAULTS);
    if (raw) {
      try { Object.assign(base, JSON.parse(raw)); } catch (e) {}
    }
    if (!Array.isArray(base.prompts)) base.prompts = String(base.prompts || "").split(/\n+/).map(s => s.trim()).filter(Boolean);
    return base;
  }

  function save() {
    try { GM_setValue(STORE_KEY, JSON.stringify(cfg)); } catch (e) {}
    try { localStorage.setItem(STORE_KEY, JSON.stringify(cfg)); } catch (e) {}
  }

  function parsedPrompts() {
    const raw = Array.isArray(cfg.prompts) ? cfg.prompts.join("\n") : String(cfg.prompts || "");
    return raw.split(/\n+/).map(s => s.trim()).filter(s => s.length > 0);
  }

  function resetOrder() {
    const p = parsedPrompts();
    order = p.map((_, i) => i);
    if (cfg.shuffle) {
      for (let i = order.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [order[i], order[j]] = [order[j], order[i]];
      }
    }
    orderPos = 0;
  }

  function currentPrompt() {
    const p = parsedPrompts();
    if (orderPos >= order.length) return null;
    return p[order[orderPos]];
  }

  function advance() {
    orderPos++;
    if (orderPos >= order.length) {
      if (cfg.loop) resetOrder();
      else return false;
    }
    return true;
  }

  // ---------- element finding ----------

  function resolve(selector) {
    if (!selector) return null;
    try { return document.querySelector(selector); } catch (e) { return null; }
  }

  function isVisible(el) {
    if (!el || el.nodeType !== 1) return false;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return false;
    try {
      const cs = getComputedStyle(el);
      if (cs.display === "none" || cs.visibility === "hidden") return false;
    } catch (e) {}
    return true;
  }

  function firstMatch(selectors) {
    for (const s of selectors) {
      try {
        const el = document.querySelector(s);
        if (el && isVisible(el)) return el;
      } catch (e) {}
    }
    return null;
  }

  function findInput() {
    const saved = resolve(cfg.inputSelector);
    if (saved && isVisible(saved)) return saved;
    return firstMatch(INPUT_SELECTORS);
  }

  function findSend() {
    const saved = resolve(cfg.sendSelector);
    if (saved && isVisible(saved)) return saved;
    const el = firstMatch(SEND_SELECTORS);
    if (el) return el;
    // fallback: a button right next to the chat input
    const input = findInput();
    if (input) {
      const wrap = input.closest("form, .chat-input, [class*='input'], [class*='composer']") || input.parentElement;
      if (wrap) {
        const btn = wrap.querySelector('button, [role="button"]');
        if (btn && isVisible(btn)) return btn;
      }
    }
    return null;
  }

  function inputHasText(input) {
    if (!input) return false;
    if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") return !!input.value.trim();
    if (input.isContentEditable) return !!input.textContent.trim();
    return false;
  }

  // ---------- value insertion + send ----------

  function sendCtrlS() {
    // dispatch a real Ctrl+S keypress on the focused element so the page's own
    // keydown handlers (e.g. the perchance editor's save shortcut) receive it.
    const target = (document.activeElement && document.activeElement !== document.body && document.activeElement !== document.documentElement)
      ? document.activeElement
      : (document.body || document.documentElement);
    const opts = { key: "s", code: "KeyS", ctrlKey: true, metaKey: false, bubbles: true, cancelable: true };
    target.dispatchEvent(new KeyboardEvent("keydown", opts));
    target.dispatchEvent(new KeyboardEvent("keypress", opts));
    target.dispatchEvent(new KeyboardEvent("keyup", opts));
  }

  function setInputValue(input, text) {
    if (input.tagName === "TEXTAREA" || input.tagName === "INPUT") {
      const proto = input.tagName === "TEXTAREA"
        ? window.HTMLTextAreaElement.prototype
        : window.HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value").set;
      setter.call(input, text);
      input.dispatchEvent(new Event("input", { bubbles: true }));
      input.dispatchEvent(new Event("change", { bubbles: true }));
    } else if (input.isContentEditable) {
      input.focus();
      const sel = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(input);
      sel.removeAllRanges();
      sel.addRange(range);
      let ok = false;
      try { ok = document.execCommand("insertText", false, text); } catch (e) {}
      if (!ok) {
        input.textContent = text;
        input.dispatchEvent(new Event("input", { bubbles: true }));
      }
    }
    input.focus();
  }

  function waitFor(fn, timeoutMs) {
    return new Promise(resolve => {
      const start = Date.now();
      (function poll() {
        if (fn()) return resolve(true);
        if (Date.now() - start > timeoutMs) return resolve(false);
        setTimeout(poll, 120);
      })();
    });
  }

  async function sendCurrentPrompt() {
    const text = currentPrompt();
    if (text == null) return false;

    const input = findInput();
    if (!input) {
      setStatus("Chat input not found — open the chat, then ⚙ → select input");
      return false;
    }

    if (cfg.skipIfInputHasText && inputHasText(input)) {
      setStatus(`Skipped (box had text): ${shorten(text)}`);
      advance();
      return true;
    }

    if (cfg.ctrlSBeforeSend) {
      try { sendCtrlS(); } catch (e) {}
    }

    setInputValue(input, text);

    const send = findSend();
    if (send) {
      if (send.disabled) await waitFor(() => !send.disabled, 5000);
      if (send.disabled) { setStatus("Send button stuck disabled"); return false; }
      send.click();
    } else {
      // fallback: press Enter in the box
      input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", code: "Enter", bubbles: true }));
    }

    sentCount++;
    setStatus(`Sent ${sentCount}: ${shorten(text)}`);
    if (!advance()) finishIfDone();
    return true;
  }

  function finishIfDone() {
    if (cfg.loop) return;
    stop();
    setStatus(`Done — ${sentCount} sent`);
  }

  // ---- series (burst) mode: fire the whole list in a row, then repeat ----

  const sleep = ms => new Promise(r => setTimeout(r, ms));

  async function runSeries() {
    const total = parsedPrompts().length;
    let sentInSeries = 0;
    while (seriesInProgress && sentInSeries < total) {
      const consumed = await sendCurrentPrompt();
      if (consumed === false || !seriesInProgress) break;
      sentInSeries++;
      if (sentInSeries >= total) break;
      await sleep(cfg.burstGapSec * 1000);
    }
    if (!running) return;
    seriesInProgress = false;
    seriesEndAt = Date.now();
    if (cfg.loop) updateCountdown(nextSeriesText());
    else finishIfDone();
  }

  function nextSeriesText() {
    const ms = seriesEndAt + cfg.intervalSec * 1000 - Date.now();
    return `${Math.max(0, Math.ceil(ms / 1000))}s → series`;
  }

  function shorten(s, n = 46) {
    return s.length > n ? s.slice(0, n - 1) + "…" : s;
  }

  // ---------- timing ----------

  function tick() {
    if (!running) return;
    const now = Date.now();

    if (cfg.burstMode) {
      if (seriesInProgress) {
        updateCountdown("sending series…");
        return;
      }
      if (now - seriesEndAt >= cfg.intervalSec * 1000) {
        seriesInProgress = true;
        runSeries();
      } else {
        updateCountdown(nextSeriesText());
      }
      return;
    }

    if (awaitingIdle) {
      const send = findSend();
      if (send && send.disabled) { updateCountdown("waiting for reply…"); return; }
      awaitingIdle = false;
      lastSentAt = now;
    }

    if (now - lastSentAt >= cfg.intervalSec * 1000) {
      lastSentAt = Date.now();
      sendCurrentPrompt().then(consumed => { if (consumed && cfg.waitForIdle) awaitingIdle = true; });
    }
    updateCountdown(Math.max(0, Math.ceil((lastSentAt + cfg.intervalSec * 1000 - Date.now()) / 1000)) + "s");
  }

  function updateCountdown(text) {
    countdownEl.textContent = text;
  }

  function setStatus(text) {
    statusEl.textContent = text;
  }

  function start() {
    if (running) return;
    if (parsedPrompts().length === 0) { setStatus("Add at least one prompt first"); return; }
    resetOrder();
    sentCount = 0;
    awaitingIdle = false;
    seriesInProgress = false;
    running = true;
    startBtn.textContent = "⏸ Pause";
    startBtn.dataset.on = "1";
    lastSentAt = Date.now();
    seriesEndAt = Date.now();
    tickHandle = setInterval(tick, 250);
    setStatus(cfg.burstMode
      ? `Series mode — ${parsedPrompts().length} prompts, repeat every ${cfg.intervalSec}s`
      : `Running — every ${cfg.intervalSec}s`);
  }

  function stop() {
    running = false;
    seriesInProgress = false;
    if (tickHandle) clearInterval(tickHandle);
    tickHandle = null;
    startBtn.textContent = "▶ Start";
    startBtn.dataset.on = "0";
    updateCountdown("–");
  }

  function toggle() {
    running ? stop() : start();
  }

  // ---------- calibration (click-to-select) ----------

  function uniqueSelector(el) {
    if (el.id) return "#" + CSS.escape(el.id);
    let path = [];
    let node = el;
    while (node && node.nodeType === 1 && node !== document.body && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      if (node.id) { path.unshift("#" + CSS.escape(node.id)); break; }
      if (node.classList.length) {
        part += "." + Array.from(node.classList).slice(0, 3).map(c => CSS.escape(c)).join(".");
      }
      const parent = node.parentElement;
      const siblings = parent ? Array.from(parent.children) : [];
      const same = siblings.filter(s => s.tagName === node.tagName);
      if (siblings.length > 1 && !node.classList.length) {
        part += ":nth-of-type(" + (same.indexOf(node) + 1) + ")";
      }
      path.unshift(part);
      node = parent;
    }
    const sel = path.join(" > ");
    return sel;
  }

  function calibrate(kind) {
    if (calibration) cancelCalibration();

    const overlayEl = document.createElement("div");
    overlayEl.style.cssText = [
      "position:fixed;inset:0;z-index:2147483646;background:rgba(0,0,0,.35);",
      "display:flex;align-items:center;justify-content:center;",
      "font:15px/1.5 system-ui,sans-serif;color:#fff;cursor:crosshair;",
      "pointer-events:none;", // let clicks pass through to the chat below
    ].join("");
    overlayEl.innerHTML =
      `<div style="background:#222;border:1px solid #555;border-radius:8px;padding:18px 22px;max-width:420px;text-align:center;pointer-events:none">
        <b style="font-size:17px">Click the ${kind === "input" ? "chat input box" : "send button"}</b><br>
        <span style="color:#ccc">(Esc to cancel)</span>
      </div>`;

    const cancel = () => { document.removeEventListener("click", onClick, true); document.removeEventListener("keydown", onKey, true); if (overlayEl.parentNode) overlayEl.parentNode.removeChild(overlayEl); calibration = null; };

    const onKey = e => { if (e.key === "Escape") { e.stopPropagation(); cancel(); } };

    const onClick = e => {
      if (e.target === overlayEl) return;
      e.preventDefault();
      e.stopPropagation();
      const target = e.target;
      const sel = uniqueSelector(target);
      if (kind === "input") cfg.inputSelector = sel;
      else cfg.sendSelector = sel;
      save();

      const old = target.style.outline;
      target.style.outline = "3px solid #2bbb00";
      setTimeout(() => { target.style.outline = old; }, 1200);

      const label = kind === "input" ? "input" : "send button";
      setStatus(`Saved ${label}: ${sel}`);
      cancel();
      renderSelectors();
    };

    calibration = { kind, overlayEl, cancel };
    document.addEventListener("click", onClick, true);
    document.addEventListener("keydown", onKey, true);
    document.body.appendChild(overlayEl);
  }

  function cancelCalibration() {
    if (calibration) { try { calibration.cancel(); } catch (e) {} calibration = null; }
  }

  // ---------- widget UI ----------

  let widget, headEl, bodyEl, countdownEl, statusEl, startBtn;

  function buildWidget() {
    const css = document.createElement("style");
    css.textContent = `
      #phcAutoWidget{position:fixed;right:14px;bottom:14px;z-index:2147483647;font:13px/1.45 system-ui,sans-serif;
        background:#1b1b1f;color:#e8e8ea;border:1px solid #3a3a44;border-radius:10px;box-shadow:0 6px 24px rgba(0,0,0,.45);
        width:300px;overflow:hidden;user-select:none}
      #phcAutoWidget *{box-sizing:border-box}
      #phcAutoWidget header{display:flex;align-items:center;gap:6px;padding:8px 10px;cursor:move;background:#26262e;font-weight:600}
      #phcAutoWidget header .dot{width:9px;height:9px;border-radius:50%;background:#777;display:inline-block}
      #phcAutoWidget header .dot.on{background:#2bbb00}
      #phcAutoWidget .body{padding:10px}
      #phcAutoWidget label{display:block;color:#9a9aa5;margin:8px 0 3px}
      #phcAutoWidget textarea,#phcAutoWidget input[type=number],#phcAutoWidget input[type=text]{width:100%;background:#26262e;color:#e8e8ea;border:1px solid #3a3a44;border-radius:6px;padding:6px 8px;font:12px/1.5 ui-monospace,monospace}
      #phcAutoWidget .row{display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap}
      #phcAutoWidget button{background:#2f6feb;color:#fff;border:none;border-radius:6px;padding:6px 10px;cursor:pointer;font-size:12px}
      #phcAutoWidget button.ghost{background:#33333d;color:#d8d8de}
      #phcAutoWidget button.stop{background:#c0392b}
      #phcAutoWidget .status{margin-top:8px;padding:6px 8px;background:#121216;border-radius:6px;color:#bdbdca;font-size:11px;min-height:30px;word-break:break-word}
      #phcAutoWidget .selrow{display:flex;gap:6px;align-items:center;margin-top:6px;font-size:11px;color:#9a9aa5}
      #phcAutoWidget .selrow input{flex:1;font-size:10px;padding:3px 5px}
      #phcAutoWidget .small{font-size:11px;color:#8a8a96}
      #phcAutoWidget .collapse{float:right;background:none;border:none;color:#9a9aa5;padding:0 2px;cursor:pointer;font-size:14px}
    `;
    document.head.appendChild(css);

    widget = document.createElement("div");
    widget.id = "phcAutoWidget";

    const drag = { mx: 0, my: 0 };
    widget.innerHTML = `
      <header>
        <span class="dot" id="phcStateDot"></span>
        <span>🤖 Helper Chat Autosender</span>
        <button class="collapse" id="phcCollapseBtn" title="Minimize">—</button>
      </header>
      <div class="body" id="phcBody">
        <label>Prompts (one per line)</label>
        <textarea id="phcPrompts" rows="6" spellcheck="false" placeholder="One prompt per line…"></textarea>

        <div class="row">
          <label style="margin:0" id="phcIntervalLabel">Every</label>
          <input type="number" id="phcInterval" min="2" step="1" style="width:70px" title="Seconds between sends">
          <label style="margin:0">seconds</label>
        </div>
        <div class="row" id="phcGapRow" style="display:none">
          <label style="margin:0">Gap between prompts</label>
          <input type="number" id="phcGap" min="1" step="1" style="width:70px" title="Seconds between prompts inside a series">
          <label style="margin:0">seconds</label>
        </div>

        <div class="row">
          <label style="margin:0" title="Send the whole prompt list as a rapid series, then repeat the series after the interval"><input type="checkbox" id="phcBurst"> Series mode</label>
          <label style="margin:0"><input type="checkbox" id="phcLoop"> Loop</label>
          <label style="margin:0"><input type="checkbox" id="phcShuffle"> Shuffle</label>
          <label style="margin:0" title="Skip a prompt if the chat box already has text in it"><input type="checkbox" id="phcSkip"> Skip if busy</label>
          <label style="margin:0" title="Wait for the AI's reply to finish before the next send"><input type="checkbox" id="phcIdle"> Wait for reply</label>
          <label style="margin:0" title="Dispatch Ctrl+S (keyboard save shortcut) before sending each prompt"><input type="checkbox" id="phcCtrlS"> Ctrl+S before send</label>
        </div>

        <div class="row">
          <button id="phcStartBtn">▶ Start</button>
          <button class="ghost" id="phcNowBtn" title="Send the next prompt right now">Send now</button>
        </div>

        <div class="status" id="phcStatus">Configured. Press Start.</div>
        <div class="small" style="margin-top:6px"><span id="phcNextLabel">Next send</span>: <span id="phcCountdown">–</span> · Sent: <span id="phcSent">0</span></div>

        <label style="margin-top:10px">Calibration (only needed if it picks the wrong box)</label>
        <div class="selrow">
          <button class="ghost" id="phcPickInput">Select input…</button>
          <button class="ghost" id="phcPickSend">Select send…</button>
        </div>
        <div class="selrow" style="margin-top:4px">
          <input type="text" id="phcInputSel" placeholder="input selector" title="CSS selector for the chat input">
          <input type="text" id="phcSendSel" placeholder="send selector" title="CSS selector for the send button">
        </div>
      </div>
    `;
    document.body.appendChild(widget);

    widget.querySelector("#phcCollapseBtn").onclick = e => {
      const body = widget.querySelector(".body");
      body.style.display = body.style.display === "none" ? "" : "none";
      e.target.textContent = body.style.display === "none" ? "+" : "—";
    };

    // drag
    widget.querySelector("header").addEventListener("mousedown", e => {
      if (e.target.closest(".collapse")) return;
      drag.mx = e.clientX - widget.getBoundingClientRect().left;
      drag.my = e.clientY - widget.getBoundingClientRect().top;
      const move = ev => {
        widget.style.left = Math.max(0, Math.min(window.innerWidth - 60, ev.clientX - drag.mx)) + "px";
        widget.style.right = "auto";
        widget.style.bottom = "auto";
        widget.style.top = Math.max(0, Math.min(window.innerHeight - 40, ev.clientY - drag.my)) + "px";
      };
      const up = () => { document.removeEventListener("mousemove", move); document.removeEventListener("mouseup", up); };
      document.addEventListener("mousemove", move);
      document.addEventListener("mouseup", up);
    });

    const promptsEl = widget.querySelector("#phcPrompts");
    const intervalEl = widget.querySelector("#phcInterval");
    const burstEl = widget.querySelector("#phcBurst");
    const gapEl = widget.querySelector("#phcGap");
    const intervalLabelEl = widget.querySelector("#phcIntervalLabel");
    const gapRowEl = widget.querySelector("#phcGapRow");
    const nextLabelEl = widget.querySelector("#phcNextLabel");
    const loopEl = widget.querySelector("#phcLoop");
    const shuffleEl = widget.querySelector("#phcShuffle");
    const skipEl = widget.querySelector("#phcSkip");
    const idleEl = widget.querySelector("#phcIdle");
    const ctrlSEl = widget.querySelector("#phcCtrlS");
    startBtn = widget.querySelector("#phcStartBtn");
    countdownEl = widget.querySelector("#phcCountdown");
    statusEl = widget.querySelector("#phcStatus");
    const sentEl = widget.querySelector("#phcSent");
    const stateDot = widget.querySelector("#phcStateDot");

    promptsEl.value = (cfg.prompts || []).join("\n");
    intervalEl.value = cfg.intervalSec;
    burstEl.checked = cfg.burstMode;
    gapEl.value = cfg.burstGapSec;
    loopEl.checked = cfg.loop;
    shuffleEl.checked = cfg.shuffle;
    skipEl.checked = cfg.skipIfInputHasText;
    idleEl.checked = cfg.waitForIdle;
    ctrlSEl.checked = cfg.ctrlSBeforeSend;

    promptsEl.oninput = () => { cfg.prompts = promptsEl.value.split(/\n+/).map(s => s.trim()).filter(Boolean); save(); };
    intervalEl.oninput = () => { cfg.intervalSec = Math.max(2, Number(intervalEl.value) || 2); save(); if (running) setStatus(`Running — every ${cfg.intervalSec}s`); };
    burstEl.onchange = () => { cfg.burstMode = burstEl.checked; save(); updateBurstUI(); if (running) setStatus(cfg.burstMode ? "Series mode running" : `Running — every ${cfg.intervalSec}s`); };
    gapEl.oninput = () => { cfg.burstGapSec = Math.max(1, Number(gapEl.value) || 2); save(); };
    loopEl.onchange = () => { cfg.loop = loopEl.checked; save(); };
    shuffleEl.onchange = () => { cfg.shuffle = shuffleEl.checked; save(); };
    skipEl.onchange = () => { cfg.skipIfInputHasText = skipEl.checked; save(); };
    idleEl.onchange = () => { cfg.waitForIdle = idleEl.checked; save(); };
    ctrlSEl.onchange = () => { cfg.ctrlSBeforeSend = ctrlSEl.checked; save(); };

    function updateBurstUI() {
      gapRowEl.style.display = cfg.burstMode ? "" : "none";
      intervalLabelEl.textContent = cfg.burstMode ? "Repeat series every" : "Every";
      nextLabelEl.textContent = cfg.burstMode ? "Next series" : "Next send";
      idleEl.disabled = cfg.burstMode;
      idleEl.title = cfg.burstMode ? "Series mode always sends in a row — this applies to single-step mode only" : idleEl.title;
    }
    updateBurstUI();

    startBtn.onclick = toggle;
    widget.querySelector("#phcNowBtn").onclick = () => {
      if (!running) start();
      if (cfg.burstMode) {
        if (!seriesInProgress) { seriesInProgress = true; runSeries(); }
      } else {
        sendCurrentPrompt().then(() => { lastSentAt = Date.now(); });
      }
    };
    widget.querySelector("#phcPickInput").onclick = () => calibrate("input");
    widget.querySelector("#phcPickSend").onclick = () => calibrate("send");

    const inputSelEl = widget.querySelector("#phcInputSel");
    const sendSelEl = widget.querySelector("#phcSendSel");
    inputSelEl.onchange = () => { cfg.inputSelector = inputSelEl.value.trim(); save(); };
    sendSelEl.onchange = () => { cfg.sendSelector = sendSelEl.value.trim(); save(); };
    renderSelectors = () => { inputSelEl.value = cfg.inputSelector || ""; sendSelEl.value = cfg.sendSelector || ""; };

    // live status mirror
    Object.defineProperty(window, "__phcStatus", { get: () => statusEl.textContent });
    const uiRefresh = setInterval(() => {
      stateDot.className = "dot" + (running ? " on" : "");
      startBtn.textContent = running ? "⏸ Pause" : "▶ Start";
      sentEl.textContent = sentCount;
    }, 500);
    window.addEventListener("unload", () => clearInterval(uiRefresh));
  }

  let renderSelectors = function () {};

  // ---------- boot ----------

  function boot() {
    if (document.getElementById("phcAutoWidget")) return;
    buildWidget();
    renderSelectors();
    setStatus("Autosender ready. Press Start.");
  }

  try { GM_registerMenuCommand("Toggle autosender", toggle); } catch (e) {}
  try { GM_registerMenuCommand("Start autosender", start); } catch (e) {}
  try { GM_registerMenuCommand("Stop autosender", stop); } catch (e) {}

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", boot);
  } else {
    boot();
  }
})();
