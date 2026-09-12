/*
 * ai-panel.js — the "No-Limit AI" overlay: a text assistant and a vision reader,
 * both driven by the app's ai-text-plugin and both obeying the no-limit rule in
 * ./nolimit.js.
 *
 * Two modes:
 *   • Chat   — a streaming free-form assistant. The transcript is kept
 *              append-only and the task sits at the END of the prompt, so
 *              successive turns hit the service's prefix cache and answer fast.
 *   • Vision — hand it an image (drop / paste / pick a file, reuse the last
 *              generated image, or snapshot the live 3D viewport) and ask
 *              anything about it. Answers stream in.
 *
 * The rule tab exposes the directive itself: a master switch (default ON) and an
 * editable body per call site. Everything is persisted by ./nolimit.js.
 */

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

const CHAT_BASE =
  "You are the built-in assistant of a browser-based text-to-3D generator. You help with 3D models, " +
  "rigging and animation, Blender/glTF workflows, image generation prompts, and scripting the app. " +
  "Answer the user directly and usefully. Keep answers focused; use short paragraphs or lists.";

import { openVideo } from "./video.js";

function dataUrlToBlob(dataUrl) {
  const [head, body] = String(dataUrl).split(",");
  const mime = (head.match(/data:([^;]+)/) || [, "image/png"])[1];
  const bin = atob(body || "");
  const arr = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
  return new Blob([arr], { type: mime });
}

export function createAiPanel({ getNoLimit, getGeneratedImage, captureViewport, getAiAnim, onAnimateDone, toast } = {}) {
  let panel = null;
  let open = false;
  let tab = "chat";

  const messages = []; // { role: 'user'|'ai', text }
  let busy = false;
  let current = null; // active generateText promise (has .stop())

  let visBlob = null;
  let visMode = "image"; // 'image' | 'video'
  let visFrames = 0;
  const visLog = []; // { q, a }

  const aiAnim = () => (typeof getAiAnim === "function" ? getAiAnim() : null);
  let animAppend = false;

  const domRefs = {};

  const nl = () => (typeof getNoLimit === "function" ? getNoLimit() : null);

  /* ------------------------------------------------------------------ build */

  function build() {
    panel = el("div", "testsOverlay aiOverlay");
    panel.hidden = true;
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "No-Limit AI");

    const sheet = el("div", "testsSheet aiSheet");
    const head = el("div", "testsHead");
    head.append(el("span", "testsTitle", "No-Limit AI"));
    const lock = el("span", "aiLock", "🔓");
    head.append(lock);
    head.append(el("div", "testsSpacer"));
    domRefs.status = el("span", "aiStatus");
    head.append(domRefs.status);
    const closeBtn = el("button", "btn ghost testsClose", "\u00d7");
    closeBtn.title = "Close";
    closeBtn.addEventListener("click", close);
    head.append(closeBtn);

    const tabs = el("div", "libTabs aiTabs");
    const mkTab = (id, label) => {
      const b = el("button", "libTab", label);
      b.addEventListener("click", () => showTab(id));
      b.dataset.tab = id;
      return b;
    };
    tabs.append(
      mkTab("chat", "Chat"),
      mkTab("vision", "Vision"),
      mkTab("animate", "Animate ✨"),
      mkTab("rule", "Rule 🔓"),
    );
    domRefs.tabs = tabs;

    const body = el("div", "aiBody");
    domRefs.chat = buildChat();
    domRefs.vision = buildVision();
    domRefs.animate = buildAnimate();
    domRefs.rule = buildRule();
    body.append(domRefs.chat, domRefs.vision, domRefs.animate, domRefs.rule);

    sheet.append(head, tabs, body);
    panel.append(sheet);
    panel.addEventListener("click", (e) => {
      if (e.target === panel) close();
    });
    (document.getElementById("app") || document.body).append(panel);
    showTab(tab);
    syncRuleUI();
    return panel;
  }

  /* ------------------------------------------------------------------- chat */

  function buildChat() {
    const view = el("div", "aiView");
    const list = el("div", "aiChat");
    domRefs.chatList = list;

    const composer = el("div", "aiComposer");
    const input = document.createElement("textarea");
    input.rows = 2;
    input.placeholder = "Ask anything…  (Enter to send, Shift+Enter for a newline)";
    input.className = "aiInput";
    domRefs.chatInput = input;

    const send = el("button", "btn primary", "Send");
    send.addEventListener("click", sendChat);
    const stopBtn = el("button", "btn ghost", "Stop");
    stopBtn.hidden = true;
    stopBtn.addEventListener("click", stopChat);
    const clearBtn = el("button", "btn ghost", "Clear");
    clearBtn.addEventListener("click", () => {
      messages.length = 0;
      renderChat();
    });
    domRefs.chatSend = send;
    domRefs.chatStop = stopBtn;

    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        sendChat();
      }
    });

    const btnRow = el("div", "aiComposerBtns");
    btnRow.append(send, stopBtn, clearBtn);
    composer.append(input, btnRow);
    view.append(list, composer);
    return view;
  }

  function renderChat() {
    const list = domRefs.chatList;
    if (!list) return;
    list.innerHTML = "";
    if (!messages.length) {
      list.append(
        el(
          "div",
          "aiHint",
          "No messages yet. Ask about rigging, animation, Blender export, image prompts, or anything else — the no-limit rule is applied.",
        ),
      );
      return;
    }
    for (const m of messages) appendBubble(list, m.role, m.text);
    list.scrollTop = list.scrollHeight;
  }

  function appendBubble(list, role, text) {
    const row = el("div", "aiMsg " + (role === "user" ? "user" : "ai"));
    const who = el("div", "aiWho", role === "user" ? "You" : "AI");
    const body = el("div", "aiText");
    body.textContent = text || "";
    row.append(who, body);
    list.append(row);
    list.scrollTop = list.scrollHeight;
    return body;
  }

  function buildChatPrompt() {
    const base = nl() ? nl().apply("text", CHAT_BASE) : CHAT_BASE;
    const log = messages.map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.text).join("\n\n");
    return `${base}\n\n<CONVERSATION>\n${log}\n</CONVERSATION>\nTASK: Reply as the Assistant to the last User message. Output ONLY the reply text.`;
  }

  async function sendChat() {
    const input = domRefs.chatInput;
    if (!input || busy) return;
    const text = input.value.trim();
    if (!text) return;
    if (!window.root || !window.root.generateText) {
      toast && toast("Text AI unavailable", 2600);
      return;
    }
    input.value = "";
    messages.push({ role: "user", text });
    renderChat();
    const list = domRefs.chatList;
    const body = appendBubble(list, "ai", "");
    const wait = appendWaiting(body);
    busy = true;
    setBusy(true);
    try {
      const promise = window.root.generateText({
        instruction: buildChatPrompt(),
        onChunk: (d) => {
          body.textContent = d.fullTextSoFar;
          list.scrollTop = list.scrollHeight;
        },
      });
      current = promise;
      const out = await promise;
      const full = String((out && out.text) || out || "").trim();
      body.textContent = full;
      messages.push({ role: "ai", text: full });
    } catch (e) {
      body.textContent = "⚠️ " + (e && e.message ? e.message : String(e));
    } finally {
      wait.remove();
      busy = false;
      current = null;
      setBusy(false);
      renderChat();
    }
  }

  function appendWaiting(afterEl) {
    const w = el("span", "aiDots");
    for (let i = 0; i < 3; i++) w.append(el("i"));
    afterEl.after(w);
    return w;
  }

  function stopChat() {
    if (current && typeof current.stop === "function") {
      try {
        current.stop();
      } catch (e) {
        /* ignore */
      }
    }
    busy = false;
    setBusy(false);
  }

  function setBusy(on) {
    if (domRefs.chatSend) domRefs.chatSend.disabled = on;
    if (domRefs.chatStop) domRefs.chatStop.hidden = !on;
    if (domRefs.status) domRefs.status.textContent = on ? "generating…" : "";
  }

  /* ----------------------------------------------------------------- vision */

  function buildVision() {
    const view = el("div", "aiView");
    view.append(el("div", "aiHint", "Give the AI an image — or a whole video — and ask about it. Drop/pick an image, load a video (frames are sampled into a contact sheet the model reads in order), reuse the last generated image, or snapshot the live 3D view."));

    const drop = el("div", "aiDrop");
    domRefs.visImg = el("img", "aiThumbPreview");
    domRefs.visImg.hidden = true;
    domRefs.visImg.alt = "vision input";
    const empty = el("span", "aiDropEmpty", "\u2b1c  drop / click an image");
    drop.append(domRefs.visImg, empty);
    domRefs.visEmpty = empty;
    const file = document.createElement("input");
    file.type = "file";
    file.accept = "image/*,video/*";
    file.hidden = true;
    drop.append(file);
    drop.addEventListener("click", () => file.click());
    file.addEventListener("change", () => {
      if (file.files && file.files[0]) setVisionFile(file.files[0]);
    });
    drop.addEventListener("dragover", (e) => {
      e.preventDefault();
      drop.classList.add("over");
    });
    drop.addEventListener("dragleave", () => drop.classList.remove("over"));
    drop.addEventListener("drop", (e) => {
      e.preventDefault();
      drop.classList.remove("over");
      const f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) setVisionFile(f);
    });
    view.append(drop);

    const srcRow = el("div", "testRow");
    const useGen = el("button", "btn ghost", "Last generated");
    useGen.title = "Use the most recent AI image";
    useGen.addEventListener("click", () => {
      const src = getGeneratedImage && getGeneratedImage();
      if (!src) {
        toast && toast("No generated image yet", 2400);
        return;
      }
      setVisionUrl(src, "generated image");
    });
    const useView = el("button", "btn ghost", "Snapshot 3D view");
    useView.title = "Capture the current viewport";
    useView.addEventListener("click", () => {
      const src = captureViewport && captureViewport();
      if (!src) {
        toast && toast("Nothing to capture", 2400);
        return;
      }
      setVisionUrl(src, "3D viewport");
    });
    srcRow.append(useGen, useView);
    view.append(srcRow);

    const videoRow = el("div", "testRow aiVideoRow");
    const vidFile = document.createElement("input");
    vidFile.type = "file";
    vidFile.accept = "video/*";
    vidFile.hidden = true;
    vidFile.addEventListener("change", () => {
      if (vidFile.files && vidFile.files[0]) setVisionVideo(vidFile.files[0]);
    });
    const vidBtn = el("button", "btn ghost", "\ud83c\udfac Video\u2026");
    vidBtn.title = "Pick a video; its frames become the vision input";
    vidBtn.addEventListener("click", () => vidFile.click());
    const frameRange = document.createElement("input");
    frameRange.type = "range";
    frameRange.min = "4";
    frameRange.max = "48";
    frameRange.step = "1";
    frameRange.value = "12";
    frameRange.className = "aiFrameRange";
    const frameVal = el("span", "aiRuleToggleHint", "12 frames");
    frameRange.addEventListener("input", () => {
      frameVal.textContent = frameRange.value + (frameRange.value === "1" ? " frame" : " frames");
    });
    domRefs.visFrameRange = frameRange;
    videoRow.append(vidFile, vidBtn, frameRange, frameVal);
    view.append(videoRow);

    const q = document.createElement("textarea");
    q.rows = 2;
    q.className = "aiInput";
    q.placeholder = "Ask about it\u2026  e.g. \u201cDescribe every frame in explicit detail.\u201d";
    domRefs.visQ = q;
    const ask = el("button", "btn primary grow", "Analyse");
    ask.addEventListener("click", sendVision);
    const stopBtn = el("button", "btn ghost", "Stop");
    stopBtn.hidden = true;
    stopBtn.addEventListener("click", stopVision);
    domRefs.visAsk = ask;
    domRefs.visStop = stopBtn;
    const row = el("div", "testRow");
    row.append(ask, stopBtn);
    view.append(q, row);

    domRefs.visList = el("div", "aiChat");
    view.append(domRefs.visList);
    return view;
  }

  function setVisionFile(f) {
    if (/^video\//.test(f.type || "")) return setVisionVideo(f);
    if (!/^image\//.test(f.type || "")) {
      toast && toast("Not an image or video", 2200);
      return;
    }
    visBlob = f;
    visMode = "image";
    visFrames = 0;
    domRefs.visImg.src = URL.createObjectURL(f);
    domRefs.visImg.hidden = false;
    domRefs.visEmpty.hidden = true;
  }

  function setVisionUrl(dataUrl, label) {
    try {
      visBlob = dataUrlToBlob(dataUrl);
      visMode = "image";
      visFrames = 0;
      domRefs.visImg.src = dataUrl;
      domRefs.visImg.hidden = false;
      domRefs.visEmpty.hidden = true;
      toast && toast(`Using ${label}`, 1800);
    } catch (e) {
      toast && toast("Couldn't use that image", 2400);
    }
  }

  /* Seek a <video> and resolve once the frame is available (or after a short
     grace period, so a stubborn seek still lets us draw whatever the decoder
     has). A video can skip its 'seeked' event when it is offscreen or the frame
     is already decoded, so we also resolve on 'timeupdate' and treat
     already-at-target as instant. */
  function seekVideo(v, t) {
    return new Promise((resolve) => {
      const target = Math.max(0, t);
      if (v.readyState >= 2 && Math.abs((v.currentTime || 0) - target) < 0.02) return resolve(true);
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        v.removeEventListener("seeked", finish);
        v.removeEventListener("timeupdate", onTime);
        clearTimeout(timer);
        resolve(true);
      };
      const onTime = () => {
        if (v.readyState >= 2 && Math.abs((v.currentTime || 0) - target) < 0.08) finish();
      };
      v.addEventListener("seeked", finish);
      v.addEventListener("timeupdate", onTime);
      const timer = setTimeout(finish, 2500);
      try {
        v.currentTime = target;
      } catch (e) {
        finish();
      }
    });
  }

  /* Wait until a <video> has a frame we can draw. Resolves true on the first of
     loadeddata/canplay, false on error or timeout. */
  function waitVideoReady(v) {
    return new Promise((resolve) => {
      if (v.readyState >= 2) return resolve(true);
      let done = false;
      const cleanup = () => {
        clearTimeout(timer);
        v.removeEventListener("loadeddata", ok);
        v.removeEventListener("canplay", ok);
        v.removeEventListener("error", bad);
      };
      const ok = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve(true);
      };
      const bad = () => {
        if (done) return;
        done = true;
        cleanup();
        resolve(false);
      };
      const timer = setTimeout(bad, 15000);
      v.addEventListener("loadeddata", ok);
      v.addEventListener("canplay", ok);
      v.addEventListener("error", bad);
    });
  }

  /* Freshly recorded streams (webm) often report a non-finite duration until the
     browser is poked into computing it. Seek far ahead, wait for
     'durationchange', then rewind; 0 means the duration is genuinely unknown. */
  function videoDuration(v) {
    if (isFinite(v.duration) && v.duration > 0) return Promise.resolve(v.duration);
    return new Promise((resolve) => {
      let done = false;
      const finish = () => {
        if (done) return;
        done = true;
        v.removeEventListener("durationchange", finish);
        clearTimeout(timer);
        resolve(isFinite(v.duration) && v.duration > 0 ? v.duration : 0);
      };
      v.addEventListener("durationchange", finish);
      const timer = setTimeout(finish, 3000);
      try {
        v.currentTime = 1e7;
      } catch (e) {
        finish();
      }
    });
  }

  /* Sample `count` frames evenly across a video into one numbered contact sheet.
     A single image is all the vision model accepts, so the sheet is how the app
     gives it the whole clip to read in order. */
  /* Frame sampling via WebCodecs (mediabunny) — the path that works in the
     editor preview, where a <video> element never loads. Falls back to the
     element-based reader in a normal browser (or for a codec WebCodecs rejects). */
  async function videoContactSheet(file, count) {
    const n = Math.max(2, Math.min(Math.round(count) || 12, 48));
    const session = await openVideo(file).catch(() => null);
    if (!session) return videoContactSheetElement(file, count);
    try {
      const dur = session.duration || 0;
      const ar = session.width ? session.height / session.width : 9 / 16;
      const timestamps = [];
      for (let i = 0; i < n; i++) timestamps.push(dur ? (dur * (i + 0.5)) / n : 0);
      const frames = await session.framesAt(timestamps);
      const cols = Math.min(n, Math.max(2, Math.round(Math.sqrt(n * 1.6))));
      const rows = Math.ceil(n / cols);
      const fw = Math.max(120, Math.min(420, Math.round(1600 / cols)));
      const fh = Math.max(1, Math.round(fw * ar));
      const canvas = document.createElement("canvas");
      canvas.width = cols * fw;
      canvas.height = rows * fh;
      const g = canvas.getContext("2d");
      g.fillStyle = "#000";
      g.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < n; i++) {
        const cx = (i % cols) * fw;
        const cy = Math.floor(i / cols) * fh;
        if (frames[i]) {
          try {
            g.drawImage(frames[i], cx, cy, fw, fh);
          } catch (e) {
            /* leave black */
          }
        }
        g.fillStyle = "rgba(0,0,0,.62)";
        g.fillRect(cx, cy, 30, 15);
        g.fillStyle = "#fff";
        g.font = "11px monospace";
        g.fillText(String(i + 1), cx + 5, cy + 11);
      }
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      if (!blob) throw new Error("Could not build the frame sheet");
      return { blob, dataUrl, count: n, cols, rows };
    } finally {
      session.dispose();
    }
  }

  /* Fallback: seek a hidden <video> element and draw each frame. Works in a
     normal browser; the editor preview throttles media loading so this path
     cannot complete there. */
  async function videoContactSheetElement(file, count) {
    const url = URL.createObjectURL(file);
    const v = document.createElement("video");
    v.muted = true;
    v.playsInline = true;
    v.preload = "auto";
    v.setAttribute("playsinline", "");
    v.style.cssText = "position:fixed;left:-99999px;top:0;width:2px;height:2px;opacity:0;pointer-events:none";
    document.body.append(v);
    const cleanup = () => {
      try {
        v.pause();
        v.removeAttribute("src");
        v.load();
      } catch (e) {
        /* ignore */
      }
      v.remove();
      URL.revokeObjectURL(url);
    };
    try {
      v.src = url;
      const ready = await waitVideoReady(v);
      if (!ready) throw new Error("Could not decode that video");
      try {
        v.currentTime = 0;
      } catch (e) {
        /* ignore */
      }
      const dur = (await videoDuration(v)) || (isFinite(v.duration) ? v.duration : 0) || 0;
      const n = Math.max(2, Math.min(Math.round(count) || 12, 48));
      const cols = Math.min(n, Math.max(2, Math.round(Math.sqrt(n * 1.6))));
      const rows = Math.ceil(n / cols);
      const fw = Math.max(120, Math.min(420, Math.round(1600 / cols)));
      const ar = v.videoWidth ? v.videoHeight / v.videoWidth : 9 / 16;
      const fh = Math.max(1, Math.round(fw * ar));
      const canvas = document.createElement("canvas");
      canvas.width = cols * fw;
      canvas.height = rows * fh;
      const g = canvas.getContext("2d");
      g.fillStyle = "#000";
      g.fillRect(0, 0, canvas.width, canvas.height);
      for (let i = 0; i < n; i++) {
        const t = dur ? (dur * (i + 0.5)) / n : 0;
        await seekVideo(v, t);
        const cx = (i % cols) * fw;
        const cy = Math.floor(i / cols) * fh;
        try {
          g.drawImage(v, cx, cy, fw, fh);
        } catch (e) {
          /* leave black */
        }
        g.fillStyle = "rgba(0,0,0,.62)";
        g.fillRect(cx, cy, 30, 15);
        g.fillStyle = "#fff";
        g.font = "11px monospace";
        g.fillText(String(i + 1), cx + 5, cy + 11);
      }
      const dataUrl = canvas.toDataURL("image/jpeg", 0.9);
      const blob = await new Promise((res) => canvas.toBlob(res, "image/jpeg", 0.92));
      if (!blob) throw new Error("Could not build the frame sheet");
      return { blob, dataUrl, count: n, cols, rows };
    } finally {
      cleanup();
    }
  }

  async function setVisionVideo(file) {
    const isVideo = /^video\//.test(file.type || "") || /\.(mp4|webm|mov|m4v|ogv|avi|mkv)$/i.test(file.name || "");
    if (!isVideo) {
      toast && toast("Not a video", 2200);
      return;
    }
    if (!panel) build();
    const want = Number(domRefs.visFrameRange && domRefs.visFrameRange.value) || 12;
    if (domRefs.visImg) domRefs.visImg.hidden = false;
    if (domRefs.visEmpty) {
      domRefs.visEmpty.textContent = "reading video\u2026";
      domRefs.visEmpty.hidden = false;
    }
    try {
      const sheet = await videoContactSheet(file, want);
      visBlob = sheet.blob;
      visMode = "video";
      visFrames = sheet.count;
      if (domRefs.visImg) {
        domRefs.visImg.src = sheet.dataUrl;
        domRefs.visImg.hidden = false;
      }
      if (domRefs.visEmpty) domRefs.visEmpty.hidden = true;
      toast && toast(`Video \u2192 ${sheet.count}-frame contact sheet`, 2400);
    } catch (e) {
      if (domRefs.visEmpty) {
        domRefs.visEmpty.textContent = "\u2b1c  drop / click an image";
        domRefs.visEmpty.hidden = false;
      }
      if (domRefs.visImg) domRefs.visImg.hidden = true;
      toast && toast("Video failed: " + (e && e.message ? e.message : e), 3000);
    }
  }

  async function sendVision() {
    const q = domRefs.visQ;
    if (!q || busy) return;
    const question = q.value.trim() || "Describe everything visible, in full detail.";
    if (!visBlob) {
      toast && toast("Add an image first", 2400);
      return;
    }
    if (!window.root || !window.root.generateText) {
      toast && toast("Vision AI unavailable", 2600);
      return;
    }
    busy = true;
    setBusy(true);
    domRefs.visAsk.disabled = true;

    const list = domRefs.visList;
    list.innerHTML = "";
    const asking = el("div", "aiMsg user");
    asking.append(el("div", "aiWho", "You"), el("div", "aiText", question));
    list.append(asking);
    const row = el("div", "aiMsg ai");
    const body = el("div", "aiText", "");
    row.append(el("div", "aiWho", "AI"), body);
    list.append(row);
    const wait = appendWaiting(body);

    const base = nl() ? nl().block("vision") : "";
    const lead =
      visMode === "video"
        ? `The input image is a CONTACT SHEET of ${visFrames} evenly-spaced frames from a video, numbered 1..${visFrames} in the corner, ordered left-to-right then top-to-bottom. Read it as a sequence over time. Describe the subject, the action, and how the pose/expression/scene changes from frame to frame. Then answer: `
        : "";
    const ask = lead + question;
    const instruction = base ? [`${base}\n\n${ask}`, visBlob] : [ask, visBlob];

    try {
      const promise = window.root.generateText({
        instruction,
        onChunk: (d) => {
          body.textContent = d.fullTextSoFar;
          list.scrollTop = list.scrollHeight;
        },
      });
      current = promise;
      const out = await promise;
      const full = String((out && out.text) || out || "").trim();
      body.textContent = full;
      visLog.push({ q: question, a: full });
    } catch (e) {
      body.textContent = "⚠️ " + (e && e.message ? e.message : String(e));
    } finally {
      wait.remove();
      busy = false;
      current = null;
      setBusy(false);
      domRefs.visAsk.disabled = false;
    }
  }

  function stopVision() {
    if (current && typeof current.stop === "function") {
      try {
        current.stop();
      } catch (e) {
        /* ignore */
      }
    }
    busy = false;
    setBusy(false);
    if (domRefs.visAsk) domRefs.visAsk.disabled = false;
  }

  /* ----------------------------------------------------------------- animate */

  function buildAnimate() {
    const view = el("div", "aiView aiAnimView");
    view.append(
      el(
        "div",
        "aiHint",
        "Describe a motion \u2014 the AI writes the keyframes and bakes them onto the loaded rig. Open Rig \u25b8 Keyframes to scrub, refine, loop and export an animated GLB. No-limit: explicit motions are keyed accurately, not euphemised.",
      ),
    );

    const chips = el("div", "aiChips");
    const SAMPLES = [
      "slow seductive walk, hips swaying",
      "confident runway strut",
      "hip thrust",
      "grinding on hands and knees",
      "riding, bouncing on top",
      "stripping slowly",
      "blowjob head bob",
      "wave hello",
      "nervous idle",
      "punch and recoil",
    ];
    for (const s of SAMPLES) {
      const c = el("button", "aiChip", s);
      c.addEventListener("click", () => {
        if (domRefs.animInput) domRefs.animInput.value = s;
      });
      chips.append(c);
    }
    view.append(chips);

    const input = document.createElement("textarea");
    input.rows = 3;
    input.className = "aiInput";
    input.placeholder =
      "Describe the motion\u2026  e.g. \u201ca slow explicit grind, hips circling, back arched, hands braced on the floor\u201d";
    domRefs.animInput = input;
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        sendAnimate();
      }
    });
    view.append(input);

    const row = el("div", "testRow");
    const gen = el("button", "btn primary grow", "Generate animation");
    gen.addEventListener("click", sendAnimate);
    const stopBtn = el("button", "btn ghost", "Stop");
    stopBtn.hidden = true;
    stopBtn.addEventListener("click", () => {
      const a = aiAnim();
      if (a) a.stop();
      setBusy(false);
    });
    const modeBtn = el("button", "addonToggle", "Replace");
    modeBtn.title = "Replace the existing keys (click to append instead)";
    modeBtn.addEventListener("click", () => {
      animAppend = !animAppend;
      modeBtn.textContent = animAppend ? "Append" : "Replace";
      modeBtn.classList.toggle("on", animAppend);
    });
    domRefs.animGen = gen;
    domRefs.animStop = stopBtn;
    domRefs.animMode = modeBtn;
    row.append(gen, stopBtn, modeBtn);
    view.append(row);

    domRefs.animStatus = el("div", "aiAnimStatus rigMuted", "");
    domRefs.animOut = el("pre", "aiAnimRaw");
    domRefs.animOut.hidden = true;
    view.append(domRefs.animStatus, domRefs.animOut);
    return view;
  }

  async function sendAnimate() {
    if (busy) return;
    const a = aiAnim();
    if (!a) {
      toast && toast("Animation AI unavailable", 2400);
      return;
    }
    const desc = domRefs.animInput ? domRefs.animInput.value.trim() : "";
    if (!desc) {
      toast && toast("Describe the motion first", 2200);
      return;
    }
    if (!a.hasRig) {
      toast && toast("Load a rigged model first", 2600);
      return;
    }
    busy = true;
    setBusy(true);
    if (domRefs.animGen) domRefs.animGen.disabled = true;
    if (domRefs.animStop) domRefs.animStop.hidden = false;
    if (domRefs.animStatus) domRefs.animStatus.textContent = "Writing keyframes\u2026";
    if (domRefs.animOut) {
      domRefs.animOut.textContent = "";
      domRefs.animOut.hidden = false;
    }
    try {
      const res = await a.generate(desc, {
        append: animAppend,
        onChunk: (d) => {
          if (!domRefs.animOut) return;
          domRefs.animOut.textContent =
            d && d.fullTextSoFar != null ? d.fullTextSoFar : domRefs.animOut.textContent + ((d && d.textChunk) || "");
          domRefs.animOut.scrollTop = domRefs.animOut.scrollHeight;
        },
      });
      if (domRefs.animStatus) {
        domRefs.animStatus.textContent = `\u2705 "${res.name}" \u2014 ${res.keys} keys \u00b7 ${res.duration.toFixed(1)}s. Open Rig \u25b8 Keyframes to play or export.`;
      }
      if (domRefs.animOut) domRefs.animOut.hidden = true;
      toast && toast("AI animation baked", 2200);
      if (typeof onAnimateDone === "function") {
        try {
          onAnimateDone(res);
        } catch (e) {
          /* ignore */
        }
      }
    } catch (e) {
      const msg = e && e.message ? e.message : String(e);
      if (domRefs.animStatus) domRefs.animStatus.textContent = "\u26a0\ufe0f " + msg;
    } finally {
      busy = false;
      setBusy(false);
      if (domRefs.animGen) domRefs.animGen.disabled = false;
      if (domRefs.animStop) domRefs.animStop.hidden = true;
    }
  }

  /* ------------------------------------------------------------------- rule */

  function buildRule() {
    const view = el("div", "aiView aiRuleView");
    const card = el("div", "aiRuleCard");

    const head = el("div", "testRow");
    const sw = el("button", "addonToggle", "On");
    sw.title = "Toggle the no-limit rule everywhere";
    sw.addEventListener("click", async () => {
      const n = nl();
      if (!n) return;
      n.setEnabled(!n.enabled);
      syncRuleUI();
    });
    domRefs.ruleToggle = sw;
    head.append(el("span", "aiRuleToggleLabel", "No-limit rule"), sw, el("span", "aiRuleToggleHint grow", "applied to every AI call, default ON"));
    card.append(head);

    domRefs.ruleInputs = {};
    for (const kind of ["text", "vision", "image"]) {
      const meta = (nl() && nl().meta[kind]) || { label: kind, hint: "" };
      const block = el("div", "aiRuleBlock");
      block.append(el("div", "aiRuleHead", meta.label));
      block.append(el("div", "rigMuted", meta.hint));
      const ta = document.createElement("textarea");
      ta.rows = kind === "image" ? 2 : 5;
      ta.className = "aiInput aiRuleText";
      ta.addEventListener("change", () => {
        const n = nl();
        if (n) n.setRule(kind, ta.value);
      });
      domRefs.ruleInputs[kind] = ta;
      block.append(ta);
      card.append(block);
    }

    const foot = el("div", "testRow");
    const reset = el("button", "btn ghost", "Reset defaults");
    reset.addEventListener("click", () => {
      const n = nl();
      if (!n) return;
      n.resetRules();
      syncRuleUI();
      toast && toast("Rule reset", 1800);
    });
    foot.append(reset);
    card.append(foot);

    view.append(card);
    return view;
  }

  function syncRuleUI() {
    const n = nl();
    if (!n) return;
    if (domRefs.ruleToggle) {
      const on = n.enabled;
      domRefs.ruleToggle.textContent = on ? "On" : "Off";
      domRefs.ruleToggle.classList.toggle("on", on);
    }
    if (domRefs.ruleInputs) {
      for (const kind of ["text", "vision", "image"]) {
        const ta = domRefs.ruleInputs[kind];
        if (ta && document.activeElement !== ta) ta.value = n.rules[kind] || "";
      }
    }
  }

  /* ---------------------------------------------------------------- tabs/io */

  function showTab(id) {
    tab = id;
    const views = { chat: domRefs.chat, vision: domRefs.vision, animate: domRefs.animate, rule: domRefs.rule };
    for (const key of Object.keys(views)) {
      if (views[key]) views[key].hidden = key !== id;
    }
    if (domRefs.tabs) {
      for (const b of domRefs.tabs.children) b.classList.toggle("active", b.dataset.tab === id);
    }
    if (id === "rule") syncRuleUI();
    if (id === "chat") renderChat();
  }

  function openPanel() {
    if (!panel) build();
    open = true;
    panel.hidden = false;
    syncRuleUI();
    showTab(tab);
  }

  function close() {
    open = false;
    if (panel) panel.hidden = true;
  }

  function toggle() {
    if (open) close();
    else openPanel();
  }

  return {
    open: openPanel,
    close,
    toggle,
    showTab,
    syncRuleUI,
    get isOpen() {
      return open;
    },
    get messages() {
      return messages.slice();
    },
    setVisionUrl,
    setVisionVideo,
    sendAnimate,
    get visMode() {
      return visMode;
    },
    get visFrames() {
      return visFrames;
    },
  };
}
