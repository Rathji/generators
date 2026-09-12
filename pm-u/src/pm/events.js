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

import { toast, confirmDialog } from "./ui.js";
import { todayLocal } from "./dates.js";
import { textInput, textareaInput, swatchField, fieldStack, fieldGrid, formModal, actionButton, submitOnEnter, focusFirst } from "./formkit.js";

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

// Open the event editor (template-u input suite). `event` null → create mode;
// `defaults` seeds date/time.
export function openEventEditor(store, { event = null, defaults = {} } = {}) {
  const isEdit = !!event;
  const d = event ? event : defaults;
  const titleField = textInput({ name: "title", label: "Title", value: d.title || "", placeholder: "What's happening?", maxlength: 120, required: true });
  const dateField = textInput({ name: "date", label: "Date", type: "date", value: d.date || todayLocal() });
  const startField = textInput({ name: "startTime", label: "Start time", type: "time", value: d.startTime || "09:00" });
  const endField = textInput({ name: "endTime", label: "End time", type: "time", value: d.endTime || "10:00" });
  const colorField = swatchField({ label: "Color", name: "color", options: EVENT_COLORS, value: d.color || EVENT_COLORS[0] });
  const notesField = textareaInput({ name: "notes", label: "Notes", value: d.notes || "", placeholder: "Location, link, details…" });

  const save = () => {
    const title = String(titleField.value || "").trim();
    if (!title) {
      titleField.setError("Please enter an event title");
      titleField.focus();
      return false;
    }
    const fields = {
      title,
      date: dateField.value || todayLocal(),
      startTime: startField.value || "",
      endTime: endField.value || "",
      color: colorField.value,
      notes: String(notesField.value || "").trim(),
    };
    if (isEdit) store.upsert("event", event.id, fields);
    else store.create("event", fields);
    toast(isEdit ? "Event updated" : "Event added", "success");
  };

  const ref = { close: () => {} };
  const leftButtons = isEdit
    ? [
        actionButton({
          label: "Delete",
          variant: "danger",
          icon: "trash",
          className: "fk-left",
          onClick: async () => {
            const sure = await confirmDialog({ title: "Delete event?", message: "“" + event.title + "” will be removed from the calendar.", confirmText: "Delete event", danger: true });
            if (!sure) return;
            store.remove("event", event.id);
            toast("Event deleted", "success");
            ref.close();
          },
        }),
      ]
    : [];

  const { el, close } = formModal({
    title: isEdit ? "Edit event" : "New event",
    subtitle: isEdit ? "Update the event details." : "Add an event to the calendar.",
    className: "task-modal",
    body: [fieldStack(titleField, dateField, fieldGrid(startField, endField), colorField, notesField)],
    leftButtons,
    acceptLabel: isEdit ? "Save changes" : "Add event",
    onAccept: save,
  });
  ref.close = close;
  submitOnEnter(el, titleField.input);
  focusFirst(el);
  return { el, close };
}
