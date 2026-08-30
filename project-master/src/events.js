// src/events.js — Events CRUD + tasks-on-calendar (Roadmap Phase 4: tasks 36–37).
//
//  36: events CRUD — calendar entries with a title, date, start/end time, color
//     and notes; created/edited/deleted from the Calendar view via a small
//     editor modal (also reachable through the palette + quick commands).
//  37: tasks on calendar — events and tasks share the month grid, week view and
//     the day-detail panel, distinguished by chip styling (clock icon + tinted
//     border on events).
//
// Records: {type:"event", id, title, date:"YYYY-MM-DD", startTime, endTime,
//           color, notes}. Pure helpers covered by runPhase4bTests().

import { $, esc, toast, confirmDialog, openModal } from "./ui.js";
import { ICONS } from "./icons.js";
import { todayLocal, formatDay } from "./dates.js";

export const EVENT_COLORS = ["#8b5cf6", "#22d3ee", "#ec4899", "#22c55e", "#f59e0b", "#ef4444", "#3b82f6", "#14b8a6"];

// Events grouped by date (map day → sorted events). Pure.
export function eventsByDate(store) {
  const m = new Map();
  for (const e of store.all("event")) {
    if (!e.date) continue;
    if (!m.has(e.date)) m.set(e.date, []);
    m.get(e.date).push(e);
  }
  for (const list of m.values()) {
    list.sort((a, b) => String(a.startTime || "99:99").localeCompare(String(b.startTime || "99:99")));
  }
  return m;
}
// Events on one day, sorted by start time. Pure.
export function eventsForDay(store, iso) {
  return store.all("event").filter((e) => e.date === iso)
    .sort((a, b) => String(a.startTime || "99:99").localeCompare(String(b.startTime || "99:99")));
}

function colorOptions(sel) {
  return EVENT_COLORS.map((c) => `<button class="swatch${c === sel ? " sel" : ""}" data-color="${c}" style="background:${c}" aria-label="Event color ${c}"></button>`).join("");
}

// Open the event editor. `event` null → create mode; `defaults` seeds date/time.
export function openEventEditor(store, { event = null, defaults = {} } = {}) {
  const isEdit = !!event;
  const d = event ? event : defaults;
  const { el, close } = openModal(`
    <div class="modal-card task-modal" role="dialog" aria-modal="true" aria-label="${isEdit ? "Edit event" : "New event"}">
      <button class="modal-x" data-x title="Close" aria-label="Close">${ICONS.x}</button>
      <h3>${isEdit ? "Edit event" : "New event"}</h3>
      <p class="modal-sub">${isEdit ? "Update the event details." : "Add an event to the calendar."}</p>
      <div class="field"><label for="evTitleInput">Title *</label><input type="text" id="evTitleInput" value="${esc(d.title || "")}" placeholder="What's happening?" maxlength="120"></div>
      <div class="field"><label for="evDateInput">Date</label><input type="date" id="evDateInput" value="${esc(d.date || todayLocal())}"></div>
      <div class="te-grid">
        <div class="field"><label for="evStartInput">Start time</label><input type="time" id="evStartInput" value="${esc(d.startTime || "09:00")}"></div>
        <div class="field"><label for="evEndInput">End time</label><input type="time" id="evEndInput" value="${esc(d.endTime || "10:00")}"></div>
      </div>
      <div class="field"><label>Color</label><div class="swatches" id="evColors">${colorOptions(d.color || "#8b5cf6")}</div></div>
      <div class="field"><label for="evNotesInput">Notes</label><textarea id="evNotesInput" placeholder="Location, link, details…">${esc(d.notes || "")}</textarea></div>
      <div class="modal-btns">
        ${isEdit ? `<button class="btn btn-danger" id="evDelBtn" style="margin-right:auto;">${ICONS.trash} Delete</button>` : ""}
        <button class="btn" data-cancel>Cancel</button>
        <button class="btn btn-primary" id="evSaveBtn">${isEdit ? "Save changes" : "Add event"}</button>
      </div>
    </div>`);

  let color = d.color || "#8b5cf6";
  el.querySelector("#evColors")?.addEventListener("click", (e) => {
    const sw = e.target.closest(".swatch");
    if (!sw) return;
    color = sw.dataset.color;
    el.querySelectorAll(".swatch").forEach((x) => x.classList.toggle("sel", x === sw));
  });

  el.querySelector("[data-cancel]")?.addEventListener("click", close);
  el.querySelector("#evSaveBtn")?.addEventListener("click", () => {
    const title = (el.querySelector("#evTitleInput")?.value || "").trim();
    if (!title) { toast("Enter an event title", "error"); el.querySelector("#evTitleInput")?.focus(); return; }
    const fields = {
      title,
      date: el.querySelector("#evDateInput")?.value || todayLocal(),
      startTime: el.querySelector("#evStartInput")?.value || "",
      endTime: el.querySelector("#evEndInput")?.value || "",
      color,
      notes: (el.querySelector("#evNotesInput")?.value || "").trim(),
    };
    if (isEdit) store.upsert("event", event.id, fields);
    else store.create("event", fields);
    toast(isEdit ? "Event updated" : "Event added", "success");
    close();
  });

  if (isEdit) {
    el.querySelector("#evDelBtn")?.addEventListener("click", async () => {
      const sure = await confirmDialog({ title: "Delete event?", message: "“" + event.title + "” will be removed from the calendar.", confirmText: "Delete event", danger: true });
      if (!sure) return;
      store.remove("event", event.id);
      toast("Event deleted", "success");
      close();
    });
  }

  setTimeout(() => { const t = el.querySelector("#evTitleInput"); if (t) t.focus(); }, 30);
  return { el, close };
}
