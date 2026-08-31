// ai.js — the AI assistant (chat) and the autonomous Agent that builds/edits projects.

const DOC_DIR = "src/docs/";
const docCache = {};

async function loadDoc(name) {
  if (docCache[name] !== undefined) return docCache[name];
  try {
    const r = await fetch(DOC_DIR + name);
    docCache[name] = r.ok ? await r.text() : "";
  } catch (e) {
    docCache[name] = "";
  }
  return docCache[name];
}

function condenseManual(md) {
  const a = md.indexOf("# Handy plugins");
  const b = md.indexOf("# Misc");
  if (a !== -1 && b !== -1 && b > a) return md.slice(a, b);
  return md;
}

// Context option -> [doc files to include]
const CTX_OPTIONS = {
  core: { label: "Platform + operating manual", docs: ["perchance-platform.md", "operating-manual.md"], condense: ["operating-manual.md"] },
  platform: { label: "Platform reference only", docs: ["perchance-platform.md"], condense: [] },
  operating: { label: "Operating manual", docs: ["operating-manual.md"], condense: ["operating-manual.md"] },
  "ai-text-plugin": { label: "Platform + ai-text-plugin", docs: ["perchance-platform.md", "ai-text-plugin.md"], condense: [] },
  "text-to-image-plugin": { label: "Platform + text-to-image-plugin", docs: ["perchance-platform.md", "text-to-image-plugin.md"], condense: [] },
  "kv-plugin": { label: "Platform + kv-plugin", docs: ["perchance-platform.md", "kv-plugin.md"], condense: [] },
  "upload-plugin": { label: "Platform + upload-plugin", docs: ["perchance-platform.md", "upload-plugin.md"], condense: [] },
  "comments-plugin": { label: "Platform + comments-plugin", docs: ["perchance-platform.md", "comments-plugin.md"], condense: [] },
  "server-plugin": { label: "Platform + server-plugin", docs: ["perchance-platform.md", "server-plugin.md"], condense: [] },
  "super-fetch-plugin": { label: "Platform + super-fetch-plugin", docs: ["perchance-platform.md", "super-fetch-plugin.md"], condense: [] },
  "secret-plugin": { label: "Platform + secret-plugin", docs: ["perchance-platform.md", "secret-plugin.md"], condense: [] },
  "dynamic-metadata": { label: "Platform + dynamic-metadata", docs: ["perchance-platform.md", "dynamic-metadata.md"], condense: [] },
  "music-generation": { label: "Platform + music-generation", docs: ["perchance-platform.md", "music-generation.md"], condense: [] }
};

export function createAI(hostEl, app) {
  // ---- UI ----
  hostEl.innerHTML = "";
  const head = document.createElement("div");
  head.id = "aiHead";
  const title = document.createElement("span");
  title.className = "ai-title";
  title.textContent = "AI ASSISTANT";
  const ctxSel = document.createElement("select");
  ctxSel.id = "ctxSel";
  for (const [k, v] of Object.entries(CTX_OPTIONS)) {
    const o = document.createElement("option");
    o.value = k;
    o.textContent = "Context: " + v.label;
    ctxSel.appendChild(o);
  }
  ctxSel.value = "core";
  const mode = document.createElement("div");
  mode.className = "mode-toggle";
  const chatBtn = document.createElement("button");
  chatBtn.textContent = "Chat";
  chatBtn.classList.add("active");
  const agentBtn = document.createElement("button");
  agentBtn.textContent = "Agent";
  const dot = document.createElement("span");
  dot.id = "aiDot";
  dot.hidden = true;
  head.append(title, ctxSel, mode, dot);
  mode.append(chatBtn, agentBtn);

  const msgs = document.createElement("div");
  msgs.id = "aiMsgs";
  const suggest = document.createElement("div");
  suggest.id = "aiSuggest";
  const row = document.createElement("div");
  row.id = "aiRow";
  const input = document.createElement("textarea");
  input.id = "aiInput";
  input.placeholder = "Ask about building Perchance generators… (Enter to send, Shift+Enter for newline)";
  input.rows = 1;
  const sendBtn = document.createElement("button");
  sendBtn.id = "aiSendBtn";
  sendBtn.textContent = "Send";
  const stopBtn = document.createElement("button");
  stopBtn.id = "aiStopBtn";
  stopBtn.textContent = "Stop";
  stopBtn.hidden = true;
  row.append(input, sendBtn, stopBtn);
  const status = document.createElement("div");
  status.id = "agentStatus";
  hostEl.append(head, suggest, msgs, row, status);

  let modeType = "chat";
  let busy = false;
  let stopFlag = false;
  let curGen = null;
  const chatHistory = [];
  const MAX_AGENT_ITER = 12;

  chatBtn.onclick = () => setMode("chat");
  agentBtn.onclick = () => setMode("agent");
  function setMode(m) {
    modeType = m;
    chatBtn.classList.toggle("active", m === "chat");
    agentBtn.classList.toggle("active", m === "agent");
    input.placeholder = m === "agent"
      ? "Describe a generator to build or a change to make… Chance Code will plan, write files, and run them."
      : "Ask about building Perchance generators… (Enter to send, Shift+Enter for newline)";
    renderSuggestions();
  }

  function setBusy(b) {
    busy = b;
    sendBtn.disabled = b;
    sendBtn.textContent = b ? (modeType === "agent" ? "Working…" : "Thinking…") : "Send";
    stopBtn.hidden = !b;
    dot.hidden = !b;
  }
  function setStatus(t) { status.textContent = t; }

  // ---- message rendering ----
  function addMsg(kind, html) {
    const el = document.createElement("div");
    el.className = "aimsg " + kind;
    if (html) el.innerHTML = html;
    msgs.appendChild(el);
    msgs.scrollTop = msgs.scrollHeight;
    return el;
  }
  function esc(s) {
    return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }
  function renderMd(src) {
    let text = esc(src);
    const lines = text.split("\n");
    let html = "";
    let listOpen = false;
    let para = [];
    const closeList = () => { if (listOpen) { html += "</ul>"; listOpen = false; } };
    const flushPara = () => { if (para.length) { html += "<div class='para'>" + para.join("<br>") + "</div>"; para = []; } };
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];
      if (/^```/.test(line)) {
        flushPara(); closeList();
        const buf = [];
        i++;
        while (i < lines.length && !/^```/.test(lines[i])) { buf.push(lines[i]); i++; }
        html += "<pre>" + buf.join("\n") + "</pre>";
        if (i < lines.length) i++;
        continue;
      }
      const hm = /^(#{1,4})\s+(.*)$/.exec(line);
      if (hm) { flushPara(); closeList(); html += "<h4>" + hm[2] + "</h4>"; i++; continue; }
      if (/^\s*[-*]\s+/.test(line) || /^\s*\d+\.\s+/.test(line)) {
        flushPara();
        if (!listOpen) { html += "<ul>"; listOpen = true; }
        const m = /^\s*[-*]\s+(.*)$/.exec(line) || /^\s*\d+\.\s+(.*)$/.exec(line);
        html += "<li>" + m[1] + "</li>";
        i++; continue;
      }
      if (line.trim() === "") { flushPara(); closeList(); i++; continue; }
      closeList();
      para.push(line);
      i++;
    }
    flushPara(); closeList();
    const pres = [];
    html = html.replace(/<pre>[\s\S]*?<\/pre>/g, (m) => { pres.push(m); return "\u0000P" + (pres.length - 1) + "\u0000"; });
    html = html.replace(/`([^`]+)`/g, "<code class='inline'>$1</code>")
               .replace(/\*\*([^*]+)\*\*/g, "<b>$1</b>")
               .replace(/(^|[^*])\*([^*\n]+)\*/g, "$1<i>$2</i>");
    html = html.replace(/\u0000P(\d+)\u0000/g, (m, n) => pres[+n]);
    return html;
  }
  function markdownInto(el, text) { el.innerHTML = renderMd(text); }

  // ---- suggestions ----
  const chatSuggestions = (app.suggestions || []).slice(0, 8);
  const agentPresets = (app.agentPresets || []).slice(0, 8);
  function renderSuggestions() {
    suggest.innerHTML = "";
    const items = modeType === "agent" ? agentPresets : chatSuggestions;
    items.forEach((s) => {
      const c = document.createElement("button");
      c.className = "chip";
      c.textContent = s;
      c.onclick = () => { input.value = s; input.focus(); };
      suggest.appendChild(c);
    });
  }
  renderSuggestions();

  // ---- context builders ----
  async function loadContext() {
    const opt = CTX_OPTIONS[ctxSel.value] || CTX_OPTIONS.core;
    const parts = [];
    for (const name of opt.docs) {
      let md = await loadDoc(name);
      if (opt.condense && opt.condense.includes(name)) md = condenseManual(md);
      parts.push(md);
    }
    return parts.join("\n\n---\n\n");
  }

  async function workspaceSnapshot(includeContents = true, capPerFile = 4000) {
    let files = await app.ws.listFiles();
    files.sort();
    const lines = ["Workspace files:"];
    for (const f of files) {
      if (!includeContents) { lines.push(" - " + f); continue; }
      let content = await app.ws.read(f);
      if (content === null) continue;
      const total = content.split("\n").length;
      if (content.length > capPerFile) content = content.slice(0, capPerFile) + "\n…[truncated]";
      lines.push("===== " + f + " (" + total + " lines) =====");
      lines.push(content);
    }
    const open = app.getOpenPath();
    if (open) lines.push("(active file: " + open + ")");
    return lines.join("\n");
  }

  async function buildSystemPrompt(context) {
    return [
      "You are Chance Code's built-in AI assistant — an expert Perchance generator developer. ",
      "You write Perchance DSL (lists in main.pjs) and the HTML panel, and you explain how the Perchance engine works.",
      "Be concrete and practical. Prefer working code. If the user's request needs multi-file changes, suggest using Agent mode.",
      "",
      "<REFERENCE_DOCS>",
      context,
      "</REFERENCE_DOCS>",
      ""
    ].join("\n");
  }

  // ---- chat ----
  async function chatAsk(q) {
    addMsg("user", esc(q));
    chatHistory.push({ role: "user", content: q });
    setBusy(true);
    setStatus("");
    const m = addMsg("bot", "<span class='dim'>thinking…</span>");
    let acc = "";
    let stalled = false;
    let idleTimer = null;
    const arm = () => {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(() => {
        stalled = true;
        try { curGen && curGen.stop(); } catch (e) {}
      }, 45000);
    };
    try {
      const context = await loadContext();
      const sys = await buildSystemPrompt(context);
      const ws = await workspaceSnapshot();
      const hist = chatHistory.slice(-10).map((h) => (h.role === "user" ? "User: " : "Assistant: ") + h.content).join("\n\n");
      const prompt = sys + "\n\n<WORKSPACE>\n" + ws + "\n</WORKSPACE>\n\n<CONVERSATION>\n" + hist + "\n</CONVERSATION>\n\nRespond to the latest user message as the assistant: " + q;
      curGen = app.generateText({
        instruction: prompt,
        onChunk: (d) => {
          acc += d.textChunk;
          arm();
          markdownInto(m, acc);
          msgs.scrollTop = msgs.scrollHeight;
        }
      });
      arm();
      await curGen;
      if (stalled) {
        markdownInto(m, acc + "\n\n_⏱ Generation stalled (no new text for 45s) — showing the partial response. The AI server may be busy; try again._");
      } else {
        chatHistory.push({ role: "assistant", content: acc });
      }
    } catch (e) {
      markdownInto(m, "**Sorry, that failed:** " + esc((e && e.message) || e));
    } finally {
      clearTimeout(idleTimer);
      curGen = null;
      setBusy(false);
      input.focus();
    }
  }

  // ---- agent ----
  function extractJson(text) {
    let t = text;
    const fence = t.indexOf("```");
    if (fence !== -1) {
      t = t.slice(fence + 3);
      const nl = t.indexOf("\n");
      if (nl !== -1) t = t.slice(nl + 1);
      const end = t.lastIndexOf("```");
      if (end !== -1) t = t.slice(0, end);
    }
    const a = t.indexOf("{");
    const b = t.lastIndexOf("}");
    if (a === -1 || b === -1 || b <= a) return null;
    const candidate = t.slice(a, b + 1);
    try { return JSON.parse(candidate); } catch (e) { return null; }
  }

  async function agentRun(task) {
    stopFlag = false;
    setBusy(true);
    const sysMsg = addMsg("sys", esc("AGENT MODE — task: " + task));
    setStatus("Initializing agent…");
    const context = await loadContext();
    const sys = await buildSystemPrompt(context);
    const agentInstruction = [
      "You are the Chance Code Agent — an autonomous coding agent that builds and edits Perchance generator projects in the user's workspace.",
      "TASK:",
      task,
      "",
      "Follow these steps across iterations:",
      "1. Inspect the WORKSPACE state below (files and their contents).",
      "2. Decide what files to create or change. Usually that means writing main.pjs (Perchance lists) and index.html (HTML that references the lists with [square blocks]).",
      "3. Output ONLY a JSON object — no markdown fences, no prose outside it:",
      '{"done": false, "message": "what you did / noticed", "files": [{"path": "main.pjs", "content": "..."}, ...], "delete": ["path"]}',
      "- done: true ONLY when the task is fully complete.",
      "- message: a short note for the user.",
      "- files: COMPLETE file contents for every file to create or overwrite.",
      "- delete: paths to remove (may be empty).",
      "",
      "Coding rules:",
      "- main.pjs holds indented Perchance lists; index.html holds the page markup referencing lists via [name]. Both must be VALID.",
      "- For randomness use Perchance lists and [square blocks]; for weights use ^odds.",
      "- Wrap anything needing a plugin by adding its import line at the TOP of main.pjs, e.g. generateText = {import:ai-text-plugin} (then use root.generateText).",
      "- If index.html needs a Re-roll button, use onclick=\"update()\" — the preview shim supports it.",
      "- Make the output visually clean with inline CSS in index.html (no external files).",
      "- Keep it robust: no syntax errors. Prefer simple, correct Perchance idioms from the reference docs.",
      "- In main.pjs, each PHYSICAL LINE is one list item. A multi-line entry (like a 3-line haiku) must be a single item containing \\n escapes, or a sub-list joined with joinItems.",
      "",
      "The workspace will be RUN after each iteration and any errors will be reported back to you — fix them in the next iteration."
    ].join("\n");

    let iter = 0;
    let lastErrors = "";
    let applied = [];
    let finished = false;
    let emptyStreak = 0;
    try {
      while (!stopFlag && iter < MAX_AGENT_ITER) {
        iter++;
        setStatus("Iteration " + iter + "/" + MAX_AGENT_ITER + " — reading workspace…");
        const ws = await workspaceSnapshot();
        let prompt = sys + "\n\n" + agentInstruction + "\n\n<WORKSPACE_STATE>\n" + ws + "\n</WORKSPACE_STATE>\n";
        if (lastErrors) prompt += "\n<LAST_RUN_ERRORS>\n" + lastErrors + "\n</LAST_RUN_ERRORS>\n";
        if (applied.length) prompt += "\n<FILES_CHANGED_LAST_ITERATION>\n" + applied.map((a) => a.path + " (" + a.action + ")").join("\n") + "\n</FILES_CHANGED_LAST_ITERATION>\n";

        setStatus("Iteration " + iter + "/" + MAX_AGENT_ITER + " — asking the model…");
        const m = addMsg("bot", "<span class='dim'>planning…</span>");
        let acc = "";
        let stalled = false;
        let idleTimer = null;
        const arm = () => {
          clearTimeout(idleTimer);
          idleTimer = setTimeout(() => {
            stalled = true;
            try { curGen && curGen.stop(); } catch (e) {}
          }, 45000);
        };
        curGen = app.generateText({
          instruction: prompt,
          onChunk: (d) => {
            acc += d.textChunk;
            arm();
            markdownInto(m, acc);
            msgs.scrollTop = msgs.scrollHeight;
          }
        });
        arm();
        await curGen;
        curGen = null;
        markdownInto(m, acc);

        if (stalled || acc.trim().length === 0) {
          emptyStreak++;
          if (emptyStreak >= 2) {
            addMsg("sys", "⏱ The AI server produced no text twice in a row. Stopping the agent — it may be busy; try again in a moment.");
            setStatus("Agent stopped — AI server unresponsive");
            break;
          }
          lastErrors = "Your generation returned no text (server stalled). Retry with a fresh generation.";
          setStatus("Iteration " + iter + " — server stalled; retrying…");
          continue;
        }
        emptyStreak = 0;

        const json = extractJson(acc);
        if (!json) {
          lastErrors = "Your previous response was not valid JSON (could not be parsed). Respond again with ONLY the JSON object described in the instructions.";
          applied = [];
          setStatus("Iteration " + iter + " — could not parse model output; retrying…");
          continue;
        }

        applied = [];
        const files = Array.isArray(json.files) ? json.files : [];
        for (const f of files) {
          if (!f || typeof f.path !== "string") continue;
          const content = String(f.content ?? "");
          await app.ws.write(f.path, content);
          applied.push({ path: f.path, action: "write" });
          if (app.syncOpenTabsFromDisk) await app.syncOpenTabsFromDisk(f.path);
        }
        const dels = Array.isArray(json.delete) ? json.delete : [];
        for (const p of dels) {
          if (typeof p === "string") {
            await app.ws.del(p);
            applied.push({ path: p, action: "delete" });
          }
        }

        if (applied.length) {
          setStatus("Iteration " + iter + " — wrote " + applied.map((a) => a.path).join(", ") + " — running…");
          const run = await app.runProject();
          lastErrors = (run.pjsError ? "PJS error: " + run.pjsError + "\n" : "") + (run.errors && run.errors.length ? run.errors.join("\n") : "");
          if (!lastErrors) lastErrors = run.ok ? "" : "The project ran but produced nothing — check that main.pjs and index.html are set up correctly.";
          setStatus("Iteration " + iter + " — " + (lastErrors ? "errors found" : "ran clean"));
        } else {
          lastErrors = "";
        }

        if (json.done) {
          finished = true;
          setStatus("Done in " + iter + " iteration" + (iter === 1 ? "" : "s") + ".");
          addMsg("sys", esc("✓ Agent finished: " + (json.message || "task complete.")));
          break;
        }
      }
      if (stopFlag) {
        addMsg("sys", "Agent stopped by user.");
        setStatus("Stopped.");
      } else if (iter >= MAX_AGENT_ITER && !finished) {
        addMsg("sys", "Agent reached the iteration limit (" + MAX_AGENT_ITER + ") without reporting done. Review the workspace and try again, or continue with more specific instructions.");
        setStatus("Iteration limit reached.");
      }
    } catch (e) {
      addMsg("sys", "Agent error: " + esc((e && e.message) || e));
      setStatus("Error.");
    } finally {
      curGen = null;
      setBusy(false);
      input.focus();
    }
  }

  // ---- send ----
  async function send() {
    if (busy) return;
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    if (modeType === "agent") await agentRun(q);
    else await chatAsk(q);
  }
  sendBtn.onclick = send;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); }
  });
  stopBtn.onclick = () => { stopFlag = true; if (curGen && typeof curGen.stop === "function") { try { curGen.stop(); } catch (e) {} } };

  welcome();

  function welcome() {
    const el = addMsg("bot");
    markdownInto(el, [
      "**Chance Code AI** — ask anything about building Perchance generators, and I'll ground my answers in the official platform reference.",
      "",
      "Try: *\"How does execution order work?\"* · *\"Show me dynamic odds\"* · or switch to **Agent** mode and I'll build a whole generator for you.",
      "",
      "To test what you write, hit **Run** (Ctrl+Enter) — the preview evaluates your `main.pjs` lists live."
    ].join("\n"));
  }

  return {
    setMode,
    setContext: (v) => { ctxSel.value = v; },
    runAgent: async (task) => { input.value = task; setMode("agent"); await agentRun(task); },
    focus: () => input.focus()
  };
}
