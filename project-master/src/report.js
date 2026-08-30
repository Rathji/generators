// src/report.js — Weekly report (Roadmap task 90).
//
// Builds a data snapshot of the last 7 days (completions, focus time, habit
// streaks, per-project progress, events, overdue) and streams an AI-written
// weekly summary into a modal. The snapshot is pure + tested; the generation
// itself is a thin wrapper over root.generateText.
//
// Prompt design is prefix-cache-friendly: a fixed persona block, then <DATA>
// (the snapshot), then a single TASK line at the end.

import { todayLocal, addDays, formatDay, msToIso } from "./dates.js";
import { formatMs } from "./taskTools.js";
import { openModal, toast } from "./ui.js";
import { ICONS } from "./icons.js";

// A rolling 7-day window ending today ("this week").
export function weekRange(today = todayLocal()) {
  return { start: addDays(today, -6), end: today };
}

// Human-readable snapshot of the week. Pure — used as the <DATA> for the
// LLM and asserted in tests.
export function buildReportSnapshot(store) {
  const t = todayLocal();
  const { start } = weekRange(t);
  const inWindow = (ms) => !!ms && msToIso(ms) >= start && msToIso(ms) <= t;
  const tasks = store.all("task");
  const doneWeek = tasks.filter((x) => x.status === "Done" && inWindow(x.completedAt));
  const createdWeek = tasks.filter((x) => inWindow(x.created));
  const open = tasks.filter((x) => x.status !== "Done");
  const overdue = open.filter((x) => x.due && x.due < t);
  const doneToday = tasks.filter((x) => x.status === "Done" && msToIso(x.completedAt) === t).length;
  const projs = store.all("project");
  const habits = store.all("habit");
  const logs = store.all("focuslog").filter((l) => inWindow(l.started));
  let focusMin = 0, focusSess = 0;
  for (const s of logs) { focusMin += Number(s.durationMin) || 0; focusSess++; }
  const checks = store.all("checklist");
  const totalItems = checks.reduce((n, c) => n + (c.items || []).length, 0);
  const doneItems = checks.reduce((n, c) => n + (c.items || []).filter((i) => i.done).length, 0);
  const events = store.all("event").filter((e) => e.date && e.date >= start && e.date <= addDays(t, 7))
    .sort((a, b) => a.date.localeCompare(b.date));

  const L = [];
  L.push(`Report window: ${start} to ${t} (${formatDay(start)} – ${formatDay(t)}), 7 days.`);
  L.push(`Tasks: ${doneWeek.length} completed this week${doneToday ? " (" + doneToday + " today)" : ""}, ${createdWeek.length} created, ${open.length} open, ${overdue.length} overdue right now.`);

  L.push("Completed this week:");
  if (!doneWeek.length) L.push("  none");
  for (const x of doneWeek.slice(0, 10)) {
    const p = projs.find((q) => q.id === x.projectId);
    L.push(`  ${x.title}${p ? " — " + p.name : ""}${x.priority ? " [" + x.priority + "]" : ""}`);
  }
  L.push("Overdue now:");
  if (!overdue.length) L.push("  none");
  for (const x of overdue.slice(0, 8)) L.push(`  ${x.title} (due ${x.due})`);

  L.push("Projects:");
  if (!projs.length) L.push("  none");
  for (const p of projs) {
    const pt = tasks.filter((x) => x.projectId === p.id);
    const done = pt.filter((x) => x.status === "Done").length;
    const pct = pt.length ? Math.round((done / pt.length) * 100) : 0;
    L.push(`  ${p.name} [${p.status}] — ${done}/${pt.length} done (${pct}%)`);
  }

  L.push(`Focus: ${focusSess} work session${focusSess === 1 ? "" : "s"}, ${focusMin} minutes this week.`);
  L.push("Habits:");
  if (!habits.length) L.push("  none");
  for (const h of habits) {
    const hist = h.history || {};
    const on = Object.keys(hist).filter((d) => hist[d]);
    let streak = 0, cursor = hist[t] ? t : addDays(t, -1);
    while (hist[cursor]) { streak++; cursor = addDays(cursor, -1); }
    L.push(`  ${h.name} — streak ${streak}, ${on.length} total${hist[t] ? ", done today" : ""}`);
  }
  L.push("Events (this week + next 7 days):");
  if (!events.length) L.push("  none");
  for (const e of events.slice(0, 8)) L.push(`  ${e.date}${e.startTime ? " " + e.startTime : ""} ${e.title}`);
  L.push(`Checklists: ${doneItems}/${totalItems} items checked across ${checks.length} list${checks.length === 1 ? "" : "s"}.`);

  // Focus logged this week in time-tracking terms, if any task timers ran.
  const tracked = tasks.reduce((n, x) => n + (x.timeLog || []).filter((e) => inWindow(e.start)).reduce((s, e) => s + Math.max(0, e.end - e.start), 0), 0);
  if (tracked > 0) L.push(`Task timers: ${formatMs(tracked)} tracked on tasks this week.`);
  return L.join("\n");
}

const REPORT_PERSONA = `You are the weekly-summariser built into "Project Master", a local-first project management app. The user asked for their weekly report. Using ONLY the workspace snapshot in <DATA> below, write a warm, honest, concrete summary of their week.

Style rules:
- Plain text only — no markdown headings, no bold, no asterisks. Short "- " bullet lists are fine.
- Reference real items by name (tasks, projects, habits, events) from <DATA>.
- Never invent data that isn't in <DATA>. If a section is empty, say so in one short line.
- Cover, in order: how the week went overall; top completed items; overdue tasks needing attention; focus time; habit streaks; per-project progress; then finish with 2-3 concrete suggestions for next week.
- Keep it under ~180 words.`;

export function buildReportPrompt(store) {
  return `${REPORT_PERSONA}\n\n<DATA>\n${buildReportSnapshot(store)}\n</DATA>\n\nTASK: Write the weekly report.`;
}

// Returns a promise from root.generateText (streams via onChunk).
export function generateWeeklyReport(store, { onChunk } = {}) {
  const g = (typeof root !== "undefined" && root && root.generateText) ? root.generateText.bind(root) : null;
  if (!g) return Promise.reject(new Error("The AI assistant isn't available yet — check the import in main.pjs"));
  return g({ instruction: buildReportPrompt(store), onChunk });
}

// The weekly report modal: streaming output + Copy / Save as note. Opens
// from the dashboard's "Generate weekly report" button.
export function openWeeklyReportModal(store) {
  const { el, close } = openModal(`
    <div class="modal-card task-modal" role="dialog" aria-modal="true" aria-label="Weekly report" style="max-width:620px;">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x || "×"}</button>
      <h3>Weekly report</h3>
      <p class="modal-sub">An AI summary of the last 7 days, generated from your workspace.</p>
      <div class="wr-body" id="wrBody" style="max-height:52vh;overflow:auto;white-space:pre-wrap;line-height:1.55;min-height:120px;padding:4px 2px;">Generating…</div>
      <div class="modal-btns">
        <button class="btn" id="wrCopyBtn" disabled>Copy</button>
        <button class="btn" id="wrNoteBtn" disabled>${ICONS.pin || ""} Save as note</button>
        <button class="btn btn-primary" data-cancel>Close</button>
      </div>
    </div>`);
  el.querySelector("[data-cancel]")?.addEventListener("click", close);
  el.querySelector("[data-x]")?.addEventListener("click", close);
  const bodyEl = el.querySelector("#wrBody");
  let full = "";
  let started = false;
  const typing = document.createElement("span");
  typing.textContent = "…";
  bodyEl.textContent = "";
  bodyEl.appendChild(typing);
  const done = () => {
    if (typing.parentNode) typing.remove();
    bodyEl.textContent = full.trim();
    const copyBtn = el.querySelector("#wrCopyBtn");
    const noteBtn = el.querySelector("#wrNoteBtn");
    if (copyBtn) copyBtn.disabled = false;
    if (noteBtn) noteBtn.disabled = false;
  };
  generateWeeklyReport(store, {
    onChunk: (d) => {
      if (!started) { started = true; if (typing.parentNode) typing.remove(); bodyEl.textContent = ""; }
      full += String(d.textChunk || "");
      bodyEl.textContent = full;
      bodyEl.scrollTop = bodyEl.scrollHeight;
    },
  }).then(() => done()).catch(() => {
    if (!full.trim()) bodyEl.textContent = "The report couldn't be generated — please try again.";
    done();
  });
  el.querySelector("#wrCopyBtn")?.addEventListener("click", async () => {
    try { await navigator.clipboard.writeText(full.trim()); toast("Report copied", "success"); }
    catch { toast("Couldn't copy — select the text manually", "error"); }
  });
  el.querySelector("#wrNoteBtn")?.addEventListener("click", () => {
    const title = "Weekly report — " + todayLocal();
    store.create("note", { title, body: full.trim(), pinned: false, tags: [], projectId: null });
    toast("Saved as a note", "success");
    close();
  });
}
