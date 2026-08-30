// src/assistant.js — AI Assistant (Roadmap Phase 10: tasks 74–79).
//
//  74: data-aware streaming chat — the assistant sees a compact snapshot of
//      the user's workspace and streams replies chunk-by-chunk
//  75: 6 quick actions — preset prompts tailored to the current data
//  76: goal-breakdown modal — turn a goal into actionable steps, then offer
//      to create them as real tasks
//  77: focus-block planner — plan today's work into Pomodoro focus blocks
//  78: save reply as note — one click turns a reply into a note record
//  79: reply actions — Copy / Save as note / Append to a task on every reply
//
// Prompt design is prefix-cache-friendly (see the ai-text-plugin skill): a
// fixed persona block, then <DATA>, then the append-only <MESSAGES> log, then
// the TASK at the very end. Every call shares the unchanged prefix so
// successive generations start fast.

import { $, esc, toast, openModal } from "./ui.js";
import { ICONS } from "./icons.js";
import { todayLocal, addDays, formatDay } from "./dates.js";

const PERSONA = `You are "Project Master", the built-in assistant of a local-first project management app. You help the user plan, prioritise, and reflect on their projects, tasks, events, habits and focus time using ONLY the workspace snapshot in <DATA> below.

Style rules:
- Be warm, concrete and concise. Prefer short bullet lists over paragraphs.
- Reference real items by name (projects, tasks, habits, events) from <DATA>.
- Never invent data that is not in <DATA>; if something is missing, say so and suggest adding it.
- Do not use markdown headings or bold; plain text with dashes for lists is fine.
- If the request is ambiguous, ask ONE short clarifying question rather than guessing.`;

// ── data snapshot (pure, tested) ─────────────────────────────────
export function buildSnapshot(store) {
  const t = todayLocal();
  const lines = [];
  const projs = store.all("project");
  const tasks = store.all("task");
  const events = store.all("event");
  const habits = store.all("habit");
  const notes = store.all("note");
  const checks = store.all("checklist");
  const logs = store.all("focuslog");

  const open = tasks.filter((x) => x.status !== "Done");
  const doneToday = tasks.filter((x) => x.completedAt && new Date(x.completedAt).toISOString().slice(0, 10) === t).length;
  const overdue = open.filter((x) => x.due && x.due < t);

  lines.push("Projects (" + projs.length + "):");
  if (!projs.length) lines.push("  none");
  for (const p of projs) {
    const pt = tasks.filter((x) => x.projectId === p.id);
    lines.push(`  ${p.name} [${p.status}] — ${pt.filter((x) => x.status !== "Done").length} open / ${pt.length} total`);
  }

  lines.push("Open tasks (" + open.length + "):");
  if (!open.length) lines.push("  none");
  const sorted = [...open].sort((a, b) => {
    const rank = { high: 0, medium: 1, low: 2 };
    return (a.due ? a.due : "9999") === (b.due ? b.due : "9999")
      ? (rank[a.priority] ?? 1) - (rank[b.priority] ?? 1)
      : String(a.due ? a.due : "9999").localeCompare(String(b.due ? b.due : "9999"));
  });
  for (const x of sorted.slice(0, 10)) {
    const p = projs.find((q) => q.id === x.projectId);
    const due = x.due ? (x.due < t ? "overdue(" + x.due + ")" : (x.due === t ? "today" : "due " + x.due)) : "undated";
    lines.push(`  ${x.title} — ${x.status || "todo"}, ${x.priority || "low"} priority, ${due}${p ? ", project " + p.name : ""}${x.tags && x.tags.length ? ", tags " + x.tags.join(",") : ""}`);
  }
  if (overdue.length) lines.push(`Overdue count: ${overdue.length}`);
  if (doneToday) lines.push(`Completed today: ${doneToday}`);

  const todaysEvents = events.filter((e) => e.date === t).sort((a, b) => String(a.startTime || "99:99").localeCompare(String(b.startTime || "99:99")));
  lines.push("Events today (" + todaysEvents.length + "):");
  for (const e of todaysEvents.slice(0, 6)) lines.push(`  ${e.startTime ? e.startTime + " " : ""}${e.title}`);
  const future = events.filter((e) => e.date && e.date > t).sort((a, b) => a.date.localeCompare(b.date)).slice(0, 5);
  if (future.length) { lines.push("Upcoming events:"); for (const e of future) lines.push(`  ${e.date} ${e.startTime ? e.startTime + " " : ""}${e.title}`); }

  lines.push("Habits:");
  for (const h of habits) {
    const hist = h.history || {};
    const on = Object.keys(hist).filter((d) => hist[d]);
    let streak = 0, cursor = hist[t] ? t : addDays(t, -1);
    while (hist[cursor]) { streak++; cursor = addDays(cursor, -1); }
    lines.push(`  ${h.name} — streak ${streak}, ${on.length} total${hist[t] ? ", done today" : ""}`);
  }

  let focusMin = 0, focusSessions = 0;
  for (const s of logs) { if (s.mode === "work") { focusMin += Number(s.durationMin) || 0; focusSessions++; } }
  lines.push(`Focus: ${focusSessions} work sessions, ${focusMin} minutes logged all-time`);
  lines.push(`Notes: ${notes.length} · Checklists: ${checks.length}`);
  return lines.join("\n");
}

// Parse a generated goal-breakdown (or similar list) into task titles:
// keeps bullet/numbered lines, strips leading markers and empty noise.
export function parsePlan(text) {
  const out = [];
  for (const raw of String(text || "").split("\n")) {
    const line = raw.replace(/^\s*[-*•▪▪>]\s*/, "").replace(/^\s*\d+[.)]\s*/, "").trim();
    if (!line) continue;
    if (/^(here|these|below|ok|okay|sure|great|summary|plan|breakdown)/i.test(line) && line.length < 40) continue;
    if (line.length > 240) continue;
    out.push(line);
  }
  return out.slice(0, 20);
}

const QUICK_ACTIONS = [
  ["today", "Top 3 today", "target", "Pick the 3 most important things to do today and say why, in one short list."],
  ["review", "Review this week", "calendar", "Review this week ahead: events, due tasks, habits and focus. Give a 3–5 line summary and 2–3 concrete suggestions."],
  ["overdue", "Find overdue", "flag", "List the overdue tasks and advise how to recover from the backlog without burning out."],
  ["focus", "Plan focus blocks", "timer", "Plan today into Pomodoro focus blocks: group the open tasks/events into realistic focus sessions (e.g. '09:00–09:25 · task X'), respecting the focus durations and any events already scheduled today."],
  ["plan", "Suggest a project plan", "briefcase", "Pick the most active project and propose its next 3–5 concrete steps (as a numbered list), in priority order."],
  ["wins", "Celebrate wins", "sparkle", "Summarise recent progress to celebrate: anything completed recently (incl. completed today), streaks kept, or focus time logged. Keep it warm and brief."],
];

// task text for a quick action (pure, tested) — the actual generation
// happens in runQuickAction so tests don't need the API.
export function quickActionTask(key) {
  const a = QUICK_ACTIONS.find((x) => x[0] === key);
  return a ? a[3] : null;
}
export function quickActionLabel(key) {
  const a = QUICK_ACTIONS.find((x) => x[0] === key);
  return a ? a[1] : null;
}
export const QUICK_ACTION_LIST = QUICK_ACTIONS.map(([k, label, ico, task]) => ({ key: k, label, ico, task }));

// ── chat state + prompt building ─────────────────────────────────
export const chatState = {
  messages: [],   // [{role:"user"|"assistant", text}] — append-only, no startWith stored
  busy: false,
  gen: null,
  summary: "",    // rolled-up summary of compacted history
};
const KEEP = 8;

export function clearChat() {
  chatState.messages = [];
  chatState.summary = "";
}

function buildPrompt(task) {
  const store = (typeof window !== "undefined" && window.pm && window.pm.store) || null;
  const snapshot = store ? buildSnapshot(store) : "(workspace not loaded)";
  const log = [chatState.summary && `[Summary of the earlier conversation:\n${chatState.summary}]`, ...chatState.messages.map((m) => (m.role === "user" ? "User: " : "Assistant: ") + m.text)].filter(Boolean);
  return `${PERSONA}

<DATA>
${snapshot}
</DATA>

<MESSAGES>
${log.join("\n\n")}
</MESSAGES>

TASK: ${task}`;
}

function genFn() {
  const r = (typeof root !== "undefined" && root && root.generateText) ? root : null;
  return r ? r.generateText.bind(r) : null;
}

// background compaction (never awaited by the send path)
let compacting = false;
let replyActionsBound = false;
async function maybeCompact() {
  if (compacting || chatState.messages.length <= KEEP) return;
  const g = genFn();
  if (!g) return;
  try {
    const meta = g({ getMetaObject: true });
    if (!meta) return;
    if (meta.countTokens(buildPrompt("")) < (meta.idealMaxContextTokens || 6000) * 0.85) return;
  } catch (e) { return; }
  compacting = true;
  try {
    const n = chatState.messages.length - KEEP;
    const boundary = chatState.messages[n - 1].text.slice(-30);
    const result = await g({
      instruction: buildPrompt(`Summarize the first ${n} messages, stopping after the message that ends with "${boundary}". Fold in the [Summary of the earlier conversation...] block if there is one. Terse bullets; preserve names, facts, decisions, and unresolved threads. Output ONLY the new summary text.`),
    });
    chatState.summary = result.text.trim();
    chatState.messages = chatState.messages.slice(n);
  } catch (e) { /* keep the full log on failure */ } finally {
    compacting = false;
  }
}

// ── view ─────────────────────────────────────────────────────────
export function assistantViewHTML() {
  return `
    <div class="view-head">
      <div class="view-head-top">
        <div><h1><span class="vh-ico">${ICONS.sparkle}</span> Assistant</h1>
        <p class="sub">Ask anything about your projects — replies stream in as they're written.</p></div>
        <button class="btn" id="asBreakdownBtn" title="Turn a goal into actionable steps">${ICONS.lightbulb} Break down a goal</button>
      </div>
    </div>
    <div class="as-shell">
      <div class="as-actions">
        ${QUICK_ACTION_LIST.map((a) => `<button class="as-action" data-quick="${a.key}" title="${esc(a.task)}">${ICONS[a.ico] || ICONS.sparkle}<span>${esc(a.label)}</span></button>`).join("")}
      </div>
      <div class="as-msgs" id="asMsgs">
        <div class="as-empty" id="asEmpty">
          <div class="as-empty-ico">${ICONS.sparkle}</div>
          <p>Hi! I can see your projects, tasks, events, habits and focus time.</p>
          <p class="muted">Try a quick action above, or just ask — e.g. <em>“what should I do first today?”</em></p>
        </div>
      </div>
      <div class="as-input">
        <input id="asInput" type="text" placeholder="Message the assistant…" maxlength="2000" autocomplete="off">
        <button class="btn btn-primary" id="asSendBtn" title="Send">${ICONS.send} Send</button>
        <button class="btn" id="asStopBtn" title="Stop generating" hidden>${ICONS.x} Stop</button>
      </div>
      <p class="muted small" style="margin:8px 0 0;">AI replies are generated on the fly — a snapshot of your workspace is sent with each request; nothing else leaves this browser. Please verify important suggestions.</p>
    </div>`;
}

function addBubble(role, text) {
  const ctn = $("#asMsgs");
  const div = document.createElement("div");
  div.className = "as-msg " + role;
  const body = document.createElement("div");
  body.className = "as-body";
  div.appendChild(body);
  if (role === "assistant") {
    const actions = document.createElement("div");
    actions.className = "as-reply-actions";
    actions.innerHTML = `
      <button class="mini-btn" data-ra-copy title="Copy">${ICONS.copy} Copy</button>
      <button class="mini-btn" data-ra-note title="Save as note">${ICONS.pin} Save as note</button>
      <button class="mini-btn" data-ra-append title="Append to a task">${ICONS.link2} Append to task</button>`;
    div.appendChild(actions);
  }
  if (ctn) {
    ctn.appendChild(div);
    ctn.scrollTop = ctn.scrollHeight;
  }
  return { el: div, body };
}

export function wireAssistantView(store, ctx) {
  const msgs = $("#asMsgs");
  const input = $("#asInput");
  const sendBtn = $("#asSendBtn");
  const stopBtn = $("#asStopBtn");
  const empty = $("#asEmpty");

  const scrollDown = () => { if (msgs) msgs.scrollTop = msgs.scrollHeight; };

  const renderHistory = () => {
    if (!msgs) return;
    msgs.innerHTML = "";
    if (!chatState.messages.length) {
      msgs.appendChild(empty);
      return;
    }
    for (const m of chatState.messages) {
      const { body } = addBubble(m.role, "");
      body.textContent = m.text;
    }
  };
  renderHistory();

  const setBusy = (b) => {
    chatState.busy = b;
    if (sendBtn) sendBtn.disabled = b;
    if (stopBtn) stopBtn.hidden = !b;
    if (input) input.disabled = b;
  };

  const finishReply = (text) => {
    const clean = String(text || "").replace(/^Assistant:\s*/, "").trim();
    chatState.messages.push({ role: "assistant", text: clean });
    setBusy(false);
    scrollDown();
    maybeCompact();
  };

  const send = async (raw) => {
    const text = String(raw || "").trim();
    if (!text || chatState.busy) return;
    const g = genFn();
    if (!g) { toast("The AI assistant isn't available yet — check the import in main.pjs", "error", 5000); return; }
    chatState.messages.push({ role: "user", text });
    if (empty && empty.parentNode) empty.remove();
    addBubble("user", "").body.textContent = text;

    // assistant bubble with a typing indicator until the first chunk lands
    const { el, body } = addBubble("assistant", "");
    body.textContent = "";
    const typing = document.createElement("span");
    typing.className = "as-typing";
    typing.textContent = "…";
    body.appendChild(typing);
    setBusy(true);
    scrollDown();

    const prompt = buildPrompt("Write your reply as the assistant. Reply directly to the user's latest message.");
    let started = false;
    let full = "";
    try {
      chatState.gen = g({
        instruction: prompt,
        startWith: "Assistant: ",
        stopSequences: ["\nUser:"],
        onChunk: (d) => {
          if (!started) { started = true; if (typing.parentNode) typing.remove(); body.textContent = ""; }
          const chunk = d.isFromStartWith ? String(d.textChunk || "").replace(/^Assistant:\s*/, "") : String(d.textChunk || "");
          full += chunk;
          body.textContent = full;
          scrollDown();
        },
      });
      const res = await chatState.gen;
      if (!started) { if (typing.parentNode) typing.remove(); body.textContent = ""; }
      const text = String(res && res.text || full || "").replace(/^Assistant:\s*/, "").trim();
      if (text) body.textContent = text;
      finishReply(text || (res && res.text) || full);
    } catch (e) {
      if (typing.parentNode) typing.remove();
      if (full.trim()) { body.textContent = full.trim(); finishReply(full.trim()); }
      else {
        body.textContent = "";
        const note = document.createElement("span");
        note.className = "as-err";
        note.textContent = "Generation stopped or failed.";
        body.appendChild(note);
        chatState.messages.push({ role: "assistant", text: "(generation stopped)" });
        setBusy(false);
      }
    } finally {
      chatState.gen = null;
      scrollDown();
    }
  };

  // one-shot quick action (not part of the chat log)
  const runQuickAction = async (key) => {
    const task = quickActionTask(key);
    if (!task || chatState.busy) return;
    const g = genFn();
    if (!g) { toast("The AI assistant isn't available yet", "error", 5000); return; }
    if (empty && empty.parentNode) empty.remove();
    const bubble = addBubble("assistant", "");
    bubble.body.textContent = "";
    const typing = document.createElement("span");
    typing.className = "as-typing";
    typing.textContent = "Working on “" + quickActionLabel(key) + "”…";
    bubble.body.appendChild(typing);
    setBusy(true);
    let started = false, full = "";
    try {
      await g({
        instruction: buildPrompt(task),
        startWith: "Assistant: ",
        stopSequences: ["\nUser:"],
        onChunk: (d) => {
          if (!started) { started = true; if (typing.parentNode) typing.remove(); bubble.body.textContent = ""; }
          const chunk = d.isFromStartWith ? String(d.textChunk || "").replace(/^Assistant:\s*/, "") : String(d.textChunk || "");
          full += chunk;
          bubble.body.textContent = full;
          scrollDown();
        },
      });
    } catch (e) {
      if (typing.parentNode) typing.remove();
      bubble.body.textContent = full.trim() || "That didn't work — please try again.";
    } finally {
      setBusy(false);
      scrollDown();
    }
  };

  // reply actions (tasks 78 & 79) — bind ONCE; wireAssistantView may run again
  // when the user navigates back to the assistant view
  if (!replyActionsBound) {
    replyActionsBound = true;
    document.addEventListener("click", async (e) => {
    const b = e.target.closest("[data-ra-copy],[data-ra-note],[data-ra-append]");
    if (!b) return;
    const bodyEl = b.closest(".as-msg.assistant")?.querySelector(".as-body");
    const text = (bodyEl ? bodyEl.textContent : "").trim();
    if (!text) return;
    if (b.hasAttribute("data-ra-copy")) {
      try { await navigator.clipboard.writeText(text); toast("Reply copied", "success"); }
      catch (er) { toast("Couldn't copy — select the text manually", "error"); }
      return;
    }
    if (b.hasAttribute("data-ra-note")) {
      const title = text.split("\n")[0].replace(/^Assistant:\s*/, "").trim().slice(0, 60) || "Assistant — " + formatDay(todayLocal());
      store.create("note", { title, body: text, pinned: false, tags: [], projectId: null });
      toast("Saved as a note", "success");
      return;
    }
    if (b.hasAttribute("data-ra-append")) {
      const open = store.all("task").filter((x) => x.status !== "Done").sort((a, b) => String(a.title || "").localeCompare(String(b.title || "")));
      const { el, close } = openModal(`
        <div class="modal-card" role="dialog" aria-modal="true" aria-label="Append to task">
          <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
          <h3>Append to a task</h3>
          <p class="modal-sub">Append this reply to a task's notes.</p>
          <div class="field" style="margin-top:10px;"><label for="asAppendSel">Task *</label>
            <select id="asAppendSel">${open.length ? open.map((x) => `<option value="${x.id}">${esc(x.title)}</option>`).join("") : `<option value="">No open tasks</option>`}</select></div>
          <div class="modal-btns">
            <button class="btn" data-cancel>Cancel</button>
            <button class="btn btn-primary" id="asAppendOk">Append</button>
          </div>
        </div>`);
      el.querySelector("[data-cancel]")?.addEventListener("click", close);
      el.querySelector("[data-x]")?.addEventListener("click", close);
      el.querySelector("#asAppendOk")?.addEventListener("click", () => {
        const id = el.querySelector("#asAppendSel")?.value;
        close();
        if (!id) { toast("No task selected", "error"); return; }
        const task = store.get("task", id);
        if (!task) return;
        const prev = (task.notes || "").trim();
        const stamp = "\n\n— Assistant · " + new Date().toLocaleString() + " —\n" + text;
        store.upsert("task", id, { notes: prev ? prev + stamp : text });
        toast("Appended to “" + (task.title || "task") + "”", "success");
      });
    }
    });
  }

  // goal breakdown (task 76)
  const openGoalBreakdown = () => {
    if (chatState.busy) return;
    const { el, close } = openModal(`
      <div class="modal-card" role="dialog" aria-modal="true" aria-label="Break down a goal" style="max-width:520px;">
        <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
        <h3>Break down a goal</h3>
        <p class="modal-sub">Describe a goal and I'll turn it into actionable steps, then you can add them as tasks.</p>
        <div class="field" style="margin-top:10px;"><label for="asGoalInput">Goal *</label>
          <textarea id="asGoalInput" rows="3" placeholder="e.g. Launch a weekly newsletter by the end of next month" maxlength="800"></textarea></div>
        <div class="modal-btns">
          <button class="btn" data-cancel>Cancel</button>
          <button class="btn btn-primary" id="asGoalRun">${ICONS.sparkle} Generate plan</button>
        </div>
      </div>`);
    el.querySelector("[data-cancel]")?.addEventListener("click", close);
    el.querySelector("[data-x]")?.addEventListener("click", close);
    el.querySelector("#asGoalRun")?.addEventListener("click", async () => {
      const goal = (el.querySelector("#asGoalInput")?.value || "").trim();
      if (!goal) { toast("Describe your goal first", "error"); return; }
      const g = genFn();
      if (!g) { toast("The AI assistant isn't available yet", "error", 5000); return; }
      close();
      if (empty && empty.parentNode) empty.remove();
      const bubble = addBubble("assistant", "");
      bubble.body.textContent = "";
      const typing = document.createElement("span");
      typing.className = "as-typing";
      typing.textContent = "Breaking down your goal…";
      bubble.body.appendChild(typing);
      setBusy(true);
      let started = false, full = "";
      try {
        await g({
          instruction: buildPrompt(`Break down this goal into actionable steps for the user:\nGoal: ${goal}\n\nOutput a numbered list of 4–8 concrete steps (each on its own line, "1. ", "2. ", ...). Keep each step to one sentence. Then, in a final short line starting with "Why this order:", explain the ordering in one sentence.`),
          startWith: "Assistant: ",
          stopSequences: ["\nUser:"],
          onChunk: (d) => {
            if (!started) { started = true; if (typing.parentNode) typing.remove(); bubble.body.textContent = ""; }
            const chunk = d.isFromStartWith ? String(d.textChunk || "").replace(/^Assistant:\s*/, "") : String(d.textChunk || "");
            full += chunk;
            bubble.body.textContent = full;
            scrollDown();
          },
        });
        if (typing.parentNode) typing.remove();
        bubble.body.textContent = full.trim();
        const steps = parsePlan(full);
        if (steps.length) {
          const row = document.createElement("div");
          row.className = "as-goal-add";
          row.innerHTML = `<button class="btn btn-primary" data-goal-add>${ICONS.plus} Add ${steps.length} step${steps.length === 1 ? "" : "s"} as tasks</button>`;
          bubble.el.appendChild(row);
          row.querySelector("[data-goal-add]").addEventListener("click", async () => {
            const projects = store.all("project");
            const pick = await new Promise((res) => {
              const m = openModal(`
                <div class="modal-card" role="dialog" aria-modal="true" aria-label="Add steps as tasks">
                  <button class="modal-x" data-x title="Close">${ICONS.x}</button>
                  <h3>Add ${steps.length} tasks</h3>
                  <div class="field"><label for="asGoalProj">Project</label>
                    <select id="asGoalProj"><option value="">No project</option>${projects.map((p) => `<option value="${p.id}">${esc(p.name)}</option>`).join("")}</select></div>
                  <div class="modal-btns">
                    <button class="btn" data-cancel>Cancel</button>
                    <button class="btn btn-primary" data-confirm>${ICONS.plus} Add</button>
                  </div>
                </div>`);
              m.el.querySelector("[data-cancel]")?.addEventListener("click", () => { m.close(); res(null); });
              m.el.querySelector("[data-x]")?.addEventListener("click", () => { m.close(); res(null); });
              m.el.querySelector("[data-confirm]")?.addEventListener("click", () => { const pid = m.el.querySelector("#asGoalProj")?.value || null; m.close(); res(pid); });
            });
            if (pick === null) return;
            for (const s of steps) store.create("task", { title: s, projectId: pick, priority: "medium", status: "todo", tags: [], notes: "" });
            toast(steps.length + " tasks added", "success");
            row.remove();
          });
        }
      } catch (e) {
        if (typing.parentNode) typing.remove();
        bubble.body.textContent = full.trim() || "That didn't work — please try again.";
      } finally {
        setBusy(false);
        scrollDown();
      }
    });
  };

  $("#asBreakdownBtn")?.addEventListener("click", openGoalBreakdown);
  document.querySelectorAll("[data-quick]").forEach((b) => b.addEventListener("click", () => runQuickAction(b.dataset.quick)));
  const doSend = () => { const v = input ? input.value : ""; if (input) input.value = ""; send(v); };
  sendBtn?.addEventListener("click", doSend);
  input?.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); doSend(); } });
  stopBtn?.addEventListener("click", () => { if (chatState.gen && typeof chatState.gen.stop === "function") { try { chatState.gen.stop(); } catch (e) {} } });
}
