import { store, bus, schedulePersist } from "./store.js";
import { addSnapshot } from "./history.js";
import { setContent } from "./editor.js";
import { runCode } from "./main.js";
import * as aiCore from "./aiCore.js";

const MAX_ITER = 15;
const READ_CAP = 30000;
const RESULT_CAP = 4000;

let alog = [];
let busy = false;
let cancel = false;

const AGENT_SYS = `You are PerchAgent, an autonomous coding agent embedded in PerchEdit, a code editor running in the browser. The user gives you a coding task and you complete it yourself: explore the workspace, make a plan, edit files, run scripts to verify, and iterate until it works. Do not ask the user questions unless you are truly blocked. State any assumptions you make in your final summary.

TOOL PROTOCOL: To use a tool, end your reply with exactly ONE line of the form:
TOOL_CALL {"name":"<tool>","args":{...}}
The environment executes it and returns a TOOL RESULT. Then continue: emit the next TOOL_CALL, or when the task is complete emit NO tool call and give the final summary instead. Keep prose before a TOOL_CALL to at most one short line. Never emit more than one TOOL_CALL per reply.

TOOLS:
- {"name":"list","args":{}} — list every workspace file.
- {"name":"read","args":{"path":"<path>"}} — read a file's content.
- {"name":"write","args":{"path":"<path>","content":"<full new content>"}} — create or overwrite a file (complete file content, not a patch).
- {"name":"run","args":{"path":"<path>"}} — execute a .js file in a worker and return its console output.

WORKING RULES:
- Start by listing files and reading the ones that matter. Prefer reading before writing.
- Keep edits minimal and focused. Match existing style. Never invent features that don't exist in the codebase.
- After editing a .js file, run it to check for errors. After editing HTML/CSS, note that it cannot be run.
- Use exact file paths from the file list.
- When done, give a concise summary: what you changed (file by file), what you ran, and anything the user should know.`;

function truncate(s, n) {
  s = String(s);
  return s.length > n ? s.slice(0, n) + "\n…[truncated]" : s;
}

function fileList() {
  const files = store.vfs.walkFiles();
  if (!files.length) return "(empty workspace)";
  return files.map((p) => p + " (" + (store.vfs.read(p) || "").length + " chars)").join("\n");
}

function buildInstruction(task) {
  const parts = [AGENT_SYS, "WORKSPACE FILES:\n" + fileList()];
  if (alog.length) parts.push("CONVERSATION:\n" + alog.slice(-12).join("\n\n"));
  parts.push("USER TASK: " + task);
  parts.push("Continue: emit one TOOL_CALL line, or give the final summary if the task is done.");
  return parts.join("\n\n");
}

function parseToolCall(reply) {
  const lines = String(reply).split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const ln = lines[i].trim();
    if (ln.startsWith("TOOL_CALL")) {
      const json = ln.slice("TOOL_CALL".length).trim();
      try {
        const t = JSON.parse(json);
        return { name: String(t.name || ""), args: t && typeof t.args === "object" ? t.args : {} };
      } catch (e) {
        return { name: "__parse__", args: {}, raw: truncate(json, 300) };
      }
    }
  }
  return null;
}

function listEl() {
  const pane = document.querySelector("#pane-ai");
  return pane ? pane.querySelector(".ai-msgs") : null;
}

function scrollList() {
  const list = listEl();
  if (list) list.scrollTop = list.scrollHeight;
}

function addAgentRow(cls, text) {
  const list = listEl();
  if (!list) return;
  const wrap = document.createElement("div");
  wrap.className = "ai-msg ai-agent " + cls;
  const textEl = document.createElement("div");
  textEl.className = "ai-text";
  textEl.textContent = text;
  wrap.appendChild(textEl);
  list.appendChild(wrap);
  scrollList();
  return wrap;
}

function addToolCall(tool) {
  const list = listEl();
  if (!list) return;
  const wrap = document.createElement("div");
  wrap.className = "ai-msg ai-agent ai-tool";
  const head = document.createElement("div");
  head.className = "ai-toolhead";
  const args = tool.args || {};
  const keys = Object.keys(args);
  let sum = "";
  if (keys.length) {
    sum = keys
      .map((k) => {
        const v = String(args[k]);
        return k + "=" + (v.length > 70 ? v.slice(0, 70) + "…" : v);
      })
      .join(", ");
  }
  head.textContent = "▶ " + tool.name + (sum ? "  " + sum : "");
  wrap.appendChild(head);
  const showDetail = tool.name !== "write" && tool.name !== "__parse__";
  if (showDetail && keys.length) {
    const pre = document.createElement("pre");
    pre.className = "ai-args";
    pre.textContent = JSON.stringify(args, null, 2);
    wrap.appendChild(pre);
  }
  list.appendChild(wrap);
  scrollList();
  return wrap;
}

function addToolResult(tool, result, isError, prev) {
  const list = listEl();
  if (!list) return;
  const wrap = document.createElement("div");
  wrap.className = "ai-msg ai-agent ai-result" + (isError ? " ai-err" : "");
  const head = document.createElement("div");
  head.className = "ai-toolhead";
  head.textContent = "← " + tool.name + (isError ? " (error)" : "");
  wrap.appendChild(head);
  const pre = document.createElement("pre");
  pre.className = "ai-args";
  pre.textContent = truncate(result, 8000);
  wrap.appendChild(pre);
  if (tool.name === "write" && !isError) {
    const rev = document.createElement("button");
    rev.className = "btn ai-reject";
    rev.textContent = "Revert";
    rev.onclick = () => {
      const path = tool.args.path;
      revertWrite(path, prev);
      rev.disabled = true;
      rev.textContent = "Reverted";
    };
    wrap.appendChild(rev);
  }
  list.appendChild(wrap);
  scrollList();
  return wrap;
}

function revertWrite(path, prev) {
  if (prev === null) store.vfs.delete(path);
  else store.vfs.write(path, prev);
  if (store.saved[path] === undefined) store.saved[path] = "";
  store.dirty.add(path);
  schedulePersist();
  bus.emit("docchange", path, true);
  if (path === store.activePath) setContent(prev === null ? "" : prev);
}

async function execTool(tool) {
  const name = tool.name;
  const args = tool.args || {};
  if (name === "__parse__") return { error: "Unparseable TOOL_CALL JSON: " + (tool.raw || "") };
  if (name === "list") {
    const files = store.vfs
      .walkFiles()
      .map((p) => p + " (" + (store.vfs.read(p) || "").length + " chars)");
    return { text: "FILES (" + files.length + "):\n" + (files.join("\n") || "(empty workspace)") };
  }
  if (name === "read") {
    const p = args.path;
    if (store.vfs.read(p) === null) return { error: "No such file: " + p };
    return { text: truncate(store.vfs.read(p), READ_CAP) };
  }
  if (name === "write") {
    if (store.readOnly) return { error: "Read-only workspace" };
    const p = args.path;
    const c = String(args.content == null ? "" : args.content);
    if (!p) return { error: "Missing path in write" };
    const prev = store.vfs.read(p);
    if (!store.vfs.write(p, c)) return { error: "Could not write " + p };
    if (store.saved[p] === undefined) store.saved[p] = "";
    store.dirty.add(p);
    addSnapshot(p, c);
    schedulePersist();
    bus.emit("docchange", p, true);
    if (p === store.activePath) setContent(c);
    const note = prev === null ? " (created)" : prev === c ? " (unchanged)" : "";
    return { text: "WROTE " + c.length + " chars to " + p + note, prev, path: p };
  }
  if (name === "run") {
    const p = args.path;
    if (store.vfs.read(p) === null) return { error: "No such file: " + p };
    if (!/\.(js|mjs|cjs)$/i.test(p)) return { error: "Not a JavaScript file: " + p };
    const logs = [];
    return await new Promise((resolve) => {
      runCode(store.vfs.read(p) || "", (l) => logs.push(l), () => {
        const out = logs
          .map((l) => (l.type === "clear" ? "" : "[" + l.type + "] " + l.text))
          .join("\n");
        resolve({ text: "RUN OUTPUT of " + p + ":\n" + truncate(out || "(no output)", 20000) });
      });
    });
  }
  return { error: "Unknown tool: " + name };
}

function setBusy(v) {
  busy = v;
  const dot = document.getElementById("aiDot");
  if (dot) dot.hidden = !v;
  const stop = document.querySelector(".ai-stop");
  if (stop) stop.hidden = !v;
  const pane = document.querySelector("#pane-ai");
  if (pane) {
    const inp = pane.querySelector(".ai-input");
    const send = pane.querySelector(".ai-send");
    if (inp) inp.disabled = v;
    if (send) send.disabled = v;
  }
}

export function stop() {
  cancel = true;
  aiCore.cancelCurrent();
}

export function reset() {
  alog = [];
  cancel = false;
}

export async function run(task) {
  if (busy) return;
  if (!aiCore.aiAvailable()) {
    const t = document.createElement("div");
    t.textContent = "AI is unavailable in this environment";
    t.className = "ai-msg ai-hint";
    const list = listEl();
    if (list) list.appendChild(t);
    return;
  }
  alog = [];
  cancel = false;
  addAgentRow("info", "PerchAgent started — I'll explore, edit, and verify, then summarize. Every change is snapshotted and revertible.");
  setBusy(true);
  let finalText = "";
  try {
    for (let iter = 1; iter <= MAX_ITER; iter++) {
      if (cancel) {
        addAgentRow("info", "Stopped by user.");
        break;
      }
      const bubble = addAgentRow("stream", "");
      const textEl = bubble.querySelector(".ai-text");
      let acc = "";
      let failed = false;
      try {
        await aiCore.aiComplete({
          instruction: buildInstruction(task),
          startWith: "Assistant:",
          stopSequences: ["\nUser:"],
          onChunk: (d) => {
            acc = d.fullTextSoFar || "";
            const shown = acc.replace(/^Assistant:\s*/, "").replace(/\nUser:\s*$/, "");
            textEl.textContent = shown.replace(/^TOOL_CALL.*$/m, "").trimEnd();
            scrollList();
          },
        });
      } catch (e) {
        failed = true;
        textEl.textContent = "Error: " + (e && e.message ? e.message : e);
        break;
      }
      acc = acc.replace(/^Assistant:\s*/, "").replace(/\nUser:\s*$/, "").trim();
      const tool = parseToolCall(acc);
      if (!tool) {
        finalText = acc;
        textEl.textContent = acc;
        alog.push("Assistant: " + acc);
        bubble.classList.remove("ai-stream");
        bubble.classList.add("ai-done");
        break;
      }
      const visible = acc.replace(/^TOOL_CALL.*$/m, "").trim();
      textEl.textContent = visible;
      if (tool.name === "__parse__") {
        alog.push("Assistant: " + acc);
        alog.push("Tool __parse__ result: " + tool.raw);
        const r = await execTool(tool);
        addToolResult(tool, r.error || r.text, true);
        continue;
      }
      alog.push("Assistant: " + acc);
      addToolCall(tool);
      const r = await execTool(tool);
      addToolResult(tool, r.error || r.text, !!r.error, r.prev);
      alog.push("Tool " + tool.name + " result: " + truncate(r.error || r.text, RESULT_CAP));
      if (iter === MAX_ITER) {
        addAgentRow("info", "Stopped: reached the 15-tool-call limit. Reply “continue” to keep going.");
      }
    }
  } finally {
    setBusy(false);
  }
  if (finalText) {
    const lastMsg = [...document.querySelectorAll("#pane-ai .ai-msg.ai-done")].pop();
    if (lastMsg) {
      const line = document.createElement("div");
      line.className = "ai-agentdone";
      line.textContent = "— PerchAgent finished —";
      lastMsg.appendChild(line);
    }
    scrollList();
  }
}
