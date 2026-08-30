import { store, bus, schedulePersist } from "./store.js";
import * as ui from "./ui.js";
import { restoreSnapshot } from "./history.js";
import * as agent from "./agent.js";
import * as aiCore from "./aiCore.js";

let log = [];
let summary = "";
let busy = false;
let ctxPath = null;
let mode = "chat";

const SYS =
  'You are PerchEdit AI, an assistant embedded in a browser code editor. Help the user understand, fix, and write code. Be concise. Use fenced code blocks for any code you show. If you propose changes to the active file, put the COMPLETE new file content in a single fenced block tagged "edit" (three backticks immediately followed by "edit") as the very last thing in your reply, so the user can apply it.';

function fileContext() {
  ctxPath = store.activePath;
  if (!ctxPath) return null;
  let content = store.vfs.read(ctxPath) || "";
  if (content.length > 15000) content = content.slice(0, 15000) + "\n\n// [truncated for brevity]";
  return "ACTIVE FILE (" + ctxPath + "):\n```\n" + content + "\n```";
}

function buildPrompt(task) {
  const parts = [];
  if (summary) parts.push("[Summary of the earlier conversation:\n" + summary + "]");
  parts.push(...log);
  let out = SYS + "\n\n<CONVERSATION>\n" + parts.join("\n\n") + "\n</CONVERSATION>\n";
  const fc = fileContext();
  if (fc) out += "\n" + fc + "\n";
  out += "\nTASK: " + task;
  return out;
}

function ensureMeta() {
  return aiCore.aiMeta();
}

async function maybeCompact() {
  if (busy || log.length < 8) return;
  ensureMeta();
  try {
    if (meta.countTokens(buildPrompt("")) < meta.idealMaxContextTokens * 0.9) return;
  } catch (e) {
    return;
  }
  const n = Math.max(2, log.length - 6);
  const boundary = log[n - 1].slice(-40);
  try {
    const r = await aiCore.aiComplete({
      instruction:
        'Summarize the first ' +
        n +
        ' messages of the conversation, stopping after the message ending with: "' +
        boundary +
        '". Fold in the earlier summary if present. Terse bullets preserving names, decisions, and unresolved threads. Output ONLY the summary text.',
      stopSequences: ["\nUser:"],
    });
    summary = String(r).replace(/^\s*Assistant:\s*/i, "").trim();
    log = log.slice(n);
  } catch (e) {}
}

function renderRich(el, text) {
  const parts = text.split(/```/);
  for (let i = 0; i < parts.length; i++) {
    if (i % 2 === 0) {
      if (parts[i]) el.appendChild(document.createTextNode(parts[i]));
    } else {
      let code = parts[i];
      let lang = "";
      const nl = code.indexOf("\n");
      const first = (nl === -1 ? code : code.slice(0, nl)).trim();
      if (nl !== -1) {
        lang = first;
        code = code.slice(nl + 1);
      }
      if (lang === "edit") lang = "diff";
      const pre = document.createElement("pre");
      const c = document.createElement("code");
      c.className = "ai-code" + (lang ? " lang-" + lang : "");
      c.textContent = code.replace(/\n$/, "");
      pre.appendChild(c);
      el.appendChild(pre);
    }
  }
}

function parseEdit(text) {
  const re = /```edit\s*\n([\s\S]*?)(?:```|$)/g;
  let m;
  let last = null;
  while ((m = re.exec(text))) last = m[1];
  return last === null ? null : last;
}

function addMsg(role, text) {
  const pane = document.querySelector("#pane-ai");
  const list = pane.querySelector(".ai-msgs");
  const wrap = document.createElement("div");
  wrap.className = "ai-msg ai-" + role;
  const textEl = document.createElement("div");
  textEl.className = "ai-text";
  wrap.appendChild(textEl);
  list.appendChild(wrap);
  if (text) {
    if (role === "user") textEl.textContent = text;
    else renderRich(textEl, text);
  }
  list.scrollTop = list.scrollHeight;
  return wrap;
}

function setBusy(v) {
  busy = v;
  const dot = document.getElementById("aiDot");
  if (dot) dot.hidden = !v;
  const pane = document.querySelector("#pane-ai");
  if (pane) {
    const inp = pane.querySelector(".ai-input");
    const send = pane.querySelector(".ai-send");
    if (inp) inp.disabled = v;
    if (send) send.disabled = v;
    const pending = pane.querySelector(".ai-thinking");
    if (pending) pending.classList.toggle("ai-hidden", !v);
  }
}

function attachEditButtons(msg, reply) {
  const path = ctxPath;
  const edit = parseEdit(reply);
  if (!edit || !path) return;
  const bar = document.createElement("div");
  bar.className = "ai-editbar";
  const note = document.createElement("span");
  note.className = "ai-editnote";
  note.textContent = "Proposed edit to " + path;
  const applyB = document.createElement("button");
  applyB.className = "btn ai-apply";
  applyB.textContent = "Apply…";
  const rejB = document.createElement("button");
  rejB.className = "btn ai-reject";
  rejB.textContent = "Reject";
  applyB.onclick = () => {
    const current = store.vfs.read(path) || "";
    ui.showDiffModal(
      "Apply edit to " + path,
      "Current",
      current,
      "Proposed",
      edit,
      {
        applyLabel: "Apply Edit",
        onApply: () => {
          restoreSnapshot(path, edit);
          ui.toast("Edit applied to " + path);
        },
      }
    );
  };
  rejB.onclick = () => {
    rejB.disabled = true;
    applyB.disabled = true;
    rejB.textContent = "Rejected";
  };
  bar.append(note, applyB, rejB);
  msg.appendChild(bar);
}

export async function ask(task, userText) {
  if (busy) return;
  if (!aiCore.aiAvailable()) {
    ui.toast("AI is unavailable in this environment");
    return;
  }
  if (userText) {
    log.push("User: " + userText);
    addMsg("user", userText);
  }
  const msg = addMsg("assistant", "");
  const textEl = msg.querySelector(".ai-text");
  msg.classList.add("ai-thinking");
  setBusy(true);
  let acc = "";
  let failed = false;
  try {
    await aiCore.aiComplete({
      instruction: buildPrompt(task),
      startWith: "Assistant:",
      stopSequences: ["\nUser:"],
      onChunk: (d) => {
        acc = d.fullTextSoFar || "";
        let shown = acc.replace(/^Assistant:\s*/, "").replace(/\nUser:\s*$/, "");
        textEl.innerHTML = "";
        renderRich(textEl, shown);
        const list = msg.closest(".ai-msgs");
        if (list) list.scrollTop = list.scrollHeight;
      },
    });
  } catch (e) {
    failed = true;
    textEl.textContent = "Error: " + (e && e.message ? e.message : e);
  } finally {
    setBusy(false);
    msg.classList.remove("ai-thinking");
  }
  if (!failed) {
    let reply = acc.replace(/^Assistant:\s*/, "").replace(/\nUser:\s*$/, "").trim();
    if (!reply) reply = "(no response)";
    log.push("Assistant: " + reply);
    attachEditButtons(msg, reply);
    maybeCompact();
  }
}

function fileDesc() {
  const p = store.activePath;
  return p ? "the active file " + p : "the active file";
}

function explainTask() {
  const sel = document.querySelector(".cm-content");
  let extra = "";
  try {
    const v = globalThis.__editorView;
    if (v && !v.state.selection.main.empty) {
      const txt = v.state.sliceDoc(v.state.selection.main.from, v.state.selection.main.to);
      if (txt.trim()) extra = ' Focus especially on the selected code:\n```\n' + txt.slice(0, 4000) + "\n```";
    }
  } catch (e) {}
  return "Explain " + fileDesc() + " in a few short paragraphs: what it does, how it works, and anything surprising or bug-prone." + extra;
}

function fixTask() {
  return (
    "Find bugs, syntax issues, and suspicious logic in " +
    fileDesc() +
    " and propose a corrected version. Briefly list the problems, then put the COMPLETE corrected file in an edit block at the end."
  );
}

function quick(t) {
  if (t === "explain") ask(explainTask(), "");
  else if (t === "fix") ask(fixTask(), "");
  else if (t === "generate")
    ui.prompt("Generate code", "Describe the code you want", "", (v) => {
      if (v.trim()) ask("Write code for the following request. If it should replace the active file, output the complete file in an edit block at the end; otherwise show it in a normal fenced block.\n\nRequest: " + v, "");
    });
}

function sendMsg() {
  const pane = document.querySelector("#pane-ai");
  const input = pane.querySelector(".ai-input");
  const v = input.value.trim();
  if (!v) return;
  input.value = "";
  input.style.height = "auto";
  if (mode === "agent") agent.run(v);
  else ask("Reply to the user's latest message above.", v);
}

function setModeBtn() {
  const pane = document.querySelector("#pane-ai");
  if (!pane) return;
  pane.querySelectorAll(".ai-modebtn").forEach((b) => b.classList.toggle("active", b.dataset.mode === mode));
  const quick = pane.querySelector(".ai-quick");
  if (quick) quick.hidden = mode === "agent";
  const hint = pane.querySelector(".ai-modehint");
  if (hint) hint.textContent = mode === "agent" ? "Agent mode: PerchAgent explores the workspace, edits files, and runs scripts on its own. Ctrl+Shift+A" : "";
  const placeholder = pane.querySelector(".ai-input");
  if (placeholder) placeholder.placeholder = mode === "agent" ? "Describe a coding task for PerchAgent… (Enter to start)" : "Ask PerchEdit AI… (Enter to send, Shift+Enter for newline)";
}

function addSystemHint() {
  const pane = document.querySelector("#pane-ai");
  const list = pane.querySelector(".ai-msgs");
  const hint = document.createElement("div");
  hint.className = "ai-msg ai-hint";
  hint.textContent =
    "Hi — I can explain the active file, find bugs, or write code for you. Try “Explain”, “Fix Code”, or just ask me something. If I propose a change you'll get Apply/Reject buttons.";
  list.appendChild(hint);
}

export function focusInput() {
  const pane = document.querySelector("#pane-ai");
  const inp = pane && pane.querySelector(".ai-input");
  if (inp) setTimeout(() => inp.focus(), 0);
}

export function initAi() {
  const pane = document.querySelector("#pane-ai");
  if (!pane) return;
  pane.innerHTML = `<div class="ai">
    <div class="ai-head">
      <span>AI ASSISTANT</span>
      <span class="ai-modelwrap"><select class="ai-model" title="Model"></select></span>
      <span class="ai-mode">
        <button class="ai-modebtn active" data-mode="chat">Chat</button>
        <button class="ai-modebtn" data-mode="agent">Agent</button>
      </span>
      <button class="ai-clear">Clear</button>
    </div>
    <div class="ai-modehint"></div>
    <div class="ai-msgs"></div>
    <div class="ai-quick">
      <button class="ai-qbtn" data-t="explain">Explain</button>
      <button class="ai-qbtn" data-t="fix">Fix Code</button>
      <button class="ai-qbtn" data-t="generate">Generate</button>
    </div>
    <div class="ai-row">
      <textarea class="ai-input" rows="1" placeholder="Ask PerchEdit AI… (Enter to send, Shift+Enter for newline)"></textarea>
      <button class="ai-send" title="Send">➤</button>
      <button class="ai-stop" title="Stop agent" hidden>■</button>
    </div>
  </div>`;
  const input = pane.querySelector(".ai-input");
  const grow = () => {
    input.style.height = "auto";
    input.style.height = Math.min(120, input.scrollHeight) + "px";
  };
  input.addEventListener("input", grow);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      sendMsg();
    }
  });
  pane.querySelector(".ai-send").addEventListener("click", sendMsg);
  pane.querySelector(".ai-stop").addEventListener("click", () => agent.stop());
  pane.querySelectorAll(".ai-modebtn").forEach((b) =>
    b.addEventListener("click", () => {
      mode = b.dataset.mode;
      setModeBtn();
    })
  );
  pane.querySelectorAll(".ai-qbtn").forEach((b) => b.addEventListener("click", () => quick(b.dataset.t)));
  pane.querySelector(".ai-clear").addEventListener("click", () => {
    log = [];
    summary = "";
    agent.reset();
    pane.querySelector(".ai-msgs").innerHTML = "";
    addSystemHint();
  });
  addSystemHint();
  setModeBtn();
  renderModelPicker();
  bus.on("settings-ai", () => renderModelPicker());
}

export function renderModelPicker() {
  const sel = document.querySelector(".ai-model");
  if (!sel) return;
  sel.innerHTML = "";
  if (aiCore.usesPerchance()) {
    const o = document.createElement("option");
    o.textContent = "Perchance AI";
    sel.appendChild(o);
    sel.disabled = true;
    return;
  }
  sel.disabled = false;
  const choices = aiCore.modelChoices();
  const cur = aiCore.aiConfig().model.trim() || choices[0] || "";
  let matched = false;
  for (const m of choices) {
    const o = document.createElement("option");
    o.value = m;
    o.textContent = m;
    if (m === cur) {
      o.selected = true;
      matched = true;
    }
    sel.appendChild(o);
  }
  if (!matched && cur) {
    const o = document.createElement("option");
    o.value = cur;
    o.textContent = cur + " (custom)";
    o.selected = true;
    sel.appendChild(o);
  }
  const first = document.createElement("option");
  first.value = "__settings__";
  first.textContent = "Edit models…";
  sel.appendChild(first);
  sel.onchange = () => {
    if (sel.value === "__settings__") ui.openSettings();
    else {
      aiCore.aiConfig().model = sel.value;
      schedulePersist();
      renderModelPicker();
    }
  };
}

export function setMode(m) {
  if (m === "agent" || m === "chat") mode = m;
  setModeBtn();
}

export function getMode() {
  return mode;
}
