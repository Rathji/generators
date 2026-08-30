// Webuntu OS — Webuntu Assistant (Phase 10, Task 77)
// The flagship AI app: a chat powered by ai-text-plugin that can ACT on the
// OS — launch apps, read/write virtual-FS files, list folders, search the
// Software Center catalog, generate images (text-to-image-plugin) and report
// system status. The model signals an action by emitting an [[ACTION]] block
// in its response; the app strips it from the display, executes it, shows a
// result chip and then asks the model for a short grounded follow-up.
// Multi-turn context uses the prefix-cache-friendly append-only transcript +
// background compaction pattern from the ai-text-plugin skill. The session
// (summary + transcript tail) persists in localStorage so closing the window
// doesn't lose the conversation.

(function () {
  "use strict";

  window.AppContent = window.AppContent || {};

  const SESSION_KEY = "webuntu.assistant.session";
  const SPEAK_KEY = "webuntu.assistant.speak";
  const KEEP = 8;                  // newest transcript messages that always survive compaction
  const MAX_FEEDBACK = 4000;       // max chars of a read-file fed back to the model
  const BLOCK_RE = /\[\[ACTION\]\]([a-zA-Z]+)\|([\s\S]*?)\[\[\/ACTION\]\]/g;

  const APP_IDS = "assistant, file-manager, browser, terminal, notes, settings, software-center, system-monitor, calculator, music-player, image-viewer, pdf-viewer, text-editor, chat, weather, mail, minesweeper";

  const SYSTEM_PROMPT =
"You are Webuntu Assistant, built into Webuntu OS — a fictional Debian-based " +
"Linux fork (Webuntu 12, \"Perch Mint\") that runs entirely in the browser on " +
"Perchance. You help with coding, writing, planning and using the OS itself. " +
"Be concise, friendly and practical. You can write code, markdown and prose. " +
"When the user asks about the OS, prefer checking reality with an action " +
"rather than guessing.\n\n" +
"ACTIONS: You can ACT on the OS when it helps. To run an action, emit AT MOST " +
"ONE action block on its own line, BEFORE your reply, in exactly this form:\n" +
"  [[ACTION]]toolName|arguments[[/ACTION]]\n" +
"Example: [[ACTION]]launch|browser[[/ACTION]]\n\n" +
"Available tools:\n" +
"  launch|<appId>            — open an installed OS app. Installed app ids: " + APP_IDS + ".\n" +
"  read|<path>               — read a text file (full path like /home/user/Documents/About Webuntu.txt). The file content will be handed back to you.\n" +
"  write|<path>|<content>    — create or overwrite a text file. Use \\n for newlines; the parent folder must already exist.\n" +
"  list|<path>               — list a folder's contents (e.g. /home/user).\n" +
"  search|<query>            — search the Software Center catalog of Perchance generators.\n" +
"  img|<prompt>              — generate an AI image from a prompt.\n" +
"  status                    — report live OS status (version, theme, user, online users, open windows).\n" +
"  tasks|<project name?>    — list a project's open tasks (omit the name to use the active project).\n" +
"  nexttask                 — propose the single next task to work on from the active project.\n\n" +
"Rules: use full absolute paths (prefix with ~ or /home/user/ for your files). " +
"If you are not sure a path exists, list first. Only emit an action block when " +
"the user asked for it or it is clearly helpful. Never invent action tools. " +
"The action result is appended to the conversation and you will get a follow-up " +
"chance to react, so do not pretend to know the outcome of an action in advance.";

  const REPLY_TASK = "Write the next response as 'Assistant'. If an action is useful, emit one [[ACTION]] block first, then reply.";
  const CONTINUE_TASK = "An OS action you requested just executed (see [Action result] lines above). Give a SHORT follow-up reply (1-2 sentences) telling the user what happened and what they can do next. Do NOT emit any [[ACTION]] blocks now.";

  const QUICK_CHIPS = [
    { label: "🤖 What can you do?", text: "What can you do?" },
    { label: "▶️ Open the browser", text: "Open the browser" },
    { label: "📂 List Documents", text: "List my Documents folder" },
    { label: "🔎 Search music tools", text: "Search the Software Center for music" },
    { label: "🎨 Generate an image", text: "Generate an image of a neon cyberpunk city at night" },
    { label: "📊 System status", text: "What is the system status?" },
  ];

  // ---------- tiny DOM helpers ----------
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  }
  function esc(s) {
    return String(s).replace(/[&<>"']/g, (c) => (
      c === "&" ? "&amp;" : c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === '"' ? "&quot;" : "&#39;"
    ));
  }
  // Markdown-lite: input is escaped first, so only our fixed tags can appear.
  function renderText(text) {
    let out = esc(text)
      .replace(/`([^`\n]+)`/g, "<code>$1</code>")
      .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, "<br>");
    const tmp = document.createElement("div");
    tmp.innerHTML = out;
    const frag = document.createDocumentFragment();
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    return frag;
  }

  // ---------- reading replies aloud (Task 79) ----------
  // Strip the markdown-lite tokens from a reply before handing it to TTS so
  // asterisks/backticks/headings aren't read out literally.
  function speakTextForTts(text) {
    return String(text)
      .replace(/`([^`\n]+)`/g, "$1")
      .replace(/\*\*([^*]+)\*\*/g, "$1")
      .replace(/\*([^*\n]+)\*/g, "$1")
      .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/^\s*(?:[-*>]|\d+\.)\s+/gm, "")
      .replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">")
      .replace(/<br\s*\/?>/gi, " ")
      .replace(/\s+/g, " ")
      .trim();
  }
  function speakReply(text) {
    if (!speakOn) return;
    const clean = speakTextForTts(text);
    if (!clean) return;
    try {
      root.voiceTools(clean, { queue: true, onError: () => {} });
    } catch (e) {}
  }
  function stopSpeaking() {
    try {
      const a = window.__voiceToolsPluginApi || root.voiceTools;
      if (a && typeof a.stop === "function") a.stop();
    } catch (e) {}
  }

  // ---------- transcript state (append-only, prefix-cache friendly) ----------
  let messages = [];     // ["User: ...", "Assistant: ...", "System: ..."]
  let summary = "";      // compacted older history
  let compacting = false;
  let busy = false;
  let closed = false;    // window closed / new chat started
  let genToken = 0;
  let currentReply = null;
  let speakOn = true;   // Task 79: read replies aloud via voice-tools-plugin
  try { const v = localStorage.getItem(SPEAK_KEY); if (v === "0" || v === "1") speakOn = v === "1"; } catch (e) {}

  function buildPrompt(task) {
    const log = [summary && `[Summary of the earlier conversation:\n${summary}]`, ...messages].filter(Boolean);
    return SYSTEM_PROMPT + "\n\n<MESSAGES>\n" + log.join("\n\n") + "\n</MESSAGES>\n\n" +
      "<CURRENT OS STATE>\n" +
      "Time: " + new Date().toLocaleString() + "\n" +
      "User: " + ((window.OS && window.OS.currentUser) || "user") + "\n" +
      "Theme: " + (document.documentElement.getAttribute("data-theme") || "dark") + "\n" +
      "Online users: " + ((window.Net && window.Net.onlineCount) || 0) + "\n" +
      "</CURRENT OS STATE>\n\nTASK: " + task;
  }

  function countTokens() {
    try {
      const m = root.generateText({ getMetaObject: true });
      return { count: m.countTokens(buildPrompt("")), ideal: m.idealMaxContextTokens || 6000 };
    } catch (e) { return { count: 0, ideal: 6000 }; }
  }

  async function maybeCompact() {
    if (compacting || messages.length <= KEEP) return;
    const { count, ideal } = countTokens();
    if (count < ideal * 0.9) return;
    compacting = true;
    try {
      const n = messages.length - KEEP;
      const boundary = messages[n - 1].slice(-30);
      const result = await root.generateText(buildPrompt(
        "Summarize the first " + n + " messages, stopping after the message that ends with \"" + boundary +
        "\". Fold in the [Summary of the earlier conversation...] block if there is one. " +
        "Terse bullets; preserve names, facts, decisions, and unresolved threads. Output ONLY the new summary text."
      ));
      summary = (result.text || "").trim();
      messages = messages.slice(n);
      persist();
    } catch (e) {} finally { compacting = false; }
  }

  function persist() {
    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify({ summary, messages: messages.slice(-30) }));
    } catch (e) {}
  }

  // ---------- paths ----------
  function normPath(p) {
    let s = String(p || "").trim().replace(/^["']|["']$/g, "");
    if (!s) return null;
    if (s === "~") return "/home/user";
    if (s.startsWith("~/")) s = "/home/user/" + s.slice(2);
    if (!s.startsWith("/")) s = "/home/user/" + s.replace(/^\/+/, "");
    return s.replace(/\/+$/, "") || "/";
  }
  function parentPathOf(p) {
    const i = p.lastIndexOf("/");
    return i <= 0 ? "/" : p.slice(0, i);
  }
  function baseNameOf(p) {
    const i = p.lastIndexOf("/");
    return i === -1 ? p : p.slice(i + 1);
  }

  // ---------- actions ----------
  async function execAction(tool, arg) {
    arg = String(arg || "").trim();
    const r = { ok: false, tool, note: "No action executed.", path: null, content: null, image: null };
    switch (tool) {
      case "launch": {
        const id = (arg.split("|")[0] || arg).trim();
        const app = window.Apps && window.Apps.getById(id);
        if (!app) {
          const ids = (window.Apps && window.Apps.catalog ? window.Apps.catalog.map((a) => a.id) : []).join(", ");
          r.note = "Unknown app \"" + id + "\". Installed apps: " + (ids || "none");
        } else {
          window.Apps.launch(id);
          r.ok = true;
          r.note = "Opened " + app.name + " " + (app.icon || "");
        }
        break;
      }
      case "read": {
        const path = normPath(arg);
        const node = path && window.FS.resolve(path);
        if (!node) r.note = "No such path: " + (path || arg);
        else if (!window.FS.isFile(node)) r.note = path + " is a folder — try list|" + path + ".";
        else {
          r.ok = true;
          r.path = path;
          r.content = (node.meta && typeof node.meta.content === "string") ? node.meta.content : "";
          r.note = "Read " + path + " (" + r.content.length + " chars)";
        }
        break;
      }
      case "write": {
        const pipe = arg.indexOf("|");
        const path = normPath(pipe === -1 ? arg : arg.slice(0, pipe));
        const content = pipe === -1 ? "" : arg.slice(pipe + 1);
        const parent = parentPathOf(path);
        let node = path && window.FS.resolve(path);
        if (!node) {
          if (!path || !window.FS.isFolder(window.FS.resolve(parent))) r.note = "Folder doesn't exist: " + parent;
          else {
            node = window.FS.create(parent, {
              name: baseNameOf(path), type: "file", icon: "📄",
              meta: { content, size: new TextEncoder().encode(content).length, modified: Date.now() },
            });
            if (node) { r.ok = true; r.path = path; r.note = "Created " + path + " (" + content.length + " chars)"; }
            else r.note = "Could not create the file.";
          }
        } else if (window.FS.isFile(node)) {
          node.meta.content = content;
          node.meta.size = new TextEncoder().encode(content).length;
          node.meta.modified = Date.now();
          if (window.FS.onChange) window.FS.onChange();
          r.ok = true;
          r.path = path;
          r.note = "Updated " + path + " (" + content.length + " chars)";
        } else r.note = path + " is a folder, not a file.";
        break;
      }
      case "list": {
        const path = normPath(arg);
        const kids = path && window.FS.list(path);
        if (!kids) r.note = "No such folder: " + (path || arg);
        else {
          r.ok = true;
          r.path = path;
          r.note = (path || "/") + ": " + kids.map((c) => (c.type === "folder" ? "📁" : "📄") + " " + c.name).join("  ·  ");
        }
        break;
      }
      case "search": {
        const q = String(arg).toLowerCase();
        const pool = [];
        for (const a of (window.Apps && window.Apps.catalog ? window.Apps.catalog : [])) {
          pool.push({ slug: a.id, title: a.name, blurb: a.blurb || "", kind: "app" });
        }
        if (root.swcApps) {
          for (const n of root.swcApps.selectAll) {
            try {
              const slug = n.slug.evaluateItem;
              const title = n.title ? n.title.evaluateItem : slug;
              const blurb = n.blurb ? n.blurb.evaluateItem : "";
              const cat = n.category ? n.category.evaluateItem : "";
              pool.push({ slug, title, blurb: blurb + (cat ? " (" + cat + ")" : ""), kind: "generator" });
            } catch (e) {}
          }
        }
        const hits = pool.filter((a) => (a.title + " " + a.slug + " " + a.blurb).toLowerCase().includes(q)).slice(0, 8);
        if (!hits.length) r.note = "No matches for \"" + arg + "\" in the installed apps or Software Center catalog.";
        else {
          r.ok = true;
          r.note = "Matches for \"" + arg + "\": " + hits.map((h) =>
            h.kind === "app"
              ? "app " + h.title + " (launch|" + h.slug + ")"
              : "generator " + h.title + " — perchance.org/" + h.slug + " (" + h.blurb + ")"
          ).join("  ·  ");
        }
        break;
      }
      case "img": {
        try {
          const res = await root.generateImage(arg);
          if (res && res.dataUrl) {
            r.ok = true;
            r.image = res.dataUrl;
            r.note = "Generated an image from: \"" + arg + "\"";
          } else r.note = "Image generation returned nothing.";
        } catch (e) { r.note = "Image generation failed: " + (e && e.message ? e.message : String(e)); }
        break;
      }
      case "status": {
        const theme = document.documentElement.getAttribute("data-theme") || "dark";
        const online = (window.Net && window.Net.onlineCount) || 0;
        const wins = (window.WM && window.WM.getOpen ? window.WM.getOpen().filter((w) => !w.closed).length : 0);
        const up = Math.floor(performance.now() / 1000);
        let os = "Webuntu";
        try { os = "Webuntu " + root.distro.version.evaluateItem + " \"" + root.distro.codename.evaluateItem + "\""; } catch (e) {}
        r.ok = true;
        r.note = os + " · user " + ((window.OS && window.OS.currentUser) || "user") +
          " · theme " + theme + " · " + wins + " window(s) open · " + online + " online" +
          " · display " + window.innerWidth + "×" + window.innerHeight + " · uptime " + up + "s";
        break;
      }
      case "tasks": {
        const P = window.Projects;
        if (!P) { r.note = "The Projects module isn't loaded yet."; break; }
        try {
          const list = await P.listProjects();
          let pid = null, pname = "";
          if (arg) {
            pname = arg.toLowerCase();
            for (const [id, p] of Object.entries(list)) {
              if (p.name.toLowerCase() === pname || p.name.toLowerCase().includes(pname)) { pid = id; pname = p.name; break; }
            }
            if (!pid) {
              const names = Object.values(list).map((p) => "\"" + p.name + "\"").join(", ");
              r.note = "No project named \"" + arg + "\". Projects: " + (names || "none");
              break;
            }
          } else {
            pid = await P.getActiveId();
            const p = await P.getProject(pid);
            pname = p ? p.name : "";
          }
          const tasks = await P.loadTasks(pid);
          const doing = tasks.filter((t) => t.status === "doing");
          const todos = tasks.filter((t) => t.status === "todo").sort((a, b) => (b.priority - a.priority) || (a.createdAt - b.createdAt));
          const open = [...doing, ...todos];
          if (!open.length) { r.ok = true; r.note = "Project \"" + pname + "\" has no open tasks. All clear!"; break; }
          const lines = open.map((t) => {
            const prio = t.priority === 2 ? "high" : t.priority === 1 ? "med" : "low";
            const tomato = t.pomodoros ? " · 🍅" + t.pomodoros : "";
            return "[" + (t.status === "doing" ? "doing" : "todo") + "/" + prio + "] " + t.title + tomato;
          });
          r.ok = true;
          r.note = "Project \"" + pname + "\" — " + open.length + " open task(s): " + lines.join(" · ");
        } catch (e) { r.note = "Failed to read tasks: " + (e && e.message ? e.message : String(e)); }
        break;
      }
      case "nexttask": {
        const P = window.Projects;
        if (!P) { r.note = "The Projects module isn't loaded yet."; break; }
        try {
          const n = await P.nextTask();
          if (!n || !n.task) {
            const pid = await P.getActiveId();
            const p = await P.getProject(pid);
            r.ok = true;
            r.note = "No open tasks in project \"" + (p ? p.name : "the active project") + "\". All clear!";
            break;
          }
          const p = await P.getProject(n.project);
          const prio = n.task.priority === 2 ? "high" : n.task.priority === 1 ? "medium" : "low";
          r.ok = true;
          r.note = "Next task in \"" + (p ? p.name : "project") + "\": \"" + n.task.title + "\" — " +
            n.reason + ", " + prio + " priority, " + n.task.status + (n.task.pomodoros ? ", " + n.task.pomodoros + " 🍅 so far" : "") +
            ". Open the Projects app to start on it.";
        } catch (e) { r.note = "Failed to get the next task: " + (e && e.message ? e.message : String(e)); }
        break;
      }
      default:
        r.note = "Unknown action \"" + tool + "\".";
    }
    return r;
  }

  // ---------- UI ----------
  const ui = {};

  function makeAssistant() {
    const root = el("div", "ast");

    const head = el("div", "ast-head");
    const dot = el("span", "ast-dot");
    const title = el("span", "ast-title", "Webuntu Assistant");
    const model = el("span", "ast-model", "Perchance AI");
    const newBtn = el("button", "set-btn", "New chat");
    newBtn.type = "button";
    newBtn.title = "Start a fresh conversation";
    const speakBtn = el("button", "set-btn ast-speak", speakOn ? "🔊" : "🔇");
    speakBtn.type = "button";
    speakBtn.setAttribute("aria-pressed", String(speakOn));
    speakBtn.title = speakOn ? "Replies are read aloud — click to mute" : "Muted — click to read replies aloud";
    speakBtn.addEventListener("click", () => {
      speakOn = !speakOn;
      if (!speakOn) stopSpeaking();
      try { localStorage.setItem(SPEAK_KEY, speakOn ? "1" : "0"); } catch (e) {}
      speakBtn.textContent = speakOn ? "🔊" : "🔇";
      speakBtn.setAttribute("aria-pressed", String(speakOn));
      speakBtn.title = speakOn ? "Replies are read aloud — click to mute" : "Muted — click to read replies aloud";
    });
    head.append(dot, title, model, speakBtn, newBtn);

    const msgs = el("div", "ast-msgs");

    const chips = el("div", "ast-chips");
    for (const c of QUICK_CHIPS) {
      const b = el("button", "ast-chip-q", c.label);
      b.type = "button";
      b.addEventListener("click", () => { ui.input.value = c.text; send(); });
      chips.appendChild(b);
    }

    const inputRow = el("div", "ast-input-row");
    const input = el("textarea", "ast-input");
    input.placeholder = "Ask me anything — I can also open apps, read/write files, search the catalog and make images…";
    input.rows = 1;
    const sendBtn = el("button", "ast-send", "➤");
    sendBtn.type = "button";
    sendBtn.title = "Send (Enter)";
    sendBtn.addEventListener("click", () => send());
    input.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter" && !ev.shiftKey) { ev.preventDefault(); send(); }
    });
    input.addEventListener("input", () => {
      input.style.height = "auto";
      input.style.height = Math.min(input.scrollHeight, 120) + "px";
    });
    inputRow.append(input, sendBtn);

    const note = el("div", "ast-note", "Enter to send · Shift+Enter for a new line · Super+A reopens me anytime");

    root.append(head, msgs, chips, inputRow, note);

    ui.msgs = msgs;
    ui.input = input;
    ui.sendBtn = sendBtn;
    ui.root = root;
    ui.head = head;

    newBtn.addEventListener("click", () => newChat());

    restoreTranscript();
    scrollBottom();
    return root;
  }

  function setBusy(on) {
    busy = on;
    ui.root.classList.toggle("busy", on);
    ui.sendBtn.disabled = on;
  }

  function scrollBottom() {
    ui.msgs.scrollTop = ui.msgs.scrollHeight;
  }

  // ---------- bubbles ----------
  function addBubble(role, htmlOrNode) {
    const row = el("div", "ast-row " + role);
    row.appendChild(el("div", "ast-role", role === "user" ? "You" : "Assistant"));
    const bubble = el("div", "ast-bubble");
    row.appendChild(bubble);
    ui.msgs.appendChild(row);
    if (htmlOrNode instanceof Node) bubble.appendChild(htmlOrNode);
    else if (htmlOrNode) bubble.appendChild(renderText(String(htmlOrNode)));
    return { row, bubble };
  }
  function setBubbleText(bubble, text) {
    bubble.textContent = "";
    if (text) bubble.appendChild(renderText(text));
  }
  function addUserBubble(text) {
    const b = addBubble("user", text);
    b.bubble.classList.add("ast-user-msg");
  }
  function addAssistantBubble() {
    const b = addBubble("ai", "");
    return b.bubble;
  }
  function addSysLine(text) {
    const s = el("div", "ast-sys", String(text).length > 160 ? String(text).slice(0, 157) + "…" : String(text));
    ui.msgs.appendChild(s);
    return s;
  }
  function addThinking() {
    const t = el("div", "ast-thinking");
    const dots = el("span", "tdots");
    for (let i = 0; i < 3; i++) dots.appendChild(el("span"));
    t.appendChild(dots);
    t.appendChild(document.createTextNode(" thinking"));
    ui.msgs.appendChild(t);
    return t;
  }
  function addActionChip() {
    const c = el("div", "ast-chip run");
    c.appendChild(el("span", "aci", "⏳"));
    const body = el("div");
    body.appendChild(el("div", "act", "Running action…"));
    c.appendChild(body);
    ui.msgs.appendChild(c);
    scrollBottom();
    return { chip: c, body };
  }
  function setChip({ chip, body }, r) {
    chip.classList.remove("run");
    chip.classList.toggle("fail", !r.ok);
    chip.querySelector(".aci").textContent = r.ok ? "✅" : "⚠️";
    body.textContent = "";
    const act = el("div", "act", r.tool);
    body.appendChild(act);
    const note = el("div", "acn", r.note);
    body.appendChild(note);
    if (r.image) {
      const box = el("div", "ast-imgbox");
      const img = document.createElement("img");
      img.src = r.image;
      img.alt = "Generated image";
      const acts = el("div", "ast-img-actions");
      const save = el("button", "", "💾 Save to Pictures");
      save.type = "button";
      save.addEventListener("click", () => saveImage(r.image));
      const wall = el("button", "", "🖼️ Set as wallpaper");
      wall.type = "button";
      wall.addEventListener("click", () => setWallpaper(r.image));
      acts.append(save, wall);
      box.append(img, acts);
      chip.appendChild(box);
    }
    scrollBottom();
  }

  function saveImage(dataUrl) {
    const folder = "/home/user/Pictures";
    if (!window.FS.isFolder(window.FS.resolve(folder))) { toast("Pictures", "The Pictures folder doesn't exist yet.", "⚠️"); return; }
    let name = "assistant-" + new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") + ".png";
    while (window.FS.resolve(window.FSPath.childPath(folder, name))) {
      name = "assistant-" + Math.random().toString(36).slice(2, 8) + ".png";
    }
    window.FS.create(folder, {
      name, type: "file", icon: "🖼️",
      meta: { content: dataUrl, size: Math.floor(dataUrl.length * 0.75), modified: Date.now() },
    });
    const path = window.FSPath.childPath(folder, name);
    toast("Assistant", "Saved to " + path, "🖼️");
    if (window.Notify && window.Notify.center) window.Notify.toast("Assistant", "Saved " + name + " to Pictures", { icon: "🖼️", app: "Assistant" });
  }
  function setWallpaper(source) {
    if (window.Desktop && window.Desktop.setWallpaper) {
      window.Desktop.setWallpaper(source);
      if (window.Notify) window.Notify.toast("Assistant", "Wallpaper updated", { icon: "🖼️", app: "Assistant" });
    }
  }
  function toast(title, body, icon) {
    if (window.Notify) window.Notify.toast(title, body, { icon, app: "Assistant" });
  }

  // ---------- transcript rendering on (re)open ----------
  function restoreTranscript() {
    try {
      const s = JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
      if (s && s.messages) { summary = s.summary || ""; messages = s.messages; }
    } catch (e) { messages = []; }
    if (!messages.length) {
      addBubble("ai", "Hi! I'm **Webuntu Assistant**, built right into the OS. I can chat, write code and prose, and **act on Webuntu** — open apps, read & write files, list folders, search the Software Center, generate images and report live system status. Try one of the suggestions below, or just ask.");
      return;
    }
    for (const m of messages) {
      if (m.startsWith("User: ")) addUserBubble(m.slice(6));
      else if (m.startsWith("Assistant: ")) addBubble("ai", m.slice(11));
      else if (m.startsWith("System: ")) addSysLine(m.slice(8));
    }
  }

  function newChat() {
    if (currentReply && currentReply.stop) { try { currentReply.stop(); } catch (e) {} }
    stopSpeaking();
    genToken++;
    busy = false;
    closed = true;
    setBusy(false);
    messages = [];
    summary = "";
    ui.msgs.textContent = "";
    try { localStorage.removeItem(SESSION_KEY); } catch (e) {}
    addBubble("ai", "Hi! I'm **Webuntu Assistant**, built right into the OS. I can chat, write code and prose, and **act on Webuntu** — open apps, read & write files, list folders, search the Software Center, generate images and report live system status. Try one of the suggestions below, or just ask.");
    ui.input.value = "";
    ui.input.focus();
  }

  // ---------- the chat turn ----------
  function send() {
    const text = ui.input.value.trim();
    if (!text || busy) return;
    stopSpeaking();
    ui.input.value = "";
    ui.input.style.height = "auto";
    addUserBubble(text);
    messages.push("User: " + text);
    persist();
    runTurn(text);
    maybeCompact();
  }

  async function runTurn(text) {
    const token = ++genToken;
    closed = false;
    setBusy(true);
    const bubble = addAssistantBubble();
    const think = addThinking();
    const results = [];
    const executed = new Set();
    let actionChain = Promise.resolve();
    let fullText = "";
    let fullText2 = "";

    function queueAction(tool, arg) {
      actionChain = actionChain.then(async () => {
        if (closed || token !== genToken) return;
        const c = addActionChip();
        const rs = await execAction(tool, arg);
        if (closed || token !== genToken) return;
        results.push(rs);
        setChip(c, rs);
      });
    }
    function parseActions(text) {
      for (const m of [...String(text).matchAll(BLOCK_RE)]) {
        if (!executed.has(m[0])) { executed.add(m[0]); queueAction(m[1], m[2]); }
      }
    }
    function displayOf(text) {
      return String(text)
        .replace(BLOCK_RE, "")
        .replace(/\[\[ACTION\][^]*$/, "")
        .replace(/^Assistant:\s*/, "")
        .replace(/\nUser:[^]*$/, "")
        .trim();
    }

    try {
      const reply = root.generateText({
        instruction: buildPrompt(REPLY_TASK),
        startWith: "Assistant:",
        stopSequences: ["\nUser:"],
        onChunk: (d) => {
          if (closed || token !== genToken) return;
          fullText = d.fullTextSoFar || "";
          parseActions(fullText);
          const disp = displayOf(fullText);
          if (disp) setBubbleText(bubble, disp);
          scrollBottom();
        },
      });
      currentReply = reply;
      const final = await reply;
      fullText = String(final && final.text !== undefined ? final.text : fullText);
      parseActions(fullText);
      await actionChain;

      if (closed || token !== genToken) return;
      think.remove();
      const clean = displayOf(fullText);
      if (clean) setBubbleText(bubble, clean);
      else bubble.remove();
      const stored = String(fullText).replace(BLOCK_RE, "").replace(/\nUser:[^]*$/, "").replace(/^Assistant:\s*/, "").trim();
      if (stored) { messages.push("Assistant: " + stored); persist(); }
      speakReply(stored);

      if (results.length) {
        for (const r of results) {
          const note = r.note + (r.content !== null ? "\n" + (r.content.length > MAX_FEEDBACK ? r.content.slice(0, MAX_FEEDBACK) + "\n…[truncated " + r.content.length + " chars]" : r.content) : "");
          messages.push("System: [" + (r.ok ? "OK" : "FAILED") + "] " + r.tool + " — " + note);
        }
        persist();
        const cont = addBubble("ai", "");
        const think2 = addThinking();
        try {
          const reply2 = root.generateText({
            instruction: buildPrompt(CONTINUE_TASK),
            startWith: "Assistant:",
            stopSequences: ["\nUser:"],
            onChunk: (d) => {
              if (closed || token !== genToken) return;
              fullText2 = d.fullTextSoFar || "";
              const disp = displayOf(fullText2);
              if (disp) setBubbleText(cont.bubble, disp);
              scrollBottom();
            },
          });
          currentReply = reply2;
          const final2 = await reply2;
          fullText2 = String(final2 && final2.text !== undefined ? final2.text : fullText2);
          if (closed || token !== genToken) return;
          think2.remove();
          const contClean = displayOf(fullText2);
          if (contClean) {
            setBubbleText(cont.bubble, contClean);
            messages.push("Assistant: " + contClean);
            persist();
            speakReply(contClean);
          } else cont.row.remove();
        } catch (e) {
          think2.remove();
          if (!closed && token === genToken) {
            setBubbleText(cont.bubble, "⚠️ " + (e && e.message ? e.message : String(e)));
          }
        }
      }
    } catch (e) {
      think.remove();
      if (!closed && token === genToken) {
        setBubbleText(bubble, "⚠️ " + (e && e.message ? e.message : String(e)));
      }
    } finally {
      currentReply = null;
      if (token === genToken) { setBusy(false); }
      scrollBottom();
    }
  }

  // ---------- registration ----------
  window.AppContent["assistant"] = function (app) {
    const node = makeAssistant();
    return {
      content: node,
      w: 780, h: 560, minW: 360, minH: 320,
      onCloseRequest() {
        closed = true;
        genToken++;
        stopSpeaking();
        if (currentReply && currentReply.stop) { try { currentReply.stop(); } catch (e) {} }
      },
    };
  };

  window.Assistant = {
    toggle() {
      if (window.OS && window.OS.isLocked) return;
      const win = window.WM && window.WM.findByAppId("assistant");
      if (!win) { window.Apps.launch("assistant"); return; }
      if (win.minimized) { window.WM.open({ appId: "assistant", title: "Webuntu Assistant", icon: "🧠", singleton: true }); return; }
      const f = window.WM && window.WM.getFocused();
      if (f && f.id === win.id) window.WM.minimize(win.id);
      else window.WM.open({ appId: "assistant", title: "Webuntu Assistant", icon: "🧠", singleton: true });
    },
  };
})();
